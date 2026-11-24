// D3.3 Resource Governor + samplers (pure; fixture numbers modelled on the measured host, NOT stress results).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { admit, D33_THRESHOLDS as T, planTestExecution, pendingReservedMb, pressureState, pruneReservations, sizeVm, waitingReason } from '../runtime/resource-governor.mjs'
import { cpuPctFromProcStat, deriveHostMetrics, parseDf, parseGuestSample, parseMeminfo, parsePressure, parseTasklist, parseTypeperf } from '../runtime/host-sampler.mjs'
import { DEFAULT_THRESHOLDS } from '../lifecycle/resource-admission.mjs'

const NOW = Date.parse('2026-11-24T21:00:00Z')
const host = (o = {}) => ({ available_mb: 9000, commit_ratio: 0.55, committed_mb: 20000, commit_limit_mb: 36000, paging_pages_per_sec: 5, cpu_pct: 8, disk_free_gb: 400, host_responsive: true, ...o })
const ctx = (o = {}) => ({ host: host(), history: [], active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, reservations: [], now: NOW, guest: { complete: true, mem_available_mb: 3000, psi_memory_some_avg10: 0, disk_free_gb: 15 }, ...o })

test('D3.2 proposed thresholds are untouched; D3.3 calibrated thresholds are labelled with their basis', () => {
  assert.equal(DEFAULT_THRESHOLDS.calibrated, false)
  assert.equal(T.calibrated, true)
  assert.match(T.calibration_basis, /16077 MB/)
  assert.equal(T.max_reasoning_sessions, 1); assert.equal(T.max_heavy_test_workloads, 1)
})

test('typeperf CSV parsing matches by counter path and uses the last sample; garbage is null, never 0', () => {
  const csv = '"(PDH-CSV 4.0)","\\\\H\\Memory\\Available MBytes","\\\\H\\Memory\\Committed Bytes","\\\\H\\Memory\\Commit Limit","\\\\H\\Memory\\Pages/sec","\\\\H\\Processor(_Total)\\% Processor Time"\r\n"11/24/2026 20:51:12.000","3400","21000000000","37259567104","0","0"\r\n"11/24/2026 20:51:13.000","3361","21400000000","37259567104","104.8","8.5"\r\n'
  const r = parseTypeperf(csv)
  assert.deepEqual(r, { available_mb: 3361, committed_bytes: 21400000000, commit_limit_bytes: 37259567104, paging_pages_per_sec: 104.8, cpu_pct: 8.5 })
  const m = deriveHostMetrics(r, { diskFreeBytes: 412 * 1073741824 })
  assert.equal(m.commit_ratio, 0.5743); assert.equal(m.disk_free_gb, 412)
  assert.deepEqual(Object.values(parseTypeperf('error')), [null, null, null, null, null])
  assert.equal(parseTypeperf(csv.replace('"8.5"', '" "')).cpu_pct, null)
  assert.equal(deriveHostMetrics({ ...r, commit_limit_bytes: 0 }).commit_ratio, null)
})

test('tasklist / meminfo / PSI / df / proc-stat parsers', () => {
  assert.deepEqual(parseTasklist('"qemu-system-x86_64.exe","4242","Console","1","1,234,567 K"\r\n"firefox.exe","10","Console","1","9 K"', [4242]), { 4242: { image: 'qemu-system-x86_64.exe', working_set_mb: 1206 } })
  assert.deepEqual(parseMeminfo('MemTotal:        1009000 kB\nMemAvailable:     700000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB'), { mem_total_mb: 985, mem_available_mb: 684, swap_total_mb: 0, swap_free_mb: 0 })
  assert.equal(parsePressure('some avg10=1.50 avg60=0.20 avg300=0.00 total=1\nfull avg10=0.10 avg60=0.00 avg300=0.00 total=1').some_avg10, 1.5)
  assert.equal(parsePressure('').some_avg10, null)
  assert.deepEqual(parseDf(' Avail  1B-blocks\n 5000 9000\n'), { avail_bytes: 5000, size_bytes: 9000 })
  assert.equal(cpuPctFromProcStat('cpu 100 0 100 800 0 0 0 0 0 0', 'cpu 150 0 150 900 0 0 0 0 0 0'), 50)
  assert.equal(cpuPctFromProcStat('x', 'y'), null)
  assert.equal(parseGuestSample('MemTotal: 1 kB').complete, false)
})

