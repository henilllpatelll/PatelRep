#!/usr/bin/env node
/**
 * Forward-only migration apply for the PERSISTENT shared staging database, through an EPHEMERAL Supabase workspace.
 *
 * Why this exists: `supabase db push` against the full repository directory refuses to run on staging because the
 * repository holds grandfathered duplicate versions (039, 042, 110) while supabase_migrations.schema_migrations holds
 * one row per version ("Found local migration files to be inserted before the last migration on remote database").
 * `--include-all` on the full directory would try to replay that old SQL (including DROP INDEX), and rewriting history
 * is forbidden. Same approach as production-migration-apply-workspace.mjs, built for staging:
 *   1. the staging target is proven by staging-target-guard.mjs (and must not be the production host),
 *   2. history is read read-only; unknown/incompatible history, destructive pending SQL and a pending version without
 *      exactly one repository file fail closed (staging-migration-plan.mjs is the independent planner),
 *   3. every grandfathered duplicate file must have a passing read-only effect probe (staging-duplicate-coverage.json):
 *      a recorded version row is NOT proof that every file sharing that version ran,
 *   4. the workspace mirrors the recorded history (`supabase migration fetch`), equal to our own live read, plus ONLY
 *      the exact pending repository files, and the pinned CLI's `db push --dry-run` must propose exactly that set,
 *   5. a full rebuild + second dry run precedes the single real push (TOCTOU boundary).
 * `--include-all` is only ever passed inside such a verified workspace. Historical SQL is never replayed, nothing is
 * reset, wiped or repaired, and this script never writes migration history itself.
 *
 * Usage: node scripts/staging-migration-apply-workspace.mjs plan|apply|verify-applied
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { evaluateLiveMigrationDrift, normalizeVersion } from './check-db-drift.mjs';
import { sha256 } from './check-migrations.mjs';
import {
  PINNED_SUPABASE_CLI_VERSION,
  createSupabaseRunner,
  parseAppliedMigrations,
  parseDryRunOutput,
  selectPendingMigrationFiles,
  versionOfCliFilename,
} from './production-migration-apply-workspace.mjs';
import { assertStagingTarget } from './staging-target-guard.mjs';
import { planStagingMigrations } from './staging-migration-plan.mjs';
import {
  CANDIDATE_MIGRATIONS_ENV,
  assertTrustedControlPlaneFromEnvironment,
  trustedControlPlaneRequired,
} from './staging-trusted-control-plane.mjs';

export { PINNED_SUPABASE_CLI_VERSION };

/** The URL itself plus its password component, so a bare password echoed by a tool is redacted too. */
function secretsOf(databaseUrl) {
  try {
    return [databaseUrl, decodeURIComponent(new URL(databaseUrl).password)];
  } catch {
    return [databaseUrl];
  }
}

function redact(text, secrets = []) {
  let output = String(text ?? '');
  for (const secret of secrets) if (secret) output = output.split(secret).join('<redacted>');
  return output.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://<redacted>');
}

function sameSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && right.every((item) => left.includes(item));
}

/** Validate the registry against the repository: one entry per file in every duplicate-version group, hashes pinned. */
export function loadDuplicateCoverageRegistry(registryPath, migrations) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    throw new Error('Unable to read the staging duplicate-coverage registry.');
  }
  const fail = (message) => { throw new Error(`Staging duplicate-coverage registry: ${message}`); };
  if (registry.schema_version !== 1 || registry.environment !== 'staging' || !Array.isArray(registry.files)) fail('malformed.');
  const byVersion = new Map();
  for (const migration of migrations) {
    if (!migration.version) continue;
    const key = normalizeVersion(migration.version);
    byVersion.set(key, [...(byVersion.get(key) ?? []), migration]);
  }
  const duplicateFiles = [...byVersion.values()].filter((group) => group.length > 1).flat();
  const entries = new Map();
  for (const entry of registry.files) {
    if (entries.has(entry.file)) fail(`duplicate entry for ${entry.file}.`);
    if (typeof entry.probe !== 'string' || !/^\s*select\b/i.test(entry.probe) || entry.probe.includes(';')) fail(`${entry.file} needs a single read-only SELECT probe.`);
    entries.set(entry.file, entry);
  }
  for (const migration of duplicateFiles) {
    const entry = entries.get(migration.filename);
    if (!entry) fail(`${migration.filename} shares version ${migration.version} with another file but has no probe; refusing to assume it ran.`);
    if (entry.sha256 !== sha256(migration.content)) fail(`${migration.filename} changed since its probe was written.`);
  }
  for (const file of entries.keys()) {
    if (!duplicateFiles.some((migration) => migration.filename === file)) fail(`${file} is not a duplicate-version migration.`);
  }
  return [...entries.values()];
}

