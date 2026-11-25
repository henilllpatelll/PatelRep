// Developer Harness V2 — permission transition: hook-level tests in disposable sandbox repositories.
// Real hook process / real filesystem digests / real .git branch state; synthetic files only. Never runs a protected command, never
// touches the real DH3 infrastructure root, never reads a credential. The one exception to "synthetic only" is the shipped-pins provenance
// test: it reads the repository's own git objects and, in a SHALLOW clone (a CI checkout) only, fetches exactly the pinned commit from
// `origin`. Run: node --test scripts/developer-harness-v2/bypass-hook.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { contentDigest, digestTree } from './bypass-digest.mjs'
import { digestRef, gitExecutable, resolveCommit, verifyPinProvenance } from './bypass-pins.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCOPE_BRANCH = 'feat/scope-sandbox'
const CLOSURE = { include: ['scripts/developer-harness-v3/', 'docs/developer-harness-v3/authority-contract.json'], exclude: ['scripts/developer-harness-v3/tests/'] }
const sandboxes = []

/** A throwaway repository holding only the policy (hook, engine, contract) plus synthetic "privileged" files pinned by a sandbox scope. */
function sandbox(branch, { pin = true } = {}) {
  const sb = mkdtempSync(path.join(os.tmpdir(), 'dh2-bypass-'))
  sandboxes.push(sb)
  for (const rel of ['.claude/hooks', 'scripts/developer-harness-v2', 'docs/developer-harness-v2']) cpSync(path.join(REPO, rel), path.join(sb, rel), { recursive: true })
  const put = (rel, text) => { mkdirSync(path.dirname(path.join(sb, rel)), { recursive: true }); writeFileSync(path.join(sb, rel), text) }
  put('scripts/developer-harness-v3/bin/dh3.mjs', "console.log('synthetic dh3')\n")
  put('scripts/developer-harness-v3/runtime/vm.mjs', 'export const vm = 1\n')
  put('scripts/developer-harness-v3/tests/vm.test.mjs', 'export {}\n')
  put('docs/developer-harness-v3/authority-contract.json', '{}\n')
  put('tools/ok.mjs', "console.log('ok')\n")
  put('tools/evil.mjs', "import { writeFileSync } from 'node:fs'\nwriteFileSync('.claude/settings.local.json', '{}')\n")
  put('package.json', JSON.stringify({ name: 'sandbox', private: true, scripts: { build: 'node tools/ok.mjs' } }))
  const scopesFile = path.join(sb, 'docs/developer-harness-v2/bypass-scopes.json')
  const doc = JSON.parse(readFileSync(scopesFile, 'utf8'))
  doc.scopes = [{ id: 'sandbox', branch: SCOPE_BRANCH, worktree: realpathSync.native(sb).split(path.sep).join('/'), writable_protected_paths: ['scripts/developer-harness-v3/**'], excluded_paths: ['scripts/developer-harness-v3/authority/**'],
    trusted_executions: [{ id: 'cli', entrypoint: 'scripts/developer-harness-v3/bin/dh3.mjs', interpreter: 'node', subcommands: ['status'], options: ['--id'], closure: CLOSURE,
      digests: pin ? digestTree(sb, CLOSURE) : {} }] }]
  writeFileSync(scopesFile, `${JSON.stringify(doc, null, 2)}\n`)
  const g = spawnSync('git', ['init', '-q', '-b', branch, sb], { encoding: 'utf8' })
  assert.equal(g.status, 0, g.stderr)
  return { sb, put }
}
test.after(() => { for (const d of sandboxes) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })

