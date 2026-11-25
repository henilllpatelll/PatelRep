// Developer Harness V2 — Phase 4 M1 hardening tests (human-approved: nine OpenWolf protected paths).
// Offline and pure. Run: node --test scripts/developer-harness-v2/m1-hardening.test.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CLASSES, evaluateToolEvent, loadContract, validateContract } from './policy-engine.mjs'
import { FIXTURES, ROOT, EXISTING_FILES, PACKAGE_SCRIPTS } from './policy-fixtures.mjs'
import { M1_FIXTURES, M1_PATHS, M1_TRANSIENT } from './policy-fixtures-m1.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const CONTRACT = loadContract(path.join(REPO, 'docs/developer-harness-v2/contract.json'))
const BASELINE = JSON.parse(readFileSync(path.join(HERE, 'fixtures-baseline-pre-m1.json'), 'utf8'))
const RANK = Object.fromEntries(CLASSES.map((c, i) => [c, i]))
const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

const ctx = (git = { branch: 'feat/x', upstreamBranch: 'feat/x', hasUpstream: true }) => ({
  contract: CONTRACT, projectRoot: ROOT, homeDir: 'C:/Users/dev', tempRoots: ['C:/Users/dev/AppData/Local/Temp', '/tmp'], platform: 'win32',
  pathExists: (p) => EXISTING_FILES.has(String(p).toLowerCase()),
  readPackageScripts: (d) => Object.entries(PACKAGE_SCRIPTS).find(([k]) => k.toLowerCase() === String(d).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase())?.[1] ?? null,
  resolveWorkspace: () => null, gitState: () => git,
})
const event = (tool, input) => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: ROOT, permission_mode: 'default', tool_name: tool, tool_input: input, tool_use_id: 't' })
const write = (rel, tool = 'Write') => evaluateToolEvent(event(tool, tool === 'Edit' ? { file_path: `${ROOT}/${rel}`, old_string: 'a', new_string: 'b' } : { file_path: `${ROOT}/${rel}`, content: 'x' }), ctx())

test('contract declares exactly the nine approved paths, additively, with audit metadata', () => {
  assert.equal(M1_PATHS.length, 9)
  for (const p of M1_PATHS) assert.ok(CONTRACT.protected_paths.includes(p), `${p} protected`)
  assert.deepEqual(CONTRACT.m1_hardening.added_protected_paths, [...M1_PATHS])
  const previous = ['.github/**', 'supabase/migrations/**', 'scripts/**', '.githooks/**', '.claude/settings.json', '.claude/hooks/**', '.claude/**', '.mcp.json', '.wolf/hooks/**', 'CLAUDE.md', 'AGENTS.md', '**/CLAUDE.md', '**/AGENTS.md', 'docs/developer-harness-v2/**', '.husky/**', '.vscode/**', '.gitattributes', 'supabase/staging-reviewed-migrations.json', 'docs/staging-previews/**']
  assert.deepEqual(CONTRACT.protected_paths.slice(0, previous.length), previous, 'every previous protected path kept, in order')
  assert.deepEqual(CONTRACT.protected_paths.slice(previous.length), [...M1_PATHS], 'nothing but the nine was added')
  for (const t of M1_TRANSIENT) assert.ok(!CONTRACT.protected_paths.includes(t) && !CONTRACT.m1_hardening.added_protected_paths.includes(t), `${t} stays unprotected`)
})

test('action classes, infrastructure, roles and topology are byte-for-byte unchanged by M1', () => {
  // V2 permission transition (14-v2-permission-transition.md) later added exactly one action (run_privileged_infrastructure, human_approval).
  // The matrix pinned here is the matrix minus that recorded addition: this remediation still changed no action.
  assert.deepEqual(CONTRACT.bypass_authorization.added_actions, ['run_privileged_infrastructure'])
  assert.equal(CONTRACT.actions.run_privileged_infrastructure, 'human_approval')
  const priorActions = Object.fromEntries(Object.entries(CONTRACT.actions).filter(([a]) => !CONTRACT.bypass_authorization.added_actions.includes(a)))
  assert.equal(digest(priorActions), '80cbf36c889d2a6db5c382c20910d221aa10e0834291ac82e7fc5eb05e062890')
  assert.equal(digest(CONTRACT.protected_infrastructure), 'c4d3fa844279db8fa66f7204d3e062794660ed114818a1bae00434adbd0258b9')
  assert.equal(digest(CONTRACT.roles), 'fa787dbee2e6ab5ea1b816d7d81ad9c6caf1df250f511467f283aac92a478f3e')
  assert.equal(digest(CONTRACT.topology), '8fe7bad50a16e9517d8b4a4c313b21f7d64ab2f9934722f3f75bc555c4776ce0')
})

test('a weakened contract that omits any one of the nine paths is rejected (fail closed)', () => {
  for (const p of M1_PATHS) {
    const weak = JSON.parse(JSON.stringify(CONTRACT))
    weak.protected_paths = weak.protected_paths.filter((x) => x !== p)
    assert.throws(() => validateContract(weak), (e) => e.code === 'contract.paths_weakened' && e.message.includes(p), `omitting ${p}`)
    // and the engine denies every call under such a contract rather than silently allowing the write
    const r = evaluateToolEvent(event('Write', { file_path: `${ROOT}/${p.replace('/**', '/x.md')}`, content: 'x' }), { ...ctx(), contract: weak })
    assert.equal(r.decision, 'deny', `engine under a contract omitting ${p}`)
    assert.equal(r.reasonCode, 'contract.paths_weakened')
  }
})

