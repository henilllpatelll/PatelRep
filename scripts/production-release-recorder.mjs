#!/usr/bin/env node
// Trusted production release RECORDING: the annotated `vX.Y.Z` tag and the GitHub Release, and nothing else.
//
// Why this exists: the built-in GITHUB_TOKEN can never hold the `workflows` permission, and GitHub requires
// `contents: write` + `workflows: write` to create a ref (even a tag, even via the Git Data API) whose commit
// contains `.github/workflows` content that differs from what the repo already has at that ref's base (runs
// 38185575766 and 38189513925: `x-accepted-github-permissions: contents=write,workflows=write`). Recording therefore
// uses a dedicated, single-purpose GitHub App token that exists only in the `release-recording` Environment and is
// minted only after production verification (or after verified record-only recovery evidence).
//
// This module is pure policy + orchestration over injected dependencies; it never deploys, migrates, rolls back,
// merges, dispatches, or touches production credentials. Every check fails closed (throws) BEFORE the first write,
// and an existing tag is NEVER moved, deleted, or force-updated: it is only ever accepted when it is already an
// annotated tag peeling to exactly the verified commit.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIRST_MANAGED_VERSION, compareVersions, completedReleases, parseStrictTag } from './release-version.mjs'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/

/** The ONLY permissions the Release Recorder App token may request (asserted against the workflows by tests). */
export const RECORDER_PERMISSIONS = Object.freeze({ contents: 'write', workflows: 'write' })

export const SOURCE_WORKFLOW_PATH = '.github/workflows/production-release.yml'
export const EVIDENCE_ARTIFACT = 'production-release-evidence'
export const EVIDENCE_SCHEMA = 'patelrep.production-release-evidence.v1'
/** Display names of the Production Release jobs that must have succeeded before a record-only recovery. */
export const REQUIRED_SUCCESS_JOBS = Object.freeze([
  'Resolve and verify release eligibility',
  'Deploy exact API release',
  'Deploy exact web release',
  'Verify production release identity and smoke',
])
export const TAG_JOB_NAME = 'Tag and create GitHub Release'
export const TAGGER = Object.freeze({ name: 'PatelRep Release Recorder', email: 'release-recorder@users.noreply.github.com' })

const fail = (message) => {
  throw new Error(`release recorder: ${message}`)
}

export function assertVersion(version) {
  if (!parseStrictTag(version)) fail(`refusing non-release tag name "${version}"`)
  return version
}
export function assertSha(sha) {
  if (!SHA.test(String(sha ?? ''))) fail(`refusing non-exact target SHA "${sha}"`)
  return sha
}

/**
 * Release version integrity: `version` must be the exact successor (patch, minor or major) of the newest COMPLETED
 * release (or the one-time bootstrap), and no other strict tag at/above it may exist without a completed Release.
 */
export function assertVersionIntegrity({ version, releases, tagNames }) {
  const wanted = parseStrictTag(assertVersion(version))
  const completed = completedReleases(releases)
  if (completed.some((release) => release.tag === version)) return { alreadyReleased: true }
  const newest = completed[0]?.version
  const allowed = newest
    ? [
        { major: newest.major, minor: newest.minor, patch: newest.patch + 1 },
        { major: newest.major, minor: newest.minor + 1, patch: 0 },
        { major: newest.major + 1, minor: 0, patch: 0 },
      ]
    : [{ ...FIRST_MANAGED_VERSION }]
  if (!allowed.some((candidate) => compareVersions(candidate, wanted) === 0)) {
    fail(`${version} is not a valid successor of ${newest ? `v${newest.major}.${newest.minor}.${newest.patch}` : 'the empty release line'}`)
  }
  if (releases.some((release) => release?.tag_name === version)) fail(`${version} already has a draft or prerelease GitHub Release; a human must investigate`)
  const completedTags = new Set(completed.map((release) => release.tag))
  const conflicting = tagNames.filter((name) => name !== version && parseStrictTag(name) && !completedTags.has(name) && compareVersions(parseStrictTag(name), wanted) >= 0)
  if (conflicting.length > 0) fail(`tag ${conflicting.join(', ')} exists without a completed Release at/above ${version}; a human must investigate`)
  return { alreadyReleased: false }
}

