// D3.6-B — the deterministic authority EVALUATOR at every external-effect boundary, with correct consumed-evidence semantics. SIMULATED; temp ledgers; test keys.
// The AUTHORITATIVE configuration refuses every delivery effect; the labelled PROPOSAL_UNDER_TEST configuration (P7 on a disposable copy, actions activated in a TEST policy) shows the
// authorization path itself. Nothing here can reach a real remote.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate as realEvaluate } from '../authority/evaluator.mjs'
import { authorizeIntent, reauthorize, trustedFacts, DurableEvidenceView, ACTION_IDENTITY } from '../orchestrator/delivery/authorize.mjs'
import { acceptEvidence, usableEvidence } from '../orchestrator/ledger/evidence-store.mjs'
import { consumerOf, getIntent } from '../orchestrator/ledger/intents.mjs'
import { ensureDelivery } from '../orchestrator/delivery/state.mjs'
import { auth, harness, ops, state, toHandoff, untilState } from './d36-helpers.mjs'

async function ready(o = {}) {
  const h = await harness(o); const id = h.submit(o.task ?? {}); await toHandoff(h, id); const d = ensureDelivery(h.ledger, id)
  const ta = await h.delivery.accept(h.issuers.task_ingress, 'issue_task_authority', { task_id: id }); assert.ok(ta.ok, ta.code)
  const t = () => h.ledger.getTask(id)
  const pub = (over = {}) => ({ repository: t().repository, branch: d.branch, sha: t().head_sha, expected_old: null, ...over })
  const create = (key, over = {}, action = 'publish_candidate_branch', params = pub(over)) => authorizeIntent(h.delivery.ctx(), { taskId: id, action, idempotencyKey: key, params, evaluatorParams: h.delivery.evaluatorParams(action, params), validateParams: h.delivery.validator(action) })
  const again = (iid, mode = 'dispatch') => { const i = getIntent(h.ledger, iid); const p = JSON.parse(i.params_json); return reauthorize(h.delivery.ctx(), iid, { mode, validateParams: h.delivery.validator(i.action), evaluatorParams: h.delivery.evaluatorParams(i.action, p) }) }
  return { h, id, d, t, pub, create, again }
}
const consumedRows = (h, id) => h.ledger.db.prepare('SELECT evidence_id, evidence_type, consumed_by FROM evidence WHERE task_id=? AND consumed_at IS NOT NULL').all(id).map((r) => ({ ...r }))

test('creation: the EVALUATOR decides BEFORE anything is consumed; multi-use approvals are CITED, not consumed; the intent records the authorized request digest', async () => {
  const S = await ready()
  const r = await S.create('pub-1'); assert.ok(r.ok, JSON.stringify(r.decision?.reason_codes ?? r.code))
  assert.equal(r.decision.decision, 'allow'); assert.deepEqual(r.decision.consumes, [], 'publish requires no single-use evidence')
  const i = getIntent(S.h.ledger, r.intent.intent_id)
  assert.equal(i.authorized_request_digest, r.decision.request_digest); assert.deepEqual(JSON.parse(i.consumed_ids_json), [])
  const cited = JSON.parse(i.evidence_ids_json); const types = cited.map((e) => S.h.ledger.db.prepare('SELECT evidence_type FROM evidence WHERE evidence_id=?').get(e).evidence_type).sort()
  assert.deepEqual(types, ['independent_review', 'security_review', 'task_authority', 'test_results'], 'contract evidence + the delivery/risk strengthening (independent + security review)')
  assert.deepEqual(consumedRows(S.h, S.id), [], 'nothing consumed: the same approvals can authorize the next delivery step')
  const r2 = await S.create('pr-x', {}, 'open_draft_pull_request', { repository: S.t().repository, branch: S.d.branch, head: S.d.branch, base: 'main', head_sha: S.t().head_sha, draft: true, title: 't', body_digest: 'a'.repeat(64), author: 'patelrep-v3-publisher[bot]' })
  assert.equal(r2.ok, false); assert.ok((r2.decision?.reason_codes ?? []).includes('EVIDENCE.MISSING:publication_receipt'), 'a PR needs a publication receipt first'); S.h.close()
})

