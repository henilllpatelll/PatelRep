#!/usr/bin/env node
/**
 * Seeds (idempotently) the FOUND-03 regression fixture tenant: a dedicated,
 * never-operated tenant with a fixed set of rooms covering every room status
 * and one fixed work order, backing the Playwright pixel-diff baseline in
 * `room-board-baseline.spec.ts`. Safe to re-run — every write is scoped to
 * FIXTURE_TENANT_ID and converges to the same canonical values.
 *
 * Cron-inert by construction (verified against apps/api/routers/internal.py
 * and apps/api/services/ai/predictions.py at authoring time):
 *   - every room has checkin_time = NULL      -> predictions.run's
 *     get_at_risk_rooms() requires checkin_time IS NOT NULL, so this fixture
 *     never gets a room_readiness_predictions row (no ETA/risk chip ever
 *     appears or changes).
 *   - every room has dnd_flag = FALSE         -> escalations.check's DND
 *     welfare scan (`WHERE dnd_flag = TRUE`) never touches this fixture.
 *   - the one work order has due_at = 2099-01-01 and escalation_level = 0,
 *     and assigned_to = NULL                  -> escalations.check's WO
 *     query requires assigned_to IS NOT NULL AND due_at < now(), so this WO
 *     can never be escalated regardless of when the cron runs.
 *   - no pm_schedules / opera_credentials / lost_found_items / assets /
 *     tasks / safety_training_courses rows are created for this tenant, so
 *     every other 30-minute or daily cron job is a no-op for this tenant
 *     (each of those jobs only acts on tenants that have matching rows).
 *
 * Usage:
 *   node e2e/fixtures/seed-regression-tenant.mjs
 *
 * Requires in environment (see loadEnvFallback() below for the local-dev
 * fallback file locations): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * REGRESSION_GM_EMAIL, REGRESSION_GM_PASSWORD, REGRESSION_SUP_EMAIL,
 * REGRESSION_SUP_PASSWORD.
 */
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(__dirname, '..', '..') // apps/web
const REPO_ROOT = join(WEB_ROOT, '..', '..')

// ── Fixed identifiers (never regenerate — these are the stable fixture keys) ──

const FIXTURE_TENANT_ID = 'a0000000-0000-4000-a000-000000000001'
const FIXTURE_TENANT_SLUG = 'regression-fixture-do-not-operate'
const FIXTURE_TENANT_NAME = 'REGRESSION FIXTURE — DO NOT OPERATE'
const FIXTURE_ROOM_TYPE_CODE = 'STD'

const FIXTURE_ROOMS = [
  { room_number: '101', status: 'DIRTY', vip: false },
  { room_number: '102', status: 'CLEAN', vip: false },
  { room_number: '103', status: 'INSPECTED', vip: true },
  { room_number: '104', status: 'IN_PROGRESS', vip: false },
  { room_number: '105', status: 'PICKUP', vip: false },
  { room_number: '106', status: 'OCCUPIED', vip: false },
  { room_number: '107', status: 'OOO', vip: false },
]

const FIXTURE_WORK_ORDER_TITLE = 'Regression fixture work order — DO NOT ACTION'

// ── Minimal .env loader (no new dependency) ──────────────────────────────────
// Mirrors this project's local-dev convention: SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY live in apps/api/.env; the 4 fixture-credential
// vars live in apps/web/.env.regression (gitignored, generated on first run
// below if absent). Real environment variables always win.

