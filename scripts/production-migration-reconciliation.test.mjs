import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { fingerprintStatements as auditFingerprint, normalizeSql as auditNormalize, buildPreflightReport, preflightSummary } from './audit-production-migration-evidence.mjs'
import {
  applyProductionMigrationAliases,
  attestedStatementsQuery,
  buildLocalMigrationInventory,
  checkDuplicateMigrationCoverage,
  evaluateMigrationDrift,
  loadDuplicateForwardRepairRegistry,
  loadProductionKnownHistoryRegistry,
  loadProductionMigrationAliasRegistry,
  validateDuplicateForwardRepairRegistry,
  validateProductionKnownHistoryRegistry,
} from './check-db-drift.mjs'
import { loadMigrations, sha256 } from './check-migrations.mjs'
import { fingerprintStatements, normalizeSql } from './migration-statement-fingerprint.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

// ---- shared fingerprint contract ---------------------------------------------------------------------------------

test('the audit and the drift checker share ONE normalization and fingerprint implementation', () => {
  assert.equal(auditFingerprint, fingerprintStatements)
  assert.equal(auditNormalize, normalizeSql)
  assert.equal(fingerprintStatements(['CREATE   INDEX\r\n x ']), fingerprintStatements(['CREATE INDEX x']))
  assert.notEqual(fingerprintStatements(['a']), fingerprintStatements(['b']))
  assert.match(read('scripts/check-db-drift.mjs'), /from '\.\/migration-statement-fingerprint\.mjs'/)
  assert.match(read('scripts/audit-production-migration-evidence.mjs'), /from '\.\/migration-statement-fingerprint\.mjs'/)
  assert.doesNotMatch(read('scripts/audit-production-migration-evidence.mjs'), /createHash/)
})

// ---- production known-history attestations -----------------------------------------------------------------------

const STATEMENTS = ['CREATE INDEX IF NOT EXISTS idx_a ON public.work_orders (a)']
const HASH = fingerprintStatements(STATEMENTS)
const ID = '20260517181733'
const NAME = 'add_remaining_fk_indexes'
const entry = (overrides = {}) => ({ remote_id: ID, stored_name: NAME, statement_count: 1, statements_sha256: HASH, evidence: 'audit run 37212200992', ...overrides })
const registryOf = (...rows) => ({ schema_version: 1, environment: 'production', rows })
const local = (files) => buildLocalMigrationInventory(files.map((filename) => {
  const [, version, name] = filename.match(/^(\d+)_(.+)\.sql$/)
  return { filename, version, name, checksum: 'c'.repeat(64) }
}))
const INVENTORY = local(['038_add_fk_indexes.sql', '085_something.sql'])
const known = (...rows) => validateProductionKnownHistoryRegistry(registryOf(...rows), INVENTORY)
const remote = (version, name) => ({ version, name })
const apply = (remoteRows, registry, statements, environment = 'production') =>
  applyProductionMigrationAliases(remoteRows, { aliases: [] }, INVENTORY, environment, { knownHistory: registry, statementsByRemoteId: statements })

test('an exact id + name + statement count + fingerprint is a verified production-only row', () => {
  const result = apply([remote(ID, NAME)], known(entry()), new Map([[ID, STATEMENTS]]))
  assert.deepEqual(result.attestedRows, [{ remoteId: ID, storedName: NAME, statementCount: 1, statementsSha256: HASH }])
  assert.deepEqual(result.unresolvedRemoteRows, [])
})

test('attested rows never become a repository alias, effective version or proof that a migration ran', () => {
  const result = apply([remote('085', 'x'), remote(ID, NAME)], known(entry()), new Map([[ID, STATEMENTS]]))
  assert.deepEqual(result.verifiedAliases, [])
  assert.deepEqual(result.effectiveRemoteVersions, ['085'])
  // Related subject matter is not identity: 038 stays pending.
  const evaluation = evaluateMigrationDrift({
    environment: 'production', remoteRows: [remote(ID, NAME)], statementsByRemoteId: new Map([[ID, STATEMENTS]]), localInventory: INVENTORY,
    knownHistory: known(entry()), allowPending: true,
  })
  assert.deepEqual(evaluation.missingOnRemote, ['38', '85'])
  assert.deepEqual(evaluation.unknownOnRemote, [])
  assert.equal(evaluation.status, 'PENDING')
})

