// D3.3 Subscription Governor + stream telemetry. Provider responses are RECORDED-SHAPE or SYNTHETIC fixtures; no quota is burned to test them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { admitAiWork, classifyModel, classifyObservation, extraUsageFromRateLimits, GOVERNOR_DEFAULTS as G, lifecycleFor, nextGovernorState, normalizeAuthStatus, STATES } from '../runtime/subscription-governor.mjs'
import { contextUtilization, createTelemetry, feedLine, verifyInit } from '../runtime/session-telemetry.mjs'
import { applyEvent, createTask, loadLifecycle } from '../lifecycle/lifecycle.mjs'

const NOW = Date.parse('2026-11-24T21:00:00Z')
const FIXTURE = readFileSync(new URL('./fixtures/stream-observed-shape.jsonl', import.meta.url), 'utf8')
const telemetryOf = (text) => { const t = createTelemetry(); for (const l of text.split('\n').filter(Boolean)) feedLine(t, l); return t }
const OBSERVED_AUTH = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', planTier: 'max_5x', loginExpiresAt: '2026-12-22T08:46:11.014Z', email: 'x@example.invalid', orgId: 'synthetic' }
const rl = (o) => ({ status: 'allowed', resets_at: null, rate_limit_type: 'five_hour', utilization: null, overage_enabled: null, overage_status: null, overage_disabled_reason: null, is_using_overage: null, error_code: null, windows: {}, ...o })

test('auth normalization: the observed official-CLI shape → claude_max_5x with its basis; identifying fields are never copied', () => {
  const f = normalizeAuthStatus(OBSERVED_AUTH, { now: NOW })
  assert.equal(f.verified, true); assert.equal(f.source, 'claude_subscription_oauth'); assert.equal(f.plan, 'claude_max_5x')
  assert.match(f.plan_basis, /undocumented/)
  assert.ok(!JSON.stringify(f).includes('example.invalid'))
})

test('auth source confusion: API key, helper, long-lived token, third-party, unknown plan, Ultra/Max 20x, expiry → never verified', () => {
  for (const authMethod of ['api_key', 'api_key_helper', 'oauth_token', 'third_party', 'none', undefined]) {
    const f = normalizeAuthStatus({ ...OBSERVED_AUTH, authMethod }, { now: NOW }); assert.equal(f.verified, false, String(authMethod)); assert.equal(f.source, null)
  }
  assert.equal(normalizeAuthStatus({ ...OBSERVED_AUTH, apiProvider: 'bedrock' }, { now: NOW }).verified, false)
  for (const planTier of ['max_20x', 'ultra', 'MAX_5X', '', undefined]) assert.equal(normalizeAuthStatus({ ...OBSERVED_AUTH, planTier }, { now: NOW }).plan, null, String(planTier))
  assert.equal(normalizeAuthStatus({ ...OBSERVED_AUTH, subscriptionType: 'pro', planTier: 'pro' }, { now: NOW }).plan, null, 'only the pair actually observed is normalized')
  const exp = normalizeAuthStatus({ ...OBSERVED_AUTH, loginExpiresAt: '2026-11-01T00:00:00Z' }, { now: NOW })
  assert.ok(exp.problems.includes('AUTH.LOGIN_EXPIRED')); assert.equal(exp.verified, false)
  assert.equal(normalizeAuthStatus('not json', { now: NOW }).verified, false)
  assert.equal(normalizeAuthStatus({ ...OBSERVED_AUTH, loggedIn: false }, { now: NOW }).verified, false)
})

