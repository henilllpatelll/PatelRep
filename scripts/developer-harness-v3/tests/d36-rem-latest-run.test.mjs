// D3.6 remediation F1 — the LATEST applicable workflow run decides, independently of which checks it has reported yet. SIMULATED views only (no network, no GitHub).
// Before the fix, checkState chose among EXISTING matching checks, so an older run's success survived a newer same-SHA run that was queued, running or attempt-bumped without a result.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTIONS_APP_ID, WORKFLOWS, checkState, ciState, requiredCiChecks, stagingGate } from '../orchestrator/delivery/required-checks.mjs'

const H = 'a'.repeat(40); const BR = 'dh3/t'
// a re-run (attempt > 1) always carries its start time (the reader supplies it); the malformed-field tests below set it explicitly
const run = (id, o = {}) => { const r = { id, workflow: WORKFLOWS.ci, event: 'pull_request', head_sha: H, head_branch: BR, pr_number: 7, attempt: 1, status: 'completed', conclusion: 'success', created_at: id * 10, ...o }; if (r.attempt > 1 && !Object.hasOwn(o, 'started_at')) r.started_at = r.created_at + 5; return r }
const chk = (id, runId, o = {}) => ({ id, name: 'CI Gate', head_sha: H, app_id: ACTIONS_APP_ID, run_id: runId, attempt: 1, status: 'completed', conclusion: 'success', ...o })
const state = (runs, checks, o = {}) => checkState({ runs, checks }, { name: 'CI Gate', workflow: WORKFLOWS.ci, head_sha: H, head_branch: BR, ...o })

test('F1 reproduction: an OLDER run passed; a NEWER run of the same workflow and SHA is queued / running with NO reported check -> pending, never the older success', () => {
  const older = run(1); const check = chk(10, 1)
  assert.equal(state([older], [check]).state, 'success', 'control: the older run alone is success')
  for (const status of ['queued', 'pending', 'in_progress', 'waiting']) {
    const s = state([older, run(2, { status, conclusion: null })], [check]); assert.equal(s.state, 'pending', `newer run ${status} without a check`); assert.equal(s.run_id, 2, 'the verdict names the NEWER run')
  }
})

test('F1: a newer run with a pending check, a newer ATTEMPT without a result, a newer failed / cancelled / skipped run — none falls back to an older success', () => {
  const older = run(1); const old = chk(10, 1)
  assert.equal(state([older, run(2, { status: 'in_progress', conclusion: null })], [old, chk(11, 2, { status: 'in_progress', conclusion: null })]).state, 'pending')
  // same run, attempt bumped by a re-run: the new attempt has produced nothing yet
  assert.equal(state([run(1, { attempt: 2, status: 'in_progress', conclusion: null })], [chk(10, 1, { attempt: 1 })]).state, 'pending', 'newer attempt without a result')
  assert.equal(state([run(1, { attempt: 2, status: 'queued', conclusion: null })], [chk(10, 1, { attempt: 1 })]).state, 'pending')
  assert.equal(state([older, run(2, { conclusion: 'failure' })], [old, chk(11, 2, { conclusion: 'failure' })]).state, 'failed')
  assert.equal(state([older, run(2, { conclusion: 'failure' })], [old]).state, 'failed', 'a completed failed run that reported NO check is still a failure')
  assert.equal(state([older, run(2, { conclusion: 'cancelled' })], [old]).state, 'cancelled', 'a cancelled newer run that never reported a check')
  assert.equal(state([older, run(2, { conclusion: 'skipped' })], [old]).state, 'skipped')
  assert.equal(state([older, run(2)], [old]).state, 'missing', 'a newer run that COMPLETED successfully but never reported the required check is missing, never the older result')
  assert.equal(state([older, run(2)], [old, chk(11, 2)]).state, 'success', 'the newer run\'s own success is success')
  assert.equal(state([older, run(2)], [old, chk(11, 2)]).run_id, 2)
})

