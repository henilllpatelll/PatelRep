#!/usr/bin/env node
// Phase 4C: trusted GitHub-native production operations notifications.
// Resolve is read-only. Publish may mutate GitHub Issues only; it never deploys, migrates, tags, releases,
// dispatches workflows, changes variables/secrets, or receives a production Environment.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOTIFICATION_ARTIFACT, realProductionNotificationDeps } from './production-operations-notify-deps.mjs'

export const NOTIFICATION_SCHEMA = 'patelrep.production-operations-notification.v1'
export const INTENT_SCHEMA = 'patelrep.production-operations-notification-intent.v1'
export const WORKFLOW_NAME = 'Production Operations Notify'
export const WORKFLOW_PATH = '.github/workflows/production-operations-notify.yml'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const ISSUE_NUMBER = /^[1-9][0-9]{0,9}$/
const CLASSIFICATIONS = new Set([
  'stable',
  'transient_unconfirmed',
  'post_release_regression',
  'partial_release_failure',
  'release_record_failure_no_runtime_incident',
  'pre_production_failure_no_incident',
  'refused_no_incident',
])
const ROLLBACK_DISPOSITIONS = new Set([
  'restored',
  'restored_quarantine_unproven',
  'refused_before_production_access',
  'failed_before_production_access',
  'refused_before_target_resolution',
  'refused_before_deployment',
  'failed_or_partial',
])

const clean = (value) => String(value ?? '').trim()
const oneLine = (value) => clean(value).replace(/[\r\n]+/g, ' ')

function fail(message) {
  throw new Error(`production notification: ${message}`)
}

function requireMatch(name, value, pattern) {
  const normalized = clean(value)
  if (!pattern.test(normalized)) fail(`invalid ${name}`)
  return normalized
}

function optionalVersion(value) {
  const normalized = clean(value)
  if (!normalized) return null
  if (!VERSION.test(normalized)) fail('invalid optional version')
  return normalized
}

function optionalSha(value) {
  const normalized = clean(value)
  if (!normalized) return null
  if (!SHA.test(normalized)) fail('invalid optional SHA')
  return normalized
}

const SOURCE_WORKFLOWS = Object.freeze({
  'Production Release Stabilization': {
    path: '.github/workflows/production-release-stabilization.yml',
    event: 'workflow_run',
  },
  'Production Rollback': {
    path: '.github/workflows/production-rollback.yml',
    event: 'workflow_dispatch',
  },
  'Production Incident Re-entry': {
    path: '.github/workflows/production-incident-reentry.yml',
    event: 'workflow_dispatch',
  },
})

export function validateSourceRun(run, { repo, sourceRunId }) {
  if (!run || String(run.id) !== String(sourceRunId)) fail('source run id mismatch')
  const expected = SOURCE_WORKFLOWS[run.name]
  if (!expected || run.path !== expected.path) fail('source is not a trusted production operations workflow')
  if (run.event !== expected.event || run.status !== 'completed') fail('source workflow is not completed with the expected event')
  if (run.head_branch !== 'main') fail('source workflow did not run from main')
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) fail('source repository provenance mismatch')
  requireMatch('source control-plane SHA', run.head_sha, SHA)
  if (!['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale'].includes(run.conclusion)) {
    fail('source workflow conclusion is unknown')
  }
  return run
}

function validateStabilization(result, run) {
  if (!result || result.schema !== 'patelrep.production-release-stabilization.v1' || result.workflow !== 'Production Release Stabilization') {
    fail('malformed stabilization result')
  }
  if (String(result.classifier?.run_id ?? '') !== String(run.id) ||
      Number(result.classifier?.run_attempt) !== Number(run.run_attempt) ||
      result.classifier?.control_plane_sha !== run.head_sha) {
    fail('stabilization classifier provenance mismatch')
  }
  if (!CLASSIFICATIONS.has(result.classification)) fail('unknown stabilization classification')
  const releaseRunId = requireMatch('source release run id', result.source_release?.run_id, RUN_ID)
  const candidateVersion = optionalVersion(result.candidate?.version)
  const candidateSha = optionalSha(result.candidate?.release_sha)
  const previousVersion = optionalVersion(result.previous_release?.tag)
  const previousSha = optionalSha(result.previous_release?.sha)
  return {
    release_run_id: releaseRunId,
    classification: result.classification,
    candidate_version: candidateVersion,
    candidate_sha: candidateSha,
    previous_version: previousVersion,
    previous_sha: previousSha,
  }
}

