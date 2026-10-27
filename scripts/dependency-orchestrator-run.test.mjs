import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveFlags, parseRequestedPrs } from './dependency-orchestrator-flags.mjs'
import { repairInstructions, runExecute, runMerge, runPlan, runRecordResearch } from './dependency-orchestrator-run.mjs'
import { emptyState } from './dependency-orchestrator-state.mjs'
import { MAIN, NOW, SHA, green, lowPatchPr, policyWith, prFixture, processFlags, snapshotWith } from './dependency-orchestrator-fixtures.mjs'

/** A fully mocked GitHub: records every write so tests can assert exactly what was (not) done. */
function mockDeps({ policy = policyWith(), snapshot, state = null, writes = [], failOn = {} } = {}) {
  const saved = []
  const deps = {
    writes, saved,
    readPolicy: async () => ({ version: 1, ...structuredClone(policy) }),
    loadState: async () => (state ? structuredClone(state) : null),
    saveState: async (next, body) => { saved.push({ next: structuredClone(next), body }); state = structuredClone(next); return 1 },
    readSnapshot: async (_policy, opts) => ({ ...structuredClone(snapshot), prs: snapshot.prs.filter((p) => !opts?.only || opts.only.includes(p.number)).map((p) => structuredClone(p)) }),
    commitAuthors: async (n) => snapshot.prs.find((p) => p.number === n).commit_authors,
    updateBranch: async (pr, sha) => { if (failOn.updateBranch) return { ok: false, reason: failOn.updateBranch }; writes.push(['updateBranch', pr, sha]); return { ok: true } },
    comment: async (pr, body) => { writes.push(['comment', pr, body]) },
    dispatchWorkflow: async (file, inputs) => { if (failOn.dispatch) throw new Error('boom'); writes.push(['dispatch', file, inputs]) },
    runMinutes: async () => 12,
    mergePr: async (pr, sha) => { writes.push(['merge', pr, sha]); return failOn.merge ? { ok: false, reason: failOn.merge } : { ok: true } },
    confirmMerge: async (_pr, sha, base) => ({ merged: !failOn.confirm, merge_commit_sha: SHA('face'), sha, base }),
  }
  return deps
}
const ctxFor = (flags, now = NOW) => ({ now, flags })

test('plan is read-only: it never calls a write dependency, even for a process batch', async () => {
  const pr = lowPatchPr(1)
  pr.behind_by = 1
  const deps = mockDeps({ snapshot: snapshotWith([pr]) })
  const plan = await runPlan({ deps, ctx: ctxFor(processFlags()) })
  assert.equal(plan.outputs.action_type, 'update_branch')
  assert.deepEqual(deps.writes, [])
  assert.deepEqual(deps.saved, [], 'planning does not even persist state')
})

test('execute performs exactly the planned action and checkpoints it', async () => {
  const pr = lowPatchPr(1)
  pr.behind_by = 1
  const deps = mockDeps({ snapshot: snapshotWith([pr]) })
  const result = await runExecute({ deps, ctx: ctxFor(processFlags()), expected: { type: 'update_branch', pr: 1, head_sha: SHA(1) } })
  assert.equal(result.executed.outcome, 'ok')
  assert.deepEqual(deps.writes, [['updateBranch', 1, SHA(1)]])
  assert.equal(deps.saved.length, 1)
  assert.equal(deps.saved[0].next.metrics.branch_updates, 1)
  assert.equal(deps.saved[0].next.prs[1].attempts.update_branch, 1)
})

test('execute refuses to act when fresh state no longer matches the read-only plan', async () => {
  const pr = lowPatchPr(1)
  pr.behind_by = 1
  const deps = mockDeps({ snapshot: snapshotWith([pr]) })
  const drift = await runExecute({ deps, ctx: ctxFor(processFlags()), expected: { type: 'update_branch', pr: 1, head_sha: SHA(999) } })
  assert.equal(drift.drifted, true)
  assert.deepEqual(deps.writes, [])
  assert.deepEqual(deps.saved, [], 'a drifted plan consumes no attempt budget')
  const surprise = await runExecute({ deps, ctx: ctxFor(processFlags()), expected: null })
  assert.equal(surprise.drifted, true)
  assert.deepEqual(deps.writes, [])
})

