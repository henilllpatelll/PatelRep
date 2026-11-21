// Developer Harness V2 — per-tool command handlers (Phase 2). Each handler appends findings to env.findings.
// Handlers are deliberately conservative: an unrecognized subcommand of a remote-capable CLI is forbidden,
// an unrecognized subcommand of a local CLI needs human approval.
import { F, PROTECTED_BRANCHES, RESERVED_BRANCH_PREFIXES, positionals, hasFlag, flagValue, splitFlag, REMOTE_DATABASE } from './policy-common.mjs'
import { gitHandler } from './git-policy.mjs'

const allowed = (env, code, detail) => env.findings.push(F('run_lightweight_local_checks', code, detail))
const lower = (w) => (w?.text ?? '').toLowerCase()

// ── GitHub CLI ────────────────────────────────────────────────────────────────────────────────────────────
function gh(env) {
  const { words, findings } = env
  const args = stripGlobal(words.slice(1), new Set(['-R', '--repo', '--hostname']))
  const [group, verb] = [lower(args[0]), lower(args[1])]
  const push = (a, c, d) => findings.push(F(a, c, d))
  const read = () => push('read_github_state', `gh.${group}_${verb || 'read'}`, 'reads GitHub state')
  switch (group) {
    case 'pr':
      if (verb === 'merge') return push(hasFlag(args, '--auto') ? 'enable_auto_merge' : 'merge_pull_request', 'gh.pr_merge', 'merging is performed by humans only')
      if (verb === 'review') return hasFlag(args, '--approve', '-a') ? push('approve_pull_request_as_gate', 'gh.pr_approve', 'agents cannot approve pull requests')
        : push('modify_pull_request_state', 'gh.pr_review', 'pull request review')
      if (verb === 'ready') return push('mark_pull_request_ready_for_review', 'gh.pr_ready', 'marking a PR ready for review needs human approval')
      if (verb === 'create' || verb === 'new') return hasFlag(args, '--draft', '-d') ? push('open_draft_pull_request', 'gh.pr_create_draft', 'opens a draft pull request')
        : push('mark_pull_request_ready_for_review', 'gh.pr_create_non_draft', 'a non-draft PR is ready for review; open it as --draft')
      if (['edit', 'comment'].includes(verb)) return push('interact_with_pull_request_or_issue', `gh.pr_${verb}`, `pull request ${verb}`)
      if (verb === 'update-branch') return push('push_dedicated_branch_fast_forward', 'gh.pr_update_branch', 'updates the PR head on GitHub')
      if (['view', 'list', 'diff', 'checks', 'status', ''].includes(verb)) return read()
      return push('modify_pull_request_state', `gh.pr_${verb}`, `changes pull request state (${verb})`)
    case 'workflow':
      if (['list', 'view', 'ls'].includes(verb)) return read()
      return push('dispatch_any_workflow', `gh.workflow_${verb}`, 'workflows are dispatched or toggled by humans only')
    case 'run':
      if (['view', 'list', 'watch', 'download', 'ls'].includes(verb)) return read()
      return push('dispatch_any_workflow', `gh.run_${verb}`, 're-running or cancelling workflow runs is forbidden')
    case 'release':
      if (['list', 'view', 'download', 'ls'].includes(verb)) return read()
      return push('dispatch_production_release_or_rollback', `gh.release_${verb}`, 'releases are created only by the trusted release workflow')
    case 'secret': case 'variable': case 'ruleset': case 'environment':
      if (['list', 'ls', 'view', 'get', 'check'].includes(verb)) return read()
      return push('change_repository_rulesets_secrets_environments_or_permissions', `gh.${group}_${verb}`, 'repository controls are human-owned')
    case 'repo':
      if (['view', 'list', 'ls'].includes(verb)) return read()
      if (verb === 'clone') return push('network_request_or_remote_shell', 'gh.repo_clone', 'clones a repository')
      return push('change_repository_rulesets_secrets_environments_or_permissions', `gh.repo_${verb}`, 'repository settings are human-owned')
    case 'api': return ghApi(env, args.slice(1))
    case 'auth':
      if (verb === 'token' || hasFlag(args, '--show-token', '-t')) return push('read_production_or_publisher_credentials', 'gh.auth_token', 'prints a GitHub credential')
      if (verb === 'status') return read()
      return push('modify_git_configuration_or_remotes', `gh.auth_${verb}`, 'changes GitHub CLI authentication')
    case 'issue':
      if (['view', 'list', 'status', 'ls'].includes(verb)) return read()
      if (['create', 'comment', 'edit', 'new'].includes(verb)) return push('interact_with_pull_request_or_issue', `gh.issue_${verb}`, `issue ${verb}`)
      return push('modify_pull_request_state', `gh.issue_${verb}`, `changes issue state (${verb})`)
    case 'search': case 'status': case 'browse': case 'label': case 'cache': case 'gist': case 'project': case 'org':
      if (['', 'list', 'view', 'ls', 'issues', 'prs', 'repos', 'code', 'commits'].includes(verb) || group === 'status' || group === 'browse') return read()
      return push('modify_pull_request_state', `gh.${group}_${verb}`, `changes GitHub state (${group} ${verb})`)
    case '--version': case 'version': case 'help': case '--help': case '':
      return read()
    case 'extension': case 'ext':
      return push('install_or_upgrade_dependencies', 'gh.extension', 'GitHub CLI extensions execute third-party code')
    default:
      return push('run_unrecognized_command', `gh.unknown`, `unrecognized gh command '${group.slice(0, 30)}' (may be an alias)`)
  }
}

