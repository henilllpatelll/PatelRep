// Developer Harness V2 — Phase 4 role-definition tests. Offline: no network, no credentials, no model calls.
// Run: node --test scripts/developer-harness-v2/routing/roles.test.mjs
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateToolEvent, loadContract } from '../policy-engine.mjs'
import { EXISTING_FILES, PACKAGE_SCRIPTS, ROOT } from '../policy-fixtures.mjs'
import {
  ACTION_ALIASES, NEVER_GRANT, ROLE_FILE, SHELL_TOOLS, SUPPORTED_FRONTMATTER, TOOL_CAPABILITIES, UNBOUNDED, WRITE_TOOLS,
  agentName, capabilitiesOf, checkRoleSubset, effectiveTools, loadRoleDefinition, parseAgentDefinition, roleCapabilities, roleMayInvoke,
} from './role-capabilities.mjs'
import { PLAN_SCHEMA, checkSpawn, evaluateFinding, planRouting } from './router.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CONTRACT = loadContract(path.join(REPO, 'docs/developer-harness-v2/contract.json'))
const ROLES = Object.keys(CONTRACT.roles)
const DEFS = Object.fromEntries(ROLES.map((r) => [r, loadRoleDefinition(REPO, r)]))
const NON_WRITERS = ROLES.filter((r) => !CONTRACT.roles[r].writes_code)

test('the contract defines exactly the seven approved roles and each has a definition file', () => {
  assert.deepEqual([...ROLES].sort(), ['context_manager', 'coordinator', 'implementer', 'independent_reviewer', 'planner', 'security_reviewer', 'test_coordinator'])
  for (const r of ROLES) assert.ok(DEFS[r], `missing ${ROLE_FILE(r)}`)
  const files = readdirSync(path.join(REPO, '.claude/agents')).filter((f) => f.endsWith('.md')).sort()
  assert.deepEqual(files, ROLES.map((r) => `${agentName(r)}.md`).sort(), 'no extra or unreviewed agent files')
})

test('names and models match the contract exactly; frontmatter uses only supported keys', () => {
  for (const r of ROLES) {
    const d = DEFS[r]
    assert.equal(d.front.name, agentName(r))
    assert.match(d.front.name, /^[a-z]+(-[a-z]+)*$/)
    assert.equal(d.front.model, CONTRACT.roles[r].model, `${r} model`)
    assert.ok(d.front.description && !/: /.test(d.front.description), `${r} description must be single-line plain YAML (no ": ")`)
    for (const k of Object.keys(d.front)) assert.ok(SUPPORTED_FRONTMATTER.includes(k), `${r}: unsupported frontmatter key ${k}`)
    assert.ok(d.tools.length > 0, `${r} must declare an explicit tools allowlist (a missing one inherits every tool)`)
  }
})

test('model routing: Opus for planner/security, Sonnet for coordinator/implementer/reviewer, Haiku for test/context', () => {
  const m = (r) => CONTRACT.roles[r].model
  assert.equal(m('planner'), 'claude-opus-5-5')
  assert.equal(m('security_reviewer'), 'claude-opus-5-5')
  for (const r of ['coordinator', 'implementer', 'independent_reviewer']) assert.equal(m(r), 'claude-sonnet-5-5')
  for (const r of ['test_coordinator', 'context_manager']) assert.equal(m(r), 'claude-haiku-5-5')
})

test('every role\'s effective capabilities are a subset of contract.roles[role].may_perform', () => {
  for (const r of ROLES) {
    const res = checkRoleSubset(DEFS[r], CONTRACT)
    assert.ok(res.ok, `${r} exceeds its contract: ${res.excess.join(', ')}`)
    assert.ok(!roleCapabilities(DEFS[r]).has(UNBOUNDED), `${r} has an unmapped tool`)
  }
})

