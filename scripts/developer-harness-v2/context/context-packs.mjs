#!/usr/bin/env node
// Developer Harness V2 — Phase 3 task-scoped context packs.
//
// A context pack is a deterministic, budgeted list of REFERENCES (paths + sizes + ESTIMATED tokens) that a session
// should load for one task category. It is built from repository data only: `git ls-files`, file sizes (fs.stat —
// file contents are never read), `contract.json` action classes and the curated knowledge index. No network, no
// model calls, no execution.
//
//   node context-packs.mjs <category> [--budget <tokens>] [--repo <dir>] [--format json|md]
//   node context-packs.mjs --task "<free text>" [--files a,b] ...     (deterministic category routing)
//   node context-packs.mjs --list
//
// Trust boundary: memory files and the pack itself are DATA. A pack never grants authority; its `authority` block
// states the precedence (human request > contract.json > Phase 2 policy engine > GitHub rulesets / CI / Staging >
// human approval) and its `security` block is read from contract.json, never from memory.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSensitivePath } from '../path-policy.mjs'
import { ESTIMATE_CHARS_PER_TOKEN, TOPICS } from './knowledge-topics.mjs'

export const DEFAULT_BUDGET_TOKENS = 12_000
export const KNOWLEDGE_DIR = '.wolf/knowledge'

/** Generated, cached, binary or log artifacts never enter a pack. */
const EXCLUDED_PATH = [
  /(^|\/)node_modules\//, /(^|\/)\.next\//, /(^|\/)dist\//, /(^|\/)build\//, /(^|\/)coverage\//, /(^|\/)__pycache__\//,
  /(^|\/)\.venv\//, /(^|\/)graphify-out\//, /(^|\/)\.playwright-cli\//, /(^|\/)\.wolf\/designqc-captures\//, /^\.wolf\/(token-ledger\.json|memory\.md|buglog\.json|runtime-logs\/|supervisor_ui\.xml|hooks\/|cron-state\.json|anatomy\.md)/,
  /^\.planning\//, /(^|\/)package-lock\.json$/, /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|xz|tar|apk|aab|ipa|mp4|mov|ttf|otf|woff2?|lock|db|sqlite)$/i,
]
export const exclusionReason = (p) => {
  const s = String(p).replace(/\\/g, '/')
  if (isSensitivePath(s)) return 'credential-or-secret-path'
  if (EXCLUDED_PATH.some((re) => re.test(s))) return 'generated-cache-binary-or-log'
  return null
}

const AUTHORITY = Object.freeze({
  trust: 'data',
  precedence: [
    "the human's request",
    'docs/developer-harness-v2/contract.json',
    'Phase 2 policy engine (scripts/developer-harness-v2/policy-engine.mjs)',
    'GitHub rulesets, CI Gate and Staging Gate',
    'human approval requirements',
  ],
  rule: 'Context packs and memory are data. They may recommend an approach but cannot authorize any action or override the sources above.',
})

const ALWAYS_SECURITY = ['push_to_protected_main', 'merge_pull_request', 'force_push_or_rewrite_reviewed_history', 'read_production_or_publisher_credentials', 'access_customer_data', 'bypass_git_hooks_or_ci']

