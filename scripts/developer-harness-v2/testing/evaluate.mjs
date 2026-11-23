// Developer Harness V2 — Phase 6 historical-diff evaluation.
//
// Scores the selector against a FIXED corpus of real GitHub Actions failures (corpus.json: run ids, failing job names, changed
// files — mined from the GitHub API, never invented). For each historical diff it asks: did the selection include a suite for
// every job that failed in CI? Recall and misses matter more than suite count. Synthetic fixtures are used elsewhere for negative
// tests and are never mixed into these numbers. If the corpus lacks a category the evaluation says so (EVALUATION_GAP) and the
// phase must not claim full acceptance.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUITE_BY_ID, jobToSuites } from './catalog.mjs'
import { changeSetFromEntries } from './changes.mjs'
import { PASSTHROUGH_CODE, selectTests } from './select.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CORPUS_PATH = path.join(HERE, 'corpus.json')
export const REQUIRED_CATEGORIES = Object.freeze(['api', 'web', 'mobile', 'database', 'scripts', 'workflows', 'cross_surface', 'developer', 'dependency', 'test_only', 'other'])

export const loadCorpus = (p = CORPUS_PATH) => JSON.parse(readFileSync(p, 'utf8'))
const isTestOnly = (files) => files.length > 0 && files.every((f) => /(^|\/)(__tests__|tests?|e2e)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/.test(f.path))

/** Corpus categories actually present (the stored category plus a derived test_only), so gaps are reported rather than assumed away. */
export function categoriesOf(entry) {
  const c = new Set([entry.category])
  if (isTestOnly(entry.files)) c.add('test_only')
  return [...c]
}

export function evaluateEntry(entry, index = {}, { includeInherited = false } = {}) {
  const failedJobs = includeInherited ? [...entry.failed_jobs, ...(entry.inherited_failed_jobs ?? [])] : entry.failed_jobs
  const change = changeSetFromEntries(entry.files.map((f) => ({ path: f.path, status: f.status, old_path: f.previous_path })), { base_examined: true })
  const sel = selectTests(change, { index })
  const selected = new Set(sel.suites.map((s) => s.id))
  const targeted = new Set(sel.suites.filter((s) => s.targeted).map((s) => s.id))
  const jobs = failedJobs.map((job) => {
    const suites = jobToSuites(job)
    const runnableHere = new Set(sel.suites.filter((s) => s.local_action === 'RUN' || s.local_action === 'RUN_WITH_PREREQS').map((s) => s.id))
    const local = suites.filter((id) => ['lightweight', 'prereq'].includes(SUITE_BY_ID[id].tier) && !SUITE_BY_ID[id].blocked)
    return {
      job, suites, mapped: suites.length > 0,
      recalled: suites.some((id) => selected.has(id)), recalled_targeted: suites.some((id) => targeted.has(id)),
      local_suites: local, local_recalled: local.length ? local.some((id) => runnableHere.has(id)) : null, ci_only_only: suites.length > 0 && suites.every((id) => SUITE_BY_ID[id].tier === 'ci_only'), withheld_only: suites.length > 0 && local.length === 0 && suites.some((id) => SUITE_BY_ID[id].tier !== 'ci_only'),
      // a failure outside the catalog must at least be flagged as CI-only / unproven, never silently ignored
      flagged_outside_catalog: suites.length === 0 ? sel.suites.some((s) => s.id === 'ci.gate') || sel.coverage.status === 'COVERAGE.UNPROVEN' : null,
    }
  })
  const covering = new Set(jobs.flatMap((j) => j.suites))
  const unproven = sel.coverage.status === 'COVERAGE.UNPROVEN'
  const withheld = sel.suites.filter((s) => ['NEEDS_APPROVAL', 'BLOCKED'].includes(s.local_action)).length
  return { id: entry.id, category: entry.category, categories: categoriesOf(entry), jobs, selected_count: selected.size, targeted_count: targeted.size, passthrough_only: sel.suites.filter((s) => s.reasons.every((r) => r.code === PASSTHROUGH_CODE)).length, over_selected: [...selected].filter((id) => !covering.has(id)).length, unknown_coverage: unproven || sel.coverage.gaps.length > 0, expensive_or_blocked: withheld, selection_digest: sel.selection_digest }
}

