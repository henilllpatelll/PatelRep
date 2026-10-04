#!/usr/bin/env node
/**
 * Production migration apply through an EPHEMERAL, release-scoped Supabase workspace.
 *
 * Why this exists: production history legitimately contains attested production-only rows (see
 * supabase/production-known-history.json) that have NO repository migration file. The pinned Supabase CLI refuses to
 * `db push` when any remote history version lacks a local file ("Remote migration versions not found in local
 * migrations directory"), and `--include-all` does not change that. Rewriting production history is forbidden, and
 * committing placeholder files is forbidden. Instead each run builds a throwaway workspace that
 *   1. mirrors the ACTUAL remote history (`supabase migration fetch`, read-only against the database),
 *   2. is proven equal to our own independent, read-only live read of that history,
 *   3. overlays ONLY the exact repository files the trusted drift evaluator proved pending, and
 *   4. is proven to produce exactly that pending set under the pinned CLI's own `db push --dry-run`.
 * Only then does the same CLI apply (and itself record) those migrations. Mirror files are never repository
 * migrations, aliases, repository-file proof, committed, uploaded, printed or reused between runs.
 *
 * This script only ever reads migration history (fixed SELECT queries through check-db-drift.mjs) and never writes it.
 *
 * Usage: node scripts/production-migration-apply-workspace.mjs plan|apply|verify-applied
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { evaluateLiveMigrationDrift, normalizeVersion } from './check-db-drift.mjs';
import { loadMigrations } from './check-migrations.mjs';
import { assertProductionTarget } from './production-target-guard.mjs';

export const PINNED_SUPABASE_CLI_VERSION = '2.112.0';

const CLI_FILENAME_PATTERN = /^(\d+)_(.*)\.sql$/;
const CLI_NOISE_PATTERNS = [
  /^DRY RUN: migrations will \*not\* be pushed to the database\.$/,
  /^Connecting to remote database\.\.\.$/,
  /^Finished supabase db push\.$/,
  /^A new version of Supabase CLI is available:/,
  /^We recommend updating regularly for new features and bug fixes:/,
];

function redact(text, secrets = []) {
  let output = String(text ?? '');
  for (const secret of secrets) if (secret) output = output.split(secret).join('<redacted>');
  return output.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://<redacted>');
}

export function versionOfCliFilename(filename) {
  const match = String(filename).match(CLI_FILENAME_PATTERN);
  return match ? match[1] : null;
}

const byNumericVersion = (left, right) => {
  const a = BigInt(left);
  const b = BigInt(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/**
 * Strictly parse `supabase db push --dry-run` output. Anything the CLI says beyond the known preamble and the list of
 * migrations it would push (for example a missing-local or repair hint, or an out-of-order warning) is rejected.
 */
export function parseDryRunOutput(output) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  const meaningful = lines.filter((line) => !CLI_NOISE_PATTERNS.some((pattern) => pattern.test(line.trim())));
  if (meaningful.length === 1 && meaningful[0].trim() === 'Remote database is up to date.') return [];
  if (meaningful[0]?.trim() !== 'Would push these migrations:' || meaningful.length < 2) {
    throw new Error(`Supabase CLI dry run produced unexpected output: ${JSON.stringify(redact(meaningful[0] ?? '').slice(0, 160))}.`);
  }
  return meaningful.slice(1).map((line) => {
    const match = line.trim().match(/^[•*-]\s+(\S+\.sql)$/u);
    if (!match) throw new Error(`Supabase CLI dry run listed an unexpected line: ${JSON.stringify(redact(line).slice(0, 160))}.`);
    return match[1];
  });
}

/** Filenames the real apply reported, in order. Used to prove the apply matched the verified plan. */
export function parseAppliedMigrations(output) {
  return [...String(output).matchAll(/^Applying migration (\S+\.sql)\.\.\.$/gm)].map((match) => match[1]);
}

/**
 * Select the exact repository files for the pending versions. Each pending version needs exactly one repository file;
 * grandfathered duplicate source files are never selected here (their gaps close through their unique forward repairs).
 */
