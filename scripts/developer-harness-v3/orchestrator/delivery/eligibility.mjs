// Developer Harness V3 (D3.6 remediation F1) — delivery eligibility is a LIVE fact, not a signature that merely has not expired.
//
// A signed delivery-verification package says "at verified_at, the latest CI and staging results of this exact candidate were green". It stops saying that the moment a NEWER applicable
// workflow run of the same SHA is pending, failed, cancelled or simply a different run than the one the package describes. The controller therefore records, when it accepts each result,
// the IDENTITY of the run it rested on (the "basis": check name + run id + run attempt + check attempt), and on every step compares it with the authenticated delivery observation:
//   superseded -> withdrawEligibility(): the dependent evidence (ci_gate / staging_gate / delivery_verification) is invalidated, the milestones are invalidated, the package is moved to
//   history (never deleted, never reused), the basis is cleared, a durable marker is set and ONE status notification is queued — all in one transaction.
// Under the authoritative lifecycle a merge_eligible task cannot move backwards: it stays in `merge_eligible` with NO valid evidence, the marker set, and deliveryEligibility() = false until the
// controller has re-verified the latest results and issued a FRESH package. Proposal P6v3 adds the explicit back-edges (merge_eligible -> ci_running / staging_verification) so the lifecycle
// state itself tells the truth; the authoritative configuration fails closed without them. Nothing here merges, and nothing here can make a task eligible: it only withdraws.
import { digestOf } from '../../lib/canonical.mjs'
import { usableEvidence } from '../ledger/evidence-store.mjs'
import { isSatisfying } from '../../authority/evidence.mjs'
import { enqueueOutbox } from '../ledger/intents.mjs'
import { invalidateMilestones } from './state.mjs'

export const GATE_EVIDENCE = Object.freeze({ ci: Object.freeze(['ci_gate', 'staging_gate', 'delivery_verification']), staging: Object.freeze(['staging_gate', 'delivery_verification']) })
export const GATE_MILESTONES = Object.freeze({ ci: Object.freeze(['ci_verified', 'staging_verified', 'merge_eligible']), staging: Object.freeze(['staging_verified', 'merge_eligible']) })
export const REGRESSION_EDGE = Object.freeze({ ci: 'ci_regression', staging: 'staging_regression' })
export const PACKAGE_TTL_MS = 3600_000

/** The identity of the CI results an observation describes (every required check: name, run, run attempt, check attempt). */
export const ciIdentity = (ci) => (ci?.overall === 'success' ? (ci.checks ?? []).map((c) => `${c.name}@${c.run_id}.${c.run_attempt ?? c.attempt}.${c.attempt}`).sort().join('|') : null)
export const stagingIdentity = (s) => (s?.state === 'success' && Number.isInteger(s.run_id) ? `${s.run_id}.${s.run_attempt ?? s.attempt}.${s.attempt}` : null)
const basisKey = (taskId, head, kind) => `basis:${kind}:${taskId}:${head}`
export function recordBasis(L, taskId, kind, d) {
  const head = L.getTask(taskId).head_sha; const id = kind === 'ci' ? ciIdentity(d.ci) : stagingIdentity(d.staging)
  if (id) L.setMeta(basisKey(taskId, head, kind), id)
  return !!id
}
export const basisOf = (L, taskId, kind) => L.meta(basisKey(taskId, L.getTask(taskId).head_sha, kind)) ?? null
const clearBasis = (L, taskId, head, kind) => L.db.prepare('DELETE FROM meta WHERE key=?').run(basisKey(taskId, head, kind))
export const packageOf = (L, taskId, head) => { try { const x = L.meta(`delivery_package:${taskId}:${head}`); return x ? JSON.parse(x) : null } catch { return null } }

/**
 * Has a result the task's approvals rest on been superseded by what the authenticated observation `d` shows NOW? Only results the controller actually accepted (a recorded basis) can
 * be superseded. @returns {{scope:'ci'|'staging', cause:string}|null}
 */
export function supersededResult(L, taskId, d) {
  const ci = basisOf(L, taskId, 'ci')
  if (ci !== null) {
    if (d.ci?.overall !== 'success') return { scope: 'ci', cause: `CI_${String(d.ci?.overall ?? 'unavailable').toUpperCase()}` }
    if (ciIdentity(d.ci) !== ci) return { scope: 'ci', cause: 'CI_RUN_SUPERSEDED' }
  }
  const st = basisOf(L, taskId, 'staging')
  if (st !== null) {
    if (d.staging?.state !== 'success') return { scope: 'staging', cause: `STAGING_${String(d.staging?.state ?? 'unavailable').toUpperCase()}` }
    if (stagingIdentity(d.staging) !== st) return { scope: 'staging', cause: 'STAGING_RUN_SUPERSEDED' }
  }
  return null
}

/**
 * Withdraw everything that rested on the superseded result, in ONE transaction. Idempotent. If the ACTIVE lifecycle declares the regression edge (proposal P6v3) and the task is in a state
 * it leaves from, the same transaction moves the task back; otherwise the task keeps its state with no valid evidence (fail closed).
 * @returns {{ok:true, withdrawn:object, moved:boolean}}
 */
