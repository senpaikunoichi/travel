class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function text(value, name, max, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(400, `${name}: ingresa un texto de hasta ${max} caracteres.`);
  return value.trim();
}
function id(value) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw new HttpError(400, 'Identificador inválido.');
  return Number(value);
}
function email(value) {
  const result = text(value, 'Email', 100).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new HttpError(400, 'Email inválido.');
  return result;
}
function role(value) {
  if (!['admin', 'jefe', 'encargado', 'mecanico'].includes(value)) throw new HttpError(400, 'Rol inválido.');
  return value;
}
function taskPriority(value = 'Media') {
  if (!['Baja', 'Media', 'Alta'].includes(value)) throw new HttpError(400, 'Prioridad inválida.');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01' || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Fecha inválida; utiliza AAAA-MM-DD.');
  return value;
}
function dateRange(query) {
  if (query.fecha_inicio === undefined && query.fecha_fin === undefined) return [];
  const from = date(query.fecha_inicio), to = date(query.fecha_fin);
  if (from > to) throw new HttpError(400, 'El inicio del período debe ser anterior al final.');
  return [from, to];
}
function amount(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value)) || Number(value) <= 0 || Number(value) > 99999999.99) throw new HttpError(400, 'El monto debe ser positivo y tener hasta dos decimales.');
  return Number(value).toFixed(2);
}
function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function tomorrow(day) { return new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10); }
function affected(result) { if (!result.affectedRows) throw new HttpError(404, 'Registro no encontrado.'); }
module.exports = { HttpError, text, id, email, role, taskPriority, date, dateRange, amount, today, tomorrow, affected };
