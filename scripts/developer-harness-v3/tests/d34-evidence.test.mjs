// D3.4 evidence store and action intents: real Ed25519 envelopes verified by the D3.2 verifier, durable nonce binding, atomic consumption, replay, substitution,
// concurrent consumption through two SQLite connections, and remote-effect intents (uncertain outcomes must be reconciled before any retry).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { acceptEvidence, consumeAll, satisfyingEvidence, usableEvidence } from '../orchestrator/ledger/evidence-store.mjs'
import { beginIntent, getIntent, markDispatched, markDispatchedAsUncertain, markUncertain, reconcileIntent, recordOutcome, retryIntent } from '../orchestrator/ledger/intents.mjs'
import { BASE, ENV_ID, HEAD, PATCH, REPO, TREE, buildPolicy, evidence, NOW, signedObservation, proveAbsent } from './helpers.mjs'

const AUTH = { allowed_paths: ['apps/mobile/**', 'supabase/migrations/**'], denied_paths: [] }
function setup({ activate = [] } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dh34-ev-')); const file = path.join(dir, 'l.sqlite')
  const pol = buildPolicy({ activate })
  const L = Ledger.open(file, { clock: () => NOW })
  const r = L.submitTask({ task_id: 'task-1', repository: REPO, base_sha: BASE, requirements: { text: 'r' }, scope: AUTH, acceptance: { criteria: ['c'] }, risk_class: 'routine', policy_revision: pol.policy.revision, environment_id: ENV_ID })
  assert.ok(r.ok, JSON.stringify(r)); for (const s of ['queued', 'planning', 'implementing']) assert.ok(L.transition('task-1', s).ok)
  assert.ok(L.submitCandidate('task-1', { base_sha: BASE, candidate_sha: HEAD, tree_digest: TREE, patch_digest: PATCH }).ok)
  const ev = (type, over = {}, o = {}) => evidence(type, { policy: pol.policy, keys: pol.keys, over: { fencing_token: 1, ...over }, ...o })
  return { dir, file, L, pol, ev }
}

test('valid evidence is accepted once, idempotently, and bound to the durable nonce table', () => {
  const { L, pol, ev } = setup(); const e = ev('test_results')
  const a = acceptEvidence(L, e, { policy: pol.policy }); assert.ok(a.ok && !a.duplicate && a.satisfying)
  const b = acceptEvidence(L, e, { policy: pol.policy }); assert.ok(b.ok && b.duplicate, 'the exact same envelope is a no-op')
  assert.equal(L.db.prepare('SELECT COUNT(*) c FROM evidence').get().c, 1); assert.equal(L.db.prepare('SELECT COUNT(*) c FROM evidence_nonces').get().c, 1)
  assert.throws(() => L.db.exec("UPDATE evidence SET envelope_json='{}'"), /EVIDENCE_IMMUTABLE/); assert.throws(() => L.db.exec('DELETE FROM evidence'), /NO_DELETE/)
  assert.equal(usableEvidence(L, 'task-1', pol.policy).length, 1); assert.equal(satisfyingEvidence(L, 'task-1', pol.policy, 'test_results').length, 1)
  L.close()
})

test('nonce replay with a different payload, evidence-id collisions, forged signatures, unknown/mismatched issuers and keys are refused', () => {
  const { L, pol, ev } = setup()
  const e1 = ev('test_results', { nonce: 'n-shared' }); assert.ok(acceptEvidence(L, e1, { policy: pol.policy }).ok)
  const e2 = ev('test_results', { nonce: 'n-shared' }); assert.equal(acceptEvidence(L, e2, { policy: pol.policy }).problems[0], 'EVIDENCE.NONCE_CONFLICT')
  const e3 = ev('test_results', { evidence_id: e1.payload.evidence_id }); assert.equal(acceptEvidence(L, e3, { policy: pol.policy }).problems[0], 'EVIDENCE.ID_CONFLICT')
  const evil = generateKeyPairSync('ed25519').privateKey
  assert.ok(acceptEvidence(L, ev('test_results', {}, { signWith: evil }), { policy: pol.policy }).problems.includes('EVIDENCE.BAD_SIGNATURE'))
  assert.ok(acceptEvidence(L, ev('test_results', { issuer_identity: 'independent_reviewer' }, { keyId: 'k-orchestrator' }), { policy: pol.policy }).problems.includes('EVIDENCE.UNAUTHORIZED_ISSUER'))
  assert.ok(acceptEvidence(L, ev('test_results', {}, { keyId: 'k-delivery_verifier' }), { policy: pol.policy }).problems.includes('EVIDENCE.KEY_IDENTITY_MISMATCH'))
  const tampered = structuredClone(ev('test_results')); tampered.payload.results = { passed: 999 }
  assert.ok(acceptEvidence(L, tampered, { policy: pol.policy }).problems.includes('EVIDENCE.BAD_SIGNATURE'))
  assert.equal(acceptEvidence(L, { payload: {} }, { policy: pol.policy }).ok, false); assert.equal(acceptEvidence(L, null, { policy: pol.policy }).ok, false)
  assert.equal(L.db.prepare('SELECT COUNT(*) c FROM evidence').get().c, 1, 'nothing partial was stored')
  L.close()
})

