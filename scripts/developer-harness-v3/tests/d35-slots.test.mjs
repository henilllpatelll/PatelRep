// D3.5-A — durable multi-slot execution: additive schema V3 (V1/V2 byte-for-byte), migration from both earlier versions (including a REAL process kill inside the
// migration transaction), per-slot and per-task exclusivity under REAL multi-process races, reservations bound to their slot, fencing, stale/unverified leases and
// per-task workspace isolation. Everything here uses real temporary SQLite files; nothing touches a model, VM or network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { LEDGER_APPLICATION_ID, MIGRATIONS, SCHEMA_VERSION } from '../orchestrator/ledger/schema.mjs'
import { acquireWork, assignWorkspace, checkWork, closeWork, liveWork, supersedeWork, workspaceOf } from '../orchestrator/ledger/slots.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'dh35-slots-'))
const BASE = '5ced4d309cf3532a490a48dbd06c575994822eac'
const CHILD_ENV = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_NO_WARNINGS: '1' }
const task = (n, over = {}) => ({ repository: 'henilllpatelll/PatelRep', base_sha: BASE, requirements: { text: `task ${n}` }, scope: { allowed_paths: [`apps/mobile/f${n}/**`] }, acceptance: { criteria: ['c'] }, risk_class: 'routine', ...over })
const submit = (L, n, over) => { const r = L.submitTask(task(n, over)); assert.ok(r.ok, JSON.stringify(r)); return r.task.task_id }
const lease = (L, id) => L.acquireLease({ taskId: id, role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'high' })
const sha = (s) => createHash('sha256').update(s).digest('hex')
const run = (args) => new Promise((res) => { const p = spawn(process.execPath, args, { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d }); p.on('exit', (code, signal) => res({ out, err, code, signal })) })

/** A raw ledger at an EARLIER schema version, built from the frozen migration SQL exactly as an older release would have. */
function legacyLedger(file, version) {
  const db = new DatabaseSync(file)
  for (const m of MIGRATIONS.filter((x) => x.version <= version)) db.exec(m.sql)
  db.exec(`PRAGMA application_id = ${LEDGER_APPLICATION_ID}; PRAGMA user_version = ${version}`)
  db.exec("INSERT INTO meta(key,value) VALUES ('ledger_id','legacy-ledger')")
  return db
}

test('schema: V1, V2 and (since D3.6) V3 are byte-for-byte the released SQL; V3 and V4 are additive (V4 drops only the outbox it rebuilds to widen a CHECK); the version is 4', () => {
  assert.equal(SCHEMA_VERSION, 4) // D3.6: V4 added (intentional expectation change, doc 40)
  assert.deepEqual(MIGRATIONS.map((m) => m.version), [1, 2, 3, 4])
  assert.equal(sha(MIGRATIONS[2].sql), '6cb67c397e7ca6b321d954d9afe38ff74f5c2c754fa3fe7b15d0f47804932fd5', 'V3 must never change (released in D3.5)')
  assert.deepEqual([...MIGRATIONS[3].sql.matchAll(/DROP\s+(TABLE|INDEX|TRIGGER)\s+(\w+)/gi)].map((m) => m[2]), ['outbox'], 'V4 drops nothing but the outbox it rebuilds (rows kept)')
  assert.equal(sha(MIGRATIONS[0].sql), '071f80d1e563756cb80642463e4d62f955bb00966ae2cf3b7d73a3dfe2370ea8', 'V1 must never change')
  assert.equal(sha(MIGRATIONS[1].sql), '7c4c0e4d9572ce04658d55d106ebf82628538835b0824d857510682e724a42e6', 'V2 must never change')
  for (const forbidden of [/DROP\s+INDEX/i, /DROP\s+TABLE/i, /DROP\s+TRIGGER/i]) assert.doesNotMatch(MIGRATIONS[2].sql, forbidden, 'V3 removes nothing')
  assert.match(MIGRATIONS[0].sql, /CREATE UNIQUE INDEX one_reasoning_slot ON leases\(reasoning_slot\)/, 'the single-slot index is NOT deleted: it now means one live lease per slot')
})

