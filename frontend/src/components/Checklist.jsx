import { useCallback, useEffect, useState } from 'react'
import { request, download } from '../api'
import { date, dateTime, priorities, today } from '../format'
import { Button, Empty, Field, Section } from './UI'

// La plantilla (ítems de la hoja «Check List - Mantenimiento») viene del servidor y se pide una sola vez.
// También trae la lista corta del conductor (TTS), con la OT que se sugiere por cada falla.
let templatePromise = null
const loadTemplate = () => (templatePromise ||= request('get', '/api/checklist/plantilla').then(r => r.plantilla.concat({ titulo: 'Conductor', items: r.conductor || [] })).catch(e => { templatePromise = null; throw e }))
const nameOf = (template, code) => template?.flatMap(g => g.items).find(i => i.codigo === code)?.nombre || code
const DIAS = { urgente: 0, alta: 1, media: 3, baja: 7 } // plazo sugerido según la prioridad
const plazo = p => { const d = new Date(today() + 'T12:00:00'); d.setDate(d.getDate() + DIAS[p]); return d.toISOString().slice(0, 10) }

// Por cada falla que reportó el conductor, la OT sugerida: el supervisor la abre ya llenada y solo elige el mecánico.
function Suggested({ template, checklist, onCreateTask }) {
  const conductor = template.find(g => g.titulo === 'Conductor').items
  const list = checklist.items.filter(i => i.estado === 'falla').map(i => ({ ...i, ...conductor.find(c => c.codigo === i.codigo) })).filter(i => i.tarea)
  if (!list.length) return null
  return <div className="check-suggested">
    <p className="detail-meta"><strong>OT sugeridas</strong></p>
    <div className="actions">{list.map(i => <Button key={i.codigo} variant={i.prioridad === 'urgente' ? 'primary' : 'soft'} onClick={() => onCreateTask({
      tipo_tarea: i.tarea, patente_camion: checklist.patente, tipo_mantencion: 'correctiva', prioridad: i.prioridad, fecha_limite: plazo(i.prioridad), kilometraje: checklist.km ?? '', mecanicos: [], repuestos: [],
      descripcion: `Reportado por ${checklist.responsable || 'el conductor'} al terminar la ruta (${date(checklist.fecha)}): ${i.nombre}${i.obs ? ` · ${i.obs}` : ''}.${checklist.observaciones ? ` Obs.: ${checklist.observaciones}` : ''}`,
    })}>{i.tarea} · {priorities[i.prioridad]}</Button>)}</div>
  </div>
}
const pdf = (onAction, query, name) => onAction(() => download(`/api/checklists/pdf?${query}`, name), 'Checklist descargado.')

// Ítems con falla u observación, para los resúmenes.
function Issues({ template, checklist }) {
  const list = checklist.items.filter(i => i.estado === 'falla' || i.obs)
  if (checklist.conductor && !checklist.items.length && !checklist.observaciones) return <p className="detail-meta check-ok">✓ Camión en buen estado: el conductor no reportó problemas.</p>
  if (!list.length && !checklist.observaciones) return <p className="detail-meta check-ok">✓ Todos los ítems bien, sin observaciones.</p>
  return <ul className="check-issues">
    {list.map(i => <li key={i.codigo} className={i.estado === 'falla' ? 'is-fault' : ''}><strong>{i.codigo} {nameOf(template, i.codigo)}</strong>{i.estado === 'falla' ? ' · Falla' : ''}{i.obs ? `: ${i.obs}` : ''}</li>)}
    {checklist.observaciones && <li><strong>Obs.:</strong> {checklist.observaciones}</li>}
  </ul>
}

