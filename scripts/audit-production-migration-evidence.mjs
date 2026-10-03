#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadMigrations } from './check-migrations.mjs';

const UNRESOLVED_REMOTE_IDS = ['20260517181733', '20260604070643', '20260724140005'];
const READ_ONLY_QUERY = /^\s*(?:select|with|show)\b/i;
const SUPPORTED_DATABASE_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const SUPPORTED_SSL_MODES = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']);

export function sqlStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const sqlContainsLiteral = (value) => sqlStringLiteral(`%${String(value)}%`);
const existsTable = (name) => `to_regclass(${sqlStringLiteral(name)}) IS NOT NULL`;
const columnDefinition = (table, column, { type, notNull, defaultIncludes = [] } = {}) => {
  const conditions = [`a.attrelid = to_regclass(${sqlStringLiteral(table)})`, `a.attname = ${sqlStringLiteral(column)}`, 'NOT a.attisdropped'];
  if (type) conditions.push(`format_type(a.atttypid, a.atttypmod) = ${sqlStringLiteral(type)}`);
  if (notNull !== undefined) conditions.push(`a.attnotnull IS ${notNull ? 'TRUE' : 'FALSE'}`);
  for (const value of defaultIncludes) conditions.push(`coalesce(pg_get_expr(d.adbin, d.adrelid), '') ILIKE ${sqlContainsLiteral(value)}`);
  return `EXISTS (SELECT 1 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE ${conditions.join(' AND ')})`;
};
const namedConstraint = (table, name, fragments) => `EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass(${sqlStringLiteral(table)}) AND c.conname = ${sqlStringLiteral(name)}${fragments.map((fragment) => ` AND pg_get_constraintdef(c.oid) ILIKE ${sqlContainsLiteral(fragment)}`).join('')})`;
const anyConstraint = (table, fragments) => `EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass(${sqlStringLiteral(table)})${fragments.map((fragment) => ` AND pg_get_constraintdef(c.oid) ILIKE ${sqlContainsLiteral(fragment)}`).join('')})`;
const indexDefinition = (name, table, fragments = [], predicateFragments = []) => `EXISTS (SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_class rel ON rel.oid = i.indrelid WHERE idx.relname = ${sqlStringLiteral(name)} AND i.indrelid = to_regclass(${sqlStringLiteral(table)})${fragments.map((fragment) => ` AND pg_get_indexdef(i.indexrelid) ILIKE ${sqlContainsLiteral(fragment)}`).join('')}${predicateFragments.map((fragment) => ` AND coalesce(pg_get_expr(i.indpred, i.indrelid), '') ILIKE ${sqlContainsLiteral(fragment)}`).join('')})`;
const tableRlsEnabled = (table) => `EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(${sqlStringLiteral(table)}) AND relrowsecurity)`;
export function policyExists(schema, table, name, command, role, expressionType, expressionFragment) {
  const expression = expressionType === 'with_check' ? 'p.polwithcheck' : 'p.polqual';
  const roleCheck = role === 'public'
    ? `p.polroles = '{0}'::oid[]`
    : `p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = ${sqlStringLiteral(role)})]::oid[]`;
  return `EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class rel ON rel.oid = p.polrelid JOIN pg_namespace n ON n.oid = rel.relnamespace WHERE n.nspname = ${sqlStringLiteral(schema)} AND rel.relname = ${sqlStringLiteral(table)} AND p.polname = ${sqlStringLiteral(name)} AND p.polcmd = ${sqlStringLiteral(command)} AND ${roleCheck} AND coalesce(pg_get_expr(${expression}, p.polrelid), '') ILIKE ${sqlContainsLiteral(expressionFragment)})`;
}
const interactionConstraint = (values) => namedConstraint('public.ai_interactions', 'ai_interactions_interaction_type_check', values);
const BASE_INTERACTION_TYPES = ['task_creation', 'room_prediction', 'sop_query', 'failure_prediction', 'shift_summary', 'gm_insight', 'assignment_suggestion', 'onboarding_assistant', 'work_order_triage', 'work_order_creation', 'guest_request_creation', 'task_assignment', 'general', 'housekeeping_briefing'];
const BRIEFING_INTERACTION_TYPES = [...BASE_INTERACTION_TYPES, 'supervisor_briefing', 'engineer_briefing', 'front_desk_briefing', 'gm_briefing'];

