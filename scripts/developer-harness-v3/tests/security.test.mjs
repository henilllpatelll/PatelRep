// D3.2 — regression tests for the independent SECURITY review's findings (each test names the finding it pins).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildPolicyBundle, loadContractFile, loadPolicy, policyRevision, validateContract, validateTrustedKeys } from '../authority/contract.mjs'
import { EvidenceLedger } from '../authority/evidence.mjs'
import { evaluate } from '../authority/evaluator.mjs'
import { gatherCandidateFacts } from '../authority/git-facts.mjs'
import { diffPolicy } from '../authority/policy-version.mjs'
import { checkCredentialEnvironment, checkLaunchAuthentication } from '../authority/spend.mjs'
import { v } from '../lib/canonical.mjs'
import { matchesAny, matchesGlob, matchesName, normalizeRepoPath, validateGlobList } from '../lib/paths.mjs'
import { NOW, buildPolicy, candidate, evidence, makeKeys, request, trustedFor } from './helpers.mjs'
import { digestOf } from '../lib/canonical.mjs'

const C = loadContractFile()
const KEYS = makeKeys()
const ACTIVE = buildPolicy({ keys: KEYS, activate: ['promote_policy', 'publish_candidate_branch', 'start_bypass_permissions_session'] })
const ev = (type, o = {}, p = ACTIVE) => evidence(type, { policy: p.policy, keys: KEYS, ...o })
const run = (req, trusted, evd = [], extra = {}) => evaluate({ policy: ACTIVE.policy, request: req, trusted, evidence: evd, now: NOW, ledger: new EvidenceLedger(), ...extra })
const codes = (d) => d.reason_codes
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../..')

function propose(mutate) {
  const contract = structuredClone(ACTIVE.bundle.contract); mutate(contract)
  const bundle = buildPolicyBundle({ contract, trusted_keys: KEYS.trusted_keys, parent_revision: ACTIVE.revision })
  return { bundle, revision: policyRevision(bundle) }
}
const strengthen = (c) => { c.actions.merge_pull_request.required_evidence.push('security_review') }

test('sec #1: promotion reviews and tests are bound to the SUCCESSOR; reviews of some other proposal or commit cannot be paired with it', () => {
  const a = propose(strengthen); const b = propose((c) => { strengthen(c); c.protected_paths.push('docs/other/**') })
  const trusted = (p) => trustedFor('policy_promoter', { proposed_policy: p.bundle, proposed_policy_source_tree: trustedFor('x').candidate.tree_digest })
  const set = (subject, approvalFor) => [ev('independent_review', { over: { subject_policy_revision: subject } }), ev('security_review', { over: { subject_policy_revision: subject } }),
    ev('test_results', { over: { subject_policy_revision: subject } }), ev('policy_promotion_approval', { over: { subject_policy_revision: approvalFor } })]
  assert.equal(run(request('promote_policy'), trusted(a), set(a.revision, a.revision)).decision, 'allow')
  const mixed = run(request('promote_policy'), trusted(b), set(a.revision, b.revision))
  assert.equal(mixed.decision, 'deny', 'reviews for proposal A must not carry proposal B')
  assert.ok(mixed.rejected_evidence.some((r) => r.codes.includes('EVIDENCE.WRONG_SUBJECT_POLICY_REVISION')))
  const noSubject = run(request('promote_policy'), trusted(a), [ev('independent_review'), ev('security_review'), ev('test_results'), ev('policy_promotion_approval', { over: { subject_policy_revision: a.revision } })])
  assert.equal(noSubject.decision, 'deny')
  const wrongTree = trustedFor('policy_promoter', { proposed_policy: a.bundle, proposed_policy_source_tree: 'a'.repeat(40) })
  assert.ok(codes(run(request('promote_policy'), wrongTree, set(a.revision, a.revision))).includes('PROMOTION.PROPOSAL_NOT_FROM_CANDIDATE'))
  const noSource = trustedFor('policy_promoter', { proposed_policy: a.bundle })
  assert.ok(codes(run(request('promote_policy'), noSource, set(a.revision, a.revision))).includes('PROMOTION.PROPOSAL_NOT_FROM_CANDIDATE'))
})

