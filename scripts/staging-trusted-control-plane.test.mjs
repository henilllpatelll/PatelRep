import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import {
  CANDIDATE_MIGRATIONS_ENV,
  PRIVILEGED_STAGING_FILES,
  TRUSTED_CHECKOUT_DIRECTORY,
  assertTrustedControlPlane,
  trustedControlPlaneRequired,
} from './staging-trusted-control-plane.mjs'
import { optionsFromEnvironment } from './staging-migration-apply-workspace.mjs'

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-C', cwd, ...args], {
  encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'],
}).trim()
const temporary = []
const scratch = () => { const directory = mkdtempSync(join(tmpdir(), 'trusted-cp-')); temporary.push(directory); return directory }
test.after(() => { for (const directory of temporary) rmSync(directory, { recursive: true, force: true }) })

const DRIVER = 'scripts/staging-migration-apply-workspace.mjs'
const TARGET_GUARD = 'scripts/staging-target-guard.mjs'

/** A throwaway "main" repository holding privileged scripts + registries, and the commit the workflow would run at. */
function makeRepository(parent, name, { guardSource = 'export const guard = "trusted"\n' } = {}) {
  const root = join(parent, name)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'supabase'), { recursive: true })
  writeFileSync(join(root, DRIVER), 'export const driver = "trusted"\n')
  writeFileSync(join(root, TARGET_GUARD), guardSource)
  writeFileSync(join(root, 'supabase/staging-duplicate-coverage.json'), '{"files":[]}\n')
  writeFileSync(join(root, 'supabase/migration-manifest.json'), '{"migrations":{}}\n')
  writeFileSync(join(root, 'supabase/config.toml'), 'project_id = "x"\n')
  git(root, 'init', '-q')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'main')
  return { root, sha: git(root, 'rev-parse', 'HEAD') }
}

function makeCandidateMigrations(parent, files = { '232_new.sql': 'alter table a add column b int;\n' }) {
  const directory = join(parent, 'candidate-workspace', 'supabase', 'migrations')
  mkdirSync(directory, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content)
  return directory
}

const actionsEnvironment = (sha, extra = {}) => ({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_WORKFLOW: 'Staging Candidate', ...extra })
const assertion = (trusted, env, extra = {}) => assertTrustedControlPlane({
  env, scriptDirectory: join(trusted.root, 'scripts'), trustedRoot: trusted.root, ...extra,
})

test('enforced inside GitHub Actions only; the guard module is a pinned privileged file', () => {
  assert.equal(trustedControlPlaneRequired({ GITHUB_ACTIONS: 'true' }), true)
  assert.equal(trustedControlPlaneRequired({}), false)
  assert.ok(PRIVILEGED_STAGING_FILES.includes('scripts/staging-trusted-control-plane.mjs'))
})

test('accepts the exact trusted workflow commit on main with a distinct, regular-file candidate migrations directory', () => {
  const parent = scratch()
  const trusted = makeRepository(parent, '.trusted-control-plane')
  const candidate = makeCandidateMigrations(parent)
  const result = assertion(trusted, actionsEnvironment(trusted.sha), { candidateMigrationsDirectory: candidate, requireCandidate: true })
  assert.equal(result.head, trusted.sha)
  assert.ok(result.candidate)
})

const refusing = (name, mutate, pattern) => test(`HARD FAIL: ${name}`, (t) => {
  const parent = scratch()
  const trusted = makeRepository(parent, '.trusted-control-plane')
  const context = { parent, trusted, candidate: makeCandidateMigrations(parent), env: actionsEnvironment(trusted.sha), options: {}, skip: (reason) => t.skip(reason) }
  mutate(context)
  if (context.skipped) return
  assert.throws(() => assertion(trusted, context.env, { candidateMigrationsDirectory: context.candidate, requireCandidate: true, ...context.options }), pattern)
})

