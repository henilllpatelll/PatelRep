// Developer Harness V3 (D3.5-F) — ledger backup, integrity and disaster recovery, built on backup.mjs (VACUUM INTO + verifyLedgerFile).
//
// A backup is NEVER "current" merely because its digest matches. Every authority-relevant mutation (evidence accepted/consumed/invalidated, nonces, intents and their status,
// fencing advances, cancellation, owner decisions, policy revisions, leases, resource ownership, cleanup) appends to the database-maintained `authority_log` (schema V3), so a
// ledger has a monotonic AUTHORITY SEQUENCE. A manifest records it. Restoring a backup whose sequence is behind the latest authority would ROLL BACK consumed evidence and
// nonces, fencing tokens, intents and completed effects, cancellations, owner decisions, policy revisions and resource ownership — so automatic replacement requires an
// INDEPENDENTLY TRUSTED high-water witness that proves the backup is not behind. No such witness exists yet (gate G-LEDGER-FRESHNESS-WITNESS): outside simulation every restore
// candidate stays QUARANTINED for the owner, by design.
//   * backups: storage admission → VACUUM INTO a temp file → verify → digest → rename → ATOMIC manifest (the commit point; a data file without a manifest is a partial publication,
//     ignored and garbage-collected) → bounded retention (only our own, manifest-named files);
//   * restore: controller exclusion (the controller lock) → newest backup that VERIFIES (digest, integrity, ledger identity, schema compatibility, the sequence inside the file
//     equals the manifest) → candidate copy in a separate location → freshness decision → journaled swap (the corrupt live ledger is PRESERVED for diagnostics, never deleted) →
//     SEAL: every unfinished intent becomes uncertain (only an authenticated reconciliation can settle it), unconsumed evidence is withdrawn, live leases become termination-
//     unverified (no session is assumed dead), every open task's fencing token advances — so a restored ledger can never authorize a repeat effect or resurrect stale authority.
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { acquireLock, atomicWriteJson, readJsonState, releaseLock } from '../../lib/atomic.mjs'
import { verifyLedgerFile } from './backup.mjs'
import { Ledger } from './ledger.mjs'
import { SCHEMA_VERSION } from './schema.mjs'

export const MANIFEST_SCHEMA = 'patelrep.developer-harness-v3.ledger-backup'
export const DR_DEFAULTS = Object.freeze({ retain: 5, minFreeMb: 2048, sizeFactor: 2 })
const NAME = /^ledger-(\d{12})-(\d{13})-([0-9a-f]{8})$/
const sha256File = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

/** Facts read from a ledger FILE (read-only): identity, schema, authority sequence. */
export function fileFacts(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const ver = db.prepare('PRAGMA user_version').get().user_version
    const ledgerId = db.prepare("SELECT value FROM meta WHERE key='ledger_id'").get()?.value ?? null
    const hasLog = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='authority_log'").get()
    const seq = hasLog ? db.prepare('SELECT COALESCE(MAX(seq),0) s FROM authority_log').get().s : 0
    return { schema_version: ver, ledger_id: ledgerId, authority_seq: seq, tasks: db.prepare('SELECT COUNT(*) c FROM tasks').get().c }
  } finally { db.close() }
}
export const authoritySeq = (L) => L.db.prepare('SELECT COALESCE(MAX(seq),0) s FROM authority_log').get().s

const freeMbOf = (dir) => { const s = statfsSync(dir); return Math.floor((Number(s.bavail) * Number(s.bsize)) / 1048576) }
const validManifest = (m) => !!m && m.schema === MANIFEST_SCHEMA && m.version === 1 && typeof m.ledger_id === 'string' && Number.isSafeInteger(m.authority_seq) && m.authority_seq >= 0 &&
  Number.isSafeInteger(m.schema_version) && /^[0-9a-f]{64}$/.test(m.sha256 ?? '') && typeof m.file === 'string' && NAME.test(m.file.replace(/\.sqlite$/, '')) && Number.isSafeInteger(m.bytes)

