// D3.3 infrastructure generators: QEMU isolation invariants, guest configuration, setup verification helpers, removal containment.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { buildQemuArgs, quoteWindowsArg, validateQemuArgs } from '../runtime/qemu-args.mjs'
import { buildProvisionScript, buildUserData, SANITIZER_PY, SSH_REQUIRES_SANITIZER, SSHD_CONFIG } from '../infra/cloud-init.mjs'
import { loginOutputProblems, sanitizeTerminal } from '../runtime/login-relay.mjs'
import { checkBundleBytes, importBundle } from '../runtime/artifact-transfer.mjs'
import { resolveGit } from '../authority/trusted-git.mjs'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fetchVerified, loadArtifacts, parseDigest, parseGpgStatus, rollback } from '../infra/setup.mjs'
import { isInside, layout } from '../infra/layout.mjs'
import { atomicWriteJson } from '../lib/atomic.mjs'
import { MANAGED_SETTINGS } from '../runtime/launcher.mjs'

const Q = { name: 'dh3-w1', ramMb: 1024, cpus: 2, accel: 'tcg', taskDisk: 'C:\\x\\task.qcow2', authDisk: 'C:\\x\\auth.qcow2', seedIso: null, sshPort: 40022 }

test('QEMU argv: no default devices, no host channels, restricted user net with one loopback SSH forward, no shared folders', () => {
  const a = buildQemuArgs(Q)
  assert.deepEqual(validateQemuArgs(a), [])
  const s = a.join(' ')
  assert.match(s, /-netdev user,id=n0,restrict=on,ipv6=off,hostname=dh3-w1,hostfwd=tcp:127\.0\.0\.1:40022-:22/)
  for (const bad of ['guestfwd', 'smb=', '-virtfs', 'fat:', 'spice', 'vnc', 'usb-', 'virtio-serial', '9p', 'server=on']) assert.ok(!s.includes(bad), bad)
  assert.ok(s.includes('-serial none') && s.includes('-monitor none') && s.includes('-display none') && s.includes('-parallel none'))
  assert.ok(s.includes('-accel tcg,thread=multi') && !s.includes('accel=tcg'), 'QEMU 11 rejects -machine accel= together with -accel')
  assert.ok(buildQemuArgs({ ...Q, accel: 'whpx' }).includes('whpx'))
  for (const bad of [{ ramMb: 100 }, { ramMb: 1000 }, { cpus: 9 }, { accel: 'kvm' }, { name: 'x' }, { sshPort: 22 }, { taskDisk: 'a,file=fat:C:\\' }]) assert.throws(() => buildQemuArgs({ ...Q, ...bad }))
})

