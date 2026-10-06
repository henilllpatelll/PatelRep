import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyAutoRollbackCircuitBreaker } from './production-auto-rollback-circuit-breaker.mjs'

const REPO = 'henilllpatelll/PatelRep'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const SOURCE = '37450000001'

const sourceRun = {
  id: Number(SOURCE),
  run_attempt: 1,
  name: 'Production Release Stabilization',
  path: '.github/workflows/production-release-stabilization.yml',
  event: 'workflow_run',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: C,
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
}

const regressionIncident = {
  schema: 'patelrep.production-incident.v1',
  workflow: 'Production Release Stabilization',
  classifier: { run_id: SOURCE, run_attempt: 1, control_plane_sha: C },
  source_release: { run_id: '37440000001', run_attempt: 1, control_plane_sha: C, conclusion: 'success' },
  classification: 'post_release_regression',
  candidate: { eligible: true, release_sha: B, pr_number: 106, version: 'v1.8.1' },
  previous_release: { tag: 'v1.8.0', sha: A },
  release_state: {
    disposition: 'released',
    production_verified: true,
    mutations: { database: 'no_change', api: 'deployed_and_verified', web: 'deployed_and_verified', release_record: 'created' },
  },
  stabilization: { outcome: 'post_release_regression', probes: [{ attempt: 1, ok: false }, { attempt: 2, ok: false }] },
}

const partialIncident = {
  ...regressionIncident,
  source_release: { run_id: '37440000001', run_attempt: 1, control_plane_sha: C, conclusion: 'failure' },
  classification: 'partial_release_failure',
  candidate: { eligible: true, release_sha: B, pr_number: 106, version: 'v1.8.1' },
  release_state: {
    disposition: 'failed_or_partial',
    production_verified: false,
    mutations: { database: 'no_change', api: 'deployed_and_verified', web: 'unknown_after_attempt', release_record: 'not_created' },
  },
  stabilization: null,
}

function deps({ incident = regressionIncident, runtime = { sha: A, version: 'v1.8.0' }, releases, tags } = {}) {
  const releaseList = releases ?? [
    { tag_name: 'v1.8.1', draft: false, prerelease: false },
    { tag_name: 'v1.8.0', draft: false, prerelease: false },
  ]
  const tagMap = tags ?? { 'v1.8.1': B, 'v1.8.0': A }
  return {
    getRun: async () => sourceRun,
    readIncident: async () => incident,
    resolveTagCommit: async (tag) => tagMap[tag],
    readRuntimeIdentity: async () => runtime,
    listReleases: async () => releaseList,
    listTagNames: async () => Object.keys(tagMap),
    isAncestorOfMain: async (sha) => [A, B, C].includes(sha),
  }
}

const input = { repo: REPO, sourceRunId: SOURCE, targetVersion: 'v1.8.0', targetSha: A }

test('post-release rollback proves runtime is intentionally behind newest managed Release', async () => {
  const result = await verifyAutoRollbackCircuitBreaker(input, deps())
  assert.equal(result.mode, 'managed_release_mismatch')
  assert.deepEqual(result.runtime, { version: 'v1.8.0', sha: A })
  assert.equal(result.managed_release.tag, 'v1.8.1')
  assert.equal(result.managed_release.sha, B)
  assert.deepEqual(result.failed_candidate, { version: 'v1.8.1', sha: B })
})

test('partial-release rollback proves failed candidate stayed unmanaged and baseline was restored', async () => {
  const result = await verifyAutoRollbackCircuitBreaker(
    input,
    deps({
      incident: partialIncident,
      releases: [{ tag_name: 'v1.8.0', draft: false, prerelease: false }],
      tags: { 'v1.8.0': A },
    }),
  )
  assert.equal(result.mode, 'failed_candidate_unmanaged')
  assert.deepEqual(result.runtime, { version: 'v1.8.0', sha: A })
  assert.equal(result.managed_release.tag, 'v1.8.0')
  assert.equal(result.managed_release.sha, A)
})

test('circuit breaker fails if runtime is not the exact rollback target', async () => {
  await assert.rejects(
    verifyAutoRollbackCircuitBreaker(input, deps({ runtime: { sha: B, version: 'v1.8.1' } })),
    /live runtime does not equal/,
  )
})

test('post-release breaker fails if newest managed Release no longer equals the failed candidate', async () => {
  await assert.rejects(
    verifyAutoRollbackCircuitBreaker(
      input,
      deps({
        releases: [{ tag_name: 'v1.8.0', draft: false, prerelease: false }],
        tags: { 'v1.8.0': A },
      }),
    ),
    /newest managed Release is no longer/,
  )
})

test('partial-release breaker fails if failed candidate became a completed managed Release', async () => {
  await assert.rejects(
    verifyAutoRollbackCircuitBreaker(
      input,
      deps({
        incident: partialIncident,
        releases: [
          { tag_name: 'v1.8.1', draft: false, prerelease: false },
          { tag_name: 'v1.8.0', draft: false, prerelease: false },
        ],
      }),
    ),
    /partial-release rollback did not restore the current managed baseline|failed candidate unexpectedly became/,
  )
})

test('source and incident provenance mismatches fail closed', async () => {
  await assert.rejects(
    verifyAutoRollbackCircuitBreaker(input, {
      ...deps(),
      getRun: async () => ({ ...sourceRun, repository: { full_name: 'other/repo' } }),
    }),
    /source stabilization provenance mismatch/,
  )
  await assert.rejects(
    verifyAutoRollbackCircuitBreaker(input, {
      ...deps(),
      readIncident: async () => ({
        ...regressionIncident,
        classifier: { ...regressionIncident.classifier, control_plane_sha: 'd'.repeat(40) },
      }),
    }),
    /incident classifier provenance mismatch/,
  )
})
