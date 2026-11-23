// Developer Harness V2 — git command policy (Phase 2).
//
// Destinations are classified from refspecs, and for bare `git push` from the local git state the hook reads
// from .git (branch + upstream). "Reviewed history" is approximated as "the branch has an upstream": rewriting
// a pushed branch (rebase/amend/pull --rebase) is forbidden, rewriting a never-pushed branch needs approval.
import { F, PROTECTED_BRANCHES, RESERVED_BRANCH_PREFIXES, positionals, hasFlag, splitFlag } from './policy-common.mjs'
import { operandFindings, destinationFindings } from './file-command-policy.mjs'

const lower = (w) => (w?.text ?? '').toLowerCase()
const SAFE_CONFIG_PREFIXES = ['color.', 'core.quotepath', 'core.autocrlf', 'core.safecrlf', 'core.longpaths', 'user.name', 'user.email',
  'advice.', 'log.', 'merge.conflictstyle', 'init.defaultbranch', 'pull.rebase', 'push.autosetupremote', 'column.', 'status.', 'format.pretty', 'i18n.']
const READ_ONLY = new Set(['status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'ls-files', 'ls-tree', 'ls-remote', 'cat-file', 'rev-list',
  'merge-base', 'describe', 'shortlog', 'grep', 'name-rev', 'for-each-ref', 'show-ref', 'check-ignore', 'check-attr', 'count-objects',
  'var', 'help', 'version', '--version', 'whatchanged', 'range-diff', 'cherry', 'verify-commit', 'verify-tag', 'fsck', 'annotate',
  'show-branch', 'diff-tree', 'diff-index', 'diff-files', 'format-patch', 'fetch', 'difftool', 'request-pull', 'archive', 'bundle'])
const LOCAL_ALLOWED = new Set(['add', 'apply', 'cherry-pick', 'revert', 'merge', 'switch', 'mv', 'rm', 'am', 'pull', 'bisect', 'mergetool', 'stage', 'notes'])

