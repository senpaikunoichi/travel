const { Router } = require('express');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { transaction } = require('../db');
const { id, today, HttpError } = require('../validation');
const { optimizeImage } = require('../services/images');
const { logEvent } = require('../services/events');
const videos = require('../services/videos');

function identify(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: '.png', mime: 'image/png' };
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { ext: '.jpg', mime: 'image/jpeg' };
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return { ext: '.gif', mime: 'image/gif' };
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  if (buffer.subarray(0, 5).toString() === '%PDF-') return { ext: '.pdf', mime: 'application/pdf' };
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return buffer.subarray(8, 10).toString('ascii') === 'qt' ? { ext: '.mov', mime: 'video/quicktime', video: true } : { ext: '.mp4', mime: 'video/mp4', video: true };
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x1A45DFA3) return { ext: '.webm', mime: 'video/webm', video: true };
  return null;
}

// Valida la firma real del archivo; las imágenes se optimizan, los videos y PDF se guardan tal cual.
async function prepareFile(file, config, { video = false, pdf = false, image = {} } = {}) {
  const format = identify(file.buffer);
  const declared = file.mimetype === format?.mime || (format?.video && file.mimetype.startsWith('video/'));
  if (!format || !declared || (format.video && !video) || (format.ext === '.pdf' && !pdf)) throw new HttpError(415, `Archivo inválido. Usa una imagen${pdf ? ', PDF' : ''}${video ? ' o un video MP4/MOV/WebM' : ''}.`);
  if (format.video && file.size > config.videoLimit) throw new HttpError(413, 'El video supera el tamaño permitido.');
  if (!format.video && file.size > config.uploadLimit) throw new HttpError(413, 'El archivo supera el tamaño permitido.');
  if (format.video || format.ext === '.pdf') return { buffer: file.buffer, ext: format.ext };
  try { return await optimizeImage(file.buffer, { ...config.image, ...image }); }
  catch { throw new HttpError(415, 'La imagen está dañada, excede las dimensiones permitidas o no se puede procesar.'); }
}
async function saveFile(stored, config) {
  const name = randomUUID() + stored.ext;
  await fs.writeFile(path.join(config.uploads, name), stored.buffer, { flag: 'wx' });
  return { name, ruta: `/uploads/${name}`, filename: path.join(config.uploads, name) };
}

