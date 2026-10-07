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

let nextId = 38_000_000_000
const run = (spec, overrides = {}) => ({
  id: ++nextId,
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

// active: { 'file.yml': { status: [runs] } }, completed: { 'file.yml': [runs] }
function fakeDeps({ active = {}, heartbeats = freshBeats(), throwFor = {} } = {}) {
  const calls = []
  return {
    calls,
    listWorkflowRuns: async (file, query) => {
      calls.push([file, query])
      if (throwFor[file]) throw new Error('boom')
      if (query.status === 'completed') return heartbeats[file] ?? []
      return active[file]?.[query.status] ?? []
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

  const notArray = await evaluate({ listWorkflowRuns: async () => ({ workflow_runs: [] }) })
  assert.equal(notArray.state, 'unproven')
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
  assert.ok(deps.calls.every(([file, query]) => /^[a-z-]+\.yml$/.test(file) && typeof query.status === 'string'))
  assert.equal(Object.keys(deps).sort().join(), 'calls,listWorkflowRuns')
  assert.ok(POLICY.production_in_progress_minutes === 45 && POLICY.production_waiting_minutes === 30 && POLICY.control_plane_active_minutes === 20)
})

test('a missing or invalid injected now is rejected instead of silently using the wall clock', async () => {
  await assert.rejects(evaluateWatchdog({ repo: REPO }, fakeDeps()), /now must be a valid Date/)
  await assert.rejects(evaluateWatchdog({ repo: REPO, now: new Date('nope') }, fakeDeps()), /now must be a valid Date/)
})
