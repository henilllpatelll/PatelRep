// D3.5-H — the consolidated PROTECTED lifecycle proposal P6 (technical suspension, re-verification of expired approvals, explicit cancellation, provider-unavailable waits,
// the blocked-state escape fix), tested against a DISPOSABLE patched COPY of the real reducer + contract. The repository's authoritative reducer and contract are NOT changed:
// a test below proves the loophole still exists there (and that the controller never uses it). The engine runs under the proposal ONLY in a labelled test configuration
// (`proposalReducer`, temp ledgers only). Nothing here applies P6 to the repository.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyEvent as realApply, createTask as realCreate, loadLifecycle as realLoad } from '../lifecycle/lifecycle.mjs'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { satisfyingEvidence } from '../orchestrator/ledger/evidence-store.mjs'
import { H, drive, owner, tmp as tmpDir } from './d34-rem-helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PROPOSALS = path.join(ROOT, 'docs/developer-harness-v3/proposals')
const manifest = JSON.parse(readFileSync(path.join(PROPOSALS, 'manifest.json'), 'utf8'))

/** Apply P6 to a disposable copy of the reducer + contract and import the PATCHED reducer from there. */
async function patchedReducer() {
  const t = mkdtempSync(path.join(os.tmpdir(), 'dh35-p6-'))
  for (const rel of ['scripts/developer-harness-v3/lifecycle/lifecycle.mjs', 'scripts/developer-harness-v3/lib/canonical.mjs', 'docs/developer-harness-v3/task-lifecycle.json']) { mkdirSync(path.dirname(path.join(t, rel)), { recursive: true }); copyFileSync(path.join(ROOT, rel), path.join(t, rel)) }
  const ap = spawnSync('git', ['apply', '-p1', path.join(PROPOSALS, 'P6-lifecycle-consolidated.patch')], { cwd: t, encoding: 'utf8' }); assert.equal(ap.status, 0, ap.stderr)
  const mod = await import(pathToFileURL(path.join(t, 'scripts/developer-harness-v3/lifecycle/lifecycle.mjs')).href)
  return { label: 'PROPOSAL_UNDER_TEST', applyEvent: mod.applyEvent, createTask: mod.createTask, lc: mod.loadLifecycle() }
}
let n = 0
const ev = (t, kind, f = {}) => ({ event_id: `e${++n}`, idempotency_id: `i${n}`, task_id: 't1', kind, expected_revision: t.state_revision, fencing_token: t.fencing_token, ...f })
const runner = (R) => { const step = (t, to, f = {}) => R.applyEvent(R.lc, t, ev(t, 'transition', { to, ...f })); const walk = (states) => { let t = R.createTask({ task_id: 't1' }); for (const s of states) { const r = step(t, s); assert.ok(r.ok, `${s}: ${r.problems}`); t = r.task } return t }; return { step, walk } }
const TO_IMPL = ['queued', 'planning', 'implementing']
const TO_PUB = ['queued', 'planning', 'implementing', 'testing', 'independent_review', 'security_review', 'publishing']

test('P6 is exact: digest-pinned in the manifest, LF-only, touches ONLY the lifecycle contract and reducer, supersedes P5, maps to registered gates, and is NOT applied in the repository', () => {
  const p6 = manifest.proposals.find((p) => p.id === 'P6'); assert.ok(p6)
  const buf = readFileSync(path.join(PROPOSALS, p6.file)); assert.equal(createHash('sha256').update(buf).digest('hex'), p6.sha256); assert.ok(!buf.includes(13))
  assert.deepEqual(p6.touches.sort(), ['docs/developer-harness-v3/task-lifecycle.json', 'scripts/developer-harness-v3/lifecycle/lifecycle.mjs'])
  assert.equal(manifest.proposals.find((p) => p.id === 'P5').superseded_by, 'P6')
  assert.equal(Object.hasOwn(realLoad().recoverable_states, 'technical_suspension'), false, 'the authoritative contract is unchanged')
  assert.equal(spawnSync('git', ['-C', ROOT, 'apply', '--check', '-p1', path.join(PROPOSALS, p6.file)]).status, 0, 'applies cleanly to the current tree')
})

