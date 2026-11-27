// Developer Harness V3 (D3.6-D) — what the remote must show for each delivery EFFECT. Used by the trusted READER (delivery issuer) to turn a remote view into an observation of one
// recorded intent: `present` (the effect happened), `absent` (it did not — as far as THIS read can tell), or `conflict` (the remote shows something that is neither: a foreign head,
// a second PR, an attempt nobody asked for). The subject is derived from the RECORDED intent parameters, never from the requester.
//
// D3.6 remediation F2 adds the two pure functions the controller and the ledger bind to, so there is ONE definition of "which remote object is this effect about":
//   effectSubject(action, params)       the exact observation subject of the effect (the ledger rejects an observation about any other subject, whatever else it matches)
//   confirmResponse(action, params, v)  the ACTION-SPECIFIC positive confirmation a direct response must carry. A non-array object with no explicit error is NOT enough.

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
const posInt = (x) => Number.isSafeInteger(x) && x > 0
const str = (x) => typeof x === 'string' && x.length > 0 && x.length <= 200

/** @returns {string|null} the subject, or null when `action` is not a delivery effect; throws 'SUBJECT.UNDERIVABLE' for a delivery effect whose recorded parameters cannot name its object. */
export function effectSubject(action, params) {
  const p = params ?? {}; const bad = () => { throw new Error('SUBJECT.UNDERIVABLE') }
  switch (action) {
    case 'publish_candidate_branch': return str(p.branch) ? `ref:${p.branch}` : bad()
    case 'open_draft_pull_request': return str(p.head) ? `pr_head:${p.head}` : bad()
    case 'update_pull_request_metadata': return posInt(p.number) ? `pr:${p.number}` : bad()
    case 'mark_pull_request_ready': return posInt(p.number) ? `pr_ready:${p.number}` : bad()
    case 'rerun_ci_jobs': return posInt(p.run_id) ? `run:${p.run_id}` : bad()
    case 'dispatch_staging_candidate': return posInt(p.pr_number) ? `staging_dispatch:${p.pr_number}` : bad()
    default: return null
  }
}
export const DELIVERY_EFFECTS = Object.freeze(['publish_candidate_branch', 'open_draft_pull_request', 'update_pull_request_metadata', 'mark_pull_request_ready', 'rerun_ci_jobs', 'dispatch_staging_candidate'])

/**
 * The simulated adapter contract: every direct response must POSITIVELY confirm the exact remote object the effect was about. Anything else — empty object, unrelated fields, an explicit
 * error, another branch / sha / PR / run — is NOT a success: the intent stays UNCERTAIN and is reconciled from authenticated reads.
 * @returns {{ok:true}|{ok:false, code:string}}
 */
export function confirmResponse(action, params, v) {
  if (!isObj(v)) return { ok: false, code: 'PUBLISHER.UNRECOGNIZED_RESPONSE' }
  if (v.ok === false || v.error) return { ok: false, code: 'PUBLISHER.UNRECOGNIZED_RESPONSE' }
  const p = params ?? {}; const wrong = { ok: false, code: 'PUBLISHER.WRONG_REMOTE_OBJECT' }; const unconfirmed = { ok: false, code: 'PUBLISHER.UNCONFIRMED_RESPONSE' }
  switch (action) {
    case 'publish_candidate_branch': if (v.ref === undefined || v.sha === undefined) return unconfirmed; return v.ref === p.branch && v.sha === p.sha ? { ok: true } : wrong
    case 'open_draft_pull_request': return posInt(v.number) ? { ok: true } : unconfirmed // the NUMBER is learned from the authenticated observation of the PR, never from this body
    case 'update_pull_request_metadata':
    case 'mark_pull_request_ready': if (v.number === undefined) return unconfirmed; return v.number === p.number ? { ok: true } : wrong
    case 'rerun_ci_jobs': if (v.run_id === undefined || v.attempt === undefined) return unconfirmed; return v.run_id === p.run_id && v.attempt === p.attempt + 1 ? { ok: true } : wrong
    case 'dispatch_staging_candidate': return v.accepted === true ? { ok: true } : unconfirmed
    default: return unconfirmed // an action this module does not know can never be confirmed by a response
  }
}

export function observeEffect(action, params, view, { dispatchedAt = null } = {}) {
  const p = params ?? {}
  let subject; try { subject = effectSubject(action, p) } catch { return { subject: `unknown:${String(action).slice(0, 40)}`, state: 'conflict', details: { underivable_subject: true } } }
  switch (action) {
    case 'publish_candidate_branch': {
      const ref = view.refs[p.branch] ?? null
      return { subject, state: ref === p.sha ? 'present' : ref === (p.expected_old ?? null) ? 'absent' : 'conflict', remote_version: ref, details: { ref } }
    }
    case 'open_draft_pull_request': {
      const open = view.prs.filter((x) => x.head_ref === p.head && x.state === 'open')
      if (!open.length) return { subject, state: 'absent', details: { open: 0 } }
      const pr = open[0]; const ours = open.length === 1 && pr.base_ref === p.base && pr.head_sha === p.head_sha && pr.author === p.author
      return { subject, state: ours ? 'present' : 'conflict', remote_version: String(pr.updated_at), details: { open: open.length, number: pr.number, base: pr.base_ref, head_sha: pr.head_sha, author: pr.author } }
    }
    case 'update_pull_request_metadata': {
      const pr = view.prs.find((x) => x.number === p.number && x.state === 'open')
      if (!pr) return { subject, state: 'conflict', details: { missing: true } }
      const now = pr.title === p.title && pr.body_digest === p.body_digest; const before = pr.title === p.from?.title && pr.body_digest === p.from?.body_digest
      return { subject, state: now ? 'present' : before ? 'absent' : 'conflict', remote_version: String(pr.updated_at), details: {} }
    }
    case 'mark_pull_request_ready': {
      const pr = view.prs.find((x) => x.number === p.number && x.state === 'open')
      if (!pr) return { subject, state: 'conflict', details: { missing: true } }
      return { subject, state: pr.draft === false ? 'present' : 'absent', remote_version: String(pr.updated_at), details: {} }
    }
    case 'rerun_ci_jobs': {
      const run = view.runs.find((x) => x.id === p.run_id)
      if (!run || run.head_sha !== p.head_sha) return { subject, state: 'conflict', details: { missing: !run } }
      return { subject, state: run.attempt > p.attempt ? (run.attempt === p.attempt + 1 ? 'present' : 'conflict') : run.status === 'completed' ? 'absent' : 'conflict', remote_version: String(run.attempt), details: { attempt: run.attempt } }
    }
    case 'dispatch_staging_candidate': {
      const runs = view.runs.filter((x) => x.workflow === '.github/workflows/staging-candidate.yml' && x.event === 'workflow_dispatch' && x.pr_number === p.pr_number && x.head_sha === p.head_sha && dispatchedAt !== null && x.created_at >= dispatchedAt)
      return { subject, state: runs.length === 1 ? 'present' : runs.length === 0 ? 'absent' : 'conflict', details: { runs: runs.map((r) => r.id) } }
    }
    default: return { subject: `unknown:${String(action).slice(0, 40)}`, state: 'conflict', details: { unknown_action: true } }
  }
}
