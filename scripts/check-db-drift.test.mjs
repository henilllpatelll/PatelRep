import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyProductionMigrationAliases,
  buildLocalMigrationInventory,
  checkDuplicateMigrationCoverage,
  compareMigrationVersions,
  getDriftCheckConfig,
  loadProductionMigrationAliasRegistry,
  parsePsqlMigrationVersions,
  parsePsqlRemoteMigrations,
  shouldAllowPendingDrift,
  validateProductionMigrationAliasRegistry,
} from './check-db-drift.mjs';

function migration(filename, version, name) {
  return { filename, version, name };
}

function inventory(...migrations) {
  return buildLocalMigrationInventory(migrations);
}

function remote(version, name = '') {
  return { version, name };
}

function aliasRegistry(aliases) {
  return { schema_version: 2, environment: 'production', aliases };
}

function verifiedAlias(remoteId, repositoryFile) {
  return {
    remote_id: remoteId,
    repository_file: repositoryFile,
    evidence: 'docs/PRODUCTION_MIGRATION_ALIAS_EVIDENCE.md#verified-aliases',
  };
}

const SINGLE_FILE_INVENTORY = inventory(migration('085_opera_pilot_flag.sql', '085', 'opera_pilot_flag'));

test('numeric history still compares by canonical numeric identifier', () => {
  assert.deepEqual(compareMigrationVersions(['001', '002', '130'], ['1', '2']), {
    missingOnRemote: ['130'], unknownOnRemote: [],
  });
});

test('reports database-only migrations instead of relying on counts', () => {
  assert.deepEqual(compareMigrationVersions(['001', '003'], ['1', '2']), {
    missingOnRemote: ['3'], unknownOnRemote: ['2'],
  });
});

test('parses structured psql migration rows without normalizing identifiers', () => {
  assert.deepEqual(parsePsqlRemoteMigrations('{"version":"001","name":"first"}\n{"version":20260728090702,"name":"opera_pilot_flag"}\n'), [
    remote('001', 'first'), remote('20260728090702', 'opera_pilot_flag'),
  ]);
  assert.deepEqual(parsePsqlMigrationVersions('  001\n039\n'), ['001', '039']);
});

test('rejects malformed structured psql migration rows', () => {
  assert.throws(() => parsePsqlRemoteMigrations('{"version":"001"}\n'), /name/);
});

test('exact production timestamp and stored migration name reconcile to one local file', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([]), SINGLE_FILE_INVENTORY);
  const resolved = applyProductionMigrationAliases(
    [remote('20260728090702', 'opera_pilot_flag')], registry, SINGLE_FILE_INVENTORY,
  );
  assert.deepEqual(resolved.effectiveRemoteVersions, ['085']);
  assert.deepEqual(resolved.verifiedAliases, [{
    remoteId: '20260728090702', repositoryFile: '085_opera_pilot_flag.sql', repositoryId: '085', source: 'remote-name',
  }]);

  const filenameResolved = applyProductionMigrationAliases(
    [remote('20260728090703', '085_opera_pilot_flag.sql')], registry, SINGLE_FILE_INVENTORY,
  );
  assert.deepEqual(filenameResolved.effectiveRemoteVersions, ['085']);
});

test('incorrect, missing, and ambiguous remote names remain unresolved', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([]), SINGLE_FILE_INVENTORY);
  for (const row of [remote('20260728090702', 'not_opera'), remote('20260728090702')]) {
    const resolved = applyProductionMigrationAliases([row], registry, SINGLE_FILE_INVENTORY);
    assert.deepEqual(resolved.effectiveRemoteVersions, ['20260728090702']);
    assert.deepEqual(resolved.unresolvedRemoteRows, [row]);
  }

  const ambiguousInventory = inventory(
    migration('039_one.sql', '039', 'shared_name'), migration('042_two.sql', '042', 'shared_name'),
  );
  const resolved = applyProductionMigrationAliases(
    [remote('20260728090702', 'shared_name')],
    validateProductionMigrationAliasRegistry(aliasRegistry([]), ambiguousInventory),
    ambiguousInventory,
  );
  assert.deepEqual(resolved.unresolvedRemoteRows, [remote('20260728090702', 'shared_name')]);
});

test('production reconciliation never applies to staging', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([]), SINGLE_FILE_INVENTORY);
  const staging = applyProductionMigrationAliases(
    [remote('20260728090702', 'opera_pilot_flag')], registry, SINGLE_FILE_INVENTORY, 'staging',
  );
  assert.deepEqual(staging.effectiveRemoteVersions, ['20260728090702']);
  assert.deepEqual(staging.verifiedAliases, []);
});

const DUPLICATE_MIGRATION_GROUPS = [
  ['039', ['039_drop_room_status_history_trigger.sql', '039_drop_unused_indexes.sql']],
  ['042', ['042_guest_requests_priority.sql', '042_lost_found_photos_bucket.sql', '042_room_assignment_clean_type.sql']],
  ['110', ['110_room_unavailability_type.sql', '110_work_order_console_features.sql']],
];

