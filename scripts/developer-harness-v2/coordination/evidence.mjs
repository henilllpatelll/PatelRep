// Developer Harness V2 — Phase 5 evidence tracking, stale-evidence invalidation, approvals and findings.
//
// Everything here is DATA handling. Evidence, approvals and findings read from a checkpoint authorize nothing: a
// checkpoint is a local, untracked, editable record. Authority comes from the human's task (via the router plan),
// from fresh in-session approvals (ApprovalLedger, memory only, never serialized) and from GitHub.
import { createHash } from 'node:crypto'
import { evaluateFinding } from '../routing/router.mjs'

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** Deterministic JSON (sorted keys). Used for digests only. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}

export const LOCAL_KINDS = Object.freeze(['local_tests', 'review', 'security_review', 'pr_ready'])
export const REMOTE_KINDS = Object.freeze(['pull_request', 'ci_gate', 'staging_candidate', 'staging_gate'])
export const KINDS = Object.freeze([...LOCAL_KINDS, ...REMOTE_KINDS])
const TREE_BOUND = new Set(['local_tests', 'review', 'security_review', 'pr_ready'])
const SCOPE_BOUND = new Set(['review', 'security_review'])
/** Who may record each kind. Roles are SELF-ASSERTED labels in a local file; remote kinds come only from a provider. */
export const RECORDERS = Object.freeze({
  local_tests: ['test_coordinator', 'implementer', 'coordinator'],
  review: ['independent_reviewer'],
  security_review: ['security_reviewer'],
  pr_ready: ['coordinator'],
  pull_request: ['github_provider'], ci_gate: ['github_provider'], staging_candidate: ['github_provider'], staging_gate: ['github_provider'],
})
export const RESULTS = Object.freeze(['pass', 'fail', 'pending'])
const SHA = /^[0-9a-f]{40}$/

/** Head SHA the evidence is about. A staging candidate is identified by ITS code SHA, never by the workflow run's head. */
export const evidenceHead = (e) => (e.kind === 'staging_candidate' ? e.bound.candidate_sha : e.bound.head_sha)

export function makeEvidence({ kind, result, by, bound, summary = '', now }) {
  if (!KINDS.includes(kind)) throw new Error(`evidence: unknown kind ${String(kind).slice(0, 40)}`)
  if (!RESULTS.includes(result)) throw new Error('evidence: result must be pass, fail or pending')
  if (!RECORDERS[kind].includes(by)) throw new Error(`evidence: ${String(by).slice(0, 40)} may not record ${kind}`)
  const e = { kind, status: 'valid', result, by, bound: { ...bound }, summary: String(summary).slice(0, 500), recorded_at: now }
  if (!SHA.test(String(evidenceHead(e)))) throw new Error('evidence: a full 40-hex head SHA binding is required')
  if (TREE_BOUND.has(kind) && !/^[0-9a-f]{64}$/.test(String(e.bound.tree_digest))) throw new Error('evidence: tree_digest binding required')
  if (SCOPE_BOUND.has(kind) && !/^[0-9a-f]{64}$/.test(String(e.bound.scope_digest))) throw new Error('evidence: scope_digest binding required')
  e.digest = sha256(canonical(e))
  e.id = `${kind}-${e.digest.slice(0, 12)}`
  return e
}

/** The valid (not invalidated) evidence of a kind, newest last. */
export const validEvidence = (record, kind) => record.evidence.filter((e) => e.kind === kind && e.status === 'valid')
/** The NEWEST valid evidence of a kind, but only if it passed: a later failure at the same binding is never outvoted by an earlier pass. */
export const latestPass = (record, kind) => {
  const all = validEvidence(record, kind)
  if (!all.length) return null
  // Each recorder's newest verdict must be a pass: the writer's later pass cannot overwrite the test coordinator's fail.
  const newestBy = new Map()
  for (const e of all) newestBy.set(e.by, e)
  return [...newestBy.values()].every((e) => e.result === 'pass') ? all.at(-1) : null
}

