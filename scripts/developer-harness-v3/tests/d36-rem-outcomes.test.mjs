// D3.6 remediation F2 — remote outcomes and the reconciliation boundary. SIMULATED remote (no GitHub), temp ledgers, test keys. A direct response is success ONLY with the action-specific
// positive confirmation; an observation proves ABSENCE only when taken AFTER the end of the request (ordinary settlement, late settlement or the end of the controller process), and is
// bound to the repository, the exact effect subject, task, intent, candidate, parameter digest, the ACTIVE policy and freshness; a read counts once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ABSENCE_RULE, verifyRemoteObservation } from '../orchestrator/delivery/observation.mjs'
import { confirmResponse, effectSubject } from '../orchestrator/delivery/effect-subjects.mjs'
import { getIntent, reconcileIntent } from '../orchestrator/ledger/intents.mjs'
import { harness, intents, observe, ops, signObservation, state, untilState } from './d36-helpers.mjs'

const pushIntent = (h, id) => intents(h, id).find((i) => i.action === 'publish_candidate_branch')
const noMerge = (h) => assert.equal(ops(h).filter((o) => /merge_pull|merge$|release|deploy/i.test(o.op)).length, 0)
const toEligible = (h, id, n = 500) => h.drive({ until: untilState(h, id, 'merge_eligible'), maxRounds: n })

test('F2: direct-response success needs ACTION-SPECIFIC positive confirmation of the exact remote object — empty, malformed and mismatched responses are never success', () => {
  const P = { publish_candidate_branch: { branch: 'dh3/t', sha: 'a'.repeat(40) }, open_draft_pull_request: { head: 'dh3/t' }, update_pull_request_metadata: { number: 7 }, mark_pull_request_ready: { number: 7 }, rerun_ci_jobs: { run_id: 55, attempt: 1 }, dispatch_staging_candidate: { pr_number: 7 } }
  const GOOD = { publish_candidate_branch: { ref: 'dh3/t', sha: 'a'.repeat(40) }, open_draft_pull_request: { number: 12 }, update_pull_request_metadata: { number: 7 }, mark_pull_request_ready: { number: 7 }, rerun_ci_jobs: { run_id: 55, attempt: 2 }, dispatch_staging_candidate: { accepted: true } }
  for (const [a, p] of Object.entries(P)) {
    assert.deepEqual(confirmResponse(a, p, GOOD[a]), { ok: true }, `${a}: the positive confirmation`)
    for (const bad of [undefined, null, {}, [], 'ok', 42, true, { ok: true }, { ok: false, ...GOOD[a] }, { error: 'x', ...GOOD[a] }, { unrelated: 1 }, [GOOD[a]]]) assert.equal(confirmResponse(a, p, bad).ok, false, `${a}: ${JSON.stringify(bad)}`)
  }
  assert.equal(confirmResponse('publish_candidate_branch', P.publish_candidate_branch, { ref: 'dh3/other', sha: 'a'.repeat(40) }).code, 'PUBLISHER.WRONG_REMOTE_OBJECT', 'another branch')
  assert.equal(confirmResponse('publish_candidate_branch', P.publish_candidate_branch, { ref: 'dh3/t', sha: 'b'.repeat(40) }).code, 'PUBLISHER.WRONG_REMOTE_OBJECT', 'another sha')
  assert.equal(confirmResponse('update_pull_request_metadata', P.update_pull_request_metadata, { number: 8 }).code, 'PUBLISHER.WRONG_REMOTE_OBJECT', 'another PR')
  assert.equal(confirmResponse('rerun_ci_jobs', P.rerun_ci_jobs, { run_id: 55, attempt: 3 }).code, 'PUBLISHER.WRONG_REMOTE_OBJECT', 'an attempt nobody asked for')
  assert.equal(confirmResponse('some_unknown_action', {}, { ok: true, anything: 1 }).ok, false, 'an action this module does not know can never be confirmed')
  assert.equal(effectSubject('publish_candidate_branch', P.publish_candidate_branch), 'ref:dh3/t'); assert.equal(effectSubject('merge_pull_request', {}), null); assert.throws(() => effectSubject('mark_pull_request_ready', { pr: 1 }), /SUBJECT.UNDERIVABLE/)
})

