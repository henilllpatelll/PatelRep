// D3.2 final remediation — subscription plan model (Claude Max 5x), launcher-controlled environment values, context-renewal design requirement,
// and the activation prerequisites. Nothing here talks to a provider: plan identities are CANONICAL internal values the trusted launcher produces.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildPolicyBundle, loadContractFile, policyRevision, validateContract } from '../authority/contract.mjs'
import { EvidenceLedger } from '../authority/evidence.mjs'
import { evaluate } from '../authority/evaluator.mjs'
import { diffPolicy, promotionCheck } from '../authority/policy-version.mjs'
import { checkLaunchAuthentication, checkLauncherControlled } from '../authority/spend.mjs'
import { applyEvent, createTask, loadLifecycle } from '../lifecycle/lifecycle.mjs'
import { NOW, buildPolicy, makeKeys, request, trustedFor } from './helpers.mjs'

const C = loadContractFile()
const KEYS = makeKeys()
const ACTIVE = buildPolicy({ keys: KEYS })
const GOOD = Object.freeze({ verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'claude_max_5x', extra_usage_enabled: false })
const auth = (over = {}) => ({ ...GOOD, ...over })
const chk = (a, env = ['PATH'], settings = {}) => checkLaunchAuthentication({ envNames: env, settings, auth: a }, C)
const launchDecision = (over) => evaluate({ policy: ACTIVE.policy, request: request('launch_claude_session'), trusted: trustedFor('orchestrator', { launch: { env_names: ['PATH'], settings: {}, auth: auth(over) } }),
  now: NOW, ledger: new EvidenceLedger() })

test('Claude Max 5x is the authorized plan; a verified Max 5x login with extra usage OFF is accepted', () => {
  assert.deepEqual(C.subscription.authorized_plans, ['claude_max_5x'])
  assert.deepEqual(chk(GOOD), [])
  const d = launchDecision({})
  assert.equal(d.decision, 'allow', JSON.stringify(d))
})

test('known plans the owner has NOT authorized are refused (including the previous Pro plan and the larger Max tier)', () => {
  for (const plan of ['claude_pro', 'claude_max_20x', 'claude_team', 'claude_enterprise', 'claude_free']) {
    assert.deepEqual(chk(auth({ plan })), ['AUTH.PLAN_NOT_AUTHORIZED'], plan)
    assert.equal(launchDecision({ plan }).decision, 'deny', plan)
  }
})

test('unknown, non-canonical or malformed plan identities fail closed; the harness does not guess provider strings', () => {
  for (const plan of ['max', 'Max 5x', 'max_5x', 'MAX_5X', 'claude_max_5x ', 'claude-max-5x', 'pro', '', 'claude_max_50x', undefined, null, 5, {}, ['claude_max_5x']]) {
    assert.deepEqual(chk(auth({ plan })), ['AUTH.PLAN_UNKNOWN'], JSON.stringify(plan))
  }
  const noPlan = { ...GOOD }; delete noPlan.plan
  assert.deepEqual(chk(noPlan), ['AUTH.PLAN_UNKNOWN'])
})

test('paid authentication, enabled extra usage and unverified authentication are all refused', () => {
  // API-key and other paid sources
  for (const source of ['api_key', 'anthropic_api', 'bedrock', 'vertex', 'foundry', 'oauth_token_env', 'unknown', '', undefined, 'claude_subscription_oauth ']) assert.ok(chk(auth({ source })).includes('AUTH.PAID_OR_UNKNOWN_SOURCE'), String(source))
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'OPENAI_API_KEY']) assert.ok(chk(GOOD, ['PATH', name]).some((c) => c.startsWith('AUTH.FORBIDDEN_ENVIRONMENT')), name)
  // extra usage
  assert.deepEqual(chk(auth({ extra_usage_enabled: true })), ['AUTH.EXTRA_USAGE_ENABLED'])
  for (const v of [undefined, null, 'false', 0, 'no', []]) assert.deepEqual(chk(auth({ extra_usage_enabled: v })), ['AUTH.EXTRA_USAGE_UNVERIFIED'], JSON.stringify(v))
  const legacy = { ...GOOD }; delete legacy.extra_usage_enabled; legacy.paid_usage_enabled = false
  assert.deepEqual(chk(legacy), ['AUTH.EXTRA_USAGE_UNVERIFIED'], 'only the current field name counts')
  // unverified
  for (const a of [null, undefined, 'x', [], {}, auth({ verified: false }), auth({ verified: 'true' }), auth({ verified_by: 'worker' }), auth({ verified_by: 'candidate' })]) assert.ok(chk(a).includes('AUTH.UNVERIFIED'), JSON.stringify(a))
  assert.equal(launchDecision({ verified_by: 'worker' }).decision, 'deny')
})

