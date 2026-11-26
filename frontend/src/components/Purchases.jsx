import { useCallback, useEffect, useState } from 'react'
import { request, serverUrl, withWhatsapp } from '../api'
import { money, dateTime, qty, quoteStates, priorities, thisMonth, withUnit } from '../format'
import { Button, Empty, Field, Section } from './UI'
import { PurchaseForm, WhatsappLink } from './TaskPurchases'
import { useDraft } from '../draft'

const CATEGORIES = { herramienta: 'Herramienta', insumo: 'Insumo', repuesto: 'Repuesto para bodega' }
const EMPTY = { categoria: 'herramienta', detalle: '', cantidad: '', proveedor: '', monto: '', motivo: '', id_repuesto: '' }

// Compra que no viene de una OT: falta una herramienta, un insumo o stock de bodega. Mismo flujo: el jefe aprueba y el supervisor compra.
function NewRequest({ onAction, onSent, setWaLink }) {
  const [draft, setDraft, clearDraft] = useDraft('solicitud-compra', EMPTY)
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0)
  const [parts, setParts] = useState([])
  useEffect(() => { if (draft.categoria === 'repuesto' && !parts.length) request('get', '/api/repuestos').then(r => setParts(r.repuestos)).catch(() => {}) }, [draft.categoria, parts.length])
  const set = key => e => setDraft({ ...draft, [key]: e.target.value })
  const send = async e => {
    e.preventDefault()
    const body = new FormData()
    for (const [k, value] of Object.entries(draft)) if (value && !(k === 'id_repuesto' && draft.categoria !== 'repuesto')) body.append(k, value)
    if (file) body.append('archivo', file)
    if (!await withWhatsapp(onAction, () => request('post', '/api/cotizaciones/compra', body, { timeout: 120000 }), r => r.mensaje, setWaLink)) return
    clearDraft(); setFile(null); setFileKey(k => k + 1); await onSent()
  }
  return <form className="quote-form" onSubmit={send}>
    <p className="detail-meta">Para lo que no viene de una OT: herramientas, insumos o repuestos para tener en bodega. El jefe la aprueba en la app y cuenta en el presupuesto del mes.</p>
    <Field label="Tipo de compra" as="select" value={draft.categoria} onChange={set('categoria')}>{Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Field>
    {draft.categoria === 'repuesto' && <Field label="Repuesto del inventario (opcional: al comprarlo se suma al stock)" as="select" value={draft.id_repuesto} onChange={e => {
      const part = parts.find(p => p.id === Number(e.target.value))
      setDraft({ ...draft, id_repuesto: e.target.value, detalle: part ? part.nombre : draft.detalle })
    }}><option value="">Ninguno</option>{parts.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.codigo ? ` (${p.codigo})` : ''} · stock {withUnit(p.stock, p.unidad)}</option>)}</Field>}
    <Field label="Qué se compra" as="textarea" rows={2} maxLength={2000} value={draft.detalle} onChange={set('detalle')} required />
    <Field label="Por qué hace falta" as="textarea" rows={2} maxLength={1000} value={draft.motivo} onChange={set('motivo')} placeholder="Ej.: se quebró la llave de impacto del taller" required />
    <div className="form-grid">
      <Field label="Cantidad (opcional)" type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.cantidad} onChange={set('cantidad')} />
      <Field label="Proveedor" maxLength={120} value={draft.proveedor} onChange={set('proveedor')} required />
      <Field label="Monto total (CLP)" type="number" min="1" step="1" inputMode="numeric" value={draft.monto} onChange={set('monto')} required />
    </div>
    <Field key={fileKey} label="Cotización del proveedor (opcional: foto o PDF)" type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files[0] || null)} />
    <Button type="submit">Guardar solicitud</Button>
  </form>
}

