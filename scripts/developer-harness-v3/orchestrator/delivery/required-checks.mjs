// Developer Harness V3 (D3.6-E) — which checks a candidate needs, and whether the EXACT candidate has them.
//
// The expected checks come from TRUSTED configuration: the workflow files of the TRUSTED BASE (never the candidate's tree, never a check name a run happens to report), cross-checked
// against the pinned expectation below. A divergence (a CI Gate need added or removed, a renamed job, a new conditional job such as a Supabase Preview) is a CONTROL-PLANE change:
// delivery fails closed until the pin is reviewed — the candidate cannot change what it is judged by.
//
// Aggregation accepts a result only when it is: on the exact head SHA, from the github-actions app (15368), produced by a run of the expected workflow with the expected event and head
// branch, and the LATEST attempt for that head. skipped / neutral / cancelled / missing are never success (the CI Gate itself already requires every need to be exactly `success`,
// except the Dependabot-only Room-Board skip, which can never apply to a V3 branch). A result for an earlier head is never accepted for a replacement head.
export const ACTIONS_APP_ID = 15368
export const WORKFLOWS = Object.freeze({ ci: '.github/workflows/ci.yml', mobile: '.github/workflows/mobile-ci.yml', staging: '.github/workflows/staging-candidate.yml' })

/** The pinned expectation (audited at main 41995dcb, doc 31 §2-3). */
export const TRUSTED_CHECKS = Object.freeze({
  app_id: ACTIONS_APP_ID,
  ci_gate: Object.freeze({ name: 'CI Gate', job: 'ci-gate', workflow: WORKFLOWS.ci, needs: Object.freeze(['lint-api', 'lint-web', 'build-web', 'test-web-public-smoke', 'test-api', 'database-migration-gate', 'security',
    'test-unit-web', 'feature-flag-registry-gate', 'frozen-guard', 'contrast', 'i18n-parity', 'room-board-regression', 'room-board-hermetic', 'release-workflow-contract', 'supabase-cli-apply-contract',
    'actions-runtime-contract-produce', 'actions-runtime-contract-consume']) }),
  // Mobile CI is ADVISORY in the ruleset; V3 delivery requires it anyway (a stricter V3 rule never relaxes a gate)
  mobile: Object.freeze(['Mobile CI Workflow Contract', 'Mobile / Type-check', 'Mobile / Lint', 'Mobile / Jest']),
  staging_gate: Object.freeze({ name: 'Staging Gate', workflow: WORKFLOWS.staging }),
  supabase_preview: null, // no Supabase Preview job exists at the audited base; if one appears in the trusted workflows, derivation fails closed until its semantics are pinned
})
export const requiredCiChecks = () => [{ name: TRUSTED_CHECKS.ci_gate.name, workflow: WORKFLOWS.ci }, ...TRUSTED_CHECKS.mobile.map((name) => ({ name, workflow: WORKFLOWS.mobile }))]

