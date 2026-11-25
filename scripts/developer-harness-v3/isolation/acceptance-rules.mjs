// Developer Harness V3 (D3.3) — pure, fail-closed evaluators for the 13 isolation acceptance scenarios (05 §5).
//
// The guest probe (guest-probe.py) and the host orchestrator (acceptance.mjs) only COLLECT facts; every verdict is decided here, on the host, so
// that it can be unit-tested against positive, negative and malformed fixtures. Rules applied everywhere:
//   * a scenario PASSES only when every required observation is present, well-formed and has an expected value; an empty map, a missing
//     field, a probe-section exception or an unrecognised outcome is a FAIL (never a vacuous PASS);
//   * "could not connect" is accepted only as an explicitly known no-connection outcome (errno name or timeout), with exact target coverage;
//   * hardening the trusted provisioning claims (provisioned.json `guest_hardening`) must be observed in effect, or the scenario fails.
import { HARDENING_MODULES } from '../infra/cloud-init.mjs'

export const PROBE_VERSION = 3
export const ACCEPTANCE_SCHEMA = 'patelrep.developer-harness-v3.isolation-acceptance'
export const NO_CONNECT = Object.freeze(['timeout', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT'])
const GIB = 1073741824

/** The ONLY binary-format handlers a worker guest may have: Debian's python3.13 bytecode handler, matched field by field. */
export const BINFMT_ALLOWLIST = Object.freeze([Object.freeze({ name: 'python3.13', enabled: true, interpreter: '/usr/bin/python3.13', flags: '', offset: 0, magic: 'f30d0d0a', mask: null, extension: null })])
/** virtio bus ids (vendor:device) the validated QEMU argv can produce: net, block, entropy, balloon. */
export const VIRTIO_ALLOWED = Object.freeze(['0x1af4:0x0001', '0x1af4:0x0002', '0x1af4:0x0004', '0x1af4:0x0005'])
/** PCI ids of the q35 chipset functions plus the four virtio devices (transitional or modern ids). */
export const PCI_ALLOWED = Object.freeze(['0x8086:0x29c0', '0x8086:0x2918', '0x8086:0x2922', '0x8086:0x2930',
  '0x1af4:0x1000', '0x1af4:0x1041', '0x1af4:0x1001', '0x1af4:0x1042', '0x1af4:0x1005', '0x1af4:0x1044', '0x1af4:0x1002', '0x1af4:0x1045'])
export const VSOCK_TRANSPORT_MODULES = Object.freeze(['vmw_vsock_virtio_transport', 'vmw_vsock_virtio_transport_common', 'vmw_vsock_vmci_transport', 'hv_sock', 'vhost_vsock', 'vmw_vmci'])
export const VSOCK_CORE_MODULES = Object.freeze(['vsock', 'vsock_loopback', 'vsock_diag'])
/** Modules whose presence means a host-integration driver is live (shared folders, consoles, VMBus, guest tools). */
export const HOST_CHANNEL_MODULES = Object.freeze([...VSOCK_TRANSPORT_MODULES, 'hv_vmbus', 'hv_utils', 'virtio_console', '9pnet_virtio', '9p', 'virtiofs', 'vboxguest', 'vboxsf', 'vmw_balloon', 'vmwgfx'])
const HOST_FS_TYPES = Object.freeze(['9p', 'virtiofs', 'cifs', 'smb3', 'smbfs', 'drvfs', 'vboxsf', 'fuse', 'nfs', 'nfs4', 'vmhgfs'])
const PRIVILEGED_GROUPS = Object.freeze(['root', 'sudo', 'wheel', 'adm', 'docker', 'lxd', 'incus', 'disk', 'kvm', 'libvirt', 'systemd-journal'])
export const HARDENING_INSTALLS = HARDENING_MODULES // single source of truth: what trusted provisioning writes

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
const isStrArr = (x) => Array.isArray(x) && x.every((v) => typeof v === 'string')
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
const result = (problems, evidence, extra = {}) => ({ verdict: problems.length ? 'FAIL' : 'PASS', problems: [...new Set(problems)], evidence, ...extra })

/** The probe output is usable only if it is the expected version and ran to completion. */
export const probeValid = (P) => isObj(P) && P.probe_version === PROBE_VERSION && P.complete === true

/** A probe section, or the reason it cannot be evaluated. */
function sectionOf(P, name, code) {
  if (!probeValid(P)) return { s: null, problem: `${code}.PROBE_INVALID` }
  const s = P[name]
  if (!isObj(s)) return { s: null, problem: `${code}.SECTION_MISSING` }
  if (typeof s.__error__ === 'string') return { s: null, problem: `${code}.SECTION_FAILED:${s.__error__.slice(0, 60)}` }
  return { s, problem: null }
}

/** Every expected target must be present (exact coverage) and must report a known no-connection outcome. */
export function checkNoConnect(map, expectedKeys, code, problems) {
  if (!isObj(map)) { problems.push(`${code}.MALFORMED`); return }
  if (!expectedKeys.length || !sameSet(Object.keys(map), expectedKeys)) problems.push(`${code}.COVERAGE`)
  for (const [k, v] of Object.entries(map)) if (!NO_CONNECT.includes(v)) problems.push(v === 'CONNECTED' || v === 'ANSWERED' ? `${code}.REACHED:${k}` : `${code}.UNKNOWN_OUTCOME:${k}`)
}
const cross = (hosts, ports) => hosts.flatMap((h) => ports.map((p) => `${h}:${p}`))

export function evalS1(P) {
  const { s, problem } = sectionOf(P, 's1', 'S1'); if (!s) return result([problem], {})
  const p = []
  if (!isStrArr(s.fs_types) || !isStrArr(s.paths_present) || !isStrArr(s.block_devices)) return result(['S1.MALFORMED'], {})
  const hostFs = s.fs_types.filter((t) => HOST_FS_TYPES.includes(t) || t.startsWith('fuse.'))
  if (hostFs.length) p.push('S1.HOST_FILESYSTEM_MOUNTED')
  if (s.root_fs_type !== 'ext4') p.push('S1.ROOT_FS_UNEXPECTED') // positive control: the mount table was really read
  if (s.paths_present.length) p.push('S1.HOST_PATHS_PRESENT')
  if (!s.block_devices.includes('vda') || !s.block_devices.every((d) => /^vd[ab]$/.test(d))) p.push('S1.BLOCK_DEVICES_UNEXPECTED')
  if (s.user !== 'worker') p.push('S1.NOT_WORKER')
  return result(p, { host_fs: hostFs, root_fs_type: s.root_fs_type, paths: s.paths_present, block_devices: s.block_devices, user: s.user })
}

/** Parse one /proc/sys/fs/binfmt_misc/<name> entry. Unknown lines or missing core fields → null (malformed, never allowed). */
export function parseBinfmtEntry(text) {
  if (typeof text !== 'string' || text.length > 4096) return null
  const h = { enabled: null, interpreter: null, flags: null, offset: null, magic: null, mask: null, extension: null }
  for (const raw of text.split('\n')) {
    const l = raw.trim(); if (!l) continue
    if (l === 'enabled' || l === 'disabled') h.enabled = l === 'enabled'
    else if (l.startsWith('interpreter ')) h.interpreter = l.slice(12)
    else if (l.startsWith('flags:')) h.flags = l.slice(6).trim()
    else if (/^offset \d+$/.test(l)) h.offset = Number(l.slice(7))
    else if (/^magic [0-9a-f]+$/.test(l)) h.magic = l.slice(6)
    else if (/^mask [0-9a-f]+$/.test(l)) h.mask = l.slice(5)
    else if (/^extension \S+$/.test(l)) h.extension = l.slice(10)
    else return null
  }
  return h.enabled === null || h.interpreter === null || h.flags === null ? null : h
}
export const binfmtHandlerAllowed = (name, h) => !!h && BINFMT_ALLOWLIST.some((a) => a.name === name && Object.keys(a).every((k) => k === 'name' || a[k] === h[k]))

/** Parse the controller's root-side fact block (sections separated by @@MARKERS@@). Incomplete → null. */
export function parseRootFacts(text) {
  const t = String(text ?? '')
  if (!/^@@END$/m.test(t)) return null
  const part = (a, b) => { const i = t.indexOf(`${a}\n`); const j = t.indexOf(`${b}\n`, i + 1); return i < 0 || j < 0 ? null : t.slice(i + a.length + 1, j).split('\n').map((l) => l.trim()).filter(Boolean) }
  const fw = part('@@FWCFG', '@@DMI'); const dmi = part('@@DMI', '@@MODPROBE'); const mp = part('@@MODPROBE', '@@MASK'); const mask = part('@@MASK', '@@VSOCK'); const vs = part('@@VSOCK', '@@END')
  if (!fw || !dmi || !mp || !mask || !vs) return null
  const fwState = fw[0] === 'FWCFG_LISTED' ? 'listed' : fw[0] === 'FWCFG_NO_DRIVER' ? 'no_driver' : 'error'
  const installs = mp.map((l) => /^install (\S+) \/bin\/false$/.exec(l)?.[1]).filter(Boolean)
  return { fw_cfg: { state: fwState, names: fw.slice(1) }, dmi_type11: /^\d+$/.test(dmi[0] ?? '') ? Number(dmi[0]) : null, modprobe_false_installs: installs.sort(), binfmt_automount: mask[0] ?? null,
    vsock_root_open: rootOpenOutcome(vs[0]) }
}
/** Root's open() of /dev/vsock, from dash's error text (the only reliable signal: an unprivileged worker gets EACCES on the 0600 node). */
export function rootOpenOutcome(line) {
  const l = String(line ?? '')
  if (l === 'NO_NODE') return 'no_node'
  if (l === 'ROOT_OPEN_OK') return 'opened'
  if (/: No such device or address$/.test(l)) return 'ENXIO'
  if (/: No such device$/.test(l)) return 'ENODEV'
  return 'unknown'
}
export const hardeningInEffect = (root) => !!root && HARDENING_INSTALLS.every((m) => root.modprobe_false_installs.includes(m)) && root.binfmt_automount === 'masked'

const execErr = (r, want) => isObj(r) && r.ran === false && r.errno === want

/**
 * ctx: { fixtureSha256, fixtureProblems: string[], hostRun: {rc}, hardened: {binfmt:boolean}, root: parseRootFacts() }
 */
export function evalS2(P, ctx) {
  const { s, problem } = sectionOf(P, 's2', 'S2'); if (!s) return result([problem], {})
  const p = []
  const entries = s.binfmt_dir_entries
  if (!(entries === null || isStrArr(entries)) || !isObj(s.binfmt_handlers) || !isObj(s.exec) || !isObj(s.host_binary_paths) || !isStrArr(s.windows_tools_on_path) || !isStrArr(s.wsl_env)) return result(['S2.MALFORMED'], {})
  const named = (entries ?? []).filter((n) => n !== 'register' && n !== 'status')
  if (!sameSet(named, Object.keys(s.binfmt_handlers))) p.push('S2.BINFMT_INCONSISTENT')
  const handlers = {}
  for (const [n, raw] of Object.entries(s.binfmt_handlers)) {
    if (isObj(raw)) { p.push(`S2.BINFMT_UNREADABLE:${n}`); handlers[n] = raw; continue }
    const h = parseBinfmtEntry(raw); handlers[n] = h ?? { malformed: true }
    if (!binfmtHandlerAllowed(n, h)) p.push(`S2.BINFMT_UNAUTHORIZED:${n}`)
  }
  if (ctx?.hardened?.binfmt) {
    if (named.length || s.binfmt_mounted !== false) p.push('S2.BINFMT_PRESENT_ON_HARDENED_IMAGE')
    if (!hardeningInEffect(ctx.root)) p.push('S2.HARDENING_NOT_IN_EFFECT')
  } else p.push('S2.IMAGE_NOT_HARDENED') // acceptance needs an image built with the guest hardening (15)
  // The fixture is a genuine Windows executable: structurally valid, delivered intact, and accepted by the Windows HOST (positive control).
  if (!Array.isArray(ctx?.fixtureProblems) || ctx.fixtureProblems.length) p.push('S2.FIXTURE_INVALID')
  if (typeof ctx?.fixtureSha256 !== 'string' || s.fixture_sha256_written !== ctx.fixtureSha256) p.push('S2.FIXTURE_NOT_DELIVERED')
  if (ctx?.hostRun?.rc !== 0) p.push('S2.FIXTURE_NOT_RUNNABLE_ON_HOST')
  for (const k of ['pe_exe', 'pe_noext', 'mz_stub']) if (!execErr(s.exec[k], 'ENOEXEC')) p.push(`S2.NOT_ENOEXEC:${k}`)
  if (!(isObj(s.exec.positive_control) && s.exec.positive_control.ran === true && s.exec.positive_control.rc === 42)) p.push('S2.POSITIVE_CONTROL_FAILED')
  const hostPaths = Object.keys(s.host_binary_paths)
  if (hostPaths.length !== 3) p.push('S2.HOST_PATH_COVERAGE')
  for (const k of hostPaths) if (!execErr(s.host_binary_paths[k], 'ENOENT')) p.push(`S2.HOST_BINARY_REACHABLE:${k}`)
  if (s.windows_tools_on_path.length) p.push('S2.WINDOWS_TOOLS_ON_PATH')
  if (s.wsl_env.length) p.push('S2.WSL_ENVIRONMENT')
  return result(p, { binfmt_entries: entries, binfmt_mounted: s.binfmt_mounted, binfmt_status: s.binfmt_status, binfmt_handlers: handlers, exec: s.exec, host_binary_paths: s.host_binary_paths,
    fixture: { sha256: ctx?.fixtureSha256 ?? null, structural_problems: ctx?.fixtureProblems ?? null, host_run_rc: ctx?.hostRun?.rc ?? null, host_run_error: ctx?.hostRun?.error ?? null }, windows_tools: s.windows_tools_on_path, wsl_env: s.wsl_env })
}

/** ctx.targets: { host_addrs, host_ports } */
export function evalS3(P, ctx) {
  const { s, problem } = sectionOf(P, 's3', 'S3'); if (!s) return result([problem], {})
  const p = []
  checkNoConnect(s.host_tcp, cross(ctx.targets.host_addrs, ctx.targets.host_ports), 'S3.HOST_TCP', p)
  if (!NO_CONNECT.includes(s.slirp_dns_udp)) p.push(s.slirp_dns_udp === 'ANSWERED' ? 'S3.SLIRP_DNS_ANSWERED' : 'S3.SLIRP_DNS_UNKNOWN')
  return result(p, { host_tcp: s.host_tcp, slirp_dns: s.slirp_dns_udp })
}

const DENIED = /^HTTP\/1\.1 403 /
const ALLOWED = /^HTTP\/1\.1 200 /
/** The only host the runtime proxy profile may allow during the probe. */
export const PROBE_ALLOWED_HOSTS = Object.freeze(['api.anthropic.com'])

/**
 * Host-side corroboration of the guest's proxy claims (scenarios 4 and 5). The guest's "403"/"200" lines are guest-reported; the proxy's own
 * decision log (decisions recorded by the host proxy process during the probe window) is not. Every claimed denial must be matched by at least
 * as many host deny decisions, every claimed tunnel by an allow decision, and the host must never have allowed any host off the allow-list.
 * Extra host denials (e.g. guest background traffic) are tolerated; a shortfall means the guest claimed something the proxy never saw.
 */
export function corroborateProxy(P, log) {
  if (!Array.isArray(log) || !log.every((d) => isObj(d) && typeof d.allow === 'boolean')) return { problems: ['PROXY_LOG_MISSING'], evidence: null }
  const claims = [P?.s4?.via_proxy, P?.s5?.via_proxy].filter(isObj).flatMap((m) => Object.values(m).map(String))
  const claimedDeny = claims.filter((c) => DENIED.test(c)).length; const claimedAllow = claims.filter((c) => ALLOWED.test(c)).length
  const hostDeny = log.filter((d) => !d.allow).length
  const hostAllow = log.filter((d) => d.allow)
  const problems = []
  if (hostDeny < claimedDeny) problems.push('PROXY_DENIALS_NOT_CORROBORATED')
  if (hostAllow.length < claimedAllow) problems.push('PROXY_ALLOW_NOT_CORROBORATED')
  if (hostAllow.some((d) => !PROBE_ALLOWED_HOSTS.includes(d.host))) problems.push('PROXY_ALLOWED_OFF_LIST')
  return { problems, evidence: { guest_claimed_denials: claimedDeny, host_denials: hostDeny, guest_claimed_tunnels: claimedAllow, host_allows: hostAllow.map((d) => d.host ?? null) } }
}

export function evalS4(P, ctx) {
  const { s, problem } = sectionOf(P, 's4', 'S4'); if (!s) return result([problem], {})
  const p = []
  const cor = corroborateProxy(P, ctx?.proxyLog); for (const x of cor.problems) p.push(`S4.${x}`)
  checkNoConnect(s.controller_tcp, ctx.targets.controller_ports.map((x) => `10.0.2.2:${x}`), 'S4.CONTROLLER_TCP', p)
  const want = [`127.0.0.1:${ctx.targets.controller_ports[0]}`, `localhost:${ctx.targets.controller_ports[0]}`, '10.0.2.2:22']
  if (!isObj(s.via_proxy) || !sameSet(Object.keys(s.via_proxy), want)) p.push('S4.PROXY_COVERAGE')
  else for (const [k, v] of Object.entries(s.via_proxy)) if (!DENIED.test(String(v))) p.push(`S4.PROXY_NOT_DENIED:${k}`)
  return result(p, { controller_tcp: s.controller_tcp, via_proxy: s.via_proxy, host_proxy_log: cor.evidence })
}

export const S5_PROXY_TARGETS = Object.freeze(['example.com:443', 'github.com:443', 'registry.npmjs.org:443', 'api.anthropic.com:80', '2130706433:443', '[::1]:443', 'api.anthropic.com:443'])
export function evalS5(P, ctx) {
  const { s, problem } = sectionOf(P, 's5', 'S5'); if (!s) return result([problem], {})
  const p = []
  const cor = corroborateProxy(P, ctx?.proxyLog); for (const x of cor.problems) p.push(`S5.${x}`)
  if (!/^gaierror:-?\d+$/.test(String(s.resolver))) p.push(s.resolver === 'RESOLVED' ? 'S5.RESOLVER_ANSWERED' : 'S5.RESOLVER_UNKNOWN')
  checkNoConnect(s.public_dns_udp, ['1.1.1.1', '8.8.8.8'], 'S5.PUBLIC_DNS', p)
  checkNoConnect(s.direct_tcp, ['1.1.1.1:443', '160.79.104.10:443', '140.82.112.3:443'], 'S5.DIRECT_TCP', p)
  const positive = isObj(s.via_proxy) && /^HTTP\/1\.1 200 /.test(String(s.via_proxy['api.anthropic.com:443']))
  if (!isObj(s.via_proxy) || !sameSet(Object.keys(s.via_proxy), S5_PROXY_TARGETS)) p.push('S5.PROXY_COVERAGE')
  else for (const k of S5_PROXY_TARGETS.filter((t) => t !== 'api.anthropic.com:443')) if (!DENIED.test(String(s.via_proxy[k]))) p.push(`S5.PROXY_NOT_DENIED:${k}`)
  if (!positive) p.push('S5.POSITIVE_CONTROL_FAILED')
  return result(p, { resolver: s.resolver, public_dns: s.public_dns_udp, direct_tcp: s.direct_tcp, via_proxy: s.via_proxy, positive_control_api_anthropic: positive, host_proxy_log: cor.evidence })
}

/** ctx.hostNeighbors: { wsl_running: string[]|null, docker_desktop_running: boolean|null } — recorded so the evidence never overstates what was exercised. */
export function evalS6(P, ctx) {
  const { s, problem } = sectionOf(P, 's6', 'S6'); if (!s) return result([problem], {})
  const p = []
  checkNoConnect(s.neighbors_tcp, cross(ctx.targets.other_vm_addrs, [22, 80, 2375, 2376]), 'S6.NEIGHBORS', p)
  const hn = ctx.hostNeighbors ?? {}
  const exercised = (Array.isArray(hn.wsl_running) && hn.wsl_running.length > 0) || hn.docker_desktop_running === true
  const known = Array.isArray(hn.wsl_running) && typeof hn.docker_desktop_running === 'boolean'
  const limitations = exercised ? [] : [known ? 'no WSL distribution or Docker Desktop was running: an ACTIVE WSL/Docker network was not empirically exercised' : 'host WSL/Docker state could not be determined']
  return result(p, { neighbors: s.neighbors_tcp, host_wsl_running_count: Array.isArray(hn.wsl_running) ? hn.wsl_running.length : null, host_docker_desktop_running: hn.docker_desktop_running ?? null, active_neighbors_exercised: exercised }, { limitations })
}

export function evalS7(P) {
  const { s, problem } = sectionOf(P, 's7', 'S7'); if (!s) return result([problem], {})
  if (!isStrArr(s.sockets) || !isStrArr(s.tools) || !isStrArr(s.groups)) return result(['S7.MALFORMED'], {})
  const p = []
  if (s.sockets.length) p.push('S7.CONTAINER_SOCKET_PRESENT')
  if (s.tools.length) p.push('S7.CONTAINER_TOOL_PRESENT')
  if (s.sudo_rc !== 1) p.push('S7.SUDO_NOT_REFUSED') // `sudo -n` without a sudoers grant exits exactly 1
  if (!s.groups.includes('worker') || s.groups.some((g) => PRIVILEGED_GROUPS.includes(g))) p.push('S7.GROUPS_UNEXPECTED')
  return result(p, { sockets: s.sockets, tools: s.tools, worker_sudo_exit: s.sudo_rc, groups: s.groups })
}

/** o: { ddExit, enospc, rootBytes, taskVirtualSize, authDiskBytes } */
export function evalS8(o) {
  const p = []
  if (!Number.isInteger(o?.ddExit) || o.ddExit === 0) p.push('S8.FILL_NOT_STOPPED')
  if (o?.enospc !== true) p.push('S8.NO_ENOSPC')
  if (!Number.isFinite(o?.rootBytes) || o.rootBytes <= 0 || o.rootBytes > 24 * GIB) p.push('S8.ROOT_SIZE')
  if (o?.taskVirtualSize !== 24 * GIB) p.push('S8.TASK_VIRTUAL_SIZE')
  if (!Number.isFinite(o?.authDiskBytes) || o.authDiskBytes >= 700 * 1048576) p.push('S8.AUTH_DISK_SIZE')
  return result(p, { home_fill_dd_exit: o?.ddExit ?? null, enospc: o?.enospc ?? null, guest_root_bytes: o?.rootBytes ?? null, task_virtual_size: o?.taskVirtualSize ?? null, auth_disk_host_bytes: o?.authDiskBytes ?? null })
}

// A burn is valid only if every guest worker ran, on exactly the VM's vCPUs (the guest's own affinity count, not the requested argv), and
// reported its own guest CPU time.
const validBurn = (b, vcpus) => isObj(b) && Number.isInteger(b.iterations) && b.iterations > 0 && Number.isFinite(b.busy_pct) && Number.isFinite(b.seconds) && b.seconds > 0
  && b.workers === vcpus && b.reports === vcpus && b.cpus === vcpus && Number.isFinite(b.cpu_seconds) && b.cpu_seconds > 0
const jobAttested = (j, capPct) => isObj(j) && j.flags === 5 && j.rate === capPct * 100 // JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | HARD_CAP, rate in 1/100 %
/** Above this whole-host CPU % at any sample during a burn, a slower capped burn could be host contention rather than the cap: void. */
export const S9_MAX_HOST_CPU_PCT = 70
/** Host-measured QEMU CPU share: capped must stay at the cap (+15 % and +0.5 pt measurement slack); normal must clearly exceed the binding cap. */
export const S9_QEMU_CAP_SLACK = 1.15
export const S9_QEMU_NORMAL_OVER_CAP = 1.5
/** Host CPU samples that must be MEASURED inside each burn window, and the shape version of their evidence (must equal HOST_CPU_SAMPLING_VERSION). */
export const S9_HOST_CPU_SLOTS = 3
export const S9_HOST_SAMPLING_VERSION = 1
/** The burn and the window the host samples inside, pinned HERE so a record cannot widen them (acceptance.mjs's constants must equal these; tested). */
export const S9_BURN_MS = 40000
export const S9_BURN_WINDOW_MS = Object.freeze([8000, 30000])
export const S9_MAX_ATTEMPTS_PER_SLOT = 3
/** Process-level sampler failures (any SAMPLER.* error) tolerated per burn, and the shortest run that can have spanned `typeperf`'s interval. */
export const S9_MAX_PROCESS_FAILURES = 2
export const S9_MIN_SAMPLER_MS = 900
/** A sampler timeout counts against host responsiveness only when it ran for this full budget (the sampler's default; tested equal). */
export const S9_FULL_ATTEMPT_TIMEOUT_MS = 8000
const SAMPLING_OUTCOMES = Object.freeze(['accepted', 'rejected_unmeasured', 'rejected_outside_window'])
const numOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v))

