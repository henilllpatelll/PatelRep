// Developer Harness V3 (D3.3) — Subscription Governor.
//
// Deterministic. Normalizes what the OFFICIAL CLI reports into D3.2's canonical identities and decides whether AI work may start, wait or must stop.
// Hard rules (never configurable here): zero incremental spend; no API-key, cloud-provider or gateway authentication; no paid fallback; extra usage
// must be positively verified OFF; never rotate accounts or credentials; never poll aggressively; never evade a provider limit; quota exhaustion is a
// recoverable wait (`waiting_subscription`), never a genuine blocker. Every fact carries its `basis` so an unverified fact is never presented as verified.
//
// Lifecycle mapping (D3.2 task-lifecycle.json reasons only; adding a dedicated PROVIDER_UNAVAILABLE reason is a D3.4 contract proposal):
//   available/approaching → run · exhausted → waiting_subscription/SUBSCRIPTION_LIMIT · provider_unavailable, network_unavailable, unknown →
//   waiting_external/NETWORK_UNAVAILABLE · auth_expired → blocked/OWNER_AUTH_EXPIRED · auth_unverified, unauthorized_billing → blocked/OWNER_DECISION_REQUIRED
export const STATES = Object.freeze(['available', 'approaching', 'exhausted', 'provider_unavailable', 'network_unavailable', 'auth_expired', 'auth_unverified', 'unauthorized_billing', 'unknown'])

export const GOVERNOR_DEFAULTS = Object.freeze({
  approaching_utilization: 0.8,
  // GitHub workflows share this subscription invisibly (CLAUDE_CODE_OAUTH_TOKEN). Keep headroom: non-critical work stops earlier.
  shared_headroom: { five_hour: 0.9, seven_day: 0.85 },
  reset_safety_margin_ms: 120000,
  reset_jitter_ms: 60000,
  backoff_base_ms: 15 * 60000,
  backoff_cap_ms: 60 * 60000,
  backoff_jitter_ratio: 0.2,
  min_retry_interval_ms: 5 * 60000,
  extra_usage_fact_ttl_ms: 6 * 3600000,
  login_expiry_warning_ms: 72 * 3600000,
  unknown_escalation_count: 6,
})

/**
 * `claude auth status --json` (official CLI). Documented fields: authMethod (none|claude.ai|oauth_token|api_key|api_key_helper|third_party), loginExpiresAt.
 * Observed (official binary 2.1.331, undocumented): apiProvider, subscriptionType, planTier. The plan is normalized ONLY from the exact observed pair
 * (subscriptionType "max", planTier "max_5x"); anything else is null → AUTH.PLAN_UNKNOWN downstream. Identifying fields (email, org) are never read.
 */
export function normalizeAuthStatus(j, { now }) {
  const facts = { verified: false, verified_by: 'launcher', source: null, plan: null, plan_basis: null, login_expires_at: null, problems: [] }
  if (!j || typeof j !== 'object' || Array.isArray(j)) { facts.problems.push('AUTH.STATUS_UNPARSABLE'); return facts }
  if (j.loggedIn !== true) facts.problems.push('AUTH.NOT_LOGGED_IN')
  if (j.authMethod === 'claude.ai' && (j.apiProvider === undefined || j.apiProvider === 'firstParty')) facts.source = 'claude_subscription_oauth'
  else facts.problems.push(`AUTH.METHOD_NOT_SUBSCRIPTION:${String(j.authMethod).slice(0, 32)}`)
  // ONLY the pair actually observed from the official CLI on this account. Other plans stay unnormalized (→ AUTH.PLAN_UNKNOWN) until observed.
  const PLAN_MAP = { 'max|max_5x': 'claude_max_5x' }
  const key = `${j.subscriptionType}|${j.planTier}`
  if (Object.hasOwn(PLAN_MAP, key)) { facts.plan = PLAN_MAP[key]; facts.plan_basis = 'official_cli_auth_status.subscriptionType+planTier (observed; undocumented field)' }
  else facts.problems.push('AUTH.PLAN_NOT_NORMALIZABLE')
  if (j.loginExpiresAt === null) facts.login_expires_at = null
  else if (typeof j.loginExpiresAt === 'string' && Number.isFinite(Date.parse(j.loginExpiresAt))) {
    facts.login_expires_at = j.loginExpiresAt
    if (Date.parse(j.loginExpiresAt) <= now) facts.problems.push('AUTH.LOGIN_EXPIRED')
  } else facts.problems.push('AUTH.EXPIRY_UNPARSABLE')
  facts.verified = facts.problems.length === 0 && facts.source === 'claude_subscription_oauth' && facts.plan !== null
  return facts
}

