// Phase 2C: deterministic, trusted-from-main auto-merge policy for dedicated PatelRep recovery PRs.
// Shared by the unprivileged resolver and the privileged merge script, so BOTH independently derive
// eligibility from fresh GitHub state. PR text, labels-as-authority and resolver outputs never authorize a
// merge: only publisher-written commit trailers, exact green gates and the risk classifier do.
import {
  MAX_AUTOMATIC_REPAIR_ATTEMPTS,
  PUBLISHER_EMAIL,
  RECOVERY_BRANCH_PREFIX,
  RUN_ID_PATTERN,
  parseTrailers,
} from './recovery-lineage.mjs'

export const TRUSTED_BOT = Object.freeze({ login: 'patelrep-release-engineer[bot]', id: 337493489, type: 'Bot' })
export const GATE_APP = Object.freeze({ slug: 'github-actions', id: 15368 })
export const PUBLISHER_APP_SLUG = 'patelrep-release-engineer'
export const RECOVERY_BRANCH_RULESET_PATTERN = 'refs/heads/claude/recovery-*'
export const HUMAN_HOLD_LABELS = Object.freeze(['do-not-merge', 'do not merge', 'hold', 'manual-review', 'needs-human'])

const SHA = /^[0-9a-f]{40}$/
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/
const PR_NUMBER = /^[1-9][0-9]{0,9}$/
const STAGING_KEYS = ['candidate_branch', 'candidate_sha', 'ci_run_id', 'pr_number']

/** A clean policy refusal: the PR simply is not auto-merge eligible (not an error, no retry loop). */
export class Ineligible extends Error {}

function refuse(message) {
  throw new Ineligible(message)
}

function fail(message) {
  throw new Error(`auto-merge: ${message}`)
}

// ---- changed-file risk classifier -------------------------------------------------------------------

const tokensOf = (file) =>
  file
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const startsWithAny = (tokens, prefixes) => tokens.some((token) => prefixes.some((prefix) => token.startsWith(prefix)))
const hasAny = (tokens, words) => tokens.some((token) => words.includes(token))
const DEPENDENCY_FILES = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|pipfile(\.lock)?)$/

/** Ordered rules; the first match names the risk. Deliberately conservative: false positives only mean a human merges. */
const RISK_RULES = [
  ['github-automation', (p) => p === '.github' || p.startsWith('.github/')],
  ['database', (p, t) =>
    p.startsWith('supabase/') || p.includes('/migrations/') || p.endsWith('.sql') ||
    p.startsWith('apps/api/core/') || p.startsWith('apps/web/lib/supabase/') ||
    hasAny(t, ['db', 'database', 'migration', 'migrations', 'schema', 'schemas', 'drift', 'replay', 'rls', 'supabase', 'postgres', 'postgresql']) ||
    startsWithAny(t, ['reconcil'])],
  ['billing', (_p, t) =>
    hasAny(t, ['billing', 'stripe', 'payment', 'payments', 'subscription', 'subscriptions', 'checkout', 'invoice', 'invoices', 'webhook', 'webhooks', 'credit', 'credits', 'pricing'])],
  ['auth-security', (p, t) =>
    p === 'apps/web/proxy.ts' || p === 'apps/web/middleware.ts' || p.startsWith('apps/api/middleware/') ||
    startsWithAny(t, ['auth', 'oauth', 'secur', 'permission', 'credential', 'secret']) ||
    hasAny(t, ['rbac', 'jwt', 'token', 'tokens', 'session', 'sessions', 'password', 'cookie', 'cookies', 'sso', 'saml', 'mfa'])],
  ['production-release', (p, t) =>
    p.startsWith('scripts/') ||
    hasAny(t, ['production', 'prod', 'release', 'releases', 'rollback', 'deploy', 'deployment', 'deployments', 'guard', 'staging'])],
  ['infrastructure', (p, t) =>
    p.startsWith('.claude/') || p.startsWith('.husky/') || p === 'claude.md' || DEPENDENCY_FILES.test(p) ||
    p.startsWith('apps/api/routers/internal') ||
    hasAny(t, ['railway', 'vercel', 'docker', 'dockerfile', 'compose', 'terraform', 'infra', 'infrastructure', 'env', 'cron', 'scheduler'])],
]

