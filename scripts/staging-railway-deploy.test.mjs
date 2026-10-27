import assert from 'node:assert/strict'
import test from 'node:test'

import { deployWithRecovery, evaluateDeployment, isRecoverableLogStreamFailure, parseDeploymentId } from './staging-railway-deploy.mjs'

const projectId = '8df4a541-5d84-4b2a-b180-049e3fbe2ed1'
const serviceId = '157e3a7a-a9cc-49a3-8944-ddb6dba28392'
const deploymentId = '5157fc68-cf12-4bfe-a0f0-be925b851c9e'
const policy = { pollIntervalMs: 0, maxPolls: 5, maxConsecutiveLookupFailures: 3 }

const buildLogsLine = (id = deploymentId, project = projectId, service = serviceId) =>
  `  Build Logs: https://railway.com/project/${project}/service/${service}?id=${id}&\nCI mode enabled\n`
const STREAM_FAILURE = 'Failed to stream build logs: Failed to retrieve build log\n'

function harness({ up, statuses = [], lookupError }) {
  const calls = { up: 0, list: 0, logs: [] }
  const queue = [...statuses]
  return {
    calls,
    run: () =>
      deployWithRecovery({
        deployArgs: ['up', 'apps/api'],
        projectId,
        serviceId,
        environment: 'staging',
        policy,
        log: (line) => calls.logs.push(line),
        sleep: async () => {},
        runUp: async () => {
          calls.up++
          return up
        },
        listDeployments: async () => {
          calls.list++
          if (lookupError) throw new Error(lookupError)
          const next = queue.length > 1 ? queue.shift() : queue[0]
          return next === undefined ? [] : [{ id: deploymentId, status: next }, { id: 'other', status: 'SUCCESS' }]
        },
      }),
  }
}

const streamFailure = { code: 1, output: buildLogsLine() + STREAM_FAILURE }

test('clean railway up success never consults the API', async () => {
  const h = harness({ up: { code: 0, output: buildLogsLine() + 'Deploy complete\n' } })
  assert.deepEqual(await h.run(), { ok: true, recovered: false })
  assert.equal(h.calls.list, 0)
})

test('log-stream failure recovers only after the SAME deployment reaches SUCCESS, with one upload', async () => {
  const h = harness({ up: streamFailure, statuses: ['BUILDING', 'DEPLOYING', 'SUCCESS'] })
  const result = await h.run()
  assert.equal(result.ok, true)
  assert.equal(result.recovered, true)
  assert.equal(result.deploymentId, deploymentId)
  assert.equal(h.calls.up, 1, 'must never re-upload / duplicate-deploy')
  assert.equal(h.calls.list, 3)
})

test('log-stream failure with a FAILED or CRASHED deployment still fails the gate', async () => {
  for (const status of ['FAILED', 'CRASHED', 'REMOVED']) {
    const h = harness({ up: streamFailure, statuses: ['BUILDING', status] })
    const result = await h.run()
    assert.equal(result.ok, false, status)
    assert.equal(result.code, 1)
    assert.equal(h.calls.up, 1)
  }
})

test('recovery wait is bounded and fails if the deployment never reaches SUCCESS', async () => {
  const h = harness({ up: streamFailure, statuses: ['BUILDING'] })
  const result = await h.run()
  assert.equal(result.ok, false)
  assert.equal(h.calls.list, policy.maxPolls)
})

test('unreadable or missing deployment state fails closed', async () => {
  const unreadable = harness({ up: streamFailure, lookupError: 'token rejected' })
  assert.equal((await unreadable.run()).ok, false)
  assert.equal(unreadable.calls.list, policy.maxConsecutiveLookupFailures)

  const missing = harness({ up: streamFailure, statuses: [] })
  assert.equal((await missing.run()).ok, false)
})

test('genuine build, deploy, upload, and auth failures never trigger recovery', async () => {
  const outputs = [
    buildLogsLine() + 'ERROR: failed to solve: process "pip install" did not complete successfully\nDeploy failed\n',
    buildLogsLine() + 'Deploy crashed\n',
    buildLogsLine() + 'Failed to get deploy status: boom\n',
    'Unauthorized. Please check that your RAILWAY_TOKEN is valid\n',
    'Failed to upload code with status code 502\n',
    // transport error mixed with a real deploy failure must not be forgiven
    buildLogsLine() + 'Deploy failed\n' + STREAM_FAILURE,
    // a different log-stream error is not the known transient signature
    buildLogsLine() + 'Failed to stream build logs: websocket closed\n',
  ]
  for (const output of outputs) {
    const h = harness({ up: { code: 1, output }, statuses: ['SUCCESS'] })
    const result = await h.run()
    assert.equal(result.ok, false, output)
    assert.equal(h.calls.list, 0, `no API lookup for: ${output.slice(0, 40)}`)
    assert.equal(h.calls.up, 1)
  }
})

test('a mismatched or ambiguous deployment identity is never recovered', async () => {
  const wrongService = harness({ up: { code: 1, output: buildLogsLine(deploymentId, projectId, '99999999-9999-4999-8999-999999999999') + STREAM_FAILURE }, statuses: ['SUCCESS'] })
  assert.equal((await wrongService.run()).ok, false)
  const wrongProject = harness({ up: { code: 1, output: buildLogsLine(deploymentId, '99999999-9999-4999-8999-999999999999') + STREAM_FAILURE }, statuses: ['SUCCESS'] })
  assert.equal((await wrongProject.run()).ok, false)
  const none = harness({ up: { code: 1, output: STREAM_FAILURE }, statuses: ['SUCCESS'] })
  assert.equal((await none.run()).ok, false)
  const two = harness({ up: { code: 1, output: buildLogsLine() + buildLogsLine('11111111-1111-4111-8111-111111111111') + STREAM_FAILURE }, statuses: ['SUCCESS'] })
  assert.equal((await two.run()).ok, false)
  for (const h of [wrongService, wrongProject, none, two]) assert.equal(h.calls.list, 0)
})

test('only the exact deployment id is trusted, never another SUCCESS deployment', () => {
  assert.equal(evaluateDeployment([{ id: 'other', status: 'SUCCESS' }], deploymentId).state, 'missing')
  assert.equal(evaluateDeployment([{ id: deploymentId.toUpperCase(), status: 'success' }], deploymentId).state, 'success')
  assert.equal(evaluateDeployment([{ id: deploymentId, status: 'SKIPPED' }], deploymentId).state, 'failed')
  assert.equal(evaluateDeployment({ not: 'a list' }, deploymentId).state, 'missing')
})

test('signature helpers', () => {
  assert.equal(isRecoverableLogStreamFailure(STREAM_FAILURE), true)
  assert.equal(isRecoverableLogStreamFailure('all good'), false)
  assert.equal(parseDeploymentId(buildLogsLine(), { projectId, serviceId }), deploymentId)
})
