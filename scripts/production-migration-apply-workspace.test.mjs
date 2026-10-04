import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  PINNED_SUPABASE_CLI_VERSION,
  buildVerifiedApplyWorkspace,
  findCliOrderingConflicts,
  optionsFromEnvironment,
  parseAppliedMigrations,
  parseDryRunOutput,
  runApply,
  runPlan,
  selectPendingMigrationFiles,
  verifyApplied,
  verifyFetchedMirror,
} from './production-migration-apply-workspace.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const script = read('scripts/production-migration-apply-workspace.mjs')
const workflow = read('.github/workflows/production-release.yml')

// ---- CLI output parsing ------------------------------------------------------------------------------------------

test('dry-run output is parsed strictly: only the pushed-migration list or "up to date" is accepted', () => {
  const noise = 'DRY RUN: migrations will *not* be pushed to the database.\nConnecting to remote database...\n'
  assert.deepEqual(parseDryRunOutput(`${noise}Would push these migrations:\n • 004_a.sql\n • 204_b.sql\nFinished supabase db push.\n`), ['004_a.sql', '204_b.sql'])
  assert.deepEqual(parseDryRunOutput(`${noise}Remote database is up to date.\nA new version of Supabase CLI is available: v9.9.9 (currently installed v2.76.8)\n`), [])
  for (const bad of [
    `${noise}Remote migration versions not found in local migrations directory.\n`,
    `${noise}Found local migration files to be inserted before the last migration on remote database.\n`,
    `${noise}Would push these migrations:\n • 004_a.sql\nsupabase migration repair --status reverted 1\n`,
    `${noise}Would push these migrations:\n`,
    `${noise}Would push these migrations:\n • not-a-migration.txt\n`,
    '',
  ]) assert.throws(() => parseDryRunOutput(bad), /Supabase CLI dry run/)
})

test('applied migrations are read from the CLI progress lines in order', () => {
  assert.deepEqual(parseAppliedMigrations('Connecting...\nApplying migration 004_a.sql...\nApplying migration 204_b.sql...\nFinished supabase db push.\n'), ['004_a.sql', '204_b.sql'])
})

// ---- pending file selection --------------------------------------------------------------------------------------

const MIGRATIONS = [
  { filename: '042_one.sql', version: '042' }, { filename: '042_two.sql', version: '042' },
  { filename: '204_repair.sql', version: '204' }, { filename: '0301_zero_padded.sql', version: '0301' },
]

test('every pending version must name exactly one repository file; duplicate source files are never selected', () => {
  assert.deepEqual(selectPendingMigrationFiles(['204', '301'], MIGRATIONS), [
    { version: '204', filename: '204_repair.sql' }, { version: '301', filename: '0301_zero_padded.sql' },
  ])
  assert.throws(() => selectPendingMigrationFiles(['42'], MIGRATIONS), /exactly one repository migration file; found 2/)
  assert.throws(() => selectPendingMigrationFiles(['999'], MIGRATIONS), /exactly one repository migration file; found 0/)
})

// ---- fetched mirror verification ---------------------------------------------------------------------------------

function mirrorDirectory(files) {
  const directory = mkdtempSync(join(tmpdir(), 'mirror-test-'))
  for (const file of files) writeFileSync(join(directory, file), '-- mirror\n')
  return directory
}
const REMOTE = [{ version: '001', name: 'a' }, { version: '20260517181733', name: 'x' }]

test('the fetched mirror must equal the live remote version set exactly', () => {
  const ok = mirrorDirectory(['001_a.sql', '20260517181733_x.sql'])
  assert.equal(verifyFetchedMirror(ok, REMOTE).length, 2)
  assert.throws(() => verifyFetchedMirror(mirrorDirectory(['001_a.sql']), REMOTE), /missing: 20260517181733/)
  assert.throws(() => verifyFetchedMirror(mirrorDirectory(['001_a.sql', '20260517181733_x.sql', '002_b.sql']), REMOTE), /extra: 002/)
  assert.throws(() => verifyFetchedMirror(mirrorDirectory(['001_a.sql', '001_b.sql', '20260517181733_x.sql']), REMOTE), /duplicate versions/)
  assert.throws(() => verifyFetchedMirror(mirrorDirectory(['001_a.sql', '20260517181733_x.sql', 'notes.txt']), REMOTE), /unexpected entry/)
  assert.throws(() => verifyFetchedMirror(ok, [...REMOTE, { version: '001', name: 'dup' }]), /duplicate versions/)
})

