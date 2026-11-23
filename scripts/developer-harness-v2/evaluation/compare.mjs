// Developer Harness V2 — Phase 7 baseline-versus-V2 comparison. Pure.
//
// A difference is produced ONLY when both sides are MEASURED, in the same unit, from the same real-task population.
// Anything else is an evidence gap, listed with what future observation would close it. Nothing is interpolated.
import { METRICS, STATUS, aggregate } from './schema.mjs'

export const BASELINE = Object.freeze({ commit: '218a882b15ed8f928f9a8b7d82b6ea8bb1ed0d37', date: '2026-11-21', doc: 'docs/developer-harness-v2/05-evaluation-baseline.md' })
const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s))
const LOWER_IS_BETTER = new Set(['regressions', 'failed_checks_before_green', 'human_interventions', 'time_to_ready', 'false_positive_blocks', 'model_cost', 'model_tokens'])

/** Doc 05 §1, transcribed: every ten-metric row is NOT MEASURED at the baseline. */
const ROWS = [
  { id: 'task_correctness', label: 'Task correctness (first-review completion)', metric: 'task_completion', baseline: 'No structured task records exist.', need: 'Per-task human-recorded first-review acceptance for baseline-style and V2 tasks of comparable scope.' },
  { id: 'security_policy_adherence', label: 'Security-policy adherence (violations attempted vs blocked)', metric: 'policy_violations_attempted', baseline: 'No local policy engine existed (Phase 2).', need: 'Real agent-session tool-call logs from a baseline-equivalent setup; none can be reconstructed retroactively.' },
  { id: 'false_positive_blocks', label: 'False-positive safety blocks', metric: 'false_positive_blocks', baseline: 'No local policy engine existed.', need: 'Observed legitimate developer actions blocked in real sessions (V2) vs an equivalent baseline.' },
  { id: 'regressions', label: 'Regressions caused by a task', metric: 'regressions', baseline: 'Not tracked per task; buglog does not attribute cause to agent tasks.', need: 'Per-task regression attribution recorded going forward.' },
  { id: 'recovery_reliability', label: 'Recovery reliability after interruption', metric: 'recovery_correct', baseline: 'No checkpoint system existed (Phase 5).', need: 'Real interruptions of real tasks with recorded resume outcomes.' },
  { id: 'review_coverage', label: 'Independent-review coverage', metric: 'review_findings', baseline: 'No independent reviewer role existed.', need: 'Per-task review records (reviewer, head SHA, findings by severity).' },
  { id: 'ci_performance', label: 'CI performance (failed checks before green)', metric: 'failed_checks_before_green', baseline: 'Derivable from GitHub check-run history; not collected at the baseline.', need: 'Check-run history per task head, supplied as sanitized task records.' },
  { id: 'token_use_and_cost', label: 'Token use and cost', metric: 'model_cost', baseline: '`.wolf/token-ledger.json` holds character-ratio estimates only; it is not billed usage.', need: 'Provider usage reports or billing records attributable to individual tasks, for both periods.' },
  { id: 'human_intervention', label: 'Human interventions', metric: 'human_interventions', baseline: 'Cerebrum Do-Not-Repeat entries are qualitative only.', need: 'Per-task intervention counts recorded going forward.' },
  { id: 'time_to_readiness', label: 'Time to verified PR readiness', metric: 'time_to_ready', baseline: 'Derivable later from PR creation and gate timestamps; not collected.', need: 'Task start and ready_for_human_review timestamps per task.' },
]