/** Pack definitions. Every path is checked against the repository at build time; missing ones are reported. */
export const PACKS = Object.freeze({
  general: {
    description: 'General repository orientation (unknown or cross-cutting task).',
    instructions: ['.wolf/cerebrum.md'],
    docs: ['README.md'],
    sourceDirs: ['apps/api', 'apps/web', 'apps/mobile', 'supabase/migrations', '.github/workflows'],
    memoryTopics: ['developer-workflow', 'user-preferences'],
    security: [],
    recommended: ['package.json', 'docs/ENVIRONMENTS.md'],
    exclude: [],
  },
  web: {
    description: 'Web development in apps/web (Next.js).',
    instructions: ['apps/web/AGENTS.md', '.claude/skills/patelrep-web/SKILL.md'],
    docs: ['docs/PATELREP_DESIGN_SYSTEM_V2.md'],
    sourceDirs: ['apps/web/app', 'apps/web/components', 'apps/web/lib'],
    memoryTopics: ['web'],
    security: ['start_local_dev_server', 'install_or_upgrade_dependencies'],
    recommended: ['apps/web/package.json'],
    exclude: ['apps/mobile/', 'apps/api/', 'supabase/migrations/'],
  },
  mobile: {
    description: 'Mobile development in apps/mobile (Expo / React Native).',
    instructions: ['.claude/skills/patelrep-mobile/SKILL.md'],
    docs: [],
    sourceDirs: ['apps/mobile/app', 'apps/mobile/components', 'apps/mobile/lib'],
    memoryTopics: ['mobile'],
    security: ['publish_mobile_build_or_ota_update', 'install_or_upgrade_dependencies', 'start_local_dev_server'],
    recommended: ['apps/mobile/package.json', 'apps/mobile/app.json'],
    exclude: ['apps/web/', 'apps/api/', 'supabase/migrations/'],
  },
  api: {
    description: 'API development in apps/api (FastAPI + Supabase SDK).',
    instructions: ['.claude/skills/patelrep-api/SKILL.md'],
    docs: [],
    sourceDirs: ['apps/api/routers', 'apps/api/services', 'apps/api/core', 'apps/api/tests'],
    memoryTopics: ['api-supabase'],
    security: ['start_local_dev_server', 'install_or_upgrade_dependencies', 'read_remote_production_state'],
    recommended: ['apps/api/main.py', 'apps/api/requirements.txt', 'apps/api/RBAC-MATRIX.md'],
    exclude: ['apps/web/', 'apps/mobile/'],
  },
  database: {
    description: 'Database schema and migration work or review (Supabase/Postgres, RLS).',
    instructions: [],
    docs: ['docs/DATABASE_MIGRATIONS.md', 'docs/STAGING_REVIEWED_MIGRATION_PREVIEW.md', 'docs/MIGRATION_INVENTORY.md'],
    sourceDirs: ['supabase/migrations'],
    memoryTopics: ['database-migrations'],
    security: ['author_new_forward_only_migration', 'modify_existing_migration', 'supabase_migration_repair', 'apply_migration_to_staging_or_production', 'run_supabase_cli_against_remote_project', 'run_local_docker_or_database_stack'],
    recommended: ['supabase/staging-reviewed-migrations.json'],
    exclude: ['apps/web/', 'apps/mobile/'],
  },
  'ci-release': {
    description: 'CI, Staging and release infrastructure (control-plane; human approval required to modify).',
    instructions: [],
    docs: ['docs/RELEASE_PROCESS.md', 'docs/AUTONOMOUS_RELEASE_ENGINEER.md', 'docs/ENVIRONMENTS.md', 'docs/developer-harness-v2/03-authority-and-threat-model.md'],
    sourceDirs: ['.github/workflows', 'scripts'],
    memoryTopics: ['ci-staging-release'],
    security: ['modify_control_plane_files', 'dispatch_any_workflow', 'dispatch_production_release_or_rollback', 'deploy_production', 'deploy_or_mutate_staging_directly', 'change_repository_rulesets_secrets_environments_or_permissions', 'create_alternate_publishing_or_deployment_path'],
    recommended: ['docs/PRODUCTION_RUNBOOK.md'],
    exclude: ['apps/web/', 'apps/mobile/'],
  },
  security: {
    description: 'Security-sensitive engineering (auth, RLS, credentials, customer Agent Harness, control plane).',
    instructions: [],
    docs: ['docs/developer-harness-v2/03-authority-and-threat-model.md', 'docs/developer-harness-v2/02-architecture-contract.md', 'docs/developer-harness-v2/07-phase-2-policy-implementation.md', 'docs/agent-harness/adr-0006-h7-bounded-autonomy.md'],
    sourceDirs: ['apps/api/middleware', 'apps/api/core', 'supabase/migrations'],
    memoryTopics: ['database-migrations', 'agent-harness'],
    security: ['read_production_or_publisher_credentials', 'edit_credential_file', 'activate_customer_agent_execution', 'grant_customer_agent_autonomy_or_decide_v2', 'enable_customer_agent_billing', 'modify_agent_instructions_or_hooks', 'modify_control_plane_files'],
    recommended: ['docs/developer-harness-v2/contract.json'],
    exclude: ['apps/web/', 'apps/mobile/'],
  },
  'developer-harness': {
    description: 'Developer Harness V2 itself (policy engine, context packs, curated memory).',
    instructions: ['.wolf/cerebrum.md'],
    docs: ['docs/developer-harness-v2/02-architecture-contract.md', 'docs/developer-harness-v2/03-authority-and-threat-model.md', 'docs/developer-harness-v2/04-phase-roadmap-and-acceptance.md', 'docs/developer-harness-v2/08-phase-3-context-and-memory-report.md'],
    sourceDirs: ['scripts/developer-harness-v2', '.claude/hooks'],
    memoryTopics: ['developer-workflow'],
    security: ['modify_agent_instructions_or_hooks', 'modify_control_plane_files', 'launch_nested_agent_session'],
    recommended: ['docs/developer-harness-v2/contract.json', '.claude/settings.json'],
    exclude: ['apps/'],
  },
})