const hook = async (sb, tool, input, mode = 'bypassPermissions', raw) => {
  const { runPolicyHook } = await import(pathToFileURL(path.join(sb, '.claude/hooks/policy-hook.mjs')).href)
  const event = raw ?? JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', cwd: sb, permission_mode: mode, tool_name: tool, tool_input: input })
  return runPolicyHook(event, { repoRoot: sb, env: {} })
}
const bash = (sb, command, mode) => hook(sb, 'Bash', { command }, mode)
const proceed = (r, label) => { assert.equal(r.exitCode, 0, `${label}: ${r.stderr}`); assert.equal(r.stdout, '', `${label} must not ask`) }
const blocked = (r, label, re) => { assert.equal(r.exitCode, 2, `${label} must exit 2`); assert.equal(r.stdout, ''); if (re) assert.match(r.stderr, re, label) }

test('process level: an owner-launched bypass session proceeds on routine work and blocks protected work (exit codes)', () => {
  const { sb } = sandbox('feat/routine')
  const run = (event) => spawnSync(process.execPath, [path.join(sb, '.claude/hooks/local-hook.mjs'), 'policy'], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', cwd: sb, permission_mode: 'bypassPermissions', ...event }),
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', CLAUDE_PROJECT_DIR: sb, TEMP: os.tmpdir(), TMP: os.tmpdir() }, encoding: 'utf8', timeout: 20_000, cwd: sb,
  })
  for (const e of [{ tool_name: 'Write', tool_input: { file_path: path.join(sb, 'apps/web/x.ts'), content: 'export const x = 1\n' } }, { tool_name: 'Bash', tool_input: { command: 'npm install left-pad' } },
    { tool_name: 'Bash', tool_input: { command: 'node tools/ok.mjs' } }, { tool_name: 'Bash', tool_input: { command: 'git push -u origin feat/routine' } }]) {
    const r = run(e)
    assert.equal(r.status, 0, `${JSON.stringify(e.tool_input)}: ${r.stderr}`)
    assert.equal(r.stdout, '')
  }
  for (const [e, re] of [[{ tool_name: 'Bash', tool_input: { command: 'git push origin main' } }, /forbidden: .*\[git\.push_protected\]/],
    [{ tool_name: 'Write', tool_input: { file_path: path.join(sb, '.claude/settings.json'), content: '{}' } }, /bypass_denied/],
    [{ tool_name: 'Bash', tool_input: { command: 'node tools/evil.mjs' } }, /\[bypass\.script_references_policy\]/]]) {
    const r = run(e)
    assert.equal(r.status, 2, JSON.stringify(e.tool_input))
    assert.match(r.stderr, re)
  }
})

test('the branch comes from .git: main, master and a detached HEAD get no authorization; default mode still asks', async () => {
  for (const branch of ['main', 'master']) blocked(await bash(sandbox(branch).sb, 'npm install left-pad'), branch, /\[bypass\.not_dedicated_branch\]/)
  const { sb } = sandbox('feat/detached')
  writeFileSync(path.join(sb, '.git', 'HEAD'), `${'a'.repeat(40)}\n`)
  blocked(await bash(sb, 'npm install left-pad'), 'detached HEAD', /\[bypass\.not_dedicated_branch\]/)
  const r = await bash(sandbox('feat/default').sb, 'npm install left-pad', 'default')
  assert.equal(r.exitCode, 0)
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask')
})

