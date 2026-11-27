// D3.4 remediation F3b — evidence PRESENCE is not authorization. The evidence store deliberately accepts AUTHENTIC non-passing evidence (a failed test run, a failed review, a review with open
// mandatory findings) so the ledger can record it; an intent may only be authorized (created), dispatched or retried by evidence that is SATISFYING under the D3.2 rule `isSatisfying`
// (verdict `pass` and no open critical/high finding). The durable intent layer is NOT the complete authority evaluator (see doc 18 §"Trusted evaluator and reconciliation source").
// SIMULATED: no real GitHub effect exists in D3.4.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { acceptEvidence } from '../orchestrator/ledger/evidence-store.mjs'
import { beginIntent, getIntent, markDispatched, recordOutcome, reconcileIntent, markUncertain, retryIntent } from '../orchestrator/ledger/intents.mjs'
import { isSatisfying } from '../authority/evidence.mjs'
import { BASE, ENV_ID, HEAD, PATCH, REPO, TREE, buildPolicy, evidence, NOW, proveAbsent } from './helpers.mjs'

const AUTH = { allowed_paths: ['apps/mobile/**', 'supabase/migrations/**'], denied_paths: [] }
const PUBLISH = 'publish_candidate_branch' // requires task_authority + test_results
const READY = 'mark_pull_request_ready' // requires task_authority + test_results + independent_review + publication_receipt + ci_gate
const OPEN_HIGH = { id: 'f-1', severity: 'high', resolved: false }
const RESOLVED_HIGH = { id: 'f-1', severity: 'high', resolved: true }

function setup({ activate = [PUBLISH, READY], mutate = null } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dh34-f3b-')); const clock = { t: NOW }
  const pol = buildPolicy({ activate, mutate }); const L = Ledger.open(path.join(dir, 'l.sqlite'), { clock: () => clock.t })
  assert.ok(L.submitTask({ task_id: 'task-1', repository: REPO, base_sha: BASE, requirements: { text: 'r' }, scope: AUTH, acceptance: { criteria: ['c'] }, risk_class: 'routine', policy_revision: pol.policy.revision, environment_id: ENV_ID }).ok)
  for (const s of ['queued', 'planning', 'implementing']) assert.ok(L.transition('task-1', s).ok)
  assert.ok(L.submitCandidate('task-1', { base_sha: BASE, candidate_sha: HEAD, tree_digest: TREE, patch_digest: PATCH }).ok)
  { const im = L.acquireLease({ taskId: 'task-1', role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'high', contextId: 'ctx-impl' }).lease; L.closeLease(im, { terminationVerified: true, endReason: 'done' }) } // the author context independence is judged against
  const ev = (type, over = {}) => evidence(type, { policy: pol.policy, keys: pol.keys, over: { fencing_token: 1, issued_at: new Date(clock.t - 60_000).toISOString(), expires_at: new Date(clock.t + 3_000_000).toISOString(), ...over } })
  // A matching review record (what the controller opens before a reviewer is ever consulted) so the store accepts the signed review evidence for `kind`.
  const reviewRecord = (kind) => {
    const lease = L.acquireLease({ taskId: 'task-1', role: kind === 'security_review' ? 'security_reviewer' : 'independent_reviewer', stage: kind, model: 'sonnet', effort: 'high', contextId: `ctx-${kind}` }).lease
    L.openReview('task-1', { kind, execution: { execution_id: lease.execution_id, context_id: lease.context_id }, candidate: { candidate_sha: HEAD, tree_digest: TREE }, policy_revision: pol.policy.revision, environment_id: ENV_ID })
    L.closeLease(lease, { terminationVerified: true, endReason: 'done' })
  }
  const accept = (type, over = {}) => { const e = ev(type, over); const r = acceptEvidence(L, e, { policy: pol.policy }); assert.ok(r.ok, `${type}: ${JSON.stringify(r)}`); return { id: e.payload.evidence_id, satisfying: r.satisfying } }
  return { L, pol, clock, policy: pol.policy, ev, accept, reviewRecord }
}
const publishIds = (S, over = {}) => ({ ids: [S.accept('task_authority').id, S.accept('test_results', over).id] })
const begin = (S, ids, over = {}) => beginIntent(S.L, { taskId: 'task-1', action: PUBLISH, idempotencyKey: 'pub-1', params: { branch: 'feature/x' }, evidenceIds: ids, policy: S.policy, candidateSha: HEAD, ...over })
const consumedCount = (S) => S.L.db.prepare('SELECT COUNT(*) c FROM evidence WHERE consumed_at IS NOT NULL').get().c
const intentCount = (S) => S.L.db.prepare('SELECT COUNT(*) c FROM action_intents').get().c

