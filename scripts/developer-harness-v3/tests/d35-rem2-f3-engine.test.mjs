// D3.5 independent-verification remediation, F3 (engine side) — a test unit left `running` by a controller that died is re-run ONLY after the adapter PROVES its workload stopped. Simulated adapter (the live one —
// host process facts + the worker's process list — is gate G-LIVE-RECOVERY-ADAPTERS); the engine, ledger and unit bookkeeping are real. Pre-fix, `markLost` classified the unit as lost and re-ran it at once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Scheduler } from '../orchestrator/scheduler.mjs'
import { H } from './d34-rem-helpers.mjs'

const UNITS = ['u1.test.mjs', 'u2.test.mjs']
const OK = { status: 0, counts: { tests: 2, pass: 2, fail: 0, skipped: 0, cancelled: 0 } }
const spec = { requirements: { text: 'Task y: add the y indicator.', sim_path: 'apps/mobile/y/feature.txt' }, scope: { allowed_paths: ['apps/mobile/y/**'], denied_paths: [] } }

async function crashedMidUnit() {
  let crash = true; const h = H({ hook: (name) => { if (name === 'after_unit_started' && crash) { crash = false; throw new Error('CONTROLLER_CRASH') } } })
  const L = h.ledger; const s = new Scheduler(h.engine); const Y = h.submit(spec)
  for (let i = 0; i < 80 && L.getTask(Y).state !== 'testing'; i += 1) await s.round()
  assert.equal(L.getTask(Y).state, 'testing')
  const calls = []; h.adapters.tests.units = async () => UNITS; h.adapters.tests.runUnit = async ({ unit }) => { calls.push(unit); return OK }
  await assert.rejects(h.engine.advance(Y), /CONTROLLER_CRASH/) // the controller dies right after u1 was started
  const g = L.db.prepare("SELECT group_id, unit_id, status FROM test_units WHERE task_id=? AND status='running'").get(Y); assert.ok(g, 'u1 was left running')
  h.engine.busy = false
  return { h, L, s, Y, calls, g }
}

test('F3 engine: an unproven workload HOLDS the unit — no duplicate execution; the task waits; once the stop is proven the unit re-runs first and the task completes', async () => {
  const { h, L, s, Y, calls } = await crashedMidUnit()
  try {
    let proof = { verified: false, code: 'WORKLOAD_STILL_RUNNING' }; const asked = []
    h.adapters.tests.verifyUnitStopped = async (a) => { asked.push(a.unit); return proof }
    for (let i = 0; i < 4; i += 1) await s.round()
    assert.deepEqual(calls, [], 'nothing ran while the old workload was not proven stopped')
    assert.equal(L.getTask(Y).state, 'waiting_resources'); assert.ok(L.getWait(Y)?.detail?.codes?.includes('RESOURCE.TEST_UNIT_WORKLOAD_UNVERIFIED'))
    assert.equal(L.db.prepare("SELECT status FROM test_units WHERE task_id=? AND unit_id='u1.test.mjs'").get(Y).status, 'running', 'the held state is retained')
    assert.ok(asked.length >= 1 && asked.every((u) => u === 'u1.test.mjs'))
    assert.ok(L.recoveryHistory(Y).some((r) => r.kind === 'test_unit_workload_unverified'))
    proof = { verified: true }
    for (let k = 0; k < 40 && !L.getTask(Y).handoff_ready; k += 1) { for (let i = 0; i < 30; i += 1) { const r = await s.round(); if (!r.progressed) { if (r.next_wakeup) h.clock.advance(Math.max(1000, r.next_wakeup - h.clock.now() + 1)); break } } }
    assert.equal(calls[0], 'u1.test.mjs', 'the interrupted unit re-ran FIRST'); assert.equal(L.getTask(Y).handoff_ready, 1)
  } finally { h.close() }
})

test('F3 engine: an adapter that offers NO proof (or throws) is treated as unproven — fail closed', async () => {
  const { h, L, s, Y, calls } = await crashedMidUnit()
  try {
    h.adapters.tests.verifyUnitStopped = undefined
    await s.round(); assert.deepEqual(calls, []); assert.ok(L.recoveryHistory(Y).some((r) => r.kind === 'test_unit_workload_unverified' && r.detail.code === 'NO_WORKLOAD_VERIFIER'))
    h.adapters.tests.verifyUnitStopped = async () => { throw new Error('probe failed') }
    h.clock.advance(120_000); await s.round(); await s.round(); assert.deepEqual(calls, [], 'a throwing probe proves nothing')
  } finally { h.close() }
})
