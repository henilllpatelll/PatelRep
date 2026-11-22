// Developer Harness V2 — minimal, deliberate environment for MANUAL runtime checks of real Claude Code (Phase 2
// remediation B). Pure: builds an object, never reads or prints values on its own.
//
// The parent shell of a developer session carries provider credentials (GitHub PATs, Supabase keys, IPC tokens,
// test passwords, …). The runtime check must never copy them into a sandboxed Claude process. Instead of
// filtering a denylist out of process.env, only an explicit ALLOWLIST of non-secret OS variables is copied; every
// tool-configuration path that could pick up ambient credentials (git, gh) is redirected to empty sandbox files.
//
// Remaining access (documented in 07-phase-2-policy-implementation.md): USERPROFILE/HOME are kept because the
// Claude Code CLI authenticates with the developer's OAuth login stored under the user profile. The sandboxed
// process can therefore still reach files under the user profile at the OS level; the policy hook denies the known
// credential paths, but OS-level file access is not an isolation boundary.

/** Non-secret OS variables required to run the Claude Code CLI, git and node on Windows / POSIX. */
export const PASS_THROUGH = Object.freeze(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'windir', 'WINDIR', 'ComSpec',
  'COMSPEC', 'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA',
  'LANG', 'LC_ALL', 'TERM', 'USERNAME', 'USER'])

/** Variable names that indicate a credential or a provider/parent-session channel. Never allowed in the sandbox env. */
export const SENSITIVE_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|PRIVATE|API_?KEY|ACCESS_?KEY|ANON_?KEY|SERVICE_?ROLE|CREDENTIAL|COOKIE|DATABASE|DB_URL|DSN|JWT|SIGNING|WEBHOOK|AUTH|(^|_)KEY$|ASKPASS|^SUPABASE|^STAGING_|^PRODUCTION_|^RAILWAY|^VERCEL|^GITHUB_|^GH_(?!CONFIG_DIR$)|^STRIPE|^OPENAI|^ANTHROPIC|^AWS_|^AZURE_|^GOOGLE_|^TWILIO|^NPM_|^PG|^SSH_|^VSCODE_|^CLAUDECODE$|^CLAUDE_CODE_|^CLAUDE_FLOW|^MCP_)/i

/**
 * @param {Record<string, string|undefined>} parentEnv  usually process.env
 * @param {{ projectDir: string, tempDir: string, gitConfig: string, ghConfigDir: string }} sandbox
 * @returns {Record<string, string>}
 */
export function buildRuntimeEnv(parentEnv, { projectDir, tempDir, gitConfig, ghConfigDir }) {
  const env = {}
  for (const name of PASS_THROUGH) if (typeof parentEnv[name] === 'string') env[name] = parentEnv[name]
  Object.assign(env, {
    TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir,
    CLAUDE_PROJECT_DIR: projectDir,
    // git: no system/global config, so no credential helper, no includeIf, no hooksPath from the developer machine.
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
    // gh: empty config directory, so the CLI is unauthenticated even if a command slips through.
    GH_CONFIG_DIR: ghConfigDir,
    // No claude.ai connector MCP servers; no self-update during a check.
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false', DISABLE_AUTOUPDATER: '1', NO_COLOR: '1',
  })
  const leaked = Object.keys(env).filter((name) => SENSITIVE_NAME.test(name))
  if (leaked.length) throw new Error(`runtime sandbox env would contain credential-like variables: ${leaked.join(', ')}`)
  return env
}

/** Names (never values) of `env` entries that look like credentials; used by the in-sandbox probe and tests. */
export const sensitiveNames = (env) => Object.keys(env).filter((name) => SENSITIVE_NAME.test(name)).sort()
