// D3.3 isolation acceptance: the pure evaluators must PASS only on complete, expected evidence and FAIL on everything else (negative,
// malformed, empty, exception). Fixtures model the real Debian 13 / QEMU q35 worker, including the shapes seen in the first WHPX run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as R from '../isolation/acceptance-rules.mjs'
import { buildPeFixture, validatePeFixture } from '../isolation/pe-fixture.mjs'
import { closureIdentity, persistAcceptance, runName, ROOT_FACTS_CMD, BURN_PY, BURN_SECONDS, BURN_WINDOW_S, PLANT_CHECK_CMD } from '../isolation/acceptance.mjs'
import { buildProvisionScript, buildUserData, GUEST_HARDENING, HARDENING_MODULES, MASKED_UNITS, MODPROBE_HARDENING } from '../infra/cloud-init.mjs'

const clone = (x) => JSON.parse(JSON.stringify(x))
const PE = buildPeFixture()
const PE_SHA = createHash('sha256').update(PE).digest('hex')
const T = { host_addrs: ['10.0.2.2', '192.168.1.5'], host_ports: [22, 445], controller_ports: [40000, 40022], other_vm_addrs: ['172.17.0.1', '10.0.2.4'] }
const noConn = (keys, v = 'ECONNREFUSED') => Object.fromEntries(keys.map((k) => [k, v]))
const PY_HANDLER = 'enabled\ninterpreter /usr/bin/python3.13\nflags: \noffset 0\nmagic f30d0d0a\n'
const ENOEXEC = { ran: false, errno: 'ENOEXEC' }; const ENOENT = { ran: false, errno: 'ENOENT' }

// Debian's static /dev/vsock node: root:0600, char 10:x, never registered (no driver) → the worker gets EACCES; root's open answers ENODEV.
const VSOCK_NODE = { mode: 0o600, uid: 0, char: true, major: 10, minor: 121, registered: false }
function goodProbe() {
  return {
    probe_version: 3,
    s1: { fs_types: ['cgroup2', 'devtmpfs', 'ext4', 'fusectl', 'proc', 'sysfs', 'tmpfs'], root_fs_type: 'ext4', paths_present: [], block_devices: ['vda', 'vdb'], user: 'worker' },
    s2: { binfmt_dir_entries: [], binfmt_mounted: false, binfmt_status: null, binfmt_handlers: {}, fixture_sha256_written: PE_SHA,
      exec: { pe_exe: ENOEXEC, pe_noext: ENOEXEC, mz_stub: ENOEXEC, positive_control: { ran: true, rc: 42 } },
      host_binary_paths: { '/mnt/c/Windows/System32/cmd.exe': ENOENT, '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe': ENOENT, '/init': ENOENT }, windows_tools_on_path: [], wsl_env: [] },
    s3: { host_tcp: { '10.0.2.2:22': 'ECONNREFUSED', '10.0.2.2:445': 'ECONNREFUSED', '192.168.1.5:22': 'ENETUNREACH', '192.168.1.5:445': 'ENETUNREACH' }, slirp_dns_udp: 'timeout' },
    s4: { controller_tcp: { '10.0.2.2:40000': 'ECONNREFUSED', '10.0.2.2:40022': 'ECONNREFUSED' }, via_proxy: { '127.0.0.1:40000': 'HTTP/1.1 403 Forbidden', 'localhost:40000': 'HTTP/1.1 403 Forbidden', '10.0.2.2:22': 'HTTP/1.1 403 Forbidden' } },
    s5: { resolver: 'gaierror:-3', public_dns_udp: { '1.1.1.1': 'ENETUNREACH', '8.8.8.8': 'ENETUNREACH' }, direct_tcp: noConn(['1.1.1.1:443', '160.79.104.10:443', '140.82.112.3:443'], 'ENETUNREACH'),
      via_proxy: { ...Object.fromEntries(R.S5_PROXY_TARGETS.map((t) => [t, 'HTTP/1.1 403 Forbidden'])), 'api.anthropic.com:443': 'HTTP/1.1 200 Connection Established' } },
    s6: { neighbors_tcp: noConn(['172.17.0.1:22', '172.17.0.1:80', '172.17.0.1:2375', '172.17.0.1:2376', '10.0.2.4:22', '10.0.2.4:80', '10.0.2.4:2375', '10.0.2.4:2376'], 'timeout') },
    s7: { sockets: [], tools: [], sudo_rc: 1, groups: ['worker'] },
    s10: { virtio_ports: [], usb_devices: [], virtio_devices: ['0x1af4:0x0001', '0x1af4:0x0002', '0x1af4:0x0002', '0x1af4:0x0004', '0x1af4:0x0005'],
      pci_devices: ['0x1af4:0x1000', '0x1af4:0x1001', '0x1af4:0x1001', '0x1af4:0x1002', '0x1af4:0x1005', '0x8086:0x2918', '0x8086:0x2922', '0x8086:0x2930', '0x8086:0x29c0'],
      vmbus_devices: null, modules: ['ext4', 'virtio_net', 'virtio_blk', 'virtio_rng'], agents: [],
      // static nodes kmod creates for kvm / vhost-net / vhost-vsock whether or not a driver loads: present, NOT registered
      dev_channels: [{ name: 'kvm', mode: 0o660, uid: 0, char: true, major: 10, minor: 232, registered: false }, { name: 'vhost-net', mode: 0o600, uid: 0, char: true, major: 10, minor: 238, registered: false },
        { name: 'vhost-vsock', mode: 0o600, uid: 0, char: true, major: 10, minor: 241, registered: false }, { name: 'vsock', ...VSOCK_NODE }],
      vsock: { dev_node: true, node: VSOCK_NODE, dev_open: 'EACCES', stream_socket: 'EAFNOSUPPORT' } },
    s11: { worker_date_s_rc: 1 },
    complete: true,
  }
}
const HARDENED_ROOT_TEXT = ['@@FWCFG', 'FWCFG_LISTED', 'bootorder', 'etc/acpi/rsdp', 'etc/acpi/tables', 'etc/e820', 'etc/smbios/smbios-tables', 'genroms/kvmvapic.bin', '@@DMI', '0', '@@MODPROBE',
  ...HARDENING_MODULES.map((m) => `install ${m} /bin/false`), '@@MASK', 'masked', '@@VSOCK', 'sh: 1: cannot open /dev/vsock: No such device', '@@END', ''].join('\n')
const UNHARDENED_ROOT_TEXT = ['@@FWCFG', 'FWCFG_NO_DRIVER', '@@DMI', '0', '@@MODPROBE', '@@MASK', 'static', '@@VSOCK', 'NO_NODE', '@@END', ''].join('\n')
const HARD = { vsock: true, binfmt: true }; const SOFT = { vsock: false, binfmt: false }
const ctx2 = (o = {}) => ({ fixtureSha256: PE_SHA, fixtureProblems: [], hostRun: { rc: 0 }, hardened: HARD, root: R.parseRootFacts(HARDENED_ROOT_TEXT), ...o })
const ctx10 = (o = {}) => ({ argvProblems: [], hardened: HARD, root: R.parseRootFacts(HARDENED_ROOT_TEXT), ...o })
// What the host proxy really logs for goodProbe's 9 denied CONNECTs + 1 tunnel (run-1 shape).
const LOG = [...Array(4).fill({ allow: false, code: 'EGRESS.IP_LITERAL', host: null }), ...Array(4).fill({ allow: false, code: 'EGRESS.HOST_NOT_ALLOWLISTED', host: 'x' }),
  { allow: false, code: 'EGRESS.PORT_NOT_ALLOWED', host: 'api.anthropic.com' }, { allow: true, code: 'EGRESS.CLOSED', host: 'api.anthropic.com' }]
const verdicts = (P, c2 = ctx2(), c10 = ctx10()) => ({ 1: R.evalS1(P), 2: R.evalS2(P, c2), 3: R.evalS3(P, { targets: T }), 4: R.evalS4(P, { targets: T, proxyLog: LOG }), 5: R.evalS5(P, { proxyLog: LOG }),
  6: R.evalS6(P, { targets: T, hostNeighbors: { wsl_running: [], docker_desktop_running: false } }), 7: R.evalS7(P), 10: R.evalS10(P, c10), 11: R.evalS11(P, { guestShiftMs: 24 * 3600000, hostDeltaMs: 100 }) })

