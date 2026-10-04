#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadMigrations } from './check-migrations.mjs';
import { fingerprintStatements } from './migration-statement-fingerprint.mjs';

const PRODUCTION_ALIAS_REGISTRY_PATH = 'supabase/production-migration-aliases.json';
const PRODUCTION_KNOWN_HISTORY_PATH = 'supabase/production-known-history.json';
const PRODUCTION_FORWARD_REPAIR_PATH = 'supabase/production-duplicate-forward-repairs.json';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
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
    .map(({ filename, version, name }) => {
      const normalizedFilename = String(filename);
      return {
        filename: normalizedFilename,
        filenameStem: normalizedFilename.replace(/\.sql$/, ''),
        version: String(version),
        name: String(name),
      };
    });
}

function indexLocalMigrationInventory(localInventory) {
  const byFilename = new Map();
  const byFilenameStem = new Map();
  const byName = new Map();
  for (const migration of localInventory) {
    if (byFilename.has(migration.filename)) {
      throw new Error(`Duplicate repository migration filename in inventory: ${migration.filename}.`);
    }
    byFilename.set(migration.filename, migration);
    const matchingFilenameStems = byFilenameStem.get(migration.filenameStem) ?? [];
    matchingFilenameStems.push(migration);
    byFilenameStem.set(migration.filenameStem, matchingFilenameStems);
    const matchingNames = byName.get(migration.name) ?? [];
    matchingNames.push(migration);
    byName.set(migration.name, matchingNames);
  }
  return { byFilename, byFilenameStem, byName };
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

const KNOWN_HISTORY_REQUIRED_KEYS = ['evidence', 'remote_id', 'statement_count', 'statements_sha256', 'stored_name'];
const KNOWN_HISTORY_OPTIONAL_KEYS = ['operation_types', 'referenced_objects'];

/**
 * Validate the production-only attestations of historical rows that exist ONLY in production history. This is
 * deliberately NOT an alias registry: an attested row never maps to a repository migration. Each entry names the
 * exact row (id + stored name + statement count + normalized statement SHA-256). No raw SQL is ever stored.
 */
export function validateProductionKnownHistoryRegistry(registry, localInventory = [], aliasRegistry = { aliases: [] }) {
  const fail = (message) => {
    throw new Error(`Production known-history registry: ${message}`);
  };
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) fail('must be a JSON object.');
  if (registry.schema_version !== 1) fail('schema_version must be 1.');
  if (registry.environment !== 'production') fail('environment must be production.');
  if (!Array.isArray(registry.rows)) fail('rows must be an array.');
  const { byFilename, byFilenameStem, byName } = indexLocalMigrationInventory(localInventory);
  const aliasIds = new Set((aliasRegistry?.aliases ?? []).map((alias) => alias.remoteId));
  const remoteIds = new Set();
  const fingerprints = new Set();
  const rows = registry.rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`row ${index} must be an object.`);
    const keys = Object.keys(row);
    for (const key of KNOWN_HISTORY_REQUIRED_KEYS) if (!keys.includes(key)) fail(`row ${index} is missing ${key}.`);
    for (const key of keys) {
      if (!KNOWN_HISTORY_REQUIRED_KEYS.includes(key) && !KNOWN_HISTORY_OPTIONAL_KEYS.includes(key)) fail(`row ${index} has unexpected field ${key}.`);
    }
    if (typeof row.remote_id !== 'string' || !PRODUCTION_TIMESTAMP_ID_PATTERN.test(row.remote_id)) fail(`row ${index} remote_id must be a 14-digit timestamp identifier.`);
    if (typeof row.stored_name !== 'string' || !row.stored_name.trim() || row.stored_name !== row.stored_name.trim()) fail(`row ${index} stored_name must be a non-empty exact name.`);
    if (!Number.isInteger(row.statement_count) || row.statement_count < 1) fail(`row ${index} statement_count must be a positive integer.`);
    if (typeof row.statements_sha256 !== 'string' || !SHA256_PATTERN.test(row.statements_sha256)) fail(`row ${index} statements_sha256 must be a lowercase SHA-256 hex digest.`);
    if (typeof row.evidence !== 'string' || !row.evidence.trim()) fail(`row ${index} evidence must be a non-empty string.`);
    for (const key of KNOWN_HISTORY_OPTIONAL_KEYS) {
      if (row[key] !== undefined && (!Array.isArray(row[key]) || row[key].some((item) => typeof item !== 'string' || !item.trim()))) fail(`row ${index} ${key} must be an array of strings.`);
    }
    if (remoteIds.has(row.remote_id)) fail(`duplicate attestation for remote_id ${row.remote_id}.`);
    if (fingerprints.has(row.statements_sha256)) fail(`duplicate attestation fingerprint for remote_id ${row.remote_id}.`);
    if (aliasIds.has(row.remote_id)) fail(`remote_id ${row.remote_id} is also a repository alias; an attested row never maps to a repository migration.`);
    if (byName.has(row.stored_name) || byFilename.has(row.stored_name) || byFilenameStem.has(row.stored_name)) {
      fail(`stored_name of ${row.remote_id} matches a repository migration; an attested row never maps to a repository migration.`);
    }
    remoteIds.add(row.remote_id);
    fingerprints.add(row.statements_sha256);
    return {
      remoteId: row.remote_id,
      storedName: row.stored_name,
      statementCount: row.statement_count,
      statementsSha256: row.statements_sha256,
      evidence: row.evidence.trim(),
    };
  });
  return { rows };
}

