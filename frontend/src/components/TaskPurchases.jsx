import { useState } from 'react'
import { request, serverUrl, withWhatsapp } from '../api'
import { money, dateTime, qty, partStates, quoteStates, stageOf, withUnit } from '../format'
import { Button, CaptureButton, Empty, Field, MediaGrid } from './UI'
import { useDraft } from '../draft'

export function WhatsappLink({ url, onDone }) {
  if (!url) return null
  return <div className="notice notice-success whatsapp-next" role="status">
    <span>Guardado. Ahora avisa al jefe por WhatsApp:</span>
    <a className="button button-primary" href={url} target="_blank" rel="noreferrer" onClick={onDone}>Abrir WhatsApp</a>
  </div>
}

// El supervisor compró: comprobante y foto de lo comprado (opcionales) y aviso al jefe por WhatsApp.
export function PurchaseForm({ quote, hint, onAction, setWaLink, onDone }) {
  const [purchase, setPurchase] = useState({})
  const buy = async () => {
    const body = new FormData()
    if (purchase.comprobante) body.append('comprobante', purchase.comprobante)
    if (purchase.producto) body.append('producto', purchase.producto)
    if (await withWhatsapp(onAction, () => request('post', `/api/cotizaciones/${quote.id}/recibir`, body, { timeout: 120000 }), r => r.mensaje, setWaLink)) { setPurchase({}); await onDone() }
  }
  const pick = (kind, label, accept, capture) => <CaptureButton accept={accept} capture={capture} onFiles={([f]) => f && setPurchase(p => ({ ...p, [kind]: f }))}>{label}</CaptureButton>
  return <div className="purchase-form">
    <h4>Registrar la compra</h4>
    <p className="detail-meta">{hint}</p>
    <div className="capture-row">
      {pick('comprobante', 'Foto del comprobante', 'image/*', 'environment')}
      {pick('comprobante', 'Comprobante en PDF o archivo', 'image/*,application/pdf')}
      {pick('producto', 'Foto de lo comprado', 'image/*', 'environment')}
    </div>
    {(purchase.comprobante || purchase.producto) && <ul className="file-chips">
      {purchase.comprobante && <li>Comprobante: {purchase.comprobante.name}<button type="button" aria-label="Quitar comprobante" onClick={() => setPurchase(p => ({ ...p, comprobante: null }))}>×</button></li>}
      {purchase.producto && <li>Lo comprado: {purchase.producto.name}<button type="button" aria-label="Quitar foto de lo comprado" onClick={() => setPurchase(p => ({ ...p, producto: null }))}>×</button></li>}
    </ul>}
    <Button onClick={buy}>Registrar compra</Button>
  </div>
}

// Por qué se necesita el repuesto, con la evidencia del mecánico: lo ven supervisor y jefe antes de comprar.
export function FaultEvidence({ line, evidence }) {
  const items = evidence.filter(e => e.tipo === 'falla' && e.id_tarea_repuesto === line.id)
  if (!line.motivo && !items.length) return null
  return <div className="fault-evidence">
    {line.motivo && <p><strong>Por qué se necesita:</strong> {line.motivo}</p>}
    {items.length > 0 && <MediaGrid small items={items} label={`Evidencia: ${line.nombre || line.descripcion}`} />}
  </div>
}