test('F1: the identity checks are PRESERVED — wrong workflow, app, event, branch, head and duplicate results never count, and a newer run of another workflow/event/branch/head never masks', () => {
  const older = run(1); const c = chk(10, 1)
  assert.equal(state([older, run(2, { workflow: '.github/workflows/evil.yml', status: 'in_progress', conclusion: null })], [c]).state, 'success', 'a newer run of ANOTHER workflow is not applicable')
  assert.equal(state([older, run(2, { event: 'workflow_dispatch', status: 'in_progress', conclusion: null })], [c]).state, 'success', 'another event')
  assert.equal(state([older, run(2, { head_branch: 'other', status: 'in_progress', conclusion: null })], [c]).state, 'success', 'another branch')
  assert.equal(state([older, run(2, { head_sha: 'b'.repeat(40), status: 'in_progress', conclusion: null })], [c]).state, 'success', 'another head')
  assert.equal(state([older], [chk(10, 1, { app_id: 999 })]).state, 'missing', 'a spoofed app')
  assert.equal(state([older], [chk(10, 1, { app_id: 999 })]).spoofed, 1)
  assert.equal(state([older], [c, chk(11, 1, { conclusion: 'failure' })]).state, 'ambiguous', 'two trusted results for one attempt')
  assert.equal(state([older], [chk(10, 1, { head_sha: 'b'.repeat(40) })]).state, 'missing', 'a check for an earlier head')
  assert.equal(state([run(1, { attempt: 2, conclusion: 'failure' })], [chk(10, 1, { attempt: 1 })]).state, 'failed', 'a failed latest attempt does not borrow the success of an earlier attempt (valid partial-re-run carry-over is tested below)')
})

test('F1: genuinely supported PARTIAL re-run (re-run failed jobs): an earlier-attempt SUCCESS is carried over ONLY when the run\'s latest attempt completed successfully and no later attempt reported that check', () => {
  const lint = (id, o = {}) => ({ id, name: 'Mobile / Lint', head_sha: H, app_id: ACTIONS_APP_ID, run_id: 1, attempt: 1, status: 'completed', conclusion: 'success', ...o })
  const mob = (o = {}) => run(1, { workflow: WORKFLOWS.mobile, ...o })
  const s = (runs, checks) => checkState({ runs, checks }, { name: 'Mobile / Lint', workflow: WORKFLOWS.mobile, head_sha: H, head_branch: BR })
  assert.equal(s([mob({ attempt: 2 })], [lint(10), lint(11, { name: 'Mobile / Jest', attempt: 2 })]).state, 'success', 'attempt 2 completed successfully; Lint kept its attempt-1 success (partial re-run)')
  assert.equal(s([mob({ attempt: 2 })], [lint(10), lint(11, { name: 'Mobile / Jest', attempt: 2 })]).attempt, 1)
  assert.equal(s([mob({ attempt: 2 })], [lint(10), lint(11, { name: 'Mobile / Jest', attempt: 2 })]).run_attempt, 2, 'the verdict records the run attempt it was validated under')
  assert.equal(s([mob({ attempt: 2, status: 'in_progress', conclusion: null })], [lint(10)]).state, 'pending', 'attempt 2 still running: nothing carried over (a full re-run would replace it)')
  assert.equal(s([mob({ attempt: 2, conclusion: 'failure' })], [lint(10)]).state, 'failed', 'attempt 2 failed overall: the earlier success is not enough')
  assert.equal(s([mob({ attempt: 2 })], [lint(10), lint(12, { attempt: 2, conclusion: 'failure' })]).state, 'failed', 'a result for the check in the latest attempt always wins')
  assert.equal(s([mob({ attempt: 2 })], [lint(10, { conclusion: 'failure' })]).state, 'missing', 'only an earlier SUCCESS can be carried; an earlier failure is never success')
  assert.equal(s([mob({ attempt: 3 })], [lint(10), lint(11, { attempt: 2, conclusion: 'failure' })]).state, 'missing', 'a later attempt that reported the check shadows the carried success')
  assert.equal(s([mob({ attempt: 2 })], [lint(10, { app_id: 999 })]).state, 'missing', 'the carried result must itself be from the pinned app')
})

