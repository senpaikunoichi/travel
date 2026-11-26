import { useCallback, useEffect, useState } from 'react'
import { request, serverUrl } from '../api'
import { date, dateTime, qty, withUnit } from '../format'
import { Button, CaptureButton, Empty, Field, Section, Table } from './UI'

const missingOf = r => +(Number(r.esperado) - Number(r.contado)).toFixed(2)

// Revisión semanal del inventario (lunes a domingo): contar cada ítem con foto; lo que falte queda por aclarar (a mano, por ahora).
export default function InventoryCheck({ role, onAction, live = 0 }) {
  const [semana, setSemana] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [counting, setCounting] = useState(null)
  const [form, setForm] = useState({ contado: '', nota: '' })
  const [photo, setPhoto] = useState(null)
  const [clearing, setClearing] = useState(null)
  const [why, setWhy] = useState('')
  const manages = ['admin', 'encargado'].includes(role)
  const load = useCallback(() => request('get', `/api/inventario/revision${semana ? `?semana=${semana}` : ''}`)
    .then(r => { setData(r); setError('') }).catch(() => setError('No pudimos cargar la revisión de inventario.')), [semana])
  useEffect(() => { load() }, [load, live])
  if (error) return <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={load}>Reintentar</Button></div>
  if (!data) return <div className="loading-state" role="status"><span className="spinner" />Cargando revisión…</div>

  const today = data.semana === data.actual
  const range = `${date(data.semana).slice(0, 5)} al ${date(data.fin).slice(0, 5)}`
  const done = data.items.filter(i => i.revision).length
  const start = item => { setCounting(item.id_repuesto); setForm({ contado: String(Number(item.revision?.contado ?? item.stock)), nota: item.revision?.nota || '' }); setPhoto(null) }
  const short = item => form.contado !== '' && Number(form.contado) < Number(item.stock)
  const save = async (event, item) => {
    event.preventDefault()
    const body = new FormData()
    body.append('id_repuesto', item.id_repuesto); body.append('contado', form.contado)
    if (form.nota.trim()) body.append('nota', form.nota.trim())
    body.append('foto', photo)
    if (await onAction(() => request('post', '/api/inventario/revision', body, { timeout: 120000 }), r => r.mensaje)) { setCounting(null); await load() }
  }
  const clear = async (event, r) => {
    event.preventDefault()
    if (await onAction(() => request('put', `/api/inventario/revision/${r.id}/aclarar`, { aclaracion: why }), x => x.mensaje)) { setClearing(null); setWhy(''); await load() }
  }
  const photoLink = r => <a href={serverUrl + r.ruta_archivo} target="_blank" rel="noreferrer"><img className="fuel-thumb" src={serverUrl + r.ruta_archivo} alt={`Conteo de ${r.nombre}`} loading="lazy" /></a>

  return <>
    <Section id="revision-inventario" title={today ? `Revisión semanal de inventario · ${range}` : `Revisión de la semana del ${range}`} action={!today && <Button variant="secondary" onClick={() => setSemana('')}>Volver a esta semana</Button>}>
      <p className="section-description">Una vez por semana (de lunes a domingo) se cuenta y se fotografía cada ítem (por ejemplo, las 5 llaves juntas en una foto). Se puede hacer de a poco durante la semana. Si falta algo, anota qué pasó: queda en «Faltantes por aclarar». El stock no cambia solo.</p>
      {today && <p className="check-progress"><strong>{done} de {data.items.length}</strong> ítems revisados esta semana{data.items.length && done === data.items.length ? ' · revisión completa ✓' : ''}</p>}
      {data.items.length ? <ul className="quote-list">{data.items.map(item => {
        const r = item.revision, missing = r ? missingOf(r) : 0
        return <li key={item.id_repuesto} className="quote-card">
          <div className="quote-head"><strong>{item.nombre}</strong>
            <span className={`km-state ${!r ? 'km-pronto' : missing > 0 ? 'km-vencida' : 'km-ok'}`}>{!r ? 'Sin revisar' : missing > 0 ? `Faltan ${qty(missing)}` : 'Completo ✓'}</span></div>
          <p className="detail-meta">En el sistema: {withUnit(r ? r.esperado : item.stock, item.unidad)}{r ? ` · Contado: ${qty(r.contado)} · ${r.revisado_por || '—'} · ${dateTime(r.created_at)}` : ''}</p>
          {r?.nota && <p className="detail-meta">Qué pasó: {r.nota}</p>}
          {r?.aclarado ? <p className="detail-meta">Aclarado: {r.aclaracion}</p> : null}
          {r && photoLink(r)}
          {today && manages && counting !== item.id_repuesto && <div className="actions"><Button variant={r ? 'secondary' : 'primary'} onClick={() => start(item)}>{r ? 'Volver a contar' : 'Revisar'}</Button></div>}
          {counting === item.id_repuesto && <form className="editor" onSubmit={e => save(e, item)}>
            <Field label={`Cuántos hay (el sistema dice ${qty(item.stock)})`} type="number" min="0" step="0.01" inputMode="decimal" value={form.contado} onChange={e => setForm({ ...form, contado: e.target.value })} required />
            <div className="capture-row">
              <CaptureButton light accept="image/*" capture="environment" onFiles={([f]) => f && setPhoto(f)}>{photo ? 'Repetir foto' : 'Sacar foto'}</CaptureButton>
              <CaptureButton light accept="image/*" onFiles={([f]) => f && setPhoto(f)}>Elegir foto</CaptureButton>
            </div>
            {photo ? <ul className="file-chips"><li>Foto: {photo.name}<button type="button" aria-label="Quitar foto" onClick={() => setPhoto(null)}>×</button></li></ul> : <p className="detail-meta">La foto es obligatoria: que se vea todo lo que contaste.</p>}
            {short(item) && <p className="field-hint warning">Faltan {qty(Number(item.stock) - Number(form.contado))}. Anota qué pasó.</p>}
            <Field label={short(item) ? 'Qué pasó (obligatorio)' : 'Nota (opcional)'} as="textarea" rows={2} maxLength={1000} value={form.nota} placeholder="Ej.: Una llave la tenía el mecánico en el camión 44." onChange={e => setForm({ ...form, nota: e.target.value })} required={short(item)} />
            <div className="actions">
              <Button type="submit" disabled={!photo || form.contado === '' || (short(item) && !form.nota.trim())}>Guardar conteo</Button>
              <Button variant="secondary" onClick={() => setCounting(null)}>Cancelar</Button>
            </div>
          </form>}
        </li>
      })}</ul> : <Empty>{today ? 'No hay ítems con stock para revisar. Agrégalos en el inventario.' : 'Esa semana no se revisó el inventario.'}</Empty>}
    </Section>

    <Section id="faltantes-inventario" title="Faltantes por aclarar">
      <p className="section-description">Lo que faltó en una revisión. Cuando se sepa qué pasó (apareció, quién lo tenía, se repone), anótalo para cerrarlo.</p>
      {data.faltantes.length ? <ul className="quote-list">{data.faltantes.map(r => <li key={r.id} className="quote-card">
        <div className="quote-head"><strong>{r.nombre}</strong><span className="km-state km-vencida">Faltan {qty(missingOf(r))}</span></div>
        <p className="detail-meta">{date(r.fecha)} · el sistema decía {qty(r.esperado)}, se contaron {qty(r.contado)} · {r.revisado_por || '—'}</p>
        {r.nota && <p className="detail-meta">Qué pasó: {r.nota}</p>}
        {photoLink(r)}
        {clearing === r.id ? <form className="rejection-form" onSubmit={e => clear(e, r)}>
          <Field label="Cómo se aclaró" as="textarea" rows={2} maxLength={1000} value={why} placeholder="Ej.: Apareció en el camión 44 / se repone / responsable: …" onChange={e => setWhy(e.target.value)} required />
          <div className="actions"><Button type="submit" disabled={!why.trim()}>Marcar aclarado</Button><Button variant="secondary" onClick={() => setClearing(null)}>Cancelar</Button></div>
        </form> : <div className="actions"><Button variant="secondary" onClick={() => { setClearing(r.id); setWhy('') }}>Aclarar</Button></div>}
      </li>)}</ul> : <Empty>Sin faltantes pendientes.</Empty>}
    </Section>

    <Section title="Historial de revisiones">
      {data.historial.length ? <Table label="Historial de revisiones de inventario" headings={['Semana', 'Ítems revisados', 'Con faltante', 'Revisó']}>
        {data.historial.map(h => <tr key={h.semana}>
          <td><button type="button" className="text-link" onClick={() => { setSemana(h.semana === data.actual ? '' : h.semana); document.getElementById('revision-inventario')?.scrollIntoView({ block: 'start' }) }}>Semana del {date(h.semana)}</button></td>
          <td className="num">{h.revisados}</td>
          <td className="num">{Number(h.faltantes) ? <span className="overdue">{h.faltantes}</span> : 0}</td>
          <td>{h.revisado_por || '—'}</td>
        </tr>)}
      </Table> : <Empty>Aún no hay revisiones. La primera queda registrada al guardar el conteo de un ítem.</Empty>}
    </Section>
  </>
}
