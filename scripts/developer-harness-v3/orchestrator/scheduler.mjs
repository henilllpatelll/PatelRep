// Developer Harness V3 (D3.5-B) — deterministic, resource-aware task scheduler over the durable ledger. No model is consulted for any decision here.
//
// One ROUND: deliver the outbox → reconcile orphaned leases and work slots (task-scoped) → validate the dependency graph → keep dependency bases honest → rank the runnable
// tasks (owner priority with aging, deterministic tie-break) → admit up to the FREE capacity of each slot kind (reasoning, heavy_test) and a bounded number of deterministic
// steps → run the admitted steps CONCURRENTLY (each through the unchanged engine.advance) → release finished scope claims.
//   * WRITE FOOTPRINTS come from the task's submitted scope (immutable, owner-provided), never from a model's claim that two changes are independent. An unknown, empty or
//     repository-wide footprint conflicts with everything; overlapping footprints or shared mutable resources (migrations are one) SERIALIZE through `scope_claims`.
//   * A claim is taken only when the task's dependencies are satisfied (so a claim is never held while waiting — no claim/dependency deadlock) and is released at the D3.4
//     delivery handoff or cancellation. handoff-ready is NOT completed/merged/deployed: it stays the temporary dependency boundary until D3.6/D3.7 add real delivery states.
//   * Capacity: reasoning = min(free reasoning slots, the Resource Governor's max_reasoning_sessions minus live leases); heavy_test likewise; everything else is admitted by the
//     governor itself inside the stage (memory, disk, pressure, reservations). Backpressure is the governor's `wait`: an admitted step that cannot start moves its task to
//     `waiting_resources`, the others keep going.
//   * FAIRNESS: effective priority = priority − agingStep × ⌊waited / agingMs⌋; a task passed over `maxPassesBeforeReserve` times reserves the next slot of its kind.
import { D33_THRESHOLDS } from '../runtime/resource-governor.mjs'
import { acquireWork, closeWork, liveWork, materializeWork, supersedeWork } from './ledger/slots.mjs'
import { createHash } from 'node:crypto'
import { safeCode, suspendTechnically } from './suspension.mjs'

export const SCHED_DEFAULTS = Object.freeze({ agingMs: 30 * 60_000, agingStep: 10, maxPassesBeforeReserve: 6, maxDeterministicPerRound: 8, heavyReservationMb: 1536, reasoningReservationMb: 768, maxStepExceptions: 3, stepExceptionBackoffMs: 60_000 }) // guest minimums of the D3.3 governor (heavy 1536, reasoning 768)

