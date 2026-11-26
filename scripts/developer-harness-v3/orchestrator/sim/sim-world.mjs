// Developer Harness V3 (D3.4) — SIMULATION world (every output of this harness is labelled `simulated`). No model, VM, network or credential is involved.
//
// The world is a directory: a persistent `world.json` (survives controller crashes — it plays the part of the guest VM and of the git store), real worktree
// files (so snapshot capture / restore is exercised on real bytes) and per-task commit directories. The simulation enforces INVARIANTS by throwing, so a
// recovery bug shows up as a loud failure instead of a silent pass: a second live session, a session running without a lease, tampered restores.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { atomicWriteJson, readJsonState } from '../../lib/atomic.mjs'

export const sha1 = (s) => createHash('sha1').update(s).digest('hex')
export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

export const worldFile = (dir) => path.join(dir, 'world.json')
export function loadWorld(dir) {
  const r = readJsonState(worldFile(dir))
  return r.ok ? r.value : { versions: {}, alive_sessions: {}, vm: { running: true, supervisor_pid: 4242, qemu_pid: 4243, marker: 'sim-marker', state: 'running' }, counters: {}, terminate_unverified_left: 0, cleanup_unverified_left: 0 }
}
export const saveWorld = (dir, w) => { mkdirSync(dir, { recursive: true }); atomicWriteJson(worldFile(dir), w) }
export const wtDir = (dir, taskId) => path.join(dir, 'worktrees', taskId)
export const commitDir = (dir, taskId, v) => path.join(dir, 'commits', taskId, String(v))

export function readTree(root) {
  const out = []
  const walk = (d, rel) => { if (!existsSync(d)) return; for (const n of readdirSync(d).sort()) { const p = path.join(d, n); const r = rel ? `${rel}/${n}` : n; if (statSync(p).isDirectory()) walk(p, r); else out.push({ path: r, content: readFileSync(p) }) } }
  walk(root, '')
  return out
}
export const writeFileTree = (root, files) => { for (const f of files) { const p = path.join(root, ...f.path.split('/')); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, f.content) } }
export const wipe = (d) => rmSync(d, { recursive: true, force: true })
export const treeOf = (files) => sha1(files.map((f) => `${f.path}:${sha256(f.content)}`).sort().join('\n'))
export const patchOf = (files) => sha256(files.map((f) => `${f.path}:${sha256(f.content)}`).sort().join('\n') + '|patch')
export const candidateShaFor = (taskId, version) => sha1(`candidate:${taskId}:${version}`)
