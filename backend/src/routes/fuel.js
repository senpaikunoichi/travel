const { Router } = require('express');
const multer = require('multer');
const fs = require('node:fs/promises');
const v = require('../validation');
const { prepareFile, saveFile } = require('./files');
const { dailyReport, truckReport } = require('../services/fuelReport');
const { checkDue } = require('../services/km');

// Nivel del estanque en porcentaje: reserva, 1/4, 1/2, 3/4 y lleno.
const LEVELS = [10, 25, 50, 75, 100];

// Combustible con que llega cada camión: lo registra el supervisor por patente, ruta y día, con foto y nota.
module.exports = function fuel(pool, auth, config) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimit, files: 1, fields: 8, parts: 10 } });
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

  router.post('/combustible', auth.allow('admin', 'encargado'), upload.single('foto'), async (req, res) => {
    const b = req.body;
    const patente = v.text(b.patente, 'Patente', 10), ruta = v.text(b.ruta, 'Ruta', 150), nota = v.text(b.nota, 'Nota', 1000);
    const nivel = Number(b.nivel);
    if (!LEVELS.includes(nivel)) throw new v.HttpError(400, 'Elige el nivel de combustible.');
    const litros = b.litros ? Number(String(b.litros).replace(',', '.')) : null;
    if (litros !== null && !(litros >= 0 && litros <= 2000)) throw new v.HttpError(400, 'Litros inválidos.');
    const fecha = b.fecha ? v.date(b.fecha) : v.today();
    if (fecha > v.today()) throw new v.HttpError(400, 'La fecha no puede ser futura.');
    if (!req.file) throw new v.HttpError(400, 'Saca la foto del indicador de combustible.');
    const odometro = b.odometro ? v.km(b.odometro) : null;
    const [[truck]] = await pool.execute('SELECT patente, km_actual FROM camiones WHERE patente = ?', [patente]);
    if (!truck) throw new v.HttpError(400, 'El camión no existe.');
    if (odometro != null && truck.km_actual && Math.abs(odometro - truck.km_actual) > 3000) throw new v.HttpError(400, `Revisa el odómetro: el sistema tiene ${Number(truck.km_actual).toLocaleString('es-CL')} km para ${truck.patente}.`);
    const saved = await saveFile(await prepareFile(req.file, config), config);
    try {
      await pool.execute('INSERT INTO combustible_registros (patente, fecha, ruta, nivel, litros, nota, ruta_archivo, created_by, odometro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [truck.patente, fecha, ruta, nivel, litros, nota, saved.ruta, req.usuario.id, odometro]);
    } catch (error) { await fs.unlink(saved.filename).catch(() => {}); throw error; }
    // El odómetro de hoy (visto en el tablero) pasa a ser la lectura base del camión, igual que un ajuste manual.
    if (odometro != null && fecha === v.today()) {
      await pool.execute('UPDATE camiones SET km_actual = ?, km_base = ?, km_base_fecha = ?, km_base_at = UTC_TIMESTAMP(), km_manual = TRUE, km_actualizado_at = UTC_TIMESTAMP() WHERE patente = ?', [odometro, odometro, fecha, truck.patente]);
      await checkDue(pool);
    }
    res.status(201).json({ success: true, mensaje: `Combustible de ${truck.patente} registrado${odometro != null && fecha === v.today() ? ` · odómetro ${odometro.toLocaleString('es-CL')} km` : ''}.` });
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
