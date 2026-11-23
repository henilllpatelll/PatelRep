// Developer Harness V2 — Phase 4 path-resolution remediation tests.
// Two layers:
//   1. REAL-FILESYSTEM: the real PreToolUse hook (real canonicalizer) runs against a throwaway repo on disk that contains real
//      junctions/symlinks and nested CLAUDE.md/AGENTS.md. Nothing outside the temp directories is read or written, and no
//      tested command is ever executed (the hook only classifies).
//   2. PURE: the engine with stubbed filesystem facts (canonicalizer failures, scan failures, injected tree listings).
// Run: node --test scripts/developer-harness-v2/path-resolution.test.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CLASSES, evaluateToolEvent, loadContract } from './policy-engine.mjs'
import { FIXTURES, ROOT, EXISTING_FILES, PACKAGE_SCRIPTS } from './policy-fixtures.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const CONTRACT = loadContract(path.join(REPO, 'docs/developer-harness-v2/contract.json'))
const BASELINE = JSON.parse(readFileSync(path.join(HERE, 'fixtures-baseline-pre-pathres.json'), 'utf8'))
const RANK = Object.fromEntries(CLASSES.map((c, i) => [c, i]))
const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

// ── real-filesystem sandbox ─────────────────────────────────────────────────────────────────────────────────────────
let sb, other, runPolicyHook
const put = (rel, text = 'x\n') => { mkdirSync(path.dirname(path.join(sb, rel)), { recursive: true }); writeFileSync(path.join(sb, rel), text) }
const hasSymlinks = { dir: false, file: false }

before(async () => {
  sb = mkdtempSync(path.join(os.tmpdir(), 'dev harness pathres '))
  other = mkdtempSync(path.join(os.tmpdir(), 'dev harness other '))
  for (const rel of ['.claude/hooks', 'scripts/developer-harness-v2', 'docs/developer-harness-v2']) {
    mkdirSync(path.join(sb, rel), { recursive: true })
    cpSync(path.join(REPO, rel), path.join(sb, rel), { recursive: true })
  }
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'apps/web/CLAUDE.md', 'apps/web/AGENTS.md', 'apps/web/a.ts', 'apps/plain/c.ts', 'docs/deep/nest/CLAUDE.md',
    'docs/guide.md', 'src/ok.ts', 'build/out.js', 'build/sub/x.js', '.wolf/cerebrum.md', '.wolf/knowledge/k.md', '.github/workflows/ci.yml',
    'supabase/migrations/001_init.sql', 'node_modules/pkg/CLAUDE.md']) put(f)
  put('payload/CLAUDE.md'); put('payload/sub/AGENTS.md'); put('clean/readme.txt'); put('skipcase/ok.txt'); put('skipcase/node_modules/p/CLAUDE.md')
  mkdirSync(path.join(sb, 'empty'), { recursive: true })
  writeFileSync(path.join(other, 'note.txt'), 'x\n')
  // Real directory links. Junctions need no privilege on Windows; a directory symlink is tried too and skipped when not permitted.
  for (const [name, target] of [['jn-workflows', '.github/workflows'], ['jn-web', 'apps/web'], ['jn-wolf', '.wolf'], ['jn-plain', 'apps/plain'], ['jn-out', null]]) {
    // `jn-out` points at the real repository checkout: a directory that is outside the sandbox AND outside every temp root.
    symlinkSync(target === null ? REPO : path.join(sb, target), path.join(sb, name), 'junction')
  }
  try { symlinkSync(path.join(sb, '.github/workflows'), path.join(sb, 'sl-workflows'), 'dir'); hasSymlinks.dir = true } catch { /* no privilege */ }
  // DANGLING links: they do not resolve (so a canonicalizer reports the lexical name) yet writing through a file link creates its target.
  symlinkSync(path.join(sb, '.github/not-yet-created'), path.join(sb, 'jn-dangling'), 'junction')
  try { symlinkSync(path.join(sb, '.github/workflows/created.yml'), path.join(sb, 'sl-dangling-file'), 'file'); hasSymlinks.file = true } catch { /* no privilege */ }
  runPolicyHook = (await import(pathToFileURL(path.join(sb, '.claude/hooks/policy-hook.mjs')).href)).runPolicyHook
})
after(() => { for (const d of [sb, other]) if (d) rmSync(d, { recursive: true, force: true }) })

/** @returns {'allowed'|'ask'|'deny'} what the real hook does for this command */
async function decide(command, { tool = 'Bash', cwd, root = sb } = {}) {
  const event = { hook_event_name: 'PreToolUse', session_id: 't', cwd: cwd ?? root, permission_mode: 'default', tool_name: tool, tool_input: { command } }
  const r = await runPolicyHook(JSON.stringify(event), { repoRoot: root, env: {} })
  if (r.exitCode === 2) return 'deny'
  return r.stdout ? 'ask' : 'allowed'
}
const posix = (p) => p.replace(/\\/g, '/')
async function assertGated(commands, tool = 'Bash', opts = {}) {
  for (const c of commands) assert.notEqual(await decide(c, { tool, ...opts }), 'allowed', `${tool}: ${c}`)
}
async function assertAllowed(commands, tool = 'Bash', opts = {}) {
  for (const c of commands) assert.equal(await decide(c, { tool, ...opts }), 'allowed', `${tool}: ${c}`)
}

