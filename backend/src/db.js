const mysql = require('mysql2/promise');
function createPool(config) {
  if (!config.host || !config.user || !config.database) throw new Error('Faltan DB_HOST, DB_USER o DB_NAME.');
  return mysql.createPool(config);
}
async function transaction(pool, operation) {
  const connection = await pool.getConnection();
  // Trabajos que deben salir solo si el cambio se guardó (p. ej. WhatsApp).
  connection.afterCommit = [];
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    for (const job of connection.afterCommit) Promise.resolve().then(job).catch(() => {});
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally { connection.afterCommit = null; connection.release(); }
}
module.exports = { createPool, transaction };
