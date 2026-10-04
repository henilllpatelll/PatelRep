#!/usr/bin/env node
/**
 * Remote-safe full migration apply for a from-scratch database (staging bootstrap).
 *
 * supabase/migrations/ contains grandfathered historical identifier
 * collisions (039/042/110 -- see docs/DATABASE_MIGRATIONS.md) that Supabase's
 * migration tracker cannot record twice: supabase_migrations.schema_migrations
 * is keyed by version, and two files sharing a version can only ever produce
 * one row. `supabase db reset`/`db push` apply each file's SQL and its
 * tracking-row insert in one transaction, so the second file in a collision
 * group fails the insert and rolls back its own SQL too -- it is never
 * actually applied to the schema.
 *
 * build-migration-replay-workspace.mjs already solves this for LOCAL/CI
 * rebuilds by renumbering migrations under synthetic unique versions, but
 * that is deliberately never used against a remote environment: it would
 * desync the remote's recorded identifiers from the real repository history
 * that check-db-drift.mjs compares against (which dedupes by version, so it
 * already tolerates exactly one row per grandfathered collision).
 *
 * This script instead: 1) wipes the remote database to Supabase's own blank
 * baseline via `supabase db reset` against an ephemeral workspace with an
 * EMPTY migrations directory (so nothing can collide during the wipe), then
 * 2) replays every real migration file directly against the database via
 * psql, in exact repository order, recording each distinct version exactly
 * once while still executing every file's SQL -- including every "extra"
 * file in a collision group, whose SQL must still take effect even though
 * its version is already recorded.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadMigrations } from './check-migrations.mjs';

const SUPABASE_CLI = 'supabase@2.112.0';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
}

function psqlFile(databaseUrl, filePath) {
  execFileSync('psql', ['--set', 'ON_ERROR_STOP=1', databaseUrl, '--file', filePath], { stdio: 'inherit' });
}

function recordedVersions(databaseUrl) {
  const output = execFileSync('psql', [
    '--set', 'ON_ERROR_STOP=1', databaseUrl, '--tuples-only', '--no-align',
    '--command', 'select version from supabase_migrations.schema_migrations order by version',
  ], { encoding: 'utf8' });
  return new Set(output.split('\n').map((line) => line.trim()).filter(Boolean));
}

function sqlLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Pure planning step: given migrations in repository order, decide which
 * ones are the first file to use a given version (record a tracking row)
 * versus a grandfathered collision extra (apply SQL only, version already
 * tracked by an earlier file). Exported for unit testing without touching
 * psql/supabase.
 */
export function planApplyOrder(migrations, alreadyRecordedVersions = []) {
  const recorded = new Set(alreadyRecordedVersions);
  return migrations.map((migration) => {
    const isCollisionExtra = recorded.has(migration.version);
    if (!isCollisionExtra) recorded.add(migration.version);
    return { filename: migration.filename, version: migration.version, isCollisionExtra };
  });
}

function parseArguments(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) args.set(argv[index], argv[index + 1]);
  return args;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const databaseUrl = args.get('--db-url') ?? process.env.STAGING_SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('--db-url (or STAGING_SUPABASE_DB_URL) is required.');
  const migrationDir = resolve(args.get('--migration-dir') ?? 'supabase/migrations');
  const configPath = resolve(args.get('--config') ?? 'supabase/config.toml');

  const migrations = loadMigrations(migrationDir);
  const malformed = migrations.filter((migration) => !migration.version);
  if (malformed.length > 0) {
    throw new Error(`Malformed migration filename(s): ${malformed.map((migration) => migration.filename).join(', ')}`);
  }

  const workspace = join(tmpdir(), 'patelrep-remote-bootstrap');
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(join(workspace, 'supabase', 'migrations'), { recursive: true });
  copyFileSync(configPath, join(workspace, 'supabase', 'config.toml'));
  console.log('Wiping remote database to the blank Supabase baseline (empty migrations workspace)...');
  // `--workdir` alone does not redirect which supabase/migrations a remote
  // (--db-url) `db reset` replays -- it still reads cwd's real directory,
  // which is exactly the collision we are trying to avoid here. Actually
  // changing the child process's cwd is what makes it see the empty one.
  run('npx', ['--yes', SUPABASE_CLI, 'db', 'reset', '--db-url', databaseUrl, '--workdir', workspace, '--yes'], { cwd: workspace });

  const migrationByFilename = new Map(migrations.map((migration) => [migration.filename, migration]));
  const plan = planApplyOrder(migrations, recordedVersions(databaseUrl));

  for (const step of plan) {
    const migration = migrationByFilename.get(step.filename);
    const filePath = join(migrationDir, migration.filename);
    if (step.isCollisionExtra) {
      console.log(`Applying (collision extra, version already tracked): ${migration.filename}`);
      psqlFile(databaseUrl, filePath);
      continue;
    }
    console.log(`Applying: ${migration.filename}`);
    const bookkeeping = `insert into supabase_migrations.schema_migrations (version, name, statements) values (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ARRAY[]::text[]);`;
    const wrappedPath = join(workspace, `apply-${migration.filename}`);
    writeFileSync(wrappedPath, `begin;\n${migration.content}\n${bookkeeping}\ncommit;\n`);
    psqlFile(databaseUrl, wrappedPath);
  }

  const distinctVersions = new Set(plan.map((step) => step.version)).size;
  const collisionExtraCount = plan.filter((step) => step.isCollisionExtra).length;
  rmSync(workspace, { recursive: true, force: true });
  console.log(
    `Replayed ${migrations.length} migration files across ${distinctVersions} distinct tracked versions `
    + `(${migrations.length - collisionExtraCount} first-seen, ${collisionExtraCount} grandfathered collision extras).`,
  );
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
