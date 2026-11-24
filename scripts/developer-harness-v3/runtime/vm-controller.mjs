// Developer Harness V3 (D3.3) — worker VM controller (Windows host, trusted Z2 side).
//
// Starts QEMU only through the Job Object supervisor, talks to the guest only over SSH that the CONTROLLER initiates (host loopback → guest :22),
// and carries all guest egress over one SSH remote forward to the allow-list proxy. SSH is pinned to a host key generated on the host, with no
// config file, no agent, no X11, no local forwards, no ControlMaster and a minimal environment, so a hostile guest cannot reach back into the host.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJsonState } from '../lib/atomic.mjs'
import { buildQemuArgs, quoteWindowsArg } from './qemu-args.mjs'
import { validVmRecord } from './worker-lifecycle.mjs'

const INFRA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'infra')
const SYS = process.env.SYSTEMROOT ?? 'C:\\Windows'
// Absolute path: the minimal child PATH below deliberately excludes the owner's PATH, so nothing is resolved from it.
export const POWERSHELL = `${SYS}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
// Minimal HOST-side child environment (controller tools only, never the worker): Windows OpenSSH refuses to run without the profile-location
// variables, which are paths, not secrets. Everything else from the owner's environment (tokens, CLAUDE_*, proxies) is excluded.
// SYSTEMDRIVE is required too: without it Windows components expand "%SystemDrive%" relative to the working directory (observed: a stray
// "%SystemDrive%\ProgramData\...\Caches" tree appeared in the checkout).
export const HOST_TOOL_ENV_NAMES = Object.freeze(['SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA', 'LOCALAPPDATA', 'APPDATA'])
export const sysEnv = () => ({ ...Object.fromEntries(HOST_TOOL_ENV_NAMES.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), SYSTEMROOT: SYS, PATH: `${SYS}\\System32;${SYS}\\System32\\OpenSSH` })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function run(cmd, args, { input = null, timeoutMs = 120000, env = sysEnv(), maxBuffer = 32 * 1024 * 1024 } = {}) {
  const r = spawnSync(cmd, args, { input, encoding: input && Buffer.isBuffer(input) ? undefined : 'utf8', timeout: timeoutMs, env, windowsHide: true, maxBuffer })
  return { code: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? ''), error: r.error?.code ?? null }
}

export function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
}

/** Controller key + guest host key, generated on the host. The guest never generates its own host key (no trust on first use). */
export function ensureKeys(W, name) {
  mkdirSync(path.dirname(W.sshKey), { recursive: true }); mkdirSync(W.hostKeyDir, { recursive: true })
  const hostKey = path.join(W.hostKeyDir, 'ssh_host_ed25519_key')
  for (const [f, c] of [[W.sshKey, 'dh3-controller'], [hostKey, 'dh3-guest-host']]) {
    if (existsSync(f)) continue
    const r = run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', c, '-f', f])
    if (r.code !== 0) throw new Error('VM.KEYGEN_FAILED')
  }
  const hostPub = readFileSync(`${hostKey}.pub`, 'utf8').trim()
  writeFileSync(W.knownHosts, `${name} ${hostPub.split(' ').slice(0, 2).join(' ')}\n`)
  return { controllerPublicKey: readFileSync(`${W.sshKey}.pub`, 'utf8').trim(), hostKeyPrivate: readFileSync(hostKey, 'utf8'), hostKeyPublic: hostPub }
}

export function buildSeedIso(W, { userData, metaData }) {
  rmSync(W.seedDir, { recursive: true, force: true }); mkdirSync(W.seedDir, { recursive: true })
  writeFileSync(path.join(W.seedDir, 'user-data'), userData.replace(/\r\n/g, '\n'))
  writeFileSync(path.join(W.seedDir, 'meta-data'), metaData)
  const r = run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(INFRA, 'seed-iso.ps1'), '-SourceDir', W.seedDir, '-OutFile', W.seed])
  if (r.code !== 0 || !/SEED_ISO_OK/.test(r.out)) throw new Error(`VM.SEED_ISO_FAILED:${(r.err || r.out).slice(0, 200)}`)
}

export function qemuImg(L, args) { const r = run(L.qemuImg, args, { timeoutMs: 600000, env: { ...sysEnv(), PATH: `${path.dirname(L.qemuImg)};${SYS}\\System32` } }); if (r.code !== 0) throw new Error(`VM.QEMU_IMG_FAILED:${r.err.slice(0, 200)}`); return r.out }

/** Overlay disk on a read-only backing file. The backing chain is the reset mechanism: discard the overlay → pristine golden state. */
export function createOverlay(L, file, backing, sizeGb) {
  rmSync(file, { force: true })
  qemuImg(L, ['create', '-q', '-f', 'qcow2', '-o', 'lazy_refcounts=on', '-b', backing, '-F', 'qcow2', file, `${sizeGb}G`])
}

export function sshArgs(W, cfg, { user = 'ctl', extra = [] } = {}) {
  // ssh splits UserKnownHostsFile on whitespace (it accepts a list); a path with spaces would silently point elsewhere.
  if (/\s/.test(W.knownHosts) || /\s/.test(W.sshKey)) throw new Error('VM.PATH_WITH_WHITESPACE_UNSUPPORTED')
  return ['-F', 'none', '-i', W.sshKey, '-p', String(cfg.ssh_port), '-o', 'IdentitiesOnly=yes', '-o', `HostKeyAlias=${cfg.name}`, '-o', `UserKnownHostsFile=${W.knownHosts}`, '-o', `GlobalKnownHostsFile=${W.knownHosts}`,
    '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'CheckHostIP=no', '-o', 'BatchMode=yes', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'PermitLocalCommand=no',
    '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
    '-o', 'LogLevel=ERROR', '-o', 'AddKeysToAgent=no', '-o', 'IdentityAgent=none', '-o', 'SendEnv=-*', '-o', 'Tunnel=no', ...extra, `${user}@127.0.0.1`]
}

/** Run a command in the guest. Output is untrusted data: capped, never executed, never interpreted as authority. */
export function sshExec(W, cfg, command, { input = null, timeoutMs = 120000 } = {}) {
  return run('ssh', [...sshArgs(W, cfg, { extra: ['-T'] }), command], { input, timeoutMs })
}

export async function waitForSsh(W, cfg, { timeoutMs = 900000, log = () => {} } = {}) {
  const until = Date.now() + timeoutMs; let n = 0
  while (Date.now() < until) {
    const r = sshExec(W, cfg, 'true', { timeoutMs: 30000 })
    if (r.code === 0) return true
    n += 1; if (n % 6 === 0) log(`waiting for guest SSH (${Math.round((until - Date.now()) / 1000)}s left)`)
    await sleep(5000)
  }
  return false
}

/** The ONLY guest egress path: a controller-held SSH remote forward from guest 127.0.0.1:3128 to the host proxy. Closing it cuts egress. */
export function openEgressChannel(W, cfg, proxyPort) {
  const child = spawn('ssh', [...sshArgs(W, cfg, { extra: ['-N', '-T', '-o', 'ExitOnForwardFailure=yes', '-R', `127.0.0.1:3128:127.0.0.1:${proxyPort}`] })], { env: sysEnv(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  return child
}

/** Controller-initiated graceful shutdown over SSH (there is no QMP channel). The guest may ignore it; stopVm then falls back to the verified kill. */
export function requestGuestPoweroff(W, cfg) { try { return sshExec(W, cfg, 'sudo -n systemctl poweroff --no-block', { timeoutMs: 30000 }).code === 0 } catch { return false } }

/**
 * Pure identity check of the recorded pids against host process facts ({pid, name, created_ms, cmdline}). A pid counts as OUR supervisor only if it
 * is powershell.exe AND its command line carries the record's unique marker; as OUR QEMU only if it is qemu-system-x86_64.exe, was created within
 * 10 s of the recorded start and carries `-name <vm>`. A reused pid is reported as `false` (not ours) with `reused: true`. null = unknown.
 */
export function identifyProcesses(record, procs, { vmName = null } = {}) {
  if (!Array.isArray(procs)) return { supervisor: null, qemu: null, qemuImage: null, reused: false }
  const by = new Map(procs.map((p) => [p.pid, p]))
  const s = by.get(record.supervisor_pid); const q = by.get(record.qemu_pid)
  const supOk = !!s && /^powershell\.exe$/i.test(s.name ?? '') && typeof s.cmdline === 'string' && s.cmdline.includes(record.marker)
  const started = Date.parse(record.qemu_start)
  const qOk = !!q && /^qemu-system-x86_64\.exe$/i.test(q.name ?? '') && Number.isFinite(started) && Math.abs((q.created_ms ?? NaN) - started) <= 10000 && (!vmName || (q.cmdline ?? '').includes(`-name ${vmName}`))
  return { supervisor: supOk, qemu: qOk, qemuImage: q?.name ?? null, reused: (!!s && !supOk) || (!!q && !qOk) }
}

/** Host process facts for the recorded pids (CIM; read-only). */
function processFacts(pids) {
  const ids = pids.filter((p) => Number.isInteger(p) && p > 0)
  if (!ids.length) return []
  const r = run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter "${ids.map((p) => `ProcessId=${p}`).join(' OR ')}" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; name = $_.Name; created_ms = [int64](([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()); cmdline = $_.CommandLine } }) | ConvertTo-Json -Compress -Depth 2`], { timeoutMs: 60000 })
  if (r.code !== 0) return null
  try { const j = JSON.parse(r.out.trim() || '[]'); return Array.isArray(j) ? j : [j] } catch { return null }
}

