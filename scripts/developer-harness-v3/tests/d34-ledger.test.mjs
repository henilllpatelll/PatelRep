// D3.4 durable ledger: real temporary SQLite databases (no mocks). Persistence, immutability, idempotency, CAS, leases/fencing, recovery, backup, rollback.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { backupLedger, prepareRestore, verifyLedgerFile } from '../orchestrator/ledger/backup.mjs'
import { SCHEMA_VERSION } from '../orchestrator/ledger/schema.mjs'

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'dh34-ledger-'))
const REPO = 'henilllpatelll/PatelRep'; const BASE = 'a'.repeat(40)
const TASK = (over = {}) => ({ repository: REPO, base_sha: BASE, requirements: { text: 'original requirement text' }, scope: { allowed_paths: ['apps/mobile/**'] }, acceptance: { criteria: ['c1'], production_required: true }, risk_class: 'routine', ...over })
const open = (dir, over = {}) => { let t = 1_000_000; const clock = () => (t += 1); const L = Ledger.open(path.join(dir, 'l.sqlite'), { clock, ...over }); L.tick = (ms) => { t += ms }; return L }
const go = (L, id, ...states) => { for (const s of states) { const r = L.transition(id, s); assert.ok(r.ok, `${s}: ${r.problems}`) } }

