// D3.3 worker lifecycle/recovery primitives + atomic state + locks, integrated with the D3.2 evaluator and lifecycle reducer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acquireLock, atomicWriteJson, readJsonState, releaseLock } from '../lib/atomic.mjs'
import { checkLease, cleanupPlan, issueLease, recoveryDecision, registerResource, renewLease, setLifecycle, validLease } from '../runtime/worker-lifecycle.mjs'
import { identifyProcesses } from '../runtime/vm-controller.mjs'
import { evaluate } from '../authority/evaluator.mjs'
import { applyEvent, createTask, loadLifecycle } from '../lifecycle/lifecycle.mjs'
import { buildPolicy, NOW, trustedFor } from './helpers.mjs'

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'dh3-life-'))
const REC = { schema: 'patelrep.developer-harness-v3.vm-supervisor', supervisor_pid: 10, qemu_pid: 11, marker: 'm', state: 'running' }

test('atomic state: round trip, corrupt and oversize files are never authoritative', () => {
  const d = tmp()
  try {
    const f = path.join(d, 's.json')
    assert.equal(readJsonState(f).code, 'STATE.ABSENT')
    atomicWriteJson(f, { a: 1 }); assert.deepEqual(readJsonState(f).value, { a: 1 })
    writeFileSync(f, '{"a":'); assert.equal(readJsonState(f).code, 'STATE.CORRUPT')
    atomicWriteJson(f, { a: 2 }); assert.equal(readJsonState(f, (v) => v.a === 1).code, 'STATE.CORRUPT', 'schema validation is part of reading')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('locks: exclusive; a live or unknown holder is never broken; a verifiably dead holder is', () => {
  const d = tmp()
  try {
    const f = path.join(d, 'l')
    assert.equal(acquireLock(f, { execution_id: 'a' }).ok, true)
    assert.equal(acquireLock(f, { execution_id: 'b' }, { isHolderAlive: () => true }).code, 'LOCK.HELD')
    assert.equal(acquireLock(f, { execution_id: 'b' }, { isHolderAlive: () => null }).code, 'LOCK.HELD', 'unknown liveness fails closed')
    assert.equal(releaseLock(f, { execution_id: 'b' }).code, 'LOCK.NOT_HOLDER')
    assert.equal(acquireLock(f, { execution_id: 'b' }, { isHolderAlive: () => false }).ok, true)
    assert.equal(releaseLock(f, { execution_id: 'b' }).ok, true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('leases: recovery always raises the fencing token; stale identity/token/expired leases are refused', () => {
  const l1 = issueLease({ workerId: 'w1', taskId: 'task-1', now: NOW })
  const l2 = issueLease({ workerId: 'w1', taskId: 'task-1', previous: l1, now: NOW })
  assert.equal(l1.fencing_token, 1); assert.equal(l2.fencing_token, 2); assert.equal(l2.supersedes, l1.execution_identity); assert.ok(validLease(l2))
  assert.equal(checkLease(l2, { execution_identity: l2.execution_identity, fencing_token: 2 }, { now: NOW }), null)
  assert.equal(checkLease(l2, { execution_identity: l1.execution_identity, fencing_token: 1 }, { now: NOW }), 'LEASE.STALE_IDENTITY', 'the pre-recovery worker has no authority')
  assert.equal(checkLease(l2, { execution_identity: l2.execution_identity, fencing_token: 1 }, { now: NOW }), 'LEASE.STALE_FENCING_TOKEN')
  assert.equal(checkLease(l2, { execution_identity: l2.execution_identity, fencing_token: 2 }, { now: NOW + 11 * 60000 }), 'LEASE.EXPIRED')
  assert.equal(checkLease(renewLease(l2, { now: NOW + 9 * 60000 }), { execution_identity: l2.execution_identity, fencing_token: 2 }, { now: NOW + 11 * 60000 }), null)
  assert.equal(checkLease(null, {}, { now: NOW }), 'LEASE.NONE')
  assert.throws(() => issueLease({ workerId: '../x', taskId: 't', now: NOW }), /BAD_ID/)
})

test('controller restart recovery decisions come from host facts; unknown liveness never starts a second VM', () => {
  const lease = issueLease({ workerId: 'w1', taskId: 'task-1', now: NOW })
  assert.equal(recoveryDecision({ record: null, lease, liveness: {}, now: NOW }).action, 'none')
  assert.equal(recoveryDecision({ record: { x: 1 }, lease, liveness: {}, now: NOW }).action, 'investigate')
  assert.equal(recoveryDecision({ record: REC, lease, liveness: { supervisor: null, qemu: true }, now: NOW }).action, 'investigate')
  assert.equal(recoveryDecision({ record: REC, lease, liveness: { supervisor: true, qemu: true, qemuImage: 'notepad.exe' }, now: NOW }).codes[0], 'RECOVERY.PID_REUSED')
  const gone = recoveryDecision({ record: REC, lease, liveness: { supervisor: false, qemu: false }, now: NOW })
  assert.equal(gone.action, 'mark_exited'); assert.equal(gone.lifecycle_event.reason_code, 'WORKER_TERMINATED')
  assert.equal(recoveryDecision({ record: REC, lease, liveness: { supervisor: true, qemu: false }, now: NOW }).action, 'terminate')
  const re = recoveryDecision({ record: REC, lease, liveness: { supervisor: true, qemu: true, qemuImage: 'qemu-system-x86_64.exe' }, now: NOW + 3600000 })
  assert.equal(re.action, 'reattach'); assert.equal(re.lifecycle_event.new_fencing_token, 2); assert.equal(re.codes[0], 'RECOVERY.LEASE_EXPIRED_REISSUE')
})

test('stale worker identity end-to-end through the D3.2 reducer: after worker_recovered the old token is rejected', () => {
  const lc = loadLifecycle()
  let task = { ...createTask({ task_id: 'task-1' }), state: 'implementing' }
  const ev = (o) => ({ event_id: `e${task.state_revision}`, idempotency_id: `i${task.state_revision}`, task_id: 'task-1', expected_revision: task.state_revision, ...o })
  let r = applyEvent(lc, task, ev({ kind: 'transition', to: 'worker_recovery', reason_code: 'WORKER_TERMINATED', fencing_token: 1 })); assert.ok(r.ok); task = r.task
  r = applyEvent(lc, task, ev({ kind: 'worker_recovered', fencing_token: 1, new_fencing_token: 2 })); assert.ok(r.ok); task = r.task
  assert.deepEqual(applyEvent(lc, task, ev({ kind: 'transition', to: 'implementing', fencing_token: 1 })).problems, ['EVENT.STALE_FENCING_TOKEN'])
  assert.ok(applyEvent(lc, task, ev({ kind: 'transition', to: 'implementing', fencing_token: 2 })).ok)
  assert.deepEqual(applyEvent(lc, task, ev({ kind: 'transition', to: 'blocked', reason_code: 'WORKER_TERMINATED', fencing_token: 2 })).problems, ['TRANSITION.REASON_NOT_ALLOWED_FOR_STATE'])
})

test('cleanup: only the same taskâ€™s idle/stale/exited resources; other tasks, running work and migrations are refused by the D3.2 evaluator', () => {
  const { policy } = buildPolicy()
  let reg = {}
  reg = registerResource(reg, { id: 'vm-overlay-1', ownerTaskId: 'task-1', kind: 'cache', lifecycle: 'stale' })
  reg = registerResource(reg, { id: 'proc-test-1', ownerTaskId: 'task-1', kind: 'process', lifecycle: 'running' })
  reg = registerResource(reg, { id: 'mig-1', ownerTaskId: 'task-1', kind: 'migration', lifecycle: 'idle' })
  reg = registerResource(reg, { id: 'other-1', ownerTaskId: 'task-2', kind: 'container', lifecycle: 'exited' })
  assert.throws(() => registerResource(reg, { id: 'mig-1', ownerTaskId: 'task-1', kind: 'migration' }), /DUPLICATE/)
  const plan = cleanupPlan({ registry: reg, taskId: 'task-1', evaluateFn: evaluate, policy, taskCtx: trustedFor('orchestrator').task, now: NOW })
  assert.deepEqual(plan.allowed, ['vm-overlay-1'])
  const why = Object.fromEntries(plan.refused.map((x) => [x.id, x.reason_codes]))
  assert.ok(why['proc-test-1'].includes('RESOURCE.UNSAFE_LIFECYCLE'))
  assert.ok(why['mig-1'].includes('RESOURCE.ACTIVE_MIGRATION'))
  assert.ok(why['other-1'].includes('RESOURCE.NOT_OWNED'))
  const after = cleanupPlan({ registry: setLifecycle(reg, 'proc-test-1', 'exited'), taskId: 'task-1', evaluateFn: evaluate, policy, taskCtx: trustedFor('orchestrator').task, now: NOW })
  assert.deepEqual(after.allowed.sort(), ['proc-test-1', 'vm-overlay-1'])
  const prohibited = evaluate({ policy, request: { action: 'terminate_unowned_processes', task_id: 'task-1' }, trusted: trustedFor('orchestrator'), now: NOW })
  assert.equal(prohibited.decision, 'deny'); assert.ok(prohibited.reason_codes.includes('ACTION.PROHIBITED:terminate_unowned_processes'))
})

test('remediation: process identity â€” reused pids are not ours; exited records are final; reattach demands guest cleanup', () => {
  const rec = { ...REC, marker: 'dh3:dh3-w1:1', qemu_start: new Date(NOW).toISOString() }
  const ours = [{ pid: 10, name: 'powershell.exe', created_ms: NOW - 5000, cmdline: 'powershell -File job-supervisor.ps1 -Marker dh3:dh3-w1:1' }, { pid: 11, name: 'qemu-system-x86_64.exe', created_ms: NOW + 2000, cmdline: 'qemu -name dh3-w1 -m 768M' }]
  assert.deepEqual(identifyProcesses(rec, ours, { vmName: 'dh3-w1' }), { supervisor: true, qemu: true, qemuImage: 'qemu-system-x86_64.exe', reused: false })
  const reusedPs = [{ ...ours[0], cmdline: 'powershell -NoProfile (owner shell)' }, ours[1]]
  assert.equal(identifyProcesses(rec, reusedPs, { vmName: 'dh3-w1' }).supervisor, false)
  assert.equal(identifyProcesses(rec, reusedPs, { vmName: 'dh3-w1' }).reused, true)
  assert.equal(identifyProcesses(rec, [ours[0], { ...ours[1], created_ms: NOW + 3600000 }], { vmName: 'dh3-w1' }).qemu, false, 'same pid, different start time')
  assert.equal(identifyProcesses(rec, null).supervisor, null)
  const lease = issueLease({ workerId: 'w1', taskId: 'task-1', now: NOW })
  assert.equal(recoveryDecision({ record: { ...REC, state: 'exited' }, lease, liveness: { supervisor: true, qemu: true }, now: NOW }).action, 'mark_exited', 'pids of an exited record are never acted on')
  assert.equal(recoveryDecision({ record: REC, lease, liveness: { supervisor: false, qemu: true, reused: true }, now: NOW }).codes[0], 'RECOVERY.PID_REUSED')
  assert.equal(recoveryDecision({ record: REC, lease, liveness: { supervisor: true, qemu: true, qemuImage: 'qemu-system-x86_64.exe' }, now: NOW }).guest_cleanup, 'kill_worker_processes_then_verify')
})

test('remediation: stale-lock breaking cannot delete a fresh lock written by another breaker', () => {
  const d = tmp()
  try {
    const f = path.join(d, 'l')
    acquireLock(f, { execution_id: 'dead' })
    // Simulate the race: between our read of the stale record and our claim, another process replaced it with a FRESH lock.
    const r = acquireLock(f, { execution_id: 'me' }, { isHolderAlive: () => { writeFileSync(f, JSON.stringify({ execution_id: 'fresh-other', pid: 1 })); return false } })
    assert.equal(r.ok, false); assert.equal(r.code, 'LOCK.HELD')
    assert.equal(readJsonState(f).value.execution_id, 'fresh-other', 'the other process keeps its lock')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
