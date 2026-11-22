#!/usr/bin/env node
// Developer Harness V2 — Phase 4 deterministic role and risk router.
//
// Pure function of (human task text, file paths, modification type, human-supplied metadata, contract.json).
// No model call, no network, no file CONTENT is read. Everything it returns is a PLAN: it starts nothing and grants
// nothing. Authority comes only from the human's task and the verified contract; anything else is data.
//
//   node router.mjs --task "<text>" [--files a,b] [--surface web|mobile|api|database|ci-release|security|developer-harness]
//                   [--modification add|edit|delete|rename|config|dependency|migration|docs|style|architecture]
//                   [--authorize push,open_draft_pr] [--models <id,id,...>] [--diff-base <ref>]
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, PACKS, routeTask as routePackCategory } from '../context/context-packs.mjs'
import { globToRegExp } from '../path-policy.mjs'
import { loadContract } from '../policy-engine.mjs'

export const PLAN_SCHEMA = 'developer-harness-v2/routing-plan@1'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO = path.resolve(HERE, '..', '..', '..')

/** Roles in spawn order. The coordinator is the primary session, never a spawned process. */
const SEQUENCE = ['planner', 'implementer', 'test_coordinator', 'independent_reviewer', 'security_reviewer']

// ── Security-review triggers: the 16 mandatory categories. Both a path signal and a task-intent signal count. ──
const T = (id, label, paths, text, category) => ({ id, label, paths, text, category })
export const SECURITY_TRIGGERS = Object.freeze([
  T('SEC.CUSTOMER_AGENT_HARNESS', 'Customer Agent Harness implementation, grants, execution or billing',
    /^(docs\/agent-harness\/|apps\/api\/(services\/)?agents?\/|apps\/api\/.*harness)|(^|[/_.-])(agent[_-]?harness|decide[_-]?v2|agent[_-]?grants?)([/_.-]|$)/i,
    /\b(agent harness|customer agents?|agent (grants?|execution|billing|autonomy)|decide_v2|h[1-7] harness|worker lease)\b/i, 'security'),
  T('SEC.AUTHN_AUTHZ', 'Authentication and authorization',
    /(^|[/_.-])(auth(?!ors?([/_.-]|$))[a-z]*|login|logout|session|jwt|oauth|sso|password|mfa|permissions?|guards?)([/_.-]|$)|apps\/api\/(middleware|core)\//i,
    /\b(auth(?!ors?\b|ored\b)\w*|login|logout|log in|sign[- ]?(in|up|out)|jwt|oauth|sso|password|refresh tokens?|session (token|cookie)|permission check|access control|admin[- ]only|only (managers?|admins?|gms?)\b)/i, 'security'),
  T('SEC.RBAC', 'Role-based access control', /(^|[/_.-])(rbac|roles?|require_role|custom_roles?)([/_.-]|$)|RBAC-MATRIX/i,
    /\b(rbac|require_role|role[- ]based|role gating|(custom|user|staff|new) roles?|roles\b|housekeeper role|gm role)/i, 'security'),
  T('SEC.RLS_TENANT', 'Row-level security and tenant isolation', /(^|[/_.-])(rls|tenant|tenancy|hotel_id)([/_.-]|$)/i,
    /\b(rls|row[- ]level|tenant|tenancy|hotel_id|cross[- ]hotel|other hotels?|multi[- ]tenant|tenant isolation)\b/i, 'database'),
  T('SEC.MIGRATIONS', 'Supabase migrations or schema-security contracts', /^supabase\//i,
    /\b(migrations?|schema|supabase (schema|migration)|alter table|create table|add (a |an )?(new )?(column|table|index)|drop (column|table)|ddl)\b/i, 'database'),
  T('SEC.DB_PRIVILEGES', 'Database privileges, triggers or sensitive RPCs', /(^|[/_.-])(privileges?|triggers?|security[_-]definer|rpc)([/_.-]|$)/i,
    /\b(grant|revoke|privileges?|triggers?|security definer|rpc|stored (procedure|function)|postgres function)\b/i, 'database'),
  T('SEC.SECRETS', 'Secrets and credentials', /(^|[/_.-])(secrets?|credentials?|\.env[a-z.]*|api[_-]?keys?|private[_-]?keys?|tokens?)([/_.-]|$)|\.(pem|key|p12|pfx)$/i,
    /\b(secrets?|credentials?|api[_ -]?keys?|private keys?|service[_ -]role|env(ironment)? (var\w*|file)|\.env|access tokens?)\b/i, 'security'),
  T('SEC.PAYMENTS', 'Payments or Stripe integration', /(^|[/_.-])(stripe|billing|payments?|subscriptions?|invoices?|credits?)([/_.-]|$)/i,
    /\b(stripe|billing|payments?|subscriptions?|invoices?|checkout|ai credits?|metered|true[- ]up|charge)\b/i, 'security'),
  T('SEC.CLAUDE_CONTROL', 'Claude instructions, hooks, skills, memory policy or role permissions',
    /^(\.claude\/|\.wolf\/|\.mcp\.json$|CLAUDE\.md$|AGENTS\.md$|(.*\/)?(CLAUDE|AGENTS)\.md$)/i,
    /\b(claude\.md|agents\.md|claude hooks?|hooks?|subagents?|agent definitions?|openwolf|cerebrum|memory policy|\.claude|skills?|role permissions?|permission mode|settings\.json)\b/i, 'developer-harness'),
  T('SEC.HARNESS_POLICY', 'Developer Harness security contracts and policy code', /^(scripts\/developer-harness-v2\/|docs\/developer-harness-v2\/)/i,
    /\b(developer harness|policy engine|policy hook|contract\.json|context packs?|developer[- ]harness|routing plan|router)\b/i, 'developer-harness'),
  T('SEC.WORKFLOWS_GATES', 'GitHub Actions workflows and CI/Staging gates', /^(\.github\/|\.githooks\/|\.husky\/)/i,
    /\b(github actions?|workflows?|ci gate|staging gate|staging candidate|ci pipeline|\.github|pre-push|branch protection|required checks?)\b/i, 'ci-release'),
  T('SEC.DEPLOYMENT', 'Deployment or publishing infrastructure', /(^|\/)(railway[^/]*|vercel[^/]*|eas\.json|Dockerfile[^/]*|nixpacks[^/]*|app\.json)$|^apps\/mobile\/(eas|app)\.json$/i,
    /\b(deploy\w*|railway|vercel|eas (build|update|submit)|ota update|publish(ing)?|app store|play store|dockerfile|docker image)\b/i, 'ci-release'),
  T('SEC.RELEASE_ROLLBACK', 'Production release and rollback controls', /(production[_-](release|rollback)|release[_-]engineer|publish[_-](feature|release)|merge[_-]release)/i,
    /\b(production release|rollback|release engineer|release workflow|cut a release|promote to production)\b/i, 'ci-release'),
  T('SEC.AUTOMERGE_RECOVERY', 'Recovery automation and auto-merge', /(auto[_-]?merge|recovery[_-]|claude\/recovery)/i,
    /\b(auto[- ]?merge|recovery (automation|branch|workflow)|merge queue|self[- ]heal)\b/i, 'ci-release'),
  T('SEC.REPO_CONTROLS', 'Repository rulesets, environments and protection settings', /(^|\/)(rulesets?|environments?|codeowners|branch[_-]protection)([/._-]|$)/i,
    /\b(rulesets?|branch protection|environments?|github app permissions?|repository settings|protected branch|code ?owners)\b/i, 'ci-release'),
])