refusing('workflow definition not from main', (c) => { c.env.GITHUB_REF = 'refs/heads/feature/x' }, /must come from refs\/heads\/main/)
refusing('workflow definition from a pull request ref', (c) => { c.env.GITHUB_REF = 'refs/pull/195/merge' }, /must come from refs\/heads\/main/)
refusing('GITHUB_SHA is not a full commit SHA', (c) => { c.env.GITHUB_SHA = 'main' }, /not a full commit SHA/)
refusing('trusted checkout is not at the workflow commit', (c) => { c.env.GITHUB_SHA = '0'.repeat(40) }, /not the workflow commit/)
refusing('a modified privileged script in the trusted tree', (c) => { writeFileSync(join(c.trusted.root, TARGET_GUARD), 'export const guard = "neutered"\n') }, /modified tracked files/)
refusing('a modified coverage registry in the trusted tree', (c) => { writeFileSync(join(c.trusted.root, 'supabase/staging-duplicate-coverage.json'), '{"files":[]} \n') }, /modified tracked files/)
const UNTRACKED = /untracked files under scripts, supabase, apps\/web\/scripts, apps\/web\/e2e/
refusing('an untracked script planted in the trusted tree', (c) => { writeFileSync(join(c.trusted.root, 'scripts/extra.mjs'), 'export {}\n') }, UNTRACKED)
refusing('an untracked registry planted under supabase/', (c) => { writeFileSync(join(c.trusted.root, 'supabase/override.json'), '{}\n') }, UNTRACKED)
refusing('an untracked helper planted next to the trusted flag script', (c) => {
  mkdirSync(join(c.trusted.root, 'apps/web/scripts'), { recursive: true })
  writeFileSync(join(c.trusted.root, 'apps/web/scripts/shadow.mjs'), 'export {}\n')
}, UNTRACKED)
refusing('an untracked fixture module planted next to the trusted seed', (c) => {
  mkdirSync(join(c.trusted.root, 'apps/web/e2e/fixtures'), { recursive: true })
  writeFileSync(join(c.trusted.root, 'apps/web/e2e/fixtures/staging-fixture-users.mjs'), 'export {}\n')
}, UNTRACKED)
refusing('the driver does not live in scripts/ of the working directory', (c) => {
  const other = makeRepository(c.parent, 'elsewhere')
  c.options.scriptDirectory = join(other.root, 'scripts')
}, /must run from scripts\/ of the trusted control-plane checkout/)
refusing('the working directory is not its own git work tree root', (c) => {
  const nested = join(c.parent, 'plain', 'scripts')
  mkdirSync(nested, { recursive: true })
  mkdirSync(join(c.parent, 'plain', 'supabase'), { recursive: true })
  c.options.trustedRoot = join(c.parent, 'plain')
  c.options.scriptDirectory = nested
  c.options.git = (root, args) => (args[0] === 'rev-parse' && args[1] === '--show-toplevel' ? c.parent : git(c.trusted.root, ...args))
}, /not the root of its own trusted git work tree/)
refusing('the candidate migrations directory is missing while required', (c) => { c.candidate = undefined }, /STAGING_CANDIDATE_MIGRATIONS_DIR must point/)
refusing('the candidate migrations directory does not exist', (c) => { c.candidate = join(c.parent, 'nope') }, /does not exist/)
refusing('the candidate migrations directory is inside the trusted tree', (c) => {
  c.candidate = join(c.trusted.root, 'supabase')
}, /outside the trusted control-plane checkout/)
refusing('the candidate directory is a symlink to the trusted migrations', (c) => {
  try { symlinkSync(join(c.trusted.root, 'supabase'), join(c.parent, 'link'), 'dir') } catch { c.skipped = true; c.skip('symlinks unavailable'); return }
  c.candidate = join(c.parent, 'link')
}, /not a symlink/)
refusing('a candidate migration entry is a symlink', (c) => {
  try { symlinkSync(join(c.trusted.root, DRIVER), join(c.candidate, '999_link.sql'), 'file') } catch { c.skipped = true; c.skip('symlinks unavailable'); return }
}, /non-regular or non-\.sql entry: 999_link\.sql/)
refusing('a candidate migrations directory carries a non-SQL file', (c) => { writeFileSync(join(c.candidate, 'runner.mjs'), 'process.exit(0)\n') }, /non-regular or non-\.sql entry: runner\.mjs/)
refusing('a candidate migrations directory carries a nested directory', (c) => { mkdirSync(join(c.candidate, 'nested')) }, /non-regular or non-\.sql entry: nested/)
refusing('a registry or config path resolves outside the trusted tree', (c) => {
  writeFileSync(join(c.parent, 'outside.json'), '{}\n')
  c.options.protectedPaths = ['../outside.json']
}, /must resolve inside the trusted checkout/)

