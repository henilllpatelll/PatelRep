// Developer Harness V3 (D3.3) — run the egress proxy in its OWN process.
//
// Root cause found in the real VM run: the controller issues synchronous SSH commands (spawnSync) while the guest uses the proxy; with the proxy in
// the same Node process its event loop was frozen and every CONNECT stalled. A separate process also keeps a proxy fault from taking the
// controller down. Protocol: the child prints `{"port":N}` once, then one sanitized decision per line; a stdin line {"profile":"x"} switches the
// profile (closing open tunnels); stdin EOF shuts it down. The child gets a minimal environment (no owner variables, no secrets).
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PROFILES } from './egress-policy.mjs'

const SELF = fileURLToPath(import.meta.url)

export function startEgressProxyProcess({ profile, onDecision = () => {}, limits = {} }) {
  if (!Object.hasOwn(PROFILES, profile)) return Promise.reject(new Error('EGRESS.PROFILE_UNKNOWN'))
  const env = { SYSTEMROOT: process.env.SYSTEMROOT, SYSTEMDRIVE: process.env.SYSTEMDRIVE, PATH: path.dirname(process.execPath) }
  const child = spawn(process.execPath, ['--max-old-space-size=128', SELF, '--serve', profile, JSON.stringify(limits)], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
  return new Promise((resolve, reject) => {
    let buf = ''; let port = null
    const t = setTimeout(() => { child.kill(); reject(new Error('EGRESS.PROXY_START_TIMEOUT')) }, 15000)
    child.on('error', (e) => { clearTimeout(t); reject(e) })
    child.on('exit', () => { if (port === null) { clearTimeout(t); reject(new Error('EGRESS.PROXY_EXITED')) } })
    child.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        let m; try { m = JSON.parse(line) } catch { continue }
        if (port === null && Number.isInteger(m.port)) {
          port = m.port; clearTimeout(t)
          resolve({ port, pid: child.pid, setProfile: (p) => child.stdin.write(`${JSON.stringify({ profile: p })}\n`),
            close: () => new Promise((r) => { child.once('exit', () => r()); child.stdin.end(); setTimeout(() => { child.kill(); r() }, 5000) }) })
        } else if (m && typeof m === 'object' && 'allow' in m) { try { onDecision(m) } catch { /* logging never affects the proxy */ } }
      }
    })
  })
}

// Child entry point.
if (process.argv[2] === '--serve' && process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { startEgressProxy } = await import('./egress-proxy.mjs')
  let limits = {}; try { limits = JSON.parse(process.argv[4] ?? '{}') } catch { /* defaults */ }
  const p = await startEgressProxy({ profile: process.argv[3], limits, onDecision: (d) => process.stdout.write(`${JSON.stringify({ allow: d.allow, code: d.code, host: d.host ?? null, port: d.port ?? null, bytes: d.bytes ?? null, profile: d.profile })}\n`) })
  process.stdout.write(`${JSON.stringify({ port: p.port })}\n`)
  let inbuf = ''
  process.stdin.on('data', (d) => { inbuf += d; let i; while ((i = inbuf.indexOf('\n')) >= 0) { const l = inbuf.slice(0, i); inbuf = inbuf.slice(i + 1); try { const m = JSON.parse(l); if (Object.hasOwn(PROFILES, m.profile)) p.setProfile(m.profile) } catch { /* ignore */ } } })
  process.stdin.on('end', async () => { await p.close(); process.exit(0) })
}