/**
 * Compare every valid evidence record with INDEPENDENTLY gathered current facts and invalidate what no longer applies.
 * Invalidation is monotonic and visible: the record stays (audit), status becomes `invalidated` with a reason code.
 * @param facts { head_sha, tree_digest, scope_digest }   @param remote null | { pr: { head_sha } }  (provider-verified only)
 */
export function reconcileEvidence(record, facts, remote = null, now = new Date().toISOString()) {
  const next = structuredClone(record)
  const invalidations = []
  const kill = (e, code, reason) => {
    e.status = 'invalidated'
    e.invalidated = { code, at: now, reason }
    invalidations.push({ id: e.id, kind: e.kind, code, reason })
  }
  for (const e of next.evidence) {
    if (e.status !== 'valid') continue
    const head = evidenceHead(e)
    if (head !== facts.head_sha) kill(e, 'EVIDENCE.HEAD_CHANGED', `bound to ${head.slice(0, 8)}, current head is ${facts.head_sha.slice(0, 8)}`)
    else if (TREE_BOUND.has(e.kind) && e.bound.tree_digest !== facts.tree_digest) kill(e, 'EVIDENCE.TREE_CHANGED', 'working tree differs from the tree the evidence was gathered on')
    else if (SCOPE_BOUND.has(e.kind) && e.bound.scope_digest !== facts.scope_digest) kill(e, 'EVIDENCE.SCOPE_CHANGED', 'changed-file scope differs from the scope that was reviewed')
    else if (REMOTE_KINDS.includes(e.kind) && remote?.pr && remote.pr.head_sha !== head) kill(e, 'EVIDENCE.REMOTE_HEAD_MOVED', `PR head is now ${remote.pr.head_sha.slice(0, 8)}`)
  }
  // Approvals are audit data only. They are marked unusable here for visibility; usability never comes from a checkpoint.
  for (const a of next.approvals) {
    a.audit_only = true
    if (a.head_sha !== facts.head_sha && !a.stale) { a.stale = { code: 'APPROVAL.STALE_SHA', at: now }; invalidations.push({ id: a.id, kind: 'approval', code: 'APPROVAL.STALE_SHA', reason: 'recorded for a different head SHA' }) }
  }
  return { record: next, invalidations }
}

