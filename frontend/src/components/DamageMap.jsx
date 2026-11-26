import { TruckShape } from './TruckShapes'
import { VIEWS, viewBox } from '../truck'

// Plano del camión: tocar un punto marca un daño ahí. Los daños se numeran en el orden en que se marcan.
export default function DamageMap({ marks, selected, onMark, onSelect }) {
  const editable = !!onMark
  return <div className="damage-map">{VIEWS.map(([view, label]) => {
    const [w, h] = viewBox(view)
    return <figure key={view} className={`damage-view damage-view-${view}`}>
      <svg viewBox={`-6 -6 ${w + 12} ${h + 12}`} role={editable ? 'button' : 'img'} aria-label={editable ? `${label}: toca donde está el daño` : label}
        onClick={editable ? e => {
          const box = e.currentTarget.getBoundingClientRect()
          // De la posición del toque a % dentro del dibujo (sin el margen de 6 del viewBox).
          const x = ((e.clientX - box.left) / box.width * (w + 12) - 6) / w * 100
          const y = ((e.clientY - box.top) / box.height * (h + 12) - 6) / h * 100
          onMark({ vista: view, x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) })
        } : undefined}>
        <g className="damage-shape"><TruckShape view={view} /></g>
        {marks.map((m, i) => m.vista === view && <g key={i} className={`damage-pin${selected === i ? ' is-selected' : ''}`} transform={`translate(${m.x / 100 * w} ${m.y / 100 * h})`}
          onClick={onSelect ? e => { e.stopPropagation(); onSelect(i) } : undefined}>
          <circle r="7" /><text textAnchor="middle" dy="3">{i + 1}</text>
        </g>)}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  })}</div>
}