test('candidate directory is optional only where the checkout is main itself (Staging Database Migrate)', () => {
  const parent = scratch()
  const trusted = makeRepository(parent, 'main-checkout')
  const result = assertion(trusted, actionsEnvironment(trusted.sha, { GITHUB_WORKFLOW: 'Staging Database Migrate' }), { requireCandidate: false })
  assert.equal(result.candidate, null)
})

// ---- A PR that changes a privileged migration script cannot bypass the safeguards -------------------------------------

test('NEGATIVE: a PR that neuters the target guard is never loaded -- running the privileged driver from that checkout is refused', () => {
  const parent = scratch()
  const trusted = makeRepository(parent, '.trusted-control-plane')
  const candidate = makeRepository(parent, 'candidate-checkout', { guardSource: 'export const guard = "NEUTERED: allows production"\n' })
  assert.notEqual(candidate.sha, trusted.sha, 'the PR commit differs from the main commit the workflow runs at')
  // Mistake 1: the workflow runs the candidate's copy (cwd + scripts from the PR checkout) at the PR commit.
  assert.throws(() => assertion(candidate, actionsEnvironment(trusted.sha)), /not the workflow commit/)
  // Mistake 2: the PR's scripts are copied over the trusted tree before the driver starts.
  copyFileSync(join(candidate.root, TARGET_GUARD), join(trusted.root, TARGET_GUARD))
  assert.throws(() => assertion(trusted, actionsEnvironment(trusted.sha)), /modified tracked files/)
  // Mistake 3: the PR smuggles its own helper next to the trusted scripts.
  git(trusted.root, 'checkout', '-q', '--', TARGET_GUARD)
  writeFileSync(join(trusted.root, 'scripts/staging-target-guard.override.mjs'), 'export {}\n')
  assert.throws(() => assertion(trusted, actionsEnvironment(trusted.sha)), /untracked files/)
})


test('NEGATIVE: a PR that rewrites the duplicate-history coverage registry or manifest cannot influence the trusted inputs', () => {
  const parent = scratch()
  const trusted = makeRepository(parent, '.trusted-control-plane')
  const candidate = makeRepository(parent, 'candidate-checkout')
  writeFileSync(join(candidate.root, 'supabase/staging-duplicate-coverage.json'), '{"files":["everything covered"]}\n')
  writeFileSync(join(candidate.root, 'supabase/migration-manifest.json'), '{"migrations":{"001_a.sql":"rewritten"}}\n')
  // The privileged inputs are resolved from the trusted tree (cwd), never from the candidate migrations directory's repo.
  const options = optionsFromEnvironment({
    STAGING_SUPABASE_DB_URL: 'postgresql://u:p@db.example/postgres',
    [CANDIDATE_MIGRATIONS_ENV]: join(candidate.root, 'supabase/migrations'),
  })
  assert.equal(options.coveragePath, 'supabase/staging-duplicate-coverage.json', 'coverage registry is a cwd-relative (trusted) path')
  assert.equal(options.configPath, 'supabase/config.toml', 'Supabase config is a cwd-relative (trusted) path')
  assert.equal(options.migrationsDirectory, join(candidate.root, 'supabase/migrations'), 'only the migrations come from the candidate')
  assert.equal(optionsFromEnvironment({ STAGING_SUPABASE_DB_URL: 'postgresql://u:p@db.example/postgres' }).migrationsDirectory, 'supabase/migrations')
  assert.equal(readFileSync(join(trusted.root, 'supabase/staging-duplicate-coverage.json'), 'utf8'), '{"files":[]}\n')
})

