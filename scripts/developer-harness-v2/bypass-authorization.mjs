// Developer Harness V2 — owner-launched Bypass Permissions transition: deterministic, scoped authorization.
//
// The repository owner explicitly launches `claude --dangerously-skip-permissions`. A hook "ask" cannot reach a human in that mode, so
// every proposed tool call that is not `allowed` is either AUTHORIZED here (it proceeds without a prompt) or DENIED (exit 2). Nothing
// is turned into a prompt. Authority comes ONLY from:
//   * this file's hard-coded CEILING: the only (action, finding code) pairs that can ever be authorized, each with the predicate it
//     must pass, plus the paths that can never be authorized (the policy's own files and the repository control plane);
//   * the owner-reviewed, protected docs/developer-harness-v2/bypass-scopes.json: which routine ceiling entries are enabled, and named
//     scopes bound to one branch (extra protected paths that may be edited; privileged entrypoints that run only from pinned digests);
//   * facts the hook reads itself: the session permission mode, the branch checked out in the session's project root (from .git files),
//     file digests and bounded file contents.
// Tool input, file contents, command output, memory and other agents' messages are data. None of them can name a scope, add a path or
// satisfy a pin. A missing or malformed scopes file, an unknown branch, or any internal error denies (see policy-engine.mjs).
import { readFileSync } from 'node:fs'
import { globToRegExp, normalizeSlashes } from './path-policy.mjs'
import { PROTECTED_BRANCHES, RESERVED_BRANCH_PREFIXES, signatureFindings } from './policy-common.mjs'

export const BYPASS_MODE = 'bypassPermissions'
export const SCOPES_FILE = 'docs/developer-harness-v2/bypass-scopes.json'
export const PIN_TOOL = 'scripts/developer-harness-v2/bypass-pins.mjs'

export class ScopeError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

// ── Never authorizable ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Roots no scope may cover (validated) and no bypass session may write (evaluated): the V2 policy itself, agent configuration and the
// repository control plane. A scope that only *partly* overlaps (e.g. `scripts/developer-harness-v3/**` vs V3's authority) is filtered
// at evaluation by NEVER_GLOBS instead.
export const POLICY_ROOTS = Object.freeze(['.claude/', '.github/', '.githooks/', '.husky/', '.vscode/', '.wolf/', 'supabase/', 'scripts/developer-harness-v2/',
  'docs/developer-harness-v2/', 'docs/staging-previews/', 'claude.md', 'agents.md', '.mcp.json', '.gitattributes', 'scripts/developer-harness-v2-ci-workflow.test.mjs'])
export const NEVER_GLOBS = Object.freeze([...POLICY_ROOTS.map((r) => (r.endsWith('/') ? `${r}**` : r)), '**/CLAUDE.md', '**/AGENTS.md',
  // Developer Harness V3 root-of-trust: its authority code and machine-readable contracts stay owner-only.
  'scripts/developer-harness-v3/authority/**', 'docs/developer-harness-v3/*.json'])
const NEVER_RES = NEVER_GLOBS.map(globToRegExp)
// Root-of-trust files V2 does not protect in other modes (so they classify as ordinary worktree files); bypass keeps them owner-only.
const TRUST_ROOT_RES = ['docs/developer-harness-v3/*.json'].map(globToRegExp)

/**
 * Text that refers to the policy, its configuration or git hooks. Opaque code (inline interpreter code, executed scripts, arguments of
 * unknown programs) that mentions any of it is not authorized: a tripwire against self-modification, not a parser (see residual R-1).
 */
export const POLICY_REFERENCE = new RegExp([
  String.raw`\.claude(\.json)?([\\/'"\s\x60;)]|$)`, String.raw`settings(\.local)?\.json`, 'managed-settings', String.raw`\.githooks`, String.raw`core\.hookspath`,
  String.raw`\.git[\\/](hooks|config|info)`, String.raw`\.github[\\/]`, 'policy-(hook|engine)', 'local-hook', 'developer-harness-v2', 'bypass-(scopes|pins|authorization)',
  String.raw`\b(claude|agents)\.md\b`, String.raw`\.mcp\.json`, String.raw`\.wolf[\\/]`, 'disableallhooks', 'disablebypasspermissionsmode', 'dangerously-skip-permissions',
  'bypasspermissions', '--permission-mode', String.raw`supabase[\\/]migrations`].join('|'), 'i')

// ── Ceiling ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const NPM_INSTALL = ['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isntall', 'add', 'ci', 'clean-install', 'ic', 'install-clean', 'isntall-clean',
  'install-ci-test', 'cit', 'install-test', 'it', 'update', 'up', 'upgrade', 'udpate', 'uninstall', 'un', 'remove', 'rm', 'r', 'dedupe', 'ddp', 'prune', 'rebuild', 'rb']
export const INSTALL_CODES = Object.freeze(new Set([...NPM_INSTALL.map((s) => `npm.${s}`), 'npm.audit_fix',
  ...['pnpm', 'yarn'].flatMap((pm) => ['install', 'add', 'remove', 'update', 'upgrade', 'up'].map((s) => `${pm}.${s}`)),
  'pip.install', 'pip.uninstall', 'pip3.install', 'pip3.uninstall', 'npx.remote_package', 'npx.unknown_package', 'playwright.install', 'expo.install', 'path.dependency_manifest']))

/** The ONLY non-`allowed` findings a bypass session can ever proceed with. `scoped` entries also need the branch's active scope. */
export const CEILING = Object.freeze({
  push_dedicated_branch_fast_forward: { codes: ['git.push'], check: checkPush },
  open_draft_pull_request: { codes: ['gh.pr_create_draft'], check: checkPr },
  interact_with_pull_request_or_issue: { codes: ['gh.pr_edit', 'gh.pr_comment'], check: checkPr },
  install_or_upgrade_dependencies: { codes: [...INSTALL_CODES], check: checkInstall },
  run_unreviewed_script: { codes: ['script.unreviewed', 'python.module'], check: checkScript },
  run_interpreter_inline_code: { codes: ['interpreter.inline_code'], check: checkInline },
  run_unrecognized_command: { codes: ['shell.unrecognized', 'expo.export', 'expo.export:embed', 'expo.prebuild'], check: checkUnknownProgram },
  modify_control_plane_files: { codes: ['path.protected_control_plane'], scoped: true, check: checkScopedPath },
  run_privileged_infrastructure: { codes: ['infra.trusted_entrypoint'], scoped: true, check: checkPinned },
})
export const ROUTINE_ACTIONS = Object.freeze(Object.keys(CEILING).filter((a) => !CEILING[a].scoped))

