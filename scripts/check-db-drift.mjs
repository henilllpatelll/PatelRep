#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { loadMigrations } from './check-migrations.mjs';

function normalizeVersion(version) {
  return String(version).replace(/^0+(?=\d)/, '');
}

export function compareMigrationVersions(localVersions, remoteVersions) {
  const local = new Set(localVersions.map(normalizeVersion));
  const remote = new Set(remoteVersions.map(normalizeVersion));
  return {
    missingOnRemote: [...local].filter((version) => !remote.has(version)).sort(),
    unknownOnRemote: [...remote].filter((version) => !local.has(version)).sort(),
  };
}

/**
 * Read the stable, machine-oriented psql output format used by
 * remoteMigrationVersions(). Versions intentionally remain strings: leading
 * zeroes and future timestamp-style identifiers are meaningful identifiers.
 */
export function parsePsqlMigrationVersions(output) {
  return String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function getDriftCheckConfig(argv, environmentVariables = process.env) {
  const environmentIndex = argv.indexOf('--environment');
  const environment = environmentIndex >= 0 ? argv[environmentIndex + 1] : 'staging';
  if (environment !== 'staging' && environment !== 'production') {
    throw new Error('Environment must be staging or production.');
  }
  const databaseUrl = environmentVariables[`${environment.toUpperCase()}_SUPABASE_DB_URL`];
  if (!databaseUrl) {
    throw new Error(`${environment.toUpperCase()}_SUPABASE_DB_URL is required; it is never printed.`);
  }
  return { environment, databaseUrl, allowPending: argv.includes('--allow-pending') };
}

export function shouldAllowPendingDrift(result, allowPending) {
  return allowPending && result.missingOnRemote.length > 0 && result.unknownOnRemote.length === 0;
}

function remoteMigrationVersions(databaseUrl) {
  try {
    const output = execFileSync('psql', [
      '--set', 'ON_ERROR_STOP=1', databaseUrl, '--tuples-only', '--no-align',
      '--command', 'select version from supabase_migrations.schema_migrations order by version',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return parsePsqlMigrationVersions(output);
  } catch {
    throw new Error('Unable to read remote migration history with psql.');
  }
}

function main() {
  const { environment, databaseUrl, allowPending } = getDriftCheckConfig(process.argv.slice(2));
  const remoteVersions = remoteMigrationVersions(databaseUrl);
  const localMigrations = loadMigrations(resolve('supabase/migrations'));
  const duplicateVersions = [...new Set(localMigrations
    .filter((migration, index, all) => all.filter((item) => item.version === migration.version).length > 1)
    .map((migration) => migration.version))];
  const result = compareMigrationVersions(localMigrations.map((migration) => migration.version), remoteVersions);

  console.log(`Repository migration identifiers: ${new Set(localMigrations.map((migration) => normalizeVersion(migration.version))).size}`);
  console.log(`${environment} applied identifiers: ${new Set(remoteVersions.map(normalizeVersion)).size}`);
  if (duplicateVersions.length) console.log(`KNOWN HISTORICAL CONDITION — duplicate repository identifiers: ${duplicateVersions.join(', ')}`);
  if (result.missingOnRemote.length) console.log(`Missing on ${environment}: ${result.missingOnRemote.join(', ')}`);
  if (result.unknownOnRemote.length) console.log(`Unknown on ${environment}: ${result.unknownOnRemote.join(', ')}`);
  if (!result.missingOnRemote.length && !result.unknownOnRemote.length) {
    console.log('Status: CLEAN');
    return;
  }
  if (shouldAllowPendingDrift(result, allowPending)) {
    console.log('Status: PENDING (allowed for the staging apply step)');
    return;
  }
  process.exitCode = 1;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
