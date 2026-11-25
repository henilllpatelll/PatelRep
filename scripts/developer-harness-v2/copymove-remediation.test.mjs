// Developer Harness V2 — Phase 4 remediation tests: `git rm` / `git mv` pathspec handling (Fix A) and copy/move effective-destination
// resolution (Fix B). Offline and pure: the deterministic policy engine and in-memory fixtures only — no command is executed and no
// real repository file is touched. Run: node --test scripts/developer-harness-v2/copymove-remediation.test.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CLASSES, evaluateToolEvent, loadContract } from './policy-engine.mjs'
import { FIXTURES, ROOT, EXISTING_FILES, PACKAGE_SCRIPTS } from './policy-fixtures.mjs'
import { M1_FIXTURES, M1_PATHS } from './policy-fixtures-m1.mjs'
import { CM_FIXTURES } from './policy-fixtures-copymove.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const CONTRACT = loadContract(path.join(REPO, 'docs/developer-harness-v2/contract.json'))
const BASELINE = JSON.parse(readFileSync(path.join(HERE, 'fixtures-baseline-pre-copymove.json'), 'utf8'))
const RANK = Object.fromEntries(CLASSES.map((c, i) => [c, i]))
const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

const ctx = (extra = {}) => ({
  contract: CONTRACT, projectRoot: ROOT, homeDir: 'C:/Users/dev', tempRoots: ['C:/Users/dev/AppData/Local/Temp', '/tmp'], platform: 'win32',
  pathExists: (p) => EXISTING_FILES.has(String(p).toLowerCase()),
  readPackageScripts: (d) => Object.entries(PACKAGE_SCRIPTS).find(([k]) => k.toLowerCase() === String(d).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase())?.[1] ?? null,
  resolveWorkspace: () => null, gitState: () => ({ branch: 'feat/x', upstreamBranch: 'feat/x', hasUpstream: true }), ...extra,
})
const event = (tool, input, mode = 'default') => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: ROOT, permission_mode: mode, tool_name: tool, tool_input: input, tool_use_id: 't' })
const run = (command, tool = 'Bash', extra = {}) => evaluateToolEvent(event(tool, { command, description: 'fixture' }), ctx(extra))
const cls = (command, tool = 'Bash', extra = {}) => run(command, tool, extra).classification

// ── the two reported bypasses, by name ──────────────────────────────────────────────────────────────────────────────
test('Fix A regression: git rm / git mv classify the FIRST target (positionals started at index 1)', () => {
  assert.equal(cls('git rm .wolf/cerebrum.md'), 'human_approval', 'sole target of git rm')
  assert.equal(cls('git rm .wolf/cerebrum.md apps/web/a.ts'), 'human_approval', 'first of several')
  assert.equal(cls('git rm apps/web/a.ts .wolf/cerebrum.md'), 'human_approval', 'second of several')
  assert.equal(cls('git mv .wolf/cerebrum.md x.md'), 'human_approval', 'protected SOURCE of git mv (first operand)')
  assert.equal(cls('git mv x.md .wolf/cerebrum.md'), 'human_approval', 'protected DESTINATION of git mv')
  assert.equal(cls('git mv apps/web/a.ts apps/web/b.ts'), 'allowed', 'ordinary rename stays allowed')
  assert.equal(cls('git rm apps/web/a.ts'), 'allowed', 'ordinary removal stays allowed')
  const r = run('git rm .wolf/cerebrum.md')
  assert.equal(r.action, 'modify_agent_instructions_or_hooks')
  assert.equal(r.decision, 'ask')
})

