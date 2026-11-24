// Developer Harness V3 (D3.2) — authority contract loading, structural validation and policy bundles.
//
// A POLICY BUNDLE is {contract, trusted_keys, parent_revision}. Its REVISION is the sha256 of its canonical form. A revision is
// only meaningful when the caller obtained the PINNED revision from outside the candidate's writable environment
// (see 04-policy-bootstrap-and-promotion.md). loadPolicy() refuses a bundle whose recomputed revision differs from the pin, and
// the candidate can never supply the pin.
import { createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkShape, digestOf, isPlainObject, v } from '../lib/canonical.mjs'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CONTRACT_PATH = path.resolve(HERE, '../../../docs/developer-harness-v3/authority-contract.json')

export const IDENTITIES = Object.freeze(['task_ingress', 'orchestrator', 'implementer', 'independent_reviewer', 'security_reviewer', 'trusted_publisher',
  'delivery_verifier', 'merger', 'production_releaser', 'recovery', 'notifier', 'policy_promoter'])
export const CLASSES = Object.freeze(['allowed', 'safeguarded', 'prohibited'])
export const CHECKS = Object.freeze(['path_validity', 'scope', 'resource_ownership', 'evidence_validity', 'spend', 'launch_environment', 'environment_isolation',
  'candidate_binding', 'protected_paths', 'migrations', 'customer_agent', 'control_plane_self_change', 'credentials_env', 'credential_scope', 'promotion'])
export const BINDINGS = Object.freeze(['repository', 'base_sha', 'candidate_sha', 'tree_digest', 'policy_revision', 'environment_id', 'subject_policy_revision', 'authority_digest'])
/** Actions that MUST stay prohibited in every contract version; a contract that downgrades one is invalid, not merely "weaker". */
export const REQUIRED_PROHIBITED = Object.freeze(['push_to_main_directly', 'force_push_protected_branch', 'modify_historical_migration', 'supabase_migration_repair',
  'apply_unreviewed_migration_remotely', 'expose_credentials_to_candidate_environment', 'activate_customer_agent_execution', 'grant_customer_agent_autonomy',
  'enable_customer_agent_billing', 'use_paid_model_authentication', 'purchase_usage_or_upgrade_subscription', 'increase_own_spend_authority', 'self_approve_candidate',
  'select_own_policy_revision', 'modify_active_enforcement_from_candidate', 'weaken_required_gates', 'bypass_hooks_or_gates', 'use_unofficial_claude_authentication',
  'modify_claude_binary', 'enable_host_bypass_permissions', 'delete_task_evidence', 'terminate_unowned_processes'])

