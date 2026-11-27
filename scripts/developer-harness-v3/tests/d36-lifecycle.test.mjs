// D3.6-F/H — explicit delivery milestones, dependency requirements, base advancement and the (now INTEGRATED, P6v3) delivery lifecycle edges. SIMULATED; temp ledgers; test keys.
// D3.6 integration: the rebuild/re-verification edges are in the AUTHORITATIVE reducer. The controller's fail-closed behaviour for a lifecycle WITHOUT them is still covered,
// on the labelled pre-integration reducer (the integrated chain reversed on a disposable copy; temp ledgers only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, verify } from 'node:crypto'
import { canonicalize } from '../lib/canonical.mjs'
import { applyEvent as realApply, createTask as realCreate, loadLifecycle as realLoad } from '../lifecycle/lifecycle.mjs'
import { PACKAGE_DOMAIN } from '../orchestrator/issuer/delivery-issuer.mjs'
import { reach } from '../orchestrator/delivery/state.mjs'
import { proposalReducer } from '../orchestrator/sim/delivery-harness.mjs'
import { harness, ops, state, untilState } from './d36-helpers.mjs'

const eligible = (h, id, n = 500) => h.drive({ until: untilState(h, id, 'merge_eligible'), maxRounds: n })
let n = 0
const ev = (t, kind, f = {}) => ({ event_id: `e${++n}`, idempotency_id: `i${n}`, task_id: 't1', kind, expected_revision: t.state_revision, fencing_token: t.fencing_token, ...f })
const walk = (R, states) => { let t = R.createTask({ task_id: 't1' }); for (const s of states) { const r = R.applyEvent(R.lc, t, ev(t, 'transition', { to: s })); assert.ok(r.ok, `${s}: ${r.problems}`); t = r.task } return t }
const TO = { publishing: ['queued', 'planning', 'implementing', 'testing', 'independent_review', 'security_review', 'publishing'] }
TO.ci_running = [...TO.publishing, 'ci_running']; TO.staging_verification = [...TO.ci_running, 'staging_verification']; TO.merge_eligible = [...TO.staging_verification, 'merge_eligible']

test('milestones are explicit and candidate-bound: built < locally_verified < published < ci_verified < staging_verified < merge_eligible; `merged` can never be recorded in D3.6; a new head invalidates them', async () => {
  const h = await harness(); const id = h.submit(); assert.ok((await eligible(h, id)).done)
  const m = h.ledger.db.prepare('SELECT milestone, reached_at FROM delivery_milestones WHERE task_id=? AND invalidated_at IS NULL ORDER BY reached_at, rowid').all(id).map((r) => r.milestone)
  assert.deepEqual(m, ['built', 'locally_verified', 'published', 'ci_verified', 'staging_verified', 'merge_eligible'])
  assert.equal(reach(h.ledger, id, 'merged').code, 'MILESTONE.UNKNOWN_OR_NOT_D36')
  assert.throws(() => h.ledger.db.prepare("INSERT INTO delivery_milestones(task_id,milestone,candidate_sha,tree_digest,base_sha,reached_at) VALUES (?,'merged','x','x','x',1)").run(id), /MERGED_REQUIRES_D37/)
  assert.equal(state(h, id), 'merge_eligible'); assert.ok(!['merged', 'completed', 'production_release'].includes(state(h, id)))
  assert.equal(ops(h).filter((o) => /merge|release/.test(o.op)).length, 0, 'no merge, no release'); h.close()
})

