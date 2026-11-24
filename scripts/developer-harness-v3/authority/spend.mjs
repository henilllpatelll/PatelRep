// Developer Harness V3 (D3.2) — subscription-only authentication and credential-environment checks.
//
// Pure. Inputs are NAMES of environment variables and settings keys, never values, so nothing secret is read, logged or echoed.
// Why this exists: per Anthropic's Claude Code documentation, `claude -p` always uses ANTHROPIC_API_KEY when it is present in the
// environment, even for an account that is logged in with a Pro subscription, and that usage is billed at pay-as-you-go API rates.
// The harness therefore refuses to launch whenever a paid authentication path could be selected, and fails closed when the active
// authentication source cannot be positively verified as the owner's native Pro subscription login.

/** @returns {string[]} reason codes (empty = acceptable) */
export function checkLaunchAuthentication({ envNames = [], settings = {}, auth = null }, contract) {
  const codes = []
  const upper = new Set(envNames.map((n) => String(n).toUpperCase()))
  for (const name of contract.forbidden_auth_environment) if (upper.has(name.toUpperCase())) codes.push(`AUTH.FORBIDDEN_ENVIRONMENT:${name}`)
  for (const key of contract.forbidden_auth_settings) {
    const [k, val] = key.split(':')
    if (val === undefined ? Object.hasOwn(settings, k) : settings[k] === val) codes.push(`AUTH.FORBIDDEN_SETTING:${key}`)
  }
  // Positive verification, performed by the trusted launcher (e.g. by parsing the official CLI's own status output). Anything else fails closed.
  if (!auth || typeof auth !== 'object') codes.push('AUTH.UNVERIFIED')
  else {
    if (auth.verified_by !== 'launcher' || auth.verified !== true) codes.push('AUTH.UNVERIFIED')
    if (auth.source !== 'claude_subscription_oauth') codes.push('AUTH.PAID_OR_UNKNOWN_SOURCE')
    if (auth.plan !== 'pro') codes.push('AUTH.PLAN_NOT_PRO')
    if (auth.paid_usage_enabled !== false) codes.push('AUTH.PAID_USAGE_NOT_VERIFIED_DISABLED')
  }
  return [...new Set(codes)]
}

/** Credential-shaped variable NAMES must never be present in a candidate-writable worker environment. */
export function checkCredentialEnvironment(envNames, contract) {
  const res = contract.credential_environment_patterns.map((p) => new RegExp(p, 'i'))
  const hits = []
  for (const name of envNames) if (res.some((re) => re.test(String(name)))) hits.push(`CREDENTIAL.IN_WORKER_ENV:${String(name).slice(0, 60)}`)
  return hits
}

/** Any amount above the contract limit is unauthorized; the limit is currently zero incremental dollars. */
export function checkSpend({ incrementalUsd = 0, purchase = false }, contract) {
  const codes = []
  if (!Number.isFinite(incrementalUsd) || incrementalUsd < 0) codes.push('SPEND.INVALID_AMOUNT')
  else if (incrementalUsd > contract.limits.max_incremental_usd) codes.push('SPEND.UNAUTHORIZED')
  if (purchase) codes.push('SPEND.PURCHASE_FORBIDDEN')
  return codes
}