test('F2 reproduction (fixed): an EMPTY response for a push that NEVER reached the remote is UNCERTAIN, reconciled from authenticated reads, retried once when proven absent — no phantom success', async () => {
  const h = await harness(); const id = h.submit(); const real = h.github.call.bind(h.github); let n = 0
  h.github.call = async (op, args, o) => { if (op === 'push_ref' && n++ === 0) return {}; return real(op, args, o) } // the effect NEVER happened; the response is an empty object
  await h.drive({ until: () => pushIntent(h, id)?.status === 'uncertain', maxRounds: 100 }); const i = pushIntent(h, id)
  assert.equal(i.status, 'uncertain', 'an empty object is not proof of anything'); assert.equal(JSON.parse(i.outcome_json).code, 'PUBLISHER.UNCONFIRMED_RESPONSE'); assert.equal(ops(h, 'push_ref').length, 0)
  assert.ok((await toEligible(h, id)).done); assert.equal(ops(h, 'push_ref').length, 1, 'exactly ONE push after recovery'); assert.equal(getIntent(h.ledger, i.intent_id).status, 'succeeded')
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM remote_observations WHERE intent_id=? AND state='absent'").get(i.intent_id), 'absence was concluded from authenticated reads'); noMerge(h); h.close()
})

test('F2: a MALFORMED response and a WRONG remote object identity (effect applied) are uncertain, reconcile as PRESENT, and are never repeated', async () => {
  for (const reply of ['malformed', 'wrong_identity']) {
    const h = await harness(); const id = h.submit(); const real = h.github.call.bind(h.github); let n = 0
    h.github.call = async (op, args, o) => { const r = await real(op, args, o); if (op === 'push_ref' && n++ === 0) return reply === 'malformed' ? [r] : { ref: args.branch, sha: 'f'.repeat(40) }; return r }
    await h.drive({ until: () => pushIntent(h, id)?.status === 'uncertain', maxRounds: 100 }); const i = pushIntent(h, id); assert.equal(i.status, 'uncertain', reply)
    assert.ok((await toEligible(h, id)).done); assert.equal(ops(h, 'push_ref').length, 1, `${reply}: no duplicate push`); assert.equal(getIntent(h.ledger, i.intent_id).status, 'reconciled_succeeded', reply); noMerge(h); h.close()
  }
})

// ---------------------------------------------------------------- the end of the request: ordinary settlement, late settlement, controller termination
async function uncertainPush(h, id) {
  h.github.inject('push_ref', 'reject') // fixture: the request failed BEFORE any effect (the client cannot know)
  await h.drive({ until: () => pushIntent(h, id)?.status === 'uncertain', maxRounds: 100 }); const i = pushIntent(h, id); const L = h.ledger
  L.db.prepare('DELETE FROM operation_deadlines WHERE op_id LIKE ?').run(`effect:${i.intent_id}:%`)
  const { key_id: _k, ...base } = (await observe(h, 'observe_intent', { intent_id: i.intent_id })).observation; void _k
  return { i, base, D: i.dispatched_at }
}
const signed = (h, base, k, state, at, over = {}) => { const v = verifyRemoteObservation(signObservation(h, 'delivery_verifier', { ...base, observation_id: `obs-f2-${k}`, read_id: `read-f2-${k}`, state, observed_at: at, details: {}, ...over }), { policy: h.policy, now: at + 1000 }); assert.ok(v.ok, JSON.stringify(v.problems)); return v.observation }
const reconcile = (h, i, o) => reconcileIntent(h.ledger, i.intent_id, { observation: o, policy: h.policy })

