// D3.4 remediation F3 — the durable action-intent contract is revalidated at DISPATCH (not only at creation), reconciliation accepts only explicit validated observations,
// and a retry can never reuse expired/invalid authorization. No real GitHub side effect exists in D3.4: dispatch here only flips a ledger status. SIMULATED.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { acceptEvidence } from '../orchestrator/ledger/evidence-store.mjs'
import { beginIntent, getIntent, markDispatched, markUncertain, reconcileIntent, recordOutcome, retryIntent } from '../orchestrator/ledger/intents.mjs'
import { BASE, ENV_ID, HEAD, PATCH, REPO, TREE, buildPolicy, evidence, NOW, proveAbsent, signedObservation } from './helpers.mjs'

const ACTION = 'publish_candidate_branch' // safeguarded; required evidence: task_authority + test_results (contract); requires_activation
const AUTH = { allowed_paths: ['apps/mobile/**', 'supabase/migrations/**'], denied_paths: [] }
const HEAD2 = 'b'.repeat(40); const TREE2 = 'c'.repeat(40); const PATCH2 = 'd'.repeat(64)

function setup({ activate = [ACTION] } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dh34-f3-')); const clock = { t: NOW }
  const pol = buildPolicy({ activate }); const L = Ledger.open(path.join(dir, 'l.sqlite'), { clock: () => clock.t })
  const r = L.submitTask({ task_id: 'task-1', repository: REPO, base_sha: BASE, requirements: { text: 'r' }, scope: AUTH, acceptance: { criteria: ['c'] }, risk_class: 'routine', policy_revision: pol.policy.revision, environment_id: ENV_ID })
  assert.ok(r.ok); for (const s of ['queued', 'planning', 'implementing']) assert.ok(L.transition('task-1', s).ok)
  assert.ok(L.submitCandidate('task-1', { base_sha: BASE, candidate_sha: HEAD, tree_digest: TREE, patch_digest: PATCH }).ok)
  const ev = (type, over = {}, o = {}) => evidence(type, { policy: pol.policy, keys: pol.keys, over: { fencing_token: 1, issued_at: new Date(clock.t - 60_000).toISOString(), expires_at: new Date(clock.t + 3_000_000).toISOString(), ...over }, ...o })
  const fresh = () => { const out = []; for (const t of ['task_authority', 'test_results']) { const e = ev(t); assert.ok(acceptEvidence(L, e, { policy: pol.policy }).ok, t); out.push(e.payload.evidence_id) } return out }
  return { L, pol, clock, ev, fresh, policy: pol.policy }
}
const begin = (S, ids, over = {}) => beginIntent(S.L, { taskId: 'task-1', action: ACTION, idempotencyKey: 'pub-1', params: { branch: 'feature/x' }, evidenceIds: ids, policy: S.policy, candidateSha: HEAD, ...over })
const dispatch = (S, id, o = {}) => markDispatched(S.L, id, { policy: S.policy, ...o })
const OBS = (i, over = {}) => ({ state: 'absent', authoritative: true, observed_at: NOW, params_digest: i.params_digest, candidate_sha: i.candidate_sha, source: 'github.list_branches', ...over })

test('F3: an intent created BEFORE a candidate change is no longer dispatchable (stale candidate and invalidated evidence)', () => {
  const S = setup(); const ids = S.fresh(); const i = begin(S, ids); assert.ok(i.ok); const iid = i.intent.intent_id
  assert.ok(S.L.submitCandidate('task-1', { base_sha: BASE, candidate_sha: HEAD2, tree_digest: TREE2, patch_digest: PATCH2 }).ok) // head_changed
  const r = dispatch(S, iid); assert.equal(r.ok, false); assert.ok(['INTENT.STALE_CANDIDATE', 'EVIDENCE.INVALIDATED'].includes(r.code), r.code); assert.equal(getIntent(S.L, iid).status, 'intended', 'a refused dispatch changes nothing')
  assert.equal(begin(S, [], { idempotencyKey: 'pub-2' }).code, 'INTENT.STALE_CANDIDATE', 'and a new intent for the OLD head is refused'); S.L.close()
})

