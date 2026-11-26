const { Router } = require('express');
const multer = require('multer');
const fs = require('node:fs/promises');
const path = require('node:path');
const v = require('../validation');
const { prepareFile, saveFile } = require('./files');

// Revisión semanal del inventario (lunes a domingo): cada ítem con stock se cuenta y se fotografía una vez por semana (por ejemplo, las 5 llaves).
// Si se cuenta menos de lo que dice el sistema, se anota qué pasó y queda «por aclarar» hasta que alguien lo cierre.
// El stock no se modifica: el ajuste se hace a mano en el inventario si corresponde.
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monday = day => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

module.exports = function inventoryCheck(pool, auth, config) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimit, files: 1, fields: 6, parts: 8 } });
  const office = auth.allow('admin', 'encargado', 'jefe');
  const columns = `r.id, DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha, r.id_repuesto, r.nombre, r.unidad, r.esperado, r.contado, r.nota, r.ruta_archivo, r.created_at,
    u.nombre AS revisado_por, r.aclarado, r.aclaracion, r.aclarado_at, a.nombre AS aclarado_por`;
  const from = 'FROM inventario_revision r LEFT JOIN usuarios u ON u.id = r.created_by LEFT JOIN usuarios a ON a.id = r.aclarado_por';

  router.get('/inventario/revision', office, async (req, res) => {
    const hoy = v.today(), actual = monday(hoy);
    const semana = req.query.semana ? monday(v.date(req.query.semana)) : actual, fin = addDays(semana, 6);
    const [[repuestos], [revisados], [faltantes], [historial]] = await Promise.all([
      // Se revisa lo que tiene stock; si ese día ya se contó un ítem que hoy quedó en cero, también aparece.
      pool.execute('SELECT id, nombre, unidad, stock FROM repuestos WHERE stock > 0 ORDER BY nombre'),
      pool.execute(`SELECT ${columns} ${from} WHERE r.fecha BETWEEN ? AND ? ORDER BY r.nombre, r.fecha`, [semana, fin]),
      pool.execute(`SELECT ${columns} ${from} WHERE r.contado < r.esperado AND NOT r.aclarado ORDER BY r.fecha DESC, r.nombre LIMIT 200`),
      pool.execute(`SELECT DATE_FORMAT(DATE_SUB(r.fecha, INTERVAL WEEKDAY(r.fecha) DAY), '%Y-%m-%d') AS semana, COUNT(*) AS revisados, SUM(r.contado < r.esperado) AS faltantes, GROUP_CONCAT(DISTINCT u.nombre SEPARATOR ', ') AS revisado_por
        FROM inventario_revision r LEFT JOIN usuarios u ON u.id = r.created_by WHERE r.fecha >= DATE_SUB(?, INTERVAL 12 WEEK) GROUP BY semana ORDER BY semana DESC`, [actual]),
    ]);
    const done = new Map(revisados.map(r => [r.id_repuesto, r]));
    const current = semana === actual;
    const items = (current ? repuestos : [])
      .map(p => ({ id_repuesto: p.id, nombre: p.nombre, unidad: p.unidad, stock: p.stock, revision: done.get(p.id) || null }))
      .concat([...done.values()].filter(r => !current || !repuestos.some(p => p.id === r.id_repuesto)).map(r => ({ id_repuesto: r.id_repuesto, nombre: r.nombre, unidad: r.unidad, stock: r.esperado, revision: r })));
    res.json({ success: true, hoy, semana, fin, actual, items, faltantes, historial });
  });

  // Conteo de un ítem: cantidad contada, foto obligatoria y nota obligatoria si falta algo. Repetirlo en la misma semana reemplaza el anterior.
  router.post('/inventario/revision', auth.allow('admin', 'encargado'), upload.single('foto'), async (req, res) => {
    const id = v.id(req.body.id_repuesto);
    if (req.body.contado === undefined || req.body.contado === '') throw new v.HttpError(400, 'Escribe cuántos contaste.');
    const contado = Number(v.stock(req.body.contado));
    const nota = req.body.nota ? v.text(req.body.nota, 'Nota', 1000) : null;
    if (!req.file) throw new v.HttpError(400, 'Saca la foto de lo que contaste.');
    const [[part]] = await pool.execute('SELECT id, nombre, unidad, stock FROM repuestos WHERE id = ?', [id]);
    if (!part) throw new v.HttpError(404, 'El repuesto no existe.');
    const esperado = Number(part.stock), hoy = v.today();
    if (contado < esperado && !nota) throw new v.HttpError(400, `Faltan ${+(esperado - contado).toFixed(2)}: anota qué pasó.`);
    // Es semanal y son muchos ítems: la foto se guarda más liviana (1280 px, calidad 60, ~60 KB) y sigue siendo legible.
    const saved = await saveFile(await prepareFile(req.file, config, { image: { maxDimension: Math.min(1280, config.image.maxDimension), quality: Math.min(60, config.image.quality) } }), config);
    let previous = null;
    try {
      [[previous]] = await pool.execute('SELECT id, ruta_archivo FROM inventario_revision WHERE fecha BETWEEN ? AND ? AND id_repuesto = ? ORDER BY fecha DESC LIMIT 1', [monday(hoy), addDays(monday(hoy), 6), id]);
      // Un conteo por semana: si ya se contó otro día de esta semana, ese registro pasa a hoy con los datos nuevos.
      if (previous) await pool.execute('UPDATE inventario_revision SET fecha = ? WHERE id = ?', [hoy, previous.id]);
      await pool.execute(`INSERT INTO inventario_revision (fecha, id_repuesto, nombre, unidad, esperado, contado, nota, ruta_archivo, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE esperado = VALUES(esperado), contado = VALUES(contado), nota = VALUES(nota), ruta_archivo = VALUES(ruta_archivo), created_by = VALUES(created_by),
          created_at = CURRENT_TIMESTAMP, aclarado = FALSE, aclaracion = NULL, aclarado_por = NULL, aclarado_at = NULL`,
      [hoy, id, part.nombre, part.unidad, esperado, contado, nota, saved.ruta, req.usuario.id]);
    } catch (error) { await fs.unlink(saved.filename).catch(() => {}); throw error; }
    if (previous) await fs.unlink(path.join(config.uploads, path.basename(previous.ruta_archivo))).catch(() => {});
    const diff = +(esperado - contado).toFixed(2);
    res.status(201).json({ success: true, mensaje: diff > 0 ? `${part.nombre}: faltan ${diff}. Quedó por aclarar.` : `${part.nombre}: revisado, está completo.` });
  });

  // Cerrar un faltante a mano: qué pasó finalmente (apareció, se repone, se descuenta, responsable…).
  router.put('/inventario/revision/:id/aclarar', office, async (req, res) => {
    const id = v.id(req.params.id), aclaracion = v.text(req.body.aclaracion, 'Qué pasó', 1000);
    const [result] = await pool.execute('UPDATE inventario_revision SET aclarado = TRUE, aclaracion = ?, aclarado_por = ?, aclarado_at = UTC_TIMESTAMP() WHERE id = ? AND contado < esperado', [aclaracion, req.usuario.id, id]);
    v.affected(result);
    res.json({ success: true, mensaje: 'Faltante aclarado.' });
  });
  return router;
};
