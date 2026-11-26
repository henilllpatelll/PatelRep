// Developer Harness V3 (D3.6-I) — the deterministic WATCHDOG (D3.5 residual R-20: one never-settling step must not freeze every unrelated task).
//
// What a deadline does:   records a durable `operation_deadlines` row; at the deadline it ABORTS the operation's AbortSignal (cooperative cancellation) and stops WAITING for it.
// What a deadline never does: clear a busy flag as if the work had stopped, release a lease, a work slot, a reservation or a staging hold the operation still owns, or pretend a
//   remote request was cancelled. A timed-out operation is UNRESOLVED: whatever it holds stays held (the caller keeps it in its in-flight sets), its task is excluded from new
//   work, and only the operation's own LATE settlement (recorded as `settled_late`) — or, for a remote effect, an authenticated reconciliation — releases anything.
// A network operation that timed out after it may have been sent leaves its intent UNCERTAIN (intents.mjs); a local step that ignores the signal keeps its slot. Neither is
// "terminated": this module kills nothing (the D3.5 host-runner restriction holds; OS-enforced containment is G-LIVE-RECOVERY-ADAPTERS).
export const WATCHDOG_DEFAULTS = Object.freeze({ circuitThreshold: 3, circuitWindowMs: 30 * 60_000, circuitBaseMs: 5 * 60_000, circuitMaxMs: 2 * 3600_000 })
const TIMEOUT = Symbol('timeout')

function row(L, id, f) { try { L.db.prepare(f.sql).run(...f.args) } catch { /* settlement bookkeeping is best effort: a row left `running` is only ever read as "still in flight" (fail closed); the hold itself lives with the caller */ } void id }

/**
 * Run `fn(signal)` under a real-time deadline. @returns {Promise<{timedOut:false, value:any}|{timedOut:true, settled:Promise<any>}>} (throws what fn throws, if it settles in time)
 */
export async function withDeadline(L, { opId, taskId = null, kind, ms, holds = [] }, fn) {
  const now = L.now()
  // F2: the START record is NOT best effort — the absence rule reads when a request ended, and a request nobody recorded must never be sent (a failure here throws BEFORE `fn` runs)
  L.db.prepare("INSERT OR REPLACE INTO operation_deadlines(op_id,task_id,kind,started_at,deadline_at,state,holds_json) VALUES (?,?,?,?,?,'running',?)").run(opId, taskId, kind, now, now + ms, JSON.stringify(holds))
  const ac = new AbortController(); let timer = null
  const p = Promise.resolve().then(() => fn(ac.signal))
  const late = (state) => row(L, opId, { sql: 'UPDATE operation_deadlines SET state=?, settled_at=? WHERE op_id=?', args: [state, L.now(), opId] })
  const t = new Promise((res) => { timer = setTimeout(() => res(TIMEOUT), ms) }) // referenced on purpose (Node 22 ends the loop on an unref'd-only wait); cleared on settlement
  const r = await Promise.race([p.then((value) => ({ value }), (error) => ({ error })), t])
  if (r === TIMEOUT) {
    ac.abort()
    row(L, opId, { sql: "UPDATE operation_deadlines SET state='unresolved' WHERE op_id=? AND state='running'", args: [opId] })
    const settled = p.then((v) => { late('settled_late'); return v }, (e) => { late('settled_late'); throw e })
    settled.catch(() => {}) // observed by the caller if it cares; never an unhandled rejection
    return { timedOut: true, settled }
  }
  clearTimeout(timer); late('settled')
  if (Object.hasOwn(r, 'error')) throw r.error
  return { timedOut: false, value: r.value }
}
export const unresolvedOperations = (L, taskId = null) => L.db.prepare(`SELECT * FROM operation_deadlines WHERE state='unresolved'${taskId ? ' AND task_id=?' : ''} ORDER BY started_at`).all(...(taskId ? [taskId] : [])).map((r) => ({ ...r, holds: JSON.parse(r.holds_json) }))

// ------------------------------------------------------------------ circuit breaker (persisted in recovery_attempts: survives restarts)
export function circuitOpen(L, scope) {
  const r = L.db.prepare("SELECT circuit, next_at FROM recovery_attempts WHERE scope=? AND incident='watchdog_timeout'").get(scope)
  return !!r && r.circuit === 'open' && r.next_at > L.now() ? { open: true, until: r.next_at } : { open: false }
}
export function noteTimeout(L, scope, cfg = WATCHDOG_DEFAULTS) {
  const now = L.now(); const r = L.db.prepare("SELECT * FROM recovery_attempts WHERE scope=? AND incident='watchdog_timeout'").get(scope)
  const fresh = !r || now - r.first_at > cfg.circuitWindowMs
  const attempts = fresh ? 1 : r.attempts + 1; const open = attempts >= cfg.circuitThreshold
  const next = open ? now + Math.min(cfg.circuitMaxMs, cfg.circuitBaseMs * 2 ** (attempts - cfg.circuitThreshold)) : now
  L.db.prepare("INSERT INTO recovery_attempts(scope,incident,attempts,first_at,last_at,next_at,circuit,last_code) VALUES (?,'watchdog_timeout',?,?,?,?,?,'WATCHDOG.TIMEOUT') ON CONFLICT(scope,incident) DO UPDATE SET attempts=excluded.attempts, first_at=CASE WHEN ? THEN excluded.first_at ELSE first_at END, last_at=excluded.last_at, next_at=excluded.next_at, circuit=excluded.circuit, last_code=excluded.last_code")
    .run(scope, attempts, now, now, next, open ? 'open' : 'closed', fresh ? 1 : 0)
  return { attempts, open, until: next }
}
export const noteHealthy = (L, scope) => L.db.prepare("UPDATE recovery_attempts SET circuit='closed', attempts=0 WHERE scope=? AND incident='watchdog_timeout'").run(scope)
