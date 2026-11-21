// Developer Harness V2 — path classification (Phase 2). Pure: callers inject filesystem facts.
//
// Answers three questions about a path, without ever opening it:
//   1. Is it a credential/secret store?        (reading it is `read_production_or_publisher_credentials`)
//   2. Is it protected by the contract?         (`protected_paths`, migrations, git internals)
//   3. Is it inside the task worktree?          (writes elsewhere need approval)
import path from 'node:path'

/** Normalize to forward slashes, lower-case drive letter, no trailing slash. Windows paths are case-insensitive. */
export function normalizeSlashes(p) {
  let s = String(p).replace(/\\/g, '/')
  if (/^\/[a-zA-Z]\//.test(s)) s = `${s[1]}:${s.slice(2)}` // Git Bash /c/Users → c:/Users
  if (/^[a-zA-Z]:/.test(s)) s = s[0].toLowerCase() + s.slice(1)
  // Windows path semantics: a trailing dot/space on a segment is ignored by the filesystem (`.env.` opens `.env`)
  // and `name:stream` addresses an alternate data stream of `name`. Normalize both so they cannot hide a path.
  const drive = /^[a-z]:/.exec(s)?.[0] ?? ''
  s = drive + s.slice(drive.length).split('/').map((seg) => (seg === '.' || seg === '..' ? seg : seg.replace(/:.*$/, '').replace(/[. ]+$/, ''))).join('/')
  return s.length > 1 ? s.replace(/\/+$/, '') : s
}

/** A Windows 8.3 short-name segment (e.g. `CLAUDE~1`) that could alias a protected or credential path. */
export const hasShortNameSegment = (p) => /(^|[\\/])[^\\/]{1,8}~\d+(\.[^\\/]{0,3})?($|[\\/])/.test(String(p))

/** Decode %XX sequences when they decode cleanly; used so `%2Eenv` cannot hide `.env`. */
export function percentDecode(s) {
  if (!/%[0-9a-fA-F]{2}/.test(s)) return s
  try { return decodeURIComponent(s) } catch { return s }
}

const TEMPLATE_SUFFIX = /\.(example|sample|template|dist|defaults)$/i

/** Credential-bearing file names and directories. Matching is on the normalized path, case-insensitive. */
export function isSensitivePath(p) {
  const s = percentDecode(normalizeSlashes(p)).toLowerCase()
  const base = s.slice(s.lastIndexOf('/') + 1)
  if (!base) return false
  if (/^\.env(\..+)?$/.test(base) || /^[^/]+\.env$/.test(base) || base === '.envrc') return !TEMPLATE_SUFFIX.test(base)
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(_[a-z0-9]+)?$/.test(base)) return true
  if (/\.(pem|key|p12|pfx|jks|keystore|ppk|p8|mobileprovision)$/.test(base)) return true
  if (['.netrc', '_netrc', '.npmrc', '.pypirc', '.git-credentials', '.pgpass', 'credentials', 'credentials.json',
    '.credentials.json', '.claude.json', 'secrets.json', 'secrets.yml', 'secrets.yaml', '.secrets', 'auth.json',
    'access-token', 'hosts.yml', 'state.json', 'kubeconfig', 'npmrc', '.bash_history', '.zsh_history', '.python_history',
    '.node_repl_history', '.psql_history', 'consolehost_history.txt'].includes(base)) {
    // `state.json` / `hosts.yml` are only secrets inside their CLI config directories.
    if (base === 'state.json') return /(^|\/)\.expo\//.test(s)
    if (base === 'hosts.yml') return /(^|\/)(gh|github cli)\//.test(s)
    return true
  }
  if (/service[-_]?account.*\.json$/.test(base) || /-sa(-key)?\.json$/.test(base)) return true
  const segments = ['/.ssh/', '/.aws/', '/.azure/', '/.gnupg/', '/.kube/', '/.config/gcloud/', '/.config/gh/', '/.supabase/',
    '/.railway/', '/.auth/', '/microsoft/credentials/', '/microsoft/protect/', '/com.vercel.cli/', '/.docker/', '/supabase/.temp/',
    '/user data/default/login data/', '/user data/default/cookies/', '/user data/default/network/cookies/', '/code/user/globalstorage/',
    '/mozilla/firefox/profiles/']
  if (base === 'google-services.json' || base === 'googleservice-info.plist' || base === 'state.vscdb') return true
  const padded = `/${s}/`
  return segments.some((seg) => padded.includes(seg) && !(seg === '/.docker/' && !padded.endsWith('/config.json/')))
}