/** Run every probe read-only; each must return exactly `t`. */
export function verifyDuplicateCoverage(databaseUrl, entries, run = defaultProbeRunner) {
  const failed = [];
  for (const entry of entries) {
    let output;
    try {
      output = run(databaseUrl, entry.probe);
    } catch {
      throw new Error(`Unable to run the read-only coverage probe for ${entry.file}.`);
    }
    if (String(output).trim() !== 't') failed.push(entry.file);
  }
  if (failed.length) {
    throw new Error(`Historical duplicate migration coverage is not proven on staging for: ${failed.join(', ')}. Refusing to continue; old SQL is never replayed.`);
  }
}

function defaultProbeRunner(databaseUrl, probe) {
  return execFileSync('psql', [
    '--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', databaseUrl, '--tuples-only', '--no-align',
    '--command', 'SET default_transaction_read_only = on', '--command', probe,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\n').filter(Boolean).pop() ?? '';
}

function listWorkspaceMigrations(directory) {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) throw new Error(`Apply workspace contains an unexpected entry: ${entry.name}.`);
    const version = versionOfCliFilename(entry.name);
    if (!version) throw new Error(`Apply workspace contains a file the Supabase CLI cannot version: ${entry.name}.`);
    return { filename: entry.name, version };
  });
}

/** The fetched mirror must represent exactly the live recorded history -- raw version strings, no more, no fewer. */
export function verifyFetchedMirror(directory, remoteRows) {
  const mirror = listWorkspaceMigrations(directory);
  const mirrorVersions = mirror.map((file) => file.version);
  if (new Set(mirrorVersions).size !== mirrorVersions.length) throw new Error('Fetched migration mirror contains duplicate versions.');
  const remoteVersions = remoteRows.map((row) => String(row.version));
  if (new Set(remoteVersions).size !== remoteVersions.length) throw new Error('Live staging migration history contains duplicate versions.');
  const missing = remoteVersions.filter((version) => !mirrorVersions.includes(version));
  const extra = mirrorVersions.filter((version) => !remoteVersions.includes(version));
  if (missing.length || extra.length) {
    throw new Error(`Fetched migration mirror disagrees with live staging history (missing: ${missing.join(', ') || '<none>'}; extra: ${extra.join(', ') || '<none>'}).`);
  }
  return mirror;
}

function resolveContext(options, deps) {
  const secrets = secretsOf(options.databaseUrl);
  const binary = options.supabaseBin ?? process.env.SUPABASE_CLI_BIN ?? 'supabase';
  return {
    options,
    secrets,
    log: deps.log ?? ((message) => console.log(message)),
    runSupabase: deps.runSupabase ?? createSupabaseRunner(binary, secrets),
    evaluateLive: deps.evaluateLive ?? ((allowPending) => evaluateLiveMigrationDrift({
      environment: 'staging', databaseUrl: options.databaseUrl, allowPending, migrationsDirectory: options.migrationsDirectory,
    })),
    assertTarget: deps.assertTarget ?? (() => {
      if (!options.target.productionDatabaseHost || !options.target.productionSupabaseHost) {
        throw new Error('Refusing database action: production host allowlists (PRODUCTION_DATABASE_HOST, PRODUCTION_SUPABASE_HOST) are required.');
      }
      assertStagingTarget(options.target);
    }),
    probeRunner: deps.probeRunner ?? defaultProbeRunner,
  };
}

// The CLI switches to JSON output when it detects an AI-agent environment; the plan/apply parsing only understands the
// documented text output, so detection is pinned off for every workspace invocation.
const DETERMINISTIC_OUTPUT_FLAGS = ['--agent', 'no', '--output-format', 'text'];

function runCli(context, label, args, workspace) {
  const result = context.runSupabase([...args, ...DETERMINISTIC_OUTPUT_FLAGS], { cwd: workspace });
  if (result.status !== 0) {
    const detail = redact(`${result.stdout}\n${result.stderr}`, context.secrets).split(/\r?\n/).filter(Boolean).slice(-12).join('\n');
    throw new Error(`Supabase CLI ${label} failed with status ${result.status}.\n${detail}`);
  }
  return result;
}

function assertPinnedCli(context) {
  const result = context.runSupabase(['--version'], { cwd: tmpdir() });
  const version = String(result.stdout).trim().split(/\r?\n/)[0];
  if (result.status !== 0 || version !== PINNED_SUPABASE_CLI_VERSION) {
    throw new Error(`Supabase CLI must be exactly ${PINNED_SUPABASE_CLI_VERSION}; found ${JSON.stringify(redact(version).slice(0, 40))}.`);
  }
}

