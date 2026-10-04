/**
 * Real-CLI contract for the production migration apply path.
 *
 * Runs the ACTUAL pinned Supabase CLI against a disposable, TLS-enabled PostgreSQL container whose migration history
 * is shaped like production: normal numeric versions, 14-digit production-only versions with no repository file,
 * pending numeric migrations that sort BEFORE those timestamps, and unique forward migrations standing in for 204/205.
 *
 * Required in CI (job "Supabase CLI Apply Contract"). It needs docker, psql and the pinned supabase CLI; with
 * REQUIRE_SUPABASE_CLI_APPLY_CONTRACT=1 a missing prerequisite FAILS instead of skipping.
 * Optional env: SUPABASE_CLI_BIN (path to the pinned CLI binary).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';

import { sha256 } from './check-migrations.mjs';
import { fingerprintStatements } from './migration-statement-fingerprint.mjs';
import {
  PINNED_SUPABASE_CLI_VERSION,
  buildVerifiedApplyWorkspace,
  createSupabaseRunner,
  runApply,
  runPlan,
  verifyApplied,
} from './production-migration-apply-workspace.mjs';

const REQUIRED = process.env.REQUIRE_SUPABASE_CLI_APPLY_CONTRACT === '1';
const CLI_BIN = process.env.SUPABASE_CLI_BIN || 'supabase';
const REPO_ROOT = resolve('.');
const CONTAINER = `patelrep-apply-contract-${process.pid}`;
const IMAGE = 'postgres:16-alpine';
// 020 is a strict digit-prefix of 0201 (as in production); CLI < 2.112.0 wrongly reported 020 missing.
const PREFIX_PAIR = ['020', '0201'];
const PRODUCTION_ONLY = ['20260517181733', '20260604070643'];

function tryRun(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.error || result.status !== 0 ? null : result.stdout;
}

const prerequisites = {
  docker: tryRun('docker', ['version', '--format', '{{.Server.Version}}']) !== null,
  psql: tryRun('psql', ['--version']) !== null,
  cli: (tryRun(CLI_BIN, ['--version']) ?? '').trim().split(/\r?\n/)[0] === PINNED_SUPABASE_CLI_VERSION,
};
const missing = Object.entries(prerequisites).filter(([, ok]) => !ok).map(([name]) => name);
const skip = missing.length > 0 && !REQUIRED ? `missing prerequisites: ${missing.join(', ')}` : false;

if (missing.length > 0 && REQUIRED) {
  test('required prerequisites for the real-CLI apply contract are present', () => {
    assert.fail(`Missing prerequisites (docker, psql, supabase ${PINNED_SUPABASE_CLI_VERSION}): ${missing.join(', ')}`);
  });
}

const fixture = {};

function psql(sql) {
  return execFileSync('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', fixture.databaseUrl, '--tuples-only', '--no-align', '--command', sql], { encoding: 'utf8' }).trim();
}

/** Full recorded history (including xmin, which changes if a row is ever updated) for byte-level comparisons. */
function historySnapshot() {
  const rows = psql("select json_build_object('version', version, 'name', name, 'statements', statements, 'xmin', xmin::text)::text from supabase_migrations.schema_migrations order by version");
  return rows.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeMigration(directory, filename, sql) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, filename), `${sql}\n`);
}