test('a complete, expected probe passes every probe-based scenario on the hardened image', () => {
  for (const [n, r] of Object.entries(verdicts(goodProbe()))) assert.equal(r.verdict, 'PASS', `${n}: ${r.problems}`)
})

test('vacuity: no probe, wrong version, incomplete run, a failed section or empty maps can never PASS', () => {
  for (const P of [null, undefined, {}, { ...goodProbe(), probe_version: 1 }, { ...goodProbe(), complete: false }, (() => { const p = goodProbe(); delete p.complete; return p })()])
    for (const [n, r] of Object.entries(verdicts(P))) assert.equal(r.verdict, 'FAIL', `scenario ${n} passed on an invalid probe`)
  // regression: scenario 11 used `undefined !== 0` and PASSED when the probe never ran
  assert.equal(R.evalS11(null, { guestShiftMs: 24 * 3600000, hostDeltaMs: 1 }).verdict, 'FAIL')
  for (const sec of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's10', 's11']) {
    const P = goodProbe(); P[sec] = { __error__: 'OSError:EIO' }
    const n = Number(sec.slice(1)); assert.equal(verdicts(P)[n].verdict, 'FAIL', sec); assert.ok(verdicts(P)[n].problems.some((x) => x.includes('SECTION_FAILED')))
  }
  const empty = goodProbe(); empty.s3.host_tcp = {}; empty.s4.controller_tcp = {}; empty.s5.public_dns_udp = {}; empty.s6.neighbors_tcp = {}; empty.s4.via_proxy = {}
  const v = verdicts(empty); for (const n of [3, 4, 5, 6]) assert.equal(v[n].verdict, 'FAIL', `empty map passed scenario ${n}`)
  const missing = goodProbe(); delete missing.s3.slirp_dns_udp; delete missing.s7.sudo_rc
  assert.equal(R.evalS3(missing, { targets: T }).verdict, 'FAIL'); assert.equal(R.evalS7(missing).verdict, 'FAIL')
  assert.equal(R.evalS8({}).verdict, 'FAIL'); assert.equal(R.evalS8({ ddExit: NaN, enospc: true, rootBytes: NaN, taskVirtualSize: 24 * 1073741824, authDiskBytes: 1 }).verdict, 'FAIL')
  assert.equal(R.evalS12({}).verdict, 'FAIL'); assert.equal(R.evalS13({}).verdict, 'FAIL'); assert.equal(R.evalS9({}).verdict, 'FAIL')
  assert.equal(R.overallVerdict({}), 'INCOMPLETE')
})

test('connect outcomes: only known no-connection results with exact target coverage pass; CONNECTED or an unrecognised outcome fails', () => {
  const P = goodProbe(); P.s3.host_tcp['192.168.1.5:445'] = 'CONNECTED'
  assert.ok(R.evalS3(P, { targets: T }).problems.includes('S3.HOST_TCP.REACHED:192.168.1.5:445'))
  const Q = goodProbe(); Q.s3.host_tcp['10.0.2.2:22'] = 'OSError' // run-1 style class name: unrecognised, never assumed harmless
  assert.ok(R.evalS3(Q, { targets: T }).problems.includes('S3.HOST_TCP.UNKNOWN_OUTCOME:10.0.2.2:22'))
  const C = goodProbe(); delete C.s3.host_tcp['192.168.1.5:22']; assert.ok(R.evalS3(C, { targets: T }).problems.includes('S3.HOST_TCP.COVERAGE'))
  const D = goodProbe(); D.s3.slirp_dns_udp = 'ANSWERED'; assert.ok(R.evalS3(D, { targets: T }).problems.includes('S3.SLIRP_DNS_ANSWERED'))
  const E = goodProbe(); E.s4.via_proxy['10.0.2.2:22'] = 'HTTP/1.1 400 Bad Request'; assert.equal(R.evalS4(E, { targets: T }).verdict, 'FAIL', 'only the proxy 403 denial counts')
  const F = goodProbe(); F.s4.via_proxy['10.0.2.2:22'] = 'NO_PROXY:ECONNREFUSED'; assert.equal(R.evalS4(F, { targets: T }).verdict, 'FAIL', 'an unreachable proxy proves nothing')
  const G = goodProbe(); G.s5.via_proxy['api.anthropic.com:443'] = 'HTTP/1.1 403 Forbidden'; assert.ok(R.evalS5(G).problems.includes('S5.POSITIVE_CONTROL_FAILED'))
  const H = goodProbe(); H.s5.resolver = 'RESOLVED'; assert.ok(R.evalS5(H).problems.includes('S5.RESOLVER_ANSWERED'))
  const I = goodProbe(); I.s7.groups = ['worker', 'docker']; assert.ok(R.evalS7(I).problems.includes('S7.GROUPS_UNEXPECTED'))
  const J = goodProbe(); J.s7.sudo_rc = 'ERR:ENOENT'; assert.ok(R.evalS7(J).problems.includes('S7.SUDO_NOT_REFUSED'))
  const K = goodProbe(); K.s1.root_fs_type = null; assert.equal(R.evalS1(K).verdict, 'FAIL', 'mount table must really have been read')
  const L1 = goodProbe(); L1.s1.fs_types.push('9p'); assert.ok(R.evalS1(L1).problems.includes('S1.HOST_FILESYSTEM_MOUNTED'))
})

test('scenario 6 never claims an ACTIVE WSL/Docker network was exercised when none was running', () => {
  const off = R.evalS6(goodProbe(), { targets: T, hostNeighbors: { wsl_running: [], docker_desktop_running: false } })
  assert.equal(off.verdict, 'PASS'); assert.equal(off.evidence.active_neighbors_exercised, false); assert.match(off.limitations[0], /not empirically exercised/)
  const on = R.evalS6(goodProbe(), { targets: T, hostNeighbors: { wsl_running: ['Ubuntu'], docker_desktop_running: false } })
  assert.equal(on.evidence.active_neighbors_exercised, true); assert.deepEqual(on.limitations, []); assert.equal(on.evidence.host_wsl_running_count, 1, 'distro names are not recorded')
  assert.match(R.evalS6(goodProbe(), { targets: T, hostNeighbors: {} }).limitations[0], /could not be determined/)
})

test('scenario 2 root cause: the run-1 guest (Debian python3.13 handler) is parsed exactly, and acceptance requires the hardened image', () => {
  const P = goodProbe(); P.s2.binfmt_dir_entries = ['python3.13', 'register', 'status']; P.s2.binfmt_mounted = true; P.s2.binfmt_status = 'enabled'; P.s2.binfmt_handlers = { 'python3.13': PY_HANDLER }
  const r = R.evalS2(P, ctx2({ hardened: SOFT, root: R.parseRootFacts(UNHARDENED_ROOT_TEXT) }))
  assert.deepEqual(r.problems, ['S2.IMAGE_NOT_HARDENED'], 'the run-1 image fails only for not being hardened: its handler itself is allow-listed')
  assert.deepEqual(r.evidence.binfmt_handlers['python3.13'], { enabled: true, interpreter: '/usr/bin/python3.13', flags: '', offset: 0, magic: 'f30d0d0a', mask: null, extension: null })
  // ...and the same guest on an image whose provisioning claims binfmt_misc is disabled must fail
  assert.ok(R.evalS2(P, ctx2()).problems.includes('S2.BINFMT_PRESENT_ON_HARDENED_IMAGE'))
  assert.ok(R.evalS2(P, ctx2({ root: R.parseRootFacts(UNHARDENED_ROOT_TEXT) })).problems.includes('S2.HARDENING_NOT_IN_EFFECT'))
})

