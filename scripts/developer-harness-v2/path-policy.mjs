// Developer Harness V2 — path classification (Phase 2). Pure: callers inject filesystem facts.
//
// Answers three questions about a path, without ever opening it:
//   1. Is it a credential/secret store?        (reading it is `read_production_or_publisher_credentials`)
//   2. Is it protected by the contract?         (`protected_paths`, migrations, git internals)
//   3. Is it inside the task worktree?          (writes elsewhere need approval)
import { lstatSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// ── Central fail-closed invariants (Phase 4 path-resolution remediation) ───────────────────────────────────────────
// A path is only classified when its meaning can be determined without running anything. Everything else is reported
// through ONE route (`unresolvableForm` / a failed canonicalization / a failed tree scan) and mapped to an EXISTING
// approval-required action by the classifiers below. No command-specific pattern is needed for these.

// Known PowerShell drives, and ANY multi-character `name:` followed by a separator or nothing (`gh:\x` — a drive made by a profile or
// New-PSDrive). Single letters are Windows drives; `https://` and `name:text` are not paths here.
const PS_DRIVES = /^(?:hk(?:lm|cu|cr|u|cc)|env|cert|function|variable|alias|wsman|registry|filesystem):|^[A-Za-z][A-Za-z0-9_.-]+:(?:[\\/](?![\\/])|$)/i
const PS_PROVIDER_QUALIFIED = /^(?:[\w.-]+[\\/])?(?:filesystem|registry|alias|environment|function|variable|certificate|wsman)::/i

/**
 * Why a path word cannot be resolved statically, or null when it can. The word is checked as written and percent-decoded.
 *  - `~+` `~-` `~N` `~user`: Bash expands these to directories (PWD, OLDPWD, the directory stack, a home directory) that
 *    are unknown here. Only `~` and `~/...` (the invoking user's home) are understood.
 *  - `C:foo`: a Windows DRIVE-RELATIVE path, relative to that drive's own current directory, which is not the cwd.
 *  - `FileSystem::C:\x`, `Microsoft.PowerShell.Core\FileSystem::...`, `Registry::HKLM\...`, `HKLM:\`, `Env:`, `Cert:`...:
 *    PowerShell provider paths, which are not file paths relative to anything.
 *  - `\\?\...` / `\\.\...`: Win32 device-namespace paths that bypass normalization.
 */
export function unresolvableForm(p) {
  const raw = String(p)
  for (const s of new Set([raw, percentDecode(raw)])) {
    if (/^~(?![\\/]|$)/.test(s)) return 'unsupported_tilde'
    if (/^[a-zA-Z]:(?![\\/])/.test(s)) return 'drive_relative'
    if (PS_PROVIDER_QUALIFIED.test(s) || PS_DRIVES.test(s)) return 'provider_path'
    if (/^[\\/]{2}[?.][\\/]/.test(s)) return 'device_path'
  }
  return null
}

const INSTRUCTION_FILE = /^(claude|agents)\.md$/i
// Dependency/VCS trees are not scanned INSIDE a larger operand (git ignores them; they hold third-party files).
const SKIP_SCAN_DIRS = new Set(['node_modules', '.git', '.venv', '__pycache__', '.next'])
export const SCAN_LIMITS = Object.freeze({ maxEntries: 5000, maxDepth: 24 })

/**
 * Default read-only subtree scanner: does the directory `abs` contain a CLAUDE.md / AGENTS.md at any depth?
 * Never follows links or junctions, never reads file contents, and is bounded. Returns
 * `{ status: 'ok'|'missing'|'file'|'limit'|'error', found }`; only `ok` and `missing`/`file` are conclusive.
 * The hook budget is 10 s: the entry bound keeps a scan to a few milliseconds.
 */
export function defaultScanTree(abs, { linksUnprovable = false } = {}) {
  let st
  try { st = lstatSync(abs) } catch (error) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? { status: 'missing', found: false } : { status: 'error', found: false }
  }
  if (st.isSymbolicLink()) return { status: 'error', found: false } // a canonical path is never a link: an odd one is unprovable
  if (!st.isDirectory()) return { status: 'file', found: false }
  const stack = [[abs, 0]]
  let seen = 0
  while (stack.length) {
    const [dir, depth] = stack.pop()
    if (depth > SCAN_LIMITS.maxDepth) return { status: 'limit', found: false }
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return { status: 'error', found: false } }
    for (const entry of entries) {
      if (++seen > SCAN_LIMITS.maxEntries) return { status: 'limit', found: false }
      if (INSTRUCTION_FILE.test(entry.name)) return { status: 'ok', found: true }
      if (linksUnprovable && entry.isSymbolicLink()) return { status: 'ok', found: true }
      if (entry.isDirectory() && !SKIP_SCAN_DIRS.has(entry.name.toLowerCase())) stack.push([path.join(dir, entry.name), depth + 1])
    }
  }
  return { status: 'ok', found: false }
}