export function evaluateCorpus(corpus = loadCorpus(), { index = corpus.index_snapshot ?? {}, requiredCategories = REQUIRED_CATEGORIES } = {}) {
  const results = corpus.entries.map((e) => evaluateEntry(e, index))
  const withInherited = corpus.entries.map((e) => evaluateEntry(e, index, { includeInherited: true }))
  const inheritedMissed = withInherited.flatMap((r) => r.jobs.filter((j) => j.mapped && !j.recalled).map((j) => ({ entry: r.id, job: j.job }))).length
  const jobs = results.flatMap((r) => r.jobs.map((j) => ({ ...j, entry: r.id, category: r.category })))
  const mapped = jobs.filter((j) => j.mapped)
  const local = jobs.filter((j) => j.local_recalled !== null)
  const missed = mapped.filter((j) => !j.recalled).map((j) => ({ entry: j.entry, job: j.job, category: j.category }))
  const missedLocal = local.filter((j) => !j.local_recalled).map((j) => ({ entry: j.entry, job: j.job, category: j.category }))
  const missedTargeted = mapped.filter((j) => !j.recalled_targeted).map((j) => ({ entry: j.entry, job: j.job, category: j.category }))
  const present = new Set(results.flatMap((r) => r.categories))
  const absent = requiredCategories.filter((c) => !present.has(c))
  const outside = jobs.filter((j) => !j.mapped)
  const by_category = {}
  for (const j of mapped) { const c = (by_category[j.category] ??= { jobs: 0, recalled: 0 }); c.jobs += 1; c.recalled += j.recalled ? 1 : 0 }
  const n = results.length || 1
  const metrics = {
    entries: results.length, entries_with_introduced_failures: corpus.entries.filter((e) => e.failed_jobs.length).length, entries_with_unknown_baseline: corpus.entries.filter((e) => !String(e.baseline?.status).startsWith('known')).length, missed_including_inherited: inheritedMissed, known_failed_jobs: jobs.length, mapped_to_catalog: mapped.length, outside_catalog: outside.length,
    recalled: mapped.length - missed.length, missed: missed.length, recall: mapped.length ? (mapped.length - missed.length) / mapped.length : 1,
    local_runnable_jobs: local.length, ci_only_jobs_recalled: mapped.filter((j) => j.ci_only_only && j.recalled).length, ci_only_jobs_recalled_solely_by_passthrough: mapped.filter((j) => j.ci_only_only && j.recalled && !j.recalled_targeted).length, jobs_whose_suites_are_all_withheld: mapped.filter((j) => j.withheld_only).length, local_executable_jobs: local.length, local_recalled: local.length - missedLocal.length, local_recall: local.length ? (local.length - missedLocal.length) / local.length : 1,
    // CI-only jobs (Pixel-Diff, Security Scan, ...) are REQUIRED coverage the always-on passthrough merely lists: never local test-selection accuracy.
    ci_only_required_jobs: mapped.filter((j) => j.ci_only_only).length, non_ci_only_jobs: mapped.filter((j) => !j.ci_only_only).length,
    non_ci_only_recalled_by_rules: mapped.filter((j) => !j.ci_only_only && j.recalled_targeted).length,
    non_ci_only_recall_by_rules: mapped.filter((j) => !j.ci_only_only).length ? mapped.filter((j) => !j.ci_only_only && j.recalled_targeted).length / mapped.filter((j) => !j.ci_only_only).length : 1,
    unconditional_suites_per_entry: results.length ? Math.max(...results.map((r) => r.passthrough_only)) : 0,
    targeted_recall_without_ci_passthrough: mapped.length ? (mapped.length - missedTargeted.length) / mapped.length : 1,
    outside_catalog_flagged: outside.filter((j) => j.flagged_outside_catalog).length,
    mean_suites_selected: results.reduce((a, r) => a + r.selected_count, 0) / n, mean_over_selected: results.reduce((a, r) => a + r.over_selected, 0) / n,
    entries_with_unknown_coverage: results.filter((r) => r.unknown_coverage).length, entries_with_expensive_or_blocked_suites: results.filter((r) => r.expensive_or_blocked > 0).length,
  }
  const reasons = []
  if (missed.length) reasons.push(`MISSED_KNOWN_FAILURES:${missed.length}`)
  if (outside.some((j) => !j.flagged_outside_catalog)) reasons.push('OUTSIDE_CATALOG_UNFLAGGED')
  if (absent.length) reasons.push(`EVALUATION_GAP:${absent.join(',')}`)
  return { schema: 'developer-harness-v2/corpus-evaluation@1', corpus_entries: results.length, metrics, missed, missed_local: missedLocal, missed_without_ci_passthrough: missedTargeted, by_category, categories_absent: absent, results, acceptance: { met: reasons.length === 0, reasons, note: 'Recall is the acceptance measure; suite count is reported, not minimised.' } }
}