test('any mismatch of the attested row hard-fails', () => {
  const statements = new Map([[ID, STATEMENTS]])
  assert.throws(() => apply([remote(ID, 'other_name')], known(entry()), statements), /stored name/)
  assert.throws(() => apply([remote(ID, NAME)], known(entry({ statement_count: 2 })), statements), /statement count/)
  assert.throws(() => apply([remote(ID, NAME)], known(entry({ statements_sha256: 'f'.repeat(64) })), statements), /fingerprint/)
  assert.throws(() => apply([remote(ID, NAME)], known(entry()), new Map([[ID, ['CREATE INDEX different']]])), /fingerprint/)
  assert.throws(() => apply([remote(ID, NAME)], known(entry()), new Map([[ID, null]])), /statements are unavailable/)
  assert.throws(() => apply([remote(ID, NAME)], known(entry()), new Map()), /statements are unavailable/)
})

test('a different remote id is NOT accepted (no name-only trust, no timestamp or ordering inference)', () => {
  const other = '20260517181734'
  const result = apply([remote(other, NAME)], known(entry()), new Map([[other, STATEMENTS]]))
  assert.deepEqual(result.attestedRows, [])
  assert.deepEqual(result.unresolvedRemoteRows, [remote(other, NAME)])
  assert.deepEqual(result.effectiveRemoteVersions, [other])
  const evaluation = evaluateMigrationDrift({ environment: 'production', remoteRows: [remote(other, NAME)], localInventory: INVENTORY, knownHistory: known(entry()) })
  assert.deepEqual(evaluation.unknownOnRemote, [other])
  assert.equal(evaluation.status, 'BLOCKED')
})

test('registry validation rejects malformed, duplicate and repository-mapping attestations', () => {
  const bad = (registry, pattern) => assert.throws(() => validateProductionKnownHistoryRegistry(registry, INVENTORY), pattern)
  bad(null, /JSON object/)
  bad({ ...registryOf(), schema_version: 2 }, /schema_version/)
  bad({ ...registryOf(), environment: 'staging' }, /environment/)
  bad({ schema_version: 1, environment: 'production', rows: {} }, /rows/)
  bad(registryOf(entry(), entry()), /duplicate attestation/)
  bad(registryOf(entry(), entry({ remote_id: '20260101000000' })), /duplicate attestation fingerprint/)
  bad(registryOf(entry({ remote_id: '123' })), /14-digit/)
  bad(registryOf(entry({ stored_name: ' ' })), /stored_name/)
  bad(registryOf(entry({ stored_name: ' padded ' })), /stored_name/)
  bad(registryOf(entry({ statement_count: 0 })), /statement_count/)
  bad(registryOf(entry({ statement_count: '1' })), /statement_count/)
  bad(registryOf(entry({ statements_sha256: 'ABC' })), /SHA-256/)
  bad(registryOf(entry({ evidence: '' })), /evidence/)
  bad(registryOf({ ...entry(), raw_sql: 'CREATE INDEX x' }), /unexpected field raw_sql/)
  bad(registryOf({ remote_id: ID }), /missing/)
  bad(registryOf(entry({ operation_types: 'CREATE INDEX' })), /array of strings/)
  bad(registryOf(entry({ stored_name: 'add_fk_indexes' })), /matches a repository migration/)
  bad(registryOf(entry({ stored_name: '038_add_fk_indexes' })), /matches a repository migration/)
  assert.throws(() => validateProductionKnownHistoryRegistry(registryOf(entry()), INVENTORY, { aliases: [{ remoteId: ID }] }), /also a repository alias/)
})

