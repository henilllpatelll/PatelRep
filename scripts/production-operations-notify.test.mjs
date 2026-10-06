import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildNotificationIntent,
  digestIntent,
  publishIntent,
} from './production-operations-notify.mjs'

const REPO = 'henilllpatelll/PatelRep'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const STAB = '37600000001'
const RELEASE = '37590000001'
const ROLLBACK = '37610000001'
const REENTRY = '37620000001'
const NOTIFY = '37630000001'
const AUDIT = '37640000001'

const runBase = ({ id, name, path, event, conclusion = 'success', sha = C, createdAt = '2026-10-06T08:00:00Z' }) => ({
  id: Number(id),
  run_attempt: 1,
  name,
  path,
  event,
  status: 'completed',
  conclusion,
  head_branch: 'main',
  head_sha: sha,
  created_at: createdAt,
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
})

const stabilizationRun = (overrides = {}) => ({
  ...runBase({
    id: STAB,
    name: 'Production Release Stabilization',
    path: '.github/workflows/production-release-stabilization.yml',
    event: 'workflow_run',
  }),
  ...overrides,
})

const rollbackRun = (overrides = {}) => ({
  ...runBase({
    id: ROLLBACK,
    name: `Production Rollback v1.8.0 (automated request from run ${STAB})`,
    path: '.github/workflows/production-rollback.yml',
    event: 'workflow_dispatch',
    createdAt: '2026-10-06T08:10:00Z',
  }),
  ...overrides,
})

const reentryRun = (overrides = {}) => ({
  ...runBase({
    id: REENTRY,
    name: `Production Incident Re-entry for rollback ${ROLLBACK} -> ${B}`,
    path: '.github/workflows/production-incident-reentry.yml',
    event: 'workflow_dispatch',
    createdAt: '2026-10-06T08:20:00Z',
  }),
  ...overrides,
})

const auditRun = (overrides = {}) => ({
  ...runBase({
    id: AUDIT,
    name: 'Production Release Audit',
    path: '.github/workflows/production-release-audit.yml',
    event: 'schedule',
    createdAt: '2026-10-06T08:25:00Z',
  }),
  ...overrides,
})

const auditArtifact = (overrides = {}) => ({
  schema: 'patelrep.production-release-audit.v1',
  workflow: 'Production Release Audit',
  run: { id: AUDIT, attempt: 1, control_plane_sha: C },
  state: 'consistent_managed_release',
  consistent: true,
  reason_code: null,
  runtime: { proven: true, version: 'v1.8.1', sha: B },
  managed_release: { proven: true, tag: 'v1.8.1', sha: B },
  ledger: { unmanaged_strict_tags: [] },
  active_production_operations: 0,
  incident: { open: false, rollback_run_id: null, incident_run_id: null, quarantine_mode: null },
  reentry: { state: 'not_required', authorization_run_id: null, release_sha: null, version_bump: null },
  ...overrides,
})

const stabilization = (classification = 'stable', overrides = {}) => ({
  schema: 'patelrep.production-release-stabilization.v1',
  workflow: 'Production Release Stabilization',
  classifier: { run_id: STAB, run_attempt: 1, control_plane_sha: C },
  source_release: { run_id: RELEASE, run_attempt: 1, control_plane_sha: C, conclusion: 'success' },
  candidate: { eligible: true, release_sha: B, pr_number: 110, version: 'v1.8.1' },
  previous_release: { tag: 'v1.8.0', sha: A },
  release_state: {},
  reentry: null,
  classification,
  stabilization: null,
  ...overrides,
})

const rollbackEvidence = (overrides = {}) => ({
  schema: 'patelrep.production-rollback-evidence.v1',
  workflow: 'Production Rollback',
  run: { id: ROLLBACK, attempt: 1, control_plane_sha: C },
  source: {
    mode: 'automated_incident',
    automation_source_present: true,
    automation_source_valid: true,
    automation_source_run_id: STAB,
  },
  target: { requested_version: 'v1.8.0', requested_version_valid: true, resolved: true, version: 'v1.8.0', sha: A },
  mutations: {
    database: 'not_mutated_by_workflow',
    api: 'deployed_and_verified',
    web: 'deployed_and_verified',
    release_record: 'not_created_by_workflow',
  },
  after_runtime: { state: 'verified_target', sha: A, version: 'v1.8.0' },
  production_verified: true,
  quarantine: 'verified',
  disposition: 'restored',
  ...overrides,
})

