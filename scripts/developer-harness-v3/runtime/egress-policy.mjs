// Developer Harness V3 (D3.3) — worker egress policy (pure).
//
// The worker VM has NO route to anything (QEMU slirp `restrict=on`, no guestfwd, IPv6 off). Its only egress is guest-loopback :3128, carried by the
// controller-initiated SSH remote forward to this policy's proxy on host loopback (qemu-args.mjs, vm-controller.mjs). For each CONNECT request:
//   * only CONNECT, only exact allow-listed hostnames for the active profile, only the profile's ports (443);
//   * IP literals in ANY form (dotted, integer, hex, octal, IPv6, bracketed, mapped) are refused, so allow-listing can never be bypassed by an address;
//   * the HOST resolves the name and every resolved address must be public unicast; the tunnel then connects to that vetted address, so a DNS
//     rebinding between check and connect is impossible, and no answer pointing at loopback, the LAN, link-local, CGNAT, the WSL/Docker
//     ranges or metadata addresses is ever dialled.
// An allow-listed hostname is NOT a safe data destination: see 15-isolation-acceptance.md §egress for what remains possible.
import net from 'node:net'

export const PROFILES = Object.freeze({
  // Steady-state worker execution: model API + OAuth token refresh only. Measured/justified in 14-cli-capability-report.md.
  runtime: Object.freeze({ hosts: Object.freeze(['api.anthropic.com', 'platform.claude.com']), ports: Object.freeze([443]) }),
  // One-time interactive owner login inside the VM (official `claude auth login`).
  login: Object.freeze({ hosts: Object.freeze(['api.anthropic.com', 'platform.claude.com', 'claude.ai', 'claude.com']), ports: Object.freeze([443]) }),
  // Trusted provisioning before any candidate code exists in the VM (Debian packages over HTTPS). Never active during a task.
  provisioning: Object.freeze({ hosts: Object.freeze(['deb.debian.org']), ports: Object.freeze([443]) }),
})

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/** Canonical hostname or a refusal code. Never returns an IP. */
export function normalizeHost(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 254) return { ok: false, code: 'EGRESS.HOST_INVALID' }
  let h = raw.toLowerCase()
  if (h.startsWith('[') || h.includes(':')) return { ok: false, code: 'EGRESS.IP_LITERAL' }
  if (h.endsWith('.')) h = h.slice(0, -1) // one trailing dot is the same name; two are invalid below
  if (!/^[a-z0-9.-]+$/.test(h)) return { ok: false, code: 'EGRESS.HOST_INVALID' }
  const labels = h.split('.')
  if (labels.some((l) => !LABEL.test(l))) return { ok: false, code: 'EGRESS.HOST_INVALID' }
  // Any all-numeric/hex final label means the resolver may treat the name as an address (inet_aton forms: 2130706433, 0x7f.1, 0177.0.0.1).
  if (labels.every((l) => /^(0x[0-9a-f]+|[0-9]+)$/.test(l)) || /^(0x[0-9a-f]*|[0-9]+)$/.test(labels[labels.length - 1])) return { ok: false, code: 'EGRESS.IP_LITERAL' }
  if (net.isIP(h)) return { ok: false, code: 'EGRESS.IP_LITERAL' }
  return { ok: true, host: h }
}

/** Parse a CONNECT authority `host:port`. */
export function parseAuthority(target) {
  if (typeof target !== 'string' || target.length > 300) return { ok: false, code: 'EGRESS.TARGET_INVALID' }
  if (target.includes('@') || target.includes('/') || /\s/.test(target)) return { ok: false, code: 'EGRESS.TARGET_INVALID' }
  if (target.startsWith('[')) return { ok: false, code: 'EGRESS.IP_LITERAL' }
  const i = target.lastIndexOf(':')
  if (i <= 0) return { ok: false, code: 'EGRESS.TARGET_INVALID' }
  const portStr = target.slice(i + 1)
  if (!/^[0-9]{1,5}$/.test(portStr)) return { ok: false, code: 'EGRESS.PORT_INVALID' }
  const port = Number(portStr)
  if (port < 1 || port > 65535) return { ok: false, code: 'EGRESS.PORT_INVALID' }
  const h = normalizeHost(target.slice(0, i))
  return h.ok ? { ok: true, host: h.host, port } : h
}

const DENY_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
]
// NOTE: ::ffff:0:0/96 is deliberately NOT in the BlockList — Node maps IPv4 lookups onto it, which would block every IPv4 address.
// IPv4-mapped and IPv4-compatible IPv6 forms are rejected explicitly in isPublicAddress instead.
const DENY_V6 = [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]
const BLOCK = (() => {
  const b = new net.BlockList()
  for (const [a, p] of DENY_V4) b.addSubnet(a, p, 'ipv4')
  for (const [a, p] of DENY_V6) b.addSubnet(a, p, 'ipv6')
  return b
})()

