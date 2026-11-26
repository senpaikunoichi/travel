const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const { createAuth } = require('./auth');
const { HttpError } = require('./validation');
const { timingSafeEqual } = require('node:crypto');
const whatsapp = require('./services/whatsapp');
const changes = require('./services/changes');

function createApp({ pool, config, logger = console }) {
  const app = express();
  whatsapp.configure(config);
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy || false);
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.production ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
  }));
  // Todo cambio guardado (POST/PUT/DELETE exitoso) sube la versión de los datos.
  app.use((req, res, next) => {
    // El webhook de WhatsApp recibe todos los mensajes del número (grupos, conductores): solo cuenta si aprueba o rechaza.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.path.startsWith('/api/whatsapp/webhook')) res.once('finish', () => { if (res.statusCode < 400) changes.bump(); });
    next();
  });
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-Id', req.requestId);
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(cors({ credentials: true, origin(origin, callback) {
    callback(origin && !config.origins.includes(origin) ? new HttpError(403, 'Origen no permitido.') : null, true);
  }, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-Requested-With'] }));
  // Respuestas por WhatsApp (Evolution → webhook): el jefe aprueba con «APROBAR 12» o rechaza con «RECHAZAR 12 motivo».
  // Va antes del control CSRF porque lo llama Evolution, no el navegador; lo protege una clave larga en la URL.
  const seen = new Set();
  app.post('/api/whatsapp/webhook/:token', express.json({ limit: '2mb' }), async (req, res) => {
    const expected = Buffer.from(config.whatsappWebhookToken || ''), given = Buffer.from(String(req.params.token));
    if (!expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new HttpError(404, 'No encontrado.');
    res.json({ success: true });
    const items = [].concat(req.body?.data || []);
    for (const data of items) {
      if (req.body?.event && !/messages[._]upsert/i.test(req.body.event)) continue;
      const key = data?.key || {};
      if (key.fromMe || !String(key.remoteJid || '').endsWith('@s.whatsapp.net')) continue;
      if (key.id) { if (seen.has(key.id)) continue; seen.add(key.id); if (seen.size > 1000) seen.delete(seen.values().next().value); }
      const command = whatsapp.parseCommand(data.message?.conversation || data.message?.extendedTextMessage?.text);
      if (!command) continue; // Al número le escriben otros (TTS): solo se atienden comandos de jefes registrados.
      const phone = whatsapp.digits(key.remoteJid.split('@')[0]);
      const [bosses] = await pool.execute("SELECT id, nombre, email, rol, telefono FROM usuarios WHERE rol IN ('jefe', 'admin') AND telefono IS NOT NULL");
      const user = bosses.find(u => { const d = whatsapp.digits(u.telefono); return d.length >= 8 && (d === phone || d.slice(-9) === phone.slice(-9)); });
      if (!user) continue;
      let reply;
      try {
        const { decideQuote } = require('./routes/purchases');
        const result = await decideQuote(pool, command.id, command.decision, command.nota, user, config);
        reply = `${result.mensaje} (#${command.id}: ${result.quote.detalle.slice(0, 60)} · ${result.task ? result.task.patente_camion : 'sin OT'}). Ya avisamos al supervisor.`;
      } catch (error) {
        reply = error instanceof HttpError ? `No se pudo: ${error.message}${command.decision === 'rechazar' && !command.nota ? ` Escribe el motivo, por ejemplo: RECHAZAR ${command.id} busca otro proveedor.` : ''}` : 'No se pudo registrar tu respuesta. Inténtalo de nuevo o hazlo en la app.';
        if (!(error instanceof HttpError)) logger.error('Webhook WhatsApp:', error.message);
      }
      changes.bump();
      await whatsapp.send(user.telefono, reply);
    }
  });
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
  // Consulta liviana y frecuente de las pantallas abiertas: fuera de los límites por conexión, pero con sesión.
  app.get('/api/cambios', auth.requireAuth, (req, res) => res.json({ success: true, version: changes.current() }));
  app.use(['/api', '/uploads'], limiter(15 * 60 * 1000, config.edgeRateLimit, 'Demasiadas solicitudes desde esta conexión.'));
  app.post('/api/logout', auth.logout);
  app.use(['/api', '/uploads'], auth.requireAuth);
  app.use('/api', limiter(15 * 60 * 1000, config.apiRateLimit, 'Demasiadas solicitudes. Inténtalo más tarde.', { keyGenerator: req => `user:${req.usuario.id}` }));
  app.use(['/api/evidencia/subir', '/api/cotizaciones/:id/recibir', '/api/tarea-repuestos/:id/faltante', '/api/tareas/:id/faltante', '/api/evidencia/media', '/api/cotizaciones/enviar', '/api/cotizaciones/compra', '/api/repuestos/excel', '/api/combustible', '/api/inventario/revision', '/api/inspecciones-camion'], limiter(60 * 60 * 1000, config.uploadRateLimit, 'Alcanzaste el límite temporal de cargas.', { keyGenerator: req => `user:${req.usuario.id}`, skip: req => req.method === 'GET' }));
  let activeUploads = 0;
  app.use(['/api/evidencia/subir', '/api/cotizaciones/:id/recibir', '/api/tarea-repuestos/:id/faltante', '/api/tareas/:id/faltante', '/api/evidencia/media', '/api/cotizaciones/enviar', '/api/cotizaciones/compra', '/api/combustible', '/api/inventario/revision', '/api/inspecciones-camion'], (req, res, next) => {
    if (activeUploads >= config.uploadConcurrency) throw new HttpError(503, 'El servidor está procesando otras cargas. Inténtalo nuevamente en unos segundos.');
    activeUploads++;
    let released = false;
    const release = () => { if (!released) { released = true; activeUploads--; } };
    res.once('finish', release);
    res.once('close', release);
    next();
  });
  // Errores del navegador (pantalla que falla, formulario que no se envía): quedan en el registro del servidor.
  app.post('/api/errores-cliente', (req, res) => {
    const clip = (value, n) => String(value ?? '').replace(/[\r\n]+/g, ' | ').slice(0, n);
    logger.error(`Cliente: ${JSON.stringify({ usuario: req.usuario.id, rol: req.usuario.rol, tipo: clip(req.body.tipo, 40), mensaje: clip(req.body.mensaje, 500), detalle: clip(req.body.detalle, 1500), pantalla: clip(req.body.pantalla, 200), navegador: clip(req.get('user-agent'), 160) })}`);
    res.json({ success: true });
  });
  app.get('/api/auth/me', (req, res) => res.json({ success: true, usuario: { ...req.usuario, whatsapp_auto: whatsapp.enabled() } }));
  app.use('/api', require('./routes/catalog')(pool, auth));
  app.use('/api', require('./routes/tasks')(pool, auth, config));
  app.use('/api', require('./routes/purchases')(pool, auth, config));
  app.use('/api', require('./routes/inspections')(pool, auth, config));
  app.use('/api', require('./routes/reports')(pool, auth, config));
  app.use('/api', require('./routes/fuel')(pool, auth, config));
  app.use('/api', require('./routes/inventoryCheck')(pool, auth, config));
  app.use('/api', require('./routes/checklists')(pool, auth));
  app.use('/api', require('./routes/recovery')(pool, auth));
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
    if (['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(error.code)) { status = 409; mensaje = 'El registro está relacionado con otros datos. Revisa sus asociaciones.'; }
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) { status = 409; mensaje = 'Los datos están siendo modificados. Inténtalo nuevamente.'; }
    if (error.code === 'ENOENT') { status = 404; mensaje = 'Archivo no encontrado.'; }
    if (status === 500) logger.error({ requestId: req.requestId, code: error.code || error.name, method: req.method, path: req.path });
    res.status(status).json({ success: false, mensaje, requestId: req.requestId });
  });
  return app;
}
module.exports = { createApp };
