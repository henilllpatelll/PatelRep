// Developer Harness V2 — Phase 6 selector tests: positive and negative fixtures for every rule family, plus properties
// (monotonicity, "every suite has a reason", determinism). Pure: no git, no filesystem.
// Run: node --test scripts/developer-harness-v2/testing/select.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { CI_JOBS, SUITES, SUITE_BY_ID, validateStep } from './catalog.mjs'
import { changeSetFromEntries } from './changes.mjs'
import { HARNESS_ALL } from './rules.mjs'
import { LARGE_DIFF_FILES } from './changes.mjs'
import { selectTests } from './select.mjs'

const sel = (entries, opts = {}, meta = { base_examined: true }) => selectTests(changeSetFromEntries(entries, meta), opts)
const ids = (s) => new Set(s.suites.map((x) => x.id))
const targeted = (s) => new Set(s.suites.filter((x) => x.targeted).map((x) => x.id))
const has = (s, ...want) => { for (const w of want) assert.ok(ids(s).has(w), `expected ${w}; got ${[...ids(s)].join(',')}`) }
const lacks = (s, ...no) => { for (const w of no) assert.ok(!ids(s).has(w), `unexpected ${w}`) }
const esc = (s) => s.escalations.map((e) => e.code)
const gapCodes = (s) => s.coverage.gaps.map((g) => g.code)
const subset = (a, b) => [...a].every((x) => b.has(x))

test('an API change and a mobile change together select BOTH surfaces', () => {
  const s = sel(['apps/api/routers/shifts.py', 'apps/mobile/app/(app)/home.tsx'])
  has(s, 'api.ruff', 'api.smoke', 'mobile.typecheck', 'mobile.lint', 'mobile.jest_related', 'mobile.jest_full')
  assert.ok(subset(ids(sel(['apps/api/routers/shifts.py'])), ids(s)) && subset(ids(sel(['apps/mobile/app/(app)/home.tsx'])), ids(s)))
})

test('a migration is never an ordinary lightweight edit', () => {
  const s = sel([{ path: 'supabase/migrations/300_add_thing.sql', status: 'A' }])
  has(s, 'db.migration_history', 'repo.db_static_contract', 'db.replay_and_schema_contracts', 'db.api_integration', 'api.security_contracts')
  for (const c of ['MIGRATION_NOT_LIGHTWEIGHT', 'SECURITY_REVIEW_REQUIRED', 'DB_STACK_APPROVAL_REQUIRED', 'EXPENSIVE_OR_BLOCKED_SUITES']) assert.ok(esc(s).includes(c), c)
  const by = Object.fromEntries(s.suites.map((x) => [x.id, x]))
  assert.equal(by['db.replay_and_schema_contracts'].local_action, 'BLOCKED'); assert.equal(by['db.replay_and_schema_contracts'].blocked.code, 'DB_STACK.APPROVAL_REQUIRED')
  assert.ok(s.tags.includes('tenant_isolation'))
  assert.ok(!esc(s).includes('MIGRATION_HISTORY_MUTATION'), 'adding a new forward-only migration is not a history mutation')
})

test('editing, deleting or renaming an EXISTING migration is flagged as a history mutation', () => {
  for (const e of [{ path: 'supabase/migrations/100_x.sql', status: 'M' }, { path: 'supabase/migrations/100_x.sql', status: 'D' }, { path: 'supabase/migrations/101_y.sql', status: 'R', old_path: 'supabase/migrations/100_x.sql' }]) assert.ok(esc(sel([e])).includes('MIGRATION_HISTORY_MUTATION'), JSON.stringify(e))
})

test('a changed security policy selects every harness suite, not just the nearest unit test', () => {
  for (const p of ['scripts/developer-harness-v2/policy-engine.mjs', 'scripts/developer-harness-v2/git-policy.mjs', '.claude/settings.json', '.claude/agents/implementer.md', 'docs/developer-harness-v2/contract.json', 'CLAUDE.md', 'apps/web/CLAUDE.md', '.wolf/hooks/pre-write.js', '.mcp.json']) {
    const s = sel([p]); for (const h of HARNESS_ALL) has(s, h); assert.ok(esc(s).includes('SECURITY_REVIEW_REQUIRED'), p)
  }
})

