// D3.5-D — MANDATORY ACCEPTANCE: the REAL 2026-11-26 low-memory interruption (doc 23) as an automated scenario with ZERO owner interventions.
// Reproduced conditions: a 16 GB host at ~1.4 GB free, an idle (task-owned) reviewer still alive, the owner's dev servers resident (unregistered), a sequential 1 GB-heap
// suite killed by the low-memory reaper inside `d34-crash` after 11 files were green, a partial result (29/30) that looks like a failure, recovery after task-owned
// cleanup + a resource wait, and the interrupted file then passing 33/33. SIMULATED: the test files, the memory figures and the reaper are scenario inputs; the ledger,
// classifier, waits, cleanup authority, scheduler-free engine and every invariant check are the real code.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EXPECTED_FILES } from '../ci/run-v3-suites.mjs'
import { admit, D33_THRESHOLDS } from '../runtime/resource-governor.mjs'
import { registerOwned } from '../orchestrator/cleanup.mjs'
import { UNIT_DEFAULTS, classifyUnit, unitsOf } from '../orchestrator/test-units.mjs'
import { H, drive, owner } from './d34-rem-helpers.mjs'

const D34 = EXPECTED_FILES.filter((f) => f.startsWith('d3') || ['evaluator', 'final-review', 'foundation', 'git-facts', 'hardening', 'lifecycle', 'promotion', 'security', 'subscription'].some((p) => f.startsWith(p))).filter((f) => !f.startsWith('d35-'))
const CRASH = 'd34-crash.test.mjs'
// the real run order had 11 files green before d34-crash
const UNITS = [...D34.filter((f) => f !== CRASH).slice(0, 11), CRASH, ...D34.filter((f) => f !== CRASH).slice(11)]

function incident(over = {}) {
  const h = H(); const L = h.ledger
  const id = h.submit()
  const world = { free: 6200, calls: [], killedOnce: false, procs: new Map([[7001, { start: 1, owner: true }], [7002, { start: 2, owner: true }], [8001, { start: 3, owner: false }]]), stopped: new Set(), recoverAt: null }
  const origSample = h.adapters.resources.sample.bind(h.adapters.resources)
  h.adapters.resources.sample = () => { const s = origSample(); s.host.available_mb = world.recoverAt !== null && L.now() >= world.recoverAt ? 3600 : world.free; return s }
  h.adapters.tests.units = async () => UNITS
  h.adapters.tests.runUnit = async ({ unit }) => {
    world.calls.push(unit)
    if (unit === CRASH && !world.killedOnce && over.kill !== false) {
      world.killedOnce = true
      world.free = 1400 // Node 22 suite + idle Opus reviewer + the owner's `next dev` / `npm run dev`
      const r = { status: null, signal: 'SIGKILL', counts: { tests: 30, pass: 29, fail: 0, skipped: 0, cancelled: 0 } }
      if (over.reaper !== false) r.reaper = { kind: 'low_memory_reaper', at: L.now() }
      world.free = over.memAfterKill ?? 2000 // the killed suite's own memory comes back; with the reviewer stopped (+900) it is still below the 3 GB floor until the owner's load drops
      return r
    }
    if (over.genuine && unit === CRASH) return { status: 1, counts: { tests: 33, pass: 32, fail: 1, skipped: 0, cancelled: 0 } }
    return { status: 0, counts: unit === CRASH ? { tests: 33, pass: 33, fail: 0, skipped: 0, cancelled: 0 } : { tests: 10, pass: 10, fail: 0, skipped: 0, cancelled: 0 } }
  }
  // the reviewer is a TASK-OWNED, idle resource with a verified identity; the owner's dev servers are not registered at all
  const reviewer = registerOwned(L, id, { kind: 'review_agent', processIdentity: { pid: 8001, start_time_ms: 3 }, lifecycle: 'idle' })
  h.adapters.procFacts = async (pi) => { const p = world.procs.get(pi?.pid); return p && !world.stopped.has(pi.pid) ? { alive: true, start_time_ms: p.start } : { alive: false } }
  h.adapters.cleanup = {
    async remove(item) { if (world.procs.get(item.process?.pid)?.owner) throw new Error('TRIED_TO_STOP_AN_OWNER_PROCESS'); world.stopped.add(item.process.pid); world.free += 900; if (world.recoverAt === null) world.recoverAt = L.now() + 10 * 60_000; return { ok: true } },
    async verifyGone(item) { return { gone: world.stopped.has(item.process.pid) } },
  }
  return { h, L, id, world, reviewer }
}

