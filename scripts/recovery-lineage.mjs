// Strict, centralized definition of the trusted recovery-lineage commit trailers.
// Commit trailers written by the trusted publisher are the ONLY authoritative retry counter;
// never infer lineage from commit counts, comments, timestamps, run searches or branch age.

/** Hard cap on automatic Claude attempts per recovery root (attempt 1 = initial repair). */
export const MAX_AUTOMATIC_REPAIR_ATTEMPTS = 3
export const RECOVERY_BRANCH_PREFIX = 'claude/recovery-'
/** Identity the trusted publisher commits as; trailers on any other author are rejected. */
export const PUBLISHER_EMAIL = 'patelrep-release-engineer[bot]@users.noreply.github.com'
export const PUBLISHER_NAME = 'patelrep-release-engineer[bot]'

export const TRAILER_ROOT = 'PatelRep-Recovery-Root'
export const TRAILER_ATTEMPT = 'PatelRep-Recovery-Attempt'
export const TRAILER_SOURCE_RUN = 'PatelRep-Recovery-Source-Run'
const TRAILER_KEYS = [TRAILER_ROOT, TRAILER_ATTEMPT, TRAILER_SOURCE_RUN]

export const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/
// A root is the exact failed upstream run id, or manual-<current run id> for a manual general task.
export const ROOT_PATTERN = /^(?:[1-9][0-9]{0,19}|manual-[1-9][0-9]{0,19})$/
const ATTEMPT_PATTERN = /^[1-9][0-9]?$/

export function recoveryBranchFor(root) {
  if (!ROOT_PATTERN.test(root)) throw new Error(`recovery lineage: invalid root ${root}`)
  return `${RECOVERY_BRANCH_PREFIX}${root}`
}

/** Root encoded in a claude/recovery-<root> branch name, or null for any other branch. */
export function rootFromRecoveryBranch(branch) {
  if (typeof branch !== 'string' || !branch.startsWith(RECOVERY_BRANCH_PREFIX)) return null
  const root = branch.slice(RECOVERY_BRANCH_PREFIX.length)
  if (!ROOT_PATTERN.test(root)) throw new Error(`recovery lineage: recovery branch ${branch} encodes an invalid root`)
  return root
}

export function formatTrailers({ root, attempt, sourceRun }) {
  if (!ROOT_PATTERN.test(root)) throw new Error('recovery lineage: invalid root')
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 99) throw new Error('recovery lineage: invalid attempt')
  if (!RUN_ID_PATTERN.test(String(sourceRun))) throw new Error('recovery lineage: invalid source run')
  return `${TRAILER_ROOT}: ${root}\n${TRAILER_ATTEMPT}: ${attempt}\n${TRAILER_SOURCE_RUN}: ${sourceRun}`
}

/**
 * Parses recovery trailers from the final paragraph of a commit message.
 * Returns null when the message carries no recovery trailer at all; throws on any partial,
 * duplicated, or malformed set so callers fail closed.
 */
export function parseTrailers(message) {
  const text = String(message ?? '').replace(/\r\n/g, '\n').trimEnd()
  const lines = text.split('\n')
  const mentions = lines.filter((line) => TRAILER_KEYS.some((key) => line.startsWith(`${key}:`)))
  if (mentions.length === 0) return null

  const paragraphStart = text.lastIndexOf('\n\n') + 1
  const block = text.slice(paragraphStart).split('\n').filter(Boolean)
  const found = {}
  for (const line of block) {
    const match = line.match(/^([A-Za-z0-9-]+): (.*)$/)
    if (!match || !TRAILER_KEYS.includes(match[1])) continue
    if (match[1] in found) throw new Error(`recovery lineage: duplicate ${match[1]} trailer`)
    found[match[1]] = match[2]
  }
  if (Object.keys(found).length !== TRAILER_KEYS.length || mentions.length !== TRAILER_KEYS.length) {
    throw new Error('recovery lineage: incomplete or misplaced recovery trailers')
  }
  if (!ROOT_PATTERN.test(found[TRAILER_ROOT])) throw new Error('recovery lineage: malformed root trailer')
  if (!ATTEMPT_PATTERN.test(found[TRAILER_ATTEMPT])) throw new Error('recovery lineage: malformed attempt trailer')
  if (!RUN_ID_PATTERN.test(found[TRAILER_SOURCE_RUN])) throw new Error('recovery lineage: malformed source-run trailer')
  return { root: found[TRAILER_ROOT], attempt: Number(found[TRAILER_ATTEMPT]), sourceRun: found[TRAILER_SOURCE_RUN] }
}
