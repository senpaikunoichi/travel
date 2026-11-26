const { Router } = require('express');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { transaction } = require('../db');
const { id, today, date, amount, HttpError } = require('../validation');
const { analizarFactura } = require('../services/gemini');
const { optimizeImage } = require('../services/images');

function identify(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: '.png', mime: 'image/png' };
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { ext: '.jpg', mime: 'image/jpeg' };
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return { ext: '.gif', mime: 'image/gif' };
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  if (buffer.subarray(0, 5).toString() === '%PDF-') return { ext: '.pdf', mime: 'application/pdf' };
  return null;
}

module.exports = function files(pool, auth, config) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimit, files: 1, fields: 0, parts: 2 } });
  const uploadMultiple = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimit, files: 10, fields: 0, parts: 11 } });

  // RUTA FOTO (una sola)
  router.post('/api/evidencia/subir/:id_tarea', auth.allow('mecanico', 'admin'), async (req, res, next) => {
    req.taskId = id(req.params.id_tarea);
    const task = await auth.taskAccess(pool, req.usuario, req.taskId);
    if (task.estado !== 'En_Trabajo') throw new HttpError(409, 'La tarea no permite agregar este archivo en su estado actual.');
    next();
  }, upload.single('foto'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Selecciona un archivo.');
    const format = identify(req.file.buffer);
    if (!format || format.ext === '.pdf' || req.file.mimetype !== format.mime) throw new HttpError(415, 'Archivo inválido. Usa PNG, JPEG, GIF o WebP.');
    let optimized;
    try { optimized = await optimizeImage(req.file.buffer, config.image); }
    catch { throw new HttpError(415, 'La imagen está dañada, excede las dimensiones permitidas o no se puede procesar.'); }
    const name = randomUUID() + optimized.ext;
    const filename = path.join(config.uploads, name);
    let written = false;
    try {
      await transaction(pool, async db => {
        const task = await auth.taskAccess(db, req.usuario, req.taskId, true);
        if (task.estado !== 'En_Trabajo') throw new HttpError(409, 'El estado de la tarea cambió durante la carga.');
        await fs.writeFile(filename, optimized.buffer, { flag: 'wx' });
        written = true;
        await db.execute('INSERT INTO evidencia (id_tarea, ruta_archivo, tipo, fecha) VALUES (?, ?, ?, ?)', [req.taskId, `/uploads/${name}`, 'foto', today()]);
      });
    } catch (error) {
      if (written) await fs.unlink(filename).catch(() => {});
      throw error;
    }
    res.status(201).json({ success: true, mensaje: 'Archivo registrado.' });
  });

  // RUTA FACTURA (múltiples archivos + análisis Gemini)
  router.post('/api/evidencia/factura/:id_tarea', auth.allow('encargado', 'admin'), async (req, res, next) => {
    req.taskId = id(req.params.id_tarea);
    const task = await auth.taskAccess(pool, req.usuario, req.taskId);
    if (task.estado !== 'Completada') throw new HttpError(409, 'La tarea no permite agregar este archivo en su estado actual.');
    next();
  }, uploadMultiple.array('factura', 10), async (req, res) => {
    if (!req.files?.length) throw new HttpError(400, 'Selecciona al menos un archivo.');
    const formats = req.files.map(f => {
      const format = identify(f.buffer);
      if (!format || f.mimetype !== format.mime) throw new HttpError(415, 'Archivo inválido. Usa PNG, JPEG, GIF, WebP o PDF.');
      return { file: f, format, stored: format.ext === '.pdf' ? { buffer: f.buffer, ...format } : null };
    });
    for (const entry of formats) {
      try {
        if (!entry.stored) entry.stored = await optimizeImage(entry.file.buffer, config.image);
        const analysis = await analizarFactura(entry.stored.buffer, entry.stored.mime);
        if (analysis?.total && analysis.total > 0) {
          const invoiceDate = date(analysis.fecha || today());
          entry.expense = { date: invoiceDate, total: amount(analysis.total) };
        }
      } catch (error) {
        if (!entry.stored) throw new HttpError(415, 'Una imagen está dañada, excede las dimensiones permitidas o no se puede procesar.');
        console.error('Error al analizar factura con Gemini:', error.name || 'AnalysisError');
      }
    }
    const written = [];
    try {
      await transaction(pool, async db => {
        const task = await auth.taskAccess(db, req.usuario, req.taskId, true);
        if (task.estado !== 'Completada') throw new HttpError(409, 'El estado de la tarea cambió durante la carga.');
        for (const { stored, expense } of formats) {
          const name = randomUUID() + stored.ext;
          const filename = path.join(config.uploads, name);
          await fs.writeFile(filename, stored.buffer, { flag: 'wx' });
          written.push(filename);
          await db.execute('INSERT INTO evidencia (id_tarea, ruta_archivo, tipo, fecha) VALUES (?, ?, ?, ?)', [req.taskId, `/uploads/${name}`, 'factura', today()]);

          if (expense) {
            await db.execute(
              'INSERT INTO gastos (id_tarea, concepto, monto, tipo, fecha) VALUES (?, ?, ?, ?, ?)',
              [req.taskId, `Factura - ${expense.date}`, expense.total, 'factura', expense.date]
            );
          }
        }
      });
    } catch (error) {
      for (const f of written) await fs.unlink(f).catch(() => {});
      throw error;
    }
    const missing = formats.filter(entry => !entry.expense).length;
    res.status(201).json({ success: true, montos_faltantes: missing, mensaje: missing ? `${req.files.length} archivo(s) registrado(s). No se detectó el monto en ${missing}; ingrésalo manualmente.` : `${req.files.length} archivo(s) registrado(s) con su monto.` });
  });

  // RUTA PARA VER ARCHIVOS
  router.get('/uploads/:filename', async (req, res, next) => {
    const name = req.params.filename;
    if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|pdf)$/i.test(name)) throw new HttpError(404, 'Archivo no encontrado.');
    const [rows] = await pool.execute(
      `SELECT 'tarea' AS origen, id_tarea AS referencia FROM evidencia WHERE ruta_archivo = ?
       UNION ALL SELECT 'inspeccion' AS origen, id_inspeccion AS referencia FROM inspeccion_fotos WHERE ruta_archivo = ?
       UNION ALL SELECT 'inventario' AS origen, id AS referencia FROM repuestos WHERE foto_url = ?
       UNION ALL SELECT 'inventario' AS origen, id AS referencia FROM solicitudes_compra WHERE foto_comprobante_url = ? LIMIT 1`,
      [`/uploads/${name}`, `/uploads/${name}`, `/uploads/${name}`, `/uploads/${name}`],
    );
    if (!rows.length) throw new HttpError(404, 'Archivo no encontrado.');
    if (rows[0].origen === 'tarea') await auth.taskAccess(pool, req.usuario, rows[0].referencia);
    else if (rows[0].origen === 'inspeccion' && req.usuario.rol !== 'encargado') throw new HttpError(403, 'No puedes consultar esta inspección.');
    else if (rows[0].origen === 'inventario' && !['admin', 'jefe', 'encargado'].includes(req.usuario.rol)) throw new HttpError(403, 'No tienes permisos para consultar este archivo.');
    const isPdf = name.toLowerCase().endsWith('.pdf');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', `${isPdf ? 'attachment' : 'inline'}; filename="${name}"`);
    res.sendFile(name, { root: config.uploads, dotfiles: 'deny' }, error => { if (error) next(error); });
  });

  // RUTA PARA VER EVIDENCIAS
  router.get('/api/evidencia/:id_tarea', async (req, res) => {
    const taskId = id(req.params.id_tarea);
    await auth.taskAccess(pool, req.usuario, taskId);
    const [evidencias] = await pool.execute('SELECT id, id_tarea, ruta_archivo, tipo, fecha FROM evidencia WHERE id_tarea = ? ORDER BY id', [taskId]);
    res.json({ success: true, evidencias });
  });

  return router;
};
module.exports.identify = identify;