test('F3: same head SHA but a different TREE identity is refused at dispatch (candidate identity is sha + tree)', () => {
  const S = setup(); const i = begin(S, S.fresh()); assert.ok(i.ok); S.L.db.exec("UPDATE candidates SET tree_digest='" + TREE2 + "' WHERE superseded=0")
  assert.equal(dispatch(S, i.intent.intent_id).code, 'INTENT.STALE_TREE'); S.L.close()
})

test('F3: a policy-revision change makes pending intents undispatchable (and invalidates their evidence)', () => {
  const S = setup(); const i = begin(S, S.fresh()); assert.ok(i.ok)
  const r = S.L.applyLifecycleEvent('task-1', S.L.eventFor('task-1', 'policy_changed', { policy_revision: 'e'.repeat(64) })); assert.ok(r.ok)
  const d = dispatch(S, i.intent.intent_id); assert.equal(d.ok, false); assert.ok(['INTENT.STALE_POLICY_REVISION', 'EVIDENCE.INVALIDATED'].includes(d.code), d.code)
  const other = buildPolicy({ activate: [ACTION], parent: S.policy.revision }); assert.equal(markDispatched(S.L, i.intent.intent_id, { policy: other.policy }).ok, false, 'a different ACTIVE policy than the intent was authorized under never dispatches'); S.L.close()
})

test('F3: cancellation after intent creation blocks dispatch; a duplicate begin of a cancelled task is not "ok" either', () => {
  const S = setup(); const i = begin(S, S.fresh()); assert.ok(i.ok); S.L.cancel('task-1')
  assert.equal(dispatch(S, i.intent.intent_id).code, 'TASK.CANCELLED'); assert.equal(begin(S, [], { idempotencyKey: 'pub-1' }).code, 'TASK.CANCELLED', 'a replay of the creation call does not smuggle a cancelled task through'); S.L.close()
})

test('F3: expired evidence blocks dispatch (checked at dispatch time, not only at creation)', () => {
  const S = setup(); const i = begin(S, S.fresh()); assert.ok(i.ok); S.clock.t += 3_100_000
  assert.equal(dispatch(S, i.intent.intent_id).code, 'EVIDENCE.EXPIRED'); assert.equal(getIntent(S.L, i.intent.intent_id).status, 'intended'); S.L.close()
})

test('F3: a stale or foreign lease cannot dispatch; the intent is bound to the lease that created it', () => {
  const S = setup(); const lease = S.L.acquireLease({ taskId: 'task-1', role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'high', ttlMs: 600_000 }).lease
  const i = begin(S, S.fresh(), { lease }); assert.ok(i.ok); const iid = i.intent.intent_id
  assert.equal(dispatch(S, iid).code, 'INTENT.LEASE_REQUIRED', 'no lease presented'); assert.equal(dispatch(S, iid, { lease: { ...lease, fencing_token: 9 } }).code, 'LEASE.STALE_FENCING_TOKEN')
  S.L.closeLease(lease, { terminationVerified: true, endReason: 'x' }); assert.equal(dispatch(S, iid, { lease }).code, 'LEASE.NOT_ACTIVE'); S.L.close()
})

test('F3: a fencing-epoch change (recovery) makes the intent undispatchable until re-authorized', () => {
  const S = setup(); const i = begin(S, S.fresh()); assert.ok(i.ok); const lease = S.L.acquireLease({ taskId: 'task-1', role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'high' }).lease; void lease
  assert.ok(S.L.supersedeLease({ guestCleanupVerified: true }).ok); const d = dispatch(S, i.intent.intent_id); assert.equal(d.ok, false); assert.ok(['INTENT.STALE_FENCING_TOKEN', 'EVIDENCE.STALE_FENCING_TOKEN'].includes(d.code), d.code); S.L.close()
})

