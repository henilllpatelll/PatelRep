// Developer Harness V2 — Phase 7 usage/cost evidence tests (mandatory negatives 1–5, 16). Offline and deterministic.
// Run: node --test scripts/developer-harness-v2/evaluation/usage-import.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { STATUS, aggregate, makeMetric, notMeasured, redactSecrets, containsSecret } from './schema.mjs'
import { TASKS_SCHEMA, USAGE_SCHEMA, importTaskRecords, importUsage, readEvidenceFile } from './usage-import.mjs'

const T0 = '2026-11-01T00:00:00Z'
const T1 = '2026-11-23T00:00:00Z'
const rec = (o = {}) => ({ record_id: 'r1', task_id: 'task-a', model: 'claude-sonnet-5-5', input_tokens: 1000, output_tokens: 200, ...o })
const file = (records, source = {}) => ({ schema: USAGE_SCHEMA, source: { type: 'provider_usage_report', id: 'provider-export-2026-11', period: { start: T0, end: T1 }, ...source }, records })
const codes = (r) => r.rejected.flatMap((x) => x.codes)

test('schema: a MEASURED metric needs a named source, a window, a methodology and a finite non-negative value', () => {
  const ok = { name: 'model_tokens', value: 10, unit: 'tokens', status: STATUS.MEASURED, source_type: 'provider_usage_report', source_id: 'x', window: { start: T0, end: T1 }, methodology: 'm', quality: 'complete', population: 'real_task' }
  assert.equal(makeMetric(ok).value, 10)
  for (const bad of [{ value: -1 }, { value: NaN }, { value: '5' }, { value: null }, { source_id: '' }, { source_type: 'none' }, { window: null }, { methodology: '' }, { unit: 'usd' }, { name: 'made_up' }, { population: 'imaginary' }, { status: 'GUESS' }]) {
    assert.throws(() => makeMetric({ ...ok, ...bad }), RangeError, JSON.stringify(bad))
  }
  assert.throws(() => makeMetric({ ...ok, denominator: 5, value: 9 }), /denominator/)
})

test('schema: NOT MEASURED must be null with a reason; missing values are never aggregated as zero; estimates stay separate', () => {
  const nm = notMeasured('model_cost', 'no billing record')
  assert.equal(nm.value, null); assert.equal(nm.status, STATUS.NOT_MEASURED)
  assert.throws(() => makeMetric({ ...nm, value: 0 }), /null value/)
  assert.throws(() => makeMetric({ ...nm, reason: '' }), /reason/)
  const base = { name: 'model_cost', unit: 'usd', source_type: 'human_billing_record', source_id: 'b', window: { at: T1 }, methodology: 'm', quality: 'complete', population: 'real_task' }
  const m = makeMetric({ ...base, value: 5, status: STATUS.MEASURED })
  const est = makeMetric({ ...base, value: 99, status: STATUS.ESTIMATE })
  const a = aggregate([m, nm, est])
  assert.deepEqual([a.measured_sum, a.measured_n, a.missing_n, a.estimate_sum, a.complete], [5, 1, 1, 99, false])
  assert.equal(aggregate([nm]).measured_sum, null, 'all-missing is null, not 0')
  assert.throws(() => makeMetric({ ...base, value: 1, status: STATUS.MEASURED, source_type: 'token-ledger' }), /source/)
})

test('#1 fabricated or malformed usage numbers are rejected', () => {
  const bad = [{ input_tokens: -5 }, { input_tokens: 1.5 }, { input_tokens: '1000' }, { input_tokens: NaN }, { output_tokens: null }, { input_tokens: 1e12 }, { model: '' }, { model: 'x y; rm -rf' }, { record_id: '' }, { cache_read_tokens: -1 }, { cost_usd: 1.2 }, { cost_usd: -1, cost_basis: 'billed' }, { cost_usd: 'free', cost_basis: 'billed' }, { cost_basis: 'billed' }, { surprise: 1 }, { derived_cost: { usd: 1 } }, { derived_cost: { usd: 1, rate_source: 'guess', rate_date: 'yesterday' } }]
  for (const b of bad) {
    const r = importUsage(file([rec(b)]))
    assert.equal(r.accepted.length, 0, JSON.stringify(b)); assert.ok(r.rejected.length === 1, JSON.stringify(b))
  }
  for (const f of [null, [], 'x', {}, { ...file([rec()]), schema: 'v0' }, { ...file([rec()]), extra: 1 }, file([]), file([rec()], { type: 'guess' }), file([rec()], { id: '' }), file([rec()], { period: { start: T1, end: T0 } }), file([rec()], { period: undefined })]) {
    const r = importUsage(f); assert.equal(r.ok, false); assert.ok(r.file_errors.length > 0)
  }
  assert.equal(importUsage(file([rec({ cost_usd: 3, cost_basis: 'billed' })], { type: 'claude_code_usage_output' })).accepted.length, 0, 'cost from a non-billing source is rejected')
  assert.ok(codes(importUsage(file([rec({ cost_usd: 3, cost_basis: 'billed', derived_cost: { usd: 3, rate_source: 's', rate_date: T1 } })]))).includes('RECORD.CONTRADICTORY_COST'))
})

