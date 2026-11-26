import { useEffect, useState } from 'react'
import { request, serverUrl } from '../api'
import { date, dateTime, money } from '../format'
import Modal from './Modal'
import { Empty, Status } from './UI'

const inspectionLabels = {
  sin_cambios: 'Sin cambios',
  leve: 'Daño leve',
  moderado: 'Daño moderado',
  grave: 'Daño grave',
  inconcluso: 'Revisión manual',
}

export default function TruckProfile({ truck, inspections, onClose }) {
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const truckInspections = inspections
    .filter(inspection => inspection.patente_camion === truck.patente)
    .slice()
    .sort((a, b) => String(b.created_at || b.fecha).localeCompare(String(a.created_at || a.fecha)) || b.id - a.id)

  useEffect(() => {
    let active = true
    request('get', `/api/camiones/${encodeURIComponent(truck.patente)}/ficha`)
      .then(result => { if (active) setProfile(result) })
      .catch(cause => {
        if (active) setError(cause.response?.data?.mensaje || cause.message || 'No pudimos cargar la ficha del camión.')
      })
    return () => { active = false }
  }, [retry, truck.patente])

  return <Modal title={`Ficha del camión ${truck.numero}`} onClose={onClose}>
    <div className="modal-content truck-profile">
      <div className="section-heading">
        <div><p className="eyebrow">FICHA DE FLOTA</p><h2>{truck.numero} · {truck.modelo}</h2></div>
        <button type="button" className="button button-secondary truck-profile-close" onClick={onClose} aria-label="Cerrar ficha">×</button>
      </div>
      <p className="truck-profile-plate">{truck.patente}</p>
      <Status value={truck.estado_operativo === 'activo' ? 'Activo' : 'En_panne'} />
      {error ? <div role="alert" className="notice notice-error"><span>{error}</span><button type="button" className="button button-secondary" onClick={() => { setError(''); setProfile(null); setRetry(value => value + 1) }}>Reintentar</button></div>
        : !profile ? <p role="status" className="loading-state">Cargando ficha e historial…</p>
          : <>
            <div className="truck-profile-kpis">
              <article><span>Tareas registradas</span><strong>{profile.resumen.tareas}</strong></article>
              <article><span>Trabajos completados</span><strong>{profile.resumen.completadas}</strong></article>
              <article><span>Gastos registrados</span><strong>{money(profile.resumen.total_gastos)}</strong></article>
            </div>
            <section className="truck-profile-section">
              <div className="truck-profile-section-heading"><h3>Historial de mantenimiento y reparaciones</h3><span>{profile.tareas.length} registro{profile.tareas.length === 1 ? '' : 's'}</span></div>
              {profile.tareas.length ? <div className="truck-maintenance-list">
                {profile.tareas.map(task => <article className="truck-maintenance-card" key={task.id}>
                  <div className="truck-maintenance-heading"><div><h4>{task.tipo_tarea}</h4><span>Creada {date(task.fecha_creacion)}</span></div><Status value={task.estado} /></div>
                  {task.descripcion && <p className="truck-maintenance-description">{task.descripcion}</p>}
                  <div className="truck-maintenance-meta">
                    <span>Fecha límite: {date(task.fecha_limite)}</span>
                    <span>Finalizada: {task.fecha_completada ? date(task.fecha_completada) : 'Pendiente'}</span>
                    <span>Prioridad: {task.prioridad || 'Media'}</span>
                    <span>Mecánicos: {task.mecanicos || 'Sin asignar'}</span>
                  </div>
                  <div className="truck-maintenance-cost"><strong>Gastos de reparación</strong><span>{money(task.total_gasto)}</span></div>
                  {task.gastos.length > 0 && <ul className="truck-expense-list">{task.gastos.map(expense => <li key={expense.id}><span>{expense.concepto} · {date(expense.fecha)}</span><strong>{expense.monto == null ? 'Sin monto' : money(expense.monto)}</strong></li>)}</ul>}
                  {task.evidencias.length > 0 && <div className="truck-evidence-list" aria-label={`Evidencias de ${task.tipo_tarea}`}>
                    {task.evidencias.map(evidence => evidence.tipo === 'foto'
                      ? <a key={evidence.id} href={serverUrl + evidence.ruta_archivo} target="_blank" rel="noreferrer"><img loading="lazy" decoding="async" src={serverUrl + evidence.ruta_archivo} alt={`Evidencia: ${task.tipo_tarea}`} /><span>Foto · {date(evidence.fecha)}</span></a>
                      : <a className="truck-document-link" key={evidence.id} href={serverUrl + evidence.ruta_archivo} target="_blank" rel="noreferrer">Ver {evidence.tipo} · {date(evidence.fecha)} ↗</a>)}
                  </div>}
                </article>)}
              </div> : <Empty>Este camión aún no tiene tareas ni reparaciones registradas.</Empty>}
            </section>
          </>}
      <section className="truck-profile-section">
        <div className="truck-profile-section-heading"><h3>Historial de inspecciones</h3><span>{truckInspections.length} registro{truckInspections.length === 1 ? '' : 's'}</span></div>
        {truckInspections.length ? <div className="truck-inspection-list">{truckInspections.map(inspection => <article className="truck-inspection-card" key={inspection.id}>
          <div className="truck-maintenance-heading"><div><h4>Inspección · {dateTime(inspection.created_at || inspection.fecha)}</h4><span>{inspection.ruta || 'Ruta no especificada'} · Registrada por {inspection.encargado}</span></div><span className={`damage-badge damage-badge-${inspection.nivel_dano}`}>{inspection.estado_analisis === 'linea_base' ? 'Línea base' : inspectionLabels[inspection.nivel_dano] || inspection.nivel_dano}</span></div>
          <p>{inspection.resumen}</p>
          {!!inspection.hallazgos?.length && <ul>{inspection.hallazgos.map((finding, index) => <li key={`${finding.lado}-${index}`}><strong>{finding.lado}: {finding.tipo}</strong> — {finding.descripcion}</li>)}</ul>}
          <div className="truck-inspection-photos">{Object.entries(inspection.fotos || {}).map(([side, path]) => <a key={side} href={serverUrl + path} target="_blank" rel="noreferrer"><img loading="lazy" decoding="async" src={serverUrl + path} alt={`${side} del camión ${truck.numero}`} /><span>{side}</span></a>)}</div>
        </article>)}</div> : <Empty>Este camión aún no tiene inspecciones registradas.</Empty>}
      </section>
    </div>
  </Modal>
}
