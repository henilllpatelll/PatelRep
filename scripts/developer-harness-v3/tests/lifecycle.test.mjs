// D3.2 — task lifecycle reducer, Resource Governor admission and the lifecycle contract file.
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadContractFile } from '../authority/contract.mjs'
import { DEFAULT_THRESHOLDS, admitTask } from '../lifecycle/resource-admission.mjs'
import { applyEvent, createTask, loadLifecycle } from '../lifecycle/lifecycle.mjs'
import { HEAD } from './helpers.mjs'

const LC = loadLifecycle()
let n = 0
const ev = (task, over = {}) => ({ event_id: `e${++n}`, idempotency_id: `i${n}`, task_id: task.task_id, kind: 'transition', expected_revision: task.state_revision, fencing_token: task.fencing_token, ...over })
const step = (task, to, extra = {}) => { const r = applyEvent(LC, task, ev(task, { to, ...extra })); assert.equal(r.ok, true, `${task.state} -> ${to}: ${r.problems}`); return r.task }
const walk = (task, states) => states.reduce((t, s) => step(t, s), task)

test('lifecycle contract: every state is reachable, every transition target exists, invalidated evidence types exist', () => {
  const states = new Set([...LC.main_flow, ...Object.keys(LC.recoverable_states)])
  const seen = new Set(['submitted']); const q = ['submitted']
  while (q.length) for (const t of LC.forward[q.shift()] ?? []) if (!seen.has(t)) { seen.add(t); q.push(t) }
  for (const s of LC.main_flow) assert.ok(seen.has(s), `${s} unreachable`)
  for (const [from, tos] of Object.entries(LC.forward)) { assert.ok(states.has(from)); for (const t of tos) assert.ok(states.has(t), `${from}->${t}`) }
  const types = Object.keys(loadContractFile().evidence_types)
  for (const t of LC.evidence_invalidation.head_change) assert.ok(types.includes(t), t)
  for (const s of [...LC.remediation_from, ...LC.incident_from]) assert.ok(states.has(s), s)
  for (const r of LC.never_blocked_reasons) assert.ok(!LC.recoverable_states.blocked.reasons.includes(r), `${r} must never be a genuine blocker`)
  assert.equal(LC.concurrency.max_reasoning_sessions, 1)
})

test('a full production task walks the whole lifecycle and completes only after production verification', () => {
  let t = createTask({ task_id: 'task-1' })
  t = walk(t, ['queued', 'planning', 'implementing', 'testing', 'independent_review', 'security_review', 'publishing', 'ci_running', 'staging_verification', 'merge_eligible', 'merged'])
  const early = applyEvent(LC, t, ev(t, { to: 'completed' }))
  assert.equal(early.ok, false); assert.deepEqual(early.problems, ['TRANSITION.PRODUCTION_REQUIRED'])
  t = walk(t, ['production_release', 'production_verification', 'completed'])
  assert.equal(t.state, 'completed')
  assert.equal(t.state_revision, 14)
  assert.deepEqual(applyEvent(LC, t, ev(t, { to: 'queued' })).problems, ['TRANSITION.FROM_TERMINAL'])
})

test('a task that never needs production completes from merged, and cannot enter production_release', () => {
  let t = walk(createTask({ task_id: 'task-1', production_required: false }), ['queued', 'planning', 'implementing', 'testing', 'independent_review', 'publishing', 'ci_running', 'staging_verification', 'merge_eligible', 'merged'])
  assert.deepEqual(applyEvent(LC, t, ev(t, { to: 'production_release' })).problems, ['TRANSITION.PRODUCTION_NOT_REQUIRED'])
  assert.equal(step(t, 'completed').state, 'completed')
})

test('illegal, skipping and unknown transitions are rejected and leave the task unchanged', () => {
  const t = walk(createTask({ task_id: 'task-1' }), ['queued', 'planning'])
  for (const to of ['completed', 'merged', 'ci_running', 'testing', 'submitted', 'production_verification']) assert.deepEqual(applyEvent(LC, t, ev(t, { to })).problems, ['TRANSITION.ILLEGAL'], to)
  assert.deepEqual(applyEvent(LC, t, ev(t, { to: 'teleported' })).problems, ['TRANSITION.UNKNOWN_STATE'])
  assert.deepEqual(applyEvent(LC, t, ev(t, { to: undefined })).problems, ['EVENT.MALFORMED'])
  assert.deepEqual(applyEvent(LC, t, { ...ev(t), kind: 'transition' }).problems, ['TRANSITION.UNKNOWN_STATE'])
  const r = applyEvent(LC, t, ev(t, { to: 'merged' }))
  assert.equal(r.task, t)
})

