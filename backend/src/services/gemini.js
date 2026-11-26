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

async function analizarFactura(buffer, mimeType) {
  const prompt = `Analiza esta factura o boleta y extrae SOLO estos dos datos en formato JSON:
  {
    "total": número con el monto total (solo el número, sin símbolos),
    "fecha": "fecha en formato YYYY-MM-DD"
  }
  Si no encuentras algún dato, usa null.
  Responde SOLO con el JSON, sin texto adicional.`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType,
        data: buffer.toString('base64')
      }
    }
  ]);

  return parseJson(result.response.text());
}

function normalizarAnalisisInventario(mode, parsed) {
  if (mode === 'auto') {
    const documentType = ['repuesto', 'boleta', 'factura', 'guia', 'otro'].includes(parsed?.tipo_documento)
      ? parsed.tipo_documento
      : 'otro';
    if (documentType === 'repuesto') {
      return { tipo_documento: documentType, ...normalizarAnalisisInventario('repuesto', parsed) };
    }
    if (['boleta', 'factura', 'guia'].includes(documentType)) {
      return { tipo_documento: documentType, ...normalizarAnalisisInventario('factura', parsed) };
    }
    return { tipo_documento: 'otro' };
  }
  if (mode === 'repuesto') {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('La IA devolvió un resultado incompleto.');
    const text = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
    const confidence = ['alta', 'media', 'baja'].includes(parsed.confianza_analisis) ? parsed.confianza_analisis : 'baja';
    const nombre = text(parsed.nombre_sugerido || parsed.nombre);
    if (!nombre) throw new Error('La IA no pudo identificar el nombre del repuesto.');
    return {
      nombre_sugerido: nombre.slice(0, 150),
      cantidad: Number.isSafeInteger(Number(parsed.cantidad)) && Number(parsed.cantidad) > 0
        ? Math.min(Number(parsed.cantidad), 1000000)
        : 1,
      categoria: text(parsed.categoria).slice(0, 100),
      ubicacion_estimada: text(parsed.ubicacion_estimada).slice(0, 100),
      descripcion: text(parsed.descripcion),
      codigo_referencia: text(parsed.codigo_referencia).slice(0, 100),
      confianza_analisis: confidence,
    };
  }
  if (mode === 'factura') {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.items)) {
      throw new Error('La IA no devolvió una lista de productos válida.');
    }
    return {
      proveedor: typeof parsed.proveedor === 'string' ? parsed.proveedor.trim().slice(0, 150) : '',
      numero_documento: typeof parsed.numero_documento === 'string' ? parsed.numero_documento.trim().slice(0, 100) : '',
      items: parsed.items.slice(0, 50).map(item => ({
        nombre: typeof item?.nombre === 'string' ? item.nombre.trim().slice(0, 150) : '',
        cantidad: Number.isSafeInteger(Number(item?.cantidad)) && Number(item.cantidad) > 0 ? Number(item.cantidad) : 1,
        codigo_referencia: typeof item?.codigo_referencia === 'string' ? item.codigo_referencia.trim().slice(0, 100) : '',
        precio_estimado: item?.precio_estimado !== null && Number.isFinite(Number(item?.precio_estimado)) && Number(item.precio_estimado) > 0 ? Number(item.precio_estimado) : null,
        confianza_analisis: ['alta', 'media', 'baja'].includes(item?.confianza_analisis) ? item.confianza_analisis : 'baja',
      })).filter(item => item.nombre),
    };
  }
  throw new Error('Modo de análisis de inventario inválido.');
}

async function analizarImagenInventario(buffer, mimeType, mode = 'auto') {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error('Configura GEMINI_API_KEY en backend/.env para usar el análisis de imágenes.');
    error.code = 'GEMINI_API_KEY_MISSING';
    throw error;
  }
  const prompt = mode === 'auto'
    ? `Identifica qué muestra la imagen y clasifícala automáticamente como repuesto físico, boleta, factura, guía de despacho u otro. En tipo_documento devuelve exactamente uno de estos valores: "repuesto", "boleta", "factura", "guia" u "otro". Devuelve exclusivamente JSON válido.
Si es un repuesto, usa esta forma:
{"tipo_documento":"repuesto","nombre_sugerido":"nombre claro","categoria":"categoría breve","cantidad":1,"ubicacion_estimada":"","descripcion":"descripción visual breve","codigo_referencia":"","confianza_analisis":"alta|media|baja"}
Si es un documento, usa la misma forma para boleta, factura o guía:
{"tipo_documento":"factura","proveedor":"","numero_documento":"","items":[{"nombre":"nombre de la pieza","cantidad":1,"codigo_referencia":"","precio_estimado":null,"confianza_analisis":"alta|media|baja"}]}
Si no corresponde a ninguno, responde {"tipo_documento":"otro"}.
No inventes códigos, ubicaciones ni datos ilegibles. Para un repuesto, incluye marca, modelo y número de parte en el nombre solo si son legibles; cuenta las unidades visibles y usa 1 si no puede determinarse. Solo indica ubicación si aparece una etiqueta de estante. Para documentos, incluye cada producto legible, su cantidad, código si aparece y precio unitario (no el total de línea) como número sin símbolos o null.`
    : mode === 'repuesto'
    ? `Analiza la foto de un repuesto de taller mecánico. Devuelve exclusivamente JSON válido con esta forma:
{"nombre_sugerido":"nombre claro","categoria":"categoría breve","cantidad":1,"ubicacion_estimada":"","descripcion":"descripción visual breve","codigo_referencia":"","confianza_analisis":"alta|media|baja"}
No inventes códigos ni ubicaciones: si no son claramente visibles, devuelve cadena vacía. Incluye marca, modelo y número de parte en el nombre solo si son legibles. Cuenta las unidades visibles y usa 1 si no puede determinarse. Usa una categoría simple. La ubicación solo se informa si hay una etiqueta de estante visible. Indica confianza baja si no puedes identificar la pieza.`
    : `Analiza la guía de despacho o factura y devuelve exclusivamente JSON válido con esta forma:
{"proveedor":"","numero_documento":"","items":[{"nombre":"nombre de la pieza","cantidad":1,"codigo_referencia":"","precio_estimado":null,"confianza_analisis":"alta|media|baja"}]}
Incluye cada repuesto/ítem legible, su cantidad facturada, código si aparece y precio unitario estimado como número sin símbolos (o null). No inventes datos; omite líneas que no sean productos.`;
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [
      { text: prompt },
      { inlineData: { mimeType, data: buffer.toString('base64') } },
    ] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  return normalizarAnalisisInventario(mode, parseJson(result.response.text()));
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

module.exports = { analizarFactura, analizarImagenInventario, normalizarAnalisisInventario, analizarDanosCamion, parseJson };