test('scope branch: pinned dh3 runs from real digests; a content change, new file or link breaks the pin; CRLF does not', async () => {
  const { sb, put } = sandbox(SCOPE_BRANCH)
  const dh3 = 'node scripts/developer-harness-v3/bin/dh3.mjs status'
  proceed(await bash(sb, dh3), 'pinned entrypoint')
  proceed(await hook(sb, 'Write', { file_path: path.join(sb, 'scripts/developer-harness-v3/runtime/vm.mjs'), content: 'export const vm = 2\n' }), 'scoped implementation edit (the edit itself)')
  put('scripts/developer-harness-v3/runtime/vm.mjs', 'export const vm = 1\r\n')
  proceed(await bash(sb, dh3), 'CRLF checkout of the same content')
  put('scripts/developer-harness-v3/tests/vm.test.mjs', 'export const changed = true\n')
  proceed(await bash(sb, dh3), 'tests are outside the closure')
  put('scripts/developer-harness-v3/runtime/vm.mjs', 'export const vm = 2\n')
  blocked(await bash(sb, dh3), 'modified privileged file', /runtime\/vm\.mjs.*\[bypass\.pin_mismatch\]/)
  put('scripts/developer-harness-v3/runtime/vm.mjs', 'export const vm = 1\n')
  put('scripts/developer-harness-v3/runtime/extra.mjs', 'export {}\n')
  blocked(await bash(sb, dh3), 'added privileged file', /extra\.mjs.*\[bypass\.pin_mismatch\]/)
  rmSync(path.join(sb, 'scripts/developer-harness-v3/runtime/extra.mjs'))
  proceed(await bash(sb, dh3), 'restored')
  put('docs/developer-harness-v3/authority-contract.json', '{"active_actions":["everything"]}\n')
  blocked(await bash(sb, dh3), 'modified V3 contract inside the closure', /\[bypass\.pin_mismatch\]/)
  put('docs/developer-harness-v3/authority-contract.json', '{}\n')
  mkdirSync(path.join(sb, 'elsewhere'), { recursive: true })
  symlinkSync(path.join(sb, 'elsewhere'), path.join(sb, 'scripts/developer-harness-v3/linked'), 'junction')
  blocked(await bash(sb, dh3), 'link inside the closure', /\[bypass\.pin_unverifiable\]/)
  blocked(await hook(sb, 'Write', { file_path: path.join(sb, 'scripts/developer-harness-v3/authority/x.mjs'), content: 'x' }), 'V3 authority edit', /\[bypass\.path_never_authorizable\]/)
  blocked(await hook(sb, 'Write', { file_path: path.join(sb, 'docs/developer-harness-v2/bypass-scopes.json'), content: '{}' }), 'scopes self-edit', /bypass_denied/)
})

test('the scopes file: missing, corrupt or invalid denies bypass (fail closed) without breaking default mode', async () => {
  const cases = [['missing', (f) => rmSync(f)], ['corrupt', (f) => writeFileSync(f, '{ not json')], ['invalid', (f) => writeFileSync(f, JSON.stringify({ version: 1, scopes: [] }))],
    ['over the ceiling', (f) => { const d = JSON.parse(readFileSync(f, 'utf8')); d.routine.enabled_actions.push('merge_pull_request'); writeFileSync(f, JSON.stringify(d)) }]]
  for (const [label, damage] of cases) {
    const { sb } = sandbox('feat/scopes')
    damage(path.join(sb, 'docs/developer-harness-v2/bypass-scopes.json'))
    blocked(await bash(sb, 'npm install left-pad'), label, /\[bypass\.authorization_unavailable\]/)
    blocked(await bash(sb, 'git push origin main'), `${label}: forbidden still forbidden`, /forbidden/)
    assert.equal(JSON.parse((await bash(sb, 'npm install left-pad', 'default')).stdout).hookSpecificOutput.permissionDecision, 'ask', `${label}: default mode unaffected`)
  }
})

