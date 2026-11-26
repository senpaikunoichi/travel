const { transaction } = require('../db');
const { normalize } = require('./km');
const { notify } = require('./notify');
const { validate, issues } = require('./checklist');
const { identify, prepareFile, saveFile } = require('../routes/files');
const { LEVELS } = require('../routes/fuel');

class ImportError extends Error {}

// Fin de ruta en TTS: el conductor saca la foto del tablero (la IA lee el nivel y él lo confirma) y dice si el camión
// tiene algún problema; si dice que sí, llena el mismo checklist de los mecánicos. Se lee de la base de TTS (solo lectura)
// cada pocos minutos: lo que aún no está aquí se importa como registro de combustible y, si hay problema, como checklist.
// Si algo falla (foto no disponible, camión sin calzar), se reintenta en la vuelta siguiente.
async function syncCierres(pool, config) {
  if (!config.ttsDatabaseUrl) return { imported: 0 };
  const { Client } = require('pg');
  const client = new Client({ connectionString: config.ttsDatabaseUrl, connectionTimeoutMillis: 10000, statement_timeout: 20000 });
  await client.connect();
  let rows;
  try {
    ({ rows } = await client.query(`SELECT id, patente, "camionNumero" AS numero, "conductorNombre" AS conductor, "estadoCamion" AS cierre,
        to_char(("estadoCamionAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD') AS fecha
      FROM "EjecucionRuta" WHERE "estadoCamionAt" > now() - interval '7 days' ORDER BY "estadoCamionAt"`));
  } finally { await client.end(); }
  if (!rows.length) return { imported: 0 };
  const [done] = await pool.query('SELECT tts_ejecucion FROM combustible_registros WHERE tts_ejecucion IN (?)', [rows.map(r => r.id)]);
  const seen = new Set(done.map(d => d.tts_ejecucion));
  const [trucks] = await pool.execute('SELECT patente, numero, km_actual FROM camiones');
  const byPlate = new Map(trucks.map(t => [normalize(t.patente), t]));
  const byNumber = new Map(trucks.filter(t => t.numero).map(t => [normalize(t.numero), t]));
  let imported = 0;
  for (const r of rows.filter(r => !seen.has(r.id))) {
    try { if (await importOne(pool, config, r, byPlate.get(normalize(r.patente)) || byNumber.get(normalize(r.numero)))) imported++; }
    catch (error) { console.error(`Cierre TTS #${r.id}:`, error.message); }
  }
  if (imported) require('./changes').bump();
  return { imported };
}

async function importOne(pool, config, r, truck) {
  const c = r.cierre || {};
  // ponytail: un camión de TTS que no existe en Mantención se reintenta cada vuelta (7 días); se agrega el camión y entra solo.
  if (!truck) throw new ImportError(`camión ${r.patente || r.numero} no está en Mantención`);
  const nivel = Number(c.nivel);
  if (!LEVELS.includes(nivel) || typeof c.problema !== 'boolean' || !c.foto) throw new ImportError('datos incompletos');
  const items = c.problema ? validate(c.items, ImportError) : null;
  const general = c.problema && typeof c.observaciones === 'string' && c.observaciones.trim() ? c.observaciones.trim().slice(0, 2000) : null;
  const found = items ? issues(items, general) : [];
  // La foto queda en el TTS donde la subió el conductor (producción o pruebas): se busca en cada uno.
  let response;
  for (const base of config.ttsUploadsUrl.split(',')) {
    response = await fetch(new URL(`/uploads/${String(c.foto).split('/').pop()}`, base.trim()), { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (response?.ok) break;
  }
  if (!response?.ok) throw new ImportError(`foto ${c.foto} no disponible`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const saved = await saveFile(await prepareFile({ buffer, mimetype: identify(buffer)?.mime || '', size: buffer.length }, config,
    { image: { maxDimension: Math.min(1280, config.image.maxDimension), quality: Math.min(60, config.image.quality) } }), config);
  const ruta = String(c.ruta || `Ruta TTS #${r.id}`).slice(0, 150), conductor = String(r.conductor || 'Conductor').slice(0, 120);
  const nota = (c.problema ? `Conductor reportó problema: ${found.join('; ') || 'ver checklist'}` : 'Conductor: camión en buen estado.').slice(0, 1000);
  try {
    await transaction(pool, async db => {
      const [result] = await db.execute(`INSERT IGNORE INTO combustible_registros (patente, fecha, ruta, nivel, nota, ruta_archivo, created_by, conductor, tts_ejecucion, problema)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`, [truck.patente, r.fecha, ruta, nivel, nota, saved.ruta, conductor, r.id, c.problema]);
      if (!result.affectedRows) throw new ImportError('ya importado');
      if (!items) return;
      await db.execute(`INSERT INTO checklists (id_tarea, patente, fecha, id_usuario, km, items, observaciones, fallas, conductor, tts_ejecucion) VALUES (NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [truck.patente, r.fecha, truck.km_actual ?? null, JSON.stringify(items), general, items.filter(i => i.estado === 'falla').length, conductor, r.id]);
      await notify(db, ['encargado'], `${truck.patente}: ${conductor} reportó un problema al terminar ${ruta}. ${found.join('; ') || 'Revisa el checklist.'}`.slice(0, 1000));
    });
  } catch (error) { await require('node:fs/promises').unlink(saved.filename).catch(() => {}); if (error.message === 'ya importado') return false; throw error; }
  return true;
}

module.exports = { syncCierres };
