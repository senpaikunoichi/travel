import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ZONES, ANCHORS, FRONT, REAR } from '../fleetZones'

// Camión de frío en 3D (hecho con piezas simples, sin modelos externos) con un marcador en cada zona con problemas.
// Ejes: x hacia el frente, y hacia arriba; el lado izquierdo del camión es -z. Medidas aproximadas en metros.

function buildTruck() {
  const truck = new THREE.Group()
  const parts = {}
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, ...o })
  const add = (name, geo, material, [x, y, z], rot) => {
    const m = new THREE.Mesh(geo, material)
    m.position.set(x, y, z); if (rot) m.rotation.set(...rot)
    m.castShadow = true; m.receiveShadow = true
    truck.add(m); (parts[name] ||= []).push(m)
    return m
  }
  const white = mat('#F4F4F6', { roughness: 0.35 }), cabPaint = mat('#ECECEF', { roughness: 0.3, metalness: 0.15 })
  const dark = mat('#2A2A2E', { roughness: 0.7 }), steel = mat('#8E8E93', { metalness: 0.7, roughness: 0.3 })
  const glass = mat('#1B2430', { roughness: 0.08, metalness: 0.6 }), rubber = mat('#151517', { roughness: 0.9 })

  // Chasis y caja de frío
  add('frame', new THREE.BoxGeometry(FRONT - REAR - 0.2, 0.22, 1.7), dark, [(FRONT + REAR) / 2 - 0.1, 0.78, 0])
  add('box', new RoundedBoxGeometry(5.95, 2.55, 2.5, 4, 0.08), white, [-0.725, 2.33, 0])
  add('box', new THREE.BoxGeometry(5.9, 0.08, 2.52), mat('#C8C8CC'), [-0.725, 1.05, 0]) // zócalo de la caja
  add('reefer', new RoundedBoxGeometry(0.32, 0.85, 1.7, 3, 0.05), mat('#9A9AA0', { metalness: 0.4 }), [2.37, 3.0, 0])
  for (let i = 0; i < 4; i++) add('reefer', new THREE.BoxGeometry(0.02, 0.06, 1.5), dark, [2.54, 2.72 + i * 0.16, 0])
  // Puertas traseras: dos hojas, manillas y luces
  add('doors', new THREE.BoxGeometry(0.05, 2.4, 1.2), mat('#E6E6EA'), [REAR - 0.01, 2.35, -0.61])
  add('doors', new THREE.BoxGeometry(0.05, 2.4, 1.2), mat('#E6E6EA'), [REAR - 0.01, 2.35, 0.61])
  for (const z of [-0.12, 0.12]) add('doors', new THREE.CylinderGeometry(0.025, 0.025, 2.2), steel, [REAR - 0.07, 2.35, z])
  for (const z of [-1.08, 1.08]) add('lights', new THREE.BoxGeometry(0.06, 0.14, 0.28), mat('#C00010', { emissive: '#6A0008' }), [REAR - 0.02, 0.92, z])
  add('frame', new THREE.BoxGeometry(0.12, 0.14, 2.3), dark, [REAR + 0.05, 0.72, 0]) // parachoques trasero
  // Cabina: carrocería, parabrisas, ventanas, parrilla, focos, parachoques, espejos
  add('cab', new RoundedBoxGeometry(1.65, 2.2, 2.32, 5, 0.22), cabPaint, [3.3, 2.0, 0])
  add('cab', new RoundedBoxGeometry(1.2, 0.35, 2.1, 3, 0.12), cabPaint, [3.15, 3.2, 0]) // spoiler
  add('windshield', new THREE.BoxGeometry(0.04, 0.82, 2.0), glass, [4.12, 2.5, 0], [0, 0, 0.06])
  for (const z of [-1.17, 1.17]) add('cab', new THREE.BoxGeometry(0.85, 0.62, 0.03), glass, [3.45, 2.5, z])
  add('grille', new RoundedBoxGeometry(0.08, 0.72, 1.5, 2, 0.03), dark, [4.13, 1.48, 0])
  for (let i = 0; i < 5; i++) add('grille', new THREE.BoxGeometry(0.02, 0.04, 1.36), steel, [4.18, 1.22 + i * 0.13, 0])
  for (const z of [-0.86, 0.86]) add('lights', new RoundedBoxGeometry(0.06, 0.2, 0.42, 2, 0.04), mat('#FFFFFF', { emissive: '#D8E4FF', emissiveIntensity: 0.6 }), [4.14, 1.18, z])
  add('cab', new RoundedBoxGeometry(0.22, 0.3, 2.36, 2, 0.06), dark, [4.13, 0.86, 0]) // parachoques
  for (const z of [-1.3, 1.3]) {
    add('cab', new THREE.BoxGeometry(0.05, 0.05, 0.22), dark, [3.95, 2.55, z * 0.93])
    add('cab', new RoundedBoxGeometry(0.08, 0.42, 0.16, 2, 0.03), dark, [3.95, 2.45, z])
  }
  // Estanque (izquierda), batería (derecha), ruedas
  add('frame', new THREE.CylinderGeometry(0.28, 0.28, 1.0, 24), steel, [1.75, 0.82, -1.0], [0, 0, Math.PI / 2])
  add('battery', new RoundedBoxGeometry(0.6, 0.42, 0.34, 2, 0.04), dark, [1.6, 0.85, 1.0])
  const tire = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 36), rim = new THREE.CylinderGeometry(0.28, 0.28, 0.34, 24)
  const wheel = (name, x, z) => { add(name, tire, rubber, [x, 0.5, z], [Math.PI / 2, 0, 0]); add(name, rim, steel, [x, 0.5, z], [Math.PI / 2, 0, 0]) }
  wheel('wheel-fl', 3.2, -1.02); wheel('wheel-fr', 3.2, 1.02)
  for (const [x, n] of [[-1.6, 1], [-2.6, 2]]) { wheel(`wheel-rl${n}`, x, -0.98); wheel(`wheel-rl${n}`, x, -0.64); wheel(`wheel-rr${n}`, x, 0.98); wheel(`wheel-rr${n}`, x, 0.64) }
  // Logo de Travel Trans en los dos costados de la caja (se lee bien desde afuera en ambos lados)
  const logo = new THREE.TextureLoader().load('/assets/logo-travel-trans.png')
  logo.colorSpace = THREE.SRGBColorSpace; logo.anisotropy = 8
  const logoMat = new THREE.MeshStandardMaterial({ map: logo, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 })
  const logoGeo = new THREE.PlaneGeometry(3.1, 3.1 * 288 / 597)
  add('box', logoGeo, logoMat, [-0.6, 2.4, 1.256]).castShadow = false
  add('box', logoGeo, logoMat, [-0.6, 2.4, -1.256], [0, Math.PI, 0]).castShadow = false
  // Mancha de aceite: solo se ve cuando hay fugas
  const puddle = add('puddle', new THREE.CircleGeometry(0.55, 32), mat('#1A1A1A', { roughness: 0.05, transparent: true, opacity: 0.55 }), [1.7, 0.01, -0.45], [-Math.PI / 2, 0, 0])
  puddle.visible = false
  return { truck, parts }
}

