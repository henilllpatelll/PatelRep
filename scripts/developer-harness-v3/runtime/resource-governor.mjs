// Developer Harness V3 (D3.3) — Resource Governor.
//
// Deterministic admission, monitoring and recovery on top of D3.2's pure `admitTask`. Adds what a real host needs:
//   * profiles: starting the worker VM, starting a reasoning session inside it, a heavy test workload, deterministic controller work;
//   * hysteresis + sustained-pressure detection (a single spike does not flap admission; recovery needs a clear margin for several samples);
//   * immediate critical detection; unavailable metrics are never healthy;
//   * reservations: memory promised to a not-yet-materialized workload is subtracted from what is available; reservations expire with their lease;
//   * VM sizing that treats the owner's applications, WSL and Docker Desktop as UNOWNED load that the governor never touches.
// Thresholds are calibrated for the measured host in 13-host-calibration.md; `calibration_basis` says what was measured and what is a judgement.
import { admitTask } from '../lifecycle/resource-admission.mjs'

export const D33_THRESHOLDS = Object.freeze({
  calibrated: true,
  calibration_basis: 'host measurements 2026-11-24 (13-host-calibration.md): 16077 MB RAM, ~3.6 GB available under normal owner load, commit 57% of 35.5 GB, paging ~3 pages/s idle, CPU ~5%. Headroom/critical values are judgements anchored to those measurements, not stress-test results.',
  // Base admission (passed to D3.2 admitTask for HOST measurements of deterministic/reasoning work that runs while the VM already exists).
  min_available_mb_to_admit: 2048,
  critical_available_mb: 1024,
  max_commit_ratio: 0.85,
  max_paging_pages_per_sec: 1500,
  max_cpu_pct: 90,
  min_disk_free_gb: 40,
  max_reasoning_sessions: 1,
  max_heavy_test_workloads: 1,
  // VM sizing.
  vm_ram_ceiling_mb: 6144,
  vm_ram_floor_full_mb: 3072,
  vm_ram_floor_probe_mb: 768,
  vm_ram_step_mb: 256,
  // Expected QEMU process overhead beyond guest RAM (device model, slirp, and for TCG the 128 MB translation cache). The Job Object hard cap
  // (vm-controller.mjs) is set slightly above these so the cap stops a runaway, not normal operation.
  vm_overhead_mb: 384,
  vm_overhead_mb_tcg: 512,
  host_headroom_mb: 2048,
  vm_disk_virtual_gb: 24,
  // Guest-side admission.
  guest_min_available_mb_reasoning: 768,
  guest_min_available_mb_heavy: 1536,
  guest_max_psi_some_avg10: 20,
  // Hysteresis.
  sustain_samples: 3,
  clear_samples: 3,
  clear_margin_mb: 512,
  clear_margin_ratio: 0.03,
})

const BASE_KEYS = ['min_available_mb_to_admit', 'critical_available_mb', 'max_commit_ratio', 'max_paging_pages_per_sec', 'max_cpu_pct', 'min_disk_free_gb', 'max_reasoning_sessions', 'max_heavy_test_workloads']
export const baseThresholds = (t = D33_THRESHOLDS) => Object.freeze({ calibrated: t.calibrated, ...Object.fromEntries(BASE_KEYS.map((k) => [k, t[k]])) })

/** Sum of memory promised to workloads that are not yet visible in the measurements. Expired reservations do not count (and are released by `pruneReservations`). */
export function pendingReservedMb(reservations, now) {
  return (reservations ?? []).filter((r) => !r.materialized && Date.parse(r.expires_at) > now).reduce((s, r) => s + (Number.isFinite(r.mb) ? r.mb : 0), 0)
}
export const pruneReservations = (reservations, now) => (reservations ?? []).filter((r) => Date.parse(r.expires_at) > now)

/**
 * Pressure tracker with hysteresis. `history` is the controller's bounded list of recent host samples (oldest first).
 * - pressure ENTERS when the last `sustain_samples` samples are all below the admit line (sustained), or immediately when one is critical;
 * - pressure CLEARS only when the last `clear_samples` samples are all above the admit line plus margin.
 * Returns {state:'clear'|'pressure'|'critical', reasons}.
 */
