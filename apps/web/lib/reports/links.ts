// Where a report record opens in the EXISTING operational screens. Reports never rebuilds or
// edits operational records; it deep-links to the screens that already own them.
// Returns null when no safe destination exists (so the UI renders plain text, not a dead link).

import type { RecordKind } from './drawerState'

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/
const safe = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value)

export function recordHref(kind: RecordKind, row: Record<string, unknown>, role?: string | null): string | null {
  switch (kind) {
    case 'work_orders':
      return safe(row.id) ? `/engineering?tab=work-orders&focus=${row.id}` : null
    case 'guest_requests':
      return safe(row.id) ? `/tasks?type=guest_request&focus=${row.id}` : null
    case 'inspections':
      return role === 'gm' || role === 'housekeeping_supervisor' ? '/housekeeping/inspections' : null
    case 'pm_deferrals':
      return safe(row.pm_schedule_id) ? '/engineering?tab=pm-schedules' : null
    case 'tasks':
      return safe(row.id) ? `/tasks?focus=${row.id}` : null
  }
}

export function assetHref(assetId: string | null | undefined): string | null {
  return safe(assetId) ? `/engineering?tab=assets&asset=${assetId}` : null
}

export function roomHref(roomId: string | null | undefined, role?: string | null): string | null {
  if (!safe(roomId)) return null
  return role === 'chief_engineer' || role === 'engineer' || role === 'gm' ? `/engineering?room=${roomId}` : null
}

/** Existing-route targets used by exception rows (`{type:'route'}`); only allow-listed paths. */
const ROUTES = new Set(['/scheduling', '/engineering', '/housekeeping', '/tasks'])
export function routeHref(href: string | undefined): string | null {
  return href && ROUTES.has(href) ? href : null
}

export function assignedWorkHref(userId: string, role: string | undefined): string | null {
  if (!safe(userId)) return null
  return role === 'engineer' || role === 'chief_engineer' ? '/engineering?tab=work-orders' : '/tasks'
}