test('hook crashes, missing contracts, missing engines and malformed events fail closed under bypass', async () => {
  const s1 = sandbox('feat/crash').sb
  rmSync(path.join(s1, 'docs/developer-harness-v2/contract.json'))
  blocked(await bash(s1, 'git status'), 'missing contract', /contract/)
  const s2 = sandbox('feat/crash').sb
  writeFileSync(path.join(s2, 'scripts/developer-harness-v2/policy-engine.mjs'), 'throw new Error("broken engine")\n')
  blocked(await bash(s2, 'git status'), 'broken engine', /engine\.load_failed/)
  const s3 = sandbox('feat/crash').sb
  writeFileSync(path.join(s3, 'scripts/developer-harness-v2/bypass-authorization.mjs'), 'throw new Error("broken authorizer")\n')
  blocked(await bash(s3, 'npm install left-pad'), 'broken authorizer module', /engine\.load_failed/)
  const s4 = sandbox('feat/crash').sb
  blocked(await hook(s4, null, null, 'bypassPermissions', '{ not json'), 'malformed JSON', /invalid_json/)
  blocked(await hook(s4, 'Bash', {}, 'bypassPermissions'), 'missing command', /bypass_denied|forbidden/)
  // the launcher's own crash path: a policy hook that throws is reported as a denial (exit 2) by main()
  const s5 = sandbox('feat/crash').sb
  writeFileSync(path.join(s5, '.claude/hooks/policy-hook.mjs'), 'export async function main() { throw new Error("simulated crash") }\n')
  const r = spawnSync(process.execPath, [path.join(s5, '.claude/hooks/local-hook.mjs'), 'policy'], { input: '{}', env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: s5 }, encoding: 'utf8', timeout: 20_000 })
  assert.notEqual(r.status, 0, 'a crashing hook process exits non-zero; settings onFailure:"block" turns that into a block')
  const settings = JSON.parse(readFileSync(path.join(REPO, '.claude/settings.json'), 'utf8'))
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].onFailure, 'block')
})

/** git in a sandbox with a fixed identity and no CRLF conversion. */
const gitIn = (dir) => (...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim() }