test('scenario 2 negative fixtures: unauthorized or altered binfmt handlers, interop execution, wrong errno, bad fixture or failed controls all FAIL', () => {
  const withHandler = (name, text) => { const P = goodProbe(); P.s2.binfmt_dir_entries = [name, 'register', 'status']; P.s2.binfmt_mounted = true; P.s2.binfmt_handlers = { [name]: text }; return R.evalS2(P, ctx2({ hardened: SOFT })) }
  // a WSL-style Windows interop handler (MZ magic, fix-binary + credentials flags) — the attack this scenario exists for
  assert.ok(withHandler('WSLInterop', 'enabled\ninterpreter /init\nflags: PF\noffset 0\nmagic 4d5a\n').problems.includes('S2.BINFMT_UNAUTHORIZED:WSLInterop'))
  assert.ok(withHandler('winexe', 'enabled\ninterpreter /usr/bin/wine\nflags: \nextension .exe\n').problems.includes('S2.BINFMT_UNAUTHORIZED:winexe'))
  // The allow-list itself (tested directly: on the unhardened image every verdict FAILs anyway, so a verdict check would be vacuous).
  assert.equal(R.binfmtHandlerAllowed('python3.13', R.parseBinfmtEntry(PY_HANDLER)), true)
  for (const t of [PY_HANDLER.replace('/usr/bin/python3.13', '/tmp/python3.13'), PY_HANDLER.replace('flags: ', 'flags: C'), PY_HANDLER.replace('f30d0d0a', '4d5a'), PY_HANDLER.replace('offset 0', 'offset 2'), `${PY_HANDLER}mask ff\n`, 'enabled\nsomething weird\n', '']) {
    assert.equal(R.binfmtHandlerAllowed('python3.13', R.parseBinfmtEntry(t)), false, JSON.stringify(t))
    assert.ok(withHandler('python3.13', t).problems.includes('S2.BINFMT_UNAUTHORIZED:python3.13'), JSON.stringify(t))
  }
  assert.equal(R.binfmtHandlerAllowed('python3.12', R.parseBinfmtEntry(PY_HANDLER)), false, 'the allow-list is exact by name too')
  assert.ok(withHandler('python3.12', PY_HANDLER).problems.includes('S2.BINFMT_UNAUTHORIZED:python3.12'))
  const unreadable = goodProbe(); unreadable.s2.binfmt_dir_entries = ['x', 'register', 'status']; unreadable.s2.binfmt_handlers = { x: { read_error: 'EACCES' } }
  assert.ok(R.evalS2(unreadable, ctx2({ hardened: SOFT })).problems.includes('S2.BINFMT_UNREADABLE:x'))
  const hidden = goodProbe(); hidden.s2.binfmt_dir_entries = ['ghost', 'register', 'status']
  assert.ok(R.evalS2(hidden, ctx2({ hardened: SOFT })).problems.includes('S2.BINFMT_INCONSISTENT'))
  const ran = goodProbe(); ran.s2.exec.pe_exe = { ran: true, rc: 0 }; assert.ok(R.evalS2(ran, ctx2()).problems.includes('S2.NOT_ENOEXEC:pe_exe'), 'a PE that RUNS is interop')
  const runOne = goodProbe(); runOne.s2.exec.pe_noext = { ran: false, errno: 'EACCES' }; assert.ok(R.evalS2(runOne, ctx2()).problems.includes('S2.NOT_ENOEXEC:pe_noext'))
  const legacy = goodProbe(); legacy.s2.exec.pe_exe = 'OSError'; assert.equal(R.evalS2(legacy, ctx2()).verdict, 'FAIL', 'run-1 class-name output is not evidence')
  const pc = goodProbe(); pc.s2.exec.positive_control = { ran: false, errno: 'EACCES' }; assert.ok(R.evalS2(pc, ctx2()).problems.includes('S2.POSITIVE_CONTROL_FAILED'), 'noexec home would make ENOEXEC meaningless')
  const host = goodProbe(); host.s2.host_binary_paths['/init'] = { ran: true, rc: 0 }; assert.ok(R.evalS2(host, ctx2()).problems.includes('S2.HOST_BINARY_REACHABLE:/init'))
  assert.ok(R.evalS2(goodProbe(), ctx2({ fixtureSha256: 'f'.repeat(64) })).problems.includes('S2.FIXTURE_NOT_DELIVERED'))
  assert.ok(R.evalS2(goodProbe(), ctx2({ fixtureProblems: ['PE.NO_MZ'] })).problems.includes('S2.FIXTURE_INVALID'))
  assert.ok(R.evalS2(goodProbe(), ctx2({ hostRun: { rc: null, error: 'EACCES' } })).problems.includes('S2.FIXTURE_NOT_RUNNABLE_ON_HOST'))
  const env = goodProbe(); env.s2.wsl_env = ['WSL_INTEROP']; assert.ok(R.evalS2(env, ctx2()).problems.includes('S2.WSL_ENVIRONMENT'))
})

test('PE fixture: a well-formed PE32+ console executable whose only code exits 0; deterministic and pinned', () => {
  assert.deepEqual(validatePeFixture(PE), [])
  assert.equal(PE.length, 1024); assert.ok(buildPeFixture().equals(PE))
  assert.equal(PE_SHA, '97dfcfff7e5eae8d634cf2850a15ae0d8b35ac475451ae34d8eec05e99b769c4','reviewed fixture bytes are pinned: any change to them must be deliberate')
  const bad = (f) => { const b = Buffer.from(PE); f(b); return validatePeFixture(b) }
  assert.ok(bad((b) => { b[0x200] = 0xcc }).includes('PE.CODE_NOT_EXIT0'))
  assert.ok(bad((b) => { b.writeUInt32LE(0x2000, 0x58 + 112 + 8) }).includes('PE.DATA_DIRECTORY_NOT_EMPTY:1'), 'an import table would make it do more than exit')
  assert.ok(bad((b) => { b[0] = 0 }).includes('PE.NO_MZ'))
  assert.ok(bad((b) => { b.writeUInt16LE(0x14c, 0x44) }).includes('PE.NOT_AMD64'))
  assert.deepEqual(validatePeFixture(Buffer.from('MZ' + '\0'.repeat(126))), ['PE.TOO_SHORT'], 'the run-1 MZ stub is not an executable')
})

const VS_INERT = { dev_node: true, local_cid: 0xffffffff, stream_socket: 'created', connect: { '0:1024': 'ENODEV', '2:22': 'ENODEV', '2:1024': 'ENODEV', '2:9999': 'ENODEV', '3:1024': 'ENODEV' }, dgram: 'ENODEV' }
const withVsock = (vs, modules = ['ext4', 'virtio_net']) => { const P = goodProbe(); P.s10.vsock = vs; P.s10.modules = modules; return P }