// Compras del mes contra el presupuesto: el jefe define el monto y aprueba; el supervisor marca lo recibido.
export default function Purchases({ role, onAction, onOpenTask, live = 0 }) {
  const [mes, setMes] = useState(thisMonth())
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState('')
  const [rejecting, setRejecting] = useState(null)
  const [waLink, setWaLink] = useState('')
  const [asking, setAsking] = useState(false)
  const decides = ['jefe', 'admin'].includes(role)
  const manages = ['encargado', 'admin'].includes(role)
  // Al recargar en vivo no se pisa el monto que el jefe esté escribiendo; al cambiar de mes sí se reinicia.
  const load = useCallback(() => request('get', `/api/cotizaciones?mes=${mes}`).then(result => { setData(result); setError(''); setAmount(a => a === '' ? (result.presupuesto.monto ?? '') : a) }).catch(() => setError('No pudimos cargar las compras del mes.')), [mes])
  useEffect(() => { load() }, [load, live])
  const act = async (operation, message) => { const ok = await onAction(operation, message); if (ok) await load(); return ok }
  const decide = (q, decision, nota) => {
    if (decision === 'aprobar' && q.excede && !window.confirm(`Excede el presupuesto del mes en ${money(q.excede)}. Si la apruebas, ese monto se suma al límite del mes. ¿Aprobar?`)) return
    act(() => request('post', `/api/cotizaciones/${q.id}/decidir`, { decision, nota }), r => r.mensaje).then(ok => ok && setRejecting(null))
  }
  if (error) return <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={load}>Reintentar</Button></div>
  if (!data) return <div className="loading-state" role="status"><span className="spinner" />Cargando compras…</div>
  const b = data.presupuesto
  const used = b.monto ? Math.min(100, Math.round(b.comprometido / b.monto * 100)) : 0
  // Las cifras del presupuesto llevan a su grupo de compras (o a la lista, si el grupo está vacío).
  const jump = (...ids) => (ids.map(id => document.getElementById(id)).find(Boolean) || document.getElementById('compras-mes'))?.scrollIntoView({ block: 'start' })
  const groups = ['pendiente', 'aprobada', 'recibida', 'rechazada'].map(state => [state, data.cotizaciones.filter(q => q.estado === state)]).filter(([, list]) => list.length)
  return <>
    <section id="compras" className="section report-section" aria-labelledby="budget-title">
      <div className="section-heading"><h2 id="budget-title">Presupuesto mensual</h2><Field label="Mes" type="month" value={mes} onChange={e => { if (e.target.value) { setAmount(''); setMes(e.target.value) } }} /></div>
      <div className="budget-grid">
        {decides ? <button type="button" className="budget-figure" onClick={() => document.getElementById('budget-amount')?.focus()}><span>Presupuesto ›</span><strong>{b.definido ? money(b.monto) : 'Sin definir'}</strong></button>
          : <div className="budget-figure"><span>Presupuesto</span><strong>{b.definido ? money(b.monto) : 'Sin definir'}</strong></div>}
        <button type="button" className="budget-figure" onClick={() => jump('compras-aprobada', 'compras-recibida')}><span>Comprometido ›</span><strong>{money(b.comprometido)}</strong></button>
        <button type="button" className="budget-figure" onClick={() => jump('compras-pendiente')}><span>Por aprobar ›</span><strong>{money(b.pendiente)}</strong></button>
        <div className="budget-figure"><span>Disponible</span><strong className={b.disponible < 0 ? 'negative' : ''}>{money(b.disponible)}</strong></div>
      </div>
      {b.definido && <div className="budget-bar" role="img" aria-label={`Usado ${used}% del presupuesto`}><span style={{ width: `${used}%` }} /></div>}
      {decides && <form className="report-card budget-form" onSubmit={e => { e.preventDefault(); act(() => request('put', `/api/presupuesto/${mes}`, { monto: amount }), r => r.mensaje) }}>
        <Field id="budget-amount" label={`Presupuesto de ${mes} (CLP)`} type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} required />
        <Button type="submit">{b.definido ? 'Actualizar presupuesto' : 'Definir presupuesto'}</Button>
      </form>}
    </section>
    {manages && <Section title="Solicitud de compra sin OT" action={!asking && <Button variant="secondary" onClick={() => setAsking(true)}>Nueva solicitud</Button>}>
      <WhatsappLink url={waLink} onDone={() => setWaLink('')} />
      {asking ? <NewRequest onAction={onAction} setWaLink={setWaLink} onSent={async () => { setAsking(false); await load() }} />
        : <p className="detail-meta">¿Falta una herramienta o un insumo que no es de una OT? Pídelo aquí: sigue el mismo camino que una cotización.</p>}
    </Section>}
    <Section id="compras-mes" title="Compras del mes">
      {groups.length ? groups.map(([state, list]) => <div key={state} id={`compras-${state}`} className="quote-group">
        <h3>{quoteStates[state]} <span className="history-count">{list.length} · {money(list.reduce((sum, q) => sum + Number(q.monto), 0))}</span></h3>
        <ul className="quote-list">{list.map(q => <li key={q.id} className="quote-card">
          <div className="quote-head"><strong>{q.detalle}</strong><span className="quote-amount">{money(q.monto)}</span></div>
          {q.id_tarea ? <p className="detail-meta"><button type="button" className="text-link" onClick={() => onOpenTask(q.id_tarea)}>{q.patente_camion} · {q.tipo_tarea}</button> · prioridad {(priorities[q.prioridad] || 'media').toLowerCase()}</p>
            : <p className="detail-meta"><strong>Sin OT · {CATEGORIES[q.categoria] || 'Compra'}</strong>{q.repuesto_nombre ? ` · se suma al inventario: ${q.repuesto_nombre}` : ''}</p>}
          {q.motivo && <p className="detail-meta">Por qué: {q.motivo}</p>}
          <p className="detail-meta">{q.proveedor}{q.cantidad ? ` · × ${qty(q.cantidad)}` : ''} · {q.creador} · {dateTime(q.created_at)}{q.decisor ? ` · revisó ${q.decisor}` : ''}</p>
          {q.excede > 0 && <p className="field-hint warning">Fuera del presupuesto por {money(q.excede)}: si la apruebas, se suma al límite del mes.</p>}
          {Number(q.excedente) > 0 && <p className="field-hint warning">Se sumaron {money(q.excedente)} al presupuesto al aprobarla.</p>}
          {q.nota_decision && <p className="detail-meta">{state === 'rechazada' ? 'Motivo' : 'Nota'}: {q.nota_decision}</p>}
          {!q.id_tarea && q.ruta_archivo && <a className="text-link" href={serverUrl + q.ruta_archivo} target="_blank" rel="noreferrer">Ver cotización del proveedor ›</a>}
          {q.ruta_comprobante && <a className="text-link" href={serverUrl + q.ruta_comprobante} target="_blank" rel="noreferrer">Ver comprobante de compra ›</a>}
          {q.ruta_foto_compra && <a className="text-link" href={serverUrl + q.ruta_foto_compra} target="_blank" rel="noreferrer">Ver foto de lo comprado ›</a>}
          <div className="actions">
            {decides && state === 'pendiente' && <><Button onClick={() => decide(q, 'aprobar')}>Aprobar compra</Button><Button variant="danger" onClick={() => setRejecting(rejecting === q.id ? null : q.id)}>Rechazar</Button></>}
            {q.id_tarea && (manages && state === 'aprobada' ? <Button onClick={() => onOpenTask(q.id_tarea)}>Registrar compra</Button> : <Button variant="secondary" onClick={() => onOpenTask(q.id_tarea)}>Ver tarea</Button>)}
          </div>
          {!q.id_tarea && manages && state === 'aprobada' && <PurchaseForm quote={q} onAction={onAction} setWaLink={setWaLink} onDone={load}
            hint={`Cuando compres, sube la foto de la boleta o factura y la de lo que compraste (opcionales).${q.id_repuesto ? ' La cantidad se suma al stock del inventario.' : ''}`} />}
          {rejecting === q.id && <form className="rejection-form" onSubmit={e => { e.preventDefault(); decide(q, 'rechazar', new FormData(e.currentTarget).get('nota')) }}>
            <Field label="Motivo del rechazo" as="textarea" name="nota" rows={2} maxLength={1000} required />
            <Button type="submit" variant="danger">Confirmar rechazo</Button>
          </form>}
        </li>)}</ul>
      </div>) : <Empty>No hay cotizaciones en {mes}. Aparecen aquí cuando un supervisor envía una desde una tarea o pide una compra sin OT.</Empty>}
    </Section>
  </>
}
