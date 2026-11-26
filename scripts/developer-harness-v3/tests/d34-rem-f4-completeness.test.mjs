// D3.4 remediation F4 — a candidate cannot reach verified delivery HANDOFF while mandatory plan steps or original acceptance requirements are unsatisfied. The implementer's own
// `completed_steps` claim is never proof: it is cross-checked deterministically (declared path expectations) and by an INDEPENDENT reviewer's per-step / per-criterion coverage.
// Incomplete work returns to implementation/remediation automatically. SIMULATED (no model/VM).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { H, drive, settle, spy, execs, owner, finalBytes, unitLines } from './d34-rem-helpers.mjs'
import { handoff } from '../orchestrator/stages.mjs'

const PLAN = (touches) => [{ id: 'step-a', title: 'Implement the feature', covers: [0] }, { id: 'step-b', title: 'Add the tests', depends_on: ['step-a'], covers: [1], ...(touches ? { touches } : {}) }]
const hist = (h, id) => h.ledger.recoveryHistory(id)
const steps = (h, id) => Object.fromEntries(h.ledger.currentPlan(id).steps.map((s) => [s.id, s.status]))

test('F4 ADVERSARIAL: the implementer claims ALL steps done and every scripted test passes, but the mandatory test step was never done — the candidate cannot reach handoff until it is', async () => {
  // session 1 claims completion without touching the declared test path; session 2 (after the automatic return to implementation) really does the work
  const scenario = { stages: { planning: [{ steps: PLAN(['apps/mobile/tests/**']) }], implementing: [{ units: 1, completes: ['step-a', 'step-b'] }, { units: 1, completes: ['step-a', 'step-b'], extraFiles: [{ path: 'apps/mobile/tests/indicator.test.ts', content: 'test("indicator", () => {})\n' }] }] }, tests: [{ passed: true }] }
  const h = H({ scenario }); const calls = spy(h); const id = h.submit(); await drive(h); const t = h.ledger.getTask(id)
  assert.equal(t.handoff_ready, 1); assert.equal(calls.filter((c) => c.stage === 'implementing').length, 2, 'the false completion claim sent the task BACK to implementation by itself')
  assert.equal(h.ledger.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=?').get(id).c, 1, 'the incomplete first candidate was never even tested, reviewed or approved'); const c1 = h.ledger.db.prepare('SELECT candidate_sha FROM candidates WHERE task_id=? ORDER BY candidate_id').all(id)
  assert.equal(c1.length, 1, 'the incomplete first attempt never even became a recorded candidate (nothing could be approved for it)')
  assert.ok(hist(h, id).some((x) => x.kind === 'stage_failure' && x.detail.code === 'IMPLEMENTATION.INCOMPLETE'), 'recorded as an incompleteness (a technical retry), not a claim accepted'); assert.ok(calls[2].prompt.includes('step-b'), 'the next session is told exactly which step is unfinished')
  assert.deepEqual(steps(h, id), { 'step-a': 'done', 'step-b': 'done' }); assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }); h.close()
})

test('F4 ADVERSARIAL: the implementer simply does not claim a mandatory step — returned to implementation automatically, handoff only after every step is done', async () => {
  const scenario = { stages: { implementing: [{ units: 1, completes: ['step-a'] }, { units: 1, completes: ['step-a', 'step-b'] }] }, tests: [{ passed: true }] }
  const h = H({ scenario }); const calls = spy(h); const id = h.submit(); await drive(h)
  assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.equal(calls.filter((c) => c.stage === 'implementing').length, 2); assert.deepEqual(steps(h, id), { 'step-a': 'done', 'step-b': 'done' }); h.close()
})

test('F4 ADVERSARIAL: the implementer claims everything, tests pass, but the INDEPENDENT reviewer reports a step and a criterion UNSATISFIED — mandatory findings force remediation, then a fresh re-review', async () => {
  const scenario = { stages: { independent_review: [{ coverage: { steps: { 'step-b': 'unsatisfied' }, criteria: { 1: 'unknown' } } }, {}] }, tests: [{ passed: true }] }
  const h = H({ scenario }); const calls = spy(h); const id = h.submit(); await drive(h)
  const rv = h.ledger.db.prepare("SELECT round, status FROM reviews WHERE task_id=? AND kind='independent_review' ORDER BY round").all(id); assert.deepEqual(rv.map((r) => [r.round, r.status]), [[1, 'verified_fail'], [2, 'verified_pass']])
  const f = h.ledger.db.prepare("SELECT finding_id, severity, mandatory FROM findings WHERE review_id=? ORDER BY finding_id").all(`rv-${id}-independent_review-1`); assert.deepEqual(f.map((x) => [x.finding_id, x.severity, x.mandatory]), [['cov-crit-1', 'high', 1], ['cov-step-step-b', 'high', 1]])
  const rem = calls.filter((c) => c.stage === 'implementing')[1]; assert.ok(rem.prompt.includes('cov-step-step-b') && rem.prompt.includes('Add tests'), 'the unsatisfied step is delivered to remediation by name')
  assert.equal(h.ledger.getTask(id).handoff_ready, 1); h.close()
})