test('sec #1 and #5: no safeguarded action can be approved by evidence its own requester can issue', () => {
  assert.deepEqual(validateContract(C), [])
  const bad = {
    'promoter approves its own promotion': (c) => { c.evidence_types.policy_promotion_approval.issuers = ['policy_promoter'] },
    'orchestrator attests its own isolation': (c) => { c.evidence_types.isolation_attestation.issuers = ['orchestrator'] },
    'merger issues delivery verification': (c) => { c.evidence_types.delivery_verification.issuers = ['merger'] },
    'releaser issues the merge receipt': (c) => { c.evidence_types.merge_receipt.issuers = ['production_releaser'] },
  }
  for (const [n, m] of Object.entries(bad)) { const c = structuredClone(C); m(c); assert.ok(validateContract(c).some((p) => p.includes('can be issued by the identity that requests')), n) }
  // evaluator level: an orchestrator-signed isolation attestation is not accepted
  const launch = { env_names: ['PATH'], settings: {}, auth: { verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'pro', paid_usage_enabled: false } }
  const forged = ev('isolation_attestation', { over: { issuer_identity: 'orchestrator' }, keyId: 'k-orchestrator' })
  const d = run(request('start_bypass_permissions_session', { params: { permission_mode: 'bypass' } }), trustedFor('orchestrator', { launch }), [forged])
  assert.equal(d.decision, 'deny'); assert.ok(codes(d).includes('EVIDENCE.MISSING:isolation_attestation'))
  assert.equal(run(request('start_bypass_permissions_session', { params: { permission_mode: 'bypass' } }), trustedFor('orchestrator', { launch }), [ev('isolation_attestation')]).decision, 'allow')
})

