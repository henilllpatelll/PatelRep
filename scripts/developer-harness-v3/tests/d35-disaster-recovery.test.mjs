// D3.5-F — ledger backup, integrity and disaster recovery on REAL SQLite files: manifest-committed backups, partial publication, retention, storage admission, corrupt and
// stale backups, missing manifests, the freshness witness (untrusted by default), controller exclusion, a journaled swap interrupted at every step, post-restore sealing, and
// REPLAY prevention (evidence, nonces, intents/effects, fencing) after a restore. The "trusted" witness used here is explicitly SIMULATED.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { acquireLock } from '../lib/atomic.mjs'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { acceptEvidence, satisfyingEvidence } from '../orchestrator/ledger/evidence-store.mjs'
import { markDispatched } from '../orchestrator/ledger/intents.mjs'
import { applyRetention, authoritySeq, checkNotRolledBack, createBackup, fileWitness, freshnessDecision, listBackups, recoverLedger, verifyBackup } from '../orchestrator/ledger/disaster-recovery.mjs'
import { H, drive, tmp } from './d34-rem-helpers.mjs'

const BIG = () => 1_000_000
async function world() {
  const h = H(); const id = h.submit(); await drive(h) // a task driven to its handoff: real accepted (and consumed) evidence exists
  return { h, L: h.ledger, id, dirs: { backups: path.join(h.dirs.root, 'backups'), cand: path.join(h.dirs.root, 'candidates'), q: path.join(h.dirs.root, 'quarantine'), lock: path.join(h.dirs.root, 'controller.lock'), witness: path.join(h.dirs.root, 'witness.json') } }
}
const addIntent = (L, id, key) => L.db.prepare("INSERT INTO action_intents(intent_id,task_id,action,idempotency_key,params_digest,candidate_sha,policy_revision,fencing_token,evidence_ids_json,status,created_at,updated_at) VALUES (?,?,?,?,?,NULL,?,?,'[]','intended',?,?)").run(`int-${key}`, id, 'publish_candidate_branch', key, 'p'.repeat(64), 'r'.repeat(64), L.getTask(id).fencing_token, L.now(), L.now())
const notAlive = () => false

test('backups: consistent copy + atomic manifest (the commit point); a data file without a manifest is a partial publication, ignored and collected; retention; storage admission', async () => {
  const { h, L, dirs } = await world()
  try {
    const b1 = createBackup(L, dirs.backups, { freeMb: BIG }); assert.ok(b1.ok, JSON.stringify(b1))
    assert.equal(b1.manifest.authority_seq, authoritySeq(L)); assert.equal(b1.manifest.ledger_id, L.meta('ledger_id'))
    assert.ok(verifyBackup(dirs.backups, b1.manifest).ok)
    assert.equal(createBackup(L, dirs.backups, { freeMb: BIG, hook: (n) => { if (n === 'after_backup_data_published') throw new Error('CRASH_BEFORE_MANIFEST') } }).code, 'BACKUP.FAILED', 'a failure between data and manifest publishes NO backup')
    const l1 = listBackups(dirs.backups); assert.equal(l1.manifests.length, 1); assert.equal(l1.orphans.length, 1, 'the uncommitted data file is an orphan, never a backup')
    for (let i = 0; i < 6; i += 1) { L.cancel(h.submit({ requirements: { text: `filler ${i}` } })); assert.ok(createBackup(L, dirs.backups, { freeMb: BIG, retain: 3 }).ok) }
    const l2 = listBackups(dirs.backups); assert.equal(l2.manifests.length, 3); assert.equal(l2.orphans.length, 0, 'the partial publication was collected')
    assert.ok(l2.manifests[0].authority_seq > l2.manifests[2].authority_seq, 'newest authority first')
    assert.equal(createBackup(L, dirs.backups, { freeMb: () => 100 }).code, 'BACKUP.STORAGE_INSUFFICIENT')
    assert.deepEqual(applyRetention(dirs.backups, { retain: 0 }).length, 4, 'retain 0 still keeps the newest backup (manifest + data of the 2 older are removed)')
    assert.equal(listBackups(dirs.backups).manifests.length, 1)
  } finally { h.close() }
})

