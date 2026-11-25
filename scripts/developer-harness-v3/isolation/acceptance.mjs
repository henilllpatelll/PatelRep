// Developer Harness V3 (D3.3) — the 13-scenario adversarial isolation acceptance suite (05-local-execution-architecture.md §5), run against the REAL
// worker VM. This module only COLLECTS observations (guest probe as the unprivileged worker, guest-root facts, host facts); every verdict comes
// from the pure, fail-closed evaluators in acceptance-rules.mjs. A mocked result is never recorded here. Bounded workloads only: small
// allocations inside the VM, two 40 s CPU burns under the Job Object cap, a disk fill limited to the 512 MB home disk.
// Evidence: every run is written once to evidence/runs/<started_at>.json (never overwritten) and the previous `isolation-acceptance.json` is
// archived there before it is replaced, so a failed run can never be lost by a later one.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { atomicWriteJson, readJsonState } from '../lib/atomic.mjs'
import { startEgressProxyProcess as startEgressProxy } from '../runtime/egress-proxy-process.mjs'
import { sampleWindowsHost } from '../runtime/host-sampler.mjs'
import { admit } from '../runtime/resource-governor.mjs'
import { validateQemuArgs } from '../runtime/qemu-args.mjs'
import { liveness, openEgressChannel, POWERSHELL, readVmRecord, run, SSH, sshArgs, sshExec, stopVm, sysEnv } from '../runtime/vm-controller.mjs'
import { readProvisioned, startTaskWorker, streamSha256 } from '../infra/provision.mjs'
import { importBundle } from '../runtime/artifact-transfer.mjs'
import { buildPeFixture, validatePeFixture } from './pe-fixture.mjs'
import * as R from './acceptance-rules.mjs'

export { verifyTreeClaim } from './acceptance-rules.mjs'
export const SCHEMA = R.ACCEPTANCE_SCHEMA
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const AS_WORKER = 'sudo -u worker -H env -i HOME=/home/worker USER=worker LOGNAME=worker PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8'

/** Host addresses the guest must NOT reach (private values stay in memory; the report masks them). */
function hostTargets() {
  const v4 = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address)
  return { lan: [...new Set(v4.filter((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)))] }
}
/**
 * Address masker for one run: each distinct private address gets a stable indexed placeholder (`172.x.x.x#2`), so two addresses never collapse
 * into one map key (which would silently drop evidence entries). slirp's own 10.0.2.x addresses are not private host data and are kept.
 */
export function makeMasker() {
  const seen = new Map()
  return (s) => String(s).replace(/\b(10|172|192)\.\d+\.\d+\.\d+/g, (m) => {
    if (m.startsWith('10.0.2.')) return m
    if (!seen.has(m)) seen.set(m, `${m.split('.')[0]}.x.x.x#${seen.size + 1}`)
    return seen.get(m)
  })
}
/** Mask private host addresses anywhere in a JSON-serialisable document (keys, values, problem codes, error text). */
export const maskDoc = (doc, masker = makeMasker()) => JSON.parse(masker(JSON.stringify(doc)))

/**
 * Guest-root facts (as `ctl` via sudo): fw_cfg entry names, SMBIOS OEM-string count, modprobe refusals, binfmt automount state, and root's own
 * open() of /dev/vsock (the worker cannot open the root:0600 static node, so only root's answer shows whether a driver exists). Read-only.
 */
export const ROOT_FACTS_CMD = 'sudo -n sh -c \'modprobe qemu_fw_cfg >/dev/null 2>&1; echo @@FWCFG; if [ -d /sys/firmware/qemu_fw_cfg/by_name ]; then echo FWCFG_LISTED; find /sys/firmware/qemu_fw_cfg/by_name -name raw | sed -e "s#^/sys/firmware/qemu_fw_cfg/by_name/##" -e "s#/raw\\$##" | sort; else echo FWCFG_NO_DRIVER; fi; '
  + 'echo @@DMI; if [ -d /sys/firmware/dmi/entries ]; then ls /sys/firmware/dmi/entries | grep -c "^11-"; else echo NO_DMI; fi; echo @@MODPROBE; modprobe -c 2>/dev/null | grep -E "^install [a-z0-9_]+ /bin/false\\$"; '
  + 'echo @@MASK; systemctl is-enabled proc-sys-fs-binfmt_misc.automount 2>&1; '
  + 'echo @@VSOCK; if [ -e /dev/vsock ]; then if (exec 3</dev/vsock) 2>/dev/null; then echo ROOT_OPEN_OK; else (exec 3</dev/vsock) 2>&1 | tail -n 1; fi; else echo NO_NODE; fi; echo @@END\''

/**
 * Guest CPU burn: N worker processes count loop iterations for T seconds of guest monotonic time. Each worker also reports its OWN guest CPU
 * time (os.times), so the host can compare work per guest CPU-second; /proc/stat gives guest busy %.
 */