// ── 1. unsupported tilde expansions ─────────────────────────────────────────────────────────────────────────────────
test('Bash ~+ ~- ~N ~user are never resolved lexically (they name directories the policy cannot know)', async () => {
  await assertGated([
    'echo x > ~+/.github/workflows/ci.yml', 'echo x > ~-/.github/workflows/ci.yml', 'echo x > ~1/.github/workflows/ci.yml', 'echo x > ~+2/.wolf/cerebrum.md',
    'echo x > ~-0/.wolf/cerebrum.md', 'cp src/ok.ts ~+/.wolf/cerebrum.md', 'cp src/ok.ts ~-/CLAUDE.md', 'touch ~+/.github/workflows/ci.yml',
    'rm ~+/.github/workflows/ci.yml', 'mv src/ok.ts ~-/.github/workflows/z.yml', 'echo x > ~root/.wolf/cerebrum.md', 'cp -t ~+/.github/workflows src/ok.ts',
    'cp --target-directory=~-/.wolf src/ok.ts', 'tee ~+/.github/workflows/ci.yml', 'dd of=~+/.github/workflows/ci.yml', 'sed -i s/a/b/ ~+/.github/workflows/ci.yml',
    'cd ~+ && echo x > .github/workflows/ci.yml', 'cd ~- && echo x > relative.txt', 'cd ~1 && echo x > relative.txt',
  ])
  await assertGated(['cat < ~+/.github/workflows/ci.yml', 'sort < ~-/src/ok.ts', 'cat < ~2/src/ok.ts', 'cp ~+/src/ok.ts build/x', 'cp ~-/src/ok.ts build/x']) // a read whose target is unknown is gated too
  await assertGated(['Set-Content ~+/.github/workflows/ci.yml x', 'Remove-Item ~-/.wolf/cerebrum.md'], 'PowerShell')
})

test('ordinary home / worktree-relative writes are unchanged by the tilde rule', async () => {
  await assertAllowed(['echo x > src/new.ts', 'cp src/ok.ts src/ok2.ts', 'touch src/n.ts', 'rm src/ok2.ts', 'mv src/n.ts src/m.ts'])
  assert.equal(await decide('echo x > ~/scratch.txt'), 'ask', 'home writes still need approval (outside the worktree)')
})

// ── 2. drive-relative and provider-qualified paths ──────────────────────────────────────────────────────────────────
test('Windows drive-relative paths (C:foo) are unresolvable, never read as a path under the cwd', async () => {
  await assertGated(['Set-Content C:.github\\workflows\\ci.yml x', 'Set-Content c:CLAUDE.md x', 'Set-Content C:..\\.github\\workflows\\ci.yml x', 'Remove-Item D:foo',
    'Copy-Item src\\ok.ts C:.wolf\\cerebrum.md', 'Move-Item src\\ok.ts C:.github\\workflows\\x.yml', 'New-Item -Path C:.github -Name x.yml', 'Add-Content C:CLAUDE.md x'], 'PowerShell')
  await assertGated(['echo x > C:.github/workflows/ci.yml', 'cp src/ok.ts C:.wolf/cerebrum.md', 'copy src\\ok.ts C:.github\\workflows\\ci.yml', 'touch c:CLAUDE.md', 'rm C:CLAUDE.md'])
  await assertGated(['cat < C:src/ok.ts', 'cp C:src/ok.ts build/x'])
})

test('PowerShell provider-qualified paths are unresolvable (FileSystem::, Registry::, drives like HKLM:)', async () => {
  const abs = posix(sb)
  await assertGated([
    `Set-Content FileSystem::${abs}/.github/workflows/ci.yml x`, `Set-Content Microsoft.PowerShell.Core\\FileSystem::${abs}\\CLAUDE.md x`,
    `Copy-Item src\\ok.ts Microsoft.PowerShell.Core\\FileSystem::${abs}\\.wolf\\cerebrum.md`, `Remove-Item FileSystem::${abs}/.wolf/cerebrum.md`,
    `Move-Item -Path src\\ok.ts -Destination FileSystem::${abs}/.github/workflows/z.yml`, `New-Item -Path FileSystem::${abs}/.github -Name z.yml`,
    'Set-Content Registry::HKCU\\Software\\x 1', 'Remove-Item HKCU:\\Software\\x', 'Set-Content HKLM:\\Software\\x 1', 'Set-Content Env:FOO x', 'Remove-Item Cert:\\CurrentUser\\My\\X',
    `Copy-Item FileSystem::${abs}/src/ok.ts build\\x`,
  ], 'PowerShell')
  // an ordinary file whose name merely contains a colon-free word and `::` text in a pattern is not a path operand
  await assertAllowed(['Select-String -Pattern "a::b" -Path src\\ok.ts'], 'PowerShell')
})

// ── 3. glob deletes ─────────────────────────────────────────────────────────────────────────────────────────────────
test('glob deletes that can match protected files are gated (rm / del / Remove-Item)', async () => {
  await assertGated(['rm CLAU*.md', 'rm *.md', 'rm ./CLAUDE.m?', 'rm apps/*/CLAUDE.md', 'rm -f apps/web/AGENTS.*', 'rm **/CLAUDE.md', 'rm .wolf/c*', 'rm .wolf/*',
    'rm .github/workflows/*.yml', 'rm supabase/migrations/*.sql', 'rm -f CLAUDE.[m]d', 'rm {CLAUDE,AGENTS}.md', 'unlink CLAUDE.m?', 'rm apps/w*/CLAUDE.md',
    'rm apps/web/*', 'rm docs/*/nest/CLAUDE.md', 'rm -- *.md', 'rm "CLAU"*.md'])
  await assertGated(['del *.md', 'del CLAUDE.*', 'del apps/web/AGENTS.*', 'del .github/workflows/*'])
  await assertGated(['del *.md', 'erase apps\\web\\AGENTS.*', 'del .github\\workflows\\*', 'rd CLAUDE.*'], 'PowerShell')
  await assertGated(['Remove-Item CLAUDE.*', 'Remove-Item .\\*.md', 'Remove-Item .github\\workflows\\*', "Remove-Item -Path 'apps\\*\\CLAUDE.md'", 'Remove-Item -Path *.md',
    'Remove-Item -LiteralPath CLAUDE.*', 'ri AGENTS.*', 'Remove-Item supabase\\migrations\\*.sql', 'Remove-Item -Path apps\\web\\* -Force', 'rm apps/web/C*'], 'PowerShell')
})

