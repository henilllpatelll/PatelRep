/** Pure view-model for the Phase 7 manager dashboard (flag-on only). Everything here is derived from
 *  data SimplifiedDashboard already fetches (housekeeping board, assignments, open work orders).
 *  Nothing is invented: no VIP/ETA/severity fields, no predictions, no fabricated totals. */

export type Occupancy = 'OCCUPIED' | 'DEPARTURE' | 'VACANT'

/** Front-desk occupancy bucket for a housekeeping board row. `clean_type === 'DEP'` is the real proxy
 *  for "checking out"; PICKUP means a stayover clean is queued, so it counts as occupied. Moved here
 *  unchanged from SimplifiedDashboard so legacy and V2 share one definition. */
export function classifyOccupancy(room: { clean_type?: string | null; status?: string | null }): Occupancy {
  if (room.clean_type === 'DEP') return 'DEPARTURE'
  if (room.status === 'OCCUPIED' || room.status === 'PICKUP') return 'OCCUPIED'
  return 'VACANT'
}

export interface ReadinessModel {
  /** Rooms that actually need to be turned: not out of order, not an occupied stayover. */
  scope: number
  inspected: number
  clean: number
  inProgress: number
  dirty: number
  /** Kept separate from cleanliness: availability and occupancy are different axes. */
  outOfOrder: number
  occupiedStayover: number
  total: number
  /** Whole-number percent of in-scope rooms that are inspected; null when nothing is in scope. */
  percent: number | null
}

export function buildReadiness(rooms: Array<{ status?: string | null; clean_type?: string | null }>): ReadinessModel {
  const m: ReadinessModel = {
    scope: 0, inspected: 0, clean: 0, inProgress: 0, dirty: 0,
    outOfOrder: 0, occupiedStayover: 0, total: rooms.length, percent: null,
  }
  for (const room of rooms) {
    if (room.status === 'OOO') { m.outOfOrder += 1; continue }
    if (classifyOccupancy(room) === 'OCCUPIED') { m.occupiedStayover += 1; continue }
    m.scope += 1
    if (room.status === 'INSPECTED') m.inspected += 1
    else if (room.status === 'CLEAN') m.clean += 1
    else if (room.status === 'IN_PROGRESS') m.inProgress += 1
    else m.dirty += 1
  }
  m.percent = m.scope > 0 ? Math.round((m.inspected / m.scope) * 100) : null
  return m
}

export interface ExceptionWorkOrder {
  id: string
  priority: string
  assigned_to?: string | null
}

export interface ExceptionsModel {
  /** Open urgent/emergency work orders, emergencies first, original order otherwise. */
  urgentWorkOrders: ExceptionWorkOrder[]
  urgentUnassigned: number
  /** Departure rooms that are still dirty or mid-clean (a real readiness blocker count). */
  departuresNotReady: number
  /** True when the loaded work-order page may be a partial slice (no server total exists). */
  workOrdersPartial: boolean
  total: number
}

export function buildExceptions(input: {
  workOrders: ExceptionWorkOrder[]
  rooms: Array<{ status?: string | null; clean_type?: string | null }>
  workOrdersPerPage?: number
}): ExceptionsModel {
  const rank = (p: string) => (p === 'emergency' ? 0 : 1)
  const urgent = input.workOrders
    .filter((w) => w.priority === 'urgent' || w.priority === 'emergency')
    .map((w, i) => ({ w, i }))
    .sort((a, b) => rank(a.w.priority) - rank(b.w.priority) || a.i - b.i)
    .map(({ w }) => w)
  const departuresNotReady = input.rooms.filter(
    (r) => r.clean_type === 'DEP' && r.status !== 'OOO' && r.status !== 'CLEAN' && r.status !== 'INSPECTED',
  ).length
  const urgentUnassigned = urgent.filter((w) => !w.assigned_to).length
  const perPage = input.workOrdersPerPage
  return {
    urgentWorkOrders: urgent,
    urgentUnassigned,
    departuresNotReady,
    workOrdersPartial: perPage != null && input.workOrders.length >= perPage,
    total: urgent.length + (departuresNotReady > 0 ? 1 : 0),
  }
}

export interface TeamPulseModel {
  housekeepers: number
  assigned: number
  done: number
  /** Whole-number percent; null when no rooms are assigned (never 0% of nothing). */
  percent: number | null
}

/** Aggregates the assignment rows the dashboard already loads. This is assignment progress, NOT shift
 *  attendance: the directory does not say who is actually clocked in. */
export function buildTeamPulse(
  rows: Array<{ rooms_assigned?: number | null; rooms_done?: number | null; rooms_completed?: number | null }>,
): TeamPulseModel {
  let assigned = 0
  let done = 0
  for (const r of rows) {
    assigned += r.rooms_assigned ?? 0
    done += r.rooms_done ?? r.rooms_completed ?? 0
  }
  return { housekeepers: rows.length, assigned, done, percent: assigned > 0 ? Math.round((done / assigned) * 100) : null }
}

/** "5" or "5+" when the loaded page is full and the real total is unknown. */
export function formatPartialCount(n: number, perPage: number | undefined): string {
  return perPage != null && n >= perPage ? `${n}+` : String(n)
}
