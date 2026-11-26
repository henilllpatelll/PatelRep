// Developer Harness V3 (D3.5 independent-verification F2) — dependency BASIS: what a downstream task was actually built and verified against, versus what its upstream looks like NOW.
//
// Three distinct facts are kept apart (the pre-fix scheduler conflated them and "validated" a new upstream state by simply recording it):
//   * OBSERVED  — the dependencies' current state (candidate + tree, handoff readiness, cancellation). Read live from the ledger, never stored as a verdict.
//   * BUILD     — `dep_build:<task>`: the observed basis captured when the task's CURRENT implementation attempt began. The attempt is built on THAT state.
//   * BASIS     — `dep_basis:<task>`: the basis the task's CURRENT candidate was built on. Promoted from BUILD in the SAME transaction that records the candidate, and only if the
//                 observed basis still equals BUILD at that instant (a basis that moved during the build means the result is discarded, never stamped).
// Only a candidate recorded after a build that really ran on the current basis — and then tested and reviewed anew — can be handed off. Tests/reviews/handoffs obtained under an older basis are
// withdrawn when it changes; they are never re-attested (the issuers only re-issue a verdict for the SAME candidate, which is exactly what is no longer true).
//
// Two kinds of upstream condition (one is NOT the other):
//   * NOT READY (transient: the dependency is itself being rebuilt/re-verified): the downstream's HANDOFF is withdrawn and it WAITS (`dependency_waiting`, an authoritative transition). Its
//     evidence stays valid while the dependency's candidate is unchanged; when the same candidate is ready again the downstream hands off again with a NEW package.
//   * BASIS CHANGED (a dependency's candidate or tree differs from the basis): the downstream's approvals and handoff are WITHDRAWN and the old package is superseded. Recovery needs a REBUILD
//     (back to `implementing`, a new session, new test run, new reviews). The authoritative lifecycle has no such transition: it FAILS CLOSED (terminal technical suspension — never silently
//     re-authorizing). The labelled proposal lifecycle (P6 `dependency_rebuild`) performs the rebuild.
//   * CANCELLED: an explicit owner-level conflict (existing behaviour) — and the handoff and approvals are withdrawn too.
import { digestOf } from '../lib/canonical.mjs'
import { suspendTechnically } from './suspension.mjs'

const BUILT_STATES = ['testing', 'independent_review', 'security_review', 'publishing']
const GATED_STATES = ['implementing', ...BUILT_STATES]
const json = (v) => JSON.stringify(v)
const read = (L, key) => { try { return JSON.parse(L.meta(key) ?? 'null') } catch { return null } }

export const depsOf = (L, id) => L.db.prepare('SELECT depends_on FROM task_dependencies WHERE task_id=? ORDER BY depends_on').all(id).map((r) => r.depends_on)

/** The dependencies' CURRENT state. `ready` = verified delivery handoff reached (or completed) and not cancelled. */
export function observeBasis(L, id) {
  return depsOf(L, id).map((d) => { const t = L.getTask(d); const c = L.currentCandidate(d); return { id: d, candidate: c?.candidate_sha ?? null, tree: c?.tree_digest ?? null, ready: !!t && !t.cancelled && (t.handoff_ready === 1 || t.state === 'completed'), cancelled: !t || t.cancelled === 1, invalid: !!read(L, `dep_stale:${d}`) } })
}
const identity = (b) => b.map((x) => ({ id: x.id, candidate: x.candidate, tree: x.tree }))
const sameIdentity = (a, b) => json(identity(a)) === json(identity(b))
/** Which dependencies' candidate/tree differ from the recorded basis. */
const changedIds = (basis, observed) => { const by = new Map(basis.map((x) => [x.id, x])); return observed.filter((o) => { const x = by.get(o.id); return !x || x.candidate !== o.candidate || x.tree !== o.tree }).map((o) => o.id) }

/** A refusal is recorded ONCE per distinct dependency state (a task that keeps waiting must not write a recovery row on every advance). */
export function noteOnce(L, id, kind, detail) {
  const key = `dep_note:${id}:${kind}`; const sig = digestOf({ detail, basis: identity(observeBasis(L, id)), stale: !!staleOf(L, id) })
  if (L.meta(key) === sig) return false
  L.setMeta(key, sig); L.recordRecovery(id, kind, detail); return true
}
export const staleOf = (L, id) => read(L, `dep_stale:${id}`)
export const basisOf = (L, id) => read(L, `dep_basis:${id}`)