test('single-use evidence: consumed ONLY on allow, atomically with the intent; a refusal consumes NOTHING; the same intent re-validates with it held; another intent can never reuse it (replay)', async () => {
  const S = await ready({ gh: { ci: { default: ['fail_transient', 'pass'] }, logs: { fail_transient: 'npm ERR! network request failed: ETIMEDOUT registry.npmjs.org' } }, dcfg: { maxCiRerunsPerCandidate: 0 } })
  const r0 = await S.h.drive({ until: () => !!S.h.ledger.getSuspension(S.id), maxRounds: 120 }); assert.ok(r0.done, 'drove to the transient CI failure (re-runs disabled for this test)')
  assert.equal(state(S.h, S.id), 'ci_running'); await S.h.delivery.observeDelivery(S.id)
  const fail = S.h.delivery.obsCache.get(S.id).details.ci.checks.find((c) => c.state === 'failed'); assert.ok(fail)
  const dg = await S.h.delivery.accept(S.h.issuers.delivery_verifier, 'issue_ci_failure_diagnosis', { task_id: S.id, run_id: fail.run_id, attempt: fail.attempt }); assert.ok(dg.ok, dg.code)
  const params = { repository: S.t().repository, branch: S.d.branch, run_id: fail.run_id, attempt: fail.attempt, head_sha: S.t().head_sha }
  // (a) refusal consumes nothing: the EVALUATOR denies (a target the task does not own) while the single-use diagnosis is present and would otherwise be consumed
  const denied = await authorizeIntent(S.h.delivery.ctx(), { taskId: S.id, action: 'rerun_ci_jobs', idempotencyKey: 'rerun-A', params, evaluatorParams: { delivery: { repository: S.t().repository, branch: 'dh3/not-this-task', run_id: fail.run_id } } })
  assert.equal(denied.ok, false); assert.ok(denied.decision.reason_codes.includes('DELIVERY.BRANCH_NOT_TASK_OWNED'), String(denied.decision.reason_codes))
  assert.deepEqual(consumedRows(S.h, S.id), [], 'atomic refusal: the single-use diagnosis is NOT consumed'); assert.equal(S.h.ledger.db.prepare("SELECT COUNT(*) c FROM action_intents WHERE action='rerun_ci_jobs'").get().c, 0, 'and no intent row exists')
  // an invalidated artifact is never revived by re-accepting the same envelope
  const receipt = usableEvidence(S.h.ledger, S.id, S.h.policy, { types: ['publication_receipt'] })[0]; S.h.ledger.invalidateEvidence(receipt.evidence_id)
  assert.equal((await S.h.delivery.accept(S.h.issuers.trusted_publisher, 'issue_publication_receipt', { task_id: S.id })).code, 'EVIDENCE.REISSUE_OF_INVALIDATED')
  S.h.ledger.db.prepare('UPDATE evidence SET invalidated_at=NULL WHERE evidence_id=?').run(receipt.evidence_id) // test fixture: restore it for the allow case below
  // (b) allow: consumed exactly what the evaluator returned
  const ok = await S.create('rerun-B', {}, 'rerun_ci_jobs', params); assert.ok(ok.ok, JSON.stringify(ok.decision?.reason_codes ?? ok.code))
  assert.deepEqual(ok.decision.consumes, [dg.evidence_id]); assert.deepEqual(consumedRows(S.h, S.id).map((r) => [r.evidence_id, r.consumed_by]), [[dg.evidence_id, consumerOf('rerun-B')]])
  // (c) the SAME intent re-validates with its own consumed evidence counted as HELD, and dispatch never consumes anything new
  const disp = await S.again(ok.intent.intent_id); assert.ok(disp.ok, JSON.stringify(disp.decision?.reason_codes ?? disp.code)); assert.deepEqual(disp.decision.consumes, [dg.evidence_id])
  // (d) replay: another intent cannot use it — not through the store (it is gone from the usable pool) and not by handing the envelope to the evaluator directly
  const other = await S.create('rerun-C', {}, 'rerun_ci_jobs', params); assert.equal(other.ok, false); assert.ok(other.decision.reason_codes.includes('EVIDENCE.MISSING:ci_failure_diagnosis'))
  const env = JSON.parse(S.h.ledger.db.prepare('SELECT envelope_json FROM evidence WHERE evidence_id=?').get(dg.evidence_id).envelope_json)
  const tf = await trustedFacts(S.h.ledger, S.id, 'trusted_publisher', S.h.delivery.evalFacts())
  const A = await auth(); const View = (await import('../orchestrator/delivery/authorize.mjs')).durableViewClass(A.evidence.EvidenceLedger)
  const direct = A.evaluate({ policy: S.h.policy, request: { action: 'rerun_ci_jobs', task_id: S.id, params: S.h.delivery.evaluatorParams('rerun_ci_jobs', params) }, trusted: tf.trusted, evidence: [env, ...usableEvidence(S.h.ledger, S.id, S.h.policy).map((r) => r.envelope)], now: S.h.ledger.now(), ledger: new View(S.h.ledger, consumerOf('rerun-C')) })
  assert.equal(direct.decision, 'deny'); assert.ok(direct.rejected_evidence.some((x) => x.evidence_id === dg.evidence_id && x.codes.includes('EVIDENCE.REPLAYED')), 'consumed by another intent = a replay')
  // (e) consumed evidence is NEVER made reusable: the store row stays consumed by rerun-B
  assert.equal(S.h.ledger.db.prepare('SELECT consumed_by FROM evidence WHERE evidence_id=?').get(dg.evidence_id).consumed_by, consumerOf('rerun-B')); S.h.close()
})