test('pin tool: --print and --check are read-only; --write (owner-only) needs --from-ref and pins exactly that commit; digests normalize CRLF only', () => {
  const { sb, put } = sandbox(SCOPE_BRANCH)
  const git = gitIn(sb)
  const file = path.join(sb, 'docs/developer-harness-v2/bypass-scopes.json')
  const tool = (...args) => spawnSync(process.execPath, [path.join(sb, 'scripts/developer-harness-v2/bypass-pins.mjs'), ...args], { cwd: sb, encoding: 'utf8', timeout: 30_000 })
  const before = readFileSync(file, 'utf8')
  assert.equal(tool('--check').status, 0)
  put('scripts/developer-harness-v3/runtime/vm.mjs', 'export const vm = 3\n')
  const check = tool('--check')
  assert.equal(check.status, 1)
  assert.match(check.stdout, /runtime\/vm\.mjs/)
  assert.equal(tool('--print').status, 0)
  assert.equal(readFileSync(file, 'utf8'), before, '--print/--check never write')
  // a working tree is never recorded as reviewed provenance
  const noRef = tool('--write')
  assert.equal(noRef.status, 2); assert.match(noRef.stderr, /--write requires --from-ref/); assert.equal(readFileSync(file, 'utf8'), before, 'nothing written')
  git('add', '-A'); git('commit', '-q', '-m', 'reviewed privileged change')
  const sha = git('rev-parse', 'HEAD')
  for (const bad of ['HEAD', 'working tree', 'f'.repeat(40), '--all', sha.slice(0, 12), sha.slice(0, 39), `${sha}0`]) {
    const r = tool('--write', '--from-ref', bad); assert.equal(r.status, 2, bad); assert.equal(readFileSync(file, 'utf8'), before, `nothing written for ${bad}`)
  }
  // pins come from the commit, not the working tree: a later uncommitted edit is not pinned (and the tool says so)
  put('scripts/developer-harness-v3/runtime/vm.mjs', 'export const vm = 4\n')
  const w = tool('--write', '--from-ref', sha.toUpperCase())
  assert.equal(w.status, 0, w.stderr); assert.match(w.stderr, /differs from [0-9a-f]{40} in 1 file/)
  const e = JSON.parse(readFileSync(file, 'utf8')).scopes[0].trusted_executions[0]
  assert.equal(e.reviewed_source.ref, sha, 'the full sha is recorded'); assert.match(e.reviewed_source.pinned_at, /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(e.digests, digestRef(sb, sha, CLOSURE))
  assert.equal(tool('--check').status, 1, 'the uncommitted edit still differs from the pins')
  assert.equal(tool('--verify-provenance').status, 0)
  put('scripts/developer-harness-v3/runtime/vm.mjs', 'export const vm = 3\n')
  assert.equal(tool('--check').status, 0, 'after an owner refresh the committed code matches the pins')
  assert.equal(contentDigest(Buffer.from('a\r\nb\n')), contentDigest(Buffer.from('a\nb\n')))
  assert.notEqual(contentDigest(Buffer.from('a\rb\n')), contentDigest(Buffer.from('a\nb\n')), 'only CRLF pairs are normalized')
})

test('pin provenance: only a full, resolvable commit whose closure has exactly the pinned digests verifies; everything else fails closed', () => {
  const { sb, put } = sandbox(SCOPE_BRANCH)
  const git = gitIn(sb)
  git('add', '-A'); git('commit', '-q', '-m', 'reviewed')
  const sha = git('rev-parse', 'HEAD')
  const exec = (o = {}) => ({ closure: CLOSURE, digests: digestTree(sb, CLOSURE), reviewed_source: { ref: sha }, ...o })
  assert.deepEqual(verifyPinProvenance(sb, exec()), { ok: true, problems: [], commit: sha, files: 3 })
  assert.equal(resolveCommit(sb, sha.toUpperCase()), sha)
  for (const bad of ['HEAD', 'working tree', '', '--all', `${sha}^`, null, sha.slice(0, 10), git('rev-parse', 'HEAD^{tree}')]) assert.throws(() => resolveCommit(sb, bad), /--from-ref/, String(bad))
  // labels, abbreviations, refs and malformed values are not provenance
  for (const ref of ['working tree', '', null, undefined, 42, sha.slice(0, 12), sha.toUpperCase(), `${sha}\n`, ` ${sha}`, 'HEAD', SCOPE_BRANCH, 'g'.repeat(40)]) {
    assert.deepEqual(verifyPinProvenance(sb, exec({ reviewed_source: { ref } })).problems, ['PIN_REF_NOT_A_COMMIT'], String(ref))
  }
  assert.deepEqual(verifyPinProvenance(sb, exec({ reviewed_source: undefined })).problems, ['PIN_REF_NOT_A_COMMIT'])
  assert.deepEqual(verifyPinProvenance(sb, exec({ digests: {} })).problems, ['PIN_DIGESTS_EMPTY'])
  // well-formed but not a commit here: unknown object, a tree, a blob (a full clone never fetches)
  const tree = git('rev-parse', 'HEAD^{tree}'); const blob = git('rev-parse', 'HEAD:scripts/developer-harness-v3/bin/dh3.mjs')
  for (const ref of ['0123456789abcdef0123456789abcdef01234567', tree, blob]) {
    assert.deepEqual(verifyPinProvenance(sb, exec({ reviewed_source: { ref } }), { fetchIfShallow: true }).problems, ['PIN_REF_UNRESOLVABLE'], ref)
  }
  // mismatched digests: changed, an extra pinned path, a missing pinned path
  const pinned = digestTree(sb, CLOSURE)
  assert.deepEqual(verifyPinProvenance(sb, exec({ digests: { ...pinned, 'scripts/developer-harness-v3/bin/dh3.mjs': 'a'.repeat(64) } })).problems, ['PIN_DIGEST_MISMATCH:scripts/developer-harness-v3/bin/dh3.mjs:changed'])
  assert.deepEqual(verifyPinProvenance(sb, exec({ digests: { ...pinned, 'scripts/developer-harness-v3/runtime/gone.mjs': 'b'.repeat(64) } })).problems, ['PIN_DIGEST_MISMATCH:scripts/developer-harness-v3/runtime/gone.mjs:removed'])
  const { 'scripts/developer-harness-v3/runtime/vm.mjs': _vm, ...fewer } = pinned
  assert.deepEqual(verifyPinProvenance(sb, exec({ digests: fewer })).problems, ['PIN_DIGEST_MISMATCH:scripts/developer-harness-v3/runtime/vm.mjs:added'])
  // pins that describe a later working tree, not the named commit
  put('scripts/developer-harness-v3/runtime/vm.mjs', 'export const vm = 9\n')
  assert.deepEqual(verifyPinProvenance(sb, exec()).problems, ['PIN_DIGEST_MISMATCH:scripts/developer-harness-v3/runtime/vm.mjs:changed'])
  // a commit whose closure holds a symlink (or submodule) entry is unverifiable, as in the working-tree digest
  const target = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: sb, input: '../bin/dh3.mjs', encoding: 'utf8' }).stdout.trim()
  git('update-index', '--add', '--cacheinfo', `120000,${target},scripts/developer-harness-v3/runtime/link.mjs`); git('commit', '-q', '-m', 'symlink')
  const linked = git('rev-parse', 'HEAD')
  assert.match(verifyPinProvenance(sb, exec({ reviewed_source: { ref: linked } })).problems[0], /^PIN_REF_UNVERIFIABLE:closure entry scripts\/developer-harness-v3\/runtime\/link\.mjs is not a regular file/)
})

