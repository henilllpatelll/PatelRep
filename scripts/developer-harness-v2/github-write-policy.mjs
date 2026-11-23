// Developer Harness V2 — GitHub repository FILE writes (Phase 2 final remediation). Pure: never sends a request.
//
// Shared by the REST contents API (`gh api`, curl, httpie, Invoke-WebRequest …) and GitHub MCP file tools
// (push_files, create_or_update_file, delete_file). A remote file write must never carry LESS protection than the
// equivalent local Write/Edit: every target file goes through the same path policy (migrations, protected
// control-plane and agent-config paths, credential files, activation content), and the destination branch is
// checked against protected and reserved namespaces. The strictest finding wins (the engine takes the maximum).
//
// "Dedicated task branch" is VERIFIED, not assumed: it is the branch currently checked out in the session's
// worktree (injected git state), provided that branch is neither protected nor reserved, AND the repository is the
// contract's repository. Any other branch or repository is escalated to human approval; a missing branch means the
// default branch (forbidden); an ambiguous, encoded or computed destination is forbidden.
import { F, PROTECTED_BRANCHES, RESERVED_BRANCH_PREFIXES, contentEffectFindings } from './policy-common.mjs'
import { globToRegExp } from './path-policy.mjs'

const W = (action, code, detail) => F(action, `github_write.${code}`, detail)
const unverifiable = (detail) => W('run_unclassifiable_shell_input', 'unverifiable_destination', `${detail}; a repository file write whose destination cannot be verified is denied`)

/**
 * A remote repository file path is accepted only in plain canonical form: relative, `/`-separated, no empty, `.` or
 * `..` segments, no percent-encoding, backslashes, control characters or surrounding whitespace. Anything else could
 * be normalized by GitHub into a different (protected) file than the one classified, so it fails closed.
 */