test('unknown actions, prototype keys, forged and wrong identities are refused before any effect', async () => {
  const S = await ready()
  for (const action of ['merge_pull_request', 'production_release', 'constructor', '__proto__', 'toString', 'push_to_main_directly', 'nope']) {
    const r = await S.create(`k-${action}`, {}, action); assert.equal(r.ok, false); assert.equal(r.code, 'DELIVERY.ACTION_NOT_A_DELIVERY_ACTION', action)
  }
  assert.equal(Object.isFrozen(ACTION_IDENTITY), true); assert.equal(ACTION_IDENTITY.publish_candidate_branch, 'trusted_publisher')
  const A = await auth(); const tf = await trustedFacts(S.h.ledger, S.id, 'implementer', S.h.delivery.evalFacts()); const pool = usableEvidence(S.h.ledger, S.id, S.h.policy).map((r) => r.envelope)
  const asImpl = A.evaluate({ policy: S.h.policy, request: { action: 'publish_candidate_branch', task_id: S.id, ...(S.h.delivery.evaluatorParams('publish_candidate_branch', S.pub()) ? { params: S.h.delivery.evaluatorParams('publish_candidate_branch', S.pub()) } : {}) }, trusted: tf.trusted, evidence: pool, now: S.h.ledger.now(), ledger: new DurableEvidenceView(S.h.ledger, 'x') })
  assert.ok(asImpl.reason_codes.includes('IDENTITY.NOT_PERMITTED:implementer'), 'the implementer can never publish')
  const tp = await trustedFacts(S.h.ledger, S.id, 'trusted_publisher', S.h.delivery.evalFacts())
  const forged = A.evaluate({ policy: S.h.policy, request: { action: 'publish_candidate_branch', task_id: S.id, claimed_identity: 'merger', ...(S.h.delivery.evaluatorParams('publish_candidate_branch', S.pub()) ? { params: S.h.delivery.evaluatorParams('publish_candidate_branch', S.pub()) } : {}) }, trusted: tp.trusted, evidence: pool, now: S.h.ledger.now(), ledger: new DurableEvidenceView(S.h.ledger, 'x') })
  assert.ok(forged.reason_codes.includes('IDENTITY.CLAIM_MISMATCH'), 'a claimed identity is checked, never used'); S.h.close()
})