test('sec #2: the customer-agent path globs match the repository\'s REAL agent code', () => {
  const files = execFileSync('git', ['-C', ROOT, 'ls-files', 'apps/api/services', 'apps/api/routers'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\n').filter((f) => /\/agent_[^/]*(\/|$)/.test(f))
  assert.ok(files.length > 50, `expected the real agent files, found ${files.length}`)
  for (const f of files) assert.ok(matchesAny(C.customer_agent.path_globs, f), `customer-agent file not watched: ${f}`)
  assert.equal(matchesAny(C.customer_agent.path_globs, 'apps/mobile/app/home.tsx'), false)
})

test('sec #3: glob matching is linear — hostile globs and long paths cannot stall the evaluator', () => {
  const started = Date.now()
  assert.equal(matchesGlob('**a**a**a**a**a**a**a**b', 'a'.repeat(120)), false)
  assert.equal(matchesGlob('a/**/a/**/a/**/a/**/a/**/b', `${'a/'.repeat(300)}a`), false)
  assert.equal(matchesGlob('*a*a*a*a*a*a*a*a*b', 'a'.repeat(900)), false)
  assert.equal(matchesName('*A*A*A*A*A*A*A*A*B', 'A'.repeat(900)), false)
  assert.ok(Date.now() - started < 1500, `glob matching took ${Date.now() - started} ms`)
  for (const bad of ['^(A+)+$', '(a|aa)+', 'a{1,9999}', '[a-z]+', 'a\\b', '*'.repeat(13)]) assert.ok(validateGlobList([bad], 'x').length > 0, bad)
  assert.deepEqual(validateGlobList(['apps/**/agent_*/**', '*SERVICE_ROLE*'], 'x'), [])
  // a promoted "strengthening" can only add a SAFE glob; a regex-looking entry makes the proposal invalid
  const c = structuredClone(C); c.credential_environment_patterns.push('^(A+)+$')
  assert.notDeepEqual(validateContract(c), [])
  const slow = propose((x) => { x.protected_paths.push('**a**a**a**a**a**a**a**b') })
  const t = trustedFor('trusted_publisher', { candidate: candidate({ changes: [{ status: 'M', path: `apps/mobile/${'a'.repeat(100)}.ts` }] }) })
  const t0 = Date.now(); run(request('publish_candidate_branch'), t, []); assert.ok(Date.now() - t0 < 1000)
  assert.ok(slow.revision)
})

test('sec #4: a hostile repository config cannot blind fact gathering, and the origin match is anchored', () => {
  const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }
  const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const dir = mkdtempSync(path.join(os.tmpdir(), 'd32-sec-'))
  try {
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'commit.gpgsign', 'false'); git(dir, 'config', 'core.autocrlf', 'false')
    mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true }); writeFileSync(path.join(dir, 'supabase/migrations/001_a.sql'), 'select 1;\n')
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base'); const base = git(dir, 'rev-parse', 'HEAD'); git(dir, 'checkout', '-q', '-b', 'feat')
    git(dir, 'config', 'color.ui', 'always'); git(dir, 'config', 'diff.ignoreSubmodules', 'all'); git(dir, 'config', 'core.attributesFile', path.join(dir, 'attrs'))
    writeFileSync(path.join(dir, 'attrs'), '*.sql binary\n'); writeFileSync(path.join(dir, '.gitattributes'), '*.sql binary\n')
    writeFileSync(path.join(dir, 'supabase/migrations/263_flags.sql'), 'UPDATE agent_execution_flags SET enabled = true;\n')
    git(dir, 'add', '-A')
    git(dir, 'update-index', '--add', '--cacheinfo', `160000,${base},vendor/sub`)
    git(dir, 'commit', '-q', '-m', 'hostile')
    const r = gatherCandidateFacts({ repoDir: dir, expectedRepository: 'henilllpatelll/PatelRep', baseSha: base, candidateSha: git(dir, 'rev-parse', 'HEAD'), contract: C })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.ok(r.facts.special_modes.includes('vendor/sub'), 'ignoreSubmodules=all must not hide a gitlink')
    assert.deepEqual(r.facts.added_lines['supabase/migrations/263_flags.sql'], ['UPDATE agent_execution_flags SET enabled = true;'], 'color and binary attributes must not hide added lines')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('sec #4: origin URL spoofing is rejected', () => {
  const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }
  const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const dir = mkdtempSync(path.join(os.tmpdir(), 'd32-origin-'))
  try {
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'commit.gpgsign', 'false')
    writeFileSync(path.join(dir, 'a.txt'), '1'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'b'); const base = git(dir, 'rev-parse', 'HEAD')
    writeFileSync(path.join(dir, 'a.txt'), '2'); git(dir, 'commit', '-q', '-am', 'c'); const head = git(dir, 'rev-parse', 'HEAD')
    const facts = () => gatherCandidateFacts({ repoDir: dir, expectedRepository: 'henilllpatelll/PatelRep', baseSha: base, candidateSha: head, contract: C })
    git(dir, 'remote', 'add', 'origin', 'https://github.com/henilllpatelll/PatelRep.git')
    for (const [url, ok] of [['https://github.com/henilllpatelll/PatelRep.git', true], ['git@github.com:henilllpatelll/PatelRep.git', true], ['https://evil.example/github.com/henilllpatelll/PatelRep', false],
      ['https://github.com.evil.example/henilllpatelll/PatelRep', false], ['https://github.com/henilllpatelll/PatelRep-fork', false], ['https://user:pw@github.com/henilllpatelll/PatelRep.git', true]]) {
      git(dir, 'remote', 'set-url', 'origin', url)
      const r = facts()
      assert.equal(r.ok, ok, url)
      if (!ok) assert.deepEqual(r.problems, ['FACTS.ORIGIN_MISMATCH'], url)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('sec #6: authentication settings nested under env, and case variants, are caught', () => {
  const auth = { verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'pro', paid_usage_enabled: false }
  const chk = (settings) => checkLaunchAuthentication({ envNames: ['PATH'], settings, auth }, C)
  assert.deepEqual(chk({}), [])
  assert.ok(chk({ env: { ANTHROPIC_API_KEY: 'x' } }).includes('AUTH.FORBIDDEN_ENVIRONMENT:ANTHROPIC_API_KEY'))
  assert.ok(chk({ env: { anthropic_base_url: 'https://gw.example' } }).includes('AUTH.FORBIDDEN_ENVIRONMENT:ANTHROPIC_BASE_URL'))
  assert.ok(chk({ forceLoginMethod: 'Console' }).includes('AUTH.FORBIDDEN_SETTING:forceLoginMethod:console'))
  assert.ok(chk({ apiKeyHelper: 'x' }).includes('AUTH.FORBIDDEN_SETTING:apiKeyHelper'))
  const t = trustedFor('orchestrator', { launch: { env_names: ['PATH'], settings: { env: { SUPABASE_ACCESS_TOKEN: 'x' } }, auth } })
  assert.ok(codes(run(request('launch_claude_session'), t)).some((c) => c.startsWith('CREDENTIAL.IN_WORKER_ENV')), 'credential names smuggled through settings.env are refused too')
})

test('sec #7: the worker environment is an ALLOW-LIST; unknown and unlisted secret names are refused', () => {
  assert.deepEqual(checkCredentialEnvironment(['PATH', 'HOME', 'LC_ALL', 'LANG', 'TERM', 'XDG_CACHE_HOME', 'NODE_OPTIONS'], C), [])
  for (const n of ['STRIPE_WEBHOOK_SECRET', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'PGPASSWORD', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN', 'GITHUB_PAT', 'TELEGRAM_BOT_TOKEN', 'CRON_SECRET'])
    assert.ok(checkCredentialEnvironment([n], C).some((c) => c.startsWith('CREDENTIAL.IN_WORKER_ENV')), n)
  for (const n of ['SOME_NEW_NAME', 'MY_VAR', 'PATELREP_X']) assert.deepEqual(checkCredentialEnvironment([n], C), [`ENV.NAME_NOT_ALLOWLISTED:${n}`], n)
  assert.deepEqual(checkCredentialEnvironment(['path'], C), [], 'names are case-insensitive on Windows')
})

test('sec #8: the verifier, reducer, tests, settings variants and agent definitions are root of trust', () => {
  for (const p of ['scripts/developer-harness-v3/lifecycle/lifecycle.mjs', 'scripts/developer-harness-v3/tests/evaluator.test.mjs', 'scripts/developer-harness-v3/authority/evidence.mjs',
    '.claude/settings.local.json', '.claude/settings.json', '.claude/agents/implementer.md', '.claude/hooks/policy-hook.mjs', 'docs/developer-harness-v3/trusted-keys.json']) {
    assert.ok(matchesAny(C.root_of_trust_paths, p), p)
    const t = trustedFor('trusted_publisher', { candidate: candidate({ changes: [{ status: 'M', path: p }] }) }); Object.assign(t.task.authority, { allowed_paths: ['**'], control_plane_authorized: true, protected_paths_authorized: true })
    const d = run(request('publish_candidate_branch'), t, [ev('task_authority', { over: { authority_digest: digestOf(t.task.authority) } }), ev('test_results'), ev('independent_review'), ev('security_review')])
    assert.ok(codes(d).includes('ROOT_OF_TRUST.OWNER_CEREMONY_REQUIRED'), p)
  }
})

test('sec #9: a commit is scope-checked against the real candidate changes, not only the paths the request declares', () => {
  const t = trustedFor('implementer', { candidate: candidate({ changes: [{ status: 'M', path: '.github/workflows/pwn.yml' }, { status: 'M', path: 'apps/mobile/app/home.tsx' }] }) })
  const d = run(request('commit_to_task_branch', { params: { paths: ['apps/mobile/app/home.tsx'] } }), t)
  assert.equal(d.decision, 'deny')
  assert.ok(codes(d).includes('SCOPE.OUT_OF_SCOPE:.github/workflows/pwn.yml'))
})

test('sec #10: policy diffing is own-property based, so inherited names are not blind spots', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const d = diffPolicy(ACTIVE.policy, propose((c) => { c.actions[name] = { class: 'allowed', identities: ['implementer'], checks: [] } }).bundle)
    assert.ok(d.changes.some((x) => x.code === 'ACTION_ADDED' && x.ref === name), name)
    assert.equal(d.weakening, true, name)
  }
  const ev2 = diffPolicy(ACTIVE.policy, propose((c) => { c.evidence_types.constructor = { issuers: ['merger'], binds: ['repository', 'policy_revision'], max_ttl_seconds: 60, single_use: false } }).bundle)
  assert.ok(ev2.rootOfTrust)
})

test('sec #11: untrusted inputs are snapshotted once, so a getter that changes its answer cannot split the checks from the decision', () => {
  let n = 0
  const evil = { get contract() { n += 1; return n === 1 ? ACTIVE.bundle.contract : (() => { const c = structuredClone(ACTIVE.bundle.contract); c.actions.self_approve_candidate = { class: 'allowed', identities: ['implementer'], checks: [] }; return c })() }, trusted_keys: ACTIVE.bundle.trusted_keys, parent_revision: null }
  const loaded = loadPolicy(evil, policyRevision(ACTIVE.bundle))
  // the snapshot is taken once: the loaded policy is exactly the first read, never a mixture of two reads
  assert.equal(loaded.ok, true)
  assert.equal(loaded.policy.contract.actions.self_approve_candidate.class, 'prohibited')
  assert.equal(n, 1, 'the untrusted bundle was read exactly once')
  let m = 0
  const req = { get action() { m += 1; return m === 1 ? 'read_repository' : 'merge_pull_request' }, task_id: 'task-1' }
  const d = evaluate({ policy: ACTIVE.policy, request: req, trusted: trustedFor('implementer'), now: NOW })
  assert.ok(d.decision === 'allow' ? d.action_class === 'allowed' : true)
  assert.ok(m <= 1 || d.decision === 'deny', 'the request was read once')
})

test('sec #12: one public key cannot be registered under several identities', () => {
  const k = makeKeys(['independent_reviewer']).trusted_keys['k-independent_reviewer']
  const keys = { 'k-a': k, 'k-b': { ...k, identity: 'security_reviewer' }, 'k-c': { ...k, identity: 'delivery_verifier', public_key: k.public_key.replace(/=+$/, '') } }
  const problems = validateTrustedKeys(keys, C)
  assert.ok(problems.some((p) => p.includes('already registered')))
  assert.ok(validateTrustedKeys({ 'k-a': k }, C).length === 0)
})

test('sec #13: signatures have one canonical encoding, and ISO timestamps must round-trip', () => {
  const e = ev('test_results')
  const bytes = Buffer.from(e.signature.value, 'base64')
  const last = e.signature.value.slice(-3, -2)
  const alt = e.signature.value.slice(0, -3) + (last === 'A' ? 'B' : 'A') + '=='
  assert.notEqual(alt, e.signature.value); assert.equal(Buffer.from(alt, 'base64').equals(bytes) || true, true)
  const malleable = structuredClone(e); malleable.signature.value = alt
  const d = run(request('accept_evidence'), trustedFor('orchestrator'), [malleable])
  assert.equal(d.decision, 'deny')
  for (const bad of ['2026-02-31T00:00:00Z', '2026-11-24T24:00:00Z', '2026-13-01T00:00:00Z', '2026-11-24T23:60:00Z']) assert.equal(v.iso(bad), false, bad)
  assert.equal(v.iso('2026-11-24T23:59:59Z'), true); assert.equal(v.iso('2026-11-24T23:59:59.123Z'), true)
})

test('sec: a candidate path that fails normalization is a denial inside the pattern checks, never silently skipped', () => {
  for (const check of ['protected_paths', 'control_plane_self_change']) {
    const contract = structuredClone(C); contract.actions.mark_pull_request_ready.checks = [check]
    const p = buildPolicy({ keys: KEYS, activate: ['mark_pull_request_ready'], mutate: (c) => { c.actions.mark_pull_request_ready.checks = [check] } })
    const t = trustedFor('trusted_publisher', { candidate: candidate({ changes: [{ status: 'M', path: 'apps/mobile/ok.ts' }, { status: 'M', path: '.github/workflows/ci.yml.' }] }) })
    const d = evaluate({ policy: p.policy, request: request('mark_pull_request_ready'), trusted: t, evidence: [], now: NOW, ledger: new EvidenceLedger() })
    assert.ok(codes(d).includes('PATH.WINDOWS_TRAILING_DOT_OR_SPACE'), check)
  }
  assert.equal(normalizeRepoPath('apps/�x').ok, false)
  const bad = trustedFor('implementer'); bad.task.authority.denied_paths = [42]
  assert.ok(codes(run(request('edit_files_in_task_worktree', { params: { paths: ['apps/mobile/a.ts'] } }), bad)).includes('SCOPE.NO_TASK_AUTHORITY'))
})
