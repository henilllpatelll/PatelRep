#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadMigrations } from './check-migrations.mjs';

const UNRESOLVED_REMOTE_IDS = ['20260517181733', '20260604070643', '20260724140005'];
const READ_ONLY_QUERY = /^\s*(?:select|with|show)\b/i;

const existsTable = (name) => `to_regclass('${name}') IS NOT NULL`;
const existsColumn = (table, column) => `EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('${table}') AND attname = '${column}' AND NOT attisdropped)`;
const existsIndex = (name) => `to_regclass('public.${name}') IS NOT NULL`;
const existsPolicy = (name) => `EXISTS (SELECT 1 FROM pg_policy WHERE polname = '${name}')`;
const constraintContains = (table, fragment) => `EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('${table}') AND pg_get_constraintdef(oid) ILIKE '%${fragment}%')`;
const functionDefinitionContains = (fragment) => `EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'app_schema_readiness' AND pg_get_functiondef(p.oid) LIKE '%${fragment}%')`;

export const PENDING_MIGRATION_EFFECTS = [
  ['050_work_order_photos_bucket.sql', [
    ['work_order_photos_bucket', `EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'work-order-photos' AND public)`],
    ['work_order_upload_policy', existsPolicy('Authenticated staff can upload work order photos')],
    ['work_order_public_read_policy', existsPolicy('Public can view work order photos')],
  ]],
  ['051_work_order_guest_reported.sql', [['guest_reported_column', existsColumn('public.work_orders', 'guest_reported')]]],
  ['052_strip_room.sql', [['stripped_column', existsColumn('public.room_status', 'stripped')], ['stripped_by_column', existsColumn('public.room_status', 'stripped_by')], ['stripped_at_column', existsColumn('public.room_status', 'stripped_at')]]],
  ['058_clean_photos_private.sql', [
    ['clean_photos_bucket_private', `EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'clean-photos' AND NOT public)`],
    ['clean_photos_authenticated_read_policy', existsPolicy('Authenticated staff can view clean photos')],
    ['clean_photos_public_read_policy_absent', `NOT ${existsPolicy('Public can view clean photos')}`],
  ]],
  ['098_flip_web_redesign_sections_on.sql', [['redesign_sections_default', `EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'public.tenants'::regclass AND a.attname = 'web_redesign_sections' AND pg_get_expr(d.adbin, d.adrelid) LIKE '%housekeeping%')`]], true],
  ['099_ai_interactions_widen_briefing_types.sql', [['briefing_types_constraint', constraintContains('public.ai_interactions', 'supervisor_briefing')], ['gm_briefing_constraint', constraintContains('public.ai_interactions', 'gm_briefing')]]],
  ['100_ai_interactions_housekeeper_shift_recap.sql', [['housekeeper_shift_recap_constraint', constraintContains('public.ai_interactions', 'housekeeper_shift_recap')]]],
  ['119_shift_summary_identity.sql', [['handoff_data_column', existsColumn('public.shift_summaries', 'handoff_data')], ['updated_at_column', existsColumn('public.shift_summaries', 'updated_at')], ['shift_identity_constraint', constraintContains('public.shift_summaries', 'UNIQUE (tenant_id, shift_id, shift_date)')]], true],
  ['120_logbook_search_indexes.sql', [['tenant_date_index', existsIndex('idx_logbook_entries_tenant_entry_date')], ['content_trgm_index', existsIndex('idx_logbook_entries_content_trgm')], ['author_date_index', existsIndex('idx_logbook_entries_tenant_author_date')], ['related_date_index', existsIndex('idx_logbook_entries_tenant_related_date')]]],
  ['121_logbook_collaboration.sql', [['comments_table', existsTable('public.logbook_entry_comments')], ['mentions_table', existsTable('public.logbook_comment_mentions')], ['reads_table', existsTable('public.logbook_entry_reads')], ['ack_targets_table', existsTable('public.logbook_entry_ack_targets')], ['acknowledgments_table', existsTable('public.logbook_entry_acknowledgments')]]],
  ['122_logbook_phase8_retention_translations.sql', [['archive_reason_column', existsColumn('public.logbook_entries', 'archive_reason')], ['archived_by_column', existsColumn('public.logbook_entries', 'archived_by')], ['translations_table', existsTable('public.logbook_content_translations')], ['translation_lookup_index', existsIndex('idx_logbook_translation_lookup')]]],
  ['124_housekeeping_workload_settings.sql', [['target_credits_column', existsColumn('public.tenants', 'housekeeping_target_credits')], ['credit_weights_column', existsColumn('public.tenants', 'housekeeping_credit_weights')], ['capacity_overrides_column', existsColumn('public.tenants', 'housekeeping_capacity_overrides')]]],
  ['126_housekeeping_assignment_preferences.sql', [['assignment_preferences_column', existsColumn('public.tenants', 'housekeeping_assignment_preferences')]]],
  ['202_schema_readiness_contract.sql', [['schema_readiness_function', `to_regprocedure('public.app_schema_readiness()') IS NOT NULL`], ['schema_readiness_contract', functionDefinitionContains('schema_contract_version')]]],
];