export function selectPendingMigrationFiles(pendingVersions, migrations) {
  const filesByVersion = new Map();
  for (const migration of migrations) {
    if (!migration.version) continue;
    const key = normalizeVersion(migration.version);
    filesByVersion.set(key, [...(filesByVersion.get(key) ?? []), migration.filename]);
  }
  return [...pendingVersions].sort(byNumericVersion).map((version) => {
    const files = filesByVersion.get(normalizeVersion(version)) ?? [];
    if (files.length !== 1) {
      throw new Error(`Pending migration version ${version} must match exactly one repository migration file; found ${files.length}.`);
    }
    return { version: normalizeVersion(version), filename: files[0] };
  });
}

function listWorkspaceMigrations(directory) {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) {
      throw new Error(`Apply workspace contains an unexpected entry: ${entry.name}.`);
    }
    const version = versionOfCliFilename(entry.name);
    if (!version) throw new Error(`Apply workspace contains a file the Supabase CLI cannot version: ${entry.name}.`);
    return { filename: entry.name, version };
  });
}

/** The fetched mirror must represent exactly the live remote history -- raw version strings, no more, no fewer. */
export function verifyFetchedMirror(directory, remoteRows) {
  const mirror = listWorkspaceMigrations(directory);
  const mirrorVersions = mirror.map((file) => file.version);
  if (new Set(mirrorVersions).size !== mirrorVersions.length) {
    throw new Error('Fetched migration mirror contains duplicate versions.');
  }
  const remoteVersions = remoteRows.map((row) => String(row.version));
  if (new Set(remoteVersions).size !== remoteVersions.length) {
    throw new Error('Live production migration history contains duplicate versions.');
  }
  const remoteSet = new Set(remoteVersions);
  const missingFromMirror = remoteVersions.filter((version) => !mirrorVersions.includes(version));
  const extraInMirror = mirrorVersions.filter((version) => !remoteSet.has(version));
  if (missingFromMirror.length || extraInMirror.length) {
    throw new Error(
      `Fetched migration mirror disagrees with live production history (missing: ${missingFromMirror.join(', ') || '<none>'}; `
      + `extra: ${extraInMirror.join(', ') || '<none>'}).`,
    );
  }
  return mirror;
}

function assertTrustedProductionEvidence(live, label) {
  const { evaluation, knownHistory } = live;
  if (evaluation.unknownOnRemote.length) {
    throw new Error(`${label}: unknown production migrations present (${evaluation.unknownOnRemote.join(', ')}); stopping.`);
  }
  if (evaluation.unresolvedRemoteRows.length) {
    throw new Error(`${label}: ${evaluation.unresolvedRemoteRows.length} unresolved production migration row(s); stopping.`);
  }
  const attested = evaluation.attestedRows.map((row) => row.remoteId).sort();
  const expected = knownHistory.rows.map((row) => row.remoteId).sort();
  if (attested.length !== expected.length || attested.some((id, index) => id !== expected[index])) {
    throw new Error(`${label}: production known-history attestations are not all verified (verified ${attested.length} of ${expected.length}); stopping.`);
  }
  if (evaluation.duplicateCoverage.incompleteGroups.length) {
    throw new Error(`${label}: duplicate migration coverage is incomplete; stopping.`);
  }
  for (const group of evaluation.duplicateCoverage.groups) {
    for (const repair of group.forwardRepairs ?? []) {
      if (repair.status === 'unapplied') throw new Error(`${label}: forward repair ${repair.repairFile} is neither applied nor pending; stopping.`);
    }
  }
}

function sameSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && right.every((item) => left.includes(item));
}

