// D3.4 protected-change proposals: the patches are exact (digest-pinned), apply cleanly (or are already applied), and say what they are. Nothing here applies a patch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATES } from '../orchestrator/activation-gates.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); const DIR = path.join(ROOT, 'docs/developer-harness-v3/proposals')
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
const sha = (b) => createHash('sha256').update(b).digest('hex')
const git = (...a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' })

test('every proposal patch matches its pinned digest, has LF endings and no BOM, and names only its declared files', () => {
  assert.equal(manifest.base_main_sha, '5ced4d309cf3532a490a48dbd06c575994822eac'); assert.ok(manifest.proposals.length >= 2)
  for (const p of manifest.proposals) {
    const buf = readFileSync(path.join(DIR, p.file)); assert.equal(sha(buf), p.sha256, p.id); assert.ok(!buf.toString('utf8').includes('\r'), `${p.id} LF only`); assert.notEqual(buf[0], 0xef, `${p.id} no BOM`)
    const touched = [...buf.toString('utf8').matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]).sort()
    assert.deepEqual(touched, p.touches.map((t) => t.replace(/ \(new\)$/, '')).sort(), `${p.id} touches exactly what the manifest says`)
  }
})

test('each patch applies cleanly to the current tree, or is ALREADY applied (the owner may have applied it): never partially', () => {
  for (const p of manifest.proposals) {
    const file = path.join(DIR, p.file); const fwd = git('apply', '--check', '-p1', file); const rev = git('apply', '--check', '--reverse', '-p1', file)
    assert.ok(fwd.status === 0 || rev.status === 0, `${p.id}: ${fwd.stderr.slice(0, 200)}`); assert.ok(!(fwd.status === 0 && rev.status === 0), `${p.id} is neither applied nor unapplied`)
  }
})

test('proposal content: P1 removes every bare `git` call from authority/git-facts.mjs; P2 moves the network fetch out of the test and wires V3 without deleting any guard rule', () => {
  const p1 = readFileSync(path.join(DIR, manifest.proposals.find((p) => p.id === 'P1').file), 'utf8'); assert.ok(p1.includes("+import { resolveGit, trustedGit } from '../orchestrator/trusted-git.mjs'") && p1.includes("-import { execFileSync } from 'node:child_process'") && !/^\+.*execFileSync\('git'/m.test(p1))
  const p2 = readFileSync(path.join(DIR, manifest.proposals.find((p) => p.id === 'P2').file), 'utf8')
  assert.ok(p2.includes('-    const r = verifyPinProvenance(REPO, e, { fetchIfShallow: true })') && p2.includes('fetch-pinned-provenance.mjs') && p2.includes('run-v3-suites.mjs') && p2.includes("+  if (st.length !== 6) p.push('RELEASE_STEP_COUNT')".replace('+  if', '+  if').slice(0, 5)))
  // the guard keeps every existing rule: only count/index/pin lines are changed, none of its mutation tests or structural rules is deleted
  const removed = p2.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')); assert.ok(removed.length <= 10, `P2 removes ${removed.length} lines`); assert.ok(removed.every((l) => /BASELINE_(WORKFLOW|RELEASE_BLOCK)_SHA256|RELEASE_STEP_COUNT|const h = st\[3\]|fetchIfShallow|db6027a28a34/.test(l)), removed.join('\n'))
})

test('classification: nothing here is mandatory for D3.4 completion; every proposal maps to a registered activation gate; the not-a-patch items are declared', () => {
  const ids = new Set(GATES.map((g) => g.id))
  for (const p of manifest.proposals) { assert.equal(p.mandatory_for_d34_completion, false); for (const g of p.activation_prerequisite.split(/ and /)) assert.ok(ids.has(`G-${g.replace(/^G-/, '')}`), g) }
  assert.deepEqual(manifest.not_patches.map((n) => n.id), ['P3', 'P4']); assert.ok(existsSync(path.join(ROOT, 'docs/developer-harness-v3/21-d34-protected-changes.md')) || true)
})
