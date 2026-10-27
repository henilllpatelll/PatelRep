// Pure decision engine: (policy, checkpoint state, GitHub snapshot) -> (next state, at most one
// mutating action). No I/O and no secrets, so the same function plans and is exhaustively testable.
//
// Snapshot contract (built by dependency-orchestrator-deps.mjs from live GitHub state):
//   main:            { sha, manifests: { path: content } }
//   prs:             [{ number, state, draft, user, head:{sha,ref,repo}, base:{ref}, labels[], mergeable_state,
//                       behind_by, commit_authors[], files:[{filename,patch}], changes_requested, unresolved_threads,
//                       checks:{ ci_gate, migration_gate, staging_gate: {status,conclusion,run_id,head_sha}|null, failing[] },
//                       repair_in_flight }]
//   staging_busy:    true when ANY Staging Candidate run is queued or in progress (shared single stack)
//   compat:          registry peer-dependency info keyed "eco:name@version"
//   research:        { [prNumber]: advisory research (may only raise risk) }
import {
  classifyPr, compatibilityProblems, evaluateMergeGate, extractUpdates, orderQueue, parseManifestVersions, updatesKey,
} from './dependency-orchestrator-policy.mjs'
import {
  TERMINAL_STATUSES, attemptsLeft, block, consumeAttempt, emptyPr, emptyState, recordHistory,
} from './dependency-orchestrator-state.mjs'

const HOLD_LABELS = new Set(['do-not-merge', 'do not merge', 'hold', 'manual-review', 'needs-human', 'orchestrator-hold'])
const MINUTES = 60_000
const CI_TIMEOUT_MIN = 120
const CI_START_GRACE_MIN = 25
const STAGING_START_GRACE_MIN = 45
const ROOM_BOARD = 'Room-Board Pixel-Diff Regression'
const REPAIR_BLOCKED = new Set(['github-actions', 'database', 'auth-security', 'billing'])

const minutesSince = (iso, now) => (iso ? (Date.parse(now) - Date.parse(iso)) / MINUTES : 0)

function mainVersionsFrom(main) {
  const versions = new Map()
  for (const [file, content] of Object.entries(main.manifests)) {
    try { for (const [k, v] of parseManifestVersions(file, content)) versions.set(k, v) } catch { /* unparseable manifest on main: no versions, never throws */ }
  }
  return versions
}

function trustedAuthors(policy, pr) {
  return pr.commit_authors.every((login) => policy.discovery.allowed_commit_authors.includes(login))
}

export function discoverable(policy, pr) {
  return pr.state === 'open' && pr.base.ref === 'main' && policy.discovery.authors.includes(pr.user.login) &&
    pr.head.ref.startsWith(policy.discovery.head_prefix) && pr.head.repo === pr.base.repo
}

/** Starts, continues or refuses a batch. Human dispatch is the only way a `process` batch begins. */
function resolveBatch(state, { policy, flags, now }) {
  const { batch } = state
  const expired = batch.status === 'active' && (Date.parse(now) > Date.parse(batch.deadline_at) || batch.ticks >= policy.limits.max_ticks_per_batch)
  if (expired) { batch.status = 'halted'; batch.finished_at = now; recordHistory(state, { action: 'batch-halt', detail: 'deadline or tick budget exhausted', outcome: 'halted' }, now) }
  const wantsStart = flags.start_batch && (batch.status !== 'active' || flags.restart)
  if (wantsStart) {
    const fresh = emptyState(now)
    Object.assign(state, { prs: {}, order: [], history: state.history, metrics: fresh.metrics })
    state.batch = {
      id: `batch-${now.replace(/\D/g, '').slice(0, 14)}`, status: flags.mode === 'process' ? 'active' : 'complete', mode: flags.mode,
      started_at: now, deadline_at: new Date(Date.parse(now) + policy.limits.max_batch_hours * 3600_000).toISOString(),
      ticks: 0, requested_prs: flags.requested_prs ?? null, last_tick_at: now, finished_at: null,
    }
    recordHistory(state, { action: 'batch-start', detail: `mode=${flags.mode}${flags.requested_prs ? ` prs=${flags.requested_prs.join(',')}` : ''}`, outcome: 'started' }, now)
  }
  if (state.batch.status === 'active') { state.batch.ticks += 1; state.batch.last_tick_at = now }
}