/** In-memory, per-process fresh approvals. Never written to a checkpoint, never read from one. Single use, SHA-bound. */
export class ApprovalLedger {
  #grants = new Map()
  /** Called only by a human-attested channel (e.g. a flag on a command the human approved at the permission prompt). */
  grant({ action, target, task_id, head_sha, expires_at, now = Date.now() }) {
    if (!action || !target || !task_id || !SHA.test(String(head_sha))) throw new Error('approval needs action, target, task_id and a 40-hex head_sha')
    const parsed = Date.parse(expires_at ?? '')
    const exp = Math.min(Number.isNaN(parsed) ? now + 15 * 60 * 1000 : parsed, now + 60 * 60 * 1000) // default 15 min, never longer than one hour
    const id = sha256(`${action}|${target}|${task_id}|${head_sha}|${now}|${this.#grants.size}`).slice(0, 12)
    this.#grants.set(id, { id, action, target, task_id, head_sha, exp, consumed: false, revoked: false })
    return { id, action, target, task_id, head_sha, expires_at: new Date(exp).toISOString(), single_use: true }
  }
  /** Exact action + target + task + SHA, unexpired, unconsumed, unrevoked. A mismatch on any field is a denial with a code. */
  consume({ action, target, task_id, head_sha, now = Date.now() }) {
    const same = [...this.#grants.values()].filter((g) => g.action === action)
    if (!same.length) return { ok: false, code: 'APPROVAL.NONE', reason: 'no fresh approval for this action in this session' }
    const forTask = same.filter((g) => g.task_id === task_id)
    if (!forTask.length) return { ok: false, code: 'APPROVAL.DIFFERENT_TASK', reason: 'approval belongs to another task' }
    const forTarget = forTask.filter((g) => g.target === target)
    if (!forTarget.length) return { ok: false, code: 'APPROVAL.DIFFERENT_TARGET', reason: 'approval names a different target' }
    const live = forTarget.filter((g) => !g.consumed && !g.revoked)
    if (!live.length) return { ok: false, code: 'APPROVAL.CONSUMED', reason: 'approval was single-use and is spent or revoked' }
    const unexpired = live.filter((g) => g.exp > now) // an expired grant is never a stale-SHA event: it is simply dead
    if (!unexpired.length) return { ok: false, code: 'APPROVAL.EXPIRED', reason: 'approval expired' }
    const fresh = unexpired.filter((g) => g.head_sha === head_sha)
    if (!fresh.length) { unexpired.forEach((g) => { g.revoked = true }); return { ok: false, code: 'APPROVAL.STALE_SHA', reason: 'approval was given for a different head SHA; it is now revoked', blocking: true } }
    fresh[0].consumed = true
    return { ok: true, code: 'APPROVAL.CONSUMED_NOW', approval_id: fresh[0].id, expires_at: new Date(fresh[0].exp).toISOString() }
  }
  /** Revoke live grants for this action+task that were given for a DIFFERENT head. True when any existed (N-7: stale approval). */
  revokeStale({ action, target, task_id, head_sha, now = Date.now() }) {
    let any = false
    for (const g of this.#grants.values()) if (g.action === action && g.target === target && g.task_id === task_id && !g.consumed && !g.revoked && g.exp > now && g.head_sha !== head_sha) { g.revoked = true; any = true }
    return any
  }
  has(action, target, task_id, head_sha, now = Date.now()) {
    return [...this.#grants.values()].some((g) => g.action === action && g.target === target && g.task_id === task_id && g.head_sha === head_sha && !g.consumed && !g.revoked && g.exp > now)
  }
}

/** Audit-only description of an approval read from a checkpoint: classifies why it is NOT usable. Never returns usable:true. */
export function classifyRecordedApproval(a, record, facts, now = Date.now()) {
  const codes = ['APPROVAL.CHECKPOINT_IS_NOT_AUTHORIZATION']
  if (a.task_id !== record.task_id) codes.push('APPROVAL.DIFFERENT_TASK')
  if (a.head_sha !== facts.head_sha) codes.push('APPROVAL.STALE_SHA')
  if (Date.parse(a.expires_at ?? '') <= now) codes.push('APPROVAL.EXPIRED')
  if (a.consumed) codes.push('APPROVAL.CONSUMED')
  return { id: a.id, usable: false, codes }
}

/**
 * Decide an action request against the contract class, the human-named plan side effects and the fresh ledger.
 * `run` (optional) is invoked ONLY on allow; on denial no side effect can occur through this function.
 * @returns {{allowed:boolean, code:string, reason:string, blocking:boolean}}
 */
export function authorizeAction(record, { action, target }, facts, contract, plan, ledger, run = null) {
  const cls = contract.actions[action]
  const deny = (code, reason, blocking = false) => ({ allowed: false, code, reason, blocking })
  if (!cls) return deny('ACTION.UNKNOWN', 'action is not in the contract')
  if (cls === 'forbidden') return deny('ACTION.FORBIDDEN', 'forbidden under any approval')
  if (cls === 'allowed') { const r = { allowed: true, code: 'ACTION.ALLOWED', reason: 'class allowed', blocking: false }; run?.(); return r }
  if (cls === 'task_authorized' && !plan.side_effects_authorized.some((s) => s.action === action)) return deny('ACTION.NOT_TASK_AUTHORIZED', 'the human task request did not name this side effect')
  const c = ledger.consume({ action, target, task_id: record.task_id, head_sha: facts.head_sha })
  if (!c.ok) return deny(c.code, c.reason, c.blocking === true)
  run?.()
  return { allowed: true, code: 'ACTION.AUTHORIZED_FRESH', reason: 'fresh single-use approval consumed', blocking: false }
}

// ── Findings ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * A finding's stored `resolution` is a CLAIM. It is honored only when verified here:
 * remediated_and_rereviewed → a valid, passing review of the right kind, recorded after the finding, on a head newer than the finding's.
 * human_decision → only if the in-session ledger holds a fresh human decision; a checkpoint field is never enough.
 */
export function verifiedOpenState(record, finding, facts, humanDecisions = new Set()) {
  const res = finding.resolution ?? null
  let verified = null
  if (res?.kind === 'remediated_and_rereviewed') {
    const kind = finding.source_role === 'security_reviewer' ? 'security_review' : 'review'
    const ev = record.evidence.find((e) => e.id === res.evidence_id)
    if (ev && ev.kind === kind && ev.status === 'valid' && ev.result === 'pass' && ev.bound.head_sha === facts.head_sha && ev.bound.head_sha !== finding.found_at_head && ev.recorded_at > finding.recorded_at) verified = { kind: 'remediated_and_rereviewed' }
  } else if (res?.kind === 'human_decision' && humanDecisions.has(finding.id)) verified = { kind: 'human_decision', by: 'human' }
  return evaluateFinding(finding, verified)
}

export const openBlockingFindings = (record, facts, humanDecisions) => record.findings.filter((f) => { const v = verifiedOpenState(record, f, facts, humanDecisions); return v.blocking && v.open })

// ── Provider-verified remote snapshots ──────────────────────────────────────────────────────────────────────────
// A remote snapshot is accepted as GitHub evidence only if it was produced by verifyRemoteSnapshot() — i.e. handed over
// by CODE (a provider function the caller wrote), never parsed out of a checkpoint, a PR body or any other text.
const VERIFIED = new WeakSet()
const isSha = (s) => SHA.test(String(s))
export function verifyRemoteSnapshot(raw) {
  const bad = (m) => { throw new Error(`remote snapshot: ${m}`) }
  if (!raw || typeof raw !== 'object') bad('not an object')
  const snap = { source: 'github_provider', fetched_at: String(raw.fetched_at ?? ''), pr: null, ci_gate: null, staging_candidate: null, staging_gate: null }
  if (raw.pr) {
    if (!isSha(raw.pr.head_sha) || !Number.isInteger(raw.pr.number)) bad('pr needs number and head_sha')
    snap.pr = { number: raw.pr.number, head_sha: raw.pr.head_sha, draft: raw.pr.draft === true, state: String(raw.pr.state ?? ''), head_ref: String(raw.pr.head_ref ?? ''), base_ref: String(raw.pr.base_ref ?? '') }
  }
  const gate = (g, name) => {
    if (!g) return null
    if (!isSha(g.head_sha)) bad(`${name}.head_sha`)
    if (!['queued', 'in_progress', 'completed'].includes(g.status)) bad(`${name}.status`)
    return { head_sha: g.head_sha, status: g.status, conclusion: g.conclusion ?? null }
  }
  snap.ci_gate = gate(raw.ci_gate, 'ci_gate')
  snap.staging_gate = gate(raw.staging_gate, 'staging_gate')
  if (raw.staging_candidate) {
    const c = raw.staging_candidate
    // run_head_sha (the workflow run's head, i.e. main) is deliberately NOT carried: it must never stand in for the candidate's code SHA.
    if (!isSha(c.candidate_sha) || !Number.isInteger(c.pr_number)) bad('staging_candidate needs candidate_sha and pr_number')
    snap.staging_candidate = { candidate_sha: c.candidate_sha, pr_number: c.pr_number, branch: String(c.branch ?? '') }
  }
  for (const part of [snap.pr, snap.ci_gate, snap.staging_candidate, snap.staging_gate]) if (part) Object.freeze(part)
  Object.freeze(snap)
  VERIFIED.add(snap)
  return snap
}
export const isVerifiedRemote = (r) => r !== null && typeof r === 'object' && VERIFIED.has(r)