function cliInDirectory(args, cwd) {
  return spawnSync(CLI_BIN, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function recordingRunner() {
  const calls = [];
  const real = createSupabaseRunner(CLI_BIN, [fixture.databaseUrl]);
  const runSupabase = (args, context) => {
    calls.push(args.map((arg) => (arg === fixture.databaseUrl ? '<db-url>' : arg)));
    return real(args, context);
  };
  return { calls, runSupabase };
}

function options(overrides = {}) {
  return {
    databaseUrl: fixture.databaseUrl,
    runnerTemp: fixture.runnerTemp,
    migrationsDirectory: join(fixture.repo, 'supabase', 'migrations'),
    configPath: join(fixture.repo, 'supabase', 'config.toml'),
    aliasRegistryPath: join(fixture.repo, 'supabase', 'production-migration-aliases.json'),
    knownHistoryPath: join(fixture.repo, 'supabase', 'production-known-history.json'),
    forwardRepairPath: join(fixture.repo, 'supabase', 'production-duplicate-forward-repairs.json'),
    supabaseBin: CLI_BIN,
    target: {
      databaseUrl: fixture.databaseUrl,
      supabaseUrl: 'https://synthetic-production.example',
      expectedDatabaseHost: '127.0.0.1',
      expectedSupabaseHost: 'synthetic-production.example',
      stagingDatabaseHost: 'staging-db.invalid',
      stagingSupabaseHost: 'staging.invalid',
    },
    ...overrides,
  };
}

function directoryListing(directory) {
  return readdirSync(directory).sort().map((name) => `${name}:${sha256(readFileSync(join(directory, name), 'utf8'))}`);
}

function startDisposablePostgres() {
  const port = String(55000 + (process.pid % 2000));
  execFileSync('docker', [
    'run', '--detach', '--name', CONTAINER, '--env', 'POSTGRES_PASSWORD=postgres', '--publish', `127.0.0.1:${port}:5432`,
    '--entrypoint', 'sh', IMAGE, '-c',
    'apk add --no-cache openssl >/dev/null 2>&1; '
    + "openssl req -new -x509 -days 1 -nodes -out /var/lib/postgresql/server.crt -keyout /var/lib/postgresql/server.key -subj '/CN=localhost' 2>/dev/null; "
    + 'chown postgres:postgres /var/lib/postgresql/server.*; chmod 600 /var/lib/postgresql/server.key; '
    + 'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/var/lib/postgresql/server.crt -c ssl_key_file=/var/lib/postgresql/server.key',
  ], { stdio: 'ignore' });
  fixture.databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const logs = spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' });
    if (/init process complete/.test(`${logs.stdout}${logs.stderr}`)) {
      const probe = spawnSync('psql', ['--no-psqlrc', fixture.databaseUrl, '--command', 'select 1'], { encoding: 'utf8' });
      if (probe.status === 0) return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('Disposable PostgreSQL did not become ready.');
}

function buildFixtures() {
  fixture.root = mkdtempSync(join(tmpdir(), 'apply-contract-'));
  fixture.runnerTemp = join(fixture.root, 'runner-temp');
  mkdirSync(fixture.runnerTemp);

  // Seed the "remote" history using the CLI itself, from a workspace shaped like production's applied history.
  const seed = join(fixture.root, 'seed');
  mkdirSync(join(seed, 'supabase', 'migrations'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'supabase', 'config.toml'), join(seed, 'supabase', 'config.toml'));
  const seedMigrations = join(seed, 'supabase', 'migrations');
  writeMigration(seedMigrations, '001_init.sql', 'create table public.t_init (id int);');
  writeMigration(seedMigrations, '002_second.sql', 'create table public.t_second (id int);');
  writeMigration(seedMigrations, '020_fix_credits_decimal.sql', 'create table public.t_v020 (id int);');
  writeMigration(seedMigrations, '0201_logbook_expires.sql', 'create table public.t_v0201 (id int);');
  writeMigration(seedMigrations, '003_dup_a_remote.sql', 'create table public.t_dup_a (id int);');
  writeMigration(seedMigrations, '20260301000000_dup_b.sql', 'create table public.t_dup_b (id int);');
  writeMigration(seedMigrations, `${PRODUCTION_ONLY[0]}_prod_only_one.sql`, 'create table public.t_prod_one (id int);');
  writeMigration(seedMigrations, `${PRODUCTION_ONLY[1]}_prod_only_two.sql`, 'create table public.t_prod_two (id int);');
  const seeded = cliInDirectory(['db', 'push', '--db-url', fixture.databaseUrl, '--yes'], seed);
  assert.equal(seeded.status, 0, `seeding remote history failed: ${seeded.stdout}${seeded.stderr}`);

  // Repository: attributable numeric history, a duplicate-version pair, and pending migrations that sort before the
  // 14-digit rows. 204 is the unique forward repair of 003_dup_a; 003_dup_b is aliased by exact remote name.
  fixture.repo = join(fixture.root, 'repo');
  const repoMigrations = join(fixture.repo, 'supabase', 'migrations');
  copyFileSync(join(REPO_ROOT, 'supabase', 'config.toml'), (mkdirSync(join(fixture.repo, 'supabase'), { recursive: true }), join(fixture.repo, 'supabase', 'config.toml')));
  writeMigration(repoMigrations, '001_init.sql', 'create table public.t_init (id int);');
  writeMigration(repoMigrations, '002_second.sql', 'create table public.t_second (id int);');
  writeMigration(repoMigrations, '003_dup_a.sql', 'create table public.t_dup_a (id int);');
  writeMigration(repoMigrations, '003_dup_b.sql', 'create table public.t_dup_b (id int);');
  writeMigration(repoMigrations, '020_fix_credits_decimal.sql', 'create table public.t_v020 (id int);');
  writeMigration(repoMigrations, '0201_logbook_expires.sql', 'create table public.t_v0201 (id int);');
  writeMigration(repoMigrations, '004_new_feature.sql', 'create table public.t_new_feature (id int);');
  writeMigration(repoMigrations, '204_reconcile_dup_a.sql', 'alter table public.t_dup_a add column if not exists reconciled boolean;');
  writeMigration(repoMigrations, '205_other_new.sql', 'create table public.t_other_new (id int);');

  const attestation = (id, name) => {
    const stored = JSON.parse(psql(`select json_build_object('name', name, 'statements', statements)::text from supabase_migrations.schema_migrations where version = '${id}'`));
    assert.equal(stored.name, name);
    return {
      remote_id: id, stored_name: name, statement_count: stored.statements.length,
      statements_sha256: fingerprintStatements(stored.statements), evidence: 'synthetic contract fixture',
    };
  };
  writeFileSync(join(fixture.repo, 'supabase', 'production-migration-aliases.json'), JSON.stringify({ schema_version: 2, environment: 'production', aliases: [] }));
  writeFileSync(join(fixture.repo, 'supabase', 'production-known-history.json'), JSON.stringify({
    schema_version: 1, environment: 'production',
    rows: [attestation(PRODUCTION_ONLY[0], 'prod_only_one'), attestation(PRODUCTION_ONLY[1], 'prod_only_two')],
  }));
  writeFileSync(join(fixture.repo, 'supabase', 'production-duplicate-forward-repairs.json'), JSON.stringify({
    schema_version: 1, environment: 'production',
    repairs: [{
      source_file: '003_dup_a.sql', repair_file: '204_reconcile_dup_a.sql',
      repair_sha256: sha256(readFileSync(join(repoMigrations, '204_reconcile_dup_a.sql'), 'utf8')), evidence: 'synthetic contract fixture',
    }],
  }));
}

before(() => {
  if (skip || missing.length) return;
  startDisposablePostgres();
  buildFixtures();
});

after(() => {
  if (skip || missing.length) return;
  spawnSync('docker', ['rm', '--force', CONTAINER], { stdio: 'ignore' });
  if (fixture.root) rmSync(fixture.root, { recursive: true, force: true });
});

const EXPECTED_PENDING = ['004_new_feature.sql', '204_reconcile_dup_a.sql', '205_other_new.sql'];
const noRepairOrPull = (calls) => calls.every((args) => !args.includes('repair') && !args.includes('pull') && !args.includes('reset'));

test('the pinned CLI is exactly the version production uses', { skip }, () => {
  assert.equal(PINNED_SUPABASE_CLI_VERSION, '2.112.0');
  assert.equal(cliInDirectory(['--version'], tmpdir()).stdout.trim().split(/\r?\n/)[0], PINNED_SUPABASE_CLI_VERSION);
});

test('the normal repository workspace is rejected by the CLI because of production-only history', { skip }, () => {
  for (const extra of [[], ['--include-all']]) {
    const result = cliInDirectory(['db', 'push', '--db-url', fixture.databaseUrl, '--dry-run', ...extra], fixture.repo);
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /Remote migration versions not found in local migrations directory/);
    for (const id of PRODUCTION_ONLY) assert.ok(output.includes(id), `${id} is reported as missing locally`);
  }
});

test('the ephemeral workspace mirrors every remote version, overlays only the exact pending files, and is removed', { skip }, () => {
  const repositoryBefore = directoryListing(join(fixture.repo, 'supabase', 'migrations'));
  const historyBefore = historySnapshot();
  const recorder = recordingRunner();
  const built = buildVerifiedApplyWorkspace(options(), { runSupabase: recorder.runSupabase, log: () => {} });
  try {
    const files = readdirSync(join(built.workspace, 'supabase', 'migrations')).sort();
    const remoteVersions = historyBefore.map((row) => row.version);
    assert.equal(remoteVersions.length, 8);
    for (const version of PREFIX_PAIR) assert.ok(remoteVersions.includes(version), `remote history contains ${version}`);
    for (const version of remoteVersions) assert.ok(files.some((name) => name.startsWith(`${version}_`)), `mirror represents remote version ${version}`);
    for (const version of PREFIX_PAIR) assert.equal(files.filter((name) => name.startsWith(`${version}_`)).length, 1, `mirror preserves ${version} exactly once`);
    assert.deepEqual(files.filter((name) => EXPECTED_PENDING.includes(name)), EXPECTED_PENDING);
    assert.equal(files.length, remoteVersions.length + EXPECTED_PENDING.length);
    assert.ok(!files.includes('003_dup_a.sql') && !files.includes('003_dup_b.sql'), 'grandfathered duplicate source files are never copied');
    assert.deepEqual(built.pendingFiles.map((file) => file.filename), EXPECTED_PENDING);
    // Mirror files are never repository migrations.
    for (const id of PRODUCTION_ONLY) assert.ok(!existsSync(join(fixture.repo, 'supabase', 'migrations', files.find((name) => name.startsWith(id)))));
  } finally {
    built.cleanup();
  }
  assert.ok(!existsSync(built.workspace), 'workspace removed');
  assert.deepEqual(readdirSync(fixture.runnerTemp), []);
  assert.deepEqual(directoryListing(join(fixture.repo, 'supabase', 'migrations')), repositoryBefore, 'repository migrations untouched');
  assert.deepEqual(historySnapshot(), historyBefore, 'building and dry-running never changes production history');
  assert.ok(noRepairOrPull(recorder.calls));
});

test('plan: the CLI dry run proposes exactly the evaluator\'s pending set, with no already-applied migration', { skip }, () => {
  const recorder = recordingRunner();
  const historyBefore = historySnapshot();
  const plan = runPlan(options(), { runSupabase: recorder.runSupabase, log: () => {} });
  assert.deepEqual(plan.pending, EXPECTED_PENDING);
  assert.ok(!plan.pending.some((name) => /^0201?_/.test(name)), '020 / 0201 are never proposed again');
  assert.deepEqual(historySnapshot(), historyBefore);
  const verbs = recorder.calls.map((args) => args.slice(0, 2).join(' '));
  assert.deepEqual(verbs, ['--version', 'migration fetch', 'db push']);
  assert.ok(recorder.calls.at(-1).includes('--dry-run') && recorder.calls.at(-1).includes('--include-all'));
  assert.ok(!recorder.calls.at(-1).includes('--yes'));
  assert.ok(noRepairOrPull(recorder.calls));
  assert.deepEqual(readdirSync(fixture.runnerTemp), []);
});

test('apply: rebuilds from scratch, applies exactly the verified set, and records it through the CLI only', { skip }, () => {
  const before = historySnapshot();
  const recorder = recordingRunner();
  const result = runApply(options(), { runSupabase: recorder.runSupabase, log: () => {} });
  assert.deepEqual(result.applied, EXPECTED_PENDING);

  const verbs = recorder.calls.map((args) => `${args[0]} ${args[1] ?? ''}`.trim());
  assert.deepEqual(verbs, ['--version', 'migration fetch', 'db push', '--version', 'migration fetch', 'db push', 'db push']);
  const pushes = recorder.calls.filter((args) => args[0] === 'db');
  assert.ok(pushes[0].includes('--dry-run') && pushes[1].includes('--dry-run'));
  assert.ok(!pushes[2].includes('--dry-run') && pushes[2].includes('--yes') && pushes[2].includes('--include-all'));
  const workspaces = recorder.calls.filter((args) => args[1] === 'fetch').map((args) => args[args.indexOf('--workdir') + 1]);
  assert.equal(new Set(workspaces).size, 2, 'the pre-mutation workspace is rebuilt from scratch, not reused');
  assert.ok(noRepairOrPull(recorder.calls));
  assert.deepEqual(readdirSync(fixture.runnerTemp), [], 'workspace removed after apply');

  const after = historySnapshot();
  assert.equal(after.length, before.length + EXPECTED_PENDING.length);
  for (const row of before) {
    assert.deepEqual(after.find((candidate) => candidate.version === row.version), row, `original row ${row.version} unchanged (incl. xmin)`);
  }
  const added = after.filter((row) => !before.some((original) => original.version === row.version));
  assert.deepEqual(added.map((row) => row.version), ['004', '204', '205']);
  assert.deepEqual(added.map((row) => row.name), ['new_feature', 'reconcile_dup_a', 'other_new']);
  for (const row of added) assert.ok(row.statements.length > 0, `${row.version} recorded with its statements by the CLI`);
  assert.equal(psql("select count(*) from information_schema.tables where table_name in ('t_new_feature','t_other_new')"), '2');
  assert.equal(psql("select count(*) from information_schema.columns where table_name = 't_dup_a' and column_name = 'reconciled'"), '1');
  for (const id of [...PRODUCTION_ONLY, ...PREFIX_PAIR]) assert.equal(after.some((row) => row.version === id), true);
});

test('post-apply: drift is CLEAN, attestations are exact and 204 is recorded by normal application', { skip }, () => {
  const lines = [];
  assert.deepEqual(verifyApplied(options(), { log: (line) => lines.push(line) }), { status: 'CLEAN' });
  assert.ok(lines.includes('Status: CLEAN'));
  assert.ok(lines.some((line) => /attestations: 2 of 2/.test(line)));
  assert.equal(psql("select count(*) from supabase_migrations.schema_migrations where version = '204'"), '1');

  // The real drift CLI, run exactly as the workflow runs it, from a repository-shaped working directory.
  const drift = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'check-db-drift.mjs'), '--environment', 'production'], {
    cwd: fixture.repo, encoding: 'utf8', env: { ...process.env, PRODUCTION_SUPABASE_DB_URL: fixture.databaseUrl },
  });
  assert.equal(drift.status, 0, drift.stdout + drift.stderr);
  assert.match(drift.stdout, /^Status: CLEAN$/m);
  assert.match(drift.stdout, /Pending on production: <none>/);
});