function loadEnvFileFallback(path) {
  if (!existsSync(path)) return
  const contents = readFileSync(path, 'utf8')
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFileFallback(join(REPO_ROOT, 'apps', 'api', '.env'))
loadEnvFileFallback(join(WEB_ROOT, '.env.regression'))

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function generateAndPersistCredentials() {
  // First run only: generate stable random passwords for the two fixture
  // roles and persist them to a gitignored file so subsequent runs (and the
  // Playwright globalSetup that logs in with them) stay convergent.
  const envRegressionPath = join(WEB_ROOT, '.env.regression')
  const lines = [
    `REGRESSION_GM_EMAIL=regression-fixture-gm@patelrep.test`,
    `REGRESSION_GM_PASSWORD=${randomBytes(18).toString('base64url')}`,
    `REGRESSION_SUP_EMAIL=regression-fixture-supervisor@patelrep.test`,
    `REGRESSION_SUP_PASSWORD=${randomBytes(18).toString('base64url')}`,
  ]
  appendFileSync(envRegressionPath, (existsSync(envRegressionPath) ? '\n' : '') + lines.join('\n') + '\n')
  loadEnvFileFallback(envRegressionPath)
  console.log(`Generated fixture credentials -> ${envRegressionPath} (gitignored, not printed here)`)
}

if (!process.env.REGRESSION_GM_EMAIL || !process.env.REGRESSION_SUP_EMAIL) {
  generateAndPersistCredentials()
}

const SUPABASE_URL = requireEnv('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const GM_EMAIL = requireEnv('REGRESSION_GM_EMAIL')
const GM_PASSWORD = requireEnv('REGRESSION_GM_PASSWORD')
const SUP_EMAIL = requireEnv('REGRESSION_SUP_EMAIL')
const SUP_PASSWORD = requireEnv('REGRESSION_SUP_PASSWORD')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findAuthUserByEmail(email) {
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (match) return match
    if (data.users.length < perPage) return null
    page += 1
  }
}

/** Create (or converge the password of) a fixture auth user. Returns the user id. */
async function upsertAuthUser(email, password, fullName) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { hotel_id: FIXTURE_TENANT_ID, full_name: fullName },
  })
  if (!error) return data.user.id

  const alreadyExists = /already.*registered|already.*exists/i.test(error.message || '')
  if (!alreadyExists) throw error

  const existing = await findAuthUserByEmail(email)
  if (!existing) throw new Error(`Auth user ${email} reported as existing but could not be located`)
  const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
    password,
    user_metadata: { hotel_id: FIXTURE_TENANT_ID, full_name: fullName },
  })
  if (updateError) throw updateError
  return existing.id
}

