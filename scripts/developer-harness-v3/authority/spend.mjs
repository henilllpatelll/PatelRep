// Developer Harness V3 (D3.2) — subscription-only authentication and worker-environment checks.
//
// Pure. Inputs are NAMES of environment variables and settings KEYS, never values, so nothing secret is read, logged or echoed.
// Why this exists: per Anthropic's Claude Code documentation, `claude -p` always uses ANTHROPIC_API_KEY when it is present in the
// environment, even for an account that is logged in with a subscription, and that usage is billed at pay-as-you-go API rates.
// The harness therefore refuses to launch whenever a paid authentication path could be selected, and fails closed when the active
// authentication source cannot be positively verified as the owner's native, explicitly authorized subscription login.
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
    // `plan` is a CANONICAL identity produced by the trusted launcher's normalization of the CLI's own report (D3.3). Nothing here knows or
    // guesses a provider string. A plan that is not in the vocabulary is unknown; a known plan the owner has not authorized is refused. Neither
    // outcome changes what may be spent: the zero-spend limit is independent of the plan.
    const sub = contract.subscription
    if (typeof auth.plan !== 'string' || !sub.known_plans.includes(auth.plan)) codes.push('AUTH.PLAN_UNKNOWN')
    else if (!sub.authorized_plans.includes(auth.plan)) codes.push('AUTH.PLAN_NOT_AUTHORIZED')
    // Paid extra usage must be positively verified OFF; unknown is not off.
    if (auth.extra_usage_enabled === true) codes.push('AUTH.EXTRA_USAGE_ENABLED')
    else if (auth.extra_usage_enabled !== false) codes.push('AUTH.EXTRA_USAGE_UNVERIFIED')
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

/**
 * Behavior-sensitive variables (NODE_OPTIONS, proxy and certificate settings) change what a worker executes and where its traffic goes. Their VALUES
 * must originate exclusively from the trusted launcher. The launcher reports an origin label per EXACT name (never the value). On the Linux worker
 * `https_proxy` and `HTTPS_PROXY` are different variables and tools read both, so:
 *   - the origin is looked up by the exact name present, never case-folded;
 *   - two case-variants of a controlled name in the environment are refused (ambiguous);
 *   - several keys in the origin report that differ only by case are refused (ambiguous report);
 *   - an origin other than the string `trusted_launcher`, or none at all, is refused;
 *   - the same name in the repository-controlled settings `env` is refused.
 */
export function checkLauncherControlled(names, origins, settingsEnvNames, contract) {
  const codes = []
  const controlled = new Set(contract.launcher_controlled_environment.map((n) => n.toUpperCase()))
  const fail = (n) => { const c = `ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:${n}`; if (!codes.includes(c)) codes.push(c) }
  const originKeys = isObj(origins) ? Object.keys(origins) : []
  const seenFolded = new Map()
  for (const raw of names) {
    const exact = String(raw)
    const n = exact.toUpperCase()
    if (!controlled.has(n)) continue
    const variants = seenFolded.get(n) ?? new Set(); variants.add(exact); seenFolded.set(n, variants)
    if (variants.size > 1) fail(n) // two spellings of the same controlled variable
    if (originKeys.filter((k) => k.toUpperCase() === n).length > 1) fail(n) // ambiguous origin report
    if (!isObj(origins) || !Object.hasOwn(origins, exact) || origins[exact] !== 'trusted_launcher') fail(n)
  }
  for (const raw of settingsEnvNames ?? []) if (controlled.has(String(raw).toUpperCase())) fail(String(raw).toUpperCase())
  return codes
}

/**
 * The repository-controlled settings `env` block may only set names on a tiny inert list. Anything else (PATH, HOME, XDG_*, SHELL, TMPDIR, proxies,
 * NODE_OPTIONS, credentials) could redirect what the worker executes or where it reads configuration and authentication from.
 */
export function checkSettingsEnv(settingsEnvNames, contract) {
  const codes = []
  const inert = new Set(contract.settings_env_inert_allowlist.map((n) => n.toUpperCase()))
  const controlled = new Set(contract.launcher_controlled_environment.map((n) => n.toUpperCase()))
  for (const raw of settingsEnvNames ?? []) {
    const n = String(raw).toUpperCase()
    if (!inert.has(n) && !controlled.has(n)) codes.push(`ENV.SETTINGS_ENV_NOT_ALLOWED:${n.slice(0, 60)}`)
  }
  return codes
}