/**
 * Extra usage (usage credits) from rate_limit_event records (normalized by session-telemetry). Returns {enabled:true|false|null, basis}.
 * ANY sign that overage is enabled or in use wins over every "disabled" sign. `false` requires either the documented `overageEnabled:false`, or the
 * observed triple overageStatus "rejected" + overageDisabledReason "org_level_disabled" + isUsingOverage false.
 */
export function extraUsageFromRateLimits(events) {
  let verdict = { enabled: null, basis: 'NO_PROVIDER_SIGNAL' }
  for (const r of events ?? []) {
    if (r.overage_enabled === true || r.is_using_overage === true || r.overage_status === 'allowed' || r.overage_status === 'allowed_warning' || r.rate_limit_type === 'overage')
      return { enabled: true, basis: 'provider_reported_overage_active_or_enabled' }
    if (r.overage_enabled === false) verdict = { enabled: false, basis: 'rate_limit_event.overageEnabled=false (documented)' }
    else if (verdict.enabled !== false && r.overage_status === 'rejected' && r.overage_disabled_reason === 'org_level_disabled' && r.is_using_overage === false)
      verdict = { enabled: false, basis: 'rate_limit_event overageStatus=rejected+overageDisabledReason=org_level_disabled+isUsingOverage=false (observed; undocumented fields)' }
  }
  return verdict
}

/** Classify one completed (or failed) session observation into a governor state. */
/** Launcher-side kills that say nothing about the subscription: the governor state is left unchanged (state:null). */
export const NEUTRAL_KILLS = Object.freeze(['LAUNCH.WALL_TIME_EXCEEDED', 'LAUNCH.CANCELLED', 'LAUNCH.STREAM_LINE_TOO_LARGE', 'LAUNCH.SPAWN_FAILED'])
export const MAX_PROVIDER_RESET_MS = 8 * 24 * 3600000