test('ordinary glob deletes that cannot reach protected names stay allowed', async () => {
  await assertAllowed(['rm build/out.js', 'rm build/sub/x.js', 'rm build/*.js', 'rm src/*.ts', 'rm -f build/sub/*.js', 'rm src/ok.t?'])
  await assertAllowed(['Remove-Item build\\*.js', 'Remove-Item src\\ok.ts'], 'PowerShell')
})

// ── 4. PowerShell New-Item -Path ... -Name ... ──────────────────────────────────────────────────────────────────────
test('New-Item/mkdir classify Path joined with Name (the effective destination), not Path alone', async () => {
  await assertGated(['New-Item -Path apps/plain -Name CLAUDE.md -ItemType File', 'New-Item -Path . -Name AGENTS.md', 'ni -Path .github/workflows -Name ci.yml',
    'New-Item -Path . -Name .env', 'New-Item -Path .wolf -Name cerebrum.md', 'New-Item -Path supabase\\migrations -Name 999_x.sql', 'ni apps/plain -Name CLAUDE.md',
    'New-Item -Path apps/plain -Na CLAUDE.md', 'New-Item -Path apps/plain -Name ..\\..\\.wolf\\cerebrum.md', 'New-Item -Name CLAUDE.md -Path apps/plain',
    'New-Item -Name CLAUDE.md', 'New-Item -Path src,.github -Name n.txt', 'New-Item -Path src -Name x.txt,CLAUDE.md', 'mkdir -Path apps/plain -Name CLAUDE.md', `New-Item -Path . -Name "${posix(REPO)}/outside.txt"`,
    "New-Item -Path . -Name 'apps/web/CLAUDE.md'", 'New-Item -Path:apps/plain -Name:CLAUDE.md', 'New-Item -LiteralPath apps/plain -Name CLAUDE.md',
    'New-Item -Path apps/plain -ItemType File -Name AGENTS.md -Value hi', 'ni -Path apps/plain -n CLAUDE.md'], 'PowerShell')
  await assertAllowed(['New-Item -Path src -Name fresh.ts -ItemType File', 'New-Item -Path build -Name n.txt', 'ni src -Name another.ts', 'New-Item -Path src/new.ts -ItemType File',
    'mkdir -Path build -Name outdir'], 'PowerShell')
})

// ── 5. nested CLAUDE.md / AGENTS.md reached through a directory ────────────────────────────────────────────────────
test('moving / renaming / deleting a directory that CONTAINS a nested CLAUDE.md or AGENTS.md is gated', async () => {
  const away = posix(path.join(other, 'moved'))
  await assertGated([`mv apps/web "${away}"`, 'mv apps/web apps/web2', 'mv docs/deep docs/deep2', 'mv docs/deep/nest docs/nest2', 'mv -t build apps/web', 'rmdir apps/web',
    'rm -r apps/web', 'rm -rf docs/deep', 'git mv apps/web apps/web2', 'git rm -r apps/web', 'mv apps build/apps', 'mv docs build/docs', 'mv payload build/payload',
    'cp -r apps/web build/webcopy', 'cp -r apps/web/. build/x', 'cp -r payload build/p', 'cp -a payload src/p', 'cp -r docs build/d', 'cp -r apps build/a', 'mv payload/sub build/s'])
  await assertGated(['Move-Item apps\\web x', 'Rename-Item apps\\web web2', 'Remove-Item apps\\web -Recurse', 'Copy-Item apps\\web build\\w -Recurse', 'Copy-Item payload build\\p -Recurse',
    'Move-Item docs\\deep build\\deep', 'ren apps\\web web2', 'Remove-Item docs\\deep -Recurse -Force'], 'PowerShell')
  await assertGated(['xcopy apps\\web build\\w /E', 'xcopy payload build\\p /E /I', 'robocopy apps\\web build\\w /E', 'robocopy apps\\web build\\w /MOVE', 'robocopy payload build\\p /S',
    'rd /s /q apps\\web', 'move apps\\web build\\w', 'ren apps\\web web2'], 'PowerShell')
  await assertGated(['prettier --write apps/web'])
})

test('directory operations that cannot reach a protected file stay allowed', async () => {
  const away = posix(path.join(other, 'copied'))
  await assertAllowed(['mv apps/plain apps/plain2', 'mv apps/plain/c.ts apps/plain/d.ts', 'cp -r apps/plain build/plaincopy', 'cp -r clean build/cleancopy', 'cp apps/plain/c.ts build/c.ts',
    'mv clean build/clean2', 'mv empty build/empty2', 'git mv apps/plain apps/plain2', 'git mv src/ok.ts src/ok3.ts', 'mv build/sub build/sub2', `cp -r apps/web "${away}"`, `cp -r payload "${away}"`,
    'cp -r skipcase build/s'])
  // Documented bound: dependency trees (node_modules, .git, .venv …) are not scanned INSIDE a larger operand; as the operand itself they are.
  await assertGated(['cp -r node_modules build/nm', 'mv node_modules/pkg build/pkg'])
  await assertAllowed(['Move-Item apps\\plain apps\\plain2', 'Copy-Item clean build\\cleancopy -Recurse', 'Rename-Item clean clean2'], 'PowerShell')
})

