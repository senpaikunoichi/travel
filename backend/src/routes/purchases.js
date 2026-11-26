const { Router } = require('express');
const multer = require('multer');
const fs = require('node:fs/promises');
const v = require('../validation');
const { transaction } = require('../db');
// Las compras y cotizaciones ya no generan avisos: se coordinan en el grupo. Los avisos quedan para el inicio y término de las tareas.
// ponytail: notify apagado aquí; para reactivarlo, volver a require('../services/notify').
const notify = async () => {};
const { logEvent } = require('../services/events');
const whatsapp = require('../services/whatsapp');
const videos = require('../services/videos');
const { checkDue, syncTts, normalize } = require('../services/km');
const { prepareFile, saveFile } = require('./files');
const ExcelJS = require('exceljs');
const { move, adjust } = require('../services/stock');

// La unidad es una palabra (unidad, litro, juego…), nunca una cantidad: «1» o «2» ahí confunde el stock.
const unit = value => {
  const u = v.text(value || 'unidad', 'Unidad', 20).toLowerCase();
  if (!/[a-záéíóúñ]/i.test(u)) throw new v.HttpError(400, 'Unidad: escribe una palabra como unidad, litro o juego (la cantidad va en Stock).');
  return u;
};

// Columnas del Excel de inventario: el mismo archivo exportado sirve como plantilla para importar.
const PART_COLUMNS = [
  { key: 'codigo', header: 'Código', width: 16, aliases: ['codigo', 'cod', 'sku'] },
  { key: 'nombre', header: 'Nombre', width: 40, aliases: ['nombre', 'repuesto', 'descripcion'] },
  { key: 'unidad', header: 'Unidad', width: 12, aliases: ['unidad', 'um'] },
  { key: 'stock', header: 'Stock', width: 10, aliases: ['stock', 'stockactual', 'cantidad'] },
  { key: 'stock_minimo', header: 'Stock mínimo', width: 14, aliases: ['stockminimo', 'minimo'] },
  { key: 'precio_ref', header: 'Precio referencia', width: 18, aliases: ['precioreferencia', 'precioref', 'precio'] },
];
const headerKey = value => String(value ?? '').normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const cellValue = value => {
  if (value && typeof value === 'object' && !(value instanceof Date)) return value.result ?? value.text ?? value.richText?.map(part => part.text).join('') ?? '';
  return value ?? '';
};

// Compras sin OT: qué tipo de compra es.
const CATEGORIES = { herramienta: 'Herramienta', insumo: 'Insumo', repuesto: 'Repuesto para bodega' };
const aboutQuote = (quote, task) => task ? `${task.tipo_tarea} (${task.patente_camion})` : `${CATEGORIES[quote.categoria] || 'Compra'} · sin OT`;
const clp = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value) || 0);

// Presupuesto del mes: lo aprobado o recibido consume el presupuesto; lo pendiente se informa aparte.
async function budget(db, mes, lock = false) {
  const [[row]] = await db.execute(`SELECT monto FROM presupuestos WHERE mes = ?${lock ? ' FOR UPDATE' : ''}`, [mes]);
  const [[sums]] = await db.execute("SELECT COALESCE(SUM(CASE WHEN estado IN ('aprobada','recibida') THEN monto END), 0) AS comprometido, COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN monto END), 0) AS pendiente FROM cotizaciones WHERE mes = ?", [mes]);
  const monto = row ? Number(row.monto) : null;
  const comprometido = Number(sums.comprometido);
  return { mes, monto, definido: !!row, comprometido, pendiente: Number(sums.pendiente), disponible: (monto || 0) - comprometido };
}

// A cada cotización pendiente se le indica cuánto excedería el presupuesto de su mes si se aprobara.
async function withExcess(db, quotes) {
  const months = {};
  for (const q of quotes) if (q.estado === 'pendiente') months[q.mes] ??= await budget(db, q.mes);
  return quotes.map(q => q.estado === 'pendiente' ? { ...q, excede: Math.max(0, months[q.mes].comprometido + Number(q.monto) - (months[q.mes].monto || 0)) } : q);
}

// El jefe aprueba o rechaza una cotización (desde la app o respondiendo por WhatsApp). Aprobar fuera de
// presupuesto amplía el límite del mes en lo excedido y queda registrado en la cotización.
async function decideQuote(pool, quoteId, decision, rawNota, user, config) {
  const nota = decision === 'rechazar' ? v.text(rawNota, 'Motivo del rechazo', 1000) : v.text(rawNota, 'Nota', 1000, true) || null;
  return transaction(pool, async db => {
    const [[quote]] = await db.execute('SELECT * FROM cotizaciones WHERE id = ? FOR UPDATE', [quoteId]);
    if (!quote) throw new v.HttpError(404, `No existe la cotización #${quoteId}.`);
    if (quote.estado !== 'pendiente') throw new v.HttpError(409, `La cotización #${quoteId} ya fue revisada.`);
    const [[task]] = quote.id_tarea ? await db.execute('SELECT tipo_tarea, patente_camion FROM tareas WHERE id = ?', [quote.id_tarea]) : [[null]];
    let excedente = 0;
    if (decision === 'aprobar') {
      const status = await budget(db, quote.mes, true);
      excedente = Math.max(0, status.comprometido + Number(quote.monto) - (status.monto || 0));
      if (excedente) await db.execute('INSERT INTO presupuestos (mes, monto, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE monto = monto + ?, updated_by = VALUES(updated_by)', [quote.mes, excedente.toFixed(2), user.id, excedente.toFixed(2)]);
    }
    await db.execute('UPDATE cotizaciones SET estado = ?, excedente = ?, nota_decision = ?, decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE id = ?', [decision === 'aprobar' ? 'aprobada' : 'rechazada', excedente.toFixed(2), nota, user.id, quoteId]);
    const about = aboutQuote(quote, task);
    const text = decision === 'aprobar' ? `Cotización aprobada: ${quote.detalle.slice(0, 80)} (${about}). Ya puedes comprar.` : `Cotización rechazada: ${quote.detalle.slice(0, 80)} (${about}). Motivo: ${nota}`;
    await notify(db, ['encargado', quote.created_by], text, quote.id_tarea, {
      text: [decision === 'aprobar' ? `✅ *Cotización #${quote.id} aprobada* por ${user.nombre}` : `❌ *Cotización #${quote.id} rechazada* por ${user.nombre}`,
        task ? `Tarea: ${task.tipo_tarea} · Camión ${task.patente_camion}` : `Compra sin OT: ${CATEGORIES[quote.categoria] || 'Compra'}`, `Detalle: ${quote.detalle}`, `Proveedor: ${quote.proveedor} · ${clp(quote.monto)}`,
        decision === 'aprobar' ? 'Ya puedes comprar. Al comprar, registra la compra con la foto del comprobante y de lo comprado.' : `Motivo: ${nota}`,
        quote.id_tarea ? `Ver la OT: ${config.publicUrl}/?tarea=${quote.id_tarea}` : `Ver las compras del mes: ${config.publicUrl}/#compras`].join('\n'),
    });
    if (quote.id_tarea) await logEvent(db, quote.id_tarea, user, decision === 'aprobar' ? 'cotizacion_aprobada' : 'cotizacion_rechazada',
      decision === 'aprobar' ? `Aprobó la cotización #${quote.id}${excedente ? ` (fuera de presupuesto: el límite subió en ${clp(excedente)})` : ''}` : `Rechazó la cotización #${quote.id}. Motivo: ${nota}`, quote.monto);
    const mensaje = decision === 'aprobar' ? (excedente ? `Cotización aprobada. El presupuesto del mes aumentó en ${clp(excedente)}.` : 'Cotización aprobada.') : 'Cotización rechazada.';
    return { mensaje, quote, task, excedente };
  });
}