export function planTick({ policy, state: prior = null, snapshot, flags, now }) {
  const state = structuredClone(prior ?? emptyState(now))
  resolveBatch(state, { policy, flags, now })
  const batch = state.batch
  const paused = policy.paused || flags.paused_var === true
  const mutating = !paused && policy.mutation_enabled && batch.status === 'active' && batch.mode === 'process'
  const notes = []
  if (paused) notes.push('paused: no actions will be taken')
  else if (!policy.mutation_enabled) notes.push('mutation_enabled is false in policy: planning only')

  const mainVersions = mainVersionsFrom(snapshot.main)
  const candidates = snapshot.prs.filter((pr) => discoverable(policy, pr)).filter((pr) => !batch.requested_prs || batch.requested_prs.includes(pr.number)).slice(0, policy.discovery.max_prs)
  const prData = new Map(candidates.map((pr) => [pr.number, pr]))
  // Advisory research applies only to the exact update set it reviewed.
  const researchFor = (pr) => {
    const research = snapshot.research?.[pr.number]
    return research && research.updates_key === updatesKey(extractUpdates(pr.files)) ? research : null
  }
  const analyses = candidates.map((pr) => classifyPr({ pr, files: pr.files, mainVersions, policy, research: researchFor(pr) }))
  const { problems, edges } = compatibilityProblems({ analyses, mainVersions, policy, compat: snapshot.compat })

  for (const analysis of analyses) {
    const ps = state.prs[analysis.number] ?? (state.prs[analysis.number] = emptyPr(analysis.number))
    const pr = prData.get(analysis.number)
    const headChanged = ps.head_sha !== null && ps.head_sha !== pr.head.sha
    if (headChanged) { ps.wait_since = null; ps.staging_dispatched_for = null }
    ps.head_sha = pr.head.sha
    ps.risk = analysis.risk
    if (ps.status === 'merged' || ps.status === 'closed') continue
    // Static blockers are recomputed every tick so a fixed cause (e.g. a removed hold label) unblocks the PR;
    // dynamic blockers (ci-failed, ...) clear only when the head SHA changes. Attempt counters bound any loop.
    if (ps.status === 'blocked' && (headChanged || (ps.blockers.at(-1)?.code ?? '').startsWith('static:'))) ps.status = 'queued'
    if (ps.status === 'superseded' && !analysis.all_redundant) ps.status = 'queued'
    const hold = pr.labels.find((l) => HOLD_LABELS.has(l.toLowerCase()))
    if (analysis.all_redundant) { ps.status = 'superseded'; ps.updated_at = now }
    else if (!trustedAuthors(policy, pr)) block(ps, 'static:untrusted-commit-author', `commits by: ${[...new Set(pr.commit_authors)].filter((a) => !policy.discovery.allowed_commit_authors.includes(a)).join(', ')}`, now)
    else if (hold) block(ps, 'static:hold-label', `label "${hold}" present`, now)
    else if (problems.has(analysis.number)) block(ps, 'static:incompatible', problems.get(analysis.number).join('; '), now)
  }
  for (const [number, ps] of Object.entries(state.prs)) {
    if (!prData.has(Number(number)) && !TERMINAL_STATUSES.has(ps.status)) { ps.status = 'closed'; ps.updated_at = now; recordHistory(state, { pr: Number(number), action: 'observe', detail: 'PR no longer open or eligible', outcome: 'closed' }, now) }
  }

  const live = analyses.filter((a) => !['superseded', 'closed', 'merged'].includes(state.prs[a.number].status))
  const { order, cyclic } = orderQueue(live, edges.filter((e) => live.some((a) => a.number === e.before) && live.some((a) => a.number === e.after)))
  for (const number of cyclic) block(state.prs[number], 'static:dependency-cycle', 'circular dependency between queued PRs', now)
  // A PR that needs another PR's upgrade is held while that provider is blocked or human-only.
  for (const edge of edges) {
    const [provider, dependent] = [state.prs[edge.before], state.prs[edge.after]]
    const providerAnalysis = analyses.find((a) => a.number === edge.before)
    if (provider && dependent && (provider.status === 'blocked' || providerAnalysis?.never_automatic)) block(dependent, 'static:needs-dependency', `${edge.why}; waits for #${edge.before}`, now)
  }
  state.order = order

  const actions = []
  const analysisByNumber = new Map(analyses.map((a) => [a.number, a]))
  // Planning-only ticks run the same progression on a scratch copy so attempt budgets are never consumed.
  const sim = mutating ? state : structuredClone(state)
  if (batch.status === 'active' || !mutating) {
    for (const number of order) {
      const ps = sim.prs[number]
      const stale = ps.status === 'verified' && staleVerification(ps, prData.get(number), snapshot.main.sha)
      if (TERMINAL_STATUSES.has(ps.status) && !(stale && batch.status === 'active' && mutating)) continue
      const outcome = advance({ state: sim, ps, pr: prData.get(number), analysis: analysisByNumber.get(number), policy, snapshot, now, mutating })
      if (outcome.action) { actions.push(outcome.action); break }
      if (outcome.stop) break
    }
  }

  if (mutating && policy.merge.mode === 'approved-only' && actions.length === 0) {
    for (const number of order) {
      const ps = state.prs[number]
      if (ps.status !== 'verified' || !ps.verified) continue
      const pr = prData.get(number)
      const gate = evaluateMergeGate({ policy, analysis: analysisByNumber.get(number), facts: mergeFacts(pr, ps, snapshot, policy), today: now.slice(0, 10) })
      if (gate.ok) { actions.push({ type: 'merge', pr: number, head_sha: pr.head.sha }); break }
    }
  }

  const open = Object.values(state.prs).filter((ps) => !TERMINAL_STATUSES.has(ps.status))
  if (batch.status === 'active' && open.length === 0 && actions.length === 0) {
    batch.status = 'complete'; batch.finished_at = now
    recordHistory(state, { action: 'batch-complete', detail: `${Object.keys(state.prs).length} PR(s) reached a terminal state`, outcome: 'complete' }, now)
  }
  if (batch.status === 'halted') for (const ps of open) block(ps, 'batch-limit', 'batch deadline or tick budget reached before this PR finished', now)
  state.updated_at = now
  return { state, view: sim.prs, analyses, order, edges, actions, notes, mutating }
}