test('a subscription change never authorizes spending: the zero-spend limit holds for every plan', () => {
  assert.equal(C.limits.max_incremental_usd, 0)
  for (const plan of C.subscription.known_plans) {
    const p = buildPolicy({ keys: KEYS, mutate: (c) => { c.subscription.authorized_plans = [plan] } })
    const run = (params) => evaluate({ policy: p.policy, request: request('launch_claude_session', { params }), trusted: trustedFor('orchestrator', { launch: { env_names: ['PATH'], settings: {}, auth: auth({ plan }) } }), now: NOW, ledger: new EvidenceLedger() })
    assert.equal(run({}).decision, 'allow', plan)
    assert.ok(run({ incremental_usd: 0.01 }).reason_codes.includes('SPEND.UNAUTHORIZED'), plan)
    assert.ok(run({ purchase: true }).reason_codes.includes('SPEND.PURCHASE_FORBIDDEN'), plan)
  }
  for (const a of ['use_paid_model_authentication', 'purchase_usage_or_upgrade_subscription', 'increase_own_spend_authority']) assert.equal(C.actions[a].class, 'prohibited', a)
})

test('authorizing a different plan is a root-of-trust change: it cannot be promoted automatically and the contract must stay coherent', () => {
  const propose = (mutate) => { const contract = structuredClone(ACTIVE.bundle.contract); mutate(contract); const bundle = buildPolicyBundle({ contract, trusted_keys: KEYS.trusted_keys, parent_revision: ACTIVE.revision }); return { bundle, revision: policyRevision(bundle) } }
  const widen = propose((c) => { c.subscription.authorized_plans.push('claude_max_20x') })
  assert.ok(diffPolicy(ACTIVE.policy, widen.bundle).changes.some((x) => x.severity === 'root_of_trust' && x.code === 'SUBSCRIPTION_AUTHORIZATION_CHANGED'))
  assert.ok(promotionCheck(ACTIVE.policy, widen.bundle).codes.includes('PROMOTION.ROOT_OF_TRUST_REQUIRES_OWNER_CEREMONY'))
  const narrow = propose((c) => { c.subscription.authorized_plans = ['claude_pro'] })
  assert.ok(promotionCheck(ACTIVE.policy, narrow.bundle).codes.includes('PROMOTION.ROOT_OF_TRUST_REQUIRES_OWNER_CEREMONY'), 'even narrowing/switching the plan is an owner decision')
  const bad = { 'authorize an unknown plan': (c) => { c.subscription.authorized_plans = ['claude_max_5x_plus'] }, 'authorize nothing': (c) => { c.subscription.authorized_plans = [] },
    'remove the section': (c) => { delete c.subscription }, 'malformed known plans': (c) => { c.subscription.known_plans = 'all' }, 'extra key': (c) => { c.subscription.unlimited = true } }
  for (const [n, m] of Object.entries(bad)) { const c = structuredClone(C); m(c); assert.notDeepEqual(validateContract(c), [], n) }
})