/** @returns {{risk: string}|null} null means the file is low risk. */
export function classifyChangedFile(file) {
  const normalized = String(file).replace(/\\/g, '/').replace(/^\.\//, '')
  const lower = normalized.toLowerCase()
  const tokens = tokensOf(normalized)
  for (const [risk, matches] of RISK_RULES) {
    if (matches(lower, tokens)) return { risk }
  }
  return null
}

/** @returns {{path: string, risk: string}|null} the first high-risk path, or null when every file is low risk. */
export function findHighRiskChange(files) {
  for (const file of files) {
    for (const candidate of [file.filename, file.previous_filename]) {
      if (!candidate) continue
      const result = classifyChangedFile(candidate)
      if (result) return { path: candidate, risk: result.risk }
    }
  }
  return null
}

// ---- candidate validation ----------------------------------------------------------------------------

/** Dedicated numeric-root recovery branch; `manual-*` roots can never auto-merge. */
export function dedicatedRecoveryRoot(branch) {
  if (typeof branch !== 'string' || !branch.startsWith(RECOVERY_BRANCH_PREFIX)) refuse(`branch ${branch} is not a dedicated recovery branch`)
  const root = branch.slice(RECOVERY_BRANCH_PREFIX.length)
  if (root.startsWith('manual-')) refuse('manual recovery roots are never auto-merged')
  if (!RUN_ID_PATTERN.test(root)) refuse(`recovery branch ${branch} does not encode a numeric root`)
  return root
}

const UNPROTECTED = 'dedicated recovery branches are not protected for publisher-only creation and updates'

/**
 * Provenance anchor: recovery commits are unsigned and emails/trailers are forgeable, so auto-merge is only
 * allowed while an ACTIVE branch ruleset makes claude/recovery-* writable by the PatelRep App alone. Fails
 * closed (Ineligible, never a Claude repair trigger) on any missing, disabled, partial or malformed state.
 */
export async function requirePublisherOnlyRecoveryBranches(deps) {
  let app
  let rulesets
  try {
    app = await deps.getApp(PUBLISHER_APP_SLUG)
    rulesets = await deps.listBranchRulesets()
  } catch (error) {
    refuse(`${UNPROTECTED} (could not read the GitHub App or rulesets: ${String(error.message).split('\n')[0].slice(0, 120)})`)
  }
  if (!app || app.slug !== PUBLISHER_APP_SLUG || !Number.isSafeInteger(app.id) || app.id <= 0) {
    refuse(`${UNPROTECTED} (GitHub App ${PUBLISHER_APP_SLUG} could not be resolved)`)
  }
  if (!Array.isArray(rulesets)) refuse(`${UNPROTECTED} (malformed ruleset response)`)

  const protects = (ruleset) => {
    if (!ruleset || typeof ruleset !== 'object') return false
    if (ruleset.target !== 'branch' || ruleset.enforcement !== 'active') return false
    const ref = ruleset.conditions?.ref_name
    if (!Array.isArray(ref?.include) || !ref.include.includes(RECOVERY_BRANCH_RULESET_PATTERN)) return false
    if (Array.isArray(ref.exclude) ? ref.exclude.length > 0 : ref.exclude != null) return false
    if (!Array.isArray(ruleset.rules)) return false
    const types = ruleset.rules.map((rule) => rule?.type)
    if (!types.includes('creation') || !types.includes('update')) return false
    const bypass = ruleset.bypass_actors
    if (!Array.isArray(bypass) || bypass.length !== 1) return false
    const [actor] = bypass
    return actor?.actor_type === 'Integration' && actor.actor_id === app.id && actor.bypass_mode === 'always'
  }
  if (!rulesets.some(protects)) refuse(UNPROTECTED)
}

function requireTrustedCreator(pr) {
  const user = pr.user
  if (!user || user.login !== TRUSTED_BOT.login || user.type !== TRUSTED_BOT.type || user.id !== TRUSTED_BOT.id) {
    refuse(`PR #${pr.number} was not created by ${TRUSTED_BOT.login}`)
  }
}

function requireOpenCandidate(pr, repo, sha, branch) {
  if (pr.state !== 'open') refuse(`PR #${pr.number} is not open`)
  if (pr.draft) refuse(`PR #${pr.number} is a draft`)
  if (pr.base?.ref !== 'main') refuse(`PR #${pr.number} does not target main`)
  if (pr.head?.repo?.full_name !== repo) refuse(`PR #${pr.number} is not from this repository`)
  if (pr.head.ref !== branch) refuse(`PR #${pr.number} head branch changed to ${pr.head.ref}`)
  if (pr.head.sha !== sha) refuse(`PR #${pr.number} head moved to ${pr.head.sha}`)
}

function requirePublisherHistory(commits, root, pr) {
  if (commits.length < 1 || commits.length > MAX_AUTOMATIC_REPAIR_ATTEMPTS) {
    refuse(`recovery PR has ${commits.length} commits; expected 1-${MAX_AUTOMATIC_REPAIR_ATTEMPTS} publisher commits`)
  }
  if (pr.commits !== commits.length) refuse('PR commit count disagrees with the listed commits')
  let last
  commits.forEach((commit, index) => {
    let trailers
    try {
      trailers = parseTrailers(commit.message)
    } catch (error) {
      refuse(`commit ${commit.sha.slice(0, 7)} has invalid recovery trailers: ${error.message}`)
    }
    if (!trailers) refuse(`commit ${commit.sha.slice(0, 7)} has no recovery trailers (unrelated commit in recovery PR)`)
    if (trailers.root !== root) refuse(`commit ${commit.sha.slice(0, 7)} root ${trailers.root} differs from branch root ${root}`)
    if (trailers.attempt !== index + 1) refuse(`commit ${commit.sha.slice(0, 7)} attempt ${trailers.attempt} breaks the sequence at position ${index + 1}`)
    if (trailers.attempt > MAX_AUTOMATIC_REPAIR_ATTEMPTS) refuse('attempt exceeds the automatic limit')
    if (trailers.attempt === 1 && trailers.sourceRun !== root) refuse('attempt 1 source run must be the root run')
    if (commit.authorEmail !== PUBLISHER_EMAIL || commit.committerEmail !== PUBLISHER_EMAIL) {
      refuse(`commit ${commit.sha.slice(0, 7)} was not authored and committed as the trusted publisher`)
    }
    for (const [login, type] of [[commit.authorLogin, commit.authorType], [commit.committerLogin, commit.committerType]]) {
      // GitHub only resolves an account when it can; when it does, it must be the trusted bot.
      if (login != null && (login !== TRUSTED_BOT.login || type !== TRUSTED_BOT.type)) {
        refuse(`commit ${commit.sha.slice(0, 7)} resolves to GitHub account ${login}, not the trusted publisher`)
      }
    }
    last = { commit, trailers }
  })
  if (last.commit.sha !== pr.head.sha) refuse('last recovery commit is not the PR head')
  return last.trailers
}

function requireGate(checkRuns, name, label) {
  // Only checks produced by GitHub Actions itself count; similarly named checks from other Apps are ignored.
  const own = checkRuns
    .filter((check) => check.name === name && check.app?.slug === GATE_APP.slug && check.app?.id === GATE_APP.id)
    .sort((a, b) => b.id - a.id)
  if (own.length === 0) refuse(`no ${label} check from GitHub Actions on the candidate commit`)
  const [latest] = own
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    refuse(`${label} is ${latest.status}/${latest.conclusion ?? 'none'}, not success`)
  }
  return latest
}

