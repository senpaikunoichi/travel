const { Router } = require('express');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { transaction } = require('../db');
const v = require('../validation');
const { identify } = require('./files');
const { analizarDanosCamion } = require('../services/gemini');
const { optimizeImage } = require('../services/images');

const SIDES = ['frente', 'posterior', 'izquierdo', 'derecho'];
const DAMAGE_TYPES = ['rayon', 'abolladura', 'quebrado', 'falta_pieza', 'otro'];
const MAX_DAMAGES = 10;

// Daños marcados en el plano: vista, posición (% dentro del dibujo), tipo, nota y foto de cerca opcional (dano_<n>).
function parseDamages(raw) {
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch { throw new v.HttpError(400, 'Los daños marcados no son válidos.'); }
  if (!Array.isArray(list) || list.length > MAX_DAMAGES) throw new v.HttpError(400, `Marca hasta ${MAX_DAMAGES} daños por inspección.`);
  return list.map((d, i) => {
    const x = Number(d?.x), y = Number(d?.y);
    if (!SIDES.includes(d?.vista) || !(x >= 0 && x <= 100) || !(y >= 0 && y <= 100)) throw new v.HttpError(400, `El daño ${i + 1} no tiene una ubicación válida.`);
    if (!DAMAGE_TYPES.includes(d.tipo)) throw new v.HttpError(400, `Elige el tipo del daño ${i + 1}.`);
    return { vista: d.vista, x: x.toFixed(2), y: y.toFixed(2), tipo: d.tipo, nota: d.nota ? v.text(d.nota, 'Nota del daño', 300) : null, foto: Number.isInteger(d.foto) ? d.foto : null };
  });
}

