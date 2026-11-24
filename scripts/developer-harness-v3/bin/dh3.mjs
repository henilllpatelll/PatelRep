#!/usr/bin/env node
// Developer Harness V3 (D3.3) - owner/operator CLI. INACTIVE: nothing here starts autonomous work or Bypass Permissions.
//
//   node scripts/developer-harness-v3/bin/dh3.mjs <command> [options]
//   doctor | setup [--dry-run] | provision [--ram MB] | start | stop | status | reset | monitor [--samples N] | login | auth-check
//   attest-extra-usage-off | probe-subscription | verify-isolation | remove [--dry-run]
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { atomicWriteJson, readJsonState } from '../lib/atomic.mjs'
import { defaultRoot, layout } from '../infra/layout.mjs'
import { rollback, setup } from '../infra/setup.mjs'
import { provision, readProvisioned, startTaskWorker } from '../infra/provision.mjs'
import { sampleWindowsHost } from '../runtime/host-sampler.mjs'
import { admit, D33_THRESHOLDS } from '../runtime/resource-governor.mjs'
import { POWERSHELL, liveness, readVmConfig, readVmRecord, run, sshArgs, sshExec, stopVm, sysEnv } from '../runtime/vm-controller.mjs'
import { GOVERNOR_DEFAULTS, normalizeAuthStatus } from '../runtime/subscription-governor.mjs'
import { sanitizeTerminal, loginOutputProblems } from '../runtime/login-relay.mjs'
import { loadContractFile } from '../authority/contract.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d }
/** A custom --root must look like a D3.3 root (...\PatelRep\dh3[-suffix]); `remove` deletes recursively, so an arbitrary folder is refused. */
function resolveRoot() {
  const r = opt('root')
  if (r === null) return defaultRoot()
  const abs = path.resolve(String(r))
  if (!/[\\/]PatelRep[\\/]dh3(-[a-z0-9-]+)?$/i.test(abs)) { console.error('refusing --root: it must end in \\PatelRep\\dh3 (or dh3-<suffix>)'); process.exit(2) }
  return abs
}
const L = layout(resolveRoot())
const ID = String(opt('id', 'w1'))
const W = L.worker(ID)
const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2))

/** Windows Hypervisor Platform (the QEMU WHPX accelerator). Read-only CIM query; no elevation. */
export function whpxState() {
  const r = run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', "(Get-CimInstance Win32_OptionalFeature -Filter \"Name='HypervisorPlatform'\").InstallState"], { timeoutMs: 60000 })
  const v = r.out.trim(); return v === '1' ? 'enabled' : v === '2' ? 'disabled' : 'unknown'
}

function vbsState() {
  const r = run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', '$d=Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard; "$($d.VirtualizationBasedSecurityStatus)|$($d.SecurityServicesRunning -join \',\')"'], { timeoutMs: 60000 })
  const [vbs, svc] = r.out.trim().split('|'); return { vbs_running: vbs === '2', hvci_running: (svc ?? '').split(',').includes('2') }
}

