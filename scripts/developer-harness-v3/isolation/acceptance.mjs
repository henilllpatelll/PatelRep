// Developer Harness V3 (D3.3) — the 13-scenario adversarial isolation acceptance suite (05-local-execution-architecture.md §5), run against the REAL
// worker VM. Each scenario records PASS / FAIL / NOT_RUN with the observations behind it. A mocked result is never recorded here. Bounded workloads
// only: small allocations inside the VM, a 15 s CPU burn under the Job Object cap, a disk fill limited to the 512 MB home disk.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteJson } from '../lib/atomic.mjs'
import { startEgressProxy } from '../runtime/egress-proxy.mjs'
import { sampleWindowsHost } from '../runtime/host-sampler.mjs'
import { admit } from '../runtime/resource-governor.mjs'
import { validateQemuArgs } from '../runtime/qemu-args.mjs'
import { spawn } from 'node:child_process'
import { liveness, openEgressChannel, readVmRecord, run, sshArgs, sshExec, stopVm, sysEnv } from '../runtime/vm-controller.mjs'
import { readProvisioned, startTaskWorker } from '../infra/provision.mjs'
import { importBundle } from '../runtime/artifact-transfer.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const AS_WORKER = 'sudo -u worker -H env -i HOME=/home/worker USER=worker LOGNAME=worker PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8'

/** Host addresses the guest must NOT reach (private values stay in memory; the report masks them). */
function hostTargets() {
  const v4 = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address)
  return { lan: v4.filter((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) }
}
const mask = (k) => k.replace(/\b(10|172|192)\.\d+\.\d+\.\d+/g, (m) => (m.startsWith('10.0.2.') ? m : `${m.split('.')[0]}.x.x.x`))
const maskObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [mask(k), v]))