/** An existing tag is acceptable only if it is annotated and peels to exactly the verified commit. */
export function assertExistingTagExact({ version, sha, ref }) {
  if (ref.type !== 'tag') fail(`tag ${version} exists as a lightweight/non-annotated ref; refusing to reuse it`)
  if (ref.commit !== sha) fail(`tag ${version} already exists at ${ref.commit}, not the verified ${sha}; refusing to move or reuse it`)
}

/**
 * Evidence-backed record-only recovery gate. Everything here is derived from GitHub state of the failed
 * Production Release run; nothing is taken from the dispatch inputs except the claims to verify.
 */
export function assertRecoveryEvidence({ version, sha, sourceRunId, repo, run, jobs, evidence, identity, controlPlaneIsMainAncestor }) {
  if (!RUN_ID.test(String(sourceRunId ?? ''))) fail('source run id is invalid')
  if (!run || String(run.id) !== String(sourceRunId)) fail('source run could not be read')
  if (run.path !== SOURCE_WORKFLOW_PATH) fail(`source run is ${run.path}, not the Production Release workflow`)
  if (run.repository !== repo || run.head_repository !== repo) fail('source run is not from this repository')
  if (run.event !== 'workflow_dispatch' || run.head_branch !== 'main') fail('source run was not a manual/automation dispatch on main')
  if (run.status !== 'completed') fail('source run has not completed')
  if (run.conclusion === 'success') fail('source run already succeeded; nothing to recover')
  if (controlPlaneIsMainAncestor !== true) fail('source run control-plane commit is not an ancestor of main')

  for (const name of REQUIRED_SUCCESS_JOBS) {
    const job = jobs.find((candidate) => candidate.name === name)
    if (job?.conclusion !== 'success') fail(`source run job "${name}" did not succeed (${job?.conclusion ?? 'missing'}); production verification is unproven`)
  }
  const tagJob = jobs.find((candidate) => candidate.name === TAG_JOB_NAME)
  if (!tagJob || tagJob.conclusion === 'success' || tagJob.conclusion === 'skipped') fail(`source run "${TAG_JOB_NAME}" job did not fail; this is not a record failure`)

  if (!evidence || evidence.schema !== EVIDENCE_SCHEMA) fail('source run has no valid production release evidence ledger')
  if (String(evidence.run?.id) !== String(sourceRunId)) fail('evidence ledger belongs to a different run')
  if (evidence.candidate?.release_sha !== sha || evidence.candidate?.version !== version) fail('evidence ledger release SHA/version do not match the requested record')
  if (evidence.candidate?.eligible !== true || evidence.production_verified !== true) fail('evidence ledger does not prove eligibility and production verification')
  for (const key of ['eligibility', 'version', 'api_deploy', 'web_deploy', 'production_verification']) {
    if (evidence.jobs?.[key] !== 'success') fail(`evidence ledger job ${key} is ${evidence.jobs?.[key] ?? 'missing'}, not success`)
  }
  if (evidence.mutations?.release_record === 'created') fail('evidence ledger says the release was already recorded')

  // Live proof that production STILL serves exactly this release (no later release or rollback in between).
  if (identity?.sha !== sha || identity?.version !== version) {
    fail(`production currently serves ${identity?.version ?? 'unknown'} (${identity?.sha ?? 'unknown'}), not ${version} (${sha}); record-only recovery refused`)
  }
}

/** Read-only: gathers and asserts every record-only recovery proof. Used before the App token is even minted. */
export async function verifyRecoveryEvidence({ version, sha, repo, sourceRunId }, deps) {
  assertVersion(version)
  assertSha(sha)
  const run = await deps.getRun(sourceRunId)
  assertRecoveryEvidence({
    version,
    sha,
    sourceRunId,
    repo,
    run,
    jobs: await deps.getRunJobs(sourceRunId),
    evidence: await deps.getEvidence(sourceRunId),
    identity: await deps.readRuntimeIdentity(),
    controlPlaneIsMainAncestor: await deps.isAncestorOfMain(run.head_sha),
  })
}