export function pressureState(history, prev = 'clear', t = D33_THRESHOLDS) {
  const last = (history ?? []).slice(-Math.max(t.sustain_samples, t.clear_samples))
  if (!last.length) return { state: 'pressure', reasons: ['RESOURCE.NO_SAMPLES'] }
  const cur = last[last.length - 1]
  const missing = ['available_mb', 'commit_ratio', 'paging_pages_per_sec', 'cpu_pct', 'disk_free_gb'].filter((k) => !Number.isFinite(cur[k]))
  if (missing.length || cur.host_responsive !== true) return { state: 'pressure', reasons: [...missing.map((k) => `RESOURCE.METRIC_UNAVAILABLE:${k}`), ...(cur.host_responsive !== true ? ['RESOURCE.HOST_UNRESPONSIVE'] : [])] }
  if (cur.available_mb < t.critical_available_mb) return { state: 'critical', reasons: ['RESOURCE.MEMORY_CRITICAL'] }
  if (cur.disk_free_gb < t.min_disk_free_gb) return { state: 'critical', reasons: ['RESOURCE.DISK_LOW'] }
  // Every sample in a window is judged on ALL metrics; an incompletely measured sample is "bad" and can never count as "good" (null <= x is true in JS).
  const complete = (s) => ['available_mb', 'commit_ratio', 'paging_pages_per_sec', 'cpu_pct', 'disk_free_gb'].every((k) => Number.isFinite(s?.[k])) && s.host_responsive === true
  const bad = (s) => !complete(s) || s.available_mb < t.min_available_mb_to_admit || s.commit_ratio > t.max_commit_ratio || s.paging_pages_per_sec > t.max_paging_pages_per_sec || s.cpu_pct > t.max_cpu_pct
  const good = (s) => complete(s) && s.available_mb >= t.min_available_mb_to_admit + t.clear_margin_mb && s.commit_ratio <= t.max_commit_ratio - t.clear_margin_ratio && s.paging_pages_per_sec <= t.max_paging_pages_per_sec && s.cpu_pct <= t.max_cpu_pct
  const window = (n) => last.slice(-n)
  if (prev === 'clear') {
    const w = window(t.sustain_samples)
    return w.length >= t.sustain_samples && w.every(bad) ? { state: 'pressure', reasons: ['RESOURCE.SUSTAINED_PRESSURE'] } : { state: 'clear', reasons: [] }
  }
  const w = window(t.clear_samples)
  return w.length >= t.clear_samples && w.every(good) ? { state: 'clear', reasons: [] } : { state: 'pressure', reasons: ['RESOURCE.PRESSURE_NOT_CLEARED'] }
}

/**
 * Largest VM the host can take now without eating the owner's headroom, rounded down to the step; null when even `floor` does not fit.
 * Unowned load (owner apps, WSL, Docker Desktop) is simply part of "used"; nothing is reclaimed from it.
 */
export function sizeVm(sample, { floorMb, reservedMb = 0, accel = 'tcg' }, t = D33_THRESHOLDS) {
  if (!Number.isFinite(sample?.available_mb) || !Number.isFinite(sample?.committed_mb) || !Number.isFinite(sample?.commit_limit_mb)) return { ram_mb: null, reason: 'RESOURCE.METRIC_UNAVAILABLE' }
  const overhead = accel === 'whpx' ? t.vm_overhead_mb : t.vm_overhead_mb_tcg
  const byAvail = sample.available_mb - reservedMb - t.host_headroom_mb - overhead
  // The VM commits its full RAM at start; keep the post-start commit ratio under the ceiling.
  const byCommit = Math.floor(t.max_commit_ratio * sample.commit_limit_mb) - sample.committed_mb - overhead
  const fit = Math.min(t.vm_ram_ceiling_mb, byAvail, byCommit)
  const ram = Math.floor(fit / t.vm_ram_step_mb) * t.vm_ram_step_mb
  if (ram < floorMb) return { ram_mb: null, reason: byCommit < byAvail ? 'RESOURCE.COMMIT_HEADROOM_INSUFFICIENT' : 'RESOURCE.MEMORY_HEADROOM_INSUFFICIENT', fit_mb: Math.max(0, fit) }
  return { ram_mb: ram, reason: null, fit_mb: fit }
}

/**
 * The single admission entry point.
 * @param {'vm_start'|'reasoning'|'heavy_test'|'deterministic'} profile
 * @param {{host:object, history?:object[], prevPressure?:string, guest?:object, active:{reasoning_sessions:number, heavy_test_workloads:number}, reservations?:object[], now:number, vmFloor?:'full'|'probe'}} ctx
 */
