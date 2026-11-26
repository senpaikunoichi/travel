const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const v = require('../src/validation');
const { transaction } = require('../src/db');
const { hashPassword, verifyPassword, validatePassword } = require('../src/passwords');
const { identify } = require('../src/routes/files');
const { parseJson, normalizarAnalisisInventario } = require('../src/services/gemini');
const { donutPng } = require('../src/services/donut');
const { loadConfig } = require('../src/config');
const { optimizeImage } = require('../src/services/images');
const { repairInventorySchema } = require('../scripts/migrate');
const { parseFilters, loadInventoryReport } = require('../src/services/inventoryReports');
const { createInventoryWorkbook } = require('../src/services/inventoryWorkbook');
const { createInventoryPdf } = require('../src/services/inventoryPdf');
const { addCatalogMatches } = require('../src/routes/inventory');

test('todas las migraciones referenciadas por el migrador existen', async () => {
  const source = await fs.readFile(require.resolve('../scripts/migrate'), 'utf8');
  const filenames = [...source.matchAll(/\.\.\/migrations\/([^']+\.sql)/g)].map(([, filename]) => filename);
  assert.ok(filenames.length > 0);
  await Promise.all(filenames.map(filename => fs.access(path.join(__dirname, '../migrations', filename))));
});

test('validación de identificadores, fechas, montos y roles', () => {
  for (const invalid of [null, {}, [], 0, -1, '1 OR 1=1', 1.2, '01', 2147483648]) assert.throws(() => v.id(invalid), { status: 400 });
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-13-01', 'ayer', '0000-01-01']) assert.throws(() => v.date(invalid), { status: 400 });
  assert.equal(v.date('2024-02-29'), '2024-02-29');
  assert.equal(v.id('42'), 42);
  assert.equal(v.taskPriority(), 'Media');
  assert.equal(v.taskPriority('Alta'), 'Alta');
  assert.throws(() => v.taskPriority('Urgente'), { status: 400 });
  for (const invalid of [-1, 0, Infinity, '1.001', '1e3', null, '', 100000000]) assert.throws(() => v.amount(invalid), { status: 400 });
  assert.equal(v.amount('123.45'), '123.45');
  assert.throws(() => v.role('superadmin'), { status: 400 });
  assert.throws(() => v.dateRange({ fecha_inicio: '2026-01-01' }), { status: 400 });
  assert.throws(() => v.dateRange({ fecha_inicio: '2026-02-01', fecha_fin: '2026-01-01' }), { status: 400 });
  assert.deepEqual(v.dateRange({}), []);
  assert.equal(v.today(new Date('2026-07-01T01:00:00Z')), '2026-06-30');
  assert.equal(v.tomorrow('2026-12-31'), '2027-01-01');
});
test('filtros y archivos de reporte de inventario se generan con datos parametrizados', async () => {
  const filters = parseFilters({
    fecha_inicio: '2026-01-01', fecha_fin: '2026-01-31', categoria: 'Filtros',
    estado_stock: 'critico_bajo', tipo_movimiento: 'SALIDA', camion: 'ABC-123',
  });
  assert.deepEqual(filters, {
    fecha_inicio: '2026-01-01', fecha_fin: '2026-01-31', categoria: 'Filtros',
    estado_stock: 'critico_bajo', tipo_movimiento: 'SALIDA', camion: 'ABC-123',
  });
  assert.throws(() => parseFilters({ fecha_inicio: '2026-01-01' }), { status: 400 });
  assert.throws(() => parseFilters({ estado_stock: 'cualquiera' }), { status: 400 });
  const queries = [];
  const pool = {
    execute: async (sql, values) => {
      queries.push({ sql, values });
      if (sql.includes('FROM repuestos r')) return [[{
        id: 1, codigo_qr: 'REP-1', nombre: 'Filtro', categoria: 'Filtros', stock_actual: 2,
        stock_minimo: 3, costo_unitario: '100.00', ubicacion: 'A-1', valor_estimado: '200.00',
      }]];
      if (sql.includes('FROM movimientos_inventario m')) return [[{
        created_at: '2026-01-15T12:00:00.000Z', tipo: 'SALIDA', repuesto: 'Filtro',
        codigo_qr: 'REP-1', cantidad: 1, camion: 'ABC-123', usuario: 'Encargado', comentario: '',
      }]];
      if (sql.includes('SELECT DISTINCT categoria')) return [[{ categoria: 'Filtros' }]];
      return [[{ patente: 'ABC-123', numero: '12' }]];
    },
  };
  const report = await loadInventoryReport(pool, filters);
  assert.equal(report.resumen.valor_estimado, 200);
  assert.equal(report.resumen.criticos, 1);
  assert.equal(report.resumen.movimientos, 1);
  assert.equal(queries[0].values[0], 'Filtros');
  assert.ok(queries[1].values.includes('ABC-123'));
  assert.ok(queries[1].sql.includes('m.camion_id = ?'));
  const workbookBytes = await createInventoryWorkbook(report, 'Encargado');
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(workbookBytes);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Resumen', 'Detalle de Stock', 'Historial de Movimientos']);
  const pdf = await createInventoryPdf(report, 'Encargado');
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
test('scrypt conserva la clave, usa sal aleatoria y rechaza texto plano', async () => {
  const password = 'Contraseña-de-prueba-123';
  const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('incorrecta', first), false);
  assert.equal(await verifyPassword(password, password), false);
  assert.equal(await verifyPassword(password, 'scrypt$malformed'), false);
  assert.throws(() => validatePassword('short', true), { status: 400 });
});
test('transacciones confirman y liberan; los fallos revierten y liberan', async () => {
  for (const fails of [false, true]) {
    const calls = [];
    const connection = Object.fromEntries(['beginTransaction', 'commit', 'rollback', 'release'].map(name => [name, () => calls.push(name)]));
    const run = transaction({ getConnection: async () => connection }, async () => { if (fails) throw new Error('failure'); return 42; });
    if (fails) await assert.rejects(run, /failure/); else assert.equal(await run, 42);
    assert.deepEqual(calls, ['beginTransaction', fails ? 'rollback' : 'commit', 'release']);
  }
});
test('la migración reemplaza esquemas antiguos de inventario y conserva los compatibles', async () => {
  const required = {
    repuestos: ['id', 'codigo_qr', 'nombre', 'categoria', 'stock_actual', 'stock_minimo', 'ubicacion', 'foto_url', 'created_at', 'updated_at'],
    movimientos_inventario: ['id', 'repuesto_id', 'tipo', 'cantidad', 'camion_id', 'usuario_id', 'comentario', 'created_at'],
    solicitudes_compra: ['id', 'repuesto_id', 'descripcion_pieza', 'cantidad', 'estado', 'solicitado_por', 'foto_comprobante_url', 'created_at'],
  };
  const run = async columns => {
    const queries = [];
    await repairInventorySchema({
      execute: async sql => [sql.includes('information_schema.TABLES')
        ? []
        : columns.map(([TABLE_NAME, names]) => names.map(COLUMN_NAME => ({ TABLE_NAME, COLUMN_NAME }))).flat()],
      query: async sql => queries.push(sql),
    });
    return queries;
  };
  const compatible = Object.entries(required);
  assert.deepEqual(await run(compatible), []);
  const legacyMovement = compatible.map(([table, columns]) => [table, table === 'movimientos_inventario'
    ? ['id', 'producto_id', 'usuario_id', 'camion_patente', 'mecanico_id', 'tipo', 'cantidad', 'stock_antes', 'stock_despues', 'costo_unitario', 'motivo', 'created_at']
    : columns]);
  const movementRename = await run(legacyMovement);
  assert.equal(movementRename.length, 1);
  assert.match(movementRename[0], /^RENAME TABLE `movimientos_inventario` TO `movimientos_inventario_legacy_[a-f0-9]{8}`$/);
  const legacyParts = compatible.map(([table, columns]) => [table, table === 'repuestos' ? ['id', 'nombre'] : columns]);
  const partsRename = await run(legacyParts);
  assert.equal(partsRename.length, 1);
  assert.match(partsRename[0], /^RENAME TABLE `solicitudes_compra` TO `solicitudes_compra_legacy_[a-f0-9]{8}`, `movimientos_inventario` TO `movimientos_inventario_legacy_[a-f0-9]{8}`, `repuestos` TO `repuestos_legacy_[a-f0-9]{8}`$/);
});
test('archivos se reconocen por firma, no por el nombre declarado', () => {
  assert.equal(identify(Buffer.from('<script>bad</script>')), null);
  assert.equal(identify(Buffer.from('%PDF-1.7')).ext, '.pdf');
  assert.equal(identify(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])).ext, '.png');
  const chart = donutPng(3, 1, 64);
  assert.equal(identify(chart).ext, '.png');
  assert.ok(chart.length > 100);
});
test('las imagenes se reducen, orientan y convierten a WebP', async () => {
  const source = donutPng(75, 25, 1024);
  const result = await optimizeImage(source, { maxDimension: 256, quality: 75, maxPixels: 40000000 });
  assert.equal(result.mime, 'image/webp');
  assert.equal(result.ext, '.webp');
  assert.ok(result.width <= 256 && result.height <= 256);
  assert.ok(result.buffer.length < source.length);
  assert.equal(identify(result.buffer).ext, '.webp');
});
test('la respuesta JSON de la IA admite bloques y rechaza respuestas sin objeto', () => {
  assert.deepEqual(parseJson('```json\n{"nivel":"leve"}\n```'), { nivel: 'leve' });
  assert.throws(() => parseJson('No fue posible analizar'), /JSON/);
});
test('el analisis de imagen enlaza automaticamente los productos existentes por codigo o nombre', async () => {
  const calls = [];
  const pool = {
    execute: async (sql, values) => {
      calls.push({ sql, values });
      return [[
        { id: 8, codigo_qr: 'FLT-01', nombre: 'Filtro de aceite', stock_actual: 3 },
        { id: 9, codigo_qr: 'REP-02', nombre: 'Bujía de motor', stock_actual: 2 },
      ]];
    },
  };
  const result = await addCatalogMatches(pool, {
    tipo_documento: 'factura',
    items: [
      { nombre: 'Filtro de aceite', codigo_referencia: '', cantidad: 4 },
      { nombre: 'Bujia de motor', codigo_referencia: 'REP-02', cantidad: 2 },
    ],
  });
  assert.equal(result.items[0].coincidencia.id, 8);
  assert.equal(result.items[1].coincidencia.id, 9);
  assert.ok(calls[0].sql.includes('LOWER(TRIM(nombre))'));
  const part = await addCatalogMatches(pool, {
    tipo_documento: 'repuesto', nombre_sugerido: 'Filtro de aceite',
    codigo_referencia: 'FLT-01', cantidad: 1,
  });
  assert.equal(part.coincidencia.id, 8);
});
test('el analisis de repuestos y facturas se limita a campos estructurados', () => {
  assert.deepEqual(normalizarAnalisisInventario('repuesto', {
    nombre_sugerido: 'Filtro aceite', categoria: 'Filtros', ubicacion_estimada: 'A-1',
    descripcion: 'Filtro metálico', codigo_referencia: 'F-12', confianza_analisis: 'alta',
  }), {
    nombre_sugerido: 'Filtro aceite', categoria: 'Filtros', ubicacion_estimada: 'A-1',
    cantidad: 1, descripcion: 'Filtro metálico', codigo_referencia: 'F-12', confianza_analisis: 'alta',
  });
  assert.equal(normalizarAnalisisInventario('repuesto', { nombre: 'Filtro', cantidad: 4 }).cantidad, 4);
  assert.deepEqual(normalizarAnalisisInventario('factura', {
    proveedor: 'Proveedor', numero_documento: 'F-123',
    items: [{ nombre: 'Filtro', cantidad: '4', codigo_referencia: 'AB', precio_estimado: null }],
  }), {
    proveedor: 'Proveedor', numero_documento: 'F-123',
    items: [{ nombre: 'Filtro', cantidad: 4, codigo_referencia: 'AB', precio_estimado: null, confianza_analisis: 'baja' }],
  });
  assert.throws(() => normalizarAnalisisInventario('repuesto', {}), /identificar el nombre/);
  assert.throws(() => normalizarAnalisisInventario('factura', { items: 'inválido' }), /lista de productos/);
  assert.equal(normalizarAnalisisInventario('auto', { tipo_documento: 'boleta', items: [{ nombre: 'Filtro' }] }).tipo_documento, 'boleta');
  assert.equal(normalizarAnalisisInventario('auto', { tipo_documento: 'factura', items: [] }).tipo_documento, 'factura');
  assert.equal(normalizarAnalisisInventario('auto', { tipo_documento: 'guia', items: [] }).tipo_documento, 'guia');
  assert.equal(normalizarAnalisisInventario('auto', { tipo_documento: 'otro' }).tipo_documento, 'otro');
  assert.equal(normalizarAnalisisInventario('auto', { tipo_documento: 'repuesto', nombre: 'Bujía' }).nombre_sugerido, 'Bujía');
});
test('configuración de producción requiere origen explícito HTTPS', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /CORS_ORIGINS/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'http://example.com' }), /inválido/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com' }), /DB_PASSWORD/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com', DB_PASSWORD: '1234567890123456', HOST: '0.0.0.0' }), /HOST/);
  assert.equal(loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com', DB_PASSWORD: '1234567890123456' }).production, true);
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
  assert.equal(loadConfig({}).allowMultipleDailyInspections, false);
  assert.equal(loadConfig({ ALLOW_MULTIPLE_DAILY_INSPECTIONS: 'true' }).allowMultipleDailyInspections, true);
  assert.throws(() => loadConfig({ ALLOW_MULTIPLE_DAILY_INSPECTIONS: 'yes' }), /ALLOW_MULTIPLE_DAILY_INSPECTIONS/);
  assert.equal(loadConfig({}).image.maxDimension, 2560);
  assert.throws(() => loadConfig({ IMAGE_WEBP_QUALITY: '20' }), /IMAGE_WEBP_QUALITY/);
});