test('an unrelated unknown production row stays release-blocking even next to an attested row', () => {
  const evaluation = evaluateMigrationDrift({
    environment: 'production', remoteRows: [remote(ID, NAME), remote('20260999000000', 'mystery')], statementsByRemoteId: new Map([[ID, STATEMENTS]]),
    localInventory: INVENTORY, knownHistory: known(entry()), allowPending: true,
  })
  assert.deepEqual(evaluation.unknownOnRemote, ['20260999000000'])
  assert.deepEqual(evaluation.unresolvedRemoteRows, [remote('20260999000000', 'mystery')])
  assert.equal(evaluation.status, 'BLOCKED')
})

test('staging ignores the production-only registry entirely', () => {
  const staging = apply([remote(ID, 'anything')], known(entry()), new Map(), 'staging')
  assert.deepEqual(staging.effectiveRemoteVersions, [ID])
  assert.deepEqual(staging.attestedRows, [])
  assert.deepEqual(staging.verifiedAliases, [])
  const evaluation = evaluateMigrationDrift({ environment: 'staging', remoteRows: [remote(ID, NAME)], localInventory: INVENTORY, knownHistory: known(entry()) })
  assert.deepEqual(evaluation.unknownOnRemote, [ID])
  assert.match(read('scripts/check-db-drift.mjs'), /production\s*\?\s*loadProductionKnownHistoryRegistry/)
})

test('statements are fetched read-only for attested ids only and sanitized output carries no raw SQL', () => {
  const query = attestedStatementsQuery([ID])
  assert.match(query, /^select /)
  assert.match(query, /to_jsonb\(m\)->'statements'/)
  assert.match(query, new RegExp(`m\\.version in \\('${ID}'\\)`))
  assert.doesNotMatch(query, /\b(insert|update|delete|drop|alter|create|truncate)\b/i)
  const evaluation = evaluateMigrationDrift({
    environment: 'production', remoteRows: [remote(ID, NAME)], statementsByRemoteId: new Map([[ID, STATEMENTS]]), localInventory: INVENTORY, knownHistory: known(entry()),
  })
  const report = JSON.stringify(buildPreflightReport(evaluation))
  assert.ok(report.includes(HASH))
  assert.ok(!report.includes('CREATE INDEX'))
  assert.ok(!report.includes('idx_a'))
  assert.match(preflightSummary(buildPreflightReport(evaluation)), /1 known production-only rows verified/)
  for (const row of JSON.parse(read('supabase/production-known-history.json')).rows) {
    assert.deepEqual(Object.keys(row).filter((key) => !['remote_id', 'stored_name', 'statement_count', 'statements_sha256', 'evidence', 'operation_types', 'referenced_objects'].includes(key)), [], 'no statements or SQL field')
    assert.ok(!JSON.stringify(row).includes(';'), 'no raw SQL')
  }
})

// ---- duplicate forward repairs -------------------------------------------------------------------------------------

const migrationsOf = (files) => files.map(([filename, checksum = 'c'.repeat(64)]) => {
  const [, version, name] = filename.match(/^(\d+)_(.+)\.sql$/)
  return { filename, version, name, checksum }
})
const REPAIR_SHA = 'd'.repeat(64)
const FILES = [
  ['042_a.sql'], ['042_b_clean_type.sql'], ['110_x.sql'], ['110_y_unavailability.sql'], ['077_p.sql'], ['077_q.sql'],
  ['204_reconcile_clean_type.sql', REPAIR_SHA], ['205_reconcile_unavailability.sql', 'e'.repeat(64)],
]
const MIGRATIONS = migrationsOf(FILES)
const repairEntry = (overrides = {}) => ({ source_file: '042_b_clean_type.sql', repair_file: '204_reconcile_clean_type.sql', repair_sha256: REPAIR_SHA, evidence: 'audit', ...overrides })
const repairRegistry = (...repairs) => ({ schema_version: 1, environment: 'production', repairs })
const validateRepairs = (registry, migrations = MIGRATIONS) => validateDuplicateForwardRepairRegistry(registry, migrations)

