#!/usr/bin/env node
/**
 * Staging-only guard for the Android development build (docs/TEAM_SCHEDULING_STAGING_BUILD.md).
 *
 *   node scripts/staging-env.js check    validate the staging configuration, print nothing secret
 *   node scripts/staging-env.js start    validate, then run `expo start --dev-client` against staging
 *
 * Why this exists: a development-client APK contains no JavaScript. Metro on the developer's machine inlines
 * EXPO_PUBLIC_* when it bundles, so the env block in eas.json does not decide which backend the app talks to, and a
 * local .env that points at production would win. This script pins the API and Supabase URLs itself and exports them
 * to Metro (a variable already in the process environment is not overwritten by .env files), then refuses to run
 * unless the anon key belongs to the staging Supabase project. The only input is STAGING_SUPABASE_ANON_KEY.
 *
 * The staging values are public: docs/ENVIRONMENTS.md and the repository's `staging` environment variables.
 */
const { spawnSync } = require("child_process");

const STAGING_API_URL = "https://patelrep-api-staging-staging.up.railway.app/v1";
const STAGING_SUPABASE_REF = "vhxymynoutzamtfourop";
const STAGING_SUPABASE_URL = `https://${STAGING_SUPABASE_REF}.supabase.co`;

// Deny-list: nothing handed to a staging build may mention these.
const PRODUCTION_HOSTS = ["oacnwalhcpqdabivweki.supabase.co", "noble-cooperation-production.up.railway.app"];
const PRODUCTION_SUPABASE_REF = "oacnwalhcpqdabivweki";

const ANON_KEY_PLACEHOLDER = "SET_STAGING_ANON_KEY_BEFORE_BUILD";

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** The environment a staging dev session must run with. URLs are fixed here, never read from the caller. */
function buildStagingEnv(source) {
  return {
    APP_ENV: "staging",
    EXPO_PUBLIC_API_URL: STAGING_API_URL,
    EXPO_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: (source && source.STAGING_SUPABASE_ANON_KEY) || "",
  };
}

/** Returns a list of problems (empty means the environment is safe for staging). Never echoes the key. */
function validateStagingEnv(env) {
  const problems = [];
  if (env.EXPO_PUBLIC_API_URL !== STAGING_API_URL) problems.push(`EXPO_PUBLIC_API_URL must be ${STAGING_API_URL}`);
  if (env.EXPO_PUBLIC_SUPABASE_URL !== STAGING_SUPABASE_URL) {
    problems.push(`EXPO_PUBLIC_SUPABASE_URL must be ${STAGING_SUPABASE_URL}`);
  }
  for (const [name, value] of Object.entries(env)) {
    if (PRODUCTION_HOSTS.some((host) => String(value).includes(host))) problems.push(`${name} references a production host`);
  }

  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!key || key === ANON_KEY_PLACEHOLDER) {
    problems.push("the staging anon key is not set (provide STAGING_SUPABASE_ANON_KEY)");
  } else {
    const claims = decodeJwtPayload(key);
    if (!claims) problems.push("the anon key is not a JWT");
    else {
      if (claims.ref === PRODUCTION_SUPABASE_REF) problems.push("the anon key belongs to the PRODUCTION Supabase project");
      else if (claims.ref !== STAGING_SUPABASE_REF) problems.push("the anon key does not belong to the staging Supabase project");
      if (claims.role !== "anon") problems.push(`the key's role is "${claims.role}", only "anon" may ship in an app`);
    }
  }
  return problems;
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command !== "check" && command !== "start") {
    console.error("usage: node scripts/staging-env.js <check|start> [expo start args]");
    return 2;
  }
  const stagingEnv = buildStagingEnv(process.env);
  const problems = validateStagingEnv(stagingEnv);
  if (problems.length > 0) {
    console.error("Refusing to continue; this is not a safe staging configuration:");
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(`Staging configuration OK: API ${STAGING_API_URL}, Supabase ${STAGING_SUPABASE_URL}`);
  if (command === "check") return 0;

  const result = spawnSync("npx", ["expo", "start", "--dev-client", ...rest], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...stagingEnv },
  });
  return result.status === null ? 1 : result.status;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  ANON_KEY_PLACEHOLDER,
  STAGING_API_URL,
  STAGING_SUPABASE_REF,
  STAGING_SUPABASE_URL,
  buildStagingEnv,
  validateStagingEnv,
};
