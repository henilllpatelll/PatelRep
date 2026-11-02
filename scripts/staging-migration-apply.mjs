#!/usr/bin/env node
/**
 * Forward-only apply of the pending migrations to the PERSISTENT shared staging database.
 *
 * Why not a plain `supabase db push`: the repository grandfathers duplicate version files (039, 042, 110, ...). The
 * CLI records one row per version, so it reports the unrecorded sibling files as "local migration files to be inserted
 * before the last migration on remote database" and refuses to push, even though the drift evaluator proved they are
 * covered. `--include-all` would instead re-run those old files (some destructive) against staging, which is never
 * acceptable. Like production, each run therefore builds an ephemeral workspace that mirrors the REAL remote history
 * (`migration fetch`, read-only), overlays ONLY the files the planner proved pending, and pushes from there.
 *
 * Never resets, never repairs history, never prints the database URL. Staging only (guarded earlier in the workflow).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { evaluateLiveMigrationDrift, normalizeVersion } from './check-db-drift.mjs';
import {
  PINNED_SUPABASE_CLI_VERSION, parseAppliedMigrations, selectPendingMigrationFiles, verifyFetchedMirror,
} from './production-migration-apply-workspace.mjs';
import { planStagingMigrations } from './staging-migration-plan.mjs';

const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && b.every((item) => a.includes(item));

function redact(text, secret) {
  let output = String(text ?? '');
  if (secret) output = output.split(secret).join('<redacted>');
  return output.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://<redacted>');
}

function defaultRunSupabase(secret) {
  return (args, cwd) => {
    const result = spawnSync(process.env.SUPABASE_CLI_BIN ?? 'supabase', args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env, maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw new Error(`Unable to run the Supabase CLI: ${redact(result.error.message, secret)}`);
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
}

export function applyStagingMigrations(options, deps = {}) {
  const { databaseUrl } = options;
  const log = deps.log ?? ((message) => console.log(message));
  const run = deps.runSupabase ?? defaultRunSupabase(databaseUrl);
  const evaluateLive = deps.evaluateLive ?? (() => evaluateLiveMigrationDrift({
    environment: 'staging', databaseUrl, allowPending: true, migrationsDirectory: options.migrationsDirectory,
  }));
  const cli = (label, args, cwd) => {
    const result = run(args, cwd);
    if (result.status !== 0) {
      const detail = redact(`${result.stdout}\n${result.stderr}`, databaseUrl).split(/\r?\n/).filter(Boolean).slice(-12).join('\n');
      throw new Error(`Supabase CLI ${label} failed with status ${result.status}.\n${detail}`);
    }
    return result;
  };

  const version = String(cli('--version', ['--version'], tmpdir()).stdout).trim().split(/\r?\n/)[0];
  if (version !== PINNED_SUPABASE_CLI_VERSION) throw new Error(`Supabase CLI must be exactly ${PINNED_SUPABASE_CLI_VERSION}.`);

  const live = evaluateLive();
  const plan = planStagingMigrations({ evaluation: live.evaluation, migrations: live.migrations });
  if (plan.pending.length === 0) {
    log('No pending staging migrations; nothing to apply.');
    return { applied: [] };
  }
  const pendingFiles = selectPendingMigrationFiles(live.evaluation.missingOnRemote, live.migrations);
  const expected = pendingFiles.map((file) => file.filename);

  const root = options.runnerTemp ?? tmpdir();
  mkdirSync(root, { recursive: true });
  const workspace = mkdtempSync(join(root, 'staging-migration-apply-'));
  try {
    const migrationsDirectory = join(workspace, 'supabase', 'migrations');
    mkdirSync(migrationsDirectory, { recursive: true });
    copyFileSync(resolve(options.configPath), join(workspace, 'supabase', 'config.toml'));
    cli('migration fetch', ['migration', 'fetch', '--db-url', databaseUrl, '--workdir', workspace], workspace);

    const mirror = verifyFetchedMirror(migrationsDirectory, live.remoteRows);
    const pendingVersions = new Set(live.evaluation.missingOnRemote.map(normalizeVersion));
    if (mirror.some((file) => pendingVersions.has(normalizeVersion(file.version)))) {
      throw new Error('Fetched staging mirror unexpectedly contains a pending migration version; stopping.');
    }
    for (const file of pendingFiles) {
      if (mirror.some((item) => item.filename === file.filename)) throw new Error(`Pending migration ${file.filename} collides with a mirror file; stopping.`);
      copyFileSync(resolve(options.migrationsDirectory, file.filename), join(migrationsDirectory, file.filename));
    }

    const result = cli('db push', ['db', 'push', '--db-url', databaseUrl, '--workdir', workspace, '--include-all', '--yes'], workspace);
    const applied = parseAppliedMigrations(`${result.stdout}\n${result.stderr}`);
    for (const filename of applied) log(`Applied ${filename}`);
    if (!sameSet(applied, expected)) {
      throw new Error(`Supabase CLI applied ${JSON.stringify(applied)}, which differs from the planned ${JSON.stringify(expected)}.`);
    }
    return { applied };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function main() {
  const databaseUrl = process.env.STAGING_SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('STAGING_SUPABASE_DB_URL is required; it is never printed.');
  try {
    applyStagingMigrations({
      databaseUrl, runnerTemp: process.env.RUNNER_TEMP || tmpdir(),
      migrationsDirectory: 'supabase/migrations', configPath: 'supabase/config.toml',
    });
  } catch (error) {
    console.error(`::error::${redact(error.message, databaseUrl).split('\n')[0]}`);
    console.error(redact(error.message, databaseUrl));
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