/** Host-side liveness of the recorded pids. An `exited` record is final (no pid is trusted after that). */
export function liveness(record) {
  if (record?.state === 'exited') return { supervisor: false, qemu: false, qemuImage: null, reused: false, final: true }
  return identifyProcesses(record, processFacts([record.supervisor_pid, record.qemu_pid]), { vmName: (/^dh3:([^:]+):/.exec(record.marker ?? '') ?? [])[1] ?? null })
}

/** Kill every process of the guest `worker` user (all task-owned: the VM is the task's) and verify none is left. */
export function killWorkerProcesses(W, cfg) {
  sshExec(W, cfg, 'sudo -n pkill -KILL -u worker; sleep 1; sudo -n pkill -KILL -u worker; true', { timeoutMs: 60000 })
  const r = sshExec(W, cfg, 'pgrep -u worker >/dev/null && echo ALIVE || echo NONE', { timeoutMs: 60000 })
  return r.code === 0 && /^NONE/m.test(r.out)
}

export function readVmRecord(W) { const r = readJsonState(W.record, validVmRecord); return r.ok ? r.value : null }

/**
 * Start the VM under the supervisor. Returns the runtime config {name, ssh_port, ram_mb, ...}. The supervisor is detached: it outlives a
 * controller restart, and Windows kills QEMU if the supervisor ever dies (KILL_ON_JOB_CLOSE).
 */
