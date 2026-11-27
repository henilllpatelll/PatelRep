// Developer Harness V3 (D3.4) — durable execution ledger (core): tasks, lifecycle events, leases/fencing, candidates, checkpoints, reviews.
//
// Every lifecycle mutation goes through the D3.2 reducer UNCHANGED (lifecycle/lifecycle.mjs): the ledger adds durability, a database-enforced
// compare-and-swap and an append-only event log, never different semantics. All time comes from an injected clock (fixture clocks in tests).
// The database is controller-owned state. Nothing read back from it (including checkpoints and model summaries) is authority.
import { DatabaseSync } from 'node:sqlite'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { canonicalize, digestOf, checkShape, isPlainObject, v } from '../../lib/canonical.mjs'
import { applyEvent, createTask, loadLifecycle } from '../../lifecycle/lifecycle.mjs'
import { LEDGER_APPLICATION_ID, MIGRATIONS, SCHEMA_VERSION } from './schema.mjs'

export const MAX_LEDGER_BYTES = 512 * 1024 * 1024
export const MAX_JSON_BYTES = 1024 * 1024
export const MAX_EVENTS_PER_TASK = 20000

const SUBMIT_SPEC = { required: { repository: v.repo, base_sha: v.sha40, requirements: isPlainObject, scope: isPlainObject, acceptance: isPlainObject, risk_class: v.oneOf('routine', 'complex', 'security_sensitive') },
  optional: { task_id: v.id, priority: v.int, security_review_required: v.bool, policy_revision: v.sha64, environment_id: v.id, depends_on: v.arrayOf(v.id, 50),
    dependencies: v.arrayOf((d) => isPlainObject(d) && v.id(d.task_id) && ['locally_verified', 'merged'].includes(d.requires) && Object.keys(d).length === 2, 50) } }

const plain = (r) => (r ? { ...r } : null)
const json = (x) => { const s = canonicalize(x); if (Buffer.byteLength(s) > MAX_JSON_BYTES) throw new Error('LEDGER.JSON_TOO_LARGE'); return s }

export class Ledger {
  #depth = 0
  /**
   * `proposalReducer` (TEST CONFIGURATION ONLY — D3.5-H): a DISPOSABLE patched copy of the lifecycle reducer + contract ({label:'PROPOSAL_UNDER_TEST', applyEvent, createTask, lc}) used to
   * demonstrate a protected lifecycle proposal end to end. It is refused for any ledger that is not in-memory or under the OS temp directory, and such a ledger is marked so it can
   * never be reopened with the authoritative reducer (or vice versa). `ownerActionVerifier(taskId, ownerActionId)` (test configuration too) authenticates owner actions.
   */
  constructor(db, { clock = Date.now, file = null, proposalReducer = null, ownerActionVerifier = null } = {}) {
    this.db = db; this.clock = clock; this.file = file
    if (proposalReducer && (proposalReducer.label !== 'PROPOSAL_UNDER_TEST' || typeof proposalReducer.applyEvent !== 'function' || typeof proposalReducer.createTask !== 'function' || !proposalReducer.lc)) throw new Error('LEDGER.PROPOSAL_REDUCER_INVALID')
    if (proposalReducer && !Ledger.isTempLedgerPath(file)) throw new Error('LEDGER.PROPOSAL_REDUCER_OUTSIDE_TEMP')
    this.reducer = proposalReducer ?? { applyEvent, createTask }; this.lc = proposalReducer?.lc ?? loadLifecycle(); this.proposal = !!proposalReducer; this.ownerActionVerifier = ownerActionVerifier
  }

