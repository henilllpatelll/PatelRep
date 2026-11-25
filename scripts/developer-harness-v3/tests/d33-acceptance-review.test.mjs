// D3.3 isolation acceptance: regression tests for the security-review findings (B1, S4, S5, S7, N1, N3) that need no probe fixtures.
// Split from d33-acceptance.test.mjs to keep both files under the 500-line limit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as R from '../isolation/acceptance-rules.mjs'
import { candidateIdentity, closureDiffFromTree, closureIdentity, gitBlobId, makeMasker, maskDoc } from '../isolation/acceptance.mjs'
import { HOST_TOOLS, hostTool, SSH } from '../runtime/vm-controller.mjs'
import { buildProvisionScript, HARDENING_MODULES } from '../infra/cloud-init.mjs'

test('evidence privacy (review S5): private host addresses are masked everywhere in the persisted document, slirp addresses are kept', () => {
  const doc = { scenarios: { 3: { problems: ['S3.HOST_TCP.UNKNOWN_OUTCOME:192.168.1.5:445', 'S3.HOST_TCP.REACHED:10.20.30.40:22'], evidence: { host_tcp: { '172.20.1.2:22': 'ECONNREFUSED' } } } },
    probe_error: 'connect 192.168.7.9 failed', keep: ['10.0.2.2:22', '10.0.2.4', 'qemu 11.1.3', 'a'.repeat(64)] }
  const m = maskDoc(doc); const s = JSON.stringify(m)
  for (const ip of ['192.168.1.5', '10.20.30.40', '172.20.1.2', '192.168.7.9']) assert.ok(!s.includes(ip), ip)
  assert.deepEqual(m.keep, doc.keep)
  assert.deepEqual(m.scenarios[3].problems, ['S3.HOST_TCP.UNKNOWN_OUTCOME:192.x.x.x#1:445', 'S3.HOST_TCP.REACHED:10.x.x.x#2:22'])
  // review N3: distinct addresses never collapse into one key (which would silently drop evidence entries); the same address keeps its index
  const k = maskDoc({ m: { '172.17.0.1:22': 'timeout', '172.26.0.1:22': 'ECONNREFUSED', '192.168.65.1:22': 'x', '192.168.65.3:22': 'y' }, again: '172.17.0.1' })
  assert.equal(Object.keys(k.m).length, 4); assert.equal(k.m['172.x.x.x#1:22'], 'timeout'); assert.equal(k.m['172.x.x.x#2:22'], 'ECONNREFUSED'); assert.equal(k.again, '172.x.x.x#1')
  const shared = makeMasker(); assert.equal(shared('10.9.9.9'), '10.x.x.x#1'); assert.equal(maskDoc({ a: '10.9.9.9' }, shared).a, '10.x.x.x#1', 'one numbering for log and file')
})

