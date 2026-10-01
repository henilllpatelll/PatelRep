import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { sha256 } from './check-migrations.mjs';
import { buildNormalizedPlan, verifyReplayPlan, writeReplayWorkspace } from './build-migration-replay-workspace.mjs';

function migration(filename, content = 'select 1;') {
  const [, version, name] = filename.match(/^(\d+)_(.+)\.sql$/) ?? [];
  return { filename, version, name, content, checksum: sha256(content) };
}

test('assigns a unique monotonic normalized version per migration, preserving repository order', () => {
  const migrations = [migration('001_extensions.sql'), migration('002_tenants.sql'), migration('003_users_roles.sql')];
  const plan = buildNormalizedPlan(migrations);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((item) => item.filename), migrations.map((item) => item.filename));
  assert.deepEqual(plan.map((item) => item.normalizedVersion), ['20000101000001', '20000101000002', '20000101000003']);
  assert.deepEqual(verifyReplayPlan(migrations, plan), []);
});

test('preserves historical identifier collisions as distinct normalized entries', () => {
  const migrations = [
    migration('038_add_fk_indexes.sql'),
    migration('039_drop_room_status_history_trigger.sql'),
    migration('039_drop_unused_indexes.sql'),
    migration('040_fix_function_search_path.sql'),
  ];
  const plan = buildNormalizedPlan(migrations);
  const versions = plan.map((item) => item.normalizedVersion);
  assert.equal(new Set(versions).size, 4, 'every entry must get a distinct synthetic version');
  assert.match(plan[1].normalizedFilename, /drop_room_status_history_trigger\.sql$/);
  assert.match(plan[2].normalizedFilename, /drop_unused_indexes\.sql$/);
  assert.deepEqual(verifyReplayPlan(migrations, plan), []);
});

test('detects an omitted repository migration', () => {
  const migrations = [migration('001_a.sql'), migration('002_b.sql')];
  const plan = buildNormalizedPlan([migrations[0]]);
  const violations = verifyReplayPlan(migrations, plan);
  assert.match(violations.join('\n'), /omits repository migration: 002_b\.sql/);
});

test('detects a duplicated plan entry', () => {
  const migrations = [migration('001_a.sql'), migration('002_b.sql')];
  const plan = buildNormalizedPlan(migrations);
  plan.push({ ...plan[0] });
  const violations = verifyReplayPlan(migrations, plan);
  assert.match(violations.join('\n'), /duplicates source migration: 001_a\.sql/);
});

test('detects non-unique normalized versions', () => {
  const migrations = [migration('001_a.sql'), migration('002_b.sql')];
  const plan = buildNormalizedPlan(migrations);
  plan[1].normalizedVersion = plan[0].normalizedVersion;
  const violations = verifyReplayPlan(migrations, plan);
  assert.match(violations.join('\n'), /versions are not unique/);
});

test('detects ordering divergence from repository order', () => {
  const migrations = [migration('001_a.sql'), migration('002_b.sql'), migration('003_c.sql')];
  const plan = buildNormalizedPlan(migrations);
  // Swap the normalized versions of entries 1 and 2 so sorting by normalized
  // version no longer reproduces repository order.
  const swap = plan[1].normalizedVersion;
  plan[1].normalizedVersion = plan[2].normalizedVersion;
  plan[2].normalizedVersion = swap;
  const violations = verifyReplayPlan(migrations, plan);
  assert.match(violations.join('\n'), /ordering diverges/);
});

test('writeReplayWorkspace copies SQL byte-identically, copies config/seed, and is idempotent across reruns', () => {
  const sourceDir = mkdtempSync(join(tmpdir(), 'replay-src-'));
  const outDir = mkdtempSync(join(tmpdir(), 'replay-out-'));
  try {
    const content1 = 'create table example_one (id uuid primary key);\n';
    const content2 = '-- a comment with trailing whitespace   \ncreate table example_two (id uuid);\n';
    writeFileSync(join(sourceDir, '001_example_one.sql'), content1);
    writeFileSync(join(sourceDir, '002_example_two.sql'), content2);
    const configPath = join(sourceDir, 'config.toml');
    const seedPath = join(sourceDir, 'seed.sql');
    writeFileSync(configPath, '[db]\nport = 54322\n');
    writeFileSync(seedPath, 'insert into tenants default values;\n');

    const migrations = [
      migration('001_example_one.sql', content1),
      migration('002_example_two.sql', content2),
    ];
    const plan = buildNormalizedPlan(migrations);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const violations = writeReplayWorkspace({ plan, migrationDir: sourceDir, configPath, seedPath, outDir });
      assert.deepEqual(violations, [], `rerun ${attempt} must report no hash mismatches`);

      const copiedOne = readFileSync(join(outDir, 'supabase', 'migrations', plan[0].normalizedFilename), 'utf8');
      const copiedTwo = readFileSync(join(outDir, 'supabase', 'migrations', plan[1].normalizedFilename), 'utf8');
      assert.equal(copiedOne, content1, 'SQL content must be byte-identical, not rewritten');
      assert.equal(copiedTwo, content2, 'SQL content must be byte-identical, not rewritten');
      assert.equal(readFileSync(join(outDir, 'supabase', 'config.toml'), 'utf8'), '[db]\nport = 54322\n');
      assert.equal(readFileSync(join(outDir, 'supabase', 'seed.sql'), 'utf8'), 'insert into tenants default values;\n');
    }
  } finally {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});