test('AUTHORITATIVE reducer (unchanged, preserved on purpose): the pre-existing blocked-state hop still exists there — documented, and the controller never takes it', () => {
  const R = { applyEvent: realApply, createTask: realCreate, lc: realLoad() }; const { step, walk } = runner(R)
  const b = step(walk(TO_IMPL), 'blocked', { reason_code: 'OWNER_DECISION_REQUIRED' }).task
  const hop = step(b, 'waiting_resources', { reason_code: 'MEMORY_PRESSURE' })
  assert.equal(hop.ok, true); assert.equal(step(hop.task, 'implementing').ok, true, 'LOOPHOLE (P3(g)) present in the authoritative reducer until the owner applies P6')
})

test('P6 reducer: an owner-only blocker cannot be escaped by ANY hop — direct, through waiting/paused/recovery/suspension states, or after fencing/head events — without an owner action', async () => {
  const R = await patchedReducer(); const { step, walk } = runner(R)
  const b = step(walk(TO_IMPL), 'blocked', { reason_code: 'OWNER_DECISION_REQUIRED' }).task; assert.equal(b.owner_hold, true)
  assert.equal(step(b, 'implementing').problems[0], 'TRANSITION.OWNER_ACTION_REQUIRED', 'direct')
  for (const [via, reason] of [['waiting_resources', 'MEMORY_PRESSURE'], ['waiting_subscription', 'SUBSCRIPTION_LIMIT'], ['waiting_external', 'PROVIDER_UNAVAILABLE'], ['paused', 'OWNER_PAUSED'], ['worker_recovery', 'HOST_RESTARTED'], ['context_recovery', 'CONTEXT_LOST'], ['technical_suspension', 'RETRY_BUDGET_EXHAUSTED']]) {
    const h1 = step(b, via, { reason_code: reason }); assert.ok(h1.ok, `${via}: ${h1.problems}`); assert.equal(h1.task.owner_hold, true, `${via} keeps the hold`); assert.equal(h1.task.blocker_reason, 'OWNER_DECISION_REQUIRED', `${via} keeps the reason`)
    assert.equal(step(h1.task, 'implementing').problems[0], 'TRANSITION.OWNER_ACTION_REQUIRED', `indirect via ${via}`)
    const h2 = step(h1.task, 'waiting_resources', { reason_code: 'CPU_PRESSURE' }); assert.equal(step(h2.task, 'implementing').problems[0], 'TRANSITION.OWNER_ACTION_REQUIRED', `two hops via ${via}`)
  }
  const fenced = R.applyEvent(R.lc, b, ev(b, 'worker_recovered', { reason_code: 'HOST_RESTARTED', new_fencing_token: b.fencing_token + 1 })).task; assert.equal(fenced.owner_hold, true, 'a recovery does not clear the hold')
  const ok = step(b, 'implementing', { owner_action_id: 'owner-decision-1' }); assert.ok(ok.ok); assert.equal(ok.task.owner_hold, false, 'only an owner action clears it')
  // an ordinary (non-owner) wait is unaffected: no owner action needed
  assert.ok(step(step(walk(TO_IMPL), 'waiting_resources', { reason_code: 'MEMORY_PRESSURE' }).task, 'implementing').ok)
})

