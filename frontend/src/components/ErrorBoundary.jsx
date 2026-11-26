import { Component } from 'react'
import { reportError } from '../report'

// Si una pantalla falla, se muestra un aviso en vez de que la app desaparezca; lo escrito queda en los borradores.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error, info) { reportError('pantalla', error?.message || error, `${error?.stack || ''} ${info?.componentStack || ''}`) }
  render() {
    if (!this.state.failed) return this.props.children
    return <div className="login-page"><div className="login-card" role="alert">
      <h1>Algo falló</h1>
      <p className="login-description">Ya avisamos del error. Lo que estabas escribiendo quedó guardado: vuelve a abrir la OT.</p>
      <button type="button" className="button button-primary button-block" onClick={() => window.location.reload()}>Volver a la app</button>
    </div></div>
  }
}
