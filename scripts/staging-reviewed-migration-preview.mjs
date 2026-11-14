#!/usr/bin/env node
/**
 * Driver for the Staging Reviewed Migration Preview workflow: a single-use, human-approved forward apply of EXACTLY the
 * migration files that a reviewed entry in supabase/staging-reviewed-migrations.json (on main) pins, from an open PR's
 * exact head SHA, to the persistent shared staging database before that PR merges.
 *
 * It runs only from the trusted main checkout (staging-trusted-control-plane.mjs); the PR contributes its
 * supabase/migrations directory as DATA. It never resets, wipes or repairs anything and never writes migration history
 * itself: the verified ephemeral workspace of staging-migration-apply-workspace.mjs and the pinned Supabase CLI do the
 * forward push, exactly as for Staging Candidate. The ONLY difference is the reviewed allowance handed to the planner,
 * which this driver builds after every identifier has been re-proven in the same process.
 *
 * Commands (each re-verifies the request from scratch; nothing is carried between jobs except GitHub's own approval):
 *   verify-request               no database: registry entry, restated digests, live PR, candidate checkout + files,
 *                                approval-environment protection
 *   plan                         + staging target, history base, read-only preconditions, verified dry run
 *   apply                        + recorded maintainer approval of this run, then the same checks again, then one push
 *   verify-applied               + CLEAN history equal to the candidate, approved names recorded, read-only postconditions
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadMigrations } from './check-migrations.mjs';
import { evaluateLiveMigrationDrift } from './check-db-drift.mjs';
import { buildVerifiedApplyWorkspace, optionsFromEnvironment, runApply, verifyApplied } from './staging-migration-apply-workspace.mjs';
import {
  APPROVAL_ENVIRONMENT,
  REVIEWED_REGISTRY_PATH,
  assertAppliedEntry,
  assertApprovalEnvironmentProtection,
  assertLivePullRequest,
  assertRunApproved,
  assertStagingBase,
  loadReviewedRegistry,
  reviewedAllowance,
  runProbes,
  selectPreviewEntry,
  verifyCandidateFiles,
} from './staging-reviewed-migrations.mjs';
import { assertStagingTarget } from './staging-target-guard.mjs';
import { CANDIDATE_MIGRATIONS_ENV, assertTrustedControlPlaneFromEnvironment, trustedControlPlaneRequired } from './staging-trusted-control-plane.mjs';

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Reviewed staging migration preview: ${label} is missing or not valid JSON.`);
  }
}

function defaultProbeRunner(databaseUrl, probe) {
  return execFileSync('psql', [
    '--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', databaseUrl, '--tuples-only', '--no-align',
    '--command', 'SET default_transaction_read_only = on', '--command', probe,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\n').filter(Boolean).pop() ?? '';
}

/** Every input comes from the runner environment the trusted workflow sets; dispatch inputs arrive via env, never via ${{ }} in shell. */
export function requestFromEnvironment(env = process.env) {
  return {
    id: env.PREVIEW_ID ?? '',
    repository: env.GITHUB_REPOSITORY ?? '',
    prNumber: env.PREVIEW_PR_NUMBER ?? '',
    headSha: env.PREVIEW_HEAD_SHA ?? '',
    fileDigests: env.PREVIEW_FILE_DIGESTS ?? '',
    candidateCheckoutSha: env.PREVIEW_CANDIDATE_CHECKOUT_SHA ?? '',
    livePullRequest: env.PREVIEW_LIVE_PR_JSON ?? '',
    approvalEnvironment: env.PREVIEW_APPROVAL_ENVIRONMENT_JSON ?? '',
    runApprovals: env.PREVIEW_RUN_APPROVALS_JSON ?? '',
  };
}

/** No database access: everything that can be proven from main, the dispatch, the GitHub API and the candidate files. */
export function verifyRequest({ request, registryPath = REVIEWED_REGISTRY_PATH, migrationsDirectory, now = Date.now(), log = () => {} }) {
  const registry = loadReviewedRegistry(registryPath);
  const entry = selectPreviewEntry(registry, request, now);
  assertLivePullRequest(entry, parseJson(request.livePullRequest, 'the live pull request record'));
  if (request.candidateCheckoutSha !== entry.head_sha) throw new Error('Reviewed staging migration preview: the candidate checkout is not the reviewed head SHA.');
  verifyCandidateFiles(entry, loadMigrations(resolve(migrationsDirectory)));
  assertApprovalEnvironmentProtection(parseJson(request.approvalEnvironment, `the ${APPROVAL_ENVIRONMENT} environment record`));
  log(`Reviewed request ${entry.id}: PR #${entry.pr_number} @ ${entry.head_sha.slice(0, 12)}, ${entry.files.length} approved file(s):`);
  for (const file of entry.files) log(`  ${file.filename} sha256=${file.sha256}`);
  return { registry, entry };
}

function databaseChecks(options, entry, deps, log) {
  const assertTarget = deps.assertTarget ?? (() => {
    if (!options.target.productionDatabaseHost || !options.target.productionSupabaseHost) {
      throw new Error('Refusing database action: production host allowlists (PRODUCTION_DATABASE_HOST, PRODUCTION_SUPABASE_HOST) are required.');
    }
    assertStagingTarget(options.target);
  });
  const evaluateLive = deps.evaluateLive ?? ((allowPending) => evaluateLiveMigrationDrift({
    environment: 'staging', databaseUrl: options.databaseUrl, allowPending, migrationsDirectory: options.migrationsDirectory,
  }));
  assertTarget();
  assertStagingBase(entry, evaluateLive(true).remoteRows);
  log('Preconditions (read-only):');
  runProbes(options.databaseUrl, entry.preconditions, deps.probeRunner ?? defaultProbeRunner, log);
  return { assertTarget, evaluateLive };
}