async function main() {
  console.log(`Seeding regression fixture tenant ${FIXTURE_TENANT_ID} ...`)

  // 1. Tenant (upsert by primary key) -----------------------------------------
  const { error: tenantError } = await supabase.from('tenants').upsert(
    {
      id: FIXTURE_TENANT_ID,
      name: FIXTURE_TENANT_NAME,
      slug: FIXTURE_TENANT_SLUG,
      state: 'TX',
      room_count: FIXTURE_ROOMS.length,
      timezone: 'America/Chicago',
      is_active: true,
      is_test: false,
      web_redesign_sections: [],
    },
    { onConflict: 'id' },
  )
  if (tenantError) throw tenantError

  // 2. Room type (upsert by tenant_id+code) ------------------------------------
  const { data: roomType, error: roomTypeError } = await supabase
    .from('room_types')
    .upsert(
      {
        tenant_id: FIXTURE_TENANT_ID,
        name: 'Standard King',
        code: FIXTURE_ROOM_TYPE_CODE,
        base_clean_minutes: 30,
        stayover_minutes: 20,
        max_occupancy: 2,
      },
      { onConflict: 'tenant_id,code' },
    )
    .select('id')
    .single()
  if (roomTypeError) throw roomTypeError

  // 3. Fixture users -------------------------------------------------------------
  const gmUserId = await upsertAuthUser(GM_EMAIL, GM_PASSWORD, 'Regression Fixture GM')
  const supUserId = await upsertAuthUser(SUP_EMAIL, SUP_PASSWORD, 'Regression Fixture Supervisor')

  for (const [userId, fullName] of [
    [gmUserId, 'Regression Fixture GM'],
    [supUserId, 'Regression Fixture Supervisor'],
  ]) {
    const { error: profileError } = await supabase.from('user_profiles').upsert(
      {
        id: userId,
        tenant_id: FIXTURE_TENANT_ID,
        full_name: fullName,
        preferred_name: fullName.split(' ').pop(),
        language_pref: 'en',
        is_active: true,
      },
      { onConflict: 'id' },
    )
    if (profileError) throw profileError
  }

  const { error: gmRoleError } = await supabase.from('user_roles').upsert(
    { user_id: gmUserId, tenant_id: FIXTURE_TENANT_ID, role: 'gm', is_active: true },
    { onConflict: 'user_id,tenant_id,role' },
  )
  if (gmRoleError) throw gmRoleError

  const { error: supRoleError } = await supabase.from('user_roles').upsert(
    { user_id: supUserId, tenant_id: FIXTURE_TENANT_ID, role: 'housekeeping_supervisor', is_active: true },
    { onConflict: 'user_id,tenant_id,role' },
  )
  if (supRoleError) throw supRoleError

  // 4. Rooms + room_status (cron-inert) -------------------------------------------
  const roomIdByNumber = {}
  for (const fixtureRoom of FIXTURE_ROOMS) {
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .upsert(
        {
          tenant_id: FIXTURE_TENANT_ID,
          room_number: fixtureRoom.room_number,
          floor: 1,
          room_type_id: roomType.id,
          is_active: true,
        },
        { onConflict: 'tenant_id,room_number' },
      )
      .select('id')
      .single()
    if (roomError) throw roomError
    roomIdByNumber[fixtureRoom.room_number] = room.id

    const { error: statusError } = await supabase.from('room_status').upsert(
      {
        room_id: room.id,
        tenant_id: FIXTURE_TENANT_ID,
        status: fixtureRoom.status,
        vip_flag: fixtureRoom.vip,
        // Cron-inert (see header comment): never eligible for a prediction row.
        checkin_time: null,
        checkout_time: null,
        dnd_flag: false,
        do_not_service: false,
        clean_type: null,
        fo_status: null,
        assigned_to: null,
        guest_name: null,
        notes: null,
      },
      { onConflict: 'room_id' },
    )
    if (statusError) throw statusError
  }

  // 5. One fixed, cron-inert work order (attached to the OOO room) ----------------
  const { data: existingWorkOrder, error: findWoError } = await supabase
    .from('work_orders')
    .select('id')
    .eq('tenant_id', FIXTURE_TENANT_ID)
    .eq('title', FIXTURE_WORK_ORDER_TITLE)
    .maybeSingle()
  if (findWoError) throw findWoError

  const canonicalWorkOrder = {
    tenant_id: FIXTURE_TENANT_ID,
    title: FIXTURE_WORK_ORDER_TITLE,
    description: 'Fixed regression-fixture work order. Never claim, never complete.',
    category: 'general',
    priority: 'normal',
    status: 'open',
    room_id: roomIdByNumber['107'],
    assigned_to: null,
    created_by: gmUserId,
    is_ai_created: false,
    is_pm_generated: false,
    // Cron-inert (see header comment): escalations.check requires
    // assigned_to IS NOT NULL AND due_at < now() — both conditions are
    // permanently false here (assigned_to NULL, due_at far future).
    due_at: '2099-01-01T00:00:00Z',
    escalation_level: 0,
  }

  if (existingWorkOrder) {
    const { error: updateWoError } = await supabase
      .from('work_orders')
      .update(canonicalWorkOrder)
      .eq('id', existingWorkOrder.id)
    if (updateWoError) throw updateWoError
  } else {
    const { error: insertWoError } = await supabase.from('work_orders').insert(canonicalWorkOrder)
    if (insertWoError) throw insertWoError
  }

  console.log('Regression fixture tenant seed complete.')
  console.log(`  Tenant: ${FIXTURE_TENANT_ID} (${FIXTURE_TENANT_SLUG})`)
  console.log(`  Rooms: ${FIXTURE_ROOMS.map((r) => `${r.room_number}=${r.status}`).join(', ')}`)
  console.log(`  Work order: "${FIXTURE_WORK_ORDER_TITLE}" on room 107`)
  console.log(`  Fixture users: ${GM_EMAIL} (gm), ${SUP_EMAIL} (housekeeping_supervisor)`)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exitCode = 1
})
