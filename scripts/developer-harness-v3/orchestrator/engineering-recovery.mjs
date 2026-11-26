// Developer Harness V3 (D3.5-G) — bounded AUTONOMOUS engineering recovery on top of the D3.4 budgets (suspension.mjs), which are kept exactly: per-task session ceiling (150 per
// generation — an absolute ceiling, never a target), remediation cycles, review rounds and stage failures per epoch, cool-downs, strategy escalation, terminal suspension.
// Nothing here raises a budget or resets one automatically. What D3.5 adds:
//   * a deterministic FAILURE TAXONOMY, so a condition is handled by its kind: resource pressure and network/provider outages WAIT (no remediation budget); authentication,
//     billing, isolation and unresolvable requirement conflicts are owner-only (fail closed); environment failures retry technically (budgeted); implementation defects and
//     review findings remediate (budgeted);
//   * FINGERPRINT NORMALIZATION: volatile tokens (hashes, uuids, line/col numbers, temp paths) are stripped, so a failure cannot evade its per-fingerprint budget by changing shape;
//   * REPEATED-FIX detection: a candidate whose patch is byte-identical to one that already FAILED is refused (with a strategy escalation) instead of being re-tested;
//   * TEST-WEAKENING detection on the controller-derived diff: deleted test files, fewer assertions/tests, added skips — a pass obtained by weakening the tests is refused;
//   * per-task subscription and remediation ACCOUNTING (`taskAccounting`), read from the ledger.
import { classifyBlocker, epochOf, recordsInEpoch, reviewRoundsInEpoch, sessionsUsed, TECH_DEFAULTS } from './suspension.mjs'

export const FAILURE_CLASSES = Object.freeze(['resource_pressure', 'subscription_exhausted', 'network', 'implementation_defect', 'review_findings', 'environment', 'auth_billing', 'isolation', 'requirement_conflict'])
const RULES = [
  ['auth_billing', /^(AUTH\.|SUBSCRIPTION\.STATE(_UNKNOWN$|:)|SESSION\.PERMISSION_MODE_MISMATCH|OWNER_AUTH)/],
  ['isolation', /^ISOLATION/],
  ['requirement_conflict', /^(UNRESOLVABLE_REQUIREMENT_CONFLICT|TASK\.REQUIREMENTS_TAMPERED)/],
  ['subscription_exhausted', /^(PROVIDER\.LIMIT|SUBSCRIPTION\.(NOT_YET_ELIGIBLE|SHARED_HEADROOM_RESERVED|LIMIT))/],
  // ANCHORED (review CR-10): only a code that STARTS with the token is a free wait; session-derived text that merely mentions one cannot steer a failure into the wait class
  ['resource_pressure', /^(RESOURCE\.|ENOMEM\b|OUT_OF_MEMORY\b|OOM_KILLED\b)/],
  ['network', /^(NETWORK\.|PROVIDER\.(HTTP_5\d\d|OVERLOADED|UNAVAILABLE)\b|ECONNRESET\b|ECONNREFUSED\b|ETIMEDOUT\b|ENOTFOUND\b|EAI_AGAIN\b)/],
  ['review_findings', /^(REVIEW_FINDINGS_OPEN|REVIEW\.FINDINGS|independent_review:|security_review:)/],
  ['implementation_defect', /^(TEST_FAILED|test:|CANDIDATE\.|IMPLEMENTATION\.|PLAN\.|candidate:|incomplete:|plan:)/],
]
/** Deterministic class of a failure code. Unknown codes are `environment` (a budgeted technical retry) — never an owner question, never free. */
export function classifyFailure(code) {
  const c = String(code ?? '')
  for (const [k, re] of RULES) if (re.test(c)) return k
  return classifyBlocker(c) === 'owner' ? 'auth_billing' : 'environment'
}
export const OWNER_ONLY_CLASSES = Object.freeze(['auth_billing', 'isolation', 'requirement_conflict'])

/** Strip volatile tokens so the same failure keeps the same fingerprint (and so the same budget). Code-shaped heads are preserved. */
export function normalizeFingerprint(fp) {
  return String(fp ?? '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').replace(/\b[0-9a-f]{8,}\b/gi, '<hex>').replace(/:(\d+)(:\d+)?\b/g, ':<n>')
    .replace(/[A-Za-z]:[\\/][^\s|:]*|\/tmp\/[^\s|:]*/g, '<path>').replace(/\b\d{4,}\b/g, '<n>').slice(0, 120)
}

