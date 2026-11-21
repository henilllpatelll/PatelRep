// Developer Harness V2 — file-operation policy helpers (Phase 2): writers and the write/exec options of
// otherwise read-only tools. Split from command-policy.mjs; pure, never executes anything.
import { F, positionals, hasFlag, flagValue } from './policy-common.mjs'

const SECRET_NAME_SAMPLES = ['.env', '.env.local', '.env.production', '.env.staging', 'prod.env', 'id_rsa', 'id_ed25519', '.npmrc', '.netrc',
  'credentials.json', 'key.pem', '.git-credentials']
/** Whether a glob's last segment could match a credential file name. */
export function globMayMatchSecret(text) {
  const base = String(text).split(/[\\/]/).pop()
  if (!/[*?[]/.test(base)) return false
  const re = new RegExp(`^${base.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
  return SECRET_NAME_SAMPLES.some((n) => re.test(n))
}

/** Options that turn an otherwise read-only tool into a writer or a program launcher. */
export function readOnlySideEffect({ ctx, state, words, exe }) {
  const pp = ctx.pathPolicy
  const out = []
  const write = (target) => out.push(target ? pp.classifyWrite(target, { cwd: state.cwd }) : F('edit_outside_task_worktree', 'fs.unknown_output', 'output target unknown'))
  const pos = positionals(words, 1, new Set(['-e', '-f', '-o', '--output', '-n', '-k', '-t', '-m', '-A', '-B', '-C']))
  if (exe === 'sed') {
    const script = flagValue(words, '-e', '--expression') ?? positionals(words, 1, new Set(['-e', '-f', '--expression', '--file', '-l']))[0]?.text ?? ''
    // GNU sed: `e` executes a command, `w`/`W` write files, `r`/`R` read files.
    if (/(^|[;{}\n]|[0-9$/]\s*)\s*[eWwrR]\b|\/[gpIiMm0-9]*[ewW](\s|$)/.test(script) || hasFlag(words, '-f', '--file')) out.push(F('run_interpreter_inline_code', 'sed.side_effects', 'sed script runs commands or reads/writes files'))
  }
  if (exe === 'rg' && words.some((w) => /^--pre(-glob)?(=|$)/.test(w.text))) out.push(F('run_unrecognized_command', 'rg.preprocessor', 'rg --pre runs a program on every file'))
  if (exe === 'sort' && hasFlag(words, '-o', '--output')) write(flagValue(words, '-o', '--output'))
  if (exe === 'uniq' && pos.length >= 2) write(pos[1].text)
  if (exe === 'tree' && hasFlag(words, '-o')) write(flagValue(words, '-o'))
  if (exe === 'xxd' && hasFlag(words, '-r', '-revert') && pos.length >= 2) write(pos[1].text)
  if ((exe === 'base64' || exe === 'certutil') && hasFlag(words, '-o', '--output', '-decode', '-encode', '-urlcache')) out.push(F('run_unrecognized_command', `${exe}.output`, `${exe} writes or downloads files`))
  if (exe === 'tee') pos.forEach((w) => write(w.text))
  return out.length ? out : null
}

export function fileWriter(env, mode) {
  const { ctx, state, words, findings } = env
  const pp = ctx.pathPolicy
  const cwd = state.cwd
  const valueFlags = new Set(['-Path', '-LiteralPath', '-Destination', '-Value', '-Encoding', '-ItemType', '-Name', '-NewName', '-Target', '-Filter', '-Include', '-Exclude', '-t', '-m', '--target-directory', '-S', '--suffix', '-e', '-f', '-o'])
  if (mode === 'perl') {
    const code = flagValue(words, '-e', '-E', '-pe', '-pi', '-ne')
    if (code !== undefined) { env.inline(code) } else env.script(positionals(words)[0])
    if (words.some((w) => /^-[a-zA-Z]*i/.test(w.text))) positionals(words, 1, new Set(['-e', '-E'])).slice(code === undefined ? 1 : 0).forEach((w) => findings.push(pp.classifyWrite(w.text, { cwd, mode: 'edit' })))
    return
  }
  if (mode === 'dd') {
    for (const w of words) {
      if (w.text.startsWith('of=')) findings.push(pp.classifyWrite(w.text.slice(3), { cwd }))
      if (w.text.startsWith('if=')) findings.push(pp.classifyRead(w.text.slice(3), cwd))
    }
    return
  }
  const named = [flagValue(words, '-Path', '-LiteralPath', '-path', '-literalpath'), flagValue(words, '-Destination', '-destination')].filter(Boolean)
  let targets = positionals(words, 1, valueFlags)
  if (mode === 'sed') targets = flagValue(words, '-e', '--expression', '-f') !== undefined ? targets : targets.slice(1)
  const texts = [...targets.map((t) => t), ...named.map((text) => ({ text, dynamic: /\$/.test(text), glob: /[*?]/.test(text) }))]
  if (texts.some((t) => t.dynamic)) findings.push(F('edit_outside_task_worktree', 'fs.dynamic_target', 'file operation on a computed path'))
  if (mode === 'link') findings.push(F('run_unrecognized_command', 'fs.link', 'links can redirect protected or credential paths'))
  if (mode === 'delete' && words.some((w) => /^-[a-zA-Z]*[rR]|^--recursive$|^-recurse$|^\/s$/i.test(w.text))) {
    findings.push(F('discard_or_rewrite_local_work', 'fs.recursive_delete', 'recursive delete can discard unrelated work'))
  }
  const literal = texts.filter((t) => !t.dynamic)
  literal.forEach((t, i) => {
    const isLast = i === literal.length - 1
    if (mode === 'copy') findings.push(isLast && literal.length > 1 ? pp.classifyWrite(t.text, { cwd }) : pp.classifyRead(t.text, cwd))
    else if (mode === 'move') findings.push(pp.classifyWrite(t.text, { cwd, mode: isLast && literal.length > 1 ? 'write' : 'move' }))
    else if (mode === 'delete') findings.push(pp.classifyWrite(t.text, { cwd, mode: 'delete' }))
    else findings.push(pp.classifyWrite(t.text, { cwd, mode: mode === 'sed' ? 'edit' : 'write', content: flagValue(words, '-Value', '-value') }))
  })
  // No visible target: PowerShell writers take paths from the pipeline (`Get-ChildItem x | Remove-Item`).
  if (!literal.length && !texts.length) findings.push(F('discard_or_rewrite_local_work', 'fs.pipeline_target', 'file operation whose targets come from the pipeline'))
}
