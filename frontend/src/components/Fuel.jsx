import { useCallback, useEffect, useState } from 'react'
import { request, serverUrl, download } from '../api'
import { date, dateTime, fuelPeriods } from '../format'
import { Button, Empty, Field, Section, Table } from './UI'

const LEVELS = [[10, 'Reserva'], [25, '¼'], [50, '½'], [75, '¾'], [100, 'Lleno']]
const levelName = n => LEVELS.find(([v]) => v === Number(n))?.[1] || `${n}%`

function Level({ value }) {
  return <span className="fuel-level"><span className="fuel-bar" aria-hidden="true"><span style={{ width: `${value}%` }} className={Number(value) <= 25 ? 'low' : ''} /></span>{levelName(value)}</span>
}

// Combustible con que llega cada camión: lo registra solo el conductor al terminar la ruta en TTS (foto del tablero).
export default function Fuel({ role, trucks, onAction, live = 0 }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ desde: '', hasta: '', patente: '' })
  const [reportDay, setReportDay] = useState('')
  const [truckReport, setTruckReport] = useState({ patente: '', desde: '', hasta: '' })
  const load = useCallback(() => {
    // El período se aplica solo con las dos fechas; sin ellas, los últimos 31 días.
    const both = filters.desde && filters.hasta
    const q = new URLSearchParams(Object.entries({ ...filters, desde: both ? filters.desde : '', hasta: both ? filters.hasta : '' }).filter(([, v]) => v)).toString()
    return request('get', `/api/combustible${q ? `?${q}` : ''}`).then(r => { setData(r); setError('') }).catch(e => setError(e.response?.data?.mensaje || 'No pudimos cargar los registros de combustible.'))
  }, [filters])
  useEffect(() => { load() }, [load, live])
  if (error) return <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={load}>Reintentar</Button></div>
  if (!data) return <div className="loading-state" role="status"><span className="spinner" />Cargando combustible…</div>
  const todayRows = data.registros.filter(r => r.fecha === data.hoy)
  // Informe del día: completo cuando todos los camiones tienen al menos un registro ese día.
  const day = reportDay || data.hoy
  const missingOn = trucks.filter(t => !data.registros.some(r => r.fecha === day && r.patente === t.patente))
  const pdf = (query, name) => onAction(() => download(`/api/combustible/informe?${query}`, name), 'Informe descargado.')
  const showTruck = patente => { setFilters(f => ({ ...f, patente })); document.getElementById('historial-combustible')?.scrollIntoView({ block: 'start' }) }
  return <>
    <Section id="combustible" title={`Combustible de hoy · ${date(data.hoy)}`}>
      <p className="section-description">Con cuánto combustible llega cada camión de su ruta. El conductor lo registra al terminar la ruta en TTS (foto del tablero; la IA lee el nivel) y aparece aquí solo, en unos minutos.</p>
      <div className="fuel-today">{trucks.map(t => {
        const rows = todayRows.filter(r => r.patente === t.patente)
        return <div key={t.patente} className={`fuel-truck ${rows.length ? 'done' : ''}`}>
          <div><strong><button type="button" className="text-link" aria-label={`Ver historial de ${t.patente}`} onClick={() => showTruck(t.patente)}>{t.patente}</button></strong><small className="detail-meta">{t.numero ? `N° ${t.numero} · ` : ''}{t.modelo}</small></div>
          {rows.length ? <ul>{rows.map(r => <li key={r.id}><Level value={r.nivel} /> <span className="detail-meta">{r.ruta}{r.conductor ? ` · ${r.conductor}` : ''}</span></li>)}</ul> : <span className="fuel-missing">Sin ruta terminada hoy</span>}
        </div>
      })}</div>
      <div className="fuel-report">
        <Field label="Informe del día" type="date" max={data.hoy} value={day} onChange={e => setReportDay(e.target.value)} />
        {missingOn.length
          ? <><p className="detail-meta">Faltan {missingOn.length} camión{missingOn.length === 1 ? '' : 'es'}: {missingOn.map(t => t.patente).join(', ')}.</p>
            <Button variant="secondary" onClick={() => pdf(`fecha=${day}`, `combustible_${day}.pdf`)}>Descargar igual (PDF)</Button></>
          : <Button onClick={() => pdf(`fecha=${day}`, `combustible_${day}.pdf`)}>Descargar informe del día (PDF)</Button>}
      </div>
    </Section>
    <Section title="Informe por camión">
      <p className="section-description">Elige el camión y el período: por ejemplo, el N° 44 toda la semana.</p>
      <div className="fuel-truck-report">
        <Field label="Camión" as="select" value={truckReport.patente} onChange={e => setTruckReport({ ...truckReport, patente: e.target.value })}>
          <option value="">Elegir camión…</option>
          {[...trucks].sort((a, b) => (Number(a.numero) || 9999) - (Number(b.numero) || 9999) || a.patente.localeCompare(b.patente)).map(t => <option key={t.patente} value={t.patente}>{t.numero ? `N° ${t.numero} · ` : ''}{t.patente}{t.modelo ? ` · ${t.modelo}` : ''}</option>)}
        </Field>
        <div className="chip-row" role="group" aria-label="Período">{fuelPeriods(data.hoy).map(([label, desde, hasta]) => <button type="button" key={label} className="chip" aria-pressed={truckReport.desde === desde && truckReport.hasta === hasta} onClick={() => setTruckReport({ ...truckReport, desde, hasta })}>{label}</button>)}</div>
        <div className="form-grid">
          <Field label="Desde" type="date" max={data.hoy} value={truckReport.desde} onChange={e => setTruckReport({ ...truckReport, desde: e.target.value })} />
          <Field label="Hasta" type="date" max={data.hoy} value={truckReport.hasta} onChange={e => setTruckReport({ ...truckReport, hasta: e.target.value })} />
        </div>
        {truckReport.desde && truckReport.hasta && truckReport.desde > truckReport.hasta && <p className="field-hint warning">La fecha «Desde» debe ser anterior a «Hasta».</p>}
        <Button disabled={!truckReport.patente || !truckReport.desde || !truckReport.hasta || truckReport.desde > truckReport.hasta}
          onClick={() => pdf(`patente=${encodeURIComponent(truckReport.patente)}&desde=${truckReport.desde}&hasta=${truckReport.hasta}`, `combustible_${truckReport.patente}_${truckReport.desde}_${truckReport.hasta}.pdf`)}>
          Descargar PDF{truckReport.patente ? ` de ${truckReport.patente}` : ''}
        </Button>
      </div>
    </Section>
    <Section id="historial-combustible" title="Historial de combustible">
      <div className="task-filters fuel-filters">
        <Field label="Desde" type="date" value={filters.desde} onChange={e => setFilters({ ...filters, desde: e.target.value })} />
        <Field label="Hasta" type="date" value={filters.hasta} onChange={e => setFilters({ ...filters, hasta: e.target.value })} />
        <Field label="Camión" as="select" value={filters.patente} onChange={e => setFilters({ ...filters, patente: e.target.value })}><option value="">Todos</option>{trucks.map(t => <option key={t.patente} value={t.patente}>{t.patente}</option>)}</Field>
      </div>
      {filters.patente && <div className="fuel-report">
        <p className="detail-meta">Informe de {filters.patente} {filters.desde && filters.hasta ? `del ${filters.desde.split('-').reverse().join('-')} al ${filters.hasta.split('-').reverse().join('-')}` : 'de los últimos 30 días'}.</p>
        <Button variant="secondary" onClick={() => pdf(`patente=${encodeURIComponent(filters.patente)}${filters.desde && filters.hasta ? `&desde=${filters.desde}&hasta=${filters.hasta}` : ''}`, `combustible_${filters.patente}.pdf`)}>Informe del camión (PDF)</Button>
      </div>}
      {(filters.desde && !filters.hasta) || (!filters.desde && filters.hasta) ? <p className="detail-meta">Elige las dos fechas para filtrar por período. Sin fechas se muestran los últimos 31 días.</p> : null}
      {data.registros.length ? <Table label="Historial de combustible" headings={['Fecha', 'Camión', 'Ruta', 'Nivel', 'Estado del camión', 'Foto', ...(role === 'admin' ? [''] : [])]}>
        {data.registros.map(r => <tr key={r.id}>
          <td>{date(r.fecha)}<small className="detail-meta">{r.registrado_por} · {dateTime(r.created_at)}</small></td>
          <td><strong>{filters.patente === r.patente ? r.patente : <button type="button" className="text-link" aria-label={`Ver solo ${r.patente}`} onClick={() => showTruck(r.patente)}>{r.patente}</button>}</strong></td>
          <td>{r.ruta}</td>
          <td><Level value={r.nivel} /></td>
          <td>{r.nota}</td>
          <td><a href={serverUrl + r.ruta_archivo} target="_blank" rel="noreferrer"><img className="fuel-thumb" src={serverUrl + r.ruta_archivo} alt={`Indicador de ${r.patente}`} loading="lazy" /></a></td>
          {role === 'admin' && <td><Button variant="danger" onClick={() => window.confirm(`¿Eliminar el registro de ${r.patente} del ${date(r.fecha)}?`) && onAction(() => request('delete', `/api/combustible/${r.id}`), x => x.mensaje).then(ok => ok && load())}>Eliminar</Button></td>}
        </tr>)}
      </Table> : <Empty>Sin registros en el período.</Empty>}
    </Section>
  </>
}