test('AUTHORITATIVE policy: every delivery effect is refused (inactive or unknown), ONE terminal explained suspension, and nothing ever reaches the remote', async () => {
  const h = await harness({ proposal: false }); const id = h.submit()
  const r = await h.drive({ until: untilState(h, id, []), maxRounds: 200 }); assert.ok(r.done)
  const s = h.ledger.getSuspension(id); assert.equal(s.cause, 'DELIVERY_NOT_ACTIVATED'); assert.equal(s.disposition, 'terminal'); assert.ok(s.diagnostics.codes.includes('ACTIVATION.NOT_ACTIVE:publish_candidate_branch'))
  assert.equal(ops(h).length, 0, 'no push, no PR, no rerun, no dispatch'); assert.equal(h.ledger.db.prepare('SELECT COUNT(*) c FROM action_intents').get().c, 0, 'no intent is even created: creation requires an evaluator ALLOW')
  ensureDelivery(h.ledger, id)
  for (const action of ['open_draft_pull_request', 'update_pull_request_metadata', 'rerun_ci_jobs', 'dispatch_staging_candidate']) {
    const x = await authorizeIntent(h.delivery.ctx(), { taskId: id, action, idempotencyKey: `a-${action}`, params: {} }); assert.equal(x.ok, false); assert.ok(x.decision.reason_codes.includes('ACTION.UNKNOWN'), `${action} is not in the authoritative contract (P7)`)
  }
  assert.deepEqual(h.policy.contract.activation.active_actions, [], 'the authoritative contract activates nothing'); h.close()
})

test('wrong repository, base, head, tree and fencing identity: the evaluator refuses on the RE-DERIVED facts, at creation and again before dispatch', async () => {
  const S = await ready(); const real = S.h.dfacts.candidate
  for (const [name, patch, code] of [['repository', { repository: 'someone/else' }, 'EVIDENCE.WRONG_REPOSITORY'], ['base', { base_sha: 'f'.repeat(40) }, 'EVIDENCE.WRONG_BASE_SHA'], ['head', { candidate_sha: 'e'.repeat(40) }, 'EVIDENCE.WRONG_CANDIDATE_SHA'], ['tree', { tree_digest: 'd'.repeat(40) }, 'EVIDENCE.WRONG_TREE_DIGEST']]) {
    S.h.dfacts.candidate = async (t) => { const f = await real(t); return { ...f, facts: { ...f.facts, ...patch } } }
    const r = await S.create(`w-${name}`); assert.equal(r.ok, false, name); assert.ok(r.decision.rejected_evidence.some((x) => x.codes.includes(code)), `${name}: ${JSON.stringify(r.decision.rejected_evidence[0])}`)
  }
  S.h.dfacts.candidate = real
  const r = await S.create('ok-then-fence'); assert.ok(r.ok)
  const t = S.t(); assert.ok(S.h.ledger.applyLifecycleEvent(S.id, S.h.ledger.eventFor(S.id, 'worker_recovered', { new_fencing_token: t.fencing_token + 1 })).ok) // a recovery epoch
  const d = await S.again(r.intent.intent_id); assert.equal(d.ok, false); assert.ok(d.decision?.decision === 'deny' || /FENCING/.test(d.code), JSON.stringify(d.code))
  assert.equal(getIntent(S.h.ledger, r.intent.intent_id).status, 'intended', 'a refused re-authorization changes nothing'); S.h.close()
})