/** True only for globally routable unicast addresses. Anything unparsable is not public. */
export function isPublicAddress(addr, family) {
  const fam = family === 6 || family === 'IPv6' ? 'ipv6' : family === 4 || family === 'IPv4' ? 'ipv4' : (net.isIP(addr) === 6 ? 'ipv6' : net.isIP(addr) === 4 ? 'ipv4' : null)
  if (!fam || net.isIP(addr) !== (fam === 'ipv6' ? 6 : 4)) return false
  if (fam === 'ipv6') {
    const g = expandV6(addr)
    if (!g) return false
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return false // ::ffff:a.b.c.d and ::a.b.c.d embed IPv4
  }
  return !BLOCK.check(addr, fam)
}

/** Expand an IPv6 address (incl. embedded dotted IPv4) to eight 16-bit groups; null when malformed. */
export function expandV6(a) {
  let s = String(a).toLowerCase()
  const dot = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (dot) { const b = dot.slice(1).map(Number); if (b.some((x) => x > 255)) return null; s = `${s.slice(0, dot.index)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}` }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const part = (h) => (h ? h.split(':') : [])
  const head = part(halves[0]); const tail = halves.length === 2 ? part(halves[1]) : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null
  const groups = [...head, ...Array(fill).fill('0'), ...tail]
  if (groups.length !== 8 || groups.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null
  return groups.map((x) => Number.parseInt(x, 16))
}

/** Decide a CONNECT before resolution. */
export function decideConnect({ method, target, profile }) {
  const p = PROFILES[profile]
  if (!p) return { allow: false, code: 'EGRESS.PROFILE_UNKNOWN' }
  if (method !== 'CONNECT') return { allow: false, code: 'EGRESS.METHOD_NOT_ALLOWED' }
  const a = parseAuthority(target)
  if (!a.ok) return { allow: false, code: a.code }
  if (!p.hosts.includes(a.host)) return { allow: false, code: 'EGRESS.HOST_NOT_ALLOWLISTED', host: a.host }
  if (!p.ports.includes(a.port)) return { allow: false, code: 'EGRESS.PORT_NOT_ALLOWED', host: a.host }
  return { allow: true, host: a.host, port: a.port }
}

/**
 * Parse the SNI host name from the first TLS record of a tunnel (security review S7: the tunnel must carry TLS to the SAME name that was
 * allow-listed — no domain fronting through a shared front end). Returns {complete:false} until the whole first record is buffered;
 * {complete:true, sni:null} for non-TLS / no SNI. Never throws.
 */
export function parseClientHelloSni(buf) {
  try {
    if (buf.length < 5) return { complete: false }
    if (buf[0] !== 0x16) return { complete: true, sni: null, code: 'EGRESS.NOT_TLS' }
    const recLen = buf.readUInt16BE(3)
    if (recLen > 16384 + 256) return { complete: true, sni: null, code: 'EGRESS.NOT_TLS' }
    if (buf.length < 5 + recLen) return { complete: false }
    const h = buf.subarray(5, 5 + recLen)
    if (h[0] !== 0x01) return { complete: true, sni: null, code: 'EGRESS.NOT_CLIENT_HELLO' }
    let o = 4 + 2 + 32
    o += 1 + h[o] // session id
    o += 2 + h.readUInt16BE(o) // cipher suites
    o += 1 + h[o] // compression
    if (o + 2 > h.length) return { complete: true, sni: null, code: 'EGRESS.SNI_MISSING' }
    const extEnd = Math.min(h.length, o + 2 + h.readUInt16BE(o)); o += 2
    while (o + 4 <= extEnd) {
      const type = h.readUInt16BE(o); const len = h.readUInt16BE(o + 2); o += 4
      if (type === 0x0000) {
        let p = o + 2
        while (p + 3 <= o + len) {
          const nt = h[p]; const nl = h.readUInt16BE(p + 1); p += 3
          if (nt === 0) return { complete: true, sni: h.subarray(p, p + nl).toString('latin1').toLowerCase().replace(/\.$/, '') }
          p += nl
        }
      }
      o += len
    }
    return { complete: true, sni: null, code: 'EGRESS.SNI_MISSING' }
  } catch { return { complete: true, sni: null, code: 'EGRESS.CLIENT_HELLO_MALFORMED' } }
}

/** Decide on the resolver's answer: every address must be public; the first is dialled. */
export function decideResolution(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return { allow: false, code: 'EGRESS.RESOLUTION_EMPTY' }
  for (const x of addresses) if (!isPublicAddress(x.address, x.family)) return { allow: false, code: 'EGRESS.RESOLVED_TO_NON_PUBLIC' }
  // Prefer IPv4: the host may have no IPv6 route, and an AAAA-first answer must not break every tunnel. Every answer was vetted above.
  const pick = addresses.find((x) => x.family === 4 || x.family === 'IPv4') ?? addresses[0]
  return { allow: true, address: pick.address, family: pick.family }
}