test('candidate, tree, base, policy, environment, task, fencing and freshness substitution are all refused', () => {
  const { L, pol, ev } = setup(); const refuse = (over, code, o) => assert.ok(acceptEvidence(L, ev('test_results', over, o), { policy: pol.policy }).problems.includes(code), `${code}: ${JSON.stringify(over)}`)
  refuse({ candidate_sha: 'f'.repeat(40) }, 'EVIDENCE.WRONG_CANDIDATE_SHA'); refuse({ tree_digest: 'f'.repeat(40) }, 'EVIDENCE.WRONG_TREE_DIGEST'); refuse({ base_sha: 'f'.repeat(40) }, 'EVIDENCE.WRONG_BASE_SHA')
  refuse({ environment_id: 'other-env' }, 'EVIDENCE.WRONG_ENVIRONMENT'); refuse({ policy_revision: 'f'.repeat(64) }, 'EVIDENCE.WRONG_POLICY_REVISION'); refuse({ repository: 'evil/repo' }, 'EVIDENCE.WRONG_REPOSITORY')
  refuse({ fencing_token: 2 }, 'EVIDENCE.STALE_FENCING_TOKEN'); refuse({ patch_digest: 'f'.repeat(64) }, 'EVIDENCE.WRONG_PATCH_DIGEST')
  refuse({ expires_at: new Date(NOW - 1000).toISOString(), issued_at: new Date(NOW - 5000).toISOString() }, 'EVIDENCE.EXPIRED'); refuse({ issued_at: new Date(NOW + 3_600_000).toISOString(), expires_at: new Date(NOW + 3_700_000).toISOString() }, 'EVIDENCE.FROM_THE_FUTURE')
  refuse({ expires_at: new Date(NOW + 90_000_000).toISOString() }, 'EVIDENCE.TTL_TOO_LONG')
  assert.equal(acceptEvidence(L, ev('test_results', { task_id: 'task-404' }), { policy: pol.policy }).problems[0], 'EVIDENCE.UNKNOWN_TASK')
  // a different ACTIVE policy loaded by the caller never accepts evidence signed for another revision
  const other = buildPolicy({ mutate: (c) => { c.limits.max_changed_paths = 1999 } })
  assert.ok(acceptEvidence(L, ev('test_results'), { policy: other.policy }).problems.some((p) => /POLICY|KEY|SIGNATURE/.test(p)))
  assert.equal(L.db.prepare('SELECT COUNT(*) c FROM evidence').get().c, 0); L.close()
})

test('a head change invalidates candidate-bound evidence; invalidated or expired evidence is not usable and cannot be consumed', () => {
  const { L, pol, ev } = setup(); assert.ok(acceptEvidence(L, ev('test_results'), { policy: pol.policy }).ok)
  const dv = ev('delivery_verification'); assert.ok(acceptEvidence(L, dv, { policy: pol.policy }).ok)
  assert.equal(usableEvidence(L, 'task-1', pol.policy).length, 2)
  assert.ok(L.submitCandidate('task-1', { base_sha: BASE, candidate_sha: '9'.repeat(40), tree_digest: '8'.repeat(40), patch_digest: '7'.repeat(64) }).ok)
  assert.equal(usableEvidence(L, 'task-1', pol.policy).length, 0, 'bound to the previous head'); assert.equal(consumeAll(L, [dv.payload.evidence_id], 'x').code, 'EVIDENCE.INVALIDATED')
  // and the OLD evidence cannot be re-accepted for the new candidate
  assert.ok(acceptEvidence(L, ev('test_results', { nonce: 'n-fresh' }), { policy: pol.policy }).problems.includes('EVIDENCE.WRONG_CANDIDATE_SHA'))
  L.close()
})

