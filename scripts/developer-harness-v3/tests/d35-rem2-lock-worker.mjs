// D3.5 F3 helper (not a test file): one contender of the stale-lock takeover stress. Runs in a worker thread, waits for each round's start signal and tries to acquire the lock.
import { workerData } from 'node:worker_threads'
import path from 'node:path'
import { acquireLock } from '../lib/atomic.mjs'

const { i, sab, dir } = workerData; const ctl = new Int32Array(sab); const lock = path.join(dir, 'x.lock'); let seen = 0
for (;;) {
  Atomics.wait(ctl, 0, seen); const round = Atomics.load(ctl, 0); if (round === seen) continue; seen = round
  const r = acquireLock(lock, { execution_id: `w${i}-${round}`, acquired_at: 'now' }, { isHolderAlive: (h) => h.pid !== 999999 })
  Atomics.store(ctl, i + 1, r.ok ? 2 : 1)
}