test('verification: corrupt data, a missing data file, a forged manifest and an incompatible schema are refused; a backup is not "current" because its digest matches', async () => {
  const { h, L, dirs } = await world()
  try {
    const b = createBackup(L, dirs.backups, { freeMb: BIG }).manifest
    assert.equal(verifyBackup(dirs.backups, { ...b, authority_seq: b.authority_seq + 5 }).code, 'BACKUP.MANIFEST_MISMATCH', 'a manifest claiming a newer sequence than the file is refused')
    assert.equal(verifyBackup(dirs.backups, { ...b, schema_version: 99 }).code, 'BACKUP.SCHEMA_INCOMPATIBLE')
    assert.equal(verifyBackup(dirs.backups, { ...b, file: 'ledger-000000000001-0000000000001-deadbeef.sqlite' }).code, 'BACKUP.DATA_MISSING')
    const f = path.join(dirs.backups, b.file); const bytes = readFileSync(f); bytes[bytes.length - 100] ^= 0xff; writeFileSync(f, bytes)
    assert.equal(verifyBackup(dirs.backups, b).code, 'BACKUP.DIGEST_MISMATCH')
    // freshness is a separate question from integrity
    assert.equal(freshnessDecision(b, null).code, 'RESTORE.FRESHNESS_UNPROVEN')
    assert.equal(freshnessDecision(b, { trusted: false, ledger_id: b.ledger_id, authority_seq: b.authority_seq }).code, 'RESTORE.FRESHNESS_UNPROVEN')
    assert.equal(freshnessDecision(b, { trusted: true, ledger_id: b.ledger_id, authority_seq: b.authority_seq + 1 }).code, 'RESTORE.STALE_BACKUP')
    assert.equal(freshnessDecision(b, { trusted: true, ledger_id: 'other', authority_seq: b.authority_seq }).code, 'RESTORE.WITNESS_LEDGER_MISMATCH')
    assert.equal(freshnessDecision(b, { trusted: true, ledger_id: b.ledger_id, authority_seq: b.authority_seq - 1 }).code, 'RESTORE.WITNESS_BEHIND')
  } finally { h.close() }
})

test('STALE backup after authority moved on (consumed evidence, intents, cancellation, fencing): quarantined, live untouched — even when the newest backup is corrupt and only an older one verifies', async () => {
  const { h, L, id, dirs } = await world()
  const live = h.dirs.ledger
  const witness = fileWitness(dirs.witness, { simulationTrusted: true })
  createBackup(L, dirs.backups, { freeMb: BIG })
  addIntent(L, id, 'after-backup-1'); L.cancel(h.submit({ requirements: { text: 'cancelled after the backup' } })) // authority moves on
  const newest = createBackup(L, dirs.backups, { freeMb: BIG }).manifest
  addIntent(L, id, 'after-backup-2'); witness.publish(L) // the witness has seen MORE authority than any backup
  const liveSeq = authoritySeq(L); h.close()
  const f = path.join(dirs.backups, newest.file); const bytes = readFileSync(f); bytes[bytes.length - 50] ^= 0xff; writeFileSync(f, bytes) // newest backup corrupt
  writeFileSync(live, 'this is not a database any more')
  const r = recoverLedger({ liveFile: live, backupDir: dirs.backups, candidateDir: dirs.cand, quarantineDir: dirs.q, lockFile: dirs.lock, witness, isHolderAlive: notAlive })
  assert.equal(r.code, 'RESTORE.STALE_BACKUP'); assert.equal(r.disposition, 'quarantined')
  assert.deepEqual(r.rejected.map((x) => x.code), ['BACKUP.DIGEST_MISMATCH'])
  assert.ok(existsSync(`${r.candidate}.QUARANTINED.json`)); assert.equal(readFileSync(live, 'utf8'), 'this is not a database any more', 'the live (corrupt) file is untouched for diagnostics')
  assert.ok(liveSeq > 0)
})

test('without an INDEPENDENT witness nothing is replaced automatically (the default outside simulation): FRESHNESS_UNPROVEN, candidate quarantined', async () => {
  const { h, L, dirs } = await world()
  createBackup(L, dirs.backups, { freeMb: BIG }); const w = fileWitness(dirs.witness); w.publish(L); h.close()
  writeFileSync(h.dirs.ledger, 'corrupt')
  const r = recoverLedger({ liveFile: h.dirs.ledger, backupDir: dirs.backups, candidateDir: dirs.cand, quarantineDir: dirs.q, lockFile: dirs.lock, witness: w, isHolderAlive: notAlive })
  assert.equal(r.code, 'RESTORE.FRESHNESS_UNPROVEN'); assert.equal(r.disposition, 'quarantined')
  assert.equal(JSON.parse(readFileSync(`${r.candidate}.QUARANTINED.json`, 'utf8')).witness.source, 'controller-written file (NOT independent)')
})

