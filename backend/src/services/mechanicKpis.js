// KPI de mecánicos con pesos (definidos por la jefatura). Cada indicador es una fracción 0–1 o null si no hay datos.
// El puntaje (0–100) pondera los indicadores con datos, pero solo existe si el mecánico tiene OT resueltas en el período
// (cerradas, o abiertas ya vencidas/aplazadas): la disponibilidad de la flota es de todos y no basta para puntuar a nadie.
const WEIGHTS = [
  ['disponibilidad', 'Disponibilidad de la flota', 25],
  ['a_tiempo', 'Órdenes cerradas a tiempo', 25],
  ['sin_reincidencia', 'Fallas repetidas (sin reincidencia)', 15],
  ['checklists', 'Checklists de salida completados', 15],
  ['preventivas', 'Mantenciones preventivas a tiempo', 10],
  ['diagnostico_24h', 'Alertas diagnosticadas en menos de 24 h', 10],
];
const DAY = 86400000;
const toDay = v => Date.parse(`${String(v).slice(0, 10)}T00:00:00Z`);
const ratio = (ok, total) => total ? { valor: ok / total, ok, total } : { valor: null, ok: 0, total: 0 };

function score(metrics) {
  if (!metrics.a_tiempo?.total) return { puntaje: null, peso_medido: 0 };
  let sum = 0, weights = 0;
  for (const [key, , w] of WEIGHTS) if (metrics[key]?.valor != null) { sum += metrics[key].valor * w; weights += w; }
  return weights ? { puntaje: Math.round(sum / weights * 100), peso_medido: weights } : { puntaje: null, peso_medido: 0 };
}

