// Use the same-origin API in development so Vite can proxy it to Express.
// For a deployed frontend, set VITE_API_URL to the public backend URL ending in /api.
export const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export const apiFetch = (url, options = {}) => {
  const token = sessionStorage.getItem('auth-token')
  const headers = new Headers(options.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...options, headers }).then((response) => {
    if (response.status === 401 && token) {
      response.clone().json().then((body) => {
        // Only an authentication middleware response ends the local session.
        // Business 401s (for example, an incorrect current password) keep it intact.
        if (body?.code !== 'AUTH_TOKEN_INVALID' || sessionStorage.getItem('auth-token') !== token) return
        sessionStorage.removeItem('auth-token')
        window.dispatchEvent(new Event('auth-expired'))
      }).catch(() => {})
    }
    return response
  })
}