test('ACCEPTANCE (real incident, simulated inputs): reaper kill in d34-crash → classified as resource exhaustion, task-owned cleanup, automatic wait, interrupted unit first, no repeats, ZERO owner interventions', async () => {
  const { h, L, id, world } = incident()
  try {
    await drive(h)
    assert.equal(L.getTask(id).handoff_ready, 1, `the task reached its handoff (state ${L.getTask(id).state})`)
    // (4) resume safely: 11 green units, the killed d34-crash, then d34-crash FIRST again, then only the never-run units — each completed unit exactly once
    const expected = [...UNITS.slice(0, 12), CRASH, ...UNITS.slice(12)]
    assert.deepEqual(world.calls, expected)
    assert.equal(new Set(world.calls).size, UNITS.length)
    // (1) classification: resource pressure, never a test or task failure; the partial 29/30 is evidence, not a result
    const ints = L.recoveryHistory(id).filter((r) => r.kind === 'test_unit_interrupted')
    assert.equal(ints.length, 1); assert.equal(ints[0].detail.kind, 'verified_resource_kill'); assert.equal(ints[0].detail.unit, CRASH); assert.equal(ints[0].detail.completed, 11)
    assert.deepEqual(ints[0].detail.evidence.partial, { tests: 30, pass: 29, fail: 0 }); assert.equal(ints[0].detail.evidence.reaper, true)
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM retry_budgets WHERE task_id=? AND stage='testing'").get(id).c, 0, 'no failure fingerprint / retry budget spent')
    assert.ok(!L.recoveryHistory(id).some((r) => ['stage_failure', 'remediation_entered', 'technical_suspension'].includes(r.kind)), 'no remediation, no suspension')
    const runs = L.db.prepare('SELECT passed, results_json FROM test_runs WHERE task_id=?').all(id)
    assert.equal(runs.length, 1); assert.equal(runs[0].passed, 1, 'the only recorded test run is the complete, passing one'); assert.equal(JSON.parse(runs[0].results_json).units, UNITS.length)
    // (2) only what the task owns was released; the owner's dev servers were never touched
    assert.ok(world.stopped.has(8001)); assert.ok(!world.stopped.has(7001) && !world.stopped.has(7002))
    assert.ok(L.recoveryHistory(id).some((r) => r.kind === 'idle_owned_released' && r.detail.freed.length === 1))
    // (3) waited automatically in a persisted waiting_resources state against the RUNNER floor (3 GB for a 1 GB heap) — not the VM threshold, not a poll loop, no flapping
    const waits = L.db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id=? AND to_state='waiting_resources'").get(id).c
    assert.equal(waits, 1, 'one transition into waiting_resources; the re-admission samples did not flap the lifecycle')
    assert.equal(UNIT_DEFAULTS.freeFloorMb, 3072); assert.equal(UNIT_DEFAULTS.runnerHeapMb, 1024)
    assert.equal(admit('vm_start', { host: { available_mb: 3400, committed_mb: 8000, commit_limit_mb: 35000, commit_ratio: 0.4, paging_pages_per_sec: 5, cpu_pct: 10, disk_free_gb: 200, host_responsive: true }, active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, now: 0, vmFloor: 'full' }).decision, 'wait',
      'the free memory that re-admits the host test runner (3.4 GB) would NOT admit a full worker VM: the two thresholds are different and the D3.3 one is untouched')
    assert.equal(D33_THRESHOLDS.vm_ram_floor_full_mb, 3072)
    // (5) evidence: samples, the classification, the wait and the resumption are all in the ledger
    const samples = L.db.prepare("SELECT sample_json FROM resource_samples WHERE task_id=? AND context='test_unit'").all(id).map((r) => JSON.parse(r.sample_json).free_mb)
    assert.ok(samples.length >= 10 && samples.includes(2000) && samples.includes(2900) && samples.includes(3600), JSON.stringify(samples))
    assert.equal(unitsOf(L, ints[0].detail.group_id).find((u) => u.unit_id === CRASH).attempts, 2)
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }, 'ZERO routine owner interventions')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind IN ('genuine_blocker','technical_suspension')").get().c, 0)
  } finally { h.close() }
})

test('the interrupted unit STILL fails on its rerun → a genuine failure: normal remediation with its own fingerprint (the interruption itself is not counted)', async () => {
  const { h, L, id, world } = incident({ genuine: true })
  try {
    for (let i = 0; i < 80 && !L.recoveryHistory(id).some((r) => r.kind === 'remediation_entered'); i += 1) { await h.engine.runUntilIdle({ maxTicks: 50 }); h.clock.advance(16_000) }
    const rem = L.recoveryHistory(id).filter((r) => r.kind === 'remediation_entered')
    assert.equal(rem.length, 1); assert.equal(rem[0].detail.fingerprint, `test:units:${CRASH}`)
    assert.equal(world.calls.filter((c) => c === CRASH).length, 2, 'killed once, then genuinely failed on the rerun')
    assert.equal(world.calls.length, UNITS.length + 1, 'the remaining units still ran (a complete failure picture), none twice')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM retry_budgets WHERE task_id=? AND stage='testing'").get(id).c, 1, 'exactly ONE failure fingerprint: the genuine one')
  } finally { h.close() }
})