/**
 * Verify the evidence behind one burn's host-CPU samples (`cpuPct` = the three per-slot values scenario 9 judges, `null` for an unmeasured slot)
 * and judge EVERY measurement in it. The sampler's retries are only trustworthy if the record proves what they did, so this does not trust the
 * sampler's own summary (its accepted list, its responsiveness list or its stop reason):
 *  - the burn, the window and the retry bound are the pinned constants; the guest burn must have ended after the window closed;
 *  - attempts are chronological and non-overlapping, slot by slot, numbered 1..n within a slot (so none can be duplicated, reordered or
 *    hidden); a failed attempt carries a reason and cannot be a clean measurement; at most one attempt per slot is accepted, and only as that
 *    slot's last; an `rejected_outside_window` attempt is genuinely outside the window or the burn, and ends the sampling;
 *  - an accepted attempt is a real measurement (finite CPU % and memory, clean exit, a run long enough to span the interval, responsive), equal
 *    to the value being judged (nothing substituted), inside the window and before the guest burn ended;
 *  - EVERY measured value of EVERY attempt is judged: CPU % (also a failed run's `unverified_cpu_pct`) above the ceiling is S9.HOST_CPU_CONTENDED
 *    and available memory at or below the floor is S9.HOST_MEMORY_LOW, whether or not that attempt was retried away. A retry can therefore add
 *    evidence but never remove an adverse reading;
 *  - a spawn failure, oversized output, or a timeout that ran for the FULL time budget makes the host not responsive (a timeout cut short by the
 *    window deadline does not; `timeout_ms` must equal min(full budget, time left to the window end)); more than S9_MAX_PROCESS_FAILURES process
 *    failures fail. A failed run's printed CPU % and available memory (`unverified_*`) are judged like any other measured value.
 */
