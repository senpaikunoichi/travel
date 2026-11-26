const { randomBytes, createHash } = require('node:crypto');
const { HttpError, text, email } = require('./validation');
const { hashPassword, verifyPassword, validatePassword } = require('./passwords');
const digest = value => createHash('sha256').update(value).digest('hex');
function cookieToken(req, name) {
  const cookie = (req.headers.cookie || '').split(';').map(p => p.trim()).find(p => p.startsWith(`${name}=`));
  const value = cookie?.slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
function createAuth(pool, config) {
  const cookieName = config.production ? '__Host-maintenance_session' : 'maintenance_session';
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/', priority: 'high' };
  const dummy = hashPassword(randomBytes(32).toString('hex'));
  async function requireAuth(req, res, next) {
    const token = cookieToken(req, cookieName);
    if (!token) throw new HttpError(401, 'Inicia sesión para continuar.');
    const [rows] = await pool.execute('SELECT u.id, u.nombre, u.email, u.rol FROM app_sessions s JOIN usuarios u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()', [digest(token)]);
    if (!rows.length) { res.clearCookie(cookieName, cookieOptions); throw new HttpError(401, 'La sesión expiró. Inicia sesión nuevamente.'); }
    req.usuario = rows[0];
    req.sessionHash = digest(token);
    next();
  }
  function allow(...roles) { return (req, res, next) => { if (!roles.includes(req.usuario.rol)) throw new HttpError(403, 'No tienes permisos para esta operación.'); next(); }; }
  async function login(req, res) {
    const address = email(req.body.email), password = validatePassword(req.body.password);
    const [rows] = await pool.execute('SELECT id, nombre, email, rol, password FROM usuarios WHERE email = ? LIMIT 1', [address]);
    const user = rows[0];
    if (!await verifyPassword(password, user?.password?.startsWith('scrypt$') ? user.password : await dummy)) throw new HttpError(401, 'Email o contraseña incorrectos.');
    const token = randomBytes(32).toString('hex');
    const old = cookieToken(req, cookieName);
    if (old) await pool.execute('DELETE FROM app_sessions WHERE token_hash = ?', [digest(old)]);
    await pool.execute('INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, TIMESTAMPADD(HOUR, ?, UTC_TIMESTAMP()))', [digest(token), user.id, config.sessionHours]);
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: config.sessionHours * 3600000 });
    const { password: omitted, ...usuario } = user;
    void omitted;
    res.json({ success: true, usuario });
  }
  async function logout(req, res) {
    const token = cookieToken(req, cookieName);
    if (token) await pool.execute('DELETE FROM app_sessions WHERE token_hash = ?', [digest(token)]);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ success: true });
  }
  async function updateProfile(req, res) {
    const nombre = text(req.body.nombre, 'Nombre', 100);
    const address = email(req.body.email);
    await pool.execute('UPDATE usuarios SET nombre = ?, email = ? WHERE id = ?', [nombre, address, req.usuario.id]);
    res.json({ success: true, usuario: { ...req.usuario, nombre, email: address }, mensaje: 'Perfil actualizado.' });
  }
  async function taskAccess(db, user, taskId, lock = false) {
    const [rows] = await db.execute(`SELECT * FROM tareas WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [taskId]);
    if (!rows.length) throw new HttpError(404, 'Tarea no encontrada.');
    if (user.rol === 'mecanico') {
      const [assigned] = await db.execute('SELECT id FROM tarea_mecanicos WHERE id_tarea = ? AND id_mecanico = ?', [taskId, user.id]);
      if (!assigned.length) throw new HttpError(403, 'No tienes asignada esta tarea.');
    }
    return rows[0];
  }
  return { requireAuth, allow, login, logout, updateProfile, taskAccess };
}
module.exports = { createAuth };
