import { useCallback, useEffect, useState } from 'react'
import { request, download } from '../api'
import { dateTime, qty, withUnit } from '../format'
import { Button, Empty, Field, Section, Stat, Table } from './UI'

const TIPOS = { entrada: ['↑', 'Entrada'], salida: ['↓', 'Salida'], ajuste: ['⇄', 'Ajuste'] }

// Entradas y salidas del inventario: todo lo que entra (compras, cargas) y sale (OT, retiros) con motivo, camión y quién.
// El supervisor registra a mano lo que entra sin compra en el sistema o sale sin OT.
export default function Movements({ role, parts, trucks, onAction, onOpenTask, focus, onFocus }) {
  const [filters, setFilters] = useState({ desde: '', hasta: '', tipo: '' })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)
  const manages = ['admin', 'encargado'].includes(role)
  const query = () => {
    const both = filters.desde && filters.hasta
    return new URLSearchParams(Object.entries({ desde: both ? filters.desde : '', hasta: both ? filters.hasta : '', tipo: filters.tipo, repuesto: focus || '' }).filter(([, v]) => v)).toString()
  }
  const q = query()
  const load = useCallback(() => request('get', `/api/inventario/movimientos${q ? `?${q}` : ''}`).then(r => { setData(r.movimientos); setError('') }).catch(() => setError('No pudimos cargar las entradas y salidas.')), [q])
  // Cada acción del panel recarga los repuestos: con eso también se recargan los movimientos.
  useEffect(() => { load() }, [load, parts])
  const part = parts.find(p => p.id === Number(focus))
  const selected = form && parts.find(p => p.id === Number(form.id_repuesto))
  const save = async event => {
    event.preventDefault()
    if (await onAction(() => request('post', '/api/inventario/movimientos', form), r => r.mensaje)) setForm(null)
  }
  const sum = tipo => (data || []).filter(m => m.tipo === tipo).length

  return <Section id="movimientos" title={part ? `Entradas y salidas · ${part.nombre}` : 'Entradas y salidas'} action={<div className="actions">
    {manages && !form && <><Button variant="secondary" onClick={() => setForm({ tipo: 'entrada', id_repuesto: focus || '', cantidad: '', motivo: '', patente: '' })}>↑ Registrar entrada</Button>
      <Button variant="secondary" onClick={() => setForm({ tipo: 'salida', id_repuesto: focus || '', cantidad: '', motivo: '', patente: '' })}>↓ Registrar salida</Button></>}
    <Button variant="secondary" onClick={() => onAction(() => download(`/api/inventario/movimientos/excel${q ? `?${q}` : ''}`, 'movimientos_inventario.xlsx'), 'Movimientos descargados en Excel.')}>Descargar Excel</Button>
  </div>}>
    <p className="section-description">Todo lo que entra y sale de bodega queda aquí: las salidas de las OT y las compras se registran solas; lo que entra sin compra o sale sin OT se registra con «Registrar entrada» o «Registrar salida». Sin fechas se muestran los últimos 31 días.</p>
    {form && <form className="editor" onSubmit={save}>
      <h3>{form.tipo === 'entrada' ? 'Registrar entrada' : 'Registrar salida'}</h3>
      <div className="form-grid">
        <Field label="Repuesto" as="select" required value={form.id_repuesto} onChange={e => setForm({ ...form, id_repuesto: e.target.value })}>
          <option value="">Elegir…</option>{parts.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.codigo ? ` · ${p.codigo}` : ''} (hay {qty(p.stock)})</option>)}
        </Field>
        <Field label={selected ? `Cantidad (${selected.unidad})` : 'Cantidad'} type="number" min="0.01" step="0.01" inputMode="decimal" required value={form.cantidad} onChange={e => setForm({ ...form, cantidad: e.target.value })} />
        <Field label="Motivo" required maxLength={250} value={form.motivo} placeholder={form.tipo === 'entrada' ? 'Ej.: Llegó pedido de Indura, guía 4521' : 'Ej.: Aceite para rellenar el camión 44'} onChange={e => setForm({ ...form, motivo: e.target.value })} />
        {form.tipo === 'salida' && <Field label="Camión (opcional)" as="select" value={form.patente} onChange={e => setForm({ ...form, patente: e.target.value })}>
          <option value="">Sin camión</option>{trucks.map(t => <option key={t.patente} value={t.patente}>{t.patente}{t.numero ? ` · N° ${t.numero}` : ''}</option>)}
        </Field>}
      </div>
      {selected && form.tipo === 'salida' && Number(form.cantidad) > Number(selected.stock) && <p className="field-hint warning">Solo hay {withUnit(selected.stock, selected.unidad)}.</p>}
      <div className="actions"><Button type="submit" disabled={!form.id_repuesto || !(Number(form.cantidad) > 0) || !form.motivo.trim() || (form.tipo === 'salida' && Number(form.cantidad) > Number(selected?.stock))}>Guardar {form.tipo}</Button>
        <Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button></div>
    </form>}
    <div className="task-filters fuel-filters">
      <Field label="Desde" type="date" value={filters.desde} onChange={e => setFilters({ ...filters, desde: e.target.value })} />
      <Field label="Hasta" type="date" value={filters.hasta} onChange={e => setFilters({ ...filters, hasta: e.target.value })} />
      <Field label="Repuesto" as="select" value={focus || ''} onChange={e => onFocus(e.target.value)}><option value="">Todos</option>{parts.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Field>
    </div>
    <div className="chip-row" role="group" aria-label="Tipo de movimiento">
      {[['', 'Todos'], ...Object.entries(TIPOS).map(([k, [icon, label]]) => [k, `${icon} ${label}s`])].map(([k, label]) => <button type="button" key={k} className="chip" aria-pressed={filters.tipo === k} onClick={() => setFilters({ ...filters, tipo: k })}>{label}</button>)}
    </div>
    {error ? <div role="alert" className="notice notice-error"><span>{error}</span><Button variant="secondary" onClick={load}>Reintentar</Button></div>
      : !data ? <div className="loading-state" role="status"><span className="spinner" />Cargando movimientos…</div>
      : <>
        <div className="fleet-kpi-grid movement-stats">
          <Stat className="mov-entrada" label="↑ Entradas" value={sum('entrada')} hint="En el período" />
          <Stat className="mov-salida" label="↓ Salidas" value={sum('salida')} hint="En el período" />
          <Stat label="⇄ Ajustes" value={sum('ajuste')} hint="Correcciones del stock" />
        </div>
        {data.length ? <Table label="Entradas y salidas del inventario" headings={['Fecha', 'Movimiento', 'Repuesto', 'Cantidad', 'Queda', 'Motivo', 'Camión', 'Registró']}>
          {data.map(m => <tr key={m.id}>
            <td>{dateTime(m.fecha)}</td>
            <td><span className={`mov-tag mov-${m.tipo}`}><span aria-hidden="true">{TIPOS[m.tipo][0]}</span> {TIPOS[m.tipo][1]}</span></td>
            <td>{m.id_repuesto && Number(focus) !== m.id_repuesto ? <button type="button" className="text-link" onClick={() => onFocus(String(m.id_repuesto))}>{m.repuesto}</button> : m.repuesto}</td>
            <td className={`num mov-qty mov-${m.cantidad > 0 ? 'entrada' : 'salida'}`}>{m.cantidad > 0 ? '+' : '−'}{withUnit(Math.abs(m.cantidad), m.unidad)}</td>
            <td className="num">{qty(m.stock_despues)}</td>
            <td>{m.id_tarea && onOpenTask ? <button type="button" className="text-link" onClick={() => onOpenTask(m.id_tarea)}>{m.motivo}</button> : m.motivo}</td>
            <td>{m.patente || '—'}</td>
            <td>{m.usuario || 'Sistema'}</td>
          </tr>)}
        </Table> : <Empty>Sin movimientos en el período.</Empty>}
      </>}
  </Section>
}