export function admit(profile, ctx, t = D33_THRESHOLDS) {
  const codes = []
  const host = ctx.host ?? {}
  const reserved = pendingReservedMb(ctx.reservations, ctx.now)
  const effective = { ...host, available_mb: Number.isFinite(host.available_mb) ? host.available_mb - reserved : host.available_mb,
    reasoning_sessions_active: ctx.active?.reasoning_sessions, heavy_test_workloads_active: ctx.active?.heavy_test_workloads }
  const p = pressureState([...(ctx.history ?? []), host].slice(-8), ctx.prevPressure ?? 'clear', t)
  if (p.state === 'critical') return out('critical', [...p.reasons], { pressure: p.state, reserved_mb: reserved })
  // Deterministic controller work only needs a host that is not critical and measurable.
  if (profile === 'deterministic') return out(p.reasons.some((r) => r.startsWith('RESOURCE.METRIC_UNAVAILABLE') || r === 'RESOURCE.HOST_UNRESPONSIVE') ? 'wait' : 'admit', p.reasons.filter((r) => r.startsWith('RESOURCE.METRIC') || r === 'RESOURCE.HOST_UNRESPONSIVE'), { pressure: p.state, reserved_mb: reserved })
  if (p.state === 'pressure') codes.push(...p.reasons)
  const base = admitTask(effective, { heavy: profile === 'heavy_test', reasoning: profile === 'reasoning' }, baseThresholds(t))
  if (profile !== 'vm_start') codes.push(...base.reason_codes)
  else codes.push(...base.reason_codes.filter((c) => !['RESOURCE.MEMORY_LOW'].includes(c))) // VM start uses the sizing rule below instead of the generic admit line
  let vm = null
  if (profile === 'vm_start') {
    vm = sizeVm(host, { floorMb: ctx.vmFloor === 'probe' ? t.vm_ram_floor_probe_mb : t.vm_ram_floor_full_mb, reservedMb: reserved, accel: ctx.accel ?? 'tcg' }, t)
    if (vm.ram_mb == null) codes.push(vm.reason)
    if (Number.isFinite(host.disk_free_gb) && host.disk_free_gb < t.min_disk_free_gb + t.vm_disk_virtual_gb) codes.push('RESOURCE.DISK_INSUFFICIENT_FOR_VM')
  }
  if (profile === 'reasoning' || profile === 'heavy_test') {
    const g = ctx.guest
    const need = profile === 'heavy_test' ? t.guest_min_available_mb_heavy : t.guest_min_available_mb_reasoning
    if (!g || g.complete !== true || !Number.isFinite(g.mem_available_mb)) codes.push('RESOURCE.GUEST_METRIC_UNAVAILABLE')
    else {
      if (g.mem_available_mb < need) codes.push('RESOURCE.GUEST_MEMORY_LOW')
      if (Number.isFinite(g.psi_memory_some_avg10) && g.psi_memory_some_avg10 > t.guest_max_psi_some_avg10) codes.push('RESOURCE.GUEST_MEMORY_PRESSURE')
      if (Number.isFinite(g.disk_free_gb) && g.disk_free_gb < 2) codes.push('RESOURCE.GUEST_DISK_LOW')
    }
  }
  const critical = codes.includes('RESOURCE.MEMORY_CRITICAL') || codes.includes('RESOURCE.DISK_LOW')
  return out(codes.length === 0 ? 'admit' : critical ? 'critical' : 'wait', codes, { pressure: p.state, reserved_mb: reserved, vm_ram_mb: vm?.ram_mb ?? null })
  function out(decision, reason_codes, extra) {
    const uniq = [...new Set(reason_codes)]
    return { decision, state: decision === 'admit' ? 'running' : 'waiting_resources', lifecycle_reason: decision === 'admit' ? null : waitingReason(uniq), reason_codes: uniq, thresholds_calibrated: t.calibrated, ...extra }
  }
}

/** Map governor codes to the D3.2 lifecycle `waiting_resources` reasons. */
export function waitingReason(codes) {
  if (codes.some((c) => /DISK/.test(c))) return 'DISK_PRESSURE'
  if (codes.some((c) => /CPU/.test(c))) return 'CPU_PRESSURE'
  if (codes.some((c) => /HOST_UNRESPONSIVE|METRIC_UNAVAILABLE|NO_SAMPLES/.test(c))) return 'HOST_UNRESPONSIVE'
  return 'MEMORY_PRESSURE'
}

/**
 * Memory-bounded test execution plan inside the worker. One heavy workload at a time; Jest workers and Node heaps sized from MEASURED guest memory;
 * TypeScript and Playwright sequential/single-worker. Returns null when the guest measurement is missing (no guessing).
 */
export function planTestExecution(guest, { suite }, t = D33_THRESHOLDS) {
  if (!guest || !Number.isFinite(guest.mem_available_mb)) return null
  const budget = Math.max(0, guest.mem_available_mb - 512) // keep 512 MB for the guest OS and the reasoning session
  const heap = Math.max(512, Math.min(2048, Math.floor(budget / 2 / 256) * 256))
  const jestWorkers = Math.max(1, Math.min(2, Math.floor(budget / 1536)))
  const plans = {
    jest: { maxWorkers: jestWorkers, heap_mb: heap, args: [`--maxWorkers=${jestWorkers}`, '--workerIdleMemoryLimit=512MB'] },
    node_test: { heap_mb: heap, args: ['--test-concurrency=1'] },
    typescript: { heap_mb: Math.max(512, Math.min(heap * 2, budget - 256)), sequential: true, args: [] },
    playwright: { workers: 1, heap_mb: heap, args: ['--workers=1'] },
  }
  const p = plans[suite]
  if (!p) return null
  const needed = p.heap_mb * (p.maxWorkers ?? 1) + 256
  // Too little measured memory for even the minimum plan → no plan (the caller waits); never a cgroup cap below the heap it hosts.
  if (budget < needed) return null
  return { suite, ...p, node_options: `--max-old-space-size=${p.heap_mb}`, cgroup_memory_max_mb: Math.min(budget, p.heap_mb * (p.maxWorkers ?? 1) + 768), heavy: true, budget_mb: budget, thresholds_calibrated: t.calibrated }
}
