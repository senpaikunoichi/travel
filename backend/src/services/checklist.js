// Ítems de la hoja «Check List - Mantenimiento» que se llena cuando el camión sale de taller.
const TEMPLATE = [
  ['1. Exterior', [['1.1', 'Carrocería y pintura'], ['1.2', 'Luces: delanteras, traseras e intermitentes'], ['1.3', 'Neumáticos: presión y desgaste'], ['1.4', 'Parabrisas y plumillas'], ['1.5', 'Crucetas y soporte de cardán'], ['1.6', 'Nivel de aceite de diferencial y caja de cambio']]],
  ['2. Motor y fluidos', [['2.1', 'Nivel de aceite motor'], ['2.2', 'Nivel de refrigerante'], ['2.3', 'Embrague y piolas'], ['2.4', 'Fugas de fluidos'], ['2.5', 'Correas y mangueras']]],
  ['3. Sistema eléctrico', [['3.1', 'Batería: carga y bornes'], ['3.2', 'Alternador'], ['3.3', 'Motor de partida']]],
  ['4. Frenos y suspensión', [['4.1', 'Pastillas, balatas, disco de freno y tambores'], ['4.2', 'Amortiguadores, tren delantero y paquete de resortes']]],
  ['5. Interior', [['5.1', 'Cinturones de seguridad'], ['5.2', 'Aire acondicionado / Calefacción'], ['5.3', 'Manillas de puertas y alzavidrios']]],
  ['6. Documentación', [['6.1', 'Permiso de circulación vigente'], ['6.2', 'Revisión técnica vigente'], ['6.3', 'SOAP vigente']]],
].map(([titulo, items]) => ({ titulo, items: items.map(([codigo, nombre]) => ({ codigo, nombre })) }));
const ALL = TEMPLATE.flatMap(g => g.items);

// Lo que el conductor puede notar al terminar la ruta (TTS): toca solo lo que falla. Cada ítem trae la OT que se sugiere
// al supervisor. ponytail: copia en TTS-Logistica-frontend/src/pages/conductor/CierreCamion.jsx (mismos códigos).
const CONDUCTOR = [
  ['C1', 'Neumáticos', 'Bajo, pinchado o dañado', 'Revisar neumáticos', 'alta'],
  ['C2', 'Frenos', 'Ruido, se van largos o tiran a un lado', 'Revisar frenos', 'urgente'],
  ['C3', 'Luces', 'Alguna luz o intermitente no funciona', 'Revisar luces', 'media'],
  ['C4', 'Motor', 'Ruido, humo, pierde fuerza o testigo encendido', 'Revisar motor', 'alta'],
  ['C5', 'Se calienta o pierde agua', 'Temperatura alta o falta refrigerante', 'Revisar sistema de refrigeración', 'alta'],
  ['C6', 'Fugas', 'Gotea aceite, petróleo o agua', 'Revisar fuga de fluidos', 'alta'],
  ['C7', 'Dirección y suspensión', 'Vibra, tiene juego o golpea', 'Revisar dirección y suspensión', 'alta'],
  ['C8', 'Batería o partida', 'Le cuesta partir', 'Revisar batería y motor de partida', 'alta'],
  ['C9', 'Equipo de frío', 'No enfría o no mantiene la temperatura', 'Revisar equipo de frío', 'urgente'],
  ['C10', 'Parabrisas y plumillas', 'Trizado o plumillas malas', 'Revisar parabrisas y plumillas', 'media'],
  ['C11', 'Carrocería y puertas', 'Golpes o puertas de la caja que no cierran', 'Reparar carrocería o puertas', 'media'],
  ['C12', 'Cabina', 'Cinturón, aire, alzavidrios o manillas', 'Revisar cabina', 'media'],
  ['C13', 'Otro problema', 'Algo que no está en la lista', 'Revisar problema reportado por el conductor', 'media'],
].map(([codigo, nombre, ayuda, tarea, prioridad]) => ({ codigo, nombre, ayuda, tarea, prioridad }));
const NAME = Object.fromEntries([...ALL, ...CONDUCTOR].map(i => [i.codigo, i.nombre]));

// Checklist del conductor: solo los ítems con falla (la observación es opcional). Devuelve los conocidos en orden.
function validateConductor(items, HttpError) {
  const byCode = new Map((Array.isArray(items) ? items : []).map(i => [String(i?.codigo), i]));
  const list = CONDUCTOR.filter(c => byCode.has(c.codigo))
    .map(({ codigo }) => ({ codigo, estado: 'falla', obs: typeof byCode.get(codigo).obs === 'string' ? byCode.get(codigo).obs.trim().slice(0, 300) : '' }));
  if (!list.length) throw new HttpError(400, 'Marca qué problema tiene el camión.');
  return list;
}
// El checklist que manda TTS: el corto del conductor (C1…) o, los llenados antes del cambio, la hoja completa.
const isConductor = items => Array.isArray(items) && items.some(i => /^C\d+$/.test(String(i?.codigo)));

// Cada ítem: «ok» o «falla»; la observación es opcional, pero obligatoria si hay falla. Devuelve los ítems limpios en orden.
function validate(items, HttpError) {
  if (!Array.isArray(items)) throw new HttpError(400, 'Completa el checklist.');
  const byCode = new Map(items.map(i => [String(i?.codigo), i]));
  return ALL.map(({ codigo, nombre }) => {
    const item = byCode.get(codigo);
    if (!item || !['ok', 'falla'].includes(item.estado)) throw new HttpError(400, `Falta marcar ${codigo} ${nombre}.`);
    const obs = typeof item.obs === 'string' ? item.obs.trim().slice(0, 300) : '';
    if (item.estado === 'falla' && !obs) throw new HttpError(400, `Anota qué pasa en ${codigo} ${nombre}.`);
    return { codigo, estado: item.estado, obs };
  });
}
// Lo que hay que avisar: ítems con falla y observaciones (aunque el ítem esté bien).
const issues = (items, general) => [
  ...items.filter(i => i.estado === 'falla' || i.obs).map(i => `${i.codigo} ${NAME[i.codigo]}${i.estado === 'falla' ? ' (falla)' : ''}${i.obs ? `: ${i.obs}` : ''}`),
  ...(general ? [`Obs.: ${general}`] : []),
];
module.exports = { TEMPLATE, CONDUCTOR, NAME, validate, validateConductor, isConductor, issues };
