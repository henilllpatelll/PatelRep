// D3.2 — adversarial and positive tests for the deterministic policy evaluator.
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadContractFile } from '../authority/contract.mjs'
import { EvidenceLedger } from '../authority/evidence.mjs'
import { evaluate } from '../authority/evaluator.mjs'
import { digestOf } from '../lib/canonical.mjs'
import { BASE, ENV_ID, HEAD, NOW, REPO, TREE, buildPolicy, candidate, evidence, iso, makeKeys, request, trustedFor } from './helpers.mjs'

const KEYS = makeKeys()
const SHIPPED = buildPolicy({ keys: KEYS })
const ACTIVE = buildPolicy({ keys: KEYS, activate: ['publish_candidate_branch', 'merge_pull_request', 'start_bypass_permissions_session', 'access_credential', 'production_release', 'verify_delivery_eligibility'] })
const ev = (type, o = {}, p = ACTIVE) => evidence(type, { policy: p.policy, keys: KEYS, ...o })
const run = (p, req, trusted, evidenceList = [], extra = {}) => evaluate({ policy: p.policy, request: req, trusted, evidence: evidenceList, now: NOW, ledger: new EvidenceLedger(), ...extra })
const publishTrusted = (over = {}) => trustedFor('trusted_publisher', over)
const publishEvidence = (p = ACTIVE, o = {}) => [ev('task_authority', o.task_authority ?? {}, p), ev('test_results', o.test_results ?? {}, p)]
const codes = (d) => d.reason_codes
/** task_authority evidence signed over exactly this task authority, as the trusted ingress would issue it */
const publishEvidenceFor = (t, p = ACTIVE) => [ev('task_authority', { over: { authority_digest: digestOf(t.task.authority) } }, p), ev('test_results', {}, p)]

test('a fully evidenced publication is allowed only once the policy ACTIVATES it; under the shipped policy it is dry-run only', () => {
  const ok = run(ACTIVE, request('publish_candidate_branch'), publishTrusted(), publishEvidence())
  assert.equal(ok.decision, 'allow', JSON.stringify(ok))
  assert.equal(ok.verified, true)
  assert.deepEqual(codes(ok), ['SAFEGUARDED_VERIFIED'])
  assert.equal(ok.policy_revision, ACTIVE.revision)
  assert.equal(ok.accepted_evidence.length, 2)

  const dry = run(SHIPPED, request('publish_candidate_branch'), publishTrusted(), publishEvidence(SHIPPED))
  assert.equal(dry.decision, 'deny')
  assert.deepEqual(codes(dry), ['ACTIVATION.NOT_ACTIVE:publish_candidate_branch'])
  assert.equal(dry.dry_run.requirements_met, true)
})

