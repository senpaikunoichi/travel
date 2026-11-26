import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { request } from '../api'
import { today } from '../format'
import { ZONES, STATES, damagePoint } from '../fleetZones'
import { Button, Empty, Section, Stat } from './UI'

// El modelo 3D (three.js) se descarga solo al abrir esta vista.
const Truck3D = lazy(() => import('./Truck3D'))
const ORDER = ['detenido', 'critico', 'atencion', 'ok']
const DIAS = { urgente: 0, alta: 1, media: 3, baja: 7 } // plazo sugerido según la prioridad
const plazo = p => { const d = new Date(today() + 'T12:00:00'); d.setDate(d.getDate() + (DIAS[p] ?? 3)); return d.toISOString().slice(0, 10) }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Un marcador por zona del camión; cada daño de la inspección, en su punto exacto.
function markersOf(problemas) {
  const map = new Map()
  for (const p of problemas) {
    const key = p.marca ? p.id : p.zona
    const m = map.get(key) || { key, zona: p.zona, point: p.marca ? damagePoint(p.marca) : null, count: 0, gravedad: 'atencion' }
    m.count++; if (p.gravedad === 'critico') m.gravedad = 'critico'
    map.set(key, m)
  }
  return [...map.values()]
}
// Camión de ejemplo para mostrar cómo se ve la pantalla (no existe ni se guarda nada).
const EJEMPLO = { patente: 'EJEMPLO', numero: '00', modelo: 'Camión de ejemplo', estado: 'critico', km_actual: 128400, ejemplo: true, problemas: [
  { id: 'e1', zona: 'frenos', gravedad: 'critico', titulo: 'Cambio de pastillas de freno', detalle: 'Las pastillas delanteras están gastadas y hace ruido al frenar.', origen: 'Checklist del mecánico · OT abierta (en trabajo)' },
  { id: 'e2', zona: 'frio', gravedad: 'critico', titulo: 'No mantiene la temperatura', detalle: 'La caja no baja de 8 °C.', origen: 'Checklist del conductor al terminar la ruta' },
  { id: 'e3', zona: 'neumaticos', gravedad: 'critico', titulo: 'Neumático trasero izquierdo bajo', detalle: null, origen: 'Checklist del conductor al terminar la ruta' },
  { id: 'e4', zona: 'fugas', gravedad: 'atencion', titulo: 'Gotea aceite bajo el motor', detalle: null, origen: 'Checklist del mecánico' },
  { id: 'e5', zona: 'carroceria', gravedad: 'atencion', titulo: 'Abolladura en el lado izquierdo', detalle: 'Golpe en la caja.', origen: 'Inspección de daños', marca: { vista: 'izquierdo', x: 72, y: 45 } },
  { id: 'e6', zona: 'motor', gravedad: 'atencion', titulo: 'Mantención 10.000 km', detalle: 'Faltan 600 km (le toca a los 129.000 km).', origen: 'Mantención por km' },
] }
const State = ({ value }) => <span className={`recovery-state state-${value}`}><span aria-hidden="true">{STATES[value].icon}</span> {STATES[value].label}</span>