function validateCloseout(closeout, run) {
  if (!closeout || closeout.schema !== 'patelrep.production-incident-closeout.v1' ||
      closeout.workflow !== 'Production Release Stabilization' || closeout.closed !== true) {
    fail('malformed incident closeout')
  }
  if (String(closeout.classifier?.run_id ?? '') !== String(run.id) ||
      Number(closeout.classifier?.run_attempt) !== Number(run.run_attempt) ||
      closeout.classifier?.control_plane_sha !== run.head_sha) {
    fail('incident closeout provenance mismatch')
  }
  if (!['stable', 'transient_unconfirmed'].includes(closeout.classification)) fail('incident closeout classification is invalid')
  return {
    rollback_run_id: requireMatch('closeout rollback run id', closeout.reentry?.rollback_run_id, RUN_ID),
    authorization_run_id: requireMatch('closeout authorization run id', closeout.reentry?.authorization_run_id, RUN_ID),
    candidate_version: requireMatch('closeout candidate version', closeout.candidate?.version, VERSION),
    candidate_sha: requireMatch('closeout candidate SHA', closeout.candidate?.release_sha, SHA),
  }
}

function validateRollbackEvidence(evidence, run) {
  if (!evidence || evidence.schema !== 'patelrep.production-rollback-evidence.v1' || evidence.workflow !== 'Production Rollback') {
    fail('malformed rollback evidence')
  }
  if (String(evidence.run?.id ?? '') !== String(run.id) ||
      Number(evidence.run?.attempt) !== Number(run.run_attempt) ||
      evidence.run?.control_plane_sha !== run.head_sha) {
    fail('rollback evidence provenance mismatch')
  }
  if (!ROLLBACK_DISPOSITIONS.has(evidence.disposition)) fail('unknown rollback disposition')
  const automated = evidence.source?.mode === 'automated_incident' &&
    evidence.source?.automation_source_present === true &&
    evidence.source?.automation_source_valid === true
  const incidentRunId = automated
    ? requireMatch('rollback incident source run id', evidence.source?.automation_source_run_id, RUN_ID)
    : null
  return {
    automated,
    incident_run_id: incidentRunId,
    disposition: evidence.disposition,
    target_version: evidence.target?.resolved === true ? requireMatch('rollback target version', evidence.target?.version, VERSION) : null,
    target_sha: evidence.target?.resolved === true ? requireMatch('rollback target SHA', evidence.target?.sha, SHA) : null,
    production_verified: evidence.production_verified === true,
    quarantine: clean(evidence.quarantine) || null,
  }
}

function validateReentryAuthorization(auth, run) {
  if (!auth || auth.schema !== 'patelrep.production-incident-reentry.v1' || auth.workflow !== 'Production Incident Re-entry') {
    fail('malformed re-entry authorization')
  }
  if (String(auth.run?.id ?? '') !== String(run.id) ||
      Number(auth.run?.attempt) !== Number(run.run_attempt) ||
      auth.run?.control_plane_sha !== run.head_sha) {
    fail('re-entry authorization provenance mismatch')
  }
  return {
    rollback_run_id: requireMatch('re-entry rollback run id', auth.rollback?.run_id, RUN_ID),
    incident_run_id: requireMatch('re-entry incident run id', auth.rollback?.incident_run_id, RUN_ID),
    release_sha: requireMatch('authorized release SHA', auth.authorized_release?.sha, SHA),
    version_bump: ['patch', 'minor', 'major'].includes(auth.authorized_release?.version_bump) ? auth.authorized_release.version_bump : fail('invalid re-entry version bump'),
  }
}

function makeIntent({ run, key, kind, operation, severity, title, details, closeAfterPublish = false }) {
  if (!/^(incident|release|rollback|reentry|workflow):[A-Za-z0-9._:-]{1,120}$/.test(key)) fail('invalid notification key')
  if (!['open_update', 'close', 'none'].includes(operation)) fail('invalid notification operation')
  if (!['info', 'warning', 'critical'].includes(severity)) fail('invalid notification severity')
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._:\-()[\]/]{0,180}$/.test(title)) fail('invalid notification title')
  if (!Array.isArray(details) || details.some((line) => typeof line !== 'string' || line.length > 220 || /[\r\n]/.test(line))) {
    fail('invalid notification details')
  }
  const sourceId = String(run.id)
  return Object.freeze({
    schema: INTENT_SCHEMA,
    event_id: `${run.name}:${sourceId}:${kind}`,
    key,
    kind,
    operation,
    severity,
    title,
    source: {
      workflow: run.name,
      run_id: sourceId,
      run_attempt: Number(run.run_attempt),
      control_plane_sha: run.head_sha,
      conclusion: run.conclusion,
    },
    details,
    close_after_publish: closeAfterPublish,
  })
}