function removeWorkspace(workspace) {
  if (!workspace) return;
  rmSync(workspace, { recursive: true, force: true });
  if (existsSync(workspace)) throw new Error('Unable to remove the ephemeral staging apply workspace.');
}

/** Independent plan: trusted history + destructive-SQL rejection + exactly one file per pending version + coverage. */
function independentPlan(context, label) {
  const live = context.evaluateLive(true);
  const plan = planStagingMigrations({ evaluation: live.evaluation, migrations: live.migrations });
  const pendingFiles = selectPendingMigrationFiles(live.evaluation.missingOnRemote, live.migrations);
  if (!sameSet(plan.pending, pendingFiles.map((file) => file.filename))) {
    throw new Error(`${label}: planner and file selection disagree; stopping.`);
  }
  const entries = loadDuplicateCoverageRegistry(resolve(context.options.coveragePath), live.migrations);
  verifyDuplicateCoverage(context.options.databaseUrl, entries, context.probeRunner);
  return { live, pendingFiles };
}

/** One full verification pass. Any failure removes the workspace before rethrowing. */
export function buildVerifiedApplyWorkspace(options, deps = {}) {
  const context = resolveContext(options, deps);
  const { log } = context;

  context.assertTarget();
  assertPinnedCli(context);
  const initial = independentPlan(context, 'Initial staging evidence');
  const pending = initial.live.evaluation.missingOnRemote;

  const root = options.runnerTemp ?? process.env.RUNNER_TEMP ?? tmpdir();
  mkdirSync(root, { recursive: true });
  const workspace = mkdtempSync(join(root, 'staging-migration-apply-'));
  try {
    const supabaseDirectory = join(workspace, 'supabase');
    const migrationsDirectory = join(supabaseDirectory, 'migrations');
    mkdirSync(supabaseDirectory, { recursive: true });
    copyFileSync(resolve(options.configPath), join(supabaseDirectory, 'config.toml'));
    runCli(context, 'migration fetch', ['migration', 'fetch', '--db-url', options.databaseUrl, '--workdir', workspace], workspace);

    // Do not trust the fetch: compare with our own live read after it.
    const after = independentPlan(context, 'Post-fetch staging evidence');
    if (!sameSet(after.live.evaluation.missingOnRemote, pending)
      || !sameSet(after.live.remoteRows.map((row) => row.version), initial.live.remoteRows.map((row) => row.version))) {
      throw new Error('Staging migration history changed while the apply workspace was being built; stopping.');
    }
    const mirror = verifyFetchedMirror(migrationsDirectory, after.live.remoteRows);
    const pendingSet = new Set(pending.map(normalizeVersion));
    if (mirror.some((file) => pendingSet.has(normalizeVersion(file.version)))) {
      throw new Error('Fetched migration mirror unexpectedly represents a pending migration version; stopping.');
    }

    for (const file of initial.pendingFiles) {
      if (mirror.some((item) => item.filename === file.filename)) throw new Error(`Pending migration ${file.filename} collides with a fetched mirror file; stopping.`);
      copyFileSync(resolve(options.migrationsDirectory, file.filename), join(migrationsDirectory, file.filename));
    }
    const finalFiles = listWorkspaceMigrations(migrationsDirectory).map((file) => file.filename);
    if (!sameSet(finalFiles, [...mirror.map((file) => file.filename), ...initial.pendingFiles.map((file) => file.filename)])) {
      throw new Error('Apply workspace contents differ from the verified plan; stopping.');
    }

    // --include-all is confined to this verified workspace; the dry run must propose exactly the independent plan.
    const dryRun = runCli(
      context, 'db push --dry-run',
      ['db', 'push', '--db-url', options.databaseUrl, '--workdir', workspace, '--dry-run', '--include-all'],
      workspace,
    );
    const proposed = parseDryRunOutput(`${dryRun.stdout}\n${dryRun.stderr}`);
    const expected = initial.pendingFiles.map((file) => file.filename);
    if (!sameSet(proposed, expected)) {
      throw new Error(`Supabase CLI dry run proposes ${JSON.stringify(proposed)} but the independent plan is ${JSON.stringify(expected)}; stopping.`);
    }
    log(`Verified staging apply workspace: ${mirror.length} mirrored history versions, ${expected.length} pending migration(s).`);
    for (const file of expected) log(`  would apply ${file}`);
    return { workspace, pendingFiles: initial.pendingFiles, mirrorCount: mirror.length, cleanup: () => removeWorkspace(workspace), context };
  } catch (error) {
    removeWorkspace(workspace);
    throw error;
  }
}

