// Developer Harness V2 — Phase 6 historical-diff evaluation tests.
// The corpus is REAL GitHub Actions evidence (run ids + failing job names + changed files). These tests check its integrity, that the
// selector recalls every known failure that maps to the catalog, and — with clearly SYNTHETIC entries kept out of the corpus — that the
// evaluator itself can fail, so a perfect score is never produced by construction.
// Run: node --test scripts/developer-harness-v2/testing/evaluate.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { CI_JOBS, JOB_ALIASES, jobToSuites } from './catalog.mjs'
import { CORPUS_PATH, REQUIRED_CATEGORIES, categoriesOf, evaluateCorpus, evaluateEntry, loadCorpus } from './evaluate.mjs'

const corpus = loadCorpus()
const evaluation = evaluateCorpus(corpus)

test('the corpus is real evidence: ids, urls, SHAs, failing jobs and files are present and well-formed', () => {
  assert.equal(corpus.schema, 'developer-harness-v2/historical-corpus@1'); assert.match(corpus.mined_at, /^\d{4}-\d{2}-\d{2}$/); assert.equal(corpus.repository, 'henilllpatelll/PatelRep')
  assert.match(corpus.method, /GitHub Actions REST API/); assert.match(corpus.inclusion_rule, /No entry was dropped for its outcome/)
  assert.ok(corpus.entries.length >= 100, `only ${corpus.entries.length} entries`); assert.equal(new Set(corpus.entries.map((e) => e.id)).size, corpus.entries.length)
  for (const e of corpus.entries) {
    assert.match(e.head_sha, /^[0-9a-f]{40}$/, e.id); assert.ok(['pull_request', 'push'].includes(e.event)); assert.ok(e.runs.length >= 1)
    for (const r of e.runs) { assert.ok(Number.isInteger(r.run_id) && r.run_id > 1e9, e.id); assert.ok(['CI', 'Mobile CI'].includes(r.workflow)); assert.equal(r.url, `https://github.com/henilllpatelll/PatelRep/actions/runs/${r.run_id}`); assert.match(r.created_at, /^\d{4}-\d{2}-\d{2}T/) }
    assert.ok(e.files.length > 0 && e.files.length <= 80, e.id); for (const f of e.files) { assert.ok(['A', 'M', 'D', 'R', 'C'].includes(f.status) && typeof f.path === 'string' && f.path.length > 0, e.id); if (f.status === 'R') assert.ok(f.previous_path, `${e.id}: rename without previous_path`) }
    assert.ok(Array.isArray(e.failed_jobs) && Array.isArray(e.inherited_failed_jobs ?? [])); assert.ok(!e.failed_jobs.includes('CI Gate'), 'the aggregate gate is not a failing suite'); assert.ok(e.baseline && typeof e.baseline.status === 'string')
    for (const j of [...e.failed_jobs, ...(e.inherited_failed_jobs ?? [])]) assert.ok(jobToSuites(j).length > 0 || JOB_ALIASES[j], `${e.id}: job "${j}" is outside the catalog and unflagged`)
  }
  assert.ok(corpus.entries.filter((e) => e.failed_jobs.length > 0).length >= 90, 'enough entries with introduced failures')
  assert.ok(corpus.caveats.length >= 2)
})

test('introduced and inherited failures are separated: a job already failing on the baseline is not scored against the diff', () => {
  const withInherited = corpus.entries.filter((e) => e.inherited_failed_jobs?.length)
  assert.ok(withInherited.length > 20)
  for (const e of withInherited) { for (const j of e.inherited_failed_jobs) assert.ok(!e.failed_jobs.includes(j), `${e.id}: ${j} counted both ways`); assert.ok(e.baseline.status.startsWith('known'), `${e.id}: inherited without a known baseline`); assert.ok(e.baseline.runs.length > 0) }
})