async function incidentIdFromRollbackRun(repo, rollbackRunId, deps) {
  const rollbackRun = validateSourceRun(await deps.getRun(rollbackRunId), { repo, sourceRunId: rollbackRunId })
  if (rollbackRun.name !== 'Production Rollback') fail('closeout rollback run is not trusted Production Rollback')
  const evidence = await deps.readNamedContext(rollbackRunId, 'production-rollback-evidence')
  if (!evidence) fail('closeout rollback evidence is missing')
  const validated = validateRollbackEvidence(evidence, rollbackRun)
  if (!validated.automated || !validated.incident_run_id) fail('closeout rollback was not an automated incident rollback')
  return validated.incident_run_id
}

export async function buildNotificationIntent({ repo, sourceRunId }, deps) {
  const run = validateSourceRun(await deps.getRun(sourceRunId), { repo, sourceRunId })

  if (run.name === 'Production Release Stabilization') {
    if (run.conclusion !== 'success') {
      return makeIntent({
        run,
        key: `workflow:stabilization-${run.id}`,
        kind: 'stabilization_failed',
        operation: 'open_update',
        severity: 'critical',
        title: `Production stabilization workflow failed (run ${run.id})`,
        details: [
          'The trusted production stabilization/classification workflow did not complete successfully.',
          'Human investigation is required because release state could not be classified safely.',
        ],
      })
    }

    const resultRaw = await deps.readNamedContext(sourceRunId, 'production-release-stabilization')
    if (!resultRaw) fail('successful stabilization run has no stabilization result artifact')
    const result = validateStabilization(resultRaw, run)

    const closeoutRaw = await deps.readNamedContext(sourceRunId, 'production-incident-closeout')
    if (closeoutRaw) {
      const closeout = validateCloseout(closeoutRaw, run)
      const incidentRunId = await incidentIdFromRollbackRun(repo, closeout.rollback_run_id, deps)
      return makeIntent({
        run,
        key: `incident:${incidentRunId}`,
        kind: 'incident_closed',
        operation: 'close',
        severity: 'info',
        title: `Production incident resolved after ${closeout.candidate_version}`,
        details: [
          `Verified closeout after authorized re-entry release ${closeout.candidate_version} at ${closeout.candidate_sha}.`,
          `Rollback run ${closeout.rollback_run_id}; re-entry authorization run ${closeout.authorization_run_id}.`,
          `Stabilization classification: ${closeoutRaw.classification}.`,
        ],
      })
    }

    if (result.classification === 'stable' || result.classification === 'transient_unconfirmed') {
      return makeIntent({
        run,
        key: `release:${result.release_run_id}`,
        kind: 'no_action',
        operation: 'none',
        severity: 'info',
        title: `Production release ${result.classification}`,
        details: [`Release run ${result.release_run_id} requires no incident notification.`],
      })
    }

    if (['post_release_regression', 'partial_release_failure'].includes(result.classification)) {
      const versionText = result.candidate_version ?? 'candidate'
      const regression = result.classification === 'post_release_regression'
      return makeIntent({
        run,
        key: `incident:${run.id}`,
        kind: 'incident_opened',
        operation: 'open_update',
        severity: 'critical',
        title: `Production incident: ${result.classification} (${versionText})`,
        details: [
          `Confirmed incident classification: ${result.classification}.`,
          result.candidate_sha ? `Candidate: ${versionText} / ${result.candidate_sha}.` : `Candidate version: ${versionText}.`,
          result.previous_version && result.previous_sha
            ? `Previous managed release: ${result.previous_version} / ${result.previous_sha}.`
            : 'Previous managed release identity was not available.',
          regression
            ? 'Automatic rollback may be requested only if the strict zero-migration, low-risk Phase 3 policy passes.'
            : 'Production may be partially mutated; automatic rollback is allowed only if the strict Phase 3 policy proves it safe.',
        ],
      })
    }

    const humanAction = result.classification === 'release_record_failure_no_runtime_incident'
      ? 'Production runtime verified, but release bookkeeping failed; human release-ledger review is required.'
      : result.classification === 'pre_production_failure_no_incident'
        ? 'Production was not mutated; inspect and fix the failed release before retrying.'
        : 'Production release was refused by trusted gates; inspect the release request before retrying.'
    return makeIntent({
      run,
      key: `release:${result.release_run_id}`,
      kind: 'release_attention',
      operation: 'open_update',
      severity: result.classification === 'release_record_failure_no_runtime_incident' ? 'critical' : 'warning',
      title: `Production release needs attention: ${result.classification}`,
      details: [
        `Release run ${result.release_run_id} classified as ${result.classification}.`,
        humanAction,
      ],
    })
  }

  if (run.name === 'Production Rollback') {
    let evidence = null
    try {
      evidence = await deps.readNamedContext(sourceRunId, 'production-rollback-evidence')
    } catch (error) {
      if (run.conclusion === 'success') throw error
    }
    if (!evidence) {
      return makeIntent({
        run,
        key: `rollback:${run.id}`,
        kind: 'rollback_evidence_missing',
        operation: 'open_update',
        severity: 'critical',
        title: `Production rollback needs human review (run ${run.id})`,
        details: [
          `Production Rollback concluded ${run.conclusion}, but trusted Phase 4A rollback evidence is unavailable.`,
          'Do not infer production state; inspect the rollback run and live runtime manually.',
        ],
      })
    }
    const rollback = validateRollbackEvidence(evidence, run)
    const key = rollback.automated ? `incident:${rollback.incident_run_id}` : `rollback:${run.id}`
    const targetText = rollback.target_version && rollback.target_sha
      ? `${rollback.target_version} / ${rollback.target_sha}`
      : 'unresolved target'

    if (rollback.disposition === 'restored' && rollback.production_verified) {
      return makeIntent({
        run,
        key,
        kind: rollback.automated ? 'automated_rollback_restored' : 'manual_rollback_restored',
        operation: 'open_update',
        severity: rollback.automated ? 'warning' : 'info',
        title: rollback.automated
          ? `Production restored by automatic rollback to ${rollback.target_version}`
          : `Production restored by manual rollback to ${rollback.target_version}`,
        details: rollback.automated
          ? [
              `Production verified at rollback target ${targetText}.`,
              `Circuit-breaker state: ${rollback.quarantine ?? 'unknown'}.`,
              'Incident remains open. Fix forward through CI/Staging, then run Production Incident Re-entry before another Production Release.',
            ]
          : [
              `Production verified at rollback target ${targetText}.`,
              'Manual rollback completed successfully.',
            ],
        closeAfterPublish: !rollback.automated,
      })
    }

    if (rollback.disposition === 'restored_quarantine_unproven' && rollback.production_verified) {
      return makeIntent({
        run,
        key,
        kind: 'rollback_quarantine_unproven',
        operation: 'open_update',
        severity: 'critical',
        title: 'Production restored but rollback quarantine is unproven',
        details: [
          `Production verified at rollback target ${targetText}.`,
          'The automated circuit-breaker proof did not succeed. Keep re-entry manual and investigate before any release.',
        ],
      })
    }

    return makeIntent({
      run,
      key,
      kind: rollback.automated ? 'automated_rollback_failed' : 'manual_rollback_failed',
      operation: 'open_update',
      severity: 'critical',
      title: `Production rollback needs intervention: ${rollback.disposition}`,
      details: [
        `Rollback disposition: ${rollback.disposition}; workflow conclusion: ${run.conclusion}.`,
        `Target: ${targetText}.`,
        'Production state must not be guessed. Human investigation is required before further release activity.',
      ],
    })
  }

  if (run.name === 'Production Incident Re-entry') {
    if (run.conclusion !== 'success') {
      return makeIntent({
        run,
        key: `reentry:${run.id}`,
        kind: 'reentry_failed',
        operation: 'open_update',
        severity: 'warning',
        title: `Production incident re-entry authorization failed (run ${run.id})`,
        details: [
          `Production Incident Re-entry concluded ${run.conclusion}.`,
          'No production deployment was authorized by this run. Review the failed authorization before retrying.',
        ],
      })
    }
    const raw = await deps.readNamedContext(sourceRunId, 'production-incident-reentry')
    if (!raw) fail('successful re-entry run has no authorization artifact')
    const auth = validateReentryAuthorization(raw, run)
    return makeIntent({
      run,
      key: `incident:${auth.incident_run_id}`,
      kind: 'reentry_authorized',
      operation: 'open_update',
      severity: 'warning',
      title: 'Production incident re-entry authorized',
      details: [
        `Exact release SHA authorized: ${auth.release_sha}; version bump: ${auth.version_bump}.`,
        `Rollback run ${auth.rollback_run_id}; authorization run ${run.id}.`,
        `Manually dispatch Production Release with release_sha=${auth.release_sha}, version_bump=${auth.version_bump}, and reentry_source_run_id=${run.id}.`,
        'The incident remains open until Production Release Stabilization emits a verified closeout.',
      ],
    })
  }

  fail('unhandled trusted source workflow')
}

