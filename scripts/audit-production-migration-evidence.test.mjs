import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertMigrationHistoryShape,
  assertReadOnlyProbe,
  assertReadOnlyQuery,
  auditSummary,
  buildReadOnlyTransaction,
  buildSanitizedFailureReport,
  buildAssertionQuery,
  CLEAN_TYPE_QUERY,
  classifyDatabaseError,
  createLibpqEnvironment,
  escapeLikePattern,
  evidenceResult,
  fingerprintStatements,
  findExactRepositorySqlMatch,
  PENDING_MIGRATION_EFFECTS,
  policyExists,
  runReadOnlyQuery,
  runAudit,
  safeRemoteRowEvidence,
  sqlContainsLiteral,
  sqlStringLiteral,
  UNAVAILABILITY_QUERY,
} from './audit-production-migration-evidence.mjs';

function hasBalancedSqlStringLiterals(sql) {
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] !== "'") continue;
    index += 1;
    while (index < sql.length) {
      if (sql[index] !== "'") {
        index += 1;
        continue;
      }
      if (sql[index + 1] === "'") {
        index += 2;
        continue;
      }
      break;
    }
    if (index >= sql.length) return false;
  }
  return true;
}

test('statement fingerprints are deterministic and never expose raw SQL in evidence', () => {
  const statements = ['CREATE TABLE public.safe_table (id uuid);'];
  assert.equal(fingerprintStatements(statements), fingerprintStatements([...statements]));
  const evidence = safeRemoteRowEvidence({ version: '20260000000000', name: 'safe', statements }, []);
  assert.equal(JSON.stringify(evidence).includes(statements[0]), false);
});

test('exact SQL comparison is normalized but never fuzzy', () => {
  const migrations = [{ filename: '050_example.sql', content: 'CREATE TABLE public.example (id uuid);' }];
  assert.equal(findExactRepositorySqlMatch(['CREATE TABLE public.example (id uuid);'], migrations), '050_example.sql');
  assert.equal(findExactRepositorySqlMatch(['CREATE TABLE public.examples (id uuid);'], migrations), null);
});

test('only SELECT, WITH, and SHOW audit queries are accepted', () => {
  for (const query of ['SELECT 1', 'WITH item AS (SELECT 1) SELECT * FROM item', 'SHOW transaction_read_only']) assert.doesNotThrow(() => assertReadOnlyQuery(query));
  for (const query of ['UPDATE public.tenants SET name = \'x\'', 'INSERT INTO public.tenants DEFAULT VALUES', 'ALTER TABLE public.tenants ADD COLUMN x text', 'SELECT 1; DELETE FROM public.tenants']) assert.throws(() => assertReadOnlyQuery(query));
});

test('pending evidence remains conservative across all result states', () => {
  assert.equal(evidenceResult([{ passed: true }]), 'EFFECTS_PRESENT');
  assert.equal(evidenceResult([{ passed: false }]), 'EFFECTS_ABSENT');
  assert.equal(evidenceResult([{ passed: true }, { passed: false }]), 'EFFECTS_PARTIAL');
  assert.equal(evidenceResult([{ passed: true }], true), 'NOT_SAFELY_DETERMINABLE');
});

test('every pending migration is represented and psql receives decomposed libpq settings only', () => {
  assert.equal(PENDING_MIGRATION_EFFECTS.length, 14);
  let invocation;
  const databaseUrl = 'postgresql://first%20last:pa%24%25word@db.example:6543/prod%2Fdata?sslmode=require';
  const result = runReadOnlyQuery(databaseUrl, 'SELECT json_build_object(\'ok\', true)::text', (command, argumentsList, options) => {
    invocation = { command, argumentsList, options };
    return '{"ok":true}\n';
  });
  assert.deepEqual(result, [{ ok: true }]);
  assert.equal(invocation.command, 'psql');
  assert.equal(invocation.argumentsList.includes(databaseUrl), false);
  assert.equal(JSON.stringify(invocation.argumentsList).includes(databaseUrl), false);
  assert.equal(invocation.options.env.PGHOST, 'db.example');
  assert.equal(invocation.options.env.PGPORT, '6543');
  assert.equal(invocation.options.env.PGUSER, 'first last');
  assert.equal(invocation.options.env.PGPASSWORD, 'pa$%word');
  assert.equal(invocation.options.env.PGDATABASE, 'prod/data');
  assert.equal(invocation.options.env.PGSSLMODE, 'require');
  assert.equal('PRODUCTION_SUPABASE_DB_URL' in invocation.options.env, false);
  assert.equal('PGOPTIONS' in invocation.options.env, false);
  assert.equal(invocation.argumentsList.includes('--quiet'), true);
  const command = invocation.argumentsList[invocation.argumentsList.indexOf('--command') + 1];
  assert.match(command, /^BEGIN TRANSACTION READ ONLY;\nSELECT json_build_object\('ok', true\)::text;\nCOMMIT;$/);
  assert.equal(JSON.stringify(result).includes(databaseUrl), false);
});

