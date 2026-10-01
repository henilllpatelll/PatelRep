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

export function remoteVersionsFromCliJson(payload) {
  const parsed = JSON.parse(payload);
  const remoteRows = Array.isArray(parsed.remote)
    ? parsed.remote
    : Array.isArray(parsed)
      ? parsed.filter((row) => row.remote !== false)
      : [];
  const versions = remoteRows.map((row) => row.version).filter((version) => version !== undefined);
  if (versions.length === 0 && remoteRows.length > 0) throw new Error('Supabase migration list JSON did not contain versions.');
  return versions;
}

function main() {
  const environmentIndex = process.argv.indexOf('--environment');
  const environment = environmentIndex >= 0 ? process.argv[environmentIndex + 1] : 'staging';
  const allowPending = process.argv.includes('--allow-pending');
  if (environment !== 'staging' && environment !== 'production') {
    throw new Error('Environment must be staging or production.');
  }
  const databaseUrl = process.env[`${environment.toUpperCase()}_SUPABASE_DB_URL`];
  if (!databaseUrl) {
    throw new Error(`${environment.toUpperCase()}_SUPABASE_DB_URL is required; it is never printed.`);
  }
  const output = execFileSync('npx', [
    '--yes', 'supabase@2.76.8', 'migration', 'list', '--db-url', databaseUrl, '--output', 'json',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const localMigrations = loadMigrations(resolve('supabase/migrations'));
  const duplicateVersions = [...new Set(localMigrations
    .filter((migration, index, all) => all.filter((item) => item.version === migration.version).length > 1)
    .map((migration) => migration.version))];
  const result = compareMigrationVersions(localMigrations.map((migration) => migration.version), remoteVersionsFromCliJson(output));

  console.log(`Repository migration identifiers: ${new Set(localMigrations.map((migration) => normalizeVersion(migration.version))).size}`);
  console.log(`${environment} applied identifiers: ${new Set(remoteVersionsFromCliJson(output).map(normalizeVersion)).size}`);
  if (duplicateVersions.length) console.log(`KNOWN HISTORICAL CONDITION — duplicate repository identifiers: ${duplicateVersions.join(', ')}`);
  if (result.missingOnRemote.length) console.log(`Missing on ${environment}: ${result.missingOnRemote.join(', ')}`);
  if (result.unknownOnRemote.length) console.log(`Unknown on ${environment}: ${result.unknownOnRemote.join(', ')}`);
  if (!result.missingOnRemote.length && !result.unknownOnRemote.length) {
    console.log('Status: CLEAN');
    return;
  }
  if (allowPending && !result.unknownOnRemote.length) {
    console.log('Status: PENDING (allowed for the staging apply step)');
    return;
  }
  process.exitCode = 1;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
