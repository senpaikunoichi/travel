const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const ExcelJS = require('exceljs');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { migrate } = require('../scripts/migrate');
const { donutPng } = require('../src/services/donut');
const { today, tomorrow } = require('../src/validation');

test('API completa contra un esquema MySQL temporal', { skip: process.env.RUN_DB_TESTS !== '1', timeout: 90000 }, async t => {
  const config = loadConfig();
  const schema = `maintenance_test_${randomBytes(8).toString('hex')}`;
  assert.match(schema, /^maintenance_test_[a-f0-9]{16}$/);
  const connection = await mysql.createConnection(config.db);
  let pool, server, temp;
  try {
    await connection.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    pool = mysql.createPool({ ...config.db, database: schema });
    const statements = [
      "CREATE TABLE usuarios (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(100) NOT NULL, email VARCHAR(100) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, rol ENUM('admin','jefe','encargado','mecanico') NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
      'CREATE TABLE camiones (patente VARCHAR(10) PRIMARY KEY, numero VARCHAR(10) NOT NULL, modelo VARCHAR(50) NOT NULL)',
      "CREATE TABLE tareas (id INT AUTO_INCREMENT PRIMARY KEY, tipo_tarea VARCHAR(100) NOT NULL, patente_camion VARCHAR(10) NOT NULL, descripcion TEXT, fecha_creacion DATE NOT NULL, fecha_limite DATE NOT NULL, estado ENUM('Pendiente','En_Trabajo','Completada','Aprobada') DEFAULT 'Pendiente', fecha_completada DATE, created_by INT NOT NULL, vencida BOOLEAN DEFAULT FALSE, veces_aplazada INT DEFAULT 0, motivo_aplazamiento TEXT, FOREIGN KEY (patente_camion) REFERENCES camiones(patente), FOREIGN KEY (created_by) REFERENCES usuarios(id))",
      'CREATE TABLE tarea_mecanicos (id INT AUTO_INCREMENT PRIMARY KEY, id_tarea INT NOT NULL, id_mecanico INT NOT NULL, FOREIGN KEY (id_tarea) REFERENCES tareas(id), FOREIGN KEY (id_mecanico) REFERENCES usuarios(id))',
      "CREATE TABLE gastos (id INT AUTO_INCREMENT PRIMARY KEY, id_tarea INT NOT NULL, concepto VARCHAR(200) NOT NULL, monto DECIMAL(10,2) NULL, fecha DATE NOT NULL, tipo ENUM('mecanico','factura') NULL, FOREIGN KEY (id_tarea) REFERENCES tareas(id))",
      "CREATE TABLE evidencia (id INT AUTO_INCREMENT PRIMARY KEY, id_tarea INT NOT NULL, ruta_archivo VARCHAR(500) NOT NULL, tipo ENUM('foto','boleta','factura') NOT NULL, fecha DATE NOT NULL, FOREIGN KEY (id_tarea) REFERENCES tareas(id))",
    ];
    for (const sql of statements) await pool.query(sql);
    for (const role of ['admin', 'encargado', 'jefe', 'mecanico', 'mecanico']) await pool.execute('INSERT INTO usuarios (nombre,email,password,rol) VALUES (?,?,?,?)', [role, `${role}${randomBytes(4).toString('hex')}@test.local`, 'test-password-123', role]);
    const [users] = await pool.execute('SELECT id,email,rol FROM usuarios ORDER BY id');
    await t.test('migración idempotente protege contraseñas existentes', async () => {
      assert.equal(await migrate(pool), 5);
      assert.equal(await migrate(pool), 0);
      const [[{ password }]] = await pool.execute('SELECT password FROM usuarios WHERE id = 1');
      assert.match(password, /^scrypt\$/);
    });
    const tmpRoot = path.resolve(__dirname, '..', '.test-uploads');
    await fs.mkdir(tmpRoot, { recursive: true });
    temp = await fs.mkdtemp(path.join(tmpRoot, 'run-'));
    const app = createApp({ pool, config: { ...config, production: false, uploads: temp, uploadLimit: 1024, origins: ['http://localhost:5173'] }, logger: { error() {} } });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const cookies = {};
    async function call(url, method = 'GET', body, who = 'admin', headers = {}) {
      const response = await fetch(base + url, { method, headers: { 'X-Requested-With': 'XMLHttpRequest', ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
      const isJson = response.headers.get('content-type')?.includes('json');
      return { response, status: response.status, data: isJson ? await response.json() : Buffer.from(await response.arrayBuffer()) };
    }
    await t.test('sesión, cookies, permisos, CORS y CSRF', async () => {
      assert.equal((await call('/api/tareas', 'GET', undefined, 'anonymous')).status, 401);
      assert.equal((await call('/api/login', 'POST', { email: users[0].email, password: 'wrong' })).status, 401);
      for (const user of users) {
        const result = await call('/api/login', 'POST', { email: user.email, password: 'test-password-123' }, 'anonymous');
        assert.equal(result.status, 200);
        assert.equal(result.data.usuario.password, undefined);
        const cookie = result.response.headers.get('set-cookie');
        assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
        cookies[user.id === 5 ? 'other' : user.rol] = cookie.split(';')[0];
      }
      assert.equal((await call('/api/usuarios', 'GET', undefined, 'mecanico')).status, 403);
      assert.equal((await call('/api/tareas/mecanico/5', 'GET', undefined, 'mecanico')).status, 403);
      assert.equal((await call('/api/inspecciones-camion', 'GET', undefined, 'admin')).status, 200);
      assert.equal((await call('/api/inspecciones-camion', 'GET', undefined, 'jefe')).status, 200);
      assert.equal((await call('/api/inspecciones-camion', 'GET', undefined, 'mecanico')).status, 403);
      assert.equal((await call('/api/auth/profile', 'PUT', { nombre: 'Admin actualizado', email: 'admin.actualizado@test.local' })).status, 200);
      assert.equal((await call('/api/auth/me', 'GET')).data.usuario.nombre, 'Admin actualizado');
      assert.equal((await call('/api/auth/profile', 'PUT', { nombre: 'Admin', email: users.find(user => user.rol === 'jefe').email })).status, 409);
      assert.equal((await call('/api/auth/profile', 'PUT', { nombre: 'Admin', email: 'no-es-correo' })).status, 400);
      assert.equal((await call('/api/tareas', 'GET', undefined, 'admin', { Origin: 'https://evil.test' })).status, 403);
      assert.equal((await call('/api/camiones/agregar', 'POST', {}, 'admin', { 'X-Requested-With': '' })).status, 403);
    });
    let taskId, inventoryId;
    await t.test('validación, creación atómica y autor desde sesión', async () => {
      assert.equal((await call('/api/camiones/agregar', 'POST', { patente: 'ABC-123', numero: '12', modelo: 'Volvo' })).status, 201);
      assert.equal((await call('/api/camiones/agregar', 'POST', { patente: 'ABC-123', numero: '12', modelo: 'Volvo' })).status, 409);
      assert.equal((await call('/api/camiones', 'GET', undefined, 'encargado')).data.camiones[0].estado_operativo, 'activo');
      assert.equal((await call('/api/camiones/estado/ABC-123', 'PUT', { estado_operativo: 'panne' }, 'mecanico')).status, 403);
      assert.equal((await call('/api/camiones/estado/ABC-123', 'PUT', { estado_operativo: 'panne' }, 'encargado')).status, 200);
      assert.equal((await call('/api/kpis', 'GET', undefined, 'encargado')).data.flota.enPanne, '1');
      const payload = { tipo_tarea: 'Embrague', patente_camion: 'ABC-123', descripcion: 'Prueba', fecha_limite: '2026-12-15', prioridad: 'Alta', mecanicos: [4, 5, 4], created_by: 999 };
      assert.equal((await call('/api/tareas/crear', 'POST', { ...payload, mecanicos: [999] })).status, 400);
      assert.equal((await call('/api/tareas/crear', 'POST', { ...payload, prioridad: 'Urgente' })).status, 400);
      const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM tareas'); assert.equal(total, 0);
      const result = await call('/api/tareas/crear', 'POST', payload);
      assert.equal(result.status, 201); taskId = result.data.tarea_id;
      const [[task]] = await pool.execute('SELECT created_by, prioridad FROM tareas WHERE id = ?', [taskId]); assert.equal(task.created_by, 1); assert.equal(task.prioridad, 'Alta');
      const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM tarea_mecanicos WHERE id_tarea = ?', [taskId]); assert.equal(count.total, 2);
      const adminTasks = await call('/api/tareas', 'GET', undefined, 'admin');
      const managerTasks = await call('/api/tareas', 'GET', undefined, 'encargado');
      assert.equal(adminTasks.data.tareas[0].mecanicos, undefined);
      assert.match(managerTasks.data.tareas[0].mecanicos, /mecanico/);
      const truckProfile = await call('/api/camiones/ABC-123/ficha', 'GET', undefined, 'encargado');
      assert.equal(truckProfile.status, 200);
      assert.equal(truckProfile.data.camion.numero, '12');
      assert.equal(truckProfile.data.resumen.tareas, 1);
      assert.match(truckProfile.data.tareas[0].mecanicos, /mecanico/);
      assert.equal((await call('/api/camiones/ABC-123/ficha', 'GET', undefined, 'mecanico')).status, 403);
      assert.equal((await call('/api/camiones/NO-EXISTE/ficha')).status, 404);
      assert.equal((await call('/api/usuarios/agregar', 'POST', { nombre: 'Nueva', email: 'new@test.local', rol: 'mecanico', password: 'short' })).status, 400);
      assert.equal((await call('/api/tareas/estado/invalid', 'PUT', { estado: 'En_Trabajo' })).status, 400);
      assert.equal((await call(`/api/tareas/estado/${taskId}`, 'PUT', { estado: '__proto__' })).status, 400);
    });
    await t.test('inventario: permisos, movimientos trazables y recepción de compra', async () => {
      assert.equal((await call('/api/inventario/repuestos', 'GET', undefined, 'mecanico')).status, 403);
      assert.equal((await call('/api/inventario/repuestos', 'POST', { nombre: 'Filtro de aceite', categoria: 'Filtros', codigo_qr: 'REP-FILTRO-01', stock_actual: 3, stock_minimo: 1, ubicacion: 'A-02' }, 'mecanico')).status, 403);
      assert.equal((await call('/api/inventario', 'GET', undefined, 'anonymous')).status, 401);
      assert.equal((await call('/api/inventario', 'GET', undefined, 'mecanico')).status, 403);
      const created = await call('/api/inventario', 'POST', { nombre: 'Filtro de aceite', categoria: 'Filtros', codigo_qr: 'REP-FILTRO-01', stock_actual: 3, stock_minimo: 1, costo_unitario: 100.5, ubicacion: 'A-02' }, 'jefe');
      assert.equal(created.status, 201);
      inventoryId = created.data.repuesto_id;
      const initialMovement = await pool.execute('SELECT tipo, cantidad, usuario_id FROM movimientos_inventario WHERE repuesto_id = ?', [inventoryId]);
      assert.equal(initialMovement[0][0].tipo, 'ENTRADA');
      assert.equal(Number(initialMovement[0][0].cantidad), 3);
      assert.equal(initialMovement[0][0].usuario_id, users.find(user => user.rol === 'jefe').id);
      const catalog = await call('/api/inventario', 'GET', undefined, 'encargado');
      assert.equal(catalog.status, 200);
      assert.equal(catalog.data.repuestos[0].stock_estado, 'ADECUADO');
      const barcodeSearch = await call('/api/inventario/buscar?codigo=REP-FILTRO-01', 'GET', undefined, 'jefe');
      assert.equal(barcodeSearch.status, 200);
      assert.equal(barcodeSearch.data.repuesto.id, inventoryId);
      assert.equal((await call('/api/inventario/buscar?codigo=INEXISTENTE', 'GET', undefined, 'admin')).status, 404);
      assert.equal((await call('/api/inventario/buscar?codigo=REP-FILTRO-01', 'GET', undefined, 'mecanico')).status, 403);
      assert.equal((await call('/api/inventario/movimiento', 'POST', { repuesto_id: inventoryId, tipo: 'SALIDA', cantidad: 1, camion_id: 'ABC-123' }, 'jefe')).status, 201);
      assert.equal((await call('/api/inventario/movimientos', 'POST', { repuesto_id: inventoryId, tipo: 'SALIDA', cantidad: 3 }, 'encargado')).status, 409);
      assert.equal((await call('/api/inventario/repuestos?q=Filtro')).data.repuestos[0].stock_actual, 2);
      const purchase = await call('/api/inventario/solicitudes', 'POST', { repuesto_id: inventoryId, cantidad: 4 }, 'encargado');
      assert.equal(purchase.status, 201);
      assert.equal((await call(`/api/inventario/solicitudes/${purchase.data.solicitud_id}/estado`, 'PUT', { estado: 'APROBADO' }, 'jefe')).status, 200);
      assert.equal((await call(`/api/inventario/solicitudes/${purchase.data.solicitud_id}/estado`, 'PUT', { estado: 'RECIBIDO' }, 'jefe')).status, 200);
      assert.equal(Number((await call('/api/inventario/repuestos')).data.repuestos[0].stock_actual), 6);
      const received = await call('/api/inventario/ingresos', 'POST', {
        repuesto_id: inventoryId, nombre: 'Filtro de aceite', categoria: 'Filtros',
        codigo_qr: 'REP-FILTRO-01', cantidad: 2, stock_minimo: 1,
        costo_unitario: 100.5, ubicacion: 'A-02', comentario: 'Recepción de factura',
      }, 'encargado');
      assert.equal(received.status, 201);
      assert.equal(Number((await call('/api/inventario/repuestos')).data.repuestos[0].stock_actual), 8);
      const failedBatch = await call('/api/inventario/ingresos/lote', 'POST', {
        comentario: 'Factura de prueba',
        items: [
          { repuesto_id: inventoryId, nombre: 'Filtro de aceite', categoria: 'Filtros', codigo_qr: 'REP-FILTRO-01', cantidad: 1, stock_minimo: 1, costo_unitario: 100.5, ubicacion: 'A-02' },
          { repuesto_id: inventoryId, nombre: 'Filtro de aceite', categoria: 'Filtros', codigo_qr: 'REP-FILTRO-01', cantidad: 1000000, stock_minimo: 1, costo_unitario: 100.5, ubicacion: 'A-02' },
        ],
      }, 'encargado');
      assert.equal(failedBatch.status, 400);
      assert.equal(Number((await call('/api/inventario/repuestos')).data.repuestos[0].stock_actual), 8);
      const batch = await call('/api/inventario/ingresos/lote', 'POST', {
        comentario: 'Factura de prueba',
        items: [
          { repuesto_id: inventoryId, nombre: 'Filtro de aceite', categoria: 'Filtros', codigo_qr: 'REP-FILTRO-01', cantidad: 1, stock_minimo: 1, costo_unitario: 100.5, ubicacion: 'A-02' },
          { nombre: 'Aceite de motor', categoria: 'Aceites', codigo_qr: 'ACEITE-01', cantidad: 2, stock_minimo: 1, costo_unitario: 500, ubicacion: 'B-01' },
        ],
      }, 'encargado');
      assert.equal(batch.status, 201);
      assert.equal(batch.data.repuesto_ids.length, 2);
      assert.equal(Number((await call('/api/inventario/repuestos?q=Filtro')).data.repuestos[0].stock_actual), 9);
      const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM movimientos_inventario WHERE repuesto_id = ?', [inventoryId]);
      assert.equal(total, 5);
      assert.equal((await call('/api/inventario/reportes', 'GET', undefined, 'mecanico')).status, 403);
      const reportQuery = 'fecha_inicio=2000-01-01&fecha_fin=2099-12-31&categoria=Filtros&tipo_movimiento=SALIDA&camion=ABC-123';
      const preview = await call(`/api/inventario/reportes?${reportQuery}`, 'GET', undefined, 'encargado');
      assert.equal(preview.status, 200);
      assert.equal(preview.data.resumen.total_repuestos, 1);
      assert.equal(Number(preview.data.resumen.valor_estimado), 904.5);
      assert.equal(preview.data.movimientos.length, 1);
      const excel = await call(`/api/inventario/reportes/excel?${reportQuery}`, 'GET', undefined, 'jefe');
      assert.equal(excel.status, 200);
      const inventoryWorkbook = new ExcelJS.Workbook(); await inventoryWorkbook.xlsx.load(excel.data);
      assert.deepEqual(inventoryWorkbook.worksheets.map(sheet => sheet.name), ['Resumen', 'Detalle de Stock', 'Historial de Movimientos']);
      const pdf = await call(`/api/inventario/reportes/pdf?${reportQuery}`, 'GET', undefined, 'admin');
      assert.equal(pdf.status, 200);
      assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
    });
    await t.test('estados, asignación, gastos y concurrencia', async () => {
      assert.equal((await call(`/api/tareas/estado/${taskId}`, 'PUT', { estado: 'Aprobada' }, 'mecanico')).status, 403);
      assert.equal((await call(`/api/tareas/estado/${taskId}`, 'PUT', { estado: 'Completada' }, 'mecanico')).status, 409);
      const results = await Promise.all([call(`/api/tareas/estado/${taskId}`, 'PUT', { estado: 'En_Trabajo' }, 'mecanico'), call(`/api/tareas/estado/${taskId}`, 'PUT', { estado: 'En_Trabajo' }, 'mecanico')]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      assert.equal((await call('/api/gastos/agregar', 'POST', { id_tarea: taskId, concepto: '' }, 'mecanico')).status, 400);
      assert.equal((await call('/api/gastos/agregar', 'POST', { id_tarea: taskId, concepto: 'Filtro' }, 'mecanico')).status, 201);
      await pool.execute('DELETE FROM tarea_mecanicos WHERE id_tarea = ? AND id_mecanico = 5', [taskId]);
      assert.equal((await call(`/api/gastos/${taskId}`, 'GET', undefined, 'other')).status, 403);
      await pool.execute('INSERT INTO tarea_mecanicos (id_tarea,id_mecanico) VALUES (?,5)', [taskId]);
    });
    await t.test('tareas vencidas se aplazan en cada vencimiento, una vez por día', async () => {
      const postponed = async () => { const [[row]] = await pool.execute('SELECT fecha_limite, vencida, veces_aplazada FROM tareas WHERE id = ?', [taskId]); return row; };
      const [[{ original }]] = await pool.execute('SELECT fecha_limite AS original FROM tareas WHERE id = ?', [taskId]);
      await pool.execute("UPDATE tareas SET fecha_limite = '2020-01-01' WHERE id = ?", [taskId]);
      assert.equal((await call('/api/tareas/verificar-vencidas', 'POST', {}, 'jefe')).status, 403);
      assert.equal((await call('/api/tareas/verificar-vencidas', 'POST', {}, 'encargado')).data.tareas_pospuestas, 1);
      assert.equal((await call('/api/tareas/verificar-vencidas', 'POST', {}, 'mecanico')).data.tareas_pospuestas, 0);
      let row = await postponed();
      assert.equal(row.fecha_limite, tomorrow(today())); assert.equal(row.vencida, 1); assert.equal(row.veces_aplazada, 1);
      await pool.execute("UPDATE tareas SET fecha_limite = '2020-01-01' WHERE id = ?", [taskId]);
      assert.equal((await call('/api/tareas/verificar-vencidas', 'POST', {}, 'mecanico')).data.tareas_pospuestas, 1);
      row = await postponed(); assert.equal(row.veces_aplazada, 2);
      await pool.execute('UPDATE tareas SET fecha_limite = ?, vencida = FALSE, veces_aplazada = 0 WHERE id = ?', [original, taskId]);
    });
    await t.test('archivos autenticados, MIME, tamaño y limpieza al fallar', async () => {
      function file(bytes, mime, field = 'foto') { const form = new FormData(); form.append(field, new Blob([bytes], { type: mime }), 'example.png'); return form; }
      assert.equal((await call(`/api/evidencia/subir/${taskId}`, 'POST', file('<script>bad</script>', 'image/png'), 'mecanico')).status, 415);
      assert.equal((await call(`/api/evidencia/subir/${taskId}`, 'POST', file(Buffer.alloc(2048), 'image/png'), 'mecanico')).status, 413);
      const png = donutPng(3, 1, 32);
      const result = await call(`/api/evidencia/subir/${taskId}`, 'POST', file(png, 'image/png'), 'mecanico');
      assert.equal(result.status, 201);
      const evidence = await call(`/api/evidencia/${taskId}`);
      const url = evidence.data.evidencias[0].ruta_archivo;
      assert.equal((await call(url, 'GET', undefined, 'anonymous')).status, 401);
      assert.equal((await call(url, 'GET', undefined, 'mecanico')).status, 200);
      const before = await fs.readdir(temp);
      await pool.query("CREATE TRIGGER fail_evidence BEFORE INSERT ON evidencia FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test failure'");
      assert.equal((await call(`/api/evidencia/subir/${taskId}`, 'POST', file(png, 'image/png'), 'mecanico')).status, 500);
      await pool.query('DROP TRIGGER fail_evidence');
      assert.deepEqual(await fs.readdir(temp), before);
    });
    await t.test('Excel suma gastos una vez y valida período', async () => {
      await pool.execute("INSERT INTO gastos (id_tarea, concepto, monto, tipo, fecha) VALUES (?, 'Factura 1', 100, 'factura', '2026-09-15'), (?, 'Factura 2', 200, 'factura', '2026-09-15')", [taskId, taskId]);
      const profile = await call('/api/camiones/ABC-123/ficha', 'GET', undefined, 'encargado');
      assert.equal(Number(profile.data.resumen.total_gastos), 300);
      assert.equal(profile.data.tareas[0].gastos.length, 2);
      assert.equal((await call('/api/exportar/excel?fecha_inicio=2026-01-01', 'GET', undefined, 'jefe')).status, 400);
      const result = await call('/api/exportar/excel', 'GET', undefined, 'jefe'); assert.equal(result.status, 200);
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.data);
      assert.equal(workbook.worksheets.length, 1);
      const reportSheet = workbook.getWorksheet('Reporte General');
      const row = reportSheet.getRows(1, reportSheet.rowCount).find(r => r.getCell(1).value === taskId && r.getCell(3).value === 'ABC-123');
      assert.equal(row.getCell(9).value, 300);
      const truckRow = reportSheet.getRows(1, reportSheet.rowCount).find(r => r.getCell(1).value === 'ABC-123');
      assert.equal(truckRow.getCell(4).value, 'En panne');
      assert.equal(truckRow.getCell(5).value, 300);
      const dailyRow = reportSheet.getRows(1, reportSheet.rowCount).find(r => r.getCell(1).value === '2026-09-15' && r.getCell(2).value === 'ABC-123');
      assert.equal(dailyRow.getCell(6).value, 300);
      assert.equal(reportSheet.getImages().length, 1);
      const kpis = (await call('/api/kpis', 'GET', undefined, 'jefe')).data;
      assert.equal(kpis.totalGastos, '300.00');
      assert.equal(kpis.gastosCamion[0].total_gasto, '300.00');
    });
    await t.test('encargado corrige montos y admin restablece contraseñas', async () => {
      const [[concept]] = await pool.execute("SELECT id FROM gastos WHERE tipo = 'mecanico' LIMIT 1");
      assert.equal((await call(`/api/gastos/${concept.id}`, 'PUT', { monto: 50 }, 'mecanico')).status, 403);
      assert.equal((await call(`/api/gastos/${concept.id}`, 'PUT', { monto: -5 }, 'encargado')).status, 400);
      assert.equal((await call(`/api/gastos/${concept.id}`, 'PUT', { monto: 50 }, 'encargado')).status, 200);
      assert.equal((await call(`/api/gastos/${concept.id}`, 'DELETE', undefined, 'encargado')).status, 404);
      assert.equal((await call('/api/gastos/manual', 'POST', { id_tarea: taskId, concepto: 'Manual', monto: 25, fecha: '2999-01-01' }, 'encargado')).status, 400);
      assert.equal((await call('/api/gastos/manual', 'POST', { id_tarea: taskId, concepto: 'Manual', monto: 25 }, 'encargado')).status, 201);
      const [[manual]] = await pool.execute("SELECT id, tipo FROM gastos WHERE concepto = 'Manual'");
      assert.equal(manual.tipo, 'factura');
      assert.equal((await call(`/api/gastos/${manual.id}`, 'DELETE', undefined, 'encargado')).status, 200);
      assert.equal((await call('/api/kpis', 'GET', undefined, 'jefe')).data.totalGastos, '350.00');
      const mechanic = users.find(u => u.rol === 'mecanico');
      const edit = password => ({ nombre: 'Mecánico', email: mechanic.email, rol: 'mecanico', password });
      assert.equal((await call(`/api/usuarios/editar/${mechanic.id}`, 'PUT', edit('short'))).status, 400);
      assert.equal((await call(`/api/usuarios/editar/${mechanic.id}`, 'PUT', edit('nueva-clave-segura'), 'encargado')).status, 403);
      assert.equal((await call(`/api/usuarios/editar/${mechanic.id}`, 'PUT', edit('nueva-clave-segura'))).status, 200);
      assert.equal((await call('/api/auth/me', 'GET', undefined, 'mecanico')).status, 401);
      assert.equal((await call('/api/login', 'POST', { email: mechanic.email, password: 'test-password-123' }, 'anonymous')).status, 401);
      const login = await call('/api/login', 'POST', { email: mechanic.email, password: 'nueva-clave-segura' }, 'anonymous');
      assert.equal(login.status, 200);
      cookies.mecanico = login.response.headers.get('set-cookie').split(';')[0];
      // Sin contraseña se conserva la actual; restablecer la propia no cierra la sesión en uso.
      assert.equal((await call(`/api/usuarios/editar/${mechanic.id}`, 'PUT', edit(''))).status, 200);
      assert.equal((await call('/api/auth/me', 'GET', undefined, 'mecanico')).status, 200);
      const admin = users.find(u => u.rol === 'admin');
      assert.equal((await call(`/api/usuarios/editar/${admin.id}`, 'PUT', { nombre: 'Admin', email: admin.email, rol: 'admin', password: 'otra-clave-segura' })).status, 200);
      assert.equal((await call('/api/auth/me')).status, 200);
    });
    await t.test('finalización, aprobación y protección del historial', async () => {
      assert.equal((await call(`/api/tareas/estado/${taskId}`, 'PUT', { estado: 'Completada' }, 'mecanico')).status, 200);
      assert.equal((await call('/api/gastos/agregar', 'POST', { id_tarea: taskId, concepto: 'Filtro', monto: 10 }, 'mecanico')).status, 409);
      assert.equal((await call(`/api/tareas/revisar/${taskId}`, 'POST', { decision: 'rechazar', nota: 'Corregir ajuste' }, 'mecanico')).status, 403);
      assert.equal((await call(`/api/tareas/revisar/${taskId}`, 'POST', { decision: 'rechazar', nota: '' }, 'encargado')).status, 400);
      assert.equal((await call(`/api/tareas/revisar/${taskId}`, 'POST', { decision: 'rechazar', nota: 'Corregir ajuste' }, 'encargado')).status, 200);
      const [[rejected]] = await pool.execute('SELECT estado, nota_rechazo, fecha_rechazo, veces_rechazada FROM tareas WHERE id = ?', [taskId]);
      assert.equal(rejected.estado, 'En_Trabajo'); assert.equal(rejected.nota_rechazo, 'Corregir ajuste'); assert.ok(rejected.fecha_rechazo); assert.equal(rejected.veces_rechazada, 1);
      assert.equal((await call(`/api/tareas/estado/${taskId}`, 'PUT', { estado: 'Completada' }, 'mecanico')).status, 200);
      assert.equal((await call(`/api/tareas/revisar/${taskId}`, 'POST', { decision: 'aprobar' }, 'encargado')).status, 200);
      const [[task]] = await pool.execute('SELECT estado, fecha_completada FROM tareas WHERE id = ?', [taskId]); assert.equal(task.estado, 'Aprobada'); assert.ok(task.fecha_completada);
      assert.equal((await call(`/api/tareas/eliminar/${taskId}`, 'DELETE')).status, 409);
      assert.equal((await call('/api/camiones/eliminar/ABC-123', 'DELETE')).status, 409);
      assert.equal((await call('/api/usuarios/eliminar/1', 'DELETE')).status, 409);
    });
    await t.test('inventario, falta de repuesto, cotización, presupuesto y compra', async () => {
      const mes = today().slice(0, 7);
      assert.equal((await call('/api/repuestos', 'POST', { nombre: 'Filtro aceite', stock: 1 }, 'mecanico')).status, 403);
      // La unidad es una palabra: un número ahí (la cantidad) se rechaza.
      const badUnit = await call('/api/repuestos', 'POST', { nombre: 'Rectificado', unidad: '2', stock: 2 }, 'encargado');
      assert.equal(badUnit.status, 400); assert.match(badUnit.data.mensaje, /Unidad/);
      assert.equal((await call('/api/repuestos', 'POST', { nombre: 'Filtro aceite', codigo: 'FA-1', stock: 3 }, 'encargado')).status, 201);
      assert.equal((await call('/api/repuestos', 'POST', { nombre: 'Pastillas', stock: 0 }, 'encargado')).status, 201);
      const [[filtro], [pastillas]] = (await call('/api/repuestos', 'GET', undefined, 'jefe')).data.repuestos.sort((x, y) => x.id - y.id).map(r => [r]);
      const payload = { tipo_tarea: 'Mantención 10.000', patente_camion: 'ABC-123', fecha_limite: '2026-12-20', mecanicos: [4], tipo_mantencion: 'preventiva', prioridad: 'alta', kilometraje: 10000, repuestos: [{ id_repuesto: filtro.id, cantidad: 2 }, { id_repuesto: pastillas.id, cantidad: 1 }] };
      assert.equal((await call('/api/tareas/crear', 'POST', { ...payload, prioridad: 'altisima' }, 'encargado')).status, 400);
      const created = await call('/api/tareas/crear', 'POST', payload, 'encargado');
      assert.equal(created.status, 201); const id = created.data.tarea_id;
      // Editar: supervisor y jefe sí, mecánico no; borrar: solo administrador.
      assert.equal((await call(`/api/tareas/editar/${id}`, 'PUT', { ...payload, descripcion: 'Editada' }, 'mecanico')).status, 403);
      assert.equal((await call(`/api/tareas/editar/${id}`, 'PUT', { ...payload, descripcion: 'Editada por jefe' }, 'jefe')).status, 200);
      assert.equal((await call(`/api/tareas/eliminar/${id}`, 'DELETE', undefined, 'jefe')).status, 403);
      assert.equal((await call(`/api/tareas/eliminar/${id}`, 'DELETE', undefined, 'encargado')).status, 403);
      // Antes: foto (se optimiza) y video (se guarda tal cual) desde la misma app.
      const png = await require('sharp')({ create: { width: 40, height: 30, channels: 3, background: '#777' } }).png().toBuffer();
      const media = (buffer, type, name) => { const f = new FormData(); f.append('archivo', new Blob([buffer], { type }), name); return f; };
      assert.equal((await call(`/api/evidencia/media/${id}?momento=antes`, 'POST', media(png, 'image/png', 'a.png'), 'encargado')).status, 201);
      const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(200)]);
      assert.equal((await call(`/api/evidencia/media/${id}?momento=antes`, 'POST', media(mp4, 'video/mp4', 'v.mp4'), 'mecanico')).status, 201);
      assert.equal((await call(`/api/evidencia/media/${id}?momento=despues`, 'POST', media(png, 'image/png', 'b.png'), 'mecanico')).status, 409);
      const before = (await call(`/api/evidencia/${id}`, 'GET', undefined, 'jefe')).data.evidencias.filter(e => e.tipo === 'antes');
      assert.deepEqual(before.map(e => e.ruta_archivo.split('.').pop()), ['webp', 'mp4']);
      assert.equal((await call(before[1].ruta_archivo, 'GET', undefined, 'mecanico')).status, 200);
      let lines = (await call(`/api/tareas/${id}/compras`, 'GET', undefined, 'mecanico')).data.repuestos;
      assert.equal(lines.length, 2);
      const started = await call(`/api/tareas/estado/${id}`, 'PUT', { estado: 'En_Trabajo' }, 'mecanico');
      assert.equal(started.data.sin_stock, 1);
      lines = (await call(`/api/tareas/${id}/compras`, 'GET', undefined, 'mecanico')).data.repuestos;
      assert.deepEqual(lines.map(l => l.estado), ['retirado', 'pendiente']);
      assert.equal(Number((await call('/api/repuestos', 'GET', undefined, 'jefe')).data.repuestos.find(r => r.id === filtro.id).stock), 1);
      const missingLine = lines[1].id;
      assert.equal((await call(`/api/tarea-repuestos/${missingLine}/retirar`, 'POST', {}, 'mecanico')).status, 409);
      // «No hay repuesto» exige motivo y evidencia (foto o video del repuesto malo).
      const fault = (withFile, motivo = 'Pastillas gastadas hasta el metal') => { const f = new FormData(); if (motivo) f.append('motivo', motivo); if (withFile) f.append('evidencia', new Blob([png], { type: 'image/png' }), 'falla.png'); return f; };
      assert.equal((await call(`/api/tarea-repuestos/${missingLine}/faltante`, 'POST', fault(false), 'mecanico')).status, 400);
      assert.equal((await call(`/api/tarea-repuestos/${missingLine}/faltante`, 'POST', fault(true, ''), 'mecanico')).status, 400);
      assert.equal((await call(`/api/tarea-repuestos/${missingLine}/faltante`, 'POST', fault(true), 'mecanico')).status, 200);
      const [[faultRow]] = await pool.execute("SELECT COUNT(*) AS n FROM evidencia WHERE id_tarea_repuesto = ? AND tipo = 'falla'", [missingLine]);
      assert.equal(faultRow.n, 1);
      // Volver a migrar con evidencias de falla ya guardadas no debe fallar (pasó en producción el 12-11-2026).
      await migrate(pool);
      // Las compras ya no generan avisos: se coordinan en el grupo.
      assert.ok(!(await call('/api/notificaciones', 'GET', undefined, 'encargado')).data.notificaciones.some(n => /Pastillas gastadas|Sin repuesto/.test(n.mensaje)));
      const [[waiting]] = await pool.execute('SELECT esperando_repuesto FROM tareas WHERE id = ?', [id]); assert.equal(waiting.esperando_repuesto, 1);
      const supervisorNotices = (await call('/api/notificaciones', 'GET', undefined, 'encargado')).data;
      assert.ok(!supervisorNotices.notificaciones.some(n => /Sin repuesto/.test(n.mensaje)));
      // Presupuesto del mes y cotización fuera de presupuesto.
      assert.equal((await call(`/api/presupuesto/${mes}`, 'PUT', { monto: 50000 }, 'encargado')).status, 403);
      assert.equal((await call(`/api/presupuesto/${mes}`, 'PUT', { monto: 50000 }, 'jefe')).status, 200);
      await pool.execute("UPDATE usuarios SET telefono = '56911112222' WHERE rol = 'jefe'");
      const form = new FormData();
      for (const [k, val] of Object.entries({ id_tarea: id, id_tarea_repuesto: missingLine, proveedor: 'Repuestos Sur', detalle: 'Pastillas de freno', cantidad: 2, monto: 80000 })) form.append(k, String(val));
      const sent = await call('/api/cotizaciones/enviar', 'POST', form, 'encargado');
      assert.equal(sent.status, 201); assert.equal(sent.data.exceso, 30000);
      assert.equal(sent.data.whatsapp.telefono, '56911112222'); assert.match(sent.data.whatsapp.mensaje, /Fuera del presupuesto/);
      // Mientras falte el repuesto (aun con la cotización aprobada) el mecánico no puede terminar.
      assert.equal((await call(`/api/evidencia/media/${id}?momento=despues`, 'POST', media(png, 'image/png', 'd.png'), 'mecanico')).status, 409);
      assert.equal((await call(`/api/tareas/estado/${id}`, 'PUT', { estado: 'Completada' }, 'mecanico')).status, 409);
      assert.match(sent.data.whatsapp.mensaje, /Por qué se necesita \(mecánico\): Pastillas gastadas/); assert.match(sent.data.whatsapp.mensaje, /Evidencia 1: \S+\/uploads\//); assert.match(sent.data.whatsapp.mensaje, new RegExp(`tarea=${id}`));
      assert.ok(!(await call('/api/notificaciones', 'GET', undefined, 'jefe')).data.notificaciones.some(n => /Cotización por aprobar/.test(n.mensaje)));
      assert.equal((await call(`/api/cotizaciones/${sent.data.id}/decidir`, 'POST', { decision: 'aprobar' }, 'encargado')).status, 403);
      assert.equal((await call(`/api/cotizaciones/${sent.data.id}/recibir`, 'POST', {}, 'encargado')).status, 409);
      assert.equal((await call(`/api/cotizaciones/${sent.data.id}/decidir`, 'POST', { decision: 'aprobar' }, 'jefe')).status, 200);
      assert.equal((await call(`/api/cotizaciones/${sent.data.id}/decidir`, 'POST', { decision: 'rechazar', nota: 'x' }, 'jefe')).status, 409);
      const month = (await call(`/api/cotizaciones?mes=${mes}`, 'GET', undefined, 'jefe')).data;
      assert.equal(month.presupuesto.monto, 80000); assert.equal(month.presupuesto.comprometido, 80000); assert.equal(Number(month.cotizaciones[0].excedente), 30000);
      assert.equal((await call(`/api/tareas/${id}/compras`, 'GET', undefined, 'mecanico')).data.cotizaciones.length, 0);
      const receipt = new FormData(); receipt.append('comprobante', new Blob([png], { type: 'image/png' }), 'boleta.png'); receipt.append('producto', new Blob([png], { type: 'image/png' }), 'producto.png');
      const bought = await call(`/api/cotizaciones/${sent.data.id}/recibir`, 'POST', receipt, 'encargado');
      assert.equal(bought.status, 200, JSON.stringify(bought.data));
      assert.match(bought.data.whatsapp.mensaje, /Compra realizada/);
      const receiptUrl = bought.data.whatsapp.mensaje.match(/Comprobante: \S+(\/uploads\/\S+)/)[1];
      assert.equal((await call(receiptUrl, 'GET', undefined, 'jefe')).status, 200);
      assert.equal((await call(receiptUrl, 'GET', undefined, 'mecanico')).status, 403);
      const [[purchase]] = await pool.execute("SELECT monto FROM gastos WHERE id_tarea = ? AND tipo = 'compra'", [id]);
      assert.equal(Number(purchase.monto), 80000);
      assert.ok(!(await call('/api/notificaciones', 'GET', undefined, 'jefe')).data.notificaciones.some(n => /Compra realizada/.test(n.mensaje)));
      assert.match(bought.data.whatsapp.mensaje, /Foto de lo comprado: /);
      // Historial de la OT: el mecánico lo ve sin montos; la oficina con montos e informe completo.
      const officeHistory = (await call(`/api/tareas/${id}/historial`, 'GET', undefined, 'jefe')).data.eventos;
      const kinds = officeHistory.map(e => e.tipo);
      for (const k of ['creada', 'iniciada', 'falta_repuesto', 'cotizacion', 'cotizacion_aprobada', 'compra']) assert.ok(kinds.includes(k), k);
      assert.equal(Number(officeHistory.find(e => e.tipo === 'compra').monto), 80000);
      assert.ok((await call(`/api/tareas/${id}/historial`, 'GET', undefined, 'mecanico')).data.eventos.every(e => e.monto === null));
      assert.equal((await call(`/api/tareas/${id}/informe`, 'GET', undefined, 'mecanico')).status, 403);
      const report = (await call(`/api/tareas/${id}/informe`, 'GET', undefined, 'jefe')).data;
      assert.equal(report.tarea.id, id); assert.ok(report.evidencias.some(e => e.tipo === 'falla')); assert.ok(report.evidencias.some(e => e.tipo === 'compra'));
      const xlsx = await call('/api/exportar/excel', 'GET', undefined, 'jefe');
      const book = new ExcelJS.Workbook(); await book.xlsx.load(xlsx.data);
      assert.ok(book.getWorksheet('Compras').getRows(2, 5).some(r => r.getCell(6).value === 'Pastillas gastadas hasta el metal'));
      assert.ok(book.getWorksheet('Repuestos'));
      lines = (await call(`/api/tareas/${id}/compras`, 'GET', undefined, 'mecanico')).data.repuestos;
      assert.deepEqual(lines.map(l => l.estado), ['retirado', 'retirado']);
      assert.equal(Number((await call('/api/repuestos', 'GET', undefined, 'jefe')).data.repuestos.find(r => r.id === pastillas.id).stock), 1);
      const [[ready]] = await pool.execute('SELECT esperando_repuesto FROM tareas WHERE id = ?', [id]); assert.equal(ready.esperando_repuesto, 0);
      // Compra sin OT (herramienta o stock de bodega): mismo flujo, sin tarea.
      const tool = new FormData();
      for (const [k, val] of Object.entries({ categoria: 'repuesto', id_repuesto: pastillas.id, detalle: 'Pastillas para bodega', cantidad: 4, proveedor: 'Repuestos Sur', monto: 20000, motivo: 'Quedan pocas en bodega' })) tool.append(k, String(val));
      assert.equal((await call('/api/cotizaciones/compra', 'POST', tool, 'mecanico')).status, 403);
      const noMotive = new FormData(); for (const [k, val] of Object.entries({ categoria: 'herramienta', detalle: 'Llave', proveedor: 'X', monto: 1000 })) noMotive.append(k, String(val));
      assert.equal((await call('/api/cotizaciones/compra', 'POST', noMotive, 'encargado')).status, 400);
      const asked = await call('/api/cotizaciones/compra', 'POST', tool, 'encargado');
      assert.equal(asked.status, 201, JSON.stringify(asked.data)); assert.match(asked.data.whatsapp.mensaje, /sin OT/); assert.match(asked.data.whatsapp.mensaje, /Quedan pocas en bodega/);
      assert.ok(!(await call('/api/notificaciones', 'GET', undefined, 'jefe')).data.notificaciones.some(n => /Solicitud de compra/.test(n.mensaje)));
      assert.equal((await call(`/api/cotizaciones/${asked.data.id}/decidir`, 'POST', { decision: 'aprobar' }, 'jefe')).status, 200);
      const stockBefore = Number((await call('/api/repuestos', 'GET', undefined, 'jefe')).data.repuestos.find(r => r.id === pastillas.id).stock);
      const toolReceipt = new FormData(); toolReceipt.append('producto', new Blob([png], { type: 'image/png' }), 'llegaron.png');
      const toolBought = await call(`/api/cotizaciones/${asked.data.id}/recibir`, 'POST', toolReceipt, 'encargado');
      assert.equal(toolBought.status, 200, JSON.stringify(toolBought.data)); assert.match(toolBought.data.mensaje, /sumada al inventario/);
      assert.equal(Number((await call('/api/repuestos', 'GET', undefined, 'jefe')).data.repuestos.find(r => r.id === pastillas.id).stock), stockBefore + 4);
      const listed = (await call(`/api/cotizaciones?mes=${mes}`, 'GET', undefined, 'jefe')).data.cotizaciones.find(q => q.id === asked.data.id);
      assert.equal(listed.estado, 'recibida'); assert.equal(listed.id_tarea, null); assert.equal(listed.repuesto_nombre, pastillas.nombre); assert.ok(listed.ruta_foto_compra);
      assert.equal((await call(listed.ruta_foto_compra, 'GET', undefined, 'jefe')).status, 200);
      assert.equal((await call(listed.ruta_foto_compra, 'GET', undefined, 'mecanico')).status, 403);
      const book2 = new ExcelJS.Workbook(); await book2.xlsx.load((await call('/api/exportar/excel', 'GET', undefined, 'jefe')).data);
      assert.ok(book2.getWorksheet('Compras').getRows(2, 10).some(r => r.values.includes('Sin OT')));
      // Con la compra registrada el mecánico ya puede subir el después.
      assert.equal((await call(`/api/evidencia/media/${id}?momento=despues`, 'POST', media(png, 'image/png', 'e.png'), 'mecanico')).status, 201);
      // «Ya no hace falta»: el supervisor destraba un repuesto faltante sin compra (con motivo).
      const extra = new FormData(); extra.append('descripcion', 'Correa'); extra.append('motivo', 'Correa cortada'); extra.append('evidencia', new Blob([png], { type: 'image/png' }), 'c.png');
      assert.equal((await call(`/api/tareas/${id}/faltante`, 'POST', extra, 'mecanico')).status, 201);
      const correa = (await call(`/api/tareas/${id}/compras`, 'GET', undefined, 'encargado')).data.repuestos.find(l => l.descripcion === 'Correa');
      assert.equal((await call(`/api/tarea-repuestos/${correa.id}/resolver`, 'POST', { nota: 'x' }, 'mecanico')).status, 403);
      assert.equal((await call(`/api/tarea-repuestos/${correa.id}/resolver`, 'POST', {}, 'encargado')).status, 400);
      assert.equal((await call(`/api/tarea-repuestos/${correa.id}/resolver`, 'POST', { nota: 'Se usó una del taller' }, 'encargado')).status, 200);
      assert.equal((await pool.execute('SELECT esperando_repuesto FROM tareas WHERE id = ?', [id]))[0][0].esperando_repuesto, 0);
      assert.ok(!(await call('/api/notificaciones', 'GET', undefined, 'mecanico')).data.notificaciones.some(n => /Llegó el repuesto/.test(n.mensaje)));
      assert.equal((await call('/api/cotizaciones/1', 'GET', undefined, 'mecanico')).status, 404);
      // El administrador borra cualquier tarea, con todo su historial.
      assert.equal((await call(`/api/tareas/eliminar/${taskId}`, 'DELETE')).status, 200);
      assert.equal((await call(`/api/tareas/eliminar/${id}`, 'DELETE')).status, 200);
      const [[left]] = await pool.execute('SELECT (SELECT COUNT(*) FROM tareas) AS t, (SELECT COUNT(*) FROM gastos) AS g, (SELECT COUNT(*) FROM cotizaciones WHERE id_tarea IS NOT NULL) AS c, (SELECT COUNT(*) FROM tarea_repuestos) AS r');
      assert.deepEqual(left, { t: 0, g: 0, c: 0, r: 0 });
    });
    await t.test('mantención por kilometraje avisa una sola vez', async () => {
      assert.equal((await call('/api/planes', 'POST', { nombre: 'Cambio de aceite', cada_km: 10000 }, 'encargado')).status, 201);
      assert.equal((await call('/api/camiones/km/ABC-123', 'PUT', { km_actual: 50000 }, 'encargado')).status, 200);
      let plan = (await call('/api/planes', 'GET', undefined, 'jefe')).data;
      assert.equal(plan.estado[0].km_ultimo, 50000);
      await call('/api/camiones/km/ABC-123', 'PUT', { km_actual: 58999 }, 'encargado');
      await call('/api/camiones/km/ABC-123', 'PUT', { km_actual: 59000 }, 'encargado');
      await call('/api/camiones/km/ABC-123', 'PUT', { km_actual: 59500 }, 'encargado');
      const soon = (await call('/api/notificaciones', 'GET', undefined, 'encargado')).data.notificaciones.filter(n => /Se acerca la «Cambio de aceite»/.test(n.mensaje));
      assert.equal(soon.length, 1);
      assert.match(soon[0].mensaje, /60\.000 km \(faltan 1\.000\)/);
      await call('/api/camiones/km/ABC-123', 'PUT', { km_actual: 60500 }, 'encargado');
      await call('/api/camiones/km/ABC-123', 'PUT', { km_actual: 60600 }, 'encargado');
      const notices = (await call('/api/notificaciones', 'GET', undefined, 'encargado')).data.notificaciones.filter(n => /corresponde «Cambio de aceite»/.test(n.mensaje));
      assert.equal(notices.length, 1);
      assert.equal((await call('/api/camiones/sincronizar-km', 'POST', {}, 'encargado')).status, 409);
    });
    await t.test('inventario por Excel: exportar, importar y km diario', async () => {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet('Hoja1');
      sheet.addRow(['Codigo', 'Nombre', 'Unidad', 'Stock', 'Stock minimo', 'Precio']);
      sheet.addRow(['FIL-01', 'Filtro de aceite', 'unidad', 12, 3, '$12.500']);
      sheet.addRow([null, 'Aceite 15W40', 'litro', '20,5', 10, 4990.4]);
      sheet.addRow([]);
      const upload = async buffer => { const f = new FormData(); f.append('archivo', new Blob([buffer]), 'inv.xlsx'); return f; };
      const buffer = await book.xlsx.writeBuffer();
      assert.equal((await call('/api/repuestos/excel', 'POST', await upload(buffer), 'jefe')).status, 403);
      let imported = await call('/api/repuestos/excel', 'POST', await upload(buffer), 'encargado');
      assert.equal(imported.status, 200, JSON.stringify(imported.data));
      assert.equal(imported.data.creados, 2);
      imported = await call('/api/repuestos/excel', 'POST', await upload(buffer), 'encargado');
      assert.equal(imported.data.actualizados, 2);
      const [[filter]] = await pool.execute("SELECT stock, precio_ref FROM repuestos WHERE codigo = 'FIL-01'");
      assert.deepEqual([Number(filter.stock), Number(filter.precio_ref)], [12, 12500]);
      const [[oil]] = await pool.execute("SELECT stock, precio_ref FROM repuestos WHERE nombre = 'Aceite 15W40'");
      assert.deepEqual([Number(oil.stock), Number(oil.precio_ref)], [20.5, 4990.4]);
      sheet.addRow(['X-1', 'Malo', 'unidad', 'muchos']);
      const bad = await call('/api/repuestos/excel', 'POST', await upload(await book.xlsx.writeBuffer()), 'encargado');
      assert.equal(bad.status, 400);
      assert.match(bad.data.mensaje, /Fila 5/);
      assert.equal((await pool.execute("SELECT id FROM repuestos WHERE codigo = 'X-1'"))[0].length, 0);
      assert.equal((await call('/api/repuestos/excel', 'POST', await upload(Buffer.from('no es excel')), 'encargado')).status, 400);
      const exported = await call('/api/repuestos/excel', 'GET', undefined, 'jefe');
      assert.equal(exported.status, 200);
      const back = new ExcelJS.Workbook();
      await back.xlsx.load(exported.data);
      assert.equal(back.worksheets[0].getRow(1).getCell(1).value, 'Código');
      assert.ok(back.worksheets[0].rowCount >= 3);
      const { routeKm, dayKm, coherentLatest } = require('../src/services/km');
      const reads = [7014, 7034, 7202, 7232, 215610].map((km, i) => ({ dia: `2026-11-0${i + 1}`, km }));
      assert.equal(coherentLatest(reads).km, 7232);
      assert.equal(coherentLatest([]), null);
      const seen = new Set();
      assert.equal(dayKm({ sitio: 153.9, gps: 115.5, salida: 'a' }, seen), 153.9);
      assert.equal(dayKm({ sitio: 153.9, gps: 60, salida: 'a' }, seen), 0);
      assert.equal(dayKm({ sitio: null, gps: 88.8, salida: 'b' }, seen), 88.8);
      // Sin km de Indubal a Indubal: el avance del contador hasta la salida siguiente (descarta reinicios y saltos).
      assert.equal(dayKm({ sitio: null, gps: 40, km_inicial: 16200, next_ki: 16332 }, seen), 132);
      assert.equal(dayKm({ sitio: null, gps: 40, km_inicial: 17324, next_ki: 187 }, seen), 40);
      assert.equal(routeKm({ gps: 41.7, km_inicial: 100, km_final: 142 }), 41.7);
      assert.equal(routeKm({ gps: null, km_inicial: 100, km_final: 150 }), 50);
      assert.equal(routeKm({ gps: null, km_inicial: 100, km_final: 5164643 }), 0);
      // Odómetro con los datos reales de VRWW-63 (13-11-2026): manda la lectura más reciente y coherente.
      const { odometer } = require('../src/services/km');
      const at = t => Date.parse(t);
      const vr = [['2026-11-09T11:13:26Z', 16711, 16770, 141.1], ['2026-11-10T12:09:58Z', 16852, 16933, 125.3], ['2026-11-11T11:20:53Z', 16980, 17096, 153.9],
        ['2026-11-12T00:04:42Z', 1, 1, 0], ['2026-11-12T12:51:12Z', 17324, null, 68.2], ['2026-11-13T14:07:47Z', 187, null, 0]];
      const vrRoutes = vr.map(([t, , , km]) => ({ at: at(t), km }));
      const vrReads = vr.flatMap(([t, ki, kf, km]) => [{ dia: t.slice(0, 10), at: at(t), km: ki, own: t.startsWith('2026-11-12T12') ? km : 0 }, ...(kf ? [{ dia: t.slice(0, 10), at: at(t), km: kf, own: 0 }] : [])]);
      const manual = { km: 17289, dia: '2026-11-11', at: Date.parse('2026-11-11T23:59:59-03:00') };
      // El km real (ajuste del 11-11) manda sobre el calculado por TTS: 17.289 + los viajes posteriores.
      assert.deepEqual([odometer(manual, vrRoutes, vrReads).km, odometer(manual, vrRoutes, vrReads).anchor.km], [17357, 17289]);
      // Sin km real cargado se usa el cálculo de TTS, descartando los reinicios (1 y 187).
      assert.equal(odometer(null, vrRoutes, vrReads).anchor.km, 17324);
      // Un ajuste manual (o el odómetro del registro de combustible) posterior manda: 17.514 + rutas que partan después.
      const later = { km: 17514, dia: '2026-11-13', at: at('2026-11-13T22:00:00Z') };
      assert.equal(odometer(later, [...vrRoutes, { at: at('2026-11-14T11:00:00Z'), km: 130 }], vrReads).km, 17644);
      // Una lectura de TTS posterior no reemplaza al km real.
      assert.equal(odometer(later, vrRoutes, [...vrReads, { dia: '2026-11-14', at: at('2026-11-14T11:00:00Z'), km: 17900, own: 0 }]).anchor.km, 17514);
      assert.equal(odometer(null, [], []), null);
      await pool.execute("INSERT INTO camion_km_diario (patente, fecha, km, rutas) VALUES ('ABC-123', CURDATE(), 120.5, 2)");
      const kmDaily = await call('/api/camiones/km-diario', 'GET', undefined, 'jefe');
      assert.equal(kmDaily.status, 200);
      assert.equal(Number(kmDaily.data.camiones.find(c => c.patente === 'ABC-123').semana), 120.5);
    });
    await t.test('inspección de daños con los daños marcados en el plano y foto de cerca', async () => {
      const png = await require('sharp')({ create: { width: 60, height: 40, channels: 3, background: '#468' } }).png().toBuffer();
      const form = (danos, withCloseUp = true) => {
        const f = new FormData(); f.append('patente', 'ABC-123'); f.append('ruta', 'Santiago - Talca');
        for (const side of ['frente', 'posterior', 'izquierdo', 'derecho']) f.append(side, new Blob([png], { type: 'image/png' }), `${side}.png`);
        f.append('danos', JSON.stringify(danos));
        if (withCloseUp) f.append('dano_0', new Blob([png], { type: 'image/png' }), 'cerca.png');
        return f;
      };
      const mark = { vista: 'izquierdo', x: 42.5, y: 61, tipo: 'abolladura', nota: 'Golpe en la puerta del copiloto', foto: 0 };
      assert.equal((await call('/api/inspecciones-camion', 'POST', form([mark]), 'mecanico')).status, 403);
      assert.equal((await call('/api/inspecciones-camion', 'POST', form([{ ...mark, vista: 'techo' }]), 'encargado')).status, 400);
      assert.equal((await call('/api/inspecciones-camion', 'POST', form([{ ...mark, x: 140 }]), 'encargado')).status, 400);
      assert.equal((await call('/api/inspecciones-camion', 'POST', form([{ ...mark, tipo: 'raro' }]), 'encargado')).status, 400);
      assert.equal((await call('/api/inspecciones-camion', 'POST', form([mark], false), 'encargado')).status, 400);
      const saved = await call('/api/inspecciones-camion', 'POST', form([mark, { vista: 'frente', x: 10, y: 20, tipo: 'rayon', foto: null }]), 'encargado');
      assert.equal(saved.status, 201, JSON.stringify(saved.data));
      const list = (await call('/api/inspecciones-camion', 'GET', undefined, 'encargado')).data.inspecciones;
      const inspection = list.find(i => i.id === saved.data.inspeccion_id);
      assert.equal(inspection.danos.length, 2);
      const [first] = inspection.danos;
      assert.deepEqual([first.vista, first.x, first.y, first.tipo, first.nota], ['izquierdo', 42.5, 61, 'abolladura', 'Golpe en la puerta del copiloto']);
      assert.equal((await call(first.ruta_archivo, 'GET', undefined, 'encargado')).status, 200);
      assert.equal(inspection.danos[1].ruta_archivo, null);
    });
    await t.test('KPI ponderados de mecánicos (a tiempo, reincidencia, preventivas, disponibilidad)', async () => {
      const ins = async (tipo, creada, limite, completada, aplazada = 0, estado = 'Aprobada', trabajo = 'Cambio de culata') => {
        const [r] = await pool.execute("INSERT INTO tareas (tipo_tarea, patente_camion, descripcion, fecha_creacion, fecha_limite, created_by, estado, tipo_mantencion, fecha_completada, veces_aplazada, veces_rechazada) VALUES (?, 'ABC-123', 'x', ?, ?, 1, ?, ?, ?, ?, 0)", [trabajo, creada, limite, estado, tipo, completada, aplazada]);
        await pool.execute('INSERT INTO tarea_mecanicos (id_tarea, id_mecanico) VALUES (?, 4)', [r.insertId]);
      };
      await ins('correctiva', '2026-01-08', '2026-01-15', '2026-01-10', 0, 'Aprobada', 'Frenos'); // a tiempo; otro trabajo: no reincide
      await ins('correctiva', '2026-01-12', '2026-01-18', '2026-01-20');          // atrasada y luego reincide
      await ins('correctiva', '2026-01-25', '2026-02-10', null, 0, 'En_Trabajo'); // reincidencia (sigue abierta)
      await ins('preventiva', '2026-01-02', '2026-01-06', '2026-01-05', 1);       // aplazada: no cuenta a tiempo
      assert.equal((await call('/api/kpis/mecanicos?desde=2026-01-01&hasta=2026-01-31', 'GET', undefined, 'encargado')).status, 403);
      const k = (await call('/api/kpis/mecanicos?desde=2026-01-01&hasta=2026-01-31', 'GET', undefined, 'jefe')).data;
      assert.deepEqual(k.pesos.map(p => p.peso), [25, 25, 15, 15, 10, 10]);
      const m = k.mecanicos.find(x => x.id === 4).metricas;
      // 3 cerradas; la correctiva abierta del 25-01 vence el 10-02 (aún no se juzga en enero).
      assert.deepEqual([m.a_tiempo.ok, m.a_tiempo.total], [1, 3]);
      assert.deepEqual([m.sin_reincidencia.ok, m.sin_reincidencia.total], [1, 2]);
      assert.deepEqual([m.preventivas.ok, m.preventivas.total], [0, 1]);
      assert.deepEqual([m.checklists.ok, m.checklists.total], [0, 3]); assert.equal(m.diagnostico_24h.valor, null);
      assert.ok(m.disponibilidad.valor > 0 && m.disponibilidad.valor < 1, 'hubo días con una correctiva abierta');
      const expected = Math.round((25 * m.disponibilidad.valor + 25 / 3 + 15 * 0.5) / 90 * 100);
      assert.equal(k.mecanicos.find(x => x.id === 4).puntaje, expected);
      assert.equal(k.mecanicos.find(x => x.id === 4).peso_medido, 90);
      assert.equal((await call('/api/kpis/mecanicos?desde=2024-01-01&hasta=2026-01-31', 'GET', undefined, 'jefe')).status, 400);
      // Sin OT resueltas no hay puntaje (antes salía ~99 solo por la disponibilidad de la flota).
      const [[nobody]] = await pool.execute("SELECT id FROM usuarios WHERE rol = 'mecanico' AND id <> 4 LIMIT 1");
      const quiet = (await call('/api/kpis/mecanicos?desde=2026-01-01&hasta=2026-01-31', 'GET', undefined, 'jefe')).data.mecanicos;
      if (nobody) assert.equal(quiet.find(x => x.id === nobody.id).puntaje, null);
      // Una OT abierta y vencida cuenta como atrasada aunque no esté cerrada.
      await ins('correctiva', '2026-01-03', '2026-01-04', null, 0, 'En_Trabajo', 'Dirección');
      const late = (await call('/api/kpis/mecanicos?desde=2026-01-01&hasta=2026-01-31', 'GET', undefined, 'jefe')).data.mecanicos.find(x => x.id === 4);
      assert.deepEqual([late.metricas.a_tiempo.ok, late.metricas.a_tiempo.total], [1, 4]);
      assert.ok(late.ot_vencidas >= 1);
    });
    await t.test('videos se comprimen solos y fotos o videos se pueden borrar mientras la OT está abierta', async () => {
      const ffmpeg = require('ffmpeg-static');
      const raw = path.join(temp, 'prueba.mp4');
      require('node:child_process').execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30', '-t', '2', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', raw]);
      const created = await call('/api/tareas/crear', 'POST', { tipo_tarea: 'Video', patente_camion: 'ABC-123', fecha_limite: '2026-12-31', mecanicos: [4], repuestos: [] }, 'encargado');
      const ot = created.data.tarea_id;
      assert.equal((await call(`/api/tareas/estado/${ot}`, 'PUT', { estado: 'En_Trabajo' }, 'mecanico')).status, 200);
      const up = (buf, type, name) => { const f = new FormData(); f.append('archivo', new Blob([buf], { type }), name); return f; };
      const video = await fs.readFile(raw);
      assert.equal((await call(`/api/evidencia/media/${ot}?momento=antes`, 'POST', up(video, 'video/mp4', 'v.mp4'), 'mecanico')).status, 201);
      let row;
      for (let i = 0; i < 100; i++) { [[row]] = await pool.execute("SELECT ruta_archivo FROM evidencia WHERE id_tarea = ? AND tipo = 'antes'", [ot]); if (/-v\.mp4$/.test(row.ruta_archivo)) break; await new Promise(r => setTimeout(r, 200)); }
      assert.match(row.ruta_archivo, /-v\.mp4$/, 'el video quedó comprimido');
      const small = (await fs.stat(path.join(temp, path.basename(row.ruta_archivo)))).size;
      assert.ok(small < video.length / 2, `comprimido ${small} vs original ${video.length}`);
      assert.equal((await call(row.ruta_archivo, 'GET', undefined, 'mecanico')).status, 200);
      // Borrar: el mecánico borra el después mientras trabaja; no puede borrar la evidencia de falla ni después de enviar a revisión.
      const png = await require('sharp')({ create: { width: 40, height: 30, channels: 3, background: '#a33' } }).png().toBuffer();
      assert.equal((await call(`/api/evidencia/media/${ot}?momento=despues`, 'POST', up(png, 'image/png', 'd.png'), 'mecanico')).status, 201);
      const [[after]] = await pool.execute("SELECT id, ruta_archivo FROM evidencia WHERE id_tarea = ? AND tipo = 'foto'", [ot]);
      assert.equal((await call(`/api/evidencia/${after.id}`, 'DELETE', undefined, 'jefe')).status, 403);
      assert.equal((await call(`/api/evidencia/${after.id}`, 'DELETE', undefined, 'mecanico')).status, 200);
      await assert.rejects(fs.stat(path.join(temp, path.basename(after.ruta_archivo))));
      const fault = new FormData(); fault.append('descripcion', 'Correa'); fault.append('motivo', 'Rota'); fault.append('evidencia', new Blob([png], { type: 'image/png' }), 'f.png');
      assert.equal((await call(`/api/tareas/${ot}/faltante`, 'POST', fault, 'mecanico')).status, 201);
      const [[faultEv]] = await pool.execute("SELECT id FROM evidencia WHERE id_tarea = ? AND tipo = 'falla'", [ot]);
      assert.equal((await call(`/api/evidencia/${faultEv.id}`, 'DELETE', undefined, 'mecanico')).status, 403);
      assert.ok((await call(`/api/tareas/${ot}/historial`, 'GET', undefined, 'jefe')).data.eventos.some(e => e.tipo === 'evidencia_borrada'));
    });
    await t.test('revisión diaria de inventario: conteo con foto, faltante con nota y aclaración', async () => {
      const png = await require('sharp')({ create: { width: 40, height: 30, channels: 3, background: '#753' } }).png().toBuffer();
      const created = await call('/api/repuestos', 'POST', { nombre: 'Llave 14 mm', stock: 5 }, 'encargado'); assert.equal(created.status, 201);
      const [[llave]] = await pool.execute("SELECT id FROM repuestos WHERE nombre = 'Llave 14 mm'");
      const count = (over = {}, photo = true) => { const f = new FormData(); for (const [k, val] of Object.entries({ id_repuesto: String(llave.id), contado: '5', ...over })) f.append(k, val); if (photo) f.append('foto', new Blob([png], { type: 'image/png' }), 'c.png'); return f; };
      assert.equal((await call('/api/inventario/revision', 'POST', count(), 'mecanico')).status, 403);
      assert.equal((await call('/api/inventario/revision', 'POST', count({}, false), 'encargado')).status, 400);
      assert.equal((await call('/api/inventario/revision', 'POST', count({ contado: '4' }), 'encargado')).status, 400);
      let day = (await call('/api/inventario/revision', 'GET', undefined, 'jefe')).data;
      assert.equal(day.items.find(i => i.id_repuesto === llave.id).revision, null);
      assert.equal((await call('/api/inventario/revision', 'POST', count(), 'encargado')).status, 201);
      // Repetir el mismo día reemplaza el conteo: ahora falta una llave y queda por aclarar.
      const short = await call('/api/inventario/revision', 'POST', count({ contado: '4', nota: 'No estaba en el panel' }), 'encargado');
      assert.equal(short.status, 201); assert.match(short.data.mensaje, /faltan 1/);
      day = (await call('/api/inventario/revision', 'GET', undefined, 'jefe')).data;
      const rev = day.items.find(i => i.id_repuesto === llave.id).revision;
      assert.equal(Number(rev.contado), 4); assert.equal(day.faltantes.length, 1); assert.equal(day.historial[0].revisados, 1); assert.equal(new Date(`${day.semana}T12:00:00Z`).getUTCDay(), 1);
      const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM inventario_revision'); assert.equal(n, 1);
      // Contarlo otro día de la misma semana reemplaza el conteo de la semana (no suma otro).
      await pool.execute('UPDATE inventario_revision SET fecha = ? WHERE id = ?', [day.semana, rev.id]);
      assert.equal((await call('/api/inventario/revision', 'POST', count({ contado: '4', nota: 'No estaba en el panel' }), 'encargado')).status, 201);
      const [[{ semanal }]] = await pool.execute('SELECT COUNT(*) AS semanal FROM inventario_revision WHERE id_repuesto = ?', [llave.id]); assert.equal(semanal, 1);
      const again = (await call('/api/inventario/revision', 'GET', undefined, 'jefe')).data.items.find(i => i.id_repuesto === llave.id).revision; rev.ruta_archivo = again.ruta_archivo;
      assert.equal((await call(rev.ruta_archivo, 'GET', undefined, 'jefe')).status, 200);
      assert.equal((await call(rev.ruta_archivo, 'GET', undefined, 'mecanico')).status, 403);
      const [[stock]] = await pool.execute('SELECT stock FROM repuestos WHERE id = ?', [llave.id]); assert.equal(Number(stock.stock), 5);
      // Foto grande del teléfono: con las opciones del inventario se guarda liviana (máx. 1280 px, WebP).
      const big = await require('sharp')({ create: { width: 3000, height: 2000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg().toBuffer();
      const { prepareFile } = require('../src/routes/files');
      const light = await prepareFile({ buffer: big, mimetype: 'image/jpeg', size: big.length }, { uploadLimit: 1e8, image: config.image }, { image: { maxDimension: 1280, quality: 60 } });
      const meta = await require('sharp')(light.buffer).metadata();
      assert.equal(Math.max(meta.width, meta.height), 1280); assert.equal(meta.format, 'webp'); assert.ok(light.buffer.length < big.length / 2);
      assert.equal((await call(`/api/inventario/revision/${rev.id}/aclarar`, 'PUT', { aclaracion: '' }, 'jefe')).status, 400);
      assert.equal((await call(`/api/inventario/revision/${rev.id}/aclarar`, 'PUT', { aclaracion: 'La tenía Pedro en el camión 44' }, 'jefe')).status, 200);
      assert.equal((await call('/api/inventario/revision', 'GET', undefined, 'jefe')).data.faltantes.length, 0);
      await pool.execute('DELETE FROM repuestos WHERE id = ?', [llave.id]);
    });
    await t.test('combustible diario por patente y ruta, con foto y nota', async () => {
      const png = await require('sharp')({ create: { width: 40, height: 30, channels: 3, background: '#357' } }).png().toBuffer();
      const form = (over = {}, photo = true) => { const f = new FormData(); for (const [k, val] of Object.entries({ patente: 'ABC-123', ruta: 'Santiago - Rancagua', nivel: '50', litros: '120,5', nota: 'Llegó con medio estanque', fecha: today(), ...over })) if (val !== null) f.append(k, val); if (photo) f.append('foto', new Blob([png], { type: 'image/png' }), 'nivel.png'); return f; };
      assert.equal((await call('/api/combustible', 'POST', form(), 'mecanico')).status, 403);
      assert.equal((await call('/api/combustible', 'POST', form({}, false), 'encargado')).status, 400);
      assert.equal((await call('/api/combustible', 'POST', form({ nota: '' }), 'encargado')).status, 400);
      assert.equal((await call('/api/combustible', 'POST', form({ nivel: '33' }), 'encargado')).status, 400);
      assert.equal((await call('/api/combustible', 'POST', form({ patente: 'NO-EXISTE' }), 'encargado')).status, 400);
      assert.equal((await call('/api/combustible', 'POST', form(), 'encargado')).status, 201);
      // Odómetro del tablero: corrige el km del camión; uno absurdo (lejos del km del sistema) se rechaza.
      const [[kmNow]] = await pool.execute("SELECT km_actual FROM camiones WHERE patente = 'ABC-123'");
      assert.equal((await call('/api/combustible', 'POST', form({ odometro: String(kmNow.km_actual + 9000) }), 'encargado')).status, 400);
      assert.equal((await call('/api/combustible', 'POST', form({ ruta: 'Rancagua - Santiago', nivel: '25', odometro: String(kmNow.km_actual + 150) }), 'encargado')).status, 201);
      const [[kmAfter]] = await pool.execute("SELECT km_actual, km_base, km_manual, km_base_at FROM camiones WHERE patente = 'ABC-123'");
      assert.equal(kmAfter.km_actual, kmNow.km_actual + 150); assert.equal(kmAfter.km_base, kmNow.km_actual + 150); assert.equal(kmAfter.km_manual, 1); assert.ok(kmAfter.km_base_at);
      const list = (await call('/api/combustible', 'GET', undefined, 'jefe')).data.registros;
      assert.equal(list.find(r => r.nivel === 25).odometro, kmNow.km_actual + 150);
      assert.equal(list.length, 2); assert.equal(Number(list.find(r => r.nivel === 50).litros), 120.5);
      assert.equal((await call(list[0].ruta_archivo, 'GET', undefined, 'jefe')).status, 200);
      assert.equal((await call(list[0].ruta_archivo, 'GET', undefined, 'mecanico')).status, 403);
      assert.equal((await call('/api/combustible', 'GET', undefined, 'mecanico')).status, 403);
      // Informes en PDF: del día y de un camión.
      const day = await call('/api/combustible/informe', 'GET', undefined, 'jefe');
      assert.equal(day.status, 200); assert.match(day.response.headers.get('content-type'), /application\/pdf/);
      assert.equal(day.data.subarray(0, 5).toString(), '%PDF-'); assert.ok(day.data.length > 3000);
      // Un registro cabe en una sola hoja: el pie de página no debe agregar hojas en blanco.
      const pages = buf => (buf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length;
      assert.equal(pages(day.data), 1);
      const truck = await call('/api/combustible/informe?patente=ABC-123', 'GET', undefined, 'encargado');
      assert.equal(truck.status, 200); assert.equal(truck.data.subarray(0, 5).toString(), '%PDF-');
      assert.match(truck.response.headers.get('content-disposition'), /combustible_ABC-123_/);
      assert.equal((await call('/api/combustible/informe?patente=NO-EXISTE', 'GET', undefined, 'jefe')).status, 404);
      assert.equal((await call('/api/combustible/informe?patente=ABC-123&desde=2024-01-01&hasta=2026-01-01', 'GET', undefined, 'jefe')).status, 400);
      const week = await call(`/api/combustible/informe?patente=ABC-123&desde=${today()}&hasta=${today()}`, 'GET', undefined, 'jefe');
      assert.equal(week.status, 200); assert.match(week.response.headers.get('content-disposition'), new RegExp(`combustible_ABC-123_${today()}_${today()}`));
      assert.equal((await call('/api/combustible/informe?fecha=2026-13-40', 'GET', undefined, 'jefe')).status, 400);
      assert.equal((await call('/api/combustible/informe', 'GET', undefined, 'mecanico')).status, 403);
      assert.equal((await call(`/api/combustible/${list[0].id}`, 'DELETE', undefined, 'encargado')).status, 403);
      assert.equal((await call(`/api/combustible/${list[0].id}`, 'DELETE', undefined, 'admin')).status, 200);
    });
    await t.test('fin de ruta en TTS: combustible del conductor y checklist si reporta un problema', async () => {
      const jpg = await require('sharp')({ create: { width: 40, height: 30, channels: 3, background: '#246' } }).jpeg().toBuffer();
      const photos = require('node:http').createServer((req, res) => { if (req.url === '/uploads/t.jpg') res.end(jpg); else { res.statusCode = 404; res.end(); } }).listen(0, '127.0.0.1');
      await once(photos, 'listening');
      const { syncCierres } = require('../src/services/ttsCierres');
      const ok = Object.fromEntries((await require('../src/services/checklist').TEMPLATE).flatMap(g => g.items).map(i => [i.codigo, { codigo: i.codigo, estado: 'ok' }]));
      const rows = [
        { id: 901, patente: 'ABC123', numero: '1', conductor: 'Juan', fecha: today(), cierre: { ruta: 'Ruta 12 · Indubal', nivel: 25, foto: '/uploads/t.jpg', problema: false } },
        { id: 902, patente: null, numero: '12', conductor: 'Pedro', fecha: today(), cierre: { ruta: 'Ruta 13', nivel: 50, foto: '/uploads/t.jpg', problema: true, items: Object.values({ ...ok, '1.3': { codigo: '1.3', estado: 'falla', obs: 'Neumático trasero bajo' } }), observaciones: 'Ruido al frenar' } },
        { id: 903, patente: 'NO-EXISTE', numero: '99', conductor: 'X', fecha: today(), cierre: { nivel: 50, foto: '/uploads/t.jpg', problema: false } },
        { id: 904, patente: 'ABC-123', numero: '1', conductor: 'Y', fecha: today(), cierre: { nivel: 50, foto: '/uploads/falta.jpg', problema: false } },
      ];
      const pg = require.resolve('pg'), real = require(pg);
      require.cache[pg].exports = { Client: class { connect() {} end() {} query() { return { rows }; } } };
      const quiet = console.error; console.error = () => {};
      try {
        const cfg = { ...config, uploads: temp, ttsDatabaseUrl: 'postgres://test', ttsUploadsUrl: `http://127.0.0.1:${photos.address().port}` };
        assert.deepEqual(await syncCierres(pool, cfg), { imported: 2 });
        assert.deepEqual(await syncCierres(pool, cfg), { imported: 0 }); // no se duplica
      } finally { require.cache[pg].exports = real; console.error = quiet; photos.close(); }
      const list = (await call('/api/combustible', 'GET', undefined, 'jefe')).data.registros.filter(r => r.conductor);
      assert.equal(list.length, 2);
      assert.equal(list.find(r => r.conductor === 'Juan').registrado_por, 'Juan (conductor)');
      assert.match(list.find(r => r.conductor === 'Pedro').nota, /1\.3 .*Neumático trasero bajo/);
      const checks = (await call('/api/checklists', 'GET', undefined, 'jefe')).data.checklists.filter(c => c.conductor);
      assert.equal(checks.length, 1); assert.equal(checks[0].responsable, 'Pedro'); assert.equal(checks[0].fallas, 1); assert.equal(checks[0].id_tarea, null);
      const [[aviso]] = await pool.execute("SELECT mensaje FROM notificaciones WHERE mensaje LIKE '%Pedro reportó un problema%'");
      assert.ok(aviso);
    });
    await t.test('WhatsApp automático: avisos con fotos y aprobación respondiendo el mensaje', { skip: 'WhatsApp apagado: las compras se coordinan en el grupo' }, async () => {
      const http = require('node:http');
      const whatsapp = require('../src/services/whatsapp');
      const received = [];
      const fake = http.createServer((rq, rs) => { let b = ''; rq.on('data', c => { b += c; }); rq.on('end', () => { received.push({ url: rq.url, key: rq.headers.apikey, body: JSON.parse(b || '{}') }); rs.setHeader('Content-Type', 'application/json'); rs.end('{}'); }); });
      fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
      const token = `tok_${'x'.repeat(30)}`;
      const app2 = createApp({ pool, config: { ...config, production: false, uploads: temp, uploadLimit: 1024 * 1024, origins: ['http://localhost:5173'], publicUrl: 'https://m.test', evolution: { url: `http://127.0.0.1:${fake.address().port}`, instance: 'tts', key: 'clave-evo' }, whatsappWebhookToken: token }, logger: { error() {} } });
      const s2 = app2.listen(0, '127.0.0.1'); await once(s2, 'listening');
      const base2 = `http://127.0.0.1:${s2.address().port}`;
      const call2 = async (url, method = 'GET', body, who = 'admin', headers = { 'X-Requested-With': 'XMLHttpRequest' }) => {
        const r = await fetch(base2 + url, { method, headers: { ...headers, ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
        return { status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
      };
      const waitFor = async (check, label) => { for (let i = 0; i < 60; i++) { if (check()) return; await new Promise(r => setTimeout(r, 50)); } assert.fail(`No llegó: ${label}`); };
      const texts = number => received.filter(r => r.url.includes('/sendText/') && r.body.number === number).map(r => r.body.text);
      const hook = (number, text, id) => fetch(`${base2}/api/whatsapp/webhook/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'messages.upsert', data: { key: { remoteJid: `${number}@s.whatsapp.net`, fromMe: false, id }, message: { conversation: text } } }) });
      try {
        await pool.execute("UPDATE usuarios SET telefono = '56922223333' WHERE rol = 'encargado'");
        await pool.execute("UPDATE usuarios SET telefono = '56911112222' WHERE rol = 'jefe'");
        assert.equal((await call2('/api/auth/me', 'GET', undefined, 'jefe')).data.usuario.whatsapp_auto, true);
        const created = await call2('/api/tareas/crear', 'POST', { tipo_tarea: 'Cambio de culata', patente_camion: 'ABC-123', fecha_limite: '2026-12-20', mecanicos: [4], tipo_mantencion: 'correctiva', prioridad: 'urgente', repuestos: [] }, 'encargado');
        assert.equal(created.status, 201); const ot = created.data.tarea_id;
        assert.equal((await call2(`/api/tareas/estado/${ot}`, 'PUT', { estado: 'En_Trabajo' }, 'mecanico')).status, 200);
        const png = await require('sharp')({ create: { width: 40, height: 30, channels: 3, background: '#777' } }).png().toBuffer();
        const fault = new FormData(); fault.append('descripcion', 'Culata'); fault.append('cantidad', '1'); fault.append('motivo', 'Culata trizada, pierde agua'); fault.append('evidencia', new Blob([png], { type: 'image/png' }), 'culata.png');
        assert.equal((await call2(`/api/tareas/${ot}/faltante`, 'POST', fault, 'mecanico')).status, 201);
        await waitFor(() => texts('56922223333').some(t => /Necesita cotización · OT #/.test(t) && /Culata trizada/.test(t) && t.includes(`https://m.test/?tarea=${ot}`)), 'aviso al supervisor');
        await waitFor(() => received.some(r => r.url.includes('/sendMedia/') && r.body.number === '56922223333' && r.body.mediatype === 'image'), 'foto de la falla al supervisor');
        assert.ok(received.every(r => r.key === 'clave-evo' && r.url.endsWith('/tts')));
        const line = (await call2(`/api/tareas/${ot}/compras`, 'GET', undefined, 'encargado')).data.repuestos.find(l => l.estado === 'faltante');
        const quote = new FormData(); for (const [k, val] of Object.entries({ id_tarea: ot, id_tarea_repuesto: line.id, proveedor: 'Motores Sur', detalle: 'Culata', monto: 450000 })) quote.append(k, String(val));
        const sent = await call2('/api/cotizaciones/enviar', 'POST', quote, 'encargado');
        assert.equal(sent.status, 201); assert.equal(sent.data.whatsapp, null); assert.match(sent.data.mensaje, /recibió por WhatsApp/);
        const qid = sent.data.id;
        await waitFor(() => texts('56911112222').some(t => t.includes(`APROBAR ${qid}`) && /Culata trizada/.test(t)), 'cotización al jefe');
        // Clave equivocada, número desconocido o texto cualquiera: no hacen nada.
        assert.equal((await fetch(`${base2}/api/whatsapp/webhook/${'y'.repeat(34)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
        await hook('56900000000', `APROBAR ${qid}`, 'm1'); await hook('56911112222', 'hola, ¿cómo va?', 'm2');
        await new Promise(r => setTimeout(r, 200));
        assert.equal((await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [qid]))[0][0].estado, 'pendiente');
        // El jefe responde «RECHAZAR» sin motivo: se le pide el motivo; luego aprueba.
        await hook('56911112222', `RECHAZAR ${qid}`, 'm3');
        await waitFor(() => texts('56911112222').some(t => /Escribe el motivo/.test(t)), 'pedido de motivo');
        await hook('56911112222', `aprobar ${qid}`, 'm4');
        await waitFor(() => texts('56911112222').some(t => /Cotización aprobada/.test(t)), 'confirmación al jefe');
        assert.equal((await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [qid]))[0][0].estado, 'aprobada');
        await waitFor(() => texts('56922223333').some(t => t.includes(`Cotización #${qid} aprobada`)), 'aviso de aprobación al supervisor');
        const history = (await call2(`/api/tareas/${ot}/historial`, 'GET', undefined, 'jefe')).data.eventos;
        assert.ok(history.some(e => e.tipo === 'cotizacion_aprobada'));
        // Solicitud sin OT aprobada por WhatsApp.
        const tool = new FormData(); for (const [k, val] of Object.entries({ categoria: 'herramienta', detalle: 'Llave de impacto', proveedor: 'Ferretería', monto: 90000, motivo: 'Se quebró la del taller' })) tool.append(k, String(val));
        const toolSent = await call2('/api/cotizaciones/compra', 'POST', tool, 'encargado');
        assert.equal(toolSent.status, 201); assert.equal(toolSent.data.whatsapp, null);
        await waitFor(() => texts('56911112222').some(t => t.includes(`APROBAR ${toolSent.data.id}`) && /Herramienta/.test(t)), 'solicitud sin OT al jefe');
        await hook('56911112222', `APROBAR ${toolSent.data.id}`, 'm5');
        await waitFor(() => texts('56911112222').some(t => /sin OT\)\. Ya avisamos/.test(t)), 'confirmación sin OT');
        assert.equal((await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [toolSent.data.id]))[0][0].estado, 'aprobada');
        // Reenvío del mismo mensaje (Evolution reintenta): no hace nada nuevo.
        const before = received.length; await hook('56911112222', `aprobar ${qid}`, 'm4'); await new Promise(r => setTimeout(r, 200));
        assert.equal(received.length, before);
      } finally {
        whatsapp.configure({});
        await new Promise(resolve => { s2.close(resolve); s2.closeAllConnections(); });
        await new Promise(resolve => fake.close(resolve));
      }
    });
    await t.test('versión de datos para actualizar las pantallas al momento', async () => {
      assert.equal((await call('/api/cambios', 'GET', undefined, 'anonymous')).status, 401);
      const before = (await call('/api/cambios', 'GET', undefined, 'jefe')).data.version;
      assert.equal((await call('/api/cambios', 'GET', undefined, 'jefe')).data.version, before);
      assert.equal((await call('/api/repuestos', 'POST', { nombre: 'Refrigerante', stock: 5 }, 'encargado')).status, 201);
      assert.ok((await call('/api/cambios', 'GET', undefined, 'mecanico')).data.version > before);
      const after = (await call('/api/cambios', 'GET', undefined, 'jefe')).data.version;
      assert.equal((await call('/api/repuestos', 'POST', { nombre: '' }, 'encargado')).status, 400);
      assert.equal((await call('/api/cambios', 'GET', undefined, 'jefe')).data.version, after);
    });
    await t.test('sesiones revocadas al salir y al expirar', async () => {
      assert.equal((await call('/api/logout', 'POST', {}, 'mecanico')).status, 200);
      assert.equal((await call('/api/auth/me', 'GET', undefined, 'mecanico')).status, 401);
      await pool.execute('UPDATE app_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE user_id = 3');
      assert.equal((await call('/api/kpis', 'GET', undefined, 'jefe')).status, 401);
    });
  } finally {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (pool) await pool.end();
    // Only this generated, strictly validated test schema can be removed.
    if (/^maintenance_test_[a-f0-9]{16}$/.test(schema)) await connection.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await connection.end();
    if (temp && path.dirname(temp) === path.resolve(__dirname, '..', '.test-uploads') && path.basename(temp).startsWith('run-')) await fs.rm(temp, { recursive: true, force: true });
  }
});
