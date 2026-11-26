import { useState, useEffect, useCallback, useRef } from 'react'
import { request, serverUrl } from './api'
import { money, date, roles } from './format'
import Modal from './components/Modal'
import RecordForm from './components/RecordForm'
import TaskDetail from './components/TaskDetail'
import TruckProfile from './components/TruckProfile'
import DamageInspections from './components/DamageInspections'
import Inventory from './components/Inventory'
import InventoryPurchases from './components/InventoryPurchases'
import InventoryReports from './components/InventoryReports'
import { Button, Empty, Field, Logo, Section, Status, Table } from './components/UI'

function NavigationIcon({ name }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></>,
    tasks: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5h6M8 11h8M8 15h8" /></>,
    fleet: <><path d="M3 7h12v11H3zM15 11h4l3 3v4h-7" /><circle cx="7.5" cy="19" r="2" /><circle cx="18.5" cy="19" r="2" /></>,
    mechanics: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M17 8l2 2 3-3M17 14h4v6h-4z" /></>,
    stock: <><path d="m12 3 9 4.5v9L12 21l-9-4.5v-9L12 3Z" /><path d="m3.5 7.7 8.5 4.5 8.5-4.5M12 12.2V21M8 5l9 4.8" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="12" cy="12" r="9" /></>,
  }
  return <svg className="mobile-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function Dashboard({ usuario, onLogout, onUpdateUser, initialNotice = null }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState(initialNotice)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [activeSection, setActiveSection] = useState('inicio')
  const [inventoryRefresh, setInventoryRefresh] = useState(0)
  const purchaseRequestJump = useRef(false)
  const [fleetSearch, setFleetSearch] = useState('')
  const [fleetStatus, setFleetStatus] = useState('')
  const [showAllFleetTrucks, setShowAllFleetTrucks] = useState(false)
  const [inspectionFormVisible, setInspectionFormVisible] = useState(false)
  const [fleetHistoryTruck, setFleetHistoryTruck] = useState('')
  const [editor, setEditor] = useState(null)
  const [detail, setDetail] = useState(null)
  const [truckProfile, setTruckProfile] = useState(null)
  const [deletion, setDeletion] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [range, setRange] = useState({ start: '', end: '' })
  const [selectedMechanic, setSelectedMechanic] = useState('')
  const [mechanicHistory, setMechanicHistory] = useState(null)
  const [mechanicHistoryError, setMechanicHistoryError] = useState(null)
  const [mechanicHistoryRefresh, setMechanicHistoryRefresh] = useState(0)
  const admin = usuario.rol === 'admin'
  const chief = usuario.rol === 'jefe'
  const mechanic = usuario.rol === 'mecanico'
  const manager = usuario.rol === 'encargado'
  const inventoryAccess = admin || chief || manager
  const inventoryView = inventoryAccess && activeSection === 'bodega'
  const fleetAccess = admin || chief || manager
  const fleetView = fleetAccess && activeSection === 'flota'
  const usersView = admin && activeSection === 'usuarios'
  const maintenanceReportsView = (admin || chief) && activeSection === 'reportes'
  const homeView = activeSection === 'inicio'
  const tasksView = activeSection === 'tareas'
  const mechanicsView = fleetAccess && activeSection === 'mecanicos'
  const canCreate = admin || usuario.rol === 'encargado'
  const fetchPanel = useCallback(async () => {
    const tasksUrl = usuario.rol === 'mecanico' ? `/api/tareas/mecanico/${usuario.id}` : '/api/tareas'
    const results = await Promise.all([
      request('get', tasksUrl),
      ['admin', 'encargado'].includes(usuario.rol) ? request('get', '/api/mecanicos') : {},
      ['admin', 'encargado', 'jefe'].includes(usuario.rol) ? request('get', '/api/camiones') : {},
      usuario.rol === 'admin' ? request('get', '/api/usuarios') : {},
      ['admin', 'encargado', 'jefe'].includes(usuario.rol) ? request('get', '/api/kpis') : {},
      fleetAccess ? request('get', '/api/inspecciones-camion') : {},
      inventoryAccess ? request('get', '/api/inventario/repuestos') : {},
      inventoryAccess ? request('get', '/api/inventario/solicitudes') : {},
      manager ? Promise.allSettled([
        request('get', '/api/combustible'),
        request('get', '/api/planes'),
      ]) : Promise.resolve(null),
    ])
    const telemetry = results[8]
    const fuelResult = telemetry?.[0]
    const maintenanceResult = telemetry?.[1]
    const telemetryErrors = []
    if (fuelResult?.status === 'rejected') telemetryErrors.push({
      label: 'Combustible',
      message: fuelResult.reason?.response?.data?.mensaje || 'No pudimos cargar los registros de combustible.',
    })
    if (maintenanceResult?.status === 'rejected') telemetryErrors.push({
      label: 'Kilometraje GPS',
      message: maintenanceResult.reason?.response?.data?.mensaje || 'No pudimos cargar los datos de mantención por kilometraje.',
    })
    return {
      tasks: results[0].tareas,
      mechanics: results[1].mecanicos || [],
      trucks: results[2].camiones || [],
      users: results[3].usuarios || [],
      kpis: results[4],
      inspections: results[5].inspecciones || [],
      inventory: results[6].repuestos || [],
      purchases: results[7].solicitudes || [],
      fuelRecords: fuelResult?.status === 'fulfilled' ? fuelResult.value.registros || [] : [],
      maintenancePlans: maintenanceResult?.status === 'fulfilled' ? maintenanceResult.value.estado || [] : [],
      telemetryErrors,
    }
  }, [fleetAccess, inventoryAccess, manager, usuario.id, usuario.rol])
  const load = async () => { setData(await fetchPanel()); setLoadError('') }
  const refreshInventoryData = async () => {
    setInventoryRefresh(value => value + 1)
    try { await load() } catch { setLoadError('La solicitud se actualizó, pero no pudimos refrescar los datos de bodega.') }
  }
  useEffect(() => {
    let active = true
    fetchPanel().then(result => { if (active) setData(result) }).catch(() => { if (active) setLoadError('No pudimos cargar el panel. Revisa tu conexión e inténtalo nuevamente.') })
    return () => { active = false }
  }, [fetchPanel])
  useEffect(() => {
    if (!manager || !fleetView) return undefined
    const form = document.getElementById('inspection-entry-form')
    if (!form) return undefined
    const observer = new IntersectionObserver(([entry]) => setInspectionFormVisible(entry.isIntersecting))
    observer.observe(form)
    return () => observer.disconnect()
  }, [fleetView, manager])
  useEffect(() => {
    if (!purchaseRequestJump.current || !inventoryView) return
    const target = document.getElementById('purchase-requests')
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    purchaseRequestJump.current = false
  }, [data, inventoryView])
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
      const blob = await request('get', `/api/exportar/excel${query}`, undefined, { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `reporte_mantenimiento${query ? `_${range.start}_${range.end}` : ''}.xlsx`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'Reporte descargado.')
  }
  const navigation = admin
    ? [
        { label: 'Principal', items: [['inicio', 'Inicio']] },
        { label: 'Administración', items: [['usuarios', 'Gestión de usuarios']] },
      ]
    : [
        { label: 'Principal', items: [['inicio', 'Inicio'], ['tareas', 'Tareas']] },
        ...(fleetAccess ? [{ label: 'Flota', items: [['flota', 'Camiones'], ['mecanicos', 'Mecánicos']] }] : []),
        ...(inventoryAccess ? [{ label: 'Bodega', items: [['bodega', 'Inventario, compras y reportes']] }] : []),
        ...(admin ? [{ label: 'Administración', items: [['usuarios', 'Gestión de usuarios']] }] : []),
        ...(chief ? [{ label: 'Informes', items: [['reportes', 'Reportes de mantenimiento']] }] : []),
      ]
  const mobileNavigation = admin
    ? [
        { id: 'inicio', label: 'Inicio', icon: 'home' },
        { id: 'usuarios', label: 'Gestión de usuarios', icon: 'mechanics' },
      ]
    : [
        { id: 'inicio', label: 'Inicio', icon: 'home' },
        { id: 'tareas', label: 'Tareas', icon: 'tasks' },
        ...(fleetAccess ? [{ id: 'flota', label: 'Flota', icon: 'fleet' }] : []),
        ...(inventoryAccess ? [{ id: 'bodega', label: 'Bodega', icon: 'stock' }] : []),
        ...(fleetAccess ? [{ id: 'mecanicos', label: 'Mecánicos', icon: 'mechanics' }] : []),
      ]
  const logout = async () => {
    setMoreOpen(false)
    try { await onLogout() } catch (error) { setNotice({ error: true, message: error.message }) }
  }
  const saveProfile = async event => {
    event.preventDefault()
    setProfileBusy(true)
    setProfileError('')
    try {
      const form = new FormData(event.currentTarget)
      const result = await onUpdateUser({ nombre: form.get('nombre'), email: form.get('email') })
      setProfileOpen(false)
      setNotice({ message: result.mensaje || 'Perfil actualizado.', error: false })
    } catch (error) {
      setProfileError(error.response?.data?.mensaje || error.message || 'No se pudo actualizar el perfil.')
    } finally {
      setProfileBusy(false)
    }
  }
  const navigate = id => {
    setActiveSection(id)
    setMoreOpen(false)
  }
  const filtered = data?.tasks.filter(t => {
    const matchesStatus = !status || (status === 'done' ? ['Completada', 'Aprobada'].includes(t.estado) : t.estado === status)
    return matchesStatus && `${t.tipo_tarea} ${t.patente_camion} ${t.mecanicos || ''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))
  }) || []
  const counts = data ? ['Pendiente', 'En_Trabajo', 'Completada', 'Aprobada'].map(state => ({ state, total: data.tasks.filter(t => t.estado === state).length })) : []
  const inspectionCounts = data ? [
    { state: 'sin_cambios', label: 'Sin cambios' },
    { state: 'leve', label: 'Daño leve' },
    { state: 'moderado', label: 'Daño moderado' },
    { state: 'grave', label: 'Daño grave' },
    { state: 'inconcluso', label: 'Revisión manual' },
  ].map(item => ({ ...item, total: data.inspections.filter(inspection => inspection.nivel_dano === item.state).length })) : []
  const criticalStockItems = data?.inventory.filter(item => item.stock_estado === 'CRITICO') || []
  const mechanicProfiles = data?.kpis?.tareasMecanico || []
  const selectedMechanicProfile = mechanicProfiles.find(item => String(item.id) === String(selectedMechanic)) || mechanicProfiles[0]
  const mechanicHistoryMatches = selectedMechanicProfile && String(mechanicHistory?.mechanicId) === String(selectedMechanicProfile.id)
  const mechanicHistoryErrorMatches = selectedMechanicProfile && String(mechanicHistoryError?.mechanicId) === String(selectedMechanicProfile.id)
  const fleetTrucks = data?.kpis?.gastosCamion || []
  const activeFleetTrucks = fleetTrucks.filter(truck => truck.estado_operativo === 'activo' && (!fleetStatus || truck.estado_operativo === fleetStatus))
  const panneFleetTrucks = fleetTrucks.filter(truck => truck.estado_operativo === 'panne' && (!fleetStatus || truck.estado_operativo === fleetStatus))
  const latestFuelByTruck = new Map()
  for (const record of data?.fuelRecords || []) {
    const previous = latestFuelByTruck.get(record.patente)
    if (!previous || `${record.fecha} ${record.created_at || ''}` > `${previous.fecha} ${previous.created_at || ''}`) {
      latestFuelByTruck.set(record.patente, record)
    }
  }
  const lowFuelCount = [...latestFuelByTruck.values()].filter(record => Number(record.nivel) <= 25).length
  const normalFuelCount = [...latestFuelByTruck.values()].filter(record => Number(record.nivel) > 25).length
  const maintenanceRows = (data?.maintenancePlans || []).map(item => {
    const truck = data.trucks.find(candidate => candidate.patente === (item.patente || item.patente_camion))
    const currentKm = item.km_actual ?? truck?.km_actual
    const interval = Number(item.cada_km)
    const lastServiceKm = item.km_ultimo == null ? null : Number(item.km_ultimo)
    const nextKm = item.km_proximo ?? item.proximo_km ?? (
      Number.isFinite(interval) && interval > 0 && Number.isFinite(lastServiceKm) ? lastServiceKm + interval : null
    )
    const remaining = currentKm != null && nextKm != null ? Number(nextKm) - Number(currentKm) : null
    return { ...item, currentKm, nextKm, remaining, truck }
  })
  const filteredFleetTrucks = fleetTrucks.filter(truck => {
    const matchesStatus = !fleetStatus || truck.estado_operativo === fleetStatus
    const matchesSearch = `${truck.numero} ${truck.modelo} ${truck.patente}`.toLocaleLowerCase('es').includes(fleetSearch.toLocaleLowerCase('es'))
    return matchesStatus && matchesSearch
  })
  const hasFleetFilter = Boolean(fleetSearch.trim() || fleetStatus)
  const visibleFleetTrucks = hasFleetFilter || showAllFleetTrucks ? filteredFleetTrucks : filteredFleetTrucks.slice(0, 5)
  const latestInspectionFor = patente => data?.inspections.find(inspection => inspection.patente_camion === patente)
  useEffect(() => {
    if (!mechanicsView || !selectedMechanicProfile?.id) return undefined
    let active = true
    request('get', `/api/tareas/mecanico/${selectedMechanicProfile.id}`)
      .then(result => {
        if (active) setMechanicHistory({ mechanicId: selectedMechanicProfile.id, tasks: result.tareas || [] })
      })
      .catch(error => {
        if (active) setMechanicHistoryError({ mechanicId: selectedMechanicProfile.id, message: error.response?.data?.mensaje || error.message || 'No pudimos cargar el historial del mecánico.' })
      })
    return () => { active = false }
  }, [mechanicHistoryRefresh, mechanicsView, selectedMechanicProfile?.id])
  const taskActions = task => <div className="actions">
    {admin && <Button variant="danger" onClick={() => setDeletion({ url: `/api/tareas/eliminar/${task.id}`, label: `la tarea «${task.tipo_tarea}»` })}>Eliminar</Button>}
    {mechanic && task.estado === 'Pendiente' && <Button onClick={() => action(() => request('put', `/api/tareas/estado/${task.id}`, { estado: 'En_Trabajo' }), 'Tarea iniciada.')}>Iniciar tarea</Button>}
    {(admin || chief || mechanic && task.estado === 'En_Trabajo' || manager && ['Completada', 'Aprobada'].includes(task.estado)) && <Button variant="secondary" onClick={() => { setNotice(null); setDetail(task) }}>Ver detalle</Button>}
  </div>
  const recordEditor = kind => editor?.kind === kind && <RecordForm key={editor.initial?.id || editor.initial?.patente || kind} kind={kind} initial={editor.initial} mechanics={data.mechanics} trucks={data.trucks.filter(truck => truck.estado_operativo === 'activo')} showTaskPriority={manager} onCancel={() => setEditor(null)} onSubmit={async form => {
    const group = { truck: 'camiones', user: 'usuarios', task: 'tareas' }[kind]
    const id = kind === 'truck' ? encodeURIComponent(editor.initial?.patente) : editor.initial?.id
    const url = editor.initial ? `/api/${group}/editar/${id}` : `/api/${group}/${kind === 'task' ? 'crear' : 'agregar'}`
    if (await action(() => request(editor.initial ? 'put' : 'post', url, kind === 'task' ? { ...form, created_by: usuario.id } : form), result => result?.mensaje || 'Registro guardado correctamente.')) setEditor(null)
  }} />
  return <div className={`app-shell ${manager ? 'app-shell-encargado' : ''} ${admin ? 'app-shell-admin' : ''}`}>
    <a className="skip-link" href="#main-content">Ir al contenido</a>
    <header className="app-header">
      <a href="#main-content" className="header-brand"><Logo /></a>
      <div className="header-title"><strong>Mantenimiento</strong><span>Gestión de flota</span></div>
      <div className="user-info"><span className="user-avatar" aria-hidden="true">{usuario.nombre.trim().slice(0, 1).toUpperCase()}</span><span>{usuario.nombre}</span><small>{roles[usuario.rol]}</small></div>
      <button type="button" onClick={() => setMoreOpen(value => !value)} className="account-menu-button" aria-label="Abrir opciones de cuenta" aria-expanded={moreOpen}>Cuenta <span aria-hidden="true">⌄</span></button>
    </header>
    <nav id="main-nav" className="app-nav" aria-label="Navegación principal">{navigation.map(group => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span><div className="nav-group-links">{group.items.map(([id, label]) => <button type="button" key={id} aria-current={activeSection === id ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}</div></div>)}</nav>
    <main id="main-content" className={`main-content ${tasksView ? `main-content-tasks${manager ? ' main-content-tasks-encargado' : ''}` : ''} ${homeView && manager ? 'main-content-manager-home' : ''}`} tabIndex={-1}>
      <div className="page-intro"><p className="eyebrow">TRAVEL TRANS · OPERACIONES</p><h1>{homeView ? 'Inicio' : tasksView ? (mechanic ? 'Mis tareas' : 'Tareas') : mechanicsView ? 'Mecánicos' : usersView ? 'Gestión de usuarios' : maintenanceReportsView ? 'Reportes de mantenimiento' : inventoryView ? 'Bodega' : fleetView ? 'Flota' : 'Control de mantenimiento'}</h1><p>{homeView ? 'Resumen informativo de los módulos del taller.' : tasksView ? 'Asigna trabajos y consulta su estado y avance.' : mechanicsView ? 'Desempeño e historial de trabajos realizados por mecánico.' : usersView ? 'Agrega cuentas de usuario, actualiza sus datos o elimina cuentas.' : inventoryView ? 'Ingreso de productos, solicitudes de compra y reportes de inventario.' : fleetView ? 'Camiones activos e inspecciones previas de la flota.' : mechanic ? 'Revisa tus tareas, registra avances y mantén la flota en movimiento.' : 'Tu flota, tu equipo y cada tarea en un solo lugar.'}</p></div>
      {notice && !detail && !deletion && <div role={notice.error ? 'alert' : 'status'} className={`notice notice-${notice.error ? 'error' : 'success'}`}><span>{notice.message}</span><Button variant="secondary" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>×</Button></div>}
      {loadError ? <div role="alert" className="notice notice-error"><span>{loadError}</span><Button variant="secondary" onClick={() => { setLoadError(''); load().catch(() => setLoadError('No pudimos cargar el panel. Inténtalo nuevamente.')) }}>Reintentar</Button></div> : !data ? <div className="loading-state" role="status"><span className="spinner" />Cargando tu panel…</div> : <fieldset disabled={busy} aria-busy={busy} className="panel-content">
        {inventoryView ? <div className="bodega-page"><Inventory role={usuario.rol} refreshToken={inventoryRefresh} trucks={data.trucks} onAction={action} /><InventoryPurchases role={usuario.rol} onUpdated={refreshInventoryData} /><InventoryReports /></div> : usersView ? <Section title="Gestión de usuarios" action={<Button onClick={() => setEditor({ kind: 'user' })}>+ Agregar usuario</Button>}>
          {recordEditor('user')}
          {data.users.length ? <Table label="Usuarios del sistema" headings={['Nombre', 'Email', 'Rol', 'Acciones']}>{data.users.map(user => <tr key={user.id}><td><strong>{user.nombre}</strong></td><td>{user.email}</td><td>{roles[user.rol] || user.rol}</td><td><div className="actions"><Button variant="secondary" onClick={() => setEditor({ kind: 'user', initial: user })}>Editar</Button><Button variant="danger" onClick={() => { setNotice(null); setDeletion({ url: `/api/usuarios/eliminar/${user.id}`, label: `al usuario ${user.nombre}` }) }}>Eliminar</Button></div></td></tr>)}</Table> : <Empty>No hay usuarios registrados.</Empty>}
        </Section> : maintenanceReportsView ? <>
          <div className="financial-grid">{[['Gasto del mes', data.kpis.gastosMes], ['Últimos 7 días', data.kpis.gastosSemana], ['Gasto total', data.kpis.totalGastos]].map(([label, value]) => <div className="summary-card" key={label}><span>{label}</span><strong>{money(value)}</strong><span>Gastos registrados · CLP</span></div>)}</div>
          <Section title="Reportes de mantenimiento"><p className="section-description">Descarga el detalle de tareas y gastos en Excel. Selecciona un período o exporta todos los registros.</p><form className="report-form" onSubmit={e => { e.preventDefault(); exportReport(false) }}><Field label="Desde" type="date" value={range.start} onChange={e => setRange({ ...range, start: e.target.value })} /><Field label="Hasta" type="date" min={range.start || undefined} value={range.end} onChange={e => setRange({ ...range, end: e.target.value })} /><div className="actions"><Button type="submit">Exportar Excel</Button><Button variant="secondary" onClick={() => exportReport(true)}>Exportar todo</Button></div></form></Section>
        </> : mechanicsView ? <div className="mechanics-page">
          <Section title="Seleccionar mecánico">
            {mechanicProfiles.length ? <Field label="Mecánico" as="select" value={selectedMechanicProfile?.id || ''} onChange={event => setSelectedMechanic(event.target.value)}>{mechanicProfiles.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}</Field> : <Empty>No hay mecánicos registrados.</Empty>}
          </Section>
          {selectedMechanicProfile && <>
            <div className="mechanic-performance-grid">
              <div className="summary-card"><span>Trabajos asignados</span><strong>{selectedMechanicProfile.total_asignadas}</strong><span>Acumulado histórico</span></div>
              <div className="summary-card"><span>Trabajos finalizados</span><strong>{selectedMechanicProfile.completadas || 0}</strong><span>Completados o aprobados</span></div>
              <div className="summary-card"><span>En curso / pendientes</span><strong>{mechanicHistoryMatches ? mechanicHistory.tasks.filter(task => !['Completada', 'Aprobada'].includes(task.estado)).length : '—'}</strong><span>Asignaciones no finalizadas</span></div>
              <div className="summary-card"><span>Cumplimiento</span><strong>{selectedMechanicProfile.total_asignadas ? `${Math.round((selectedMechanicProfile.completadas || 0) / selectedMechanicProfile.total_asignadas * 100)}%` : '0%'}</strong><span>Finalizados sobre asignados</span></div>
            </div>
            <Section title={`Historial de trabajos · ${selectedMechanicProfile.nombre}`}>
              {mechanicHistoryMatches ? mechanicHistory.tasks.length ? <Table label={`Historial de trabajos de ${selectedMechanicProfile.nombre}`} headings={['Trabajo', 'Camión', 'Asignada', 'Finalizada', 'Estado', 'Detalle']}>
                {mechanicHistory.tasks.map(task => <tr key={task.id}><td><strong>{task.tipo_tarea}</strong></td><td>{task.patente_camion} · {task.modelo}</td><td>{date(task.fecha_creacion)}</td><td>{task.fecha_completada ? date(task.fecha_completada) : '—'}</td><td><Status value={task.estado} /></td><td><Button variant="secondary" onClick={() => setDetail(task)}>Ver</Button></td></tr>)}
              </Table> : <Empty>Este mecánico todavía no tiene trabajos asignados.</Empty> : mechanicHistoryErrorMatches ? <div role="alert" className="notice notice-error">{mechanicHistoryError.message}<Button variant="secondary" onClick={() => setMechanicHistoryRefresh(value => value + 1)}>Reintentar</Button></div> : <p className="loading-state" role="status">Cargando historial de trabajos…</p>}
            </Section>
          </>}
        </div> : fleetView ? <div id="flota" className={manager ? 'fleet-page-encargado' : ''}>
          {manager && <div className="fleet-mobile-view">
            <div className="fleet-mobile-heading"><span className="fleet-heading-icon"><NavigationIcon name="fleet" /></span><div><h2>Flota</h2><p>Gestión de vehículos</p></div></div>
            <div className="fleet-mobile-summary" aria-label="Resumen de flota">
              <div className="fleet-total"><span>Total de camiones</span><strong>{data.kpis.flota.total}</strong><span aria-hidden="true">🚚</span></div>
              <div className="fleet-summary-item fleet-summary-active"><span><i />Activos</span><strong>{data.kpis.flota.activos}</strong><span aria-hidden="true">♧</span></div>
              <div className="fleet-summary-item fleet-summary-inactive"><span><i />No activos</span><strong>{data.kpis.flota.enPanne}</strong><span aria-hidden="true">♧</span></div>
            </div>
            <div className="fleet-mobile-controls">
              <Field label="Buscar camiones" type="search" placeholder="Buscar camiones..." value={fleetSearch} onChange={event => setFleetSearch(event.target.value)} />
              <div className="fleet-mobile-filters" role="group" aria-label="Filtrar camiones por estado">
                {[['', 'Todos'], ['activo', 'Activos'], ['panne', 'No activos']].map(([value, label]) => <button key={value || 'all'} type="button" aria-pressed={fleetStatus === value} onClick={() => setFleetStatus(value)}>{label}</button>)}
              </div>
              <p className="fleet-result-count" aria-live="polite">{hasFleetFilter ? `${filteredFleetTrucks.length} camiones encontrados` : `Mostrando ${visibleFleetTrucks.length} de ${fleetTrucks.length} camiones`}</p>
            </div>
            {filteredFleetTrucks.length ? <div className="fleet-mobile-list" id="fleet-mobile-truck-list">
              {visibleFleetTrucks.map(truck => {
                const inspection = latestInspectionFor(truck.patente)
                const isActive = truck.estado_operativo === 'activo'
                const photo = inspection?.fotos?.frente
                return <article className={`fleet-mobile-card ${isActive ? 'fleet-mobile-card-active' : 'fleet-mobile-card-inactive'}`} key={truck.patente}>
                  {photo ? <img className="fleet-truck-photo" src={serverUrl + photo} alt={`Vista frontal de camión ${truck.numero}`} loading="lazy" decoding="async" /> : <span className="fleet-truck-photo fleet-truck-photo-empty" aria-hidden="true"><NavigationIcon name="fleet" /></span>}
                  <div className="fleet-card-info"><strong>{truck.numero} · {truck.modelo}</strong><span>⌖ {inspection?.ruta || truck.patente}</span><span>▦ Última inspección {inspection ? date(inspection.created_at || inspection.fecha) : 'Sin inspección'}</span></div>
                  <div className="fleet-card-status"><span className={`fleet-status-badge ${isActive ? 'fleet-status-active' : 'fleet-status-inactive'}`}><i />{isActive ? 'Activo' : 'No activo'}</span><button type="button" className="fleet-detail-link" onClick={() => setTruckProfile(truck)}>Ver detalle <span aria-hidden="true">›</span></button></div>
                </article>
              })}
            </div> : <Empty>{fleetTrucks.length ? 'No hay camiones que coincidan con la búsqueda.' : 'No hay camiones registrados.'}</Empty>}
            {!hasFleetFilter && filteredFleetTrucks.length > 5 && <button type="button" className="fleet-mobile-toggle" aria-expanded={showAllFleetTrucks} aria-controls="fleet-mobile-truck-list" onClick={() => setShowAllFleetTrucks(value => !value)}>
              {showAllFleetTrucks ? 'Mostrar menos camiones' : `Ver los ${filteredFleetTrucks.length - 5} camiones restantes`}
              <span aria-hidden="true">{showAllFleetTrucks ? '⌃' : '⌄'}</span>
            </button>}
            {!inspectionFormVisible && <Button className="fleet-mobile-register" onClick={() => document.getElementById('inspection-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>＋ Registrar inspección</Button>}
          </div>}
          <div className="fleet-kpi-grid">
            <div className="summary-card"><span>Flota total</span><strong>{data.kpis.flota.total}</strong><span>Camiones registrados</span></div>
            <div className="summary-card fleet-kpi-active"><span>Camiones activos</span><strong>{data.kpis.flota.activos}</strong><span>Disponibles para operar</span></div>
            <div className="summary-card fleet-kpi-panne"><span>Camiones en panne</span><strong>{data.kpis.flota.enPanne}</strong><span>Fuera de operación</span></div>
          </div>
          {fleetStatus !== 'panne' && <Section title="Camiones activos" className="fleet-desktop-section">
            <p className="section-description">Unidades disponibles actualmente para operar.</p>
            {activeFleetTrucks.length ? <div className="active-truck-grid">{activeFleetTrucks.map(truck => <article className="active-truck-card" key={truck.patente}>
              <span className="truck-active-badge">Activo</span><h3>{truck.numero} · {truck.modelo}</h3><p className="truck-plate">{truck.patente}</p><p>Gasto acumulado: <strong>{money(truck.total_gasto)}</strong></p><Button variant="danger" onClick={() => action(() => request('put', `/api/camiones/estado/${encodeURIComponent(truck.patente)}`, { estado_operativo: 'panne' }), `${truck.patente} quedó marcado en panne.`)}>Marcar en panne</Button>
            </article>)}</div> : <Empty>No hay camiones activos que coincidan con el filtro.</Empty>}
          </Section>}
          {(fleetStatus === 'panne' || panneFleetTrucks.length > 0) && <Section title="Camiones fuera de servicio" className="fleet-desktop-section">
            {panneFleetTrucks.length ? <div className="active-truck-grid">{panneFleetTrucks.map(truck => <article className="active-truck-card truck-inactive-card" key={truck.patente}>
              <span className="truck-inactive-badge">En panne</span><h3>{truck.numero} · {truck.modelo}</h3><p className="truck-plate">{truck.patente}</p><p>Gasto acumulado: <strong>{money(truck.total_gasto)}</strong></p><Button variant="success" onClick={() => action(() => request('put', `/api/camiones/estado/${encodeURIComponent(truck.patente)}`, { estado_operativo: 'activo' }), `${truck.patente} volvió a estar activo.`)}>Marcar activo</Button>
            </article>)}</div> : <Empty>No hay camiones en panne que coincidan con el filtro.</Empty>}
          </Section>}
          {admin && <Section title="Administrar camiones" action={<Button onClick={() => setEditor({ kind: 'truck' })}>+ Agregar camión</Button>}>
            {recordEditor('truck')}
            {data.trucks.length ? <Table label="Camiones registrados" headings={['Patente', 'Número', 'Modelo', 'Estado', 'Acciones']}>{data.trucks.map(truck => <tr key={truck.patente}><td><strong>{truck.patente}</strong></td><td>{truck.numero}</td><td>{truck.modelo}</td><td>{truck.estado_operativo === 'panne' ? 'En panne' : 'Activo'}</td><td><div className="actions"><Button variant="secondary" onClick={() => setEditor({ kind: 'truck', initial: truck })}>Editar</Button><Button variant="danger" onClick={() => { setNotice(null); setDeletion({ url: `/api/camiones/eliminar/${encodeURIComponent(truck.patente)}`, label: `el camión ${truck.patente}` }) }}>Eliminar</Button></div></td></tr>)}</Table> : <Empty>No hay camiones registrados.</Empty>}
          </Section>}
          <Section title="Inspección previa y daños" className="fleet-inspection-section">
            <DamageInspections role={usuario.rol} trucks={data.trucks} inspections={data.inspections} onAction={action} selectedTruck={fleetHistoryTruck} onSelectedTruckChange={setFleetHistoryTruck} />
          </Section>
        </div> : <>
        {homeView && manager && <section className="manager-dashboard">
          <div className="manager-dashboard-heading"><p className="eyebrow">PANEL DE OPERACIONES</p><h2>Estado general del taller</h2><p>Resumen actualizado de tareas, vehículos e inspecciones.</p></div>
          <div className="manager-quick-actions" aria-label="Acciones rápidas">
            <Button className="manager-quick-action" onClick={() => { setStatus(''); navigate('tareas'); setEditor({ kind: 'task' }) }}>＋ Nueva OT / Asignar</Button>
            <Button variant="secondary" className="manager-quick-action manager-quick-action-secondary" onClick={() => { purchaseRequestJump.current = true; navigate('bodega') }}>＋ Solicitar Repuesto</Button>
          </div>
          {criticalStockItems.length > 0 && <section className="manager-stock-alert" role="status" aria-label="Alerta de stock crítico">
            <div className="manager-stock-alert-heading"><span className="manager-stock-alert-icon" aria-hidden="true">!</span><div><h3>Alerta de stock crítico</h3><p>{criticalStockItems.length} repuesto{criticalStockItems.length === 1 ? '' : 's'} con stock igual o inferior al mínimo</p></div></div>
            <ul>{criticalStockItems.slice(0, 4).map(item => <li key={item.id}><span>{item.nombre}</span><strong>{item.stock_actual} / mín. {item.stock_minimo}</strong></li>)}</ul>
            {criticalStockItems.length > 4 && <p className="manager-stock-alert-more">Y {criticalStockItems.length - 4} repuesto{criticalStockItems.length - 4 === 1 ? '' : 's'} más requieren reposición.</p>}
          </section>}
          <div className="manager-dashboard-grid">
            <section className="manager-status-card manager-task-status">
              <div className="manager-status-heading"><span className="manager-status-icon"><NavigationIcon name="tasks" /></span><div><h3>Tareas</h3><span>{data.tasks.length} registradas</span></div></div>
              <button type="button" className="manager-status-total manager-status-button" onClick={() => { setStatus(''); navigate('tareas') }}><strong>{data.tasks.length}</strong><span>Total de tareas · Ver todas</span></button>
              <div className="manager-status-list">
                {counts.map(({ state, total }) => <button type="button" className="manager-status-row manager-status-button" key={state} onClick={() => { setStatus(state); navigate('tareas') }}><span className={`manager-status-dot task-dot-${state}`} /><span>{state === 'Pendiente' ? 'Pendientes' : state === 'En_Trabajo' ? 'En trabajo' : state === 'Completada' ? 'Pendiente de aprobación' : 'Aprobadas'}</span><strong>{total}</strong></button>)}
              </div>
            </section>
            <section className="manager-status-card manager-fleet-status">
              <div className="manager-status-heading"><span className="manager-status-icon"><NavigationIcon name="fleet" /></span><div><h3>Flota</h3><span>{data.kpis.flota.total} camiones registrados</span></div></div>
              <button type="button" className="manager-status-total manager-status-button" onClick={() => { setFleetStatus(''); navigate('flota') }}><strong>{data.kpis.flota.total}</strong><span>Total de camiones · Ver flota</span></button>
              <div className="manager-status-list">
                <button type="button" className="manager-status-row manager-status-button" onClick={() => { setFleetStatus('activo'); setFleetSearch(''); navigate('flota') }}><span className="manager-status-dot fleet-dot-active" /><span>Activos</span><strong>{data.kpis.flota.activos}</strong></button>
                <button type="button" className="manager-status-row manager-status-button" onClick={() => { setFleetStatus('panne'); setFleetSearch(''); navigate('flota') }}><span className="manager-status-dot fleet-dot-inactive" /><span>No activos · en panne</span><strong>{data.kpis.flota.enPanne}</strong></button>
              </div>
              <div className="manager-fleet-telemetry">
                <div className="manager-telemetry-heading"><strong>Combustible</strong><span>Bajo ≤25% · Normal &gt;25%</span></div>
                <div className="manager-fuel-summary">
                  <span className="manager-telemetry-badge manager-telemetry-badge-low">Bajo <strong>{lowFuelCount}</strong></span>
                  <span className="manager-telemetry-badge manager-telemetry-badge-normal">Normal <strong>{normalFuelCount}</strong></span>
                  <span className="manager-telemetry-badge">Sin lectura <strong>{Math.max(0, data.trucks.length - latestFuelByTruck.size)}</strong></span>
                </div>
                <div className="manager-telemetry-heading manager-km-heading"><strong>Mantención por kilometraje</strong><span className="manager-gps-badge">GPS</span></div>
                {maintenanceRows.length ? <ul className="manager-maintenance-list">{maintenanceRows.slice(0, 4).map((item, index) => {
                  const dueLabel = item.remaining == null ? 'Sin lectura GPS' : item.remaining <= 0 ? 'Vencida' : item.remaining <= 1000 ? `Próxima · ${Number(item.remaining).toLocaleString('es-CL')} km` : 'En plazo'
                  const dueClass = item.remaining == null ? 'unknown' : item.remaining <= 0 ? 'overdue' : item.remaining <= 1000 ? 'soon' : 'ok'
                  return <li key={`${item.patente || item.patente_camion || 'truck'}-${item.id || item.id_plan || index}`}>
                    <span><strong>{item.numero || item.truck?.numero || item.patente || item.patente_camion}</strong><small>{item.nombre || item.nombre_plan || item.plan || 'Plan de mantención'}</small></span>
                    <span className="manager-km-values">{item.currentKm == null ? '—' : `${Number(item.currentKm).toLocaleString('es-CL')} km`} <i>→</i> {item.nextKm == null ? '—' : `${Number(item.nextKm).toLocaleString('es-CL')} km`}<small>actual → próxima</small></span>
                    <span className={`manager-maintenance-badge manager-maintenance-${dueClass}`}>{dueLabel}</span>
                  </li>
                })}</ul> : <p className="manager-telemetry-empty">No hay planes de kilometraje asignados.</p>}
                {data.telemetryErrors.map(error => <p role="status" className="manager-telemetry-error" key={error.label}><strong>{error.label}:</strong> {error.message}</p>)}
              </div>
            </section>
            <section className="manager-status-card manager-inspection-status">
              <div className="manager-status-heading"><span className="manager-status-icon"><span aria-hidden="true">✓</span></span><div><h3>Inspecciones</h3><span>{data.inspections.length} revisiones registradas</span></div></div>
              <div className="manager-status-total"><strong>{data.inspections.length}</strong><span>Total de inspecciones</span></div>
              <div className="manager-status-list">
                {inspectionCounts.map(({ state, label, total }) => <div className="manager-status-row" key={state}><span className={`manager-status-dot inspection-dot-${state}`} /><span>{label}</span><strong>{total}</strong></div>)}
                <div className="manager-inspection-baseline">{data.inspections.filter(inspection => inspection.estado_analisis === 'linea_base').length} inspecciones iniciales de referencia</div>
              </div>
            </section>
          </div>
        </section>}
        {homeView && !manager && <section className="overview-hero">
          <div className="overview-copy"><p className="eyebrow">PANEL DE OPERACIONES</p><h2>Resumen general del taller</h2><p>Indicadores informativos de tareas, flota, equipo mecánico y bodega.</p></div>
          <div className="overview-summary"><div><strong>{data.tasks.length}</strong><span>{mechanic ? 'Tareas asignadas' : 'Tareas activas y registradas'}</span></div><div><strong>{fleetAccess ? data.kpis.flota.total : counts.find(item => item.state === 'En_Trabajo')?.total || 0}</strong><span>{fleetAccess ? 'Camiones en flota' : 'En trabajo'}</span></div></div>
        </section>}
        {homeView && !manager && <div className="overview-module-grid" aria-label="Resumen de módulos">
          <article className="overview-module"><span className="overview-module-icon"><NavigationIcon name="tasks" /></span><span className="overview-module-copy"><strong>Tareas</strong><small>{data.tasks.length} asignadas · {counts.find(item => item.state === 'En_Trabajo')?.total || 0} en trabajo</small></span><span className="overview-module-value">{data.tasks.length}</span></article>
          {fleetAccess && <article className="overview-module"><span className="overview-module-icon"><NavigationIcon name="fleet" /></span><span className="overview-module-copy"><strong>Flota</strong><small>{data.kpis.flota.activos} activos · {data.kpis.flota.enPanne} en panne</small></span><span className="overview-module-value">{data.kpis.flota.activos}</span></article>}
          {fleetAccess && <article className="overview-module"><span className="overview-module-icon"><NavigationIcon name="mechanics" /></span><span className="overview-module-copy"><strong>Mecánicos</strong><small>{mechanicProfiles.length} en el equipo</small></span><span className="overview-module-value">{mechanicProfiles.length}</span></article>}
          {inventoryAccess && <article className="overview-module"><span className="overview-module-icon overview-module-icon-red"><NavigationIcon name="stock" /></span><span className="overview-module-copy"><strong>Bodega</strong><small>{data.inventory.length} productos · {data.inventory.filter(item => item.stock_estado !== 'ADECUADO').length} bajo o crítico</small></span><span className="overview-module-value">{data.inventory.length}</span></article>}
          {inventoryAccess && <article className="overview-module"><span className="overview-module-icon overview-module-icon-red" aria-hidden="true">▣</span><span className="overview-module-copy"><strong>Compras</strong><small>{data.purchases.filter(item => item.estado === 'PENDIENTE').length} solicitudes pendientes</small></span><span className="overview-module-value">{data.purchases.length}</span></article>}
          {fleetAccess && <article className="overview-module"><span className="overview-module-icon"><span aria-hidden="true">✓</span></span><span className="overview-module-copy"><strong>Inspecciones</strong><small>Historial de daños en camiones</small></span><span className="overview-module-value">{data.inspections.length}</span></article>}
        </div>}
        {homeView && !manager && <>
        <div className="summary-grid">{counts.map(({ state, total }) => <div className="summary-card" key={state}><Status value={state} /><strong>{total}</strong><span>{mechanic ? 'Tareas asignadas' : 'Tareas registradas'}</span></div>)}</div>
        
        </>}
        {tasksView && <Section id="tareas" title={mechanic ? 'Mis tareas' : 'Tareas de mantenimiento'} action={canCreate && <Button onClick={() => setEditor({ kind: 'task' })}>+ Nueva tarea</Button>}>
          <div className="task-mobile-heading"><span className="task-heading-icon"><NavigationIcon name="tasks" /></span><div><h2>{mechanic ? 'Mis tareas' : 'Tareas'}</h2><p>Gestión de tareas del taller</p></div></div>
          <div className="task-mobile-summary" aria-label="Resumen de tareas">
            <div className="task-total"><span>Total de tareas</span><strong>{data.tasks.length}</strong><span className="task-total-icon" aria-hidden="true">▤</span></div>
            <div className="task-summary-item task-summary-pending"><span className="task-summary-symbol" aria-hidden="true">◷</span><strong>{data.tasks.filter(task => task.estado === 'Pendiente').length}</strong><span>Pendientes</span></div>
            <div className="task-summary-item task-summary-progress"><span className="task-summary-symbol" aria-hidden="true">◌</span><strong>{data.tasks.filter(task => task.estado === 'En_Trabajo').length}</strong><span>En progreso</span></div>
            <div className="task-summary-item task-summary-completed"><span className="task-summary-symbol" aria-hidden="true">✓</span><strong>{data.tasks.filter(task => ['Completada', 'Aprobada'].includes(task.estado)).length}</strong><span>Completadas</span></div>
          </div>
          <div className="task-status-grid task-desktop-status">{counts.map(({ state, total }) => <div className="task-status-card" key={state}><Status value={state} /><strong>{total}</strong></div>)}</div>
          {recordEditor('task')}
          {data.tasks.length > 0 && <div className={`task-filters ${manager ? 'task-desktop-filters' : ''}`}><Field label="Buscar tarea o patente" type="search" placeholder="Ej.: Embrague o ABC-123" value={search} onChange={e => setSearch(e.target.value)} /><Field label="Estado" as="select" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option>{manager && <option value="done">Completadas</option>}{counts.map(c => <option key={c.state} value={c.state}>{c.state.replaceAll('_', ' ')}</option>)}</Field><p aria-live="polite">{filtered.length} de {data.tasks.length} tareas</p></div>}
          <div className="task-mobile-controls">
            <Field label="Buscar tareas" type="search" placeholder="Buscar tareas..." value={search} onChange={e => setSearch(e.target.value)} />
            <div className="task-mobile-filters" role="group" aria-label="Filtrar tareas por estado">
              {[['', 'Todas'], ['Pendiente', 'Pendientes'], ['En_Trabajo', 'En progreso'], ['done', 'Completadas']].map(([value, label]) => <button key={value || 'all'} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}
            </div>
            <p className="task-mobile-result-count" aria-live="polite">{filtered.length} de {data.tasks.length} tareas</p>
          </div>
          {!filtered.length ? <Empty>{data.tasks.length ? 'No hay tareas que coincidan con los filtros.' : mechanic ? 'No tienes tareas asignadas.' : 'No hay tareas registradas todavía.'}</Empty> : <>
            <div className="task-mobile-list" aria-label="Listado de tareas">
              {filtered.map(task => {
                const canOpen = admin || chief || manager || mechanic && task.estado === 'En_Trabajo'
                const open = () => { if (canOpen) { setNotice(null); setDetail(task) } }
                return <article key={task.id} className={`task-mobile-row ${task.vencida ? 'task-mobile-row-overdue' : ''} ${canOpen ? 'task-mobile-row-clickable' : ''}`} role={canOpen ? 'button' : undefined} tabIndex={canOpen ? 0 : undefined} onClick={open} onKeyDown={event => { if (canOpen && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }}>
                  <span className={`task-row-status-icon task-row-status-${task.estado}`} aria-hidden="true">{task.estado === 'Pendiente' ? '◷' : task.estado === 'En_Trabajo' ? '◌' : '✓'}</span>
                  <span className="task-row-main"><strong>{task.tipo_tarea}</strong><span>🚚 Camión {task.numero || task.patente_camion}{task.numero ? ` · ${task.patente_camion}` : ''}</span><span>♟ {task.mecanicos || (mechanic ? usuario.nombre : 'Sin mecánico asignado')}</span></span>
                  <span className="task-row-meta"><span className={`task-row-state-label task-row-state-${task.estado}`}><i />{task.estado === 'En_Trabajo' ? 'En progreso' : task.estado === 'Aprobada' ? 'Completada' : task.estado === 'Completada' ? 'Por aprobar' : 'Pendiente'}</span><span className="task-row-date">▦ {date(task.fecha_limite)}</span><span className={`task-row-priority task-priority-${task.prioridad || 'Media'}`}>⚑ {task.prioridad || 'Media'}</span>{!!task.vencida && <span className="task-row-overdue">Atrasada</span>}</span>
                  <span className="task-row-chevron" aria-hidden="true">›</span>
                  <span className="task-row-actions" onClick={event => event.stopPropagation()}>{taskActions(task)}</span>
                </article>
              })}
            </div>
            <div className="task-desktop-list">{admin || chief ? <Table label="Tareas de mantenimiento" headings={['Tarea', 'Patente', 'Fecha límite', ...(manager ? ['Prioridad'] : []), 'Estado', 'Acciones']}>{filtered.map(t => <tr key={t.id}><td><strong>{t.tipo_tarea}</strong>{!!t.vencida && <small className="overdue">Aplazada {t.veces_aplazada} {Number(t.veces_aplazada) === 1 ? 'vez' : 'veces'}</small>}</td><td>{t.patente_camion}</td><td>{date(t.fecha_limite)}</td>{manager && <td>{t.prioridad || 'Media'}</td>}<td><Status value={t.estado} /></td><td>{taskActions(t)}</td></tr>)}</Table> : <div className="task-grid">{filtered.map(t => <article key={t.id} className={`task-card ${t.vencida ? 'task-overdue' : ''}`}><div className="section-heading"><h3>{t.tipo_tarea}</h3><Status value={t.estado} /></div><p className="detail-meta">{t.patente_camion} · {t.modelo}</p><p className="detail-meta">Fecha límite: {date(t.fecha_limite)}</p>{manager && <p className={`detail-meta task-priority-${t.prioridad || 'Media'}`}>Prioridad: {t.prioridad || 'Media'}</p>}{!!t.vencida && <p className="overdue">Aplazada {t.veces_aplazada} {Number(t.veces_aplazada) === 1 ? 'vez' : 'veces'}</p>}{t.descripcion && <p className="detail-description">{t.descripcion}</p>}{taskActions(t)}</article>)}</div>}</div>
          </>}
          {manager && canCreate && <Button className="task-mobile-new" onClick={() => setEditor({ kind: 'task' })}>＋ Nueva tarea</Button>}
        </Section>}
        </>}
      </fieldset>}
    </main>
    {moreOpen && <><button type="button" className="more-backdrop" aria-label="Cerrar menú de cuenta" onClick={() => setMoreOpen(false)} /><div className="more-menu" role="dialog" aria-label="Opciones de cuenta">
      <div className="more-menu-heading"><strong>Cuenta</strong><button type="button" aria-label="Cerrar" onClick={() => setMoreOpen(false)}>×</button></div>
      <button type="button" className="more-menu-item" onClick={() => { setProfileError(''); setProfileOpen(true); setMoreOpen(false) }}>Editar perfil<span aria-hidden="true">›</span></button>
      <button type="button" className="more-menu-item more-logout" onClick={logout}>Cerrar sesión<span aria-hidden="true">↗</span></button>
    </div></>}
    <nav className="mobile-bottom-nav" aria-label="Navegación móvil" style={{ gridTemplateColumns: `repeat(${mobileNavigation.length + (admin ? 0 : 1)}, minmax(0, 1fr))` }}>
      {mobileNavigation.map(({ id, label, icon }) => {
        const selected = activeSection === id
        return <button type="button" key={id} className={`mobile-nav-item ${selected ? 'is-active' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => navigate(id)}><NavigationIcon name={icon} /><span>{label}</span></button>
      })}
      {!admin && <button type="button" className={`mobile-nav-item ${moreOpen ? 'is-active' : ''}`} aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><NavigationIcon name="more" /><span>Más</span></button>}
    </nav>
    {profileOpen && <Modal title="Editar perfil" onClose={() => !profileBusy && setProfileOpen(false)}><div className="modal-content">
      <h2>Editar perfil</h2>
      <p className="detail-description">Actualiza el nombre y correo asociados a tu cuenta.</p>
      {profileError && <p role="alert" className="notice notice-error">{profileError}</p>}
      <form className="profile-form" onSubmit={saveProfile}>
        <Field label="Nombre" name="nombre" defaultValue={usuario.nombre} maxLength={100} required />
        <Field label="Correo electrónico" name="email" type="email" defaultValue={usuario.email} maxLength={100} required />
        <div className="actions"><Button type="submit" disabled={profileBusy}>{profileBusy ? 'Guardando…' : 'Guardar perfil'}</Button><Button variant="secondary" disabled={profileBusy} onClick={() => setProfileOpen(false)}>Cancelar</Button></div>
      </form>
    </div></Modal>}
    {detail && <TaskDetail key={detail.id} task={detail} role={usuario.rol} busy={busy} notice={notice} onClose={() => setDetail(null)} onAction={action} />}
    {truckProfile && <TruckProfile truck={truckProfile} inspections={data?.inspections || []} onClose={() => setTruckProfile(null)} />}
    {deletion && <Modal title="Confirmar eliminación" onClose={() => !busy && setDeletion(null)}><div className="modal-content"><h2>Confirmar eliminación</h2><p className="detail-description">¿Quieres eliminar {deletion.label}? Esta acción no se puede deshacer.</p>{notice?.error && <p role="alert" className="notice notice-error">{notice.message}</p>}<div className="actions"><Button variant="danger" disabled={busy} onClick={async () => { if (await action(() => request('delete', deletion.url), 'Registro eliminado.')) setDeletion(null) }}>Eliminar</Button><Button variant="secondary" disabled={busy} onClick={() => setDeletion(null)}>Cancelar</Button></div></div></Modal>}
    {busy && <p role="status" className="request-status">Procesando…</p>}
  </div>
}
