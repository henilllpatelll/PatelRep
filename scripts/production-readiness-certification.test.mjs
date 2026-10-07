import assert from 'node:assert/strict'
import test from 'node:test'
import { DRILL_CASES } from './release-resilience-drill.mjs'
import {
  BOOTSTRAP_LIMITATION,
  CERT_SCHEMA,
  CERT_STATES,
  DEPLOY_HEALTH_JOBS,
  DRILL_SCENARIOS,
  POLICY,
  finalSuccessState,
  WORKFLOW_PATHS,
  evaluateProductionReadinessCertification,
} from './production-readiness-certification.mjs'

const REPO = 'henilllpatelll/PatelRep'
const MAIN = 'a'.repeat(40)
const MAIN_MOVED = 'f'.repeat(40)
const CAND = 'b'.repeat(40)
const TREE = '1'.repeat(40)
const PROD = 'c'.repeat(40)
const PREV = 'e'.repeat(40)
const NOW = new Date('2026-10-07T01:00:00Z')
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString().replace('.000Z', 'Z')
const clone = (value) => JSON.parse(JSON.stringify(value))

const mkRun = (id, path, overrides = {}) => ({
  id,
  workflow_id: 7,
  run_attempt: 1,
  path,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: MAIN,
  created_at: minutesAgo(8),
  updated_at: minutesAgo(5),
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const gate = (name, runId, overrides = {}) => ({
  id: 500 + Number(runId),
  name,
  status: 'completed',
  conclusion: 'success',
  app: { slug: 'github-actions', id: 15368 },
  details_url: `https://github.com/${REPO}/actions/runs/${runId}/job/9`,
  started_at: minutesAgo(40),
  completed_at: minutesAgo(30),
  output: { summary: null },
  ...overrides,
})

const STAGING_SUMMARY = `PR #119 · ${CAND}\n\n| Database | ✅ success |\n| API deploy | ✅ success |\n| Web deploy | ✅ success |\n| Release identity + smoke | ✅ success |`

const artifactFor = (name, runId, overrides = {}) => ({
  id: Number(runId) * 10,
  name,
  expired: false,
  created_at: minutesAgo(6),
  workflow_run: { id: Number(runId), head_branch: 'main', head_sha: MAIN },
  ...overrides,
})

const prime = (runId) => ({ id: String(runId), attempt: 1, control_plane_sha: MAIN })

const auditRaw = () => ({
  schema: 'patelrep.production-release-audit.v1',
  workflow: 'Production Release Audit',
  state: 'consistent_managed_release',
  consistent: true,
  reason_code: null,
  runtime: { proven: true, version: 'v1.8.0', sha: PROD },
  managed_release: { proven: true, tag: 'v1.8.0', sha: PROD },
  ledger: { unmanaged_strict_tags: [] },
  active_production_operations: 0,
  incident: { open: false, rollback_run_id: null, incident_run_id: null, quarantine_mode: null, failed_candidate_version: null, failed_candidate_sha: null },
  reentry: { state: 'not_required', authorization_run_id: null, release_sha: null, version_bump: null },
  run: prime(2001),
})

const recoveryRaw = () => ({
  schema: 'patelrep.production-recovery-readiness.v1',
  workflow: 'Production Recovery Readiness',
  state: 'limited_bootstrap_no_previous_release',
  pass: true,
  reason_code: null,
  control_plane: { requested_sha: MAIN, current_main_sha: MAIN, exact_main: true, rollback_contract_proven: true },
  audit: { state: 'consistent_managed_release', consistent: true, reason_code: null, incident_open: false, quarantine_mode: null, reentry_state: 'not_required' },
  runtime: { proven: true, version: 'v1.8.0', sha: PROD, strict_smoke: true },
  managed_release: { proven: true, tag: 'v1.8.0', sha: PROD },
  rollback_target: { available: false, source: null, tag: null, sha: null, main_ancestor: false },
  database_compatibility: 'not_exercised_read_only_no_secret',
  limitations: [BOOTSTRAP_LIMITATION],
  run: prime(2002),
})

const drillRaw = () => ({
  schema: 'patelrep.release-resilience-drill.v1',
  synthetic_only: true,
  authority_added: false,
  total: 7,
  passed: 7,
  failed: 0,
  cases: DRILL_SCENARIOS.map((name) => ({ name, passed: true, evidence: {} })),
})

const watchdogRaw = () => ({
  schema: 'patelrep.production-automation-watchdog.v1',
  workflow: 'Production Automation Watchdog',
  state: 'healthy',
  healthy: true,
  severity: 'none',
  findings: [],
  active_operations: [],
  heartbeats: {},
  run: prime(2004),
})

/** A fully green world; every test mutates exactly one fact. */
function makeWorld() {
  const w = {
    mainSequence: [MAIN],
    calls: [],
    commits: { [MAIN]: { sha: MAIN, tree: TREE }, [CAND]: { sha: CAND, tree: TREE } },
    pulls: [{ number: 119, merge_commit_sha: MAIN, base: { ref: 'main' } }],
    pr: {
      number: 119,
      merged: true,
      state: 'closed',
      merged_at: minutesAgo(70),
      merge_commit_sha: MAIN,
      base: { ref: 'main', repo: { full_name: REPO } },
      head: { sha: CAND, ref: 'feature/phase-5d', repo: { full_name: REPO } },
    },
    checks: {
      [`${CAND}:CI Gate`]: [gate('CI Gate', 1001)],
      [`${CAND}:Staging Gate`]: [gate('Staging Gate', 2005, { details_url: `https://github.com/${REPO}/runs/55`, output: { summary: STAGING_SUMMARY } })],
      [`${MAIN}:CI Gate`]: [gate('CI Gate', 1002)],
    },
    runs: {
      1001: mkRun('1001', WORKFLOW_PATHS.ci, { event: 'pull_request', head_branch: 'feature/phase-5d', head_sha: CAND }),
      1002: mkRun('1002', WORKFLOW_PATHS.ci, { event: 'push' }),
      2001: mkRun('2001', WORKFLOW_PATHS.release_audit, { event: 'push' }),
      2002: mkRun('2002', WORKFLOW_PATHS.recovery_readiness, { event: 'push' }),
      2003: mkRun('2003', WORKFLOW_PATHS.resilience_drill, { event: 'workflow_dispatch' }),
      2004: mkRun('2004', WORKFLOW_PATHS.watchdog, { event: 'push' }),
      2005: mkRun('2005', WORKFLOW_PATHS.staging, { event: 'workflow_run' }),
    },
    artifacts: [
      artifactFor('production-release-audit', 2001),
      artifactFor('production-recovery-readiness', 2002),
      artifactFor('release-resilience-drill', 2003),
      artifactFor('production-automation-watchdog', 2004),
      artifactFor('staging-candidate-context', 2005, { created_at: minutesAgo(39), workflow_run: { id: 2005, head_branch: 'main', head_sha: 'd'.repeat(40) } }),
    ],
    contents: {
      '2001:production-release-audit': auditRaw(),
      '2002:production-recovery-readiness': recoveryRaw(),
      '2003:release-resilience-drill': drillRaw(),
      '2004:production-automation-watchdog': watchdogRaw(),
      '2005:staging-candidate-context': { pr_number: '119', candidate_sha: CAND, candidate_branch: 'feature/phase-5d', ci_run_id: '1001' },
    },
    workflows: [{ id: 7, path: WORKFLOW_PATHS.deploy_health, state: 'active' }],
    deployRuns: [
      mkRun('3002', WORKFLOW_PATHS.deploy_health, { event: 'schedule', head_sha: MAIN_MOVED, updated_at: minutesAgo(1) }),
      mkRun('3001', WORKFLOW_PATHS.deploy_health, { event: 'push', updated_at: minutesAgo(10) }),
    ],
    jobs: DEPLOY_HEALTH_JOBS.map((name, index) => ({ id: index + 1, name, status: 'completed', conclusion: 'success' })),
    throwOn: null,
  }
  w.deps = {
    getMainSha: async () => {
      w.calls.push('getMainSha')
      if (w.throwOn === 'getMainSha') throw new Error('secret-token-123 remote body')
      return w.mainSequence.length > 1 ? w.mainSequence.shift() : w.mainSequence[0]
    },
    getCommit: async (sha) => {
      w.calls.push('getCommit')
      return w.commits[sha]
    },
    listPullsForCommit: async () => { w.calls.push('listPullsForCommit'); return w.pulls },
    getPr: async () => { w.calls.push('getPr'); return w.pr },
    listCheckRuns: async (sha, name) => { w.calls.push('listCheckRuns'); return w.checks[`${sha}:${name}`] ?? [] },
    getRun: async (id) => {
      w.calls.push('getRun')
      if (w.throwOn === 'getRun') throw new Error('secret-token-123 remote body')
      return w.runs[id]
    },
    listArtifacts: async (name) => { w.calls.push(`listArtifacts:${name}`); return w.artifacts.filter((artifact) => artifact.name === name) },
    readArtifact: async (runId, name) => {
      w.calls.push('readArtifact')
      if (w.throwOn === 'readArtifact') throw new Error('secret-token-123 remote body')
      return clone(w.contents[`${runId}:${name}`] ?? null)
    },
    listWorkflows: async () => { w.calls.push('listWorkflows'); return w.workflows },
    listWorkflowRuns: async (id, options) => { w.calls.push(`listWorkflowRuns:${id}:${JSON.stringify(options)}`); return w.deployRuns },
    listRunJobs: async () => { w.calls.push('listRunJobs'); return w.jobs },
  }
  return w
}

const certify = (w, overrides = {}) =>
  evaluateProductionReadinessCertification({ repo: REPO, controlPlaneSha: MAIN, now: NOW, ...overrides }, w.deps)

async function expectOutcome(mutate, state, reason, label) {
  const w = makeWorld()
  mutate(w)
  const result = await certify(w)
  assert.equal(result.state, state, `${label ?? reason}: state (got ${result.state}/${result.reason_code})`)
  assert.equal(result.reason_code, reason, `${label ?? reason}: reason`)
  assert.equal(result.certified, false)
  assert.deepEqual(result.limitations, [])
  return result
}

const NC = 'not_certified'
const UP = 'unproven'

test('all-green bootstrap state certifies with exactly the truthful no_previous_managed_release limitation', async () => {
  const w = makeWorld()
  const result = await certify(w)
  assert.equal(result.schema, CERT_SCHEMA)
  assert.equal(result.state, 'certified_with_limitations')
  assert.equal(result.certified, true)
  assert.equal(result.reason_code, null)
  assert.deepEqual(result.limitations, [BOOTSTRAP_LIMITATION])
  assert.equal(result.control_plane.main_sha, MAIN)
  assert.equal(result.control_plane.source_pr, 119)
  assert.equal(result.control_plane.candidate_sha, CAND)
  assert.equal(result.control_plane.tree_match, true)
  assert.equal(result.control_plane.main_tree, result.control_plane.candidate_tree)
  assert.equal(result.gates.staging.binding, 'staging_candidate_context')
  assert.equal(result.production.version, 'v1.8.0')
  assert.equal(result.production.sha, PROD)
  assert.notEqual(result.production.sha, result.control_plane.main_sha, 'production SHA and control-plane SHA are distinct facts')
  assert.equal(result.production.recovery_readiness.rollback_target.available, false)
  assert.equal(result.resilience.passed, 7)
  assert.equal(result.watchdog.state, 'healthy')
  assert.equal(result.evaluated_at, NOW.toISOString())
  assert.ok(CERT_STATES.includes(result.state))
})

test('a valid previous managed release certifies without limitations', async () => {
  const w = makeWorld()
  const raw = recoveryRaw()
  raw.state = 'ready'
  raw.limitations = []
  raw.rollback_target = { available: true, source: 'previous_managed_release', tag: 'v1.7.0', sha: PREV, main_ancestor: true }
  w.contents['2002:production-recovery-readiness'] = raw
  const result = await certify(w)
  assert.equal(result.state, 'certified')
  assert.equal(result.certified, true)
  assert.deepEqual(result.limitations, [])
  assert.deepEqual(result.production.recovery_readiness.rollback_target, { available: true, tag: 'v1.7.0', sha: PREV })
})

test('production staying on an older managed release than main is certifiable', async () => {
  const result = await certify(makeWorld())
  assert.equal(result.certified, true)
  assert.notEqual(result.production.sha, MAIN)
})

test('the hard-coded scenario list is exactly the drill implementation scenario list', () => {
  assert.deepEqual([...DRILL_SCENARIOS], [...DRILL_CASES])
})

test('main moving before or during certification is unproven and never certifies the old SHA', async () => {
  await expectOutcome((w) => { w.mainSequence = [MAIN_MOVED] }, UP, 'main_moved_during_certification', 'moved before evaluation')
  const result = await expectOutcome((w) => { w.mainSequence = [MAIN, MAIN_MOVED] }, UP, 'main_moved_during_certification', 'moved before finalize')
  assert.equal(result.control_plane.main_sha, MAIN)
  const w = makeWorld()
  w.mainSequence = [MAIN, MAIN]
  await certify(w)
  assert.equal(w.calls.filter((call) => call === 'getMainSha').length, 2, 'main is proven at start and again before finalizing')
})

test('merged PR provenance must be exactly one trusted merged PR whose merge commit is main', async () => {
  await expectOutcome((w) => { w.pulls = [] }, NC, 'source_pr_missing')
  await expectOutcome((w) => { w.pulls = [{ number: 119, merge_commit_sha: 'd'.repeat(40), base: { ref: 'main' } }] }, NC, 'source_pr_missing', 'other merge commit')
  await expectOutcome((w) => { w.pulls = [{ number: 119, merge_commit_sha: MAIN, base: { ref: 'release' } }] }, NC, 'source_pr_missing', 'other base')
  await expectOutcome((w) => { w.pulls.push({ number: 120, merge_commit_sha: MAIN, base: { ref: 'main' } }) }, NC, 'source_pr_ambiguous')
  await expectOutcome((w) => { w.pr.merged = false }, NC, 'source_pr_not_trusted', 'not merged')
  await expectOutcome((w) => { w.pr.state = 'open' }, NC, 'source_pr_not_trusted', 'not closed')
  await expectOutcome((w) => { w.pr.merge_commit_sha = 'd'.repeat(40) }, NC, 'source_pr_not_trusted', 'merge commit differs')
  await expectOutcome((w) => { w.pr.base.ref = 'develop' }, NC, 'source_pr_not_trusted', 'base is not main')
  await expectOutcome((w) => { w.pr.head.repo.full_name = 'attacker/PatelRep' }, NC, 'source_pr_not_trusted', 'fork head')
  await expectOutcome((w) => { w.pr.merged_at = null }, NC, 'source_pr_not_trusted', 'no merged_at')
  await expectOutcome((w) => { w.pr.head.sha = 'zz' }, NC, 'source_pr_not_trusted', 'malformed head sha')
})

test('current-main tree must exactly equal the merged PR candidate-head tree', async () => {
  const result = await expectOutcome((w) => { w.commits[CAND] = { sha: CAND, tree: '2'.repeat(40) } }, NC, 'candidate_tree_mismatch')
  assert.equal(result.control_plane.tree_match, false)
  await expectOutcome((w) => { w.commits[MAIN] = { sha: MAIN, tree: '' } }, UP, 'main_commit_unproven', 'missing main tree')
  await expectOutcome((w) => { w.commits[CAND] = { sha: CAND, tree: 'nope' } }, UP, 'candidate_commit_unproven', 'malformed candidate tree')
  await expectOutcome((w) => { w.commits[CAND] = { sha: 'd'.repeat(40), tree: TREE } }, UP, 'candidate_commit_unproven', 'wrong candidate commit')
})

test('candidate CI must be a trusted successful pull_request run of the exact candidate SHA', async () => {
  await expectOutcome((w) => { w.checks[`${CAND}:CI Gate`] = [] }, NC, 'candidate_ci_gate_missing')
  await expectOutcome((w) => { w.checks[`${CAND}:CI Gate`] = [gate('CI Gate', 1001, { conclusion: 'failure' })] }, NC, 'candidate_ci_gate_not_successful')
  await expectOutcome((w) => { w.checks[`${CAND}:CI Gate`] = [gate('CI Gate', 1001, { app: { slug: 'evil-app', id: 1 } })] }, NC, 'candidate_ci_gate_missing', 'gate from another app')
  await expectOutcome((w) => { w.checks[`${CAND}:CI Gate`] = [gate('CI Gate', 1001, { details_url: 'https://example.com/x' })] }, UP, 'candidate_ci_run_unbound')
  await expectOutcome((w) => { w.runs[1001].head_sha = 'd'.repeat(40) }, UP, 'candidate_ci_run_sha_mismatch')
  await expectOutcome((w) => { w.runs[1001].path = '.github/workflows/other.yml' }, UP, 'candidate_ci_run_path_mismatch')
  await expectOutcome((w) => { w.runs[1001].head_repository.full_name = 'attacker/PatelRep' }, UP, 'candidate_ci_run_repository_mismatch')
  await expectOutcome((w) => { w.runs[1001].repository.full_name = 'attacker/PatelRep' }, UP, 'candidate_ci_run_repository_mismatch', 'base repo')
  await expectOutcome((w) => { w.runs[1001].event = 'push' }, UP, 'candidate_ci_run_event_mismatch')
  await expectOutcome((w) => { w.runs[1001].head_branch = 'other' }, UP, 'candidate_ci_run_branch_mismatch')
  await expectOutcome((w) => { w.runs[1001].conclusion = 'failure' }, NC, 'candidate_ci_run_not_successful')
  await expectOutcome((w) => { w.runs[1001].status = 'in_progress' }, UP, 'candidate_ci_run_not_completed')
  await expectOutcome((w) => { w.runs[1001].id = '9999' }, UP, 'candidate_ci_run_unbound')
})

test('Staging Candidate evidence must bind the exact PR, candidate SHA, branch and CI run', async () => {
  const context = (w) => w.contents['2005:staging-candidate-context']
  await expectOutcome((w) => { context(w).pr_number = '120' }, NC, 'staging_context_pr_mismatch')
  await expectOutcome((w) => { context(w).candidate_branch = 'feature/other' }, NC, 'staging_context_branch_mismatch')
  await expectOutcome((w) => { context(w).ci_run_id = '4242' }, NC, 'staging_context_ci_mismatch')
  await expectOutcome((w) => { context(w).candidate_sha = 'd'.repeat(40) }, UP, 'staging_candidate_context_missing', 'context for another candidate')
  await expectOutcome((w) => { context(w).extra = 'x' }, UP, 'staging_context_malformed', 'unexpected fields')
  await expectOutcome((w) => { w.contents['2005:staging-candidate-context'] = null }, UP, 'staging_candidate_context_missing', 'no artifact content')
  await expectOutcome((w) => { w.artifacts = w.artifacts.filter((a) => a.name !== 'staging-candidate-context') }, UP, 'staging_candidate_context_missing', 'no artifact')
  await expectOutcome((w) => { w.artifacts.find((a) => a.name === 'staging-candidate-context').expired = true }, UP, 'staging_candidate_context_missing', 'expired but gate is recent')
  await expectOutcome((w) => { w.artifacts.find((a) => a.name === 'staging-candidate-context').created_at = minutesAgo(600) }, UP, 'staging_candidate_context_missing', 'artifact outside the gate window')
  await expectOutcome((w) => { w.runs[2005].path = '.github/workflows/ci.yml' }, UP, 'staging_run_path_mismatch')
  await expectOutcome((w) => { w.runs[2005].event = 'push' }, UP, 'staging_run_event_mismatch')
  await expectOutcome((w) => { w.runs[2005].head_repository.full_name = 'attacker/PatelRep' }, UP, 'staging_run_repository_mismatch')
  await expectOutcome((w) => { w.runs[2005].conclusion = 'failure' }, NC, 'staging_run_not_successful')
})

test('the Staging Gate itself must be an exact successful all-stages GitHub Actions check for this PR and SHA', async () => {
  const set = (w, overrides) => { w.checks[`${CAND}:Staging Gate`] = [gate('Staging Gate', 2005, { output: { summary: STAGING_SUMMARY }, ...overrides })] }
  await expectOutcome((w) => { w.checks[`${CAND}:Staging Gate`] = [] }, NC, 'staging_gate_missing')
  await expectOutcome((w) => set(w, { conclusion: 'failure' }), NC, 'staging_gate_not_successful')
  await expectOutcome((w) => set(w, { status: 'in_progress', conclusion: null }), NC, 'staging_gate_not_successful', 'gate in progress')
  await expectOutcome((w) => set(w, { app: { slug: 'evil-app', id: 2 } }), NC, 'staging_gate_missing', 'gate from another app')
  await expectOutcome((w) => set(w, { output: { summary: STAGING_SUMMARY.replace('#119', '#120') } }), NC, 'staging_gate_summary_mismatch', 'other PR')
  await expectOutcome((w) => set(w, { output: { summary: STAGING_SUMMARY.replace(CAND, 'd'.repeat(40)) } }), NC, 'staging_gate_summary_mismatch', 'other SHA')
  await expectOutcome((w) => set(w, { output: { summary: STAGING_SUMMARY.replace('| Web deploy | ✅ success |', '| Web deploy | ❌ failure |') } }), NC, 'staging_gate_summary_mismatch', 'stage failed')
  await expectOutcome((w) => set(w, { output: { summary: STAGING_SUMMARY.replace('| Database | ✅ success |\n', '') } }), NC, 'staging_gate_summary_mismatch', 'stage missing')
  await expectOutcome((w) => set(w, { output: { summary: null } }), NC, 'staging_gate_summary_mismatch', 'no summary')
})

test('staging-candidate-context is mandatory: an expired, missing or old-gate context never certifies, and a check summary cannot replace it', async () => {
  const old = (w) => {
    w.checks[`${CAND}:Staging Gate`] = [gate('Staging Gate', 2005, {
      started_at: minutesAgo(5 * 24 * 60),
      completed_at: minutesAgo(5 * 24 * 60 - 10),
      output: { summary: STAGING_SUMMARY },
    })]
  }
  const noContext = (w) => { w.artifacts = w.artifacts.filter((artifact) => artifact.name !== 'staging-candidate-context') }
  await expectOutcome(noContext, UP, 'staging_candidate_context_missing', 'missing context, correct gate summary')
  await expectOutcome((w) => { w.artifacts.find((a) => a.name === 'staging-candidate-context').expired = true }, UP, 'staging_candidate_context_missing', 'expired context')
  await expectOutcome((w) => { old(w); noContext(w) }, UP, 'staging_candidate_context_missing', 'gate older than 3 days and no context')
  await expectOutcome((w) => { old(w); w.artifacts.find((a) => a.name === 'staging-candidate-context').expired = true }, UP, 'staging_candidate_context_missing', 'old gate and expired context')
  const present = makeWorld()
  const result = await certify(present)
  assert.equal(result.state, 'certified_with_limitations')
  assert.deepEqual(result.limitations, [BOOTSTRAP_LIMITATION])
  assert.equal(result.gates.staging.binding, 'staging_candidate_context')
})

test('only [] and [no_previous_managed_release] can produce a successful certification', () => {
  assert.equal(finalSuccessState([]), 'certified')
  assert.equal(finalSuccessState([BOOTSTRAP_LIMITATION]), 'certified_with_limitations')
  for (const limitations of [
    ['staging_context_artifact_expired'],
    ['some_unknown_limitation'],
    [BOOTSTRAP_LIMITATION, 'staging_context_artifact_expired'],
    [BOOTSTRAP_LIMITATION, BOOTSTRAP_LIMITATION],
    ['b', 'a'],
  ]) {
    assert.throws(() => finalSuccessState(limitations), (error) => error.state === 'not_certified' && error.reason === 'unsupported_limitations', JSON.stringify(limitations))
  }
  assert.throws(() => finalSuccessState(null), (error) => error.state === 'unproven')
})

test('current-main CI must be a successful push run on main for the exact certification SHA', async () => {
  await expectOutcome((w) => { w.checks[`${MAIN}:CI Gate`] = [] }, NC, 'main_ci_gate_missing')
  await expectOutcome((w) => { w.checks[`${MAIN}:CI Gate`] = [gate('CI Gate', 1002, { conclusion: 'failure' })] }, NC, 'main_ci_gate_not_successful')
  await expectOutcome((w) => { w.runs[1002].conclusion = 'failure' }, NC, 'main_ci_run_not_successful')
  await expectOutcome((w) => { w.runs[1002].event = 'pull_request' }, UP, 'main_ci_run_event_mismatch')
  await expectOutcome((w) => { w.runs[1002].head_branch = 'feature/x' }, UP, 'main_ci_run_branch_mismatch')
  await expectOutcome((w) => { w.runs[1002].head_sha = 'd'.repeat(40) }, UP, 'main_ci_run_sha_mismatch')
  await expectOutcome((w) => { w.runs[1002].path = '.github/workflows/other.yml' }, UP, 'main_ci_run_path_mismatch')
})

test('Deploy Health must be fresh (<=45m), successful, on main for the exact SHA, with all four health jobs green', async () => {
  const w = makeWorld()
  w.deployRuns = [mkRun('3001', WORKFLOW_PATHS.deploy_health, { updated_at: minutesAgo(POLICY.deploy_health_minutes) })]
  assert.equal((await certify(w)).certified, true, 'exactly 45 minutes is still fresh')

  await expectOutcome((x) => { x.deployRuns = [mkRun('3001', WORKFLOW_PATHS.deploy_health, { updated_at: minutesAgo(46) })] }, NC, 'deploy_health_evidence_stale')
  await expectOutcome((x) => { x.deployRuns = [mkRun('3001', WORKFLOW_PATHS.deploy_health, { conclusion: 'failure', updated_at: minutesAgo(3) })] }, NC, 'deploy_health_run_not_successful')
  await expectOutcome((x) => { x.jobs[1].conclusion = 'failure' }, NC, 'deploy_health_job_not_successful')
  await expectOutcome((x) => { x.jobs = x.jobs.filter((job) => job.name !== 'Public smoke verification') }, UP, 'deploy_health_jobs_unproven', 'missing job')
  await expectOutcome((x) => { x.jobs.push({ ...x.jobs[0], id: 99 }) }, UP, 'deploy_health_jobs_unproven', 'duplicate job')
  await expectOutcome((x) => { x.deployRuns = [mkRun('3002', WORKFLOW_PATHS.deploy_health, { head_sha: MAIN_MOVED })] }, UP, 'deploy_health_evidence_missing', 'only other-SHA runs')
  await expectOutcome((x) => { x.deployRuns = [mkRun('3001', WORKFLOW_PATHS.deploy_health, { head_branch: 'feature/x' })] }, UP, 'deploy_health_evidence_missing', 'not main')
  await expectOutcome((x) => { x.deployRuns = [mkRun('3001', WORKFLOW_PATHS.ci)] }, UP, 'deploy_health_run_path_mismatch')
  await expectOutcome((x) => { x.deployRuns = [mkRun('3001', WORKFLOW_PATHS.deploy_health, { workflow_id: 8 })] }, UP, 'deploy_health_workflow_unresolved')
  await expectOutcome((x) => { x.workflows.push({ id: 8, path: WORKFLOW_PATHS.deploy_health, state: 'active' }) }, UP, 'deploy_health_workflow_unresolved', 'ambiguous workflow')
  await expectOutcome((x) => { x.workflows = [] }, UP, 'deploy_health_workflow_unresolved', 'no workflow record')
})

test('release audit must be a fully consistent, quiescent, managed release with matching runtime', async () => {
  const audit = (w) => w.contents['2001:production-release-audit']
  await expectOutcome((w) => { audit(w).state = 'inconsistent'; audit(w).consistent = false }, NC, 'release_audit_not_consistent')
  await expectOutcome((w) => { audit(w).state = 'quarantined_post_release_regression' }, NC, 'release_audit_not_consistent', 'quarantined state')
  await expectOutcome((w) => { audit(w).state = 'deferred_active_production_operation' }, NC, 'release_audit_not_consistent', 'deferred state')
  await expectOutcome((w) => { audit(w).consistent = false }, NC, 'release_audit_not_consistent', 'flag contradicts state')
  await expectOutcome((w) => { audit(w).incident.open = true }, NC, 'release_audit_incident_open')
  await expectOutcome((w) => { audit(w).incident.quarantine_mode = 'failed_candidate_unmanaged' }, NC, 'release_audit_incident_open', 'quarantine mode')
  await expectOutcome((w) => { audit(w).reentry.state = 'required' }, NC, 'release_audit_reentry_required')
  await expectOutcome((w) => { audit(w).active_production_operations = 1 }, NC, 'release_audit_active_operation')
  await expectOutcome((w) => { audit(w).ledger.unmanaged_strict_tags = ['v1.9.0'] }, NC, 'release_audit_unmanaged_release_tag')
  await expectOutcome((w) => { audit(w).runtime.proven = false }, NC, 'release_audit_runtime_unproven')
  await expectOutcome((w) => { audit(w).managed_release.proven = false }, NC, 'release_audit_managed_release_unproven')
  await expectOutcome((w) => { audit(w).runtime.sha = PREV }, NC, 'release_audit_runtime_release_mismatch')
  await expectOutcome((w) => { audit(w).runtime.version = 'v1.7.0' }, NC, 'release_audit_runtime_release_mismatch', 'version drift')
  await expectOutcome((w) => { delete audit(w).incident }, UP, 'release_audit_malformed')
})

test('recovery readiness accepts only ready or the exact bootstrap state, never other pass=true states', async () => {
  const recovery = (w) => w.contents['2002:production-recovery-readiness']
  await expectOutcome((w) => { recovery(w).state = 'failed'; recovery(w).pass = false; recovery(w).reason_code = 'x' }, NC, 'recovery_readiness_state_not_certifiable')
  for (const state of [
    'deferred_main_moved_during_drill',
    'deferred_active_production_operation',
    'ready_quarantined_post_release_regression',
    'ready_quarantined_partial_release_failure',
  ]) {
    await expectOutcome((w) => { recovery(w).state = state; recovery(w).pass = true }, NC, 'recovery_readiness_state_not_certifiable', state)
  }
  await expectOutcome((w) => { recovery(w).pass = false }, NC, 'recovery_readiness_not_passing')
  await expectOutcome((w) => { recovery(w).reason_code = 'audit_inconsistent' }, NC, 'recovery_readiness_not_passing', 'reason code present')
  await expectOutcome((w) => { recovery(w).control_plane.exact_main = false }, NC, 'recovery_readiness_main_unproven')
  await expectOutcome((w) => { recovery(w).control_plane.requested_sha = MAIN_MOVED }, NC, 'recovery_readiness_main_unproven', 'other requested SHA')
  await expectOutcome((w) => { recovery(w).control_plane.rollback_contract_proven = false }, NC, 'recovery_readiness_rollback_contract_unproven')
  await expectOutcome((w) => { recovery(w).audit.incident_open = true }, NC, 'recovery_readiness_audit_not_clean')
  await expectOutcome((w) => { recovery(w).audit.quarantine_mode = 'x' }, NC, 'recovery_readiness_audit_not_clean', 'quarantine')
  await expectOutcome((w) => { recovery(w).audit.reentry_state = 'required' }, NC, 'recovery_readiness_audit_not_clean', 're-entry')
  await expectOutcome((w) => { recovery(w).runtime.strict_smoke = false }, NC, 'recovery_readiness_runtime_unproven')
  await expectOutcome((w) => { recovery(w).managed_release.sha = PREV }, NC, 'recovery_readiness_managed_release_unproven')
  await expectOutcome((w) => { delete recovery(w).rollback_target }, UP, 'recovery_readiness_malformed')
})

test('the bootstrap limitation must be exactly no_previous_managed_release with no rollback target', async () => {
  const recovery = (w) => w.contents['2002:production-recovery-readiness']
  await expectOutcome((w) => { recovery(w).limitations = ['something_else'] }, NC, 'recovery_readiness_unknown_limitation', 'unknown limitation')
  await expectOutcome((w) => { recovery(w).limitations = [BOOTSTRAP_LIMITATION, 'extra'] }, NC, 'recovery_readiness_unknown_limitation', 'extra limitation')
  await expectOutcome((w) => { recovery(w).limitations = [] }, NC, 'recovery_readiness_unknown_limitation', 'no limitation declared')
  await expectOutcome((w) => { recovery(w).rollback_target = { available: true, source: 'previous_managed_release', tag: 'v1.7.0', sha: PREV, main_ancestor: true } }, NC, 'recovery_readiness_rollback_target_invalid', 'bootstrap with a target')
  await expectOutcome((w) => {
    recovery(w).state = 'ready'
    recovery(w).limitations = []
  }, NC, 'recovery_readiness_rollback_target_invalid', 'ready without a target')
  await expectOutcome((w) => {
    recovery(w).state = 'ready'
    recovery(w).limitations = [BOOTSTRAP_LIMITATION]
    recovery(w).rollback_target = { available: true, source: 'previous_managed_release', tag: 'v1.7.0', sha: PREV, main_ancestor: true }
  }, NC, 'recovery_readiness_rollback_target_invalid', 'ready carrying a limitation')
  await expectOutcome((w) => {
    recovery(w).state = 'ready'
    recovery(w).limitations = []
    recovery(w).rollback_target = { available: true, source: 'previous_managed_release', tag: 'v1.7.0', sha: PREV, main_ancestor: false }
  }, NC, 'recovery_readiness_rollback_target_invalid', 'target not on main')
})

test('audit and recovery readiness must agree on the managed production release', async () => {
  await expectOutcome((w) => {
    const recovery = w.contents['2002:production-recovery-readiness']
    recovery.runtime.sha = PREV
    recovery.managed_release.sha = PREV
  }, NC, 'production_identity_mismatch')
})

test('resilience drill must be exactly the seven passed scenarios, synthetic-only with no added authority', async () => {
  const drill = (w) => w.contents['2003:release-resilience-drill']
  await expectOutcome((w) => {
    drill(w).cases.pop()
    drill(w).total = 6
    drill(w).passed = 6
  }, NC, 'resilience_drill_scenario_set_invalid', '6/6')
  await expectOutcome((w) => { drill(w).cases.pop() }, NC, 'resilience_drill_scenario_set_invalid', 'missing seventh scenario, counters unchanged')
  await expectOutcome((w) => { drill(w).cases[6].passed = false; drill(w).passed = 6; drill(w).failed = 1 }, NC, 'resilience_drill_scenario_failed')
  await expectOutcome((w) => { drill(w).cases[3].name = 'unknown_scenario' }, NC, 'resilience_drill_scenario_set_invalid', 'unknown scenario')
  await expectOutcome((w) => { drill(w).cases[6].name = drill(w).cases[5].name }, NC, 'resilience_drill_scenario_set_invalid', 'duplicate scenario')
  await expectOutcome((w) => { [drill(w).cases[0], drill(w).cases[1]] = [drill(w).cases[1], drill(w).cases[0]] }, NC, 'resilience_drill_scenario_set_invalid', 'reordered')
  await expectOutcome((w) => { drill(w).cases.push({ name: 'extra', passed: true }); drill(w).total = 8; drill(w).passed = 8 }, NC, 'resilience_drill_scenario_set_invalid', 'eight scenarios')
  await expectOutcome((w) => { drill(w).passed = 6 }, NC, 'resilience_drill_scenario_failed', 'counter contradicts cases')
  await expectOutcome((w) => { drill(w).synthetic_only = false }, NC, 'resilience_drill_authority_invalid')
  await expectOutcome((w) => { drill(w).authority_added = true }, NC, 'resilience_drill_authority_invalid', 'authority added')
  await expectOutcome((w) => { drill(w).cases = null }, UP, 'resilience_drill_malformed')
})

test('watchdog must be exactly healthy and quiescent for final certification', async () => {
  const watchdog = (w) => w.contents['2004:production-automation-watchdog']
  await expectOutcome((w) => { Object.assign(watchdog(w), { state: 'active_within_budget', healthy: true, severity: 'none', active_operations: [{ run_id: '1' }] }) }, NC, 'watchdog_not_healthy', 'active_within_budget')
  await expectOutcome((w) => { Object.assign(watchdog(w), { state: 'degraded', healthy: false, severity: 'warning', findings: [{ code: 'x' }] }) }, NC, 'watchdog_not_healthy', 'degraded')
  await expectOutcome((w) => { watchdog(w).findings = [{ code: 'deploy_health_heartbeat_stale' }] }, NC, 'watchdog_findings_present', 'healthy flag but findings')
  await expectOutcome((w) => { watchdog(w).active_operations = [{ run_id: '1' }] }, NC, 'watchdog_active_operations_present', 'healthy flag but active operations')
  await expectOutcome((w) => { watchdog(w).severity = 'warning' }, NC, 'watchdog_not_healthy', 'severity')
  await expectOutcome((w) => { delete watchdog(w).findings }, UP, 'watchdog_malformed')
})

test('every artifact-backed evidence source rejects wrong schema, workflow, and run/attempt/SHA binding', async () => {
  const sources = [
    ['production-release-audit', '2001', 'release_audit'],
    ['production-recovery-readiness', '2002', 'recovery_readiness'],
    ['production-automation-watchdog', '2004', 'watchdog'],
  ]
  for (const [name, runId, label] of sources) {
    const key = `${runId}:${name}`
    await expectOutcome((w) => { w.contents[key].schema = 'patelrep.wrong.v1' }, UP, `${label}_schema_mismatch`, `${label} schema`)
    await expectOutcome((w) => { w.contents[key].workflow = 'Another Workflow' }, UP, `${label}_schema_mismatch`, `${label} workflow`)
    await expectOutcome((w) => { w.contents[key].run.id = '777' }, UP, `${label}_artifact_provenance_mismatch`, `${label} run id`)
    await expectOutcome((w) => { w.contents[key].run.attempt = 2 }, UP, `${label}_artifact_provenance_mismatch`, `${label} attempt`)
    await expectOutcome((w) => { w.contents[key].run.control_plane_sha = MAIN_MOVED }, UP, `${label}_artifact_provenance_mismatch`, `${label} sha`)
    await expectOutcome((w) => { delete w.contents[key].run }, UP, `${label}_artifact_provenance_mismatch`, `${label} missing run block`)
  }
  await expectOutcome((w) => { w.contents['2003:release-resilience-drill'].schema = 'patelrep.wrong.v1' }, UP, 'resilience_drill_schema_mismatch', 'drill schema')
})

test('every evidence source run is refetched and must have the exact workflow path, repository, branch and SHA', async () => {
  const runs = [['2001', 'release_audit'], ['2002', 'recovery_readiness'], ['2003', 'resilience_drill'], ['2004', 'watchdog']]
  for (const [runId, label] of runs) {
    await expectOutcome((w) => { w.runs[runId].path = '.github/workflows/other.yml' }, UP, `${label}_run_path_mismatch`, `${label} path`)
    await expectOutcome((w) => { w.runs[runId].repository.full_name = 'attacker/PatelRep' }, UP, `${label}_run_repository_mismatch`, `${label} repo`)
    await expectOutcome((w) => { w.runs[runId].head_repository.full_name = 'attacker/PatelRep' }, UP, `${label}_run_repository_mismatch`, `${label} head repo`)
    await expectOutcome((w) => { w.runs[runId].head_branch = 'feature/x' }, UP, `${label}_run_branch_mismatch`, `${label} branch`)
    await expectOutcome((w) => { w.runs[runId].head_sha = MAIN_MOVED }, UP, `${label}_run_sha_mismatch`, `${label} sha`)
    await expectOutcome((w) => { w.runs[runId].conclusion = 'failure' }, NC, `${label}_run_not_successful`, `${label} conclusion`)
    await expectOutcome((w) => { w.runs[runId].id = '31337' }, UP, `${label}_run_unbound`, `${label} run id`)
  }
})

test('stale evidence is rejected at each freshness boundary and accepted exactly at the limit', async () => {
  const limits = [
    ['2001', 'release_audit', POLICY.release_audit_minutes, 7 * 60],
    ['2002', 'recovery_readiness', POLICY.recovery_readiness_minutes, 26 * 60],
    ['2003', 'resilience_drill', POLICY.resilience_drill_minutes, 8 * 24 * 60],
    ['2004', 'watchdog', POLICY.watchdog_minutes, 30],
  ]
  for (const [runId, label, limit, expected] of limits) {
    assert.equal(limit, expected, `${label} limit is fixed`)
    const atLimit = makeWorld()
    atLimit.runs[runId].updated_at = minutesAgo(limit)
    assert.equal((await certify(atLimit)).certified, true, `${label} exactly at limit`)
    await expectOutcome((w) => { w.runs[runId].updated_at = minutesAgo(limit + 1) }, NC, `${label}_evidence_stale`, `${label} stale`)
  }
  assert.equal(POLICY.deploy_health_minutes, 45)
})

test('missing, expired, wrong-SHA, unreadable and malformed artifact evidence fails closed', async () => {
  for (const [name, runId, label] of [
    ['production-release-audit', '2001', 'release_audit'],
    ['production-recovery-readiness', '2002', 'recovery_readiness'],
    ['release-resilience-drill', '2003', 'resilience_drill'],
    ['production-automation-watchdog', '2004', 'watchdog'],
  ]) {
    const key = `${runId}:${name}`
    await expectOutcome((w) => { w.artifacts = w.artifacts.filter((a) => a.name !== name) }, UP, `${label}_evidence_missing`, `${label} missing`)
    await expectOutcome((w) => { w.artifacts.find((a) => a.name === name).expired = true }, UP, `${label}_evidence_missing`, `${label} expired`)
    await expectOutcome((w) => { w.artifacts.find((a) => a.name === name).workflow_run.head_sha = MAIN_MOVED }, UP, `${label}_evidence_missing`, `${label} for another SHA`)
    await expectOutcome((w) => { w.artifacts.find((a) => a.name === name).workflow_run.head_branch = 'feature/x' }, UP, `${label}_evidence_missing`, `${label} for another branch`)
    await expectOutcome((w) => { w.contents[key] = null }, UP, `${label}_artifact_unavailable`, `${label} unreadable`)
    await expectOutcome((w) => { w.contents[key] = ['not', 'an', 'object'] }, UP, `${label}_artifact_unavailable`, `${label} array`)
  }
})

test('only a completed source run counts: in-progress reruns are skipped, a newer completed failure is not hidden', async () => {
  const w = makeWorld()
  w.runs[3004] = mkRun('3004', WORKFLOW_PATHS.watchdog, { status: 'in_progress', conclusion: null })
  w.artifacts.push(artifactFor('production-automation-watchdog', 3004, { created_at: minutesAgo(1) }))
  assert.equal((await certify(w)).certified, true, 'newest in-progress run is skipped for the older completed one')

  const failed = makeWorld()
  failed.runs[3004] = mkRun('3004', WORKFLOW_PATHS.watchdog, { conclusion: 'failure', updated_at: minutesAgo(1) })
  failed.artifacts.push(artifactFor('production-automation-watchdog', 3004, { created_at: minutesAgo(1) }))
  const result = await certify(failed)
  assert.equal(result.state, NC)
  assert.equal(result.reason_code, 'watchdog_run_not_successful')

  await expectOutcome((x) => { x.runs[2004].status = 'in_progress' }, UP, 'watchdog_evidence_incomplete', 'no completed run at all')
})

test('dependency failures become stable reason codes and never leak remote error text', async () => {
  for (const throwOn of ['getMainSha', 'getRun', 'readArtifact']) {
    const w = makeWorld()
    w.throwOn = throwOn
    const result = await certify(w)
    assert.equal(result.state, UP, throwOn)
    assert.equal(result.certified, false)
    assert.match(result.reason_code, /^[a-z0-9_]+$/)
    assert.doesNotMatch(JSON.stringify(result), /secret-token|remote body|https?:\/\//)
  }
  const green = JSON.stringify(await certify(makeWorld()))
  assert.doesNotMatch(green, /https?:\/\/|token|secret|password|issue|name":"Production/i)
})

test('names and Issue contents carry no authority: decoy display names change nothing, Issue reads do not exist', async () => {
  const w = makeWorld()
  for (const run of Object.values(w.runs)) Object.assign(run, { name: 'Production Release', display_title: '[CRITICAL] decoy' })
  for (const run of w.deployRuns) Object.assign(run, { name: 'Decoy', display_title: 'Decoy' })
  assert.equal((await certify(w)).certified, true)
  for (const method of Object.keys(w.deps)) assert.doesNotMatch(method, /issue|dispatch|cancel|rerun|merge|release|tag|deploy$|rollback/i, method)
})

test('evidence lookup is artifact-first and bounded: one name-filtered listing per source, one workflow run listing, no run-by-run scans', async () => {
  const w = makeWorld()
  await certify(w)
  for (const name of ['production-release-audit', 'production-recovery-readiness', 'release-resilience-drill', 'production-automation-watchdog', 'staging-candidate-context']) {
    assert.equal(w.calls.filter((call) => call === `listArtifacts:${name}`).length, 1, name)
  }
  assert.deepEqual(w.calls.filter((call) => call.startsWith('listWorkflowRuns')), ['listWorkflowRuns:7:{"recent":true}'])
  assert.ok(w.calls.filter((call) => call === 'getRun').length <= 12, 'run fetches are bounded and independent of history size')

  const busy = makeWorld()
  for (let i = 0; i < 400; i += 1) {
    busy.artifacts.push(artifactFor('production-automation-watchdog', 5000 + i, { created_at: minutesAgo(1000 + i), workflow_run: { id: 5000 + i, head_branch: 'main', head_sha: MAIN_MOVED } }))
  }
  await certify(busy)
  assert.ok(busy.calls.filter((call) => call === 'getRun').length <= 12, 'older artifacts for other SHAs are never fetched')
})

test('a persistently unreadable stack of newer same-SHA artifacts is capped at the candidate limit', async () => {
  const w = makeWorld()
  for (let i = 0; i < 40; i += 1) {
    w.runs[6000 + i] = mkRun(String(6000 + i), WORKFLOW_PATHS.watchdog, { status: 'in_progress', conclusion: null })
    w.artifacts.push(artifactFor('production-automation-watchdog', 6000 + i, { created_at: minutesAgo(1) }))
  }
  const result = await certify(w)
  assert.equal(result.reason_code, 'watchdog_evidence_incomplete')
  assert.ok(w.calls.filter((call) => call === 'getRun').length <= 12 + POLICY.artifact_candidate_limit)
})

test('the result is frozen, schema-stable, and invalid inputs are rejected before any read', async () => {
  const result = await certify(makeWorld())
  assert.ok(Object.isFrozen(result))
  assert.deepEqual(Object.keys(result), ['schema', 'workflow', 'state', 'certified', 'reason_code', 'limitations', 'control_plane', 'gates', 'production', 'resilience', 'watchdog', 'evaluated_at'])
  const w = makeWorld()
  await assert.rejects(() => evaluateProductionReadinessCertification({ repo: '', controlPlaneSha: MAIN, now: NOW }, w.deps), /repository is required/)
  await assert.rejects(() => evaluateProductionReadinessCertification({ repo: REPO, controlPlaneSha: 'abc', now: NOW }, w.deps), /control-plane SHA is invalid/)
  await assert.rejects(() => evaluateProductionReadinessCertification({ repo: REPO, controlPlaneSha: MAIN, now: 'now' }, w.deps), /valid Date/)
  assert.equal(w.calls.length, 0)
})