test('QEMU validator is an exact allow-list: smuggled flags, devices, NICs, drives and channels are refused (unauthorized host resource access)', () => {
  const a = buildQemuArgs(Q)
  assert.ok(!a.some((x) => /qmp|^-chardev$|^-mon$|^-qmp$/.test(x)), 'there is no QMP/monitor channel at all')
  const sw = (i, v) => { const b = [...a]; b[b.indexOf(i) + 1] = v; return validateQemuArgs(b) }
  for (const v of ['user,id=n0,ipv6=off,hostname=dh3-w1,hostfwd=tcp:127.0.0.1:1-:22', 'user,id=n0,restrict=on,ipv6=off,hostname=dh3-w1,hostfwd=tcp:0.0.0.0:40022-:22',
    'user,id=n0,restrict=on,ipv6=off,hostname=dh3-w1,hostfwd=tcp:127.0.0.1:40022-:22,guestfwd=tcp:10.0.2.100:80-tcp:127.0.0.1:8000', 'user,id=n0,restrict=on,ipv6=off,hostname=dh3-w1,hostfwd=tcp:127.0.0.1:40022-:22,smb=C:\\', 'tap,id=n0', 'user,id=n0,restrict=on,hostname=dh3-w1,hostfwd=tcp:127.0.0.1:40022-:22'])
    assert.ok(sw('-netdev', v).includes('FORBIDDEN_VALUE:-netdev'), v)
  assert.ok(sw('-serial', 'tcp:127.0.0.1:9').includes('FORBIDDEN_VALUE:-serial'))
  assert.ok(sw('-display', 'sdl').includes('FORBIDDEN_VALUE:-display'))
  for (const extra of [['-qmp', 'tcp:127.0.0.1:1,server=on,wait=off'], ['-chardev', 'pipe,id=x,path=y'], ['-mon', 'chardev=x,mode=control']]) assert.ok(validateQemuArgs([...a, ...extra]).some((p) => p.startsWith('FORBIDDEN_FLAG')), extra[0])
  for (const extra of [['-virtfs', 'local,path=C:\\'], ['-nic', 'user'], ['-net', 'user'], ['-object', 'memory-backend-file,id=m,mem-path=C:\\x'], ['-blockdev', 'driver=vvfat,dir=C:\\'], ['-readconfig', 'x.cfg'], ['-fw_cfg', 'name=opt/x,file=C:\\x'], ['-add-fd', 'fd=3,set=1'], ['-mem-path', 'C:\\'], ['-bios', 'x.bin'], ['-kernel', 'x'], ['-incoming', 'exec:calc'], ['-plugin', 'x.dll'], ['-gdb', 'tcp::1'], ['-S']])
    assert.ok(validateQemuArgs([...a, ...extra]).some((p) => p.startsWith('FORBIDDEN_FLAG')), extra[0])
  for (const dev of ['virtio-serial-pci', 'usb-host,vendorid=1', 'virtio-9p-pci,fsdev=x', 'ivshmem-plain', 'vhost-vsock-pci,guest-cid=3', 'virtio-net-pci,netdev=n1'])
    assert.ok(validateQemuArgs([...a, '-device', dev]).includes('FORBIDDEN_VALUE:-device'), dev)
  for (const drv of ['file=fat:rw:C:\\Users', 'file=C:\\x\\task.qcow2,if=none,id=task,format=raw', 'driver=vvfat,dir=C:\\,id=task']) assert.ok(validateQemuArgs([...a, '-drive', drv]).includes('FORBIDDEN_VALUE:-drive'), drv)
  assert.ok(validateQemuArgs([...a, '-netdev', a[a.indexOf('-netdev') + 1].replace('n0', 'n1')]).includes('NETDEV_COUNT'))
  assert.ok(validateQemuArgs(a.filter((x) => x !== '-nodefaults')).includes('NODEFAULTS_MISSING'))
})
test('Windows argument quoting follows CommandLineToArgvW rules', () => {
  assert.equal(quoteWindowsArg('plain'), 'plain'); assert.equal(quoteWindowsArg(''), '""')
  assert.equal(quoteWindowsArg('a b'), '"a b"'); assert.equal(quoteWindowsArg('a"b'), '"a\\"b"'); assert.equal(quoteWindowsArg('C:\\a b\\'), '"C:\\a b\\\\"')
})

