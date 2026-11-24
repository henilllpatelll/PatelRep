// D3.2 — policy bootstrap and promotion: the ACTIVE policy governs its successor; weakening and root-of-trust changes cannot self-authorize.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPolicyBundle, loadContractFile, policyRevision } from '../authority/contract.mjs'
import { EvidenceLedger } from '../authority/evidence.mjs'
import { evaluate } from '../authority/evaluator.mjs'
import { diffPolicy, promotionCheck } from '../authority/policy-version.mjs'
import { NOW, buildPolicy, evidence, makeKeys, request, trustedFor } from './helpers.mjs'

const KEYS = makeKeys()
const ACTIVE = buildPolicy({ keys: KEYS, activate: ['promote_policy', 'merge_pull_request', 'publish_candidate_branch'] })

/** A proposed successor: the active contract mutated, chained to the active revision, same trusted keys unless told otherwise. */
function propose(mutate, { keys = KEYS, parent = ACTIVE.revision } = {}) {
  const contract = structuredClone(ACTIVE.bundle.contract); mutate(contract)
  const bundle = buildPolicyBundle({ contract, trusted_keys: keys.trusted_keys, parent_revision: parent })
  return { bundle, revision: policyRevision(bundle) }
}
const kinds = (mutate, opts) => diffPolicy(ACTIVE.policy, propose(mutate, opts).bundle).changes.map((c) => `${c.severity}:${c.code}`)

test('diff classification: every weakening is recognized as weakening', () => {
  const weakening = {
    'downgrade prohibited action': (c) => { c.actions.self_approve_candidate = { class: 'safeguarded', identities: ['merger'], required_evidence: ['ci_gate'], checks: [], requires_activation: true } },
    'remove a prohibition': (c) => { delete c.actions.delete_task_evidence },
    'new allowed action': (c) => { c.actions.run_anything = { class: 'allowed', identities: ['implementer'], checks: [] } },
    'broaden identities': (c) => { c.actions.merge_pull_request.identities.push('implementer') },
    'wildcard identity': (c) => { c.actions.merge_pull_request.identities = ['*'] },
    'remove required evidence': (c) => { c.actions.merge_pull_request.required_evidence = c.actions.merge_pull_request.required_evidence.filter((e) => e !== 'independent_review') },
    'remove a check': (c) => { c.actions.publish_candidate_branch.checks = c.actions.publish_candidate_branch.checks.filter((k) => k !== 'migrations') },
    'drop activation requirement': (c) => { c.actions.merge_pull_request.requires_activation = false },
    'longer evidence ttl': (c) => { c.evidence_types.ci_gate.max_ttl_seconds = 604800 },
    'evidence reusable': (c) => { c.evidence_types.delivery_verification.single_use = false },
    'drop independence': (c) => { c.evidence_types.independent_review.independent_of_author = false },
    'drop a binding': (c) => { c.evidence_types.ci_gate.binds = ['repository', 'policy_revision'] },
    'shrink protected paths': (c) => { c.protected_paths = c.protected_paths.filter((p) => p !== '.github/**') },
    'allow an auth variable': (c) => { c.forbidden_auth_environment = c.forbidden_auth_environment.filter((n) => n !== 'ANTHROPIC_API_KEY') },
    'allow a credential pattern': (c) => { c.credential_environment_patterns = c.credential_environment_patterns.filter((n) => n !== '*SERVICE_ROLE*') },
    'widen the worker env allowlist': (c) => { c.worker_environment_allowlist.push('MY_SECRET_NAME') },
    'approval flag dropped': (c) => { c.evidence_types.independent_review.approval = false },
    'raise concurrency': (c) => { c.limits.max_reasoning_sessions = 4 },
    'looser migration rules': (c) => { c.migrations.file_pattern = '.*' },
    'weaker customer-agent tripwire': (c) => { c.customer_agent.tripwire = 'nothing' },
    'unclassified new top-level setting': (c) => { c.new_setting = true },
  }
  for (const [name, mutate] of Object.entries(weakening)) assert.ok(kinds(mutate).some((k) => k.startsWith('weakening:')), name)
})

test('diff classification: trust-root changes are root_of_trust, never merely weakening', () => {
  const roots = {
    'add a trusted key': (_c) => {},
    'change root-of-trust paths': (c) => { c.root_of_trust_paths = c.root_of_trust_paths.slice(1) },
    'change financial authority': (c) => { c.limits.max_incremental_usd = 50 },
    'change evidence issuers': (c) => { c.evidence_types.ci_gate.issuers = ['merger'] },
    'activate an action': (c) => { c.activation.active_actions.push('production_release') },
    'change credential scopes': (c) => { c.credential_scopes.production.identities.push('merger') },
    'rename the contract': (c) => { c.contract_id = 'other' },
  }
  const extraKey = { ...KEYS, trusted_keys: { ...KEYS.trusted_keys, ...makeKeys(['orchestrator']).trusted_keys } }
  for (const [name, mutate] of Object.entries(roots)) {
    const opts = name === 'add a trusted key' ? { keys: extraKey } : undefined
    assert.ok(kinds(mutate, opts).some((k) => k.startsWith('root_of_trust:')), name)
  }
})