test('only PostgreSQL URLs are accepted for the private libpq connection environment', () => {
  const unsafeUrl = 'https://secret.example/not-a-database';
  assert.throws(() => createLibpqEnvironment(unsafeUrl), (error) => (
    error.message === 'Production database URL must use a supported PostgreSQL connection format.'
    && !error.message.includes(unsafeUrl)
  ));
});

test('trusted audit constants become valid PostgreSQL string literals', () => {
  assert.equal(sqlStringLiteral('normal fragment'), "'normal fragment'");
  assert.equal(sqlStringLiteral("bucket_id = 'work-order-photos'"), "'bucket_id = ''work-order-photos'''");
  assert.equal(sqlStringLiteral("O'Brien's 100%_ready"), "'O''Brien''s 100%_ready'");
});

test('trusted evidence fragments become literal LIKE substrings with an explicit escape character', () => {
  assert.equal(escapeLikePattern('task_creation'), 'task!_creation');
  assert.equal(escapeLikePattern('housekeeper_shift_recap'), 'housekeeper!_shift!_recap');
  assert.equal(escapeLikePattern('100%_ready'), '100!%!_ready');
  assert.equal(escapeLikePattern('value!with!escape'), 'value!!with!!escape');
  assert.equal(sqlContainsLiteral('task_creation'), "'%task!_creation%' ESCAPE '!'");
  assert.equal(sqlContainsLiteral('housekeeper_shift_recap'), "'%housekeeper!_shift!_recap%' ESCAPE '!'");
  assert.equal(sqlContainsLiteral('100%_ready'), "'%100!%!_ready%' ESCAPE '!'");
  assert.equal(sqlContainsLiteral('value!with!escape'), "'%value!!with!!escape%' ESCAPE '!'");
  assert.equal(sqlContainsLiteral("bucket_id = 'work-order-photos'"), "'%bucket!_id = ''work-order-photos''%' ESCAPE '!'");
});

test('photo policy evidence preserves quoted bucket predicates with valid SQL literals', () => {
  const upload = policyExists('storage', 'objects', 'Authenticated staff can upload work order photos', 'a', 'authenticated', 'with_check', "bucket_id = 'work-order-photos'");
  const cleanPhotos = policyExists('storage', 'objects', 'Authenticated staff can view clean photos', 'r', 'authenticated', 'using', "bucket_id = 'clean-photos'");
  assert.match(upload, /ILIKE '%bucket!_id = ''work-order-photos''%' ESCAPE '!'/);
  assert.match(cleanPhotos, /ILIKE '%bucket!_id = ''clean-photos''%' ESCAPE '!'/);
  assert.equal(hasBalancedSqlStringLiterals(upload), true);
  assert.equal(hasBalancedSqlStringLiterals(cleanPhotos), true);
});

test('all pending migration predicates embed into single read-only assertion SELECT statements', () => {
  const pending = new Map(PENDING_MIGRATION_EFFECTS.map(([filename, checks]) => [filename, checks]));
  for (const [filename, checks] of pending) {
    for (const [assertion, predicate] of checks) {
      const query = buildAssertionQuery(assertion, predicate);
      assert.doesNotThrow(() => assertReadOnlyQuery(query), `${filename}:${assertion}`);
      assert.equal(hasBalancedSqlStringLiterals(query), true, `${filename}:${assertion}`);
    }
  }
  const checks = (filename) => pending.get(filename).map(([, predicate]) => predicate).join('\n');
  assert.match(checks('050_work_order_photos_bucket.sql'), /bucket!_id = ''work-order-photos''/);
  assert.match(checks('058_clean_photos_private.sql'), /bucket!_id = ''clean-photos''/);
  assert.match(checks('099_ai_interactions_widen_briefing_types.sql'), /task!_creation/);
  assert.match(checks('100_ai_interactions_housekeeper_shift_recap.sql'), /housekeeper!_shift!_recap/);
  assert.match(checks('202_schema_readiness_contract.sql'), /schema!_contract!_version'', 130/);
  assert.match(checks('202_schema_readiness_contract.sql'), /room!_status/);
  assert.match(checks('202_schema_readiness_contract.sql'), /match!_sop!_chunks/);
});