test('CLI ordering: production-shaped history with 020 and 0201 is detected before the CLI sees it', () => {
  const remote = ['019', '020', '0201', '021', '20260517181733']
  const files = ['019_a.sql', '020_fix_credits_decimal.sql', '0201_logbook_expires.sql', '021_c.sql', '20260517181733_x.sql']
  assert.deepEqual(findCliOrderingConflicts(remote, files), ['020'])
  // Without the prefix pair, and with extra pending files, the walk is clean.
  assert.deepEqual(findCliOrderingConflicts(['019', '020', '021'], ['019_a.sql', '020_b.sql', '021_c.sql', '050_new.sql']), [])
  assert.deepEqual(findCliOrderingConflicts(['001', '20260517181733'], ['001_a.sql', '20260517181733_x.sql', '204_p.sql']), [])
})

// ---- workspace build with fakes ----------------------------------------------------------------------------------

function harness(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'apply-unit-'))
  const migrationsDirectory = join(root, 'repo-migrations')
  mkdirSync(migrationsDirectory)
  writeFileSync(join(migrationsDirectory, '001_a.sql'), 'select 1;\n')
  writeFileSync(join(migrationsDirectory, '004_new.sql'), 'select 4;\n')
  writeFileSync(join(root, 'config.toml'), 'project_id = "x"\n')
  const runnerTemp = join(root, 'runner')
  mkdirSync(runnerTemp)
  const options = {
    databaseUrl: 'postgresql://user:secret@db.example:5432/postgres',
    runnerTemp, migrationsDirectory, configPath: join(root, 'config.toml'),
  }
  const calls = []
  const live = () => ({
    remoteRows: REMOTE,
    migrations: [{ filename: '001_a.sql', version: '001' }, { filename: '004_new.sql', version: '004' }],
    knownHistory: { rows: [{ remoteId: '20260517181733' }] },
    forwardRepairs: { repairs: [] },
    evaluation: {
      status: 'PENDING', missingOnRemote: ['4'], unknownOnRemote: [], unresolvedRemoteRows: [],
      attestedRows: [{ remoteId: '20260517181733' }], duplicateCoverage: { incompleteGroups: [], groups: [] },
    },
  })
  const deps = {
    log: () => {},
    assertTarget: () => calls.push('guard'),
    evaluateLive: () => { calls.push('evaluate'); return (overrides.live ?? live)(calls) },
    runSupabase: (args, { cwd }) => {
      calls.push(args.slice(0, 2).join(' ') + (args.includes('--dry-run') ? ' --dry-run' : ''))
      if (overrides.runSupabase) {
        const handled = overrides.runSupabase(args, { cwd })
        if (handled) return handled
      }
      if (args[0] === '--version') return { status: 0, stdout: `${PINNED_SUPABASE_CLI_VERSION}\n`, stderr: '' }
      if (args[1] === 'fetch') {
        mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true })
        for (const file of ['001_a.sql', '20260517181733_x.sql']) writeFileSync(join(cwd, 'supabase', 'migrations', file), '-- production SQL\n')
        return { status: 0, stdout: 'Connecting to remote database...\n', stderr: '' }
      }
      if (args.includes('--dry-run')) return { status: 0, stdout: '', stderr: 'Would push these migrations:\n • 004_new.sql\n' }
      return { status: 0, stdout: '', stderr: 'Applying migration 004_new.sql...\n' }
    },
  }
  return { root, runnerTemp, options, calls, deps }
}
const leftovers = (h) => readdirSync(h.runnerTemp)

