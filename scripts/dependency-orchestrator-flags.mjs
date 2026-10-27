// Pure derivation of per-tick flags from the trigger. Only a human workflow_dispatch can START a
// `process` batch (or the schedule when policy explicitly says so); event-driven ticks can only continue.
const PR_LIST = /^\d+(,\d+){0,49}$/

export function parseRequestedPrs(text) {
  const value = String(text ?? '').replace(/\s+/g, '')
  return value === '' ? null : PR_LIST.test(value) ? value.split(',').map(Number).filter((n) => n > 0) : (() => { throw new Error('pr_numbers must be a comma-separated list of PR numbers') })()
}

export function deriveFlags({ env, policy, prior, now }) {
  const trigger = env.TRIGGER
  const base = { paused_var: env.PAUSED_VAR === 'true', requested_prs: parseRequestedPrs(env.INPUT_PR_NUMBERS), restart: false, start_batch: false, mode: prior?.batch.mode ?? 'plan-only', trigger }
  if (trigger === 'workflow_dispatch') {
    const process = env.INPUT_ACTION === 'process'
    return { ...base, start_batch: true, mode: process ? 'process' : 'plan-only', restart: env.INPUT_RESTART === 'true' }
  }
  if (trigger === 'schedule') {
    const date = new Date(now)
    const weekAgo = Date.parse(now) - 6 * 24 * 3600_000
    const recent = prior?.batch.started_at && Date.parse(prior.batch.started_at) > weekAgo
    if (policy.schedule.mode === 'plan-only') return { ...base, start_batch: !recent, mode: 'plan-only' }
    if (policy.schedule.mode === 'process' && date.getUTCDay() === policy.schedule.start_weekday_utc && date.getUTCHours() === policy.schedule.start_hour_utc && !recent) return { ...base, start_batch: true, mode: 'process' }
  }
  return base
}
