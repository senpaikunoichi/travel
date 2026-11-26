import { useCallback, useEffect, useState } from 'react'
import { request, serverUrl } from '../api'
import { dateTime } from '../format'
import { Button, Empty, Field, Section } from './UI'

function InventoryPurchases({ role, onUpdated }) {
  const [inventory, setInventory] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canManageStatus = role === 'admin' || role === 'jefe'

  const load = useCallback(async () => {
    const [catalog, purchases] = await Promise.all([
      request('get', '/api/inventario/repuestos'),
      request('get', '/api/inventario/solicitudes'),
    ])
    setInventory(catalog.repuestos)
    setRequests(purchases.solicitudes)
  }, [])

  useEffect(() => {
    let active = true
    const initialize = async () => {
      try {
        await load()
      } catch (cause) {
        if (active) setError(cause.response?.data?.mensaje || cause.message || 'No pudimos cargar las solicitudes.')
      } finally {
        if (active) setLoading(false)
      }
    }
    initialize()
    return () => { active = false }
  }, [load])

  const submit = async event => {
    event.preventDefault()
    const formElement = event.currentTarget
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const form = new FormData(formElement)
      await request('post', '/api/inventario/solicitudes', form)
      formElement.reset()
      await load()
      await onUpdated?.()
      setNotice('Solicitud de compra creada.')
    } catch (cause) {
      setError(cause.response?.data?.mensaje || cause.message || 'No se pudo crear la solicitud.')
    } finally {
      setBusy(false)
    }
  }

  const updateStatus = async (id, estado) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await request('put', `/api/inventario/solicitudes/${id}/estado`, { estado })
      await load()
      await onUpdated?.()
      setNotice(result.mensaje || 'Estado de solicitud actualizado.')
    } catch (cause) {
      setError(cause.response?.data?.mensaje || cause.message || 'No se pudo actualizar la solicitud.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="purchase-page">
    {notice && <p role="status" className="notice notice-success">{notice}</p>}
    {error && <p role="alert" className="notice notice-error">{error}<Button variant="secondary" onClick={() => { setError(''); load().catch(cause => setError(cause.message)) }}>Reintentar</Button></p>}
    <Section id="purchase-requests" title="Nueva solicitud de compra">
      <form className="purchase-form" onSubmit={submit}>
        <Field label="Repuesto del catálogo (opcional)" as="select" name="repuesto_id" defaultValue="">
          <option value="">No está en el catálogo</option>
          {inventory.map(item => <option key={item.id} value={item.id}>{item.nombre} · stock {item.stock_actual}</option>)}
        </Field>
        <Field label="Descripción de la pieza" name="descripcion_pieza" maxLength={500} placeholder="Ej.: filtro de aceite para camión 12" />
        <Field label="Cantidad" name="cantidad" type="number" min="1" step="1" defaultValue="1" required />
        <Field label="Foto de referencia o comprobante" name="foto_comprobante" type="file" accept="image/*" capture="environment" />
        <Button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Solicitar compra'}</Button>
      </form>
    </Section>
    <Section title="Solicitudes de compra">
      {loading ? <p className="loading-state" role="status">Cargando solicitudes…</p> : requests.length ? <div className="purchase-list">
        {requests.map(item => <article className="purchase-card" key={item.id}>
          <div className="purchase-card-heading">
            <div><p className="eyebrow">SOLICITUD #{item.id}</p><h3>{item.repuesto || item.descripcion_pieza}</h3></div>
            <span className={`purchase-status purchase-status-${item.estado.toLowerCase()}`}>{item.estado}</span>
          </div>
          <p><strong>Cantidad:</strong> {item.cantidad}{item.repuesto ? ` · ${item.descripcion_pieza}` : ''}</p>
          <p className="purchase-meta">Solicitada por {item.solicitante} · {dateTime(item.created_at)}</p>
          {item.foto_comprobante_url && <a className="purchase-proof" href={`${serverUrl}${item.foto_comprobante_url}`} target="_blank" rel="noreferrer">Ver foto o comprobante</a>}
          {canManageStatus && <div className="actions">
            {item.estado === 'PENDIENTE' && <Button disabled={busy} onClick={() => updateStatus(item.id, 'APROBADO')}>Aprobar</Button>}
            {item.estado === 'APROBADO' && <Button disabled={busy} onClick={() => updateStatus(item.id, 'RECIBIDO')}>Marcar recibido</Button>}
          </div>}
        </article>)}
      </div> : <Empty>No hay solicitudes de compra todavía.</Empty>}
    </Section>
  </div>
}

export default InventoryPurchases
