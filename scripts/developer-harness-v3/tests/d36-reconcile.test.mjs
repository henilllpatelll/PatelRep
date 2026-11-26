// D3.6-D — durable remote effects and AUTHENTICATED reconciliation. A failure, timeout, lost response or crash never proves absence; only signed, fresh, subject-bound reads do,
// and absence needs several of them. SIMULATED: the remote is the simulated GitHub world; crashes are injected (SimCrash) and the controller is re-opened on the same files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyRemoteObservation, OBSERVATION_DOMAIN, ABSENCE_RULE } from '../orchestrator/delivery/observation.mjs'
import { getIntent, reconcileIntent, recordOutcome } from '../orchestrator/ledger/intents.mjs'
import { sealAfterRestore } from '../orchestrator/ledger/disaster-recovery.mjs'
import { SIGNING_DOMAIN } from '../authority/evidence.mjs'
import { harness, intents, observe, ops, signObservation, state, tmp, toHandoff, untilState } from './d36-helpers.mjs'

const toEligible = (h, id, max = 300) => h.drive({ until: untilState(h, id, 'merge_eligible'), maxRounds: max })
const pushIntent = (h, id) => intents(h, id).find((i) => i.action === 'publish_candidate_branch')

test('observations are accepted ONLY when signed by the policy-pinned READER, under the observation domain, fresh, and about the expected subject', async () => {
  const h = await harness(); const id = h.submit()
  const good = await h.issuers.delivery_verifier.handle('observe_main', {}); assert.ok(good.ok)
  const now = () => h.ledger.now(); const v = (env, expect = {}) => verifyRemoteObservation(env, { policy: h.policy, now: now(), expect })
  assert.ok(v(good.envelope).ok)
  const p = good.envelope.payload
  assert.deepEqual(v(signObservation(h, 'trusted_publisher', p)).problems, ['OBSERVATION.KEY_NOT_A_READER'], 'another identity\'s key, right domain')
  assert.ok(v(signObservation(h, 'delivery_verifier', p, { domain: SIGNING_DOMAIN })).problems.includes('OBSERVATION.BAD_SIGNATURE'), 'the reader key under the EVIDENCE domain is not an observation (no cross-protocol replay)')
  const tampered = structuredClone(good.envelope); tampered.payload.details.sha = 'f'.repeat(40); assert.ok(v(tampered).problems.includes('OBSERVATION.BAD_SIGNATURE'))
  const unknown = structuredClone(good.envelope); unknown.signature.key_id = 'test-nope'; assert.ok(v(unknown).problems.includes('OBSERVATION.UNKNOWN_KEY'))
  assert.ok(v(good.envelope, { subject: 'ref:other' }).problems.includes('OBSERVATION.WRONG_SUBJECT'))
  assert.ok(verifyRemoteObservation(good.envelope, { policy: h.policy, now: now() + 11 * 60_000 }).problems.includes('OBSERVATION.STALE'))
  assert.ok(v(signObservation(h, 'delivery_verifier', { ...p, observed_at: now() + 5 * 60_000 })).problems.includes('OBSERVATION.FROM_THE_FUTURE'))
  assert.ok(v(signObservation(h, 'delivery_verifier', { ...p, policy_revision: 'e'.repeat(64) })).problems.includes('OBSERVATION.WRONG_POLICY_REVISION'))
  assert.deepEqual(v({ state: 'present', authoritative: true }).problems, ['OBSERVATION.MALFORMED'])
  void id; void OBSERVATION_DOMAIN; h.close()
})

