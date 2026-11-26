import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '../api'
import { dateTime } from '../format'
import { Button } from './UI'

// Avisos de la app: se consultan cada minuto y al volver a la pestaña; el número también aparece en el título.
export default function Notifications({ onOpenTask, onNavigate, live = 0 }) {
  const [state, setState] = useState({ notificaciones: [], sin_leer: 0 })
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const load = useCallback(() => request('get', '/api/notificaciones').then(setState).catch(() => {}), [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 60000)
    const visible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', visible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [load])
  useEffect(() => { if (live) load() }, [live, load])
  useEffect(() => { document.title = `${state.sin_leer ? `(${state.sin_leer}) ` : ''}Mantenimiento | Travel Trans` }, [state.sin_leer])
  useEffect(() => {
    if (!open) return
    const close = event => { if (!box.current?.contains(event.target)) setOpen(false) }
    const escape = event => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  const read = async id => { await request('post', '/api/notificaciones/leer', id ? { id } : {}).catch(() => {}); load() }

  return <div className="notifications" ref={box}>
    <button type="button" className="bell" aria-expanded={open} aria-label={state.sin_leer ? `Avisos: ${state.sin_leer} sin leer` : 'Avisos'} onClick={() => { setOpen(!open); if (!open) load() }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      {state.sin_leer > 0 && <span className="bell-count" aria-hidden="true">{state.sin_leer > 9 ? '9+' : state.sin_leer}</span>}
    </button>
    {open && <div className="notification-panel" role="dialog" aria-label="Avisos">
      <div className="notification-head"><strong>Avisos</strong>{state.sin_leer > 0 && <Button variant="soft" onClick={() => read()}>Marcar todo leído</Button>}</div>
      {state.notificaciones.length ? <ul>{state.notificaciones.map(n => <li key={n.id}>
        <button type="button" className={n.leida ? '' : 'unread'} onClick={() => { read(n.id); setOpen(false); if (n.id_tarea) onOpenTask(n.id_tarea); else if (/compra|cotizaci/i.test(n.mensaje)) onNavigate?.('compras') }}>
          <span>{n.mensaje}</span><small>{dateTime(n.created_at)}</small>
        </button>
      </li>)}</ul> : <p className="detail-meta">No tienes avisos.</p>}
    </div>}
  </div>
}