/** Create a consistent, verified, manifest-committed backup, then apply retention. */
export function createBackup(L, dir, { retain = DR_DEFAULTS.retain, minFreeMb = DR_DEFAULTS.minFreeMb, freeMb = freeMbOf, hook = null } = {}) {
  mkdirSync(dir, { recursive: true })
  const liveBytes = L.file && L.file !== ':memory:' && existsSync(L.file) ? statSync(L.file).size + (existsSync(`${L.file}-wal`) ? statSync(`${L.file}-wal`).size : 0) : 0
  const need = Math.ceil((liveBytes * DR_DEFAULTS.sizeFactor) / 1048576) + minFreeMb
  let free = null; try { free = freeMb(dir) } catch { free = null }
  if (!Number.isFinite(free) || free < need) return { ok: false, code: 'BACKUP.STORAGE_INSUFFICIENT', free_mb: free, need_mb: need }
  const seq = authoritySeq(L)
  const base = `ledger-${String(seq).padStart(12, '0')}-${String(L.now()).padStart(13, '0')}-${randomBytes(4).toString('hex')}`
  const data = path.join(dir, `${base}.sqlite`); const tmp = `${data}.${randomBytes(6).toString('hex')}.partial`
  try {
    L.db.exec(`VACUUM INTO ${sqlQuote(tmp)}`)
    const v = verifyLedgerFile(tmp); if (!v.ok) { rmSync(tmp, { force: true }); return v }
    const f = fileFacts(tmp)
    if (f.authority_seq !== seq || f.ledger_id !== L.meta('ledger_id')) { rmSync(tmp, { force: true }); return { ok: false, code: 'BACKUP.INCONSISTENT_COPY' } }
    const digest = sha256File(tmp)
    renameSync(tmp, data)
    hook?.('after_backup_data_published', { data })
    const manifest = { schema: MANIFEST_SCHEMA, version: 1, ledger_id: f.ledger_id, schema_version: f.schema_version, authority_seq: f.authority_seq, sha256: digest, bytes: statSync(data).size, file: `${base}.sqlite`, created_at: L.now(), tasks: f.tasks }
    atomicWriteJson(path.join(dir, `${base}.manifest.json`), manifest) // the COMMIT POINT
    const pruned = applyRetention(dir, { retain })
    return { ok: true, manifest, pruned }
  } catch (e) { rmSync(tmp, { force: true }); return { ok: false, code: 'BACKUP.FAILED', detail: String(e.message).slice(0, 200) } }
}

/** Manifests that parse and validate (newest authority first), plus orphan data files (a partial publication) and invalid manifests. Links are never followed. */
export function listBackups(dir) {
  if (!existsSync(dir)) return { manifests: [], orphans: [], invalid: [] }
  const names = readdirSync(dir); const manifests = []; const invalid = []
  for (const n of names.filter((x) => x.endsWith('.manifest.json'))) {
    const r = readJsonState(path.join(dir, n), validManifest)
    if (r.ok && n === r.value.file.replace(/\.sqlite$/, '.manifest.json')) manifests.push(r.value); else invalid.push(n)
  }
  const committed = new Set(manifests.map((m) => m.file))
  const orphans = names.filter((n) => n.endsWith('.sqlite') && NAME.test(n.replace(/\.sqlite$/, '')) && !committed.has(n))
  manifests.sort((a, b) => b.authority_seq - a.authority_seq || b.created_at - a.created_at)
  return { manifests, orphans, invalid }
}

export function applyRetention(dir, { retain = DR_DEFAULTS.retain } = {}) {
  const { manifests, orphans } = listBackups(dir); const removed = []
  const rm = (n) => { const p = path.join(dir, n); try { if (statSync(p).isFile()) { rmSync(p); removed.push(n) } } catch { /* already gone */ } }
  for (const m of manifests.slice(Math.max(1, retain))) { rm(m.file.replace(/\.sqlite$/, '.manifest.json')); rm(m.file) } // the manifest goes FIRST: a crash mid-retention leaves an orphan, never a dangling manifest
  for (const o of orphans) rm(o) // partial publications
  return removed
}

/** Full verification of one backup against its manifest. */
export function verifyBackup(dir, m) {
  if (!validManifest(m)) return { ok: false, code: 'BACKUP.MANIFEST_INVALID' }
  const f = path.join(dir, m.file)
  if (!existsSync(f)) return { ok: false, code: 'BACKUP.DATA_MISSING' }
  if (sha256File(f) !== m.sha256) return { ok: false, code: 'BACKUP.DIGEST_MISMATCH' }
  const v = verifyLedgerFile(f); if (!v.ok) return v
  if (m.schema_version < 1 || m.schema_version > SCHEMA_VERSION) return { ok: false, code: 'BACKUP.SCHEMA_INCOMPATIBLE' }
  const facts = fileFacts(f)
  if (facts.ledger_id !== m.ledger_id || facts.authority_seq !== m.authority_seq || facts.schema_version !== m.schema_version) return { ok: false, code: 'BACKUP.MANIFEST_MISMATCH' }
  return { ok: true, facts }
}

/**
 * May a verified backup replace the live ledger AUTOMATICALLY? Only against an INDEPENDENTLY TRUSTED high-water witness of the same ledger whose sequence the backup equals.
 * @param {{trusted:boolean, ledger_id:string, authority_seq:number, source:string}|null} witness
 */