for (const end of ['settled', 'settled_late', 'process_ended']) {
  test(`F2 [${end}]: ABSENT reads taken BEFORE the end of the request never count; only reads after it (settle window + two spaced reads) conclude absence`, async () => {
    const h = await harness(); const id = h.submit(); const { i, base, D } = await uncertainPush(h, id); const S = D + 100_000
    h.ledger.db.prepare("INSERT INTO operation_deadlines(op_id,task_id,kind,started_at,deadline_at,state,holds_json,settled_at) VALUES (?,?,?,?,?,?,'[]',?)").run(`effect:${i.intent_id}:x`, id, 'effect:publish_candidate_branch', D, D + 120_000, end, S)
    h.clock.t = S + 2_000
    // two signed absent reads taken while the request was still in flight (D+65 s, D+98 s): spaced and past the settle window FROM DISPATCH — which is exactly what used to be enough
    assert.equal(reconcile(h, i, signed(h, base, 1, 'absent', D + 65_000)).code, 'INTENT.RECONCILIATION_PENDING')
    const r2 = reconcile(h, i, signed(h, base, 2, 'absent', D + 98_000)); assert.equal(r2.code, 'INTENT.RECONCILIATION_PENDING'); assert.deepEqual(r2.problems, ['OBSERVATION.ABSENCE_NOT_YET_PROVEN']); assert.equal(getIntent(h.ledger, i.intent_id).status, 'uncertain')
    h.clock.t = S + ABSENCE_RULE.settleMs + 1_000; assert.equal(reconcile(h, i, signed(h, base, 3, 'absent', h.clock.t)).code, 'INTENT.RECONCILIATION_PENDING', 'ONE read after the end is not enough')
    h.clock.t += ABSENCE_RULE.gapMs + 1_000; assert.ok(reconcile(h, i, signed(h, base, 4, 'absent', h.clock.t)).ok, 'two DISTINCT spaced reads after the end conclude absence'); assert.equal(getIntent(h.ledger, i.intent_id).status, 'reconciled_absent'); h.close()
  })
}

test('F2: a DELAYED remote effect that lands after earlier absent reads is found PRESENT after the request ended — never retried, no duplicate', async () => {
  const h = await harness({ gh: { delayedEffectMs: 130_000 } }); const id = h.submit(); h.github.inject('push_ref', 'delay_effect')
  await h.drive({ until: () => pushIntent(h, id)?.status === 'uncertain', maxRounds: 100 }); const i = pushIntent(h, id)
  assert.equal(ops(h, 'push_ref').length, 0, 'the client failed; the server has not applied it yet')
  assert.ok((await toEligible(h, id)).done); assert.equal(ops(h, 'push_ref').length, 1, 'the delayed effect landed once and was NEVER repeated'); assert.equal(ops(h, 'push_ref')[0].delayed, true)
  assert.equal(getIntent(h.ledger, i.intent_id).status, 'reconciled_succeeded'); noMerge(h); h.close()
})

test('F2: a delayed effect that lands AFTER absence was concluded is not duplicated — the remote refuses the second write (fast-forward) and the task proceeds on the one effect', async () => {
  const h = await harness({ gh: { delayedEffectMs: 20 * 60_000 } }); const id = h.submit(); h.github.inject('push_ref', 'delay_effect')
  assert.ok((await toEligible(h, id, 900)).done); const pushes = ops(h, 'push_ref'); assert.equal(pushes.length, 1, `exactly one effective push: ${JSON.stringify(pushes.map((p) => p.delayed ?? false))}`)
  const t = h.ledger.getTask(id); assert.equal(h.github.s.refs[h.ledger.delivery(id).branch].sha, t.head_sha); assert.equal(h.github.s.prs.length, 1); noMerge(h); h.close()
})

test('F2: the CONTROLLER RESTART ends the dead process\'s requests (process_ended) — reads before the restart never count, a request that merely lost its client is NOT proof of absence, and the task still completes with one effect', async () => {
  const root = (await import('./d36-helpers.mjs')).tmp(); const h = await harness({ root }); const id = h.submit(); h.github.inject('push_ref', 'crash_after')
  await assertThrowsSimCrash(() => h.drive({ until: () => false, maxRounds: 100 }))
  const clock = h.clock; h.close(); const h2 = await harness({ root, clock }); await h2.delivery.tick()
  const i = pushIntent(h2, id); assert.ok(['uncertain', 'reconciled_succeeded'].includes(i.status), i.status); assert.equal(ops(h2, 'push_ref').length, 1, 'the crashed process\'s request HAD landed (a client ending proves nothing about the server)')
  assert.ok((await toEligible(h2, id)).done); assert.equal(ops(h2, 'push_ref').length, 1, 'recovery added NO duplicate'); assert.equal(getIntent(h2.ledger, i.intent_id).status, 'reconciled_succeeded'); noMerge(h2); h2.close()
})
async function assertThrowsSimCrash(fn) { try { await fn(); assert.fail('expected a simulated crash') } catch (e) { assert.equal(e?.code, 'SIM_CRASH') } }

