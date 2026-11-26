import { useState } from 'react'
import { request, serverUrl } from '../api'
import { dateTime } from '../format'
import { Button, Empty, Field } from './UI'

const sides = [['frente', 'Frente'], ['posterior', 'Parte posterior'], ['izquierdo', 'Lado izquierdo'], ['derecho', 'Lado derecho']]
const levelLabels = { sin_cambios: 'Sin cambios', leve: 'Daño leve', moderado: 'Daño moderado', grave: 'Daño grave', inconcluso: 'Revisión manual' }

export default function DamageInspections({ role, trucks, inspections, onAction, selectedTruck = '', onSelectedTruckChange }) {
  const [patente, setPatente] = useState(trucks[0]?.patente || '')
  const [ruta, setRuta] = useState('')
  const [photos, setPhotos] = useState({})
  const [fileKey, setFileKey] = useState(0)
  const [historyTruck, setHistoryTruck] = useState('')
  const [order, setOrder] = useState('newest')
  const canUpload = role === 'encargado'
  const ready = patente && sides.every(([side]) => photos[side])
  const photoCount = sides.filter(([side]) => photos[side]).length
  const activeHistoryTruck = selectedTruck || historyTruck
  const visibleInspections = inspections
    .filter(inspection => !activeHistoryTruck || inspection.patente_camion === activeHistoryTruck)
    .slice()
    .sort((a, b) => order === 'newest' ? String(b.created_at || b.fecha).localeCompare(String(a.created_at || a.fecha)) || b.id - a.id : String(a.created_at || a.fecha).localeCompare(String(b.created_at || b.fecha)) || a.id - b.id)

  return <>
    <p className="section-description">Registra una foto diaria de cada cara del camión. La IA compara la inspección con la anterior y señala posibles choques, rayaduras, abolladuras o roturas. Confirma siempre los hallazgos con una revisión humana.</p>
    {canUpload && <form id="inspection-entry-form" className="inspection-form" onSubmit={async event => {
      event.preventDefault()
      const body = new FormData()
      body.append('patente', patente)
      body.append('ruta', ruta)
      for (const [side] of sides) body.append(side, photos[side])
      if (await onAction(() => request('post', '/api/inspecciones-camion', body, { timeout: 120000 }), 'Inspección guardada y comparada.')) {
        setPhotos({}); setRuta(''); setFileKey(value => value + 1)
      }
    }}>
      <div className="inspection-form-heading">
        <div><h3>Registrar inspección diaria</h3><p>Completa los datos y toma cuatro fotos del camión.</p></div>
        <span className="inspection-progress" aria-live="polite">{photoCount} de {sides.length} fotos</span>
      </div>
      <div className="inspection-basic-fields">
        <Field label="Camión" as="select" value={patente} onChange={event => setPatente(event.target.value)} required>
          <option value="">Selecciona un camión</option>
          {trucks.map(truck => <option key={truck.patente} value={truck.patente}>{truck.numero} · {truck.modelo} · {truck.patente}</option>)}
        </Field>
        <Field label="Ruta o recorrido (opcional)" value={ruta} maxLength={150} placeholder="Ej.: Santiago–Valparaíso" onChange={event => setRuta(event.target.value)} />
      </div>
      <div className="inspection-photo-fields">
        {sides.map(([side, label], index) => <div className={`inspection-photo-card ${photos[side] ? 'inspection-photo-card-ready' : ''}`} key={side}>
          <span className="inspection-photo-step">Foto {index + 1}</span>
          <Field key={`${side}-${fileKey}`} label={label} type="file" accept="image/png,image/jpeg,image/gif,image/webp" capture="environment" required={!photos[side]} onChange={event => setPhotos(current => ({ ...current, [side]: event.target.files[0] || null }))} />
          <p aria-live="polite">{photos[side] ? `Lista: ${photos[side].name}` : 'Toca para tomar o elegir una foto.'}</p>
        </div>)}
      </div>
      <p className="inspection-photo-tip">Procura que el camión se vea completo, con buena iluminación y desde un ángulo similar al de inspecciones anteriores.</p>
      <div className="inspection-submit-row">
        {!ready && <span className="inspection-submit-hint">Selecciona un camión y completa las cuatro fotos para continuar.</span>}
        <Button type="submit" disabled={!ready}>Guardar inspección</Button>
      </div>
    </form>}

    <section id="inspection-history" className="inspection-history" aria-labelledby="inspection-history-title">
      <div className="section-heading history-heading"><div><h3 id="inspection-history-title">Historial de inspecciones</h3><p className="detail-meta">Consulta las revisiones desde la más reciente o desde la más antigua.</p></div><strong className="history-count" aria-live="polite">{visibleInspections.length} resultado{visibleInspections.length === 1 ? '' : 's'}</strong></div>
      {inspections.length > 0 && <div className="history-controls">
        <Field label="Filtrar por patente" as="select" value={activeHistoryTruck} onChange={event => { setHistoryTruck(event.target.value); onSelectedTruckChange?.(event.target.value) }}>
          <option value="">Todas las patentes</option>
          {trucks.slice().sort((a, b) => a.patente.localeCompare(b.patente, 'es')).map(truck => <option key={truck.patente} value={truck.patente}>{truck.patente} · {truck.numero} · {truck.modelo}</option>)}
        </Field>
        <Field label="Orden" as="select" value={order} onChange={event => setOrder(event.target.value)}><option value="newest">Más recientes primero</option><option value="oldest">Más antiguas primero</option></Field>
      </div>}
      <div className="inspection-list">
      {visibleInspections.length ? visibleInspections.map(inspection => <article className={`inspection-card damage-${inspection.nivel_dano}`} key={inspection.id}>
        <div className="section-heading">
          <div><p className="inspection-sequence">Inspección #{inspection.id}</p><h3>{inspection.patente_camion}</h3><p className="detail-meta">{dateTime(inspection.created_at || inspection.fecha)} · Registrada por {inspection.encargado}{inspection.ruta ? ` · Ruta: ${inspection.ruta}` : ''}</p></div>
          <span className={`damage-badge damage-badge-${inspection.nivel_dano}`}>{inspection.estado_analisis === 'linea_base' ? 'Línea base' : levelLabels[inspection.nivel_dano] || inspection.nivel_dano}</span>
        </div>
        <p className="inspection-summary">{inspection.resumen}</p>
        {!!inspection.hallazgos?.length && <ul className="damage-findings">{inspection.hallazgos.map((finding, index) => <li key={`${finding.lado}-${index}`}><strong>{finding.lado}: {finding.tipo}</strong> — {finding.descripcion} <small>Confianza {finding.confianza}</small></li>)}</ul>}
        <div className="truck-photo-grid">{sides.map(([side, label]) => inspection.fotos[side] && <a key={side} href={serverUrl + inspection.fotos[side]} target="_blank" rel="noreferrer"><img loading="lazy" decoding="async" src={serverUrl + inspection.fotos[side]} alt={`${label} del camión ${inspection.patente_camion}`} /><span>{label}</span></a>)}</div>
      </article>) : <Empty>{inspections.length ? 'No hay inspecciones que coincidan con la patente buscada.' : 'Aún no hay inspecciones diarias. La primera carga de cada camión servirá como referencia para las siguientes.'}</Empty>}
      </div>
    </section>
  </>
}
