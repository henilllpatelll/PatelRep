#!/usr/bin/env node
// Developer Harness V2 — blocking PreToolUse policy hook (Phase 2).
//
// Invoked through local-hook.mjs (`local-hook.mjs policy`) for Bash, PowerShell, Read, Write, Edit, MultiEdit,
// NotebookEdit, Grep and remote-capable MCP tools. All decisions come from the pure policy engine in
// scripts/developer-harness-v2/policy-engine.mjs; this file only gathers non-secret local facts
// (file existence, package.json scripts, the current git branch/upstream) and speaks the hook protocol:
//
//   allowed          → exit 0, no output (Claude Code's normal permission flow continues)
//   task_authorized  → exit 0 + {"hookSpecificOutput":{"permissionDecision":"ask",…}}
//   human_approval   → same as task_authorized ("deny" in dontAsk/auto modes)
//   bypassPermissions (owner-launched) → never "ask": a call bypass-authorization.mjs authorizes exits 0 with no output; any other
//                      non-allowed call exits 2 (deterministic scope in docs/developer-harness-v2/bypass-scopes.json)
//   forbidden        → exit 2, reason on stderr (blocks even when an allow rule matches)
//   any failure      → exit 2 (the settings entry also sets onFailure: "block" for crashes/timeouts)
//
// It never runs the proposed command, never contacts a network service and never reads credential files. For bypass sessions it also
// reads the protected scopes file, the project root's branch, digests of owner-pinned privileged code and (bounded) script contents.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HOOK_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HOOK_DIR, '..', '..')
const MAX_INPUT_BYTES = 5 * 1024 * 1024

export async function runPolicyHook(rawInput, { repoRoot = REPO_ROOT, env = process.env } = {}) {
  const deny = (reason) => ({ exitCode: 2, stdout: '', stderr: `${reason}\n` })
  let engine
  try {
    engine = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'developer-harness-v2', 'policy-engine.mjs')).href)
  } catch {
    return deny('Developer Harness V2 policy engine could not be loaded; denying (engine.load_failed).')
  }
  if (typeof rawInput !== 'string' || Buffer.byteLength(rawInput) > MAX_INPUT_BYTES) return deny('Developer Harness V2 policy: tool event missing or too large; denying (event.size).')
  let event
  try { event = JSON.parse(rawInput) } catch { return deny('Developer Harness V2 policy: tool event is not valid JSON; denying (event.invalid_json).') }
  let contract
  try { contract = engine.loadContract(path.join(repoRoot, 'docs', 'developer-harness-v2', 'contract.json')) } catch (error) {
    return deny(`Developer Harness V2 policy: contract unavailable or invalid; denying (${error?.code ?? 'contract.error'}).`)
  }
  // V2 permission transition: a missing or invalid scopes file never breaks other modes; in bypass it denies (fail closed).
  let bypassScopes
  try { bypassScopes = engine.loadBypassScopes(path.join(repoRoot, ...engine.SCOPES_FILE.split('/')), contract) } catch (error) {
    bypassScopes = { valid: false, error: typeof error?.code === 'string' ? error.code : 'bypass.scopes_error' }
  }
  let digest = null
  try { digest = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'developer-harness-v2', 'bypass-digest.mjs')).href) } catch { digest = null }
  let projectGitState
  try { projectGitState = readGitState(repoRoot) } catch { projectGitState = { branch: null, upstreamBranch: null, hasUpstream: null } }
  const ctx = {
    contract,
    bypassScopes,
    projectGitState,
    projectRootReal: canonicalize(repoRoot), // scope activation compares this with the scope's declared worktree
    digestTree: digest ? (closure) => digest.digestTree(repoRoot, closure) : null,
    readTextBounded,
    projectRoot: repoRoot,
    homeDir: os.homedir(),
    tempRoots: [os.tmpdir(), env.TEMP, env.TMP, env.TMPDIR].filter(Boolean),
    platform: process.platform,
    pathExists: (p) => existsSync(toNative(p)),
    canonicalize,
    readPackageScripts,
    resolveWorkspace,
    gitState: readGitState,
  }
  const result = engine.evaluateToolEvent(event, ctx)
  if (result.decision === 'no_objection') return { exitCode: 0, stdout: '', stderr: '' }
  if (result.decision === 'ask') {
    const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: result.reason } }
    return { exitCode: 0, stdout: `${JSON.stringify(out)}\n`, stderr: '' }
  }
  return deny(result.reason)
}

/** Git Bash style /c/Users/... → C:/Users/... on Windows. */
function toNative(p) {
  return process.platform === 'win32' && /^\/[a-zA-Z]\//.test(p) ? `${p[1]}:${p.slice(2)}` : p
}