const reentryAuthorization = () => ({
  schema: 'patelrep.production-incident-reentry.v1',
  workflow: 'Production Incident Re-entry',
  run: { id: REENTRY, attempt: 1, control_plane_sha: C },
  rollback: {
    run_id: ROLLBACK,
    incident_run_id: STAB,
    target: { version: 'v1.8.0', sha: A },
    quarantine_mode: 'managed_release_mismatch',
  },
  failed_candidate: { version: 'v1.8.1', sha: B },
  authorized_release: { sha: D, pr_number: 111, pr_head_sha: D, version_bump: 'patch' },
  runtime_at_authorization: { version: 'v1.8.0', sha: A },
  managed_release_at_authorization: { tag: 'v1.8.1', sha: B },
})

const closeout = () => ({
  schema: 'patelrep.production-incident-closeout.v1',
  workflow: 'Production Release Stabilization',
  classifier: { run_id: STAB, run_attempt: 1, control_plane_sha: C },
  source_release: { run_id: RELEASE, run_attempt: 1, control_plane_sha: C, conclusion: 'success' },
  reentry: { authorization_run_id: REENTRY, rollback_run_id: ROLLBACK },
  candidate: { eligible: true, release_sha: D, pr_number: 111, version: 'v1.8.2' },
  classification: 'stable',
  closed: true,
})

function deps({ sourceRun = stabilizationRun(), artifacts = {}, extraRuns = {}, notificationRuns = [], notificationResults = {} } = {}) {
  return {
    getRun: async (id) => {
      if (String(sourceRun.id) === String(id)) return sourceRun
      if (String(id) === ROLLBACK) return extraRuns[ROLLBACK] ?? rollbackRun()
      if (String(id) === REENTRY) return extraRuns[REENTRY] ?? reentryRun()
      return extraRuns[String(id)] ?? null
    },
    readNamedContext: async (runId, name) => artifacts[`${runId}:${name}`] ?? null,
    listNotificationRuns: async () => notificationRuns,
    readNotificationResult: async (runId) => notificationResults[String(runId)] ?? null,
  }
}

test('Phase 4D audit inconsistency opens one critical production-integrity thread', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: AUDIT }, deps({
    sourceRun: auditRun({ conclusion: 'failure' }),
    artifacts: {
      [`${AUDIT}:production-release-audit`]: auditArtifact({
        state: 'inconsistent',
        consistent: false,
        reason_code: 'runtime_managed_release_mismatch',
        runtime: { proven: true, version: 'v1.8.0', sha: A },
      }),
    },
  }))
  assert.equal(intent.key, 'audit:production-integrity')
  assert.equal(intent.kind, 'audit_inconsistent')
  assert.equal(intent.operation, 'open_update')
  assert.equal(intent.severity, 'critical')
  assert.match(intent.title, /runtime_managed_release_mismatch/)
})

test('healthy audit closes an existing audit thread without creating healthy-noise issues', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: AUDIT }, deps({
    sourceRun: auditRun(),
    artifacts: { [`${AUDIT}:production-release-audit`]: auditArtifact() },
  }))
  assert.equal(intent.key, 'audit:production-integrity')
  assert.equal(intent.kind, 'audit_recovered')
  assert.equal(intent.operation, 'close_existing')

  const writes = []
  const result = await publishIntent({ repo: REPO, owner: 'henilllpatelll', intent, expectedDigest: digestIntent(intent) }, {
    ...deps(),
    createIssue: async () => { writes.push('create'); return { number: 99 } },
    getIssue: async () => { writes.push('get'); return { number: 99, state: 'open' } },
    commentIssue: async () => { writes.push('comment') },
    setIssueState: async () => { writes.push('state') },
  })
  assert.deepEqual(result, { issue_number: null, action: 'no_existing_issue' })
  assert.deepEqual(writes, [])
})