/** Has this exact patch already FAILED (tests or an independent/security review) for this task? */
export function repeatedFailedPatch(L, taskId, patchDigest) {
  return L.db.prepare(`SELECT c.candidate_sha FROM candidates c WHERE c.task_id=? AND c.patch_digest=? AND (
      EXISTS (SELECT 1 FROM test_runs r WHERE r.task_id=c.task_id AND r.candidate_sha=c.candidate_sha AND r.passed=0) OR
      EXISTS (SELECT 1 FROM reviews v WHERE v.task_id=c.task_id AND v.candidate_sha=c.candidate_sha AND v.status='verified_fail')) LIMIT 1`).get(taskId, patchDigest)?.candidate_sha ?? null
}

const TEST_PATH = /(^|\/)(__tests__|tests?|e2e|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/i
const ASSERT = /\b(assert(\.\w+)?|expect)\s*\(/g
const CASES = /\b(it|test)\s*\(/g
const SKIPS = /\.(skip|only|todo)\s*\(|\b(xit|xdescribe|xtest)\s*\(|@pytest\.mark\.skip|\{\s*skip\s*:\s*(true|['"])|\btodo\s*:\s*true/g
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1').replace(/^\s*#.*$/gm, '') // a commented-out test or assertion is not a test (review CR-12)
const count = (s, re) => (typeof s === 'string' ? (stripComments(s).match(re) ?? []).length : 0)
/**
 * Test-weakening on the CONTROLLER-derived diff (never the model's description). `changes` = [{status, path}]; `contents` (optional) = [{path, before, after}] for changed test files.
 * @returns {{path:string, code:string}[]}
 */
export function detectTestWeakening(changes, contents = null) {
  const out = []
  for (const c of changes ?? []) if (c.status === 'D' && TEST_PATH.test(c.path)) out.push({ path: c.path, code: 'TEST_WEAKENING.FILE_DELETED' })
  for (const f of contents ?? []) {
    if (!TEST_PATH.test(f.path ?? '')) continue
    if (count(f.after, ASSERT) < count(f.before, ASSERT)) out.push({ path: f.path, code: 'TEST_WEAKENING.ASSERTIONS_REDUCED' })
    if (count(f.after, CASES) < count(f.before, CASES)) out.push({ path: f.path, code: 'TEST_WEAKENING.CASES_REMOVED' })
    if (count(f.after, SKIPS) > count(f.before, SKIPS)) out.push({ path: f.path, code: 'TEST_WEAKENING.SKIP_ADDED' })
  }
  return out
}

/** Per-task subscription and remediation accounting, from the ledger only. The session ceiling is a CEILING: nothing schedules work to use it up. */
export function taskAccounting(e, taskId) {
  const L = e.ledger; const c = { ...TECH_DEFAULTS, ...(e.cfg?.technical ?? {}) }
  const rows = L.db.prepare('SELECT role, model_actual, turns FROM executions WHERE task_id=?').all(taskId)
  const by = (k) => rows.reduce((m, r) => { const key = r[k] ?? 'unknown'; m[key] = (m[key] ?? 0) + 1; return m }, {})
  return { task_id: taskId, generation: Number(L.meta(`suspension_gen:${taskId}`) ?? 0), epoch: epochOf(L, taskId), sessions_this_generation: sessionsUsed(L, taskId), sessions_total: rows.length, session_ceiling: c.maxSessionsPerTask,
    turns_total: rows.reduce((n, r) => n + (r.turns ?? 0), 0), sessions_by_role: by('role'), sessions_by_actual_model: by('model_actual'),
    remediation_cycles_this_epoch: recordsInEpoch(L, taskId, 'remediation_entered'), stage_failures_this_epoch: recordsInEpoch(L, taskId, 'stage_failure'),
    review_rounds_this_epoch: { independent_review: reviewRoundsInEpoch(L, taskId, 'independent_review'), security_review: reviewRoundsInEpoch(L, taskId, 'security_review') },
    limits: { remediation_cycles_per_epoch: c.maxRemediationCyclesPerEpoch, stage_failures_per_epoch: c.maxStageFailuresPerEpoch, review_rounds_per_epoch: c.maxReviewRoundsPerEpoch, epochs: c.maxEpochs } }
}