/**
 * Real path of the nearest existing ancestor plus the not-yet-existing remainder. Expands Windows 8.3 short names
 * (`CLAUDE~1` → `.claude`), symlinks and junctions so they cannot alias protected or credential paths.
 */
function canonicalize(p) {
  let current = path.resolve(toNative(p))
  const rest = []
  for (let i = 0; i < 256; i++) {
    try {
      const real = realpathSync.native(current)
      return path.join(real, ...rest).replace(/\\/g, '/')
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return p
      rest.unshift(path.basename(current))
      current = parent
    }
  }
  return p
}

/** UTF-8 text of a regular file of at most 1 MB, else null (bypass script-content tripwire). */
function readTextBounded(p) {
  try {
    const file = toNative(p)
    const st = statSync(file)
    return st.isFile() && st.size <= 1024 * 1024 ? readFileSync(file, 'utf8') : null
  } catch { return null }
}

function readPackageScripts(dir) {
  const file = path.join(toNative(dir), 'package.json')
  if (!existsSync(file) || statSync(file).size > 1024 * 1024) return null
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const scripts = parsed && typeof parsed.scripts === 'object' && parsed.scripts ? parsed.scripts : {}
  return Object.fromEntries(Object.entries(scripts).filter(([, v]) => typeof v === 'string'))
}

function resolveWorkspace(name, root) {
  const direct = path.resolve(toNative(root), name)
  if (existsSync(path.join(direct, 'package.json'))) return direct
  for (const group of ['apps', 'packages']) {
    const base = path.join(toNative(root), group)
    if (!existsSync(base)) continue
    for (const entry of readdirSafe(base)) {
      const pkg = path.join(base, entry, 'package.json')
      try { if (JSON.parse(readFileSync(pkg, 'utf8')).name === name) return path.join(base, entry) } catch { /* not a package */ }
    }
  }
  return null
}

function readdirSafe(dir) {
  try { return statSync(dir).isDirectory() ? readdirSync(dir) : [] } catch { return [] }
}

/** Branch, upstream branch and whether the branch has an upstream, read from .git files (no subprocess). */
export function readGitState(cwd) {
  const unknown = { branch: null, upstreamBranch: null, hasUpstream: null }
  let dir = path.resolve(toNative(cwd))
  let gitPath = null
  for (let i = 0; i < 64; i++) {
    const candidate = path.join(dir, '.git')
    if (existsSync(candidate)) { gitPath = candidate; break }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (!gitPath) return unknown
  let gitDir = gitPath
  if (statSync(gitPath).isFile()) {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, 'utf8'))
    if (!m) return unknown
    gitDir = path.resolve(dir, m[1].trim())
  }
  const head = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
  if (!ref) return { branch: 'HEAD', upstreamBranch: null, hasUpstream: null }
  const branch = ref[1]
  let commonDir = gitDir
  const commonFile = path.join(gitDir, 'commondir')
  if (existsSync(commonFile)) commonDir = path.resolve(gitDir, readFileSync(commonFile, 'utf8').trim())
  let upstreamBranch = null
  try {
    const config = readFileSync(path.join(commonDir, 'config'), 'utf8')
    const section = new RegExp(`\\[branch\\s+"${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\]([^[]*)`).exec(config)
    const merge = section && /^\s*merge\s*=\s*refs\/heads\/(.+?)\s*$/m.exec(section[1])
    if (merge) upstreamBranch = merge[1]
  } catch { return { branch, upstreamBranch: null, hasUpstream: null } }
  let remoteRef = existsSync(path.join(commonDir, 'refs', 'remotes', 'origin', ...branch.split('/')))
  if (!remoteRef) {
    try { remoteRef = readFileSync(path.join(commonDir, 'packed-refs'), 'utf8').includes(` refs/remotes/origin/${branch}\n`) } catch { /* no packed refs */ }
  }
  return { branch, upstreamBranch, hasUpstream: Boolean(upstreamBranch) || remoteRef }
}

async function readStdin(stream) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > MAX_INPUT_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Entry point used by local-hook.mjs. Writes the protocol response and returns the exit code. */
export async function main({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  let response
  try {
    response = await runPolicyHook(await readStdin(stdin))
  } catch {
    response = { exitCode: 2, stdout: '', stderr: 'Developer Harness V2 policy hook failed internally; denying (hook.internal_error).\n' }
  }
  if (response.stdout) stdout.write(response.stdout)
  if (response.stderr) stderr.write(response.stderr)
  return response.exitCode
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