function duplicateInventory(version, files) {
  return inventory(...files.map((filename) => migration(
    filename, version, filename.replace(/^\d+_/, '').replace(/\.sql$/, ''),
  )));
}

function reconcileDuplicateFiles(local, files) {
  const rows = files.map((filename, index) => remote(
    `202607280907${String(index + 1).padStart(2, '0')}`,
    filename.replace(/^\d+_/, '').replace(/\.sql$/, ''),
  ));
  return applyProductionMigrationAliases(
    rows, validateProductionMigrationAliasRegistry(aliasRegistry([]), local), local,
  );
}

for (const [version, files] of DUPLICATE_MIGRATION_GROUPS) {
  test(`independently reconciles all grandfathered duplicate ${version} files`, () => {
    const local = duplicateInventory(version, files);
    const resolved = reconcileDuplicateFiles(local, files);
    assert.deepEqual(resolved.effectiveRemoteVersions, files.map(() => version));
    assert.equal(new Set(resolved.verifiedAliases.map((item) => item.repositoryFile)).size, files.length);
    assert.deepEqual(compareMigrationVersions(files.map(() => version), resolved.effectiveRemoteVersions), {
      missingOnRemote: [], unknownOnRemote: [],
    });
  });
}

test('production duplicate 039 coverage fails with one file unverified and passes only when both exact files reconcile', () => {
  const [version, files] = DUPLICATE_MIGRATION_GROUPS[0];
  const local = duplicateInventory(version, files);
  const partial = reconcileDuplicateFiles(local, files.slice(0, 1));
  assert.deepEqual(checkDuplicateMigrationCoverage(local, partial.verifiedAliases), {
    groups: [{ version, verifiedFiles: [files[0]], unverifiedFiles: [files[1]] }],
    incompleteGroups: [{ version, verifiedFiles: [files[0]], unverifiedFiles: [files[1]] }],
  });

  const complete = reconcileDuplicateFiles(local, files);
  assert.deepEqual(checkDuplicateMigrationCoverage(local, complete.verifiedAliases).incompleteGroups, []);
});

test('production duplicate 042 coverage fails at one or two reconciled files and passes only at three', () => {
  const [version, files] = DUPLICATE_MIGRATION_GROUPS[1];
  const local = duplicateInventory(version, files);
  for (const provenCount of [1, 2]) {
    const partial = reconcileDuplicateFiles(local, files.slice(0, provenCount));
    assert.deepEqual(checkDuplicateMigrationCoverage(local, partial.verifiedAliases).incompleteGroups, [{
      version,
      verifiedFiles: files.slice(0, provenCount),
      unverifiedFiles: files.slice(provenCount),
    }]);
  }

  const complete = reconcileDuplicateFiles(local, files);
  assert.deepEqual(checkDuplicateMigrationCoverage(local, complete.verifiedAliases).incompleteGroups, []);
});

test('production duplicate 110 coverage fails with one reconciled file and passes with both', () => {
  const [version, files] = DUPLICATE_MIGRATION_GROUPS[2];
  const local = duplicateInventory(version, files);
  const partial = reconcileDuplicateFiles(local, files.slice(0, 1));
  assert.deepEqual(checkDuplicateMigrationCoverage(local, partial.verifiedAliases).incompleteGroups, [{
    version,
    verifiedFiles: [files[0]],
    unverifiedFiles: [files[1]],
  }]);

  const complete = reconcileDuplicateFiles(local, files);
  assert.deepEqual(checkDuplicateMigrationCoverage(local, complete.verifiedAliases).incompleteGroups, []);
});

test('a checked-in manual alias is file-level proof for its duplicate migration target', () => {
  const [version, files] = DUPLICATE_MIGRATION_GROUPS[0];
  const local = duplicateInventory(version, files);
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260728090702', files[1]),
  ]), local);
  const resolved = applyProductionMigrationAliases([
    remote('20260728090701', files[0].replace(/^\d+_/, '').replace(/\.sql$/, '')),
    remote('20260728090702'),
  ], registry, local);
  assert.deepEqual(checkDuplicateMigrationCoverage(local, resolved.verifiedAliases).incompleteGroups, []);
});

test('a numeric production row cannot prove a duplicate file group, while unique and staging histories retain their normal behavior', () => {
  const [version, files] = DUPLICATE_MIGRATION_GROUPS[0];
  const local = duplicateInventory(version, files);
  const numericOnly = applyProductionMigrationAliases(
    [remote(version)], validateProductionMigrationAliasRegistry(aliasRegistry([]), local), local,
  );
  assert.deepEqual(compareMigrationVersions(local.map((item) => item.version), numericOnly.effectiveRemoteVersions), {
    missingOnRemote: [], unknownOnRemote: [],
  });
  assert.deepEqual(checkDuplicateMigrationCoverage(local, numericOnly.verifiedAliases).incompleteGroups, [{
    version, verifiedFiles: [], unverifiedFiles: files,
  }]);
  assert.deepEqual(checkDuplicateMigrationCoverage(local, [], 'staging'), {
    groups: [], incompleteGroups: [],
  });

  assert.deepEqual(checkDuplicateMigrationCoverage(SINGLE_FILE_INVENTORY, [], 'production'), {
    groups: [], incompleteGroups: [],
  });
  assert.deepEqual(compareMigrationVersions(['085'], ['085']), {
    missingOnRemote: [], unknownOnRemote: [],
  });
});