test('a second apply finds nothing pending and performs no mutating CLI call', { skip }, () => {
  const recorder = recordingRunner();
  const historyBefore = historySnapshot();
  assert.deepEqual(runPlan(options(), { runSupabase: recorder.runSupabase, log: () => {} }).pending, []);
  assert.deepEqual(runApply(options(), { runSupabase: recorder.runSupabase, log: () => {} }).applied, []);
  assert.ok(recorder.calls.every((args) => args[0] !== 'db' || args.includes('--dry-run')));
  assert.deepEqual(historySnapshot(), historyBefore);
});

test('the CLI entry point runs plan and verify-applied through the real production target guard', { skip }, () => {
  const environment = {
    ...process.env,
    SUPABASE_CLI_BIN: CLI_BIN,
    RUNNER_TEMP: fixture.runnerTemp,
    PRODUCTION_SUPABASE_DB_URL: fixture.databaseUrl,
    PRODUCTION_SUPABASE_URL: 'https://synthetic-production.example',
    PRODUCTION_EXPECTED_DATABASE_HOST: '127.0.0.1',
    PRODUCTION_EXPECTED_SUPABASE_HOST: 'synthetic-production.example',
    STAGING_DATABASE_HOST: 'staging-db.invalid',
    STAGING_SUPABASE_HOST: 'staging.invalid',
  };
  const run = (command, overrides = {}) => spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'production-migration-apply-workspace.mjs'), command], {
    cwd: fixture.repo, encoding: 'utf8', env: { ...environment, ...overrides },
  });
  const plan = run('plan');
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  assert.match(plan.stdout, /Verified production apply workspace: \d+ mirrored history versions, 0 pending migration\(s\)\./);
  const applied = run('verify-applied');
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.match(applied.stdout, /^Status: CLEAN$/m);
  // A database that is not the expected production host is refused before any CLI or database access.
  const refused = run('plan', { PRODUCTION_EXPECTED_DATABASE_HOST: 'someone-else.example' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Refusing production action/);
  assert.ok(!(`${plan.stdout}${plan.stderr}${refused.stdout}${refused.stderr}`).includes('postgres:postgres'), 'the database URL is never printed');
});