export function classifyObservation({ auth = null, telemetry = null, exit = null, network = null, killedReason = null }, { now }, cfg = GOVERNOR_DEFAULTS) {
  const codes = []
  const rl = telemetry?.rate_limits ?? []
  const extra = extraUsageFromRateLimits(rl)
  if (extra.enabled === true) return out('unauthorized_billing', ['AUTH.EXTRA_USAGE_ENABLED'])
  if (telemetry?.init && telemetry.init.apiKeySource !== 'none') return out('unauthorized_billing', [`AUTH.API_KEY_SOURCE_ACTIVE:${String(telemetry.init.apiKeySource).slice(0, 40)}`])
  // A stream without init cannot prove the auth source: never "available".
  if (telemetry && !telemetry.init && (telemetry.result || rl.length)) return out('unknown', ['SESSION.INIT_MISSING'])
  if (auth) {
    if (auth.problems?.includes('AUTH.LOGIN_EXPIRED') || auth.problems?.includes('AUTH.NOT_LOGGED_IN')) return out('auth_expired', auth.problems)
    if (!auth.verified) return out(auth.source === null ? 'unauthorized_billing' : 'auth_unverified', auth.problems?.length ? auth.problems : ['AUTH.UNVERIFIED'])
  }
  const res = telemetry?.result
  const status401 = res?.api_error_status === 401 || (telemetry?.api_retries ?? []).some((r) => r.error_status === 401)
  if (status401) return out('auth_expired', ['AUTH.PROVIDER_REJECTED_CREDENTIAL'])
  const billingRetry = (telemetry?.api_retries ?? []).some((r) => r.error === 'billing_error')
  if (billingRetry) return out('unauthorized_billing', ['AUTH.PROVIDER_BILLING_ERROR'])
  const rejected = [...rl].reverse().find((r) => r.status === 'rejected')
  if (rejected || res?.api_error_status === 429 || rl.some((r) => r.error_code === 'credits_required')) {
    const reset = rejected?.resets_at ?? null
    // A reset more than 8 days out (beyond the weekly window) is treated as not reported → bounded backoff, never an indefinite wait.
    const plausible = Number.isFinite(reset) && reset * 1000 - now <= MAX_PROVIDER_RESET_MS
    return out('exhausted', ['SUBSCRIPTION.LIMIT_REACHED'], { resets_at_ms: plausible ? reset * 1000 : null, reset_basis: plausible ? 'provider_reported_resetsAt' : Number.isFinite(reset) ? 'IMPLAUSIBLE_RESET_IGNORED' : 'NOT_REPORTED' })
  }
  if (network === 'unreachable') return out('network_unavailable', ['NETWORK.UNREACHABLE'])
  if (killedReason === 'LAUNCH.INIT_MISSING') return out('unknown', ['SESSION.INIT_MISSING'])
  if (killedReason && NEUTRAL_KILLS.includes(killedReason) && !res) return out(null, ['SESSION.KILLED_BY_LAUNCHER'])
  if (res?.api_error_status != null && res.api_error_status >= 500) return out('provider_unavailable', [`PROVIDER.HTTP_${res.api_error_status}`])
  if ((telemetry?.api_retries ?? []).some((r) => r.error_status === 529 || r.error === 'overloaded') && res?.is_error) return out('provider_unavailable', ['PROVIDER.OVERLOADED'])
  if (!res) return out('unknown', [exit?.code === 0 ? 'PROVIDER.NO_RESULT_EVENT' : 'PROVIDER.NO_RESULT_EVENT_NONZERO_EXIT'])
  if (res.is_error && res.subtype !== 'error_max_turns') return out('unknown', [`PROVIDER.RESULT_ERROR:${String(res.subtype).slice(0, 40)}`])
  const latest = rl[rl.length - 1]
  const util = latest ? Math.max(0, ...Object.values(latest.windows ?? {}).map((w) => w.utilization ?? 0), latest.utilization ?? 0) : null
  if (latest?.status === 'allowed_warning' || (util != null && util >= cfg.approaching_utilization)) codes.push('SUBSCRIPTION.APPROACHING_LIMIT')
  return out(codes.length ? 'approaching' : 'available', codes, { utilization: util, windows: latest?.windows ?? null })
  function out(state, reason_codes, extraFields = {}) { return { state, reason_codes, extra_usage: extra, observed_at: now, ...extraFields } }
}

/** Deterministic jitter in [−r, +r] from a caller-supplied rng (tests inject a fixed one). */
const jitter = (ms, r, rng) => Math.round(ms * (1 + (rng() * 2 - 1) * r))

/**
 * Advance the governor. `prev` is the persisted governor record; `obs` the latest classification. Returns the next record with `next_eligible_at`.
 * Exhaustion with a provider reset → resets_at + margin + jitter. Without one → exponential backoff (base..cap) with jitter. Never earlier than
 * `min_retry_interval_ms` after the last attempt, so the governor can never poll aggressively.
 */
export function nextGovernorState(prev, obs, { now, rng = Math.random }, cfg = GOVERNOR_DEFAULTS) {
  if (obs.state === null) return prev ? { ...prev, updated_at: now } : null // neutral launcher kill: nothing learned about the subscription
  const attempts = obs.state === prev?.state && ['exhausted', 'provider_unavailable', 'network_unavailable', 'unknown'].includes(obs.state) ? (prev.attempts ?? 0) + 1 : 1
  let next = now
  if (obs.state === 'exhausted' && Number.isFinite(obs.resets_at_ms)) next = obs.resets_at_ms + cfg.reset_safety_margin_ms + Math.round(rng() * cfg.reset_jitter_ms)
  else if (['exhausted', 'provider_unavailable', 'network_unavailable', 'unknown'].includes(obs.state)) next = now + jitter(Math.min(cfg.backoff_cap_ms, cfg.backoff_base_ms * 2 ** (attempts - 1)), cfg.backoff_jitter_ratio, rng)
  else if (['auth_expired', 'auth_unverified', 'unauthorized_billing'].includes(obs.state)) next = null // owner action required; no automatic retry
  if (next !== null) next = Math.max(next, now + (obs.state === 'available' || obs.state === 'approaching' ? 0 : cfg.min_retry_interval_ms))
  const extra = obs.extra_usage?.enabled === false ? { enabled: false, basis: obs.extra_usage.basis, verified_at: now }
    : obs.extra_usage?.enabled === true ? { enabled: true, basis: obs.extra_usage.basis, verified_at: now }
      // a carried-forward "verified off" fact must be in the past and within its TTL (a future timestamp would stretch the TTL)
      : (prev?.extra_usage?.enabled === false && Number.isFinite(prev.extra_usage.verified_at) && prev.extra_usage.verified_at <= now && now - prev.extra_usage.verified_at < cfg.extra_usage_fact_ttl_ms
        ? prev.extra_usage : { enabled: null, basis: 'UNVERIFIED_OR_EXPIRED', verified_at: null })
  return { schema: 'patelrep.developer-harness-v3.subscription-governor', state: obs.state, reason_codes: obs.reason_codes, attempts, next_eligible_at: next, resets_at_ms: obs.resets_at_ms ?? null,
    reset_basis: obs.reset_basis ?? null, utilization: obs.utilization ?? null, windows: obs.windows ?? null, extra_usage: extra, updated_at: now,
    owner_attention: ['auth_expired', 'auth_unverified', 'unauthorized_billing'].includes(obs.state) || (obs.state === 'unknown' && attempts >= cfg.unknown_escalation_count), lifecycle: lifecycleFor(obs.state) }
}

