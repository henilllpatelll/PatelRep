import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchFeatureBuilder } from './dispatch-feature-builder.mjs'
import {
  CI_WORKFLOW_PATH,
  FEATURE_BUILDER_EMAIL,
  FEATURE_BUILDER_WORKFLOW_PATH,
  STAGING_WORKFLOW_PATH,
  STATES,
  assertDispatchContext,
  assertTrustedBuilderWorkflow,
  buildDispatchBody,
  renderStatus,
  validateDispatchRequest,
} from './feature-orchestrator-policy.mjs'
import { PUBLISHER_EMAIL } from './recovery-lineage.mjs'
import { resolveFeatureStatus } from './resolve-feature-orchestrator-status.mjs'

const REPO = 'owner/repo'
const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const REPAIR = 'c'.repeat(40)
const OLD = 'd'.repeat(40)
const RUN = '100'
const BRANCH = 'feature/ai-100-pm-calendar'
const NOW = Date.parse('2026-10-07T12:00:00Z')

const builderMessage = (run = RUN, base = BASE) =>
  `feat: PM Calendar\n\nBuilt by PatelRep Autonomous Feature Builder.\n\nPatelRep-Feature-Builder-Run: ${run}\nPatelRep-Feature-Base-SHA: ${base}\n`
const repairMessage = (attempt = 1) =>
  `fix: repair\n\nPatelRep-Recovery-Root: 500\nPatelRep-Recovery-Attempt: ${attempt}\nPatelRep-Recovery-Source-Run: 500\n`

const check = (name, runId, conclusion = 'success', extra = {}) => ({
  id: Number(`${runId}${name.length}`),
  name,
  status: 'completed',
  conclusion,
  app: { slug: 'github-actions' },
  details_url: `https://github.com/${REPO}/actions/runs/${runId}/job/1`,
  ...extra,
})

/** A complete, green, exact-candidate world. Tests mutate it to break one thing at a time. */
function makeWorld(overrides = {}) {
  const world = {
    builder: {
      id: 100, path: `${FEATURE_BUILDER_WORKFLOW_PATH}@refs/heads/main`, event: 'workflow_dispatch', head_branch: 'main',
      head_sha: BASE, status: 'completed', conclusion: 'success',
      repository: { full_name: REPO }, head_repository: { full_name: REPO },
    },
    refs: [{ ref: `refs/heads/${BRANCH}` }],
    prList: [{ number: 7 }],
    pr: {
      number: 7, state: 'open', title: 'feat: PM Calendar', html_url: `https://github.com/${REPO}/pull/7`,
      updated_at: '2026-10-07T11:50:00Z', created_at: '2026-10-07T11:00:00Z',
      base: { ref: 'main', repo: { full_name: REPO } }, head: { ref: BRANCH, sha: HEAD, repo: { full_name: REPO } },
    },
    commits: [{ sha: HEAD, parents: [{ sha: BASE }], commit: { message: builderMessage(), author: { email: FEATURE_BUILDER_EMAIL } } }],
    ciRuns: [{
      id: 500, path: CI_WORKFLOW_PATH, event: 'pull_request', head_sha: HEAD, status: 'completed', conclusion: 'success',
      updated_at: '2026-10-07T11:30:00Z', created_at: '2026-10-07T11:10:00Z',
      head_repository: { full_name: REPO }, pull_requests: [{ number: 7 }],
    }],
    checks: [check('CI Gate', 500), check('Release Workflow Contract', 500), check('Staging Gate', 600)],
    stagingRuns: [{
      id: 600, path: STAGING_WORKFLOW_PATH, event: 'workflow_run', head_branch: 'main', status: 'completed', conclusion: 'success',
      created_at: '2026-10-07T11:31:00Z', head_repository: { full_name: REPO },
    }],
    contexts: { 600: { pr_number: '7', candidate_sha: HEAD, candidate_branch: BRANCH, ci_run_id: '500' } },
    ...overrides,
  }
  world.deps = {
    getWorkflowRun: async () => world.builder,
    listRefs: async () => world.refs,
    listPrsForHead: async () => world.prList,
    getPr: async () => structuredClone(world.pr),
    listPrCommits: async () => world.commits,
    listWorkflowRuns: async (file, { headSha } = {}) =>
      file === CI_WORKFLOW_PATH ? world.ciRuns.filter((run) => !headSha || run.head_sha === headSha) : world.stagingRuns,
    listCheckRuns: async () => world.checks,
    listRunArtifacts: async (id) => (world.contexts[id] ? [{ name: 'staging-candidate-context', expired: false }] : []),
    readArtifactJson: async (id) => world.contexts[id],
  }
  return world
}