test('deferred audit during active production operation is notification no-op', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: AUDIT }, deps({
    sourceRun: auditRun(),
    artifacts: {
      [`${AUDIT}:production-release-audit`]: auditArtifact({
        state: 'deferred_active_production_operation',
        consistent: true,
        active_production_operations: 1,
        runtime: { proven: false, version: null, sha: null },
        managed_release: { proven: false, tag: null, sha: null },
      }),
    },
  }))
  assert.equal(intent.kind, 'audit_deferred')
  assert.equal(intent.operation, 'none')
})

test('missing audit evidence is critical and never treats a workflow conclusion as production truth', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: AUDIT }, deps({
    sourceRun: auditRun({ conclusion: 'failure' }),
  }))
  assert.equal(intent.key, 'audit:production-integrity')
  assert.equal(intent.kind, 'audit_evidence_missing')
  assert.equal(intent.severity, 'critical')
})

test('stable and transient-unconfirmed releases do not create GitHub issue noise', async () => {
  for (const classification of ['stable', 'transient_unconfirmed']) {
    const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
      artifacts: { [`${STAB}:production-release-stabilization`]: stabilization(classification) },
    }))
    assert.equal(intent.operation, 'none')
    assert.equal(intent.kind, 'no_action')
  }
})

test('confirmed production regression creates a critical incident thread keyed by stabilization run', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
    artifacts: { [`${STAB}:production-release-stabilization`]: stabilization('post_release_regression') },
  }))
  assert.equal(intent.key, `incident:${STAB}`)
  assert.equal(intent.operation, 'open_update')
  assert.equal(intent.severity, 'critical')
  assert.match(intent.title, /post_release_regression/)
  assert.ok(intent.details.some((line) => /Automatic rollback may be requested/.test(line)))
})

test('partial release failure is critical and warns that production may be partially mutated', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
    artifacts: { [`${STAB}:production-release-stabilization`]: stabilization('partial_release_failure') },
  }))
  assert.equal(intent.key, `incident:${STAB}`)
  assert.equal(intent.severity, 'critical')
  assert.ok(intent.details.some((line) => /partially mutated/.test(line)))
})

test('release failures without rollback-class incidents still create human-attention issues', async () => {
  for (const classification of [
    'release_record_failure_no_runtime_incident',
    'pre_production_failure_no_incident',
    'refused_no_incident',
  ]) {
    const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
      artifacts: { [`${STAB}:production-release-stabilization`]: stabilization(classification) },
    }))
    assert.equal(intent.key, `release:${RELEASE}`)
    assert.equal(intent.operation, 'open_update')
    assert.equal(intent.kind, 'release_attention')
  }
})

test('failed or evidence-less stabilization creates a critical generic issue instead of guessing release state', async () => {
  const failed = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
    sourceRun: stabilizationRun({ conclusion: 'failure' }),
  }))
  assert.equal(failed.kind, 'stabilization_failed')
  assert.equal(failed.severity, 'critical')

  const missing = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps())
  assert.equal(missing.kind, 'stabilization_evidence_missing')
  assert.equal(missing.severity, 'critical')
})

test('successful automated rollback updates the original incident and requires re-entry', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: ROLLBACK }, deps({
    sourceRun: rollbackRun(),
    artifacts: { [`${ROLLBACK}:production-rollback-evidence`]: rollbackEvidence() },
  }))
  assert.equal(intent.key, `incident:${STAB}`)
  assert.equal(intent.kind, 'automated_rollback_restored')
  assert.equal(intent.operation, 'open_update')
  assert.equal(intent.close_after_publish, false)
  assert.ok(intent.details.some((line) => /Production Incident Re-entry/.test(line)))
})

