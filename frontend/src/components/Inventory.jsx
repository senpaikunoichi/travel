import { useState } from 'react'
import { request, download } from '../api'
import { money, qty, UNITS, withUnit } from '../format'
import { Button, CaptureButton, Empty, Field, Section, Stat, Table } from './UI'
import InventoryCheck from './InventoryCheck'
import Movements from './Movements'

const blank = { nombre: '', codigo: '', unidad: 'unidad', stock: '0', stock_minimo: '0', precio_ref: '' }

export default function Inventory({ role, parts, trucks = [], onAction, onOpenTask, live = 0 }) {
  const [focus, setFocus] = useState('')
  const showMoves = id => { setFocus(id); setTimeout(() => document.getElementById('movimientos')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30) }
  const [editor, setEditor] = useState(null)
  const [search, setSearch] = useState('')
  const [only, setOnly] = useState('')
  const manages = ['admin', 'encargado'].includes(role)
  const low = parts.filter(p => Number(p.stock) <= Number(p.stock_minimo))
  const visible = parts.filter(p => (only !== 'bajo' || Number(p.stock) <= Number(p.stock_minimo)) && (only !== 'sin' || Number(p.stock) <= 0) && `${p.nombre} ${p.codigo || ''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))
  const save = async event => {
    event.preventDefault()
    const url = editor.id ? `/api/repuestos/${editor.id}` : '/api/repuestos'
    if (await onAction(() => request(editor.id ? 'put' : 'post', url, editor), r => r.mensaje)) setEditor(null)
  }
  const field = (name, label, extra = {}) => <Field label={label} value={editor[name] ?? ''} onChange={e => setEditor({ ...editor, [name]: e.target.value })} {...extra} />
  return <>
    <InventoryCheck role={role} onAction={onAction} live={live} />
    <div className="fleet-kpi-grid">
      {[['', 'Repuestos', parts.length, 'Ver todo el inventario'], ['bajo', 'Bajo el mínimo', low.length, low.length ? 'Revisa y cotiza la reposición' : 'Stock al día'], ['sin', 'Sin stock', parts.filter(p => Number(p.stock) <= 0).length, 'Repuestos agotados']].map(([key, label, value, hint]) =>
        <Stat key={label} label={label} value={value} hint={hint} pressed={only === key} onClick={() => { setOnly(only === key ? '' : key); document.getElementById('inventario')?.scrollIntoView({ block: 'start' }) }} />)}
    </div>
    <Section id="inventario" title={only === 'bajo' ? 'Repuestos bajo el mínimo' : only === 'sin' ? 'Repuestos sin stock' : 'Inventario de repuestos'} action={<div className="actions">
      {only && <Button variant="secondary" onClick={() => setOnly('')}>Ver todos</Button>}
      <Button variant="secondary" onClick={() => showMoves('')}>Entradas y salidas</Button>
      <Button variant="secondary" onClick={() => onAction(() => download('/api/repuestos/excel', 'inventario.xlsx'), 'Inventario descargado en Excel.')}>Descargar Excel</Button>
      {manages && <CaptureButton variant="secondary" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onFiles={([file]) => {
        if (!file) return
        const body = new FormData()
        body.append('archivo', file)
        onAction(() => request('post', '/api/repuestos/excel', body, { timeout: 120000 }), r => r.mensaje)
      }}>Subir Excel</CaptureButton>}
      {manages && <Button onClick={() => setEditor({ ...blank })}>+ Agregar repuesto</Button>}
    </div>}>
      {manages && <p className="section-description">Para cargar todo el inventario de una vez, descarga el Excel, complétalo (Código, Nombre, Unidad, Stock, Stock mínimo, Precio referencia) y súbelo. Los repuestos se actualizan por código, o por nombre si no tienen código, y los nuevos se agregan.</p>}
      {editor && <form className="editor" onSubmit={save}>
        <h3>{editor.id ? 'Editar repuesto' : 'Agregar repuesto'}</h3>
        <div className="form-grid">
          {field('nombre', 'Nombre', { required: true, maxLength: 120 })}
          {field('codigo', 'Código (opcional)', { maxLength: 50 })}
          <Field label="Unidad" as="select" value={UNITS.includes(editor.unidad) ? editor.unidad : 'otra'} onChange={e => setEditor({ ...editor, unidad: e.target.value === 'otra' ? '' : e.target.value })}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}<option value="otra">Otra…</option>
          </Field>
          {!UNITS.includes(editor.unidad) && field('unidad', 'Otra unidad', { maxLength: 20, placeholder: 'Ej.: rollo', required: true, pattern: '.*[A-Za-zÁÉÍÓÚáéíóúÑñ].*', title: 'Escribe una palabra, no una cantidad' })}
          {field('precio_ref', 'Precio de referencia (opcional)', { type: 'number', min: 1, step: 1, inputMode: 'numeric' })}
          {field('stock', editor.id ? 'Stock actual (si lo cambias queda como ajuste)' : 'Stock inicial', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal', required: true })}
          {field('stock_minimo', 'Stock mínimo', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal' })}
        </div>
        <div className="actions"><Button type="submit">Guardar</Button><Button variant="secondary" onClick={() => setEditor(null)}>Cancelar</Button></div>
      </form>}
      {parts.length > 0 && <div className="task-filters"><Field label="Buscar repuesto" type="search" placeholder="Nombre o código" value={search} onChange={e => setSearch(e.target.value)} /></div>}
      {visible.length ? <Table label="Inventario" headings={['Repuesto', 'Código', 'Stock', 'Mínimo', 'Precio ref.', 'Acciones']}>
        {visible.map(p => <tr key={p.id}>
          <td><strong>{p.nombre}</strong>{Number(p.stock) <= Number(p.stock_minimo) && <small className="overdue">{Number(p.stock) <= 0 ? 'Sin stock' : 'Bajo el mínimo'}</small>}</td>
          <td>{p.codigo || '—'}</td>
          <td className="num">{withUnit(p.stock, p.unidad)}</td>
          <td className="num">{qty(p.stock_minimo)}</td>
          <td className="num">{p.precio_ref ? money(p.precio_ref) : '—'}</td>
          <td><div className="actions">
            <Button variant="secondary" onClick={() => showMoves(String(p.id))}>Movimientos</Button>
            {manages && <Button variant="secondary" onClick={() => setEditor({ ...p, codigo: p.codigo || '', precio_ref: p.precio_ref ? Number(p.precio_ref) : '', stock: Number(p.stock), stock_minimo: Number(p.stock_minimo) })}>Editar</Button>}
          </div></td>
        </tr>)}
      </Table> : <Empty>{only && !search ? 'Ningún repuesto en esta situación.' : parts.length ? 'No hay repuestos que coincidan.' : 'El inventario está vacío. Agrega los repuestos para asignarlos al crear tareas.'}</Empty>}
    </Section>
    <Movements role={role} parts={parts} trucks={trucks} onAction={onAction} onOpenTask={onOpenTask} focus={focus} onFocus={setFocus} />
  </>
}
