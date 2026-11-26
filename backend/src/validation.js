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
function oneOf(value, list, name, fallback) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  if (!list.includes(value)) throw new HttpError(400, `${name} inválido.`);
  return value;
}
function km(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d{1,7}$/.test(String(value))) throw new HttpError(400, 'Kilometraje inválido: usa solo números.');
  return Number(value);
}
function quantity(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value)) || Number(value) <= 0 || Number(value) > 99999) throw new HttpError(400, 'La cantidad debe ser positiva y tener hasta dos decimales.');
  return Number(value).toFixed(2);
}
function stock(value) {
  if (value === undefined || value === null || value === '') return '0.00';
  if (!/^\d+(\.\d{1,2})?$/.test(String(value)) || Number(value) > 9999999) throw new HttpError(400, 'Stock inválido.');
  return Number(value).toFixed(2);
}
function month(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new HttpError(400, 'Mes inválido; utiliza AAAA-MM.');
  return value;
}
function phone(value) {
  if (value === undefined || value === null || value === '') return null;
  const digits = String(value).replace(/[\s()+.-]/g, '');
  if (!/^\d{8,15}$/.test(digits)) throw new HttpError(400, 'Teléfono inválido: incluye el código de país, por ejemplo 56912345678.');
  return digits;
}
function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function tomorrow(day) { return new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10); }
function affected(result) { if (!result.affectedRows) throw new HttpError(404, 'Registro no encontrado.'); }
module.exports = { HttpError, text, id, email, role, date, dateRange, amount, oneOf, km, quantity, stock, month, phone, today, tomorrow, affected };