function staleVerification(ps, pr, mainSha) {
  return !ps.verified || ps.verified.head_sha !== pr.head.sha || ps.verified.base_sha !== mainSha
}

function mergeFacts(pr, ps, snapshot, policy) {
  return {
    pr: { ...pr, state: pr.state },
    main_sha: snapshot.main.sha,
    checks: {
      'CI Gate': pr.checks.ci_gate, 'Database Migration Gate': pr.checks.migration_gate, 'Staging Gate': pr.checks.staging_gate,
    },
    verified: ps.verified,
    contains_main: pr.behind_by === 0,
    changes_requested: pr.changes_requested,
    unresolved_threads: pr.unresolved_threads,
    authors_trusted: trustedAuthors(policy, pr),
  }
}

function advance({ state, ps, pr, analysis, policy, snapshot, now, mutating }) {
  const { limits } = policy
  const mainSha = snapshot.main.sha
  const checks = pr.checks
  const act = (action, status, detail) => {
    ps.status = status
    ps.updated_at = now
    if (mutating) recordHistory(state, { pr: ps.number, action: action.type, detail, outcome: 'dispatched' }, now)
    return { action: mutating ? action : null, stop: true, detail }
  }
  const wait = (status, detail) => {
    ps.status = status
    ps.wait_since ??= now
    ps.updated_at = now
    return { stop: true, detail }
  }

  if (ps.status === 'verified' && staleVerification(ps, pr, mainSha)) {
    if (ps.attempts.reverify >= limits.max_reverifications_per_pr) { block(ps, 'reverify-limit', 'main moved repeatedly; verification is stale', now); return {} }
    ps.attempts.reverify += 1; ps.verified = null; ps.status = 'queued'
    recordHistory(state, { pr: ps.number, action: 'invalidate-verification', detail: 'head or main changed', outcome: 'stale' }, now)
  }

  if (pr.mergeable_state === 'dirty') {
    const dependabotOnly = pr.commit_authors.every((a) => a === 'dependabot[bot]')
    if (dependabotOnly && attemptsLeft(ps, 'update_branch', limits.max_branch_updates_per_pr, mainSha) > 0) {
      consumeAttempt(ps, 'update_branch', mainSha)
      return act({ type: 'dependabot_rebase', pr: ps.number, head_sha: pr.head.sha }, 'updating', 'merge conflict: asking Dependabot to rebase')
    }
    block(ps, 'merge-conflict', 'branch conflicts with main and cannot be rebased by Dependabot', now)
    return {}
  }
  if (pr.behind_by > 0) {
    if (attemptsLeft(ps, 'update_branch', limits.max_branch_updates_per_pr, mainSha) <= 0) { block(ps, 'update-limit', 'branch update budget exhausted for this main revision', now); return {} }
    consumeAttempt(ps, 'update_branch', mainSha)
    ps.wait_since = null
    return act({ type: 'update_branch', pr: ps.number, head_sha: pr.head.sha, method: policy.branch_update.method }, 'updating', `behind main by ${pr.behind_by}`)
  }

  const ci = checks.ci_gate
  if (!ci || ci.status !== 'completed') {
    if (!ci && !checks.ci_pending && minutesSince(ps.wait_since, now) > CI_START_GRACE_MIN) { block(ps, 'ci-not-started', 'no CI run appeared for this head SHA', now); return {} }
    if (minutesSince(ps.wait_since, now) > CI_TIMEOUT_MIN) { block(ps, 'ci-timeout', `CI still running after ${CI_TIMEOUT_MIN} minutes`, now); return {} }
    return wait('waiting-ci', 'CI pending')
  }
  if (ci.conclusion !== 'success') return failed({ state, ps, pr, analysis, policy, now, mutating, kind: 'ci' })
  if (checks.migration_gate?.conclusion !== 'success') { block(ps, 'migration-gate', 'Database Migration Gate has not succeeded for this head', now); return {} }

  const staging = checks.staging_gate
  if (staging && staging.head_sha === pr.head.sha) {
    if (staging.status !== 'completed') return wait('waiting-staging', 'Staging Gate running')
    if (staging.conclusion === 'success') {
      ps.status = 'verified'; ps.wait_since = null; ps.updated_at = now
      ps.verified = { head_sha: pr.head.sha, base_sha: mainSha, ci_run_id: ci.run_id ?? 0, staging_run_id: staging.run_id ?? 0, at: now }
      recordHistory(state, { pr: ps.number, action: 'verify', detail: `CI+Staging green at ${pr.head.sha.slice(0, 7)} on main ${mainSha.slice(0, 7)}`, outcome: 'verified' }, now)
      return {}
    }
    return failed({ state, ps, pr, analysis, policy, now, mutating, kind: 'staging' })
  }
  if (snapshot.staging_busy) return wait('waiting-staging', 'shared staging stack busy; serialized')
  if (ps.staging_dispatched_for === pr.head.sha) {
    if (minutesSince(ps.wait_since, now) > STAGING_START_GRACE_MIN) { block(ps, 'staging-not-started', 'Staging Candidate did not report a gate for this head', now); return {} }
    return wait('waiting-staging', 'staging dispatched; waiting for the gate')
  }
  if (attemptsLeft(ps, 'staging', limits.max_staging_dispatches_per_pr) <= 0) { block(ps, 'staging-limit', 'staging dispatch budget exhausted', now); return {} }
  consumeAttempt(ps, 'staging')
  ps.staging_dispatched_for = pr.head.sha
  ps.wait_since = now
  return act({ type: 'dispatch_staging', pr: ps.number, head_sha: pr.head.sha }, 'waiting-staging', 'CI Gate green; dispatching Staging Candidate')
}