test('scenario 10 VSOCK on the hardened image: Debian\'s root-only static node is "absent" only when root\'s own open confirms no driver', () => {
  const ABS = { dev_node: true, node: VSOCK_NODE, dev_open: 'EACCES', stream_socket: 'EAFNOSUPPORT' }
  // review S1: the worker cannot open the root:0600 node (EACCES); root's ENODEV/ENXIO is then the evidence
  assert.equal(R.classifyVsock(ABS, [], 'ENODEV').state, 'absent'); assert.equal(R.classifyVsock(ABS, [], 'ENXIO').state, 'absent')
  for (const root of [null, 'opened', 'unknown', 'no_node', 'EACCES']) assert.equal(R.classifyVsock(ABS, [], root).state, 'unknown', `root=${root}`)
  assert.equal(R.classifyVsock({ ...ABS, node: { ...VSOCK_NODE, mode: 0o666 } }, [], 'ENODEV').state, 'unknown', 'EACCES on a world-accessible node is not explained by permissions')
  assert.equal(R.classifyVsock({ ...ABS, node: { ...VSOCK_NODE, uid: 1001 } }, [], 'ENODEV').state, 'unknown')
  assert.equal(R.classifyVsock({ ...ABS, node: { ...VSOCK_NODE, registered: true } }, [], 'ENODEV').state, 'unknown', 'a REGISTERED device is never absent')
  assert.equal(R.classifyVsock({ ...ABS, node: { ...VSOCK_NODE, registered: null } }, [], 'ENODEV').state, 'unknown')
  assert.equal(R.classifyVsock({ ...ABS, node: undefined }, [], 'ENODEV').state, 'unknown', 'node facts are required')
  assert.equal(R.classifyVsock({ ...ABS, dev_open: 'ENODEV' }, [], null).state, 'absent', 'the worker\'s own "no driver" answer is conclusive')
  assert.equal(R.classifyVsock({ ...ABS, dev_open: undefined }, [], 'ENODEV').state, 'unknown', 'an open that SUCCEEDED for the worker is not absent')
  // root-side outcome parsing (dash error text)
  assert.equal(R.rootOpenOutcome('sh: 1: cannot open /dev/vsock: No such device'), 'ENODEV')
  assert.equal(R.rootOpenOutcome('sh: 1: cannot open /dev/vsock: No such device or address'), 'ENXIO')
  assert.equal(R.rootOpenOutcome('ROOT_OPEN_OK'), 'opened'); assert.equal(R.rootOpenOutcome('NO_NODE'), 'no_node')
  for (const x of ['sh: 1: cannot open /dev/vsock: Permission denied', '', undefined, 'No such device extra']) assert.equal(R.rootOpenOutcome(x), 'unknown', String(x))
  assert.ok(ROOT_FACTS_CMD.includes('echo @@VSOCK;') && ROOT_FACTS_CMD.includes('(exec 3</dev/vsock)') && ROOT_FACTS_CMD.indexOf('@@VSOCK') < ROOT_FACTS_CMD.indexOf('@@END'))
  assert.equal(R.parseRootFacts(HARDENED_ROOT_TEXT).vsock_root_open, 'ENODEV')
  assert.equal(R.parseRootFacts(HARDENED_ROOT_TEXT.replace('@@VSOCK\n', '')), null, 'a missing vsock section is not evidence')
  // scenario level: goodProbe (worker EACCES + root ENODEV) passes on the hardened image; without root's answer it fails
  assert.equal(R.evalS10(goodProbe(), ctx10()).verdict, 'PASS')
  assert.ok(R.evalS10(goodProbe(), ctx10({ root: R.parseRootFacts(HARDENED_ROOT_TEXT.replace('No such device', 'Permission denied')) })).problems.includes('S10.VSOCK_PRESENT_ON_HARDENED_IMAGE'))
})

test('scenario 10 VSOCK: an inert guest-local capability is distinguished from an active host transport; unknown fails closed', () => {
  assert.equal(R.classifyVsock({ dev_node: true, node: VSOCK_NODE, dev_open: 'ENODEV', stream_socket: 'EAFNOSUPPORT' }, []).state, 'absent', 'a static, unregistered /dev/vsock node alone is not a channel')
  assert.equal(R.classifyVsock({ dev_node: false, stream_socket: 'EAFNOSUPPORT' }, []).state, 'absent')
  assert.equal(R.classifyVsock(VS_INERT, ['vsock']).state, 'inert')
  assert.equal(R.classifyVsock({ ...VS_INERT, local_cid: 1 }, ['vsock', 'vsock_loopback']).state, 'inert', 'loopback is guest-local')
  // active host transports
  assert.equal(R.classifyVsock(VS_INERT, ['vsock', 'vmw_vsock_virtio_transport']).state, 'active')
  assert.equal(R.classifyVsock({ ...VS_INERT, local_cid: 3 }, ['vsock']).state, 'active')
  for (const r of ['ECONNRESET', 'ECONNREFUSED', 'CONNECTED', 'timeout', 'ETIMEDOUT']) assert.equal(R.classifyVsock({ ...VS_INERT, connect: { ...VS_INERT.connect, '2:1024': r } }, ['vsock']).state, 'active', r)
  assert.equal(R.classifyVsock({ ...VS_INERT, dgram: 'SENT' }, ['vsock']).state, 'active')
  // inconclusive → unknown
  assert.equal(R.classifyVsock({ ...VS_INERT, connect: { ...VS_INERT.connect, '2:22': 'EPERM' } }, ['vsock']).state, 'unknown')
  assert.equal(R.classifyVsock({ ...VS_INERT, local_cid: 'ERR:ENOTTY' }, ['vsock']).state, 'unknown')
  assert.equal(R.classifyVsock({ ...VS_INERT, connect: {} }, ['vsock']).state, 'unknown')
  assert.equal(R.classifyVsock({ dev_node: true, stream_socket: 'EAFNOSUPPORT' }, []).state, 'unknown', 'a node that opens without the family is inconclusive')
  assert.equal(R.classifyVsock({ dev_node: false, stream_socket: 'EAFNOSUPPORT' }, ['vsock']).state, 'unknown')
  assert.equal(R.classifyVsock({ stream_socket: 'EPERM' }, []).state, 'unknown')
  assert.equal(R.classifyVsock(true, []).state, 'unknown', 'the run-1 boolean is not evidence')
  // scenario level: inert is acceptable to the classifier, but acceptance requires the hardened image (absent)
  assert.deepEqual(R.evalS10(withVsock(VS_INERT, ['vsock']), ctx10({ hardened: SOFT, root: R.parseRootFacts(UNHARDENED_ROOT_TEXT) })).problems, ['S10.IMAGE_NOT_HARDENED'])
  assert.match(R.evalS10(withVsock(VS_INERT, ['vsock']), ctx10({ hardened: SOFT, root: R.parseRootFacts(UNHARDENED_ROOT_TEXT) })).limitations[0], /fw_cfg entries not inspected/, 'no fw_cfg driver is recorded, not hidden')
  assert.ok(R.evalS10(withVsock(VS_INERT, ['vsock']), ctx10()).problems.includes('S10.VSOCK_PRESENT_ON_HARDENED_IMAGE'), 'a hardened image must show absent')
  assert.ok(R.evalS10(withVsock(VS_INERT, ['vsock', 'hv_sock']), ctx10({ hardened: SOFT })).problems.includes('S10.VSOCK_ACTIVE'))
  assert.ok(R.evalS10(withVsock({ ...VS_INERT, dgram: 'EIO' }, ['vsock']), ctx10({ hardened: SOFT })).problems.includes('S10.VSOCK_UNKNOWN'))
})

