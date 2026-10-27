// Pure policy for the dependency orchestrator: policy validation, manifest/diff parsing, risk
// classification, dependency-aware ordering and the exact-identity merge gate. No I/O.
// Nothing here trusts PR text: updates come from manifest diffs, never from titles or bodies.
import { bumpKind, compareVersions, declaredVersion, satisfies } from './dependency-orchestrator-versions.mjs'

export const SHA_PATTERN = /^[0-9a-f]{40}$/
export const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
export const VERSION_TEXT = /^[0-9][0-9A-Za-z.+_-]{0,63}$/

/** Hard limits: configuration may lower these but can never raise them past a bounded value. */
export const HARD_LIMITS = Object.freeze({
  max_batch_hours: 168,
  max_ticks_per_batch: 500,
  max_branch_updates_per_pr: 3,
  max_repair_requests_per_pr: 2,
  max_staging_dispatches_per_pr: 3,
  max_reverifications_per_pr: 3,
  max_claude_research_invocations: 25,
  max_claude_usd: 100,
  max_merges_per_batch: 10,
})

/** Categories a machine can never merge. `scope: 'major'` applies only to major (or unknown/prerelease) bumps. */
export const NEVER_AUTOMATIC = Object.freeze({
  billing: 'any',
  'auth-security': 'any',
  framework: 'any',
  database: 'any',
  'github-actions': 'any',
  'unexpected-files': 'any',
  sftp: 'major',
  'css-framework': 'major',
  'ai-accounting': 'major',
})

const RISK_ORDER = { low: 0, medium: 1, high: 2 }
const ECOSYSTEM_FOR = (file) =>
  file.endsWith('package.json') || file.endsWith('package-lock.json') ? 'npm'
  : /requirements[\w.-]*\.txt$/.test(file) ? 'pip'
  : file.startsWith('.github/workflows/') ? 'github-actions'
  : null

/** Defaults applied when the policy file omits a limit; always at or below the hard ceiling. */
export const DEFAULT_LIMITS = Object.freeze({
  max_batch_hours: 72,
  max_ticks_per_batch: 200,
  max_branch_updates_per_pr: 2,
  max_repair_requests_per_pr: 1,
  max_staging_dispatches_per_pr: 2,
  max_reverifications_per_pr: 2,
  max_claude_research_invocations: 10,
  max_claude_usd: 25,
  max_merges_per_batch: 3,
})

const bounded = (value, key) => {
  if (value === undefined || value === null) return DEFAULT_LIMITS[key]
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? Math.min(n, HARD_LIMITS[key]) : DEFAULT_LIMITS[key]
}

/** Validates the trusted policy file. Unknown or malformed input fails closed to the safest posture. */
export function normalizePolicy(raw) {
  if (!raw || raw.version !== 1) throw new Error('dependency orchestrator policy: unsupported or missing version')
  const mergeMode = raw.merge?.mode === 'approved-only' ? 'approved-only' : 'prepare-only'
  const scheduleMode = ['off', 'plan-only', 'continue-only', 'process'].includes(raw.schedule?.mode) ? raw.schedule.mode : 'off'
  const limits = Object.fromEntries(Object.keys(HARD_LIMITS).map((key) => [key, bounded(raw.limits?.[key], key)]))
  const approvals = (Array.isArray(raw.merge?.approvals) ? raw.merge.approvals : []).map(normalizeApproval)
  return {
    paused: raw.paused === true,
    mutation_enabled: raw.mutation_enabled === true,
    schedule: { mode: scheduleMode, start_weekday_utc: Number(raw.schedule?.start_weekday_utc ?? 1), start_hour_utc: Number(raw.schedule?.start_hour_utc ?? 9) },
    discovery: {
      authors: [...(raw.discovery?.authors ?? ['dependabot[bot]'])],
      head_prefix: String(raw.discovery?.head_prefix ?? 'dependabot/'),
      allowed_commit_authors: [...(raw.discovery?.allowed_commit_authors ?? ['dependabot[bot]'])],
      max_prs: Math.min(Number(raw.discovery?.max_prs ?? 25), 50),
    },
    limits,
    branch_update: { method: raw.branch_update?.method === 'dependabot-rebase' ? 'dependabot-rebase' : 'api-update-branch' },
    allowed_paths: { npm: [], pip: [], 'github-actions': [], ...(raw.allowed_paths ?? {}) },
    risk: {
      package_categories: raw.risk?.package_categories ?? {},
      major_requires_acknowledgement: raw.risk?.major_requires_acknowledgement !== false,
    },
    known_incompatibilities: Array.isArray(raw.known_incompatibilities) ? raw.known_incompatibilities : [],
    repair: { dispatch_release_engineer: raw.repair?.dispatch_release_engineer === true },
    merge: { mode: mergeMode, approvals },
  }
}