test('F1: the required-CI aggregate follows the same rule per check, and an outstanding newer run makes the whole thing pending', () => {
  const names = requiredCiChecks(); const runs = []; const checks = []; let id = 0; const runOf = {}
  for (const x of names) { if (!runOf[x.workflow]) { runOf[x.workflow] = run(++id, { workflow: x.workflow }); runs.push(runOf[x.workflow]) }; checks.push({ id: 100 + checks.length, name: x.name, head_sha: H, app_id: ACTIONS_APP_ID, run_id: runOf[x.workflow].id, attempt: 1, status: 'completed', conclusion: 'success' }) }
  assert.equal(ciState({ runs, checks }, { head_sha: H, head_branch: BR }).overall, 'success')
  const ci = runs.find((r) => r.workflow === WORKFLOWS.ci)
  const newer = [...runs, run(99, { workflow: WORKFLOWS.ci, status: 'in_progress', conclusion: null, created_at: ci.created_at + 5 })]
  const s = ciState({ runs: newer, checks }, { head_sha: H, head_branch: BR }); assert.equal(s.overall, 'pending'); assert.equal(s.checks.find((c) => c.name === 'CI Gate').run_id, 99)
})

// ---------------------------------------------------------------- staging: the same rule, plus PR association and provenance in ONE shared function
const srun = (id, o = {}) => { const r = { id, workflow: WORKFLOWS.staging, event: 'workflow_run', head_sha: H, pr_number: 7, attempt: 1, status: 'completed', conclusion: 'success', created_at: id * 10, ...o }; if (r.attempt > 1 && !Object.hasOwn(o, 'started_at')) r.started_at = r.created_at + 5; return r }
const sgate = (id, runId, o = {}) => ({ id, name: 'Staging Gate', head_sha: H, app_id: ACTIONS_APP_ID, run_id: runId, attempt: 1, status: 'completed', conclusion: 'success', details_url: `sim://runs/${runId}`, ...o })
const gate = (runs, checks, o = {}) => stagingGate({ runs, checks }, { head_sha: H, pr_number: 7, ...o })

test('F1 staging: the latest applicable staging run decides; a newer queued / running / failed / cancelled run is never masked by an older Staging Gate success', () => {
  const older = srun(1); const g = sgate(10, 1)
  assert.equal(gate([older], [g]).state, 'success', 'control')
  assert.equal(gate([older, srun(2, { status: 'pending', conclusion: null, event: 'workflow_dispatch' })], [g]).state, 'pending')
  assert.equal(gate([older, srun(2, { status: 'in_progress', conclusion: null })], [g]).state, 'pending')
  assert.equal(gate([srun(1, { attempt: 2, status: 'in_progress', conclusion: null })], [g]).state, 'pending', 'newer attempt without a result')
  assert.equal(gate([older, srun(2, { conclusion: 'failure' })], [g]).state, 'failed')
  assert.equal(gate([older, srun(2, { conclusion: 'cancelled' })], [g]).state, 'cancelled')
  assert.equal(gate([older, srun(2, { conclusion: 'success' })], [g]).state, 'missing', 'a newer staging run that completed without reporting the gate is missing')
})