// Checklist de salida de una OT: el mecánico lo llena al terminar; la oficina lo ve y lo descarga.
export function TaskChecklist({ task, editable, onAction, onChange, office = false }) {
  const [template, setTemplate] = useState(null)
  const [saved, setSaved] = useState(undefined)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => Promise.all([loadTemplate(), request('get', `/api/tareas/${task.id}/checklist`)])
    .then(([t, r]) => { setTemplate(t); setSaved(r.checklist); onChange?.(r.checklist); setError('') })
    .catch(() => setError('No pudimos cargar el checklist.')), [task.id, onChange])
  useEffect(() => { load() }, [load])
  if (error) return <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={load}>Reintentar</Button></div>
  if (!template || saved === undefined) return <p role="status" className="loading-state">Cargando checklist…</p>

  const start = () => setForm({ items: Object.fromEntries(template.filter(g => g.titulo !== 'Conductor').flatMap(g => g.items).map(i => [i.codigo, saved?.items.find(s => s.codigo === i.codigo) || { estado: '', obs: '' }])), observaciones: saved?.observaciones || '' })
  const set = (code, change) => setForm(f => ({ ...f, items: { ...f.items, [code]: { ...f.items[code], ...change } } }))
  const pending = form ? Object.entries(form.items).filter(([, i]) => !i.estado || (i.estado === 'falla' && !i.obs.trim())).length : 0
  const save = async event => {
    event.preventDefault()
    const items = Object.entries(form.items).map(([codigo, i]) => ({ codigo, estado: i.estado, obs: i.obs }))
    if (await onAction(() => request('put', `/api/tareas/${task.id}/checklist`, { items, observaciones: form.observaciones }), r => r.mensaje)) { setForm(null); await load() }
  }

  if (form) return <form className="checklist-form" onSubmit={save}>
    <div className="actions"><Button variant="soft" onClick={() => setForm(f => ({ ...f, items: Object.fromEntries(Object.entries(f.items).map(([c, i]) => [c, { ...i, estado: i.estado || 'ok' }])) }))}>Marcar lo que falta como «Bien»</Button></div>
    {template.filter(g => g.titulo !== 'Conductor').map(group => <fieldset key={group.titulo} className="checklist-group"><legend>{group.titulo}</legend>
      {group.items.map(({ codigo, nombre }) => { const item = form.items[codigo]; return <div key={codigo} className={`checklist-row${item.estado === 'falla' ? ' is-fault' : ''}`}>
        <span className="checklist-name">{codigo} {nombre}</span>
        <div className="chip-row" role="group" aria-label={`${codigo} ${nombre}`}>
          <button type="button" className="chip" aria-pressed={item.estado === 'ok'} onClick={() => set(codigo, { estado: 'ok' })}>✓ Bien</button>
          <button type="button" className="chip" aria-pressed={item.estado === 'falla'} onClick={() => set(codigo, { estado: 'falla' })}>✗ Falla</button>
        </div>
        {(item.estado === 'falla' || item.obs) ? <Field label={item.estado === 'falla' ? 'Qué pasa (obligatorio)' : 'Observación'} value={item.obs} maxLength={300} onChange={e => set(codigo, { obs: e.target.value })} required={item.estado === 'falla'} />
          : <button type="button" className="text-link checklist-add-obs" onClick={() => set(codigo, { obs: ' ' })}>+ Observación</button>}
      </div> })}
    </fieldset>)}
    <Field label="Observaciones generales (opcional)" as="textarea" rows={2} maxLength={2000} value={form.observaciones} placeholder="Ej.: Cremallera de dirección con fuga." onChange={e => setForm({ ...form, observaciones: e.target.value })} />
    {pending > 0 && <p className="field-hint warning">Faltan {pending} ítem{pending === 1 ? '' : 's'} por marcar (o anotar qué pasa en los con falla).</p>}
    <div className="actions"><Button type="submit" disabled={pending > 0}>Guardar checklist</Button><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button></div>
    <p className="detail-meta">Si marcas una falla o escribes una observación, al supervisor le llega un aviso.</p>
  </form>

  return <div className="checklist-summary">
    {saved ? <>
      <p className="detail-meta">Llenado por {saved.responsable || '—'} · {dateTime(saved.updated_at || saved.created_at)}{saved.fallas ? ` · ${saved.fallas} con falla` : ''}</p>
      <Issues template={template} checklist={saved} />
    </> : <p className="detail-meta">{editable ? 'Revisa los 22 puntos de la hoja antes de entregar el camión.' : 'Aún sin checklist.'}</p>}
    <div className="actions">
      {editable && <Button variant={saved ? 'secondary' : 'primary'} onClick={start}>{saved ? 'Editar checklist' : 'Llenar checklist'}</Button>}
      {office && saved && <Button variant="secondary" onClick={() => pdf(onAction, `id=${saved.id}`, `checklist_${saved.patente}_${saved.fecha}.pdf`)}>Descargar PDF</Button>}
    </div>
  </div>
}

const TIPOS = { mecanico: 'Mecánicos', conductor: 'Conductores' }

