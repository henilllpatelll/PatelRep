// Developer Harness V3 (D3.3) — reproducible worker provisioning and task-worker start/reset.
//
// provision: golden.qcow2 (overlay on the pinned Debian image) + auth.qcow2 (persistent sanitized worker home) are created, the VM boots ONCE
// with the cloud-init seed, the controller installs git/ripgrep through the allow-list proxy (provisioning profile) and the pinned Claude binary
// (streamed from the host, sha512-checked in the guest), records the binary facts, shuts down, and marks golden read-only.
// startTask: a fresh task.qcow2 overlay on the read-only golden → clean state for every task; the seed is never attached again.
import { createHash } from 'node:crypto'
import { chmodSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { atomicWriteJson, readJsonState } from '../lib/atomic.mjs'
import { startEgressProxy } from '../runtime/egress-proxy.mjs'
import { buildMetaData, buildProvisionScript, buildUserData, SANITIZED_MARKER } from './cloud-init.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { run } from '../runtime/vm-controller.mjs'

/**
 * Security review S10: the binary pin is computed on the HOST from the npm-integrity-verified package (Windows' built-in tar), never taken from
 * the guest's report. The guest's own sha512 must then equal it.
 */
export async function hostBinarySha512(L) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dh3-claude-'))
  try {
    const r = run(`${process.env.SYSTEMROOT}\\System32\\tar.exe`, ['-xzf', L.claudePackage, '-C', tmp, 'package/claude'], { timeoutMs: 600000 })
    if (r.code !== 0) throw new Error('PROVISION.HOST_EXTRACT_FAILED')
    const { createHash } = await import('node:crypto')
    return await new Promise((resolve, reject) => { const h = createHash('sha512'); createReadStream(path.join(tmp, 'package', 'claude')).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex'))) })
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}
import { loadArtifacts, parseDigest } from './setup.mjs'
import { buildSeedIso, createOverlay, ensureKeys, openEgressChannel, qemuImg, sshArgs, sshExec, startVm, stopVm, sysEnv, waitForSsh } from '../runtime/vm-controller.mjs'

export const PROVISIONED = 'provisioned.json'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function readProvisioned(W) {
  const r = readJsonState(path.join(W.dir, PROVISIONED), (v) => v && v.schema === 'patelrep.developer-harness-v3.worker-provisioned' && /^[0-9a-f]{128}$/.test(v.claude_sha512))
  return r.ok ? r.value : null
}

/** Stream a host file into the guest over the controller's SSH channel (host → guest only). */
function pushFile(W, cfg, src, dest, { timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...sshArgs(W, cfg, { extra: ['-T'] }), `cat > ${dest}`], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], env: sysEnv() })
    const t = setTimeout(() => child.kill(), timeoutMs)
    createReadStream(src).pipe(child.stdin)
    child.on('close', (code) => { clearTimeout(t); resolve(code === 0) })
  })
}