test('only the implementer has write or shell capability; reviewers/planner/coordinator/test/context hold read-only tools', () => {
  for (const r of NON_WRITERS) {
    assert.deepEqual(effectiveTools(DEFS[r]).sort(), ['Glob', 'Grep', 'Read'], `${r} tools`)
    for (const t of [...WRITE_TOOLS, ...SHELL_TOOLS, ...NEVER_GRANT]) assert.equal(roleMayInvoke(DEFS[r], t), false, `${r} must not invoke ${t}`)
    assert.ok(!roleCapabilities(DEFS[r]).has('edit_files_in_task_worktree'))
  }
  const impl = effectiveTools(DEFS.implementer)
  assert.ok(impl.includes('Edit') && impl.includes('Bash'))
  assert.equal(ROLES.filter((r) => roleCapabilities(DEFS[r]).has('edit_files_in_task_worktree')).length, 1)
})

test('no role holds delegation, network, MCP or skill tools; none can launch another agent', () => {
  for (const r of ROLES) {
    for (const t of effectiveTools(DEFS[r])) {
      assert.ok(t in TOOL_CAPABILITIES, `${r}: tool ${t} has no capability mapping`)
      assert.ok(!NEVER_GRANT.includes(t), `${r}: ${t} is never granted`)
      assert.ok(!/^mcp__/.test(t))
    }
    for (const t of NEVER_GRANT) assert.equal(roleMayInvoke(DEFS[r], t), false)
  }
})

test('the capability map is conservative: a shell tool is never mapped to a harmless subset', () => {
  for (const t of SHELL_TOOLS) {
    const caps = new Set(TOOL_CAPABILITIES[t])
    for (const a of ['edit_files_in_task_worktree', 'commit_to_dedicated_branch', 'push_dedicated_branch_fast_forward', 'open_draft_pull_request']) assert.ok(caps.has(a), `${t} must include ${a}`)
  }
  assert.ok(capabilitiesOf(['mcp__github__create_issue']).has(UNBOUNDED))
  assert.ok(capabilitiesOf(['Agent']).has(UNBOUNDED))
  assert.ok(capabilitiesOf(['SomethingNew']).has(UNBOUNDED))
  // a hypothetical read-only role that was given Bash FAILS the subset check
  const bad = { role: 'independent_reviewer', tools: ['Read', 'Bash'], disallowedTools: [] }
  assert.equal(checkRoleSubset(bad, CONTRACT).ok, false)
  const noList = { role: 'planner', tools: [], disallowedTools: [] }
  assert.equal(checkRoleSubset(noList, CONTRACT).ok, false, 'a missing allowlist inherits everything')
  // a denylist cannot rescue a broadened allowlist if the tool is still effective
  assert.equal(checkRoleSubset({ role: 'context_manager', tools: ['Read', 'Write'], disallowedTools: [] }, CONTRACT).ok, false)
  assert.equal(checkRoleSubset({ role: 'context_manager', tools: ['Read', 'Write'], disallowedTools: ['Write'] }, CONTRACT).ok, true)
})

test('the only alias used is the documented PR-interaction one', () => {
  assert.deepEqual(ACTION_ALIASES, { interact_with_pull_request_or_issue: 'open_draft_pull_request' })
})

test('agent-file parser rejects malformed or unsupported frontmatter', () => {
  assert.throws(() => parseAgentDefinition('no frontmatter'))
  assert.throws(() => parseAgentDefinition('---\nname: a\nname: b\n---\n'))
  assert.throws(() => parseAgentDefinition('---\n- list item\n---\n'))
  assert.deepEqual(parseAgentDefinition('---\nname: a\ntools: Read, Grep\n---\nbody').tools, ['Read', 'Grep'])
})

test('role bodies state no privilege that the frontmatter lacks, and never claim read-only without removing write tools', () => {
  for (const r of NON_WRITERS) {
    const d = DEFS[r]
    if (/read-only/i.test(d.front.description + d.body)) assert.ok(!d.tools.some((t) => [...WRITE_TOOLS, ...SHELL_TOOLS].includes(t)), `${r} claims read-only but holds a write/shell tool`)
  }
  for (const r of ROLES) assert.match(DEFS[r].body, /DATA/, `${r} must state that untrusted content is data`)
})