test('dependencies: an ORDERING dependency (locally_verified) is satisfied at the upstream handoff; a CODE dependency (merged) keeps the dependent waiting — tasks are serialized, never built on an unmerged candidate', async () => {
  const h = await harness(); const up = h.submit({ requirements: { text: 'up', sim_path: 'apps/mobile/up.txt' } })
  const order = h.submit({ requirements: { text: 'ord', sim_path: 'apps/mobile/ord.txt' }, depends_on: [up] })
  const code = h.submit({ requirements: { text: 'code', sim_path: 'apps/mobile/code.txt' }, dependencies: [{ task_id: up, requires: 'merged' }] })
  assert.ok((await h.drive({ until: () => state(h, up) === 'merge_eligible' && state(h, order) === 'merge_eligible', maxRounds: 900 })).done)
  assert.equal(state(h, code), 'dependency_waiting', 'a code dependency waits for D3.7 merge evidence'); assert.deepEqual(h.ledger.openDependencies(code), [up])
  assert.equal(h.ledger.addDependency(code, up, { requires: 'locally_verified' }).code, 'DEPENDENCY.REQUIREMENT_CONFLICT', 'a requirement is never silently weakened'); h.close()
})

test('stale upstream: a dependency\'s candidate changing while the dependent is IN DELIVERY withdraws its approvals transitively; the AUTHORITATIVE (P6v3) lifecycle rebuilds it, a lifecycle without the edge fails closed', async () => {
  for (const lifecycle of ['pre-integration', 'authoritative']) {
    const h = await harness(lifecycle === 'pre-integration' ? { historicalLifecycle: 'pre-integration' } : {}); const up = h.submit({ requirements: { text: 'up', sim_path: 'apps/mobile/up.txt' } }); const down = h.submit({ requirements: { text: 'down', sim_path: 'apps/mobile/down.txt' }, depends_on: [up] })
    await h.drive({ until: () => state(h, down) === 'ci_running', maxRounds: 900 })
    assert.equal(state(h, down), 'ci_running', lifecycle)
    assert.ok(h.ledger.submitCandidate(up, { base_sha: h.ledger.currentBase(up), candidate_sha: '1'.repeat(40), tree_digest: '2'.repeat(40), patch_digest: '3'.repeat(64) }).ok) // the upstream moved
    await h.drive({ until: () => !!h.ledger.getSuspension(down) || state(h, down) === 'implementing', maxRounds: 50 })
    const live = h.ledger.db.prepare("SELECT COUNT(*) c FROM evidence WHERE task_id=? AND invalidated_at IS NULL AND evidence_type IN ('test_results','independent_review','security_review')").get(down).c
    assert.equal(live, 0, `${lifecycle}: no approval of the old basis survives`)
    if (lifecycle === 'pre-integration') assert.equal(h.ledger.getSuspension(down)?.cause, 'DEPENDENCY_BASIS_CHANGED', 'no dependency_rebuild edge: fails closed')
    else assert.equal(state(h, down), 'implementing', 'integrated dependency_rebuild from a delivery state')
    h.close()
  }
})

test('main advanced (strict ruleset): a clean trusted merge is a NEW candidate on a new base generation — re-tested, re-reviewed, re-published (fast-forward), fresh CI and staging; bounded per day', async () => {
  const h = await harness(); const id = h.submit(); assert.ok((await eligible(h, id)).done); const head1 = h.ledger.getTask(id).head_sha
  h.github.advanceMain('4'.repeat(40))
  await h.drive({ until: () => h.ledger.getTask(id).head_sha !== head1 && state(h, id) === 'merge_eligible', maxRounds: 600 })
  const t = h.ledger.getTask(id); assert.notEqual(t.head_sha, head1); assert.equal(h.ledger.currentBase(id), '4'.repeat(40)); assert.equal(h.ledger.delivery(id).generation, 1)
  assert.equal(t.base_sha, h.ledger.db.prepare('SELECT base_sha FROM tasks WHERE task_id=?').get(id).base_sha, 'the SUBMITTED base (task identity) is unchanged')
  const pushes = ops(h, 'push_ref'); assert.equal(pushes.length, 2); assert.equal(pushes[1].args.expected_old, head1, 'a fast-forward from our own head, never a force push')
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM evidence WHERE task_id=? AND evidence_type='ci_gate' AND candidate_sha=? AND invalidated_at IS NULL", ).get(id, t.head_sha), 'fresh CI evidence for the new candidate')
  for (let k = 0; k < 4; k += 1) { h.github.advanceMain(String(5 + k).repeat(40)); await h.drive({ until: () => state(h, id) === 'merge_eligible' && h.ledger.currentBase(id) === String(5 + k).repeat(40), maxRounds: 400 }) }
  assert.ok(JSON.parse(h.ledger.meta(`base_updates:${id}`)).length <= 3, 'at most 3 base updates per 24 h'); h.close()
})

