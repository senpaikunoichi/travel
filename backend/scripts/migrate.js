const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createPool, transaction } = require('../src/db');
const { hashPassword } = require('../src/passwords');

async function runSqlFile(connection, filename) {
  const sql = await fs.readFile(filename, 'utf8');
  for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await connection.query(statement);
}

async function migrate(pool) {
  const lock = await pool.getConnection();
  let locked = false;
  let name;
  try {
    const [[{ name: database }]] = await lock.execute('SELECT DATABASE() AS name');
    name = 'maintenance-migrate-' + createHash('sha256').update(database).digest('hex').slice(0, 32);
    const [[{ acquired }]] = await lock.execute('SELECT GET_LOCK(?, 30) AS acquired', [name]);
    if (acquired !== 1) throw new Error('No se pudo obtener el bloqueo de migración.');
    locked = true;
    await runSqlFile(lock, path.join(__dirname, '../migrations/000_base_schema.sql'));
    const [columns] = await lock.execute("SELECT CHARACTER_MAXIMUM_LENGTH AS size FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'password'");
    if (!columns.length) throw new Error('No se pudo crear usuarios.password.');
    if (Number(columns[0].size) < 168) await lock.query('ALTER TABLE usuarios MODIFY password VARCHAR(255) NOT NULL');
    await runSqlFile(lock, path.join(__dirname, '../migrations/001_sessions.sql'));
    await runSqlFile(lock, path.join(__dirname, '../migrations/002_truck_inspections.sql'));
    const [dailyUniqueIndexes] = await lock.execute(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspecciones_camion' AND INDEX_NAME = 'uq_inspeccion_camion_dia'",
    );
    if (dailyUniqueIndexes.length) await lock.query('ALTER TABLE inspecciones_camion DROP INDEX uq_inspeccion_camion_dia');
    const [inspectionColumns] = await lock.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspecciones_camion' AND COLUMN_NAME = 'ruta'",
    );
    if (!inspectionColumns.length) await lock.query('ALTER TABLE inspecciones_camion ADD COLUMN ruta VARCHAR(150) NULL AFTER fecha');
    const [truckStatusColumns] = await lock.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camiones' AND COLUMN_NAME = 'estado_operativo'",
    );
    if (!truckStatusColumns.length) await lock.query("ALTER TABLE camiones ADD COLUMN estado_operativo ENUM('activo','panne') NOT NULL DEFAULT 'activo' AFTER modelo");
    const [taskReviewColumns] = await lock.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tareas' AND COLUMN_NAME IN ('nota_rechazo','fecha_rechazo','veces_rechazada')",
    );
    const taskReviewColumnNames = new Set(taskReviewColumns.map(column => column.COLUMN_NAME));
    if (!taskReviewColumnNames.has('nota_rechazo')) await lock.query('ALTER TABLE tareas ADD COLUMN nota_rechazo VARCHAR(2000) NULL AFTER motivo_aplazamiento');
    if (!taskReviewColumnNames.has('fecha_rechazo')) await lock.query('ALTER TABLE tareas ADD COLUMN fecha_rechazo DATETIME NULL AFTER nota_rechazo');
    if (!taskReviewColumnNames.has('veces_rechazada')) await lock.query('ALTER TABLE tareas ADD COLUMN veces_rechazada INT NOT NULL DEFAULT 0 AFTER fecha_rechazo');
    // Compras, inventario y mantención por kilometraje.
    const addColumn = async (table, column, ddl) => {
      const [found] = await lock.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]);
      if (!found.length) await lock.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    };
    await addColumn('tareas', 'tipo_mantencion', "ENUM('preventiva','correctiva','inspeccion') NOT NULL DEFAULT 'correctiva'");
    await addColumn('tareas', 'prioridad', "ENUM('baja','media','alta','urgente') NOT NULL DEFAULT 'media'");
    await addColumn('tareas', 'kilometraje', 'INT NULL');
    await addColumn('tareas', 'esperando_repuesto', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await addColumn('tareas', 'id_plan', 'INT NULL');
    await addColumn('camiones', 'prioridad', "ENUM('baja','media','alta') NOT NULL DEFAULT 'media'");
    await addColumn('camiones', 'km_actual', 'INT NULL');
    await addColumn('camiones', 'km_actualizado_at', 'DATETIME NULL');
    await addColumn('usuarios', 'telefono', 'VARCHAR(20) NULL');
    await addColumn('camiones', 'km_base', 'INT NULL');
    await addColumn('camiones', 'km_base_fecha', 'DATE NULL');
    await addColumn('camiones', 'km_manual', 'BOOLEAN NOT NULL DEFAULT FALSE');
    // Todos los tipos de evidencia en una sola definición (antes, después, boletas, falla del repuesto y lo comprado).
    await lock.query("ALTER TABLE evidencia MODIFY tipo ENUM('foto','boleta','factura','antes','falla','compra') NOT NULL");
    await runSqlFile(lock, path.join(__dirname, '../migrations/003_compras_inventario.sql'));
    // Tablas antiguas pueden existir sin las columnas añadidas por migraciones posteriores.
    await addColumn('repuestos', 'nombre', 'VARCHAR(120) NOT NULL');
    await addColumn('repuestos', 'codigo', 'VARCHAR(50) NULL');
    await addColumn('repuestos', 'unidad', "VARCHAR(20) NOT NULL DEFAULT 'unidad'");
    await addColumn('repuestos', 'stock', 'DECIMAL(10,2) NOT NULL DEFAULT 0');
    await addColumn('repuestos', 'stock_minimo', 'DECIMAL(10,2) NOT NULL DEFAULT 0');
    await addColumn('repuestos', 'precio_ref', 'DECIMAL(12,2) NULL');
    // camion_planes se cruza por patente con camiones: ambas columnas deben compartir collation.
    const [[plate]] = await lock.execute("SELECT COLLATION_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camiones' AND COLUMN_NAME = 'patente'");
    const [[planPlate]] = await lock.execute("SELECT COLLATION_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camion_planes' AND COLUMN_NAME = 'patente'");
    if (/^utf8mb4_[a-z0-9_]+$/.test(plate.name) && plate.name !== planPlate.name) await lock.query(`ALTER TABLE camion_planes MODIFY patente VARCHAR(10) CHARACTER SET utf8mb4 COLLATE ${plate.name} NOT NULL`);
    await runSqlFile(lock, path.join(__dirname, '../migrations/004_km_diario.sql'));
    await addColumn('camion_planes', 'avisado_pronto', 'BOOLEAN NOT NULL DEFAULT FALSE');
    // La compra la registra el supervisor (con comprobante opcional) y queda como gasto de la tarea.
    await addColumn('cotizaciones', 'ruta_comprobante', 'VARCHAR(500) NULL');
    await lock.query("ALTER TABLE gastos MODIFY tipo ENUM('mecanico','factura','compra') NULL");
    // Evidencia del repuesto malo (falla) y foto de lo comprado (compra); historial de cada OT.
    await addColumn('tarea_repuestos', 'motivo', 'VARCHAR(1000) NULL');
    await addColumn('evidencia', 'id_tarea_repuesto', 'INT NULL');
    await addColumn('evidencia', 'id_cotizacion', 'INT NULL');
    await runSqlFile(lock, path.join(__dirname, '../migrations/005_historial_ot.sql'));
    // Combustible con que llega cada camión, por ruta y día, con foto y nota del supervisor.
    await runSqlFile(lock, path.join(__dirname, '../migrations/006_combustible.sql'));
    // Daños marcados en el plano del camión durante la inspección, con foto de cerca.
    await runSqlFile(lock, path.join(__dirname, '../migrations/007_inspeccion_danos.sql'));
    // Revisión diaria del inventario: conteo con foto por ítem; los faltantes quedan por aclarar.
    await runSqlFile(lock, path.join(__dirname, '../migrations/008_revision_inventario.sql'));
    // Checklist de salida de taller (la hoja «Check List - Mantenimiento»), uno por OT.
    await runSqlFile(lock, path.join(__dirname, '../migrations/009_checklists.sql'));
    // Entradas y salidas del inventario (kardex): cada cambio de stock queda con su motivo, OT, camión y quién lo hizo.
    await runSqlFile(lock, path.join(__dirname, '../migrations/010_inventario_movimientos.sql'));
    // El stock que ya había al activar el registro queda como saldo inicial (una vez por repuesto).
    await lock.query(`INSERT INTO inventario_movimientos (id_repuesto, repuesto, tipo, cantidad, stock_despues, motivo, created_at)
      SELECT r.id, r.nombre, 'entrada', r.stock, r.stock, 'Saldo inicial', UTC_TIMESTAMP() FROM repuestos r
      WHERE r.stock <> 0 AND NOT EXISTS (SELECT 1 FROM inventario_movimientos m WHERE m.id_repuesto = r.id)`);
    // Compras sin OT (herramientas, insumos, repuestos para bodega): mismo flujo de aprobación y presupuesto.
    await lock.query('ALTER TABLE cotizaciones MODIFY id_tarea INT NULL');
    await addColumn('cotizaciones', 'categoria', 'VARCHAR(30) NULL');
    await addColumn('cotizaciones', 'motivo', 'VARCHAR(1000) NULL');
    await addColumn('cotizaciones', 'id_repuesto', 'INT NULL');
    await addColumn('cotizaciones', 'ruta_foto_compra', 'VARCHAR(500) NULL');
    // Lo que el mecánico anota al marcar la tarea como realizada.
    await addColumn('tareas', 'observaciones', 'VARCHAR(2000) NULL');
    // «Cotizando»: la tarea queda en pausa (no se atrasa) mientras el supervisor cotiza; al retomarla, la fecha límite se corre esos días.
    await addColumn('tareas', 'cotizando', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await addColumn('tareas', 'cotizando_desde', 'DATE NULL');
    // Hora de la última lectura del odómetro y odómetro anotado en el registro de combustible.
    await addColumn('camiones', 'km_base_at', 'DATETIME NULL');
    await addColumn('combustible_registros', 'odometro', 'INT NULL');
    // Fin de ruta en TTS: el conductor registra el combustible (foto del tablero) y, si el camión tiene un problema, el checklist.
    await lock.query('ALTER TABLE combustible_registros MODIFY created_by INT NULL');
    await lock.query('ALTER TABLE checklists MODIFY id_usuario INT NULL');
    await addColumn('combustible_registros', 'conductor', 'VARCHAR(120) NULL');
    await addColumn('combustible_registros', 'problema', 'BOOLEAN NULL');
    await addColumn('combustible_registros', 'tts_ejecucion', 'INT NULL UNIQUE');
    await addColumn('checklists', 'conductor', 'VARCHAR(120) NULL');
    await addColumn('checklists', 'tts_ejecucion', 'INT NULL UNIQUE');
    // Rutas terminadas sin problema que entraron antes de que también dejaran su checklist del conductor.
    await lock.query(`INSERT IGNORE INTO checklists (id_tarea, patente, fecha, id_usuario, km, items, fallas, conductor, tts_ejecucion, created_at)
      SELECT NULL, patente, fecha, NULL, NULL, JSON_ARRAY(), 0, conductor, tts_ejecucion, created_at FROM combustible_registros WHERE tts_ejecucion IS NOT NULL AND problema = FALSE`);
    const [[dailyPlate]] = await lock.execute("SELECT COLLATION_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camion_km_diario' AND COLUMN_NAME = 'patente'");
    if (/^utf8mb4_[a-z0-9_]+$/.test(plate.name) && plate.name !== dailyPlate.name) await lock.query(`ALTER TABLE camion_km_diario MODIFY patente VARCHAR(10) CHARACTER SET utf8mb4 COLLATE ${plate.name} NOT NULL`);
    const changed = await transaction(pool, async db => {
      const [users] = await db.execute('SELECT id, password FROM usuarios FOR UPDATE');
      let count = 0;
      for (const user of users) {
        if (/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(user.password)) continue;
        if (typeof user.password !== 'string' || !user.password.length) throw new Error('Hay una cuenta sin contraseña válida. Corrígela antes de migrar.');
        await db.execute('UPDATE usuarios SET password = ? WHERE id = ?', [await hashPassword(user.password), user.id]);
        count++;
      }
      return count;
    });
    return changed;
  } finally {
    if (locked) await lock.execute('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
    lock.release();
  }
}
if (require.main === module) {
  const pool = createPool(loadConfig().db);
  migrate(pool).then(count => console.log(`Migración completada. Contraseñas protegidas: ${count}.`)).catch(error => { console.error('Migración fallida:', error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { migrate };
