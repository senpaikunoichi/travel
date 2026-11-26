import { useEffect, useState } from 'react'
import { request, serverUrl } from '../api'
import { money, date, dateTime, qty, kinds, priorities, km, partStates, quoteStates, isVideo } from '../format'
import { Button, Logo } from './UI'

const states = { Pendiente: 'Pendiente', En_Trabajo: 'En trabajo', Completada: 'En revisión', Aprobada: 'Aprobada' }

// Fotos del informe: impresas en pequeño; los videos van como enlace (no se pueden imprimir).
function Photos({ items, label }) {
  if (!items.length) return <p className="muted">Sin registros.</p>
  return <div className="report-photos">{items.map(item => isVideo(item.ruta_archivo)
    ? <a key={item.id} className="report-video" href={serverUrl + item.ruta_archivo} target="_blank" rel="noreferrer">▶ Video ({date(item.fecha)})</a>
    : <img key={item.id} src={serverUrl + item.ruta_archivo} alt={label} />)}</div>
}

// Informe completo de una OT para guardar o imprimir (Imprimir → Guardar como PDF).
export default function OtReport({ id, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    request('get', `/api/tareas/${id}/informe`).then(setData).catch(() => setError('No pudimos cargar el informe de la OT.'))
  }, [id])
  if (error) return <div className="ot-report"><p role="alert" className="notice notice-error">{error}</p><Button variant="secondary" onClick={onClose}>Volver</Button></div>
  if (!data) return <div className="ot-report"><p role="status" className="loading-state"><span className="spinner" />Preparando el informe…</p></div>
  const { tarea: t, repuestos, evidencias, cotizaciones, gastos, eventos } = data
  const ev = tipo => evidencias.filter(e => e.tipo === tipo)
  const total = gastos.reduce((sum, g) => sum + (Number(g.monto) || 0), 0)
  return <div className="ot-report">
    <div className="report-toolbar no-print">
      <Button variant="secondary" onClick={onClose}>← Volver</Button>
      <Button onClick={() => window.print()}>Imprimir o guardar PDF</Button>
    </div>
    <header className="report-header">
      <Logo full />
      <div><h1>Informe de OT #{t.id}</h1><p className="muted">Emitido el {dateTime(new Date().toISOString())}</p></div>
    </header>

    <section>
      <h2>Datos de la orden</h2>
      <dl className="report-facts">
        <div><dt>Trabajo</dt><dd>{t.tipo_tarea}</dd></div>
        <div><dt>Camión</dt><dd>{t.patente_camion}{t.numero ? ` · N° ${t.numero}` : ''} · {t.modelo}</dd></div>
        <div><dt>Estado</dt><dd>{states[t.estado] || t.estado}</dd></div>
        <div><dt>Tipo y prioridad</dt><dd>{kinds[t.tipo_mantencion] || 'Correctiva'} · {priorities[t.prioridad] || 'Media'}</dd></div>
        <div><dt>Kilometraje</dt><dd>{t.kilometraje ? km(t.kilometraje) : '—'}</dd></div>
        <div><dt>Mecánicos</dt><dd>{t.mecanicos_nombres || '—'}</dd></div>
        <div><dt>Creada</dt><dd>{date(t.fecha_creacion)}</dd></div>
        <div><dt>Fecha límite</dt><dd>{date(t.fecha_limite)}{t.veces_aplazada ? ` · aplazada ${t.veces_aplazada} vez/veces` : ''}</dd></div>
        <div><dt>Terminada</dt><dd>{t.fecha_completada ? date(t.fecha_completada) : '—'}</dd></div>
        <div><dt>Costo total</dt><dd><strong>{money(total)}</strong></dd></div>
      </dl>
      {t.descripcion && <p className="report-text"><strong>Descripción:</strong> {t.descripcion}</p>}
      {t.motivo_aplazamiento && <p className="report-text"><strong>Motivo del atraso:</strong> {t.motivo_aplazamiento}</p>}
      {t.nota_rechazo && <p className="report-text"><strong>Última corrección pedida:</strong> {t.nota_rechazo}</p>}
    </section>

    <section>
      <h2>Repuestos</h2>
      {repuestos.length ? <table><thead><tr><th>Repuesto</th><th>Cantidad</th><th>Estado</th><th>Por qué faltó (mecánico)</th></tr></thead><tbody>
        {repuestos.map(r => <tr key={r.id}><td>{r.nombre || r.descripcion}{r.codigo ? ` (${r.codigo})` : ''}</td><td className="num">{qty(r.cantidad)} {r.unidad || ''}</td><td>{partStates[r.estado]}</td><td>{r.motivo || '—'}</td></tr>)}
      </tbody></table> : <p className="muted">Sin repuestos.</p>}
      {ev('falla').length > 0 && <><h3>Evidencia del repuesto en mal estado</h3><Photos items={ev('falla')} label="Evidencia de falla" /></>}
    </section>

    <section>
      <h2>Cotizaciones y compras</h2>
      {cotizaciones.length ? <table><thead><tr><th>#</th><th>Qué se compra</th><th>Proveedor</th><th className="num">Monto</th><th>Estado</th><th>Cotizó / revisó</th><th>Documentos</th></tr></thead><tbody>
        {cotizaciones.map(c => <tr key={c.id}><td>{c.id}</td><td>{c.detalle}{c.cantidad ? ` × ${qty(c.cantidad)}` : ''}{c.nota_decision ? <small className="muted"><br />Nota: {c.nota_decision}</small> : null}</td><td>{c.proveedor}</td><td className="num">{money(c.monto)}{Number(c.excedente) > 0 ? <small className="muted"><br />+{money(c.excedente)} al límite</small> : null}</td><td>{quoteStates[c.estado]}</td><td>{c.creador || '—'} / {c.decisor || '—'}</td>
          <td className="report-docs">{c.ruta_archivo && <a href={serverUrl + c.ruta_archivo} target="_blank" rel="noreferrer">Cotización</a>}{c.ruta_comprobante && <a href={serverUrl + c.ruta_comprobante} target="_blank" rel="noreferrer">Comprobante</a>}{!c.ruta_archivo && !c.ruta_comprobante && '—'}</td></tr>)}
      </tbody></table> : <p className="muted">Sin cotizaciones.</p>}
      {ev('compra').length > 0 && <><h3>Lo que se compró</h3><Photos items={ev('compra')} label="Compra" /></>}
    </section>

    <section>
      <h2>Costos</h2>
      {gastos.length ? <table><thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Monto</th></tr></thead><tbody>
        {gastos.map(g => <tr key={g.id}><td>{date(g.fecha)}</td><td>{g.concepto}</td><td className="num">{g.monto == null ? '—' : money(g.monto)}</td></tr>)}
        <tr className="report-total"><td /><td>Total</td><td className="num">{money(total)}</td></tr>
      </tbody></table> : <p className="muted">Sin costos registrados.</p>}
    </section>

    <section>
      <h2>Antes y después</h2>
      <h3>Antes</h3><Photos items={ev('antes')} label="Antes" />
      <h3>Después</h3><Photos items={ev('foto')} label="Después" />
    </section>

    <section>
      <h2>Historial</h2>
      {eventos.length ? <table><thead><tr><th>Fecha</th><th>Quién</th><th>Qué pasó</th><th className="num">Monto</th></tr></thead><tbody>
        {eventos.map(e => <tr key={e.id}><td>{dateTime(e.created_at)}</td><td>{e.usuario || 'Sistema'}</td><td>{e.detalle}</td><td className="num">{e.monto == null ? '' : money(e.monto)}</td></tr>)}
      </tbody></table> : <p className="muted">Sin movimientos registrados (el historial se guarda desde el 12-11-2026).</p>}
    </section>
    <footer className="report-footer">Travel Trans Logística · Mantenimiento de flota · OT #{t.id}</footer>
  </div>
}