test('#2 OpenWolf character estimates never become measured tokens or cost', () => {
  for (const s of [{ id: '.wolf/token-ledger.json' }, { id: 'OpenWolf ledger' }]) assert.deepEqual(importUsage(file([rec()], s)).file_errors, ['IMPORT.FORBIDDEN_SOURCE'])
  assert.deepEqual(importUsage(file([rec({ model: 'estimated_from_chars' })])).file_errors, ['IMPORT.FORBIDDEN_SOURCE'])
  assert.deepEqual(importUsage(file([rec({ task_id: 'chars-per-token-assumed_rate' })])).file_errors, ['IMPORT.FORBIDDEN_SOURCE'])
  assert.deepEqual(importUsage(file([rec()], { type: 'openwolf_token_ledger' })).file_errors, ['IMPORT.FORBIDDEN_SOURCE'])
  const m = { name: 'model_tokens', value: 119000000, unit: 'tokens', status: STATUS.MEASURED, source_type: 'repository_document', source_id: 'token-ledger', window: { at: T1 }, methodology: 'ledger', quality: 'complete', population: 'real_task' }
  assert.throws(() => makeMetric(m), /forbidden source/)
  assert.throws(() => makeMetric({ ...m, source_type: 'character_count', source_id: 'x' }), RangeError)
})

test('#3 unknown cost is NOT MEASURED, never $0; derived estimates need a dated source and stay separate', () => {
  const r = importUsage(file([rec()]))
  const cost = r.metrics.find((m) => m.name === 'model_cost')
  assert.equal(cost.status, STATUS.NOT_MEASURED); assert.equal(cost.value, null)
  assert.equal(r.metrics.find((m) => m.name === 'model_tokens').value, 1200)
  const partial = importUsage(file([rec(), rec({ record_id: 'r2', input_tokens: 5, cost_usd: 1.5, cost_basis: 'billed' })]))
  assert.equal(partial.metrics.find((m) => m.name === 'model_cost').status, STATUS.NOT_MEASURED, 'one missing record makes the task cost NOT MEASURED')
  const billed = importUsage(file([rec({ cost_usd: 1.5, cost_basis: 'billed' }), rec({ record_id: 'r2', input_tokens: 5, cost_usd: 0.25, cost_basis: 'billed' })]))
  assert.equal(billed.metrics.find((m) => m.name === 'model_cost').value, 1.75)
  const derived = importUsage(file([rec({ derived_cost: { usd: 2, rate_source: 'published price page', rate_date: T0 } })]))
  assert.equal(derived.metrics.find((m) => m.name === 'model_cost').status, STATUS.NOT_MEASURED)
  assert.equal(derived.estimates.length, 1); assert.equal(derived.estimates[0].status, STATUS.ESTIMATE)
})

test('#4 duplicate evidence cannot inflate usage', () => {
  const dupId = importUsage(file([rec(), rec({ input_tokens: 9999 })]))
  assert.equal(dupId.accepted.length, 1); assert.ok(codes(dupId).includes('RECORD.DUPLICATE_ID'))
  const dupBody = importUsage(file([rec(), rec({ record_id: 'r2' })]))
  assert.equal(dupBody.accepted.length, 1); assert.ok(codes(dupBody).includes('RECORD.DUPLICATE_CONTENT'))
  assert.equal(dupBody.metrics.find((m) => m.name === 'model_tokens').value, 1200)
})