test('behavior-sensitive environment values (NODE_OPTIONS, proxy, certificates) must come exclusively from the trusted launcher', () => {
  assert.deepEqual(C.launcher_controlled_environment.slice().sort(), ['HTTPS_PROXY', 'HTTP_PROXY', 'NODE_OPTIONS', 'NO_PROXY', 'SSL_CERT_FILE'])
  const ok = { NODE_OPTIONS: 'trusted_launcher', HTTPS_PROXY: 'trusted_launcher', HTTP_PROXY: 'trusted_launcher', NO_PROXY: 'trusted_launcher', SSL_CERT_FILE: 'trusted_launcher' }
  assert.deepEqual(checkLauncherControlled(Object.keys(ok), ok, [], C), [])
  assert.deepEqual(checkLauncherControlled(['PATH', 'HOME'], undefined, [], C), [], 'names that are not behavior-sensitive are unaffected')
  for (const origin of ['worker', 'candidate', 'settings', 'repository', 'user', '', undefined, null, 1]) assert.deepEqual(checkLauncherControlled(['NODE_OPTIONS'], { NODE_OPTIONS: origin }, [], C), ['ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:NODE_OPTIONS'], String(origin))
  assert.deepEqual(checkLauncherControlled(['HTTPS_PROXY'], undefined, [], C), ['ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:HTTPS_PROXY'], 'no origin report means no trust')
  assert.deepEqual(checkLauncherControlled(['https_proxy'], { HTTPS_PROXY: 'trusted_launcher' }, [], C), [], 'names are case-insensitive on Windows')
  // the same name coming from the repository-controlled settings env is refused even if the launcher also set one
  assert.deepEqual(checkLauncherControlled(['NODE_OPTIONS'], ok, ['NODE_OPTIONS'], C), ['ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:NODE_OPTIONS'])
  assert.deepEqual(checkLauncherControlled([], ok, ['node_options'], C), ['ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:NODE_OPTIONS'])
})

test('the evaluator enforces launcher-controlled values on launches and on worker environments', () => {
  const launch = (over) => evaluate({ policy: ACTIVE.policy, request: request('launch_claude_session'), trusted: trustedFor('orchestrator', { launch: { env_names: ['PATH', 'NODE_OPTIONS', 'HTTPS_PROXY'], settings: {}, auth: GOOD,
    env_value_origins: { NODE_OPTIONS: 'trusted_launcher', HTTPS_PROXY: 'trusted_launcher' }, ...over } }), now: NOW, ledger: new EvidenceLedger() })
  assert.equal(launch({}).decision, 'allow')
  assert.ok(launch({ env_value_origins: { NODE_OPTIONS: 'trusted_launcher' } }).reason_codes.includes('ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:HTTPS_PROXY'))
  assert.ok(launch({ env_value_origins: undefined }).reason_codes.includes('ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:NODE_OPTIONS'))
  assert.ok(launch({ settings: { env: { NODE_OPTIONS: '--require ./evil.js' } } }).reason_codes.includes('ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:NODE_OPTIONS'))
  assert.ok(launch({ settings: { env: { HTTPS_PROXY: 'http://evil' } } }).reason_codes.includes('ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:HTTPS_PROXY'))
  // worker environment (e.g. publishing from an environment that carries a proxy variable)
  const ACT = buildPolicy({ keys: KEYS, activate: ['publish_candidate_branch'] })
  const pub = (env) => evaluate({ policy: ACT.policy, request: request('publish_candidate_branch'), trusted: trustedFor('trusted_publisher', { environment: { ...trustedFor('x').environment, ...env } }), now: NOW, ledger: new EvidenceLedger() })
  assert.ok(pub({ worker_env_names: ['PATH', 'HTTPS_PROXY'] }).reason_codes.includes('ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:HTTPS_PROXY'))
  assert.ok(!pub({ worker_env_names: ['PATH', 'HTTPS_PROXY'], env_value_origins: { HTTPS_PROXY: 'trusted_launcher' } }).reason_codes.some((c) => c.startsWith('ENV.VALUE_NOT_FROM')))
})

test('launcher-controlled variable policy is part of the pinned contract: shrinking it is a weakening', () => {
  const contract = structuredClone(ACTIVE.bundle.contract); contract.launcher_controlled_environment = contract.launcher_controlled_environment.filter((n) => n !== 'NODE_OPTIONS')
  const bundle = buildPolicyBundle({ contract, trusted_keys: KEYS.trusted_keys, parent_revision: ACTIVE.revision })
  assert.ok(diffPolicy(ACTIVE.policy, bundle).changes.some((x) => x.severity === 'weakening' && x.code === 'LAUNCHER_CONTROLLED_ENV_REMOVED'))
  const c2 = structuredClone(C); c2.launcher_controlled_environment = ['not-a-name']; assert.notDeepEqual(validateContract(c2), [])
})

