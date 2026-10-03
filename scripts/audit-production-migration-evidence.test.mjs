import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertReadOnlyQuery,
  evidenceResult,
  fingerprintStatements,
  findExactRepositorySqlMatch,
  PENDING_MIGRATION_EFFECTS,
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

test('every pending migration is represented and psql is forced into read-only mode without logging its URL', () => {
  assert.equal(PENDING_MIGRATION_EFFECTS.length, 14);
  let invocation;
  const result = runReadOnlyQuery('postgresql://secret.example/production', 'SELECT json_build_object(\'ok\', true)::text', (command, argumentsList, options) => {
    invocation = { command, argumentsList, options };
    return '{"ok":true}\n';
  });
  assert.deepEqual(result, [{ ok: true }]);
  assert.equal(invocation.command, 'psql');
  assert.match(invocation.options.env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.equal(JSON.stringify(result).includes('secret.example'), false);
});