test('F3: the action must be AUTHORIZED by the right evidence and be ACTIVE: wrong evidence types, prohibited/unknown actions and inactive actions never dispatch', () => {
  const S = setup(); const wrong = S.ev('delivery_verification'); assert.ok(acceptEvidence(S.L, wrong, { policy: S.policy }).ok)
  assert.equal(begin(S, [wrong.payload.evidence_id]).code, 'INTENT.EVIDENCE_NOT_AUTHORIZING_ACTION', 'delivery_verification is not what publish_candidate_branch requires')
  assert.equal(begin(S, S.fresh(), { action: 'no_such_action', idempotencyKey: 'u' }).code, 'INTENT.UNKNOWN_ACTION'); assert.equal(begin(S, [], { action: 'merge_pull_request_unattended', idempotencyKey: 'u2' }).code, 'INTENT.UNKNOWN_ACTION')
  const prohibited = Object.entries(S.policy.contract.actions).find(([, a]) => a.class === 'prohibited')?.[0]; assert.ok(prohibited); assert.equal(begin(S, [], { action: prohibited, idempotencyKey: 'u3' }).code, 'INTENT.ACTION_PROHIBITED')
  S.L.close()
  const I = setup({ activate: [] }); const i = begin(I, I.fresh()); assert.ok(i.ok, 'an intent may be RECORDED for an inactive action'); assert.equal(dispatch(I, i.intent.intent_id).code, 'INTENT.ACTION_NOT_ACTIVE', 'but it can never be dispatched in D3.4 (no action is active)'); I.L.close()
})

test('F3: reconciliation accepts ONLY explicit, validated, authoritative observations — unknown/malformed/unavailable/ambiguous stay UNCERTAIN and never authorize a retry', () => {
  const S = setup(); const i = begin(S, S.fresh()); const iid = i.intent.intent_id; const row = getIntent(S.L, iid); assert.ok(dispatch(S, iid).ok); assert.ok(markUncertain(S.L, iid).ok)
  const bad = [undefined, null, 'absent', 'present', 'unknown', 42, {}, { state: 'maybe' }, { ...OBS(row), state: 'unknown' }, { ...OBS(row), authoritative: false }, { ...OBS(row), authoritative: 'yes' }, { ...OBS(row), observed_at: Number.NaN }, { ...OBS(row), observed_at: NOW + 99_999_999 },
    { ...OBS(row), observed_at: row.created_at - 5 }, { ...OBS(row), params_digest: 'f'.repeat(64) }, { ...OBS(row), candidate_sha: HEAD2 }, { ...OBS(row), source: '' }, { ...OBS(row), source: 5 }, { ...OBS(row), unavailable: true }, { ...OBS(row), state: 'present', pr: null }]
  for (const o of bad) { const r = reconcileIntent(S.L, iid, { observation: o }); assert.equal(r.ok, false, JSON.stringify(o)); assert.equal(r.code, 'INTENT.RECONCILIATION_INCONCLUSIVE'); assert.equal(getIntent(S.L, iid).status, 'uncertain') }
  assert.equal(retryIntent(S.L, iid, { policy: S.policy }).code, 'INTENT.NOT_RETRYABLE'); assert.equal(begin(S, S.fresh(), { idempotencyKey: 'pub-2' }).code, 'INTENT.UNRECONCILED_PRIOR')
  assert.equal(reconcileIntent(S.L, iid, { observation: OBS(row) }).problems[0], 'OBSERVATION.UNAUTHENTICATED', 'D3.6: even the well-formed caller object is not an observation')
  assert.ok(proveAbsent(S.L, S.pol, iid, { reconcileIntent, getIntent }).ok); assert.equal(getIntent(S.L, iid).status, 'reconciled_absent', 'D3.6: absence = two authenticated reads'); S.L.close()
})

