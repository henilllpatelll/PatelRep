#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadMigrations } from './check-migrations.mjs';

const PRODUCTION_ALIAS_REGISTRY_PATH = 'supabase/production-migration-aliases.json';
const PRODUCTION_TIMESTAMP_ID_PATTERN = /^\d{14}$/;
const NUMERIC_MIGRATION_ID_PATTERN = /^\d+$/;

export function normalizeVersion(version) {
  return String(version).replace(/^0+(?=\d)/, '');
}

/**
 * The reconciliation proof is deliberately file-level. Repository history has
 * grandfathered duplicate numeric versions, so a version alone cannot name the
 * migration that a timestamp-style production row represents.
 */
export function buildLocalMigrationInventory(migrations) {
  return migrations
    .filter((migration) => migration?.filename && migration?.version && migration?.name)
    .map(({ filename, version, name }) => ({
      filename: String(filename), version: String(version), name: String(name),
    }));
}

function indexLocalMigrationInventory(localInventory) {
  const byFilename = new Map();
  const byName = new Map();
  for (const migration of localInventory) {
    if (byFilename.has(migration.filename)) {
      throw new Error(`Duplicate repository migration filename in inventory: ${migration.filename}.`);
    }
    byFilename.set(migration.filename, migration);
    const matchingNames = byName.get(migration.name) ?? [];
    matchingNames.push(migration);
    byName.set(migration.name, matchingNames);
  }
  return { byFilename, byName };
}

/**
 * Validate the production-only manual fallback registry. Its targets are exact
 * migration files, not numeric identifiers, so duplicate historical versions
 * can be reconciled only when each row proves a distinct file.
 */
export function validateProductionMigrationAliasRegistry(registry, localInventory) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('Production migration alias registry must be a JSON object.');
  }
  if (registry.schema_version !== 2) {
    throw new Error('Production migration alias registry schema_version must be 2.');
  }
  if (registry.environment !== 'production') {
    throw new Error('Production migration alias registry environment must be production.');
  }
  if (!Array.isArray(registry.aliases)) {
    throw new Error('Production migration alias registry aliases must be an array.');
  }

  const { byFilename } = indexLocalMigrationInventory(localInventory);
  const remoteIds = new Set();
  const repositoryFiles = new Set();
  const aliases = registry.aliases.map((alias, index) => {
    if (!alias || typeof alias !== 'object' || Array.isArray(alias)) {
      throw new Error(`Production migration alias at index ${index} must be an object.`);
    }
    const { remote_id: remoteId, repository_file: repositoryFile, evidence } = alias;
    if (typeof remoteId !== 'string' || !PRODUCTION_TIMESTAMP_ID_PATTERN.test(remoteId)) {
      throw new Error(`Production migration alias at index ${index} remote_id must be a 14-digit timestamp identifier.`);
    }
    if (typeof repositoryFile !== 'string' || !repositoryFile.trim()) {
      throw new Error(`Production migration alias at index ${index} repository_file must be an exact migration filename.`);
    }
    if (typeof evidence !== 'string' || !evidence.trim()) {
      throw new Error(`Production migration alias at index ${index} evidence must be a non-empty string.`);
    }
    if (remoteIds.has(remoteId)) {
      throw new Error(`Duplicate remote production migration alias: ${remoteId}.`);
    }
    if (repositoryFiles.has(repositoryFile)) {
      throw new Error(`Duplicate repository-file production migration alias: ${repositoryFile}.`);
    }
    const target = byFilename.get(repositoryFile);
    if (!target) {
      throw new Error(
        `Production migration alias ${remoteId} targets ${repositoryFile}, which does not exist in the repository migration inventory.`,
      );
    }

    remoteIds.add(remoteId);
    repositoryFiles.add(repositoryFile);
    return { remoteId, repositoryFile: target.filename, evidence: evidence.trim() };
  });

  return { aliases };
}

export function loadProductionMigrationAliasRegistry(registryPath, localInventory) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    throw new Error('Unable to read production migration alias registry.');
  }
  return validateProductionMigrationAliasRegistry(registry, localInventory);
}