/**
 * Default dangling-link check for a CANONICAL path: true when the nearest existing component is still a symbolic link or junction
 * (a link that resolves is already replaced by its target, so one that remains does not resolve — writing through it would create
 * its target), or when that component cannot be inspected. Read-only (lstat only).
 */
export function defaultDanglingLink(abs) {
  let p = abs
  for (let i = 0; i < 128; i++) {
    try { return lstatSync(p).isSymbolicLink() } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') return true
      const parent = path.dirname(p)
      if (parent === p) return false
      p = parent
    }
  }
  return true
}

const FLOW_KEYWORDS = /(^|[\s;&|(){}])(if|elif|else|then|fi|for|foreach|while|until|do|done|case|esac|function|try|catch|finally|trap|switch|select|begin|process|end|param|coproc)(?=$|[\s;&|(){}])|(^|[\s;&|(){}])!(\s|$)/i

/**
 * Whether a `cd`/`Set-Location` in `source` certainly takes effect for everything after it. A shell keeps its OLD directory when the
 * change fails, when it runs in a subshell, a pipeline or the background, or when it sits behind `&&`/`||`/`if`: the policy would then
 * track a directory the shell is not in. Only simple linear flows qualify: POSIX/cmd `a && b && c` (a failed step stops the chain),
 * PowerShell `a; b; c` with no pipes, blocks, conditionals or background (the caller must also check that the target exists, because
 * PowerShell carries on after a failed Set-Location). Anything else is "not certain": the caller treats the cwd as unknown.
 */