test('stale revisions, stale fencing tokens and wrong tasks are rejected; duplicates are idempotent no-ops', () => {
  const t = createTask({ task_id: 'task-1' })
  const e = ev(t, { to: 'queued' })
  const first = applyEvent(LC, t, e)
  assert.equal(first.ok, true); assert.equal(first.task.state_revision, 1)
  const dup = applyEvent(LC, first.task, e)
  assert.equal(dup.ok, true); assert.equal(dup.duplicate, true); assert.equal(dup.task, first.task, 'a replayed event changes nothing')
  assert.deepEqual(applyEvent(LC, first.task, ev(first.task, { to: 'planning', expected_revision: 0 })).problems, ['EVENT.STALE_REVISION'])
  assert.deepEqual(applyEvent(LC, first.task, ev(first.task, { to: 'planning', fencing_token: 0 })).problems, ['EVENT.STALE_FENCING_TOKEN'])
  assert.deepEqual(applyEvent(LC, first.task, ev(first.task, { to: 'planning', fencing_token: 2 })).problems, ['EVENT.STALE_FENCING_TOKEN'])
  assert.deepEqual(applyEvent(LC, first.task, ev(first.task, { to: 'planning', task_id: 'task-2' })).problems, ['EVENT.WRONG_TASK'])
  for (const bad of [null, undefined, {}, [], 'x', { ...ev(first.task), kind: 'delete_everything' }, { ...ev(first.task), extra: 1 }, { ...ev(first.task), expected_revision: -1 }]) assert.equal(applyEvent(LC, first.task, bad).ok, false)
})

test('a finished Claude session is not a finished task', () => {
  let t = walk(createTask({ task_id: 'task-1' }), ['queued', 'planning', 'implementing'])
  const r = applyEvent(LC, t, ev(t, { kind: 'session_completed' }))
  assert.equal(r.ok, true)
  assert.equal(r.task.state, 'implementing')
  assert.equal(r.task.state_revision, t.state_revision + 1)
})

test('recoverable states record where to resume and may resume nowhere else', () => {
  let t = walk(createTask({ task_id: 'task-1' }), ['queued', 'planning', 'implementing', 'testing'])
  t = step(t, 'waiting_resources', { reason_code: 'MEMORY_PRESSURE' })
  assert.equal(t.resume_to, 'testing')
  assert.deepEqual(applyEvent(LC, t, ev(t, { to: 'independent_review' })).problems, ['TRANSITION.MUST_RESUME_TO_RECORDED_STATE'])
  t = step(t, 'waiting_subscription', { reason_code: 'SUBSCRIPTION_LIMIT' })
  assert.equal(t.resume_to, 'testing', 'moving between waiting states keeps the original resume target')
  t = step(t, 'testing')
  assert.equal(t.state, 'testing'); assert.equal(t.resume_to, null)
  const noReason = applyEvent(LC, t, ev(t, { to: 'waiting_resources' }))
  assert.deepEqual(noReason.problems, ['TRANSITION.REASON_NOT_ALLOWED_FOR_STATE'])
  assert.deepEqual(applyEvent(LC, t, ev(t, { to: 'waiting_resources', reason_code: 'SUBSCRIPTION_LIMIT' })).problems, ['TRANSITION.REASON_NOT_ALLOWED_FOR_STATE'])
})

test('resource pressure, subscription exhaustion, worker death and CI failure are NEVER a genuine blocker', () => {
  const t = walk(createTask({ task_id: 'task-1' }), ['queued', 'planning', 'implementing'])
  for (const reason of LC.never_blocked_reasons) assert.equal(applyEvent(LC, t, ev(t, { to: 'blocked', reason_code: reason })).ok, false, reason)
  const b = step(t, 'blocked', { reason_code: 'OWNER_AUTH_EXPIRED' })
  assert.equal(b.blocker_reason, 'OWNER_AUTH_EXPIRED')
  assert.equal(step(b, 'implementing').blocker_reason, null)
})

test('remediation returns to implementing and is entered only from verification states', () => {
  let t = walk(createTask({ task_id: 'task-1' }), ['queued', 'planning', 'implementing'])
  assert.deepEqual(applyEvent(LC, t, ev(t, { to: 'remediation', reason_code: 'TEST_FAILED' })).problems, ['TRANSITION.ILLEGAL'])
  t = walk(t, ['testing'])
  t = step(t, 'remediation', { reason_code: 'TEST_FAILED' })
  assert.deepEqual(applyEvent(LC, t, ev(t, { to: 'testing' })).problems, ['TRANSITION.MUST_RESUME_TO_RECORDED_STATE'])
  assert.equal(step(t, 'implementing').state, 'implementing')
})

test('production incidents arise only after merge', () => {
  const early = walk(createTask({ task_id: 'task-1' }), ['queued', 'planning'])
  assert.deepEqual(applyEvent(LC, early, ev(early, { to: 'production_incident', reason_code: 'WATCHDOG_ALERT' })).problems, ['TRANSITION.ILLEGAL'])
  const merged = walk(createTask({ task_id: 'task-1' }), ['queued', 'planning', 'implementing', 'testing', 'independent_review', 'publishing', 'ci_running', 'staging_verification', 'merge_eligible', 'merged', 'production_release'])
  const inc = step(merged, 'production_incident', { reason_code: 'PRODUCTION_HEALTH_FAILED' })
  assert.equal(inc.resume_to, 'production_release')
})