test('Fix A: options, `--`, pathspec magic, globs and directories are handled; an unresolvable target list is never harmless', () => {
  for (const c of ['git rm -f .wolf/identity.md', 'git rm --cached .wolf/identity.md', 'git rm -- .wolf/identity.md', 'git rm -rf .wolf/knowledge',
    "git rm ':(top).wolf/identity.md'", "git rm ':/.wolf/identity.md'", "git rm ':(literal).wolf/identity.md'", "git rm '.wolf/*.md'", 'git rm .wolf/i*',
    'git mv -f .wolf/identity.md x', 'git mv -k a.ts .wolf/identity.md', 'git mv .wolf x', 'git rm -r docs', 'git -C .wolf rm identity.md']) {
    assert.notEqual(cls(c), 'allowed', c)
  }
  for (const c of ['git rm --pathspec-from-file=list.txt', 'git rm --pathspec-from-file list.txt', 'git rm --pathspec-from=list.txt', 'git rm', 'git rm $F', 'git mv $A $B', 'git rm "$(cat list)"']) {
    assert.equal(cls(c), 'human_approval', `unresolvable: ${c}`)
  }
  // first target is not an option value: `--` and `-f` do not swallow it
  assert.equal(cls('git rm -f -- apps/web/a.ts'), 'allowed')
  assert.equal(cls('git rm --ignore-unmatch apps/web/a.ts apps/web/b.ts'), 'allowed')
})

test('Fix B regression: the FINAL effective destination of copy/move into a directory is classified', () => {
  for (const c of ['cp /tmp/cerebrum.md .wolf/', 'cp -t .wolf /tmp/cerebrum.md', 'cp -r /tmp/s/. .wolf/', 'mv /tmp/cerebrum.md .wolf/']) {
    assert.equal(cls(c), 'human_approval', c)
    assert.equal(CM_FIXTURES.find((f) => f.input === c)?.before, 'allowed', `${c} was allowed before the fix`)
  }
  for (const c of ['Copy-Item C:/tmp/cerebrum.md .wolf/', 'Copy-Item -Path C:/tmp/cerebrum.md -Destination .wolf', 'Move-Item C:/tmp/cerebrum.md .wolf', 'Move-Item -Path C:/tmp/cerebrum.md -Destination .wolf/']) {
    assert.equal(cls(c, 'PowerShell'), 'human_approval', c)
  }
  // a directory destination that cannot reach a protected NAME stays allowed
  for (const c of ['cp /tmp/notes.txt .wolf/', 'cp -t .wolf /tmp/notes.txt', 'mv /tmp/notes.txt .wolf/', 'cp /tmp/*.txt .wolf/', 'cp -r /tmp/s .wolf']) assert.equal(cls(c), 'allowed', c)
  assert.equal(cls('Copy-Item C:/tmp/notes.txt .wolf/', 'PowerShell'), 'allowed')
})

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const fx of CM_FIXTURES) {
  test(`[CM] ${fx.id}: ${fx.tool} ${fx.input.slice(0, 70)} → ${fx.expect}`, () => {
    const r = cls(fx.input, fx.tool)
    assert.equal(r, fx.expect, `${fx.id}: got ${r} ${fx.note ?? ''}`)
    assert.ok(RANK[r] >= RANK[fx.before], `${fx.id}: ${r} is less restrictive than ${fx.before} before the remediation`)
  })
}

test('fixture inventory: both bypass families, option/pathspec variants and ordinary operations are all present', () => {
  const closed = CM_FIXTURES.filter((f) => f.before === 'allowed' && f.expect !== 'allowed')
  assert.ok(closed.length >= 90, `bypass closures recorded: ${closed.length}`)
  assert.ok(CM_FIXTURES.filter((f) => f.expect === 'allowed').length >= 25, 'ordinary operations stay allowed')
  assert.ok(CM_FIXTURES.filter((f) => f.expect === 'allowed').every((f) => f.before === 'allowed'), 'no previously-restricted operation was relaxed')
  assert.ok(CM_FIXTURES.some((f) => /^git rm/.test(f.input)) && CM_FIXTURES.some((f) => /^git mv/.test(f.input)))
  assert.ok(CM_FIXTURES.some((f) => /Copy-Item/.test(f.input)) && CM_FIXTURES.some((f) => /Move-Item/.test(f.input)))
  assert.equal(new Set(CM_FIXTURES.map((f) => f.id)).size, CM_FIXTURES.length, 'unique ids')
})

