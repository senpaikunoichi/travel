const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const { loadConfig } = require('../src/config');
const { migrate } = require('../scripts/migrate');
const { createAdmin } = require('../scripts/create-admin');

test('una base vacia se instala y permite crear el primer administrador', { skip: process.env.RUN_DB_TESTS !== '1', timeout: 30000 }, async () => {
  const config = loadConfig();
  const schema = `maintenance_fresh_${randomBytes(8).toString('hex')}`;
  const connection = await mysql.createConnection(config.db);
  let pool;
  try {
    await connection.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    pool = mysql.createPool({ ...config.db, database: schema });
    assert.equal(await migrate(pool), 0);
    const [tables] = await pool.execute('SHOW TABLES');
    assert.equal(tables.length, 23);
    const id = await createAdmin(pool, { ADMIN_NAME: 'Administrador', ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'clave-segura-de-prueba' });
    assert.equal(id, 1);
    const [[admin]] = await pool.execute('SELECT email, password, rol FROM usuarios WHERE id = 1');
    assert.equal(admin.email, 'admin@test.local');
    assert.equal(admin.rol, 'admin');
    assert.match(admin.password, /^scrypt\$/);
  } finally {
    if (pool) await pool.end();
    await connection.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await connection.end();
  }
});