export function loadProductionKnownHistoryRegistry(registryPath, localInventory, aliasRegistry) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    throw new Error('Unable to read production known-history registry.');
  }
  return validateProductionKnownHistoryRegistry(registry, localInventory, aliasRegistry);
}

const FORWARD_REPAIR_KEYS = ['evidence', 'repair_file', 'repair_sha256', 'source_file'];

/**
 * Validate the explicit forward-repair proofs for grandfathered duplicate migration files. A mapping only ever
 * lets one specific unique, later migration (pinned by content hash) stand in as the deterministic proof for one
 * specific duplicate file; it is never a generic duplicate-history bypass.
 * @param {object[]} migrations repository migrations with filename, version and checksum
 */
export function validateDuplicateForwardRepairRegistry(registry, migrations) {
  const fail = (message) => {
    throw new Error(`Production duplicate forward-repair registry: ${message}`);
  };
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) fail('must be a JSON object.');
  if (registry.schema_version !== 1) fail('schema_version must be 1.');
  if (registry.environment !== 'production') fail('environment must be production.');
  if (!Array.isArray(registry.repairs)) fail('repairs must be an array.');
  const byFile = new Map(migrations.map((migration) => [migration.filename, migration]));
  const filesByVersion = new Map();
  for (const migration of migrations) {
    const files = filesByVersion.get(normalizeVersion(migration.version)) ?? [];
    files.push(migration.filename);
    filesByVersion.set(normalizeVersion(migration.version), files);
  }
  const sources = new Set();
  const repairFiles = new Set();
  const repairs = registry.repairs.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`entry ${index} must be an object.`);
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(FORWARD_REPAIR_KEYS)) fail(`entry ${index} must have exactly ${FORWARD_REPAIR_KEYS.join(', ')}.`);
    const { source_file: sourceFile, repair_file: repairFile, repair_sha256: repairSha, evidence } = entry;
    for (const [name, value] of [['source_file', sourceFile], ['repair_file', repairFile], ['evidence', evidence]]) {
      if (typeof value !== 'string' || !value.trim()) fail(`entry ${index} ${name} must be a non-empty string.`);
    }
    if (typeof repairSha !== 'string' || !SHA256_PATTERN.test(repairSha)) fail(`entry ${index} repair_sha256 must be a lowercase SHA-256 hex digest.`);
    const source = byFile.get(sourceFile);
    if (!source) fail(`source ${sourceFile} does not exist in the repository migrations.`);
    if ((filesByVersion.get(normalizeVersion(source.version)) ?? []).length < 2) fail(`source ${sourceFile} is not part of a duplicate identifier group.`);
    const repair = byFile.get(repairFile);
    if (!repair) fail(`repair ${repairFile} does not exist in the repository migrations.`);
    if ((filesByVersion.get(normalizeVersion(repair.version)) ?? []).length !== 1) fail(`repair ${repairFile} must have a unique, non-duplicate identifier.`);
    if (Number(repair.version) <= Number(source.version)) fail(`repair ${repairFile} must have a later identifier than ${sourceFile}.`);
    if (repair.checksum !== repairSha) fail(`repair ${repairFile} content differs from the attested fingerprint.`);
    if (sources.has(sourceFile)) fail(`source ${sourceFile} is claimed more than once.`);
    if (repairFiles.has(repairFile)) fail(`repair ${repairFile} is claimed more than once.`);
    sources.add(sourceFile);
    repairFiles.add(repairFile);
    return { sourceFile, repairFile, repairVersion: repair.version, evidence: evidence.trim() };
  });
  return { repairs };
}