export function createSupabaseRunner(binary = 'supabase', secrets = []) {
  return (args, { cwd }) => {
    const result = spawnSync(binary, args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env, maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw new Error(`Unable to run the Supabase CLI: ${redact(result.error.message, secrets)}`);
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
}

function resolveContext(options, deps) {
  const secrets = [options.databaseUrl];
  const binary = options.supabaseBin ?? process.env.SUPABASE_CLI_BIN ?? 'supabase';
  return {
    options,
    secrets,
    log: deps.log ?? ((message) => console.log(message)),
    runSupabase: deps.runSupabase ?? createSupabaseRunner(binary, secrets),
    evaluateLive: deps.evaluateLive ?? ((allowPending) => evaluateLiveMigrationDrift({
      environment: 'production',
      databaseUrl: options.databaseUrl,
      allowPending,
      migrationsDirectory: options.migrationsDirectory,
      aliasRegistryPath: options.aliasRegistryPath,
      knownHistoryPath: options.knownHistoryPath,
      forwardRepairPath: options.forwardRepairPath,
    })),
    assertTarget: deps.assertTarget ?? (() => assertProductionTarget(options.target)),
  };
}

function runCli(context, label, args, workspace) {
  const result = context.runSupabase(args, { cwd: workspace });
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
  if (existsSync(workspace)) throw new Error('Unable to remove the ephemeral production apply workspace.');
}

/**
 * One full verification pass (stages 1-5). Returns a verified workspace plus its cleanup. Any failure removes the
 * workspace before rethrowing, so a throw never leaves production SQL on disk.
 */
export function buildVerifiedApplyWorkspace(options, deps = {}) {
  const context = resolveContext(options, deps);
  const { log } = context;

  // Stage 1 -- revalidate production from scratch before anything is built.
  context.assertTarget();
  assertPinnedCli(context);
  const initial = context.evaluateLive(true);
  assertTrustedProductionEvidence(initial, 'Initial production evidence');
  const pending = initial.evaluation.missingOnRemote;
  const pendingFiles = selectPendingMigrationFiles(pending, initial.migrations);

  // Stage 2 -- fresh ephemeral workspace with only the trusted project configuration.
  const root = options.runnerTemp ?? process.env.RUNNER_TEMP ?? tmpdir();
  mkdirSync(root, { recursive: true });
  const workspace = mkdtempSync(join(root, 'production-migration-apply-'));
  try {
    const supabaseDirectory = join(workspace, 'supabase');
    const migrationsDirectory = join(supabaseDirectory, 'migrations');
    mkdirSync(supabaseDirectory, { recursive: true });
    copyFileSync(resolve(options.configPath), join(supabaseDirectory, 'config.toml'));
    runCli(context, 'migration fetch', ['migration', 'fetch', '--db-url', options.databaseUrl, '--workdir', workspace], workspace);

    // Stage 3 -- do not trust the fetch: compare with our own live read and re-prove the attestations.
    const live = context.evaluateLive(true);
    assertTrustedProductionEvidence(live, 'Post-fetch production evidence');
    if (!sameSet(live.evaluation.missingOnRemote, pending)
      || !sameSet(live.remoteRows.map((row) => row.version), initial.remoteRows.map((row) => row.version))) {
      throw new Error('Production migration history changed while the apply workspace was being built; stopping.');
    }
    const mirror = verifyFetchedMirror(migrationsDirectory, live.remoteRows);
    const pendingSet = new Set(pending.map(normalizeVersion));
    if (mirror.some((file) => pendingSet.has(normalizeVersion(file.version)))) {
      throw new Error('Fetched migration mirror unexpectedly represents a pending migration version; stopping.');
    }

    // Stage 4 -- overlay only the exact pending repository files, byte-identical.
    for (const file of pendingFiles) {
      if (mirror.some((item) => item.filename === file.filename)) {
        throw new Error(`Pending migration ${file.filename} collides with a fetched mirror file; stopping.`);
      }
      copyFileSync(resolve(options.migrationsDirectory, file.filename), join(migrationsDirectory, file.filename));
    }
    const finalFiles = listWorkspaceMigrations(migrationsDirectory).map((file) => file.filename);
    const expectedFiles = [...mirror.map((file) => file.filename), ...pendingFiles.map((file) => file.filename)];
    if (!sameSet(finalFiles, expectedFiles)) throw new Error('Apply workspace contents differ from the verified plan; stopping.');

    // Stage 5 -- the real pinned CLI must agree, before any mutation. (CLI >= 2.112.0 handles digit-prefix versions
    // such as 020 / 0201; the real-CLI contract test proves it, so there is no pre-CLI ordering guard.)
    const dryRun = runCli(
      context, 'db push --dry-run',
      ['db', 'push', '--db-url', options.databaseUrl, '--workdir', workspace, '--dry-run', '--include-all'],
      workspace,
    );
    const proposed = parseDryRunOutput(`${dryRun.stdout}
${dryRun.stderr}`);
    if (!sameSet(proposed, pendingFiles.map((file) => file.filename))) {
      throw new Error(
        `Supabase CLI dry run proposes ${JSON.stringify(proposed)} but the drift evaluator proved ${JSON.stringify(pendingFiles.map((file) => file.filename))}; stopping.`,
      );
    }
    log(`Verified production apply workspace: ${mirror.length} mirrored history versions, ${pendingFiles.length} pending migration(s).`);
    for (const file of pendingFiles) log(`  would apply ${file.filename}`);
    return { workspace, pendingFiles, mirrorCount: mirror.length, cleanup: () => removeWorkspace(workspace), context };
  } catch (error) {
    removeWorkspace(workspace);
    throw error;
  }
}

/** Stages 1-5 only: build, verify, report, and always remove the workspace. No mutation. */
export function runPlan(options, deps = {}) {
  const built = buildVerifiedApplyWorkspace(options, deps);
  try {
    return { pending: built.pendingFiles.map((file) => file.filename), mirrorCount: built.mirrorCount };
  } finally {
    built.cleanup();
  }
}

/**
 * Stage 6: a verification pass, then (the TOCTOU boundary) a complete rebuild from scratch, re-read, re-verify and a
 * second dry run, and only then the real apply from that second workspace. The CLI records applied versions itself.
 */
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
      second.context.log('No pending production migrations; nothing to apply.');
      return { applied: [] };
    }
    const result = runCli(
      second.context, 'db push',
      ['db', 'push', '--db-url', options.databaseUrl, '--workdir', second.workspace, '--include-all', '--yes'],
      second.workspace,
    );
    const applied = parseAppliedMigrations(`${result.stdout}
${result.stderr}`);
    for (const filename of applied) second.context.log(`Applied ${filename}`);
    if (applied.length !== expected.length || !sameSet(applied, expected)) {
      throw new Error(`Supabase CLI applied ${JSON.stringify(applied)}, which differs from the verified plan ${JSON.stringify(expected)}.`);
    }
    return { applied };
  } finally {
    second.cleanup();
  }
}

