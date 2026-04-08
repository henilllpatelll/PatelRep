import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/v1'

// ── Friendly error translator ─────────────────────────────────────────────────
// Converts raw database/network errors into plain English messages.

function toFriendlyError(raw: string | undefined): string {
  if (!raw) return 'Something went wrong. Please try again.'
  // Already a short friendly message from the API layer
  if (!raw.includes('{') && !raw.includes('code') && raw.length < 200) return raw
  // Duplicate key / unique constraint
  if (raw.includes('23505') || raw.includes('duplicate key') || raw.includes('already exists')) {
    if (raw.includes('room_assignment')) return 'This room is already assigned for that date.'
    return 'A duplicate entry already exists.'
  }
  // Foreign key violation
  if (raw.includes('23503') || raw.includes('foreign key')) return 'Invalid reference — please refresh and try again.'
  // Not null violation
  if (raw.includes('23502') || raw.includes('null value')) return 'A required field is missing.'
  // Invalid UUID
  if (raw.includes('invalid input syntax') && raw.includes('uuid')) return 'Invalid ID — please try again.'
  // Network / fetch
  if (raw.includes('fetch') || raw.includes('network') || raw.includes('Failed to fetch')) {
    return 'Network error — check your connection and try again.'
  }
  // Permission
  if (raw.includes('permission denied') || raw.includes('not allowed')) {
    return "You don't have permission to do that."
  }
  return 'Something went wrong. Please try again.'
}

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
    const rawDetail = Array.isArray(err.detail)
      ? err.detail.map((d: any) => {
          const loc = Array.isArray(d.loc) ? d.loc.join('.') : ''
          const msg = d.msg ?? JSON.stringify(d)
          return loc ? `[${loc}] ${msg}` : msg
        }).join(', ')
      : err.detail
    const detail = toFriendlyError(err.error?.message || rawDetail)
    throw new Error(detail || 'Something went wrong. Please try again.')
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
