// D3.3 egress policy + proxy (unit + local integration; no internet: resolution and upstream dial are injected).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { decideConnect, decideResolution, isPublicAddress, normalizeHost, parseAuthority, parseClientHelloSni, PROFILES } from '../runtime/egress-policy.mjs'

/** Minimal synthetic TLS ClientHello with an SNI (structure per RFC 8446 section 4.1.2; no real handshake). */
export function clientHello(host) {
  const name = Buffer.from(host, 'latin1')
  const sni = Buffer.concat([Buffer.from([0x00, 0x00]), u16(name.length + 5), u16(name.length + 3), Buffer.from([0x00]), u16(name.length), name])
  const body = Buffer.concat([Buffer.from([0x03, 0x03]), Buffer.alloc(32, 7), Buffer.from([0x00]), u16(2), Buffer.from([0x13, 0x01]), Buffer.from([0x01, 0x00]), u16(sni.length), sni])
  const hs = Buffer.concat([Buffer.from([0x01, 0x00, body.length >> 8, body.length & 255]), body])
  return Buffer.concat([Buffer.from([0x16, 0x03, 0x01]), u16(hs.length), hs])
}
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b }
import { startEgressProxy } from '../runtime/egress-proxy.mjs'

test('host normalization: case, one trailing dot; IP literals in every form are refused', () => {
  assert.deepEqual(normalizeHost('API.Anthropic.COM.'), { ok: true, host: 'api.anthropic.com' })
  for (const h of ['127.0.0.1', '2130706433', '0x7f.0.0.1', '0177.0.0.1', '127.1', '[::1]', '::ffff:127.0.0.1', '10.0.2.2', '0x7f000001']) assert.equal(normalizeHost(h).ok, false, h)
  for (const h of ['', 'a..b', '-a.com', 'a_b.com', 'a.com..', 'x'.repeat(64) + '.com', 'exa mple.com']) assert.equal(normalizeHost(h).ok, false, h)
})

test('authority parsing refuses userinfo, paths, brackets and bad ports', () => {
  assert.deepEqual(parseAuthority('api.anthropic.com:443'), { ok: true, host: 'api.anthropic.com', port: 443 })
  for (const t of ['user@api.anthropic.com:443', 'api.anthropic.com/x:443', '[::1]:443', 'api.anthropic.com', 'api.anthropic.com:0', 'api.anthropic.com:99999', 'api.anthropic.com:+443', 'api.anthropic.com: 443']) assert.equal(parseAuthority(t).ok, false, t)
})

test('public-address classification blocks loopback, LAN, link-local, CGNAT, WSL/Docker ranges, metadata, mapped and NAT64 forms', () => {
  for (const a of ['127.0.0.1', '10.10.0.5', '172.26.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:10.0.0.1', '::ffff:160.79.104.10', '::ffff:a00:1', '0:0:0:0:0:ffff:7f00:1', '64:ff9b::a00:1', 'ff02::1']) assert.equal(isPublicAddress(a), false, a)
  for (const a of ['160.79.104.10', '34.36.57.103', '2607:6bc0::10']) assert.equal(isPublicAddress(a), true, a)
  assert.equal(isPublicAddress('not-an-ip'), false)
})

test('CONNECT decisions: exact allow-list per profile, 443 only, CONNECT only', () => {
  assert.equal(decideConnect({ method: 'CONNECT', target: 'api.anthropic.com:443', profile: 'runtime' }).allow, true)
  assert.equal(decideConnect({ method: 'CONNECT', target: 'claude.ai:443', profile: 'runtime' }).code, 'EGRESS.HOST_NOT_ALLOWLISTED')
  assert.equal(decideConnect({ method: 'CONNECT', target: 'claude.ai:443', profile: 'login' }).allow, true)
  assert.equal(decideConnect({ method: 'CONNECT', target: 'evil.api.anthropic.com:443', profile: 'runtime' }).code, 'EGRESS.HOST_NOT_ALLOWLISTED')
  assert.equal(decideConnect({ method: 'CONNECT', target: 'api.anthropic.com.evil.com:443', profile: 'runtime' }).code, 'EGRESS.HOST_NOT_ALLOWLISTED')
  assert.equal(decideConnect({ method: 'CONNECT', target: 'api.anthropic.com:80', profile: 'runtime' }).code, 'EGRESS.PORT_NOT_ALLOWED')
  assert.equal(decideConnect({ method: 'GET', target: 'http://api.anthropic.com/', profile: 'runtime' }).code, 'EGRESS.METHOD_NOT_ALLOWED')
  assert.equal(decideConnect({ method: 'CONNECT', target: '160.79.104.10:443', profile: 'runtime' }).code, 'EGRESS.IP_LITERAL')
  assert.equal(decideConnect({ method: 'CONNECT', target: 'api.anthropic.com:443', profile: 'nope' }).code, 'EGRESS.PROFILE_UNKNOWN')
  for (const h of ['github.com', 'registry.npmjs.org', 'statsig.anthropic.com', 'downloads.claude.ai', 'mcp-proxy.anthropic.com']) assert.equal(PROFILES.runtime.hosts.includes(h), false, `${h} must not be reachable at runtime`)
})

