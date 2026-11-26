// D3.5 — regression tests for the independent code review (Sonnet, round 1) mandatory findings CR-1, CR-3..CR-7 (CR-2 lives in d35-lifecycle-proposal.test.mjs).
// Each test reproduces the reviewer's failure scenario against the FIXED code. Simulated adapters; real ledger, scheduler, engine and files.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { createBackup, fileWitness, recoverLedger } from '../orchestrator/ledger/disaster-recovery.mjs'
import { Scheduler } from '../orchestrator/scheduler.mjs'
import { SUPERVISOR_DEFAULTS, attempt } from '../orchestrator/recovery-supervisor.mjs'
import { H, drive } from './d34-rem-helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

test('CR-1: a second scheduler round or engine tick started DURING a live session is refused (single-flight) and never supersedes the running lease', async () => {
  const h = H({ scenario: { stages: { implementing: [{ units: 2 }] } } })
  try {
    const s = new Scheduler(h.engine); const id = h.submit(); const seen = []
    const orig = h.adapters.session.runUnit.bind(h.adapters.session)
    h.adapters.session.runUnit = async (a) => {
      if (a.stage === 'implementing' && !seen.length) {
        const lease = h.ledger.leaseOfTask(id)
        seen.push((await s.round()).busy, (await h.engine.tick()).busy)
        assert.ok(h.engine.inflight.has(lease.lease_id), 'the running session\'s lease is in flight')
        assert.deepEqual(await h.engine.reconcileOrphans(), [], 'an in-flight lease is not an orphan')
        assert.equal(h.ledger.leaseOfTask(id)?.state, 'active')
      }
      return orig(a)
    }
    let r; for (let i = 0; i < 400; i += 1) { r = await s.round(); if (!r.progressed) break }
    assert.deepEqual(seen, [true, true])
    assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM leases WHERE task_id=? AND state='superseded'").get(id).c, 0, 'no live session was superseded')
    assert.equal(h.ledger.getTask(id).fencing_token, 1)
    assert.equal(h.engine.inflight.size, 0)
    await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1)
  } finally { h.close() }
})

test('CR-3: a restore interrupted BETWEEN the renames of the live ledger and its -wal never replays the stale WAL onto the candidate; companion files are preserved', async () => {
  const h = H(); const id = h.submit(); await drive(h)
  const dirs = { b: path.join(h.dirs.root, 'b'), c: path.join(h.dirs.root, 'c'), q: path.join(h.dirs.root, 'q'), lock: path.join(h.dirs.root, 'lock'), w: path.join(h.dirs.root, 'w.json') }
  const witness = fileWitness(dirs.w, { simulationTrusted: true }); createBackup(h.ledger, dirs.b, { freeMb: () => 1e6 }); witness.publish(h.ledger)
  const live = h.dirs.ledger; h.close()
  writeFileSync(live, 'corrupt main file'); writeFileSync(`${live}-wal`, 'a stale write-ahead log of the OLD live ledger')
  const args = { liveFile: live, backupDir: dirs.b, candidateDir: dirs.c, quarantineDir: dirs.q, lockFile: dirs.lock, witness, isHolderAlive: () => false }
  assert.throws(() => recoverLedger({ ...args, hook: (n) => { if (n === 'after_move_main') throw new Error('CRASH_BETWEEN_RENAMES') } }), /CRASH_BETWEEN_RENAMES/)
  assert.ok(!existsSync(live) && existsSync(`${live}-wal`), 'the crash left the stale WAL behind')
  assert.ok(recoverLedger(args).ok)
  assert.ok(readdirSync(dirs.q).some((n) => n.endsWith('-wal')), 'the stale WAL was preserved, not replayed')
  const R = Ledger.open(live); try { assert.ok(R.getTask(id), 'the restored ledger has the BACKUP content') } finally { R.close() }
})

test('CR-4: the recovery circuit half-opens after its wait (one trial; a failure re-opens it), old attempts decay, and resumeSuspended clears them', () => {
  let t = 1_000_000; const L = Ledger.open(':memory:', { clock: () => t })
  const cfg = SUPERVISOR_DEFAULTS
  for (let i = 1; i <= 3; i += 1) { assert.equal(attempt(L, 'task-x', 'worker_replace', cfg).allowed, true); t += 3600_000 }
  assert.equal(attempt(L, 'task-x', 'worker_replace', cfg).exhausted, true)
  t += cfg.circuitOpenMs + 1
  const trial = attempt(L, 'task-x', 'worker_replace', cfg); assert.equal(trial.allowed, true, 'half-open: one trial')
  t += 3600_000; assert.equal(attempt(L, 'task-x', 'worker_replace', cfg).exhausted, true, 'the failed trial re-opens the circuit')
  for (let i = 0; i < 2; i += 1) { attempt(L, 'task-y', 'provider_wait', cfg); t += 1000 }
  t += cfg.decayMs + 1; assert.equal(attempt(L, 'task-y', 'provider_wait', cfg).attempts, 1, 'isolated blips long ago do not accumulate')
  L.close()
})