test('scenario 10 devices and firmware channels: only the validated argv devices; no fw_cfg opt/ entries, no SMBIOS OEM strings, root facts required', () => {
  const add = (k, v) => { const P = goodProbe(); P.s10[k] = [...P.s10[k], v]; return R.evalS10(P, ctx10()) }
  assert.ok(add('pci_devices', '0x1af4:0x1110').problems.includes('S10.PCI_DEVICE:0x1af4:0x1110'), 'ivshmem')
  assert.ok(add('pci_devices', '0x1b36:0x0011').problems.includes('S10.PCI_DEVICE:0x1b36:0x0011'), 'pvpanic')
  assert.ok(add('virtio_devices', '0x1af4:0x0003').problems.includes('S10.VIRTIO_DEVICE:0x1af4:0x0003'), 'virtio console')
  assert.ok(add('virtio_devices', '0x1af4:0x0013').problems.includes('S10.VIRTIO_DEVICE:0x1af4:0x0013'), 'virtio vsock')
  assert.ok(add('modules', '9pnet_virtio').problems.includes('S10.MODULE:9pnet_virtio'))
  // review S2: a REGISTERED channel device fails; static unregistered nodes (goodProbe has kvm, vhost-net, vhost-vsock) pass; unknown fails closed
  assert.ok(add('dev_channels', { name: 'hvc0', mode: 0o600, uid: 0, char: true, major: 229, minor: 0, registered: true }).problems.includes('S10.HOST_CHANNEL_DEVICE:hvc0'))
  assert.ok(add('dev_channels', { name: 'vhost-vsock', mode: 0o600, uid: 0, char: true, major: 10, minor: 241, registered: true }).problems.includes('S10.HOST_CHANNEL_DEVICE:vhost-vsock'))
  assert.ok(add('dev_channels', { name: 'kvm', stat_error: 'EACCES' }).problems.includes('S10.HOST_CHANNEL_DEVICE:kvm'), 'unknown registration fails closed')
  assert.ok(add('dev_channels', { name: 'vmci', char: false, registered: null }).problems.includes('S10.HOST_CHANNEL_DEVICE:vmci'), 'a non-character node is never assumed harmless')
  assert.ok(add('dev_channels', 'hvc0').problems.includes('S10.MALFORMED:dev_channels'), 'the v2 name-only shape is not evidence')
  assert.ok(add('virtio_ports', 'vport0p1').problems.includes('S10.VIRTIO_PORTS'))
  const noNet = goodProbe(); noNet.s10.virtio_devices = []; assert.ok(R.evalS10(noNet, ctx10()).problems.includes('S10.VIRTIO_POSITIVE_CONTROL'))
  const vmbus = goodProbe(); vmbus.s10.vmbus_devices = ['dev0']; assert.ok(R.evalS10(vmbus, ctx10()).problems.includes('S10.VMBUS_DEVICES'))
  assert.ok(R.evalS10(goodProbe(), ctx10({ argvProblems: ['FORBIDDEN_FLAG:-chardev'] })).problems.includes('S10.QEMU_ARGV'))
  assert.ok(R.evalS10(goodProbe(), ctx10({ argvProblems: undefined })).problems.includes('S10.QEMU_ARGV'))
  assert.ok(R.evalS10(goodProbe(), ctx10({ root: R.parseRootFacts(HARDENED_ROOT_TEXT.replace('bootorder', 'opt/io.systemd.credentials/x')) })).problems.includes('S10.FW_CFG_USER_ENTRIES'))
  assert.ok(R.evalS10(goodProbe(), ctx10({ root: R.parseRootFacts(HARDENED_ROOT_TEXT.replace('@@DMI\n0', '@@DMI\n1')) })).problems.includes('S10.SMBIOS_OEM_STRINGS'))
  assert.ok(R.evalS10(goodProbe(), ctx10({ root: null })).problems.includes('S10.ROOT_FACTS_MISSING'))
  const legacy = goodProbe(); legacy.s10.vsock = true; assert.ok(R.evalS10(legacy, ctx10()).problems.includes('S10.VSOCK_UNKNOWN'))
})

test('root facts parser and hardening detection', () => {
  const h = R.parseRootFacts(HARDENED_ROOT_TEXT)
  assert.equal(h.fw_cfg.state, 'listed'); assert.equal(h.dmi_type11, 0); assert.ok(R.hardeningInEffect(h))
  const u = R.parseRootFacts(UNHARDENED_ROOT_TEXT); assert.equal(u.fw_cfg.state, 'no_driver'); assert.equal(R.hardeningInEffect(u), false)
  assert.equal(R.parseRootFacts(HARDENED_ROOT_TEXT.replace('@@END', '')), null, 'truncated output is not evidence')
  assert.equal(R.parseRootFacts(''), null)
  assert.equal(R.parseRootFacts(HARDENED_ROOT_TEXT.replace('@@DMI\n0', '@@DMI\nNO_DMI')).dmi_type11, null, 'missing DMI is unknown, never 0')
  assert.equal(R.hardeningInEffect(R.parseRootFacts(HARDENED_ROOT_TEXT.replace('install vsock /bin/false\n', ''))), false)
  assert.equal(R.hardeningInEffect(R.parseRootFacts(HARDENED_ROOT_TEXT.replace('\nmasked\n', '\nenabled\n'))), false)
  assert.ok(ROOT_FACTS_CMD.startsWith('sudo -n sh -c ') && ROOT_FACTS_CMD.includes('@@END') && !/rm |mkfs|dd |>\s*\/(etc|sys)/.test(ROOT_FACTS_CMD), 'read-only fact collection')
})

// Under the cap the guest still charges descheduled time to the burn workers: same guest CPU seconds (≈60 = 2 × 30), about half the work.
const burn = (iterations, cpuSeconds = 59.8, busy = 99) => ({ iterations, cpu_seconds: cpuSeconds, reports: 2, busy_pct: busy, seconds: 30, workers: 2, cpus: 2 })
// Host-CPU sampling evidence for one burn (v1): one attempt per slot inside the 8–30 s window of a 40 s burn. A `null` slot is three failed attempts.
const samplingFor = (vals, { window = [8000, 30000], burnMs = 40000, burnEnded = 41000, startAt = 8500 } = {}) => ({ version: 1, slots: 3, max_attempts_per_slot: 3, window_ms: window, burn_ms: burnMs,
  burn_ended_offset_ms: burnEnded, stop_reason: vals.includes(null) ? 'ATTEMPTS_EXHAUSTED' : null,
  attempts: vals.flatMap((v, slot) => (v === null
    ? [1, 2, 3].map((attempt) => ({ slot, attempt, start_offset_ms: startAt + slot * 3500 + (attempt - 1) * 300, end_offset_ms: startAt + slot * 3500 + (attempt - 1) * 300 + 200, sampler_ms: 200, timeout_ms: 8000, error: 'COUNTER.VALUE_BLANK', exit_code: null, counter_problems: { cpu_pct: { code: 'COUNTER.VALUE_BLANK' } }, cpu_pct: null, available_mb: null, unverified_cpu_pct: null, unverified_available_mb: null, host_responsive: true, outcome: 'rejected_unmeasured' }))
    : [{ slot, attempt: 1, start_offset_ms: startAt + slot * 3500, end_offset_ms: startAt + slot * 3500 + 2100, sampler_ms: 2100, timeout_ms: 8000, error: null, exit_code: null, counter_problems: {}, cpu_pct: v, available_mb: 3000, unverified_cpu_pct: null, unverified_available_mb: null, host_responsive: true, outcome: 'accepted' }])) })
/** Set a burn's three host-CPU values and the matching, consistent sampling evidence (so a test exercises exactly the rule it names). */
const setCpu = (b, vals) => { b.hostCpuPct = vals; b.hostSampling = samplingFor(vals) }
const S9OK = { alloc: { exitCode: 137, outcome: 'oom_killed' }, qemuAliveAfterAlloc: true, qemuWorkingSetMb: 1853, memoryLimitMb: 2304, hostAvailableMbMin: 2600, hostResponsive: [true, true, true],
  cpu: { logicalCpus: 20, vcpus: 2, normal: { capPct: 40, job: { flags: 5, rate: 4000 }, burn: burn(100000), hostCpuPct: [16.2, 18, 15], hostSampling: samplingFor([16.2, 18, 15]), qemuHostCpuPct: 10.4 },
    capped: { capPct: 5, job: { flags: 5, rate: 500 }, burn: burn(51000), hostCpuPct: [12, 11, 13], hostSampling: samplingFor([12, 11, 13]), qemuHostCpuPct: 5.0 } } }
const s9 = (patch) => { const o = clone(S9OK); patch(o); return R.evalS9(o) }

