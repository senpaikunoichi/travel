import { useEffect, useRef, useState } from 'react'
import { request } from '../api'
import { money } from '../format'
import { Button, Empty, Field } from './UI'

function fetchInventory() {
  return request('get', '/api/inventario/repuestos')
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLocaleLowerCase('es')
}

function findMatch(item, inventory) {
  const code = normalizeText(item.codigo_referencia)
  const name = normalizeText(item.nombre_sugerido || item.nombre)
  const byCode = code && inventory.find(part => normalizeText(part.codigo_qr) === code)
  return byCode || (name && inventory.find(part => normalizeText(part.nombre) === name)) || null
}

function entryDefaults(item, matched) {
  return {
    nombre: matched?.nombre || item.nombre_sugerido || item.nombre || '',
    categoria: matched?.categoria || item.categoria || 'Por clasificar',
    codigo_qr: matched?.codigo_qr || item.codigo_referencia || '',
    ubicacion: matched?.ubicacion || item.ubicacion_estimada || 'Por asignar',
    cantidad: item.cantidad || 1,
    stock_minimo: matched?.stock_minimo ?? 0,
    costo_unitario: item.precio_estimado ?? matched?.costo_unitario ?? '',
  }
}

function Inventory({ role, onAction, refreshToken = 0 }) {
  const [inventory, setInventory] = useState([])
  const [notice, setNotice] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [editor, setEditor] = useState(null)
  const [deletion, setDeletion] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const captureInput = useRef(null)
  const canEdit = role === 'admin' || role === 'encargado'
  const load = async () => {
    try {
      const items = await fetchInventory()
      setInventory(items.repuestos)
      setLoadError('')
    } catch (error) {
      setLoadError(error.response?.data?.mensaje || error.message || 'No pudimos cargar el inventario.')
    }
  }

  useEffect(() => {
    let active = true
    fetchInventory().then(items => {
      if (!active) return
      setInventory(items.repuestos)
    }).catch(error => {
      if (active) setLoadError(error.response?.data?.mensaje || error.message || 'No pudimos cargar el inventario.')
    })
    return () => { active = false }
  }, [refreshToken])

  const perform = async (operation, message) => {
    setNotice(null)
    if (await onAction(operation, message)) {
      await load()
      return true
    }
    return false
  }

  const saveItem = async event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (editor.invoiceAnalysis?.items.length) {
      const items = editor.invoiceAnalysis.items.map((item, index) => {
        const matched = item.coincidencia || findMatch(item, inventory)
        return {
          repuesto_id: matched?.id || null,
          nombre: form.get(`invoice_nombre_${index}`),
          categoria: form.get(`invoice_categoria_${index}`),
          codigo_qr: form.get(`invoice_codigo_${index}`),
          ubicacion: form.get(`invoice_ubicacion_${index}`),
          cantidad: form.get(`invoice_cantidad_${index}`),
          stock_minimo: form.get(`invoice_minimo_${index}`),
          costo_unitario: form.get(`invoice_costo_${index}`),
        }
      })
      if (await perform(
        () => request('post', '/api/inventario/ingresos/lote', { items, comentario: editor.entryComment }),
        `${items.length} producto(s) ingresado(s) correctamente.`,
      )) setEditor(null)
      return
    }
    if (editor.stockEntry) {
      if (editor.matchedPart) form.set('repuesto_id', editor.matchedPart.id)
      else form.delete('repuesto_id')
      form.set('comentario', editor.entryComment || 'Ingreso asistido por imagen')
      if (editor.analysisPhoto && !form.get('foto')?.size) form.set('foto', editor.analysisPhoto)
      const saved = await perform(
        () => request('post', '/api/inventario/ingresos', form),
        editor.matchedPart ? 'Stock actualizado para el repuesto existente.' : 'Repuesto ingresado al inventario.',
      )
      if (!saved) return
      setEditor(null)
      return
    }
    if (editor.analysisPhoto && !form.get('foto')?.size) form.set('foto', editor.analysisPhoto)
    const url = editor.item ? `/api/inventario/repuestos/${editor.item.id}` : '/api/inventario/repuestos'
    if (await perform(() => request(editor.item ? 'put' : 'post', url, form), editor.item ? 'Repuesto actualizado.' : 'Repuesto agregado.')) setEditor(null)
  }

  const analyzeImage = async image => {
    if (!image) return
    setEditor(current => ({ ...current, key: Date.now(), analysisPhoto: image, partAnalysis: null, invoiceAnalysis: null, stockEntry: false }))
    setAnalyzing(true)
    setNotice(null)
    try {
      const form = new FormData()
      form.set('foto', image)
      const response = await request('post', '/api/inventario/analizar-imagen', form)
      if (response.resultado.tipo_documento === 'repuesto') {
        const suggestion = response.resultado
        const matched = suggestion.coincidencia || findMatch(suggestion, inventory)
        setEditor(current => ({
          ...current,
          key: Date.now(),
          stockEntry: true,
          matchedPart: matched,
          defaults: entryDefaults(suggestion, matched),
          entryComment: 'Ingreso por foto de repuesto',
          partAnalysis: suggestion,
          invoiceAnalysis: null,
          invoiceItemIndex: null,
        }))
      } else if (['boleta', 'factura', 'guia'].includes(response.resultado.tipo_documento)) {
        const firstItem = response.resultado.items[0]
        const matched = firstItem?.coincidencia || (firstItem ? findMatch(firstItem, inventory) : null)
        setEditor(current => ({
          ...current,
          key: Date.now(),
          invoiceAnalysis: response.resultado,
          stockEntry: Boolean(firstItem),
          matchedPart: matched,
          defaults: firstItem ? entryDefaults(firstItem, matched) : null,
          entryComment: `Recepción ${response.resultado.tipo_documento} ${response.resultado.numero_documento || ''} ${response.resultado.proveedor || ''}`.trim(),
          invoiceItemIndex: firstItem ? 0 : null,
          analysisPhoto: null,
        }))
      } else {
        setNotice({ message: 'No pudimos reconocer un repuesto ni una boleta, factura o guía. Prueba con otra foto.', error: true })
        return
      }
      const label = response.resultado.tipo_documento === 'repuesto' ? 'repuesto' : response.resultado.tipo_documento
      setNotice({ message: `Imagen identificada como ${label}. Revisa los datos detectados.`, error: false })
    } catch (error) {
      setNotice({
        message: error.response?.data?.mensaje || error.message || 'No pudimos analizar la imagen.',
        error: true,
      })
    } finally {
      setAnalyzing(false)
    }
  }

  const fieldHint = editor?.matchedPart ? 'Coincidencia del catálogo · editable' : 'Sugerido por IA · editable'

  return <section id="inventario" className="section inventory-section" aria-labelledby="inventory-title">
    <div className="section-heading">
      <div><p className="eyebrow">REPUESTOS Y BODEGA</p><h2 id="inventory-title">Inventario de taller</h2></div>
      <div className="actions inventory-entry-actions">
        {canEdit && <Button disabled={analyzing} onClick={() => { setEditor({ item: null }); captureInput.current?.click() }}>📷 Capturar foto o subir imagen</Button>}
        {canEdit && <Button variant="secondary" onClick={() => setEditor({ item: null })}>Agregar manualmente</Button>}
      </div>
    </div>
    <input
      ref={captureInput}
      className="inventory-capture-input"
      type="file"
      accept="image/*"
      capture="environment"
      aria-label="Capturar foto o subir imagen de un repuesto o factura"
      tabIndex={-1}
      disabled={analyzing}
      onChange={event => {
        const image = event.target.files?.[0]
        event.target.value = ''
        if (image) {
          setEditor(current => current || { item: null })
          analyzeImage(image)
        }
      }}
    />
    <p className="section-description">Ingresa nuevos productos y consulta el catálogo del taller.</p>
    {notice && <p role={notice.error ? 'alert' : 'status'} className={`notice notice-${notice.error ? 'error' : 'success'} inventory-notice`}>{notice.message}</p>}
    {loadError && <p role="alert" className="notice notice-error inventory-notice">{loadError} <Button variant="secondary" onClick={load}>Reintentar</Button></p>}

    {editor && <form key={editor.key || 'new-inventory-item'} className="inventory-form" onSubmit={saveItem}>
      <div className="section-heading"><h3>{editor.item ? 'Editar repuesto' : 'Nuevo ingreso de inventario'}</h3><Button variant="secondary" type="button" onClick={() => setEditor(null)}>Cerrar</Button></div>
      {analyzing && <p role="status" className="inventory-ai-loading">Analizando imagen y extrayendo datos…</p>}
      {editor.partAnalysis && <div className="inventory-ai-results">
        <div><span className="ai-suggested-badge">Sugerido por IA · Confianza {editor.partAnalysis.confianza_analisis}</span>
          {editor.partAnalysis.descripcion && <p>{editor.partAnalysis.descripcion}</p>}</div>
        <Button type="button" variant="secondary" disabled={analyzing} onClick={() => captureInput.current?.click()}>Tomar otra foto</Button>
      </div>}
      {editor.invoiceAnalysis && <div className="inventory-ai-results">
        <div><span className="ai-suggested-badge">Documento detectado · {editor.invoiceAnalysis.tipo_documento}</span>
          <p>{editor.invoiceAnalysis.proveedor || 'Proveedor no identificado'}{editor.invoiceAnalysis.numero_documento ? ` · Documento ${editor.invoiceAnalysis.numero_documento}` : ''}</p></div>
        {!editor.invoiceAnalysis.items.length && <p>No se detectaron productos legibles. Completa los datos manualmente.</p>}
      </div>}
      {editor.matchedPart && !editor.invoiceAnalysis?.items.length && <p role="status" className="inventory-match-notice">
        <strong>Coincidencia encontrada:</strong> {editor.matchedPart.nombre}. Se actualizará este producto existente; no se creará un duplicado.
      </p>}
      {editor.invoiceAnalysis?.items.length > 0 ? <div className="invoice-items">
        {editor.invoiceAnalysis.items.map((item, index) => {
          const matched = item.coincidencia || findMatch(item, inventory)
          const defaults = entryDefaults(item, matched)
          const hint = matched ? 'Coincidencia del catálogo · editable' : 'Sugerido por IA · editable'
          return <article className="invoice-item" key={`${item.codigo_referencia}-${item.nombre}-${index}`}>
            <div className="invoice-item-heading">
              <strong>{item.nombre}</strong>
              <span>{matched ? `Coincidencia encontrada: ${matched.nombre}` : 'Producto nuevo'}</span>
              <small>Confianza de lectura: {item.confianza_analisis || 'baja'}</small>
            </div>
            <div className="inventory-form-grid">
              <div className="ai-field"><Field label="Nombre" name={`invoice_nombre_${index}`} defaultValue={defaults.nombre} required maxLength={150} /><small className="ai-field-hint">{hint}</small></div>
              <div className="ai-field"><Field label="Categoría" name={`invoice_categoria_${index}`} defaultValue={defaults.categoria} required maxLength={100} /><small className="ai-field-hint">{hint}</small></div>
              <div className="ai-field"><Field label="Código QR / SKU" name={`invoice_codigo_${index}`} defaultValue={defaults.codigo_qr} maxLength={100} /><small className="ai-field-hint">Código detectado · editable</small></div>
              <div className="ai-field"><Field label="Ubicación en estante" name={`invoice_ubicacion_${index}`} defaultValue={defaults.ubicacion} required maxLength={100} /><small className="ai-field-hint">{hint}</small></div>
              <div className="ai-field"><Field label="Cantidad a ingresar" name={`invoice_cantidad_${index}`} type="number" defaultValue={defaults.cantidad} min="1" max="1000000" required /><small className="ai-field-hint">Cantidad detectada · editable</small></div>
              <Field label="Stock mínimo" name={`invoice_minimo_${index}`} type="number" defaultValue={defaults.stock_minimo} min="0" max="1000000" required />
              <Field label="Costo unitario estimado (CLP)" name={`invoice_costo_${index}`} type="number" defaultValue={defaults.costo_unitario} min="0.01" max="99999999.99" step="0.01" />
            </div>
          </article>
        })}
      </div> : <div className="inventory-form-grid">
        <div className="ai-field"><Field label="Nombre" name="nombre" defaultValue={editor.defaults?.nombre || editor.item?.nombre || ''} required maxLength={150} />{editor.stockEntry && <small className="ai-field-hint">{fieldHint}</small>}</div>
        <div className="ai-field"><Field label="Categoría" name="categoria" defaultValue={editor.defaults?.categoria || editor.item?.categoria || ''} required maxLength={100} />{editor.stockEntry && <small className="ai-field-hint">{fieldHint}</small>}</div>
        <div className="ai-field"><Field label="Código QR / SKU" name="codigo_qr" defaultValue={editor.defaults?.codigo_qr || editor.item?.codigo_qr || ''} maxLength={100} />{editor.stockEntry && <small className="ai-field-hint">{fieldHint}</small>}</div>
        <div className="ai-field"><Field label="Ubicación en estante" name="ubicacion" defaultValue={editor.defaults?.ubicacion || editor.item?.ubicacion || ''} required maxLength={100} />{editor.stockEntry && <small className="ai-field-hint">{fieldHint}</small>}</div>
        {editor.stockEntry && <div className="ai-field"><Field label="Cantidad a ingresar" name="cantidad" type="number" defaultValue={editor.defaults?.cantidad ?? 1} min="1" max="1000000" required /><small className="ai-field-hint">Cantidad detectada · editable</small></div>}
        {!editor.stockEntry && !editor.item && <Field label="Stock inicial" name="stock_actual" type="number" defaultValue={0} min="0" max="1000000" required />}
        <Field label="Stock mínimo" name="stock_minimo" type="number" defaultValue={editor.defaults?.stock_minimo ?? editor.item?.stock_minimo ?? 0} min="0" max="1000000" required />
        <Field label="Costo unitario estimado (CLP, opcional)" name="costo_unitario" type="number" defaultValue={editor.item?.costo_unitario ?? editor.defaults?.costo_unitario ?? ''} min="0.01" max="99999999.99" step="0.01" />
        {editor.item && <Field label="Cambiar foto del repuesto" name="foto" type="file" accept="image/*" capture="environment" />}
      </div>}
      <div className="actions"><Button type="submit" disabled={analyzing}>{editor.invoiceAnalysis?.items.length ? `Confirmar e ingresar ${editor.invoiceAnalysis.items.length} producto(s)` : editor.stockEntry ? 'Confirmar e ingresar a stock' : 'Guardar repuesto'}</Button><Button type="button" variant="secondary" onClick={() => setEditor(null)}>Cancelar</Button></div>
    </form>}

    <p className="inventory-count">{inventory.length} producto{inventory.length === 1 ? '' : 's'}</p>
    {!inventory.length ? <Empty>Aún no hay productos registrados. Agrega el primero para comenzar el catálogo.</Empty> : <div className="inventory-grid">
      {inventory.map(item => <article className={`inventory-card stock-${item.stock_estado.toLowerCase()}`} key={item.id}>
        {item.foto_url ? <img className="inventory-photo" src={item.foto_url} alt={`Foto de ${item.nombre}`} loading="lazy" /> : <div className="inventory-photo inventory-photo-empty" aria-hidden="true">Sin foto</div>}
        <div className="inventory-card-body">
          <div className="inventory-card-heading"><span className={`stock-light stock-light-${item.stock_estado.toLowerCase()}`} aria-hidden="true" /><span className="inventory-category">{item.categoria}</span><span className={`stock-label stock-label-${item.stock_estado.toLowerCase()}`}>{item.stock_estado === 'CRITICO' ? 'Crítico' : item.stock_estado === 'BAJO' ? 'Próximo al mínimo' : 'Adecuado'}</span></div>
          <h3>{item.nombre}</h3>
          <p className="inventory-location">Estante: <strong>{item.ubicacion}</strong></p>
          {item.codigo_qr && <p className="inventory-code">Código: {item.codigo_qr}</p>}
          <p className="inventory-stock"><strong>{item.stock_actual}</strong><span> unidades</span><small>Mínimo: {item.stock_minimo}</small></p>
          <p className="inventory-location">Costo unitario: <strong>{item.costo_unitario === null ? 'Sin registrar' : money(item.costo_unitario)}</strong></p>
          <div className="inventory-card-links">
            {canEdit && <Button variant="secondary" onClick={() => setEditor({ item })}>Editar</Button>}
            {canEdit && <Button variant="danger" onClick={() => setDeletion(item)}>Eliminar</Button>}
          </div>
        </div>
      </article>)}
    </div>}

    {deletion && <div className="inventory-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="inventory-delete-title">
      <div className="inventory-dialog-card"><h3 id="inventory-delete-title">Eliminar repuesto</h3><p>¿Eliminar {deletion.nombre}? Si tiene movimientos asociados, el sistema conservará su historial y no permitirá borrarlo.</p><div className="actions"><Button variant="danger" onClick={async () => { if (await perform(() => request('delete', `/api/inventario/repuestos/${deletion.id}`), 'Repuesto eliminado.')) setDeletion(null) }}>Confirmar eliminación</Button><Button variant="secondary" onClick={() => setDeletion(null)}>Cancelar</Button></div></div>
    </div>}

  </section>
}

export default Inventory