test('base conflicts: protected or out-of-scope conflicts are NEVER auto-resolved (terminal, also under the integrated lifecycle); a task-file conflict is rebuilt by the AUTHORITATIVE lifecycle and fails closed without the edge', async () => {
  // (a task that ADDS a migration cannot even publish in D3.6: the trusted task authority carries no migrations_authorized flag, so the evaluator fails closed — doc 33 §4)
  for (const [lifecycle, path, cause] of [['pre-integration', 'apps/mobile/feature.txt', 'BASE_UPDATE_CONFLICT'], ['authoritative', '.github/workflows/ci.yml', 'BASE_UPDATE_PROTECTED_CONFLICT'], ['authoritative', 'supabase/migrations/263_x.sql', 'BASE_UPDATE_PROTECTED_CONFLICT'], ['authoritative', 'apps/mobile/feature.txt', null]]) {
    const NEW = '6'.repeat(40)
    const h = await harness({ ...(lifecycle === 'pre-integration' ? { historicalLifecycle: 'pre-integration' } : {}), facts: { baseConflicts: { [NEW]: [path] } } }); const id = h.submit()
    if (!path.startsWith('apps/')) h.dfacts.mergeBase = async () => ({ ok: false, code: 'MERGE.CONFLICT', conflicts: [path] }) // the trusted merge REPORTS a protected conflict
    assert.ok((await eligible(h, id)).done, `${lifecycle} ${path}`); h.github.advanceMain(NEW)
    await h.drive({ until: () => !!h.ledger.getSuspension(id) || state(h, id) === 'implementing' || (lifecycle === 'authoritative' && !cause && state(h, id) === 'merge_eligible' && h.ledger.currentBase(id) === NEW), maxRounds: 600 })
    if (cause) { assert.equal(h.ledger.getSuspension(id)?.cause, cause, path); assert.equal(h.ledger.getSuspension(id).disposition, 'terminal') }
    else { assert.ok(h.ledger.recoveryHistory(id).some((r) => r.kind === 'handoff_withdrawn' && r.detail.cause === 'BASE_UPDATE_CONFLICT')); assert.equal(h.ledger.currentBase(id), NEW, 'the rebuild runs on the NEW base') }
    h.close()
  }
})

test('delivery eligibility is refused while ANY required evidence is missing, and the signed SIMULATED delivery-verification package binds the exact candidate, base, policy and every evidence digest', async () => {
  const h = await harness(); const id = h.submit(); await h.drive({ until: () => state(h, id) === 'staging_verification', maxRounds: 400 })
  assert.equal((await h.issuers.delivery_verifier.handle('issue_delivery_verification', { task_id: id })).code, 'ISSUER.DELIVERY_EVIDENCE_MISSING', 'no staging gate yet')
  assert.ok((await eligible(h, id)).done)
  const t = h.ledger.getTask(id); const saved = JSON.parse(h.ledger.meta(`delivery_package:${id}:${t.head_sha}`))
  const key = h.policy.trusted_keys[saved.signature.key_id]; assert.equal(key.identity, 'delivery_verifier')
  const pub = createPublicKey({ key: Buffer.from(key.public_key, 'base64'), format: 'der', type: 'spki' })
  assert.ok(verify(null, Buffer.from(`${PACKAGE_DOMAIN}${canonicalize(saved.package)}`), pub, Buffer.from(saved.signature.value, 'base64')))
  assert.equal(saved.package.candidate_sha, t.head_sha); assert.equal(saved.package.policy_revision, h.policy.revision); assert.equal(saved.package.simulated, true)
  assert.deepEqual(saved.package.evidence.map((e) => e.type).sort(), ['ci_gate', 'independent_review', 'publication_receipt', 'security_review', 'staging_gate', 'task_authority', 'test_results'])
  const tampered = { ...saved.package, candidate_sha: '0'.repeat(40) }; assert.equal(verify(null, Buffer.from(`${PACKAGE_DOMAIN}${canonicalize(tampered)}`), pub, Buffer.from(saved.signature.value, 'base64')), false); h.close()
})

