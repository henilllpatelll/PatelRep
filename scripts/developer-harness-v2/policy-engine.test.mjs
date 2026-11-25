// Developer Harness V2 — Phase 2 policy engine unit tests. Pure: no credentials, no network, nothing executed.
// Run: node --test scripts/developer-harness-v2/policy-engine.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ACTION_FLOOR, evaluateToolEvent, loadContract, validateContract, CLASSES } from './policy-engine.mjs'
import { parseShell } from './shell-recognizer.mjs'
import { isSensitivePath } from './path-policy.mjs'
import { FIXTURES, ROOT, EXISTING_FILES, PACKAGE_SCRIPTS } from './policy-fixtures.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const CONTRACT = loadContract(path.join(REPO, 'docs/developer-harness-v2/contract.json'))
const DEFAULT_GIT = { branch: 'feat/x', upstreamBranch: 'feat/x', hasUpstream: true }

function ctxFor({ git = DEFAULT_GIT, contract = CONTRACT } = {}) {
  return {
    contract,
    projectRoot: ROOT,
    homeDir: 'C:/Users/dev',
    tempRoots: ['C:/Users/dev/AppData/Local/Temp', '/tmp'],
    platform: 'win32',
    pathExists: (p) => EXISTING_FILES.has(String(p).toLowerCase()),
    readPackageScripts: (dir) => {
      const key = String(dir).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
      return Object.entries(PACKAGE_SCRIPTS).find(([k]) => k.toLowerCase() === key)?.[1] ?? null
    },
    resolveWorkspace: () => null,
    gitState: () => git,
  }
}