export const digestIntent = (intent) => createHash('sha256').update(JSON.stringify(intent)).digest('hex')

function issueMarker(key) {
  return `<!-- patelrep-production-notification:${key} -->`
}

function renderDetails(intent) {
  return intent.details.map((line) => `- ${line}`).join('\n')
}

function renderInitialBody(intent, repo) {
  return [
    issueMarker(intent.key),
    `**Severity:** ${intent.severity}`,
    `**Source:** ${intent.source.workflow} run ${intent.source.run_id} (attempt ${intent.source.run_attempt}, ${intent.source.conclusion})`,
    '',
    renderDetails(intent),
    '',
    `Actions run: https://github.com/${repo}/actions/runs/${intent.source.run_id}`,
    '',
    '_This issue is maintained by the trusted Phase 4C production-operations notification workflow. It has no production deployment authority._',
  ].join('\n')
}

function renderComment(intent, repo) {
  return [
    `### ${intent.title}`,
    `**Severity:** ${intent.severity}`,
    renderDetails(intent),
    `Actions run: https://github.com/${repo}/actions/runs/${intent.source.run_id}`,
    `Event: `${intent.event_id}``,
  ].join('\n\n')
}

function validateNotificationRun(run, repo) {
  if (!run || run.name !== WORKFLOW_NAME || run.path !== WORKFLOW_PATH ||
      run.event !== 'workflow_run' || run.status !== 'completed' || run.conclusion !== 'success' ||
      run.head_branch !== 'main' || run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) {
    fail('prior notification run provenance is invalid')
  }
  requireMatch('notification run control-plane SHA', run.head_sha, SHA)
  return run
}