export function gitHandler(env) {
  const { words, findings, ctx, state } = env
  const push = (a, c, d) => findings.push(F(a, c, d))
  let cwd = state.cwd // null after a computed `cd`: git state is then unknown (stricter)
  let i = 1
  // Global options before the subcommand.
  while (i < words.length && words[i].text.startsWith('-')) {
    const [flag, inline] = splitFlag(words[i].text)
    const takeValue = () => inline ?? words[++i]?.text ?? ''
    if (flag === '-c' || flag.startsWith('-c') && flag.length > 2) {
      const kv = flag === '-c' ? takeValue() : flag.slice(2)
      const key = kv.split('=')[0].toLowerCase()
      if (key === 'core.hookspath') push('bypass_git_hooks_or_ci', 'git.hookspath_override', 'overriding core.hooksPath disables git hooks')
      else if (!SAFE_CONFIG_PREFIXES.some((p) => key.startsWith(p))) push('modify_git_configuration_or_remotes', 'git.config_override', `git -c ${key.slice(0, 40)} can change command behavior`)
    } else if (flag === '-C') {
      const dir = takeValue()
      cwd = ctx.pathPolicy.unknownCwd(dir, cwd) ? null : ctx.pathPolicy.resolve(dir, cwd)
    } else if (['--git-dir', '--work-tree', '--exec-path', '--namespace', '--config-env', '--super-prefix'].includes(flag)) {
      const value = takeValue()
      if (/hookspath/i.test(value)) push('bypass_git_hooks_or_ci', 'git.hookspath_override', 'overriding core.hooksPath disables git hooks')
      else push('modify_git_configuration_or_remotes', 'git.alternate_repository', `${flag} redirects git to another repository or executable path`)
    }
    i++
  }
  const sub = lower(words[i])
  // git accepts any unambiguous prefix of a long option (`--no-verif`, `--force-w`); expand them first.
  const args = words.slice(i + 1).map((w) => ({ ...w, text: expandLongOption(w.text) }))
  if (args.some((w) => splitFlag(w.text)[0] === '--no-verify') || (sub === 'commit' && args.some((w) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w.text) && !w.text.startsWith('--')))) {
    return push('bypass_git_hooks_or_ci', 'git.no_verify', '--no-verify bypasses git hooks')
  }
  const git = () => (cwd === null || state.branchMayHaveChanged ? { branch: null, upstreamBranch: null, hasUpstream: null } : readGitState(ctx, cwd))
  // Options that write a file or run an external program, on otherwise read-only subcommands.
  for (let j = 0; j < args.length; j++) {
    const [flag, value] = splitFlag(args[j].text)
    if (['--output', '-o', '--output-directory'].includes(flag) && ['diff', 'log', 'show', 'format-patch', 'archive', 'whatchanged', 'range-diff', 'diff-tree', 'bundle', 'shortlog'].includes(sub)) {
      const target = value ?? args[j + 1]?.text
      if (target) findings.push(ctx.pathPolicy.classifyWrite(target, { cwd, mode: 'write' }))
      else push('edit_outside_task_worktree', 'git.output_unknown', 'git output target unknown')
    }
    if (['--upload-pack', '-u', '--receive-pack', '--exec', '--extcmd', '-x', '--open-files-in-pager', '-O', '--tool', '--remote'].includes(flag) && sub !== 'push' && sub !== 'commit') {
      if ((flag === '-u' && sub !== 'fetch' && sub !== 'ls-remote' && sub !== 'clone') || (flag === '--remote' && sub !== 'archive') || (flag === '-x' && sub !== 'difftool') || (flag === '-O' && sub !== 'grep')) continue
      push('run_unrecognized_command', 'git.external_program', `git ${sub} ${flag} runs an external program`)
    }
    if (/^-O./.test(args[j].text) && sub === 'grep') push('run_unrecognized_command', 'git.external_program', 'git grep -O runs a pager program')
  }
  if (sub === 'checkout' || sub === 'switch' || sub === 'worktree') state.branchMayHaveChanged = true

  if (!sub) return push('read_repository', 'git.meta', 'git without a subcommand')
  if (sub === 'push') return gitPush(env, args, git)
  if (sub === 'commit') {
    if (hasFlag(args, '--amend')) return rewrite(env, git, 'git.commit_amend', 'amending rewrites a commit')
    const branch = git().branch
    if (branch && PROTECTED_BRANCHES.has(branch.toLowerCase())) return push('discard_or_rewrite_local_work', 'git.commit_protected_branch', `committing on local ${branch}; use a dedicated branch`)
    return push('commit_to_dedicated_branch', 'git.commit', 'commit on a dedicated branch')
  }
  if (sub === 'rebase') {
    if (hasFlag(args, '--abort', '--quit', '--show-current-patch')) return push('read_repository', 'git.rebase_abort', 'abort/inspect an in-progress rebase')
    return rewrite(env, git, 'git.rebase', 'rebase rewrites history')
  }
  if (sub === 'pull' && hasFlag(args, '--rebase', '-r')) return rewrite(env, git, 'git.pull_rebase', 'pull --rebase rewrites history')
  if (['filter-branch', 'filter-repo', 'replace'].includes(sub)) return push('force_push_or_rewrite_reviewed_history', `git.${sub}`, 'history rewriting tools are forbidden')
  if (sub.startsWith('credential')) return push('read_production_or_publisher_credentials', 'git.credential', 'git credential helpers expose credentials')
  if (sub === 'fetch' && positionals(args).some((w) => w.text.includes(':'))) return push('manage_local_refs', 'git.fetch_refspec', 'fetch refspec updates local refs')
  if (sub === 'apply' || sub === 'am') {
    if (sub === 'apply' && hasFlag(args, '--check', '--stat', '--numstat', '--summary') && !hasFlag(args, '--index', '--cached', '--apply')) return push('read_repository', 'git.apply_check', 'inspects a patch')
    return push('run_unrecognized_command', `git.${sub}`, 'patch contents (which may touch protected paths) are not inspected')
  }
  if (READ_ONLY.has(sub)) return push('read_repository', `git.${sub}`, 'read-only git command')
  if (sub === 'add' || sub === 'stage') {
    if (hasFlag(args, '-f', '--force')) return push('discard_or_rewrite_local_work', 'git.add_force', 'force-adding ignored files can stage credentials')
    return push('commit_to_dedicated_branch', 'git.add', 'stage changes')
  }
  if (sub === 'mv' || sub === 'rm') return gitMoveRemove(env, args, sub, cwd)
  if (sub === 'checkout') {
    if (hasFlag(args, '-b', '-B', '--orphan', '-t', '--track')) return push('read_repository', 'git.checkout_new_branch', 'create and switch branch')
    const pos = positionals(args, 0, new Set(['--conflict', '--pathspec-from-file']))
    if (hasFlag(args, '-f', '--force', '--', '-p', '--patch', '--ours', '--theirs', '--pathspec-from-file') || args.some((w) => w.text === '--') || pos.length > 1 || pos.some((w) => w.text === '.')) {
      return push('discard_or_rewrite_local_work', 'git.checkout_paths', 'checking out paths discards local changes')
    }
    return push('read_repository', 'git.checkout_branch', 'switch branch')
  }
  if (sub === 'switch') return hasFlag(args, '-f', '--force', '--discard-changes') ? push('discard_or_rewrite_local_work', 'git.switch_force', 'discards local changes') : push('read_repository', 'git.switch', 'switch branch')
  if (sub === 'restore') return hasFlag(args, '--staged', '-S') && !hasFlag(args, '--worktree', '-W') ? push('read_repository', 'git.unstage', 'unstage') : push('discard_or_rewrite_local_work', 'git.restore', 'restoring files discards local changes')
  if (sub === 'reset') {
    const pos = positionals(args)
    const onlyPaths = args.some((w) => w.text === '--') || pos.length === 0 || (pos[0].text.toUpperCase() === 'HEAD' && !hasFlag(args, '--hard', '--keep', '--merge', '--soft'))
    if (!hasFlag(args, '--hard', '--keep', '--merge', '--soft', '--mixed') && onlyPaths) return push('read_repository', 'git.reset_index', 'unstage paths')
    return push('discard_or_rewrite_local_work', 'git.reset', 'reset moves the branch or discards changes')
  }
  if (sub === 'clean') return hasFlag(args, '-n', '--dry-run') ? push('read_repository', 'git.clean_dry_run', 'dry run') : push('discard_or_rewrite_local_work', 'git.clean', 'deletes untracked files')
  if (sub === 'stash') return ['list', 'show'].includes(lower(args[0])) ? push('read_repository', 'git.stash_read', 'stash inspection') : push('discard_or_rewrite_local_work', 'git.stash', 'stashing can hide or discard unrelated work')
  if (sub === 'branch') {
    if (hasFlag(args, '-d', '-D', '--delete', '-f', '--force', '-m', '-M', '--move', '-c', '-C', '--copy', '--set-upstream-to', '-u', '--unset-upstream', '--edit-description')) {
      return push('manage_local_refs', 'git.branch_mutation', 'deletes, moves or re-targets branches')
    }
    return push('read_repository', 'git.branch', 'list or create branch')
  }
  if (sub === 'tag') {
    if (args.length === 0 || hasFlag(args, '-l', '--list', '-n', '--contains', '--no-contains', '--points-at', '--merged', '--no-merged', '-v', '--verify')) return push('read_repository', 'git.tag_read', 'list tags')
    return push('manage_local_refs', 'git.tag_write', 'tags are release-governed')
  }
  if (sub === 'config') {
    let pos = positionals(args, 0, new Set(['--file', '-f', '--blob', '--type', '--default', '--value', '--comment']))
    // git >= 2.46 subcommand syntax: `git config set|unset|get|list|edit|rename-section|remove-section …`
    const verb = ['set', 'unset', 'get', 'list', 'edit', 'rename-section', 'remove-section'].includes(lower(pos[0])) ? lower(pos[0]) : null
    if (verb) pos = pos.slice(1)
    const key = (pos[0]?.text ?? '').toLowerCase()
    const writes = ['set', 'unset', 'edit', 'rename-section', 'remove-section'].includes(verb) ||
      hasFlag(args, '--unset', '--unset-all', '--add', '--replace-all', '--rename-section', '--remove-section', '-e', '--edit') || (!verb && pos.length >= 2)
    if (args.some((w) => /hookspath/i.test(w.text)) && writes) return push('bypass_git_hooks_or_ci', 'git.config_hookspath', 'changing core.hooksPath disables git hooks')
    if (!writes) return push('read_repository', 'git.config_read', 'reads git config')
    if (key === 'core.hookspath' || verb === 'edit' || hasFlag(args, '-e', '--edit')) return push('bypass_git_hooks_or_ci', 'git.config_hookspath', 'editing git config can disable git hooks')
    return push('modify_git_configuration_or_remotes', 'git.config_write', `writes git config (${key.slice(0, 40)})`)
  }
  if (sub === 'remote') {
    const action = lower(args.find((w) => !w.text.startsWith('-')))
    if (!action || ['show', 'get-url'].includes(action)) return push('read_repository', 'git.remote_read', 'list remotes')
    if (action === 'update') return push('read_repository', 'git.remote_update', 'fetch remotes')
    return push('modify_git_configuration_or_remotes', `git.remote_${action}`, 'changes git remotes')
  }
  if (sub === 'worktree') {
    const action = lower(args[0])
    if (action === 'list' || action === 'add') return push('read_repository', `git.worktree_${action}`, `worktree ${action}`)
    return push('manage_local_refs', `git.worktree_${action}`, 'removes or modifies worktrees')
  }
  if (['update-ref', 'symbolic-ref', 'reflog', 'gc', 'prune', 'pack-refs', 'repack', 'notes'].includes(sub)) {
    if (sub === 'reflog' && (!args.length || ['show', 'list', 'exists'].includes(lower(args[0])))) return push('read_repository', 'git.reflog', 'reads reflog')
    if (sub === 'symbolic-ref' && positionals(args).length < 2) return push('read_repository', 'git.symbolic_ref_read', 'reads a symbolic ref')
    if (sub === 'notes' && (!args.length || ['list', 'show'].includes(lower(args[0])))) return push('read_repository', 'git.notes_read', 'reads notes')
    return push('manage_local_refs', `git.${sub}`, 'rewrites local refs or object storage')
  }
  if (sub === 'bisect' && lower(args[0]) === 'run') {
    push('run_unrecognized_command', 'git.bisect_run', 'git bisect run executes a command repeatedly')
    findings.push(...env.recurse(args.slice(1).map((w) => JSON.stringify(w.text)).join(' ')))
    return
  }
  if (LOCAL_ALLOWED.has(sub)) return push('edit_files_in_task_worktree', `git.${sub}`, `local git ${sub}`)
  if (sub === 'clone' || sub === 'init' || sub === 'submodule' || sub === 'lfs' || sub === 'sparse-checkout') return push('run_unrecognized_command', `git.${sub}`, `git ${sub} needs human approval`)
  if (sub === 'hook') return push('run_unreviewed_script', 'git.hook', 'runs git hooks directly')
  push('run_unrecognized_command', 'git.unknown_subcommand', `unrecognized git subcommand '${sub.slice(0, 30)}' (may be an alias)`)
}