// ── 6. real symlinks / junctions ────────────────────────────────────────────────────────────────────────────────────
test('a REAL junction to a protected directory is resolved to its real target before classification (Bash)', async () => {
  await assertGated(['echo x > jn-workflows/ci.yml', 'echo x > jn-workflows/new.yml', 'cp src/ok.ts jn-workflows/', 'cp src/ok.ts jn-workflows/z.yml', 'rm jn-workflows/ci.yml',
    'mv src/ok.ts jn-wolf/cerebrum.md', 'echo x > jn-web/CLAUDE.md', 'touch jn-wolf/knowledge/new.md', 'tee jn-workflows/ci.yml', 'echo x >> jn-wolf/knowledge/k.md', 'rm jn-web/CLAUDE.md',
    'cp -t jn-workflows src/ok.ts', 'sed -i s/a/b/ jn-workflows/ci.yml', 'rm jn-wolf/*', 'rm jn-web/*', 'mv jn-wolf/cerebrum.md src/x.md', 'dd of=jn-workflows/ci.yml'])
})

test('a REAL junction to a protected directory is resolved to its real target before classification (PowerShell)', async () => {
  await assertGated(['Set-Content jn-workflows\\ci.yml x', 'New-Item -Path jn-workflows -Name z.yml', 'Remove-Item jn-wolf\\*', 'Copy-Item src\\ok.ts jn-workflows\\', 'Add-Content jn-wolf\\cerebrum.md x',
    'Move-Item src\\ok.ts jn-wolf\\cerebrum.md','Out-File jn-workflows\\ci.yml', 'Remove-Item jn-web\\CLAUDE.md', 'Rename-Item jn-wolf\\cerebrum.md c2.md', 'Set-Content -Path jn-web\\CLAUDE.md -Value x'], 'PowerShell')
})

test('a command run FROM inside a junction, and cd through one, uses the real directory', async () => {
  await assertGated(['echo x > ci.yml', 'rm ci.yml', 'cp ../src/ok.ts z.yml'], 'Bash', { cwd: path.join(sb, 'jn-workflows') })
  await assertGated(['cd jn-workflows && echo x > ci.yml', 'cd jn-wolf && rm cerebrum.md', 'cd jn-web; touch CLAUDE.md', 'pushd jn-workflows; echo x > ci.yml'])
  await assertGated(['Set-Content ci.yml x'], 'PowerShell', { cwd: path.join(sb, 'jn-workflows') })
})

test('`..` after a link is applied to the link\'s REAL target, not collapsed lexically', async () => {
  await assertGated(['echo x > jn-workflows/../ci.yml', 'cp src/ok.ts jn-workflows/../ci.yml', 'rm jn-workflows/../ci.yml', 'touch jn-wolf/../.wolf/cerebrum.md', 'cd jn-workflows && cd .. && echo x > ci.yml',
    'cd jn-workflows; cd ..; rm ci.yml', 'echo x > jn-workflows/./../ci.yml', 'echo x > jn-workflows//../ci.yml', 'echo x > jn-web/../web/CLAUDE.md', 'tee jn-workflows/../ci.yml'])
  await assertGated(['Set-Content jn-workflows\\..\\ci.yml x', 'Remove-Item jn-workflows\\..\\ci.yml'], 'PowerShell')
  await assertAllowed(['echo x > jn-plain/../new.ts', 'cp src/ok.ts jn-plain/../copy.ts', 'echo x > src/../src/fine.ts', 'echo x > jn-plain/../../src/fine2.ts'])
})

test('C1: `..` after a link is read BOTH ways (real target for POSIX tools, text for PowerShell/cmd/Node) and the stricter wins', async () => {
  await assertGated(['Set-Content jn-plain\\..\\.wolf\\cerebrum.md x', 'Remove-Item jn-plain\\..\\scripts\\a.sh', 'Copy-Item src\\ok.ts jn-plain\\..\\.github\\workflows\\ci.yml',
    'Move-Item src\\ok.ts jn-plain\\..\\.github\\workflows\\ci.yml', 'Out-File -FilePath jn-plain\\..\\.wolf\\cerebrum.md', 'Set-Content jn-plain\\..\\supabase\\migrations\\001.sql x'], 'PowerShell')
  assert.equal(await decide('Set-Content jn-plain\\..\\supabase\\migrations\\001_init.sql x', { tool: 'PowerShell' }), 'deny', 'an existing migration stays forbidden under either reading')
  await assertGated(['robocopy src jn-plain/../.github/workflows ok.ts', 'cp src/ok.ts jn-plain/../.wolf/cerebrum.md'])
  for (const [tool, input] of [['Write', { file_path: `${posix(sb)}/jn-plain/../.wolf/cerebrum.md`, content: 'x' }], ['Edit', { file_path: `${posix(sb)}/jn-plain/../.github/workflows/ci.yml`, old_string: 'a', new_string: 'b' }]]) {
    const r = await runPolicyHook(JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 't', cwd: sb, permission_mode: 'default', tool_name: tool, tool_input: input }), { repoRoot: sb, env: {} })
    assert.ok(r.exitCode === 2 || r.stdout, `${tool} through link/..`)
  }
  await assertAllowed(['echo x > jn-plain/../new.ts'])
})

