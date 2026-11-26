import { useEffect, useState } from 'react'
import { request } from '../api'
import { dateTime, money, today } from '../format'
import { Button, Empty, Field, Table } from './UI'

function initialFilters() {
  const end = today()
  const start = new Date(Date.parse(`${end}T12:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10)
  return { fecha_inicio: start, fecha_fin: end, categoria: '', estado_stock: 'todos', tipo_movimiento: 'todos', camion: '' }
}

function downloadName(extension, filters) {
  return `reporte_inventario_${filters.fecha_inicio}_${filters.fecha_fin}.${extension}`
}

function InventoryReports() {
  const [draft, setDraft] = useState(initialFilters)
  const [filters, setFilters] = useState(initialFilters)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const params = filters

  useEffect(() => {
    let active = true
    request('get', '/api/inventario/reportes', undefined, { params })
      .then(result => { if (active) setReport(result) })
      .catch(cause => { if (active) setError(cause.response?.data?.mensaje || cause.message || 'No pudimos cargar el reporte.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params])

  const change = event => setDraft(current => ({ ...current, [event.target.name]: event.target.value }))
  const applyFilters = event => {
    event.preventDefault()
    if (!draft.fecha_inicio || !draft.fecha_fin || draft.fecha_inicio > draft.fecha_fin) {
      setError('Selecciona un rango de fechas válido.')
      return
    }
    const changed = Object.keys(draft).some(key => draft[key] !== filters[key])
    if (changed) setLoading(true)
    setError('')
    setNotice('')
    if (changed) setFilters({ ...draft })
  }

  const exportReport = async extension => {
    setDownloading(extension)
    setError('')
    setNotice('')
    try {
      const blob = await request('get', `/api/inventario/reportes/${extension}`, undefined, {
        params: filters,
        responseType: 'blob',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = downloadName(extension === 'excel' ? 'xlsx' : 'pdf', filters)
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`Reporte ${extension === 'excel' ? 'Excel' : 'PDF'} descargado.`)
    } catch (cause) {
      setError(cause.response?.data?.mensaje || cause.message || 'No se pudo generar el archivo.')
    } finally {
      setDownloading('')
    }
  }

  return <section id="reportes-inventario" className="section inventory-reports">
    <div className="section-heading">
      <div><p className="eyebrow">BODEGA · INFORMES</p><h2>Reportes de inventario</h2></div>
      <div className="actions">
        <Button variant="secondary" disabled={!report || loading || Boolean(downloading)} onClick={() => exportReport('excel')}>{downloading === 'excel' ? 'Generando…' : 'Descargar Excel'}</Button>
        <Button disabled={!report || loading || Boolean(downloading)} onClick={() => exportReport('pdf')}>{downloading === 'pdf' ? 'Generando…' : 'Descargar PDF'}</Button>
      </div>
    </div>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {notice && <p role="status" className="notice notice-success">{notice}</p>}

    <details className="section inventory-report-disclosure inventory-report-controls-disclosure">
      <summary><span>Filtros del reporte</span><strong>Fechas, categoría y estado</strong></summary>
      <form className="inventory-report-filters" onSubmit={applyFilters}>
        <Field label="Desde" name="fecha_inicio" type="date" value={draft.fecha_inicio} onChange={change} required />
        <Field label="Hasta" name="fecha_fin" type="date" value={draft.fecha_fin} onChange={change} required />
        <Field label="Categoría" as="select" name="categoria" value={draft.categoria} onChange={change}>
          <option value="">Todas</option>
          {(report?.categorias || []).map(category => <option key={category} value={category}>{category}</option>)}
        </Field>
        <Field label="Estado del stock" as="select" name="estado_stock" value={draft.estado_stock} onChange={change}>
          <option value="todos">Todos</option><option value="critico_bajo">Crítico o bajo</option><option value="agotado">Agotado</option>
        </Field>
        <Field label="Tipo de movimiento" as="select" name="tipo_movimiento" value={draft.tipo_movimiento} onChange={change}>
          <option value="todos">Entradas y salidas</option><option value="ENTRADA">Entradas</option><option value="SALIDA">Salidas</option>
        </Field>
        <Field label="Camión" as="select" name="camion" value={draft.camion} onChange={change}>
          <option value="">Todos</option>
          {(report?.camiones || []).map(truck => <option key={truck.patente} value={truck.patente}>{truck.patente} · {truck.numero}</option>)}
        </Field>
        <Button type="submit" disabled={loading}>Aplicar filtros</Button>
      </form>
    </details>

    {loading && <p className="loading-state" role="status">Generando vista previa…</p>}
    {!loading && report && <>
      <details className="section inventory-report-disclosure">
        <summary><span>Resumen del reporte</span><strong>{report.resumen.total_repuestos} repuestos · {report.resumen.unidades} unidades</strong></summary>
        <div className="inventory-report-summary-content">
          <p className="section-description">Consulta el stock actual y los movimientos del período. Los filtros y el usuario que genera el informe se incluyen en los archivos.</p>
          <div className="inventory-report-kpis">
            <div className="summary-card"><span>Repuestos</span><strong>{report.resumen.total_repuestos}</strong><span>En el filtro actual</span></div>
            <div className="summary-card"><span>Unidades en stock</span><strong>{report.resumen.unidades}</strong><span>Stock actual</span></div>
            <div className="summary-card"><span>Valor estimado conocido</span><strong>{money(report.resumen.valor_estimado)}</strong><span>{report.resumen.repuestos_sin_costo} sin costo unitario</span></div>
            <div className="summary-card"><span>Stock crítico / bajo</span><strong>{report.resumen.criticos} / {report.resumen.bajos}</strong><span>{report.resumen.agotados} agotados</span></div>
          </div>
          <p className="inventory-report-note">El valor estimado suma solo repuestos con costo unitario registrado. El stock es el estado actual; el rango de fechas se aplica al historial de movimientos.</p>
        </div>
      </details>
      <details className="section inventory-report-disclosure">
        <summary><span>Detalle de stock</span><strong>{report.repuestos.length} repuesto{report.repuestos.length === 1 ? '' : 's'}</strong></summary>
        {report.repuestos.length ? <Table label="Detalle de stock de inventario" headings={['Código', 'Repuesto', 'Categoría', 'Stock', 'Mínimo', 'Costo', 'Ubicación', 'Estado']}>
          {report.repuestos.map(item => <tr key={item.id}>
            <td>{item.codigo_qr || '—'}</td><td><strong>{item.nombre}</strong></td><td>{item.categoria}</td><td>{item.stock_actual}</td><td>{item.stock_minimo}</td>
            <td>{item.costo_unitario === null ? '—' : money(item.costo_unitario)}</td><td>{item.ubicacion}</td>
            <td><span className={`stock-label stock-label-${Number(item.stock_actual) <= Number(item.stock_minimo) ? 'critico' : Number(item.stock_actual) <= Math.ceil(Number(item.stock_minimo) * 1.25) ? 'bajo' : 'adecuado'}`}>
              {Number(item.stock_actual) <= Number(item.stock_minimo) ? 'Crítico' : Number(item.stock_actual) <= Math.ceil(Number(item.stock_minimo) * 1.25) ? 'Bajo' : 'Adecuado'}
            </span></td>
          </tr>)}
        </Table> : <Empty>No hay repuestos con los filtros seleccionados.</Empty>}
      </details>
      <details className="section inventory-report-disclosure">
        <summary><span>Historial de movimientos</span><strong>{report.movimientos.length} registro{report.movimientos.length === 1 ? '' : 's'}</strong></summary>
        {report.movimientos.length ? <Table label="Historial de movimientos de inventario" headings={['Fecha', 'Tipo', 'Repuesto', 'Cantidad', 'Camión', 'Responsable']}>
          {report.movimientos.map((movement, index) => <tr key={`${movement.created_at}-${movement.repuesto}-${index}`}>
            <td>{dateTime(movement.created_at)}</td><td>{movement.tipo}</td><td>{movement.repuesto}</td><td>{movement.cantidad}</td><td>{movement.camion || '—'}</td><td>{movement.usuario}</td>
          </tr>)}
        </Table> : <Empty>No hay movimientos en el período seleccionado.</Empty>}
      </details>
    </>}
  </section>
}

export default InventoryReports