export const PENDING_MIGRATION_EFFECTS = [
  ['050_work_order_photos_bucket.sql', [
    ['work_order_photos_bucket', `EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'work-order-photos' AND name = 'work-order-photos' AND public AND file_size_limit = 5242880 AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp']::text[])`],
    ['work_order_upload_policy', policyExists('storage', 'objects', 'Authenticated staff can upload work order photos', 'a', 'authenticated', 'with_check', "bucket_id = 'work-order-photos'")],
    ['work_order_public_read_policy', policyExists('storage', 'objects', 'Public can view work order photos', 'r', 'public', 'using', "bucket_id = 'work-order-photos'")],
  ]],
  ['051_work_order_guest_reported.sql', [['guest_reported_column', columnDefinition('public.work_orders', 'guest_reported', { type: 'boolean', notNull: true, defaultIncludes: ['false'] })]]],
  ['052_strip_room.sql', [['stripped_column', columnDefinition('public.room_status', 'stripped', { type: 'boolean', notNull: true, defaultIncludes: ['false'] })], ['stripped_by_column', columnDefinition('public.room_status', 'stripped_by', { type: 'uuid' })], ['stripped_at_column', columnDefinition('public.room_status', 'stripped_at', { type: 'timestamp with time zone' })]]],
  ['058_clean_photos_private.sql', [
    ['clean_photos_bucket_private', `EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'clean-photos' AND NOT public)`],
    ['clean_photos_authenticated_read_policy', policyExists('storage', 'objects', 'Authenticated staff can view clean photos', 'r', 'authenticated', 'using', "bucket_id = 'clean-photos'")],
    ['clean_photos_public_read_policy_absent', `NOT ${policyExists('storage', 'objects', 'Public can view clean photos', 'r', 'public', 'using', "bucket_id = 'clean-photos'")}`],
  ]],
  ['098_flip_web_redesign_sections_on.sql', [['redesign_sections_default', `EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'public.tenants'::regclass AND a.attname = 'web_redesign_sections' AND pg_get_expr(d.adbin, d.adrelid) LIKE '%housekeeping%')`]], true],
  ['099_ai_interactions_widen_briefing_types.sql', [['interaction_type_constraint', interactionConstraint(BRIEFING_INTERACTION_TYPES)]]],
  ['100_ai_interactions_housekeeper_shift_recap.sql', [['interaction_type_constraint', interactionConstraint([...BRIEFING_INTERACTION_TYPES, 'housekeeper_shift_recap'])]]],
  ['119_shift_summary_identity.sql', [['handoff_data_column', columnDefinition('public.shift_summaries', 'handoff_data', { type: 'jsonb', notNull: true, defaultIncludes: ['{}'] })], ['updated_at_column', columnDefinition('public.shift_summaries', 'updated_at', { type: 'timestamp with time zone', notNull: true, defaultIncludes: ['now'] })], ['shift_identity_constraint', anyConstraint('public.shift_summaries', ['UNIQUE (tenant_id, shift_id, shift_date)'])]], true],
  ['120_logbook_search_indexes.sql', [['pg_trgm_extension', `EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')`], ['tenant_date_index', indexDefinition('idx_logbook_entries_tenant_entry_date', 'public.logbook_entries', ['tenant_id', 'entry_date'])], ['content_trgm_index', indexDefinition('idx_logbook_entries_content_trgm', 'public.logbook_entries', ['USING gin', 'gin_trgm_ops'])], ['author_date_index', indexDefinition('idx_logbook_entries_tenant_author_date', 'public.logbook_entries', ['tenant_id', 'author_id', 'entry_date'], ['author_id IS NOT NULL'])], ['related_date_index', indexDefinition('idx_logbook_entries_tenant_related_date', 'public.logbook_entries', ['tenant_id', 'related_type', 'related_id', 'entry_date'], ['related_id IS NOT NULL'])]]],
  ['121_logbook_collaboration.sql', [['requires_acknowledgment', columnDefinition('public.logbook_entries', 'requires_acknowledgment', { type: 'boolean', notNull: true, defaultIncludes: ['false'] })], ['acknowledgment_version', columnDefinition('public.logbook_entries', 'acknowledgment_version', { type: 'integer', notNull: true, defaultIncludes: ['1'] })], ['acknowledgment_version_check', anyConstraint('public.logbook_entries', ['acknowledgment_version', '>= 1'])], ['event_type_constraint', anyConstraint('public.logbook_entry_events', ['comment_added', 'acknowledgment_requested', 'acknowledgment_reset'])], ['comments_structure', existsTable('public.logbook_entry_comments') + ' AND ' + columnDefinition('public.logbook_entry_comments', 'content', { type: 'text', notNull: true })], ['mentions_unique', anyConstraint('public.logbook_comment_mentions', ['UNIQUE (comment_id, mentioned_user_id)'])], ['reads_unique', anyConstraint('public.logbook_entry_reads', ['UNIQUE (entry_id, user_id)'])], ['ack_targets_unique', anyConstraint('public.logbook_entry_ack_targets', ['UNIQUE (entry_id, user_id, version)'])], ['acknowledgments_unique', anyConstraint('public.logbook_entry_acknowledgments', ['UNIQUE (entry_id, user_id, version)'])], ['collaboration_indexes', indexDefinition('idx_logbook_comments_entry_created', 'public.logbook_entry_comments', ['entry_id', 'created_at'], ['deleted_at IS NULL']) + ' AND ' + indexDefinition('idx_logbook_reads_tenant_entry', 'public.logbook_entry_reads', ['tenant_id', 'entry_id']) + ' AND ' + indexDefinition('idx_logbook_ack_targets_current', 'public.logbook_entry_ack_targets', ['entry_id', 'version']) + ' AND ' + indexDefinition('idx_logbook_acknowledgments_current', 'public.logbook_entry_acknowledgments', ['entry_id', 'version'])], ['collaboration_rls', ['logbook_entry_comments', 'logbook_comment_mentions', 'logbook_entry_reads', 'logbook_entry_ack_targets', 'logbook_entry_acknowledgments'].map((table) => tableRlsEnabled(`public.${table}`) + ' AND ' + policyExists('public', table, 'tenant_isolation', '*', 'public', 'using', 'tenant_id')).join(' AND ')] ]],
  ['122_logbook_phase8_retention_translations.sql', [['archive_reason', columnDefinition('public.logbook_entries', 'archive_reason', { type: 'text' }) + ' AND ' + anyConstraint('public.logbook_entries', ['archive_reason', 'manual', 'expired'])], ['archived_by', columnDefinition('public.logbook_entries', 'archived_by', { type: 'uuid' }) + ` AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = to_regclass('public.logbook_entries') AND c.contype = 'f' AND a.attname = 'archived_by' AND c.confdeltype = 'n')`], ['expiry_index', indexDefinition('idx_logbook_entries_expiry_cleanup', 'public.logbook_entries', ['expires_at'], ['expires_at IS NOT NULL', 'archived_at IS NULL'])], ['translations_structure', existsTable('public.logbook_content_translations') + ' AND ' + columnDefinition('public.logbook_content_translations', 'source_hash', { type: 'text', notNull: true }) + ' AND ' + anyConstraint('public.logbook_content_translations', ['UNIQUE (tenant_id, source_type, source_id, source_hash, target_language)'])], ['translation_index_and_rls', indexDefinition('idx_logbook_translation_lookup', 'public.logbook_content_translations', ['tenant_id', 'source_type', 'source_id', 'source_hash', 'target_language']) + ' AND ' + tableRlsEnabled('public.logbook_content_translations') + ' AND ' + policyExists('public', 'logbook_content_translations', 'tenant_isolation', '*', 'public', 'using', 'tenant_id')], ['event_type_constraint', anyConstraint('public.logbook_entry_events', ['attachment_removed', 'comment_added', 'acknowledgment_requested', 'acknowledgment_reset'])] ]],
  ['124_housekeeping_workload_settings.sql', [['target_credits_column', columnDefinition('public.tenants', 'housekeeping_target_credits', { type: 'numeric(5,2)' })], ['credit_weights_column', columnDefinition('public.tenants', 'housekeeping_credit_weights', { type: 'jsonb' })], ['capacity_overrides_column', columnDefinition('public.tenants', 'housekeeping_capacity_overrides', { type: 'jsonb' })]]],
  ['126_housekeeping_assignment_preferences.sql', [['assignment_preferences_column', columnDefinition('public.tenants', 'housekeeping_assignment_preferences', { type: 'jsonb' })]]],
  ['202_schema_readiness_contract.sql', [['schema_readiness_function', `EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'app_schema_readiness' AND pg_get_function_identity_arguments(p.oid) = '' AND p.provolatile = 's' AND p.prosecdef AND coalesce(array_to_string(p.proconfig, ','), '') LIKE '%search_path=pg_catalog, public%' AND pg_get_functiondef(p.oid) LIKE '%schema_contract_version%, 130%' AND pg_get_functiondef(p.oid) LIKE '%room_status%' AND pg_get_functiondef(p.oid) LIKE '%match_sop_chunks%' AND pg_get_functiondef(p.oid) LIKE '%pgcrypto%' AND pg_get_functiondef(p.oid) LIKE '%vector%' AND has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))`]]],
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

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('Production database URL must be valid and percent-encoded correctly.');
  }
}