function normalizeApproval(entry) {
  const pr = Number(entry?.pr)
  if (!Number.isInteger(pr) || pr < 1) throw new Error('approval: pr must be a positive integer')
  if (entry.head_sha != null && !SHA_PATTERN.test(entry.head_sha)) throw new Error(`approval #${pr}: head_sha must be 40 hex characters`)
  const updates = (entry.updates ?? []).map((u) => ({ ecosystem: String(u.ecosystem), name: String(u.name), from: String(u.from), to: String(u.to) }))
  if (updates.length === 0) throw new Error(`approval #${pr}: updates must list the exact approved dependency changes`)
  for (const u of updates) if (!PACKAGE_NAME.test(u.name) || !VERSION_TEXT.test(u.from) || !VERSION_TEXT.test(u.to)) throw new Error(`approval #${pr}: invalid update ${u.name}`)
  if (!entry.approved_by || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires_at ?? '')) throw new Error(`approval #${pr}: approved_by and expires_at (YYYY-MM-DD) are required`)
  return { pr, updates, head_sha: entry.head_sha ?? null, acknowledge_major: entry.acknowledge_major === true, approved_by: String(entry.approved_by), expires_at: entry.expires_at }
}

// ── manifest + diff parsing ──────────────────────────────────────────────────────────────

const normalizeName = (ecosystem, name) => (ecosystem === 'pip' ? name.toLowerCase().replace(/[_.]+/g, '-') : name)

