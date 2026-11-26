// Developer Harness V3 (D3.6-D) — what the remote must show for each delivery EFFECT. Used by the trusted READER (delivery issuer) to turn a remote view into an observation of one
// recorded intent: `present` (the effect happened), `absent` (it did not — as far as THIS read can tell), or `conflict` (the remote shows something that is neither: a foreign head,
// a second PR, an attempt nobody asked for). The subject is derived from the RECORDED intent parameters, never from the requester.
export function observeEffect(action, params, view, { dispatchedAt = null } = {}) {
  const p = params ?? {}
  switch (action) {
    case 'publish_candidate_branch': {
      const ref = view.refs[p.branch] ?? null
      return { subject: `ref:${p.branch}`, state: ref === p.sha ? 'present' : ref === (p.expected_old ?? null) ? 'absent' : 'conflict', remote_version: ref, details: { ref } }
    }
    case 'open_draft_pull_request': {
      const open = view.prs.filter((x) => x.head_ref === p.head && x.state === 'open')
      if (!open.length) return { subject: `pr_head:${p.head}`, state: 'absent', details: { open: 0 } }
      const pr = open[0]; const ours = open.length === 1 && pr.base_ref === p.base && pr.head_sha === p.head_sha && pr.author === p.author
      return { subject: `pr_head:${p.head}`, state: ours ? 'present' : 'conflict', remote_version: String(pr.updated_at), details: { open: open.length, number: pr.number, base: pr.base_ref, head_sha: pr.head_sha, author: pr.author } }
    }
    case 'update_pull_request_metadata': {
      const pr = view.prs.find((x) => x.number === p.number && x.state === 'open')
      if (!pr) return { subject: `pr:${p.number}`, state: 'conflict', details: { missing: true } }
      const now = pr.title === p.title && pr.body_digest === p.body_digest; const before = pr.title === p.from?.title && pr.body_digest === p.from?.body_digest
      return { subject: `pr:${p.number}`, state: now ? 'present' : before ? 'absent' : 'conflict', remote_version: String(pr.updated_at), details: {} }
    }
    case 'mark_pull_request_ready': {
      const pr = view.prs.find((x) => x.number === p.number && x.state === 'open')
      if (!pr) return { subject: `pr_ready:${p.number}`, state: 'conflict', details: { missing: true } }
      return { subject: `pr_ready:${p.number}`, state: pr.draft === false ? 'present' : 'absent', remote_version: String(pr.updated_at), details: {} }
    }
    case 'rerun_ci_jobs': {
      const run = view.runs.find((x) => x.id === p.run_id)
      if (!run || run.head_sha !== p.head_sha) return { subject: `run:${p.run_id}`, state: 'conflict', details: { missing: !run } }
      return { subject: `run:${p.run_id}`, state: run.attempt > p.attempt ? (run.attempt === p.attempt + 1 ? 'present' : 'conflict') : run.status === 'completed' ? 'absent' : 'conflict', remote_version: String(run.attempt), details: { attempt: run.attempt } }
    }
    case 'dispatch_staging_candidate': {
      const runs = view.runs.filter((x) => x.workflow === '.github/workflows/staging-candidate.yml' && x.event === 'workflow_dispatch' && x.pr_number === p.pr_number && x.head_sha === p.head_sha && dispatchedAt !== null && x.created_at >= dispatchedAt)
      return { subject: `staging_dispatch:${p.pr_number}`, state: runs.length === 1 ? 'present' : runs.length === 0 ? 'absent' : 'conflict', details: { runs: runs.map((r) => r.id) } }
    }
    default: return { subject: `unknown:${String(action).slice(0, 40)}`, state: 'conflict', details: { unknown_action: true } }
  }
}
