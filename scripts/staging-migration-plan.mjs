#!/usr/bin/env node
/**
 * Read-only plan for migrating the PERSISTENT shared staging database forward.
 *
 * Staging is never rebuilt or wiped. A candidate may only add migrations that staging has not applied yet, and only
 * when staging history is a strict prefix of the candidate's repository history. This script reads migration history
 * with the fixed SELECT queries in check-db-drift.mjs and decides; it never writes. It fails closed when
 *   - staging has migrations this candidate does not know (another branch's migrations are already applied), or
 *   - any pending migration contains destructive SQL (those need the human-run `Staging Database Migrate` from main, or
 *     a single-use, human-approved Staging Reviewed Migration Preview of exactly-pinned files; see
 *     staging-reviewed-migrations.mjs). The CLI below never enables that exception.
 *   - any pending migration is SECURITY-SENSITIVE (introduces or changes database authority: SECURITY DEFINER, auth
 *     schema relations, dynamic SQL, role authority, ...; see migration-security-classifier.mjs). A distinct reason
 *     from destructive SQL; the only exception is the same single-use, human-approved Staging Reviewed Migration
 *     Preview of exactly-pinned files. Only PENDING migrations are classified; history already on staging is not.
 */
import { appendFileSync } from 'node:fs';

import { evaluateLiveMigrationDrift, normalizeVersion } from './check-db-drift.mjs';
import { DESTRUCTIVE_PATTERN, sha256 } from './check-migrations.mjs';
import { securitySensitiveReasons } from './migration-security-classifier.mjs';

/**
 * `reviewed` is passed ONLY by the Staging Reviewed Migration Preview driver, after it verified a registry entry on main,
 * the restated digests, the live PR and the candidate files. It is never read from the environment or the candidate.
 * With it, the pending set must equal the approved set exactly and every pending file must hash to its approved digest;
 * only then may those (and only those) files contain destructive or security-sensitive SQL. Without it, both are
 * refused.
 */
/**
 * The pending-file policy, shared by the planner and by runApply's last check on the exact bytes it is about to push.
 * `files` = [{ filename, content }]. With `reviewed` (preview driver only): the set must equal the approved set and each
 * file must hash to its approved digest. Without it: no destructive and no security-sensitive file. Throws on refusal.
 */
export function assertPendingPolicy(files, reviewed = null) {
  if (reviewed !== null) {
    if (!(reviewed?.files instanceof Map) || reviewed.files.size === 0) throw new Error('Refusing reviewed staging preview: the reviewed allowance is malformed.');
    const names = files.map((migration) => migration.filename);
    if (names.length !== reviewed.files.size || names.some((name) => !reviewed.files.has(name))) {
      throw new Error(`Refusing reviewed staging preview ${reviewed.id}: pending migrations ${JSON.stringify(names)} are not exactly the approved set ${JSON.stringify([...reviewed.files.keys()])}.`);
    }
    const changed = files.filter((migration) => sha256(migration.content) !== reviewed.files.get(migration.filename)).map((migration) => migration.filename);
    if (changed.length) throw new Error(`Refusing reviewed staging preview ${reviewed.id}: ${changed.join(', ')} differ(s) from the approved digest.`);
    return;
  }
  const destructive = files.filter((migration) => DESTRUCTIVE_PATTERN.test(migration.content)).map((migration) => migration.filename);
  if (destructive.length > 0) {
    throw new Error(`Refusing to auto-apply destructive pending migration(s) to persistent staging: ${destructive.join(', ')}. Apply them deliberately with the Staging Database Migrate workflow from main.`);
  }
  const sensitive = files
    .map((migration) => ({ filename: migration.filename, reasons: securitySensitiveReasons(migration.content) }))
    .filter((entry) => entry.reasons.length > 0);
  if (sensitive.length > 0) {
    const listed = sensitive.map((entry) => `${entry.filename} (${entry.reasons.join(', ')})`).join('; ');
    throw new Error(`Refusing to auto-apply security-sensitive pending migration(s) to persistent staging: ${listed}. They change database authority and need a reviewed registry entry on main and the human-approved Staging Reviewed Migration Preview.`);
  }
}

export function planStagingMigrations({ evaluation, migrations, reviewed = null }) {
  if (evaluation.status === 'BLOCKED') {
    const unknown = evaluation.unknownOnRemote.length ? ` Unknown on staging: ${evaluation.unknownOnRemote.join(', ')}.` : '';
    const incomplete = evaluation.duplicateCoverage?.incompleteGroups?.length ? ' Duplicate-identifier coverage is incomplete.' : '';
    throw new Error(`Refusing to migrate staging: its history is not a prefix of this candidate.${unknown}${incomplete} Staging is never reset; resolve through main or the Staging Database Migrate workflow.`);
  }
  const pendingVersions = new Set(evaluation.missingOnRemote.map(normalizeVersion));
  const pending = migrations.filter((migration) => migration.version && pendingVersions.has(normalizeVersion(migration.version)));
  assertPendingPolicy(pending, reviewed);
  return reviewed !== null ? { pending: pending.map((migration) => migration.filename), reviewed: reviewed.id }
    : { pending: pending.map((migration) => migration.filename) };
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