/** Declared dependency versions of a manifest at main: Map<"eco:name", version>. */
export function parseManifestVersions(file, content) {
  const ecosystem = ECOSYSTEM_FOR(file)
  const versions = new Map()
  if (ecosystem === 'npm' && file.endsWith('package.json')) {
    const json = JSON.parse(content)
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, spec] of Object.entries(json[section] ?? {})) versions.set(`npm:${name}`, declaredVersion(spec))
    }
  } else if (ecosystem === 'pip') {
    for (const line of content.split('\n')) {
      const m = /^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*==\s*([^\s;#]+)/.exec(line.trim())
      if (m) versions.set(`pip:${normalizeName('pip', m[1])}`, m[2])
    }
  }
  return versions
}

/** Extracts exact {ecosystem,name,from,to,manifest} changes from file patches. PR text is never read. */
export function extractUpdates(files) {
  const updates = []
  for (const file of files) {
    const ecosystem = ECOSYSTEM_FOR(file.filename)
    if (!ecosystem || !file.patch || file.filename.endsWith('package-lock.json')) continue
    const removed = new Map()
    const added = new Map()
    for (const line of file.patch.split('\n')) {
      if (line.startsWith('---') || line.startsWith('+++')) continue
      const side = line[0] === '-' ? removed : line[0] === '+' ? added : null
      if (!side) continue
      let m
      if (ecosystem === 'npm') m = /^[-+]\s*"([^"]+)":\s*"([\^~><=]*\d[^"]*)"/.exec(line)
      else if (ecosystem === 'pip') m = /^[-+]\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*==\s*([^\s;#]+)/.exec(line)
      else m = /^[-+]\s*(?:-\s*)?uses:\s*([^@\s]+)@(\S+)/.exec(line)
      if (m) side.set(normalizeName(ecosystem, m[1]), declaredVersion(m[2]))
    }
    for (const [name, to] of added) {
      const from = removed.get(name)
      if (from !== undefined && from !== to) updates.push({ ecosystem, name, from, to, manifest: file.filename })
    }
  }
  return updates
}

/** Stable identity of a PR's dependency changes; research and approvals are valid only for the same key. */
export const updatesKey = (updates) => updates.map((u) => `${u.ecosystem}:${u.name}:${u.from}>${u.to}`).sort().join(',').slice(0, 400)

// ── classification ───────────────────────────────────────────────────────────────────────

const categoriesFor = (policy, update) =>
  Object.entries(policy.risk.package_categories).filter(([, names]) => names.includes(update.name)).map(([category]) => category)

const maxRisk = (a, b) => (RISK_ORDER[a] >= RISK_ORDER[b] ? a : b)

/**
 * Deterministic classification. `research` (Claude, advisory) may only RAISE risk; it can never lower it
 * or clear a violation. `mainVersions` is the trusted Map from main's manifests.
 */
export function classifyPr({ pr, files, mainVersions, policy, research = null }) {
  const updates = extractUpdates(files).map((u) => ({ ...u, bump: bumpKind(u.from, u.to), categories: categoriesFor(policy, u) }))
  const reasons = []
  const violations = []
  const categories = new Set()
  let risk = 'low'
  const raise = (level, reason) => { risk = maxRisk(risk, level); reasons.push(reason) }

  const allowed = Object.values(policy.allowed_paths).flat()
  const isAllowed = (file) => allowed.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) && !file.slice(entry.length).includes('/') : file === entry))
  const unexpected = files.map((f) => f.filename).filter((f) => !isAllowed(f))
  if (unexpected.length) {
    violations.push(`non-manifest files changed: ${unexpected.slice(0, 5).join(', ')}${unexpected.length > 5 ? '…' : ''}`)
    categories.add('unexpected-files')
    raise('high', 'PR changes files outside the dependency manifests')
  }
  if (files.some((f) => f.filename.startsWith('.github/'))) { categories.add('github-actions'); raise('high', 'changes GitHub Actions / release infrastructure') }
  if (files.some((f) => /(^|\/)supabase\/|(^|\/)migrations\/|\.sql$/.test(f.filename))) { categories.add('database'); raise('high', 'touches database schema or migrations') }
  if (updates.length === 0 && unexpected.length === 0) violations.push('no dependency changes could be parsed from the diff')

  const redundant = []
  for (const u of updates) {
    if (u.bump === 'downgrade' || u.bump === 'same') violations.push(`${u.name}: ${u.from} -> ${u.to} is not an upgrade`)
    if (!PACKAGE_NAME.test(u.name.toLowerCase()) && u.ecosystem !== 'github-actions') violations.push(`unsafe package name rejected: ${u.name.slice(0, 40)}`)
    if (u.ecosystem === 'github-actions') categories.add('github-actions')
    for (const category of u.categories) {
      const scope = NEVER_AUTOMATIC[category]
      const major = u.bump === 'major' || u.bump === 'unknown' || u.bump === 'prerelease'
      if (scope === 'any' || (scope === 'major' && major)) categories.add(category)
      raise(scope === 'any' || major ? 'high' : 'medium', `${u.name} is ${category}`)
    }
    if (u.bump === 'major') raise('medium', `${u.name} is a major upgrade (${u.from} -> ${u.to})`)
    else if (u.bump === 'prerelease' || u.bump === 'unknown') raise('medium', `${u.name} targets a prerelease or non-comparable version`)
    else if (u.bump === 'minor' && /^0\./.test(u.from)) raise('medium', `${u.name} is a 0.x minor upgrade (unstable API)`)
    const current = mainVersions.get(`${u.ecosystem}:${u.name}`)
    if (current === undefined && u.ecosystem !== 'github-actions') redundant.push({ ...u, why: 'package no longer declared on main' })
    else if (current !== undefined && compareVersions(current, u.to) >= 0) redundant.push({ ...u, why: `main already has ${current}` })
  }
  if (updates.length > 10) raise('medium', `${updates.length} dependencies change together (large blast radius)`)

  for (const finding of research?.findings ?? []) if (finding?.risk_floor in RISK_ORDER) raise(finding.risk_floor, `research: ${finding.package}`)

  const neverAutomatic = [...categories].filter((c) => c in NEVER_AUTOMATIC)
  return {
    number: pr.number,
    head_sha: pr.head.sha,
    updates,
    ecosystems: [...new Set(updates.map((u) => u.ecosystem))],
    violations,
    categories: [...categories].sort(),
    never_automatic: neverAutomatic.length > 0 || violations.length > 0,
    risk,
    reasons: [...new Set(reasons)],
    redundant,
    all_redundant: updates.length > 0 && redundant.length === updates.length,
  }
}