export function freshnessDecision(m, witness) {
  if (!witness || witness.trusted !== true) return { ok: false, code: 'RESTORE.FRESHNESS_UNPROVEN' }
  if (witness.ledger_id !== m.ledger_id) return { ok: false, code: 'RESTORE.WITNESS_LEDGER_MISMATCH' }
  if (!Number.isSafeInteger(witness.authority_seq)) return { ok: false, code: 'RESTORE.WITNESS_MALFORMED' }
  if (m.authority_seq < witness.authority_seq) return { ok: false, code: 'RESTORE.STALE_BACKUP' }
  if (m.authority_seq > witness.authority_seq) return { ok: false, code: 'RESTORE.WITNESS_BEHIND' }
  return { ok: true }
}

/** A witness record kept by a file. It is NOT independent of the controller (the controller writes it): `trusted` is false unless a test constructs it as a SIMULATED trusted witness. */
export function fileWitness(file, { simulationTrusted = false } = {}) {
  return {
    read() { const r = readJsonState(file, (v) => v && typeof v.ledger_id === 'string' && Number.isSafeInteger(v.authority_seq)); return r.ok ? { ...r.value, trusted: simulationTrusted === true, source: simulationTrusted ? 'SIMULATED_TRUSTED_WITNESS' : 'controller-written file (NOT independent)' } : null },
    publish(L) { atomicWriteJson(file, { ledger_id: L.meta('ledger_id'), authority_seq: authoritySeq(L), at: L.now() }) },
  }
}

/** Controller start-up rollback guard: a ledger whose authority sequence is BEHIND a trusted witness (an old file swapped in by hand) refuses to run. */
export function checkNotRolledBack(L, witness) {
  const w = witness?.read?.() ?? null
  if (!w || w.trusted !== true) return { ok: true, verified: false, code: 'LEDGER.FRESHNESS_UNVERIFIED' }
  if (w.ledger_id !== L.meta('ledger_id')) return { ok: false, code: 'LEDGER.WITNESS_LEDGER_MISMATCH' }
  if (authoritySeq(L) < w.authority_seq) return { ok: false, code: 'LEDGER.ROLLBACK_DETECTED' }
  return { ok: true, verified: true }
}

const journalFile = (liveFile) => `${liveFile}.restore-journal.json`
const moveDb = (from, to) => { for (const sfx of ['', '-wal', '-shm']) if (existsSync(from + sfx)) renameSync(from + sfx, to + sfx) }

/**
 * Restore the live ledger from the newest backup that verifies, if — and only if — freshness is proven. Otherwise the candidate is left QUARANTINED in `candidateDir`.
 * @param {{liveFile:string, backupDir:string, candidateDir:string, quarantineDir:string, lockFile:string, witness:object|null, isHolderAlive:(rec)=>boolean|null, now?:()=>number, hook?:Function}} o
 */
export function recoverLedger({ liveFile, backupDir, candidateDir, quarantineDir, lockFile, witness, isHolderAlive, now = Date.now, hook = null, force = false }) {
  const lock = acquireLock(lockFile, { execution_id: 'ledger-recovery', acquired_at: new Date(now()).toISOString() }, { isHolderAlive })
  if (!lock.ok) return { ok: false, code: lock.code === 'LOCK.HELD' ? 'RESTORE.CONTROLLER_ACTIVE' : lock.code } // never restore under a running controller
  try {
    if (existsSync(journalFile(liveFile))) return resumeRecovery({ liveFile, hook, now })
    const live = verifyLedgerFile(liveFile)
    if (live.ok && !force) return { ok: false, code: 'RESTORE.LIVE_LEDGER_HEALTHY' }
    const { manifests } = listBackups(backupDir); const rejected = []
    let chosen = null
    for (const m of manifests) { const v = verifyBackup(backupDir, m); if (v.ok) { chosen = m; break } rejected.push({ file: m.file, code: v.code }) }
    if (!chosen) return { ok: false, code: 'RESTORE.NO_VERIFIED_BACKUP', rejected }
    mkdirSync(candidateDir, { recursive: true })
    const candidate = path.join(candidateDir, `candidate-${chosen.sha256.slice(0, 16)}.sqlite`)
    if (!existsSync(candidate)) copyFileSync(path.join(backupDir, chosen.file), candidate)
    if (sha256File(candidate) !== chosen.sha256) return { ok: false, code: 'RESTORE.CANDIDATE_COPY_MISMATCH' }
    const w = witness?.read?.() ?? null
    const fresh = freshnessDecision(chosen, w)
    if (!fresh.ok) {
      atomicWriteJson(`${candidate}.QUARANTINED.json`, { reason: fresh.code, manifest: chosen, witness: w ? { ledger_id: w.ledger_id, authority_seq: w.authority_seq, trusted: w.trusted, source: w.source } : null, live: live.ok ? 'healthy' : live.code, rejected, at: now(),
        owner_step: 'The candidate is verified but its freshness is NOT proven by an independent high-water witness (gate G-LEDGER-FRESHNESS-WITNESS). Replacing the live ledger with it could roll back consumed evidence, fencing, intents, cancellations, owner decisions, policy or ownership. Decide deliberately.' })
      return { ok: false, code: fresh.code, disposition: 'quarantined', candidate, rejected }
    }
    mkdirSync(quarantineDir, { recursive: true })
    const preserved = path.join(quarantineDir, `live-${now()}-${live.ok ? 'healthy' : live.code}.sqlite`)
    atomicWriteJson(journalFile(liveFile), { step: 'begin', live: liveFile, candidate, preserved, manifest: chosen })
    return resumeRecovery({ liveFile, hook, now })
  } finally { releaseLock(lockFile, { execution_id: 'ledger-recovery' }) }
}

