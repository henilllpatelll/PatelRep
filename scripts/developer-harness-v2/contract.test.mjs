// Developer Harness V2 — Phase 1 baseline contract tests.
//
// These tests check the DECLARED architecture contract (docs/developer-harness-v2/contract.json + docs) for
// internal consistency and check that the authoritative infrastructure the contract depends on is still present.
// They enforce nothing at runtime and deliberately do NOT snapshot today's Claude settings, hooks or OpenWolf
// files: later phases are expected to change those.
//
// Run: node --test scripts/developer-harness-v2/contract.test.mjs
// Not wired into CI until Phase 8 (PR B).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOCS = 'docs/developer-harness-v2'
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const exists = (rel) => existsSync(path.join(ROOT, rel))
const contract = JSON.parse(read(`${DOCS}/contract.json`))

const REQUIRED_DOCS = [
  '01-current-state-audit.md',
  '02-architecture-contract.md',
  '03-authority-and-threat-model.md',
  '04-phase-roadmap-and-acceptance.md',
  '05-evaluation-baseline.md',
  '06-baseline-fixtures-and-invariants.md',
]
const CLASSES = ['allowed', 'task_authorized', 'human_approval', 'forbidden']

// Actions that must never be performable by any developer-harness role, under any approval.
// Reason: each one crosses an authoritative boundary (production, migration history, merge authority,
// repository controls, customer-agent activation) that V2 must not acquire.
const MUST_BE_FORBIDDEN = [
  'push_to_protected_main',
  'force_push_or_rewrite_reviewed_history',
  'merge_pull_request',
  'enable_auto_merge',
  'approve_pull_request_as_gate',
  'modify_existing_migration',
  'supabase_migration_repair',
  'apply_migration_to_staging_or_production',
  'run_supabase_cli_against_remote_project',
  'deploy_production',
  'dispatch_production_release_or_rollback',
  'dispatch_any_workflow',
  'deploy_or_mutate_staging_directly',
  'publish_mobile_build_or_ota_update',
  'change_repository_rulesets_secrets_environments_or_permissions',
  'read_production_or_publisher_credentials',
  'access_customer_data',
  'activate_customer_agent_execution',
  'grant_customer_agent_autonomy_or_decide_v2',
  'enable_customer_agent_billing',
  'bypass_git_hooks_or_ci',
  'create_alternate_publishing_or_deployment_path',
]

/** Minimal glob: `**` matches any depth, `*` matches within one segment. */
function globMatches(glob, file) {
  const re = glob
    .split('**')
    .map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*')
  return new RegExp(`^${re}$`).test(file)
}

test('every Phase 1 document and the machine-readable contract exist and carry the audited baseline SHA', () => {
  assert.match(contract.baseline.main_sha, /^[0-9a-f]{40}$/)
  for (const doc of REQUIRED_DOCS) {
    const rel = `${DOCS}/${doc}`
    assert.ok(exists(rel), `${rel} exists`)
    assert.ok(read(rel).length > 1500, `${rel} is substantive`)
  }
  // The audit and threat model must be tied to the exact SHA they describe (provenance, not prose).
  for (const doc of ['01-current-state-audit.md', '03-authority-and-threat-model.md', '05-evaluation-baseline.md']) {
    assert.ok(read(`${DOCS}/${doc}`).includes(contract.baseline.main_sha), `${doc} names the baseline SHA`)
  }
})