module.exports = function inspections(pool, auth, config) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimit, files: 4 + MAX_DAMAGES, fields: 4, parts: 4 + MAX_DAMAGES + 6 } })
    .fields([...SIDES.map(name => ({ name, maxCount: 1 })), ...Array.from({ length: MAX_DAMAGES }, (_, i) => ({ name: `dano_${i}`, maxCount: 1 }))]);

  router.get('/inspecciones-camion', auth.allow('encargado'), async (req, res) => {
    const values = [];
    let where = '';
    if (req.query.patente) {
      where = 'WHERE i.patente_camion = ?';
      values.push(v.text(req.query.patente, 'Patente', 10).toUpperCase());
    }
    const [rows] = await pool.execute(
      `SELECT i.id, i.patente_camion, i.fecha, i.created_at, i.ruta, i.id_inspeccion_anterior, i.estado_analisis,
              i.nivel_dano, i.hay_diferencias, i.resumen, i.hallazgos_json,
              u.nombre AS encargado, f.lado, f.ruta_archivo
       FROM inspecciones_camion i
       JOIN usuarios u ON u.id = i.id_encargado
       JOIN inspeccion_fotos f ON f.id_inspeccion = i.id
       ${where}
       ORDER BY i.fecha DESC, i.id DESC, FIELD(f.lado, 'frente','posterior','izquierdo','derecho')`,
      values,
    );
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.id)) {
        let hallazgos = row.hallazgos_json || [];
        if (typeof hallazgos === 'string') {
          try { hallazgos = JSON.parse(hallazgos); } catch { hallazgos = []; }
        }
        grouped.set(row.id, {
          id: row.id, patente_camion: row.patente_camion, fecha: row.fecha, created_at: row.created_at, ruta: row.ruta,
          id_inspeccion_anterior: row.id_inspeccion_anterior, estado_analisis: row.estado_analisis,
          nivel_dano: row.nivel_dano, hay_diferencias: Boolean(row.hay_diferencias),
          resumen: row.resumen, hallazgos, encargado: row.encargado, fotos: {},
        });
      }
      grouped.get(row.id).fotos[row.lado] = row.ruta_archivo;
    }
    const ids = [...grouped.keys()];
    if (ids.length) {
      const [danos] = await pool.query('SELECT id, id_inspeccion, vista, x, y, tipo, nota, ruta_archivo FROM inspeccion_danos WHERE id_inspeccion IN (?) ORDER BY id', [ids]);
      for (const d of danos) (grouped.get(d.id_inspeccion).danos ||= []).push({ ...d, x: Number(d.x), y: Number(d.y) });
    }
    res.json({ success: true, inspecciones: [...grouped.values()].map(i => ({ ...i, danos: i.danos || [] })) });
  });

  router.post('/inspecciones-camion', auth.allow('encargado'), upload, async (req, res) => {
    const patente = v.text(req.body?.patente, 'Patente', 10).toUpperCase();
    const ruta = v.text(req.body?.ruta, 'Ruta', 150, true);
    const fecha = v.today();
    const damages = parseDamages(req.body?.danos);
    const closeUps = {};
    for (const [i, d] of damages.entries()) {
      const file = d.foto === null ? null : req.files?.[`dano_${d.foto}`]?.[0];
      if (d.foto !== null && !file) throw new v.HttpError(400, `Falta la foto del daño ${i + 1}.`);
      if (!file) continue;
      const format = identify(file.buffer);
      if (!format || format.ext === '.pdf' || file.mimetype !== format.mime) throw new v.HttpError(415, `La foto del daño ${i + 1} no es una imagen válida.`);
      try { closeUps[i] = await optimizeImage(file.buffer, config.image); }
      catch { throw new v.HttpError(415, `La foto del daño ${i + 1} no se puede procesar.`); }
    }
    const images = {};
    for (const side of SIDES) {
      const file = req.files?.[side]?.[0];
      if (!file) throw new v.HttpError(400, `Falta la foto del lado ${side}.`);
      const format = identify(file.buffer);
      if (!format || format.ext === '.pdf' || file.mimetype !== format.mime) throw new v.HttpError(415, 'Las cuatro fotos deben ser PNG, JPEG, GIF o WebP válidos.');
      try { images[side] = await optimizeImage(file.buffer, config.image); }
      catch { throw new v.HttpError(415, `La foto del lado ${side} está dañada, es demasiado grande o no se puede procesar.`); }
    }
    const [[truck]] = await pool.execute('SELECT patente FROM camiones WHERE patente = ?', [patente]);
    if (!truck) throw new v.HttpError(400, 'El camión no existe.');
    if (!config.allowMultipleDailyInspections) {
      const [[duplicate]] = await pool.execute('SELECT id FROM inspecciones_camion WHERE patente_camion = ? AND fecha = ?', [patente, fecha]);
      if (duplicate) throw new v.HttpError(409, 'Este camión ya tiene registrada su inspección de hoy.');
    }
    const testBaseline = config.allowMultipleDailyInspections;
    const [previousRows] = await pool.execute(
      `SELECT i.id, f.lado, f.ruta_archivo, f.mime_type
       FROM inspecciones_camion i JOIN inspeccion_fotos f ON f.id_inspeccion = i.id
       WHERE i.id = (SELECT id FROM inspecciones_camion WHERE patente_camion = ? ${testBaseline ? 'AND fecha = ? ORDER BY id ASC' : 'ORDER BY fecha DESC, id DESC'} LIMIT 1)`,
      testBaseline ? [patente, fecha] : [patente],
    );
    const previousId = previousRows[0]?.id || null;
    let analysis = { hay_diferencias: false, nivel: 'sin_cambios', resumen: 'Primera inspección registrada como línea base.', hallazgos: [] };
    let analysisState = 'linea_base';
    if (previousId && previousRows.length === 4) {
      try {
        const previous = {};
        for (const photo of previousRows) previous[photo.lado] = { buffer: await fs.readFile(path.join(config.uploads, path.basename(photo.ruta_archivo))), mime: photo.mime_type };
        analysis = await analizarDanosCamion(previous, images);
        analysisState = 'analizado';
      } catch {
        analysis = { hay_diferencias: false, nivel: 'inconcluso', resumen: 'Las fotos quedaron guardadas, pero la IA no pudo completar la comparación. Requiere revisión manual.', hallazgos: [] };
        analysisState = 'error';
      }
    }
    const written = [];
    let inspectionId;
    try {
      inspectionId = await transaction(pool, async db => {
        const [result] = await db.execute(
          `INSERT INTO inspecciones_camion
           (patente_camion, fecha, ruta, id_encargado, id_inspeccion_anterior, estado_analisis, nivel_dano, hay_diferencias, resumen, hallazgos_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [patente, fecha, ruta || null, req.usuario.id, previousId, analysisState, analysis.nivel, analysis.hay_diferencias, analysis.resumen, JSON.stringify(analysis.hallazgos)],
        );
        for (const side of SIDES) {
          const name = randomUUID() + images[side].ext;
          const filename = path.join(config.uploads, name);
          await fs.writeFile(filename, images[side].buffer, { flag: 'wx' });
          written.push(filename);
          await db.execute('INSERT INTO inspeccion_fotos (id_inspeccion, lado, ruta_archivo, mime_type) VALUES (?, ?, ?, ?)', [result.insertId, side, `/uploads/${name}`, images[side].mime]);
        }
        for (const [i, d] of damages.entries()) {
          let ruta = null;
          if (closeUps[i]) {
            const name = randomUUID() + closeUps[i].ext;
            const filename = path.join(config.uploads, name);
            await fs.writeFile(filename, closeUps[i].buffer, { flag: 'wx' });
            written.push(filename);
            ruta = `/uploads/${name}`;
          }
          await db.execute('INSERT INTO inspeccion_danos (id_inspeccion, vista, x, y, tipo, nota, ruta_archivo) VALUES (?, ?, ?, ?, ?, ?, ?)', [result.insertId, d.vista, d.x, d.y, d.tipo, d.nota, ruta]);
        }
        return result.insertId;
      });
    } catch (error) {
      for (const filename of written) await fs.unlink(filename).catch(() => {});
      throw error;
    }
    res.status(201).json({ success: true, inspeccion_id: inspectionId, analisis: analysis, mensaje: analysisState === 'error' ? 'Inspección guardada; el análisis requiere revisión manual.' : 'Inspección registrada y comparada.' });
  });
  return router;
};

module.exports.SIDES = SIDES;