// Historial de checklists por día (oficina), separado en los de mecánicos (salida de taller) y conductores (fin de ruta en TTS),
// con filtro por responsable y PDF de cada uno y del día completo.
export default function Checklists({ trucks, onAction, onOpenTask, onCreateTask, live = 0 }) {
  const [filters, setFilters] = useState({ desde: '', hasta: '', patente: '', tipo: 'mecanico' })
  const [responsable, setResponsable] = useState('')
  const [data, setData] = useState(null)
  const [template, setTemplate] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    const both = filters.desde && filters.hasta
    const q = new URLSearchParams(Object.entries({ ...filters, desde: both ? filters.desde : '', hasta: both ? filters.hasta : '' }).filter(([, v]) => v)).toString()
    return Promise.all([loadTemplate(), request('get', `/api/checklists${q ? `?${q}` : ''}`)])
      .then(([t, r]) => { setTemplate(t); setData(r); setError('') }).catch(() => setError('No pudimos cargar los checklists.'))
  }, [filters])
  useEffect(() => { load() }, [load, live])
  if (error) return <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={load}>Reintentar</Button></div>
  if (!data) return <div className="loading-state" role="status"><span className="spinner" />Cargando checklists…</div>
  const conductores = filters.tipo === 'conductor'
  const people = [...new Set(data.checklists.map(c => c.responsable).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const shown = data.checklists.filter(c => !responsable || c.responsable === responsable)
  const days = [...new Set(shown.map(c => c.fecha))]
  const setTipo = tipo => { setFilters(f => ({ ...f, tipo })); setResponsable('') }
  return <Section id="checklists" title="Checklists">
    <div className="chip-row" role="group" aria-label="Tipo de checklist">{Object.entries(TIPOS).map(([k, label]) => <button type="button" key={k} className="chip" aria-pressed={filters.tipo === k} onClick={() => setTipo(k)}>{label}</button>)}</div>
    <p className="section-description">{conductores
      ? 'Llegan solos cuando el conductor termina la ruta en TTS: dice si el camión presenta algún problema y, si lo tiene, marca qué falla (con la OT sugerida para cada uno). Si hay problema, el supervisor recibe el aviso.'
      : 'Cada OT terminada lleva su checklist de salida de taller (la hoja «Check List - Mantenimiento») que llena el mecánico. Si algo falló, el supervisor recibió el aviso.'} Sin fechas se muestran los últimos 30 días.</p>
    <div className="task-filters fuel-filters">
      <Field label="Desde" type="date" value={filters.desde} onChange={e => setFilters({ ...filters, desde: e.target.value })} />
      <Field label="Hasta" type="date" value={filters.hasta} onChange={e => setFilters({ ...filters, hasta: e.target.value })} />
      <Field label="Camión" as="select" value={filters.patente} onChange={e => setFilters({ ...filters, patente: e.target.value })}><option value="">Todos</option>{trucks.map(t => <option key={t.patente} value={t.patente}>{t.patente}</option>)}</Field>
      <Field label={conductores ? 'Conductor' : 'Mecánico'} as="select" value={responsable} onChange={e => setResponsable(e.target.value)}><option value="">Todos</option>{people.map(p => <option key={p} value={p}>{p}</option>)}</Field>
    </div>
    {days.length ? days.map(day => { const list = shown.filter(c => c.fecha === day); return <div key={day} className="quote-group">
      <div className="section-heading"><h3>{day === data.hoy ? 'Hoy' : date(day)} <span className="history-count">{list.length} checklist{list.length === 1 ? '' : 's'}{list.some(c => c.fallas) ? ` · ${list.filter(c => c.fallas).length} con falla` : ''}</span></h3>
        <Button variant="secondary" onClick={() => pdf(onAction, `fecha=${day}&tipo=${filters.tipo}`, `checklists_${filters.tipo}_${day}.pdf`)}>PDF del día</Button></div>
      <ul className="quote-list">{list.map(c => <li key={c.id} className="quote-card">
        <div className="quote-head"><strong>{c.patente}{c.numero ? ` · N° ${c.numero}` : ''}</strong><span className={`km-state ${c.fallas ? 'km-vencida' : 'km-ok'}`}>{c.fallas ? `${c.fallas} con falla` : 'Todo bien'}</span></div>
        <p className="detail-meta">{c.id_tarea ? <button type="button" className="text-link" onClick={() => onOpenTask(c.id_tarea)}>OT #{c.id_tarea} {c.tipo_tarea}</button> : c.conductor ? `Fin de ${c.ruta || 'ruta'}` : 'Sin OT'} · {c.conductor ? 'Conductor' : 'Mecánico'}: <strong>{c.responsable || '—'}</strong> · {dateTime(c.updated_at || c.created_at)}{c.km ? ` · ${Number(c.km).toLocaleString('es-CL')} km` : ''}</p>
        <Issues template={template} checklist={c} />
        {c.conductor && !c.id_tarea && onCreateTask && <Suggested template={template} checklist={c} onCreateTask={onCreateTask} />}
        <div className="actions"><Button variant="secondary" onClick={() => pdf(onAction, `id=${c.id}`, `checklist_${c.patente}_${c.fecha}.pdf`)}>Descargar PDF</Button></div>
      </li>)}</ul>
    </div> }) : <Empty>{conductores ? 'No hay checklists de conductores en el período. Llegan cuando un conductor termina su ruta en TTS.' : 'No hay checklists de mecánicos en el período. Se crean cuando el mecánico termina una OT.'}</Empty>}
  </Section>
}