function hostSamplingProblems(hs, cpuPct) {
  const bad = []
  const flag = (c) => { if (!bad.includes(c)) bad.push(c) }
  if (!isObj(hs) || hs.version !== S9_HOST_SAMPLING_VERSION || hs.slots !== S9_HOST_CPU_SLOTS || !Array.isArray(hs.attempts) || !Array.isArray(hs.window_ms) || hs.window_ms.length !== 2
    || !hs.window_ms.every(Number.isFinite) || !Number.isFinite(hs.burn_ms) || hs.max_attempts_per_slot !== S9_MAX_ATTEMPTS_PER_SLOT
    || !Number.isFinite(hs.burn_ended_offset_ms) || !Array.isArray(cpuPct) || cpuPct.length !== S9_HOST_CPU_SLOTS) return ['S9.HOST_CPU_SAMPLING_EVIDENCE_INVALID']
  const [lo, hi] = hs.window_ms
  const be = hs.burn_ended_offset_ms
  if (lo !== S9_BURN_WINDOW_MS[0] || hi !== S9_BURN_WINDOW_MS[1] || hs.burn_ms !== S9_BURN_MS) flag('S9.HOST_CPU_SAMPLING_WINDOW_INVALID')
  if (be < hi) flag('S9.HOST_CPU_SAMPLE_OUTSIDE_BURN_WINDOW') // the guest burn ended before the window closed
  const bySlot = Array.from({ length: S9_HOST_CPU_SLOTS }, () => [])
  const outside = (a) => a.start_offset_ms < lo || a.end_offset_ms > hi || a.end_offset_ms >= be
  let prev = null; let processFailures = 0
  const last = hs.attempts[hs.attempts.length - 1]
  for (const a of hs.attempts) {
    if (!isObj(a) || !Number.isInteger(a.slot) || a.slot < 0 || a.slot >= S9_HOST_CPU_SLOTS || !Number.isInteger(a.attempt) || !SAMPLING_OUTCOMES.includes(a.outcome)
      || !Number.isFinite(a.start_offset_ms) || a.start_offset_ms < 0 || !Number.isFinite(a.end_offset_ms) || a.end_offset_ms < a.start_offset_ms
      || !numOrNull(a.cpu_pct) || !numOrNull(a.available_mb) || !numOrNull(a.unverified_cpu_pct) || !numOrNull(a.unverified_available_mb) || !numOrNull(a.sampler_ms)
      || !(Number.isFinite(a.timeout_ms) && a.timeout_ms > 0) || (a.error !== null && typeof a.error !== 'string')) { flag('S9.HOST_CPU_SAMPLING_EVIDENCE_INVALID'); continue }
    // chronological, non-overlapping, slot by slot, numbered from 1 within a slot
    const first = prev === null
    if (first ? (a.slot !== 0 || a.attempt !== 1) : (a.start_offset_ms < prev.end_offset_ms || ![0, 1].includes(a.slot - prev.slot) || a.attempt !== (a.slot === prev.slot ? prev.attempt + 1 : 1))) flag('S9.HOST_CPU_SAMPLING_INCONSISTENT')
    prev = a
    bySlot[a.slot].push(a)
    // every measured value is judged, whatever became of the attempt
    for (const v of [a.cpu_pct, a.unverified_cpu_pct]) if (v !== null && (v < 0 || v > S9_MAX_HOST_CPU_PCT)) flag('S9.HOST_CPU_CONTENDED')
    for (const v of [a.available_mb, a.unverified_available_mb]) if (v !== null && v <= 1024) flag('S9.HOST_MEMORY_LOW')
    const processError = typeof a.error === 'string' && a.error.startsWith('SAMPLER.')
    if (processError) processFailures += 1
    // not responsive: the sampler could not start, flooded its output, or used its FULL time budget without finishing (a timeout that the
    // window deadline cut short says nothing about the host; that slot just stays unmeasured and fails as CONTENDED)
    if (a.error === 'SAMPLER.SPAWN_FAILED' || a.error === 'SAMPLER.OUTPUT_TOO_LARGE' || (a.error === 'SAMPLER.TIMEOUT' && a.timeout_ms >= S9_FULL_ATTEMPT_TIMEOUT_MS)) flag('S9.HOST_NOT_RESPONSIVE')
    // the timeout an attempt ran under is the full budget, or exactly the time left to the window end: nothing in between can be claimed
    if (a.timeout_ms !== Math.min(S9_FULL_ATTEMPT_TIMEOUT_MS, hi - a.start_offset_ms)) flag('S9.HOST_CPU_SAMPLING_INCONSISTENT')
    // `measured`: both counters were read by a run long enough to span the interval. `clean`: that, with no error recorded.
    const measured = a.cpu_pct !== null && a.cpu_pct >= 0 && a.available_mb !== null && a.sampler_ms !== null && a.sampler_ms >= S9_MIN_SAMPLER_MS
    const clean = a.error === null && measured
    if (a.outcome === 'accepted') {
      if (!clean || a.host_responsive !== true) flag(clean ? 'S9.HOST_NOT_RESPONSIVE' : 'S9.HOST_CPU_SAMPLING_INCONSISTENT')
      if (outside(a)) flag('S9.HOST_CPU_SAMPLE_OUTSIDE_BURN_WINDOW')
    } else if (a.outcome === 'rejected_unmeasured') {
      if (typeof a.error !== 'string' || a.error.length === 0 || measured) flag('S9.HOST_CPU_SAMPLING_INCONSISTENT') // a failure must say why and cannot hold a complete measurement
    } else if (!clean || !outside(a) || a !== last) flag('S9.HOST_CPU_SAMPLING_INCONSISTENT') // 'outside the window' must be true, and nothing can follow it
  }
  if (processFailures > S9_MAX_PROCESS_FAILURES) flag('S9.HOST_CPU_SAMPLING_PROCESS_FAILURES')
  bySlot.forEach((list, i) => {
    const acc = list.filter((a) => a.outcome === 'accepted')
    if (list.length > hs.max_attempts_per_slot || acc.length > 1 || (acc.length === 1 && list[list.length - 1] !== acc[0])) flag('S9.HOST_CPU_SAMPLING_INCONSISTENT')
    if (acc.length === 0) { if (cpuPct[i] !== null) flag('S9.HOST_CPU_SAMPLING_INCONSISTENT'); return } // an unmeasured slot stays null (judged as CONTENDED)
    if (acc[0].cpu_pct !== cpuPct[i]) flag('S9.HOST_CPU_SAMPLING_INCONSISTENT')
  })
  return bad
}