function ghApi(env, args) {
  const { findings } = env
  const attachedMethod = args.find((w) => /^-X[A-Za-z]+$/.test(w.text))?.text.slice(2)
  const method = (attachedMethod ?? flagValue(args, '-X', '--method') ?? '').toUpperCase()
  const bodyFlags = hasFlag(args, '-f', '-F', '--field', '--raw-field', '--input') || args.some((w) => /^-[fF]\S/.test(w.text))
  // A body read from a file (`--input f`, `-F query=@q.graphql`) cannot be inspected.
  const opaqueBody = hasFlag(args, '--input') || args.some((w, i) => /^(-[fF]|--field|--raw-field)$/.test(w.text) ? /=@/.test(args[i + 1]?.text ?? '') : /^(-[fF]|--(raw-)?field=)\S*=@/.test(w.text))
  const endpoint = positionals(args, 0, new Set(['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input', '-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '--cache']))[0]?.text ?? ''
  const all = args.map((w) => w.text).join(' ').toLowerCase()
  const isGraphql = endpoint.toLowerCase() === 'graphql'
  const mutation = isGraphql ? /\bmutation\b/.test(all) : (method && method !== 'GET') || (!method && bodyFlags)
  if (isGraphql && opaqueBody) return findings.push(F('modify_pull_request_state', 'gh.api_opaque_graphql', 'GraphQL document read from a file is not inspected'))
  if (!mutation) return findings.push(F('read_github_state', 'gh.api_read', 'reads GitHub state'))
  if (/mergepullrequest|\/merges?\b|automerge|auto_merge|enablepullrequestautomerge/.test(all)) return findings.push(F('merge_pull_request', 'gh.api_merge', 'merging via the API is forbidden'))
  if (/\/contents\//.test(all)) {
    const branch = /\bbranch=([^\s&]+)/.exec(all)?.[1]
    return !branch || ['main', 'master'].includes(branch.replace(/^refs\/heads\//, ''))
      ? findings.push(F('push_to_protected_main', 'gh.api_contents_main', 'contents API writes to the default/protected branch'))
      : findings.push(F('push_dedicated_branch_fast_forward', 'gh.api_contents_branch', 'contents API writes to a dedicated branch'))
  }
  if (/\/dispatches\b|\/rerun|\/cancel\b|workflow_dispatch|\/workflows\/[^/\s]+\/(enable|disable)/.test(all)) return findings.push(F('dispatch_any_workflow', 'gh.api_dispatch', 'workflow dispatch via the API is forbidden'))
  if (/\/rulesets|\/environments|\/secrets|\/variables|\/protection|\/collaborators|\/hooks\b|\/keys\b|\/permissions|\/teams|\/rename\b/.test(all)) {
    return findings.push(F('change_repository_rulesets_secrets_environments_or_permissions', 'gh.api_repo_controls', 'repository controls are human-owned'))
  }
  if (/\/git\/refs|\/git\/tags|createref|updateref|deleteref|updaterefs/.test(all)) return findings.push(F('force_push_or_rewrite_reviewed_history', 'gh.api_refs', 'direct ref updates can move protected branches'))
  if (/\/releases\b/.test(all)) return findings.push(F('dispatch_production_release_or_rollback', 'gh.api_release', 'releases are created only by the trusted release workflow'))
  if (/\/reviews\b|addpullrequestreview/.test(all) && /approve/.test(all)) return findings.push(F('approve_pull_request_as_gate', 'gh.api_approve', 'agents cannot approve pull requests'))
  if (/markpullrequestreadyforreview/.test(all)) return findings.push(F('mark_pull_request_ready_for_review', 'gh.api_ready', 'marking ready needs human approval'))
  if (/\/comments\b|\/issues\/\d+\/comments/.test(all)) return findings.push(F('interact_with_pull_request_or_issue', 'gh.api_comment', 'comment via the API'))
  findings.push(F('modify_pull_request_state', 'gh.api_mutation', 'GitHub API mutation'))
}

function stripGlobal(args, withValue) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const [flag, value] = splitFlag(args[i].text)
    if (withValue.has(flag)) { if (value === null) i++; continue }
    out.push(args[i])
  }
  return out
}

// ── npm / npx / other package managers ───────────────────────────────────────────────────────────────────
const NPM_INSTALL = new Set(['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isntall', 'add', 'ci', 'clean-install', 'ic',
  'install-clean', 'isntall-clean', 'install-ci-test', 'cit', 'install-test', 'it', 'update', 'up', 'upgrade', 'udpate', 'uninstall',
  'un', 'unlink', 'remove', 'rm', 'r', 'link', 'ln', 'dedupe', 'ddp', 'prune', 'rebuild', 'rb', 'init', 'create', 'innit'])
const NPM_READ = new Set(['ls', 'list', 'la', 'll', 'view', 'v', 'info', 'show', 'outdated', 'why', 'explain', 'search', 'help', 'doctor',
  'prefix', 'root', 'bin', 'fund', 'pack', 'query', 'sbom', '--version', '-v', 'whoami', 'ping', 'config-get', 'help-search', 'docs', 'repo', 'bugs'])
const NPM_RUN = new Set(['run', 'run-script', 'rum', 'urn', 'test', 't', 'tst', 'start', 'stop', 'restart'])

function npm(env) {
  const { words, findings, ctx, state } = env
  let dir = state.cwd // null after a computed `cd`: script resolution then fails closed (needs approval)
  let workspace
  const rest = []
  for (let i = 1; i < words.length; i++) {
    const [flag, value] = splitFlag(words[i].text)
    if (flag === '--prefix' || flag === '-C' || flag === '--dir') { const v = value ?? words[++i]?.text; if (v) dir = ctx.pathPolicy.resolve(v, dir); continue }
    if (flag === '-w' || flag === '--workspace') { workspace = value ?? words[++i]?.text; continue }
    if (flag === '--workspaces' || flag === '-ws' || flag === '--include-workspace-root') { workspace = '*'; continue }
    rest.push(words[i])
  }
  const sub = lower(rest.find((w) => !w.text.startsWith('-')) ?? { text: rest[0]?.text ?? '' })
  const subIdx = rest.findIndex((w) => !w.text.startsWith('-'))
  const after = subIdx >= 0 ? rest.slice(subIdx + 1) : []
  if (!sub && rest.some((w) => ['-v', '--version', '-h', '--help'].includes(w.text))) return allowed(env, 'npm.version', 'npm version query')
  if (sub === 'publish' || sub === 'unpublish' || sub === 'deprecate' || sub === 'dist-tag' || sub === 'owner' || sub === 'access' || sub === 'trust') {
    return findings.push(F('create_alternate_publishing_or_deployment_path', `npm.${sub}`, 'package publishing is forbidden'))
  }
  if (sub === 'token' || sub === 'adduser' || sub === 'login' || sub === 'logout') return findings.push(F('read_production_or_publisher_credentials', `npm.${sub}`, 'npm registry credentials'))
  if (sub === 'audit') return hasFlag(after, 'fix') || after.some((w) => w.text === 'fix') ? findings.push(F('install_or_upgrade_dependencies', 'npm.audit_fix', 'npm audit fix changes dependencies')) : allowed(env, 'npm.audit', 'npm audit')
  if (NPM_INSTALL.has(sub) || sub === 'exec' || sub === 'x') {
    if (sub === 'exec' || sub === 'x') return npx(env, after)
    return findings.push(F('install_or_upgrade_dependencies', `npm.${sub}`, 'dependency installation runs package lifecycle scripts; needs human approval'))
  }
  if (sub === 'config' || sub === 'c' || sub === 'pkg' || sub === 'set') {
    const action = lower(after[0])
    if (['get', 'list', 'ls'].includes(action) || !action) return allowed(env, 'npm.config_read', 'reads npm config')
    return findings.push(F('modify_git_configuration_or_remotes', 'npm.config_write', 'changes npm configuration'))
  }
  if (sub === 'version' && after.length) return findings.push(F('run_unrecognized_command', 'npm.version_bump', 'npm version edits package.json and creates a git tag'))
  if (NPM_READ.has(sub)) return allowed(env, 'npm.read', 'read-only npm command')
  if (sub === 'cache') return lower(after[0]) === 'clean' ? findings.push(F('discard_or_rewrite_local_work', 'npm.cache_clean', 'clears the npm cache')) : allowed(env, 'npm.cache', 'npm cache query')
  if (NPM_RUN.has(sub)) {
    const scriptName = ['run', 'run-script', 'rum', 'urn'].includes(sub) ? after.find((w) => !w.text.startsWith('-'))?.text : sub === 't' || sub === 'tst' ? 'test' : sub
    if (!scriptName) return allowed(env, 'npm.run_list', 'lists scripts')
    const dashIdx = after.findIndex((w) => w.text === '--')
    const extra = dashIdx >= 0 ? after.slice(dashIdx + 1).map((w) => `'${w.text.replace(/'/g, "'\\''")}'`).join(' ') : ''
    if (workspace === '*') return findings.push(F('run_unreviewed_script', 'npm.all_workspaces', 'runs a script in every workspace'))
    if (workspace) {
      const wsDir = ctx.resolveWorkspace?.(workspace, ctx.projectRoot)
      if (!wsDir) return findings.push(F('run_unreviewed_script', 'npm.unresolved_workspace', 'workspace could not be resolved'))
      dir = wsDir
    }
    return npmScript(env, dir, scriptName, extra)
  }
  findings.push(F('run_unrecognized_command', `npm.unknown`, `unrecognized npm command '${sub.slice(0, 30)}'`))
}

/** Resolve `npm run <name>` to its package.json body (plus pre/post hooks) and classify the bodies. */
function npmScript(env, dir, name, extra) {
  const { findings, ctx, state } = env
  if (state.depth >= 5) return findings.push(F('run_unclassifiable_shell_input', 'npm.too_deep', 'script indirection too deep'))
  if (!dir) return findings.push(F('run_unreviewed_script', 'npm.unresolved_dir', 'package directory unknown (computed cd)'))
  let scripts
  try { scripts = ctx.readPackageScripts?.(dir) } catch { scripts = null }
  if (!scripts) return findings.push(F('run_unreviewed_script', 'npm.unresolved_package', 'package.json could not be read'))
  if (!Object.hasOwn(scripts, name)) {
    if (name === 'start' || name === 'restart' || name === 'stop') return findings.push(F('run_unreviewed_script', 'npm.implicit_script', `implicit npm ${name}`))
    return allowed(env, 'npm.missing_script', `script '${name}' does not exist; npm exits with an error`)
  }
  if (/^dev($|:)/.test(name)) findings.push(F('start_local_dev_server', 'npm.dev_server', 'dev servers may load local credential files; start them manually'))
  for (const key of [`pre${name}`, name, `post${name}`]) {
    if (!Object.hasOwn(scripts, key)) continue
    const body = key === name && extra ? `${scripts[key]} ${extra}` : scripts[key]
    findings.push(...env.recurse(body, { dialect: 'posix', cwd: dir, backslashEscapes: ctx.platform !== 'win32' }))
  }
}

const NPX_LOCAL_TOOLS = new Set(['tsc', 'eslint', 'prettier', 'jest', 'vitest', 'tsx', 'next', 'expo', 'playwright', 'ts-node', 'pyright'])
const NPX_ALIASES = { typescript: 'tsc', '@playwright/test': 'playwright', 'eas-cli': 'eas', '@railway/cli': 'railway', '@expo/cli': 'expo', 'supabase': 'supabase', 'vercel': 'vercel', 'eas': 'eas', 'railway': 'railway' }

function npx(env, argsIn) {
  const { findings } = env
  const args = argsIn ?? env.words.slice(1)
  let i = 0
  let remote = false
  const packages = []
  while (i < args.length && args[i].text.startsWith('-')) {
    const [flag, value] = splitFlag(args[i].text)
    if (flag === '-y' || flag === '--yes') remote = true
    if (flag === '-p' || flag === '--package') { packages.push(value ?? args[++i]?.text); remote = true }
    if (flag === '-c' || flag === '--call') {
      findings.push(F('install_or_upgrade_dependencies', 'npx.call', 'npx -c may download packages'))
      findings.push(...env.recurse(value ?? args[i + 1]?.text ?? ''))
      return
    }
    if (flag === '--') { i++; break }
    i++
  }
  const pkgWord = args[i]
  if (!pkgWord) return findings.push(F('run_unrecognized_command', 'npx.empty', 'npx without a package'))
  const m = /^(@?[^@\s]+)(?:@(.+))?$/.exec(pkgWord.text)
  const name = (m?.[1] ?? pkgWord.text).toLowerCase()
  if (m?.[2] || remote || packages.length) findings.push(F('install_or_upgrade_dependencies', 'npx.remote_package', 'npx may download and execute a package'))
  const tool = NPX_ALIASES[name] ?? name
  const handler = TOOL_HANDLERS[tool]
  if (handler && (NPX_LOCAL_TOOLS.has(tool) || ['supabase', 'vercel', 'eas', 'railway'].includes(tool))) {
    return handler({ ...env, words: [{ ...pkgWord, text: tool }, ...args.slice(i + 1)], exe: tool })
  }
  findings.push(F('install_or_upgrade_dependencies', 'npx.unknown_package', `npx executes package '${name.slice(0, 40)}', whose code is not inspected`))
}

function otherPackageManager(env) {
  const { words, findings, exe } = env
  const sub = lower(words[1])
  if (sub === 'publish' || sub === 'npm' && lower(words[2]) === 'publish') return findings.push(F('create_alternate_publishing_or_deployment_path', `${exe}.publish`, 'package publishing is forbidden'))
  if (['install', 'add', 'remove', 'update', 'upgrade', 'up', 'dlx', 'x', 'create', 'init', 'link', 'import', ''].includes(sub) || (exe === 'yarn' && !sub)) {
    return findings.push(F('install_or_upgrade_dependencies', `${exe}.${sub || 'install'}`, 'dependency installation needs human approval'))
  }
  if (exe === 'bun' && sub === 'test') return allowed(env, 'bun.test', 'bun test')
  findings.push(F('run_unreviewed_script', `${exe}.script`, `${exe} script indirection is not resolved`))
}

function pip(env) {
  const { words, findings, exe } = env
  const sub = lower(positionals(words)[0])
  if (['list', 'show', 'freeze', 'check', 'help', '--version', 'debug', 'inspect'].includes(sub) || hasFlag(words, '--version', '-V')) return allowed(env, 'pip.read', 'reads installed packages')
  findings.push(F('install_or_upgrade_dependencies', `${exe}.${sub || 'unknown'}`, 'Python dependency changes need human approval'))
}

// ── Interpreters ───────────────────────────────────────────────────────────────────────────────────────────
const TESTFILE = /(^|[\\/])(tests?|__tests__)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$/i

function node(env) {
  const { words, findings } = env
  for (let i = 1; i < words.length; i++) {
    const [flag, value] = splitFlag(words[i].text)
    if (['-e', '--eval', '-p', '--print'].includes(flag) || /^-[a-z]*[ep]$/.test(flag) && flag.length <= 3) return env.inline(value ?? words[i + 1]?.text ?? '')
    if (['-v', '--version', '-h', '--help', '-c', '--check'].includes(flag)) return allowed(env, 'node.meta', 'node metadata/syntax check')
    if (['-r', '--require', '--import', '--loader', '--experimental-loader'].includes(flag)) findings.push(F('run_unreviewed_script', 'node.preload', 'preloads a module'))
    if (flag === '--test') {
      for (let j = 1; j < words.length; j++) {
        const [f2, v2] = splitFlag(words[j].text)
        const val = v2 ?? words[j + 1]?.text ?? ''
        if (f2 === '--test-reporter' && !['spec', 'tap', 'dot', 'junit', 'lcov'].includes(val)) findings.push(F('run_unreviewed_script', 'node.test_reporter', 'custom test reporter module is not inspected'))
        if (f2 === '--test-reporter-destination' && !['stdout', 'stderr'].includes(val)) findings.push(env.ctx.pathPolicy.classifyWrite(val, { cwd: env.state.cwd }))
      }
      const files = positionals(words, i + 1, new Set(['--test-name-pattern', '--test-reporter', '--test-reporter-destination', '--test-concurrency', '--test-timeout']))
      if (files.every((w) => !w.dynamic && (TESTFILE.test(w.text) || /^[\w./\\-]+$/.test(w.text) && !/\.[cm]?[jt]s$/.test(w.text)))) return allowed(env, 'node.test', 'node --test over test files')
      return findings.push(F('run_unreviewed_script', 'node.test_nontest', 'node --test over non-test files'))
    }
    if (['--env-file', '--env-file-if-exists'].includes(flag)) { findings.push(F('read_production_or_publisher_credentials', 'node.env_file', 'loads an env file into the process')); if (value === null) i++; continue }
    if (flag.startsWith('-')) { if (['--input-type', '--stack-size', '--max-old-space-size', '--conditions', '-C', '--title'].includes(flag) && value === null) i++; continue }
    return env.script(words[i])
  }
  findings.push(F('run_unrecognized_command', 'node.repl', 'interactive node REPL'))
}

const PY_MODULES_ALLOWED = new Set(['py_compile', 'compileall', 'unittest', 'site', 'tabnanny'])
// `python -m <tool>` is routed to the same handler as the bare tool so option checks (plugins, outputs) apply.
const PY_MODULE_TOOLS = new Set(['pytest', 'mypy', 'ruff', 'black', 'isort', 'pyright', 'flake8', 'pylint'])
const PY_MODULES_SERVER = new Set(['uvicorn', 'gunicorn', 'flask', 'http.server', 'hypercorn', 'daphne', 'fastapi', 'streamlit', 'django'])

function python(env) {
  const { words, findings } = env
  for (let i = 1; i < words.length; i++) {
    const t = words[i].text
    if (t === '-c' || (/^-[A-Za-z]*c$/.test(t) && !t.startsWith('--'))) return env.inline(words[i + 1]?.text ?? '')
    if (t === '-m' || /^-[A-Za-z]*m$/.test(t)) {
      const mod = (words[i + 1]?.text ?? '').toLowerCase()
      if (PY_MODULE_TOOLS.has(mod)) return TOOL_HANDLERS[mod]({ ...env, words: [{ ...words[i + 1], text: mod }, ...words.slice(i + 2)], exe: mod })
      if (mod === 'json.tool') {
        const out = positionals(words, i + 2, new Set(['--indent']))[1]
        if (out) env.findings.push(env.ctx.pathPolicy.classifyWrite(out.text, { cwd: env.state.cwd }))
        return allowed(env, 'python.json_tool', 'python -m json.tool')
      }
      if (PY_MODULES_ALLOWED.has(mod)) return allowed(env, `python.${mod}`, `python -m ${mod}`)
      if (PY_MODULES_SERVER.has(mod)) return findings.push(F('start_local_dev_server', 'python.server', 'dev servers may load local credential files; start them manually'))
      if (mod === 'pip' || mod === 'ensurepip' || mod === 'venv' || mod === 'virtualenv') return pip({ ...env, words: [words[0], ...words.slice(i + 2)], exe: 'pip' })
      return findings.push(F('run_unreviewed_script', 'python.module', `python -m ${mod.slice(0, 40)} is not inspected`))
    }
    if (['-V', '--version', '-h', '--help'].includes(t)) return allowed(env, 'python.meta', 'python metadata')
    if (t.startsWith('-')) { if (['-W', '-X', '-Q'].includes(t)) i++; continue }
    return env.script(words[i])
  }
  findings.push(F('run_unrecognized_command', 'python.repl', 'interactive Python REPL'))
}

function denoBun(env) {
  const { words, exe, findings } = env
  const sub = lower(words[1])
  if (sub === 'eval' || sub === '-e' || sub === '--eval' || sub === '-p' || sub === '--print') return env.inline(words[2]?.text ?? '')
  if (exe === 'bun') return otherPackageManager(env)
  if (sub === 'test' || sub === 'lint' || sub === 'fmt' || sub === 'check') return allowed(env, `deno.${sub}`, `deno ${sub}`)
  findings.push(F('run_unreviewed_script', `deno.${sub || 'run'}`, 'deno script execution is not inspected'))
}

// ── Remote-capable CLIs: unknown subcommands are forbidden ────────────────────────────────────────────────
function supabase(env) {
  const { words, findings } = env
  const args = stripGlobal(words.slice(1), new Set(['--workdir', '--profile', '-o', '--output', '--dns-resolver', '--network-id']))
  const pos = positionals(args, 0).map((w) => w.text.toLowerCase())
  const [a, b] = pos
  const remoteFlag = hasFlag(args, '--linked', '--db-url', '--project-ref', '--project-id', '-p', '--password')
  const local = hasFlag(args, '--local')
  const f = (action, code, detail) => findings.push(F(action, code, detail))
  if (!a || ['--version', '-v', 'help', '--help', 'completion'].includes(a) || hasFlag(args, '--version', '-v', '--help', '-h')) return f('read_repository', 'supabase.meta', 'supabase CLI metadata')
  if (a === 'db' && b === 'push') return f('apply_migration_to_staging_or_production', 'supabase.db_push', 'applying migrations remotely is forbidden')
  if (a === 'migration' && b === 'repair') return f('supabase_migration_repair', 'supabase.migration_repair', 'migration history repair is forbidden')
  if (a === 'migration' && b === 'squash') return f('modify_existing_migration', 'supabase.migration_squash', 'squashing rewrites existing migrations')
  if (remoteFlag) return f('run_supabase_cli_against_remote_project', 'supabase.remote_flag', 'targets a remote Supabase project')
  if (a === 'migration' && b === 'new') return f('author_new_forward_only_migration', 'supabase.migration_new', 'new forward-only migration needs human approval')
  if (['start', 'stop', 'status', 'init', 'test', 'seed'].includes(a)) return f('run_local_docker_or_database_stack', `supabase.${a}`, 'local Supabase stack')
  if (a === 'db' && ['reset', 'diff', 'lint', 'start', 'query'].includes(b) && (local || b === 'reset' || b === 'start' || b === 'diff')) return f('run_local_docker_or_database_stack', `supabase.db_${b}`, 'local database operation')
  if (a === 'migration' && ['list', 'up', 'down'].includes(b) && local) return f('run_local_docker_or_database_stack', `supabase.migration_${b}`, 'local migration state')
  if (a === 'gen' && local) return f('run_local_docker_or_database_stack', 'supabase.gen_local', 'generates types from the local database')
  if (a === 'functions' && ['serve', 'new'].includes(b)) return f('run_local_docker_or_database_stack', `supabase.functions_${b}`, 'local edge functions')
  f('run_supabase_cli_against_remote_project', `supabase.${a}${b ? `_${b}` : ''}`, 'Supabase CLI command that defaults to (or may reach) the linked remote project')
}

function railway(env) {
  const sub = lower(positionals(env.words)[0])
  const f = (action, code, detail) => env.findings.push(F(action, code, detail))
  if (['up', 'deploy', 'redeploy', 'down', 'restart', 'scale'].includes(sub)) return f('deploy_production', `railway.${sub}`, 'Railway deployment is performed only by trusted workflows')
  if (['run', 'shell', 'connect', 'ssh', 'variables', 'variable', 'vars'].includes(sub)) return f('read_production_or_publisher_credentials', `railway.${sub}`, 'exposes Railway environment credentials')
  if (['logs', 'status', 'whoami', 'list', 'open', '--version', '-v', 'help', '--help', ''].includes(sub)) return f('read_remote_production_state', `railway.${sub || 'meta'}`, 'reads live Railway state (may include customer data)')
  if (sub === 'login' || sub === 'logout') return f('modify_git_configuration_or_remotes', `railway.${sub}`, 'changes Railway authentication')
  f('deploy_or_mutate_staging_directly', `railway.${sub}`, 'Railway mutation')
}

function vercel(env) {
  const { words } = env
  const sub = lower(positionals(words, 1, new Set(['--scope', '--token', '-t', '-S', '--cwd', '-A', '--local-config', '-e', '--env', '-b', '--build-env', '-m', '--meta', '--target']))[0])
  const f = (action, code, detail) => env.findings.push(F(action, code, detail))
  if (hasFlag(words, '--token', '-t')) return f('read_production_or_publisher_credentials', 'vercel.token', 'passes a Vercel credential')
  if (hasFlag(words, '--prod', '--production') || ['', 'deploy', 'promote', 'rollback', 'redeploy', 'alias', 'rm', 'remove', 'domains', 'dns', 'certs', 'build', 'bisect'].includes(sub)) {
    if (!sub && hasFlag(words, '--version', '-v', '--help', '-h')) return f('read_repository', 'vercel.meta', 'vercel CLI metadata')
    return f('deploy_production', `vercel.${sub || 'deploy'}`, 'Vercel deployment is forbidden from developer sessions')
  }
  if (['env', 'pull', 'link'].includes(sub)) return f('read_production_or_publisher_credentials', `vercel.${sub}`, 'downloads Vercel environment configuration')
  if (['whoami', 'ls', 'list', 'inspect', 'logs', 'project', 'teams', 'help', '--version'].includes(sub)) return f('read_remote_production_state', `vercel.${sub}`, 'reads live Vercel state')
  if (sub === 'login' || sub === 'logout') return f('modify_git_configuration_or_remotes', `vercel.${sub}`, 'changes Vercel authentication')
  f('deploy_production', `vercel.${sub}`, 'unrecognized Vercel command')
}

function eas(env) {
  const { words } = env
  const sub = lower(positionals(words, 1, new Set(['-p', '--platform', '--profile', '-e', '--branch', '--channel', '--message', '-m']))[0])
  const [group] = sub.split(':')
  const f = (action, code, detail) => env.findings.push(F(action, code, detail))
  const profile = (flagValue(words, '--profile', '-e') ?? '').toLowerCase()
  const readOnly = /:(list|view|info)$/.test(sub)
  if (['update', 'submit', 'channel', 'branch', 'metadata', 'deploy', 'webhook'].includes(group) && !readOnly) return f('publish_mobile_build_or_ota_update', `eas.${sub}`, 'mobile publishing/OTA is forbidden from developer sessions')
  if (['secret', 'env', 'credentials'].includes(group)) return f(/:(list|pull|get)$/.test(sub) || sub === group ? 'read_production_or_publisher_credentials' : 'change_repository_rulesets_secrets_environments_or_permissions', `eas.${sub}`, 'EAS credentials and secrets')
  if (group === 'workflow' && !readOnly) return f('dispatch_any_workflow', `eas.${sub}`, 'EAS workflow dispatch')
  if (group === 'build' && !readOnly && sub !== 'build:cancel') {
    if (hasFlag(words, '--auto-submit', '-s', '--auto-submit-with-profile') || profile === 'production') return f('publish_mobile_build_or_ota_update', 'eas.build_production', 'production or auto-submitted builds are forbidden')
    return f('run_unrecognized_command', 'eas.build', 'EAS cloud build consumes credits and signing credentials; needs human approval')
  }
  if (readOnly || ['whoami', 'config', 'diagnostics', 'project:info', '--version', 'help', '--help', 'build:cancel'].includes(sub)) return f('read_remote_production_state', `eas.${sub}`, 'reads EAS state')
  if (sub === 'login' || sub === 'logout') return f('modify_git_configuration_or_remotes', `eas.${sub}`, 'changes EAS authentication')
  f('publish_mobile_build_or_ota_update', `eas.${sub || 'unknown'}`, 'unrecognized EAS command')
}

function expo(env) {
  const sub = lower(positionals(env.words)[0])
  const f = (action, code, detail) => env.findings.push(F(action, code, detail))
  if (['start', 'run:android', 'run:ios', 'web', 'serve'].includes(sub)) return f('start_local_dev_server', `expo.${sub}`, 'dev server')
  if (['publish', 'upload:android', 'upload:ios', 'publish:set', 'publish:rollback'].includes(sub)) return f('publish_mobile_build_or_ota_update', `expo.${sub}`, 'legacy Expo publishing')
  if (sub === 'install' || sub === 'upgrade') return f('install_or_upgrade_dependencies', `expo.${sub}`, 'dependency change')
  if (['lint', 'config', 'doctor', 'customize', '--version', 'help', ''].includes(sub)) return allowed(env, `expo.${sub || 'meta'}`, `expo ${sub}`)
  f('run_unrecognized_command', `expo.${sub}`, `expo ${sub.slice(0, 30)} needs human approval`)
}

function databaseClient(env) {
  const { words, findings, exe } = env
  const host = flagValue(words, '-h', '--host') ?? ''
  if (REMOTE_DATABASE.test(words.map((w) => w.text).join(' ')) || (host && !/^(localhost|127\.0\.0\.1|::1|\/)/.test(host))) {
    return findings.push(F('access_customer_data', `${exe}.remote`, 'remote database access is forbidden from developer sessions'))
  }
  findings.push(F('run_local_docker_or_database_stack', `${exe}.local`, 'local database client'))
}

function docker(env) {
  const sub = lower(positionals(env.words)[0])
  if (['push', 'login', 'logout', 'buildx'].includes(sub)) return env.findings.push(F(sub === 'push' || sub === 'buildx' ? 'create_alternate_publishing_or_deployment_path' : 'read_production_or_publisher_credentials', `docker.${sub}`, 'registry publishing or credentials'))
  if (['ps', 'images', 'version', 'info', 'inspect', 'logs', '--version'].includes(sub)) return allowed(env, `docker.${sub}`, 'reads local docker state')
  env.findings.push(F('run_local_docker_or_database_stack', `docker.${sub || 'unknown'}`, 'local container operation'))
}

function nestedAgent(env) {
  const { words, findings, exe } = env
  if (words.some((w) => /^(--dangerously-skip-permissions|--allow-dangerously-skip-permissions|--setting-sources|--settings|--bare|--disallowedTools|--disallowed-tools|--allowedTools|--allowed-tools|--add-dir|--mcp-config|--strict-mcp-config|--yolo|--dangerously-bypass-approvals-and-sandbox|--full-auto)$/.test(splitFlag(w.text)[0])) ||
    words.some((w, i) => splitFlag(w.text)[0] === '--permission-mode' && /bypass/i.test(splitFlag(w.text)[1] ?? words[i + 1]?.text ?? ''))) {
    return findings.push(F('bypass_git_hooks_or_ci', `${exe}.bypass`, 'nested agent session that bypasses permissions or project settings'))
  }
  if (['--version', '-v', 'doctor', '--help', '-h'].includes(lower(words[1]))) return allowed(env, `${exe}.meta`, 'agent CLI metadata')
  findings.push(F('launch_nested_agent_session', `${exe}.session`, 'nested agent sessions need human approval'))
}

const devServer = (env) => env.findings.push(F('start_local_dev_server', `${env.exe}.server`, 'dev servers may load local credential files; start them manually'))
// Options of "check" tools that load arbitrary code or write files.
const CODE_LOADING_FLAGS = new Set(['-c', '--config', '--rulesdir', '--rule', '--plugin', '--resolve-plugins-relative-to', '--setupFiles',
  '--setupFilesAfterEach', '--setupFilesAfterEnv', '--globalSetup', '--globalTeardown', '--testRunner', '--reporters', '--transform', '--preset',
  '--rootDir', '-p', '--import', '--require', '-r', '--loader', '--test-reporter', '--confcutdir', '--rcfile', '--init-hook', '--load-plugins'])
const OUTPUT_FLAGS = new Set(['--outputFile', '--output-file', '-o', '--outDir', '--outFile', '--declarationDir', '--test-reporter-destination',
  '--junitxml', '--resultlog', '--cache-location', '--tsBuildInfoFile', '--coverageDirectory', '--basetemp', '--cache-dir', '-o'])
// Formatters that rewrite files in place unless run in check/diff mode.
const IN_PLACE_BY_DEFAULT = { black: ['--check', '--diff'], isort: ['--check', '--check-only', '--diff', '-c'] }
const BULK_WRITE_FLAGS = new Set(['--write', '-w', '--fix', '--fix-dry-run', '-u', '--updateSnapshot', '--fix-only'])

function checkTool(env) {
  const { words, findings, exe, ctx, state } = env
  const pp = ctx.pathPolicy
  for (let i = 1; i < words.length; i++) {
    const [flag, value] = splitFlag(words[i].text)
    if (CODE_LOADING_FLAGS.has(flag) && !(exe === 'tsc' && flag === '-p') && !(exe === 'pytest' && flag === '-p' && /^no:/.test(value ?? words[i + 1]?.text ?? ''))) {
      findings.push(F('run_unreviewed_script', `${exe}.code_loading_option`, `${exe} ${flag} loads configuration or plugin code that is not inspected`))
    }
    if (OUTPUT_FLAGS.has(flag) && !(exe === 'tsc' && flag === '-p')) {
      const target = value ?? words[i + 1]?.text
      findings.push(target ? pp.classifyWrite(target, { cwd: state.cwd }) : F('edit_outside_task_worktree', `${exe}.output`, 'output target unknown'))
    }
  }
  const inPlace = (exe in IN_PLACE_BY_DEFAULT && !hasFlag(words, ...IN_PLACE_BY_DEFAULT[exe])) ||
    (exe === 'ruff' && lower(words[1]) === 'format' && !hasFlag(words, '--check', '--diff'))
  if (inPlace || (words.some((w) => BULK_WRITE_FLAGS.has(splitFlag(w.text)[0])) && ['prettier', 'eslint', 'ruff', 'black', 'isort', 'jest', 'vitest'].includes(exe))) {
    const targets = positionals(words, 1, new Set([...CODE_LOADING_FLAGS, ...OUTPUT_FLAGS]))
    if (!targets.length && exe !== 'jest' && exe !== 'vitest') targets.push({ text: '.', dynamic: false })
    for (const t of targets) {
      if (t.dynamic || t.glob || pp.coversProtected(pp.resolve(t.text, state.cwd ?? undefined))) {
        findings.push(F('discard_or_rewrite_local_work', `${exe}.bulk_write`, `${exe} rewrites files across a tree that includes protected paths`))
      } else findings.push(pp.classifyWrite(t.text, { cwd: state.cwd, mode: 'edit' }))
    }
  }
  // Baseline finding; any stricter finding pushed above wins when the engine picks the most severe one.
  allowed(env, `${exe}.check`, `${exe} local check`)
}

export const TOOL_HANDLERS = {
  git: gitHandler, gh, npm, npx: (env) => npx(env), pnpm: otherPackageManager, yarn: otherPackageManager, bun: denoBun, deno: denoBun,
  pip, pip3: pip, uv: pip, poetry: pip, pipx: pip, conda: pip,
  node, nodejs: node, python, python3: python, py: python, pythonw: python,
  supabase, railway, vercel, eas, expo, stripe: (env) => env.findings.push(F(env.words.some((w) => /live/i.test(w.text)) ? 'enable_customer_agent_billing' : 'network_request_or_remote_shell', 'stripe.cli', 'Stripe CLI')),
  psql: databaseClient, pg_dump: databaseClient, pg_restore: databaseClient, pgcli: databaseClient, mysql: databaseClient, 'redis-cli': databaseClient, mongosh: databaseClient,
  docker, podman: docker, 'docker-compose': (env) => env.findings.push(F('run_local_docker_or_database_stack', 'docker.compose', 'local containers')),
  claude: nestedAgent, codex: nestedAgent, aider: nestedAgent, gemini: nestedAgent,
  tsc: checkTool, eslint: checkTool, prettier: checkTool, jest: checkTool, vitest: checkTool, pytest: checkTool, ruff: checkTool,
  pyright: checkTool, mypy: checkTool, black: checkTool, isort: checkTool, flake8: checkTool, pylint: checkTool, 'py.test': checkTool,
  tsx: (env) => (hasFlag(env.words, '--test') ? checkTool(env) : env.script(positionals(env.words)[0])),
  'ts-node': (env) => env.script(positionals(env.words)[0]),
  next: (env) => (['build', 'lint', 'info', 'telemetry'].includes(lower(env.words[1])) ? checkTool(env) : devServer(env)),
  playwright: (env) => (lower(env.words[1]) === 'show-report' ? checkTool(env) : lower(env.words[1]) === 'install'
    ? env.findings.push(F('install_or_upgrade_dependencies', 'playwright.install', 'downloads browsers'))
    : env.findings.push(F('run_unrecognized_command', 'playwright.e2e', 'E2E suites may target remote environments or use real accounts'))),
  uvicorn: devServer, gunicorn: devServer, nodemon: devServer, vite: devServer, 'webpack-dev-server': devServer, flask: devServer, hypercorn: devServer,
}

export { PROTECTED_BRANCHES, RESERVED_BRANCH_PREFIXES }
