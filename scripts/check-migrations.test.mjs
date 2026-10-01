import assert from 'node:assert/strict';
import test from 'node:test';

import { checkMigrations, sha256 } from './check-migrations.mjs';

function migration(filename, content = 'CREATE TABLE example (id uuid);') {
  const [, version, name] = filename.match(/^(\d+)_(.+)\.sql$/) ?? [];
  return { filename, version, name, content, checksum: sha256(content) };
}

test('grandfathers a released historical identifier collision', () => {
  const first = migration('039_first.sql');
  const second = migration('039_second.sql');
  const result = checkMigrations({
    migrations: [first, second],
    releasedMigrations: { [first.filename]: first.checksum, [second.filename]: second.checksum },
  });
  assert.deepEqual(result.violations, []);
  assert.match(result.notices.join('\n'), /KNOWN HISTORICAL CONDITION/);
});

test('rejects a changed or deleted released migration', () => {
  const released = migration('129_released.sql');
  const changed = migration('129_released.sql', 'CREATE TABLE changed (id uuid);');
  const changedResult = checkMigrations({ migrations: [changed], releasedMigrations: { [released.filename]: released.checksum } });
  const deletedResult = checkMigrations({ migrations: [], releasedMigrations: { [released.filename]: released.checksum } });
  assert.match(changedResult.violations.join('\n'), /Released migration modified/);
  assert.match(deletedResult.violations.join('\n'), /Released migration deleted/);
});

test('rejects new backdated and duplicate migration identifiers', () => {
  const released = migration('129_released.sql');
  const newOne = migration('130_first.sql');
  const newTwo = migration('130_second.sql');
  const result = checkMigrations({
    migrations: [released, newOne, newTwo, migration('128_backdated.sql')],
    releasedMigrations: { [released.filename]: released.checksum },
  });
  assert.match(result.violations.join('\n'), /identifier collision/);
  assert.match(result.violations.join('\n'), /greater than 129/);
});

test('rejects unreviewed destructive SQL and accepts an explicit review marker', () => {
  const released = migration('129_released.sql');
  const unsafe = migration('130_drop.sql', 'DROP TABLE old_records;');
  const safe = migration('130_drop.sql', '-- migration-safety: destructive-reviewed\n-- rollback-plan: restore from backup and forward-fix\nDROP TABLE old_records;');
  const unsafeResult = checkMigrations({ migrations: [released, unsafe], releasedMigrations: { [released.filename]: released.checksum } });
  const safeResult = checkMigrations({ migrations: [released, safe], releasedMigrations: { [released.filename]: released.checksum } });
  assert.match(unsafeResult.violations.join('\n'), /Destructive migration requires/);
  assert.deepEqual(safeResult.violations, []);
  assert.match(safeResult.notices.join('\n'), /DESTRUCTIVE MIGRATION REVIEWED/);
});
