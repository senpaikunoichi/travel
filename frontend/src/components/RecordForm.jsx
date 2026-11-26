import { useState } from 'react'
import { Field, Button } from './UI'
import { kinds, priorities, qty, km } from '../format'

const blank = {
  truck: { patente: '', numero: '', modelo: '', prioridad: 'media', km_actual: '' },
  user: { nombre: '', email: '', password: '', rol: 'mecanico', telefono: '' },
  task: { tipo_tarea: '', patente_camion: '', fecha_limite: '', descripcion: '', mecanicos: [], tipo_mantencion: 'correctiva', prioridad: 'media', kilometraje: '', repuestos: [] },
}

export default function RecordForm({ kind, initial, mechanics = [], trucks = [], parts = [], onSubmit, onCancel }) {
  const editing = !!initial?.id || (kind !== 'task' && !!initial)
  const [form, setForm] = useState({ ...blank[kind], ...initial })
  const [newPart, setNewPart] = useState({ id_repuesto: '', descripcion: '', cantidad: '1' })
  const [error, setError] = useState('')
  const change = e => setForm({ ...form, [e.target.name]: e.target.value })
  const input = (name, label, type = 'text', extra = {}) => <Field label={label} name={name} type={type} value={form[name] ?? ''} onChange={change} required minLength={type === 'password' ? 12 : undefined} readOnly={name === 'patente' && editing} autoComplete={type === 'password' ? 'new-password' : undefined} {...extra} />
  const partName = line => line.id_repuesto ? parts.find(p => p.id === Number(line.id_repuesto))?.nombre || line.nombre || 'Repuesto' : line.descripcion
  const addPart = () => {
    if (!newPart.id_repuesto && !newPart.descripcion.trim()) { setError('Elige un repuesto del inventario o escribe uno que no esté.'); return }
    if (!(Number(newPart.cantidad) > 0)) { setError('La cantidad debe ser mayor que cero.'); return }
    setError('')
    setForm({ ...form, repuestos: [...form.repuestos, { id_repuesto: newPart.id_repuesto ? Number(newPart.id_repuesto) : null, descripcion: newPart.id_repuesto ? null : newPart.descripcion.trim(), cantidad: newPart.cantidad, estado: 'pendiente' }] })
    setNewPart({ id_repuesto: '', descripcion: '', cantidad: '1' })
  }
  const selectedPart = parts.find(p => p.id === Number(newPart.id_repuesto))
  const truck = trucks.find(t => t.patente === form.patente_camion)

  return <form className="editor" onSubmit={e => {
    e.preventDefault()
    if (kind === 'task' && !form.mecanicos.length) { setError('Selecciona al menos un mecánico.'); return }
    onSubmit(form, []) // la foto de antes la sube el mecánico al abrir la tarea
  }}>
    <h3>{editing ? 'Editar' : 'Agregar'} {({ truck: 'camión', user: 'usuario', task: 'tarea' })[kind]}</h3>
    <div className="form-grid">
      {kind === 'truck' && <>
        {input('patente', 'Patente')}{input('numero', 'Número')}{input('modelo', 'Modelo')}
        <Field label="Prioridad del camión" as="select" name="prioridad" value={form.prioridad} onChange={change}><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></Field>
        {!editing && <Field label="Kilometraje actual (opcional)" name="km_actual" type="number" min="0" inputMode="numeric" value={form.km_actual ?? ''} onChange={change} />}
      </>}
      {kind === 'user' && <>
        {input('nombre', 'Nombre')}{input('email', 'Email', 'email')}
        {editing ? <Field label="Nueva contraseña (opcional)" name="password" type="password" value={form.password || ''} onChange={change} minLength={12} autoComplete="new-password" placeholder="Dejar vacío para mantener la actual" /> : input('password', 'Contraseña', 'password')}
        <Field label="Rol" as="select" name="rol" value={form.rol} onChange={change}><option value="mecanico">Mecánico</option><option value="encargado">Supervisor</option><option value="jefe">Jefe</option><option value="admin">Administrador</option></Field>
      </>}
      {kind === 'task' && <>
        {input('tipo_tarea', 'Trabajo a realizar', 'text', { placeholder: 'Ej.: Cambio de pastillas de freno' })}
        <Field label="Camión" as="select" name="patente_camion" value={form.patente_camion} onChange={e => {
          const next = trucks.find(t => t.patente === e.target.value)
          setForm({ ...form, patente_camion: e.target.value, kilometraje: form.kilometraje || next?.km_actual || '' })
        }} required><option value="">Selecciona un camión</option>{trucks.map(t => <option key={t.patente} value={t.patente}>{t.patente} · {t.modelo}{t.prioridad === 'alta' ? ' · prioridad alta' : ''}</option>)}</Field>
        <Field label="Tipo de mantención" as="select" name="tipo_mantencion" value={form.tipo_mantencion} onChange={change}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Field>
        <Field label="Prioridad" as="select" name="prioridad" value={form.prioridad} onChange={change}>{Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Field>
        <Field label={`Kilometraje${truck?.km_actual ? ` (último registrado: ${km(truck.km_actual)})` : ''}`} name="kilometraje" type="number" min="0" inputMode="numeric" value={form.kilometraje ?? ''} onChange={change} />
        {input('fecha_limite', 'Fecha límite', 'date')}
        <fieldset className="mechanic-picker"><legend>Mecánicos asignados</legend>{mechanics.length ? mechanics.map(m => <label key={m.id}><input type="checkbox" checked={form.mecanicos.includes(m.id)} onChange={e => setForm({ ...form, mecanicos: e.target.checked ? [...form.mecanicos, m.id] : form.mecanicos.filter(id => id !== m.id) })} />{m.nombre}</label>) : <p>No hay mecánicos disponibles.</p>}</fieldset>
      </>}
    </div>
    {kind === 'task' && <>
      <Field label="Descripción de la falla o del trabajo" as="textarea" name="descripcion" rows={3} value={form.descripcion || ''} onChange={change} />
      <fieldset className="part-picker">
        <legend>Repuestos necesarios</legend>
        {form.repuestos.length > 0 && <ul className="part-list">{form.repuestos.map((line, index) => <li key={line.id || `new-${index}`}>
          <span><strong>{partName(line)}</strong> × {qty(line.cantidad)}{!line.id_repuesto && <small> · fuera del inventario</small>}{line.estado && line.estado !== 'pendiente' && <small> · {line.estado}</small>}</span>
          {(!line.estado || line.estado === 'pendiente') && <Button variant="icon" aria-label={`Quitar ${partName(line)}`} onClick={() => setForm({ ...form, repuestos: form.repuestos.filter((_, i) => i !== index) })}>×</Button>}
        </li>)}</ul>}
        <div className="part-add">
          <Field label="Del inventario" as="select" value={newPart.id_repuesto} onChange={e => setNewPart({ ...newPart, id_repuesto: e.target.value, descripcion: '' })}>
            <option value="">Elegir repuesto…</option>
            {parts.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.codigo ? ` (${p.codigo})` : ''} · stock {qty(p.stock)}</option>)}
          </Field>
          {!newPart.id_repuesto && <Field label="O escribe uno que no esté" value={newPart.descripcion} maxLength={200} placeholder="Ej.: Correa alternador" onChange={e => setNewPart({ ...newPart, descripcion: e.target.value })} />}
          <Field label="Cantidad" type="number" min="0.01" step="0.01" inputMode="decimal" value={newPart.cantidad} onChange={e => setNewPart({ ...newPart, cantidad: e.target.value })} />
          <Button variant="soft" onClick={addPart}>Agregar repuesto</Button>
        </div>
        {selectedPart && Number(selectedPart.stock) < Number(newPart.cantidad) && <p className="field-hint warning">Stock insuficiente ({qty(selectedPart.stock)} {selectedPart.unidad}). El mecánico podrá pedir cotización.</p>}
      </fieldset>
    </>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div className="actions"><Button type="submit" disabled={kind === 'task' && (!mechanics.length || !trucks.length)}>{editing ? 'Guardar cambios' : kind === 'task' ? 'Crear y enviar al mecánico' : 'Guardar'}</Button><Button variant="secondary" onClick={onCancel}>Cancelar</Button></div>
  </form>
}
