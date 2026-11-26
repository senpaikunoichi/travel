import { useCallback, useEffect, useState } from 'react'
import { request, download } from '../api'
import { dateTime, km, qty } from '../format'
import { Button, CaptureButton, Empty, Field, Section, Stat, Table } from './UI'

// Mantenciones por kilometraje: planes (cada N km) y el estado de cada camión según su km diario de TTS.
export default function KmPlans({ role, parts, onAction, onCreateTask, onOpenTask, live = 0 }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState(null)
  const [part, setPart] = useState({ id_repuesto: '', cantidad: '1' })
  const manages = ['admin', 'encargado'].includes(role)
  const [daily, setDaily] = useState(null)
  const [truck, setTruck] = useState('')
  const [only, setOnly] = useState('')
  const jump = id => document.getElementById(id)?.scrollIntoView({ block: 'start' })
  const load = useCallback(() => Promise.all([request('get', '/api/planes'), request('get', '/api/camiones/km-diario?dias=30')])
    .then(([plans, kmData]) => { setData(plans); setDaily(kmData); setError('') })
    .catch(() => setError('No pudimos cargar las mantenciones por kilometraje.')), [])
  useEffect(() => { load() }, [load, live])
  const act = async (operation, message) => { const ok = await onAction(operation, message); if (ok) await load(); return ok }
  if (error) return <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={load}>Reintentar</Button></div>
  if (!data || !daily) return <div className="loading-state" role="status"><span className="spinner" />Cargando…</div>
  const planById = Object.fromEntries(data.planes.map(p => [p.id, p]))
  const rows = data.estado.map(r => {
    const plan = planById[r.id_plan]
    const next = r.km_ultimo == null ? null : r.km_ultimo + plan.cada_km
    const left = next == null || r.km_actual == null ? null : next - r.km_actual
    return { ...r, plan, next, left, state: left == null ? 'sin-dato' : left <= 0 ? 'vencida' : left <= plan.cada_km * 0.1 ? 'pronto' : 'ok' }
  }).sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity))
  const due = rows.filter(r => r.state === 'vencida')
  const partName = id => parts.find(p => p.id === Number(id))?.nombre || 'Repuesto'
  const savePlan = async event => {
    event.preventDefault()
    if (await act(() => request(editor.id ? 'put' : 'post', editor.id ? `/api/planes/${editor.id}` : '/api/planes', editor), r => r.mensaje)) setEditor(null)
  }
  return <>
    <div className="fleet-kpi-grid">
      <Stat label="Mantenciones vencidas" value={due.length} hint={due.length ? 'Crea la tarea para cada una' : 'Todo al día'} pressed={only === 'vencida'} onClick={() => { setOnly(only === 'vencida' ? '' : 'vencida'); jump('km') }} />
      <Stat label="Se acercan (desde el 90 %)" value={rows.filter(r => r.state === 'pronto').length} hint="Planifícalas con tiempo" pressed={only === 'pronto'} onClick={() => { setOnly(only === 'pronto' ? '' : 'pronto'); jump('km') }} />
      <Stat label="Planes activos" value={data.planes.length} hint={data.tts ? 'Kilometraje desde TTS' : 'Kilometraje manual'} onClick={() => jump('planes')} />
    </div>
    <Section id="km-recorridos" title="Kilómetros recorridos" action={manages && <div className="actions">
      <Button variant="secondary" onClick={() => onAction(() => download('/api/camiones/km/plantilla', 'km_tablero.xlsx'), 'Plantilla descargada: llena «Km tablero» y súbela.')}>Plantilla de km (Excel)</Button>
      <CaptureButton variant="secondary" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onFiles={([file]) => {
        if (!file) return
        const body = new FormData()
        body.append('archivo', file)
        act(() => request('post', '/api/camiones/km/excel', body, { timeout: 120000 }), r => r.mensaje)
      }}>Subir km del tablero</CaptureButton>
      {data.tts && <Button variant="secondary" onClick={() => act(() => request('post', '/api/camiones/sincronizar-km'), r => r.mensaje)}>Sincronizar km con TTS</Button>}
    </div>}>
      {manages && <p className="section-description"><strong>Km real de toda la flota de una vez:</strong> descarga la plantilla, escribe en «Km tablero» lo que marca el tablero de cada camión (deja en blanco los que no quieras cambiar) y súbela. Desde ahí se le suma a cada camión lo que recorre en TTS.</p>}
      <p className="section-description">{daily.tts ? 'Cada hora se suman los kilómetros del día de cada camión según TTS: el recorrido completo de Indubal a Indubal por GPS (o el de la ruta, si no volvió a Indubal). El km actual parte de la última lectura del odómetro; si no coincide con el tablero, corrígelo una vez con «Km actual» y desde ahí se le suma lo recorrido cada día.' : 'La conexión con TTS no está configurada: ingresa el kilometraje a mano con «Km actual».'}</p>
      {daily.camiones.length ? <Table label="Kilómetros por camión" headings={['Camión', 'Km actual', 'Hoy', '7 días', '30 días', 'Mes', 'Prom. diario']}>
        {daily.camiones.map(c => <tr key={c.patente} className={truck === c.patente ? 'selected' : ''}>
          <td><button type="button" className="text-link" onClick={() => setTruck(truck === c.patente ? '' : c.patente)} aria-expanded={truck === c.patente}>{c.patente}</button><small className="detail-meta">{c.numero ? `N° ${c.numero} · ` : ''}{c.km_actualizado_at ? `Actualizado ${dateTime(c.km_actualizado_at)}` : 'Sin lectura'}</small></td>
          <td className="num"><strong>{km(c.km_actual)}</strong></td>
          <td className="num">{km(c.hoy)}</td>
          <td className="num">{km(c.semana)}</td>
          <td className="num">{km(c.treinta)}</td>
          <td className="num">{km(c.mes)}</td>
          <td className="num">{c.dias_activos ? km(Math.round(c.treinta / c.dias_activos)) : '—'}</td>
        </tr>)}
      </Table> : <Empty>No hay camiones registrados.</Empty>}
      {truck && <div className="quote-group">
        <h3>Detalle diario de {truck} <span className="history-count">últimos 30 días</span></h3>
        {daily.diario.some(d => d.patente === truck) ? <Table label={`Kilómetros diarios de ${truck}`} headings={['Fecha', 'Km del día', 'Rutas']}>
          {daily.diario.filter(d => d.patente === truck).reverse().map(d => <tr key={d.fecha}><td>{d.fecha.split('-').reverse().join('-')}</td><td className="num">{km(d.km)}</td><td className="num">{d.rutas}</td></tr>)}
        </Table> : <Empty>Sin rutas registradas en TTS para {truck} en los últimos 30 días.</Empty>}
      </div>}
    </Section>
    <Section id="km" title={only === 'vencida' ? 'Mantenciones vencidas' : only === 'pronto' ? 'Mantenciones que se acercan' : 'Mantenciones por camión'} action={only && <Button variant="secondary" onClick={() => setOnly('')}>Ver todas</Button>}>
      <p className="section-description">Al llegar al 90 % del plan (por ejemplo, 9.000 de 10.000 km) los supervisores reciben un aviso de que se acerca la revisión, y otro cuando se cumple. Al aprobar la tarea, el plan vuelve a contar desde ese kilometraje.</p>
      {rows.length ? <Table label="Mantenciones por kilometraje" headings={['Camión', 'Plan', 'Km actual', 'Próxima', 'Faltan', 'Acciones']}>
        {rows.filter(r => !only || r.state === only).map(r => <tr key={`${r.patente}-${r.id_plan}`}>
          <td><strong>{r.patente}</strong>{r.prioridad === 'alta' && <small className="overdue">Prioridad alta</small>}<small className="detail-meta">{r.km_actualizado_at ? `Actualizado ${dateTime(r.km_actualizado_at)}` : 'Sin lectura'}</small></td>
          <td>{r.plan.nombre}<small className="detail-meta">cada {km(r.plan.cada_km)}</small></td>
          <td className="num">{km(r.km_actual)}</td>
          <td className="num">{r.next == null ? '—' : km(r.next)}</td>
          <td className="num"><span className={`km-state km-${r.state}`}>{r.left == null ? 'Sin dato' : r.left <= 0 ? `Vencida ${km(-r.left)}` : r.state === 'pronto' ? `Se acerca · faltan ${km(r.left)}` : km(r.left)}</span></td>
          <td><div className="actions">
            {manages && (r.tarea_abierta ? <Button variant="secondary" onClick={() => onOpenTask?.(r.tarea_abierta)}>Ver tarea #{r.tarea_abierta}</Button> : <Button variant={r.state === 'vencida' ? 'primary' : 'soft'} onClick={() => onCreateTask({ tipo_tarea: r.plan.nombre, patente_camion: r.patente, tipo_mantencion: 'preventiva', prioridad: r.state === 'vencida' ? 'alta' : 'media', kilometraje: r.km_actual ?? '', descripcion: r.plan.descripcion || '', repuestos: r.plan.repuestos.map(p => ({ ...p, estado: 'pendiente' })), id_plan: r.id_plan, mecanicos: [] })}>Crear tarea</Button>)}
            {manages && <Button variant="secondary" onClick={() => { const value = window.prompt(`Kilometraje de la última «${r.plan.nombre}» en ${r.patente}:`, r.km_ultimo ?? r.km_actual ?? ''); if (value) act(() => request('put', `/api/camion-planes/${encodeURIComponent(r.patente)}/${r.id_plan}`, { km_ultimo: value }), r => r.mensaje) }}>Última hecha</Button>}
            {manages && <Button variant="secondary" onClick={() => { const value = window.prompt(`Kilometraje actual de ${r.patente}:`, r.km_actual ?? ''); if (value) act(() => request('put', `/api/camiones/km/${encodeURIComponent(r.patente)}`, { km_actual: value }), r => r.mensaje) }}>Km actual</Button>}
          </div></td>
        </tr>)}
      </Table> : <Empty>{data.planes.length ? 'No hay camiones registrados.' : 'Crea un plan (por ejemplo, cambio de aceite cada 10.000 km) para empezar.'}</Empty>}
    </Section>
    <Section id="planes" title="Planes de mantención" action={manages && <Button onClick={() => setEditor({ nombre: '', cada_km: '', descripcion: '', repuestos: [] })}>+ Nuevo plan</Button>}>
      {editor && <form className="editor" onSubmit={savePlan}>
        <h3>{editor.id ? 'Editar plan' : 'Nuevo plan'}</h3>
        <div className="form-grid">
          <Field label="Nombre" value={editor.nombre} maxLength={100} placeholder="Ej.: Cambio de aceite y filtros" onChange={e => setEditor({ ...editor, nombre: e.target.value })} required />
          <Field label="Cada cuántos km" type="number" min="100" step="1" inputMode="numeric" value={editor.cada_km} onChange={e => setEditor({ ...editor, cada_km: e.target.value })} required />
        </div>
        <Field label="Qué incluye (se copia a la tarea)" as="textarea" rows={3} value={editor.descripcion || ''} onChange={e => setEditor({ ...editor, descripcion: e.target.value })} />
        <fieldset className="part-picker"><legend>Repuestos que usa</legend>
          {editor.repuestos.length > 0 && <ul className="part-list">{editor.repuestos.map((p, i) => <li key={i}><span><strong>{partName(p.id_repuesto)}</strong> × {qty(p.cantidad)}</span><Button variant="icon" aria-label="Quitar" onClick={() => setEditor({ ...editor, repuestos: editor.repuestos.filter((_, j) => j !== i) })}>×</Button></li>)}</ul>}
          <div className="part-add">
            <Field label="Repuesto" as="select" value={part.id_repuesto} onChange={e => setPart({ ...part, id_repuesto: e.target.value })}><option value="">Elegir…</option>{parts.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Field>
            <Field label="Cantidad" type="number" min="0.01" step="0.01" value={part.cantidad} onChange={e => setPart({ ...part, cantidad: e.target.value })} />
            <Button variant="soft" disabled={!part.id_repuesto} onClick={() => { setEditor({ ...editor, repuestos: [...editor.repuestos, { id_repuesto: Number(part.id_repuesto), cantidad: Number(part.cantidad) }] }); setPart({ id_repuesto: '', cantidad: '1' }) }}>Agregar</Button>
          </div>
        </fieldset>
        <div className="actions"><Button type="submit">Guardar plan</Button><Button variant="secondary" onClick={() => setEditor(null)}>Cancelar</Button></div>
      </form>}
      {data.planes.length ? <ul className="quote-list">{data.planes.map(p => <li key={p.id} className="quote-card">
        <div className="quote-head"><strong>{p.nombre}</strong><span>cada {km(p.cada_km)}</span></div>
        {p.descripcion && <p className="detail-meta">{p.descripcion}</p>}
        {p.repuestos.length > 0 && <p className="detail-meta">Repuestos: {p.repuestos.map(r => `${partName(r.id_repuesto)} × ${qty(r.cantidad)}`).join(', ')}</p>}
        {manages && <div className="actions"><Button variant="secondary" onClick={() => setEditor({ ...p })}>Editar</Button><Button variant="danger" onClick={() => window.confirm(`¿Eliminar el plan «${p.nombre}»?`) && act(() => request('delete', `/api/planes/${p.id}`), r => r.mensaje)}>Eliminar</Button></div>}
      </li>)}</ul> : <Empty>Sin planes todavía.</Empty>}
    </Section>
  </>
}
