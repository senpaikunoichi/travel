// Zonas del camión para el plan de recuperación: nombre y qué significa, en palabras simples (para quien no es mecánico).
export const ZONES = {
  motor: { nombre: 'Motor', explica: 'El corazón del camión: lo que lo hace andar.' },
  refrigeracion: { nombre: 'Radiador', explica: 'Mantiene el motor frío. Si falla, el motor se recalienta y se puede dañar.' },
  luces: { nombre: 'Luces', explica: 'Focos e intermitentes: para ver de noche y para que los demás vean el camión.' },
  neumaticos: { nombre: 'Neumáticos', explica: 'Las ruedas. Un neumático bajo o dañado puede reventar en ruta.' },
  frenos: { nombre: 'Frenos', explica: 'Lo que detiene el camión. Si fallan, no es seguro salir a ruta.' },
  direccion: { nombre: 'Dirección y suspensión', explica: 'Lo que permite doblar y amortigua los golpes del camino.' },
  bateria: { nombre: 'Batería', explica: 'Da la energía para encender el camión y las luces.' },
  transmision: { nombre: 'Transmisión', explica: 'Embrague, caja de cambios y cardán: llevan la fuerza del motor a las ruedas.' },
  fugas: { nombre: 'Fugas', explica: 'Aceite, petróleo o agua que gotea bajo el camión. Avisa que algo se está rompiendo.' },
  frio: { nombre: 'Equipo de frío', explica: 'Mantiene fría la carga. Si falla, la mercadería se puede perder.' },
  parabrisas: { nombre: 'Parabrisas', explica: 'El vidrio de adelante y las plumillas: el conductor necesita ver bien.' },
  carroceria: { nombre: 'Carrocería', explica: 'El exterior del camión y la caja donde va la carga.' },
  puertas: { nombre: 'Puertas de la caja', explica: 'Si no cierran bien se escapa el frío y la carga queda expuesta.' },
  cabina: { nombre: 'Cabina', explica: 'Donde va el conductor: cinturones, aire, ventanas y manillas.' },
  documentos: { nombre: 'Documentos', explica: 'Permiso de circulación, revisión técnica y SOAP: sin ellos no puede circular.' },
  general: { nombre: 'Otros', explica: 'Problemas que no son de una pieza en particular.' },
}
export const STATES = {
  detenido: { label: 'En panne', icon: '■', hint: 'Fuera de operación' },
  critico: { label: 'Crítico', icon: '▲', hint: 'No debería salir a ruta así' },
  atencion: { label: 'Atención', icon: '●', hint: 'Puede operar; hay que programarlo' },
  ok: { label: 'Listo', icon: '✓', hint: 'Sin problemas registrados' },
}

// Modelo 3D (components/Truck3D.jsx). Ejes: x hacia el frente, y hacia arriba; el lado izquierdo es -z. Metros aprox.
export const FRONT = 4.1, REAR = -3.75
const BOX_TOP = 3.6
// Dónde se pone el marcador de cada zona y qué piezas se iluminan al elegirla.
export const ANCHORS = {
  motor: [[2.8, 1.6, -1.22], ['cab']], refrigeracion: [[4.16, 1.45, 0.35], ['grille']], luces: [[4.16, 1.18, -0.86], ['lights']],
  neumaticos: [[-1.6, 0.5, -1.4], ['wheel-rl1', 'wheel-rl2']], frenos: [[3.2, 0.55, -1.3], ['wheel-fl']], direccion: [[3.2, 0.75, 1.25], ['wheel-fr', 'wheel-fl']],
  bateria: [[1.6, 0.85, 1.2], ['battery']], transmision: [[0.3, 0.62, -0.75], ['frame']], fugas: [[1.5, 0.25, -0.95], ['frame', 'puddle']],
  frio: [[2.36, 3.15, -0.4], ['reefer']], parabrisas: [[4.13, 2.5, 0.3], ['windshield']], carroceria: [[-0.5, 2.4, -1.3], ['box']],
  puertas: [[-3.8, 2.3, 0.4], ['doors']], cabina: [[3.3, 2.5, -1.2], ['cab']], documentos: [[3.5, 2.0, 1.2], ['cab']], general: [[0, 4.1, 0], ['box']],
}

// Un daño marcado en el plano 2D de la inspección (vista + % del dibujo) → punto sobre la cara del camión.
export function damagePoint({ vista, x, y }) {
  if (vista === 'izquierdo' || vista === 'derecho') {
    const px = (vista === 'derecho' ? 100 - x : x) / 100 * 240, py = y / 100 * 120
    return [FRONT - (px - 6) / 226 * (FRONT - REAR), Math.max(0.3, (113 - py) / 99 * BOX_TOP), vista === 'derecho' ? 1.32 : -1.32]
  }
  const px = x / 100 * 120, py = y / 100 * 120, h = Math.max(0.3, (116 - py) / 110 * BOX_TOP)
  return vista === 'frente' ? [FRONT + 0.06, Math.min(h, 3.1), (60 - px) / 46 * 1.15] : [REAR - 0.08, h, (px - 60) / 50 * 1.25]
}

