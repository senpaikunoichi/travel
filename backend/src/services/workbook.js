const ExcelJS = require('exceljs');
const { donutPng } = require('./donut');

const COLORS = {
  ink: '19191C', brand: 'CC0000', white: 'FFFFFF', light: 'F6F6F7', border: 'D9D9DE',
  green: '167347', greenLight: 'E4F5EA', redLight: 'FFE1E1', purpleLight: 'E9D5FF', blueLight: 'DBEAFE', yellowLight: 'FEF9C3',
};
const moneyFormat = '"$"#,##0.00';

function fill(color) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }; }
function border() {
  const side = { style: 'thin', color: { argb: COLORS.border } };
  return { top: side, left: side, bottom: side, right: side };
}
function section(sheet, title) {
  const row = sheet.addRow([title]);
  sheet.mergeCells(row.number, 1, row.number, 9);
  row.height = 25;
  row.getCell(1).font = { bold: true, size: 12, color: { argb: COLORS.white } };
  row.getCell(1).fill = fill(COLORS.ink);
  row.getCell(1).alignment = { vertical: 'middle' };
}
function header(sheet, values) {
  const row = sheet.addRow(values);
  row.height = 24;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.fill = fill(COLORS.brand);
    cell.border = border();
    cell.alignment = { vertical: 'middle' };
  });
}
function dataRowStyle(row, zebra) {
  row.eachCell({ includeEmpty: true }, cell => {
    cell.border = border();
    cell.alignment = { vertical: 'middle', wrapText: true };
    if (zebra) cell.fill = fill(COLORS.light);
  });
}
function statusStyle(cell, status) {
  const panne = status === 'panne' || status === 'En panne';
  cell.value = panne ? 'En panne' : 'Activo';
  cell.font = { bold: true, color: { argb: panne ? COLORS.brand : COLORS.green } };
  cell.fill = fill(panne ? COLORS.redLight : COLORS.greenLight);
}

