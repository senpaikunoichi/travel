const { Router } = require('express');
const { dateRange, today, HttpError } = require('../validation');
const sendWorkbook = require('../services/workbook');
const { mechanicKpis } = require('../services/mechanicKpis');

// Aggregate each one-to-many relation before joining: mechanic count must not multiply expenses.
const taskReportSql = `SELECT t.id, t.tipo_tarea, t.patente_camion, t.fecha_creacion, t.fecha_limite, t.estado, c.modelo,
  m.mecanicos, COALESCE(g.total_gasto, 0) AS total_gasto
  FROM tareas t JOIN camiones c ON t.patente_camion = c.patente
  LEFT JOIN (SELECT tm.id_tarea, GROUP_CONCAT(u.nombre ORDER BY u.nombre SEPARATOR ', ') AS mecanicos
    FROM tarea_mecanicos tm JOIN usuarios u ON tm.id_mecanico = u.id GROUP BY tm.id_tarea) m ON m.id_tarea = t.id
  LEFT JOIN (SELECT id_tarea, SUM(monto) AS total_gasto FROM gastos GROUP BY id_tarea) g ON g.id_tarea = t.id`;

module.exports = function reports(pool, auth, config) {
  const router = Router();
  router.get('/kpis', auth.allow('jefe', 'admin', 'encargado'), async (req, res) => {
    const day = today(), month = day.slice(0, 8) + '01';
    const [[estadosTareas], [totals], [tareasMecanico], [gastosCamion]] = await Promise.all([
      pool.execute('SELECT estado, COUNT(*) AS total FROM tareas GROUP BY estado'),
      pool.execute(`SELECT COALESCE(SUM(monto), 0) AS totalGastos,
        COALESCE(SUM(CASE WHEN fecha BETWEEN DATE_SUB(?, INTERVAL 6 DAY) AND ? THEN monto ELSE 0 END), 0) AS gastosSemana,
        COALESCE(SUM(CASE WHEN fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 MONTH) THEN monto ELSE 0 END), 0) AS gastosMes FROM gastos`, [day, day, month, month]),
      pool.execute(`SELECT u.id, u.nombre, COUNT(DISTINCT tm.id_tarea) AS total_asignadas,
        COUNT(DISTINCT CASE WHEN t.estado IN ('Completada', 'Aprobada') THEN t.id END) AS completadas
        FROM usuarios u LEFT JOIN tarea_mecanicos tm ON u.id = tm.id_mecanico
        LEFT JOIN tareas t ON tm.id_tarea = t.id WHERE u.rol = 'mecanico' GROUP BY u.id, u.nombre ORDER BY u.nombre`),
      // OT abiertas (pendientes o en trabajo) por camión: con alguna, el camión está «en taller».
      pool.execute(`SELECT c.patente, c.numero, c.modelo, c.estado_operativo, COALESCE(g.total_gasto, 0) AS total_gasto,
          (SELECT COUNT(*) FROM tareas t WHERE t.patente_camion = c.patente AND t.estado IN ('Pendiente', 'En_Trabajo')) AS ot_abiertas
        FROM camiones c
        LEFT JOIN (SELECT t.patente_camion, SUM(g.monto) AS total_gasto FROM tareas t JOIN gastos g ON g.id_tarea = t.id GROUP BY t.patente_camion) g
          ON g.patente_camion = c.patente
        ORDER BY c.estado_operativo DESC, c.patente`),
    ]);
    // Cada camión en un solo estado: en panne (lo marca la oficina) > en taller (tiene OT abierta) > activo.
    for (const c of gastosCamion) c.estado = c.estado_operativo === 'panne' ? 'panne' : Number(c.ot_abiertas) ? 'taller' : 'activo';
    const count = state => gastosCamion.filter(c => c.estado === state).length;
    const flota = { total: gastosCamion.length, activos: count('activo'), enTaller: count('taller'), enPanne: count('panne') };
    res.json({ success: true, estadosTareas, ...totals[0], tareasMecanico, gastosCamion, flota });
  });
  // KPI ponderados de los mecánicos en un período (por defecto, el mes en curso).
  router.get('/kpis/mecanicos', auth.allow('jefe', 'admin'), async (req, res) => {
    const day = today();
    const [desde, hasta] = req.query.desde || req.query.hasta ? dateRange({ fecha_inicio: req.query.desde, fecha_fin: req.query.hasta }) : [day.slice(0, 8) + '01', day];
    if (Date.parse(hasta) - Date.parse(desde) > 366 * 86400000) throw new HttpError(400, 'El período puede ser de hasta un año.');
    res.json({ success: true, ...(await mechanicKpis(pool, desde, hasta, day)) });
  });
  router.get('/exportar/excel', auth.allow('jefe', 'admin'), async (req, res) => {
    const params = dateRange(req.query);
    const truckExpensesSql = `SELECT c.patente, c.numero, c.modelo, c.estado_operativo, COALESCE(g.total_gasto, 0) AS total_gasto
      FROM camiones c LEFT JOIN (
        SELECT t.patente_camion, SUM(g.monto) AS total_gasto FROM tareas t JOIN gastos g ON g.id_tarea = t.id
        ${params.length ? 'WHERE g.fecha BETWEEN ? AND ?' : ''} GROUP BY t.patente_camion
      ) g ON g.patente_camion = c.patente ORDER BY c.estado_operativo DESC, c.patente`;
    const dailyTruckWhere = `WHERE g.monto IS NOT NULL${params.length ? ' AND g.fecha BETWEEN ? AND ?' : ''}`;
    const [[tareas], [gastosPorDiaCamion], [camiones]] = await Promise.all([
      pool.execute(`${taskReportSql}${params.length ? ' WHERE t.fecha_creacion BETWEEN ? AND ?' : ''} ORDER BY t.fecha_creacion DESC, t.id DESC`, params),
      pool.execute(`SELECT g.fecha, t.patente_camion, c.numero, c.modelo, c.estado_operativo, SUM(g.monto) AS total_dia
        FROM gastos g JOIN tareas t ON t.id = g.id_tarea JOIN camiones c ON c.patente = t.patente_camion
        ${dailyTruckWhere} GROUP BY g.fecha, t.patente_camion, c.numero, c.modelo, c.estado_operativo
        ORDER BY g.fecha DESC, t.patente_camion`, params),
      pool.execute(truckExpensesSql, params),
    ]);
    // Compras y repuestos del período: lo que se pidió, por qué, quién aprobó y con qué comprobante.
    const [[compras], [repuestos], [combustible]] = await Promise.all([
      pool.execute(`SELECT c.id, c.id_tarea, COALESCE(t.patente_camion, 'Sin OT') AS patente_camion, COALESCE(t.tipo_tarea, CASE c.categoria WHEN 'herramienta' THEN 'Herramienta' WHEN 'insumo' THEN 'Insumo' WHEN 'repuesto' THEN 'Repuesto para bodega' ELSE 'Compra' END) AS tipo_tarea, c.detalle, c.proveedor, c.cantidad, c.monto, c.estado, c.excedente,
          DATE_FORMAT(c.created_at, '%Y-%m-%d') AS fecha, u.nombre AS creador, d.nombre AS decisor, c.nota_decision, c.ruta_archivo, c.ruta_comprobante, COALESCE(tr.motivo, c.motivo) AS motivo
        FROM cotizaciones c LEFT JOIN tareas t ON t.id = c.id_tarea LEFT JOIN usuarios u ON u.id = c.created_by LEFT JOIN usuarios d ON d.id = c.decided_by
        LEFT JOIN tarea_repuestos tr ON tr.id = c.id_tarea_repuesto
        ${params.length ? 'WHERE DATE(c.created_at) BETWEEN ? AND ?' : ''} ORDER BY c.created_at DESC`, params),
      pool.execute(`SELECT tr.id_tarea, t.patente_camion, t.tipo_tarea, t.fecha_creacion, COALESCE(r.nombre, tr.descripcion) AS repuesto, r.codigo, tr.cantidad, r.unidad, tr.estado, tr.motivo
        FROM tarea_repuestos tr JOIN tareas t ON t.id = tr.id_tarea LEFT JOIN repuestos r ON r.id = tr.id_repuesto
        ${params.length ? 'WHERE t.fecha_creacion BETWEEN ? AND ?' : ''} ORDER BY t.fecha_creacion DESC, tr.id_tarea, tr.id`, params),
      pool.execute(`SELECT DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha, c.patente, c.ruta, c.nivel, c.litros, c.nota, c.ruta_archivo, u.nombre AS registrado_por
        FROM combustible_registros c LEFT JOIN usuarios u ON u.id = c.created_by
        ${params.length ? 'WHERE c.fecha BETWEEN ? AND ?' : ''} ORDER BY c.fecha DESC, c.patente`, params),
    ]);
    await sendWorkbook(res, tareas, gastosPorDiaCamion, camiones, params[0], params[1], { compras, repuestos, combustible, publicUrl: config?.publicUrl || '' });
  });
  return router;
};
module.exports.taskReportSql = taskReportSql;
