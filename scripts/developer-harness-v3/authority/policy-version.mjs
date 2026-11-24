// Developer Harness V3 (D3.2) — policy successor comparison and promotion rules.
//
// The ACTIVE policy governs validation of its proposed successor. A proposal can never be judged by its own rules: every check below
// reads `active`, and the proposal contributes only data that is compared against it.
//
//   weakening     -> automated promotion is impossible (owner ceremony only)
//   root_of_trust -> automated promotion is impossible (owner ceremony only): keys, identities, issuers, activation, financial authority,
//                    root-of-trust paths. These cannot authorize themselves.
//   strengthening / neutral only -> promotable, but only with the active policy's own promote_policy evidence.
import { digestOf } from '../lib/canonical.mjs'
import { validateContract, validateTrustedKeys, policyRevision } from './contract.mjs'

const RANK = { allowed: 0, safeguarded: 1, prohibited: 2 }
const IGNORED_TOP_LEVEL = new Set(['$comment', 'baseline', 'phase', 'status', 'classes', 'preserved_v2'])
const HANDLED_TOP_LEVEL = new Set(['worker_environment_allowlist', 'actions', 'evidence_types', 'identities', 'protected_paths', 'root_of_trust_paths', 'limits', 'forbidden_auth_environment', 'forbidden_auth_settings',
  'credential_environment_patterns', 'credential_scopes', 'migrations', 'customer_agent', 'activation', 'contract_id', 'schema', 'version'])

const asSet = (x) => new Set(x ?? [])
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined)
const removed = (a, b) => [...asSet(a)].filter((x) => !asSet(b).has(x))
const added = (a, b) => [...asSet(b)].filter((x) => !asSet(a).has(x))
const covers = (idsA, idsB) => asSet(idsA).has('*') || [...asSet(idsB)].every((i) => asSet(idsA).has(i))