test('AUTHORITATIVE reducer (P6v3 integrated): re-verification and both rebuild edges from the DELIVERY states, with their reasons and invalidations; the sticky owner hold and owner-only cancellation are kept; the pre-integration reducer had none of them', async () => {
  // D3.6 integration: before, these edges were exercised on a P6v2 DISPOSABLE copy and the authoritative reducer lacked them. Now the authoritative reducer IS the one under test,
  // and the labelled pre-integration reducer documents exactly what the integration added.
  const R = { applyEvent: realApply, createTask: realCreate, lc: realLoad() }; const A = await proposalReducer([], { preIntegration: true })
  for (const from of ['ci_running', 'staging_verification', 'merge_eligible']) {
    const t = walk(R, TO[from])
    const rv = R.applyEvent(R.lc, t, ev(t, 'transition', { to: 'testing', reason_code: 'APPROVALS_EXPIRED' })); assert.ok(rv.ok, `${from} reverification: ${rv.problems}`); assert.deepEqual(rv.invalidated, ['test_results', 'independent_review', 'security_review'])
    for (const reason of ['DEPENDENCY_CHANGED', 'BASE_UPDATE_CONFLICT']) { const r = R.applyEvent(R.lc, t, ev(t, 'transition', { to: 'implementing', reason_code: reason })); assert.ok(r.ok, `${from} ${reason}`); assert.ok(r.invalidated.includes('ci_gate') && r.invalidated.includes('staging_gate') && r.invalidated.includes('delivery_verification')) }
    assert.equal(R.applyEvent(R.lc, t, ev(t, 'transition', { to: 'implementing', reason_code: 'CI_FAILED' })).problems[0], 'TRANSITION.REASON_NOT_ALLOWED_FOR_STATE')
    assert.equal(A.applyEvent(A.lc, walk(A, TO[from]), ev(walk(A, TO[from]), 'transition', { to: 'implementing', reason_code: 'BASE_UPDATE_CONFLICT' })).ok, false, 'not in the pre-integration reducer')
  }
  const b = R.applyEvent(R.lc, walk(R, TO.ci_running), ev(walk(R, TO.ci_running), 'transition', { to: 'blocked', reason_code: 'OWNER_DECISION_REQUIRED' })).task
  const hop = R.applyEvent(R.lc, b, ev(b, 'transition', { to: 'waiting_external', reason_code: 'GITHUB_UNAVAILABLE' })); assert.ok(hop.ok); assert.equal(hop.task.owner_hold, true)
  assert.equal(R.applyEvent(R.lc, hop.task, ev(hop.task, 'transition', { to: 'ci_running' })).problems[0], 'TRANSITION.OWNER_ACTION_REQUIRED', 'the blocked-state escape stays closed from a delivery state')
  const m = walk(R, TO.merge_eligible); assert.equal(R.applyEvent(R.lc, m, ev(m, 'transition', { to: 'cancelled' })).problems[0], 'TRANSITION.OWNER_ACTION_REQUIRED')
  assert.equal(Object.hasOwn(realLoad(), 'base_conflict_rebuild'), true, 'the repository lifecycle now declares the edge'); assert.equal(Object.hasOwn(A.lc, 'base_conflict_rebuild'), false, 'the pre-integration one did not')
})
