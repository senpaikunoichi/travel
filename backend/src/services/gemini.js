const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });

function parseJson(text) {
  const clean = text.trim().replace(/```json|```/gi, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('La IA no devolvió un JSON válido.');
  return JSON.parse(clean.slice(start, end + 1));
}

async function analizarDanosCamion(anterior, actual) {
  const lados = [
    ['frente', 'frontal'],
    ['posterior', 'posterior'],
    ['izquierdo', 'lateral izquierdo'],
    ['derecho', 'lateral derecho'],
  ];
  const prompt = `Compara dos inspecciones fotográficas del mismo camión. Cada inspección contiene exactamente cuatro vistas emparejadas: una anterior y una actual por cada lado.

Haz una inspección minuciosa y sensible, lado por lado y por zonas (superior, central e inferior). Busca cambios nuevos aunque sean pequeños: rayones finos o cortos, líneas claras u oscuras nuevas sobre la pintura, raspaduras, transferencia de pintura, grietas, abolladuras sutiles, golpes, piezas rotas, sueltas o desprendidas. Presta especial atención a puertas, guardabarros, parachoques, esquinas y paneles laterales, incluido el lateral derecho.

Un rayón puede ser delgado, de poco contraste y ocupar pocos píxeles. Si observas una marca lineal localizada en la imagen actual que no aparece en la anterior, repórtala como rayadura. Si parece un daño nuevo pero no puedes confirmarlo totalmente, NO lo descartes: inclúyelo con confianza baja y explica su ubicación. Usa hay_diferencias=true siempre que exista al menos un hallazgo, incluso con confianza baja.

Evita falsos positivos: no marques como daño una diferencia amplia o difusa explicable solamente por reflejos, sombras, barro, iluminación, perspectiva o carga. Evalúa primero la misma zona en ambas fotos y distingue una marca localizada sobre la superficie de un cambio global de luz.

Devuelve SOLO JSON con esta forma:
{
  "hay_diferencias": boolean,
  "nivel": "sin_cambios" | "leve" | "moderado" | "grave" | "inconcluso",
  "resumen": "explicación breve en español",
  "hallazgos": [{ "lado": "frente|posterior|izquierdo|derecho", "tipo": "choque|rayadura|abolladura|rotura|otro", "descripcion": "qué cambió y dónde", "confianza": "baja|media|alta" }]
}
Si las fotos completas no permiten comparar por desenfoque, encuadre o resolución, usa nivel inconcluso y explica el motivo. No uses sin_cambios si viste una marca nueva plausible: regístrala como hallazgo de confianza baja.`;
  const parts = [prompt];
  for (const [key, label] of lados) {
    parts.push(`INSPECCIÓN ANTERIOR - vista ${label}`);
    parts.push({ inlineData: { mimeType: anterior[key].mime, data: anterior[key].buffer.toString('base64') } });
    parts.push(`INSPECCIÓN ACTUAL - vista ${label}`);
    parts.push({ inlineData: { mimeType: actual[key].mime, data: actual[key].buffer.toString('base64') } });
  }
  const result = await model.generateContent(parts);
  const parsed = parseJson(result.response.text());
  const levels = new Set(['sin_cambios', 'leve', 'moderado', 'grave', 'inconcluso']);
  if (typeof parsed.hay_diferencias !== 'boolean' || !levels.has(parsed.nivel) || typeof parsed.resumen !== 'string' || !Array.isArray(parsed.hallazgos)) {
    throw new Error('La IA devolvió un resultado incompleto.');
  }
  const hallazgos = parsed.hallazgos.slice(0, 20).map(item => ({
    lado: String(item.lado || '').slice(0, 20),
    tipo: String(item.tipo || '').slice(0, 30),
    descripcion: String(item.descripcion || '').slice(0, 500),
    confianza: String(item.confianza || '').slice(0, 10),
  }));
  const hasFindings = hallazgos.length > 0;
  return {
    hay_diferencias: parsed.hay_diferencias || hasFindings,
    nivel: hasFindings && parsed.nivel === 'sin_cambios' ? 'leve' : parsed.nivel,
    resumen: parsed.resumen.slice(0, 2000),
    hallazgos,
  };
}

module.exports = { analizarDanosCamion, parseJson };
