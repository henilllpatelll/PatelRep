// D3.4 crash/restart: a REAL controller OS process is killed (SIGKILL) at every critical execution boundary and restarted; real SQLite files, real subprocesses,
// real issuer processes over authenticated IPC for the multi-process run. Simulated world (no model/VM): the point is the controller's durability and recovery.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHarness } from '../orchestrator/sim/harness.mjs'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { acceptEvidence } from '../orchestrator/ledger/evidence-store.mjs'
import { acquireLock } from '../lib/atomic.mjs'
import { commitDir, loadWorld } from '../orchestrator/sim/sim-world.mjs'
import { buildPolicy, evidence, BASE, ENV_ID, HEAD, PATCH, REPO, TREE, NOW } from './helpers.mjs'
import { CHILD_ENV, HERE, ORCH, startIssuers, tmp } from './d34-helpers.mjs'

const MAIN = path.join(ORCH, 'sim', 'controller-main.mjs')
const SCENARIO = { baseContext: 20_000, growthPerUnit: 40_000, contextWindow: 200_000, stages: { implementing: [{ units: 5 }] }, tests: [{ passed: true }] }
function controller(root, over = {}) {
  const cfgFile = path.join(root, `ctl-${Math.random().toString(36).slice(2)}.json`); writeFileSync(cfgFile, JSON.stringify({ root, scenario: SCENARIO, max_ticks: 400, ...over }))
  const r = spawnSync(process.execPath, [MAIN, cfgFile], { encoding: 'utf8', timeout: 240_000, env: CHILD_ENV }); return { status: r.status, signal: r.signal, out: r.stdout, err: r.stderr }
}
function prepare(scenario = SCENARIO) { const root = tmp('dh34-crash-'); const h = createHarness({ root, scenario }); const id = h.submit(); h.close(); return { root, id } }

