import { useEffect, useRef, useState } from 'react'
import { Button, CaptureButton } from './UI'
import { TruckShape } from './TruckShapes'
import { viewBox } from '../truck'

// Cámara trasera ultra gran angular (0,5×), si el teléfono la tiene: permite sacar el camión completo más de cerca.
const ULTRA_WIDE = /ultra|gran angular|0[.,]5|wide angle/i
const FRONT = /front|frontal|user|facetime/i
const STEADY_MS = 1500 // tiempo quieto para disparar sola
const AUTO_USE_S = 2 // segundos antes de usar la foto sola

// Cámara dentro de la app con la silueta del camión encima. Dispara sola cuando el teléfono queda quieto
// encuadrando (y la imagen no está oscura), y usa la foto sola salvo que se pida repetir.
export default function GuidedCamera({ view, label, step, total, onPhoto, onClose }) {
  const video = useRef(null)
  const streamRef = useRef(null)
  const [ratio, setRatio] = useState(null)
  const [error, setError] = useState('')
  const [shot, setShot] = useState(null)
  const [auto, setAuto] = useState(true)
  const [steady, setSteady] = useState(0) // 0 a 1: avance hacia el disparo automático
  const [countdown, setCountdown] = useState(null)
  const [lenses, setLenses] = useState({ wide: null, normal: null, zoomMin: null })
  const [lens, setLens] = useState('wide')
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth)
  const side = view === 'izquierdo' || view === 'derecho'
  const [w, h] = viewBox(view)

  // Abre la cámara: primero la trasera normal, luego busca la ultra gran angular y la usa si existe.
  useEffect(() => {
    let stopped = false
    const start = async constraints => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, ...constraints }, audio: false })
      if (stopped) { s.getTracks().forEach(t => t.stop()); return null }
      streamRef.current = s
      video.current.srcObject = s
      video.current.play().catch(() => {})
      return s
    }
    const init = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError('Este navegador no permite usar la cámara dentro de la app.'); return }
      try {
        const s = await start({ facingMode: { ideal: 'environment' } })
        if (!s) return
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && !FRONT.test(d.label))
        const wide = devices.find(d => ULTRA_WIDE.test(d.label))?.deviceId || null
        const normal = s.getVideoTracks()[0]?.getSettings?.().deviceId || null
        const zoom = s.getVideoTracks()[0]?.getCapabilities?.().zoom
        const zoomMin = zoom && zoom.min < 1 ? zoom.min : null
        if (stopped) return
        setLenses({ wide, normal, zoomMin })
        if (wide && wide !== normal) await start({ deviceId: { exact: wide } })
        else if (zoomMin) await s.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: zoomMin }] }).catch(() => {})
      } catch { if (!stopped) setError('No pudimos abrir la cámara (revisa el permiso de cámara del navegador).') }
    }
    init()
    const turn = () => setPortrait(window.innerHeight > window.innerWidth)
    window.addEventListener('resize', turn)
    return () => { stopped = true; streamRef.current?.getTracks().forEach(t => t.stop()); window.removeEventListener('resize', turn) }
  }, [])

  const switchLens = async next => {
    setLens(next); setRatio(null)
    try {
      if (lenses.wide) {
        streamRef.current?.getTracks().forEach(t => t.stop())
        const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: next === 'wide' ? lenses.wide : lenses.normal }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        streamRef.current = s; video.current.srcObject = s; video.current.play().catch(() => {})
      } else if (lenses.zoomMin) {
        await streamRef.current.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: next === 'wide' ? lenses.zoomMin : 1 }] })
      }
    } catch { setError('No se pudo cambiar de lente.') }
  }

  const capture = () => {
    const v = video.current
    if (!v?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth; canvas.height = v.videoHeight
    canvas.getContext('2d').drawImage(v, 0, 0)
    canvas.toBlob(blob => blob && setShot({ blob, url: URL.createObjectURL(blob) }), 'image/jpeg', 0.9)
  }
  const captureRef = useRef(capture)
  useEffect(() => { captureRef.current = capture })

  // Disparo automático: compara cuadros pequeños en escala de grises; si casi no cambian durante STEADY_MS
  // y la imagen tiene luz y contraste suficientes, dispara.
  useEffect(() => {
    if (!auto || shot || !ratio || error) return undefined
    const canvas = document.createElement('canvas')
    canvas.width = 64; canvas.height = 48
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let previous = null, since = null
    const timer = setInterval(() => {
      const v = video.current
      if (!v?.videoWidth) return
      ctx.drawImage(v, 0, 0, 64, 48)
      const data = ctx.getImageData(0, 0, 64, 48).data
      const gray = new Float32Array(64 * 48)
      let sum = 0
      for (let i = 0; i < gray.length; i++) { gray[i] = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11; sum += gray[i] }
      const mean = sum / gray.length
      let varSum = 0, diff = 0
      for (let i = 0; i < gray.length; i++) { varSum += (gray[i] - mean) ** 2; if (previous) diff += Math.abs(gray[i] - previous[i]) }
      const contrast = Math.sqrt(varSum / gray.length)
      const motion = previous ? diff / gray.length : 99
      previous = gray
      const usable = mean > 35 && contrast > 18 // ni oscura ni plana (lente tapado, pared)
      if (usable && motion < 4) {
        since ??= Date.now()
        const progress = Math.min(1, (Date.now() - since) / STEADY_MS)
        setSteady(progress)
        if (progress >= 1) { clearInterval(timer); setSteady(0); captureRef.current() }
      } else { since = null; setSteady(0) }
    }, 150)
    return () => clearInterval(timer)
  }, [auto, shot, ratio, error])

  // Foto sacada sola: se usa sola en AUTO_USE_S segundos salvo que se pida repetir.
  const accept = file => { onPhoto(file); setShot(null); setCountdown(null) }
  const acceptRef = useRef(accept)
  useEffect(() => { acceptRef.current = accept })
  useEffect(() => {
    if (!shot || !auto) return undefined
    let left = AUTO_USE_S
    const tick = () => { setCountdown(left); if (left <= 0) { acceptRef.current(new File([shot.blob], `${view}.jpg`, { type: 'image/jpeg' })); return } left -= 1; timer = setTimeout(tick, 1000) }
    let timer = setTimeout(tick, 0)
    return () => clearTimeout(timer)
  }, [shot, auto, view])
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  const hasWide = !!(lenses.wide && lenses.wide !== lenses.normal) || !!lenses.zoomMin
  const pad = 0.03 // silueta casi a borde: el camión sale grande y no hay que alejarse tanto
  return <div className="guided-camera" role="dialog" aria-label={`Foto ${step} de ${total}: ${label}`}>
    <div className="camera-top">
      <span className="camera-step">{step} de {total}</span>
      <strong>{label}</strong>
      <button type="button" className="camera-close" aria-label="Cerrar cámara" onClick={onClose}>×</button>
    </div>
    {error ? <div className="camera-error">
      <p>{error}</p>
      <CaptureButton accept="image/*" capture="environment" variant="primary" onFiles={([f]) => f && accept(f)}>Usar la cámara del teléfono</CaptureButton>
    </div> : <>
      <div className="camera-stage">
        <div className="camera-frame" style={ratio ? { aspectRatio: ratio } : undefined}>
          <video ref={video} playsInline muted onLoadedMetadata={e => setRatio(e.currentTarget.videoWidth / e.currentTarget.videoHeight)} hidden={!!shot} />
          {shot && <img src={shot.url} alt={`Foto: ${label}`} />}
          {!shot && <svg className={`camera-guide${steady > 0 ? ' is-steady' : ''}`} viewBox={`${-w * pad} ${-h * pad} ${w * (1 + 2 * pad)} ${h * (1 + 2 * pad)}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <g className="guide-shadow"><TruckShape view={view} /></g>
            <g className="guide-line"><TruckShape view={view} /></g>
          </svg>}
          {!shot && hasWide && <div className="lens-switch" role="group" aria-label="Lente">
            <button type="button" aria-pressed={lens === 'wide'} onClick={() => switchLens('wide')}>0,5×</button>
            <button type="button" aria-pressed={lens === 'normal'} onClick={() => switchLens('normal')}>1×</button>
          </div>}
        </div>
      </div>
      <p className="camera-hint" aria-live="polite">{shot
        ? (auto && countdown !== null ? `Usando la foto en ${countdown}… (o repítela)` : '¿Se ve el camión completo y nítido?')
        : side && portrait ? 'Gira el teléfono a lo ancho para que entre el camión completo.'
          : steady > 0 ? 'Mantén el teléfono quieto…' : `Encuadra el camión dentro de la silueta${auto ? ' y quédate quieto: la foto se saca sola' : ''}.`}</p>
      <div className="camera-actions">
        {shot ? <>
          <Button variant="secondary" onClick={() => { setShot(null); setCountdown(null) }}>Repetir</Button>
          <Button onClick={() => accept(new File([shot.blob], `${view}.jpg`, { type: 'image/jpeg' }))}>Usar foto</Button>
        </> : <>
          <button type="button" className={`auto-toggle${auto ? ' is-on' : ''}`} aria-pressed={auto} onClick={() => setAuto(a => !a)}>Auto</button>
          <button type="button" className="shutter" aria-label="Tomar foto" onClick={capture} disabled={!ratio} style={{ '--progress': steady }} />
          <span className="auto-toggle-spacer" />
        </>}
      </div>
    </>}
  </div>
}
