// Developer Harness V2 — credential-isolation regression tests for the runtime-check sandbox environment
// (Phase 2 remediation B). Pure: never prints a variable value, never spawns Claude, no network.
// Run: node --test scripts/developer-harness-v2/runtime-sandbox-env.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildRuntimeEnv, sensitiveNames, PASS_THROUGH, SENSITIVE_NAME } from './runtime-sandbox-env.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SANDBOX = { projectDir: 'C:/t/sbx', tempDir: 'C:/t/sbx-aux/tmp', gitConfig: 'C:/t/sbx-aux/gitconfig', ghConfigDir: 'C:/t/sbx-aux/gh' }
const OVERRIDES = ['TEMP', 'TMP', 'TMPDIR', 'CLAUDE_PROJECT_DIR', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE',
  'GH_CONFIG_DIR', 'ENABLE_CLAUDEAI_MCP_SERVERS', 'DISABLE_AUTOUPDATER', 'NO_COLOR']

// Provider and parent-session credentials a developer shell can hold (names observed on this machine plus the
// PatelRep provider set). Values are unique markers, so a copied value is detectable without printing it.
const CREDENTIAL_NAMES = ['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'GH_ENTERPRISE_TOKEN', 'STAGING_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'SUPABASE_JWT_SECRET', 'SUPABASE_ACCESS_TOKEN', 'PRODUCTION_SUPABASE_HOST', 'DATABASE_URL',
  'PGPASSWORD', 'RAILWAY_TOKEN', 'RAILWAY_API_TOKEN', 'VERCEL_TOKEN', 'VERCEL_OIDC_TOKEN', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CRON_SECRET', 'TEST_PASSWORD', 'TWILIO_AUTH_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN',
  'APP_PRIVATE_KEY', 'GITHUB_APP_PRIVATE_KEY', 'VSCODE_GIT_IPC_AUTH_TOKEN', 'GIT_ASKPASS', 'SSH_AUTH_SOCK', 'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDECODE', 'GITHUB_ACTIONS', 'MCP_SERVER_SECRET']

function fakeParent() {
  const env = { PATH: 'C:/bin', SystemRoot: 'C:/Windows', USERPROFILE: 'C:/Users/dev', HOME: 'C:/Users/dev', APPDATA: 'C:/Users/dev/AppData/Roaming' }
  CREDENTIAL_NAMES.forEach((name, i) => { env[name] = `marker-value-${i}-do-not-copy` })
  return env
}

test('no provider or parent-session credential name is copied into the sandbox env', () => {
  const env = buildRuntimeEnv(fakeParent(), SANDBOX)
  const copied = CREDENTIAL_NAMES.filter((n) => n in env)
  assert.deepEqual(copied, [], 'credential names copied into the sandbox env')
})

test('no credential VALUE is present under any name (renamed/aliased leaks)', () => {
  const env = buildRuntimeEnv(fakeParent(), SANDBOX)
  const leakedValues = Object.entries(env).filter(([, v]) => /marker-value-\d+-do-not-copy/.test(v)).map(([k]) => k)
  assert.deepEqual(leakedValues, [], 'variables carrying a credential value')
})

test('the sandbox env is exactly the allowlist plus fixed overrides (no denylist filtering of process.env)', () => {
  const env = buildRuntimeEnv({ ...fakeParent(), RANDOM_UNLISTED_VAR: 'x', NODE_OPTIONS: '--require evil.js', PYTHONPATH: 'x' }, SANDBOX)
  for (const name of Object.keys(env)) assert.ok(PASS_THROUGH.includes(name) || OVERRIDES.includes(name), `unexpected variable ${name}`)
  assert.equal(env.GIT_CONFIG_GLOBAL, SANDBOX.gitConfig)
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1')
  assert.equal(env.GH_CONFIG_DIR, SANDBOX.ghConfigDir)
  assert.equal(env.CLAUDE_PROJECT_DIR, SANDBOX.projectDir)
  assert.equal(env.TEMP, SANDBOX.tempDir)
  assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false')
})

test('the credential-name pattern covers every listed credential and none of the pass-through or override names', () => {
  for (const name of CREDENTIAL_NAMES) assert.ok(SENSITIVE_NAME.test(name), `${name} is recognized as credential-like`)
  for (const name of [...PASS_THROUGH, ...OVERRIDES]) assert.ok(!SENSITIVE_NAME.test(name), `${name} is not credential-like`)
})

test('the REAL parent environment of this machine yields a credential-free sandbox env (names only, values never read)', () => {
  const env = buildRuntimeEnv(process.env, SANDBOX)
  const parentSensitive = sensitiveNames(process.env)
  assert.deepEqual(sensitiveNames(env), [], 'credential-like names in the sandbox env')
  assert.deepEqual(parentSensitive.filter((n) => n in env), [], 'parent credential names reaching the sandbox env')
  console.log(`parent credential-like variables excluded: ${parentSensitive.length}; sandbox variables: ${Object.keys(env).length}`)
})

test('the runtime check never spawns Claude with the parent process.env and pins isolation flags', () => {
  const src = readFileSync(path.join(HERE, 'runtime-failclosed-check.mjs'), 'utf8')
  assert.doesNotMatch(src, /\.\.\.\s*process\.env/, 'no spreading of process.env')
  assert.doesNotMatch(src, /env:\s*process\.env/, 'no passing of process.env')
  assert.match(src, /buildRuntimeEnv\(process\.env,/)
  assert.match(src, /env: s\.env/)
  for (const flag of ["'--setting-sources', 'project'", "'--strict-mcp-config'", "'--mcp-config'", "'--no-session-persistence'"]) assert.ok(src.includes(flag), `claude is invoked with ${flag}`)
  assert.match(src, /hookBlocked\(o, 'github_api\.merge'\)/, 'remediation A live case requires hook evidence')
})