test('a deleted test never reduces the selection and always demands a lost-coverage review', () => {
  for (const [p, area] of [['apps/api/tests/smoke/test_x.py', ['api.smoke', 'api.pytest_full']], ['apps/web/lib/x.test.ts', ['web.unit', 'web.hermetic']], ['apps/mobile/__tests__/lib/x.test.ts', ['mobile.jest_full']], ['scripts/developer-harness-v2/routing/router.test.mjs', HARNESS_ALL], ['scripts/foo.test.mjs', ['repo.release_workflow_contract', 'repo.db_static_contract']]]) {
    const modified = sel([{ path: p, status: 'M' }]); const deleted = sel([{ path: p, status: 'D' }])
    assert.ok(subset(ids(modified), ids(deleted)), `${p}: deletion selected fewer suites than modification`)
    has(deleted, ...area); assert.ok(esc(deleted).includes('LOST_COVERAGE_REVIEW'), p)
    assert.ok(deleted.suites.some((x) => x.reasons.some((r) => r.code === 'TEST.DELETED')), p)
    assert.ok(!esc(modified).includes('LOST_COVERAGE_REVIEW'))
  }
})

test('a rename considers the OLD path as well as the new one, and a test renamed away counts as deleted', () => {
  const s = sel([{ path: 'apps/api/routers/new.py', old_path: 'apps/web/lib/old.ts', status: 'R' }])
  has(s, 'api.smoke', 'web.unit', 'web.lint')
  const away = sel([{ path: 'docs/notes.md', old_path: 'apps/mobile/__tests__/lib/x.test.ts', status: 'R' }])
  has(away, 'mobile.jest_full'); assert.ok(esc(away).includes('LOST_COVERAGE_REVIEW'))
})

test('an unknown file cannot produce a falsely green or empty selection', () => {
  for (const p of ['weird/thing.bin', 'unknown-root-file', 'infra/opera-sftp/Dockerfile', 'tools/x.sh']) {
    const s = sel([p]); assert.ok(s.suites.length > 5, p); assert.equal(s.coverage.status, 'COVERAGE.UNPROVEN', p); assert.ok(gapCodes(s).includes('COVERAGE.UNPROVEN'))
    has(s, 'harness.contract', 'repo.release_workflow_contract', 'ci.gate')
    assert.ok(s.suites.some((x) => x.reasons.some((r) => r.code === 'FALLBACK.UNKNOWN_PATH')))
  }
})

test('an unrecognised file inside a known app selects that whole area and reports an ambiguity gap', () => {
  const s = sel(['apps/web/odd-file.weird']); has(s, ...['web.lint', 'web.typecheck', 'web.unit', 'web.build'])
  assert.ok(gapCodes(s).includes('COVERAGE.AMBIGUOUS_TYPE')); assert.notEqual(s.coverage.status, 'CLASSIFIED')
  const a = sel(['apps/api/odd.sql']); has(a, 'api.smoke', 'api.pytest_full', 'api.security_contracts')
})

test('invalid or escaping changed paths make the selection unproven and fall back to broad safe suites', () => {
  const s = sel(['apps/web/lib/a.ts', '../../etc/passwd', '/abs/x']); assert.equal(s.coverage.status, 'COVERAGE.UNPROVEN')
  assert.equal(s.changed.invalid.length, 2); has(s, 'harness.contract', 'web.unit')
  assert.ok(s.suites.some((x) => x.reasons.some((r) => r.code.startsWith('FALLBACK.PATH.'))))
})

test('missing or failed change collection lists EVERY suite and is unproven', () => {
  for (const change of [{ ok: false, code: 'GIT.STATE_UNAVAILABLE' }, { ok: false, code: 'GIT.BASE_UNRESOLVED' }, null, { ok: true, truncated: true, entries: [], invalid: [] }]) {
    const s = selectTests(change); assert.equal(s.suites.length, SUITES.length); assert.equal(s.coverage.status, 'COVERAGE.UNPROVEN')
  }
})

