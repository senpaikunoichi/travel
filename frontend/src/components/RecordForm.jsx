import { useState } from 'react'
import { Field, Button } from './UI'

export default function RecordForm({ kind, initial, mechanics, trucks, showTaskPriority = false, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial || ({ truck: { patente: '', numero: '', modelo: '' }, user: { nombre: '', email: '', password: '', rol: 'mecanico' }, task: { tipo_tarea: '', patente_camion: '', fecha_limite: '', prioridad: 'Media', descripcion: '', mecanicos: [] } })[kind])
  const [error, setError] = useState('')
  const change = e => setForm({ ...form, [e.target.name]: e.target.value })
  const input = (name, label, type = 'text') => <Field label={label} name={name} type={type} value={form[name]} onChange={change} required minLength={type === 'password' ? 12 : undefined} readOnly={name === 'patente' && !!initial} autoComplete={type === 'password' ? 'new-password' : undefined} />
  return <form className="editor" onSubmit={e => {
    e.preventDefault()
    if (kind === 'task' && !form.mecanicos.length) { setError('Selecciona al menos un mecánico.'); return }
    onSubmit(form)
  }}>
    <h3>{initial ? 'Editar' : 'Agregar'} {({ truck: 'camión', user: 'usuario', task: 'tarea' })[kind]}</h3>
    <div className="form-grid">
      {kind === 'truck' && <>{input('patente', 'Patente')}{input('numero', 'Número')}{input('modelo', 'Modelo')}</>}
      {kind === 'user' && <>{input('nombre', 'Nombre')}{input('email', 'Email', 'email')}{initial ? <Field label="Nueva contraseña (opcional)" name="password" type="password" value={form.password || ''} onChange={change} minLength={12} autoComplete="new-password" placeholder="Dejar vacío para mantener la actual" /> : input('password', 'Contraseña', 'password')}<Field label="Rol" as="select" name="rol" value={form.rol} onChange={change}><option value="mecanico">Mecánico</option><option value="encargado">Encargado</option><option value="jefe">Jefe</option><option value="admin">Administrador</option></Field></>}
      {kind === 'task' && <>{input('tipo_tarea', 'Tipo de tarea')}<Field label="Camión" as="select" name="patente_camion" value={form.patente_camion} onChange={change} required><option value="">Selecciona un camión</option>{trucks.map(t => <option key={t.patente} value={t.patente}>{t.patente} · {t.modelo}</option>)}</Field>{input('fecha_limite', 'Fecha límite', 'date')}{showTaskPriority && <Field label="Prioridad" as="select" name="prioridad" value={form.prioridad || 'Media'} onChange={change}><option value="Alta">Alta</option><option value="Media">Media</option><option value="Baja">Baja</option></Field>}<fieldset className="mechanic-picker"><legend>Mecánicos asignados</legend>{mechanics.length ? mechanics.map(m => <label key={m.id}><input type="checkbox" checked={form.mecanicos.includes(m.id)} onChange={e => setForm({ ...form, mecanicos: e.target.checked ? [...form.mecanicos, m.id] : form.mecanicos.filter(id => id !== m.id) })} />{m.nombre}</label>) : <p>No hay mecánicos disponibles.</p>}</fieldset></>}
    </div>
    {kind === 'task' && <Field label="Descripción" as="textarea" name="descripcion" rows={3} value={form.descripcion} onChange={change} />}
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div className="actions"><Button type="submit" disabled={kind === 'task' && (!mechanics.length || !trucks.length)}>{initial ? 'Guardar cambios' : 'Guardar'}</Button><Button variant="secondary" onClick={onCancel}>Cancelar</Button></div>
  </form>
}
