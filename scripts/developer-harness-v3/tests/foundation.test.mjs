// D3.2 — canonical JSON, path normalization and the authority contract itself.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { IDENTITIES, REQUIRED_PROHIBITED, buildPolicyBundle, loadContractFile, loadPolicy, policyRevision, validateContract, validateTrustedKeys } from '../authority/contract.mjs'
import { canonicalize, checkShape, digestOf, v } from '../lib/canonical.mjs'
import { matchesAny, normalizeRepoPath } from '../lib/paths.mjs'
import { buildPolicy, makeKeys } from './helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

test('canonicalize is order-independent and rejects ambiguous values', () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, 'x'] }), canonicalize({ a: [true, null, 'x'], b: 1 }))
  assert.equal(digestOf({ a: 1, b: 2 }), digestOf({ b: 2, a: 1 }))
  for (const bad of [undefined, NaN, Infinity, -0, () => 1, Symbol('x'), 1n, new Date(), new Map(), Object.assign(Object.create({ inherited: 1 }), { a: 1 })]) assert.throws(() => canonicalize({ x: bad }), TypeError)
  const cyc = {}; cyc.self = cyc
  assert.throws(() => canonicalize(cyc), /cycle/)
  assert.throws(() => canonicalize(JSON.parse('{"__proto__":{"admin":true}}')), /__proto__/)
  assert.throws(() => canonicalize([1, , 3]), /sparse/)
})

test('checkShape is strict: missing, invalid and unknown keys are all problems', () => {
  const spec = { required: { id: v.id, n: v.int }, optional: { sha: v.sha40 } }
  assert.deepEqual(checkShape({ id: 'a', n: 1 }, spec), [])
  assert.ok(checkShape({ id: 'a' }, spec).length)
  assert.ok(checkShape({ id: 'a', n: -1 }, spec).length)
  assert.ok(checkShape({ id: 'a', n: 1, extra: 1 }, spec).length)
  assert.ok(checkShape({ id: 'a', n: 1, sha: 'zz' }, spec).length)
  assert.ok(checkShape([], spec).length)
  assert.ok(checkShape(null, spec).length)
})

test('paths: Windows aliasing, traversal and encoding tricks are rejected, not guessed at', () => {
  const rejected = ['', '/etc/passwd', 'C:/x', 'a\\b', '../x', 'a/../b', 'a/./b', 'a//b', 'a/b/', 'supabase/migrations/001_a.sql.', 'supabase/migrations/001_a.sql ',
    'supabase/migrations/001_a.sql::$DATA', 'supabase/MIGRAT~1/x.sql', 'a\u0000b', 'a\nb']
  for (const p of rejected) assert.equal(normalizeRepoPath(p).ok, false, JSON.stringify(p))
  assert.equal(normalizeRepoPath(42).ok, false)
  const ok = normalizeRepoPath('Supabase/Migrations/262_X.sql')
  assert.equal(ok.ok, true)
  assert.equal(ok.key, 'supabase/migrations/262_x.sql')
})

test('paths: glob matching is case-insensitive and ** crosses directories while * does not', () => {
  assert.equal(matchesAny(['.github/**'], '.GitHub/workflows/ci.yml'), true)
  assert.equal(matchesAny(['scripts/*.mjs'], 'scripts/a/b.mjs'), false)
  assert.equal(matchesAny(['scripts/**'], 'scripts/a/b.mjs'), true)
  assert.equal(matchesAny(['**/CLAUDE.md'], 'CLAUDE.md'), true)
  assert.equal(matchesAny(['**/CLAUDE.md'], 'apps/x/claude.md'), true)
  assert.equal(matchesAny(['a.b'], 'axb'), false)
})

test('the shipped contract is structurally valid, contract-only and has no active action', () => {
  const c = loadContractFile()
  assert.deepEqual(validateContract(c), [])
  assert.equal(c.status, 'contract_only_not_active')
  assert.deepEqual(c.activation.active_actions, [])
  assert.equal(c.limits.max_incremental_usd, 0)
  assert.equal(c.limits.max_reasoning_sessions, 1)
  assert.deepEqual(Object.keys(c.identities).sort(), [...IDENTITIES].sort())
  for (const n of REQUIRED_PROHIBITED) assert.equal(c.actions[n].class, 'prohibited', n)
})

test('the contract keeps the implementer powerless and every safeguarded action evidence-gated', () => {
  const c = loadContractFile()
  for (const [n, e] of Object.entries(c.evidence_types)) assert.ok(!e.issuers.includes('implementer'), `${n} must not be issuable by the implementer`)
  for (const [n, a] of Object.entries(c.actions)) {
    if (a.class === 'safeguarded') { assert.ok(a.required_evidence.length > 0, n); assert.equal(a.requires_activation, true, n); assert.ok(!a.identities.includes('implementer'), n) }
    if (a.class === 'prohibited') assert.deepEqual(a.identities, [], n)
  }
  // nothing but the implementer writes code; reviewers and the publisher are different identities
  assert.deepEqual(c.actions.edit_files_in_task_worktree.identities, ['implementer'])
  assert.notDeepEqual(c.evidence_types.independent_review.issuers, c.evidence_types.security_review.issuers)
})

