#!/usr/bin/env node
// Production release versioning and the production baseline, both derived from COMPLETED GitHub Releases
// (non-draft, non-prerelease, tag exactly vMAJOR.MINOR.PATCH), never from arbitrary tags. The historical
// two-segment milestone tags (v1.0 ... v1.7) are not production releases and are ignored.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** One-time bootstrap: the first managed production release when no completed release exists yet. */
export const FIRST_MANAGED_VERSION = Object.freeze({ major: 1, minor: 8, patch: 0 })
export const BUMPS = Object.freeze(['patch', 'minor', 'major'])

const STRICT_TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

export function parseStrictTag(tag) {
  const match = STRICT_TAG.exec(String(tag ?? ''))
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null
}

export const formatTag = ({ major, minor, patch }) => `v${major}.${minor}.${patch}`

export function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/** Completed managed production releases, newest first. */
export function completedReleases(releases) {
  return releases
    .filter((release) => release && release.draft !== true && release.prerelease !== true)
    .map((release) => ({ tag: release.tag_name, version: parseStrictTag(release.tag_name) }))
    .filter((release) => release.version)
    .sort((a, b) => compareVersions(b.version, a.version))
}

/**
 * @param {{bump: string, releases: object[], tagNames: string[]}} input
 * @returns {{previous: string, next: string}} previous is '' for the one-time bootstrap
 * Fails closed (throws) when the computed tag, or any higher managed-looking tag, already exists without a
 * completed GitHub Release: a human must investigate; tags are never skipped, deleted or rewritten here.
 */
export function computeNextVersion({ bump, releases, tagNames }) {
  if (!BUMPS.includes(bump)) throw new Error(`release version: invalid bump "${bump}"`)
  const completed = completedReleases(releases)
  const newest = completed[0]
  let next
  if (!newest) {
    next = { ...FIRST_MANAGED_VERSION }
  } else {
    const { major, minor, patch } = newest.version
    next = bump === 'major' ? { major: major + 1, minor: 0, patch: 0 } : bump === 'minor' ? { major, minor: minor + 1, patch: 0 } : { major, minor, patch: patch + 1 }
  }
  const nextTag = formatTag(next)

  if (releases.some((release) => release?.tag_name === nextTag)) {
    throw new Error(`release version: ${nextTag} already has a GitHub Release that is a draft or prerelease; investigate manually`)
  }
  const completedTags = new Set(completed.map((release) => release.tag))
  const conflicting = tagNames
    .map((name) => ({ name, version: parseStrictTag(name) }))
    .filter(({ name, version }) => version && !completedTags.has(name) && compareVersions(version, next) >= 0)
  if (conflicting.length > 0) {
    throw new Error(
      `release version: tag ${conflicting.map((tag) => tag.name).join(', ')} exists without a completed production GitHub Release (next would be ${nextTag}). ` +
        'Not skipping, deleting or rewriting tags automatically; a human must investigate.',
    )
  }
  return { previous: newest?.tag ?? '', next: nextTag }
}

const SHA = /^[0-9a-f]{40}$/

/**
 * The newest completed production release as the production baseline, or null when none exists.
 * Its tag must exist, resolve to a commit, and that commit must be an ancestor of (or equal to) main;
 * any anomaly on that newest release throws (hard failure), it never silently falls back to an older release.
 * @param {{listReleases: Function, resolveTagCommit: Function, isAncestorOfMain: Function}} deps
 */
export async function resolveProductionBaseline(deps) {
  const newest = completedReleases(await deps.listReleases())[0]
  if (!newest) return null
  const sha = await deps.resolveTagCommit(newest.tag)
  if (!SHA.test(sha ?? '')) throw new Error(`production baseline: tag ${newest.tag} does not resolve to a commit`)
  if ((await deps.isAncestorOfMain(sha)) !== true) throw new Error(`production baseline: ${newest.tag} (${sha}) is not an ancestor of main`)
  return { tag: newest.tag, version: newest.version, sha }
}

async function main() {
  const { realReleaseDeps } = await import('./production-release-request-deps.mjs')
  const env = process.env
  const deps = realReleaseDeps({ repo: env.REPO, readToken: env.GH_TOKEN })
  const { previous, next } = computeNextVersion({ bump: env.BUMP, releases: await deps.listReleases(), tagNames: await deps.listTagNames() })
  const summary = previous
    ? `Decided release version: ${next} (previous completed release: ${previous}, bump: ${env.BUMP})`
    : `Decided release version: ${next} (no completed production release exists: one-time bootstrap of the managed release line)`
  console.log(summary)
  appendFileSync(env.GITHUB_OUTPUT, `previous=${previous}\nnext=${next}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
