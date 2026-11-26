import axios from 'axios'

export const serverUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const api = axios.create({ baseURL: serverUrl, timeout: 20000, withCredentials: true, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
export default api
export async function request(method, url, data, config) {
  const response = await api.request({ method, url, data, ...config })
  if (response.data?.success === false) throw new Error(response.data.mensaje || 'No se pudo completar la operación.')
  return response.data
}
