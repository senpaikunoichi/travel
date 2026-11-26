const PDFDocument = require('pdfkit');

const ink = '#19191C';
const red = '#CC0000';
const gray = '#666670';
const border = '#D9D9DE';

function printable(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function createInventoryPdf(report, generatedBy) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: false });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    function heading(title, subtitle) {
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(18).text(title, { width: pageWidth });
      doc.moveDown(0.25);
      doc.fillColor(gray).font('Helvetica').fontSize(9).text(subtitle, { width: pageWidth });
      doc.moveDown(0.5);
    }

    function sectionTitle(title) {
      if (doc.y > doc.page.height - 90) doc.addPage();
      doc.moveDown(0.6);
      doc.fillColor(red).font('Helvetica-Bold').fontSize(12).text(title);
      doc.moveDown(0.3);
    }

    function table(headers, rows, widths, rowColor) {
      const startX = doc.page.margins.left;
      const headerHeight = 24;
      const fontSize = 7.5;
      const drawHeader = () => {
        let x = startX;
        const y = doc.y;
        doc.rect(startX, y, widths.reduce((sum, width) => sum + width, 0), headerHeight).fill(ink);
        headers.forEach((value, index) => {
          doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(fontSize)
            .text(printable(value), x + 4, y + 6, { width: widths[index] - 8, height: headerHeight - 8, ellipsis: true });
          x += widths[index];
        });
        doc.y = y + headerHeight;
      };
      const ensureRoom = height => {
        if (doc.y + height <= doc.page.height - doc.page.margins.bottom) return;
        doc.addPage();
        drawHeader();
      };
      drawHeader();
      rows.forEach((row, rowIndex) => {
        const cells = row.map(printable);
        const heights = cells.map((value, index) => doc.heightOfString(value, {
          width: widths[index] - 8, font: 'Helvetica', fontSize, lineGap: 1,
        }));
        const height = Math.max(20, ...heights.map(value => value + 8));
        ensureRoom(height);
        const y = doc.y;
        if (rowColor) doc.rect(startX, y, widths.reduce((sum, width) => sum + width, 0), height).fill(rowColor(row, rowIndex));
        let x = startX;
        cells.forEach((value, index) => {
          doc.fillColor(ink).font('Helvetica').fontSize(fontSize)
            .text(value, x + 4, y + 4, { width: widths[index] - 8, height: height - 6, lineGap: 1 });
          x += widths[index];
        });
        doc.moveTo(startX, y + height).lineTo(startX + widths.reduce((sum, width) => sum + width, 0), y + height).strokeColor(border).lineWidth(0.4).stroke();
        doc.y = y + height;
      });
    }

    const emitted = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    heading('REPORTE DE INVENTARIO', `Travel Trans Logística · Emitido: ${emitted} · Usuario: ${generatedBy || 'Usuario'}`);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text('Filtros aplicados');
    doc.fillColor(gray).font('Helvetica').fontSize(9).text(
      `Movimientos: ${report.filtros.fecha_inicio} al ${report.filtros.fecha_fin} · Categoría: ${report.filtros.categoria || 'Todas'} · Stock: ${report.filtros.estado_stock} · Movimiento: ${report.filtros.tipo_movimiento} · Camión: ${report.filtros.camion || 'Todos'}`,
      { width: pageWidth },
    );
    doc.moveDown(0.5);
    const summary = report.resumen;
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(9).text(
      `Repuestos: ${summary.total_repuestos}    Unidades: ${summary.unidades}    Valor conocido: $${Number(summary.valor_estimado).toLocaleString('es-CL')} CLP    Críticos: ${summary.criticos}    Bajos: ${summary.bajos}    Agotados: ${summary.agotados}    Movimientos: ${summary.movimientos}`,
      { width: pageWidth },
    );
    doc.fillColor(gray).font('Helvetica').fontSize(8).text(
      `El valor estimado solo suma repuestos con costo unitario registrado. Sin costo: ${summary.repuestos_sin_costo}.`,
      { width: pageWidth },
    );
    sectionTitle('Detalle de Stock');
    table(
      ['ID', 'Código QR', 'Repuesto', 'Categoría', 'Stock', 'Mínimo', 'Costo unitario', 'Valor', 'Ubicación', 'Estado'],
      report.repuestos.map(item => {
        const stock = Number(item.stock_actual), min = Number(item.stock_minimo);
        const status = stock <= min ? 'Crítico' : stock <= Math.ceil(min * 1.25) ? 'Bajo' : 'Adecuado';
        return [item.id, item.codigo_qr, item.nombre, item.categoria, stock, min,
          item.costo_unitario === null ? 'Sin costo' : `$${Number(item.costo_unitario).toLocaleString('es-CL')}`,
          `$${Number(item.valor_estimado).toLocaleString('es-CL')}`, item.ubicacion, status];
      }),
      [34, 64, 124, 75, 38, 42, 75, 66, 86, 66],
      (row, index) => row[9] === 'Crítico' ? '#FFE1E1' : row[9] === 'Bajo' ? '#FEF9C3' : index % 2 ? '#F6F6F7' : '#FFFFFF',
    );
    sectionTitle('Historial de Movimientos');
    table(
      ['Fecha', 'Tipo', 'Repuesto', 'Código QR', 'Cantidad', 'Camión', 'Usuario', 'Comentario'],
      report.movimientos.map(item => [
        new Date(item.created_at).toLocaleString('es-CL', { timeZone: 'America/Santiago' }),
        item.tipo, item.repuesto, item.codigo_qr, item.cantidad, item.camion, item.usuario, item.comentario,
      ]),
      [82, 50, 125, 68, 46, 60, 92, 246],
      (row, index) => index % 2 ? '#F6F6F7' : '#FFFFFF',
    );
    doc.end();
  });
}

module.exports = { createInventoryPdf };