test('C2: cd/pushd/popd/CDPATH leave the cwd UNKNOWN instead of a guess that differs from the shell', async () => {
  await assertGated(['cd jn-plain && cd .. && echo x > .wolf/cerebrum.md', 'pushd .github/workflows; pushd ../../build; popd; echo x > ci.yml', 'pushd .github/workflows; pushd ../../src; pushd +1; echo x > ci.yml',
    'export CDPATH=.github; cd workflows; echo x > ci.yml', 'CDPATH=.github cd workflows && echo x > ci.yml', 'pushd src; popd; echo x > .wolf/cerebrum.md'])
  await assertGated(['Set-Location jn-plain; Set-Location ..; Set-Content .wolf\\cerebrum.md x', 'Push-Location src; Pop-Location; Set-Content .wolf\\cerebrum.md x'], 'PowerShell')
  await assertAllowed(['cd src && echo x > new.ts', 'cd src && cd .. && echo x > src/n2.ts'])
})

test('H1: link creation through New-Item is recognised in any spelling of -ItemType (and as a link, never as file content)', async () => {
  await assertGated(['New-Item -It HardLink -Path src/h.md -Value CLAUDE.md', 'New-Item -ItemType:HardLink -Path src/h.md -Value CLAUDE.md', 'New-Item -itemType HardLink -Path src/h.md -Value CLAUDE.md',
    'ni src/h.md -ty HardLink -Va .github/workflows/ci.yml', 'New-Item -It Junction -Path jn2 -Value apps\\plain', 'New-Item -ItemType SymbolicLink -Path s2 -Value CLAUDE.md', 'New-Item -ItemType "HardLink" -Path src/h.md -Value x'], 'PowerShell')
  await assertAllowed(['New-Item -ItemType File -Path src/n.txt', 'New-Item -It Directory -Path src/newdir', 'ni -ty file src/n3.txt'], 'PowerShell')
})

test('M1: copying a tree whose links the copier may follow into the repository is gated', async () => {
  const tree = posix(path.join(other, 'srcTree'))
  mkdirSync(path.join(other, 'srcTree'), { recursive: true }); mkdirSync(path.join(other, 'linked'), { recursive: true }); writeFileSync(path.join(other, 'linked', 'CLAUDE.md'), 'x\n')
  writeFileSync(path.join(other, 'srcTree', 'a.txt'), 'x\n')
  symlinkSync(path.join(other, 'linked'), path.join(other, 'srcTree', 'jn'), 'junction')
  await assertGated([`cp -rL "${tree}" apps/x`, `cp -r "${tree}" apps/x`, `cp -rL "${tree}/." apps/plain`])
  await assertGated([`Copy-Item "${tree}" apps\\x -Recurse`], 'PowerShell')
})

test('M2: any multi-character drive name (gh:\\x) is a provider path, but URLs and name:text are not', async () => {
  await assertGated(['Set-Content gh:\\ci.yml x', 'Remove-Item gh:/ci.yml', 'Set-Content myprofiledrive:\\a x'], 'PowerShell')
  await assertAllowed(['Select-String -Pattern "a::b" -Path src\\ok.ts'], 'PowerShell')
  await assertAllowed(['grep -n "https://example.com/x" src/ok.ts', 'grep -n "HEAD:file" src/ok.ts'])
})

test('C2b: stack options, StackName, bare pushd and `cd -` leave the cwd unknown (final-review findings)', async () => {
  const tmp = posix(os.tmpdir())
  await assertGated([`cd .github/workflows && pushd -n ${tmp} && echo x > ci.yml`, 'pushd scripts; pushd ../build; pushd; echo x > evil.sh', 'cd .github/workflows && cd - && echo x > ci.yml', 'cd .github/workflows && cd -P . && echo x > ci.yml'])
  await assertGated([`Set-Location .github\\workflows; Push-Location -StackName ${tmp} .; Set-Content ci.yml x`, `Set-Location .github\\workflows; Set-Location -StackName ${tmp}; Set-Content ci.yml x`, 'Set-Location .github\\workflows; Push-Location; Set-Content ci.yml x', 'Set-Location -Path:.github\\workflows; Set-Content ci.yml x'], 'PowerShell')
  await assertAllowed(['cd src && cd -L . && echo x > n9.ts', 'cd -P src && echo x > n8.ts'])
  await assertAllowed(['Set-Location -Path src; Set-Content n7.ts x'], 'PowerShell')
})