test('hysteresis: one dip does not enter pressure; a sustained dip does; recovery needs a margin for several samples', () => {
  const low = host({ available_mb: 1800 }); const ok = host({ available_mb: 2100 }); const good = host({ available_mb: 4000 })
  assert.equal(pressureState([good, good, low], 'clear').state, 'clear')
  assert.equal(pressureState([low, low, low], 'clear').state, 'pressure')
  assert.equal(pressureState([low, low, low, ok, ok, ok], 'pressure').state, 'pressure', 'above the line but inside the margin is not "cleared"')
  assert.equal(pressureState([low, good, good, good], 'pressure').state, 'clear')
  assert.equal(pressureState([good, host({ available_mb: 900 })], 'clear').state, 'critical', 'critical is immediate')
  assert.equal(pressureState([host({ disk_free_gb: 10 })], 'clear').state, 'critical')
})

test('missing or unresponsive measurements are never healthy', () => {
  for (const k of ['available_mb', 'commit_ratio', 'paging_pages_per_sec', 'cpu_pct', 'disk_free_gb']) {
    const p = pressureState([host({ [k]: null })], 'clear')
    assert.equal(p.state, 'pressure'); assert.ok(p.reasons.includes(`RESOURCE.METRIC_UNAVAILABLE:${k}`))
    assert.notEqual(admit('reasoning', ctx({ host: host({ [k]: null }) })).decision, 'admit')
  }
  assert.ok(admit('reasoning', ctx({ host: host({ host_responsive: false }) })).reason_codes.includes('RESOURCE.HOST_UNRESPONSIVE'))
  assert.equal(admit('reasoning', ctx({ guest: null })).decision, 'wait')
  assert.equal(pressureState([], 'clear').state, 'pressure')
})

test('VM sizing on the measured laptop: full worker waits, probe fits only with headroom, WSL/Docker load is never "reclaimed"', () => {
  const measured = host({ available_mb: 3361, committed_mb: 21400, commit_limit_mb: 35533 })
  assert.equal(sizeVm(measured, { floorMb: T.vm_ram_floor_full_mb }).ram_mb, null)
  assert.equal(sizeVm(measured, { floorMb: T.vm_ram_floor_probe_mb }).ram_mb, 768)
  const idle = host({ available_mb: 11000, committed_mb: 12000, commit_limit_mb: 35533 })
  assert.equal(sizeVm(idle, { floorMb: T.vm_ram_floor_full_mb }).ram_mb, T.vm_ram_ceiling_mb, 'the ceiling caps, it is not a target')
  assert.equal(sizeVm(host({ available_mb: 11000, committed_mb: 29000, commit_limit_mb: 35533 }), { floorMb: 3072 }).reason, 'RESOURCE.COMMIT_HEADROOM_INSUFFICIENT')
  assert.equal(sizeVm({ available_mb: null }, { floorMb: 768 }).reason, 'RESOURCE.METRIC_UNAVAILABLE')
})

test('reservations: pending memory is subtracted, expired reservations are released, materialized ones are not double counted', () => {
  const res = [{ mb: 2000, materialized: false, expires_at: new Date(NOW + 60000).toISOString() }, { mb: 3000, materialized: true, expires_at: new Date(NOW + 60000).toISOString() }, { mb: 9000, materialized: false, expires_at: new Date(NOW - 1).toISOString() }]
  assert.equal(pendingReservedMb(res, NOW), 2000)
  assert.equal(pruneReservations(res, NOW).length, 2)
  assert.equal(admit('vm_start', ctx({ host: host({ available_mb: 6000 }), reservations: res, vmFloor: 'probe' })).vm_ram_mb, 1280)
  assert.equal(admit('vm_start', ctx({ host: host({ available_mb: 6000 }), reservations: res })).vm_ram_mb, null, '4000 MB effective cannot host a full worker')
})

