import { format, formatDistanceToNow } from 'date-fns'

// ─── Status labels ────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  DIRTY: 'Dirty',
  IN_PROGRESS: 'In Progress',
  CLEAN: 'Clean',
  INSPECTED: 'Inspected',
  OOO: 'Out of Order',
  PICKUP: 'Pickup',
}

// ─── Status colors ────────────────────────────────────────────────────────────

export const STATUS_COLORS: Record<
  string,
  { bg: string; border: string; badge: string }
> = {
  DIRTY: {
    bg: 'bg-red-50',
    border: 'border-red-300',
    badge: 'bg-red-100 text-red-700',
  },
  IN_PROGRESS: {
    bg: 'bg-blue-50',
    border: 'border-blue-400',
    badge: 'bg-blue-100 text-blue-700',
  },
  CLEAN: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-400',
    badge: 'bg-yellow-100 text-yellow-700',
  },
  INSPECTED: {
    bg: 'bg-green-50',
    border: 'border-green-400',
    badge: 'bg-green-100 text-green-700',
  },
  OOO: {
    bg: 'bg-gray-100',
    border: 'border-gray-400',
    badge: 'bg-gray-200 text-gray-600',
  },
  PICKUP: {
    bg: 'bg-purple-50',
    border: 'border-purple-400',
    badge: 'bg-purple-100 text-purple-700',
  },
}

export const STATUS_BG: Record<string, string> = {
  INSPECTED: '#4ADE80',
  CLEAN: '#99F6E4',
  IN_PROGRESS: '#7DD3FC',
  PICK_UP: '#DDD6FE',
  OCCUPIED: '#FC8D8D',
  DIRTY: '#FF4D4D',
  CHECK_OUT: '#FF4D4D',
  OUT_OF_SERVICE: '#70767D',
  VIP: '#FCD34D',
}

export const STATUS_TEXT: Record<string, string> = {
  INSPECTED: '#064E3B',
  CLEAN: '#134E4A',
  IN_PROGRESS: '#0C4A6E',
  PICK_UP: '#5B21B6',
  OCCUPIED: '#7F1D1D',
  DIRTY: '#FFFFFF',
  CHECK_OUT: '#FFFFFF',
  OUT_OF_SERVICE: '#FFFFFF',
  VIP: '#78350F',
}

// ─── Valid transitions ────────────────────────────────────────────────────────

/**
 * Transition rules:
 *   "any" — accessible to every role
 *   "supervisor" — only housekeeping_supervisor, chief_engineer, gm
 *
 * The special key '*' under supervisor means: from ANY current status → that target.
 */
export const VALID_TRANSITIONS: Record<string, Record<string, string[]>> = {
  any: {
    DIRTY: ['IN_PROGRESS', 'PICKUP'],
    IN_PROGRESS: ['CLEAN'],
    PICKUP: ['CLEAN'],
  },
  supervisor: {
    CLEAN: ['INSPECTED', 'DIRTY'],
    INSPECTED: ['DIRTY'],
    OOO: ['DIRTY'],
    '*': ['OOO'], // any status → OOO
  },
}

const SUPERVISOR_ROLES = new Set([
  'housekeeping_supervisor',
  'chief_engineer',
  'gm',
])

function isSupervisor(role: string): boolean {
  return SUPERVISOR_ROLES.has(role)
}

export function getValidTransitions(
  currentStatus: string,
  role: string,
): { label: string; status: string; variant: 'primary' | 'secondary' | 'danger' }[] {
  const results: { label: string; status: string; variant: 'primary' | 'secondary' | 'danger' }[] =
    []

  // Collect targets from the "any" tier
  const anyTargets: string[] = VALID_TRANSITIONS.any[currentStatus] ?? []
  for (const target of anyTargets) {
    results.push({
      label: STATUS_LABELS[target] ?? target,
      status: target,
      variant: target === 'CLEAN' || target === 'INSPECTED' ? 'primary' : 'secondary',
    })
  }

  // Collect targets from the "supervisor" tier
  if (isSupervisor(role)) {
    // Status-specific supervisor transitions
    const supervisorTargets: string[] =
      VALID_TRANSITIONS.supervisor[currentStatus] ?? []
    for (const target of supervisorTargets) {
      // Avoid duplicate entries
      if (!results.find((r) => r.status === target)) {
        results.push({
          label: STATUS_LABELS[target] ?? target,
          status: target,
          variant: target === 'DIRTY' ? 'danger' : 'secondary',
        })
      }
    }

    // Wildcard: any status → OOO
    const wildcardTargets: string[] = VALID_TRANSITIONS.supervisor['*'] ?? []
    for (const target of wildcardTargets) {
      if (currentStatus !== target && !results.find((r) => r.status === target)) {
        results.push({
          label: STATUS_LABELS[target] ?? target,
          status: target,
          variant: 'danger',
        })
      }
    }
  }

  return results
}

// ─── Risk / status color helper ───────────────────────────────────────────────

export function getRiskColorClass(
  riskLevel: string | null,
  status: string,
): string {
  if (status === 'DIRTY') {
    if (riskLevel === 'HIGH') return 'bg-red-100 border-red-500 ring-2 ring-red-400'
    if (riskLevel === 'MEDIUM') return 'bg-orange-100 border-orange-400'
    return 'bg-red-50 border-red-300'
  }
  const colors = STATUS_COLORS[status]
  if (!colors) return 'bg-gray-50 border-gray-300'
  return `${colors.bg} ${colors.border}`
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Formats an ISO timestamp to 12-hour clock, e.g. "3:00 PM".
 * Returns null if the input is null or unparseable.
 */
export function formatCheckinTime(isoString: string | null): string | null {
  if (!isoString) return null
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return null
    return format(date, 'h:mm a')
  } catch {
    return null
  }
}

/**
 * Returns a human-readable "time since" string:
 *   null / undefined → "never synced"
 *   < 60 seconds ago → "just now"
 *   otherwise → "2 min ago", "1 hour ago", etc.
 */
export function getTimeSinceSync(lastSyncedAt: Date | null): string {
  if (!lastSyncedAt) return 'never synced'
  try {
    const diffMs = Date.now() - lastSyncedAt.getTime()
    if (diffMs < 60_000) return 'just now'
    return formatDistanceToNow(lastSyncedAt, { addSuffix: true })
  } catch {
    return 'unknown'
  }
}
