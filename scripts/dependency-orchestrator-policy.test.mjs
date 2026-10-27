import assert from 'node:assert/strict'
import test from 'node:test'
import { bumpKind, compareVersions, satisfies } from './dependency-orchestrator-versions.mjs'
import {
  HARD_LIMITS, classifyPr, compatibilityProblems, evaluateMergeGate, extractUpdates, matchApproval, normalizePolicy,
  orderQueue, parseManifestVersions,
} from './dependency-orchestrator-policy.mjs'
import { MAIN, MAIN_API, MAIN_WEB, NOW, SHA, green, policyWith, prFixture } from './dependency-orchestrator-fixtures.mjs'

const mainVersions = () => new Map([...parseManifestVersions('apps/web/package.json', MAIN_WEB), ...parseManifestVersions('apps/api/requirements.txt', MAIN_API)])
const classify = (pr, policy = policyWith()) => classifyPr({ pr, files: pr.files, mainVersions: mainVersions(), policy })

test('version comparison, bump kinds and range satisfaction', () => {
  assert.equal(compareVersions('16.3.0-preview.10', '16.3.0'), -1)
  assert.equal(compareVersions('2.3.0', '0.121.0'), 1)
  assert.equal(bumpKind('15.4.0', '16.0.0'), 'major')
  assert.equal(bumpKind('1.1.23', '1.3.1'), 'minor')
  assert.equal(bumpKind('1.0.1', '1.0.9'), 'patch')
  assert.equal(bumpKind('2.0.0', '1.0.0'), 'downgrade')
  assert.equal(bumpKind('16.3.0-preview.10', '16.4.3'), 'minor')
  assert.ok(satisfies('19.0.0', '^18.0.0 || ^19.0.0'))
  assert.ok(!satisfies('17.0.2', '^18.0.0 || ^19.0.0'))
  assert.ok(satisfies('4.1.0', '>=4.0.0'))
  assert.ok(!satisfies('3.4.4', '>=4.0.0'))
  assert.ok(satisfies('1.4.9', '>=1.4,<2'))
  assert.ok(!satisfies('not-a-version', '>=1'), 'unparseable input fails closed')
})

test('updates are extracted from manifest diffs only, never from PR text', () => {
  const npm = extractUpdates([{ filename: 'apps/web/package.json', patch: '@@\n-    "framer-motion": "^13.0.0",\n+    "framer-motion": "^14.2.0",\n-    "lint": "eslint .",\n+    "lint": "eslint . --max-warnings 0",' }])
  assert.deepEqual(npm.map(({ name, from, to }) => [name, from, to]), [['framer-motion', '13.0.0', '14.2.0']])
  const pip = extractUpdates([{ filename: 'apps/api/requirements.txt', patch: '@@\n-Stripe==15.4.0\n+stripe==15.4.0' }])
  assert.equal(pip.length, 0, 'a case-only rename is not an upgrade')
  const pip2 = extractUpdates([{ filename: 'apps/api/requirements.txt', patch: '@@\n-stripe==15.4.0\n+stripe==16.0.0' }])
  assert.deepEqual(pip2.map((u) => u.name), ['stripe'])
  const actions = extractUpdates([{ filename: '.github/workflows/ci.yml', patch: '@@\n-      - uses: actions/checkout@v6\n+      - uses: actions/checkout@v7' }])
  assert.deepEqual(actions.map((u) => [u.name, u.from, u.to]), [['actions/checkout', 'v6', 'v7']])
})

test('billing, auth, framework, github-actions and unexpected files are never automatic', () => {
  for (const [name, from, to, eco] of [['stripe', '22.4.0', '22.5.0', 'npm'], ['next', '16.3.0-preview.10', '16.4.3', 'npm'], ['cryptography', '50.0.2', '50.0.3', 'pip'], ['stripe', '15.4.0', '15.5.0', 'pip']]) {
    const result = classify(prFixture(1, { eco, name, from, to }))
    assert.equal(result.never_automatic, true, `${name} is never automatic`)
    assert.equal(result.risk, 'high')
  }
  assert.equal(classify(prFixture(2, { eco: 'pip', name: 'paramiko', from: '3.5.1', to: '5.1.0' })).never_automatic, true, 'paramiko major')
  assert.equal(classify(prFixture(3, { eco: 'pip', name: 'paramiko', from: '3.5.1', to: '3.5.2' })).never_automatic, false, 'paramiko patch is only medium')
  const workflowPr = prFixture(4, { files: [{ filename: '.github/workflows/ci.yml', patch: '@@\n-      - uses: actions/checkout@v6\n+      - uses: actions/checkout@v7' }] })
  const wf = classify(workflowPr)
  assert.ok(wf.categories.includes('github-actions') && wf.never_automatic)
  const sneaky = classify(prFixture(5, { files: [
    { filename: 'apps/web/package.json', patch: '@@\n-    "clsx": "^2.1.0",\n+    "clsx": "^2.1.1",' },
    { filename: 'apps/web/lib/auth.ts', patch: '@@\n+steal()' },
  ] }))
  assert.ok(sneaky.violations.some((v) => v.includes('non-manifest files')))
  assert.equal(sneaky.never_automatic, true)
  assert.equal(classify(prFixture(6, { files: [{ filename: 'supabase/migrations/001.sql', patch: '@@\n+drop table x;' }] })).categories.includes('database'), true)
})

