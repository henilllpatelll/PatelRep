// Orchestration layer: plan (read-only), execute (one bounded mutation) and merge (exact-SHA, serialized).
// All GitHub I/O goes through an injected `deps` object, so every path is testable with mocks and no
// network. Real implementations live in dependency-orchestrator-deps.mjs.
import { discoverable, planTick } from './dependency-orchestrator-engine.mjs'
import { PACKAGE_NAME, VERSION_TEXT, classifyPr, evaluateMergeGate, extractUpdates, matchApproval, normalizePolicy, parseManifestVersions, updatesKey } from './dependency-orchestrator-policy.mjs'
import { renderReport } from './dependency-orchestrator-report.mjs'
import { emptyState, recordHistory, validateResearchMap } from './dependency-orchestrator-state.mjs'

const same = (a, b) => a && b && a.type === b.type && a.pr === b.pr && a.head_sha === b.head_sha

function approvedPrs(policy, analyses, today) {
  return new Set(analyses.filter((a) => matchApproval({ analysis: a, policy, today }).approval).map((a) => a.number))
}

async function snapshotAndPlan({ deps, ctx }) {
  const policy = normalizePolicy(await deps.readPolicy())
  const prior = await deps.loadState()
  const flags = ctx.flagsFor ? ctx.flagsFor(policy, prior) : ctx.flags
  const snapshot = await deps.readSnapshot(policy, { research: prior?.research ?? {} })
  const result = planTick({ policy, state: prior, snapshot, flags, now: ctx.now })
  return { policy, prior, snapshot, result, flags }
}

const shouldPersist = (prior, result, flags) =>
  flags.start_batch || result.state.batch.status === 'active' || prior?.batch.status === 'active'

/** Read-only planning: never writes. Outputs tell the workflow whether a privileged step is needed. */
export async function runPlan({ deps, ctx }) {
  const { policy, result, snapshot, flags } = await snapshotAndPlan({ deps, ctx })
  const action = result.actions[0] ?? null
  const research = researchTargets({ policy, result, snapshot })
  const body = renderReport({ ...result, state: result.state, policy, mainSha: snapshot.main.sha, now: ctx.now, approvedPrs: approvedPrs(policy, result.analyses, ctx.now.slice(0, 10)) })
  return {
    action,
    research,
    outputs: {
      action_type: action?.type ?? '',
      action_pr: action ? String(action.pr) : '',
      action_head_sha: action?.head_sha ?? '',
      batch_status: result.state.batch.status,
      persist: String(shouldPersist(null, result, flags)),
      research_prs: JSON.stringify(research.map((r) => r.pr)),
    },
    report: body,
    research_input: research,
    result,
  }
}

/** PRs worth a Claude changelog review: risky or major, not yet researched for the current update set. */
function researchTargets({ policy, result, snapshot }) {
  if (!result.mutating) return []
  const budget = policy.limits.max_claude_research_invocations - result.state.metrics.claude_invocations
  if (budget <= 0 || result.state.metrics.claude_usd >= policy.limits.max_claude_usd) return []
  return result.analyses
    .filter((a) => !['superseded', 'closed', 'merged'].includes(result.state.prs[a.number]?.status) && a.updates.length > 0)
    .filter((a) => a.risk !== 'low' || a.updates.some((u) => u.bump === 'major'))
    .filter((a) => result.state.research[a.number]?.updates_key !== updatesKey(a.updates))
    .slice(0, budget)
    .map((a) => ({ pr: a.number, updates_key: updatesKey(a.updates), updates: a.updates.filter((u) => PACKAGE_NAME.test(u.name) || u.ecosystem === 'github-actions').map(({ ecosystem, name, from, to }) => ({ ecosystem, name, from, to })) }))
}

/** Builds Release Engineer instructions from validated tokens only; PR text is never copied. */
export function repairInstructions(action) {
  const safe = action.updates.filter((u) => (PACKAGE_NAME.test(u.name) || u.ecosystem === 'github-actions') && VERSION_TEXT.test(u.from.replace(/^v/, '')) && VERSION_TEXT.test(u.to.replace(/^v/, '')))
  return [
    `Dependency upgrade compatibility repair for PR #${action.pr} (head ${action.head_sha.slice(0, 7)}).`,
    `Upgrades: ${safe.map((u) => `${u.name} ${u.from} -> ${u.to}`).join('; ')}.`,
    'Make the smallest source change that restores the failing check for these upgrades, with a regression test where practical.',
    'Do not edit .github/**, supabase/**, billing or authentication code, lockfiles by hand, or add new dependencies. Do not weaken tests or visual baselines.',
  ].join(' ').slice(0, 1500)
}

