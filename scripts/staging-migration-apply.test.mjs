import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { applyStagingMigrations } from './staging-migration-apply.mjs'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'stg-apply-test-'))
  const migrations = join(dir, 'migrations')
  mkdirSync(migrations)
  writeFileSync(join(migrations, '234_new.sql'), 'alter table a add column b int;')
  writeFileSync(join(dir, 'config.toml'), '')
  return { dir, options: { databaseUrl: 'postgresql://u:p@h/db', runnerTemp: dir, migrationsDirectory: migrations, configPath: join(dir, 'config.toml') } }
}

const live = {
  remoteRows: [{ version: '039' }],
  migrations: [
    { filename: '039_a.sql', version: '039', content: 'select 1;' },
    { filename: '039_b.sql', version: '039', content: 'select 2;' },
    { filename: '234_new.sql', version: '234', content: 'alter table a add column b int;' },
  ],
  evaluation: { status: 'PENDING', missingOnRemote: ['234'], unknownOnRemote: [], duplicateCoverage: { incompleteGroups: [] } },
}

const fakeCli = (pushOutput, onPush = () => {}) => (args, cwd) => {
  if (args[0] === '--version') return { status: 0, stdout: '2.112.0\n', stderr: '' }
  if (args[0] === 'migration') {
    writeFileSync(join(cwd, 'supabase', 'migrations', '039_a.sql'), '')
    return { status: 0, stdout: '', stderr: '' }
  }
  onPush(args, cwd)
  return { status: 0, stdout: pushOutput, stderr: '' }
}

test('pushes only the planned file from a mirror workspace, never the duplicate-version siblings', () => {
  const { options } = setup()
  let pushed
  const result = applyStagingMigrations(options, {
    log: () => {},
    evaluateLive: () => live,
    runSupabase: fakeCli('Applying migration 234_new.sql...\n', (args, cwd) => {
      assert.ok(args.includes('--workdir') && args.includes('--include-all'))
      pushed = readdirSync(join(cwd, 'supabase', 'migrations')).sort()
    }),
  })
  assert.deepEqual(result.applied, ['234_new.sql'])
  assert.deepEqual(pushed, ['039_a.sql', '234_new.sql'])
})

test('does nothing when staging has no pending migrations', () => {
  const { options } = setup()
  const result = applyStagingMigrations(options, {
    log: () => {},
    evaluateLive: () => ({ ...live, evaluation: { ...live.evaluation, status: 'CLEAN', missingOnRemote: [] } }),
    runSupabase: () => ({ status: 0, stdout: '2.112.0\n', stderr: '' }),
  })
  assert.deepEqual(result.applied, [])
})

test('fails when the CLI applies something other than the plan', () => {
  const { options } = setup()
  assert.throws(() => applyStagingMigrations(options, {
    log: () => {},
    evaluateLive: () => live,
    runSupabase: fakeCli('Applying migration 039_b.sql...\n'),
  }), /differs from the planned/)
})