test('P6 reducer: technical suspension is recoverable and never an owner blocker; cancellation is terminal and owner-only, never after merge; provider-unavailable is a wait reason', async () => {
  const R = await patchedReducer(); const { step, walk } = runner(R)
  const s = step(walk(TO_IMPL), 'technical_suspension', { reason_code: 'RECOVERY_EXHAUSTED' }); assert.ok(s.ok); assert.ok(step(s.task, 'implementing').ok, 'resumes with no owner action')
  assert.equal(step(s.task, 'blocked', { reason_code: 'BILLING_REVERIFICATION_REQUIRED' }).ok, false, 'a billing re-verification wait is never a blocker reason')
  const t = walk(TO_IMPL)
  assert.equal(step(t, 'cancelled').problems[0], 'TRANSITION.OWNER_ACTION_REQUIRED')
  const c = step(t, 'cancelled', { owner_action_id: 'owner-cancel-1' }); assert.ok(c.ok); assert.equal(c.task.state, 'cancelled')
  assert.equal(step(c.task, 'implementing', { owner_action_id: 'x' }).problems[0], 'TRANSITION.FROM_TERMINAL', 'cancelled is terminal')
  const merged = walk([...TO_PUB, 'ci_running', 'staging_verification', 'merge_eligible', 'merged'])
  assert.equal(step(merged, 'cancelled', { owner_action_id: 'o' }).problems[0], 'TRANSITION.CANCEL_AFTER_MERGE')
  assert.ok(step(walk(TO_PUB), 'waiting_external', { reason_code: 'PROVIDER_UNAVAILABLE' }).ok)
  // a blocked task can be CANCELLED by the owner (that is an owner action too)
  assert.ok(step(step(walk(TO_IMPL), 'blocked', { reason_code: 'OWNER_DECISION_REQUIRED' }).task, 'cancelled', { owner_action_id: 'o2' }).ok)
})

test('P6 reducer: the re-verification back-edge exists ONLY publishing → testing with APPROVALS_EXPIRED, and invalidates the approvals it replaces', async () => {
  const R = await patchedReducer(); const { step, walk } = runner(R)
  const pub = walk(TO_PUB)
  assert.equal(step(pub, 'testing').problems[0], 'TRANSITION.REASON_NOT_ALLOWED_FOR_STATE')
  const r = step(pub, 'testing', { reason_code: 'APPROVALS_EXPIRED' }); assert.ok(r.ok); assert.deepEqual(r.invalidated, ['test_results', 'independent_review', 'security_review'])
  assert.equal(step(walk(TO_IMPL.concat(['testing', 'independent_review'])), 'testing', { reason_code: 'APPROVALS_EXPIRED' }).ok, false, 'not from any other state')
})

test('forged or absent owner-action evidence (proposal test configuration with an owner-action verifier): refused at the ledger before the reducer', async () => {
  const R = await patchedReducer()
  const issued = new Set(['owner-decision-REAL'])
  const L = Ledger.open(':memory:', { proposalReducer: R, ownerActionVerifier: (_t, id) => issued.has(id) })
  const id = L.submitTask({ repository: 'henilllpatelll/PatelRep', base_sha: '5ced4d309cf3532a490a48dbd06c575994822eac', requirements: { text: 'x' }, scope: { allowed_paths: ['apps/mobile/**'] }, acceptance: { criteria: ['c'] }, risk_class: 'routine' }).task.task_id
  for (const s of TO_IMPL) assert.ok(L.transition(id, s).ok)
  L.transition(id, 'blocked', { reason_code: 'OWNER_DECISION_REQUIRED' })
  assert.equal(L.transition(id, 'implementing', { owner_action_id: 'owner-decision-FORGED' }).problems[0], 'EVENT.OWNER_ACTION_UNVERIFIED')
  assert.equal(L.transition(id, 'implementing').problems[0], 'TRANSITION.OWNER_ACTION_REQUIRED')
  assert.ok(L.transition(id, 'implementing', { owner_action_id: 'owner-decision-REAL' }).ok)
  L.close()
  assert.throws(() => Ledger.open(path.join(ROOT, 'never-created.sqlite'), { proposalReducer: R }), /OUTSIDE_TEMP/, 'a proposal reducer is refused for any non-temporary ledger')
  assert.throws(() => Ledger.open(':memory:', { proposalReducer: { ...R, label: 'AUTHORITATIVE' } }), /PROPOSAL_REDUCER_INVALID/)
  const f = path.join(tmpDir(), 'p.sqlite'); Ledger.open(f, { proposalReducer: R }).close()
  assert.throws(() => Ledger.open(f), /REDUCER_MISMATCH/, 'a proposal ledger can never be reopened as an authoritative one')
})

