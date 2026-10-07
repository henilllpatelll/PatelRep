import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTROL_PLANE_WORKFLOWS,
  FINDING_SEVERITY,
  HEARTBEAT_WORKFLOWS,
  POLICY,
  PRODUCTION_MUTATION_WORKFLOWS,
  WATCHDOG_SCHEMA,
  deriveState,
  evaluateWatchdog,
  fingerprintFindings,
} from './production-automation-watchdog.mjs'

const REPO = 'henilllpatelll/PatelRep'
const SHA = 'c'.repeat(40)
const NOW = new Date('2026-10-06T12:00:00Z')
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString().replace('.000Z', 'Z')
const RELEASE = PRODUCTION_MUTATION_WORKFLOWS[0]
const ROLLBACK = PRODUCTION_MUTATION_WORKFLOWS[1]
const STABILIZATION = CONTROL_PLANE_WORKFLOWS[0]
const beat = Object.fromEntries(HEARTBEAT_WORKFLOWS.map((spec) => [spec.key, spec]))

const ALL_FILES = [...new Set([
  ...PRODUCTION_MUTATION_WORKFLOWS.map((spec) => spec.file),
  ...CONTROL_PLANE_WORKFLOWS.map((spec) => spec.file),
  ...HEARTBEAT_WORKFLOWS.map((spec) => spec.file),
])]
const idOf = (file) => 100 + ALL_FILES.indexOf(file)
const records = () => ALL_FILES.map((file) => ({ id: idOf(file), path: `.github/workflows/${file}`, state: 'active', name: 'Decoy Display Name' }))