test('consumption is atomic all-or-none, one-time, and survives a restart', () => {
  const { dir, file, L, pol, ev } = setup(); const a = ev('delivery_verification'); const b = ev('delivery_verification'); const c = ev('delivery_verification')
  for (const e of [a, b, c]) assert.ok(acceptEvidence(L, e, { policy: pol.policy }).ok)
  const ids = [a, b].map((e) => e.payload.evidence_id)
  assert.equal(consumeAll(L, [...ids, 'ev-unknown'], 'k').code, 'EVIDENCE.UNKNOWN'); assert.equal(L.db.prepare('SELECT COUNT(*) c FROM evidence WHERE consumed_at IS NOT NULL').get().c, 0, 'none consumed')
  assert.ok(consumeAll(L, ids, 'k').ok); assert.equal(consumeAll(L, [ids[0]], 'k2').code, 'EVIDENCE.ALREADY_CONSUMED')
  assert.equal(consumeAll(L, [c.payload.evidence_id, ids[1]], 'k3').code, 'EVIDENCE.ALREADY_CONSUMED'); assert.equal(L.db.prepare("SELECT consumed_at FROM evidence WHERE evidence_id=?").get(c.payload.evidence_id).consumed_at, null, 'all-or-none')
  L.close(); const L2 = Ledger.open(file, { clock: () => NOW }); assert.equal(consumeAll(L2, [ids[0]], 'k4').code, 'EVIDENCE.ALREADY_CONSUMED', 'a restart does not forget consumption')
  assert.equal(usableEvidence(L2, 'task-1', pol.policy, { types: ['delivery_verification'] }).length, 1, 'only the unconsumed single-use evidence remains usable'); L2.close(); void dir
})

test('concurrent consumption through two SQLite connections: exactly one consumer wins', () => {
  const { file, L, pol, ev } = setup(); const e = ev('delivery_verification'); assert.ok(acceptEvidence(L, e, { policy: pol.policy }).ok)
  const L2 = Ledger.open(file, { clock: () => NOW }); const id = e.payload.evidence_id
  const results = [consumeAll(L, [id], 'controller-A'), consumeAll(L2, [id], 'controller-B'), consumeAll(L, [id], 'controller-A2')]
  assert.equal(results.filter((r) => r.ok).length, 1); assert.deepEqual(results.filter((r) => !r.ok).map((r) => r.code), ['EVIDENCE.ALREADY_CONSUMED', 'EVIDENCE.ALREADY_CONSUMED'])
  L2.close(); L.close()
})

const intent = (L, pol, ids, over = {}) => beginIntent(L, { taskId: 'task-1', action: 'publish_candidate_branch', idempotencyKey: 'pub-1', params: { branch: 'feature/x' }, evidenceIds: ids, policy: pol.policy, candidateSha: HEAD, ...over })
const obs = (L, iid, over = {}) => { const i = getIntent(L, iid); return { state: 'absent', authoritative: true, observed_at: NOW, params_digest: i.params_digest, candidate_sha: i.candidate_sha, source: 'github.list_branches', ...over } }
/** the evidence kinds publish_candidate_branch REQUIRES (contract): task_authority + test_results */
const authz = (S) => ['task_authority', 'test_results'].map((t) => { const e = S.ev(t); assert.ok(acceptEvidence(S.L, e, { policy: S.pol.policy }).ok); return e.payload.evidence_id })
const ACTIVE = { activate: ['publish_candidate_branch'] }