/**
 * Memory: the guest's over-allocation ends in its OOM killer (or MemoryError) INSIDE the guest: QEMU is still alive afterwards, under its Job
 * Object memory cap, and the host keeps memory and stays responsive. CPU: the Job Object hard cap is ENFORCED, shown with a cap that actually
 * binds. With 2 vCPUs on 20 logical CPUs the default 40 % cap can never bind (the VM can use at most 10 %), so a second boot runs under a cap
 * below the VM's demand. Two independent measurements must agree:
 *  (1) guest work per GUEST CPU-second of the burn workers themselves (a host-side cap deschedules the vCPU while the guest still charges that
 *      time to the running task, so this rate drops; guest-internal contention — timers catching up after a fresh boot — lowers iterations and
 *      the workers' CPU time together, so it cannot fake a drop);
 *  (2) the HOST-measured CPU share of the QEMU process inside the burn: at the cap when capped, clearly above it when not (the Job Object
 *      enforces on that same accounting, so if guest time were not charged to QEMU the cap could not bind either).
 * The host must have spare CPU at every sample during both burns, and Windows must read back the hard cap for both boots.
 */
export function evalS9(o) {
  const p = []
  if (!['oom_killed', 'MemoryError'].includes(o?.alloc?.outcome)) p.push('S9.MEMORY_NOT_BOUNDED')
  if (o?.qemuAliveAfterAlloc !== true) p.push('S9.QEMU_NOT_ALIVE_AFTER_ALLOC') // the guest, not the host, must have absorbed the over-allocation
  if (!Number.isFinite(o?.qemuWorkingSetMb) || !Number.isFinite(o?.memoryLimitMb) || o.qemuWorkingSetMb > o.memoryLimitMb) p.push('S9.QEMU_OVER_MEMORY_CAP')
  if (!Number.isFinite(o?.hostAvailableMbMin) || o.hostAvailableMbMin <= 1024) p.push('S9.HOST_MEMORY_LOW')
  if (!Array.isArray(o?.hostResponsive) || !o.hostResponsive.length || !o.hostResponsive.every((x) => x === true)) p.push('S9.HOST_NOT_RESPONSIVE')
  const c = o?.cpu ?? {}
  const ev = { logical_cpus: c.logicalCpus ?? null, vcpus: c.vcpus ?? null }
  if (!Number.isInteger(c.logicalCpus) || c.logicalCpus < 1 || !Number.isInteger(c.vcpus) || c.vcpus < 1 || !isObj(c.normal) || !isObj(c.capped)) {
    p.push('S9.CPU_EVIDENCE_MISSING')
  } else {
    const demand = (c.vcpus / c.logicalCpus) * 100
    ev.vm_cpu_demand_pct = Math.round(demand * 10) / 10
    ev.normal_cap_pct = c.normal.capPct; ev.binding_cap_pct = c.capped.capPct
    if (!Number.isFinite(c.capped.capPct) || c.capped.capPct > 0.6 * demand) p.push('S9.CPU_CAP_NOT_BINDING')
    if (!jobAttested(c.normal.job, c.normal.capPct) || !jobAttested(c.capped.job, c.capped.capPct)) p.push('S9.JOB_CPU_CAP_NOT_ATTESTED')
    const samples = [c.normal.hostCpuPct, c.capped.hostCpuPct]
    if (!samples.every((a) => Array.isArray(a) && a.length >= 3 && a.every((x) => Number.isFinite(x) && x >= 0 && x <= S9_MAX_HOST_CPU_PCT))) p.push('S9.HOST_CPU_CONTENDED')
    for (const b of [c.normal, c.capped]) for (const code of hostSamplingProblems(b.hostSampling, b.hostCpuPct)) if (!p.includes(code)) p.push(code)
    const qn = c.normal.qemuHostCpuPct; const qc = c.capped.qemuHostCpuPct
    if (!Number.isFinite(qn) || !Number.isFinite(qc) || !Number.isFinite(c.capped.capPct)) p.push('S9.QEMU_HOST_CPU_UNMEASURED')
    else {
      if (qc > c.capped.capPct * S9_QEMU_CAP_SLACK + 0.5) p.push('S9.QEMU_CPU_OVER_CAP')
      if (qn < c.capped.capPct * S9_QEMU_NORMAL_OVER_CAP) p.push('S9.QEMU_NORMAL_CPU_NOT_ABOVE_CAP') // the uncapped VM must demand more than the cap allows
    }
    if (!validBurn(c.normal.burn, c.vcpus) || !validBurn(c.capped.burn, c.vcpus)) p.push('S9.BURN_INVALID')
    else {
      if (c.normal.burn.busy_pct < 80 || c.capped.burn.busy_pct < 80) p.push('S9.BURN_NOT_CPU_BOUND')
      const rate = (b) => b.iterations / b.cpu_seconds
      const ratio = rate(c.capped.burn) / rate(c.normal.burn)
      const expected = c.capped.capPct / Math.min(demand, c.normal.capPct)
      ev.work_per_guest_cpu_second_ratio = Math.round(ratio * 1000) / 1000
      ev.wall_throughput_ratio_info = Math.round(((c.capped.burn.iterations / c.capped.burn.seconds) / (c.normal.burn.iterations / c.normal.burn.seconds)) * 1000) / 1000
      ev.expected_ratio_if_enforced = Math.round(expected * 1000) / 1000
      ev.max_accepted_ratio = Math.round(Math.min(0.8, expected + 0.25) * 1000) / 1000
      if (!(ratio <= Math.min(0.8, expected + 0.25))) p.push('S9.CPU_CAP_NOT_ENFORCED')
    }
    ev.max_host_cpu_pct_accepted = S9_MAX_HOST_CPU_PCT
    ev.normal = { burn: c.normal.burn ?? null, job: c.normal.job ?? null, host_cpu_pct_samples: c.normal.hostCpuPct ?? null, host_cpu_sampling: c.normal.hostSampling ?? null, qemu_host_cpu_pct: qn ?? null, qemu_window: c.normal.window ?? null }
    ev.capped = { burn: c.capped.burn ?? null, job: c.capped.job ?? null, host_cpu_pct_samples: c.capped.hostCpuPct ?? null, host_cpu_sampling: c.capped.hostSampling ?? null, qemu_host_cpu_pct: qc ?? null, qemu_window: c.capped.window ?? null, qemu_max_accepted_pct: Number.isFinite(c.capped.capPct) ? Math.round((c.capped.capPct * S9_QEMU_CAP_SLACK + 0.5) * 100) / 100 : null }
  }
  return result(p, { guest_alloc_exit: o?.alloc?.exitCode ?? null, guest_alloc_outcome: o?.alloc?.outcome ?? null, qemu_alive_after_alloc: o?.qemuAliveAfterAlloc ?? null,
    qemu_working_set_mb_after_alloc: o?.qemuWorkingSetMb ?? null, job_memory_limit_mb: o?.memoryLimitMb ?? null,
    host_available_mb_min: o?.hostAvailableMbMin ?? null, host_memory_sampled_at: 'after the guest allocation ended and during each CPU burn (not during the allocation itself)',
    host_responsive_samples: o?.hostResponsive ?? null, cpu: ev })
}

