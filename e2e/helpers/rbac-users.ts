/**
 * RBAC test user helpers.
 *
 * Creates/tears-down one temporary @patelrep-test.com user per role.
 * Uses POST /staff/add-direct (GM-only) to provision them inside the
 * GM test hotel so they have real JWT claims and can log in.
 *
 * Usage in a Playwright global setup:
 *   const { seedRbacUsers, teardownRbacUsers } = require('./helpers/rbac-users')
 *   const users = await seedRbacUsers(gmToken)
 *   // … run RBAC tests …
 *   await teardownRbacUsers(gmToken, users)
 *
 * Or import directly in a spec that needs per-role browser contexts.
 */

export type HotelRole =
  | 'gm'
  | 'housekeeping_supervisor'
  | 'housekeeper'
  | 'chief_engineer'
  | 'engineer'
  | 'front_desk'

export interface RbacTestUser {
  role: HotelRole
  email: string
  password: string
  userId?: string
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.API_URL ||
  'https://api-production-a914.up.railway.app'

const TEST_PASSWORD = 'RbacTest2026!'

const ROLE_DEFINITIONS: Omit<RbacTestUser, 'userId'>[] = [
  { role: 'housekeeping_supervisor', email: 'test-hk-supervisor@patelrep-test.com', password: TEST_PASSWORD },
  { role: 'housekeeper',             email: 'test-housekeeper@patelrep-test.com',   password: TEST_PASSWORD },
  { role: 'chief_engineer',          email: 'test-chief-eng@patelrep-test.com',     password: TEST_PASSWORD },
  { role: 'engineer',                email: 'test-engineer@patelrep-test.com',      password: TEST_PASSWORD },
  { role: 'front_desk',              email: 'test-front-desk@patelrep-test.com',    password: TEST_PASSWORD },
]

/** Authenticate as GM and return a bearer token. */
export async function getGmToken(
  email = process.env.TEST_EMAIL || 'hp.patelrep@gmail.com',
  password = process.env.TEST_PASSWORD || 'PatelRep2026x',
): Promise<string> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://oacnwalhcpqdabivweki.supabase.co'
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim()

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    throw new Error(`GM login failed: ${res.status} ${await res.text()}`)
  }

  const json = await res.json()
  if (!json.access_token) {
    throw new Error(`GM login: no access_token in response`)
  }
  return json.access_token as string
}

/**
 * Create all 5 non-GM test users under the GM's hotel via POST /staff/add-direct.
 * Returns the list of created users (with userId populated from response).
 * Idempotent — if the user already exists, the endpoint reuses the auth user.
 */
export async function seedRbacUsers(gmToken: string): Promise<RbacTestUser[]> {
  const created: RbacTestUser[] = []

  for (const def of ROLE_DEFINITIONS) {
    try {
      const res = await fetch(`${API_URL}/v1/staff/add-direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          email: def.email,
          password: def.password,
          role: def.role,
          full_name: `Test ${def.role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
        }),
      })

      if (!res.ok) {
        console.warn(`[rbac-seed] Failed to create ${def.role}: ${res.status} ${await res.text()}`)
        created.push({ ...def })
        continue
      }

      const json = await res.json()
      created.push({ ...def, userId: json.data?.user_id })
    } catch (err) {
      console.warn(`[rbac-seed] Error creating ${def.role}:`, err)
      created.push({ ...def })
    }
  }

  return created
}

/**
 * Deactivate all test users.  Uses DELETE /staff/{user_id} (soft-delete, GM only).
 * Safe to call even if some users were never created.
 */
export async function teardownRbacUsers(
  gmToken: string,
  users: RbacTestUser[],
): Promise<void> {
  for (const u of users) {
    if (!u.userId) continue
    try {
      await fetch(`${API_URL}/v1/staff/${u.userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${gmToken}` },
      })
    } catch (err) {
      console.warn(`[rbac-teardown] Error removing ${u.role} (${u.userId}):`, err)
    }
  }
}

/**
 * Log in as a specific test user and return their access token.
 * Useful for making API assertions in a role-scoped context.
 */
export async function loginAs(user: RbacTestUser): Promise<string> {
  return getGmToken(user.email, user.password)
}

/**
 * Convenience: all 6 roles including the fixed GM account.
 * Callers can iterate this for full RBAC coverage.
 */
export const ALL_TEST_ROLES: HotelRole[] = [
  'gm',
  'housekeeping_supervisor',
  'housekeeper',
  'chief_engineer',
  'engineer',
  'front_desk',
]

/** Pre-defined credentials for the durable GM test account. */
export const GM_TEST_USER: RbacTestUser = {
  role: 'gm',
  email: process.env.TEST_EMAIL || 'hp.patelrep@gmail.com',
  password: process.env.TEST_PASSWORD || 'PatelRep2026x',
}