test('C2c: a cd that may not have taken effect (failed, extra operand, subshell, pipe, background, &&/||, if) leaves the cwd UNKNOWN', async () => {
  const tmp = posix(os.tmpdir())
  await assertGated([`cd .github/workflows; cd ${tmp}/nonexist_zz; echo x > ci.yml`, `cd .github/workflows; cd ${tmp} extra; echo x > ci.yml`, `cd .github/workflows; (cd ${tmp}); echo x > ci.yml`, `cd .github/workflows; cd ${tmp} | true; echo x > ci.yml`, `cd .github/workflows; cd ${tmp} & echo x > ci.yml`, `cd .github/workflows; false && cd ${tmp}; echo x > ci.yml`, `cd .github/workflows; true || cd ${tmp}; echo x > ci.yml`, `cd .github/workflows; if false; then cd ${tmp}; fi; echo x > ci.yml`, `cd .github/workflows && (cd ${tmp}) && echo x > ci.yml`])
  await assertGated([`Set-Location .github\\workflows; Set-Location ${tmp}\\nonexist_zz; Set-Content ci.yml x`, `Set-Location .github\\workflows; chdir ${tmp} extra; Set-Content ci.yml x`, `Set-Location .github\\workflows; if ($false) { Set-Location ${tmp} }; Set-Content ci.yml x`, `Set-Location .github\\workflows; Set-Location ${tmp} | Out-Null; Set-Content ci.yml x`], 'PowerShell')
  // round-4: `!` inverts a failed cd, `coproc` backgrounds it, wrappers may run it in a child process, and a FILE is not a directory
  await assertGated([`cd .github/workflows && ! cd ${tmp}/nonexist_zz && echo x > ci.yml`, `cd .github/workflows && coproc cd ${tmp} && echo x > ci.yml`, `cd .github/workflows && env cd ${tmp} && echo x > ci.yml`,
    `cd .github/workflows && nohup cd ${tmp} && echo x > ci.yml`, `cd .github/workflows && timeout 5 cd ${tmp} && echo x > ci.yml`, `cd .github/workflows && xargs cd ${tmp} && echo x > ci.yml`])
  await assertGated([`Set-Location .github\\workflows; Set-Location "${posix(path.join(other, 'note.txt'))}"; Set-Content ci.yml x`], 'PowerShell')
  // round-5: PowerShell does not normalise the way the resolver does — these Set-Location calls FAIL and the location stays put
  const wtmp = os.tmpdir(), wmangled = wtmp.slice(0, -path.basename(wtmp).length) + 'Te%6Dp'
  await assertGated([`Set-Location .github\\workflows; Set-Location "${wtmp} "; Set-Content ci.yml x`, `Set-Location .github\\workflows; Set-Location "${wtmp}."; Set-Content ci.yml x`, `Set-Location .github\\workflows; Set-Location "${wtmp}:x"; Set-Content ci.yml x`, `Set-Location .github\\workflows; Set-Location "${wtmp}\\nonexist:zz"; Set-Content ci.yml x`, `Set-Location .github\\workflows; Set-Location "${wmangled}"; Set-Content ci.yml x`, `Set-Location .github\\workflows; Set-Location "${wtmp}\\*"; Set-Content ci.yml x`], 'PowerShell')
  await assertGated(['Set-Location .github\\workflows; Set-Location ' + '/' + wtmp.replace(':', '').replace(/\\/g, '/') + '; Set-Content ci.yml x'], 'PowerShell') // Git Bash spelling: PowerShell reads /c/... as C:\c\...
  await assertAllowed(['Set-Location src; Set-Content n4.ts x', 'Set-Location -Path src; Set-Content n4b.ts x'], 'PowerShell')

  await assertAllowed(['builtin cd src && echo x > n6c.ts', 'command cd src && echo x > n6d.ts'])

  // in a pure && chain a failed cd (missing target, extra operand) STOPS the chain: the write never runs, so tracking it is harmless
  await assertAllowed(['cd src && echo x > n6.ts', 'cd src && cd .. && echo x > src/n6b.ts'])
  await assertAllowed(['Set-Location src; Set-Content n5.ts x'], 'PowerShell')
})

test('final review: the glob folder, copy source and bulk destination are read BOTH ways too (`link/..` as text)', async () => {
  await assertGated(['Remove-Item jn-plain\\..\\.wolf\\cer*', 'Move-Item jn-plain\\..\\ap* build\\x', 'Copy-Item jn-plain\\..\\apps\\web build\\w -Recurse', 'Copy-Item src\\ok.ts jn-plain\\..\\.wolf\\cerebrum.md'], 'PowerShell')
  await assertGated(['rm jn-plain/../.wolf/cer*', 'mv jn-plain/../ap* build/x', 'cp -r jn-plain/../apps/web build/w'])
})

test('a junction that leaves the worktree is an outside-the-worktree write; a junction to harmless files stays allowed', async () => {
  await assertGated(['echo x > jn-out/f.txt', 'cp src/ok.ts jn-out/', 'rm jn-out/note.txt', 'mv src/ok.ts jn-out/n.ts'])
  await assertGated(['Set-Content jn-out\\f.txt x'], 'PowerShell')
  await assertAllowed(['echo x > jn-plain/n.ts', 'cp src/ok.ts jn-plain/n.ts', 'rm jn-plain/c.ts'])
})

test('a real directory SYMLINK is resolved the same way (skipped where the OS withholds the privilege)', async (t) => {
  if (!hasSymlinks.dir) return t.skip('directory symlinks not permitted on this machine')
  await assertGated(['echo x > sl-workflows/ci.yml', 'cp src/ok.ts sl-workflows/', 'rm sl-workflows/ci.yml', 'touch sl-workflows/q.yml'])
  await assertGated(['Set-Content sl-workflows\\ci.yml x'], 'PowerShell')
})

test('a DANGLING link is never resolved as if it did not exist (writing through it would create its target)', async (t) => {
  await assertGated(['echo x > jn-dangling/new.yml', 'cp src/ok.ts jn-dangling/z.yml', 'mkdir jn-dangling/sub', 'touch jn-dangling/f'])
  await assertGated(['Set-Content jn-dangling\\new.yml x', 'New-Item -Path jn-dangling -Name z.yml'], 'PowerShell')
  if (!hasSymlinks.file) return t.diagnostic('file symlinks not permitted on this machine: the directory-link variant above covers the same code path')
  await assertGated(['echo x > sl-dangling-file', 'cp src/ok.ts sl-dangling-file', 'rm sl-dangling-file', 'touch sl-dangling-file'])
  await assertGated(['Set-Content sl-dangling-file x'], 'PowerShell')
})

test('the project root itself reached through a link or a different spelling still classifies repository files as repository files', async () => {
  const viaLink = path.join(sb, 'jn-plain') // a real link into the repo, used as the event cwd
  await assertAllowed(['echo x > n.ts'], 'Bash', { cwd: viaLink })
  await assertGated(['echo x > ../../CLAUDE.md', 'echo x > ../../.wolf/cerebrum.md'], 'Bash', { cwd: viaLink })
  await assertGated(['echo x > ../../.github/workflows/ci.yml'], 'Bash', { cwd: path.join(sb, 'apps', 'plain') })
})