function workspaceOptions(options, entry) {
  return { ...options, reviewedMigrations: reviewedAllowance(entry) };
}

/** Read-only: verified ephemeral workspace + pinned CLI dry run must propose exactly the approved files. */
export function planPreview({ request, options, deps = {}, now, log = console.log }) {
  const { entry } = verifyRequest({ request, migrationsDirectory: options.migrationsDirectory, registryPath: options.reviewedRegistryPath, now, log });
  const { assertTarget, evaluateLive } = databaseChecks(options, entry, deps, log);
  const built = buildVerifiedApplyWorkspace(workspaceOptions(options, entry), { ...deps, assertTarget, evaluateLive, log });
  try {
    const pending = built.pendingFiles.map((file) => file.filename);
    log(`Dry run proposes exactly the ${pending.length} approved file(s); nothing was applied.`);
    return { entry, pending };
  } finally {
    built.cleanup();
  }
}

/** The one mutation: only after this run's recorded maintainer approval, with every input re-proven immediately before. */
export function applyPreview({ request, options, deps = {}, now, log = console.log }) {
  const { entry } = verifyRequest({ request, migrationsDirectory: options.migrationsDirectory, registryPath: options.reviewedRegistryPath, now, log });
  const approvers = assertRunApproved(parseJson(request.runApprovals, 'the run approval record'), parseJson(request.approvalEnvironment, `the ${APPROVAL_ENVIRONMENT} environment record`));
  log(`Environment ${APPROVAL_ENVIRONMENT} approved by: ${approvers.join(', ')}`);
  const { assertTarget, evaluateLive } = databaseChecks(options, entry, deps, log);
  let result;
  try {
    result = runApply(workspaceOptions(options, entry), { ...deps, assertTarget, evaluateLive, log });
  } catch (error) {
    // Report exactly what staging now records before failing: a file is atomic, but earlier files stay applied.
    let recorded = '<unavailable>';
    try {
      const rows = evaluateLive(true).remoteRows;
      recorded = entry.files.filter((file) => rows.some((row) => file.filename.startsWith(`${row.version}_`))).map((file) => file.filename).join(', ') || '<none>';
    } catch { /* evidence is best effort; the original error is what fails the run */ }
    throw new Error(`${error.message}\nApproved files recorded on staging after the failure: ${recorded}. Follow docs/operations/staging-reviewed-migration-preview.md (recovery); never reset or repair.`);
  }
  const expected = entry.files.map((file) => file.filename);
  if (JSON.stringify(result.applied) !== JSON.stringify(expected)) {
    throw new Error(`Reviewed staging migration preview: applied ${JSON.stringify(result.applied)}, expected exactly ${JSON.stringify(expected)}.`);
  }
  return { entry, applied: result.applied };
}

/** Post-apply proof: CLEAN against the candidate, bindings hold, names recorded, every postcondition true. */
export function verifyAppliedState({ request, options, deps = {}, now, log = console.log }) {
  const { entry } = verifyRequest({ request, migrationsDirectory: options.migrationsDirectory, registryPath: options.reviewedRegistryPath, now, log });
  verifyApplied(options, { ...deps, log });
  const evaluateLive = deps.evaluateLive ?? ((allowPending) => evaluateLiveMigrationDrift({
    environment: 'staging', databaseUrl: options.databaseUrl, allowPending, migrationsDirectory: options.migrationsDirectory,
  }));
  assertAppliedEntry(entry, evaluateLive(false).remoteRows);
  log('Postconditions (read-only):');
  runProbes(options.databaseUrl, entry.postconditions, deps.probeRunner ?? defaultProbeRunner, log);
  return { entry, status: 'CLEAN' };
}

function main() {
  const command = process.argv[2];
  const commands = { 'verify-request': null, plan: planPreview, apply: applyPreview, 'verify-applied': verifyAppliedState };
  if (!(command in commands)) throw new Error('Usage: staging-reviewed-migration-preview.mjs verify-request|plan|apply|verify-applied');
  const request = requestFromEnvironment();
  try {
    // Fail closed before reading anything: in Actions this driver must be the trusted main copy with candidate data only.
    if (trustedControlPlaneRequired()) assertTrustedControlPlaneFromEnvironment(process.env, undefined, { requireCandidate: true });
    if (!process.env[CANDIDATE_MIGRATIONS_ENV]) throw new Error(`${CANDIDATE_MIGRATIONS_ENV} must point at the candidate's supabase/migrations directory.`);
    if (command === 'verify-request') {
      verifyRequest({ request, migrationsDirectory: process.env[CANDIDATE_MIGRATIONS_ENV], log: console.log });
      return;
    }
    const result = commands[command]({ request, options: optionsFromEnvironment() });
    if (process.env.GITHUB_OUTPUT && result.applied) appendFileSync(process.env.GITHUB_OUTPUT, `applied=${result.applied.join(',')}\n`);
  } catch (error) {
    const message = String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://<redacted>');
    console.error(`::error::${message.split('\n')[0]}`);
    console.error(message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
