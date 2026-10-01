import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareMigrationVersions,
  getDriftCheckConfig,
  parsePsqlMigrationVersions,
  shouldAllowPendingDrift,
} from './check-db-drift.mjs';

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