/** Crash-safe, idempotent completion of a journaled swap. Each step is re-derived from the files that exist, never assumed. */
export function resumeRecovery({ liveFile, hook = null, now = Date.now }) {
  const jf = journalFile(liveFile); const j = readJsonState(jf, (v) => v && typeof v.step === 'string' && typeof v.candidate === 'string')
  if (!j.ok) return { ok: false, code: 'RESTORE.JOURNAL_UNREADABLE' }
  const J = j.value
  if (J.step === 'begin') {
    if (existsSync(liveFile)) moveDb(liveFile, J.preserved) // preserve the corrupt (or replaced) live ledger for diagnostics
    atomicWriteJson(jf, { ...J, step: 'live_preserved' }); J.step = 'live_preserved'; hook?.('after_live_preserved')
  }
  if (J.step === 'live_preserved') {
    if (!existsSync(liveFile)) { if (!existsSync(J.candidate)) return { ok: false, code: 'RESTORE.CANDIDATE_LOST' }; renameSync(J.candidate, liveFile) }
    atomicWriteJson(jf, { ...J, step: 'swapped' }); J.step = 'swapped'; hook?.('after_swapped')
  }
  if (J.step === 'swapped') {
    const L = Ledger.open(liveFile, { clock: now })
    try { sealAfterRestore(L, { manifest: J.manifest }) } finally { L.close() }
    hook?.('after_sealed')
    rmSync(jf, { force: true })
  }
  return { ok: true, restored_from: J.manifest.file, preserved: J.preserved }
}

/**
 * Make a restored ledger SAFE to resume (idempotent): nothing it contains may authorize a repeat external effect or a stale session. One transaction.
 */
export function sealAfterRestore(L, { manifest }) {
  return L.tx(() => {
    if (L.meta('restored_from') === manifest.sha256) return { duplicate: true }
    const now = L.now()
    const intents = L.db.prepare("SELECT intent_id FROM action_intents WHERE status IN ('intended','dispatched')").all()
    for (const i of intents) L.db.prepare("UPDATE action_intents SET status='uncertain', updated_at=? WHERE intent_id=?").run(now, i.intent_id) // only an authenticated reconciliation settles them
    const ev = L.db.prepare('UPDATE evidence SET invalidated_at=? WHERE invalidated_at IS NULL AND consumed_at IS NULL').run(now).changes
    const leases = L.db.prepare("UPDATE leases SET state='termination_unverified' WHERE state='active'").run().changes
    const works = L.db.prepare("UPDATE work_leases SET state='termination_unverified' WHERE state='active'").run().changes
    const advanced = []
    for (const t of L.db.prepare("SELECT task_id FROM tasks WHERE state<>'completed' ORDER BY task_id").all()) {
      const task = L.getTask(t.task_id)
      const r = L.applyLifecycleEvent(t.task_id, L.eventFor(t.task_id, 'worker_recovered', { idempotency_id: `restore-${manifest.sha256.slice(0, 16)}-${t.task_id}`.slice(0, 128), reason_code: 'HOST_RESTARTED', new_fencing_token: task.fencing_token + 1 }))
      if (r.ok) advanced.push(t.task_id)
    }
    L.setMeta('restored_from', manifest.sha256); L.setMeta('restored_at', now)
    L.recordRecovery(null, 'ledger_restored', { from: manifest.file, authority_seq: manifest.authority_seq, intents_uncertain: intents.length, evidence_withdrawn: ev, leases_unverified: leases + works, fencing_advanced: advanced.length })
    return { intents_uncertain: intents.length, evidence_withdrawn: ev, leases_unverified: leases + works, fencing_advanced: advanced }
  })
}
