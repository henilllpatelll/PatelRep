// Developer Harness V3 (D3.3) — idempotent, user-scope installation of the free VM runtime and the pinned worker artifacts.
//
// Requires NO administrator rights and installs NO driver, service, network adapter or host-wide setting: QEMU comes from the official
// MSYS2 package repository into a private directory, the base disk and the Claude Linux binary are fetched by the HOST and verified against
// the pins in artifacts.json. Enabling the Windows Hypervisor Platform accelerator (admin + reboot) is an owner-only action this script only
// REPORTS. --dry-run performs no network access and no writes. --rollback removes exactly the paths recorded in the manifest, all inside the root.
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteJson, readJsonState } from '../lib/atomic.mjs'
import { isInside, layout } from './layout.mjs'

export const ARTIFACTS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts.json')
export const loadArtifacts = (file = ARTIFACTS_PATH) => JSON.parse(readFileSync(file, 'utf8'))

/** SRI string (sha512-<base64>) or a hex digest → {alg, hex}. */
export function parseDigest(a) {
  if (typeof a.integrity === 'string') {
    const m = /^(sha256|sha512)-([A-Za-z0-9+/=]+)$/.exec(a.integrity)
    if (!m) throw new Error('ARTIFACT.BAD_INTEGRITY')
    return { alg: m[1], hex: Buffer.from(m[2], 'base64').toString('hex') }
  }
  if (typeof a.sha512 === 'string' && /^[0-9a-f]{128}$/.test(a.sha512)) return { alg: 'sha512', hex: a.sha512 }
  if (typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/.test(a.sha256)) return { alg: 'sha256', hex: a.sha256 }
  return null
}

export function fileDigest(file, alg) {
  const h = createHash(alg); h.update(readFileSync(file)); return h.digest('hex')
}

