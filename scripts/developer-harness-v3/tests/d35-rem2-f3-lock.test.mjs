// D3.5 independent-verification remediation, F3 — exclusive ownership of the shared lock helper throughout STALE-LOCK TAKEOVER, replacement and release.
// Pre-fix: the takeover renamed the file it had judged stale to a private name and, if it was in fact a fresh lock, renamed it back; while it was gone a third contender could create its own
// lock, and the rename-back then replaced it — two holders. Measured against the previous implementation with the same stress: 26 double-acquisitions in 1,500 parallel rounds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acquireLock, holdsLock, releaseLock } from '../lib/atomic.mjs'

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'dh35-lock-'))
const DEAD = { execution_id: 'dead', pid: 999999, acquired_at: 'x', nonce: 'deadnonce' }
const deadOnly = (h) => h.pid !== 999999 // 999999 is "verifiably dead"; every other holder is alive

test('stress: 8 parallel contenders over a stale lock — exactly ONE winner per round, never two, never none (600 rounds of real parallel file operations)', { timeout: 240_000 }, async () => {
  const dir = tmp(); const N = 8; const ROUNDS = 600
  const sab = new SharedArrayBuffer(4 * (N + 1)); const ctl = new Int32Array(sab)
  const workers = Array.from({ length: N }, (_, i) => new Worker(new URL('./d35-rem2-lock-worker.mjs', import.meta.url), { workerData: { i, sab, dir } }))
  const lock = path.join(dir, 'x.lock'); let violations = 0; let none = 0
  try {
    await new Promise((r) => setTimeout(r, 300))
    for (let round = 1; round <= ROUNDS; round += 1) {
      for (let i = 1; i <= N; i += 1) Atomics.store(ctl, i, 0)
      rmSync(lock, { force: true }); rmSync(`${lock}.takeover`, { force: true }); writeFileSync(lock, JSON.stringify(DEAD))
      Atomics.store(ctl, 0, round); Atomics.notify(ctl, 0)
      const t0 = Date.now(); while (Array.from({ length: N }, (_, i) => Atomics.load(ctl, i + 1)).some((v) => v === 0) && Date.now() - t0 < 10_000) await new Promise((r) => setImmediate(r))
      const wins = Array.from({ length: N }, (_, i) => Atomics.load(ctl, i + 1)).filter((v) => v === 2).length
      if (wins > 1) violations += 1; if (wins === 0) none += 1
      const held = JSON.parse(readFileSync(lock, 'utf8')); assert.ok(/^w\d-/.test(held.execution_id), 'the lock file names a real holder')
    }
  } finally { await Promise.all(workers.map((w) => w.terminate())); rmSync(dir, { recursive: true, force: true }) }
  assert.equal(violations, 0, `${violations} rounds had more than one holder`); assert.equal(none, 0, `${none} rounds had no holder at all`)
})