test('NEGATIVE (process level): the real guard CLI passes on the trusted tree and exits 1 once a privileged script is replaced', () => {
  const parent = scratch()
  const trusted = makeRepository(parent, '.trusted-control-plane')
  copyFileSync(resolve('scripts/staging-trusted-control-plane.mjs'), join(trusted.root, 'scripts/staging-trusted-control-plane.mjs'))
  git(trusted.root, 'add', '-A')
  git(trusted.root, 'commit', '-q', '-m', 'add guard')
  const sha = git(trusted.root, 'rev-parse', 'HEAD')
  const candidate = makeCandidateMigrations(parent)
  const run = () => spawnSync(process.execPath, [join(trusted.root, 'scripts/staging-trusted-control-plane.mjs'), 'assert'], {
    cwd: trusted.root, encoding: 'utf8', env: { ...process.env, ...actionsEnvironment(sha), [CANDIDATE_MIGRATIONS_ENV]: candidate },
  })
  const ok = run()
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /candidate migrations treated as data only/)
  writeFileSync(join(trusted.root, TARGET_GUARD), 'export const guard = "replaced by a PR"\n')
  const refused = run()
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /Refusing privileged staging action: the trusted checkout has modified tracked files/)
  writeFileSync(join(trusted.root, TARGET_GUARD), 'export const guard = "trusted"\n')
  const wrongRef = spawnSync(process.execPath, [join(trusted.root, 'scripts/staging-trusted-control-plane.mjs'), 'assert'], {
    cwd: trusted.root, encoding: 'utf8', env: { ...process.env, ...actionsEnvironment(sha, { GITHUB_REF: 'refs/pull/1/merge' }), [CANDIDATE_MIGRATIONS_ENV]: candidate },
  })
  assert.equal(wrongRef.status, 1)
})

test('the privileged import closure equals the pinned privileged file list (no unpinned transitive dependency)', () => {
  const seen = new Set()
  const visit = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(/from '(\.\/[^']+)'/g)) visit(join(dirname(file), match[1]).replaceAll('\\', '/'))
  }
  visit(DRIVER)
  visit('scripts/check-migrations.mjs')
  visit('scripts/staging-target-guard.mjs')
  visit('apps/web/e2e/fixtures/seed-staging-tenant.mjs')
  visit('apps/web/scripts/apply-feature-flag.mjs')
  visit('scripts/check-feature-flag-registry.mjs')
  const closure = [...seen].sort()
  assert.deepEqual(closure.filter((file) => !PRIVILEGED_STAGING_FILES.includes(file)), [], 'every transitive import of a privileged script is pinned')
  for (const file of PRIVILEGED_STAGING_FILES) assert.ok(existsSync(file), `${file} exists`)
  assert.ok(PRIVILEGED_STAGING_FILES.includes('scripts/schema-contracts.sql'), 'the SQL run with the staging DB credential is pinned')
})

// ---- Workflow contracts -----------------------------------------------------------------------------------------------

const candidateWorkflow = readFileSync('.github/workflows/staging-candidate.yml', 'utf8')
const migrateWorkflow = readFileSync('.github/workflows/staging-db-migrate.yml', 'utf8')
const prepareJob = candidateWorkflow.slice(candidateWorkflow.indexOf('  prepare-staging-database:'), candidateWorkflow.indexOf('  deploy-api:'))
const stepsOf = (job) => job.split(/\n      - /).slice(1).map((step) => `- ${step}`)
const prepareSteps = stepsOf(prepareJob)
const SECRET = 'secrets.STAGING_SUPABASE_DB_URL'