test('approvals: a failing review never authorizes; an expired approval blocks dispatch; a key the active policy no longer pins invalidates what it signed', async () => {
  const S = await ready(); const A = await auth()
  const tf = await trustedFacts(S.h.ledger, S.id, 'trusted_publisher', S.h.delivery.evalFacts()); const pool = usableEvidence(S.h.ledger, S.id, S.h.policy).map((r) => r.envelope)
  // a FAILING approval, authentically shaped: the same envelope with the verdict flipped no longer verifies, and a pass with an open HIGH finding is not satisfying
  const ir = pool.find((e) => e.payload.evidence_type === 'security_review'); const tampered = structuredClone(ir); tampered.payload.verdict = 'findings_open' // an approval the evaluator REQUIRES here (risk class, P7)
  const d1 = A.evaluate({ policy: S.h.policy, request: { action: 'publish_candidate_branch', task_id: S.id, ...(S.h.delivery.evaluatorParams('publish_candidate_branch', S.pub()) ? { params: S.h.delivery.evaluatorParams('publish_candidate_branch', S.pub()) } : {}) }, trusted: tf.trusted, evidence: [tampered, ...pool.filter((e) => e !== ir)], now: S.h.ledger.now(), ledger: new DurableEvidenceView(S.h.ledger, 'x') })
  assert.equal(d1.decision, 'deny'); assert.ok(d1.rejected_evidence.some((x) => x.codes.includes('EVIDENCE.BAD_SIGNATURE'))); assert.ok(d1.reason_codes.includes('EVIDENCE.MISSING:security_review'))
  const r = await S.create('exp'); assert.ok(r.ok)
  S.h.clock.advance(7 * 3600_000) // test_results live 6 h
  const d = await S.again(r.intent.intent_id); assert.equal(d.ok, false); assert.ok((d.decision?.reason_codes ?? []).some((c) => /EVIDENCE\.(MISSING|NOT_PASSING)/.test(c)) || /EXPIRED/.test(d.code ?? ''), JSON.stringify(d.decision?.reason_codes ?? d.code))
  // a policy that no longer pins the orchestrator key: everything it signed is unknown-key evidence
  const keys = { ...S.h.pol.bundle.trusted_keys }; delete keys[S.h.pol.keyIds.orchestrator]
  const nb = A.buildPolicyBundle({ contract: S.h.pol.bundle.contract, trusted_keys: keys, parent_revision: S.h.policy.revision }); const np = A.loadPolicy(nb, A.policyRevision(nb)); assert.ok(np.ok)
  const d2 = A.evaluate({ policy: np.policy, request: { action: 'publish_candidate_branch', task_id: S.id }, trusted: tf.trusted, evidence: pool, now: S.h.ledger.now(), ledger: new DurableEvidenceView(S.h.ledger, 'x') })
  assert.equal(d2.decision, 'deny'); assert.ok(d2.rejected_evidence.some((x) => x.codes.includes('EVIDENCE.UNKNOWN_KEY')) && d2.rejected_evidence.some((x) => x.codes.includes('EVIDENCE.WRONG_POLICY_REVISION'))); S.h.close()
})

test('risk class: a task that requires a security review never publishes without one — in the delivery layer under the AUTHORITATIVE evaluator, and in the evaluator itself under P7', async () => {
  for (const proposal of [false, true]) {
    const S = await ready({ proposal, activate: ['publish_candidate_branch'] })
    for (const e of usableEvidence(S.h.ledger, S.id, S.h.policy, { types: ['security_review'] })) S.h.ledger.invalidateEvidence(e.evidence_id)
    const r = await S.create(`sec-${proposal}`); assert.equal(r.ok, false)
    if (proposal) assert.ok(r.decision.reason_codes.includes('EVIDENCE.MISSING:security_review'), 'P7: the evaluator adds the security review for the risk class')
    else { assert.equal(r.decision.decision, 'allow', 'the authoritative contract alone would allow publish on task_authority + test_results'); assert.equal(r.code, 'DELIVERY.REQUIRED_EVIDENCE_MISSING:security_review') }
    S.h.close()
  }
})

