// Developer Harness V2 — Phase 7 evidence importer. Reads SANITIZED LOCAL evidence only; everything in it is untrusted data.
//
// Real model usage/cost only: provider usage reports, Claude Code usage output with provenance, or human billing records.
// Never character counts, file sizes, transcript lengths, OpenWolf's token ledger or assumed rates.
import { lstatSync, readFileSync } from 'node:fs'
import { STATUS, containsSecret, digestOf, makeMetric, notMeasured } from './schema.mjs'

export const USAGE_SCHEMA = 'developer-harness-v2/usage-evidence@1'
export const TASKS_SCHEMA = 'developer-harness-v2/task-records@1'
export const MAX_BYTES = 1024 * 1024
export const MAX_RECORDS = 5000
const SOURCE_TYPES = ['provider_usage_report', 'claude_code_usage_output', 'human_billing_record']
const BILLING_SOURCES = ['provider_usage_report', 'human_billing_record']
const TASK_KEYS = ['task_id', 'source_id', 'started_at', 'recorded_at', 'ready_at', 'regressions', 'failed_checks_before_green', 'human_interventions', 'first_review_accepted']
const RECORD_KEYS = ['record_id', 'task_id', 'model', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'cost_usd', 'cost_basis', 'derived_cost']
const TASK_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,80}$/
const FORBIDDEN_TEXT = /openwolf|token[-_ ]?ledger|character[-_ ]?(ratio|count)|chars?[-_ ]?per[-_ ]?token|estimated[-_ ]?from|assumed[-_ ]?rate/i
const SOURCE_ID = /^[A-Za-z0-9_.:/-]{1,200}$/
const safeId = (v) => (typeof v === 'string' && RECORD_ID.test(v) ? v : null)
const iso = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s))
const tokenInt = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1e10
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)

