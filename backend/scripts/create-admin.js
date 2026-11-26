const { loadConfig } = require('../src/config');
const { createPool } = require('../src/db');
const { email, text } = require('../src/validation');
const { hashPassword, validatePassword } = require('../src/passwords');

async function createAdmin(pool, env = process.env) {
  const name = text(env.ADMIN_NAME, 'ADMIN_NAME', 100);
  const address = email(env.ADMIN_EMAIL);
  const password = validatePassword(env.ADMIN_PASSWORD, true);
  const [existing] = await pool.execute('SELECT id FROM usuarios WHERE email = ? LIMIT 1', [address]);
  if (existing.length) throw new Error('Ya existe un usuario con ADMIN_EMAIL.');
  const hashed = await hashPassword(password);
  const [result] = await pool.execute("INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, 'admin')", [name, address, hashed]);
  return result.insertId;
}

if (require.main === module) {
  const pool = createPool(loadConfig().db);
  createAdmin(pool)
    .then(id => console.log(`Administrador creado con id ${id}.`))
    .catch(error => { console.error('No se pudo crear el administrador:', error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { createAdmin };
