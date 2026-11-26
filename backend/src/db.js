const mysql = require('mysql2/promise');
function createPool(config) {
  if (!config.host || !config.user || !config.database) throw new Error('Faltan DB_HOST, DB_USER o DB_NAME.');
  return mysql.createPool(config);
}
async function transaction(pool, operation) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally { connection.release(); }
}
module.exports = { createPool, transaction };