// Sin WebGL (equipo muy antiguo o desactivado) se muestra solo la lista.
const WEBGL = (() => { try { return !!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl') } catch { return false } })()

export default function Truck3D({ markers, active, onSelect, label }) {
  const host = useRef(null), overlay = useRef(null), api = useRef(null)
  const [hint, setHint] = useState(true)

  useEffect(() => {
    const el = host.current
    let renderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }) } catch { return }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
    el.prepend(renderer.domElement)
    renderer.domElement.setAttribute('aria-hidden', 'true')

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.add(new THREE.HemisphereLight('#FFFFFF', '#B8B8C0', 0.5))
    const sun = new THREE.DirectionalLight('#FFFFFF', 1.6)
    sun.position.set(6, 12, -5); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 }); sun.shadow.radius = 6
    scene.add(sun)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.18 }))
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground)
    const { truck, parts } = buildTruck()
    scene.add(truck)

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    camera.position.set(9.5, 5.2, -11.5)
    const controls = new OrbitControls(camera, renderer.domElement)
    Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 8, maxDistance: 24, maxPolarAngle: Math.PI * 0.47, autoRotate: !reduce, autoRotateSpeed: 0.5 })
    controls.target.set(0.2, 1.7, 0)
    controls.addEventListener('start', () => { touched = true; controls.autoRotate = false; goal = null; setHint(false) })

    // Encuadre: la distancia que hace caber el camión (unos 10 m en diagonal) en el ancho y el alto del panel.
    let touched = false
    const view = new THREE.Vector3(9.5, 5.2, -11.5).normalize()
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'
      camera.aspect = w / h; camera.updateProjectionMatrix()
      const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      if (!touched) camera.position.copy(controls.target).addScaledVector(view, Math.min(24, Math.max(6.2 / span, 10.2 / (span * camera.aspect))))
    }
    const ro = new ResizeObserver(resize); ro.observe(el); resize()

    let goal = null, glow = [], frame = 0
    const ray = new THREE.Raycaster(), solid = Object.values(parts).flat().filter(m => m.visible)
    const v = new THREE.Vector3()
    api.current = {
      leak(on) { parts.puddle[0].visible = on },
      focus(point, zone) {
        glow.forEach(m => { m.material.dispose(); m.material = m.userData.base })
        glow = (ANCHORS[zone]?.[1] || []).flatMap(n => parts[n] || [])
        glow.forEach(m => { m.userData.base ||= m.material; m.material = m.userData.base.clone() })
        if (!point) return
        const p = new THREE.Vector3(...point), out = p.clone().sub(new THREE.Vector3(0.2, 1.4, 0)).setY(0).normalize()
        controls.autoRotate = false; touched = true
        goal = { target: p.clone().lerp(new THREE.Vector3(0.2, 1.7, 0), 0.5), position: p.clone().add(out.multiplyScalar(9)).setY(Math.max(3, p.y + 3.5)) }
        if (reduce) { camera.position.copy(goal.position); controls.target.copy(goal.target); goal = null }
      },
    }
    const loop = time => {
      frame = requestAnimationFrame(loop)
      if (goal) {
        camera.position.lerp(goal.position, 0.08); controls.target.lerp(goal.target, 0.08)
        if (camera.position.distanceTo(goal.position) < 0.02) goal = null
      }
      controls.update()
      const pulse = reduce ? 0.6 : 0.45 + Math.sin(time / 260) * 0.35
      glow.forEach(m => { if (m.material.emissive) { m.material.emissive.set('#E00000'); m.material.emissiveIntensity = pulse } })
      renderer.render(scene, camera)
      // Marcadores HTML sobre el dibujo; los que quedan detrás del camión se ven tenues.
      const { clientWidth: w, clientHeight: h } = el
      for (const node of overlay.current?.children || []) {
        v.fromArray(JSON.parse(node.dataset.point)).project(camera)
        node.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * h}px) translate(-50%, -50%)`
        const p = new THREE.Vector3(...JSON.parse(node.dataset.point)), dist = camera.position.distanceTo(p)
        ray.set(camera.position, p.sub(camera.position).normalize()); ray.far = dist - 0.15
        node.classList.toggle('is-behind', ray.intersectObjects(solid, false).length > 0)
      }
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame); ro.disconnect(); controls.dispose(); pmrem.dispose()
      scene.traverse(o => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()) })
      renderer.dispose(); renderer.domElement.remove(); api.current = null
    }
  }, [])

  // La mancha de aceite solo con fugas; el foco sigue a la zona elegida.
  useEffect(() => { api.current?.leak(markers.some(m => m.zona === 'fugas')) }, [markers])
  useEffect(() => {
    const m = markers.find(x => x.key === active)
    api.current?.focus(m ? m.point || ANCHORS[m.zona][0] : null, m?.zona)
  }, [active, markers])

  if (!WEBGL) return <div className="truck3d truck3d-failed" role="note">Este equipo no puede mostrar el modelo 3D. La lista de problemas tiene toda la información.</div>
  return <div className="truck3d" ref={host} role="group" aria-label={label}>
    <div className="truck3d-markers" ref={overlay}>
      {markers.map(m => <button type="button" key={m.key} data-point={JSON.stringify(m.point || ANCHORS[m.zona][0])}
        className={`truck3d-pin pin-${m.gravedad}${active === m.key ? ' is-active' : ''}`} aria-pressed={active === m.key}
        aria-label={`${ZONES[m.zona].nombre}: ${m.count} problema${m.count === 1 ? '' : 's'}`} onClick={() => onSelect(m.key)}>
        <span aria-hidden="true">{m.count}</span><small>{ZONES[m.zona].nombre}</small>
      </button>)}
    </div>
    {hint && <p className="truck3d-hint" aria-hidden="true">Arrastra para girar · pellizca o usa la rueda para acercar</p>}
  </div>
}
