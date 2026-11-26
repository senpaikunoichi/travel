const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError } = require('./validation');
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function validatePassword(value, creating = false) {
  if (typeof value !== 'string' || value.length < (creating ? 12 : 1) || Buffer.byteLength(value) > 256) throw new HttpError(400, creating ? 'La contraseña debe tener al menos 12 caracteres y hasta 256 bytes.' : 'Contraseña inválida.');
  return value;
}
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, options);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored)) return false;
  const [, salt, expected] = stored.split('$');
  const actual = await derive(password, salt, 64, options);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
module.exports = { hashPassword, verifyPassword, validatePassword };