/** Streaming download with a hard byte cap and an on-the-fly digest; the file only appears at `dest` after the digest matched. */
export async function fetchVerified(url, dest, { alg, hex, maxBytes, fetchImpl = fetch }) {
  if (!/^https:\/\//.test(url)) throw new Error('ARTIFACT.URL_NOT_HTTPS')
  if (existsSync(dest) && hex && fileDigest(dest, alg) === hex) return { fetched: false }
  mkdirSync(path.dirname(dest), { recursive: true })
  // Redirects are followed manually so an https→http downgrade is refused BEFORE any request is sent to the downgraded URL. Bounded time.
  let res; let cur = url
  for (let hop = 0; ; hop += 1) {
    res = await fetchImpl(cur, { redirect: 'manual', signal: AbortSignal.timeout(30 * 60000) })
    if (res.status < 300 || res.status >= 400) break
    const loc = res.headers?.get?.('location')
    if (!loc || hop >= 5) throw new Error('ARTIFACT.REDIRECT_INVALID')
    cur = new URL(loc, cur).toString()
    if (!/^https:\/\//.test(cur)) throw new Error('ARTIFACT.REDIRECT_NOT_HTTPS')
  }
  if (!res.ok || !res.body) throw new Error(`ARTIFACT.HTTP_${res.status}`)
  const tmp = `${dest}.partial`
  const h = createHash(alg ?? 'sha256'); let n = 0
  // Synchronous fd: on any failure the partial file is closed and removed deterministically (a lazily-opened stream could recreate it).
  const fd = openSync(tmp, 'w')
  try {
    for await (const chunk of res.body) {
      n += chunk.length
      if (n > maxBytes) throw new Error('ARTIFACT.TOO_LARGE')
      h.update(chunk)
      writeSync(fd, chunk)
    }
    fsyncSync(fd); closeSync(fd)
  } catch (e) { try { closeSync(fd) } catch { /* already closed */ } rmSync(tmp, { force: true }); throw e }
  const got = h.digest('hex')
  if (hex && got !== hex) { rmSync(tmp, { force: true }); throw new Error('ARTIFACT.DIGEST_MISMATCH') }
  renameSync(tmp, dest)
  return { fetched: true, digest: got, bytes: n }
}

/** Parse `gpg --status-fd 1 --verify` output. VALIDSIG's last field is the PRIMARY key fingerprint. */
export function parseGpgStatus(text) {
  const lines = String(text).split(/\r?\n/)
  const valid = lines.find((l) => l.startsWith('[GNUPG:] VALIDSIG '))
  const bad = lines.some((l) => /^\[GNUPG:\] (BADSIG|ERRSIG|EXPSIG|EXPKEYSIG|REVKEYSIG|KEYREVOKED|NO_PUBKEY)/.test(l))
  if (!valid || bad) return { ok: false }
  const f = valid.split(' ')
  return { ok: true, signing_fpr: f[2], primary_fpr: f[f.length - 1] }
}

function gpgExe() {
  for (const c of ['C:\\Program Files\\Git\\usr\\bin\\gpg.exe', '/usr/bin/gpg']) if (existsSync(c)) return c
  return null
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 600000, windowsHide: true, env: opts.env, cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', error: r.error?.code }
}

function record(L, entry) {
  const m = readJsonState(L.manifest, (v) => v && Array.isArray(v.created))
  const created = m.ok ? m.value.created : []
  if (!created.includes(entry)) created.push(entry)
  atomicWriteJson(L.manifest, { schema: 'patelrep.developer-harness-v3.d33-setup-manifest', created })
}

/** The minimal environment for MSYS2/pacman: never the owner's full environment. */
function msysEnv(L) {
  return { SYSTEMROOT: process.env.SYSTEMROOT, SYSTEMDRIVE: process.env.SYSTEMDRIVE, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, MSYSTEM: 'UCRT64', CHERE_INVOKING: '1', MSYS2_PATH_TYPE: 'minimal', HOME: path.join(L.msys2, 'home', 'dh3'), PATH: [path.join(L.msys2, 'usr', 'bin'), path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32')].join(';') }
}

export function plan(L, artifacts) {
  return [
    `download+verify ${artifacts.artifacts.msys2_base.url} (GPG ${artifacts.artifacts.msys2_base.gpg_fingerprint})`,
    `extract MSYS2 base into ${L.msys2} (user scope; no admin, no PATH change)`,
    `pacman (signature-checked) install: ${artifacts.msys2_packages.join(', ')}`,
    `download+verify ${artifacts.artifacts.debian_image.url} -> ${L.baseImage} (sha512 pinned)`,
    `download+verify ${artifacts.artifacts.claude_linux_x64.url} -> ${L.claudePackage} (npm integrity pinned)`,
    'report Windows Hypervisor Platform state (enabling it is an OWNER-ONLY admin+reboot action; never performed here)',
  ]
}

export async function setup({ root, dryRun = false, log = console.log, artifacts = loadArtifacts() } = {}) {
  const L = layout(root)
  if (dryRun) { for (const s of plan(L, artifacts)) log(`[dry-run] ${s}`); return { ok: true, dryRun: true } }
  mkdirSync(L.root, { recursive: true }); record(L, L.root)
  const A = artifacts.artifacts
  // 1. MSYS2 base archive, verified by detached GPG signature against the pinned primary fingerprint.
  const sfx = path.join(L.downloads, path.basename(new URL(A.msys2_base.url).pathname))
  if (!existsSync(L.qemu)) {
    await fetchVerified(A.msys2_base.url, sfx, { alg: 'sha256', hex: null, maxBytes: A.msys2_base.max_bytes })
    await fetchVerified(A.msys2_base.sig_url, `${sfx}.sig`, { alg: 'sha256', hex: null, maxBytes: 65536 })
    record(L, L.downloads)
    const gpg = gpgExe(); if (!gpg) throw new Error('SETUP.GPG_UNAVAILABLE')
    mkdirSync(L.gnupg, { recursive: true }); record(L, L.gnupg)
    const genv = { ...msysEnv(L), GNUPGHOME: L.gnupg }
    // Git-for-Windows gpg cannot start dirmngr, so the key is fetched over HKPS by Node and imported. Safe regardless of what the keyserver
    // returns: acceptance below requires a VALIDSIG whose PRIMARY fingerprint equals the pinned one, which no other key can produce.
    const keyFile = path.join(L.gnupg, 'msys2-signing-key.asc')
    await fetchVerified(`https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=0x${A.msys2_base.gpg_fingerprint}`, keyFile, { alg: 'sha256', hex: null, maxBytes: 262144 })
    const imp = run(gpg, ['--batch', '--import', keyFile], { env: genv, timeout: 60000 })
    // gpg exits 2 when third-party certifications on the key cannot be checked; that is not a failure of the import. The VALIDSIG check is the gate.
    if (imp.code !== 0 && imp.code !== 2) throw new Error('SETUP.GPG_KEY_IMPORT_FAILED')
    const ver = run(gpg, ['--batch', '--status-fd', '1', '--verify', `${sfx}.sig`, sfx], { env: genv })
    const st = parseGpgStatus(ver.out)
    if (!st.ok || st.primary_fpr !== A.msys2_base.gpg_fingerprint) throw new Error('SETUP.MSYS2_SIGNATURE_INVALID')
    log(`MSYS2 archive signature valid (primary ${st.primary_fpr}); sha256 ${fileDigest(sfx, 'sha256')}`)
    // 2. Extract (7-Zip SFX) into the private runtime directory.
    if (!existsSync(path.join(L.msys2, 'usr', 'bin', 'bash.exe'))) {
      const parent = path.dirname(L.msys2); mkdirSync(parent, { recursive: true }); record(L, parent)
      const x = run(sfx, ['-y', `-o${parent}`], { timeout: 600000 })
      if (x.code !== 0 || !existsSync(path.join(L.msys2, 'usr', 'bin', 'bash.exe'))) throw new Error('SETUP.MSYS2_EXTRACT_FAILED')
    }
    // 3. pacman with signature checking. Refuse if the shipped pacman.conf disabled package signatures.
    const conf = readFileSync(path.join(L.msys2, 'etc', 'pacman.conf'), 'utf8')
    if (/^\s*SigLevel\s*=.*\bNever\b/m.test(conf)) throw new Error('SETUP.PACMAN_SIGNATURES_DISABLED')
    const bash = path.join(L.msys2, 'usr', 'bin', 'bash.exe')
    const env = msysEnv(L)
    const steps = ['true', 'pacman-key --init && pacman-key --populate msys2', `pacman -Sy --noconfirm --needed ${artifacts.msys2_packages.join(' ')}`]
    for (const s of steps) {
      const r = run(bash, ['-lc', s], { env, timeout: 1800000 })
      if (r.code !== 0) throw new Error(`SETUP.MSYS2_STEP_FAILED:${s.split(' ')[0]}`)
    }
  }
  const qv = run(L.qemu, ['--version'])
  if (qv.code !== 0) throw new Error('SETUP.QEMU_NOT_RUNNABLE')
  if (!qv.out.split(/\r?\n/)[0].includes(`version ${artifacts.qemu_version}`)) throw new Error(`SETUP.QEMU_VERSION_DRIFT:${qv.out.split(/\r?\n/)[0].slice(0, 80)}`)
  log(qv.out.split(/\r?\n/)[0])
  // 4. Worker base disk and the Claude Linux binary: fetched by the host, digest-pinned.
  mkdirSync(L.images, { recursive: true }); record(L, L.images)
  for (const [key, dest] of [['debian_image', L.baseImage], ['claude_linux_x64', L.claudePackage]]) {
    const d = parseDigest(A[key]); if (!d) throw new Error(`SETUP.NO_PIN:${key}`)
    const r = await fetchVerified(A[key].url, dest, { ...d, maxBytes: A[key].max_bytes })
    log(`${key}: ${r.fetched ? 'downloaded and' : 'already present,'} ${d.alg} verified`)
  }
  return { ok: true, qemuVersion: qv.out.split(/\r?\n/)[0] }
}

/** Remove exactly what the manifest recorded, deepest first, refusing anything outside the root. Owner WSL/Docker/settings are never touched. */
export function rollback({ root, dryRun = false, log = console.log } = {}) {
  const L = layout(root)
  const m = readJsonState(L.manifest, (v) => v && Array.isArray(v.created) && v.created.every((x) => typeof x === 'string'))
  if (!m.ok) return { ok: false, code: m.code }
  const targets = [...m.value.created].sort((a, b) => b.length - a.length)
  for (const t of targets) {
    if (!isInside(L.root, t)) { log(`refusing to remove outside root: ${t}`); return { ok: false, code: 'ROLLBACK.OUTSIDE_ROOT' } }
  }
  for (const t of targets) { log(`${dryRun ? '[dry-run] ' : ''}remove ${t}`); if (!dryRun && existsSync(t)) rmSync(t, { recursive: true, force: true }) }
  return { ok: true, removed: targets.length }
}

export const sizeOf = (f) => (existsSync(f) ? statSync(f).size : 0)
