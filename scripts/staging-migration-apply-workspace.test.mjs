import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadMigrations, sha256 } from './check-migrations.mjs'
import {
  PINNED_SUPABASE_CLI_VERSION,
  buildVerifiedApplyWorkspace,
  loadDuplicateCoverageRegistry,
  optionsFromEnvironment,
  runApply,
  runPlan,
  verifyApplied,
  verifyDuplicateCoverage,
  verifyFetchedMirror,
} from './staging-migration-apply-workspace.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const script = read('scripts/staging-migration-apply-workspace.mjs')
const REMOTE = [{ version: '001', name: 'a' }, { version: '039', name: 'drop_room_status_history_trigger' }]
const STAGING_DB = 'postgresql://postgres:s3cr3t@db.stagingref.supabase.co:5432/postgres'

// ---- harness with fakes ------------------------------------------------------------------------------------------

function baseLive() {
  return {
    remoteRows: REMOTE,
    migrations: [
      { filename: '001_a.sql', version: '001', content: 'create table a(id int);' },
      { filename: '039_x.sql', version: '039', content: 'select 39;' },
      { filename: '232_new.sql', version: '232', content: 'alter table a add column b int;' },
    ],
    evaluation: { status: 'PENDING', missingOnRemote: ['232'], unknownOnRemote: [], duplicateCoverage: { incompleteGroups: [], groups: [] } },
  }
}

function harness(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'stg-apply-unit-'))
  const migrationsDirectory = join(root, 'repo-migrations')
  mkdirSync(migrationsDirectory)
  writeFileSync(join(migrationsDirectory, '001_a.sql'), 'create table a(id int);\n')
  writeFileSync(join(migrationsDirectory, '039_x.sql'), 'DROP INDEX IF EXISTS never_replay_me;\n')
  writeFileSync(join(migrationsDirectory, '232_new.sql'), 'alter table a add column b int;\n')
  writeFileSync(join(root, 'config.toml'), 'project_id = "x"\n')
  writeFileSync(join(root, 'coverage.json'), JSON.stringify({ schema_version: 1, environment: 'staging', files: overrides.coverage ?? [] }))
  const runnerTemp = join(root, 'runner')
  mkdirSync(runnerTemp)
  const options = { databaseUrl: STAGING_DB, runnerTemp, migrationsDirectory, configPath: join(root, 'config.toml'), coveragePath: join(root, 'coverage.json') }
  const calls = []
  const deps = {
    log: () => {},
    assertTarget: () => calls.push('guard'),
    probeRunner: overrides.probeRunner ?? (() => 't'),
    evaluateLive: () => { calls.push('evaluate'); return (overrides.live ?? baseLive)(calls) },
    runSupabase: (args, { cwd }) => {
      calls.push(args.slice(0, 2).join(' ') + (args.includes('--dry-run') ? ' --dry-run' : ''))
      const handled = overrides.runSupabase?.(args, { cwd, calls })
      if (handled) return handled
      if (args[0] === '--version') return { status: 0, stdout: `${PINNED_SUPABASE_CLI_VERSION}\n`, stderr: '' }
      if (args[1] === 'fetch') {
        mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true })
        for (const file of ['001_a.sql', '039_drop_room_status_history_trigger.sql']) writeFileSync(join(cwd, 'supabase', 'migrations', file), '-- mirrored history\n')
        return { status: 0, stdout: 'Connecting to remote database...\n', stderr: '' }
      }
      if (args.includes('--dry-run')) return { status: 0, stdout: '', stderr: 'Would push these migrations:\n • 232_new.sql\n' }
      return { status: 0, stdout: '', stderr: 'Applying migration 232_new.sql...\n' }
    },
  }
  return { root, runnerTemp, options, calls, deps }
}
const leftovers = (h) => readdirSync(h.runnerTemp)