test('F3: a retry re-validates EVERYTHING; expired or invalid authorization is never reused, and a NEW authorized intent supersedes the old reconciled one without re-consuming single-use evidence', () => {
  const S = setup(); const ids = S.fresh(); const i = begin(S, ids); const iid = i.intent.intent_id; const row = getIntent(S.L, iid)
  assert.ok(dispatch(S, iid).ok); assert.equal(recordOutcome(S.L, iid, { success: false, outcome: { error: 'timeout' } }).status, 'uncertain', 'D3.6: a timeout is UNCERTAIN, never proof of absence'); assert.ok(proveAbsent(S.L, S.pol, iid, { reconcileIntent, getIntent }).ok); assert.equal(getIntent(S.L, iid).status, 'reconciled_absent')
  assert.ok(retryIntent(S.L, iid, { policy: S.policy }).ok, 'still-valid authorization may be retried after a proven-absent/failed effect'); assert.ok(dispatch(S, iid).ok); assert.ok(markUncertain(S.L, iid).ok)
  assert.ok(proveAbsent(S.L, S.pol, iid, { reconcileIntent, getIntent }).ok); S.clock.t = S.L.now() + 3_100_000; S.L.clock = () => S.clock.t // the authorization EXPIRES while the effect was being reconciled
  const r = retryIntent(S.L, iid, { policy: S.policy }); assert.equal(r.ok, false); assert.equal(r.code, 'EVIDENCE.EXPIRED'); assert.equal(getIntent(S.L, iid).status, 'reconciled_absent', 'refused retry changes nothing')
  assert.equal(begin(S, ids, { idempotencyKey: 'pub-2', supersedes: iid }).code, 'EVIDENCE.ALREADY_CONSUMED', 'single-use semantics intact: the old evidence is not re-consumed')
  const fresh = S.fresh(); const n = begin(S, fresh, { idempotencyKey: 'pub-2', supersedes: iid }); assert.ok(n.ok, JSON.stringify(n)); assert.equal(getIntent(S.L, iid).superseded_by, n.intent.intent_id); assert.equal(retryIntent(S.L, iid, { policy: S.policy }).code, 'INTENT.NOT_RETRYABLE', 'a superseded intent is dead')
  assert.ok(dispatch(S, n.intent.intent_id).ok); S.L.close()
})

test('F3: supersession is only legal over a PROVEN-absent (or failed) intent — never over uncertain, dispatched, succeeded or a foreign task\'s intent', () => {
  const S = setup(); const i = begin(S, S.fresh()); const iid = i.intent.intent_id
  assert.equal(begin(S, S.fresh(), { idempotencyKey: 'n1', supersedes: iid }).code, 'INTENT.UNRECONCILED_PRIOR', 'intended is not supersedable'); assert.ok(dispatch(S, iid).ok)
  assert.equal(begin(S, S.fresh(), { idempotencyKey: 'n2', supersedes: iid }).code, 'INTENT.UNRECONCILED_PRIOR'); assert.ok(recordOutcome(S.L, iid, { success: true, outcome: { pr: 7 } }).ok)
  assert.equal(begin(S, S.fresh(), { idempotencyKey: 'n3', supersedes: iid }).code, 'INTENT.EFFECT_ALREADY_APPLIED', 'a succeeded effect is never repeated under a new key')
  assert.equal(begin(S, S.fresh(), { idempotencyKey: 'n4', supersedes: 'in-nope' }).code, 'INTENT.SUPERSEDES_UNKNOWN'); S.L.close()
})

test('F3: reconciling a PRESENT effect records success and a retry of it is refused forever', () => {
  const S = setup(); const i = begin(S, S.fresh()); const iid = i.intent.intent_id; const row = getIntent(S.L, iid); assert.ok(dispatch(S, iid).ok); assert.ok(markUncertain(S.L, iid).ok)
  assert.ok(reconcileIntent(S.L, iid, { observation: signedObservation(S.pol, row, { state: 'present', observed_at: S.L.now() }), policy: S.policy, outcome: { pr: 3 } }).ok); assert.equal(getIntent(S.L, iid).status, 'reconciled_succeeded'); assert.equal(retryIntent(S.L, iid, { policy: S.policy }).code, 'INTENT.NOT_RETRYABLE'); S.L.close()
})

