import { useState, useEffect, useCallback } from 'react'
import { request, uploadMedia } from '../api'
import { money, date, dateTime, today, kinds, priorities, km, stageOf } from '../format'
import Modal from './Modal'
import { Button, CaptureButton, Empty, Field, MediaGrid, Table } from './UI'
import { TaskParts, TaskQuotes } from './TaskPurchases'
import { useDraft } from '../draft'
import { TaskChecklist } from './Checklist'

const STEPS = [['Pendiente', 'Creada'], ['En_Trabajo', 'En trabajo'], ['Completada', 'Revisión'], ['Aprobada', 'Aprobada']]

// Qué pestañas ve cada rol, cuál necesita acción y cuál se abre primero: una sola sección a la vez.
function plan(task, role, detail) {
  const office = role !== 'mecanico'
  const manages = ['encargado', 'admin'].includes(role)
  const pending = {
    repuestos: role === 'mecanico' && task.estado === 'En_Trabajo' && detail.parts.some(l => l.estado === 'pendiente' && Number(l.stock) >= Number(l.cantidad)),
    compras: false, // las cotizaciones solo se registran: no piden acción a nadie
    despues: ['mecanico', 'admin'].includes(role) && task.estado === 'En_Trabajo' && !task.esperando_repuesto,
    revision: manages && task.estado === 'Completada',
  }
  const tabs = [
    ['repuestos', 'Repuestos'],
    ...(office ? [['compras', 'Compras']] : []),
    ['antes', 'Antes'],
    ['despues', 'Después'],
    ...(office ? [['checklist', 'Checklist']] : []),
    ...(office ? [['costos', 'Costos']] : []),
    ...(manages && task.estado === 'Completada' ? [['revision', 'Revisión']] : []),
    ['historial', 'Historial'],
  ].map(([id, label]) => ({ id, label, pending: !!pending[id] }))
  const first = ['revision', 'compras', 'despues', 'repuestos'].find(id => pending[id])
    || (role === 'mecanico' && task.estado === 'Pendiente' ? 'repuestos' : ['Completada', 'Aprobada'].includes(task.estado) ? 'despues' : 'repuestos')
  // Frase del siguiente paso para quien mira la tarea.
  const next = role === 'mecanico'
    ? task.estado === 'Pendiente' ? 'Revisa los repuestos y pulsa «Iniciar tarea» para empezar.'
      : task.estado === 'En_Trabajo' ? (task.esperando_repuesto ? 'Esperando el repuesto: te avisaremos cuando llegue.' : 'Cuando termines, sube el después y envía la tarea a revisión.')
        : task.estado === 'Completada' ? 'Enviada a revisión: el supervisor la está revisando.' : 'Tarea cerrada.'
    : manages
      ? pending.revision ? 'El mecánico terminó: revisa el trabajo y apruébalo o devuélvelo.'
        : task.cotizando ? 'En cotización: la tarea está en pausa. Usa «Retomar tarea» cuando llegue lo que falta.'
          : task.estado === 'Aprobada' ? 'Tarea cerrada.' : 'El mecánico está a cargo de la tarea.'
      : task.estado === 'Aprobada' ? 'Tarea cerrada.' : 'Sin acciones pendientes para ti.'
  return { tabs, first, next }
}

