// Markdown rendering for the tracking issue and the job summary. All dynamic text is escaped and
// length-bounded: dependency names and versions come from manifest diffs, never raw PR prose.
const esc = (value, max = 160) => String(value ?? '').replace(/[|\r\n`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).replace(/</g, '&lt;').replace(/>/g, '&gt;')
const short = (sha) => (sha ? sha.slice(0, 7) : '-')

const STATUS_LABEL = {
  queued: 'queued', 'waiting-ci': 'waiting for CI', 'waiting-staging': 'waiting for Staging', updating: 'branch updating', repairing: 'repair in progress',
  verified: 'verified', blocked: 'blocked', superseded: 'superseded', merged: 'merged', closed: 'closed',
}

function mergePath({ analysis, status, approved }) {
  if (status === 'merged') return 'merged'
  if (analysis.never_automatic) return `human only (${esc([...analysis.categories, ...analysis.violations.length ? ['unexpected files'] : []].join(', '), 80)})`
  if (analysis.risk === 'high') return 'human only (high risk)'
  return approved ? 'approved for automatic merge' : 'awaiting approval'
}

/** One row per PR; `view` is the simulated state in planning ticks, the real state otherwise. */
export function renderReport({ state, view = state.prs, analyses, order, edges = [], policy, mainSha, now, notes = [], approvedPrs = new Set() }) {
  const byNumber = new Map(analyses.map((a) => [a.number, a]))
  const rank = new Map(order.map((n, i) => [n, i + 1]))
  const rows = [...analyses].sort((x, y) => (rank.get(x.number) ?? 99) - (rank.get(y.number) ?? 99) || x.number - y.number).map((analysis) => {
    const ps = view[analysis.number]
    const updates = analysis.updates.slice(0, 4).map((u) => `${esc(u.name, 40)} ${esc(u.from, 24)}→${esc(u.to, 24)}`).join('<br>') + (analysis.updates.length > 4 ? `<br>+${analysis.updates.length - 4} more` : '')
    const blocker = ps.blockers.at(-1)
    const detail = ps.status === 'blocked' && blocker ? esc(blocker.detail, 200) : ps.verified ? `CI+Staging @ ${short(ps.verified.head_sha)} on main ${short(ps.verified.base_sha)}` : esc(analysis.reasons.slice(0, 2).join('; '), 160)
    return `| ${rank.get(analysis.number) ?? '-'} | #${analysis.number} | ${updates || '-'} | ${analysis.risk} | ${STATUS_LABEL[ps.status] ?? ps.status} | ${mergePath({ analysis, status: ps.status, approved: approvedPrs.has(analysis.number) })} | ${detail} |`
  })
  const m = state.metrics
  const wallMin = state.batch.started_at ? Math.round((Date.parse(now) - Date.parse(state.batch.started_at)) / 60000) : 0
  const lines = [
    '# Dependency maintenance orchestrator',
    '',
    `Batch \`${state.batch.id ?? 'none'}\` · **${state.batch.status}** · mode \`${state.batch.mode}\` · main \`${short(mainSha)}\` · tick ${state.batch.ticks} · updated ${now}`,
    ...(notes.length ? ['', ...notes.map((n) => `> ${esc(n, 300)}`)] : []),
    '',
    '| Order | PR | Updates | Risk | Status | Merge path | Detail |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    ...(edges.length ? ['', '**Ordering constraints:** ' + edges.map((e) => `#${e.before} before #${e.after} (${esc(e.why, 100)})`).join('; ')] : []),
    '',
    '## Cost and effort',
    `Wall clock ${wallMin} min · CI ${Math.round(m.ci_minutes)} min · Staging ${Math.round(m.staging_minutes)} min · branch updates ${m.branch_updates} · staging dispatches ${m.staging_dispatches} · repair requests ${m.repair_requests} · merges ${m.merges} · Claude invocations ${m.claude_invocations} (~$${m.claude_usd.toFixed(2)} of $${policy.limits.max_claude_usd} cap)`,
    '',
    '## Audit trail (latest 40)',
    ...(state.history.length ? ['| Time | Tick | PR | Action | Outcome | Detail |', '| --- | --- | --- | --- | --- | --- |', ...state.history.slice(-40).map((h) => `| ${h.at} | ${h.tick} | ${h.pr ? `#${h.pr}` : '-'} | ${esc(h.action, 40)} | ${esc(h.outcome, 30)} | ${esc(h.detail, 200)} |`)] : ['_No actions recorded yet._']),
    '',
    '## Controls',
    '- **Pause now:** set repository variable `DEPENDENCY_ORCHESTRATOR_PAUSED=true` (or `paused: true` in the policy). **Resume:** unset it.',
    '- **Hold one PR:** add the `orchestrator-hold` label. The orchestrator never merges without an exact approval in `.github/dependency-orchestrator.policy.json` on `main`.',
  ]
  return lines.join('\n')
}