/** @returns {{changes:{severity:string, code:string, ref:string}[], rootOfTrust:boolean, weakening:boolean}} */
export function diffPolicy(active, proposed) {
  const A = active.contract; const B = proposed.contract
  const changes = []
  const add = (severity, code, ref) => changes.push({ severity, code, ref })

  if (digestOf(active.trusted_keys) !== digestOf(proposed.trusted_keys)) add('root_of_trust', 'TRUSTED_KEYS_CHANGED', 'trusted_keys')
  for (const k of ['contract_id', 'schema', 'version']) if (A[k] !== B[k]) add('root_of_trust', 'CONTRACT_IDENTITY_CHANGED', k)
  if (Object.keys(A.identities).sort().join() !== Object.keys(B.identities).sort().join()) add('root_of_trust', 'IDENTITY_REGISTRY_CHANGED', 'identities')

  for (const name of new Set([...Object.keys(A.actions), ...Object.keys(B.actions)])) {
    const a = own(A.actions, name); const b = own(B.actions, name)
    if (!a) { add(b.class === 'allowed' ? 'weakening' : 'strengthening', 'ACTION_ADDED', name); continue }
    if (!b) { add(a.class === 'prohibited' ? 'weakening' : 'strengthening', 'ACTION_REMOVED', name); continue }
    if (RANK[b.class] < RANK[a.class]) add('weakening', 'ACTION_CLASS_DOWNGRADED', name)
    else if (RANK[b.class] > RANK[a.class]) add('strengthening', 'ACTION_CLASS_UPGRADED', name)
    if (!covers(a.identities, b.identities)) add('weakening', 'ACTION_IDENTITIES_BROADENED', name)
    else if (!covers(b.identities, a.identities)) add('strengthening', 'ACTION_IDENTITIES_NARROWED', name)
    if (removed(a.required_evidence, b.required_evidence).length) add('weakening', 'ACTION_EVIDENCE_REMOVED', name)
    if (added(a.required_evidence, b.required_evidence).length) add('strengthening', 'ACTION_EVIDENCE_ADDED', name)
    if (removed(a.checks, b.checks).length) add('weakening', 'ACTION_CHECK_REMOVED', name)
    if (added(a.checks, b.checks).length) add('strengthening', 'ACTION_CHECK_ADDED', name)
    if (a.requires_activation === true && b.requires_activation !== true) add('weakening', 'ACTIVATION_REQUIREMENT_REMOVED', name)
  }
  for (const name of new Set([...Object.keys(A.evidence_types), ...Object.keys(B.evidence_types)])) {
    const a = own(A.evidence_types, name); const b = own(B.evidence_types, name)
    if (!a || !b) { add(!a ? 'root_of_trust' : 'weakening', !a ? 'EVIDENCE_TYPE_ADDED' : 'EVIDENCE_TYPE_REMOVED', name); continue }
    if (digestOf([...a.issuers].sort()) !== digestOf([...b.issuers].sort())) add('root_of_trust', 'EVIDENCE_ISSUERS_CHANGED', name)
    if (removed(a.binds, b.binds).length) add('weakening', 'EVIDENCE_BINDING_REMOVED', name)
    if (added(a.binds, b.binds).length) add('strengthening', 'EVIDENCE_BINDING_ADDED', name)
    if (b.max_ttl_seconds > a.max_ttl_seconds) add('weakening', 'EVIDENCE_TTL_INCREASED', name)
    else if (b.max_ttl_seconds < a.max_ttl_seconds) add('strengthening', 'EVIDENCE_TTL_REDUCED', name)
    if (a.single_use && !b.single_use) add('weakening', 'EVIDENCE_SINGLE_USE_REMOVED', name)
    if (a.independent_of_author && !b.independent_of_author) add('weakening', 'EVIDENCE_INDEPENDENCE_REMOVED', name)
    if (a.approval && !b.approval) add('weakening', 'EVIDENCE_APPROVAL_FLAG_REMOVED', name)
  }
  for (const [k, sev] of [['protected_paths', 'weakening'], ['forbidden_auth_environment', 'weakening'], ['forbidden_auth_settings', 'weakening'], ['credential_environment_patterns', 'weakening']]) {
    if (removed(A[k], B[k]).length) add(sev, 'LIST_ENTRY_REMOVED', k)
    if (added(A[k], B[k]).length) add('strengthening', 'LIST_ENTRY_ADDED', k)
  }
  if (added(A.worker_environment_allowlist, B.worker_environment_allowlist).length) add('weakening', 'WORKER_ENV_ALLOWLIST_WIDENED', 'worker_environment_allowlist')
  if (removed(A.worker_environment_allowlist, B.worker_environment_allowlist).length) add('strengthening', 'WORKER_ENV_ALLOWLIST_NARROWED', 'worker_environment_allowlist')
  if (digestOf([...A.root_of_trust_paths].sort()) !== digestOf([...B.root_of_trust_paths].sort())) add('root_of_trust', 'ROOT_OF_TRUST_PATHS_CHANGED', 'root_of_trust_paths')
  if (A.limits.max_incremental_usd !== B.limits.max_incremental_usd) add('root_of_trust', 'FINANCIAL_AUTHORITY_CHANGED', 'limits.max_incremental_usd')
  for (const k of ['max_reasoning_sessions', 'evidence_clock_skew_seconds', 'max_changed_paths']) {
    if (B.limits[k] > A.limits[k]) add('weakening', 'LIMIT_RAISED', `limits.${k}`)
    else if (B.limits[k] < A.limits[k]) add('strengthening', 'LIMIT_LOWERED', `limits.${k}`)
  }
  if (digestOf(A.credential_scopes) !== digestOf(B.credential_scopes)) add('root_of_trust', 'CREDENTIAL_SCOPES_CHANGED', 'credential_scopes')
  if (digestOf(A.activation) !== digestOf(B.activation)) add('root_of_trust', 'ACTIVATION_CHANGED', 'activation')
  if (digestOf(A.migrations) !== digestOf(B.migrations)) add('weakening', 'MIGRATION_RULES_CHANGED', 'migrations')
  if (digestOf(A.customer_agent) !== digestOf(B.customer_agent)) add('weakening', 'CUSTOMER_AGENT_RULES_CHANGED', 'customer_agent')
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (IGNORED_TOP_LEVEL.has(k) || HANDLED_TOP_LEVEL.has(k)) continue
    if (digestOf(A[k] ?? null) !== digestOf(B[k] ?? null)) add('weakening', 'UNCLASSIFIED_CHANGE', k)
  }
  return { changes, rootOfTrust: changes.some((c) => c.severity === 'root_of_trust'), weakening: changes.some((c) => c.severity === 'weakening') }
}

/**
 * Reason codes for the `promotion` check of promote_policy. Evaluated under `active` only. The proposed revision is RECOMPUTED here;
 * a revision claimed by the proposer is never read.
 * @returns {{codes:string[], proposedRevision:string|null, diff:object|null}}
 */
export function promotionCheck(active, proposedIn) {
  const codes = []
  let proposedRevision = null
  let diff = null
  try {
    const proposedBundle = structuredClone(proposedIn) // read once; every later check sees the same snapshot
    const problems = [...validateContract(proposedBundle?.contract), ...validateTrustedKeys(proposedBundle?.trusted_keys ?? {}, proposedBundle?.contract ?? {})]
    if (problems.length) return { codes: ['PROMOTION.PROPOSAL_INVALID'], proposedRevision, diff }
    proposedRevision = policyRevision(proposedBundle)
    if (proposedBundle.parent_revision !== active.revision) codes.push('PROMOTION.PARENT_REVISION_MISMATCH')
    diff = diffPolicy(active, proposedBundle)
    if (diff.changes.length === 0) codes.push('PROMOTION.NO_CHANGE')
    if (diff.rootOfTrust) codes.push('PROMOTION.ROOT_OF_TRUST_REQUIRES_OWNER_CEREMONY')
    if (diff.weakening) codes.push('PROMOTION.WEAKENING_REQUIRES_OWNER_CEREMONY')
  } catch { codes.push('PROMOTION.CHECK_ERROR') }
  return { codes, proposedRevision, diff }
}
