/**
 * Reviewed staging migration preview: refusal paths, the single happy path, and the bindings that keep later candidates
 * honest. Pure fakes for the database and the Supabase CLI (the real-CLI path is staging-migration-apply-cli-contract).
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadMigrations, sha256 } from './check-migrations.mjs'
import { PINNED_SUPABASE_CLI_VERSION } from './production-migration-apply-workspace.mjs'
import { optionsFromEnvironment, runPlan } from './staging-migration-apply-workspace.mjs'
import { planStagingMigrations } from './staging-migration-plan.mjs'
import { applyPreview, planPreview, verifyAppliedState, verifyRequest } from './staging-reviewed-migration-preview.mjs'
import {
  APPROVAL_ENVIRONMENT,
  MAX_APPROVAL_WINDOW_DAYS,
  REVIEWED_REGISTRY_PATH,
  assertApprovalEnvironmentProtection,
  assertRunApproved,
  loadReviewedRegistry,
  parseFileDigests,
  validateReviewedRegistry,
  verifyReviewedBindings,
} from './staging-reviewed-migrations.mjs'

const STAGING_DB = 'postgresql://postgres:s3cr3t@db.stagingref.supabase.co:5432/postgres'
const HEAD = 'a'.repeat(40)
const NOW = Date.parse('2026-11-15T12:00:00Z')
const FILES = {
  '001_a.sql': 'create table a(id int);\n',
  '240_h1.sql': 'create table h1(id int);\n',
  '241_gw.sql': 'alter table h1 drop constraint if exists h1_old;\nalter table h1 add constraint h1_new check (id > 0);\n',
  '242_op.sql': 'create or replace function op() returns int language sql as $$ select 1 $$;\n',
  '243_rpc.sql': 'create or replace function rpc() returns int language sql as $$ select 2 $$;\n',
}
const APPROVED = ['241_gw.sql', '242_op.sql', '243_rpc.sql']
const digests = (files = FILES) => APPROVED.map((file) => `${file}=${sha256(files[file])}`).join(',')
const PROTECTED_ENVIRONMENT = { name: APPROVAL_ENVIRONMENT, can_admins_bypass: false, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false }, protection_rules: [{ type: 'required_reviewers', reviewers: ['maintainer'] }] }
const LIVE_PR = { number: 217, state: 'open', base_ref: 'main', head_ref: 'feat/h2', head_sha: HEAD, head_repo: 'owner/repo' }
const APPROVALS = [{ state: 'approved', user: { login: 'maintainer' }, environments: [{ name: APPROVAL_ENVIRONMENT }] }]

function entry(overrides = {}) {
  return {
    id: 'h2-preview', repository: 'owner/repo', pr_number: 217, head_ref: 'feat/h2', head_sha: HEAD, base_staging_version: '240',
    approved_at: '2026-11-14T00:00:00Z', expires_at: '2026-11-28T00:00:00Z', review_document: 'docs/staging-previews/h2.md',
    files: APPROVED.map((filename) => ({ filename, sha256: sha256(FILES[filename]) })),
    preconditions: [{ name: 'old_constraint_present', probe: "select exists (select 1 from pg_constraint where conname = 'h1_old')" }],
    postconditions: [{ name: 'new_constraint_present', probe: "select exists (select 1 from pg_constraint where conname = 'h1_new')" }],
    ...overrides,
  }
}

function harness({ files = FILES, registryEntries = [entry()], remote = ['001', '240'], probe = () => 't', cli = {}, live = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'stg-preview-unit-'))
  const candidate = join(root, 'candidate-migrations')
  mkdirSync(candidate)
  for (const [file, sql] of Object.entries(files)) writeFileSync(join(candidate, file), sql)
  writeFileSync(join(root, 'config.toml'), 'project_id = "x"\n')
  writeFileSync(join(root, 'coverage.json'), JSON.stringify({ schema_version: 1, environment: 'staging', files: [] }))
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ schema_version: 1, environment: 'staging', entries: registryEntries }))
  const runnerTemp = join(root, 'runner')
  mkdirSync(runnerTemp)
  const state = { remote: [...remote], calls: [] }
  const rows = () => state.remote.map((version) => ({ version, name: Object.keys(FILES).find((file) => file.startsWith(`${version}_`))?.slice(4, -4) ?? 'x' }))
  const options = {
    databaseUrl: STAGING_DB, runnerTemp, migrationsDirectory: candidate, configPath: join(root, 'config.toml'),
    coveragePath: join(root, 'coverage.json'), reviewedRegistryPath: join(root, 'registry.json'),
    target: { databaseUrl: STAGING_DB, supabaseUrl: 'https://stagingref.supabase.co', expectedDatabaseHost: 'db.stagingref.supabase.co', expectedSupabaseHost: 'stagingref.supabase.co', productionDatabaseHost: 'db.prodref.supabase.co', productionSupabaseHost: 'prodref.supabase.co' },
  }
  const deps = {
    log: () => {},
    assertTarget: () => state.calls.push('guard'),
    probeRunner: (url, sql) => { state.calls.push('probe'); return probe(sql, state) },
    evaluateLive: (allowPending) => {
      state.calls.push('evaluate')
      if (live.evaluate) return live.evaluate(state, rows, candidate)
      const migrations = loadMigrations(candidate)
      const local = migrations.map((migration) => migration.version)
      const missing = local.filter((version) => !state.remote.includes(version))
      const unknown = state.remote.filter((version) => !local.includes(version))
      const status = unknown.length ? 'BLOCKED' : missing.length ? (allowPending ? 'PENDING' : 'DRIFT') : 'CLEAN'
      return { remoteRows: rows(), migrations, evaluation: { status, missingOnRemote: missing, unknownOnRemote: unknown, duplicateCoverage: { incompleteGroups: [], groups: [] } } }
    },
    runSupabase: (args, { cwd }) => {
      const label = args[0] === '--version' ? '--version' : `${args[0]} ${args[1]}${args.includes('--dry-run') ? ' --dry-run' : ''}`
      state.calls.push(label)
      const handled = cli[label]?.(args, { cwd, state })
      if (handled) return handled
      if (args[0] === '--version') return { status: 0, stdout: `${PINNED_SUPABASE_CLI_VERSION}\n`, stderr: '' }
      if (args[1] === 'fetch') {
        mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true })
        for (const row of rows()) writeFileSync(join(cwd, 'supabase', 'migrations', `${row.version}_${row.name}.sql`), '-- mirrored history\n')
        return { status: 0, stdout: '', stderr: '' }
      }
      const pending = readdirSync(join(cwd, 'supabase', 'migrations')).filter((file) => !state.remote.some((version) => file.startsWith(`${version}_`))).sort()
      if (args.includes('--dry-run')) return { status: 0, stdout: '', stderr: pending.length ? `Would push these migrations:\n${pending.map((file) => ` • ${file}`).join('\n')}\n` : 'Remote database is up to date.\n' }
      for (const file of pending) state.remote.push(file.slice(0, 3))
      return { status: 0, stdout: '', stderr: pending.map((file) => `Applying migration ${file}...`).join('\n') }
    },
  }
  const request = (overrides = {}) => ({
    id: 'h2-preview', repository: 'owner/repo', prNumber: '217', headSha: HEAD, fileDigests: digests(files),
    candidateCheckoutSha: HEAD, livePullRequest: JSON.stringify(LIVE_PR), approvalEnvironment: JSON.stringify(PROTECTED_ENVIRONMENT),
    runApprovals: JSON.stringify(APPROVALS), ...overrides,
  })
  const cleanup = () => rmSync(root, { recursive: true, force: true })
  return { root, runnerTemp, options, deps, state, request, cleanup }
}

const pushed = (h) => h.state.calls.includes('db push')
const leftovers = (h) => readdirSync(h.runnerTemp)

// ---- the one happy path --------------------------------------------------------------------------------------------

test('plan is read-only and proposes exactly the approved files; apply pushes them once; verify-applied proves the result', () => {
  const h = harness({ probe: (sql, state) => (sql.includes("'h1_new'") ? (state.remote.includes('241') ? 't' : 'f') : 't') })
  assert.deepEqual(planPreview({ request: h.request(), options: h.options, deps: h.deps, now: NOW, log: () => {} }).pending, APPROVED)
  assert.ok(!pushed(h), 'plan never pushes')
  assert.deepEqual(h.state.remote, ['001', '240'])
  assert.deepEqual(applyPreview({ request: h.request(), options: h.options, deps: h.deps, now: NOW, log: () => {} }).applied, APPROVED)
  assert.equal(h.state.calls.filter((call) => call === 'db push').length, 1, 'exactly one real push')
  assert.ok(h.state.calls.indexOf('probe') < h.state.calls.indexOf('db push'), 'preconditions run before the push')
  assert.deepEqual(verifyAppliedState({ request: h.request(), options: h.options, deps: h.deps, now: NOW, log: () => {} }).status, 'CLEAN')
  assert.deepEqual(leftovers(h), [], 'no workspace is left behind')
  h.cleanup()
})

// ---- refusals: every one happens before any push -------------------------------------------------------------------

function refuses(name, setup, pattern, command = applyPreview) {
  test(`REFUSED before mutation: ${name}`, () => {
    const h = harness(setup.harness)
    assert.throws(() => command({ request: h.request(setup.request), options: { ...h.options, ...setup.options }, deps: { ...h.deps, ...setup.deps?.(h) }, now: setup.now ?? NOW, log: () => {} }), pattern)
    assert.ok(!pushed(h), 'the mutating push never runs')
    assert.deepEqual(h.state.remote, setup.expectedRemote ?? setup.harness?.remote ?? ['001', '240'], 'staging history untouched by this run')
    assert.deepEqual(leftovers(h), [])
    h.cleanup()
  })
}

refuses('an unapproved candidate (no registry entry for the id)', { request: { id: 'not-reviewed' } }, /no reviewed registry entry "not-reviewed"/)
refuses('an empty registry approves nothing', { harness: { registryEntries: [] } }, /no reviewed registry entry/)
refuses('a modified migration (hash differs from the review)', {
  harness: { files: { ...FILES, '243_rpc.sql': `${FILES['243_rpc.sql']}grant execute on function rpc() to anon;\n` } },
  request: { fileDigests: digests() },
}, /243_rpc\.sql differs from its reviewed digest/)
refuses('restated digests that do not equal the review', { request: { fileDigests: digests().replace(/=([0-9a-f])/, '=0') } }, /restated file digests do not equal/)
refuses('restated digests that omit an approved file', { request: { fileDigests: digests().split(',').slice(0, 2).join(',') } }, /restated file digests do not equal/)
refuses('the wrong commit SHA in the dispatch', { request: { headSha: 'b'.repeat(40) } }, /requested head SHA is not the reviewed head SHA/)
refuses('a candidate checkout at another commit', { request: { candidateCheckoutSha: 'c'.repeat(40) } }, /candidate checkout is not the reviewed head SHA/)
refuses('the PR head moved after review', { request: { livePullRequest: JSON.stringify({ ...LIVE_PR, head_sha: 'd'.repeat(40) }) } }, /PR head moved since review/)
refuses('PR substitution (another PR number)', { request: { prNumber: '218' } }, /PR #218 is not the reviewed PR #217/)
refuses('branch substitution', { request: { livePullRequest: JSON.stringify({ ...LIVE_PR, head_ref: 'feat/other' }) } }, /not the reviewed branch/)
refuses('fork substitution', { request: { livePullRequest: JSON.stringify({ ...LIVE_PR, head_repo: 'attacker/repo' }) } }, /same repository/)
refuses('a closed or merged PR', { request: { livePullRequest: JSON.stringify({ ...LIVE_PR, state: 'closed' }) } }, /is closed, not open/)
refuses('a PR not targeting main', { request: { livePullRequest: JSON.stringify({ ...LIVE_PR, base_ref: 'release' }) } }, /must target main/)
refuses('another repository', { request: { repository: 'other/repo' } }, /repository differs/)
refuses('an expired approval window', { now: Date.parse('2026-11-28T00:00:00Z') }, /outside its approval window/)
refuses('an approval window that has not started', { now: Date.parse('2026-11-13T23:59:59Z') }, /outside its approval window/)
refuses('a missing approval environment', { request: { approvalEnvironment: JSON.stringify({ name: null }) } }, /staging-migration-approval does not exist/)
refuses('an approval environment without required reviewers', { request: { approvalEnvironment: JSON.stringify({ ...PROTECTED_ENVIRONMENT, protection_rules: [{ type: 'branch_policy', reviewers: [] }] }) } }, /must require at least one reviewer/)
refuses('an approval environment admins can bypass', { request: { approvalEnvironment: JSON.stringify({ ...PROTECTED_ENVIRONMENT, can_admins_bypass: true }) } }, /must not allow administrators to bypass/)
refuses('an approval environment open to any branch', { request: { approvalEnvironment: JSON.stringify({ ...PROTECTED_ENVIRONMENT, deployment_branch_policy: null }) } }, /restricted to protected branches/)
refuses('a missing reviewer approval on the run', { request: { runApprovals: '[]' } }, /no approval of staging-migration-approval by a configured required reviewer/)
refuses('an approval for a different environment (wrong GitHub environment)', { request: { runApprovals: JSON.stringify([{ ...APPROVALS[0], environments: [{ name: 'staging' }] }]) } }, /no approval of staging-migration-approval/)
refuses('an approval by someone who is not a configured required reviewer', { request: { runApprovals: JSON.stringify([{ ...APPROVALS[0], user: { login: 'drive-by' } }]) } }, /by a configured required reviewer/)
refuses('a rejected review on the run', { request: { runApprovals: JSON.stringify([...APPROVALS, { state: 'rejected', user: { login: 'other' }, environments: [{ name: APPROVAL_ENVIRONMENT }] }]) } }, /rejected environment review/)
refuses('a production database target', {
  options: { target: { databaseUrl: 'postgresql://postgres:x@db.prodref.supabase.co:5432/postgres', supabaseUrl: 'https://prodref.supabase.co', expectedDatabaseHost: 'db.stagingref.supabase.co', expectedSupabaseHost: 'stagingref.supabase.co', productionDatabaseHost: 'db.prodref.supabase.co', productionSupabaseHost: 'prodref.supabase.co' } },
  deps: () => ({ assertTarget: undefined }),
}, /not the expected staging database host/)
refuses('missing production denylist hosts', {
  options: { target: { databaseUrl: STAGING_DB, supabaseUrl: 'https://stagingref.supabase.co', expectedDatabaseHost: 'db.stagingref.supabase.co', expectedSupabaseHost: 'stagingref.supabase.co', productionDatabaseHost: '', productionSupabaseHost: '' } },
  deps: () => ({ assertTarget: undefined }),
}, /production host allowlists .* are required/)
refuses('unsafe SQL outside the approved set (an extra destructive pending file)', {
  harness: { files: { ...FILES, '244_extra.sql': 'drop table h1;\n' } },
}, /pending migrations .* are not exactly the approved set/)
refuses('an extra non-destructive pending file (the set must be exact)', {
  harness: { files: { ...FILES, '244_extra.sql': 'create table extra(id int);\n' } },
}, /are not exactly the approved set/)
refuses('migration history mismatch (staging is behind the reviewed base)', { harness: { remote: ['001'], files: FILES } }, /history head is 1, not the reviewed base 240/)
refuses('migration history mismatch (unknown version on staging)', { harness: { remote: ['001', '240', '250'] } }, /history head is 250/)
refuses('replay of already-applied approved migrations', { harness: { remote: ['001', '240', '241', '242', '243'] } }, /history head is 243, not the reviewed base 240/)
refuses('unexpected staging schema drift (a precondition is false)', { harness: { probe: () => 'f' } }, /probe\(s\) not satisfied on staging: old_constraint_present/)
refuses('a probe that cannot run', { harness: { probe: () => { throw new Error('connection refused') } } }, /unable to run read-only probe old_constraint_present/)
refuses('failure before apply: the CLI dry run proposes something else', {
  harness: { cli: { 'db push --dry-run': () => ({ status: 0, stdout: '', stderr: 'Would push these migrations:\n • 241_gw.sql\n' }) } },
}, /dry run proposes \["241_gw\.sql"\] but the independent plan is/)
refuses('failure before apply: the wrong Supabase CLI version', {
  harness: { cli: { '--version': () => ({ status: 0, stdout: '2.75.0\n', stderr: '' }) } },
}, /must be exactly 2\.112\.0/)
refuses('a concurrent staging migration changes history while the workspace is built', {
  harness: { cli: { 'migration fetch': (args, { cwd, state }) => { state.remote.push('244'); mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true }); return { status: 0, stdout: '', stderr: '' } } } },
  expectedRemote: ['001', '240', '244'], // written by the simulated concurrent writer, never by this run
}, /Unknown on staging: 244|changed while the apply workspace was being built/)

test('REFUSED: plan (read-only) shares every request check with apply', () => {
  const h = harness()
  assert.throws(() => planPreview({ request: h.request({ headSha: 'b'.repeat(40) }), options: h.options, deps: h.deps, now: NOW, log: () => {} }), /requested head SHA/)
  assert.ok(!h.state.calls.includes('db push --dry-run'), 'no CLI call happens for a refused request')
  h.cleanup()
})

test('verify-request needs no database and refuses before any database call', () => {
  const h = harness()
  verifyRequest({ request: h.request(), migrationsDirectory: h.options.migrationsDirectory, registryPath: h.options.reviewedRegistryPath, now: NOW })
  assert.deepEqual(h.state.calls, [], 'no target, probe, history or CLI access')
  h.cleanup()
})

// ---- failure during and after apply --------------------------------------------------------------------------------

test('failure during apply: the push fails, the error reports exactly which approved files staging now records', () => {
  const h = harness({
    cli: { 'db push': (args, { state }) => { state.remote.push('241'); return { status: 1, stdout: '', stderr: `Applying migration 241_gw.sql...\nApplying migration 242_op.sql...\nERROR: boom ${STAGING_DB}` } } },
  })
  assert.throws(() => applyPreview({ request: h.request(), options: h.options, deps: h.deps, now: NOW, log: () => {} }), (error) => {
    assert.match(error.message, /db push failed with status 1/)
    assert.match(error.message, /Approved files recorded on staging after the failure: 241_gw\.sql\./)
    assert.match(error.message, /never reset or repair/)
    assert.doesNotMatch(error.message, /s3cr3t/, 'credentials are redacted')
    return true
  })
  assert.deepEqual(leftovers(h), [])
  // A retry cannot silently finish the job: the base moved, so a NEW review (with a new base) is required.
  assert.throws(() => applyPreview({ request: h.request(), options: h.options, deps: h.deps, now: NOW, log: () => {} }), /history head is 241, not the reviewed base 240/)
  h.cleanup()
})

test('post-apply verification failure: a false postcondition fails the run', () => {
  const h = harness({ remote: ['001', '240', '241', '242', '243'], probe: () => 'f' })
  assert.throws(() => verifyAppliedState({ request: h.request(), options: h.options, deps: h.deps, now: NOW, log: () => {} }), /probe\(s\) not satisfied on staging: new_constraint_present/)
  h.cleanup()
})

test('post-apply verification failure: history not CLEAN (an approved file missing) fails the run', () => {
  const h = harness({ remote: ['001', '240', '241', '242'] })
  assert.throws(() => verifyAppliedState({ request: h.request(), options: h.options, deps: h.deps, now: NOW, log: () => {} }), /drift status is DRIFT, not CLEAN/)
  h.cleanup()
})

test('post-apply verification failure: a version recorded under another name fails the run', () => {
  const h = harness({ remote: ['001', '240', '241', '242', '243'], live: { evaluate: (state, rows, candidate) => ({ remoteRows: rows().map((row) => (row.version === '242' ? { ...row, name: 'renamed' } : row)), migrations: loadMigrations(candidate), evaluation: { status: 'CLEAN', missingOnRemote: [], unknownOnRemote: [], duplicateCoverage: { incompleteGroups: [], groups: [] } } }) } })
  assert.throws(() => verifyAppliedState({ request: h.request(), options: h.options, deps: h.deps, now: NOW, log: () => {} }), /records version 242 as renamed, not op/)
  h.cleanup()
})

// ---- bindings: later candidates (normal Staging Candidate path) ----------------------------------------------------

test('a later candidate whose copy of an applied, reviewed file changed is refused by the normal staging plan', () => {
  const changed = { ...FILES, '242_op.sql': 'create or replace function op() returns int language sql as $$ select 42 $$;\n' }
  const h = harness({ files: changed, remote: ['001', '240', '241', '242', '243'] })
  const options = { ...h.options }
  assert.throws(() => runPlan(options, h.deps), /242_op\.sql was applied to staging by reviewed preview h2-preview.*NEW forward migration/s)
  h.cleanup()
  const same = harness({ remote: ['001', '240', '241', '242', '243'] })
  assert.deepEqual(runPlan(same.options, same.deps).pending, [], 'an identical candidate verifies normally against the applied history')
  same.cleanup()
})

test('bindings ignore reviewed files staging has not applied yet', () => {
  const registry = validateReviewedRegistry({ schema_version: 1, environment: 'staging', entries: [entry()] })
  verifyReviewedBindings(registry, { remoteRows: [{ version: '240' }], migrations: [{ filename: '241_gw.sql', version: '241', content: 'changed' }] })
})

// ---- the normal Staging Candidate path is unchanged ----------------------------------------------------------------

test('without a reviewed allowance the planner still refuses every destructive pending migration', () => {
  const migrations = Object.entries(FILES).map(([filename, content]) => ({ filename, version: filename.slice(0, 3), content }))
  const evaluation = { status: 'PENDING', missingOnRemote: ['241', '242', '243'], unknownOnRemote: [], duplicateCoverage: { incompleteGroups: [] } }
  assert.throws(() => planStagingMigrations({ evaluation, migrations }), /Refusing to auto-apply destructive pending migration\(s\) to persistent staging: 241_gw\.sql/)
  const h = harness()
  assert.throws(() => runPlan(h.options, h.deps), /destructive pending migration\(s\).*241_gw\.sql/s, 'the Staging Candidate entry point (no allowance) refuses the same files')
  h.cleanup()
})

test('the reviewed allowance is never sourced from the environment or the Staging Candidate entry points', () => {
  const options = optionsFromEnvironment({ STAGING_SUPABASE_DB_URL: STAGING_DB, PREVIEW_ID: 'h2-preview', REVIEWED_MIGRATIONS: '241_gw.sql' })
  assert.equal(options.reviewedMigrations, undefined)
  assert.equal(options.reviewedRegistryPath, REVIEWED_REGISTRY_PATH)
  const planCli = readFileSync('scripts/staging-migration-plan.mjs', 'utf8')
  assert.match(planCli, /const plan = planStagingMigrations\(\{ evaluation, migrations \}\);/, 'the planner CLI passes no allowance')
  const workspace = readFileSync('scripts/staging-migration-apply-workspace.mjs', 'utf8')
  assert.doesNotMatch(workspace, /reviewedMigrations\s*:/, 'the workspace never constructs an allowance itself')
  assert.doesNotMatch(readFileSync('.github/workflows/staging-candidate.yml', 'utf8'), /staging-reviewed-migration-preview|PREVIEW_/)
  assert.doesNotMatch(readFileSync('.github/workflows/staging-db-migrate.yml', 'utf8'), /staging-reviewed-migration-preview|PREVIEW_/)
})

test('a malformed allowance is refused rather than ignored', () => {
  const evaluation = { status: 'PENDING', missingOnRemote: ['241'], unknownOnRemote: [], duplicateCoverage: { incompleteGroups: [] } }
  const migrations = [{ filename: '241_gw.sql', version: '241', content: FILES['241_gw.sql'] }]
  assert.throws(() => planStagingMigrations({ evaluation, migrations, reviewed: { id: 'x', files: new Map() } }), /allowance is malformed/)
  assert.throws(() => planStagingMigrations({ evaluation, migrations, reviewed: { id: 'x', files: { '241_gw.sql': 'y' } } }), /allowance is malformed/)
})

// ---- registry validation -------------------------------------------------------------------------------------------

const invalid = (name, mutate, pattern) => test(`registry rejects ${name}`, () => {
  const candidate = entry()
  mutate(candidate)
  assert.throws(() => validateReviewedRegistry({ schema_version: 1, environment: 'staging', entries: [candidate] }), pattern)
})
invalid('a probe with a statement separator', (e) => { e.preconditions[0].probe = 'select true; delete from agent_runs' }, /single read-only SELECT/)
invalid('a probe that is not a SELECT', (e) => { e.postconditions[0].probe = 'update agent_runs set state = 1' }, /single read-only SELECT/)
invalid('a probe that terminates sessions', (e) => { e.preconditions[0].probe = 'select pg_terminate_backend(1)' }, /a read-only probe never needs/)
invalid('a probe that writes through a CTE', (e) => { e.preconditions[0].probe = 'select 1 from (delete from t returning 1) x' }, /a read-only probe never needs/)
invalid('an approval window longer than the maximum', (e) => { e.expires_at = '2026-12-31T00:00:00Z' }, new RegExp(`at most ${MAX_APPROVAL_WINDOW_DAYS} days`))
invalid('a reversed approval window', (e) => { e.expires_at = '2026-11-01T00:00:00Z' }, /approval window must be positive/)
invalid('main as the reviewed head branch', (e) => { e.head_ref = 'main' }, /head_ref is invalid/)
invalid('an abbreviated head SHA', (e) => { e.head_sha = 'abc1234' }, /full 40-hex commit SHA/)
invalid('an uppercase or short digest', (e) => { e.files[0].sha256 = 'ABC' }, /lowercase SHA-256/)
invalid('files older than the base', (e) => { e.base_staging_version = '241' }, /newer than base_staging_version/)
invalid('an unknown key (no open-ended switches)', (e) => { e.allow_destructive = true }, /must have exactly the keys/)
invalid('an entry with no files', (e) => { e.files = [] }, /at least one file/)
invalid('an entry with no postconditions', (e) => { e.postconditions = [] }, /at least one postcondition/)
test('registry rejects one file approved by two entries', () => {
  assert.throws(() => validateReviewedRegistry({ schema_version: 1, environment: 'staging', entries: [entry(), entry({ id: 'second-preview' })] }), /approved by more than one entry/)
})
test('restated digests must be well formed and unique', () => {
  assert.throws(() => parseFileDigests(''), /file_digests is empty/)
  assert.throws(() => parseFileDigests('241_gw.sql=xyz'), /malformed or duplicated/)
  assert.throws(() => parseFileDigests(`241_gw.sql=${'a'.repeat(64)},241_gw.sql=${'a'.repeat(64)}`), /malformed or duplicated/)
})

// ---- the committed registry on this branch -------------------------------------------------------------------------

test('the committed registry is valid, single-entry, short-lived, and pins exact files and a full head SHA', () => {
  const registry = loadReviewedRegistry(REVIEWED_REGISTRY_PATH)
  for (const item of registry.entries) {
    assert.match(item.head_sha, /^[0-9a-f]{40}$/)
    assert.ok(Date.parse(item.expires_at) - Date.parse(item.approved_at) <= MAX_APPROVAL_WINDOW_DAYS * 86_400_000)
    assert.ok(readFileSync(item.review_document, 'utf8').includes(item.head_sha), 'the review document names the exact head SHA')
    for (const file of item.files) assert.ok(readFileSync(item.review_document, 'utf8').includes(file.sha256), `the review document lists ${file.filename}'s digest`)
  }
})

test('approval helpers: protection and run approval evidence', () => {
  assertApprovalEnvironmentProtection(PROTECTED_ENVIRONMENT)
  assert.deepEqual(assertRunApproved(APPROVALS, PROTECTED_ENVIRONMENT), ['maintainer'])
})