// Long options whose abbreviations must be recognized (git accepts any unambiguous prefix).
const SENSITIVE_LONG_OPTIONS = ['--no-verify', '--force', '--force-with-lease', '--force-if-includes', '--mirror', '--all', '--tags',
  '--follow-tags', '--prune', '--delete', '--receive-pack', '--exec', '--amend', '--upload-pack', '--output', '--output-directory',
  '--extcmd', '--open-files-in-pager', '--rebase', '--hard']

/** Expand an abbreviated long option (`--no-verif` → `--no-verify`); ambiguity resolves to the riskiest match. */
export function expandLongOption(text) {
  if (!text.startsWith('--') || text.length < 4) return text
  const [name, value] = splitFlag(text)
  if (SENSITIVE_LONG_OPTIONS.includes(name)) return text
  const match = SENSITIVE_LONG_OPTIONS.find((o) => o.startsWith(name))
  return match ? (value === null ? match : `${match}=${value}`) : text
}

/**
 * `git rm` / `git mv`: every operand is a pathspec relative to `cwd`. `args` already excludes the subcommand, so the
 * operands start at index 0 (the earlier `positionals(args)` default of 1 skipped the first target). Pathspec magic
 * (`:(top)`, `:/`, `:!`) is stripped and classified both from `cwd` and from the repository root; globs and directories
 * that contain protected paths are reached through operandFindings; `--pathspec-from-file` and computed pathspecs
 * cannot be resolved and need approval. Nothing is executed.
 */
