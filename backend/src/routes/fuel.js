const { Router } = require('express');
const fs = require('node:fs/promises');
const v = require('../validation');
const { dailyReport, truckReport } = require('../services/fuelReport');

// Nivel del estanque en porcentaje: reserva, 1/4, 1/2, 3/4 y lleno.
const LEVELS = [10, 25, 50, 75, 100];

// Combustible con que llega cada camión: lo registra solo el conductor al terminar la ruta en TTS (ver services/ttsCierres.js).
module.exports = function fuel(pool, auth, config) {
  const router = Router();
  const office = auth.allow('admin', 'encargado', 'jefe');

  router.get('/combustible', office, async (req, res) => {
    const where = [], params = [];
    if (req.query.desde || req.query.hasta) {
      const [desde, hasta] = v.dateRange({ fecha_inicio: req.query.desde, fecha_fin: req.query.hasta });
      where.push('c.fecha BETWEEN ? AND ?'); params.push(desde, hasta);
    } else { where.push('c.fecha > DATE_SUB(?, INTERVAL 31 DAY)'); params.push(v.today()); }
    if (req.query.patente) { where.push('c.patente = ?'); params.push(v.text(req.query.patente, 'Patente', 10)); }
    const [registros] = await pool.execute(`SELECT c.id, c.patente, DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha, c.ruta, c.nivel, c.litros, c.odometro, c.nota, c.ruta_archivo, c.created_at, c.conductor, c.problema, COALESCE(u.nombre, CONCAT(c.conductor, ' (conductor)')) AS registrado_por
      FROM combustible_registros c LEFT JOIN usuarios u ON u.id = c.created_by WHERE ${where.join(' AND ')} ORDER BY c.fecha DESC, c.id DESC LIMIT 2000`, params);
    res.json({ success: true, hoy: v.today(), registros });
  });

  // Informe en PDF: del día (?fecha=) o de un camión en un período (?patente=&desde=&hasta=, por defecto 30 días).
  router.get('/combustible/informe', office, async (req, res) => {
    const select = `SELECT c.patente, DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha, c.ruta, c.nivel, c.litros, c.odometro, c.nota, c.ruta_archivo, c.created_at, c.conductor, c.problema, COALESCE(u.nombre, CONCAT(c.conductor, ' (conductor)')) AS registrado_por
      FROM combustible_registros c LEFT JOIN usuarios u ON u.id = c.created_by`;
    if (req.query.patente) {
      const patente = v.text(req.query.patente, 'Patente', 10);
      const [[camion]] = await pool.execute('SELECT patente, numero, modelo FROM camiones WHERE patente = ?', [patente]);
      if (!camion) throw new v.HttpError(404, 'El camión no existe.');
      const hasta = req.query.hasta ? v.date(req.query.hasta) : v.today();
      const desde = req.query.desde ? v.date(req.query.desde) : new Date(Date.parse(`${hasta}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
      if (desde > hasta) throw new v.HttpError(400, 'El inicio del período debe ser anterior al final.');
      if (Date.parse(hasta) - Date.parse(desde) > 366 * 86400000) throw new v.HttpError(400, 'El informe por camión cubre hasta un año.');
      const [registros] = await pool.execute(`${select} WHERE c.patente = ? AND c.fecha BETWEEN ? AND ? ORDER BY c.fecha, c.id`, [patente, desde, hasta]);
      return truckReport(res, { patente: camion.patente, camion, desde, hasta, registros, uploads: config.uploads });
    }
    const fecha = req.query.fecha ? v.date(req.query.fecha) : v.today();
    const [[registros], [camiones]] = await Promise.all([
      pool.execute(`${select} WHERE c.fecha = ? ORDER BY c.patente, c.id`, [fecha]),
      pool.execute('SELECT patente FROM camiones ORDER BY patente'),
    ]);
    return dailyReport(res, { fecha, registros, camiones, uploads: config.uploads });
  });

  // Corregir un registro equivocado: solo el administrador lo borra.
  router.delete('/combustible/:id', auth.allow('admin'), async (req, res) => {
    const id = v.id(req.params.id);
    const [[row]] = await pool.execute('SELECT ruta_archivo FROM combustible_registros WHERE id = ?', [id]);
    if (!row) throw new v.HttpError(404, 'Registro no encontrado.');
    await pool.execute('DELETE FROM combustible_registros WHERE id = ?', [id]);
    await fs.unlink(`${config.uploads}/${row.ruta_archivo.split('/').pop()}`).catch(() => {});
    res.json({ success: true, mensaje: 'Registro eliminado.' });
  });
  return router;
};
module.exports.LEVELS = LEVELS;