function requireSuccessfulRun(run, { name, repo, runId }) {
  if (!run || String(run.id) !== String(runId)) fail(`run ${runId} could not be fetched`)
  if (run.name !== name) refuse(`run ${runId} is ${run.name}, not ${name}`)
  if (run.status !== 'completed' || run.conclusion !== 'success') refuse(`${name} run ${runId} is ${run.status}/${run.conclusion}, not success`)
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) refuse(`${name} run ${runId} is not from this repository`)
}

/**
 * Re-derives everything from the exact successful Staging Candidate run and fresh GitHub state.
 * Throws Ineligible for any policy refusal and a plain Error for malformed/unprovable data (fail closed).
 * @param {{repo: string, stagingRunId: string, expected?: {prNumber: string, sha: string, branch: string, ciRunId: string}}} input
 * @param {object} deps getApp(slug), listBranchRulesets() (full ruleset objects), getRun, readStagingContext, getPr, listPrCommits, listPrFiles, listCheckRuns, listReviews,
 *   countUnresolvedThreads
 */
export async function validateAutoMergeCandidate({ repo, stagingRunId, expected }, deps) {
  if (!RUN_ID_PATTERN.test(String(stagingRunId))) fail('staging run id is invalid')

  const stagingRun = await deps.getRun(stagingRunId)
  requireSuccessfulRun(stagingRun, { name: 'Staging Candidate', repo, runId: stagingRunId })

  // Never trust the staging workflow_run head data (it reports main); the sanitized artifact is the identity.
  const context = await deps.readStagingContext(stagingRunId)
  if (!context || typeof context !== 'object' || Array.isArray(context) ||
      JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(STAGING_KEYS)) {
    fail('staging-candidate-context has unexpected fields')
  }
  if (!SHA.test(context.candidate_sha ?? '')) fail('candidate SHA is not a 40-character SHA')
  if (!PR_NUMBER.test(context.pr_number ?? '')) fail('candidate PR number is invalid')
  if (!BRANCH.test(context.candidate_branch ?? '')) fail('candidate branch is invalid')
  if (!RUN_ID_PATTERN.test(context.ci_run_id ?? '')) fail('candidate CI run id is invalid')
  const { candidate_sha: sha, candidate_branch: branch, ci_run_id: ciRunId, pr_number: prNumber } = context

  if (expected) {
    const same = expected.sha === sha && expected.branch === branch && expected.ciRunId === ciRunId && expected.prNumber === prNumber
    if (!same) fail('freshly derived candidate does not match the resolver expectation')
  }

  const pr = await deps.getPr(Number(prNumber))
  if (pr.number !== Number(prNumber)) fail('fetched PR does not match the candidate PR number')
  // Cheap identity refusals first: ordinary feature/Dependabot/human PRs end here.
  requireTrustedCreator(pr)
  const root = dedicatedRecoveryRoot(pr.head?.ref)
  requireOpenCandidate(pr, repo, sha, branch)
  await requirePublisherOnlyRecoveryBranches(deps)
  const labels = (pr.labels ?? []).map((label) => String(label.name ?? '').trim().toLowerCase())
  const hold = labels.find((label) => HUMAN_HOLD_LABELS.includes(label))
  if (hold) refuse(`PR #${pr.number} carries the human-gate label "${hold}"`)

  const trailers = requirePublisherHistory(await deps.listPrCommits(pr.number), root, pr)

  const files = await deps.listPrFiles(pr.number)
  if (files.length === 0) refuse('PR changes no files')
  if (pr.changed_files !== files.length) refuse('PR changed-file count disagrees with the listed files')
  const high = findHighRiskChange(files)
  if (high) refuse(`human review required because changed file ${high.path} is classified as ${high.risk}`)

  const reviews = await deps.listReviews(pr.number)
  const states = new Map()
  for (const review of reviews) {
    if (review.user?.login && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) states.set(review.user.login, review.state)
  }
  const blocking = [...states].filter(([, state]) => state === 'CHANGES_REQUESTED').map(([login]) => login)
  if (blocking.length > 0) refuse(`changes requested by ${blocking.join(', ')}`)
  if ((await deps.countUnresolvedThreads(pr.number)) !== 0) refuse('unresolved review threads remain')

  const ciRun = await deps.getRun(ciRunId)
  requireSuccessfulRun(ciRun, { name: 'CI', repo, runId: ciRunId })
  if (ciRun.head_sha !== sha) refuse(`CI run ${ciRunId} validated ${ciRun.head_sha}, not the candidate`)
  if (ciRun.head_branch !== branch) refuse(`CI run ${ciRunId} ran for branch ${ciRun.head_branch}, not ${branch}`)
  if (ciRun.event !== 'pull_request') refuse(`CI run ${ciRunId} was a ${ciRun.event} run, not a pull_request run`)

  requireGate(await deps.listCheckRuns(sha, 'CI Gate'), 'CI Gate', 'CI Gate')
  const stagingGate = requireGate(await deps.listCheckRuns(sha, 'Staging Gate'), 'Staging Gate', 'Staging Gate')
  if (stagingGate.details_url !== `https://github.com/${repo}/actions/runs/${stagingRunId}`) {
    refuse('Staging Gate was not reported by this exact Staging Candidate run')
  }

  if (pr.mergeable !== true || pr.mergeable_state !== 'clean') {
    refuse(`PR #${pr.number} is not cleanly mergeable under the strict ruleset (${pr.mergeable_state})`)
  }

  return { prNumber: pr.number, sha, branch, root, attempt: trailers.attempt, ciRunId, stagingRunId: String(stagingRunId) }
}

/** Unprivileged form: policy refusals become {eligible:false}; malformed data still throws. */
export async function evaluateAutoMerge(input, deps) {
  try {
    return { eligible: true, ...(await validateAutoMergeCandidate(input, deps)) }
  } catch (error) {
    if (error instanceof Ineligible) return { eligible: false, reason: `Auto-merge ineligible: ${error.message}.` }
    throw error
  }
}