function acSleepNever() {
  const r = run('powercfg', ['/q', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE'], { timeoutMs: 30000 })
  const m = /Current AC Power Setting Index: 0x([0-9a-f]+)/i.exec(r.out); return m ? Number.parseInt(m[1], 16) === 0 : null
}

async function hostSample() { return sampleWindowsHost({ diskPath: L.root.slice(0, 3) }) }

async function doctor() {
  const checks = []; const add = (ok, code, detail, fix = null) => checks.push({ ok, code, detail, ...(fix ? { fix } : {}) })
  const major = Number(process.versions.node.split('.')[0])
  add(major >= 22, 'NODE.VERSION', process.versions.node, 'install Node.js 22+')
  add(process.platform === 'win32', 'HOST.PLATFORM', process.platform)
  add(existsSync(L.qemu), 'RUNTIME.QEMU', existsSync(L.qemu) ? run(L.qemu, ['--version']).out.split(/\r?\n/)[0] : 'absent', 'run: dh3 setup')
  add(existsSync(L.baseImage) && existsSync(L.claudePackage), 'RUNTIME.ARTIFACTS', 'base image + Claude Linux package', 'run: dh3 setup')
  const whpx = whpxState()
  add(whpx === 'enabled', 'RUNTIME.WHPX', whpx, 'OWNER-ONLY (admin + reboot): see 16-owner-setup-and-recovery.md section 2 "Enable Windows Hypervisor Platform". Until then the VM runs with slow TCG emulation.')
  const sec = vbsState()
  add(sec.vbs_running && sec.hvci_running, 'HOST.SECURITY_FEATURES_PRESERVED', sec, 'Do NOT disable VBS/Memory Integrity for this harness; investigate why they are off.')
  const ac = acSleepNever()
  add(ac === true, 'HOST.AC_SLEEP_NEVER', ac, 'OWNER-ONLY: Settings > System > Power > Screen and sleep > "When plugged in, put my device to sleep after" = Never')
  const s = await hostSample()
  const a = admit('vm_start', { host: s, history: [], active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, reservations: readRes(), now: Date.now(), vmFloor: 'full' })
  const ap = admit('vm_start', { host: s, history: [], active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, reservations: readRes(), now: Date.now(), vmFloor: 'probe' })
  add(a.decision === 'admit', 'RESOURCE.FULL_WORKER_ADMISSION', { available_mb: s.available_mb, commit_ratio: s.commit_ratio, vm_ram_mb: a.vm_ram_mb, reasons: a.reason_codes }, `needs >= ${D33_THRESHOLDS.vm_ram_floor_full_mb + D33_THRESHOLDS.host_headroom_mb + D33_THRESHOLDS.vm_overhead_mb} MB available; the governor waits automatically; close large apps or stop Docker Desktop/WSL yourself only if you want it sooner`)
  add(ap.decision === 'admit', 'RESOURCE.PROBE_WORKER_ADMISSION', { vm_ram_mb: ap.vm_ram_mb, reasons: ap.reason_codes })
  const prov = readProvisioned(W)
  add(!!prov, 'WORKER.PROVISIONED', prov ? { claude_version: prov.claude_version, provisioned_at: prov.provisioned_at } : 'no', 'run: dh3 provision')
  const rec = readVmRecord(W)
  add(true, 'WORKER.VM_STATE', rec ? { state: rec.state, ...liveness(rec) } : 'not running')
  const contract = loadContractFile()
  add((contract.activation.active_actions ?? []).length === 0, 'V3.INACTIVE', { active_actions: contract.activation.active_actions })
  const iso = readJsonState(path.join(L.evidence, 'isolation-acceptance.json'), (v) => v && v.schema)
  add(iso.ok && iso.value.verdict === 'PASS', 'ISOLATION.ACCEPTANCE', iso.ok ? iso.value.verdict : 'not run', 'run: dh3 verify-isolation')
  const sub = readJsonState(L.subscription, (v) => v && v.schema)
  const fresh = sub.ok && sub.value.extra_usage?.enabled === false && Number.isFinite(sub.value.extra_usage.verified_at) && Date.now() - sub.value.extra_usage.verified_at < GOVERNOR_DEFAULTS.extra_usage_fact_ttl_ms
  add(fresh, 'SUBSCRIPTION.EXTRA_USAGE_VERIFIED_OFF', sub.ok ? { ...sub.value.extra_usage, fresh } : 'no record', 'run: dh3 login, then dh3 auth-check and dh3 probe-subscription (fact expires after 6 h)')
  out({ root: L.root, checks, summary: `${checks.filter((c) => c.ok).length}/${checks.length} ok` })
}

const readRes = () => { const r = readJsonState(L.reservations, (v) => Array.isArray(v?.reservations)); return r.ok ? r.value.reservations : [] }

async function monitor() {
  const n = Math.min(120, Number(opt('samples', 1))); const interval = Math.max(5, Number(opt('interval', 15)))
  const history = []
  let prev = 'clear'
  for (let i = 0; i < n; i += 1) {
    const s = await hostSample(); history.push(s)
    // Host-only view: the `deterministic` profile needs no guest metrics (none are invented here); `vm_start` shows what a worker start would get.
    const a = admit('deterministic', { host: s, history: history.slice(0, -1), prevPressure: prev, active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, reservations: readRes(), now: Date.now() })
    const v = admit('vm_start', { host: s, history: history.slice(0, -1), prevPressure: prev, active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, reservations: readRes(), now: Date.now(), vmFloor: 'probe', accel: 'tcg' })
    prev = a.pressure
    out({ at: s.at, available_mb: s.available_mb, commit_ratio: s.commit_ratio, paging: s.paging_pages_per_sec, cpu_pct: s.cpu_pct, disk_free_gb: s.disk_free_gb, sampler_ms: s.sampler_ms, pressure: a.pressure, deterministic: a.decision, probe_vm_start: v.decision, probe_vm_ram_mb: v.vm_ram_mb, reasons: [...new Set([...a.reason_codes, ...v.reason_codes])] })
    if (i < n - 1) await new Promise((r) => setTimeout(r, interval * 1000))
  }
}

/**
 * Resource-aware waiting: re-sample once a minute (bounded overhead) until admitted or `--wait-minutes` elapses. Never prompts the owner and
 * never touches the owner's processes; if external load persists the command reports waiting_resources honestly.
 */
async function waitForAdmission(floor, accel) {
  const minutes = Number(opt('wait-minutes', 0))
  const deadline = Date.now() + (Number.isFinite(minutes) && minutes > 0 ? Math.min(240, minutes) : 0) * 60000
  const history = []; let a
  for (;;) {
    const s = await hostSample()
    a = admit('vm_start', { host: s, history: history.slice(-6), active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, reservations: readRes(), now: Date.now(), vmFloor: floor, accel })
    history.push(s)
    if (a.decision === 'admit' || Date.now() >= deadline) return { a, s }
    console.error(`waiting_resources: ${a.reason_codes.join(',')} (available ${s.available_mb} MB); re-checking in 60 s`)
    await new Promise((r) => setTimeout(r, 60000))
  }
}

async function cmdProvision() {
  const accel = whpxState() === 'enabled' ? 'whpx' : 'tcg'
  const { a } = await waitForAdmission('probe', accel)
  if (a.decision !== 'admit') { out({ ok: false, decision: a.decision, reasons: a.reason_codes, note: 'waiting_resources: not started' }); process.exitCode = 3; return }
  const ram = Math.min(Number(opt('ram', a.vm_ram_mb)), a.vm_ram_mb)
  out(await provision(L, { id: ID, ramMb: ram, cpus: Number(opt('cpus', 2)), accel, dryRun: opt('dry-run') === true }))
}

async function cmdStart() {
  const accel = whpxState() === 'enabled' ? 'whpx' : 'tcg'
  const { a } = await waitForAdmission(opt('probe') ? 'probe' : 'full', accel)
  if (a.decision !== 'admit') { out({ ok: false, decision: a.decision, reasons: a.reason_codes, state: 'waiting_resources' }); process.exitCode = 3; return }
  const { cfg } = await startTaskWorker(L, { id: ID, ramMb: a.vm_ram_mb, accel })
  out({ ok: true, name: cfg.name, ram_mb: cfg.ram_mb, accel: cfg.accel })
}

async function cmdStop() { const cfg = readVmConfig(W); out(cfg ? await stopVm(W, cfg, { log: out }) : { stopped: true, method: 'not_running' }) }

function cmdStatus() { const rec = readVmRecord(W); out({ provisioned: readProvisioned(W), vm: rec ? { ...rec, liveness: liveness(rec) } : null, config: readVmConfig(W) }) }

async function cmdReset() {
  const cfg = readVmConfig(W)
  const st = cfg ? await stopVm(W, cfg, { log: out }) : { stopped: true, method: 'not_running' }
  if (!st.stopped) { out({ reset: false, reason: 'VM termination not verified; overlay kept', stop: st }); process.exitCode = 1; return }
  rmSync(W.task, { force: true }); out({ reset: true, stop: st.method, note: 'task overlay discarded; golden image and persistent login untouched' })
}

/**
 * Owner-only: interactive official login INSIDE the VM (security review S6). The worker is first reset to a FRESH task overlay (no task code has
 * run since the golden image); the owner's keystrokes go straight to ssh (stdin inherited, never read here); VM output is shown only after
 * escape-sequence stripping, and the login aborts if any URL is outside the official login hosts or asks for the Console API-key scope.
 */
async function cmdLogin() {
  await cmdReset(); if (process.exitCode) return
  await cmdStart(); if (process.exitCode) return
  const cfg = readVmConfig(W)
  const { startEgressProxyProcess: startEgressProxy } = await import('../runtime/egress-proxy-process.mjs')
  const { openEgressChannel } = await import('../runtime/vm-controller.mjs')
  const decisions = []
  const proxy = await startEgressProxy({ profile: 'login', onDecision: (d) => decisions.push({ allow: d.allow, host: d.host ?? null, code: d.code }) })
  const ch = openEgressChannel(W, cfg, proxy.port)
  await new Promise((r) => setTimeout(r, 3000))
  out('Opening the official Claude login inside the worker VM. Follow the prompts; open the printed URL in your own browser.')
  const loginCmd = 'sudo -n -u worker -H /usr/bin/env -i HOME=/home/worker USER=worker LOGNAME=worker PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 TERM=dumb HTTPS_PROXY=http://127.0.0.1:3128 HTTP_PROXY=http://127.0.0.1:3128 /opt/patelrep-claude/bin/claude auth login'
  let aborted = null; let seen = ''
  await new Promise((r) => {
    const c = spawn(`${process.env.SYSTEMROOT}\\System32\\OpenSSH\\ssh.exe`, [...sshArgs(W, cfg, { extra: ['-tt'] }), loginCmd], { stdio: ['inherit', 'pipe', 'pipe'], env: sysEnv(), windowsHide: false })
    // Only COMPLETE lines are shown, each after the URL check (a URL split across chunks is never partly displayed); any relay error aborts
    // and kills ssh, so a crash can never leave ssh reading the owner's keystrokes unseen (security re-review N1/N2).
    let pending = ''
    const abort = (p) => { if (!aborted) { aborted = p; process.stdout.write(`\n[dh3] login aborted: ${p.join(', ')}\n`) } try { c.kill() } catch { /* gone */ } }
    const show = (text) => { seen = (seen + text).slice(-8192); const p = loginOutputProblems(seen); if (p.length) { abort(p); return } process.stdout.write(text) }
    const relay = (d) => {
      if (aborted) return
      try {
        pending += sanitizeTerminal(d.toString('utf8'))
        const i = pending.lastIndexOf('\n')
        if (i >= 0) { const lines = pending.slice(0, i + 1); pending = pending.slice(i + 1); show(lines) }
        // Prompts without a newline (e.g. "Paste code here:") are shown once they contain no URL fragment.
        if (pending && !/[a-z]+:\/\/|https?:?\/?\/?$/i.test(pending) && pending.length < 512) { const t = pending; pending = ''; show(t) }
        if (pending.length > 8192) abort(['LOGIN.LINE_TOO_LONG'])
      } catch { abort(['LOGIN.RELAY_ERROR']) }
    }
    c.stdout.on('data', relay); c.stderr.on('data', relay); c.on('close', () => { if (!aborted && pending) { try { show(pending) } catch { /* ignore */ } } r() }); c.on('error', r)
  })
  ch.kill(); await proxy.close()
  atomicWriteJson(path.join(L.evidence, 'login-egress.json'), { schema: 'patelrep.developer-harness-v3.login-egress', at: new Date().toISOString(), aborted, decisions })
  out({ login_egress: decisions.length, aborted, next: aborted ? 'investigate; do not reuse this auth disk' : 'dh3 auth-check' })
}

function cmdAuthCheck() {
  const cfg = readVmConfig(W); if (!cfg) { out('worker not running'); process.exitCode = 2; return }
  const r = sshExec(W, cfg, 'sudo -u worker -H env -i HOME=/home/worker PATH=/usr/local/bin:/usr/bin:/bin /opt/patelrep-claude/bin/claude auth status --json', { timeoutMs: 180000 })
  let j = null; try { j = JSON.parse(r.out) } catch { /* not JSON */ }
  const facts = normalizeAuthStatus(j, { now: Date.now() })
  out({ exit: r.code, facts })
}

function cmdAttest() {
  const prev = readJsonState(L.subscription, (v) => v && v.schema)
  // One-shot, expiring: consumed by exactly one probe, never reusable (security review S5).
  const now = Date.now()
  const rec = { ...(prev.ok ? prev.value : { schema: 'patelrep.developer-harness-v3.subscription-governor' }), owner_attestation: { extra_usage_off: true, nonce: randomUUID(), attested_at: new Date(now).toISOString(), expires_at: new Date(now + 24 * 3600000).toISOString(), used: false, scope: 'permits ONE bounded subscription probe; does not by itself verify extra usage' } }
  atomicWriteJson(L.subscription, rec); out(rec.owner_attestation)
}

async function cmdVerifyIsolation() { const { runAcceptance } = await import('../isolation/acceptance.mjs'); out(await runAcceptance(L, { id: ID, log: (m) => console.error(m) })) }

async function cmdProbe() { const { probeSubscription } = await import('../isolation/subscription-probe.mjs'); out(await probeSubscription(L, { id: ID, log: (m) => console.error(m) })) }

const commands = { doctor, setup: () => setup({ root: L.root, dryRun: opt('dry-run') === true }).then(out), provision: cmdProvision, start: cmdStart, stop: cmdStop, status: cmdStatus, reset: cmdReset, monitor,
  login: cmdLogin, 'auth-check': cmdAuthCheck, 'attest-extra-usage-off': cmdAttest, 'probe-subscription': cmdProbe, 'verify-isolation': cmdVerifyIsolation,
  remove: async () => { const cfg = readVmConfig(W); if (cfg && opt('dry-run') !== true) await stopVm(W, cfg); out(rollback({ root: L.root, dryRun: opt('dry-run') === true })) } }

if (!commands[cmd]) { out(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n')); process.exitCode = cmd ? 2 : 0 } else {
  Promise.resolve(commands[cmd]()).catch((e) => { out({ ok: false, error: String(e.message).slice(0, 400) }); process.exitCode = 1 })
}