/** Deterministic text derivation from the trusted base's workflow files. @returns {{ok:boolean, problems:string[], derived?:object}} */
export function deriveRequiredChecks({ ci, mobile, staging }) {
  const p = []
  if (typeof ci !== 'string' || typeof mobile !== 'string' || typeof staging !== 'string') return { ok: false, problems: ['CHECKS.WORKFLOW_TEXT_MISSING'] }
  const gate = /^ {2}ci-gate:\n {4}name: CI Gate\n(?: {4}.*\n)*? {4}needs:\n((?: {6}- [a-z0-9-]+\n)+)/m.exec(ci)
  if (!gate) p.push('CHECKS.CI_GATE_NOT_FOUND')
  const needs = gate ? [...gate[1].matchAll(/- ([a-z0-9-]+)/g)].map((m) => m[1]) : []
  if ((ci.match(/^ {4}name: CI Gate$/gm) ?? []).length !== 1) p.push('CHECKS.CI_GATE_NOT_UNIQUE')
  if (!/^ {4}if: \$\{\{ always\(\) \}\}$/m.test(ci.slice(gate?.index ?? 0, (gate?.index ?? 0) + 400))) p.push('CHECKS.CI_GATE_NOT_ALWAYS')
  if (/supabase[- ]preview/i.test(ci)) p.push('CHECKS.SUPABASE_PREVIEW_UNPINNED')
  const mobileJobs = [...mobile.matchAll(/^ {4}name: (Mobile [^\n]+)$/gm)].map((m) => m[1])
  if (!/name: 'Staging Gate'/.test(staging)) p.push('CHECKS.STAGING_GATE_NOT_FOUND')
  const derived = { ci_gate_needs: needs, mobile: mobileJobs }
  if (JSON.stringify(needs) !== JSON.stringify(TRUSTED_CHECKS.ci_gate.needs)) p.push('CHECKS.CI_GATE_NEEDS_CHANGED')
  if (JSON.stringify(mobileJobs) !== JSON.stringify(TRUSTED_CHECKS.mobile)) p.push('CHECKS.MOBILE_JOBS_CHANGED')
  return { ok: p.length === 0, problems: p, derived }
}

const runLatestFirst = (a, b) => ((b.created_at ?? 0) - (a.created_at ?? 0)) || (b.id - a.id)
const byAttemptDesc = (a, b) => (b.attempt - a.attempt) || (b.id - a.id)
/**
 * The state of ONE required check for the exact head. `view` = a verified reader view (runs, checks). `expect` = { name, workflow, head_sha, head_branch?, events, pr_number? }.
 *
 * D3.6 remediation F1 — the LATEST APPLICABLE RUN decides, independently of which checks it has reported so far:
 *   1. applicable runs = the expected workflow, an expected event, the exact head SHA, the expected branch (and PR, when one is expected); the newest of them (created_at, then id) is THE run;
 *   2. the verdict is that run's check at the run's LATEST attempt (from the pinned app, exactly one). A newer run / attempt that has not reported yet is `pending` (running) or, once
 *      completed, cancelled / skipped / failed / missing — it is NEVER replaced by an older run's or an older attempt's success;
 *   3. the one supported exception is a PARTIAL re-run ("re-run failed jobs": jobs that already succeeded are not re-executed and keep their earlier-attempt result): an earlier-attempt
 *      SUCCESS of this check from the pinned app is carried over only when the run's latest attempt has COMPLETED with conclusion success, and the highest earlier attempt that reported
 *      the check succeeded (a later attempt that reported it, with any other result, shadows it). A running or failed latest attempt carries nothing over.
 * @returns {{name:string, state:'success'|'pending'|'failed'|'cancelled'|'skipped'|'missing'|'ambiguous', run_id?:number, attempt?:number, run_attempt?:number, check_id?:number, carried_over?:boolean, spoofed:number}}
 */