export function loadContractFile(file = CONTRACT_PATH) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** @returns {string[]} problems (empty = structurally valid) */
export function validateContract(c) {
  const p = []
  if (!isPlainObject(c)) return ['contract: not a plain object']
  if (c.schema !== 'patelrep.developer-harness-v3.authority-contract' || c.version !== 1) p.push('contract: wrong schema or version')
  if (!v.id(c.contract_id)) p.push('contract.contract_id: invalid')
  if (!isPlainObject(c.classes) || CLASSES.some((k) => !(k in c.classes)) || Object.keys(c.classes).length !== CLASSES.length) p.push('contract.classes: must be exactly allowed/safeguarded/prohibited')
  if (!isPlainObject(c.identities) || Object.keys(c.identities).sort().join() !== [...IDENTITIES].sort().join()) p.push('contract.identities: must be exactly the twelve defined identities')
  if (!isPlainObject(c.actions) || Object.keys(c.actions).length === 0) { p.push('contract.actions: missing'); return p }
  if (!isPlainObject(c.evidence_types)) { p.push('contract.evidence_types: missing'); return p }

  for (const [name, a] of Object.entries(c.actions)) {
    if (!/^[a-z][a-z0-9_]{2,80}$/.test(name)) { p.push(`action ${name}: invalid name`); continue }
    p.push(...checkShape(a, { required: { class: v.oneOf(...CLASSES), identities: v.arrayOf(v.str, 20) },
      optional: { checks: v.arrayOf(v.oneOf(...CHECKS), 20), required_evidence: v.arrayOf(v.str, 20), requires_activation: v.bool } }, `action ${name}`))
    if (!isPlainObject(a) || !CLASSES.includes(a.class)) continue
    if (a.class !== 'prohibited' && !Array.isArray(a.checks)) p.push(`action ${name}: checks must be listed (use [] for none)`)
    const ids = Array.isArray(a.identities) ? a.identities : []
    if (ids.some((i) => i !== '*' && !IDENTITIES.includes(i))) p.push(`action ${name}: unknown identity`)
    if (a.class === 'prohibited' && (ids.length || a.required_evidence?.length)) p.push(`action ${name}: prohibited actions grant no identity and take no evidence`)
    if (a.class === 'safeguarded') {
      if (!a.required_evidence?.length) p.push(`action ${name}: safeguarded actions must require evidence`)
      if (ids.includes('*') || !ids.length) p.push(`action ${name}: safeguarded actions need explicit identities`)
      if (a.requires_activation !== true) p.push(`action ${name}: safeguarded actions must declare requires_activation`)
    }
    if (a.class === 'allowed' && a.required_evidence?.length) p.push(`action ${name}: allowed actions take no evidence`)
    for (const e of a.required_evidence ?? []) if (!(e in c.evidence_types)) p.push(`action ${name}: unknown evidence type ${e}`)
  }
  for (const n of REQUIRED_PROHIBITED) if (c.actions[n]?.class !== 'prohibited') p.push(`action ${n}: must be prohibited`)

  for (const [name, e] of Object.entries(c.evidence_types)) {
    p.push(...checkShape(e, { required: { issuers: v.arrayOf(v.str, 5), binds: v.arrayOf(v.oneOf(...BINDINGS), 10), max_ttl_seconds: (x) => Number.isSafeInteger(x) && x > 0 && x <= 604800, single_use: v.bool },
      optional: { independent_of_author: v.bool } }, `evidence ${name}`))
    for (const i of e?.issuers ?? []) {
      if (!IDENTITIES.includes(i)) p.push(`evidence ${name}: unknown issuer ${i}`)
      if (i === 'implementer') p.push(`evidence ${name}: the implementer may never issue evidence`)
    }
    if (!e?.issuers?.length) p.push(`evidence ${name}: needs an issuer`)
    if (!e?.binds?.includes('repository') || !e?.binds?.includes('policy_revision')) p.push(`evidence ${name}: must bind repository and policy_revision`)
  }
  for (const k of ['protected_paths', 'root_of_trust_paths', 'forbidden_auth_environment', 'forbidden_auth_settings', 'credential_environment_patterns']) {
    if (!v.arrayOf(v.str, 500)(c[k]) || !c[k].length) p.push(`contract.${k}: must be a non-empty string list`)
  }
  p.push(...checkShape(c.limits, { required: { max_incremental_usd: v.int, max_reasoning_sessions: v.int, evidence_clock_skew_seconds: v.int, max_changed_paths: v.int } }, 'contract.limits'))
  if (!isPlainObject(c.migrations) || typeof c.migrations.file_pattern !== 'string') p.push('contract.migrations: invalid')
  else { try { new RegExp(c.migrations.file_pattern) } catch { p.push('contract.migrations.file_pattern: not a regular expression') } }
  if (!isPlainObject(c.activation) || !Array.isArray(c.activation.active_actions)) p.push('contract.activation: invalid')
  else for (const a of c.activation.active_actions) if (c.actions[a]?.class !== 'safeguarded') p.push(`contract.activation: ${a} is not a safeguarded action`)
  if (!isPlainObject(c.credential_scopes)) p.push('contract.credential_scopes: invalid')
  else {
    for (const [scope, d] of Object.entries(c.credential_scopes)) {
      p.push(...checkShape(d, { required: { identities: v.arrayOf(v.oneOf(...IDENTITIES), 12), required_evidence: v.arrayOf(v.str, 10) } }, `credential_scope ${scope}`))
      if (isPlainObject(d) && !d.identities?.length) p.push(`credential_scope ${scope}: needs identities`)
      if (isPlainObject(d) && d.identities?.includes('implementer')) p.push(`credential_scope ${scope}: the implementer may never hold a credential scope`)
      for (const e of d?.required_evidence ?? []) if (!(e in c.evidence_types)) p.push(`credential_scope ${scope}: unknown evidence ${e}`)
    }
  }
  return p
}

