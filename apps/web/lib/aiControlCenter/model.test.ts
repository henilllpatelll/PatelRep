import assert from 'node:assert/strict'
import test from 'node:test'
import type { ControlCenterOverview } from '@/lib/api/agentControlCenter'
import {
  approvalState, approveUnavailableReason, decisionButtons, readinessSummary, refusalMessage, resolveSection,
  runState, timeLeft, visibleSections,
} from './model'

const OVERVIEW: ControlCenterOverview = {
  platform: { gateway_execution_enabled: false, paid_model_calls_enabled: false, customer_billing_mode: 'disabled',
    paused: false, cost_emergency_stop: false, paused_agents: [], paused_tools: [], live_workers: 0 },
  hotel: { entitled: false, paused: false, paused_by_kind: null, effective_grants: 0 },
  runs: { active: 0, awaiting_approval: 0, failed_24h: 0, succeeded_24h: 0 },
  approvals: { pending: 0, expiring_1h: 0 },
  refusals_24h: 0,
  as_of: '2026-11-17T10:00:00Z',
  readiness: { execution_ready: false, blocked_by: ['not_entitled', 'gateway_execution_disabled'],
    paid_model_calls_enabled: false, customer_billing_mode: 'disabled' },
}

test('sections are exactly what the backend session allows, in a fixed order', () => {
  assert.deepEqual(visibleSections(['audit', 'overview', 'bogus', 'approvals']), ['overview', 'approvals', 'audit'])
  assert.deepEqual(visibleSections(null), [])
  assert.equal(resolveSection('controls', ['overview', 'approvals']), 'overview')  // a hidden section is never opened
  assert.equal(resolveSection('approvals', ['overview', 'approvals']), 'approvals')
  assert.equal(resolveSection(null, []), null)
})

test('readiness is reported from the backend, never inferred as enabled', () => {
  const off = readinessSummary(OVERVIEW)
  assert.equal(off.title, 'Agents cannot act right now')
  assert.match(off.detail, /not part of this hotel’s plan \(\+1 more\)/)
  const paused = readinessSummary({ ...OVERVIEW, hotel: { ...OVERVIEW.hotel, paused: true } })
  assert.equal(paused.tone, 'bad')
  const ready = readinessSummary({ ...OVERVIEW, readiness: { ...OVERVIEW.readiness, execution_ready: true, blocked_by: [] } })
  assert.equal(ready.tone, 'good')
})

test('decision buttons mirror the backend capability exactly', () => {
  assert.deepEqual(decisionButtons({ approve: true, reject: true, withdraw: false, reason: null }), ['approve', 'reject'])
  assert.deepEqual(decisionButtons({ approve: false, reject: false, withdraw: true, reason: 'self_approval_forbidden' }), ['withdraw'])
  assert.deepEqual(decisionButtons({ approve: false, reject: true, withdraw: false, reason: 'gateway_disabled' }), ['reject'])
  assert.deepEqual(decisionButtons(null), [])
  assert.match(approveUnavailableReason({ approve: false, reject: false, withdraw: true, reason: 'self_approval_forbidden' }) ?? '',
    /different manager/)
  assert.match(approveUnavailableReason({ approve: false, reject: true, withdraw: false, reason: 'gateway_disabled' }) ?? '',
    /switched off/)
  assert.equal(approveUnavailableReason({ approve: true, reject: true, withdraw: false, reason: null }), null)
  assert.equal(approveUnavailableReason({ approve: false, reject: false, withdraw: false, reason: 'not_pending' }), null)
})

test('race and authority refusals have plain-language messages; unknown codes fall back', () => {
  assert.match(refusalMessage('not_pending'), /already decided/)
  assert.match(refusalMessage('stale_role'), /role changed/)
  assert.match(refusalMessage('operator_pause_locked'), /support/)
  assert.equal(refusalMessage('something_new', 'fallback'), 'fallback')
  assert.equal(refusalMessage(null, 'fallback'), 'fallback')
})

test('states and expiry labels', () => {
  assert.equal(runState('dead_letter').tone, 'bad')
  assert.equal(runState('awaiting_approval').label, 'Waiting for approval')
  assert.equal(runState('new_state').label, 'new_state')
  assert.equal(approvalState('approved', '2026-11-17T10:00:00Z').label, 'Approved · carried out')
  assert.equal(approvalState('revoked').label, 'Withdrawn')
  const now = new Date('2026-11-17T10:00:00Z')
  assert.equal(timeLeft('2026-11-17T09:59:00Z', now), 'expired')
  assert.equal(timeLeft('2026-11-17T10:30:00Z', now), '30 min left')
  assert.equal(timeLeft('2026-11-17T12:05:00Z', now), '2 h 5 min left')
})
