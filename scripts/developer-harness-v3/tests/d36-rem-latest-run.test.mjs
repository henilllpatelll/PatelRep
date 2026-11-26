// D3.6 remediation F1 — the LATEST applicable workflow run decides, independently of which checks it has reported yet. SIMULATED views only (no network, no GitHub).
// Before the fix, checkState chose among EXISTING matching checks, so an older run's success survived a newer same-SHA run that was queued, running or attempt-bumped without a result.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTIONS_APP_ID, WORKFLOWS, checkState, ciState, requiredCiChecks, stagingGate } from '../orchestrator/delivery/required-checks.mjs'

const H = 'a'.repeat(40); const BR = 'dh3/t'
const run = (id, o = {}) => ({ id, workflow: WORKFLOWS.ci, event: 'pull_request', head_sha: H, head_branch: BR, pr_number: 7, attempt: 1, status: 'completed', conclusion: 'success', created_at: id * 10, ...o })
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
const srun = (id, o = {}) => ({ id, workflow: WORKFLOWS.staging, event: 'workflow_run', head_sha: H, pr_number: 7, attempt: 1, status: 'completed', conclusion: 'success', created_at: id * 10, ...o })
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