for (const from of [1, 2]) {
  test(`migration: a V${from} ledger with live data migrates to V3 in one transaction; tasks, leases, evidence nonces and ids are preserved`, () => {
    const dir = tmp(); const file = path.join(dir, 'l.sqlite')
    const db = legacyLedger(file, from)
    db.exec(`INSERT INTO tasks(task_id,submit_key,repository,base_sha,requirements_json,requirements_digest,scope_json,acceptance_json,risk_class,lifecycle_json,state,state_revision,fencing_token,created_at,updated_at)
      VALUES ('t-old','k','henilllpatelll/PatelRep','${BASE}','{}','d','{}','{}','routine','{"task_id":"t-old","state":"implementing"}','implementing',3,2,1,1)`)
    db.exec("INSERT INTO executions(execution_id,task_id,role,stage,context_id,ordinal,model_requested,effort_requested,status,fencing_token,started_at) VALUES ('x-old','t-old','implementer','implementing','ctx-old',1,'sonnet','high','running',2,1)")
    db.exec("INSERT INTO leases(lease_id,task_id,execution_id,fencing_token,state,issued_at,expires_at) VALUES ('l-old','t-old','x-old',2,'active',1,999999999999)")
    db.exec("INSERT INTO evidence_nonces(nonce,payload_digest,seen_at) VALUES ('nonce-old','pd',1)")
    db.close()
    const L = Ledger.open(file, { clock: () => 5 })
    assert.equal(L.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION) // D3.6: migrates through V3 to the latest
    assert.equal(L.meta('ledger_id'), 'legacy-ledger', 'the ledger identity survives migration')
    assert.equal(L.getTask('t-old').fencing_token, 2)
    assert.equal(L.slotHolder().lease_id, 'l-old'); assert.equal(L.slotHolder().reasoning_slot, 1, 'a pre-V3 lease occupies slot 1')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM evidence_nonces WHERE nonce='nonce-old'").get().c, 1)
    assert.deepEqual(L.db.prepare('SELECT kind, capacity FROM slot_config ORDER BY kind').all().map((r) => ({ ...r })), [{ kind: 'heavy_test', capacity: 1 }, { kind: 'reasoning', capacity: 1 }], 'the operational default stays ONE reasoning slot')
    assert.equal(lease(L, submit(L, 1)).code, 'LEASE.SLOT_BUSY', 'the migrated live lease still holds the (single) slot')
    L.close()
  })
}

test('migration: a fault INSIDE the V3 transaction leaves the ledger at V2, intact, and a later open migrates cleanly', () => {
  const dir = tmp(); const file = path.join(dir, 'l.sqlite')
  legacyLedger(file, 2).close()
  assert.throws(() => Ledger.open(file, { migrationHook: (v) => { if (v === 3) throw new Error('INJECTED_FAULT') } }), /INJECTED_FAULT/)
  const raw = new DatabaseSync(file, { readOnly: true })
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 2)
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name IN ('slot_config','work_leases','authority_log')").get().c, 0, 'no partial V3 object survives')
  raw.close()
  const L = Ledger.open(file); assert.equal(L.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION); L.close()
})

test('migration: a REAL process killed (SIGKILL) inside the V3 migration transaction leaves V2; the next open migrates to V3', async () => {
  const dir = tmp(); const file = path.join(dir, 'l.sqlite')
  const db = legacyLedger(file, 2); db.exec("INSERT INTO evidence_nonces(nonce,payload_digest,seen_at) VALUES ('n1','pd',1)"); db.close()
  const r = await run([path.join(HERE, 'd35-slot-race-worker.mjs'), 'kill-migration', file, '3'])
  assert.match(r.out, /KILLING/); assert.doesNotMatch(r.out, /NOT_KILLED/); assert.notEqual(r.code, 0, 'the process really died mid-transaction')
  const raw = new DatabaseSync(file, { readOnly: true }); assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 2); raw.close()
  const L = Ledger.open(file)
  assert.equal(L.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
  assert.equal(L.db.prepare("SELECT COUNT(*) c FROM evidence_nonces WHERE nonce='n1'").get().c, 1, 'consumed-nonce history preserved')
  L.close()
})

test('migration: unknown (newer) schema versions and foreign databases are refused, never downgraded', () => {
  const dir = tmp()
  const newer = path.join(dir, 'newer.sqlite'); const n = new DatabaseSync(newer); n.exec(`PRAGMA application_id=${LEDGER_APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION + 1}`); n.close()
  assert.throws(() => Ledger.open(newer), /SCHEMA_TOO_NEW/)
  const foreign = path.join(dir, 'foreign.sqlite'); const f = new DatabaseSync(foreign); f.exec('PRAGMA application_id=7; PRAGMA user_version=2'); f.close()
  assert.throws(() => Ledger.open(foreign), /FOREIGN_DATABASE/)
})