/** Minimal glob: `**` any depth, `*` within one segment. Case-insensitive (Windows filesystem). */
export function globToRegExp(glob) {
  // `dir/**` also matches `dir` itself (deleting or replacing the directory affects everything under it).
  if (glob.endsWith('/**') && !glob.slice(0, -3).includes('*')) {
    return new RegExp(`^${glob.slice(0, -3).replace(/[.+?^${}()|[\]\\]/g, '\\$&')}(?:/.*)?$`, 'i')
  }
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i++ }
    } else if (ch === '*') re += '[^/]*'
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

const DEPENDENCY_MANIFESTS = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|pipfile(\.lock)?|uv\.lock|constraints[^/]*\.txt)$/i
const AGENT_INSTRUCTION_GLOBS = ['CLAUDE.md', 'AGENTS.md', '.claude/**', '.wolf/hooks/**', '.mcp.json']
const TEST_OR_DOC = /(^|\/)(tests?|__tests__|e2e|docs)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$|\.md$/i

export function createPathPolicy(contract, ctx) {
  const root = normalizeSlashes(ctx.projectRoot)
  const tempRoots = (ctx.tempRoots ?? []).filter(Boolean).map(normalizeSlashes)
  const home = ctx.homeDir ? normalizeSlashes(ctx.homeDir) : null
  const protectedGlobs = contract.protected_paths.map((g) => ({ glob: g, re: globToRegExp(g) }))
  const migrationRe = globToRegExp('supabase/migrations/**')

  const isUnder = (abs, dir) => abs.toLowerCase() === dir.toLowerCase() || abs.toLowerCase().startsWith(`${dir.toLowerCase()}/`)

  /** Resolve a word (relative to `cwd`) to an absolute, normalized path. */
  function resolve(p, cwd = ctx.cwd) {
    let s = percentDecode(String(p))
    if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = (ctx.homeDir ?? '~') + s.slice(1)
    s = normalizeSlashes(s)
    const base = normalizeSlashes(cwd ?? ctx.projectRoot)
    const isAbs = /^[a-z]:\//i.test(s) || s.startsWith('/')
    const joined = isAbs ? s : `${base}/${s}`
    // posix normalization keeps drive letters intact once slashes are uniform
    const abs = normalizeSlashes(path.posix.normalize(joined))
    // The hook injects a canonicalizer (realpath of the nearest existing ancestor) so 8.3 short names
    // (`CLAUDE~1`), symlinks and junctions resolve to the real path before classification.
    if (typeof ctx.canonicalize === 'function') {
      try { return normalizeSlashes(ctx.canonicalize(abs)) } catch { return abs }
    }
    return abs
  }

  const isAbsolute = (p) => /^([a-zA-Z]:)?[\\/]/.test(String(p)) || /^~([\\/]|$)/.test(String(p))
  const unknownCwd = (p, cwd) => cwd === null && !isAbsolute(p)

  /** True when a bulk write rooted at `abs` (e.g. `prettier --write .`) would reach a protected path or migration. */
  function coversProtected(abs) {
    const rel = repoRelative(abs)
    if (rel === null) return false
    if (rel === '') return true
    const lower = rel.toLowerCase()
    // `**/NAME` globs (nested CLAUDE.md/AGENTS.md) are not considered here: a subtree write reaching one of them is a
    // documented limit, otherwise every directory would count as covering a protected path.
    return [...contract.protected_paths, 'supabase/migrations/**'].some((g) => {
      const prefix = g.split('*')[0].replace(/\/$/, '').toLowerCase()
      return prefix !== '' && (prefix.startsWith(`${lower}/`) || lower === prefix || lower.startsWith(`${prefix}/`))
    })
  }

  function repoRelative(abs) {
    if (!isUnder(abs, root)) return null
    const rel = abs.length === root.length ? '' : abs.slice(root.length + 1)
    // Claude-managed worktrees live under .claude/worktrees/<name>/; evaluate their files as repository files.
    const nested = /^\.claude\/worktrees\/[^/]+(?:\/(.*))?$/i.exec(rel)
    return nested ? nested[1] ?? '' : rel
  }

  function isMigrationPath(abs, raw) {
    const rel = repoRelative(abs)
    if (rel !== null) return migrationRe.test(rel) && rel.toLowerCase() !== 'supabase/migrations'
    return /(^|\/)supabase\/migrations\/[^/]+/i.test(normalizeSlashes(raw ?? abs))
  }

  function protectedMatch(abs) {
    const rel = repoRelative(abs)
    if (rel === null) return null
    const hit = protectedGlobs.find(({ re }) => re.test(rel))
    if (hit) return hit.glob
    const base = rel.slice(rel.lastIndexOf('/') + 1)
    if (/^(claude|agents)\.md$/i.test(base)) return `**/${base}`
    return null
  }

  function gitInternal(abs) {
    const padded = `/${abs.toLowerCase()}/`
    if (!padded.includes('/.git/')) return null
    if (/\/\.git\/(hooks\/|config\/$)/.test(padded) || /\/\.git\/worktrees\/[^/]+\/config\/$/.test(padded)) return 'hooks_or_config'
    return 'internal'
  }

  /** @returns {{ action: string, code: string, detail: string }} */
  function classifyRead(p, cwd) {
    const abs = resolve(p, cwd ?? undefined)
    if (isSensitivePath(p) || isSensitivePath(abs)) {
      return { action: 'read_production_or_publisher_credentials', code: 'path.read_credential', detail: 'reading a credential or secret file' }
    }
    if (hasShortNameSegment(abs)) return { action: 'run_unrecognized_command', code: 'path.short_name', detail: 'unresolved 8.3 short-name path' }
    return { action: 'read_repository', code: 'path.read', detail: 'read' }
  }

  /**
   * @param {string} p path word
   * @param {{ cwd?: string, mode?: 'write' | 'edit' | 'delete' | 'move', content?: string }} opts
   */
  function classifyWrite(p, { cwd, mode = 'write', content } = {}) {
    const abs = resolve(p, cwd ?? undefined)
    const exists = mode === 'edit' || mode === 'delete' || mode === 'move' ? true : safeExists(abs)
    if (isMigrationPath(abs, p) || (unknownCwd(p, cwd) && /(^|[\\/])migrations[\\/]|\.sql$/i.test(String(p)))) {
      if (exists || /[*?[]/.test(p)) return { action: 'modify_existing_migration', code: 'path.existing_migration', detail: 'existing migrations are immutable' }
      const activation = content ? detectActivation(content) : null
      if (activation) return activation
      return { action: 'author_new_forward_only_migration', code: 'path.new_migration', detail: 'new forward-only migration requires human approval' }
    }
    if (unknownCwd(p, cwd)) {
      if (isSensitivePath(p)) return { action: 'edit_credential_file', code: 'path.write_credential', detail: 'writing a credential or secret file' }
      return { action: 'edit_outside_task_worktree', code: 'path.unknown_cwd', detail: 'relative path after a computed directory change cannot be resolved' }
    }
    if (hasShortNameSegment(abs)) return { action: 'edit_outside_task_worktree', code: 'path.short_name', detail: 'unresolved 8.3 short-name path' }
    const git = gitInternal(abs)
    if (git === 'hooks_or_config') return { action: 'bypass_git_hooks_or_ci', code: 'path.git_hooks', detail: 'git hooks/config can disable local safety hooks' }
    if (git === 'internal') return { action: 'modify_git_configuration_or_remotes', code: 'path.git_internal', detail: 'direct writes to git internals' }
    if (isSensitivePath(abs)) return { action: 'edit_credential_file', code: 'path.write_credential', detail: 'writing a credential or secret file' }
    if (content && isSettingsFile(abs) && /"(disableAllHooks|disableBypassPermissionsMode)"\s*:\s*(true|false|"[^"d][^"]*")|bypassPermissions|dangerously-skip-permissions/.test(content)) {
      return { action: 'bypass_git_hooks_or_ci', code: 'content.settings_bypass', detail: 'settings content disables hooks or enables bypass mode' }
    }
    const rel = repoRelative(abs)
    if (rel === null) {
      if (tempRoots.some((t) => isUnder(abs, t)) || /^\/dev\/(null|stdout|stderr)$/.test(abs)) return { action: 'edit_files_in_task_worktree', code: 'path.temp', detail: 'scratch/temp file' }
      if (home && isUnder(abs, `${home}/.claude`)) return { action: 'modify_agent_instructions_or_hooks', code: 'path.user_claude_config', detail: 'user-level Claude configuration' }
      return { action: 'edit_outside_task_worktree', code: 'path.outside_worktree', detail: 'write outside the task worktree' }
    }
    if (content && !TEST_OR_DOC.test(rel)) {
      const activation = detectActivation(content)
      if (activation) return activation
    }
    const prot = protectedMatch(abs)
    if (prot) {
      const agentScope = AGENT_INSTRUCTION_GLOBS.some((g) => globToRegExp(g).test(rel)) || /(^|\/)(claude|agents)\.md$/i.test(rel)
      return agentScope
        ? { action: 'modify_agent_instructions_or_hooks', code: 'path.protected_agent_config', detail: `protected agent instructions/hooks (${prot})` }
        : { action: 'modify_control_plane_files', code: 'path.protected_control_plane', detail: `protected control-plane path (${prot})` }
    }
    if (DEPENDENCY_MANIFESTS.test(rel)) return { action: 'install_or_upgrade_dependencies', code: 'path.dependency_manifest', detail: 'dependency manifest change' }
    return { action: 'edit_files_in_task_worktree', code: 'path.worktree', detail: 'task worktree file' }
  }

  function isSettingsFile(abs) {
    return /(^|\/)\.claude\/settings(\.local)?\.json$/i.test(abs) || /(^|\/)managed-settings\.json$/i.test(abs)
  }

  function safeExists(abs) {
    try { return Boolean(ctx.pathExists?.(abs)) } catch { return true } // unknown → assume it exists (stricter)
  }

  return { resolve, repoRelative, classifyRead, classifyWrite, isMigrationPath, protectedMatch, coversProtected, unknownCwd }
}

// ── Customer-agent activation / billing (N-11). Recognizes the concrete identifiers used by the H-series
// Agent Harness. This is a SEMANTIC heuristic: renamed flags, computed values or indirect SQL are not detected.
const ACTIVATION_PATTERNS = [
  [/\bAGENT_[A-Z0-9_]*(ENABLED|PAID_CALLS)\b["']?\s*[:=]\s*["']?(true|1|yes|on)\b/i, 'activate_customer_agent_execution', 'content.agent_flag'],
  [/\b(agent|billing)[a-z0-9_]*_enabled\s*(:\s*bool\s*)?=\s*True\b/, 'activate_customer_agent_execution', 'content.agent_default'],
  [/\binsert\s+into\s+(public\.)?agent_(autonomy_grants|tool_grants|tool_grant_set)\b/i, 'grant_customer_agent_autonomy_or_decide_v2', 'content.agent_grant'],
  [/\bagent_autonomy_grant_issue\s*\(/i, 'grant_customer_agent_autonomy_or_decide_v2', 'content.agent_grant'],
  [/\bdecide[_-]?v2\b[^\n]{0,80}\b(grant|enable|insert|true)\b/i, 'grant_customer_agent_autonomy_or_decide_v2', 'content.decide_v2'],
  [/\b(update|insert\s+into)\s+(public\.)?agent_(customer_billing_controls|autonomy_(tenant|platform)_state)\b/i, 'enable_customer_agent_billing', 'content.agent_billing'],
  [/\bagent_billing_attempt_(reserve|dispatch|settle)\s*\(|\/billing\/monthly-trueup\b/i, 'enable_customer_agent_billing', 'content.agent_billing'],
]

export function detectActivation(text) {
  for (const [re, action, code] of ACTIVATION_PATTERNS) {
    if (re.test(text)) return { action, code, detail: 'customer-agent activation, grant or billing change' }
  }
  return null
}
