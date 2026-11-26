const { Router } = require('express');
const PDFDocument = require('pdfkit');
const v = require('../validation');
const { transaction } = require('../db');
const { notify } = require('../services/notify');
const { logEvent } = require('../services/events');
const { TEMPLATE, NAME, validate, issues } = require('../services/checklist');
const { header, footer, fmtDate, fmtTime, INK, MUTED, LINE, OK, WARN } = require('../services/fuelReport');

// Checklist de salida de taller: lo llena el mecánico al terminar la OT (sin él no puede marcarla realizada).
// Si hay fallas u observaciones, el supervisor recibe un aviso. La oficina ve el historial por día y lo descarga en PDF.
module.exports = function checklists(pool, auth) {
  const router = Router();
  const office = auth.allow('admin', 'encargado', 'jefe');
  const select = `SELECT c.id, c.id_tarea, c.patente, DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha, c.km, c.items, c.observaciones, c.fallas, c.created_at, c.updated_at, c.conductor,
      COALESCE(u.nombre, c.conductor) AS responsable, t.tipo_tarea, cam.numero, cam.modelo
    FROM checklists c LEFT JOIN usuarios u ON u.id = c.id_usuario LEFT JOIN tareas t ON t.id = c.id_tarea LEFT JOIN camiones cam ON cam.patente = c.patente COLLATE utf8mb4_unicode_ci`;
  const parse = row => ({ ...row, items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items });

  router.get('/checklist/plantilla', (req, res) => res.json({ success: true, plantilla: TEMPLATE }));

  router.get('/tareas/:id/checklist', async (req, res) => {
    const taskId = v.id(req.params.id);
    await auth.taskAccess(pool, req.usuario, taskId);
    const [[row]] = await pool.execute(`${select} WHERE c.id_tarea = ?`, [taskId]);
    res.json({ success: true, checklist: row ? parse(row) : null });
  });

  router.put('/tareas/:id/checklist', auth.allow('mecanico', 'encargado', 'admin'), async (req, res) => {
    const taskId = v.id(req.params.id);
    const items = validate(req.body.items, v.HttpError);
    const general = typeof req.body.observaciones === 'string' && req.body.observaciones.trim() ? req.body.observaciones.trim().slice(0, 2000) : null;
    const fallas = items.filter(i => i.estado === 'falla').length;
    const found = issues(items, general);
    await transaction(pool, async db => {
      const task = await auth.taskAccess(db, req.usuario, taskId, true);
      if (task.estado !== 'En_Trabajo') throw new v.HttpError(409, 'El checklist se llena con la tarea en trabajo, antes de marcarla realizada.');
      const [[truck]] = await db.execute('SELECT km_actual FROM camiones WHERE patente = ?', [task.patente_camion]);
      await db.execute(`INSERT INTO checklists (id_tarea, patente, fecha, id_usuario, km, items, observaciones, fallas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE fecha = VALUES(fecha), id_usuario = VALUES(id_usuario), km = VALUES(km), items = VALUES(items), observaciones = VALUES(observaciones), fallas = VALUES(fallas), updated_at = UTC_TIMESTAMP()`,
      [taskId, task.patente_camion, v.today(), req.usuario.id, truck?.km_actual ?? null, JSON.stringify(items), general, fallas]);
      await logEvent(db, taskId, req.usuario, 'checklist', found.length ? `Llenó el checklist de salida con ${found.length} observación(es): ${found.join('; ')}` : 'Llenó el checklist de salida: todo bien.');
      if (found.length) await notify(db, ['encargado'], `Checklist ${task.patente_camion} (OT #${taskId}): ${found.join('; ')}`, taskId);
    });
    res.json({ success: true, mensaje: found.length ? `Checklist guardado. El supervisor recibió el aviso de ${found.length} observación(es).` : 'Checklist guardado: todo bien.' });
  });

  // Historial: por defecto los últimos 30 días; filtros por período y patente.
  router.get('/checklists', office, async (req, res) => {
    const where = [], params = [];
    if (req.query.desde || req.query.hasta) {
      const [desde, hasta] = v.dateRange({ fecha_inicio: req.query.desde, fecha_fin: req.query.hasta });
      where.push('c.fecha BETWEEN ? AND ?'); params.push(desde, hasta);
    } else { where.push('c.fecha > DATE_SUB(?, INTERVAL 30 DAY)'); params.push(v.today()); }
    if (req.query.patente) { where.push('c.patente = ?'); params.push(v.text(req.query.patente, 'Patente', 10)); }
    const [rows] = await pool.execute(`${select} WHERE ${where.join(' AND ')} ORDER BY c.fecha DESC, c.created_at DESC LIMIT 1000`, params);
    res.json({ success: true, hoy: v.today(), checklists: rows.map(parse) });
  });

  // PDF de un checklist (?id=) o de todos los de un día (?fecha=).
  router.get('/checklists/pdf', office, async (req, res) => {
    const [rows] = req.query.id
      ? await pool.execute(`${select} WHERE c.id = ?`, [v.id(req.query.id)])
      : await pool.execute(`${select} WHERE c.fecha = ? ORDER BY c.created_at`, [req.query.fecha ? v.date(req.query.fecha) : v.today()]);
    if (!rows.length) throw new v.HttpError(404, 'No hay checklists para descargar.');
    const list = rows.map(parse);
    const name = req.query.id ? `checklist_${list[0].patente}_${list[0].fecha}.pdf` : `checklists_${list[0].fecha}.pdf`;
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: name, Author: 'Travel Trans Logística' } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    doc.pipe(res);
    list.forEach((c, i) => { if (i) doc.addPage(); page(doc, c); });
    footer(doc, req.query.id ? `Checklist ${list[0].patente}` : `Checklists ${fmtDate(list[0].fecha)}`);
    doc.end();
  });
  return router;
};

