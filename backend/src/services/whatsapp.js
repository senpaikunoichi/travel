const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

// WhatsApp automático por Evolution API (EVOLUTION_API_URL, EVOLUTION_INSTANCE, EVOLUTION_API_KEY en el .env del backend).
// Sin esas variables queda apagado y la app usa el botón que abre WhatsApp a mano.
let cfg = null;
function configure(config) {
  const e = config.evolution || {};
  cfg = e.url && e.instance && e.key ? { ...e, uploads: config.uploads, publicUrl: config.publicUrl } : null;
}
const enabled = () => !!cfg;
const digits = value => String(value || '').replace(/\D/g, '');
const otLink = id => `${cfg?.publicUrl || ''}/?tarea=${id}`;

async function post(kind, body) {
  const response = await fetch(`${cfg.url.replace(/\/$/, '')}/message/${kind}/${encodeURIComponent(cfg.instance)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Evolution ${kind}: HTTP ${response.status}`);
}

// Fotos (se envían como JPEG, que WhatsApp muestra siempre) y PDF como documento. Los videos van como enlace en el texto.
async function attachment(ruta) {
  const name = path.basename(ruta), ext = path.extname(name).toLowerCase();
  const buffer = await fs.readFile(path.join(cfg.uploads, name));
  if (ext === '.pdf') return { mediatype: 'document', mimetype: 'application/pdf', fileName: name, media: buffer.toString('base64') };
  if (['.webp', '.png', '.jpg', '.jpeg', '.gif'].includes(ext)) return { mediatype: 'image', mimetype: 'image/jpeg', fileName: name.replace(/\.\w+$/, '.jpg'), media: (await sharp(buffer).rotate().jpeg({ quality: 80 }).toBuffer()).toString('base64') };
  return null;
}

// Nunca interrumpe el flujo: si WhatsApp falla, el aviso de la app ya quedó guardado.
async function send(number, text, media = []) {
  if (!cfg || digits(number).length < 8) return false;
  try {
    await post('sendText', { number: digits(number), text });
    for (const ruta of media.filter(Boolean).slice(0, 5)) {
      const file = await attachment(ruta).catch(() => null);
      if (file) await post('sendMedia', { number: digits(number), caption: '', ...file });
    }
    return true;
  } catch (error) {
    console.error('WhatsApp:', error.message);
    return false;
  }
}

// Lo que se envía tras guardar: dentro de una transacción espera al commit; fuera, sale de inmediato.
function afterCommit(db, job) {
  if (Array.isArray(db.afterCommit)) db.afterCommit.push(job);
  else setImmediate(() => Promise.resolve().then(job).catch(() => {}));
}

// Comandos que el jefe puede responder: «APROBAR 12», «RECHAZAR 12 motivo» (también «aprobado 12», «no 12 …»).
function parseCommand(text) {
  const m = String(text || '').trim().match(/^(aprobar|apruebo|aprobado|aprobada|si|sí|ok|rechazar|rechazo|rechazado|rechazada|no)\s*#?\s*(\d+)\s*[:,.-]?\s*([\s\S]*)$/i);
  if (!m) return null;
  const approve = /^(apro|apru|si|sí|ok)/i.test(m[1]);
  return { decision: approve ? 'aprobar' : 'rechazar', id: Number(m[2]), nota: m[3].trim() };
}

module.exports = { configure, enabled, send, afterCommit, parseCommand, digits, otLink };
