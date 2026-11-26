import { useEffect, useState } from 'react'

function standalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export default function InstallPwa() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(standalone)
  const [dismissed, setDismissed] = useState(false)
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    const available = event => { event.preventDefault(); setInstallPrompt(event) }
    const complete = () => { setInstallPrompt(null); setInstalled(true) }
    window.addEventListener('beforeinstallprompt', available)
    window.addEventListener('appinstalled', complete)
    return () => {
      window.removeEventListener('beforeinstallprompt', available)
      window.removeEventListener('appinstalled', complete)
    }
  }, [])

  if (installed || dismissed || (!installPrompt && !ios)) return null

  return <aside className="pwa-install" aria-label="Instalar aplicación">
    <button className="pwa-install-close" type="button" aria-label="Cerrar sugerencia de instalación" onClick={() => setDismissed(true)}>×</button>
    <img src="/pwa-64x64.png" alt="" aria-hidden="true" />
    <div>
      <strong>Instalar aplicación</strong>
      {installPrompt
        ? <button className="pwa-install-action" type="button" onClick={async () => {
          await installPrompt.prompt()
          await installPrompt.userChoice
          setInstallPrompt(null)
        }}>Instalar en este dispositivo</button>
        : <small>En iPhone o iPad: pulsa Compartir y luego “Agregar a inicio”.</small>}
    </div>
  </aside>
}