/** Known incompatibilities + registry peer requirements -> problems and ordering edges. */
export function compatibilityProblems({ analyses, mainVersions, policy, compat }) {
  const problems = new Map()
  const edges = []
  const effective = (eco, name) => mainVersions.get(`${eco}:${name}`)
  const providers = (eco, name, range, exceptPr) =>
    analyses.filter((a) => a.number !== exceptPr).filter((a) => a.updates.some((u) => u.ecosystem === eco && u.name === name && satisfies(u.to, range)))
  for (const analysis of analyses) {
    const requirements = []
    for (const u of analysis.updates) {
      for (const known of policy.known_incompatibilities) {
        if (known.ecosystem === u.ecosystem && known.name === u.name && String(known.major) === String(u.to.split('.')[0])) {
          for (const [peer, range] of Object.entries(known.requires)) requirements.push({ u, peer, range, reason: known.reason, explicit: true })
        }
      }
      for (const [peer, range] of Object.entries(compat?.[`${u.ecosystem}:${u.name}@${u.to}`]?.peers ?? {})) requirements.push({ u, peer, range, reason: 'registry dependency requirement', explicit: false })
    }
    for (const { u, peer, range, reason, explicit } of requirements) {
      const own = analysis.updates.find((x) => x.ecosystem === u.ecosystem && x.name === peer)
      if (own && satisfies(own.to, range)) continue
      const have = effective(u.ecosystem, peer)
      // Registry requirements bind only packages this repository declares itself: pip installs the rest and
      // npm auto-installs required peers. Policy-declared incompatibilities always apply.
      if (have === undefined && !own && !explicit) continue
      if (have !== undefined && !own && satisfies(have, range)) continue
      const provider = providers(u.ecosystem, peer, range, analysis.number)[0]
      if (provider) edges.push({ before: provider.number, after: analysis.number, why: `${u.name}@${u.to} needs ${peer} ${range}` })
      else problems.set(analysis.number, [...(problems.get(analysis.number) ?? []), `${u.name}@${u.to} requires ${peer} ${range} (${reason}); repository has ${own?.to ?? have ?? 'none'} and no queued PR provides it`])
    }
  }
  return { problems, edges }
}

/** Deterministic dependency-aware order: lower risk first, then ecosystem, then PR number; edges respected. */
export function orderQueue(analyses, edges = []) {
  const byNumber = new Map(analyses.map((a) => [a.number, a]))
  const indegree = new Map(analyses.map((a) => [a.number, 0]))
  const next = new Map(analyses.map((a) => [a.number, []]))
  for (const { before, after } of edges) {
    if (!byNumber.has(before) || !byNumber.has(after)) continue
    next.get(before).push(after)
    indegree.set(after, indegree.get(after) + 1)
  }
  const key = (n) => { const a = byNumber.get(n); return [RISK_ORDER[a.risk], a.ecosystems[0] ?? '', n] }
  const less = (x, y) => { const [kx, ky] = [key(x), key(y)]; for (let i = 0; i < 3; i += 1) if (kx[i] !== ky[i]) return kx[i] < ky[i]; return false }
  const ready = [...indegree].filter(([, d]) => d === 0).map(([n]) => n)
  const order = []
  while (ready.length) {
    ready.sort((x, y) => (less(x, y) ? -1 : less(y, x) ? 1 : 0))
    const n = ready.shift()
    order.push(n)
    for (const m of next.get(n)) { indegree.set(m, indegree.get(m) - 1); if (indegree.get(m) === 0) ready.push(m) }
  }
  const cyclic = analyses.map((a) => a.number).filter((n) => !order.includes(n))
  return { order, cyclic }
}

