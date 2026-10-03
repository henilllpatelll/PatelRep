import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/production-migration-evidence.yml', 'utf8');
const productionRelease = readFileSync('.github/workflows/production-release.yml', 'utf8');
const stagingCandidate = readFileSync('.github/workflows/staging-candidate.yml', 'utf8');

test('production migration evidence workflow is production-scoped, read-only, and sanitized', () => {
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /production-target-guard\.mjs/);
  assert.match(workflow, /audit-production-migration-evidence\.mjs --report/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /supabase db push|migration repair|supabase migration|railway|\b(?:UPDATE|INSERT|DELETE|ALTER)\s+(?:public|storage|supabase_migrations)\./i);
});

test('the investigation workflow does not replace existing release or staging migration gates', () => {
  assert.match(productionRelease, /check-db-drift\.mjs --environment production --allow-pending/);
  assert.match(stagingCandidate, /check-db-drift\.mjs --environment staging/);
});