/**
 * VSOCK: the presence of /dev/vsock (a static device node Debian creates at boot) proves nothing either way. The state is decided from the
 * kernel's own answers: `absent` = the address family cannot even be created (no vsock core); `inert` = the core exists but no host transport
 * does (no transport module, local CID unassigned or loopback-only, every host-directed connect fails with ENODEV); anything that reaches,
 * resets, refuses, times out, sends, or reports a real CID is `active`; anything else is `unknown`. Only absent / inert can pass.
 */
export function classifyVsock(v, modules, rootOpen = null) {
  if (!isObj(v) || !isStrArr(modules)) return { state: 'unknown', reasons: ['VSOCK.MALFORMED'] }
  const transports = modules.filter((m) => VSOCK_TRANSPORT_MODULES.includes(m))
  const core = modules.filter((m) => VSOCK_CORE_MODULES.includes(m))
  if (v.stream_socket === 'EAFNOSUPPORT') {
    if (transports.length || core.length) return { state: 'unknown', reasons: ['VSOCK.MODULE_LOADED_WITHOUT_FAMILY', ...transports, ...core] }
    if (v.dev_node === true) {
      const n = v.node
      if (!isObj(n) || n.char !== true || n.registered !== false) return { state: 'unknown', reasons: [`VSOCK.DEVICE_NODE_${isObj(n) && n.registered === true ? 'REGISTERED' : 'UNVERIFIED'}`] }
      // The worker's own open is conclusive when the kernel answers (no driver). Debian's static node is root:0600, so the worker usually gets
      // EACCES instead; then root's open (collected host-side via ROOT_FACTS_CMD) must show the same "no driver" answer.
      const workerNoDriver = ['ENODEV', 'ENXIO'].includes(v.dev_open)
      const rootOnlyNode = v.dev_open === 'EACCES' && n.uid === 0 && (n.mode & 0o077) === 0
      if (!workerNoDriver && !(rootOnlyNode && ['ENODEV', 'ENXIO'].includes(rootOpen))) return { state: 'unknown', reasons: [`VSOCK.DEVICE_NODE_OPEN:${String(v.dev_open)}:root=${String(rootOpen)}`] }
    }
    return { state: 'absent', reasons: [] }
  }
  if (v.stream_socket !== 'created') return { state: 'unknown', reasons: [`VSOCK.SOCKET:${String(v.stream_socket).slice(0, 30)}`] }
  if (transports.length) return { state: 'active', reasons: transports.map((m) => `VSOCK.TRANSPORT_LOADED:${m}`) }
  const reasons = []; let active = false
  if (Number.isInteger(v.local_cid) && v.local_cid !== 0xffffffff && v.local_cid !== 1) { active = true; reasons.push(`VSOCK.LOCAL_CID:${v.local_cid}`) } else if (!Number.isInteger(v.local_cid)) reasons.push('VSOCK.LOCAL_CID_UNKNOWN')
  const want = ['0:1024', '2:22', '2:1024', '2:9999', '3:1024']
  if (!isObj(v.connect) || !sameSet(Object.keys(v.connect), want)) reasons.push('VSOCK.CONNECT_COVERAGE')
  else for (const [k, r] of Object.entries(v.connect)) if (r !== 'ENODEV') { if (['CONNECTED', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'timeout', 'EHOSTUNREACH'].includes(r)) active = true; reasons.push(`VSOCK.CONNECT:${k}:${r}`) }
  if (v.dgram !== 'ENODEV') { if (v.dgram === 'SENT') active = true; reasons.push(`VSOCK.DGRAM:${v.dgram}`) }
  return { state: active ? 'active' : reasons.length ? 'unknown' : 'inert', reasons }
}