test('review B1: a hex-named branch can never redirect a pin to code the owner did not review', () => {
  const { sb, put } = sandbox(SCOPE_BRANCH)
  const git = gitIn(sb)
  const file = path.join(sb, 'docs/developer-harness-v2/bypass-scopes.json')
  const tool = (...args) => spawnSync(process.execPath, [path.join(sb, 'scripts/developer-harness-v2/bypass-pins.mjs'), ...args], { cwd: sb, encoding: 'utf8', timeout: 30_000 })
  git('add', '-A'); git('commit', '-q', '-m', 'reviewed X')
  const x = git('rev-parse', 'HEAD'); const xDigests = digestRef(sb, x, CLOSURE)
  put('scripts/developer-harness-v3/runtime/vm.mjs', 'export const vm = "unreviewed"\n'); git('add', '-A'); git('commit', '-q', '-m', 'unreviewed Y')
  const y = git('rev-parse', 'HEAD')
  git('branch', x.slice(0, 12), y) // an agent-created branch named after the reviewed commit's abbreviation, pointing at Y
  assert.equal(git('rev-parse', x.slice(0, 12)), y, 'the hazard is real: git resolves the abbreviation to the branch')
  const before = readFileSync(file, 'utf8')
  const short = tool('--write', '--from-ref', x.slice(0, 12))
  assert.equal(short.status, 2); assert.match(short.stderr, /full 40-hex sha/); assert.equal(readFileSync(file, 'utf8'), before)
  git('branch', x, y) // even a branch named with the FULL sha cannot shadow the object id
  // review N1: a planted replace ref makes plain git read X as Y; the pin tool reads the real objects
  git('replace', x, y)
  assert.equal(git('rev-parse', `${x}^{tree}`), git('rev-parse', `${y}^{tree}`), 'the hazard is real: plain git now reads X as Y')
  assert.deepEqual(digestRef(sb, x, CLOSURE), xDigests, 'replace objects are ignored')
  const full = tool('--write', '--from-ref', x)
  assert.equal(full.status, 0, full.stderr)
  const e = JSON.parse(readFileSync(file, 'utf8')).scopes[0].trusted_executions[0]
  assert.equal(e.reviewed_source.ref, x); assert.deepEqual(e.digests, xDigests, 'X is pinned, never Y')
  assert.notDeepEqual(e.digests, digestRef(sb, y, CLOSURE))
})

test('git is run from an absolute PATH entry outside the repository (a planted git.exe in the checkout never runs as the owner)', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dh2-gitroot-')); const outside = mkdtempSync(path.join(os.tmpdir(), 'dh2-gitbin-')); sandboxes.push(root, outside)
  mkdirSync(path.join(root, 'bin')); writeFileSync(path.join(root, 'git.exe'), ''); writeFileSync(path.join(root, 'bin', 'git.exe'), ''); writeFileSync(path.join(outside, 'git.exe'), '')
  assert.equal(gitExecutable(root, { PATH: `.;bin;${path.join(root, 'bin')};"${outside}"` }, 'win32'), path.join(outside, 'git.exe'))
  assert.throws(() => gitExecutable(root, { PATH: `.;${root};${path.join(root, 'bin')}` }, 'win32'), /git\.exe not found/)
  assert.equal(gitExecutable(root, { PATH: '' }, 'linux'), 'git')
})