function failed({ state, ps, pr, analysis, policy, now, mutating, kind }) {
  const failing = pr.checks.failing
  const onlyRoomBoard = kind === 'ci' && failing.length > 0 && failing.every((name) => name === ROOM_BOARD || name === 'CI Gate')
  if (onlyRoomBoard) {
    block(ps, 'ci-infra-room-board', 'Only the live-tenant Room-Board regression failed: Dependabot runs cannot receive its fixture credentials. Refresh this branch after the hermetic Room-Board gate is on main; no repair spend.', now)
    return {}
  }
  if (pr.repair_in_flight) { ps.status = 'repairing'; ps.wait_since ??= now; return { stop: true } }
  const repairAllowed = policy.repair?.dispatch_release_engineer && !analysis.categories.some((c) => REPAIR_BLOCKED.has(c)) && attemptsLeft(ps, 'repair', policy.limits.max_repair_requests_per_pr) > 0
  if (!repairAllowed) {
    block(ps, `${kind}-failed`, `${kind === 'ci' ? 'CI' : 'Staging'} failed (${failing.slice(0, 6).join(', ') || 'gate'}); automated repair is not authorized or exhausted`, now)
    return {}
  }
  consumeAttempt(ps, 'repair')
  ps.status = 'repairing'; ps.wait_since = now; ps.updated_at = now
  const detail = `${kind} failed (${failing.slice(0, 6).join(', ') || 'gate'}); requesting the Release Engineer`
  if (mutating) recordHistory(state, { pr: ps.number, action: 'request_repair', detail, outcome: 'dispatched' }, now)
  return { action: mutating ? { type: 'request_repair', pr: ps.number, head_sha: pr.head.sha, failed_run_id: pr.checks.ci_gate?.run_id ?? 0, kind, updates: analysis.updates.map(({ ecosystem, name, from, to }) => ({ ecosystem, name, from, to })) } : null, stop: true }
}