test('F3b precondition: the store ACCEPTS authentic non-passing evidence (that is why presence must never be treated as authorization)', () => {
  const S = setup()
  const failed = S.accept('test_results', { verdict: 'fail' }); assert.equal(failed.satisfying, false)
  const open = S.accept('test_results', { verdict: 'findings_open' }); assert.equal(open.satisfying, false)
  const high = S.accept('test_results', { findings: [OPEN_HIGH] }); assert.equal(high.satisfying, false, 'verdict pass with an OPEN high finding is still not satisfying (D3.2 rule)')
  const resolved = S.accept('test_results', { findings: [RESOLVED_HIGH] }); assert.equal(resolved.satisfying, true, 'a RESOLVED high finding does not block')
  S.L.close()
})

test('F3b: a failed test run cannot AUTHORIZE intent creation; nothing is consumed and no intent row is written', () => {
  for (const bad of [{ verdict: 'fail' }, { verdict: 'findings_open' }, { findings: [OPEN_HIGH] }, { findings: [{ id: 'f-2', severity: 'critical', resolved: false }] }]) {
    const S = setup(); const { ids } = publishIds(S, bad)
    const r = begin(S, ids); assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal(r.code, 'INTENT.EVIDENCE_NOT_SATISFYING')
    assert.equal(consumedCount(S), 0, 'a refused creation consumes nothing (single-use semantics are untouched)'); assert.equal(intentCount(S), 0)
    S.L.close()
  }
})

test('F3b: a failed independent review cannot authorize mark_pull_request_ready (failed, findings_open, open mandatory/high findings) — but the SAME review passing does', () => {
  for (const bad of [{ verdict: 'fail' }, { verdict: 'findings_open', findings: [OPEN_HIGH] }, { verdict: 'findings_open' }, { verdict: 'pass', findings: [OPEN_HIGH] }]) {
    const S = setup(); S.reviewRecord('independent_review')
    const ids = [S.accept('task_authority').id, S.accept('test_results').id, S.accept('independent_review', bad).id, S.accept('publication_receipt').id, S.accept('ci_gate').id]
    const r = begin(S, ids, { action: READY, params: { pr: 1 } }); assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal(r.code, 'INTENT.EVIDENCE_NOT_SATISFYING'); assert.equal(consumedCount(S), 0); assert.equal(intentCount(S), 0)
    S.L.close()
  }
  const S = setup(); S.reviewRecord('independent_review')
  const ids = [S.accept('task_authority').id, S.accept('test_results').id, S.accept('independent_review').id, S.accept('publication_receipt').id, S.accept('ci_gate').id]
  assert.ok(begin(S, ids, { action: READY, params: { pr: 1 } }).ok, 'control: an all-passing set still authorizes'); S.L.close()
})