test('scenario 9: the CPU hard cap must be shown ENFORCED with a binding cap, not merely recorded', () => {
  const ok = R.evalS9(S9OK); assert.equal(ok.verdict, 'PASS', ok.problems.join(','))
  assert.equal(ok.evidence.cpu.vm_cpu_demand_pct, 10); assert.equal(ok.evidence.cpu.expected_ratio_if_enforced, 0.5)
  assert.ok(s9((o) => { o.cpu.capped.burn.iterations = 98000 }).problems.includes('S9.CPU_CAP_NOT_ENFORCED'), 'throughput unchanged under the cap')
  assert.ok(s9((o) => { o.cpu.capped.capPct = 8; o.cpu.capped.job.rate = 800 }).problems.includes('S9.CPU_CAP_NOT_BINDING'))
  assert.ok(s9((o) => { o.cpu.capped.capPct = 40; o.cpu.capped.job.rate = 4000 }).problems.includes('S9.CPU_CAP_NOT_BINDING'), 'the run-1 situation: 40 % cap on a 10 % VM')
  assert.ok(s9((o) => { o.cpu.capped.job = { flags: 1, rate: 500 } }).problems.includes('S9.JOB_CPU_CAP_NOT_ATTESTED'), 'soft (non-hard) cap')
  assert.ok(s9((o) => { o.cpu.normal.job = { flags: null, rate: null } }).problems.includes('S9.JOB_CPU_CAP_NOT_ATTESTED'), 'an old supervisor record')
  assert.ok(s9((o) => { o.cpu.capped.burn.busy_pct = 30 }).problems.includes('S9.BURN_NOT_CPU_BOUND'))
  assert.ok(s9((o) => { o.cpu.normal.burn = null }).problems.includes('S9.BURN_INVALID'))
  assert.ok(s9((o) => { o.cpu.capped.burn.workers = 1 }).problems.includes('S9.BURN_INVALID'))
  assert.ok(s9((o) => { delete o.cpu }).problems.includes('S9.CPU_EVIDENCE_MISSING'))
  assert.ok(s9((o) => { o.alloc = { exitCode: 124, outcome: 'other' } }).problems.includes('S9.MEMORY_NOT_BOUNDED'), 'the timeout proves nothing')
  assert.ok(s9((o) => { o.qemuWorkingSetMb = null }).problems.includes('S9.QEMU_OVER_MEMORY_CAP'))
  assert.ok(s9((o) => { o.hostResponsive = [true, undefined] }).problems.includes('S9.HOST_NOT_RESPONSIVE'))
  assert.ok(BURN_PY.includes('time.monotonic()') && BURN_PY.includes('/proc/stat') && !BURN_PY.includes('${'), 'bounded guest-side burn')
})

test('scenario 9 confounds (review S3): guest-internal load cannot fake a drop; the host-measured QEMU share must agree with the cap', () => {
  // (a) asymmetric guest load after the second boot: fewer iterations AND fewer worker CPU-seconds → per-CPU-second rate unchanged → NOT enforced
  const guestBusy = s9((o) => { o.cpu.capped.burn = burn(60000, 35.9) })
  assert.ok(guestBusy.problems.includes('S9.CPU_CAP_NOT_ENFORCED'), 'a wall-clock drop caused inside the guest must not pass')
  assert.ok(guestBusy.evidence.cpu.wall_throughput_ratio_info <= 0.75, 'the old wall-clock rule would have passed this')
  // (b) host side: QEMU's own measured share must sit at the cap when capped, and clearly above it when not
  assert.ok(s9((o) => { o.cpu.capped.qemuHostCpuPct = 9.8 }).problems.includes('S9.QEMU_CPU_OVER_CAP'), 'throughput dropped but QEMU was not held at the cap')
  assert.equal(s9((o) => { o.cpu.capped.qemuHostCpuPct = 5 * R.S9_QEMU_CAP_SLACK + 0.5 }).verdict, 'PASS', 'slack boundary inclusive')
  assert.ok(s9((o) => { o.cpu.normal.qemuHostCpuPct = 6 }).problems.includes('S9.QEMU_NORMAL_CPU_NOT_ABOVE_CAP'), 'an uncapped VM that never demanded more than the cap proves nothing')
  for (const k of ['normal', 'capped']) assert.ok(s9((o) => { o.cpu[k].qemuHostCpuPct = null }).problems.includes('S9.QEMU_HOST_CPU_UNMEASURED'), k)
  // every burn worker must report its own CPU time
  assert.ok(s9((o) => { o.cpu.capped.burn.reports = 1 }).problems.includes('S9.BURN_INVALID'))
  assert.ok(s9((o) => { o.cpu.normal.burn.cpu_seconds = 0 }).problems.includes('S9.BURN_INVALID'))
  assert.ok(BURN_PY.includes('os.times()') && BURN_PY.includes('"cpu_seconds"') && BURN_PY.includes('"reports"'))
  assert.ok(BURN_SECONDS >= 30 && BURN_WINDOW_S[0] >= 5 && BURN_WINDOW_S[1] <= BURN_SECONDS - 4, 'the QEMU window lies strictly inside the burn')
})

test('scenario 9 validity: host contention, a wrong guest CPU count, a dead QEMU or unsampled host memory void the result', () => {
  // A slower capped burn on a saturated host could be contention, not the cap: never counted as enforcement. Every sample counts.
  assert.ok(s9((o) => { setCpu(o.cpu.capped, [12, 95, 12]) }).problems.includes('S9.HOST_CPU_CONTENDED'))
  assert.ok(s9((o) => { setCpu(o.cpu.normal, [R.S9_MAX_HOST_CPU_PCT + 0.1, 10, 10]) }).problems.includes('S9.HOST_CPU_CONTENDED'))
  assert.ok(s9((o) => { setCpu(o.cpu.capped, [12, null, 12]) }).problems.includes('S9.HOST_CPU_CONTENDED'), 'an unmeasured host is not an idle host')
  assert.ok(s9((o) => { o.cpu.capped.hostCpuPct = [12, null, 12] }).problems.includes('S9.HOST_CPU_CONTENDED'), 'a null value is rejected whatever the evidence says')
  assert.ok(s9((o) => { o.cpu.capped.hostCpuPct = [12] }).problems.includes('S9.HOST_CPU_CONTENDED'), 'one sample is not enough')
  assert.ok(s9((o) => { o.cpu.capped.hostCpuPct = 12 }).problems.includes('S9.HOST_CPU_CONTENDED'))
  assert.equal(s9((o) => { setCpu(o.cpu.capped, [R.S9_MAX_HOST_CPU_PCT, 1, 1]) }).verdict, 'PASS', 'boundary is inclusive')
  // The guest must really have the VM's vCPUs (its own affinity count, not the argv echo).
  assert.ok(s9((o) => { o.cpu.capped.burn.cpus = 1 }).problems.includes('S9.BURN_INVALID'))
  assert.ok(s9((o) => { delete o.cpu.normal.burn.cpus }).problems.includes('S9.BURN_INVALID'))
  // The guest OOM killer, not a host-side QEMU death, must have ended the allocation.
  assert.ok(s9((o) => { o.qemuAliveAfterAlloc = false }).problems.includes('S9.QEMU_NOT_ALIVE_AFTER_ALLOC'))
  assert.ok(s9((o) => { delete o.qemuAliveAfterAlloc }).problems.includes('S9.QEMU_NOT_ALIVE_AFTER_ALLOC'))
  assert.ok(s9((o) => { o.hostAvailableMbMin = null }).problems.includes('S9.HOST_MEMORY_LOW'))
  assert.ok(s9((o) => { o.hostAvailableMbMin = 900 }).problems.includes('S9.HOST_MEMORY_LOW'))
  const ev = R.evalS9(S9OK).evidence
  assert.match(ev.host_memory_sampled_at, /not during the allocation itself/, 'the evidence states when memory was really sampled')
  assert.deepEqual(ev.cpu.capped.host_cpu_pct_samples, [12, 11, 13]); assert.equal(ev.qemu_alive_after_alloc, true)
  assert.ok(BURN_PY.includes('os.sched_getaffinity(0)'))
})