// Plan de recuperación de la flota: todas las patentes con lo malo que tiene cada una, de peor a mejor, y el detalle
// de cada camión en 3D con un marcador donde está cada problema, explicado en palabras simples.
export default function Recovery({ onOpenTask, onCreateTask, live = 0 }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [patente, setPatente] = useState('')
  const [active, setActive] = useState(null)
  const load = useCallback(() => request('get', '/api/flota/recuperacion').then(r => { setData(r); setError('') }).catch(() => setError('No pudimos cargar el plan de recuperación.')), [])
  useEffect(() => { load() }, [load, live])
  const truck = patente === EJEMPLO.patente ? EJEMPLO : data?.camiones.find(c => c.patente === patente) || data?.camiones[0]
  const markers = useMemo(() => (truck ? markersOf(truck.problemas) : []), [truck])
  if (error) return <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={load}>Reintentar</Button></div>
  if (!data) return <div className="loading-state" role="status"><span className="spinner" />Cargando plan de recuperación…</div>
  if (!data.camiones.length) return <Empty>No hay camiones registrados.</Empty>

  const count = Object.fromEntries(ORDER.map(s => [s, data.camiones.filter(c => c.estado === s).length]))
  const total = data.camiones.length, ready = Math.round(count.ok / total * 100)
  const all = data.camiones.flatMap(c => c.problemas)
  const shown = data.camiones.filter(c => !filter || c.estado === filter)
  const open = p => { setPatente(p); setActive(null); setTimeout(() => document.getElementById('recuperacion-detalle')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30) }
  const pick = key => { setActive(key); document.querySelector(`[data-marker="${CSS.escape(key)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }
  const create = p => onCreateTask({
    tipo_tarea: p.sugerida.tipo_tarea, patente_camion: truck.patente, tipo_mantencion: p.sugerida.tipo_mantencion || 'correctiva', prioridad: p.sugerida.prioridad,
    fecha_limite: plazo(p.sugerida.prioridad), kilometraje: truck.km_actual ?? '', descripcion: p.sugerida.descripcion, mecanicos: [], repuestos: [], ...(p.sugerida.id_plan ? { id_plan: p.sugerida.id_plan } : {}),
  })

  return <>
    <div className="fleet-kpi-grid fleet-kpi-grid-4">
      {ORDER.map(s => <Stat key={s} className={`recovery-kpi kpi-${s}`} label={<span><span aria-hidden="true">{STATES[s].icon}</span> {STATES[s].label}</span>} value={count[s]} hint={STATES[s].hint}
        pressed={filter === s} onClick={() => { setFilter(filter === s ? '' : s); document.getElementById('recuperacion')?.scrollIntoView({ block: 'start' }) }} />)}
    </div>

    <Section id="recuperacion" title="Avance de la recuperación">
      <div className="recovery-progress">
        <p><strong>{count.ok} de {total}</strong> camiones están listos, sin problemas pendientes.</p>
        <div role="progressbar" aria-label="Flota recuperada" aria-valuenow={ready} aria-valuemin={0} aria-valuemax={100} className="recovery-bar"><span style={{ width: `${ready}%` }} /></div>
        <p className="detail-meta">Para recuperar el resto: {plural(all.filter(p => p.gravedad === 'critico').length, 'problema crítico', 'problemas críticos')}, {plural(all.filter(p => p.gravedad === 'atencion').length, 'por programar', 'por programar')} y {plural(all.filter(p => !p.id_tarea && p.sugerida).length, 'problema aún sin OT', 'problemas aún sin OT')}.</p>
      </div>
      <div className="chip-row" role="group" aria-label="Filtrar camiones">
        {[['', 'Todos'], ...ORDER.map(s => [s, STATES[s].label])].map(([k, label]) => <button type="button" key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}{k ? ` (${count[k]})` : ''}</button>)}
      </div>
      {shown.length ? <ul className="recovery-grid">{shown.map(c => <li key={c.patente}>
        <button type="button" className={`recovery-truck state-${c.estado}`} aria-pressed={truck.patente === c.patente} onClick={() => open(c.patente)}>
          <span className="recovery-truck-head"><strong>{c.patente}</strong><State value={c.estado} /></span>
          <span className="detail-meta">{c.numero ? `N° ${c.numero} · ` : ''}{c.modelo}</span>
          <span className="recovery-truck-zones">{c.problemas.length ? [...new Set(c.problemas.map(p => ZONES[p.zona].nombre))].join(' · ') : 'Sin problemas'}</span>
        </button>
      </li>)}</ul> : <Empty>No hay camiones en este estado.</Empty>}
    </Section>

    <Section id="recuperacion-detalle" title={truck.ejemplo ? 'Ejemplo' : `${truck.patente}${truck.numero ? ` · N° ${truck.numero}` : ''}`}
      action={truck.ejemplo ? <Button variant="secondary" onClick={() => open(data.camiones[0].patente)}>Volver a la flota</Button> : <Button variant="secondary" onClick={() => open(EJEMPLO.patente)}>Ver un ejemplo</Button>}>
      {truck.ejemplo && <div className="notice" role="note"><span>Esto es un <strong>ejemplo</strong> para mostrar cómo se ve un camión con problemas. No es un camión real y no se guarda nada.</span></div>}
      <p className="section-description"><State value={truck.estado} /> {truck.modelo}{truck.km_actual ? ` · ${Number(truck.km_actual).toLocaleString('es-CL')} km` : ''} · {truck.problemas.length ? `${plural(truck.problemas.length, 'problema', 'problemas')}. Toca un punto del camión o un problema para ver dónde está.` : 'Sin problemas registrados.'}</p>
      <div className="recovery-detail">
        <Suspense fallback={<div className="truck3d loading-state" role="status"><span className="spinner" />Cargando modelo 3D…</div>}>
          <Truck3D key={truck.patente} markers={markers} active={active} onSelect={pick} label={`Modelo 3D de ${truck.patente} con ${plural(markers.length, 'zona marcada', 'zonas marcadas')}`} />
        </Suspense>
        {truck.problemas.length ? <ol className="recovery-list">{truck.problemas.map(p => {
          const key = p.marca ? p.id : p.zona
          return <li key={p.id} data-marker={key} className={`recovery-problem sev-${p.gravedad}${active === key ? ' is-active' : ''}`}>
            <button type="button" className="recovery-problem-zone" aria-pressed={active === key} onClick={() => setActive(active === key ? null : key)}>
              <span className="sev-tag">{p.gravedad === 'critico' ? '▲ Crítico' : '● Atención'}</span><strong>{ZONES[p.zona].nombre}</strong><span className="detail-meta">Ver en el camión ›</span>
            </button>
            {p.titulo.toLowerCase() !== ZONES[p.zona].nombre.toLowerCase() && <p className="recovery-problem-title">{p.titulo}</p>}
            {p.detalle && <p>{p.detalle}</p>}
            <p className="recovery-explain">{ZONES[p.zona].explica}</p>
            <p className="detail-meta">{p.origen}</p>
            {truck.ejemplo ? null : p.id_tarea ? <Button variant="secondary" onClick={() => onOpenTask(p.id_tarea)}>Ver OT #{p.id_tarea}</Button>
              : p.sugerida && onCreateTask && <Button variant="soft" onClick={() => create(p)}>Crear OT: {p.sugerida.tipo_tarea}</Button>}
          </li>
        })}</ol> : truck.estado === 'detenido' ? <div className="recovery-ok recovery-panne"><strong>■ En panne, sin problemas registrados</strong>
          <p className="detail-meta">Ningún checklist reciente tiene fallas de este camión. Cuando el mecánico o el conductor llene un checklist con fallas, aparecerán marcadas aquí.</p>
        </div> : <div className="recovery-ok"><strong>✓ Listo para operar</strong><p className="detail-meta">Su último checklist no tiene fallas, ni hay daños en la última inspección ni mantenciones por km vencidas.</p></div>}
      </div>
    </Section>
  </>
}