test('F3b: EVERY cited evidence must be satisfying — a failing artifact smuggled in beside the required passing ones (a different type, or a second test run) is refused', () => {
  const S = setup(); const ok = publishIds(S).ids; const extraFail = S.accept('ci_gate', { verdict: 'fail' }).id; const secondFail = S.accept('test_results', { verdict: 'fail' }).id
  assert.equal(begin(S, [...ok, extraFail]).code, 'INTENT.EVIDENCE_NOT_SATISFYING'); assert.equal(begin(S, [...ok, secondFail]).code, 'INTENT.EVIDENCE_NOT_SATISFYING')
  assert.equal(consumedCount(S), 0); assert.ok(begin(S, ok).ok, 'the passing pair alone is still valid and was never consumed by the refusals'); S.L.close()
})

test('F3b: only a failing artifact is not enough either — a required type satisfied by NOTHING passing is refused with the same code (not "missing")', () => {
  const S = setup(); const ids = [S.accept('task_authority').id, S.accept('test_results', { verdict: 'fail' }).id]
  assert.equal(begin(S, ids).code, 'INTENT.EVIDENCE_NOT_SATISFYING'); S.L.close()
})

// A ledger row written before this remediation (or altered at rest) can carry non-satisfying evidence behind an intent that was created "ok". Dispatch and retry must re-check, from the CURRENT ledger.
const downgrade = (S, id, over) => { S.L.db.exec('DROP TRIGGER IF EXISTS evidence_envelope_immutable') /* simulates a row that predates the guard / was altered at rest: the trigger is the first line of defence, this is the second */; const row = S.L.db.prepare('SELECT envelope_json FROM evidence WHERE evidence_id=?').get(id); const env = JSON.parse(row.envelope_json); env.payload = { ...env.payload, ...over }
  S.L.db.prepare('UPDATE evidence SET envelope_json=? WHERE evidence_id=?').run(JSON.stringify(env), id) }

test('F3b: DISPATCH re-checks satisfaction from the current ledger — a legacy/altered row behind an existing intent never dispatches and a refusal changes nothing', () => {
  const S = setup(); const { ids } = publishIds(S); const i = begin(S, ids); assert.ok(i.ok); const iid = i.intent.intent_id
  downgrade(S, ids[1], { verdict: 'fail' })
  const d = markDispatched(S.L, iid, { policy: S.policy }); assert.equal(d.ok, false); assert.equal(d.code, 'INTENT.EVIDENCE_NOT_SATISFYING'); assert.equal(getIntent(S.L, iid).status, 'intended')
  downgrade(S, ids[1], { verdict: 'pass', findings: [OPEN_HIGH] }); assert.equal(markDispatched(S.L, iid, { policy: S.policy }).code, 'INTENT.EVIDENCE_NOT_SATISFYING')
  downgrade(S, ids[1], { verdict: 'pass', findings: [] }); assert.ok(markDispatched(S.L, iid, { policy: S.policy }).ok, 'restored to passing, the same intent dispatches'); S.L.close()
})

test('F3b: RETRY re-checks satisfaction — a failed effect is never retried on evidence that no longer satisfies', () => {
  const S = setup(); const { ids } = publishIds(S); const i = begin(S, ids); const iid = i.intent.intent_id
  assert.ok(markDispatched(S.L, iid, { policy: S.policy }).ok); assert.ok(recordOutcome(S.L, iid, { success: false, outcome: { error: 'timeout' } }).ok); assert.ok(proveAbsent(S.L, S.pol, iid, { reconcileIntent, getIntent }).ok) // D3.6: timeout = uncertain; absence proven by authenticated reads
  downgrade(S, ids[1], { verdict: 'findings_open' })
  const r = retryIntent(S.L, iid, { policy: S.policy }); assert.equal(r.ok, false); assert.equal(r.code, 'INTENT.EVIDENCE_NOT_SATISFYING'); assert.equal(getIntent(S.L, iid).status, 'reconciled_absent', 'a refused retry changes nothing')
  // reconcile-then-retry path
  downgrade(S, ids[1], { verdict: 'pass' }); assert.ok(retryIntent(S.L, iid, { policy: S.policy }).ok); assert.ok(markDispatched(S.L, iid, { policy: S.policy }).ok); assert.ok(markUncertain(S.L, iid).ok)
  const row = getIntent(S.L, iid); void row; assert.ok(proveAbsent(S.L, S.pol, iid, { reconcileIntent, getIntent }).ok)
  downgrade(S, ids[0], { verdict: 'fail' }); assert.equal(retryIntent(S.L, iid, { policy: S.policy }).code, 'INTENT.EVIDENCE_NOT_SATISFYING'); assert.equal(getIntent(S.L, iid).status, 'reconciled_absent'); S.L.close()
})