function validateNotificationResult(result, run) {
  if (!result || result.schema !== NOTIFICATION_SCHEMA || result.workflow !== WORKFLOW_NAME) fail('malformed notification result')
  if (String(result.run?.id ?? '') !== String(run.id) ||
      Number(result.run?.attempt) !== Number(run.run_attempt) ||
      result.run?.control_plane_sha !== run.head_sha) {
    fail('notification result provenance mismatch')
  }
  if (typeof result.event_id !== 'string' || typeof result.key !== 'string') fail('notification result identity is malformed')
  const issueNumber = requireMatch('notification issue number', result.issue_number, ISSUE_NUMBER)
  if (!['created', 'commented', 'closed', 'deduplicated'].includes(result.action)) fail('notification result action is invalid')
  return { event_id: result.event_id, key: result.key, issue_number: Number(issueNumber), action: result.action }
}

async function findPriorNotification({ repo, intent, deps }) {
  const runs = await deps.listNotificationRuns()
  if (!Array.isArray(runs)) fail('notification run list is malformed')
  let issueNumber = null
  for (const run of runs) {
    validateNotificationRun(run, repo)
    const raw = await deps.readNotificationResult(String(run.id))
    if (raw === null) continue
    const result = validateNotificationResult(raw, run)
    if (result.event_id === intent.event_id) return { duplicate: true, issue_number: result.issue_number }
    if (result.key === intent.key && issueNumber === null) issueNumber = result.issue_number
  }
  return { duplicate: false, issue_number: issueNumber }
}