/** Read a local evidence file safely: no URLs, no symlinks, regular file, size-capped. Returns parsed JSON or throws. */
export function readEvidenceFile(file) {
  if (typeof file !== 'string' || !file || /^[a-z][a-z0-9+.-]*:\/\//i.test(file)) throw new Error('IMPORT.LOCAL_FILE_REQUIRED')
  const st = lstatSync(file)
  if (st.isSymbolicLink() || !st.isFile()) throw new Error('IMPORT.NOT_A_REGULAR_FILE')
  if (st.size > MAX_BYTES) throw new Error('IMPORT.TOO_LARGE')
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** @returns {{ok:boolean, file_errors:string[], accepted:object[], rejected:{record_id:string|null, codes:string[]}[], unattributed:object, by_task:object, metrics:object[], estimates:object[]}} */
export function importUsage(input) {
  const out = { ok: false, file_errors: [], accepted: [], rejected: [], unattributed: { records: 0, input_tokens: 0, output_tokens: 0 }, by_task: {}, metrics: [], estimates: [] }
  const fail = (c) => { out.file_errors.push(c); return out }
  if (!plain(input) || input.schema !== USAGE_SCHEMA) return fail('IMPORT.BAD_SCHEMA')
  for (const k of Object.keys(input)) if (!['schema', 'source', 'records'].includes(k)) return fail(`IMPORT.UNKNOWN_KEY.${k.slice(0, 30)}`)
  const text = JSON.stringify(input)
  if (Buffer.byteLength(text) > MAX_BYTES) return fail('IMPORT.TOO_LARGE')
  if (containsSecret(text)) return fail('IMPORT.SECRET_BEARING_INPUT')
  if (FORBIDDEN_TEXT.test(text)) return fail('IMPORT.FORBIDDEN_SOURCE')
  const s = input.source
  if (!plain(s) || !SOURCE_TYPES.includes(s.type)) return fail('IMPORT.UNSUPPORTED_SOURCE_TYPE')
  for (const k of Object.keys(s)) if (!['type', 'id', 'period'].includes(k)) return fail(`IMPORT.UNKNOWN_SOURCE_KEY.${k.slice(0, 30)}`)
  if (typeof s.id !== 'string' || !SOURCE_ID.test(s.id)) return fail('IMPORT.SOURCE_ID_REQUIRED')
  if (!plain(s.period) || !iso(s.period.start) || !iso(s.period.end) || Date.parse(s.period.start) > Date.parse(s.period.end)) return fail('IMPORT.PERIOD_REQUIRED')
  if (!Array.isArray(input.records) || input.records.length === 0 || input.records.length > MAX_RECORDS) return fail('IMPORT.RECORDS_INVALID')

  const seenIds = new Set()
  const tainted = new Set() // tasks that had a rejected record: their totals are incomplete
  const seenContent = new Set()
  for (const r of input.records) {
    const codes = []
    const id = plain(r) && typeof r.record_id === 'string' ? r.record_id : null
    if (!plain(r)) { out.rejected.push({ record_id: null, codes: ['RECORD.NOT_OBJECT'] }); continue }
    const claimedTask = typeof r.task_id === 'string' && TASK_ID.test(r.task_id) ? r.task_id : null
    for (const k of Object.keys(r)) if (!RECORD_KEYS.includes(k)) codes.push(`RECORD.UNKNOWN_KEY.${k.slice(0, 30)}`)
    if (!id || !RECORD_ID.test(id)) codes.push('RECORD.BAD_ID')
    if (id && seenIds.has(id)) codes.push('RECORD.DUPLICATE_ID')
    if (typeof r.model !== 'string' || !MODEL.test(r.model)) codes.push('RECORD.BAD_MODEL')
    if (!tokenInt(r.input_tokens) || !tokenInt(r.output_tokens)) codes.push('RECORD.BAD_TOKENS')
    for (const k of ['cache_read_tokens', 'cache_creation_tokens']) if (r[k] !== undefined && !tokenInt(r[k])) codes.push('RECORD.BAD_CACHE_TOKENS')
    // Attribution: exactly one concrete task, or explicitly null (unattributed). Lists, wildcards and "shared" are never split.
    if (r.task_id !== null && (typeof r.task_id !== 'string' || !TASK_ID.test(r.task_id) || ['all', 'shared', 'unknown', 'aggregate'].includes(r.task_id))) codes.push('RECORD.SHARED_OR_INVALID_ATTRIBUTION')
    if (r.cost_usd !== undefined) {
      if (typeof r.cost_usd !== 'number' || !Number.isFinite(r.cost_usd) || r.cost_usd < 0) codes.push('RECORD.BAD_COST')
      if (r.cost_basis !== 'billed') codes.push('RECORD.COST_WITHOUT_BILLED_BASIS')
      if (!BILLING_SOURCES.includes(s.type)) codes.push('RECORD.COST_FROM_NON_BILLING_SOURCE')
      if (r.derived_cost !== undefined) codes.push('RECORD.CONTRADICTORY_COST')
    } else if (r.cost_basis !== undefined) codes.push('RECORD.BASIS_WITHOUT_COST')
    if (r.derived_cost !== undefined) {
      const d = r.derived_cost
      if (!plain(d) || typeof d.usd !== 'number' || !Number.isFinite(d.usd) || d.usd < 0 || typeof d.rate_source !== 'string' || !d.rate_source.trim() || !iso(d.rate_date)) codes.push('RECORD.DERIVED_COST_NEEDS_SOURCED_RATE')
    }
    const { record_id, ...content } = r
    const contentKey = digestOf(content)
    if (!codes.length && seenContent.has(contentKey)) codes.push('RECORD.DUPLICATE_CONTENT')
    if (id) seenIds.add(id)
    if (codes.length) { out.rejected.push({ record_id: safeId(id), codes }); if (claimedTask && !codes.every((c) => c === 'RECORD.DUPLICATE_CONTENT')) tainted.add(claimedTask); continue }
    seenContent.add(contentKey)
    out.accepted.push({ record_id: id, task_id: r.task_id, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cache_read_tokens: r.cache_read_tokens ?? null, cache_creation_tokens: r.cache_creation_tokens ?? null, cost_usd: r.cost_usd ?? null, derived_cost: r.derived_cost ?? null })
  }

  const window = { start: s.period.start, end: s.period.end }
  const common = { window, source_id: s.id, population: 'real_task', quality: 'complete' }
  for (const r of out.accepted) {
    if (r.task_id === null) { out.unattributed.records++; out.unattributed.input_tokens += r.input_tokens; out.unattributed.output_tokens += r.output_tokens; continue }
    const t = (out.by_task[r.task_id] ??= { records: [], models: new Set() })
    t.records.push(r); t.models.add(r.model)
  }
  for (const [task, t] of Object.entries(out.by_task)) {
    const inTok = t.records.reduce((n, r) => n + r.input_tokens, 0)
    const outTok = t.records.reduce((n, r) => n + r.output_tokens, 0)
    const cacheKnown = t.records.every((r) => r.cache_read_tokens !== null && r.cache_creation_tokens !== null)
    out.metrics.push(makeMetric({ ...common, name: 'model_tokens', value: inTok + outTok, unit: 'tokens', status: STATUS.MEASURED, source_type: s.type, quality: tainted.has(task) ? 'partial' : 'complete', methodology: 'Sum of input+output tokens from supplied provider-level usage records; cache categories reported separately.', task_id: task, breakdown: { input: inTok, output: outTok, cache_read: cacheKnown ? t.records.reduce((n, r) => n + r.cache_read_tokens, 0) : null, cache_creation: cacheKnown ? t.records.reduce((n, r) => n + r.cache_creation_tokens, 0) : null, models: [...t.models].sort() } }))
    const billed = !tainted.has(task) && t.records.every((r) => r.cost_usd !== null)
    if (billed) out.metrics.push(makeMetric({ ...common, name: 'model_cost', value: t.records.reduce((n, r) => n + r.cost_usd, 0), unit: 'usd', status: STATUS.MEASURED, source_type: s.type, methodology: 'Sum of billed per-record cost supplied by the billing source.', task_id: task }))
    else out.metrics.push(notMeasured('model_cost', 'Billed cost was not supplied for every usage record of this task (or a record was rejected); missing cost is never treated as $0.', { task_id: task }))
    const derived = t.records.filter((r) => r.derived_cost)
    if (derived.length === t.records.length) out.estimates.push(makeMetric({ ...common, name: 'model_cost', value: derived.reduce((n, r) => n + r.derived_cost.usd, 0), unit: 'usd', status: STATUS.ESTIMATE, source_type: s.type, methodology: `DERIVED from tokens with explicitly sourced rate(s): ${[...new Set(derived.map((r) => `${r.derived_cost.rate_source}@${r.derived_cost.rate_date}`))].join('; ')}`, quality: 'partial', task_id: task }))
  }
  for (const task of tainted) {
    if (out.by_task[task]) continue
    out.metrics.push(notMeasured('model_tokens', 'Every usage record claimed for this task was rejected.', { task_id: task }))
    out.metrics.push(notMeasured('model_cost', 'Every usage record claimed for this task was rejected.', { task_id: task }))
  }
  out.ok = out.accepted.length > 0
  return out
}

/** Sanitized per-task records from the human (e.g. built from GitHub check history). Absent fields stay NOT MEASURED. */
export function importTaskRecords(input) {
  const out = { ok: false, file_errors: [], rejected: [], metrics: [] }
  const fail = (c) => { out.file_errors.push(c); return out }
  if (!plain(input) || input.schema !== TASKS_SCHEMA) return fail('IMPORT.BAD_SCHEMA')
  const text = JSON.stringify(input)
  if (Buffer.byteLength(text) > MAX_BYTES) return fail('IMPORT.TOO_LARGE')
  if (containsSecret(text)) return fail('IMPORT.SECRET_BEARING_INPUT')
  if (FORBIDDEN_TEXT.test(text)) return fail('IMPORT.FORBIDDEN_SOURCE')
  if (!Array.isArray(input.records) || input.records.length === 0 || input.records.length > MAX_RECORDS) return fail('IMPORT.RECORDS_INVALID')
  const seen = new Set()
  const count = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1e6
  for (const r of input.records) {
    const codes = []
    if (!plain(r)) { out.rejected.push({ task_id: null, codes: ['RECORD.NOT_OBJECT'] }); continue }
    if (typeof r.task_id !== 'string' || !TASK_ID.test(r.task_id)) codes.push('RECORD.BAD_TASK_ID')
    else if (seen.has(r.task_id)) codes.push('RECORD.DUPLICATE_TASK')
    for (const k of Object.keys(r)) if (!TASK_KEYS.includes(k)) codes.push(`RECORD.UNKNOWN_KEY.${k.slice(0, 30)}`)
    if (typeof r.source_id !== 'string' || !SOURCE_ID.test(r.source_id)) codes.push('RECORD.SOURCE_REQUIRED')
    if (!iso(r.started_at) || !iso(r.recorded_at) || Date.parse(r.started_at) > Date.parse(r.recorded_at)) codes.push('RECORD.TIMESTAMPS_REQUIRED')
    for (const k of ['regressions', 'failed_checks_before_green', 'human_interventions']) if (r[k] !== undefined && !count(r[k])) codes.push(`RECORD.BAD_${k.toUpperCase()}`)
    if (r.ready_at !== undefined && (!iso(r.ready_at) || Date.parse(r.ready_at) < Date.parse(r.started_at))) codes.push('RECORD.BAD_READY_AT')
    if (r.first_review_accepted !== undefined && typeof r.first_review_accepted !== 'boolean') codes.push('RECORD.BAD_FIRST_REVIEW_ACCEPTED')
    if (codes.length) { out.rejected.push({ task_id: typeof r.task_id === 'string' ? r.task_id.slice(0, 64) : null, codes }); continue }
    seen.add(r.task_id)
    try {
    const base = { window: { start: r.started_at, end: r.recorded_at }, source_type: 'task_record', source_id: r.source_id, population: 'real_task', quality: 'partial', task_id: r.task_id }
    const m = (name, value, unit, how) => (value === undefined ? notMeasured(name, 'Field not supplied for this task.', { task_id: r.task_id }) : makeMetric({ ...base, name, value, unit, status: STATUS.MEASURED, methodology: how }))
    out.metrics.push(m('regressions', r.regressions, 'count', 'Human-recorded count attributed to this task.'))
    out.metrics.push(m('failed_checks_before_green', r.failed_checks_before_green, 'count', 'Failed CI Gate runs for this task before green, as recorded by the human.'))
    out.metrics.push(m('human_interventions', r.human_interventions, 'count', 'Human corrections recorded for this task.'))
    out.metrics.push(m('time_to_ready', r.ready_at === undefined ? undefined : (Date.parse(r.ready_at) - Date.parse(r.started_at)) / 1000, 'seconds', 'ready_at minus started_at from recorded timestamps.'))
    out.metrics.push(m('task_completion', r.first_review_accepted === undefined ? undefined : (r.first_review_accepted ? 1 : 0), 'tasks', 'Human-recorded acceptance at first review.'))
    } catch { out.rejected.push({ task_id: r.task_id.slice(0, 64), codes: ['RECORD.METRIC_INVALID'] }) }
  }
  out.ok = out.metrics.length > 0
  return out
}
