// Developer Harness V2 — permission transition: hook-level tests in disposable sandbox repositories.
// Real hook process / real filesystem digests / real .git branch state; synthetic files only. Never runs a protected command, never
// touches the real DH3 infrastructure root, never reads a credential. Run: node --test scripts/developer-harness-v2/bypass-hook.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { contentDigest, digestTree } from './bypass-digest.mjs'

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

test('pin tool: --print and --check are read-only; --write (owner-only) refreshes pins; digests normalize CRLF only', () => {
  const { sb, put } = sandbox(SCOPE_BRANCH)
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
  assert.equal(tool('--write').status, 0)
  assert.notEqual(readFileSync(file, 'utf8'), before)
  assert.equal(tool('--check').status, 0, 'after an owner refresh the pins match')
  assert.equal(contentDigest(Buffer.from('a\r\nb\n')), contentDigest(Buffer.from('a\nb\n')))
  assert.notEqual(contentDigest(Buffer.from('a\rb\n')), contentDigest(Buffer.from('a\nb\n')), 'only CRLF pairs are normalized')
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

test('commit secret scan reads the real index and newly staged loose blobs', async () => {
  const { sb, put } = sandbox('feat/commit-scan')
  const git = (...a) => { const r = spawnSync('git', a, { cwd: sb, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r }
  put('apps/a.txt', 'hello\n')
  for (let i = 0; i < 40; i++) put(`apps/many/file-${i}-${'x'.repeat(i)}.txt`, `n${i}\n`) // varied path lengths exercise index padding
  git('add', 'apps')
  proceed(await bash(sb, 'git commit -m "feat: clean"'), 'clean staged content')
  put('apps/notes.txt', 'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abc\n')
  git('add', 'apps/notes.txt')
  blocked(await bash(sb, 'git commit -m "feat: notes"'), 'staged credential', /apps\/notes\.txt.*\[bypass\.commit_secret\]/)
  git('rm', '--cached', '-q', 'apps/notes.txt')
  proceed(await bash(sb, 'git commit -m "feat: clean again"'), 'after unstaging')
  git('-c', 'index.version=4', 'update-index', '--index-version', '4')
  git('add', 'apps/notes.txt')
  blocked(await bash(sb, 'git commit -m "feat: notes"'), 'index v4', /\[bypass\.commit_secret\]/)
})