export function checkState(view, { name, workflow, head_sha, head_branch = null, events = ['pull_request'], pr_number = null }) {
  const named = view.checks.filter((c) => c.name === name && c.head_sha === head_sha)
  const spoofed = named.filter((c) => c.app_id !== ACTIONS_APP_ID).length
  const applicable = view.runs.filter((r) => r.workflow === workflow && events.includes(r.event) && r.head_sha === head_sha && (head_branch === null || r.head_branch === head_branch) && (pr_number === null || r.pr_number === pr_number))
  if (!applicable.length) return { name, state: 'missing', spoofed }
  applicable.sort(runLatestFirst)
  const run = applicable[0]
  const base = { name, run_id: run.id, attempt: run.attempt, run_attempt: run.attempt, spoofed }
  const mine = named.filter((c) => c.app_id === ACTIONS_APP_ID && c.run_id === run.id)
  const now = mine.filter((c) => c.attempt === run.attempt)
  if (now.length > 1) return { ...base, state: 'ambiguous' } // two trusted results for ONE attempt: fail closed
  let check = now[0] ?? null; let carried = false
  if (!check && run.status === 'completed' && run.conclusion === 'success') {
    const earlier = mine.filter((c) => c.attempt < run.attempt).sort(byAttemptDesc); const top = earlier[0]
    if (top && earlier.filter((c) => c.attempt === top.attempt).length > 1) return { ...base, state: 'ambiguous' }
    if (top && top.status === 'completed' && top.conclusion === 'success') { check = top; carried = true }
  }
  if (!check) { // the latest run has reported nothing for this check (for this attempt): its own state decides, never an older run's
    if (run.status !== 'completed') return { ...base, state: 'pending' }
    if (run.conclusion === 'cancelled') return { ...base, state: 'cancelled' }
    if (run.conclusion === 'skipped' || run.conclusion === 'neutral') return { ...base, state: 'skipped' }
    return { ...base, state: run.conclusion === 'success' ? 'missing' : 'failed' }
  }
  const out = { ...base, attempt: check.attempt, check_id: check.id, details_url: check.details_url ?? null, ...(carried ? { carried_over: true } : {}) }
  if (check.status !== 'completed') return { ...out, state: 'pending' }
  const c = check.conclusion
  if (c === 'success') return { ...out, state: 'success' }
  if (c === 'cancelled') return { ...out, state: 'cancelled' }
  if (c === 'skipped' || c === 'neutral') return { ...out, state: 'skipped' }
  return { ...out, state: 'failed' }
}

/** The run behind a Staging Gate verdict must itself have completed successfully, belong to THIS PR and report a result that points at it. */
const detailsPointAt = (url, runId) => typeof url === 'string' && (url === `sim://runs/${runId}` || new RegExp(`/actions/runs/${runId}(?:/|$)`).test(url))
/**
 * D3.6 remediation F1 — the Staging Gate verdict for the exact head AND PR: ONE function for the delivery observation, the staging-gate issuance and the final delivery verification
 * (before, the issuance re-checked PR association and provenance and the verification did not). Same latest-run rule as checkState, restricted to staging runs of this PR.
 * @returns {ReturnType<typeof checkState> & {problem?:string}}
 */
export function stagingGate(view, { head_sha, pr_number }) {
  const g = checkState(view, { name: TRUSTED_CHECKS.staging_gate.name, workflow: WORKFLOWS.staging, head_sha, events: ['workflow_run', 'workflow_dispatch'], pr_number: Number.isSafeInteger(pr_number) ? pr_number : NaN })
  if (g.run_id === undefined) return g
  const run = view.runs.find((y) => y.id === g.run_id)
  if (!run) return { ...g, state: 'missing', problem: 'STAGING.RUN_UNKNOWN' }
  if (g.state === 'success') {
    if (run.status !== 'completed') return { ...g, state: 'pending' }
    if (run.conclusion !== 'success') return { ...g, state: run.conclusion === 'cancelled' ? 'cancelled' : run.conclusion === 'skipped' ? 'skipped' : 'failed' }
    if (run.pr_number !== pr_number || !detailsPointAt(g.details_url, run.id)) return { ...g, state: 'missing', problem: 'STAGING.PROVENANCE_MISMATCH' }
  }
  return g
}

/** All required CI checks for the exact head. overall: success only when EVERY one is success. */
export function ciState(view, { head_sha, head_branch }) {
  const checks = requiredCiChecks().map((x) => checkState(view, { ...x, head_sha, head_branch }))
  const by = (s) => checks.filter((c) => c.state === s)
  const overall = checks.every((c) => c.state === 'success') ? 'success'
    : by('failed').length || by('skipped').length || by('ambiguous').length ? 'failed'
      : by('cancelled').length ? 'cancelled'
        : by('pending').length ? 'pending' : 'missing'
  return { overall, checks, spoofed: checks.reduce((n, c) => n + c.spoofed, 0) }
}