test('a project root that is itself reached through a junction is still the repository (not "outside the worktree")', async () => {
  const rootLink = path.join(other, 'root-link')
  symlinkSync(sb, rootLink, 'junction')
  const viaLink = { root: rootLink }
  await assertAllowed(['echo x > src/new.ts', 'cp src/ok.ts src/copy.ts', 'rm src/new.ts', 'mv build/out.js build/out2.js'], 'Bash', viaLink)
  await assertGated(['echo x > .wolf/cerebrum.md', 'echo x > .github/workflows/ci.yml', 'rm CLAUDE.md', 'echo x > apps/web/CLAUDE.md', 'mv apps/web apps/web2', 'rm supabase/migrations/001_init.sql'], 'Bash', viaLink)
  await assertGated(['Set-Content .github\\workflows\\ci.yml x', 'Remove-Item CLAUDE.*'], 'PowerShell', viaLink)
  // the same classification as the direct path: a protected edit is a protected edit, not a generic "outside" approval
  const reason = async (cmd, root) => JSON.parse((await runPolicyHook(JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 't', cwd: root, permission_mode: 'default', tool_name: 'Bash', tool_input: { command: cmd } }), { repoRoot: root, env: {} })).stdout).hookSpecificOutput.permissionDecisionReason
  assert.match(await reason('echo x > .wolf/cerebrum.md', rootLink), /path\.protected_agent_config/)
  assert.match(await reason('echo x > .wolf/cerebrum.md', sb), /path\.protected_agent_config/)
})

// ── 7 / 8. pure: canonicalization failure and fail-closed classification ────────────────────────────────────────────
const ctxFor = (extra = {}) => ({
  contract: CONTRACT, projectRoot: ROOT, homeDir: 'C:/Users/dev', tempRoots: ['C:/Users/dev/AppData/Local/Temp', '/tmp'], platform: 'win32',
  pathExists: (p) => EXISTING_FILES.has(String(p).toLowerCase()),
  readPackageScripts: (d) => Object.entries(PACKAGE_SCRIPTS).find(([k]) => k.toLowerCase() === String(d).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase())?.[1] ?? null,
  resolveWorkspace: () => null, gitState: () => ({ branch: 'feat/x', upstreamBranch: 'feat/x', hasUpstream: true }), ...extra,
})
const evt = (tool, input) => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: ROOT, permission_mode: 'default', tool_name: tool, tool_input: input, tool_use_id: 't' })
const run = (command, tool = 'Bash', extra = {}) => evaluateToolEvent(evt(tool, { command, description: 'fixture' }), ctxFor(extra))
const cls = (command, tool = 'Bash', extra = {}) => run(command, tool, extra).classification

test('a canonicalizer that throws or returns nonsense never yields an allowed decision for an unresolved path', () => {
  const broken = {
    throws: () => { throw new Error('EACCES') }, undefined: () => undefined, empty: () => '', null: () => null, number: () => 42, object: () => ({}),
    relative: () => 'relative/only',
  }
  for (const [name, canonicalize] of Object.entries(broken)) {
    for (const c of ['echo x > src/a.ts', 'cp src/a.ts src/b.ts', 'rm src/a.ts', 'touch src/a.ts', 'mv src/a.ts src/b.ts']) {
      assert.notEqual(cls(c, 'Bash', { canonicalize }), 'allowed', `${name}: ${c}`)
    }
    assert.notEqual(cls('cat < src/a.ts', 'Bash', { canonicalize }), 'allowed', `${name}: read redirect`)
    assert.notEqual(cls('cp src/a.ts build/b.ts', 'Bash', { canonicalize }), 'allowed', `${name}: copy source`)
    assert.notEqual(cls('Set-Content src\\a.ts x', 'PowerShell', { canonicalize }), 'allowed', `${name}: Set-Content`)
    assert.equal(run('echo x > src/a.ts', 'Bash', { canonicalize }).action, 'edit_outside_task_worktree', `${name}: fail-closed uses an existing approval class`)
    const r = evaluateToolEvent(evt('Write', { file_path: `${ROOT}/src/a.ts`, content: 'x' }), ctxFor({ canonicalize }))
    assert.notEqual(r.classification, 'allowed', `${name}: Write tool`)
  }
})

test('a working canonicalizer keeps ordinary operations allowed and is applied to the repository root as well', () => {
  const identity = (p) => p
  assert.equal(cls('echo x > src/a.ts', 'Bash', { canonicalize: identity }), 'allowed')
  // root reached through a different spelling (short name / link) than the event cwd: both must classify as repository files
  const canon = (p) => p.replace(/^C:\/work\/PAT~1/i, 'C:/work/PatelRep')
  const r = evaluateToolEvent({ ...evt('Bash', { command: 'echo x > .wolf/cerebrum.md' }), cwd: 'C:/work/PAT~1' }, ctxFor({ canonicalize: canon }))
  assert.equal(r.classification, 'human_approval')
  const ok = evaluateToolEvent({ ...evt('Bash', { command: 'echo x > src/a.ts' }), cwd: 'C:/work/PAT~1' }, ctxFor({ canonicalize: canon }))
  assert.equal(ok.classification, 'allowed')
})

test('every unresolvable path form selects an EXISTING approval-required class, never a new or permissive one', () => {
  const forms = ['echo x > ~+/a', 'echo x > ~-/a', 'echo x > ~2/a', 'echo x > ~root/a']
  for (const c of forms) {
    const r = run(c)
    assert.ok(Object.hasOwn(CONTRACT.actions, r.action), `${c} → ${r.action} is a contract action`)
    assert.equal(r.classification, 'human_approval', c)
    assert.equal(r.reasonCode, 'path.unresolvable_form', c)
  }
  for (const c of ['Set-Content C:a x', 'Set-Content FileSystem::C:\\a x', 'Set-Content Registry::HKCU\\a x']) {
    const r = run(c, 'PowerShell')
    assert.equal(r.classification, 'human_approval', c)
    assert.ok(Object.hasOwn(CONTRACT.actions, r.action), c)
  }
  assert.equal(run('cat < ~+/a').action, 'run_unrecognized_command')
  assert.equal(run('cat < ~+/a').classification, 'human_approval')
})