test('the selector includes a suite for EVERY known failing job (recall 1.0), including the locally executable ones', () => {
  const m = evaluation.metrics
  assert.deepEqual(evaluation.missed, [], `missed known failures: ${JSON.stringify(evaluation.missed)}`); assert.equal(m.recall, 1); assert.equal(m.missed, 0)
  assert.equal(m.mapped_to_catalog + m.outside_catalog, m.known_failed_jobs); assert.ok(m.known_failed_jobs >= 100); assert.ok(m.local_runnable_jobs >= 50); assert.equal(m.ci_only_jobs_recalled, 48, 'the CI-only jobs are stated next to the headline recall, not as selection accuracy')
  for (const r of evaluation.results) for (const j of r.jobs) if (j.mapped) assert.ok(j.recalled, `${r.id}: ${j.job}`)
})

test('the evaluation reports its measures honestly, including over-selection, unknown coverage and expensive escalations', () => {
  const m = evaluation.metrics
  for (const k of ['recall', 'local_recall', 'targeted_recall_without_ci_passthrough', 'mean_suites_selected', 'mean_over_selected', 'entries_with_unknown_coverage', 'entries_with_expensive_or_blocked_suites', 'missed_including_inherited', 'entries_with_unknown_baseline']) assert.equal(typeof m[k], 'number', k)
  assert.ok(m.targeted_recall_without_ci_passthrough < 1, 'rule-targeted recall (without the always-on CI passthrough) must be reported separately and is below 1')
  assert.ok(m.mean_over_selected > 5, 'accuracy over suite count: over-selection is reported, not hidden')
  assert.ok(m.entries_with_expensive_or_blocked_suites > 0 && m.entries_with_unknown_coverage >= 0)
  assert.ok(m.missed_including_inherited >= 0); assert.ok(Object.keys(evaluation.by_category).length >= 7)
})

test('every category the roadmap requires is either present in the corpus or reported as an EVALUATION_GAP — never assumed', () => {
  const present = new Set(corpus.entries.flatMap(categoriesOf))
  for (const c of ['api', 'web', 'mobile', 'database', 'scripts', 'workflows', 'cross_surface', 'dependency', 'other']) assert.ok(present.has(c), `corpus lacks ${c}`)
  assert.deepEqual(evaluation.categories_absent.sort(), REQUIRED_CATEGORIES.filter((c) => !present.has(c)).sort())
  if (evaluation.categories_absent.length) { assert.equal(evaluation.acceptance.met, false); assert.ok(evaluation.acceptance.reasons.some((r) => r.startsWith('EVALUATION_GAP:'))) }
  assert.ok(evaluation.categories_absent.includes('developer'), 'no developer-harness CI failures exist in history; the gap must be stated')
})

test('full acceptance is NOT claimed while a required category is missing from the historical evidence', () => {
  assert.equal(evaluation.acceptance.met, false); assert.deepEqual(evaluation.acceptance.reasons, ['EVALUATION_GAP:developer'])
  assert.equal(evaluateCorpus(corpus, { requiredCategories: ['api', 'web', 'mobile'] }).acceptance.met, true)
})

test('the evaluator CAN fail: a synthetic entry whose known failure the selector cannot map is reported as a miss', () => {
  const synthetic = { id: 'SYNTHETIC-1', synthetic: true, head_sha: 'a'.repeat(40), category: 'other', files: [{ path: 'docs/readme.md', status: 'M' }], failed_jobs: ['Mobile / Type-check'], baseline: { status: 'unknown' }, runs: [] }
  const ev = evaluateCorpus({ ...corpus, entries: [synthetic] }, { requiredCategories: [] })
  assert.equal(ev.missed.length, 1); assert.equal(ev.missed[0].job, 'Mobile / Type-check'); assert.equal(ev.acceptance.met, false); assert.ok(ev.acceptance.reasons[0].startsWith('MISSED_KNOWN_FAILURES'))
  const outside = evaluateCorpus({ ...corpus, entries: [{ ...synthetic, id: 'SYNTHETIC-2', failed_jobs: ['A Job Nobody Mapped'] }] }, { requiredCategories: [] })
  assert.equal(outside.metrics.outside_catalog, 1); assert.equal(outside.metrics.outside_catalog_flagged, 1, 'an unmapped failure is at least flagged through the CI-only gate'); assert.equal(outside.metrics.mapped_to_catalog, 0)
  assert.ok(!corpus.entries.some((e) => e.synthetic), 'synthetic fixtures never enter the real corpus')
})