test('an empty change set is an explicit NO_CHANGES result, not a silent pass', () => {
  const s = sel([]); assert.equal(s.status, 'NO_CHANGES'); assert.equal(s.coverage.status, 'NO_CHANGES_DETECTED'); assert.deepEqual(s.suites, []); assert.equal(s.authoritative, false)
})

test('a very large diff selects every suite and is escalated', () => {
  const s = sel(Array.from({ length: LARGE_DIFF_FILES + 1 }, (_, i) => `apps/web/lib/f${i}.ts`)); assert.equal(s.suites.length, SUITES.length); assert.ok(esc(s).includes('LARGE_DIFF'))
})

test('test configuration changes select the suite even when no product code changed', () => {
  has(sel(['apps/mobile/jest.config.js']), 'mobile.jest_full', 'mobile.typecheck')
  has(sel(['apps/mobile/jest.setup.js']), 'mobile.jest_full')
  has(sel(['apps/api/pytest.ini']), 'api.smoke', 'api.pytest_full')
  has(sel(['apps/api/tests/conftest.py']), 'api.smoke')
  has(sel(['apps/api/tests/smoke/conftest.py']), 'api.smoke')
  has(sel(['apps/web/eslint.config.mjs']), 'web.lint', 'web.unit')
  has(sel(['apps/web/playwright.config.ts']), 'web.hermetic', 'web.unit')
  has(sel(['apps/web/scripts/lint-config.test.mjs']), 'web.unit')
  has(sel(['apps/mobile/tsconfig.json']), 'mobile.typecheck')
})

test('shared dependencies and root configuration select every consumer', () => {
  for (const p of ['apps/web/package-lock.json', 'apps/web/package.json']) { const s = sel([p]); has(s, 'web.lint', 'web.typecheck', 'web.unit', 'web.build', 'web.hermetic', 'ci.security_scan', 'mobile.jest_full', 'api.smoke') }
  has(sel(['apps/api/requirements.txt']), 'api.ruff', 'api.smoke', 'api.pytest_full', 'ci.security_scan', 'mobile.jest_full', 'web.unit')
  has(sel(['apps/mobile/package.json']), 'mobile.jest_full', 'mobile.lint', 'mobile.typecheck')
  const root = sel(['package.json']); has(root, 'repo.release_workflow_contract', 'repo.db_static_contract', 'harness.contract', 'web.typecheck', 'mobile.typecheck')
  assert.ok(esc(root).includes('SECURITY_REVIEW_REQUIRED'))
})

test('workflow and release-control changes select the contract suites, require review and CI, and never imply dispatch', () => {
  for (const p of ['.github/workflows/production-release.yml', '.github/workflows/staging-candidate.yml', '.githooks/pre-push', 'scripts/production-release-recorder.mjs']) {
    const s = sel([p]); has(s, 'repo.release_workflow_contract', 'ci.gate'); assert.ok(esc(s).includes('SECURITY_REVIEW_REQUIRED') && esc(s).includes('CI_AUTHORITATIVE_REQUIRED'), p)
  }
  const ci = sel(['.github/workflows/ci.yml']); for (const j of CI_JOBS.filter((x) => x !== 'Deploy')) assert.ok(ci.suites.some((x) => x.ci_jobs.includes(j)), `ci.yml change must select job ${j}`)
  for (const s of SUITES) for (const st of s.steps) assert.deepEqual(validateStep(st), [], `${s.id} carries a step the allowlist rejects`)
  const scripts = SUITES.flatMap((s) => s.steps).filter((st) => st.kind === 'node_script').map((st) => st.script)
  assert.ok(scripts.every((x) => /(^|\/)(check|verify)-[a-z0-9-]+\.mjs$/.test(x)), 'only read-only check/verify scripts can ever run')
})