test('DNS rebinding: one non-public answer in the set denies the whole name', () => {
  assert.equal(decideResolution([{ address: '160.79.104.10', family: 4 }, { address: '127.0.0.1', family: 4 }]).code, 'EGRESS.RESOLVED_TO_NON_PUBLIC')
  assert.equal(decideResolution([]).code, 'EGRESS.RESOLUTION_EMPTY')
  assert.deepEqual(decideResolution([{ address: '160.79.104.10', family: 4 }]), { allow: true, address: '160.79.104.10', family: 4 })
})

async function withProxy(fn, { answers = [{ address: '160.79.104.10', family: 4 }], limits } = {}) {
  const echo = net.createServer((s) => s.pipe(s)); await new Promise((r) => echo.listen(0, '127.0.0.1', r))
  const decisions = []; const dialed = []
  const proxy = await startEgressProxy({ profile: 'runtime', lookup: (h, cb) => cb(null, answers), connect: (o) => { dialed.push(o.host); return net.connect({ host: '127.0.0.1', port: echo.address().port }) }, onDecision: (d) => decisions.push(d), limits })
  try { await fn({ port: proxy.port, decisions, dialed, proxy }) } finally { await proxy.close(); echo.close() }
}
function talk(port, data, { wait = 300 } = {}) {
  return new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); let out = ''; s.on('data', (d) => { out += d }); s.on('error', () => {}); s.on('connect', () => s.write(data)); setTimeout(() => { s.destroy(); resolve(out) }, wait) })
}

test('proxy: allowed CONNECT dials the VETTED address (never re-resolves) and relays bytes', async () => {
  await withProxy(async ({ port, dialed }) => {
    const s = net.connect(port, '127.0.0.1'); let out = ''
    await new Promise((r) => s.on('connect', r)); s.on('data', (d) => { out += d })
    s.write('CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\n\r\n')
    await new Promise((r) => setTimeout(r, 150)); assert.match(out, /^HTTP\/1\.1 200/)
    s.write(clientHello('api.anthropic.com')); s.write('ping'); await new Promise((r) => setTimeout(r, 150)); assert.ok(out.endsWith('ping'), 'hello + data relayed after SNI check'); s.destroy()
    assert.deepEqual(dialed, ['160.79.104.10'])
  })
})

test('proxy refuses: unlisted host, plain HTTP, early tunnel data, oversize headers, rebinding answers; logs no payload', async () => {
  await withProxy(async ({ port, decisions }) => {
    assert.match(await talk(port, 'CONNECT github.com:443 HTTP/1.1\r\n\r\n'), /^HTTP\/1\.1 403/)
    assert.match(await talk(port, 'GET http://api.anthropic.com/ HTTP/1.1\r\nHost: x\r\n\r\n'), /^HTTP\/1\.1 405/)
    assert.match(await talk(port, 'CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\nSECRET-EARLY'), /^HTTP\/1\.1 400/)
    assert.match(await talk(port, `CONNECT api.anthropic.com:443 HTTP/1.1\r\nX: ${'a'.repeat(9000)}\r\n\r\n`), /^HTTP\/1\.1 431/)
    assert.ok(!JSON.stringify(decisions).includes('SECRET-EARLY'))
  })
  await withProxy(async ({ port, dialed }) => {
    assert.match(await talk(port, 'CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n'), /^HTTP\/1\.1 403/)
    assert.deepEqual(dialed, [])
  }, { answers: [{ address: '10.10.0.1', family: 4 }] })
})