test('the evaluator is deterministic: same inputs, byte-identical decision', () => {
  const evd = publishEvidence()
  const a = run(ACTIVE, request('publish_candidate_branch'), publishTrusted(), evd)
  const b = run(ACTIVE, request('publish_candidate_branch'), publishTrusted(), evd)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

test('missing required evidence denies and names what is missing', () => {
  const d = run(ACTIVE, request('publish_candidate_branch'), publishTrusted(), [ev('task_authority')])
  assert.equal(d.decision, 'deny')
  assert.deepEqual(codes(d), ['EVIDENCE.MISSING:test_results'])
  assert.deepEqual(d.missing_evidence, ['test_results'])
  assert.deepEqual(codes(run(ACTIVE, request('publish_candidate_branch'), publishTrusted(), [])).sort(), ['EVIDENCE.MISSING:task_authority', 'EVIDENCE.MISSING:test_results'])
})

test('implementation identity cannot self-approve, merge, publish or review', () => {
  const impl = (a, evd = []) => run(ACTIVE, request(a), trustedFor('implementer'), evd)
  assert.deepEqual(codes(impl('self_approve_candidate')), ['ACTION.PROHIBITED:self_approve_candidate'])
  for (const a of ['merge_pull_request', 'publish_candidate_branch', 'mark_pull_request_ready', 'production_release', 'promote_policy', 'access_credential', 'verify_delivery_eligibility'])
    assert.ok(codes(impl(a)).includes('IDENTITY.NOT_PERMITTED:implementer'), a)
  // evidence "issued" in the implementer's name, even with a validly signed envelope from another identity's key
  const forged = ev('independent_review', { over: { issuer_identity: 'implementer' }, keyId: 'k-independent_reviewer' })
  const d = run(ACTIVE, request('accept_evidence'), trustedFor('orchestrator'), [forged])
  assert.ok(d.rejected_evidence[0].codes.includes('EVIDENCE.UNAUTHORIZED_ISSUER'))
  assert.ok(d.rejected_evidence[0].codes.includes('EVIDENCE.KEY_IDENTITY_MISMATCH'))
  assert.equal(d.decision, 'deny')
})

test('an identity claim that differs from the established identity is refused, never adopted', () => {
  const d = run(ACTIVE, request('read_repository', { claimed_identity: 'merger' }), trustedFor('implementer'))
  assert.deepEqual(codes(d), ['IDENTITY.CLAIM_MISMATCH'])
  const t = run(ACTIVE, request('read_repository', { task_id: 'task-OTHER' }), trustedFor('implementer'))
  assert.deepEqual(codes(t), ['TASK.MISMATCH'])
})

test('a candidate cannot select its own policy revision', () => {
  const d = run(ACTIVE, request('publish_candidate_branch', { claimed_policy_revision: 'e'.repeat(64) }), publishTrusted(), publishEvidence())
  assert.equal(d.decision, 'deny')
  assert.ok(codes(d).includes('POLICY.CLAIMED_REVISION_REJECTED'))
  // evidence minted under a different (e.g. weaker, candidate-supplied) policy revision does not satisfy the active one
  const weaker = buildPolicy({ keys: KEYS, mutate: (c) => { c.evidence_types.test_results.max_ttl_seconds = 604800 } })
  const wrong = [ev('task_authority', {}, weaker), ev('test_results', {}, weaker)]
  const d2 = run(ACTIVE, request('publish_candidate_branch'), publishTrusted(), wrong)
  assert.equal(d2.decision, 'deny')
  assert.equal(d2.rejected_evidence.length, 2)
  assert.ok(d2.rejected_evidence.every((r) => r.codes.includes('EVIDENCE.WRONG_POLICY_REVISION')))
})

test('a candidate that edits the verification definitions is denied (root of trust), and its own reviews cannot rescue it', () => {
  for (const p of ['docs/developer-harness-v3/authority-contract.json', 'scripts/developer-harness-v3/authority/evaluator.mjs', 'scripts/developer-harness-v3/lib/canonical.mjs', '.claude/settings.json', '.claude/hooks/policy-hook.mjs']) {
    const t = publishTrusted({ candidate: candidate({ changes: [{ status: 'M', path: p }] }) })
    t.task.authority.allowed_paths = ['**']; t.task.authority.control_plane_authorized = true; t.task.authority.protected_paths_authorized = true
    const d = run(ACTIVE, request('publish_candidate_branch'), t, [...publishEvidenceFor(t), ev('independent_review'), ev('security_review')])
    assert.equal(d.decision, 'deny', p)
    assert.ok(codes(d).includes('ROOT_OF_TRUST.OWNER_CEREMONY_REQUIRED'), p)
  }
})

test('control-plane and protected-path edits need task authorization plus both independent reviews', () => {
  const t = (auth = {}) => { const x = publishTrusted({ candidate: candidate({ changes: [{ status: 'M', path: '.github/workflows/ci.yml' }] }) }); Object.assign(x.task.authority, { allowed_paths: ['.github/**'], ...auth }); return x }
  assert.ok(codes(run(ACTIVE, request('publish_candidate_branch'), t(), publishEvidenceFor(t()))).includes('CONTROL_PLANE.NOT_AUTHORIZED_BY_TASK'))
  const authorized = t({ control_plane_authorized: true, protected_paths_authorized: true })
  const base = publishEvidenceFor(authorized)
  assert.deepEqual(codes(run(ACTIVE, request('publish_candidate_branch'), authorized, base)).sort(), ['EVIDENCE.MISSING:independent_review', 'EVIDENCE.MISSING:security_review'])
  const full = run(ACTIVE, request('publish_candidate_branch'), authorized, [...base, ev('independent_review'), ev('security_review')])
  assert.equal(full.decision, 'allow', JSON.stringify(full))
  const same = run(ACTIVE, request('publish_candidate_branch'), authorized, [...base, ev('independent_review', { over: { context_id: 'ctx-x' } }), ev('security_review', { over: { context_id: 'ctx-x' } })])
  assert.ok(codes(same).includes('EVIDENCE.REVIEW_CONTEXTS_NOT_DISTINCT'))
  const selfReview = run(ACTIVE, request('publish_candidate_branch'), authorized, [...base, ev('independent_review', { over: { context_id: 'ctx-author' } }), ev('security_review')])
  assert.equal(selfReview.decision, 'deny')
  assert.ok(selfReview.rejected_evidence[0].codes.includes('EVIDENCE.NOT_INDEPENDENT'))
})

test('evidence bound to the wrong candidate, tree, base, repository, environment, task or fencing token is rejected', () => {
  const cases = {
    'EVIDENCE.WRONG_CANDIDATE_SHA': { candidate_sha: 'b'.repeat(40) },
    'EVIDENCE.WRONG_TREE_DIGEST': { tree_digest: 'b'.repeat(40) },
    'EVIDENCE.WRONG_BASE_SHA': { base_sha: 'b'.repeat(40) },
    'EVIDENCE.WRONG_REPOSITORY': { repository: 'someone/else' },
    'EVIDENCE.WRONG_ENVIRONMENT': { environment_id: 'vm-other' },
    'EVIDENCE.WRONG_POLICY_REVISION': { policy_revision: 'a'.repeat(64) },
    'EVIDENCE.WRONG_TASK': { task_id: 'task-2' },
    'EVIDENCE.STALE_FENCING_TOKEN': { fencing_token: 6 },
    'EVIDENCE.WRONG_PATCH_DIGEST': { patch_digest: 'a'.repeat(64) },
  }
  for (const [code, over] of Object.entries(cases)) {
    const d = run(ACTIVE, request('publish_candidate_branch'), publishTrusted(), [ev('task_authority'), ev('test_results', { over })])
    assert.equal(d.decision, 'deny', code)
    assert.ok(d.rejected_evidence.some((r) => r.codes.includes(code)), `${code}: ${JSON.stringify(d.rejected_evidence)}`)
    assert.ok(codes(d).includes('EVIDENCE.MISSING:test_results'), code)
  }
  const future = run(ACTIVE, request('publish_candidate_branch'), publishTrusted(), [ev('task_authority'), ev('test_results', { over: { fencing_token: 8 } })])
  assert.ok(future.rejected_evidence[0].codes.includes('EVIDENCE.STALE_FENCING_TOKEN'), 'a newer token is as ambiguous as an older one')
})

test('stale, future-dated, over-long and not-yet-valid evidence is rejected', () => {
  const t = (over) => run(ACTIVE, request('publish_candidate_branch'), publishTrusted(), [ev('task_authority'), ev('test_results', { over })]).rejected_evidence[0]?.codes ?? []
  assert.ok(t({ issued_at: iso(NOW - 200_000_000), expires_at: iso(NOW - 1000) }).includes('EVIDENCE.EXPIRED'))
  assert.ok(t({ issued_at: iso(NOW + 3_600_000), expires_at: iso(NOW + 7_000_000) }).includes('EVIDENCE.FROM_THE_FUTURE'))
  assert.ok(t({ issued_at: iso(NOW - 60_000), expires_at: iso(NOW + 999_999_999) }).includes('EVIDENCE.TTL_TOO_LONG'))
  assert.ok(t({ issued_at: iso(NOW), expires_at: iso(NOW - 5000) }).includes('EVIDENCE.INVERTED_VALIDITY'))
  assert.ok(t({ issued_at: '2025-01-01T00:00:00Z', expires_at: '2025-01-01T01:00:00Z' }).includes('EVIDENCE.EXPIRED'))
})

test('forged and unauthorized evidence: bad signature, unknown key, wrong issuer, tampered payload, checksum-only', () => {
  const good = ev('test_results')
  const tampered = structuredClone(good); tampered.payload.candidate_sha = HEAD; tampered.payload.verdict = 'pass'; tampered.payload.results = { passed: 1 }
  const other = makeKeys(['orchestrator'])
  const reSigned = ev('test_results', { signWith: other.privateKeys['k-orchestrator'] }) // signed by a key that is not the pinned one
  const unknownKey = ev('test_results'); unknownKey.signature.key_id = 'k-unknown'
  const wrongIssuer = ev('independent_review', { over: { issuer_identity: 'orchestrator' }, keyId: 'k-orchestrator' })
  const checksumOnly = structuredClone(good); checksumOnly.signature.value = 'A'.repeat(86) + '=='
  const reject = (e, type = 'test_results') => run(ACTIVE, request('accept_evidence'), trustedFor('orchestrator'), [e]).rejected_evidence[0]?.codes ?? ['ACCEPTED']
  assert.ok(reject(tampered).includes('EVIDENCE.BAD_SIGNATURE'))
  assert.ok(reject(reSigned).includes('EVIDENCE.BAD_SIGNATURE'))
  assert.ok(reject(unknownKey).includes('EVIDENCE.UNKNOWN_KEY'))
  assert.ok(reject(wrongIssuer).includes('EVIDENCE.UNAUTHORIZED_ISSUER'))
  assert.ok(reject(checksumOnly).includes('EVIDENCE.BAD_SIGNATURE'))
  // under the shipped bundle shape (no keys at all) nothing is authenticated
  const empty = buildPolicy({ keys: { privateKeys: {}, trusted_keys: {} } })
  const d = evaluate({ policy: empty.policy, request: request('accept_evidence'), trusted: trustedFor('orchestrator'), evidence: [good], now: NOW })
  assert.ok(d.rejected_evidence[0].codes.includes('EVIDENCE.UNKNOWN_KEY'))
})

test('malformed envelopes never throw and never get accepted', () => {
  const junk = [null, undefined, 'x', 42, [], {}, { schema: 'x' }, { ...ev('test_results'), extra: 1 }, { ...ev('test_results'), version: 2 },
    (() => { const e = ev('test_results'); e.payload.surprise = 1; return e })(), (() => { const e = ev('test_results'); delete e.payload.nonce; return e })(),
    (() => { const e = ev('test_results'); e.payload.evidence_type = 'root_access'; return e })(), (() => { const e = ev('test_results'); e.signature.alg = 'rsa'; return e })()]
  for (const j of junk) {
    const d = run(ACTIVE, request('accept_evidence'), trustedFor('orchestrator'), [j])
    assert.equal(d.decision, 'deny', JSON.stringify(j)?.slice(0, 80))
  }
})

test('replay: nonce reuse with different content and re-presented single-use evidence are rejected; identical duplicates are idempotent', () => {
  const a = ev('delivery_verification'); const b = ev('delivery_verification', { over: { nonce: a.payload.nonce, evidence_id: 'ev-other' } })
  const t = trustedFor('merger'); const need = [ev('independent_review'), ev('ci_gate'), ev('staging_gate')]
  const dup = run(ACTIVE, request('merge_pull_request'), t, [a, a, ...need])
  assert.equal(dup.decision, 'allow', JSON.stringify(dup))
  assert.deepEqual(dup.consumes, [a.payload.evidence_id])
  const clash = run(ACTIVE, request('merge_pull_request'), t, [a, b, ...need])
  assert.equal(clash.decision, 'deny')
  assert.ok(clash.rejected_evidence.some((r) => r.codes.includes('EVIDENCE.NONCE_REUSE')))
  const ledger = new EvidenceLedger()
  ledger.consume(a.payload.evidence_id)
  const replay = run(ACTIVE, request('merge_pull_request'), t, [a, ...need], { ledger })
  assert.equal(replay.decision, 'deny')
  assert.ok(replay.rejected_evidence.some((r) => r.codes.includes('EVIDENCE.REPLAYED')))
  ledger.recordNonce(a.payload.nonce, 'f'.repeat(64))
  assert.equal(ledger.nonceStatus(a.payload.nonce, 'f'.repeat(64)), 'same')
  assert.equal(ledger.nonceStatus(a.payload.nonce, '0'.repeat(64)), 'conflict')
  assert.equal(ledger.consume(a.payload.evidence_id), false, 'single-use is single-use')
})

test('failing or open-finding verdicts do not satisfy a requirement', () => {
  const t = publishTrusted()
  const failing = run(ACTIVE, request('publish_candidate_branch'), t, [ev('task_authority'), ev('test_results', { over: { verdict: 'fail' } })])
  assert.deepEqual(codes(failing), ['EVIDENCE.NOT_PASSING:test_results'])
  const open = run(ACTIVE, request('publish_candidate_branch'), t, [ev('task_authority'), ev('test_results', { over: { findings: [{ id: 'f1', severity: 'high', resolved: false }] } })])
  assert.deepEqual(codes(open), ['EVIDENCE.NOT_PASSING:test_results'])
  const resolved = run(ACTIVE, request('publish_candidate_branch'), t, [ev('task_authority'), ev('test_results', { over: { findings: [{ id: 'f1', severity: 'high', resolved: true }] } })])
  assert.equal(resolved.decision, 'allow')
})

test('new versus historical migrations come from trusted Git facts, never from a label', () => {
  const t = (changes, auth = { migrations_authorized: true }) => { const x = publishTrusted({ candidate: candidate({ changes }) }); Object.assign(x.task.authority, auth); return x }
  const fullFor = (tt) => [...publishEvidenceFor(tt), ev('independent_review'), ev('security_review')]
  const full = fullFor(t([]))
  const newOk = run(ACTIVE, request('publish_candidate_branch'), t([{ status: 'A', path: 'supabase/migrations/263_agent_thing.sql' }]), full)
  assert.equal(newOk.decision, 'allow', JSON.stringify(newOk))
  const noReview = run(ACTIVE, request('publish_candidate_branch'), t([{ status: 'A', path: 'supabase/migrations/263_agent_thing.sql' }]), publishEvidenceFor(t([])))
  assert.deepEqual(codes(noReview).sort(), ['EVIDENCE.MISSING:independent_review', 'EVIDENCE.MISSING:security_review'])
  const unauth = t([{ status: 'A', path: 'supabase/migrations/263_agent_thing.sql' }], {})
  assert.ok(codes(run(ACTIVE, request('publish_candidate_branch'), unauth, fullFor(unauth))).includes('MIGRATION.NOT_AUTHORIZED_BY_TASK'))
  const expect = {
    'MIGRATION.HISTORICAL_MODIFIED': [{ status: 'M', path: 'supabase/migrations/262_agent_verified_human_identity.sql' }],
    'MIGRATION.HISTORICAL_DELETED': [{ status: 'D', path: 'supabase/migrations/261_agent_worker_tenant_binding.sql' }],
    'MIGRATION.HISTORICAL_COLLISION': [{ status: 'A', path: 'supabase/migrations/262_agent_verified_human_identity.sql' }],
    'MIGRATION.OUT_OF_ORDER': [{ status: 'A', path: 'supabase/migrations/200_late_insert.sql' }],
    'MIGRATION.DUPLICATE_NUMBER': [{ status: 'A', path: 'supabase/migrations/263_a.sql' }, { status: 'A', path: 'supabase/migrations/263_b.sql' }],
    'MIGRATION.MALFORMED_NAME': [{ status: 'A', path: 'supabase/migrations/Notes.txt' }],
    'MIGRATION.UNSUPPORTED_STATUS': [{ status: 'T', path: 'supabase/migrations/001_init.sql' }, { status: 'X', path: 'supabase/migrations/264_x.sql' }],
  }
  for (const [code, changes] of Object.entries(expect)) {
    const d = run(ACTIVE, request('publish_candidate_branch'), t(changes), full)
    assert.equal(d.decision, 'deny', code)
    assert.ok(codes(d).some((c) => c === code || (code === 'MIGRATION.UNSUPPORTED_STATUS' && c.startsWith('MIGRATION.'))), `${code}: ${codes(d)}`)
  }
  // case games and Windows aliases cannot hide a historical edit
  for (const p of ['supabase/Migrations/262_Agent_Verified_Human_Identity.sql', 'supabase/migrations/262_agent_verified_human_identity.sql.', 'supabase/migrations/262_agent_verified_human_identity.sql::$DATA']) {
    const d = run(ACTIVE, request('publish_candidate_branch'), t([{ status: 'M', path: p }]), full)
    assert.equal(d.decision, 'deny', p)
  }
  // a request cannot smuggle a label: unknown request fields are malformed input
  const labeled = run(ACTIVE, { ...request('publish_candidate_branch'), modification: 'add' }, t([{ status: 'M', path: 'supabase/migrations/262_agent_verified_human_identity.sql' }]), full)
  assert.deepEqual(codes(labeled), ['INPUT.MALFORMED:request'])
})

test('customer-agent activation is prohibited as an action, as a declared effect, and by the migration tripwire', () => {
  for (const a of ['activate_customer_agent_execution', 'grant_customer_agent_autonomy', 'enable_customer_agent_billing'])
    for (const id of ['implementer', 'orchestrator', 'merger', 'policy_promoter', 'production_releaser']) assert.deepEqual(codes(run(ACTIVE, request(a), trustedFor(id))), [`ACTION.PROHIBITED:${a}`])
  const declared = run(ACTIVE, request('publish_candidate_branch', { params: { customer_agent_effect: true } }), publishTrusted(), publishEvidence())
  assert.ok(codes(declared).includes('CUSTOMER_AGENT.ACTIVATION_DECLARED'))
  const t = publishTrusted({ candidate: candidate({ changes: [{ status: 'A', path: 'supabase/migrations/263_seed.sql' }], added_lines: { 'supabase/migrations/263_seed.sql': ['UPDATE agent_execution_flags SET enabled = true;'] } }) })
  t.task.authority.migrations_authorized = true
  const d = run(ACTIVE, request('publish_candidate_branch'), t, [...publishEvidenceFor(t), ev('independent_review'), ev('security_review')])
  assert.ok(codes(d).includes('CUSTOMER_AGENT.ACTIVATION_TRIPWIRE'))
  const benign = publishTrusted({ candidate: candidate({ changes: [{ status: 'M', path: 'apps/api/agent_runtime/notes.md' }], added_lines: { 'apps/api/agent_runtime/notes.md': ['document the worker'] } }) })
  benign.task.authority.allowed_paths = ['apps/**']
  assert.deepEqual(codes(run(ACTIVE, request('publish_candidate_branch'), benign, publishEvidenceFor(benign))), ['EVIDENCE.MISSING:security_review'], 'customer-agent paths add a security review but are not denied outright')
})

test('unauthorized spending and paid authentication are refused; subscription-only launch is the only way in', () => {
  const launch = (over = {}, params = {}) => run(ACTIVE, request('launch_claude_session', { params }), trustedFor('orchestrator', { launch: {
    env_names: ['PATH', 'HOME'], settings: {}, auth: { verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'pro', paid_usage_enabled: false }, ...over } }))
  assert.equal(launch().decision, 'allow')
  assert.ok(codes(launch({ env_names: ['PATH', 'anthropic_api_key'] })).includes('AUTH.FORBIDDEN_ENVIRONMENT:ANTHROPIC_API_KEY'))
  for (const n of loadContractFile().forbidden_auth_environment) assert.ok(codes(launch({ env_names: [n] })).some((c) => c.startsWith('AUTH.FORBIDDEN_ENVIRONMENT')), n)
  assert.ok(codes(launch({ settings: { apiKeyHelper: '/bin/x' } })).includes('AUTH.FORBIDDEN_SETTING:apiKeyHelper'))
  assert.ok(codes(launch({ settings: { forceLoginMethod: 'console' } })).includes('AUTH.FORBIDDEN_SETTING:forceLoginMethod:console'))
  assert.ok(codes(launch({ auth: null })).includes('AUTH.UNVERIFIED'), 'unverifiable authentication fails closed')
  assert.ok(codes(launch({ auth: { verified: true, verified_by: 'launcher', source: 'api_key', plan: 'pro', paid_usage_enabled: false } })).includes('AUTH.PAID_OR_UNKNOWN_SOURCE'))
  assert.ok(codes(launch({ auth: { verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'max', paid_usage_enabled: false } })).includes('AUTH.PLAN_NOT_PRO'))
  assert.ok(codes(launch({ auth: { verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'pro', paid_usage_enabled: true } })).includes('AUTH.PAID_USAGE_NOT_VERIFIED_DISABLED'))
  assert.ok(codes(launch({ auth: { verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'pro' } })).includes('AUTH.PAID_USAGE_NOT_VERIFIED_DISABLED'))
  assert.ok(codes(launch({}, { incremental_usd: 0.01 })).includes('SPEND.UNAUTHORIZED'))
  assert.ok(codes(launch({}, { purchase: true })).includes('SPEND.PURCHASE_FORBIDDEN'))
  assert.equal(codes(launch({}, { incremental_usd: Number.NaN })).includes('INPUT.MALFORMED:params'), true)
  for (const a of ['use_paid_model_authentication', 'purchase_usage_or_upgrade_subscription', 'increase_own_spend_authority']) assert.deepEqual(codes(run(ACTIVE, request(a), trustedFor('orchestrator'))), [`ACTION.PROHIBITED:${a}`])
  assert.ok(codes(run(ACTIVE, request('launch_claude_session'), trustedFor('orchestrator'))).includes('AUTH.UNVERIFIED'), 'no launch facts at all')
})

test('production access: only the right identity with the right scope, and never credentials in a worker environment', () => {
  const cred = (id, scope, more = []) => run(ACTIVE, request('access_credential', { params: { credential_scope: scope } }), trustedFor(id), [ev('task_authority'), ...more])
  assert.deepEqual(codes(cred('production_releaser', 'production')), ['EVIDENCE.MISSING:delivery_verification'], 'a production credential needs the exact-candidate delivery verification')
  assert.equal(cred('production_releaser', 'production', [ev('delivery_verification')]).decision, 'allow')
  assert.equal(cred('production_releaser', 'production', [ev('delivery_verification', { over: { candidate_sha: 'a'.repeat(40) } })]).decision, 'deny')
  assert.ok(codes(cred('trusted_publisher', 'production')).includes('CREDENTIAL.SCOPE_NOT_PERMITTED'))
  assert.ok(codes(cred('merger', 'staging')).includes('CREDENTIAL.SCOPE_NOT_PERMITTED'))
  assert.ok(codes(cred('trusted_publisher', 'nonsense')).includes('CREDENTIAL.UNKNOWN_SCOPE'))
  assert.ok(codes(cred('implementer', 'production')).includes('IDENTITY.NOT_PERMITTED:implementer'))
  assert.ok(codes(run(ACTIVE, request('access_credential'), trustedFor('trusted_publisher'), [ev('task_authority')])).includes('CREDENTIAL.UNKNOWN_SCOPE'))
  assert.deepEqual(codes(cred('trusted_publisher', undefined)), ['INPUT.MALFORMED:params'])
  for (const n of ['SUPABASE_SERVICE_ROLE_KEY', 'PRODUCTION_SUPABASE_DB_URL', 'RAILWAY_API_TOKEN', 'VERCEL_TOKEN', 'PATELREP_APP_PRIVATE_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'STRIPE_SECRET_KEY']) {
    const env = { ...trustedFor('trusted_publisher').environment, worker_env_names: ['PATH', n] }
    const d = run(ACTIVE, request('publish_candidate_branch'), publishTrusted({ environment: env }), publishEvidence())
    assert.ok(codes(d).some((c) => c.startsWith('CREDENTIAL.IN_WORKER_ENV')), n)
  }
  for (const a of ['expose_credentials_to_candidate_environment', 'push_to_main_directly', 'force_push_protected_branch', 'supabase_migration_repair', 'apply_unreviewed_migration_remotely'])
    for (const id of ['trusted_publisher', 'production_releaser', 'merger', 'recovery']) assert.deepEqual(codes(run(ACTIVE, request(a), trustedFor(id))), [`ACTION.PROHIBITED:${a}`])
})

test('bypass permissions: only inside a verified isolated environment, never on the host', () => {
  const launch = { env_names: ['PATH'], settings: {}, auth: { verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'pro', paid_usage_enabled: false } }
  const start = (env, p = ACTIVE, evd = [ev('isolation_attestation')]) => run(p, request('start_bypass_permissions_session', { params: { permission_mode: 'bypass' } }), trustedFor('orchestrator', { environment: env, launch }), evd)
  const iso1 = trustedFor('orchestrator').environment
  assert.equal(start(iso1).decision, 'allow', JSON.stringify(start(iso1)))
  assert.ok(codes(start({ ...iso1, kind: 'windows_host' })).includes('ENV.BYPASS_OUTSIDE_ISOLATION'))
  assert.ok(codes(start({ ...iso1, kind: 'windows_host' })).includes('ENV.NOT_ISOLATED'))
  for (const [k, bad] of [['egress_restricted', false], ['host_mounts', true], ['docker_socket_exposed', true], ['windows_interop', true], ['controller_reachable', true], ['other_credentials_present', true]])
    assert.ok(codes(start({ ...iso1, [k]: bad })).includes(`ENV.ISOLATION_PROPERTY_UNPROVEN:${k}`), k)
  const unproven = { ...iso1 }; delete unproven.egress_restricted
  assert.ok(codes(start(unproven)).includes('ENV.ISOLATION_PROPERTY_UNPROVEN:egress_restricted'), 'an unmeasured property is an unproven property')
  assert.ok(codes(start(iso1, ACTIVE, [])).includes('EVIDENCE.MISSING:isolation_attestation'))
  assert.ok(codes(run(ACTIVE, request('edit_files_in_task_worktree', { params: { permission_mode: 'bypass', paths: ['apps/mobile/a.ts'] } }), trustedFor('implementer', { environment: { ...iso1, kind: 'windows_host' } }))).includes('ENV.BYPASS_OUTSIDE_ISOLATION'))
  assert.deepEqual(codes(run(ACTIVE, request('enable_host_bypass_permissions'), trustedFor('orchestrator'))), ['ACTION.PROHIBITED:enable_host_bypass_permissions'])
})

test('scope: the implementer can only touch what trusted task authority allows; path tricks are rejected', () => {
  const edit = (paths, over = {}) => run(ACTIVE, request('edit_files_in_task_worktree', { params: { paths } }), trustedFor('implementer', over))
  assert.equal(edit(['apps/mobile/app/a.tsx']).decision, 'allow')
  assert.ok(codes(edit(['apps/web/x.tsx'])).includes('SCOPE.OUT_OF_SCOPE'))
  assert.ok(codes(edit(['apps/mobile/../web/x.tsx'])).includes('PATH.DOT_SEGMENT'))
  assert.ok(codes(edit(['apps/mobile\\x.ts'])).includes('PATH.BACKSLASH'))
  assert.ok(codes(edit(['apps/mobile/x.ts', 'APPS/mobile/X.ts'])).includes('PATH.CASE_COLLISION_AMBIGUOUS'))
  const denied = trustedFor('implementer'); denied.task.authority.denied_paths = ['apps/mobile/secret/**']
  assert.ok(codes(run(ACTIVE, request('edit_files_in_task_worktree', { params: { paths: ['apps/mobile/secret/a.ts'] } }), denied)).includes('SCOPE.OUT_OF_SCOPE'))
  const noAuth = trustedFor('implementer'); noAuth.task.authority = {}
  assert.ok(codes(run(ACTIVE, request('edit_files_in_task_worktree', { params: { paths: ['apps/mobile/a.ts'] } }), noAuth)).includes('SCOPE.NO_TASK_AUTHORITY'))
  assert.ok(codes(edit(undefined)).length > 0)
  assert.ok(codes(run(ACTIVE, request('edit_files_in_task_worktree'), trustedFor('implementer'))).includes('INPUT.PATHS_REQUIRED'))
})

test('resource cleanup only touches task-owned, idle resources and never a migration', () => {
  const clean = (resource, id = 'orchestrator') => run(ACTIVE, request('cleanup_task_owned_resources', { params: { resource } }), trustedFor(id))
  assert.equal(clean({ owner_task_id: 'task-1', kind: 'container', lifecycle: 'stale' }).decision, 'allow')
  assert.ok(codes(clean({ owner_task_id: 'task-2', kind: 'container', lifecycle: 'stale' })).includes('RESOURCE.NOT_OWNED'))
  assert.ok(codes(clean({ owner_task_id: 'task-1', kind: 'process', lifecycle: 'running' })).includes('RESOURCE.UNSAFE_LIFECYCLE'))
  assert.ok(codes(clean({ owner_task_id: 'task-1', kind: 'migration', lifecycle: 'idle' })).includes('RESOURCE.ACTIVE_MIGRATION'))
  assert.ok(codes(run(ACTIVE, request('cleanup_task_owned_resources'), trustedFor('orchestrator'))).includes('INPUT.RESOURCE_REQUIRED'))
  assert.deepEqual(codes(run(ACTIVE, request('terminate_unowned_processes'), trustedFor('orchestrator'))), ['ACTION.PROHIBITED:terminate_unowned_processes'])
})

test('delivery eligibility and merge need the full gate evidence on the exact candidate', () => {
  const merge = (evd) => run(ACTIVE, request('merge_pull_request'), trustedFor('merger'), evd)
  const full = [ev('delivery_verification'), ev('independent_review'), ev('ci_gate'), ev('staging_gate')]
  assert.equal(merge(full).decision, 'allow', JSON.stringify(merge(full)))
  for (const drop of ['delivery_verification', 'independent_review', 'ci_gate', 'staging_gate']) assert.ok(codes(merge(full.filter((e) => e.payload.evidence_type !== drop))).includes(`EVIDENCE.MISSING:${drop}`), drop)
  const stale = [ev('delivery_verification'), ev('independent_review'), ev('ci_gate', { over: { candidate_sha: 'a'.repeat(40) } }), ev('staging_gate')]
  assert.deepEqual(codes(merge(stale)), ['EVIDENCE.MISSING:ci_gate'], 'CI evidence from an older head must not count')
  assert.ok(codes(run(SHIPPED, request('merge_pull_request'), trustedFor('merger'), full.map((e) => ev(e.payload.evidence_type, {}, SHIPPED)))).includes('ACTIVATION.NOT_ACTIVE:merge_pull_request'))
  assert.ok(codes(run(ACTIVE, request('merge_pull_request'), trustedFor('trusted_publisher'), full)).includes('IDENTITY.NOT_PERMITTED:trusted_publisher'))
  // the gate evidence must come from the verifier identity, not from whoever holds some key
  const imposter = ev('ci_gate', { over: { issuer_identity: 'merger' }, keyId: 'k-merger' })
  assert.ok(codes(merge([full[0], full[1], imposter, full[3]])).includes('EVIDENCE.MISSING:ci_gate'))
})

test('unknown actions, malformed input and internal errors all fail closed and never throw', () => {
  assert.deepEqual(codes(run(ACTIVE, request('do_anything'), trustedFor('orchestrator'))), ['ACTION.UNKNOWN'])
  assert.deepEqual(codes(run(ACTIVE, request('constructor'), trustedFor('orchestrator'))), ['ACTION.UNKNOWN'])
  assert.deepEqual(codes(run(ACTIVE, request('__proto__'), trustedFor('orchestrator'))), ['INPUT.MALFORMED:request'])
  assert.deepEqual(codes(run(ACTIVE, request('hasOwnProperty'), trustedFor('orchestrator'))), ['ACTION.UNKNOWN'])
  const garbage = [undefined, null, 1, 'x', [], {}, { policy: null }, { policy: ACTIVE.policy }, { policy: ACTIVE.policy, request: null }, { policy: ACTIVE.policy, request: request('read_repository'), trusted: null, now: NOW },
    { policy: ACTIVE.policy, request: request('read_repository'), trusted: trustedFor('implementer'), now: 'soon' },
    { policy: ACTIVE.policy, request: request('read_repository'), trusted: { ...trustedFor('implementer'), identity: 'root' }, now: NOW },
    { policy: ACTIVE.policy, request: request('read_repository', { params: { surprise: 1 } }), trusted: trustedFor('implementer'), now: NOW },
    { policy: ACTIVE.policy, request: request('read_repository'), trusted: trustedFor('implementer', { candidate: { source: 'git' } }), now: NOW },
    { policy: ACTIVE.policy, request: request('read_repository'), trusted: trustedFor('implementer'), now: NOW, evidence: 'nope' },
    { policy: { revision: 'x' }, request: request('read_repository'), trusted: trustedFor('implementer'), now: NOW }]
  for (const g of garbage) { const d = evaluate(g); assert.equal(d.decision, 'deny', JSON.stringify(g)?.slice(0, 60)); assert.ok(d.reason_codes.length > 0) }
  const exploding = { get identity() { throw new Error('boom') } }
  assert.deepEqual(codes(evaluate({ policy: ACTIVE.policy, request: request('read_repository'), trusted: exploding, now: NOW })), ['EVALUATOR.INTERNAL_ERROR'])
  const tooMany = Array.from({ length: 65 }, () => ev('test_results'))
  assert.ok(codes(run(ACTIVE, request('accept_evidence'), trustedFor('orchestrator'), tooMany)).includes('INPUT.MALFORMED:evidence'))
  assert.ok(codes(run(ACTIVE, request('read_repository'), trustedFor('implementer'), [], { ledger: undefined })).includes('ALLOWED'))
})

test('every prohibited action is denied for every identity with every kind of evidence on offer', () => {
  const c = loadContractFile()
  const everything = Object.keys(c.evidence_types).map((t) => ev(t))
  for (const [name, a] of Object.entries(c.actions)) {
    if (a.class !== 'prohibited') continue
    for (const id of Object.keys(c.identities)) {
      const d = run(ACTIVE, request(name), trustedFor(id), everything)
      assert.equal(d.decision, 'deny', `${name}/${id}`)
      assert.deepEqual(d.reason_codes, [`ACTION.PROHIBITED:${name}`])
    }
  }
})

test('evaluation never mutates its inputs (pure)', () => {
  const t = publishTrusted(); const e = publishEvidence(); const r = request('publish_candidate_branch')
  const before = JSON.stringify([t, e, r])
  run(ACTIVE, r, t, e)
  assert.equal(JSON.stringify([t, e, r]), before)
  assert.ok(Object.isFrozen(ACTIVE.policy))
  assert.equal(REPO, 'henilllpatelll/PatelRep'); assert.equal(BASE.length, 40); assert.equal(TREE.length, 40); assert.equal(ENV_ID, 'vm-isolated-1')
})

test('trusted policy provenance: only an object produced by loadPolicy with the pin is accepted', () => {
  const forged = structuredClone(ACTIVE.policy)
  assert.deepEqual(codes(run({ policy: forged }, request('read_repository'), trustedFor('implementer'))), ['POLICY.NOT_LOADED'])
  assert.deepEqual(codes(run({ policy: { ...ACTIVE.policy } }, request('read_repository'), trustedFor('implementer'))), ['POLICY.NOT_LOADED'])
  assert.deepEqual(codes(run({ policy: null }, request('read_repository'), trustedFor('implementer'))), ['POLICY.NOT_LOADED'])
})

test('task scope is bound to the signed task_authority: widening the scope without fresh ingress evidence is rejected', () => {
  const widened = publishTrusted(); widened.task.authority.allowed_paths = ['**']
  const d = run(ACTIVE, request('publish_candidate_branch'), widened, publishEvidence())
  assert.equal(d.decision, 'deny')
  assert.ok(d.rejected_evidence.some((r) => r.codes.includes('EVIDENCE.WRONG_AUTHORITY_DIGEST')))
  assert.ok(codes(d).includes('EVIDENCE.MISSING:task_authority'))
  assert.equal(run(ACTIVE, request('publish_candidate_branch'), widened, publishEvidenceFor(widened)).decision, 'allow', 'fresh ingress evidence over the new scope is a new owner decision')
})

test('single-use evidence needs a replay ledger: no ledger means no decision', () => {
  const need = [ev('independent_review'), ev('ci_gate'), ev('staging_gate'), ev('delivery_verification')]
  const d = evaluate({ policy: ACTIVE.policy, request: request('merge_pull_request'), trusted: trustedFor('merger'), evidence: need, now: NOW })
  assert.equal(d.decision, 'deny')
  assert.ok(codes(d).includes('LEDGER.REQUIRED'))
  assert.equal(run(ACTIVE, request('merge_pull_request'), trustedFor('merger'), need).decision, 'allow')
})
