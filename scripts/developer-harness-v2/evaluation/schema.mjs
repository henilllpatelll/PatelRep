// Developer Harness V2 — Phase 7 metric schema. Pure: no I/O, no network, no process spawning.
//
// Every metric is MEASURED (a real observation with a named source), ESTIMATE (explicitly derived, never mixed with
// measured values) or NOT MEASURED (value is null and a reason is given). Missing data is never coerced to zero.
import { createHash } from 'node:crypto'

export const STATUS = Object.freeze({ MEASURED: 'MEASURED', ESTIMATE: 'ESTIMATE', NOT_MEASURED: 'NOT MEASURED' })
/** Where a number came from. `fixture_benchmark` and `reported_prior` are NEVER real-task evidence. */
export const POPULATIONS = Object.freeze(['real_task', 'synthetic_fixture', 'reported_prior'])
export const SOURCE_TYPES = Object.freeze([
  'provider_usage_report', 'claude_code_usage_output', 'human_billing_record', 'github_check_history', 'task_record',
  'fixture_benchmark', 'repository_document', 'none',
])
/** Sources that must never become measured usage or cost, whatever a record claims. */
export const FORBIDDEN_SOURCES = Object.freeze(['openwolf_token_ledger', 'token-ledger', 'character_count', 'file_size', 'transcript_length', 'prompt_length', 'assumed_rate'])
export const QUALITY = Object.freeze(['complete', 'partial', 'unknown'])

export const METRICS = Object.freeze({
  task_completion: 'tasks', regressions: 'count', failed_checks_before_green: 'count', policy_violations_attempted: 'count',
  policy_violations_blocked: 'count', human_interventions: 'count', recovery_correct: 'count', model_tokens: 'tokens',
  model_cost: 'usd', time_to_ready: 'seconds', review_findings: 'count', false_positive_blocks: 'count',
})

const SECRET_RES = [
  // No leading \b on prefixed tokens: a secret glued to a word ("msk_live_…") must still be caught.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /[sr]k[-_](live|test)[-_][A-Za-z0-9_-]{12,}/, /whsec_[A-Za-z0-9]{16,}/, /AKIA[0-9A-Z]{16}/,
  /sbp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /gh[pousr]_[A-Za-z0-9]{30,}/, /sk-ant-[A-Za-z0-9_-]{16,}/, /sk-[A-Za-z0-9]{32,}/,
  /sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/, /postgres(?:ql)?:\/\/[^:\s/@]{1,128}:[^@\s]{1,256}@/i, /xox[abprs]-[A-Za-z0-9-]{10,}/, /AIza[0-9A-Za-z_-]{30,}/,
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}/,
  // key names may be glued to prefixes (CRON_SECRET=…) and quoted (JSON "password": "…")
  /(?:api[_-]?key|secret|token|password|passwd|credential)s?["']?\s*[:=]\s*["']?(?=[A-Za-z0-9/+_.-]{12,})[A-Za-z0-9/+_.-]*[A-Za-z][A-Za-z0-9/+_.-]*/i,
]
// Every pattern is bounded: an adversarial 1 MB input must not cause quadratic backtracking (see the timing test).
export const containsSecret = (text) => SECRET_RES.some((re) => re.test(String(text)))
export const redactSecrets = (text) => SECRET_RES.reduce((t, re) => t.replace(new RegExp(re.source, `${re.flags.replace('g', '')}g`), '[REDACTED]'), String(text))

/** Deep-redact every string in a JSON-able value; returns { value, redactions }. */
export function redactDeep(v) {
  let redactions = 0
  const walk = (x) => {
    if (typeof x === 'string') { const r = redactSecrets(x); if (r !== x) redactions++; return r }
    if (Array.isArray(x)) return x.map(walk)
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, walk(val)]))
    return x
  }
  return { value: walk(v), redactions }
}

export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}
export const sha256 = (s) => createHash('sha256').update(s).digest('hex')
export const digestOf = (v) => sha256(canonical(v))

const isIso = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s))
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 500

/** Throws RangeError on an invalid metric: an invalid record is never silently repaired. */
export function makeMetric(m) {
  const bad = (why) => { throw new RangeError(`metric ${String(m?.name)}: ${why}`) }
  if (!m || typeof m !== 'object') bad('not an object')
  if (!(m.name in METRICS)) bad('unknown metric name')
  if (!Object.values(STATUS).includes(m.status)) bad('unknown status')
  if (m.unit !== METRICS[m.name]) bad(`unit must be ${METRICS[m.name]}`)
  if (!POPULATIONS.includes(m.population)) bad('unknown population')
  if (!SOURCE_TYPES.includes(m.source_type)) bad('unknown source_type')
  if (FORBIDDEN_SOURCES.includes(m.source_type) || FORBIDDEN_SOURCES.includes(m.source_id)) bad('forbidden source')
  if (!QUALITY.includes(m.quality)) bad('unknown quality')
  if (!nonEmpty(m.methodology)) bad('methodology required')
  if (m.status === STATUS.NOT_MEASURED) {
    if (m.value !== null) bad('NOT MEASURED must have a null value')
    if (!nonEmpty(m.reason)) bad('NOT MEASURED needs a reason')
  } else {
    if (typeof m.value !== 'number' || !Number.isFinite(m.value) || m.value < 0) bad('value must be a finite non-negative number')
    if (m.source_type === 'none' || !nonEmpty(m.source_id)) bad('a value needs a named source')
    if (!(isIso(m.window?.start) && isIso(m.window?.end)) && !isIso(m.window?.at)) bad('measurement window or timestamp required')
    if (m.status === STATUS.MEASURED && ['reported_prior'].includes(m.population) && m.source_type !== 'repository_document') bad('prior reports must cite a repository document')
    if (m.denominator !== undefined && (!Number.isInteger(m.denominator) || m.denominator < 0 || m.value > m.denominator)) bad('invalid denominator')
  }
  return Object.freeze({ ...m, window: m.window ? Object.freeze({ ...m.window }) : null })
}

export const notMeasured = (name, reason, extra = {}) => makeMetric({
  name, value: null, unit: METRICS[name], status: STATUS.NOT_MEASURED, source_type: 'none', source_id: null, window: null,
  methodology: 'No qualifying evidence was available.', quality: 'unknown', population: 'real_task', reason, ...extra,
})

/** Aggregate numeric metrics. NOT MEASURED entries are counted as missing, never as zero; ESTIMATEs never join MEASURED totals. */
export function aggregate(metrics) {
  const measured = metrics.filter((m) => m.status === STATUS.MEASURED)
  const estimates = metrics.filter((m) => m.status === STATUS.ESTIMATE)
  const missing = metrics.filter((m) => m.status === STATUS.NOT_MEASURED).length
  const sum = (a) => (a.length ? a.reduce((s, m) => s + m.value, 0) : null)
  return { measured_n: measured.length, estimate_n: estimates.length, missing_n: missing, measured_sum: sum(measured), estimate_sum: sum(estimates), complete: missing === 0 && estimates.length === 0 && measured.length > 0 }
}

export const ratio = (num, den) => (Number.isInteger(num) && Number.isInteger(den) && den > 0 ? { numerator: num, denominator: den, value: num / den } : { numerator: num ?? null, denominator: den ?? null, value: null, reason: 'zero or unknown denominator' })
