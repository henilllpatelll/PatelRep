#!/usr/bin/env node
// Phase 3D: read-only proof that an automated rollback established a safe quarantine boundary.
// This runs only AFTER exact rollback verification. It never mutates production or repository state.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realAutoRollbackRequestDeps } from './production-auto-rollback-deps.mjs'
import { resolveProductionBaseline } from './release-version.mjs'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const clean = (value) => String(value ?? '').trim()

function fail(message) {
  throw new Error(`auto-rollback circuit breaker: ${message}`)
}

export async function verifyAutoRollbackCircuitBreaker({ repo, sourceRunId, targetVersion, targetSha }, deps) {
  if (!repo) fail('repository is required')
  sourceRunId = clean(sourceRunId)
  targetVersion = clean(targetVersion)
  targetSha = clean(targetSha)
  if (!RUN_ID.test(sourceRunId)) fail('invalid source run id')
  if (!VERSION.test(targetVersion)) fail('invalid target version')
  if (!SHA.test(targetSha)) fail('invalid target SHA')

  const source = await deps.getRun(sourceRunId)
  if (!source || String(source.id) !== sourceRunId) fail('source stabilization run mismatch')
  if (source.name !== 'Production Release Stabilization' || source.path !== '.github/workflows/production-release-stabilization.yml') {
    fail('source is not Production Release Stabilization')
  }
  if (source.event !== 'workflow_run' || source.status !== 'completed' || source.conclusion !== 'success') {
    fail('source stabilization run is not a completed success')
  }
  if (source.head_branch !== 'main' || source.repository?.full_name !== repo || source.head_repository?.full_name !== repo) {
    fail('source stabilization provenance mismatch')
  }

  const incident = await deps.readIncident(sourceRunId)
  if (!incident || incident.schema !== 'patelrep.production-incident.v1' || incident.workflow !== 'Production Release Stabilization') {
    fail('malformed production incident')
  }
  if (String(incident.classifier?.run_id ?? '') !== sourceRunId ||
      Number(incident.classifier?.run_attempt) !== Number(source.run_attempt) ||
      incident.classifier?.control_plane_sha !== source.head_sha) {
    fail('incident classifier provenance mismatch')
  }
  if (!['partial_release_failure', 'post_release_regression'].includes(incident.classification)) {
    fail('incident is not rollback-class')
  }
  if (incident.previous_release?.tag !== targetVersion || incident.previous_release?.sha !== targetSha) {
    fail('rollback target does not match incident previous release')
  }
  if (await deps.resolveTagCommit(targetVersion) !== targetSha) fail('rollback target tag identity changed')

  const runtime = await deps.readRuntimeIdentity()
  if (runtime?.sha !== targetSha || runtime?.version !== targetVersion) {
    fail('live runtime does not equal the verified rollback target')
  }

  const baseline = await resolveProductionBaseline(deps)
  if (!baseline) fail('managed production release baseline is missing')

  if (incident.classification === 'post_release_regression') {
    if (baseline.tag !== incident.candidate?.version || baseline.sha !== incident.candidate?.release_sha) {
      fail('newest managed Release is no longer the failed post-release candidate')
    }
    if (baseline.tag === targetVersion || baseline.sha === targetSha) {
      fail('rollback did not leave runtime behind the newest managed Release')
    }
    return {
      mode: 'managed_release_mismatch',
      runtime: { version: targetVersion, sha: targetSha },
      managed_release: baseline,
      failed_candidate: { version: incident.candidate.version, sha: incident.candidate.release_sha },
    }
  }

  // A partial Production Release never reached tag/Release creation. Its safe quarantine is different:
  // production must be restored to the still-current managed baseline, and the failed candidate must remain
  // absent from completed GitHub Releases. The Phase 2D request path cannot replay a Production Release incident;
  // it only accepts a Deploy Health recovery rooted at the managed baseline.
  if (baseline.tag !== targetVersion || baseline.sha !== targetSha) {
    fail('partial-release rollback did not restore the current managed baseline')
  }
  const releases = await deps.listReleases()
  const candidateVersion = incident.candidate?.version
  if (!VERSION.test(candidateVersion ?? '')) fail('partial-release incident candidate version is malformed')
  if (releases.some((release) => release?.tag_name === candidateVersion && release.draft !== true && release.prerelease !== true)) {
    fail('partial-release failed candidate unexpectedly became a completed managed Release')
  }
  return {
    mode: 'failed_candidate_unmanaged',
    runtime: { version: targetVersion, sha: targetSha },
    managed_release: baseline,
    failed_candidate: { version: candidateVersion, sha: incident.candidate?.release_sha ?? null },
  }
}

async function main() {
  const env = process.env
  const deps = realAutoRollbackRequestDeps({ repo: env.REPO, readToken: env.GH_TOKEN })
  const result = await verifyAutoRollbackCircuitBreaker(
    {
      repo: env.REPO,
      sourceRunId: env.SOURCE_RUN_ID,
      targetVersion: env.TARGET_VERSION,
      targetSha: env.TARGET_SHA,
    },
    deps,
  )
  console.log(
    `Automatic rollback circuit breaker verified: ${result.mode}; runtime=${result.runtime.version}/${result.runtime.sha}; managed=${result.managed_release.tag}/${result.managed_release.sha}`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
