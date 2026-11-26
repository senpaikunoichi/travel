const fs = require('node:fs/promises');
const { loadConfig } = require('./src/config');
const { createPool } = require('./src/db');
const { createApp } = require('./src/app');

async function start() {
  const config = loadConfig();
  const pool = createPool(config.db);
  try {
    await pool.execute('SELECT token_hash FROM app_sessions LIMIT 0');
    await pool.execute('SELECT id FROM inspecciones_camion LIMIT 0');
    await pool.execute('SELECT id, costo_unitario FROM repuestos LIMIT 0');
    await pool.execute('SELECT id FROM movimientos_inventario LIMIT 0');
    await pool.execute('SELECT id FROM solicitudes_compra LIMIT 0');
    const [[{ pending }]] = await pool.execute("SELECT COUNT(*) AS pending FROM usuarios WHERE password NOT REGEXP '^scrypt[$][a-f0-9]{32}[$][a-f0-9]{128}$'");
    if (pending) throw new Error('Ejecuta npm run migrate antes de iniciar el backend.');
    await fs.mkdir(config.uploads, { recursive: true });
    const app = createApp({ pool, config });
    const server = app.listen(config.port, config.host, () => console.log(`Backend disponible en http://${config.host}:${config.port}`));
    server.requestTimeout = 120000;
    server.headersTimeout = 15000;
    const cleanup = setInterval(() => pool.execute('DELETE FROM app_sessions WHERE expires_at <= UTC_TIMESTAMP()').catch(error => console.error('Session cleanup:', error.code)), 15 * 60 * 1000);
    cleanup.unref();
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      clearInterval(cleanup);
      const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000);
      deadline.unref();
      server.close(async () => { await pool.end(); clearTimeout(deadline); });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    server.on('error', async error => { clearInterval(cleanup); console.error('No se pudo iniciar el servidor:', error.code); await pool.end(); process.exitCode = 1; });
    return server;
  } catch (error) { await pool.end(); throw error; }
}
if (require.main === module) start().catch(error => { console.error('Inicio fallido:', error.code || error.message, 'Verifica la configuración y ejecuta npm run migrate.'); process.exitCode = 1; });
module.exports = { start };