test('slots: capacity N admits N tasks, each in its own slot; the task already holding a lease is refused a second one; the default capacity 1 keeps the D3.4 codes', () => {
  const L = Ledger.open(':memory:', { clock: () => 1000 })
  const ids = [1, 2, 3, 4].map((n) => submit(L, n))
  const a = lease(L, ids[0]); assert.ok(a.ok); assert.equal(a.lease.slot, 1)
  assert.equal(lease(L, ids[1]).code, 'LEASE.SLOT_BUSY', 'capacity 1: the D3.4 single slot')
  assert.equal(lease(L, ids[0]).code, 'LEASE.SLOT_BUSY', 'capacity 1: same code as D3.4 for the holder itself')
  L.setSlotCapacity('reasoning', 3, 'test')
  const b = lease(L, ids[1]); const c = lease(L, ids[2]); assert.deepEqual([b.lease.slot, c.lease.slot], [2, 3])
  assert.equal(lease(L, ids[3]).code, 'LEASE.SLOT_BUSY')
  assert.ok(L.closeLease(b.lease, { terminationVerified: true, endReason: 'completed' }).released)
  assert.equal(lease(L, ids[0]).code, 'LEASE.TASK_ALREADY_LEASED', 'a free slot is never a second lease for a task that holds one')
  const d = lease(L, ids[3]); assert.equal(d.lease.slot, 2, 'the freed slot is reused only after a VERIFIED release')
  assert.deepEqual(L.activeCounts(), { reasoning_sessions: 3, heavy_test_workloads: 0 })
  assert.throws(() => L.setSlotCapacity('reasoning', 1, 'shrink'), /SLOT_IN_USE/, 'capacity cannot shrink under live leases')
  // the database itself enforces it, whatever a buggy caller does
  assert.throws(() => L.db.prepare("INSERT INTO leases(lease_id,task_id,execution_id,fencing_token,state,reasoning_slot,issued_at,expires_at) VALUES ('l-x',?,(SELECT execution_id FROM executions LIMIT 1),1,'active',2,1,2)").run(ids[2]), /UNIQUE|SLOT/)
  assert.throws(() => L.db.prepare("INSERT INTO leases(lease_id,task_id,execution_id,fencing_token,state,reasoning_slot,issued_at,expires_at) VALUES ('l-y',?,(SELECT execution_id FROM executions LIMIT 1),1,'active',9,1,2)").run(ids[3]), /SLOT_OUT_OF_RANGE|UNIQUE/)
  L.close()
})

test('slots: an UNVERIFIED termination keeps its slot and its reservation; the slot is never reused until a verified supersession; a closed lease never reopens', () => {
  const L = Ledger.open(':memory:', { clock: () => 1000 })
  L.setSlotCapacity('reasoning', 2, 'test')
  const [t1, t2, t3] = [1, 2, 3].map((n) => submit(L, n))
  const a = L.acquireLease({ taskId: t1, role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'high', reservation: { mem_mb: 900 } })
  const b = lease(L, t2)
  assert.equal(L.pendingReservations().length, 1); assert.equal(L.pendingReservations()[0].mb, 900)
  L.closeLease(a.lease, { terminationVerified: false, endReason: 'x' })
  assert.equal(L.reservationOf(a.lease.lease_id).state, 'held', 'unverified stop: the memory stays reserved')
  assert.equal(lease(L, t3).code, 'LEASE.SLOT_HELD_TERMINATION_UNVERIFIED')
  assert.equal(L.supersedeLease({ guestCleanupVerified: true }).code, 'RECOVERY.LEASE_REQUIRED', 'with several live leases an unnamed supersession is refused (never guess whose)')
  assert.equal(L.supersedeLease({ guestCleanupVerified: false, leaseId: a.lease.lease_id }).code, 'RECOVERY.CLEANUP_UNVERIFIED')
  const s = L.supersedeLease({ guestCleanupVerified: true, leaseId: a.lease.lease_id })
  assert.ok(s.ok); assert.equal(s.task_id, t1); assert.equal(L.getTask(t1).fencing_token, 2, 'fencing advances for THAT task only'); assert.equal(L.getTask(t2).fencing_token, 1)
  assert.equal(L.reservationOf(a.lease.lease_id).state, 'released')
  assert.equal(L.checkLease(b.lease), null, 'the other task\'s lease is untouched by the recovery')
  assert.equal(L.checkLease(a.lease), 'LEASE.NOT_ACTIVE')
  assert.throws(() => L.db.prepare("UPDATE leases SET state='active' WHERE lease_id=?").run(a.lease.lease_id), /LEASE_CLOSED/)
  assert.throws(() => L.db.prepare('UPDATE leases SET fencing_token=99 WHERE lease_id=?').run(b.lease.lease_id), /IDENTITY_IMMUTABLE/)
  assert.throws(() => L.db.prepare('DELETE FROM leases').run(), /NO_DELETE/)
  assert.ok(lease(L, t3).ok)
  L.close()
})

