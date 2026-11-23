// Developer Harness V2 — file-operation policy helpers (Phase 2): writers and the write/exec options of
// otherwise read-only tools. Split from command-policy.mjs; pure, never executes anything.
import { F, positionals, hasFlag, flagValue, splitFlag } from './policy-common.mjs'
import { POSIX_VALUED, LEGACY_VALUED, PS_FAMILIES, PS_FAMILY_OF, PS_ONLY_WRITERS, parsePsWriter } from './writer-options.mjs'

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
  const { ctx, state, words, findings, exe } = env
  const pp = ctx.pathPolicy
  const cwd = state.cwd
  const valueFlags = new Set(POSIX_VALUED[exe] ?? [])
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
  // copyMove ADDS effective-destination findings; copy/move/link/sed keep the legacy pass below; delete/create use writer-options.mjs.
  if (mode === 'copy' || mode === 'move') copyMove(env, mode)
  const newParser = mode === 'delete' || mode === 'create'
  const isPs = PS_ONLY_WRITERS.has(exe) || state.dialect === 'powershell'
  const psFamily = newParser && isPs ? PS_FAMILIES[PS_FAMILY_OF[exe] ?? (mode === 'delete' ? 'remove' : 'content')] : null
  let targets, names = [], value, itemType
  if (words.length > 512 || words.some((w) => w.text.length > 2048)) findings.push(F('run_unrecognized_command', 'fs.operands_too_large', 'too many or too long operands to classify'))
  if (psFamily) ({ targets, names, value, itemType } = parsePsWriter(words, psFamily))
  else {
    targets = positionals(words, 1, newParser ? new Set(valueFlags) : LEGACY_VALUED)
    if (mode === 'sed') targets = flagValue(words, '-e', '--expression', '-f') !== undefined ? targets : targets.slice(1)
    value = flagValue(words, '-Value', '-value')
  }
  const named = psFamily ? [] : [flagValue(words, '-Path', '-LiteralPath', '-path', '-literalpath'), flagValue(words, '-Destination', '-destination')].filter(Boolean)
  const texts = [...targets.map((t) => t), ...named.map((text) => ({ text, dynamic: /\$/.test(text), glob: /[*?]/.test(text) }))]
  if ([...texts, ...names].some((t) => t.dynamic)) findings.push(F('edit_outside_task_worktree', 'fs.dynamic_target', 'file operation on a computed path'))
  const linkType = psFamily ? itemType !== undefined && !/^(file|directory|dir|f|d)$/i.test(itemType) : /^(symboliclink|junction|hardlink|symlink)$/i.test(flagValue(words, '-ItemType', '-itemtype', '-Type', '-type') ?? '')
  if (mode === 'link' || (mode === 'create' && linkType)) {
    findings.push(F('run_unrecognized_command', 'fs.link', 'links can redirect protected or credential paths'))
  }
  if (mode === 'delete' && words.some((w) => /^-[a-zA-Z]*[rR]|^--recursive$|^-recurse$|^\/s$/i.test(w.text))) {
    findings.push(F('discard_or_rewrite_local_work', 'fs.recursive_delete', 'recursive delete can discard unrelated work'))
  }
  // New-Item / mkdir `-Path P -Name N` creates P\N: the EFFECTIVE destination is classified (and N on its own, in case it is absolute or
  // climbs out of P). A missing -Path means the current location.
  for (const n of names.filter((x) => !x.dynamic)) {
    for (const base of (targets.length ? targets : [wordOf(n, '.')]).filter((x) => !x.dynamic)) {
      findings.push(pp.classifyWrite(joinPath(base.text, n.text), { cwd, mode: 'write', content: value }))
    }
    findings.push(pp.classifyWrite(n.text, { cwd, mode: 'write', content: value }))
  }
  const literal = texts.filter((t) => !t.dynamic)
  literal.forEach((t, i) => {
    const isLast = i === literal.length - 1
    if (mode === 'copy') findings.push(isLast && literal.length > 1 ? pp.classifyWrite(t.text, { cwd }) : pp.classifyRead(t.text, cwd))
    else if (mode === 'move') findings.push(pp.classifyWrite(t.text, { cwd, mode: isLast && literal.length > 1 ? 'write' : 'move' }))
    // A delete reaches whatever its operand names: a glob can match protected files, and a directory takes everything
    // below it (a nested CLAUDE.md/AGENTS.md included) with it.
    else if (mode === 'delete') findings.push(...operandFindings(env, t.text, { cwd, mode: 'delete', subtree: true }))
    else findings.push(pp.classifyWrite(t.text, { cwd, mode: mode === 'sed' ? 'edit' : 'write', content: value }))
  })
  // No visible target: PowerShell writers take paths from the pipeline (`Get-ChildItem x | Remove-Item`).
  if (!literal.length && !texts.length) findings.push(F('discard_or_rewrite_local_work', 'fs.pipeline_target', 'file operation whose targets come from the pipeline'))
}

