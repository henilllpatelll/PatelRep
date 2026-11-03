#!/usr/bin/env node
/**
 * Trust boundary for every PRIVILEGED staging database action (the ones that hold STAGING_SUPABASE_DB_URL).
 *
 * Staging Candidate verifies a PR candidate, so its checkout is attacker-influenced code. The migration driver and its
 * transitive safety dependencies (target guard, planner, drift evaluator, destructive-SQL pattern, duplicate-history
 * coverage registry, Supabase config) must therefore NEVER be executed from that checkout. The workflow checks out the
 * exact trusted workflow commit (github.sha, on refs/heads/main) into a separate directory, runs every privileged
 * script from there, and hands the candidate over as DATA ONLY: its supabase/migrations directory.
 *
 * This module fails closed when that is not provably the case:
 *   - the workflow definition must come from refs/heads/main and GITHUB_SHA must be a full commit SHA,
 *   - the running driver must live in scripts/ of the working directory, which must be its own git work tree whose HEAD
 *     is exactly GITHUB_SHA with no modified tracked file and no untracked file under scripts/ or supabase/,
 *   - the candidate migrations directory must be a real directory (no symlink) outside the trusted tree whose entries
 *     are all regular .sql files,
 *   - registry/config inputs must resolve inside the trusted tree.
 * The candidate's own copies of the privileged scripts are never loaded, so a PR that edits them cannot bypass any
 * safeguard; the candidate's exact migration files are still selected and verified by the trusted planner.
 *
 * Usage (from the trusted checkout): node scripts/staging-trusted-control-plane.mjs assert
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TRUSTED_REF = 'refs/heads/main';
export const TRUSTED_CHECKOUT_DIRECTORY = '.trusted-control-plane';
export const CANDIDATE_MIGRATIONS_ENV = 'STAGING_CANDIDATE_MIGRATIONS_DIR';
const COMMIT_SHA = /^[0-9a-f]{40}$/;

/** Files whose content decides what privileged staging actions do. Pinned by the contract test against the import graph. */
export const PRIVILEGED_STAGING_FILES = [
  'scripts/staging-migration-apply-workspace.mjs',
  'scripts/staging-trusted-control-plane.mjs',
  'scripts/staging-target-guard.mjs',
  'scripts/production-target-guard.mjs',
  'scripts/staging-migration-plan.mjs',
  'scripts/production-migration-apply-workspace.mjs',
  'scripts/check-db-drift.mjs',
  'scripts/check-migrations.mjs',
  'scripts/migration-statement-fingerprint.mjs',
  'supabase/staging-duplicate-coverage.json',
  'supabase/migration-manifest.json',
  'supabase/config.toml',
  // Run with the staging database credential or the staging service-role key; never from the candidate checkout.
  'scripts/schema-contracts.sql',
  'scripts/check-feature-flag-registry.mjs',
  'apps/web/scripts/apply-feature-flag.mjs',
  'apps/web/e2e/fixtures/seed-staging-tenant.mjs',
  'apps/web/e2e/fixtures/staging-fixture-users.mjs',
  'apps/web/package.json',
  'apps/web/package-lock.json',
];

/** Trusted-tree directories where an untracked file could shadow or extend privileged code. */
export const GUARDED_DIRECTORIES = ['scripts', 'supabase', 'apps/web/scripts', 'apps/web/e2e'];

function fail(message) {
  throw new Error(`Refusing privileged staging action: ${message}`);
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function defaultGit(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Inside GitHub Actions the boundary is always enforced; only local runs and unit tests are exempt. */
export function trustedControlPlaneRequired(env = process.env) {
  return env.GITHUB_ACTIONS === 'true';
}

export function assertCandidateMigrationsDirectory(directory, trustedRoot) {
  let stats;
  try {
    stats = lstatSync(directory);
  } catch {
    fail(`the candidate migrations directory ${JSON.stringify(directory)} does not exist.`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) fail('the candidate migrations path must be a real directory, not a symlink.');
  const real = realpathSync.native(directory);
  if (isInside(trustedRoot, real)) fail('the candidate migrations directory must be outside the trusted control-plane checkout.');
  for (const entry of readdirSync(real, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) fail(`the candidate migrations directory contains a non-regular or non-.sql entry: ${entry.name}.`);
  }
  return real;
}

export function assertTrustedControlPlane({
  env = process.env,
  scriptDirectory,
  trustedRoot = process.cwd(),
  candidateMigrationsDirectory,
  requireCandidate = false,
  protectedPaths = [],
  git = defaultGit,
}) {
  if (env.GITHUB_REF !== TRUSTED_REF) fail(`the workflow definition must come from ${TRUSTED_REF}, not ${JSON.stringify(env.GITHUB_REF ?? '')}.`);
  const expectedSha = env.GITHUB_SHA ?? '';
  if (!COMMIT_SHA.test(expectedSha)) fail('GITHUB_SHA is not a full commit SHA.');

  const root = realpathSync.native(trustedRoot);
  if (!scriptDirectory) fail('the running script directory is unknown.');
  if (realpathSync.native(scriptDirectory) !== realpathSync.native(join(root, 'scripts'))) {
    fail('the privileged driver must run from scripts/ of the trusted control-plane checkout, which must be the working directory.');
  }
  if (realpathSync.native(git(root, ['rev-parse', '--show-toplevel'])) !== root) fail('the working directory is not the root of its own trusted git work tree.');
  const head = git(root, ['rev-parse', 'HEAD']);
  if (head !== expectedSha) fail(`the trusted checkout is at ${head.slice(0, 12)}, not the workflow commit ${expectedSha.slice(0, 12)}.`);
  if (git(root, ['status', '--porcelain', '--untracked-files=no']) !== '') fail('the trusted checkout has modified tracked files.');
  if (git(root, ['status', '--porcelain', '--untracked-files=all', '--', ...GUARDED_DIRECTORIES]) !== '') {
    fail(`the trusted checkout has untracked files under ${GUARDED_DIRECTORIES.join(', ')}.`);
  }

  for (const path of protectedPaths) {
    if (!isInside(root, realpathSync.native(resolve(root, path)))) fail(`${path} must resolve inside the trusted checkout.`);
  }

  if (!candidateMigrationsDirectory) {
    if (requireCandidate) fail(`${CANDIDATE_MIGRATIONS_ENV} must point at the candidate's supabase/migrations directory.`);
    return { root, head, candidate: null };
  }
  return { root, head, candidate: assertCandidateMigrationsDirectory(resolve(candidateMigrationsDirectory), root) };
}

/** The assertion every privileged entry point performs, driven only by runner-provided environment. */
export function assertTrustedControlPlaneFromEnvironment(env = process.env, scriptDirectory = dirname(fileURLToPath(import.meta.url)), extra = {}) {
  return assertTrustedControlPlane({
    env,
    scriptDirectory,
    candidateMigrationsDirectory: env[CANDIDATE_MIGRATIONS_ENV] || undefined,
    requireCandidate: env.GITHUB_WORKFLOW === 'Staging Candidate',
    protectedPaths: ['supabase/staging-duplicate-coverage.json', 'supabase/config.toml', 'supabase/migration-manifest.json'],
    ...extra,
  });
}

function main() {
  if (process.argv[2] !== 'assert') throw new Error('Usage: staging-trusted-control-plane.mjs assert');
  try {
    const result = assertTrustedControlPlaneFromEnvironment();
    console.log(`Trusted control plane verified at ${result.head.slice(0, 12)}${result.candidate ? '; candidate migrations treated as data only' : ''}.`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