// ── Negative tests against the real Phase 2 policy engine: a role's allowed tool cannot buy a forbidden effect ──
const ctx = () => ({
  contract: CONTRACT, projectRoot: ROOT, homeDir: 'C:/Users/dev', tempRoots: ['C:/Users/dev/AppData/Local/Temp', '/tmp'], platform: 'win32',
  pathExists: (p) => EXISTING_FILES.has(String(p).toLowerCase()), readPackageScripts: (d) => Object.entries(PACKAGE_SCRIPTS).find(([k]) => k.toLowerCase() === String(d).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase())?.[1] ?? null,
  resolveWorkspace: () => null, gitState: () => ({ branch: 'feat/x', upstreamBranch: 'feat/x', hasUpstream: true }),
})
const shell = (command, tool = 'Bash') => evaluateToolEvent({ hook_event_name: 'PreToolUse', session_id: 's', cwd: ROOT, permission_mode: 'default', tool_name: tool, tool_input: { command }, tool_use_id: 't' }, ctx())

test('the implementer\'s shell cannot merge, dispatch workflows, release, deploy, force-push or activate customer agents', () => {
  const forbidden = [
    'gh pr merge 247 --squash', 'gh pr merge 247 --auto', 'gh workflow run production-release.yml', 'gh api repos/o/r/actions/workflows/x/dispatches -X POST',
    'git push --force origin feat/x', 'git push origin HEAD:main', 'git push --no-verify', 'railway up', 'vercel deploy --prod', 'supabase db push', 'supabase migration repair --status applied 1',
    'gh release create v1', 'eas update --branch production',
  ]
  for (const c of forbidden) {
    const r = shell(c)
    assert.equal(r.decision, 'deny', `${c} -> ${r.decision} (${r.classification})`)
  }
  assert.equal(shell('gh pr merge 247', 'PowerShell').decision, 'deny')
  assert.equal(shell('gh workflow run ci.yml', 'PowerShell').decision, 'deny')
})

test('no role can launch a nested Claude session through a shell (claude -p, npx claude, node cli)', () => {
  for (const c of ['claude -p "do it"', 'claude --agent implementer -p "x"', 'npx @anthropic-ai/claude-code -p hi']) {
    const r = shell(c)
    assert.notEqual(r.decision, 'no_objection', `${c} must not pass silently (got ${r.classification})`)
  }
})