export function canonicalRepoPath(p) {
  if (typeof p !== 'string' || !p || p.length > 1024) return null
  if (p !== p.trim() || !/^[\x21-\x7e ]+$/.test(p) || /[%\\]/.test(p) || p.startsWith('/') || p.endsWith('/')) return null // printable ASCII only
  if (p.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return null
  return p
}

/** A branch name in plain form (optional `refs/heads/`), or null when it is malformed, encoded or ambiguous. */
export function canonicalBranch(b) {
  if (typeof b !== 'string') return null
  const name = b.replace(/^refs\/heads\//, '')
  if (!name || name.length > 255 || name !== name.trim() || /^refs\//i.test(name)) return null
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || /\.\.|\/\/|^[-/.]|[/.]$|\.lock(\/|$)|@\{/.test(name)) return null
  // A short name whose first segment is a ref namespace (`heads/main`, `tags/v1`) could be resolved by the server as
  // `refs/heads/main` instead of a branch literally named `heads/main`: reject it.
  if (/^(heads|tags|remotes|refs|pull)\//i.test(name) || /^HEAD$/i.test(name)) return null
  return name
}

const isProtectedBranch = (b) => PROTECTED_BRANCHES.has(b.toLowerCase())
const isReservedBranch = (b) => RESERVED_BRANCH_PREFIXES.some((p) => b.toLowerCase().startsWith(p))

/** The verified task branch: the branch checked out in the session worktree, if it is a dedicated (non-protected, non-reserved) branch. */
function verifiedTaskBranch(ctx) {
  let git = null
  try { git = ctx?.gitState?.(ctx.cwd) ?? null } catch { git = null }
  const branch = canonicalBranch(git?.branch ?? '')
  if (!branch || branch === 'HEAD' || isProtectedBranch(branch) || isReservedBranch(branch)) return null
  return branch
}

const contractRepo = (ctx) => String(ctx?.contract?.baseline?.repository ?? '').toLowerCase()

/** Destination findings for (repository, branch). `branch` undefined/null means "not given" → GitHub's default branch. */
function destinationFindings({ owner, repo, branch, branchCount = 1 }, ctx) {
  if (branchCount > 1) return [unverifiable('duplicated branch field')]
  if (branch === undefined || branch === null) {
    return [W('push_to_protected_main', 'default_branch', 'repository file write without a branch targets the default (protected) branch')]
  }
  const name = canonicalBranch(branch)
  if (!name) return [unverifiable('malformed, encoded or non-branch destination ref')]
  if (isProtectedBranch(name)) return [W('push_to_protected_main', 'protected_branch', `repository file write to protected branch ${name.toLowerCase()}`)]
  if (isReservedBranch(name)) return [W('create_alternate_publishing_or_deployment_path', 'reserved_branch', 'branch namespace reserved for trusted publishers / recovery automation')]
  const out = []
  const target = typeof owner === 'string' && typeof repo === 'string' ? `${owner}/${repo}`.toLowerCase() : null
  if (!target || !contractRepo(ctx) || target !== contractRepo(ctx)) {
    out.push(W('edit_outside_task_worktree', 'other_repository', 'repository file write to a repository other than the contract repository (or an unverifiable one)'))
  }
  const task = verifiedTaskBranch(ctx)
  if (!task || name !== task) {
    out.push(W('edit_outside_task_worktree', 'unverified_branch', task
      ? `repository file write to branch ${name.slice(0, 60)}, which is not the session's dedicated task branch`
      : 'repository file write, but the session has no verifiable dedicated task branch (detached, protected or reserved checkout)'))
  }
  if (!out.length) out.push(W('push_dedicated_branch_fast_forward', 'task_branch', 'repository file write to the verified dedicated task branch'))
  return out
}

const PROSE_OR_POLICY = /\.md$|^docs\/|^scripts\/developer-harness-v2\//i

/** Path findings for one remote file, through the SAME path policy as a local Write/Edit of that repository path. */
function fileFindings({ path, op, existing, content }, ctx, { migrationsAlwaysExisting }) {
  const rel = canonicalRepoPath(path)
  if (!rel) return [unverifiable('ambiguous, encoded, traversing or missing repository file path')]
  const pp = ctx?.pathPolicy
  if (!pp || typeof ctx?.projectRoot !== 'string') return [unverifiable('path policy unavailable')]
  const abs = `${String(ctx.projectRoot).replace(/\\/g, '/').replace(/\/$/, '')}/${rel}`
  const out = []
  const isMigration = /^supabase\/migrations\/[^/]+/i.test(rel)
  if (isMigration && (op === 'delete' || existing || migrationsAlwaysExisting)) {
    out.push(W('modify_existing_migration', 'existing_migration', 'existing migrations are immutable (remote write could overwrite or delete one)'))
  }
  const mode = op === 'delete' ? 'delete' : existing ? 'edit' : 'write'
  out.push(pp.classifyWrite(abs, { cwd: ctx.projectRoot, mode, content: typeof content === 'string' ? content : undefined }))
  // The remote path itself (not only its local resolution) is matched against the protected globs: a local
  // worktree alias such as `.claude/worktrees/<n>/…` must not hide a protected remote file.
  const hit = (ctx.contract?.protected_paths ?? []).find((g) => globToRegExp(g).test(rel)) ?? (/(^|\/)(claude|agents)\.md$/i.test(rel) ? '**/CLAUDE.md' : null)
  if (hit) {
    out.push(/^(\.claude\/|\.wolf\/hooks\/|\.mcp\.json$)|(^|\/)(claude|agents)\.md$/i.test(rel)
      ? W('modify_agent_instructions_or_hooks', 'protected_agent_config', `protected agent instructions/hooks (${hit})`)
      : W('modify_control_plane_files', 'protected_control_plane', `protected control-plane path (${hit})`))
  }
  if (typeof content === 'string' && !PROSE_OR_POLICY.test(rel)) out.push(...contentEffectFindings(content))
  return out
}

/**
 * Findings for a set of repository file operations to one (repository, branch). Every file is evaluated; the engine
 * keeps the strictest. `files` = [{ path, op: 'write'|'delete', existing?: boolean, content?: string }].
 * `migrationsAlwaysExisting`: the caller cannot prove a migration path is new (e.g. tree pushes that overwrite
 * without a sha precondition), so any migration target is treated as an existing one.
 */
export function classifyRepoFileWrites({ owner, repo, branch, branchCount, files, migrationsAlwaysExisting = false }, ctx) {
  if (!Array.isArray(files) || !files.length) return [unverifiable('no verifiable file list')]
  const out = [...destinationFindings({ owner, repo, branch, branchCount }, ctx)]
  for (const f of files) out.push(...fileFindings(f && typeof f === 'object' ? f : {}, ctx, { migrationsAlwaysExisting }))
  return out
}

/** Decode a base64 `content` field (REST contents API) for content checks; undefined when it is not clean base64. */
export function decodeBase64Content(v) {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/\s+/g, '')
  if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return undefined
  try { return Buffer.from(s, 'base64').toString('utf8') } catch { return undefined }
}
