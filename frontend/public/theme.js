// Tema claro u oscuro: sigue al del sistema salvo que la persona elija uno (guardado en este navegador).
// Se carga en <head>, antes de pintar, para que la página no destelle en blanco al abrir en modo oscuro.
(function () {
  var media = window.matchMedia('(prefers-color-scheme: dark)')
  function choice() { try { return localStorage.getItem('tema') || 'sistema' } catch { return 'sistema' } }
  function apply() {
    var mode = choice(), dark = mode === 'oscuro' || (mode === 'sistema' && media.matches)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', dark ? '#161618' : '#FFFFFF')
  }
  apply()
  media.addEventListener('change', apply)
  window.temaTravel = {
    get: choice,
    set: function (mode) { try { localStorage.setItem('tema', mode) } catch { /* sin almacenamiento: vale solo esta visita */ } apply() },
  }
})()
