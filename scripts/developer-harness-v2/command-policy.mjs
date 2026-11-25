// Developer Harness V2 — shell command classification (Phase 2). Pure: never executes the command.
//
// Classifies by EFFECT, not by prefix: every simple command in a compound line, every command substitution,
// every `sh -c` / `pwsh -Command` / `cmd /c` body, and every npm script body (resolved from package.json) is
// classified. Interpreter inline code (`node -e`, `python -c`, …) is never treated as inspected: it is at least
// `human_approval`, and `forbidden` when it visibly references a protected effect. Anything the bounded
// recognizer cannot parse is denied.
import { parseShell } from './shell-recognizer.mjs'
import { normalizeSlashes, detectActivation, hasShortNameSegment, cwdFlowIsCertain, isPlainPathText } from './path-policy.mjs'
import {
  F, execName, isPathLike, positionals, hasFlag, flagValue, isSensitiveVarName, wordIsSensitive,
  signatureFindings, stringLiterals, REMOTE_DATABASE, textReferencesSensitive,
} from './policy-common.mjs'
import { TOOL_HANDLERS } from './command-tools.mjs'
import { fileWriter, readOnlySideEffect, globMayMatchSecret } from './file-command-policy.mjs'
import { parseHttpRequest, httpMutationFindings } from './http-request-policy.mjs'
import { opaqueGithubFindings } from './github-api-policy.mjs'
import { privilegedMatch, PIN_TOOL } from './bypass-authorization.mjs'

export const MAX_DEPTH = 6
const OPAQUE_ACTIONS = new Set(['run_unrecognized_command', 'run_unreviewed_script', 'run_interpreter_inline_code', 'network_request_or_remote_shell'])

const SAFE_READONLY = new Set(['ls', 'dir', 'pwd', 'echo', 'printf', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg',
  'tree', 'stat', 'file', 'which', 'where', 'whereis', 'du', 'df', 'date', 'whoami', 'uname', 'hostname', 'sort', 'uniq', 'cut',
  'tr', 'diff', 'cmp', 'comm', 'jq', 'basename', 'dirname', 'realpath', 'readlink', 'true', 'false', 'test', '[', 'sleep', 'less',
  'more', 'od', 'xxd', 'hexdump', 'strings', 'md5sum', 'sha1sum', 'sha256sum', 'shasum', 'column', 'nl', 'fold', 'tac', 'rev',
  'seq', 'type', 'cd', 'pushd', 'popd', 'unset', 'exit', 'return', 'shift', 'read', 'wait', 'clear', 'cls', 'fd', 'base64', 'sed', 'awk',
  'find', 'head', 'diff3', 'cygpath', 'tput', 'id', 'nproc', 'getconf', 'locale', 'expr', 'bc',
  // PowerShell read-only cmdlets and aliases
  'get-content', 'gc', 'get-childitem', 'gci', 'get-item', 'gi', 'get-itemproperty', 'gp', 'get-location', 'gl', 'test-path',
  'select-string', 'sls', 'select-object', 'select', 'where-object', '?', 'foreach-object', '%', 'foreach', 'sort-object',
  'measure-object', 'measure', 'format-table', 'ft', 'format-list', 'fl', 'format-wide', 'fw', 'out-string', 'out-host', 'out-null',
  'write-output', 'write', 'write-host', 'write-error', 'write-verbose', 'write-warning', 'convertfrom-json', 'convertto-json',
  'convertfrom-csv', 'convertto-csv', 'get-date', 'get-command', 'gcm', 'get-help', 'help', 'resolve-path', 'rvpa', 'split-path',
  'join-path', 'get-filehash', 'compare-object', 'compare', 'group-object', 'group', 'set-location', 'sl', 'chdir',
  'push-location', 'pop-location', 'start-sleep', 'get-member', 'gm', 'get-alias', 'gal', 'get-process', 'gps', 'ps',
  'get-psdrive', 'get-host', 'get-culture', 'get-uniquecomparer',
])
// Reserved words that PREFIX a real command (`then git push …`, `do rm …`, `! cmd`). They are stripped so the
// command after them is classified; they are never treated as commands themselves.
const KEYWORD_PREFIXES = new Set(['if', 'then', 'else', 'elif', 'elseif', 'fi', 'do', 'done', 'while', 'until', 'esac', '!', 'coproc',
  'function', 'try', 'catch', 'finally', 'trap', 'begin', 'process', 'end', 'param', 'switch', 'in'])
const LOOP_HEADERS = new Set(['for', 'foreach', 'select'])
const GIT_METADATA = new Set(['check-ignore', 'check-attr', 'ls-files', 'status'])
const METADATA_SAFE = new Set(['ls', 'dir', 'get-childitem', 'gci', 'test', '[', 'test-path', 'stat', 'file', 'du', 'wc', 'which',
  'where', 'basename', 'dirname', 'realpath', 'readlink', 'resolve-path', 'rvpa', 'split-path', 'join-path', 'find', 'fd', 'tree',
  'echo', 'printf', 'write-output', 'write', 'write-host', 'get-filehash', 'md5sum', 'sha1sum', 'sha256sum', 'shasum'])