async function perform({ deps, action, policy, state, now }) {
  const ps = state.prs[action.pr]
  const dependabotOnly = (await deps.commitAuthors(action.pr)).every((a) => a === 'dependabot[bot]')
  switch (action.type) {
    case 'update_branch': {
      if (policy.branch_update.method === 'dependabot-rebase' && dependabotOnly) {
        await deps.comment(action.pr, '@dependabot rebase')
        break
      }
      const outcome = await deps.updateBranch(action.pr, action.head_sha)
      if (!outcome.ok) {
        // Workflow-file merges need a permission this App deliberately lacks; Dependabot can rebase itself.
        if (dependabotOnly) await deps.comment(action.pr, '@dependabot rebase')
        else throw new Error(`branch update refused: ${outcome.reason}`)
      }
      state.metrics.branch_updates += 1
      break
    }
    case 'dependabot_rebase':
      if (!dependabotOnly) throw new Error('refusing to ask Dependabot to rebase a branch with other authors')
      await deps.comment(action.pr, '@dependabot rebase')
      state.metrics.branch_updates += 1
      break
    case 'dispatch_staging':
      await deps.dispatchWorkflow('staging-candidate.yml', { pr_number: String(action.pr) })
      state.metrics.staging_dispatches += 1
      break
    case 'request_repair':
      await deps.dispatchWorkflow('claude-release-engineer.yml', { failed_run_id: String(action.failed_run_id), instructions: repairInstructions(action) })
      state.metrics.repair_requests += 1
      break
    default:
      throw new Error(`unsupported action ${action.type}`)
  }
  ps.updated_at = now
}

async function accountNewVerifications({ deps, prior, state }) {
  for (const [number, ps] of Object.entries(state.prs)) {
    if (ps.status !== 'verified' || prior?.prs[number]?.status === 'verified' || !ps.verified) continue
    state.metrics.ci_minutes += await deps.runMinutes(ps.verified.ci_run_id).catch(() => 0)
    state.metrics.staging_minutes += await deps.runMinutes(ps.verified.staging_run_id).catch(() => 0)
  }
}

/** The privileged-step entry point: re-plans from fresh state and only executes an identical action. */
export async function runExecute({ deps, ctx, expected }) {
  const { policy, prior, snapshot, result, flags } = await snapshotAndPlan({ deps, ctx })
  const action = result.actions[0] ?? null
  if (expected && !same(action, expected)) return { executed: null, drifted: true, summary: `plan drifted (expected ${expected.type} #${expected.pr}); nothing executed, the next tick will re-plan` }
  if (!expected && action) return { executed: null, drifted: true, summary: 'an action appeared that the read-only plan did not request; nothing executed' }
  let executed = null
  // Merges are never performed by the execute job: they have their own serialized, separately-credentialed job.
  if (action && action.type !== 'merge') {
    try {
      await perform({ deps, action, policy, state: result.state, now: ctx.now })
      executed = { ...action, outcome: 'ok' }
    } catch (error) {
      const detail = String(error.message).split('\n')[0].slice(0, 200)
      recordHistory(result.state, { pr: action.pr, action: action.type, detail, outcome: 'failed' }, ctx.now)
      executed = { ...action, outcome: 'failed', error: detail }
    }
  }
  await accountNewVerifications({ deps, prior, state: result.state })
  const body = renderReport({ ...result, state: result.state, policy, mainSha: snapshot.main.sha, now: ctx.now, notes: result.notes, approvedPrs: approvedPrs(policy, result.analyses, ctx.now.slice(0, 10)) })
  if (shouldPersist(prior, result, flags)) await deps.saveState(result.state, body)
  return { executed, drifted: false, report: body, state: result.state, summary: executed ? `${executed.type} #${executed.pr}: ${executed.outcome}` : 'no action' }
}

