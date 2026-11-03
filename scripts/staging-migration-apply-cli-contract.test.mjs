/**
 * Real-CLI contract for the staging migration apply path.
 *
 * Runs the ACTUAL pinned Supabase CLI against a disposable, TLS-enabled PostgreSQL container whose migration history is
 * shaped like persistent staging: ONE recorded row per grandfathered duplicate version (039, 042, 110), a 020 / 0201
 * digit-prefix pair, and pending forward migrations 232-235 (including a policy + trigger like migration 234).
 * It never touches a shared database: every target is a throwaway loopback container.
 *
 * Required in CI (job "Supabase CLI Apply Contract"); needs docker, psql and the pinned supabase CLI. With
 * REQUIRE_SUPABASE_CLI_APPLY_CONTRACT=1 a missing prerequisite FAILS instead of skipping.
 * Optional env: SUPABASE_CLI_BIN (path to the pinned CLI binary).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';

import { sha256 } from './check-migrations.mjs';
import { PINNED_SUPABASE_CLI_VERSION, createSupabaseRunner } from './production-migration-apply-workspace.mjs';
import { runApply, runPlan, verifyApplied } from './staging-migration-apply-workspace.mjs';

const REQUIRED = process.env.REQUIRE_SUPABASE_CLI_APPLY_CONTRACT === '1';
const CLI_BIN = process.env.SUPABASE_CLI_BIN || 'supabase';
const REPO_ROOT = resolve('.');
const CONTAINER = `patelrep-stg-apply-contract-${process.pid}`;
const IMAGE = 'postgres:16-alpine';

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
  test('required prerequisites for the staging real-CLI apply contract are present', () => {
    assert.fail(`Missing prerequisites (docker, psql, supabase ${PINNED_SUPABASE_CLI_VERSION}): ${missing.join(', ')}`);
  });
}

const fixture = {};

function psql(sql) {
  return execFileSync('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', fixture.databaseUrl, '--tuples-only', '--no-align', '--command', sql], { encoding: 'utf8' }).trim();
}

/** Full recorded history, including xmin (changes if a row is ever updated), for byte-level comparisons. */
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
  return { calls, runSupabase: (args, context) => { calls.push(args.map((arg) => (arg === fixture.databaseUrl ? '<db-url>' : arg))); return real(args, context); } };
}

function options(overrides = {}) {
  return {
    databaseUrl: fixture.databaseUrl,
    runnerTemp: fixture.runnerTemp,
    migrationsDirectory: join(fixture.repo, 'supabase', 'migrations'),
    configPath: join(fixture.repo, 'supabase', 'config.toml'),
    coveragePath: join(fixture.repo, 'supabase', 'staging-duplicate-coverage.json'),
    supabaseBin: CLI_BIN,
    target: {
      databaseUrl: fixture.databaseUrl,
      supabaseUrl: 'https://synthetic-staging.example',
      expectedDatabaseHost: '127.0.0.1',
      expectedSupabaseHost: 'synthetic-staging.example',
      productionDatabaseHost: 'production-db.invalid',
      productionSupabaseHost: 'production.invalid',
    },
    ...overrides,
  };
}