test('--allow-pending cannot override incomplete production duplicate coverage', () => {
  const [version, files] = DUPLICATE_MIGRATION_GROUPS[0];
  const local = duplicateInventory(version, files);
  const partial = reconcileDuplicateFiles(local, files.slice(0, 1));
  const coverage = checkDuplicateMigrationCoverage(local, partial.verifiedAliases);
  assert.equal(shouldAllowPendingDrift({ missingOnRemote: ['085'], unknownOnRemote: [] }, true, coverage), false);
});

test('one timestamp cannot claim multiple repository files', () => {
  const local = inventory(
    migration('039_first.sql', '039', 'first'), migration('039_second.sql', '039', 'second'),
  );
  assert.throws(() => validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260728090702', '039_first.sql'), verifiedAlias('20260728090702', '039_second.sql'),
  ]), local), /Duplicate remote production migration alias/);
  assert.throws(() => applyProductionMigrationAliases([
    remote('20260728090702', 'first'), remote('20260728090702', 'second'),
  ], validateProductionMigrationAliasRegistry(aliasRegistry([]), local), local), /appears in multiple production migration rows/);
});

test('one exact repository file cannot be claimed by multiple remote rows', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([]), SINGLE_FILE_INVENTORY);
  assert.throws(() => applyProductionMigrationAliases([
    remote('20260728090702', 'opera_pilot_flag'), remote('20260728090703', 'opera_pilot_flag'),
  ], registry, SINGLE_FILE_INVENTORY), /claimed by multiple production migration rows/);
});

test('manual aliases target exact files and fail when they contradict a stored remote name', () => {
  const local = inventory(
    migration('085_opera_pilot_flag.sql', '085', 'opera_pilot_flag'),
    migration('090_stripe_webhook_events.sql', '090', 'stripe_webhook_events'),
  );
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260728090702', '090_stripe_webhook_events.sql'),
  ]), local);
  assert.throws(() => applyProductionMigrationAliases(
    [remote('20260728090702', 'opera_pilot_flag')], registry, local,
  ), /contradicts exact remote migration-name match/);
});

test('manual aliases may share a numeric version only when they target different files', () => {
  const local = inventory(
    migration('039_first.sql', '039', 'first'), migration('039_second.sql', '039', 'second'),
  );
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260728090702', '039_first.sql'), verifiedAlias('20260728090703', '039_second.sql'),
  ]), local);
  const resolved = applyProductionMigrationAliases([
    remote('20260728090702'), remote('20260728090703'),
  ], registry, local);
  assert.deepEqual(resolved.effectiveRemoteVersions, ['039', '039']);
});

test('unknown remote rows fail closed and pending migrations require no unresolved rows', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([]), SINGLE_FILE_INVENTORY);
  const resolved = applyProductionMigrationAliases([remote('20269999121212', 'unknown')], registry, SINGLE_FILE_INVENTORY);
  const unresolved = compareMigrationVersions(['085', '086'], resolved.effectiveRemoteVersions);
  assert.deepEqual(unresolved, { missingOnRemote: ['85', '86'], unknownOnRemote: ['20269999121212'] });
  assert.equal(shouldAllowPendingDrift(unresolved, true), false);

  const pendingOnly = compareMigrationVersions(['085', '086'], ['085']);
  assert.equal(shouldAllowPendingDrift(pendingOnly, true), true);
});

test('loads the checked-in production alias registry', () => {
  assert.deepEqual(
    loadProductionMigrationAliasRegistry('supabase/production-migration-aliases.json', SINGLE_FILE_INVENTORY),
    { aliases: [] },
  );
});

test('selects the requested database URL and optional safe diagnostic flag', () => {
  assert.deepEqual(getDriftCheckConfig(['--environment', 'staging'], {
    STAGING_SUPABASE_DB_URL: 'postgresql://staging',
  }), { environment: 'staging', databaseUrl: 'postgresql://staging', allowPending: false, showRemoteMigrationNames: false });
  assert.deepEqual(getDriftCheckConfig(['--environment', 'production', '--show-remote-migration-names'], {
    PRODUCTION_SUPABASE_DB_URL: 'postgresql://production',
  }), { environment: 'production', databaseUrl: 'postgresql://production', allowPending: false, showRemoteMigrationNames: true });
});

test('production preflight retains pipefail and excludes bypasses and migration repair', () => {
  const workflow = readFileSync('.github/workflows/production-release.yml', 'utf8');
  assert.match(workflow, /set -o pipefail\s+node scripts\/check-db-drift\.mjs --environment production --allow-pending \| tee drift\.txt/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.doesNotMatch(workflow, /migration repair/);
});