export const BURN_PY = `import json, os, sys, time
N = int(sys.argv[1]); T = float(sys.argv[2])
def stat():
    with open('/proc/stat') as f: v = [int(x) for x in f.readline().split()[1:]]
    return sum(v), v[3] + v[4]
r, w = os.pipe(); a = stat(); pids = []
for i in range(N):
    pid = os.fork()
    if pid == 0:
        os.close(r); n = 0; end = time.monotonic() + T
        while time.monotonic() < end:
            for _ in range(20000): pass
            n += 1
        t = os.times()
        os.write(w, ("%d %.6f\\n" % (n, t.user + t.system)).encode()); os._exit(0)
    pids.append(pid)
os.close(w)
for p in pids: os.waitpid(p, 0)
b = stat(); data = b""
while True:
    c = os.read(r, 4096)
    if not c: break
    data += c
rows = [l.split() for l in data.decode().splitlines() if l.strip()]
dt = b[0] - a[0]; di = b[1] - a[1]
print(json.dumps({"iterations": sum(int(x[0]) for x in rows), "cpu_seconds": round(sum(float(x[1]) for x in rows), 3), "reports": len(rows),
                  "busy_pct": round((dt - di) * 100.0 / dt, 1) if dt > 0 else None, "seconds": T, "workers": N, "cpus": len(os.sched_getaffinity(0))}))
`
/** Burn length; the host measures QEMU's CPU share and samples host CPU only INSIDE [BURN_WINDOW_S] so start-up and teardown are excluded. */
// 40 s with the window ending at 30 s leaves ≥ 8 s of budget for the c1 read on a slow host (one PowerShell call + three ~5 s samples before it).
export const BURN_SECONDS = 40
export const BURN_WINDOW_S = Object.freeze([8, 30])

/** Scenario 13 positive control, run as the worker BEFORE the overlay is discarded: which planted items really exist (see R.S13_PLANTED). */
export const PLANT_CHECK_CMD = `${AS_WORKER} sh -c 'cd /home/worker; test -f /work/task/residue.txt && echo PLANTED:task_residue; test -f .residue && echo PLANTED:home_residue; `
  + 'test -f .claude.real/settings.json && echo PLANTED:settings; test -d .claude.real/skills/x && echo PLANTED:skills; test -p fifo && echo PLANTED:fifo; test -L .claude && echo PLANTED:claude_symlink; '
  + 'test -L .claude.json.dh3new && echo PLANTED:dh3new_symlink; test -L .claude.json.dh3tmp && echo PLANTED:dh3tmp_symlink; grep -q projects .claude.json && echo PLANTED:claude_json; '
  + 'test -e hard || echo HARDLINK_REFUSED; echo PLANT_CHECKED\''