export async function runAcceptance(L, { id = 'w1', log = console.error } = {}) {
  const startedAt = new Date().toISOString()
  const S = {}; const set = (n, verdict, evidence) => { S[n] = { verdict, evidence }; log(`scenario ${n}: ${verdict}`) }
  const W = L.worker(id)
  const prov = readProvisioned(W)
  if (!prov) return finish('NOT_RUN', 'WORKER.NOT_PROVISIONED')
  const before = await sampleWindowsHost({ diskPath: L.root.slice(0, 3) })
  const a = admit('vm_start', { host: before, history: [], active: { reasoning_sessions: 0, heavy_test_workloads: 0 }, reservations: [], now: Date.now(), vmFloor: 'probe', accel: prov.accel })
  if (a.decision !== 'admit') return finish('NOT_RUN', `RESOURCE.${a.reason_codes.join(',')}`)
  let { cfg } = await startTaskWorker(L, { id, ramMb: a.vm_ram_mb, accel: prov.accel, log })
  const proxyDecisions = []
  const proxy = await startEgressProxy({ profile: 'runtime', onDecision: (d) => proxyDecisions.push({ allow: d.allow, code: d.code, host: d.host ?? null }) })
  let egress = openEgressChannel(W, cfg, proxy.port); await sleep(4000)
  try {
    sshExec(W, cfg, 'sudo install -d -o worker -g worker -m 0755 /work/task')
    const ht = hostTargets()
    const targets = { host_addrs: ['10.0.2.2', ...ht.lan], host_ports: [22, 135, 445, 3000, 5432, 5433, 8000, 8080], controller_ports: [proxy.port, cfg.ssh_port], other_vm_addrs: ['172.26.0.1', '172.17.0.1', '192.168.65.1', '192.168.65.3', '10.0.2.4'] }
    const script = readFileSync(path.join(HERE, 'guest-probe.py'), 'utf8').replace('@@TARGETS@@', JSON.stringify(targets))
    const pr = sshExec(W, cfg, `${AS_WORKER} python3 -I -`, { input: script, timeoutMs: 900000 })
    let P = null; try { P = JSON.parse(pr.out.trim().split('\n').pop()) } catch { /* below */ }
    if (!P) { for (const n of [1, 2, 3, 4, 5, 6, 7, 10]) set(n, 'FAIL', { probe_error: (pr.err || pr.out).slice(-300) }) } else {
      const none = (o) => Object.values(o).every((v) => v !== 'CONNECTED' && v !== 'ANSWERED')
      set(1, P.s1_host_fs_types.length === 0 && P.s1_paths_present.length === 0 && P.s1_user === 'worker' && P.s1_block_devices.every((d) => /^vd[ab]$/.test(d)) ? 'PASS' : 'FAIL', { host_fs: P.s1_host_fs_types, paths: P.s1_paths_present, block_devices: P.s1_block_devices, user: P.s1_user })
      set(2, P.s2_binfmt.every((x) => ['register', 'status'].includes(x)) && P.s2_windows_tools_on_path.length === 0 && /Exec format error|format/i.test(P.s2_pe_exec) ? 'PASS' : 'FAIL', { binfmt: P.s2_binfmt, tools: P.s2_windows_tools_on_path, pe_exec: P.s2_pe_exec })
      set(3, none(P.s3_host_tcp) && P.s3_slirp_dns_udp !== 'ANSWERED' ? 'PASS' : 'FAIL', { host_tcp: maskObj(P.s3_host_tcp), slirp_dns: P.s3_slirp_dns_udp })
      set(4, none(P.s4_controller_tcp) && Object.values(P.s4_via_proxy).every((v) => /403|405|400/.test(v)) ? 'PASS' : 'FAIL', { controller_tcp: P.s4_controller_tcp, via_proxy: P.s4_via_proxy, note: 'D3.3 has no controller API/DB listener; QMP, SSH hostfwd and proxy ports were probed' })
      const okAllowed = /200/.test(P.s5_via_proxy['api.anthropic.com:443'] ?? '')
      const deniedRest = Object.entries(P.s5_via_proxy).filter(([k]) => k !== 'api.anthropic.com:443').every(([, v]) => /403|405|400/.test(v))
      set(5, P.s5_resolver !== 'RESOLVED' && none(P.s5_public_dns_udp) && none(P.s5_direct_tcp) && deniedRest && okAllowed ? 'PASS' : 'FAIL', { resolver: P.s5_resolver, public_dns: P.s5_public_dns_udp, direct_tcp: P.s5_direct_tcp, via_proxy: P.s5_via_proxy, positive_control_api_anthropic: okAllowed })
      set(6, none(P.s6_neighbors_tcp) ? 'PASS' : 'FAIL', { neighbors: maskObj(P.s6_neighbors_tcp), note: 'owner WSL distros were stopped during the run; isolation comes from slirp restrict=on (no routing at all), not from their state' })
      set(7, P.s7_sockets.length === 0 && P.s7_tools.length === 0 && P.s7_sudo !== 0 ? 'PASS' : 'FAIL', { sockets: P.s7_sockets, tools: P.s7_tools, worker_sudo_exit: P.s7_sudo })
      // No QMP exists; the authoritative device list is the host-validated argv. The guest's own PCI view is recorded as (untrusted) data.
      const devs = sshExec(W, cfg, 'cat /sys/bus/pci/devices/*/class | sort | uniq -c').out.trim().split(/\r?\n/).slice(0, 30)
      const cmdline = readFileSync(path.join(W.dir, 'qemu-cmdline.txt'), 'utf8')
      const argsProblems = validateQemuArgs(cmdline.match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, '')))
      set(10, P.s10_virtio_ports.length === 0 && P.s10_usb_devices.length === 0 && !P.s10_vsock && P.s10_agents.length === 0 && argsProblems.length === 0 ? 'PASS' : 'FAIL', { virtio_ports: P.s10_virtio_ports, usb: P.s10_usb_devices, vsock: P.s10_vsock, agents: P.s10_agents, qemu_arg_problems: argsProblems, pci_classes: devs })
      S.__worker_clock = P.s11_worker_set_clock
    }
    // 8 disk bounds: fill the 512 MB persistent home (fast); the task disk bound is its fixed virtual size.
    const fill = sshExec(W, cfg, `${AS_WORKER} sh -c 'dd if=/dev/zero of=/home/worker/.fill bs=1M count=900 status=none 2>&1; echo DD_EXIT=$?; df -B1 --output=size / | tail -1; rm -f /home/worker/.fill'`, { timeoutMs: 600000 })
    const ddExit = Number((/DD_EXIT=(\d+)/.exec(fill.out) ?? [])[1])
    const enospc = /No space left on device/.test(fill.out)
    const rootSize = Number(fill.out.trim().split(/\s+/).pop())
    const info = JSON.parse(run(L.qemuImg, ['info', '--output=json', W.task], { env: { SYSTEMROOT: process.env.SYSTEMROOT, PATH: `${path.dirname(L.qemuImg)};${process.env.SYSTEMROOT}\\System32` } }).out || '{}')
    set(8, ddExit !== 0 && enospc && rootSize <= 24 * 1073741824 && info['virtual-size'] === 24 * 1073741824 && statSync(W.auth).size < 700 * 1048576 ? 'PASS' : 'FAIL', { home_fill_dd_exit: ddExit, enospc, guest_root_bytes: rootSize, task_virtual_size: info['virtual-size'], auth_disk_host_bytes: statSync(W.auth).size })
    // 9 RAM / CPU bounds: the guest OOM-kills an over-allocation; QEMU stays under its Job Object cap; host stays out of critical.
    const rec = readVmRecord(W)
    // Over-allocation must END in the guest OOM killer (137 = SIGKILL) or a Python MemoryError — not in the `timeout` (124), which proves nothing.
    const alloc = sshExec(W, cfg, `${AS_WORKER} timeout 600 python3 -I -c "b=[]\nfor i in range(${Math.ceil((cfg.ram_mb * 2) / 32)}):\n b.append(bytearray(32*1024*1024))\nprint('ALLOCATED_ALL')" 2>&1; echo EXIT=$?`, { timeoutMs: 900000 })
    const exitCode = Number((/EXIT=(\d+)/.exec(alloc.out) ?? [])[1])
    const memBounded = !/ALLOCATED_ALL/.test(alloc.out) && (exitCode === 137 || /MemoryError/.test(alloc.out))
    const mid = await sampleWindowsHost({ diskPath: L.root.slice(0, 3), ownedPids: [rec.qemu_pid] })
    // CPU burn runs in the background while the host is sampled DURING it.
    const burnStart = Date.now()
    const burner = spawnBurn(W, cfg, 40)
    await sleep(15000)
    const burn = await sampleWindowsHost({ diskPath: L.root.slice(0, 3), ownedPids: [rec.qemu_pid] })
    await burner
    const ws = mid.owned_processes?.[rec.qemu_pid]?.working_set_mb ?? null
    set(9, memBounded && ws !== null && ws <= rec.memory_limit_mb && mid.available_mb > 1024 && burn.host_responsive === true ? 'PASS' : 'FAIL',
      { guest_alloc_exit: exitCode, guest_alloc_outcome: /MemoryError/.test(alloc.out) ? 'MemoryError' : exitCode === 137 ? 'oom_killed' : 'other', qemu_working_set_mb: ws, job_memory_limit_mb: rec.memory_limit_mb,
        host_available_mb_during: mid.available_mb, host_cpu_pct_during_burn: burn.cpu_pct, job_cpu_rate_cap_pct: rec.cpu_rate_percent, burn_s: Math.round((Date.now() - burnStart) / 1000), host_responsive_during_burn: burn.host_responsive })
    // 11 clock / policy / evidence: guest root changing the GUEST clock does not move the host clock; the worker cannot even do that.
    const h0 = Date.now()
    sshExec(W, cfg, 'sudo date -s "+1 day" >/dev/null')
    const h1 = Date.now(); const gNow = Number(sshExec(W, cfg, 'date +%s').out.trim()) * 1000
    sshExec(W, cfg, `sudo date -s @${Math.floor(Date.now() / 1000)} >/dev/null`)
    set(11, S.__worker_clock !== 0 && gNow - h1 > 20 * 3600000 && h1 - h0 < 60000 ? 'PASS' : 'FAIL', { worker_date_s_exit: S.__worker_clock, guest_clock_shift_h: Math.round((gNow - h1) / 3600000), host_clock_unaffected: h1 - h0 < 60000, note: 'policy pin / evidence / controller state live only on the host (unreachable per 1, 3, 4)' })
    delete S.__worker_clock
    // 12 artifact integrity: the host pulls a bundle and RECOMPUTES the tree; a guest-claimed tree is never trusted.
    const g = sshExec(W, cfg, `${AS_WORKER} sh -c 'cd /work/task && git init -q && git -c user.email=w@x -c user.name=w commit -q --allow-empty -m init && echo hello > a.txt && git add a.txt && git -c user.email=w@x -c user.name=w commit -q -m a && git rev-parse HEAD^{tree} && git bundle create -q /home/worker/.tmp/b.bundle HEAD && base64 -w0 /home/worker/.tmp/b.bundle'`, { timeoutMs: 300000 })
    const [claimedTree, b64] = g.out.trim().split(/\r?\n/)
    const imported = importBundle(Buffer.from(b64 ?? '', 'base64'))
    const hostTree = imported.ok ? imported.tree : null
    // A redirect file posing as a bundle must be refused outright (security review S2).
    const redirect = importBundle(Buffer.from('gitdir: C:/Users/x/projects/PatelRep/.git\n'))
    // The same acceptance function is applied to the genuine claim and to a forged one (a valid-looking tree id the bundle does not contain).
    const forged = sshExec(W, cfg, `${AS_WORKER} sh -c 'cd /work/task && echo tampered > b.txt && git add b.txt && git write-tree'`).out.trim()
    set(12, imported.ok && verifyTreeClaim(claimedTree, hostTree) && /^[0-9a-f]{40}$/.test(forged) && !verifyTreeClaim(forged, hostTree) && redirect.code === 'BUNDLE.BAD_HEADER' ? 'PASS' : 'FAIL',
      { import: imported.ok ? 'ok' : imported.code, host_recomputed_tree: hostTree, genuine_claim_accepted: verifyTreeClaim(claimedTree, hostTree), forged_claim_rejected: !verifyTreeClaim(forged, hostTree), gitdir_redirect_refused: redirect.code, rule: 'evidence binds to the HOST-computed tree_digest only; import = verify + fsck fetch into a fresh bare repo, never clone' })
    // 13 snapshot recovery / residue: plant residue, discard the overlay, boot fresh, look for it.
    sshExec(W, cfg, `${AS_WORKER} sh -c 'echo r > /work/task/residue.txt; echo r > /home/worker/.residue; mkdir -p /home/worker/.claude/skills/x; echo "{\\"hooks\\":{\\"PreToolUse\\":[]}}" > /home/worker/.claude/settings.json'`)
    // Sanitizer attack (security review B1): symlinked temp names aimed at ctl's shell init, a symlinked .claude, a FIFO, a hard link.
    const bashrcBefore = sshExec(W, cfg, 'sudo sha256sum /home/ctl/.bashrc /etc/sudoers | cut -c1-64').out.trim()
    sshExec(W, cfg, `${AS_WORKER} sh -c 'cd /home/worker && echo "{\\"oauthAccount\\":\\"$(id)\\",\\"projects\\":{}}" > .claude.json; ln -sf /home/ctl/.bashrc .claude.json.dh3new; ln -sf /home/ctl/.bashrc .claude.json.dh3tmp; mkfifo fifo; ln /etc/hostname hard 2>/dev/null; mv .claude .claude.real; ln -s /etc .claude; true'`)
    egress.kill(); egress = null
    await stopVm(W, cfg, { log })
    ;({ cfg } = await startTaskWorker(L, { id, ramMb: a.vm_ram_mb, accel: prov.accel, log }))
    const after = sshExec(W, cfg, 'for p in /work/task/residue.txt /home/worker/.residue /home/worker/.claude/settings.json /home/worker/.claude/skills /home/worker/fifo /home/worker/hard /home/worker/.claude.real /home/worker/.claude.json.dh3new /home/worker/.claude.json.dh3tmp; do test -e $p -o -L $p && echo PRESENT:$p; done; test -L /home/worker/.claude && echo PRESENT:claude-symlink; test -f /run/dh3-sanitized && echo MARKER; sudo cat /home/worker/.claude.json 2>/dev/null | head -c 200; echo; echo CHECKED')
    const bashrcAfter = sshExec(W, cfg, 'sudo sha256sum /home/ctl/.bashrc /etc/sudoers | cut -c1-64').out.trim()
    const goldenRO = (statSync(W.golden).mode & 0o222) === 0
    const keptJson = after.out.includes('"projects"') === false
    set(13, /CHECKED/.test(after.out) && !/PRESENT:/.test(after.out) && /MARKER/.test(after.out) && bashrcBefore === bashrcAfter && bashrcBefore.length > 0 && keptJson && goldenRO ? 'PASS' : 'FAIL',
      { residue_found: after.out.split('\n').filter((l) => l.startsWith('PRESENT:')), sanitizer_marker: /MARKER/.test(after.out), root_targets_unchanged: bashrcBefore === bashrcAfter, non_allowlisted_json_keys_dropped: keptJson, golden_read_only: goldenRO })
  } catch (e) {
    log(`acceptance aborted: ${e.message}`)
  } finally {
    try { egress?.kill() } catch { /* ignore */ }
    await proxy.close()
    const rec = readVmRecord(W); if (rec && liveness(rec).qemu !== false) await stopVm(W, cfg, { log })
  }
  for (let n = 1; n <= 13; n += 1) if (!S[n]) S[n] = { verdict: 'NOT_RUN', evidence: { reason: 'aborted before this scenario' } }
  return finish(Object.values(S).every((s) => s.verdict === 'PASS') ? 'PASS' : Object.values(S).some((s) => s.verdict === 'FAIL') ? 'FAIL' : 'INCOMPLETE')

  function finish(verdict, reason = null) {
    const doc = { schema: 'patelrep.developer-harness-v3.isolation-acceptance', started_at: startedAt, finished_at: new Date().toISOString(), verdict, reason, accel: prov?.accel ?? null,
      claude_version: prov?.claude_version ?? null, scenarios: S, proxy_decisions: summarizeDecisions(proxyDecisions),
      caveats: ['AI-run automated test, not an external security audit', prov?.accel === 'tcg' ? 'run under TCG emulation (WHPX not enabled); the WHPX hypervisor boundary is NOT exercised by this run' : 'run under WHPX'] }
    atomicWriteJson(path.join(L.evidence, 'isolation-acceptance.json'), doc)
    return doc
  }
}

/** A guest's tree claim is accepted only if it equals the tree the HOST recomputed from the pulled bundle. */
export const verifyTreeClaim = (claim, hostTree) => typeof claim === 'string' && /^[0-9a-f]{40}$/.test(hostTree ?? '') && claim === hostTree

function spawnBurn(W, cfg, seconds) {
  return new Promise((resolve) => {
    const c = spawn('ssh', [...sshArgs(W, cfg, { extra: ['-T'] }), `${AS_WORKER} timeout ${seconds} sh -c 'yes >/dev/null & yes >/dev/null & wait'`], { env: sysEnv(), windowsHide: true, stdio: 'ignore' })
    c.on('close', resolve); c.on('error', resolve)
  })
}

function summarizeDecisions(ds) {
  const m = new Map(); for (const d of ds) { const k = `${d.allow ? 'allow' : 'deny'} ${d.host ?? '-'} ${d.code}`; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m].map(([k, n]) => `${k} x${n}`)
}