const PLANTED_ALL = `${R.S13_PLANTED.map((k) => `PLANTED:${k}`).join('\n')}\nHARDLINK_REFUSED\nPLANT_CHECKED\n`
test('scenario 13 positive control: "no residue" counts only when every item was really planted before the discard', () => {
  const sums = `${'1'.repeat(64)}\n${'2'.repeat(64)}`
  const good = { plantedOut: PLANTED_ALL, afterOut: 'MARKER\n{"oauthAccount": "uid=1001(worker)"}\nCHECKED\n', bashrcBefore: sums, bashrcAfter: sums, goldenReadOnly: true }
  const ok = R.evalS13(good); assert.equal(ok.verdict, 'PASS', ok.problems.join(','))
  assert.equal(ok.evidence.hardlink_to_root_file, 'refused'); assert.deepEqual(ok.evidence.plants_missing, [])
  for (const k of R.S13_PLANTED) assert.ok(R.evalS13({ ...good, plantedOut: PLANTED_ALL.replace(`PLANTED:${k}\n`, '') }).problems.includes('S13.PLANT_NOT_VERIFIED'), `missing plant ${k} passed vacuously`)
  assert.ok(R.evalS13({ ...good, plantedOut: PLANTED_ALL.replace('PLANT_CHECKED\n', '') }).problems.includes('S13.PLANT_NOT_VERIFIED'), 'truncated plant check')
  assert.ok(R.evalS13({ ...good, plantedOut: undefined }).problems.includes('S13.PLANT_NOT_VERIFIED'))
  assert.ok(R.evalS13({ ...good, plantedOut: 'PLANTED:task_residue_extra\nPLANT_CHECKED\n' }).problems.includes('S13.PLANT_NOT_VERIFIED'), 'prefix matches do not count')
  assert.equal(R.evalS13({ ...good, plantedOut: PLANTED_ALL.replace('HARDLINK_REFUSED\n', '') }).evidence.hardlink_to_root_file, 'created', 'recorded, not required')
  // The plant check names exactly the planted items, runs as the worker and is read-only.
  for (const k of R.S13_PLANTED) assert.ok(PLANT_CHECK_CMD.includes(`echo PLANTED:${k};`), k)
  assert.ok(PLANT_CHECK_CMD.startsWith('sudo -u worker -H env -i ') && PLANT_CHECK_CMD.includes('echo PLANT_CHECKED') && !/\b(rm|mv|ln|mkfifo|dd)\b|>/.test(PLANT_CHECK_CMD.replace(/2>\/dev\/null/g, '')))
})