const WILD = /[*?[{]/
const SEG_SPLIT = (g) => g.toLowerCase().split('/').filter((s) => s !== '')
/** Single-segment wildcard match (case-insensitive, `*` and `?`). */
function segMatch(p, s) {
  let pi = 0; let si = 0; let star = -1; let mark = 0
  while (si < s.length) {
    if (pi < p.length && p[pi] === '*') { star = pi++; mark = si } else if (pi < p.length && (p[pi] === '?' || p[pi] === s[si])) { pi++; si++ } else if (star >= 0) { pi = star + 1; si = ++mark } else return false
  }
  while (pi < p.length && p[pi] === '*') pi++
  return pi === p.length
}
/** CONSERVATIVE overlap of two repository globs: true unless they provably name disjoint paths. A directory and anything below it overlap. */
export function globsOverlap(a, b) {
  const x = SEG_SPLIT(a); const y = SEG_SPLIT(b)
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (x[i] === '**' || y[i] === '**') return true
    const wx = WILD.test(x[i]); const wy = WILD.test(y[i])
    if (wx && wy) continue
    if (wx ? !segMatch(x[i], y[i]) : wy ? !segMatch(y[i], x[i]) : x[i] !== y[i]) return false
  }
  return true
}

const RESOURCE_ID = /^[a-z0-9][a-z0-9:_.-]{0,63}$/
/** The task's WRITE FOOTPRINT, from its submitted (immutable) scope. `known:false` = conflicts with every other task. */
export function footprintOf(task) {
  const sc = task?.scope ?? {}
  const raw = Array.isArray(sc.allowed_paths) ? sc.allowed_paths : null
  const valid = !!raw && raw.length > 0 && raw.length <= 100 && raw.every((g) => typeof g === 'string' && g.length > 0 && g.length <= 200 && !g.startsWith('/') && !g.includes('\\') && !g.split('/').includes('..'))
  const repoWide = valid && raw.some((g) => SEG_SPLIT(g)[0] === '**' || SEG_SPLIT(g)[0] === '*')
  const declared = sc.mutable_resources === undefined ? [] : sc.mutable_resources
  const resOk = Array.isArray(declared) && declared.length <= 20 && declared.every((r) => typeof r === 'string' && RESOURCE_ID.test(r))
  const resources = new Set(resOk ? declared : [])
  if (valid && raw.some((g) => globsOverlap(g, 'supabase/migrations/**'))) resources.add('db:migrations') // a migration is a shared mutable resource whatever the paths say
  return { known: valid && !repoWide && resOk, paths: valid ? [...raw] : [], resources: [...resources].sort() }
}
export function footprintsConflict(a, b) {
  if (!a?.known || !b?.known) return true
  if (a.resources.some((r) => b.resources.includes(r))) return true
  return a.paths.some((p) => b.paths.some((q) => globsOverlap(p, q)))
}

/** Every task id that lies on a dependency cycle (Tarjan SCC; a self-edge counts). The ledger refuses cycles at insert; this detects a tampered or corrupted graph. */
export function cycleMembers(edges) {
  const adj = new Map(); for (const [a, b] of edges) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); if (!adj.has(b)) adj.set(b, []) }
  let index = 0; const idx = new Map(); const low = new Map(); const stack = []; const on = new Set(); const out = new Set()
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index += 1; stack.push(v); on.add(v)
    for (const w of adj.get(v)) { if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))) } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w))) }
    if (low.get(v) === idx.get(v)) { const comp = []; let w; do { w = stack.pop(); on.delete(w); comp.push(w) } while (w !== v); if (comp.length > 1 || adj.get(v).includes(v)) comp.forEach((c) => out.add(c)) }
  }
  for (const v of [...adj.keys()].sort()) if (!idx.has(v)) visit(v)
  return [...out].sort()
}

/** Deterministic rank: lower is earlier. Reserved (starving) tasks first, then effective priority (aging), then age, then id. */
export function rankTasks(rows, { now, passes = {}, cfg = SCHED_DEFAULTS }) {
  const key = (r) => ({ reserved: (passes[r.task_id] ?? 0) >= cfg.maxPassesBeforeReserve ? 0 : 1, eff: r.priority - cfg.agingStep * Math.floor(Math.max(0, now - r.created_at) / cfg.agingMs), created: r.created_at, id: r.task_id })
  return [...rows].map((r) => ({ r, k: key(r) })).sort((p, q) => p.k.reserved - q.k.reserved || p.k.eff - q.k.eff || p.k.created - q.k.created || (p.k.id < q.k.id ? -1 : p.k.id > q.k.id ? 1 : 0)).map((x) => x.r)
}

/**
 * PURE admission plan for one round (also the controlled multi-slot simulation surface). `items` = ranked [{id, kind:'ai'|'heavy'|'det', footprint, needsClaim, claimed}],
 * `claims` = live claims [{task_id, footprint}], `capacity` = {ai, heavy, det}. Returns which items run and why the others do not.
 */
