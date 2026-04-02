import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/v1'

async function getToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  // Prefer in-memory session from authStore — kept current by onAuthStateChange in Providers
  const storeToken = useAuthStore.getState().session?.access_token
  if (storeToken) return storeToken
  // Fallback: read from Supabase client storage (covers cold-load before authStore hydrates)
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

interface RequestOptions {
  params?: Record<string, any>
  headers?: Record<string, string>
}

async function request(method: string, path: string, body?: any, options: RequestOptions = {}) {
  const token = await getToken()
  const url = new URL(API_URL + path)
  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    })
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    // FastAPI validation errors return detail as an array of {loc, msg, type} objects
    const detail = Array.isArray(err.detail)
      ? err.detail.map((d: any) => d.msg ?? JSON.stringify(d)).join(', ')
      : err.detail
    throw new Error(err.error?.message || detail || 'Request failed')
  }

  if (res.status === 204) return null
  const json = await res.json()
  return json
}

export const apiClient = {
  get: (path: string, options?: RequestOptions) => request('GET', path, undefined, options),
  post: (path: string, body?: any, options?: RequestOptions) => request('POST', path, body, options),
  patch: (path: string, body?: any, options?: RequestOptions) => request('PATCH', path, body, options),
  delete: (path: string, options?: RequestOptions) => request('DELETE', path, undefined, options),
}