test('phase and PR structure: 8 contiguous phases, 1–7 in PR A on the core branch, 8 alone in PR B', () => {
  const numbers = contract.phases.map((p) => p.number)
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(contract.pull_requests.A.phases, [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(contract.pull_requests.B.phases, [8])
  for (const phase of contract.phases) assert.equal(phase.pr, phase.number <= 7 ? 'A' : 'B', `phase ${phase.number} PR`)
  assert.equal(contract.pull_requests.A.branch, 'feat/developer-harness-v2-core')

  // The human-readable roadmap must describe the same phases in the same order (so docs cannot drift silently).
  const roadmap = read(`${DOCS}/04-phase-roadmap-and-acceptance.md`)
  let cursor = -1
  for (const phase of contract.phases) {
    const idx = roadmap.indexOf(`## Phase ${phase.number} — ${phase.name}`)
    assert.ok(idx > cursor, `roadmap has "Phase ${phase.number} — ${phase.name}" in order`)
    cursor = idx
  }
})

test('every phase and role uses a model from the declared routing set; Sonnet is the default', () => {
  const allowed = new Set(Object.values(contract.models))
  assert.equal(contract.models.default, 'claude-sonnet-5-5')
  for (const phase of contract.phases) assert.ok(allowed.has(phase.model), `phase ${phase.number} model`)
  for (const [name, role] of Object.entries(contract.roles)) assert.ok(allowed.has(role.model), `role ${name} model`)
})

test('the declared action matrix never authorizes production deployment, protected migrations, merges or repo-control changes', () => {
  for (const [action, cls] of Object.entries(contract.actions)) {
    assert.ok(CLASSES.includes(cls), `${action} has a known class (${cls})`)
  }
  for (const action of MUST_BE_FORBIDDEN) {
    assert.equal(contract.actions[action], 'forbidden', `${action} must be forbidden`)
  }
})

test('no role can perform a forbidden or approval-gated action, and exactly one role writes code', () => {
  const writers = Object.entries(contract.roles).filter(([, role]) => role.writes_code)
  assert.deepEqual(writers.map(([name]) => name), ['implementer'])
  for (const [name, role] of Object.entries(contract.roles)) {
    for (const action of role.may_perform) {
      assert.ok(action in contract.actions, `role ${name} references declared action ${action}`)
      assert.ok(['allowed', 'task_authorized'].includes(contract.actions[action]), `role ${name} cannot hold ${action} (${contract.actions[action]})`)
    }
    if (!role.writes_code) {
      for (const writeAction of ['edit_files_in_task_worktree', 'commit_to_dedicated_branch', 'push_dedicated_branch_fast_forward', 'open_draft_pull_request']) {
        assert.ok(!role.may_perform.includes(writeAction), `non-writing role ${name} must not ${writeAction}`)
      }
    }
  }
  for (const reviewer of ['independent_reviewer', 'security_reviewer']) {
    assert.ok(contract.roles[reviewer], `${reviewer} role is declared`)
    assert.equal(contract.roles[reviewer].writes_code, false)
  }
})

test('default topology is one implementer plus an independent reviewer, not a persistent swarm', () => {
  assert.equal(contract.topology.default, 'single-implementer-plus-independent-reviewer')
  assert.equal(contract.topology.persistent_swarm, false)
  assert.equal(contract.topology.max_concurrent_write_roles, 1)
})

test('developer-agent authority is separated from customer-agent authority', () => {
  assert.equal(contract.scope.subject, 'developer-agents')
  assert.equal(contract.scope.excludes, 'customer-agents')
  for (const action of ['activate_customer_agent_execution', 'grant_customer_agent_autonomy_or_decide_v2', 'enable_customer_agent_billing', 'access_customer_data']) {
    assert.equal(contract.actions[action], 'forbidden')
  }
  const arch = read(`${DOCS}/02-architecture-contract.md`)
  assert.match(arch, /^## \d+\. Developer-agent vs customer-agent separation$/m)
  // External constraints are owned by customer Agent Harness work and must point at real documents.
  const ids = contract.external_constraints.map((c) => c.id).sort()
  assert.deepEqual(ids, ['hs256-boundary', 'level2-pause-race', 'truncate-privileges'])
  for (const c of contract.external_constraints) assert.ok(exists(c.reference), `${c.id} reference ${c.reference} exists`)
})

test('the recovery auto-merge and production-request paths are preserved exceptions, not V2 grants', () => {
  const ids = contract.preserved_exceptions.map((e) => e.id)
  assert.ok(ids.includes('release-engineer-recovery-auto-merge'))
  for (const exception of contract.preserved_exceptions) {
    assert.equal(exception.granted_to_v2_roles, false, `${exception.id} is not granted to V2 roles`)
    assert.ok(exists(exception.workflow), `${exception.workflow} still exists unchanged in place`)
  }
  const threat = read(`${DOCS}/03-authority-and-threat-model.md`)
  assert.match(threat, /pre-existing exception, preserved without modification/)
})

test('authoritative CI/Staging gates and trusted publishers the contract relies on are still present', () => {
  for (const file of contract.protected_infrastructure) assert.ok(exists(file), `${file} exists`)
  assert.deepEqual(contract.required_status_checks, ['CI Gate', 'Staging Gate'])
  assert.match(read('.github/workflows/ci.yml'), /^ {4}name: CI Gate$/m, 'ci.yml defines the CI Gate job')
  assert.match(read('.github/workflows/staging-candidate.yml'), /name: 'Staging Gate'/, 'staging-candidate reports Staging Gate')
  // Credential separation (P-3): the agent jobs must keep running without persisted credentials.
  for (const wf of ['.github/workflows/autonomous-feature-builder.yml', '.github/workflows/claude-release-engineer.yml']) {
    assert.match(read(wf), /persist-credentials: false/, `${wf} checks out without persisted credentials`)
  }
})

test('every protected infrastructure file and frozen artifact is covered by a declared protected path', () => {
  const frozen = [contract.frozen_artifacts.migration_262, 'docs/staging-previews/h7-p2-verified-human-identity-262.md']
  assert.ok(exists(contract.frozen_artifacts.migration_262), 'migration 262 exists')
  for (const file of [...contract.protected_infrastructure, ...frozen]) {
    assert.ok(contract.protected_paths.some((g) => globMatches(g, file)), `${file} is under a protected path`)
  }
  for (const essential of ['.github/**', 'supabase/migrations/**', '.claude/settings.json', '.claude/hooks/**', '.wolf/hooks/**']) {
    assert.ok(contract.protected_paths.includes(essential), `${essential} is protected`)
  }
})

test('the invariants document specifies every required negative case for later phases', () => {
  const doc = read(`${DOCS}/06-baseline-fixtures-and-invariants.md`)
  const topics = [
    /Direct push to protected `main`/,
    /Force-push \/ rebase of reviewed history/,
    /Unauthorized migration modification/,
    /Protected workflow modification/,
    /Production deployment attempt/,
    /Staging credential misuse/,
    /Stale PR-head approval/,
    /Untrusted instructions in tool output/,
    /Resumption from invalid checkpoint/,
    /Unauthorized subagent tool escalation/,
    /Accidental customer-agent activation or billing/,
  ]
  for (const topic of topics) assert.match(doc, topic)
  assert.match(doc, /\*\*specifications only\*\*/, 'negative cases are marked as specifications, not executed against real environments')
})

test('baseline metrics never present unmeasured values as measurements', () => {
  const doc = read(`${DOCS}/05-evaluation-baseline.md`)
  const table = doc.slice(doc.indexOf('## 1. Baseline metrics'), doc.indexOf('### Read-only statistics'))
  const rows = table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Metric') && !l.startsWith('|---'))
  assert.ok(rows.length >= 9, 'all baseline metrics are listed')
  for (const row of rows) {
    const baseline = row.split('|')[3].trim()
    assert.ok(/NOT MEASURED|MEASURED|ESTIMATE/.test(baseline), `metric row labels its baseline: ${row.slice(0, 60)}`)
  }
  assert.match(doc, /character-ratio estimates only/, 'OpenWolf token ledger is labelled as an estimate')
})