function gitMoveRemove(env, args, sub, cwd) {
  const { findings, ctx } = env
  const push = (a, c, d) => findings.push(F(a, c, d))
  const recursive = args.some((w) => /^-[a-zA-Z]*r[a-zA-Z]*$/.test(w.text) && !w.text.startsWith('--'))
  if (recursive) push('discard_or_rewrite_local_work', 'git.rm_recursive', 'recursive removal')
  // Floor: the original per-operand pass (operands after the first, raw text) still runs, so this handler is never weaker than before.
  for (const w of positionals(args).slice(0, 512)) findings.push(ctx.pathPolicy.classifyWrite(w.text, { cwd, mode: sub === 'rm' ? 'delete' : 'move' }))
  if (args.some((w) => { const [n] = splitFlag(w.text); return n.startsWith('--pa') && n.length >= 4 && ('--pathspec-from-file'.startsWith(n) || '--pathspec-file-nul'.startsWith(n)) })) {
    push('run_unrecognized_command', 'git.pathspec_from_file', 'the pathspec list is read from a file and cannot be classified') // visible operands are still classified below
  }
  const operands = positionals(args, 0, new Set(['--pathspec-from-file']))
  if (!operands.length) return findings.some((f) => f.code === 'git.pathspec_from_file') ? undefined : push('run_unrecognized_command', 'git.pathspec_missing', `git ${sub} without a visible pathspec`)
  if (args.length > 512 || args.some((w) => w.text.length > 2048)) return push('run_unrecognized_command', 'git.operands_too_large', 'too many or too long pathspecs to classify')
  const roots = ctx.projectRoot ? [cwd, ctx.projectRoot] : [cwd]
  const specs = []
  for (const w of operands) {
    if (w.dynamic) { push('edit_outside_task_worktree', 'git.dynamic_pathspec', 'pathspec computed at runtime'); continue }
    const m = /^:(\([^)]*\)|[!^/]*):?([\s\S]*)$/.exec(w.text)
    if (!m) { specs.push({ ...w, spec: w.text, from: [cwd] }); continue }
    specs.push({ ...w, spec: m[2] === '' ? '.' : m[2], from: roots }) // magic: also resolve from the repository root (`:/`, `:(top)`)
    // attribute and exclude-only magic select by something other than the visible path: treat as the whole tree
    if (/attr|exclude|[!^]/i.test(m[1])) specs.push({ ...w, spec: '.', from: roots, whole: true })
  }
  const mode = sub === 'rm' ? 'delete' : 'move'
  const classify = (spec, from, extra) => findings.push(...operandFindings(env, spec, { cwd: from, mode, subtree: recursive || sub === 'mv', crossSlash: true, ...extra }))
  if (sub === 'mv' && specs.length >= 2 && specs.length === operands.length) {
    const dest = specs.at(-1)
    const sources = specs.slice(0, -1)
    for (const from of dest.from) {
      for (const s of sources) for (const f of s.from) classify(s.spec, f, s.whole ? { subtree: true } : undefined)
      findings.push(...destinationFindings(env, { sources: sources.map((s) => ({ ...s, text: s.spec })), dest: { ...dest, text: dest.spec }, mode: 'move', writeMode: 'move', recursive: true, cwd: from }))
    }
    return
  }
  for (const s of specs) for (const from of s.from) classify(s.spec, from, s.whole ? { subtree: true } : undefined)
}