test('reconcileIntent accepts nothing but a VERIFIED observation of THIS effect: a copied object with authoritative:true, another intent, another candidate or a pre-dispatch read are inconclusive', async () => {
  const h = await harness(); const id = h.submit(); h.github.inject('push_ref', 'lose_response')
  await h.drive({ until: () => pushIntent(h, id)?.status === 'uncertain', maxRounds: 100 })
  const i = pushIntent(h, id); assert.equal(i.status, 'uncertain', 'a lost response is UNCERTAIN, never failed')
  const o = await observe(h, 'observe_intent', { intent_id: i.intent_id }); assert.ok(o.ok)
  const copy = { ...o.observation, authoritative: true }
  assert.deepEqual(reconcileIntent(h.ledger, i.intent_id, { observation: copy }).problems, ['OBSERVATION.UNAUTHENTICATED'], 'the same fields, unbranded: refused')
  assert.deepEqual(reconcileIntent(h.ledger, i.intent_id, { observation: { state: 'present', authoritative: true, observed_at: h.ledger.now(), params_digest: i.params_digest, candidate_sha: i.candidate_sha, source: 'github' } }).problems, ['OBSERVATION.UNAUTHENTICATED'])
  const other = await observe(h, 'observe_main', {}); assert.ok(other.ok); assert.ok(reconcileIntent(h.ledger, i.intent_id, { observation: other.observation }).problems.includes('OBSERVATION.WRONG_SUBJECT'))
  assert.equal(getIntent(h.ledger, i.intent_id).status, 'uncertain')
  assert.ok(reconcileIntent(h.ledger, i.intent_id, { observation: o.observation }).ok, 'the authenticated observation of this effect reconciles it'); assert.equal(getIntent(h.ledger, i.intent_id).status, 'reconciled_succeeded')
  assert.equal(reconcileIntent(h.ledger, i.intent_id, { observation: o.observation }).code, 'INTENT.BAD_TRANSITION', 'a duplicate (replayed) observation changes nothing'); h.close()
})

test('lost successful response: the push happened, the response was lost -> UNCERTAIN -> reconciled PRESENT -> delivery continues; the effect happened EXACTLY once', async () => {
  const h = await harness(); const id = h.submit(); h.github.inject('push_ref', 'lose_response')
  assert.ok((await toEligible(h, id)).done); assert.equal(state(h, id), 'merge_eligible')
  assert.equal(ops(h, 'push_ref').length, 1, 'never pushed twice'); assert.equal(pushIntent(h, id).status, 'reconciled_succeeded')
  assert.equal(ops(h, 'create_pull').length, 1); h.close()
})

test('a rejection BEFORE the effect is not trusted as absence either: UNCERTAIN until several authenticated reads prove it absent, then ONE retry under re-validated authorization', async () => {
  for (const fault of ['reject', 'timeout_before']) {
    const h = await harness(); const id = h.submit(); h.github.inject('push_ref', fault)
    assert.ok((await toEligible(h, id)).done, fault)
    const i = pushIntent(h, id); assert.equal(i.status, 'succeeded', `${fault}: retried once absence was proven`)
    const reads = h.ledger.db.prepare("SELECT state, read_id, observed_at FROM remote_observations WHERE intent_id=? AND state='absent'").all(i.intent_id)
    assert.ok(new Set(reads.map((r) => r.read_id)).size >= ABSENCE_RULE.minReads, `${fault}: absence needed ${ABSENCE_RULE.minReads}+ distinct reads`)
    assert.ok(reads.every((r) => r.observed_at >= i.created_at), 'every read is after the dispatch')
    assert.equal(ops(h, 'push_ref').length, 1, `${fault}: exactly one effective push`); h.close()
  }
})

test('a single inconclusive (eventually consistent) lookup never proves absence: a PR created before a lost response is not created again while it is still invisible to reads', async () => {
  const h = await harness({ gh: { readLagMs: 3 * 60_000 } }); const id = h.submit(); h.github.inject('create_pull', 'lose_response')
  assert.ok((await toEligible(h, id, 400)).done, 'delivered once the PR became visible')
  assert.equal(h.github.s.prs.length, 1, 'ONE PR'); assert.ok(ops(h, 'create_pull').length <= 2, 'a retry after a stale "absent" is refused by the remote itself (one open PR per head)')
  const pr = intents(h, id).filter((i) => i.action === 'open_draft_pull_request'); assert.ok(pr.some((i) => ['succeeded', 'reconciled_succeeded'].includes(i.status))); h.close()
})