export function lifecycleFor(state) {
  switch (state) {
    case 'available': case 'approaching': return { state: 'running', reason: null }
    case 'exhausted': return { state: 'waiting_subscription', reason: 'SUBSCRIPTION_LIMIT' }
    case 'provider_unavailable': case 'network_unavailable': case 'unknown': return { state: 'waiting_external', reason: 'NETWORK_UNAVAILABLE' }
    case 'auth_expired': return { state: 'blocked', reason: 'OWNER_AUTH_EXPIRED' }
    default: return { state: 'blocked', reason: 'OWNER_DECISION_REQUIRED' }
  }
}

/**
 * May a NEW AI session start now? Deterministic work never asks this. `priority`: critical|security|owner|maintenance.
 * Shared-headroom: maintenance and owner work stop at the headroom line; only critical/security may use the last slice.
 */
export function admitAiWork(gov, { now, priority = 'owner' }, cfg = GOVERNOR_DEFAULTS) {
  if (!gov) return { admit: false, codes: ['SUBSCRIPTION.STATE_UNKNOWN'] }
  if (gov.extra_usage?.enabled === true) return { admit: false, codes: ['AUTH.EXTRA_USAGE_ENABLED'] }
  // The verified-off fact expires: it is re-checked HERE, not only when the record is advanced.
  if (gov.extra_usage?.enabled !== false || !Number.isFinite(gov.extra_usage.verified_at) || now - gov.extra_usage.verified_at >= cfg.extra_usage_fact_ttl_ms || gov.extra_usage.verified_at > now) return { admit: false, codes: ['AUTH.EXTRA_USAGE_UNVERIFIED'] }
  if (['auth_expired', 'auth_unverified', 'unauthorized_billing'].includes(gov.state) || !STATES.includes(gov.state)) return { admit: false, codes: [`SUBSCRIPTION.STATE:${gov.state}`], next_eligible_at: null }
  if (gov.next_eligible_at != null && now < gov.next_eligible_at) return { admit: false, codes: ['SUBSCRIPTION.NOT_YET_ELIGIBLE'], next_eligible_at: gov.next_eligible_at }
  // Waiting states become eligible for ONE retry once the scheduled time has passed; the retry's own stream re-classifies the state (automatic resume).
  if (!['available', 'approaching'].includes(gov.state)) return { admit: true, codes: ['SUBSCRIPTION.RETRY_ATTEMPT'], retry_of: gov.state }
  const w = gov.windows ?? {}
  const over = (k) => Number.isFinite(w[k]?.utilization) && w[k].utilization >= cfg.shared_headroom[k]
  if ((over('five_hour') || over('seven_day')) && !['critical', 'security'].includes(priority)) return { admit: false, codes: ['SUBSCRIPTION.SHARED_HEADROOM_RESERVED'] }
  return { admit: true, codes: gov.state === 'approaching' ? ['SUBSCRIPTION.APPROACHING_LIMIT'] : [] }
}

