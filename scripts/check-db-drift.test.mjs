import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyProductionMigrationAliases,
  compareMigrationVersions,
  getDriftCheckConfig,
  loadProductionMigrationAliasRegistry,
  parsePsqlMigrationVersions,
  shouldAllowPendingDrift,
  validateProductionMigrationAliasRegistry,
} from './check-db-drift.mjs';

function aliasRegistry(aliases) {
  return {
    schema_version: 1,
    environment: 'production',
    aliases,
  };
}

function verifiedAlias(remoteId, repositoryId) {
  return {
    remote_id: remoteId,
    repository_id: repositoryId,
    evidence: 'docs/PRODUCTION_MIGRATION_ALIAS_EVIDENCE.md#verified-aliases',
  };
}

test('reports a staging database behind the repository by identifier', () => {
  assert.deepEqual(compareMigrationVersions(['001', '002', '130'], ['1', '2']), {
    missingOnRemote: ['130'], unknownOnRemote: [],
  });
});

test('reports database-only migrations instead of relying on counts', () => {
  assert.deepEqual(compareMigrationVersions(['001', '003'], ['1', '2']), {
    missingOnRemote: ['3'], unknownOnRemote: ['2'],
  });
});

test('reports a fully migrated target as clean', () => {
  assert.deepEqual(compareMigrationVersions(['001', '202'], ['1', '202']), {
    missingOnRemote: [], unknownOnRemote: [],
  });
});

test('parses newline-delimited psql versions without normalizing identifiers', () => {
  assert.deepEqual(parsePsqlMigrationVersions('  001\n039\n0201\n20261001123456\n'), [
    '001', '039', '0201', '20261001123456',
  ]);
});

test('ignores blank and whitespace-only psql output lines', () => {
  assert.deepEqual(parsePsqlMigrationVersions('\n  001  \n\t\n039\n\n'), ['001', '039']);
});

test('compares duplicate remote history rows as one logical identifier', () => {
  assert.deepEqual(compareMigrationVersions(['001', '039'], ['001', '039', '039']), {
    missingOnRemote: [], unknownOnRemote: [],
  });
});

test('collapses known duplicate local identifiers to one remote migration row', () => {
  assert.deepEqual(compareMigrationVersions(
    ['001', '039', '039', '042', '042', '042', '110', '110'],
    ['001', '039', '042', '110'],
  ), { missingOnRemote: [], unknownOnRemote: [] });
});

test('resolves a verified production timestamp alias to its canonical numeric identifier', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260517181609', '035'),
  ]), ['035']);
  const resolved = applyProductionMigrationAliases(['20260517181609'], registry, ['035']);
  assert.deepEqual(resolved.effectiveRemoteVersions, ['035']);
  assert.deepEqual(resolved.verifiedAliases, [{ remoteId: '20260517181609', repositoryId: '035' }]);
  assert.deepEqual(compareMigrationVersions(['035'], resolved.effectiveRemoteVersions), {
    missingOnRemote: [], unknownOnRemote: [],
  });
});

test('resolves multiple verified production timestamp aliases', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260517181609', '035'),
    verifiedAlias('20260517181616', '036'),
  ]), ['035', '036']);
  const resolved = applyProductionMigrationAliases(
    ['20260517181609', '20260517181616'],
    registry,
    ['035', '036'],
  );
  assert.deepEqual(resolved.effectiveRemoteVersions, ['035', '036']);
  assert.deepEqual(resolved.verifiedAliases, [
    { remoteId: '20260517181609', repositoryId: '035' },
    { remoteId: '20260517181616', repositoryId: '036' },
  ]);
});

test('does not translate production aliases when checking staging', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260517181609', '035'),
  ]), ['035']);
  const staging = applyProductionMigrationAliases(['20260517181609'], registry, ['035'], 'staging');
  assert.deepEqual(staging.effectiveRemoteVersions, ['20260517181609']);
  assert.deepEqual(staging.verifiedAliases, []);
});

test('leaves an unmapped production timestamp migration unknown', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([]), ['035']);
  const resolved = applyProductionMigrationAliases(['20260517181609'], registry, ['035']);
  assert.deepEqual(compareMigrationVersions(['035'], resolved.effectiveRemoteVersions), {
    missingOnRemote: ['35'], unknownOnRemote: ['20260517181609'],
  });
});

test('rejects an alias whose canonical repository identifier does not exist', () => {
  assert.throws(
    () => validateProductionMigrationAliasRegistry(aliasRegistry([
      verifiedAlias('20260517181609', '999'),
    ]), ['035']),
    /does not exist in the repository migration inventory/,
  );
});