/** Verification only: build, report, always remove the workspace. No mutation. */
export function runPlan(options, deps = {}) {
  const built = buildVerifiedApplyWorkspace(options, deps);
  try {
    return { pending: built.pendingFiles.map((file) => file.filename), mirrorCount: built.mirrorCount };
  } finally {
    built.cleanup();
  }
}

/** Verification pass, then a full rebuild (history revalidated immediately before applying), then one real push. */
export function runApply(options, deps = {}) {
  const first = buildVerifiedApplyWorkspace(options, deps);
  first.cleanup();
  const second = buildVerifiedApplyWorkspace(options, deps);
  try {
    const expected = second.pendingFiles.map((file) => file.filename);
    if (!sameSet(first.pendingFiles.map((file) => file.filename), expected)) {
      throw new Error('Pending migrations changed between the verification pass and the rebuild; stopping.');
    }
    if (expected.length === 0) {
      second.context.log('No pending staging migrations; nothing to apply.');
      return { applied: [] };
    }
    const result = runCli(
      second.context, 'db push',
      ['db', 'push', '--db-url', options.databaseUrl, '--workdir', second.workspace, '--include-all', '--yes'],
      second.workspace,
    );
    const applied = parseAppliedMigrations(`${result.stdout}\n${result.stderr}`);
    for (const filename of applied) second.context.log(`Applied ${filename}`);
    if (applied.length !== expected.length || !sameSet(applied, expected)) {
      throw new Error(`Supabase CLI applied ${JSON.stringify(applied)}, which differs from the verified plan ${JSON.stringify(expected)}.`);
    }
    return { applied };
  } finally {
    second.cleanup();
  }
}

/** Post-apply proof: nothing pending, nothing unknown, history equals this candidate, duplicate coverage still proven. */
export function verifyApplied(options, deps = {}) {
  const context = resolveContext(options, deps);
  context.assertTarget();
  const live = context.evaluateLive(false);
  if (live.evaluation.status !== 'CLEAN') throw new Error(`Post-apply staging drift status is ${live.evaluation.status}, not CLEAN.`);
  verifyDuplicateCoverage(options.databaseUrl, loadDuplicateCoverageRegistry(resolve(options.coveragePath), live.migrations), context.probeRunner);
  context.log('Status: CLEAN');
  return { status: 'CLEAN' };
}

export function optionsFromEnvironment(environment = process.env) {
  const databaseUrl = environment.STAGING_SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('STAGING_SUPABASE_DB_URL is required; it is never printed.');
  return {
    databaseUrl,
    runnerTemp: environment.RUNNER_TEMP || tmpdir(),
    // The candidate's migrations are DATA; every other input (config, registries) comes from the trusted checkout.
    migrationsDirectory: environment[CANDIDATE_MIGRATIONS_ENV] || 'supabase/migrations',
    configPath: 'supabase/config.toml',
    coveragePath: 'supabase/staging-duplicate-coverage.json',
    target: {
      databaseUrl,
      supabaseUrl: environment.STAGING_SUPABASE_URL,
      expectedDatabaseHost: environment.STAGING_EXPECTED_DATABASE_HOST,
      expectedSupabaseHost: environment.STAGING_EXPECTED_SUPABASE_HOST,
      productionDatabaseHost: environment.PRODUCTION_DATABASE_HOST ?? '',
      productionSupabaseHost: environment.PRODUCTION_SUPABASE_HOST ?? '',
    },
  };
}

function main() {
  const command = process.argv[2];
  const commands = { plan: runPlan, apply: runApply, 'verify-applied': verifyApplied };
  if (!commands[command]) throw new Error('Usage: staging-migration-apply-workspace.mjs plan|apply|verify-applied');
  const options = optionsFromEnvironment();
  try {
    // Fail closed before any CLI or database access: in Actions this driver must be the trusted main copy.
    if (trustedControlPlaneRequired()) assertTrustedControlPlaneFromEnvironment();
    const result = commands[command](options);
    if (process.env.GITHUB_OUTPUT && result.pending) appendFileSync(process.env.GITHUB_OUTPUT, `has_pending=${result.pending.length > 0}\n`);
  } catch (error) {
    console.error(`::error::${redact(error.message, secretsOf(options.databaseUrl)).split('\n')[0]}`);
    console.error(redact(error.message, secretsOf(options.databaseUrl)));
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
