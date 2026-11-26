const { loadConfig } = require('../src/config');
const { createPool } = require('../src/db');

const tables = ['repuestos', 'movimientos_inventario', 'solicitudes_compra'];

async function main() {
  const config = loadConfig();
  if (config.db.database !== 'mantenimiento') {
    throw new Error(`DB_NAME apunta a "${config.db.database || '(vacío)'}"; se esperaba "mantenimiento". Revisa backend/.env.`);
  }
  const pool = createPool(config.db);
  try {
    const [[{ db_name: database }]] = await pool.query('SELECT DATABASE() AS db_name');
    const [existing] = await pool.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?, ?)`,
      [database, ...tables],
    );
    const names = new Set(existing.map(row => row.TABLE_NAME));
    let allEmpty = true;
    console.log(`Base de datos: ${database}`);
    for (const table of tables) {
      if (!names.has(table)) {
        allEmpty = false;
        console.log(`${table}: NO EXISTE`);
        continue;
      }
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
      const count = Number(total);
      if (count > 0) allEmpty = false;
      console.log(`${table}: existe · ${count} registro(s)`);
    }
    console.log(allEmpty
      ? 'Resultado: las tres tablas existen y están vacías.'
      : 'Resultado: revisa las tablas inexistentes o con registros indicadas arriba.');
    if (names.size !== tables.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('No se pudo verificar el inventario:', error.code || error.message);
  process.exitCode = 1;
});