test('diff classification: pure strengthening is neutral for promotion, and an identical proposal is rejected as no change', () => {
  const strengthen = (c) => {
    c.actions.merge_pull_request.required_evidence.push('security_review')
    c.evidence_types.ci_gate.max_ttl_seconds = 600
    c.protected_paths.push('docs/new-protected/**')
  }
  const d = diffPolicy(ACTIVE.policy, propose(strengthen).bundle)
  assert.equal(d.weakening, false); assert.equal(d.rootOfTrust, false)
  assert.ok(d.changes.length >= 3 && d.changes.every((c) => c.severity === 'strengthening'))
  assert.deepEqual(promotionCheck(ACTIVE.policy, propose(strengthen).bundle).codes, [])
  assert.deepEqual(promotionCheck(ACTIVE.policy, propose(() => {}).bundle).codes, ['PROMOTION.NO_CHANGE'])
})

const promoTrusted = (proposed) => trustedFor('policy_promoter', { proposed_policy: proposed.bundle, proposed_policy_source_tree: trustedFor('x').candidate.tree_digest })
const promoEvidence = (proposed, over = {}) => [
  evidence('independent_review', { policy: ACTIVE.policy, keys: KEYS, over: { subject_policy_revision: proposed.revision } }), evidence('security_review', { policy: ACTIVE.policy, keys: KEYS, over: { subject_policy_revision: proposed.revision } }),
  evidence('test_results', { policy: ACTIVE.policy, keys: KEYS, over: { subject_policy_revision: proposed.revision } }),
  evidence('policy_promotion_approval', { policy: ACTIVE.policy, keys: KEYS, over: { subject_policy_revision: proposed.revision, ...over } })]
const promote = (proposed, evd = promoEvidence(proposed), trusted = promoTrusted(proposed)) => evaluate({ policy: ACTIVE.policy, request: request('promote_policy'), trusted, evidence: evd, now: NOW, ledger: new EvidenceLedger() })

test('a strengthening successor is promotable with the ACTIVE policy\'s full evidence, and the approval is single-use', () => {
  const next = propose((c) => { c.actions.merge_pull_request.required_evidence.push('security_review') })
  const d = promote(next)
  assert.equal(d.decision, 'allow', JSON.stringify(d))
  assert.equal(d.consumes.length, 1)
  assert.equal(d.policy_revision, ACTIVE.revision, 'the decision is made under the ACTIVE revision, not the proposal')
})

test('weakening and root-of-trust successors can never be promoted automatically, even with every approval', () => {
  const weaker = propose((c) => { c.actions.merge_pull_request.required_evidence = ['ci_gate'] })
  const dw = promote(weaker)
  assert.equal(dw.decision, 'deny')
  assert.deepEqual(dw.reason_codes, ['PROMOTION.WEAKENING_REQUIRES_OWNER_CEREMONY'])
  const root = propose((c) => { c.limits.max_incremental_usd = 20 })
  assert.deepEqual(promote(root).reason_codes, ['PROMOTION.ROOT_OF_TRUST_REQUIRES_OWNER_CEREMONY'])
  const keyed = propose(() => {}, { keys: { ...KEYS, trusted_keys: { ...KEYS.trusted_keys, 'k-attacker': makeKeys(['orchestrator']).trusted_keys['k-orchestrator'] } } })
  assert.ok(promote(keyed).reason_codes.includes('PROMOTION.ROOT_OF_TRUST_REQUIRES_OWNER_CEREMONY'), 'a successor cannot add the keys that would approve it')
  const activated = propose((c) => { c.activation.active_actions.push('production_release') })
  assert.ok(promote(activated).reason_codes.includes('PROMOTION.ROOT_OF_TRUST_REQUIRES_OWNER_CEREMONY'), 'activation is an owner ceremony')
})