test('interleaving A: a contender judges the lock stale, but it is replaced by a FRESH live lock before it acts — the fresh lock is never touched', () => {
  const dir = tmp(); const lock = path.join(dir, 'x.lock'); writeFileSync(lock, JSON.stringify(DEAD)); let fresh = null
  try {
    const c = acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: deadOnly,
      hook: (name) => { if (name === 'judged_stale') { const b = acquireLock(lock, { execution_id: 'B', acquired_at: 'x' }, { isHolderAlive: deadOnly }); assert.equal(b.ok, true); fresh = b } } })
    assert.equal(c.ok, false); assert.equal(c.code, 'LOCK.HELD', 'C is refused: B holds')
    assert.ok(holdsLock(lock, fresh.nonce), "B's lock file is intact and still B's")
    assert.deepEqual(readdirSync(dir).filter((n) => /stale|takeover/.test(n)), [], 'no litter')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('interleaving B: the lock is replaced WHILE the takeover mutex is held — the takeover is abandoned and re-evaluated, never renaming the replacement away', () => {
  const dir = tmp(); const lock = path.join(dir, 'x.lock'); writeFileSync(lock, JSON.stringify(DEAD)); let b = null
  try {
    const c = acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: deadOnly,
      hook: (name) => { if (name === 'mutex_held') { rmSync(lock); writeFileSync(lock, JSON.stringify({ execution_id: 'B', pid: process.pid, nonce: 'bnonce', acquired_at: 'x' })); b = true } } })
    assert.ok(b); assert.equal(c.ok, false); assert.equal(JSON.parse(readFileSync(lock, 'utf8')).execution_id, 'B', "B's lock was not moved or replaced")
    assert.equal(existsSync(`${lock}.takeover`), false, 'the mutex was released')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('interleaving C: the lock is released and a NEW contender creates its own while the breaker holds the mutex — the breaker loses cleanly; no lock is clobbered', () => {
  const dir = tmp(); const lock = path.join(dir, 'x.lock'); writeFileSync(lock, JSON.stringify(DEAD)); let d = null
  try {
    const c = acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: deadOnly,
      hook: (name) => { if (name === 'mutex_held') { rmSync(lock); d = acquireLock(lock, { execution_id: 'D', acquired_at: 'x' }, { isHolderAlive: deadOnly }); assert.equal(d.ok, true) } } })
    assert.equal(c.ok, false); assert.equal(c.code, 'LOCK.HELD'); assert.ok(holdsLock(lock, d.nonce), "D's lock was not overwritten")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('ambiguous states fail closed: an unreadable lock is never taken over; a takeover mutex held by a live (or unknowable) breaker blocks; a dead breaker\'s mutex is cleared', () => {
  const dir = tmp(); const lock = path.join(dir, 'x.lock')
  try {
    writeFileSync(lock, '{not json')
    assert.equal(acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: () => false }).code, 'LOCK.HELD_UNREADABLE')
    assert.equal(readFileSync(lock, 'utf8'), '{not json', 'untouched')
    writeFileSync(lock, JSON.stringify(DEAD)); writeFileSync(`${lock}.takeover`, JSON.stringify({ pid: process.pid, nonce: 'm' }))
    assert.equal(acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: deadOnly }).code, 'LOCK.TAKEOVER_BUSY', 'a live breaker is never displaced')
    assert.equal(acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: (h) => (h.pid === 999999 ? false : null) }).code, 'LOCK.TAKEOVER_BUSY', 'an unknowable breaker is never displaced')
    writeFileSync(`${lock}.takeover`, JSON.stringify({ pid: 999999, nonce: 'm' }))
    const ok = acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: deadOnly }); assert.equal(ok.ok, true, 'the dead breaker\'s leftover mutex was cleared and the dead holder\'s lock taken over')
    assert.ok(holdsLock(lock, ok.nonce)); assert.equal(existsSync(`${lock}.takeover`), false)
    // an unknowable holder is never broken
    assert.equal(acquireLock(lock, { execution_id: 'E', acquired_at: 'x' }, { isHolderAlive: () => null }).code, 'LOCK.HELD')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('review N2: an empty / half-written takeover mutex is broken once clearly old (not before); a dead breaker mutex carrying a REUSED pid is judged by identity', async () => {
  const { utimesSync } = await import('node:fs'); const dir = tmp(); const lock = path.join(dir, 'x.lock'); const mutex = `${lock}.takeover`
  try {
    writeFileSync(lock, JSON.stringify(DEAD)); writeFileSync(mutex, '')
    assert.equal(acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: deadOnly }).code, 'LOCK.TAKEOVER_BUSY', 'a fresh empty mutex may be a breaker mid-write: never broken')
    const old = new Date(Date.now() - 60_000); utimesSync(mutex, old, old)
    const ok = acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: deadOnly }); assert.equal(ok.ok, true, 'an old corrupt mutex is cleared and the dead holder lock taken over'); assert.ok(holdsLock(lock, ok.nonce))
    rmSync(lock); rmSync(mutex, { force: true }); writeFileSync(lock, JSON.stringify(DEAD)); writeFileSync(mutex, JSON.stringify({ pid: process.pid, start: 'not-my-start', nonce: 'm' }))
    const reused = acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: (h) => (h.start === 'not-my-start' ? false : h.pid !== 999999) }); assert.equal(reused.ok, true, 'the mutex record names a pid+start that is not alive any more: broken by identity')
    // the breaker own mutex record now carries its identity
    let seen = null; rmSync(lock); writeFileSync(lock, JSON.stringify(DEAD)); acquireLock(lock, { execution_id: 'C', acquired_at: 'x', start: 'S1', name: 'node.exe' }, { isHolderAlive: deadOnly, hook: (n) => { if (n === 'mutex_held') seen = JSON.parse(readFileSync(mutex, 'utf8')) } })
    assert.equal(seen.start, 'S1'); assert.equal(seen.name, 'node.exe')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('review M2: breaking a DEAD takeover mutex never displaces a LIVE one — the live mutex is put back untouched and the attempt fails closed', () => {
  const dir = tmp(); const lock = path.join(dir, 'x.lock'); const mutex = `${lock}.takeover`
  try {
    writeFileSync(lock, JSON.stringify(DEAD)); writeFileSync(mutex, JSON.stringify({ pid: 999999, nonce: 'dead-mutex' }))
    const live = JSON.stringify({ pid: process.pid, nonce: 'live-mutex' })
    const r = acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive: (h) => { if (h.nonce === 'dead-mutex') { rmSync(mutex); writeFileSync(mutex, live); return false } return h.pid !== 999999 } }) // a second breaker replaced the dead mutex with its own live one before we moved it
    assert.equal(r.ok, false); assert.equal(r.code, 'LOCK.AMBIGUOUS')
    assert.equal(readFileSync(mutex, 'utf8'), live, "the live breaker's mutex is back at its path")
    assert.deepEqual(readdirSync(dir).filter((n) => /\.dead\./.test(n)), [], 'nothing left behind'); assert.equal(JSON.parse(readFileSync(lock, 'utf8')).nonce, 'deadnonce', 'the lock itself was not touched')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('release and re-check: only the holder\'s own nonce releases; a lock that was replaced is detected before the next irreversible step', () => {
  const dir = tmp(); const lock = path.join(dir, 'x.lock')
  try {
    const a = acquireLock(lock, { execution_id: 'A', acquired_at: 'x' }); assert.ok(a.ok && a.nonce)
    assert.equal(holdsLock(lock, a.nonce), true); assert.equal(holdsLock(lock, 'someone-else'), false)
    assert.equal(releaseLock(lock, { execution_id: 'A', nonce: 'wrong' }).code, 'LOCK.NOT_HOLDER')
    assert.equal(releaseLock(lock, { execution_id: 'B', nonce: a.nonce }).code, 'LOCK.NOT_HOLDER')
    assert.equal(holdsLock(lock, a.nonce), true, 'a foreign release did nothing')
    // the lock is replaced behind the holder's back (a lock helper bug, a deleted file): the holder notices BEFORE doing anything else
    writeFileSync(lock, JSON.stringify({ execution_id: 'Z', pid: process.pid, nonce: 'z' })); assert.equal(holdsLock(lock, a.nonce), false)
    assert.equal(releaseLock(lock, { execution_id: 'A', nonce: a.nonce }).code, 'LOCK.NOT_HOLDER', 'and never removes the replacement')
    assert.ok(existsSync(lock)); rmSync(lock); assert.equal(holdsLock(lock, a.nonce), false, 'a removed lock is a lost lock')
    const b = acquireLock(lock, { execution_id: 'B', acquired_at: 'x' }); assert.ok(b.ok); assert.equal(releaseLock(lock, { execution_id: 'B', nonce: b.nonce }).ok, true); assert.equal(existsSync(lock), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('second-round remediation (strict, used by the host runner): a leftover takeover mutex is NEVER broken — dead breaker, reused pid, old/empty mutex and the replaced-by-a-live-one race all end in LOCK.TAKEOVER_BUSY with the lock and mutex untouched', async () => {
  const { utimesSync } = await import('node:fs'); const dir = tmp(); const lock = path.join(dir, 'x.lock'); const mutex = `${lock}.takeover`
  const strict = (isHolderAlive) => acquireLock(lock, { execution_id: 'C', acquired_at: 'x' }, { isHolderAlive, strict: true })
  try {
    writeFileSync(lock, JSON.stringify(DEAD)); writeFileSync(mutex, JSON.stringify({ pid: 999999, nonce: 'm' }))
    assert.equal(strict(deadOnly).code, 'LOCK.TAKEOVER_BUSY', "a dead breaker's mutex is not cleared by a strict acquirer"); assert.equal(JSON.parse(readFileSync(mutex, 'utf8')).nonce, 'm'); assert.equal(JSON.parse(readFileSync(lock, 'utf8')).nonce, 'deadnonce')
    rmSync(mutex); writeFileSync(mutex, ''); const old = new Date(Date.now() - 60_000); utimesSync(mutex, old, old)
    assert.equal(strict(deadOnly).code, 'LOCK.TAKEOVER_BUSY', 'an old empty mutex is not broken either'); assert.equal(readFileSync(mutex, 'utf8'), '')
    rmSync(mutex); writeFileSync(mutex, JSON.stringify({ pid: process.pid, start: 'not-my-start', nonce: 'm' }))
    assert.equal(strict((h) => (h.start === 'not-my-start' ? false : h.pid !== 999999)).code, 'LOCK.TAKEOVER_BUSY', 'a reused-pid mutex judged dead by identity is still not broken')
    assert.deepEqual(readdirSync(dir).filter((n) => /\.dead\.|stale/.test(n)), [], 'nothing was moved, nothing left behind')
    // an UNCONTENDED takeover of a verifiably dead holder (no mutex in the way) still works: automatic recovery is retained
    rmSync(mutex); const ok = strict(deadOnly); assert.equal(ok.ok, true); assert.ok(holdsLock(lock, ok.nonce)); assert.equal(existsSync(mutex), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