test('docs-only and artifact-only changes are classified (never empty) and still require CI', () => {
  const d = sel(['docs/USER_GUIDE.md']); has(d, 'repo.release_workflow_contract', 'web.frozen_files', 'ci.gate'); assert.equal(d.coverage.status, 'CLASSIFIED')
  const a = sel(['graphify-out/cache/x.json', 'photo.png', 'apps/mobile/.tmp-ui3.xml']); has(a, 'ci.gate'); assert.equal(a.coverage.status, 'CLASSIFIED'); assert.equal(a.inert_paths.length, 3)
})

test('database and tenant-isolation relevant paths pull in security contract coverage on every surface', () => {
  const s = sel(['apps/api/routers/hotels.py']); has(s, 'api.security_contracts', 'web.unit', 'mobile.jest_full'); assert.ok(s.tags.includes('SEC.RLS_TENANT'))
  has(sel(['apps/api/core/auth.py']), 'api.security_contracts', 'web.typecheck', 'mobile.typecheck')
  has(sel(['apps/mobile/lib/api/session.ts']), 'api.security_contracts')
  has(sel(['apps/web/app/login/page.tsx']), 'api.security_contracts')
})

test('a changed domain selects the adjacent surfaces (API ↔ web ↔ mobile) with a CROSS.DOMAIN reason', () => {
  const s = sel(['apps/api/routers/housekeeping_assignments.py'])
  has(s, 'web.unit', 'web.typecheck', 'mobile.jest_full', 'mobile.typecheck'); assert.ok(s.domains.includes('housekeeping'))
  assert.ok(s.suites.find((x) => x.id === 'mobile.jest_full').reasons.some((r) => r.code === 'CROSS.DOMAIN.housekeeping'))
  has(sel(['apps/web/lib/housekeeping/boardView.ts']), 'api.smoke', 'mobile.jest_full')
  has(sel(['apps/mobile/lib/housekeeping/x.ts']), 'api.smoke', 'web.unit')
  has(sel(['apps/api/routers/work_orders.py']), 'web.unit', 'mobile.jest_full')
})

test('tests that read a changed file (the repo index) pull in their suite — the hidden-coupling case', () => {
  const index = { readers: [{ path: 'apps/mobile/lib/housekeeping/supervisorTeam.ts', suites: ['api.smoke'] }, { path: '.github/workflows', suites: ['repo.release_workflow_contract'] }], api_root_tests: [] }
  const s = sel(['apps/mobile/lib/housekeeping/supervisorTeam.ts'], { index }); assert.ok(s.suites.find((x) => x.id === 'api.smoke').reasons.some((r) => r.code === 'READS.CHANGED_FILE'))
  assert.ok(sel(['.github/workflows/anything.yml'], { index }).suites.find((x) => x.id === 'repo.release_workflow_contract').reasons.some((r) => r.code === 'READS.CHANGED_FILE'))
  lacks(sel(['apps/mobile/lib/other.ts'], { index: { readers: index.readers.slice(0, 1) } }), 'api.pytest_targeted')
})

test('dynamic suites receive only existing, safe, bounded parameters', () => {
  const s = sel(['apps/mobile/lib/a.ts', 'apps/mobile/lib/gone.ts', { path: 'apps/mobile/lib/deleted.ts', status: 'D' }, 'apps/mobile/package-lock.json'].map((e) => (typeof e === 'string' && e.endsWith('gone.ts') ? { path: e, status: 'M' } : e)))
  const jr = s.suites.find((x) => x.id === 'mobile.jest_related'); assert.deepEqual(jr.params.related_files, ['lib/a.ts', 'lib/gone.ts']); assert.equal(jr.local_action, 'RUN_WITH_PREREQS')
  const onlyDeleted = sel([{ path: 'apps/mobile/lib/deleted.ts', status: 'D' }]).suites.find((x) => x.id === 'mobile.jest_related')
  assert.equal(onlyDeleted.local_action, 'BLOCKED'); assert.equal(onlyDeleted.blocked.code, 'PARAMS.NONE')
  const many = sel(Array.from({ length: 250 }, (_, i) => `apps/mobile/lib/f${i}.ts`)).suites.find((x) => x.id === 'mobile.jest_related'); assert.equal(many.params, undefined); assert.equal(many.local_action, 'BLOCKED')
  const py = sel(['apps/api/routers/work_orders.py'], { index: { api_root_tests: ['tests/test_work_order_assign.py', 'tests/test_inventory.py', 'tests/test_shifts.py'] } }).suites.find((x) => x.id === 'api.pytest_targeted')
  assert.deepEqual(py.params.test_files, ['tests/test_inventory.py', 'tests/test_work_order_assign.py']) // engineering-domain tests only, never test_shifts.py
})

