const { notify } = require('./notify');

const normalize = patente => String(patente || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Revisa cada camión contra cada plan: crea la línea base la primera vez, avisa una vez al 90 % («se acerca»)
// y otra al cumplirse el plan. Si ya hay una tarea abierta para ese plan, no avisa.
const SOON = 0.9;
async function checkDue(pool) {
  const [rows] = await pool.execute(`SELECT c.patente, c.km_actual, p.id AS id_plan, p.nombre, p.cada_km, cp.km_ultimo, cp.avisado, cp.avisado_pronto,
      EXISTS (SELECT 1 FROM tareas t WHERE t.patente_camion = c.patente AND t.id_plan = p.id AND t.estado <> 'Aprobada') AS abierta
    FROM camiones c CROSS JOIN planes_mantencion p LEFT JOIN camion_planes cp ON cp.patente = c.patente AND cp.id_plan = p.id
    WHERE c.km_actual IS NOT NULL`);
  let due = 0;
  for (const row of rows) {
    if (row.km_ultimo === null) {
      await pool.execute('INSERT IGNORE INTO camion_planes (patente, id_plan, km_ultimo) VALUES (?, ?, ?)', [row.patente, row.id_plan, row.km_actual]);
      continue;
    }
    if (row.abierta || row.avisado) continue;
    const done = row.km_actual - row.km_ultimo, next = (row.km_ultimo + row.cada_km).toLocaleString('es-CL');
    if (done >= row.cada_km) {
      due++;
      await notify(pool, ['encargado'], `${row.patente} llegó a ${row.km_actual.toLocaleString('es-CL')} km: corresponde «${row.nombre}». Crea la tarea.`);
      await pool.execute('UPDATE camion_planes SET avisado = TRUE, avisado_pronto = TRUE WHERE patente = ? AND id_plan = ?', [row.patente, row.id_plan]);
    } else if (done >= row.cada_km * SOON && !row.avisado_pronto) {
      await notify(pool, ['encargado'], `Se acerca la «${row.nombre}» de ${row.patente}: va en ${row.km_actual.toLocaleString('es-CL')} km y le toca a los ${next} km (faltan ${(row.cada_km - done).toLocaleString('es-CL')}).`);
      await pool.execute('UPDATE camion_planes SET avisado_pronto = TRUE WHERE patente = ? AND id_plan = ?', [row.patente, row.id_plan]);
    }
  }
  return due;
}

// Km de una ruta: lo del GPS de inicio a término; si falta, la diferencia del odómetro cuando es razonable.
// ponytail: tope fijo de 1500 km por ruta para descartar errores de digitación del odómetro en TTS.
const routeKm = r => {
  const gps = Number(r.gps), diff = Number(r.km_final) - Number(r.km_inicial);
  if (r.gps != null && gps >= 0 && gps <= 1500) return gps;
  return r.km_final != null && r.km_inicial != null && diff > 0 && diff <= 1500 ? diff : 0;
};
// Km de una salida: de Indubal a Indubal (kmSitioGps) cuando TTS lo tiene, que incluye ir y volver a la ruta.
// Si no lo tiene, el avance del contador de TTS hasta la salida siguiente (next_ki), que también es el viaje completo;
// y si tampoco, lo de la ruta. Una ruta dividida repite el mismo km de sitio: se cuenta una vez por salida (seen).
const dayKm = (r, seen) => {
  const sitio = Number(r.sitio);
  if (r.sitio != null && sitio > 0 && sitio <= 2000) {
    const key = r.salida ? String(r.salida) : null;
    if (key && seen.has(key)) return 0;
    if (key) seen.add(key);
    return sitio;
  }
  const next = Number(r.next_ki) - Number(r.km_inicial);
  if (r.next_ki > 0 && r.km_inicial > 0 && next > 0 && next <= 1500) return next;
  return routeKm(r);
};
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
// Última lectura del odómetro coherente con la mediana de las últimas 6: descarta errores de digitación (215.610 entre lecturas de 7.200).
// ponytail: tolerancia fija (500 km o 10 %); un error menor que eso pasa, y se corrige con «Km actual».
function coherentLatest(list) {
  const last = list.slice(-10);
  if (!last.length) return null;
  const m = median(last.map(r => r.km));
  return [...last].reverse().find(r => Math.abs(r.km - m) <= Math.max(500, m * 0.1)) || null;
}

const ms = value => value instanceof Date ? value.getTime() : Date.parse(value);
// Momento de una ruta: salida de Indubal, o inicio de la ruta, o el mediodía de ese día (hora de Chile).
const startOf = r => ms(r.salida || r.hi) || Date.parse(`${r.dia}T12:00:00-03:00`);

// Odómetro actual = km real del tablero (ajuste a mano o registro de combustible) + los viajes completos que salieron después.
// El odómetro de TTS es calculado (no lo anota el chofer): solo se usa en camiones que aún no tienen un km real cargado.
function odometer(manual, routes, readings) {
  const tts = manual ? null : coherentLatest(readings);
  const anchor = manual || (tts && { ...tts, tts: true });
  if (!anchor) return null;
  const after = routes.filter(r => r.at > anchor.at).reduce((sum, r) => sum + r.km, 0);
  return { km: Math.round(anchor.km + (anchor.own || 0) + after), anchor };
}

// Suma el kilometraje diario por camión desde TTS (usuario de solo lectura) y calcula el odómetro:
// km_actual = km_base (lectura inicial o ajuste manual) + km de los días posteriores a km_base_fecha.
async function syncTts(pool, url) {
  if (!url) return { updated: 0, configured: false };
  const { Client } = require('pg');
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000, statement_timeout: 20000 });
  await client.connect();
  let rows;
  try {
    ({ rows } = await client.query(`SELECT patente, to_char(fecha, 'YYYY-MM-DD') AS dia, "kmInicial" AS km_inicial, "kmFinal" AS km_final, "kmRutaGps" AS gps, "kmSitioGps" AS sitio, "salidaSitioAt" AS salida
      FROM "EjecucionRuta" WHERE patente IS NOT NULL AND fecha >= now() - interval '120 days' ORDER BY fecha, "horaInicio" NULLS FIRST`));
  } finally { await client.end(); }
  const [trucks] = await pool.execute("SELECT patente, km_actual, km_base, km_manual, DATE_FORMAT(km_base_fecha, '%Y-%m-%d') AS km_base_fecha, km_base_at FROM camiones");
  const byKey = new Map(trucks.map(t => [normalize(t.patente), t]));
  // Contador de TTS en la salida siguiente del mismo camión (para las rutas sin km de Indubal a Indubal).
  const nextKi = new Map();
  for (let i = rows.length - 1; i >= 0; i--) {
    const key = normalize(rows[i].patente);
    rows[i].next_ki = nextKi.get(key) ?? null;
    if (rows[i].km_inicial > 0) nextKi.set(key, rows[i].km_inicial);
  }
  const daily = new Map(), readings = new Map(), routes = new Map(), seen = new Set();
  for (const r of rows) {
    const truck = byKey.get(normalize(r.patente));
    if (!truck) continue;
    const key = `${truck.patente}|${r.dia}`;
    const day = daily.get(key) || { patente: truck.patente, dia: r.dia, km: 0, rutas: 0 };
    const at = startOf(r), km = dayKm(r, seen);
    day.km += km; day.rutas++;
    daily.set(key, day);
    routes.set(truck.patente, [...(routes.get(truck.patente) || []), { at, km }]);
    // Odómetro anotado al iniciar la ruta + el viaje completo de esa salida (Indubal a Indubal, o lo que haya si aún no cierra).
    // Si solo está el km final, se le suma lo que falta del viaje completo (la vuelta a Indubal).
    const list = readings.get(truck.patente) || [];
    if (r.km_inicial > 0) list.push({ dia: r.dia, at, km: Number(r.km_inicial), own: km });
    else if (r.km_final > 0) list.push({ dia: r.dia, at, km: Number(r.km_final), own: Math.max(0, km - routeKm(r)) });
    readings.set(truck.patente, list);
  }
  for (const d of daily.values()) {
    await pool.execute('INSERT INTO camion_km_diario (patente, fecha, km, rutas) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE km = VALUES(km), rutas = VALUES(rutas)', [d.patente, d.dia, Math.round(d.km * 10) / 10, d.rutas]);
  }
  let updated = 0;
  for (const truck of trucks) {
    const { km_base: base, km_base_fecha: since } = truck;
    // Sin hora guardada (ajustes antiguos), el ajuste manual cuenta desde el fin de ese día.
    const manual = base != null && truck.km_manual ? { km: Number(base), dia: since, at: (truck.km_base_at && ms(`${truck.km_base_at.replace(' ', 'T')}Z`)) || Date.parse(`${since}T23:59:59-03:00`) } : null;
    // ponytail: solo se suman las rutas de los últimos 120 días que trae TTS; una lectura más antigua sin rutas nuevas no se mueve.
    const result = odometer(manual, routes.get(truck.patente) || [], readings.get(truck.patente) || []);
    let total;
    if (result) {
      total = result.km;
      const a = result.anchor;
      if (a.tts && (a.km !== Number(base) || a.dia !== since || truck.km_manual)) {
        await pool.execute('UPDATE camiones SET km_base = ?, km_base_fecha = ?, km_base_at = ?, km_manual = FALSE WHERE patente = ?', [Math.round(a.km), a.dia, new Date(a.at).toISOString().slice(0, 19).replace('T', ' '), truck.patente]);
      }
    } else if (base != null) {
      const [[{ km }]] = since ? await pool.execute('SELECT COALESCE(SUM(km), 0) AS km FROM camion_km_diario WHERE patente = ? AND fecha > ?', [truck.patente, since]) : [[{ km: 0 }]];
      total = Math.round(Number(base) + Number(km));
    } else continue;
    if (total === truck.km_actual) continue;
    await pool.execute('UPDATE camiones SET km_actual = ?, km_actualizado_at = UTC_TIMESTAMP() WHERE patente = ?', [total, truck.patente]);
    updated++;
  }
  if (updated) require('./changes').bump();
  return { updated, configured: true, due: await checkDue(pool) };
}

module.exports = { normalize, checkDue, syncTts, routeKm, dayKm, coherentLatest, odometer };
