import { useCallback, useEffect, useState } from 'react'
import { request } from '../api'
import { date, periods } from '../format'
import { Button, Empty, Section, Table } from './UI'

const HOW = {
  disponibilidad: 'Días-camión del período sin una OT correctiva abierta (toda la flota).',
  a_tiempo: 'De las OT cerradas o ya vencidas, cuántas se terminaron antes de su fecha límite y sin aplazamientos. Una OT abierta que pasó su fecha cuenta como atrasada.',
  sin_reincidencia: 'OT correctivas que no volvieron (mismo trabajo y camión en 30 días) ni fueron devueltas por el supervisor.',
  checklists: 'OT cerradas que salieron de taller con su checklist lleno (la hoja «Check List - Mantenimiento»).',
  preventivas: 'Lo mismo que «a tiempo», solo para las OT preventivas.',
  diagnostico_24h: 'OT iniciadas por el mecánico dentro de 24 h desde que se crearon.',
}
const SHORT = { disponibilidad: 'Disponibilidad', a_tiempo: 'A tiempo', sin_reincidencia: 'Sin reincidencia', checklists: 'Checklists', preventivas: 'Preventivas', diagnostico_24h: 'Diagnóstico <24 h' }
const pct = m => m?.valor == null ? '—' : `${Math.round(m.valor * 100)}%`
const band = n => n == null ? ['Sin puntaje aún', 'none'] : n >= 85 ? ['Bueno', 'good'] : n >= 70 ? ['Regular', 'mid'] : ['Bajo', 'low']

// KPI ponderados de los mecánicos (vista del jefe).
export default function MechanicKpis({ live = 0, onShowTasks }) {
  const jump = id => document.getElementById(id)?.scrollIntoView({ block: 'start' })
  const [range, setRange] = useState(() => { const [, s, e] = periods()[1]; return { desde: s, hasta: e } })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => request('get', `/api/kpis/mecanicos?desde=${range.desde}&hasta=${range.hasta}`)
    .then(r => { setData(r); setError('') }).catch(e => setError(e.response?.data?.mensaje || 'No pudimos calcular los KPI.')), [range])
  useEffect(() => { load() }, [load, live])
  const keys = data?.pesos || []
  const [label, tone] = band(data?.equipo.puntaje)
  return <>
    <Section id="desempeno" title="Desempeño de mecánicos">
      <p className="section-description">Puntaje de 0 a 100 según los pesos definidos. Solo hay puntaje cuando el mecánico tiene OT cerradas o vencidas en el período; los indicadores sin datos no se cuentan y el puntaje se calcula sobre el peso que sí se pudo medir.</p>
      <div className="chip-row" role="group" aria-label="Período">{periods().filter(([l]) => l !== 'Año anterior').map(([l, desde, hasta]) => <button type="button" key={l} className="chip" aria-pressed={range.desde === desde && range.hasta === hasta} onClick={() => setRange({ desde, hasta })}>{l}</button>)}</div>
      {error ? <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={load}>Reintentar</Button></div>
        : !data ? <div className="loading-state" role="status"><span className="spinner" />Calculando…</div> : <>
          <p className="detail-meta">Del {date(data.desde)} al {date(data.hasta)} · {data.equipo.ot_cerradas} OT cerradas · {data.equipo.ot_abiertas} abiertas{data.equipo.ot_vencidas ? ` (${data.equipo.ot_vencidas} vencidas)` : ''}</p>
          <div className="kpi-team">
            <button type="button" className={`kpi-score kpi-${tone}`} onClick={() => jump('por-mecanico')} aria-label={`Puntaje del equipo ${data.equipo.puntaje ?? 'sin datos'}: ver por mecánico`}><span>Equipo ›</span><strong>{data.equipo.puntaje ?? '—'}</strong><small>{data.equipo.puntaje == null ? 'Aún no hay OT cerradas ni vencidas en el período' : `${label}${data.equipo.peso_medido < 100 ? ` · sobre ${data.equipo.peso_medido}% medido` : ''}`}</small></button>
            <ul className="kpi-bars">{keys.map(k => { const m = data.equipo.metricas[k.key]; return <li key={k.key}>
              <div><button type="button" className="text-link" aria-label={`Cómo se calcula: ${k.nombre}`} onClick={() => jump(`como-${k.key}`)}>{k.nombre}</button><b>{pct(m)}</b></div>
              <span className="kpi-bar"><span style={{ width: `${m?.valor == null ? 0 : Math.round(m.valor * 100)}%` }} /></span>
              <small>Peso {k.peso}%{m?.total ? ` · ${m.ok} de ${m.total}` : m?.sin_fuente ? ' · sin datos aún' : ' · sin casos en el período'}</small>
            </li> })}</ul>
          </div>
        </>}
    </Section>
    {data && <Section id="por-mecanico" title="Por mecánico">
      {data.mecanicos.length ? <Table label="KPI por mecánico" headings={['Mecánico', 'Puntaje', 'OT cerradas', 'Abiertas (vencidas)', ...keys.map(k => `${SHORT[k.key]} ${k.peso}%`)]}>
        {data.mecanicos.map(m => { const [l, t] = band(m.puntaje); return <tr key={m.id}>
          <td><strong><button type="button" className="text-link" aria-label={`Ver tareas de ${m.nombre}`} onClick={() => onShowTasks?.(m.nombre)}>{m.nombre}</button></strong></td>
          <td><span className={`kpi-pill kpi-${t}`}>{m.puntaje ?? '—'} · {l}</span></td>
          <td className="num">{m.ot_cerradas ? <button type="button" className="text-link" aria-label={`Ver tareas de ${m.nombre}`} onClick={() => onShowTasks?.(m.nombre)}>{m.ot_cerradas}</button> : 0}</td>
          <td className="num">{m.ot_abiertas}{m.ot_vencidas ? <small className="overdue">{m.ot_vencidas} vencida{m.ot_vencidas === 1 ? '' : 's'}</small> : null}</td>
          {keys.map(k => { const v = m.metricas[k.key]; return <td key={k.key} className="num">{pct(v)}{v?.total ? <small className="detail-meta">{v.ok}/{v.total}</small> : null}</td> })}
        </tr> })}
      </Table> : <Empty>No hay mecánicos registrados.</Empty>}
    </Section>}
    <Section id="como-se-calcula" title="Cómo se calcula">
      <ul className="kpi-how">{(data?.pesos || []).map(k => <li key={k.key} id={`como-${k.key}`}><strong>{k.nombre} · {k.peso}%</strong><span>{HOW[k.key]}</span></li>)}</ul>
      <p className="detail-meta">Bueno: 85 o más · Regular: 70 a 84 · Bajo: menos de 70. Los tiempos de diagnóstico se miden desde el 12-11-2026, cuando empezó a guardarse el historial de cada OT.</p>
    </Section>
  </>
}