test('a verified workspace holds mirrored history plus exactly the pending file, and never replays historical SQL', () => {
  const h = harness()
  const built = buildVerifiedApplyWorkspace(h.options, h.deps)
  const directory = join(built.workspace, 'supabase', 'migrations')
  assert.deepEqual(readdirSync(directory).sort(), ['001_a.sql', '039_drop_room_status_history_trigger.sql', '232_new.sql'])
  assert.equal(readFileSync(join(directory, '232_new.sql'), 'utf8'), 'alter table a add column b int;\n')
  assert.doesNotMatch(readFileSync(join(directory, '039_drop_room_status_history_trigger.sql'), 'utf8'), /DROP INDEX|never_replay_me/)
  assert.ok(!readdirSync(directory).includes('039_x.sql'), 'the repository duplicate file is not copied')
  assert.deepEqual(h.calls, ['guard', '--version', 'evaluate', 'migration fetch', 'evaluate', 'db push --dry-run'])
  built.cleanup()
  assert.deepEqual(leftovers(h), [], 'temporary workspace removed')
})

const failing = (name, overrides, pattern, expectedCalls) => test(`HARD FAIL before mutation: ${name}`, () => {
  const h = harness(overrides)
  assert.throws(() => runApply(h.options, h.deps), pattern)
  assert.deepEqual(leftovers(h), [], 'no workspace is left behind')
  assert.ok(!h.calls.includes('db push'), 'the mutating push never runs')
  if (expectedCalls) assert.deepEqual(h.calls, expectedCalls)
})

const withEvaluation = (evaluation, extra = {}) => () => ({ ...baseLive(), ...extra, evaluation: { ...baseLive().evaluation, ...evaluation } })