// ── no broadening ───────────────────────────────────────────────────────────────────────────────────────────────────
test('the earlier classification fixtures: not one is less restrictive than before the remediation', () => {
  assert.equal(Object.keys(BASELINE.classifications).length, FIXTURES.length, 'baseline covers every earlier fixture')
  assert.ok(FIXTURES.length >= 589, `earlier fixtures: ${FIXTURES.length}`)
  const lower = []
  for (const fx of FIXTURES) {
    const before = BASELINE.classifications[fx.id]
    assert.ok(before, `baseline for ${fx.id}`)
    const abs = (p) => (/^[A-Za-z]:\//.test(p) ? p : `${ROOT}/${p}`)
    let input
    if (fx.tool === 'Bash' || fx.tool === 'PowerShell') input = { command: fx.input, description: 'fixture' }
    else if (fx.tool === 'Read') input = { file_path: abs(fx.input) }
    else if (fx.tool === 'Grep') input = { pattern: 'x', path: abs(fx.input) }
    else if (fx.tool === 'Edit') input = { file_path: abs(fx.input), old_string: 'a', new_string: fx.content ?? 'b' }
    else if (fx.tool === 'Monitor') input = { command: fx.input }
    else if (fx.tool === 'WebFetch') input = { url: fx.input, prompt: 'x' }
    else if (fx.tool === 'Glob') input = { pattern: fx.input }
    else if (/^mcp__/.test(fx.tool)) input = fx.mcpInput ?? { anything: fx.input }
    else input = { file_path: abs(fx.input), content: fx.content ?? 'x' }
    const now = evaluateToolEvent(event(fx.tool, input, fx.mode ?? 'default'), ctx({ gitState: () => fx.git ?? { branch: 'feat/x', upstreamBranch: 'feat/x', hasUpstream: true } })).classification
    if (RANK[now] < RANK[before]) lower.push(`${fx.id}: ${before} → ${now}`)
    assert.equal(now, fx.expect, `${fx.id} still meets its own expectation`)
  }
  assert.deepEqual(lower, [])
})

test('all nine M1 paths stay protected and every M1 fixture still holds', () => {
  assert.equal(M1_PATHS.length, 9)
  for (const p of M1_PATHS) assert.ok(CONTRACT.protected_paths.includes(p), `${p} protected`)
  assert.equal(M1_FIXTURES.length, 61)
  const inFixtures = new Map(FIXTURES.map((f) => [f.id, f]))
  for (const fx of M1_FIXTURES) assert.ok(inFixtures.has(fx.id), `${fx.id} is part of the engine fixture set`)
})

test('action classes, infrastructure, roles and topology are untouched; no new action is declared or emitted', () => {
  // V2 permission transition (14-v2-permission-transition.md) later added exactly one action (run_privileged_infrastructure, human_approval).
  // The matrix pinned here is the matrix minus that recorded addition: this remediation still changed no action.
  assert.deepEqual(CONTRACT.bypass_authorization.added_actions, ['run_privileged_infrastructure'])
  assert.equal(CONTRACT.actions.run_privileged_infrastructure, 'human_approval')
  const priorActions = Object.fromEntries(Object.entries(CONTRACT.actions).filter(([a]) => !CONTRACT.bypass_authorization.added_actions.includes(a)))
  assert.equal(digest(priorActions), '80cbf36c889d2a6db5c382c20910d221aa10e0834291ac82e7fc5eb05e062890')
  assert.equal(digest(CONTRACT.protected_infrastructure), 'c4d3fa844279db8fa66f7204d3e062794660ed114818a1bae00434adbd0258b9')
  assert.equal(digest(CONTRACT.roles), 'fa787dbee2e6ab5ea1b816d7d81ad9c6caf1df250f511467f283aac92a478f3e')
  assert.equal(digest(CONTRACT.topology), '8fe7bad50a16e9517d8b4a4c313b21f7d64ab2f9934722f3f75bc555c4776ce0')
  // every finding emitted for every remediation fixture names an action the contract already declares
  for (const fx of CM_FIXTURES) {
    const r = run(fx.input, fx.tool)
    if (r.action) assert.ok(r.action in CONTRACT.actions, `${fx.id}: ${r.action} is a declared action`)
  }
})

test('credential and outside-worktree rules are unchanged by the resolver', () => {
  assert.equal(cls('cp /tmp/x .env.production'), 'forbidden')
  assert.equal(cls('cp .env apps/web/'), 'forbidden')
  assert.equal(cls('mv /tmp/x .git/hooks/pre-commit'), 'forbidden')
  assert.equal(cls('cp a.ts /etc/'), 'human_approval')
})

// ── systematic matrix over EVERY protected path in the contract ─────────────────────────────────────────────────────
const concrete = CONTRACT.protected_paths.map((g) => {
  if (g.startsWith('**/')) return `apps/web/${g.slice(3)}`
  if (g.endsWith('/**')) return `${g.slice(0, -3)}/new-file.md`
  return g
}).filter((p) => !p.includes('*'))
const split = (p) => ({ dir: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.', name: p.slice(p.lastIndexOf('/') + 1) })
const POSIX_FORMS = (d, n) => [`cp /tmp/${n} ${d}/`, `cp /tmp/${n} ${d}`, `cp -t ${d} /tmp/${n}`, `cp -rt ${d} /tmp/${n}`, `cp --target-directory=${d} /tmp/${n}`, `cp --target=${d} /tmp/${n}`,
  `mv /tmp/${n} ${d}/`, `mv -t ${d} /tmp/${n}`, `mv --target-directory ${d} /tmp/${n}`, `install -t ${d} /tmp/${n}`, `cp /tmp/${n} ./${d}/./`, `cp /tmp/${n} ${d}//`,
  `cd ${d} && cp /tmp/${n} .`, `cd ${d} && mv /tmp/${n} ./`, `git mv apps/web/lib/${n} ${d}/`, `git mv -f apps/web/lib/${n} ${d}`, `cp -r /tmp/${n} ${d}/`]
const PS_FORMS = (d, n) => [`Copy-Item C:/tmp/${n} ${d}/`, `Copy-Item C:/tmp/${n} ${d}`, `Copy-Item -Path C:/tmp/${n} -Destination ${d}`, `Copy-Item -DESTINATION ${d} C:/tmp/${n}`,
  `Copy-Item -Destination:${d} C:/tmp/${n}`, `Copy-Item -LiteralPath C:/tmp/${n} -Destination ${d}/`, `Move-Item C:/tmp/${n} ${d}`, `Move-Item -Path C:/tmp/${n} -Destination ${d}`,
  `cp C:/tmp/${n} ${d}/`, `mv C:/tmp/${n} ${d}`, `cd ${d}; Copy-Item C:/tmp/${n} .`]

test('matrix: every protected path is guarded against every directory-destination form (POSIX, PowerShell, git mv)', () => {
  assert.ok(concrete.length >= 25, `protected paths exercised: ${concrete.length}`)
  const failures = []
  for (const p of concrete) {
    const { dir, name } = split(p)
    for (const c of POSIX_FORMS(dir, name)) if (cls(c) === 'allowed') failures.push(`allowed: ${c}`)
    for (const c of PS_FORMS(dir, name)) if (cls(c, 'PowerShell') === 'allowed') failures.push(`allowed (ps): ${c}`)
  }
  assert.deepEqual(failures, [])
})

test('matrix: every protected path is guarded as a git rm / git mv / mv SOURCE, with options and pathspec magic', () => {
  const failures = []
  for (const p of concrete) {
    for (const c of [`git rm ${p}`, `git rm -f ${p}`, `git rm --cached ${p}`, `git rm -- ${p}`, `git rm --ignore-unmatch ${p}`, `git rm -n ${p}`, `git mv ${p} /tmp/x`, `git mv -f ${p} x`, `git mv -- ${p} x`,
      `git rm ':(top)${p}'`, `git rm ':/${p}'`, `git rm ':(literal)${p}'`, `git mv ':(top)${p}' x`, `mv ${p} /tmp/x`, `mv -f ${p} /tmp/x`]) {
      if (cls(c) === 'allowed') failures.push(`allowed: ${c}`)
    }
    for (const c of [`Move-Item ${p} C:/tmp/x`, `Move-Item -Path ${p} -Destination C:/tmp/x`, `mv ${p} C:/tmp/x`]) if (cls(c, 'PowerShell') === 'allowed') failures.push(`allowed (ps): ${c}`)
  }
  assert.deepEqual(failures, [])
})

test('matrix: recursive and glob operations that can reach a protected subtree are guarded', () => {
  const dirs = [...new Set(concrete.map((p) => split(p).dir))].filter((d) => d !== '.' && !d.startsWith('apps/'))
  const failures = []
  for (const d of dirs) {
    for (const c of [`cp -r /tmp/s/. ${d}/`, `cp -a /tmp/s/. ${d}`, `cp /tmp/* ${d}/`, `cp -r /tmp/s/* ${d}`, `mv /tmp/s/* ${d}/`, `mv ${d} /tmp/old`, `git mv ${d} x`, `git rm -r ${d}`, `cp -r . ${d}`]) {
      if (cls(c) === 'allowed') failures.push(`allowed: ${c}`)
    }
    for (const c of [`Copy-Item -Recurse C:/tmp/s/* ${d}`, `Copy-Item C:/tmp/s -Destination ${d} -Include *.md -Recurse`, `Get-ChildItem C:/tmp/s | Copy-Item -Destination ${d}`, `Move-Item ${d} C:/tmp/old`]) {
      if (cls(c, 'PowerShell') === 'allowed') failures.push(`allowed (ps): ${c}`)
    }
  }
  for (const c of ['cp -r /tmp/s/. .', 'cp -a /tmp/s/. ./', 'mv . /tmp/r', 'git mv . x', 'cp -r /tmp/x/.wolf .', 'cp -r /tmp/x/.claude .', 'cp /tmp/*.md .']) if (cls(c) === 'allowed') failures.push(`allowed: ${c}`)
  assert.deepEqual(failures, [])
})

test('ordinary directory copies and moves are NOT over-blocked', () => {
  const ordinary = ['cp a.ts b.ts', 'cp -r apps/web/lib apps/web/lib2', 'cp /tmp/x apps/web/lib/', 'cp -t apps/web/lib /tmp/x', 'mv a.ts apps/web/lib/', 'mv -t apps/web/lib /tmp/x',
    'install -m 755 a.sh apps/web/', 'git mv apps/web/a.ts apps/web/b.ts', 'git rm apps/web/a.ts', 'git rm -r --cached apps/web/old', 'cp -r /tmp/s/. apps/web/', 'cp /tmp/*.txt .wolf/',
    'cp .wolf/cerebrum.md /tmp/backup/', 'cp -r .wolf /tmp/backup', 'cp /tmp/x .wolf/memory.md', 'mv .wolf/memory.md /tmp/', 'cp a.ts docs/guide/']
  for (const c of ordinary) {
    const r = cls(c)
    // `git rm -r` keeps its pre-existing recursive-removal approval; everything else must remain allowed
    assert.equal(r, /git rm -r/.test(c) ? 'human_approval' : 'allowed', c)
  }
})

// ── symlinks, junctions, ambiguity ──────────────────────────────────────────────────────────────────────────────────
test('a symlink/junction directory is resolved through the hook canonicalizer before the effective destination is classified', () => {
  const canonicalize = (abs) => abs.replace(/^C:\/work\/PatelRep\/(link|junction)(?=\/|$)/i, 'C:/work/PatelRep/.wolf')
  for (const c of ['cp /tmp/cerebrum.md link/', 'cp -t link /tmp/cerebrum.md', 'mv /tmp/cerebrum.md junction/', 'git mv apps/web/lib/cerebrum.md link/', 'cp /tmp/x link/identity.md']) {
    assert.equal(cls(c, 'Bash', { canonicalize }), 'human_approval', c)
  }
  assert.equal(cls('Copy-Item C:/tmp/cerebrum.md junction/', 'PowerShell', { canonicalize }), 'human_approval')
  assert.equal(cls('cp /tmp/notes.txt link/', 'Bash', { canonicalize }), 'allowed', 'a non-protected name through the same link stays allowed')
  // a canonicalizer that throws degrades to the lexical path (no crash, still classified)
  assert.equal(cls('cp /tmp/cerebrum.md .wolf/', 'Bash', { canonicalize: () => { throw new Error('boom') } }), 'human_approval')
})

test('links created in the same command line, computed paths and unsupported forms are never silently allowed', () => {
  for (const c of ['ln -s .wolf lnk && cp /tmp/cerebrum.md lnk/', 'cp /tmp/x $D/', 'cp /tmp/x "$(echo .wolf)/"', 'cd $X && cp /tmp/cerebrum.md .', 'cp -t', 'xargs -I{} cp {} .wolf/', 'find /tmp/s -exec cp {} .wolf/ \\;',
    'rsync -a /tmp/s/ .wolf/', 'tar -xf a.tar -C .wolf']) {
    assert.notEqual(cls(c), 'allowed', c)
  }
  for (const c of ['New-Item -ItemType SymbolicLink -Path lnk -Target .wolf', 'New-Item -ItemType Junction -Path lnk -Target .wolf', 'Copy-Item @args', 'Copy-Item C:/tmp/a $env:X', 'Copy-Item C:/tmp/b',
    'Copy-Item -Path C:/tmp/a -Destination (Join-Path .wolf cerebrum.md)', 'Get-ChildItem C:/tmp/s | Move-Item -Destination .wolf']) {
    assert.equal(cls(c, 'PowerShell'), 'human_approval', c)
  }
})

test('approval is denied (not allowed) when prompts cannot be mediated, for the newly guarded forms', () => {
  for (const mode of ['bypassPermissions', 'dontAsk', 'auto']) {
    for (const [tool, command] of [['Bash', 'cp /tmp/cerebrum.md .wolf/'], ['Bash', 'git rm .wolf/cerebrum.md'], ['PowerShell', 'Move-Item C:/tmp/cerebrum.md .wolf']]) {
      assert.equal(evaluateToolEvent(event(tool, { command }, mode), ctx()).decision, 'deny', `${mode}: ${command}`)
    }
  }
})

test('oversized operand lists fail closed within the hook budget (no unbounded work)', () => {
  const many = Array.from({ length: 600 }, (_, i) => `f${i}`).join(' ')
  const long = `cmd /c copy x a${'/'.repeat(20000)}`
  const commas = `Copy-Item ${Array.from({ length: 3000 }, () => 'a').join(',')} d`
  for (const [tool, c] of [['Bash', `cp ${many} d`], ['Bash', `git mv ${many} d`], ['Bash', long], ['PowerShell', commas]]) {
    const t0 = Date.now()
    assert.notEqual(cls(c, tool), 'allowed', c.slice(0, 40))
    assert.ok(Date.now() - t0 < 3000, `bounded: ${c.slice(0, 40)}`)
  }
})

test('glob operands with many wildcards are classified in bounded time (no catastrophic backtracking)', () => {
  const nasty = `${'*'.repeat(40)}z`
  const alt = `${'*a'.repeat(40)}z`
  for (const [tool, c] of [['Bash', `cp apps/x .wolf/${nasty}`], ['Bash', `cp apps/x .wolf/${alt}`], ['Bash', `git rm '${alt}'`], ['PowerShell', `Copy-Item apps/x .wolf/${alt}`]]) {
    const t0 = Date.now()
    cls(c, tool)
    assert.ok(Date.now() - t0 < 1500, `bounded: ${c.slice(0, 40)}`)
  }
  assert.notEqual(cls(`cp apps/x .wolf/${'*a'.repeat(40)}z`), 'allowed', 'many wildcards are treated as matching anything')
})

test('cmd concatenation, unbounded glued switches, robocopy /S and PowerShell -r are guarded', () => {
  const many = `.wolf${'/y'.repeat(200)}`
  for (const c of ['cmd /c copy /b .claude/settings.json + evil.txt', 'cmd /c copy /b .wolf/cerebrum.md+evil.txt', `cmd /c copy apps/cerebrum.md ${many}`,
    'robocopy apps/w . /S /IF cerebrum.md', 'robocopy apps/w . /E /IF *.sql']) assert.notEqual(cls(c), 'allowed', c.slice(0, 60))
  for (const c of ['Copy-Item -r apps/w/.wolf .', 'cp -r apps/w/.wolf .', 'Copy-Item -re apps/w/supabase .']) assert.notEqual(cls(c, 'PowerShell'), 'allowed', c)
})

test('worst-case cmd glued-switch input stays far inside the hook budget and never allows', () => {
  const word = `a${'/y'.repeat(1020)}`
  const c = `cmd /c copy ${Array.from({ length: 95 }, () => word).join(' ')}`
  const t0 = Date.now()
  assert.notEqual(cls(c, 'PowerShell'), 'allowed')
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`)
})