export async function publishIntent({ repo, owner, intent, expectedDigest }, deps) {
  if (digestIntent(intent) !== expectedDigest) fail('notification intent changed between resolve and publish')
  if (intent.operation === 'none') fail('publish received a no-op intent')

  const prior = await findPriorNotification({ repo, intent, deps })
  if (prior.duplicate) {
    return { issue_number: prior.issue_number, action: 'deduplicated' }
  }

  let issueNumber = prior.issue_number
  let action
  if (issueNumber === null) {
    const created = await deps.createIssue({
      title: `[${intent.severity.toUpperCase()}] ${intent.title}`,
      body: renderInitialBody(intent, repo),
      assignee: owner,
    })
    issueNumber = Number(created?.number)
    if (!Number.isInteger(issueNumber) || issueNumber < 1 || created?.pull_request) fail('GitHub did not create a normal issue')
    action = 'created'
  } else {
    const issue = await deps.getIssue(issueNumber)
    if (!issue || Number(issue.number) !== issueNumber || issue.pull_request) fail('mapped production notification is not a normal issue')
    if (intent.operation === 'open_update' && issue.state === 'closed') await deps.setIssueState(issueNumber, 'open')
    await deps.commentIssue(issueNumber, renderComment(intent, repo))
    action = 'commented'
  }

  if (intent.operation === 'close' || intent.close_after_publish) {
    if (action === 'created') await deps.commentIssue(issueNumber, renderComment(intent, repo))
    await deps.setIssueState(issueNumber, 'closed')
    action = 'closed'
  }

  return { issue_number: issueNumber, action }
}

function writeResult({ dir, run, intent, published }) {
  if (!dir) fail('RESULT_DIR is required')
  const result = {
    schema: NOTIFICATION_SCHEMA,
    workflow: WORKFLOW_NAME,
    run: {
      id: String(run.id),
      attempt: Number(run.run_attempt),
      control_plane_sha: run.head_sha,
    },
    event_id: intent.event_id,
    key: intent.key,
    source: intent.source,
    issue_number: String(published.issue_number),
    action: published.action,
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'context.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  return result
}

async function main() {
  const env = process.env
  const repo = clean(env.REPO)
  const sourceRunId = requireMatch('source run id', env.SOURCE_RUN_ID, RUN_ID)
  if (!repo) fail('repository is required')
  const deps = realProductionNotificationDeps({
    repo,
    readToken: env.GH_TOKEN,
    issueToken: process.argv[2] === 'publish' ? env.GH_TOKEN : undefined,
  })
  const intent = await buildNotificationIntent({ repo, sourceRunId }, deps)
  const mode = clean(process.argv[2])

  if (mode === 'resolve') {
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT is required')
    const notify = intent.operation !== 'none'
    appendFileSync(env.GITHUB_OUTPUT, `notify=${notify ? 'true' : 'false'}\nintent_digest=${digestIntent(intent)}\n`)
    console.log(notify
      ? `Production notification eligible: ${intent.kind}; key=${intent.key}; severity=${intent.severity}`
      : `Production notification no-op: ${intent.kind}`)
    return
  }

  if (mode === 'publish') {
    const expectedDigest = requireMatch('expected intent digest', env.EXPECTED_INTENT_DIGEST, /^[0-9a-f]{64}$/)
    const notificationRunId = requireMatch('notification run id', env.NOTIFICATION_RUN_ID, RUN_ID)
    const notificationRunAttempt = Number(clean(env.NOTIFICATION_RUN_ATTEMPT))
    if (!Number.isInteger(notificationRunAttempt) || notificationRunAttempt < 1) fail('invalid notification run attempt')
    const notificationRun = validateNotificationRun({
      id: notificationRunId,
      run_attempt: notificationRunAttempt,
      name: WORKFLOW_NAME,
      path: WORKFLOW_PATH,
      event: 'workflow_run',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'main',
      head_sha: env.CONTROL_PLANE_SHA,
      repository: { full_name: repo },
      head_repository: { full_name: repo },
    }, repo)
    // The synthetic shape above exists only to sanitize the result artifact's own run identity.
    // GitHub has not completed the current notification run yet, so prior-run discovery cannot include it.
    const owner = clean(env.REPO_OWNER)
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) fail('invalid repository owner')
    const published = await publishIntent({
      repo,
      owner,
      intent,
      expectedDigest,
    }, deps)
    const result = writeResult({ dir: clean(env.RESULT_DIR), run: notificationRun, intent, published })
    console.log(`Production notification published: issue #${result.issue_number}; action=${result.action}; event=${result.event_id}`)
    return
  }

  fail('mode must be resolve or publish')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${oneLine(error.message).slice(0, 240)}`)
    process.exit(1)
  })
}