/** The invariants that must hold after ANY crash + restart. */
function assertConsistent(root, id, { expectRecoveries = null } = {}) {
  const L = Ledger.open(path.join(root, 'ledger.sqlite')); const q = (s, ...a) => L.db.prepare(s).all(...a)
  try {
    const t = L.getTask(id); assert.equal(t.handoff_ready, 1, `final state ${t.state}`); assert.equal(t.state, 'publishing'); assert.equal(L.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.equal(q("SELECT 1 FROM leases WHERE state IN ('active','termination_unverified')").length, 0, 'no lease left holding the slot')
    assert.deepEqual(q("SELECT DISTINCT status FROM executions WHERE status NOT IN ('terminated_verified','abandoned')"), [], 'every execution ended with VERIFIED termination or was abandoned by a verified recovery')
    const rec = q("SELECT * FROM recovery_history WHERE kind='worker_recovered'"); assert.equal(t.fencing_token, 1 + rec.length, 'the fencing token advanced exactly once per recovery'); if (expectRecoveries !== null) assert.equal(rec.length, expectRecoveries)
    assert.equal(q("SELECT 1 FROM leases WHERE state='superseded'").length, rec.length, 'one superseded lease per recovery')
    assert.equal(q('SELECT COUNT(*) c FROM evidence').at(0).c, q('SELECT COUNT(*) c FROM evidence_nonces').at(0).c, 'every accepted evidence has exactly one durable nonce')
    assert.equal(q('SELECT COUNT(DISTINCT nonce) c FROM evidence').at(0).c, q('SELECT COUNT(*) c FROM evidence').at(0).c)
    const ev = q("SELECT evidence_type FROM evidence WHERE task_id=? AND invalidated_at IS NULL AND candidate_sha=? AND fencing_token=?", id, t.head_sha, t.fencing_token).map((r) => r.evidence_type).sort()
    assert.ok(['independent_review', 'security_review', 'test_results'].every((x) => ev.includes(x)), `all three approvals exist for the FINAL candidate/token: ${ev}`)
    const revs = q("SELECT status FROM reviews WHERE status IN ('open','submitted')"); assert.deepEqual(revs, [], 'no half-finished review survives')
    const evs = q('SELECT resulting_revision r FROM task_events WHERE task_id=? ORDER BY seq', id).map((x) => x.r); assert.ok(evs.every((r, i) => i === 0 || r === evs[i - 1] + 1), 'lifecycle revisions are gapless and monotonic')
    assert.equal(q("SELECT COUNT(*) c FROM outbox WHERE kind='handoff_ready'").at(0).c, 1, 'exactly one handoff notification even across restarts'); assert.equal(q("SELECT COUNT(*) c FROM outbox WHERE kind='genuine_blocker'").at(0).c, 0)
    assert.equal(q("SELECT COUNT(*) c FROM task_events WHERE to_state='blocked' OR event_json LIKE '%owner_action_id%'").at(0).c, 0, 'no owner involvement')
    assert.deepEqual(loadWorld(path.join(root, 'world')).alive_sessions, {}, 'no worker session survives in the guest'); assert.ok(L.requirementsIntact(id))
    return { token: t.fencing_token, recoveries: rec.length, history: L.recoveryHistory(id) }
  } finally { L.close() }
}

const POINTS = [['after_lease_acquired', 1], ['after_lease_acquired', 2], ['after_lease_acquired', 3], ['after_lease_acquired', 4], ['after_session_started', 2], ['after_unit', 3], ['after_checkpoint_recorded', 1], ['after_checkpoint_verified', 1], ['after_renewal_old_stopped', 1], ['after_renewal_new_lease', 1],
  ['after_session_terminated', 1], ['after_session_terminated', 2], ['after_lease_closed', 2], ['after_plan_saved', 1], ['after_candidate_recorded', 1], ['after_test_run_recorded', 1], ['after_evidence_issued', 1], ['after_evidence_accepted', 1],
  ['after_review_opened', 1], ['after_session_terminated', 3], ['after_session_terminated', 4], ['after_lease_closed', 3], ['after_lease_closed', 4], ['after_review_submitted', 1], ['after_evidence_issued', 3], ['after_evidence_accepted', 3], ['after_review_submitted', 2], ['after_handoff', 1]]

for (const [point, nth] of POINTS) {
  test(`SIGKILL at ${point} #${nth}, then restart: recovers, completes the handoff, and every durability invariant holds`, () => {
    const { root, id } = prepare()
    const first = controller(root, { crash_at: `${point}:${nth}` })
    assert.ok(existsSync(path.join(root, 'crashed-at.txt')), `the crash point was reached (exit ${first.status}/${first.signal}: ${first.err.slice(0, 200)})`); assert.equal(readFileSync(path.join(root, 'crashed-at.txt'), 'utf8'), `${point}:${nth}`)
    assert.notEqual(first.status, 0, 'the first controller died; it did not exit cleanly'); assert.equal(existsSync(path.join(root, 'controller.lock')), true, 'the dead controller left its lock behind')
    const last = controller(root) // the FIRST restart must succeed on its own
    assert.equal(last.status, 0, `restart failed: ${last.err.slice(0, 400)}`); assert.equal(JSON.parse(last.out).idle, true); assert.equal(JSON.parse(last.out).simulated, true)
    assertConsistent(root, id)
  })
}

test('uncommitted work in the guest survives a crash mid-implementation (verified CRASH_RECOVERY checkpoint, restored into the fresh session)', () => {
  const { root, id } = prepare(); controller(root, { crash_at: 'after_unit:3' })
  const h = controller(root); assert.equal(h.status, 0)
  const info = assertConsistent(root, id, { expectRecoveries: 1 }); assert.ok(info.history.some((x) => x.kind === 'uncommitted_work_preserved'), 'recovery captured the dead session\'s tree')
  const w = loadWorld(path.join(root, 'world')); const text = readFileSync(path.join(commitDir(path.join(root, 'world'), id, w.versions[id]), 'apps', 'mobile', 'feature.txt'), 'utf8')
  assert.ok(text.startsWith('unit 1 of v1\nunit 2 of v1\n'), `work done BEFORE the crash is in the final candidate: ${JSON.stringify(text)}`); assert.ok(text.includes('unit 5 of v1'), 'and the work continued after it')
})

test('a SECOND controller cannot start while the first is alive; a stale lock from a dead controller is broken; neither changes state when refused', () => {
  const { root, id } = prepare(); const lockFile = path.join(root, 'controller.lock')
  assert.ok(acquireLock(lockFile, { execution_id: 'controller', acquired_at: new Date().toISOString() }, {}).ok) // this very process (alive) holds it
  const refused = controller(root); assert.equal(refused.status, 3); assert.match(refused.err, /LOCK\.HELD/); const L = Ledger.open(path.join(root, 'ledger.sqlite')); assert.equal(L.getTask(id).state, 'submitted', 'a refused controller did nothing'); L.close()
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']); void dead
  const deadPid = (() => { const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},1)']); return new Promise((r) => c.on('exit', () => r(c.pid))) })()
  return deadPid.then((pid) => { writeFileSync(lockFile, JSON.stringify({ execution_id: 'controller', pid, acquired_at: new Date().toISOString() })); const ok = controller(root); assert.equal(ok.status, 0, ok.err); assertConsistent(root, id) })
})

test('TRUE parallel evidence consumption: N OS processes racing through their own SQLite connections — exactly one consumes, the rest are refused', async () => {
  const dir = tmp('dh34-race-'); const file = path.join(dir, 'l.sqlite'); const pol = buildPolicy(); const L = Ledger.open(file) // real clock: the worker processes use it too
  void NOW; const nowMs = Date.now()
  assert.ok(L.submitTask({ task_id: 'task-1', repository: REPO, base_sha: BASE, requirements: { text: 'r' }, scope: { allowed_paths: ['apps/mobile/**', 'supabase/migrations/**'], denied_paths: [] }, acceptance: { criteria: ['c'] }, risk_class: 'routine', policy_revision: pol.policy.revision, environment_id: ENV_ID }).ok)
  for (const s of ['queued', 'planning', 'implementing']) L.transition('task-1', s); assert.ok(L.submitCandidate('task-1', { base_sha: BASE, candidate_sha: HEAD, tree_digest: TREE, patch_digest: PATCH }).ok)
  const e = evidence('delivery_verification', { policy: pol.policy, keys: pol.keys, over: { fencing_token: 1, issued_at: new Date(nowMs - 60_000).toISOString(), expires_at: new Date(nowMs + 1_800_000).toISOString() } }); assert.ok(acceptEvidence(L, e, { policy: pol.policy }).ok); L.close()
  const go = path.join(dir, 'GO'); const N = 6
  const procs = Array.from({ length: N }, (_, i) => new Promise((resolve, reject) => { const p = spawn(process.execPath, [path.join(HERE, 'd34-race-worker.mjs'), file, e.payload.evidence_id, `worker-${i}`, go], { env: CHILD_ENV }); let out = ''; p.stdout.on('data', (d) => { out += d }); p.on('exit', () => { try { resolve(JSON.parse(out)) } catch { reject(new Error(`worker ${i} produced ${out}`)) } }) }))
  await new Promise((r) => setTimeout(r, 400)); writeFileSync(go, 'go'); const results = await Promise.all(procs)
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results)); assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'EVIDENCE.ALREADY_CONSUMED'))
  const L2 = Ledger.open(file); assert.equal(L2.db.prepare('SELECT COUNT(*) c FROM evidence WHERE consumed_at IS NOT NULL').get().c, 1); L2.close()
})