function exactNamedMigration(remoteRow, byName, byFilename) {
  if (!remoteRow.name) return null;
  const candidates = [...(byName.get(remoteRow.name) ?? [])];
  const filenameMatch = byFilename.get(remoteRow.name);
  if (filenameMatch && !candidates.includes(filenameMatch)) candidates.push(filenameMatch);
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Translate only exact, one-to-one production timestamp records. A stored
 * Supabase migration name is primary evidence; the checked-in registry is a
 * documented fallback and cannot contradict that name. Staging is never
 * reconciled because its normal history is already numeric.
 */
export function applyProductionMigrationAliases(
  remoteMigrations,
  aliasRegistry,
  localInventory,
  environment = 'production',
) {
  const remoteRows = remoteMigrations.map((migration) => ({
    version: String(migration.version), name: String(migration.name ?? ''),
  }));
  if (environment !== 'production') {
    return {
      effectiveRemoteVersions: remoteRows.map((row) => row.version),
      verifiedAliases: [],
      unresolvedRemoteRows: [],
    };
  }

  const { byFilename, byName } = indexLocalMigrationInventory(localInventory);
  const aliasesByRemoteId = new Map(aliasRegistry.aliases.map((alias) => [alias.remoteId, alias]));
  const numericRemoteIds = new Set(remoteRows
    .filter((row) => NUMERIC_MIGRATION_ID_PATTERN.test(row.version) && !PRODUCTION_TIMESTAMP_ID_PATTERN.test(row.version))
    .map((row) => normalizeVersion(row.version)));
  const seenTimestampIds = new Set();
  const claimedRepositoryFiles = new Map();
  const verifiedAliases = [];
  const unresolvedRemoteRows = [];
  const effectiveRemoteVersions = remoteRows.map((remoteRow) => {
    if (!PRODUCTION_TIMESTAMP_ID_PATTERN.test(remoteRow.version)) return remoteRow.version;
    if (seenTimestampIds.has(remoteRow.version)) {
      throw new Error(`Production migration timestamp ${remoteRow.version} appears in multiple production migration rows.`);
    }
    seenTimestampIds.add(remoteRow.version);

    const exactNameTarget = exactNamedMigration(remoteRow, byName, byFilename);
    const manualAlias = aliasesByRemoteId.get(remoteRow.version);
    const manualTarget = manualAlias ? byFilename.get(manualAlias.repositoryFile) : null;
    if (manualTarget && exactNameTarget && manualTarget.filename !== exactNameTarget.filename) {
      throw new Error(
        `Production migration alias ${remoteRow.version} targets ${manualTarget.filename} but contradicts exact remote migration-name match ${exactNameTarget.filename}.`,
      );
    }
    const target = exactNameTarget ?? manualTarget;
    if (!target) {
      unresolvedRemoteRows.push(remoteRow);
      return remoteRow.version;
    }
    if (numericRemoteIds.has(normalizeVersion(target.version))) {
      throw new Error(
        `Production migration alias ${remoteRow.version} would hide a second remote identifier for canonical migration ${normalizeVersion(target.version)}.`,
      );
    }
    const priorRemoteId = claimedRepositoryFiles.get(target.filename);
    if (priorRemoteId) {
      throw new Error(
        `Repository migration file ${target.filename} is claimed by multiple production migration rows: ${priorRemoteId}, ${remoteRow.version}.`,
      );
    }
    claimedRepositoryFiles.set(target.filename, remoteRow.version);
    verifiedAliases.push({
      remoteId: remoteRow.version,
      repositoryFile: target.filename,
      repositoryId: target.version,
      source: exactNameTarget ? 'remote-name' : 'manual',
    });
    return target.version;
  });

  return { effectiveRemoteVersions, verifiedAliases, unresolvedRemoteRows };
}

export function compareMigrationVersions(localVersions, remoteVersions) {
  const local = new Set(localVersions.map(normalizeVersion));
  const remote = new Set(remoteVersions.map(normalizeVersion));
  return {
    missingOnRemote: [...local].filter((version) => !remote.has(version)).sort(),
    unknownOnRemote: [...remote].filter((version) => !local.has(version)).sort(),
  };
}

export function parsePsqlMigrationVersions(output) {
  return String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Parse newline-delimited JSON generated by the fixed read-only query below. */
export function parsePsqlRemoteMigrations(output) {
  return parsePsqlMigrationVersions(output).map((line) => {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error('Unable to parse remote migration history row.');
    }
    if (!row || typeof row !== 'object' || row.version === undefined || typeof row.name !== 'string') {
      throw new Error('Remote migration history row must include version and name.');
    }
    return { version: String(row.version), name: row.name };
  });
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
  return {
    environment,
    databaseUrl,
    allowPending: argv.includes('--allow-pending'),
    showRemoteMigrationNames: argv.includes('--show-remote-migration-names'),
  };
}

export function shouldAllowPendingDrift(result, allowPending) {
  return allowPending && result.missingOnRemote.length > 0 && result.unknownOnRemote.length === 0;
}

function remoteMigrationHistory(databaseUrl) {
  try {
    const output = execFileSync('psql', [
      '--set', 'ON_ERROR_STOP=1', databaseUrl, '--tuples-only', '--no-align',
      '--command', "select json_build_object('version', version, 'name', coalesce(name, ''))::text from supabase_migrations.schema_migrations order by version",
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return parsePsqlRemoteMigrations(output);
  } catch {
    throw new Error('Unable to read remote migration history with psql.');
  }
}

function printMigrationRows(label, rows) {
  console.log(`${label}:`);
  if (!rows.length) {
    console.log('<none>');
    return;
  }
  for (const row of rows) console.log(`${row.version} | ${row.name || '<empty>'}`);
}

function main() {
  const { environment, databaseUrl, allowPending, showRemoteMigrationNames } = getDriftCheckConfig(process.argv.slice(2));
  const remoteRows = remoteMigrationHistory(databaseUrl);
  const localInventory = buildLocalMigrationInventory(loadMigrations(resolve('supabase/migrations')));
  const localVersions = localInventory.map((migration) => migration.version);
  const aliasRegistry = environment === 'production'
    ? loadProductionMigrationAliasRegistry(resolve(PRODUCTION_ALIAS_REGISTRY_PATH), localInventory)
    : { aliases: [] };
  const { effectiveRemoteVersions, verifiedAliases, unresolvedRemoteRows } = applyProductionMigrationAliases(
    remoteRows, aliasRegistry, localInventory, environment,
  );
  const duplicateVersions = [...new Set(localInventory
    .filter((migration, index, all) => all.filter((item) => item.version === migration.version).length > 1)
    .map((migration) => migration.version))];
  const result = compareMigrationVersions(localVersions, effectiveRemoteVersions);

  console.log(`Canonical repository migration identifiers: ${new Set(localVersions.map(normalizeVersion)).size}`);
  console.log(`${environment} applied identifiers: ${new Set(remoteRows.map((row) => normalizeVersion(row.version))).size}`);
  if (duplicateVersions.length) console.log(`KNOWN HISTORICAL CONDITION â€” duplicate repository identifiers: ${duplicateVersions.join(', ')}`);
  if (showRemoteMigrationNames) printMigrationRows('Remote migration version/name rows', remoteRows);
  if (environment === 'production') {
    console.log('Verified production aliases:');
    if (verifiedAliases.length) {
      for (const alias of verifiedAliases) {
        console.log(`${alias.remoteId} -> ${alias.repositoryFile} (${alias.repositoryId}; ${alias.source})`);
      }
    } else {
      console.log('<none>');
    }
    printMigrationRows('Unresolved production migration', unresolvedRemoteRows);
  }
  if (result.missingOnRemote.length) {
    console.log(`Pending on ${environment}: ${result.missingOnRemote.join(', ')}`);
    console.log(`Missing on ${environment}: ${result.missingOnRemote.join(', ')}`);
  } else {
    console.log(`Pending on ${environment}: <none>`);
  }
  if (result.unknownOnRemote.length) {
    console.log(`Unresolved ${environment} migrations: ${result.unknownOnRemote.join(', ')}`);
    console.log(`Unknown on ${environment}: ${result.unknownOnRemote.join(', ')}`);
  } else {
    console.log(`Unresolved ${environment} migrations: <none>`);
  }
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
