// Typed drawer state for Reports. One discriminated union instead of many booleans, and a strict
// URL codec: only allow-listed keys/values are read back, so a tampered URL can never inject
// arbitrary parameters into API calls. The URL is NEVER authorization — the API re-checks.

export const RECORD_KINDS = ['work_orders', 'guest_requests', 'inspections', 'pm_deferrals', 'tasks'] as const
export type RecordKind = (typeof RECORD_KINDS)[number]

// Extra filter keys a records drawer may carry in the URL (all non-sensitive, all validated).
export const RECORD_EXTRA_KEYS = ['category', 'priority', 'priority_not', 'status', 'bucket_start', 'bucket_end', 'room_id', 'asset_id', 'assigned_to'] as const
export type RecordExtraKey = (typeof RECORD_EXTRA_KEYS)[number]

export type DrawerState =
  | { kind: 'closed' }
  | { kind: 'metric-detail'; metric: string }
  | { kind: 'filtered-records'; recordKind: RecordKind; filter: string; extra: Partial<Record<RecordExtraKey, string>>; title?: string }
  | { kind: 'employee-performance'; userId: string }
  | { kind: 'room-asset-performance'; entity: 'room' | 'asset'; id: string }
  | { kind: 'trend-comparison'; metric: string; segment?: string }

export const CLOSED: DrawerState = { kind: 'closed' }

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/
const SAFE_TITLE = /^[\w .,&()/'#:+-]{1,80}$/
const DRAWER_KEYS = ['d', 'm', 'rk', 'rf', 'eid', 'ek', 'seg', 'dt', ...RECORD_EXTRA_KEYS.map((k) => `x_${k}`)]

interface ParamsLike {
  get(name: string): string | null
}

const token = (value: string | null) => (value && SAFE_TOKEN.test(value) ? value : null)
const id = (value: string | null) => (value && SAFE_ID.test(value) ? value : null)

export function parseDrawer(params: ParamsLike): DrawerState {
  switch (params.get('d')) {
    case 'metric': {
      const metric = token(params.get('m'))
      return metric ? { kind: 'metric-detail', metric } : CLOSED
    }
    case 'records': {
      const recordKind = params.get('rk')
      const filter = token(params.get('rf'))
      if (!recordKind || !(RECORD_KINDS as readonly string[]).includes(recordKind) || !filter) return CLOSED
      const extra: Partial<Record<RecordExtraKey, string>> = {}
      for (const key of RECORD_EXTRA_KEYS) {
        const value = params.get(`x_${key}`)
        if (value && SAFE_TOKEN.test(value)) extra[key] = value
      }
      const title = params.get('dt')
      return { kind: 'filtered-records', recordKind: recordKind as RecordKind, filter, extra, ...(title && SAFE_TITLE.test(title) ? { title } : {}) }
    }
    case 'employee': {
      const userId = id(params.get('eid'))
      return userId ? { kind: 'employee-performance', userId } : CLOSED
    }
    case 'entity': {
      const entity = params.get('ek')
      const entityId = id(params.get('eid'))
      return (entity === 'room' || entity === 'asset') && entityId ? { kind: 'room-asset-performance', entity, id: entityId } : CLOSED
    }
    case 'trend': {
      const metric = token(params.get('m'))
      const segment = token(params.get('seg'))
      return metric ? { kind: 'trend-comparison', metric, ...(segment ? { segment } : {}) } : CLOSED
    }
    default:
      return CLOSED
  }
}

export function drawerToParams(state: DrawerState, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? '')
  for (const key of DRAWER_KEYS) params.delete(key)
  switch (state.kind) {
    case 'closed':
      break
    case 'metric-detail':
      params.set('d', 'metric')
      params.set('m', state.metric)
      break
    case 'filtered-records':
      params.set('d', 'records')
      params.set('rk', state.recordKind)
      params.set('rf', state.filter)
      for (const key of RECORD_EXTRA_KEYS) {
        const value = state.extra[key]
        if (value) params.set(`x_${key}`, value)
      }
      if (state.title && SAFE_TITLE.test(state.title)) params.set('dt', state.title)
      break
    case 'employee-performance':
      params.set('d', 'employee')
      params.set('eid', state.userId)
      break
    case 'room-asset-performance':
      params.set('d', 'entity')
      params.set('ek', state.entity)
      params.set('eid', state.id)
      break
    case 'trend-comparison':
      params.set('d', 'trend')
      params.set('m', state.metric)
      if (state.segment) params.set('seg', state.segment)
      break
  }
  return params
}

export function sameDrawer(a: DrawerState, b: DrawerState): boolean {
  return drawerToParams(a).toString() === drawerToParams(b).toString()
}
