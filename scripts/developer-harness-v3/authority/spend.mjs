// Developer Harness V3 (D3.2) — subscription-only authentication and worker-environment checks.
//
// Pure. Inputs are NAMES of environment variables and settings KEYS, never values, so nothing secret is read, logged or echoed.
// Why this exists: per Anthropic's Claude Code documentation, `claude -p` always uses ANTHROPIC_API_KEY when it is present in the
// environment, even for an account that is logged in with a Pro subscription, and that usage is billed at pay-as-you-go API rates.
// The harness therefore refuses to launch whenever a paid authentication path could be selected, and fails closed when the active
// authentication source cannot be positively verified as the owner's native Pro subscription login.
import { matchesName } from '../lib/paths.mjs'

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

/** @returns {string[]} reason codes (empty = acceptable). `settings` must be the MERGED effective settings from every scope (user, project, local, managed). */
export function checkLaunchAuthentication({ envNames = [], settings = {}, auth = null }, contract) {
  const codes = []
  // Claude Code applies `settings.env` to the process, so those names are part of the effective environment.
  const settingsEnv = isObj(settings?.env) ? Object.keys(settings.env) : []
  const upper = new Set([...envNames, ...settingsEnv].map((n) => String(n).toUpperCase()))
  for (const name of contract.forbidden_auth_environment) if (upper.has(name.toUpperCase())) codes.push(`AUTH.FORBIDDEN_ENVIRONMENT:${name}`)
  for (const entry of contract.forbidden_auth_settings) {
    const [k, val] = entry.split(':')
    const actual = isObj(settings) ? settings[k] : undefined
    if (val === undefined ? Object.hasOwn(settings ?? {}, k) : typeof actual === 'string' && actual.toLowerCase() === val.toLowerCase()) codes.push(`AUTH.FORBIDDEN_SETTING:${entry}`)
  }
  // Positive verification, performed by the trusted launcher (e.g. by parsing the official CLI's own status output). Anything else fails closed.
  if (!isObj(auth)) codes.push('AUTH.UNVERIFIED')
  else {
    if (auth.verified_by !== 'launcher' || auth.verified !== true) codes.push('AUTH.UNVERIFIED')
    if (auth.source !== 'claude_subscription_oauth') codes.push('AUTH.PAID_OR_UNKNOWN_SOURCE')
    if (auth.plan !== 'pro') codes.push('AUTH.PLAN_NOT_PRO')
    if (auth.paid_usage_enabled !== false) codes.push('AUTH.PAID_USAGE_NOT_VERIFIED_DISABLED')
  }
  return [...new Set(codes)]
}

/**
 * A worker environment is an ALLOW-LIST. A name that is not on the list is refused (`ENV.NAME_NOT_ALLOWLISTED`); the credential-shaped
 * patterns only decide which code a refusal gets, so an unknown secret name can no longer slip through a denylist gap.
 */
export function checkCredentialEnvironment(names, contract) {
  const codes = []
  for (const raw of names) {
    const name = String(raw)
    if (contract.worker_environment_allowlist.some((p) => matchesName(p, name)) && !contract.credential_environment_patterns.some((p) => matchesName(p, name))) continue
    codes.push(contract.credential_environment_patterns.some((p) => matchesName(p, name)) ? `CREDENTIAL.IN_WORKER_ENV:${name.slice(0, 60)}` : `ENV.NAME_NOT_ALLOWLISTED:${name.slice(0, 60)}`)
  }
  return codes
}

/** Any amount above the contract limit is unauthorized; the limit is currently zero incremental dollars. */
export function checkSpend({ incrementalUsd = 0, purchase = false }, contract) {
  const codes = []
  if (!Number.isFinite(incrementalUsd) || incrementalUsd < 0) codes.push('SPEND.INVALID_AMOUNT')
  else if (incrementalUsd > contract.limits.max_incremental_usd) codes.push('SPEND.UNAUTHORIZED')
  if (purchase) codes.push('SPEND.PURCHASE_FORBIDDEN')
  return codes
}