test('low-risk minor/patch updates are mergeable candidates; majors are at least medium', () => {
  const patch = classify(prFixture(7, { eco: 'pip', name: 'requests', from: '2.32.0', to: '2.32.3' }))
  assert.equal(patch.risk, 'low')
  assert.equal(patch.never_automatic, false)
  const major = classify(prFixture(8, { eco: 'pip', name: 'reportlab', from: '4.4.4', to: '5.1.0' }))
  assert.equal(major.risk, 'medium')
  assert.equal(major.updates[0].bump, 'major')
})

test('research may raise risk but can never lower it or clear violations', () => {
  const pr = prFixture(9, { eco: 'pip', name: 'reportlab', from: '4.4.4', to: '5.1.0' })
  const raised = classifyPr({ pr, files: pr.files, mainVersions: mainVersions(), policy: policyWith(), research: { findings: [{ package: 'reportlab', risk_floor: 'high' }] } })
  assert.equal(raised.risk, 'high')
  const lowered = classifyPr({ pr, files: pr.files, mainVersions: mainVersions(), policy: policyWith(), research: { findings: [{ package: 'reportlab', risk_floor: 'low' }] } })
  assert.equal(lowered.risk, 'medium')
})

test('redundant and superseded proposals are detected against current main', () => {
  const already = classify(prFixture(10, { eco: 'npm', name: 'clsx', from: '2.0.0', to: '2.1.0' }))
  assert.equal(already.all_redundant, true, 'main already has clsx 2.1.1')
  const removed = classify(prFixture(11, { eco: 'npm', name: 'left-pad', from: '1.0.0', to: '1.1.0' }))
  assert.equal(removed.all_redundant, true, 'package is not declared on main any more')
})

test('known and registry incompatibilities block; providing PRs create ordering edges', () => {
  const tailwindMerge = classify(prFixture(20, { name: 'tailwind-merge', from: '2.6.1', to: '3.7.0' }))
  const policy = policyWith()
  const { problems } = compatibilityProblems({ analyses: [tailwindMerge], mainVersions: mainVersions(), policy, compat: {} })
  assert.match(problems.get(20)[0], /requires tailwindcss >=4\.0\.0/)

  const motion = classify(prFixture(21, { name: 'framer-motion', from: '13.0.0', to: '14.2.0' }))
  const react = classify(prFixture(22, { name: 'react', from: '18.3.1', to: '19.2.0' }))
  const compat = { 'npm:framer-motion@14.2.0': { peers: { react: '^19.0.0' } } }
  const result = compatibilityProblems({ analyses: [motion, react], mainVersions: mainVersions(), policy, compat })
  assert.equal(result.problems.size, 0)
  assert.deepEqual(result.edges.map((e) => [e.before, e.after]), [[22, 21]])
  const { order } = orderQueue([motion, react], result.edges)
  assert.deepEqual(order, [22, 21], 'react must precede framer-motion even though risk ordering would not require it')
})

test('order is risk-first, deterministic, and reports cycles', () => {
  const low = classify(prFixture(30, { eco: 'pip', name: 'requests', from: '2.32.0', to: '2.32.3' }))
  const medium = classify(prFixture(31, { eco: 'pip', name: 'reportlab', from: '4.4.4', to: '5.1.0' }))
  const high = classify(prFixture(29, { eco: 'pip', name: 'stripe', from: '15.4.0', to: '16.0.0' }))
  assert.deepEqual(orderQueue([high, medium, low]).order, [30, 31, 29])
  const cyc = orderQueue([low, medium], [{ before: 30, after: 31 }, { before: 31, after: 30 }])
  assert.deepEqual(cyc.cyclic.sort(), [30, 31])
})