test('MULTI-PROCESS end to end: controller process + four REAL issuer processes over authenticated IPC; the controller is killed after an evidence issuance and restarted — one submission, no owner involvement', async () => {
  const root = tmp('dh34-mp-'); const h = createHarness({ root, scenario: SCENARIO }); const id = h.submit(); const iss = await startIssuers(h); h.close()
  try {
    const run = (over) => new Promise((resolve) => { const f = path.join(root, `mp-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify({ root, scenario: SCENARIO, issuer_endpoints: iss.endpoints, ...over })); const p = spawn(process.execPath, [MAIN, f], { env: CHILD_ENV }); let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d }); p.on('exit', (code) => resolve({ code, out, err })) })
    const a = await run({ crash_at: 'after_evidence_issued:2' }); assert.ok(existsSync(path.join(root, 'crashed-at.txt')), a.err); const b = await run({}); assert.equal(b.code, 0, b.err)
    assertConsistent(root, id); const L = Ledger.open(path.join(root, 'ledger.sqlite')); const store = L.db.prepare("SELECT evidence_type, issuer_identity FROM evidence WHERE task_id=? ORDER BY evidence_type").all(id).map((r) => `${r.evidence_type}:${r.issuer_identity}`)
    assert.deepEqual(store, ['independent_review:independent_reviewer', 'security_review:security_reviewer', 'test_results:orchestrator'], 'each approval was signed by its OWN issuer process'); L.close()
  } finally { iss.stop() }
})

test('NO REPEATED PAID WORK: after a crash at each post-session boundary, the number of executions per role equals an uncrashed run (no second session was bought)', () => {
  const roles = (root) => { const L = Ledger.open(path.join(root, 'ledger.sqlite')); try { return Object.fromEntries(L.db.prepare("SELECT role, COUNT(*) n FROM executions GROUP BY role").all().map((r) => [r.role, r.n])) } finally { L.close() } }
  const base = prepare(); assert.equal(controller(base.root).status, 0); const baseline = roles(base.root)
  for (const point of [['after_plan_saved', 1], ['after_session_terminated', 1], ['after_session_terminated', 2], ['after_candidate_recorded', 1], ['after_review_submitted', 1], ['after_handoff', 1]]) {
    const { root } = prepare(); controller(root, { crash_at: `${point[0]}:${point[1]}` }); assert.equal(controller(root).status, 0); const got = roles(root)
    assert.deepEqual(got, baseline, `${point.join('#')}: executions by role ${JSON.stringify(got)} vs uncrashed ${JSON.stringify(baseline)}`)
  }
})