test('#5 unrelated tasks cannot share one record; unattributed usage is never distributed', () => {
  for (const id of [['a', 'b'], 'a,b', 'all', 'shared', 'aggregate', '*', 'A B', 7, {}]) assert.ok(codes(importUsage(file([rec({ task_id: id })]))).includes('RECORD.SHARED_OR_INVALID_ATTRIBUTION'), JSON.stringify(id))
  const r = importUsage(file([rec(), rec({ record_id: 'r2', task_id: null, input_tokens: 7777 }), rec({ record_id: 'r3', task_id: 'task-b', input_tokens: 5 })]))
  assert.equal(r.unattributed.input_tokens, 7777)
  assert.deepEqual(Object.keys(r.by_task).sort(), ['task-a', 'task-b'])
  assert.equal(r.metrics.filter((m) => m.name === 'model_tokens').reduce((n, m) => n + m.value, 0), 1200 + 205, 'unattributed tokens are in no task total')
})

test('#16 secret-bearing inputs are rejected and secrets are redacted', () => {
  const canary = ['sk_live_', 'AbCdEf0123456789xyz'].join('')
  assert.deepEqual(importUsage(file([rec()], { id: canary })).file_errors, ['IMPORT.SECRET_BEARING_INPUT'])
  assert.deepEqual(importUsage(file([rec({ model: `m${canary}` })])).file_errors, ['IMPORT.SECRET_BEARING_INPUT'])
  assert.ok(containsSecret(`Authorization: ${['gh', 'p_'].join('')}${'a'.repeat(36)}`))
  assert.ok(!redactSecrets(`x ${canary} y`).includes(canary))
  assert.deepEqual(importTaskRecords({ schema: TASKS_SCHEMA, records: [{ task_id: 't', source_id: canary }] }).file_errors, ['IMPORT.SECRET_BEARING_INPUT'])
})

test('positive: billed, attributed, deduplicated evidence yields MEASURED tokens and cost with sources and windows', () => {
  const r = importUsage(file([rec({ cache_read_tokens: 10, cache_creation_tokens: 4, cost_usd: 0.5, cost_basis: 'billed' })], { type: 'human_billing_record', id: 'invoice-2026-11' }))
  assert.equal(r.ok, true)
  const t = r.metrics.find((m) => m.name === 'model_tokens'); const c = r.metrics.find((m) => m.name === 'model_cost')
  assert.equal(t.status, STATUS.MEASURED); assert.equal(t.source_id, 'invoice-2026-11'); assert.equal(t.window.start, T0)
  assert.deepEqual([t.breakdown.input, t.breakdown.output, t.breakdown.cache_read, t.breakdown.cache_creation], [1000, 200, 10, 4])
  assert.deepEqual([c.status, c.value], [STATUS.MEASURED, 0.5])
})

test('task records: absent fields stay NOT MEASURED; invalid timestamps, counts and duplicates are rejected', () => {
  const r = importTaskRecords({ schema: TASKS_SCHEMA, records: [{ task_id: 't1', source_id: 'human-log', started_at: T0, recorded_at: T1, regressions: 0, ready_at: '2026-11-02T00:00:00Z' }] })
  assert.equal(r.ok, true)
  const by = Object.fromEntries(r.metrics.map((m) => [m.name, m]))
  assert.deepEqual([by.regressions.status, by.regressions.value], [STATUS.MEASURED, 0])
  assert.equal(by.time_to_ready.value, 86400)
  for (const n of ['failed_checks_before_green', 'human_interventions', 'task_completion']) assert.equal(by[n].status, STATUS.NOT_MEASURED, n)
  const bad = importTaskRecords({ schema: TASKS_SCHEMA, records: [{ task_id: 'ok', source_id: 's', started_at: T0, recorded_at: T1, regressions: -1 }, { task_id: 'ok2', source_id: 's', started_at: 'x', recorded_at: T1 }, { task_id: 'ok3', source_id: 's', started_at: T1, recorded_at: T1, ready_at: T0 }, { task_id: 'Bad Id', source_id: 's', started_at: T0, recorded_at: T1 }] })
  assert.equal(bad.ok, false); assert.equal(bad.rejected.length, 4)
})