/** Is the task's work CURRENT with respect to its dependencies? (true for a task without dependencies). */
export function dependencyCurrent(L, id) {
  if (!depsOf(L, id).length) return true
  const have = L.currentCandidate(id); const b = basisOf(L, id); if (!have) return true // nothing built yet: nothing to be stale
  if (staleOf(L, id)) return false
  if (!b || b.candidate !== have.candidate_sha) return false // a candidate that was not built on a recorded basis is unproven: fail closed
  const o = observeBasis(L, id)
  return o.every((x) => x.ready && !x.cancelled && !x.invalid) && sameIdentity(o, b.basis)
}

/** Withdraw a handoff that is no longer true: not ready, or built on another basis. The package is superseded (preserved as history), never deleted. Idempotent. */
function withdrawHandoff(L, id, cause) {
  const t = L.getTask(id); const pkg = read(L, `handoff:${id}`)
  if (t.handoff_ready !== 1 && !pkg) return false
  L.tx(() => {
    L.db.prepare('UPDATE tasks SET handoff_ready=0, updated_at=? WHERE task_id=?').run(L.now(), id)
    if (pkg) { L.setMeta(`handoff_superseded:${id}:${pkg.digest ?? digestOf(pkg)}`, json({ ...pkg, superseded_at: L.now(), cause })); L.db.prepare('DELETE FROM meta WHERE key=?').run(`handoff:${id}`) }
    L.recordRecovery(id, 'handoff_withdrawn', { cause, digest: pkg?.digest ?? null })
  })
  return true
}

/** The basis the task was built on is no longer the dependencies' state: every approval and the handoff are withdrawn. */
function markStale(L, id, { cause, before, after, changed }) {
  const prior = staleOf(L, id)
  if (prior && json(identity(prior.after ?? [])) === json(identity(after)) && prior.cause === cause) return false // idempotent: the same drift is recorded once
  L.tx(() => {
    L.withdrawApprovals(id); withdrawHandoff(L, id, cause)
    L.setMeta(`dep_stale:${id}`, json({ since: prior?.since ?? L.now(), cause, before, after, changed }))
    L.recordRecovery(id, 'dependency_basis_changed', { cause, before, after, changed })
  })
  return true
}

/** Reconcile ONE task against its dependencies. @returns {boolean} true when something about the task changed. */
export function reconcileTask(e, id) {
  const L = e.ledger; const t = L.getTask(id)
  if (!t || t.cancelled || t.state === 'completed' || !depsOf(L, id).length) return false
  const observed = observeBasis(L, id); const b = basisOf(L, id); const cand = L.currentCandidate(id); let changed = false
  if (observed.some((o) => o.cancelled)) {
    // upstream cancelled: the handoff and approvals are not valid any more; the (existing) owner-level conflict is raised by the caller
    if (b || cand) changed = markStale(L, id, { cause: 'DEPENDENCY_CANCELLED', before: b?.basis ?? [], after: identity(observed), changed: observed.filter((o) => o.cancelled).map((o) => o.id) })
    else changed = withdrawHandoff(L, id, 'DEPENDENCY_CANCELLED')
    return changed
  }
  if (observed.some((o) => o.invalid)) { // transitive: an upstream whose own approvals were withdrawn cannot vouch for what was built on it
    return markStale(L, id, { cause: 'DEPENDENCY_UPSTREAM_INVALID', before: b?.basis ?? [], after: identity(observed), changed: observed.filter((o) => o.invalid).map((o) => o.id) })
  }
  if (cand && (!b || b.candidate !== cand.candidate_sha)) { // a candidate exists that was never built on a recorded basis: unproven, fail closed
    return markStale(L, id, { cause: 'DEPENDENCY_BASIS_UNPROVEN', before: b?.basis ?? [], after: identity(observed), changed: observed.map((o) => o.id) })
  }
  if (b && !sameIdentity(b.basis, observed)) return markStale(L, id, { cause: 'DEPENDENCY_BASIS_CHANGED', before: b.basis, after: identity(observed), changed: changedIds(b.basis, observed) })
  if (t.handoff_ready === 1 && observed.some((o) => !o.ready)) changed = withdrawHandoff(L, id, 'DEPENDENCY_NOT_READY') // transient: evidence stays, the handoff does not
  return changed
}

/** Every task with dependencies, to a fixed point (a withdrawn handoff makes ITS dependents not-ready/stale in the next pass), in a deterministic order. @returns {string[]} the tasks newly marked stale or withdrawn. */
export function sweepDependencyBasis(e) {
  const L = e.ledger; const touched = []
  const ids = L.db.prepare('SELECT DISTINCT task_id FROM task_dependencies ORDER BY task_id').all().map((r) => r.task_id)
  for (let pass = 0; pass <= ids.length; pass += 1) {
    let any = false
    for (const id of ids) if (reconcileTask(e, id)) { any = true; if (!touched.includes(id)) touched.push(id) }
    if (!any) break
  }
  for (const id of ids) { const t = L.getTask(id); if (t && !t.cancelled && t.state !== 'completed' && t.state !== 'blocked' && L.deadDependencies(id).length) e.dependencyConflict(id) } // an upstream cancellation is an explicit owner-level conflict (after the handoff/approvals were withdrawn)
  return touched
}

