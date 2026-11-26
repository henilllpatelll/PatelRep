// D3.4 remediation F2 — work is preserved across EVERY recoverable interruption (quota, resource wait, recoverable failure, cancellation, renewal, controller recovery),
// checkpoint restoration is crash-safe, unsafe artifacts are quarantined LOUDLY without discarding safe work, and missing/unknown termination evidence is never "cleaned up".
// The assertions are on the ACTUAL BYTES of the final candidate, not merely on reaching handoff. SIMULATED (no model/VM).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { T0 } from '../orchestrator/sim/harness.mjs'
import { loadWorld, readTree, wtDir } from '../orchestrator/sim/sim-world.mjs'
import { reconcileSlot } from '../orchestrator/recovery.mjs'
import { H, drive, settle, execs, finalBytes, unitLines, afterImplementingUnit } from './d34-rem-helpers.mjs'

const impl = (n = 5, extra = {}) => ({ stages: { implementing: [{ units: n, ...extra }] } })
const kinds = (h, id) => h.ledger.recoveryHistory(id).map((x) => x.kind)

test('F2: a QUOTA interruption after implementation already wrote files keeps every byte (verified checkpoint at the interruption, exact resume)', async () => {
  const scenario = { ...impl(), quota: [] }; let h
  h = H({ scenario }); afterImplementingUnit(h, 2, () => scenario.quota.push({ from: h.clock.now(), to: h.clock.now() + 3 * 3600_000 })); const id = h.submit()
  await settle(h); const t = h.ledger.getTask(id); assert.equal(t.state, 'waiting_subscription')
  const cp = h.ledger.latestCheckpoint(id); assert.ok(cp?.verified === 1 && cp.snapshot_ref, 'the work written before the quota hit is in a VERIFIED checkpoint'); assert.equal(h.ledger.slotHolder(), null)
  await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1)
  assert.equal(finalBytes(h, id), unitLines(5), 'units 1-2 (before the quota wait) and 3-5 (after) are all present, exactly once, in order'); h.close()
})

test('F2: a failure AFTER work was written preserves it: unit-level failure injected at the third unit, retried with back-off', async () => {
  let h; const scenario = impl(5); let armed = true
  h = H({ scenario }); const orig = h.adapters.session.runUnit.bind(h.adapters.session); let n = 0
  h.adapters.session.runUnit = async (a) => { if (a.stage === 'implementing') n += 1; if (armed && a.stage === 'implementing' && n === 3) { armed = false; return { status: 'failed', code: 'SESSION.UNIT_FAILED', fingerprint: 'transient-3', lines: [], exit: { code: 1 }, turns: 0 } } return orig(a) }
  const id = h.submit(); await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.ok(kinds(h, id).includes('stage_failure'))
  assert.equal(finalBytes(h, id), unitLines(5), 'the two units written before the failure survived it'); h.close()
})

test('F2: an UNSAFE artifact (credential-named file) is QUARANTINED loudly; the SAFE work beside it is still checkpointed and restored; the unsafe file never reaches the candidate', async () => {
  const scenario = { baseContext: 20_000, growthPerUnit: 40_000, contextWindow: 200_000, stages: { implementing: [{ units: 5, extraFiles: [{ path: 'apps/mobile/.env', content: 'EXPO_PUBLIC_NAME=demo\n' }], extraFilesOnUnit: 2 }] } }
  const h = H({ scenario }); const id = h.submit(); await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1, 'renewal did not fail because of one unsafe file')
  const q = h.ledger.recoveryHistory(id).filter((x) => x.kind === 'unsafe_artifacts_quarantined'); assert.ok(q.length >= 1, 'recorded, never silent'); assert.ok(q[0].detail.artifacts.some((a) => a.path === 'apps/mobile/.env' && a.problems.some((p) => /CREDENTIAL_FILE_NAME/.test(p))))
  assert.ok(!JSON.stringify(q).includes('EXPO_PUBLIC_NAME'), 'the quarantine record never contains file CONTENT')
  assert.equal(finalBytes(h, id), unitLines(5), 'safe work intact'); assert.ok(!readTree(path.join(h.dirs.world, 'commits', id, '1')).some((f) => f.path.endsWith('.env')), 'the unsafe file is not in the candidate')
  const cp = h.ledger.db.prepare('SELECT payload_json FROM checkpoints WHERE task_id=? ORDER BY seq').all(id).map((r) => JSON.parse(r.payload_json)); assert.ok(cp.some((p) => Array.isArray(p.quarantined) && p.quarantined.length === 1)); h.close()
})