export function planRound({ items, claims, capacity, passes = {}, cfg = SCHED_DEFAULTS }) {
  const left = { ai: capacity.ai, heavy: capacity.heavy, det: capacity.det }; const held = [...claims]; const run = []; const skipped = []; const reservedKinds = new Set()
  for (const it of items) {
    if (it.needsClaim && !it.claimed) {
      const clash = held.find((c) => c.task_id !== it.id && footprintsConflict(c.footprint, it.footprint))
      if (clash) { skipped.push({ id: it.id, reason: 'SCOPE_CONFLICT', with: clash.task_id }); continue }
    }
    if (reservedKinds.has(it.kind)) { skipped.push({ id: it.id, reason: 'SLOT_RESERVED_FOR_STARVING_TASK' }); continue }
    if (left[it.kind] <= 0) { skipped.push({ id: it.id, reason: 'NO_FREE_SLOT' }); if ((passes[it.id] ?? 0) >= cfg.maxPassesBeforeReserve && it.kind !== 'det') reservedKinds.add(it.kind); continue }
    left[it.kind] -= 1
    if (it.needsClaim && !it.claimed) held.push({ task_id: it.id, footprint: it.footprint, new: true })
    run.push({ id: it.id, kind: it.kind, claim: it.needsClaim && !it.claimed })
  }
  return { run, skipped }
}

const AI_STATES = new Set(['planning', 'implementing', 'independent_review', 'security_review'])
const PRE_CLAIM = new Set(['submitted', 'queued', 'dependency_waiting'])

export class Scheduler {
  constructor(engine, cfg = {}) { this.e = engine; this.cfg = { ...SCHED_DEFAULTS, ...cfg }; this.maxConcurrent = 0; this.live = 0 }
  get L() { return this.e.ledger }

  passes() { return Object.fromEntries(this.L.db.prepare('SELECT task_id, passes FROM schedule_state').all().map((r) => [r.task_id, r.passes])) }
  #notePass(id) { const now = this.L.now(); this.L.db.prepare('INSERT INTO schedule_state(task_id,passes,last_considered_at) VALUES (?,1,?) ON CONFLICT(task_id) DO UPDATE SET passes=passes+1, last_considered_at=excluded.last_considered_at').run(id, now) }
  #noteRun(id) { const now = this.L.now(); this.L.db.prepare('INSERT INTO schedule_state(task_id,passes,last_admitted_at) VALUES (?,0,?) ON CONFLICT(task_id) DO UPDATE SET passes=0, last_admitted_at=excluded.last_admitted_at').run(id, now) }
  liveClaims() { return this.L.db.prepare('SELECT task_id, footprint_json FROM scope_claims WHERE released_at IS NULL ORDER BY claimed_at, task_id').all().map((r) => ({ task_id: r.task_id, footprint: JSON.parse(r.footprint_json) })) }
  claimOf(id) { return this.L.db.prepare('SELECT 1 FROM scope_claims WHERE task_id=? AND released_at IS NULL').get(id) !== undefined }
  /** Take a claim atomically: re-checked against the live claims INSIDE the write transaction (no check-then-claim race). */
  claim(id) {
    const L = this.L
    return L.tx(() => {
      if (this.claimOf(id)) return { ok: true, duplicate: true }
      const fp = footprintOf(L.getTask(id))
      const clash = this.liveClaims().find((c) => c.task_id !== id && footprintsConflict(c.footprint, fp))
      if (clash) return { ok: false, code: 'SCOPE_CONFLICT', with: clash.task_id }
      L.db.prepare('INSERT INTO scope_claims(task_id,footprint_json,claimed_at,released_at) VALUES (?,?,?,NULL) ON CONFLICT(task_id) DO UPDATE SET footprint_json=excluded.footprint_json, claimed_at=excluded.claimed_at, released_at=NULL').run(id, JSON.stringify(fp), L.now())
      L.recordRecovery(id, 'scope_claimed', { footprint: fp })
      return { ok: true }
    })
  }
  releaseFinishedClaims() {
    this.L.db.prepare("UPDATE scope_claims SET released_at=? WHERE released_at IS NULL AND task_id IN (SELECT task_id FROM tasks WHERE cancelled=1 OR handoff_ready=1 OR state='completed')").run(this.L.now())
  }

