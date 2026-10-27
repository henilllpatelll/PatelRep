#!/usr/bin/env node
/**
 * Hermetic mock backend for the credential-free Room-Board visual gate.
 *
 * One zero-dependency HTTP origin that stands in for BOTH Supabase auth (/auth/v1/*) and the PatelRep API
 * (/v1/*), serving the same synthetic fixture tenant the live regression harness uses (rooms 101-107, one per
 * status). It holds no secret and talks to no network: the candidate build under test is the only real code
 * in the loop, so a Dependabot PR can be visually verified without any repository secret and without ever
 * exposing credentials to the candidate's dependencies.
 *
 * Determinism rules: fixed ids, fixed timestamps, no clock-derived values in any payload the board renders.
 */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const HERMETIC_PASSWORD = 'hermetic-fixture-not-a-secret'
export const HERMETIC_USERS = {
  'gm@hermetic.invalid': { id: '00000000-0000-4000-8000-0000000000a1', role: 'gm', full_name: 'Hermetic GM' },
  'supervisor@hermetic.invalid': { id: '00000000-0000-4000-8000-0000000000a2', role: 'housekeeping_supervisor', full_name: 'Hermetic Supervisor' },
}
const HOTEL = { id: 'a0000000-0000-4000-a000-000000000001', name: 'Hermetic Fixture Hotel', timezone: 'America/Chicago', room_count: 7, enabled_features: [] }
const ROOM_TYPE = { name: 'Standard', code: 'STD', base_clean_minutes: 30 }
const FIXTURE_ROOMS = [
  ['101', 'DIRTY', false], ['102', 'CLEAN', false], ['103', 'INSPECTED', true], ['104', 'IN_PROGRESS', false],
  ['105', 'PICKUP', false], ['106', 'OCCUPIED', false], ['107', 'OOO', false],
]
const FIXED_TIME = '2020-01-01T12:00:00.000Z'
const IN_PROGRESS_UPDATED_AT = '2020-01-01T12:58:00.000Z' // matches the live fixture: elapsed time stays unavailable

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const userFor = (email) => ({ email, ...HERMETIC_USERS[email] })

