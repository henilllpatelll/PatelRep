import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertReadOnlyQuery,
  auditSummary,
  evidenceResult,
  fingerprintStatements,
  findExactRepositorySqlMatch,
  PENDING_MIGRATION_EFFECTS,
  policyExists,
  runReadOnlyQuery,
  safeRemoteRowEvidence,
} from './audit-production-migration-evidence.mjs';

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

test('every pending migration is represented and psql receives the URL only through PGDATABASE', () => {
  assert.equal(PENDING_MIGRATION_EFFECTS.length, 14);
  let invocation;
  const result = runReadOnlyQuery('postgresql://secret.example/production', 'SELECT json_build_object(\'ok\', true)::text', (command, argumentsList, options) => {
    invocation = { command, argumentsList, options };
    return '{"ok":true}\n';
  });
  assert.deepEqual(result, [{ ok: true }]);
  assert.equal(invocation.command, 'psql');
  assert.equal(invocation.argumentsList.includes('postgresql://secret.example/production'), false);
  assert.equal(invocation.options.env.PGDATABASE, 'postgresql://secret.example/production');
  assert.equal('PRODUCTION_SUPABASE_DB_URL' in invocation.options.env, false);
  assert.match(invocation.options.env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.equal(JSON.stringify(result).includes('secret.example'), false);
});

test('psql failures are sanitized and cannot expose the production database URL', () => {
  const databaseUrl = 'postgresql://secret.example/production';
  assert.throws(() => runReadOnlyQuery(databaseUrl, 'SELECT 1', () => {
    throw new Error(`psql failed for ${databaseUrl}`);
  }, 'pending migration 051 audit'), (error) => (
    error.message === 'Production migration evidence query failed: pending migration 051 audit.'
    && !error.message.includes(databaseUrl)
  ));
});

test('serialized reports and normal console summaries never include a database URL', () => {
  const databaseUrl = 'postgresql://secret.example/production';
  const report = { environment: 'production', unresolved_remote_rows: [], duplicate_file_evidence: [], pending_file_evidence: [] };
  assert.equal(JSON.stringify(report).includes(databaseUrl), false);
  assert.equal(auditSummary(report).includes(databaseUrl), false);
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
  assert.match(checks('100_ai_interactions_housekeeper_shift_recap.sql'), /housekeeper_shift_recap/);
  assert.match(checks('120_logbook_search_indexes.sql'), /pg_get_indexdef/);
  assert.match(checks('121_logbook_collaboration.sql'), /logbook_entry_acknowledgments/);
  assert.match(checks('202_schema_readiness_contract.sql'), /provolatile = 's'/);
  assert.match(checks('202_schema_readiness_contract.sql'), /prosecdef/);
});