function startDisposablePostgres() {
  const port = String(57000 + (process.pid % 2000));
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

const HISTORICAL = [
  ['001_init.sql', 'create table public.t_init (id int);'],
  ['002_second.sql', 'create table public.t_second (id int);'],
  ['020_fix_credits_decimal.sql', 'create table public.t_v020 (id int);'],
  ['0201_logbook_expires.sql', 'create table public.t_v0201 (id int);'],
  ['039_drop_room_status_history_trigger.sql', 'create table public.t_v039 (id int);'],
  ['042_guest_requests_priority.sql', 'create table public.t_v042 (id int);'],
  ['110_room_unavailability_type.sql', 'create table public.t_v110 (id int);'],
];
// The "extra" duplicate files staging NEVER recorded. Their SQL would be destructive/unsafe if replayed: the canary
// table below must survive every run.
const DUPLICATE_EXTRAS = [
  ['039_drop_unused_indexes.sql', 'drop table public.t_canary_never_replay;'],
  ['042_room_assignment_clean_type.sql', 'drop table public.t_canary_never_replay;'],
  ['110_work_order_console_features.sql', 'drop table public.t_canary_never_replay;'],
];
const PENDING = [
  ['232_engineering_pm_assets_foundation.sql', 'create table public.t_pm_foundation (id int primary key);'],
  ['233_asset_identity_photo_and_version.sql', 'alter table public.t_pm_foundation add column if not exists photo text;'],
  ['234_pm_management_assignments.sql', [
    'create table if not exists public.t_pm_events (id int primary key, tenant_id uuid);',
    'alter table public.t_pm_events enable row level security;',
    'do $policy$ begin if not exists (select 1 from pg_policies where schemaname = \'public\' and tablename = \'t_pm_events\' and policyname = \'t_pm_events_select\') then',
    '  create policy t_pm_events_select on public.t_pm_events for select to postgres using (true); end if; end $policy$;',
    'create or replace function public.t_noop() returns trigger language plpgsql as $f$ begin return new; end $f$;',
    'create or replace trigger t_noop_trg before insert on public.t_pm_events for each row execute function public.t_noop();',
  ].join('\n')],
  ['235_pm_corrective_item_link.sql', 'alter table public.t_pm_foundation add column if not exists item_link text;'],
];

function probeFor(file, table) {
  return { file, sha256: '', probe: `select to_regclass('public.${table}') is not null` };
}

function buildFixtures() {
  fixture.root = mkdtempSync(join(tmpdir(), 'stg-apply-contract-'));
  fixture.runnerTemp = join(fixture.root, 'runner-temp');
  mkdirSync(fixture.runnerTemp);

  // Seed the "remote" history with the CLI itself: exactly one row per historical VERSION, like staging.
  const seed = join(fixture.root, 'seed');
  mkdirSync(join(seed, 'supabase'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'supabase', 'config.toml'), join(seed, 'supabase', 'config.toml'));
  for (const [file, sql] of HISTORICAL) writeMigration(join(seed, 'supabase', 'migrations'), file, sql);
  const seeded = cliInDirectory(['db', 'push', '--db-url', fixture.databaseUrl, '--yes'], seed);
  assert.equal(seeded.status, 0, `seeding remote history failed: ${seeded.stdout}${seeded.stderr}`);
  psql('create table public.t_canary_never_replay (id int)');

  // Repository: the historical files, the never-recorded duplicate extras, and pending 232-235.
  fixture.repo = join(fixture.root, 'repo');
  const repoMigrations = join(fixture.repo, 'supabase', 'migrations');
  mkdirSync(join(fixture.repo, 'supabase'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'supabase', 'config.toml'), join(fixture.repo, 'supabase', 'config.toml'));
  for (const [file, sql] of [...HISTORICAL, ...DUPLICATE_EXTRAS, ...PENDING]) writeMigration(repoMigrations, file, sql);
  const duplicateFiles = ['039_drop_room_status_history_trigger.sql', '039_drop_unused_indexes.sql', '042_guest_requests_priority.sql',
    '042_room_assignment_clean_type.sql', '110_room_unavailability_type.sql', '110_work_order_console_features.sql'];
  const tableOf = { '039_drop_room_status_history_trigger.sql': 't_v039', '042_guest_requests_priority.sql': 't_v042', '110_room_unavailability_type.sql': 't_v110' };
  writeFileSync(join(fixture.repo, 'supabase', 'staging-duplicate-coverage.json'), JSON.stringify({
    schema_version: 1, environment: 'staging',
    files: duplicateFiles.map((file) => ({
      file,
      sha256: sha256(readFileSync(join(repoMigrations, file), 'utf8')),
      description: 'synthetic contract fixture',
      probe: tableOf[file] ? probeFor(file, tableOf[file]).probe : "select to_regclass('public.t_canary_never_replay') is not null",
    })),
  }));
}

before(() => {
  if (skip || missing.length) return;
  startDisposablePostgres();
  buildFixtures();
});

after(() => {
  if (!fixture.root) return;
  spawnSync('docker', ['rm', '--force', CONTAINER], { stdio: 'ignore' });
  rmSync(fixture.root, { recursive: true, force: true });
});

const PENDING_FILES = PENDING.map(([file]) => file);

test('ROOT CAUSE: plain `db push` of the full repository directory is refused by the pinned CLI', { skip }, () => {
  const result = cliInDirectory(['db', 'push', '--db-url', fixture.databaseUrl, '--workdir', fixture.repo, '--dry-run'], fixture.repo);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Found local migration files to be inserted before the last migration on remote database/);
});

test('plan: the real CLI dry run proposes exactly 232-235, mutates nothing and leaves no workspace', { skip }, () => {
  const before = historySnapshot();
  const runner = recordingRunner();
  assert.deepEqual(runPlan(options(), { runSupabase: runner.runSupabase, log: () => {} }).pending, PENDING_FILES);
  assert.deepEqual(historySnapshot(), before, 'history bytes (and xmin) are untouched');
  assert.deepEqual(readdirSync(fixture.runnerTemp), []);
  assert.ok(runner.calls.every((args) => !(args[0] === 'db' && args[1] === 'push' && !args.includes('--dry-run'))));
  assert.equal(psql("select to_regclass('public.t_pm_foundation') is null"), 't', 'no pending SQL ran');
});