function eventFor(fx, mode = fx.mode ?? 'default') {
  const abs = (p) => (/^[A-Za-z]:\//.test(p) ? p : `${ROOT}/${p}`)
  let toolInput
  if (fx.tool === 'Bash' || fx.tool === 'PowerShell') toolInput = { command: fx.input, description: 'fixture' }
  else if (fx.tool === 'Read') toolInput = { file_path: abs(fx.input) }
  else if (fx.tool === 'Grep') toolInput = { pattern: 'x', path: abs(fx.input) }
  else if (fx.tool === 'Edit') toolInput = { file_path: abs(fx.input), old_string: 'a', new_string: fx.content ?? 'b' }
  else if (fx.tool === 'Monitor') toolInput = { command: fx.input }
  else if (fx.tool === 'WebFetch') toolInput = { url: fx.input, prompt: 'x' }
  else if (fx.tool === 'Glob') toolInput = { pattern: fx.input }
  else if (/^mcp__/.test(fx.tool)) toolInput = fx.mcpInput ?? { anything: fx.input }
  else toolInput = { file_path: abs(fx.input), content: fx.content ?? 'x' }
  return { hook_event_name: 'PreToolUse', session_id: 's', cwd: ROOT, permission_mode: mode, tool_name: fx.tool, tool_input: toolInput, tool_use_id: 't' }
}

const evaluate = (fx, mode) => evaluateToolEvent(eventFor(fx, mode), ctxFor({ git: fx.git }))

for (const fx of FIXTURES) {
  test(`[${fx.group}] ${fx.id}: ${fx.tool} ${JSON.stringify(fx.input).slice(0, 70)} → ${fx.expect}`, () => {
    const r = evaluate(fx)
    assert.equal(r.classification, fx.expect, `${fx.id}: got ${r.classification} via ${r.action} [${r.reasonCode}] ${fx.note ?? ''}`)
  })
}

test('every required doc-06 negative group for Phase 2 has fixtures', () => {
  for (const g of ['N-1', 'N-2', 'N-3', 'N-4', 'N-5', 'N-6', 'N-8', 'N-11', 'N-12']) {
    assert.ok(FIXTURES.some((f) => f.group === g), `fixtures for ${g}`)
  }
  assert.ok(FIXTURES.filter((f) => f.group === 'FP' || f.group === 'P').length >= 15, 'at least 15 legitimate actions assessed')
})

test('decision mapping: allowed has no objection, approvals ask, forbidden denies', () => {
  const byClass = (cls) => FIXTURES.find((f) => f.expect === cls && f.tool === 'Bash')
  assert.equal(evaluate(byClass('allowed')).decision, 'no_objection')
  assert.equal(evaluate(byClass('task_authorized')).decision, 'ask')
  assert.equal(evaluate(byClass('human_approval')).decision, 'ask')
  assert.equal(evaluate(byClass('forbidden')).decision, 'deny')
})

test('approval-gated actions are denied (not silently allowed) when prompts cannot be shown', () => {
  for (const mode of ['bypassPermissions', 'dontAsk', 'auto']) {
    for (const fx of FIXTURES.filter((f) => f.expect === 'human_approval' || f.expect === 'task_authorized')) {
      const r = evaluate(fx, mode)
      assert.equal(r.decision, 'deny', `${fx.id} in ${mode}`)
      // V2 permission transition: bypassPermissions no longer reports "cannot be mediated"; without an established authorization
      // scope (this ctx loads no scopes file) it denies with the fail-closed reason instead. Same decision, new reason text.
      assert.match(r.reason, mode === 'bypassPermissions' ? /bypass_denied: .*\[bypass\.authorization_unavailable\]/ : /cannot be mediated/)
    }
  }
  for (const mode of ['default', 'acceptEdits', 'plan']) assert.equal(evaluate(FIXTURES.find((f) => f.id === 'P-12'), mode).decision, 'ask')
})

test('forbidden is never downgraded by permission mode, approval text, or extra event fields (N-8)', () => {
  const fx = FIXTURES.find((f) => f.id === 'N1-a')
  for (const mode of ['default', 'acceptEdits', 'auto', 'bypassPermissions', 'plan', 'dontAsk', 'unknown-mode']) assert.equal(evaluate(fx, mode).decision, 'deny')
  const ev = eventFor(fx)
  ev.tool_input = { ...ev.tool_input, approved: true, human_approval: 'granted', classification: 'allowed' }
  ev.approval = { granted: true, by: 'owner' }
  ev.agent_type = 'implementer'
  assert.equal(evaluateToolEvent(ev, ctxFor()).classification, 'forbidden')
})

test('malformed or incomplete events fail closed', () => {
  const good = eventFor(FIXTURES.find((f) => f.id === 'P-01'))
  const variants = [null, [], 'string', {}, { ...good, hook_event_name: 'PostToolUse' }, { ...good, hook_event_name: undefined },
    { ...good, tool_name: '' }, { ...good, tool_input: null }, { ...good, tool_input: [] }, { ...good, cwd: undefined },
    { ...good, tool_input: {} }, { ...good, tool_name: 'Read', tool_input: { file_path: 7 } },
    { ...good, tool_name: 'Write', tool_input: { file_path: `${ROOT}/a.ts` } }]
  for (const ev of variants) {
    const r = evaluateToolEvent(ev, ctxFor())
    assert.equal(r.decision, 'deny', JSON.stringify(ev)?.slice(0, 80))
  }
})

test('unexpected tool types are never silently allowed', () => {
  const ev = { ...eventFor(FIXTURES.find((f) => f.id === 'P-01')), tool_name: 'SomeFutureTool', tool_input: { anything: 1 } }
  assert.notEqual(evaluateToolEvent(ev, ctxFor()).decision, 'no_objection')
  const mcp = (name) => evaluateToolEvent({ ...ev, tool_name: name }, ctxFor()).classification
  assert.equal(mcp('mcp__plugin_supabase_supabase__execute_sql'), 'forbidden')
  assert.equal(mcp('mcp__plugin_supabase_supabase__apply_migration'), 'forbidden')
  assert.equal(mcp('mcp__railway__deploy'), 'forbidden')
  assert.equal(mcp('mcp__github__merge_pull_request'), 'forbidden')
  assert.equal(mcp('mcp__railway__get_logs'), 'human_approval')
})

test('missing, corrupt, weakened or incomplete contracts deny every call', () => {
  const fx = FIXTURES.find((f) => f.id === 'P-01')
  const clone = () => JSON.parse(JSON.stringify(CONTRACT))
  const broken = [
    null, 'text', { ...clone(), version: 2 }, { ...clone(), actions: undefined },
    (() => { const c = clone(); c.actions.push_to_protected_main = 'allowed'; return c })(),
    (() => { const c = clone(); c.actions.install_or_upgrade_dependencies = 'allowed'; return c })(),
    (() => { const c = clone(); delete c.actions.read_production_or_publisher_credentials; return c })(),
    (() => { const c = clone(); c.actions.read_repository = 'sometimes'; return c })(),
    (() => { const c = clone(); c.protected_paths = c.protected_paths.filter((p) => p !== '.github/**'); return c })(),
    (() => { const c = clone(); c.protected_infrastructure = 'x'; return c })(),
  ]
  for (const contract of broken) {
    const r = evaluateToolEvent(eventFor(fx), { ...ctxFor(), contract })
    assert.equal(r.decision, 'deny')
    assert.match(r.reasonCode, /^contract\./)
  }
  assert.throws(() => loadContract(path.join(HERE, 'does-not-exist.json')), /could not be read/)
  assert.equal(evaluateToolEvent(eventFor(fx), { ...ctxFor(), contract: undefined }).decision, 'deny')
})

test('a stricter contract is honored (contract may tighten, never loosen)', () => {
  const c = JSON.parse(JSON.stringify(CONTRACT))
  c.actions.push_dedicated_branch_fast_forward = 'forbidden'
  validateContract(c)
  const r = evaluateToolEvent(eventFor(FIXTURES.find((f) => f.id === 'P-12')), { ...ctxFor(), contract: c })
  assert.equal(r.classification, 'forbidden')
})

test('internal errors in injected facts fail closed or degrade to stricter classifications', () => {
  const throwing = { ...ctxFor(), gitState: () => { throw new Error('boom') }, readPackageScripts: () => { throw new Error('boom') }, pathExists: () => { throw new Error('boom') } }
  const push = evaluateToolEvent(eventFor({ tool: 'Bash', input: 'git push' }), throwing)
  assert.notEqual(push.decision, 'no_objection')
  const run = evaluateToolEvent(eventFor({ tool: 'Bash', input: 'npm run lint' }), throwing)
  assert.notEqual(run.decision, 'no_objection')
  const write = evaluateToolEvent(eventFor({ tool: 'Write', input: 'supabase/migrations/999_x.sql', content: 'x' }), throwing)
  assert.equal(write.classification, 'forbidden', 'unknown existence of a migration is treated as existing')
})

test('reasons never echo secret values, file contents or full commands', () => {
  const secret = 'sk_live_FAKE_DO_NOT_LOG_1234567890'
  const cases = [
    { tool: 'Bash', input: `echo SUPABASE_SERVICE_ROLE_KEY=${secret} >> apps/api/.env` },
    { tool: 'Bash', input: `curl -H "Authorization: Bearer ${secret}" https://x.supabase.co/rest/v1/users` },
    { tool: 'Bash', input: `cat apps/api/.env && echo ${secret}` },
    { tool: 'Write', input: 'apps/api/.env', content: `KEY=${secret}` },
    { tool: 'Write', input: 'supabase/migrations/001_initial.sql', content: secret },
    { tool: 'Bash', input: `git push https://user:${secret}@github.com/o/r.git main` },
  ]
  for (const fx of cases) {
    const r = evaluateToolEvent(eventFor(fx), ctxFor())
    assert.notEqual(r.decision, 'no_objection')
    assert.ok(!r.reason.includes(secret), `reason leaks secret: ${r.reason}`)
    assert.ok(r.reason.length < 600)
  }
})

test('every action the policy modules can emit is declared in the contract and the floor', () => {
  const files = ['command-policy.mjs', 'file-command-policy.mjs', 'command-tools.mjs', 'git-policy.mjs', 'path-policy.mjs', 'writer-options.mjs', 'policy-engine.mjs', 'policy-common.mjs', 'github-api-policy.mjs', 'http-request-policy.mjs', 'github-write-policy.mjs',
    'bypass-authorization.mjs', 'bypass-digest.mjs', 'bypass-pins.mjs', 'bypass-git-index.mjs'] // V2 permission transition modules
  const all = readdirSync(HERE).filter((f) => f.endsWith('.mjs') && !/test|fixtures|runtime|shell-recognizer/.test(f))
  assert.deepEqual([...all].sort(), [...files].sort(), 'every policy module is scanned')
  const emitted = new Set()
  for (const f of files) {
    const src = readFileSync(path.join(HERE, f), 'utf8')
    for (const m of src.matchAll(/\b(?:F|G|W|push|f)\(\s*'([a-z_]+)'/g)) emitted.add(m[1])
    for (const m of src.matchAll(/\[\s*'([a-z_]{8,})',\s*'[a-z_]+'\s*\]\]/g)) emitted.add(m[1]) // [name, ['action', 'code']] map entries
    for (const m of src.matchAll(/action:\s*'([a-z_]+)'/g)) emitted.add(m[1])
    for (const m of src.matchAll(/\?\s*'([a-z_]{8,})'\s*:\s*'([a-z_]{8,})'/g)) { emitted.add(m[1]); emitted.add(m[2]) }
  }
  emitted.delete('policy_evaluation_failed')
  assert.ok(emitted.size > 30)
  for (const a of emitted) {
    assert.ok(a in ACTION_FLOOR, `${a} has a floor`)
    assert.ok(a in CONTRACT.actions, `${a} is declared in contract.json`)
  }
  for (const [a, floor] of Object.entries(ACTION_FLOOR)) {
    assert.ok(CLASSES.indexOf(CONTRACT.actions[a]) >= CLASSES.indexOf(floor), `${a} not weaker than floor`)
  }
})

test('the Phase 1 forbidden set is part of the engine floor', () => {
  const phase1 = readFileSync(path.join(HERE, 'contract.test.mjs'), 'utf8')
  const list = /const MUST_BE_FORBIDDEN = \[([\s\S]*?)\]/.exec(phase1)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1))
  for (const a of list) assert.equal(ACTION_FLOOR[a], 'forbidden', a)
})

