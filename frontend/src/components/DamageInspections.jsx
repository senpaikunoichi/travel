import { useState } from 'react'
import { request, serverUrl } from '../api'
import { dateTime } from '../format'
import { Button, CaptureButton, Empty, Field } from './UI'
import GuidedCamera from './GuidedCamera'
import DamageMap from './DamageMap'
import { DAMAGE_TYPES, damageLabel } from '../truck'

const sides = [['frente', 'Frente'], ['izquierdo', 'Lado izquierdo'], ['posterior', 'Parte posterior'], ['derecho', 'Lado derecho']]
const levelLabels = { sin_cambios: 'Sin cambios', leve: 'Daño leve', moderado: 'Daño moderado', grave: 'Daño grave', inconcluso: 'Revisión manual' }

// Miniatura de un archivo elegido. ponytail: las URL de vista previa no se liberan hasta recargar la página
// (son pocas fotos por inspección); liberarlas al desmontar rompía la imagen con el doble montaje de React.
const previews = new WeakMap()
function Thumb({ file, alt }) {
  if (!previews.has(file)) previews.set(file, URL.createObjectURL(file))
  return <img src={previews.get(file)} alt={alt} />
}

export default function DamageInspections({ role, trucks, inspections, onAction }) {
  const [patente, setPatente] = useState(trucks[0]?.patente || '')
  const [ruta, setRuta] = useState('')
  const [photos, setPhotos] = useState({})
  const [camera, setCamera] = useState(null)
  const [marks, setMarks] = useState([])
  const [selected, setSelected] = useState(null)
  const [historyTruck, setHistoryTruck] = useState('')
  const [order, setOrder] = useState('newest')
  const canUpload = role === 'encargado'
  const allPhotos = sides.every(([side]) => photos[side])
  const ready = patente && allPhotos
  // Al usar una foto se pasa sola a la siguiente cara que falte; al completar las 4, se cierra la cámara.
  const nextMissing = (current, after) => sides.find(([side]) => !current[side] && side !== after)?.[0] || null
  const takePhoto = file => setPhotos(current => { const next = { ...current, [camera]: file }; setCamera(nextMissing(next, camera)); return next })
  const mark = selected === null ? null : marks[selected]
  const updateMark = changes => setMarks(list => list.map((m, i) => i === selected ? { ...m, ...changes } : m))
  const reset = () => { setPhotos({}); setRuta(''); setMarks([]); setSelected(null) }
  const visibleInspections = inspections
    .filter(inspection => !historyTruck || inspection.patente_camion === historyTruck)
    .slice()
    .sort((a, b) => order === 'newest' ? String(b.created_at || b.fecha).localeCompare(String(a.created_at || a.fecha)) || b.id - a.id : String(a.created_at || a.fecha).localeCompare(String(b.created_at || b.fecha)) || a.id - b.id)

  return <>
    <p className="section-description">Registra una foto diaria de cada cara del camión. La IA compara la inspección con la anterior y señala posibles choques, rayaduras, abolladuras o roturas. Confirma siempre los hallazgos con una revisión humana.</p>
    {canUpload && <form className="inspection-form" onSubmit={async event => {
      event.preventDefault()
      const body = new FormData()
      body.append('patente', patente)
      body.append('ruta', ruta)
      for (const [side] of sides) body.append(side, photos[side])
      let n = 0
      const danos = marks.map(m => { const d = { vista: m.vista, x: m.x, y: m.y, tipo: m.tipo, nota: m.nota || '', foto: m.file ? n : null }; if (m.file) body.append(`dano_${n++}`, m.file); return d })
      body.append('danos', JSON.stringify(danos))
      if (await onAction(() => request('post', '/api/inspecciones-camion', body, { timeout: 180000 }), 'Inspección guardada y comparada.')) reset()
    }}>
      <ol className="inspection-steps">
        <li className={patente ? 'done' : 'current'}>Camión</li>
        <li className={allPhotos ? 'done' : patente ? 'current' : ''}>4 fotos guiadas</li>
        <li className={allPhotos ? 'current' : ''}>Daños</li>
      </ol>
      <div className="form-grid">
        <Field label="Camión" as="select" value={patente} onChange={event => setPatente(event.target.value)} required>
          <option value="">Selecciona una patente</option>
          {trucks.map(truck => <option key={truck.patente} value={truck.patente}>{truck.patente} · {truck.numero} · {truck.modelo}</option>)}
        </Field>
        <Field label="Ruta o recorrido (opcional)" value={ruta} maxLength={150} placeholder="Ej.: Santiago–Valparaíso" onChange={event => setRuta(event.target.value)} />
      </div>

      <h4>Fotos de las 4 caras</h4>
      <p className="detail-meta">La cámara muestra la silueta del camión: encuádralo dentro, siempre a la misma distancia y con buena luz. Así la comparación de cada día es confiable.</p>
      <div className="guided-slots">{sides.map(([side, label], i) => <button type="button" key={side} className={`guided-slot${photos[side] ? ' has-photo' : ''}`} disabled={!patente} onClick={() => setCamera(side)}>
        {photos[side] ? <Thumb file={photos[side]} alt={label} /> : <span className="slot-number">{i + 1}</span>}
        <span>{label}</span><small>{photos[side] ? 'Repetir' : 'Tomar foto'}</small>
      </button>)}</div>
      {patente && !allPhotos && <Button onClick={() => setCamera(nextMissing(photos))}>{Object.keys(photos).length ? 'Seguir con las fotos' : 'Empezar fotos guiadas'}</Button>}

      {allPhotos && <section className="damage-step">
        <h4>Daños encontrados</h4>
        <p className="detail-meta">Toca en el dibujo dónde está cada daño y saca una foto de cerca. Si no hay daños nuevos, guarda directamente.</p>
        <DamageMap marks={marks} selected={selected} onSelect={setSelected} onMark={pos => { setMarks(list => [...list, { ...pos, tipo: 'rayon', nota: '', file: null }]); setSelected(marks.length) }} />
        {mark && <div className="damage-editor">
          <div className="section-heading"><h4>Daño {selected + 1} · {sides.find(([s]) => s === mark.vista)?.[1]}</h4><Button variant="danger" onClick={() => { setMarks(list => list.filter((_, i) => i !== selected)); setSelected(null) }}>Quitar</Button></div>
          <div className="chip-row" role="group" aria-label="Tipo de daño">{DAMAGE_TYPES.map(([value, label]) => <button type="button" key={value} className="chip" aria-pressed={mark.tipo === value} onClick={() => updateMark({ tipo: value })}>{label}</button>)}</div>
          <Field label="Nota (opcional)" value={mark.nota} maxLength={300} placeholder="Ej.: Abolladura en la puerta del copiloto" onChange={e => updateMark({ nota: e.target.value })} />
          <div className="capture-row">
            <CaptureButton accept="image/*" capture="environment" onFiles={([f]) => f && updateMark({ file: f })}>{mark.file ? 'Repetir foto de cerca' : 'Foto de cerca del daño'}</CaptureButton>
            {mark.file && <span className="damage-thumb"><Thumb file={mark.file} alt={`Daño ${selected + 1}`} /></span>}
          </div>
          <Button variant="secondary" onClick={() => setSelected(null)}>Listo</Button>
        </div>}
        {marks.length > 0 && <ol className="damage-list">{marks.map((m, i) => <li key={i}><button type="button" className="text-link" onClick={() => setSelected(i)}>{i + 1}. {damageLabel(m.tipo)} · {sides.find(([s]) => s === m.vista)?.[1]}</button>{m.nota ? ` — ${m.nota}` : ''}{m.file ? ' · con foto' : ''}</li>)}</ol>}
      </section>}
      <Button type="submit" disabled={!ready}>Guardar inspección y comparar con IA</Button>
      {camera && <GuidedCamera view={camera} label={sides.find(([s]) => s === camera)[1]} step={sides.findIndex(([s]) => s === camera) + 1} total={4} onPhoto={takePhoto} onClose={() => setCamera(null)} />}
    </form>}

    <section className="inspection-history" aria-labelledby="inspection-history-title">
      <div className="section-heading history-heading"><div><h3 id="inspection-history-title">Historial de inspecciones</h3><p className="detail-meta">Consulta las revisiones desde la más reciente o desde la más antigua.</p></div><strong className="history-count" aria-live="polite">{visibleInspections.length} resultado{visibleInspections.length === 1 ? '' : 's'}</strong></div>
      {inspections.length > 0 && <div className="history-controls">
        <Field label="Filtrar por patente" as="select" value={historyTruck} onChange={event => setHistoryTruck(event.target.value)}>
          <option value="">Todas las patentes</option>
          {trucks.slice().sort((a, b) => a.patente.localeCompare(b.patente, 'es')).map(truck => <option key={truck.patente} value={truck.patente}>{truck.patente} · {truck.numero} · {truck.modelo}</option>)}
        </Field>
        <Field label="Orden" as="select" value={order} onChange={event => setOrder(event.target.value)}><option value="newest">Más recientes primero</option><option value="oldest">Más antiguas primero</option></Field>
      </div>}
      <div className="inspection-list">
      {visibleInspections.length ? visibleInspections.map(inspection => <article className={`inspection-card damage-${inspection.nivel_dano}`} key={inspection.id}>
        <div className="section-heading">
          <div><p className="inspection-sequence">Inspección #{inspection.id}</p><h3>{historyTruck ? inspection.patente_camion : <button type="button" className="text-link card-title" aria-label={`Ver solo las inspecciones de ${inspection.patente_camion}`} onClick={() => setHistoryTruck(inspection.patente_camion)}>{inspection.patente_camion}</button>}</h3><p className="detail-meta">{dateTime(inspection.created_at || inspection.fecha)} · Registrada por {inspection.encargado}{inspection.ruta ? ` · Ruta: ${inspection.ruta}` : ''}</p></div>
          <span className={`damage-badge damage-badge-${inspection.nivel_dano}`}>{inspection.estado_analisis === 'linea_base' ? 'Línea base' : levelLabels[inspection.nivel_dano] || inspection.nivel_dano}</span>
        </div>
        <p className="inspection-summary">{inspection.resumen}</p>
        {!!inspection.hallazgos?.length && <ul className="damage-findings">{inspection.hallazgos.map((finding, index) => <li key={`${finding.lado}-${index}`}><strong>{finding.lado}: {finding.tipo}</strong> — {finding.descripcion} <small>Confianza {finding.confianza}</small></li>)}</ul>}
        {!!inspection.danos?.length && <div className="inspection-damages">
          <DamageMap marks={inspection.danos} />
          <ol className="damage-list">{inspection.danos.map((d, i) => <li key={d.id}>{d.ruta_archivo && <a href={serverUrl + d.ruta_archivo} target="_blank" rel="noreferrer"><img src={serverUrl + d.ruta_archivo} alt={`Daño ${i + 1}`} loading="lazy" /></a>}<span><strong>{i + 1}. {damageLabel(d.tipo)}</strong> · {sides.find(([s]) => s === d.vista)?.[1]}{d.nota ? ` — ${d.nota}` : ''}</span></li>)}</ol>
        </div>}
        <div className="truck-photo-grid">{sides.map(([side, label]) => inspection.fotos[side] && <a key={side} href={serverUrl + inspection.fotos[side]} target="_blank" rel="noreferrer"><img loading="lazy" decoding="async" src={serverUrl + inspection.fotos[side]} alt={`${label} del camión ${inspection.patente_camion}`} /><span>{label}</span></a>)}</div>
      </article>) : <Empty>{inspections.length ? 'No hay inspecciones que coincidan con la patente buscada.' : 'Aún no hay inspecciones diarias. La primera carga de cada camión servirá como referencia para las siguientes.'}</Empty>}
      </div>
    </section>
  </>
}