export function withdrawEligibility(L, taskId, { scope, cause }) {
  return L.tx(() => {
    const t = L.getTask(taskId); const head = t.head_sha; const now = L.now(); const types = GATE_EVIDENCE[scope]
    const evidence = L.db.prepare(`UPDATE evidence SET invalidated_at=? WHERE task_id=? AND invalidated_at IS NULL AND evidence_type IN (${types.map(() => '?').join(',')})`).run(now, taskId, ...types).changes
    invalidateMilestones(L, taskId, GATE_MILESTONES[scope])
    const key = `delivery_package:${taskId}:${head}`; const pkg = L.meta(key); let packageDigest = null
    if (pkg) { try { packageDigest = JSON.parse(pkg).package_digest ?? null } catch { packageDigest = null } L.setMeta(`delivery_package_withdrawn:${taskId}:${head}:${now}`, JSON.stringify({ withdrawn_at: now, cause, scope, raw: pkg })); L.db.prepare('DELETE FROM meta WHERE key=?').run(key) }
    clearBasis(L, taskId, head, 'staging'); if (scope === 'ci') clearBasis(L, taskId, head, 'ci')
    L.setMeta(`eligibility_withdrawn:${taskId}:${head}`, JSON.stringify({ scope, cause, at: now }))
    L.recordRecovery(taskId, 'delivery_eligibility_withdrawn', { scope, cause, state: t.state, evidence_invalidated: evidence, package_digest: packageDigest })
    enqueueOutbox(L, { taskId, kind: 'delivery_status', dedupeKey: `delivery:${taskId}:eligibility_withdrawn:${head}:${now}:${scope}`, payload: { task_id: taskId, milestone: 'merge_eligibility_withdrawn', candidate_sha: head, simulated: true, scope, cause, package_digest: packageDigest, merge: 'NOT PERFORMED (D3.6 has no merge authority)' } })
    const edge = L.lc?.[REGRESSION_EDGE[scope]]; let moved = false
    if (edge && edge.from.includes(t.state) && t.state !== edge.to) { const r = L.transition(taskId, edge.to, { reason_code: edge.reason }); moved = r.ok === true }
    return { ok: true, withdrawn: { scope, cause, evidence, package_digest: packageDigest }, moved }
  })
}
export const withdrawalOf = (L, taskId) => { try { const x = L.meta(`eligibility_withdrawn:${taskId}:${L.getTask(taskId).head_sha}`); return x ? JSON.parse(x) : null } catch { return null } }
export const clearWithdrawal = (L, taskId) => L.db.prepare('DELETE FROM meta WHERE key=?').run(`eligibility_withdrawn:${taskId}:${L.getTask(taskId).head_sha}`)

/**
 * THE question D3.7 (or any consumer) must ask before relying on a task's delivery eligibility — answered from the durable ledger alone, never from a state name or an unexpired signature:
 * state merge_eligible, no suspension, no withdrawal marker, a current merge_eligible milestone, CURRENT satisfying ci_gate + staging_gate + delivery_verification evidence for this exact
 * candidate, and a held package that is the one the delivery_verification evidence was issued for and is not older than its validity.
 * @returns {{eligible:boolean, problems:string[]}}
 */
export function deliveryEligibility(L, policy, taskId) {
  const t = L.getTask(taskId); const problems = []
  if (!t) return { eligible: false, problems: ['TASK.UNKNOWN'] }
  if (t.cancelled) problems.push('TASK.CANCELLED')
  if (t.state !== 'merge_eligible') problems.push(`STATE_NOT_MERGE_ELIGIBLE:${t.state}`)
  if (L.getSuspension(taskId)) problems.push('TASK.SUSPENDED')
  if (withdrawalOf(L, taskId)) problems.push('ELIGIBILITY_WITHDRAWN')
  const base = L.currentBase(taskId)
  if (!L.db.prepare("SELECT 1 FROM delivery_milestones WHERE task_id=? AND milestone='merge_eligible' AND candidate_sha=? AND base_sha=? AND invalidated_at IS NULL").get(taskId, t.head_sha, base)) problems.push('MILESTONE_NOT_CURRENT')
  const ev = {}
  for (const type of ['ci_gate', 'staging_gate', 'delivery_verification']) {
    const row = usableEvidence(L, taskId, policy, { types: [type] }).find((r) => r.candidate_sha === t.head_sha && r.envelope.payload.base_sha === base && isSatisfying(r.envelope.payload))
    if (!row) problems.push(`EVIDENCE_NOT_CURRENT:${type}`); else ev[type] = row
  }
  const held = packageOf(L, taskId, t.head_sha)
  if (!held) problems.push('PACKAGE_MISSING')
  else {
    let digest = null; try { digest = digestOf(held.package) } catch { digest = null }
    if (digest === null || digest !== held.package_digest || held.package.candidate_sha !== t.head_sha || held.package.base_sha !== base || held.package.policy_revision !== policy.revision) problems.push('PACKAGE_NOT_THIS_CANDIDATE')
    else if (ev.delivery_verification && ev.delivery_verification.envelope.payload.idempotency_id !== `dvp-${digest.slice(0, 48)}`) problems.push('PACKAGE_NOT_THE_VERIFIED_ONE')
    if (held.package.verified_at + PACKAGE_TTL_MS <= L.now()) problems.push('PACKAGE_EXPIRED')
  }
  return { eligible: problems.length === 0, problems }
}