export async function runAcceptance(L, { id = 'w1', log = console.error } = {}) {
  const startedAt = new Date().toISOString()
  // Problem codes can embed guest-chosen text (handler names, device ids): mask private addresses and strip control characters before logging.
  const mask = makeMasker() // one numbering for the log and the persisted document
  const S = {}; const set = (n, r) => { S[n] = r; log(`scenario ${n}: ${r.verdict}${r.problems?.length ? ` (${mask(r.problems.slice(0, 5).join(', ')).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?')})` : ''}`) }
  const W = L.worker(id)
  const prov = readProvisioned(W)
  const identity = { candidate: candidateIdentity() }
  const proxyDecisions = []
  let probeError = null
  if (!prov) return finish('NOT_RUN', 'WORKER.NOT_PROVISIONED')
  // VM image identity: the golden image that boots must still be the one provisioning recorded.
  identity.vm_image = { golden_sha256_recorded: prov.golden_sha256 ?? null, golden_sha256_now: await streamSha256(W.golden), base_image_sha512: prov.base_image_sha512 ?? null, provisioned_at: prov.provisioned_at,
    claude_version: prov.claude_version, claude_sha512: prov.claude_sha512, guest_hardening: prov.guest_hardening ?? null }
  if (identity.vm_image.golden_sha256_now !== prov.golden_sha256) return finish('NOT_RUN', 'WORKER.GOLDEN_CHANGED_SINCE_PROVISIONING')
  const before = await sampleWindowsHost({ diskPath: L.root.slice(0, 3) })
  const a = admit('vm_start', { host: before, history: [], active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, reservations: [], now: Date.now(), vmFloor: 'probe', accel: prov.accel })
  if (a.decision !== 'admit') return finish('NOT_RUN', R.admissionRefusalReason(a.reason_codes))
  const hardened = { vsock: prov.guest_hardening?.vsock_disabled === true, binfmt: prov.guest_hardening?.binfmt_disabled === true }
  const logicalCpus = os.cpus().length
  // Host-side facts gathered before the VM starts: the PE fixture's Windows positive control, and whether WSL / Docker Desktop are running.
  const pe = buildPeFixture(); const peProblems = validatePeFixture(pe); const peSha = sha256(pe)
  const hostRun = runFixtureOnHost(pe)
  const hostNeighbors = hostNeighborState()
  let { cfg } = await startTaskWorker(L, { id, ramMb: a.vm_ram_mb, accel: prov.accel, log })
  const vcpus = cfg.cpus
  const bindingCap = Math.max(5, Math.floor(((vcpus / logicalCpus) * 100) / 2))
  const recNormal = readVmRecord(W)
  let proxy = null; let egress = null
  try {
    // Scenario 13 deliberately wrecks the persistent worker home (it moves ~/.claude away). Never run it over a real Claude login.
    const login = sshExec(W, cfg, 'sudo -n sh -c \'if [ -e /home/worker/.claude/.credentials.json ]; then echo HAS_CREDENTIALS; else echo NO_CREDENTIALS; fi\'').out
    if (!/^NO_CREDENTIALS$/m.test(login)) throw new Error('WORKER.AUTH_DISK_HAS_CREDENTIALS: acceptance refuses to run over a real login (it would destroy it); use a fresh auth disk')
    proxy = await startEgressProxy({ profile: 'runtime', onDecision: (d) => proxyDecisions.push({ allow: d.allow, code: d.code, host: d.host ?? null }) })
    egress = openEgressChannel(W, cfg, proxy.port); await sleep(4000)
    const cmdline = readFileSync(path.join(W.dir, 'qemu-cmdline.txt'), 'utf8')
    const argv = (cmdline.match(/"[^"]*"|\S+/g) ?? []).map((x) => x.replace(/^"|"$/g, ''))
    identity.runtime = { accel: cfg.accel, ram_mb: cfg.ram_mb, vcpus, host_logical_cpus: logicalCpus, job_memory_limit_mb: recNormal?.memory_limit_mb ?? null, normal_cpu_cap_pct: recNormal?.cpu_rate_percent ?? null,
      binding_cpu_cap_pct: bindingCap, qemu_version: run(L.qemu, ['--version'], { env: { SYSTEMROOT: process.env.SYSTEMROOT, PATH: `${path.dirname(L.qemu)};${process.env.SYSTEMROOT}\\System32` } }).out.split(/\r?\n/)[0] || null,
      qemu_argv_sha256: sha256(cmdline), qemu_argv: argv.map((x) => x.replace(/[A-Za-z]:\\[^,"]*\\/g, '<dh3>\\')) }
    sshExec(W, cfg, 'sudo install -d -o worker -g worker -m 0755 /work/task')
    const ht = hostTargets()
    const targets = { host_addrs: ['10.0.2.2', ...ht.lan], host_ports: [22, 135, 445, 3000, 5432, 5433, 8000, 8080], controller_ports: [proxy.port, cfg.ssh_port], other_vm_addrs: ['172.26.0.1', '172.17.0.1', '192.168.65.1', '192.168.65.3', '10.0.2.4'] }
    const script = readFileSync(path.join(HERE, 'guest-probe.py'), 'utf8').replace('@@TARGETS@@', JSON.stringify(targets)).replace('@@PE_B64@@', pe.toString('base64'))
    const d0 = proxyDecisions.length
    const pr = sshExec(W, cfg, `${AS_WORKER} python3 -I -`, { input: script, timeoutMs: 900000 })
    await sleep(1000) // the proxy process reports decisions asynchronously
    const proxyLog = proxyDecisions.slice(d0) // decisions the HOST proxy recorded during the probe (corroborates scenarios 4 and 5)
    let P = null; try { P = JSON.parse(pr.out.trim().split('\n').pop()) } catch { /* evaluated as PROBE_INVALID */ }
    if (!R.probeValid(P)) probeError = (pr.err || pr.out).slice(-300)
    const root = R.parseRootFacts(sshExec(W, cfg, ROOT_FACTS_CMD, { timeoutMs: 120000 }).out.replace(/\r/g, ''))
    set(1, R.evalS1(P))
    set(2, R.evalS2(P, { fixtureSha256: peSha, fixtureProblems: peProblems, hostRun, hardened, root }))
    set(3, R.evalS3(P, { targets })) // addresses are masked document-wide at finish()
    set(4, { ...R.evalS4(P, { targets, proxyLog }), note: 'D3.3 has no controller API/DB listener and no QMP; the SSH hostfwd and proxy ports were probed' })
    set(5, R.evalS5(P, { proxyLog }))
    set(6, R.evalS6(P, { targets, hostNeighbors }))
    set(7, R.evalS7(P))
    set(10, R.evalS10(P, { argvProblems: validateQemuArgs(argv), hardened, root }))
    // 8 disk bounds: fill the 512 MB persistent home (fast); the task disk bound is its fixed virtual size.
    const fill = sshExec(W, cfg, `${AS_WORKER} sh -c 'dd if=/dev/zero of=/home/worker/.fill bs=1M count=900 status=none 2>&1; echo DD_EXIT=$?; df -B1 --output=size / | tail -1; rm -f /home/worker/.fill'`, { timeoutMs: 600000 })
    const info = JSON.parse(run(L.qemuImg, ['info', '--output=json', W.task], { env: { SYSTEMROOT: process.env.SYSTEMROOT, PATH: `${path.dirname(L.qemuImg)};${process.env.SYSTEMROOT}\\System32` } }).out || '{}')
    set(8, R.evalS8({ ddExit: Number((/DD_EXIT=(\d+)/.exec(fill.out) ?? [])[1]), enospc: /No space left on device/.test(fill.out), rootBytes: Number(fill.out.trim().split(/\s+/).pop()), taskVirtualSize: info['virtual-size'], authDiskBytes: statSync(W.auth).size }))
    // 9a memory: the over-allocation must END in the guest OOM killer (137) or MemoryError — not in the `timeout` (124), which proves nothing.
    const alloc = sshExec(W, cfg, `${AS_WORKER} timeout 600 python3 -I -c "b=[]\nfor i in range(${Math.ceil((cfg.ram_mb * 2) / 32)}):\n b.append(bytearray(32*1024*1024))\nprint('ALLOCATED_ALL')" 2>&1; echo EXIT=$?`, { timeoutMs: 900000 })
    const allocExit = Number((/EXIT=(\d+)/.exec(alloc.out) ?? [])[1])
    const allocOutcome = /ALLOCATED_ALL/.test(alloc.out) ? 'allocated_all' : /MemoryError/.test(alloc.out) ? 'MemoryError' : allocExit === 137 ? 'oom_killed' : 'other'
    const recAfterAlloc = readVmRecord(W)
    const qemuAliveAfterAlloc = !!recAfterAlloc && recAfterAlloc.marker === recNormal.marker && liveness(recAfterAlloc).qemu === true
    const mid = await sampleWindowsHost({ diskPath: L.root.slice(0, 3), ownedPids: [recNormal.qemu_pid] })
    // 9b CPU under the normal (non-binding) cap: reference guest throughput, host sampled DURING the burn.
    const normal = await cpuBurn(W, cfg, recNormal, { vcpus, logicalCpus, diskPath: L.root.slice(0, 3) })
    // 11 clock / policy / evidence: guest root changing the GUEST clock does not move the host clock; the worker cannot even do that.
    const h0 = Date.now()
    sshExec(W, cfg, 'sudo date -s "+1 day" >/dev/null')
    const h1 = Date.now(); const gNow = Number(sshExec(W, cfg, 'date +%s').out.trim()) * 1000
    sshExec(W, cfg, `sudo date -s @${Math.floor(Date.now() / 1000)} >/dev/null`)
    set(11, R.evalS11(P, { guestShiftMs: gNow - h1, hostDeltaMs: h1 - h0 }))
    // 12 artifact integrity: the host pulls a bundle and RECOMPUTES the tree; a guest-claimed tree is never trusted.
    const g = sshExec(W, cfg, `${AS_WORKER} sh -c 'cd /work/task && git init -q && git -c user.email=w@x -c user.name=w commit -q --allow-empty -m init && echo hello > a.txt && git add a.txt && git -c user.email=w@x -c user.name=w commit -q -m a && git rev-parse HEAD^{tree} && git bundle create -q /home/worker/.tmp/b.bundle HEAD && base64 -w0 /home/worker/.tmp/b.bundle'`, { timeoutMs: 300000 })
    const [claimedTree, b64] = g.out.trim().split(/\r?\n/)
    const forged = sshExec(W, cfg, `${AS_WORKER} sh -c 'cd /work/task && echo tampered > b.txt && git add b.txt && git write-tree'`).out.trim()
    set(12, R.evalS12({ imported: importBundle(Buffer.from(b64 ?? '', 'base64')), claimedTree, forgedTree: forged, redirectCode: importBundle(Buffer.from('gitdir: C:/Users/x/projects/PatelRep/.git\n')).code }))
    // 13 snapshot recovery / residue: plant residue + the sanitizer attack (security review B1), discard the overlay, boot fresh, look for it.
    sshExec(W, cfg, `${AS_WORKER} sh -c 'echo r > /work/task/residue.txt; echo r > /home/worker/.residue; mkdir -p /home/worker/.claude/skills/x; echo "{\\"hooks\\":{\\"PreToolUse\\":[]}}" > /home/worker/.claude/settings.json'`)
    const bashrcBefore = sshExec(W, cfg, 'sudo sha256sum /home/ctl/.bashrc /etc/sudoers | cut -c1-64').out.replace(/\r/g, '').trim()
    sshExec(W, cfg, `${AS_WORKER} sh -c 'cd /home/worker && echo "{\\"oauthAccount\\":\\"$(id)\\",\\"projects\\":{}}" > .claude.json; ln -sf /home/ctl/.bashrc .claude.json.dh3new; ln -sf /home/ctl/.bashrc .claude.json.dh3tmp; mkfifo fifo; ln /etc/hostname hard 2>/dev/null; mv .claude .claude.real; ln -s /etc .claude; true'`)
    const planted = sshExec(W, cfg, PLANT_CHECK_CMD).out.replace(/\r/g, '')
    egress.kill(); egress = null
    await proxy.close(); proxy = null
    await stopVm(W, cfg, { log })
    // The second boot is a new VM start, so it goes through the Resource Governor again (bounded wait; never admitted without a fresh sample).
    const a2 = await admitWithin(L, prov, 600000, log)
    if (a2.decision !== 'admit') throw new Error(`RESOURCE.SECOND_BOOT_NOT_ADMITTED:${(a2.reason_codes ?? []).join(',')}`)
    // The second boot runs under a cap BELOW the VM's CPU demand, so scenario 9 can show the hard cap is enforced (not merely configured).
    ;({ cfg } = await startTaskWorker(L, { id, ramMb: Math.min(a.vm_ram_mb, a2.vm_ram_mb), accel: prov.accel, log, cpuRatePercent: bindingCap }))
    const recCapped = readVmRecord(W)
    const after = sshExec(W, cfg, 'for p in /work/task/residue.txt /home/worker/.residue /home/worker/.claude/settings.json /home/worker/.claude/skills /home/worker/fifo /home/worker/hard /home/worker/.claude.real /home/worker/.claude.json.dh3new /home/worker/.claude.json.dh3tmp; do test -e $p -o -L $p && echo PRESENT:$p; done; test -L /home/worker/.claude && echo PRESENT:claude-symlink; test -f /run/dh3-sanitized && echo MARKER; sudo cat /home/worker/.claude.json 2>/dev/null | head -c 200; echo; echo CHECKED')
    const bashrcAfter = sshExec(W, cfg, 'sudo sha256sum /home/ctl/.bashrc /etc/sudoers | cut -c1-64').out.replace(/\r/g, '').trim()
    set(13, R.evalS13({ plantedOut: planted, afterOut: after.out.replace(/\r/g, ''), bashrcBefore, bashrcAfter, goldenReadOnly: (statSync(W.golden).mode & 0o222) === 0 }))
    const capped = await cpuBurn(W, cfg, recCapped, { vcpus, logicalCpus, diskPath: L.root.slice(0, 3) })
    const job = (r) => ({ flags: r?.job_cpu_control_flags ?? null, rate: r?.job_cpu_rate ?? null })
    const burnSamples = [...normal.hostSamples, ...capped.hostSamples]
    const availSamples = [mid.available_mb, ...burnSamples.map((s) => s.available_mb)]
    set(9, R.evalS9({ alloc: { exitCode: allocExit, outcome: allocOutcome }, qemuAliveAfterAlloc, qemuWorkingSetMb: mid.owned_processes?.[recNormal.qemu_pid]?.working_set_mb ?? null, memoryLimitMb: recNormal.memory_limit_mb,
      hostAvailableMbMin: availSamples.every(Number.isFinite) ? Math.min(...availSamples) : null, hostResponsive: [mid.host_responsive, ...burnSamples.map((s) => s.host_responsive)],
      cpu: { logicalCpus, vcpus, normal: { capPct: recNormal.cpu_rate_percent, job: job(recNormal), burn: normal.burn, hostCpuPct: normal.hostSamples.map((s) => s.cpu_pct ?? null), qemuHostCpuPct: normal.qemuHostCpuPct, window: normal.window },
        capped: { capPct: recCapped?.cpu_rate_percent ?? null, job: job(recCapped), burn: capped.burn, hostCpuPct: capped.hostSamples.map((s) => s.cpu_pct ?? null), qemuHostCpuPct: capped.qemuHostCpuPct, window: capped.window } } }))
  } catch (e) {
    log(`acceptance aborted: ${e.message}`)
    probeError = probeError ?? `ABORTED:${String(e.message).slice(0, 200)}`
  } finally {
    try { egress?.kill() } catch { /* ignore */ }
    try { await proxy?.close() } catch { /* ignore */ }
    const rec = readVmRecord(W); if (rec && liveness(rec).qemu !== false) await stopVm(W, cfg, { log })
  }
  for (let n = 1; n <= 13; n += 1) if (!S[n]) S[n] = { verdict: 'NOT_RUN', problems: ['ABORTED_BEFORE_SCENARIO'], evidence: {} }
  return finish(R.overallVerdict(S))

  function finish(verdict, reason = null) {
    const doc = { schema: SCHEMA, probe_version: R.PROBE_VERSION, started_at: startedAt, finished_at: new Date().toISOString(), verdict, reason, probe_error: probeError, accel: prov?.accel ?? null,
      claude_version: prov?.claude_version ?? null, identity, scenarios: S, proxy_decisions: summarizeDecisions(proxyDecisions),
      caveats: ['AI-run automated test, not an external security audit',
        prov?.accel === 'tcg' ? 'run under TCG emulation (WHPX not enabled); the WHPX hypervisor boundary is NOT exercised by this run' : 'run under WHPX',
        'guest-reported facts come from a fresh overlay of the golden image before any task code ran; the host-validated QEMU argv is the authority for attached devices',
        'a PASS here does not resolve the residual credential, provider-terms or host-account risks recorded in 17',
        'scenarios 1-7, the guest part of 10, 11 (worker rc / guest shift), 13 (guest outputs) and 9 (guest OOM, throughput) rest on GUEST-REPORTED facts from a fresh overlay of the sealed golden image; host-verified: golden sha256, validated QEMU argv, proxy decision log (4, 5), 8 disk sizes, Job Object read-back, QEMU liveness/CPU/working set, host memory/CPU/responsiveness, 11 host clock, 12 import, 13 golden read-only, 2 fixture + Windows run'] }
    // Private host addresses never reach the evidence file, wherever they appear (scenario evidence, problem codes, probe_error).
    const masked = maskDoc(doc, mask)
    persistAcceptance(L.evidence, masked)
    return masked
  }
}

/**
 * Currency of the latest persisted acceptance record (what `dh3 doctor` reports). Reads through `readJsonState` with the exact boolean record
 * validator, then `acceptanceStatus`. Absent → NOT_RUN; present but unreadable, wrong schema or malformed → INVALID (fail closed, never PASS).
 */
export function readAcceptanceStatus(evidenceDir, prov, closureDigestNow) {
  const r = readJsonState(path.join(evidenceDir, 'isolation-acceptance.json'), R.isAcceptanceRecord)
  if (!r.ok) return r.code === 'STATE.ABSENT' ? { current: false, status: 'NOT_RUN', reasons: [] } : { current: false, status: 'INVALID', reasons: [r.code] }
  return R.acceptanceStatus(r.value, prov, closureDigestNow)
}

/**
 * Write the run once (exclusive create) under runs/, archive the previous latest there first, then replace the latest pointer atomically.
 * Names come only from a strictly validated ISO timestamp (never a path); a name collision gets a numeric suffix, so no run is ever lost or
 * overwritten.
 */
export function persistAcceptance(evidenceDir, doc) {
  const latest = path.join(evidenceDir, 'isolation-acceptance.json')
  const runs = path.join(evidenceDir, 'runs'); mkdirSync(runs, { recursive: true })
  if (existsSync(latest)) {
    const prev = readJsonState(latest, (v) => v && v.schema === SCHEMA && ISO_RE.test(v.started_at ?? ''))
    const bytes = readFileSync(latest)
    const f = path.join(runs, prev.ok ? runName(prev.value.started_at) : `isolation-acceptance-unparsed-${Date.now()}.json`)
    // Normally already archived (every run writes its own file at creation, possibly with a collision suffix); a byte-different copy is kept.
    if (!archived(runs, path.basename(f, '.json'), bytes)) writeExclusive(runs, path.basename(f, '.json'), bytes)
  }
  if (!ISO_RE.test(doc?.started_at ?? '')) throw new Error('EVIDENCE.BAD_STARTED_AT')
  writeExclusive(runs, path.basename(runName(doc.started_at), '.json'), `${JSON.stringify(doc, null, 2)}\n`)
  atomicWriteJson(latest, doc)
}
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/
const suffixed = (dir, base, i) => path.join(dir, `${base}${i === 1 ? '' : `-${i}`}.json`)
function archived(dir, base, bytes) {
  for (let i = 1; i < 1000 && existsSync(suffixed(dir, base, i)); i += 1) if (readFileSync(suffixed(dir, base, i)).equals(bytes)) return true
  return false
}
function writeExclusive(dir, base, data) {
  for (let i = 1; i < 1000; i += 1) {
    try { writeFileSync(suffixed(dir, base, i), data, { flag: 'wx' }); return } catch (e) { if (e.code !== 'EEXIST') throw e }
  }
  throw new Error('EVIDENCE.TOO_MANY_COLLISIONS')
}
export const runName = (iso) => `isolation-acceptance-${String(iso).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.json`

/** Fresh host sample → Resource Governor, repeated every 30 s until admitted or `waitMs` elapses. Returns the last decision. */
async function admitWithin(L, prov, waitMs, log) {
  const deadline = Date.now() + waitMs
  for (;;) {
    const host = await sampleWindowsHost({ diskPath: L.root.slice(0, 3) })
    const d = admit('vm_start', { host, history: [], active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, reservations: [], now: Date.now(), vmFloor: 'probe', accel: prov.accel })
    if (d.decision === 'admit' || Date.now() + 30000 > deadline) return d
    log(`second boot waiting for resources: ${d.reason_codes.join(',')}`); await sleep(30000)
  }
}

/**
 * Which code produced this evidence. Git HEAD alone cannot say (modified or untracked files are invisible to it), so every file of the trusted
 * execution closure — scripts/developer-harness-v3 minus tests/, plus the two contract JSON files, the same set the owner pins — is hashed
 * (sha256 over CRLF→LF content, sorted repo-relative paths). The owner can compare `closure` with the pinned digests.
 */
const lfBuffer = (buf) => Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')
const lfDigest = (buf) => sha256(lfBuffer(buf)) // byte-exact, same rule as the pin tool
export function closureIdentity(repo = REPO) {
  const files = {}
  const walk = (rel) => {
    for (const e of readdirSync(path.join(repo, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`
      if (e.isSymbolicLink()) files[r] = 'SYMLINK'
      else if (e.isDirectory()) { if (r !== 'scripts/developer-harness-v3/tests') walk(r) } else if (e.isFile()) files[r] = lfDigest(readFileSync(path.join(repo, r)))
    }
  }
  try {
    walk('scripts/developer-harness-v3')
    for (const f of ['docs/developer-harness-v3/authority-contract.json', 'docs/developer-harness-v3/task-lifecycle.json']) files[f] = existsSync(path.join(repo, f)) ? lfDigest(readFileSync(path.join(repo, f))) : 'MISSING'
  } catch (e) { return { error: String(e.code ?? e.message).slice(0, 60), files: null, digest: null } }
  const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]))
  return { file_count: Object.keys(sorted).length, digest: sha256(Object.entries(sorted).map(([k, v]) => `${v}  ${k}`).join('\n')), files: sorted }
}

// Absolute git, blank system/global config (a FRESH private temp dir, never a predictable shared path), no hooks, no fsmonitor — the
// artifact-transfer.mjs pattern. Only object-reading commands run (rev-parse, ls-tree): unlike `git status`, they never stat the working tree,
// so no clean/smudge filter or attributes configuration can execute anything. Whether the closure differs from HEAD is decided IN-PROCESS by
// comparing git blob ids of the LF-normalised closure files with HEAD's tree entries.
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe'
export const gitBlobId = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
/** Pure: which closure paths differ from `git ls-tree -r HEAD` output (missing, extra or different blob). */
export function closureDiffFromTree(blobs, lsTree) {
  const tree = new Map()
  for (const l of String(lsTree ?? '').split('\n')) { const m = /^\d{6} blob ([0-9a-f]{40})\t(.+)$/.exec(l); if (m && !m[2].startsWith('scripts/developer-harness-v3/tests/')) tree.set(m[2], m[1]) }
  const diff = []
  for (const [p, id] of Object.entries(blobs)) if (tree.get(p) !== id) diff.push(p)
  for (const p of tree.keys()) if (!Object.hasOwn(blobs, p)) diff.push(p)
  return diff.sort()
}
export function candidateIdentity(repo = REPO) {
  const closure = closureIdentity(repo)
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dh3-git-'))
  try {
    const env = { SYSTEMROOT: process.env.SYSTEMROOT, SYSTEMDRIVE: process.env.SYSTEMDRIVE, PATH: `${path.dirname(GIT)};${process.env.SYSTEMROOT}\\System32`, HOME: tmp, GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(tmp, 'no-global-config'), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    const g = (...a) => spawnSync(GIT, ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', '-c', 'core.quotePath=false', '-C', repo, ...a], { encoding: 'utf8', windowsHide: true, timeout: 30000, env, maxBuffer: 16 * 1024 * 1024 })
    const head = (g('rev-parse', '--verify', 'HEAD^{commit}').stdout ?? '').trim()
    const ls = g('ls-tree', '-r', 'HEAD', '--', 'scripts/developer-harness-v3', 'docs/developer-harness-v3/authority-contract.json', 'docs/developer-harness-v3/task-lifecycle.json')
    let diff = null
    if (ls.status === 0 && closure.files) {
      // a SYMLINK / MISSING entry is never read through: it simply counts as differing
      const blobs = Object.fromEntries(Object.entries(closure.files).map(([p, d]) => [p, /^[0-9a-f]{64}$/.test(d) ? gitBlobId(lfBuffer(readFileSync(path.join(repo, p)))) : `NOT_A_FILE:${d}`]))
      diff = closureDiffFromTree(blobs, ls.stdout)
    }
    return { git_head: /^[0-9a-f]{40}$/.test(head) ? head : null, closure_differs_from_head: diff === null ? null : diff.length > 0, closure_paths_differing_from_head: diff, closure }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

/** Positive control: Windows itself accepts the fixture as an executable (it exits 0). Run once, from a private temp dir, minimal environment. */
function runFixtureOnHost(pe) {
  if (process.platform !== 'win32') return { rc: null, error: 'NOT_WINDOWS' }
  const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-pe-'))
  try {
    const f = path.join(d, 'dh3fixture.exe'); writeFileSync(f, pe)
    const r = spawnSync(f, [], { timeout: 15000, windowsHide: true, env: { SYSTEMROOT: process.env.SYSTEMROOT } })
    return { rc: r.status, error: r.error?.code ?? null }
  } finally { try { rmSync(d, { recursive: true, force: true }) } catch { /* scanner may hold it briefly */ } }
}

/** Whether WSL distributions or Docker Desktop are running (read-only listing; nothing is started or stopped). Names are not recorded. */
function hostNeighborState() {
  const w = run(`${process.env.SYSTEMROOT}\\System32\\wsl.exe`, ['--list', '--running', '--quiet'], { timeoutMs: 30000 })
  const text = `${w.out}${w.err}`.replace(/\0/g, '')
  const wsl = w.code === 0 ? text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : /no running distributions/i.test(text) ? [] : null
  const t = run('tasklist', ['/FO', 'CSV', '/NH'], { timeoutMs: 30000 })
  const docker = t.code === 0 ? /"(com\.docker\.backend\.exe|Docker Desktop\.exe)"/i.test(t.out) : null
  return { wsl_running: wsl, docker_desktop_running: docker }
}

function qemuCpuMs(pid) {
  const r = run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Number(pid)}).TotalProcessorTime.TotalMilliseconds`], { timeoutMs: 30000 })
  const v = Number(r.out.trim()); return r.code === 0 && Number.isFinite(v) ? v : null
}

/**
 * One bounded guest burn (all vCPUs, BURN_SECONDS). Inside the window BURN_WINDOW_S (after start-up, before the end) the host measures QEMU's
 * own CPU time (its share of the whole host) and takes three host samples, so neither ssh start-up nor teardown dilutes the measurement.
 */
async function cpuBurn(W, cfg, rec, { vcpus, logicalCpus, diskPath }) {
  const started = Date.now()
  const at = async (s) => { const wait = started + s * 1000 - Date.now(); if (wait > 0) await sleep(wait) }
  const p = sshAsync(W, cfg, `${AS_WORKER} python3 -I - ${vcpus} ${BURN_SECONDS}`, BURN_PY, (BURN_SECONDS + 120) * 1000)
  await at(BURN_WINDOW_S[0])
  const c0 = qemuCpuMs(rec?.qemu_pid); const t0 = Date.now()
  const hostSamples = []
  for (let i = 0; i < 3; i += 1) { hostSamples.push(await sampleWindowsHost({ diskPath, ownedPids: rec?.qemu_pid ? [rec.qemu_pid] : [] })); await sleep(1500) }
  await at(BURN_WINDOW_S[1])
  const c1 = qemuCpuMs(rec?.qemu_pid); const t1 = Date.now()
  const r = await p
  let burn = null; try { burn = JSON.parse(r.out.trim().split('\n').pop()) } catch { /* invalid → S9.BURN_INVALID */ }
  // Valid only if the window really ended inside the burn (t1 before the guest burn could have finished).
  const inside = t1 - started <= (BURN_SECONDS - 2) * 1000
  const qemuHostCpuPct = inside && c0 != null && c1 != null && t1 > t0 ? Math.round(((c1 - c0) / ((t1 - t0) * logicalCpus)) * 1000) / 10 : null
  // Raw window facts, so a null or borderline share can be diagnosed from the evidence alone.
  const window = { qemu_cpu_ms_start: c0, qemu_cpu_ms_end: c1, start_offset_ms: t0 - started, end_offset_ms: t1 - started, end_inside_burn: inside, logical_cpus: logicalCpus }
  return { burn, hostSamples, qemuHostCpuPct, window }
}

function sshAsync(W, cfg, command, input, timeoutMs) {
  return new Promise((resolve) => {
    const c = spawn(SSH, [...sshArgs(W, cfg, { extra: ['-T'] }), command], { env: sysEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''; let err = ''
    const t = setTimeout(() => c.kill(), timeoutMs)
    c.stdout.on('data', (d) => { out = (out + d).slice(-65536) }); c.stderr.on('data', (d) => { err = (err + d).slice(-8192) })
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }) }); c.on('error', () => { clearTimeout(t); resolve({ code: null, out, err }) })
    c.stdin.end(input)
  })
}

function summarizeDecisions(ds) {
  const m = new Map(); for (const d of ds) { const k = `${d.allow ? 'allow' : 'deny'} ${d.host ?? '-'} ${d.code}`; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m].map(([k, n]) => `${k} x${n}`)
}