export async function startVm(L, W, { name, ramMb, cpus, accel, withSeed = false, cpuRatePercent = 40 }) {
  const existing = readVmRecord(W)
  if (existing && existing.state === 'running') { const lv = liveness(existing); if (lv.supervisor !== false || lv.qemu !== false) throw new Error('VM.ALREADY_RUNNING_OR_UNKNOWN') }
  const cfg = { name, ssh_port: await freePort(), ram_mb: ramMb, cpus, accel, with_seed: withSeed }
  const args = buildQemuArgs({ name, ramMb, cpus, accel, taskDisk: W.task, authDisk: W.auth, seedIso: withSeed ? W.seed : null, sshPort: cfg.ssh_port })
  const cmdFile = path.join(W.dir, 'qemu-cmdline.txt')
  writeFileSync(cmdFile, args.map(quoteWindowsArg).join(' '))
  rmSync(W.record, { force: true })
  const memLimit = ramMb + (accel === 'tcg' ? 640 : 512) // hard cap slightly above the governor's expected overhead (512 TCG / 384 WHPX)
  const marker = `dh3:${name}:${Date.now()}`
  // PowerShell started with DETACHED_PROCESS (Node `detached`) has no console and exits silently, so the supervisor is started by Start-Process
  // (hidden, independent of this controller). Arguments are quoted with CommandLineToArgvW rules; single quotes are doubled for the -Command string.
  const supArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(INFRA, 'job-supervisor.ps1'), '-Qemu', L.qemu, '-CommandLineFile', cmdFile,
    '-MemoryLimitMB', String(memLimit), '-CpuRatePercent', String(cpuRatePercent), '-RecordFile', W.record, '-Marker', marker].map(quoteWindowsArg).join(' ')
  const launch = run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -WindowStyle Hidden -FilePath '${POWERSHELL}' -ArgumentList '${supArgs.replace(/'/g, "''")}'`], { timeoutMs: 60000 })
  if (launch.code !== 0) throw new Error(`VM.SUPERVISOR_LAUNCH_FAILED:${launch.err.slice(0, 200)}`)
  for (let i = 0; i < 120; i += 1) { const rec = readVmRecord(W); if (rec?.marker === marker) { writeFileSync(path.join(W.dir, 'vm-config.json'), JSON.stringify({ ...cfg, marker, memory_limit_mb: memLimit, cpu_rate_percent: cpuRatePercent })); return { ...cfg, marker, memory_limit_mb: memLimit } } await sleep(500) }
  throw new Error('VM.SUPERVISOR_DID_NOT_START')
}

