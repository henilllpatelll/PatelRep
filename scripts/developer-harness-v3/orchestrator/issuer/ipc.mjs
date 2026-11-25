// Developer Harness V3 (D3.4) — authenticated issuer IPC (loopback-free: a Windows named pipe, or a unix socket elsewhere).
//
// Authentication is a per-connection challenge-response with a per-role secret (HMAC-SHA256 over the server's fresh challenge and the canonical request):
//   * a captured request cannot be replayed (the challenge is fresh per connection and bound into the MAC),
//   * a different role's secret does not authenticate (one secret file per issuer),
//   * the request is a closed schema {op, params}; the server dispatches only operations that role's IssuerCore allows.
// HONEST LIMIT: Node cannot read a named-pipe client's SID, so peer identity here is "possession of the role secret" plus the pipe/secret ACLs from
// key-custody.aclPlan. Real OS-enforced process identity needs the dedicated accounts (gate G-ISSUER-ACCOUNTS); this layer is defence in depth, not that.
import net from 'node:net'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { rmSync } from 'node:fs'
import { canonicalize } from '../../lib/canonical.mjs'

export const MAX_FRAME = 64 * 1024
export const ipcPath = (name, dir) => (process.platform === 'win32' ? `\\\\.\\pipe\\dh3-${name}` : path.join(dir, `${name}.sock`))
const mac = (secret, challenge, req) => createHmac('sha256', secret).update(`${challenge}\n${canonicalize(req)}`).digest('hex')
const eq = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
const OPNAME = /^[a-z_]{3,40}$/

export function startIssuerServer({ listenPath, secret, core, maxConnections = 8, requestTimeoutMs = 5000 }) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) throw new Error('IPC.SECRET_TOO_SHORT')
  if (process.platform !== 'win32') rmSync(listenPath, { force: true })
  let active = 0
  const server = net.createServer((sock) => {
    if (active >= maxConnections) { sock.end('{"ok":false,"code":"IPC.BUSY"}\n'); return }
    active += 1; sock.setEncoding('utf8'); sock.setTimeout(requestTimeoutMs, () => sock.destroy())
    const challenge = randomBytes(24).toString('hex'); let buf = ''; let done = false
    sock.on('close', () => { active -= 1 }); sock.on('error', () => {})
    const reply = (o) => { if (!done) { done = true; sock.end(`${JSON.stringify(o)}\n`) } }
    sock.write(`${JSON.stringify({ challenge })}\n`)
    sock.on('data', (chunk) => {
      buf += chunk
      if (buf.length > MAX_FRAME) return reply({ ok: false, code: 'IPC.FRAME_TOO_LARGE' })
      const nl = buf.indexOf('\n'); if (nl < 0) return
      let msg; try { msg = JSON.parse(buf.slice(0, nl)) } catch { return reply({ ok: false, code: 'IPC.MALFORMED' }) }
      if (!msg || typeof msg !== 'object' || typeof msg.mac !== 'string' || typeof msg.op !== 'string' || !OPNAME.test(msg.op) || Object.keys(msg).some((k) => !['op', 'params', 'mac'].includes(k))) return reply({ ok: false, code: 'IPC.MALFORMED' })
      const req = { op: msg.op, params: msg.params ?? {} }
      let expected; try { expected = mac(secret, challenge, req) } catch { return reply({ ok: false, code: 'IPC.MALFORMED' }) }
      if (!eq(expected, msg.mac)) return reply({ ok: false, code: 'IPC.AUTH_FAILED' })
      let out; try { out = core.handle(req.op, req.params) } catch { out = { ok: false, code: 'IPC.HANDLER_ERROR' } }
      return reply(out)
    })
  })
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(listenPath, () => resolve({ server, close: () => new Promise((r) => server.close(() => r())) })) })
}

/** One request per connection. Rejects on timeout/transport error; a refusal from the issuer is a normal `{ok:false}` result. */
export function callIssuer({ listenPath, secret, op, params = {}, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(listenPath); sock.setEncoding('utf8'); let buf = ''; let sent = false
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('IPC.TIMEOUT')) }, timeoutMs)
    sock.on('error', (e) => { clearTimeout(timer); reject(e) })
    sock.on('data', (c) => {
      buf += c
      if (buf.length > 4 * MAX_FRAME) { sock.destroy(); clearTimeout(timer); return reject(new Error('IPC.RESPONSE_TOO_LARGE')) }
      let nl = buf.indexOf('\n'); if (nl < 0) return
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      let m; try { m = JSON.parse(line) } catch { sock.destroy(); clearTimeout(timer); return reject(new Error('IPC.BAD_RESPONSE')) }
      if (!sent && typeof m.challenge === 'string') { sent = true; const req = { op, params }; sock.write(`${JSON.stringify({ ...req, mac: mac(secret, m.challenge, req) })}\n`); return }
      clearTimeout(timer); sock.end(); resolve(m)
    })
  })
}
