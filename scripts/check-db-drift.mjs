#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadMigrations } from './check-migrations.mjs';

export function normalizeVersion(version) {
  return String(version).replace(/^0+(?=\d)/, '');
}

const PRODUCTION_ALIAS_REGISTRY_PATH = 'supabase/production-migration-aliases.json';
const PRODUCTION_TIMESTAMP_ID_PATTERN = /^\d{14}$/;
const NUMERIC_MIGRATION_ID_PATTERN = /^\d+$/;

/**
 * Validate a deliberately small, reviewable production-only alias registry.
 * A mapping is accepted only when it names an existing canonical repository
 * identifier and includes a source for the historical proof.
 */
export function validateProductionMigrationAliasRegistry(registry, localVersions) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('Production migration alias registry must be a JSON object.');
  }
  if (registry.schema_version !== 1) {
    throw new Error('Production migration alias registry schema_version must be 1.');
  }
  if (registry.environment !== 'production') {
    throw new Error('Production migration alias registry environment must be production.');
  }
  if (!Array.isArray(registry.aliases)) {
    throw new Error('Production migration alias registry aliases must be an array.');
  }

  const canonicalByNormalizedVersion = new Map();
  for (const version of localVersions) {
    canonicalByNormalizedVersion.set(normalizeVersion(version), String(version));
  }
  const remoteIds = new Set();
  const canonicalIds = new Set();
  const aliases = registry.aliases.map((alias, index) => {
    if (!alias || typeof alias !== 'object' || Array.isArray(alias)) {
      throw new Error(`Production migration alias at index ${index} must be an object.`);
    }
    const { remote_id: remoteId, repository_id: repositoryId, evidence } = alias;
    if (typeof remoteId !== 'string' || !PRODUCTION_TIMESTAMP_ID_PATTERN.test(remoteId)) {
      throw new Error(`Production migration alias at index ${index} remote_id must be a 14-digit timestamp identifier.`);
    }
    if (typeof repositoryId !== 'string' || !NUMERIC_MIGRATION_ID_PATTERN.test(repositoryId)) {
      throw new Error(`Production migration alias at index ${index} repository_id must be a numeric identifier.`);
    }
    if (typeof evidence !== 'string' || !evidence.trim()) {
      throw new Error(`Production migration alias at index ${index} evidence must be a non-empty string.`);
    }
    if (remoteIds.has(remoteId)) {
      throw new Error(`Duplicate remote production migration alias: ${remoteId}.`);
    }

    const normalizedRepositoryId = normalizeVersion(repositoryId);
    const canonicalRepositoryId = canonicalByNormalizedVersion.get(normalizedRepositoryId);
    if (!canonicalRepositoryId) {
      throw new Error(
        `Production migration alias ${remoteId} targets ${repositoryId}, which does not exist in the repository migration inventory.`,
      );
    }
    if (canonicalIds.has(normalizedRepositoryId)) {
      throw new Error(
        `Ambiguous production migration aliases target canonical repository identifier ${canonicalRepositoryId}.`,
      );
    }

    remoteIds.add(remoteId);
    canonicalIds.add(normalizedRepositoryId);
    return { remoteId, repositoryId: canonicalRepositoryId, evidence: evidence.trim() };
  });

  return { aliases };
}

export function loadProductionMigrationAliasRegistry(registryPath, localVersions) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    throw new Error('Unable to read production migration alias registry.');
  }
  return validateProductionMigrationAliasRegistry(registry, localVersions);
}

/**
 * Translates only aliases explicitly verified in the production registry.
 * Staging receives the remote history exactly as it was read.
 */
export function applyProductionMigrationAliases(
  remoteVersions,
  aliasRegistry,
  localVersions,
  environment = 'production',
) {
  if (environment !== 'production') {
    return { effectiveRemoteVersions: [...remoteVersions], verifiedAliases: [] };
  }

  const aliasesByRemoteId = new Map(aliasRegistry.aliases.map((alias) => [alias.remoteId, alias]));
  const rawNormalizedVersions = new Set(remoteVersions.map(normalizeVersion));
  for (const alias of aliasRegistry.aliases) {
    const canonicalId = normalizeVersion(alias.repositoryId);
    if (rawNormalizedVersions.has(canonicalId)) {
      throw new Error(
        `Production migration alias ${alias.remoteId} would hide multiple remote identifiers for canonical migration ${canonicalId}.`,
      );
    }
  }

  const verifiedAliases = [];
  const seenVerifiedRemoteIds = new Set();
  const effectiveRemoteVersions = remoteVersions.map((remoteId) => {
    const alias = aliasesByRemoteId.get(remoteId);
    if (!alias) return remoteId;
    if (!seenVerifiedRemoteIds.has(remoteId)) {
      verifiedAliases.push({ remoteId, repositoryId: alias.repositoryId });
      seenVerifiedRemoteIds.add(remoteId);
    }
    return alias.repositoryId;
  });

  // Preserve the same canonical-inventory validation if callers use this
  // pure helper directly instead of the file loader.
  validateProductionMigrationAliasRegistry({
    schema_version: 1,
    environment: 'production',
    aliases: aliasRegistry.aliases.map((alias) => ({
      remote_id: alias.remoteId,
      repository_id: alias.repositoryId,
      evidence: alias.evidence,
    })),
  }, localVersions);

  return { effectiveRemoteVersions, verifiedAliases };
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
  const localVersions = localMigrations.map((migration) => migration.version);
  const aliasRegistry = environment === 'production'
    ? loadProductionMigrationAliasRegistry(resolve(PRODUCTION_ALIAS_REGISTRY_PATH), localVersions)
    : { aliases: [] };
  const { effectiveRemoteVersions, verifiedAliases } = applyProductionMigrationAliases(
    remoteVersions,
    aliasRegistry,
    localVersions,
    environment,
  );
  const duplicateVersions = [...new Set(localMigrations
    .filter((migration, index, all) => all.filter((item) => item.version === migration.version).length > 1)
    .map((migration) => migration.version))];
  const result = compareMigrationVersions(localVersions, effectiveRemoteVersions);

  console.log(`Canonical repository migration identifiers: ${new Set(localVersions.map(normalizeVersion)).size}`);
  console.log(`${environment} applied identifiers: ${new Set(remoteVersions.map(normalizeVersion)).size}`);
  if (duplicateVersions.length) console.log(`KNOWN HISTORICAL CONDITION — duplicate repository identifiers: ${duplicateVersions.join(', ')}`);
  if (environment === 'production') {
    console.log('Verified production aliases:');
    if (verifiedAliases.length) {
      for (const alias of verifiedAliases) console.log(`${alias.remoteId} -> ${alias.repositoryId}`);
    } else {
      console.log('<none>');
    }
  }
  if (result.missingOnRemote.length) {
    console.log(`Pending on ${environment}: ${result.missingOnRemote.join(', ')}`);
    console.log(`Missing on ${environment}: ${result.missingOnRemote.join(', ')}`);
  } else {
    console.log(`Pending on ${environment}: <none>`);
  }
  if (result.unknownOnRemote.length) {
    console.log(`Unresolved ${environment} migrations: ${result.unknownOnRemote.join(', ')}`);
    // Keep this stable marker for the production-release hard stop.
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
