const { Router } = require('express');
const { dateRange, today } = require('../validation');
const sendWorkbook = require('../services/workbook');
const { parseFilters, loadInventoryReport } = require('../services/inventoryReports');
const { createInventoryWorkbook } = require('../services/inventoryWorkbook');
const { createInventoryPdf } = require('../services/inventoryPdf');

// Aggregate each one-to-many relation before joining: mechanic count must not multiply expenses.
const taskReportSql = `SELECT t.id, t.tipo_tarea, t.patente_camion, t.fecha_creacion, t.fecha_limite, t.estado, c.modelo,
  m.mecanicos, COALESCE(g.total_gasto, 0) AS total_gasto
  FROM tareas t JOIN camiones c ON t.patente_camion = c.patente
  LEFT JOIN (SELECT tm.id_tarea, GROUP_CONCAT(u.nombre ORDER BY u.nombre SEPARATOR ', ') AS mecanicos
    FROM tarea_mecanicos tm JOIN usuarios u ON tm.id_mecanico = u.id GROUP BY tm.id_tarea) m ON m.id_tarea = t.id
  LEFT JOIN (SELECT id_tarea, SUM(monto) AS total_gasto FROM gastos GROUP BY id_tarea) g ON g.id_tarea = t.id`;

module.exports = function reports(pool, auth) {
  const router = Router();
  router.get('/kpis', auth.allow('jefe', 'admin', 'encargado'), async (req, res) => {
    const day = today(), month = day.slice(0, 8) + '01';
    const [[estadosTareas], [totals], [tareasMecanico], [gastosCamion], [flotaRows]] = await Promise.all([
      pool.execute('SELECT estado, COUNT(*) AS total FROM tareas GROUP BY estado'),
      pool.execute(`SELECT COALESCE(SUM(monto), 0) AS totalGastos,
        COALESCE(SUM(CASE WHEN fecha BETWEEN DATE_SUB(?, INTERVAL 6 DAY) AND ? THEN monto ELSE 0 END), 0) AS gastosSemana,
        COALESCE(SUM(CASE WHEN fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 MONTH) THEN monto ELSE 0 END), 0) AS gastosMes FROM gastos`, [day, day, month, month]),
      pool.execute(`SELECT u.id, u.nombre, COUNT(DISTINCT tm.id_tarea) AS total_asignadas,
        COUNT(DISTINCT CASE WHEN t.estado IN ('Completada', 'Aprobada') THEN t.id END) AS completadas
        FROM usuarios u LEFT JOIN tarea_mecanicos tm ON u.id = tm.id_mecanico
        LEFT JOIN tareas t ON tm.id_tarea = t.id WHERE u.rol = 'mecanico' GROUP BY u.id, u.nombre ORDER BY u.nombre`),
      pool.execute(`SELECT c.patente, c.numero, c.modelo, c.estado_operativo, COALESCE(g.total_gasto, 0) AS total_gasto
        FROM camiones c
        LEFT JOIN (SELECT t.patente_camion, SUM(g.monto) AS total_gasto FROM tareas t JOIN gastos g ON g.id_tarea = t.id GROUP BY t.patente_camion) g
          ON g.patente_camion = c.patente
        ORDER BY c.estado_operativo DESC, c.patente`),
      pool.execute(`SELECT COUNT(*) AS total,
        COALESCE(SUM(estado_operativo = 'activo'), 0) AS activos,
        COALESCE(SUM(estado_operativo = 'panne'), 0) AS enPanne FROM camiones`),
    ]);
    res.json({ success: true, estadosTareas, ...totals[0], tareasMecanico, gastosCamion, flota: flotaRows[0] });
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
    await sendWorkbook(res, tareas, gastosPorDiaCamion, camiones, ...params);
  });
  router.get('/inventario/reportes', auth.allow('jefe', 'admin', 'encargado'), async (req, res) => {
    const report = await loadInventoryReport(pool, parseFilters(req.query));
    res.json({ success: true, ...report });
  });
  router.get('/inventario/reportes/excel', auth.allow('jefe', 'admin', 'encargado'), async (req, res) => {
    const report = await loadInventoryReport(pool, parseFilters(req.query));
    const file = await createInventoryWorkbook(report, req.usuario.nombre);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="reporte_inventario.xlsx"',
    });
    res.send(Buffer.from(file));
  });
  router.get('/inventario/reportes/pdf', auth.allow('jefe', 'admin', 'encargado'), async (req, res) => {
    const report = await loadInventoryReport(pool, parseFilters(req.query));
    const file = await createInventoryPdf(report, req.usuario.nombre);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="reporte_inventario.pdf"',
    });
    res.send(file);
  });
  return router;
};
module.exports.taskReportSql = taskReportSql;