function v2Side(row, ctx) {
  const { tasks, usage, reliability, fp } = ctx
  const fromTasks = (name) => {
    const a = aggregate((tasks?.ok ? tasks.metrics : []).filter((m) => m.name === name))
    return a.measured_n > 0 ? { status: a.missing_n === 0 ? STATUS.MEASURED : STATUS.ESTIMATE, value: a.measured_sum, population: 'real_task', n: a.measured_n, unit: METRICS[name], missing: a.missing_n, source: 'sanitized task records' } : null
  }
  const synth = (value, source, detail) => ({ status: STATUS.MEASURED, value, population: 'synthetic_fixture', source, detail })
  switch (row.id) {
    case 'task_correctness': return fromTasks('task_completion') ?? { status: STATUS.NOT_MEASURED, value: null, population: 'real_task', detail: 'No real task records. Fixture component checks are not task completion.' }
    case 'regressions': return fromTasks('regressions') ?? { status: STATUS.NOT_MEASURED, value: null, population: 'real_task', detail: 'No real task records.' }
    case 'ci_performance': return fromTasks('failed_checks_before_green') ?? { status: STATUS.NOT_MEASURED, value: null, population: 'real_task', detail: 'No check-run history supplied.' }
    case 'human_intervention': return fromTasks('human_interventions') ?? { status: STATUS.NOT_MEASURED, value: null, population: 'real_task', detail: 'No real task records.' }
    case 'time_to_readiness': return fromTasks('time_to_ready') ?? { status: STATUS.NOT_MEASURED, value: null, population: 'real_task', detail: 'No task timestamps supplied.' }
    case 'token_use_and_cost': {
      const costs = (usage?.ok ? usage.metrics : []).filter((m) => m.name === 'model_cost')
      const a = aggregate(costs)
      return a.measured_n > 0 ? { status: a.missing_n === 0 ? STATUS.MEASURED : STATUS.ESTIMATE, value: a.measured_sum, population: 'real_task', n: a.measured_n, unit: METRICS.model_cost, missing: a.missing_n, source: 'imported billing evidence', detail: a.missing_n ? `${a.missing_n} task(s) have no billed cost (NOT MEASURED, not $0)` : null } : { status: STATUS.NOT_MEASURED, value: null, population: 'real_task', detail: 'No billed cost supplied.' }
    }
    case 'security_policy_adherence': return synth(`${reliability.safety_reliability.items[0].numerator}/${reliability.safety_reliability.items[0].denominator}`, 'fixture benchmark', 'Simulated attempts blocked and classified as expected; synthetic population.')
    case 'false_positive_blocks': return synth(`${fp.summary.false_positive_blocks}/${fp.summary.legitimate_cases}`, 'fixture corpus', 'Legitimate fixture actions incorrectly blocked; synthetic population.')
    case 'recovery_reliability': { const m = reliability.recovery_metric; return m.status === STATUS.MEASURED ? synth(`${m.value}/${m.denominator}`, 'scenario B-11', 'Simulated interruption on a disposable repository.') : { status: STATUS.NOT_MEASURED, value: null, population: 'synthetic_fixture', detail: m.reason } }
    default: return { status: STATUS.NOT_MEASURED, value: null, population: 'real_task', detail: 'No per-task review records supplied.' }
  }
}

/** `baselineEvidence` (keyed by row id) lets a human supply a genuinely measured baseline per row id later; it must be MEASURED, real_task and sourced, with `value` = the TOTAL over `n` tasks (not a mean), plus `unit` and `window`. */
export function compare(ctx, baselineEvidence = {}) {
  const rows = ROWS.map((r) => {
    const o = baselineEvidence[r.id]
    const valid = o && o.status === STATUS.MEASURED && typeof o.value === 'number' && Number.isFinite(o.value) && o.population === 'real_task' && typeof o.source === 'string' && o.source.trim() && Number.isInteger(o.n) && o.n > 0 && o.unit === METRICS[r.metric] && isIso(o.window?.start) && isIso(o.window?.end)
    const baseline = valid ? { status: STATUS.MEASURED, value: o.value, n: o.n, unit: o.unit, window: o.window, population: 'real_task', source: o.source, reason: null } : { status: STATUS.NOT_MEASURED, value: null, population: 'real_task', reason: r.baseline, source: BASELINE.doc }
    const v2 = v2Side(r, ctx)
    const bothMeasured = baseline.status === STATUS.MEASURED && v2.status === STATUS.MEASURED
    const samePop = baseline.population === 'real_task' && v2.population === 'real_task'
    const comparable = bothMeasured && samePop && typeof baseline.value === 'number' && typeof v2.value === 'number' && Number.isInteger(v2.n) && v2.n > 0 && baseline.unit === v2.unit
    let why
    if (comparable) why = 'Both sides MEASURED from real tasks in the same unit; compared as per-task rates (value / n).'
    else if (baseline.status !== STATUS.MEASURED) why = 'Baseline is NOT MEASURED: no improvement is claimed.'
    else if (v2.status !== STATUS.MEASURED) why = 'V2 side is not fully MEASURED.'
    else why = 'Populations differ (synthetic fixture vs real/historical): not comparable.'
    // Totals over different numbers of tasks are not comparable: compare PER-TASK rates only.
    const difference = comparable ? v2.value / v2.n - baseline.value / baseline.n : null
    return { id: r.id, label: r.label, metric: r.metric, baseline, v2, comparable, comparability: why, difference, direction: comparable ? (difference === 0 ? 'no change' : (LOWER_IS_BETTER.has(r.metric) === (difference < 0) ? 'improved' : 'worse')) : null, limitations: comparable ? [] : ['Insufficient comparable evidence.'], future_observations_needed: comparable ? [] : [r.need] }
  })
  return { baseline: BASELINE, rows, comparable_rows: rows.filter((r) => r.comparable).length, verdict: rows.some((r) => r.comparable) ? 'PARTIAL' : 'NO COMPARABLE EVIDENCE: baseline and V2 effectiveness cannot yet be quantified; see gaps per row.', improvement_claims: rows.filter((r) => r.direction === 'improved').map((r) => r.id) }
}