test('rejects malformed production alias registries', () => {
  assert.throws(
    () => validateProductionMigrationAliasRegistry({ schema_version: 1, environment: 'production', aliases: {} }, ['035']),
    /aliases must be an array/,
  );
  assert.throws(
    () => validateProductionMigrationAliasRegistry(aliasRegistry([
      { remote_id: '20260517181609', repository_id: '035', evidence: '' },
    ]), ['035']),
    /evidence must be a non-empty string/,
  );
  assert.throws(
    () => loadProductionMigrationAliasRegistry('does-not-exist.json', ['035']),
    /Unable to read production migration alias registry/,
  );
});

test('loads the checked-in production alias registry', () => {
  assert.deepEqual(
    loadProductionMigrationAliasRegistry('supabase/production-migration-aliases.json', ['035']),
    { aliases: [] },
  );
});

test('rejects duplicate or ambiguous production alias definitions', () => {
  assert.throws(
    () => validateProductionMigrationAliasRegistry(aliasRegistry([
      verifiedAlias('20260517181609', '035'),
      verifiedAlias('20260517181609', '036'),
    ]), ['035', '036']),
    /Duplicate remote production migration alias/,
  );
  assert.throws(
    () => validateProductionMigrationAliasRegistry(aliasRegistry([
      verifiedAlias('20260517181609', '035'),
      verifiedAlias('20260517181616', '035'),
    ]), ['035']),
    /Ambiguous production migration aliases target canonical repository identifier 035/,
  );
});

test('rejects an alias that would hide a second remote identifier for one canonical migration', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260517181609', '035'),
  ]), ['035']);
  assert.throws(
    () => applyProductionMigrationAliases(['035', '20260517181609'], registry, ['035']),
    /would hide multiple remote identifiers for canonical migration 35/,
  );
});

test('allows pending canonical migrations only after aliases resolve and no remote migration remains unknown', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260517181609', '035'),
  ]), ['035', '036']);
  const resolved = applyProductionMigrationAliases(['20260517181609'], registry, ['035', '036']);
  const result = compareMigrationVersions(['035', '036'], resolved.effectiveRemoteVersions);
  assert.deepEqual(result, { missingOnRemote: ['36'], unknownOnRemote: [] });
  assert.equal(shouldAllowPendingDrift(result, true), true);
});

test('refuses pending canonical migrations when one remote migration remains unknown after aliases resolve', () => {
  const registry = validateProductionMigrationAliasRegistry(aliasRegistry([
    verifiedAlias('20260517181609', '035'),
  ]), ['035', '036']);
  const resolved = applyProductionMigrationAliases(['20260517181609', '20269999121212'], registry, ['035', '036']);
  const result = compareMigrationVersions(['035', '036'], resolved.effectiveRemoteVersions);
  assert.deepEqual(result, { missingOnRemote: ['36'], unknownOnRemote: ['20269999121212'] });
  assert.equal(shouldAllowPendingDrift(result, true), false);
});

test('allows only missing migrations when --allow-pending is set', () => {
  const missingOnly = compareMigrationVersions(['001', '002'], ['001']);
  const unknownPresent = compareMigrationVersions(['001'], ['001', '002']);
  assert.equal(shouldAllowPendingDrift(missingOnly, true), true);
  assert.equal(shouldAllowPendingDrift(unknownPresent, true), false);
  assert.equal(shouldAllowPendingDrift(missingOnly, false), false);
});

test('selects the staging database URL', () => {
  assert.deepEqual(getDriftCheckConfig(['--environment', 'staging'], {
    STAGING_SUPABASE_DB_URL: 'postgresql://staging',
  }), { environment: 'staging', databaseUrl: 'postgresql://staging', allowPending: false });
});

test('selects the production database URL', () => {
  assert.deepEqual(getDriftCheckConfig(['--environment', 'production'], {
    PRODUCTION_SUPABASE_DB_URL: 'postgresql://production',
  }), { environment: 'production', databaseUrl: 'postgresql://production', allowPending: false });
});

test('rejects an invalid environment', () => {
  assert.throws(
    () => getDriftCheckConfig(['--environment', 'preview'], {}),
    /Environment must be staging or production/,
  );
});

test('rejects a missing selected environment DB URL without exposing it', () => {
  assert.throws(
    () => getDriftCheckConfig(['--environment', 'production'], {}),
    /PRODUCTION_SUPABASE_DB_URL is required; it is never printed/,
  );
});
