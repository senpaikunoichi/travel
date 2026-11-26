const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const { createAuth } = require('./auth');
const { HttpError } = require('./validation');

function createApp({ pool, config, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy || false);
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.production ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-Id', req.requestId);
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(cors({ credentials: true, origin(origin, callback) {
    callback(origin && !config.origins.includes(origin) ? new HttpError(403, 'Origen no permitido.') : null, true);
  }, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-Requested-With'] }));
  // A custom header prevents cross-site form submissions; CORS permits only configured origins.
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'XMLHttpRequest') throw new HttpError(403, 'Solicitud no permitida.');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => { req.body ??= {}; next(); });
  const auth = createAuth(pool, config);
  const limiter = (windowMs, limit, message, options = {}) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, mensaje: message }, ...options });
  const loginIpLimit = limiter(15 * 60 * 1000, config.loginIpRateLimit, 'Demasiados intentos desde esta conexión. Inténtalo en 15 minutos.', { skipSuccessfulRequests: true });
  const loginAccountLimit = limiter(15 * 60 * 1000, config.loginRateLimit, 'Demasiados intentos para esta cuenta. Inténtalo en 15 minutos.', {
    skipSuccessfulRequests: true,
    keyGenerator: req => `account:${typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 100) : 'invalid'}`,
  });
  const healthLimit = limiter(60 * 1000, 60, 'Demasiadas solicitudes.');
  if (!config.production) app.get('/api/test', (req, res) => res.json({ mensaje: 'Backend funcionando' }));
  app.get('/api/health', healthLimit, async (req, res) => { await pool.execute('SELECT 1'); res.json({ success: true, status: 'ok' }); });
  app.post('/api/login', loginIpLimit, loginAccountLimit, auth.login);
  app.use(['/api', '/uploads'], limiter(15 * 60 * 1000, config.edgeRateLimit, 'Demasiadas solicitudes desde esta conexión.'));
  app.post('/api/logout', auth.logout);
  app.use(['/api', '/uploads'], auth.requireAuth);
  app.use('/api', limiter(15 * 60 * 1000, config.apiRateLimit, 'Demasiadas solicitudes. Inténtalo más tarde.', { keyGenerator: req => `user:${req.usuario.id}` }));
  app.put('/api/auth/profile', auth.updateProfile);
  app.use(['/api/evidencia/subir', '/api/evidencia/factura', '/api/inspecciones-camion'], limiter(60 * 60 * 1000, config.uploadRateLimit, 'Alcanzaste el límite temporal de cargas.', { keyGenerator: req => `user:${req.usuario.id}` }));
  let activeUploads = 0;
  const concurrentUpload = (req, res, next) => {
    if (activeUploads >= config.uploadConcurrency) throw new HttpError(503, 'El servidor está procesando otras cargas. Inténtalo nuevamente en unos segundos.');
    activeUploads++;
    let released = false;
    const release = () => { if (!released) { released = true; activeUploads--; } };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
  app.use(['/api/evidencia/subir', '/api/evidencia/factura', '/api/inspecciones-camion'], concurrentUpload);
  const inventoryUploadLimit = limiter(60 * 60 * 1000, config.uploadRateLimit, 'Alcanzaste el límite temporal de cargas.', { keyGenerator: req => `user:${req.usuario.id}` });
  const inventoryUploadPaths = ['/api/inventario', '/api/inventario/repuestos', '/api/inventario/ingresos', '/api/inventario/solicitudes', '/api/inventario/solicitudes/:id/comprobante', '/api/inventario/analizar-imagen'];
  app.post(inventoryUploadPaths, inventoryUploadLimit, concurrentUpload);
  app.put('/api/inventario/repuestos/:id', inventoryUploadLimit, concurrentUpload);
  app.get('/api/auth/me', (req, res) => res.json({ success: true, usuario: req.usuario }));
  app.use('/api', require('./routes/catalog')(pool, auth));
  app.use('/api', require('./routes/tasks')(pool, auth));
  app.use('/api', require('./routes/inspections')(pool, auth, config));
  app.use('/api', require('./routes/reports')(pool, auth));
  app.use('/api', require('./routes/inventory')(pool, auth, config));
  app.use(require('./routes/files')(pool, auth, config));
  app.use((req, res, next) => next(new HttpError(404, 'Ruta no encontrada.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error instanceof HttpError ? error.status : 500;
    let mensaje = error instanceof HttpError ? error.message : 'Error interno del servicio.';
    if (error.type === 'entity.parse.failed') { status = 400; mensaje = 'El cuerpo JSON no es válido.'; }
    if (error.type === 'entity.too.large' || error.code === 'LIMIT_FILE_SIZE') { status = 413; mensaje = 'El archivo o solicitud supera el tamaño permitido.'; }
    else if (error.name === 'MulterError') { status = 400; mensaje = 'Carga inválida: selecciona un solo archivo en el campo indicado.'; }
    if (error.code === 'ER_DUP_ENTRY') { status = 409; mensaje = 'Ya existe un registro con esos datos.'; }
    if (error.code === 'ER_BAD_FIELD_ERROR') { status = 503; mensaje = 'El esquema de la base de datos está desactualizado. Ejecuta npm run migrate y reinicia el backend.'; }
    if (['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(error.code)) { status = 409; mensaje = 'El registro está relacionado con otros datos. Revisa sus asociaciones.'; }
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) { status = 409; mensaje = 'Los datos están siendo modificados. Inténtalo nuevamente.'; }
    if (error.code === 'ENOENT') { status = 404; mensaje = 'Archivo no encontrado.'; }
    if (status === 500) logger.error({ requestId: req.requestId, code: error.code || error.name, method: req.method, path: req.path });
    res.status(status).json({ success: false, mensaje, requestId: req.requestId });
  });
  return app;
}
module.exports = { createApp };