test('042 -> 204 and 110 -> 205 style mappings validate', () => {
  const { repairs } = validateRepairs(repairRegistry(
    repairEntry(),
    repairEntry({ source_file: '110_y_unavailability.sql', repair_file: '205_reconcile_unavailability.sql', repair_sha256: 'e'.repeat(64) }),
  ))
  assert.deepEqual(repairs.map((repair) => [repair.sourceFile, repair.repairFile, repair.repairVersion]), [
    ['042_b_clean_type.sql', '204_reconcile_clean_type.sql', '204'],
    ['110_y_unavailability.sql', '205_reconcile_unavailability.sql', '205'],
  ])
})

test('forward-repair mappings that are not exact, real and unique hard-fail', () => {
  const bad = (registry, pattern, migrations) => assert.throws(() => validateRepairs(registry, migrations), pattern)
  bad(null, /JSON object/)
  bad({ ...repairRegistry(), schema_version: 3 }, /schema_version/)
  bad({ schema_version: 1, environment: 'production', repairs: null }, /repairs/)
  bad(repairRegistry({ ...repairEntry(), extra: 1 }), /exactly/)
  bad(repairRegistry(repairEntry({ source_file: '999_missing.sql' })), /does not exist/)
  bad(repairRegistry(repairEntry({ source_file: '204_reconcile_clean_type.sql', repair_file: '205_reconcile_unavailability.sql', repair_sha256: 'e'.repeat(64) })), /not part of a duplicate identifier group/)
  bad(repairRegistry(repairEntry({ repair_file: '999_missing.sql' })), /repair 999_missing\.sql does not exist/)
  bad(repairRegistry(repairEntry({ repair_file: '077_p.sql', repair_sha256: 'c'.repeat(64) })), /unique, non-duplicate identifier/)
  bad(repairRegistry(repairEntry({ source_file: '110_x.sql', repair_file: '042_a.sql' })), /unique, non-duplicate identifier/)
  bad(repairRegistry(repairEntry({ source_file: '300_b.sql' })), /later identifier/, migrationsOf([['300_a.sql'], ['300_b.sql'], ['204_reconcile_clean_type.sql', REPAIR_SHA]]))
  bad(repairRegistry(repairEntry(), repairEntry({ repair_file: '205_reconcile_unavailability.sql', repair_sha256: 'e'.repeat(64) })), /claimed more than once/)
  bad(repairRegistry(repairEntry(), repairEntry({ source_file: '110_y_unavailability.sql' })), /claimed more than once/)
  bad(repairRegistry(repairEntry({ repair_sha256: 'f'.repeat(64) })), /differs from the attested fingerprint/)
  bad(repairRegistry(repairEntry({ repair_sha256: 'nope' })), /SHA-256/)
  bad(repairRegistry(repairEntry({ evidence: '' })), /evidence/)
})

const PENDING_INVENTORY = local(['042_a.sql', '042_b_clean_type.sql', '077_p.sql', '077_q.sql', '204_reconcile_clean_type.sql'])
const FORWARD = { repairs: [{ sourceFile: '042_b_clean_type.sql', repairFile: '204_reconcile_clean_type.sql', repairVersion: '204' }] }
// Production verified by exact remote names for 042_a, 077_p, 077_q; 042_b has no provable row.
const verifiedRows = [remote('20260101000001', 'a'), remote('20260101000002', 'p'), remote('20260101000003', 'q')]
const driftWith = ({ remoteExtra = [], forwardRepairs = FORWARD, allowPending = false, inventory = PENDING_INVENTORY } = {}) =>
  evaluateMigrationDrift({ environment: 'production', remoteRows: [...verifiedRows, ...remoteExtra], localInventory: inventory, forwardRepairs, allowPending })