// ---------------------------------------------------------------- the reconciliation boundary: binding, freshness, active policy, malformed and replayed observations
test('F2: the boundary rejects an observation of ANOTHER repository, ANOTHER effect subject, a stale read, a wrong ACTIVE policy, a missing policy, a replayed read and malformed input — and accepts the correctly bound one', async () => {
  const h = await harness(); const id = h.submit(); const { i, base, D } = await uncertainPush(h, id); h.clock.t = D + 200_000; const at = h.clock.t - 1000
  const code = (o, policy = h.policy) => { const r = reconcileIntent(h.ledger, i.intent_id, { observation: o, ...(policy ? { policy } : {}) }); return r.ok ? 'OK' : (r.problems ?? [r.code]).join() }
  assert.match(code(signed(h, base, 'repo', 'absent', at, { repository: 'someone/else' })), /OBSERVATION\.WRONG_REPOSITORY/)
  assert.match(code(signed(h, base, 'subj', 'absent', at, { subject: 'ref:dh3/another-branch' })), /OBSERVATION\.WRONG_SUBJECT/)
  assert.match(code(signed(h, base, 'subj2', 'absent', at, { subject: 'pr_head:dh3/t' })), /OBSERVATION\.WRONG_SUBJECT/)
  assert.match(code(signed(h, base, 'task', 'absent', at, { task_id: 'other-task' })), /OBSERVATION\.WRONG_TASK/)
  assert.match(code(signed(h, base, 'dig', 'absent', at, { params_digest: 'c'.repeat(64) })), /OBSERVATION\.WRONG_SUBJECT/)
  assert.match(code(signed(h, base, 'cand', 'absent', at, { candidate_sha: 'd'.repeat(40) })), /OBSERVATION\.WRONG_CANDIDATE/)
  const old = signed(h, base, 'stale', 'absent', h.clock.t - 11 * 60_000); assert.match(code(old), /OBSERVATION\.STALE/, 'freshness is enforced at the ledger boundary, not only when the envelope was verified')
  assert.match(code(signed(h, base, 'pol', 'absent', at), { revision: 'e'.repeat(64) }), /OBSERVATION\.WRONG_POLICY_REVISION/, 'the ACTIVE policy must be the one the read was made under')
  assert.match(code(signed(h, base, 'nopol', 'absent', at), null), /OBSERVATION\.ACTIVE_POLICY_REQUIRED/, 'fail closed: no policy named at the boundary')
  for (const bad of [null, undefined, 'present', 42, [], {}, { ...signed(h, base, 'copy', 'present', at) }]) assert.equal(reconcileIntent(h.ledger, i.intent_id, { observation: bad, policy: h.policy }).ok, false, JSON.stringify(bad)?.slice(0, 40))
  assert.equal(getIntent(h.ledger, i.intent_id).status, 'uncertain', 'nothing above changed the intent')
  const good = signed(h, base, 'good', 'absent', at); assert.equal(reconcileIntent(h.ledger, i.intent_id, { observation: good, policy: h.policy }).code, 'INTENT.RECONCILIATION_PENDING', 'correctly bound: recorded, one read is not proof')
  assert.deepEqual(reconcileIntent(h.ledger, i.intent_id, { observation: good, policy: h.policy }).problems, ['OBSERVATION.REPLAYED'], 'the same signed read counts ONCE')
  assert.equal(h.ledger.db.prepare('SELECT COUNT(*) c FROM remote_observations WHERE intent_id=?').get(i.intent_id).c, 1); h.close()
})