/** ctx: { argvProblems: string[], hardened: {vsock:boolean}, root: parseRootFacts()|null } */
export function evalS10(P, ctx) {
  const { s, problem } = sectionOf(P, 's10', 'S10'); if (!s) return result([problem], {})
  const p = []
  for (const k of ['virtio_ports', 'usb_devices', 'virtio_devices', 'pci_devices', 'modules', 'agents']) if (!isStrArr(s[k])) return result([`S10.MALFORMED:${k}`], {})
  if (!Array.isArray(s.dev_channels) || !s.dev_channels.every((d) => isObj(d) && typeof d.name === 'string')) return result(['S10.MALFORMED:dev_channels'], {})
  if (!ctx?.hardened?.vsock) p.push('S10.IMAGE_NOT_HARDENED') // acceptance needs an image built with the guest hardening (15)
  if (s.virtio_ports.length) p.push('S10.VIRTIO_PORTS')
  if (s.usb_devices.length) p.push('S10.USB')
  if (s.agents.length) p.push('S10.GUEST_AGENTS')
  if (!Array.isArray(ctx?.argvProblems) || ctx.argvProblems.length) p.push('S10.QEMU_ARGV')
  // A static node (kmod creates them for kvm, vhost-net, vhost-vsock, vsock ... whether or not the driver ever loads) is not a channel; a node
  // the kernel has REGISTERED is. A node whose state cannot be established fails closed. /dev/vsock is decided by classifyVsock below.
  for (const d of s.dev_channels) if (d.name !== 'vsock' && !(d.char === true && d.registered === false)) p.push(`S10.HOST_CHANNEL_DEVICE:${d.name.slice(0, 20)}`)
  if (!(s.vmbus_devices === null || (Array.isArray(s.vmbus_devices) && s.vmbus_devices.length === 0))) p.push('S10.VMBUS_DEVICES')
  if (!s.virtio_devices.includes('0x1af4:0x0001') || !s.virtio_devices.includes('0x1af4:0x0002')) p.push('S10.VIRTIO_POSITIVE_CONTROL') // net + block must be visible
  for (const d of s.virtio_devices) if (!VIRTIO_ALLOWED.includes(d)) p.push(`S10.VIRTIO_DEVICE:${d}`)
  if (!s.pci_devices.length) p.push('S10.PCI_EMPTY')
  for (const d of s.pci_devices) if (!PCI_ALLOWED.includes(d)) p.push(`S10.PCI_DEVICE:${d}`)
  for (const m of s.modules) if (HOST_CHANNEL_MODULES.includes(m)) p.push(`S10.MODULE:${m}`)
  const root = ctx?.root ?? null
  const vs = classifyVsock(s.vsock, s.modules, root?.vsock_root_open ?? null)
  if (vs.state !== 'absent' && vs.state !== 'inert') p.push(`S10.VSOCK_${vs.state.toUpperCase()}`)
  if (ctx?.hardened?.vsock) {
    if (vs.state !== 'absent') p.push('S10.VSOCK_PRESENT_ON_HARDENED_IMAGE')
    if (!hardeningInEffect(root)) p.push('S10.HARDENING_NOT_IN_EFFECT')
  }
  const limitations = []
  if (!root) p.push('S10.ROOT_FACTS_MISSING')
  else {
    if (root.fw_cfg.state === 'error') p.push('S10.FW_CFG_UNKNOWN')
    // no qemu_fw_cfg driver: the entry list could not be read; the validated argv (no -fw_cfg) is then the only control, and that is recorded
    if (root.fw_cfg.state === 'no_driver') limitations.push('fw_cfg entries not inspected in the guest (no qemu_fw_cfg driver); the host-validated QEMU argv (no -fw_cfg) is the control')
    if (root.fw_cfg.names.some((n) => n.startsWith('opt/'))) p.push('S10.FW_CFG_USER_ENTRIES') // host-supplied data channels (e.g. io.systemd.credentials)
    if (root.dmi_type11 !== 0) p.push('S10.SMBIOS_OEM_STRINGS')
  }
  return result(p, { virtio_ports: s.virtio_ports, usb: s.usb_devices, agents: s.agents, qemu_arg_problems: ctx?.argvProblems ?? null, dev_channels: s.dev_channels, vmbus_devices: s.vmbus_devices,
    virtio_devices: s.virtio_devices, pci_devices: s.pci_devices, host_channel_modules_loaded: s.modules.filter((m) => HOST_CHANNEL_MODULES.includes(m) || VSOCK_CORE_MODULES.includes(m)),
    vsock_raw: s.vsock, vsock_root_open: root?.vsock_root_open ?? null, vsock_state: vs.state, vsock_reasons: vs.reasons, fw_cfg: root?.fw_cfg ?? null, smbios_type11_entries: root?.dmi_type11 ?? null,
    hardening_installs: root?.modprobe_false_installs ?? null }, { limitations })
}

