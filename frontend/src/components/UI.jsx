import { useId, useRef, useState } from 'react'
import { serverUrl } from '../api'
import { isVideo } from '../format'
export function Field({ label, as: Tag = 'input', children, id: given, ...props }) {
  const auto = useId()
  const id = given || auto
  return <div className="field"><label htmlFor={id}>{label}</label><Tag id={id} {...props}>{children}</Tag></div>
}
export function Button({ children, variant = 'primary', ...props }) {
  return <button type="button" className={`button button-${variant}`} {...props}>{children}</button>
}
// Logo oficial: versión completa desde 40 px de alto, compacta por debajo (design.md §3).
// En tema oscuro la versión completa cambia a la oficial para fondos oscuros; la compacta sirve en ambos.
export function Logo({ full = false, className = '' }) {
  if (!full) return <img className={`brand-logo ${className}`} src="/assets/logo-travel-trans-compacto.png" alt="Travel Trans Logística" />
  return <>
    <img className={`brand-logo logo-light ${className}`} src="/assets/logo-travel-trans.png" alt="Travel Trans Logística" />
    <img className={`brand-logo logo-dark ${className}`} src="/assets/logo-travel-trans-oscuro.png" alt="Travel Trans Logística" />
  </>
}
export function Empty({ children }) {
  return <div className="empty-state"><span aria-hidden="true">—</span><p>{children}</p></div>
}
export function Table({ label, headings, children }) {
  return <div className="table-scroll" role="region" aria-label={label} tabIndex={0}><table className={headings.length >= 4 ? 'wide-table' : undefined}><caption className="sr-only">{label}</caption><thead><tr>{headings.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
}
export function Status({ value }) {
  const labels = { Completada: 'Pendiente de aprobación' }
  return <span className={`status status-${value}`}>{labels[value] || value.replaceAll('_', ' ')}</span>
}
// Tarjeta de resumen: con onClick es un botón que filtra o lleva a su lista (pressed = filtro activo).
export function Stat({ label, value, hint, onClick, pressed, className = '' }) {
  const body = <>{typeof label === 'string' ? <span>{label}</span> : label}<strong>{value}</strong><span>{hint}{onClick ? ' ›' : ''}</span></>
  return onClick ? <button type="button" className={`summary-card ${className}`} aria-pressed={pressed} onClick={onClick}>{body}</button>
    : <div className={`summary-card ${className}`}>{body}</div>
}
export function Section({ id, title, action, children }) {
  return <section id={id} className="section"><div className="section-heading"><h2>{title}</h2>{action}</div>{children}</section>
}
// Abre la cámara del teléfono dentro del flujo de la app (foto o video) o el selector de archivos.
// `light`: fotos que se guardan livianas (inventario semanal): se achican siempre a 1280 px antes de subir.
export function CaptureButton({ children, accept, capture, multiple, onFiles, variant = 'soft', light = false }) {
  const ref = useRef(null)
  return <><Button variant={variant} onClick={() => ref.current.click()}>{children}</Button><input ref={ref} type="file" accept={accept} capture={capture} multiple={multiple} hidden onChange={async e => {
    const list = [...e.target.files]; e.target.value = ''
    onFiles(await Promise.all(list.map(file => light ? shrinkImage(file, 1280, 0.7, true) : shrinkImage(file))))
  }} /></>
}

// Achica las fotos en el teléfono antes de subirlas (máx. 1920 px, JPEG): suben más rápido y ocupan menos.
// Videos, PDF y GIF pasan tal cual; si el navegador no puede procesar la imagen, se sube la original.
async function shrinkImage(file, max = 1920, quality = 0.82, force = false) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < (force ? 300e3 : 1.5e6)) { bitmap.close?.(); return file }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}

// Sistema / Claro / Oscuro. theme.js aplica el tema y escucha los cambios del sistema.
export function ThemeSwitch() {
  const [mode, setMode] = useState(() => window.temaTravel?.get() || 'sistema')
  if (!window.temaTravel) return null
  return <select className="theme-switch" aria-label="Tema de la pantalla" value={mode} onChange={e => { window.temaTravel.set(e.target.value); setMode(e.target.value) }}>
    <option value="sistema">◐ Sistema</option>
    <option value="claro">☀ Claro</option>
    <option value="oscuro">☾ Oscuro</option>
  </select>
}

// Fotos o videos guardados; los videos se reproducen ahí mismo y las fotos se abren en grande.
export function MediaGrid({ items, label, small = false, onDelete }) {
  return <div className={`evidence-grid${small ? ' evidence-grid-small' : ''}`}>{items.map(item => {
    const video = isVideo(item.ruta_archivo)
    return <div key={item.id} className="media-item">
      {video
        ? <video src={serverUrl + item.ruta_archivo} controls playsInline preload="metadata" aria-label={label} />
        : <a href={serverUrl + item.ruta_archivo} target="_blank" rel="noreferrer"><img loading="lazy" decoding="async" src={serverUrl + item.ruta_archivo} alt={label} /></a>}
      {onDelete && <button type="button" className="media-delete" aria-label={`Borrar ${video ? 'video' : 'foto'}`} onClick={() => onDelete(item, video)}>×</button>}
    </div>
  })}</div>
}
