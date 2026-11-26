// Developer Harness V3 (D3.3) — atomic local recovery metadata.
//
// Controller-side state (execution records, leases, reservations, ownership) is written with write-temp + fsync + rename so a crash or power
// loss leaves either the old or the new file, never a half-written one. Readers bound the size and validate the schema; a file that fails
// validation is reported as corrupt and is NEVER treated as authoritative (callers fail closed). This is minimal recovery state, not the D3.4 ledger.
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
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
 * Exclusive lock file (O_EXCL). The lock records the holder's pid, a caller-supplied identity and a per-acquisition NONCE. A lock whose holder is verifiably gone may be broken by
 * `isHolderAlive(record) === false`; if liveness cannot be determined the lock is NOT broken (fail closed: no duplicate sessions).
 *
 * D3.5 independent verification F3 — stale-lock takeover is SERIALIZED and never renames a possibly-fresh lock away. The previous algorithm renamed the file it had judged stale to a
 * private name and, if it turned out to be a fresh lock, renamed it back: for that moment NO lock file existed, so a third contender could create one and two holders could believe
 * they held the lock (observed: 26 double-acquisitions in 1,500 parallel takeover rounds). Now:
 *   1. only the holder of the takeover MUTEX (`<file>.takeover`, itself O_EXCL) may remove or replace an existing lock — a lock that appears fresh is never touched by anyone else;
 *   2. under the mutex the lock is RE-READ and must still be the very record (same nonce) that was judged dead, otherwise the takeover is abandoned and re-evaluated from the top;
 *   3. the stale file is moved to a unique name and its content re-verified; a mismatch is NEVER restored over anything — the state is ambiguous and the takeover fails closed;
 *   4. the new lock is created with O_EXCL: if a new contender slipped in while the file was absent it simply wins and the breaker reports LOCK.HELD.
 * A leftover mutex (a breaker that crashed inside its few-microsecond critical section) is broken only when ITS holder is verifiably dead; otherwise LOCK.TAKEOVER_BUSY (retry later).
 * `strict` (D3.5 second-round remediation; used by the host runner, whose lock authorizes REAL host workloads): a leftover takeover mutex is NEVER broken, however dead its breaker looks — breaking it is the
 * one step that still had a multi-racer window (a dead mutex replaced by a live one between judging and moving it). A strict acquirer reports LOCK.TAKEOVER_BUSY and an operator removes the leftover
 * `<file>.takeover` by hand after confirming no runner is active. Every ambiguous state (unreadable lock, busy mutex, replaced lock, AMBIGUOUS) already fails closed and so authorizes nothing.
 * `hook(name)` is a test-only interleaving point (never passed in production).
 */