export const CATEGORIES = Object.freeze(Object.keys(PACKS))

/** Deterministic routing from free text and/or changed paths to a category (ties: earlier in ROUTE order). */
const ROUTE = [
  ['security', /\b(security|secret|credential|auth(entication|orization)?|rls|privilege|grant|jwt|tenant isolation|agent harness|decide_v2|autonomy)\b/i, /^(apps\/api\/(middleware|core)\/|docs\/agent-harness\/)/],
  ['developer-harness', /\b(developer harness|policy engine|context pack|openwolf|cerebrum|claude\.md|hook)s?\b/i, /^(scripts\/developer-harness-v2\/|docs\/developer-harness-v2\/|\.claude\/|\.wolf\/)/],
  ['ci-release', /\b(ci|ci gate|staging|workflow|github actions|release|deploy|rollback|pipeline)\b/i, /^(\.github\/|scripts\/(?!developer-harness-v2))/],
  ['database', /\b(migration|schema|sql|postgres|supabase migration|index|trigger|rpc)s?\b/i, /^supabase\//],
  ['mobile', /\b(mobile|expo|react native|ios|android|phone|screen)\b/i, /^apps\/mobile\//],
  ['web', /\b(web|next\.?js|page|dashboard|browser|ui bug|component)\b/i, /^apps\/web\//],
  ['api', /\b(api|endpoint|fastapi|router|pydantic|validation|pytest)\b/i, /^apps\/api\//],
]
export function routeTask({ task = '', files = [] } = {}) {
  let best = 'general'
  let bestScore = 0
  for (const [cat, textRe, pathRe] of ROUTE) {
    const g = new RegExp(textRe.source, 'gi')
    const score = (String(task).match(g)?.length ?? 0) + files.filter((f) => pathRe.test(String(f).replace(/\\/g, '/'))).length * 2
    if (score > bestScore) { best = cat; bestScore = score }
  }
  return best
}

const est = (bytes) => Math.ceil(bytes / ESTIMATE_CHARS_PER_TOKEN)

function repoFacts(root) {
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean)
  let head = null
  try { head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString().trim() } catch { head = null }
  return { files, head }
}

/** Size of a single file reference, or a reason it cannot be included. Never reads content. */
function fileRef(root, rel, tracked) {
  const reason = exclusionReason(rel)
  if (reason) return { path: rel, excluded: reason }
  const abs = path.join(root, ...rel.split('/'))
  if (!tracked.has(rel) || !existsSync(abs)) return { path: rel, missing: true }
  const bytes = statSync(abs).size
  return { path: rel, bytes, est_tokens: est(bytes) }
}

function dirSummary(root, dir, trackedList) {
  const prefix = `${dir.replace(/\/$/, '')}/`
  const members = trackedList.filter((f) => f.startsWith(prefix) && !exclusionReason(f))
  if (!members.length) return { path: dir, missing: true }
  let bytes = 0
  for (const f of members) { try { bytes += statSync(path.join(root, ...f.split('/'))).size } catch { /* deleted in worktree */ } }
  return { path: dir, tracked_files: members.length, bytes, est_tokens_if_fully_loaded: est(bytes), load: 'search-on-demand' }
}

function knowledgeFiles(root, topic, suffix) {
  const t = TOPICS.find((x) => x.id === topic)
  if (!t) return []
  const stem = t.file.replace(/\.md$/, '')
  const dir = path.join(root, ...KNOWLEDGE_DIR.split('/'))
  if (!existsSync(dir)) return []
  const re = new RegExp(`^${stem.replace(/[-.]/g, '\\$&')}${suffix.replace('.', '\\.')}(-\\d+)?\\.md$`)
  return execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', KNOWLEDGE_DIR], { maxBuffer: 1 << 24 }).toString('utf8').split('\n').filter(Boolean)
    .map((f) => f.slice(KNOWLEDGE_DIR.length + 1)).filter((f) => re.test(f) && existsSync(path.join(dir, f))).sort().map((f) => `${KNOWLEDGE_DIR}/${f}`)
}

/**
 * Instructions Claude Code loads automatically in every session (root CLAUDE.md, its `@` imports, project rules).
 * Reported separately from the task budget because a pack cannot avoid them.
 */
export function baselineRefs(root, tracked) {
  const refs = [{ ...fileRef(root, 'CLAUDE.md', tracked), role: 'auto-loaded' }]
  if (!refs[0].missing && !refs[0].excluded) {
    const text = readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')
    for (const m of text.matchAll(/^@(\S+)\s*$/gm)) {
      const rel = path.posix.normalize(m[1].replace(/\\/g, '/'))
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) refs.push({ ...fileRef(root, rel, tracked), role: 'auto-loaded (CLAUDE.md import)' })
    }
  }
  for (const f of [...tracked].filter((p) => /^\.claude\/rules\/[^/]+\.md$/.test(p)).sort()) refs.push({ ...fileRef(root, f, tracked), role: 'auto-loaded (project rule)' })
  return refs
}

function loadContractActions(root) {
  const file = path.join(root, 'docs', 'developer-harness-v2', 'contract.json')
  return JSON.parse(readFileSync(file, 'utf8')).actions
}

/**
 * Builds a pack. Required items (instructions, Do-Not-Repeat memory) always appear; if they alone exceed the budget the
 * pack says so (`fits: false`) instead of silently dropping them. Optional items that do not fit are listed as deferred.
 */
export function buildContextPack({ root, category, budgetTokens = DEFAULT_BUDGET_TOKENS, facts = null }) {
  if (!PACKS[category]) throw new Error(`unknown category "${category}" (known: ${CATEGORIES.join(', ')})`)
  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) throw new Error('budget must be a positive number of tokens')
  const def = PACKS[category]
  const { files, head } = facts ?? repoFacts(root)
  const tracked = new Set(files)
  const actions = loadContractActions(root)

  const required = [
    ...def.instructions.map((p) => ({ ...fileRef(root, p, tracked), role: 'instruction' })),
    ...def.memoryTopics.flatMap((t) => (t === 'user-preferences' ? knowledgeFiles(root, t, '') : knowledgeFiles(root, t, '.dnr')))
      .map((p) => ({ ...fileRef(root, p, tracked), role: 'memory-do-not-repeat', trust: 'data' })),
  ]
  const optional = [
    ...def.docs.map((p) => ({ ...fileRef(root, p, tracked), role: 'architecture-doc' })),
    ...def.memoryTopics.filter((t) => t !== 'user-preferences').flatMap((t) => knowledgeFiles(root, t, ''))
      .map((p) => ({ ...fileRef(root, p, tracked), role: 'memory-conventions', trust: 'data' })),
    ...def.recommended.map((p) => ({ ...fileRef(root, p, tracked), role: 'recommended' })),
    ...def.memoryTopics.filter((t) => t !== 'user-preferences').flatMap((t) => knowledgeFiles(root, t, '.history'))
      .map((p) => ({ ...fileRef(root, p, tracked), role: 'memory-history', trust: 'data' })),
  ]
  const problems = [...required, ...optional].filter((r) => r.missing || r.excluded)
  const usable = (list) => list.filter((r) => !r.missing && !r.excluded)
  const req = usable(required)
  const reqTokens = req.reduce((n, r) => n + r.est_tokens, 0)
  const load = [...req]
  const deferred = []
  let used = reqTokens
  for (const r of usable(optional)) {
    if (r.role === 'memory-history') deferred.push({ ...r, reason: 'historical record; load on demand' })
    else if (used + r.est_tokens <= budgetTokens) { load.push(r); used += r.est_tokens } else deferred.push({ ...r, reason: 'over budget' })
  }
  const fits = reqTokens <= budgetTokens
  const baseline = baselineRefs(root, tracked)
  return {
    kind: 'developer-harness-v2/context-pack',
    version: 1,
    category,
    description: def.description,
    repository_head: head,
    baseline: { note: 'Loaded automatically by Claude Code in every session; outside the task budget.', files: baseline, est_tokens: baseline.reduce((n, r) => n + (r.est_tokens ?? 0), 0) },
    budget: { tokens: budgetTokens, used_tokens: used, required_tokens: reqTokens, unit: 'ESTIMATED tokens (bytes ÷ 3.5; not a tokenizer measurement)' },
    fits,
    explanation: fits ? null : `Required instructions and Do-Not-Repeat memory need ~${reqTokens} ESTIMATED tokens, above the ${budgetTokens}-token budget. Raise --budget or load the listed files selectively; nothing required was dropped.`,
    authority: AUTHORITY,
    load,
    deferred,
    source_directories: def.sourceDirs.map((d) => dirSummary(root, d, files)),
    excluded_scopes: [...def.exclude].sort(),
    security: [...new Set([...ALWAYS_SECURITY, ...def.security])].sort().map((a) => ({ action: a, class: actions[a] ?? 'UNKNOWN_ACTION' })),
    problems: problems.map((p) => ({ path: p.path, issue: p.missing ? 'missing' : `excluded: ${p.excluded}` })),
    fallback: 'If a needed file is not listed, use ordinary repository search (rg / Glob); the pack is a starting point, not complete coverage.',
  }
}

export function renderMarkdown(pack) {
  const line = (r) => `- \`${r.path}\` — ${r.role}${r.trust ? ' (data)' : ''}, ~${r.est_tokens} tok est.`
  return [
    `# Context pack: ${pack.category}`,
    '',
    pack.description,
    '',
    `Head \`${pack.repository_head?.slice(0, 12) ?? 'unknown'}\` · budget ${pack.budget.tokens} · used ${pack.budget.used_tokens} (${pack.budget.unit})${pack.fits ? '' : ' · **DOES NOT FIT**'}`,
    pack.explanation ? `\n> ${pack.explanation}` : '',
    '',
    '## Load', '', ...pack.load.map(line), '',
    '## Deferred (load on demand)', '', ...(pack.deferred.length ? pack.deferred.map(line) : ['- none']), '',
    '## Source directories (search, do not bulk-load)', '', ...pack.source_directories.map((d) => (d.missing ? `- \`${d.path}\` — missing` : `- \`${d.path}\` — ${d.tracked_files} files`)), '',
    '## Out of scope unless the task requires it', '', ...(pack.excluded_scopes.length ? pack.excluded_scopes.map((e) => `- \`${e}\``) : ['- none']), '',
    '## Security classes (from contract.json)', '', ...pack.security.map((s) => `- \`${s.action}\`: ${s.class}`), '',
    `> ${pack.authority.rule}`,
    '',
  ].join('\n')
}

function parseArgs(argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list') opts.list = true
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i]
    else opts._.push(a)
  }
  return opts
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2))
  const root = path.resolve(opts.repo ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'))
  if (opts.list) {
    for (const c of CATEGORIES) console.log(`${c}\t${PACKS[c].description}`)
  } else {
    const category = opts._[0] ?? routeTask({ task: opts.task ?? '', files: (opts.files ?? '').split(',').filter(Boolean) })
    try {
      const pack = buildContextPack({ root, category, budgetTokens: opts.budget ? Number(opts.budget) : DEFAULT_BUDGET_TOKENS })
      console.log(opts.format === 'md' ? renderMarkdown(pack) : JSON.stringify(pack, null, 2))
      process.exitCode = pack.fits ? 0 : 3
    } catch (e) {
      console.error(e.message)
      process.exitCode = 2
    }
  }
}