test('protected paths, the customer Agent Harness and historical migrations are refused on the RE-DERIVED change set, whatever the requester says', async () => {
  const S = await ready(); const real = S.h.dfacts.candidate
  const cases = [
    [[{ status: 'M', path: '.github/workflows/ci.yml' }], 'CONTROL_PLANE.NOT_AUTHORIZED_BY_TASK'],
    [[{ status: 'M', path: 'scripts/developer-harness-v3/authority/evaluator.mjs' }], 'ROOT_OF_TRUST.OWNER_CEREMONY_REQUIRED'],
    [[{ status: 'M', path: 'supabase/migrations/001_init.sql' }], 'MIGRATION.HISTORICAL_MODIFIED'],
    [[{ status: 'A', path: 'apps/mobile/x.ts' }, { status: 'A', path: 'apps/api/routers/agent_runtime/worker.py' }], 'CUSTOMER_AGENT.ACTIVATION_TRIPWIRE'],
    [[{ status: 'A', path: 'apps/mobile/x.ts' }, { status: 'A', path: 'apps/api/routers/agent_runtime/worker.py' }], 'SCOPE.OUT_OF_SCOPE'],
  ]
  for (const [changes, code] of cases) {
    S.h.dfacts.candidate = async (t) => { const f = await real(t); return { ...f, facts: { ...f.facts, changes, added_lines: { 'apps/api/routers/agent_runtime/worker.py': ['agent execution enabled = true; update tenants set autonomy = 1'] } } } }
    const r = await S.create(`p-${code}`); assert.equal(r.ok, false); assert.ok(r.decision.reason_codes.some((c) => c.startsWith(code)), `${code}: ${r.decision.reason_codes}`)
  }
  // a NEW migration on a base that is no longer main's tip is refused until the task is re-based (MIGRATION.BASE_NOT_CURRENT drives the base update)
  S.h.github.advanceMain('a'.repeat(40))
  S.h.dfacts.candidate = async (t) => { const f = await real(t); return { ...f, facts: { ...f.facts, changes: [{ status: 'A', path: 'apps/mobile/x.ts' }, { status: 'A', path: 'supabase/migrations/263_new_thing.sql' }] } } }
  const m = await S.create('p-mig-base'); assert.ok(m.decision.reason_codes.includes('MIGRATION.BASE_NOT_CURRENT'), String(m.decision.reason_codes))
  S.h.dfacts.candidate = real; S.h.close()
})

test('P7 delivery_target (on the NEW delivery actions): the requester can only NAME a target; branch, PR, run and head ownership come from the trusted delivery record', async () => {
  const S = await ready(); const A = await auth(); await S.h.drive({ until: () => state(S.h, S.id) === 'ci_running', maxRounds: 200 }) // published: a PR the task owns now exists
  const View = (await import('../orchestrator/delivery/authorize.mjs')).durableViewClass(A.evidence.EvidenceLedger)
  const tf = await trustedFacts(S.h.ledger, S.id, 'trusted_publisher', S.h.delivery.evalFacts()); const pool = usableEvidence(S.h.ledger, S.id, S.h.policy).map((r) => r.envelope)
  const ev = (delivery) => A.evaluate({ policy: S.h.policy, request: { action: 'update_pull_request_metadata', task_id: S.id, params: { delivery } }, trusted: tf.trusted, evidence: pool, now: S.h.ledger.now(), ledger: new View(S.h.ledger, 'x') })
  const good = { repository: S.t().repository, branch: S.d.branch, head_sha: S.t().head_sha, pr_number: S.h.ledger.delivery(S.id).pr_number }
  assert.equal(ev(good).decision, 'allow', JSON.stringify(ev(good).reason_codes))
  for (const [patch, code] of [[{ branch: 'main' }, 'DELIVERY.BRANCH_NOT_TASK_OWNED'], [{ branch: 'dh3/another-task' }, 'DELIVERY.BRANCH_NOT_TASK_OWNED'], [{ repository: 'evil/fork' }, 'DELIVERY.WRONG_REPOSITORY'], [{ head_sha: 'a'.repeat(40) }, 'DELIVERY.HEAD_NOT_CANDIDATE'], [{ pr_number: 999 }, 'DELIVERY.PR_NOT_OWNED'], [{ run_id: 1 }, 'DELIVERY.RUN_NOT_OWNED'], [{ base: 'release' }, 'DELIVERY.BASE_NOT_MAIN']]) {
    assert.ok(ev({ ...good, ...patch }).reason_codes.includes(code), `${JSON.stringify(patch)} -> ${code}`)
  }
  const noFacts = A.evaluate({ policy: S.h.policy, request: { action: 'update_pull_request_metadata', task_id: S.id, params: { delivery: good } }, trusted: { ...tf.trusted, delivery: undefined }, evidence: pool, now: S.h.ledger.now(), ledger: new View(S.h.ledger, 'x') })
  assert.ok(noFacts.reason_codes.includes('DELIVERY.TARGET_FACTS_MISSING')); S.h.close()
})