test('persistence: state survives close/reopen and the schema version is recorded', () => {
  const dir = tmp(); let L = open(dir)
  const { task } = L.submitTask(TASK()); go(L, task.task_id, 'queued', 'planning')
  L.close(); L = open(dir)
  const t = L.getTask(task.task_id)
  assert.equal(t.state, 'planning'); assert.equal(t.state_revision, 2)
  assert.equal(L.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
  assert.equal(L.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal'); assert.equal(L.db.prepare('PRAGMA synchronous').get().synchronous, 2, 'FULL')
  L.close(); rmSync(dir, { recursive: true, force: true })
})

test('duplicate submissions are one task; the identical task with another id is refused; requirements are immutable and digest-bound', () => {
  const dir = tmp(); const L = open(dir)
  const a = L.submitTask(TASK()); const b = L.submitTask(TASK())
  assert.ok(a.ok && b.ok && b.duplicate === true && a.task.task_id === b.task.task_id)
  assert.equal(L.submitTask(TASK({ task_id: 'other-id' })).problems[0], 'TASK.SUBMIT_KEY_CONFLICT')
  assert.equal(L.submitTask(TASK({ requirements: { text: 'different' } })).task.task_id === a.task.task_id, false)
  assert.equal(L.submitTask({ ...TASK(), extra: 1 }).problems[0], 'TASK.MALFORMED')
  assert.equal(L.submitTask(TASK({ base_sha: 'zz' })).ok, false)
  for (const sql of ["UPDATE tasks SET requirements_json='{}'", "UPDATE tasks SET scope_json='{}'", "UPDATE tasks SET base_sha='" + 'b'.repeat(40) + "'", 'DELETE FROM tasks']) assert.throws(() => L.db.exec(sql), /LEDGER\.(TASK_IDENTITY_IMMUTABLE|NO_DELETE)/, sql)
  assert.ok(L.requirementsIntact(a.task.task_id))
  // tampering with the stored text behind the trigger (a corrupted/forged file) is detected by the digest
  L.db.exec('DROP TRIGGER tasks_requirements_immutable'); L.db.exec("UPDATE tasks SET requirements_json='{\"text\":\"forged\"}'")
  assert.equal(L.requirementsIntact(a.task.task_id), false)
  L.close()
})

test('event log is append-only; lifecycle semantics are the D3.2 reducer: illegal transitions, stale revisions, stale tokens and idempotency conflicts are rejected', () => {
  const dir = tmp(); const L = open(dir); const { task } = L.submitTask(TASK()); const id = task.task_id
  assert.equal(L.transition(id, 'implementing').problems[0], 'TRANSITION.ILLEGAL')
  const ev = L.eventFor(id, 'transition', { to: 'queued', idempotency_id: 'idem-1' })
  assert.ok(L.applyLifecycleEvent(id, ev).ok)
  const dup = L.applyLifecycleEvent(id, ev); assert.ok(dup.ok && dup.duplicate, 'byte-identical replay is a no-op')
  assert.equal(L.getTask(id).state_revision, 1)
  assert.equal(L.applyLifecycleEvent(id, { ...ev, to: 'planning' }).problems[0], 'EVENT.IDEMPOTENCY_CONFLICT')
  assert.equal(L.applyLifecycleEvent(id, { ...L.eventFor(id, 'transition', { to: 'planning' }), expected_revision: 0 }).problems[0], 'EVENT.STALE_REVISION')
  assert.equal(L.applyLifecycleEvent(id, { ...L.eventFor(id, 'transition', { to: 'planning' }), fencing_token: 2 }).problems[0], 'EVENT.STALE_FENCING_TOKEN')
  assert.equal(L.applyLifecycleEvent('nope', ev).problems[0], 'TASK.UNKNOWN')
  assert.equal(L.db.prepare('SELECT COUNT(*) c FROM task_events WHERE task_id=?').get(id).c, 1, 'only accepted events are logged')
  assert.throws(() => L.db.exec('UPDATE task_events SET to_state=\'completed\''), /LEDGER\.APPEND_ONLY/)
  assert.throws(() => L.db.exec('DELETE FROM task_events'), /LEDGER\.APPEND_ONLY/)
  // a replay older than the reducer's memory window is still caught by the database (UNIQUE task_id, idempotency_id)
  const t = JSON.parse(L.db.prepare('SELECT lifecycle_json FROM tasks WHERE task_id=?').get(id).lifecycle_json); t.idempotency = []
  L.db.prepare('UPDATE tasks SET lifecycle_json=? WHERE task_id=?').run(JSON.stringify(t), id)
  assert.ok(L.applyLifecycleEvent(id, ev).duplicate, 'DB memory catches what the reducer window forgot')
  assert.equal(L.applyLifecycleEvent(id, { ...ev, to: 'planning' }).problems[0], 'EVENT.IDEMPOTENCY_CONFLICT')
  L.close()
})

test('atomicity: a failure inside a transaction rolls back EVERYTHING (event, projection, candidate); the database CAS refuses a concurrent writer', () => {
  const dir = tmp(); const L = open(dir); const { task } = L.submitTask(TASK()); const id = task.task_id; go(L, id, 'queued', 'planning', 'implementing')
  const before = L.getTask(id)
  assert.throws(() => L.tx(() => { L.submitCandidate(id, { base_sha: BASE, candidate_sha: 'c'.repeat(40), tree_digest: 'd'.repeat(40), patch_digest: 'e'.repeat(64) }); throw new Error('boom') }), /boom/)
  const after = L.getTask(id)
  assert.equal(after.state_revision, before.state_revision); assert.equal(after.head_sha, null)
  assert.equal(L.db.prepare('SELECT COUNT(*) c FROM candidates').get().c, 0); assert.equal(L.db.prepare('SELECT COUNT(*) c FROM task_events WHERE task_id=?').get(id).c, before.state_revision)
  // two controllers (two connections) racing on the same revision: exactly one wins
  const L2 = Ledger.open(path.join(dir, 'l.sqlite'))
  const e1 = L.eventFor(id, 'transition', { to: 'testing', idempotency_id: 'race-a' }); const e2 = { ...e1, event_id: 'e-b', idempotency_id: 'race-b' }
  const r1 = L.applyLifecycleEvent(id, e1); const r2 = L2.applyLifecycleEvent(id, e2)
  assert.equal([r1.ok, r2.ok].filter(Boolean).length, 1); assert.ok(r2.problems.includes('EVENT.STALE_REVISION') || r2.problems.includes('TRANSITION.ILLEGAL'))
  L2.close(); L.close()
})

test('candidate submission is atomic with head_changed; a changed head returns the task to testing and invalidates review/test evidence and open reviews', () => {
  const dir = tmp(); const L = open(dir); const { task } = L.submitTask(TASK()); const id = task.task_id
  go(L, id, 'queued', 'planning', 'implementing')
  const c1 = { base_sha: BASE, candidate_sha: '1'.repeat(40), tree_digest: '2'.repeat(40), patch_digest: '3'.repeat(64) }
  assert.ok(L.submitCandidate(id, c1).ok); go(L, id, 'testing', 'independent_review')
  const now = L.now()
  L.db.prepare('INSERT INTO evidence(evidence_id,task_id,evidence_type,issuer_identity,nonce,idempotency_id,payload_digest,envelope_json,candidate_sha,tree_digest,policy_revision,fencing_token,expires_at,accepted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ev-x', id, 'test_results', 'orchestrator', 'n-x', 'i-x', 'f'.repeat(64), '{}', c1.candidate_sha, c1.tree_digest, '9'.repeat(64), 1, now + 1e6, now)
  const c2 = { ...c1, candidate_sha: '4'.repeat(40), tree_digest: '5'.repeat(40) }
  const r = L.submitCandidate(id, c2)
  assert.ok(r.ok); assert.equal(L.getTask(id).state, 'testing'); assert.ok(r.invalidated.includes('independent_review'))
  assert.notEqual(L.db.prepare("SELECT invalidated_at FROM evidence WHERE evidence_id='ev-x'").get().invalidated_at, null)
  assert.equal(L.currentCandidate(id).candidate_sha, c2.candidate_sha); assert.equal(L.db.prepare('SELECT COUNT(*) c FROM candidates WHERE superseded=0').get().c, 1)
  assert.equal(L.submitCandidate(id, { ...c1, base_sha: 'f'.repeat(40) }).problems[0], 'CANDIDATE.WRONG_BASE')
  assert.equal(L.submitCandidate(id, { ...c1, tree_digest: 'zz' }).problems[0], 'CANDIDATE.MALFORMED')
  L.close()
})

test('one reasoning slot across ALL tasks; a lease whose session is not proven dead keeps the slot; fencing advances exactly once per recovery; stale leases are rejected', () => {
  const dir = tmp(); const L = open(dir)
  const a = L.submitTask(TASK()).task.task_id; const b = L.submitTask(TASK({ requirements: { text: 'second' } })).task.task_id
  const acq = (id) => L.acquireLease({ taskId: id, role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'medium', ttlMs: 60_000 })
  const l1 = acq(a); assert.ok(l1.ok)
  assert.equal(acq(b).code, 'LEASE.SLOT_BUSY', 'a different task cannot start a session either')
  assert.equal(L.checkLease(l1.lease), null)
  assert.equal(L.checkLease({ ...l1.lease, execution_id: 'x-other' }), 'LEASE.STALE_IDENTITY'); assert.equal(L.checkLease({ ...l1.lease, fencing_token: 9 }), 'LEASE.STALE_FENCING_TOKEN'); assert.equal(L.checkLease({ lease_id: 'nope' }), 'LEASE.NONE')
  L.tick(61_000); assert.equal(L.checkLease(l1.lease), 'LEASE.EXPIRED'); assert.equal(L.renewLease(l1.lease).code, 'LEASE.EXPIRED')
  // an unverified stop keeps the slot
  assert.deepEqual(L.closeLease(l1.lease, { terminationVerified: false, endReason: 'test' }), { ok: true, released: false })
  assert.equal(acq(b).code, 'LEASE.SLOT_HELD_TERMINATION_UNVERIFIED')
  assert.equal(L.supersedeLease({ guestCleanupVerified: false }).code, 'RECOVERY.CLEANUP_UNVERIFIED'); assert.equal(L.getTask(a).fencing_token, 1, 'unverified cleanup changes nothing')
  assert.equal(L.slotHolder().state, 'termination_unverified')
  const rec = L.supersedeLease({ guestCleanupVerified: true }); assert.ok(rec.ok); assert.equal(rec.new_fencing_token, 2); assert.equal(L.getTask(a).fencing_token, 2)
  const l2 = acq(b); assert.ok(l2.ok); assert.equal(l2.lease.fencing_token, 1, 'a different task has its own token')
  assert.equal(L.checkLease(l1.lease), 'LEASE.NOT_ACTIVE', 'the superseded lease can never act again')
  // verified close releases the slot
  assert.ok(L.closeLease(l2.lease, { terminationVerified: true, endReason: 'completed' }).released); assert.equal(L.slotHolder(), null)
  assert.equal(L.getExecution(l2.lease.execution_id).status, 'terminated_verified')
  // a stale token after recovery: the fenced-off controller's events are refused by the reducer
  assert.equal(L.applyLifecycleEvent(a, { ...L.eventFor(a, 'transition', { to: 'queued' }), fencing_token: 1 }).problems[0], 'EVENT.STALE_FENCING_TOKEN')
  L.close()
})

test('the database itself enforces the single reasoning slot (not just the code path)', () => {
  const dir = tmp(); const L = open(dir); const a = L.submitTask(TASK()).task.task_id
  assert.ok(L.acquireLease({ taskId: a, role: 'planner', stage: 'planning', model: 'sonnet', effort: 'medium' }).ok)
  const ex = L.db.prepare('SELECT execution_id FROM executions').get().execution_id
  assert.throws(() => L.db.prepare("INSERT INTO leases(lease_id,task_id,execution_id,fencing_token,state,issued_at,expires_at) VALUES ('l-2',?,?,1,'active',1,2)").run(a, ex), /UNIQUE/)
  L.close()
})

test('pause / resume / cancel and dependencies: cancel is terminal for scheduling and cannot be resumed; cycles and unknown tasks are refused', () => {
  const dir = tmp(); const L = open(dir)
  const a = L.submitTask(TASK()).task.task_id; const b = L.submitTask(TASK({ requirements: { text: 'b' } })).task.task_id; const c = L.submitTask(TASK({ requirements: { text: 'c' } })).task.task_id
  go(L, a, 'queued', 'planning'); assert.ok(L.pause(a).ok); assert.equal(L.getTask(a).state, 'paused'); assert.ok(L.resume(a).ok); assert.equal(L.getTask(a).state, 'planning')
  assert.ok(L.cancel(a).ok); assert.equal(L.getTask(a).cancelled, 1); assert.equal(L.resume(a).problems[0], 'TASK.CANCELLED')
  assert.equal(L.acquireLease({ taskId: a, role: 'planner', stage: 'planning', model: 'sonnet', effort: 'medium' }).code, 'TASK.CANCELLED')
  assert.ok(L.addDependency(b, c).ok); assert.equal(L.addDependency(c, b).code, 'DEPENDENCY.CYCLE'); assert.equal(L.addDependency(b, b).code, 'DEPENDENCY.SELF'); assert.equal(L.addDependency(b, 'ghost').code, 'DEPENDENCY.UNKNOWN_TASK')
  assert.deepEqual(L.openDependencies(b), [c]); assert.deepEqual(L.deadDependencies(b), [])
  L.db.prepare('UPDATE tasks SET handoff_ready=1 WHERE task_id=?').run(c); assert.deepEqual(L.openDependencies(b), [])
  L.close()
})

test('checkpoints, plans and waits persist; retry budgets and the outbox are durable', async () => {
  const dir = tmp(); let L = open(dir); const id = L.submitTask(TASK()).task.task_id
  const v = L.savePlan(id, { steps: [{ id: 's1', title: 'one' }, { id: 's2', title: 'two', depends_on: ['s1'] }] }); assert.equal(v, 1)
  L.setStepStatus(id, 1, 's1', 'done'); assert.deepEqual(L.remainingSteps(id).map((s) => s.id), ['s2'])
  const cp = L.recordCheckpoint(id, { reason: 'x', payload: { a: 1 } }); assert.equal(L.getCheckpoint(cp).verified, 0); assert.equal(L.latestCheckpoint(id), null); L.markCheckpointVerified(cp); assert.equal(L.latestCheckpoint(id).payload.a, 1)
  L.setWait(id, { kind: 'waiting_resources', reason: 'MEMORY_PRESSURE', eligibleAt: 5 })
  const { recordFailure, retryEligible, enqueueOutbox, claimOutbox, ackOutbox, requeueClaimedOutbox } = await import('../orchestrator/ledger/intents.mjs')
  const f1 = recordFailure(L, { taskId: id, stage: 'testing', fingerprint: 'fp', rng: () => 0 }); assert.equal(f1.attempts, 1); assert.equal(f1.repeated_identical, false); assert.equal(retryEligible(L, id, 'testing'), false)
  L.tick(31_000); assert.equal(retryEligible(L, id, 'testing'), true)
  const f2 = recordFailure(L, { taskId: id, stage: 'testing', fingerprint: 'fp', rng: () => 0 }); assert.ok(f2.repeated_identical); assert.ok(f2.next_eligible_at - L.now() >= 59_000, 'exponential backoff')
  const f3 = recordFailure(L, { taskId: id, stage: 'testing', fingerprint: 'fp', rng: () => 0 }); assert.ok(f3.exhausted)
  assert.ok(enqueueOutbox(L, { taskId: id, kind: 'handoff_ready', dedupeKey: 'k1', payload: { a: 1 } })); assert.equal(enqueueOutbox(L, { taskId: id, kind: 'handoff_ready', dedupeKey: 'k1', payload: { a: 2 } }), false, 'deduplicated')
  const [row] = claimOutbox(L); assert.equal(claimOutbox(L).length, 0); L.close(); L = open(dir)
  assert.equal(requeueClaimedOutbox(L), 1, 'a crash between send and ack re-queues (at-least-once)'); assert.equal(L.getWait(id).reason, 'MEMORY_PRESSURE')
  L.tick(100_000) // the reopened ledger's fixture clock restarts at its origin
  const [again] = claimOutbox(L); assert.equal(again.outbox_id, row.outbox_id); ackOutbox(L, again.outbox_id); assert.equal(claimOutbox(L).length, 0); L.close()
})

test('backup uses VACUUM INTO, verifies, writes a digest, never overwrites; restore only produces a verified candidate file; corruption and foreign databases are refused', () => {
  const dir = tmp(); const L = open(dir); L.submitTask(TASK())
  const dest = path.join(dir, 'b.sqlite'); const r = backupLedger(L, dest); assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.tasks, 1); assert.ok(existsSync(`${dest}.sha256`))
  assert.equal(backupLedger(L, dest).code, 'BACKUP.DESTINATION_EXISTS')
  const cand = path.join(dir, 'restore.sqlite'); assert.ok(prepareRestore(dest, cand).ok); assert.equal(verifyLedgerFile(cand).tasks, 1)
  assert.equal(prepareRestore(dest, cand).code, 'RESTORE.DESTINATION_EXISTS')
  writeFileSync(dest, Buffer.concat([Buffer.from(require_bytes(dest)), Buffer.from('x')])); assert.equal(prepareRestore(dest, path.join(dir, 'r2.sqlite')).code, 'RESTORE.DIGEST_MISMATCH')
  const foreign = path.join(dir, 'foreign.sqlite'); const f = new DatabaseSync(foreign); f.exec('CREATE TABLE t(x)'); f.close()
  assert.equal(verifyLedgerFile(foreign).ok, false); assert.throws(() => Ledger.openReadOnly(foreign), /NOT_A_LEDGER/)
  const newer = path.join(dir, 'newer.sqlite'); const n = new DatabaseSync(newer); n.exec(`PRAGMA application_id=${0x44483334}; PRAGMA user_version=${SCHEMA_VERSION + 1}`); n.close()
  assert.throws(() => Ledger.open(newer), /SCHEMA_TOO_NEW/)
  writeFileSync(path.join(dir, 'junk.sqlite'), 'this is not a database'); assert.throws(() => Ledger.open(path.join(dir, 'junk.sqlite')))
  assert.throws(() => Ledger.open(path.join(dir, 'l.sqlite'), { maxBytes: 10 }), /LEDGER\.TOO_LARGE/)
  L.close()
})
import { readFileSync } from 'node:fs'
const require_bytes = (f) => readFileSync(f)

test('read-only ledger handles (issuers) cannot write', () => {
  const dir = tmp(); const L = open(dir); const id = L.submitTask(TASK()).task.task_id
  const ro = Ledger.openReadOnly(path.join(dir, 'l.sqlite')); assert.equal(ro.getTask(id).task_id, id)
  assert.throws(() => ro.db.exec("UPDATE tasks SET priority=1"), /readonly|read-only|attempt to write/i)
  ro.close(); L.close()
})
