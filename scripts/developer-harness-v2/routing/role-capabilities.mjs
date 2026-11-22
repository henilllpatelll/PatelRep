// Developer Harness V2 — Phase 4 role definitions: tool → contract-action capability map and agent-file parser.
//
// Claude Code subagent definitions (.claude/agents/*.md) restrict a role ONLY through their `tools` allowlist and
// `disallowedTools` denylist. A prompt saying "read-only" restricts nothing. This module therefore maps every tool
// to the contract actions it can ACTUALLY effect, conservatively, and the tests prove each role's tool list stays
// inside `contract.json → roles → <role>.may_perform`.
//
// The Phase 2 hook is NOT role-aware: it classifies the effect of a call, whichever role made it. It remains the
// enforcement layer for the implementer's shell/edit calls; it is not a reason to hand a shell to a read-only role.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Contract role ids use underscores; Claude Code agent names use lowercase hyphens. */
export const agentName = (role) => role.replace(/_/g, '-')
export const ROLE_FILE = (role) => `.claude/agents/${agentName(role)}.md`

/**
 * Actions a tool can effect with NO further human approval (class allowed / task_authorized), conservatively.
 *  - Read/Grep/Glob: repository reads only (the hook additionally refuses credential paths).
 *  - Edit/Write/NotebookEdit: file writes in the task worktree.
 *  - Bash/PowerShell: a shell can do anything the hook lets through unprompted: reads, writes, local checks, commits,
 *    fast-forward pushes, draft PRs, GitHub reads. It is NEVER mapped to a smaller set because one example is harmless.
 * Anything not listed here (Agent, WebFetch, WebSearch, MCP tools, unknown tools) is mapped to UNBOUNDED and fails the
 * subset test for every role.
 */
const READ = ['read_repository']
const WRITE = ['edit_files_in_task_worktree']
export const SHELL_REACH = Object.freeze([
  'read_repository', 'edit_files_in_task_worktree', 'run_lightweight_local_checks', 'commit_to_dedicated_branch',
  'push_dedicated_branch_fast_forward', 'open_draft_pull_request', 'read_github_state',
])
export const TOOL_CAPABILITIES = Object.freeze({
  Read: READ,
  Grep: READ,
  Glob: READ,
  Edit: [...READ, ...WRITE],
  Write: [...READ, ...WRITE],
  NotebookEdit: [...READ, ...WRITE],
  Bash: SHELL_REACH,
  PowerShell: SHELL_REACH,
})
export const SHELL_TOOLS = Object.freeze(['Bash', 'PowerShell'])
export const WRITE_TOOLS = Object.freeze(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
/** Tools no role may hold: delegation, network, remote shells, background shells, every MCP server. */
export const NEVER_GRANT = Object.freeze(['Agent', 'Task', 'WebFetch', 'WebSearch', 'Monitor', 'SendMessage', 'Skill', 'ScheduleWakeup', 'CronCreate', 'RemoteTrigger'])

/** Documented alias: the contract names the PR-comment action class as the same class as opening a draft PR. */
export const ACTION_ALIASES = Object.freeze({ interact_with_pull_request_or_issue: 'open_draft_pull_request' })

export const UNBOUNDED = '*unbounded*'

/** Capability set of a tool list; any tool without a mapping (incl. mcp__*) contributes UNBOUNDED. */
export function capabilitiesOf(tools) {
  const out = new Set()
  for (const t of tools) {
    const caps = TOOL_CAPABILITIES[t]
    if (!caps) out.add(UNBOUNDED)
    else caps.forEach((c) => out.add(c))
  }
  return out
}

const splitList = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/** Minimal YAML-frontmatter parser for the flat `key: value` shape agent files use. Anything else is an error. */
export function parseAgentDefinition(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) throw new Error('agent file has no frontmatter')
  const front = {}
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (!kv) throw new Error(`unsupported frontmatter line: ${line.slice(0, 60)}`)
    if (kv[1] in front) throw new Error(`duplicate frontmatter key: ${kv[1]}`)
    front[kv[1]] = kv[2].trim()
  }
  return { front, body: m[2], tools: splitList(front.tools), disallowedTools: splitList(front.disallowedTools) }
}

/** Frontmatter keys this repository relies on. Anything else (permissionMode, hooks, mcpServers, …) is rejected. */
export const SUPPORTED_FRONTMATTER = Object.freeze(['name', 'description', 'tools', 'disallowedTools', 'model'])

export function loadRoleDefinition(root, role) {
  const file = path.join(root, ...ROLE_FILE(role).split('/'))
  if (!existsSync(file)) return null
  return { role, file: ROLE_FILE(role), ...parseAgentDefinition(readFileSync(file, 'utf8')) }
}

/** Effective tools = allowlist minus denylist. A missing allowlist inherits EVERYTHING and is reported as UNBOUNDED. */
export function effectiveTools(def) {
  if (!def.tools.length) return [UNBOUNDED]
  return def.tools.filter((t) => !def.disallowedTools.includes(t))
}

/** Actions a role's effective tools can effect, after alias normalization. */
export function roleCapabilities(def) {
  return capabilitiesOf(effectiveTools(def))
}

/** { ok, excess[] } — true when every capability is an action the contract grants the role. */
export function checkRoleSubset(def, contract) {
  const spec = contract.roles[def.role]
  if (!spec) return { ok: false, excess: ['role is not in the contract'] }
  const granted = new Set(spec.may_perform)
  const excess = [...roleCapabilities(def)].filter((c) => !granted.has(ACTION_ALIASES[c] ?? c))
  return { ok: excess.length === 0, excess }
}

/** Can this role invoke this tool at all? (Native allowlist/denylist semantics.) */
export function roleMayInvoke(def, tool) {
  return effectiveTools(def).includes(tool)
}