export function normalizeSql(sql) {
  return String(sql).replace(/\r\n/g, '\n').trim().replace(/\s+/g, ' ');
}

export function fingerprintStatements(statements) {
  const normalized = (Array.isArray(statements) ? statements : [statements]).map(normalizeSql);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function assertReadOnlyQuery(query) {
  const normalized = String(query).trim().replace(/;$/, '');
  if (!READ_ONLY_QUERY.test(normalized) || normalized.includes(';')) {
    throw new Error('Evidence audit rejected a non-read-only query.');
  }
}

export function statementOperationTypes(statements) {
  return [...new Set((Array.isArray(statements) ? statements : [statements]).map((statement) => {
    const match = normalizeSql(statement).match(/^(CREATE(?: OR REPLACE)? (?:TABLE|INDEX|FUNCTION|POLICY|EXTENSION)|ALTER TABLE|DROP POLICY|INSERT INTO|UPDATE|DELETE FROM)/i);
    return match?.[1]?.toUpperCase() ?? 'OTHER';
  }))];
}

export function referencedObjects(statements) {
  const matches = new Set();
  for (const statement of Array.isArray(statements) ? statements : [statements]) {
    for (const match of String(statement).matchAll(/\b(?:public|storage|auth)\.[a-z_][a-z0-9_]*/gi)) matches.add(match[0].toLowerCase());
  }
  return [...matches].sort();
}

export function findExactRepositorySqlMatch(statements, migrations) {
  const candidate = normalizeSql((Array.isArray(statements) ? statements : [statements]).join('\n'));
  const matches = migrations.filter((migration) => normalizeSql(migration.content) === candidate);
  return matches.length === 1 ? matches[0].filename : null;
}

export function safeRemoteRowEvidence(row, migrations) {
  const statements = Array.isArray(row.statements) ? row.statements : [];
  return {
    remote_version: String(row.version),
    stored_name: String(row.name ?? ''),
    statement_count: statements.length,
    statements_sha256: fingerprintStatements(statements),
    operation_types: statementOperationTypes(statements),
    referenced_objects: referencedObjects(statements),
    exact_repository_sql_match: findExactRepositorySqlMatch(statements, migrations) ?? 'NONE',
  };
}

export function evidenceResult(assertions, requiresDataProof = false) {
  const values = assertions.map((assertion) => assertion.passed);
  if (requiresDataProof || values.length === 0 || values.some((value) => value === null || value === undefined)) return 'NOT_SAFELY_DETERMINABLE';
  if (values.every(Boolean)) return 'EFFECTS_PRESENT';
  if (values.every((value) => !value)) return 'EFFECTS_ABSENT';
  return 'EFFECTS_PARTIAL';
}

export function parseJsonLines(output) {
  return String(output).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function runReadOnlyQuery(databaseUrl, query, execute = execFileSync) {
  assertReadOnlyQuery(query);
  const output = execute('psql', [
    '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', databaseUrl, '--tuples-only', '--no-align', '--command', query,
  ], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
  });
  return parseJsonLines(output);
}

function assertionQuery(name, predicate) {
  return `SELECT json_build_object('assertion', '${name}', 'passed', (${predicate}))::text`;
}

function unresolvedRowsQuery() {
  const ids = UNRESOLVED_REMOTE_IDS.map((id) => `'${id}'`).join(', ');
  return `SELECT json_build_object('version', version, 'name', coalesce(name, ''), 'statements', coalesce(to_jsonb(statements), '[]'::jsonb))::text FROM supabase_migrations.schema_migrations WHERE version IN (${ids}) ORDER BY version`;
}

const CLEAN_TYPE_QUERY = `SELECT json_build_object(
  'column_exists', ${existsColumn('public.room_assignments', 'clean_type')},
  'type_text', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'room_assignments' AND column_name = 'clean_type' AND data_type = 'text'),
  'not_null', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'room_assignments' AND column_name = 'clean_type' AND is_nullable = 'NO'),
  'default_dep', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'room_assignments' AND column_name = 'clean_type' AND column_default LIKE '%DEP%'),
  'allowed_values', ${constraintContains('public.room_assignments', 'DEP')} AND ${constraintContains('public.room_assignments', 'FULL')} AND ${constraintContains('public.room_assignments', 'LIGHT')},
  'comment_present', coalesce(col_description(to_regclass('public.room_assignments'), (SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.room_assignments') AND attname = 'clean_type' AND NOT attisdropped)), '') LIKE '%DEP, FULL, or LIGHT%'
)::text`;

const UNAVAILABILITY_QUERY = `SELECT json_build_object(
  'function_exists', to_regprocedure('public.create_room_unavailability(uuid,uuid,text,text,text,text,timestamp with time zone,uuid,uuid,uuid,text)') IS NOT NULL,
  'out_of_order_semantics', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'create_room_unavailability' AND pg_get_functiondef(p.oid) LIKE '%OUT_OF_ORDER%'),
  'out_of_service_semantics', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'create_room_unavailability' AND pg_get_functiondef(p.oid) LIKE '%OUT_OF_SERVICE%')
)::text`;

function booleanAssertions(row) {
  return Object.entries(row).map(([assertion, passed]) => ({ assertion, passed: Boolean(passed) }));
}

export function buildSafeReport({ unresolvedRows, migrations, duplicateRows, pendingRows }) {
  return {
    environment: 'production',
    unresolved_remote_rows: unresolvedRows.map((row) => safeRemoteRowEvidence(row, migrations)),
    duplicate_file_evidence: duplicateRows,
    pending_file_evidence: pendingRows,
  };
}

export function runAudit(databaseUrl, execute = execFileSync) {
  const migrations = loadMigrations(resolve('supabase/migrations'));
  const unresolvedRows = runReadOnlyQuery(databaseUrl, unresolvedRowsQuery(), execute);
  const duplicateRows = [
    ['042_room_assignment_clean_type.sql', CLEAN_TYPE_QUERY],
    ['110_room_unavailability_type.sql', UNAVAILABILITY_QUERY],
  ].map(([filename, query]) => {
    const assertions = booleanAssertions(runReadOnlyQuery(databaseUrl, query, execute)[0] ?? {});
    return { migration: filename, assertions, result: evidenceResult(assertions) };
  });
  const pendingRows = PENDING_MIGRATION_EFFECTS.map(([filename, checks, requiresDataProof = false]) => {
    const assertions = checks.map(([name, predicate]) => {
      const row = runReadOnlyQuery(databaseUrl, assertionQuery(name, predicate), execute)[0] ?? {};
      return { assertion: name, passed: typeof row.passed === 'boolean' ? row.passed : null };
    });
    return { migration: filename, history_status: 'pending', assertions, result: evidenceResult(assertions, requiresDataProof) };
  });
  return buildSafeReport({ unresolvedRows, migrations, duplicateRows, pendingRows });
}

function main() {
  const databaseUrl = process.env.PRODUCTION_SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('PRODUCTION_SUPABASE_DB_URL is required and is never printed.');
  const reportPath = process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : 'production-migration-evidence-report.json';
  const report = runAudit(databaseUrl);
  writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Production migration evidence audit complete: ${report.unresolved_remote_rows.length} unresolved rows, ${report.duplicate_file_evidence.length} duplicate-file checks, ${report.pending_file_evidence.length} pending migration checks.`);
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