test('proxy binds loopback only and enforces the per-tunnel byte budget', async () => {
  await withProxy(async ({ proxy, port, decisions }) => {
    assert.equal(proxy.server.address().address, '127.0.0.1')
    const s = net.connect(port, '127.0.0.1'); await new Promise((r) => s.on('connect', r)); s.on('error', () => {}); s.on('data', () => {})
    s.write('CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n'); await new Promise((r) => setTimeout(r, 100))
    s.write(clientHello('api.anthropic.com')); s.write(Buffer.alloc(4096)); await new Promise((r) => setTimeout(r, 200))
    assert.ok(decisions.some((d) => d.code === 'EGRESS.TUNNEL_BYTE_BUDGET'))
    s.destroy()
  }, { limits: { maxTunnelBytes: 1024 } })
})

test('remediation: IPv4 is preferred among vetted answers; a client that leaves during resolution frees its slot and is never dialled', async () => {
  assert.deepEqual(decideResolution([{ address: '2607:6bc0::10', family: 6 }, { address: '160.79.104.10', family: 4 }]), { allow: true, address: '160.79.104.10', family: 4 })
  const dialed = []; let release
  const proxy = await startEgressProxy({ profile: 'runtime', lookup: (h, cb) => { release = () => cb(null, [{ address: '160.79.104.10', family: 4 }]) }, connect: (o) => { dialed.push(o.host); return net.connect({ host: '127.0.0.1', port: 9 }) }, limits: { maxTunnels: 1 } })
  try {
    const s = net.connect(proxy.port, '127.0.0.1'); s.on('error', () => {})
    await new Promise((r) => s.on('connect', r)); s.write('CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n')
    await new Promise((r) => setTimeout(r, 100)); s.destroy(); await new Promise((r) => setTimeout(r, 100))
    release(); await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(dialed, []); assert.equal(proxy.stats().tunnels, 0, 'slot released')
  } finally { await proxy.close() }
})

test('security S7: SNI must equal the allow-listed CONNECT host; fronting, non-TLS and missing SNI are refused; profile switch closes tunnels', async () => {
  assert.equal(parseClientHelloSni(clientHello('API.Anthropic.com.')).sni, 'api.anthropic.com')
  assert.equal(parseClientHelloSni(clientHello('x').subarray(0, 10)).complete, false)
  assert.equal(parseClientHelloSni(Buffer.from('GET / HTTP/1.1\r\n\r\n')).code, 'EGRESS.NOT_TLS')
  assert.equal(parseClientHelloSni(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x04, 0x02, 0, 0, 0])).code, 'EGRESS.NOT_CLIENT_HELLO')
  for (const [payload, code] of [[clientHello('attacker-fronted.example'), 'EGRESS.SNI_MISMATCH'], [Buffer.from('plain bytes, not TLS'), 'EGRESS.NOT_TLS']]) {
    await withProxy(async ({ port, decisions }) => {
      const s = net.connect(port, '127.0.0.1'); s.on('error', () => {}); let out = ''; s.on('data', (d) => { out += d })
      await new Promise((r) => s.on('connect', r)); s.write('CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n')
      await new Promise((r) => setTimeout(r, 100)); s.write(payload); await new Promise((r) => setTimeout(r, 200))
      assert.ok(decisions.some((d) => d.code === code), `${code}: ${JSON.stringify(decisions.map((x) => x.code))}`)
      assert.ok(!out.includes('attacker') && !out.includes('plain bytes'), 'nothing was relayed upstream')
      s.destroy()
    })
  }
  await withProxy(async ({ port, proxy, decisions }) => {
    const s = net.connect(port, '127.0.0.1'); s.on('error', () => {}); s.on('data', () => {})
    await new Promise((r) => s.on('connect', r)); s.write('CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n')
    await new Promise((r) => setTimeout(r, 100)); s.write(clientHello('api.anthropic.com')); await new Promise((r) => setTimeout(r, 100))
    proxy.setProfile('provisioning'); await new Promise((r) => setTimeout(r, 100))
    assert.equal(s.destroyed || s.readyState === 'closed', true, 'open tunnel closed on profile switch')
    assert.ok(decisions.some((d) => d.allow && d.code === 'EGRESS.CLOSED'))
  })
})