import { useCallback, useState } from 'react'

// Borrador de un formulario guardado en este teléfono: si la app se cierra o se recarga, lo escrito sigue ahí.
// Solo texto: las fotos no se pueden guardar así y hay que volver a adjuntarlas.
export function useDraft(key, initial) {
  const [value, setValue] = useState(() => {
    try { const saved = localStorage.getItem(`borrador:${key}`); return saved ? { ...initial, ...JSON.parse(saved) } : initial } catch { return initial }
  })
  const update = useCallback(next => setValue(current => {
    const resolved = typeof next === 'function' ? next(current) : next
    try { localStorage.setItem(`borrador:${key}`, JSON.stringify(resolved)) } catch { /* sin almacenamiento: solo en memoria */ }
    return resolved
  }), [key])
  const clear = useCallback(() => {
    try { localStorage.removeItem(`borrador:${key}`) } catch { /* nada que borrar */ }
    setValue(initial)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [value, update, clear]
}