test('F3/F5/F6/F4 schema: a V1 ledger migrates to V2 in place (data kept, constraints widened, new tables present) and V2 is readable by the read-only issuer handle', async () => {
  const { DatabaseSync } = await import('node:sqlite'); const { MIGRATIONS, LEDGER_APPLICATION_ID } = await import('../orchestrator/ledger/schema.mjs')
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'dh34-mig-')), 'v1.sqlite'); const raw = new DatabaseSync(file)
  raw.exec(MIGRATIONS[0].sql); raw.exec(`PRAGMA application_id = ${LEDGER_APPLICATION_ID}; PRAGMA user_version = 1`)
  raw.prepare("INSERT INTO outbox(task_id,kind,dedupe_key,payload_json,status,attempts,next_attempt_at,created_at) VALUES (NULL,'handoff_ready','old-1','{}','sent',1,5,5)").run(); raw.close()
  const L = Ledger.open(file, { clock: () => NOW }); assert.equal(L.db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length)
  assert.equal(L.db.prepare("SELECT dedupe_key FROM outbox WHERE outbox_id=1").get().dedupe_key, 'old-1', 'existing outbox rows survive the rebuild')
  L.db.prepare("INSERT INTO outbox(task_id,kind,dedupe_key,payload_json,status,attempts,next_attempt_at,created_at) VALUES (NULL,'technical_suspension','new-1','{}','pending',0,0,0)").run() // the widened CHECK
  assert.throws(() => L.db.prepare("INSERT INTO outbox(task_id,kind,dedupe_key,payload_json,status,attempts,next_attempt_at,created_at) VALUES (NULL,'surprise','new-2','{}','pending',0,0,0)").run(), /CHECK/, 'but it is still a closed set')
  for (const t of ['suspensions', 'review_deliverables', 'coverage']) assert.ok(L.db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(t), t)
  assert.deepEqual(L.db.prepare("SELECT name FROM pragma_table_info('action_intents') WHERE name IN ('tree_digest','lease_id','superseded_by','supersedes') ORDER BY name").all().map((r) => r.name), ['lease_id', 'superseded_by', 'supersedes', 'tree_digest'])
  L.close(); const ro = Ledger.openReadOnly(file, { clock: () => NOW }); assert.equal(ro.db.prepare('SELECT COUNT(*) c FROM outbox').get().c, 2); ro.close()
})

test('F3: duplicate evidence ids in one intent are ONE authorization, not a consumption race', () => {
  const S = setup(); const ids = S.fresh(); const i = begin(S, [...ids, ...ids]); assert.ok(i.ok, JSON.stringify(i)); assert.equal(JSON.parse(i.intent.evidence_ids_json).length, 2); assert.ok(dispatch(S, i.intent.intent_id).ok); S.L.close()
})

test('R3-5: the EFFECT is unique, not only its authorization: two intents of one effect cannot both be in flight, a failed sibling must be superseded explicitly, and a succeeded effect is never fired again via a retry', () => {
  const S = setup(); const a = begin(S, S.fresh(), { idempotencyKey: 'A' }); const b = begin(S, S.fresh(), { idempotencyKey: 'B' }); assert.ok(a.ok && b.ok, 'both may be RECORDED')
  assert.ok(dispatch(S, a.intent.intent_id).ok); assert.equal(dispatch(S, b.intent.intent_id).code, 'INTENT.EFFECT_NOT_UNIQUE', 'the second is refused while the first is in flight')
  assert.ok(recordOutcome(S.L, a.intent.intent_id, { success: false, outcome: { error: 'timeout' } }).ok); assert.equal(dispatch(S, b.intent.intent_id).code, 'INTENT.EFFECT_NOT_UNIQUE', 'D3.6: an UNCERTAIN effect still blocks its sibling')
  assert.ok(proveAbsent(S.L, S.pol, a.intent.intent_id, { reconcileIntent, getIntent }).ok); assert.ok(dispatch(S, b.intent.intent_id).ok); assert.ok(recordOutcome(S.L, b.intent.intent_id, { success: true, outcome: { pr: 1 } }).ok)
  assert.equal(retryIntent(S.L, a.intent.intent_id, { policy: S.policy }).code, 'INTENT.EFFECT_NOT_UNIQUE', 'A (failed) can no longer re-fire an effect B already achieved')
  assert.throws(() => S.L.db.exec("UPDATE action_intents SET status='dispatched'"), /UNIQUE|constraint/i, 'and the database itself refuses two in-flight effects'); S.L.close()
  const T = setup(); const c = begin(T, T.fresh(), { idempotencyKey: 'C' }); assert.ok(dispatch(T, c.intent.intent_id).ok); assert.ok(recordOutcome(T.L, c.intent.intent_id, { success: false, outcome: {} }).ok); assert.ok(proveAbsent(T.L, T.pol, c.intent.intent_id, { reconcileIntent, getIntent }).ok)
  assert.equal(begin(T, T.fresh(), { idempotencyKey: 'D' }).code, 'INTENT.SIBLING_NOT_SUPERSEDED'); assert.ok(begin(T, T.fresh(), { idempotencyKey: 'D', supersedes: c.intent.intent_id }).ok); T.L.close()
})