export default function TaskDetail({ task, role, initialTab = null, busy, notice, onClose, onAction, onReport, autoWhatsapp = false, live = 0 }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(initialTab)
  const [rejectionNote, setRejectionNote] = useState('')
  const [manual, setManual] = useState({ concepto: '', monto: '', fecha: today() })
  const [postponeReason, setPostponeReason] = useState(task.motivo_aplazamiento || '')
  const [progress, setProgress] = useState(null)
  // La cotización a medio escribir queda guardada en el teléfono hasta enviarla.
  const [draft, setDraft, clearDraft] = useDraft(`cotizacion-${task.id}`, { proveedor: '', detalle: '', cantidad: '', monto: '', id_tarea_repuesto: '' })
  // Observaciones del mecánico: quedan guardadas en el teléfono hasta marcar la tarea como realizada.
  const [obs, setObs, clearObs] = useDraft(`observaciones-${task.id}`, { texto: '' })
  const [checklist, setChecklist] = useState(null)
  const mechanic = role === 'mecanico'
  const office = !mechanic
  const manages = role === 'encargado' || role === 'admin'
  const afterEvidence = detail?.evidence.filter(item => item.tipo === 'foto') || []
  const beforeEvidence = detail?.evidence.filter(item => item.tipo === 'antes') || []
  const canAddBefore = manages ? task.estado !== 'Aprobada' : mechanic && ['Pendiente', 'En_Trabajo'].includes(task.estado)
  // Mientras falte un repuesto (aunque la compra ya esté aprobada) no se puede terminar: hay que esperar la compra.
  const waiting = !!task.esperando_repuesto
  const canAddAfter = ['admin', 'mecanico'].includes(role) && task.estado === 'En_Trabajo' && !waiting
  const fetchDetail = useCallback(async () => {
    const [evidence, purchases, expenses, history] = await Promise.all([
      request('get', `/api/evidencia/${task.id}`),
      request('get', `/api/tareas/${task.id}/compras`),
      // Los costos son de la oficina: el mecánico no los pide ni los ve.
      role === 'mecanico' ? Promise.resolve({ gastos: [] }) : request('get', `/api/gastos/${task.id}`),
      request('get', `/api/tareas/${task.id}/historial`),
    ])
    return { evidence: evidence.evidencias, expenses: expenses.gastos || [], parts: purchases.repuestos || [], quotes: purchases.cotizaciones || [], events: history.eventos || [] }
  }, [task.id, role])
  const refresh = async () => {
    setError('')
    try { setDetail(await fetchDetail()) } catch { setError('No pudimos cargar los detalles de esta tarea.') }
  }
  // También se recarga cuando otra persona guarda un cambio (`live`).
  useEffect(() => {
    let active = true
    fetchDetail().then(result => { if (active) setDetail(result) }).catch(() => { if (active) setError('No pudimos cargar los detalles de esta tarea.') })
    return () => { active = false }
  }, [fetchDetail, live])
  const upload = momento => async list => {
    for (const [index, item] of list.entries()) {
      const ok = await onAction(() => uploadMedia(task.id, item, momento, p => setProgress(p == null ? null : `${list.length > 1 ? `${index + 1}/${list.length} · ` : ''}${p}%`)), momento === 'antes' ? 'Archivo del antes guardado.' : 'Foto guardada.')
      if (!ok) break
    }
    setProgress(null)
    await refresh()
  }
  const remove = async (item, video) => {
    if (!window.confirm(`¿Borrar ${video ? 'este video' : 'esta foto'}? No se puede deshacer.`)) return
    if (await onAction(() => request('delete', `/api/evidencia/${item.id}`), 'Archivo borrado.')) await refresh()
  }
  const captures = momento => <div className="capture-row">
    <CaptureButton accept="image/*" capture="environment" onFiles={upload(momento)}>Tomar foto</CaptureButton>
    <CaptureButton accept="video/*" capture="environment" onFiles={upload(momento)}>Grabar video</CaptureButton>
    <CaptureButton accept="image/*,video/*" multiple onFiles={upload(momento)}>Elegir archivos</CaptureButton>
  </div>
  const view = detail ? plan(task, role, detail) : null
  // La pestaña inicial se elige una vez al abrir (la que necesita acción); después manda la persona.
  const current = view && (view.tabs.some(t => t.id === tab) ? tab : view.first)
  if (current && !tab) setTab(current)
  // En celular las pestañas se desplazan: la activa siempre queda a la vista.
  useEffect(() => { if (current) document.getElementById(`tab-${current}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [current])
  const stepIndex = STEPS.findIndex(([state]) => state === task.estado)
  const taskTotal = detail?.expenses.reduce((sum, item) => sum + (Number(item.monto) || 0), 0) || 0
  const observations = task.observaciones && <div className="rejection-notice observations" role="note"><strong>Observaciones del mecánico</strong><p>{task.observaciones}</p></div>

  // Mecánico: una sola pantalla. Ve qué hay que hacer, sube la foto de lo realizado, anota observaciones y marca «Realizado».
  if (mechanic) {
    const open = ['Pendiente', 'En_Trabajo'].includes(task.estado)
    const shots = momento => <div className="capture-row">
      <CaptureButton accept="image/*" capture="environment" onFiles={upload(momento)}>{momento === 'antes' ? 'Foto de antes' : 'Foto de lo realizado'}</CaptureButton>
      <CaptureButton accept="image/*,video/*" multiple onFiles={upload(momento)}>Elegir fotos o video</CaptureButton>
    </div>
    const working = task.estado === 'En_Trabajo' && !waiting && !task.cotizando
    return <Modal title={`Tarea: ${task.tipo_tarea}`} onClose={onClose}>
      <div className="modal-content simple-task">
        <div className="section-heading"><h2><span className="ot-number">OT #{task.id}</span>{task.tipo_tarea}</h2><Button variant="icon" onClick={onClose} aria-label="Cerrar">×</Button></div>
        <p className="simple-plate"><strong>{task.patente_camion}</strong> · {task.modelo}</p>
        <p className="detail-meta">Fecha límite: {date(task.fecha_limite)}{task.mecanicos_nombres ? ` · ${task.mecanicos_nombres}` : ''}</p>
        {task.nota_rechazo && open && <div className="rejection-notice" role="note"><strong>El encargado pidió corregir</strong><p>{task.nota_rechazo}</p></div>}
        {notice && <div role={notice.error ? 'alert' : 'status'} className={`notice notice-${notice.error ? 'error' : 'success'}`}>{notice.message}</div>}
        {busy && <p role="status" className="detail-meta">{progress ? `Subiendo… ${progress}` : 'Procesando…'}</p>}
        {task.estado === 'Pendiente' && !task.cotizando && <div className="review-actions">
          <Button onClick={() => onAction(() => request('put', `/api/tareas/estado/${task.id}`, { estado: 'En_Trabajo' }), 'Tarea iniciada. Saca la foto de antes.')}>Iniciar tarea</Button>
          <p className="detail-meta">Al iniciar se activan las fotos de antes y de lo realizado.</p>
        </div>}
        <section className="detail-section">
          <h3>Qué hay que hacer</h3>
          {task.descripcion ? <p className="detail-description">{task.descripcion}</p> : <p className="detail-meta">Sin descripción.</p>}
        </section>
        {error ? <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={refresh}>Reintentar</Button></div> : !detail ? <p role="status" className="loading-state">Cargando…</p> :
        <fieldset disabled={busy} className="detail-fields">
          <section className="detail-section">
            <h3>1. Foto de antes</h3>
            <p className="detail-meta">Cómo estaba el camión antes de empezar.</p>
            {beforeEvidence.length ? <MediaGrid items={beforeEvidence} label={`Antes: ${task.tipo_tarea}`} onDelete={working ? remove : undefined} /> : !working && <Empty>Sin fotos de antes.</Empty>}
            {working && shots('antes')}
          </section>
          <section className="detail-section">
            <h3>2. Lo que realizaste</h3>
            {afterEvidence.length ? <MediaGrid items={afterEvidence} label={`Realizado: ${task.tipo_tarea}`} onDelete={task.estado === 'En_Trabajo' ? remove : undefined} /> : !open && <Empty>Sin fotos.</Empty>}
            {open && !!task.cotizando && <div className="waiting-notice" role="note"><strong>En cotización</strong><p>El supervisor está cotizando lo que falta. Sigue con otra tarea; esta no se atrasa mientras tanto.</p></div>}
            {working && shots('despues')}
            {open && waiting && <div className="waiting-notice" role="note"><strong>Esperando repuesto</strong><p>El encargado avisará cuando llegue el repuesto para terminar.</p></div>}
          </section>
          {(working || !open) && <section className="detail-section">
            <h3>3. Checklist de salida</h3>
            <TaskChecklist task={task} editable={working} onAction={onAction} onChange={setChecklist} />
          </section>}
          <section className="detail-section">
            {working && <>
              <h3>4. Terminar</h3>
              <Field label="Observaciones (opcional)" as="textarea" rows={3} maxLength={2000} value={obs.texto} placeholder="Ej.: Se cambiaron las pastillas delanteras; el disco está bien." onChange={e => setObs({ texto: e.target.value })} />
              <Button disabled={!beforeEvidence.length || !afterEvidence.length || !checklist} onClick={async () => {
                if (await onAction(() => request('put', `/api/tareas/estado/${task.id}`, { estado: 'Completada', observaciones: obs.texto }), 'Tarea marcada como realizada. El encargado la revisará.')) { clearObs(); onClose() }
              }}>Realizado</Button>
              {(!beforeEvidence.length || !afterEvidence.length || !checklist) && <p className="detail-meta">Para marcarla realizada falta: {[!beforeEvidence.length && 'la foto de antes', !afterEvidence.length && 'la foto de lo realizado', !checklist && 'el checklist de salida'].filter(Boolean).join(', ')}.</p>}
            </>}
            {task.estado === 'Completada' && <><p className="next-step">Realizada: el encargado la está revisando.</p>{observations}</>}
            {task.estado === 'Aprobada' && <><p className="next-step">Aprobada por el encargado.</p>{observations}</>}
          </section>
        </fieldset>}
      </div>
    </Modal>
  }

  return <Modal title={`Detalle: ${task.tipo_tarea}`} onClose={onClose}>
    <div className="modal-content">
      <div className="section-heading"><h2><span className="ot-number">OT #{task.id}</span>{task.tipo_tarea}</h2><Button variant="icon" onClick={onClose} aria-label="Cerrar detalle">×</Button></div>
      <p className="detail-meta">{task.patente_camion} · {task.modelo} · Límite: {date(task.fecha_limite)} · {kinds[task.tipo_mantencion] || 'Correctiva'} · Prioridad {(priorities[task.prioridad] || 'Media').toLowerCase()}{task.kilometraje ? ` · ${km(task.kilometraje)}` : ''}{task.mecanicos_nombres ? ` · ${task.mecanicos_nombres}` : ''}</p>
      {office && onReport && <div className="report-button"><Button variant="secondary" onClick={() => onReport(task.id)}>Informe de la OT</Button></div>}
      <ol className="task-steps" aria-label="Avance de la tarea">{STEPS.map(([state, label], i) => <li key={state} className={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
        <span>{i < stepIndex ? '✓' : i + 1}</span>{label}{i === stepIndex && !!task.esperando_repuesto && <small> · esperando repuesto</small>}
      </li>)}</ol>
      {view && <p className="next-step"><strong>Siguiente paso:</strong> {view.next}</p>}
      {task.descripcion && <p className="detail-description">{task.descripcion}</p>}
      {observations}
      {task.nota_rechazo && task.estado !== 'Aprobada' && <div className="rejection-notice" role="note"><strong>Corrección solicitada por el supervisor</strong><p>{task.nota_rechazo}</p><small>{task.fecha_rechazo ? `${dateTime(task.fecha_rechazo)} · ` : ''}Rechazo n.º {task.veces_rechazada || 1}</small></div>}
      {!!task.vencida && !['Completada', 'Aprobada'].includes(task.estado) && role !== 'jefe' && <form className="rejection-notice rejection-form" onSubmit={event => {
        event.preventDefault()
        onAction(() => request('put', `/api/tareas/motivo-aplazamiento/${task.id}`, { motivo: postponeReason }), 'Motivo del aplazamiento guardado.')
      }}>
        <Field label={`Motivo del aplazamiento (aplazada ${task.veces_aplazada} ${Number(task.veces_aplazada) === 1 ? 'vez' : 'veces'})`} as="textarea" rows={2} maxLength={10000} value={postponeReason} placeholder="Ej.: Falta el repuesto, llega el jueves." onChange={event => setPostponeReason(event.target.value)} required />
        <Button type="submit" variant="secondary" disabled={!postponeReason.trim() || postponeReason === task.motivo_aplazamiento}>Guardar motivo</Button>
      </form>}
      {!!task.vencida && role === 'jefe' && task.motivo_aplazamiento && <div className="rejection-notice" role="note"><strong>Motivo del aplazamiento</strong><p>{task.motivo_aplazamiento}</p></div>}
      {notice && <div role={notice.error ? 'alert' : 'status'} className={`notice notice-${notice.error ? 'error' : 'success'}`}>{notice.message}</div>}
      {busy && <p role="status" className="detail-meta">{progress ? `Subiendo… ${progress}` : 'Procesando…'}</p>}
      {error ? <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={refresh}>Reintentar</Button></div> : !detail ? <p role="status" className="loading-state">Cargando detalle…</p> : <>
        <div className="detail-tabs" role="tablist" aria-label="Secciones de la tarea">{view.tabs.map(t => <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={current === t.id} aria-controls={`panel-${t.id}`} className={current === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
          {t.label}{t.pending && <span className="tab-dot" aria-label="(requiere acción)" />}
        </button>)}</div>
        <fieldset disabled={busy} className="detail-fields" role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`}>
          {current === 'repuestos' && <TaskParts task={task} role={role} lines={detail.parts} evidence={detail.evidence} onAction={onAction} refresh={refresh} onQuote={manages ? line => { setDraft({ ...draft, id_tarea_repuesto: String(line.id), detalle: line.nombre || line.descripcion, cantidad: String(Number(line.cantidad)) }); setTab('compras') } : null} />}

          {current === 'compras' && <TaskQuotes task={task} role={role} autoWhatsapp={autoWhatsapp} quotes={detail.quotes} lines={detail.parts} evidence={detail.evidence} draft={draft} setDraft={setDraft} clearDraft={clearDraft} onAction={onAction} refresh={refresh} />}

          {current === 'antes' && <section className="detail-section">
            <h3>Antes</h3>
            <p className="detail-meta">Fotos o video de cómo estaba el camión antes del trabajo.</p>
            {beforeEvidence.length ? <MediaGrid items={beforeEvidence} label={`Antes: ${task.tipo_tarea}`} onDelete={canAddBefore ? remove : undefined} /> : <Empty>Sin fotos ni video del antes.</Empty>}
            {canAddBefore && captures('antes')}
          </section>}

          {current === 'despues' && <section className="detail-section">
            <h3>Después</h3>
            <p className="detail-meta">Fotos o video del trabajo terminado.</p>
            {afterEvidence.length ? <MediaGrid items={afterEvidence} label={`Después: ${task.tipo_tarea}`} onDelete={['admin', 'mecanico'].includes(role) && task.estado === 'En_Trabajo' ? remove : undefined} /> : <Empty>Sin fotos ni video del después.</Empty>}
            {canAddAfter && captures('despues')}
            {waiting && task.estado === 'En_Trabajo' && <div className="waiting-notice" role="note">
              <strong>Esperando repuesto</strong>
              <p>No puedes terminar la OT hasta que el supervisor registre la compra. Te avisaremos cuando llegue.</p>
              <ul>{detail.parts.filter(l => l.estado === 'faltante').map(l => <li key={l.id}><b>{l.nombre || l.descripcion}</b> · {stageOf(l)}</li>)}</ul>
            </div>}
            {mechanic && task.estado === 'En_Trabajo' && !waiting && <div className="review-actions">
              <Button disabled={!afterEvidence.length} onClick={async () => {
                if (await onAction(() => request('put', `/api/tareas/estado/${task.id}`, { estado: 'Completada' }), 'Tarea enviada a revisión.')) onClose()
              }}>Enviar a revisión</Button>
              {!afterEvidence.length && <p className="detail-meta">Sube al menos una foto o video del después para enviarla.</p>}
            </div>}
          </section>}

          {current === 'checklist' && office && <section className="detail-section">
            <h3>Checklist de salida</h3>
            <p className="detail-meta">Lo llena el mecánico al terminar la OT (la hoja «Check List - Mantenimiento»).</p>
            <TaskChecklist task={task} editable={false} office onAction={onAction} />
          </section>}

          {current === 'costos' && office && <section className="detail-section">
            <h3>Costos de la tarea</h3>
            <p className="detail-meta">Las compras registradas desde una cotización y otros gastos. El mecánico no ve esta sección.</p>
            {detail.expenses.length ? <Table label="Costos de la tarea" headings={['Concepto', 'Fecha', 'Monto', ...(manages ? [''] : [])]}>
              {detail.expenses.map(item => <tr key={item.id}><td>{item.concepto}<small className="detail-meta">{item.tipo === 'compra' ? 'Compra aprobada' : 'Otro gasto'}</small></td><td>{date(item.fecha)}</td><td className="num">{item.monto == null ? '—' : money(item.monto)}</td>
                {manages && <td>{item.tipo === 'factura' && <Button variant="danger" aria-label={`Eliminar ${item.concepto}`} onClick={async () => {
                  if (window.confirm(`¿Eliminar el gasto «${item.concepto}»?`) && await onAction(() => request('delete', `/api/gastos/${item.id}`), 'Gasto eliminado.')) await refresh()
                }}>Eliminar</Button>}</td>}
              </tr>)}
            </Table> : <Empty>Sin costos registrados.</Empty>}
            <p className="expense-total">Total de la tarea <strong>{money(taskTotal)}</strong></p>
            {manages && task.estado !== 'Aprobada' && <form className="manual-expense-form" onSubmit={async event => {
              event.preventDefault()
              if (await onAction(() => request('post', '/api/gastos/manual', { id_tarea: task.id, ...manual }), 'Gasto agregado.')) { setManual({ concepto: '', monto: '', fecha: today() }); await refresh() }
            }}>
              <h4>Agregar otro gasto</h4>
              <p className="detail-meta">Para gastos que no pasaron por una cotización (por ejemplo, un servicio externo).</p>
              <Field label="Concepto" value={manual.concepto} maxLength={200} placeholder="Ej.: Servicio de grúa" onChange={event => setManual({ ...manual, concepto: event.target.value })} required />
              <Field label="Monto (CLP)" type="number" min="1" step="1" inputMode="numeric" value={manual.monto} onChange={event => setManual({ ...manual, monto: event.target.value })} required />
              <Field label="Fecha" type="date" max={today()} value={manual.fecha} onChange={event => setManual({ ...manual, fecha: event.target.value })} required />
              <Button type="submit" variant="secondary">Agregar gasto</Button>
            </form>}
          </section>}

          {current === 'historial' && <section className="detail-section">
            <h3>Historial de la OT</h3>
            <p className="detail-meta">Todo lo que pasó en esta orden de trabajo, en orden.</p>
            {detail.events.length ? <ol className="timeline">{detail.events.map(e => <li key={e.id} className={`event-${e.tipo}`}>
              <span className="timeline-date">{dateTime(e.created_at)}</span>
              <p><strong>{e.usuario || 'Sistema'}</strong> {e.detalle}{e.monto != null && <> · <b>{money(e.monto)}</b></>}</p>
            </li>)}</ol> : <Empty>Sin movimientos registrados. El historial empezó a guardarse el 12-11-2026.</Empty>}
          </section>}

          {current === 'revision' && <section className="detail-section task-review-section">
            <h3>Revisión del supervisor</h3>
            <p className="detail-meta">Revisa el antes, el después y los repuestos. Aprueba el trabajo para cerrar la tarea o explica qué debe corregir el mecánico.</p>
            <Button onClick={async () => {
              if (await onAction(() => request('post', `/api/tareas/revisar/${task.id}`, { decision: 'aprobar' }), 'Tarea aprobada.')) onClose()
            }}>Aprobar tarea</Button>
            <form className="rejection-form" onSubmit={async event => {
              event.preventDefault()
              if (await onAction(() => request('post', `/api/tareas/revisar/${task.id}`, { decision: 'rechazar', nota: rejectionNote }), 'Tarea devuelta al mecánico.')) onClose()
            }}>
              <Field label="Motivo del rechazo" as="textarea" rows={4} maxLength={2000} value={rejectionNote} placeholder="Describe claramente qué debe corregirse antes de volver a enviar la tarea." onChange={event => setRejectionNote(event.target.value)} required />
              <Button type="submit" variant="danger" disabled={!rejectionNote.trim()}>Rechazar y devolver</Button>
            </form>
          </section>}
        </fieldset>
      </>}
    </div>
  </Modal>
}