/** trusted_keys: { key_id: {identity, alg, public_key (base64 SPKI DER), not_before, not_after} } */
export function validateTrustedKeys(keys, contract) {
  const p = []
  if (!isPlainObject(keys)) return ['trusted_keys: not a plain object']
  for (const [id, k] of Object.entries(keys)) {
    if (!v.id(id)) { p.push(`key ${id}: invalid id`); continue }
    p.push(...checkShape(k, { required: { identity: v.oneOf(...IDENTITIES), alg: v.oneOf('ed25519'), public_key: v.str, not_before: v.iso, not_after: v.iso } }, `key ${id}`))
    if (!isPlainObject(k)) continue
    if (k.identity === 'implementer') p.push(`key ${id}: the implementer may not hold an evidence-issuing key`)
    if (Date.parse(k.not_after) <= Date.parse(k.not_before)) p.push(`key ${id}: empty validity window`)
    if (!Object.values(contract.evidence_types).some((e) => e.issuers.includes(k.identity))) p.push(`key ${id}: identity ${k.identity} issues no evidence type`)
    try {
      const pub = createPublicKey({ key: Buffer.from(k.public_key, 'base64'), format: 'der', type: 'spki' })
      if (pub.asymmetricKeyType !== 'ed25519') p.push(`key ${id}: not an Ed25519 key`)
    } catch { p.push(`key ${id}: public key unparseable`) }
  }
  return p
}

export const buildPolicyBundle = ({ contract, trusted_keys = {}, parent_revision = null }) => ({ contract, trusted_keys, parent_revision })
export const policyRevision = (bundle) => digestOf({ contract: bundle.contract, trusted_keys: bundle.trusted_keys, parent_revision: bundle.parent_revision })

/** Policies that came out of loadPolicy() with a matching pin. The evaluator refuses any other object, however well-formed. */
const LOADED = new WeakSet()
export const isLoadedPolicy = (p) => typeof p === 'object' && p !== null && LOADED.has(p)

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const x of Object.values(o)) deepFreeze(x) }
  return o
}

/**
 * Accept a bundle only if it is structurally valid AND its recomputed revision equals the revision the caller pinned out-of-band.
 * @returns {{ok:true, policy:object}|{ok:false, problems:string[]}}
 */
export function loadPolicy(bundle, pinnedRevision) {
  try {
    if (!v.sha64(pinnedRevision)) return { ok: false, problems: ['POLICY.PIN_MISSING_OR_INVALID'] }
    const shape = checkShape(bundle, { required: { contract: isPlainObject, trusted_keys: isPlainObject, parent_revision: (x) => x === null || v.sha64(x) } }, 'bundle')
    if (shape.length) return { ok: false, problems: ['POLICY.MALFORMED', ...shape] }
    const problems = [...validateContract(bundle.contract), ...validateTrustedKeys(bundle.trusted_keys, bundle.contract)]
    if (problems.length) return { ok: false, problems: ['POLICY.INVALID', ...problems] }
    const revision = policyRevision(bundle)
    if (revision !== pinnedRevision) return { ok: false, problems: ['POLICY.REVISION_MISMATCH'] }
    const policy = deepFreeze({ revision, contract: structuredClone(bundle.contract), trusted_keys: structuredClone(bundle.trusted_keys), parent_revision: bundle.parent_revision })
    LOADED.add(policy)
    return { ok: true, policy }
  } catch { return { ok: false, problems: ['POLICY.LOAD_ERROR'] } }
}
