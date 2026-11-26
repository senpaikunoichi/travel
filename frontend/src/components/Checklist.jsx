import { useCallback, useEffect, useState } from 'react'
import { request, download } from '../api'
import { date, dateTime } from '../format'
import { Button, Empty, Field, Section } from './UI'

// La plantilla (ítems de la hoja «Check List - Mantenimiento») viene del servidor y se pide una sola vez.
let templatePromise = null
const loadTemplate = () => (templatePromise ||= request('get', '/api/checklist/plantilla').then(r => r.plantilla).catch(e => { templatePromise = null; throw e }))
const nameOf = (template, code) => template?.flatMap(g => g.items).find(i => i.codigo === code)?.nombre || code
const pdf = (onAction, query, name) => onAction(() => download(`/api/checklists/pdf?${query}`, name), 'Checklist descargado.')

// Ítems con falla u observación, para los resúmenes.
function Issues({ template, checklist }) {
  const list = checklist.items.filter(i => i.estado === 'falla' || i.obs)
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

  const start = () => setForm({ items: Object.fromEntries(template.flatMap(g => g.items).map(i => [i.codigo, saved?.items.find(s => s.codigo === i.codigo) || { estado: '', obs: '' }])), observaciones: saved?.observaciones || '' })
  const set = (code, change) => setForm(f => ({ ...f, items: { ...f.items, [code]: { ...f.items[code], ...change } } }))
  const pending = form ? Object.entries(form.items).filter(([, i]) => !i.estado || (i.estado === 'falla' && !i.obs.trim())).length : 0
  const save = async event => {
    event.preventDefault()
    const items = Object.entries(form.items).map(([codigo, i]) => ({ codigo, estado: i.estado, obs: i.obs }))
    if (await onAction(() => request('put', `/api/tareas/${task.id}/checklist`, { items, observaciones: form.observaciones }), r => r.mensaje)) { setForm(null); await load() }
  }

  if (form) return <form className="checklist-form" onSubmit={save}>
    <div className="actions"><Button variant="soft" onClick={() => setForm(f => ({ ...f, items: Object.fromEntries(Object.entries(f.items).map(([c, i]) => [c, { ...i, estado: i.estado || 'ok' }])) }))}>Marcar lo que falta como «Bien»</Button></div>
    {template.map(group => <fieldset key={group.titulo} className="checklist-group"><legend>{group.titulo}</legend>
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

// Historial de checklists por día (oficina), con PDF de cada uno y del día completo.
export default function Checklists({ trucks, onAction, onOpenTask, live = 0 }) {
  const [filters, setFilters] = useState({ desde: '', hasta: '', patente: '' })
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
  const days = [...new Set(data.checklists.map(c => c.fecha))]
  return <Section id="checklists" title="Checklists de salida de taller">
    <p className="section-description">Cada OT terminada lleva su checklist (la hoja «Check List - Mantenimiento»), y también el que llena el conductor si al terminar la ruta reporta un problema. Si algo falló, el supervisor recibió el aviso. Sin fechas se muestran los últimos 30 días.</p>
    <div className="task-filters fuel-filters">
      <Field label="Desde" type="date" value={filters.desde} onChange={e => setFilters({ ...filters, desde: e.target.value })} />
      <Field label="Hasta" type="date" value={filters.hasta} onChange={e => setFilters({ ...filters, hasta: e.target.value })} />
      <Field label="Camión" as="select" value={filters.patente} onChange={e => setFilters({ ...filters, patente: e.target.value })}><option value="">Todos</option>{trucks.map(t => <option key={t.patente} value={t.patente}>{t.patente}</option>)}</Field>
    </div>
    {days.length ? days.map(day => { const list = data.checklists.filter(c => c.fecha === day); return <div key={day} className="quote-group">
      <div className="section-heading"><h3>{day === data.hoy ? 'Hoy' : date(day)} <span className="history-count">{list.length} checklist{list.length === 1 ? '' : 's'}{list.some(c => c.fallas) ? ` · ${list.filter(c => c.fallas).length} con falla` : ''}</span></h3>
        <Button variant="secondary" onClick={() => pdf(onAction, `fecha=${day}`, `checklists_${day}.pdf`)}>PDF del día</Button></div>
      <ul className="quote-list">{list.map(c => <li key={c.id} className="quote-card">
        <div className="quote-head"><strong>{c.patente}{c.numero ? ` · N° ${c.numero}` : ''}</strong><span className={`km-state ${c.fallas ? 'km-vencida' : 'km-ok'}`}>{c.fallas ? `${c.fallas} con falla` : 'Todo bien'}</span></div>
        <p className="detail-meta">{c.id_tarea ? <button type="button" className="text-link" onClick={() => onOpenTask(c.id_tarea)}>OT #{c.id_tarea} {c.tipo_tarea}</button> : c.conductor ? 'Conductor al terminar la ruta' : 'Sin OT'} · {c.responsable || '—'} · {dateTime(c.updated_at || c.created_at)}{c.km ? ` · ${Number(c.km).toLocaleString('es-CL')} km` : ''}</p>
        <Issues template={template} checklist={c} />
        <div className="actions"><Button variant="secondary" onClick={() => pdf(onAction, `id=${c.id}`, `checklist_${c.patente}_${c.fecha}.pdf`)}>Descargar PDF</Button></div>
      </li>)}</ul>
    </div> }) : <Empty>No hay checklists en el período. Se crean cuando el mecánico termina una OT.</Empty>}
  </Section>
}