module.exports = function purchases(pool, auth, config) {
  const router = Router();
  const managers = auth.allow('admin', 'encargado');
  const viewers = auth.allow('admin', 'encargado', 'jefe');
  const deciders = auth.allow('admin', 'jefe');

  // Inventario
  router.get('/repuestos', viewers, async (req, res) => {
    const [repuestos] = await pool.execute('SELECT id, nombre, codigo, unidad, stock, stock_minimo, precio_ref FROM repuestos ORDER BY nombre');
    res.json({ success: true, repuestos });
  });
  const partFields = body => [v.text(body.nombre, 'Nombre', 120), v.text(body.codigo, 'Código', 50, true) || null, unit(body.unidad), v.stock(body.stock), v.stock(body.stock_minimo), body.precio_ref ? v.amount(body.precio_ref) : null];
  router.get('/repuestos/excel', viewers, async (req, res) => {
    const [repuestos] = await pool.execute('SELECT codigo, nombre, unidad, stock, stock_minimo, precio_ref FROM repuestos ORDER BY nombre');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Travel Trans Logística';
    const sheet = workbook.addWorksheet('Inventario', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = PART_COLUMNS.map(({ key, header, width }) => ({ key, header, width }));
    for (const r of repuestos) sheet.addRow({ ...r, stock: Number(r.stock), stock_minimo: Number(r.stock_minimo), precio_ref: r.precio_ref == null ? null : Number(r.precio_ref) });
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1D1D1F' } };
    sheet.getColumn('precio_ref').numFmt = '"$"#,##0';
    sheet.autoFilter = { from: 'A1', to: 'F1' };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=inventario_${v.today()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  });
  // Importa el Excel: actualiza por código (o por nombre si no tiene código) y crea los que no existen.
  // Todo o nada: si una fila tiene un error, no se cambia nada y se informa la fila.
  const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 2 } });
  router.post('/repuestos/excel', managers, excelUpload.single('archivo'), async (req, res) => {
    if (!req.file) throw new v.HttpError(400, 'Adjunta el archivo Excel (.xlsx).');
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(req.file.buffer); }
    catch { throw new v.HttpError(400, 'El archivo no es un Excel .xlsx válido. Guárdalo como «Libro de Excel (.xlsx)».'); }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new v.HttpError(400, 'El Excel no tiene hojas.');
    const columns = {};
    sheet.getRow(1).eachCell((cell, index) => {
      const found = PART_COLUMNS.find(c => c.aliases.includes(headerKey(cellValue(cell.value))));
      if (found && !columns[found.key]) columns[found.key] = index;
    });
    if (!columns.nombre && !columns.codigo) throw new v.HttpError(400, 'La primera fila debe tener los títulos: Código, Nombre, Unidad, Stock, Stock mínimo, Precio referencia.');
    const items = [], errors = [];
    for (let n = 2; n <= sheet.rowCount; n++) {
      const row = sheet.getRow(n);
      const cells = Object.fromEntries(Object.entries(columns).map(([key, index]) => [key, cellValue(row.getCell(index).value)]));
      const raw = Object.fromEntries(Object.entries(cells).map(([key, value]) => [key, String(value).trim()]));
      if (!Object.values(raw).some(Boolean)) continue;
      // Números de Excel vienen como número (se redondean a 2 decimales); escritos como texto admiten coma decimal y $ con puntos de miles.
      const number = (key, money = false) => {
        const value = cells[key];
        if (value === undefined || raw[key] === '') return undefined;
        if (typeof value === 'number') return String(Math.round(value * 100) / 100);
        return money ? raw[key].replace(/[$.\s]/g, '').replace(',', '.') : raw[key].replace(',', '.');
      };
      try {
        const stockValue = number('stock'), minValue = number('stock_minimo'), price = number('precio_ref', true);
        items.push({
          fila: n,
          codigo: v.text(raw.codigo, 'Código', 50, true) || null,
          nombre: raw.nombre ? v.text(raw.nombre, 'Nombre', 120) : null,
          unidad: raw.unidad ? unit(raw.unidad) : undefined,
          stock: stockValue === undefined ? undefined : v.stock(stockValue),
          stock_minimo: minValue === undefined ? undefined : v.stock(minValue),
          precio_ref: price === undefined ? undefined : v.amount(price),
        });
      } catch (error) { errors.push(`Fila ${n}: ${error.message}`); }
      if (errors.length >= 10) break;
    }
    if (errors.length) throw new v.HttpError(400, `No se importó nada. Corrige el Excel: ${errors.join(' · ')}`);
    if (!items.length) throw new v.HttpError(400, 'El Excel no tiene repuestos bajo la fila de títulos.');
    if (items.length > 5000) throw new v.HttpError(400, 'Importa hasta 5.000 repuestos por archivo.');
    const result = await transaction(pool, async db => {
      let creados = 0, actualizados = 0;
      for (const item of items) {
        const [[found]] = item.codigo
          ? await db.execute('SELECT * FROM repuestos WHERE codigo = ? FOR UPDATE', [item.codigo])
          : await db.execute('SELECT * FROM repuestos WHERE nombre = ? AND codigo IS NULL FOR UPDATE', [item.nombre]);
        if (found) {
          const keep = (key, fallback) => item[key] === undefined ? fallback : item[key];
          await db.execute('UPDATE repuestos SET nombre = ?, unidad = ?, stock_minimo = ?, precio_ref = ? WHERE id = ?',
            [item.nombre || found.nombre, keep('unidad', found.unidad), keep('stock_minimo', found.stock_minimo), keep('precio_ref', found.precio_ref), found.id]);
          if (item.stock !== undefined) await adjust(db, found.id, found.stock, item.stock, 'Carga de inventario (Excel)', req.usuario);
          actualizados++;
        } else {
          if (!item.nombre) throw new v.HttpError(400, `No se importó nada. Fila ${item.fila}: el código ${item.codigo} no existe; agrega su nombre para crearlo.`);
          const [created] = await db.execute('INSERT INTO repuestos (nombre, codigo, unidad, stock, stock_minimo, precio_ref) VALUES (?, ?, ?, 0, ?, ?)',
            [item.nombre, item.codigo, item.unidad || 'unidad', item.stock_minimo ?? 0, item.precio_ref ?? null]);
          await move(db, { id_repuesto: created.insertId, cantidad: item.stock ?? 0, motivo: 'Stock inicial (Excel)', usuario: req.usuario });
          creados++;
        }
      }
      return { creados, actualizados };
    });
    res.json({ success: true, ...result, mensaje: `Inventario importado: ${result.creados} repuesto(s) nuevo(s) y ${result.actualizados} actualizado(s).` });
  });
  router.post('/repuestos', managers, async (req, res) => {
    const [nombre, codigo, unidad, stock, minimo, precio] = partFields(req.body);
    await transaction(pool, async db => {
      const [created] = await db.execute('INSERT INTO repuestos (nombre, codigo, unidad, stock, stock_minimo, precio_ref) VALUES (?, ?, ?, 0, ?, ?)', [nombre, codigo, unidad, minimo, precio]);
      await move(db, { id_repuesto: created.insertId, cantidad: stock, motivo: 'Stock inicial', usuario: req.usuario });
    });
    res.status(201).json({ success: true, mensaje: 'Repuesto agregado al inventario.' });
  });
  router.put('/repuestos/:id', managers, async (req, res) => {
    const id = v.id(req.params.id), [nombre, codigo, unidad, stock, minimo, precio] = partFields(req.body);
    await transaction(pool, async db => {
      const [[found]] = await db.execute('SELECT stock FROM repuestos WHERE id = ? FOR UPDATE', [id]);
      if (!found) throw new v.HttpError(404, 'Repuesto no encontrado.');
      await db.execute('UPDATE repuestos SET nombre = ?, codigo = ?, unidad = ?, stock_minimo = ?, precio_ref = ? WHERE id = ?', [nombre, codigo, unidad, minimo, precio, id]);
      await adjust(db, id, found.stock, stock, 'Ajuste manual del stock', req.usuario);
    });
    res.json({ success: true, mensaje: 'Repuesto actualizado.' });
  });
  // Entradas y salidas del inventario (kardex). Además de las automáticas (OT, compras, cargas), el supervisor registra
  // a mano lo que entra sin compra en el sistema o sale sin OT (por ejemplo, un insumo para un camión).
  // Medianoche de Chile de un día, en UTC (la base guarda UTC y no tiene las zonas horarias cargadas).
  const chileMidnight = day => {
    const offset = new Intl.DateTimeFormat('en', { timeZone: 'America/Santiago', timeZoneName: 'longOffset' }).formatToParts(new Date(`${day}T12:00:00Z`)).find(p => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
    return new Date(`${day}T00:00:00${offset}`).toISOString().slice(0, 19).replace('T', ' ');
  };
  const nextDay = day => new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const movements = async query => {
    const where = [], params = [];
    if (query.desde || query.hasta) {
      const [desde, hasta] = v.dateRange({ fecha_inicio: query.desde, fecha_fin: query.hasta });
      where.push('m.created_at >= ? AND m.created_at < ?'); params.push(chileMidnight(desde), chileMidnight(nextDay(hasta)));
    } else { where.push('m.created_at > UTC_TIMESTAMP() - INTERVAL 31 DAY'); }
    if (query.repuesto) { where.push('m.id_repuesto = ?'); params.push(v.id(query.repuesto)); }
    if (query.tipo) { where.push('m.tipo = ?'); params.push(v.oneOf(query.tipo, ['entrada', 'salida', 'ajuste'], 'Tipo')); }
    const [rows] = await pool.execute(`SELECT m.id, m.id_repuesto, m.repuesto, r.unidad, m.tipo, m.cantidad, m.stock_despues, m.motivo, m.id_tarea, m.id_cotizacion, m.patente, u.nombre AS usuario,
        DATE_FORMAT(m.created_at, '%Y-%m-%dT%H:%i:%sZ') AS fecha
      FROM inventario_movimientos m LEFT JOIN repuestos r ON r.id = m.id_repuesto LEFT JOIN usuarios u ON u.id = m.id_usuario
      WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT 3000`, params);
    return rows.map(r => ({ ...r, cantidad: Number(r.cantidad), stock_despues: Number(r.stock_despues) }));
  };
  router.get('/inventario/movimientos', viewers, async (req, res) => res.json({ success: true, movimientos: await movements(req.query) }));
  router.get('/inventario/movimientos/excel', viewers, async (req, res) => {
    const rows = await movements(req.query);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Movimientos', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [['Fecha', 18], ['Tipo', 10], ['Repuesto', 32], ['Cantidad', 10], ['Unidad', 10], ['Stock después', 14], ['Motivo', 44], ['OT', 8], ['Camión', 10], ['Registró', 20]].map(([header, width]) => ({ header, width }));
    const local = iso => new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });
    for (const r of rows) sheet.addRow([local(r.fecha), { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste' }[r.tipo], r.repuesto, r.cantidad, r.unidad || '', r.stock_despues, r.motivo, r.id_tarea || '', r.patente || '', r.usuario || 'Sistema']);
    sheet.getRow(1).font = { bold: true };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="movimientos_inventario.xlsx"');
    await workbook.xlsx.write(res); res.end();
  });
  router.post('/inventario/movimientos', managers, async (req, res) => {
    const id = v.id(req.body.id_repuesto), tipo = v.oneOf(req.body.tipo, ['entrada', 'salida'], 'Tipo');
    const cantidad = Number(v.quantity(req.body.cantidad)), motivo = v.text(req.body.motivo, 'Motivo', 250);
    const patente = req.body.patente ? v.text(req.body.patente, 'Patente', 10) : null;
    const stock = await transaction(pool, async db => {
      const [[part]] = await db.execute('SELECT stock FROM repuestos WHERE id = ? FOR UPDATE', [id]);
      if (!part) throw new v.HttpError(404, 'Repuesto no encontrado.');
      if (tipo === 'salida' && Number(part.stock) < cantidad) throw new v.HttpError(409, `No hay stock suficiente: quedan ${Number(part.stock)}.`);
      if (patente) { const [[t]] = await db.execute('SELECT patente FROM camiones WHERE patente = ?', [patente]); if (!t) throw new v.HttpError(400, 'El camión no existe.'); }
      return move(db, { id_repuesto: id, cantidad: tipo === 'salida' ? -cantidad : cantidad, tipo, motivo, patente, usuario: req.usuario });
    });
    require('../services/changes').bump();
    res.status(201).json({ success: true, mensaje: `${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada. Stock actual: ${stock.toLocaleString('es-CL')}.` });
  });
  router.delete('/repuestos/:id', auth.allow('admin'), async (req, res) => {
    const [result] = await pool.execute('DELETE FROM repuestos WHERE id = ?', [v.id(req.params.id)]);
    v.affected(result);
    res.json({ success: true, mensaje: 'Repuesto eliminado.' });
  });

  // Repuestos y cotizaciones de una tarea
  router.get('/tareas/:id/compras', async (req, res) => {
    const taskId = v.id(req.params.id);
    await auth.taskAccess(pool, req.usuario, taskId);
    const [repuestos] = await pool.execute('SELECT tr.id, tr.id_repuesto, tr.descripcion, tr.cantidad, tr.estado, tr.motivo, r.nombre, r.unidad, r.stock, (SELECT c.estado FROM cotizaciones c WHERE c.id_tarea_repuesto = tr.id ORDER BY c.id DESC LIMIT 1) AS estado_compra FROM tarea_repuestos tr LEFT JOIN repuestos r ON r.id = tr.id_repuesto WHERE tr.id_tarea = ? ORDER BY tr.id', [taskId]);
    const [cotizaciones] = req.usuario.rol === 'mecanico' ? [[]] : await pool.execute('SELECT c.*, u.nombre AS creador, d.nombre AS decisor FROM cotizaciones c JOIN usuarios u ON u.id = c.created_by LEFT JOIN usuarios d ON d.id = c.decided_by WHERE c.id_tarea = ? ORDER BY c.id DESC', [taskId]);
    // El mecánico ve los repuestos de su tarea, pero no las cotizaciones: tienen precios.
    res.json({ success: true, repuestos, cotizaciones: req.usuario.rol === 'mecanico' ? [] : await withExcess(pool, cotizaciones) });
  });
  const missingPart = async (db, user, task, label, motivo, saved = []) => {
    await db.execute('UPDATE tareas SET esperando_repuesto = TRUE WHERE id = ?', [task.id]);
    await notify(db, ['encargado'], `Sin repuesto en ${task.tipo_tarea} (${task.patente_camion}): ${label}. Motivo: ${motivo.slice(0, 120)}. ${user.nombre} necesita una cotización.`, task.id, {
      text: [`🔧 *Necesita cotización · OT #${task.id}*`, `Tarea: ${task.tipo_tarea} · Camión ${task.patente_camion}`, `Repuesto: ${label}`, `Por qué: ${motivo}`, `Pedido por: ${user.nombre}`,
        ...saved.filter(f => /\.(mp4|mov|webm)$/i.test(f.ruta)).map(f => `Video: ${config.publicUrl}${f.ruta}`), `Ver la evidencia y la OT: ${whatsapp.otLink(task.id)}`].join('\n'),
      media: saved.map(f => f.ruta),
    });
    await logEvent(db, task.id, user, 'falta_repuesto', `Falta ${label}. Motivo: ${motivo}`);
  };
  // Evidencia del repuesto malo: 1 a 3 fotos o videos, obligatoria para pedir una compra.
  const faultUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(config.uploadLimit, config.videoLimit || 0), files: 3, fields: 3, parts: 6 } });
  const saveFault = async files => {
    if (!files?.length) throw new v.HttpError(400, 'Adjunta al menos una foto o video del repuesto en mal estado.');
    const saved = [];
    try { for (const file of files) saved.push(await saveFile(await prepareFile(file, config, { video: true }), config)); }
    catch (error) { for (const f of saved) await fs.unlink(f.filename).catch(() => {}); throw error; }
    return saved;
  };
  const storeFault = async (db, taskId, lineId, saved) => {
    for (const f of saved) await db.execute("INSERT INTO evidencia (id_tarea, ruta_archivo, tipo, fecha, id_tarea_repuesto) VALUES (?, ?, 'falla', ?, ?)", [taskId, f.ruta, v.today(), lineId]);
    // Los videos de la falla se comprimen después de guardar (si la transacción falla, la compresión no encuentra la fila).
    for (const f of saved) if (/\.(mp4|mov|webm)$/.test(f.ruta)) db.afterCommit?.push(() => videos.enqueue(pool, config.uploads, f.ruta));
  };
  const openTask = task => { if (!['Pendiente', 'En_Trabajo'].includes(task.estado)) throw new v.HttpError(409, 'La tarea no está en curso.'); };
  router.post('/tarea-repuestos/:id/retirar', auth.allow('admin', 'encargado', 'mecanico'), async (req, res) => {
    const lineId = v.id(req.params.id);
    await transaction(pool, async db => {
      const [[line]] = await db.execute('SELECT * FROM tarea_repuestos WHERE id = ? FOR UPDATE', [lineId]);
      if (!line) throw new v.HttpError(404, 'Repuesto no encontrado.');
      const task = await auth.taskAccess(db, req.usuario, line.id_tarea, true);
      if (task.estado !== 'En_Trabajo') throw new v.HttpError(409, 'Inicia la tarea antes de retirar repuestos.');
      if (line.estado === 'retirado') throw new v.HttpError(409, 'Este repuesto ya fue retirado.');
      if (line.id_repuesto) {
        const [[part]] = await db.execute('SELECT stock FROM repuestos WHERE id = ? FOR UPDATE', [line.id_repuesto]);
        if (Number(part.stock) < Number(line.cantidad)) throw new v.HttpError(409, 'No hay stock suficiente. Usa «No hay repuesto» para pedir una cotización.');
        await move(db, { id_repuesto: line.id_repuesto, cantidad: -line.cantidad, motivo: `OT #${task.id} · ${task.tipo_tarea}`, id_tarea: task.id, patente: task.patente_camion, usuario: req.usuario });
      }
      await db.execute("UPDATE tarea_repuestos SET estado = 'retirado' WHERE id = ?", [lineId]);
      await logEvent(db, task.id, req.usuario, 'retiro', `Retiró del inventario: ${line.descripcion || 'repuesto'} × ${Number(line.cantidad)}`);
      const [[{ left }]] = await db.execute("SELECT COUNT(*) AS `left` FROM tarea_repuestos WHERE id_tarea = ? AND estado = 'faltante'", [task.id]);
      if (!Number(left)) await db.execute('UPDATE tareas SET esperando_repuesto = FALSE WHERE id = ?', [task.id]);
    });
    res.json({ success: true, mensaje: 'Repuesto retirado del inventario.' });
  });
  router.post('/tarea-repuestos/:id/faltante', auth.allow('admin', 'encargado', 'mecanico'), faultUpload.array('evidencia', 3), async (req, res) => {
    const lineId = v.id(req.params.id), motivo = v.text(req.body.motivo, 'Motivo', 1000);
    const saved = await saveFault(req.files);
    try {
      await transaction(pool, async db => {
        const [[line]] = await db.execute('SELECT tr.*, r.nombre FROM tarea_repuestos tr LEFT JOIN repuestos r ON r.id = tr.id_repuesto WHERE tr.id = ? FOR UPDATE', [lineId]);
        if (!line) throw new v.HttpError(404, 'Repuesto no encontrado.');
        const task = await auth.taskAccess(db, req.usuario, line.id_tarea, true);
        openTask(task);
        if (line.estado === 'faltante') throw new v.HttpError(409, 'Ya se avisó que falta este repuesto.');
        // Si el sistema lo daba por retirado pero no estaba, el stock ya quedó corregido al descontarlo.
        await db.execute("UPDATE tarea_repuestos SET estado = 'faltante', motivo = ? WHERE id = ?", [motivo, lineId]);
        await storeFault(db, task.id, lineId, saved);
        await missingPart(db, req.usuario, task, `${line.nombre || line.descripcion} × ${Number(line.cantidad)}`, motivo, saved);
      });
    } catch (error) { for (const f of saved) await fs.unlink(f.filename).catch(() => {}); throw error; }
    res.json({ success: true, mensaje: 'Avisamos al supervisor que falta el repuesto, con tu evidencia.' });
  });
  // El supervisor destraba un repuesto faltante que ya no hace falta (se consiguió de otra forma, se descartó).
  router.post('/tarea-repuestos/:id/resolver', managers, async (req, res) => {
    const lineId = v.id(req.params.id), nota = v.text(req.body.nota, 'Motivo', 500);
    await transaction(pool, async db => {
      const [[line]] = await db.execute('SELECT tr.*, r.nombre FROM tarea_repuestos tr LEFT JOIN repuestos r ON r.id = tr.id_repuesto WHERE tr.id = ? FOR UPDATE', [lineId]);
      if (!line) throw new v.HttpError(404, 'Repuesto no encontrado.');
      const task = await auth.taskAccess(db, req.usuario, line.id_tarea, true);
      if (line.estado !== 'faltante') throw new v.HttpError(409, 'Este repuesto no está pendiente de compra.');
      const [[open]] = await db.execute("SELECT id FROM cotizaciones WHERE id_tarea_repuesto = ? AND estado = 'aprobada' LIMIT 1", [lineId]);
      if (open) throw new v.HttpError(409, `La cotización #${open.id} está aprobada: registra la compra en lugar de descartarlo.`);
      await db.execute("UPDATE tarea_repuestos SET estado = 'retirado' WHERE id = ?", [lineId]);
      const [[{ left }]] = await db.execute("SELECT COUNT(*) AS `left` FROM tarea_repuestos WHERE id_tarea = ? AND estado = 'faltante'", [task.id]);
      if (!Number(left)) await db.execute('UPDATE tareas SET esperando_repuesto = FALSE WHERE id = ?', [task.id]);
      await logEvent(db, task.id, req.usuario, 'repuesto_resuelto', `Marcó que ya no hace falta comprar ${line.nombre || line.descripcion}: ${nota}`);
      const [assigned] = await db.execute('SELECT id_mecanico FROM tarea_mecanicos WHERE id_tarea = ?', [task.id]);
      await notify(db, assigned.map(a => a.id_mecanico), `Ya no hace falta comprar ${line.nombre || line.descripcion} (${task.patente_camion}): ${nota}. Puedes continuar.`, task.id);
    });
    res.json({ success: true, mensaje: 'Listo: el mecánico ya puede continuar.' });
  });
  router.post('/tareas/:id/faltante', auth.allow('admin', 'encargado', 'mecanico'), faultUpload.array('evidencia', 3), async (req, res) => {
    const taskId = v.id(req.params.id), descripcion = v.text(req.body.descripcion, 'Repuesto', 200), cantidad = v.quantity(req.body.cantidad || 1);
    const motivo = v.text(req.body.motivo, 'Motivo', 1000);
    const saved = await saveFault(req.files);
    try {
      await transaction(pool, async db => {
        const task = await auth.taskAccess(db, req.usuario, taskId, true);
        openTask(task);
        const [line] = await db.execute("INSERT INTO tarea_repuestos (id_tarea, descripcion, cantidad, estado, motivo) VALUES (?, ?, ?, 'faltante', ?)", [taskId, descripcion, cantidad, motivo]);
        await storeFault(db, taskId, line.insertId, saved);
        await missingPart(db, req.usuario, task, `${descripcion} × ${Number(cantidad)}`, motivo, saved);
      });
    } catch (error) { for (const f of saved) await fs.unlink(f.filename).catch(() => {}); throw error; }
    res.status(201).json({ success: true, mensaje: 'Avisamos al supervisor que falta el repuesto, con tu evidencia.' });
  });

  // Cotizaciones: el supervisor la envía, el jefe la aprueba dentro del presupuesto mensual.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimit, files: 1, fields: 10, parts: 11 } });
  router.post('/cotizaciones/enviar', managers, upload.single('archivo'), async (req, res) => {
    const b = req.body;
    const taskId = v.id(b.id_tarea), lineId = b.id_tarea_repuesto ? v.id(b.id_tarea_repuesto) : null;
    const proveedor = v.text(b.proveedor, 'Proveedor', 120), detalle = v.text(b.detalle, 'Detalle', 2000), monto = v.amount(b.monto), cantidad = b.cantidad ? v.quantity(b.cantidad) : null;
    const stored = req.file ? await prepareFile(req.file, config, { pdf: true }) : null;
    const saved = stored ? await saveFile(stored, config) : null;
    const mes = v.today().slice(0, 7);
    let result;
    try {
      result = await transaction(pool, async db => {
        const task = await auth.taskAccess(db, req.usuario, taskId, true);
        if (task.estado === 'Aprobada') throw new v.HttpError(409, 'La tarea ya está cerrada.');
        if (lineId) {
          const [[line]] = await db.execute('SELECT id FROM tarea_repuestos WHERE id = ? AND id_tarea = ?', [lineId, taskId]);
          if (!line) throw new v.HttpError(400, 'El repuesto no pertenece a esta tarea.');
        }
        const status = await budget(db, mes);
        const [[line]] = lineId ? await db.execute('SELECT tr.motivo, tr.descripcion, r.nombre FROM tarea_repuestos tr LEFT JOIN repuestos r ON r.id = tr.id_repuesto WHERE tr.id = ?', [lineId]) : [[null]];
        const [fault] = lineId ? await db.execute("SELECT ruta_archivo FROM evidencia WHERE id_tarea_repuesto = ? AND tipo = 'falla' ORDER BY id", [lineId]) : [[]];
        const [[truck]] = await db.execute('SELECT estado_operativo FROM camiones WHERE patente = ?', [task.patente_camion]);
        const [insert] = await db.execute('INSERT INTO cotizaciones (id_tarea, id_tarea_repuesto, proveedor, detalle, cantidad, monto, ruta_archivo, mes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [taskId, lineId, proveedor, detalle, cantidad, monto, saved?.ruta || null, mes, req.usuario.id]);
        const exceso = status.comprometido + Number(monto) - (status.monto || 0);
        await logEvent(db, taskId, req.usuario, 'cotizacion', `Subió la cotización #${insert.insertId}: ${detalle} (${proveedor})`, monto);
        const [[boss]] = await db.execute("SELECT telefono FROM usuarios WHERE rol = 'jefe' AND telefono IS NOT NULL ORDER BY id LIMIT 1");
        const lines = [
          `*Cotización #${insert.insertId} por aprobar*`,
          `Tarea: ${task.tipo_tarea} · Camión ${task.patente_camion}`,
          `Detalle: ${detalle}${cantidad ? ` (× ${Number(cantidad)})` : ''}`,
          `Proveedor: ${proveedor}`,
          `Monto: ${clp(monto)}`,
          ...(truck?.estado_operativo === 'panne' ? ['🚫 El camión está en panne: no puede operar hasta hacer este trabajo.'] : []),
          ...(line?.motivo ? [`Por qué se necesita (mecánico): ${line.motivo}`] : []),
          ...fault.map((f, i) => `Evidencia ${i + 1}: ${config.publicUrl}${f.ruta_archivo}`),
          status.definido ? `Presupuesto ${mes}: usado ${clp(status.comprometido)} de ${clp(status.monto)} · disponible ${clp(status.disponible)}` : `Presupuesto ${mes}: aún no está definido.`,
          ...(exceso > 0 ? [`⚠️ Fuera del presupuesto mensual por ${clp(exceso)}. Si la apruebas, ese monto se suma al límite del mes.`] : []),
          `Revisar en la OT: ${config.publicUrl}/?tarea=${taskId}`,
          ...(config.whatsappWebhookToken && whatsapp.enabled() ? [`Para aprobar responde: *APROBAR ${insert.insertId}*`, `Para rechazar: *RECHAZAR ${insert.insertId} motivo*`] : []),
          `Enviada por ${req.usuario.nombre}`,
        ];
        await notify(db, ['jefe'], `Cotización por aprobar: ${detalle.slice(0, 80)} · ${clp(monto)} (${task.patente_camion})${exceso > 0 ? ` · excede el presupuesto en ${clp(exceso)}` : ''}.`, taskId,
          { text: lines.join('\n'), media: [...fault.map(f => f.ruta_archivo), saved?.ruta] });
        return { id: insert.insertId, exceso: Math.max(0, exceso), whatsapp: whatsapp.enabled() ? null : { telefono: boss?.telefono || null, mensaje: lines.join('\n') } };
      });
    } catch (error) {
      if (saved) await fs.unlink(saved.filename).catch(() => {});
      throw error;
    }
    const sent = whatsapp.enabled() ? ' El jefe la recibió por WhatsApp.' : '';
    res.status(201).json({ success: true, ...result, mensaje: (result.exceso ? `Cotización guardada en la OT. Excede el presupuesto del mes en ${clp(result.exceso)}.` : 'Cotización guardada en la OT.') + sent });
  });
  // Solicitud de compra sin OT (herramientas, insumos o repuestos para bodega): el jefe la aprueba igual que una cotización.
  router.post('/cotizaciones/compra', managers, upload.single('archivo'), async (req, res) => {
    const b = req.body;
    if (!Object.hasOwn(CATEGORIES, b.categoria)) throw new v.HttpError(400, 'Elige qué tipo de compra es.');
    const detalle = v.text(b.detalle, 'Qué se compra', 2000), proveedor = v.text(b.proveedor, 'Proveedor', 120), monto = v.amount(b.monto);
    const cantidad = b.cantidad ? v.quantity(b.cantidad) : null, motivo = v.text(b.motivo, 'Por qué hace falta', 1000);
    const idRepuesto = b.id_repuesto ? v.id(b.id_repuesto) : null;
    const saved = req.file ? await saveFile(await prepareFile(req.file, config, { pdf: true }), config) : null;
    const mes = v.today().slice(0, 7);
    let result;
    try {
      result = await transaction(pool, async db => {
        if (idRepuesto) { const [[part]] = await db.execute('SELECT id FROM repuestos WHERE id = ?', [idRepuesto]); if (!part) throw new v.HttpError(400, 'El repuesto no existe en el inventario.'); }
        const status = await budget(db, mes);
        const [insert] = await db.execute('INSERT INTO cotizaciones (id_tarea, categoria, motivo, id_repuesto, proveedor, detalle, cantidad, monto, ruta_archivo, mes, created_by) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [b.categoria, motivo, idRepuesto, proveedor, detalle, cantidad, monto, saved?.ruta || null, mes, req.usuario.id]);
        const exceso = status.comprometido + Number(monto) - (status.monto || 0);
        const [[boss]] = await db.execute("SELECT telefono FROM usuarios WHERE rol = 'jefe' AND telefono IS NOT NULL ORDER BY id LIMIT 1");
        const lines = [
          `*Solicitud de compra #${insert.insertId} por aprobar (sin OT)*`,
          `Tipo: ${CATEGORIES[b.categoria]}`,
          `Detalle: ${detalle}${cantidad ? ` (× ${Number(cantidad)})` : ''}`,
          `Por qué hace falta: ${motivo}`,
          `Proveedor: ${proveedor}`,
          `Monto: ${clp(monto)}`,
          status.definido ? `Presupuesto ${mes}: usado ${clp(status.comprometido)} de ${clp(status.monto)} · disponible ${clp(status.disponible)}` : `Presupuesto ${mes}: aún no está definido.`,
          ...(exceso > 0 ? [`⚠️ Fuera del presupuesto mensual por ${clp(exceso)}. Si la apruebas, ese monto se suma al límite del mes.`] : []),
          `Ver las compras del mes: ${config.publicUrl}/#compras`,
          ...(config.whatsappWebhookToken && whatsapp.enabled() ? [`Para aprobar responde: *APROBAR ${insert.insertId}*`, `Para rechazar: *RECHAZAR ${insert.insertId} motivo*`] : []),
          `Solicitada por ${req.usuario.nombre}`,
        ];
        await notify(db, ['jefe'], `Solicitud de compra (sin OT): ${detalle.slice(0, 80)} · ${clp(monto)}${exceso > 0 ? ` · excede el presupuesto en ${clp(exceso)}` : ''}.`, null, { text: lines.join('\n'), media: [saved?.ruta] });
        return { id: insert.insertId, exceso: Math.max(0, exceso), whatsapp: whatsapp.enabled() ? null : { telefono: boss?.telefono || null, mensaje: lines.join('\n') } };
      });
    } catch (error) {
      if (saved) await fs.unlink(saved.filename).catch(() => {});
      throw error;
    }
    res.status(201).json({ success: true, ...result, mensaje: `Solicitud guardada en Compras${whatsapp.enabled() ? ' y enviada al jefe por WhatsApp' : ''}.` });
  });
  router.get('/cotizaciones', viewers, async (req, res) => {
    const mes = req.query.mes ? v.month(req.query.mes) : v.today().slice(0, 7);
    const [cotizaciones] = await pool.execute(`SELECT c.*, t.tipo_tarea, t.patente_camion, t.prioridad, u.nombre AS creador, d.nombre AS decisor, r.nombre AS repuesto_nombre, r.unidad AS repuesto_unidad
      FROM cotizaciones c LEFT JOIN tareas t ON t.id = c.id_tarea LEFT JOIN repuestos r ON r.id = c.id_repuesto JOIN usuarios u ON u.id = c.created_by LEFT JOIN usuarios d ON d.id = c.decided_by
      WHERE c.mes = ? ORDER BY FIELD(c.estado, 'pendiente', 'aprobada', 'recibida', 'rechazada'), c.created_at DESC`, [mes]);
    res.json({ success: true, cotizaciones: await withExcess(pool, cotizaciones), presupuesto: await budget(pool, mes) });
  });
  router.put('/presupuesto/:mes', deciders, async (req, res) => {
    const mes = v.month(req.params.mes), monto = v.amount(req.body.monto);
    await pool.execute('INSERT INTO presupuestos (mes, monto, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE monto = VALUES(monto), updated_by = VALUES(updated_by)', [mes, monto, req.usuario.id]);
    res.json({ success: true, mensaje: `Presupuesto de ${mes} guardado: ${clp(monto)}.` });
  });
  router.post('/cotizaciones/:id/decidir', deciders, async (req, res) => {
    const decision = v.oneOf(req.body.decision, ['aprobar', 'rechazar'], 'Decisión');
    const result = await decideQuote(pool, v.id(req.params.id), decision, req.body.nota, req.usuario, config);
    res.json({ success: true, mensaje: result.mensaje });
  });
  // Compra recibida: entra al inventario y, si era para un repuesto faltante, se retira para la tarea.
  // El supervisor registra la compra: comprobante opcional (foto o PDF), queda como gasto de la tarea,
  // el repuesto entra al inventario y se entrega a la tarea, y se prepara el WhatsApp al jefe.
  const purchaseUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimit, files: 2, fields: 2, parts: 4 } });
  router.post('/cotizaciones/:id/recibir', managers, purchaseUpload.fields([{ name: 'comprobante', maxCount: 1 }, { name: 'producto', maxCount: 1 }]), async (req, res) => {
    const quoteId = v.id(req.params.id);
    const receiptFile = req.files?.comprobante?.[0], productFile = req.files?.producto?.[0];
    const saved = receiptFile ? await saveFile(await prepareFile(receiptFile, config, { pdf: true }), config) : null;
    let product = null;
    try { product = productFile ? await saveFile(await prepareFile(productFile, config), config) : null; }
    catch (error) { if (saved) await fs.unlink(saved.filename).catch(() => {}); throw error; }
    let result;
    try {
      result = await transaction(pool, async db => {
        const [[quote]] = await db.execute('SELECT * FROM cotizaciones WHERE id = ? FOR UPDATE', [quoteId]);
        if (!quote) throw new v.HttpError(404, 'Cotización no encontrada.');
        if (quote.estado !== 'aprobada') throw new v.HttpError(409, 'Solo se registran compras aprobadas.');
        const task = quote.id_tarea ? await auth.taskAccess(db, req.usuario, quote.id_tarea, true) : null;
        // Compra sin OT para un repuesto del inventario: entra al stock.
        const bought = `Compra: ${quote.detalle} (${quote.proveedor})`;
        if (!task && quote.id_repuesto) await move(db, { id_repuesto: quote.id_repuesto, cantidad: quote.cantidad || 1, motivo: bought, id_cotizacion: quote.id, usuario: req.usuario });
        const [[line]] = quote.id_tarea_repuesto ? await db.execute('SELECT * FROM tarea_repuestos WHERE id = ? FOR UPDATE', [quote.id_tarea_repuesto]) : [[null]];
        if (line && line.estado !== 'retirado') {
          if (line.id_repuesto) {
            const stock = await move(db, { id_repuesto: line.id_repuesto, cantidad: quote.cantidad || line.cantidad, motivo: `${bought} · OT #${quote.id_tarea}`, id_cotizacion: quote.id, id_tarea: quote.id_tarea, patente: task?.patente_camion, usuario: req.usuario });
            if (stock >= Number(line.cantidad)) {
              await move(db, { id_repuesto: line.id_repuesto, cantidad: -line.cantidad, motivo: `OT #${quote.id_tarea} · ${task?.tipo_tarea || ''}`, id_tarea: quote.id_tarea, patente: task?.patente_camion, usuario: req.usuario });
              await db.execute("UPDATE tarea_repuestos SET estado = 'retirado' WHERE id = ?", [line.id]);
            } else await db.execute("UPDATE tarea_repuestos SET estado = 'pendiente' WHERE id = ?", [line.id]);
          } else await db.execute("UPDATE tarea_repuestos SET estado = 'retirado' WHERE id = ?", [line.id]);
        }
        await db.execute("UPDATE cotizaciones SET estado = 'recibida', received_at = UTC_TIMESTAMP(), ruta_comprobante = ?, ruta_foto_compra = ? WHERE id = ?", [saved?.ruta || null, task ? null : product?.ruta || null, quoteId]);
        if (task) {
          await db.execute("INSERT INTO gastos (id_tarea, concepto, monto, tipo, fecha) VALUES (?, ?, ?, 'compra', ?)", [quote.id_tarea, `Compra: ${quote.detalle} (${quote.proveedor})`.slice(0, 200), quote.monto, v.today()]);
          if (product) await db.execute("INSERT INTO evidencia (id_tarea, ruta_archivo, tipo, fecha, id_tarea_repuesto, id_cotizacion) VALUES (?, ?, 'compra', ?, ?, ?)", [quote.id_tarea, product.ruta, v.today(), quote.id_tarea_repuesto, quote.id]);
          await logEvent(db, quote.id_tarea, req.usuario, 'compra', `Compró ${quote.detalle} (${quote.proveedor})${saved ? ' · con comprobante' : ''}${product ? ' · con foto de lo comprado' : ''}`, quote.monto);
          const [[{ left }]] = await db.execute("SELECT COUNT(*) AS `left` FROM tarea_repuestos WHERE id_tarea = ? AND estado = 'faltante'", [quote.id_tarea]);
          if (!Number(left)) await db.execute('UPDATE tareas SET esperando_repuesto = FALSE WHERE id = ?', [quote.id_tarea]);
          const [assigned] = await db.execute('SELECT id_mecanico FROM tarea_mecanicos WHERE id_tarea = ?', [quote.id_tarea]);
          await notify(db, assigned.map(a => a.id_mecanico), `Llegó el repuesto: ${quote.detalle.slice(0, 80)}. Ya puedes continuar la tarea.`, quote.id_tarea);
        }
        const [[boss]] = await db.execute("SELECT telefono FROM usuarios WHERE rol = 'jefe' AND telefono IS NOT NULL ORDER BY id LIMIT 1");
        const lines = [
          `*✅ Compra realizada · Cotización #${quote.id}*`,
          task ? `Tarea: ${task.tipo_tarea} · Camión ${task.patente_camion}` : `Compra sin OT: ${CATEGORIES[quote.categoria] || 'Compra'}`,
          `Detalle: ${quote.detalle}${quote.cantidad ? ` (× ${Number(quote.cantidad)})` : ''}`,
          `Proveedor: ${quote.proveedor}`,
          `Monto: ${clp(quote.monto)}`,
          saved ? `Comprobante: ${config.publicUrl}${saved.ruta}` : 'Comprobante: no se adjuntó.',
          ...(product ? [`Foto de lo comprado: ${config.publicUrl}${product.ruta}`] : []),
          task ? `Ver la tarea: ${config.publicUrl}/?tarea=${quote.id_tarea}` : `Ver las compras del mes: ${config.publicUrl}/#compras`,
          `Registrada por ${req.usuario.nombre}`,
        ];
        await notify(db, ['jefe'], `Compra realizada: ${quote.detalle.slice(0, 80)} · ${clp(quote.monto)} (${aboutQuote(quote, task)})${saved ? ' · con comprobante' : ''}.`, quote.id_tarea,
          { text: lines.join('\n'), media: [saved?.ruta, product?.ruta] });
        return { whatsapp: whatsapp.enabled() ? null : { telefono: boss?.telefono || null, mensaje: lines.join('\n') },
          mensaje: task ? 'Compra registrada: el repuesto se entregó a la tarea.' : `Compra registrada${quote.id_repuesto ? ' y sumada al inventario' : ''}.` };
      });
    } catch (error) {
      for (const f of [saved, product]) if (f) await fs.unlink(f.filename).catch(() => {});
      throw error;
    }
    res.json({ success: true, ...result });
  });

  // Avisos dentro de la app
  router.get('/notificaciones', async (req, res) => {
    const [notificaciones] = await pool.execute('SELECT id, mensaje, id_tarea, leida, created_at FROM notificaciones WHERE id_usuario = ? ORDER BY id DESC LIMIT 30', [req.usuario.id]);
    const [[{ sin_leer }]] = await pool.execute('SELECT COUNT(*) AS sin_leer FROM notificaciones WHERE id_usuario = ? AND leida = FALSE', [req.usuario.id]);
    res.json({ success: true, notificaciones, sin_leer: Number(sin_leer) });
  });
  router.post('/notificaciones/leer', async (req, res) => {
    if (req.body.id) await pool.execute('UPDATE notificaciones SET leida = TRUE WHERE id = ? AND id_usuario = ?', [v.id(req.body.id), req.usuario.id]);
    else await pool.execute('UPDATE notificaciones SET leida = TRUE WHERE id_usuario = ?', [req.usuario.id]);
    res.json({ success: true });
  });

  // Mantención por kilometraje
  router.get('/planes', viewers, async (req, res) => {
    const [planes] = await pool.execute('SELECT id, nombre, cada_km, descripcion, repuestos_json FROM planes_mantencion ORDER BY cada_km, nombre');
    const [estado] = await pool.execute(`SELECT c.patente, c.numero, c.modelo, c.prioridad, c.km_actual, c.km_actualizado_at, p.id AS id_plan, cp.km_ultimo,
        (SELECT t.id FROM tareas t WHERE t.patente_camion = c.patente AND t.id_plan = p.id AND t.estado <> 'Aprobada' ORDER BY t.id DESC LIMIT 1) AS tarea_abierta
      FROM camiones c CROSS JOIN planes_mantencion p LEFT JOIN camion_planes cp ON cp.patente = c.patente AND cp.id_plan = p.id ORDER BY c.patente, p.cada_km`);
    res.json({ success: true, planes: planes.map(p => ({ ...p, repuestos: typeof p.repuestos_json === 'string' ? JSON.parse(p.repuestos_json) : p.repuestos_json || [] })), estado, tts: !!config.ttsDatabaseUrl });
  });
  const planFields = body => {
    const parts = body.repuestos ?? [];
    if (!Array.isArray(parts) || parts.length > 30) throw new v.HttpError(400, 'Agrega hasta 30 repuestos al plan.');
    const repuestos = parts.map(p => ({ id_repuesto: v.id(p.id_repuesto), cantidad: Number(v.quantity(p.cantidad)) }));
    const cada = v.km(body.cada_km);
    if (!cada || cada < 100) throw new v.HttpError(400, 'El intervalo debe ser de al menos 100 km.');
    return [v.text(body.nombre, 'Nombre', 100), cada, v.text(body.descripcion, 'Descripción', 5000, true), JSON.stringify(repuestos)];
  };
  router.post('/planes', managers, async (req, res) => {
    await pool.execute('INSERT INTO planes_mantencion (nombre, cada_km, descripcion, repuestos_json) VALUES (?, ?, ?, ?)', planFields(req.body));
    await checkDue(pool);
    res.status(201).json({ success: true, mensaje: 'Plan de mantención creado.' });
  });
  router.put('/planes/:id', managers, async (req, res) => {
    const [result] = await pool.execute('UPDATE planes_mantencion SET nombre = ?, cada_km = ?, descripcion = ?, repuestos_json = ? WHERE id = ?', [...planFields(req.body), v.id(req.params.id)]);
    v.affected(result);
    res.json({ success: true, mensaje: 'Plan actualizado.' });
  });
  router.delete('/planes/:id', managers, async (req, res) => {
    const [result] = await pool.execute('DELETE FROM planes_mantencion WHERE id = ?', [v.id(req.params.id)]);
    v.affected(result);
    res.json({ success: true, mensaje: 'Plan eliminado.' });
  });
  router.put('/camion-planes/:patente/:plan', managers, async (req, res) => {
    const km = v.km(req.body.km_ultimo);
    if (km === null) throw new v.HttpError(400, 'Ingresa el kilometraje de la última mantención.');
    await pool.execute('INSERT INTO camion_planes (patente, id_plan, km_ultimo) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE km_ultimo = VALUES(km_ultimo), avisado = FALSE, avisado_pronto = FALSE', [v.text(req.params.patente, 'Patente', 10), v.id(req.params.plan), km]);
    await checkDue(pool);
    res.json({ success: true, mensaje: 'Última mantención actualizada.' });
  });
  // Km real del tablero de toda la flota de una vez: se descarga la plantilla con las patentes, se llena «Km tablero» y se sube.
  // Cada km cargado pasa a ser la lectura base del camión (igual que «Km actual»); desde ahí se suman las rutas de TTS.
  router.get('/camiones/km/plantilla', managers, async (req, res) => {
    const [trucks] = await pool.execute('SELECT patente, numero, modelo, km_actual FROM camiones ORDER BY CAST(numero AS UNSIGNED), patente');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Km tablero');
    sheet.columns = [{ header: 'Patente', width: 12 }, { header: 'Número', width: 9 }, { header: 'Modelo', width: 22 }, { header: 'Km en el sistema', width: 17 }, { header: 'Km tablero', width: 14 }];
    trucks.forEach(t => sheet.addRow([t.patente, t.numero, t.modelo, t.km_actual, null]));
    sheet.getRow(1).font = { bold: true };
    sheet.getColumn(5).eachCell((cell, n) => { if (n > 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF9C3' } }; });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="km_tablero.xlsx"');
    await workbook.xlsx.write(res); res.end();
  });
  router.post('/camiones/km/excel', managers, excelUpload.single('archivo'), async (req, res) => {
    if (!req.file) throw new v.HttpError(400, 'Adjunta el archivo Excel (.xlsx).');
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(req.file.buffer); }
    catch { throw new v.HttpError(400, 'El archivo no es un Excel .xlsx válido. Guárdalo como «Libro de Excel (.xlsx)».'); }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new v.HttpError(400, 'El Excel no tiene hojas.');
    const col = {};
    sheet.getRow(1).eachCell((cell, i) => {
      const key = headerKey(cellValue(cell.value));
      if (key === 'patente') col.patente ||= i;
      else if (['numero', 'n', 'nro', 'camion'].includes(key)) col.numero ||= i;
      else if (['kmtablero', 'km', 'kilometraje', 'kmreal', 'odometro'].includes(key)) col.km ||= i;
    });
    if (!col.km || (!col.patente && !col.numero)) throw new v.HttpError(400, 'La primera fila debe tener los títulos «Patente» y «Km tablero». Usa la plantilla.');
    const [trucks] = await pool.execute('SELECT patente, numero FROM camiones');
    const byPlate = new Map(trucks.map(t => [normalize(t.patente), t.patente]));
    const updates = [], errors = [];
    for (let n = 2; n <= sheet.rowCount; n++) {
      const row = sheet.getRow(n);
      const read = key => col[key] ? String(cellValue(row.getCell(col[key]).value)).trim() : '';
      const raw = read('km');
      if (!raw) continue; // fila sin km: ese camión no se toca
      let patente = byPlate.get(normalize(read('patente')));
      // Sin patente, por número (solo si ningún otro camión tiene el mismo número)
      if (!patente && !read('patente') && read('numero')) {
        const same = trucks.filter(t => normalize(t.numero) === normalize(read('numero')));
        if (same.length === 1) patente = same[0].patente;
        else if (same.length > 1) { errors.push(`Fila ${n}: hay ${same.length} camiones con el N° ${read('numero')}; escribe la patente`); continue; }
      }
      if (!patente) { errors.push(`Fila ${n}: el camión ${read('patente') || read('numero')} no existe`); continue; }
      // Número de Excel tal cual; escrito como texto admite puntos de miles («182.400») y coma decimal.
      const value = cellValue(row.getCell(col.km).value);
      const km = typeof value === 'number' ? value : Number(raw.replace(/[.\s]/g, '').replace(',', '.'));
      if (!Number.isFinite(km) || km < 0 || km > 3000000) { errors.push(`Fila ${n}: km «${raw}» no válido`); continue; }
      updates.push([Math.round(km), patente]);
    }
    if (errors.length) throw new v.HttpError(400, `No se cargó nada. Corrige el Excel: ${errors.slice(0, 10).join(' · ')}`);
    if (!updates.length) throw new v.HttpError(400, 'Llena la columna «Km tablero» de los camiones que quieras corregir.');
    await transaction(pool, async db => {
      for (const [km, patente] of updates) await db.execute('UPDATE camiones SET km_actual = ?, km_base = ?, km_base_fecha = ?, km_base_at = UTC_TIMESTAMP(), km_manual = TRUE, km_actualizado_at = UTC_TIMESTAMP() WHERE patente = ?', [km, km, v.today(), patente]);
    });
    await checkDue(pool);
    require('../services/changes').bump();
    res.json({ success: true, mensaje: `Km del tablero cargado en ${updates.length} camión${updates.length === 1 ? '' : 'es'}. Desde ahora se les suman las rutas de TTS.` });
  });
  router.put('/camiones/km/:patente', managers, async (req, res) => {
    const km = v.km(req.body.km_actual);
    if (km === null) throw new v.HttpError(400, 'Ingresa el kilometraje actual.');
    // El ajuste manual pasa a ser la lectura base: se le suman las rutas de TTS que partan después.
    const [result] = await pool.execute('UPDATE camiones SET km_actual = ?, km_base = ?, km_base_fecha = ?, km_base_at = UTC_TIMESTAMP(), km_manual = TRUE, km_actualizado_at = UTC_TIMESTAMP() WHERE patente = ?', [km, km, v.today(), v.text(req.params.patente, 'Patente', 10)]);
    v.affected(result);
    await checkDue(pool);
    res.json({ success: true, mensaje: 'Kilometraje actualizado.' });
  });
  // Km recorridos por camión: hoy, 7 y 30 días, mes en curso y el detalle diario del período.
  router.get('/camiones/km-diario', viewers, async (req, res) => {
    const days = Math.min(90, Math.max(7, Number.parseInt(req.query.dias, 10) || 14));
    const day = v.today(), month = day.slice(0, 8) + '01';
    const [[camiones], [dias]] = await Promise.all([
      pool.execute(`SELECT c.patente, c.numero, c.modelo, c.km_actual, c.km_actualizado_at,
          COALESCE(SUM(CASE WHEN d.fecha = ? THEN d.km END), 0) AS hoy,
          COALESCE(SUM(CASE WHEN d.fecha > DATE_SUB(?, INTERVAL 7 DAY) THEN d.km END), 0) AS semana,
          COALESCE(SUM(CASE WHEN d.fecha > DATE_SUB(?, INTERVAL 30 DAY) THEN d.km END), 0) AS treinta,
          COALESCE(SUM(CASE WHEN d.fecha >= ? THEN d.km END), 0) AS mes,
          COUNT(CASE WHEN d.fecha > DATE_SUB(?, INTERVAL 30 DAY) AND d.km > 0 THEN 1 END) AS dias_activos
        FROM camiones c LEFT JOIN camion_km_diario d ON d.patente = c.patente AND d.fecha > DATE_SUB(?, INTERVAL 40 DAY)
        GROUP BY c.patente, c.numero, c.modelo, c.km_actual, c.km_actualizado_at ORDER BY c.patente`, [day, day, day, month, day, day]),
      pool.execute("SELECT patente, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, km, rutas FROM camion_km_diario WHERE fecha > DATE_SUB(?, INTERVAL ? DAY) ORDER BY fecha", [day, days]),
    ]);
    res.json({ success: true, hoy: day, dias: days, camiones, diario: dias, tts: !!config.ttsDatabaseUrl });
  });
  router.post('/camiones/sincronizar-km', managers, async (req, res) => {
    if (!config.ttsDatabaseUrl) throw new v.HttpError(409, 'La conexión con TTS no está configurada.');
    let result;
    try { result = await syncTts(pool, config.ttsDatabaseUrl); }
    catch { throw new v.HttpError(502, 'No pudimos leer el kilometraje desde TTS. Inténtalo más tarde.'); }
    res.json({ success: true, ...result, mensaje: `Kilometraje sincronizado con TTS: ${result.updated} camión(es) actualizado(s).` });
  });
  return router;
};
module.exports.budget = budget;
module.exports.decideQuote = decideQuote;
