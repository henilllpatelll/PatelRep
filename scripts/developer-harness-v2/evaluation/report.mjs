// Developer Harness V2 — Phase 7 local report builder/writer. Reports are LOCAL and NON-AUTHORITATIVE: they authorize nothing.
//
// Written only under the git-ignored .wolf/runtime-logs/developer-harness-v2/evaluation/, after verifying (a) git ignores the
// target and (b) no path component is a symlink/junction or escapes the repository. Writes are atomic (temp + rename, never overwrite).
import { execFileSync } from 'node:child_process'
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isGitIgnored } from '../coordination/checkpoint.mjs'
import { REGISTRY_VERSION, registryDigest } from './scenarios.mjs'
import { digestOf, redactDeep, sha256 } from './schema.mjs'

export const REPORT_SCHEMA = 'developer-harness-v2/evaluation-report@1'
export const REPORT_REL = Object.freeze(['.wolf', 'runtime-logs', 'developer-harness-v2', 'evaluation'])
const gitEnv = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0' })
const HERE = path.dirname(fileURLToPath(import.meta.url))
const git = (root, ...a) => execFileSync('git', ['-C', root, '-c', 'core.fsmonitor=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(), timeout: 30000 }).trim()

/** sha256 over the evaluation sources that produced the report, so a report cannot describe code other than what ran. */
export const evaluationCodeDigest = () => sha256(readdirSync(HERE).filter((n) => n.endsWith('.mjs')).sort().map((n) => `${n}\n${readFileSync(path.join(HERE, n), 'utf8')}`).join('\n\0'))

export function harnessIdentity(root) {
  const common = { registry_version: REGISTRY_VERSION, benchmark_config_digest: registryDigest(), evaluation_code_digest: evaluationCodeDigest() }
  // Untracked files COUNT: a clean tracked tree with untracked harness code is not clean provenance.
  try { return { commit_sha: git(root, 'rev-parse', 'HEAD'), worktree_clean: git(root, 'status', '--porcelain', '--', 'scripts/developer-harness-v2', 'docs/developer-harness-v2', '.claude/agents') === '', ...common } } catch { return { commit_sha: null, worktree_clean: null, ...common } }
}

export function buildReport({ harness, scores, summary, reliability, fp, comparison, usage, tasks, now = new Date().toISOString(), scoringConfig = { rule: 'adversarial passes only with exact classification and zero executions; missing observation never passes' } }) {
  const missing = []
  if (!usage?.ok) missing.push({ what: 'Actual model tokens and cost', status: 'NOT MEASURED', why: reliability.model_usage.note })
  if (!tasks?.ok) missing.push({ what: 'Real-task completion, regressions, failed checks before green, human interventions, time to readiness', status: 'NOT MEASURED', why: 'No sanitized task records supplied.' })
  missing.push({ what: 'Independent-review findings by severity per real task', status: 'NOT MEASURED', why: 'No per-task review records supplied.' })
  missing.push({ what: 'CI, staging and approval-wait durations', status: 'NOT MEASURED', why: 'No GitHub timestamps supplied; Phase 7 makes no remote calls.' })
  missing.push({ what: 'Genuine historical developer-harness failure cases for test selection', status: 'NOT MEASURED', why: reliability.test_selection.developer_category_gap })
  return {
    schema: REPORT_SCHEMA, generated_at: now, non_authoritative: true, authorizes_nothing: true, harness,
    config: { scoring: scoringConfig, config_digest: digestOf({ registry: harness.benchmark_config_digest, scoring: scoringConfig, code: harness.evaluation_code_digest ?? null }) },
    benchmark: { summary, scenarios: scores }, reliability, false_positive_analysis: { summary: fp.summary, rate: fp.rate, mismatches: fp.mismatches, limitations: fp.limitations },
    model_usage_and_cost: reliability.model_usage, baseline_vs_v2: comparison,
    evidence_coverage: { scenarios_executed: `${summary.executed}/${summary.total}`, populations: ['synthetic_fixture', 'reported_prior', ...(tasks?.ok ? ['real_task'] : [])], real_task_evidence_present: Boolean(tasks?.ok), usage_evidence_present: Boolean(usage?.ok) },
    missing_measurements: missing,
    known_limitations: [
      'Passing the fixture benchmark shows harness components behave as specified on fixtures; it does not show reliability in production.',
      'Development scenarios are harness-component checks or simulations, never complete real-agent tasks; real completion is NOT MEASURED.',
      'Expected outcomes were authored by the same project that wrote the engine (independent of engine output, not of the authors).',
      'The Phase 6 recall figures are in-sample and are restated, not re-measured.',
      ...summary.coverage_gaps.map((g) => `${g.scenario_id} ${g.code}: ${g.note}`),
    ],
    recommended_next_validation: [
      'Supply sanitized per-task records (start/ready timestamps, check failures, interventions, regressions) for real PRs.',
      'Supply provider usage or billing records attributable per task to measure tokens and cost.',
      'Collect a genuine developer-harness failure case when one occurs, to close EVALUATION_GAP:developer.',
      'Add a test-weakening detector and a docs-only scope check to verifyDiffAgainstPlan (separately approved Phase 4 work).',
    ],
  }
}

const cell = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200)
export function renderMarkdown(r) {
  const s = r.benchmark.summary
  const L = []
  L.push('# Developer Harness V2 — Phase 7 local evaluation report', '', '> Local and non-authoritative. Authorizes nothing. Contains no secrets.', '')
  L.push(`- Harness commit: \`${r.harness.commit_sha}\` (harness paths clean incl. untracked: ${r.harness.worktree_clean}); evaluation code digest \`${r.harness.evaluation_code_digest ?? 'n/a'}\``, `- Benchmark config digest: \`${r.config.config_digest}\``, `- Generated: ${r.generated_at}`, '')
  L.push('## Benchmark result', '', `**${s.headline}**`, '')
  L.push(`Total ${s.total} · executed ${s.executed} · passed ${s.passed} · failed ${s.failed} · blocked ${s.blocked} · not executed ${s.not_executed}`, '')
  L.push(`Development (${s.development.total}): component checks passed ${s.development.component_passed}; real task completion **${s.development.real_task_completion}**.`)
  L.push(`Adversarial (${s.adversarial.total}): passed ${s.adversarial.passed}; attempts blocked and classified correctly ${s.adversarial.attempts_blocked_and_classified_correctly}/${s.adversarial.attempts}; forbidden actions executed **${s.adversarial.forbidden_actions_executed}**.`, '')
  if (s.failed_ids.length) L.push(`**FAILED:** ${s.failed_ids.join(', ')}`, '')
  L.push('| ID | Category | Level | Outcome | Notes |', '|---|---|---|---|---|')
  for (const x of r.benchmark.scenarios) L.push(`| ${x.scenario_id} | ${cell(x.category)} | ${x.evaluation_level} | ${x.outcome} | ${cell(x.reasons.join('; '))} |`)
  L.push('', '## Safety and reliability', '', '| Item | Population | Numerator | Denominator |', '|---|---|---|---|')
  for (const i of r.reliability.safety_reliability.items) L.push(`| ${cell(i.name)} | ${i.population} | ${cell(i.numerator ?? i.observed)} | ${cell(i.denominator)} |`)
  L.push('', `Task reliability: ${r.reliability.task_reliability.note}`, '', '### Test selection (Phase 6, restated — not re-measured)', '')
  const t = r.reliability.test_selection
  L.push(`- In-sample historical recall: ${t.historical_failing_jobs_represented.numerator}/${t.historical_failing_jobs_represented.denominator} (${t.historical_failing_jobs_represented.kind})`, `- Locally runnable failure recall: ${t.locally_runnable_failures_recalled.numerator}/${t.locally_runnable_failures_recalled.denominator}`, `- CI-only failing jobs: ${t.ci_only_failing_jobs} (${t.ci_only_recalled_solely_by_unconditional_selection} recalled only by unconditional passthrough)`, `- Developer-harness historical cases: ${t.developer_harness_historical_failure_cases}. ${t.developer_category_gap}`, `- ${t.ci_note}`, '')
  L.push('## False positives', '', `Legitimate cases ${r.false_positive_analysis.summary.legitimate_cases}; incorrectly blocked ${r.false_positive_analysis.summary.false_positive_blocks}; approval-required classified correctly ${r.false_positive_analysis.summary.approval_required_classified_correctly}/${r.false_positive_analysis.summary.approval_required_cases}; incorrect allows ${r.false_positive_analysis.summary.incorrect_allows}.`, '')
  L.push('## Model usage and cost', '', r.model_usage_and_cost.note, '')
  L.push('## Baseline vs V2', '', `Baseline \`${r.baseline_vs_v2.baseline.commit}\`. **${r.baseline_vs_v2.verdict}**`, '', '| Metric | Baseline | V2 | Comparable | Difference |', '|---|---|---|---|---|')
  for (const c of r.baseline_vs_v2.rows) L.push(`| ${cell(c.label)} | ${c.baseline.status} | ${c.v2.status}${c.v2.value !== null ? ` (${cell(c.v2.value)}, ${c.v2.population})` : ''} | ${c.comparable ? 'yes' : 'no'} | ${c.difference ?? '—'} |`)
  L.push('', '## Missing measurements', '', ...r.missing_measurements.map((m) => `- **${m.status}** ${m.what} — ${cell(m.why)}`), '', '## Known limitations', '', ...r.known_limitations.map((x) => `- ${x}`), '', '## Recommended next validation', '', ...r.recommended_next_validation.map((x) => `- ${x}`), '')
  return L.join('\n')
}

/** Verify the report directory is safe, creating missing components. Throws a coded Error on any violation. */
function safeDir(root) {
  const realRoot = realpathSync(root)
  let cur = realRoot
  for (const seg of REPORT_REL) {
    cur = path.join(cur, seg)
    let st = null
    try { st = lstatSync(cur) } catch { /* missing */ }
    if (!st) mkdirSync(cur, { mode: 0o700 })
    else if (st.isSymbolicLink()) throw new Error('REPORT.SYMLINK_COMPONENT')
    else if (!st.isDirectory()) throw new Error('REPORT.COMPONENT_NOT_DIRECTORY')
    const rel = path.relative(realRoot, realpathSync(cur))
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('REPORT.ESCAPES_REPOSITORY')
  }
  if (!isGitIgnored(root, `${REPORT_REL.join('/')}/probe.json`)) throw new Error('REPORT.NOT_GIT_IGNORED')
  return cur
}

export function writeReport(root, report, { stamp = null } = {}) {
  const dir = safeDir(root)
  const { value: clean, redactions } = redactDeep({ ...report, redactions_applied: 0 })
  clean.redactions_applied = redactions
  const base = `evaluation-${(stamp ?? report.generated_at).replace(/[^0-9A-Za-z]/g, '').slice(0, 20)}-${String(report.harness.commit_sha ?? 'unknown').slice(0, 8)}`
  const out = {}
  for (const [ext, text] of [['json', `${JSON.stringify(clean, null, 2)}\n`], ['md', redactDeep(renderMarkdown(clean)).value]]) {
    const file = path.join(dir, `${base}.${ext}`)
    const tmp = `${file}.tmp-${process.pid}`
    const fd = openSync(tmp, 'wx', 0o600)
    try { writeSync(fd, text) } finally { closeSync(fd) }
    try { lstatSync(file); unlinkSync(tmp); throw new Error('REPORT.TARGET_EXISTS') } catch (e) { if (e.message === 'REPORT.TARGET_EXISTS') throw e }
    renameSync(tmp, file)
    out[ext] = file
  }
  return { ...out, redactions }
}
