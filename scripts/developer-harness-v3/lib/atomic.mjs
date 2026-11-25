// Developer Harness V3 (D3.3) — atomic local recovery metadata.
//
// Controller-side state (execution records, leases, reservations, ownership) is written with write-temp + fsync + rename so a crash or power
// loss leaves either the old or the new file, never a half-written one. Readers bound the size and validate the schema; a file that fails
// validation is reported as corrupt and is NEVER treated as authoritative (callers fail closed). This is minimal recovery state, not the D3.4 ledger.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

export const MAX_STATE_BYTES = 4 * 1024 * 1024

/** Atomically replace `file` with `JSON.stringify(value)`. */
export function atomicWriteJson(file, value) {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true })
  const body = `${JSON.stringify(value, null, 2)}\n`
  if (Buffer.byteLength(body) > MAX_STATE_BYTES) throw new Error('STATE.TOO_LARGE')
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  const fd = openSync(tmp, 'wx', 0o600)
  try { writeSync(fd, body); fsyncSync(fd) } finally { closeSync(fd) }
  try { renameSync(tmp, file) } catch (e) { rmSync(tmp, { force: true }); throw e }
}

/**
 * Read a JSON state file. Returns {ok:true,value} | {ok:false,code}. `validate(value)` must return true for the value to be accepted;
 * missing → STATE.ABSENT, oversize → STATE.TOO_LARGE, unparsable or invalid → STATE.CORRUPT.
 */
export function readJsonState(file, validate = () => true) {
  if (!existsSync(file)) return { ok: false, code: 'STATE.ABSENT' }
  try {
    if (statSync(file).size > MAX_STATE_BYTES) return { ok: false, code: 'STATE.TOO_LARGE' }
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return validate(value) === true ? { ok: true, value } : { ok: false, code: 'STATE.CORRUPT' }
  } catch { return { ok: false, code: 'STATE.CORRUPT' } }
}

/**
 * Exclusive lock file (O_EXCL). The lock records the holder's pid and a caller-supplied identity. A lock whose holder is verifiably gone may be
 * broken by `isHolderAlive(record) === false`; if liveness cannot be determined the lock is NOT broken (fail closed: no duplicate sessions).
 */
export function acquireLock(file, record, { isHolderAlive } = {}) {
  mkdirSync(path.dirname(file), { recursive: true })
  const body = JSON.stringify({ ...record, pid: record.pid ?? process.pid, acquired_at: record.acquired_at })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx', 0o600)
      try { writeSync(fd, body); fsyncSync(fd) } finally { closeSync(fd) }
      return { ok: true }
    } catch (e) {
      if (e.code !== 'EEXIST') return { ok: false, code: 'LOCK.IO_ERROR' }
      const held = readJsonState(file, (v) => v && typeof v === 'object')
      if (!held.ok) return { ok: false, code: 'LOCK.HELD_UNREADABLE' }
      const alive = typeof isHolderAlive === 'function' ? isHolderAlive(held.value) : null
      if (alive !== false) return { ok: false, code: 'LOCK.HELD', holder: held.value }
      // Holder verifiably gone. Claim the stale file by an atomic rename (only one breaker can win), then confirm the claimed file IS the stale
      // record we judged; if another process had already replaced it with a fresh lock, put that lock back and report LOCK.HELD.
      const claimed = `${file}.stale.${process.pid}.${randomBytes(6).toString('hex')}`
      try { renameSync(file, claimed) } catch { return { ok: false, code: 'LOCK.HELD' } }
      const got = readJsonState(claimed, (v) => v && typeof v === 'object')
      if (!got.ok || JSON.stringify(got.value) !== JSON.stringify(held.value)) {
        try { renameSync(claimed, file) } catch { /* a newer lock now exists; leave both, fail closed */ }
        return { ok: false, code: 'LOCK.HELD' }
      }
      rmSync(claimed, { force: true })
    }
  }
  return { ok: false, code: 'LOCK.HELD' }
}

export function releaseLock(file, expect) {
  const held = readJsonState(file, (v) => v && typeof v === 'object')
  if (!held.ok) return { ok: false, code: held.code }
  if (expect && (held.value.execution_id !== expect.execution_id)) return { ok: false, code: 'LOCK.NOT_HOLDER' }
  rmSync(file, { force: true })
  return { ok: true }
}