test('F1 staging: PR association is validated — a Staging Gate whose run belongs to ANOTHER PR (or whose provenance does not match the run) is never accepted, in issuance and in the observation alike', () => {
  const g = sgate(10, 1)
  assert.equal(gate([srun(1, { pr_number: 8 })], [g]).state, 'missing', 'a run associated with another PR is not applicable for this PR')
  assert.equal(gate([srun(1, { pr_number: null })], [g]).state, 'missing', 'a run with no PR association is not applicable')
  const bad = gate([srun(1)], [sgate(10, 1, { details_url: 'sim://runs/999' })]); assert.equal(bad.state, 'missing'); assert.equal(bad.problem, 'STAGING.PROVENANCE_MISMATCH')
  assert.equal(gate([srun(1, { displaced: true, conclusion: 'cancelled' })], [g]).state, 'cancelled')
  assert.equal(gate([srun(1)], [g], { pr_number: undefined }).state, 'missing', 'no PR to bind to: never success')
  assert.equal(gate([srun(1, { event: 'push' })], [g]).state, 'missing', 'another event')
  const ok = gate([srun(1)], [g]); assert.equal(ok.state, 'success'); assert.equal(ok.run_id, 1); assert.equal(ok.attempt, 1)
})

// ---------------------------------------------------------------- independent-review findings (Opus M3, O6; Sonnet M1 is in d36-rem-stale-eligibility)
test('review M3: LATEST ACTIVITY decides — a re-run of an OLDER run is newer than a younger run that finished earlier; a run whose age cannot be ordered fails closed', () => {
  const youngerOk = run(2, { created_at: 20 }); const olderRerun = run(1, { created_at: 10, attempt: 2, started_at: 100, conclusion: 'failure' })
  const s = state([olderRerun, youngerOk], [chk(10, 1, { attempt: 2, conclusion: 'failure' }), chk(11, 2)]); assert.equal(s.state, 'failed'); assert.equal(s.run_id, 1, 'the re-run (newest activity) decides, not the younger run')
  assert.equal(state([run(1, { created_at: 10, attempt: 2, started_at: 100, status: 'in_progress', conclusion: null }), youngerOk], [chk(10, 1, { attempt: 1 }), chk(11, 2)]).state, 'pending')
  assert.equal(state([run(1, { created_at: 10 }), run(2, { created_at: undefined })], [chk(10, 1), chk(11, 2)]).state, 'ambiguous', 'a newer run with NO created_at is never ignored (it used to sort oldest)')
  assert.equal(state([run(1, { created_at: 10 }), run(2, { created_at: NaN })], [chk(10, 1), chk(11, 2)]).state, 'ambiguous')
  assert.equal(state([run(1, { created_at: 10, started_at: 5 }), run(2, { created_at: 20 })], [chk(10, 1), chk(11, 2)]).state, 'ambiguous', 'a run that started before it was created is unorderable (round 3: it used to be clamped, which hid a mixed-unit reader)')
})

test('review O6: CI runs are scoped to the task\'s PR — a same-branch same-SHA run for ANOTHER PR neither masks nor satisfies; an unusable PR number matches nothing', () => {
  const names = requiredCiChecks(); const runs = []; const checks = []; let id = 0; const runOf = {}
  for (const x of names) { if (!runOf[x.workflow]) { runOf[x.workflow] = run(++id, { workflow: x.workflow }); runs.push(runOf[x.workflow]) }; checks.push({ id: 100 + checks.length, name: x.name, head_sha: H, app_id: ACTIONS_APP_ID, run_id: runOf[x.workflow].id, attempt: 1, status: 'completed', conclusion: 'success' }) }
  assert.equal(ciState({ runs, checks }, { head_sha: H, head_branch: BR, pr_number: 7 }).overall, 'success')
  const foreign = [...runs, run(90, { workflow: WORKFLOWS.ci, pr_number: 999, status: 'in_progress', conclusion: null, created_at: 5000 })]
  assert.equal(ciState({ runs: foreign, checks }, { head_sha: H, head_branch: BR, pr_number: 7 }).overall, 'success', 'another PR\'s run is not applicable')
  assert.equal(ciState({ runs, checks }, { head_sha: H, head_branch: BR, pr_number: 8 }).overall, 'missing', 'results of another PR are never this PR\'s')
  for (const bad of [undefined, null, NaN, '7']) assert.equal(ciState({ runs, checks }, { head_sha: H, head_branch: BR, pr_number: bad }).overall, 'missing', `unusable ${String(bad)}`)
})