test('all nine paths require human approval for Write and Edit, with the intended label', () => {
  const concrete = { '.wolf/knowledge/**': '.wolf/knowledge/web.md' }
  const instructionLabel = new Set(['.wolf/OPENWOLF.md', '.wolf/cerebrum.md', '.wolf/knowledge/**', '.wolf/reframe-frameworks.md', '.wolf/identity.md'])
  for (const p of M1_PATHS) {
    const rel = concrete[p] ?? p
    for (const tool of ['Write', 'Edit']) {
      const r = write(rel, tool)
      assert.equal(r.classification, 'human_approval', `${tool} ${rel}`)
      assert.equal(r.decision, 'ask')
      assert.equal(r.action, instructionLabel.has(p) ? 'modify_agent_instructions_or_hooks' : 'modify_control_plane_files', rel)
    }
  }
})

test('approval is denied (not silently allowed) when prompts cannot be mediated', () => {
  for (const mode of ['bypassPermissions', 'dontAsk', 'auto']) {
    const r = evaluateToolEvent({ ...event('Write', { file_path: `${ROOT}/.wolf/cerebrum.md`, content: 'x' }), permission_mode: mode }, ctx())
    assert.equal(r.decision, 'deny')
  }
})

test('transient bookkeeping, reads and ordinary source keep their previous classification', () => {
  for (const t of M1_TRANSIENT) assert.equal(write(t, 'Edit').classification, 'allowed', t)
  assert.equal(write('.wolf/hooks/_session.json', 'Edit').classification, 'human_approval', 'already protected by .wolf/hooks/**')
  assert.equal(write('apps/web/lib/x.ts', 'Edit').classification, 'allowed')
  assert.equal(evaluateToolEvent(event('Read', { file_path: `${ROOT}/.wolf/cerebrum.md` }), ctx()).classification, 'allowed')
})

test('NON-BROADENING: no pre-M1 fixture classification is less restrictive, and none changed at all', () => {
  const ids = Object.keys(BASELINE)
  assert.ok(ids.length >= 528)
  const byId = new Map(FIXTURES.map((f) => [f.id, f]))
  let evaluated = 0
  for (const id of ids) {
    const fx = byId.get(id)
    assert.ok(fx, `fixture ${id} still exists`)
    const now = evaluateToolEvent(eventFor(fx), ctx(fx.git)).classification
    assert.ok(RANK[now] >= RANK[BASELINE[id]], `${id}: ${BASELINE[id]} → ${now} is LESS restrictive`)
    assert.equal(now, BASELINE[id], `${id}: classification changed (${BASELINE[id]} → ${now})`)
    evaluated++
  }
  assert.equal(evaluated, ids.length)
})

test('every M1 fixture is a strict tightening or unchanged, never a loosening', () => {
  assert.ok(M1_FIXTURES.length >= 60)
  let tightened = 0
  for (const fx of M1_FIXTURES) {
    const now = evaluateToolEvent(eventFor(fx), ctx(fx.git)).classification
    assert.equal(now, fx.expect, fx.id)
    assert.ok(RANK[now] >= RANK[fx.before], `${fx.id}: ${fx.before} → ${now}`)
    if (RANK[now] > RANK[fx.before]) tightened++
  }
  assert.equal(tightened, 45, "exactly the 45 protected-write fixtures tightened")
})

test('the M1 fixtures cover Write, Edit, shell redirection, PowerShell, GitHub REST and GitHub MCP file writes', () => {
  const tools = new Set(M1_FIXTURES.filter((f) => f.expect === 'human_approval').map((f) => f.tool))
  for (const t of ['Write', 'Edit', 'Bash', 'PowerShell', 'mcp__github__create_or_update_file', 'mcp__github__delete_file', 'mcp__github__push_files']) assert.ok(tools.has(t), t)
  assert.ok(M1_FIXTURES.some((f) => f.tool === 'Bash' && />>?\s*\.wolf\//.test(f.input)), 'shell redirection')
  assert.ok(M1_FIXTURES.some((f) => f.tool === 'Bash' && /gh api -X PUT/.test(f.input)), 'GitHub REST contents API')
})

test('Phase 2 fail-closed behavior is unchanged: forbidden stays forbidden and malformed events deny', () => {
  assert.equal(evaluateToolEvent(event('Bash', { command: 'git push origin main' }), ctx()).decision, 'deny')
  assert.equal(evaluateToolEvent({ hook_event_name: 'PreToolUse', tool_name: 'Write' }, ctx()).decision, 'deny')
  const hooks = readFileSync(path.join(REPO, '.wolf/hooks/stop.js'), 'utf8')
  assert.ok(hooks.length > 0, '.wolf/hooks/*.js are untouched and present')
})

function eventFor(fx) {
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
  return event(fx.tool, input)
}