  /** A tampered/corrupted dependency graph with a cycle can never be scheduled: every member becomes ONE explicit owner-level conflict (it cannot resolve itself). */
  checkGraph() {
    const L = this.L
    const edges = L.db.prepare('SELECT d.task_id a, d.depends_on b FROM task_dependencies d JOIN tasks t ON t.task_id=d.task_id WHERE t.cancelled=0').all().map((r) => [r.a, r.b])
    const bad = cycleMembers(edges)
    for (const id of bad) { const t = L.getTask(id); if (t && t.state !== 'blocked' && t.state !== 'completed' && !t.cancelled) this.e.applyWait(id, { kind: 'blocked', reason: 'UNRESOLVABLE_REQUIREMENT_CONFLICT', codes: ['UNRESOLVABLE_REQUIREMENT_CONFLICT:DEPENDENCY_CYCLE'] }) }
    return bad
  }

  /** D3.5 F2: downstream approvals and handoffs follow their dependencies (see dependency-basis.mjs): withdrawn when a dependency's candidate changed, is not ready or was cancelled. */
  checkDependencyBasis() { return this.e.checkDependencyBasis() }

  /** What slot kind the task's NEXT step needs. */
  kindOf(t) {
    if (AI_STATES.has(t.state)) return 'ai'
    if (t.state === 'testing') return 'heavy'
    const target = t.lifecycle.via_remediation ? 'implementing' : t.lifecycle.resume_to
    if (['waiting_resources', 'waiting_subscription', 'waiting_external', 'remediation'].includes(t.state)) return 'det' // resumption is a deterministic check; the resumed stage is scheduled next round
    if (AI_STATES.has(target) && ['worker_recovery', 'context_recovery'].includes(t.state)) return 'det'
    return 'det'
  }
  needsClaim(t) {
    if (['paused', 'blocked', 'technical_suspension'].includes(t.state)) return false // review CR-13: a parked task takes no NEW claim (one it holds is kept)
    if (!PRE_CLAIM.has(t.state)) return true
    if (t.state === 'submitted') return false
    return this.L.openDependencies(t.task_id).length === 0 && this.L.deadDependencies(t.task_id).length === 0 // about to start work: claim now, never while still waiting
  }
  capacity() {
    const L = this.L; const c = L.activeCounts()
    const gov = this.cfg.governor ?? D33_THRESHOLDS
    return { ai: Math.max(0, Math.min(L.freeSlots('reasoning'), gov.max_reasoning_sessions - c.reasoning_sessions)), heavy: Math.max(0, Math.min(L.freeSlots('heavy_test'), gov.max_heavy_test_workloads - c.heavy_test_workloads)), det: this.cfg.maxDeterministicPerRound }
  }