/** o: { workerDateRc, guestShiftMs, hostDeltaMs } */
export function evalS11(P, o) {
  const { s, problem } = sectionOf(P, 's11', 'S11')
  const p = s ? [] : [problem]
  if (s && s.worker_date_s_rc !== 1) p.push('S11.WORKER_CLOCK_NOT_REFUSED') // `date -s` as non-root exits exactly 1 (EPERM)
  if (!Number.isFinite(o?.guestShiftMs) || o.guestShiftMs < 20 * 3600000) p.push('S11.GUEST_CLOCK_NOT_SHIFTED')
  if (!Number.isFinite(o?.hostDeltaMs) || o.hostDeltaMs >= 60000) p.push('S11.HOST_CLOCK_AFFECTED')
  return result(p, { worker_date_s_exit: s?.worker_date_s_rc ?? null, guest_clock_shift_h: Number.isFinite(o?.guestShiftMs) ? Math.round(o.guestShiftMs / 3600000) : null, host_clock_unaffected: Number.isFinite(o?.hostDeltaMs) && o.hostDeltaMs < 60000,
    note: 'policy pin / evidence / controller state live only on the host (unreachable per 1, 3, 4)' })
}

/** A guest's tree claim is accepted only if it equals the tree the HOST recomputed from the pulled bundle. */
export const verifyTreeClaim = (claim, hostTree) => typeof claim === 'string' && /^[0-9a-f]{40}$/.test(hostTree ?? '') && claim === hostTree

