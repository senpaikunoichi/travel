import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

// App instalada: busca una versión nueva al abrir y cada vez que se vuelve a ella. Se actualiza sola solo si no hay una
// OT ni un formulario abierto; si lo hay, muestra el aviso «Actualizar» para no perder lo que se está escribiendo.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const busy = document.querySelector('dialog[open], form.editor, #fuel-form, .fault-form')
    if (busy) window.dispatchEvent(new CustomEvent('app-update', { detail: () => updateSW(true) }))
    else updateSW(true)
  },
  onRegisteredSW(url, registration) {
    if (!registration) return
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update().catch(() => {}) })
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
