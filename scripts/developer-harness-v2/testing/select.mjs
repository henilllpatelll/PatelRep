// Developer Harness V2 — Phase 6 deterministic test selector.
//
// A pure function of (change set, directory index). No git, no filesystem, no model, no network. The result is a PLAN:
// it lists suites with reason codes, coverage gaps and escalations, and starts nothing. Guiding rule: when uncertain,
// BROADEN or report COVERAGE.UNPROVEN — never select less. A selected suite that cannot run stays visible as
// BLOCKED / NEEDS_APPROVAL / CI_ONLY (the runner turns it into NOT_RUN or BLOCKED), it never disappears.
import { sha256, canonical } from '../coordination/evidence.mjs'
import { CI_JOBS, CI_ONLY_SUITE_IDS, LIMITS, SUITES, SUITE_BY_ID } from './catalog.mjs'
import { DOMAINS, FALLBACK_LIGHTWEIGHT, FEATURE_FLAG_PATH, LOST_TEST_SUITES, MOBILE_ALL, API_SHARED, WEB_ALL, RULES, SURFACE_SUITES, TRIGGER_SUITES, domainsOf, isTestPath, securityTriggersFor, testAreaOf } from './rules.mjs'

export const SELECTION_SCHEMA = 'developer-harness-v2/test-selection@1'
export const PASSTHROUGH_CODE = 'CI.NO_PATH_FILTERS'
/** Jobs of ci.yml run for EVERY pull request (it has no path filters), so these are always required, whatever a local selection says. */
const PASSTHROUGH = CI_ONLY_SUITE_IDS.filter((id) => id !== 'ci.deploy_check')
/** A changed test file or check script selects the suite that runs it (found generically from the catalog's own steps). */
const STEP_FILE_SUITES = new Map()
for (const s of SUITES) for (const st of s.steps) for (const f of [...(st.files ?? []), ...(st.script ? [st.script] : [])]) { const k = s.cwd === '.' ? f : `${s.cwd}/${f}`; STEP_FILE_SUITES.set(k, [...(STEP_FILE_SUITES.get(k) ?? []), s.id]) }
const surfaceOf = (p) => (/^apps\/api\//.test(p) ? 'api' : /^apps\/web\//.test(p) ? 'web' : /^apps\/mobile\//.test(p) ? 'mobile' : null)
const base = (p) => p.slice(p.lastIndexOf('/') + 1)
const MOBILE_RELATED = /^apps\/mobile\/(?!package(-lock)?\.json$).+\.(tsx?|jsx?|json)$/

export function selectTests(change, { index = {} } = {}) {
  const acc = new Map()
  const gaps = new Map()
  const esc = new Map()
  const tags = new Set()
  const domains = new Set()
  const inert = new Set()
  const related = new Set()
  const apiTests = new Set()
  const add = (id, code, p) => {
    if (id === FALLBACK_LIGHTWEIGHT) { for (const s of SUITES) if (s.tier === 'lightweight') add(s.id, code, p); return }
    if (!SUITE_BY_ID[id]) throw new Error(`rule references unknown suite ${id}`) // a typo here would silently drop coverage
    const e = acc.get(id) ?? { reasons: new Map() }
    const set = e.reasons.get(code) ?? new Set()
    if (p) set.add(p)
    e.reasons.set(code, set); acc.set(id, e)
  }
  const gap = (code, p, note) => { const g = gaps.get(code) ?? { paths: new Set(), note }; if (p) g.paths.add(p); gaps.set(code, g) }
  const escalate = (code, p) => { const s = esc.get(code) ?? new Set(); if (p) s.add(p); esc.set(code, s) }
  const addAll = (code, p) => { for (const s of SUITES) add(s.id, code, p) }
  const meta = (paths) => ({ count: change?.entries?.length ?? 0, all_paths: paths, digest: change?.changed_file_digest ?? null, invalid: change?.invalid ?? [] })

  if (!change || change.ok === false || change.truncated) {
    const code = change?.code ?? (change?.truncated ? 'CHANGES.TRUNCATED' : 'CHANGES.UNAVAILABLE')
    addAll(`SELECT_ALL.${code}`, null); gap('COVERAGE.UNPROVEN', null, `changed files could not be determined (${code}); every suite is listed`)
    return build({ acc, gaps, esc, tags, domains, inert, status: 'SELECTED', changed: meta([]), related, apiTests })
  }
  const entries = change.entries
  if (change.base_examined === false) gap('CHANGES.NO_BASE', null, 'no verified base was given (or the base equals HEAD): committed changes were not examined, only staged/unstaged/untracked work')
  if (!entries.length && !change.invalid.length && change.base_examined === false) { add(FALLBACK_LIGHTWEIGHT, 'FALLBACK.CHANGES_NO_BASE', null); gap('COVERAGE.UNPROVEN', null, 'no base and a clean tree: nothing could be examined'); return build({ acc, gaps, esc, tags, domains, inert, status: 'SELECTED', changed: meta([]), related, apiTests }) }
  if (!entries.length && !change.invalid.length) return build({ acc, gaps, esc, tags, domains, inert, status: 'NO_CHANGES', changed: meta([]), related, apiTests })
  for (const inv of change.invalid) { gap('COVERAGE.UNPROVEN', inv.raw, `invalid changed path (${inv.code})`); add(FALLBACK_LIGHTWEIGHT, `FALLBACK.${inv.code}`, inv.raw) }
  if (change.too_large) { addAll('SELECT_ALL.LARGE_DIFF', null); escalate('LARGE_DIFF', null) }

  for (const entry of entries) {
    const list = entry.old_path ? [[entry.old_path, true], [entry.path, false]] : [[entry.path, false]]
    for (const [p, isOld] of list) classify(p, { status: isOld ? 'D' : entry.status, old_path: entry.old_path, deleted: isOld || entry.status === 'D' })
  }
  if (entries.length) for (const id of PASSTHROUGH) add(id, PASSTHROUGH_CODE, null)

  function classify(p, ctx) {
    let known = false
    for (const r of RULES) {
      if (!r.match(p) || (r.when && !r.when(p, ctx))) continue
      if (r.inert) { inert.add(p); known = true; continue } // generated/binary artifact: no executable effect, still reported
      if (r.id !== 'DB.MIGRATION_HISTORY_MUTATION') known = true
      for (const s of r.suites ?? []) add(s, r.id, p)
      for (const t of r.tags ?? []) tags.add(t)
      for (const e of r.escalate ?? []) escalate(e, p)
      if (r.gap) gap(r.gap.code, p, r.gap.note)
    }
    for (const id of securityTriggersFor(p)) {
      tags.add(id); escalate('SECURITY_REVIEW_REQUIRED', p) // a risk trigger adds suites but does not make an unmapped path "known"
      for (const s of TRIGGER_SUITES[id] ?? []) add(s, `RISK.${id}`, p)
    }
    for (const r of index.readers ?? []) if (p === r.path || p.startsWith(`${r.path}/`)) { for (const id of r.suites) add(id, 'READS.CHANGED_FILE', p) } // adds suites only: like risk triggers it never marks a path "known" (a directory-level reader must not switch off the ambiguity fallback)
    for (const id of STEP_FILE_SUITES.get(p) ?? []) { known = true; add(id, 'TEST.FILE_OF_SUITE', p) }
    if (FEATURE_FLAG_PATH.test(p)) add('repo.feature_flag_registry', 'RISK.FEATURE_FLAG', p)
    const surface = surfaceOf(p)
    for (const d of domainsOf(p)) {
      if (!surface) continue
      domains.add(d)
      for (const other of ['api', 'web', 'mobile'].filter((x) => x !== surface)) for (const s of SURFACE_SUITES[other]) add(s, `CROSS.DOMAIN.${d}`, p)
    }
    if (ctx.deleted && isTestPath(p)) {
      for (const s of LOST_TEST_SUITES[testAreaOf(p)]) add(s, 'TEST.DELETED', p)
      escalate('LOST_COVERAGE_REVIEW', p)
    }
    if (!known) {
      if (surface === 'api') { for (const s of API_SHARED) add(s, 'FALLBACK.AMBIGUOUS_TYPE', p) } else if (surface === 'web') { for (const s of WEB_ALL) add(s, 'FALLBACK.AMBIGUOUS_TYPE', p) } else if (surface === 'mobile') { for (const s of MOBILE_ALL) add(s, 'FALLBACK.AMBIGUOUS_TYPE', p) } else add(FALLBACK_LIGHTWEIGHT, 'FALLBACK.UNKNOWN_PATH', p)
      gap(surface ? 'COVERAGE.AMBIGUOUS_TYPE' : 'COVERAGE.UNPROVEN', p, surface ? 'file type is not recognised inside a known area: the whole area was selected' : 'path matches no rule: lightweight suites were selected but coverage is unproven')
    }
    if (!ctx.deleted && MOBILE_RELATED.test(p)) related.add(p.slice('apps/mobile/'.length))
    if (!ctx.deleted && /^apps\/api\/tests\/test_[A-Za-z0-9_]+\.py$/.test(p)) apiTests.add(p.slice('apps/api/'.length))
    if (surface === 'api' && !isTestPath(p) && /\.py$/.test(p)) {
      const ds = DOMAINS.filter((d) => d.path.test(p)); const stem = base(p).replace(/\.py$/, '')
      for (const t of index.api_root_tests ?? []) {
        const name = base(t)
        if (ds.some((d) => d.tests.test(name)) || (stem.length >= 5 && name.includes(stem))) apiTests.add(t)
      }
    }
  }
  return build({ acc, gaps, esc, tags, domains, inert, status: 'SELECTED', changed: meta(change.all_paths), related, apiTests })
}

function build({ acc, gaps, esc, tags, domains, inert, status, changed, related, apiTests }) {
  const suites = []
  for (const s of SUITES) {
    const e = acc.get(s.id)
    if (!e) continue
    const reasons = [...e.reasons.entries()].map(([code, set]) => ({ code, count: set.size, paths: [...set].sort().slice(0, 5) })).sort((a, b) => (a.code < b.code ? -1 : 1))
    let params = null
    if (s.dynamic === 'jest_related' && related.size && related.size <= LIMITS.maxDynamicPaths) params = { related_files: [...related].sort() }
    if (s.dynamic === 'pytest_files' && apiTests.size && apiTests.size <= LIMITS.maxDynamicPaths) params = { test_files: [...apiTests].sort() }
    let local_action = s.tier === 'ci_only' ? 'CI_ONLY' : s.blocked ? 'BLOCKED' : s.dynamic && !params ? 'BLOCKED' : s.tier === 'lightweight' ? 'RUN' : s.tier === 'prereq' ? 'RUN_WITH_PREREQS' : 'NEEDS_APPROVAL'
    const blocked = s.blocked ?? (s.dynamic && !params ? { code: 'PARAMS.NONE', reason: 'no existing changed or adjacent files to pass; the full suite covers this' } : null)
    suites.push({ id: s.id, title: s.title, tier: s.tier, ci_jobs: s.ci_jobs, local_action, blocked, requires: s.requires, reasons, targeted: reasons.some((r) => r.code !== PASSTHROUGH_CODE),...(params ? { params } : {}) })
  }
  const withheld = suites.filter((s) => ['NEEDS_APPROVAL', 'BLOCKED'].includes(s.local_action)).map((s) => s.id)
  if (withheld.length) esc.set('EXPENSIVE_OR_BLOCKED_SUITES', new Set(withheld))
  if (suites.some((s) => s.requires?.db_stack)) { const x = esc.get('DB_STACK_APPROVAL_REQUIRED') ?? new Set(); esc.set('DB_STACK_APPROVAL_REQUIRED', x) }
  const gapList = [...gaps.entries()].map(([code, g]) => ({ code, note: g.note, paths: [...g.paths].sort().slice(0, 20), count: g.paths.size })).sort((a, b) => (a.code < b.code ? -1 : 1))
  const escalations = [...esc.entries()].map(([code, set]) => ({ code, paths: [...set].sort().slice(0, 20) })).sort((a, b) => (a.code < b.code ? -1 : 1))
  const unproven = gapList.some((g) => g.code === 'COVERAGE.UNPROVEN' || g.code === 'CHANGES.NO_BASE')
  const out = {
    schema: SELECTION_SCHEMA, status, authoritative: false,
    coverage: { status: status === 'NO_CHANGES' && !unproven ? 'NO_CHANGES_DETECTED' : unproven ? 'COVERAGE.UNPROVEN' : gapList.length ? 'CLASSIFIED_WITH_GAPS' : 'CLASSIFIED', gaps: gapList },
    suites, escalations, tags: [...tags].sort(), domains: [...domains].sort(), inert_paths: [...inert].sort(), required_ci_jobs: [...CI_JOBS], changed,
  }
  return { ...out, selection_digest: sha256(canonical({ s: suites.map((s) => [s.id, s.params ?? null]), g: gapList.map((g) => g.code), e: escalations.map((x) => x.code) })) }
}

/** Suite ids a selection includes for reasons other than the always-on CI passthrough (what the rules actually targeted). */
export const targetedIds = (sel) => sel.suites.filter((s) => s.targeted).map((s) => s.id)
export const selectedIds = (sel) => sel.suites.map((s) => s.id)