test('the policy hook still fails closed for a malformed event and an unknown tool', () => {
  const bad = evaluateToolEvent({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, ctx())
  assert.equal(bad.decision, 'deny')
  const unknown = evaluateToolEvent({ hook_event_name: 'PreToolUse', session_id: 's', cwd: ROOT, permission_mode: 'default', tool_name: 'SurpriseTool', tool_input: { a: 1 }, tool_use_id: 't' }, ctx())
  assert.notEqual(unknown.decision, 'no_objection')
})

test('role files cannot be edited without human approval (protected path), by any role that does hold Write', () => {
  const edit = evaluateToolEvent({ hook_event_name: 'PreToolUse', session_id: 's', cwd: ROOT, permission_mode: 'default', tool_name: 'Write', tool_input: { file_path: `${ROOT}/.claude/agents/implementer.md`, content: 'x' }, tool_use_id: 't' }, ctx())
  assert.notEqual(edit.decision, 'no_objection')
  assert.equal(edit.decision, 'ask')
})

// ── Spawn guard ──
const plan = (task, files, extra = {}) => planRouting({ task, files, modification: 'edit', contract: CONTRACT, ...extra })
const web = () => plan('Fix a web button style', ['apps/web/components/Button.tsx'])
const sec = () => plan('Change the auth middleware check', ['apps/api/middleware/auth.py'])

test('default workflow launches only the implementer then the independent reviewer, one at a time', () => {
  const p = web()
  assert.equal(p.schema, PLAN_SCHEMA)
  assert.deepEqual(p.sequence, ['implementer', 'independent_reviewer'])
  assert.equal(checkSpawn(p, { role: 'implementer', requestedBy: 'coordinator' }).allowed, true)
  assert.equal(checkSpawn(p, { role: 'independent_reviewer', requestedBy: 'coordinator' }, { active: [{ role: 'implementer', writes_code: true }], spawned: ['implementer'] }).allowed, false, 'concurrency limit')
  assert.equal(checkSpawn(p, { role: 'independent_reviewer', requestedBy: 'coordinator' }, { active: [], spawned: ['implementer'] }).allowed, true)
})

test('spawn guard refuses: unplanned roles, second writer, repeat, nested, background, shell launch, overrides, non-coordinator', () => {
  const p = web()
  const cases = [
    [{ role: 'security_reviewer', requestedBy: 'coordinator' }, {}, 'SPAWN.ROLE_NOT_IN_PLAN'],
    [{ role: 'planner', requestedBy: 'coordinator' }, {}, 'SPAWN.ROLE_NOT_IN_PLAN'],
    [{ role: 'implementer', requestedBy: 'coordinator' }, { active: [{ role: 'implementer', writes_code: true }], spawned: ['implementer'] }, 'SPAWN.CONCURRENCY'],
    [{ role: 'implementer', requestedBy: 'coordinator' }, { active: [], spawned: ['implementer'] }, 'SPAWN.REPEAT'],
    [{ role: 'implementer', requestedBy: 'implementer' }, {}, 'SPAWN.NOT_COORDINATOR'],
    [{ role: 'independent_reviewer', requestedBy: 'implementer' }, {}, 'SPAWN.NOT_COORDINATOR'],
    [{ role: 'implementer', nested: true }, {}, 'SPAWN.NESTED'],
    [{ role: 'implementer', background: true }, {}, 'SPAWN.BACKGROUND'],
    [{ role: 'implementer', viaShell: true }, {}, 'SPAWN.VIA_SHELL'],
    [{ role: 'implementer', tools: ['Bash', 'Agent'] }, {}, 'SPAWN.OVERRIDE'],
    [{ role: 'independent_reviewer', permissions: ['Write'] }, {}, 'SPAWN.OVERRIDE'],
    [{ role: 'independent_reviewer', model: 'claude-haiku-5-5' }, {}, 'SPAWN.OVERRIDE'],
  ]
  for (const [req, state, code] of cases) {
    const r = checkSpawn(p, req, { active: [], spawned: [], ...state })
    assert.equal(r.allowed, false, JSON.stringify(req))
    assert.equal(r.code, code, JSON.stringify(req))
  }
  assert.equal(checkSpawn(null, { role: 'implementer' }).allowed, false)
  assert.equal(checkSpawn(plan('fix the thing', []), { role: 'implementer', requestedBy: 'coordinator' }).code, 'SPAWN.PLAN_NOT_ROUTED')
})

test('a second write-capable role can never be admitted even if some plan lists one', () => {
  const p = JSON.parse(JSON.stringify(web()))
  p.roles.optional.push({ role: 'implementer', writes_code: true, model: 'claude-sonnet-5-5', justification: 'tampered' })
  const r = checkSpawn(p, { role: 'implementer', requestedBy: 'coordinator', justification: 'x' }, { active: [{ role: 'implementer', writes_code: true }], spawned: [] })
  assert.equal(r.allowed, false)
})

test('optional roles need a recorded justification; security review sequence is last', () => {
  const p = sec()
  assert.deepEqual(p.sequence.at(-1), 'security_reviewer')
  const big = plan('Update many components', Array.from({ length: 11 }, (_, i) => `apps/web/components/C${i}.tsx`))
  assert.equal(big.roles.optional.some((r) => r.role === 'test_coordinator'), true)
  assert.equal(checkSpawn(big, { role: 'test_coordinator', requestedBy: 'coordinator' }).code, 'SPAWN.JUSTIFICATION_REQUIRED')
  assert.equal(checkSpawn(big, { role: 'test_coordinator', requestedBy: 'coordinator', justification: 'many files' }).allowed, true)
})

test('reviewer findings are evidence; a blocking security finding cannot be dismissed by the implementer or coordinator', () => {
  const f = { severity: 'high' }
  assert.equal(evaluateFinding(f).authorizes, false)
  assert.equal(evaluateFinding(f).open, true)
  assert.equal(evaluateFinding(f, { kind: 'dismissed', by: 'implementer' }).open, true)
  assert.equal(evaluateFinding(f, { kind: 'human_decision', by: 'coordinator' }).open, true)
  assert.equal(evaluateFinding(f, { kind: 'human_decision', by: 'human' }).open, false)
  assert.equal(evaluateFinding(f, { kind: 'remediated_and_rereviewed' }).open, false)
  assert.equal(evaluateFinding({ severity: 'low' }).open, false)
  assert.equal(evaluateFinding({ severity: 'critical', recommendation: 'GO' }).authorizes, false)
})