const resolve = (world, extra = {}) => resolveFeatureStatus({ repo: REPO, builderRunId: RUN, now: NOW, ...extra }, world.deps)

test('ready_for_human_review requires exact CI Gate and exact Staging Gate, and never grants merge or production', async () => {
  const out = await resolve(makeWorld())
  assert.equal(out.state, 'ready_for_human_review')
  assert.equal(out.head_sha, HEAD)
  assert.equal(out.merge_authorized, false)
  assert.equal(out.production_authorized, false)
  const text = renderStatus(out)
  assert.match(text, /READY FOR HUMAN REVIEW/)
  assert.match(text, /NOT merge approval/)
  assert.match(text, /manually merge PR #7/)
})

test('every reported state is in the closed vocabulary', async () => {
  assert.deepEqual([...STATES].sort(), ['blocked', 'building', 'ci_failed', 'ci_running', 'ready_for_human_review', 'staging_failed', 'staging_running', 'unproven'])
})

test('builder in progress is building; failed builder is blocked and never ready', async () => {
  assert.equal((await resolve(makeWorld({ builder: { ...makeWorld().builder, status: 'in_progress', conclusion: null } }))).state, 'building')
  const failed = await resolve(makeWorld({ builder: { ...makeWorld().builder, conclusion: 'failure' } }))
  assert.equal(failed.state, 'blocked')
})

test('wrong workflow, wrong repo, wrong trigger, and non-main builder runs are unproven', async () => {
  const base = makeWorld().builder
  for (const patch of [
    { path: '.github/workflows/ci.yml@refs/heads/main' },
    { repository: { full_name: 'evil/repo' } },
    { head_repository: { full_name: 'evil/repo' } },
    { event: 'push' },
    { head_branch: 'feature/x' },
  ]) {
    const out = await resolve(makeWorld({ builder: { ...base, ...patch } }))
    assert.equal(out.state, 'unproven', JSON.stringify(patch))
  }
})

test('builder identity is the workflow path, not the display name', async () => {
  const out = await resolve(makeWorld({ builder: { ...makeWorld().builder, name: 'Autonomous Feature Builder', path: '.github/workflows/impostor.yml' } }))
  assert.equal(out.state, 'unproven')
})

test('branch must match the builder run lineage; missing or duplicate branches are unproven', async () => {
  assert.equal((await resolve(makeWorld({ refs: [{ ref: 'refs/heads/feature/ai-101-pm-calendar' }] }))).state, 'unproven')
  assert.equal((await resolve(makeWorld({ refs: [] }))).state, 'unproven')
  assert.equal((await resolve(makeWorld({ refs: [{ ref: `refs/heads/${BRANCH}` }, { ref: 'refs/heads/feature/ai-100-other' }] }))).state, 'unproven')
})

test('wrong PR (repo, base, branch, count) fails', async () => {
  const world = makeWorld()
  const mutate = (patch) => ({ pr: { ...world.pr, ...patch } })
  assert.equal((await resolve(makeWorld(mutate({ head: { ...world.pr.head, repo: { full_name: 'fork/repo' } } })))).state, 'unproven')
  assert.equal((await resolve(makeWorld(mutate({ base: { ...world.pr.base, ref: 'develop' } })))).state, 'unproven')
  assert.equal((await resolve(makeWorld(mutate({ head: { ...world.pr.head, ref: 'feature/ai-100-other' } })))).state, 'unproven')
  assert.equal((await resolve(makeWorld({ prList: [] }))).state, 'unproven')
  assert.equal((await resolve(makeWorld({ prList: [{ number: 7 }, { number: 8 }] }))).state, 'unproven')
})

test('closed or merged PRs are blocked, never ready', async () => {
  assert.equal((await resolve(makeWorld({ pr: { ...makeWorld().pr, state: 'closed' } }))).state, 'blocked')
  assert.equal((await resolve(makeWorld({ pr: { ...makeWorld().pr, state: 'closed', merged_at: '2026-10-07T11:59:00Z' } }))).state, 'blocked')
})

test('wrong SHA lineage is blocked: wrong run trailer, wrong base trailer, wrong parent, wrong publisher', async () => {
  const good = makeWorld().commits[0]
  const cases = [
    { ...good, commit: { ...good.commit, message: builderMessage('999') } },
    { ...good, commit: { ...good.commit, message: builderMessage(RUN, OLD) } },
    { ...good, parents: [{ sha: OLD }] },
    { ...good, commit: { ...good.commit, author: { email: 'human@example.com' } } },
    { ...good, commit: { ...good.commit, message: 'feat: PM Calendar' } },
  ]
  for (const commit of cases) assert.equal((await resolve(makeWorld({ commits: [commit] }))).state, 'blocked')
})

test('a head that is not the end of the proven commit chain is blocked', async () => {
  const world = makeWorld()
  world.pr.head.sha = REPAIR
  assert.equal((await resolve(world)).state, 'blocked')
})

test('untrusted extra commits on the feature branch are blocked', async () => {
  const world = makeWorld()
  world.pr.head.sha = REPAIR
  world.commits.push({ sha: REPAIR, parents: [{ sha: HEAD }], commit: { message: 'tweak', author: { email: 'someone@example.com' } } })
  assert.equal((await resolve(world)).state, 'blocked')
})

test('stale CI: success for an older PR head does not count', async () => {
  const world = makeWorld()
  world.pr.head.sha = REPAIR
  world.commits.push({ sha: REPAIR, parents: [{ sha: HEAD }], commit: { message: repairMessage(), author: { email: PUBLISHER_EMAIL } } })
  const out = await resolve(world) // CI/staging evidence exists only for HEAD
  assert.equal(out.state, 'ci_running')
  assert.equal(out.head_sha, REPAIR)
  assert.notEqual(out.state, 'ready_for_human_review')
})

test('stale CI past the start window is unproven, not green', async () => {
  const world = makeWorld({ ciRuns: [] })
  world.pr.updated_at = '2026-10-07T09:00:00Z'
  assert.equal((await resolve(world)).state, 'unproven')
})

test('a trusted Release Engineer repair moves the status to the new head and requires fresh evidence', async () => {
  const world = makeWorld()
  world.pr.head.sha = REPAIR
  world.commits.push({ sha: REPAIR, parents: [{ sha: HEAD }], commit: { message: repairMessage(), author: { email: PUBLISHER_EMAIL } } })
  assert.equal((await resolve(world)).state, 'ci_running')
  world.ciRuns.push({ ...world.ciRuns[0], id: 510, head_sha: REPAIR, status: 'in_progress', conclusion: null })
  assert.equal((await resolve(world)).state, 'ci_running')
  world.ciRuns[1] = { ...world.ciRuns[1], status: 'completed', conclusion: 'success', updated_at: '2026-10-07T11:45:00Z' }
  world.checks.push(check('CI Gate', 510))
  assert.equal((await resolve(world)).state, 'staging_running', 'old staging green for the previous head must not be reused')
  world.stagingRuns.push({ ...world.stagingRuns[0], id: 610, created_at: '2026-10-07T11:46:00Z' })
  world.contexts[610] = { pr_number: '7', candidate_sha: REPAIR, candidate_branch: BRANCH, ci_run_id: '510' }
  world.checks.push(check('Staging Gate', 610))
  const out = await resolve(world)
  assert.equal(out.state, 'ready_for_human_review')
  assert.equal(out.head_sha, REPAIR)
  assert.equal(out.repair_commits, 1)
})

test('CI states: queued/running, failure, cancelled, skipped, missing gate', async () => {
  const run = makeWorld().ciRuns[0]
  const ci = (patch) => makeWorld({ ciRuns: [{ ...run, ...patch }] })
  assert.equal((await resolve(ci({ status: 'queued', conclusion: null }))).state, 'ci_running')
  assert.equal((await resolve(ci({ status: 'in_progress', conclusion: null }))).state, 'ci_running')
  assert.equal((await resolve(ci({ conclusion: 'cancelled' }))).state, 'unproven')
  assert.equal((await resolve(ci({ conclusion: 'skipped' }))).state, 'unproven')
  const failedWorld = ci({ conclusion: 'failure' })
  failedWorld.checks = [check('CI Gate', 500, 'failure'), check('Release Workflow Contract', 500, 'failure')]
  const failed = await resolve(failedWorld)
  assert.equal(failed.state, 'ci_failed')
  assert.deepEqual(failed.failed_checks, ['Release Workflow Contract'])
  assert.match(renderStatus(failed), /Failed gate:\nRelease Workflow Contract/)
  const noGate = makeWorld()
  noGate.checks = noGate.checks.filter((c) => c.name !== 'CI Gate')
  assert.equal((await resolve(noGate)).state, 'unproven', 'green jobs without the authoritative CI Gate are not ready')
})

test('CI Gate must come from GitHub Actions and be bound to the exact CI run', async () => {
  const spoofed = makeWorld()
  spoofed.checks = spoofed.checks.map((c) => (c.name === 'CI Gate' ? { ...c, app: { slug: 'evil-app' } } : c))
  assert.equal((await resolve(spoofed)).state, 'unproven')
  const wrongRun = makeWorld()
  wrongRun.checks = wrongRun.checks.map((c) => (c.name === 'CI Gate' ? check('CI Gate', 999) : c))
  assert.equal((await resolve(wrongRun)).state, 'unproven')
})

test('CI runs from forks, other workflows, or other PRs do not count', async () => {
  const run = makeWorld().ciRuns[0]
  for (const patch of [
    { head_repository: { full_name: 'fork/repo' } },
    { path: '.github/workflows/other.yml' },
    { event: 'push' },
    { pull_requests: [{ number: 8 }] },
  ]) {
    const out = await resolve(makeWorld({ ciRuns: [{ ...run, ...patch }] }))
    assert.notEqual(out.state, 'ready_for_human_review', JSON.stringify(patch))
    assert.equal(out.state, 'ci_running', JSON.stringify(patch)) // treated as "no CI yet", never as success
  }
})

test('unrelated Staging Candidate runs on main do not count, even with head_branch main and a green gate', async () => {
  const world = makeWorld()
  world.contexts = { 600: { pr_number: '8', candidate_sha: OLD, candidate_branch: 'feature/ai-1-other', ci_run_id: '77' } }
  const out = await resolve(world)
  assert.equal(out.state, 'staging_running')
  assert.notEqual(out.state, 'ready_for_human_review')
})

test('staging context must match PR, branch, SHA, and CI run exactly (no extra keys)', async () => {
  const good = makeWorld().contexts[600]
  for (const patch of [{ pr_number: '9' }, { candidate_branch: 'feature/ai-100-x' }, { candidate_sha: OLD }, { ci_run_id: '501' }, { extra: 'x' }]) {
    const world = makeWorld({ contexts: { 600: { ...good, ...patch } } })
    assert.notEqual((await resolve(world)).state, 'ready_for_human_review', JSON.stringify(patch))
  }
})

test('staging success for an older PR head does not count', async () => {
  const world = makeWorld()
  world.contexts[600] = { ...world.contexts[600], candidate_sha: OLD }
  assert.equal((await resolve(world)).state, 'staging_running')
})

test('staging states: running, failure, missing past window, gate missing or failed', async () => {
  const run = makeWorld().stagingRuns[0]
  const staging = (patch) => makeWorld({ stagingRuns: [{ ...run, ...patch }] })
  assert.equal((await resolve(staging({ status: 'in_progress', conclusion: null }))).state, 'staging_running')
  assert.equal((await resolve(staging({ status: 'queued', conclusion: null }))).state, 'staging_running')
  const failedWorld = staging({ conclusion: 'failure' })
  failedWorld.checks = failedWorld.checks.map((c) => (c.name === 'Staging Gate' ? check('Staging Gate', 600, 'failure') : c))
  assert.equal((await resolve(failedWorld)).state, 'staging_failed')
  assert.equal((await resolve(staging({ conclusion: 'cancelled' }))).state, 'unproven')
  const noGate = makeWorld()
  noGate.checks = noGate.checks.filter((c) => c.name !== 'Staging Gate')
  assert.equal((await resolve(noGate)).state, 'unproven')
  const late = makeWorld({ stagingRuns: [], contexts: {} })
  assert.equal((await resolve(late)).state, 'staging_running')
  assert.equal((await resolve(late, { now: NOW + 5 * 60 * 60 * 1000 })).state, 'unproven')
})

test('Staging Gate must be bound to the matched staging run', async () => {
  const world = makeWorld()
  world.checks = world.checks.map((c) => (c.name === 'Staging Gate' ? check('Staging Gate', 777) : c))
  assert.equal((await resolve(world)).state, 'unproven')
})

test('a head that moves while resolving is never reported ready', async () => {
  const world = makeWorld()
  let reads = 0
  world.deps.getPr = async () => {
    reads += 1
    const pr = structuredClone(world.pr)
    if (reads > 1) pr.head.sha = REPAIR
    return pr
  }
  const out = await resolve(world)
  assert.equal(out.state, 'unproven')
})

test('dispatch records are exact-key and must match the builder run', async () => {
  const record = { base_sha: BASE, builder_run_id: RUN, feature_name: 'PM Calendar', orchestrator_run_id: '90', requested_by: 'me', requirements_sha256: 'x', workflow_path: FEATURE_BUILDER_WORKFLOW_PATH }
  assert.equal((await resolve(makeWorld(), { dispatchRecord: record })).state, 'ready_for_human_review')
  assert.equal((await resolve(makeWorld(), { dispatchRecord: { ...record, base_sha: OLD } })).state, 'unproven')
  assert.equal((await resolve(makeWorld(), { dispatchRecord: { ...record, extra: 1 } })).state, 'unproven')
  assert.equal((await resolve(makeWorld(), { dispatchRecord: { ...record, workflow_path: '.github/workflows/production-release.yml' } })).state, 'unproven')
})

test('failure and unproven states never render as ready', async () => {
  for (const state of STATES.filter((s) => s !== 'ready_for_human_review')) {
    assert.doesNotMatch(renderStatus({ state, builder_run_id: RUN, pr: { number: 7 } }), /READY FOR HUMAN REVIEW|manually merge/)
  }
})

// ---- dispatch -----------------------------------------------------------------------------------------------

function dispatchWorld(patch = {}) {
  const calls = { dispatch: [], paths: [] }
  const run = { id: 200, workflow_id: 42, path: `${FEATURE_BUILDER_WORKFLOW_PATH}@refs/heads/main`, event: 'workflow_dispatch', head_branch: 'main', head_sha: BASE, repository: { full_name: REPO } }
  let dispatched = false
  const deps = {
    getMainSha: async () => BASE,
    getWorkflow: async (file) => { calls.paths.push(file); return { id: 42, path: FEATURE_BUILDER_WORKFLOW_PATH, state: 'active' } },
    listBuilderRuns: async () => (dispatched ? [run, { ...run, id: 150 }] : [{ ...run, id: 150 }]),
    dispatch: async (id, body) => { dispatched = true; calls.dispatch.push({ id, body }) },
    sleep: async () => {},
    ...patch,
  }
  return { deps, calls }
}
const dispatchInput = { repo: REPO, ref: 'refs/heads/main', sha: BASE, orchestratorRunId: '90', actor: 'henil', featureName: 'PM Calendar', requirements: 'Weekly and monthly views with overdue indicators.' }

test('dispatch targets only the builder on main, with only the two expected inputs', async () => {
  const { deps, calls } = dispatchWorld()
  const record = await dispatchFeatureBuilder(dispatchInput, deps)
  assert.deepEqual(calls.paths, ['autonomous-feature-builder.yml'])
  assert.equal(calls.dispatch.length, 1)
  assert.equal(calls.dispatch[0].id, 42)
  assert.deepEqual(Object.keys(calls.dispatch[0].body).sort(), ['inputs', 'ref'])
  assert.equal(calls.dispatch[0].body.ref, 'main')
  assert.deepEqual(Object.keys(calls.dispatch[0].body.inputs).sort(), ['feature_name', 'requirements'])
  assert.equal(record.builder_run_id, '200')
  assert.equal(record.base_sha, BASE)
  assert.equal(record.orchestrator_run_id, '90')
  assert.equal(JSON.stringify(record).includes('Weekly'), false, 'requirement text is not stored in the provenance record')
})

test('caller-supplied refs, workflow ids, files, and extra inputs cannot influence the dispatch body', () => {
  const body = buildDispatchBody({ featureName: 'PM Calendar', requirements: 'Weekly and monthly views.', ref: 'evil', workflow: 'production-release.yml', inputs: { release_sha: 'x' } })
  assert.deepEqual(body, { ref: 'main', inputs: { feature_name: 'PM Calendar', requirements: 'Weekly and monthly views.' } })
})

test('dispatch fails closed unless run from exact current main', async () => {
  for (const patch of [{ ref: 'refs/heads/feature/x' }, { ref: 'refs/tags/v1' }, { sha: OLD }, { repo: 'not a repo' }]) {
    const { deps, calls } = dispatchWorld()
    await assert.rejects(dispatchFeatureBuilder({ ...dispatchInput, ...patch }, deps), /feature orchestrator/, JSON.stringify(patch))
    assert.equal(calls.dispatch.length, 0)
  }
  const moved = dispatchWorld({ getMainSha: async () => OLD })
  await assert.rejects(dispatchFeatureBuilder(dispatchInput, moved.deps), /main moved/)
  assert.equal(moved.calls.dispatch.length, 0)
  assert.throws(() => assertDispatchContext({ repo: REPO, ref: 'refs/heads/main', sha: BASE, mainSha: undefined }), /could not be proven/)
})

test('dispatch refuses any workflow whose stable path is not the Feature Builder', async () => {
  for (const workflow of [
    { id: 1, path: '.github/workflows/production-release.yml', state: 'active', name: 'Autonomous Feature Builder' },
    { id: 1, path: '.github/workflows/production-rollback.yml', state: 'active' },
    { id: 1, path: FEATURE_BUILDER_WORKFLOW_PATH, state: 'disabled_manually' },
    null,
  ]) {
    const { deps, calls } = dispatchWorld({ getWorkflow: async () => workflow })
    await assert.rejects(dispatchFeatureBuilder(dispatchInput, deps))
    assert.equal(calls.dispatch.length, 0)
  }
  assert.throws(() => assertTrustedBuilderWorkflow({ id: 3, path: '.github/workflows/claude-release-engineer.yml', state: 'active' }))
})

test('dispatch fails closed when the resulting run cannot be proven or is ambiguous', async () => {
  const none = dispatchWorld({ listBuilderRuns: async () => [] })
  await assert.rejects(dispatchFeatureBuilder(dispatchInput, none.deps), /could not be proven/)
  const base = { id: 0, workflow_id: 42, path: FEATURE_BUILDER_WORKFLOW_PATH, event: 'workflow_dispatch', head_branch: 'main', head_sha: BASE, repository: { full_name: REPO } }
  const two = dispatchWorld({ listBuilderRuns: async () => [{ ...base, id: 301 }, { ...base, id: 302 }] })
  await assert.rejects(dispatchFeatureBuilder(dispatchInput, two.deps).catch((error) => { throw error }), /could not be proven|ambiguous/)
  const wrongSha = dispatchWorld({ listBuilderRuns: async () => [{ ...base, id: 303, head_sha: OLD }] })
  await assert.rejects(dispatchFeatureBuilder(dispatchInput, wrongSha.deps), /could not be proven/)
})

test('dispatch request validation matches the builder limits', () => {
  assert.throws(() => validateDispatchRequest({ featureName: 'x', requirements: 'long enough requirements' }))
  assert.throws(() => validateDispatchRequest({ featureName: 'PM Calendar', requirements: 'short' }))
  assert.throws(() => validateDispatchRequest({ featureName: '!!!', requirements: 'long enough requirements' }))
  assert.throws(() => validateDispatchRequest({ featureName: 'a'.repeat(121), requirements: 'long enough requirements' }))
  assert.throws(() => validateDispatchRequest({ featureName: 'PM Calendar', requirements: 'r'.repeat(12001) }))
})
