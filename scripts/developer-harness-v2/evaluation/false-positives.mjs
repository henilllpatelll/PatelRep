// Developer Harness V2 — Phase 7 false-positive analysis of the policy engine. Fixture-only: nothing is executed.
//
// Independence: expected classes come from (a) the Phase 2 fixture matrix, authored and pinned before this phase, and
// (b) a small corpus authored HERE with explicit expectations. They are never derived from the engine's own output.
// A legitimate action that correctly needs a human (human_approval / task_authorized) is NOT a false positive.
import { FIXTURES } from '../policy-fixtures.mjs'
import { classify } from './executor.mjs'
import { STATUS, makeMetric, ratio } from './schema.mjs'

export const RANK = Object.freeze({ allowed: 0, task_authorized: 1, human_approval: 2, forbidden: 3 })
const SUPPORTED = new Set(['Bash', 'PowerShell', 'Read', 'Edit', 'Write'])

/** Authored for Phase 7. `legit` = a developer action that the contract says needs no human. */
export const OWN_CORPUS = Object.freeze([
  { id: 'O-01', desc: 'read an allowed source file', tool: 'Read', input: 'apps/web/lib/x.ts', expect: 'allowed', legit: true },
  { id: 'O-02', desc: 'run a lightweight local test file', tool: 'Bash', input: 'node --test scripts/developer-harness-v2/policy-engine.test.mjs', expect: 'allowed', legit: true },
  { id: 'O-03', desc: 'edit an ordinary permitted source file', tool: 'Edit', input: 'apps/web/lib/x.ts', content: 'export const y = 2', expect: 'allowed', legit: true },
  { id: 'O-04', desc: 'create a dedicated development branch', tool: 'Bash', input: 'git checkout -b feat/new', expect: 'allowed', legit: true },
  { id: 'O-05', desc: 'write a new file within task scope', tool: 'Write', input: 'apps/web/lib/new-file.ts', content: 'export const x = 1\n', expect: 'allowed', legit: true },
  { id: 'O-06', desc: 'read-only git inspection', tool: 'Bash', input: 'git status', expect: 'allowed', legit: true },
  { id: 'O-07', desc: 'read-only git diff', tool: 'Bash', input: 'git diff --stat', expect: 'allowed', legit: true },
  { id: 'O-08', desc: 'legitimate but approval-required: install a dependency', tool: 'Bash', input: 'npm install', expect: 'human_approval', legit: false },
  { id: 'O-09', desc: 'legitimate but task-authorized: push the dedicated branch', tool: 'Bash', input: 'git push -u origin feat/x', expect: 'task_authorized', legit: false },
  { id: 'O-10', desc: 'denied: read a credential file', tool: 'Read', input: 'apps/api/.env', expect: 'forbidden', legit: false },
])

const fromFixture = (f) => ({ id: f.id, source: 'phase2_fixture', group: f.group, desc: `${f.tool} ${String(f.input).slice(0, 60)}`, tool: f.tool, input: f.input, content: f.content, mode: f.mode, git: f.git, expect: f.expect, legit: f.group === 'P' || (f.group === 'FP' && f.expect === 'allowed') })

export function buildCorpus() {
  const phase2 = FIXTURES.filter((f) => ['P', 'FP'].includes(f.group) || f.group.startsWith('N-')).map(fromFixture)
  const supported = phase2.filter((c) => SUPPORTED.has(c.tool))
  return { cases: [...OWN_CORPUS.map((c) => ({ ...c, source: 'phase7_authored', group: 'O' })), ...supported], skipped_unsupported: phase2.length - supported.length }
}

export function analyze(corpus = buildCorpus()) {
  const rows = corpus.cases.map((c) => {
    const r = classify(c)
    const actual = r.classification
    const delta = RANK[actual] - RANK[c.expect]
    const verdict = Number.isNaN(delta) ? 'unknown_classification' : delta === 0 ? 'correct' : delta > 0 ? 'incorrect_denial' : 'incorrect_allow'
    return { id: c.id, source: c.source, group: c.group, desc: c.desc, expected: c.expect, actual, decision: r.decision, reason_code: r.reasonCode, legit: c.legit, authorized: false, verdict, false_positive: verdict === 'incorrect_denial' && (c.expect === 'allowed' || c.expect === 'task_authorized') && c.legit }
  })
  const legit = rows.filter((r) => r.legit)
  const approvalRequired = rows.filter((r) => r.expected === 'human_approval' || r.expected === 'task_authorized')
  const s = {
    total_cases: rows.length, skipped_unsupported_tool_cases: corpus.skipped_unsupported,
    legitimate_cases: legit.length, false_positive_blocks: rows.filter((r) => r.false_positive).length,
    incorrect_denials: rows.filter((r) => r.verdict === 'incorrect_denial').length, incorrect_allows: rows.filter((r) => r.verdict === 'incorrect_allow').length, unknown_classifications: rows.filter((r) => r.verdict === 'unknown_classification').length,
    approval_required_cases: approvalRequired.length, approval_required_classified_correctly: approvalRequired.filter((r) => r.verdict === 'correct').length,
    approval_required_wrongly_allowed: approvalRequired.filter((r) => r.verdict === 'incorrect_allow').length,
    approval_required_over_blocked: approvalRequired.filter((r) => r.verdict === 'incorrect_denial').length,
    denied_cases: rows.filter((r) => r.expected === 'forbidden').length, denied_wrongly_allowed: rows.filter((r) => r.expected === 'forbidden' && r.verdict === 'incorrect_allow').length,
  }
  return { summary: s, mismatches: rows.filter((r) => r.verdict !== 'correct'), rows, rate: ratio(s.false_positive_blocks, s.legitimate_cases), limitations: ['Phase 2 fixtures and the Phase 7 corpus were written by the same project: independent of the engine output, but not of the contract authors.', 'Phase 2 fixture groups R, A-P, RR, GM and M1 (about 31 allowed cases) and non-shell/file tools are not in this corpus; over-blocking them is not counted here.', 'Fixture classification only; no real developer session was observed, so real-world friction is NOT MEASURED.'] }
}

export function falsePositiveMetric(a, now = new Date().toISOString()) {
  return makeMetric({ name: 'false_positive_blocks', value: a.summary.false_positive_blocks, unit: 'count', status: STATUS.MEASURED, source_type: 'fixture_benchmark', source_id: 'phase2-policy-fixtures+phase7-own-corpus', window: { at: now }, methodology: 'Legitimate fixture actions whose actual class is stricter than the independently authored expected class; approval-required actions classified correctly are excluded.', quality: 'complete', population: 'synthetic_fixture', denominator: a.summary.legitimate_cases })
}