test('controller exclusion: no restore while a live controller holds the lock; a healthy live ledger is never replaced', async () => {
  const { h, L, dirs } = await world()
  try {
    createBackup(L, dirs.backups, { freeMb: BIG })
    assert.ok(acquireLock(dirs.lock, { execution_id: 'controller', acquired_at: new Date().toISOString() }).ok)
    assert.equal(recoverLedger({ liveFile: h.dirs.ledger, backupDir: dirs.backups, candidateDir: dirs.cand, quarantineDir: dirs.q, lockFile: dirs.lock, witness: null, isHolderAlive: () => true }).code, 'RESTORE.CONTROLLER_ACTIVE')
    const lock2 = path.join(dirs.backups, 'other.lock')
    assert.equal(recoverLedger({ liveFile: h.dirs.ledger, backupDir: dirs.backups, candidateDir: dirs.cand, quarantineDir: dirs.q, lockFile: lock2, witness: null, isHolderAlive: notAlive }).code, 'RESTORE.LIVE_LEDGER_HEALTHY')
  } finally { h.close() }
})

for (const crashAt of ['after_live_preserved', 'after_swapped', 'after_sealed']) {
  test(`fresh restore (SIMULATED trusted witness), interrupted ${crashAt}: the journal completes it idempotently; the corrupt live ledger is preserved; the restored ledger is SEALED against replay`, async () => {
    const { h, L, id, dirs } = await world()
    const witness = fileWitness(dirs.witness, { simulationTrusted: true })
    addIntent(L, id, 'effect-key-1')
    const envs = L.db.prepare('SELECT envelope_json FROM evidence WHERE task_id=? AND invalidated_at IS NULL').all(id).map((r) => JSON.parse(r.envelope_json))
    assert.ok(envs.length > 0)
    const tokenBefore = L.getTask(id).fencing_token
    createBackup(L, dirs.backups, { freeMb: BIG }); witness.publish(L) // fresh: the witness equals the backup
    const policy = h.policy; const live = h.dirs.ledger; h.close()
    writeFileSync(live, 'corrupted by a power loss')
    const args = { liveFile: live, backupDir: dirs.backups, candidateDir: dirs.cand, quarantineDir: dirs.q, lockFile: dirs.lock, witness, isHolderAlive: notAlive }
    assert.throws(() => recoverLedger({ ...args, hook: (n) => { if (n === crashAt) throw new Error('CRASH') } }), /CRASH/)
    const r = recoverLedger(args)
    assert.ok(r.ok, JSON.stringify(r))
    assert.ok(readdirSync(dirs.q).some((n) => n.startsWith('live-')), 'the corrupt live ledger is preserved for diagnostics')
    const R = Ledger.open(live)
    try {
      assert.ok(R.recoveryHistory(null).some((x) => x.kind === 'ledger_restored'))
      assert.equal(R.recoveryHistory(null).filter((x) => x.kind === 'ledger_restored').length, 1, 'sealed exactly once despite the interruption')
      assert.equal(R.db.prepare("SELECT status FROM action_intents WHERE idempotency_key='effect-key-1'").get().status, 'uncertain', 'an unfinished effect can only be settled by an authenticated reconciliation')
      assert.equal(markDispatched(R, 'int-effect-key-1', { policy }).ok, false, 'the restored intent can NOT be dispatched again')
      assert.equal(R.getTask(id).fencing_token, tokenBefore + 1, 'fencing advanced: any worker/agent holding the old token is fenced off')
      for (const t of ['test_results', 'independent_review']) assert.equal(satisfyingEvidence(R, id, policy, t).length, 0, `restored ${t} approvals are withdrawn`)
      for (const env of envs) assert.equal(acceptEvidence(R, env, { policy }).ok, false, 'an old envelope (its nonce) cannot be replayed into the restored ledger')
      assert.equal(R.db.prepare("SELECT COUNT(*) c FROM leases WHERE state='active'").get().c, 0)
      assert.equal(checkNotRolledBack(R, witness).ok, true)
    } finally { R.close() }
  })
}

test('rollback guard: a ledger file swapped back by hand (behind the trusted witness) refuses to run; an untrusted witness proves nothing', async () => {
  const { h, L, id, dirs } = await world()
  try {
    const trusted = fileWitness(dirs.witness, { simulationTrusted: true })
    trusted.publish(L); assert.deepEqual(checkNotRolledBack(L, trusted), { ok: true, verified: true })
    addIntent(L, id, 'later'); trusted.publish(L)
    const old = Ledger.open(path.join(tmp(), 'other.sqlite')); old.setMeta('ledger_id', L.meta('ledger_id'))
    assert.equal(checkNotRolledBack(old, trusted).code, 'LEDGER.ROLLBACK_DETECTED'); old.close()
    assert.equal(checkNotRolledBack(L, fileWitness(dirs.witness)).code, 'LEDGER.FRESHNESS_UNVERIFIED')
  } finally { h.close() }
})
