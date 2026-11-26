const { Router } = require('express');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { transaction } = require('../db');
const v = require('../validation');
const { identify } = require('./files');
const { optimizeImage } = require('../services/images');
const { analizarImagenInventario } = require('../services/gemini');

const managers = ['admin', 'jefe', 'encargado'];

function quantity(value, label = 'Cantidad', allowZero = false) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > 1000000) {
    throw new v.HttpError(400, `${label}: ingresa un número entero ${allowZero ? 'igual o mayor que cero' : 'mayor que cero'}.`);
  }
  return number;
}

function optionalText(value, label, max) {
  return value === undefined || value === null || value === '' ? null : v.text(value, label, max);
}

function optionalAmount(value) {
  return value === undefined || value === null || value === '' ? null : v.amount(value);
}

function normalizeCatalogText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLocaleLowerCase('es');
}

async function addCatalogMatches(pool, resultado) {
  const items = resultado.tipo_documento === 'repuesto'
    ? [resultado]
    : resultado.items || [];
  const searchable = items.filter(item => item.codigo_referencia || item.nombre_sugerido || item.nombre);
  if (!searchable.length) return resultado;
  const predicates = [];
  const values = [];
  for (const item of searchable) {
    const code = item.codigo_referencia;
    const name = item.nombre_sugerido || item.nombre;
    if (code) {
      predicates.push('codigo_qr = ?');
      values.push(code);
    }
    if (name) {
      predicates.push('LOWER(TRIM(nombre)) = LOWER(TRIM(?))');
      values.push(name);
    }
  }
  const [catalog] = await pool.execute(
    `SELECT id, codigo_qr, nombre, categoria, stock_actual, stock_minimo, costo_unitario, ubicacion
     FROM repuestos WHERE ${predicates.join(' OR ')}`,
    values,
  );
  const match = item => {
    const byCode = item.codigo_referencia && catalog.find(part =>
      normalizeCatalogText(part.codigo_qr) === normalizeCatalogText(item.codigo_referencia),
    );
    return byCode || catalog.find(part =>
      normalizeCatalogText(part.nombre) === normalizeCatalogText(item.nombre_sugerido || item.nombre),
    ) || null;
  };
  if (resultado.tipo_documento === 'repuesto') {
    return { ...resultado, coincidencia: match(resultado) };
  }
  return {
    ...resultado,
    items: resultado.items.map(item => ({ ...item, coincidencia: match(item) })),
  };
}