function rewrite(env, git, code, detail) {
  const { hasUpstream } = git()
  if (hasUpstream === false) return env.findings.push(F('discard_or_rewrite_local_work', `${code}_local`, `${detail} (branch never pushed)`))
  env.findings.push(F('force_push_or_rewrite_reviewed_history', `${code}_pushed`, `${detail} on a pushed (possibly reviewed) branch`))
}

// git resolves unqualified destinations against the remote's refs, so `heads/main` also means refs/heads/main.
const normBranch = (ref) => ref.replace(/^\+/, '').replace(/^(refs\/)?heads\//i, '').toLowerCase()
const isProtected = (b) => PROTECTED_BRANCHES.has(normBranch(b))
const isReserved = (b) => RESERVED_BRANCH_PREFIXES.some((p) => normBranch(b).startsWith(p))

function gitPush(env, args, git) {
  const { findings } = env
  const push = (a, c, d) => findings.push(F(a, c, d))
  const valueFlags = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec', '--recurse-submodules', '--signed', '--force-with-lease'])
  for (const w of args) {
    const [flag] = splitFlag(w.text)
    if (!flag.startsWith('-')) continue
    if (/^--force(-with-lease|-if-includes)?$/.test(flag) || (/^-[a-zA-Z]+$/.test(flag) && flag.includes('f'))) return push('force_push_or_rewrite_reviewed_history', 'git.push_force', 'force-push is forbidden')
    if (['--mirror', '--all', '--branches'].includes(flag)) return push('push_to_protected_main', 'git.push_all', 'pushing all refs includes protected branches')
    if (['--tags', '--follow-tags'].includes(flag)) return push('dispatch_production_release_or_rollback', 'git.push_tags', 'tags are created only by the trusted release workflow')
    if (flag === '--prune') return push('force_push_or_rewrite_reviewed_history', 'git.push_prune', 'deletes remote branches')
    if (['--receive-pack', '--exec'].includes(flag)) return push('run_unclassifiable_shell_input', 'git.push_exec', 'custom receive-pack program')
    const KNOWN = ['-u', '--set-upstream', '-q', '--quiet', '-v', '--verbose', '--progress', '--no-progress', '--atomic', '--no-atomic', '-n', '--dry-run',
      '--porcelain', '--signed', '--no-signed', '-o', '--push-option', '--repo', '--thin', '--no-thin', '--recurse-submodules', '--no-recurse-submodules',
      '-4', '-6', '--ipv4', '--ipv6', '--delete', '-d']
    if (/^-[a-zA-Z0-9]{2,}$/.test(flag) && [...flag.slice(1)].every((c) => 'uqvndo46'.includes(c))) continue
    if (!KNOWN.includes(flag)) return push('run_unrecognized_command', 'git.push_unknown_option', `unrecognized push option ${flag.slice(0, 30)}`)
  }
  const deleting = args.some((w) => w.text === '--delete' || w.text === '-d')
  const pos = positionals(args, 0, valueFlags)
  if (pos.some((w) => w.dynamic)) return push('run_unrecognized_command', 'git.push_dynamic', 'push destination is computed at runtime')
  const [remote, ...refspecs] = pos
  if (remote && (/:\/\/|^[\w.-]+@|^[./\\]|^[a-z]:/i.test(remote.text))) push('network_request_or_remote_shell', 'git.push_other_remote', 'pushes to a non-configured remote URL')
  const destinations = []
  for (const r of refspecs) {
    const t = r.text
    if (t.startsWith('+')) return push('force_push_or_rewrite_reviewed_history', 'git.push_force_refspec', 'a + refspec force-pushes')
    const colon = t.lastIndexOf(':')
    const src = colon >= 0 ? t.slice(0, colon) : t
    let dst = colon >= 0 ? t.slice(colon + 1) : t
    if (/^refs\/tags\//i.test(dst) || /^refs\/tags\//i.test(src) && colon < 0) return push('dispatch_production_release_or_rollback', 'git.push_tag', 'tags are created only by the trusted release workflow')
    if (dst.toUpperCase() === 'HEAD' || dst === '') {
      if (dst === '' && colon >= 0) { destinations.push({ name: src, delete: true }); continue }
      const branch = git().branch
      if (!branch || branch === 'HEAD') return push('run_unrecognized_command', 'git.push_unresolved', 'the current branch could not be resolved')
      dst = branch
    }
    if (src === '' && colon >= 0) { destinations.push({ name: dst, delete: true }); continue }
    destinations.push({ name: dst, delete: deleting })
  }
  if (!refspecs.length) {
    const { branch, upstreamBranch } = git()
    if (!branch || branch === 'HEAD') return push('run_unrecognized_command', 'git.push_unresolved', 'the current branch or upstream could not be resolved')
    destinations.push({ name: branch, delete: deleting })
    if (upstreamBranch) destinations.push({ name: upstreamBranch, delete: deleting })
  }
  for (const d of destinations) {
    if (isProtected(d.name)) return push('push_to_protected_main', 'git.push_protected', `push to protected branch ${normBranch(d.name)}`)
    if (isReserved(d.name)) return push('create_alternate_publishing_or_deployment_path', 'git.push_reserved', 'branch namespace reserved for trusted publishers')
    if (/^refs\//i.test(d.name) && !/^refs\/heads\//i.test(d.name)) return push('run_unrecognized_command', 'git.push_nonbranch_ref', 'pushes a non-branch ref')
  }
  if (destinations.some((d) => d.delete)) return push('manage_local_refs', 'git.push_delete', 'deletes a remote branch')
  push('push_dedicated_branch_fast_forward', 'git.push', 'normal fast-forward push of a dedicated branch')
}

function readGitState(ctx, cwd) {
  try { return ctx.gitState?.(cwd) ?? { branch: null, upstreamBranch: null, hasUpstream: null } } catch { return { branch: null, upstreamBranch: null, hasUpstream: null } }
}