export function cwdFlowIsCertain(source, dialect) {
  const text = String(source)
  if (FLOW_KEYWORDS.test(text) || /[|(){}`]|\$\(/.test(text)) return false
  if (dialect === 'powershell') return !text.includes('&')
  return !/[;&\n]/.test(text.replace(/&&/g, ' '))
}

/**
 * True when a path word means exactly what it says: resolving it must not have to REWRITE it. The resolver decodes `%XX`, drops
 * trailing dots/spaces and `:stream` suffixes (Windows file APIs do that for some programs); PowerShell's Set-Location does none of
 * it and fails, leaving the location unchanged. Wildcards and backticks are interpreted by PowerShell, so they are not plain either.
 */
export function isPlainPathText(text, { relative = false } = {}) {
  const t = String(text)
  if (relative && /^([a-z]:|[\\/]|~)/i.test(t)) return false // an absolute spelling is read differently by different programs
  // `/c/Users` is Git Bash's spelling of `C:\Users`; PowerShell reads it as `C:\c\Users` (which does not exist).
  return !/%[0-9a-f]{2}|[*?[\]`]|^[\\/][a-z][\\/]/i.test(t) &&!t.slice(/^[a-z]:/i.test(t) ? 2 : 0).includes(':') &&
    !t.split(/[\\/]/).some((seg) => seg !== '.' && seg !== '..' && /[. ]$/.test(seg))
}

/** Default directory test (follows links; a file, a missing path or any error is "not a directory"). */
export function defaultIsDirectory(abs) {
  try { return statSync(abs).isDirectory() } catch { return false }
}

/** Default child-directory lister (read-only; never follows links). A directory that cannot be read yields null. */
export function defaultListDirs(abs) {
  try { return readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return null }
}

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
  // Private SSH keys under any name (`controller_ed25519`), never the `.pub` half.
  if (/(^|[_.-])(ecdsa|ed25519)$/.test(base) || /^ssh_host_[a-z0-9]+_key$/.test(base)) return true
  // Developer Harness V3 infrastructure root (%LOCALAPPDATA%/PatelRep/dh3[-suffix]): worker SSH keys, the owner's Claude login disk and
  // the GnuPG home used for artifact verification are credentials in every mode (V2 transition; see 14-v2-permission-transition.md).
  if (/(^|\/)patelrep\/dh3(-[a-z0-9-]+)?\/(workers\/[^/]+\/(ssh(\/|$)|auth\.qcow2$)|gnupg(\/|$))/.test(s)) return true
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
// Phase 4 M1: OpenWolf instruction/memory files take the same label as other agent instructions. config.json, cron-manifest.json,
// anatomy.md and buglog.json stay generic control-plane. Both labels are human_approval; the class is identical.
AGENT_INSTRUCTION_GLOBS.push('.wolf/OPENWOLF.md', '.wolf/cerebrum.md', '.wolf/knowledge/**', '.wolf/reframe-frameworks.md', '.wolf/identity.md')
const TEST_OR_DOC = /(^|\/)(tests?|__tests__|e2e|docs)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$|\.md$/i

export function createPathPolicy(contract, ctx) {
  const root = normalizeSlashes(ctx.projectRoot)
  const tempRoots = (ctx.tempRoots ?? []).filter(Boolean).map(normalizeSlashes)
  const home = ctx.homeDir ? normalizeSlashes(ctx.homeDir) : null
  const protectedGlobs = contract.protected_paths.map((g) => ({ glob: g, re: globToRegExp(g) }))
  const migrationRe = globToRegExp('supabase/migrations/**')

  const isUnder = (abs, dir) => abs.toLowerCase() === dir.toLowerCase() || abs.toLowerCase().startsWith(`${dir.toLowerCase()}/`)

  /** The hook's canonicalizer, validated: a throw, a non-string or a non-absolute result is a FAILURE, never a path. */
  function canonical(abs) {
    if (typeof ctx.canonicalize !== 'function') return { abs }
    let out
    try { out = ctx.canonicalize(abs) } catch { return { abs, failed: 'canonicalize' } }
    if (typeof out !== 'string' || !/^([a-zA-Z]:)?[\\/]/.test(out)) return { abs, failed: 'canonicalize' }
    // A canonicalizer resolves what exists; a LINK it could not resolve (dangling, or a loop) is reported as "not there" and the
    // lexical name comes back. Writing through such a link creates its target, so it is a failure, not a path.
    let dangling
    try { dangling = (typeof ctx.isDanglingLink === 'function' ? ctx.isDanglingLink : defaultDanglingLink)(out) } catch { dangling = true }
    if (dangling !== false) return { abs, failed: 'canonicalize' }
    return { abs: normalizeSlashes(out) }
  }

  /** Why `p` cannot be resolved without running something (including a `~` when the home directory is unknown), or null. */
  const unresolvable = (p) => unresolvableForm(p) ?? (/^~([\\/]|$)/.test(String(p)) && !ctx.homeDir ? 'unknown_home' : null)

  /**
   * Resolve a word (relative to `cwd`) to an absolute, normalized path. `failed` is set when the path could NOT be resolved
   * (unsupported form, or canonicalization failed): `abs` is then only a lexical placeholder and every classifier below
   * reports it instead of treating it as a real location.
   */
  // memoized per policy instance (one tool call): the same operand is resolved many times by the classifiers
  const resolved = new Map()
  function resolveChecked(p, cwd = ctx.cwd) {
    const key = JSON.stringify([cwd, p])
    if (!resolved.has(key)) resolved.set(key, resolveUncached(p, cwd))
    return resolved.get(key)
  }
  function resolveUncached(p, cwd) {
    const form = unresolvable(p)
    let s = percentDecode(String(p))
    if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = (ctx.homeDir ?? '~') + s.slice(1)
    s = normalizeSlashes(s)
    const base = normalizeSlashes(cwd ?? ctx.projectRoot)
    const isAbs = /^[a-z]:\//i.test(s) || s.startsWith('/')
    const joined = isAbs ? s : `${base}/${s}`
    // posix normalization keeps drive letters intact once slashes are uniform
    const abs = normalizeSlashes(path.posix.normalize(joined))
    if (form) return { abs, failed: 'form', lex: abs }
    // The hook injects a canonicalizer (realpath of the nearest existing ancestor) so 8.3 short names
    // (`CLAUDE~1`), symlinks and junctions resolve to the real path before classification.
    if (typeof ctx.canonicalize === 'function' && hasInnerDotDot(joined)) {
      // `link/..` means different things to different programs: Git Bash and POSIX tools apply `..` to the link's REAL target,
      // while PowerShell, cmd, other native Windows programs and Node (the Write/Edit tools) collapse it as TEXT. The command's
      // interpreter is not known here, so BOTH readings are computed and the stricter classification wins (`alt`).
      const real = resolveDotDot(joined)
      const text = canonical(abs)
      if (text.failed) return { ...real, failed: 'canonicalize', lex: abs }
      return { ...real, lex: abs, ...(!real.failed && text.abs.toLowerCase() !== real.abs.toLowerCase() ? { alt: text.abs } : {}) }
    }
    return { ...canonical(abs), lex: abs }
  }

  // `link/../x` is NOT `x` when `link` is a symlink or junction: the operating system applies `..` to the link's REAL target.
  // Collapsing `..` lexically first would classify a different directory than the one that is written. A `..` that follows a real
  // segment is therefore applied only after everything before it has been canonicalized.
  // `joined` is absolute, so any `..` segment follows real segments (at least the base directory's own).
  const hasInnerDotDot = (p) => /(^|\/)\.\.(\/|$)/.test(p)
  function resolveDotDot(joined) {
    const norm = normalizeSlashes(joined)
    const drive = /^[a-z]:/.exec(norm)?.[0] ?? ''
    let cur = `${drive}/`
    for (const seg of norm.slice(drive.length).split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') {
        const real = canonical(cur)
        if (real.failed) return { abs: normalizeSlashes(path.posix.normalize(joined)), failed: 'canonicalize' }
        cur = real.abs.replace(/\/[^/]*$/, '') || `${drive}/`
        if (drive && cur === drive) cur = `${drive}/`
      } else cur = `${cur.replace(/\/$/, '')}/${seg}`
    }
    return canonical(normalizeSlashes(cur))
  }

  const resolve = (p, cwd = ctx.cwd) => resolveChecked(p, cwd).abs

  // The repository root may itself be reached through a link or a short name: files are repository files when they sit under
  // EITHER spelling (the canonical one is what a canonicalized operand resolves to).
  const rootReal = canonical(root)
  const roots = !rootReal.failed && rootReal.abs.toLowerCase() !== root.toLowerCase() ? [root, rootReal.abs] : [root]

  const isAbsolute = (p) => /^([a-zA-Z]:)?[\\/]/.test(String(p)) || /^~([\\/]|$)/.test(String(p))
  const cwdUnknown = (p, cwd) => cwd === null && !isAbsolute(p)
  /** True when the word cannot be resolved: a relative path after a computed `cd`, or an unresolvable path form. */
  const unknownCwd = (p, cwd) => cwdUnknown(p, cwd) || unresolvable(p) !== null

  // ── Subtree scan: does a directory contain a nested CLAUDE.md / AGENTS.md? (cached per policy instance) ──
  const scanCache = new Map()
  /**
   * Whether replacing, moving, deleting or copying the directory `abs` can affect (or create) a nested instruction file.
   * Conclusive only when the scan completed; a scan that failed, hit its bound or returned garbage counts as "yes".
   */
  function treeHasInstructionFiles(abs, { linksUnprovable = false } = {}) {
    // `linksUnprovable`: a COPY of a tree may follow links (`Copy-Item -Recurse` on Windows PowerShell, `cp -L`), so a link inside
    // the source can bring in files the scan cannot see: it counts as "contains one".
    const key = `${linksUnprovable ? 'L:' : ''}${abs.toLowerCase()}`
    if (scanCache.has(key)) return scanCache.get(key)
    let result
    try { result = (typeof ctx.scanTree === 'function' ? ctx.scanTree : defaultScanTree)(abs, { linksUnprovable }) } catch { result = null }
    let covers = true
    if (result && typeof result === 'object') {
      if (result.status === 'ok') covers = result.found === true
      else if (result.status === 'missing' || result.status === 'file') covers = false
    }
    scanCache.set(key, covers)
    return covers
  }

  /**
   * Names of the child DIRECTORIES of `abs` (links are not directories here), or null when the directory cannot be listed
   * (callers then fall back to the whole subtree). At most `SCAN_LIMITS.maxEntries` names; more than that is "unknown".
   */
  function childDirectories(abs) {
    try {
      const names = (typeof ctx.listDirs === 'function' ? ctx.listDirs : defaultListDirs)(abs)
      return Array.isArray(names) && names.length <= SCAN_LIMITS.maxEntries && names.every((n) => typeof n === 'string') ? names : null
    } catch { return null }
  }

  /** True when a bulk write rooted at `abs` (e.g. `prettier --write .`) would reach a protected path or migration. */
  function coversProtected(abs) {
    const rel = repoRelative(abs)
    if (rel === null) return false
    if (rel === '') return true
    const lower = rel.toLowerCase()
    const byPrefix = [...contract.protected_paths, 'supabase/migrations/**'].some((g) => {
      const prefix = g.split('*')[0].replace(/\/$/, '').toLowerCase()
      return prefix !== '' && (prefix.startsWith(`${lower}/`) || lower === prefix || lower.startsWith(`${prefix}/`))
    })
    // `**/CLAUDE.md` and `**/AGENTS.md` have no fixed prefix, so they are found by scanning the real subtree (bounded; a scan that
    // cannot complete counts as "contains one").
    return byPrefix || treeHasInstructionFiles(abs)
  }

  function repoRelative(abs) {
    const root = roots.find((r) => isUnder(abs, r))
    if (root === undefined) return null
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
  const CLASS_ORDER = ['allowed', 'task_authorized', 'human_approval', 'forbidden']
  /** The stricter of two findings by the contract's class of their actions (an unknown action ranks as the strictest). */
  function stricter(a, b) {
    const rank = (f) => { const i = CLASS_ORDER.indexOf(contract.actions?.[f.action]); return i < 0 ? CLASS_ORDER.length : i }
    return rank(b) > rank(a) ? b : a
  }

  function classifyRead(p, cwd) {
    const res = resolveChecked(p, cwd ?? undefined)
    const first = readAt(p, cwd, res.abs, res.failed)
    return res.alt ? stricter(first, readAt(p, cwd, res.alt, undefined)) : first
  }

  function readAt(p, cwd, abs, failed) {
    if (isSensitivePath(p) || isSensitivePath(abs)) {
      return { action: 'read_production_or_publisher_credentials', code: 'path.read_credential', detail: 'reading a credential or secret file' }
    }
    // An unresolved path is never a harmless read: what it names (and whether it is a credential) is unknown.
    if (failed) return unresolvedFinding('run_unrecognized_command', failed, p)
    if (hasShortNameSegment(abs)) return { action: 'run_unrecognized_command', code: 'path.short_name', detail: 'unresolved 8.3 short-name path' }
    return { action: 'read_repository', code: 'path.read', detail: 'read' }
  }

  /** The one finding shape for "this path could not be resolved": an EXISTING approval-required action, never a permissive one. */
  function unresolvedFinding(action, why, p) {
    if (why === 'form') return { action, code: 'path.unresolvable_form', detail: `unresolvable path form (${unresolvable(p) ?? 'unknown'}): its location depends on state the policy cannot see` }
    if (why === 'canonicalize') return { action, code: 'path.canonicalize_failed', detail: 'the path could not be resolved to its real location (links/short names unverified)' }
    return { action, code: 'path.unknown_cwd', detail: 'relative path after a computed directory change cannot be resolved' }
  }

  /**
   * @param {string} p path word
   * @param {{ cwd?: string, mode?: 'write' | 'edit' | 'delete' | 'move', content?: string }} opts
   */
  function classifyWrite(p, opts = {}) {
    const res = resolveChecked(p, opts.cwd ?? undefined)
    const first = withTarget(writeAt(p, opts, res.abs, res.failed), res.abs, res.failed)
    return res.alt ? stricter(first, withTarget(writeAt(p, opts, res.alt, undefined), res.alt, undefined)) : first
  }

  /** Attaches the resolved target (for the bypass authorizer's path scopes); never changes the finding's action or code. */
  function withTarget(f, abs, failed) {
    return { ...f, meta: { ...(f.meta ?? {}), abs: failed ? null : abs, rel: failed ? null : repoRelative(abs) } }
  }

  function writeAt(p, { cwd, mode = 'write', content } = {}, abs, failed) {
    // An unresolved path may name an existing file: treat it as existing (stricter) and read migrations from the raw text.
    const exists = mode === 'edit' || mode === 'delete' || mode === 'move' || failed ? true : safeExists(abs)
    const rawMigration = failed && /(^|[\\/])supabase[\\/]migrations[\\/][^\\/]+/i.test(String(p))
    if (isMigrationPath(abs, p) || rawMigration || (unknownCwd(p, cwd) && /(^|[\\/])migrations[\\/]|\.sql$/i.test(String(p)))) {
      if (exists || /[*?[]/.test(p)) return { action: 'modify_existing_migration', code: 'path.existing_migration', detail: 'existing migrations are immutable' }
      const activation = content ? detectActivation(content) : null
      if (activation) return activation
      return { action: 'author_new_forward_only_migration', code: 'path.new_migration', detail: 'new forward-only migration requires human approval' }
    }
    if (unknownCwd(p, cwd) || failed) {
      if (isSensitivePath(p)) return { action: 'edit_credential_file', code: 'path.write_credential', detail: 'writing a credential or secret file' }
      return unresolvedFinding('edit_outside_task_worktree', failed ?? (cwdUnknown(p, cwd) ? 'cwd' : 'form'), p)
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

  return { resolve, resolveAlt: (p, cwd = ctx.cwd) => resolveChecked(p, cwd).alt ?? null, readings: (p, cwd = ctx.cwd) => { const r = resolveChecked(p, cwd); return r.alt ? [r.abs, r.alt] : [r.abs] }, resolveChecked, repoRelative, classifyRead, classifyWrite, isMigrationPath, protectedMatch, coversProtected, unknownCwd, treeHasInstructionFiles, childDirectories, isDirectory: (abs) => { try { return (typeof ctx.isDirectory === 'function' ? ctx.isDirectory : defaultIsDirectory)(abs) === true } catch { return false } } }
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