test('automated rollback failure and unproven quarantine keep the incident critical and open', async () => {
  const failed = await buildNotificationIntent({ repo: REPO, sourceRunId: ROLLBACK }, deps({
    sourceRun: rollbackRun({ conclusion: 'failure' }),
    artifacts: { [`${ROLLBACK}:production-rollback-evidence`]: rollbackEvidence({
      disposition: 'failed_or_partial',
      production_verified: false,
    }) },
  }))
  assert.equal(failed.key, `incident:${STAB}`)
  assert.equal(failed.severity, 'critical')
  assert.equal(failed.kind, 'automated_rollback_failed')

  const unproven = await buildNotificationIntent({ repo: REPO, sourceRunId: ROLLBACK }, deps({
    sourceRun: rollbackRun(),
    artifacts: { [`${ROLLBACK}:production-rollback-evidence`]: rollbackEvidence({
      disposition: 'restored_quarantine_unproven',
      quarantine: 'unproven',
    }) },
  }))
  assert.equal(unproven.kind, 'rollback_quarantine_unproven')
  assert.equal(unproven.severity, 'critical')
})

test('successful manual rollback creates a notification but closes its standalone issue', async () => {
  const evidence = rollbackEvidence({
    source: {
      mode: 'manual',
      automation_source_present: false,
      automation_source_valid: true,
      automation_source_run_id: null,
    },
  })
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: ROLLBACK }, deps({
    sourceRun: rollbackRun(),
    artifacts: { [`${ROLLBACK}:production-rollback-evidence`]: evidence },
  }))
  assert.equal(intent.key, `rollback:${ROLLBACK}`)
  assert.equal(intent.kind, 'manual_rollback_restored')
  assert.equal(intent.close_after_publish, true)
})

test('missing rollback evidence produces a standalone critical human-review alert', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: ROLLBACK }, deps({
    sourceRun: rollbackRun({ conclusion: 'failure' }),
  }))
  assert.equal(intent.key, `rollback:${ROLLBACK}`)
  assert.equal(intent.kind, 'rollback_evidence_missing')
  assert.equal(intent.severity, 'critical')
})

test('successful re-entry updates the original incident; failed or missing authorization never claims production approval', async () => {
  const success = await buildNotificationIntent({ repo: REPO, sourceRunId: REENTRY }, deps({
    sourceRun: reentryRun(),
    artifacts: { [`${REENTRY}:production-incident-reentry`]: reentryAuthorization() },
  }))
  assert.equal(success.key, `incident:${STAB}`)
  assert.equal(success.kind, 'reentry_authorized')
  assert.ok(success.details.some((line) => line.includes(`reentry_source_run_id=${REENTRY}`)))
  assert.ok(success.details.some((line) => /remains open/.test(line)))

  const failed = await buildNotificationIntent({ repo: REPO, sourceRunId: REENTRY }, deps({
    sourceRun: reentryRun({ conclusion: 'failure' }),
  }))
  assert.equal(failed.key, `reentry:${REENTRY}`)
  assert.match(failed.details.join(' '), /No production deployment was authorized/)

  const missing = await buildNotificationIntent({ repo: REPO, sourceRunId: REENTRY }, deps({
    sourceRun: reentryRun(),
  }))
  assert.equal(missing.kind, 'reentry_evidence_missing')
  assert.equal(missing.severity, 'critical')
})

test('verified stabilization closeout resolves the original incident through trusted rollback evidence', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
    artifacts: {
      [`${STAB}:production-release-stabilization`]: stabilization('stable', {
        candidate: { eligible: true, release_sha: D, pr_number: 111, version: 'v1.8.2' },
      }),
      [`${STAB}:production-incident-closeout`]: closeout(),
      [`${ROLLBACK}:production-rollback-evidence`]: rollbackEvidence(),
    },
  }))
  assert.equal(intent.key, `incident:${STAB}`)
  assert.equal(intent.kind, 'incident_closed')
  assert.equal(intent.operation, 'close')
  assert.equal(intent.severity, 'info')
})

const notificationRun = (id = NOTIFY) => runBase({
  id,
  name: 'Production Operations Notify',
  path: '.github/workflows/production-operations-notify.yml',
  event: 'workflow_run',
  sha: C,
  createdAt: '2026-10-06T08:30:00Z',
})