// ── merge approval + gate ────────────────────────────────────────────────────────────────

const updateKey = (u) => `${u.ecosystem}:${u.name}:${u.from}->${u.to}`

/** Finds an approval whose scope equals the PR's exact update set; head_sha pin is checked when present. */
export function matchApproval({ analysis, policy, today }) {
  const actual = analysis.updates.map(updateKey).sort().join('|')
  const reasons = []
  for (const approval of policy.merge.approvals) {
    if (approval.pr !== analysis.number) continue
    if (approval.expires_at < today) { reasons.push(`approval for #${approval.pr} expired ${approval.expires_at}`); continue }
    if (approval.updates.map(updateKey).sort().join('|') !== actual) { reasons.push('approved update set differs from the PR diff'); continue }
    if (approval.head_sha && approval.head_sha !== analysis.head_sha) { reasons.push('approval is pinned to a different head SHA'); continue }
    if (analysis.updates.some((u) => u.bump === 'major') && policy.risk.major_requires_acknowledgement && !approval.acknowledge_major) { reasons.push('major upgrade lacks acknowledge_major'); continue }
    return { approval, reasons: [] }
  }
  return { approval: null, reasons: reasons.length ? reasons : [`no approval entry names PR #${analysis.number}`] }
}

/**
 * Final merge gate evaluated from FRESH facts immediately before merging. Returns every failing reason
 * so refusals are explainable; `ok` only when the list is empty.
 */
export function evaluateMergeGate({ policy, analysis, facts, today }) {
  const fail = []
  if (policy.paused) fail.push('orchestrator is paused')
  if (!policy.mutation_enabled) fail.push('mutation is disabled in policy')
  if (policy.merge.mode !== 'approved-only') fail.push('merge mode is prepare-only')
  if (analysis.never_automatic) fail.push(`never-automatic category: ${[...analysis.categories, ...analysis.violations].join(', ')}`)
  if (analysis.risk === 'high') fail.push('risk is high; a human must merge')
  const { approval, reasons } = matchApproval({ analysis, policy, today })
  if (!approval) fail.push(...reasons)
  const { pr, main_sha: mainSha, checks, verified } = facts
  if (pr.state !== 'open' || pr.draft || pr.base.ref !== 'main') fail.push('PR is not an open, non-draft PR targeting main')
  if (!SHA_PATTERN.test(pr.head.sha) || pr.head.sha !== analysis.head_sha) fail.push('head SHA moved since analysis')
  if (!verified || verified.head_sha !== pr.head.sha) fail.push('no verification recorded for this exact head SHA')
  if (verified && verified.base_sha !== mainSha) fail.push('verification is stale: main moved since CI/Staging ran')
  if (pr.behind_by > 0 || !facts.contains_main) fail.push('branch does not contain the latest main')
  for (const name of ['CI Gate', 'Database Migration Gate', 'Staging Gate']) {
    if (checks[name]?.conclusion !== 'success' || checks[name]?.head_sha !== pr.head.sha) fail.push(`${name} has not succeeded for the exact head SHA`)
  }
  if (facts.changes_requested) fail.push('changes requested')
  if (facts.unresolved_threads > 0) fail.push('unresolved review threads')
  if (!facts.authors_trusted) fail.push('branch contains commits from an untrusted author')
  if (pr.mergeable_state !== 'clean') fail.push(`mergeable state is ${pr.mergeable_state}, not clean`)
  return { ok: fail.length === 0, reasons: fail, approval }
}
