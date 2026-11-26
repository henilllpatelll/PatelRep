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

const latestFirst = (a, b) => (b.run.created_at - a.run.created_at) || (b.run.id - a.run.id) || (b.check.attempt - a.check.attempt) || (b.check.id - a.check.id)
/**
 * The state of ONE required check for the exact head. `view` = a verified reader view (runs, checks). `expect` = { name, workflow, head_sha, head_branch?, events }.
 * @returns {{name:string, state:'success'|'pending'|'failed'|'cancelled'|'skipped'|'missing'|'ambiguous', run_id?:number, attempt?:number, check_id?:number, spoofed:number}}
 */
export function checkState(view, { name, workflow, head_sha, head_branch = null, events = ['pull_request'] }) {
  const runs = new Map(view.runs.map((r) => [r.id, r]))
  const named = view.checks.filter((c) => c.name === name && c.head_sha === head_sha)
  const spoofed = named.filter((c) => c.app_id !== ACTIONS_APP_ID).length
  const trusted = named.filter((c) => c.app_id === ACTIONS_APP_ID).map((check) => ({ check, run: runs.get(check.run_id) }))
    .filter(({ check, run }) => run && run.workflow === workflow && events.includes(run.event) && run.head_sha === head_sha && (head_branch === null || run.head_branch === head_branch) && check.attempt === run.attempt)
  if (!trusted.length) return { name, state: 'missing', spoofed }
  trusted.sort(latestFirst)
  const top = trusted[0]
  if (trusted.length > 1 && trusted[1].run.id === top.run.id && trusted[1].check.attempt === top.check.attempt) return { name, state: 'ambiguous', spoofed } // two trusted results for ONE attempt: fail closed
  const base = { name, run_id: top.run.id, attempt: top.check.attempt, check_id: top.check.id, spoofed, details_url: top.check.details_url ?? null }
  if (top.check.status !== 'completed') return { ...base, state: 'pending' }
  const c = top.check.conclusion
  if (c === 'success') return { ...base, state: 'success' }
  if (c === 'cancelled') return { ...base, state: 'cancelled' }
  if (c === 'skipped' || c === 'neutral') return { ...base, state: 'skipped' }
  return { ...base, state: 'failed' }
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