// ───────────────────────── context renewal (design requirement only) ─────────────────────────
const LC = loadLifecycle()
const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(path.resolve(HERE, '../../../', rel), 'utf8')

test('context renewal is recorded as a D3.4 design requirement: 70% default, configurable, checkpoint-first, no blind /clear', () => {
  const r = LC.context_renewal
  assert.equal(r.default_threshold_percent, 70)
  assert.equal(r.threshold_configurable, true)
  assert.match(r.status, /DESIGN_REQUIREMENT_ONLY/)
  assert.match(r.sequence.join(' | '), /durable checkpoint[^|]*BEFORE ending the session/)
  assert.match(r.sequence.join(' | '), /FRESH Claude session/)
  assert.match(r.sequence.join(' | '), /no owner prompt/)
  assert.match(r.telemetry, /officially supported/)
  assert.match(r.fallback_when_exact_utilization_unavailable, /conservative, supported proxy/)
  assert.ok(r.forbidden.some((f) => /blind \/clear/.test(f)))
  assert.ok(LC.never_blocked_reasons.includes('CONTEXT_RENEWAL'))
  assert.ok(LC.recoverable_states.context_recovery.reasons.includes('CONTEXT_RENEWAL'))
  for (const doc of ['docs/developer-harness-v3/08-task-lifecycle.md', 'docs/developer-harness-v3/09-roadmap.md']) assert.match(read(doc), /70\s?%/, doc)
})

test('the reducer carries a context-renewal wait and resumes to the recorded state, never to a blocker', () => {
  let t = createTask({ task_id: 'task-1', security_review_required: false })
  let n = 0
  const step = (to, extra = {}) => { const r = applyEvent(LC, t, { event_id: `c${++n}`, idempotency_id: `ci${n}`, task_id: 'task-1', kind: 'transition', expected_revision: t.state_revision, fencing_token: t.fencing_token, to, ...extra }); assert.equal(r.ok, true, `${t.state}->${to}: ${r.problems}`); t = r.task }
  for (const s of ['queued', 'planning', 'implementing']) step(s)
  step('context_recovery', { reason_code: 'CONTEXT_RENEWAL' })
  assert.equal(t.resume_to, 'implementing')
  const bad = applyEvent(LC, t, { event_id: 'x', idempotency_id: 'xi', task_id: 'task-1', kind: 'transition', expected_revision: t.state_revision, fencing_token: t.fencing_token, to: 'testing' })
  assert.deepEqual(bad.problems, ['TRANSITION.MUST_RESUME_TO_RECORDED_STATE'])
  step('implementing')
  const blocked = applyEvent(LC, t, { event_id: 'y', idempotency_id: 'yi', task_id: 'task-1', kind: 'transition', expected_revision: t.state_revision, fencing_token: t.fencing_token, to: 'blocked', reason_code: 'CONTEXT_RENEWAL' })
  assert.equal(blocked.ok, false)
})

test('V3 CI integration is a recorded, mandatory protected control-plane prerequisite to activation; V3 stays inactive', () => {
  assert.ok(C.activation_prerequisites.includes('v3_test_suite_wired_into_ci_through_a_human_approved_protected_control_plane_change'))
  assert.deepEqual(C.activation.active_actions, [])
  assert.equal(C.status, 'contract_only_not_active')
  for (const doc of ['docs/developer-harness-v3/09-roadmap.md', 'docs/developer-harness-v3/10-d33-handoff.md']) assert.match(read(doc), /mandatory[^.]*control-plane[^.]*before (V3 )?activation/i, doc)
  const shipped = buildPolicyBundle({ contract: C })
  assert.deepEqual(shipped.contract.activation.active_actions, [])
})
