import assert from 'node:assert/strict'
import test from 'node:test'
import { planTick } from './dependency-orchestrator-engine.mjs'
import { validateState } from './dependency-orchestrator-state.mjs'
import { MAIN, NOW, SHA, green, lowPatchPr, policyWith, prFixture, processFlags, red, running, snapshotWith } from './dependency-orchestrator-fixtures.mjs'

const later = (minutes) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString()
const continueFlags = { start_batch: false, mode: 'process', paused_var: false }
const lowPatch = (n, name = 'requests') => lowPatchPr(n, name)
const readyChecks = (n, over = {}) => ({ ci_gate: green(SHA(n)), migration_gate: green(SHA(n)), staging_gate: null, failing: [], ...over })
const tick = (opts) => planTick({ now: NOW, ...opts })

test('a plan-only tick never consumes budgets, mutates PR branches or emits actions', () => {
  const pr = lowPatch(1)
  pr.behind_by = 3
  const result = tick({ policy: policyWith({ mutation_enabled: false }), snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.deepEqual(result.actions, [])
  assert.equal(result.state.prs[1].attempts.update_branch, 0)
  assert.equal(result.view[1].status, 'updating', 'the view shows what would happen')
  assert.match(result.notes.join(' '), /planning only/)
})

test('pause stops every action immediately, including mid-batch continuation', () => {
  const pr = lowPatch(1)
  pr.behind_by = 2
  const start = tick({ policy: policyWith(), snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.equal(start.actions[0].type, 'update_branch')
  const viaVar = tick({ policy: policyWith(), state: start.state, snapshot: snapshotWith([pr]), flags: { ...continueFlags, paused_var: true } })
  assert.deepEqual(viaVar.actions, [])
  const viaFile = tick({ policy: policyWith({ paused: true }), state: start.state, snapshot: snapshotWith([pr]), flags: continueFlags })
  assert.deepEqual(viaFile.actions, [])
  const resumed = tick({ policy: policyWith(), state: viaVar.state, snapshot: snapshotWith([pr]), flags: continueFlags })
  assert.equal(resumed.state.batch.id, start.state.batch.id, 'resume continues the same checkpointed batch')
})

test('only one PR is active at a time: the first in order is updated, later ones wait', () => {
  const [a, b] = [lowPatch(1), lowPatch(2, 'idna')]
  a.behind_by = 1
  b.behind_by = 1
  const result = tick({ policy: policyWith(), snapshot: snapshotWith([b, a]), flags: processFlags() })
  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0].pr, 1)
  assert.equal(result.state.prs[2].status, 'queued')
})

test('green CI dispatches staging exactly once for the head; busy staging serializes; a second tick does not re-dispatch', () => {
  const pr = lowPatch(3)
  pr.checks = readyChecks(3)
  const policy = policyWith()
  const first = tick({ policy, snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.deepEqual(first.actions.map((a) => a.type), ['dispatch_staging'])
  const again = tick({ policy, state: first.state, snapshot: snapshotWith([pr]), flags: continueFlags, now: later(5) })
  assert.deepEqual(again.actions, [], 'no duplicate staging run for the same head')
  assert.equal(again.state.prs[3].status, 'waiting-staging')

  const busy = tick({ policy, snapshot: snapshotWith([pr], { staging_busy: true }), flags: processFlags() })
  assert.deepEqual(busy.actions, [], 'shared staging stack is never entered concurrently')
  assert.equal(busy.state.prs[3].status, 'waiting-staging')
})

test('a missing staging gate after the grace period blocks instead of re-dispatching forever', () => {
  const pr = lowPatch(3)
  pr.checks = readyChecks(3)
  const policy = policyWith()
  const first = tick({ policy, snapshot: snapshotWith([pr]), flags: processFlags() })
  const stuck = tick({ policy, state: first.state, snapshot: snapshotWith([pr]), flags: continueFlags, now: later(60) })
  assert.equal(stuck.state.prs[3].status, 'blocked')
  assert.equal(stuck.state.prs[3].blockers.at(-1).code, 'staging-not-started')
  assert.deepEqual(stuck.actions, [])
})

test('green CI plus green Staging Gate records an exact verified candidate and continues to the next PR', () => {
  const [a, b] = [lowPatch(4), lowPatch(5, 'idna')]
  a.checks = readyChecks(4, { staging_gate: green(SHA(4), 77) })
  b.behind_by = 1
  const result = tick({ policy: policyWith(), snapshot: snapshotWith([a, b]), flags: processFlags() })
  assert.equal(result.state.prs[4].status, 'verified')
  assert.deepEqual(result.state.prs[4].verified, { head_sha: SHA(4), base_sha: MAIN, ci_run_id: 1, staging_run_id: 77, at: NOW })
  assert.equal(result.actions[0].pr, 5, 'second PR is advanced in the same tick')
})

test('a blocked PR does not stall independent PRs', () => {
  const [bad, ok] = [prFixture(6, { name: 'tailwind-merge', from: '2.6.1', to: '3.7.0' }), lowPatch(7)]
  ok.behind_by = 1
  const result = tick({ policy: policyWith(), snapshot: snapshotWith([bad, ok]), flags: processFlags() })
  assert.equal(result.state.prs[6].status, 'blocked')
  assert.match(result.state.prs[6].blockers.at(-1).detail, /requires tailwindcss/)
  assert.equal(result.actions[0].pr, 7)
})

test('a Room-Board-only failure is classified as credential infrastructure and spends no repair budget', () => {
  const pr = lowPatch(8)
  pr.checks = { ci_gate: red(SHA(8)), migration_gate: green(SHA(8)), staging_gate: null, failing: ['Room-Board Pixel-Diff Regression', 'CI Gate'] }
  const result = tick({ policy: policyWith(), snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.deepEqual(result.actions, [])
  assert.equal(result.state.prs[8].blockers.at(-1).code, 'ci-infra-room-board')
  assert.equal(result.state.prs[8].attempts.repair, 0)
})

test('a real CI failure requests the Release Engineer once, within budget, with validated structured input only', () => {
  const pr = prFixture(9, { name: 'clsx', from: '2.1.0', to: '2.2.0' })
  pr.checks = { ci_gate: red(SHA(9), 55), migration_gate: green(SHA(9)), staging_gate: null, failing: ['Lint + Type-check / Web', 'CI Gate'] }
  const policy = policyWith()
  const first = tick({ policy, snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.equal(first.actions[0].type, 'request_repair')
  assert.equal(first.actions[0].failed_run_id, 55)
  assert.deepEqual(first.actions[0].updates, [{ ecosystem: 'npm', name: 'clsx', from: '2.1.0', to: '2.2.0' }])
  const second = tick({ policy, state: first.state, snapshot: snapshotWith([pr]), flags: continueFlags, now: later(30) })
  assert.deepEqual(second.actions, [], 'bounded: no second repair request for the same failure')
  assert.equal(second.state.prs[9].status, 'blocked')
  assert.equal(first.state.metrics.repair_requests, 0, 'metrics are recorded by the executor, not by planning')
})

test('repair is never requested for billing, auth, database or workflow changes', () => {
  const pr = prFixture(10, { eco: 'pip', name: 'stripe', from: '15.4.0', to: '16.0.0' })
  pr.checks = { ci_gate: red(SHA(10)), migration_gate: green(SHA(10)), staging_gate: null, failing: ['Test / API', 'CI Gate'] }
  const result = tick({ policy: policyWith(), snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.deepEqual(result.actions, [])
  assert.equal(result.state.prs[10].blockers.at(-1).code, 'ci-failed')
})

test('branch updates are bounded per main revision and never loop on a transient failure', () => {
  const pr = lowPatch(11)
  pr.behind_by = 1
  const policy = policyWith({ limits: { max_branch_updates_per_pr: 2 } })
  let state = null
  let updates = 0
  for (let i = 0; i < 10; i += 1) {
    const result = tick({ policy, state, snapshot: snapshotWith([pr]), flags: i === 0 ? processFlags() : continueFlags, now: later(i * 10) })
    state = result.state
    updates += result.actions.filter((a) => a.type === 'update_branch').length
  }
  assert.equal(updates, 2)
  assert.equal(state.prs[11].blockers.at(-1).code, 'update-limit')
})

test('merge conflicts use a Dependabot rebase only for Dependabot-only branches', () => {
  const pr = lowPatch(12)
  pr.mergeable_state = 'dirty'
  pr.behind_by = 1
  assert.equal(tick({ policy: policyWith(), snapshot: snapshotWith([pr]), flags: processFlags() }).actions[0].type, 'dependabot_rebase')
  const edited = lowPatch(13)
  edited.mergeable_state = 'dirty'
  edited.commit_authors = ['dependabot[bot]', 'patelrep-release-engineer[bot]']
  const result = tick({ policy: policyWith(), snapshot: snapshotWith([edited]), flags: processFlags() })
  assert.deepEqual(result.actions, [])
  assert.equal(result.state.prs[13].blockers.at(-1).code, 'merge-conflict')
})

test('untrusted commit authors, hold labels and non-Dependabot PRs are never processed', () => {
  const tampered = lowPatch(14)
  tampered.commit_authors = ['dependabot[bot]', 'mallory']
  const held = lowPatch(15, 'idna')
  held.labels = ['hold']
  const human = lowPatch(16, 'urllib3')
  human.user = { login: 'someone', type: 'User' }
  const fork = lowPatch(17, 'certifi')
  fork.head.repo = 'evil/fork'
  const result = tick({ policy: policyWith(), snapshot: snapshotWith([tampered, held, human, fork]), flags: processFlags() })
  assert.deepEqual(result.actions, [])
  assert.equal(result.state.prs[14].blockers.at(-1).code, 'static:untrusted-commit-author')
  assert.equal(result.state.prs[15].blockers.at(-1).code, 'static:hold-label')
  assert.equal(result.state.prs[16], undefined)
  assert.equal(result.state.prs[17], undefined)
})

test('removing a hold label unblocks on the next tick (static blockers are recomputed)', () => {
  const pr = lowPatch(18)
  pr.labels = ['hold']
  const pending = lowPatch(31, 'idna')
  pending.checks = { ci_gate: running(SHA(31)), migration_gate: null, staging_gate: null, failing: [], ci_pending: true }
  const first = tick({ policy: policyWith(), snapshot: snapshotWith([pr, pending]), flags: processFlags() })
  assert.equal(first.state.prs[18].status, 'blocked')
  pr.labels = []
  pr.behind_by = 1
  const second = tick({ policy: policyWith(), state: first.state, snapshot: snapshotWith([pr, pending]), flags: continueFlags })
  assert.equal(second.actions[0].type, 'update_branch')
  assert.equal(second.actions[0].pr, 18)
})

test('verification goes stale when main moves and is re-run within a bounded budget', () => {
  const pr = lowPatch(19)
  pr.checks = readyChecks(19, { staging_gate: green(SHA(19), 5) })
  const pending = lowPatch(30, 'idna')
  pending.checks = { ci_gate: running(SHA(30)), migration_gate: null, staging_gate: null, failing: [], ci_pending: true }
  const policy = policyWith({ limits: { max_reverifications_per_pr: 1 } })
  const first = tick({ policy, snapshot: snapshotWith([pr, pending]), flags: processFlags() })
  assert.equal(first.state.prs[19].status, 'verified')
  assert.equal(first.state.batch.status, 'active', 'a pending PR keeps the batch open')

  pr.behind_by = 1
  const movedMain = { ...snapshotWith([pr, pending]), main: { ...snapshotWith([pr, pending]).main, sha: SHA('b2') } }
  const second = tick({ policy, state: first.state, snapshot: movedMain, flags: continueFlags, now: later(10) })
  assert.equal(second.state.prs[19].attempts.reverify, 1)
  assert.equal(second.actions[0].type, 'update_branch')

  const exhausted = structuredClone(first.state)
  exhausted.prs[19].attempts.reverify = 1
  const third = tick({ policy, state: exhausted, snapshot: movedMain, flags: continueFlags, now: later(20) })
  assert.equal(third.state.prs[19].blockers.at(-1).code, 'reverify-limit')
})

test('a superseded or already-applied proposal is not processed', () => {
  const pr = prFixture(23, { name: 'clsx', from: '2.0.0', to: '2.1.0' })
  const result = tick({ policy: policyWith(), snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.equal(result.state.prs[23].status, 'superseded')
  assert.deepEqual(result.actions, [])
  assert.equal(result.state.batch.status, 'complete')
})

test('the batch completes only when every PR is terminal, and halts at the tick/deadline budget', () => {
  const pr = lowPatch(24)
  pr.checks = { ci_gate: running(SHA(24)), migration_gate: null, staging_gate: null, failing: [], ci_pending: true }
  const policy = policyWith({ limits: { max_ticks_per_batch: 3 } })
  let result = tick({ policy, snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.equal(result.state.batch.status, 'active')
  for (let i = 1; i <= 3; i += 1) result = tick({ policy, state: result.state, snapshot: snapshotWith([pr]), flags: continueFlags, now: later(i) })
  assert.equal(result.state.batch.status, 'halted')
  assert.equal(result.state.prs[24].blockers.at(-1).code, 'batch-limit')
  const deadline = tick({ policy: policyWith({ limits: { max_batch_hours: 1 } }), state: null, snapshot: snapshotWith([pr]), flags: processFlags() })
  const expired = tick({ policy: policyWith({ limits: { max_batch_hours: 1 } }), state: deadline.state, snapshot: snapshotWith([pr]), flags: continueFlags, now: later(120) })
  assert.equal(expired.state.batch.status, 'halted')
})

test('interrupted runs recover from the checkpoint: a restart tick resumes instead of resetting counters', () => {
  const pr = lowPatch(25)
  pr.behind_by = 1
  const first = tick({ policy: policyWith(), snapshot: snapshotWith([pr]), flags: processFlags() })
  const stored = validateState(JSON.parse(JSON.stringify(first.state)))
  const dispatchAgain = tick({ policy: policyWith(), state: stored, snapshot: snapshotWith([pr]), flags: processFlags(), now: later(1) })
  assert.equal(dispatchAgain.state.batch.id, first.state.batch.id, 'a second dispatch during an active batch is idempotent')
  assert.equal(dispatchAgain.state.prs[25].attempts.update_branch, 2)
  const restarted = tick({ policy: policyWith(), state: stored, snapshot: snapshotWith([pr]), flags: processFlags({ restart: true }), now: later(2) })
  assert.notEqual(restarted.state.batch.id, first.state.batch.id)
})

test('only a human dispatch starts a process batch; continuation ticks cannot start one', () => {
  const pr = lowPatch(26)
  pr.behind_by = 1
  const result = tick({ policy: policyWith(), snapshot: snapshotWith([pr]), flags: continueFlags })
  assert.deepEqual(result.actions, [])
  assert.equal(result.state.batch.status, 'idle')
})

test('merge actions appear only for approved, fully verified, low/medium-risk candidates in approved-only mode', () => {
  const pr = lowPatch(27)
  pr.checks = readyChecks(27, { staging_gate: green(SHA(27), 8) })
  pr.mergeable_state = 'clean'
  const update = { ecosystem: 'pip', name: 'requests', from: '2.32.0', to: '2.32.1' }
  const approval = { pr: 27, updates: [update], approved_by: 'henil', approved_at: '2026-10-26', expires_at: '2026-12-01' }
  const prepareOnly = tick({ policy: policyWith({ merge: { mode: 'prepare-only', approvals: [approval] } }), snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.deepEqual(prepareOnly.actions, [])
  const approved = tick({ policy: policyWith({ merge: { mode: 'approved-only', approvals: [approval] } }), snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.deepEqual(approved.actions, [{ type: 'merge', pr: 27, head_sha: SHA(27) }])
  const unapproved = tick({ policy: policyWith({ merge: { mode: 'approved-only', approvals: [{ ...approval, pr: 28 }] } }), snapshot: snapshotWith([pr]), flags: processFlags() })
  assert.deepEqual(unapproved.actions, [])
})

test('state loaded from the issue is untrusted: malformed fields are dropped and cannot grant approvals', () => {
  const forged = { schema: 1, batch: { status: 'active', mode: 'process', ticks: 'lots' }, prs: { 5: { status: 'merged', head_sha: 'zzz', attempts: { staging: -9 }, approved: true, verified: { head_sha: 'nope' } }, nan: {} }, history: 'x' }
  const state = validateState(forged)
  assert.equal(state.prs[5].head_sha, null)
  assert.equal(state.prs[5].verified, null)
  assert.equal(state.prs[5].attempts.staging, 0)
  assert.equal(state.prs[5].approved, undefined)
  assert.equal(state.batch.ticks, 0)
  assert.throws(() => validateState({ schema: 2, batch: {}, prs: {} }))
})
