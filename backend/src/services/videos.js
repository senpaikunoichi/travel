const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Comprime los videos subidos (antes, después, falla) a MP4 H.264 de hasta 1280 px por lado, ~1 Mbps.
// Un video de teléfono de 1 minuto pasa de ~100 MB a ~8 MB. Se hace en segundo plano, de a uno y con baja prioridad:
// el original queda guardado hasta que la versión comprimida está lista; si falla, se conserva el original.
let ffmpeg = null;
try { ffmpeg = require('ffmpeg-static'); } catch { ffmpeg = null; }
const DONE = /-v\.mp4$/; // los ya comprimidos terminan en «-v.mp4»
const VIDEO = /\.(mp4|mov|webm)$/i;
let queue = Promise.resolve();

function run(input, output) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
      '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-threads', '1',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', output];
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    try { os.setPriority(child.pid, 15); } catch { /* sin permiso: prioridad normal */ }
    let err = '';
    child.stderr.on('data', d => { err = (err + d).slice(-500); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(err || `ffmpeg salió con ${code}`)); });
    child.on('error', reject);
  });
}

async function compress(pool, uploads, ruta, logger = console) {
  const name = path.basename(ruta);
  if (!ffmpeg || DONE.test(name) || !VIDEO.test(name)) return false;
  const input = path.join(uploads, name);
  const outName = name.replace(VIDEO, '-v.mp4');
  const output = path.join(uploads, outName);
  try {
    const before = (await fs.stat(input)).size;
    await run(input, output);
    const after = (await fs.stat(output)).size;
    // Se cambia la referencia en la base y recién después se borra el original.
    await pool.execute('UPDATE evidencia SET ruta_archivo = ? WHERE ruta_archivo = ?', [`/uploads/${outName}`, `/uploads/${name}`]);
    await fs.unlink(input).catch(() => {});
    logger.log?.(`Video comprimido: ${name} ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);
    return true;
  } catch (error) {
    await fs.unlink(output).catch(() => {});
    logger.error?.(`No se pudo comprimir ${name}: ${error.message.slice(0, 200)}`);
    return false;
  }
}

// Agrega un video a la cola (no espera el resultado).
function enqueue(pool, uploads, ruta, logger) {
  queue = queue.then(() => compress(pool, uploads, ruta, logger)).catch(() => {});
  return queue;
}

// Videos subidos antes de esta función (o que quedaron a medias por un reinicio).
async function backlog(pool, uploads, logger) {
  const [rows] = await pool.execute("SELECT DISTINCT ruta_archivo FROM evidencia WHERE ruta_archivo REGEXP '\\\\.(mp4|mov|webm)$' AND ruta_archivo NOT LIKE '%-v.mp4'");
  for (const r of rows) enqueue(pool, uploads, r.ruta_archivo, logger);
  return rows.length;
}

module.exports = { enqueue, backlog, compress, available: () => !!ffmpeg };