/**
 * Records one release. `mode` is `pipeline` (called from the successful Production Release run, which already
 * gated this on `verify-production-release`) or `recover` (record-only; requires `recovery` evidence inputs).
 * @returns {{outcome: 'recorded'|'already_recorded', tagCreated: boolean, releaseCreated: boolean}}
 */
export async function recordRelease({ mode, version, sha, repo, recovery }, deps) {
  if (!['pipeline', 'recover'].includes(mode)) fail(`unknown mode "${mode}"`)
  assertVersion(version)
  assertSha(sha)

  if (mode === 'recover') await verifyRecoveryEvidence({ version, sha, repo, sourceRunId: recovery?.sourceRunId }, deps)

  if ((await deps.isAncestorOfMain(sha)) !== true) fail(`${sha} is not reachable from main`)
  if ((await deps.checkConclusion(sha, 'CI Gate')) !== 'success') fail(`${sha} does not have a successful CI Gate`)

  const releases = await deps.listReleases()
  const { alreadyReleased } = assertVersionIntegrity({ version, releases, tagNames: await deps.listTagNames() })
  const existingTag = await deps.getTag(version)
  if (existingTag) assertExistingTagExact({ version, sha, ref: existingTag })

  if (alreadyReleased) {
    if (!existingTag) fail(`${version} has a completed Release but no tag; a human must investigate`)
    return { outcome: 'already_recorded', tagCreated: false, releaseCreated: false }
  }

  let tagCreated = false
  if (!existingTag) {
    await deps.createAnnotatedTag({ version, sha })
    tagCreated = true
    const created = await deps.getTag(version)
    if (!created) fail(`created tag ${version} cannot be read back`)
    assertExistingTagExact({ version, sha, ref: created })
  }

  // The Release only after the tag provably resolves to the verified commit.
  await deps.createRelease({ version })
  const releases2 = completedReleases(await deps.listReleases())
  if (!releases2.some((release) => release.tag === version)) fail(`Release ${version} is not complete after creation`)
  return { outcome: 'recorded', tagCreated, releaseCreated: true }
}

/** Preflight: proves the recorder can be used (token mints/reads) WITHOUT writing anything. Runs before deploys. */
export async function preflightRecorder({ repo }, deps) {
  if (!repo) fail('repository is required')
  const identity = await deps.readRecorderRepo()
  if (identity.full_name !== repo) fail(`recorder token resolves to ${identity.full_name}, not ${repo}`)
  return { ok: true }
}

const required = (env, key) => {
  const value = String(env[key] ?? '').trim()
  if (!value) fail(`${key} is required`)
  return value
}

async function main() {
  const [command] = process.argv.slice(2)
  const env = process.env
  const repo = required(env, 'REPO')
  const { realRecorderDeps } = await import('./production-release-recorder-deps.mjs')
  const deps = realRecorderDeps({ repo, readToken: required(env, 'GH_TOKEN'), tagToken: env.TAG_TOKEN, releaseToken: env.RELEASE_TOKEN, notesFile: env.NOTES_FILE })
  if (command === 'preflight') {
    await preflightRecorder({ repo }, deps)
    console.log('Release Recorder preflight passed: App token is minted for this repository (nothing was written).')
    return
  }
  if (command === 'verify') {
    await verifyRecoveryEvidence({ version: required(env, 'RELEASE_VERSION'), sha: required(env, 'RELEASE_SHA'), repo, sourceRunId: required(env, 'SOURCE_RUN_ID') }, deps)
    console.log('Record-only recovery evidence verified (nothing was written).')
    return
  }
  if (command === 'record' || command === 'recover') {
    const result = await recordRelease(
      {
        mode: command === 'record' ? 'pipeline' : 'recover',
        version: required(env, 'RELEASE_VERSION'),
        sha: required(env, 'RELEASE_SHA'),
        repo,
        recovery: command === 'recover' ? { sourceRunId: required(env, 'SOURCE_RUN_ID') } : undefined,
      },
      deps,
    )
    console.log(`Release recording: ${result.outcome} (tagCreated=${result.tagCreated}, releaseCreated=${result.releaseCreated})`)
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `outcome=${result.outcome}\n`)
    return
  }
  fail('usage: production-release-recorder.mjs preflight|verify|record|recover')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