// «No hay repuesto»: motivo y al menos una foto o video del repuesto malo. Sin evidencia no se pide la compra.
function FaultForm({ title, withPart, onSend, onCancel, draftKey }) {
  const [form, setForm, clearForm] = useDraft(draftKey, { descripcion: '', cantidad: '1', motivo: '' })
  const [files, setFiles] = useState([])
  const add = list => setFiles(current => [...current, ...list].slice(0, 3))
  const ready = form.motivo.trim() && files.length && (!withPart || form.descripcion.trim())
  return <form className="fault-form" onSubmit={async event => {
    event.preventDefault()
    const body = new FormData()
    for (const [key, value] of Object.entries(withPart ? form : { motivo: form.motivo })) body.append(key, value)
    for (const file of files) body.append('evidencia', file)
    if (await onSend(body)) { clearForm(); setFiles([]) }
  }}>
    <h4>{title}</h4>
    {withPart && <div className="form-grid">
      <Field label="Repuesto que falta" value={form.descripcion} maxLength={200} placeholder="Ej.: Culata" onChange={e => setForm({ ...form, descripcion: e.target.value })} required />
      <Field label="Cantidad" type="number" min="0.01" step="0.01" inputMode="decimal" value={form.cantidad} onChange={e => setForm({ ...form, cantidad: e.target.value })} required />
    </div>}
    <Field label="¿Por qué hay que comprarlo?" as="textarea" rows={3} maxLength={1000} value={form.motivo} placeholder="Ej.: La culata está trizada, pierde agua. No puedo seguir sin cambiarla." onChange={e => setForm({ ...form, motivo: e.target.value })} required />
    <p className="detail-meta">Muestra con foto o video que está malo (obligatorio, hasta 3). Así se compra solo lo necesario.</p>
    <div className="capture-row">
      <CaptureButton accept="image/*" capture="environment" onFiles={add}>Tomar foto</CaptureButton>
      <CaptureButton accept="video/*" capture="environment" onFiles={add}>Grabar video</CaptureButton>
      <CaptureButton accept="image/*,video/*" multiple onFiles={add}>Elegir archivos</CaptureButton>
    </div>
    {files.length > 0 && <ul className="file-chips">{files.map((f, i) => <li key={i}>{f.name}<button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></li>)}</ul>}
    <div className="actions">
      <Button type="submit" variant="danger" disabled={!ready}>Avisar al supervisor</Button>
      {onCancel && <Button variant="secondary" onClick={onCancel}>Cancelar</Button>}
    </div>
  </form>
}

// Repuestos de la tarea: el mecánico retira o avisa que no hay (con evidencia); el supervisor cotiza lo que falta.
export function TaskParts({ task, role, lines, evidence, onAction, refresh, onQuote }) {
  const [reporting, setReporting] = useState(null)
  const mechanic = role === 'mecanico'
  const working = task.estado === 'En_Trabajo'
  const canReport = ['mecanico', 'encargado', 'admin'].includes(role) && ['Pendiente', 'En_Trabajo'].includes(task.estado)
  const send = (url, body) => onAction(() => request('post', url, body, { timeout: 600000 }), r => r.mensaje).then(async ok => { if (ok) { setReporting(null); await refresh() } return ok })
  return <section className="detail-section">
    <h3>Repuestos necesarios</h3>
    {mechanic && task.estado === 'Pendiente' && lines.length > 0 && <p className="detail-meta">Al iniciar la tarea se descuentan del inventario los repuestos que tengan stock.</p>}
    {lines.length ? <ul className="part-list part-status-list">{lines.map(line => <li key={line.id} className={`part-${line.estado}`}>
      <div>
        <strong>{line.nombre || line.descripcion}</strong> × {line.unidad ? withUnit(line.cantidad, line.unidad) : qty(line.cantidad)}
        <small className={`part-state part-state-${line.estado}`}>{partStates[line.estado]}{line.estado === 'pendiente' && line.id_repuesto ? ` · stock ${qty(line.stock)}` : ''}{!line.id_repuesto ? ' · fuera del inventario' : ''}</small>
        {stageOf(line) && <small className={`purchase-stage stage-${line.estado_compra || 'cotizar'}`}>{stageOf(line)}</small>}
      </div>
      <div className="actions">
        {working && line.estado !== 'retirado' && line.id_repuesto && Number(line.stock) >= Number(line.cantidad) && ['mecanico', 'admin', 'encargado'].includes(role) && <Button variant="soft" onClick={async () => { if (await onAction(() => request('post', `/api/tarea-repuestos/${line.id}/retirar`), 'Repuesto retirado del inventario.')) await refresh() }}>Retirar</Button>}
        {canReport && line.estado !== 'faltante' && (mechanic || role === 'admin') && reporting !== line.id && <Button variant="danger" onClick={() => setReporting(line.id)}>No hay repuesto</Button>}
        {line.estado === 'faltante' && onQuote && line.estado_compra !== 'aprobada' && <Button onClick={() => onQuote(line)}>Cotizar</Button>}
        {line.estado === 'faltante' && onQuote && line.estado_compra !== 'aprobada' && <Button variant="secondary" onClick={async () => {
          const nota = window.prompt(`¿Por qué ya no hace falta comprar «${line.nombre || line.descripcion}»? (por ejemplo: se usó uno del taller)`)
          if (nota?.trim() && await onAction(() => request('post', `/api/tarea-repuestos/${line.id}/resolver`, { nota: nota.trim() }), r => r.mensaje)) await refresh()
        }}>Ya no hace falta</Button>}
      </div>
      <FaultEvidence line={line} evidence={evidence} />
      {reporting === line.id && <FaultForm draftKey={`falla-${task.id}-${line.id}`} title={`Falta: ${line.nombre || line.descripcion}`} onCancel={() => setReporting(null)} onSend={body => send(`/api/tarea-repuestos/${line.id}/faltante`, body)} />}
    </li>)}</ul> : <Empty>Esta tarea no tiene repuestos asignados.</Empty>}
    {canReport && mechanic && (reporting === 'otro'
      ? <FaultForm withPart draftKey={`falla-${task.id}-otro`} title="Falta otro repuesto" onCancel={() => setReporting(null)} onSend={body => send(`/api/tareas/${task.id}/faltante`, body)} />
      : <Button variant="secondary" onClick={() => setReporting('otro')}>Falta otro repuesto</Button>)}
  </section>
}

