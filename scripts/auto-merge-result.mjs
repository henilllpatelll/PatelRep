// Phase 2D: the sanitized "auto-merge-result" handoff written ONLY by the trusted Phase 2C merge script
// after a verified exact-SHA merge, and read ONLY by the Phase 2D request / Production Release revalidation.
// Identifiers only: no credentials, PR text or free-form strings. One strict schema shared by producer and consumers.
import { RUN_ID_PATTERN } from './recovery-lineage.mjs'

export const AUTO_MERGE_RESULT_ARTIFACT = 'auto-merge-result'
export const RESULT_FILE = 'context.json'
export const AUTO_MERGE_RESULT_KEYS = Object.freeze([
  'attempt',
  'base_main_sha',
  'candidate_branch',
  'candidate_sha',
  'ci_run_id',
  'merge_commit_sha',
  'pr_number',
  'root_run_id',
  'staging_run_id',
])

const SHA = /^[0-9a-f]{40}$/
const PR_NUMBER = /^[1-9][0-9]{0,9}$/
const ATTEMPT = /^[1-9][0-9]?$/

/** Strict validation; throws a plain Error (hard failure) on any deviation. Returns a normalized copy. */
export function parseAutoMergeResult(value) {
  const fail = (message) => {
    throw new Error(`auto-merge-result: ${message}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('is not an object')
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(AUTO_MERGE_RESULT_KEYS)) fail('has unexpected fields')
  for (const key of AUTO_MERGE_RESULT_KEYS) if (typeof value[key] !== 'string') fail(`${key} must be a string`)
  for (const key of ['base_main_sha', 'candidate_sha', 'merge_commit_sha']) if (!SHA.test(value[key])) fail(`${key} is not a 40-character SHA`)
  for (const key of ['ci_run_id', 'root_run_id', 'staging_run_id']) if (!RUN_ID_PATTERN.test(value[key])) fail(`${key} is not a numeric run id`)
  if (!PR_NUMBER.test(value.pr_number)) fail('pr_number is invalid')
  if (!ATTEMPT.test(value.attempt)) fail('attempt is invalid')
  if (value.candidate_branch !== `claude/recovery-${value.root_run_id}`) fail('candidate_branch is not the numeric-root recovery branch')
  if (new Set([value.base_main_sha, value.candidate_sha, value.merge_commit_sha]).size !== 3) fail('SHAs must be distinct')
  return Object.fromEntries(AUTO_MERGE_RESULT_KEYS.map((key) => [key, value[key]]))
}

/** Builds the artifact content from a verified merge result (see mergeRepair). */
export function buildAutoMergeResult(result) {
  return parseAutoMergeResult({
    attempt: String(result.attempt),
    base_main_sha: result.baseMainSha,
    candidate_branch: result.branch,
    candidate_sha: result.sha,
    ci_run_id: String(result.ciRunId),
    merge_commit_sha: result.mergeCommitSha,
    pr_number: String(result.prNumber),
    root_run_id: String(result.root),
    staging_run_id: String(result.stagingRunId),
  })
}