module.exports = function files(pool, auth, config) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimit, files: 1, fields: 0, parts: 2 } });

  // Foto o video del «antes» (supervisor o mecánico) y del «después» (mecánico mientras trabaja).
  const media = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(config.uploadLimit, config.videoLimit || 0), files: 1, fields: 0, parts: 2 } });
  router.post('/api/evidencia/media/:id_tarea', async (req, res, next) => {
    req.taskId = id(req.params.id_tarea);
    req.moment = req.query.momento === 'antes' ? 'antes' : req.query.momento === 'despues' ? 'foto' : null;
    if (!req.moment) throw new HttpError(400, 'Indica si es del antes o del después.');
    const task = await auth.taskAccess(pool, req.usuario, req.taskId);
    const role = req.usuario.rol;
    const allowed = req.moment === 'antes'
      ? (['admin', 'encargado'].includes(role) && task.estado !== 'Aprobada') || (role === 'mecanico' && ['Pendiente', 'En_Trabajo'].includes(task.estado))
      : ['admin', 'mecanico'].includes(role) && task.estado === 'En_Trabajo';
    if (!allowed) throw new HttpError(409, 'No puedes agregar este archivo en el estado actual de la tarea.');
    // Sin el repuesto comprado no se puede terminar el trabajo (sí se puede seguir documentando el «antes»).
    if (req.moment === 'foto' && task.esperando_repuesto) throw new HttpError(409, 'Esperando repuesto: el supervisor aún no registra la compra. Podrás continuar cuando llegue.');
    next();
  }, media.single('archivo'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Selecciona un archivo.');
    const stored = await prepareFile(req.file, config, { video: true });
    const saved = await saveFile(stored, config);
    try {
      await pool.execute('INSERT INTO evidencia (id_tarea, ruta_archivo, tipo, fecha) VALUES (?, ?, ?, ?)', [req.taskId, saved.ruta, req.moment, today()]);
      await logEvent(pool, req.taskId, req.usuario, req.moment === 'antes' ? 'evidencia_antes' : 'evidencia_despues', `Subió ${stored.ext.match(/mp4|mov|webm/) ? 'un video' : 'una foto'} del ${req.moment === 'antes' ? 'antes' : 'después'}.`);
      if (/\.(mp4|mov|webm)$/.test(stored.ext)) videos.enqueue(pool, config.uploads, saved.ruta);
    } catch (error) { await fs.unlink(saved.filename).catch(() => {}); throw error; }
    res.status(201).json({ success: true, mensaje: req.moment === 'antes' ? 'Archivo del antes guardado.' : 'Archivo del después guardado.' });
  });

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

  // RUTA PARA VER ARCHIVOS
  router.get('/uploads/:filename', async (req, res, next) => {
    const name = req.params.filename;
    if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|pdf|mp4|mov|webm)$/i.test(name)) throw new HttpError(404, 'Archivo no encontrado.');
    const [rows] = await pool.execute(
      `SELECT 'tarea' AS origen, id_tarea AS referencia FROM evidencia WHERE ruta_archivo = ?
       UNION ALL SELECT IF(id_tarea IS NULL, 'compra', 'tarea') AS origen, id_tarea AS referencia FROM cotizaciones WHERE ruta_archivo = ? OR ruta_comprobante = ? OR ruta_foto_compra = ?
       UNION ALL SELECT 'inspeccion' AS origen, id_inspeccion AS referencia FROM inspeccion_fotos WHERE ruta_archivo = ?
       UNION ALL SELECT 'inspeccion' AS origen, id_inspeccion AS referencia FROM inspeccion_danos WHERE ruta_archivo = ?
       UNION ALL SELECT 'combustible' AS origen, id AS referencia FROM combustible_registros WHERE ruta_archivo = ?
       UNION ALL SELECT 'inventario' AS origen, id AS referencia FROM inventario_revision WHERE ruta_archivo = ? LIMIT 1`,
      Array(8).fill(`/uploads/${name}`),
    );
    if (!rows.length) throw new HttpError(404, 'Archivo no encontrado.');
    if (rows[0].origen === 'tarea') {
      await auth.taskAccess(pool, req.usuario, rows[0].referencia);
      // Cotizaciones y comprobantes muestran precios: el mecánico no los abre.
      if (req.usuario.rol === 'mecanico') {
        const [[money]] = await pool.execute('SELECT id FROM cotizaciones WHERE ruta_archivo = ? OR ruta_comprobante = ? LIMIT 1', [`/uploads/${name}`, `/uploads/${name}`]);
        if (money) throw new HttpError(403, 'No puedes ver este documento.');
      }
    }
    else if (rows[0].origen === 'compra') { if (!['admin', 'encargado', 'jefe'].includes(req.usuario.rol)) throw new HttpError(403, 'No puedes ver este documento.'); }
    else if (rows[0].origen === 'combustible' || rows[0].origen === 'inventario') { if (!['admin', 'encargado', 'jefe'].includes(req.usuario.rol)) throw new HttpError(403, 'No puedes ver este registro.'); }
    else if (req.usuario.rol !== 'encargado') throw new HttpError(403, 'No puedes consultar esta inspección.');
    const isPdf = name.toLowerCase().endsWith('.pdf');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', `${isPdf ? 'attachment' : 'inline'}; filename="${name}"`);
    res.sendFile(name, { root: config.uploads, dotfiles: 'deny' }, error => { if (error) next(error); });
  });

  // RUTA PARA VER EVIDENCIAS
  // Borrar una foto o video del antes o del después mientras la OT sigue abierta (por ejemplo, una foto mal tomada).
  router.delete('/api/evidencia/:id', async (req, res) => {
    const evidenceId = id(req.params.id);
    const [[item]] = await pool.execute('SELECT id, id_tarea, ruta_archivo, tipo FROM evidencia WHERE id = ?', [evidenceId]);
    if (!item) throw new HttpError(404, 'La foto o el video ya no existe.');
    const task = await auth.taskAccess(pool, req.usuario, item.id_tarea);
    const role = req.usuario.rol;
    const allowed = item.tipo === 'foto'
      ? ['admin', 'mecanico'].includes(role) && task.estado === 'En_Trabajo'
      : item.tipo === 'antes'
        ? (['admin', 'encargado'].includes(role) && task.estado !== 'Aprobada') || (role === 'mecanico' && ['Pendiente', 'En_Trabajo'].includes(task.estado))
        : false;
    if (!allowed) throw new HttpError(403, item.tipo === 'foto' || item.tipo === 'antes' ? 'En este estado de la OT ya no se puede borrar.' : 'Esta evidencia no se puede borrar.');
    await pool.execute('DELETE FROM evidencia WHERE id = ?', [evidenceId]);
    await fs.unlink(path.join(config.uploads, path.basename(item.ruta_archivo))).catch(() => {});
    await logEvent(pool, item.id_tarea, req.usuario, 'evidencia_borrada', `Borró ${/\.(mp4|mov|webm)$/i.test(item.ruta_archivo) ? 'un video' : 'una foto'} del ${item.tipo === 'antes' ? 'antes' : 'después'}.`);
    res.json({ success: true, mensaje: 'Archivo borrado.' });
  });
  router.get('/api/evidencia/:id_tarea', async (req, res) => {
    const taskId = id(req.params.id_tarea);
    await auth.taskAccess(pool, req.usuario, taskId);
    const [evidencias] = await pool.execute('SELECT id, id_tarea, ruta_archivo, tipo, fecha, id_tarea_repuesto, id_cotizacion FROM evidencia WHERE id_tarea = ? ORDER BY id', [taskId]);
    res.json({ success: true, evidencias });
  });

  return router;
};
module.exports.identify = identify;
module.exports.prepareFile = prepareFile;
module.exports.saveFile = saveFile;
