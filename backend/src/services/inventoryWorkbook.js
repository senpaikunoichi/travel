const ExcelJS = require('exceljs');

const colors = { ink: '19191C', brand: 'CC0000', white: 'FFFFFF', light: 'F6F6F7', border: 'D9D9DE', red: 'FFE1E1', yellow: 'FEF9C3' };
const moneyFormat = '"$"#,##0.00';
function fill(color) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }; }

function styleHeader(row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: colors.white } };
    cell.fill = fill(colors.brand);
    cell.alignment = { vertical: 'middle' };
  });
}

function styleData(row, index) {
  row.eachCell({ includeEmpty: true }, cell => {
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: colors.border } } };
    if (index % 2) cell.fill = fill(colors.light);
  });
}

function filterSummary(filters) {
  return [
    `Período de movimientos: ${filters.fecha_inicio} al ${filters.fecha_fin}`,
    `Categoría: ${filters.categoria || 'Todas'}`,
    `Estado de stock: ${filters.estado_stock}`,
    `Movimiento: ${filters.tipo_movimiento}`,
    `Camión: ${filters.camion || 'Todos'}`,
  ];
}

async function createInventoryWorkbook(report, generatedBy) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = generatedBy || 'Travel Trans Logística';
  workbook.created = new Date();
  const summary = workbook.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
  summary.columns = [{ width: 34 }, { width: 26 }];
  summary.mergeCells('A1:B1');
  summary.getCell('A1').value = 'REPORTE DE INVENTARIO';
  summary.getCell('A1').font = { bold: true, size: 18, color: { argb: colors.white } };
  summary.getCell('A1').fill = fill(colors.ink);
  summary.getRow(1).height = 34;
  summary.addRow(['Generado por', generatedBy || 'Usuario']);
  summary.addRow(['Fecha de emisión', new Date()]);
  summary.getCell('B3').numFmt = 'dd/mm/yyyy hh:mm';
  summary.addRow(['', '']);
  summary.addRow(['Indicador', 'Resultado']);
  styleHeader(summary.lastRow);
  [
    ['Repuestos incluidos', report.resumen.total_repuestos],
    ['Unidades en stock', report.resumen.unidades],
    ['Valor estimado con costo conocido (CLP)', report.resumen.valor_estimado],
    ['Repuestos sin costo unitario', report.resumen.repuestos_sin_costo],
    ['Stock crítico', report.resumen.criticos],
    ['Stock bajo', report.resumen.bajos],
    ['Agotados', report.resumen.agotados],
    ['Movimientos del período', report.resumen.movimientos],
  ].forEach(([label, value], index) => {
    const row = summary.addRow([label, value]);
    styleData(row, index);
    if (label.startsWith('Valor estimado')) row.getCell(2).numFmt = moneyFormat;
  });
  summary.addRow([]);
  const filtersRow = summary.addRow(['Filtros aplicados', '']);
  filtersRow.getCell(1).font = { bold: true };
  filterSummary(report.filtros).forEach(item => summary.addRow([item]));
  summary.addRow(['Nota de valorización', `El valor considera solo los repuestos con costo unitario registrado (${report.resumen.repuestos_sin_costo} sin costo).`]);
  summary.getCell(`A${summary.rowCount}`).alignment = { wrapText: true, vertical: 'top' };
  summary.mergeCells(`A${summary.rowCount}:B${summary.rowCount}`);

  const stock = workbook.addWorksheet('Detalle de Stock', { views: [{ state: 'frozen', ySplit: 1 }] });
  stock.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Código QR', key: 'codigo_qr', width: 20 },
    { header: 'Nombre', key: 'nombre', width: 32 },
    { header: 'Categoría', key: 'categoria', width: 22 },
    { header: 'Stock actual', key: 'stock_actual', width: 15 },
    { header: 'Stock mínimo', key: 'stock_minimo', width: 15 },
    { header: 'Costo unitario (CLP)', key: 'costo_unitario', width: 20, style: { numFmt: moneyFormat } },
    { header: 'Valor estimado (CLP)', key: 'valor_estimado', width: 22, style: { numFmt: moneyFormat } },
    { header: 'Ubicación', key: 'ubicacion', width: 24 },
    { header: 'Estado', key: 'estado', width: 16 },
  ];
  styleHeader(stock.getRow(1));
  report.repuestos.forEach((item, index) => {
    const qty = Number(item.stock_actual), min = Number(item.stock_minimo);
    const status = qty <= min ? 'Crítico' : qty <= Math.ceil(min * 1.25) ? 'Bajo' : 'Adecuado';
    const row = stock.addRow({
      ...item,
      stock_actual: qty,
      stock_minimo: min,
      costo_unitario: item.costo_unitario === null ? null : Number(item.costo_unitario),
      valor_estimado: Number(item.valor_estimado),
      estado: status,
    });
    styleData(row, index);
    if (status === 'Crítico') row.getCell(10).fill = fill(colors.red);
    else if (status === 'Bajo') row.getCell(10).fill = fill(colors.yellow);
  });
  stock.autoFilter = { from: 'A1', to: 'J1' };

  const movements = workbook.addWorksheet('Historial de Movimientos', { views: [{ state: 'frozen', ySplit: 1 }] });
  movements.columns = [
    { header: 'Fecha', key: 'created_at', width: 22 },
    { header: 'Tipo', key: 'tipo', width: 14 },
    { header: 'Repuesto', key: 'repuesto', width: 34 },
    { header: 'Código QR', key: 'codigo_qr', width: 20 },
    { header: 'Cantidad', key: 'cantidad', width: 13 },
    { header: 'Camión', key: 'camion', width: 16 },
    { header: 'Usuario responsable', key: 'usuario', width: 24 },
    { header: 'Comentario', key: 'comentario', width: 36 },
  ];
  styleHeader(movements.getRow(1));
  report.movimientos.forEach((item, index) => {
    const row = movements.addRow({ ...item, created_at: new Date(item.created_at), cantidad: Number(item.cantidad) });
    row.getCell(1).numFmt = 'dd/mm/yyyy hh:mm';
    styleData(row, index);
  });
  movements.autoFilter = { from: 'A1', to: 'H1' };
  return workbook.xlsx.writeBuffer();
}

module.exports = { createInventoryWorkbook };