test('duplicate migration structural evidence uses the same literal LIKE contract', () => {
  for (const [name, predicate] of [['clean_type', CLEAN_TYPE_QUERY], ['room_unavailability', UNAVAILABILITY_QUERY]]) {
    const query = buildAssertionQuery(name, predicate);
    assert.doesNotThrow(() => assertReadOnlyQuery(query));
    assert.equal(hasBalancedSqlStringLiterals(query), true);
  }
  assert.match(UNAVAILABILITY_QUERY, /OUT!_OF!_ORDER/);
  assert.match(UNAVAILABILITY_QUERY, /room!_unavailability!_events/);
});

test('the read-only wrapper rejects writes and makes the database transaction the final safety boundary', () => {
  assert.match(buildReadOnlyTransaction('SELECT 1'), /^BEGIN TRANSACTION READ ONLY;\nSELECT 1;\nCOMMIT;$/);
  assert.throws(() => buildReadOnlyTransaction('UPDATE public.tenants SET name = \'x\''), /non-read-only query/);
});

test('read-only probe requires PostgreSQL to report true inside the transaction', () => {
  assert.doesNotThrow(() => assertReadOnlyProbe([{ transaction_read_only: true }]));
  assert.throws(() => assertReadOnlyProbe([{ transaction_read_only: false }]), /READ_ONLY_ENFORCEMENT_FAILED/);
  assert.throws(() => assertReadOnlyProbe([]), /READ_ONLY_ENFORCEMENT_FAILED/);
});

test('psql stderr is classified and sanitized without exposing the production database URL', () => {
  const databaseUrl = 'postgresql://audit_user:secret_password@secret.example/production';
  assert.throws(() => runReadOnlyQuery(databaseUrl, 'SELECT 1', () => {
    const error = new Error(`psql failed for ${databaseUrl}`);
    error.stderr = Buffer.from('password authentication failed for user');
    throw error;
  }, 'pending migration 051 audit'), (error) => (
    error.message === 'Production migration evidence query failed: pending migration 051 audit (AUTHENTICATION_FAILED).'
    && !error.message.includes(databaseUrl)
  ));
  assert.equal(classifyDatabaseError({ stderr: Buffer.from('unsupported startup parameter: default_transaction_read_only') }), 'UNSUPPORTED_STARTUP_PARAMETER');
  assert.equal(classifyDatabaseError({ stderr: Buffer.from('relation "schema_migrations" does not exist') }), 'MISSING_RELATION');
  assert.equal(classifyDatabaseError({ stderr: Buffer.from('column "statements" does not exist') }), 'MISSING_COLUMN');
  assert.equal(classifyDatabaseError({ stderr: Buffer.from('permission denied for table schema_migrations') }), 'PERMISSION_DENIED');
  assert.equal(classifyDatabaseError({ stderr: Buffer.from('cannot execute UPDATE in a read-only transaction') }), 'READ_ONLY_ENFORCEMENT_FAILED');
  assert.equal(classifyDatabaseError({ stderr: Buffer.from('syntax error at or near "oops"') }), 'QUERY_SYNTAX_FAILED');
  assert.equal(classifyDatabaseError({ stderr: Buffer.from('could not connect to server') }), 'CONNECTION_FAILED');
  assert.equal(classifyDatabaseError({ stderr: Buffer.from('unrecognized failure') }), 'UNKNOWN_DATABASE_ERROR');
});

test('migration history requires version and name but permits a missing statements column safely', () => {
  assert.doesNotThrow(() => assertMigrationHistoryShape({ relation_exists: true, version: true, name: true, statements: true }));
  assert.throws(() => assertMigrationHistoryShape({ relation_exists: true, version: false, name: true, statements: true }), /MISSING_COLUMN/);
  assert.throws(() => assertMigrationHistoryShape({ relation_exists: false, version: false, name: false, statements: false }), /MISSING_RELATION/);
  const evidence = safeRemoteRowEvidence({ version: '20260517181733', name: 'legacy_migration' }, [], { statementsAvailable: false });
  assert.deepEqual(evidence, {
    remote_version: '20260517181733',
    stored_name: 'legacy_migration',
    statements_available: false,
    statement_count: null,
    statements_sha256: null,
    operation_types: null,
    referenced_objects: null,
    exact_repository_sql_match: 'NOT_SAFELY_DETERMINABLE',
  });
});