// Una hoja por checklist, con el mismo orden que la hoja de papel.
function page(doc, c) {
  header(doc, 'Check List - Mantenimiento', `${c.patente}${c.numero ? ` · N° ${c.numero}` : ''}${c.id_tarea ? ` · OT #${c.id_tarea}${c.tipo_tarea ? ` ${c.tipo_tarea}` : ''}` : ''}`);
  const info = [['Responsable', c.responsable || '—'], ['Fecha', `${fmtDate(c.fecha)} ${fmtTime(c.updated_at || c.created_at)}`], ['Patente', c.patente], ['Km', c.km ? `${Number(c.km).toLocaleString('es-CL')} km` : '—']];
  info.forEach(([label, value], i) => {
    const x = 40 + i * 129;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, x, 98, { width: 125 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(value, x, 110, { width: 125, lineBreak: false, ellipsis: true });
  });
  let y = 136;
  const byCode = Object.fromEntries(c.items.map(i => [i.codigo, i]));
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('ÍTEM', 40, y).text('ESTADO', 330, y).text('OBSERVACIONES', 390, y);
  y += 14;
  for (const group of TEMPLATE) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(group.titulo.toUpperCase(), 40, y); y += 15;
    for (const { codigo } of group.items) {
      const item = byCode[codigo] || {};
      const obsHeight = item.obs ? doc.font('Helvetica').fontSize(8.5).heightOfString(item.obs, { width: 165 }) : 0;
      const h = Math.max(15, obsHeight + 4);
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(`${codigo} ${NAME[codigo]}`, 50, y, { width: 275 });
      const bad = item.estado === 'falla';
      doc.font('Helvetica-Bold').fontSize(9).fillColor(bad ? WARN : OK).text(bad ? 'Falla' : item.estado === 'ok' ? 'Bien' : '—', 330, y);
      if (item.obs) doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(item.obs, 390, y, { width: 165 });
      y += h;
      doc.moveTo(40, y - 2).lineTo(555, y - 2).lineWidth(0.4).strokeColor(LINE).stroke();
    }
    y += 4;
  }
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Observaciones generales', 40, y + 6);
  doc.font('Helvetica').fontSize(10).fillColor(c.observaciones ? INK : MUTED).text(c.observaciones || 'Sin observaciones.', 40, y + 21, { width: 515 });
  const sign = Math.max(doc.y + 40, 740);
  doc.moveTo(40, sign).lineTo(240, sign).lineWidth(0.8).strokeColor(INK).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Responsable: ${c.responsable || '—'}`, 40, sign + 4);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(c.fallas ? WARN : OK).text(c.fallas ? `${c.fallas} ítem(s) con falla` : 'Todos los ítems bien', 355, sign - 10, { width: 200, align: 'right' });
}