/** Paths that are ordinary product work. Anything outside them is "unknown" (trigger SEC.UNKNOWN_SCOPE). */
const ORDINARY_PATH = [
  /^apps\/web\/(app|components|lib|hooks|styles|public|e2e|__tests__|tests|types|messages|locales)\//i,
  /^apps\/mobile\/(app|components|lib|hooks|assets|locales|constants|theme|__tests__|tests|types)\//i,
  /^apps\/api\/(routers|services|models|schemas|tests)\//i,
  /^docs\/(?!developer-harness-v2\/|staging-previews\/).+\.md$/i,
  /^README\.md$/i,
]
const isOrdinaryPath = (p) => ORDINARY_PATH.some((re) => re.test(p))

const COMPLEXITY_TEXT = /\b(architect(ure|ural)?|redesign|re-?architect|refactor|cross[- ]module|new (feature|module|subsystem|service)|multi[- ]phase|end[- ]to[- ]end|rewrite|overhaul|migrat(e|ion) (from|to))\b/i
/** Text that tries to suppress or sidestep the review/approval process. Recorded and escalating; never obeyed. */
const SUPPRESSION_TEXT = /\b(skip|bypass|disable|ignore|omit|no need for|without|don'?t (need|run|bother with))\b[^.\n]{0,40}\b(security|review|reviewer|approval|approve|hook|polic(y|ies)|contract|guard|gate|human)\b|\bpre-?approved\b|\bauto-?approve\b|\boverride (the )?(policy|contract|review)\b/i
/** Intents whose action class is forbidden: the router refuses to plan them. */
const FORBIDDEN_INTENT = [
  ['merge_pull_request', /\b(merg\w*|land|squash)\b[^.\n]{0,25}(\b(pr|pull request|it|this)\b|#\d+)|\bgh pr merge\b/i],
  ['enable_auto_merge', /\bauto[- ]?merge\b[^.\n]{0,20}\b(enable|turn on|set up)|\b(enable|turn on|set up)\b[^.\n]{0,20}\bauto[- ]?merge\b/i],
  ['deploy_production', /\b(deploy\w*|ship\w*|releas\w*|push\w*|promot\w*)\b[^.\n]{0,30}\b(to )?(prod\w*|live)\b/i],
  ['dispatch_any_workflow', /\b(dispatch|trigger|run|kick off|re-?run|start)\b[^.\n]{0,40}\b(workflows?|pipeline|ci run|github action)\b|\bgh workflow run\b/i],
  ['dispatch_production_release_or_rollback', /\b(dispatch|trigger|run|kick off|start|perform)\b[^.\n]{0,30}\b(release|rollback)\b/i],
  ['force_push_or_rewrite_reviewed_history', /\bforce[- ]?push\w*|--force\b|--force-with-lease|\bpush\b[^.\n]{0,20}\s-f\b|\brewrite (git )?history\b/i],
  ['push_to_protected_main', /\bpush\b[^.\n]{0,20}\b(directly )?(to )?main\b/i],
  ['activate_customer_agent_execution', /\b(activate|enable|turn on|go live with)\b[^.\n]{0,25}\bcustomer agents?\b/i],
  ['enable_customer_agent_billing', /\b(enable|turn on|activate)\b[^.\n]{0,20}\b(customer )?agent billing\b/i],
  ['apply_migration_to_staging_or_production', /\bapply\b[^.\n]{0,20}\bmigrations?\b[^.\n]{0,20}\b(staging|production|prod)\b/i],
  ['read_production_or_publisher_credentials', /\b(read|print|show|dump|cat|exfiltrate)\b[^.\n]{0,25}\b(prod(uction)?|publisher)\b[^.\n]{0,15}\b(secrets?|credentials?|keys?|tokens?)\b/i],
]
/** Task-authorized side effects a human may list in `authorize`. */
const SIDE_EFFECTS = { push: 'push_dedicated_branch_fast_forward', open_draft_pr: 'open_draft_pull_request', comment_on_pr: 'interact_with_pull_request_or_issue' }
const AUTHORITY_KEYS = /^(approved|approval|approvals|authorized|authorised|roles?|tools?|permissions?|grant|skip|skip_[a-z_]+|override|bypass|risk|security_review|model|allow|unlock)$/i

const splitCamel = (f) => f.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
const pathHit = (re, f) => re.test(f) || re.test(splitCamel(f))
/** Normalize to a repo-relative posix path; null when absolute, drive-qualified, home-relative or escaping the repository. */
function normPath(p) {
  const s = String(p).replace(/\\/g, '/').trim()
  if (!s || /^([a-z]:|\/|~)/i.test(s) || s.includes('\0')) return null
  const n = path.posix.normalize(s).replace(/^\.\//, '')
  return n === '..' || n.startsWith('../') || n === '.' ? null : n
}
const MODIFICATIONS = ['add', 'edit', 'delete', 'rename', 'config', 'dependency', 'migration', 'docs', 'style', 'architecture']
const uniq = (a) => [...new Set(a)]

function matchTriggers(task, files, modification, labels) {
  const hits = []
  for (const trig of SECURITY_TRIGGERS) {
    const pathHits = files.filter((f) => pathHit(trig.paths, f))
    const textHit = trig.text.test(task) || labels.some((l) => trig.text.test(l))
    if (pathHits.length || textHit) hits.push({ id: trig.id, label: trig.label, category: trig.category, via: [pathHits.length ? 'path' : null, textHit ? 'task_text' : null].filter(Boolean), paths: pathHits.slice(0, 5) })
  }
  const unknown = files.filter((f) => !isOrdinaryPath(f) && !SECURITY_TRIGGERS.some((t) => pathHit(t.paths, f)))
  if (unknown.length) hits.push({ id: 'SEC.UNKNOWN_SCOPE', label: 'Change that could affect protected infrastructure (path outside ordinary product directories)', category: 'security', via: ['path'], paths: unknown.slice(0, 5) })
  if (['migration', 'config', 'dependency'].includes(modification) && !hits.some((h) => h.id === 'SEC.MIGRATIONS' || h.id === 'SEC.UNKNOWN_SCOPE')) {
    hits.push({ id: 'SEC.UNKNOWN_SCOPE', label: `Modification type "${modification}" can change infrastructure behavior`, category: 'security', via: ['modification'], paths: [] })
  }
  return hits
}

function protectedFindings(files, modification, contract) {
  const out = []
  const globs = contract.protected_paths.map((g) => ({ g, re: globToRegExp(g) }))
  const approvals = []
  const stops = []
  for (const f of files) {
    const hit = globs.find(({ re }) => re.test(f))
    const instr = /^(\.claude\/|\.wolf\/hooks\/|\.mcp\.json$|(.*\/)?(CLAUDE|AGENTS)\.md$)/i.test(f)
    if (/^supabase\/migrations\//i.test(f)) {
      if (modification === 'add') approvals.push({ action: 'author_new_forward_only_migration', class: contract.actions.author_new_forward_only_migration, path: f })
      else stops.push({ code: 'STOP.EXISTING_MIGRATION', action: 'modify_existing_migration', class: contract.actions.modify_existing_migration, path: f, message: 'Existing migrations are immutable; only a new forward-only migration may be authored.' })
    } else if (hit) {
      const action = instr ? 'modify_agent_instructions_or_hooks' : 'modify_control_plane_files'
      approvals.push({ action, class: contract.actions[action], path: f, matched: hit.g })
    }
    out.push(f)
  }
  if (modification === 'dependency') approvals.push({ action: 'install_or_upgrade_dependencies', class: contract.actions.install_or_upgrade_dependencies, path: null })
  return { approvals, stops }
}

function pickCategory({ task, files, surface, triggers }) {
  const textCategory = routePackCategory({ task, files })
  if (surface && CATEGORIES.includes(surface)) return surface
  // The strongest trigger decides the pack; precedence mirrors how much control-plane authority it touches.
  for (const cat of ['developer-harness', 'ci-release', 'security', 'database']) if (triggers.some((t) => t.category === cat)) return cat
  return textCategory
}

/**
 * @param {object} input { task, files?, surface?, modification?, authorize?, labels?, metadata?, observations?, availableModels?, contract? }
 *   `authorize` is the list of task-authorized side effects the HUMAN named; `observations` is untrusted text from
 *   files, tool output, PR bodies or other agents and can never change the decision.
 */
export function planRouting(input = {}) {
  const pinned = loadContract(path.join(DEFAULT_REPO, 'docs/developer-harness-v2/contract.json'))
  // A caller-supplied contract is accepted only if it is identical to the repository's on every field the router uses.
  if (input.contract && JSON.stringify([input.contract.roles, input.contract.actions, input.contract.protected_paths, input.contract.topology]) !== JSON.stringify([pinned.roles, pinned.actions, pinned.protected_paths, pinned.topology])) {
    throw new Error('router: supplied contract differs from docs/developer-harness-v2/contract.json')
  }
  const contract = pinned
  const task = String(input.task ?? '')
  const rawFiles = (input.files ?? []).map((f) => ({ raw: String(f), n: normPath(f) }))
  const invalidPaths = rawFiles.filter((f) => f.n === null).map((f) => f.raw.slice(0, 80))
  const files = uniq(rawFiles.map((f) => f.n).filter((n) => n !== null)).sort()
  const modification = String(input.modification ?? 'edit').toLowerCase()
  const labels = (input.labels ?? []).map(String)
  const reasons = []
  const ignored = []

  for (const k of Object.keys(input.metadata ?? {})) if (AUTHORITY_KEYS.test(k)) ignored.push({ field: `metadata.${k}`, reason: 'INPUT.AUTHORITY_IGNORED' })
  const observations = input.observations ?? []

  const stops = []
  const approvals = []
  if (invalidPaths.length) stops.push({ code: 'STOP.INVALID_PATH', message: 'Absolute, home-relative or repository-escaping paths cannot be routed; supply repo-relative paths.', paths: invalidPaths })
  if (!MODIFICATIONS.includes(modification)) stops.push({ code: 'STOP.UNKNOWN_MODIFICATION', message: `Unknown modification type; use one of ${MODIFICATIONS.join(', ')}.` })
  if (['rename', 'delete'].includes(modification) && modification === 'rename' && files.length < 2) stops.push({ code: 'STOP.INCOMPLETE_RENAME', message: 'A rename must list both the old and the new path (use git diff --name-status --no-renames).' })
  const suppression = SUPPRESSION_TEXT.test(task) || labels.some((l) => SUPPRESSION_TEXT.test(l))
  if (suppression) reasons.push('INPUT.SUPPRESSION_ATTEMPT_IGNORED')

  // Forbidden intents are never planned.
  for (const [action, re] of FORBIDDEN_INTENT) {
    if (re.test(task) || labels.some((l) => re.test(l))) stops.push({ code: 'STOP.FORBIDDEN_ACTION', action, class: contract.actions[action], message: 'No developer-harness role may perform this under any approval; a human does it through the trusted workflow.' })
  }
  // Task-authorized side effects must be named by the human.
  const authorized = new Set((input.authorize ?? []).map((a) => SIDE_EFFECTS[a]).filter(Boolean))
  for (const a of input.authorize ?? []) if (!SIDE_EFFECTS[a]) ignored.push({ field: `authorize.${String(a).slice(0, 40)}`, reason: 'INPUT.UNKNOWN_SIDE_EFFECT' })

  const triggers = matchTriggers(task, files, modification, labels)
  const prot = protectedFindings(files, modification, contract)
  approvals.push(...prot.approvals)
  stops.push(...prot.stops)
  for (const t of triggers) reasons.push(t.id)
  if (prot.approvals.length) reasons.push('PATH.PROTECTED_REQUIRES_HUMAN_APPROVAL')

  // ── Scope clarity: without a surface, files or a recognizable task, no implementer is granted. ──
  const inferred = routePackCategory({ task, files })
  const scopeKnown = files.length > 0 || invalidPaths.length > 0 || Boolean(input.surface) || inferred !== 'general' || triggers.length > 0
  const ambiguous = !scopeKnown
  if (ambiguous) reasons.push('SCOPE.AMBIGUOUS')

  const highRisk = triggers.length > 0
  const areas = uniq(files.map((f) => f.split('/').slice(0, 2).join('/')))
  const complex = files.length >= 8 || areas.length >= 3 || modification === 'architecture' || COMPLEXITY_TEXT.test(task) || input.metadata?.complexity === 'high'
  const needsPlannerRequired = triggers.some((t) => ['SEC.MIGRATIONS', 'SEC.RLS_TENANT', 'SEC.CUSTOMER_AGENT_HARNESS'].includes(t.id)) || triggers.length >= 3 || (highRisk && complex)
  if (complex) reasons.push('COMPLEXITY.PLANNING_JUSTIFIED')

  const category = pickCategory({ task, files, surface: input.surface, triggers })
  const risk = ambiguous ? 'unknown' : highRisk ? 'high' : complex || prot.approvals.length || suppression ? 'elevated' : 'low'

  const model = (role) => contract.roles[role].model
  const required = []
  const optional = []
  const add = (list, role, why, codes) => list.push({ role, model: model(role), writes_code: contract.roles[role].writes_code, may_perform: [...contract.roles[role].may_perform], justification: why, reason_codes: codes })

  if (!ambiguous && stops.length === 0) {
    if (needsPlannerRequired) add(required, 'planner', 'High-risk or multi-trigger change needs a scoped plan before any write.', ['PLAN.REQUIRED_HIGH_RISK'])
    else if (complex) add(required, 'planner', 'Nontrivial or cross-module change: plan before implementing.', ['COMPLEXITY.PLANNING_JUSTIFIED'])
    else if (highRisk) add(optional, 'planner', 'Optional: a single security trigger on a small change; the coordinator may record a reason to plan first.', ['PLAN.OPTIONAL_HIGH_RISK'])
    add(required, 'implementer', 'Exactly one write-capable role makes the authorized change in the task worktree.', ['ROLE.DEFAULT_IMPLEMENTER'])
    add(required, 'independent_reviewer', 'Independent review of the final diff is part of every workflow.', ['ROLE.DEFAULT_REVIEWER'])
    if (highRisk) add(required, 'security_reviewer', `Mandatory security review: ${triggers.map((t) => t.id).join(', ')}.`, ['REVIEW.SECURITY_MANDATORY'])
    if (files.some((f) => /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)tests?\//i.test(f)) || files.length >= 10) {
      add(optional, 'test_coordinator', 'Optional: many files or test files changed; a test plan helps. Deterministic selection belongs to Phase 6.', ['TEST.OPTIONAL'])
    }
    if (input.metadata?.summarize_context === true) add(optional, 'context_manager', 'Optional: the human explicitly asked for summarization of source material.', ['CONTEXT.SUMMARY_REQUESTED'])
  }

  // Model availability: never substitute silently.
  if (Array.isArray(input.availableModels)) {
    for (const r of required) if (!input.availableModels.includes(r.model)) stops.push({ code: 'STOP.MODEL_UNAVAILABLE', role: r.role, model: r.model, message: `Required model ${r.model} is not available; an explicit, human-approved alternative is needed. No substitution was made.` })
  }
  if (ambiguous) stops.push({ code: 'STOP.AMBIGUOUS_SCOPE', message: 'The task names no surface, files or recognizable scope. Ask the human; no role receives implicit permission.' })

  // Side effects: only the ones the human named, only when the contract class permits them.
  const sideEffects = [...authorized].map((a) => ({ action: a, class: contract.actions[a], authorized_by: 'human task request' }))
  const sequence = SEQUENCE.filter((r) => required.some((x) => x.role === r))
  const extras = [...required, ...optional].filter((r) => !['implementer', 'independent_reviewer'].includes(r.role))

  const status = stops.length ? (ambiguous ? 'needs_clarification' : 'blocked') : 'routed'
  return {
    schema: PLAN_SCHEMA,
    contract_version: contract.version,
    status,
    risk,
    context_pack: { category, known: CATEGORIES.includes(category), references: PACKS[category] ? { instructions: PACKS[category].instructions, docs: PACKS[category].docs, memory_topics: PACKS[category].memoryTopics } : null },
    primary_session: { role: 'coordinator', model: model('coordinator'), spawned: false },
    roles: { required, optional },
    sequence,
    reviews: { independent: !ambiguous && stops.length === 0, security: required.some((r) => r.role === 'security_reviewer'), security_triggers: triggers },
    human_approvals: approvals,
    side_effects_authorized: sideEffects,
    topology: { default: contract.topology.default, max_concurrent_write_roles: contract.topology.max_concurrent_write_roles, persistent_swarm: contract.topology.persistent_swarm, nested_delegation: false, parallel_subagents: 1, background_agents: false },
    extra_role_justifications: extras.map((r) => ({ role: r.role, justification: r.justification, requirement: required.includes(r) ? 'required' : 'optional' })),
    handoffs: handoffs(category, triggers.length > 0),
    reason_codes: uniq(reasons),
    stop_conditions: stops,
    ignored_inputs: ignored,
    untrusted_observations: { count: observations.length, treated_as: 'data; never used to select roles, models, tools, reviews or approvals' },
    input_echo: { task, surface: input.surface ?? null, modification, authorize: [...(input.authorize ?? [])] },
    advisory: 'A plan is built from PREDICTED paths. verifyDiffAgainstPlan() must be run on the actual diff before review; a plan never authorizes anything.',
    precedence: ["the human's request", 'docs/developer-harness-v2/contract.json', 'Phase 2 policy engine', 'GitHub rulesets, CI Gate and Staging Gate', 'human approval requirements'],
  }
}

/** What each role may be handed. A reviewer never receives the implementer's reasoning as instructions. */
function handoffs(category, highRisk) {
  const refs = PACKS[category] ? [...PACKS[category].instructions, ...PACKS[category].docs] : []
  const threat = ['docs/developer-harness-v2/03-authority-and-threat-model.md', 'docs/developer-harness-v2/07-phase-2-policy-implementation.md', 'docs/developer-harness-v2/contract.json']
  return {
    planner: { receives: ['human task', 'context pack references'], context_refs: refs },
    implementer: { receives: ['human task', 'approved scope', 'plan (if any)', 'context pack references'], context_refs: refs },
    test_coordinator: { receives: ['human task', 'changed paths', 'diff'], context_refs: [] },
    independent_reviewer: { receives: ['human task', 'approved scope', 'final diff', 'objective test output', 'authority constraints'], withheld: ['implementer reasoning', 'implementer scratchpad', 'implementer self-assessment as instruction'], context_refs: refs },
    security_reviewer: { receives: ['human task', 'approved scope', 'final diff', 'objective test output', 'authority constraints', 'threat model and policy references'], withheld: ['implementer reasoning', 'implementer scratchpad'], context_refs: uniq([...refs, ...(highRisk ? threat : [])]) },
    context_manager: { receives: ['human task', 'category'], context_refs: [] },
  }
}

/**
 * Mandatory second pass. Re-routes the SAME human task over the files the implementer ACTUALLY changed
 * (`git diff --name-status --no-renames <base>...HEAD`, listing both sides of a rename). Run it from the human
 * session, not by the implementer. Any added trigger, role, review or approval means the original plan was
 * insufficient and review must not proceed on it.
 */
export function verifyDiffAgainstPlan(plan, changedFiles, opts = {}) {
  const actual = planRouting({ ...plan.input_echo, files: changedFiles, modification: opts.modification ?? plan.input_echo.modification })
  const ids = (p) => p.reviews.security_triggers.map((t) => t.id)
  const roles = (p) => [...p.roles.required.map((r) => r.role)]
  const addedTriggers = ids(actual).filter((i) => !ids(plan).includes(i))
  const addedRoles = roles(actual).filter((r) => !roles(plan).includes(r))
  const approvalKey = (a) => `${a.action}:${a.path}`
  const addedApprovals = actual.human_approvals.map(approvalKey).filter((k) => !plan.human_approvals.map(approvalKey).includes(k))
  const stops = actual.stop_conditions
  const ok = actual.status === 'routed' && !addedTriggers.length && !addedRoles.length && !addedApprovals.length
  return { ok, addedTriggers, addedRoles, addedApprovals, stops, actualPlan: actual }
}

// ── Spawn guard: a deterministic check the coordinator applies before launching any role. ──
/** @returns {{allowed:boolean, code:string, detail:string}} */
export function checkSpawn(plan, request, state = { active: [], spawned: [] }) {
  const deny = (code, detail) => ({ allowed: false, code, detail })
  if (!plan || plan.schema !== PLAN_SCHEMA) return deny('SPAWN.NO_PLAN', 'no routing plan')
  if (plan.status !== 'routed') return deny('SPAWN.PLAN_NOT_ROUTED', `plan status is ${plan.status}`)
  if (request?.requestedBy && request.requestedBy !== 'coordinator') return deny('SPAWN.NOT_COORDINATOR', 'only the coordinator may launch roles; a subagent cannot delegate')
  if (request?.nested || request?.parent) return deny('SPAWN.NESTED', 'recursive delegation is not permitted')
  if (request?.background === true) return deny('SPAWN.BACKGROUND', 'background agents are not permitted')
  if (request?.viaShell) return deny('SPAWN.VIA_SHELL', 'launching claude through a shell, claude -p, another CLI or an MCP tool is a nested session and is never a role launch')
  const entry = [...plan.roles.required, ...plan.roles.optional].find((r) => r.role === request?.role)
  if (!entry) return deny('SPAWN.ROLE_NOT_IN_PLAN', `role ${String(request?.role)} is not in the plan`)
  if (plan.roles.optional.includes(entry) && !request?.justification) return deny('SPAWN.JUSTIFICATION_REQUIRED', 'an optional role needs a recorded justification')
  if (request?.tools || request?.model || request?.permissions) return deny('SPAWN.OVERRIDE', 'tools, model and permissions come from the role definition and the contract; they cannot be overridden at launch')
  if (state.active.length >= plan.topology.parallel_subagents) return deny('SPAWN.CONCURRENCY', 'at most one subagent is active at a time')
  if (entry.writes_code && state.active.some((a) => a.writes_code)) return deny('SPAWN.SECOND_WRITER', 'at most one write-capable role per task')
  if (state.spawned.filter((r) => r === entry.role).length >= 1) return deny('SPAWN.REPEAT', 'a role is launched once per plan; a re-run needs a new plan')
  return { allowed: true, code: 'SPAWN.OK', detail: `${entry.role} (${entry.model})` }
}

/** A review result is evidence, never authorization. A blocking security finding is closed only by remediation or a human. */
export function evaluateFinding(finding, resolution = null) {
  const blocking = ['critical', 'high'].includes(String(finding?.severity).toLowerCase())
  const authorizes = false
  if (!blocking) return { authorizes, blocking, open: false }
  const ok = resolution && (resolution.kind === 'remediated_and_rereviewed' || (resolution.kind === 'human_decision' && resolution.by === 'human'))
  return { authorizes, blocking, open: !ok, dismissible_by: ['human'] }
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const k = a.slice(2)
    const v = argv[i + 1]
    i++
    if (k === 'task') o.task = v
    else if (k === 'files') o.files = v.split(',').filter(Boolean)
    else if (k === 'surface') o.surface = v
    else if (k === 'modification') o.modification = v
    else if (k === 'authorize') o.authorize = v.split(',').filter(Boolean)
    else if (k === 'models') o.availableModels = v.split(',').filter(Boolean)
    else if (k === 'diff-base') o.diffBase = v
  }
  return o
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  const contract = loadContract(path.join(args.repo ?? DEFAULT_REPO, 'docs/developer-harness-v2/contract.json'))
  process.stdout.write(`${JSON.stringify(planRouting({ ...args, contract }), null, 2)}\n`)
}