test('fencing: a lease from before a recovery is stale for every action; reservations and slots cannot be taken over by another task', () => {
  const L = Ledger.open(':memory:', { clock: () => 1000 })
  const [t1, t2] = [1, 2].map((n) => submit(L, n))
  const a = L.acquireLease({ taskId: t1, role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'high', reservation: { mem_mb: 500 } })
  assert.throws(() => L.db.prepare("UPDATE reservations SET task_id=? WHERE holder_ref=?").run(t2, a.lease.lease_id), /RESERVATION_IMMUTABLE/)
  assert.throws(() => L.reserveFor(t2, a.lease.lease_id, 'reasoning', { mem_mb: 1 }), /UNIQUE/, 'a reservation belongs to exactly one holder')
  L.supersedeLease({ guestCleanupVerified: true })
  assert.equal(L.checkLease(a.lease), 'LEASE.NOT_ACTIVE')
  assert.equal(L.renewLease(a.lease).ok, false)
  const fresh = lease(L, t1); assert.ok(fresh.ok); assert.equal(fresh.lease.fencing_token, 2)
  assert.equal(L.checkLease({ ...fresh.lease, fencing_token: 1 }), 'LEASE.STALE_FENCING_TOKEN')
  assert.equal(L.checkLease({ ...fresh.lease, execution_id: a.lease.execution_id }), 'LEASE.STALE_IDENTITY')
  L.close()
})

test('work slots: heavy tests hold their own slot kind; per-task exclusivity, fencing, verified release, and orphan supersession only with a verified stop', () => {
  const L = Ledger.open(':memory:', { clock: () => 1000 })
  const [t1, t2] = [1, 2].map((n) => submit(L, n))
  const w1 = acquireWork(L, { taskId: t1, unitRef: 'testing:x', reservation: { mem_mb: 1536 } }); assert.ok(w1.ok); assert.equal(w1.work.slot_no, 1)
  assert.equal(acquireWork(L, { taskId: t2, unitRef: 'testing:y' }).code, 'WORK.SLOT_BUSY', 'max_heavy_test_workloads = 1')
  assert.ok(lease(L, t2).ok, 'a heavy test and a reasoning session are separate slot kinds')
  assert.deepEqual(L.activeCounts(), { reasoning_sessions: 1, heavy_test_workloads: 1 })
  assert.equal(checkWork(L, w1.work), null)
  L.setSlotCapacity('heavy_test', 2, 'test')
  assert.equal(acquireWork(L, { taskId: t1, unitRef: 'testing:x2' }).code, 'WORK.TASK_ALREADY_HOLDS')
  L.applyLifecycleEvent(t1, L.eventFor(t1, 'worker_recovered', { reason_code: 'HOST_RESTARTED', new_fencing_token: 2 }))
  assert.equal(checkWork(L, w1.work), 'WORK.STALE_FENCING_TOKEN', 'a test run from before a recovery cannot report under the new epoch')
  assert.equal(supersedeWork(L, { workId: w1.work.work_id, stopVerified: false }).code, 'RECOVERY.WORK_STOP_UNVERIFIED')
  assert.equal(liveWork(L).length, 1)
  assert.ok(supersedeWork(L, { workId: w1.work.work_id, stopVerified: true }).ok)
  assert.equal(L.reservationOf(w1.work.work_id).state, 'released')
  const w2 = acquireWork(L, { taskId: t1, unitRef: 'testing:z' }); assert.ok(closeWork(L, w2.work, { terminationVerified: false }).ok)
  assert.equal(liveWork(L)[0].state, 'termination_unverified')
  assert.throws(() => L.db.prepare("UPDATE work_leases SET state='active' WHERE work_id=?").run(w2.work.work_id), /LEASE_CLOSED/)
  L.close()
})