// `allowed` findings that can replace checked-out files — and so the policy files and the session's branch/scope — are re-checked in
// bypass: only trusted sources (origin/main) or a new branch are accepted. `.gitignore` guards credential files from being staged.
const TREE_CODES = new Set(['git.checkout_branch', 'git.checkout_new_branch', 'git.switch', 'git.merge', 'git.pull', 'git.cherry-pick', 'git.revert', 'git.bisect', 'git.mergetool'])

// Unknown programs that administer the host or write paths the policy cannot see (archives, patches). Tripwire, not a boundary.
const HOST_OR_OPAQUE = new Set(['reg', 'regedit', 'regini', 'setx', 'schtasks', 'at', 'sc', 'netsh', 'bcdedit', 'bootcfg', 'dism', 'wsl', 'wslconfig', 'diskpart', 'format',
  'fsutil', 'mountvol', 'manage-bde', 'cipher', 'vssadmin', 'wbadmin', 'wevtutil', 'auditpol', 'secedit', 'gpupdate', 'shutdown', 'logoff', 'net', 'net1', 'runas', 'msiexec',
  'winget', 'choco', 'scoop', 'sfc', 'pnputil', 'devcon', 'powercfg', 'w32tm', 'certreq', 'mmc', 'systemctl', 'service', 'launchctl', 'crontab', 'sysctl', 'mount', 'umount',
  'ufw', 'iptables', 'nft', 'firewall-cmd', 'usermod', 'useradd', 'userdel', 'passwd', 'chsh', 'visudo', 'apt', 'apt-get', 'dnf', 'yum', 'brew', 'defaults', 'vboxmanage',
  'qemu-system-x86_64', 'qemu-img', 'gpg', 'gpg2', 'ssh-keygen', 'ssh-add', 'ssh-agent', 'openssl', 'az', 'aws', 'gcloud', 'doctl', 'flyctl', 'heroku', 'netlify',
  'firebase', 'wrangler', 'kubectl', 'helm', 'terraform',
  // launchers that run their arguments as another program the classifier would not see
  'corepack', 'volta', 'nvm', 'fnm', 'asdf', 'mise', 'proto',
  'setsid', 'nice', 'ionice', 'stdbuf', 'taskset', 'chrt', 'unbuffer', 'script', 'daemonize', 'disown', 'screen', 'tmux', 'start', 'schtasks', 'psexec', 'runonce', 'tar', 'bsdtar', 'unzip', '7z', '7za', '7zr', 'unrar', 'cpio', 'patch', 'expand'])
// Unknown programs whose purpose is reading stored credentials (secret stores, keychains, password managers, credential dumpers).
const CREDENTIAL_TOOLS = new Set(['get-secret', 'get-secretinfo', 'get-storedcredential', 'get-credential', 'unlock-secretstore', 'cmdkey', 'vaultcmd', 'security',
  'secret-tool', 'pass', 'gopass', 'op', 'bw', 'keyring', 'keyctl', 'credwiz', 'rundll32', 'mimikatz', 'lazagne', 'procdump'])