test('F2: safe absence that cannot be established is RETAINED explicitly — an unsettled request keeps the intent uncertain, never retried, announced once, and still blocks the task', async () => {
  const h = await harness({ dcfg: { unresolvedEffectAfterMs: 2 * 3600_000 } }); const id = h.submit(); h.github.inject('push_ref', 'reject')
  await h.drive({ until: () => pushIntent(h, id)?.status === 'uncertain', maxRounds: 100 }); const i = pushIntent(h, id)
  h.ledger.db.prepare('DELETE FROM operation_deadlines WHERE op_id LIKE ?').run(`effect:${i.intent_id}:%`)
  h.ledger.db.prepare("INSERT INTO operation_deadlines(op_id,task_id,kind,started_at,deadline_at,state,holds_json) VALUES (?,?,?,?,?,'unresolved','[]')").run(`effect:${i.intent_id}:hung`, id, 'effect:publish_candidate_branch', i.dispatched_at, i.dispatched_at + 1) // the request never settled
  await h.drive({ until: () => !!h.ledger.meta(`unresolved_effect:${i.intent_id}`), maxRounds: 400 })
  assert.ok(h.ledger.meta(`unresolved_effect:${i.intent_id}`), 'retained explicitly'); assert.equal(getIntent(h.ledger, i.intent_id).status, 'uncertain'); assert.equal(ops(h, 'push_ref').length, 0, 'never retried while the request may still land')
  assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind='delivery_status' AND payload_json LIKE '%effect_unresolved%'").get().c, 1, 'announced ONCE')
  for (let k = 0; k < 6; k += 1) { h.clock.advance(11 * 60_000); await h.delivery.tick() }
  assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind='delivery_status' AND payload_json LIKE '%effect_unresolved%'").get().c, 1, 'still once'); assert.notEqual(state(h, id), 'ci_running')
  // the request finally settles late: the window restarts from THAT moment and the reads decide
  h.ledger.db.prepare("UPDATE operation_deadlines SET state='settled_late', settled_at=? WHERE op_id=?").run(h.ledger.now(), `effect:${i.intent_id}:hung`)
  assert.ok((await toEligible(h, id, 700)).done); assert.equal(ops(h, 'push_ref').length, 1); noMerge(h); h.close()
})

test('F2: the watchdog\'s START record is not best effort — a request nobody recorded is never sent', async () => {
  const h = await harness(); const id = h.submit(); const { withDeadline } = await import('../orchestrator/delivery/watchdog.mjs')
  const L = h.ledger; let sent = false
  await assert.rejects(() => withDeadline({ ...L, now: () => L.now(), db: { prepare: () => ({ run() { throw new Error('DISK_FULL') } }) } }, { opId: 'effect:in-x:1', taskId: id, kind: 'effect:x', ms: 1000 }, async () => { sent = true }), /DISK_FULL/)
  assert.equal(sent, false, 'the request was never sent'); h.close()
})

test('review O3/O4 (Opus): actions the remote does NOT protect against a late duplicate (no compare-and-swap) need a much longer absence window; an ABSENT read can never come from the future', async () => {
  const { ABSENCE_RULE_NO_CAS, NO_CAS_ACTIONS, absenceProven } = await import('../orchestrator/delivery/observation.mjs')
  assert.deepEqual([...NO_CAS_ACTIONS].sort(), ['dispatch_staging_candidate', 'rerun_ci_jobs', 'update_pull_request_metadata'], 'the actions a LIVE remote does not protect with a precondition (push expected_old, one open PR per head and idempotent ready are)')
  assert.ok(ABSENCE_RULE_NO_CAS.settleMs >= 10 * 60_000 && ABSENCE_RULE_NO_CAS.settleMs > ABSENCE_RULE.settleMs)
  const rows = (...at) => at.map((t, k) => ({ state: 'absent', read_id: `r${k}`, observed_at: t }))
  assert.equal(absenceProven(rows(61_000, 92_000), 0).proven, true, 'the ordinary rule')
  assert.equal(absenceProven(rows(61_000, 92_000), 0, ABSENCE_RULE_NO_CAS).proven, false, 'two reads after one minute never conclude absence for a no-CAS action')
  assert.equal(absenceProven(rows(601_000, 632_000), 0, ABSENCE_RULE_NO_CAS).proven, true)
  const src = (await import('node:fs')).readFileSync(new URL('../orchestrator/ledger/intents.mjs', import.meta.url), 'utf8'); assert.ok(/NO_CAS_ACTIONS\.includes\(i\.action\) \? ABSENCE_RULE_NO_CAS/.test(src), 'reconcileIntent selects the rule by action')
  const h = await harness(); const id = h.submit(); const { i, base, D } = await uncertainPush(h, id); h.clock.t = D + 200_000
  const future = signed(h, base, 'future', 'absent', h.clock.t + 30_000); const r = reconcile(h, i, future); assert.equal(r.ok, false); assert.ok(r.problems.includes('OBSERVATION.TIME_INVALID'), 'an absent read dated after the ledger clock is refused (no skew allowance for absence)'); h.close()
})