test('action intents: idempotency, stale policy/candidate, evidence consumption in the SAME transaction, uncertain outcomes reconcile (explicit validated observation) before any retry', () => {
  const S = setup(ACTIVE); const { L, pol } = S; const ids = authz(S); const id = ids[0]; const D = { policy: pol.policy }
  assert.equal(intent(L, pol, ids, { policyRevision: 'f'.repeat(64) }).code, 'INTENT.STALE_POLICY_REVISION'); assert.equal(intent(L, pol, ids, { candidateSha: 'f'.repeat(40) }).code, 'INTENT.STALE_CANDIDATE')
  assert.equal(L.db.prepare('SELECT consumed_at FROM evidence WHERE evidence_id=?').get(id).consumed_at, null, 'refused intents consume nothing')
  assert.equal(intent(L, pol, ['ev-unknown']).code, 'EVIDENCE.UNKNOWN')
  const i1 = intent(L, pol, ids); assert.ok(i1.ok && !i1.duplicate); assert.notEqual(L.db.prepare('SELECT consumed_at FROM evidence WHERE evidence_id=?').get(id).consumed_at, null)
  const again = intent(L, pol, ids); assert.ok(again.ok && again.duplicate, 'same key + same params returns the same intent without consuming again')
  assert.equal(intent(L, pol, ids, { params: { branch: 'feature/other' } }).code, 'INTENT.IDEMPOTENCY_CONFLICT')
  const iid = i1.intent.intent_id
  assert.equal(recordOutcome(L, iid, { success: true }).code, 'INTENT.BAD_TRANSITION', 'cannot record an outcome before dispatch')
  assert.ok(markDispatched(L, iid, D).ok)
  // the controller dies after dispatching: restart marks it UNCERTAIN, never failed, never retried blindly
  assert.deepEqual(markDispatchedAsUncertain(L), [iid]); assert.equal(getIntent(L, iid).status, 'uncertain')
  assert.equal(retryIntent(L, iid, D).code, 'INTENT.NOT_RETRYABLE')
  const second = intent(L, pol, authz(S), { idempotencyKey: 'pub-2' }); assert.equal(second.code, 'INTENT.UNRECONCILED_PRIOR', 'a new attempt is refused until the prior effect is reconciled')
  assert.ok(intent(L, pol, [], { idempotencyKey: 'pub-1' }).must_reconcile)
  assert.equal(reconcileIntent(L, iid, { observation: 'absent' }).code, 'INTENT.RECONCILIATION_INCONCLUSIVE', 'a bare string is not an observation')
  assert.equal(reconcileIntent(L, iid, { observation: obs(L, iid) }).code, 'INTENT.RECONCILIATION_INCONCLUSIVE', 'D3.6: a caller-supplied object with authoritative:true is NOT an observation')
  assert.ok(proveAbsent(L, pol, iid, { reconcileIntent, getIntent }).ok); assert.equal(getIntent(L, iid).status, 'reconciled_absent') // D3.6: absence = two authenticated reads
  assert.ok(retryIntent(L, iid, D).ok); assert.ok(markDispatched(L, iid, D).ok); assert.ok(markUncertain(L, iid).ok); assert.ok(reconcileIntent(L, iid, { observation: signedObservation(pol, getIntent(L, iid), { state: 'present', observed_at: L.now() }), policy: pol.policy, outcome: { pr: 1 } }).ok)
  assert.equal(getIntent(L, iid).status, 'reconciled_succeeded'); assert.equal(retryIntent(L, iid, D).code, 'INTENT.NOT_RETRYABLE', 'a reconciled success is never retried')
  L.close()
})

test('intents refuse stale leases, cancelled tasks and unknown tasks', () => {
  const S = setup(ACTIVE); const { L, pol } = S
  const lease = L.acquireLease({ taskId: 'task-1', role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'high', ttlMs: 1000 }).lease
  assert.equal(intent(L, pol, authz(S), { lease: { ...lease, fencing_token: 9 }, idempotencyKey: 'a' }).code, 'LEASE.STALE_FENCING_TOKEN')
  assert.ok(intent(L, pol, authz(S), { lease, idempotencyKey: 'b' }).ok)
  assert.equal(beginIntent(L, { taskId: 'ghost', action: 'x', idempotencyKey: 'c', params: {}, policy: pol.policy, candidateSha: null }).code, 'TASK.UNKNOWN')
  L.closeLease(lease, { terminationVerified: true, endReason: 'x' }); L.cancel('task-1', { ownerActionId: 'owner-cancel-evidence-1' }) /* D3.6 integration (P6v3): cancellation is owner-only */
  assert.equal(intent(L, pol, [], { idempotencyKey: 'd' }).code, 'TASK.CANCELLED'); L.close()
})