test('crash AFTER the remote effect, before the outcome is persisted: the restarted controller marks it uncertain, reconciles PRESENT, never repeats it', async () => {
  const root = tmp(); const h = await harness({ root }); const id = h.submit(); h.github.inject('push_ref', 'crash_after')
  await assert.rejects(h.drive({ until: () => false, maxRounds: 100 }), /SIM\.CRASH_AFTER_EFFECT/); const clock = h.clock; h.close()
  const h2 = await harness({ root, clock }); assert.equal(pushIntent(h2, id).status, 'dispatched', 'the ledger shows a dispatch with no outcome')
  assert.ok((await toEligible(h2, id)).done); assert.equal(pushIntent(h2, id).status, 'reconciled_succeeded'); assert.equal(ops(h2, 'push_ref').length, 1); h2.close()
})

test('crash BEFORE any effect (after sending), and crash before dispatch: the restart reconciles ABSENT (or simply dispatches the still-intended intent) and the effect happens exactly once', async () => {
  { const root = tmp(); const h = await harness({ root }); const id = h.submit(); h.github.inject('push_ref', 'crash_before')
    await assert.rejects(h.drive({ until: () => false, maxRounds: 100 }), /SIM\.CRASH/); const clock = h.clock; h.close()
    const h2 = await harness({ root, clock }); assert.ok((await toEligible(h2, id)).done); assert.equal(ops(h2, 'push_ref').length, 1); assert.equal(pushIntent(h2, id).status, 'succeeded', 'proven absent, then retried once'); h2.close() }
  { const root = tmp(); const h = await harness({ root }); const id = h.submit()
    const { authorizeIntent } = await import('../orchestrator/delivery/authorize.mjs'); const { ensureDelivery } = await import('../orchestrator/delivery/state.mjs')
    await h.drive({ until: () => h.ledger.getTask(id).handoff_ready === 1, maxRounds: 100 }); const d = ensureDelivery(h.ledger, id)
    assert.ok((await h.delivery.accept(h.issuers.task_ingress, 'issue_task_authority', { task_id: id })).ok)
    const t = h.ledger.getTask(id); const params = { repository: t.repository, branch: d.branch, sha: t.head_sha, expected_old: null }
    assert.ok((await authorizeIntent(h.delivery.ctx(), { taskId: id, action: 'publish_candidate_branch', idempotencyKey: `publish:${id}:${t.head_sha}`, params, evaluatorParams: h.delivery.evaluatorParams('publish_candidate_branch', params) })).ok)
    const clock = h.clock; h.close() // "crash" with the intent recorded, never dispatched
    const h2 = await harness({ root, clock }); assert.ok((await toEligible(h2, id)).done); assert.equal(ops(h2, 'push_ref').length, 1); assert.equal(intents(h2, id).filter((i) => i.action === 'publish_candidate_branch').length, 1, 'the same intent, not a second one'); h2.close() }
})

test('crash DURING reconciliation: the authenticated reads are durable, so the absence rule spans the restart (no read is lost, none is double-counted)', async () => {
  const root = tmp(); const h = await harness({ root }); const id = h.submit(); h.github.inject('push_ref', 'reject')
  await h.drive({ until: () => (h.ledger.db.prepare("SELECT COUNT(*) c FROM remote_observations WHERE state='absent'").get().c >= 1), maxRounds: 200 })
  const before = h.ledger.db.prepare("SELECT COUNT(*) c FROM remote_observations").get().c; assert.ok(before >= 1); const clock = h.clock; h.close()
  const h2 = await harness({ root, clock }); assert.equal(h2.ledger.db.prepare('SELECT COUNT(*) c FROM remote_observations').get().c, before, 'the recorded reads survived')
  assert.ok((await toEligible(h2, id)).done); assert.equal(ops(h2, 'push_ref').length, 1); h2.close()
})