export async function provision(L, { id = 'w1', ramMb, cpus = 2, accel = 'tcg', log = console.log, dryRun = false } = {}) {
  const W = L.worker(id); const name = `dh3-${id}`
  const A = loadArtifacts().artifacts
  const claudeHex = parseDigest(A.claude_linux_x64).hex
  if (dryRun) { log(`[dry-run] provision ${name}: golden overlay on ${L.baseImage}, auth disk 512M, seed ISO, ${ramMb} MB / ${cpus} vCPU / ${accel}; install git+ripgrep via proxy profile 'provisioning'; install Claude ${A.claude_linux_x64.version} (sha512 pinned)`); return { ok: true, dryRun: true } }
  if (!existsSync(L.qemu) || !existsSync(L.baseImage) || !existsSync(L.claudePackage)) throw new Error('PROVISION.SETUP_INCOMPLETE')
  mkdirSync(W.dir, { recursive: true })
  const keys = ensureKeys(W, name)
  buildSeedIso(W, { userData: buildUserData({ name, ...keys }), metaData: buildMetaData({ name, instanceId: `${name}-${Date.now()}` }) })
  if (existsSync(W.golden)) chmodSync(W.golden, 0o644)
  createOverlay(L, W.golden, L.baseImage, 24)
  if (!existsSync(W.auth)) qemuImg(L, ['create', '-q', '-f', 'qcow2', W.auth, '512M'])
  // During provisioning the boot disk IS golden (so the installed state persists into it); afterwards golden is read-only.
  const Wp = { ...W, task: W.golden }
  const t0 = Date.now()
  const cfg = await startVm(L, Wp, { name, ramMb, cpus, accel, withSeed: true })
  log(`VM started (${accel}, ${ramMb} MB, ${cpus} vCPU); waiting for SSH`)
  let proxy = null; let egress = null
  const decisions = []
  try {
    if (!await waitForSsh(W, cfg, { log })) throw new Error('PROVISION.SSH_TIMEOUT')
    log(`SSH up after ${Math.round((Date.now() - t0) / 1000)} s; waiting for cloud-init`)
    const ci = sshExec(W, cfg, 'sudo cloud-init status --wait >/dev/null 2>&1; test -f /var/lib/dh3-cloud-init-done && echo CI_DONE', { timeoutMs: 1200000 })
    if (!/CI_DONE/.test(ci.out)) throw new Error('PROVISION.CLOUD_INIT_FAILED')
    proxy = await startEgressProxy({ profile: 'provisioning', onDecision: (d) => decisions.push({ allow: d.allow, code: d.code, host: d.host ?? null }) })
    egress = openEgressChannel(W, cfg, proxy.port)
    await sleep(3000)
    log(`pushing pinned Claude package (${Math.round(statSync(L.claudePackage).size / 1048576)} MB) into the guest`)
    if (!await pushFile(W, cfg, L.claudePackage, '/tmp/dh3-claude.tgz', { timeoutMs: 1800000 })) throw new Error('PROVISION.PUSH_FAILED')
    // The guest re-verifies the pushed TGZ against the npm-pinned sha512 before installing anything from it.
    const pr = sshExec(W, cfg, 'sudo bash -s', { input: buildProvisionScript({ claudeSha512Hex: claudeHex, claudeVersion: A.claude_linux_x64.version }), timeoutMs: 3600000 })
    if (!/DH3_PROVISION_OK/.test(pr.out)) throw new Error(`PROVISION.SCRIPT_FAILED:${(pr.err || pr.out).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`)
    const facts = sshExec(W, cfg, 'cat /var/lib/dh3-claude.sha512 /var/lib/dh3-claude.version; stat -c "%U:%G %A" /opt/patelrep-claude/bin/claude; readlink -f /usr/local/bin/claude', { timeoutMs: 600000 }).out.trim().split(/\r?\n/)
    const [sha512, versionLine, ownerMode, resolved] = facts
    const version = (/^([0-9]+\.[0-9]+\.[0-9]+)/.exec(versionLine ?? '') ?? [])[1] ?? null
    if (!/^[0-9a-f]{128}$/.test(sha512 ?? '')) throw new Error('PROVISION.BINARY_FACTS_MISSING')
    const hostSha = await hostBinarySha512(L)
    if (sha512 !== hostSha) throw new Error('PROVISION.GUEST_BINARY_DIGEST_MISMATCH')
    log(`Claude in guest: version ${version ?? 'UNREPORTED'}; ${ownerMode}; ${resolved}`)
    sshExec(W, cfg, 'sudo sync', { timeoutMs: 120000 })
    egress.kill(); egress = null; await proxy.close(); proxy = null
    const stop = await stopVm(Wp, cfg, { log })
    if (!stop.stopped) throw new Error('PROVISION.SHUTDOWN_UNVERIFIED')
    chmodSync(W.golden, 0o444)
    const goldenSha = await streamSha256(W.golden) // streamed: the golden image can exceed the 2 GiB readFileSync limit
    const rec = { schema: 'patelrep.developer-harness-v3.worker-provisioned', name, provisioned_at: new Date().toISOString(), accel, ram_mb: ramMb, cpus, claude_version: version, claude_sha512: sha512,
      claude_owner_mode: ownerMode, claude_sha512_basis: 'host-computed from the npm-integrity-verified package; guest report matched', golden_sha256: goldenSha, base_image_sha512: A.debian_image.sha512, provisioning_egress: summarize(decisions), duration_s: Math.round((Date.now() - t0) / 1000) }
    atomicWriteJson(path.join(W.dir, PROVISIONED), rec)
    return { ok: true, ...rec }
  } catch (e) {
    log(`provisioning egress decisions: ${JSON.stringify(summarize(decisions))}`)
    try { egress?.kill() } catch { /* ignore */ }
    try { await proxy?.close() } catch { /* ignore */ }
    await stopVm(Wp, cfg, { log, graceMs: 30000 })
    throw e
  }
}

export function streamSha256(file) {
  return new Promise((resolve, reject) => { const h = createHash('sha256'); createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex'))) })
}

export function summarize(decisions) {
  const m = new Map()
  for (const d of decisions) { const k = `${d.allow ? 'allow' : 'deny'}:${d.host ?? '-'}:${d.code}`; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].map(([k, n]) => ({ decision: k, count: n }))
}

/** Fresh task overlay on the read-only golden image, then boot (no seed). */
export async function startTaskWorker(L, { id = 'w1', ramMb, cpus = 2, accel = 'tcg', log = console.log }) {
  const W = L.worker(id)
  const p = readProvisioned(W)
  if (!p) throw new Error('WORKER.NOT_PROVISIONED')
  createOverlay(L, W.task, W.golden, 24)
  const cfg = await startVm(L, W, { name: p.name, ramMb, cpus, accel, withSeed: false })
  if (!await waitForSsh(W, cfg, { log })) { await stopVm(W, cfg, { log, graceMs: 20000 }); throw new Error('WORKER.SSH_TIMEOUT') }
  // sshd already REQUIRES the sanitizer; the explicit marker check makes a silently skipped sanitizer fail closed too.
  if (!/^MARK_OK$/m.test(sshExec(W, cfg, `test -f ${SANITIZED_MARKER} && echo MARK_OK`, { timeoutMs: 120000 }).out)) { await stopVm(W, cfg, { log, graceMs: 20000 }); throw new Error('WORKER.HOME_NOT_SANITIZED') }
  return { W, cfg, provisioned: p }
}

export function writeJson(file, v) { writeFileSync(file, JSON.stringify(v, null, 2)) }