test('extra usage: any enabled/active signal wins; "off" needs the documented field or the exact observed triple; otherwise unverified', () => {
  assert.equal(extraUsageFromRateLimits([]).enabled, null)
  assert.equal(extraUsageFromRateLimits([rl({ overage_status: 'rejected', overage_disabled_reason: 'org_level_disabled', is_using_overage: false })]).enabled, false)
  assert.equal(extraUsageFromRateLimits([rl({ overage_enabled: false })]).enabled, false)
  assert.equal(extraUsageFromRateLimits([rl({ overage_status: 'rejected', overage_disabled_reason: 'out_of_credits', is_using_overage: false })]).enabled, null, 'out of credits is not "disabled"')
  assert.equal(extraUsageFromRateLimits([rl({ overage_status: 'rejected', overage_disabled_reason: 'org_level_disabled', is_using_overage: null })]).enabled, null)
  for (const o of [{ overage_enabled: true }, { is_using_overage: true }, { overage_status: 'allowed' }, { overage_status: 'allowed_warning' }, { rate_limit_type: 'overage' }])
    assert.equal(extraUsageFromRateLimits([rl({ overage_enabled: false }), rl(o)]).enabled, true, JSON.stringify(o))
})

test('stream telemetry from the observed shape: init, limits, context utilization; message TEXT is never retained', () => {
  const t = telemetryOf(FIXTURE)
  assert.equal(t.init.apiKeySource, 'none'); assert.equal(t.init.claude_code_version, '2.1.331')
  assert.equal(t.result.estimated_list_cost_usd, 0.00049409)
  assert.equal(t.result.per_model['claude-haiku-5-5'].cost_basis, 'list')
  const c = contextUtilization(t)
  assert.equal(c.used_tokens, 3082); assert.equal(c.window_tokens, 1000000); assert.equal(c.utilization, 0.0031); assert.match(c.context_basis, /contextWindow/)
  assert.ok(!JSON.stringify({ ...t, models: [...t.models], unknown_types: [...t.unknown_types] }).includes('SYNTHETIC-NOT-A-REAL-CREDENTIAL'), 'credential-shaped content must not survive into telemetry')
})

test('context utilization is never invented', () => {
  const t = createTelemetry()
  assert.equal(contextUtilization(t).utilization, null)
  feedLine(t, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 } } }))
  const c = contextUtilization(t); assert.equal(c.utilization, null); assert.equal(c.context_basis, 'CONTEXT_WINDOW_NOT_REPORTED'); assert.equal(c.used_tokens, 15)
  assert.equal(contextUtilization(t, { knownContextWindow: 200000 }).utilization, 0.0001)
  feedLine(t, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10 } } }))
  assert.equal(contextUtilization(t).context_basis, 'USAGE_INCOMPLETE')
  feedLine(t, '{not json'); assert.equal(t.malformed, 1)
})

test('init verification kills on API-key source, wrong permission mode, unexpected MCP/plugin/tool, version drift', () => {
  const init = telemetryOf(FIXTURE).init
  const expect = { permissionMode: 'dontAsk', version: '2.1.331', mcpServers: [], pluginSources: [], tools: [] }
  assert.deepEqual(verifyInit(init, expect), [])
  assert.match(verifyInit({ ...init, apiKeySource: 'ANTHROPIC_API_KEY' }, expect)[0], /AUTH.API_KEY_SOURCE_ACTIVE/)
  assert.ok(verifyInit({ ...init, permissionMode: 'bypassPermissions' }, expect)[0].startsWith('SESSION.PERMISSION_MODE_MISMATCH'))
  assert.deepEqual(verifyInit({ ...init, mcp_servers: ['evil'] }, expect), ['SESSION.UNEXPECTED_MCP_SERVER'])
  assert.deepEqual(verifyInit({ ...init, plugins: [{ name: 'x', source: 'x@market' }] }, expect), ['SESSION.UNEXPECTED_PLUGIN'])
  assert.deepEqual(verifyInit({ ...init, tools: ['Bash'] }, expect), ['SESSION.UNEXPECTED_TOOL'])
  assert.deepEqual(verifyInit({ ...init, claude_code_version: '9.9.9' }, expect), ['SESSION.VERSION_MISMATCH'])
  assert.deepEqual(verifyInit(null, expect), ['SESSION.INIT_MISSING'])
})