export function loadDuplicateForwardRepairRegistry(registryPath, migrations) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    throw new Error('Unable to read production duplicate forward-repair registry.');
  }
  return validateDuplicateForwardRepairRegistry(registry, migrations);
}

function verifyKnownHistoryRow(attestation, remoteRow, statements) {
  const id = attestation.remoteId;
  if (remoteRow.name !== attestation.storedName) {
    throw new Error(`Production row ${id} has stored name "${remoteRow.name}", which differs from its known-history attestation.`);
  }
  if (!Array.isArray(statements)) {
    throw new Error(`Production row ${id} statements are unavailable, so its known-history attestation cannot be verified.`);
  }
  if (statements.length !== attestation.statementCount) {
    throw new Error(`Production row ${id} statement count ${statements.length} differs from its known-history attestation.`);
  }
  if (fingerprintStatements(statements) !== attestation.statementsSha256) {
    throw new Error(`Production row ${id} statement fingerprint differs from its known-history attestation.`);
  }
}

function exactNamedMigration(remoteRow, byName, byFilename, byFilenameStem) {
  if (!remoteRow.name) return null;
  const candidates = [...(byName.get(remoteRow.name) ?? [])];
  const filenameMatch = byFilename.get(remoteRow.name);
  if (filenameMatch && !candidates.includes(filenameMatch)) candidates.push(filenameMatch);
  for (const filenameStemMatch of byFilenameStem.get(remoteRow.name) ?? []) {
    if (!candidates.includes(filenameStemMatch)) candidates.push(filenameStemMatch);
  }
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
  { knownHistory = { rows: [] }, statementsByRemoteId = new Map() } = {},
) {
  const remoteRows = remoteMigrations.map((migration) => ({
    version: String(migration.version), name: String(migration.name ?? ''),
  }));
  if (environment !== 'production') {
    return {
      effectiveRemoteVersions: remoteRows.map((row) => row.version),
      verifiedAliases: [],
      attestedRows: [],
      unresolvedRemoteRows: [],
    };
  }

  const { byFilename, byFilenameStem, byName } = indexLocalMigrationInventory(localInventory);
  const aliasesByRemoteId = new Map(aliasRegistry.aliases.map((alias) => [alias.remoteId, alias]));
  const numericRemoteIds = new Set(remoteRows
    .filter((row) => NUMERIC_MIGRATION_ID_PATTERN.test(row.version) && !PRODUCTION_TIMESTAMP_ID_PATTERN.test(row.version))
    .map((row) => normalizeVersion(row.version)));
  const localFileCountsByVersion = new Map();
  for (const migration of localInventory) {
    const normalizedVersion = normalizeVersion(migration.version);
    localFileCountsByVersion.set(
      normalizedVersion,
      (localFileCountsByVersion.get(normalizedVersion) ?? 0) + 1,
    );
  }
  const seenTimestampIds = new Set();
  const claimedRepositoryFiles = new Map();
  const verifiedAliases = [];
  const attestedRows = [];
  const unresolvedRemoteRows = [];
  const attestationsByRemoteId = new Map(knownHistory.rows.map((row) => [row.remoteId, row]));
  const effectiveRemoteVersions = remoteRows.map((remoteRow) => {
    if (!PRODUCTION_TIMESTAMP_ID_PATTERN.test(remoteRow.version)) return remoteRow.version;
    if (seenTimestampIds.has(remoteRow.version)) {
      throw new Error(`Production migration timestamp ${remoteRow.version} appears in multiple production migration rows.`);
    }
    seenTimestampIds.add(remoteRow.version);

    const exactNameTarget = exactNamedMigration(remoteRow, byName, byFilename, byFilenameStem);
    const manualAlias = aliasesByRemoteId.get(remoteRow.version);
    const manualTarget = manualAlias ? byFilename.get(manualAlias.repositoryFile) : null;
    if (manualTarget && exactNameTarget && manualTarget.filename !== exactNameTarget.filename) {
      throw new Error(
        `Production migration alias ${remoteRow.version} targets ${manualTarget.filename} but contradicts exact remote migration-name match ${exactNameTarget.filename}.`,
      );
    }
    const target = exactNameTarget ?? manualTarget;
    const attestation = attestationsByRemoteId.get(remoteRow.version);
    if (attestation) {
      // Exact production-only historical row: id + stored name + statement count + normalized fingerprint must
      // all match, and it must never ALSO resolve to a repository migration. It yields no effective version.
      verifyKnownHistoryRow(attestation, remoteRow, statementsByRemoteId.get(remoteRow.version));
      if (target) {
        throw new Error(`Production row ${remoteRow.version} is attested as production-only but also maps to repository migration ${target.filename}.`);
      }
      attestedRows.push({
        remoteId: attestation.remoteId,
        storedName: attestation.storedName,
        statementCount: attestation.statementCount,
        statementsSha256: attestation.statementsSha256,
      });
      return null;
    }
    if (!target) {
      unresolvedRemoteRows.push(remoteRow);
      return remoteRow.version;
    }
    const targetVersion = normalizeVersion(target.version);
    const hasDuplicateRepositoryVersion = (localFileCountsByVersion.get(targetVersion) ?? 0) > 1;
    if (numericRemoteIds.has(targetVersion) && !hasDuplicateRepositoryVersion) {
      throw new Error(
        `Production migration alias ${remoteRow.version} would hide a second remote identifier for canonical migration ${targetVersion}.`,
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

  return {
    effectiveRemoteVersions: effectiveRemoteVersions.filter((version) => version !== null),
    verifiedAliases,
    attestedRows,
    unresolvedRemoteRows,
  };
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
 * Numeric comparison cannot distinguish grandfathered duplicate migration
 * files. Production requires file-level proof for every file in such a group;
 * staging's clean-rebuild harness deliberately remains numeric-only.
 */
export function checkDuplicateMigrationCoverage(
  localInventory,
  verifiedAliases,
  environment = 'production',
  forwardRepairs = null,
) {
  if (environment !== 'production') return { groups: [], incompleteGroups: [] };

  const migrationsByVersion = new Map();
  for (const migration of localInventory) {
    const migrations = migrationsByVersion.get(migration.version) ?? [];
    migrations.push(migration);
    migrationsByVersion.set(migration.version, migrations);
  }
  const verifiedFiles = new Set(verifiedAliases.map((alias) => alias.repositoryFile));
  // A forward repair covers its ONE source file only when that exact repair is already recorded on production, or
  // (--allow-pending) is one of the migrations pending in this same controlled release. Otherwise it stays visible
  // as unapplied and the group remains incomplete.
  const repairStatus = (repair) => {
    const version = normalizeVersion(repair.repairVersion);
    if (forwardRepairs.appliedVersions.has(version)) return 'applied';
    if (forwardRepairs.allowPending && forwardRepairs.pendingVersions.has(version)) return 'pending';
    return 'unapplied';
  };
  const repairsBySource = new Map((forwardRepairs?.repairs ?? []).map((repair) => [repair.sourceFile, repair]));
  const groups = [...migrationsByVersion.entries()]
    .filter(([, migrations]) => migrations.length > 1)
    .map(([version, migrations]) => {
      const repositoryFiles = migrations.map((migration) => migration.filename);
      if (!forwardRepairs) {
        return {
          version,
          verifiedFiles: repositoryFiles.filter((filename) => verifiedFiles.has(filename)),
          unverifiedFiles: repositoryFiles.filter((filename) => !verifiedFiles.has(filename)),
        };
      }
      const repairs = repositoryFiles
        .filter((filename) => !verifiedFiles.has(filename) && repairsBySource.has(filename))
        .map((filename) => {
          const repair = repairsBySource.get(filename);
          return { sourceFile: filename, repairFile: repair.repairFile, status: repairStatus(repair) };
        });
      const covered = new Set(repairs.filter((repair) => repair.status !== 'unapplied').map((repair) => repair.sourceFile));
      return {
        version,
        verifiedFiles: repositoryFiles.filter((filename) => verifiedFiles.has(filename)),
        forwardRepairedFiles: [...covered],
        forwardRepairs: repairs,
        unverifiedFiles: repositoryFiles.filter((filename) => !verifiedFiles.has(filename) && !covered.has(filename)),
      };
    });

  return {
    groups,
    incompleteGroups: groups.filter((group) => group.unverifiedFiles.length > 0),
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

export function shouldAllowPendingDrift(result, allowPending, duplicateCoverage = { incompleteGroups: [] }) {
  return allowPending
    && result.missingOnRemote.length > 0
    && result.unknownOnRemote.length === 0
    && duplicateCoverage.incompleteGroups.length === 0;
}

/**
 * Pure drift evaluation shared by the controlled-release preflight and the read-only evidence audit, so both always
 * reach the same conclusion. Throws on malformed or unprovable security data (fail closed).
 */
export function evaluateMigrationDrift({
  environment, remoteRows, statementsByRemoteId = new Map(), localInventory, aliasRegistry = { aliases: [] },
  knownHistory = { rows: [] }, forwardRepairs = { repairs: [] }, allowPending = false,
}) {
  const localVersions = localInventory.map((migration) => migration.version);
  const resolved = applyProductionMigrationAliases(remoteRows, aliasRegistry, localInventory, environment, { knownHistory, statementsByRemoteId });
  const result = compareMigrationVersions(localVersions, resolved.effectiveRemoteVersions);
  const duplicateCoverage = checkDuplicateMigrationCoverage(localInventory, resolved.verifiedAliases, environment, {
    repairs: forwardRepairs.repairs,
    appliedVersions: new Set(resolved.effectiveRemoteVersions.map(normalizeVersion)),
    pendingVersions: new Set(result.missingOnRemote),
    allowPending,
  });
  let status = 'BLOCKED';
  if (!result.missingOnRemote.length && !result.unknownOnRemote.length && !duplicateCoverage.incompleteGroups.length) status = 'CLEAN';
  else if (shouldAllowPendingDrift(result, allowPending, duplicateCoverage)) status = 'PENDING';
  return { ...resolved, ...result, duplicateCoverage, status };
}

export const REMOTE_HISTORY_QUERY = "select json_build_object('version', version, 'name', coalesce(name, ''))::text from supabase_migrations.schema_migrations order by version";

/** Fixed read-only query for the statements of attested rows only. Ids come from the validated registry. */
export function attestedStatementsQuery(remoteIds) {
  const ids = remoteIds.map((id) => `'${id}'`).join(', ');
  return `select json_build_object('version', m.version, 'statements', to_jsonb(m)->'statements')::text from supabase_migrations.schema_migrations m where m.version in (${ids}) order by m.version`;
}

export function parseAttestedStatements(output) {
  const byId = new Map();
  for (const line of parsePsqlMigrationVersions(output)) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error('Unable to parse remote migration statements row.');
    }
    byId.set(String(row.version), Array.isArray(row.statements) ? row.statements : null);
  }
  return byId;
}

export function remoteAttestedStatements(databaseUrl, remoteIds) {
  if (!remoteIds.length) return new Map();
  try {
    const output = execFileSync('psql', [
      '--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', databaseUrl, '--tuples-only', '--no-align',
      '--command', 'SET default_transaction_read_only = on', '--command', attestedStatementsQuery(remoteIds),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return parseAttestedStatements(output);
  } catch {
    throw new Error('Unable to read remote migration statements with psql.');
  }
}

export function remoteMigrationHistory(databaseUrl) {
  try {
    const output = execFileSync('psql', [
      '--set', 'ON_ERROR_STOP=1', databaseUrl, '--tuples-only', '--no-align',
      '--command', REMOTE_HISTORY_QUERY,
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

function printIncompleteDuplicateMigrationCoverage(incompleteGroups) {
  for (const group of incompleteGroups) {
    console.log(`Incomplete production migration coverage for duplicate identifier ${group.version}:`);
    console.log('Verified:');
    if (group.verifiedFiles.length) {
      for (const filename of group.verifiedFiles) console.log(`  ${filename}`);
    } else {
      console.log('  <none>');
    }
    console.log('Unverified:');
    for (const filename of group.unverifiedFiles) console.log(`  ${filename}`);
  }
}

/**
 * Read live migration history with fixed read-only psql queries and evaluate it against the repository. Shared by the
 * drift CLI and the production apply workspace so both reach the same conclusion from the same evidence.
 */
export function evaluateLiveMigrationDrift({
  environment, databaseUrl, allowPending = false,
  migrationsDirectory = 'supabase/migrations',
  aliasRegistryPath = PRODUCTION_ALIAS_REGISTRY_PATH,
  knownHistoryPath = PRODUCTION_KNOWN_HISTORY_PATH,
  forwardRepairPath = PRODUCTION_FORWARD_REPAIR_PATH,
}) {
  const remoteRows = remoteMigrationHistory(databaseUrl);
  const migrations = loadMigrations(resolve(migrationsDirectory));
  const localInventory = buildLocalMigrationInventory(migrations);
  const production = environment === 'production';
  const aliasRegistry = production
    ? loadProductionMigrationAliasRegistry(resolve(aliasRegistryPath), localInventory)
    : { aliases: [] };
  // Production-only registries; staging never reads them.
  const knownHistory = production
    ? loadProductionKnownHistoryRegistry(resolve(knownHistoryPath), localInventory, aliasRegistry)
    : { rows: [] };
  const forwardRepairs = production
    ? loadDuplicateForwardRepairRegistry(resolve(forwardRepairPath), migrations)
    : { repairs: [] };
  const presentAttestedIds = knownHistory.rows.map((row) => row.remoteId).filter((id) => remoteRows.some((row) => row.version === id));
  const statementsByRemoteId = production ? remoteAttestedStatements(databaseUrl, presentAttestedIds) : new Map();
  const evaluation = evaluateMigrationDrift({
    environment, remoteRows, statementsByRemoteId, localInventory, aliasRegistry, knownHistory, forwardRepairs, allowPending,
  });
  return { remoteRows, migrations, localInventory, aliasRegistry, knownHistory, forwardRepairs, evaluation };
}

function main() {
  const { environment, databaseUrl, allowPending, showRemoteMigrationNames } = getDriftCheckConfig(process.argv.slice(2));
  const { remoteRows, localInventory, evaluation } = evaluateLiveMigrationDrift({ environment, databaseUrl, allowPending });
  const localVersions = localInventory.map((migration) => migration.version);
  const production = environment === 'production';
  const { verifiedAliases, attestedRows, unresolvedRemoteRows, duplicateCoverage } = evaluation;
  const duplicateVersions = [...new Set(localInventory
    .filter((migration, index, all) => all.filter((item) => item.version === migration.version).length > 1)
    .map((migration) => migration.version))];
  const result = { missingOnRemote: evaluation.missingOnRemote, unknownOnRemote: evaluation.unknownOnRemote };

  console.log(`Canonical repository migration identifiers: ${new Set(localVersions.map(normalizeVersion)).size}`);
  console.log(`${environment} applied identifiers: ${new Set(remoteRows.map((row) => normalizeVersion(row.version))).size}`);
  if (duplicateVersions.length) console.log(`KNOWN HISTORICAL CONDITION — duplicate repository identifiers: ${duplicateVersions.join(', ')}`);
  if (showRemoteMigrationNames) printMigrationRows('Remote migration version/name rows', remoteRows);
  if (production) {
    console.log('Verified production aliases:');
    if (verifiedAliases.length) {
      for (const alias of verifiedAliases) {
        console.log(`${alias.remoteId} -> ${alias.repositoryFile} (${alias.repositoryId}; ${alias.source})`);
      }
    } else {
      console.log('<none>');
    }
    console.log('Verified known production-only history (not repository migrations):');
    if (attestedRows.length) {
      for (const row of attestedRows) console.log(`${row.remoteId} | ${row.storedName} | statements=${row.statementCount} | sha256=${row.statementsSha256}`);
    } else {
      console.log('<none>');
    }
    printMigrationRows('Unresolved production migration', unresolvedRemoteRows);
    for (const group of duplicateCoverage.groups) {
      for (const repair of group.forwardRepairs ?? []) console.log(`Forward duplicate repair: ${repair.sourceFile} -> ${repair.repairFile} (${repair.status})`);
    }
    printIncompleteDuplicateMigrationCoverage(duplicateCoverage.incompleteGroups);
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
  if (evaluation.status === 'CLEAN') {
    console.log('Status: CLEAN');
    return;
  }
  if (evaluation.status === 'PENDING') {
    console.log('Status: PENDING (allowed for the staging apply step)');
    return;
  }
  process.exitCode = 1;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
