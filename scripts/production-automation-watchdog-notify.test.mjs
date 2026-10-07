import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WATCHDOG_ARTIFACT,
  WATCHDOG_NOTIFICATION_KEY,
  WATCHDOG_WORKFLOW_PATH,
  evaluateWatchdog,
  PRODUCTION_MUTATION_WORKFLOWS,
  CONTROL_PLANE_WORKFLOWS,
  HEARTBEAT_WORKFLOWS,
} from './production-automation-watchdog.mjs'
import { buildNotificationIntent, digestIntent, publishIntent } from './production-operations-notify.mjs'

const REPO = 'henilllpatelll/PatelRep'
const SHA = 'c'.repeat(40)
const NOW = new Date('2026-10-06T12:00:00Z')
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString().replace('.000Z', 'Z')
const RELEASE = PRODUCTION_MUTATION_WORKFLOWS[0]

const sourceRun = (id, overrides = {}) => ({
  id: Number(id),
  run_attempt: 1,
  name: 'Production Automation Watchdog',
  path: WATCHDOG_WORKFLOW_PATH,
  event: 'schedule',
  status: 'completed',
  conclusion: 'failure',
  head_branch: 'main',
  head_sha: SHA,
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const workflowId = (file) => 100 + [...PRODUCTION_MUTATION_WORKFLOWS, ...CONTROL_PLANE_WORKFLOWS, ...HEARTBEAT_WORKFLOWS].map((spec) => spec.file).filter((name, index, all) => all.indexOf(name) === index).indexOf(file)
const apiRun = (spec, overrides = {}) => ({
  id: 39_000_000_000 + Math.floor(Math.random() * 1e6),
  workflow_id: workflowId(spec.file),
  run_attempt: 1,
  path: spec.path,
  event: 'workflow_dispatch',
  status: 'in_progress',
  head_branch: 'main',
  head_sha: SHA,
  created_at: minutesAgo(5),
  run_started_at: minutesAgo(5),
  updated_at: minutesAgo(1),
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const MONITORED_FILES = [...new Set([
  ...PRODUCTION_MUTATION_WORKFLOWS.map((spec) => spec.file),
  ...CONTROL_PLANE_WORKFLOWS.map((spec) => spec.file),
  ...HEARTBEAT_WORKFLOWS.map((spec) => spec.file),
])]

async function artifactFor({ id, stuckRuns = [], heartbeatAge = 1 }) {
  const result = await evaluateWatchdog({ repo: REPO, now: NOW }, {
    listWorkflows: async () => MONITORED_FILES.map((file) => ({ id: workflowId(file), path: `.github/workflows/${file}`, state: 'active' })),
    listWorkflowRuns: async (id) => {
      const file = MONITORED_FILES.find((candidate) => workflowId(candidate) === id)
      const spec = HEARTBEAT_WORKFLOWS.find((item) => item.file === file)
      const heartbeat = spec ? [apiRun(spec, { status: 'completed', updated_at: minutesAgo(heartbeatAge) })] : []
      return file === RELEASE.file ? stuckRuns : heartbeat
    },
  })
  return { ...result, run: { id: String(id), attempt: 1, control_plane_sha: SHA } }
}

const stuck = (id, minutes = 60) => apiRun(RELEASE, { id, run_started_at: minutesAgo(minutes), created_at: minutesAgo(minutes + 1) })

// Fake world: published notification results (newest first) plus the artifact of the source run being resolved.
// `noopExecutions` models successful Production Operations Notify runs that published nothing (no artifact).
function world({ source, artifact, prior = [], noopExecutions = 0, mutate = {} }) {
  const calls = { getRun: 0, readResult: 0, listArtifacts: 0 }
  const baseRun = (id, index) => ({
    id: Number(id),
    run_attempt: 1,
    name: 'Production Operations Notify',
    path: '.github/workflows/production-operations-notify.yml',
    event: 'workflow_run',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: SHA,
    created_at: new Date(NOW.getTime() - index * 60_000).toISOString(),
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
  })
  const runs = new Map()
  const artifacts = []
  const results = {}
  prior.forEach((item, index) => {
    const id = String(40_000_000_000 + index)
    runs.set(id, { ...baseRun(id, index), ...(item.run ?? {}) })
    artifacts.push({
      id: index + 1,
      name: 'production-operations-notification',
      expired: false,
      created_at: runs.get(id).created_at,
      workflow_run: { id: Number(id), head_branch: 'main', head_sha: SHA },
      ...(item.artifact ?? {}),
    })
    results[id] = {
      schema: 'patelrep.production-operations-notification.v1',
      workflow: 'Production Operations Notify',
      run: { id, attempt: 1, control_plane_sha: SHA },
      key: item.key ?? WATCHDOG_NOTIFICATION_KEY,
      issue_number: item.issue_number === undefined ? '77' : item.issue_number,
      action: item.action ?? 'created',
      event_id: item.event_id,
      ...(item.result ?? {}),
    }
  })
  for (let i = 0; i < noopExecutions; i += 1) runs.set(String(50_000_000_000 + i), baseRun(50_000_000_000 + i, prior.length + i))
  return {
    calls,
    now: () => NOW.getTime(),
    getRun: async (id) => {
      calls.getRun += 1
      return String(id) === String(source?.id) ? source : runs.get(String(id)) ?? null
    },
    readNamedContext: async (_runId, name) => (name === WATCHDOG_ARTIFACT ? artifact : null),
    listNotificationArtifacts: async () => {
      calls.listArtifacts += 1
      return mutate.artifacts ? mutate.artifacts(artifacts) : artifacts
    },
    readNotificationResult: async (runId) => {
      calls.readResult += 1
      return results[String(runId)] ?? null
    },
  }
}

const resolve = (deps, id) => buildNotificationIntent({ repo: REPO, sourceRunId: String(id) }, deps)

test('a stuck production operation opens one critical watchdog lifecycle thread', async () => {
  const id = '39100000001'
  const intent = await resolve(world({ source: sourceRun(id), artifact: await artifactFor({ id, stuckRuns: [stuck(1)] }) }), id)
  assert.equal(intent.key, 'watchdog:production-automation')
  assert.equal(intent.kind, 'watchdog_critical')
  assert.equal(intent.operation, 'open_update')
  assert.equal(intent.severity, 'critical')
  assert.match(intent.details.join('\n'), /production_operation_stuck: production-release\.yml run 1 \(60m, budget 45m\)/)
  assert.match(intent.details.join('\n'), /did not cancel, rerun, or dispatch/)
})

test('degraded watchdog state is a warning and healthy states never alert', async () => {
  const id = '39100000002'
  const degraded = await resolve(world({ source: sourceRun(id), artifact: await artifactFor({ id, heartbeatAge: 120 }) }), id)
  assert.equal(degraded.kind, 'watchdog_degraded')
  assert.equal(degraded.severity, 'warning')

  const healthy = await resolve(world({ source: sourceRun(id, { conclusion: 'success' }), artifact: await artifactFor({ id }) }), id)
  assert.equal(healthy.kind, 'watchdog_recovered')
  assert.equal(healthy.operation, 'close_existing')
  assert.equal(healthy.severity, 'info')
})

test('the identical finding fingerprint is an explicit no-op even as the run id and ages change', async () => {
  const first = '39100000003'
  const firstIntent = await resolve(world({ source: sourceRun(first), artifact: await artifactFor({ id: first, stuckRuns: [stuck(1, 60)] }) }), first)
  const second = '39100000004'
  const repeat = await resolve(world({
    source: sourceRun(second),
    artifact: await artifactFor({ id: second, stuckRuns: [stuck(1, 75)] }),
    prior: [{ event_id: firstIntent.event_id }],
  }), second)
  assert.equal(repeat.operation, 'none')
  assert.equal(repeat.kind, 'watchdog_unchanged')
})

test('a changed finding set or a newly stuck run causes an update', async () => {
  const first = '39100000005'
  const firstIntent = await resolve(world({ source: sourceRun(first), artifact: await artifactFor({ id: first, stuckRuns: [stuck(1)] }) }), first)
  const second = '39100000006'
  const changed = await resolve(world({
    source: sourceRun(second),
    artifact: await artifactFor({ id: second, stuckRuns: [stuck(1), stuck(2, 70)] }),
    prior: [{ event_id: firstIntent.event_id }],
  }), second)
  assert.equal(changed.operation, 'open_update')
  assert.notEqual(changed.event_id, firstIntent.event_id)
})

test('only the latest published state deduplicates, so A then B then A republishes', async () => {
  const idA = '39100000007'
  const a = await resolve(world({ source: sourceRun(idA), artifact: await artifactFor({ id: idA, stuckRuns: [stuck(1)] }) }), idA)
  const idB = '39100000008'
  const b = await resolve(world({ source: sourceRun(idB), artifact: await artifactFor({ id: idB, stuckRuns: [stuck(2)] }) }), idB)
  const idC = '39100000009'
  const priorNewestFirst = [{ event_id: b.event_id }, { event_id: a.event_id }]
  const again = await resolve(world({ source: sourceRun(idC), artifact: await artifactFor({ id: idC, stuckRuns: [stuck(1)] }), prior: priorNewestFirst }), idC)
  assert.equal(again.operation, 'open_update')
  assert.equal(again.event_id, a.event_id)

  const writes = []
  const published = await publishIntent({ repo: REPO, owner: 'henilllpatelll', intent: again, expectedDigest: digestIntent(again) }, {
    ...world({ source: sourceRun(idC), artifact: null, prior: priorNewestFirst }),
    getIssue: async (number) => ({ number, state: 'open' }),
    commentIssue: async (number) => { writes.push(['comment', number]) },
    setIssueState: async () => { writes.push(['state']) },
    createIssue: async () => { throw new Error('must reuse the thread') },
  })
  assert.equal(published.action, 'commented')
  assert.deepEqual(writes, [['comment', 77]])
})

test('healthy recovery closes the existing watchdog thread, and a repeated healthy run is a no-op', async () => {
  const id = '39100000010'
  const critical = await resolve(world({ source: sourceRun(id), artifact: await artifactFor({ id, stuckRuns: [stuck(1)] }) }), id)

  const healthyId = '39100000011'
  const recovered = await resolve(world({
    source: sourceRun(healthyId, { conclusion: 'success' }),
    artifact: await artifactFor({ id: healthyId }),
    prior: [{ event_id: critical.event_id }],
  }), healthyId)
  assert.equal(recovered.operation, 'close_existing')

  const writes = []
  const published = await publishIntent({ repo: REPO, owner: 'henilllpatelll', intent: recovered, expectedDigest: digestIntent(recovered) }, {
    ...world({ source: sourceRun(healthyId), artifact: null, prior: [{ event_id: critical.event_id }] }),
    getIssue: async (number) => ({ number, state: 'open' }),
    commentIssue: async () => { writes.push('comment') },
    setIssueState: async (_number, state) => { writes.push(state) },
    createIssue: async () => { throw new Error('must not create') },
  })
  assert.equal(published.action, 'closed')
  assert.deepEqual(writes, ['comment', 'closed'])

  const nextId = '39100000012'
  const repeat = await resolve(world({
    source: sourceRun(nextId, { conclusion: 'success' }),
    artifact: await artifactFor({ id: nextId }),
    prior: [{ event_id: recovered.event_id, action: 'closed' }, { event_id: critical.event_id }],
  }), nextId)
  assert.equal(repeat.operation, 'none')
})

test('active_within_budget and healthy collapse to the same recovered condition', async () => {
  const id = '39100000013'
  const active = await resolve(world({ source: sourceRun(id, { conclusion: 'success' }), artifact: await artifactFor({ id, stuckRuns: [stuck(1, 5)] }) }), id)
  const healthy = await resolve(world({ source: sourceRun(id, { conclusion: 'success' }), artifact: await artifactFor({ id }) }), id)
  assert.equal(active.event_id, healthy.event_id)
})

test('wrong path, schema, run id, attempt, SHA, or repository fails closed', async () => {
  const id = '39100000014'
  const good = await artifactFor({ id, stuckRuns: [stuck(1)] })
  const expectFail = (deps, pattern) => assert.rejects(resolve(deps, id), pattern)

  await expectFail(world({ source: sourceRun(id, { path: '.github/workflows/other.yml' }), artifact: good }), /not a trusted production operations workflow/)
  await expectFail(world({ source: sourceRun(id, { name: 'Production Automation Watchdog', path: '.github/workflows/ci.yml' }), artifact: good }), /not a trusted production operations workflow/)
  await expectFail(world({ source: sourceRun(id, { repository: { full_name: 'evil/PatelRep' } }), artifact: good }), /repository provenance mismatch/)
  await expectFail(world({ source: sourceRun(id, { head_branch: 'feature' }), artifact: good }), /did not run from main/)
  await expectFail(world({ source: sourceRun(id, { event: 'pull_request' }), artifact: good }), /expected event/)
  await expectFail(world({ source: sourceRun(id), artifact: { ...good, schema: 'patelrep.other.v1' } }), /malformed watchdog artifact/)
  await expectFail(world({ source: sourceRun(id), artifact: { ...good, run: { ...good.run, id: '1' } } }), /provenance mismatch/)
  await expectFail(world({ source: sourceRun(id), artifact: { ...good, run: { ...good.run, attempt: 2 } } }), /provenance mismatch/)
  await expectFail(world({ source: sourceRun(id), artifact: { ...good, run: { ...good.run, control_plane_sha: 'd'.repeat(40) } } }), /provenance mismatch/)
  await expectFail(world({ source: sourceRun(id), artifact: { ...good, state: 'healthy' } }), /state is malformed|health flag|contradicts/)
  await expectFail(world({ source: sourceRun(id), artifact: { ...good, findings: [{ ...good.findings[0], code: 'made_up_code' }] } }), /finding code is unknown/)
  await expectFail(world({ source: sourceRun(id), artifact: { ...good, findings: [{ ...good.findings[0], severity: 'warning' }] } }), /severity is invalid/)
  await expectFail(world({ source: sourceRun(id), artifact: { ...good, findings: [{ ...good.findings[0], subject: { ...good.findings[0].subject, workflow_path: '.github/workflows/evil.yml' } }] } }), /not trusted/)
  await expectFail(world({ source: sourceRun(id), artifact: { ...good, findings: [{ ...good.findings[0], subject: { ...good.findings[0].subject, run_id: 'x' } }] } }), /invalid watchdog finding run id/)
})

test('missing evidence and contradictory conclusions are critical, cancelled runs are not evaluated', async () => {
  const id = '39100000015'
  const missing = await resolve(world({ source: sourceRun(id), artifact: null }), id)
  assert.equal(missing.kind, 'watchdog_evidence_missing')
  assert.equal(missing.severity, 'critical')

  const repeatMissing = await resolve(world({ source: sourceRun(id), artifact: null, prior: [] }), id)
  assert.equal(repeatMissing.event_id, missing.event_id)

  const healthyButFailed = await resolve(world({ source: sourceRun(id, { conclusion: 'failure' }), artifact: await artifactFor({ id }) }), id)
  assert.equal(healthyButFailed.kind, 'watchdog_workflow_failed')

  const unhealthyButSucceeded = await resolve(world({ source: sourceRun(id, { conclusion: 'success' }), artifact: await artifactFor({ id, stuckRuns: [stuck(1)] }) }), id)
  assert.equal(unhealthyButSucceeded.kind, 'watchdog_conclusion_mismatch')

  const cancelled = await resolve(world({ source: sourceRun(id, { conclusion: 'cancelled' }), artifact: null }), id)
  assert.equal(cancelled.operation, 'none')
  assert.equal(cancelled.kind, 'watchdog_not_evaluated')
})

test('the watchdog notification path writes only through the existing publisher and never trusts run names', async () => {
  const id = '39100000016'
  const intent = await resolve(world({ source: sourceRun(id, { name: 'Production Release' }), artifact: await artifactFor({ id, stuckRuns: [stuck(1)] }) }), id)
  assert.equal(intent.source.workflow, 'Production Automation Watchdog')
  assert.equal(intent.key, WATCHDOG_NOTIFICATION_KEY)
  await assert.rejects(
    publishIntent({ repo: REPO, owner: 'henilllpatelll', intent, expectedDigest: '0'.repeat(64) }, world({ source: sourceRun(id), artifact: null })),
    /changed between resolve and publish/,
  )
})

const NOTE = { event_id: 'watchdog:ok', action: 'closed' }

test('thousands of no-artifact notification executions cause no per-run lookups', async () => {
  const id = '39200000001'
  const deps = world({ source: sourceRun(id), artifact: await artifactFor({ id, stuckRuns: [stuck(1)] }), noopExecutions: 5000 })
  const intent = await resolve(deps, id)
  assert.equal(intent.operation, 'open_update')
  assert.equal(deps.calls.listArtifacts, 1)
  assert.equal(deps.calls.readResult, 0)
  // Only the source run itself was fetched; none of the 5000 no-op executions were.
  assert.equal(deps.calls.getRun, 1)
})

test('lookup work scales with published artifacts and stops once the latest state and mapping are known', async () => {
  const id = '39200000002'
  const intent = await resolve(world({ source: sourceRun(id), artifact: await artifactFor({ id, stuckRuns: [stuck(1)] }) }), id)
  const prior = [
    { event_id: intent.event_id },
    ...Array.from({ length: 40 }, (_, index) => ({ event_id: `watchdog:old-${index}` })),
  ]
  const deps = world({ source: sourceRun(id), artifact: await artifactFor({ id, stuckRuns: [stuck(1)] }), prior, noopExecutions: 3000 })
  const repeat = await resolve(deps, id)
  assert.equal(repeat.operation, 'none')
  assert.equal(deps.calls.readResult, 1, 'newest published artifact decides; older evidence is not read')
  assert.equal(deps.calls.getRun, 2)
})

test('only production-operations-notification artifacts are examined', async () => {
  const id = '39200000003'
  const deps = world({
    source: sourceRun(id),
    artifact: await artifactFor({ id, stuckRuns: [stuck(1)] }),
    prior: [NOTE],
    mutate: {
      artifacts: (list) => [
        { id: 900, name: 'production-release-audit', expired: false, created_at: minutesAgo(1), workflow_run: { id: 1, head_branch: 'main', head_sha: SHA } },
        { id: 901, name: 'something-else', expired: false, created_at: minutesAgo(1) },
        ...list,
      ],
    },
  })
  const intent = await resolve(deps, id)
  assert.equal(intent.operation, 'open_update')
  assert.equal(deps.calls.readResult, 1)
})

test('a candidate artifact whose source run fails validation fails closed', async () => {
  const id = '39200000004'
  const live = await artifactFor({ id, stuckRuns: [stuck(1)] })
  const cases = {
    'wrong workflow path': { run: { path: '.github/workflows/ci.yml' } },
    'wrong repository': { run: { repository: { full_name: 'evil/PatelRep' } } },
    'wrong head repository': { run: { head_repository: { full_name: 'evil/PatelRep' } } },
    'wrong event': { run: { event: 'workflow_dispatch' } },
    'not completed': { run: { status: 'in_progress' } },
    'not successful': { run: { conclusion: 'failure' } },
    'not main': { run: { head_branch: 'feature' } },
    'bad SHA': { run: { head_sha: 'nope' } },
    'artifact SHA differs from run': { artifact: { workflow_run: { id: 40_000_000_000, head_branch: 'main', head_sha: 'd'.repeat(40) } } },
    'result run id differs': { result: { run: { id: '1', attempt: 1, control_plane_sha: SHA } } },
    'result attempt differs': { result: { run: { id: '40000000000', attempt: 2, control_plane_sha: SHA } } },
    'result SHA differs': { result: { run: { id: '40000000000', attempt: 1, control_plane_sha: 'd'.repeat(40) } } },
    'result schema wrong': { result: { schema: 'patelrep.other.v1' } },
  }
  for (const [label, extra] of Object.entries(cases)) {
    await assert.rejects(
      resolve(world({ source: sourceRun(id), artifact: live, prior: [{ ...NOTE, ...extra }] }), id),
      /production notification:/,
      label,
    )
  }
})

test('listed-but-unreadable or malformed artifact metadata fails closed; expired and out-of-retention evidence is ignored', async () => {
  const id = '39200000005'
  const live = await artifactFor({ id, stuckRuns: [stuck(1)] })
  const missing = world({ source: sourceRun(id), artifact: live, prior: [NOTE] })
  missing.readNotificationResult = async () => null
  await assert.rejects(resolve(missing, id), /unreadable/)

  for (const bad of [
    { created_at: 'yesterday' },
    { expired: 'no' },
    { workflow_run: { id: 'abc', head_branch: 'main', head_sha: SHA } },
    { workflow_run: { id: 40_000_000_000, head_branch: 'main', head_sha: 'short' } },
  ]) {
    await assert.rejects(resolve(world({ source: sourceRun(id), artifact: live, prior: [{ ...NOTE, artifact: bad }] }), id), /malformed|invalid/, JSON.stringify(bad))
  }
  await assert.rejects(resolve(world({ source: sourceRun(id), artifact: live, mutate: { artifacts: () => [null] } }), id), /malformed/)

  for (const ignored of [{ expired: true }, { created_at: new Date(NOW.getTime() - 91 * 86_400_000).toISOString() }]) {
    const deps = world({ source: sourceRun(id), artifact: live, prior: [{ event_id: 'watchdog:ok', artifact: ignored }] })
    assert.equal((await resolve(deps, id)).operation, 'open_update')
    assert.equal(deps.calls.readResult, 0, 'ignored evidence is never read or trusted')
  }
})

test('issue number mapping comes from validated published artifacts only, never from mutable Issue content', async () => {
  const id = '39200000006'
  const intent = await resolve(world({ source: sourceRun(id), artifact: await artifactFor({ id, stuckRuns: [stuck(1)] }) }), id)
  const calls = []
  const deps = {
    ...world({ source: sourceRun(id), artifact: null, prior: [{ event_id: 'watchdog:other', issue_number: '88' }] }),
    getIssue: async (number) => { calls.push(['getIssue', number]); return { number, state: 'closed', title: 'attacker', body: 'watchdog:production-automation 1' } },
    commentIssue: async (number) => { calls.push(['comment', number]) },
    setIssueState: async (number, state) => { calls.push(['state', number, state]) },
    createIssue: async () => { throw new Error('must reuse the mapped thread') },
    listIssues: async () => { throw new Error('issue search must never be used') },
  }
  const published = await publishIntent({ repo: REPO, owner: 'henilllpatelll', intent, expectedDigest: digestIntent(intent) }, deps)
  assert.equal(published.issue_number, 88)
  assert.deepEqual(calls, [['getIssue', 88], ['state', 88, 'open'], ['comment', 88]])
})