test('apply: records exactly 232-235 through normal tracking, never replays historical duplicate SQL', { skip }, () => {
  const before = historySnapshot();
  const runner = recordingRunner();
  assert.deepEqual(runApply(options(), { runSupabase: runner.runSupabase, log: () => {} }).applied, PENDING_FILES);
  const after = historySnapshot();
  assert.deepEqual(after.filter((row) => PENDING_FILES.some((file) => file.startsWith(row.version))).map((row) => row.version), ['232', '233', '234', '235']);
  assert.deepEqual(after.filter((row) => !['232', '233', '234', '235'].includes(row.version)), before, 'every historical row is byte-identical (no repair, no rewrite)');
  assert.equal(psql("select to_regclass('public.t_canary_never_replay') is not null"), 't', 'destructive duplicate SQL was never replayed');
  assert.equal(psql("select count(*) from pg_policies where tablename = 't_pm_events'"), '1');
  assert.equal(psql("select count(*) from pg_trigger where tgname = 't_noop_trg'"), '1');
  assert.deepEqual(readdirSync(fixture.runnerTemp), []);
});

test('post-apply: verify-applied is CLEAN and a second run is an idempotent no-op', { skip }, () => {
  const before = historySnapshot();
  assert.deepEqual(verifyApplied(options(), { log: () => {} }), { status: 'CLEAN' });
  const runner = recordingRunner();
  assert.deepEqual(runPlan(options(), { runSupabase: runner.runSupabase, log: () => {} }).pending, []);
  assert.deepEqual(runApply(options(), { runSupabase: runner.runSupabase, log: () => {} }), { applied: [] });
  assert.ok(runner.calls.every((args) => !(args[0] === 'db' && args[1] === 'push' && !args.includes('--dry-run'))), 'nothing is pushed when nothing is pending');
  assert.deepEqual(historySnapshot(), before);
});

test('partial application: a failing migration stops the run, earlier ones stay recorded, and a retry applies only the remainder', { skip }, () => {
  const repoMigrations = join(fixture.repo, 'supabase', 'migrations');
  writeMigration(repoMigrations, '236_good.sql', 'create table public.t_236 (id int);');
  writeMigration(repoMigrations, '237_bad.sql', 'create table public.t_237 (id int); select 1/0;');
  assert.throws(() => runApply(options(), { runSupabase: createSupabaseRunner(CLI_BIN, [fixture.databaseUrl]), log: () => {} }), (error) => {
    assert.match(error.message, /db push failed/);
    assert.doesNotMatch(error.message, /postgres:postgres/, 'the database URL and password are redacted');
    return true;
  });
  assert.deepEqual(readdirSync(fixture.runnerTemp), []);
  const versions = historySnapshot().map((row) => row.version);
  assert.ok(versions.includes('236') && !versions.includes('237'), 'the failed migration is atomic and unrecorded');
  assert.equal(psql("select to_regclass('public.t_237') is null"), 't');

  writeMigration(repoMigrations, '237_bad.sql', 'create table public.t_237 (id int);');
  assert.deepEqual(runPlan(options(), { log: () => {}, runSupabase: createSupabaseRunner(CLI_BIN, [fixture.databaseUrl]) }).pending, ['237_bad.sql']);
  assert.deepEqual(runApply(options(), { log: () => {}, runSupabase: createSupabaseRunner(CLI_BIN, [fixture.databaseUrl]) }).applied, ['237_bad.sql']);
  assert.equal(psql("select to_regclass('public.t_canary_never_replay') is not null"), 't');
});

test('unknown staging history fails closed: a recorded version the repository does not know', { skip }, () => {
  psql("insert into supabase_migrations.schema_migrations (version, name) values ('999', 'foreign_branch')");
  try {
    assert.throws(() => runApply(options(), { log: () => {}, runSupabase: createSupabaseRunner(CLI_BIN, [fixture.databaseUrl]) }), /Unknown on staging: 999/);
  } finally {
    psql("delete from supabase_migrations.schema_migrations where version = '999'");
  }
});

test('unproven historical duplicate coverage fails closed', { skip }, () => {
  psql('alter table public.t_v042 rename to t_v042_gone');
  try {
    assert.throws(() => runPlan(options(), { log: () => {}, runSupabase: createSupabaseRunner(CLI_BIN, [fixture.databaseUrl]) }), /not proven on staging for: 042_guest_requests_priority\.sql/);
  } finally {
    psql('alter table public.t_v042_gone rename to t_v042');
  }
});