/** Serialized, exact-SHA merge. Recomputes the gate from fresh GitHub facts; trusts nothing from plan/state. */
export async function runMerge({ deps, ctx, expected }) {
  const policy = normalizePolicy(await deps.readPolicy())
  const state = (await deps.loadState()) ?? emptyState(ctx.now)
  const snapshot = await deps.readSnapshot(policy, { research: state.research, only: [expected.pr] })
  const pr = snapshot.prs.find((p) => p.number === expected.pr)
  const refuse = (reasons) => ({ merged: false, reasons })
  if (!pr || !discoverable(policy, pr)) return refuse(['PR is not an eligible open same-repository Dependabot PR targeting main'])
  if (pr.head.sha !== expected.head_sha) return refuse(['head SHA moved since planning'])
  if (snapshot.staging_busy) return refuse(['shared staging stack is busy; refusing to merge while a candidate is in flight'])
  if (state.metrics.merges >= policy.limits.max_merges_per_batch) return refuse([`batch merge cap (${policy.limits.max_merges_per_batch}) reached`])
  if (state.batch.status !== 'active') return refuse(['no active batch'])
  const mainVersions = new Map()
  for (const [file, content] of Object.entries(snapshot.main.manifests)) for (const [k, v] of parseManifestVersions(file, content)) mainVersions.set(k, v)
  const analysis = classifyPr({ pr, files: pr.files, mainVersions, policy, research: snapshot.research?.[pr.number]?.updates_key === updatesKey(extractUpdates(pr.files)) ? snapshot.research[pr.number] : null })
  const ps = state.prs[pr.number]
  const gate = evaluateMergeGate({
    policy, analysis, today: ctx.now.slice(0, 10),
    facts: {
      pr, main_sha: snapshot.main.sha, verified: ps?.verified ?? null, contains_main: pr.behind_by === 0,
      checks: { 'CI Gate': pr.checks.ci_gate, 'Database Migration Gate': pr.checks.migration_gate, 'Staging Gate': pr.checks.staging_gate },
      changes_requested: pr.changes_requested, unresolved_threads: pr.unresolved_threads,
      authors_trusted: pr.commit_authors.every((a) => policy.discovery.allowed_commit_authors.includes(a)),
    },
  })
  if (!gate.ok) return refuse(gate.reasons)
  const outcome = await deps.mergePr(pr.number, pr.head.sha)
  const verifiedMerge = await deps.confirmMerge(pr.number, pr.head.sha, snapshot.main.sha)
  if (!outcome.ok || !verifiedMerge.merged) {
    recordHistory(state, { pr: pr.number, action: 'merge', detail: String(outcome.reason ?? 'post-merge verification failed').slice(0, 200), outcome: 'failed' }, ctx.now)
    await deps.saveState(state, '')
    return { merged: false, reasons: [outcome.reason ?? 'post-merge verification failed'] }
  }
  state.prs[pr.number].status = 'merged'
  state.metrics.merges += 1
  recordHistory(state, { pr: pr.number, action: 'merge', detail: `merged ${pr.head.sha.slice(0, 7)} as ${String(verifiedMerge.merge_commit_sha).slice(0, 7)}; approved by ${gate.approval.approved_by}`, outcome: 'merged' }, ctx.now)
  await deps.saveState(state, '')
  return { merged: true, merge_commit_sha: verifiedMerge.merge_commit_sha, reasons: [] }
}

/** Merges Claude's advisory research into the checkpoint. Only requested PRs and exact update keys are accepted. */
export async function runRecordResearch({ deps, ctx, requested, results, costUsd }) {
  const policy = normalizePolicy(await deps.readPolicy())
  const state = (await deps.loadState()) ?? emptyState(ctx.now)
  const accepted = validateResearchMap(results)
  let recorded = 0
  for (const target of requested) {
    if (!Number.isInteger(target?.pr)) continue
    const entry = accepted[target.pr]
    if (!entry) continue
    state.research[target.pr] = { ...entry, updates_key: String(target.updates_key).slice(0, 400), at: ctx.now }
    recorded += 1
  }
  state.metrics.claude_invocations += requested.length ? 1 : 0
  const cost = Number.isFinite(costUsd) && costUsd >= 0 ? Math.min(costUsd, policy.limits.max_claude_usd) : 0
  state.metrics.claude_usd = Math.min(state.metrics.claude_usd + cost, policy.limits.max_claude_usd)
  recordHistory(state, { action: 'research', detail: `${recorded}/${requested.length} PR(s) reviewed`, outcome: recorded ? 'ok' : 'empty' }, ctx.now)
  await deps.saveState(state, '')
  return { recorded }
}