test('a pending forward repair satisfies coverage ONLY with allow-pending release semantics', () => {
  const withoutFlag = driftWith()
  assert.equal(withoutFlag.status, 'BLOCKED')
  assert.deepEqual(withoutFlag.duplicateCoverage.groups.find((g) => g.version === '042').forwardRepairs, [
    { sourceFile: '042_b_clean_type.sql', repairFile: '204_reconcile_clean_type.sql', status: 'unapplied' },
  ])
  assert.deepEqual(withoutFlag.duplicateCoverage.incompleteGroups.map((g) => g.unverifiedFiles), [['042_b_clean_type.sql']])
  const withFlag = driftWith({ allowPending: true })
  assert.equal(withFlag.status, 'PENDING')
  assert.deepEqual(withFlag.missingOnRemote, ['204'])
  assert.equal(withFlag.duplicateCoverage.groups.find((g) => g.version === '042').forwardRepairs[0].status, 'pending')
  assert.deepEqual(withFlag.duplicateCoverage.incompleteGroups, [])
})

test('an applied forward repair satisfies coverage permanently', () => {
  const applied = driftWith({ remoteExtra: [remote('204', 'reconcile_clean_type')] })
  assert.equal(applied.status, 'CLEAN')
  assert.equal(applied.duplicateCoverage.groups.find((g) => g.version === '042').forwardRepairs[0].status, 'applied')
  assert.deepEqual(applied.duplicateCoverage.groups.find((g) => g.version === '042').forwardRepairedFiles, ['042_b_clean_type.sql'])
})

test('an unrelated incomplete duplicate group keeps blocking, and removing the mapping restores fail-closed behavior', () => {
  const incomplete = evaluateMigrationDrift({
    environment: 'production', remoteRows: [remote('20260101000001', 'a'), remote('20260101000002', 'p'), remote('204', 'reconcile_clean_type')],
    localInventory: PENDING_INVENTORY, forwardRepairs: FORWARD, allowPending: true,
  })
  assert.equal(incomplete.status, 'BLOCKED')
  assert.deepEqual(incomplete.duplicateCoverage.incompleteGroups.map((g) => [g.version, g.unverifiedFiles]), [['077', ['077_q.sql']]])
  const unmapped = driftWith({ remoteExtra: [remote('204', 'reconcile_clean_type')], forwardRepairs: { repairs: [] } })
  assert.equal(unmapped.status, 'BLOCKED')
  assert.deepEqual(unmapped.duplicateCoverage.incompleteGroups.map((g) => g.unverifiedFiles), [['042_b_clean_type.sql']])
})

test('a repair never covers a different duplicate file and is never a generic bypass', () => {
  const result = checkDuplicateMigrationCoverage(PENDING_INVENTORY, [], 'production', {
    repairs: FORWARD.repairs, appliedVersions: new Set(['204']), pendingVersions: new Set(), allowPending: false,
  })
  assert.deepEqual(result.incompleteGroups.map((group) => [group.version, group.unverifiedFiles]), [
    ['042', ['042_a.sql']],
    ['077', ['077_p.sql', '077_q.sql']],
  ])
  assert.deepEqual(checkDuplicateMigrationCoverage(PENDING_INVENTORY, [], 'staging', FORWARD), { groups: [], incompleteGroups: [] })
})

// ---- the committed registries and migrations -----------------------------------------------------------------------

const migrations = loadMigrations(resolve('supabase/migrations'))
const inventory = buildLocalMigrationInventory(migrations)