test('a head change invalidates every review, test and gate result and sends the task back to testing', () => {
  let t = walk(createTask({ task_id: 'task-1' }), ['queued', 'planning', 'implementing', 'testing', 'independent_review', 'security_review', 'publishing', 'ci_running'])
  const r = applyEvent(LC, t, ev(t, { kind: 'head_changed', head_sha: HEAD }))
  assert.equal(r.ok, true)
  assert.equal(r.task.state, 'testing')
  assert.equal(r.task.head_sha, HEAD)
  for (const type of ['test_results', 'independent_review', 'security_review', 'ci_gate', 'staging_gate', 'delivery_verification']) assert.ok(r.invalidated.includes(type), type)
  const same = applyEvent(LC, r.task, ev(r.task, { kind: 'head_changed', head_sha: HEAD }))
  assert.equal(same.task.state, 'testing'); assert.deepEqual(same.invalidated, [])
  const early = walk(createTask({ task_id: 'task-2' }), ['queued', 'planning', 'implementing'])
  assert.equal(applyEvent(LC, early, ev(early, { kind: 'head_changed', head_sha: HEAD })).task.state, 'implementing', 'no verification has happened yet; stay put')
  assert.deepEqual(applyEvent(LC, t, ev(t, { kind: 'head_changed' })).problems, ['EVENT.HEAD_REQUIRED'])
  const merged = walk(createTask({ task_id: 'task-3' }), ['queued', 'planning', 'implementing', 'testing', 'independent_review', 'publishing', 'ci_running', 'staging_verification', 'merge_eligible', 'merged'])
  assert.deepEqual(applyEvent(LC, merged, ev(merged, { kind: 'head_changed', head_sha: HEAD })).problems, ['EVENT.HEAD_CHANGE_AFTER_MERGE'])
})

test('Resource Governor: healthy host admits; every pressure becomes a recoverable waiting state, never a failure', () => {
  const ok = { available_mb: 9000, commit_ratio: 0.5, paging_pages_per_sec: 10, cpu_pct: 30, disk_free_gb: 300, host_responsive: true, reasoning_sessions_active: 0, heavy_test_workloads_active: 0 }
  assert.deepEqual(admitTask(ok), { decision: 'admit', state: 'running', reason_codes: [], thresholds_calibrated: false })
  const cases = {
    'RESOURCE.MEMORY_LOW': { available_mb: 3000 }, 'RESOURCE.COMMIT_HIGH': { commit_ratio: 0.95 }, 'RESOURCE.PAGING_HIGH': { paging_pages_per_sec: 50000 },
    'RESOURCE.CPU_HIGH': { cpu_pct: 99 }, 'RESOURCE.HOST_UNRESPONSIVE': { host_responsive: false }, 'RESOURCE.REASONING_SESSION_LIMIT': { reasoning_sessions_active: 1 },
  }
  for (const [code, over] of Object.entries(cases)) { const d = admitTask({ ...ok, ...over }); assert.equal(d.decision, 'wait', code); assert.equal(d.state, 'waiting_resources'); assert.ok(d.reason_codes.includes(code), code) }
  const crit = admitTask({ ...ok, available_mb: 800 })
  assert.equal(crit.decision, 'critical'); assert.equal(crit.state, 'waiting_resources'); assert.ok(crit.reason_codes.includes('RESOURCE.MEMORY_CRITICAL'))
  assert.equal(admitTask({ ...ok, disk_free_gb: 5 }).decision, 'critical')
  assert.equal(admitTask({ ...ok, heavy_test_workloads_active: 1 }, { heavy: true }).decision, 'wait')
  assert.equal(admitTask({ ...ok, heavy_test_workloads_active: 1 }, { heavy: false }).decision, 'admit', 'a light task is not held by a heavy one')
  assert.equal(admitTask({ ...ok, reasoning_sessions_active: 1 }, { reasoning: false }).decision, 'admit', 'deterministic work may proceed beside the one reasoning session')
})

test('Resource Governor: an unreadable metric is never treated as healthy', () => {
  const ok = { available_mb: 9000, commit_ratio: 0.5, paging_pages_per_sec: 10, cpu_pct: 30, disk_free_gb: 300, host_responsive: true, reasoning_sessions_active: 0, heavy_test_workloads_active: 0 }
  for (const k of Object.keys(ok).filter((x) => x !== 'host_responsive')) { const d = admitTask({ ...ok, [k]: null }); assert.equal(d.decision, 'wait', k); assert.ok(d.reason_codes.includes(`RESOURCE.METRIC_UNAVAILABLE:${k}`), k) }
  assert.equal(admitTask(undefined).decision, 'wait')
  assert.equal(admitTask({ ...ok, available_mb: Number.NaN }).decision, 'wait')
  assert.equal(DEFAULT_THRESHOLDS.calibrated, false, 'thresholds are proposed values until D3.3 measures the host')
  assert.ok(Object.isFrozen(DEFAULT_THRESHOLDS))
})