  /** `migrationHook(version)` runs INSIDE each migration's transaction after its SQL (fault-injection point for the interrupted-migration tests; never set in production). */
  static open(file, { clock = Date.now, maxBytes = MAX_LEDGER_BYTES, migrationHook = null, proposalReducer = null, ownerActionVerifier = null } = {}) {
    if (proposalReducer && !Ledger.isTempLedgerPath(file)) throw new Error('LEDGER.PROPOSAL_REDUCER_OUTSIDE_TEMP') // refused BEFORE anything is created (review CR-7)
    if (file !== ':memory:' && existsSync(file) && statSync(file).size > maxBytes) throw new Error('LEDGER.TOO_LARGE')
    const db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA trusted_schema = OFF;')
    let ledger
    try { ledger = new Ledger(db, { clock, file, proposalReducer, ownerActionVerifier }) } catch (e) { db.close(); throw e }
    try { ledger.#migrate(migrationHook) } catch (e) { db.close(); throw e }
    const mark = ledger.meta('reducer'); const tasks = db.prepare('SELECT COUNT(*) c FROM tasks').get().c
    if (proposalReducer ? (mark !== 'PROPOSAL_UNDER_TEST' && tasks > 0) : mark === 'PROPOSAL_UNDER_TEST') { db.close(); throw new Error('LEDGER.REDUCER_MISMATCH') }
    if (proposalReducer && !mark) ledger.setMeta('reducer', 'PROPOSAL_UNDER_TEST')
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') { db.close(); throw new Error('LEDGER.CORRUPT') }
    return ledger
  }
  /** Read-only view for issuer processes: no migration, no writes (SQLite itself refuses them). The issuer derives its facts from here, not from the request. */
  static openReadOnly(file, { clock = Date.now } = {}) {
    const db = new DatabaseSync(file, { readOnly: true })
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA trusted_schema = OFF;')
    if (db.prepare('PRAGMA application_id').get().application_id !== LEDGER_APPLICATION_ID || db.prepare('PRAGMA user_version').get().user_version > SCHEMA_VERSION) { db.close(); throw new Error('LEDGER.NOT_A_LEDGER') }
    return new Ledger(db, { clock, file })
  }
  close() { this.db.close() }
  /** In-memory, or a file whose (resolved) parent directory is the OS temp directory or inside it (path boundary respected; junctions resolved). */
  static isTempLedgerPath(file) {
    if (file === ':memory:') return true
    if (typeof file !== 'string' || !file) return false // review S-8: no file = unknown = refused
    try { const tmp = realpathSync.native(os.tmpdir()); const dir = realpathSync.native(path.dirname(path.resolve(file))); const rel = path.relative(tmp.toLowerCase(), dir.toLowerCase()); return !rel.startsWith('..') && !path.isAbsolute(rel) } catch { return false }
  }

  #migrate(hook = null) {
    const appId = this.db.prepare('PRAGMA application_id').get().application_id
    const ver = this.db.prepare('PRAGMA user_version').get().user_version
    if (ver > SCHEMA_VERSION) throw new Error('LEDGER.SCHEMA_TOO_NEW')
    if (ver > 0 && appId !== LEDGER_APPLICATION_ID) throw new Error('LEDGER.FOREIGN_DATABASE')
    for (const m of MIGRATIONS) {
      if (m.version <= ver) continue
      this.tx(() => { this.db.exec(m.sql); hook?.(m.version); this.db.exec(`PRAGMA application_id = ${LEDGER_APPLICATION_ID}; PRAGMA user_version = ${m.version}`)
        this.db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run(`migrated_${m.version}`, new Date(this.clock()).toISOString()) })
    }
    this.db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)').run('ledger_id', randomUUID())
  }

  /** BEGIN IMMEDIATE (takes the write lock up front, so check-then-write cannot race another writer). Nested calls become savepoints. */
  tx(fn) {
    if (this.#depth > 0) {
      const sp = `sp${this.#depth}`
      this.db.exec(`SAVEPOINT ${sp}`); this.#depth += 1
      try { const r = fn(); this.db.exec(`RELEASE ${sp}`); return r } catch (e) { this.db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`); throw e } finally { this.#depth -= 1 }
    }
    this.db.exec('BEGIN IMMEDIATE'); this.#depth = 1
    try { const r = fn(); this.db.exec('COMMIT'); return r } catch (e) { try { this.db.exec('ROLLBACK') } catch { /* already rolled back */ } throw e } finally { this.#depth = 0 }
  }
  now() { return this.clock() }
  meta(key) { return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value ?? null }
  setMeta(key, value) { this.db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run(key, String(value)) }

  // ---------------------------------------------------------------- tasks
  /** Idempotent: the same requirements/scope/acceptance on the same base is the same task (submit_key = their digest). */
  submitTask(input) {
    const problems = checkShape(input, SUBMIT_SPEC, 'task')
    if (problems.length) return { ok: false, problems: ['TASK.MALFORMED', ...problems] }
    const identity = { repository: input.repository, base_sha: input.base_sha, requirements: input.requirements, scope: input.scope, acceptance: input.acceptance, risk_class: input.risk_class }
    let submitKey; try { submitKey = digestOf(identity); json(identity) } catch { return { ok: false, problems: ['TASK.UNCANONICAL_OR_TOO_LARGE'] } }
    return this.tx(() => {
      const existing = this.db.prepare('SELECT * FROM tasks WHERE submit_key=?').get(submitKey)
      if (existing) return input.task_id && input.task_id !== existing.task_id ? { ok: false, problems: ['TASK.SUBMIT_KEY_CONFLICT'] } : { ok: true, duplicate: true, task: this.getTask(existing.task_id) }
      const taskId = input.task_id ?? `task-${submitKey.slice(0, 20)}`
      if (this.db.prepare('SELECT 1 FROM tasks WHERE task_id=?').get(taskId)) return { ok: false, problems: ['TASK.ID_CONFLICT'] }
      const lc = this.reducer.createTask({ task_id: taskId, production_required: input.acceptance.production_required !== false, security_review_required: input.security_review_required !== false, policy_revision: input.policy_revision ?? null })
      const now = this.now()
      this.db.prepare(`INSERT INTO tasks(task_id,submit_key,repository,base_sha,requirements_json,requirements_digest,scope_json,acceptance_json,risk_class,priority,lifecycle_json,state,state_revision,fencing_token,head_sha,policy_revision,environment_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId, submitKey, input.repository, input.base_sha, json(input.requirements), digestOf(input.requirements), json(input.scope), json(input.acceptance), input.risk_class,
        input.priority ?? 100, json(lc), lc.state, lc.state_revision, lc.fencing_token, null, input.policy_revision ?? null, input.environment_id ?? null, now, now)
      for (const dep of input.depends_on ?? []) { const r = this.addDependency(taskId, dep); if (!r.ok) throw new Error(r.code) }
      for (const dep of input.dependencies ?? []) { const r = this.addDependency(taskId, dep.task_id, { requires: dep.requires }); if (!r.ok) throw new Error(r.code) }
      return { ok: true, duplicate: false, task: this.getTask(taskId) }
    })
  }

  getTask(taskId) {
    const r = this.db.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId)
    if (!r) return null
    const t = plain(r)
    t.requirements = JSON.parse(t.requirements_json); t.scope = JSON.parse(t.scope_json); t.acceptance = JSON.parse(t.acceptance_json); t.lifecycle = JSON.parse(t.lifecycle_json)
    return t
  }
  listTasks(where = '1=1', ...args) { return this.db.prepare(`SELECT task_id,state,state_revision,fencing_token,priority,cancelled,handoff_ready,head_sha,created_at FROM tasks WHERE ${where} ORDER BY priority, created_at, task_id`).all(...args).map(plain) }

  /** Re-verify that the stored original requirements still match their digest (tamper/corruption check used before every session start). */
  requirementsIntact(taskId) {
    const t = this.getTask(taskId)
    return !!t && digestOf(t.requirements) === t.requirements_digest
  }

  /**
   * Apply a lifecycle event through the D3.2 reducer inside one IMMEDIATE transaction. Stale revision / token / idempotency conflicts are rejected by the reducer
   * (and by the database's UNIQUE (task_id, idempotency_id) for replays older than the reducer's memory window).
   */
  applyLifecycleEvent(taskId, event) {
    return this.tx(() => {
      const row = this.db.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId)
      if (!row) return { ok: false, problems: ['TASK.UNKNOWN'], duplicate: false, invalidated: [] }
      const task = JSON.parse(row.lifecycle_json)
      const prior = isPlainObject(event) && typeof event.idempotency_id === 'string' ? this.db.prepare('SELECT event_digest FROM task_events WHERE task_id=? AND idempotency_id=?').get(taskId, event.idempotency_id) : null
      if (prior) {
        if (event.fencing_token !== task.fencing_token) return { ok: false, problems: ['EVENT.STALE_FENCING_TOKEN'], duplicate: false, invalidated: [] }
        let d; try { d = digestOf(event) } catch { return { ok: false, problems: ['EVENT.MALFORMED'], duplicate: false, invalidated: [] } }
        return d === prior.event_digest ? { ok: true, duplicate: true, problems: [], invalidated: [], task: this.getTask(taskId) } : { ok: false, problems: ['EVENT.IDEMPOTENCY_CONFLICT'], duplicate: false, invalidated: [] }
      }
      if (event?.owner_action_id && this.ownerActionVerifier && this.ownerActionVerifier(taskId, event.owner_action_id) !== true) return { ok: false, problems: ['EVENT.OWNER_ACTION_UNVERIFIED'], duplicate: false, invalidated: [], task: this.getTask(taskId) }
      const r = this.reducer.applyEvent(this.lc, task, event)
      if (!r.ok || r.duplicate) return { ...r, task: this.getTask(taskId) }
      const n = this.db.prepare('SELECT COUNT(*) c FROM task_events WHERE task_id=?').get(taskId).c
      if (n >= MAX_EVENTS_PER_TASK) throw new Error('LEDGER.EVENT_LOG_FULL')
      const now = this.now(); const t = r.task
      // Database-level CAS: the row must still be at the revision the reducer judged.
      const upd = this.db.prepare('UPDATE tasks SET lifecycle_json=?, state=?, state_revision=?, fencing_token=?, head_sha=?, policy_revision=?, updated_at=? WHERE task_id=? AND state_revision=?')
        .run(json(t), t.state, t.state_revision, t.fencing_token, t.head_sha, t.policy_revision, now, taskId, task.state_revision)
      if (upd.changes !== 1) throw new Error('LEDGER.CAS_FAILED')
      this.db.prepare('INSERT INTO task_events(task_id,idempotency_id,event_digest,event_json,from_state,to_state,resulting_revision,at) VALUES (?,?,?,?,?,?,?,?)')
        .run(taskId, event.idempotency_id, digestOf(event), json(event), task.state, t.state, t.state_revision, now)
      if (r.invalidated.length) this.#invalidateEvidence(taskId, r.invalidated, now)
      return { ...r, task: this.getTask(taskId) }
    })
  }

  /** Withdraw EVERY accepted approval of a task and the review rows they rest on (a changed dependency basis: nothing obtained under the old basis may be re-attested). */
  withdrawApprovals(taskId) { this.tx(() => { this.db.prepare('UPDATE evidence SET invalidated_at=? WHERE task_id=? AND invalidated_at IS NULL').run(this.now(), taskId); this.db.prepare("UPDATE reviews SET status='invalidated' WHERE task_id=? AND status IN ('open','submitted','verified_pass')").run(taskId) }) }

  /** Withdraw ONE accepted approval (e.g. a completeness gate refused the candidate the approval was issued for). */
  invalidateEvidence(evidenceId) { this.db.prepare('UPDATE evidence SET invalidated_at=? WHERE evidence_id=? AND invalidated_at IS NULL').run(this.now(), evidenceId) }

  #invalidateEvidence(taskId, types, now) {
    if (types.includes('*')) this.db.prepare('UPDATE evidence SET invalidated_at=? WHERE task_id=? AND invalidated_at IS NULL').run(now, taskId)
    else for (const t of types) this.db.prepare('UPDATE evidence SET invalidated_at=? WHERE task_id=? AND evidence_type=? AND invalidated_at IS NULL').run(now, taskId, t)
    this.db.prepare("UPDATE reviews SET status='invalidated' WHERE task_id=? AND status IN ('open','submitted','verified_pass')").run(taskId)
  }

  /** Convenience for deterministic engine steps: build a well-formed event from the CURRENT revision/token. */
  eventFor(taskId, kind, fields = {}) {
    const t = this.getTask(taskId)
    return { event_id: `e-${randomUUID()}`, idempotency_id: fields.idempotency_id ?? `i-${randomUUID()}`, task_id: taskId, kind, expected_revision: t.state_revision, fencing_token: t.fencing_token, ...fields }
  }
  transition(taskId, to, fields = {}) { return this.applyLifecycleEvent(taskId, this.eventFor(taskId, 'transition', { to, ...fields })) }

  /** Record a new candidate and apply head_changed in ONE transaction: a candidate without its invalidation (or vice versa) can never exist. */
  submitCandidate(taskId, { base_sha, candidate_sha, tree_digest, patch_digest, snapshot_ref = null }) {
    if (!v.sha40(base_sha) || !v.sha40(candidate_sha) || !v.sha40(tree_digest) || !v.sha64(patch_digest)) return { ok: false, problems: ['CANDIDATE.MALFORMED'] }
    return this.tx(() => {
      const t = this.getTask(taskId)
      if (!t) return { ok: false, problems: ['TASK.UNKNOWN'] }
      if (base_sha !== this.currentBase(taskId)) return { ok: false, problems: ['CANDIDATE.WRONG_BASE'] } // D3.6: the CURRENT delivery base (generation 0 = the submitted base)
      const now = this.now()
      const same = this.db.prepare('SELECT 1 FROM candidates WHERE task_id=? AND candidate_sha=? AND tree_digest=?').get(taskId, candidate_sha, tree_digest)
      const r = this.applyLifecycleEvent(taskId, this.eventFor(taskId, 'head_changed', { head_sha: candidate_sha }))
      if (!r.ok) return r
      if (!same) {
        this.db.prepare('UPDATE candidates SET superseded=1 WHERE task_id=?').run(taskId)
        this.db.prepare('INSERT INTO candidates(task_id,base_sha,candidate_sha,tree_digest,patch_digest,snapshot_ref,created_at) VALUES (?,?,?,?,?,?,?)').run(taskId, base_sha, candidate_sha, tree_digest, patch_digest, snapshot_ref, now)
      } else this.db.prepare('UPDATE candidates SET superseded=CASE WHEN candidate_sha=? AND tree_digest=? THEN 0 ELSE 1 END WHERE task_id=?').run(candidate_sha, tree_digest, taskId)
      return { ok: true, task: this.getTask(taskId), invalidated: r.invalidated }
    })
  }
  currentCandidate(taskId) { return plain(this.db.prepare('SELECT * FROM candidates WHERE task_id=? AND superseded=0 ORDER BY candidate_id DESC LIMIT 1').get(taskId)) }
  /**
   * D3.6: the base the task's candidates are CURRENTLY built and verified on. The submitted base is immutable task identity (and stays the AUTHORITY base inside `authorityOf`); a delivery
   * base update (main advanced) records a new generation here, and from then on candidates, evidence bindings and issuers use it. Generation 0 = the submitted base.
   */
  currentBase(taskId) { const d = this.db.prepare('SELECT base_sha FROM deliveries WHERE task_id=?').get(taskId); return d?.base_sha ?? this.db.prepare('SELECT base_sha FROM tasks WHERE task_id=?').get(taskId)?.base_sha ?? null }
  delivery(taskId) { return plain(this.db.prepare('SELECT * FROM deliveries WHERE task_id=?').get(taskId)) }

  // ---------------------------------------------------------------- pause / resume / cancel / dependencies
  pause(taskId) { return this.transition(taskId, 'paused', { reason_code: 'OWNER_PAUSED' }) }
  /** Where a waiting/paused/blocked task goes next: the reducer's own rule (a wait that began as remediation can only return to `implementing`). */
  resumeTarget(taskId) { const t = this.getTask(taskId); return t.lifecycle.via_remediation ? 'implementing' : t.lifecycle.resume_to }
  resume(taskId) { const t = this.getTask(taskId); if (t.cancelled) return { ok: false, problems: ['TASK.CANCELLED'] }; return this.transition(taskId, this.resumeTarget(taskId)) }
  /** `cancelled` is a ledger flag + a pause: the D3.2 lifecycle has no terminal `cancelled` state (proposal in docs 21). A cancelled task is never scheduled, never completed. */
  cancel(taskId, { ownerActionId = null } = {}) {
    return this.tx(() => {
      const t = this.getTask(taskId)
      if (!t) return { ok: false, problems: ['TASK.UNKNOWN'] }
      if (t.state === 'completed') return { ok: false, problems: ['TASK.ALREADY_COMPLETED'] }
      if (this.lc.terminal_states?.includes('cancelled')) { // a lifecycle WITH explicit cancellation (proposal P6): a terminal, owner-only transition
        if (!ownerActionId) return { ok: false, problems: ['TASK.OWNER_ACTION_REQUIRED'] }
        const r = this.transition(taskId, 'cancelled', { owner_action_id: ownerActionId }); if (!r.ok) return r
        this.db.prepare('UPDATE tasks SET cancelled=1, updated_at=? WHERE task_id=?').run(this.now(), taskId)
        return { ok: true, task: this.getTask(taskId) }
      }
      this.db.prepare('UPDATE tasks SET cancelled=1, updated_at=? WHERE task_id=?').run(this.now(), taskId)
      if (t.state !== 'paused') { const r = this.pause(taskId); if (!r.ok && !r.problems.includes('TRANSITION.ILLEGAL')) throw new Error(r.problems[0]) }
      return { ok: true, task: this.getTask(taskId) }
    })
  }
  addDependency(taskId, dependsOn, { requires = 'locally_verified' } = {}) {
    return this.tx(() => {
      if (taskId === dependsOn) return { ok: false, code: 'DEPENDENCY.SELF' }
      if (!['locally_verified', 'merged'].includes(requires)) return { ok: false, code: 'DEPENDENCY.UNKNOWN_REQUIREMENT' }
      if (!this.getTask(taskId) || !this.getTask(dependsOn)) return { ok: false, code: 'DEPENDENCY.UNKNOWN_TASK' }
      // cycle: can dependsOn already reach taskId?
      const seen = new Set(); const stack = [dependsOn]
      while (stack.length) { const x = stack.pop(); if (x === taskId) return { ok: false, code: 'DEPENDENCY.CYCLE' }; if (seen.has(x)) continue; seen.add(x); for (const d of this.db.prepare('SELECT depends_on FROM task_dependencies WHERE task_id=?').all(x)) stack.push(d.depends_on) }
      const prior = this.db.prepare('SELECT requires FROM task_dependencies WHERE task_id=? AND depends_on=?').get(taskId, dependsOn)
      if (prior && prior.requires !== requires) return { ok: false, code: 'DEPENDENCY.REQUIREMENT_CONFLICT' } // a requirement is never silently weakened or strengthened
      this.db.prepare('INSERT OR IGNORE INTO task_dependencies(task_id,depends_on,requires) VALUES (?,?,?)').run(taskId, dependsOn, requires)
      return { ok: true }
    })
  }
  /**
   * D3.6 explicit milestones. `locally_verified` (the D3.4/D3.5 boundary, an ORDERING dependency: the dependent's worktree is built on its own base and does NOT contain the upstream code) is
   * satisfied by a verified local handoff or completion. `merged` (a CODE dependency) is satisfied ONLY by an authenticated merge milestone — which D3.6 can never record (D3.7 supplies merge
   * evidence; the schema refuses a `merged` milestone), so such a dependent stays waiting: tasks with a code dependency are SERIALIZED, never built on an unmerged upstream candidate.
   */
  openDependencies(taskId) {
    return this.db.prepare(`SELECT d.depends_on id FROM task_dependencies d JOIN tasks t ON t.task_id=d.depends_on WHERE d.task_id=? AND t.cancelled=0 AND (
      (d.requires='locally_verified' AND t.state<>'completed' AND t.handoff_ready=0) OR
      (d.requires='merged' AND NOT EXISTS (SELECT 1 FROM delivery_milestones m WHERE m.task_id=t.task_id AND m.milestone='merged' AND m.invalidated_at IS NULL)))`).all(taskId).map((r) => r.id)
  }
  deadDependencies(taskId) { return this.db.prepare('SELECT d.depends_on id FROM task_dependencies d JOIN tasks t ON t.task_id=d.depends_on WHERE d.task_id=? AND t.cancelled=1').all(taskId).map((r) => r.id) }

  // ---------------------------------------------------------------- executions and leases
  /**
   * Admit ONE reasoning session into a free SLOT: creates the execution record, the lease and (optionally) its resource reservation in one IMMEDIATE transaction.
   * The database is the arbiter: one live lease per slot (V1 `one_reasoning_slot`), one live lease per task and the slot range (V3). With the default capacity of 1 this is
   * exactly the D3.4 global single slot (same refusal codes). A lease whose session could not be proven dead (`termination_unverified`) keeps its slot until recovery verifies cleanup.
   */
  acquireLease({ taskId, role, stage, model, effort, ttlMs = 10 * 60000, contextId = `ctx-${randomUUID()}`, reservation = null }) {
    return this.tx(() => {
      const t = this.getTask(taskId)
      if (!t) return { ok: false, code: 'TASK.UNKNOWN' }
      if (t.cancelled) return { ok: false, code: 'TASK.CANCELLED' }
      const live = this.liveLeases(); const used = new Set(live.map((l) => l.reasoning_slot)); const cap = this.slotCapacity('reasoning')
      let slot = null
      for (let s = 1; s <= cap; s += 1) if (!used.has(s)) { slot = s; break }
      if (slot === null) { const h = live.find((l) => l.state === 'termination_unverified') ?? live[0]; return { ok: false, code: h.state === 'termination_unverified' ? 'LEASE.SLOT_HELD_TERMINATION_UNVERIFIED' : 'LEASE.SLOT_BUSY', holder: plain(h) } }
      const mine = live.find((l) => l.task_id === taskId)
      if (mine) return { ok: false, code: mine.state === 'termination_unverified' ? 'LEASE.TASK_TERMINATION_UNVERIFIED' : 'LEASE.TASK_ALREADY_LEASED', holder: plain(mine) }
      const now = this.now()
      const ordinal = this.db.prepare('SELECT COALESCE(MAX(ordinal),0)+1 n FROM executions WHERE task_id=?').get(taskId).n
      const executionId = `x-${randomUUID()}`; const leaseId = `l-${randomUUID()}`
      this.db.prepare('INSERT INTO executions(execution_id,task_id,role,stage,context_id,ordinal,model_requested,effort_requested,status,fencing_token,started_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(executionId, taskId, role, stage, contextId, ordinal, model, effort, 'starting', t.fencing_token, now)
      this.db.prepare('INSERT INTO leases(lease_id,task_id,execution_id,fencing_token,state,reasoning_slot,issued_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(leaseId, taskId, executionId, t.fencing_token, 'active', slot, now, now + ttlMs)
      if (reservation) this.#reserve(taskId, leaseId, 'reasoning', reservation, t.fencing_token, now)
      return { ok: true, lease: { lease_id: leaseId, task_id: taskId, execution_id: executionId, context_id: contextId, fencing_token: t.fencing_token, expires_at: now + ttlMs, slot } }
    })
  }

  // ---------------------------------------------------------------- slots, live leases, reservations (D3.5-A)
  slotCapacity(kind = 'reasoning') { return this.db.prepare('SELECT capacity FROM slot_config WHERE kind=?').get(kind)?.capacity ?? 1 }
  /** Change a slot capacity. WHAT capacity is permitted is the engine's decision (the contract default is 1); the database only refuses to shrink under a live lease. */
  setSlotCapacity(kind, capacity, basis) { this.db.prepare('UPDATE slot_config SET capacity=?, basis=?, updated_at=? WHERE kind=?').run(capacity, String(basis).slice(0, 200), this.now(), kind) }
  /** Every lease occupying a reasoning slot (active or termination-unverified), in slot order. */
  liveLeases() { return this.db.prepare("SELECT * FROM leases WHERE state IN ('active','termination_unverified') ORDER BY reasoning_slot, issued_at").all().map(plain) }
  leaseOfTask(taskId) { return plain(this.db.prepare("SELECT * FROM leases WHERE task_id=? AND state IN ('active','termination_unverified')").get(taskId)) }
  liveLeaseOfExecution(executionId) { return plain(this.db.prepare("SELECT * FROM leases WHERE execution_id=? AND state IN ('active','termination_unverified')").get(executionId)) }
  freeSlots(kind = 'reasoning') {
    const live = kind === 'reasoning' ? this.liveLeases().length : this.db.prepare("SELECT COUNT(*) c FROM work_leases WHERE kind=? AND state IN ('active','termination_unverified')").get(kind).c
    return Math.max(0, this.slotCapacity(kind) - live)
  }
  /** Active counts for the Resource Governor, DERIVED FROM DURABLE LEASES (a lease that is termination-unverified still counts: its workload may still be running). */
  activeCounts({ excludeLeaseId = null, excludeWorkId = null } = {}) {
    return { reasoning_sessions: this.db.prepare("SELECT COUNT(*) c FROM leases WHERE state IN ('active','termination_unverified') AND lease_id IS NOT ?").get(excludeLeaseId).c,
      heavy_test_workloads: this.db.prepare("SELECT COUNT(*) c FROM work_leases WHERE kind='heavy_test' AND state IN ('active','termination_unverified') AND work_id IS NOT ?").get(excludeWorkId).c }
  }
  #reserve(taskId, holderRef, profile, r, token, now, expiresAt = null) {
    const mem = r.mem_mb ?? 0; const disk = r.disk_mb ?? 0
    if (!Number.isSafeInteger(mem) || !Number.isSafeInteger(disk)) throw new Error('LEDGER.RESERVATION_MALFORMED')
    this.db.prepare('INSERT INTO reservations(reservation_id,task_id,holder_ref,profile,mem_mb,disk_mb,fencing_token,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(`rs-${randomUUID()}`, taskId, holderRef, profile, mem, disk, token, 'held', expiresAt, now)
  }
  /** A reservation not tied to a lease/work slot (the scheduler's pre-launch promise) must carry its own expiry, or it never counts (review S-1). */
  reserveFor(taskId, holderRef, profile, r, { expiresAt = null } = {}) { const t = this.getTask(taskId); this.#reserve(taskId, holderRef, profile, r, t.fencing_token, this.now(), expiresAt) }
  releaseReservation(holderRef) { this.db.prepare("UPDATE reservations SET state='released', released_at=? WHERE holder_ref=? AND state<>'released'").run(this.now(), holderRef) }
  /** Memory promised to workloads that have NOT materialized yet, in the governor's reservation shape (it expires with its slot). `excludeHolder` = the asker's own reservation. */
  pendingReservations({ excludeHolder = null, excludeTask = null } = {}) {
    // expiry: the reservation's own, else its slot's — and a slot whose termination is UNVERIFIED keeps counting whatever its lease expiry says (review S-1)
    return this.db.prepare(`SELECT r.holder_ref, r.task_id, r.mem_mb, CASE WHEN l.state='termination_unverified' OR w.state='termination_unverified' THEN 8640000000000000 ELSE COALESCE(r.expires_at, l.expires_at, w.expires_at, 0) END exp FROM reservations r LEFT JOIN leases l ON l.lease_id=r.holder_ref LEFT JOIN work_leases w ON w.work_id=r.holder_ref
      WHERE r.state='held' AND r.holder_ref IS NOT ? AND r.task_id IS NOT ?`).all(excludeHolder, excludeTask).map((r) => ({ id: r.holder_ref, task_id: r.task_id, mb: r.mem_mb, materialized: false, expires_at: new Date(r.exp).toISOString() }))
  }
  reservationOf(holderRef) { return plain(this.db.prepare('SELECT * FROM reservations WHERE holder_ref=?').get(holderRef)) }
  /** @returns {string|null} a LEASE.* code when the presented lease is not the CURRENT, unexpired, same-token lease; null when valid. */
  checkLease(presented) {
    const l = this.db.prepare("SELECT l.*, t.fencing_token task_token FROM leases l JOIN tasks t ON t.task_id=l.task_id WHERE l.lease_id=?").get(presented?.lease_id ?? '')
    if (!l) return 'LEASE.NONE'
    if (l.state !== 'active') return 'LEASE.NOT_ACTIVE'
    if (presented.execution_id !== l.execution_id) return 'LEASE.STALE_IDENTITY'
    if (presented.fencing_token !== l.fencing_token || l.fencing_token !== l.task_token) return 'LEASE.STALE_FENCING_TOKEN'
    if (l.expires_at <= this.now()) return 'LEASE.EXPIRED'
    return null
  }
  renewLease(presented, ttlMs = 10 * 60000) {
    return this.tx(() => {
      const code = this.checkLease(presented)
      if (code) return { ok: false, code }
      this.db.prepare("UPDATE leases SET expires_at=? WHERE lease_id=? AND state='active'").run(this.now() + ttlMs, presented.lease_id)
      return { ok: true }
    })
  }
  markExecutionRunning(executionId) {
    this.db.prepare("UPDATE executions SET status='running' WHERE execution_id=? AND status='starting'").run(executionId)
    this.db.prepare("UPDATE reservations SET state='materialized' WHERE state='held' AND holder_ref=(SELECT lease_id FROM leases WHERE execution_id=?)").run(executionId) // now visible in the host measurements: no longer subtracted twice
  }
  recordTelemetry(executionId, { model_actual = null, cli_version = null, context_window = null, turns = 0, telemetry = {} }) {
    this.db.prepare('UPDATE executions SET model_actual=?, cli_version=?, context_window=?, turns=?, telemetry_json=? WHERE execution_id=?').run(model_actual, cli_version, context_window, turns, json(telemetry), executionId)
  }
  getExecution(executionId) { return plain(this.db.prepare('SELECT * FROM executions WHERE execution_id=?').get(executionId)) }
  /** Close a lease. The slot is released ONLY when termination was independently verified; otherwise the lease holds the slot (no second session). */
  closeLease(presented, { terminationVerified, endReason, alsoOnVerified = null }) {
    return this.tx(() => {
      const l = this.db.prepare('SELECT * FROM leases WHERE lease_id=?').get(presented?.lease_id ?? '')
      if (!l || l.execution_id !== presented.execution_id) return { ok: false, code: 'LEASE.STALE_IDENTITY' }
      if (l.state !== 'active' && l.state !== 'termination_unverified') return { ok: true, duplicate: true }
      const now = this.now()
      if (terminationVerified === true) {
        this.db.prepare("UPDATE leases SET state='released', closed_at=? WHERE lease_id=?").run(now, l.lease_id)
        this.releaseReservation(l.lease_id) // only a VERIFIED stop frees the memory it was promised; an unverified one keeps it reserved with the slot
        this.db.prepare("UPDATE executions SET status='terminated_verified', end_reason=?, ended_at=? WHERE execution_id=?").run(endReason, now, l.execution_id)
        if (alsoOnVerified) alsoOnVerified() // same transaction: the release and whatever must be durable WITH it either both happen or neither does
      } else {
        this.db.prepare("UPDATE leases SET state='termination_unverified' WHERE lease_id=?").run(l.lease_id)
        this.db.prepare("UPDATE executions SET status='termination_unverified', end_reason=?, ended_at=? WHERE execution_id=?").run(endReason, now, l.execution_id)
      }
      return { ok: true, released: terminationVerified === true }
    })
  }
  /** The FIRST lease (lowest slot) occupying a reasoning slot, if any. With the default capacity of 1 this is "the" slot holder of D3.4; multi-slot callers use liveLeases/leaseOfTask. */
  slotHolder() { return this.liveLeases()[0] ?? null }

  /**
   * Recovery: supersede a lease that is expired, orphaned (controller restarted) or termination-unverified. Requires VERIFIED guest cleanup; otherwise nothing
   * changes and the slot stays held. On success the task's fencing token advances by exactly one via the reducer's `worker_recovered`.
   * `leaseId` names the lease (task-scoped recovery). Without it the single live lease is meant; with several live leases an unnamed supersession is REFUSED (never guess whose).
   */
  supersedeLease({ guestCleanupVerified, reason = 'HOST_RESTARTED', alsoOnSuperseded = null, leaseId = null }) {
    return this.tx(() => {
      const live = this.liveLeases()
      if (!leaseId && live.length > 1) return { ok: false, code: 'RECOVERY.LEASE_REQUIRED' }
      const l = leaseId ? live.find((x) => x.lease_id === leaseId) : live[0]
      if (!l) return { ok: true, none: true }
      if (guestCleanupVerified !== true) return { ok: false, code: 'RECOVERY.CLEANUP_UNVERIFIED', lease_id: l.lease_id }
      const t = this.getTask(l.task_id); const now = this.now()
      this.db.prepare("UPDATE leases SET state='superseded', closed_at=? WHERE lease_id=?").run(now, l.lease_id)
      this.releaseReservation(l.lease_id)
      this.db.prepare("UPDATE executions SET status='abandoned', ended_at=COALESCE(ended_at,?), end_reason=COALESCE(end_reason,?) WHERE execution_id=?").run(now, reason, l.execution_id)
      const r = this.applyLifecycleEvent(l.task_id, this.eventFor(l.task_id, 'worker_recovered', { idempotency_id: `recover-${l.lease_id}`, reason_code: reason, new_fencing_token: t.fencing_token + 1 }))
      if (!r.ok) throw new Error(r.problems[0])
      this.db.prepare('INSERT INTO recovery_history(task_id,kind,detail_json,at) VALUES (?,?,?,?)').run(l.task_id, 'lease_superseded', json({ lease_id: l.lease_id, reason, new_token: t.fencing_token + 1 }), now)
      // same transaction: whatever must be durable WITH the supersession (the recovery checkpoint of the dead session's work) either commits together with it or not at all
      const extra = alsoOnSuperseded ? alsoOnSuperseded({ task_id: l.task_id, new_fencing_token: t.fencing_token + 1 }) : null
      return { ok: true, extra, task_id: l.task_id, new_fencing_token: t.fencing_token + 1, superseded_lease: l.lease_id }
    })
  }
  recordRecovery(taskId, kind, detail) { this.db.prepare('INSERT INTO recovery_history(task_id,kind,detail_json,at) VALUES (?,?,?,?)').run(taskId, kind, json(detail), this.now()) }
  recoveryHistory(taskId) { return this.db.prepare('SELECT kind, detail_json, at FROM recovery_history WHERE task_id IS ? ORDER BY recovery_id').all(taskId).map((r) => ({ kind: r.kind, at: r.at, detail: JSON.parse(r.detail_json) })) }

  // ---------------------------------------------------------------- plans, checkpoints, resources, waits
  savePlan(taskId, plan) {
    return this.tx(() => {
      const ver = this.db.prepare('SELECT COALESCE(MAX(plan_version),0)+1 n FROM plans WHERE task_id=?').get(taskId).n; const now = this.now()
      this.db.prepare('INSERT INTO plans(task_id,plan_version,plan_digest,plan_json,created_at) VALUES (?,?,?,?,?)').run(taskId, ver, digestOf(plan), json(plan), now)
      plan.steps.forEach((s, i) => this.db.prepare('INSERT INTO plan_steps(task_id,plan_version,step_id,ordinal,title,depends_on_json,status,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(taskId, ver, s.id, i, s.title, json(s.depends_on ?? []), 'pending', now))
      return ver
    })
  }
  currentPlan(taskId) {
    const p = this.db.prepare('SELECT * FROM plans WHERE task_id=? ORDER BY plan_version DESC LIMIT 1').get(taskId)
    if (!p) return null
    const steps = this.db.prepare('SELECT step_id id, title, status, depends_on_json FROM plan_steps WHERE task_id=? AND plan_version=? ORDER BY ordinal').all(taskId, p.plan_version).map((s) => ({ id: s.id, title: s.title, status: s.status, depends_on: JSON.parse(s.depends_on_json) }))
    return { version: p.plan_version, digest: p.plan_digest, plan: JSON.parse(p.plan_json), steps }
  }
  setStepStatus(taskId, planVersion, stepId, status) { this.db.prepare('UPDATE plan_steps SET status=?, updated_at=? WHERE task_id=? AND plan_version=? AND step_id=?').run(status, this.now(), taskId, planVersion, stepId) }
  remainingSteps(taskId) { const p = this.currentPlan(taskId); return p ? p.steps.filter((s) => s.status !== 'done' && s.status !== 'abandoned') : [] }

  recordCheckpoint(taskId, { reason, payload, snapshot_ref = null, snapshot_digest = null }) {
    return this.tx(() => {
      const t = this.getTask(taskId); const seq = this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 n FROM checkpoints WHERE task_id=?').get(taskId).n
      const id = `cp-${taskId}-${seq}`
      this.db.prepare('INSERT INTO checkpoints(checkpoint_id,task_id,seq,reason,payload_json,payload_digest,requirements_digest,head_sha,snapshot_ref,snapshot_digest,verified,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)')
        .run(id, taskId, seq, reason, json(payload), digestOf(payload), t.requirements_digest, t.head_sha, snapshot_ref, snapshot_digest, this.now())
      return id
    })
  }
  markCheckpointVerified(checkpointId) { this.db.prepare('UPDATE checkpoints SET verified=1 WHERE checkpoint_id=?').run(checkpointId) }
  getCheckpoint(id) { const r = this.db.prepare('SELECT * FROM checkpoints WHERE checkpoint_id=?').get(id); return r ? { ...plain(r), payload: JSON.parse(r.payload_json) } : null }
  latestCheckpoint(taskId, { verifiedOnly = true } = {}) {
    const r = this.db.prepare(`SELECT * FROM checkpoints WHERE task_id=? ${verifiedOnly ? 'AND verified=1' : ''} ORDER BY seq DESC LIMIT 1`).get(taskId)
    return r ? { ...plain(r), payload: JSON.parse(r.payload_json) } : null
  }

  registerResource(taskId, { id, kind, lifecycle = 'running', detail = {} }) { this.db.prepare('INSERT INTO resources(resource_id,task_id,kind,lifecycle,detail_json,registered_at) VALUES (?,?,?,?,?,?)').run(id, taskId, kind, lifecycle, json(detail), this.now()) }
  setResourceLifecycle(id, lifecycle) { this.db.prepare('UPDATE resources SET lifecycle=? WHERE resource_id=?').run(lifecycle, id) }
  taskResources(taskId) { return this.db.prepare('SELECT * FROM resources WHERE task_id=?').all(taskId).map(plain) }

  setWait(taskId, { kind, reason, eligibleAt = null, detail = {} }) { this.db.prepare('INSERT OR REPLACE INTO waits(task_id,kind,reason,since,eligible_at,detail_json) VALUES (?,?,?,?,?,?)').run(taskId, kind, reason, this.now(), eligibleAt, json(detail)) }
  clearWait(taskId) { this.db.prepare('DELETE FROM waits WHERE task_id=?').run(taskId) }
  getWait(taskId) { const w = this.db.prepare('SELECT * FROM waits WHERE task_id=?').get(taskId); return w ? { ...plain(w), detail: JSON.parse(w.detail_json) } : null }

  // ---------------------------------------------------------------- technical suspensions (F5)
  getSuspension(taskId) { const r = this.db.prepare('SELECT * FROM suspensions WHERE task_id=?').get(taskId); return r ? { ...plain(r), diagnostics: JSON.parse(r.diagnostics_json) } : null }
  setSuspension(taskId, { epoch, disposition, cause, stage = null, retryAt = null, diagnostics = {} }) {
    this.db.prepare('INSERT OR REPLACE INTO suspensions(task_id,epoch,disposition,cause,stage,since,retry_at,diagnostics_json) VALUES (?,?,?,?,?,?,?,?)').run(taskId, epoch, disposition, cause, stage, this.now(), retryAt, json(diagnostics))
  }
  clearSuspension(taskId) { this.db.prepare('DELETE FROM suspensions WHERE task_id=?').run(taskId) }

  // ---------------------------------------------------------------- reviewer deliverables and acceptance coverage (F6, F4)
  saveReviewDeliverable(reviewId, { task_id, candidate_sha, tree_digest, execution_id, context_id, deliverable }) {
    this.db.prepare('INSERT OR REPLACE INTO review_deliverables(review_id,task_id,candidate_sha,tree_digest,execution_id,context_id,deliverable_json,persisted_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(reviewId, task_id, candidate_sha, tree_digest, execution_id, context_id, json(JSON.parse(JSON.stringify(deliverable ?? null))), this.now()) // JSON round-trip: `undefined` members are dropped, exactly as the wire format would
  }
  getReviewDeliverable(reviewId) { return plain(this.db.prepare('SELECT * FROM review_deliverables WHERE review_id=?').get(reviewId)) }
  deleteReviewDeliverable(reviewId) { this.db.prepare('DELETE FROM review_deliverables WHERE review_id=?').run(reviewId) }
  addCoverage(reviewId, taskId, candidateSha, rows) {
    for (const r of rows) this.db.prepare('INSERT OR REPLACE INTO coverage(review_id,task_id,candidate_sha,subject_type,subject_ref,status,evidence) VALUES (?,?,?,?,?,?,?)').run(reviewId, taskId, candidateSha, r.type, String(r.ref), r.status, String(r.evidence ?? '').slice(0, 2000))
  }
  coverageOf(reviewId) { return this.db.prepare('SELECT subject_type, subject_ref, status FROM coverage WHERE review_id=?').all(reviewId).map(plain) }

  // ---------------------------------------------------------------- reviews and test runs
  openReview(taskId, { kind, execution, candidate, policy_revision, environment_id }) {
    return this.tx(() => {
      const round = this.db.prepare('SELECT COALESCE(MAX(round),0)+1 n FROM reviews WHERE task_id=? AND kind=?').get(taskId, kind).n
      const t = this.getTask(taskId)
      const id = `rv-${taskId}-${kind}-${round}`
      this.db.prepare('INSERT INTO reviews(review_id,task_id,kind,round,execution_id,context_id,candidate_sha,tree_digest,policy_revision,environment_id,fencing_token,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, taskId, kind, round, execution.execution_id, execution.context_id, candidate.candidate_sha, candidate.tree_digest, policy_revision, environment_id, t.fencing_token, 'open', this.now())
      return id
    })
  }
  getReview(id) { return plain(this.db.prepare('SELECT * FROM reviews WHERE review_id=?').get(id)) }
  /** After a reviewer session was renewed mid-review, the review belongs to the LATEST (fresh-context) execution. */
  rebindReview(id, execution) { this.db.prepare("UPDATE reviews SET execution_id=?, context_id=? WHERE review_id=? AND status='open'").run(execution.execution_id, execution.context_id, id) }
  /** Controller-side proof that the reviewer did not alter the candidate: the tree digest re-derived AFTER the session must equal the one reviewed. */
  recordReviewReadonlyCheck(id, { snapshotDigest, postTreeDigest }) {
    const r = this.getReview(id)
    this.db.prepare('UPDATE reviews SET snapshot_digest=?, post_tree_digest=?, readonly_verified=? WHERE review_id=?').run(snapshotDigest, postTreeDigest, postTreeDigest === r.tree_digest ? 1 : 0, id)
  }
  setReviewStatus(id, status, evidenceId = null) { this.db.prepare('UPDATE reviews SET status=?, evidence_id=COALESCE(?,evidence_id) WHERE review_id=?').run(status, evidenceId, id) }
  addFindings(reviewId, taskId, findings) {
    for (const f of findings) this.db.prepare('INSERT INTO findings(finding_id,review_id,task_id,severity,mandatory,path,evidence,reproduction,remediation,status) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(f.id, reviewId, taskId, f.severity, f.mandatory ? 1 : 0, f.path, f.evidence, f.reproduction, f.remediation, 'open')
  }
  openMandatoryFindings(taskId) { return this.db.prepare("SELECT * FROM findings WHERE task_id=? AND mandatory=1 AND status='open'").all(taskId).map(plain) }
  setFindingStatus(reviewId, findingId, status) { this.db.prepare('UPDATE findings SET status=? WHERE review_id=? AND finding_id=?').run(status, reviewId, findingId) }
  contextIdsUsed(taskId) { return this.db.prepare('SELECT context_id, role FROM executions WHERE task_id=?').all(taskId).map(plain) }
  implementerContextIds(taskId) { return this.db.prepare("SELECT context_id FROM executions WHERE task_id=? AND role IN ('implementer','planner')").all(taskId).map((r) => r.context_id) }

  recordTestRun(taskId, { run_id, candidate_sha, tree_digest, results, passed, failure_fingerprint = null }) {
    const t = this.getTask(taskId)
    this.db.prepare('INSERT INTO test_runs(run_id,task_id,candidate_sha,tree_digest,fencing_token,results_json,passed,failure_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(run_id, taskId, candidate_sha, tree_digest, t.fencing_token, json(results), passed ? 1 : 0, failure_fingerprint, this.now())
  }
  latestTestRun(taskId) { return plain(this.db.prepare('SELECT * FROM test_runs WHERE task_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(taskId)) }
}