failing('wrong Supabase CLI version', { runSupabase: (args) => (args[0] === '--version' ? { status: 0, stdout: '2.75.0\n', stderr: '' } : null) }, /must be exactly 2\.112\.0/)
failing('unknown staging migration versions', { live: withEvaluation({ status: 'BLOCKED', unknownOnRemote: ['500'] }) }, /Unknown on staging: 500/)
failing('incomplete duplicate-identifier coverage from the evaluator', { live: withEvaluation({ status: 'BLOCKED', duplicateCoverage: { incompleteGroups: [{}] } }) }, /Duplicate-identifier coverage is incomplete/)
failing('a destructive pending migration', {
  live: withEvaluation({}, { migrations: [...baseLive().migrations.slice(0, 2), { filename: '232_new.sql', version: '232', content: 'DROP TABLE a;' }] }),
}, /destructive pending migration\(s\).*232_new\.sql/s)
failing('a destructive pending DROP POLICY', {
  live: withEvaluation({}, { migrations: [...baseLive().migrations.slice(0, 2), { filename: '232_new.sql', version: '232', content: 'DROP POLICY p ON t;' }] }),
}, /destructive pending migration/)
failing('a pending version has no repository file', { live: withEvaluation({ missingOnRemote: ['233'] }) }, /exactly one repository migration file; found 0/)
failing('two repository files share one pending version', {
  live: withEvaluation({}, { migrations: [...baseLive().migrations, { filename: '232_other.sql', version: '232', content: 'select 1;' }] }),
}, /exactly one repository migration file; found 2/)
failing('a duplicate historical file has no coverage probe', {
  live: withEvaluation({}, { migrations: [...baseLive().migrations, { filename: '039_y.sql', version: '039', content: 'select 1;' }] }),
}, /has no probe/)
const DUP = [{ filename: '039_y.sql', version: '039', content: 'select 1;' }]
const dupCoverage = [{ file: '039_x.sql', sha256: sha256('select 39;'), probe: 'select true' }, { file: '039_y.sql', sha256: sha256('select 1;'), probe: 'select true' }]
failing('a coverage probe for a historical duplicate is not true', {
  live: withEvaluation({}, { migrations: [...baseLive().migrations, ...DUP] }), coverage: dupCoverage, probeRunner: (url, probe) => 'f',
}, /not proven on staging for: 039_x\.sql, 039_y\.sql/)
test('with every duplicate probe true the plan proceeds and still replays no historical SQL', () => {
  const h = harness({ live: withEvaluation({}, { migrations: [...baseLive().migrations, ...DUP] }), coverage: dupCoverage })
  const built = buildVerifiedApplyWorkspace(h.options, h.deps)
  assert.deepEqual(built.pendingFiles.map((file) => file.filename), ['232_new.sql'])
  built.cleanup()
})
failing('the CLI cannot fetch history', {
  runSupabase: (args) => (args[1] === 'fetch' ? { status: 1, stdout: '', stderr: `boom ${STAGING_DB} s3cr3t` } : null),
}, (error) => {
  assert.match(error.message, /migration fetch failed/)
  assert.doesNotMatch(error.message, /s3cr3t/, 'secrets are redacted')
  return true
})
failing('the fetched mirror is missing a recorded version (altered remote history)', {
  runSupabase: (args, { cwd }) => {
    if (args[1] !== 'fetch') return null
    mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true })
    writeFileSync(join(cwd, 'supabase', 'migrations', '001_a.sql'), '-- x\n')
    return { status: 0, stdout: '', stderr: '' }
  },
}, /disagrees with live staging history \(missing: 039/)
failing('staging history changes while the workspace is being built', {
  live: (calls) => (calls.filter((call) => call === 'evaluate').length > 1 ? { ...baseLive(), remoteRows: [...REMOTE, { version: '002', name: 'raced' }] } : baseLive()),
}, /changed while the apply workspace was being built/)
failing('the CLI proposes an extra migration', { runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Would push these migrations:\n • 232_new.sql\n • 039_x.sql\n' } : null) }, /proposes/)
failing('the CLI proposes an omission', { runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Remote database is up to date.\n' } : null) }, /proposes/)
failing('unexpected dry-run output', { runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Found local migration files to be inserted before the last migration on remote database.\n' } : null) }, /unexpected output/)
failing('the dry run itself fails', { runSupabase: (args) => (args.includes('--dry-run') ? { status: 1, stdout: '', stderr: 'nope' } : null) }, /db push --dry-run failed/)

test('probes: a false or failing read-only probe fails closed, naming the file', () => {
  const entries = [{ file: '039_x.sql', probe: 'select true' }]
  assert.doesNotThrow(() => verifyDuplicateCoverage(STAGING_DB, entries, () => 't\n'))
  assert.throws(() => verifyDuplicateCoverage(STAGING_DB, entries, () => 'f'), /not proven on staging for: 039_x\.sql/)
  assert.throws(() => verifyDuplicateCoverage(STAGING_DB, entries, () => { throw new Error(STAGING_DB) }), (error) => !error.message.includes('s3cr3t'))
})

test('apply with nothing pending performs no push (empty pending set)', () => {
  const h = harness({ live: withEvaluation({ status: 'CLEAN', missingOnRemote: [] }), runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Remote database is up to date.\n' } : null) })
  assert.deepEqual(runApply(h.options, h.deps), { applied: [] })
  assert.ok(!h.calls.includes('db push'))
  assert.deepEqual(leftovers(h), [])
})

test('apply rebuilds from scratch (history revalidated twice) and only then pushes once', () => {
  const h = harness()
  assert.deepEqual(runApply(h.options, h.deps), { applied: ['232_new.sql'] })
  assert.deepEqual(h.calls, [
    'guard', '--version', 'evaluate', 'migration fetch', 'evaluate', 'db push --dry-run',
    'guard', '--version', 'evaluate', 'migration fetch', 'evaluate', 'db push --dry-run',
    'db push',
  ])
  assert.deepEqual(leftovers(h), [])
})

test('--include-all and --yes appear only on workspace dry runs/pushes, never on fetch', () => {
  const h = harness()
  const seen = []
  const inner = h.deps.runSupabase
  h.deps.runSupabase = (args, context) => { seen.push(args); return inner(args, context) }
  runApply(h.options, h.deps)
  for (const args of seen) {
    if (args[0] === 'migration') assert.ok(!args.includes('--include-all') && !args.includes('--yes'))
    if (args.includes('--include-all')) assert.ok(args.includes('--workdir'), 'confined to the ephemeral workspace')
  }
  assert.equal(seen.filter((args) => args.includes('--yes')).length, 1)
})

test('a failed or partial application throws, leaves nothing behind, and a retry replans from live history', () => {
  const h = harness({ runSupabase: (args) => (args[1] === 'push' && !args.includes('--dry-run') ? { status: 1, stdout: '', stderr: `ERROR applying 232_new.sql ${STAGING_DB}` } : null) })
  assert.throws(() => runApply(h.options, h.deps), (error) => /db push failed/.test(error.message) && !error.message.includes('s3cr3t'))
  assert.deepEqual(leftovers(h), [])
  // Interrupted migration: the CLI applies 232 in one transaction, so history either has it or it is still pending.
  const retry = harness()
  assert.deepEqual(runApply(retry.options, retry.deps).applied, ['232_new.sql'])
})

test('CLI applying something other than the verified plan is rejected', () => {
  const h = harness({ runSupabase: (args) => (args[1] === 'push' && !args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Applying migration 232_new.sql...\nApplying migration 039_x.sql...\n' } : null) })
  assert.throws(() => runApply(h.options, h.deps), /differs from the verified plan/)
  assert.deepEqual(leftovers(h), [])
})

test('an idempotent second run after a successful apply has nothing pending and does not push', () => {
  const h = harness({ live: withEvaluation({ status: 'CLEAN', missingOnRemote: [] }), runSupabase: (args) => (args.includes('--dry-run') ? { status: 0, stdout: '', stderr: 'Remote database is up to date.\n' } : null) })
  assert.deepEqual(runPlan(h.options, h.deps).pending, [])
  assert.deepEqual(runApply(h.options, h.deps), { applied: [] })
})

test('plan never performs a mutating CLI call', () => {
  const h = harness()
  assert.deepEqual(runPlan(h.options, h.deps).pending, ['232_new.sql'])
  assert.ok(h.calls.every((call) => call !== 'db push'))
  assert.deepEqual(leftovers(h), [])
})

test('verify-applied requires CLEAN history and re-proves historical coverage', () => {
  const clean = harness({ live: withEvaluation({ status: 'CLEAN', missingOnRemote: [] }) })
  assert.deepEqual(verifyApplied(clean.options, clean.deps), { status: 'CLEAN' })
  const pending = harness()
  assert.throws(() => verifyApplied(pending.options, pending.deps), /not CLEAN/)
  const unproven = harness({ live: () => ({ ...baseLive(), migrations: [...baseLive().migrations, ...DUP], evaluation: { ...baseLive().evaluation, status: 'CLEAN', missingOnRemote: [] } }), coverage: dupCoverage, probeRunner: () => 'f' })
  assert.throws(() => verifyApplied(unproven.options, unproven.deps), /not proven on staging/)
})

// ---- target guard (real guard, no fakes) -------------------------------------------------------------------------

const goodEnv = {
  STAGING_SUPABASE_DB_URL: STAGING_DB,
  STAGING_SUPABASE_URL: 'https://stagingref.supabase.co',
  STAGING_EXPECTED_DATABASE_HOST: 'db.stagingref.supabase.co',
  STAGING_EXPECTED_SUPABASE_HOST: 'stagingref.supabase.co',
  PRODUCTION_DATABASE_HOST: 'db.prodref.supabase.co',
  PRODUCTION_SUPABASE_HOST: 'prodref.supabase.co',
}
const guardOnly = (env) => {
  const h = harness()
  const options = { ...h.options, ...optionsFromEnvironment(env), runnerTemp: h.runnerTemp, migrationsDirectory: h.options.migrationsDirectory, configPath: h.options.configPath, coveragePath: h.options.coveragePath }
  const { assertTarget, ...deps } = h.deps
  return { h, options, deps }
}

test('the real target guard accepts the exact staging target', () => {
  const { h, options, deps } = guardOnly(goodEnv)
  assert.deepEqual(runPlan(options, deps).pending, ['232_new.sql'])
  assert.deepEqual(leftovers(h), [])
})
for (const [name, patch, pattern] of [
  ['a wrong database URL', { STAGING_SUPABASE_DB_URL: 'postgresql://u:p@db.otherref.supabase.co:5432/postgres' }, /not the expected staging database host/],
  ['the production database URL', { STAGING_SUPABASE_DB_URL: 'postgresql://u:p@db.prodref.supabase.co:5432/postgres', STAGING_EXPECTED_DATABASE_HOST: 'db.prodref.supabase.co' }, /overlap|not the expected staging database host/],
  ['a missing production host allowlist', { PRODUCTION_DATABASE_HOST: '' }, /production host allowlists/],
]) {
  test(`HARD FAIL before any CLI or database access: ${name}`, () => {
    const { h, options, deps } = guardOnly({ ...goodEnv, ...patch })
    let touched = false
    deps.runSupabase = () => { touched = true; return { status: 0, stdout: '', stderr: '' } }
    deps.evaluateLive = () => { touched = true; return baseLive() }
    assert.throws(() => runApply(options, deps), pattern)
    assert.equal(touched, false)
    assert.deepEqual(leftovers(h), [])
  })
}

test('options come only from the environment and never from arguments', () => {
  assert.throws(() => optionsFromEnvironment({}), /STAGING_SUPABASE_DB_URL is required/)
  assert.equal(optionsFromEnvironment(goodEnv).databaseUrl, STAGING_DB)
  assert.doesNotMatch(script, /process\.argv\.slice\(3\)|process\.argv\[3\]/)
})

// ---- mirror + registry against the real repository ---------------------------------------------------------------

function mirrorDirectory(files) {
  const directory = mkdtempSync(join(tmpdir(), 'stg-mirror-'))
  for (const file of files) writeFileSync(join(directory, file), '-- mirror\n')
  return directory
}

test('the fetched mirror must equal the recorded staging history exactly', () => {
  assert.equal(verifyFetchedMirror(mirrorDirectory(['001_a.sql', '039_b.sql']), REMOTE).length, 2)
  assert.throws(() => verifyFetchedMirror(mirrorDirectory(['001_a.sql']), REMOTE), /missing: 039/)
  assert.throws(() => verifyFetchedMirror(mirrorDirectory(['001_a.sql', '039_b.sql', '002_c.sql']), REMOTE), /extra: 002/)
  assert.throws(() => verifyFetchedMirror(mirrorDirectory(['001_a.sql', '039_b.sql', '039_c.sql']), REMOTE), /duplicate versions/)
  assert.throws(() => verifyFetchedMirror(mirrorDirectory(['001_a.sql', '039_b.sql', 'notes.txt']), REMOTE), /unexpected entry/)
})

test('the real registry covers exactly the grandfathered duplicate files 039, 042 and 110, hash-pinned', () => {
  const migrations = loadMigrations('supabase/migrations')
  const entries = loadDuplicateCoverageRegistry('supabase/staging-duplicate-coverage.json', migrations)
  assert.deepEqual(entries.map((entry) => entry.file).sort(), [
    '039_drop_room_status_history_trigger.sql', '039_drop_unused_indexes.sql',
    '042_guest_requests_priority.sql', '042_lost_found_photos_bucket.sql', '042_room_assignment_clean_type.sql',
    '110_room_unavailability_type.sql', '110_work_order_console_features.sql',
  ])
  assert.ok(entries.every((entry) => /^select\b/i.test(entry.probe) && !entry.probe.includes(';')))
  assert.throws(() => loadDuplicateCoverageRegistry('supabase/staging-duplicate-coverage.json', migrations.map((m) => (m.filename === '042_guest_requests_priority.sql' ? { ...m, content: `${m.content}\n-- edited` } : m))), /changed since its probe was written/)
  assert.throws(() => loadDuplicateCoverageRegistry('supabase/staging-duplicate-coverage.json', [...migrations, { filename: '300_a.sql', version: '300', content: 'x' }, { filename: '300_b.sql', version: '300', content: 'y' }]), /300_a\.sql shares version 300/)
})

test('the only repository versions shared by several files are the grandfathered 039, 042 and 110', () => {
  const counts = new Map()
  for (const migration of loadMigrations('supabase/migrations')) counts.set(migration.version, (counts.get(migration.version) ?? 0) + 1)
  assert.deepEqual([...counts].filter(([, count]) => count > 1).map(([version]) => version).sort(), ['039', '042', '110'])
})

// ---- static properties of the script -----------------------------------------------------------------------------

test('the script never repairs, resets, pulls or writes migration history, and never uses psql for anything but SELECT probes', () => {
  assert.doesNotMatch(script, /migration repair|db reset|db pull|migration up|TRUNCATE|schema_migrations\s+(?:insert|delete|update)/i)
  assert.match(script, /default_transaction_read_only = on/)
})
test('--include-all is only used inside the verified workspace (always with --workdir)', () => {
  for (const line of script.split('\n').filter((l) => l.includes("'--include-all'"))) assert.match(line, /--workdir|workspace/)
  assert.equal([...script.matchAll(/'--include-all'/g)].length, 2)
})