test('shell recognizer: separators, substitutions and dialects are surfaced, not swallowed', () => {
  const p = parseShell('a && b || c; d | e & f')
  assert.deepEqual(p.commands.map((c) => c.words[0].text), ['a', 'b', 'c', 'd', 'e', 'f'])
  assert.deepEqual(parseShell('echo $(x) `y` <(z)').substitutions, ['x', 'y', 'z'])
  assert.equal(parseShell('echo "a').ok, false)
  assert.equal(parseShell("echo 'a").ok, false)
  assert.equal(parseShell('FOO=1 BAR="x y" cmd').commands[0].assignments.length, 2)
  assert.equal(parseShell('git push `', { dialect: 'powershell' }).ok, false)
  assert.deepEqual(parseShell('a; b | c', { dialect: 'powershell' }).commands.map((c) => c.words[0].text), ['a', 'b', 'c'])
  assert.deepEqual(parseShell('a & b && c', { dialect: 'cmd' }).commands.map((c) => c.words[0].text), ['a', 'b', 'c'])
  const h = parseShell("cat > f <<'EOF'\nline $(not-a-substitution)\nEOF\necho next")
  assert.equal(h.commands[0].heredocs[0], 'line $(not-a-substitution)')
  assert.equal(h.commands[1].words[0].text, 'echo')
  assert.equal(parseShell('x'.repeat(300_000)).ok, false)
})