test('the committed known-history registry attests exactly the three audited rows and nothing else', () => {
  const aliases = loadProductionMigrationAliasRegistry(resolve('supabase/production-migration-aliases.json'), inventory)
  assert.deepEqual(aliases.aliases, [], 'no timestamp row was turned into an alias')
  const registry = loadProductionKnownHistoryRegistry(resolve('supabase/production-known-history.json'), inventory, aliases)
  assert.deepEqual(registry.rows.map((row) => [row.remoteId, row.storedName, row.statementCount, row.statementsSha256]), [
    ['20260517181733', 'add_remaining_fk_indexes', 1, '54e572d122af0d153033646a9970f127d2089d5243298c3d3cebac0637e7fe8d'],
    ['20260604070643', 'fix_profile_and_roles_rls_for_self_read', 1, 'a1f07cb1becb48e466e614569584f9c1407c4c5b4e3195dc11136c722e7962c5'],
    ['20260724140005', 'logbook_expires_repair', 1, '6d837f67433ee226b9ce1327aec28794a18352a28e49856b97aa9be7929efd5b'],
  ])
  const aliasFile = read('supabase/production-migration-aliases.json')
  for (const row of registry.rows) assert.ok(!aliasFile.includes(row.remoteId))
})

test('the committed forward-repair registry maps exactly 042 -> 204 and 110 -> 205', () => {
  const { repairs } = loadDuplicateForwardRepairRegistry(resolve('supabase/production-duplicate-forward-repairs.json'), migrations)
  assert.deepEqual(repairs.map((repair) => [repair.sourceFile, repair.repairFile]), [
    ['042_room_assignment_clean_type.sql', '204_reconcile_room_assignment_clean_type.sql'],
    ['110_room_unavailability_type.sql', '205_reconcile_room_unavailability_type.sql'],
  ])
})

test('editing a pinned repair migration changes its identity and fails the registry', () => {
  const tampered = migrations.map((migration) => (migration.filename.startsWith('204_') ? { ...migration, checksum: sha256(`${migration.content}\n-- tampered`) } : migration))
  assert.throws(() => validateDuplicateForwardRepairRegistry(JSON.parse(read('supabase/production-duplicate-forward-repairs.json')), tampered), /differs from the attested fingerprint/)
})

test('historical 042 and 110 files stay untouched and still collide with their siblings', () => {
  const manifest = JSON.parse(read('supabase/migration-manifest.json')).migrations
  for (const filename of ['042_room_assignment_clean_type.sql', '110_room_unavailability_type.sql']) {
    assert.equal(manifest[filename], migrations.find((migration) => migration.filename === filename).checksum, `${filename} must stay byte-identical to the released baseline`)
  }
  for (const filename of ['204_reconcile_room_assignment_clean_type.sql', '205_reconcile_room_unavailability_type.sql']) {
    assert.equal(manifest[filename], undefined, `${filename} is a new forward migration`)
    assert.equal(migrations.filter((migration) => migration.version === filename.slice(0, 3)).length, 1)
  }
})

// ---- 204 / 205 SQL contracts ---------------------------------------------------------------------------------------