  async round() {
    if (this.e.busy) return { progressed: false, busy: true, ran: [], skipped: [], stuck: [], next_wakeup: this.e.nextWakeup() } // single-flight with engine.tick (review CR-1)
    this.e.busy = true
    try { return await this.#round() } finally { this.e.busy = false }
  }
  async #round() {
    const e = this.e; const L = this.L; const A = e.adapters
    await e.deliverOutbox()
    const stuck = new Set((await e.reconcileOrphans({ reason: 'WORKER_TERMINATED' })).map((s) => s.task_id))
    for (const w of liveWork(L)) { if (e.inflightWork.has(w.work_id)) { stuck.add(w.task_id); continue } let v = null; try { v = await A.tests?.verifyStopped?.(w) } catch { v = null } if (supersedeWork(L, { workId: w.work_id, stopVerified: v?.verified === true }).ok !== true) stuck.add(w.task_id) } // rounds never overlap: a live work lease here is an orphan
    // rounds never overlap: a pre-launch reservation still held here belongs to a round that died with its controller
    for (const r of L.db.prepare("SELECT holder_ref FROM reservations WHERE state='held' AND holder_ref LIKE 'sched-ai:%'").all()) if (!e.inflightHolders.has(r.holder_ref)) L.releaseReservation(r.holder_ref)
    this.checkGraph(); this.checkDependencyBasis(); this.releaseFinishedClaims()
    const now0 = L.now() // a task whose step threw is backed off (persisted), never re-admitted in the same instant
    const rows = L.listTasks("cancelled=0 AND handoff_ready=0 AND state<>'completed'").filter((r) => !stuck.has(r.task_id) && !((this.#stepExc(r.task_id)?.next_at ?? 0) > now0))
    const passes = this.passes()
    const ranked = rankTasks(rows, { now: L.now(), passes, cfg: this.cfg })
    const items = ranked.map((r) => { const t = L.getTask(r.task_id); return { id: r.task_id, kind: this.kindOf(t), footprint: footprintOf(t), needsClaim: this.needsClaim(t), claimed: this.claimOf(r.task_id) } })
    const plan = planRound({ items, claims: this.liveClaims(), capacity: this.capacity(), passes, cfg: this.cfg })
    for (const s of plan.skipped) { this.#notePass(s.id); if (s.reason === 'SCOPE_CONFLICT' && !L.getWait(s.id)) L.setWait(s.id, { kind: 'scope_conflict', reason: 'SCOPE_CONFLICT', detail: { with: s.with } }) }
    const admitted = []
    for (const r of plan.run) {
      if (r.claim) { const c = this.claim(r.id); if (!c.ok) { this.#notePass(r.id); continue } if (L.getWait(r.id)?.kind === 'scope_conflict') L.clearWait(r.id); }
      admitted.push(r)
    }
    // review CR-5: every admitted step's memory is RESERVED before any of them starts, so each admission check (inside the stage) sees the others' promises
    for (const r of admitted) if (r.kind === 'ai' && this.cfg.reasoningReservationMb > 0) { r.holder = `sched-ai:${r.id}:${L.now()}:${Math.random().toString(36).slice(2, 10)}`; L.reserveFor(r.id, r.holder, 'reasoning', { mem_mb: this.cfg.reasoningReservationMb }, { expiresAt: L.now() + e.cfg.leaseTtlMs }) }
    for (const r of admitted) if (r.kind === 'heavy') { const cand = L.currentCandidate(r.id); r.work = acquireWork(L, { taskId: r.id, unitRef: `testing:${cand?.candidate_sha ?? 'none'}`, reservation: { mem_mb: this.cfg.heavyReservationMb } }) }
    // F1 (independent verification): ALL-SETTLED semantics. An unexpected exception in ONE admitted step is isolated to that step (recorded, bounded back-off); the round — and with it
    // the single-flight exclusion, every sibling's reservation and the orphan-reconciliation rules — ends only when EVERY admitted step has settled.
    for (const r of admitted) { if (r.holder) e.inflightHolders.add(r.holder); if (r.work?.ok) e.inflightWork.add(r.work.work.work_id) }
    let results
    try { results = await Promise.all(admitted.map((r) => this.#runStep(r))) } finally {
      for (const r of admitted) { if (r.holder) { e.inflightHolders.delete(r.holder); L.releaseReservation(r.holder) }; if (r.work?.ok) e.inflightWork.delete(r.work.work.work_id) }
    }
    this.releaseFinishedClaims()
    const progressed = results.filter((x) => x.progressed)
    const errors = admitted.map((r, i) => (results[i].error ? { id: r.id, code: results[i].error } : null)).filter(Boolean)
    const wake = [e.nextWakeup(), ...this.#backoffWakeups()].filter((x) => Number.isFinite(x))
    return { progressed: progressed.length > 0, ran: admitted.map((r, i) => ({ id: r.id, kind: r.kind, action: results[i].action ?? null })), errors, skipped: plan.skipped, stuck: [...stuck], next_wakeup: wake.length ? Math.min(...wake) : null }
  }

  /** The step wrapper that NEVER rejects: an unexpected exception becomes a recorded, bounded failure of that one task. */
  async #runStep(r) {
    try { const x = await this.#runOne(r); if (x.progressed) this.L.db.prepare('DELETE FROM meta WHERE key=?').run(`step_exc:${r.id}`); return x } catch (err) { return { progressed: false, error: this.#noteStepException(r.id, err) } }
  }
  #stepExc(id) { try { return JSON.parse(this.L.meta(`step_exc:${id}`) ?? 'null') } catch { return null } }
  #backoffWakeups() { return this.L.db.prepare("SELECT value FROM meta WHERE key LIKE 'step_exc:%'").all().map((r) => { try { return JSON.parse(r.value).next_at } catch { return null } }).filter((x) => Number.isFinite(x) && x > this.L.now()) }
  /** Record the failure (code-shaped only: exception text is untrusted), back off (doubling, persisted) and, past the bound, suspend the task technically and terminally. Never an owner decision. */
  #noteStepException(id, err) {
    const L = this.L; const now = L.now(); const prev = this.#stepExc(id) ?? { n: 0 }; const n = prev.n + 1
    const code = 'SCHEDULER.STEP_EXCEPTION'
    const kind = safeCode(`${err?.name ?? 'Error'}${err?.code ? `:${err.code}` : ''}`)
    try {
      L.tx(() => {
        L.setMeta(`step_exc:${id}`, JSON.stringify({ n, last_at: now, next_at: now + this.cfg.stepExceptionBackoffMs * 2 ** (n - 1) }))
        L.recordRecovery(id, 'scheduler_step_exception', { attempt: n, error: kind, message_digest: createHash('sha256').update(String(err?.message ?? '')).digest('hex').slice(0, 16) })
      })
      if (n >= this.cfg.maxStepExceptions && !L.getSuspension(id)) suspendTechnically(this.e, id, { cause: 'SCHEDULER_STEP_EXCEPTION_REPEATED', stage: L.getTask(id)?.state ?? null, codes: [`SCHEDULER_STEP_EXCEPTION_REPEATED:${kind}`], terminal: true,
        howToResume: 'An admitted step threw an unexpected exception repeatedly (a controller or adapter defect, not a task failure). Fix the defect, then resume the task with the operator resume of the engine (a fresh budget).' })
    } catch { /* the failure record is best effort: the round must still settle and stay exclusive */ }
    return code
  }

  async #runOne(r) {
    const e = this.e; const L = this.L
    this.live += 1; this.maxConcurrent = Math.max(this.maxConcurrent, this.live)
    try {
      if (r.kind !== 'heavy') { const x = await e.advance(r.id); if (x.progressed) this.#noteRun(r.id); return x }
      const t = L.getTask(r.id); const w = r.work
      if (!w?.ok) return { progressed: false }
      e.ownWork.set(r.id, w.work) // materialized by the testing stage only when the run really starts
      let verified = false
      try { const x = await e.advance(r.id); if (x.progressed) this.#noteRun(r.id); return x } finally {
        e.ownWork.delete(r.id)
        try { verified = (await e.adapters.tests?.verifyStopped?.(w.work))?.verified === true } catch { verified = false }
        closeWork(L, w.work, { terminationVerified: verified })
        if (!verified) L.recordRecovery(t.task_id, 'work_termination_unverified', { work_id: w.work.work_id })
      }
    } finally { this.live -= 1 }
  }

  /** Rounds until nothing progresses (bounded). Time-based waits are skipped by the caller advancing the fixture clock. */
  async runUntilIdle({ maxRounds = 500 } = {}) {
    const log = []
    for (let i = 0; i < maxRounds; i += 1) { const r = await this.round(); log.push(r); if (!r.progressed) return { idle: true, rounds: i + 1, log, next_wakeup: r.next_wakeup ?? null } }
    return { idle: false, rounds: maxRounds, log }
  }
}