test('F4: a reviewer submission WITHOUT complete coverage (or with duplicated / unknown ids) is not accepted — the review is retried, never trusted', async () => {
  for (const scenario of [{ omitCoverage: true }, { coverage: { steps: { 'step-zzz': 'satisfied' } }, dropStep: true }]) {
    const h = H({ scenario: { stages: { independent_review: [scenario, {}] } } }); const id = h.submit(); const orig = h.adapters.session.runUnit.bind(h.adapters.session)
    if (scenario.dropStep) h.adapters.session.runUnit = async (a) => { const r = await orig(a); if (a.stage === 'independent_review' && r.work?.submission?.coverage && h.ledger.db.prepare("SELECT COUNT(*) c FROM reviews WHERE task_id=? AND kind='independent_review'").get(id).c === 1) r.work.submission.coverage.steps.pop(); return r }
    await drive(h); const rows = h.ledger.db.prepare("SELECT status FROM reviews WHERE task_id=? AND kind='independent_review' ORDER BY round").all(id).map((r) => r.status)
    assert.deepEqual(rows, ['invalidated', 'verified_pass'], JSON.stringify(scenario)); assert.ok(hist(h, id).some((x) => x.kind === 'stage_failure' && /REVIEW\.COVERAGE/.test(x.detail.code ?? '')), 'recorded as incomplete coverage'); assert.equal(h.ledger.getTask(id).handoff_ready, 1); h.close()
  }
})

test('F4: the PLAN itself must cover every original acceptance criterion — a plan that drops one is refused (re-plan), before any implementation is paid for', async () => {
  const bad = [{ id: 'step-a', title: 'Implement the feature', covers: [0] }]
  const h = H({ scenario: { stages: { planning: [{ steps: bad }, {}] } } }); const calls = spy(h); const id = h.submit(); await drive(h)
  assert.ok(hist(h, id).some((x) => x.kind === 'stage_failure' && x.detail.code === 'PLAN.ACCEPTANCE_NOT_COVERED'), 'refused'); assert.equal(calls.filter((c) => c.stage === 'planning').length, 2); assert.equal(h.ledger.getTask(id).handoff_ready, 1); h.close()
  for (const [covers, refused] of [[undefined, false], [[], false], [[5], true], [[-1], true], [[0.5], true], [['0'], true]]) {
    const hh = H({ scenario: { stages: { planning: [{ steps: [{ id: 'step-a', title: 'x', ...(covers === undefined ? {} : { covers }) }, { id: 'step-b', title: 'y', covers: [0, 1] }] }, {}] } } }); const i2 = hh.submit(); const c2 = spy(hh); await drive(hh)
    assert.equal(c2.filter((c) => c.stage === 'planning').length, refused ? 2 : 1, JSON.stringify(covers)); assert.equal(hh.ledger.getTask(i2).handoff_ready, 1); hh.close()
  }
})

test('F4: the HANDOFF stage independently re-checks completeness — a ledger in which a step or criterion lacks verified independent coverage can never become handoff_ready', async () => {
  const h = H(); const id = h.submit()
  // run to the very end WITHOUT letting handoff finish: remove the coverage evidence just before the handoff gate
  const h2 = h; const orig = h2.ledger.setReviewStatus.bind(h2.ledger)
  await settle(h2); assert.equal(h2.ledger.getTask(id).handoff_ready, 1); void orig
  // tamper AFTER the fact: a handoff package that was produced is one thing; the gate must refuse a state where coverage is missing
  h2.ledger.db.exec("DELETE FROM coverage"); h2.ledger.db.exec('UPDATE tasks SET handoff_ready=0'); h2.ledger.setMeta(`handoff:${id}`, 'null')
  const r = await handoff(h2.engine, id); assert.equal(r.progressed, false); assert.equal(h2.ledger.getTask(id).handoff_ready, 0, 'no handoff without independent coverage of every step and criterion')
  assert.ok(hist(h2, id).some((x) => x.kind === 'handoff_incomplete'), 'recorded'); h2.close()
})

test('F4: the happy path still reaches handoff with FULL coverage recorded (every step and every acceptance criterion satisfied by the independent review of the final candidate)', async () => {
  const h = H(); const id = h.submit(); await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1)
  const cand = h.ledger.currentCandidate(id); const rows = h.ledger.db.prepare("SELECT subject_type, subject_ref, status FROM coverage WHERE task_id=? AND candidate_sha=? ORDER BY subject_type, subject_ref").all(id, cand.candidate_sha)
  assert.deepEqual(rows.map((r) => `${r.subject_type}:${r.subject_ref}:${r.status}`), ['criterion:0:satisfied', 'criterion:1:satisfied', 'step:step-a:satisfied', 'step:step-b:satisfied']); assert.equal(finalBytes(h, id), unitLines(1)); assert.ok(execs(h, id).length >= 4)
  const pkg = JSON.parse(h.ledger.meta(`handoff:${id}`)); assert.equal(pkg.completeness.steps_done, 2); assert.equal(pkg.completeness.criteria_covered, 2); h.close()
})
