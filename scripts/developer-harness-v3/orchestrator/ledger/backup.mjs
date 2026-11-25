// Developer Harness V3 (D3.4) — safe ledger backup and recovery. `VACUUM INTO` produces a transactionally consistent copy while the ledger is live (no
// file copy of a WAL database, which could tear). Every backup carries a sha256 sidecar and is opened read-only and integrity-checked before it is
// reported good. Restore NEVER overwrites a live ledger: it writes a candidate file the owner/controller must verify and swap deliberately.
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { LEDGER_APPLICATION_ID, SCHEMA_VERSION } from './schema.mjs'

const sha256File = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

export function verifyLedgerFile(file) {
  if (!existsSync(file)) return { ok: false, code: 'BACKUP.ABSENT' }
  let db
  try {
    db = new DatabaseSync(file, { readOnly: true })
    const check = db.prepare('PRAGMA quick_check').get().quick_check
    const app = db.prepare('PRAGMA application_id').get().application_id
    const ver = db.prepare('PRAGMA user_version').get().user_version
    const tasks = db.prepare('SELECT COUNT(*) c FROM tasks').get().c
    if (check !== 'ok') return { ok: false, code: 'BACKUP.CORRUPT' }
    if (app !== LEDGER_APPLICATION_ID) return { ok: false, code: 'BACKUP.FOREIGN_DATABASE' }
    if (ver > SCHEMA_VERSION) return { ok: false, code: 'BACKUP.SCHEMA_TOO_NEW' }
    return { ok: true, schema_version: ver, tasks }
  } catch { return { ok: false, code: 'BACKUP.UNREADABLE' } } finally { try { db?.close() } catch { /* ignore */ } }
}

export function backupLedger(ledger, destFile) {
  if (existsSync(destFile)) return { ok: false, code: 'BACKUP.DESTINATION_EXISTS' }
  const tmp = `${destFile}.${randomBytes(6).toString('hex')}.partial`
  try {
    ledger.db.exec(`VACUUM INTO ${sqlQuote(tmp)}`)
    const v = verifyLedgerFile(tmp)
    if (!v.ok) { rmSync(tmp, { force: true }); return v }
    const digest = sha256File(tmp)
    renameSync(tmp, destFile)
    writeFileSync(`${destFile}.sha256`, `${digest}  ${destFile.split(/[\\/]/).pop()}\n`, { mode: 0o600 })
    return { ok: true, sha256: digest, bytes: statSync(destFile).size, tasks: v.tasks }
  } catch (e) { rmSync(tmp, { force: true }); return { ok: false, code: 'BACKUP.FAILED', detail: String(e.message).slice(0, 200) } }
}

/** Produce a restore CANDIDATE from a backup after checking the sidecar digest and the database. The live ledger is never touched. */
export function prepareRestore(backupFile, candidateFile) {
  const side = `${backupFile}.sha256`
  if (!existsSync(side)) return { ok: false, code: 'RESTORE.NO_DIGEST' }
  if (readFileSync(side, 'utf8').split(/\s+/)[0] !== sha256File(backupFile)) return { ok: false, code: 'RESTORE.DIGEST_MISMATCH' }
  const v = verifyLedgerFile(backupFile)
  if (!v.ok) return { ok: false, code: `RESTORE.${v.code}` }
  if (existsSync(candidateFile)) return { ok: false, code: 'RESTORE.DESTINATION_EXISTS' }
  copyFileSync(backupFile, candidateFile)
  return { ok: true, tasks: v.tasks }
}