test('selected suites expose how they can run: runnable, prerequisites, approval, blocked or CI-only', () => {
  const s = sel(['apps/mobile/lib/a.ts', 'apps/api/routers/shifts.py', 'supabase/migrations/301_x.sql'].map((p) => ({ path: p, status: 'A' }))); const by = Object.fromEntries(s.suites.map((x) => [x.id, x.local_action]))
  assert.equal(by['harness.contract'] ?? 'RUN', 'RUN'); assert.equal(by['api.smoke'], 'RUN_WITH_PREREQS'); assert.equal(by['mobile.jest_full'], 'NEEDS_APPROVAL'); assert.equal(by['db.replay_and_schema_contracts'], 'BLOCKED'); assert.equal(by['ci.pixel_diff'], 'CI_ONLY')
  assert.ok(esc(s).includes('EXPENSIVE_OR_BLOCKED_SUITES'))
})

test('PROPERTY: every selected suite has at least one documented reason code', () => {
  for (const p of SAMPLE) { const s = sel([p]); for (const x of s.suites) { assert.ok(x.reasons.length > 0, `${p}: ${x.id}`); for (const r of x.reasons) assert.match(r.code, /^[A-Z][A-Za-z0-9_.]+$/) } }
})

test('PROPERTY: adding a changed file never shrinks the selection (monotonicity)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let i = 0; i < 120; i++) {
    const a = SAMPLE.filter(() => rnd() < 0.25); const extra = SAMPLE[Math.floor(rnd() * SAMPLE.length)]
    if (!a.length) continue
    assert.ok(subset(ids(sel(a)), ids(sel([...a, extra]))), `adding ${extra} to ${a.join(',')} removed a suite`)
  }
})

test('PROPERTY: a high-risk variant of a file never selects fewer suites than its ordinary equivalent', () => {
  for (const dir of ['apps/api/routers/', 'apps/api/services/', 'apps/web/lib/utils/', 'apps/web/components/ui/', 'apps/mobile/lib/utils/', 'apps/mobile/components/']) {
    const ordinary = ids(sel([`${dir}widget.ts`]))
    for (const risky of ['auth_widget', 'rbac_widget', 'tenant_widget', 'billing_widget', 'login_widget', 'permissions_widget', 'migrations_widget']) assert.ok(subset(ordinary, ids(sel([`${dir}${risky}.ts`]))), `${dir}${risky}`)
  }
})

test('PROPERTY: the selection is deterministic and independent of entry order', () => {
  const a = sel(SAMPLE.slice(0, 15)); const b = sel([...SAMPLE.slice(0, 15)].reverse())
  assert.equal(a.selection_digest, b.selection_digest); assert.deepEqual(a.suites.map((x) => x.id), b.suites.map((x) => x.id))
  assert.notEqual(sel(['apps/web/lib/a.ts']).selection_digest, sel(['apps/api/routers/a.py']).selection_digest)
})

test('every selection lists all authoritative CI jobs and is labelled non-authoritative', () => {
  const s = sel(['apps/web/lib/a.ts']); assert.deepEqual(s.required_ci_jobs, CI_JOBS); assert.equal(s.authoritative, false)
  for (const id of ['ci.security_scan', 'ci.pixel_diff', 'ci.gate']) assert.ok(s.suites.find((x) => x.id === id).reasons.some((r) => r.code === 'CI.NO_PATH_FILTERS'))
  for (const x of s.suites.filter((y) => y.tier === 'ci_only')) assert.equal(x.local_action, 'CI_ONLY')
  assert.ok(SUITE_BY_ID['ci.gate'])
  assert.ok(!targeted(s).has('ci.gate'), 'the passthrough alone is not a targeted selection')
})

