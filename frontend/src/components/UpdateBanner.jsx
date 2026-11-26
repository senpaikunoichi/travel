import { useEffect, useState } from 'react'
import { Button } from './UI'

// Hay una versión nueva y la persona tiene algo abierto: se actualiza cuando ella lo decide (no se pierde lo escrito).
export default function UpdateBanner() {
  const [apply, setApply] = useState(null)
  useEffect(() => {
    const ready = event => setApply(() => event.detail)
    window.addEventListener('app-update', ready)
    return () => window.removeEventListener('app-update', ready)
  }, [])
  if (!apply) return null
  return <div className="update-banner" role="status">
    <span>Hay una versión nueva de la app. Termina lo que estás haciendo y actualiza.</span>
    <Button onClick={() => apply()}>Actualizar</Button>
  </div>
}

// Botón manual: borra la copia guardada de la app en el teléfono (caché y service worker) y la vuelve a descargar.
// La sesión y los borradores no se pierden (no están en la caché).
const built = import.meta.env.VITE_BUILD ? new Date(import.meta.env.VITE_BUILD).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
export function UpdateApp({ icon = false }) {
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setBusy(true)
    try {
      if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister()))
      if ('caches' in window) await Promise.all((await caches.keys()).map(k => caches.delete(k)))
    } catch { /* si el navegador no deja, igual se recarga */ }
    window.location.reload()
  }
  if (icon) return <button type="button" className="bell update-icon" disabled={busy} aria-label={`Actualizar app${built ? ` (versión del ${built})` : ''}`} title={`Actualizar app${built ? ` · versión del ${built}` : ''}`} onClick={refresh}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={busy ? 'spin' : ''}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
  </button>
  return <div className="update-app">
    <Button variant="secondary" disabled={busy} onClick={refresh}>{busy ? 'Actualizando…' : 'Actualizar app'}</Button>
    {built && <small className="detail-meta">Versión del {built}</small>}
  </div>
}