// ── Copy / move destination resolution (Phase 4 remediation) ─────────────────────────────────────────────────────
// `cp src .wolf/` writes `.wolf/<basename of src>`, not `.wolf/`; `cp -t DIR src` names the destination by option; a
// recursive `src/.` copy writes names that are unknown until runtime. The EFFECTIVE destination is therefore classified,
// not just the destination argument. Everything here is pure string/path reasoning (nothing is executed or read);
// whatever cannot be resolved is classified conservatively (never silently harmless).
const SEP = /[\\/]/
const hasGlob = (t) => /[*?[{]/.test(t)
const trimSeps = (t) => (t.length > 1 ? t.replace(/[\\/]+$/, '') || t.slice(0, 1) : t)
const lastSegment = (t) => trimSeps(t).split(SEP).pop()
const dirOf = (t) => { const c = trimSeps(t); const i = Math.max(c.lastIndexOf('/'), c.lastIndexOf('\\')); return i < 0 ? '.' : c.slice(0, i) || c.slice(0, 1) }
const joinPath = (dir, name) => `${trimSeps(dir)}/${name}`
const CONTROL = (code, detail) => F('modify_control_plane_files', code, detail)
const wordOf = (w, text) => ({ ...w, text })

function segmentRegExp(seg) {
  if (/[[{]/.test(seg)) return /^.*$/s // bracket/brace classes: treat as matching anything (conservative)
  const collapsed = seg.replace(/\*+/g, '*') // runs of `*` are one wildcard; many wildcards would backtrack catastrophically
  if (collapsed.split('*').length > 6) return /^.*$/s // too many wildcards to test cheaply: match anything (conservative)
  return new RegExp(`^${collapsed.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
}

/** Names a protected path can have directly inside the repo-relative directory `dirRel` ('' = repository root). */
function protectedChildNames(ctx, dirRel) {
  const names = new Set(['CLAUDE.md', 'AGENTS.md']) // protected in every directory
  const prefix = dirRel === '' ? '' : `${dirRel.toLowerCase()}/`
  for (const g of [...ctx.contract.protected_paths, 'supabase/migrations/**']) {
    if (g.startsWith('**') || !g.toLowerCase().startsWith(prefix)) continue
    const seg = g.slice(prefix.length).split('/')[0]
    if (seg) names.add(seg)
  }
  return names
}

/** Whether a glob segment (matched directly inside `dirAbs`) could name a protected path. */
function globMayHitProtected(ctx, dirAbs, seg, { crossSlash = false } = {}) {
  const pp = ctx.pathPolicy
  const rel = pp.repoRelative(dirAbs)
  if (rel === null) return false
  if (pp.protectedMatch(dirAbs)) return true // everything below is protected
  const re = segmentRegExp(seg)
  if (re.test('CLAUDE.md') || re.test('AGENTS.md')) return true
  if (crossSlash) return pp.coversProtected(dirAbs) // a git pathspec `*` also matches `/`
  for (const name of protectedChildNames(ctx, rel)) if (name.includes('*') || re.test(name)) return true
  return false
}

/**
 * Write-classify one path operand plus what it can reach: a glob that may name protected files, and (with `subtree`) a
 * directory that CONTAINS protected paths (replacing/moving/deleting it affects them, e.g. `mv .wolf /tmp/w`).
 */
export function operandFindings(env, text, { cwd, mode = 'write', subtree = false, crossSlash = false } = {}) {
  const pp = env.ctx.pathPolicy
  const clean = trimSeps(text) || text
  const out = [pp.classifyWrite(clean, { cwd, mode })]
  if (pp.unknownCwd(clean, cwd)) return out // already reported as unresolvable
  if (hasGlob(clean)) {
    const segs = clean.split(SEP)
    const k = segs.findIndex(hasGlob)
    const dirText = segs.slice(0, k).join('/')
  for (const dirAbs of pp.readings(dirText === '' ? (clean.startsWith('/') ? '/' : '.') : dirText, cwd ?? undefined)) { // both readings of `link/..`
    // Test the first glob segment inside its directory AND, when the glob is not the last segment, the final segment too
    // (`apps/w?b/CLAUDE.m?`; a git pathspec `*` also crosses `/`).
    const last = segs[segs.length - 1]
    const lateHit = k < segs.length - 1 && (/^(claude|agents)\.md$/i.test(last) || segmentRegExp(last).test('CLAUDE.md') || segmentRegExp(last).test('AGENTS.md') ||
      pp.protectedMatch(dirAbs) || (crossSlash && pp.coversProtected(dirAbs)))
    // A git pathspec wildcard also swallows `/`: when the text after the LAST wildcard is a suffix of `/CLAUDE.md` or `/AGENTS.md`
    // (or the pattern ends in a wildcard) it can reach a nested instruction file such as apps/web/CLAUDE.md.
    const tail = clean.slice(Math.max(clean.lastIndexOf('*'), clean.lastIndexOf('?')) + 1).toLowerCase()
    const crossHit = crossSlash && ('/claude.md'.endsWith(tail) || '/agents.md'.endsWith(tail))
    if (lateHit || crossHit || globMayHitProtected(env.ctx, dirAbs, segs[k], { crossSlash })) out.push(CONTROL('fs.glob_may_match_protected', 'a glob operand may match protected files'))
    // Moving/deleting a DIRECTORY the glob matches takes its nested CLAUDE.md/AGENTS.md along (`mv apps/w* x` matches apps/web):
    // list the directories the glob can match and scan each subtree; an unlistable directory is scanned as a whole.
    if (subtree && !out.some((f) => f.code === 'fs.glob_may_match_protected')) {
      const dirs = pp.childDirectories(dirAbs)
      const re = segmentRegExp(segs[k])
      const hit = dirs === null ? pp.treeHasInstructionFiles(dirAbs) : dirs.some((name) => re.test(name) && pp.treeHasInstructionFiles(`${dirAbs}/${name}`))
      if (hit) out.push(CONTROL('fs.glob_dir_contains_protected', 'a glob operand can match a directory that contains CLAUDE.md/AGENTS.md files'))
    }
  }
  } else if (subtree) {
    const abs = pp.resolve(clean, cwd ?? undefined)
    const alt = pp.resolveAlt(clean, cwd ?? undefined)
    if ([abs, alt].some((a) => a && pp.coversProtected(a) && !pp.protectedMatch(a))) out.push(CONTROL('fs.covers_protected', 'the operand is a directory that contains protected paths'))
  }
  return out
}

/**
 * Copying a directory tree INTO the repository creates every file the tree contains. When the real source tree holds a
 * CLAUDE.md / AGENTS.md at any depth (or cannot be scanned), the copy writes protected files. A glob source is judged by the
 * tree of its directory part (a superset of what it can match). Copies to a location outside the repository are not affected.
 */
function copiedTreeFindings(env, srcText, destText, { cwd }) {
  const pp = env.ctx.pathPolicy
  if (pp.unknownCwd(srcText, cwd) || pp.unknownCwd(destText, cwd)) return [] // reported as unresolvable by the operand classification
  const clean = trimSeps(srcText) || srcText
  const segs = clean.split(SEP)
  const k = segs.findIndex(hasGlob)
  const dirText = k < 0 ? clean : segs.slice(0, k).join('/') || (clean.startsWith('/') ? '/' : '.')
  const destAbs = pp.resolve(trimSeps(destText) || destText, cwd ?? undefined)
  if (pp.repoRelative(destAbs) === null) return []
  if (!pp.readings(dirText, cwd ?? undefined).some((d) => pp.treeHasInstructionFiles(d, { linksUnprovable: true }))) return []
  return [CONTROL('fs.copies_protected_tree', 'the copied directory contains CLAUDE.md/AGENTS.md files that would be created inside the repository')]
}

/** Contents written into `destText` are unknown (`src/.`, a glob, a pipeline): flag when `destText` can reach protected paths. */
function bulkInto(env, destText, { cwd, seg = null } = {}) {
  const pp = env.ctx.pathPolicy
  if (pp.unknownCwd(destText, cwd)) return []
  const abss = pp.readings(trimSeps(destText) || destText, cwd ?? undefined)
  if (abss.some((a) => pp.protectedMatch(a))) return [] // the destination itself is classified as a protected write
  if (abss.some((abs) => (seg === null ? pp.coversProtected(abs) : globMayHitProtected(env.ctx, abs, seg)))) {
    return [CONTROL('fs.bulk_into_protected_parent', 'copied names cannot be resolved and the destination can contain protected paths')]
  }
  return []
}

/**
 * Classify the final destination(s) of copying/moving `sources` to `dest`. The destination as given is classified AND,
 * because it may be an existing directory (or have a trailing slash), `dest/<basename>` for every source.
 */
export function destinationFindings(env, { sources, dest, mode, recursive = false, parents = false, rename = false, suffixes = [], writeMode = 'write', cwd }) {
  const out = []
  const destFindings = (e, text, o) => operandFindings(e, text, { ...o, mode: o.mode === 'write' ? writeMode : o.mode }) // git mv classifies destinations as moves (never weaker than before)
  const withSuffixes = (p) => [p, ...suffixes.map((x) => `${trimSeps(p)}${x}`)]
  const sub = recursive || mode === 'move'
  if (rename) { // Rename-Item / ren: the new name replaces the last segment of each source
    for (const s of sources) out.push(...destFindings(env, joinPath(dirOf(s.text), dest.text), { cwd, mode: 'write', subtree: true }))
    // PowerShell accepts a full path as -NewName (in the same folder): classify the new name itself as well.
    if (/[\\/]|^[a-zA-Z]:/.test(dest.text)) out.push(...destFindings(env, dest.text, { cwd, mode: 'write', subtree: true }))
    if (!sources.length) out.push(CONTROL('fs.rename_unknown', 'rename target has no visible source'))
    return out
  }
  for (const d of withSuffixes(dest.text)) out.push(...destFindings(env, d, { cwd, mode: 'write', subtree: recursive && !sources.length }))
  if (!sources.length) return [...out, ...bulkInto(env, dest.text, { cwd })]
  for (const s of sources) {
    const base = lastSegment(s.text)
    if (base === '' || base === '.' || base === '..' || /[\\/]\.{1,2}$/.test(s.text)) { out.push(...bulkInto(env, dest.text, { cwd })); continue } // `src/.` = contents
    if (hasGlob(base)) { // a glob that can match a leading dot may also expand to `.` and `..` (bash < 5.2): contents are unknown
      out.push(...bulkInto(env, dest.text, { cwd, seg: base }))
      if (base.startsWith('.')) out.push(...bulkInto(env, dest.text, { cwd }))
      continue
    }
    for (const d of withSuffixes(joinPath(dest.text, base))) out.push(...destFindings(env, d, { cwd, mode: 'write', subtree: sub }))
    if (parents) out.push(...destFindings(env, joinPath(dest.text, s.text.replace(/^[a-zA-Z]:/, '').replace(/^[\\/]+/, '')), { cwd, mode: 'write', subtree: sub }))
  }
  return out
}

// ── operand parsers ──
// GNU long options per tool (value-taking ones are starred in VALUED). An abbreviation is resolved like getopt_long: an exact
// name wins, otherwise a UNIQUE prefix; an ambiguous prefix makes the real command fail, so it never swallows an operand.
const LONG_OPTS = {
  cp: ['archive', 'attributes-only', 'backup', 'copy-contents', 'debug', 'dereference', 'force', 'interactive', 'link', 'no-clobber', 'no-dereference',
    'no-preserve', 'no-target-directory', 'one-file-system', 'parents', 'preserve', 'recursive', 'reflink', 'remove-destination', 'sparse',
    'strip-trailing-slashes', 'suffix', 'symbolic-link', 'target-directory', 'update', 'verbose', 'context', 'keep-directory-symlink', 'help', 'version'],
  mv: ['backup', 'debug', 'exchange', 'force', 'interactive', 'no-clobber', 'no-copy', 'no-target-directory', 'strip-trailing-slashes', 'suffix',
    'target-directory', 'update', 'verbose', 'context', 'help', 'version'],
  install: ['backup', 'compare', 'debug', 'directory', 'group', 'mode', 'owner', 'preserve-context', 'preserve-timestamps', 'strip', 'strip-program',
    'suffix', 'target-directory', 'no-target-directory', 'unprivileged', 'verbose', 'context', 'help', 'version'],
}
const LONG_VALUED = new Set(['suffix', 'sparse', 'no-preserve', 'target-directory', 'mode', 'owner', 'group', 'strip-program'])
function resolveLong(exe, name) { // -> { names: candidate canonical names, valued: boolean }
  const all = LONG_OPTS[exe] ?? LONG_OPTS.cp
  const bare = name.slice(2)
  if (all.includes(bare)) return { names: [bare], valued: LONG_VALUED.has(bare) }
  const cands = all.filter((o) => bare.length > 0 && o.startsWith(bare))
  return { names: cands, valued: cands.length === 1 && LONG_VALUED.has(cands[0]) }
}

function parseUnix(words, exe) {
  const tool = exe === 'mv' || exe === 'install' ? exe : 'cp'
  const shortValued = new Set(exe === 'install' ? ['t', 'S', 'm', 'o', 'g'] : ['t', 'S'])
  const ops = []
  let target = null, targetGiven = false, recursive = false, parents = false, makeDirs = false, end = false, noTarget = false, backup = false, link = false
  const suffixes = []
  for (let i = 1; i < words.length; i++) {
    const w = words[i], t = w.text
    if (!end && t === '--') { end = true; continue }
    if (!end && t.startsWith('--') && t.length > 2) {
      const [name, inline] = splitFlag(t)
      const { names, valued } = resolveLong(tool, name)
      const any = (...ns) => names.some((n) => ns.includes(n))
      if (any('recursive', 'archive')) recursive = true
      if (any('parents')) parents = true
      if (any('no-target-directory')) noTarget = true // `cp -rT src dest` copies the CONTENTS of src onto dest
      if (any('backup')) backup = true
      if (tool === 'cp' && any('link', 'symbolic-link')) link = true
      if (tool === 'install' && any('directory')) makeDirs = true
      if (names.length && names.every((n) => n === 'target-directory')) { targetGiven = true; target = inline !== null ? wordOf(w, inline) : words[++i] ?? null; continue }
      if (any('suffix')) { const v = inline ?? words[i + 1]?.text; if (v !== undefined) suffixes.push(v) }
      if (valued && inline === null) i++
      continue
    }
    if (!end && t.startsWith('-') && t.length > 1) {
      const cluster = t.slice(1)
      for (let k = 0; k < cluster.length; k++) {
        const ch = cluster[k]
        if (ch === 'r' || ch === 'R' || ch === 'a') recursive = true
        if (ch === 'd' && exe === 'install') makeDirs = true
        if (ch === 'T') noTarget = true
        if (ch === 'b') backup = true
        if (tool === 'cp' && (ch === 'l' || ch === 's' || ch === 'a')) link = link || ch !== 'a' // -l hard link, -s symlink (-a is archive)
        if (shortValued.has(ch)) {
          const rest = cluster.slice(k + 1)
          const value = rest ? wordOf(w, rest) : words[++i] ?? null
          if (ch === 't') { targetGiven = true; target = value }
          if (ch === 'S' && value) suffixes.push(value.text)
          break
        }
      }
      continue
    }
    ops.push(w)
  }
  // A backup renames the existing destination to <dest><suffix> (default `~`): that is a write to the suffixed name too.
  const distinct = [...new Set(backup && !suffixes.length ? ['~'] : suffixes)]
  const tooMany = distinct.length > 4 // bounded work: more suffixes than that are not resolved
  const extra = { noTarget, link, suffixes: distinct.slice(0, 4), tooManySuffixes: tooMany }
  if (makeDirs) return { sources: [], dest: null, createDirs: ops, ...extra }
  if (targetGiven) return { sources: ops, dest: target, recursive, parents, unresolved: target === null, ...extra }
  if (ops.length >= 2) return { sources: ops.slice(0, -1), dest: ops.at(-1), recursive, parents, ...extra }
  return { sources: [], dest: ops[0] ?? null, recursive, parents, ...extra }
}

const PS_VALUED = ['filter', 'include', 'exclude', 'credential', 'erroraction', 'errorvariable', 'warningaction', 'warningvariable',
  'informationaction', 'informationvariable', 'outvariable', 'outbuffer', 'pipelinevariable', 'fromsession', 'tosession', 'stream',
  'progressaction', 'proga', 'ea', 'ev', 'wa', 'wv', 'ia', 'iv', 'ov', 'ob', 'pv']
function psKind(name) { // PowerShell parameter names are case-insensitive and accept unambiguous prefixes
  if (!name) return 'switch'
  if (name.length >= 2 && 'destination'.startsWith(name)) return 'dest'
  if ('newname'.startsWith(name)) return 'dest'
  if (name.length >= 2 && 'path'.startsWith(name)) return 'path'
  if ('literalpath'.startsWith(name)) return 'path'
  if ('recurse'.startsWith(name)) return 'recurse'
  if (PS_VALUED.includes(name) || (name.length >= 2 && PS_VALUED.some((v) => v.startsWith(name)))) return 'valued'
  return 'switch'
}

function parsePowerShell(allWords) {
  // `@args` splats are computed at runtime. The recognizer also splits a parenthesized argument into a separate command,
  // which leaves a path/destination parameter WITHOUT a value (or no destination at all): both are reported as unresolved.
  // A bare or leading/trailing `,` joins neighbouring words into ONE array argument (`Copy-Item a , b dest`): merge them first.
  const words = []
  for (const w0 of allWords) {
    // PowerShell binds parameters written with an en/em dash or horizontal bar (U+2013/2014/2015) exactly like `-`.
    const dashed = /^[–—―]/.test(w0.text) ? { ...w0, text: `-${w0.text.slice(1)}` } : w0
    const w = /^@[A-Za-z_]\w*$/.test(dashed.text) ? { ...dashed, dynamic: true } : dashed
    const prev = words[words.length - 1]
    if (words.length > 1 && (!prev.text.startsWith('-') || /^-\w+:/.test(prev.text)) && (prev.text.endsWith(',') || w.text.startsWith(','))) words[words.length - 1] = { ...prev, text: prev.text + w.text, dynamic: prev.dynamic || w.dynamic }
    else words.push(w)
  }
  const paths = [], positional = []
  let dest = null, recursive = false, unresolved = false, filtered = false
  const takeValue = (inline, i) => {
    if (inline) return [inline, i]
    const next = words[i + 1]
    if (!next || /^-[A-Za-z]/.test(next.text)) { unresolved = true; return [null, i] }
    return [next, i + 1]
  }
  for (let i = 1; i < words.length; i++) {
    const w = words[i], t = w.text
    if (t === '--%') { positional.push(...words.slice(i + 1)); break }
    const m = /^-([A-Za-z]+)(?::([\s\S]*))?$/.exec(t)
    if (!m) { positional.push(w); continue }
    const kind = psKind(m[1].toLowerCase())
    const inline = m[2] !== undefined && m[2] !== '' ? wordOf(w, m[2]) : null
    if (kind === 'recurse') recursive = true
    else if (kind === 'path' || kind === 'dest') {
      const [v, next] = takeValue(inline, i)
      i = next
      if (v) { if (kind === 'path') paths.push(v); else dest = v }
    } else if (kind === 'valued') {
      const name = m[1].toLowerCase()
      if (name.length >= 2 && ('include'.startsWith(name) || 'filter'.startsWith(name))) filtered = true // a recursive filtered copy writes names that are not visible
      if (!inline) i++
    }
  }
  for (const p of positional) { if (!paths.length) paths.push(p); else if (!dest) dest = p; else paths.push(p) }
  const sources = []
  for (const p of paths) { // `-Path a,b` is a list: classify the whole text and each element
    sources.push(p)
    if (p.text.includes(',')) for (const part of p.text.split(',')) if (part.trim()) sources.push(wordOf(p, part.trim().replace(/^["']|["']$/g, '')))
  }
  return { sources, dest, recursive, unresolved, unknownKind: filtered }
}

function parseCmd(words, exe) { // cmd.exe copy / move / ren / xcopy: `/X` switches, `a+b` concatenation, default destination = cwd
  const ops = [], extra = []
  let recursive = false, plus = false, tooMany = false
  for (let i = 1; i < words.length; i++) {
    const w = words[i], t = w.text
    if (t === '+') plus = true
    if (/^\/-?[A-Za-z?][A-Za-z]*(:.*)?$/.test(t)) { if (/^\/[es]$/i.test(t)) recursive = true; continue }
    // cmd treats `,` `;` `=` as argument delimiters and reads `/x` as a switch even when glued to a path (`copy a .wolf/y`): the
    // operand is classified both as written and with the delimiters/switch removed.
    // Switches may be glued repeatedly (`.wolf/y/b`): every truncation point is classified, the fully stripped text is the operand.
    let glued = t
    for (let k = 0; k < 16; k++) { // bounded work: a longer chain of glued switches is not resolved
      const next = glued.replace(/(?<=.)\/-?[A-Za-z?](:[^\\/]*)?$/, '')
      if (next === glued) break
      extra.push(wordOf(w, next))
      glued = next
      if (k === 15 && glued.replace(/(?<=.)\/-?[A-Za-z?](:[^\\/]*)?$/, '') !== glued) tooMany = true
    }
    if (glued !== t) extra.push(wordOf(w, t))
    if (glued.includes('+')) plus = true
    for (const piece of glued.split(/[,;=]/)) for (const part of piece.split('+')) if (part) ops.push(wordOf(w, part))
    if (/[,;=]/.test(t)) extra.push(wordOf(w, t))
  }
  // `copy a + b` (no destination) stores the combined file under the FIRST name, and `copy a+b c` may or may not name c a
  // destination: with concatenation every operand is classified as written.
  if (plus) extra.push(...ops)
  const rename = exe === 'ren' || exe === 'rename'
  const unknownKind = !rename // a source may be a directory: `copy dir dest` copies every file in it
  if (ops.length >= 2) return { sources: ops.slice(0, -1), dest: ops.at(-1), recursive, rename, unknownKind, extra, unresolved: tooMany }
  return { sources: ops, dest: ops.length && !rename ? wordOf(ops[0], '.') : null, recursive, rename, unknownKind, extra, unresolved: tooMany }
}

const ROBOCOPY_SWITCHES = new Set(['s', 'e', 'lev', 'purge', 'mir', 'mov', 'move', 'xo', 'xn', 'xc', 'xl', 'xx', 'xf', 'xd', 'xa', 'if', 'job', 'save',
  'quit', 'nosd', 'nodd', 'copy', 'dcopy', 'sec', 'copyall', 'secfix', 'timfix', 'mon', 'mot', 'rh', 'pf', 'create', 'fat', 'mt', 'r', 'w', 'reg', 'tbd',
  'z', 'zb', 'b', 'j', 'nooffload', 'l', 'x', 'v', 'ts', 'fp', 'bytes', 'ns', 'nc', 'nfl', 'ndl', 'np', 'eta', 'log', 'unilog', 'tee', 'njh', 'njs',
  'unicode', 'a', 'm', 'maxage', 'minage', 'maxlad', 'minlad', 'max', 'min', 'ia', 'im', 'is', 'it', 'xj', 'xjd', 'xjf', 'sj', 'sl', 'dst', 'compress',
  'sparse', 'nodcopy', '256', 'ndl', 'zb', 'iomaxsize', 'iorate', 'threshold', 'efsraw', 'sd', 'dd', 'ipg', 'a+', 'a-'])

function robocopyFindings(env, cwd) {
  const { words } = env
  const ops = []
  const flags = new Set()
  const included = [] // /IF = INCLUDE the following files (they are file operands, like names after the destination)
  for (let i = 1; i < words.length; i++) {
    const t = words[i].text
    // Only KNOWN robocopy switches (`/x`) are dropped; anything else (`/tmp` rewritten by MSYS, `-x`, unknown words) is an operand.
    const name = t.startsWith('/') || t.startsWith('-') ? t.slice(1).split(/[:=]/)[0].toLowerCase().replace(/[+-]$/, '') : ''
    if (ROBOCOPY_SWITCHES.has(name)) {
      flags.add(name)
      if (['xd', 'xf'].includes(name)) while (words[i + 1] && !/^[/-][A-Za-z]/.test(words[i + 1].text)) i++ // excluded names, not operands
      if (name === 'if') while (words[i + 1] && !/^[/-][A-Za-z]/.test(words[i + 1].text)) included.push(words[++i])
      continue
    }
    ops.push(words[i])
  }
  if (flags.has('nosd')) ops.unshift(words[0]) // /NOSD: no source directory, the first operand is the destination
  const [src, dest, ...listed] = ops
  const files = [...listed, ...included]
  if (!src || !dest) return [F('run_unrecognized_command', 'fs.robocopy_operands', 'robocopy operands could not be resolved')]
  const out = []
  if (flags.has('job')) out.push(F('run_unrecognized_command', 'fs.robocopy_job', 'a robocopy job file can add options that are not visible'))
  const moving = flags.has('mov') || flags.has('move')
  out.push(...(moving ? operandFindings(env, src.text, { cwd, mode: 'move', subtree: true }) : [env.ctx.pathPolicy.classifyRead(src.text, cwd)]))
  out.push(...operandFindings(env, dest.text, { cwd, mode: 'write' }))
  // robocopy copies a directory's contents (the whole tree with /S /E /MIR /LEV); a named file list copies only those files.
  if (!moving && (!files.length || ['s', 'e', 'mir', 'lev'].some((f) => flags.has(f)))) out.push(...copiedTreeFindings(env, src.text, dest.text, { cwd }))
  if (!files.length || flags.has('mir') || flags.has('purge') || flags.has('s') || flags.has('e') || flags.has('lev')) out.push(...bulkInto(env, dest.text, { cwd })) // /MIR and /PURGE also delete from the destination
  for (const f of files) {
    if (hasGlob(f.text)) out.push(...bulkInto(env, dest.text, { cwd, seg: lastSegment(f.text) }))
    else out.push(...operandFindings(env, joinPath(dest.text, lastSegment(f.text)), { cwd, mode: 'write' }))
  }
  return out
}

const PS_ONLY = new Set(['copy-item', 'cpi', 'move-item', 'mi', 'rename-item', 'rni'])
const CMD_ONLY = new Set(['xcopy', 'ren', 'rename'])
function copyMove(env, mode) {
  const { ctx, state, words, findings, exe } = env
  const pp = ctx.pathPolicy
  const cwd = state.cwd
  // Bounded work: absurdly long or numerous operands are not resolved (fail closed, and the hook has a 10 s budget).
  if (words.length > 512 || words.some((w) => w.text.length > 2048)) { findings.push(F('run_unrecognized_command', 'fs.operands_too_large', 'too many or too long operands to classify')); return }
  if (exe === 'robocopy') { findings.push(...robocopyFindings(env, cwd)); return }
  const powershell = PS_ONLY.has(exe) || (state.dialect === 'powershell' && exe !== 'xcopy') // in PowerShell, ren/rename are Rename-Item aliases
  const cmdStyle = CMD_ONLY.has(exe) || ((exe === 'copy' || exe === 'move') && state.dialect !== 'posix')
  const parsed = powershell ? { ...parsePowerShell(words), rename: ['rename-item', 'rni', 'ren', 'rename'].includes(exe) } : cmdStyle ? parseCmd(words, exe) : parseUnix(words, exe)
  // Copy-Item/Move-Item with no destination copy to the current location, but a destination that is a parenthesized
  // expression is invisible to the recognizer: an omitted destination is reported rather than assumed to be the cwd.
  if (powershell && !parsed.dest && parsed.sources.length) parsed.unresolved = true
  const all = [...parsed.sources, ...(parsed.dest ? [parsed.dest] : []), ...(parsed.createDirs ?? [])]
  const dynamic = all.some((t) => t.dynamic)
  if (dynamic) findings.push(F('edit_outside_task_worktree', 'fs.dynamic_target', 'file operation on a computed path'))
  // POSIXLY_CORRECT makes GNU cp/mv/install stop option parsing at the first operand (`cp a -t x dest` copies `-t` and `x`): unresolvable.
  if (String(state.source ?? '').includes('POSIXLY_CORRECT')) findings.push(F('run_unrecognized_command', 'fs.posixly_correct', 'POSIXLY_CORRECT changes how copy/move operands are parsed'))
  if (parsed.link) findings.push(F('run_unrecognized_command', 'fs.link', 'cp -l/-s creates hard or symbolic links that can alias protected files'))
  if (parsed.tooManySuffixes) findings.push(F('run_unrecognized_command', 'fs.suffixes_too_many', 'too many backup suffixes to classify'))
  if (parsed.unresolved) findings.push(F('run_unrecognized_command', 'fs.target_unresolved', 'the destination or a path parameter is missing or computed'))
  for (const t of (parsed.createDirs ?? []).filter((x) => !x.dynamic)) findings.push(...operandFindings(env, t.text, { cwd, mode: 'write', subtree: true }))
  const sources = parsed.sources.filter((t) => !t.dynamic)
  const dest = parsed.dest && !parsed.dest.dynamic ? parsed.dest : null
  for (const s of sources) {
    if (mode === 'move') findings.push(...operandFindings(env, s.text, { cwd, mode: 'move', subtree: true }))
    else findings.push(pp.classifyRead(s.text, cwd))
    // A recursive copy (or a cmd.exe copy whose source may be a directory) brings the whole tree along.
    if (dest && mode === 'copy' && (parsed.recursive || parsed.unknownKind)) findings.push(...copiedTreeFindings(env, s.text, dest.text, { cwd }))
  }
  if (dest) {
    findings.push(...destinationFindings(env, { sources, dest, mode, recursive: parsed.recursive, parents: parsed.parents, rename: parsed.rename, suffixes: parsed.suffixes ?? [], cwd }))
    if (parsed.unknownKind || parsed.noTarget) findings.push(...bulkInto(env, dest.text, { cwd })) // -T or a directory source: contents land on the destination
  }
  for (const x of (parsed.extra ?? []).filter((w) => !w.dynamic)) findings.push(...operandFindings(env, x.text, { cwd, mode: 'write', subtree: true }))
  // Nothing resolvable at all: PowerShell takes paths from the pipeline (`Get-ChildItem x | Move-Item -Destination y`).
  if (!sources.length && !parsed.createDirs?.length && !dynamic) findings.push(F('discard_or_rewrite_local_work', 'fs.pipeline_target', 'file operation whose targets come from the pipeline'))
}