test('policy normalization clamps limits and fails closed', () => {
  assert.throws(() => normalizePolicy({ version: 2 }))
  const clamped = normalizePolicy({ version: 1, limits: { max_ticks_per_batch: 10_000_000, max_claude_usd: -4 }, merge: { mode: 'yolo' }, schedule: { mode: 'nonsense' } })
  assert.equal(clamped.limits.max_ticks_per_batch, HARD_LIMITS.max_ticks_per_batch)
  assert.equal(clamped.limits.max_claude_usd, 25, 'invalid values fall back to the safe default')
  assert.equal(normalizePolicy({ version: 1 }).limits.max_repair_requests_per_pr, 1)
  assert.equal(clamped.merge.mode, 'prepare-only')
  assert.equal(clamped.schedule.mode, 'off')
  assert.equal(clamped.mutation_enabled, false)
  assert.throws(() => normalizePolicy({ version: 1, merge: { approvals: [{ pr: 5, updates: [], approved_by: 'x', expires_at: '2027-01-01' }] } }), /exact approved dependency changes/)
  assert.throws(() => normalizePolicy({ version: 1, merge: { approvals: [{ pr: 5, head_sha: 'abc', updates: [{ ecosystem: 'pip', name: 'a', from: '1', to: '2' }], approved_by: 'x', expires_at: '2027-01-01' }] } }), /head_sha/)
})

// ── merge approval + gate ────────────────────────────────────────────────────────────────

const approval = (pr, updates, extra = {}) => ({ pr, updates, approved_by: 'henil', approved_at: '2026-10-26', expires_at: '2026-12-01', acknowledge_major: true, ...extra })
const patchUpdate = { ecosystem: 'pip', name: 'requests', from: '2.32.0', to: '2.32.3' }
const approvedPolicy = (approvals) => policyWith({ merge: { mode: 'approved-only', approvals } })

function gateFacts(pr, overrides = {}) {
  return {
    pr: { ...pr, state: 'open' }, main_sha: MAIN,
    checks: { 'CI Gate': green(pr.head.sha), 'Database Migration Gate': green(pr.head.sha), 'Staging Gate': green(pr.head.sha) },
    verified: { head_sha: pr.head.sha, base_sha: MAIN },
    contains_main: true, changes_requested: false, unresolved_threads: 0, authors_trusted: true,
    ...overrides,
  }
}

test('merge gate passes only for an exactly approved, fully verified, current candidate', () => {
  const pr = prFixture(40, { eco: 'pip', name: 'requests', from: '2.32.0', to: '2.32.3' })
  const analysis = classify(pr)
  const policy = approvedPolicy([approval(40, [patchUpdate])])
  const ok = evaluateMergeGate({ policy, analysis, facts: gateFacts(pr), today: NOW.slice(0, 10) })
  assert.deepEqual(ok.reasons, [])
  assert.equal(ok.ok, true)
})

