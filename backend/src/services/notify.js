const whatsapp = require('./whatsapp');

// Avisos dentro de la app y, si Evolution está configurado, también por WhatsApp a quienes tengan número.
// `to` admite roles ('encargado') o ids de usuario. `wa` permite un texto más completo y fotos adjuntas.
async function notify(db, to, mensaje, idTarea = null, wa = {}) {
  const roles = to.filter(item => typeof item === 'string');
  const ids = to.filter(item => typeof item === 'number');
  const where = [roles.length && `rol IN (${roles.map(() => '?').join(',')})`, ids.length && `id IN (${ids.map(() => '?').join(',')})`].filter(Boolean).join(' OR ');
  if (!where) return;
  const [users] = await db.execute(`SELECT id, telefono FROM usuarios WHERE ${where}`, [...roles, ...ids]);
  for (const user of users) await db.execute('INSERT INTO notificaciones (id_usuario, mensaje, id_tarea) VALUES (?, ?, ?)', [user.id, mensaje.slice(0, 300), idTarea]);
  if (!whatsapp.enabled()) return;
  const text = wa.text || `${mensaje}${idTarea ? `\nVer la OT #${idTarea}: ${whatsapp.otLink(idTarea)}` : ''}`;
  for (const user of users.filter(u => u.telefono)) whatsapp.afterCommit(db, () => whatsapp.send(user.telefono, text, wa.media || []));
}
module.exports = { notify };