test('a failed write is recorded and its attempt stays consumed, so transient failures cannot loop', async () => {
  const pr = lowPatchPr(1)
  pr.checks = { ci_gate: { status: 'completed', conclusion: 'success', run_id: 4, head_sha: SHA(1) }, migration_gate: green(SHA(1)), staging_gate: null, failing: [] }
  const deps = mockDeps({ snapshot: snapshotWith([pr]), failOn: { dispatch: true } })
  const result = await runExecute({ deps, ctx: ctxFor(processFlags()), expected: { type: 'dispatch_staging', pr: 1, head_sha: SHA(1) } })
  assert.equal(result.executed.outcome, 'failed')
  assert.equal(deps.saved[0].next.prs[1].attempts.staging, 1)
  assert.equal(deps.saved[0].next.history.at(-1).outcome, 'failed')
})

test('branch update refusal falls back to a Dependabot rebase for Dependabot-only branches, never for edited ones', async () => {
  const pr = lowPatchPr(1)
  pr.behind_by = 1
  const deps = mockDeps({ snapshot: snapshotWith([pr]), failOn: { updateBranch: 'workflow permission' } })
  await runExecute({ deps, ctx: ctxFor(processFlags()), expected: { type: 'update_branch', pr: 1, head_sha: SHA(1) } })
  assert.deepEqual(deps.writes, [['comment', 1, '@dependabot rebase']])

  const edited = lowPatchPr(2)
  edited.behind_by = 1
  edited.commit_authors = ['dependabot[bot]', 'patelrep-release-engineer[bot]']
  const deps2 = mockDeps({ snapshot: snapshotWith([edited]), failOn: { updateBranch: 'conflict' } })
  const result = await runExecute({ deps: deps2, ctx: ctxFor(processFlags()), expected: { type: 'update_branch', pr: 2, head_sha: SHA(2) } })
  assert.equal(result.executed.outcome, 'failed')
  assert.deepEqual(deps2.writes, [])
})

