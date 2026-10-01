#!/usr/bin/env node
/**
 * CI/local-only normalized migration replay workspace.
 *
 * The real `supabase/migrations/` directory is immutable release history and
 * is never modified by this script. Supabase's local migration tracker
 * (`supabase_migrations.schema_migrations`) rejects two files that share the
 * same leading numeric identifier (see the grandfathered 039/042/110
 * collisions in `supabase/migration-manifest.json` and
 * `docs/DATABASE_MIGRATIONS.md`), so a clean `supabase db reset --local`
 * replay of the full repository history cannot get past the first
 * collision. This script copies the repository migrations into an ephemeral
 * directory, byte-identical, under filenames with a synthetic-but-unique,
 * monotonic, repository-order-preserving version prefix, so Supabase's local
 * tracker can replay every migration from zero.
 *
 * This workspace exists ONLY for local/CI clean-rebuild verification. Remote
 * environments (staging/production) are always migrated and drift-checked
 * against the REAL historical identifiers — never these normalized ones.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadMigrations, sha256 } from './check-migrations.mjs';

// 14-digit, zero-padded, monotonically increasing — sorts identically
// lexicographically and numerically, and matches Supabase's own
// timestamp-style migration version convention.
const NORMALIZED_VERSION_BASE = 20000101000001n;

export function buildNormalizedPlan(migrations) {
  return migrations.map((migration, index) => {
    const normalizedVersion = String(NORMALIZED_VERSION_BASE + BigInt(index));
    const suffix = migration.name ?? migration.filename.replace(/\.sql$/, '');
    return { ...migration, normalizedVersion, normalizedFilename: `${normalizedVersion}_${suffix}.sql` };
  });
}

export function verifyReplayPlan(migrations, plan) {
  const violations = [];

  if (plan.length !== migrations.length) {
    violations.push(`Replay plan has ${plan.length} entries; repository has ${migrations.length} migrations`);
  }

  const sourceFilenames = new Map(migrations.map((migration) => [migration.filename, migration]));
  const seenFilenames = new Set();
  for (const item of plan) {
    if (!sourceFilenames.has(item.filename)) {
      violations.push(`Replay plan references unknown source migration: ${item.filename}`);
      continue;
    }
    if (seenFilenames.has(item.filename)) {
      violations.push(`Replay plan duplicates source migration: ${item.filename}`);
    }
    seenFilenames.add(item.filename);
  }
  for (const migration of migrations) {
    if (!seenFilenames.has(migration.filename)) {
      violations.push(`Replay plan omits repository migration: ${migration.filename}`);
    }
  }

  const versions = plan.map((item) => item.normalizedVersion);
  if (new Set(versions).size !== versions.length) {
    violations.push('Normalized versions are not unique');
  }
  const normalizedFilenames = plan.map((item) => item.normalizedFilename);
  if (new Set(normalizedFilenames).size !== normalizedFilenames.length) {
    violations.push('Normalized filenames are not unique');
  }

  // Repository order (the order `migrations`/`plan` were built in, which
  // `loadMigrations` sorts by filename — the same order Supabase would apply
  // them in if the historical identifiers were unique) must equal the order
  // produced by sorting on the normalized version alone.
  const sortedByNormalized = [...plan].sort((left, right) => left.normalizedVersion.localeCompare(right.normalizedVersion));
  for (let index = 0; index < plan.length; index += 1) {
    if (sortedByNormalized[index]?.filename !== plan[index].filename) {
      violations.push(
        `Normalized ordering diverges from repository ordering at position ${index}: expected ${plan[index].filename}, got ${sortedByNormalized[index]?.filename ?? '<missing>'}`,
      );
      break;
    }
  }

  return violations;
}

export function writeReplayWorkspace({ plan, migrationDir, configPath, seedPath, outDir }) {
  const violations = [];
  const migrationsOut = join(outDir, 'supabase', 'migrations');

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(migrationsOut, { recursive: true });

  copyFileSync(configPath, join(outDir, 'supabase', 'config.toml'));
  if (seedPath && existsSync(seedPath)) {
    copyFileSync(seedPath, join(outDir, 'supabase', 'seed.sql'));
  }

  for (const item of plan) {
    const sourcePath = join(migrationDir, item.filename);
    const content = readFileSync(sourcePath);
    const sourceHash = sha256(content);
    const destPath = join(migrationsOut, item.normalizedFilename);
    writeFileSync(destPath, content);
    const destHash = sha256(readFileSync(destPath));
    if (sourceHash !== destHash) {
      violations.push(`Content hash mismatch after copy: ${item.filename} -> ${item.normalizedFilename}`);
    }
  }

  writeFileSync(
    join(outDir, 'supabase', 'replay-manifest.json'),
    JSON.stringify(
      {
        _readme:
          'Ephemeral CI/local reconstruction mechanism only. Never deploy these normalized filenames to a remote environment — see docs/DATABASE_MIGRATIONS.md.',
        generatedAt: new Date().toISOString(),
        count: plan.length,
        mapping: plan.map((item) => ({ original: item.filename, normalized: item.normalizedFilename })),
      },
      null,
      2,
    ),
  );

  return violations;
}

function parseArguments(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    args.set(argv[index], argv[index + 1]);
  }
  return args;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const migrationDir = resolve(args.get('--migration-dir') ?? 'supabase/migrations');
  const configPath = resolve(args.get('--config') ?? 'supabase/config.toml');
  const seedPath = resolve(args.get('--seed') ?? 'supabase/seed.sql');
  const outDir = resolve(args.get('--out') ?? join(tmpdir(), 'patelrep-migration-replay'));

  const migrations = loadMigrations(migrationDir);
  const malformed = migrations.filter((migration) => !migration.version);
  if (malformed.length > 0) {
    for (const migration of malformed) console.error(`Malformed migration filename: ${migration.filename}`);
    process.exit(1);
  }

  const plan = buildNormalizedPlan(migrations);
  const planViolations = verifyReplayPlan(migrations, plan);
  if (planViolations.length > 0) {
    for (const violation of planViolations) console.error(`REPLAY PLAN VIOLATION — ${violation}`);
    process.exit(1);
  }

  const copyViolations = writeReplayWorkspace({ plan, migrationDir, configPath, seedPath, outDir });
  if (copyViolations.length > 0) {
    for (const violation of copyViolations) console.error(`REPLAY COPY VIOLATION — ${violation}`);
    process.exit(1);
  }

  console.log(`Normalized migration replay workspace: ${outDir}`);
  console.log(`Repository migrations: ${migrations.length}`);
  console.log(`Replay plan entries: ${plan.length}`);
  console.log('Every repository migration appears exactly once: PASS');
  console.log('Normalized versions unique: PASS');
  console.log('Normalized ordering equals repository ordering: PASS');
  console.log('SQL content hashes identical before/after copy: PASS');
  console.log('Migration replay workspace integrity: PASS');
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