let nextId = 38_000_000_000
const run = (spec, overrides = {}) => ({
  id: ++nextId,
  workflow_id: idOf(spec.file),
  run_attempt: 1,
  path: spec.path,
  event: 'workflow_dispatch',
  status: 'in_progress',
  conclusion: null,
  head_branch: 'main',
  head_sha: SHA,
  created_at: minutesAgo(5),
  run_started_at: minutesAgo(5),
  updated_at: minutesAgo(1),
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const freshBeats = (overrides = {}) => Object.fromEntries(HEARTBEAT_WORKFLOWS.map((spec) => [
  spec.file,
  [run(spec, { status: 'completed', conclusion: 'success', updated_at: minutesAgo(1), ...(overrides[spec.key] ?? {}) })],
]))

// active: { 'file.yml': { status: [runs] } }, heartbeats: { 'file.yml': [completed runs] }.
// recent: optional per-file override of the newest-first listing (to model a stale snapshot);
// windowRuns: optional per-file override of the created-window read.
function fakeDeps({ active = {}, heartbeats = freshBeats(), throwFor = {}, workflows = records(), recent = {}, windowRuns = {} } = {}) {
  const calls = []
  const metadataCalls = []
  return {
    calls,
    metadataCalls,
    listWorkflows: async () => {
      metadataCalls.push('listWorkflows')
      return workflows
    },
    listWorkflowRuns: async (workflowId, query) => {
      const file = ALL_FILES[workflowId - 100]
      calls.push([file, query])
      if (throwFor[file]) throw new Error('boom')
      if (query.recent) return recent[file] ?? [...Object.values(active[file] ?? {}).flat(), ...(heartbeats[file] ?? [])]
      if (query.since) return windowRuns[file] ?? heartbeats[file] ?? []
      throw new Error('unexpected query shape')
    },
  }
}

const evaluate = (deps) => evaluateWatchdog({ repo: REPO, now: NOW }, deps)
const codes = (result) => result.findings.map((finding) => finding.code)

test('no active operations and fresh heartbeats is healthy with zero findings', async () => {
  const result = await evaluate(fakeDeps())
  assert.equal(result.schema, WATCHDOG_SCHEMA)
  assert.equal(result.state, 'healthy')
  assert.equal(result.healthy, true)
  assert.equal(result.severity, 'none')
  assert.deepEqual(result.findings, [])
  assert.deepEqual(result.active_operations, [])
  assert.deepEqual(result.policy.heartbeat_minutes, { deploy_health: 45, release_audit: 420, recovery_readiness: 1560, resilience_drill: 11520 })
})

test('a young Production Release is active within budget and raises no alert', async () => {
  const result = await evaluate(fakeDeps({ active: { [RELEASE.file]: { in_progress: [run(RELEASE)] } } }))
  assert.equal(result.state, 'active_within_budget')
  assert.equal(result.healthy, true)
  assert.equal(result.severity, 'none')
  assert.equal(result.active_operations.length, 1)
  assert.equal(result.active_operations[0].within_budget, true)
  assert.equal(result.active_operations[0].kind, 'production_mutation')
})

test('Production Release in_progress beyond 45 minutes is a critical stuck operation', async () => {
  const stuck = run(RELEASE, { run_started_at: minutesAgo(61), created_at: minutesAgo(62) })
  const result = await evaluate(fakeDeps({ active: { [RELEASE.file]: { in_progress: [stuck] } } }))
  assert.equal(result.state, 'critical')
  assert.equal(result.severity, 'critical')
  assert.equal(result.healthy, false)
  assert.deepEqual(codes(result), ['production_operation_stuck'])
  assert.equal(result.findings[0].subject.run_id, String(stuck.id))
  assert.equal(result.findings[0].subject.workflow_path, RELEASE.path)
  assert.equal(result.findings[0].budget_minutes, 45)
})

test('Production Rollback in_progress beyond 45 minutes is a critical stuck operation', async () => {
  const stuck = run(ROLLBACK, { run_started_at: minutesAgo(46), created_at: minutesAgo(50) })
  const result = await evaluate(fakeDeps({ active: { [ROLLBACK.file]: { in_progress: [stuck] } } }))
  assert.equal(result.state, 'critical')
  assert.deepEqual(codes(result), ['production_operation_stuck'])
  assert.equal(result.findings[0].subject.workflow_path, ROLLBACK.path)
})

test('queued, waiting, requested, and pending production operations beyond 30 minutes need human attention', async () => {
  for (const status of ['queued', 'waiting', 'requested', 'pending']) {
    const old = run(RELEASE, { status, run_started_at: null, created_at: minutesAgo(31) })
    const result = await evaluate(fakeDeps({ active: { [RELEASE.file]: { [status]: [old] } } }))
    assert.equal(result.state, 'degraded', status)
    assert.equal(result.severity, 'warning', status)
    assert.deepEqual(codes(result), ['production_operation_waiting_too_long'], status)
  }
})

test('budgets are exclusive: exactly at the threshold is within budget, one minute past is not', async () => {
  const at = (status, minutes, spec = RELEASE) => run(spec, { status, created_at: minutesAgo(minutes + (status === 'in_progress' ? 1 : 0)), run_started_at: status === 'in_progress' ? minutesAgo(minutes) : null })
  assert.equal((await evaluate(fakeDeps({ active: { [RELEASE.file]: { in_progress: [at('in_progress', 45)] } } }))).state, 'active_within_budget')
  assert.equal((await evaluate(fakeDeps({ active: { [RELEASE.file]: { in_progress: [at('in_progress', 46)] } } }))).state, 'critical')
  assert.equal((await evaluate(fakeDeps({ active: { [RELEASE.file]: { waiting: [at('waiting', 30)] } } }))).state, 'active_within_budget')
  assert.equal((await evaluate(fakeDeps({ active: { [RELEASE.file]: { waiting: [at('waiting', 31)] } } }))).state, 'degraded')
  assert.equal((await evaluate(fakeDeps({ active: { [STABILIZATION.file]: { in_progress: [at('in_progress', 20, STABILIZATION)] } } }))).state, 'active_within_budget')
  assert.equal((await evaluate(fakeDeps({ active: { [STABILIZATION.file]: { in_progress: [at('in_progress', 21, STABILIZATION)] } } }))).state, 'critical')
})

test('dynamic run display names never affect identity or classification', async () => {
  const heartbeats = freshBeats()
  const withName = (name) => ({ ...run(ROLLBACK, { run_started_at: minutesAgo(60) }), name, display_title: name })
  const a = await evaluate(fakeDeps({ active: { [ROLLBACK.file]: { in_progress: [{ ...withName('Production Rollback v1.8.0 (automated request from run 1)'), id: 1 }] } }, heartbeats }))
  const b = await evaluate(fakeDeps({ active: { [ROLLBACK.file]: { in_progress: [{ ...withName('totally unrelated title'), id: 1 }] } }, heartbeats }))
  assert.deepEqual(a, b)
  assert.deepEqual(codes(a), ['production_operation_stuck'])
  assert.doesNotMatch(JSON.stringify(a), /Production Rollback v1\.8\.0|automated request|unrelated title/)
})

test('a trusted-looking display name on the wrong workflow path is rejected as unproven, never counted as Production Release', async () => {
  const impostor = { ...run(STABILIZATION, { run_started_at: minutesAgo(1) }), name: 'Production Release', display_title: 'Production Release' }
  const result = await evaluate(fakeDeps({ active: { [RELEASE.file]: { in_progress: [impostor] } } }))
  assert.equal(result.state, 'unproven')
  assert.deepEqual(codes(result), ['github_actions_state_unproven'])
  assert.deepEqual(result.active_operations, [])
})

test('malformed or unprovable timestamps fail closed to unproven', async () => {
  for (const patch of [
    { created_at: 'not-a-date' },
    { created_at: null },
    { run_started_at: 'yesterday' },
    { created_at: minutesAgo(-30), run_started_at: minutesAgo(-30) },
  ]) {
    const result = await evaluate(fakeDeps({ active: { [RELEASE.file]: { in_progress: [run(RELEASE, patch)] } } }))
    assert.equal(result.state, 'unproven', JSON.stringify(patch))
    assert.equal(result.healthy, false)
    assert.equal(result.severity, 'critical')
  }
})

test('wrong repository or head repository is rejected as unproven', async () => {
  for (const patch of [
    { repository: { full_name: 'evil/PatelRep' } },
    { head_repository: { full_name: 'evil/PatelRep' } },
    { head_repository: null },
    { head_sha: 'short' },
    { run_attempt: 0 },
    { id: 'abc' },
  ]) {
    const result = await evaluate(fakeDeps({ active: { [RELEASE.file]: { in_progress: [run(RELEASE, patch)] } } }))
    assert.equal(result.state, 'unproven', JSON.stringify(patch))
    assert.deepEqual(result.active_operations, [])
  }
})

test('a control-plane workflow active beyond 20 minutes is stuck', async () => {
  for (const spec of CONTROL_PLANE_WORKFLOWS) {
    const stuck = run(spec, { run_started_at: minutesAgo(25), created_at: minutesAgo(26) })
    const result = await evaluate(fakeDeps({ active: { [spec.file]: { in_progress: [stuck] } } }))
    assert.equal(result.state, 'critical', spec.file)
    assert.deepEqual(codes(result), ['control_plane_run_stuck'], spec.file)
    assert.equal(result.findings[0].subject.workflow_path, spec.path)
  }
  assert.deepEqual(CONTROL_PLANE_WORKFLOWS.map((spec) => spec.file).sort(), [
    'production-auto-rollback-request.yml',
    'production-incident-reentry.yml',
    'production-operations-notify.yml',
    'production-recovery-readiness.yml',
    'production-release-audit.yml',
    'production-release-stabilization.yml',
  ])
})

test('each scheduled heartbeat goes stale only after its own window', async () => {
  const cases = [
    ['deploy_health', 45, 'deploy_health_heartbeat_stale'],
    ['release_audit', 7 * 60, 'release_audit_heartbeat_stale'],
    ['recovery_readiness', 26 * 60, 'recovery_readiness_heartbeat_stale'],
    ['resilience_drill', 8 * 24 * 60, 'resilience_drill_heartbeat_stale'],
  ]
  for (const [key, window, code] of cases) {
    const atEdge = await evaluate(fakeDeps({ heartbeats: freshBeats({ [key]: { updated_at: minutesAgo(window) } }) }))
    assert.equal(atEdge.state, 'healthy', `${key} at the edge`)
    const stale = await evaluate(fakeDeps({ heartbeats: freshBeats({ [key]: { updated_at: minutesAgo(window + 1) } }) }))
    assert.equal(stale.state, 'degraded', key)
    assert.equal(stale.severity, 'warning', key)
    assert.deepEqual(codes(stale), [code], key)
    assert.equal(stale.heartbeats[key].state, 'stale')
    assert.equal(FINDING_SEVERITY[code], 'warning')
  }
})

test('a recent completed failure still counts as scheduler liveness', async () => {
  const result = await evaluate(fakeDeps({ heartbeats: freshBeats({
    deploy_health: { conclusion: 'failure', updated_at: minutesAgo(10) },
    release_audit: { conclusion: 'cancelled', updated_at: minutesAgo(10) },
  }) }))
  assert.equal(result.state, 'healthy')
  assert.equal(result.heartbeats.deploy_health.state, 'fresh')
})

test('missing, malformed, or unreadable heartbeat state is unproven, never silently healthy', async () => {
  const none = await evaluate(fakeDeps({ heartbeats: { ...freshBeats(), [beat.deploy_health.file]: [] } }))
  assert.equal(none.state, 'unproven')
  assert.equal(none.heartbeats.deploy_health.state, 'unproven')

  const badTime = await evaluate(fakeDeps({ heartbeats: freshBeats({ release_audit: { updated_at: 'nope' } }) }))
  assert.equal(badTime.state, 'unproven')

  const offMain = await evaluate(fakeDeps({ heartbeats: freshBeats({ deploy_health: { head_branch: 'feature' } }) }))
  assert.equal(offMain.state, 'unproven')

  const wrongPath = await evaluate(fakeDeps({ heartbeats: freshBeats({ deploy_health: { path: '.github/workflows/ci.yml' } }) }))
  assert.equal(wrongPath.state, 'unproven')

  const apiDown = await evaluate(fakeDeps({ throwFor: { [RELEASE.file]: true, [beat.resilience_drill.file]: true } }))
  assert.equal(apiDown.state, 'unproven')
  assert.ok(codes(apiDown).every((code) => code === 'github_actions_state_unproven'))

  const notArray = await evaluate({ listWorkflows: async () => records(), listWorkflowRuns: async () => ({ workflow_runs: [] }) })
  assert.equal(notArray.state, 'unproven')

  const noMetadata = await evaluate({ listWorkflows: async () => { throw new Error('boom') }, listWorkflowRuns: async () => [] })
  assert.equal(noMetadata.state, 'unproven')
  assert.ok(codes(noMetadata).every((code) => code === 'github_actions_state_unproven'))
})

test('multiple simultaneous findings are preserved in deterministic order and unproven does not hide known-bad state', async () => {
  const stuckRelease = run(RELEASE, { run_started_at: minutesAgo(90), created_at: minutesAgo(91) })
  const stuckAudit = run(CONTROL_PLANE_WORKFLOWS[4], { run_started_at: minutesAgo(40), created_at: minutesAgo(41) })
  const heartbeats = { ...freshBeats({ deploy_health: { updated_at: minutesAgo(120) } }), [beat.resilience_drill.file]: [] }
  const deps = () => fakeDeps({
    active: { [RELEASE.file]: { in_progress: [stuckRelease] }, [CONTROL_PLANE_WORKFLOWS[4].file]: { in_progress: [stuckAudit] } },
    heartbeats,
  })
  const first = await evaluate(deps())
  const second = await evaluate(deps())
  assert.deepEqual(first, second)
  assert.deepEqual(codes(first), [
    'control_plane_run_stuck',
    'deploy_health_heartbeat_stale',
    'github_actions_state_unproven',
    'production_operation_stuck',
  ])
  assert.equal(first.state, 'critical')
})

test('deriveState ranks known-bad above unproven above degraded above active above healthy', () => {
  const f = (code) => ({ code, severity: FINDING_SEVERITY[code], subject: { workflow_path: 'x' } })
  assert.equal(deriveState([], 0), 'healthy')
  assert.equal(deriveState([], 2), 'active_within_budget')
  assert.equal(deriveState([f('deploy_health_heartbeat_stale')], 0), 'degraded')
  assert.equal(deriveState([f('deploy_health_heartbeat_stale'), f('github_actions_state_unproven')], 0), 'unproven')
  assert.equal(deriveState([f('github_actions_state_unproven'), f('control_plane_run_stuck')], 0), 'critical')
})

test('fingerprint ignores ages but changes with the finding set or a newly stuck run', async () => {
  const a = run(RELEASE, { id: 41, run_started_at: minutesAgo(60) })
  const stuck = (extra = []) => evaluate(fakeDeps({ active: { [RELEASE.file]: { in_progress: [a, ...extra] } } }))
  const one = await stuck()
  const older = await evaluateWatchdog({ repo: REPO, now: new Date(NOW.getTime() + 600_000) }, fakeDeps({ active: { [RELEASE.file]: { in_progress: [a] } }, heartbeats: freshBeats() }))
  assert.equal(fingerprintFindings(one.findings), fingerprintFindings(older.findings))
  const two = await stuck([run(RELEASE, { id: 42, run_started_at: minutesAgo(70) })])
  assert.notEqual(fingerprintFindings(one.findings), fingerprintFindings(two.findings))
})

test('the watchdog only issues read-style run listings and never persists display titles', async () => {
  const deps = fakeDeps({ active: { [RELEASE.file]: { in_progress: [run(RELEASE)] } } })
  await evaluate(deps)
  assert.ok(deps.calls.length > 0)
  assert.ok(deps.calls.every(([file, query]) => /^[a-z-]+\.yml$/.test(file) && query.recent === true && Object.keys(query).join() === 'recent'))
  assert.equal(Object.keys(deps).sort().join(), 'calls,listWorkflowRuns,listWorkflows,metadataCalls')
  assert.ok(POLICY.production_in_progress_minutes === 45 && POLICY.production_waiting_minutes === 30 && POLICY.control_plane_active_minutes === 20)
})

test('a missing or invalid injected now is rejected instead of silently using the wall clock', async () => {
  await assert.rejects(evaluateWatchdog({ repo: REPO }, fakeDeps()), /now must be a valid Date/)
  await assert.rejects(evaluateWatchdog({ repo: REPO, now: new Date('nope') }, fakeDeps()), /now must be a valid Date/)
})

test('REGRESSION: an old completed Deploy Health run plus a newer one selects the newer and is fresh', async () => {
  const deploy = beat.deploy_health
  const old = run(deploy, { id: 33_999_759_732, status: 'completed', conclusion: 'success', created_at: minutesAgo(44_700), updated_at: minutesAgo(44_661) })
  const newer = run(deploy, { id: 37_550_188_323, status: 'completed', conclusion: 'success', created_at: minutesAgo(8), updated_at: minutesAgo(6) })
  for (const order of [[old, newer], [newer, old]]) {
    const result = await evaluate(fakeDeps({ heartbeats: { ...freshBeats(), [deploy.file]: order } }))
    assert.equal(result.state, 'healthy')
    assert.deepEqual(result.findings, [])
    assert.equal(result.heartbeats.deploy_health.state, 'fresh')
    assert.equal(result.heartbeats.deploy_health.latest_run_id, '37550188323')
  }
})

test('REGRESSION: a stale filtered/cached listing cannot produce a false stale heartbeat when a recent run is corroborated', async () => {
  const deploy = beat.deploy_health
  const stale = run(deploy, { id: 33_999_759_732, status: 'completed', conclusion: 'success', updated_at: minutesAgo(44_661) })
  const real = run(deploy, { id: 37_550_188_323, status: 'completed', conclusion: 'success', updated_at: minutesAgo(6) })
  const corroborated = await evaluate(fakeDeps({ recent: { [deploy.file]: [stale] }, windowRuns: { [deploy.file]: [real] } }))
  assert.equal(corroborated.state, 'healthy')
  assert.equal(corroborated.heartbeats.deploy_health.latest_run_id, '37550188323')

  // Genuinely stale: neither read shows a run inside the 45 minute budget, so the finding is still reported.
  const genuine = await evaluate(fakeDeps({ recent: { [deploy.file]: [stale] }, windowRuns: { [deploy.file]: [] } }))
  assert.equal(genuine.state, 'degraded')
  assert.deepEqual(codes(genuine), ['deploy_health_heartbeat_stale'])
  assert.equal(genuine.findings[0].budget_minutes, 45)

  // A corroborating run that fails provenance is never trusted.
  const forged = run(deploy, { id: 1, status: 'completed', updated_at: minutesAgo(1), repository: { full_name: 'evil/PatelRep' } })
  const rejected = await evaluate(fakeDeps({ recent: { [deploy.file]: [stale] }, windowRuns: { [deploy.file]: [forged] } }))
  assert.equal(rejected.state, 'unproven')
})

test('workflow identity is the exact current path record; display names, inactive and duplicate records never win', async () => {
  const withInactiveDuplicate = [
    { id: 9999, path: '.github/workflows/deploy-check.yml', state: 'disabled_manually', name: 'Deploy Health Check' },
    ...records().map((record) => ({ ...record, name: 'Production Release' })),
  ]
  const ok = await evaluate(fakeDeps({ workflows: withInactiveDuplicate }))
  assert.equal(ok.state, 'healthy')

  // The inactive duplicate id is never queried; a listing for it would not match the run's workflow_id anyway.
  const deps = fakeDeps({ workflows: withInactiveDuplicate })
  await evaluate(deps)
  assert.ok(deps.calls.every(([file]) => ALL_FILES.includes(file)))

  const onlyInactive = records().map((record) => record.path.endsWith('/deploy-check.yml') ? { ...record, state: 'disabled_manually' } : record)
  const disabled = await evaluate(fakeDeps({ workflows: onlyInactive }))
  assert.equal(disabled.state, 'unproven')
  assert.ok(disabled.findings.some((finding) => finding.subject.workflow_path.endsWith('/deploy-check.yml') && /no current workflow record/.test(finding.reason)))
})

test('zero or ambiguous current workflow records are unproven; name-only matches are ignored', async () => {
  const none = await evaluate(fakeDeps({ workflows: records().filter((record) => !record.path.endsWith('/production-release.yml')) }))
  assert.equal(none.state, 'unproven')
  assert.ok(none.findings.some((finding) => /no current workflow record/.test(finding.reason)))

  const ambiguous = await evaluate(fakeDeps({ workflows: [...records(), { id: 4242, path: '.github/workflows/production-release.yml', state: 'active' }] }))
  assert.equal(ambiguous.state, 'unproven')
  assert.ok(ambiguous.findings.some((finding) => /ambiguous/.test(finding.reason)))

  const nameOnly = records().map((record) => record.path.endsWith('/deploy-check.yml') ? { ...record, path: '.github/workflows/other.yml', name: 'Deploy Health Check' } : record)
  assert.equal((await evaluate(fakeDeps({ workflows: nameOnly }))).state, 'unproven')

  const badId = records().map((record) => record.path.endsWith('/deploy-check.yml') ? { ...record, id: 'abc' } : record)
  assert.equal((await evaluate(fakeDeps({ workflows: badId }))).state, 'unproven')
})

test('a returned run with the wrong path, repository, head SHA, or workflow id is unproven', async () => {
  const deploy = beat.deploy_health
  for (const patch of [
    { path: '.github/workflows/ci.yml' },
    { repository: { full_name: 'evil/PatelRep' } },
    { head_repository: { full_name: 'evil/PatelRep' } },
    { head_sha: 'not-a-sha' },
    { workflow_id: 424242 },
  ]) {
    const result = await evaluate(fakeDeps({ heartbeats: freshBeats({ deploy_health: patch }) }))
    assert.equal(result.state, 'unproven', JSON.stringify(patch))
    assert.equal(result.heartbeats.deploy_health.state, 'unproven')
  }
  assert.equal(deploy.key, 'deploy_health')
})

test('run reads are bounded: one metadata read, one newest-first read per distinct workflow, no filtered or repository-wide history scans', async () => {
  const deps = fakeDeps()
  await evaluate(deps)
  assert.equal(deps.metadataCalls.length, 1)
  assert.equal(deps.calls.length, ALL_FILES.length)
  assert.equal(new Set(deps.calls.map(([file]) => file)).size, ALL_FILES.length)
  assert.ok(deps.calls.every(([, query]) => query.recent === true))
})