test('audit retains unresolved migration rows when legacy history has no statements column', () => {
  const databaseUrl = 'postgresql://audit_user:secret_password@secret.example/production';
  const invocations = [];
  const report = runAudit(databaseUrl, (command, argumentsList) => {
    invocations.push({ command, argumentsList });
    const query = argumentsList[argumentsList.indexOf('--command') + 1];
    if (query.includes("current_setting('transaction_read_only')")) return '{"transaction_read_only":true}\n';
    if (query.includes("'relation_exists'")) return '{"relation_exists":true,"version":true,"name":true,"statements":false}\n';
    if (query.includes('WHERE version IN')) return [
      '{"version":"20260517181733","name":"first"}',
      '{"version":"20260604070643","name":"second"}',
      '{"version":"20260724140005","name":"third"}',
    ].join('\n') + '\n';
    return '{"passed":true}\n';
  });
  assert.equal(report.unresolved_remote_rows.length, 3);
  assert.equal(report.unresolved_remote_rows.every((row) => row.statements_available === false), true);
  assert.equal(report.unresolved_remote_rows.every((row) => row.exact_repository_sql_match === 'NOT_SAFELY_DETERMINABLE'), true);
  assert.equal(invocations.every(({ command, argumentsList }) => command === 'psql' && argumentsList.includes('--quiet') && /^BEGIN TRANSACTION READ ONLY;/.test(argumentsList[argumentsList.indexOf('--command') + 1])), true);
  assert.equal(JSON.stringify(report).includes(databaseUrl), false);
});

test('serialized reports and normal console summaries never include a database URL', () => {
  const databaseUrl = 'postgresql://secret.example/production';
  const report = { environment: 'production', unresolved_remote_rows: [], duplicate_file_evidence: [], pending_file_evidence: [] };
  assert.equal(JSON.stringify(report).includes(databaseUrl), false);
  assert.equal(auditSummary(report).includes(databaseUrl), false);
  assert.equal(JSON.stringify(buildSanitizedFailureReport(new Error(databaseUrl))).includes(databaseUrl), false);
});

test('policy evidence is scoped to the exact schema and table, even for reused tenant_isolation names', () => {
  const comments = policyExists('public', 'logbook_entry_comments', 'tenant_isolation', '*', 'public', 'using', 'tenant_id');
  const reads = policyExists('public', 'logbook_entry_reads', 'tenant_isolation', '*', 'public', 'using', 'tenant_id');
  assert.match(comments, /n\.nspname = 'public' AND rel\.relname = 'logbook_entry_comments'/);
  assert.match(reads, /n\.nspname = 'public' AND rel\.relname = 'logbook_entry_reads'/);
  assert.notEqual(comments, reads);
});

test('incomplete structural evidence never becomes EFFECTS_PRESENT', () => {
  assert.equal(evidenceResult([{ passed: true }, { passed: false }]), 'EFFECTS_PARTIAL');
  assert.equal(evidenceResult([{ passed: false }, { passed: false }]), 'EFFECTS_ABSENT');
  assert.equal(evidenceResult([{ passed: true }, { passed: null }]), 'NOT_SAFELY_DETERMINABLE');
});

test('catalog predicates require named interaction constraints, definitions, and complete structures', () => {
  const pending = new Map(PENDING_MIGRATION_EFFECTS.map(([filename, checks]) => [filename, checks]));
  const checks = (filename) => pending.get(filename).map(([, predicate]) => predicate).join('\n');
  assert.match(checks('099_ai_interactions_widen_briefing_types.sql'), /conname = 'ai_interactions_interaction_type_check'/);
  assert.match(checks('100_ai_interactions_housekeeper_shift_recap.sql'), /housekeeper!_shift!_recap/);
  assert.match(checks('120_logbook_search_indexes.sql'), /pg_get_indexdef/);
  assert.match(checks('121_logbook_collaboration.sql'), /logbook_entry_acknowledgments/);
  assert.match(checks('202_schema_readiness_contract.sql'), /provolatile = 's'/);
  assert.match(checks('202_schema_readiness_contract.sql'), /prosecdef/);
});