test('F2: a CORRUPT or MISSING checkpoint snapshot never silently discards safe work — the live worktree is preserved BEFORE it is reset, and the problem is recorded', async () => {
  for (const damage of ['corrupt', 'missing']) {
    const scenario = { ...impl(), quota: [] }; let h
    h = H({ scenario }); afterImplementingUnit(h, 2, () => scenario.quota.push({ from: h.clock.now(), to: h.clock.now() + 3600_000 })); const id = h.submit(); await settle(h)
    const cp = h.ledger.latestCheckpoint(id); const dir = path.join(h.dirs.snapshots, cp.snapshot_ref)
    if (damage === 'corrupt') for (const f of readdirSync(path.join(dir, 'blobs'))) writeFileSync(path.join(dir, 'blobs', f), 'flipped bytes')
    else { const { rmSync } = await import('node:fs'); rmSync(dir, { recursive: true, force: true }) }
    await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1, damage)
    assert.ok(kinds(h, id).includes('checkpoint_unusable'), `${damage}: the unusable checkpoint is recorded`); assert.equal(finalBytes(h, id), unitLines(5), `${damage}: no work was lost`); h.close()
  }
})

test('F2: cancellation preserves the work in a verified checkpoint (nothing is discarded because a task was cancelled)', async () => {
  const h = H({ scenario: impl() }); afterImplementingUnit(h, 2, () => h.ledger.cancel(h.ledger.listTasks()[0].task_id)); const id = h.submit(); await settle(h)
  const cp = h.ledger.latestCheckpoint(id); assert.ok(cp?.verified === 1 && cp.snapshot_ref); const files = readFileSync(path.join(h.dirs.snapshots, cp.snapshot_ref, 'manifest.json'), 'utf8'); assert.ok(files.includes('apps/mobile/feature.txt'))
  assert.equal(h.ledger.slotHolder(), null); h.close()
})

test('F2: recovery of an orphaned lease supersedes it ATOMICALLY with the snapshot checkpoint (no window in which the slot is free but the work is not persisted)', async () => {
  const { h, id } = await orphan(); assert.ok(h.ledger.slotHolder(), 'the dead controller left its lease'); assert.equal(Object.keys(loadWorld(h.dirs.world).alive_sessions).length, 1)
  const seen = []; const orig = h.ledger.supersedeLease.bind(h.ledger)
  h.ledger.supersedeLease = (a) => { const r = orig(a); seen.push({ slot: h.ledger.slotHolder(), cps: h.ledger.db.prepare('SELECT COUNT(*) c FROM checkpoints WHERE verified=1').get().c }); return r }
  const r = await reconcileSlot(h.engine, { reason: 'HOST_RESTARTED' }); assert.equal(r.cleared, true)
  assert.equal(seen.length, 1); assert.equal(seen[0].slot, null); assert.equal(seen[0].cps, 1, 'the verified checkpoint committed together with the supersession')
  assert.ok(kinds(h, id).includes('uncommitted_work_preserved')); await drive(h); assert.equal(finalBytes(h, id), unitLines(5)); h.close()
})

