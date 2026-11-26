import axios from 'axios'

export const serverUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const api = axios.create({ baseURL: serverUrl, timeout: 20000, withCredentials: true, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
export default api
export async function request(method, url, data, config) {
  const response = await api.request({ method, url, data, ...config })
  if (response.data?.success === false) throw new Error(response.data.mensaje || 'No se pudo completar la operación.')
  return response.data
}
// Sube una foto o video del antes/después de una tarea; los videos pueden tardar, por eso el progreso.
export const uploadMedia = (taskId, file, momento, onProgress) => {
  const body = new FormData()
  body.append('archivo', file)
  return request('post', `/api/evidencia/media/${taskId}?momento=${momento}`, body, { timeout: 600000, onUploadProgress: e => onProgress?.(e.total ? Math.round(e.loaded / e.total * 100) : null) })
}

// Descarga un archivo del API (Excel) con la sesión actual.
export async function download(url, filename) {
  const blob = await request('get', url, undefined, { responseType: 'blob' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

// Ya no se envía nada por WhatsApp: se guarda en el sistema y el aviso queda en la campana de la app.
export const withWhatsapp = (onAction, operation, message) => onAction(operation, message)