test('repair requests carry only validated structured text, never PR prose', async () => {
  const hostile = { type: 'request_repair', pr: 9, head_sha: SHA(9), failed_run_id: 5, updates: [
    { ecosystem: 'npm', name: 'clsx', from: '2.1.0', to: '2.2.0' },
    { ecosystem: 'npm', name: 'evil; rm -rf /', from: '1', to: '2' },
    { ecosystem: 'pip', name: 'ok-pkg', from: '1.0', to: '2.0 $(curl x)' },
  ] }
  const text = repairInstructions(hostile)
  assert.match(text, /clsx 2\.1\.0 -> 2\.2\.0/)
  assert.doesNotMatch(text, /rm -rf|curl|\$\(/)
  assert.match(text, /Do not edit \.github/)
})

test('dispatches only the existing staging and release-engineer workflows', async () => {
  const pr = prFixture(9, { name: 'clsx', from: '2.1.0', to: '2.2.0' })
  pr.checks = { ci_gate: { status: 'completed', conclusion: 'failure', run_id: 55, head_sha: SHA(9) }, migration_gate: green(SHA(9)), staging_gate: null, failing: ['Test / Web unit', 'CI Gate'] }
  const deps = mockDeps({ snapshot: snapshotWith([pr]) })
  await runExecute({ deps, ctx: ctxFor(processFlags()), expected: { type: 'request_repair', pr: 9, head_sha: SHA(9) } })
  const [kind, file, inputs] = deps.writes[0]
  assert.equal(kind, 'dispatch')
  assert.equal(file, 'claude-release-engineer.yml')
  assert.equal(inputs.failed_run_id, '55')
  assert.ok(!deps.writes.some(([k, f]) => k === 'dispatch' && /production|rollback/.test(String(f))), 'never dispatches production workflows')
})

// ── merge job ────────────────────────────────────────────────────────────────────────────

function mergeReady(overrides = {}) {
  const pr = lowPatchPr(27)
  pr.checks = { ci_gate: green(SHA(27), 3), migration_gate: green(SHA(27)), staging_gate: green(SHA(27), 8), failing: [] }
  const update = { ecosystem: 'pip', name: 'requests', from: '2.32.0', to: '2.32.1' }
  const policy = policyWith({ merge: { mode: 'approved-only', approvals: [{ pr: 27, updates: [update], approved_by: 'henil', approved_at: '2026-10-26', expires_at: '2026-12-01' }] }, ...(overrides.policy ?? {}) })
  const state = emptyState(NOW)
  state.batch = { ...state.batch, id: 'b1', status: 'active', mode: 'process' }
  state.prs[27] = { number: 27, status: 'verified', risk: 'low', head_sha: SHA(27), attempts: { update_branch: 0, repair: 0, staging: 1, reverify: 0, research: 0 }, attempt_main_sha: null, staging_dispatched_for: SHA(27), wait_since: null, blockers: [], updated_at: NOW, verified: { head_sha: SHA(27), base_sha: MAIN, ci_run_id: 3, staging_run_id: 8, at: NOW } }
  return { pr, policy, state: overrides.state ?? state, snapshot: snapshotWith([pr], overrides.snapshot ?? {}) }
}
const expected27 = { type: 'merge', pr: 27, head_sha: SHA(27) }

test('merge job merges only the exact approved, verified SHA and records the audit trail', async () => {
  const { policy, state, snapshot } = mergeReady()
  const deps = mockDeps({ policy, state, snapshot })
  const result = await runMerge({ deps, ctx: ctxFor({}), expected: expected27 })
  assert.equal(result.merged, true)
  assert.deepEqual(deps.writes, [['merge', 27, SHA(27)]])
  assert.equal(deps.saved[0].next.prs[27].status, 'merged')
  assert.equal(deps.saved[0].next.metrics.merges, 1)
})

test('merge job negative scenarios: nothing is ever merged', async () => {
  const cases = {
    'unapproved PR': () => mergeReady({ policy: { merge: { mode: 'approved-only', approvals: [] } } }),
    'prepare-only mode': () => mergeReady({ policy: { merge: { mode: 'prepare-only', approvals: [] } } }),
    'head SHA moved': () => { const m = mergeReady(); m.snapshot.prs[0].head.sha = SHA('dead'); return m },
    'stale verification (main moved)': () => { const m = mergeReady(); m.snapshot.main.sha = SHA('b2'); return m },
    'staging gate missing': () => { const m = mergeReady(); m.snapshot.prs[0].checks.staging_gate = null; return m },
    'staging gate failed': () => { const m = mergeReady(); m.snapshot.prs[0].checks.staging_gate = { status: 'completed', conclusion: 'failure', run_id: 8, head_sha: SHA(27) }; return m },
    'staging gate is for another SHA': () => { const m = mergeReady(); m.snapshot.prs[0].checks.staging_gate = green(SHA('beef'), 8); return m },
    'CI gate pending': () => { const m = mergeReady(); m.snapshot.prs[0].checks.ci_gate = { status: 'in_progress', conclusion: null, head_sha: SHA(27) }; return m },
    'migration gate missing': () => { const m = mergeReady(); m.snapshot.prs[0].checks.migration_gate = null; return m },
    'staging stack busy': () => mergeReady({ snapshot: { staging_busy: true } }),
    'branch behind main': () => { const m = mergeReady(); m.snapshot.prs[0].behind_by = 2; return m },
    'unresolved review threads': () => { const m = mergeReady(); m.snapshot.prs[0].unresolved_threads = 1; return m },
    'untrusted commit author': () => { const m = mergeReady(); m.snapshot.prs[0].commit_authors.push('mallory'); return m },
    'not mergeable cleanly (protected branch rules)': () => { const m = mergeReady(); m.snapshot.prs[0].mergeable_state = 'blocked'; return m },
    'paused': () => mergeReady({ policy: { paused: true } }),
    'mutation disabled': () => mergeReady({ policy: { mutation_enabled: false } }),
    'no active batch': () => { const m = mergeReady(); m.state.batch.status = 'complete'; return m },
    'forged verification record without live checks': () => { const m = mergeReady(); m.snapshot.prs[0].checks.staging_gate = null; m.snapshot.prs[0].checks.ci_gate = null; return m },
    'batch merge cap': () => { const m = mergeReady({ policy: { limits: { max_merges_per_batch: 1 } } }); m.state.metrics.merges = 1; return m },
    'non-dependabot author': () => { const m = mergeReady(); m.snapshot.prs[0].user = { login: 'someone', type: 'User' }; return m },
  }
  for (const [name, build] of Object.entries(cases)) {
    const { policy, state, snapshot } = build()
    const deps = mockDeps({ policy, state, snapshot })
    const result = await runMerge({ deps, ctx: ctxFor({}), expected: expected27 })
    assert.equal(result.merged, false, name)
    assert.ok(result.reasons.length > 0, `${name} explains itself`)
    assert.ok(!deps.writes.some(([kind]) => kind === 'merge'), `${name}: no merge call`)
  }
})

test('high-risk exact-approved PRs are still refused by the merge job', async () => {
  const pr = prFixture(60, { eco: 'pip', name: 'stripe', from: '15.4.0', to: '16.0.0' })
  pr.checks = { ci_gate: green(SHA(60)), migration_gate: green(SHA(60)), staging_gate: green(SHA(60)), failing: [] }
  const policy = policyWith({ merge: { mode: 'approved-only', approvals: [{ pr: 60, updates: [{ ecosystem: 'pip', name: 'stripe', from: '15.4.0', to: '16.0.0' }], acknowledge_major: true, approved_by: 'henil', approved_at: '2026-10-26', expires_at: '2026-12-01' }] } })
  const state = emptyState(NOW)
  state.batch = { ...state.batch, status: 'active', mode: 'process' }
  state.prs[60] = { ...mergeReady().state.prs[27], number: 60, head_sha: SHA(60), verified: { head_sha: SHA(60), base_sha: MAIN, ci_run_id: 1, staging_run_id: 1, at: NOW } }
  const deps = mockDeps({ policy, state, snapshot: snapshotWith([pr]) })
  const result = await runMerge({ deps, ctx: ctxFor({}), expected: { type: 'merge', pr: 60, head_sha: SHA(60) } })
  assert.equal(result.merged, false)
  assert.match(result.reasons.join(' '), /never-automatic/)
  assert.deepEqual(deps.writes, [])
})

test('a merge that cannot be confirmed is reported as failed and never as success', async () => {
  const { policy, state, snapshot } = mergeReady()
  const deps = mockDeps({ policy, state, snapshot, failOn: { confirm: true } })
  const result = await runMerge({ deps, ctx: ctxFor({}), expected: expected27 })
  assert.equal(result.merged, false)
  assert.equal(deps.saved.at(-1).next.prs[27].status, 'verified', 'state is not advanced to merged')
})

// ── research + flags ─────────────────────────────────────────────────────────────────────

test('research is accepted only for requested PRs and exact update keys, text-bounded, cost-capped', async () => {
  const deps = mockDeps({ snapshot: snapshotWith([]) })
  const requested = [{ pr: 5, updates_key: 'pip:stripe:15.4.0>16.0.0', updates: [] }]
  const results = {
    5: { findings: [{ package: 'stripe', breaking: 'yes', summary: 'x'.repeat(2000) + '<script>', risk_floor: 'high', evidence: ['https://example.com/a', 'javascript:alert(1)'] }] },
    6: { findings: [{ package: 'other', risk_floor: 'low' }] },
  }
  await runRecordResearch({ deps, ctx: ctxFor({}), requested, results, costUsd: 9999 })
  const saved = deps.saved[0].next
  assert.equal(saved.research[5].findings[0].summary.length, 500)
  assert.ok(!saved.research[5].findings[0].summary.includes('<'))
  assert.deepEqual(saved.research[5].findings[0].evidence, ['https://example.com/a'])
  assert.equal(saved.research[6], undefined)
  assert.equal(saved.metrics.claude_usd, 25, 'cost is clamped to the policy cap')
})

test('only a human dispatch (or an explicit scheduled policy) can start a batch', () => {
  const policy = policyWith()
  const dispatch = deriveFlags({ env: { TRIGGER: 'workflow_dispatch', INPUT_ACTION: 'process', INPUT_PR_NUMBERS: '151, 150' }, policy, prior: null, now: NOW })
  assert.deepEqual([dispatch.start_batch, dispatch.mode, dispatch.requested_prs], [true, 'process', [151, 150]])
  assert.equal(deriveFlags({ env: { TRIGGER: 'workflow_dispatch', INPUT_ACTION: 'plan' }, policy, prior: null, now: NOW }).mode, 'plan-only')
  assert.equal(deriveFlags({ env: { TRIGGER: 'workflow_run' }, policy, prior: null, now: NOW }).start_batch, false)
  assert.equal(deriveFlags({ env: { TRIGGER: 'schedule' }, policy, prior: null, now: NOW }).start_batch, false, 'schedule is off by default')
  const monday9 = '2026-10-26T09:10:00.000Z'
  const scheduled = policyWith({ schedule: { mode: 'process', start_weekday_utc: 1, start_hour_utc: 9 } })
  assert.equal(deriveFlags({ env: { TRIGGER: 'schedule' }, policy: scheduled, prior: null, now: monday9 }).start_batch, true)
  assert.equal(deriveFlags({ env: { TRIGGER: 'schedule' }, policy: scheduled, prior: null, now: '2026-10-26T10:10:00.000Z' }).start_batch, false)
  const recent = emptyState(monday9)
  recent.batch.started_at = '2026-10-24T09:00:00.000Z'
  assert.equal(deriveFlags({ env: { TRIGGER: 'schedule' }, policy: scheduled, prior: recent, now: monday9 }).start_batch, false, 'no repeated starts within a week')
  assert.equal(deriveFlags({ env: { TRIGGER: 'workflow_run', PAUSED_VAR: 'true' }, policy, prior: null, now: NOW }).paused_var, true)
  assert.throws(() => parseRequestedPrs('1; rm -rf /'))
})

test('checkpoint provenance: only trusted runs of this workflow may supply state', async () => {
  const { trustedStateRun } = await import('./dependency-orchestrator-deps.mjs')
  const base = { path: '.github/workflows/dependency-orchestrator.yml', head_repository: { full_name: 'o/r' } }
  assert.equal(trustedStateRun({ ...base, event: 'workflow_run', head_branch: 'dependabot/x' }, 'o/r'), true)
  assert.equal(trustedStateRun({ ...base, event: 'workflow_dispatch', head_branch: 'main' }, 'o/r'), true)
  assert.equal(trustedStateRun({ ...base, event: 'schedule', head_branch: 'main' }, 'o/r'), true)
  assert.equal(trustedStateRun({ ...base, event: 'workflow_dispatch', head_branch: 'attacker-branch' }, 'o/r'), false, 'a branch-dispatched copy of the workflow is not trusted')
  assert.equal(trustedStateRun({ ...base, event: 'pull_request', head_branch: 'main' }, 'o/r'), false)
  assert.equal(trustedStateRun({ ...base, event: 'push', head_branch: 'main' }, 'o/r'), false)
  assert.equal(trustedStateRun({ ...base, path: '.github/workflows/other.yml', event: 'workflow_run' }, 'o/r'), false)
  assert.equal(trustedStateRun({ ...base, head_repository: { full_name: 'evil/fork' }, event: 'workflow_run' }, 'o/r'), false)
})