/** Model availability from a session: the model the CLI actually ran vs. the one requested. Never falls back to a paid model. */
export function classifyModel(requested, telemetry) {
  const ran = telemetry?.init?.model ?? null
  if (!ran) return { available: null, code: 'MODEL.NOT_REPORTED' }
  const res = telemetry.result
  if (res?.is_error && (res.api_error_status === 404 || res.errors?.some((e) => /model/i.test(e) && /not (found|available)|unavailable|invalid/i.test(e)))) return { available: false, code: 'MODEL.UNAVAILABLE', ran }
  return { available: true, code: requested && !ran.includes(requested) ? 'MODEL.RESOLVED_DIFFERENTLY' : null, ran }
}

// ---- Persisted governor state and the owner's one-shot extra-usage attestation (host-only file, read through readJsonState) ----

export const SUBSCRIPTION_STATE_SCHEMA = 'patelrep.developer-harness-v3.subscription-governor'
/** An attestation lives at most this long; it permits ONE bounded probe and never verifies extra usage by itself. */
export const ATTESTATION_TTL_MS = 24 * 3600000
const isPlainObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const finiteOrNull = (x) => x === null || Number.isFinite(x)
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Exact shape of the persisted subscription record, for `readJsonState` (which accepts only a boolean `true`). The schema must match exactly;
 * every field a reader trusts is type-checked. The attestation's own validity is decided at use by `attestationStatus`, not here, so a used or
 * expired attestation never makes the governor state unreadable.
 */
export function isSubscriptionStateRecord(v) {
  if (!isPlainObj(v) || v.schema !== SUBSCRIPTION_STATE_SCHEMA) return false
  if ('state' in v && !STATES.includes(v.state)) return false
  if ('next_eligible_at' in v && !finiteOrNull(v.next_eligible_at)) return false
  if ('updated_at' in v && !Number.isFinite(v.updated_at)) return false
  if ('extra_usage' in v) {
    const e = v.extra_usage
    if (!isPlainObj(e) || ![true, false, null].includes(e.enabled) || !('verified_at' in e) || !finiteOrNull(e.verified_at)) return false
    if (e.enabled !== null && !Number.isFinite(e.verified_at)) return false // a verified fact always carries its time
  }
  if ('owner_attestation' in v && !isPlainObj(v.owner_attestation)) return false
  return true
}

/** A fresh owner attestation (`dh3 attest-extra-usage-off`). `nonce` must be a v4 UUID (crypto.randomUUID). */
export function buildOwnerAttestation({ now, nonce }) {
  if (!Number.isFinite(now) || typeof nonce !== 'string' || !UUID_V4.test(nonce)) throw new Error('ATTESTATION.BAD_INPUT')
  return { extra_usage_off: true, nonce, attested_at: new Date(now).toISOString(), expires_at: new Date(now + ATTESTATION_TTL_MS).toISOString(), used: false,
    scope: 'permits ONE bounded subscription probe; does not by itself verify extra usage' }
}

/**
 * May this attestation authorize a probe at `now`? → {ok:true} | {ok:false, code}. Fail closed on anything not produced by
 * `buildOwnerAttestation`: MISSING, MALFORMED (types, nonce, timestamps, a window longer than 24 h, or attested in the future), USED, EXPIRED.
 */
export function attestationStatus(att, now) {
  if (att === undefined || att === null) return { ok: false, code: 'ATTESTATION.MISSING' }
  if (!isPlainObj(att) || att.extra_usage_off !== true || typeof att.nonce !== 'string' || !UUID_V4.test(att.nonce) || typeof att.used !== 'boolean'
    || typeof att.attested_at !== 'string' || !ISO_MS.test(att.attested_at) || typeof att.expires_at !== 'string' || !ISO_MS.test(att.expires_at) || !Number.isFinite(now)) {
    return { ok: false, code: 'ATTESTATION.MALFORMED' }
  }
  const t0 = Date.parse(att.attested_at); const t1 = Date.parse(att.expires_at)
  // exact round trip: an impossible calendar date (e.g. 02-30, which Date.parse rolls over) is malformed, not reinterpreted
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || new Date(t0).toISOString() !== att.attested_at || new Date(t1).toISOString() !== att.expires_at) return { ok: false, code: 'ATTESTATION.MALFORMED' }
  if (t1 <= t0 || t1 - t0 > ATTESTATION_TTL_MS || t0 > now) return { ok: false, code: 'ATTESTATION.MALFORMED' }
  if (att.used !== false) return { ok: false, code: 'ATTESTATION.USED' }
  if (now >= t1) return { ok: false, code: 'ATTESTATION.EXPIRED' }
  return { ok: true }
}
