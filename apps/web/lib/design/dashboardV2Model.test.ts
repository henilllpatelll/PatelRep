import assert from 'node:assert/strict'
import test from 'node:test'
import { buildExceptions, buildReadiness, buildTeamPulse, classifyOccupancy, formatPartialCount } from './dashboardV2Model'

const room = (status: string, clean_type?: string) => ({ status, clean_type })

test('classifyOccupancy keeps the legacy rules (DEP wins, OCCUPIED/PICKUP are occupied)', () => {
  assert.equal(classifyOccupancy(room('DIRTY', 'DEP')), 'DEPARTURE')
  assert.equal(classifyOccupancy(room('OCCUPIED')), 'OCCUPIED')
  assert.equal(classifyOccupancy(room('PICKUP')), 'OCCUPIED')
  assert.equal(classifyOccupancy(room('CLEAN')), 'VACANT')
})

test('readiness: occupancy and availability stay out of the cleanliness distribution', () => {
  const m = buildReadiness([
    room('INSPECTED'), room('INSPECTED'), room('CLEAN'), room('IN_PROGRESS'), room('DIRTY', 'DEP'),
    room('OCCUPIED'), room('PICKUP'), room('OOO'),
  ])
  assert.equal(m.total, 8)
  assert.equal(m.scope, 5)
  assert.deepEqual([m.inspected, m.clean, m.inProgress, m.dirty], [2, 1, 1, 1])
  assert.equal(m.occupiedStayover, 2)
  assert.equal(m.outOfOrder, 1)
  assert.equal(m.percent, 40)
  assert.equal(m.inspected + m.clean + m.inProgress + m.dirty, m.scope)
})

test('readiness: no in-scope rooms gives null, never a fake 0% or 100%', () => {
  assert.equal(buildReadiness([]).percent, null)
  assert.equal(buildReadiness([room('OOO'), room('OCCUPIED')]).percent, null)
})

test('exceptions: only real urgent work orders and departure blockers; emergencies first', () => {
  const m = buildExceptions({
    workOrders: [
      { id: 'a', priority: 'normal', assigned_to: null },
      { id: 'b', priority: 'urgent', assigned_to: null },
      { id: 'c', priority: 'emergency', assigned_to: 'u1' },
      { id: 'd', priority: 'urgent', assigned_to: 'u2' },
    ],
    rooms: [room('DIRTY', 'DEP'), room('IN_PROGRESS', 'DEP'), room('CLEAN', 'DEP'), room('OOO', 'DEP'), room('DIRTY')],
    workOrdersPerPage: 50,
  })
  assert.deepEqual(m.urgentWorkOrders.map((w) => w.id), ['c', 'b', 'd'])
  assert.equal(m.urgentUnassigned, 1)
  assert.equal(m.departuresNotReady, 2)
  assert.equal(m.workOrdersPartial, false)
  assert.equal(m.total, 4)
})

test('exceptions: a full work-order page is flagged partial instead of reported as a total', () => {
  const wos = Array.from({ length: 3 }, (_, i) => ({ id: String(i), priority: 'normal' }))
  assert.equal(buildExceptions({ workOrders: wos, rooms: [], workOrdersPerPage: 3 }).workOrdersPartial, true)
  assert.equal(formatPartialCount(3, 3), '3+')
  assert.equal(formatPartialCount(2, 3), '2')
  assert.equal(formatPartialCount(2, undefined), '2')
})

test('team pulse aggregates assignment progress and reports null with nothing assigned', () => {
  assert.deepEqual(buildTeamPulse([{ rooms_assigned: 10, rooms_done: 4 }, { rooms_assigned: 6, rooms_completed: 6 }]), {
    housekeepers: 2, assigned: 16, done: 10, percent: 63,
  })
  assert.equal(buildTeamPulse([]).percent, null)
  assert.equal(buildTeamPulse([{ rooms_assigned: 0 }]).percent, null)
})