test('shared staging concurrency: both staging-mutating workflows queue in ONE group and never cancel in progress', () => {
  const group = /^concurrency:\n(?:  #.*\n)*  group: staging-release-candidate\n  cancel-in-progress: false\n/m
  assert.match(candidateWorkflow, group)
  assert.match(migrateWorkflow, group)
  assert.doesNotMatch(candidateWorkflow + migrateWorkflow, /cancel-in-progress:\s*(true|\$\{\{)/)
  const groups = [candidateWorkflow, migrateWorkflow].map((text) => text.match(/^  group: (.+)$/m)[1])
  assert.equal(new Set(groups).size, 1, 'one shared group string')
})

test('only the two grouped workflows can touch the persistent staging database', () => {
  const holders = readdirSync('.github/workflows').filter((file) => /\.ya?ml$/.test(file))
    .filter((file) => readFileSync(join('.github/workflows', file), 'utf8').includes(SECRET))
  assert.deepEqual(holders.sort(), ['staging-candidate.yml', 'staging-db-migrate.yml'])
})

test('trusted checkout: exact workflow commit, separate path, no persisted credentials, before any privileged step', () => {
  const candidateCheckout = prepareJob.indexOf('ref: ${{ needs.resolve-candidate.outputs.sha }}')
  const shadow = prepareJob.indexOf('test ! -e .trusted-control-plane')
  const trustedCheckout = prepareJob.indexOf(`path: ${TRUSTED_CHECKOUT_DIRECTORY}`)
  const assertStep = prepareJob.indexOf('node scripts/staging-trusted-control-plane.mjs assert')
  const firstPrivileged = prepareJob.indexOf('node scripts/check-migrations.mjs')
  assert.ok(candidateCheckout >= 0 && shadow > candidateCheckout && trustedCheckout > shadow, 'candidate checkout, then shadow refusal, then trusted checkout')
  assert.ok(assertStep > trustedCheckout && firstPrivileged > assertStep, 'the trust assertion precedes every privileged script')
  const checkout = prepareSteps.find((step) => step.includes(`path: ${TRUSTED_CHECKOUT_DIRECTORY}`))
  assert.match(checkout, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(checkout, /persist-credentials: false/)
  assert.doesNotMatch(checkout, /needs\.resolve-candidate|pull_request|head_sha|head\.sha/, 'the trusted ref never derives from the candidate')
})

test('every privileged script that can see the staging database secret runs from the trusted checkout', () => {
  const privilegedScript = /node scripts\/(?:staging-|production-|check-db-drift|check-migrations)/
  const withSecret = prepareSteps.filter((step) => step.includes(SECRET) || privilegedScript.test(step))
  assert.ok(withSecret.length >= 6)
  for (const step of withSecret) {
    const name = step.match(/name: (.+)/)?.[1] ?? step.slice(0, 60)
    assert.match(step, /working-directory: \.trusted-control-plane/, `${name} must run from the trusted checkout`)
  }
  // Any step that can see ANY staging secret (DB URL, service-role key, fixture password) is trusted-only.
  for (const step of prepareSteps.filter((item) => /secrets\./.test(item))) {
    const name = step.match(/name: (.+)/)?.[1] ?? step.slice(0, 60)
    assert.match(step, /working-directory: \.trusted-control-plane/, `${name} sees a secret and must run from the trusted checkout`)
    assert.doesNotMatch(step, /\bcd apps\/web\b|scripts\/schema-contracts\.sql.*\$\{\{ github\.workspace/, `${name} must not enter the candidate tree`)
  }
  const candidateFreeRuns = prepareSteps.filter((step) => privilegedScript.test(step) && !step.includes('working-directory: .trusted-control-plane'))
  assert.deepEqual(candidateFreeRuns, [], 'no privileged script is ever executed from the candidate workspace')
})

test('privileged steps receive the candidate migrations only as the data directory, plus the pinned plan/apply/verify wiring', () => {
  for (const command of ['staging-migration-apply-workspace.mjs plan', 'staging-migration-apply-workspace.mjs apply', 'check-db-drift.mjs --environment staging']) {
    const step = prepareSteps.find((item) => item.includes(`node scripts/${command}`))
    assert.ok(step, command)
    assert.match(step, /STAGING_CANDIDATE_MIGRATIONS_DIR: \$\{\{ github\.workspace \}\}\/supabase\/migrations/)
  }
  assert.match(prepareJob, /node scripts\/check-migrations\.mjs --migration-dir "\$STAGING_CANDIDATE_MIGRATIONS_DIR"/)
  assert.doesNotMatch(prepareJob, /--manifest/, 'the released-migration manifest is the trusted main copy')
})

test('Staging Database Migrate asserts the trusted main checkout before any privileged step', () => {
  assert.match(migrateWorkflow, /if: github\.ref == 'refs\/heads\/main'/)
  const assertStep = migrateWorkflow.indexOf('node scripts/staging-trusted-control-plane.mjs assert')
  assert.ok(assertStep > 0 && assertStep < migrateWorkflow.indexOf('node scripts/check-migrations.mjs'))
  assert.ok(assertStep < migrateWorkflow.indexOf('node scripts/staging-migration-apply-workspace.mjs apply'))
})
