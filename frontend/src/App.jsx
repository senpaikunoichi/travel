import { useState, useEffect } from 'react'
import axios from './api'
import Dashboard from './Dashboard'
import InstallPwa from './components/InstallPwa'
import { Button, Field, Logo } from './components/UI'

// El jefe no tiene permiso para aplazar tareas; los demás roles verifican vencidas al entrar.
async function checkOverdue(usuario) {
  if (usuario.rol === 'jefe') return null
  try {
    await axios.post('/api/tareas/verificar-vencidas')
    return null
  } catch {
    return { error: true, message: 'Ingresaste correctamente, pero no pudimos verificar las tareas vencidas. Revisa sus fechas antes de continuar.' }
  }
}

function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [usuario, setUsuario] = useState(null)
  const [startupNotice, setStartupNotice] = useState(null)
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(response => response, error => {
      if (error.response?.status === 401 && !['/api/login', '/api/auth/me'].includes(error.config?.url)) {
        setUsuario(null)
        setPassword('')
        setStartupNotice(null)
        setError('Tu sesión terminó. Inicia sesión nuevamente.')
      }
      return Promise.reject(error)
    })
    return () => axios.interceptors.response.eject(interceptor)
  }, [])

  // Recupera la sesión vigente al recargar o reabrir la aplicación instalada.
  useEffect(() => {
    let active = true
    axios.get('/api/auth/me')
      .then(async response => {
        const notice = await checkOverdue(response.data.usuario)
        if (active) { setStartupNotice(notice); setUsuario(response.data.usuario) }
      })
      .catch(() => {})
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const response = await axios.post('/api/login', { email, password })
      if (response.data.success) {
        setStartupNotice(await checkOverdue(response.data.usuario))
        setUsuario(response.data.usuario)
      } else {
        setError(response.data.mensaje)
      }
    } catch (err) {
      setError(err.response?.status === 401 ? 'Email o contraseña incorrectos.' : err.response?.data?.mensaje || 'No pudimos conectar con el servicio. Inténtalo nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await axios.post('/api/logout')
    } catch {
      throw new Error('No pudimos cerrar la sesión en el servidor. Inténtalo nuevamente.')
    }
    setUsuario(null)
    setEmail('')
    setPassword('')
    setError('')
    setStartupNotice(null)
  }

  const handleProfileUpdate = async profile => {
    const response = await axios.put('/api/auth/profile', profile)
    setUsuario(response.data.usuario)
    return response.data
  }

  if (usuario) {
    return <><Dashboard usuario={usuario} onLogout={handleLogout} onUpdateUser={handleProfileUpdate} initialNotice={startupNotice} /><InstallPwa /></>
  }

  if (checking) {
    return <div className="login-page"><div className="loading-state" role="status"><span className="spinner" />Cargando…</div></div>
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <Logo className="login-logo" />
        <p className="eyebrow">GESTIÓN DE FLOTA</p>
        <h1>Mantenimiento</h1>
        <p className="login-description">Ingresa para gestionar las tareas y el mantenimiento de nuestra flota.</p>
        {error && <p role="alert" className="notice notice-error">{error}</p>}
        <form className="login-form" onSubmit={handleLogin}>
          <Field label="Email" autoComplete="username" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" required />
          <Field label="Contraseña" autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          <Button type="submit" disabled={loading} className="button button-primary button-block">{loading ? 'Ingresando…' : 'Iniciar sesión'}</Button>
        </form>
        <InstallPwa />
        <p className="login-footer">Travel Trans Logística · Transporte y logística</p>
      </div>
    </div>
  )
}

export default App
