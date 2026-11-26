// Vistas del camión para la inspección guiada y el plano de daños.
export const VIEWS = [['frente', 'Frente'], ['izquierdo', 'Lado izquierdo'], ['derecho', 'Lado derecho'], ['posterior', 'Parte posterior']]
export const viewBox = view => (view === 'izquierdo' || view === 'derecho' ? [240, 120] : [120, 120])
export const DAMAGE_TYPES = [['rayon', 'Rayón'], ['abolladura', 'Abolladura'], ['quebrado', 'Quebrado'], ['falta_pieza', 'Falta pieza'], ['otro', 'Otro']]
export const damageLabel = tipo => DAMAGE_TYPES.find(([v]) => v === tipo)?.[1] || tipo