test('review N1: closure-vs-HEAD is decided in-process from object ids (no `git status`, no filters, no shared config path)', () => {
  const GITX = 'C:\\Program Files\\Git\\cmd\\git.exe'
  assert.equal(gitBlobId(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a', 'git hash-object of "hello\\n"')
  const ls = '100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tscripts/developer-harness-v3/a.mjs\n100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tscripts/developer-harness-v3/b.mjs\n100644 blob cccccccccccccccccccccccccccccccccccccccc\tscripts/developer-harness-v3/tests/t.mjs\n'
  assert.deepEqual(closureDiffFromTree({ 'scripts/developer-harness-v3/a.mjs': 'a'.repeat(40), 'scripts/developer-harness-v3/b.mjs': 'b'.repeat(40) }, ls), [])
  assert.deepEqual(closureDiffFromTree({ 'scripts/developer-harness-v3/a.mjs': 'f'.repeat(40), 'scripts/developer-harness-v3/new.mjs': 'e'.repeat(40) }, ls),
    ['scripts/developer-harness-v3/a.mjs', 'scripts/developer-harness-v3/b.mjs', 'scripts/developer-harness-v3/new.mjs'], 'changed, removed and added are all reported; tests/ is outside')
  const acc = readFileSync(new URL('../isolation/acceptance.mjs', import.meta.url), 'utf8')
  const fn = acc.slice(acc.indexOf('export function candidateIdentity('), acc.indexOf('/** Positive control'))
  assert.ok(!/'status'/.test(fn) && fn.includes("mkdtempSync(path.join(os.tmpdir(), 'dh3-git-'))") && !fn.includes('dh3-no-global-gitconfig'))
  if (!existsSync(GITX)) return
  // end to end in a throwaway repository: commit a closure, then modify one file and add one
  const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-cand-'))
  try {
    const env = { SYSTEMROOT: process.env.SYSTEMROOT, PATH: `${path.dirname(GITX)};${process.env.SYSTEMROOT}\\System32`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(d, 'nogc'), HOME: d }
    const g = (...a) => { const r = spawnSync(GITX, ['-c', 'core.autocrlf=false', '-C', d, ...a], { env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout }
    for (const p of ['scripts/developer-harness-v3/x', 'scripts/developer-harness-v3/tests', 'docs/developer-harness-v3']) mkdirSync(path.join(d, p), { recursive: true })
    writeFileSync(path.join(d, 'scripts/developer-harness-v3/x/a.mjs'), 'a \u2014 1\n'); writeFileSync(path.join(d, 'scripts/developer-harness-v3/x/b.mjs'), 'b\n')
    writeFileSync(path.join(d, 'scripts/developer-harness-v3/tests/t.mjs'), 't\n')
    for (const f of ['authority-contract.json', 'task-lifecycle.json']) writeFileSync(path.join(d, 'docs/developer-harness-v3', f), '{}\n')
    g('init', '-q'); g('add', '-A'); g('-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '-m', 'c')
    const clean = candidateIdentity(d)
    assert.equal(clean.git_head, g('rev-parse', 'HEAD').trim()); assert.equal(clean.closure_differs_from_head, false, JSON.stringify(clean.closure_paths_differing_from_head))
    writeFileSync(path.join(d, 'scripts/developer-harness-v3/x/a.mjs'), 'a \u2014 1\r\n') // CRLF only: same LF-normalised content → not a change
    assert.equal(candidateIdentity(d).closure_differs_from_head, false)
    writeFileSync(path.join(d, 'scripts/developer-harness-v3/x/b.mjs'), 'B\n'); writeFileSync(path.join(d, 'scripts/developer-harness-v3/x/new.mjs'), 'n\n'); writeFileSync(path.join(d, 'scripts/developer-harness-v3/tests/t.mjs'), 'T\n')
    assert.deepEqual(candidateIdentity(d).closure_paths_differing_from_head, ['scripts/developer-harness-v3/x/b.mjs', 'scripts/developer-harness-v3/x/new.mjs'])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('review B1: the provision verification really runs under `set -euo pipefail` with a huge `modprobe -c` (the old pipe form aborts)', { skip: !existsSync('C:\\Program Files\\Git\\bin\\bash.exe') && process.platform === 'win32' && 'bash not available' }, () => {
  const s = buildProvisionScript({ claudeSha512Hex: 'a'.repeat(128), claudeVersion: '2.1.331' })
  const block = s.slice(s.indexOf('# Host-channel hardening'), s.indexOf('touch /etc/cloud/cloud-init.disabled'))
  assert.ok(!/modprobe -c \|/.test(s), 'no `modprobe -c |` pipe left anywhere in the provision script')
  // fakes: modprobe -c prints the hardening first, then ~6 MB of alias lines (like kmod's index dump); systemctl reports `masked`
  const fakes = `modprobe() { printf '%s\\n' ${HARDENING_MODULES.map((m) => `'install ${m} /bin/false'`).join(' ')}; awk 'BEGIN{for(i=0;i<200000;i++) print "alias pci:v0000" i "d* some_module_name"}'; }\nsystemctl() { echo masked; }\n`
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash'
  const runIt = (body) => spawnSync(bash, ['-c', `set -euo pipefail\n${fakes}${body}\necho VERIFIED_OK`], { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } })
  const now = runIt(block)
  assert.equal(now.status, 0, now.stderr); assert.match(now.stdout, /VERIFIED_OK/)
  const old = runIt(`for m in ${HARDENING_MODULES.join(' ')}; do modprobe -c | grep -qx "install $m /bin/false"; done`)
  assert.notEqual(old.status, 0, 'the reviewed defect reproduces: SIGPIPE + pipefail aborts the old form'); assert.doesNotMatch(old.stdout, /VERIFIED_OK/)
  // and the new form still FAILS CLOSED when a refusal is missing
  const missing = spawnSync(bash, ['-c', `set -euo pipefail\nmodprobe() { echo 'install vsock /bin/false'; }\nsystemctl() { echo masked; }\n${block}\necho VERIFIED_OK`], { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH } })
  assert.notEqual(missing.status, 0); assert.doesNotMatch(missing.stdout, /VERIFIED_OK/)
})

test('provisioning record lifecycle: a re-provision invalidates the old record first; only a sealed golden image boots', () => {
  const src = readFileSync(new URL('../infra/provision.mjs', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export async function provision('), src.indexOf('export function streamSha256'))
  const inval = body.indexOf('rmSync(path.join(W.dir, PROVISIONED), { force: true })')
  assert.ok(inval > 0 && inval < body.indexOf('chmodSync(W.golden, 0o644)') && inval < body.indexOf('createOverlay(L, W.golden'), 'invalidated before the golden image is made writable or rebuilt')
  assert.ok(body.lastIndexOf('atomicWriteJson(path.join(W.dir, PROVISIONED)') > body.indexOf("stop.method !== 'guest_poweroff'"), 'rewritten only after a clean seal')
  const start = src.slice(src.indexOf('export async function startTaskWorker('))
  assert.ok(start.indexOf("'WORKER.GOLDEN_NOT_SEALED'") > 0 && start.indexOf("'WORKER.GOLDEN_NOT_SEALED'") < start.indexOf('createOverlay('), 'start refuses a writable golden image')
})

test('review S7: doctor counts a PASS only for the current probe version, golden image and trusted code', () => {
  const scenarios = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i + 1, { verdict: 'PASS', problems: [], evidence: {} }]))
  const doc = { schema: R.ACCEPTANCE_SCHEMA, started_at: '2026-11-25T07:35:35.961Z', verdict: 'PASS', probe_version: R.PROBE_VERSION, scenarios,
    identity: { vm_image: { golden_sha256_now: 'e'.repeat(64) }, candidate: { closure: { digest: 'c'.repeat(64) } } } }
  const prov = { golden_sha256: 'e'.repeat(64) }
  assert.deepEqual(R.acceptanceStatus(doc, prov, 'c'.repeat(64)), { current: true, status: 'PASS', reasons: [] })
  assert.deepEqual(R.acceptanceStatus({ ...doc, probe_version: 2 }, prov, 'c'.repeat(64)).reasons, ['PROBE_VERSION'])
  assert.deepEqual(R.acceptanceStatus(doc, { golden_sha256: 'b'.repeat(64) }, 'c'.repeat(64)).reasons, ['GOLDEN_IMAGE_CHANGED'], 're-provisioned since the run')
  // review A4: digests must be well-formed sha256 hex; two empty (or non-hex) strings never "match"
  assert.deepEqual(R.acceptanceStatus({ ...doc, identity: { vm_image: { golden_sha256_now: '' }, candidate: { closure: { digest: '' } } } }, { golden_sha256: '' }, '').reasons, ['GOLDEN_IMAGE_CHANGED', 'TRUSTED_CODE_CHANGED'])
  assert.deepEqual(R.acceptanceStatus(doc, null, 'c'.repeat(64)).reasons, ['GOLDEN_IMAGE_CHANGED'])
  assert.deepEqual(R.acceptanceStatus(doc, prov, 'd'.repeat(64)).reasons, ['TRUSTED_CODE_CHANGED'])
  assert.equal(R.acceptanceStatus(doc, prov, null).current, false)
  assert.equal(R.acceptanceStatus({ ...doc, verdict: 'FAIL' }, prov, 'c'.repeat(64)).status, 'FAIL'); assert.equal(R.acceptanceStatus(null, prov, 'x').status, 'NOT_RUN')
  assert.equal(R.acceptanceStatus({ verdict: 'PASS' }, prov, 'c'.repeat(64)).current, false, 'a run-1 style document is never current')
  const dh3 = readFileSync(new URL('../bin/dh3.mjs', import.meta.url), 'utf8')
  assert.ok(dh3.includes("add(st.current, 'ISOLATION.ACCEPTANCE'") && !dh3.includes("iso.value.verdict === 'PASS', 'ISOLATION.ACCEPTANCE'"))
})

test('review S4: host tools resolve only to absolute system paths (never from the agent-writable current directory)', () => {
  for (const [k, v] of Object.entries(HOST_TOOLS)) { assert.match(v, /^[A-Za-z]:\\.*\\System32\\/i, k); assert.equal(hostTool(k), v) }
  assert.equal(SSH, HOST_TOOLS.ssh); assert.match(SSH, /\\System32\\OpenSSH\\ssh\.exe$/)
  for (const bad of ['git', 'cmd', 'node', 'qemu-system-x86_64', 'constructor', '__proto__', 'toString']) assert.throws(() => hostTool(bad), /HOST.TOOL_NOT_PINNED/, bad)
  assert.equal(hostTool('C:\\x\\y.exe'), 'C:\\x\\y.exe', 'absolute paths pass through unchanged')
  // no bare spawn of ssh/git/tasklist/typeperf anywhere in the trusted closure
  const files = Object.keys(closureIdentity().files).filter((f) => f.endsWith('.mjs'))
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..')
  for (const f of files) {
    const src = readFileSync(path.join(root, f), 'utf8')
    assert.ok(!/\bspawn(Sync)?\(\s*'(ssh|ssh-keygen|git|tasklist|typeperf|taskkill|powercfg)'/.test(src), `bare spawn in ${f}`)
  }
  const sampler = readFileSync(path.join(root, 'scripts/developer-harness-v3/runtime/host-sampler.mjs'), 'utf8')
  assert.ok(sampler.includes('SAMPLER_TOOLS[name]') && sampler.includes("'SAMPLER.TOOL_NOT_PINNED'"))
  const acc = readFileSync(path.join(root, 'scripts/developer-harness-v3/isolation/acceptance.mjs'), 'utf8')
  assert.ok(acc.includes("spawnSync(GIT, ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath='") && acc.includes("GIT_CONFIG_NOSYSTEM: '1'"))
})

test('acceptance refuses to run scenario 13 over a real Claude login (it would destroy the credentials)', () => {
  const acc = readFileSync(new URL('../isolation/acceptance.mjs', import.meta.url), 'utf8')
  const guard = acc.indexOf("'WORKER.AUTH_DISK_HAS_CREDENTIALS")
  assert.ok(guard > 0 && acc.includes('/home/worker/.claude/.credentials.json') && acc.includes('NO_CREDENTIALS$/m.test(login)'))
  assert.ok(guard < acc.indexOf('PLANT_CHECK_CMD).out') && guard < acc.indexOf("python3 -I -`, { input: script"), 'checked before the probe and before anything is planted')
})
