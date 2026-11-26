const fs = require('node:fs/promises');
const { loadConfig } = require('./src/config');
const { createPool } = require('./src/db');
const { createApp } = require('./src/app');
const { syncTts } = require('./src/services/km');
const { syncCierres } = require('./src/services/ttsCierres');
const videos = require('./src/services/videos');

async function start() {
  const config = loadConfig();
  const pool = createPool(config.db);
  try {
    await pool.execute('SELECT token_hash FROM app_sessions LIMIT 0');
    await pool.execute('SELECT id FROM inspecciones_camion LIMIT 0');
    const [[{ pending }]] = await pool.execute("SELECT COUNT(*) AS pending FROM usuarios WHERE password NOT REGEXP '^scrypt[$][a-f0-9]{32}[$][a-f0-9]{128}$'");
    if (pending) throw new Error('Ejecuta npm run migrate antes de iniciar el backend.');
    await fs.mkdir(config.uploads, { recursive: true });
    const app = createApp({ pool, config });
    const server = app.listen(config.port, config.host, () => console.log(`Backend disponible en http://${config.host}:${config.port}`));
    // Videos guardados sin comprimir (subidos antes de esta función o que quedaron a medias por un reinicio).
    videos.backlog(pool, config.uploads).catch(error => console.error('Compresión de videos:', error.code || error.name));
    server.requestTimeout = 600000; // videos desde el celular
    server.headersTimeout = 15000;
    const cleanup = setInterval(() => pool.execute('DELETE FROM app_sessions WHERE expires_at <= UTC_TIMESTAMP()').catch(error => console.error('Session cleanup:', error.code)), 15 * 60 * 1000);
    cleanup.unref();
    const runSync = () => syncTts(pool, config.ttsDatabaseUrl).catch(error => console.error('Sincronización TTS:', error.code || error.name));
    const kmSync = config.ttsDatabaseUrl ? setInterval(runSync, config.ttsSyncMinutes * 60 * 1000) : null;
    kmSync?.unref();
    if (kmSync) runSync();
    // Combustible y estado del camión que deja el conductor al terminar la ruta en TTS: cada 5 minutos.
    const runCierres = () => syncCierres(pool, config).catch(error => console.error('Cierres TTS:', error.code || error.message));
    const cierres = config.ttsDatabaseUrl ? setInterval(runCierres, 5 * 60 * 1000) : null;
    cierres?.unref();
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      clearInterval(cleanup);
      if (kmSync) clearInterval(kmSync);
      if (cierres) clearInterval(cierres);
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
