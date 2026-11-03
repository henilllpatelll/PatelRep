#!/usr/bin/env node
/**
 * Replay every real migration, in exact repository order, into a BLANK DISPOSABLE database.
 *
 * supabase/migrations/ contains grandfathered historical identifier collisions (039/042/110 -- see
 * docs/DATABASE_MIGRATIONS.md) that Supabase's migration tracker cannot record twice: supabase_migrations.
 * schema_migrations is keyed by version, and `supabase db reset`/`db push` apply each file's SQL and its tracking
 * insert in one transaction, so the second file in a collision group fails the insert and rolls back its own SQL.
 * This script instead applies every file's SQL directly via psql, recording each distinct version exactly once.
 *
 * SAFETY (this tool never destroys data):
 *   - It does NOT wipe or reset anything. The previous version ran `supabase db reset` against the target, which
 *     erased the shared staging database (auth users, tenants, assets, work orders) on every PR push.
 *   - The target must be explicitly declared `--disposable`, must be a loopback database, and must not match any
 *     configured staging/production/application host (scripts/destructive-db-guard.mjs).
 *   - Even then it refuses unless the database is already blank (no public tables, no recorded migrations, no
 *     auth users), so it can only ever build into an empty database.
 * Persistent staging is migrated forward with `supabase db push` (see staging-candidate.yml); production through the
 * controlled release workflow. Neither uses this script.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadMigrations } from './check-migrations.mjs';
import { assertDisposableDatabaseTarget, evaluateBlankness } from './destructive-db-guard.mjs';

function psqlScalar(databaseUrl, sql) {
  const output = execFileSync('psql', ['--set', 'ON_ERROR_STOP=1', databaseUrl, '--tuples-only', '--no-align', '--command', sql], { encoding: 'utf8' });
  return output.trim();
}

/** Read-only inspection of what already lives in the target. */
function inspectTarget(databaseUrl) {
  const publicTableCount = Number(psqlScalar(databaseUrl, "select count(*) from pg_tables where schemaname = 'public'"));
  const hasHistory = psqlScalar(databaseUrl, "select to_regclass('supabase_migrations.schema_migrations') is not null") === 't';
  const migrationRowCount = hasHistory ? Number(psqlScalar(databaseUrl, 'select count(*) from supabase_migrations.schema_migrations')) : 0;
  const hasAuthUsers = psqlScalar(databaseUrl, "select to_regclass('auth.users') is not null") === 't';
  const authUserCount = hasAuthUsers ? Number(psqlScalar(databaseUrl, 'select count(*) from auth.users')) : 0;
  return { publicTableCount, migrationRowCount, authUserCount };
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
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--disposable') args.set(token, true);
    else args.set(token, argv[++index]);
  }
  return args;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  // No environment fallback: a stray STAGING_/PRODUCTION_ URL must never become the target by accident.
  const databaseUrl = args.get('--db-url');
  if (!databaseUrl) throw new Error('--db-url is required.');
  assertDisposableDatabaseTarget({ databaseUrl, disposable: args.get('--disposable') === true });
  const migrationDir = resolve(args.get('--migration-dir') ?? 'supabase/migrations');

  const blankness = evaluateBlankness(inspectTarget(databaseUrl));
  if (!blankness.blank) {
    throw new Error(`Refusing to replay: the target database is not blank (${blankness.problems.join(', ')}). This tool never wipes a database.`);
  }

  const migrations = loadMigrations(migrationDir);
  const malformed = migrations.filter((migration) => !migration.version);
  if (malformed.length > 0) {
    throw new Error(`Malformed migration filename(s): ${malformed.map((migration) => migration.filename).join(', ')}`);
  }

  const workspace = join(tmpdir(), 'patelrep-disposable-replay');
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  // Additive and idempotent: only creates the tracking table when the blank baseline lacks it.
  execFileSync('psql', ['--set', 'ON_ERROR_STOP=1', databaseUrl, '--command',
    'create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);'], { stdio: 'inherit' });

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