test('a verified workspace mirrors history, overlays exactly the pending file, and is removed on cleanup', () => {
  const h = harness()
  const built = buildVerifiedApplyWorkspace(h.options, h.deps)
  assert.deepEqual(readdirSync(join(built.workspace, 'supabase', 'migrations')).sort(), ['001_a.sql', '004_new.sql', '20260517181733_x.sql'])
  assert.equal(readFileSync(join(built.workspace, 'supabase', 'migrations', '004_new.sql'), 'utf8'), 'select 4;\n')
  assert.ok(existsSync(join(built.workspace, 'supabase', 'config.toml')))
  assert.deepEqual(h.calls, ['guard', '--version', 'evaluate', 'migration fetch', 'evaluate', 'db push --dry-run'])
  built.cleanup()
  assert.deepEqual(leftovers(h), [])
})

const failing = (name, overrides, pattern, expectedCalls) => test(`HARD FAIL before mutation: ${name}`, () => {
  const h = harness(overrides)
  assert.throws(() => runApply(h.options, h.deps), pattern)
  assert.deepEqual(leftovers(h), [], 'no workspace (and no production SQL) is left behind')
  assert.ok(!h.calls.includes('db push'), 'the mutating push never runs')
  if (expectedCalls) assert.deepEqual(h.calls, expectedCalls)
})