const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAASYNTHETIC\n-----END OPENSSH PRIVATE KEY-----\n'
test('guest config: ctl-only SSH, no forwarding except one remote listen, root-owned managed settings, worker without sudo or SSH', () => {
  const ud = buildUserData({ name: 'dh3-w1', controllerPublicKey: 'ssh-ed25519 AAAAC3Nza dh3-controller', hostKeyPrivate: KEY, hostKeyPublic: 'ssh-ed25519 AAAAhost dh3-guest-host' })
  assert.match(ud, /^#cloud-config\n/)
  for (const l of ['AllowUsers ctl', 'AllowAgentForwarding no', 'X11Forwarding no', 'PermitTunnel no', 'AllowStreamLocalForwarding no', 'AllowTcpForwarding remote', 'PermitListen 127.0.0.1:3128', 'PermitOpen none', 'PasswordAuthentication no']) assert.ok(SSHD_CONFIG.includes(l), l)
  const worker = ud.slice(ud.indexOf('- name: worker'), ud.indexOf('write_files:'))
  assert.ok(!/sudo|ssh_authorized_keys/.test(worker), 'worker has no sudo and no SSH key')
  assert.ok(ud.includes(`"disableAllHooks": true`) && ud.includes('/etc/claude-code/managed-settings.json'))
  assert.equal(MANAGED_SETTINGS.allowManagedHooksOnly, true); assert.equal(MANAGED_SETTINGS.allowManagedMcpServersOnly, true)
  assert.ok(!/ANTHROPIC|TOKEN|GITHUB|SUPABASE|RAILWAY|VERCEL|EXPO|TELEGRAM/.test(ud.replace(/OPENSSH PRIVATE KEY/g, '')), 'no host credential of any kind is placed in the guest')
  assert.throws(() => buildUserData({ name: 'x', controllerPublicKey: 'ssh-rsa AAA', hostKeyPrivate: KEY, hostKeyPublic: 'ssh-ed25519 AAA' }), /BAD_KEY/)
})

test('provision script verifies the pinned digest in the guest, installs root-owned read-only, disables cloud-init, removes the apt proxy', () => {
  const s = buildProvisionScript({ claudeSha512Hex: 'a'.repeat(128), claudeVersion: '2.1.331' })
  assert.ok(s.includes(`${'a'.repeat(128)}  /tmp/dh3-claude.tgz" | sha512sum -c -`))
  assert.ok(s.includes('install -o root -g root -m 0555') && s.includes('touch /etc/cloud/cloud-init.disabled') && s.includes('rm -f /etc/apt/apt.conf.d/90dh3-proxy'))
  assert.ok(/^set -euo pipefail/.test(s))
  assert.throws(() => buildProvisionScript({ claudeSha512Hex: 'zz', claudeVersion: '2.1.331' }), /BAD_PIN/)
})

test('artifact pins: every artifact is HTTPS and pinned; SRI parsing; GPG status parsing needs VALIDSIG with the pinned primary key', () => {
  const A = loadArtifacts().artifacts
  for (const [k, a] of Object.entries(A)) { assert.match(a.url, /^https:\/\//, k); assert.ok(a.max_bytes > 0) }
  assert.equal(parseDigest(A.claude_linux_x64).alg, 'sha512'); assert.equal(parseDigest(A.claude_linux_x64).hex.length, 128)
  assert.equal(parseDigest(A.debian_image).hex, A.debian_image.sha512)
  assert.equal(parseDigest({}), null)
  const ok = '[GNUPG:] GOODSIG 46BD761F7A49B0EC x\n[GNUPG:] VALIDSIG AAAA 2026-01-01 0 4 0 1 10 00 0EBF782C5D53F7E5FB02A66746BD761F7A49B0EC\n'
  assert.equal(parseGpgStatus(ok).primary_fpr, A.msys2_base.gpg_fingerprint)
  assert.equal(parseGpgStatus(`${ok}[GNUPG:] BADSIG x\n`).ok, false)
  assert.equal(parseGpgStatus('[GNUPG:] NO_PUBKEY x').ok, false)
})

test('fetchVerified: digest mismatch and size cap leave no file; non-HTTPS refused', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-fetch-'))
  try {
    const body = Buffer.from('payload')
    const fake = async () => ({ ok: true, status: 200, url: 'https://example.invalid/x', body: (async function* () { yield body })() })
    const good = createHash('sha256').update(body).digest('hex')
    assert.equal((await fetchVerified('https://example.invalid/x', path.join(d, 'a'), { alg: 'sha256', hex: good, maxBytes: 100, fetchImpl: fake })).fetched, true)
    await assert.rejects(fetchVerified('https://example.invalid/x', path.join(d, 'b'), { alg: 'sha256', hex: '0'.repeat(64), maxBytes: 100, fetchImpl: fake }), /DIGEST_MISMATCH/)
    assert.equal(existsSync(path.join(d, 'b')), false); assert.equal(existsSync(path.join(d, 'b.partial')), false)
    await assert.rejects(fetchVerified('https://example.invalid/x', path.join(d, 'c'), { alg: 'sha256', hex: good, maxBytes: 3, fetchImpl: fake }), /TOO_LARGE/)
    await assert.rejects(fetchVerified('http://example.invalid/x', path.join(d, 'e'), { alg: 'sha256', hex: good, maxBytes: 100, fetchImpl: fake }), /NOT_HTTPS/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('removal is manifest-bound and refuses anything outside the D3.3 root', () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-rm-'))
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dh3-outside-'))
  try {
    const root = path.join(d, 'root'); const L = layout(root); mkdirSync(path.join(root, 'images'), { recursive: true })
    assert.ok(isInside(root, path.join(root, 'images'))); assert.ok(!isInside(root, `${root}-evil`)); assert.ok(!isInside(root, outside))
    atomicWriteJson(L.manifest, { created: [root, path.join(root, 'images'), outside] })
    assert.equal(rollback({ root, log: () => {} }).code, 'ROLLBACK.OUTSIDE_ROOT')
    assert.ok(existsSync(outside) && existsSync(path.join(root, 'images')), 'nothing is removed when any entry is outside')
    atomicWriteJson(L.manifest, { created: [root, path.join(root, 'images')] })
    assert.equal(rollback({ root, dryRun: true, log: () => {} }).ok, true); assert.ok(existsSync(root))
    assert.equal(rollback({ root, log: () => {} }).ok, true); assert.equal(existsSync(root), false)
    assert.throws(() => L.worker('../../x'), /INVALID_WORKER_ID/)
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
})

test('security S6: login relay strips terminal escapes and refuses non-login hosts or the API-key scope', () => {
  assert.equal(sanitizeTerminal('ok\u001b]52;c;ZXZpbA==\u0007 \u001b]8;;https://evil.example/\u001b\\link\u001b]8;;\u001b\\ \u001b[31mred\u001b[0m\u0007\r\n'), 'ok link red\r\n')
  assert.deepEqual(loginOutputProblems('Open https://claude.ai/oauth/authorize?scope=user:inference and https://platform.claude.com/x'), [])
  assert.ok(loginOutputProblems('Open https://evil.example/oauth').some((p) => p.startsWith('LOGIN.URL_HOST_NOT_ALLOWED')))
  assert.ok(loginOutputProblems('https://claude.ai/oauth/authorize?scope=org%3Acreate_api_key').includes('LOGIN.API_KEY_SCOPE_REQUESTED'))
  assert.ok(loginOutputProblems('http://claude.ai/x').includes('LOGIN.URL_NOT_HTTPS'))
  assert.ok(loginOutputProblems('https://user:pw@claude.ai/x').includes('LOGIN.URL_USERINFO'))
})

test('security S2: bundle import refuses gitdir redirects and bad headers, and recomputes the tree with host git', () => {
  assert.equal(checkBundleBytes(Buffer.from('gitdir: C:/Users/x/PatelRep/.git\n')), 'BUNDLE.BAD_HEADER')
  assert.equal(checkBundleBytes(Buffer.alloc(0)), 'BUNDLE.EMPTY')
  assert.equal(importBundle(Buffer.from('gitdir: ../../.git\n')).code, 'BUNDLE.BAD_HEADER')
  const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-git-'))
  try {
    // D3.6 Linux compatibility: the fixture's git is the platform's trusted absolute git (it was hard-coded to the Windows path, so this test could not run elsewhere)
    const tg = resolveGit(); assert.ok(tg.ok, tg.code)
    const env = { ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}), PATH: [path.dirname(tg.exe), ...(process.platform === 'win32' ? [`${process.env.SYSTEMROOT}\\System32`] : [])].join(path.delimiter), HOME: d, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(d, 'none') }
    const g = (...a) => spawnSync(tg.exe, a, { cwd: path.join(d, 'w'), env, encoding: 'utf8' })
    mkdirSync(path.join(d, 'w')); g('init', '-q'); writeFileSync(path.join(d, 'w', 'a.txt'), 'hello\n'); g('add', 'a.txt'); g('-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '-m', 'a')
    const tree = g('rev-parse', 'HEAD^{tree}').stdout.trim(); g('bundle', 'create', '-q', path.join(d, 'b.bundle'), 'HEAD')
    const r = importBundle(readFileSync(path.join(d, 'b.bundle')))
    assert.equal(r.ok, true, r.code); assert.equal(r.tree, tree)
    const corrupt = readFileSync(path.join(d, 'b.bundle')); corrupt[corrupt.length - 30] ^= 0xff
    assert.equal(importBundle(corrupt).ok, false, 'a corrupted pack is refused')
    for (const git of [null, 'git', 'relative/git']) assert.equal(importBundle(readFileSync(path.join(d, 'b.bundle')), { git }).code, 'BUNDLE.NO_TRUSTED_GIT', `no trusted absolute git (${git}) = a refusal, never a bare git`)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('security B1/S4: guest hardening — fd-relative O_NOFOLLOW sanitizer that wipes on failure, sshd requires it, ptrace restricted, bypass disabled by managed settings', () => {
  for (const s of ['O_NOFOLLOW', 'O_EXCL', 'dir_fd=', 'st_nlink != 1', 'O_NONBLOCK', 'sys.exit(1)', 'CRED_KEYS', '/run/dh3-sanitized']) assert.ok(SANITIZER_PY.includes(s), s)
  assert.ok(!/open\(tmp, "w"\)/.test(SANITIZER_PY), 'no path-based write that could follow a planted symlink')
  assert.match(SSH_REQUIRES_SANITIZER, /Requires=patelrep-sanitize-home\.service/)
  const ud = buildUserData({ name: 'dh3-w1', controllerPublicKey: 'ssh-ed25519 AAAAC3Nza dh3-controller', hostKeyPrivate: KEY, hostKeyPublic: 'ssh-ed25519 AAAAhost dh3-guest-host' })
  assert.ok(ud.includes('/etc/systemd/system/ssh.service.d/10-dh3-requires-sanitizer.conf') && ud.includes('/etc/systemd/system/ssh.socket.d/10-dh3-requires-sanitizer.conf'))
  assert.ok(ud.includes('kernel.yama.ptrace_scope = 2'))
  assert.ok(ud.includes('"disableBypassPermissionsMode": "disable"'))
  assert.ok(buildProvisionScript({ claudeSha512Hex: 'a'.repeat(128), claudeVersion: '2.1.331' }).includes('/etc/apt/mirrors/*.list'), 'Debian 13 mirror lists are rewritten to HTTPS')
})