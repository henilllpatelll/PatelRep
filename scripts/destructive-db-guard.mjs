#!/usr/bin/env node
/**
 * Fail-closed guard for any command that could destroy database contents.
 *
 * Shared staging and production are persistent: nothing in this repository may wipe, reset or replay-from-scratch
 * against them. The only database a destructive command may target is a loopback (local/ephemeral CI) database that
 * is not also configured as a shared environment. Everything else is refused, including when the wrong URL is
 * supplied by mistake, by a tunnel, or through a libpq override parameter.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Hosted/shared database providers; a destructive target is never allowed here even if the allowlist env is unset. */
const SHARED_PROVIDER_HOST = /(^|\.)(supabase\.(co|com|net)|railway\.app|rlwy\.net|neon\.tech|amazonaws\.com)$/i;

/** libpq honours these query parameters over the URL authority, so a loopback-looking URL could still hit another host. */
const LIBPQ_HOST_OVERRIDES = ['host', 'hostaddr', 'service', 'servicefile', 'passfile'];

const SHARED_HOST_VARIABLES = [
  'STAGING_EXPECTED_DATABASE_HOST',
  'STAGING_EXPECTED_SUPABASE_HOST',
  'PRODUCTION_DATABASE_HOST',
  'PRODUCTION_SUPABASE_HOST',
];
const SHARED_URL_VARIABLES = [
  'STAGING_SUPABASE_DB_URL',
  'PRODUCTION_SUPABASE_DB_URL',
  'STAGING_SUPABASE_URL',
  'PRODUCTION_SUPABASE_URL',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'SUPABASE_URL',
];

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Every host this process has been told belongs to a shared (staging/production/application) environment. */
export function configuredSharedHosts(env = process.env) {
  const hosts = new Set();
  for (const name of SHARED_HOST_VARIABLES) {
    const value = env[name]?.trim().toLowerCase();
    if (value) hosts.add(value);
  }
  for (const name of SHARED_URL_VARIABLES) {
    const host = env[name] ? hostOf(env[name]) : '';
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * Throws unless `databaseUrl` is a loopback database that is not configured as a shared environment.
 * `disposable` must be explicitly acknowledged by the caller (a CLI flag), never inferred.
 */
export function assertDisposableDatabaseTarget({ databaseUrl, env = process.env, disposable = false }) {
  if (disposable !== true) {
    throw new Error('Refusing destructive database action: the target must be explicitly declared disposable (--disposable).');
  }
  if (!databaseUrl) throw new Error('Refusing destructive database action: a database URL is required.');
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('Refusing destructive database action: the database URL is not a valid URL.');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('Refusing destructive database action: the database URL must be a postgres URL.');
  }
  const host = url.hostname.toLowerCase();
  if (!host) throw new Error('Refusing destructive database action: the database URL has no host.');
  for (const parameter of LIBPQ_HOST_OVERRIDES) {
    if (url.searchParams.has(parameter)) {
      throw new Error(`Refusing destructive database action: the database URL sets the "${parameter}" override.`);
    }
  }
  if (SHARED_PROVIDER_HOST.test(host)) {
    throw new Error('Refusing destructive database action: the target is a hosted shared database, not a disposable one.');
  }
  if (configuredSharedHosts(env).has(host)) {
    throw new Error('Refusing destructive database action: the target matches a configured staging/production/application host.');
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error('Refusing destructive database action: only a loopback (local or CI-ephemeral) database may be destroyed.');
  }
}

/**
 * Pure decision over what is already inside a database that would be touched. A tool that replays migrations from
 * zero may only run against a database that holds nothing, so it can never overwrite real data even when the
 * target check above is somehow satisfied.
 */
export function evaluateBlankness({ publicTableCount, migrationRowCount, authUserCount }) {
  const problems = [];
  if (publicTableCount > 0) problems.push(`${publicTableCount} table(s) in schema public`);
  if (migrationRowCount > 0) problems.push(`${migrationRowCount} recorded migration(s)`);
  if (authUserCount > 0) problems.push(`${authUserCount} auth user(s)`);
  return { blank: problems.length === 0, problems };
}

/** Commands that wipe or rewrite database state. Used by static contract tests and the apply tooling. */
export const DESTRUCTIVE_COMMAND_PATTERN = /\bsupabase\b[^\n]*\bdb\s+reset\b|\bmigration\s+repair\b|\bDROP\s+SCHEMA\b|\bTRUNCATE\b|\bDROP\s+DATABASE\b|\bdb\s+reset\b[^\n]*--(?:db-url|linked)\b/i;