test('review (provenance URL): a Staging Gate whose details point at ANOTHER host is not provenance', () => {
  const g = (url) => stagingGate({ runs: [srun(1)], checks: [sgate(10, 1, { details_url: url })] }, { head_sha: H, pr_number: 7 }).state
  assert.equal(g('https://github.com/henilllpatelll/PatelRep/actions/runs/1'), 'success'); assert.equal(g('https://evil.example/actions/runs/1'), 'missing'); assert.equal(g('https://github.com.evil.example/o/r/actions/runs/1'), 'missing')
})

test('re-verification M-2: a MALFORMED ordering field (non-numeric / null / ISO started_at, a future timestamp, a missing or invalid attempt, a re-run without its start time) fails closed — it never revives a stale run\'s decision', () => {
  const young = run(2, { created_at: 20 }); const rerun = (o) => run(1, { created_at: 10, attempt: 2, status: 'in_progress', conclusion: null, started_at: 100, ...o })
  const s = (runs, view = {}) => checkState({ runs, checks: [chk(10, 1, { attempt: 1 }), chk(11, 2)], ...view }, { name: 'CI Gate', workflow: WORKFLOWS.ci, head_sha: H, head_branch: BR }).state
  assert.equal(s([rerun({}), young]), 'pending', 'control: numeric started_at')
  for (const bad of ['5000', '2026-11-26T10:00:00Z', null, undefined, NaN, Infinity]) assert.equal(s([rerun({ started_at: bad }), young]), 'ambiguous', `started_at=${String(bad)} on a re-run`)
  assert.equal(s([run(1, { created_at: 10, started_at: '5000' }), young]), 'ambiguous', 'a present-but-malformed started_at, even on attempt 1')
  assert.equal(s([run(1, { created_at: 10, started_at: 9e15, conclusion: 'success' }), run(2, { created_at: 20, conclusion: 'failure' })], { at: 1000 }), 'ambiguous', 'a timestamp from the far future')
  for (const bad of [undefined, 0, -1, 1.5, '1']) assert.equal(s([run(1, { created_at: 10, attempt: bad }), young]), 'ambiguous', `attempt=${String(bad)}`)
  assert.equal(s([run(1, { created_at: 10 }), young], { at: 1000 }), 'success', 'timestamps within the view\'s time are fine')
})

test('re-verification (round 3): impossible timestamps and duplicate run ids fail closed — started before created, non-positive times, mixed units, a repeated id', () => {
  const young = run(2, { created_at: 20 }); const s = (runs) => checkState({ runs, checks: [chk(10, 1, { attempt: 1 }), chk(11, 2)] }, { name: 'CI Gate', workflow: WORKFLOWS.ci, head_sha: H, head_branch: BR }).state
  const rerun = (o) => run(1, { created_at: 10, attempt: 2, status: 'in_progress', conclusion: null, started_at: 100, ...o })
  assert.equal(s([rerun({}), young]), 'pending', 'control')
  for (const bad of [{ started_at: 5 }, { started_at: -1e12 }, { started_at: 0 }, { created_at: -5 }, { created_at: 0 }]) assert.equal(s([rerun(bad), young]), 'ambiguous', JSON.stringify(bad))
  assert.equal(s([run(1, { created_at: 10 }), run(2, { created_at: -5, conclusion: 'failure' })]), 'ambiguous', 'a NEWER failing run with a negative created_at must not lose the ordering silently')
  assert.equal(s([run(1, { created_at: 10, started_at: 10 }), young]), 'success', 'started_at == created_at is legitimate (a run that started at once)')
  assert.equal(s([run(1, { created_at: 10 }), run(1, { created_at: 11, attempt: 2, status: 'in_progress', conclusion: null, started_at: 12 })]), 'ambiguous', 'two applicable runs with the SAME id (a paginated listing) are never merged')
})