test('204 re-asserts the canonical clean_type contract idempotently and without dropping data', () => {
  const sql = read('supabase/migrations/204_reconcile_room_assignment_clean_type.sql')
  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  assert.match(code, /ADD COLUMN IF NOT EXISTS clean_type TEXT DEFAULT 'DEP'/)
  const update = code.indexOf("UPDATE public.room_assignments SET clean_type = 'DEP' WHERE clean_type IS NULL")
  const notNull = code.indexOf('ALTER COLUMN clean_type SET NOT NULL')
  assert.ok(update > -1 && notNull > update, 'NULLs are repaired before NOT NULL is enforced')
  assert.match(code, /ALTER COLUMN clean_type SET DEFAULT 'DEP'/)
  // The CHECK is only added when no equivalent constraint exists, so reruns never create a duplicate.
  assert.match(code, /IF NOT EXISTS \(\s*SELECT 1\s+FROM pg_constraint c/)
  for (const value of ['clean_type', 'DEP', 'FULL', 'LIGHT']) assert.match(code, new RegExp(`LIKE '%${value}%'`))
  assert.match(code, /CHECK \(clean_type IN \('DEP', 'FULL', 'LIGHT'\)\)/)
  assert.match(code, /COMMENT ON COLUMN public\.room_assignments\.clean_type IS\s+'Opera housekeeping task code for the assigned clean: DEP, FULL, or LIGHT\.'/)
  assert.doesNotMatch(code, /\bDROP\b|\bDELETE\b|TRUNCATE|RENAME|ALTER COLUMN clean_type TYPE/i)
  // Same comment text as 042, so the audit's comment_present evidence agrees.
  assert.ok(read('supabase/migrations/042_room_assignment_clean_type.sql').includes('Opera housekeeping task code for the assigned clean: DEP, FULL, or LIGHT.'))
})

test('205 reproduces the canonical 110 function body and the service-role-only security contract', () => {
  const original = read('supabase/migrations/110_room_unavailability_type.sql')
  const repair = read('supabase/migrations/205_reconcile_room_unavailability_type.sql')
  const body = (sql) => normalizeSql(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION')))
  assert.equal(body(repair), body(original), 'identical canonical behavior')
  assert.match(repair, /CREATE OR REPLACE FUNCTION public\.create_room_unavailability\(/)
  assert.match(repair, /LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/)
  assert.match(repair, /IF p_type NOT IN \('OUT_OF_ORDER', 'OUT_OF_SERVICE'\) THEN RAISE EXCEPTION/)
  assert.match(repair, /INSERT INTO room_unavailability_periods/)
  assert.match(repair, /UPDATE room_status SET status = 'OOO'/)
  assert.match(repair, /INSERT INTO room_status_history/)
  assert.match(repair, /INSERT INTO room_unavailability_events/)
  assert.match(repair, /REVOKE EXECUTE ON FUNCTION public\.create_room_unavailability\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID, UUID, TEXT\) FROM anon, authenticated, PUBLIC;/)
  assert.match(repair, /GRANT EXECUTE ON FUNCTION public\.create_room_unavailability\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID, UUID, TEXT\) TO service_role;/)
  assert.doesNotMatch(repair, /GRANT EXECUTE[^;]*\b(anon|authenticated|PUBLIC)\b/)
  assert.doesNotMatch(repair, /\bDROP\b|\bDELETE\b|TRUNCATE/i)
})

test('already-present pending migrations tolerate the proven production state', () => {
  for (const filename of ['051_work_order_guest_reported.sql', '052_strip_room.sql']) {
    const sql = read(`supabase/migrations/${filename}`)
    const alters = sql.match(/ADD COLUMN\b/g) ?? []
    assert.ok(alters.length > 0)
    assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length, alters.length, `${filename} only uses ADD COLUMN IF NOT EXISTS`)
  }
  const widen = read('supabase/migrations/099_ai_interactions_widen_briefing_types.sql')
  assert.ok(widen.indexOf('DROP CONSTRAINT IF EXISTS ai_interactions_interaction_type_check') > -1)
  assert.ok(widen.indexOf('DROP CONSTRAINT IF EXISTS') < widen.indexOf('ADD CONSTRAINT ai_interactions_interaction_type_check'))
  // Effects being present never marks anything as applied: nothing in the repository writes migration history.
  for (const file of ['scripts/check-db-drift.mjs', 'scripts/audit-production-migration-evidence.mjs']) {
    assert.doesNotMatch(read(file), /insert into supabase_migrations|update supabase_migrations|delete from supabase_migrations|migration repair/i, file)
  }
})

test('the audit adds a read-only preflight and the release path still blocks unknown production rows', () => {
  const audit = read('scripts/audit-production-migration-evidence.mjs')
  assert.match(audit, /migration_preflight: runMigrationPreflight\(/)
  assert.match(audit, /allowPending: true/)
  assert.doesNotMatch(read('.github/workflows/production-release.yml'), /migration repair/)
  assert.match(read('.github/workflows/production-release.yml'), /grep -q "Unknown on production" drift\.txt/)
  assert.match(read('scripts/check-db-drift.mjs'), /Unknown on \$\{environment\}/)
})