test('workspaces: one worktree, overlay, checkpoint and candidate namespace per task, derived from a digest (never from task text), never shared or reassigned', () => {
  const L = Ledger.open(':memory:', { clock: () => 1000 })
  const root = path.join(tmp(), 'dh3')
  const t1 = submit(L, 1); const t2 = submit(L, 2, { task_id: 'evil/../../../x' })
  assert.equal(assignWorkspace(L, t1, { root: 'relative/root' }).code, 'WORKSPACE.ROOT_INVALID')
  const a = assignWorkspace(L, t1, { root }).workspace; const b = assignWorkspace(L, t2, { root }).workspace
  for (const k of ['worktree_path', 'overlay_id', 'checkpoint_ns', 'candidate_ns']) assert.notEqual(a[k], b[k])
  assert.ok(b.worktree_path.startsWith(path.join(root, 'worktrees')), 'a hostile task id cannot steer the path'); assert.doesNotMatch(b.worktree_path, /evil|\.\./)
  assert.equal(assignWorkspace(L, t1, { root }).duplicate, true)
  assert.deepEqual(workspaceOf(L, t1), a)
  assert.throws(() => L.db.prepare('UPDATE task_workspaces SET worktree_path=? WHERE task_id=?').run(b.worktree_path, t1), /WORKSPACE_IMMUTABLE/)
  assert.throws(() => L.db.prepare('INSERT INTO task_workspaces VALUES (?,?,?,?,?,?)').run(submit(L, 3), a.worktree_path, 'o', 'c', 'n', 1), /UNIQUE/)
  L.close()
})

async function race(mode, file, taskIds) {
  const go = path.join(path.dirname(file), `go-${mode}-${Date.now()}`)
  const procs = taskIds.map((id, i) => run([path.join(HERE, 'd35-slot-race-worker.mjs'), mode, file, id, `p${i}`, go]))
  await new Promise((r) => setTimeout(r, 1500)); writeFileSync(go, 'go')
  return (await Promise.all(procs)).map((p) => JSON.parse(p.out))
}

test('REAL multi-process race: 6 OS processes race for 3 reasoning slots (distinct tasks) — exactly 3 win, in distinct slots', async () => {
  const dir = tmp(); const file = path.join(dir, 'l.sqlite')
  const L = Ledger.open(file); L.setSlotCapacity('reasoning', 3, 'race test'); const ids = [1, 2, 3, 4, 5, 6].map((n) => submit(L, n)); L.close()
  const res = await race('lease', file, ids)
  const wins = res.filter((r) => r.ok)
  assert.equal(wins.length, 3, JSON.stringify(res)); assert.deepEqual(wins.map((w) => w.slot).sort(), [1, 2, 3])
  assert.ok(res.filter((r) => !r.ok).every((r) => r.code === 'LEASE.SLOT_BUSY'), JSON.stringify(res))
  const V = Ledger.open(file); assert.equal(V.liveLeases().length, 3); assert.equal(new Set(V.liveLeases().map((l) => l.task_id)).size, 3); V.close()
})

test('REAL multi-process race: 5 OS processes race for the SAME task with free slots — exactly one execution wins (no duplicate reasoning execution)', async () => {
  const dir = tmp(); const file = path.join(dir, 'l.sqlite')
  const L = Ledger.open(file); L.setSlotCapacity('reasoning', 4, 'race test'); const id = submit(L, 1); L.close()
  const res = await race('lease', file, [id, id, id, id, id])
  assert.equal(res.filter((r) => r.ok).length, 1, JSON.stringify(res))
  assert.ok(res.filter((r) => !r.ok).every((r) => r.code === 'LEASE.TASK_ALREADY_LEASED'), JSON.stringify(res))
  const V = Ledger.open(file); assert.equal(V.db.prepare('SELECT COUNT(*) c FROM executions').get().c, 1, 'losers leave no execution record'); V.close()
})

test('REAL multi-process race: heavy-test work slots — 4 processes, capacity 1, exactly one holder', async () => {
  const dir = tmp(); const file = path.join(dir, 'l.sqlite')
  const L = Ledger.open(file); const ids = [1, 2, 3, 4].map((n) => submit(L, n)); L.close()
  const res = await race('work', file, ids)
  assert.equal(res.filter((r) => r.ok).length, 1, JSON.stringify(res))
})
