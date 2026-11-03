#!/usr/bin/env node
/**
 * Read-only plan for migrating the PERSISTENT shared staging database forward.
 *
 * Staging is never rebuilt or wiped. A candidate may only add migrations that staging has not applied yet, and only
 * when staging history is a strict prefix of the candidate's repository history. This script reads migration history
 * with the fixed SELECT queries in check-db-drift.mjs and decides; it never writes. It fails closed when
 *   - staging has migrations this candidate does not know (another branch's migrations are already applied), or
 *   - any pending migration contains destructive SQL (those need the human-run `Staging Database Migrate` from main).
 */
import { appendFileSync } from 'node:fs';

import { evaluateLiveMigrationDrift, normalizeVersion } from './check-db-drift.mjs';
import { DESTRUCTIVE_PATTERN } from './check-migrations.mjs';

export function planStagingMigrations({ evaluation, migrations }) {
  if (evaluation.status === 'BLOCKED') {
    const unknown = evaluation.unknownOnRemote.length ? ` Unknown on staging: ${evaluation.unknownOnRemote.join(', ')}.` : '';
    const incomplete = evaluation.duplicateCoverage?.incompleteGroups?.length ? ' Duplicate-identifier coverage is incomplete.' : '';
    throw new Error(`Refusing to migrate staging: its history is not a prefix of this candidate.${unknown}${incomplete} Staging is never reset; resolve through main or the Staging Database Migrate workflow.`);
  }
  const pendingVersions = new Set(evaluation.missingOnRemote.map(normalizeVersion));
  const pending = migrations.filter((migration) => migration.version && pendingVersions.has(normalizeVersion(migration.version)));
  const destructive = pending.filter((migration) => DESTRUCTIVE_PATTERN.test(migration.content)).map((migration) => migration.filename);
  if (destructive.length > 0) {
    throw new Error(`Refusing to auto-apply destructive pending migration(s) to persistent staging: ${destructive.join(', ')}. Apply them deliberately with the Staging Database Migrate workflow from main.`);
  }
  return { pending: pending.map((migration) => migration.filename) };
}

function main() {
  const databaseUrl = process.env.STAGING_SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('STAGING_SUPABASE_DB_URL is required; it is never printed.');
  const { migrations, evaluation } = evaluateLiveMigrationDrift({ environment: 'staging', databaseUrl, allowPending: true });
  const plan = planStagingMigrations({ evaluation, migrations });
  console.log(plan.pending.length ? `Pending forward migrations for staging: ${plan.pending.join(', ')}` : 'Pending forward migrations for staging: <none>');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `has_pending=${plan.pending.length > 0}\n`);
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
