// Developer Harness V2 — Phase 7 reliability and safety report builder. Pure: derives everything from supplied evidence.
//
// Three populations are NEVER merged: real_task (human-supplied sanitized records), synthetic_fixture (this benchmark),
// reported_prior (earlier phases' own published findings, cited, not re-measured here).
import { SCENARIOS } from './scenarios.mjs'
import { STATUS, aggregate, makeMetric, notMeasured, ratio } from './schema.mjs'

const DOC11 = 'docs/developer-harness-v2/11-phase-6-smart-testing-and-regression.md'
/** Phase 6's published findings, restated with their distinctions intact. A test pins every figure to doc 11. */
export const PHASE6_REPORTED = Object.freeze({
  source: DOC11, label: 'REPORTED PRIOR FINDING (not an independent measurement in Phase 7)',
  historical_failing_jobs_represented: { numerator: 128, denominator: 128, kind: 'in-sample historical recall (rules were built using this corpus; not a hold-out estimate)' },
  locally_runnable_failures_recalled: { numerator: 66, denominator: 69, kind: 'locally runnable failure recall' },
  ci_only_failing_jobs: 48, ci_only_recalled_solely_by_unconditional_selection: 19, unconditional_suites_per_nonempty_diff: 6,
  expensive_or_blocked_suite_entries: 131, unknown_coverage_entries: 9,
  developer_harness_historical_failure_cases: 0,
  developer_category_gap: 'No genuine historical developer-harness failure case exists; acceptance.met is false with EVALUATION_GAP:developer.',
  ci_note: 'Per the Phase 7 instructions (not independently re-verified here): PR #247\'s first Phase 6 CI attempt failed on a live authentication-hook environmental error; a later exact-head rerun and the Staging Gate passed. This is an environmental failure and must not be attributed to the Phase 6 implementation.',
})

const find = (scores, id) => scores.find((s) => s.scenario_id === id)
const chk = (scores, sid, cid) => find(scores, sid)?.observed.checks.find((c) => c.id === cid)
const item = (name, numerator, denominator, extra = {}) => ({ name, population: 'synthetic_fixture', source: 'fixture_benchmark', ...ratio(numerator, denominator), ...extra })