test('ledger restore: sealing makes every unfinished intent UNCERTAIN; reconciliation from authenticated reads settles it without repeating the effect', async () => {
  const h = await harness(); const id = h.submit(); h.github.inject('push_ref', 'lose_response')
  await h.drive({ until: () => pushIntent(h, id)?.status === 'uncertain', maxRounds: 100 })
  sealAfterRestore(h.ledger, { manifest: { sha256: 'a'.repeat(64), file: 'simulated-backup', authority_seq: 1 } })
  const i = pushIntent(h, id); assert.equal(i.status, 'uncertain')
  const o = await observe(h, 'observe_intent', { intent_id: i.intent_id }); assert.ok(o.ok); assert.equal(o.observation.state, 'present')
  assert.ok(reconcileIntent(h.ledger, i.intent_id, { observation: o.observation }).ok); assert.equal(pushIntent(h, id).status, 'reconciled_succeeded'); assert.equal(ops(h, 'push_ref').length, 1); h.close()
})

test('remote conflict (the remote shows NEITHER our effect nor its absence: a foreign PR on the task branch) stays uncertain and becomes ONE owner decision — never adopted, never overwritten', async () => {
  const h = await harness(); const id = h.submit(); h.github.inject('create_pull', 'lose_response')
  await h.drive({ until: () => intents(h, id).some((i) => i.action === 'open_draft_pull_request' && i.status === 'uncertain'), maxRounds: 150 })
  const pr = h.github.s.prs[0]; pr.author = 'someone-else'; h.github.save() // the remote now shows a PR that is not the one our publisher created
  await h.drive({ until: () => state(h, id) === 'blocked', maxRounds: 50 })
  assert.equal(state(h, id), 'blocked'); assert.ok(JSON.stringify(h.ledger.getWait(id)).includes('DELIVERY_REMOTE_CONFLICT'), JSON.stringify(h.ledger.getWait(id)))
  assert.equal(intents(h, id).find((i) => i.action === 'open_draft_pull_request').status, 'uncertain', 'it is never assumed either way'); h.close()
})

test('recordOutcome: only an AUTHENTICATED rejection-before-effect makes a failure retryable; every other failure is uncertain', async () => {
  const h = await harness(); const id = h.submit(); h.github.inject('push_ref', 'lose_response')
  await h.drive({ until: () => pushIntent(h, id)?.status === 'uncertain', maxRounds: 100 })
  const i = pushIntent(h, id)
  h.ledger.db.prepare("UPDATE action_intents SET status='dispatched' WHERE intent_id=?").run(i.intent_id) // fixture: replay the moment the response arrives
  const base = { ...(await observe(h, 'observe_intent', { intent_id: i.intent_id })).observation }
  assert.equal(recordOutcome(h.ledger, i.intent_id, { success: false, rejection: { ...base, state: 'rejected' } }).status, 'uncertain', 'an unbranded "rejected" object is not proof')
  h.ledger.db.prepare("UPDATE action_intents SET status='dispatched' WHERE intent_id=?").run(i.intent_id)
  const { key_id: _k, ...fields } = base; void _k
  const signed = verifyRemoteObservation(signObservation(h, 'delivery_verifier', { ...fields, observation_id: 'obs-rejected-1', read_id: 'read-rejected-1', state: 'rejected', details: {} }), { policy: h.policy, now: h.ledger.now() })
  assert.ok(signed.ok, JSON.stringify(signed.problems))
  assert.equal(recordOutcome(h.ledger, i.intent_id, { success: false, rejection: signed.observation }).status, 'failed', 'a signed, bound rejection-before-effect is the ONLY way to `failed`')
  assert.equal(getIntent(h.ledger, i.intent_id).status, 'failed'); h.close()
})