test('evidence identity: the closure digest uses the pin tool\'s exact rule and covers exactly the pinned closure', async () => {
  const { contentDigest } = await import('../../developer-harness-v2/bypass-digest.mjs')
  const id = closureIdentity()
  assert.ok(id.files && /^[0-9a-f]{64}$/.test(id.digest), id.error)
  const keys = Object.keys(id.files)
  assert.ok(keys.includes('scripts/developer-harness-v3/isolation/acceptance-rules.mjs') && keys.includes('docs/developer-harness-v3/authority-contract.json') && keys.includes('docs/developer-harness-v3/task-lifecycle.json'))
  assert.ok(!keys.some((k) => k.startsWith('scripts/developer-harness-v3/tests/')), 'tests are outside the closure')
  assert.ok(keys.every((k) => k.startsWith('scripts/developer-harness-v3/') || k.startsWith('docs/developer-harness-v3/')))
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..')
  for (const k of keys) assert.equal(id.files[k], contentDigest(readFileSync(path.join(root, k))), k)
  // CRLF normalisation is byte-exact (non-ASCII content such as em-dashes must hash like the pin tool, not via a utf8 re-encode)
  const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-cl-'))
  try {
    for (const p of ['scripts/developer-harness-v3/x', 'scripts/developer-harness-v3/tests', 'docs/developer-harness-v3']) mkdirSync(path.join(d, p), { recursive: true })
    const bytes = Buffer.from('a — b\r\nc\n', 'utf8')
    writeFileSync(path.join(d, 'scripts/developer-harness-v3/x/f.mjs'), bytes); writeFileSync(path.join(d, 'scripts/developer-harness-v3/tests/t.mjs'), 'x')
    const t = closureIdentity(d)
    assert.equal(t.files['scripts/developer-harness-v3/x/f.mjs'], contentDigest(bytes))
    assert.equal(t.files['docs/developer-harness-v3/authority-contract.json'], 'MISSING', 'a missing contract file is recorded, never skipped')
    assert.equal(t.file_count, 3)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('PE fixture positive control: Windows itself runs the fixture and it exits 0 — off Windows the host CANNOT provide the control, so isolation acceptance fails closed (never skipped)', () => {
  // D3.6 Linux compatibility: before, this test was SKIPPED off Windows (the V3 runner forbids skips). The positive control is a WINDOWS-host fact: elsewhere the fixture
  // cannot run natively, acceptance records host_run as NOT_WINDOWS, and the S2 rule refuses isolation acceptance (S2.FIXTURE_NOT_RUNNABLE_ON_HOST).
  assert.deepEqual(validatePeFixture(PE), [], 'the fixture is a structurally valid PE image on every platform')
  if (process.platform !== 'win32') {
    const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-pe-test-'))
    try {
      const f = path.join(d, 'dh3fixture.exe'); writeFileSync(f, PE, { mode: 0o755 })
      const r = spawnSync(f, [], { timeout: 15000, env: {} }); assert.ok(r.error || r.status !== 0, `a ${process.platform} host does not run a PE image natively`)
    } finally { rmSync(d, { recursive: true, force: true }) }
    assert.ok(R.evalS2(goodProbe(), ctx2({ hostRun: { rc: null, error: 'NOT_WINDOWS' } })).problems.includes('S2.FIXTURE_NOT_RUNNABLE_ON_HOST'), 'without the host control, isolation acceptance is refused')
    return
  }
  const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-pe-test-'))
  try {
    const f = path.join(d, 'dh3fixture.exe'); writeFileSync(f, PE)
    const r = spawnSync(f, [], { timeout: 15000, windowsHide: true, env: { SYSTEMROOT: process.env.SYSTEMROOT } })
    assert.equal(r.error?.code ?? null, null, `host refused the fixture: ${r.error?.code}`)
    assert.equal(r.status, 0)
  } finally { try { rmSync(d, { recursive: true, force: true }) } catch { /* scanner may hold it briefly */ } }
})

test('scenarios 8, 11, 12, 13: positive and negative cases; 12 states it covers host-side integrity and NOT evaluator binding', () => {
  assert.equal(R.evalS8({ ddExit: 1, enospc: true, rootBytes: 25149710336, taskVirtualSize: 24 * 1073741824, authDiskBytes: 2424832 }).verdict, 'PASS')
  assert.equal(R.evalS8({ ddExit: 0, enospc: false, rootBytes: 25149710336, taskVirtualSize: 24 * 1073741824, authDiskBytes: 2424832 }).verdict, 'FAIL')
  assert.equal(R.evalS11(goodProbe(), { guestShiftMs: 24 * 3600000, hostDeltaMs: 120 }).verdict, 'PASS')
  const P = goodProbe(); P.s11.worker_date_s_rc = 0; assert.equal(R.evalS11(P, { guestShiftMs: 24 * 3600000, hostDeltaMs: 120 }).verdict, 'FAIL')
  assert.equal(R.evalS11(goodProbe(), { guestShiftMs: NaN, hostDeltaMs: 120 }).verdict, 'FAIL')
  const tree = 'a'.repeat(40)
  const s12 = R.evalS12({ imported: { ok: true, tree }, claimedTree: tree, forgedTree: 'b'.repeat(40), redirectCode: 'BUNDLE.BAD_HEADER' })
  assert.equal(s12.verdict, 'PASS'); assert.match(s12.evidence.scope, /host-side artifact integrity/); assert.match(s12.evidence.evaluator_evidence_binding, /^NOT_TESTED/)
  assert.equal(R.evalS12({ imported: { ok: true, tree }, claimedTree: tree, forgedTree: tree, redirectCode: 'BUNDLE.BAD_HEADER' }).verdict, 'FAIL')
  assert.equal(R.evalS12({ imported: { ok: true, tree }, claimedTree: tree, forgedTree: '', redirectCode: 'BUNDLE.BAD_HEADER' }).verdict, 'FAIL', 'no forged claim = no negative test')
  const sums = `${'1'.repeat(64)}\n${'2'.repeat(64)}`
  const good = { plantedOut: `${R.S13_PLANTED.map((k) => `PLANTED:${k}`).join('\n')}\nPLANT_CHECKED\n`, afterOut: 'MARKER\n{"oauthAccount": "uid=1001(worker)"}\nCHECKED\n', bashrcBefore: sums, bashrcAfter: sums, goldenReadOnly: true }
  assert.equal(R.evalS13(good).verdict, 'PASS')
  assert.ok(R.evalS13({ ...good, afterOut: 'MARKER\n\nCHECKED\n' }).problems.includes('S13.JSON_ALLOWLIST_NOT_APPLIED'), 'an unreadable file must not count as "dropped"')
  assert.ok(R.evalS13({ ...good, afterOut: 'PRESENT:/home/worker/.residue\nMARKER\n{"oauthAccount":1}\nCHECKED\n' }).problems.includes('S13.RESIDUE'))
  assert.ok(R.evalS13({ ...good, bashrcBefore: '', bashrcAfter: '' }).problems.includes('S13.ROOT_TARGETS_CHANGED'))
})

test('evidence persistence: the previous run is archived byte-for-byte before the latest pointer is replaced; a run file is never overwritten', () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-ev-'))
  try {
    const run1 = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..', 'docs', 'developer-harness-v3', 'evidence', 'isolation-acceptance-run1-20261124T233915Z.json')
    const bytes = readFileSync(run1)
    writeFileSync(path.join(d, 'isolation-acceptance.json'), bytes)
    const doc = { schema: 'patelrep.developer-harness-v3.isolation-acceptance', started_at: '2026-11-25T01:02:03.456Z', verdict: 'PASS' }
    persistAcceptance(d, doc)
    assert.ok(readFileSync(path.join(d, 'runs', 'isolation-acceptance-20261124T233915Z.json')).equals(bytes), 'run 1 archived unchanged')
    assert.equal(JSON.parse(readFileSync(path.join(d, 'isolation-acceptance.json'), 'utf8')).started_at, doc.started_at)
    const first = readFileSync(path.join(d, 'runs', runName(doc.started_at)))
    // review nit: two runs in the same second (e.g. fast NOT_RUN) — the second gets a suffix; nothing is overwritten or lost
    persistAcceptance(d, { ...doc, verdict: 'NOT_RUN' })
    assert.ok(readFileSync(path.join(d, 'runs', runName(doc.started_at))).equals(first), 'the first run file is untouched')
    assert.equal(JSON.parse(readFileSync(path.join(d, 'runs', runName(doc.started_at).replace('.json', '-2.json')), 'utf8')).verdict, 'NOT_RUN')
    assert.ok(readFileSync(path.join(d, 'runs', 'isolation-acceptance-20261124T233915Z.json')).equals(bytes))
    persistAcceptance(d, { ...doc, started_at: '2026-11-25T02:00:00.000Z' })
    assert.equal(readdirSync(path.join(d, 'runs')).length, 4)
    assert.equal(runName('2026-11-24T23:39:15.094Z'), 'isolation-acceptance-20261124T233915Z.json')
    // a crafted started_at never becomes a path
    for (const bad of ['../../x', '2026-11-25T01:02:03Z/../../y', 'C:\\x', null]) assert.throws(() => persistAcceptance(d, { ...doc, started_at: bad }), /EVIDENCE.BAD_STARTED_AT/, String(bad))
    writeFileSync(path.join(d, 'isolation-acceptance.json'), JSON.stringify({ schema: doc.schema, started_at: '../../../evil' }))
    persistAcceptance(d, { ...doc, started_at: '2026-11-25T03:00:00.000Z' })
    assert.ok(readdirSync(path.join(d, 'runs')).some((f) => f.startsWith('isolation-acceptance-unparsed-')), 'an invalid previous latest is archived under a fixed name')
    assert.ok(!existsSync(path.join(d, '..', 'evil.json')) && !readdirSync(d).some((f) => f.includes('evil')))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('trusted provisioning disables the host-channel modules and binfmt_misc, and the provision script verifies both (fail closed)', () => {
  for (const m of HARDENING_MODULES) assert.ok(MODPROBE_HARDENING.includes(`install ${m} /bin/false\n`), m)
  assert.deepEqual(R.HARDENING_INSTALLS, HARDENING_MODULES)
  const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAASYNTHETIC\n-----END OPENSSH PRIVATE KEY-----\n'
  const ud = buildUserData({ name: 'dh3-w1', controllerPublicKey: 'ssh-ed25519 AAAAC3Nza dh3-controller', hostKeyPrivate: KEY, hostKeyPublic: 'ssh-ed25519 AAAAhost dh3-guest-host' })
  assert.ok(ud.includes(`- path: ${GUEST_HARDENING.modprobe_file}`) && ud.includes('install vsock /bin/false') && ud.includes('install binfmt_misc /bin/false'))
  assert.ok(ud.includes(`  - [ systemctl, mask, ${MASKED_UNITS.join(', ')} ]`))
  const s = buildProvisionScript({ claudeSha512Hex: 'a'.repeat(128), claudeVersion: '2.1.331' })
  assert.ok(s.includes('modcfg="$(modprobe -c)"') && s.includes('grep -qx "install $m /bin/false" <<<"$modcfg"') && s.includes('= masked'))
  assert.ok(s.indexOf('= masked') < s.indexOf('touch /etc/cloud/cloud-init.disabled'), 'verified before the image is sealed')
  assert.equal(GUEST_HARDENING.vsock_disabled && GUEST_HARDENING.binfmt_disabled, true)
})

test('review S6: the guest\'s proxy claims (scenarios 4, 5) must be corroborated by the HOST proxy decision log', () => {
  const P = goodProbe()
  assert.deepEqual(R.corroborateProxy(P, LOG).problems, [])
  assert.deepEqual(R.corroborateProxy(P, LOG).evidence, { guest_claimed_denials: 9, host_denials: 9, guest_claimed_tunnels: 1, host_allows: ['api.anthropic.com'] })
  // a lying guest that never sent the CONNECTs: the host saw nothing
  for (const n of [4, 5]) { const r = n === 4 ? R.evalS4(P, { targets: T, proxyLog: [] }) : R.evalS5(P, { proxyLog: [] }); assert.ok(r.problems.includes(`S${n}.PROXY_DENIALS_NOT_CORROBORATED`) && r.problems.includes(`S${n}.PROXY_ALLOW_NOT_CORROBORATED`), String(n)) }
  assert.ok(R.evalS5(P, { proxyLog: LOG.slice(1) }).problems.includes('S5.PROXY_DENIALS_NOT_CORROBORATED'), 'one claimed denial short')
  assert.ok(R.evalS5(P, { proxyLog: [...LOG, { allow: true, code: 'EGRESS.CLOSED', host: 'example.com' }] }).problems.includes('S5.PROXY_ALLOWED_OFF_LIST'), 'the host allowed an off-list host')
  assert.ok(R.evalS5(P, { proxyLog: [...LOG, { allow: true, code: 'X', host: null }] }).problems.includes('S5.PROXY_ALLOWED_OFF_LIST'))
  assert.equal(R.evalS5(P, { proxyLog: [...LOG, { allow: false, code: 'EGRESS.HOST_NOT_ALLOWLISTED', host: 'deb.debian.org' }] }).verdict, 'PASS', 'extra host denials (guest background) are tolerated')
  for (const bad of [undefined, null, 'x', [{ allow: 'yes' }]]) { assert.ok(R.evalS4(P, { targets: T, proxyLog: bad }).problems.includes('S4.PROXY_LOG_MISSING')); assert.ok(R.evalS5(P, { proxyLog: bad }).problems.includes('S5.PROXY_LOG_MISSING')) }
})

test('guest probe v3 reports raw facts (errno names, raw kernel text, device registration) and has exactly the expected placeholders', () => {
  const src = readFileSync(new URL('../isolation/guest-probe.py', import.meta.url), 'utf8')
  assert.equal(src.split('@@TARGETS@@').length, 2); assert.equal(src.split('@@PE_B64@@').length, 2)
  assert.ok(src.includes('"probe_version": 3') && src.includes('R["complete"] = True') && R.PROBE_VERSION === 3)
  assert.ok(src.includes('/sys/dev/char/%d:%d') && src.includes('"registered"') && src.includes('STD_BIN_DIRS'))
  assert.ok(src.includes('errno.errorcode') && src.includes('0x7B9') && src.includes('AF_VSOCK'))
  assert.ok(!src.includes('s2_pe_exec') && src.includes('{"ran": False, "errno": en(e)}'), 'exec results carry the errno name, not the exception class (run-1 "OSError")')
  assert.ok(src.includes('return errno.errorcode.get(n, "E?%s" % n) if isinstance(n, int)'), 'class name only when there is no errno at all')
})