export function acquireLock(file, record, { isHolderAlive, hook = null, strict = false } = {}) {
  mkdirSync(path.dirname(file), { recursive: true })
  const nonce = randomBytes(12).toString('hex')
  const body = JSON.stringify({ ...record, pid: record.pid ?? process.pid, acquired_at: record.acquired_at, nonce })
  const mutexFile = `${file}.takeover`
  const create = (target, text) => { const fd = openSync(target, 'wx', 0o600); try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) } }
  const objectRecord = (v) => v && typeof v === 'object'
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { create(file, body); return { ok: true, nonce } } catch (e) {
      if (e.code !== 'EEXIST') return { ok: false, code: 'LOCK.IO_ERROR' }
    }
    const held = readJsonState(file, objectRecord)
    if (!held.ok && held.code === 'STATE.ABSENT') continue // released between our create attempt and our read: simply try again
    if (!held.ok) return { ok: false, code: 'LOCK.HELD_UNREADABLE' } // unreadable / corrupt: never treated as stale
    const alive = typeof isHolderAlive === 'function' ? isHolderAlive(held.value) : null
    if (alive !== false) return { ok: false, code: 'LOCK.HELD', holder: held.value }
    hook?.('judged_stale')
    // ---- serialized takeover
    const mutexBody = JSON.stringify({ ...record, pid: process.pid, nonce, acquired_at: record.acquired_at, takeover_of: held.value.nonce ?? null }) // carries the breaker's identity (start/name) so a reused pid cannot keep a dead breaker's mutex alive
    try { create(mutexFile, mutexBody) } catch (e) {
      if (e.code !== 'EEXIST') return { ok: false, code: 'LOCK.IO_ERROR' }
      if (strict) return { ok: false, code: 'LOCK.TAKEOVER_BUSY' } // never broken automatically (see above)
      const m = readJsonState(mutexFile, objectRecord)
      // an EMPTY / half-written mutex (its breaker crashed between create and write) is breakable once it is clearly old; a readable one only when its holder is verifiably dead
      const oldCorrupt = !m.ok && m.code === 'STATE.CORRUPT' && (() => { try { return Date.now() - statSync(mutexFile).mtimeMs > 10_000 } catch { return false } })()
      const mAlive = m.ok && typeof isHolderAlive === 'function' ? isHolderAlive(m.value) : null
      if (mAlive !== false && !oldCorrupt) return { ok: false, code: 'LOCK.TAKEOVER_BUSY' }
      const dead = `${mutexFile}.dead.${process.pid}.${randomBytes(6).toString('hex')}`
      try { renameSync(mutexFile, dead) } catch { return { ok: false, code: 'LOCK.TAKEOVER_BUSY' } }
      const got = readJsonState(dead, objectRecord)
      if (oldCorrupt ? got.ok : (!got.ok || got.value.nonce !== m.value.nonce)) { // what we moved is NOT the record we judged dead (a live breaker replaced it first): put it back WITHOUT clobbering anything (link fails if the path is taken), then fail closed
        let restored = false; try { linkSync(dead, mutexFile); restored = true } catch { /* the path is taken again: the evidence stays under its .dead name */ }
        if (restored) rmSync(dead, { force: true })
        return { ok: false, code: 'LOCK.AMBIGUOUS' }
      }
      rmSync(dead, { force: true }); continue
    }
    let verdict = null
    try {
      hook?.('mutex_held')
      const again = readJsonState(file, objectRecord)
      if (!again.ok && again.code !== 'STATE.ABSENT') verdict = { ok: false, code: 'LOCK.HELD_UNREADABLE' }
      else if (again.ok && (again.value.nonce ?? null) !== (held.value.nonce ?? null)) verdict = { ok: false, code: 'LOCK.HELD' } // replaced since the judgement: abandon and fail closed (the replacement is never touched)
      else if (again.ok) {
        const claimed = `${file}.stale.${process.pid}.${randomBytes(6).toString('hex')}`
        try { renameSync(file, claimed) } catch { /* vanished: fall through to create */ }
        if (existsSync(claimed)) {
          const got = readJsonState(claimed, objectRecord)
          if (!got.ok || (got.value.nonce ?? null) !== (held.value.nonce ?? null) || got.value.execution_id !== held.value.execution_id) verdict = { ok: false, code: 'LOCK.AMBIGUOUS' } // never restored over anything
          else rmSync(claimed, { force: true })
        }
        if (!verdict) { try { create(file, body); verdict = { ok: true, nonce } } catch (e) { verdict = { ok: false, code: e.code === 'EEXIST' ? 'LOCK.HELD' : 'LOCK.IO_ERROR' } } }
      } else { try { create(file, body); verdict = { ok: true, nonce } } catch (e) { verdict = { ok: false, code: e.code === 'EEXIST' ? 'LOCK.HELD' : 'LOCK.IO_ERROR' } } }
    } finally {
      const mine = readJsonState(mutexFile, objectRecord); if (mine.ok && mine.value.nonce === nonce) rmSync(mutexFile, { force: true })
    }
    if (verdict) return verdict
  }
  return { ok: false, code: 'LOCK.HELD' }
}

/** Does `file` still hold OUR lock (same nonce)? A holder re-checks this before every irreversible step: a lock that was replaced or removed means exclusivity is lost. */
export function holdsLock(file, nonce) {
  const held = readJsonState(file, (v) => v && typeof v === 'object')
  return held.ok && typeof nonce === 'string' && held.value.nonce === nonce
}

export function releaseLock(file, expect) {
  const held = readJsonState(file, (v) => v && typeof v === 'object')
  if (!held.ok) return { ok: false, code: held.code }
  if (expect && (held.value.execution_id !== expect.execution_id)) return { ok: false, code: 'LOCK.NOT_HOLDER' }
  if (expect?.nonce && held.value.nonce !== expect.nonce) return { ok: false, code: 'LOCK.NOT_HOLDER' }
  rmSync(file, { force: true })
  return { ok: true }
}
