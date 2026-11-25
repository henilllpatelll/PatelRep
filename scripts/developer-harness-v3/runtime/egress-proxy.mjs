// Developer Harness V3 (D3.3) — host-side allow-listing CONNECT proxy for the worker VM.
//
// Binds to 127.0.0.1 only. The VM reaches it exclusively through the controller's SSH remote forward. It never terminates TLS, never sees or logs
// payloads (Claude authentication traffic is NOT intercepted), never forwards plain HTTP, and records one sanitized line per decision.
// Bounds: header size/time, concurrent tunnels (slot reserved BEFORE resolution), idle time, per-tunnel and per-proxy byte budgets, and real
// backpressure (a slow side pauses the other), so buffered memory stays proportional to socket buffers, not to traffic.
import dns from 'node:dns'
import net from 'node:net'
import { decideConnect, decideResolution, parseClientHelloSni } from './egress-policy.mjs'

export const PROXY_DEFAULTS = Object.freeze({ maxHeaderBytes: 8192, headerTimeoutMs: 10000, idleTimeoutMs: 300000, maxTunnels: 32, maxTunnelBytes: 512 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 * 1024, connectTimeoutMs: 15000 })

/**
 * @param {{profile:string, port?:number, lookup?:Function, connect?:Function, onDecision?:Function, limits?:object}} o
 * @returns {Promise<{server:net.Server, port:number, close:()=>Promise<void>, stats:()=>object, setProfile:(p:string)=>void}>}
 */
export function startEgressProxy({ profile, port = 0, lookup = (h, cb) => dns.lookup(h, { all: true, verbatim: true }, cb), connect = net.connect, onDecision = () => {}, limits = {} }) {
  const L = { ...PROXY_DEFAULTS, ...limits }
  let active = profile
  let slots = 0; let total = 0
  const counts = { allowed: 0, denied: 0 }
  const record = (d) => { counts[d.allow ? 'allowed' : 'denied'] += 1; try { onDecision({ at: new Date().toISOString(), profile: active, ...d }) } catch { /* a logging failure never opens a tunnel */ } }
  const sockets = new Set()

  const server = net.createServer((client) => {
    sockets.add(client); client.on('close', () => sockets.delete(client))
    client.on('error', () => {}) // persistent: a second error must never crash the controller
    client.setNoDelay(true)
    let buf = Buffer.alloc(0); let done = false; let clientGone = false
    client.once('close', () => { clientGone = true })
    const headerTimer = setTimeout(() => { if (!done) { done = true; record({ allow: false, code: 'EGRESS.HEADER_TIMEOUT' }); client.destroy() } }, L.headerTimeoutMs)
    const refuse = (code, status = 403) => { done = true; clearTimeout(headerTimer); record({ allow: false, code }); if (!clientGone) client.end(`HTTP/1.1 ${status} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`) }
    const onData = (chunk) => {
      if (done) return
      buf = Buffer.concat([buf, chunk])
      if (buf.length > L.maxHeaderBytes) return refuse('EGRESS.HEADER_TOO_LARGE', 431)
      const end = buf.indexOf('\r\n\r\n')
      if (end < 0) return
      client.off('data', onData); client.pause()
      done = true; clearTimeout(headerTimer)
      const head = buf.subarray(0, end).toString('latin1')
      const rest = buf.subarray(end + 4)
      const [line] = head.split('\r\n')
      const m = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(line)
      if (!m) return refuse('EGRESS.REQUEST_MALFORMED', 400)
      if (rest.length) return refuse('EGRESS.EARLY_DATA', 400) // a client must wait for 200 before sending tunnel bytes
      const d = decideConnect({ method: m[1], target: m[2], profile: active })
      if (!d.allow) return refuse(d.code, m[1] === 'CONNECT' ? 403 : 405)
      if (slots >= L.maxTunnels) return refuse('EGRESS.TOO_MANY_TUNNELS', 503)
      slots += 1 // reserved now, so concurrent lookups cannot overshoot the cap
      let released = false
      const release = () => { if (!released) { released = true; slots -= 1 } }
      let looked = false
      const lookupTimer = setTimeout(() => { if (!looked) { looked = true; release(); refuse('EGRESS.RESOLUTION_TIMEOUT', 504) } }, L.connectTimeoutMs)
      lookup(d.host, (err, addrs) => {
        if (looked) return
        looked = true; clearTimeout(lookupTimer)
        if (clientGone) { release(); record({ allow: false, code: 'EGRESS.CLIENT_GONE_BEFORE_DIAL', host: d.host }); return }
        if (err) { release(); return refuse('EGRESS.RESOLUTION_FAILED', 502) }
        const r = decideResolution(addrs)
        if (!r.allow) { release(); return refuse(r.code) }
        let bytes = 0; let closed = false
        const upstream = connect({ host: r.address, port: d.port, family: r.family, timeout: L.connectTimeoutMs })
        sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream))
        const finish = (code) => { if (closed) return; closed = true; release(); record({ allow: true, code, host: d.host, port: d.port, bytes }); client.destroy(); upstream.destroy() }
        const pipe = (from, to) => {
          from.on('data', (c) => {
            bytes += c.length; total += c.length
            if (bytes > L.maxTunnelBytes) return finish('EGRESS.TUNNEL_BYTE_BUDGET')
            if (total > L.maxTotalBytes) return finish('EGRESS.TOTAL_BYTE_BUDGET')
            if (!closed && !to.write(c)) { from.pause(); to.once('drain', () => from.resume()) }
          })
        }
        upstream.once('connect', () => {
          if (clientGone) return finish('EGRESS.CLIENT_GONE_BEFORE_DIAL')
          upstream.setTimeout(0)
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          client.setTimeout(L.idleTimeoutMs, () => finish('EGRESS.IDLE_TIMEOUT'))
          // Nothing is forwarded until the client's first TLS record shows an SNI equal to the allow-listed CONNECT host.
          let hello = Buffer.alloc(0)
          const sniTimer = setTimeout(() => finish('EGRESS.SNI_TIMEOUT'), L.headerTimeoutMs)
          const onHello = (c) => {
            hello = Buffer.concat([hello, c])
            const r = parseClientHelloSni(hello)
            if (!r.complete) { if (hello.length > 17000) { clearTimeout(sniTimer); finish('EGRESS.NOT_TLS') } return }
            clearTimeout(sniTimer); client.off('data', onHello)
            if (r.sni !== d.host) return finish(r.code ?? 'EGRESS.SNI_MISMATCH')
            bytes += hello.length; total += hello.length
            upstream.write(hello)
            pipe(client, upstream); pipe(upstream, client)
          }
          client.on('data', onHello); client.resume()
        })
        upstream.on('timeout', () => finish('EGRESS.CONNECT_TIMEOUT'))
        upstream.on('error', () => finish('EGRESS.UPSTREAM_ERROR'))
        upstream.on('close', () => finish('EGRESS.CLOSED'))
        client.on('close', () => finish('EGRESS.CLOSED'))
      })
    }
    client.on('data', onData)
  })
  server.maxConnections = L.maxTunnels * 2
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      // A profile switch closes every open connection: no tunnel opened under a wider profile survives into a narrower one.
      resolve({ server, port: server.address().port, setProfile: (p) => { active = p; for (const s of sockets) s.destroy() }, stats: () => ({ ...counts, tunnels: slots, total_bytes: total, profile: active }),
        close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()) }) })
    })
  })
}