test('#15 evidence files: no URLs, no symlinks, size-capped, local only', () => {
  assert.throws(() => readEvidenceFile('https://example.com/usage.json'), /LOCAL_FILE_REQUIRED/)
  assert.throws(() => readEvidenceFile('file://x/y'), /LOCAL_FILE_REQUIRED/)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dhv2-p7test-'))
  try {
    const f = path.join(dir, 'u.json'); writeFileSync(f, JSON.stringify(file([rec()])))
    assert.equal(readEvidenceFile(f).schema, USAGE_SCHEMA)
    const big = path.join(dir, 'big.json'); writeFileSync(big, ' '.repeat(1024 * 1024 + 1))
    assert.throws(() => readEvidenceFile(big), /TOO_LARGE/)
    try { symlinkSync(f, path.join(dir, 'link.json')); assert.throws(() => readEvidenceFile(path.join(dir, 'link.json')), /NOT_A_REGULAR_FILE/) } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('review M1: a task with a rejected record is partial and its cost is NOT MEASURED, never the sum of the survivors', () => {
  const r = importUsage(file([rec({ cost_usd: 0.5, cost_basis: 'billed' }), rec({ record_id: 'r2', input_tokens: -5, cost_usd: 9, cost_basis: 'billed' })]))
  const t = r.metrics.find((m) => m.name === 'model_tokens'); const c = r.metrics.find((m) => m.name === 'model_cost')
  assert.equal(t.quality, 'partial'); assert.equal(c.status, STATUS.NOT_MEASURED); assert.equal(c.value, null)
})

test('review M2: secrets are detected glued to names, quoted in JSON, and in newer key and URL shapes; token counts are not secrets', () => {
  const j = (a, b) => [a, b].join('')
  for (const s of [`CRON_SECRET=${'abcdefghij'}klmnop1234`, `SUPABASE_JWT_SECRET=${'x'.repeat(30)}`, `OPENAI_API_KEY=${'q'.repeat(24)}`, '"password": "hunter2hunter2hunter2"', j('sk-proj-', 'A1b2C3d4E5f6G7h8I9j0K1'), j('postgresql://u:', 'pw123456@db.example.com/x'), j('xox', 'b-1234567890-abcdef')]) assert.ok(containsSecret(s), s)
  for (const s of ['{"input_tokens":1000000000000}', 'output_tokens: 123456789012', 'model_tokens=119000000000']) assert.ok(!containsSecret(s), s)
  assert.deepEqual(importUsage(file([rec()], { id: 'CRON_SECRET=abcdefghijklmnop1234' })).file_errors.length > 0, true)
})

test('review L1/L2: oversized or odd ids reject one record, never abort the file or get echoed', () => {
  const t = importTaskRecords({ schema: TASKS_SCHEMA, records: [{ task_id: 'a', source_id: 'a'.repeat(501), started_at: T0, recorded_at: T1 }, { task_id: 'b', source_id: 'ok', started_at: T1, recorded_at: T0 }, { task_id: 'c', source_id: 'ok', started_at: T0, recorded_at: T1, surprise: 1 }, { task_id: 'd', source_id: 'ok', started_at: T0, recorded_at: T1, regressions: 1 }] })
  assert.equal(t.rejected.length, 3); assert.ok(t.metrics.every((m) => m.task_id === 'd'))
  const u = importUsage(file([rec({ record_id: `${'z'.repeat(900)}\n\u0007`, input_tokens: -1 })]))
  assert.equal(u.rejected[0].record_id, null)
  assert.deepEqual(importTaskRecords({ schema: TASKS_SCHEMA, records: [{ task_id: 'a', source_id: 'estimated_from_chars', started_at: T0, recorded_at: T1 }] }).file_errors, ['IMPORT.FORBIDDEN_SOURCE'])
})

test('review: a task whose every record was rejected is visible as NOT MEASURED; deduplication does not downgrade a clean total', () => {
  const r = importUsage(file([rec({ task_id: 'task-z', input_tokens: -1 }), rec({ record_id: 'r2', task_id: 'task-a' })]))
  const z = r.metrics.filter((m) => m.task_id === 'task-z'); assert.deepEqual(z.map((m) => m.status), [STATUS.NOT_MEASURED, STATUS.NOT_MEASURED])
  const d = importUsage(file([rec({ cost_usd: 1, cost_basis: 'billed' }), rec({ record_id: 'dup', cost_usd: 1, cost_basis: 'billed' })]))
  assert.equal(d.metrics.find((m) => m.name === 'model_cost').value, 1); assert.equal(d.metrics.find((m) => m.name === 'model_tokens').quality, 'complete')
})
