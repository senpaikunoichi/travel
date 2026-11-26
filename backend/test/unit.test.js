const { test } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/validation');
const { transaction } = require('../src/db');
const { hashPassword, verifyPassword, validatePassword } = require('../src/passwords');
const { identify } = require('../src/routes/files');
const { parseJson } = require('../src/services/gemini');
const { donutPng } = require('../src/services/donut');
const { loadConfig } = require('../src/config');
const { optimizeImage } = require('../src/services/images');

test('validación de identificadores, fechas, montos y roles', () => {
  for (const invalid of [null, {}, [], 0, -1, '1 OR 1=1', 1.2, '01', 2147483648]) assert.throws(() => v.id(invalid), { status: 400 });
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-13-01', 'ayer', '0000-01-01']) assert.throws(() => v.date(invalid), { status: 400 });
  assert.equal(v.date('2024-02-29'), '2024-02-29');
  assert.equal(v.id('42'), 42);
  for (const invalid of [-1, 0, Infinity, '1.001', '1e3', null, '', 100000000]) assert.throws(() => v.amount(invalid), { status: 400 });
  assert.equal(v.amount('123.45'), '123.45');
  assert.throws(() => v.role('superadmin'), { status: 400 });
  assert.throws(() => v.dateRange({ fecha_inicio: '2026-01-01' }), { status: 400 });
  assert.throws(() => v.dateRange({ fecha_inicio: '2026-02-01', fecha_fin: '2026-01-01' }), { status: 400 });
  assert.deepEqual(v.dateRange({}), []);
  assert.equal(v.today(new Date('2026-07-01T01:00:00Z')), '2026-06-30');
  assert.equal(v.tomorrow('2026-12-31'), '2027-01-01');
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
  assert.equal(loadConfig({}).image.maxDimension, 1920);
  assert.throws(() => loadConfig({ IMAGE_WEBP_QUALITY: '20' }), /IMAGE_WEBP_QUALITY/);
});