export const readVmConfig = (W) => { try { return JSON.parse(readFileSync(path.join(W.dir, 'vm-config.json'), 'utf8')) } catch { return null } }

/** Graceful guest poweroff (SSH) → verified supervisor kill (job closes, Windows kills QEMU). Returns verified termination facts. */
export async function stopVm(W, cfg, { graceMs = 90000, log = () => {} } = {}) {
  const first = readVmRecord(W)
  if (!first) return { stopped: true, method: 'not_running' }
  if (first.state === 'exited') return { stopped: true, method: 'already_exited' } // final: never act on pids from an exited record
  // Re-read the record each time: the supervisor marks it `exited` the moment QEMU exits, after which no recorded pid is trusted.
  const gone = () => { const rec = readVmRecord(W); if (!rec || rec.state === 'exited') return true; const lv = liveness(rec); return lv.qemu === false && lv.supervisor === false }
  if (gone()) return { stopped: true, method: 'already_exited' }
  requestGuestPoweroff(W, cfg)
  for (let t = 0; t < graceMs; t += 2000) { if (gone()) return { stopped: true, method: 'guest_poweroff' }; await sleep(2000) }
  // Kill ONLY a supervisor whose identity (powershell.exe + our unique marker in its command line) is verified right now. Never a bare pid.
  const rec = readVmRecord(W)
  const lv = rec && rec.state !== 'exited' ? liveness(rec) : null
  if (!lv || lv.supervisor !== true) { log('supervisor identity not verified; refusing to kill any process'); return { stopped: false, method: 'termination_unverified_identity' } }
  log('graceful shutdown timed out; terminating the verified task-owned supervisor (job close kills QEMU)')
  run('taskkill', ['/PID', String(rec.supervisor_pid), '/F'])
  for (let t = 0; t < 15000; t += 1000) { if (gone()) return { stopped: true, method: 'supervisor_killed' }; await sleep(1000) }
  return { stopped: false, method: 'termination_unverified' }
}