export const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Number(value) || 0)
export const date = value => value ? new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CL') : 'Sin fecha'
export const dateTime = value => {
  if (!value) return 'Sin fecha'
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00`).toLocaleDateString('es-CL')
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw
  return new Date(normalized).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' })
}
export const roles = { admin: 'Administrador', encargado: 'Encargado', jefe: 'Jefe', mecanico: 'Mecánico' }
// Fecha local de Chile en AAAA-MM-DD, igual que el backend.
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