test('pin provenance in a shallow CI-style clone: exactly the pinned commit is fetched on request; a failed fetch fails closed', () => {
  const { sb, put } = sandbox(SCOPE_BRANCH)
  const git = gitIn(sb)
  git('add', '-A'); git('commit', '-q', '-m', 'reviewed')
  const reviewed = git('rev-parse', 'HEAD'); const pins = digestTree(sb, CLOSURE)
  put('apps/later.txt', 'later\n'); git('add', '-A'); git('commit', '-q', '-m', 'later, outside the closure')
  git('config', 'uploadpack.allowReachableSHA1InWant', 'true') // as GitHub serves any reachable commit by sha
  const shallow = mkdtempSync(path.join(os.tmpdir(), 'dh2-shallow-')); sandboxes.push(shallow)
  gitIn(os.tmpdir())('clone', '-q', '--depth=1', '--no-single-branch', pathToFileURL(sb).href, shallow)
  assert.equal(gitIn(shallow)('rev-parse', '--is-shallow-repository'), 'true')
  const exec = { closure: CLOSURE, digests: pins, reviewed_source: { ref: reviewed } }
  assert.deepEqual(verifyPinProvenance(shallow, exec).problems, ['PIN_REF_UNRESOLVABLE'], 'nothing is fetched unless asked')
  assert.deepEqual(verifyPinProvenance(shallow, exec, { remote: 'no-such-remote', fetchIfShallow: true }).problems, ['PIN_REF_UNRESOLVABLE'], 'a failed fetch fails closed')
  assert.deepEqual(verifyPinProvenance(shallow, exec, { remote: '--upload-pack=x', fetchIfShallow: true }).problems, ['PIN_REF_UNRESOLVABLE'], 'a remote name cannot be an option')
  assert.deepEqual(verifyPinProvenance(shallow, exec, { fetchIfShallow: true }), { ok: true, problems: [], commit: reviewed, files: 3 })
  // the fetched commit is still verified by content: wrong pins fail even after a successful fetch
  assert.deepEqual(verifyPinProvenance(shallow, { ...exec, digests: { ...pins, 'scripts/developer-harness-v3/bin/dh3.mjs': 'c'.repeat(64) } }, { fetchIfShallow: true }).problems,
    ['PIN_DIGEST_MISMATCH:scripts/developer-harness-v3/bin/dh3.mjs:changed'])
})

test('shipped pins: every trusted execution names a commit that resolves in this checkout and whose closure has exactly the pinned digests', () => {
  // In CI (actions/checkout, depth 1) the pinned PR commit is not part of the checkout; it is fetched by sha from origin, which keeps PR
  // commits reachable after a squash merge. A local full clone needs no fetch. This replaces any hard-coded sha in the tests: a legitimate
  // owner re-pin (`--write --from-ref <sha>`) passes without a test edit, and a label, an unknown commit or a digest mismatch fails.
  const doc = JSON.parse(readFileSync(path.join(REPO, 'docs/developer-harness-v2/bypass-scopes.json'), 'utf8'))
  const execs = doc.scopes.flatMap((s) => s.trusted_executions.map((e) => [s.id, e]))
  assert.ok(execs.length > 0)
  for (const [scope, e] of execs) {
    const r = verifyPinProvenance(REPO, e, { fetchIfShallow: true })
    assert.deepEqual(r.problems, [], `${scope}/${e.id} pinned at ${e.reviewed_source?.ref}`)
    assert.equal(r.commit, e.reviewed_source.ref); assert.equal(r.files, Object.keys(e.digests).length)
  }
})