export function createLibpqEnvironment(databaseUrl, environment = process.env) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('Production database URL must be valid.');
  }
  if (!SUPPORTED_DATABASE_PROTOCOLS.has(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === '/') {
    throw new Error('Production database URL must use a supported PostgreSQL connection format.');
  }

  const sslMode = url.searchParams.get('sslmode');
  if (sslMode !== null && !SUPPORTED_SSL_MODES.has(sslMode)) {
    throw new Error('Production database URL contains an unsupported sslmode.');
  }

  const safeEnvironment = Object.fromEntries(
    Object.entries(environment).filter(([key]) => key !== 'PRODUCTION_SUPABASE_DB_URL' && !key.startsWith('PG')),
  );
  const libpqEnvironment = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeUrlComponent(url.username),
    PGPASSWORD: decodeUrlComponent(url.password),
    PGDATABASE: decodeUrlComponent(url.pathname.slice(1)),
  };
  if (sslMode !== null) libpqEnvironment.PGSSLMODE = sslMode;
  return { ...safeEnvironment, ...libpqEnvironment };
}

export function buildReadOnlyTransaction(query) {
  const normalized = String(query).trim().replace(/;$/, '');
  assertReadOnlyQuery(normalized);
  return `BEGIN TRANSACTION READ ONLY;\n${normalized};\nCOMMIT;`;
}