function sessionFor(email) {
  const u = userFor(email)
  const exp = 4102444800 // 2100-01-01, fixed so no payload depends on the clock
  const claims = { aud: 'authenticated', exp, iat: 1577836800, sub: u.id, email, role: 'authenticated', user_role: u.role, hotel_id: HOTEL.id }
  return {
    access_token: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.hermetic-signature`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `hermetic-refresh-${u.id}`,
    user: supabaseUser(email),
  }
}

function supabaseUser(email) {
  const u = userFor(email)
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: FIXED_TIME, phone: '', confirmed_at: FIXED_TIME,
    last_sign_in_at: FIXED_TIME, app_metadata: { provider: 'email', providers: ['email'], hotel_id: HOTEL.id, role: u.role },
    user_metadata: {}, identities: [], created_at: FIXED_TIME, updated_at: FIXED_TIME,
  }
}

const boardRows = () => FIXTURE_ROOMS.map(([number, status, vip], index) => ({
  room_id: `00000000-0000-4000-8000-00000000010${index}`,
  tenant_id: HOTEL.id, status, vip_flag: vip, checkin_time: null, checkout_time: null, dnd_flag: false, do_not_service: false,
  fo_status: null, assigned_to: null, guest_name: null, notes: null, updated_at: number === '104' ? IN_PROGRESS_UPDATED_AT : FIXED_TIME,
  rooms: { id: `00000000-0000-4000-8000-00000000010${index}`, room_number: number, floor: 1, building: null, room_types: ROOM_TYPE },
  assignment_id: null, assignment_date: null, assignment_shift_id: null, clean_type: null, clean_type_label: null, prediction: null,
  inspection_required: false,
}))

const STAFF = [
  { id: 'regression-fixture-staff-1', user_id: 'regression-fixture-staff-1', hotel_id: HOTEL.id, full_name: 'Regression Fixture Housekeeper', email: 'housekeeper@regression.fixture', role: 'housekeeper', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  { id: 'regression-fixture-staff-2', user_id: 'regression-fixture-staff-2', hotel_id: HOTEL.id, full_name: 'Regression Fixture Supervisor', email: 'supervisor-staff@regression.fixture', role: 'housekeeping_supervisor', status: 'active', created_at: '2026-01-01T00:00:00Z' },
]

function emailFromAuth(req) {
  try {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).email
  } catch { return null }
}

/** Pure router: (method, path, query, body, caller) -> { status, json } | null (unknown). */
export function route({ method, path, query, body, email }) {
  if (path === '/auth/v1/token') {
    if (query.get('grant_type') === 'refresh_token') {
      const owner = Object.keys(HERMETIC_USERS).find((e) => body?.refresh_token === `hermetic-refresh-${HERMETIC_USERS[e].id}`)
      return owner ? { status: 200, json: sessionFor(owner) } : { status: 400, json: { error: 'invalid_grant', error_description: 'unknown refresh token' } }
    }
    const ok = HERMETIC_USERS[body?.email] && body?.password === HERMETIC_PASSWORD
    return ok ? { status: 200, json: sessionFor(body.email) } : { status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } }
  }
  if (path === '/auth/v1/user') return email && HERMETIC_USERS[email] ? { status: 200, json: supabaseUser(email) } : { status: 401, json: { message: 'invalid JWT' } }
  if (path === '/auth/v1/logout') return { status: 204, json: null }
  if (!path.startsWith('/v1/')) return null
  const api = path.slice(3)
  if (method !== 'GET') return { status: 200, json: { data: {} } }
  if (api === '/auth/me') {
    const u = userFor(email ?? 'gm@hermetic.invalid')
    return { status: 200, json: { user: { id: u.id, email: u.email, role: u.role, full_name: u.full_name }, hotel: HOTEL, hotels: [HOTEL], subscription: { plan_status: 'active', credits_included: 0 } } }
  }
  if (api === '/staff/me/effective-role') {
    const u = userFor(email ?? 'gm@hermetic.invalid')
    return { status: 200, json: { data: { base_role: u.role, effective_role: u.role, schedule_id: null, is_overridden: false, custom_role: null } } }
  }
  if (api === '/housekeeping/board') return { status: 200, json: { data: boardRows() } }
  if (api === '/staff') return { status: 200, json: { data: { staff: STAFF, total: STAFF.length } } }
  if (api.startsWith('/clean-sessions/hotel-avg-clean-time')) return { status: 200, json: { data: { today_avg_minutes: null, seven_day_avg_minutes: null, delta_minutes: null, today_count: 0 } } }
  return { status: 200, json: { data: [], meta: { page: 1, per_page: 50 } }, fallback: true }
}

export function createMockBackend({ log = process.env.HERMETIC_MOCK_LOG } = {}) {
  return createServer((req, res) => {
    const origin = req.headers.origin ?? '*'
    const cors = {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'authorization,content-type,apikey,x-client-info',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
    const url = new URL(req.url, 'http://mock.invalid')
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      let body = null
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null } catch { /* multipart or empty */ }
      const hit = route({ method: req.method, path: url.pathname, query: url.searchParams, body, email: emailFromAuth(req) })
      if (log) appendFileSync(log, `${req.method} ${url.pathname}${url.search} -> ${hit ? hit.status + (hit.fallback ? ' (fallback)' : '') : '404'}\n`)
      if (!hit) { res.writeHead(404, { ...cors, 'Content-Type': 'application/json' }); res.end('{"detail":"hermetic mock: unknown route"}'); return }
      res.writeHead(hit.status, { ...cors, 'Content-Type': 'application/json' })
      res.end(hit.json === null ? '' : JSON.stringify(hit.json))
    })
  }).on('upgrade', (_req, socket) => socket.destroy()) // no realtime: the board falls back to polling
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.HERMETIC_MOCK_PORT ?? 4010)
  createMockBackend().listen(port, '127.0.0.1', () => console.log(`hermetic mock backend listening on http://127.0.0.1:${port}`))
}
