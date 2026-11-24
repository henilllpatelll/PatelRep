// Developer Harness V3 (D3.2) — Resource Governor admission decision (pure).
//
// Every number in DEFAULT_THRESHOLDS is a PROPOSED STARTING VALUE, not a measurement of the owner's hardware. `calibrated` stays false until
// D3.3 measures the real host. Inputs are measurements supplied by a future sampler; unavailable metrics are `null` and fail closed
// (a task is not admitted on a metric nobody could read). Memory pressure is a RECOVERABLE state (waiting_resources), never a failure.
export const DEFAULT_THRESHOLDS = Object.freeze({
  calibrated: false,
  min_available_mb_to_admit: 4096,      // proposed: admit new work only with at least 4 GB available
  critical_available_mb: 1536,
  max_commit_ratio: 0.85,
  max_paging_pages_per_sec: 1000,
  max_cpu_pct: 90,
  min_disk_free_gb: 20,
  max_reasoning_sessions: 1,
  max_heavy_test_workloads: 1,
})

const num = (x) => typeof x === 'number' && Number.isFinite(x)

/** @returns {{decision:'admit'|'wait'|'critical', state:'running'|'waiting_resources', reason_codes:string[], thresholds_calibrated:boolean}} */
export function admitTask(m, { heavy = false, reasoning = true } = {}, t = DEFAULT_THRESHOLDS) {
  const codes = []
  const need = (k) => { if (!num(m?.[k])) codes.push(`RESOURCE.METRIC_UNAVAILABLE:${k}`) }
  for (const k of ['available_mb', 'commit_ratio', 'paging_pages_per_sec', 'cpu_pct', 'disk_free_gb', 'reasoning_sessions_active', 'heavy_test_workloads_active']) need(k)
  if (m?.host_responsive !== true) codes.push('RESOURCE.HOST_UNRESPONSIVE')
  if (codes.length === 0) {
    if (m.available_mb < t.critical_available_mb) codes.push('RESOURCE.MEMORY_CRITICAL')
    else if (m.available_mb < t.min_available_mb_to_admit) codes.push('RESOURCE.MEMORY_LOW')
    if (m.commit_ratio > t.max_commit_ratio) codes.push('RESOURCE.COMMIT_HIGH')
    if (m.paging_pages_per_sec > t.max_paging_pages_per_sec) codes.push('RESOURCE.PAGING_HIGH')
    if (m.cpu_pct > t.max_cpu_pct) codes.push('RESOURCE.CPU_HIGH')
    if (m.disk_free_gb < t.min_disk_free_gb) codes.push('RESOURCE.DISK_LOW')
    if (reasoning && m.reasoning_sessions_active >= t.max_reasoning_sessions) codes.push('RESOURCE.REASONING_SESSION_LIMIT')
    if (heavy && m.heavy_test_workloads_active >= t.max_heavy_test_workloads) codes.push('RESOURCE.HEAVY_WORKLOAD_LIMIT')
  }
  const critical = codes.includes('RESOURCE.MEMORY_CRITICAL') || codes.includes('RESOURCE.DISK_LOW')
  return { decision: codes.length === 0 ? 'admit' : critical ? 'critical' : 'wait', state: codes.length === 0 ? 'running' : 'waiting_resources', reason_codes: codes, thresholds_calibrated: t.calibrated }
}