module.exports = function inventory(pool, auth, config) {
  const router = Router();
  const canView = auth.allow(...managers);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimit, files: 1, fields: 10, parts: 11 } });

  async function saveImage(file) {
    if (!file) return null;
    const format = identify(file.buffer);
    if (!format || format.ext === '.pdf' || file.mimetype !== format.mime) throw new v.HttpError(415, 'Archivo inválido. Usa PNG, JPEG, GIF o WebP.');
    let optimized;
    try { optimized = await optimizeImage(file.buffer, config.image); }
    catch { throw new v.HttpError(415, 'La imagen está dañada, excede las dimensiones permitidas o no se puede procesar.'); }
    const name = randomUUID() + optimized.ext;
    const filename = path.join(config.uploads, name);
    await fs.writeFile(filename, optimized.buffer, { flag: 'wx' });
    return { filename, url: `/uploads/${name}` };
  }

  router.post('/inventario/analizar-imagen', auth.allow(...managers), upload.single('foto'), async (req, res) => {
    if (!req.file) throw new v.HttpError(400, 'Selecciona o toma una foto para analizar.');
    const mode = req.body.modo || 'auto';
    if (mode !== 'auto') throw new v.HttpError(400, 'El análisis de imagen debe detectar automáticamente el tipo de contenido.');
    const format = identify(req.file.buffer);
    if (!format || format.ext === '.pdf' || req.file.mimetype !== format.mime) {
      throw new v.HttpError(415, 'Imagen inválida. Usa PNG, JPEG, GIF o WebP.');
    }
    let optimized;
    try { optimized = await optimizeImage(req.file.buffer, config.image); }
    catch { throw new v.HttpError(415, 'La imagen está dañada, excede las dimensiones permitidas o no se puede procesar.'); }
    let resultado;
    try {
      resultado = await analizarImagenInventario(optimized.buffer, optimized.mime, mode);
    } catch (error) {
      if (error.code === 'GEMINI_API_KEY_MISSING') throw new v.HttpError(503, error.message);
      console.error('Error al analizar imagen de inventario con Gemini:', error.name || 'AnalysisError');
      throw new v.HttpError(502, 'Gemini no pudo analizar la imagen. Inténtalo nuevamente o ingresa los datos manualmente.');
    }
    const resultadoConCoincidencias = await addCatalogMatches(pool, resultado);
    res.json({ success: true, modo: mode, resultado: resultadoConCoincidencias });
  });

  router.get('/inventario/buscar', canView, async (req, res) => {
    const codigo = v.text(req.query.codigo, 'Código QR / barras', 100);
    const [items] = await pool.execute(
      `SELECT id, codigo_qr, nombre, categoria, stock_actual, stock_minimo, costo_unitario,
        ubicacion, foto_url, created_at, updated_at
       FROM repuestos WHERE codigo_qr = ? LIMIT 1`,
      [codigo],
    );
    if (!items.length) throw new v.HttpError(404, 'No se encontró un repuesto con ese código.');
    const item = items[0];
    const stock = Number(item.stock_actual), minimo = Number(item.stock_minimo);
    res.json({
      success: true,
      repuesto: {
        ...item,
        stock_estado: stock <= minimo ? 'CRITICO' : stock <= Math.ceil(minimo * 1.25) ? 'BAJO' : 'ADECUADO',
      },
    });
  });

  router.get(['/inventario', '/inventario/repuestos'], canView, async (req, res) => {
    const values = [];
    const filters = [];
    if (req.query.q !== undefined) {
      const search = v.text(req.query.q, 'Búsqueda', 100);
      filters.push('(r.nombre LIKE ? OR r.codigo_qr LIKE ? OR r.ubicacion LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (req.query.categoria !== undefined && req.query.categoria !== '') {
      filters.push('r.categoria = ?');
      values.push(v.text(req.query.categoria, 'Categoría', 100));
    }
    const [repuestos] = await pool.execute(
      `SELECT r.id, r.codigo_qr, r.nombre, r.categoria, r.stock_actual, r.stock_minimo, r.costo_unitario, r.ubicacion, r.foto_url, r.created_at, r.updated_at
       FROM repuestos r ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY r.nombre`,
      values,
    );
    const [categorias] = await pool.execute('SELECT DISTINCT categoria FROM repuestos ORDER BY categoria');
    res.json({
      success: true,
      repuestos: repuestos.map(item => ({
        ...item,
        stock_estado: Number(item.stock_actual) <= Number(item.stock_minimo)
          ? 'CRITICO'
          : Number(item.stock_actual) <= Math.ceil(Number(item.stock_minimo) * 1.25)
            ? 'BAJO'
            : 'ADECUADO',
      })),
      categorias: categorias.map(row => row.categoria),
    });
  });

  router.post(['/inventario', '/inventario/repuestos'], canView, upload.single('foto'), async (req, res) => {
    const codigo = optionalText(req.body.codigo_qr, 'Código QR', 100);
    const nombre = v.text(req.body.nombre, 'Nombre', 150);
    const categoria = v.text(req.body.categoria, 'Categoría', 100);
    const stock = quantity(req.body.stock_actual ?? 0, 'Stock', true);
    const minimo = quantity(req.body.stock_minimo ?? 0, 'Stock mínimo', true);
    const costo = optionalAmount(req.body.costo_unitario);
    const ubicacion = v.text(req.body.ubicacion, 'Ubicación', 100);
    const image = await saveImage(req.file);
    try {
      const repuestoId = await transaction(pool, async db => {
        const [result] = await db.execute(
          'INSERT INTO repuestos (codigo_qr, nombre, categoria, stock_actual, stock_minimo, costo_unitario, ubicacion, foto_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [codigo, nombre, categoria, stock, minimo, costo, ubicacion, image?.url || null],
        );
        if (stock > 0) {
          await db.execute(
            "INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, usuario_id, comentario) VALUES (?, 'ENTRADA', ?, ?, 'Stock inicial')",
            [result.insertId, stock, req.usuario.id],
          );
        }
        return result.insertId;
      });
      res.status(201).json({ success: true, repuesto_id: repuestoId, mensaje: 'Repuesto agregado.' });
    } catch (error) {
      if (image) await fs.unlink(image.filename).catch(() => {});
      throw error;
    }
  });

  router.post('/inventario/ingresos', auth.allow('admin', 'encargado'), upload.single('foto'), async (req, res) => {
    const repuestoId = req.body.repuesto_id ? v.id(req.body.repuesto_id) : null;
    const codigo = optionalText(req.body.codigo_qr, 'Código QR', 100);
    const nombre = v.text(req.body.nombre, 'Nombre', 150);
    const categoria = v.text(req.body.categoria, 'Categoría', 100);
    const minimo = quantity(req.body.stock_minimo ?? 0, 'Stock mínimo', true);
    const cantidad = quantity(req.body.cantidad, 'Cantidad');
    const costo = optionalAmount(req.body.costo_unitario);
    const ubicacion = v.text(req.body.ubicacion, 'Ubicación', 100);
    const comentario = optionalText(req.body.comentario, 'Comentario', 500) || 'Ingreso de stock';
    const image = await saveImage(req.file);
    try {
      const result = await transaction(pool, async db => {
        let id = repuestoId;
        if (id) {
          const [items] = await db.execute('SELECT stock_actual FROM repuestos WHERE id = ? FOR UPDATE', [id]);
          if (!items.length) throw new v.HttpError(404, 'El repuesto seleccionado ya no existe. Actualiza el catálogo e inténtalo nuevamente.');
          const stock = Number(items[0].stock_actual) + cantidad;
          if (stock > 1000000) throw new v.HttpError(400, 'El stock resultante no puede superar 1.000.000 unidades.');
          await db.execute(
            `UPDATE repuestos SET codigo_qr = ?, nombre = ?, categoria = ?, stock_actual = ?,
             stock_minimo = ?, costo_unitario = ?, ubicacion = ?, foto_url = COALESCE(?, foto_url)
             WHERE id = ?`,
            [codigo, nombre, categoria, stock, minimo, costo, ubicacion, image?.url || null, id],
          );
        } else {
          const [created] = await db.execute(
            `INSERT INTO repuestos
             (codigo_qr, nombre, categoria, stock_actual, stock_minimo, costo_unitario, ubicacion, foto_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [codigo, nombre, categoria, cantidad, minimo, costo, ubicacion, image?.url || null],
          );
          id = created.insertId;
        }
        await db.execute(
          "INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, usuario_id, comentario) VALUES (?, 'ENTRADA', ?, ?, ?)",
          [id, cantidad, req.usuario.id, comentario],
        );
        return id;
      });
      res.status(201).json({
        success: true,
        repuesto_id: result,
        mensaje: repuestoId ? 'Stock actualizado.' : 'Repuesto ingresado al inventario.',
      });
    } catch (error) {
      if (image) await fs.unlink(image.filename).catch(() => {});
      throw error;
    }
  });

  router.post('/inventario/ingresos/lote', auth.allow('admin', 'encargado'), async (req, res) => {
    if (!Array.isArray(req.body.items) || req.body.items.length < 1 || req.body.items.length > 50) {
      throw new v.HttpError(400, 'El ingreso debe incluir entre 1 y 50 productos.');
    }
    const items = req.body.items.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new v.HttpError(400, `Producto ${index + 1}: datos inválidos.`);
      return {
        repuestoId: item.repuesto_id ? v.id(item.repuesto_id) : null,
        codigo: optionalText(item.codigo_qr, `Código del producto ${index + 1}`, 100),
        nombre: v.text(item.nombre, `Nombre del producto ${index + 1}`, 150),
        categoria: v.text(item.categoria, `Categoría del producto ${index + 1}`, 100),
        cantidad: quantity(item.cantidad, `Cantidad del producto ${index + 1}`),
        minimo: quantity(item.stock_minimo ?? 0, `Stock mínimo del producto ${index + 1}`, true),
        costo: optionalAmount(item.costo_unitario),
        ubicacion: v.text(item.ubicacion, `Ubicación del producto ${index + 1}`, 100),
      };
    });
    const comentario = optionalText(req.body.comentario, 'Comentario', 500) || 'Ingreso desde documento';
    const ids = await transaction(pool, async db => {
      const saved = [];
      for (const item of items) {
        let id = item.repuestoId;
        if (!id) {
          let matches = [];
          if (item.codigo) {
            [matches] = await db.execute(
              'SELECT id FROM repuestos WHERE codigo_qr = ? LIMIT 1 FOR UPDATE',
              [item.codigo],
            );
          }
          if (!matches.length) {
            [matches] = await db.execute(
              'SELECT id FROM repuestos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) LIMIT 1 FOR UPDATE',
              [item.nombre],
            );
          }
          id = matches[0]?.id || null;
        }
        if (id) {
          const [current] = await db.execute('SELECT stock_actual FROM repuestos WHERE id = ? FOR UPDATE', [id]);
          if (!current.length) throw new v.HttpError(404, `El repuesto del producto «${item.nombre}» ya no existe.`);
          const stock = Number(current[0].stock_actual) + item.cantidad;
          if (stock > 1000000) throw new v.HttpError(400, `El stock resultante de «${item.nombre}» supera 1.000.000 unidades.`);
          await db.execute(
            `UPDATE repuestos SET codigo_qr = ?, nombre = ?, categoria = ?, stock_actual = ?,
             stock_minimo = ?, costo_unitario = ?, ubicacion = ? WHERE id = ?`,
            [item.codigo, item.nombre, item.categoria, stock, item.minimo, item.costo, item.ubicacion, id],
          );
        } else {
          const [created] = await db.execute(
            `INSERT INTO repuestos
             (codigo_qr, nombre, categoria, stock_actual, stock_minimo, costo_unitario, ubicacion)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [item.codigo, item.nombre, item.categoria, item.cantidad, item.minimo, item.costo, item.ubicacion],
          );
          id = created.insertId;
        }
        await db.execute(
          "INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, usuario_id, comentario) VALUES (?, 'ENTRADA', ?, ?, ?)",
          [id, item.cantidad, req.usuario.id, comentario],
        );
        saved.push(id);
      }
      return saved;
    });
    res.status(201).json({ success: true, repuesto_ids: ids, mensaje: `${ids.length} producto(s) ingresado(s) correctamente.` });
  });

  router.put('/inventario/repuestos/:id', auth.allow('admin', 'encargado'), upload.single('foto'), async (req, res) => {
    const repuestoId = v.id(req.params.id);
    const codigo = optionalText(req.body.codigo_qr, 'Código QR', 100);
    const nombre = v.text(req.body.nombre, 'Nombre', 150);
    const categoria = v.text(req.body.categoria, 'Categoría', 100);
    const minimo = quantity(req.body.stock_minimo, 'Stock mínimo', true);
    const costo = optionalAmount(req.body.costo_unitario);
    const ubicacion = v.text(req.body.ubicacion, 'Ubicación', 100);
    const image = await saveImage(req.file);
    try {
      await transaction(pool, async db => {
        const [items] = await db.execute('SELECT id FROM repuestos WHERE id = ? FOR UPDATE', [repuestoId]);
        if (!items.length) throw new v.HttpError(404, 'Repuesto no encontrado.');
        await db.execute(
          `UPDATE repuestos SET codigo_qr = ?, nombre = ?, categoria = ?, stock_minimo = ?, costo_unitario = ?, ubicacion = ?,
           foto_url = COALESCE(?, foto_url) WHERE id = ?`,
          [codigo, nombre, categoria, minimo, costo, ubicacion, image?.url || null, repuestoId],
        );
      });
      res.json({ success: true, mensaje: 'Repuesto actualizado.' });
    } catch (error) {
      if (image) await fs.unlink(image.filename).catch(() => {});
      throw error;
    }
  });

  router.delete('/inventario/repuestos/:id', auth.allow('admin', 'encargado'), async (req, res) => {
    const [result] = await pool.execute('DELETE FROM repuestos WHERE id = ?', [v.id(req.params.id)]);
    v.affected(result, 'Repuesto no encontrado.');
    res.json({ success: true, mensaje: 'Repuesto eliminado.' });
  });

  router.post(['/inventario/movimiento', '/inventario/movimientos'], canView, async (req, res) => {
    const repuestoId = v.id(req.body.repuesto_id);
    const tipo = req.body.tipo;
    if (!['ENTRADA', 'SALIDA'].includes(tipo)) throw new v.HttpError(400, 'Tipo de movimiento inválido.');
    const cantidad = quantity(req.body.cantidad);
    const camion = optionalText(req.body.camion_id, 'Patente', 10)?.toUpperCase() || null;
    const comentario = optionalText(req.body.comentario, 'Comentario', 500);
    await transaction(pool, async db => {
      const [items] = await db.execute('SELECT id, stock_actual FROM repuestos WHERE id = ? FOR UPDATE', [repuestoId]);
      if (!items.length) throw new v.HttpError(404, 'Repuesto no encontrado.');
      if (camion) {
        const [trucks] = await db.execute('SELECT patente FROM camiones WHERE patente = ?', [camion]);
        if (!trucks.length) throw new v.HttpError(400, 'El camión seleccionado no existe.');
      }
      const current = Number(items[0].stock_actual);
      if (tipo === 'SALIDA' && current < cantidad) throw new v.HttpError(409, 'No hay stock suficiente para registrar esta salida.');
      const next = current + (tipo === 'ENTRADA' ? cantidad : -cantidad);
      await db.execute('UPDATE repuestos SET stock_actual = ? WHERE id = ?', [next, repuestoId]);
      await db.execute(
        'INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, camion_id, usuario_id, comentario) VALUES (?, ?, ?, ?, ?, ?)',
        [repuestoId, tipo, cantidad, camion, req.usuario.id, comentario],
      );
    });
    res.status(201).json({ success: true, mensaje: tipo === 'SALIDA' ? 'Salida registrada.' : 'Ingreso registrado.' });
  });

  router.get('/inventario/movimientos', canView, async (req, res) => {
    const [movimientos] = await pool.execute(
      `SELECT m.id, m.repuesto_id, r.nombre AS repuesto, m.tipo, m.cantidad, m.camion_id, m.comentario, m.created_at,
              u.nombre AS usuario
       FROM movimientos_inventario m JOIN repuestos r ON r.id = m.repuesto_id
       JOIN usuarios u ON u.id = m.usuario_id
       ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
    );
    res.json({ success: true, movimientos });
  });

  router.get('/inventario/solicitudes', canView, async (req, res) => {
    const [solicitudes] = await pool.execute(
      `SELECT s.id, s.repuesto_id, s.descripcion_pieza, s.cantidad, s.estado, s.solicitado_por,
              s.foto_comprobante_url, s.created_at, u.nombre AS solicitante, r.nombre AS repuesto
       FROM solicitudes_compra s JOIN usuarios u ON u.id = s.solicitado_por
       LEFT JOIN repuestos r ON r.id = s.repuesto_id
       ORDER BY FIELD(s.estado, 'PENDIENTE', 'APROBADO', 'RECIBIDO'), s.created_at DESC`,
    );
    res.json({ success: true, solicitudes });
  });

  router.post('/inventario/solicitudes', auth.allow(...managers), upload.single('foto_comprobante'), async (req, res) => {
    const repuestoId = req.body.repuesto_id ? v.id(req.body.repuesto_id) : null;
    let descripcion = optionalText(req.body.descripcion_pieza, 'Descripción', 500);
    const cantidad = quantity(req.body.cantidad);
    if (repuestoId) {
      const [items] = await pool.execute('SELECT nombre FROM repuestos WHERE id = ?', [repuestoId]);
      if (!items.length) throw new v.HttpError(404, 'Repuesto no encontrado.');
      descripcion ||= items[0].nombre;
    }
    if (!descripcion) throw new v.HttpError(400, 'Ingresa la descripción de la pieza.');
    const image = await saveImage(req.file);
    try {
      const [result] = await pool.execute(
        'INSERT INTO solicitudes_compra (repuesto_id, descripcion_pieza, cantidad, solicitado_por, foto_comprobante_url) VALUES (?, ?, ?, ?, ?)',
        [repuestoId, descripcion, cantidad, req.usuario.id, image?.url || null],
      );
      res.status(201).json({ success: true, solicitud_id: result.insertId, mensaje: 'Solicitud de compra creada.' });
    } catch (error) {
      if (image) await fs.unlink(image.filename).catch(() => {});
      throw error;
    }
  });

  router.put('/inventario/solicitudes/:id/estado', auth.allow('admin', 'jefe'), async (req, res) => {
    const solicitudId = v.id(req.params.id);
    const estado = req.body.estado;
    if (!['APROBADO', 'RECIBIDO'].includes(estado)) throw new v.HttpError(400, 'Estado de solicitud inválido.');
    const stockUpdated = await transaction(pool, async db => {
      const [rows] = await db.execute('SELECT * FROM solicitudes_compra WHERE id = ? FOR UPDATE', [solicitudId]);
      if (!rows.length) throw new v.HttpError(404, 'Solicitud no encontrada.');
      const solicitud = rows[0];
      if ((estado === 'APROBADO' && solicitud.estado !== 'PENDIENTE') || (estado === 'RECIBIDO' && solicitud.estado !== 'APROBADO')) {
        throw new v.HttpError(409, 'La solicitud debe estar pendiente para aprobarse y aprobada para recibirse.');
      }
      if (estado === 'RECIBIDO' && solicitud.repuesto_id) {
        const [items] = await db.execute('SELECT stock_actual FROM repuestos WHERE id = ? FOR UPDATE', [solicitud.repuesto_id]);
        if (!items.length) throw new v.HttpError(409, 'El repuesto asociado ya no existe.');
        await db.execute('UPDATE repuestos SET stock_actual = stock_actual + ? WHERE id = ?', [solicitud.cantidad, solicitud.repuesto_id]);
        await db.execute(
          "INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, usuario_id, comentario) VALUES (?, 'ENTRADA', ?, ?, ?)",
          [solicitud.repuesto_id, solicitud.cantidad, req.usuario.id, `Recepción de solicitud #${solicitudId}`],
        );
      }
      await db.execute('UPDATE solicitudes_compra SET estado = ? WHERE id = ?', [estado, solicitudId]);
      return estado === 'RECIBIDO' && Boolean(solicitud.repuesto_id);
    });
    const mensaje = estado !== 'RECIBIDO'
      ? 'Solicitud aprobada.'
      : stockUpdated
        ? 'Recepción registrada y stock actualizado.'
        : 'Recepción registrada; el repuesto no está asociado al catálogo.';
    res.json({ success: true, mensaje });
  });

  router.post('/inventario/solicitudes/:id/comprobante', auth.allow(...managers), upload.single('foto_comprobante'), async (req, res) => {
    if (!req.file) throw new v.HttpError(400, 'Selecciona una foto del comprobante.');
    const image = await saveImage(req.file);
    try {
      const [result] = await pool.execute('UPDATE solicitudes_compra SET foto_comprobante_url = ? WHERE id = ?', [image.url, v.id(req.params.id)]);
      v.affected(result, 'Solicitud no encontrada.');
      res.json({ success: true, mensaje: 'Comprobante adjuntado.' });
    } catch (error) {
      await fs.unlink(image.filename).catch(() => {});
      throw error;
    }
  });

  return router;
};
module.exports.addCatalogMatches = addCatalogMatches;