test('V3 protected paths are a superset of the V2 protected paths (nothing silently dropped)', () => {
  const v2 = JSON.parse(readFileSync(path.join(ROOT, 'docs/developer-harness-v2/contract.json'), 'utf8')).protected_paths
  const v3 = loadContractFile().protected_paths
  for (const p of v2) assert.ok(v3.includes(p) || matchesAny(v3, p), `V3 dropped V2 protected path ${p}`)
})

test('validateContract rejects every structural downgrade', () => {
  const mutations = {
    'downgraded prohibited action': (c) => { c.actions.self_approve_candidate = { class: 'allowed', identities: ['implementer'], checks: [] } },
    'removed prohibited action': (c) => { delete c.actions.push_to_main_directly },
    'prohibited with identity': (c) => { c.actions.push_to_main_directly.identities = ['merger'] },
    'safeguarded without evidence': (c) => { c.actions.merge_pull_request.required_evidence = [] },
    'safeguarded wildcard identity': (c) => { c.actions.merge_pull_request.identities = ['*'] },
    'unknown evidence reference': (c) => { c.actions.merge_pull_request.required_evidence = ['vibes'] },
    'implementer may issue evidence': (c) => { c.evidence_types.independent_review.issuers = ['implementer'] },
    'unknown identity': (c) => { c.actions.merge_pull_request.identities = ['root'] },
    'unknown check': (c) => { c.actions.merge_pull_request.checks.push('trust_me') },
    'evidence not bound to policy': (c) => { c.evidence_types.ci_gate.binds = ['repository'] },
    'ttl beyond a week': (c) => { c.evidence_types.ci_gate.max_ttl_seconds = 10_000_000 },
    'extra identity': (c) => { c.identities.superuser = 'x' },
    'activation of a non-safeguarded action': (c) => { c.activation.active_actions = ['read_repository'] },
    'wrong schema': (c) => { c.schema = 'other' },
    'unknown action key': (c) => { c.actions.merge_pull_request.bypass = true },
  }
  for (const [name, mutate] of Object.entries(mutations)) {
    const c = structuredClone(loadContractFile()); mutate(c)
    assert.notDeepEqual(validateContract(c), [], name)
  }
  assert.notDeepEqual(validateContract(null), [])
  assert.notDeepEqual(validateContract([]), [])
})

test('trusted keys: implementer keys, bad algorithms and garbage keys are refused', () => {
  const c = loadContractFile()
  const k = makeKeys(['orchestrator']).trusted_keys['k-orchestrator']
  assert.deepEqual(validateTrustedKeys({ 'k-1': k }, c), [])
  assert.notDeepEqual(validateTrustedKeys({ 'k-1': { ...k, identity: 'implementer' } }, c), [])
  assert.notDeepEqual(validateTrustedKeys({ 'k-1': { ...k, public_key: 'AAAA' } }, c), [])
  assert.notDeepEqual(validateTrustedKeys({ 'k-1': { ...k, alg: 'rsa' } }, c), [])
  assert.notDeepEqual(validateTrustedKeys({ 'k-1': { ...k, not_after: k.not_before } }, c), [])
  assert.notDeepEqual(validateTrustedKeys({ 'k-1': { ...k, identity: 'notifier' } }, c), [], 'notifier issues no evidence type')
})

test('loadPolicy: only a bundle whose recomputed revision equals the out-of-band pin is accepted', () => {
  const { bundle, revision } = buildPolicy()
  assert.equal(loadPolicy(bundle, revision).ok, true)
  assert.equal(loadPolicy(bundle, 'a'.repeat(64)).ok, false)
  assert.equal(loadPolicy(bundle, undefined).ok, false)
  assert.equal(loadPolicy(bundle, 'nope').ok, false)
  const tampered = structuredClone(bundle); tampered.contract.limits.max_incremental_usd = 100
  assert.deepEqual(loadPolicy(tampered, revision).problems, ['POLICY.REVISION_MISMATCH'])
  const keyAdded = structuredClone(bundle); Object.assign(keyAdded.trusted_keys, { 'k-evil': makeKeys(['orchestrator']).trusted_keys['k-orchestrator'] })
  assert.deepEqual(loadPolicy(keyAdded, revision).problems, ['POLICY.REVISION_MISMATCH'])
  assert.equal(loadPolicy(null, revision).ok, false)
  assert.equal(loadPolicy({ ...bundle, extra: 1 }, revision).ok, false)
  // the revision is content-addressed: identical content, identical revision
  assert.equal(policyRevision(buildPolicyBundle({ contract: bundle.contract, trusted_keys: bundle.trusted_keys })), revision)
  assert.ok(Object.isFrozen(loadPolicy(bundle, revision).policy.contract))
})

test('the shipped bundle (no issuer keys deployed) loads, and so authenticates nothing', () => {
  const bundle = buildPolicyBundle({ contract: loadContractFile() })
  const loaded = loadPolicy(bundle, policyRevision(bundle))
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.policy.trusted_keys, {})
})