test('review M2: an effect key always resumes the LIVE head of its supersession chain (a superseded intent never hides its successor\'s outcome)', async () => {
  const h = await harness(); const id = h.submit()
  const { authorizeIntent } = await import('../orchestrator/delivery/authorize.mjs'); const { ensureDelivery } = await import('../orchestrator/delivery/state.mjs')
  await toHandoff(h, id); const d = ensureDelivery(h.ledger, id) // engine only: nothing published yet
  assert.ok((await h.delivery.accept(h.issuers.task_ingress, 'issue_task_authority', { task_id: id })).ok)
  const t = h.ledger.getTask(id); const params = { repository: t.repository, branch: d.branch, sha: t.head_sha, expected_old: null }
  const mk = (key, supersedes = null) => authorizeIntent(h.delivery.ctx(), { taskId: id, action: 'publish_candidate_branch', idempotencyKey: key, params, evaluatorParams: h.delivery.evaluatorParams('publish_candidate_branch', params), supersedes })
  const A = await mk('chain-A'); assert.ok(A.ok); h.ledger.db.prepare("UPDATE action_intents SET status='reconciled_absent' WHERE intent_id=?").run(A.intent.intent_id) // fixture: A proven absent
  const B = await mk('chain-A#s1', A.intent.intent_id); assert.ok(B.ok, JSON.stringify(B)); h.ledger.db.prepare("UPDATE action_intents SET status='succeeded' WHERE intent_id=?").run(B.intent.intent_id) // fixture: its successor succeeded
  const r = await h.delivery.resume(getIntent(h.ledger, A.intent.intent_id), params)
  assert.equal(r.status, 'succeeded'); assert.equal(r.intent_id, B.intent.intent_id); assert.equal(ops(h, 'push_ref').length, 0, 'nothing re-sent'); h.close()
})

test('security review MAND-1: absence is NEVER concluded while this process\'s own timed-out request for the effect has not settled; once it settles, the reads decide', async () => {
  const h = await harness(); const id = h.submit(); h.github.inject('push_ref', 'lose_response')
  await h.drive({ until: () => intents(h, id).some((i) => i.action === 'publish_candidate_branch' && i.status === 'uncertain'), maxRounds: 100 })
  const i = intents(h, id).find((x) => x.action === 'publish_candidate_branch')
  h.ledger.db.prepare("INSERT INTO operation_deadlines(op_id,task_id,kind,started_at,deadline_at,state,holds_json) VALUES (?,?,?,?,?,'unresolved','[]')").run(`effect:${i.intent_id}:x`, id, 'effect:publish_candidate_branch', 1, 2) // the call outlived its deadline and never settled
  const { key_id: _k, ...base } = (await observe(h, 'observe_intent', { intent_id: i.intent_id })).observation; void _k
  let last = null
  for (const k of [0, 1]) { h.clock.advance(61_000 + k * 31_000); const o = verifyRemoteObservation(signObservation(h, 'delivery_verifier', { ...base, observation_id: `obs-m1-${k}`, read_id: `read-m1-${k}`, state: 'absent', observed_at: h.ledger.now(), details: {} }), { policy: h.policy, now: h.ledger.now() }); assert.ok(o.ok); last = reconcileIntent(h.ledger, i.intent_id, { observation: o.observation }) }
  assert.equal(last.code, 'INTENT.RECONCILIATION_PENDING'); assert.deepEqual(last.problems, ['OBSERVATION.EFFECT_STILL_IN_FLIGHT']); assert.equal(getIntent(h.ledger, i.intent_id).status, 'uncertain')
  h.ledger.db.prepare("UPDATE operation_deadlines SET state='settled_late' WHERE op_id=?").run(`effect:${i.intent_id}:x`)
  h.clock.advance(31_000); const o3 = verifyRemoteObservation(signObservation(h, 'delivery_verifier', { ...base, observation_id: 'obs-m1-2', read_id: 'read-m1-2', state: 'absent', observed_at: h.ledger.now(), details: {} }), { policy: h.policy, now: h.ledger.now() })
  assert.ok(reconcileIntent(h.ledger, i.intent_id, { observation: o3.observation }).ok, 'after its own settlement the authenticated reads decide'); h.close()
})
