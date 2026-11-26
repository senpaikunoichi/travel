export const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Number(value) || 0)
export const date = value => value ? new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CL') : 'Sin fecha'
export const dateTime = value => {
  if (!value) return 'Sin fecha'
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00`).toLocaleDateString('es-CL')
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw
  return new Date(normalized).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' })
}
export const roles = { admin: 'Administrador', encargado: 'Supervisor', jefe: 'Jefe', mecanico: 'Mecánico' }
export const priorities = { baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente' }
export const kinds = { preventiva: 'Preventiva', correctiva: 'Correctiva', inspeccion: 'Inspección' }
export const quoteStates = { pendiente: 'Por aprobar', aprobada: 'Aprobada', rechazada: 'Rechazada', recibida: 'Recibida' }
export const partStates = { pendiente: 'Por retirar', retirado: 'Retirado', faltante: 'No hay repuesto' }
export const isVideo = path => /\.(mp4|mov|webm)$/i.test(path || '')
export const UNITS = ['unidad', 'litro', 'juego', 'kit', 'par', 'metro', 'galón', 'caja', 'set', 'kilo']
// «1 unidad», «2 unidades», «20,5 litros».
export const withUnit = (value, unit = 'unidad') => {
  const n = Number(value), u = String(unit || 'unidad')
  const plural = n === 1 ? u : /[aeiouáéíóú]$/i.test(u) || /t$/i.test(u) ? `${u}s` : /ón$/i.test(u) ? `${u.slice(0, -2)}ones` : `${u}es`
  return `${qty(n)} ${plural}`
}
export const qty = value => Number(value).toLocaleString('es-CL', { maximumFractionDigits: 2 })
export const km = value => value == null ? 'Sin dato' : `${Number(value).toLocaleString('es-CL')} km`
export const thisMonth = () => today().slice(0, 7)
// Fecha local de Chile en AAAA-MM-DD, igual que el backend.
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
// Períodos rápidos de reportes, calculados sobre la fecha de Chile.
export function periods(day = today()) {
  const iso = d => d.toISOString().slice(0, 10)
  const [y, m, d] = day.split('-').map(Number)
  return [
    ['Últimos 7 días', iso(new Date(Date.UTC(y, m - 1, d - 6))), day],
    ['Este mes', iso(new Date(Date.UTC(y, m - 1, 1))), day],
    ['Mes anterior', iso(new Date(Date.UTC(y, m - 2, 1))), iso(new Date(Date.UTC(y, m - 1, 0)))],
    ['Este año', `${y}-01-01`, day],
    ['Año anterior', `${y - 1}-01-01`, `${y - 1}-12-31`],
  ]
}

// En qué va la compra de un repuesto que falta (sin montos: también la ve el mecánico).
const purchaseStage = { pendiente: 'Cotizado: esperando la aprobación del jefe', aprobada: 'Aprobado: esperando que el supervisor lo compre', rechazada: 'Cotización rechazada: se cotizará de nuevo' }
export const stageOf = line => line.estado === 'faltante' ? purchaseStage[line.estado_compra] || 'Por cotizar: el supervisor está buscando precios' : null

// Períodos del informe de combustible por camión (la semana parte el lunes).
export function fuelPeriods(day = today()) {
  const iso = d => d.toISOString().slice(0, 10)
  const [y, m, d] = day.split('-').map(Number)
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // 0 = lunes
  return [
    ['Esta semana', iso(new Date(Date.UTC(y, m - 1, d - dow))), day],
    ['Semana pasada', iso(new Date(Date.UTC(y, m - 1, d - dow - 7))), iso(new Date(Date.UTC(y, m - 1, d - dow - 1)))],
    ['Este mes', iso(new Date(Date.UTC(y, m - 1, 1))), day],
    ['Mes anterior', iso(new Date(Date.UTC(y, m - 2, 1))), iso(new Date(Date.UTC(y, m - 1, 0)))],
    ['Últimos 30 días', iso(new Date(Date.UTC(y, m - 1, d - 29))), day],
  ]
}
