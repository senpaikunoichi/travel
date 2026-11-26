import { request } from './api'

// Informa al servidor errores que de otro modo nadie ve (pantalla que falla, formulario que el navegador no deja enviar).
const sent = new Set()
export function reportError(tipo, mensaje, detalle = '') {
  const key = `${tipo}:${mensaje}`
  if (sent.has(key) || sent.size > 20) return
  sent.add(key)
  request('post', '/api/errores-cliente', { tipo, mensaje: String(mensaje), detalle: String(detalle), pantalla: window.location.pathname + window.location.search }).catch(() => {})
}
let installed = false
export function installErrorReporting() {
  if (installed) return
  installed = true
  window.addEventListener('error', e => reportError('error', e.message, `${e.filename}:${e.lineno}:${e.colno} ${e.error?.stack || ''}`))
  window.addEventListener('unhandledrejection', e => reportError('promesa', e.reason?.message || e.reason, e.reason?.stack || ''))
  // Un campo inválido bloquea el envío sin que nada llegue al servidor: se informa cuál y por qué.
  document.addEventListener('invalid', e => {
    const f = e.target
    reportError('campo-invalido', `${f.closest('form')?.className || 'form'} › ${f.labels?.[0]?.textContent || f.name || f.type}`, `${f.validationMessage} · valor: "${String(f.value).slice(0, 60)}"`)
  }, true)
}
