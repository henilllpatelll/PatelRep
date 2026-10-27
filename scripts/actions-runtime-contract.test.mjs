import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'

import { produce, verify } from './actions-runtime-contract.mjs'

const identity = { sha: 'a'.repeat(40), runId: 4242 }
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arc-'))

test('a produced artifact verifies against the same exact SHA and run id', () => {
  const dir = fresh()
  produce(dir, identity)
  assert.equal(verify(dir, identity).sha, identity.sha)
})

test('verification fails for a different SHA or run id (exact identity)', () => {
  const dir = fresh()
  produce(dir, identity)
  assert.throws(() => verify(dir, { ...identity, sha: 'b'.repeat(40) }), /sha mismatch/)
  assert.throws(() => verify(dir, { ...identity, runId: 1 }), /run id mismatch/)
})

test('verification fails for a missing artifact file', () => {
  const dir = fresh()
  produce(dir, identity)
  fs.rmSync(path.join(dir, 'nested', 'payload.txt'))
  assert.throws(() => verify(dir, identity), /missing artifact file/)
  const empty = fresh()
  assert.throws(() => verify(empty, identity), /missing artifact file/)
})

test('verification fails for a corrupted payload (digest mismatch)', () => {
  const dir = fresh()
  produce(dir, identity)
  fs.appendFileSync(path.join(dir, 'nested', 'payload.txt'), 'tampered')
  assert.throws(() => verify(dir, identity), /payload digest mismatch/)
})

test('verification fails for mismatched or corrupted provenance', () => {
  const dir = fresh()
  const evidence = produce(dir, identity)
  const write = (patch) => fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify({ ...evidence, ...patch }))
  write({ schema: 'other' })
  assert.throws(() => verify(dir, identity), /schema mismatch/)
  write({ marker: 'real-production-evidence' })
  assert.throws(() => verify(dir, identity), /marker mismatch/)
  write({ files: { 'nested/payload.txt': 'x', 'extra.txt': 'y' } })
  assert.throws(() => verify(dir, identity), /manifest file list mismatch/)
  fs.writeFileSync(path.join(dir, 'evidence.json'), '{not json')
  assert.throws(() => verify(dir, identity), /not valid JSON/)
})

test('verification fails when an unexpected file is smuggled into the artifact', () => {
  const dir = fresh()
  produce(dir, identity)
  fs.writeFileSync(path.join(dir, 'extra.sh'), 'echo pwned')
  assert.throws(() => verify(dir, identity), /unexpected artifact files: extra\.sh/)
})

test('produce refuses to run without a complete identity', () => {
  assert.throws(() => produce(fresh(), { sha: 'a'.repeat(40) }), /identity\.runId is required/)
  assert.throws(() => produce(fresh(), {}), /identity\.sha is required/)
})

test('the CLI exits non-zero on tampering and zero on a clean round trip', () => {
  const dir = fresh()
  const env = { ...process.env, GITHUB_SHA: identity.sha, GITHUB_RUN_ID: String(identity.runId) }
  const script = path.join(import.meta.dirname, 'actions-runtime-contract.mjs')
  assert.equal(spawnSync(process.execPath, [script, 'produce', dir], { env }).status, 0)
  assert.equal(spawnSync(process.execPath, [script, 'verify', dir], { env }).status, 0)
  fs.appendFileSync(path.join(dir, 'nested', 'payload.txt'), 'x')
  assert.notEqual(spawnSync(process.execPath, [script, 'verify', dir], { env }).status, 0)
  assert.notEqual(spawnSync(process.execPath, [script, 'bogus', dir], { env }).status, 0)
})
