import { useId } from 'react'
export function Field({ label, as: Tag = 'input', children, ...props }) {
  const id = useId()
  return <div className="field"><label htmlFor={id}>{label}</label><Tag id={id} {...props}>{children}</Tag></div>
}
export function Button({ children, variant = 'primary', ...props }) {
  return <button type="button" className={`button button-${variant}`} {...props}>{children}</button>
}
// El PNG original trae mucho margen transparente; el marco recorta solo el área del logo.
export function Logo({ className = '' }) {
  return <span className={`brand-logo ${className}`}><img src="/logo-travel.png" alt="Travel Trans Logística" /></span>
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
export function Section({ id, title, action, children, className = '' }) {
  return <section id={id} className={`section ${className}`.trim()}><div className="section-heading"><h2>{title}</h2>{action}</div>{children}</section>
}