test('the guard runs before any CLI or database access', () => {
  const h = harness()
  h.deps.assertTarget = () => { h.calls.push('guard'); throw new Error('Refusing production action: nope') }
  assert.throws(() => runApply(h.options, h.deps), /Refusing production action/)
  assert.deepEqual(h.calls, ['guard'])
})
failing('wrong Supabase CLI version', { runSupabase: (args) => (args[0] === '--version' ? { status: 0, stdout: '2.119.0\n', stderr: '' } : null) }, /must be exactly 2\.76\.8/)
failing('unknown production migrations', { live: () => mutate({ unknownOnRemote: ['999'] }) }, /unknown production migrations/)
failing('unresolved production rows', { live: () => mutate({ unresolvedRemoteRows: [{ version: '20260101000000', name: 'x' }] }) }, /unresolved production migration row/)
failing('a known-history attestation is not verified', { live: () => mutate({ attestedRows: [] }) }, /attestations are not all verified/)
failing('duplicate coverage is incomplete', { live: () => mutate({ duplicateCoverage: { incompleteGroups: [{ version: '042' }], groups: [] } }) }, /duplicate migration coverage is incomplete/)
failing('a forward repair is neither applied nor pending', {
  live: () => mutate({ duplicateCoverage: { incompleteGroups: [], groups: [{ forwardRepairs: [{ repairFile: '204_x.sql', status: 'unapplied' }] }] } }),
}, /neither applied nor pending/)
failing('a pending version has no unique repository file', {
  live: () => ({ ...base(), evaluation: { ...base().evaluation, missingOnRemote: ['9'] } }),
}, /exactly one repository migration file; found 0/)
failing('the CLI cannot fetch history', { runSupabase: (args) => (args[1] === 'fetch' ? { status: 1, stdout: '', stderr: 'boom postgresql://user:secret@db.example:5432/postgres' } : null) }, (error) => {
  assert.match(error.message, /migration fetch failed/)
  assert.doesNotMatch(error.message, /secret/)
  return true
})
failing('the fetched mirror disagrees with the live history', {
  runSupabase: (args, { cwd }) => {
    if (args[1] !== 'fetch') return null
    mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true })
    writeFileSync(join(cwd, 'supabase', 'migrations', '001_a.sql'), '-- x\n')
    return { status: 0, stdout: '', stderr: '' }
  },
}, /disagrees with live production history/)
failing('production history changes while the workspace is being built', {
  live: (calls) => (calls.filter((call) => call === 'evaluate').length > 1
    ? { ...base(), remoteRows: [...REMOTE, { version: '002', name: 'raced' }] }
    : base()),
}, /changed while the apply workspace was being built/)
failing('the CLI proposes an extra migration', { runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Would push these migrations:\n • 004_new.sql\n • 001_a.sql\n' } : null) }, /proposes/)
failing('the CLI proposes an omission', { runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Remote database is up to date.\n' } : null) }, /proposes/)
failing('the CLI proposes a duplicate', { runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Would push these migrations:\n • 004_new.sql\n • 004_new.sql\n' } : null) }, /proposes/)
failing('the CLI reports remote migrations missing locally', { runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Remote migration versions not found in local migrations directory.\nsupabase migration repair --status reverted 1\n' } : null) }, /unexpected output/)
failing('the CLI dry run itself fails', { runSupabase: (args) => (args.includes('--dry-run') ? { status: 1, stdout: '', stderr: 'nope' } : null) }, /db push --dry-run failed/)

function base() {
  return {
    remoteRows: REMOTE,
    migrations: [{ filename: '001_a.sql', version: '001' }, { filename: '004_new.sql', version: '004' }],
    knownHistory: { rows: [{ remoteId: '20260517181733' }] },
    forwardRepairs: { repairs: [] },
    evaluation: {
      status: 'PENDING', missingOnRemote: ['4'], unknownOnRemote: [], unresolvedRemoteRows: [],
      attestedRows: [{ remoteId: '20260517181733' }], duplicateCoverage: { incompleteGroups: [], groups: [] },
    },
  }
}
function mutate(evaluationOverrides) {
  const value = base()
  return { ...value, evaluation: { ...value.evaluation, ...evaluationOverrides } }
}

failing('remote history holds both 020 and 0201 (CLI filename/version order inversion)', {
  live: () => ({ ...base(), remoteRows: [...REMOTE, { version: '020', name: 'fix_credits_decimal' }, { version: '0201', name: 'logbook_expires' }] }),
  runSupabase: (args, { cwd }) => {
    if (args[1] !== 'fetch') return null
    mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true })
    for (const file of ['001_a.sql', '20260517181733_x.sql', '020_fix_credits_decimal.sql', '0201_logbook_expires.sql']) writeFileSync(join(cwd, 'supabase', 'migrations', file), '-- x\n')
    return { status: 0, stdout: '', stderr: '' }
  },
}, /reject remote version\(s\) 020 as missing locally/, ['guard', '--version', 'evaluate', 'migration fetch', 'evaluate'])

test('plan never performs a mutating CLI call', () => {
  const h = harness()
  assert.deepEqual(runPlan(h.options, h.deps), { pending: ['004_new.sql'], mirrorCount: 2 })
  assert.ok(h.calls.every((call) => call !== 'db push'))
  assert.deepEqual(leftovers(h), [])
})

test('apply rebuilds from scratch, re-verifies, and only then pushes once', () => {
  const h = harness()
  const workspaces = []
  const inner = h.deps.runSupabase
  h.deps.runSupabase = (args, context) => {
    if (args[1] === 'fetch') workspaces.push(context.cwd)
    return inner(args, context)
  }
  assert.deepEqual(runApply(h.options, h.deps), { applied: ['004_new.sql'] })
  assert.equal(new Set(workspaces).size, 2, 'two independent workspaces')
  assert.deepEqual(h.calls, [
    'guard', '--version', 'evaluate', 'migration fetch', 'evaluate', 'db push --dry-run',
    'guard', '--version', 'evaluate', 'migration fetch', 'evaluate', 'db push --dry-run',
    'db push',
  ])
  assert.deepEqual(leftovers(h), [])
})

test('apply refuses when the CLI applied something other than the verified plan', () => {
  const h = harness({ runSupabase: (args) => (!args.includes('--dry-run') && args[0] === 'db' ? { status: 0, stdout: 'Applying migration 004_new.sql...\nApplying migration 777_surprise.sql...\n', stderr: '' } : null) })
  assert.throws(() => runApply(h.options, h.deps), /differs from the verified plan/)
  assert.deepEqual(leftovers(h), [])
})

test('apply with nothing pending performs no push', () => {
  const h = harness({
    live: () => mutate({ missingOnRemote: [], status: 'CLEAN' }),
    runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Remote database is up to date.\n' } : null),
  })
  assert.deepEqual(runApply(h.options, h.deps), { applied: [] })
  assert.ok(!h.calls.includes('db push'))
})

test('apply passes --yes only to the verified real push and never to fetch or dry runs', () => {
  const h = harness()
  const seen = []
  const inner = h.deps.runSupabase
  h.deps.runSupabase = (args, context) => { seen.push(args); return inner(args, context) }
  runApply(h.options, h.deps)
  for (const args of seen) {
    if (args.includes('--yes')) assert.ok(args[0] === 'db' && !args.includes('--dry-run'))
    assert.ok(!args.includes('repair') && !args.includes('pull') && !args.includes('reset'))
  }
  assert.equal(seen.filter((args) => args.includes('--yes')).length, 1)
})

test('verify-applied requires CLEAN, exact attestations and recorded forward repairs', () => {
  const clean = () => ({
    ...base(),
    forwardRepairs: { repairs: [{ repairFile: '204_x.sql', repairVersion: '204' }] },
    remoteRows: [...REMOTE, { version: '204', name: 'x' }],
    evaluation: { ...base().evaluation, status: 'CLEAN', missingOnRemote: [] },
  })
  const h = harness({ live: clean })
  assert.deepEqual(verifyApplied(h.options, h.deps), { status: 'CLEAN' })
  for (const bad of [
    { ...clean(), evaluation: { ...clean().evaluation, status: 'PENDING' } },
    { ...clean(), remoteRows: REMOTE },
    { ...clean(), evaluation: { ...clean().evaluation, attestedRows: [] } },
  ]) assert.throws(() => verifyApplied(h.options, { ...h.deps, evaluateLive: () => bad }))
})

test('options come only from the environment and never from arguments', () => {
  assert.throws(() => optionsFromEnvironment({}), /PRODUCTION_SUPABASE_DB_URL is required/)
  const options = optionsFromEnvironment({ PRODUCTION_SUPABASE_DB_URL: 'postgresql://x', RUNNER_TEMP: '/tmp/r' })
  assert.equal(options.runnerTemp, '/tmp/r')
  assert.equal(options.aliasRegistryPath, 'supabase/production-migration-aliases.json')
})

// ---- static safety contracts -------------------------------------------------------------------------------------

test('the apply script never repairs, pulls, resets or writes migration history, and never shells out to psql itself', () => {
  assert.doesNotMatch(script, /migration repair|\bdb pull\b|\bdb reset\b|['"]repair['"]|['"]pull['"]/i)
  assert.doesNotMatch(script, /(insert\s+into|update|delete\s+from|truncate|alter\s+table)\s+supabase_migrations/i)
  assert.doesNotMatch(script, /schema_migrations/)
  assert.doesNotMatch(script, /\bpsql\b/, 'history is read only through the shared read-only drift queries')
  assert.match(script, /'migration', 'fetch'/)
  assert.match(script, /'db', 'push'/)
  assert.doesNotMatch(script, /console\.log\([^)]*(databaseUrl|statements)/)
})

test('the production registries stay attestations, never aliases', () => {
  assert.deepEqual(JSON.parse(read('supabase/production-migration-aliases.json')).aliases, [])
  const known = JSON.parse(read('supabase/production-known-history.json')).rows.map((row) => row.remote_id)
  assert.deepEqual(known, ['20260517181733', '20260604070643', '20260724140005'])
})

// ---- production-release.yml contract -----------------------------------------------------------------------------

const job = (name) => {
  const start = workflow.indexOf(`\n  ${name}:`)
  assert.ok(start >= 0, `${name} job exists`)
  const rest = workflow.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}
const stepIndex = (text, needle) => {
  const index = text.indexOf(needle)
  assert.ok(index >= 0, `${needle} present`)
  return index
}

test('production no longer applies migrations from the normal repository workspace', () => {
  assert.doesNotMatch(workflow, /supabase\s+db\s+push/)
  assert.doesNotMatch(workflow, /supabase\s+migration/)
  assert.doesNotMatch(workflow, /migration repair|db pull/)
  assert.doesNotMatch(workflow, /supabase_migrations|schema_migrations/)
  assert.doesNotMatch(workflow, /continue-on-error/)
})

test('the migrate job applies through the verified ephemeral workspace under the protected production environment', () => {
  const migrate = job('production-db-migrate')
  assert.match(migrate, /environment: production/)
  assert.match(migrate, new RegExp(`version: ${PINNED_SUPABASE_CLI_VERSION.replaceAll('.', '\\.')}`))
  const guard = stepIndex(migrate, 'node scripts/production-target-guard.mjs')
  const apply = stepIndex(migrate, 'node scripts/production-migration-apply-workspace.mjs apply')
  const drift = stepIndex(migrate, 'node scripts/check-db-drift.mjs --environment production')
  const applied = stepIndex(migrate, 'node scripts/production-migration-apply-workspace.mjs verify-applied')
  const contracts = stepIndex(migrate, '--file scripts/schema-contracts.sql')
  assert.ok(guard < apply && apply < drift && drift < applied && applied < contracts, 'guard, apply, clean drift, post-apply proof, schema contracts — in order')
  assert.ok(stepIndex(migrate, 'postgresql-client') < apply, 'psql is installed before the apply script reads history')
  assert.equal((migrate.match(/production-migration-apply-workspace\.mjs apply/g) ?? []).length, 1)
  for (const variable of ['PRODUCTION_SUPABASE_DB_URL', 'PRODUCTION_SUPABASE_URL', 'PRODUCTION_EXPECTED_DATABASE_HOST', 'PRODUCTION_EXPECTED_SUPABASE_HOST']) {
    const applyStep = migrate.slice(apply, drift)
    assert.match(applyStep, new RegExp(variable), `${variable} reaches the apply step`)
  }
})

test('the preflight proves the workspace and CLI plan (dry run) before any approval-gated apply', () => {
  const preflight = job('production-db-preflight')
  assert.match(preflight, /environment: production/)
  const drift = stepIndex(preflight, 'node scripts/check-db-drift.mjs --environment production --allow-pending')
  const plan = stepIndex(preflight, 'node scripts/production-migration-apply-workspace.mjs plan')
  assert.ok(drift < plan)
  assert.match(preflight.slice(plan - 200, plan), /steps\.drift\.outputs\.pending == 'true'/)
  assert.doesNotMatch(preflight, /migration-apply-workspace\.mjs apply/)
  assert.ok(stepIndex(preflight, 'node scripts/production-target-guard.mjs') < plan)
})

test('deployment still waits for the verified migration job', () => {
  assert.match(job('deploy-api'), /needs: \[[^\]]*production-db-migrate[^\]]*\]/)
})

// ---- required CI execution of the real-CLI contract --------------------------------------------------------------

test('CI executes the real pinned-CLI apply contract and the CI Gate requires it', () => {
  const ci = read('.github/workflows/ci.yml')
  const start = ci.indexOf('\n  supabase-cli-apply-contract:')
  assert.ok(start >= 0, 'supabase-cli-apply-contract job exists')
  const section = ci.slice(start, ci.indexOf('\n  ci-gate:'))
  assert.match(section, new RegExp(`version: ${PINNED_SUPABASE_CLI_VERSION.replaceAll('.', '\.')}`))
  assert.match(section, /node --test scripts\/production-migration-apply-cli-contract\.test\.mjs/)
  assert.match(section, /REQUIRE_SUPABASE_CLI_APPLY_CONTRACT: "1"/)
  assert.match(section, /postgresql-client/)
  assert.doesNotMatch(section, /continue-on-error/)
  const gate = ci.slice(ci.indexOf('\n  ci-gate:'), ci.indexOf('\n  pr-comment:'))
  assert.match(gate, /- supabase-cli-apply-contract\n/)
  assert.match(gate, /SUPABASE_CLI_APPLY_CONTRACT: \$\{\{ needs\.supabase-cli-apply-contract\.result \}\}/)
  assert.match(gate, /"Supabase CLI Apply Contract:\$SUPABASE_CLI_APPLY_CONTRACT"/)
})

test('the real-CLI contract fails (never skips) in CI when a prerequisite is missing', () => {
  const contract = read('scripts/production-migration-apply-cli-contract.test.mjs')
  assert.match(contract, /REQUIRE_SUPABASE_CLI_APPLY_CONTRACT === '1'/)
  assert.match(contract, /missing\.length > 0 && REQUIRED/)
})