const line = (o) => JSON.stringify(o)
// Real streams always start with system/init; synthetic fragments get the observed init prepended unless the test is about its absence.
const INIT_LINE = JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'none', model: 'claude-haiku-5-5', tools: [], mcp_servers: [], plugins: [] })
const classify = (text, extra = {}) => classifyObservation({ telemetry: telemetryOf(text.startsWith('{"type":"system","subtype":"init"') || extra.noInit ? text : `${INIT_LINE}\n${text}`), ...extra }, { now: NOW })

test('classification covers every governor state', () => {
  assert.equal(classify(FIXTURE).state, 'available')
  const exhausted = classify(line({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1795563600, rateLimitType: 'five_hour' } }) + '\n' + line({ type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: 429 }))
  assert.equal(exhausted.state, 'exhausted'); assert.equal(exhausted.resets_at_ms, 1795563600000); assert.equal(exhausted.reset_basis, 'provider_reported_resetsAt')
  const noReset = classify(line({ type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: 429 }))
  assert.equal(noReset.state, 'exhausted'); assert.equal(noReset.resets_at_ms, null); assert.equal(noReset.reset_basis, 'NOT_REPORTED')
  assert.equal(classify(line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.85 } }) + '\n' + line({ type: 'result', subtype: 'success', is_error: false })).state, 'approaching')
  assert.equal(classify(line({ type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: 401 })).state, 'auth_expired')
  assert.equal(classify(line({ type: 'system', subtype: 'api_retry', error: 'billing_error', error_status: 402 })).state, 'unauthorized_billing')
  assert.equal(classify(line({ type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: 529 })).state, 'provider_unavailable')
  assert.equal(classify('', { network: 'unreachable' }).state, 'network_unavailable')
  assert.equal(classify('').state, 'unknown')
  assert.equal(classify(line({ type: 'result', subtype: 'weird', is_error: true })).state, 'unknown')
  assert.equal(classify(line({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' })).state, 'unauthorized_billing')
  assert.equal(classify(line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', isUsingOverage: true } })).state, 'unauthorized_billing')
  assert.equal(classifyObservation({ auth: normalizeAuthStatus({ ...OBSERVED_AUTH, planTier: 'zzz' }, { now: NOW }) }, { now: NOW }).state, 'auth_unverified')
  assert.equal(classifyObservation({ auth: normalizeAuthStatus({ ...OBSERVED_AUTH, authMethod: 'api_key' }, { now: NOW }) }, { now: NOW }).state, 'unauthorized_billing')
  assert.equal(classifyObservation({ auth: normalizeAuthStatus({ ...OBSERVED_AUTH, loginExpiresAt: '2020-01-01T00:00:00Z' }, { now: NOW }) }, { now: NOW }).state, 'auth_expired')
})

test('waiting schedule: provider reset + margin; unknown reset → bounded exponential backoff with jitter; never aggressive polling', () => {
  const rng = () => 0.5
  const ex = nextGovernorState(null, { state: 'exhausted', reason_codes: [], resets_at_ms: NOW + 3600000 }, { now: NOW, rng })
  assert.equal(ex.next_eligible_at, NOW + 3600000 + G.reset_safety_margin_ms + G.reset_jitter_ms / 2)
  assert.deepEqual(ex.lifecycle, { state: 'waiting_subscription', reason: 'SUBSCRIPTION_LIMIT' })
  let s = null; const waits = []
  for (let i = 0; i < 6; i += 1) { s = nextGovernorState(s, { state: 'exhausted', reason_codes: [], resets_at_ms: null }, { now: NOW, rng }); waits.push(s.next_eligible_at - NOW) }
  assert.deepEqual(waits, [15, 30, 60, 60, 60, 60].map((m) => m * 60000))
  const lo = nextGovernorState(null, { state: 'unknown', reason_codes: [] }, { now: NOW, rng: () => 0 })
  const hi = nextGovernorState(null, { state: 'unknown', reason_codes: [] }, { now: NOW, rng: () => 0.9999 })
  assert.ok(lo.next_eligible_at - NOW >= G.min_retry_interval_ms && hi.next_eligible_at - NOW <= G.backoff_base_ms * 1.2 + 1)
  const past = nextGovernorState(null, { state: 'exhausted', reason_codes: [], resets_at_ms: NOW - 10 * 3600000 }, { now: NOW, rng })
  assert.ok(past.next_eligible_at >= NOW + G.min_retry_interval_ms, 'a stale reset time cannot cause immediate retries')
  for (const st of ['auth_expired', 'auth_unverified', 'unauthorized_billing']) { const x = nextGovernorState(null, { state: st, reason_codes: [] }, { now: NOW, rng }); assert.equal(x.next_eligible_at, null); assert.equal(x.owner_attention, true) }
  let u = null; for (let i = 0; i < G.unknown_escalation_count; i += 1) u = nextGovernorState(u, { state: 'unknown', reason_codes: [] }, { now: NOW, rng })
  assert.equal(u.owner_attention, true)
})

test('lifecycle mapping uses only D3.2 reasons, quota is never a blocker, and the reducer accepts every mapping', () => {
  const lc = loadLifecycle()
  for (const st of STATES) {
    const m = lifecycleFor(st)
    if (m.state === 'running') continue
    assert.ok(lc.recoverable_states[m.state].reasons.includes(m.reason), `${st} → ${m.state}/${m.reason}`)
    const task = createTask({ task_id: 't1' })
    const r = applyEvent(lc, { ...task, state: 'implementing' }, { event_id: 'e1', idempotency_id: 'i1', task_id: 't1', kind: 'transition', to: m.state, reason_code: m.reason, expected_revision: 0, fencing_token: 1 })
    assert.equal(r.ok, true, `${st}: ${r.problems}`)
  }
  assert.equal(lifecycleFor('exhausted').state, 'waiting_subscription')
})

test('AI admission: extra usage must be verified off; shared GitHub-workflow headroom; eligibility time respected', () => {
  const base = nextGovernorState(null, classify(FIXTURE), { now: NOW, rng: () => 0.5 })
  assert.equal(base.extra_usage.enabled, false); assert.deepEqual(admitAiWork(base, { now: NOW }), { admit: true, codes: [] })
  assert.deepEqual(admitAiWork({ ...base, extra_usage: { enabled: null } }, { now: NOW }).codes, ['AUTH.EXTRA_USAGE_UNVERIFIED'])
  assert.deepEqual(admitAiWork({ ...base, extra_usage: { enabled: true } }, { now: NOW }).codes, ['AUTH.EXTRA_USAGE_ENABLED'])
  const hot = { ...base, windows: { seven_day: { utilization: 0.9 } } }
  assert.equal(admitAiWork(hot, { now: NOW, priority: 'maintenance' }).admit, false)
  assert.equal(admitAiWork(hot, { now: NOW, priority: 'security' }).admit, true)
  assert.equal(admitAiWork({ ...base, state: 'exhausted', next_eligible_at: NOW + 1 }, { now: NOW }).admit, false)
  assert.equal(admitAiWork({ ...base, next_eligible_at: NOW + 1 }, { now: NOW }).admit, false)
  assert.equal(admitAiWork(null, { now: NOW }).admit, false)
  const later = nextGovernorState(base, { state: 'available', reason_codes: [], extra_usage: { enabled: null } }, { now: NOW + G.extra_usage_fact_ttl_ms + 1, rng: () => 0.5 })
  assert.equal(later.extra_usage.enabled, null, 'a verified-off fact expires and must be re-established')
})

test('model availability changes are detected; nothing falls back to a paid model', () => {
  assert.deepEqual(classifyModel('haiku', telemetryOf(FIXTURE)), { available: true, code: null, ran: 'claude-haiku-5-5' })
  const gone = telemetryOf(line({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', apiKeySource: 'none' }) + '\n' + line({ type: 'result', is_error: true, subtype: 'error_during_execution', api_error_status: 404 }))
  assert.equal(classifyModel('opus', gone).available, false)
  assert.equal(classifyModel('sonnet', telemetryOf(FIXTURE)).code, 'MODEL.RESOLVED_DIFFERENTLY')
  assert.equal(classifyModel('x', createTelemetry()).code, 'MODEL.NOT_REPORTED')
})

test('remediation: extra-usage TTL is enforced at admission, waiting states retry once eligible, implausible resets are ignored', () => {
  const ok = { schema: 'x', state: 'available', next_eligible_at: NOW, windows: {}, extra_usage: { enabled: false, verified_at: NOW - 1000 } }
  assert.equal(admitAiWork(ok, { now: NOW }).admit, true)
  assert.deepEqual(admitAiWork({ ...ok, extra_usage: { enabled: false, verified_at: NOW - G.extra_usage_fact_ttl_ms } }, { now: NOW }).codes, ['AUTH.EXTRA_USAGE_UNVERIFIED'], 'a stale record cannot admit')
  assert.deepEqual(admitAiWork({ ...ok, extra_usage: { enabled: false } }, { now: NOW }).codes, ['AUTH.EXTRA_USAGE_UNVERIFIED'])
  assert.deepEqual(admitAiWork({ ...ok, extra_usage: { enabled: false, verified_at: NOW + 60000 } }, { now: NOW }).codes, ['AUTH.EXTRA_USAGE_UNVERIFIED'], 'a future timestamp is not trusted')
  const ex = { ...ok, state: 'exhausted', next_eligible_at: NOW + 60000 }
  assert.equal(admitAiWork(ex, { now: NOW }).admit, false)
  assert.deepEqual(admitAiWork(ex, { now: NOW + 60000 }), { admit: true, codes: ['SUBSCRIPTION.RETRY_ATTEMPT'], retry_of: 'exhausted' })
  for (const st of ['auth_expired', 'auth_unverified', 'unauthorized_billing', 'bogus']) assert.equal(admitAiWork({ ...ok, state: st, next_eligible_at: null }, { now: NOW + 1e9 }).admit, false, st)
  const far = classify(line({ type: 'system', subtype: 'init', apiKeySource: 'none' }) + '\n' + line({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(NOW / 1000) + 30 * 86400 } }))
  assert.equal(far.state, 'exhausted'); assert.equal(far.resets_at_ms, null); assert.equal(far.reset_basis, 'IMPLAUSIBLE_RESET_IGNORED')
})

test('remediation: a stream without init is never "available"; neutral launcher kills leave the governor unchanged', () => {
  const noInit = classify(FIXTURE.split('\n').slice(1).join('\n'), { noInit: true })
  assert.equal(noInit.state, 'unknown'); assert.deepEqual(noInit.reason_codes, ['SESSION.INIT_MISSING'])
  const killed = classifyObservation({ telemetry: telemetryOf(FIXTURE.split('\n')[0]), killedReason: 'LAUNCH.CANCELLED' }, { now: NOW })
  assert.equal(killed.state, null)
  const prev = nextGovernorState(null, classify(FIXTURE), { now: NOW, rng: () => 0.5 })
  const after = nextGovernorState(prev, killed, { now: NOW + 5000, rng: () => 0.5 })
  assert.equal(after.state, prev.state); assert.equal(after.attempts, prev.attempts); assert.equal(after.updated_at, NOW + 5000)
  assert.equal(classifyObservation({ telemetry: telemetryOf(''), killedReason: 'LAUNCH.INIT_MISSING' }, { now: NOW }).state, 'unknown')
  assert.deepEqual(verifyInit(telemetryOf(FIXTURE).init, undefined), ['SESSION.EXPECTATION_MISSING'])
  assert.deepEqual(verifyInit({ ...telemetryOf(FIXTURE).init, mcp_servers: null }, { mcpServers: [] }), ['SESSION.UNEXPECTED_MCP_SERVER'], 'a missing field is a mismatch')
  assert.deepEqual(verifyInit({ ...telemetryOf(FIXTURE).init, plugins: [{ name: 'x', source: 'evil@claude-plugins-official' }] }, { pluginSources: ['claude-plugins-official'] }), ['SESSION.UNEXPECTED_PLUGIN'], 'exact source match, not suffix')
})