test('merge gate negatives: every missing precondition independently blocks the merge', () => {
  const pr = prFixture(41, { eco: 'pip', name: 'requests', from: '2.32.0', to: '2.32.3' })
  const analysis = classify(pr)
  const good = approvedPolicy([approval(41, [patchUpdate])])
  const today = NOW.slice(0, 10)
  const run = (over = {}, policy = good, an = analysis) => evaluateMergeGate({ policy, analysis: an, facts: gateFacts(pr, over), today })
  const refused = (result, pattern) => { assert.equal(result.ok, false); assert.match(result.reasons.join(' | '), pattern) }

  refused(run({}, approvedPolicy([])), /no approval entry names PR #41/)
  refused(run({}, approvedPolicy([approval(99, [patchUpdate])])), /no approval entry/)
  refused(run({}, approvedPolicy([approval(41, [{ ...patchUpdate, to: '2.32.4' }])])), /differs from the PR diff/)
  refused(run({}, approvedPolicy([approval(41, [patchUpdate], { expires_at: '2026-10-01' })])), /expired/)
  refused(run({}, approvedPolicy([approval(41, [patchUpdate], { head_sha: SHA('beef') })])), /different head SHA/)
  refused(run({}, policyWith({ mutation_enabled: false, merge: good.merge })), /mutation is disabled/)
  refused(run({}, { ...good, paused: true }), /paused/)
  refused(run({}, { ...good, merge: { ...good.merge, mode: 'prepare-only' } }), /prepare-only/)
  refused(run({ main_sha: SHA('b2') }), /stale: main moved/)
  refused(run({ verified: null }), /no verification recorded/)
  refused(run({ verified: { head_sha: SHA('c3'), base_sha: MAIN } }), /exact head SHA/)
  refused(run({ checks: { 'CI Gate': green(pr.head.sha), 'Database Migration Gate': green(pr.head.sha), 'Staging Gate': null } }), /Staging Gate/)
  refused(run({ checks: { 'CI Gate': green(SHA('dead')), 'Database Migration Gate': green(pr.head.sha), 'Staging Gate': green(pr.head.sha) } }), /CI Gate/)
  refused(run({ checks: { 'CI Gate': green(pr.head.sha), 'Database Migration Gate': { status: 'completed', conclusion: 'failure', head_sha: pr.head.sha }, 'Staging Gate': green(pr.head.sha) } }), /Database Migration Gate/)
  refused(run({ contains_main: false }), /latest main/)
  refused(run({ changes_requested: true }), /changes requested/)
  refused(run({ unresolved_threads: 2 }), /unresolved review threads/)
  refused(run({ authors_trusted: false }), /untrusted author/)
  refused(run({ pr: { ...pr, state: 'open', mergeable_state: 'blocked' } }), /mergeable state is blocked/)
  refused(run({ pr: { ...pr, state: 'open', draft: true } }), /non-draft/)
  refused(run({ pr: { ...pr, state: 'open', base: { ref: 'release' } } }), /targeting main/)
})

test('high-risk and never-automatic changes are refused even with an exact approval and green CI', () => {
  for (const [eco, name, from, to] of [['pip', 'stripe', '15.4.0', '16.0.0'], ['pip', 'paramiko', '3.5.1', '5.1.0'], ['npm', 'stripe', '22.4.0', '23.0.0'], ['pip', 'cryptography', '50.0.2', '50.0.3']]) {
    const pr = prFixture(50, { eco, name, from, to })
    const analysis = classify(pr)
    const policy = approvedPolicy([approval(50, [{ ecosystem: eco, name, from, to }])])
    const result = evaluateMergeGate({ policy, analysis, facts: gateFacts(pr), today: NOW.slice(0, 10) })
    assert.equal(result.ok, false, `${name} ${from}->${to}`)
    assert.match(result.reasons.join(' '), /never-automatic|risk is high/)
  }
})

test('a major upgrade needs explicit acknowledgement in the approval', () => {
  const pr = prFixture(51, { eco: 'pip', name: 'reportlab', from: '4.4.4', to: '5.1.0' })
  const analysis = classify(pr)
  const update = { ecosystem: 'pip', name: 'reportlab', from: '4.4.4', to: '5.1.0' }
  assert.equal(matchApproval({ analysis, policy: approvedPolicy([approval(51, [update], { acknowledge_major: false })]), today: NOW.slice(0, 10) }).approval, null)
  assert.ok(matchApproval({ analysis, policy: approvedPolicy([approval(51, [update])]), today: NOW.slice(0, 10) }).approval)
})

test('registry requirements bind only packages the repository declares; transitive installs are not conflicts', () => {
  const policy = policyWith()
  const paramiko = classify(prFixture(70, { eco: 'pip', name: 'paramiko', from: '3.5.1', to: '3.6.0' }))
  const undeclared = { 'pip:paramiko@3.6.0': { peers: { bcrypt: '>=3.2', invoke: '>=2.0' } } }
  assert.equal(compatibilityProblems({ analyses: [paramiko], mainVersions: mainVersions(), policy, compat: undeclared }).problems.size, 0)
  const declaredConflict = { 'pip:paramiko@3.6.0': { peers: { cryptography: '>=99' } } }
  const result = compatibilityProblems({ analyses: [paramiko], mainVersions: mainVersions(), policy, compat: declaredConflict })
  assert.match(result.problems.get(70)[0], /requires cryptography >=99/)
})

test('GitHub Actions PRs may edit workflow files yet stay human-only', () => {
  const policy = policyWith({ allowed_paths: { npm: [], pip: [], 'github-actions': ['.github/workflows/'] } })
  const pr = prFixture(71, { files: [{ filename: '.github/workflows/ci.yml', patch: '@@\n-      - uses: actions/checkout@v6\n+      - uses: actions/checkout@v7' }] })
  const result = classifyPr({ pr, files: pr.files, mainVersions: mainVersions(), policy })
  assert.equal(result.never_automatic, true)
  assert.ok(result.categories.includes('github-actions'))
  assert.ok(!result.categories.includes('unexpected-files'), 'workflow edits are expected for this ecosystem')
  const nested = prFixture(72, { files: [{ filename: '.github/workflows/sub/evil.yml', patch: '@@\n+x' }] })
  assert.ok(classifyPr({ pr: nested, files: nested.files, mainVersions: mainVersions(), policy }).categories.includes('unexpected-files'))
})
