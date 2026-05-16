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

function loadEnvFile(filePath: string) {
  try {
    const fs = require('fs')
    if (!fs.existsSync(filePath)) return
    for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx < 0) continue
      const key = line.slice(0, idx).trim()
      if (process.env[key]) continue
      let value = line.slice(idx + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  } catch {
    // Tests can still rely on process.env when local env files are unavailable.
  }
}

loadEnvFile('apps/web/.env.production')
loadEnvFile('apps/web/.env.local')
loadEnvFile('apps/api/.env')

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.API_URL ||
  'https://api-production-130b.up.railway.app'
).replace(/\/+$/, '').replace(/\/v1$/, '')

function requireEnvPassword(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Set ${name} to run RBAC Playwright helpers`)
  }
  return value
}

export const TEST_PASSWORD = process.env.RBAC_TEST_PASSWORD || process.env.TEST_PASSWORD || ''

const ROLE_DEFINITIONS: Omit<RbacTestUser, 'userId' | 'password'>[] = [
  { role: 'housekeeping_supervisor', email: 'test-hk-supervisor@patelrep-test.com' },
  { role: 'housekeeper',             email: 'test-housekeeper@patelrep-test.com' },
  { role: 'chief_engineer',          email: 'test-chief-eng@patelrep-test.com' },
  { role: 'engineer',                email: 'test-engineer@patelrep-test.com' },
  { role: 'front_desk',              email: 'test-front-desk@patelrep-test.com' },
]

/** Authenticate as GM and return a bearer token. */
export async function getGmToken(
  email = process.env.TEST_EMAIL || 'hp.patelrep@gmail.com',
  password = requireEnvPassword('TEST_PASSWORD'),
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
  const rbacPassword = TEST_PASSWORD || requireEnvPassword('RBAC_TEST_PASSWORD')

  for (const def of ROLE_DEFINITIONS) {
    const user = { ...def, password: rbacPassword }
    try {
      const res = await fetch(`${API_URL}/v1/staff/add-direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          email: user.email,
          password: user.password,
          role: user.role,
          full_name: `Test ${user.role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
        }),
      })

      if (!res.ok) {
        console.warn(`[rbac-seed] Failed to create ${def.role}: ${res.status} ${await res.text()}`)
        created.push({ ...user })
        continue
      }

      const json = await res.json()
      created.push({ ...user, userId: json.data?.user_id })
    } catch (err) {
      console.warn(`[rbac-seed] Error creating ${def.role}:`, err)
      created.push({ ...user })
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
  password: process.env.TEST_PASSWORD || '',
}
