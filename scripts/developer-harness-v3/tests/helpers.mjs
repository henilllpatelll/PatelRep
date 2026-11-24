// Developer Harness V3 (D3.2) — test-only fixtures. Everything here is disposable and in-memory. The SIGNING helpers exist ONLY in the
// test tree: production code in authority/ can verify evidence but has no way to issue it (issuer services are D3.3 work).
import { generateKeyPairSync, sign } from 'node:crypto'
import { IDENTITIES, buildPolicyBundle, loadContractFile, loadPolicy, policyRevision } from '../authority/contract.mjs'
import { digestOf } from '../lib/canonical.mjs'
import { signingMessage } from '../authority/evidence.mjs'

export const NOW = Date.parse('2026-11-25T12:00:00Z')
export const REPO = 'henilllpatelll/PatelRep'
export const BASE = 'fbbc50b22f0ca27367032822f5d6dafc361ea323'
export const HEAD = 'c'.repeat(40)
export const TREE = 'd'.repeat(40)
export const PATCH = 'e'.repeat(64)
export const ENV_ID = 'vm-isolated-1'
export const iso = (ms) => new Date(ms).toISOString()

const ISSUING = [...new Set(Object.values(loadContractFile().evidence_types).flatMap((e) => e.issuers))]
export function makeKeys(identities = ISSUING) {
  const privateKeys = {}; const trusted_keys = {}
  for (const identity of identities) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const key_id = `k-${identity}`
    privateKeys[key_id] = privateKey
    trusted_keys[key_id] = { identity, alg: 'ed25519', public_key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), not_before: '2026-01-01T00:00:00Z', not_after: '2027-12-31T00:00:00Z' }
  }
  return { privateKeys, trusted_keys }
}

export function buildPolicy({ activate = [], keys = makeKeys(), mutate = null, parent = null } = {}) {
  const contract = structuredClone(loadContractFile())
  contract.activation = { ...contract.activation, active_actions: activate }
  if (mutate) mutate(contract)
  const bundle = buildPolicyBundle({ contract, trusted_keys: keys.trusted_keys, parent_revision: parent })
  const revision = policyRevision(bundle)
  const loaded = loadPolicy(bundle, revision)
  if (!loaded.ok) throw new Error(`test policy invalid: ${loaded.problems.join(', ')}`)
  return { policy: loaded.policy, bundle, revision, keys }
}

export const CANDIDATE = Object.freeze({
  source: 'git', repository: REPO, base_sha: BASE, candidate_sha: HEAD, tree_digest: TREE, patch_digest: PATCH,
  changes: [{ status: 'M', path: 'apps/mobile/app/home.tsx' }],
  base_migrations: ['supabase/migrations/001_init.sql', 'supabase/migrations/261_agent_worker_tenant_binding.sql', 'supabase/migrations/262_agent_verified_human_identity.sql'],
  added_lines: {}, special_modes: [], origin_matches: true, problems: [],
})
export const candidate = (over = {}) => ({ ...structuredClone(CANDIDATE), ...over })

export const ISOLATED_ENV = Object.freeze({ id: ENV_ID, kind: 'isolated_vm', worker_env_names: ['PATH', 'HOME'], egress_restricted: true, host_mounts: false,
  docker_socket_exposed: false, windows_interop: false, controller_reachable: false, other_credentials_present: false })

export const AUTHORITY = Object.freeze({ repository: REPO, base_sha: BASE, allowed_paths: Object.freeze(['apps/mobile/**', 'supabase/migrations/**']), denied_paths: Object.freeze([]) })
export const authorityDigest = (a = AUTHORITY) => digestOf(a)

export function trustedFor(identity, over = {}) {
  return { identity, task: { task_id: 'task-1', fencing_token: 7, state_revision: 3, author_context_id: 'ctx-author',
    authority: structuredClone(AUTHORITY) },
  environment: structuredClone(ISOLATED_ENV), candidate: candidate(), target_tip_sha: BASE,
  resources: { 'res-own-stale': { owner_task_id: 'task-1', kind: 'container', lifecycle: 'stale' }, 'res-other': { owner_task_id: 'task-2', kind: 'container', lifecycle: 'stale' },
    'res-own-running': { owner_task_id: 'task-1', kind: 'process', lifecycle: 'running' }, 'res-own-migration': { owner_task_id: 'task-1', kind: 'migration', lifecycle: 'idle' } },
  ...over }
}

const ISSUER = { task_authority: 'task_ingress', test_results: 'orchestrator', independent_review: 'independent_reviewer', security_review: 'security_reviewer',
  publication_receipt: 'trusted_publisher', ci_gate: 'delivery_verifier', staging_gate: 'delivery_verifier', delivery_verification: 'delivery_verifier', merge_receipt: 'merger',
  production_verification: 'delivery_verifier', isolation_attestation: 'delivery_verifier', policy_promotion_approval: 'delivery_verifier' }
let counter = 0

/** A VALID signed envelope for `type` under `policy`, bound to the default fixtures; `over` patches the payload (it is signed AFTER patching). */
export function evidence(type, { policy, keys, over = {}, keyId = null, signWith = null } = {}) {
  counter += 1
  const issuer = over.issuer_identity ?? ISSUER[type]
  const payload = { evidence_id: `ev-${type}-${counter}`, evidence_type: type, issuer_identity: issuer, task_id: 'task-1', repository: REPO, policy_revision: policy.revision,
    issued_at: iso(NOW - 60_000), expires_at: iso(NOW + 3_000_000), nonce: `n-${type}-${counter}`, idempotency_id: `i-${type}-${counter}`, fencing_token: 7, verdict: 'pass',
    base_sha: BASE, candidate_sha: HEAD, tree_digest: TREE, patch_digest: PATCH, environment_id: ENV_ID, authority_digest: authorityDigest(), context_id: `ctx-${type}`, ...over }
  const key_id = keyId ?? `k-${ISSUER[type] ?? issuer}`
  const priv = signWith ?? keys.privateKeys[key_id]
  const value = sign(null, signingMessage(payload), priv).toString('base64')
  return { schema: 'patelrep.developer-harness-v3.evidence', version: 1, payload, signature: { alg: 'ed25519', key_id, value } }
}

export const request = (action, over = {}) => ({ action, task_id: 'task-1', ...over })