const notificationResult = ({ runId = NOTIFY, eventId, key, issueNumber = 42, action = 'commented' }) => ({
  schema: 'patelrep.production-operations-notification.v1',
  workflow: 'Production Operations Notify',
  run: { id: runId, attempt: 1, control_plane_sha: C },
  event_id: eventId,
  key,
  source: {},
  issue_number: issueNumber === null ? null : String(issueNumber),
  action,
})

test('publisher deduplicates an exact source event without mutating Issues again', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
    artifacts: { [`${STAB}:production-release-stabilization`]: stabilization('post_release_regression') },
  }))
  const writes = []
  const d = {
    ...deps({
      notificationRuns: [notificationRun()],
      notificationResults: {
        [NOTIFY]: notificationResult({ eventId: intent.event_id, key: intent.key }),
      },
    }),
    createIssue: async (...args) => { writes.push(['create', args]); return { number: 99 } },
    getIssue: async () => ({ number: 42, state: 'open' }),
    commentIssue: async (...args) => { writes.push(['comment', args]) },
    setIssueState: async (...args) => { writes.push(['state', args]) },
  }
  const result = await publishIntent({ repo: REPO, owner: 'henilllpatelll', intent, expectedDigest: digestIntent(intent) }, d)
  assert.deepEqual(result, { issue_number: 42, action: 'deduplicated' })
  assert.deepEqual(writes, [])
})

test('publisher updates an existing incident issue and closes it only for closeout', async () => {
  const openIntent = await buildNotificationIntent({ repo: REPO, sourceRunId: ROLLBACK }, deps({
    sourceRun: rollbackRun(),
    artifacts: { [`${ROLLBACK}:production-rollback-evidence`]: rollbackEvidence() },
  }))
  const priorRunId = '37630000002'
  const writes = []
  const d = {
    ...deps({
      notificationRuns: [notificationRun(priorRunId)],
      notificationResults: {
        [priorRunId]: notificationResult({
          runId: priorRunId,
          eventId: `Production Release Stabilization:${STAB}:incident_opened`,
          key: openIntent.key,
          issueNumber: 42,
          action: 'created',
        }),
      },
    }),
    getIssue: async () => ({ number: 42, state: 'open' }),
    createIssue: async () => { throw new Error('must not create') },
    commentIssue: async (number, body) => { writes.push(['comment', number, body]) },
    setIssueState: async (number, state) => { writes.push(['state', number, state]) },
  }
  const updated = await publishIntent({ repo: REPO, owner: 'henilllpatelll', intent: openIntent, expectedDigest: digestIntent(openIntent) }, d)
  assert.equal(updated.issue_number, 42)
  assert.equal(updated.action, 'commented')
  assert.equal(writes.filter(([kind]) => kind === 'comment').length, 1)
  assert.equal(writes.filter(([kind]) => kind === 'state').length, 0)
})

test('publisher creates and assigns a new issue with sanitized trusted identifiers only', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
    artifacts: { [`${STAB}:production-release-stabilization`]: stabilization('post_release_regression') },
  }))
  const calls = []
  const d = {
    ...deps(),
    createIssue: async (args) => {
      calls.push(args)
      return { number: 77, state: 'open' }
    },
    getIssue: async () => { throw new Error('must not read') },
    commentIssue: async () => { throw new Error('must not comment') },
    setIssueState: async () => { throw new Error('must not close') },
  }
  const result = await publishIntent({ repo: REPO, owner: 'henilllpatelll', intent, expectedDigest: digestIntent(intent) }, d)
  assert.deepEqual(result, { issue_number: 77, action: 'created' })
  assert.equal(calls[0].assignee, 'henilllpatelll')
  assert.match(calls[0].title, /^\[CRITICAL\]/)
  assert.match(calls[0].body, /patelrep-production-notification:incident:/)
  assert.doesNotMatch(calls[0].body, /token=|secret=|password=/i)
})