// Cotizaciones: el supervisor la sube a la OT para que quede registrada (no se envía a nadie); el jefe puede aprobarla en Compras;
// el supervisor compra y registra comprobante y foto de lo comprado.
export function TaskQuotes({ task, role, quotes, lines, evidence, draft, setDraft, clearDraft, onAction, refresh }) {
  const [waLink, setWaLink] = useState('')
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0)
  const [rejecting, setRejecting] = useState(null)
  const manages = ['encargado', 'admin'].includes(role)
  const decides = ['jefe', 'admin'].includes(role)
  const missingLines = lines.filter(line => line.estado === 'faltante')
  const lineOf = q => lines.find(l => l.id === q.id_tarea_repuesto)
  const selected = lines.find(l => l.id === Number(draft.id_tarea_repuesto))
  const send = async event => {
    event.preventDefault()
    const body = new FormData()
    for (const [key, value] of Object.entries({ ...draft, id_tarea: task.id })) if (value) body.append(key, value)
    if (file) body.append('archivo', file)
    if (!await withWhatsapp(onAction, () => request('post', '/api/cotizaciones/enviar', body, { timeout: 120000 }), r => r.mensaje, setWaLink)) return
    clearDraft(); setFile(null); setFileKey(k => k + 1)
    await refresh()
  }
  const decide = async (quote, decision, nota) => {
    if (decision === 'aprobar' && quote.excede && !window.confirm(`Esta compra excede el presupuesto del mes en ${money(quote.excede)}. Si la apruebas, ese monto se suma al límite del mes. ¿Aprobar?`)) return
    if (await onAction(() => request('post', `/api/cotizaciones/${quote.id}/decidir`, { decision, nota }), r => r.mensaje)) { setRejecting(null); await refresh() }
  }
  return <section className="detail-section" id={`cotizaciones-${task.id}`}>
    <h3>Cotizaciones</h3>
    <WhatsappLink url={waLink} onDone={() => setWaLink('')} />
    {quotes.length ? <ul className="quote-list">{quotes.map(q => <li key={q.id} className="quote-card">
      <div className="quote-head"><strong>{q.detalle}</strong><span className={`status quote-${q.estado}`}>{quoteStates[q.estado]}</span></div>
      <p className="quote-amount">{money(q.monto)}</p>
      <p className="detail-meta">{q.proveedor}{q.cantidad ? ` · × ${qty(q.cantidad)}` : ''} · subida por {q.creador} · {dateTime(q.created_at)}</p>
      {lineOf(q) && <FaultEvidence line={lineOf(q)} evidence={evidence} />}
      {Number(q.excedente) > 0 && <p className="field-hint warning">Aprobada fuera de presupuesto: se sumaron {money(q.excedente)} al límite del mes.</p>}
      {q.nota_decision && <p className="detail-meta">{q.estado === 'rechazada' ? 'Motivo' : 'Nota'}: {q.nota_decision}</p>}
      {q.ruta_archivo && <a className="text-link" href={serverUrl + q.ruta_archivo} target="_blank" rel="noreferrer">Ver documento de la cotización ›</a>}
      {q.ruta_comprobante && <a className="text-link" href={serverUrl + q.ruta_comprobante} target="_blank" rel="noreferrer">Ver comprobante de compra ›</a>}
      {evidence.some(e => e.tipo === 'compra' && e.id_cotizacion === q.id) && <><p className="detail-meta">Lo que se compró:</p><MediaGrid small items={evidence.filter(e => e.tipo === 'compra' && e.id_cotizacion === q.id)} label={`Compra: ${q.detalle}`} /></>}
      {q.estado === 'recibida' && !q.ruta_comprobante && <p className="detail-meta">Compra registrada sin comprobante.</p>}
      <div className="actions">
        {decides && q.estado === 'pendiente' && <><Button onClick={() => decide(q, 'aprobar')}>Aprobar compra</Button><Button variant="danger" onClick={() => setRejecting(rejecting === q.id ? null : q.id)}>Rechazar</Button></>}
      </div>
      {manages && q.estado === 'aprobada' && <PurchaseForm quote={q} onAction={onAction} setWaLink={setWaLink} onDone={refresh}
        hint="Cuando compres, sube la foto de la boleta o factura y la de lo que compraste (opcionales). El repuesto se entrega a la tarea." />}
      {rejecting === q.id && <form className="rejection-form" onSubmit={e => { e.preventDefault(); decide(q, 'rechazar', new FormData(e.currentTarget).get('nota')) }}>
        <Field label="Motivo del rechazo" as="textarea" name="nota" rows={2} maxLength={1000} required />
        <Button type="submit" variant="danger">Confirmar rechazo</Button>
      </form>}
    </li>)}</ul> : <Empty>{manages ? 'Sin cotizaciones. Si cotizas algo para esta tarea, súbelo aquí para que quede registrado.' : 'Esta tarea no tiene cotizaciones.'}</Empty>}
    {manages && task.estado !== 'Aprobada' && <form className="quote-form" onSubmit={send}>
      <h4>Subir cotización</h4>
      {missingLines.length > 0 && <Field label="Repuesto que falta" as="select" value={draft.id_tarea_repuesto} onChange={e => {
        const line = lines.find(l => l.id === Number(e.target.value))
        setDraft({ ...draft, id_tarea_repuesto: e.target.value, detalle: line ? `${line.nombre || line.descripcion}` : draft.detalle, cantidad: line ? String(Number(line.cantidad)) : draft.cantidad })
      }}><option value="">Otro (no está en la lista)</option>{missingLines.map(l => <option key={l.id} value={l.id}>{l.nombre || l.descripcion} × {qty(l.cantidad)}</option>)}</Field>}
      {selected && <FaultEvidence line={selected} evidence={evidence} />}
      <div className="form-grid">
        <Field label="Qué se compra" value={draft.detalle} maxLength={2000} onChange={e => setDraft({ ...draft, detalle: e.target.value })} required />
        <Field label="Proveedor" value={draft.proveedor} maxLength={120} onChange={e => setDraft({ ...draft, proveedor: e.target.value })} required />
        <Field label="Cantidad" type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.cantidad} onChange={e => setDraft({ ...draft, cantidad: e.target.value })} />
        <Field label="Monto total (CLP)" type="number" min="1" step="1" inputMode="numeric" value={draft.monto} onChange={e => setDraft({ ...draft, monto: e.target.value })} required />
      </div>
      <Field key={fileKey} label="Foto o PDF de la cotización (opcional)" type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files[0] || null)} />
      <p className="detail-meta">Queda guardada en la OT y en Compras. No se envía a nadie: la compra se coordina en el grupo.</p>
      <Button type="submit">Guardar cotización</Button>
    </form>}
  </section>
}
