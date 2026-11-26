import { useState, useEffect, useCallback, useRef } from 'react'
import { request, uploadMedia, download } from './api'
import { money, date, roles, periods, priorities, kinds, km } from './format'
import Modal from './components/Modal'
import RecordForm from './components/RecordForm'
import TaskDetail from './components/TaskDetail'
import OtReport from './components/OtReport'
import Fuel from './components/Fuel'
import MechanicKpis from './components/MechanicKpis'
import DamageInspections from './components/DamageInspections'
import Notifications from './components/Notifications'
import { UpdateApp } from './components/UpdateBanner'
import Inventory from './components/Inventory'
import Purchases from './components/Purchases'
import KmPlans from './components/KmPlans'
import Checklists from './components/Checklist'
import Recovery from './components/Recovery'
import { Button, Empty, Field, Logo, Section, Stat, Status, Table, ThemeSwitch } from './components/UI'

// La vista va en la dirección (#compras, #km…): los enlaces abren la vista correcta y «Atrás» funciona.
const fromHash = () => decodeURIComponent(window.location.hash.slice(1)) || 'main-content'
const priorityRank = { urgente: 0, alta: 1, media: 2, baja: 3 }
const rank = p => priorityRank[p || 'media'] ?? 2
// El mecánico ve sus tareas divididas por prioridad (urgente → baja); lo pausado, en revisión y cerrado va aparte al final.
const groupLabels = { urgente: 'Prioridad urgente', alta: 'Prioridad alta', media: 'Prioridad media', baja: 'Prioridad baja', cotizando: 'En cotización (en pausa)', revision: 'Esperando revisión', aprobada: 'Aprobadas' }
function groupTasks(list, byPriority) {
  if (!byPriority) return [['todas', '', list]]
  const keyOf = t => stage(t) ? ['', 'cotizando', 'revision', 'aprobada'][stage(t)] : t.prioridad || 'media'
  return Object.keys(groupLabels).map(key => [key, groupLabels[key], list.filter(t => keyOf(t) === key)]).filter(([, , items]) => items.length)
}
const stage = t => t.estado === 'Aprobada' ? 3 : t.estado === 'Completada' ? 2 : t.cotizando ? 1 : 0
const intro = {
  recuperacion: ['Recuperación de flota', 'Todas las patentes con las fallas de sus checklists (mecánico y conductor), de peor a mejor. En el camión 3D se ve dónde está cada una.'],
  inspecciones: ['Daños de camiones', 'Registra las cuatro caras del camión y revisa las diferencias detectadas.'],
  flota: ['KPIs de flota', 'Consulta la disponibilidad y el gasto acumulado de cada camión.'],
  inventario: ['Inventario', 'Repuestos disponibles, lo que entra y lo que sale de bodega, y la revisión semanal con fotos.'],
  compras: ['Compras y presupuesto', 'Cotizaciones del mes, aprobaciones y el presupuesto mensual.'],
  km: ['Mantención por kilometraje', 'Planes por km con el kilometraje diario de los camiones.'],
  desempeno: ['Desempeño de mecánicos', 'KPI ponderados de cada mecánico: disponibilidad, OT a tiempo, reincidencia, preventivas y diagnóstico.'],
  checklists: ['Checklists', 'Los de mecánicos (salida de taller) y los de conductores (fin de ruta en TTS), con su responsable: historial por día y PDF.'],
  combustible: ['Combustible', 'Con cuánto combustible llega cada camión: lo registra el conductor al terminar la ruta en TTS, con la foto del tablero.'],
}