test('credential path recognition distinguishes secrets from templates', () => {
  for (const p of ['.env', 'apps/api/.env', 'apps/web/.env.local', '.env.production', '.env.staging', 'apps/x/.env.regression', 'prod.env',
    'C:\\Users\\dev\\.ssh\\id_rsa', '~/.aws/credentials', 'key.pem', 'github-app.private-key.pem', '.npmrc', 'service-account-prod.json', 'C:/Users/dev/.claude/.credentials.json']) {
    assert.ok(isSensitivePath(p), p)
  }
  for (const p of ['.env.example', 'apps/api/.env.example', '.env.sample', '.env.template', 'apps/web/lib/env.ts', 'environment.md', 'envelope.ts', 'id_rsa.pub', 'worker_credentials.py']) {
    assert.ok(!isSensitivePath(p), p)
  }
})

test('false-positive assessment: legitimate actions and their friction are recorded', () => {
  const legit = FIXTURES.filter((f) => f.group === 'P' || f.group === 'FP')
  const rows = legit.map((f) => ({ id: f.id, action: `${f.tool}: ${f.input}`.slice(0, 60), classification: evaluate(f).classification }))
  // FP-19/FP-20: remediation A — mutating requests to computed URLs and mutation-only GitHub endpoints in opaque code.
  const unnecessaryBlocks = rows.filter((r) => r.classification === 'forbidden' && !['FP-12', 'FP-13', 'FP-19', 'FP-20'].includes(r.id))
  assert.deepEqual(unnecessaryBlocks, [], 'no legitimate action is forbidden except the documented FP-12/FP-13 (core.hooksPath setup) and FP-19/FP-20 (unverifiable API mutation)')
  const autoAllowed = rows.filter((r) => r.classification === 'allowed').length
  assert.ok(autoAllowed >= 25, `ordinary work stays low-friction (${autoAllowed} allowed)`)
})