test('an interruption WITHOUT resource evidence is ambiguous: rerun first, no budget; repeated ambiguous kills end in a TECHNICAL suspension, never an owner blocker', async () => {
  const c = classifyUnit({ status: null, signal: 'SIGKILL', counts: null, startedAt: 1000, endedAt: 2000, samples: [{ at: 1500, free_mb: 6000 }] })
  assert.equal(c.kind, 'ambiguous_interruption', 'a kill while memory was healthy is not proven resource exhaustion')
  assert.equal(classifyUnit({ status: null, signal: 'SIGKILL', startedAt: 1000, endedAt: 2000, samples: [{ at: 1500, free_mb: 1400 }] }).kind, 'verified_resource_kill', 'kill signal + memory below the floor')
  assert.equal(classifyUnit({ status: null, lost: true, startedAt: 1000, samples: [{ at: 1500, free_mb: 1400 }] }).kind, 'ambiguous_interruption', 'a lost runner with low memory but no reaper record stays ambiguous')
  assert.equal(classifyUnit({ status: null, lost: true, startedAt: 1000, reaper: { kind: 'low_memory_reaper', at: 9_000_000 } }).kind, 'verified_resource_kill')
  assert.equal(classifyUnit({ status: 1, counts: { tests: 30, pass: 29, fail: 1, skipped: 0, cancelled: 0 }, startedAt: 1, endedAt: 2 }).kind, 'genuine_failure')
  assert.equal(classifyUnit({ status: 1, counts: { tests: 30, pass: 29, fail: 0, skipped: 0, cancelled: 1 }, startedAt: 1, endedAt: 2 }).kind, 'ambiguous_interruption', 'cancelled tests are an incomplete run')
  assert.equal(classifyUnit({ status: 0, counts: { tests: 3, pass: 2, fail: 0, skipped: 1, cancelled: 0 }, startedAt: 1, endedAt: 2 }).kind, 'genuine_failure', 'a skip is never a pass')
  const h = H(); const L = h.ledger
  try {
    const id = h.submit(); const calls = []
    h.adapters.tests.units = async () => ['u1', 'u2']
    h.adapters.tests.runUnit = async ({ unit }) => { calls.push(unit); return unit === 'u2' ? { status: null, signal: 'SIGTERM' } : { status: 0, counts: { tests: 1, pass: 1, fail: 0, skipped: 0, cancelled: 0 } } }
    await drive(h)
    assert.equal(calls.filter((x) => x === 'u1').length, 1, 'the completed unit is never repeated')
    assert.equal(calls.filter((x) => x === 'u2').length, UNIT_DEFAULTS.maxAmbiguousReruns + 1)
    const s = L.getSuspension(id); assert.equal(s?.cause, 'TEST_UNIT_INTERRUPTED_REPEATEDLY')
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM retry_budgets WHERE stage='testing'").get().c, 0)
  } finally { h.close() }
})

test('controller crash mid-unit: the restarted controller finds the unit LOST, reruns it first, and never repeats completed units', async () => {
  const root = (await import('./d34-rem-helpers.mjs')).tmp()
  const { createHarness } = await import('../orchestrator/sim/harness.mjs')
  const setup = (h, calls) => { h.adapters.tests.units = async () => ['a', 'b', 'c']; h.adapters.tests.runUnit = async ({ unit }) => { calls.push(unit); return { status: 0, counts: { tests: 2, pass: 2, fail: 0, skipped: 0, cancelled: 0 } } } }
  const calls = []
  let h = createHarness({ root, hook: (name, ctx) => { if (name === 'after_unit_started' && ctx.unit === 'b') throw new Error('CONTROLLER_DIED') } })
  setup(h, calls); const id = h.submit()
  await assert.rejects(() => drive(h), /CONTROLLER_DIED/)
  const clockAt = h.clock.now(); h.close()
  h = createHarness({ root, clock: new (await import('../orchestrator/sim/harness.mjs')).FixtureClock(clockAt) }); setup(h, calls)
  try {
    await drive(h)
    assert.deepEqual(calls, ['a', 'b', 'c'], 'b was started but never reported; after the restart it runs first, a is not repeated')
    assert.equal(h.ledger.getTask(id).handoff_ready, 1)
    assert.ok(h.ledger.recoveryHistory(id).some((r) => r.kind === 'test_unit_interrupted' && r.detail.lost === true && r.detail.unit === 'b'))
  } finally { h.close() }
})