test('a candidate cannot weaken its verification and immediately benefit: the active policy keeps governing it', () => {
  // The candidate's tree carries a successor that drops independent_review from merge. Merge is still judged by the ACTIVE policy.
  const weaker = propose((c) => { c.actions.merge_pull_request.required_evidence = c.actions.merge_pull_request.required_evidence.filter((e) => e !== 'independent_review') })
  const ev = (t, p = ACTIVE.policy) => evidence(t, { policy: p, keys: KEYS })
  const withoutReview = [ev('delivery_verification'), ev('ci_gate'), ev('staging_gate')]
  const d = evaluate({ policy: ACTIVE.policy, request: request('merge_pull_request', { claimed_policy_revision: weaker.revision }), trusted: trustedFor('merger'), evidence: withoutReview, now: NOW })
  assert.equal(d.decision, 'deny')
  assert.ok(d.reason_codes.includes('POLICY.CLAIMED_REVISION_REJECTED'))
  assert.ok(d.reason_codes.includes('EVIDENCE.MISSING:independent_review'))
  // evidence minted under the proposed (weaker) revision is not evidence under the active one
  const weakerPolicy = { ...ACTIVE.policy, revision: weaker.revision }
  const minted = withoutReview.map((e) => evidence(e.payload.evidence_type, { policy: weakerPolicy, keys: KEYS }))
  const d2 = evaluate({ policy: ACTIVE.policy, request: request('merge_pull_request'), trusted: trustedFor('merger'), evidence: minted, now: NOW })
  assert.ok(minted.length && d2.rejected_evidence.every((r) => r.codes.includes('EVIDENCE.WRONG_POLICY_REVISION')))
  assert.equal(d2.decision, 'deny')
})

test('promotion refuses broken lineage, wrong subject, forged proposals and the wrong identity', () => {
  const ok = propose((c) => { c.actions.merge_pull_request.required_evidence.push('security_review') })
  assert.ok(promote(propose((c) => { c.actions.merge_pull_request.required_evidence.push('security_review') }, { parent: 'a'.repeat(64) })).reason_codes.includes('PROMOTION.PARENT_REVISION_MISMATCH'))
  assert.ok(promote(propose((c) => { c.actions.merge_pull_request.required_evidence.push('security_review') }, { parent: null })).reason_codes.includes('PROMOTION.PARENT_REVISION_MISMATCH'))
  // approval for a DIFFERENT successor
  const other = propose((c) => { c.actions.merge_pull_request.required_evidence.push('security_review'); c.protected_paths.push('x/**') })
  const wrongSubject = promote(ok, promoEvidence(other))
  assert.equal(wrongSubject.decision, 'deny')
  assert.ok(wrongSubject.rejected_evidence.some((r) => r.codes.includes('EVIDENCE.WRONG_SUBJECT_POLICY_REVISION')))
  // an approval that names no subject at all
  const unsubjected = promoEvidence(ok); delete unsubjected[3].payload.subject_policy_revision
  assert.equal(promote(ok, unsubjected).decision, 'deny')
  // proposal that is structurally invalid
  const broken = { bundle: { contract: { nope: true }, trusted_keys: {}, parent_revision: ACTIVE.revision }, revision: 'x' }
  assert.ok(promote(broken).reason_codes.includes('PROMOTION.PROPOSAL_INVALID'))
  assert.equal(promote(broken).decision, 'deny')
  const missing = evaluate({ policy: ACTIVE.policy, request: request('promote_policy'), trusted: trustedFor('policy_promoter'), evidence: promoEvidence(ok), now: NOW })
  assert.ok(missing.reason_codes.includes('PROMOTION.PROPOSAL_MISSING'))
  // the implementer, the orchestrator and every reviewer are the wrong identity
  for (const id of ['implementer', 'orchestrator', 'independent_reviewer', 'security_reviewer', 'merger']) assert.ok(promote(ok, promoEvidence(ok), { ...promoTrusted(ok), identity: id }).reason_codes.includes(`IDENTITY.NOT_PERMITTED:${id}`), id)
  // missing independent security review
  assert.ok(promote(ok, promoEvidence(ok).filter((e) => e.payload.evidence_type !== 'security_review')).reason_codes.includes('EVIDENCE.MISSING:security_review'))
  // under the shipped (non-activated) policy promotion is dry-run only
  const shipped = buildPolicy({ keys: KEYS })
  const dry = evaluate({ policy: shipped.policy, request: request('promote_policy'), trusted: promoTrusted(propose(() => {})), evidence: [], now: NOW })
  assert.equal(dry.decision, 'deny')
})

test('bootstrap: the shipped contract is inactive, chained from nothing, and its own revision is content-addressed', () => {
  const c = loadContractFile()
  const bundle = buildPolicyBundle({ contract: c })
  assert.equal(bundle.parent_revision, null)
  assert.deepEqual(bundle.trusted_keys, {})
  const flipped = structuredClone(c); flipped.activation.active_actions = ['merge_pull_request']
  assert.notEqual(policyRevision(buildPolicyBundle({ contract: flipped })), policyRevision(bundle), 'activating anything changes the revision, so it needs a new pin')
})