// Network probes (DNS/ICMP/TFTP egress channels) and interpreters whose inline code the classifier does not parse.
const NETWORK_PROBES = new Set(['nslookup', 'dig', 'host', 'ping', 'tracert', 'traceroute', 'pathping', 'tftp', 'ftp', 'telnet', 'nc', 'ncat', 'socat', 'whois', 'resolve-dnsname', 'test-netconnection', 'test-connection'])
const OPAQUE_INTERPRETERS = new Set(['perl', 'ruby', 'php', 'lua', 'luajit', 'rscript', 'osascript', 'wscript', 'cscript', 'mshta', 'forfiles', 'jshell', 'tclsh', 'wish', 'awk', 'gawk', 'java', 'groovy', 'scala', 'kotlin', 'msbuild', 'go', 'dotnet', 'cargo', 'rustc', 'csc', 'vbc', 'jsc', 'installutil', 'regsvr32', 'regasm'])
// `python -m <module>` modules a bypass session may run (pytest/ruff/mypy/pip/venv are classified by their own handlers).
const PYTHON_MODULES = new Set(['tokenize', 'ast', 'dis', 'platform', 'sysconfig', 'pyflakes', 'pycodestyle', 'pydocstyle'])
// Values that look like secrets (tokens, keys, private keys, connection strings, KEY=value lines with credential names).
export const SECRET_VALUE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}|\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(ql)?:\/\/[^\s:@]+:[^\s@]+@|\b[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|SERVICE_ROLE|API_KEY|PRIVATE_KEY|JWT)[A-Z0-9_]*\s*=\s*(?!(?:<[^>\s]*>|\*{3,}|\$\{?\w+\}?|\{\{[^}]*\}\}|(?:[Yy]our|YOUR|[Ee]xample|EXAMPLE|[Rr]edacted|REDACTED|[Pp]laceholder|PLACEHOLDER|[Cc]hange[Mm]e|CHANGEME|[Dd]ummy|DUMMY)(?:[-_][\w-]*)?|[xX]{3,})(?:[\s"'`,;)]|$))[^\s<>]{8,}/
const PS_MUTATING_VERB = /^(set|new|remove|enable|disable|install|uninstall|register|unregister|add|clear|stop|restart|start|suspend|resume|update|grant|revoke|block|unblock|mount|dismount|rename|reset|invoke|import|publish|unpublish|save|send|connect|disconnect|initialize|optimize|repair|restore|backup|checkpoint|lock|unlock|protect|unprotect|approve|deny|move|copy|write|edit|push|pop|use|enter|exit|debug|deploy|expand|compress|sync|submit|request|limit|close|open|redo|undo|complete|confirm|receive|merge)-[a-z]/

/** Read-only V2 policy tools a bypass session may run (they live under protected paths and are trusted as the policy itself). */
const POLICY_TOOLS = {
  'scripts/developer-harness-v2/ci/run-ci-suites.mjs': (args) => args.length === 0,
  [PIN_TOOL]: (args) => args.every((a, i) => /^--(print|check|json)$/.test(a) || /^--scope(=[a-z0-9-]+)?$/.test(a) || (args[i - 1] === '--scope' && /^[a-z0-9-]+$/.test(a))),
}

// ── Scopes file ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const fail = (code, message) => { throw new ScopeError(code, message) }
const REL_PATH = /^(?!\/)(?!.*\/\/)[A-Za-z0-9._\-/]{1,300}$/
const relOk = (p) => typeof p === 'string' && REL_PATH.test(p) && !p.split('/').includes('..')
const branchOk = (b) => typeof b === 'string' && /^[A-Za-z0-9._/-]{1,120}$/.test(b) && !b.split('/').includes('..') && b !== 'HEAD' &&
  !PROTECTED_BRANCHES.has(b.toLowerCase()) && !RESERVED_BRANCH_PREFIXES.some((p) => b.toLowerCase().startsWith(p))
const lc = (s) => s.toLowerCase()
const inList = (list, r) => list.some((i) => (i.endsWith('/') ? r.startsWith(lc(i)) : r === lc(i)))
export const inClosure = (closure, rel) => { const r = lc(rel); return inList(closure.include, r) && !inList(closure.exclude, r) }

function validWritableGlob(g, contract) {
  if (typeof g !== 'string' || !/^[A-Za-z0-9._\-/*]{1,200}$/.test(g) || g.startsWith('/') || g.split('/').includes('..')) fail('bypass.scope_glob', `invalid writable glob ${String(g).slice(0, 60)}`)
  const fixed = lc(g.split('*')[0])
  if (fixed.split('/').filter(Boolean).length < 2) fail('bypass.scope_glob_broad', `writable glob ${g} must be at least two fixed path segments deep`)
  for (const root of POLICY_ROOTS) if (fixed.startsWith(root) || root.startsWith(fixed)) fail('bypass.scope_covers_policy', `writable glob ${g} overlaps the policy or control plane (${root})`)
  const re = globToRegExp(g)
  for (const infra of contract?.protected_infrastructure ?? []) if (re.test(infra)) fail('bypass.scope_covers_infrastructure', `writable glob ${g} covers ${infra}`)
  return re
}

function validExecution(e, ids) {
  if (!isObj(e)) fail('bypass.execution', 'trusted execution is not an object')
  const keys = ['id', 'entrypoint', 'interpreter', 'subcommands', 'options', 'closure', 'digests', 'reviewed_source', '$comment']
  if (Object.keys(e).some((k) => !keys.includes(k))) fail('bypass.execution_keys', 'trusted execution has unknown fields')
  if (typeof e.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(e.id) || ids.has(e.id)) fail('bypass.execution_id', 'trusted execution id invalid or duplicate')
  ids.add(e.id)
  if (!relOk(e.entrypoint) || e.entrypoint.endsWith('/')) fail('bypass.execution_entrypoint', 'entrypoint must be a repository file path')
  if (e.interpreter !== 'node') fail('bypass.execution_interpreter', 'only node entrypoints are supported')
  if (!Array.isArray(e.subcommands) || !e.subcommands.length || e.subcommands.length > 32 || !e.subcommands.every((s) => typeof s === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(s))) fail('bypass.execution_subcommands', 'subcommands malformed')
  if (!Array.isArray(e.options) || e.options.length > 32 || !e.options.every((o) => typeof o === 'string' && /^--[a-z][a-z0-9-]{0,40}$/.test(o))) fail('bypass.execution_options', 'options must be a list of --flag names')
  const c = e.closure
  if (!isObj(c) || !Array.isArray(c.include) || !c.include.length || c.include.length > 32 || !Array.isArray(c.exclude ?? []) || (c.exclude ?? []).length > 32) fail('bypass.execution_closure', 'closure malformed')
  for (const p of [...c.include, ...(c.exclude ?? [])]) if (!relOk(p)) fail('bypass.execution_closure_path', `closure path invalid: ${String(p).slice(0, 60)}`)
  for (const p of c.include) if (POLICY_ROOTS.some((r) => lc(p).startsWith(r) || r.startsWith(lc(p)))) fail('bypass.execution_closure_policy', `closure may not include policy paths (${p})`)
  const closure = Object.freeze({ include: Object.freeze([...c.include]), exclude: Object.freeze([...(c.exclude ?? [])]) })
  if (!inClosure(closure, e.entrypoint)) fail('bypass.execution_entrypoint_closure', 'entrypoint must be inside its closure')
  if (!isObj(e.digests) || Object.keys(e.digests).length > 2000) fail('bypass.execution_digests', 'digests malformed')
  for (const [p, d] of Object.entries(e.digests)) if (!relOk(p) || p.endsWith('/') || !inClosure(closure, p) || typeof d !== 'string' || !/^[0-9a-f]{64}$/.test(d)) fail('bypass.execution_digest', `digest entry invalid: ${p.slice(0, 60)}`)
  return Object.freeze({ id: e.id, entrypoint: e.entrypoint, interpreter: e.interpreter, subcommands: Object.freeze([...e.subcommands]), options: Object.freeze([...e.options]), closure, digests: Object.freeze({ ...e.digests }), reviewed_source: e.reviewed_source ?? null })
}

/** Throws ScopeError unless `doc` is a well-formed scopes file within the ceiling. Returns a frozen, compiled copy. */
export function validateBypassScopes(doc, contract) {
  if (!isObj(doc) || doc.version !== 1) fail('bypass.scopes_version', 'scopes file missing or unsupported version')
  if (!isObj(doc.owner_decision) || typeof doc.owner_decision.date !== 'string' || typeof doc.owner_decision.summary !== 'string') fail('bypass.owner_decision', 'owner_decision missing')
  const enabled = doc.routine?.enabled_actions
  if (!Array.isArray(enabled) || new Set(enabled).size !== enabled.length) fail('bypass.routine', 'routine.enabled_actions malformed')
  for (const a of enabled) if (!ROUTINE_ACTIONS.includes(a)) fail('bypass.routine_ceiling', `routine action ${String(a).slice(0, 60)} is not in the ceiling`)
  if (!Array.isArray(doc.scopes) || doc.scopes.length > 8) fail('bypass.scopes', 'scopes malformed')
  const ids = new Set(); const branches = new Set()
  const scopes = doc.scopes.map((s) => {
    if (!isObj(s)) fail('bypass.scope', 'scope is not an object')
    if (Object.keys(s).some((k) => !['id', 'description', 'branch', 'worktree', 'writable_protected_paths', 'excluded_paths', 'trusted_executions', '$comment'].includes(k))) fail('bypass.scope_keys', 'scope has unknown fields')
    // Bound to ONE checkout as well as its branch, so retargeting HEAD in another worktree (or by code) cannot activate the scope there.
    if (typeof s.worktree !== 'string' || !/^([A-Za-z]:)?\/[^*?"<>|]{1,250}$/.test(s.worktree) || s.worktree.split('/').includes('..')) fail('bypass.scope_worktree', `scope ${s.id} needs an absolute forward-slash worktree path`)
    if (typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(s.id) || ids.has(s.id)) fail('bypass.scope_id', 'scope id invalid or duplicate')
    ids.add(s.id)
    if (!branchOk(s.branch) || branches.has(s.branch)) fail('bypass.scope_branch', `scope ${s.id} branch invalid, protected, reserved or duplicate`)
    branches.add(s.branch)
    const writable = s.writable_protected_paths ?? []
    const excluded = s.excluded_paths ?? []
    if (!Array.isArray(writable) || writable.length > 32 || !Array.isArray(excluded) || excluded.length > 64) fail('bypass.scope_paths', 'scope path lists malformed')
    for (const x of excluded) if (typeof x !== 'string' || !/^[A-Za-z0-9._\-/*]{1,200}$/.test(x)) fail('bypass.scope_excluded', 'excluded path invalid')
    const execIds = new Set()
    const executions = s.trusted_executions ?? []
    if (!Array.isArray(executions) || executions.length > 4) fail('bypass.scope_executions', 'trusted_executions malformed')
    return Object.freeze({ id: s.id, branch: s.branch, worktree: s.worktree, writable: writable.map((g) => validWritableGlob(g, contract)), excluded: excluded.map(globToRegExp),
      trusted_executions: Object.freeze(executions.map((e) => validExecution(e, execIds))) })
  })
  // Every privileged file belongs to exactly one execution, so which scope owns it never depends on declaration order.
  const includes = scopes.flatMap((s) => s.trusted_executions.flatMap((e) => e.closure.include.map((i) => ({ owner: `${s.id}/${e.id}`, path: lc(i) }))))
  for (const a of includes) {
    for (const b of includes) {
      if (a.owner !== b.owner && (a.path === b.path || (a.path.endsWith('/') && b.path.startsWith(a.path)))) fail('bypass.execution_closure_overlap', `privileged closures of ${a.owner} and ${b.owner} overlap`)
    }
  }
  return Object.freeze({ valid: true, owner_decision: Object.freeze({ ...doc.owner_decision }), enabled: new Set(enabled), scopes: Object.freeze(scopes) })
}

export function loadBypassScopes(file, contract) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { throw new ScopeError('bypass.scopes_missing', 'bypass scopes file could not be read') }
  let doc
  try { doc = JSON.parse(text) } catch { throw new ScopeError('bypass.scopes_corrupt', 'bypass scopes file is not valid JSON') }
  return validateBypassScopes(doc, contract)
}

/** Which privileged closure (if any) `rel` belongs to. Used by the classifier in every mode; an invalid scopes object matches nothing. */
export function privilegedMatch(scopes, rel) {
  if (!scopes?.valid || typeof rel !== 'string') return null
  for (const s of scopes.scopes) {
    for (const e of s.trusted_executions) if (inClosure(e.closure, rel)) return { scope: s.id, execution: e.id, entrypoint: lc(rel) === lc(e.entrypoint) }
  }
  return null
}

// ── Authorization ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const no = (code, detail, finding) => ({ ok: false, code, detail, finding })
const YES = { ok: true }

/**
 * Decide an owner-launched bypass call. `findings` contains no forbidden finding (the engine denies those first).
 * @returns {{ ok: true, reason: string } | { ok: false, code: string, detail: string, finding?: object }}
 */
export function authorizeBypass(findings, ctx, event) {
  const scopes = ctx.bypassScopes
  if (!scopes?.valid) return no('bypass.authorization_unavailable', `bypass authorization is unavailable (${scopes?.error ?? 'scopes file not loaded'}); failing closed`)
  const branch = ctx.projectGitState?.branch
  if (!branchOk(branch)) return no('bypass.not_dedicated_branch', `the session's project root is not on a dedicated feature branch (${String(branch ?? 'unknown').slice(0, 60)})`)
  const root = normAbs(ctx.projectRootReal ?? ctx.projectRoot ?? '')
  const active = scopes.scopes.find((x) => x.branch === branch && normAbs(x.worktree) === root) ?? null
  const s = { branch, active, scopes, event, temp: [...(ctx.tempRoots ?? []), event?.scratchpad_dir].filter(Boolean) }
  const authorized = []
  for (const f of findings) {
    const cls = ctx.contract.actions[f.action]
    if (cls === 'allowed') {
      const v = checkAllowed(f, s, ctx)
      if (!v.ok) return { ...v, finding: f }
      continue
    }
    const entry = CEILING[f.action]
    if (!entry || !entry.codes.includes(f.code)) {
      const why = f.action === 'run_privileged_infrastructure' ? 'privileged infrastructure runs only through its pinned entrypoint' : `${f.action} (${f.code}) is outside the bypass ceiling`
      return no('bypass.not_authorized', why, f)
    }
    if (!entry.scoped && !scopes.enabled.has(f.action)) return no('bypass.routine_disabled', `${f.action} is not enabled for routine bypass sessions`, f)
    if (entry.scoped && !s.active) return no('bypass.no_active_scope', `${f.action} needs an owner-declared scope for branch ${branch}`, f)
    let v
    try { v = entry.check(f, s, ctx) } catch { v = no('bypass.check_failed', 'authorization check failed internally') }
    if (!v.ok) return { ...v, finding: f }
    authorized.push(`${f.action}/${f.code}`)
  }
  return { ok: true, reason: `bypass-authorized on ${branch}${s.active ? ` (scope ${s.active.id})` : ''}: ${authorized.join(', ') || 'allowed'}` }
}

const normAbs = (p) => lc(normalizeSlashes(String(p))).replace(/\/+$/, '')
const isUnder = (abs, root) => { const a = normAbs(abs); const r = normAbs(root); return a === r || a.startsWith(`${r}/`) }
const inProject = (ctx, p) => { try { return typeof p === 'string' && ctx.pathPolicy.repoRelative(ctx.pathPolicy.resolve(p)) !== null } catch { return false } }
const sameBranch = (ctx, cwd, branch) => { try { return ctx.gitState?.(cwd)?.branch === branch } catch { return false } }

function checkPush(f, s, ctx) {
  const m = f.meta
  if (!m || !inProject(ctx, m.cwd) || !sameBranch(ctx, m.cwd, s.branch)) return no('bypass.push_outside_worktree', 'push must run in the session worktree on its own branch')
  if (m.remote !== null && m.remote !== 'origin') return no('bypass.push_remote', `push remote must be origin (got ${String(m.remote).slice(0, 40)})`)
  if (!m.destinations?.length || !m.destinations.every((d) => d === s.branch)) return no('bypass.push_other_branch', `push may update only the session branch ${s.branch}`)
  return YES
}

const PR_FLAGS = {
  'gh.pr_create_draft': ['-d', '--draft', '-t', '--title', '-b', '--body', '-F', '--body-file', '-l', '--label', '-a', '--assignee', '-r', '--reviewer', '-f', '--fill', '--fill-first', '--fill-verbose', '--dry-run', '-B', '--base'],
  'gh.pr_edit': ['-t', '--title', '-b', '--body', '-F', '--body-file', '--add-label', '--remove-label', '--add-reviewer', '--remove-reviewer', '--add-assignee', '--remove-assignee'],
  'gh.pr_comment': ['-b', '--body', '-F', '--body-file', '--edit-last', '--create-if-none'],
}
function checkPr(f, s, ctx) {
  const m = f.meta
  if (!m || m.dynamic || !m.implicitTarget) return no('bypass.pr_target', 'only the current branch\'s own PR in this repository (no PR selector, no --repo) may be created or updated')
  if (m.envOverride) return no('bypass.pr_env_override', 'gh environment overrides (GH_REPO, GH_HOST, tokens) could retarget the PR')
  if (!inProject(ctx, m.cwd) || !sameBranch(ctx, m.cwd, s.branch)) return no('bypass.pr_outside_worktree', 'PR commands must run in the session worktree on its own branch')
  const allowedFlags = PR_FLAGS[f.code]
  for (const { flag, value } of m.flags) {
    if (!allowedFlags.includes(flag)) return no('bypass.pr_flag', `gh flag ${flag.slice(0, 30)} is not authorized in bypass`)
    if ((flag === '-B' || flag === '--base') && value !== 'main') return no('bypass.pr_base', 'a draft PR may only target main')
    // Text published to GitHub: inline bodies and body files must not carry credentials or reference credential files.
    let body = null
    if (['-b', '--body', '-t', '--title'].includes(flag)) body = value ?? ''
    if ((flag === '-F' || flag === '--body-file') && (value === '-' || value === null)) return no('bypass.pr_body_stdin', 'a PR body read from stdin cannot be inspected; write it to a file and pass --body-file <file>')
    if ((flag === '-F' || flag === '--body-file') && value !== '-') {
      let abs = null
      try { abs = ctx.pathPolicy.resolve(value, m.cwd) } catch { abs = null }
      body = abs ? ctx.readTextBounded?.(abs) : null
      if (typeof body !== 'string') return no('bypass.pr_body_unreadable', 'PR body file could not be inspected')
    }
    if (body !== null && SECRET_VALUE.test(body)) return no('bypass.pr_body_secret', 'PR text contains a credential-like value')
  }
  return YES
}

// `process.env` / `import.meta.env` / `os.environ` read the process environment; they are not references to a `.env` file.
const ENV_OBJECTS = /\b(process|import\.meta)\.env\b|\bos\.environ\b|\bDeno\.env\b|\bBun\.env\b/g
const forbiddenSignature = (text, ctx) => signatureFindings(String(text).replace(ENV_OBJECTS, 'ENV_OBJECT')).some((x) => ctx.contract.actions[x.action] === 'forbidden')

function checkInstall(f) {
  if (f.meta?.global === true) return no('bypass.install_global', 'global installs change the owner\'s environment outside the worktree')
  if (f.code === 'path.dependency_manifest' && !f.meta?.rel) return no('bypass.manifest_outside_worktree', 'dependency manifest outside the worktree')
  return YES
}

function checkScript(f, s, ctx) {
  if (f.code === 'python.module') {
    if (!PYTHON_MODULES.has(f.meta?.module)) return no('bypass.python_module', `python -m ${String(f.meta?.module ?? '').slice(0, 40)} is not on the bypass module list`)
    return (f.meta?.args ?? []).some((a) => POLICY_REFERENCE.test(a)) ? no('bypass.argument_references_policy', 'module arguments reference the policy or agent configuration') : YES
  }
  const m = f.meta
  if (!m?.abs) return no('bypass.script_unresolved', 'script path could not be resolved')
  const rel = m.rel === null ? null : lc(normalizeSlashes(m.rel))
  if (rel !== null && ctx.pathPolicy.protectedMatch(m.abs)) {
    const tool = POLICY_TOOLS[rel]
    return tool && !m.preFlags.length && tool(m.args) ? YES : no('bypass.protected_script', 'scripts under protected paths do not run in bypass (only the read-only V2 policy tools)')
  }
  if (rel === null && !s.temp.some((t) => isUnder(m.abs, t))) return no('bypass.script_outside_worktree', 'only scripts inside the session worktree or a temp directory run in bypass')
  if (m.args.some((a) => POLICY_REFERENCE.test(a))) return no('bypass.argument_references_policy', 'script arguments reference the policy or agent configuration')
  if (m.args.some((a) => forbiddenSignature(a, ctx))) return no('bypass.script_forbidden_signature', 'script arguments reference credentials or a protected effect')
  return scanScriptGraph(m.abs, ctx)
}

// Relative static imports/requires are followed (bounded) so a script cannot move a forbidden effect into a helper module. A computed
// import/require cannot be followed and is refused. Bare package imports (node_modules) are not followed (residual R-1/R-6).
const REL_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"`])(\.{1,2}\/[^'"`]+)\1/g
const COMPUTED_IMPORT = /\b(import|require)\s*\(\s*(?![\s'"`]*[\w@.\/-]+['"`]\s*\))/
const IMPORT_EXT = ['', '.mjs', '.js', '.cjs', '.ts', '.mts', '.cts', '.json', '/index.mjs', '/index.js']
function scanScriptGraph(entry, ctx) {
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(lc(file))) continue
    seen.add(lc(file))
    if (seen.size > 40) return no('bypass.script_graph_too_large', 'script imports too many local modules to inspect')
    const text = ctx.readTextBounded?.(file)
    if (typeof text !== 'string') return no(file === entry ? 'bypass.script_unreadable' : 'bypass.script_import_unreadable', 'script (or a module it imports) could not be inspected (missing, not a regular file, or over 1 MB)')
    if (POLICY_REFERENCE.test(text)) return no('bypass.script_references_policy', 'script content references the policy, agent configuration or git hooks')
    // The same protected-effect / credential signatures inline code gets (a script must not be a way around them).
    if (forbiddenSignature(text, ctx)) return no('bypass.script_forbidden_signature', 'script content references credentials or a protected effect')
    if (COMPUTED_IMPORT.test(text)) return no('bypass.script_computed_import', 'script loads a module from a computed path that cannot be inspected')
    if (/\.(m|c)?[jt]s$/i.test(file)) {
      const dir = normalizeSlashes(file).replace(/\/[^/]*$/, '')
      for (const m of text.matchAll(REL_IMPORT)) {
        let base
        try { base = ctx.pathPolicy.resolve(m[2], dir) } catch { return no('bypass.script_import_unreadable', 'an imported module path could not be resolved') }
        if (ctx.pathPolicy.repoRelative(base) === null) return no('bypass.script_import_outside', 'script imports a module outside the worktree')
        const hit = IMPORT_EXT.map((x) => base + x).find((c) => typeof ctx.readTextBounded?.(c) === 'string')
        if (!hit) return no('bypass.script_import_unreadable', 'an imported local module could not be inspected')
        queue.push(hit)
      }
    }
  }
  return YES
}

// Inline code is authorized only for the interpreters the classifier handles specifically (their -e/-c forms are recognized).
const INLINE_OK = new Set(['node', 'python', 'python3', 'py'])
function checkInline(f) {
  if (!INLINE_OK.has(f.meta?.exe)) return no('bypass.opaque_interpreter', `${String(f.meta?.exe ?? 'unknown').slice(0, 40)} inline code is not authorized in bypass`)
  return POLICY_REFERENCE.test(f.meta?.code ?? '') ? no('bypass.inline_references_policy', 'inline code references the policy, agent configuration or git hooks') : YES
}

function checkUnknownProgram(f) {
  if (f.code.startsWith('expo.')) return YES // local bundle export / native prebuild (mobile is the active surface)
  const m = f.meta
  if (!m || m.dynamic) return no('bypass.program_unverified', 'program or arguments are computed at runtime')
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(m.exe ?? '')) return no('bypass.program_unverified', 'the program name is not a plain command name')
  if (CREDENTIAL_TOOLS.has(m.exe)) return no('bypass.credential_tool', `${m.exe.slice(0, 40)} reads stored credentials`)
  if (NETWORK_PROBES.has(m.exe)) return no('bypass.network_probe', `${m.exe.slice(0, 40)} sends traffic off the host`)
  if (OPAQUE_INTERPRETERS.has(m.exe)) return no('bypass.opaque_interpreter', `${m.exe.slice(0, 40)} runs code the policy cannot inspect`)
  if (HOST_OR_OPAQUE.has(m.exe) || PS_MUTATING_VERB.test(m.exe)) return no('bypass.host_or_opaque_program', `${m.exe.slice(0, 40)} administers the host or writes paths the policy cannot see`)
  if (m.words.slice(1).some((w) => POLICY_REFERENCE.test(w))) return no('bypass.argument_references_policy', 'program arguments reference the policy or agent configuration')
  return YES
}

function checkScopedPath(f, s, ctx) {
  const rel = f.meta?.rel
  if (typeof rel !== 'string' || !rel) return no('bypass.path_unresolved', 'target path could not be resolved inside the worktree')
  const r = normalizeSlashes(rel)
  if (NEVER_RES.some((re) => re.test(r)) || (ctx.contract.protected_infrastructure ?? []).some((p) => lc(p) === lc(r))) return no('bypass.path_never_authorizable', `${r.slice(0, 80)} is policy, agent configuration or root-of-trust and is never bypass-authorized`)
  if (!s.active.writable.some((re) => re.test(r)) || s.active.excluded.some((re) => re.test(r))) return no('bypass.path_outside_scope', `${r.slice(0, 80)} is outside scope ${s.active.id}`)
  return YES
}

const ARG_OK = /^(--[a-z][a-z0-9-]{0,40}|[A-Za-z0-9_.:\\/@+-]{1,200})$/
function checkPinned(f, s, ctx) {
  const m = f.meta
  if (m?.scope !== s.active.id) return no('bypass.scope_not_active', `this infrastructure belongs to scope ${m?.scope}, not the active scope ${s.active.id}`)
  const e = s.active.trusted_executions.find((x) => x.id === m.execution)
  if (!e || lc(m.rel ?? '') !== lc(e.entrypoint)) return no('bypass.not_entrypoint', 'privileged infrastructure runs only through its pinned entrypoint')
  if (m.interpreter !== e.interpreter || m.preFlags.length || m.dynamicArgs) return no('bypass.entrypoint_form', `run it exactly as: ${e.interpreter} ${e.entrypoint} <subcommand> [--options]`)
  // Foreground only: a background run could load privileged files (lazy imports, PowerShell scripts) after later edits.
  const ev = s.event ?? {}
  if (!['Bash', 'PowerShell'].includes(ev.tool_name) || ev.tool_input?.run_in_background === true) return no('bypass.privileged_background', 'privileged infrastructure runs only as a foreground Bash/PowerShell command')
  if (!inProject(ctx, ev.cwd)) return no('bypass.privileged_cwd', 'privileged infrastructure runs only from the session worktree')
  // The command line must be exactly `node <entrypoint> <subcommand> [--option value]…` and nothing else: no `&`, `nohup`, `start`,
  // `Start-Process`, subshell, `cd …&&`, environment assignment (e.g. LOCALAPPDATA re-roots dh3) or second statement.
  const raw = String(ev.tool_input?.command ?? '')
  if (/[\r\n]/.test(raw.trim())) return no('bypass.privileged_form', 'the privileged command must be a single line on its own')
  const line = raw.trim()
  const entryRe = e.entrypoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!new RegExp(`^${e.interpreter}[ \\t]+(\\./)?${entryRe}([ \\t]+[A-Za-z0-9_.@+-]{1,200})*$`, 'i').test(line)) return no('bypass.privileged_form', `run it alone, as: ${e.interpreter} ${e.entrypoint} <subcommand> [--option value]`)
  if (normAbs(ev.cwd) !== normAbs(ctx.projectRootReal ?? ctx.projectRoot ?? '') && normAbs(ev.cwd) !== normAbs(ctx.projectRoot ?? '')) return no('bypass.privileged_cwd', 'privileged infrastructure runs only from the worktree root')
  if (!e.subcommands.includes(m.args[0])) return no('bypass.subcommand_not_authorized', `subcommand '${String(m.args[0] ?? '').slice(0, 40)}' is owner-only or unknown; authorized: ${e.subcommands.join(', ')}`)
  if (m.args.slice(1).some((a) => !ARG_OK.test(a) || POLICY_REFERENCE.test(a))) return no('bypass.entrypoint_arguments', 'entrypoint arguments must be plain --options and values')
  const opts = m.args.slice(1).filter((a) => a.startsWith('--')).map((a) => a.split('=')[0])
  const bad = opts.find((o) => !e.options.includes(o))
  if (bad) return no('bypass.entrypoint_option', `option ${bad.slice(0, 40)} is not authorized (e.g. --root would point the pinned code at an agent-writable runtime); authorized: ${e.options.join(', ')}`)
  let actual = null
  try { actual = ctx.digestTree?.(e.closure) ?? null } catch { actual = null }
  if (!actual) return no('bypass.pin_unverifiable', 'the privileged closure could not be digested (symlink, special file, size limit or read error)')
  const changed = [...new Set([...Object.keys(actual), ...Object.keys(e.digests)])].filter((p) => actual[p] !== e.digests[p]).sort()
  if (changed.length) {
    return no('bypass.pin_mismatch', `privileged code differs from the owner-pinned digests (${changed.length} file(s): ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ', …' : ''}); ` +
      `the owner reviews the change and refreshes the pins with ${PIN_TOOL}`)
  }
  return YES
}

/** Re-check of `allowed` findings that bypass would otherwise let replace checked-out policy files or un-ignore credentials. */
function checkAllowed(f, s, ctx) {
  const rel = normalizeSlashes(f.meta?.rel ?? '')
  if ((f.code === 'path.worktree' || f.code === 'path.temp') && /(^|\/)\.gitignore$/i.test(rel)) {
    return no('bypass.gitignore_edit', '.gitignore keeps credential files out of commits; editing it needs the owner')
  }
  // Root-of-trust files that V2 does not otherwise protect (V3's machine-readable contracts) stay owner-only in bypass.
  if (f.code === 'path.worktree' && rel && TRUST_ROOT_RES.some((re) => re.test(rel))) return no('bypass.path_never_authorizable', `${rel.slice(0, 80)} is root-of-trust and owner-only in bypass`)
  if (f.code === 'git.commit') return checkCommit(f, s, ctx)
  if (!TREE_CODES.has(f.code)) return YES
  const m = f.meta
  if (!m || m.dynamic) return no('bypass.tree_change_unverified', 'git command replacing checked-out files could not be verified')
  const sub = f.code.slice(4)
  const { pos, flags } = splitArgs(m.args, new Set(['-m', '--message', '-c', '--create', '-b']))
  const only = (allowed) => flags.every((x) => allowed.includes(x))
  // `--continue` concludes a merge/cherry-pick/revert with a commit that would skip checkCommit: finish it with `git commit` instead.
  const abortOnly = pos.length === 0 && flags.length === 1 && ['--abort', '--quit'].includes(flags[0])
  if (sub === 'merge') {
    if (abortOnly) return YES
    if (pos.length === 1 && pos[0] === 'origin/main' && only(['--ff-only', '--no-ff', '--ff', '--no-edit', '--no-stat', '-q', '--quiet', '-m', '--message'])) return YES
    return no('bypass.tree_change_untrusted_ref', 'in bypass, only origin/main may be merged into the session branch')
  }
  if (sub === 'pull') {
    if (pos.join(' ') === 'origin main' && only(['--ff-only', '--no-rebase', '--no-edit', '-q', '--quiet', '--ff', '--no-ff'])) return YES
    return no('bypass.tree_change_untrusted_ref', 'in bypass, only `git pull origin main` is accepted')
  }
  if ((sub === 'cherry-pick' || sub === 'revert' || sub === 'bisect') && abortOnly) return YES
  if (sub === 'checkout_new_branch' || sub === 'switch') {
    const createFlag = sub === 'switch' ? ['-c', '--create'] : ['-b']
    const v = newBranchArgs(m.args, createFlag)
    if (v && s.scopes.scopes.some((x) => lc(x.branch) === lc(v.name))) return no('bypass.scope_branch_name', 'a new branch may not take a scope branch name')
    if (v && (v.start === null || v.start === 'origin/main') && branchOk(v.name)) return YES
    return no('bypass.tree_change_untrusted_ref', 'in bypass, only a new branch from the current HEAD or origin/main may be created; switching to an existing branch would load its policy files')
  }
  return no('bypass.tree_change_untrusted_ref', `git ${sub} can replace checked-out policy files with another revision's; it needs the owner`)
}

// GitHub secret-scanning push protection is not enabled on the repository, so a bypass commit is checked locally: staging must be done
// with `git add` first (`-a`, `--include`, `--only` and pathspecs stage at commit time, after this check), the message must not carry a
// credential-like value, and every newly staged blob (bypass-git-index.mjs) must be free of credential-like values.
const COMMIT_VALUE_FLAGS = new Set(['-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message', '--author', '--date', '--fixup',
  '--squash', '-t', '--template', '--trailer', '--cleanup', '--pathspec-from-file'])
function checkCommit(f, s, ctx) {
  const m = f.meta
  if (!m) return no('bypass.commit_unverified', 'commit arguments could not be read')
  // The commit must be the ONLY command on the line: staging in the same command (`git add x && git commit`) would run after this
  // check. Its only permitted expansion is Claude Code's literal quoted heredoc, `-m "$(cat <<'EOF' … EOF)"`, which must end at its
  // first delimiter line and close immediately; any other `$`, backtick, separator, redirect or substitution is refused.
  const cmd = String(s.event?.tool_input?.command ?? '')
  // CR inside a heredoc ends it at different places in different shells; typographic quotes are live quotes in PowerShell.
  if (/[\r\u2018-\u201E]/.test(cmd)) return no('bypass.commit_unverified', 'commit command contains carriage returns or typographic quote characters')
  const rest = stripQuotedHeredocs(cmd)
  if (rest === null) return no('bypass.commit_unverified', 'malformed heredoc commit message (it must close right after its first delimiter line)')
  if (!commitAlone(rest)) {
    return no('bypass.commit_alone', 'in bypass run `git commit -m <message>` on its own (stage with `git add` in a separate command first); the message may only be a literal or a quoted heredoc')
  }
  if (SECRET_VALUE.test(cmd)) return no('bypass.commit_secret', 'commit message contains a credential-like value')
  if (m.dynamic && !(m.dynamicAt ?? []).every((i) => ['-m', '--message'].includes(m.args[i - 1]))) return no('bypass.commit_unverified', 'only the commit message may be computed')
  const messages = []
  for (let i = 0; i < m.args.length; i++) {
    const a = m.args[i]
    if (a === '--') return no('bypass.commit_stage_first', 'stage with `git add <paths>` first, then `git commit -m <message>`')
    const [flag, value] = a.includes('=') && a.startsWith('--') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null]
    if (/^-[A-Za-z]{2,}$/.test(flag)) {
      if (/[aio]/.test(flag.slice(1))) return no('bypass.commit_stage_first', 'stage with `git add <paths>` first, then `git commit -m <message>` (no -a)')
      if (/[mFCc]$/.test(flag)) { messages.push({ flag: `-${flag.at(-1)}`, value: m.args[++i] }) }
      continue
    }
    if (['-a', '--all', '-i', '--include', '-o', '--only', '--pathspec-from-file', '--interactive', '-p', '--patch'].includes(flag)) {
      return no('bypass.commit_stage_first', 'stage with `git add <paths>` first, then `git commit -m <message>`')
    }
    if (COMMIT_VALUE_FLAGS.has(flag)) { messages.push({ flag, value: value ?? m.args[++i] }); continue }
    if (flag.startsWith('-')) continue
    return no('bypass.commit_stage_first', 'commit pathspecs stage files at commit time; stage with `git add <paths>` first')
  }
  for (const { flag, value } of messages) {
    if (typeof value !== 'string') return no('bypass.commit_unverified', `${flag} needs a value`)
    if (['-F', '--file'].includes(flag)) {
      if (value === '-') return no('bypass.commit_unverified', 'a commit message from stdin cannot be inspected')
      let abs = null
      try { abs = ctx.pathPolicy.resolve(value, m.cwd) } catch { abs = null }
      const text = abs ? ctx.readTextBounded?.(abs) : null
      if (typeof text !== 'string') return no('bypass.commit_unverified', 'commit message file could not be inspected')
      if (SECRET_VALUE.test(text)) return no('bypass.commit_secret', 'commit message contains a credential-like value')
    } else if (SECRET_VALUE.test(value)) return no('bypass.commit_secret', 'commit message contains a credential-like value')
  }
  let scan
  try { scan = ctx.scanStagedBlobs?.() ?? null } catch { scan = null }
  if (!scan || !scan.ok) return no('bypass.commit_unverifiable', `staged content could not be inspected (${scan?.reason ?? 'scanner unavailable'})`)
  if (scan.hits.length) return no('bypass.commit_secret', `staged file(s) contain credential-like values: ${scan.hits.slice(0, 5).join(', ')}; unstage them (git restore --staged <path>)`)
  return YES
}

/** One `git commit …` command: outside quotes no separators/redirects/subshells/expansions; inside "…" no `$`, backtick or backslash. */
function commitAlone(text) {
  const t = text.trim()
  if (!/^git[ \t]+commit(\s|$)/.test(t)) return false
  let q = null
  for (const ch of t) {
    if (q === "'") { if (ch === "'") q = null; continue }
    if (q === '"') { if (ch === '"') q = null; else if ('$`\\'.includes(ch)) return false; continue }
    if (ch === "'" || ch === '"') { q = ch; continue }
    if (';&|<>()$`\\\r\n'.includes(ch)) return false
  }
  return q === null
}

/**
 * Replace each `$(cat <<'DELIM' … DELIM)` (quoted delimiter: a literal body) with a placeholder, ending each heredoc at its FIRST
 * delimiter line exactly as the shell does, and requiring `)` right after it. Returns null when a heredoc is malformed or smuggles a
 * command after its delimiter.
 */
export function stripQuotedHeredocs(cmd) {
  const START = /\$\(\s*cat\s+<<(-?)\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2[ \t]*\r?\n/g
  let out = ''
  let pos = 0
  for (let m = START.exec(cmd); m; m = START.exec(cmd)) {
    out += cmd.slice(pos, m.index)
    let i = START.lastIndex
    let closed = false
    while (i <= cmd.length) {
      const nl = cmd.indexOf('\n', i)
      const lineEnd = nl < 0 ? cmd.length : nl
      let line = cmd.slice(i, lineEnd).replace(/\r$/, '')
      if (m[1] === '-') line = line.replace(/^\t+/, '')
      if (line === m[3]) {
        const after = /^\s*\)/.exec(cmd.slice(nl < 0 ? cmd.length : nl + 1))
        if (!after) return null
        pos = (nl < 0 ? cmd.length : nl + 1) + after[0].length
        closed = true
        break
      }
      if (nl < 0) break
      i = nl + 1
    }
    if (!closed) return null
    out += 'HEREDOC_MESSAGE'
    START.lastIndex = pos
  }
  return out + cmd.slice(pos)
}

function splitArgs(args, withValue) {
  const pos = []; const flags = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') { pos.push(...args.slice(i + 1)); break }
    if (a.startsWith('-') && a.length > 1) {
      const flag = a.includes('=') ? a.slice(0, a.indexOf('=')) : a
      flags.push(flag)
      if (withValue.has(flag) && !a.includes('=')) i++
      continue
    }
    pos.push(a)
  }
  return { pos, flags }
}

/** `-b <name> [<start>]` (checkout) or `-c|--create <name> [<start>]` (switch), with nothing else. */
function newBranchArgs(args, createFlags) {
  const rest = args.filter((a) => a !== '--no-track')
  if (!createFlags.includes(rest[0]) || rest.length < 2 || rest.length > 3) return null
  if (rest.slice(1).some((a) => a.startsWith('-'))) return null
  return { name: rest[1], start: rest[2] ?? null }
}