/** At the START of an implementation attempt: capture the basis it is built on (kept across crash/retry of the same attempt). */
export function captureBuildBasis(L, id) {
  if (!depsOf(L, id).length) return null
  const have = read(L, `dep_build:${id}`); if (have) return have
  const o = observeBasis(L, id); L.setMeta(`dep_build:${id}`, json(o)); return o
}
/**
 * At the moment the candidate is recorded: does the observed basis still equal what the attempt was built on? Returns the basis to promote, or a refusal.
 * @returns {{ok:true, basis:object[]|null}|{ok:false, code:string}}
 */
export function buildBasisForRecord(L, id) {
  if (!depsOf(L, id).length) return { ok: true, basis: null }
  const built = read(L, `dep_build:${id}`); const o = observeBasis(L, id)
  if (!built) return { ok: false, code: 'DEPENDENCY.BUILD_BASIS_NOT_CAPTURED' }
  if (o.some((x) => x.cancelled)) return { ok: false, code: 'DEPENDENCY.CANCELLED' }
  if (!o.every((x) => x.ready)) return { ok: false, code: 'DEPENDENCY.NOT_READY' }
  if (!sameIdentity(built, o)) return { ok: false, code: 'DEPENDENCY.BASIS_CHANGED_DURING_BUILD' }
  return { ok: true, basis: identity(o) }
}
/** Promote the build basis to THE basis of the just-recorded candidate (call inside the candidate-recording transaction). */
export function promoteBasis(L, id, candidateSha, basis) {
  if (!basis) return
  L.setMeta(`dep_basis:${id}`, json({ candidate: candidateSha, basis, at: L.now() }))
  L.db.prepare('DELETE FROM meta WHERE key IN (?,?,?)').run(`dep_build:${id}`, `dep_stale:${id}`, `dep_rebuild:${id}`)
}
export function discardBuild(L, id) { L.db.prepare('DELETE FROM meta WHERE key IN (?,?)').run(`dep_build:${id}`, `stage_done:${id}:implementing`) }

/**
 * The engine's per-task dependency step (before any stage runs). @returns {Promise<null|{progressed:boolean, action?:string}>} null = nothing to do, run the stage.
 */
export async function dependencyStep(e, id) {
  const L = e.ledger; const t = L.getTask(id)
  if (!GATED_STATES.includes(t.state) || !depsOf(L, id).length) return null
  reconcileTask(e, id)
  if (L.deadDependencies(id).length) return e.dependencyConflict(id)
  const stale = staleOf(L, id); const built = BUILT_STATES.includes(t.state)
  const rebuild = L.lc.dependency_rebuild
  if (stale && built) {
    if (!rebuild || !(rebuild.from ?? []).includes(t.state)) {
      suspendTechnically(e, id, { cause: 'DEPENDENCY_BASIS_CHANGED', stage: t.state, codes: [`DEPENDENCY_BASIS_CHANGED:${stale.cause}`], terminal: true,
        howToResume: 'A dependency changed after this task was built and verified on it. Its approvals and handoff were withdrawn and are NOT re-attested. The authoritative lifecycle has no rebuild transition (proposal P6 `dependency_rebuild`), so this fails closed: resubmit the task on the current dependencies, or apply P6.' })
      return { progressed: true, action: 'technically_suspended' }
    }
  }
  if (L.openDependencies(id).length) { const w = L.transition(id, 'dependency_waiting', { reason_code: 'DEPENDENCY_TASK_OPEN' }); return w.ok ? { progressed: true, action: 'dependency_waiting' } : null }
  if (stale && built) { // the labelled proposal lifecycle only (checked above)
    const cand = L.currentCandidate(id)
    const r = L.tx(() => {
      const x = L.transition(id, rebuild.to, { reason_code: rebuild.reason }); if (!x.ok) return x
      L.setMeta(`remediation:${id}`, `A dependency (${stale.changed.join(', ')}) changed after this task was built on it (${stale.cause}). Rebuild the work on the CURRENT dependencies inside the task scope; the previous tests, reviews and handoff were withdrawn and will be obtained again.`)
      L.setMeta(`dep_rebuild:${id}`, '1'); if (cand) L.setMeta(`reverify:${id}`, cand.candidate_sha)
      L.recordRecovery(id, 'dependency_rebuild_started', { cause: stale.cause, changed: stale.changed })
      return x
    })
    return r.ok ? { progressed: true, action: 'dependency_rebuild' } : null
  }
  return null
}
