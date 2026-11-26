import { useState, useEffect, useCallback } from 'react'
import { request, serverUrl } from '../api'
import { money, date, dateTime, today } from '../format'
import Modal from './Modal'
import { Button, Empty, Field, Status, Table } from './UI'

export default function TaskDetail({ task, role, busy, notice, onClose, onAction }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [file, setFile] = useState(null)
  const [files, setFiles] = useState([])
  const [fileKey, setFileKey] = useState(0)
  const [expense, setExpense] = useState({ concepto: '' })
  const [rejectionNote, setRejectionNote] = useState('')
  const [manual, setManual] = useState({ concepto: '', monto: '', fecha: today() })
  const mechanic = role === 'mecanico'
  const manages = role === 'encargado' || role === 'admin'
  const repairEvidence = detail?.evidence.filter(item => item.tipo === 'foto') || []
  const invoices = detail?.evidence.filter(item => item.tipo === 'factura' || item.tipo === 'boleta') || []
  const mechanicExpenses = detail?.expenses.filter(item => item.tipo === 'mecanico') || []
  const invoiceExpenses = detail?.expenses.filter(item => item.tipo === 'factura') || []
  const taskTotal = detail?.expenses.reduce((sum, item) => sum + (Number(item.monto) || 0), 0) || 0
  const fetchDetail = useCallback(async () => {
    const [evidence, expenses] = await Promise.all([request('get', `/api/evidencia/${task.id}`), request('get', `/api/gastos/${task.id}`)])
    return { evidence: evidence.evidencias, expenses: expenses.gastos }
  }, [task.id])
  const refresh = async () => {
    setError('')
    try { setDetail(await fetchDetail()) } catch { setError('No pudimos cargar los detalles de esta tarea.') }
  }
  // El encargado corrige o completa el monto de cada gasto; los de facturas también se pueden quitar (duplicados).
  const amountCell = item => !manages ? (item.monto == null ? <span className="detail-meta">Sin monto</span> : money(item.monto)) : <form key={`${item.id}-${item.monto}`} className="amount-form" onSubmit={async event => {
    event.preventDefault()
    const monto = new FormData(event.currentTarget).get('monto')
    if (await onAction(() => request('put', `/api/gastos/${item.id}`, { monto }), 'Monto actualizado.')) await refresh()
  }}>
    <input name="monto" type="number" min="1" step="1" inputMode="numeric" required defaultValue={item.monto == null ? '' : Number(item.monto)} placeholder="Monto CLP" aria-label={`Monto de ${item.concepto}`} />
    <Button type="submit" variant="secondary">Guardar</Button>
    {item.tipo === 'factura' && <Button variant="danger" aria-label={`Eliminar ${item.concepto}`} onClick={async () => {
      if (window.confirm(`¿Eliminar el gasto «${item.concepto}»?`) && await onAction(() => request('delete', `/api/gastos/${item.id}`), 'Gasto eliminado.')) await refresh()
    }}>Eliminar</Button>}
  </form>
  useEffect(() => {
    let active = true
    fetchDetail().then(result => { if (active) setDetail(result) }).catch(() => { if (active) setError('No pudimos cargar los detalles de esta tarea.') })
    return () => { active = false }
  }, [fetchDetail])

  return <Modal title={`Detalle: ${task.tipo_tarea}`} onClose={onClose}>
    <div className="modal-content">
      <div className="section-heading"><h2>{task.tipo_tarea}</h2><Button variant="secondary" onClick={onClose} aria-label="Cerrar detalle">×</Button></div>
      <p className="detail-meta">{task.patente_camion} · Límite: {date(task.fecha_limite)}</p>
      {task.mecanicos && <p className="detail-meta">Mecánico(s): {task.mecanicos}</p>}
      {task.prioridad && <p className="detail-meta">Prioridad: {task.prioridad}</p>}
      <Status value={task.estado} />
      {task.descripcion && <p className="detail-description">{task.descripcion}</p>}
      {task.nota_rechazo && task.estado !== 'Aprobada' && <div className="rejection-notice" role="note"><strong>Corrección solicitada por el encargado</strong><p>{task.nota_rechazo}</p><small>{task.fecha_rechazo ? `${dateTime(task.fecha_rechazo)} · ` : ''}Rechazo n.º {task.veces_rechazada || 1}</small></div>}
      {notice && <div role={notice.error ? 'alert' : 'status'} className={`notice notice-${notice.error ? 'error' : 'success'}`}>{notice.message}</div>}
      {busy && <p role="status" className="detail-meta">Procesando…</p>}
      {error ? <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={refresh}>Reintentar</Button></div> : !detail ? <p role="status" className="loading-state">Cargando detalle…</p> : <fieldset disabled={busy} className="detail-fields">
        <section className="detail-section repair-evidence-section">
          <h3>Evidencia de la reparación</h3>
          <p className="detail-meta">Fotografías del trabajo realizado por el mecánico.</p>
          {repairEvidence.length ? <div className="evidence-grid">{repairEvidence.map(item => <a key={item.id} href={serverUrl + item.ruta_archivo} target="_blank" rel="noreferrer"><img loading="lazy" decoding="async" src={serverUrl + item.ruta_archivo} alt={`Evidencia de reparación: ${task.tipo_tarea}`} /></a>)}</div> : <Empty>No hay fotos de reparación registradas.</Empty>}
          {mechanic && task.estado === 'En_Trabajo' && <form className="upload-form" onSubmit={async event => {
            event.preventDefault()
            const body = new FormData(); body.append('foto', file)
            if (await onAction(() => request('post', `/api/evidencia/subir/${task.id}`, body, { timeout: 120000 }), 'Foto de reparación subida correctamente.')) { setFile(null); setFileKey(value => value + 1); await refresh() }
          }}>
            <Field key={`repair-${fileKey}`} label="Tomar foto de evidencia" type="file" accept="image/*" capture="environment" required onChange={event => setFile(event.target.files[0] || null)} />
            <Button type="submit" disabled={!file}>Subir foto</Button>
          </form>}
        </section>

        <section className="detail-section mechanic-expense-section">
          <h3>Conceptos registrados por mecánico</h3>
          {mechanicExpenses.length ? <Table label="Conceptos del mecánico" headings={['Concepto', 'Fecha', ...(mechanic ? [] : ['Monto'])]}>{mechanicExpenses.map(item => <tr key={item.id}><td>{item.concepto}</td><td>{date(item.fecha)}</td>{!mechanic && <td>{amountCell(item)}</td>}</tr>)}</Table> : <Empty>No hay conceptos registrados.</Empty>}
          {mechanic && task.estado === 'En_Trabajo' && <form className="expense-form" onSubmit={async event => {
            event.preventDefault()
            if (!expense.concepto.trim()) return
            if (await onAction(() => request('post', '/api/gastos/agregar', { concepto: expense.concepto, id_tarea: task.id }), 'Concepto registrado.')) { setExpense({ concepto: '' }); await refresh() }
          }}>
            <Field label="Concepto (qué se compró)" value={expense.concepto} onChange={event => setExpense({ concepto: event.target.value })} required />
            <Button type="submit">Agregar concepto</Button>
          </form>}
        </section>

        <section className="detail-section invoice-section">
          <h3>Boletas y facturas</h3>
          <p className="detail-meta">Documentos de cobro y montos extraídos automáticamente. Se muestran separados de las fotos de reparación.</p>
          {invoices.length ? <div className="document-grid">{invoices.map((item, index) => <a className="document-link" key={item.id} href={serverUrl + item.ruta_archivo} target="_blank" rel="noreferrer">Ver boleta o factura {index + 1} ↗</a>)}</div> : <Empty>No hay boletas o facturas subidas aún.</Empty>}
          {manages && task.estado === 'Completada' && <form className="upload-form" onSubmit={async event => {
            event.preventDefault()
            const body = new FormData(); for (const selected of files) body.append('factura', selected)
            if (await onAction(() => request('post', `/api/evidencia/factura/${task.id}`, body, { timeout: 120000 }), result => result?.mensaje || 'Boleta(s) o factura(s) subida(s) correctamente.')) { setFiles([]); setFileKey(value => value + 1); await refresh() }
          }}>
            <Field key={`invoice-camera-${fileKey}`} label="Tomar foto de boleta o factura" type="file" accept="image/*" capture="environment" onChange={event => setFiles(Array.from(event.target.files))} />
            <Field key={`invoice-files-${fileKey}`} label="Elegir imágenes o PDF" type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" multiple onChange={event => setFiles(Array.from(event.target.files))} />
            {files.length > 0 && <p className="detail-meta">{files.length} archivo(s) seleccionado(s)</p>}
            <Button type="submit" disabled={!files.length}>Subir {files.length > 1 ? `${files.length} documentos` : 'documento'}</Button>
          </form>}
          <h4>Gastos de boletas y facturas</h4>
          {invoiceExpenses.length ? <Table label="Gastos de boletas" headings={['Concepto', 'Fecha', 'Monto']}>
            {invoiceExpenses.map(item => <tr key={item.id}><td>{item.concepto}</td><td>{date(item.fecha)}</td><td>{amountCell(item)}</td></tr>)}
          </Table> : <Empty>No hay montos detectados en boletas o facturas.</Empty>}
          {manages && <form className="manual-expense-form" onSubmit={async event => {
            event.preventDefault()
            if (await onAction(() => request('post', '/api/gastos/manual', { id_tarea: task.id, ...manual }), 'Gasto agregado.')) { setManual({ concepto: '', monto: '', fecha: today() }); await refresh() }
          }}>
            <p className="detail-meta">¿La IA no detectó un monto? Agrégalo manualmente.</p>
            <Field label="Concepto" value={manual.concepto} maxLength={200} placeholder="Ej.: Factura repuestos 1234" onChange={event => setManual({ ...manual, concepto: event.target.value })} required />
            <Field label="Monto (CLP)" type="number" min="1" step="1" inputMode="numeric" value={manual.monto} onChange={event => setManual({ ...manual, monto: event.target.value })} required />
            <Field label="Fecha" type="date" max={today()} value={manual.fecha} onChange={event => setManual({ ...manual, fecha: event.target.value })} required />
            <Button type="submit">Agregar gasto</Button>
          </form>}
          <p className="expense-total">Total de la tarea <strong>{money(taskTotal)}</strong></p>
        </section>

        {mechanic && task.estado === 'En_Trabajo' && <Button variant="success" onClick={async () => {
          if (await onAction(() => request('put', `/api/tareas/estado/${task.id}`, { estado: 'Completada' }), 'Tarea enviada a revisión.')) onClose()
        }}>Enviar a revisión</Button>}
        {manages && task.estado === 'Completada' && <section className="detail-section task-review-section">
          <h3>Revisión del encargado</h3>
          <p className="detail-meta">Aprueba el trabajo para cerrar la tarea o explica qué debe corregir el mecánico.</p>
          <Button variant="success" onClick={async () => {
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
      </fieldset>}
    </div>
  </Modal>
}