/** Post-apply proof: CLEAN, every attestation still exact, every forward repair recorded by normal application. */
export function verifyApplied(options, deps = {}) {
  const context = resolveContext(options, deps);
  context.assertTarget();
  const live = context.evaluateLive(false);
  const { evaluation, knownHistory, forwardRepairs } = live;
  assertTrustedProductionEvidence(live, 'Post-apply production evidence');
  if (evaluation.status !== 'CLEAN') throw new Error(`Post-apply production drift status is ${evaluation.status}, not CLEAN.`);
  const recorded = new Set(live.remoteRows.map((row) => normalizeVersion(row.version)));
  for (const repair of forwardRepairs.repairs) {
    if (!recorded.has(normalizeVersion(repair.repairVersion))) {
      throw new Error(`Forward repair ${repair.repairFile} is not recorded in production migration history.`);
    }
  }
  context.log('Status: CLEAN');
  context.log(`Verified known production-only attestations: ${evaluation.attestedRows.length} of ${knownHistory.rows.length}`);
  context.log(`Forward repairs recorded: ${forwardRepairs.repairs.map((repair) => repair.repairFile).join(', ') || '<none>'}`);
  return { status: 'CLEAN' };
}

export function optionsFromEnvironment(environment = process.env) {
  const databaseUrl = environment.PRODUCTION_SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('PRODUCTION_SUPABASE_DB_URL is required; it is never printed.');
  return {
    databaseUrl,
    runnerTemp: environment.RUNNER_TEMP || tmpdir(),
    migrationsDirectory: 'supabase/migrations',
    configPath: 'supabase/config.toml',
    aliasRegistryPath: 'supabase/production-migration-aliases.json',
    knownHistoryPath: 'supabase/production-known-history.json',
    forwardRepairPath: 'supabase/production-duplicate-forward-repairs.json',
    target: {
      databaseUrl,
      supabaseUrl: environment.PRODUCTION_SUPABASE_URL,
      expectedDatabaseHost: environment.PRODUCTION_EXPECTED_DATABASE_HOST,
      expectedSupabaseHost: environment.PRODUCTION_EXPECTED_SUPABASE_HOST,
      stagingDatabaseHost: environment.STAGING_DATABASE_HOST ?? '',
      stagingSupabaseHost: environment.STAGING_SUPABASE_HOST ?? '',
    },
  };
}

function main() {
  const command = process.argv[2];
  const commands = { plan: runPlan, apply: runApply, 'verify-applied': verifyApplied };
  if (!commands[command]) throw new Error('Usage: production-migration-apply-workspace.mjs plan|apply|verify-applied');
  const options = optionsFromEnvironment();
  try {
    commands[command](options);
  } catch (error) {
    console.error(`::error::${redact(error.message, [options.databaseUrl]).split('\n')[0]}`);
    console.error(redact(error.message, [options.databaseUrl]));
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