export default function Dashboard({ usuario, onLogout, initialNotice = null }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState(initialNotice)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeSection, setActiveSection] = useState(fromHash)
  const [editor, setEditor] = useState(null)
  const [detail, setDetail] = useState(null)
  const [reportId, setReportId] = useState(null)
  const [deletion, setDeletion] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [range, setRange] = useState({ start: '', end: '' })
  const [fleetFilter, setFleetFilter] = useState('')
  const admin = usuario.rol === 'admin'
  const chief = usuario.rol === 'jefe'
  const mechanic = usuario.rol === 'mecanico'
  const manager = usuario.rol === 'encargado'
  const office = admin || chief || manager
  const canCreate = admin || manager
  const allowedViews = { recuperacion: office, inspecciones: manager, flota: office, inventario: office, compras: office, km: office, combustible: office, checklists: office, desempeno: admin || chief }
  const view = allowedViews[activeSection] ? activeSection : null
  const fetchPanel = useCallback(async () => {
    const tasksUrl = usuario.rol === 'mecanico' ? `/api/tareas/mecanico/${usuario.id}` : '/api/tareas'
    const office = usuario.rol !== 'mecanico'
    const results = await Promise.all([
      request('get', tasksUrl),
      office ? request('get', '/api/mecanicos') : {},
      office ? request('get', '/api/camiones') : {},
      usuario.rol === 'admin' ? request('get', '/api/usuarios') : {},
      office ? request('get', '/api/kpis') : {},
      usuario.rol === 'encargado' ? request('get', '/api/inspecciones-camion') : {},
      office ? request('get', '/api/repuestos') : {},
      ['admin', 'encargado'].includes(usuario.rol) ? request('get', '/api/inventario/revision').catch(() => null) : null,
    ])
    return { tasks: results[0].tareas, mechanics: results[1].mecanicos || [], trucks: results[2].camiones || [], users: results[3].usuarios || [], kpis: results[4], inspections: results[5].inspecciones || [], parts: results[6].repuestos || [], check: results[7] }
  }, [usuario.id, usuario.rol])
  const load = async () => { const next = await fetchPanel(); setData(next); setLoadError(''); return next }
  useEffect(() => {
    let active = true
    fetchPanel().then(result => { if (active) setData(result) }).catch(() => { if (active) setLoadError('No pudimos cargar el panel. Revisa tu conexión e inténtalo nuevamente.') })
    return () => { active = false }
  }, [fetchPanel])
  // Actualización al momento: cada 15 s (y al volver a la app) se consulta si alguien guardó algo; si cambió, se recarga
  // en silencio el panel y `live` avisa a las secciones abiertas para que también se recarguen.
  const [live, setLive] = useState(0)
  const lastVersion = useRef(null)
  useEffect(() => {
    let stopped = false
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { version } = await request('get', '/api/cambios')
        if (stopped) return
        if (lastVersion.current !== null && version !== lastVersion.current) {
          setLive(n => n + 1)
          fetchPanel().then(next => { if (!stopped) setData(next) }).catch(() => {})
        }
        lastVersion.current = version
      } catch { /* sin conexión: se reintenta en el próximo ciclo */ }
    }
    check()
    const timer = setInterval(check, 15000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check) }
  }, [fetchPanel])
  // Enlace directo desde WhatsApp o un aviso: ?tarea=ID abre su detalle.
  const openTask = async (id, tab) => {
    let task = data?.tasks.find(t => t.id === Number(id))
    if (!task) task = (await load().catch(() => null))?.tasks.find(t => t.id === Number(id))
    if (task) openDetail({ ...task, tab }); else setNotice({ error: true, message: 'No encontramos esa tarea o no tienes acceso a ella.' })
  }
  // El detalle de una tarea ocupa una entrada del historial: «Atrás» del teléfono lo cierra en vez de salir de la app.
  // Chrome deja el foco en <body> al volver en el historial: se devuelve al botón que abrió el detalle.
  const opener = useRef(null)
  const openDetail = task => { setNotice(null); opener.current = document.activeElement; if (!window.history.state?.detail) window.history.pushState({ detail: true }, ''); setDetail(task) }
  const closeDetail = () => { setDetail(null); if (window.history.state?.detail) window.history.back() }
  useEffect(() => {
    const pop = () => {
      if (window.history.state?.detail) return
      setDetail(null)
      const el = opener.current
      setTimeout(() => el?.isConnected && el.focus())
    }
    const hash = () => setActiveSection(fromHash())
    window.addEventListener('popstate', pop); window.addEventListener('hashchange', hash)
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('hashchange', hash) }
  }, [])
  const go = id => { setMenuOpen(false); if (fromHash() === id) document.getElementById(id)?.scrollIntoView({ block: 'start' }); else window.location.assign(`#${id}`) }
  const deepLink = useRef(new URLSearchParams(window.location.search).get('tarea'))
  useEffect(() => {
    if (!data || !deepLink.current) return
    const task = data.tasks.find(t => t.id === Number(deepLink.current))
    deepLink.current = null
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    if (task) openDetail(task)
  }, [data])
  // Al cambiar de vista desde el menú, el destino se monta después del clic: se desplaza cuando ya existe.
  const ready = !!data
  useEffect(() => { if (ready) document.getElementById(activeSection)?.scrollIntoView({ block: 'start' }) }, [activeSection, ready])
  const showStatus = state => { setStatus(current => current === state ? '' : state); document.getElementById('tareas')?.scrollIntoView({ block: 'start' }) }
  const showTasks = text => { setSearch(text); setStatus(''); go('tareas') }
  // La patente filtra la lista para ver todas las tareas de ese camión.
  const plate = p => search === p ? p : <button type="button" className="text-link" aria-label={`Ver solo las tareas de ${p}`} onClick={() => showTasks(p)}>{p}</button>
  const flags = t => <>
    {!!t.cotizando && <small className="flag-waiting">Cotizando · en pausa</small>}
    {!!t.esperando_repuesto && <small className="flag-waiting">Esperando repuesto</small>}
    {!!t.vencida && <small className="overdue">Aplazada {t.veces_aplazada} {Number(t.veces_aplazada) === 1 ? 'vez' : 'veces'}</small>}
    {t.nota_rechazo && t.estado === 'En_Trabajo' && <small className="flag-rejected">Corrección solicitada</small>}
  </>
  const tags = t => <span className="task-tags">
    <span className={`tag tag-${t.prioridad || 'media'}`}>Prioridad {(priorities[t.prioridad] || 'Media').toLowerCase()}</span>
    <span className="tag">{kinds[t.tipo_mantencion] || 'Correctiva'}</span>
    {t.prioridad_camion === 'alta' && <span className="tag">Camión prioritario</span>}
  </span>
  const action = async (operation, message) => {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setNotice(null)
    try {
      const result = await operation()
      setNotice({ message: typeof message === 'function' ? message(result) : message, error: false })
      try { await load() } catch { setLoadError('La operación se guardó, pero no pudimos actualizar el panel. Vuelve a cargar los datos.') }
      return true
    } catch (error) {
      setNotice({ message: error.response?.data?.mensaje || (error.code === 'ERR_NETWORK' ? 'No hay conexión con el servicio. Inténtalo nuevamente.' : error.message) || 'No se pudo completar la operación.', error: true })
      return false
    } finally { lock.current = false; setBusy(false) }
  }
  const exportReport = async all => {
    if (!all && ((Boolean(range.start) !== Boolean(range.end)) || range.start > range.end)) { setNotice({ error: true, message: 'Selecciona un rango de fechas válido.' }); return }
    await action(async () => {
      const query = !all && range.start ? `?fecha_inicio=${range.start}&fecha_fin=${range.end}` : ''
      await download(`/api/exportar/excel${query}`, `reporte_mantenimiento${query ? `_${range.start}_${range.end}` : ''}.xlsx`)
    }, 'Reporte descargado.')
  }
  const navigation = [
    { label: 'Principal', items: [['main-content', 'Vista general'], ['tareas', mechanic ? 'Mis tareas' : 'Tareas']] },
    ...(office ? [{ label: 'Flota', items: [['recuperacion', 'Recuperación de flota'], ['flota', 'KPIs de flota'], ['km', 'Mantención por km'], ['combustible', 'Combustible'], ['checklists', 'Checklists'], ...(manager ? [['inspecciones', 'Daños e inspecciones']] : []), ...(admin ? [['camiones', 'Camiones']] : [])] }] : []),
    ...(office ? [{ label: 'Compras', items: [['compras', chief ? 'Aprobar compras' : 'Compras y presupuesto'], ['inventario', 'Inventario']] }] : []),
    ...((admin || chief) ? [{ label: 'Gestión', items: [['desempeno', 'Desempeño mecánicos'], ...(admin ? [['usuarios', 'Usuarios']] : []), ...(chief ? [['reportes', 'Reportes']] : [])] }] : []),
  ]
  const filtered = (data?.tasks.filter(t => (!status || t.estado === status) && `${t.tipo_tarea} ${t.patente_camion} ${t.mecanicos_nombres || ''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))) || [])
    // Orden de trabajo: primero lo que se puede hacer ya, por prioridad de la tarea y luego del camión; lo en cotización, en revisión y cerrado va al final.
    .sort((a, b) => stage(a) - stage(b) || rank(a.prioridad) - rank(b.prioridad) || rank(a.prioridad_camion) - rank(b.prioridad_camion) || String(a.fecha_limite).localeCompare(String(b.fecha_limite)))
  const counts = data ? ['Pendiente', 'En_Trabajo', 'Completada', 'Aprobada'].map(state => ({ state, total: data.tasks.filter(t => t.estado === state).length })) : []
  const fleetTotals = data?.kpis?.flota || { total: 0, activos: 0, enTaller: 0, enPanne: 0 }
  const share = n => Number(fleetTotals.total) ? Number(n || 0) / Number(fleetTotals.total) * 100 : 0
  const activeShare = share(fleetTotals.activos), shopShare = share(fleetTotals.enTaller), panneShare = share(fleetTotals.enPanne)
  const fleetLabel = { activo: 'Activo', taller: 'En taller', panne: 'En panne' }
  // Para editar se cargan los repuestos actuales: los ya retirados o faltantes se muestran pero no se quitan.
  const startEdit = async task => {
    setNotice(null)
    try {
      const { repuestos } = await request('get', `/api/tareas/${task.id}/compras`)
      setEditor({ kind: 'task', initial: { ...task, descripcion: task.descripcion || '', kilometraje: task.kilometraje ?? '', mecanicos: String(task.mecanicos_ids || '').split(',').filter(Boolean).map(Number), repuestos: repuestos.map(l => ({ id: l.id, id_repuesto: l.id_repuesto, descripcion: l.descripcion, nombre: l.nombre, cantidad: Number(l.cantidad), estado: l.estado })) } })
      go('tareas')
    } catch { setNotice({ error: true, message: 'No pudimos cargar la tarea para editarla.' }) }
  }
  const taskActions = task => <div className="actions">
    {mechanic && task.estado === 'Pendiente' && !task.cotizando && <Button onClick={() => action(() => request('put', `/api/tareas/estado/${task.id}`, { estado: 'En_Trabajo' }), 'Tarea iniciada.').then(ok => ok && openTask(task.id))}>Iniciar tarea</Button>}
    {mechanic && task.estado === 'En_Trabajo' || manager && task.estado === 'Completada' ? <Button onClick={() => openDetail(task)}>{mechanic ? 'Continuar trabajo' : 'Revisar trabajo'}</Button> : <Button variant="secondary" onClick={() => openDetail(task)}>{mechanic && task.estado === 'Pendiente' ? 'Ver tarea' : 'Ver detalle'}</Button>}
    {(admin || manager) && ['Pendiente', 'En_Trabajo'].includes(task.estado) && <Button variant="soft" onClick={() => action(() => request('put', `/api/tareas/${task.id}/cotizando`, { activo: !task.cotizando }), r => r.mensaje)}>{task.cotizando ? 'Retomar tarea' : 'Cotizando'}</Button>}
    {(admin || chief || manager) && task.estado !== 'Aprobada' && <Button variant="secondary" onClick={() => startEdit(task)}>Editar</Button>}
    {admin && <Button variant="danger" onClick={() => { setNotice(null); setDeletion({ url: `/api/tareas/eliminar/${task.id}`, label: `la tarea «${task.tipo_tarea}»`, warning: 'También se borrarán sus fotos, videos, gastos, repuestos asignados y cotizaciones.' }) }}>Eliminar</Button>}
  </div>
  const recordEditor = kind => editor?.kind === kind && <RecordForm key={editor.initial?.id || editor.initial?.patente || editor.initial?.id_plan || kind} kind={kind} initial={editor.initial} mechanics={data.mechanics} trucks={data.trucks} parts={data.parts} onCancel={() => setEditor(null)} onSubmit={async (form, files = []) => {
    const group = { truck: 'camiones', user: 'usuarios', task: 'tareas' }[kind]
    const editing = kind === 'task' ? !!editor.initial?.id : !!editor.initial
    const id = kind === 'truck' ? encodeURIComponent(editor.initial?.patente) : editor.initial?.id
    const url = editing ? `/api/${group}/editar/${id}` : `/api/${group}/${kind === 'task' ? 'crear' : 'agregar'}`
    const saved = await action(async () => {
      const result = await request(editing ? 'put' : 'post', url, form)
      // Las fotos y videos del antes se suben después de crear la tarea, uno por uno.
      let failed = 0
      for (const file of files) await uploadMedia(result.tarea_id, file, 'antes').catch(() => { failed++ })
      return failed ? { mensaje: `Tarea creada, pero ${failed} archivo(s) no se pudieron subir. Agrégalos desde el detalle.` } : result
    }, result => result?.mensaje || 'Registro guardado correctamente.')
    if (saved) setEditor(null)
  }} />
  const page = view ? intro[view] : mechanic ? ['Mi mantenimiento', 'Revisa tus tareas, registra avances y mantén la flota en movimiento.'] : ['Control de mantenimiento', 'Tu flota, tu equipo y cada tarea en un solo lugar.']
  // Informe de una OT: página propia para imprimir o guardar en PDF.
  if (reportId) return <OtReport id={reportId} onClose={() => setReportId(null)} />
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Ir al contenido</a>
    <header className="app-header">
      <a href="#main-content" className="header-brand"><Logo /></a>
      <div className="header-title"><strong>Mantenimiento</strong><span>Gestión de flota</span></div>
      <button className="menu-toggle" aria-label="Menú" title={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(!menuOpen)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d={menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M3 6h18M3 12h18M3 18h18'} />
        </svg>
      </button>
      <div className="user-info"><span>{usuario.nombre}</span><small>{roles[usuario.rol]}</small></div>
      <ThemeSwitch />
      <UpdateApp icon />
      <Notifications onOpenTask={openTask} onNavigate={go} live={live} />
      <button onClick={async () => { try { await onLogout() } catch (error) { setNotice({ error: true, message: error.message }) } }} className="button button-secondary logout-button">Salir</button>
    </header>
    <nav id="main-nav" className={`app-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Navegación principal">{navigation.map(group => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span><div className="nav-group-links">{group.items.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined} onClick={() => { if (fromHash() === id) document.getElementById(id)?.scrollIntoView({ block: 'start' }); setMenuOpen(false) }}>{label}</a>)}</div></div>)}<div className="nav-theme"><ThemeSwitch /></div></nav>
    <main id="main-content" className="main-content" tabIndex={-1}>
      <div className="page-intro"><p className="eyebrow">Travel Trans · Operaciones</p><h1>{page[0]}</h1><p>{page[1]}</p></div>
      {notice && !detail && !deletion && <div role={notice.error ? 'alert' : 'status'} className={`notice notice-${notice.error ? 'error' : 'success'}`}><span>{notice.message}</span><Button variant="icon" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>×</Button></div>}
      {loadError ? <div role="alert" className="notice notice-error"><span>{loadError}</span><Button variant="secondary" onClick={() => { setLoadError(''); load().catch(() => setLoadError('No pudimos cargar el panel. Inténtalo nuevamente.')) }}>Reintentar</Button></div> : !data ? <div className="loading-state" role="status"><span className="spinner" />Cargando tu panel…</div> : <fieldset disabled={busy} aria-busy={busy} className="panel-content">
        {view === 'inspecciones' ? <Section id="inspecciones" title="Inspección diaria de daños">
          <DamageInspections role={usuario.rol} trucks={data.trucks} inspections={data.inspections} onAction={action} />
        </Section> : view === 'inventario' ? <Inventory role={usuario.rol} parts={data.parts} trucks={data.trucks} onAction={action} onOpenTask={openTask} live={live} />
        : view === 'compras' ? <Purchases role={usuario.rol} onAction={action} onOpenTask={openTask} live={live} />
        : view === 'recuperacion' ? <Recovery onOpenTask={openTask} onCreateTask={canCreate ? initial => { setEditor({ kind: 'task', initial }); go('tareas') } : null} live={live} />
        : view === 'checklists' ? <Checklists trucks={data.trucks} onAction={action} onOpenTask={openTask} onCreateTask={canCreate ? initial => { setEditor({ kind: 'task', initial }); go('tareas') } : null} live={live} />
        : view === 'desempeno' ? <MechanicKpis live={live} onShowTasks={showTasks} />
        : view === 'combustible' ? <Fuel role={usuario.rol} trucks={data.trucks} onAction={action} live={live} />
        : view === 'km' ? <KmPlans role={usuario.rol} parts={data.parts} onOpenTask={openTask} live={live} onAction={action} onCreateTask={initial => { setEditor({ kind: 'task', initial }); go('tareas') }} />
        : view === 'flota' ? <div id="flota">
          <div className="fleet-kpi-grid fleet-kpi-grid-4">
            {[['', 'Flota total', data.kpis.flota.total, 'Ver todos los camiones', ''], ['activo', 'Camiones activos', data.kpis.flota.activos, 'Disponibles para operar', 'fleet-kpi-active'], ['taller', 'Camiones en taller', data.kpis.flota.enTaller ?? 0, 'Con una OT abierta', 'fleet-kpi-shop'], ['panne', 'Camiones en panne', data.kpis.flota.enPanne, 'Fuera de operación', 'fleet-kpi-panne']].map(([state, label, value, hint, cls]) =>
              <Stat key={label} className={cls} label={label} value={value} hint={hint} pressed={fleetFilter === state} onClick={() => { setFleetFilter(fleetFilter === state ? '' : state); document.getElementById('gasto-camion')?.scrollIntoView({ block: 'start' }) }} />)}
          </div>
          <Section title="Disponibilidad de la flota">
            <div className="donut-layout">
              <div className={`fleet-donut ${Number(fleetTotals.total) ? '' : 'is-empty'}`} style={{ '--active-share': `${activeShare}%`, '--shop-share': `${activeShare + shopShare}%` }} role="img" aria-label={`${fleetTotals.activos} camiones activos, ${fleetTotals.enTaller ?? 0} en taller y ${fleetTotals.enPanne} en panne`}><div className="fleet-donut-center"><strong>{fleetTotals.total}</strong><span>Total</span></div></div>
              <div className="donut-legend">
                <div><span className="legend-dot legend-active" aria-hidden="true" /><p><strong>{fleetTotals.activos}</strong> Activos</p><small>{Math.round(activeShare)}% de la flota</small></div>
                <div><span className="legend-dot legend-shop" aria-hidden="true" /><p><strong>{fleetTotals.enTaller ?? 0}</strong> En taller</p><small>{Math.round(shopShare)}% de la flota · con OT abierta</small></div>
                <div><span className="legend-dot legend-panne" aria-hidden="true" /><p><strong>{fleetTotals.enPanne}</strong> En panne</p><small>{Math.round(panneShare)}% de la flota</small></div>
              </div>
            </div>
          </Section>
          <Section id="gasto-camion" title={fleetFilter ? `Camiones ${fleetFilter === 'activo' ? 'activos' : fleetLabel[fleetFilter].toLowerCase()}` : 'Estado y gasto por camión'} action={fleetFilter && <Button variant="secondary" onClick={() => setFleetFilter('')}>Ver todos</Button>}>
            <p className="section-description">El gasto acumulado incluye todos los gastos registrados en las tareas de cada camión.</p>
            {data.kpis.gastosCamion?.length ? <Table label="Estado operativo y gasto por camión" headings={['Patente', 'Camión', 'Estado', 'Gasto acumulado', 'Acción']}>
              {data.kpis.gastosCamion.filter(truck => !fleetFilter || (truck.estado || truck.estado_operativo) === fleetFilter).map(truck => <tr key={truck.patente}><td><button type="button" className="text-link" aria-label={`Ver tareas de ${truck.patente}`} onClick={() => showTasks(truck.patente)}>{truck.patente}</button></td><td>{truck.numero} · {truck.modelo}</td><td><span className={`fleet-status fleet-status-${truck.estado || truck.estado_operativo}`}>{fleetLabel[truck.estado || truck.estado_operativo]}</span>{Number(truck.ot_abiertas) > 0 && <button type="button" className="text-link detail-meta" onClick={() => showTasks(truck.patente)}>{truck.ot_abiertas} OT abierta{Number(truck.ot_abiertas) === 1 ? '' : 's'}</button>}</td><td className="num"><strong>{money(truck.total_gasto)}</strong></td><td><Button variant={truck.estado_operativo === 'panne' ? 'soft' : 'danger'} onClick={() => action(() => request('put', `/api/camiones/estado/${encodeURIComponent(truck.patente)}`, { estado_operativo: truck.estado_operativo === 'panne' ? 'activo' : 'panne' }), truck.estado_operativo === 'panne' ? `${truck.patente} volvió a estar activo.` : `${truck.patente} quedó marcado en panne.`)}>{truck.estado_operativo === 'panne' ? 'Marcar activo' : 'Marcar en panne'}</Button></td></tr>)}
            </Table> : <Empty>No hay camiones registrados.</Empty>}
          </Section>
        </div> : <>
        {data.check && (() => { const left = data.check.items.filter(i => !i.revision).length, open = data.check.faltantes.length
          return (left > 0 || open > 0) && <div className="notice notice-warning check-reminder" role="note"><span><strong>Inventario:</strong> {left > 0 ? `falta revisar ${left} de ${data.check.items.length} ítems esta semana` : 'revisión de la semana completa'}{open > 0 ? ` · ${open} faltante${open === 1 ? '' : 's'} por aclarar` : ''}.</span><Button variant="secondary" onClick={() => go('inventario')}>Ir a revisar ›</Button></div> })()}
        <div className="summary-grid">{counts.map(({ state, total }) => <button type="button" className="summary-card" key={state} aria-pressed={status === state} onClick={() => showStatus(state)}><Status value={state} /><strong>{total}</strong><span>{status === state ? 'Mostrando solo estas · quitar filtro' : 'Ver tareas'}</span></button>)}</div>
        {admin && <div className="admin-grid">
          <Section id="camiones" title="Camiones" action={<Button onClick={() => setEditor({ kind: 'truck' })}>+ Agregar</Button>}>
            {recordEditor('truck')}
            {data.trucks.length ? <Table label="Camiones" headings={['Patente', 'Modelo', 'Prioridad', 'Km', 'Acciones']}>{data.trucks.map(t => <tr key={t.patente}><td><strong>{plate(t.patente)}</strong><small className="detail-meta">N.º {t.numero}</small></td><td>{t.modelo}</td><td>{priorities[t.prioridad] || 'Media'}</td><td className="num">{km(t.km_actual)}</td><td><div className="actions"><Button variant="secondary" onClick={() => setEditor({ kind: 'truck', initial: t })}>Editar</Button><Button variant="danger" onClick={() => { setNotice(null); setDeletion({ url: `/api/camiones/eliminar/${encodeURIComponent(t.patente)}`, label: `el camión ${t.patente}` }) }}>Eliminar</Button></div></td></tr>)}</Table> : <Empty>No hay camiones registrados. Agrega el primero para asignar tareas.</Empty>}
          </Section>
          <Section id="usuarios" title="Usuarios" action={<Button onClick={() => setEditor({ kind: 'user' })}>+ Agregar</Button>}>
            {recordEditor('user')}
            {data.users.length ? <Table label="Usuarios" headings={['Nombre', 'Rol', 'Acciones']}>{data.users.map(u => <tr key={u.id}><td><strong>{u.nombre}</strong><small className="detail-meta">{u.email}</small></td><td>{roles[u.rol] || u.rol}</td><td><div className="actions"><Button variant="secondary" onClick={() => setEditor({ kind: 'user', initial: u })}>Editar</Button><Button variant="danger" onClick={() => { setNotice(null); setDeletion({ url: `/api/usuarios/eliminar/${u.id}`, label: `al usuario ${u.nombre}` }) }}>Eliminar</Button></div></td></tr>)}</Table> : <Empty>No hay usuarios registrados.</Empty>}
          </Section>
        </div>}
        {chief && <>
          <div className="financial-grid">{[['Gasto del mes', data.kpis.gastosMes, 'Este mes'], ['Últimos 7 días', data.kpis.gastosSemana, 'Últimos 7 días'], ['Gasto total', data.kpis.totalGastos, '']].map(([label, value, period]) => { const [, start = '', end = ''] = periods().find(([l]) => l === period) || []
            return <Stat key={label} label={label} value={money(value)} hint="Descargar el detalle en Excel" pressed={!!period && range.start === start && range.end === end} onClick={() => { setRange({ start, end }); go('reportes') }} /> })}</div>
          <section id="reportes" className="section report-section" aria-labelledby="reportes-title">
            <h2 id="reportes-title">Reportes de mantenimiento</h2>
            <p className="report-lead">Descarga en Excel el informe de la semana, el mes o el año: OT y costos por camión, compras (con el motivo del mecánico, quién aprobó y el comprobante) y repuestos usados. Para una sola OT, ábrela y pulsa «Informe de la OT».</p>
            <form className="report-card" onSubmit={e => { e.preventDefault(); exportReport(false) }}>
              <div className="chip-row" role="group" aria-label="Período rápido">{periods().map(([label, start, end]) => <button type="button" key={label} className="chip" aria-pressed={range.start === start && range.end === end} onClick={() => setRange({ start, end })}>{label}</button>)}</div>
              <div className="report-form">
                <Field label="Desde" type="date" value={range.start} onChange={e => setRange({ ...range, start: e.target.value })} />
                <Field label="Hasta" type="date" min={range.start || undefined} value={range.end} onChange={e => setRange({ ...range, end: e.target.value })} />
              </div>
              <div className="actions report-actions"><Button type="submit">Exportar Excel</Button><Button variant="secondary" onClick={() => exportReport(true)}>Exportar todo</Button></div>
            </form>
          </section>
          <Section title="Tareas por mecánico">{data.kpis.tareasMecanico?.length ? <Table label="Rendimiento por mecánico" headings={['Mecánico', 'Asignadas', 'Completadas', 'Cumplimiento']}>{data.kpis.tareasMecanico.map((m, i) => { const percent = m.total_asignadas > 0 ? Math.round(m.completadas / m.total_asignadas * 100) : 0; return <tr key={`${m.nombre}-${i}`}><td><button type="button" className="text-link" aria-label={`Ver tareas de ${m.nombre}`} onClick={() => showTasks(m.nombre)}>{m.nombre}</button></td><td className="num">{m.total_asignadas}</td><td className="num">{m.completadas || 0}</td><td><div className="progress-cell"><progress value={percent} max={100} aria-label={`Cumplimiento de ${m.nombre}`} /><span>{percent}%</span></div></td></tr> })}</Table> : <Empty>No hay datos de mecánicos para mostrar.</Empty>}</Section>
        </>}
        <Section id="tareas" title={mechanic ? 'Mis tareas' : 'Tareas de mantenimiento'} action={canCreate && <Button onClick={() => setEditor({ kind: 'task' })}>+ Nueva tarea</Button>}>
          {recordEditor('task')}
          {data.tasks.length > 0 && <div className="task-filters"><Field label="Buscar tarea, patente o mecánico" type="search" placeholder="Ej.: Embrague o ABC-123" value={search} onChange={e => setSearch(e.target.value)} /><Field label="Estado" as="select" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option>{counts.map(c => <option key={c.state} value={c.state}>{c.state.replaceAll('_', ' ')}</option>)}</Field><p aria-live="polite">{filtered.length} de {data.tasks.length} tareas</p></div>}
          {!filtered.length ? <Empty>{data.tasks.length ? 'No hay tareas que coincidan con los filtros.' : mechanic ? 'No tienes tareas asignadas.' : 'No hay tareas registradas todavía.'}</Empty> : admin || chief ? <Table label="Tareas de mantenimiento" headings={['Tarea', 'Patente', 'Fecha límite', 'Estado', 'Acciones']}>{filtered.map(t => <tr key={t.id}><td><strong><button type="button" className="text-link" onClick={() => openDetail(t)}>{t.tipo_tarea}</button></strong>{tags(t)}{flags(t)}</td><td>{plate(t.patente_camion)}</td><td>{date(t.fecha_limite)}</td><td><Status value={t.estado} /></td><td>{taskActions(t)}</td></tr>)}</Table> : groupTasks(filtered, mechanic).map(([key, label, list]) => <div key={key} className="task-group">{label && <h3 className="task-group-title">{label} <span className="history-count">{list.length}</span></h3>}<div className="task-grid">{list.map(t => <article key={t.id} className={`task-card ${t.vencida ? 'task-overdue' : ''}`}><div className="section-heading"><h3><button type="button" className="text-link card-title" onClick={() => openDetail(t)}>{t.tipo_tarea}</button></h3><Status value={t.estado} /></div>{tags(t)}<p className="detail-meta">{plate(t.patente_camion)} · {t.modelo}{t.kilometraje ? ` · ${km(t.kilometraje)}` : ''}</p><p className="detail-meta">Fecha límite: {date(t.fecha_limite)}{!mechanic && t.mecanicos_nombres ? ` · ${t.mecanicos_nombres}` : ''}</p>{flags(t)}{t.descripcion && <p className="detail-description">{t.descripcion}</p>}{taskActions(t)}</article>)}</div></div>)}
        </Section>
        </>}
      </fieldset>}
    </main>
    {detail && <TaskDetail key={detail.id} task={data?.tasks.find(t => t.id === detail.id) || detail} role={usuario.rol} live={live} autoWhatsapp={!!usuario.whatsapp_auto} initialTab={detail.tab} busy={busy} notice={notice} onClose={closeDetail} onAction={action} onReport={id => { closeDetail(); setReportId(id); window.scrollTo(0, 0) }} />}
    {deletion && <Modal title="Confirmar eliminación" onClose={() => !busy && setDeletion(null)}><div className="modal-content"><h2>Confirmar eliminación</h2><p className="detail-description">¿Quieres eliminar {deletion.label}? Esta acción no se puede deshacer.{deletion.warning ? ` ${deletion.warning}` : ''}</p>{notice?.error && <p role="alert" className="notice notice-error">{notice.message}</p>}<div className="actions"><Button variant="danger" disabled={busy} onClick={async () => { if (await action(() => request('delete', deletion.url), r => r?.mensaje || 'Registro eliminado.')) setDeletion(null) }}>Eliminar</Button><Button variant="secondary" disabled={busy} onClick={() => setDeletion(null)}>Cancelar</Button></div></div></Modal>}
    <footer className="app-footer"><Logo /><span>Travel Trans Logística · Mantenimiento de flota</span></footer>
    {busy && <p role="status" className="request-status">Procesando…</p>}
  </div>
}