const READERS = new Set(['cat', 'type', 'gc', 'get-content', 'head', 'tail', 'less', 'more', 'od', 'xxd', 'hexdump', 'strings',
  'base64', 'nl', 'tac', 'bat', 'sed', 'awk', 'cut', 'sort', 'uniq', 'jq', 'grep', 'egrep', 'fgrep', 'rg', 'select-string', 'sls',
  'diff', 'cmp', 'source', '.', 'import-csv', 'certutil'])
const WRITERS = {
  copy: new Set(['cp', 'copy', 'copy-item', 'cpi', 'xcopy', 'robocopy', 'install']),
  move: new Set(['mv', 'move', 'move-item', 'mi', 'ren', 'rename', 'rename-item', 'rni']),
  delete: new Set(['rm', 'del', 'erase', 'remove-item', 'ri', 'rd', 'rmdir', 'unlink', 'shred']),
  create: new Set(['touch', 'mkdir', 'md', 'new-item', 'ni', 'tee', 'tee-object', 'set-content', 'sc', 'add-content', 'ac',
    'out-file', 'clear-content', 'clc', 'truncate', 'chmod', 'chown', 'icacls', 'attrib', 'takeown']),
  link: new Set(['ln', 'mklink', 'new-symlink']),
}
const ENV_PRINTERS = new Set(['env', 'printenv', 'set', 'export', 'declare', 'typeset', 'compgen'])
const PROCESS_KILLERS = new Set(['kill', 'pkill', 'killall', 'taskkill', 'stop-process', 'spps', 'tskill', 'wmic'])
const NETWORK = new Set(['curl', 'wget', 'http', 'https', 'xh', 'httpie', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm',
  'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'netcat', 'telnet', 'ftp', 'socat', 'bitsadmin', 'start-bitstransfer', 'ssh-keyscan'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'git-bash', 'busybox'])
const INLINE_INTERPRETERS = { ruby: ['-e'], perl: ['-e', '-E', '-n', '-p'], php: ['-r'], lua: ['-e'], rscript: ['-e'], osascript: ['-e'], jshell: [] }
const NULL_DEVICES = /^(\/dev\/(null|stdout|stderr)|nul|\$null|<var>)$/i

/**
 * Classify a command line. Returns policy findings (never empty for a non-empty, parseable line).
 * @param {string} source
 * @param {object} ctx  { pathPolicy, contract, readPackageScripts, resolveWorkspace, gitState, platform }
 * @param {{ dialect?: 'posix'|'powershell'|'cmd', cwd?: string|null, depth?: number, backslashEscapes?: boolean }} opts
 */
export function classifyCommand(source, ctx, opts = {}) {
  const depth = opts.depth ?? 0
  const dialect = opts.dialect ?? 'posix'
  if (depth > MAX_DEPTH) return [F('run_unclassifiable_shell_input', 'shell.too_deep', 'command nesting exceeds the inspection depth')]
  if (typeof source !== 'string' || !source.trim()) return [F('run_unclassifiable_shell_input', 'shell.empty', 'empty command')]
  // Windows PowerShell treats typographic quotes (U+2018–U+201B single, U+201C–U+201E double) as real quote characters; the bounded
  // recognizer does not, so text it reads as inside a string could be a live statement. Such commands are unclassifiable (V2 transition
  // review round 6). Bash and cmd treat them as ordinary characters.
  if (dialect === 'powershell' && /[‘-„]/.test(source)) return [F('run_unclassifiable_shell_input', 'shell.powershell_typographic_quote', 'PowerShell typographic quote characters change how the command parses')]
  const parsed = parseShell(source, { dialect, backslashEscapes: opts.backslashEscapes })
  if (!parsed.ok) return [F('run_unclassifiable_shell_input', 'shell.unparseable', `the command could not be parsed safely (${parsed.reason})`)]
  const findings = []
  for (const feature of parsed.features) {
    if (['ansi_c_quote', 'complex_parameter_expansion', 'heredoc_unterminated', 'powershell_redirect_stream'].includes(feature)) {
      findings.push(F('run_unrecognized_command', `shell.${feature}`, `unsupported shell construct (${feature})`))
    }
  }
  for (const sub of parsed.substitutions) findings.push(...classifyCommand(sub, ctx, { ...opts, depth: depth + 1 }))
  const state = { cwd: opts.cwd === undefined ? ctx.cwd : opts.cwd, dialect, depth, source: `${opts.outerSource ?? ''}\n${source}`, flowCertain: cwdFlowIsCertain(source, dialect) }
  parsed.commands.forEach((cmd, i) => {
    state.pipedIn = i > 0 && Boolean(parsed.commands[i - 1].pipesOut)
    findings.push(...classifySimple(cmd, ctx, state))
  })
  // Opaque parts (inline code, unknown programs, unreviewed scripts, remote shells, .NET calls) may act on any
  // literal in the line, so mutation-only GitHub endpoints anywhere in it are forbidden.
  // HTTP clients (`network.http.*`) are parsed structurally and are not opaque.
  if (findings.some((f) => OPAQUE_ACTIONS.has(f.action) && !f.code.startsWith('network.http.'))) findings.push(...opaqueGithubFindings(source))
  if (!findings.length) findings.push(F('read_repository', 'shell.noop', 'no effect'))
  return findings
}

function recurse(ctx, state, source, overrides = {}) {
  return classifyCommand(source, ctx, { dialect: state.dialect, cwd: state.cwd, depth: state.depth + 1, outerSource: state.source, ...overrides })
}

function classifySimple(cmd, ctx, state) {
  const findings = []
  const pp = ctx.pathPolicy
  for (const { name, value } of cmd.assignments) findings.push(...assignmentFindings(name, value.text))

  let words = cmd.words.slice()
  if (state.dialect === 'powershell' && words.length >= 2 && words[0].dynamic && /^[+\-*/]?=$/.test(words[1].text)) {
    if (words[0].vars.some(isSensitiveVarName) || /^\$env:/i.test(words[0].text)) findings.push(...assignmentFindings(words[0].vars[0], words.slice(2).map((w) => w.text).join(' ')))
    words = words.slice(2)
  }
  const unwrapped = unwrap(words, ctx, state, findings)
  words = unwrapped.words
  const exe = words.length ? execName(words[0]) : ''
  const pipesOut = Boolean(cmd.pipesOut)
  const gitSub = exe === 'git' ? words.slice(1).find((w) => !w.text.startsWith('-'))?.text.toLowerCase() : null
  const findRunsCommands = (exe === 'find' || exe === 'fd') && words.some((w) => /^(-exec|-execdir|-ok|-okdir|-delete|-fprint0?|-fprintf|-fls|-x|-X|--exec|--exec-batch)$/.test(w.text))
  const isData = (METADATA_SAFE.has(exe) || LOOP_HEADERS.has(exe) || GIT_METADATA.has(gitSub)) && !pipesOut && !findRunsCommands

  // Redirect targets.
  for (const r of cmd.redirects) {
    if (r.op === '<<<') continue
    const target = r.target
    if (!target) continue
    if (r.op.includes('<') && !r.op.includes('>')) {
      if (target.dynamic) findings.push(F('run_unrecognized_command', 'shell.dynamic_input', 'input redirect from a computed path'))
      else findings.push(pp.classifyRead(target.text, state.cwd))
      continue
    }
    if (NULL_DEVICES.test(target.text) || (target.dynamic && target.vars.includes('null'))) continue
    if (target.dynamic) { findings.push(F('edit_outside_task_worktree', 'shell.dynamic_redirect', 'output redirect to a computed path')); continue }
    findings.push(pp.classifyWrite(target.text, { cwd: state.cwd, mode: r.op.includes('>>') ? 'edit' : 'write', content: cmd.heredocs.join('\n') }))
  }

  // Credential exposure through variables and file references.
  for (const w of words) {
    if (w.vars.some(isSensitiveVarName)) { findings.push(F('read_production_or_publisher_credentials', 'credential.env_var', 'references a credential environment variable')); break }
  }
  if (!isData) {
    const skip = unwrapped.dataIndexes ?? messageIndexes(exe, words)
    if (words.some((w, i) => !skip.has(i) && wordIsSensitive(w))) {
      findings.push(F('read_production_or_publisher_credentials', 'credential.file_reference', 'references a credential or secret file'))
    }
  }
  if (words.some((w, i) => i > 0 && hasShortNameSegment(w.text))) findings.push(F('run_unrecognized_command', 'path.short_name', '8.3 short-name path can alias protected or credential files'))
  const joined = words.map((w) => w.text).join(' ')
  if (!isData || cmd.redirects.length) {
    const activation = detectActivation(`${joined} ${cmd.assignments.map((a) => `${a.name}=${a.value.text}`).join(' ')}`)
    if (activation) findings.push(F(activation.action, activation.code, activation.detail))
  }
  if (!words.length) return findings.length ? findings : [F('read_repository', 'shell.assignment', 'variable assignment')]
  if (exe === '<dynamic>') return [...findings, F('run_unrecognized_command', 'shell.dynamic_executable', 'the executable name is computed at runtime')]
  if (unwrapped.handled) return findings

  const env = { ctx, state, cmd, words, exe, findings, recurse: (src, o) => recurse(ctx, state, src, o), pipesOut }
  env.inline = (code) => inlineCode(env, code)
  env.script = (word, extra) => scriptExecution(env, word, extra)
  const handler = TOOL_HANDLERS[exe]
  if (handler) { handler(env); return findings }
  classifyGeneric(env)
  return findings
}

function assignmentFindings(name, value) {
  const out = []
  if (/^GIT_CONFIG|^GIT_(DIR|WORK_TREE|EXEC_PATH|SSH|SSH_COMMAND|ASKPASS|EDITOR|SEQUENCE_EDITOR|TEMPLATE_DIR|EXTERNAL_DIFF)$/i.test(name ?? '')) {
    out.push(/hookspath/i.test(value) ? F('bypass_git_hooks_or_ci', 'env.git_hooks', 'git configuration override disables hooks')
      : F('modify_git_configuration_or_remotes', 'env.git_override', `git environment override (${name})`))
  }
  const skipsHooks = (/^(HUSKY|LEFTHOOK)$/i.test(name ?? '') && /^(0|false|off)$/i.test(value.trim())) ||
    (/^(SKIP|SKIP_HOOKS|PRE_COMMIT_ALLOW_NO_CONFIG|HUSKY_SKIP_HOOKS)$/i.test(name ?? '') && value.trim() !== '')
  if (skipsHooks) out.push(F('bypass_git_hooks_or_ci', 'env.hook_skip', `${name} skips git hooks`))
  if (/^(NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_[A-Z_]+|PYTHONSTARTUP|PYTHONPATH|PYTHONHOME|BASH_ENV|ENV|PROMPT_COMMAND|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|EDITOR|VISUAL|PAGER|MANPAGER|LESS[A-Z_]*|PATH|SHELL|COMSPEC|PATHEXT|npm_config_[a-z_]+|NPM_CONFIG_[A-Z_]+|GIT_[A-Z_]+)$/.test(name ?? '') && !/^GIT_(CONFIG|DIR|WORK_TREE)/.test(name ?? '') &&
    !/^GIT_(TERMINAL_PROMPT|AUTHOR_[A-Z]+|COMMITTER_[A-Z]+|TRACE[A-Z_]*|OPTIONAL_LOCKS|FLUSH|PROGRESS_DELAY|MERGE_AUTOEDIT)$/.test(name ?? '') &&
    !(/PAGER$/.test(name ?? '') && /^(cat|less|more|)$/.test(value.trim()))) {
    out.push(F('run_interpreter_inline_code', 'env.code_injection', `${name} can make child processes run other programs`))
  }
  if (/^(GITHUB_ACTIONS|RUNNER_[A-Z_]+|GITHUB_WORKFLOW|GITHUB_RUN_ID)$/.test(name ?? '')) {
    out.push(F('bypass_git_hooks_or_ci', 'env.ci_spoof', `${name} impersonates a GitHub Actions runner, which disables the local policy hook`))
  }
  if (REMOTE_DATABASE.test(value)) out.push(F('access_customer_data', 'env.remote_database', 'assigns a remote database target'))
  if (textReferencesSensitive(value)) out.push(F('read_production_or_publisher_credentials', 'env.secret_file', 'assignment references a credential file'))
  return out
}

/** Indexes of words that are free-text messages (commit messages, PR bodies), excluded from file-reference scans. */
function messageIndexes(exe, words) {
  const skip = new Set()
  const messageFlags = exe === 'git' ? ['-m', '--message'] : exe === 'gh' ? ['--body', '-b', '--title', '-t'] : []
  words.forEach((w, i) => {
    if (messageFlags.includes(w.text) && words[i + 1]) skip.add(i + 1)
    if (messageFlags.some((f) => f.startsWith('--') && w.text.startsWith(`${f}=`))) skip.add(i)
  })
  return skip
}

/** Strip transparent wrappers (env, timeout, xargs, rtk, …); returns the effective command words. */
function unwrap(words, ctx, state, findings) {
  let w = words
  for (let guard = 0; guard < 16 && w.length; guard++) {
    const exe = execName(w[0])
    if (KEYWORD_PREFIXES.has(exe) && !w[0].quoted) { w = w.slice(1); continue }
    if (exe === 'env') {
      let i = 1
      while (i < w.length) {
        const t = w[i].text
        if (t === '-i' || t === '-0' || t === '--ignore-environment' || t === '--null' || t === '-') { i++; continue }
        if (t === '-u' || t === '--unset' || t === '-C' || t === '--chdir') { i += 2; continue }
        if (t.startsWith('-S') || t.startsWith('--split-string')) {
          findings.push(...recurse(ctx, state, w.slice(i + (t.includes('=') || t.length > 2 ? 0 : 1)).map((x) => x.text).join(' ').replace(/^(-S|--split-string=?)/, '')))
          return { words: [], handled: true }
        }
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(t)
        if (m) { findings.push(...assignmentFindings(m[1], m[2])); i++; continue }
        break
      }
      if (i >= w.length) {
        findings.push(F('read_production_or_publisher_credentials', 'credential.env_dump', 'printing the environment can expose credentials'))
        return { words: [], handled: true }
      }
      w = w.slice(i)
      continue
    }
    if (['command', 'builtin', 'exec', 'nohup', 'time', 'noglob', 'winpty', 'call', 'nice', 'ionice', 'chrt', 'taskset'].includes(exe)) {
      if (exe === 'command' && ['-v', '-V'].includes(w[1]?.text)) return { words: [], handled: true }
      let i = 1
      while (i < w.length && w[i].text.startsWith('-')) i += ['-n', '-c', '-p'].includes(w[i].text) && exe !== 'command' ? 2 : 1
      w = w.slice(i)
      continue
    }
    if (exe === 'timeout' || exe === 'stdbuf') {
      let i = 1
      while (i < w.length && w[i].text.startsWith('-')) i += ['-s', '-k', '--signal', '--kill-after'].includes(w[i].text) ? 2 : 1
      if (exe === 'timeout') i++ // duration
      w = w.slice(i)
      continue
    }
    if (exe === 'sudo' || exe === 'doas' || exe === 'runas' || exe === 'gsudo') {
      findings.push(F('run_unrecognized_command', 'shell.privilege', 'elevated privileges'))
      let i = 1
      while (i < w.length && w[i].text.startsWith('-')) i += ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U'].includes(w[i].text) ? 2 : 1
      w = w.slice(i)
      continue
    }
    if (exe === 'rtk') {
      const sub = w[1]?.text?.toLowerCase()
      if (!sub || ['gain', 'discover', '--version', '-v', '-V', 'help', '--help', 'init', 'config'].includes(sub)) return { words: [], handled: true }
      w = w.slice(sub === 'proxy' ? 2 : 1)
      continue
    }
    if (exe === 'xargs') {
      let i = 1
      while (i < w.length && w[i].text.startsWith('-')) i += /^-(I|n|P|L|d|E|s|a|i)$/.test(w[i].text) || /^--(arg-file|delimiter|max-args|max-procs|replace)$/.test(w[i].text) ? 2 : 1
      w = w.slice(i)
      if (!w.length) return { words: [], handled: true }
      const inner = execName(w[0])
      if (!SAFE_READONLY.has(inner) || READERS.has(inner)) findings.push(F('run_unrecognized_command', 'shell.xargs', 'arguments are supplied at runtime by xargs'))
      continue
    }
    if (exe === 'wsl' || exe === 'wsl.exe') {
      let i = 1
      while (i < w.length && w[i].text.startsWith('-')) {
        if (['-e', '--exec', '--'].includes(w[i].text)) { i++; break }
        i += ['-d', '--distribution', '-u', '--user', '--cd'].includes(w[i].text) ? 2 : 1
      }
      w = w.slice(i)
      continue
    }
    if (exe === 'start' && state.dialect === 'cmd') {
      let i = 1
      while (i < w.length && (w[i].text.startsWith('/') || (i === 1 && w[i].quoted))) i++
      w = w.slice(i)
      continue
    }
    if (exe === 'invoke-expression' || exe === 'iex' || exe === 'eval') {
      if (w.slice(1).some((x) => x.dynamic)) findings.push(F('run_unrecognized_command', 'shell.dynamic_eval', 'evaluates computed text'))
      findings.push(...recurse(ctx, state, w.slice(1).map((x) => x.text).join(' ')))
      return { words: [], handled: true }
    }
    if (exe === 'start-process' || exe === 'saps' || (exe === 'start' && state.dialect === 'powershell')) {
      const file = flagValue(w, '-FilePath', '-filepath') ?? positionals(w, 1, new Set(['-ArgumentList', '-WorkingDirectory', '-Verb', '-WindowStyle', '-RedirectStandardOutput', '-RedirectStandardError']))[0]?.text
      const args = flagValue(w, '-ArgumentList', '-argumentlist', '-Args') ?? ''
      if (hasFlag(w, '-Verb')) findings.push(F('run_unrecognized_command', 'shell.privilege', 'Start-Process -Verb'))
      if (!file) { findings.push(F('run_unrecognized_command', 'shell.start_process', 'Start-Process without a resolvable program')); return { words: [], handled: true } }
      findings.push(...recurse(ctx, state, `${JSON.stringify(file)} ${String(args).replace(/,/g, ' ')}`))
      return { words: [], handled: true }
    }
    break
  }
  return { words: w, handled: false }
}

function classifyGeneric(env) {
  const { ctx, state, words, exe, findings } = env
  const pp = ctx.pathPolicy
  const args = words.slice(1)
  if (exe === 'popd' || exe === 'pop-location') { // the directory stack is not tracked: the cwd is unknown afterwards
    state.cwd = null
    state.branchMayHaveChanged = true
    findings.push(F('read_repository', 'shell.cd', 'change directory'))
    return
  }
  if (exe === 'cd' || exe === 'set-location' || exe === 'sl' || exe === 'chdir' || exe === 'pushd' || exe === 'push-location') {
    const target = args.find((a) => !a.text.startsWith('-'))
    // The new cwd is trusted only when the `cd` certainly took effect in THIS shell (linear flow, one operand, the command itself or under builtin/command/time, existing PowerShell
    // directory) and is tracked as the shell tracks it (typed path: link-crossing targets, `pushd +1`, CDPATH leave it unknown).
    const certain = state.flowCertain && args.filter((a) => !a.text.startsWith('-')).length <= 1 && ['builtin', 'command', 'time', exe].includes(execName(env.cmd.words[0])) &&
      (state.dialect !== 'powershell' || !target || (isPlainPathText(target.text, { relative: true }) && pp.isDirectory(pp.resolve(target.text, state.cwd))))
    const r = target && !target.dynamic && !pp.unknownCwd(target.text, state.cwd) ? pp.resolveChecked(target.text, state.cwd) : null
    const diverges = r && (r.failed || r.alt || (r.lex && r.abs.toLowerCase() !== r.lex.toLowerCase()))
    // Only plain options (-L/-P/-e/-@; PowerShell -Path/-LiteralPath) are understood (`pushd -n`, -StackName, `cd -` are not); bare `pushd` swaps.
    const ps = exe === 'set-location' || exe === 'sl' || exe === 'push-location'
    const okOpt = (t) => (ps ? ['path', 'literalpath'].some((n) => t.length > 2 && n.startsWith(t.slice(1).toLowerCase())) : /^-[LPe@]+$/.test(t))
    const oddOpts = args.some((a) => a.text.startsWith('-') && a.text !== '--' && !okOpt(a.text))
    const bareStack = !target && (exe === 'pushd' || exe === 'push-location')
    const unknown = bareStack || oddOpts || (target && (/^[+-]\d+$/.test(target.text) || /\bCDPATH\b/.test(state.source ?? '')))
    state.cwd = unknown || !certain ? null : !target ? ctx.homeDir ?? null
      : target.dynamic || target.text === '-' || unknown || diverges || pp.unknownCwd(target.text, state.cwd) ? null
        : pp.resolve(target.text, state.cwd)
    state.branchMayHaveChanged = true
    findings.push(F('read_repository', 'shell.cd', 'change directory'))
    return
  }
  if (LOOP_HEADERS.has(exe)) { findings.push(F('read_repository', 'shell.loop_header', 'loop header (loop body is classified separately)')); return }
  if (ENV_PRINTERS.has(exe)) return envPrinter(env)
  if (exe === 'get-childitem' || exe === 'gci' || exe === 'get-item' || exe === 'gi' || exe === 'get-content' || exe === 'gc' || exe === 'ls' || exe === 'dir' || exe === 'cat' || exe === 'type') {
    const envPath = args.find((a) => /^env:/i.test(a.text))
    if (envPath) {
      const name = envPath.text.slice(4).replace(/^\\/, '')
      findings.push(!name || /[*?]/.test(name) || isSensitiveVarName(name)
        ? F('read_production_or_publisher_credentials', 'credential.env_dump', 'reading environment variables can expose credentials')
        : F('read_repository', 'shell.env_read', 'reads a non-credential environment variable'))
      return
    }
  }
  if (PROCESS_KILLERS.has(exe)) { findings.push(F('terminate_processes', 'process.kill', 'terminating processes requires explicit approval')); return }
  if (NETWORK.has(exe)) return networkCommand(env)
  if (SHELLS.has(exe)) return shellCommand(env)
  if (exe === 'pwsh' || exe === 'powershell') return powershellCommand(env)
  if (exe === 'cmd') return cmdCommand(env)
  if (exe in INLINE_INTERPRETERS) {
    const flags = INLINE_INTERPRETERS[exe]
    const idx = words.findIndex((w, i) => i > 0 && (flags.includes(w.text) || /^-[a-z]*[eEr]$/.test(w.text)))
    if (idx > 0 && words[idx + 1]) return inlineCode(env, words[idx + 1].text)
    return scriptExecution(env, positionals(words)[0])
  }
  for (const [mode, set] of Object.entries(WRITERS)) if (set.has(exe)) return fileWriter(env, mode)
  if (exe === 'sed' && words.some((w) => /^(-[a-zA-Z]*i|--in-place)/.test(w.text))) return fileWriter(env, 'sed')
  if (exe === 'perl' || exe === 'dd') return fileWriter(env, exe)
  if (exe === 'awk' || exe === 'gawk') {
    const program = positionals(words, 1, new Set(['-f', '-v', '-F']))[0]?.text ?? ''
    if (/\bsystem\s*\(|\||>|getline/.test(program) || hasFlag(words, '-f')) findings.push(F('run_interpreter_inline_code', 'awk.side_effects', 'awk program may run commands or write files'))
  }
  if (exe === 'find' || exe === 'fd') {
    const execFlags = exe === 'find' ? ['-exec', '-execdir', '-ok', '-okdir'] : ['-x', '-X', '--exec', '--exec-batch']
    const i = words.findIndex((w) => execFlags.includes(w.text))
    if (i > 0) {
      const end = words.findIndex((w, j) => j > i && (w.text === ';' || w.text === '+'))
      findings.push(F('run_unrecognized_command', `${exe}.exec`, `${exe} runs a command on every match`))
      findings.push(...env.recurse(words.slice(i + 1, end < 0 ? undefined : end).map((w) => JSON.stringify(w.text)).join(' ')))
    }
    if (words.some((w) => /^-(delete|fprint0?|fprintf|fls)$/.test(w.text))) findings.push(F('discard_or_rewrite_local_work', 'find.delete', 'find deletes or writes files'))
  }
  // "Read-only" tools that can still write files or run programs through specific options.
  const sideEffect = readOnlySideEffect(env)
  if (sideEffect) { findings.push(...sideEffect); return }
  if (READERS.has(exe)) {
    if (args.some((a) => a.dynamic && !a.text.startsWith('-'))) findings.push(F('run_unrecognized_command', 'fs.dynamic_read', 'reads a computed path'))
    if (args.some((a) => a.glob && (/(^|[\\/])\.[^\\/]*[*?[]/.test(a.text) || globMayMatchSecret(a.text)))) findings.push(F('run_unrecognized_command', 'fs.secret_glob', 'glob may match credential files (PowerShell wildcards include dotfiles)'))
    if (['grep', 'egrep', 'fgrep'].includes(exe) && args.some((a) => /^-[a-zA-Z]*[rR]|^--(recursive|dereference-recursive)$|^--d(irectories)?=recurse/.test(a.text))) {
      findings.push(F('run_unrecognized_command', 'fs.recursive_grep', 'recursive grep ignores .gitignore and reads credential files; use the Grep tool or rg'))
    }
    if (exe === 'rg' && args.some((a) => /^-[a-zA-Z]*u|^--(hidden|no-ignore[\w-]*|unrestricted)$|^-\.$/.test(a.text))) {
      findings.push(F('run_unrecognized_command', 'fs.unrestricted_search', 'unrestricted search reaches ignored credential files'))
    }
  }
  if (SAFE_READONLY.has(exe) || /^(test|select|measure|format|convertfrom|convertto|compare|group)-/.test(exe)) {
    findings.push(F('read_repository', 'shell.read_only', 'read-only command'))
    return
  }
  if (exe === 'source' || exe === '.') return scriptExecution(env, words[1], { interpreter: 'source', args: words.slice(2) })
  if (isPathLike(words[0].text)) return scriptExecution(env, words[0], { args: words.slice(1) })
  findings.push(F('run_unrecognized_command', 'shell.unrecognized', `unrecognized command '${exe.slice(0, 40)}'`,
    { exe, words: words.map((w) => w.text), dynamic: words.some((w) => w.dynamic) }))
  findings.push(...signatureFindings(words.map((w) => w.text).join(' ')))
}

function envPrinter({ words, exe, findings }) {
  const args = words.slice(1)
  const names = args.filter((a) => !a.text.startsWith('-')).map((a) => a.text)
  const dump = (exe === 'printenv' || exe === 'env') ? names.length === 0
    : exe === 'set' ? args.length === 0
      : exe === 'export' || exe === 'declare' || exe === 'typeset' ? names.length === 0 || args.some((a) => a.text === '-p' && names.length === 0)
        : exe === 'compgen'
  if (dump) { findings.push(F('read_production_or_publisher_credentials', 'credential.env_dump', 'printing the environment can expose credentials')); return }
  if (exe === 'printenv' && names.some(isSensitiveVarName)) { findings.push(F('read_production_or_publisher_credentials', 'credential.env_var', 'prints a credential environment variable')); return }
  for (const n of names) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(n)
    if (m) findings.push(...assignmentFindings(m[1], m[2]))
  }
  findings.push(F('read_repository', 'shell.env_builtin', 'shell variable builtin'))
}

function networkCommand({ ctx, words, findings, exe, state }) {
  const joined = words.map((w) => w.text).join(' ')
  if (REMOTE_DATABASE.test(joined)) { findings.push(F('access_customer_data', 'network.remote_database', 'direct request to a remote database or Supabase project')); return }
  // HTTP clients: classify the request by effect (method, target, body), not by flag spelling.
  const req = parseHttpRequest(exe, words, { pipedIn: state.pipedIn, line: state.source })
  const effects = req ? httpMutationFindings(req, ctx) : null
  const mutating = req ? Boolean(effects) || Boolean(req.method && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) || req.bodies.length > 0 || req.opaqueBody
    : /\s(-X|--request|-Method|--method)\s+(POST|PUT|PATCH|DELETE)\b|\s(-d|--data[\w-]*|-F|--form|-T|--upload-file|-Body|--json)\b/i.test(` ${joined}`)
  if (/\/billing\/monthly-trueup\b/i.test(joined) || (mutating && /\/v1\/agent[\w/-]*(grant|decide|activat|autonom|billing|pause|resume)/i.test(joined))) {
    findings.push(F('activate_customer_agent_execution', 'network.agent_activation', 'request to a customer-agent activation, grant or billing endpoint'))
    return
  }
  if (effects) findings.push(...effects)
  findings.push(F('network_request_or_remote_shell', req ? `network.http.${exe}` : `network.${exe}`, `network request or remote shell (${exe})`))
}

function shellCommand(env) {
  const { words, cmd, findings } = env
  const cIdx = words.findIndex((w, i) => i > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w.text) && !w.text.startsWith('--'))
  if (cIdx > 0) {
    const script = words[cIdx + 1]
    if (!script) { findings.push(F('run_unclassifiable_shell_input', 'shell.missing_script', 'shell -c without a script')); return }
    if (script.dynamic) findings.push(F('run_unrecognized_command', 'shell.dynamic_script', 'shell script text is computed at runtime'))
    findings.push(...env.recurse(script.text, { dialect: 'posix', backslashEscapes: true }))
    return
  }
  const scriptWord = positionals(words, 1, new Set(['-o', '-O', '+o']))[0]
  if (scriptWord && !['--version', '--help'].includes(scriptWord.text)) return scriptExecution(env, scriptWord)
  if (cmd.heredocs.length) { findings.push(...env.recurse(cmd.heredocs.join('\n'), { dialect: 'posix', backslashEscapes: true })); return }
  if (words.some((w) => ['--version', '--help'].includes(w.text))) { findings.push(F('read_repository', 'shell.version', 'version query')); return }
  findings.push(F('run_unrecognized_command', 'shell.stdin_script', 'shell reads its script from stdin'))
}

function powershellCommand(env) {
  const { words, findings } = env
  for (let i = 1; i < words.length; i++) {
    const t = words[i].text.toLowerCase()
    if (/^[-/](e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedcommand|encodedcom\w*)$/.test(t)) {
      findings.push(F('run_unclassifiable_shell_input', 'shell.encoded_command', 'encoded PowerShell commands cannot be inspected'))
      return
    }
    if (/^[-/](c|co|com|comm|comma|comman|command)$/.test(t)) {
      const rest = words.slice(i + 1)
      if (!rest.length || rest[0].text === '-') { findings.push(F('run_unrecognized_command', 'shell.stdin_script', 'PowerShell reads its script from stdin')); return }
      if (rest.some((w) => w.dynamic)) findings.push(F('run_unrecognized_command', 'shell.dynamic_script', 'PowerShell script text is computed at runtime'))
      findings.push(...env.recurse(rest.map((w) => w.text).join(' '), { dialect: 'powershell' }))
      return
    }
    if (/^[-/](f|fi|fil|file)$/.test(t)) return scriptExecution(env, words[i + 1])
    if (/^[-/](executionpolicy|ep|ex|exec|windowstyle|w|wi|workingdirectory|wd|inputformat|outputformat|of|if|version|v|configurationname|psconsolefile|settingsfile)$/.test(t)) { i++; continue }
    if (t.startsWith('-') || t.startsWith('/')) continue
    if (/\.ps1$/i.test(words[i].text)) return scriptExecution(env, words[i])
    findings.push(...env.recurse(words.slice(i).map((w) => w.text).join(' '), { dialect: 'powershell' }))
    return
  }
  findings.push(F('run_unrecognized_command', 'shell.interactive', 'interactive PowerShell session'))
}

function cmdCommand(env) {
  const { words, findings } = env
  const idx = words.findIndex((w, i) => i > 0 && /^\/[ck]$/i.test(w.text))
  if (idx < 0) { findings.push(F('run_unrecognized_command', 'shell.interactive', 'interactive cmd session')); return }
  const rest = words.slice(idx + 1)
  if (!rest.length) { findings.push(F('run_unclassifiable_shell_input', 'shell.missing_script', 'cmd /c without a command')); return }
  findings.push(...env.recurse(rest.map((w) => w.text).join(' '), { dialect: 'cmd' }))
}

/** Interpreter inline code is opaque: always ≥ human_approval; forbidden when a protected effect is visible. */
export function inlineCode(env, code) {
  const { findings, state } = env
  findings.push(F('run_interpreter_inline_code', 'interpreter.inline_code', 'inline interpreter code is not inspected; nested effects are unknown', { code: String(code ?? ''), exe: env.exe }))
  findings.push(...signatureFindings(code))
  if (state.depth < MAX_DEPTH) {
    for (const literal of stringLiterals(code)) {
      if (!/^\s*[\w./\\-]+\s+\S/.test(literal)) continue
      const nested = env.recurse(literal, { dialect: 'posix' })
      findings.push(...nested.filter((f) => env.ctx.classOf(f.action) === 'forbidden'))
    }
  }
}

/**
 * Running a script file: contents are not inspected, so never `allowed`; trusted release scripts are forbidden. `extra` carries the
 * interpreter, the interpreter flags before the script and the script arguments when the caller knows them (node, python, a path).
 */
export function scriptExecution(env, word, extra = {}) {
  const { ctx, state, findings } = env
  if (!word) { findings.push(F('run_unrecognized_command', 'script.interactive', 'interactive interpreter session')); return }
  if (word.dynamic) { findings.push(F('run_unrecognized_command', 'script.dynamic', 'script path is computed at runtime')); return }
  const abs = ctx.pathPolicy.resolve(word.text, state.cwd)
  const rel = ctx.pathPolicy.repoRelative(abs)
  const relLower = (rel ?? normalizeSlashes(word.text)).toLowerCase()
  const trusted = ctx.contract.protected_infrastructure.map((p) => p.toLowerCase())
  if (trusted.includes(relLower) || (/^scripts\/[^/]*(production|staging|remote|publish|merge|release|deploy|rollback|drift|dispatch|recovery|ship|auto-merge|watchdog|smoke)[^/]*$/.test(relLower) && !/\.test\.[cm]?js$/.test(relLower))) {
    findings.push(F('create_alternate_publishing_or_deployment_path', 'script.trusted_release_or_remote', 'trusted release, publishing or remote-environment script'))
    return
  }
  if (ctx.pathPolicy.isMigrationPath(abs, word.text)) { findings.push(F('run_local_docker_or_database_stack', 'script.sql', 'executes SQL')); return }
  const pre = extra.preFlags ?? []
  const args = extra.args ?? []
  const meta = { abs, rel, interpreter: extra.interpreter ?? null, preFlags: pre.map((w) => w.text), args: args.map((w) => w.text), dynamicArgs: [...pre, ...args].some((w) => w.dynamic) }
  // The pin tool's --write form rewrites the owner-reviewed trust pins (a protected policy file): owner-only, never bypass-authorized.
  if (relLower === PIN_TOOL && meta.args.some((a) => /^--write(=|$)/.test(a))) {
    findings.push(F('modify_control_plane_files', 'policy.pin_write', 'rewrites the owner-reviewed bypass trust pins (owner-only)', meta))
    return
  }
  // Privileged host-side infrastructure (declared per scope in bypass-scopes.json) is classified on its own so that an owner-launched
  // bypass session can run it ONLY from owner-pinned digests. Same class as an unreviewed script, so other modes are unchanged.
  const priv = rel === null ? null : privilegedMatch(ctx.bypassScopes, rel)
  if (priv) {
    findings.push(F('run_privileged_infrastructure', priv.entrypoint ? 'infra.trusted_entrypoint' : 'infra.closure_file',
      `privileged ${priv.scope} infrastructure code (${rel.slice(-60)}); runs without a prompt only from owner-pinned digests`, { ...meta, scope: priv.scope, execution: priv.execution }))
    return
  }
  findings.push(F('run_unreviewed_script', 'script.unreviewed', `script contents are not inspected (${(rel ?? word.text).slice(-60)})`, meta))
}
