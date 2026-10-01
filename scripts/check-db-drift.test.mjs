import assert from 'node:assert/strict';
import test from 'node:test';

import { compareMigrationVersions, remoteVersionsFromCliJson } from './check-db-drift.mjs';

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

test('reads Supabase remote rows from JSON output', () => {
  assert.deepEqual(remoteVersionsFromCliJson(JSON.stringify({ remote: [{ version: '001' }, { version: '130' }] })), ['001', '130']);
});