test('before dispatch: a candidate change, a policy change, a cancellation or a changed request each refuse, and a refusal changes nothing', async () => {
  const S = await ready()
  const a = await S.create('drift'); assert.ok(a.ok)
  const tamper = await S.create('req'); assert.ok(tamper.ok)
  S.h.ledger.db.prepare("UPDATE action_intents SET authorized_request_digest=? WHERE intent_id=?").run('0'.repeat(64), tamper.intent.intent_id)
  assert.equal((await S.again(tamper.intent.intent_id)).code, 'AUTHORITY.REQUEST_CHANGED')
  const b = S.h.ledger.db.prepare('SELECT COUNT(*) c FROM action_intents').get().c
  assert.ok(S.h.ledger.submitCandidate(S.id, { base_sha: S.h.ledger.currentBase(S.id), candidate_sha: '9'.repeat(40), tree_digest: '8'.repeat(40), patch_digest: '7'.repeat(64) }).ok) // head changed
  const d = await S.again(a.intent.intent_id); assert.equal(d.ok, false); assert.ok(['DELIVERY.HEAD_NOT_CANDIDATE', 'FACTS.UNKNOWN_CANDIDATE'].includes(d.code), d.code)
  assert.equal(getIntent(S.h.ledger, a.intent.intent_id).status, 'intended'); assert.equal(S.h.ledger.db.prepare('SELECT COUNT(*) c FROM action_intents').get().c, b)
  S.h.ledger.cancel(S.id); assert.equal((await S.again(a.intent.intent_id)).code, 'TASK.CANCELLED'); S.h.close()
  const T = await ready(); const x = await T.create('pol'); assert.ok(x.ok)
  assert.ok(T.h.ledger.applyLifecycleEvent(T.id, T.h.ledger.eventFor(T.id, 'policy_changed', { policy_revision: 'e'.repeat(64) })).ok)
  const y = await T.again(x.intent.intent_id); assert.equal(y.ok, false, 'a task whose policy revision moved can never dispatch under the old authorization'); T.h.close()
})

test('the authoritative D3.2 evaluator is UNCHANGED and still the one used outside the labelled proposal configuration', async () => {
  const S = await ready({ proposal: false, activate: ['publish_candidate_branch'] })
  assert.equal(S.h.delivery.evaluateFn, realEvaluate); assert.equal(S.h.label, 'AUTHORITATIVE')
  const r = await S.create('auth-pub'); assert.ok(r.ok, 'with publish ACTIVATED in a test policy the authoritative evaluator allows it (task_authority + test_results), and the delivery layer adds the reviews')
  assert.equal(r.decision.decision, 'allow'); S.h.close()
})