/** o: { imported: {ok, tree, code}, claimedTree, forgedTree, redirectCode } — host-side ARTIFACT INTEGRITY only (see evidence.scope). */
export function evalS12(o) {
  const p = []
  const hostTree = o?.imported?.ok ? o.imported.tree : null
  if (!o?.imported?.ok) p.push('S12.IMPORT_FAILED')
  if (!verifyTreeClaim(o?.claimedTree, hostTree)) p.push('S12.GENUINE_CLAIM_REJECTED')
  if (!/^[0-9a-f]{40}$/.test(o?.forgedTree ?? '') || verifyTreeClaim(o.forgedTree, hostTree)) p.push('S12.FORGED_CLAIM_NOT_REJECTED')
  if (o?.redirectCode !== 'BUNDLE.BAD_HEADER') p.push('S12.REDIRECT_NOT_REFUSED')
  return result(p, { import: o?.imported?.ok ? 'ok' : o?.imported?.code ?? null, host_recomputed_tree: hostTree, genuine_claim_accepted: verifyTreeClaim(o?.claimedTree, hostTree),
    forged_claim_rejected: /^[0-9a-f]{40}$/.test(o?.forgedTree ?? '') && !verifyTreeClaim(o.forgedTree, hostTree), gitdir_redirect_refused: o?.redirectCode ?? null,
    scope: 'host-side artifact integrity: import = verify + fsck fetch into a fresh bare repo (never clone); a guest tree claim is accepted only if it equals the HOST-recomputed tree',
    evaluator_evidence_binding: 'NOT_TESTED: binding evidence to the D3.2 evaluator (signed isolation_attestation / delivery evidence) needs D3.4 issuer services and keys, which do not exist yet' })
}

/**
 * What the worker plants before the overlay is discarded. "No residue afterwards" means something only if every item was REALLY planted first
 * (positive control): a failed plant would otherwise pass vacuously. The hard link to a root-owned file is not required: fs.protected_hardlinks
 * should refuse it, and whether it was refused is recorded.
 */
export const S13_PLANTED = Object.freeze(['task_residue', 'home_residue', 'settings', 'skills', 'fifo', 'claude_symlink', 'dh3new_symlink', 'dh3tmp_symlink', 'claude_json'])

/** o: { plantedOut, afterOut, bashrcBefore, bashrcAfter, goldenReadOnly } */
export function evalS13(o) {
  const out = String(o?.afterOut ?? '')
  const planted = String(o?.plantedOut ?? '')
  const p = []
  const plantedSet = new Set(planted.split('\n').filter((l) => l.startsWith('PLANTED:')).map((l) => l.slice(8).trim()))
  const missingPlants = S13_PLANTED.filter((k) => !plantedSet.has(k))
  if (!/^PLANT_CHECKED$/m.test(planted) || missingPlants.length) p.push('S13.PLANT_NOT_VERIFIED')
  if (!/^CHECKED$/m.test(out)) p.push('S13.CHECK_INCOMPLETE')
  const residue = out.split('\n').filter((l) => l.startsWith('PRESENT:'))
  if (residue.length) p.push('S13.RESIDUE')
  if (!/^MARKER$/m.test(out)) p.push('S13.SANITIZER_MARKER_MISSING')
  if (typeof o?.bashrcBefore !== 'string' || !/^[0-9a-f]{64}\n[0-9a-f]{64}$/.test(o.bashrcBefore.trim()) || o.bashrcBefore !== o?.bashrcAfter) p.push('S13.ROOT_TARGETS_CHANGED')
  // The planted .claude.json carried an allow-listed key (oauthAccount) and a forbidden one (projects): the first must survive, the second must not.
  const kept = out.includes('"oauthAccount"'); const dropped = !out.includes('"projects"')
  if (!kept || !dropped) p.push('S13.JSON_ALLOWLIST_NOT_APPLIED')
  if (o?.goldenReadOnly !== true) p.push('S13.GOLDEN_WRITABLE')
  return result(p, { planted_before_discard: [...plantedSet].sort(), plants_missing: missingPlants, hardlink_to_root_file: /^HARDLINK_REFUSED$/m.test(planted) ? 'refused' : /^PLANT_CHECKED$/m.test(planted) ? 'created' : null,
    residue_found: residue, sanitizer_marker: /^MARKER$/m.test(out), root_targets_unchanged: o?.bashrcBefore === o?.bashrcAfter, allowlisted_json_key_kept: kept, non_allowlisted_json_keys_dropped: dropped, golden_read_only: o?.goldenReadOnly ?? null })
}

/**
 * Whether a recorded acceptance PASS still describes the CURRENT system: same probe version, same golden image as the current provisioning
 * record, and the same trusted code (closure digest) as now. A PASS from older code or an older image is `STALE`, never green.
 * doc: the latest acceptance document; prov: readProvisioned(); closureDigestNow: closureIdentity().digest.
 */
export function acceptanceStatus(doc, prov, closureDigestNow) {
  if (!isObj(doc)) return { current: false, status: 'NOT_RUN', reasons: [] }
  if (!isAcceptanceRecord(doc)) return { current: false, status: 'INVALID', reasons: ['RECORD_SHAPE'] }
  if (doc.verdict !== 'PASS') return { current: false, status: doc.verdict, reasons: [] }
  // A PASS label must agree with its own scenarios: all 13 present and PASS.
  if (overallVerdict(doc.scenarios) !== 'PASS') return { current: false, status: 'INVALID', reasons: ['SCENARIO_VERDICTS_INCONSISTENT'] }
  const reasons = []
  if (doc.probe_version !== PROBE_VERSION) reasons.push('PROBE_VERSION')
  const HEX64 = /^[0-9a-f]{64}$/
  if (!isObj(prov) || typeof prov.golden_sha256 !== 'string' || !HEX64.test(prov.golden_sha256) || doc.identity?.vm_image?.golden_sha256_now !== prov.golden_sha256) reasons.push('GOLDEN_IMAGE_CHANGED')
  if (typeof closureDigestNow !== 'string' || !HEX64.test(closureDigestNow) || doc.identity?.candidate?.closure?.digest !== closureDigestNow) reasons.push('TRUSTED_CODE_CHANGED')
  return reasons.length ? { current: false, status: 'STALE', reasons } : { current: true, status: 'PASS', reasons }
}

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/
/**
 * Exact shape of a persisted acceptance record, for `readJsonState` (which accepts only a boolean `true`). Validates the fields every reader
 * relies on; `acceptanceStatus` then decides currency. Returns a boolean, never a truthy non-boolean.
 */
export function isAcceptanceRecord(v) {
  return isObj(v) && v.schema === ACCEPTANCE_SCHEMA && typeof v.started_at === 'string' && ISO_TS.test(v.started_at)
    && Number.isInteger(v.probe_version) && typeof v.verdict === 'string' && /^[A-Z_]{1,32}$/.test(v.verdict) && isObj(v.scenarios)
}

/** `NOT_RUN` reason for a refused admission. Resource Governor codes already carry the `RESOURCE.` prefix; it is never doubled. */
export function admissionRefusalReason(codes) {
  const list = (Array.isArray(codes) ? codes : []).filter((c) => typeof c === 'string' && c.length > 0)
  return list.length ? list.map((c) => (c.startsWith('RESOURCE.') ? c : `RESOURCE.${c}`)).join(',') : 'RESOURCE.ADMISSION_REFUSED'
}

/** Overall verdict: PASS only when all 13 scenarios PASS; any FAIL → FAIL; otherwise INCOMPLETE. */
export function overallVerdict(S) {
  const v = Array.from({ length: 13 }, (_, i) => S?.[i + 1]?.verdict)
  return v.every((x) => x === 'PASS') ? 'PASS' : v.some((x) => x === 'FAIL') ? 'FAIL' : 'INCOMPLETE'
}