test('the scoring is deterministic and uses the frozen index snapshot, so it does not drift with the working tree', () => {
  assert.deepEqual(evaluateCorpus(loadCorpus()).metrics, evaluation.metrics); assert.ok(corpus.index_snapshot.readers.length > 50 && corpus.index_snapshot.api_root_tests.length > 50)
  const e = evaluateEntry(corpus.entries[0], corpus.index_snapshot); assert.equal(evaluateEntry(corpus.entries[0], corpus.index_snapshot).selection_digest, e.selection_digest)
  assert.ok(CORPUS_PATH.endsWith('corpus.json'))
})

test('honest local recall: only suites this tool can actually run count, and every miss is documented', () => {
  const runnable = evaluation.results.flatMap((r) => r.jobs).filter((j) => j.local_recalled !== null)
  assert.ok(runnable.length >= 50); const missed = evaluation.results.flatMap((r) => r.jobs.filter((j) => j.local_recalled === false).map((j) => `${r.id}:${j.job}`)).sort()
  // The DB gate is covered only by a BLOCKED integration suite. Both Mobile / Jest failures hit API-only diffs: mobile.jest_related has no related
  // mobile file to pass (BLOCKED PARAMS.NONE) and mobile.jest_full needs explicit approval, so NOTHING runnable here covers them. They stay misses.
  assert.deepEqual(missed, ['ci-41160832111:Mobile / Jest', 'ci-42309249824:Database Migration Gate', 'ci-44465879046:Mobile / Jest'])
  assert.equal(evaluation.metrics.local_runnable_jobs, 69); assert.equal(evaluation.metrics.local_recalled, 66); assert.ok(Math.abs(evaluation.metrics.local_recall - 66 / 69) < 1e-9)
  assert.ok(evaluation.metrics.local_recall < 0.96 && evaluation.metrics.local_recall > 0.95)
  assert.ok(evaluation.metrics.jobs_whose_suites_are_all_withheld >= 10, 'jobs whose only suites are blocked/unapproved are not claimed as locally catchable')
  for (const j of CI_JOBS) assert.ok(jobToSuites(j).length > 0)
})

test('FINAL-A: CI-only jobs are reported as REQUIRED coverage and never inflate the meaningful recall figures', () => {
  const m = evaluation.metrics; const jobs = evaluation.results.flatMap((r) => r.jobs).filter((j) => j.mapped)
  assert.equal(m.ci_only_required_jobs, jobs.filter((j) => j.ci_only_only).length); assert.equal(m.ci_only_required_jobs + m.non_ci_only_jobs, m.mapped_to_catalog)
  assert.equal(m.ci_only_required_jobs, m.ci_only_jobs_recalled); assert.equal(m.ci_only_jobs_recalled_solely_by_passthrough, 19, 'only 19 of the 48 are recalled by nothing but the always-on passthrough; the rest are also targeted by rules')
  assert.equal(m.ci_only_jobs_recalled_solely_by_passthrough, evaluation.missed_without_ci_passthrough.length)
  assert.equal(m.ci_only_required_jobs, 48); assert.equal(m.non_ci_only_jobs, 80)
  assert.ok(m.non_ci_only_recall_by_rules <= m.recall && m.non_ci_only_recall_by_rules > 0.5, 'rules-only recall of the non-CI-only jobs is the meaningful targeting measure')
  assert.ok(m.targeted_recall_without_ci_passthrough < m.recall, 'the headline 1.0 is NOT the same thing as rule targeting')
  assert.ok(m.unconditional_suites_per_entry >= 5, 'the always-on CI passthrough is counted separately')
  assert.equal(m.missed, 0); assert.equal(m.missed_including_inherited, 2, 'inherited failures are reported, not hidden')
  assert.equal(evaluation.acceptance.met, false); assert.ok(evaluation.acceptance.reasons.includes('EVALUATION_GAP:developer'))
})
