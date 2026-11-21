// Developer Harness V2 — Phase 2 hook integration tests.
// Feeds simulated Claude Code PreToolUse JSON into the real hook process and checks exit codes / stdout / stderr.
// Uses sanitized environments, fixture inputs and throwaway temp copies. Never runs a protected command, never
// starts a dev server, never reads a real credential file.
// Run: node --test scripts/developer-harness-v2/policy-hook.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')
const settings = JSON.parse(read('.claude/settings.json'))

/** Minimal environment: no CI flags, no credentials from the parent process. */
function sanitizedEnv(extra = {}) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', TEMP: os.tmpdir(), TMP: os.tmpdir(), HOME: os.tmpdir(), USERPROFILE: os.tmpdir() }
  return { ...env, ...extra }
}

function runHook(event, { root = REPO, env = sanitizedEnv(), raw } = {}) {
  const r = spawnSync(process.execPath, [path.join(root, '.claude/hooks/local-hook.mjs'), 'policy'], {
    input: raw ?? JSON.stringify(event), env: { ...env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', timeout: 20_000, cwd: root,
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

const ev = (tool, toolInput, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: 't', cwd: REPO, permission_mode: 'default', tool_name: tool, tool_input: toolInput, ...extra })
const bash = (command, extra) => ev('Bash', { command }, extra)

test('allowed action: exit 0 and no output (normal permission flow continues)', () => {
  for (const event of [bash('git status'), ev('Read', { file_path: path.join(REPO, 'package.json') }), ev('PowerShell', { command: 'Get-ChildItem docs' })]) {
    const r = runHook(event)
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, '')
  }
})

test('approval-gated action: exit 0 with a documented "ask" decision', () => {
  const r = runHook(bash('npm install left-pad'))
  assert.equal(r.code, 0)
  const out = JSON.parse(r.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /human_approval/)
})

test('approval-gated action under bypassPermissions is blocked with exit 2', () => {
  const r = runHook(bash('npm install left-pad', { permission_mode: 'bypassPermissions' }))
  assert.equal(r.code, 2)
  assert.match(r.stderr, /cannot be mediated in bypassPermissions mode/)
})

test('forbidden actions: exit 2, reason on stderr, nothing on stdout, no secret echo', () => {
  const cases = [
    [bash('git push origin main'), /git\.push_protected/],
    [bash('echo ok && gh pr merge 247'), /gh\.pr_merge/],
    [bash('node -e "require(\'child_process\').execSync(\'supabase db push\')"'), /signature\.supabase_remote/],
    [ev('PowerShell', { command: 'pwsh -Command "git push --force"' }), /git\.push_force/],
    [ev('Read', { file_path: path.join(REPO, 'apps/api/.env') }), /path\.read_credential/],
    [ev('Edit', { file_path: path.join(REPO, 'supabase/migrations/262_agent_verified_human_identity.sql'), old_string: 'a', new_string: 'b' }), /path\.existing_migration/],
    [bash('echo TOKEN=sk_live_SHOULD_NOT_APPEAR >> apps/api/.env && cat apps/api/.env'), /credential/],
  ]
  for (const [event, re] of cases) {
    const r = runHook(event)
    assert.equal(r.code, 2, JSON.stringify(event).slice(0, 100))
    assert.equal(r.stdout, '')
    assert.match(r.stderr, re)
    assert.ok(!r.stderr.includes('sk_live_SHOULD_NOT_APPEAR'))
  }
})

test('malformed input fails closed with exit 2', () => {
  for (const raw of ['', 'not json', '{', '[]', 'null', '{"hook_event_name":"PreToolUse"}', JSON.stringify({ ...bash('git status'), cwd: undefined })]) {
    const r = runHook(null, { raw })
    assert.equal(r.code, 2, `input ${raw.slice(0, 40)}`)
    assert.equal(r.stdout, '')
  }
  const tooBig = runHook(null, { raw: JSON.stringify(bash(`echo ${'x'.repeat(6 * 1024 * 1024)}`)) })
  assert.equal(tooBig.code, 2)
})

const RUNNER_ENV = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/tmp/runner', GITHUB_RUN_ID: '1' }

test('the policy hook is inert only on a GitHub Actions runner (compatibility switch, not authorization)', () => {
  const inert = runHook(bash('git push origin main'), { env: sanitizedEnv(RUNNER_ENV) })
  assert.equal(inert.code, 0)
  assert.equal(inert.stdout + inert.stderr, '')
  for (const extra of [{ CI: 'true' }, { CI: '1' }, { CI: 'false' }, { GITHUB_ACTIONS: 'true' }, { GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/tmp' }]) {
    const r = runHook(bash('git push origin main'), { env: sanitizedEnv(extra) })
    assert.equal(r.code, 2, `enforced with ${JSON.stringify(extra)}`)
  }
})

/** Throwaway copy of the hook + engine + contract so failure modes can be simulated without touching the repo. */
function sandbox(mutate) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dev harness policy '))
  for (const rel of ['.claude/hooks', 'scripts/developer-harness-v2', 'docs/developer-harness-v2']) {
    mkdirSync(path.join(dir, rel), { recursive: true })
    cpSync(path.join(REPO, rel), path.join(dir, rel), { recursive: true })
  }
  mutate?.(dir)
  return dir
}

test('missing, corrupt or weakened contract fails closed', () => {
  const contractPath = (d) => path.join(d, 'docs/developer-harness-v2/contract.json')
  const mutations = {
    missing: (d) => rmSync(contractPath(d)),
    corrupt: (d) => writeFileSync(contractPath(d), '{ not json'),
    weakened: (d) => {
      const c = JSON.parse(readFileSync(contractPath(d), 'utf8'))
      c.actions.push_to_protected_main = 'allowed'
      writeFileSync(contractPath(d), JSON.stringify(c))
    },
    'protected path removed': (d) => {
      const c = JSON.parse(readFileSync(contractPath(d), 'utf8'))
      c.protected_paths = c.protected_paths.filter((p) => p !== 'supabase/migrations/**')
      writeFileSync(contractPath(d), JSON.stringify(c))
    },
  }
  for (const [name, mutate] of Object.entries(mutations)) {
    const dir = sandbox(mutate)
    try {
      const r = runHook({ ...bash('git status'), cwd: dir }, { root: dir })
      assert.equal(r.code, 2, `${name}: ${r.stderr}`)
      assert.match(r.stderr, /contract/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})

test('missing or broken policy engine fails closed', () => {
  for (const [name, mutate] of Object.entries({
    'engine deleted': (d) => rmSync(path.join(d, 'scripts/developer-harness-v2/policy-engine.mjs')),
    'engine syntax error': (d) => writeFileSync(path.join(d, 'scripts/developer-harness-v2/command-policy.mjs'), 'export const = ;'),
  })) {
    const dir = sandbox(mutate)
    try {
      const r = runHook({ ...bash('git status'), cwd: dir }, { root: dir })
      assert.equal(r.code, 2, `${name}: ${r.stderr}`)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})

test('hook works from a Windows-style path containing spaces', () => {
  const dir = sandbox()
  try {
    assert.ok(dir.includes(' '))
    assert.equal(runHook({ ...bash('git status'), cwd: dir }, { root: dir }).code, 0)
    assert.equal(runHook({ ...bash('git push origin main'), cwd: dir }, { root: dir }).code, 2)
    assert.equal(runHook({ ...bash('cat apps\\\\api\\\\.env'), cwd: dir.replace(/\//g, '\\') }, { root: dir }).code, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('settings: the blocking policy hook covers shell, read and edit tools and fails closed', () => {
  const pre = settings.hooks.PreToolUse
  const policyEntries = pre.filter((e) => e.hooks.some((h) => /local-hook\.mjs" policy$/.test(h.command)))
  assert.equal(policyEntries.length, 1)
  assert.equal(pre[0], policyEntries[0], 'policy hook is the first PreToolUse entry')
  assert.equal(policyEntries[0].matcher, '*', 'every tool (incl. Monitor, WebFetch, MCP) reaches the policy; the engine allowlists harmless tools')
  for (const e of policyEntries) {
    for (const h of e.hooks) {
      assert.equal(h.type, 'command')
      assert.equal(h.onFailure, 'block', 'crash/timeout must block (requires Claude Code >= 2.1.295)')
      assert.ok(h.timeout > 0 && h.timeout <= 10)
      assert.ok(!h.async, 'enforcement hook must not be async')
    }
  }
  // OpenWolf advisory hooks are kept, separately, after the policy hook.
  assert.ok(pre.some((e) => e.hooks.some((h) => /wolf pre-read/.test(h.command))))
  assert.ok(pre.some((e) => e.hooks.some((h) => /wolf pre-write/.test(h.command))))
})

test('settings: bypass mode is disabled and broad automatic allowances are gone', () => {
  const { permissions } = settings
  assert.equal(permissions.disableBypassPermissionsMode, 'disable')
  const banned = ['Bash(npx supabase*)', 'Bash(eas update*)', 'Bash(eas build*)', 'Bash(cd apps/mobile && eas*)', 'Bash(npm install*)', 'Bash(npm ci)',
    'Bash(cd apps/api && python*)', 'Bash(cd apps/api && pip*)', 'Bash(git push)', 'Bash(git stash*)', 'Bash(node .wolf/hooks/*)', 'Bash(npm run dev:*)',
    'Bash(railway logs*)', 'Bash(railway status)', 'Bash(cd apps/mobile && npm*)', 'Bash(git branch*)', 'Bash(npx playwright test*)', 'Bash(npm run build*)']
  for (const rule of banned) assert.ok(!permissions.allow.includes(rule), `${rule} removed`)
  for (const rule of permissions.allow) {
    assert.doesNotMatch(rule, /supabase|railway|vercel|\beas\b|publish|push|merge|workflow|install|\bpip\b|stash|\.wolf|dev:/i, `allow rule ${rule} is narrow`)
    assert.doesNotMatch(rule, /^Bash\(\*|^Bash\)$|^Bash$|^Read\(\*\*\)|^Edit/, `allow rule ${rule} is not a wildcard`)
  }
})

/** Approximation of Claude Code's Bash rule matching (`*` matches anything, `:*` suffix). Used only as a cross-check. */
const ruleMatches = (rule, command) => {
  const m = /^(Bash|PowerShell)\((.*)\)$/.exec(rule)
  if (!m) return false
  const pattern = m[2].replace(/:\*$/, ' *')
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return re.test(command)
}

test('settings: no allow rule silently pre-approves a protected command; deny rules back up the hook', () => {
  const protectedCommands = ['git push origin main', 'git push --force', 'git push -f origin x', 'git commit --no-verify -m x', 'git commit -m x --no-verify',
    'gh pr merge 1', 'gh workflow run x', 'npx supabase db push', 'supabase migration repair 1', 'railway up', 'vercel --prod', 'eas update --branch production', 'npm publish']
  for (const cmd of protectedCommands) {
    const allowed = settings.permissions.allow.filter((r) => ruleMatches(r, cmd))
    const denied = settings.permissions.deny.filter((r) => ruleMatches(r, cmd))
    assert.ok(denied.length > 0, `${cmd} has a backstop deny rule`)
    assert.ok(allowed.length === 0 || denied.length > 0, `${cmd} is not silently pre-approved`)
  }
  for (const secret of ['Read(**/.env)', 'Read(**/.env.local)', 'Read(**/.env.production)', 'Read(~/.ssh/**)', 'Read(~/.claude/.credentials.json)']) {
    assert.ok(settings.permissions.deny.includes(secret), secret)
  }
  assert.ok(!settings.permissions.deny.some((r) => /\.env\.\*\)|\.env\*\)/.test(r)), 'deny rules do not block .env.example templates')
})

test('session start no longer launches dev servers (static proof)', () => {
  const hookSrc = read('.claude/hooks/local-hook.mjs').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  for (const banned of ['dev:web', 'dev:api', 'startDevServers', 'portInUse', '8000', "'node:net'", 'detached']) {
    assert.ok(!hookSrc.includes(banned), `local-hook.mjs no longer contains ${banned}`)
  }
  const sessionCommands = settings.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command))
  assert.ok(sessionCommands.length >= 1, 'OpenWolf session-start hook is preserved')
  for (const c of sessionCommands) assert.doesNotMatch(c, /dev-servers|npm run dev/)
  assert.doesNotMatch(JSON.stringify(settings.hooks), /dev-servers|npm run dev:/)
  const pkg = JSON.parse(read('package.json'))
  assert.ok(pkg.scripts['dev:web'] && pkg.scripts['dev:api'], 'manual dev scripts remain available')
})

test('session start no longer launches dev servers (runtime proof with an npm shim)', () => {
  const shimDir = mkdtempSync(path.join(os.tmpdir(), 'npm-shim-'))
  const marker = path.join(shimDir, 'npm-was-invoked')
  const script = `require('fs').writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '))`
  writeFileSync(path.join(shimDir, 'npm-shim.js'), script)
  writeFileSync(path.join(shimDir, 'npm.cmd'), `@"${process.execPath}" "%~dp0npm-shim.js" %*\r\n`)
  writeFileSync(path.join(shimDir, 'npm'), `#!/bin/sh\n"${process.execPath.replace(/\\/g, '/')}" "$(dirname "$0")/npm-shim.js" "$@"\n`, { mode: 0o755 })
  const emptyRoot = mkdtempSync(path.join(os.tmpdir(), 'no-wolf-'))
  try {
    for (const kind of [['dev-servers'], []]) {
      const r = spawnSync(process.execPath, [path.join(REPO, '.claude/hooks/local-hook.mjs'), ...kind], {
        env: { PATH: `${shimDir}${path.delimiter}${process.env.PATH}`, SystemRoot: process.env.SystemRoot ?? '', CLAUDE_PROJECT_DIR: emptyRoot },
        encoding: 'utf8', timeout: 10_000,
      })
      assert.equal(r.status, 0)
      assert.equal(r.stdout + r.stderr, '')
    }
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 1500)'])
    assert.ok(!existsSync(marker), 'npm was never invoked by the session hook launcher')
  } finally {
    rmSync(shimDir, { recursive: true, force: true })
    rmSync(emptyRoot, { recursive: true, force: true })
  }
})

test('every settings hook command is syntactically valid for the launcher and inert under CI', () => {
  const commands = JSON.stringify(settings.hooks).match(/"command":"(?:[^"\\]|\\.)*"/g).map((c) => JSON.parse(c.slice(10)))
  for (const command of commands) {
    const m = /^node "\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/local-hook\.mjs" (.+)$/.exec(command)
    assert.ok(m, command)
    const r = spawnSync(process.execPath, [path.join(REPO, '.claude/hooks/local-hook.mjs'), ...m[1].split(' ')], {
      env: sanitizedEnv(RUNNER_ENV), input: JSON.stringify(bash('git push origin main')), encoding: 'utf8', timeout: 10_000,
    })
    assert.equal(r.status, 0, command)
    assert.equal(r.stdout + r.stderr, '')
  }
})
