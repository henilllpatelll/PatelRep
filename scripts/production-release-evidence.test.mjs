import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProductionReleaseEvidence } from './production-release-evidence.mjs'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const deps = { resolveTagCommit: async (tag) => tag === 'v1.8.0' ? A : null }

const base = (overrides = {}) => ({
  runId: '37399999999',
  runAttempt: '1',
  controlPlaneSha: A,
  eligible: 'true',
  targetSha: B,
  prNumber: '104',
  previousTag: 'v1.8.0',
  nextVersion: 'v1.8.1',
  versionBump: 'patch',
  automationSourceRunId: '',
  reentrySourceRunId: '',
  reentryRollbackRunId: '',
  reentryPreflightResult: 'success',
  resolveResult: 'success',
  computeVersionResult: 'success',
  contentSummaryResult: 'success',
  dbPreflightResult: 'success',
  dbPending: 'false',
  dbMigrateResult: 'skipped',
  apiResult: 'success',
  webResult: 'success',
  verifyResult: 'success',
  tagResult: 'success',
  ...overrides,
})

test('clean release records exact identities and no database change', async () => {
  const e = await buildProductionReleaseEvidence(base(), deps)
  assert.deepEqual(e.previous_release, { tag: 'v1.8.0', sha: A })
  assert.equal(e.candidate.release_sha, B)
  assert.equal(e.candidate.version, 'v1.8.1')
  assert.equal(e.mutations.database, 'no_change')
  assert.equal(e.mutations.api, 'deployed_and_verified')
  assert.equal(e.mutations.web, 'deployed_and_verified')
  assert.equal(e.mutations.release_record, 'created')
  assert.equal(e.production_verified, true)
  assert.equal(e.disposition, 'released')
})

test('authorized incident re-entry provenance is recorded without free-form data', async () => {
  const e = await buildProductionReleaseEvidence(base({
    reentrySourceRunId: '37480000001',
    reentryRollbackRunId: '37470000001',
  }), deps)
  assert.deepEqual(e.source.reentry, {
    present: true,
    valid: true,
    authorization_run_id: '37480000001',
    rollback_run_id: '37470000001',
  })

  const malformed = await buildProductionReleaseEvidence(base({
    eligible: 'false',
    reentrySourceRunId: 'not-a-run token=https://secret.example',
    reentryRollbackRunId: '',
    reentryPreflightResult: 'failure',
    resolveResult: 'skipped',
    computeVersionResult: 'skipped',
    contentSummaryResult: 'skipped',
    dbPreflightResult: 'skipped',
    dbPending: '',
    dbMigrateResult: 'skipped',
    apiResult: 'skipped',
    webResult: 'skipped',
    verifyResult: 'skipped',
    tagResult: 'skipped',
    targetSha: '',
    prNumber: '',
    previousTag: '',
    nextVersion: '',
  }), { resolveTagCommit: async () => { throw new Error('must not resolve') } })
  assert.equal(malformed.source.reentry.present, true)
  assert.equal(malformed.source.reentry.valid, false)
  assert.equal(malformed.source.reentry.authorization_run_id, null)
  assert.doesNotMatch(JSON.stringify(malformed), /token|https?:\/\/|secret/i)
})

test('successful migration is distinct from no-change', async () => {
  const e = await buildProductionReleaseEvidence(base({ dbPending: 'true', dbMigrateResult: 'success' }), deps)
  assert.equal(e.database_pending, true)
  assert.equal(e.mutations.database, 'verified_applied')
})

test('failed migration or deploy attempts are never guessed safe', async () => {
  const migration = await buildProductionReleaseEvidence(base({
    dbPending: 'true',
    dbMigrateResult: 'failure',
    apiResult: 'skipped',
    webResult: 'skipped',
    verifyResult: 'skipped',
    tagResult: 'skipped',
  }), deps)
  assert.equal(migration.mutations.database, 'unknown_after_attempt')
  assert.equal(migration.mutations.api, 'not_started')

  const deploy = await buildProductionReleaseEvidence(base({
    apiResult: 'failure',
    webResult: 'skipped',
    verifyResult: 'skipped',
    tagResult: 'skipped',
  }), deps)
  assert.equal(deploy.mutations.api, 'unknown_after_attempt')
  assert.equal(deploy.mutations.web, 'not_started')
  assert.equal(deploy.disposition, 'failed_or_partial')
})

test('ineligible release does not invent candidate or previous-release identity', async () => {
  const e = await buildProductionReleaseEvidence(base({
    eligible: 'false',
    targetSha: '',
    prNumber: '',
    previousTag: '',
    nextVersion: '',
    computeVersionResult: 'skipped',
    contentSummaryResult: 'skipped',
    dbPreflightResult: 'skipped',
    dbPending: '',
    dbMigrateResult: 'skipped',
    apiResult: 'skipped',
    webResult: 'skipped',
    verifyResult: 'skipped',
    tagResult: 'skipped',
  }), { resolveTagCommit: async () => { throw new Error('must not resolve') } })
  assert.equal(e.candidate.release_sha, null)
  assert.equal(e.previous_release, null)
  assert.equal(e.mutations.database, 'not_proven')
  assert.equal(e.disposition, 'refused_before_release_eligibility')
})

test('malformed evidence hard-fails and serialized evidence is sanitized', async () => {
  await assert.rejects(buildProductionReleaseEvidence(base({ targetSha: 'main' }), deps), /invalid target SHA/)
  await assert.rejects(buildProductionReleaseEvidence(base({ apiResult: '' }), deps), /invalid API deploy result/)
  await assert.rejects(buildProductionReleaseEvidence(base(), { resolveTagCommit: async () => 'not-a-sha' }), /does not resolve to a commit/)
  const text = JSON.stringify(await buildProductionReleaseEvidence(base(), deps))
  assert.doesNotMatch(text, /credential|database_url|supabase_url|railway|https?:\/\//i)
})