test('a link-check that reports a link, fails, or returns garbage never yields an allowed decision (injected)', () => {
  for (const [name, isDanglingLink] of Object.entries({ dangling: () => true, throws: () => { throw new Error('EIO') }, garbage: () => 'maybe', undefined: () => undefined })) {
    assert.notEqual(cls('echo x > src/a.ts', 'Bash', { canonicalize: (p) => p, isDanglingLink }), 'allowed', name)
    assert.equal(run('echo x > src/a.ts', 'Bash', { canonicalize: (p) => p, isDanglingLink }).reasonCode, 'path.canonicalize_failed', name)
  }
  assert.equal(cls('echo x > src/a.ts', 'Bash', { canonicalize: (p) => p, isDanglingLink: () => false }), 'allowed')
})

test('glob directory listing: an unlistable or oversized directory falls back to scanning it; a listed one is judged by the directories the glob matches', () => {
  const hit = () => ({ status: 'ok', found: true })
  const none = () => ({ status: 'ok', found: false })
  assert.equal(cls('mv apps/p* build/', 'Bash', { listDirs: () => null, scanTree: hit }), 'human_approval', 'unlistable: the whole directory tree decides')
  assert.equal(cls('mv apps/p* build/', 'Bash', { listDirs: () => { throw new Error('x') }, scanTree: hit }), 'human_approval')
  assert.equal(cls('mv apps/p* build/', 'Bash', { listDirs: () => 'garbage', scanTree: hit }), 'human_approval')
  assert.equal(cls('mv apps/p* build/', 'Bash', { listDirs: () => ['plain', 'other'], scanTree: (p) => (/web/.test(p) ? hit() : none()) }), 'allowed', 'the matched directories are clean')
  assert.equal(cls('mv apps/w* build/', 'Bash', { listDirs: () => ['plain', 'web'], scanTree: (p) => (/web$/.test(p) ? hit() : none()) }), 'human_approval', 'a matched directory holds CLAUDE.md')
  assert.equal(cls('rm apps/w*', 'Bash', { listDirs: () => ['web'], scanTree: hit }), 'human_approval')
})

test('a tree that cannot be listed, or is too large, fails closed for moves/deletes of that directory (injected scanner)', () => {
  const tooLarge = () => ({ status: 'limit' })
  const failed = () => ({ status: 'error' })
  const clean = () => ({ status: 'ok', found: false })
  const withHit = () => ({ status: 'ok', found: true })
  assert.equal(cls('mv apps/plain apps/plain2', 'Bash', { scanTree: tooLarge }), 'human_approval')
  assert.equal(cls('mv apps/plain apps/plain2', 'Bash', { scanTree: failed }), 'human_approval')
  assert.equal(cls('mv apps/plain apps/plain2', 'Bash', { scanTree: withHit }), 'human_approval')
  assert.equal(cls('mv apps/plain apps/plain2', 'Bash', { scanTree: clean }), 'allowed')
  assert.equal(cls('mv apps/plain apps/plain2', 'Bash', { scanTree: () => { throw new Error('boom') } }), 'human_approval')
  assert.equal(cls('mv apps/plain apps/plain2', 'Bash', { scanTree: () => 'garbage' }), 'human_approval')
  assert.equal(cls('mv apps/plain/c.ts apps/plain/d.ts', 'Bash', { scanTree: tooLarge }), 'human_approval', 'an unlistable operand cannot be proven to be a plain file')
})

// ── no broadening ───────────────────────────────────────────────────────────────────────────────────────────────────
test('earlier classification fixtures: not one is less restrictive than before this remediation, and every one still meets its own expectation', () => {
  assert.equal(BASELINE.count, 589)
  assert.equal(Object.keys(BASELINE.classifications).length, FIXTURES.length, 'baseline covers every earlier fixture')
  const lower = []
  const abs = (p) => (/^[A-Za-z]:\//.test(p) ? p : `${ROOT}/${p}`)
  for (const fx of FIXTURES) {
    const before = BASELINE.classifications[fx.id]
    assert.ok(before, `baseline for ${fx.id}`)
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
    const now = evaluateToolEvent({ ...evt(fx.tool, input), permission_mode: fx.mode ?? 'default' }, ctxFor({ gitState: () => fx.git ?? { branch: 'feat/x', upstreamBranch: 'feat/x', hasUpstream: true } })).classification
    if (RANK[now] < RANK[before]) lower.push(`${fx.id}: ${before} → ${now}`)
    assert.equal(now, fx.expect, `${fx.id} still meets its own expectation`)
  }
  assert.deepEqual(lower, [])
})

test('policy contract surfaces are untouched by this remediation', () => {
  assert.equal(digest(CONTRACT.actions), '80cbf36c889d2a6db5c382c20910d221aa10e0834291ac82e7fc5eb05e062890')
  assert.equal(digest(CONTRACT.protected_infrastructure), 'c4d3fa844279db8fa66f7204d3e062794660ed114818a1bae00434adbd0258b9')
  assert.equal(digest(CONTRACT.roles), 'fa787dbee2e6ab5ea1b816d7d81ad9c6caf1df250f511467f283aac92a478f3e')
  assert.equal(digest(CONTRACT.topology), '8fe7bad50a16e9517d8b4a4c313b21f7d64ab2f9934722f3f75bc555c4776ce0')
})