test('profiles: one reasoning session, one heavy workload; deterministic work continues under (non-critical) pressure; critical stops everything', () => {
  assert.equal(admit('reasoning', ctx()).decision, 'admit')
  assert.ok(admit('reasoning', ctx({ active: { reasoning_sessions: 1, heavy_test_workloads: 0 } })).reason_codes.includes('RESOURCE.REASONING_SESSION_LIMIT'))
  assert.ok(admit('heavy_test', ctx({ active: { reasoning_sessions: 1, heavy_test_workloads: 1 } })).reason_codes.includes('RESOURCE.HEAVY_WORKLOAD_LIMIT'))
  const lowHist = [host({ available_mb: 1500 }), host({ available_mb: 1500 })]
  const p = admit('reasoning', ctx({ host: host({ available_mb: 1500 }), history: lowHist }))
  assert.equal(p.decision, 'wait'); assert.equal(p.state, 'waiting_resources'); assert.equal(p.lifecycle_reason, 'MEMORY_PRESSURE')
  assert.equal(admit('deterministic', ctx({ host: host({ available_mb: 1500 }), history: lowHist })).decision, 'admit')
  const c = admit('deterministic', ctx({ host: host({ available_mb: 800 }) }))
  assert.equal(c.decision, 'critical'); assert.equal(c.lifecycle_reason, 'MEMORY_PRESSURE')
  assert.equal(admit('heavy_test', ctx({ guest: { complete: true, mem_available_mb: 1000 } })).reason_codes.includes('RESOURCE.GUEST_MEMORY_LOW'), true)
  assert.equal(admit('reasoning', ctx({ guest: { complete: true, mem_available_mb: 3000, psi_memory_some_avg10: 55 } })).reason_codes.includes('RESOURCE.GUEST_MEMORY_PRESSURE'), true)
  assert.equal(admit('vm_start', ctx({ host: host({ disk_free_gb: 50 }) })).reason_codes.includes('RESOURCE.DISK_INSUFFICIENT_FOR_VM'), true)
})

test('waiting reasons map only onto D3.2 lifecycle waiting_resources reasons', () => {
  assert.equal(waitingReason(['RESOURCE.DISK_LOW']), 'DISK_PRESSURE')
  assert.equal(waitingReason(['RESOURCE.CPU_HIGH']), 'CPU_PRESSURE')
  assert.equal(waitingReason(['RESOURCE.METRIC_UNAVAILABLE:cpu_pct']), 'HOST_UNRESPONSIVE')
  assert.equal(waitingReason(['RESOURCE.MEMORY_LOW']), 'MEMORY_PRESSURE')
})

test('memory-bounded test plans come from measured guest memory; unknown memory → no plan', () => {
  assert.equal(planTestExecution(null, { suite: 'jest' }), null)
  assert.equal(planTestExecution({ mem_available_mb: 3000 }, { suite: 'unknown' }), null)
  const j = planTestExecution({ mem_available_mb: 3000 }, { suite: 'jest' })
  assert.equal(j.maxWorkers, 1); assert.match(j.node_options, /^--max-old-space-size=\d+$/); assert.ok(j.cgroup_memory_max_mb <= 2488)
  assert.equal(planTestExecution({ mem_available_mb: 6000 }, { suite: 'jest' }).maxWorkers, 2)
  assert.deepEqual(planTestExecution({ mem_available_mb: 3000 }, { suite: 'playwright' }).args, ['--workers=1'])
  assert.equal(planTestExecution({ mem_available_mb: 3000 }, { suite: 'typescript' }).sequential, true)
})

test('remediation: an incompletely measured OLDER sample can never count as "good" or hold "clear"', () => {
  const good = host({ available_mb: 4000 })
  for (const k of ['cpu_pct', 'commit_ratio', 'paging_pages_per_sec']) {
    assert.equal(pressureState([host({ [k]: null }), good, good, good], 'pressure').state, 'clear', 'window of last 3 is complete')
    assert.equal(pressureState([good, host({ [k]: null }), good], 'pressure').state, 'pressure', `${k}=null inside the window blocks clearing`)
  }
  assert.equal(pressureState([good, host({ host_responsive: false }), good], 'pressure').state, 'pressure')
  assert.equal(pressureState([host({ cpu_pct: null }), host({ cpu_pct: null }), good], 'clear').state, 'clear', 'one good newest sample after unknowns does not sustain pressure')
  assert.equal(planTestExecution({ mem_available_mb: 900 }, { suite: 'jest' }), null, 'too little measured memory → no plan, the caller waits')
  const ts = planTestExecution({ mem_available_mb: 1800 }, { suite: 'typescript' })
  assert.ok(ts.heap_mb <= ts.budget_mb && ts.cgroup_memory_max_mb >= ts.heap_mb)
})
