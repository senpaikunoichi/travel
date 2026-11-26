const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function integer(value, fallback, min, max, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`Configuración inválida: ${name}`);
  return result;
}

function boolean(value, fallback, name) {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Configuración inválida: ${name}`);
}

function webhookToken(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origins = (env.CORS_ORIGINS || (production ? '' : 'http://localhost:5173,http://127.0.0.1:5173')).split(',').map(s => s.trim()).filter(Boolean);
  if (production && !origins.length) throw new Error('Define CORS_ORIGINS con el origen HTTPS del frontend.');
  origins.forEach(origin => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (production && parsed.protocol !== 'https:')) throw new Error('CORS_ORIGINS contiene un origen inválido.');
  });
  const host = env.HOST || '127.0.0.1';
  if (production && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('En producción HOST debe ser una interfaz local detrás del proxy inverso.');
  if (production && (!env.DB_PASSWORD || Buffer.byteLength(env.DB_PASSWORD) < 16)) throw new Error('En producción DB_PASSWORD debe tener al menos 16 bytes.');
  return {
    production, origins,
    port: integer(env.PORT, 5000, 1, 65535, 'PORT'),
    host,
    trustProxy: integer(env.TRUST_PROXY_HOPS, 0, 0, 5, 'TRUST_PROXY_HOPS'),
    sessionHours: integer(env.SESSION_HOURS, 8, 1, 24, 'SESSION_HOURS'),
    apiRateLimit: integer(env.API_RATE_LIMIT, 600, 60, 5000, 'API_RATE_LIMIT'),
    edgeRateLimit: integer(env.EDGE_RATE_LIMIT, 1200, 100, 10000, 'EDGE_RATE_LIMIT'),
    uploadRateLimit: integer(env.UPLOAD_RATE_LIMIT, 30, 1, 500, 'UPLOAD_RATE_LIMIT'),
    uploadConcurrency: integer(env.UPLOAD_CONCURRENCY, 2, 1, 10, 'UPLOAD_CONCURRENCY'),
    loginRateLimit: integer(env.LOGIN_RATE_LIMIT, 10, 3, 100, 'LOGIN_RATE_LIMIT'),
    loginIpRateLimit: integer(env.LOGIN_IP_RATE_LIMIT, 50, 10, 500, 'LOGIN_IP_RATE_LIMIT'),
    allowMultipleDailyInspections: boolean(env.ALLOW_MULTIPLE_DAILY_INSPECTIONS, false, 'ALLOW_MULTIPLE_DAILY_INSPECTIONS'),
    uploadLimit: integer(env.MAX_UPLOAD_MB, 10, 1, 25, 'MAX_UPLOAD_MB') * 1024 * 1024,
    videoLimit: integer(env.MAX_VIDEO_MB, 100, 5, 500, 'MAX_VIDEO_MB') * 1024 * 1024,
    publicUrl: (env.PUBLIC_URL || origins[0] || 'http://localhost:5173').replace(/\/$/, ''),
    ttsDatabaseUrl: env.TTS_DATABASE_URL || '',
    ttsUploadsUrl: env.TTS_UPLOADS_URL || 'http://127.0.0.1:3000,http://127.0.0.1:3002',
    ttsSyncMinutes: integer(env.TTS_SYNC_MINUTES, 60, 5, 1440, 'TTS_SYNC_MINUTES'),
    evolution: boolean(env.WHATSAPP_ACTIVO, false, 'WHATSAPP_ACTIVO')
      ? { url: env.EVOLUTION_API_URL || '', instance: env.EVOLUTION_INSTANCE || '', key: env.EVOLUTION_API_KEY || '' }
      : { url: '', instance: '', key: '' },
    whatsappWebhookToken: webhookToken(env.WHATSAPP_WEBHOOK_TOKEN),
    image: {
      maxDimension: integer(env.IMAGE_MAX_DIMENSION, 2560, 800, 6000, 'IMAGE_MAX_DIMENSION'),
      quality: integer(env.IMAGE_WEBP_QUALITY, 82, 50, 95, 'IMAGE_WEBP_QUALITY'),
      maxPixels: integer(env.IMAGE_MAX_MEGAPIXELS, 40, 5, 100, 'IMAGE_MAX_MEGAPIXELS') * 1000000,
    },
    uploads: path.resolve(__dirname, '..', 'uploads'),
    db: { host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: integer(env.DB_PORT, 3306, 1, 65535, 'DB_PORT'), connectionLimit: 10, waitForConnections: true, queueLimit: 100, connectTimeout: 10000, dateStrings: true, timezone: 'Z', charset: 'utf8mb4' },
  };
}
module.exports = { loadConfig };