async function mechanicKpis(pool, desde, hasta, today) {
  const end = hasta > today ? today : hasta;
  const [[mechanics], [assigned], [correctivas], [events], [[{ camiones }]], [withChecklist]] = await Promise.all([
    pool.execute("SELECT id, nombre FROM usuarios WHERE rol = 'mecanico' ORDER BY nombre"),
    // OT cerradas en el período y OT abiertas creadas hasta el fin del período.
    pool.execute(`SELECT t.id, t.patente_camion, t.tipo_tarea, t.tipo_mantencion, t.estado, DATE_FORMAT(t.fecha_limite, '%Y-%m-%d') AS limite,
        DATE_FORMAT(t.fecha_completada, '%Y-%m-%d') AS completada, t.veces_aplazada, t.veces_rechazada, t.cotizando, tm.id_mecanico
      FROM tareas t JOIN tarea_mecanicos tm ON tm.id_tarea = t.id
      WHERE (t.estado IN ('Completada', 'Aprobada') AND t.fecha_completada BETWEEN ? AND ?)
         OR (t.estado IN ('Pendiente', 'En_Trabajo') AND t.fecha_creacion <= ?)`, [desde, end, end]),
    pool.execute(`SELECT id, patente_camion, tipo_tarea, DATE_FORMAT(fecha_creacion, '%Y-%m-%d') AS creada, DATE_FORMAT(fecha_completada, '%Y-%m-%d') AS completada
      FROM tareas WHERE tipo_mantencion = 'correctiva'`),
    pool.execute(`SELECT e.id_tarea, tm.id_mecanico,
        MIN(CASE WHEN e.tipo = 'creada' THEN e.created_at END) AS creada,
        MIN(CASE WHEN e.tipo = 'iniciada' THEN e.created_at END) AS iniciada
      FROM tarea_eventos e JOIN tarea_mecanicos tm ON tm.id_tarea = e.id_tarea
      GROUP BY e.id_tarea, tm.id_mecanico`),
    pool.execute('SELECT COUNT(*) AS camiones FROM camiones'),
    pool.execute('SELECT id_tarea FROM checklists WHERE id_tarea IS NOT NULL'),
  ]);
  const checked = new Set(withChecklist.map(r => r.id_tarea));

  // Disponibilidad (toda la flota): días-camión sin una OT correctiva abierta en el período.
  const from = toDay(desde), to = toDay(end), days = Math.max(1, Math.round((to - from) / DAY) + 1);
  const downByTruck = new Map();
  for (const t of correctivas) {
    const s = Math.max(from, toDay(t.creada)), e = Math.min(to, t.completada ? toDay(t.completada) : to);
    if (e < s) continue;
    const set = downByTruck.get(t.patente_camion) || new Set();
    for (let d = s; d <= e; d += DAY) set.add(d);
    downByTruck.set(t.patente_camion, set);
  }
  const down = [...downByTruck.values()].reduce((n, set) => n + set.size, 0);
  const totalDays = Number(camiones) * days;
  const disponibilidad = totalDays ? { valor: Math.max(0, 1 - down / totalDays), ok: totalDays - down, total: totalDays } : { valor: null, ok: 0, total: 0 };

  // Reincidencia: el mismo trabajo (tipo de tarea) vuelve a abrirse en el mismo camión dentro de los 30 días siguientes al cierre.
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const repeated = t => correctivas.some(c => c.id !== t.id && c.patente_camion === t.patente_camion && same(c.tipo_tarea, t.tipo_tarea)
    && toDay(c.creada) > toDay(t.completada) && toDay(c.creada) <= toDay(t.completada) + 30 * DAY);

  const now = Date.now();
  const isClosed = t => t.estado === 'Completada' || t.estado === 'Aprobada';
  // Una OT abierta ya se puede juzgar si se aplazó o su fecha límite quedó dentro del período: cuenta como atrasada.
  const overdue = t => !isClosed(t) && !Number(t.cotizando) && (Number(t.veces_aplazada) > 0 || t.limite < end);
  const build = rows => {
    const decided = rows.filter(t => isClosed(t) || overdue(t));
    const onTime = t => isClosed(t) && !Number(t.veces_aplazada) && t.completada <= t.limite;
    const corr = rows.filter(t => isClosed(t) && t.tipo_mantencion === 'correctiva');
    const prev = decided.filter(t => t.tipo_mantencion === 'preventiva');
    return {
      a_tiempo: ratio(decided.filter(onTime).length, decided.length),
      sin_reincidencia: ratio(corr.filter(t => !Number(t.veces_rechazada) && !repeated(t)).length, corr.length),
      preventivas: ratio(prev.filter(onTime).length, prev.length),
      // OT cerradas en el período que salieron de taller con su checklist lleno.
      checklists: ratio(rows.filter(t => isClosed(t) && checked.has(t.id)).length, rows.filter(isClosed).length),
    };
  };
  const counts = rows => ({ ot_cerradas: rows.filter(isClosed).length, ot_abiertas: rows.filter(t => !isClosed(t)).length, ot_vencidas: rows.filter(overdue).length });
  const diagnosis = evs => {
    // OT creadas en el período: a tiempo si se iniciaron dentro de 24 h; las aún no iniciadas cuentan solo si ya pasaron 24 h.
    const inPeriod = evs.filter(e => e.creada && String(e.creada).slice(0, 10) >= desde && String(e.creada).slice(0, 10) <= end);
    const created = e => Date.parse(String(e.creada).replace(' ', 'T') + 'Z');
    const started = e => e.iniciada ? Date.parse(String(e.iniciada).replace(' ', 'T') + 'Z') : null;
    const due = inPeriod.filter(e => started(e) !== null || now - created(e) > DAY);
    return ratio(due.filter(e => started(e) !== null && started(e) - created(e) <= DAY).length, due.length);
  };

  const mecanicos = mechanics.map(m => {
    const rows = assigned.filter(t => t.id_mecanico === m.id);
    const metrics = { disponibilidad, ...build(rows), diagnostico_24h: diagnosis(events.filter(e => e.id_mecanico === m.id)) };
    return { id: m.id, nombre: m.nombre, ...counts(rows), metricas: metrics, ...score(metrics) };
  });
  // Equipo: cada OT una vez (aunque tenga varios mecánicos).
  const unique = [...new Map(assigned.map(t => [t.id, t])).values()];
  const uniqueEvents = [...new Map(events.map(e => [e.id_tarea, e])).values()];
  const teamMetrics = { disponibilidad, ...build(unique), diagnostico_24h: diagnosis(uniqueEvents) };
  return {
    desde, hasta: end, dias: days,
    pesos: WEIGHTS.map(([key, nombre, peso]) => ({ key, nombre, peso })),
    equipo: { ...counts(unique), metricas: teamMetrics, ...score(teamMetrics) },
    mecanicos: mecanicos.sort((a, b) => (b.puntaje ?? -1) - (a.puntaje ?? -1) || a.nombre.localeCompare(b.nombre)),
  };
}

module.exports = { mechanicKpis, WEIGHTS };