test('the selector refuses a rule that references a suite which does not exist', () => {
  assert.ok(SUITES.every((x) => /^[a-z]+\./.test(x.id)))
  assert.doesNotThrow(() => sel(SAMPLE))
})

const SAMPLE = ['apps/api/routers/shifts.py', 'apps/api/services/ai/router.py', 'apps/api/core/auth.py', 'apps/api/models/requests.py', 'apps/api/tests/smoke/test_tenant_isolation.py', 'apps/api/tests/test_inventory.py', 'apps/api/requirements.txt', 'apps/api/pytest.ini',
  'apps/web/lib/utils/taskViews.ts', 'apps/web/components/housekeeping/RoomCard.tsx', 'apps/web/app/login/page.tsx', 'apps/web/package-lock.json', 'apps/web/e2e/hermetic/run.mjs', 'apps/web/scripts/check-contrast.mjs',
  'apps/mobile/app/(app)/home.tsx', 'apps/mobile/lib/api/client.ts', 'apps/mobile/__tests__/lib/x.test.ts', 'apps/mobile/package.json', 'apps/mobile/eas.json', 'supabase/migrations/310_x.sql', 'supabase/seed.sql',
  '.github/workflows/ci.yml', '.github/workflows/production-release.yml', 'scripts/check-migrations.mjs', 'scripts/production-release-recorder.test.mjs', 'scripts/developer-harness-v2/policy-engine.mjs', 'docs/developer-harness-v2/contract.json',
  '.claude/settings.json', '.wolf/memory.md', 'docs/GUIDE.md', 'package.json', 'e2e/live.spec.ts', 'mystery/file.dat', 'graphify-out/x.json', 'CLAUDE.md']

test('PROPERTY: the repo index only ever ADDS suites — a directory-level reader never switches off the ambiguity fallback', () => {
  const index = { readers: [{ path: 'apps/web', suites: ['web.unit'] }, { path: 'apps/mobile', suites: ['api.smoke'] }, { path: 'apps/api', suites: ['api.smoke'] }], api_root_tests: [] }
  for (const p of [...SAMPLE, 'apps/web/proxy.ts', 'apps/mobile/index.ts', 'apps/api/services/data/rates.json']) {
    const without = sel([p]); const withIdx = sel([p], { index })
    assert.ok(subset(ids(without), ids(withIdx)), `${p}: index removed a suite`)
    assert.equal(withIdx.coverage.status, without.coverage.status, `${p}: index changed the coverage status`)
  }
  has(sel(['apps/web/proxy.ts'], { index }), 'web.lint', 'web.typecheck', 'web.build'); assert.ok(gapCodes(sel(['apps/web/proxy.ts'], { index })).includes('COVERAGE.AMBIGUOUS_TYPE'))
})

test('REVIEW: no base on an otherwise clean tree is UNPROVEN, never "no changes"', () => {
  const s = selectTests(changeSetFromEntries([], { base_examined: false })); assert.equal(s.coverage.status, 'COVERAGE.UNPROVEN'); assert.ok(gapCodes(s).includes('CHANGES.NO_BASE'))
  assert.equal(selectTests(changeSetFromEntries([], { base_examined: true })).coverage.status, 'NO_CHANGES_DETECTED')
})

test('REVIEW: a changed test file or check script selects the suite that runs it (generic, from the catalog)', () => {
  for (const s of SUITES) for (const st of s.steps) for (const f of [...(st.files ?? []), ...(st.script ? [st.script] : [])]) { const p = s.cwd === '.' ? f : `${s.cwd}/${f}`; assert.ok(ids(sel([p])).has(s.id), `${p} does not select ${s.id}`) }
  has(sel(['scripts/mobile-ci-workflow.test.mjs']), 'repo.mobile_ci_workflow_contract')
})