module.exports = async function sendWorkbook(res, tareas, gastosPorDiaCamion, camiones, fecha_inicio, fecha_fin, extra = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Travel Trans Logística';
  workbook.created = new Date();
  const now = new Date();
  const fechaExport = now.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
  const horaExport = now.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago' });
  const sheet = workbook.addWorksheet('Reporte General', {
    properties: { defaultRowHeight: 20 },
    views: [{ state: 'frozen', ySplit: 15, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  sheet.columns = [
    { width: 14 }, { width: 27 }, { width: 15 }, { width: 24 }, { width: 24 },
    { width: 17 }, { width: 17 }, { width: 21 }, { width: 18 },
  ];

  sheet.mergeCells('A1:I1');
  sheet.getCell('A1').value = 'REPORTE GENERAL DE FLOTA Y MANTENIMIENTO';
  sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: COLORS.white } };
  sheet.getCell('A1').fill = fill(COLORS.ink);
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 34;
  sheet.mergeCells('A2:F2');
  sheet.getCell('A2').value = `Travel Trans Logística · Exportado el ${fechaExport} a las ${horaExport}`;
  sheet.getCell('A2').font = { color: { argb: '55555F' }, italic: true };
  sheet.mergeCells('A3:F3');
  sheet.getCell('A3').value = fecha_inicio && fecha_fin ? `Período informado: ${fecha_inicio} al ${fecha_fin}` : 'Período informado: historial completo';
  sheet.getCell('A3').font = { bold: true, color: { argb: COLORS.brand } };

  const active = camiones.filter(camion => camion.estado_operativo === 'activo').length;
  const panne = camiones.filter(camion => camion.estado_operativo === 'panne').length;
  const fleetExpense = camiones.reduce((sum, camion) => sum + (Number(camion.total_gasto) || 0), 0);
  const kpis = [['Total camiones', camiones.length], ['Activos', active], ['En panne', panne], ['Gasto reportado', fleetExpense]];
  kpis.forEach(([label, value], index) => {
    const row = 5 + index * 2;
    sheet.mergeCells(row, 1, row, 2); sheet.mergeCells(row + 1, 1, row + 1, 2);
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { bold: true, color: { argb: '666670' } };
    sheet.getCell(row + 1, 1).value = value;
    sheet.getCell(row + 1, 1).font = { bold: true, size: 16, color: { argb: index === 2 ? COLORS.brand : index === 1 ? COLORS.green : COLORS.ink } };
    sheet.getCell(row, 1).fill = sheet.getCell(row + 1, 1).fill = fill(COLORS.light);
    sheet.getCell(row, 1).border = sheet.getCell(row + 1, 1).border = border();
    if (index === 3) sheet.getCell(row + 1, 1).numFmt = moneyFormat;
  });
  const donutId = workbook.addImage({ buffer: donutPng(active, panne), extension: 'png' });
  sheet.addImage(donutId, { tl: { col: 6.0, row: 2.8 }, ext: { width: 200, height: 200 } });
  sheet.getCell('D5').value = 'Disponibilidad'; sheet.getCell('D5').font = { bold: true, size: 12 };
  sheet.getCell('D6').value = 'Activos'; sheet.getCell('E6').value = active;
  sheet.getCell('D7').value = 'En panne'; sheet.getCell('E7').value = panne;
  sheet.getCell('D6').fill = fill(COLORS.greenLight); sheet.getCell('D7').fill = fill(COLORS.redLight);
  sheet.getCell('E6').font = sheet.getCell('E7').font = { bold: true };

  sheet.addRow([]);
  section(sheet, '1. GASTO ACUMULADO Y ESTADO POR CAMIÓN');
  header(sheet, ['Patente', 'Número', 'Modelo', 'Estado operativo', 'Gasto por camión']);
  camiones.forEach((camion, index) => {
    const row = sheet.addRow([camion.patente, camion.numero, camion.modelo, camion.estado_operativo, Number(camion.total_gasto) || 0]);
    dataRowStyle(row, index % 2 === 1);
    statusStyle(row.getCell(4), camion.estado_operativo);
    row.getCell(5).numFmt = moneyFormat;
  });
  if (!camiones.length) { const row = sheet.addRow(['No hay camiones registrados.']); sheet.mergeCells(row.number, 1, row.number, 5); }
  const fleetTotalRow = sheet.addRow(['', '', '', 'TOTAL FLOTA', fleetExpense]);
  fleetTotalRow.font = { bold: true }; fleetTotalRow.getCell(5).numFmt = moneyFormat; fleetTotalRow.getCell(4).fill = fill(COLORS.ink); fleetTotalRow.getCell(4).font = { bold: true, color: { argb: COLORS.white } };

  sheet.addRow([]);
  section(sheet, '2. GASTO DIARIO POR CAMIÓN');
  header(sheet, ['Fecha', 'Patente', 'Número', 'Modelo', 'Estado operativo', 'Gasto del día']);
  gastosPorDiaCamion.forEach((gasto, index) => {
    const row = sheet.addRow([gasto.fecha, gasto.patente_camion, gasto.numero, gasto.modelo, gasto.estado_operativo, Number(gasto.total_dia) || 0]);
    dataRowStyle(row, index % 2 === 1);
    statusStyle(row.getCell(5), gasto.estado_operativo);
    row.getCell(6).numFmt = moneyFormat;
  });
  if (!gastosPorDiaCamion.length) { const row = sheet.addRow(['No hay gastos registrados en el período.']); sheet.mergeCells(row.number, 1, row.number, 6); }
  const dailyTotal = gastosPorDiaCamion.reduce((sum, gasto) => sum + (Number(gasto.total_dia) || 0), 0);
  const dailyTotalRow = sheet.addRow(['', '', '', '', 'TOTAL PERÍODO', dailyTotal]);
  dailyTotalRow.font = { bold: true }; dailyTotalRow.getCell(6).numFmt = moneyFormat; dailyTotalRow.getCell(5).fill = fill(COLORS.brand); dailyTotalRow.getCell(5).font = { bold: true, color: { argb: COLORS.white } };

  sheet.addRow([]);
  section(sheet, '3. DETALLE DE TAREAS DE MANTENIMIENTO');
  header(sheet, ['ID', 'Tipo de tarea', 'Patente', 'Modelo', 'Mecánicos', 'Fecha creación', 'Fecha límite', 'Estado', 'Gasto tarea']);
  const taskHeaderRow = sheet.lastRow.number;
  tareas.forEach((tarea, index) => {
    const row = sheet.addRow([tarea.id, tarea.tipo_tarea, tarea.patente_camion, tarea.modelo, tarea.mecanicos || '', tarea.fecha_creacion, tarea.fecha_limite, tarea.estado, Number(tarea.total_gasto) || 0]);
    dataRowStyle(row, index % 2 === 1);
    const stateColors = { Aprobada: COLORS.purpleLight, Completada: COLORS.greenLight, En_Trabajo: COLORS.blueLight, Pendiente: COLORS.yellowLight };
    if (stateColors[tarea.estado]) row.getCell(8).fill = fill(stateColors[tarea.estado]);
    row.getCell(8).font = { bold: true };
    row.getCell(9).numFmt = moneyFormat;
  });
  if (!tareas.length) { const row = sheet.addRow(['No hay tareas registradas en el período.']); sheet.mergeCells(row.number, 1, row.number, 9); }
  sheet.autoFilter = { from: { row: taskHeaderRow, column: 1 }, to: { row: taskHeaderRow, column: 9 } };
  sheet.pageSetup.printArea = `A1:I${sheet.lastRow.number}`;
  sheet.headerFooter.oddFooter = 'Página &P de &N · Travel Trans Logística';

  // Hojas de detalle: compras (cotizaciones) y repuestos de cada OT del período.
  const table = (name, columns, rows) => {
    const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
    ws.columns = columns.map(([header, key, width]) => ({ header, key, width }));
    header(ws, columns.map(c => c[0])); ws.spliceRows(1, 1);
    rows.forEach((r, i) => dataRowStyle(ws.addRow(r), i % 2 === 1));
    if (!rows.length) ws.addRow(['Sin registros en el período.']);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return ws;
  };
  if (extra.compras) {
    const states = { pendiente: 'Por aprobar', aprobada: 'Aprobada', recibida: 'Comprada', rechazada: 'Rechazada' };
    const link = ruta => ruta ? { text: 'Ver', hyperlink: extra.publicUrl + ruta } : '';
    const ws = table('Compras', [['Fecha', 'fecha', 12], ['OT', 'ot', 7], ['Camión', 'camion', 11], ['Tarea', 'tarea', 24], ['Qué se compra', 'detalle', 30], ['Por qué (mecánico)', 'motivo', 36], ['Proveedor', 'proveedor', 18], ['Cantidad', 'cantidad', 9], ['Monto', 'monto', 13], ['Estado', 'estado', 12], ['Cotizó', 'creador', 18], ['Revisó', 'decisor', 18], ['Fuera de presupuesto', 'excedente', 13], ['Nota', 'nota', 24], ['Cotización', 'doc', 10], ['Comprobante', 'comprobante', 12]],
      extra.compras.map(c => ({ fecha: c.fecha, ot: c.id_tarea, camion: c.patente_camion, tarea: c.tipo_tarea, detalle: c.detalle, motivo: c.motivo || '', proveedor: c.proveedor, cantidad: c.cantidad == null ? '' : Number(c.cantidad), monto: Number(c.monto), estado: states[c.estado] || c.estado, creador: c.creador || '', decisor: c.decisor || '', excedente: Number(c.excedente) || '', nota: c.nota_decision || '', doc: link(c.ruta_archivo), comprobante: link(c.ruta_comprobante) })));
    ws.getColumn('monto').numFmt = moneyFormat; ws.getColumn('excedente').numFmt = moneyFormat;
    const total = extra.compras.filter(c => ['aprobada', 'recibida'].includes(c.estado)).reduce((sum, c) => sum + Number(c.monto), 0);
    const row = ws.addRow({ estado: 'TOTAL APROBADO', monto: total }); row.font = { bold: true }; row.getCell('monto').numFmt = moneyFormat;
  }
  if (extra.repuestos) {
    const states = { pendiente: 'Por retirar', retirado: 'Entregado', faltante: 'Faltó (se cotizó)' };
    table('Repuestos', [['OT', 'ot', 7], ['Fecha OT', 'fecha', 12], ['Camión', 'camion', 11], ['Tarea', 'tarea', 24], ['Repuesto', 'repuesto', 30], ['Código', 'codigo', 12], ['Cantidad', 'cantidad', 9], ['Unidad', 'unidad', 9], ['Estado', 'estado', 16], ['Motivo (si faltó)', 'motivo', 40]],
      extra.repuestos.map(r => ({ ot: r.id_tarea, fecha: r.fecha_creacion, camion: r.patente_camion, tarea: r.tipo_tarea, repuesto: r.repuesto, codigo: r.codigo || '', cantidad: Number(r.cantidad), unidad: r.unidad || '', estado: states[r.estado] || r.estado, motivo: r.motivo || '' })));
  }

  if (extra.combustible) {
    const levels = { 10: 'Reserva', 25: '1/4', 50: '1/2', 75: '3/4', 100: 'Lleno' };
    table('Combustible', [['Fecha', 'fecha', 12], ['Camión', 'patente', 11], ['Ruta', 'ruta', 26], ['Nivel al llegar', 'nivel', 14], ['Litros', 'litros', 9], ['Nota', 'nota', 44], ['Registró', 'por', 20], ['Foto', 'foto', 9]],
      extra.combustible.map(c => ({ fecha: c.fecha, patente: c.patente, ruta: c.ruta, nivel: levels[c.nivel] || `${c.nivel}%`, litros: c.litros == null ? '' : Number(c.litros), nota: c.nota, por: c.registrado_por || '', foto: { text: 'Ver', hyperlink: extra.publicUrl + c.ruta_archivo } })));
  }

  const filename = fecha_inicio && fecha_fin ? `reporte_${fecha_inicio}_${fecha_fin}.xlsx` : `reporte_${fechaExport.replace(/\//g, '-')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  await workbook.xlsx.write(res);
  res.end();
};
