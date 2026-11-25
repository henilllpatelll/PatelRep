// Developer Harness V3 (D3.4) — hardened Git execution for TRUSTED code (issuer fact derivation, controller candidate checks).
//
// Fixes the class of defect recorded as "bare `git` in authority/git-facts.mjs" (11 §2.3 round 2 N5; 14-v2 residuals):
//   * the executable is resolved ONCE from an explicit absolute allow-list (or an owner-configured absolute path), never from PATH and never from the cwd
//     (on Windows a bare name is searched in the current directory first); it must not live inside the repository under inspection or the process cwd;
//     an optional sha256 pin makes substitution a failure;
//   * the child runs with a MINIMAL, rebuilt environment (no inherited PATH, HOME, GIT_*, proxy, credential or editor variables) and a neutral cwd;
//   * hostile REPOSITORY configuration cannot run code: `-c` overrides outrank repo config, and every command-executing config key Git documents for read-only
//     plumbing is neutralised (hooks, fsmonitor, external diff, textconv, pager, ssh/proxy/askpass/credential helpers, filters via --no-ext-diff/--no-textconv);
//   * output is bounded; stderr is never echoed (it would carry local paths).
// The same helper is what the PROPOSED patch to authority/git-facts.mjs imports (docs/developer-harness-v3/proposals/).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_GIT_CANDIDATES = Object.freeze(process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\mingw64\\bin\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe']
  : ['/usr/bin/git', '/usr/local/bin/git'])

const real = (p) => { try { return realpathSync(p) } catch { return path.resolve(p) } }
const inside = (child, parent) => { const c = real(child).toLowerCase(); const p = real(parent).toLowerCase(); return c === p || c.startsWith(p + path.sep) }

/**
 * @param {{candidates?:string[], pinSha256?:string|null, forbiddenRoots?:string[]}} o
 * @returns {{ok:true, exe:string, sha256:string}|{ok:false, code:string}}
 */
export function resolveGit({ candidates = DEFAULT_GIT_CANDIDATES, pinSha256 = null, forbiddenRoots = [] } = {}) {
  const roots = [process.cwd(), ...forbiddenRoots]
  for (const c of candidates) {
    if (!path.isAbsolute(c) || !/^git(\.exe)?$/i.test(path.basename(c)) || !existsSync(c)) continue
    const st = statSync(c); if (!st.isFile()) continue
    if (roots.some((r) => inside(c, r))) return { ok: false, code: 'GIT.EXECUTABLE_INSIDE_FORBIDDEN_ROOT' }
    const sha256 = createHash('sha256').update(readFileSync(c)).digest('hex')
    if (pinSha256 && sha256 !== pinSha256) return { ok: false, code: 'GIT.EXECUTABLE_DIGEST_MISMATCH' }
    return { ok: true, exe: c, sha256 }
  }
  return { ok: false, code: 'GIT.NO_TRUSTED_EXECUTABLE' }
}

let emptyConfig = null
const emptyConfigFile = () => { if (!emptyConfig) { const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-gitcfg-')); emptyConfig = path.join(d, 'empty.gitconfig'); writeFileSync(emptyConfig, '') } return emptyConfig }

/** Every key below can make a git command execute something or reach out; they are all forced inert on the command line (highest config precedence). */
export const HARDENING = Object.freeze(['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.pager=cat', '-c', 'core.editor=true', '-c', 'core.sshCommand=', '-c', 'core.gitProxy=',
  '-c', 'core.askPass=', '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=never', '-c', 'uploadpack.packObjectsHook=', '-c', 'core.attributesFile=', '-c', 'core.excludesFile=',
  '-c', 'color.ui=false', '-c', 'diff.renames=false', '-c', 'diff.ignoreSubmodules=none', '-c', 'core.quotePath=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.untrackedCache=false'])

export function minimalEnv(exe) {
  const sys = process.env.SYSTEMROOT ?? process.env.SystemRoot
  const env = { PATH: path.dirname(exe), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfigFile(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_ATTR_NOSYSTEM: '1', GIT_EXTERNAL_DIFF: '', GIT_PAGER: 'cat', LC_ALL: 'C', LANG: 'C', HOME: path.dirname(emptyConfigFile()) }
  if (process.platform === 'win32') { if (sys) env.SYSTEMROOT = sys; env.TEMP = os.tmpdir(); env.TMP = os.tmpdir() }
  return env
}

/** Run git with `--literal-pathspecs -C repoDir`. Throws only a coded Error (no stderr text). */
export function trustedGit(exe, repoDir, args, { maxBuffer = 64 * 1024 * 1024, input = null } = {}) {
  try {
    return execFileSync(exe, ['--literal-pathspecs', '-C', repoDir, ...HARDENING, ...args], { env: minimalEnv(exe), cwd: os.tmpdir(), maxBuffer, windowsHide: true, shell: false, input: input ?? undefined, stdio: ['pipe', 'pipe', 'ignore'] })
  } catch (e) { const err = new Error(`GIT.COMMAND_FAILED:${String(e?.status ?? e?.code ?? 'unknown').slice(0, 20)}`); err.status = e?.status; throw err }
}
