import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoomDetailPresentation } from './roomDetailView'

test('prioritizes assignment and real prediction factors for an unassigned dirty departure', () => {
  const view = getRoomDetailPresentation({
    room_id: '312', status: 'DIRTY', clean_type: 'DEP', assigned_to: null,
    checkout_time: '2026-09-30T16:00:00.000Z',
    prediction: { risk_level: 'HIGH', predicted_ready_at: '2026-09-30T17:46:00.000Z', checkin_time: '2026-09-30T17:30:00.000Z', risk_factors: ['currently_unassigned', 'tight_turnaround'] },
    rooms: { room_number: '312' },
  }, { canSupervise: true, canAssignOccupiedClean: false })

  assert.equal(view.primaryAction, 'assign')
  assert.equal(view.showArrivalRisk, true)
  assert.deepEqual(view.riskFactorKeys, ['unassigned', 'tightTurnaround'])
  assert.deepEqual(view.factKeys, ['arrival', 'checkout', 'assigned'])
})

test('uses the existing workflow ownership for cleaning, inspection, ready, and OOO rooms', () => {
  const base = { room_id: '101', rooms: { room_number: '101' } }
  assert.equal(getRoomDetailPresentation({ ...base, status: 'IN_PROGRESS', assigned_to: 'hk-1' }, { canSupervise: false, canAssignOccupiedClean: false }).primaryAction, 'completeCleaning')
  assert.equal(getRoomDetailPresentation({ ...base, status: 'CLEAN', inspection_required: true }, { canSupervise: true, canAssignOccupiedClean: false }).primaryAction, 'inspect')
  assert.equal(getRoomDetailPresentation({ ...base, status: 'CLEAN', inspection_required: false }, { canSupervise: true, canAssignOccupiedClean: false }).primaryAction, 'markReady')
  assert.equal(getRoomDetailPresentation({ ...base, status: 'INSPECTED' }, { canSupervise: true, canAssignOccupiedClean: false }).primaryAction, null)
  assert.equal(getRoomDetailPresentation({ ...base, status: 'OCCUPIED' }, { canSupervise: false, canAssignOccupiedClean: false }).primaryAction, 'requestCleaning')
  assert.equal(getRoomDetailPresentation({ ...base, status: 'OOO' }, { canSupervise: true, canAssignOccupiedClean: false }).primaryAction, 'returnToCleaning')
})

test('does not manufacture risk explanations from a model field it cannot verify', () => {
  const view = getRoomDetailPresentation({
    room_id: '108', status: 'IN_PROGRESS', assigned_to: 'hk-1',
    prediction: { risk_level: 'HIGH', predicted_ready_at: '2026-09-30T17:46:00.000Z', risk_factors: ['opaque-model-weight'] },
    rooms: { room_number: '108' },
  }, { canSupervise: true, canAssignOccupiedClean: false })

  assert.equal(view.showArrivalRisk, true)
  assert.deepEqual(view.riskFactorKeys, [])
})