function auditError(label, category) {
  return new Error(`Production migration evidence query failed: ${label} (${category}).`);
}

export function classifyDatabaseError(error) {
  const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr ?? '');
  if (/password authentication failed|authentication failed/i.test(stderr)) return 'AUTHENTICATION_FAILED';
  if (/unsupported startup parameter|unrecognized configuration parameter/i.test(stderr)) return 'UNSUPPORTED_STARTUP_PARAMETER';
  if (/relation .* does not exist/i.test(stderr)) return 'MISSING_RELATION';
  if (/column .* does not exist/i.test(stderr)) return 'MISSING_COLUMN';
  if (/permission denied/i.test(stderr)) return 'PERMISSION_DENIED';
  if (/read-only transaction|cannot execute .* in a read-only/i.test(stderr)) return 'READ_ONLY_ENFORCEMENT_FAILED';
  if (/syntax error/i.test(stderr)) return 'QUERY_SYNTAX_FAILED';
  if (/could not connect|connection refused|connection timed out|server closed the connection|network is unreachable/i.test(stderr)) return 'CONNECTION_FAILED';
  return 'UNKNOWN_DATABASE_ERROR';
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

export function safeRemoteRowEvidence(row, migrations, { statementsAvailable = Object.hasOwn(row, 'statements') } = {}) {
  if (!statementsAvailable) {
    return {
      remote_version: String(row.version),
      stored_name: String(row.name ?? ''),
      statements_available: false,
      statement_count: null,
      statements_sha256: null,
      operation_types: null,
      referenced_objects: null,
      exact_repository_sql_match: 'NOT_SAFELY_DETERMINABLE',
    };
  }
  const statements = Array.isArray(row.statements) ? row.statements : [];
  return {
    remote_version: String(row.version),
    stored_name: String(row.name ?? ''),
    statements_available: true,
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

export function runReadOnlyQuery(databaseUrl, query, execute = execFileSync, label = 'read-only audit') {
  const transaction = buildReadOnlyTransaction(query);
  try {
    const output = execute('psql', [
      '--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', transaction,
    ], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: createLibpqEnvironment(databaseUrl),
    });
    return parseJsonLines(output);
  } catch (error) {
    throw auditError(label, classifyDatabaseError(error));
  }
}

export function buildAssertionQuery(name, predicate) {
  return `SELECT json_build_object('assertion', ${sqlStringLiteral(name)}, 'passed', (${predicate}))::text`;
}

function unresolvedRowsQuery(statementsAvailable) {
  const ids = UNRESOLVED_REMOTE_IDS.map(sqlStringLiteral).join(', ');
  const statements = statementsAvailable ? ", 'statements', coalesce(to_jsonb(statements), '[]'::jsonb)" : '';
  return `SELECT json_build_object('version', version, 'name', coalesce(name, '')${statements})::text FROM supabase_migrations.schema_migrations WHERE version IN (${ids}) ORDER BY version`;
}

const READ_ONLY_PROBE_QUERY = "SELECT json_build_object('transaction_read_only', current_setting('transaction_read_only')::boolean)::text";
const MIGRATION_HISTORY_SHAPE_QUERY = "SELECT json_build_object('relation_exists', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL, 'version', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations' AND column_name = 'version'), 'name', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations' AND column_name = 'name'), 'statements', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations' AND column_name = 'statements'))::text";

export function assertReadOnlyProbe(rows) {
  if (rows[0]?.transaction_read_only !== true) throw auditError('read-only connection probe', 'READ_ONLY_ENFORCEMENT_FAILED');
}

export function assertMigrationHistoryShape(shape) {
  if (!shape?.relation_exists) throw auditError('migration history metadata audit', 'MISSING_RELATION');
  if (!shape.version || !shape.name) throw auditError('migration history metadata audit', 'MISSING_COLUMN');
  return { statementsAvailable: shape.statements === true };
}

const CLEAN_TYPE_QUERY = `SELECT json_build_object(
  'column_definition', ${columnDefinition('public.room_assignments', 'clean_type', { type: 'text', notNull: true, defaultIncludes: ['DEP'] })},
  'allowed_values_constraint', ${anyConstraint('public.room_assignments', ['CHECK', 'clean_type', 'DEP', 'FULL', 'LIGHT'])},
  'comment_present', coalesce(col_description(to_regclass('public.room_assignments'), (SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.room_assignments') AND attname = 'clean_type' AND NOT attisdropped)), '') LIKE '%DEP, FULL, or LIGHT%'
)::text`;

const UNAVAILABILITY_QUERY = `SELECT json_build_object(
  'function_signature_and_security', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.oid = to_regprocedure('public.create_room_unavailability(uuid,uuid,text,text,text,text,timestamp with time zone,uuid,uuid,uuid,text)') AND p.prosecdef AND coalesce(array_to_string(p.proconfig, ','), '') LIKE '%search_path=public%'),
  'type_validation', EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.create_room_unavailability(uuid,uuid,text,text,text,text,timestamp with time zone,uuid,uuid,uuid,text)') AND pg_get_functiondef(p.oid) LIKE '%OUT_OF_ORDER%' AND pg_get_functiondef(p.oid) LIKE '%OUT_OF_SERVICE%'),
  'period_insert', EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.create_room_unavailability(uuid,uuid,text,text,text,text,timestamp with time zone,uuid,uuid,uuid,text)') AND pg_get_functiondef(p.oid) LIKE '%INSERT INTO room_unavailability_periods%'),
  'room_status_update', EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.create_room_unavailability(uuid,uuid,text,text,text,text,timestamp with time zone,uuid,uuid,uuid,text)') AND pg_get_functiondef(p.oid) LIKE '%UPDATE room_status%' AND pg_get_functiondef(p.oid) LIKE '%OOO%'),
  'history_and_event_writes', EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.create_room_unavailability(uuid,uuid,text,text,text,text,timestamp with time zone,uuid,uuid,uuid,text)') AND pg_get_functiondef(p.oid) LIKE '%room_status_history%' AND pg_get_functiondef(p.oid) LIKE '%room_unavailability_events%' AND pg_get_functiondef(p.oid) LIKE '%CREATED%'),
  'service_role_only_privileges', EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.create_room_unavailability(uuid,uuid,text,text,text,text,timestamp with time zone,uuid,uuid,uuid,text)') AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))
)::text`;

function booleanAssertions(row) {
  return Object.entries(row).map(([assertion, passed]) => ({ assertion, passed: Boolean(passed) }));
}

export function buildSafeReport({ unresolvedRows, migrations, duplicateRows, pendingRows, statementsAvailable = true }) {
  return {
    environment: 'production',
    unresolved_remote_rows: unresolvedRows.map((row) => safeRemoteRowEvidence(row, migrations, { statementsAvailable })),
    duplicate_file_evidence: duplicateRows,
    pending_file_evidence: pendingRows,
  };
}

export function auditSummary(report) {
  return `Production migration evidence audit complete: ${report.unresolved_remote_rows.length} unresolved rows, ${report.duplicate_file_evidence.length} duplicate-file checks, ${report.pending_file_evidence.length} pending migration checks.`;
}

export function runAudit(databaseUrl, execute = execFileSync) {
  const migrations = loadMigrations(resolve('supabase/migrations'));
  assertReadOnlyProbe(runReadOnlyQuery(databaseUrl, READ_ONLY_PROBE_QUERY, execute, 'read-only connection probe'));
  const { statementsAvailable } = assertMigrationHistoryShape(
    runReadOnlyQuery(databaseUrl, MIGRATION_HISTORY_SHAPE_QUERY, execute, 'migration history metadata audit')[0],
  );
  const unresolvedRows = runReadOnlyQuery(databaseUrl, unresolvedRowsQuery(statementsAvailable), execute, 'unresolved migration history audit');
  const duplicateRows = [
    ['042_room_assignment_clean_type.sql', CLEAN_TYPE_QUERY],
    ['110_room_unavailability_type.sql', UNAVAILABILITY_QUERY],
  ].map(([filename, query]) => {
    const assertions = booleanAssertions(runReadOnlyQuery(databaseUrl, query, execute, `duplicate migration ${filename} audit`)[0] ?? {});
    return { migration: filename, assertions, result: evidenceResult(assertions) };
  });
  const pendingRows = PENDING_MIGRATION_EFFECTS.map(([filename, checks, requiresDataProof = false]) => {
    const assertions = checks.map(([name, predicate]) => {
      const row = runReadOnlyQuery(databaseUrl, buildAssertionQuery(name, predicate), execute, `pending migration ${filename} audit`)[0] ?? {};
      return { assertion: name, passed: typeof row.passed === 'boolean' ? row.passed : null };
    });
    return { migration: filename, history_status: 'pending', assertions, result: evidenceResult(assertions, requiresDataProof) };
  });
  return buildSafeReport({ unresolvedRows, migrations, duplicateRows, pendingRows, statementsAvailable });
}

export function buildSanitizedFailureReport(error) {
  const message = error instanceof Error && /^Production migration evidence query failed: [A-Za-z0-9 ._-]+ \([A-Z_]+\)\.$/.test(error.message)
    ? error.message
    : 'Production migration evidence query failed: audit execution (UNKNOWN_DATABASE_ERROR).';
  return { environment: 'production', status: 'FAILED', error: { message } };
}

function main() {
  const databaseUrl = process.env.PRODUCTION_SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('PRODUCTION_SUPABASE_DB_URL is required and is never printed.');
  const reportPath = process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : 'production-migration-evidence-report.json';
  try {
    const report = runAudit(databaseUrl);
    writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(auditSummary(report));
  } catch (error) {
    const report = buildSanitizedFailureReport(error);
    writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error(report.error.message);
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
