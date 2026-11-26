const fs = require('node:fs/promises');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

// Informe de combustible en PDF (A4): del día (todos los camiones) o de un camión en un período.
const INK = '#1D1D1F', MUTED = '#707070', RED = '#E00000', LINE = '#D6D6D6', OK = '#1A7F37', WARN = '#B25000';
const LEVELS = { 10: 'Reserva', 25: '1/4', 50: '1/2', 75: '3/4', 100: 'Lleno' };
const LOGO = path.resolve(__dirname, '../../../frontend/public/assets/logo-travel-trans.png');
const fmtDate = d => { const [y, m, day] = String(d).slice(0, 10).split('-'); return `${day}-${m}-${y}`; };
const fmtTime = v => v ? new Date(String(v).replace(' ', 'T') + (String(v).endsWith('Z') ? '' : 'Z')).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }) : '';

// Las fotos se guardan en WebP; PDFKit necesita JPEG o PNG.
async function photo(uploads, ruta) {
  try { return await sharp(await fs.readFile(path.join(uploads, path.basename(ruta)))).rotate().resize(480, 360, { fit: 'inside' }).jpeg({ quality: 72 }).toBuffer(); }
  catch { return null; }
}

function header(doc, title, subtitle) {
  try { doc.image(LOGO, 40, 32, { height: 40 }); } catch { /* sin logo: solo texto */ }
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(title, 200, 34, { width: 355, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(subtitle, 200, 58, { width: 355, align: 'right' });
  doc.moveTo(40, 84).lineTo(555, 84).lineWidth(1.5).strokeColor(INK).stroke();
  doc.y = 98;
}

function summary(doc, items) {
  const w = 515 / items.length, y = doc.y;
  items.forEach(([label, value, color], i) => {
    const x = 40 + i * w;
    doc.roundedRect(x + 2, y, w - 4, 46, 8).fill('#F5F5F7');
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, x + 12, y + 8, { width: w - 24, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(color || INK).text(String(value), x + 12, y + 22, { width: w - 24, lineBreak: false });
  });
  doc.y = y + 58;
}

function levelBar(doc, x, y, nivel) {
  doc.roundedRect(x, y, 80, 7, 3.5).fill('#E8E8ED');
  doc.roundedRect(x, y, Math.max(6, 80 * nivel / 100), 7, 3.5).fill(nivel <= 25 ? WARN : OK);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(nivel <= 25 ? WARN : INK).text(LEVELS[nivel] || `${nivel}%`, x + 88, y - 2);
}

// Tarjeta de un registro: datos a la izquierda, foto del indicador a la derecha.
async function card(doc, r, uploads, showDate) {
  const h = 118;
  if (doc.y + h > 790) { doc.addPage(); doc.y = 40; }
  const y = doc.y;
  doc.roundedRect(40, y, 515, h, 10).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(showDate ? fmtDate(r.fecha) : r.patente, 54, y + 12);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Ruta: ${r.ruta}`, 54, y + 30, { width: 300 });
  levelBar(doc, 54, y + 50, Number(r.nivel));
  const extra = [r.litros != null && `${Number(r.litros).toLocaleString('es-CL')} L`, r.odometro != null && `${Number(r.odometro).toLocaleString('es-CL')} km`].filter(Boolean).join(' · ');
  if (extra) doc.font('Helvetica').fontSize(9).fillColor(INK).text(extra, 200, y + 48, { width: 170 });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(r.nota, 54, y + 66, { width: 300, height: 30, ellipsis: true });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Registró ${r.registrado_por || '—'}${r.created_at ? ` a las ${fmtTime(r.created_at)}` : ''}`, 54, y + 100, { width: 300 });
  const img = await photo(uploads, r.ruta_archivo);
  if (img) doc.image(img, 380, y + 9, { fit: [165, h - 18], align: 'center', valign: 'center' });
  else doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Foto no disponible', 400, y + 52);
  doc.y = y + h + 10;
}

function footer(doc, label) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    // El pie va bajo el margen inferior: sin quitar el margen, PDFKit agrega una hoja en blanco por cada pie.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Travel Trans Logística · ${label} · Página ${i + 1} de ${range.count}`, 40, 812, { width: 515, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

async function render(res, filename, build) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: filename, Author: 'Travel Trans Logística' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  await build(doc);
  doc.end();
}

// Día: todos los camiones, quién registró y cuáles faltan.
async function dailyReport(res, { fecha, registros, camiones, uploads }) {
  const done = new Set(registros.map(r => r.patente));
  const missing = camiones.filter(c => !done.has(c.patente));
  const low = registros.filter(r => Number(r.nivel) <= 25).length;
  await render(res, `combustible_${fecha}.pdf`, async doc => {
    header(doc, `Combustible del ${fmtDate(fecha)}`, `Informe diario · Emitido el ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`);
    summary(doc, [['Camiones registrados', `${done.size} de ${camiones.length}`, missing.length ? WARN : OK], ['Registros (rutas)', registros.length], ['Con poco combustible', low, low ? WARN : INK]]);
    if (missing.length) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(WARN).text(`Sin registro: ${missing.map(c => c.patente).join(', ')}`, 40, doc.y, { width: 515 });
      doc.moveDown(0.8);
    }
    for (const r of registros) await card(doc, r, uploads, false);
    if (!registros.length) doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('No hay registros para este día.', 40, doc.y);
    footer(doc, `Combustible ${fmtDate(fecha)}`);
  });
}

// Camión: todos sus registros del período, con promedio de nivel y total de litros.
async function truckReport(res, { patente, camion, desde, hasta, registros, uploads }) {
  const liters = registros.reduce((s, r) => s + (Number(r.litros) || 0), 0);
  const avg = registros.length ? Math.round(registros.reduce((s, r) => s + Number(r.nivel), 0) / registros.length) : 0;
  const avgLabel = !registros.length ? '—' : avg <= 17 ? 'Reserva' : avg <= 37 ? 'Cerca de 1/4' : avg <= 62 ? 'Cerca de 1/2' : avg <= 87 ? 'Cerca de 3/4' : 'Lleno';
  await render(res, `combustible_${patente}_${desde}_${hasta}.pdf`, async doc => {
    header(doc, `Combustible · ${patente}`, `${camion ? `${camion.modelo}${camion.numero ? ` · N° ${camion.numero}` : ''} · ` : ''}del ${fmtDate(desde)} al ${fmtDate(hasta)}`);
    summary(doc, [['Registros', registros.length], ['Días con registro', new Set(registros.map(r => r.fecha)).size], ['Nivel promedio al llegar', avgLabel], ['Litros registrados', liters ? `${liters.toLocaleString('es-CL')} L` : '—']]);
    for (const r of registros) await card(doc, r, uploads, true);
    if (!registros.length) doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('No hay registros en el período.', 40, doc.y);
    footer(doc, `Combustible ${patente}`);
  });
}

module.exports = { dailyReport, truckReport, header, footer, render, fmtDate, fmtTime, INK, MUTED, RED, LINE, OK, WARN };