// ---- missing / unknown termination and liveness evidence is never success
/** What a SIGKILLed controller leaves behind: an active lease, a live guest session and two units of UNCOMMITTED work in the worktree. */
async function orphan(scenario = impl(5)) {
  const h = H({ scenario }); const id = h.submit()
  for (let i = 0; i < 6 && h.ledger.getTask(id).state !== 'implementing'; i += 1) await h.engine.tick()
  assert.equal(h.ledger.getTask(id).state, 'implementing'); const task = h.ledger.getTask(id)
  const got = h.ledger.acquireLease({ taskId: id, role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'medium', ttlMs: 35 * 60_000 }); assert.ok(got.ok); h.ledger.markExecutionRunning(got.lease.execution_id)
  await h.adapters.worker.ensure(); assert.ok((await h.adapters.git.prepareWorktree(task, { snapshotDir: null, readonly: false })).ok)
  for (let i = 0; i < 2; i += 1) assert.equal((await h.adapters.session.runUnit({ task, lease: got.lease, route: { model: 'sonnet', effort: 'medium' }, readonly: false, stage: 'implementing' })).status, 'unit_limit')
  return { h, id, lease: got.lease }
}
test('F2: UNKNOWN or MISSING liveness / cleanup / process-verification evidence leaves the slot HELD — it is never treated as successful cleanup', async () => {
  const cases = {
    'liveness() throws': (h) => { h.adapters.worker.liveness = async () => { throw new Error('probe failed') } },
    'liveness unknown (null probes)': (h) => { h.adapters.worker.liveness = async () => ({ record: { schema: 'patelrep.developer-harness-v3.vm-supervisor', supervisor_pid: 1, qemu_pid: 2, marker: 'm', state: 'running' }, liveness: { supervisor: null, qemu: null } }) },
    'verifyNoWorkerProcesses missing': (h) => { delete h.adapters.worker.verifyNoWorkerProcesses },
    'verifyNoWorkerProcesses unverified': (h) => { h.adapters.worker.verifyNoWorkerProcesses = async () => ({ verified: false }) },
    'verifyNoWorkerProcesses returns nothing': (h) => { h.adapters.worker.verifyNoWorkerProcesses = async () => undefined },
    'cleanupGuest returns a truthy non-true': (h) => { h.adapters.worker.cleanupGuest = async () => ({ verified: 'yes' }) },
    'cleanupGuest returns nothing': (h) => { h.adapters.worker.cleanupGuest = async () => undefined },
  }
  for (const [name, mut] of Object.entries(cases)) {
    const { h, id } = await orphan(); const n0 = execs(h, id).length; mut(h); const r = await reconcileSlot(h.engine, { reason: 'HOST_RESTARTED' })
    assert.equal(r.cleared, false, `${name}: not cleared`); assert.ok(h.ledger.slotHolder(), `${name}: slot still held`); assert.equal(h.ledger.getTask(id).fencing_token, 1, `${name}: no recovery epoch was minted`)
    const tick = await h.engine.tick(); assert.equal(tick.progressed, false, `${name}: and NO new session is admitted`); assert.equal(execs(h, id).length, n0, name); h.close()
  }
})

test('F2: a termination result that is not exactly verified:true never releases the slot; with cleanup also unverified NO second session starts; with verified cleanup the retry is back-off bounded (no runaway paid sessions)', async () => {
  for (const bad of [undefined, null, {}, { verified: 1 }, { verified: 'true' }, { verified: false }]) {
    const h = H({ scenario: impl(2) }); h.adapters.worker.terminateSession = async () => bad; h.adapters.worker.cleanupGuest = async () => ({ verified: false }); const id = h.submit(); await settle(h)
    assert.equal(h.ledger.slotHolder()?.state, 'termination_unverified', `termination result ${JSON.stringify(bad)} did not release the slot`); assert.equal(execs(h, id).length, 1, 'no second session while the first is unproven dead'); assert.ok(execs(h, id).every((e) => e.status !== 'terminated_verified')); h.close()
  }
  for (const bad of [undefined, {}, { verified: 'true' }]) {
    const h = H({ scenario: impl(2) }); h.adapters.worker.terminateSession = async () => bad; const id = h.submit(); await settle(h) // cleanup verifies, so the old lease is superseded — but the failure must be BUDGETED
    assert.ok(execs(h, id).length <= 2, `${JSON.stringify(bad)}: bounded by back-off, not a tight loop of paid sessions (${execs(h, id).length})`); assert.ok(h.ledger.db.prepare('SELECT COUNT(*) c FROM retry_budgets WHERE task_id=?').get(id).c >= 1, 'the failure was recorded against a retry budget'); h.close()
  }
})

// ---- the committed/uncommitted split survives a recovery epoch bump
test('F2: recovery after a controller crash mid-implementation keeps the exact bytes of all units (real fencing-epoch bump)', async () => {
  const { h, id } = await orphan(); const r = await reconcileSlot(h.engine, { reason: 'HOST_RESTARTED' }); assert.equal(r.cleared, true); assert.equal(h.ledger.getTask(id).fencing_token, 2)
  await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.equal(finalBytes(h, id), unitLines(5)); assert.ok(T0 > 0); assert.ok(existsSync(h.dirs.snapshots)); h.close()
})