test('F3b: stored evidence that is unreadable or whose payload no longer matches its row fails CLOSED at dispatch', () => {
  const S = setup(); const { ids } = publishIds(S); const i = begin(S, ids); const iid = i.intent.intent_id; S.L.db.exec('DROP TRIGGER evidence_envelope_immutable')
  S.L.db.prepare('UPDATE evidence SET envelope_json=? WHERE evidence_id=?').run('{not json', ids[1]); assert.equal(markDispatched(S.L, iid, { policy: S.policy }).code, 'EVIDENCE.UNREADABLE')
  S.L.db.prepare('UPDATE evidence SET envelope_json=? WHERE evidence_id=?').run('null', ids[1]); assert.equal(markDispatched(S.L, iid, { policy: S.policy }).code, 'EVIDENCE.UNREADABLE')
  S.L.close()
  const T = setup(); const t = publishIds(T); const j = begin(T, t.ids); downgrade(T, t.ids[1], { evidence_type: 'task_authority' })
  assert.equal(markDispatched(T.L, j.intent.intent_id, { policy: T.policy }).code, 'EVIDENCE.UNREADABLE', 'a row/payload type mismatch is a corrupted record, never trusted'); T.L.close()
})

test('F3b: the evaluator\'s review-context rule is kept — independent and security reviews required together must come from DISTINCT contexts', () => {
  const S = setup({ mutate: (c) => { c.actions[PUBLISH].required_evidence = ['task_authority', 'independent_review', 'security_review'] } })
  S.reviewRecord('independent_review'); S.reviewRecord('security_review')
  const ids = [S.accept('task_authority').id, S.accept('independent_review').id, S.accept('security_review').id]
  const i = begin(S, ids); assert.ok(i.ok, JSON.stringify(i)); // distinct contexts: allowed
  downgrade(S, ids[2], { context_id: 'ctx-independent_review' }) // the same reviewer context behind both approvals (what the evaluator calls REVIEW_CONTEXTS_NOT_DISTINCT)
  assert.equal(markDispatched(S.L, i.intent.intent_id, { policy: S.policy }).code, 'INTENT.REVIEW_CONTEXTS_NOT_DISTINCT'); S.L.close()
})

test('F3b: the satisfaction rule IS the D3.2 rule (no parallel definition): intents.mjs imports isSatisfying and the store reports the same answer', () => {
  assert.equal(isSatisfying({ verdict: 'pass' }), true); assert.equal(isSatisfying({ verdict: 'fail' }), false); assert.equal(isSatisfying({ verdict: 'findings_open' }), false)
  assert.equal(isSatisfying({ verdict: 'pass', findings: [OPEN_HIGH] }), false); assert.equal(isSatisfying({ verdict: 'pass', findings: [{ id: 'm', severity: 'medium', resolved: false }] }), true)
})

test('F3b (review finding): an action named like an Object.prototype member is UNKNOWN — it is refused at creation (dispatch and retry share the same bindingProblem), with or without evidence', () => {
  const S = setup()
  for (const action of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    const r = begin(S, [], { action, idempotencyKey: `proto-${action}` }); assert.equal(r.ok, false, action); assert.equal(r.code, 'INTENT.UNKNOWN_ACTION', action)
  }
  assert.equal(intentCount(S), 0); S.L.close()
})