test('healthy audit closes an existing production-integrity issue', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: AUDIT }, deps({
    sourceRun: auditRun(),
    artifacts: { [`${AUDIT}:production-release-audit`]: auditArtifact() },
  }))
  const priorRunId = '37630000003'
  const writes = []
  const d = {
    ...deps({
      notificationRuns: [notificationRun(priorRunId)],
      notificationResults: {
        [priorRunId]: notificationResult({
          runId: priorRunId,
          eventId: `Production Release Audit:37639999999:audit_inconsistent`,
          key: 'audit:production-integrity',
          issueNumber: 55,
          action: 'created',
        }),
      },
    }),
    getIssue: async () => ({ number: 55, state: 'open' }),
    createIssue: async () => { throw new Error('must not create') },
    commentIssue: async (number, body) => { writes.push(['comment', number, body]) },
    setIssueState: async (number, state) => { writes.push(['state', number, state]) },
  }
  const result = await publishIntent({ repo: REPO, owner: 'henilllpatelll', intent, expectedDigest: digestIntent(intent) }, d)
  assert.deepEqual(result, { issue_number: 55, action: 'closed' })
  assert.equal(writes.filter(([kind]) => kind === 'comment').length, 1)
  assert.deepEqual(writes.find(([kind]) => kind === 'state').slice(1), [55, 'closed'])
})

test('publisher refuses intent drift before any issue write', async () => {
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
    artifacts: { [`${STAB}:production-release-stabilization`]: stabilization('post_release_regression') },
  }))
  let wrote = false
  await assert.rejects(
    publishIntent({ repo: REPO, owner: 'henilllpatelll', intent, expectedDigest: '0'.repeat(64) }, {
      ...deps(),
      createIssue: async () => { wrote = true },
    }),
    /intent changed between resolve and publish/,
  )
  assert.equal(wrote, false)
})

test('dynamic run names yield the canonical workflow identity and deterministic event ids', async () => {
  const rollbackIntent = await buildNotificationIntent({ repo: REPO, sourceRunId: ROLLBACK }, deps({
    sourceRun: rollbackRun(),
    artifacts: { [`${ROLLBACK}:production-rollback-evidence`]: rollbackEvidence() },
  }))
  assert.equal(rollbackIntent.source.workflow, 'Production Rollback')
  assert.match(rollbackIntent.event_id, /^Production Rollback:/)

  const renamed = await buildNotificationIntent({ repo: REPO, sourceRunId: ROLLBACK }, deps({
    sourceRun: rollbackRun({ name: 'Some Other Run Title' }),
    artifacts: { [`${ROLLBACK}:production-rollback-evidence`]: rollbackEvidence() },
  }))
  assert.equal(renamed.event_id, rollbackIntent.event_id)
  assert.equal(renamed.source.workflow, 'Production Rollback')

  const reentryIntent = await buildNotificationIntent({ repo: REPO, sourceRunId: REENTRY }, deps({ sourceRun: reentryRun() }))
  assert.equal(reentryIntent.source.workflow, 'Production Incident Re-entry')
  assert.match(reentryIntent.event_id, /^Production Incident Re-entry:/)
})

test('a trusted display name on the wrong workflow path is rejected', async () => {
  for (const name of ['Production Rollback', 'Production Incident Re-entry', 'Production Release Stabilization']) {
    await assert.rejects(
      buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
        sourceRun: stabilizationRun({ name, path: '.github/workflows/production-release.yml' }),
      })),
      /production notification: source is not a trusted production operations workflow/,
    )
  }
})

test('source provenance rejects wrong workflow path repo branch or event', async () => {
  for (const bad of [
    { path: '.github/workflows/other.yml' },
    { event: 'push' },
    { head_branch: 'feature/foo' },
    { repository: { full_name: 'other/repo' } },
  ]) {
    await assert.rejects(
      buildNotificationIntent({ repo: REPO, sourceRunId: STAB }, deps({
        sourceRun: stabilizationRun(bad),
      })),
      /production notification:/,
    )
  }
})
