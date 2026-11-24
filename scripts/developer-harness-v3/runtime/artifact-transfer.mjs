// Developer Harness V3 (D3.3) — host-side import of a guest-produced git bundle (security review S2).
//
// The bundle bytes are untrusted. `git clone <file>` would follow a `gitdir: <path>` redirect file and read an arbitrary HOST repository, so the
// import never clones: it (1) caps the size, (2) requires a genuine v2/v3 bundle header, (3) creates a fresh empty bare repository, (4) runs
// `git bundle verify` and `git fetch` with object fsck enabled, a blank system/global config, no hooks and no fsmonitor, into one fixed ref, and
// (5) recomputes the tree digest on the host. Only that host-computed digest may ever be bound into evidence.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './vm-controller.mjs'

export const MAX_BUNDLE_BYTES = 512 * 1024 * 1024
export const BUNDLE_HEADER_RE = /^# v[23] git bundle\n/

/** Pure header/size check. */
export function checkBundleBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return 'BUNDLE.EMPTY'
  if (buf.length > MAX_BUNDLE_BYTES) return 'BUNDLE.TOO_LARGE'
  if (!BUNDLE_HEADER_RE.test(buf.subarray(0, 32).toString('latin1'))) return 'BUNDLE.BAD_HEADER'
  return null
}

const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe'
const HARDEN = ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'transfer.fsckObjects=true', '-c', 'fetch.fsckObjects=true', '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', '-c', 'core.symlinks=false']

/** @returns {{ok:true, tree:string, commit:string}|{ok:false, code:string}} */
export function importBundle(buf, { git = GIT } = {}) {
  const bad = checkBundleBytes(buf)
  if (bad) return { ok: false, code: bad }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dh3-bundle-'))
  try {
    const env = { SYSTEMROOT: process.env.SYSTEMROOT, SYSTEMDRIVE: process.env.SYSTEMDRIVE, PATH: `${path.dirname(git)};${process.env.SYSTEMROOT}\\System32`, HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(tmp, 'no-global-config'), GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1' }
    const file = path.join(tmp, 'candidate.bundle'); const repo = path.join(tmp, 'r.git')
    writeFileSync(file, buf)
    if (run(git, ['init', '-q', '--bare', repo], { env }).code !== 0) return { ok: false, code: 'BUNDLE.INIT_FAILED' }
    if (run(git, ['--git-dir', repo, ...HARDEN, 'bundle', 'verify', '-q', file], { env }).code !== 0) return { ok: false, code: 'BUNDLE.VERIFY_FAILED' }
    if (run(git, ['--git-dir', repo, ...HARDEN, 'fetch', '-q', '--no-tags', file, '+HEAD:refs/dh3/candidate'], { env, timeoutMs: 600000 }).code !== 0) return { ok: false, code: 'BUNDLE.FETCH_FAILED' }
    const tree = run(git, ['--git-dir', repo, 'rev-parse', '--verify', 'refs/dh3/candidate^{tree}'], { env }).out.trim()
    const commit = run(git, ['--git-dir', repo, 'rev-parse', '--verify', 'refs/dh3/candidate^{commit}'], { env }).out.trim()
    if (!/^[0-9a-f]{40}$/.test(tree) || !/^[0-9a-f]{40}$/.test(commit)) return { ok: false, code: 'BUNDLE.NO_TREE' }
    return { ok: true, tree, commit }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}