test('PROPOSAL CONFIGURATION, engine end to end: approvals older than the re-attestation bound are REPLACED by a NEW test run and NEW reviews of the SAME candidate — never extended — then the handoff proceeds', async () => {
  const R = await patchedReducer(); let h; let fired = false
  h = H({ ledgerOptions: { proposalReducer: R }, hook: (name) => { if (name === 'after_evidence_accepted' && !fired && h.ledger.db.prepare("SELECT COUNT(*) c FROM evidence WHERE evidence_type='security_review'").get().c === 1) { fired = true; h.clock.advance(25 * 3600_000)
    // the 25 h outage also aged the extra-usage fact; the owner re-verified billing safety meanwhile (the long-wait behaviour itself is d35-long-wait's subject)
    const g = h.adapters.subscription.load(); h.adapters.subscription.save({ ...g, extra_usage: { ...g.extra_usage, verified_at: h.clock.now() - 1000 } }) } } })
  try {
    const id = h.submit(); await drive(h)
    const L = h.ledger; const t = L.getTask(id); const cand = L.currentCandidate(id)
    assert.equal(t.handoff_ready, 1, `handoff after re-verification (state ${t.state}, suspension ${JSON.stringify(L.getSuspension(id))})`)
    assert.ok(L.recoveryHistory(id).some((r) => r.kind === 'reverification_scheduled'))
    assert.equal(L.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=?').get(id).c, 2, 'a NEW test run was bought')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM reviews WHERE task_id=? AND kind='independent_review'").get(id).c, 2, 'a NEW independent review was bought')
    const pkg = JSON.parse(L.meta(`handoff:${id}`))
    for (const e of pkg.evidence) { const row = L.db.prepare('SELECT candidate_sha, tree_digest, expires_at, accepted_at FROM evidence WHERE evidence_id=?').get(e.evidence_id); assert.equal(row.candidate_sha, cand.candidate_sha); assert.ok(row.expires_at > h.clock.now(), 'only current, unexpired approvals'); assert.ok(row.accepted_at > h.clock.now() - 3600_000, `${e.type} is replacement evidence, not the old approval`) }
    for (const type of ['test_results', 'independent_review', 'security_review']) assert.ok(satisfyingEvidence(L, id, h.policy, type).length >= 1)
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
})

test('PROPOSAL CONFIGURATION: a technical suspension is VISIBLE in the lifecycle (technical_suspension) and resumes automatically after its cool-down; cancellation is an owner-only terminal transition', async () => {
  const R = await patchedReducer()
  const h = H({ ledgerOptions: { proposalReducer: R }, scenario: { stages: { planning: [{ fail: 'SESSION.TRANSIENT', failTimes: 4 }] } }, cfg: { retry: { maxAttemptsPerFingerprint: 1 }, technical: { cooldownsMs: [60_000, 60_000, 60_000] } } })
  try {
    const id = h.submit(); await drive(h)
    const L = h.ledger
    assert.ok(L.db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id=? AND to_state='technical_suspension'").get(id).c >= 1, 'the suspension is a lifecycle state under P6')
    assert.equal(L.getTask(id).handoff_ready, 1, 'and it resumed by itself')
    const id2 = h.submit({ requirements: { text: 'to be cancelled' } })
    assert.equal(L.cancel(id2).problems[0], 'TASK.OWNER_ACTION_REQUIRED')
    assert.ok(L.cancel(id2, { ownerActionId: 'owner-cancel-7' }).ok); assert.equal(L.getTask(id2).state, 'cancelled')
  } finally { h.close() }
})