test('CR-5: a concurrently admitted workload\'s reservation is subtracted from the worker\'s memory too; a task\'s own reservations never count against itself', async () => {
  const h = H()
  try {
    const L = h.ledger; const a = h.submit({ requirements: { text: 'A' } }); const b = h.submit({ requirements: { text: 'B' } })
    for (const id of [a, b]) { L.transition(id, 'queued'); L.transition(id, 'planning') }
    const orig = h.adapters.resources.sample.bind(h.adapters.resources); h.adapters.resources.sample = () => { const s = orig(); s.guest.mem_available_mb = 2000; return s }
    const need = { stage: 'planning', ai: true, profile: 'reasoning' }
    assert.equal((await h.engine.checkAdmission(a, need)).ok, true)
    L.reserveFor(b, 'sched-heavy-b', 'heavy_test', { mem_mb: 1536 })
    const r = await h.engine.checkAdmission(a, need); assert.equal(r.ok, false); assert.ok(r.codes.includes('RESOURCE.GUEST_MEMORY_LOW'), JSON.stringify(r))
    L.releaseReservation('sched-heavy-b'); L.reserveFor(a, 'sched-ai-a', 'reasoning', { mem_mb: 768 })
    assert.equal((await h.engine.checkAdmission(a, need)).ok, true, 'its own reservation is not counted against it')
  } finally { h.close() }
})

test('CR-6: an adapter re-verification is accepted only from SIMULATED adapters, only with a SIMULATED_* basis, at most once per recheck interval, and is marked as adapter-sourced', async () => {
  const h = H()
  try {
    const gov = h.adapters.subscription.load(); const now = h.clock.now()
    h.adapters.subscription.reverifyExtraUsage = async () => ({ supported: true, billable: false, enabled: false, verified_at: h.clock.now() - 5, basis: 'LIVE_ENDPOINT' })
    assert.equal((await h.engine.reverifyBilling(gov, now)).code, 'BILLING.REVERIFICATION_UNAVAILABLE', 'a non-SIMULATED basis is refused')
    h.clock.advance(h.engine.cfg.subscriptionRecheckMs + 1)
    h.adapters.subscription.reverifyExtraUsage = async () => ({ supported: true, billable: false, enabled: false, verified_at: h.clock.now() - 5, basis: 'SIMULATED_SOURCE' })
    assert.equal((await h.engine.reverifyBilling(gov, h.clock.now())).ok, true); assert.equal(h.adapters.subscription.load().extra_usage.source, 'adapter_reverification')
    assert.equal((await h.engine.reverifyBilling(gov, h.clock.now())).code, 'BILLING.REVERIFICATION_RATE_LIMITED')
    h.adapters.simulated = false; h.clock.advance(h.engine.cfg.subscriptionRecheckMs + 1)
    assert.equal((await h.engine.reverifyBilling(gov, h.clock.now())).code, 'BILLING.LIVE_REVERIFICATION_NOT_AUTHORIZED')
    h.adapters.simulated = true
  } finally { h.close() }
})

test('CR-7: a proposal reducer is refused BEFORE any file is created; the temp check respects path boundaries', () => {
  const R = { label: 'PROPOSAL_UNDER_TEST', applyEvent: () => ({}), createTask: () => ({}), lc: {} }
  const outside = path.join(ROOT, `cr7-${process.pid}.sqlite`)
  assert.throws(() => Ledger.open(outside, { proposalReducer: R }), /OUTSIDE_TEMP/); assert.equal(existsSync(outside), false, 'no litter is created')
  assert.equal(Ledger.isTempLedgerPath(path.join(`${os.tmpdir()}-evil`, 'x.sqlite')), false)
  assert.equal(Ledger.isTempLedgerPath(path.join(os.tmpdir(), 'x.sqlite')), true)
})

test('review S-1: a scheduler pre-reservation carries a real expiry and counts on the HOST side; a termination-unverified slot keeps its reservation counted', async () => {
  const { pendingReservedMb } = await import('../runtime/resource-governor.mjs')
  const h = H()
  try {
    const L = h.ledger; const a = h.submit({ requirements: { text: 'A' } }); const now = h.clock.now()
    L.reserveFor(a, 'sched-ai:x', 'reasoning', { mem_mb: 4000 }, { expiresAt: now + 60_000 })
    assert.equal(pendingReservedMb(L.pendingReservations(), now), 4000)
    L.releaseReservation('sched-ai:x'); L.transition(a, 'queued'); L.transition(a, 'planning')
    const l = L.acquireLease({ taskId: a, role: 'planner', stage: 'planning', model: 'sonnet', effort: 'high', ttlMs: 1000, reservation: { mem_mb: 900 } }).lease
    L.closeLease(l, { terminationVerified: false, endReason: 'x' }); h.clock.advance(10_000)
    assert.equal(pendingReservedMb(L.pendingReservations(), h.clock.now()), 900, 'an unverified stop keeps its memory counted after the lease expiry')
  } finally { h.close() }
})