export function buildReliability({ scores, summary, fp, usage = null, tasks = null, benchmarkMs = null, now = new Date().toISOString() }) {
  const adv = scores.filter((s) => s.kind === 'adversarial' && s.outcome !== 'not_executed' && s.outcome !== 'blocked')
  const attempted = adv.reduce((n, s) => n + (s.policy_violations_attempted ?? 0), 0)
  const caught = adv.reduce((n, s) => n + (s.policy_violations_blocked ?? 0), 0)
  const executed = adv.reduce((n, s) => n + (s.forbidden_actions_executed ?? 0), 0)

  const taskMetrics = tasks?.ok ? tasks.metrics : []
  const names = ['task_completion', 'regressions', 'failed_checks_before_green', 'human_interventions', 'time_to_ready']
  const task_reliability = {
    population: 'real_task',
    metrics: names.map((n) => ({ name: n, ...aggregate(taskMetrics.filter((m) => m.name === n)), per_task: taskMetrics.filter((m) => m.name === n && m.status === STATUS.MEASURED).map((m) => ({ task_id: m.task_id, value: m.value, source_id: m.source_id })) })),
    note: taskMetrics.length ? 'Derived only from the supplied sanitized task records; tasks without a field count as missing, never zero.' : 'No real task records were supplied. Completion rate, failed-check frequency, retries, stale-evidence invalidations and intervention frequency are NOT MEASURED.',
    rejected_records: tasks?.rejected?.length ?? 0,
  }

  const recov = scores.find((s) => s.scenario_id === 'B-11')
  const safety_reliability = {
    population: 'synthetic_fixture',
    note: 'Counts come from simulated tool calls classified by the real policy implementation. They show the controls behave as specified on fixtures, not how often real agents attempt forbidden actions.',
    items: [
      item('forbidden_or_gated_attempts_blocked_and_classified_correctly', caught, attempted, { attempted, executed_forbidden_actions: executed }),
      item('incorrectly_allowed_attempts', executed, attempted),
      item('legitimate_actions_incorrectly_blocked', fp.summary.false_positive_blocks, fp.summary.legitimate_cases),
      item('approval_required_classified_correctly', fp.summary.approval_required_classified_correctly, fp.summary.approval_required_cases),
      item('denied_cases_wrongly_allowed', fp.summary.denied_wrongly_allowed, fp.summary.denied_cases),
      { name: 'approval_replay_rejection', population: 'synthetic_fixture', source: 'fixture_benchmark', observed: chk(scores, 'B-12', 'stale_approval_rejected')?.ok ?? null, status: chk(scores, 'B-12', 'stale_approval_rejected') ? STATUS.MEASURED : STATUS.NOT_MEASURED },
      { name: 'protected_file_scope_enforcement', population: 'synthetic_fixture', source: 'fixture_benchmark', observed: { existing_migration_edit_forbidden: chk(scores, 'B-06', 'existing_migration_edit_forbidden')?.ok ?? null, control_plane_edit_needs_human: ['passed', 'failed'].includes(find(scores, 'A-08')?.outcome) ? find(scores, 'A-08').outcome === 'passed' : null } },
    ],
  }
  const requiredRecovery = SCENARIOS.find((s) => s.id === 'B-11').required_checks
  const recoveryComplete = recov && ['passed', 'failed'].includes(recov.outcome) && !recov.reasons.some((x) => /^(EXECUTOR\.EXCEPTION|MISSING_OBSERVATION)/.test(x))
  const recovery = recoveryComplete ? makeMetric({ name: 'recovery_correct', value: requiredRecovery.filter((id) => recov.observed.checks.some((c) => c.id === id && c.ok)).length, unit: 'count', status: STATUS.MEASURED, source_type: 'fixture_benchmark', source_id: 'scenario:B-11', window: { at: now }, methodology: 'Recovery checks that held in the simulated interruption scenario on a disposable repository.', quality: 'complete', population: 'synthetic_fixture', denominator: requiredRecovery.length }) : notMeasured('recovery_correct', 'Interruption scenario did not run to completion (not run, blocked, exception or missing observation).', { population: 'synthetic_fixture' })

  const timing = {
    note: 'Only measured timestamps are reported. No GitHub timestamps were supplied, so task, CI, staging and approval-wait durations are NOT MEASURED.',
    intervals: [
      { name: 'benchmark_wall_clock_ms', population: 'synthetic_fixture', status: Number.isFinite(benchmarkMs) ? STATUS.MEASURED : STATUS.NOT_MEASURED, value: Number.isFinite(benchmarkMs) ? benchmarkMs : null },
      { name: 'recovery_scenario_ms', population: 'synthetic_fixture', status: Number.isFinite(recov?.wall_clock_ms) ? STATUS.MEASURED : STATUS.NOT_MEASURED, value: recov?.wall_clock_ms ?? null },
      ...['task_duration', 'ci_duration', 'staging_duration', 'time_waiting_on_approvals', 'unknown_intervals'].map((n) => ({ name: n, population: 'real_task', status: STATUS.NOT_MEASURED, value: null })),
    ],
  }

  const model_usage = usage?.ok ? {
    status: 'IMPORTED', accepted_records: usage.accepted.length, rejected_records: usage.rejected.length, rejected: usage.rejected,
    unattributed: usage.unattributed, per_task_metrics: usage.metrics, derived_estimates_separate: usage.estimates,
    note: 'Cost is MEASURED only where billed cost was supplied for every record of a task; shared or unattributable usage is never distributed across tasks.',
  } : {
    status: STATUS.NOT_MEASURED, accepted_records: 0, rejected_records: usage?.rejected?.length ?? 0, file_errors: usage?.file_errors ?? [],
    note: 'No trustworthy usage/billing evidence was supplied. Actual tokens and cost are NOT MEASURED. `.wolf/token-ledger.json` is a character-ratio estimate and was deliberately NOT used.',
  }

  return { task_reliability, safety_reliability, recovery_metric: recovery, test_selection: { ...PHASE6_REPORTED }, timing, model_usage, scenario_summary: summary }
}