test('the shipped settings and scopes keep the owner launch explicit and the D3.3 privileged commands owner-bounded', () => {
  const settings = JSON.parse(readFileSync(path.join(REPO, '.claude/settings.json'), 'utf8'))
  assert.equal(settings.permissions.disableBypassPermissionsMode, undefined, 'bypass can be launched')
  assert.equal(settings.permissions.defaultMode, undefined, 'but is never the default')
  assert.ok(settings.permissions.deny.includes('Bash(git push origin main*)') && settings.permissions.deny.includes('Read(**/.env)'), 'deny backstops kept (they apply in bypass too)')
  const scopes = JSON.parse(readFileSync(path.join(REPO, 'docs/developer-harness-v2/bypass-scopes.json'), 'utf8'))
  const cli = scopes.scopes[0].trusted_executions[0]
  assert.deepEqual(cli.subcommands, ['doctor', 'setup', 'provision', 'start', 'stop', 'status', 'reset', 'monitor', 'verify-isolation', 'auth-check'])
})

test('commit secret scan: exactly the content the commit adds (diff vs HEAD), packed or loose, UTF-8 or UTF-16', async () => {
  const { sb, put } = sandbox('feat/commit-scan')
  const git = (...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: sb, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r }
  const SECRET = 'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abc\n'
  put('apps/a.txt', 'hello\n')
  for (let i = 0; i < 40; i++) put(`apps/many/file-${i}-${'x'.repeat(i)}.txt`, `n${i}\n`) // varied path lengths exercise index padding
  git('add', 'apps')
  proceed(await bash(sb, 'git commit -m "feat: clean"'), 'clean staged content (initial commit, no HEAD yet)')
  git('commit', '-q', '-m', 'init')
  // a fake secret already in history (test fixtures) never blocks later unrelated commits
  put('apps/fixture.test.mjs', "const k = 'sk_test_51HabcdefghijklmnopQRST'\n")
  git('add', 'apps/fixture.test.mjs'); git('commit', '-q', '-m', 'fixture')
  put('apps/b.txt', 'unrelated\n'); git('add', 'apps/b.txt')
  proceed(await bash(sb, 'git commit -m "feat: unrelated"'), 'committed fixture does not block')
  // newly staged secret: loose, then packed by gc
  put('apps/notes.txt', SECRET); git('add', 'apps/notes.txt')
  blocked(await bash(sb, 'git commit -m "feat: notes"'), 'staged credential (loose)', /apps\/notes\.txt.*\[bypass\.commit_secret\]/)
  git('gc', '-q')
  blocked(await bash(sb, 'git commit -m "feat: notes"'), 'staged credential (packed after gc)', /apps\/notes\.txt.*\[bypass\.commit_secret\]/)
  git('rm', '--cached', '-q', 'apps/notes.txt')
  proceed(await bash(sb, 'git commit -m "feat: clean again"'), 'after unstaging')
  // UTF-16LE as written by Windows PowerShell 5.1 `>` (BOM) and without a BOM
  writeFileSync(path.join(sb, 'apps/ps.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SECRET, 'utf16le')])); git('add', 'apps/ps.txt')
  blocked(await bash(sb, 'git commit -m "feat: ps"'), 'UTF-16LE with BOM', /\[bypass\.commit_secret\]/)
  git('rm', '--cached', '-q', 'apps/ps.txt')
  writeFileSync(path.join(sb, 'apps/ps2.txt'), Buffer.from(SECRET.repeat(3), 'utf16le')); git('add', 'apps/ps2.txt')
  blocked(await bash(sb, 'git commit -m "feat: ps2"'), 'UTF-16LE without BOM', /\[bypass\.commit_secret\]/)
  git('rm', '--cached', '-q', 'apps/ps2.txt')
  // index version 4
  git('update-index', '--index-version', '4')
  git('add', 'apps/notes.txt')
  blocked(await bash(sb, 'git commit -m "feat: notes"'), 'index v4', /\[bypass\.commit_secret\]/)
})
