#!/usr/bin/env node
/**
 * Idempotent synthetic staging fixture. It is intentionally unable to run
 * against production: no .env fallback, explicit staging confirmation, and
 * an exact Supabase-host allowlist are required.
 */
import { createClient } from '@supabase/supabase-js'

const TENANT_ID = 'b0000000-0000-4000-b000-000000000002'
const TENANT_SLUG = 'patelrep-staging-fixture'
const PASSWORD = process.env.STAGING_FIXTURE_PASSWORD
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EXPECTED_HOST = process.env.STAGING_EXPECTED_SUPABASE_HOST

if (process.env.APP_ENV !== 'staging' || process.env.SEED_STAGING_FIXTURES !== 'confirm') {
  throw new Error('Refusing fixture seed: set APP_ENV=staging and SEED_STAGING_FIXTURES=confirm.')
}
if (!PASSWORD || !SUPABASE_URL || !SERVICE_ROLE_KEY || !EXPECTED_HOST) {
  throw new Error('STAGING_FIXTURE_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and STAGING_EXPECTED_SUPABASE_HOST are required.')
}
if (new URL(SUPABASE_URL).hostname !== EXPECTED_HOST) {
  throw new Error('Refusing fixture seed: SUPABASE_URL does not match STAGING_EXPECTED_SUPABASE_HOST.')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const users = [
  ['staging-gm@patelrep.test', 'Staging GM', 'gm'],
  ['staging-front-desk@patelrep.test', 'Staging Front Desk', 'front_desk'],
  ['staging-housekeeping-supervisor@patelrep.test', 'Staging Housekeeping Supervisor', 'housekeeping_supervisor'],
  ['staging-housekeeper@patelrep.test', 'Staging Housekeeper', 'housekeeper'],
  ['staging-chief-engineer@patelrep.test', 'Staging Chief Engineer', 'chief_engineer'],
  ['staging-engineer@patelrep.test', 'Staging Engineer', 'engineer'],
]

async function requireOk(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`)
  return result.data
}

async function authUser(email, fullName) {
  const created = await supabase.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { hotel_id: TENANT_ID, full_name: fullName, staging_fixture: true },
  })
  if (!created.error) return created.data.user.id
  if (!/already.*(registered|exists)/i.test(created.error.message)) throw created.error
  let page = 1
  for (;;) {
    const data = await requireOk(await supabase.auth.admin.listUsers({ page, perPage: 200 }), 'List staging users')
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (user) {
      await requireOk(await supabase.auth.admin.updateUserById(user.id, { password: PASSWORD, user_metadata: { hotel_id: TENANT_ID, full_name: fullName, staging_fixture: true } }), 'Update staging user')
      return user.id
    }
    if (data.users.length < 200) throw new Error(`Existing staging user ${email} could not be located.`)
    page += 1
  }
}

async function first(table, filters) {
  let query = supabase.from(table).select('id').eq('tenant_id', TENANT_ID).limit(1)
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value)
  const data = await requireOk(await query, `Find ${table}`)
  return data[0]?.id
}

async function main() {
  await requireOk(await supabase.from('tenants').upsert({
    id: TENANT_ID, slug: TENANT_SLUG, name: 'PatelRep Staging Hotel — Synthetic Only',
    state: 'TX', room_count: 4, timezone: 'America/Chicago', is_active: true, is_test: true,
  }, { onConflict: 'id' }), 'Upsert staging tenant')

  const departmentRows = [
    { tenant_id: TENANT_ID, code: 'HK', name: 'Housekeeping', color: '#2F5D50' },
    { tenant_id: TENANT_ID, code: 'ENG', name: 'Engineering', color: '#1D4ED8' },
    { tenant_id: TENANT_ID, code: 'FD', name: 'Front Desk', color: '#7C3AED' },
  ]
  await requireOk(await supabase.from('departments').upsert(departmentRows, { onConflict: 'tenant_id,code' }), 'Upsert departments')
  const departments = Object.fromEntries(await Promise.all(departmentRows.map(async ({ code }) => [code, await first('departments', { code })])))

  const roomType = await requireOk(await supabase.from('room_types').upsert({
    tenant_id: TENANT_ID, code: 'STG-K', name: 'Staging King', base_clean_minutes: 30, stayover_minutes: 20, max_occupancy: 2,
  }, { onConflict: 'tenant_id,code' }).select('id').single(), 'Upsert room type')
  const rooms = {}
  for (const [roomNumber, status] of [['101', 'DIRTY'], ['102', 'IN_PROGRESS'], ['103', 'CLEAN'], ['104', 'INSPECTED']]) {
    const room = await requireOk(await supabase.from('rooms').upsert({ tenant_id: TENANT_ID, room_number: roomNumber, floor: 1, room_type_id: roomType.id, is_active: true }, { onConflict: 'tenant_id,room_number' }).select('id').single(), `Upsert room ${roomNumber}`)
    rooms[roomNumber] = room.id
    await requireOk(await supabase.from('room_status').upsert({ room_id: room.id, tenant_id: TENANT_ID, status, vip_flag: false, dnd_flag: false, do_not_service: false }, { onConflict: 'room_id' }), `Upsert room status ${roomNumber}`)
  }

  const userIds = {}
  for (const [email, fullName, role] of users) {
    const userId = await authUser(email, fullName)
    userIds[role] = userId
    await requireOk(await supabase.from('user_profiles').upsert({ id: userId, tenant_id: TENANT_ID, full_name: fullName, preferred_name: fullName.replace('Staging ', ''), language_pref: 'en', is_active: true }, { onConflict: 'id' }), `Upsert profile ${role}`)
    await requireOk(await supabase.from('user_roles').upsert({ user_id: userId, tenant_id: TENANT_ID, role, is_active: true }, { onConflict: 'user_id,tenant_id,role' }), `Upsert role ${role}`)
  }
  await requireOk(await supabase.from('housekeeper_profiles').upsert({ user_id: userIds.housekeeper, tenant_id: TENANT_ID, room_type_id: roomType.id, avg_clean_minutes: 28, completion_count: 8 }, { onConflict: 'user_id,room_type_id' }), 'Upsert housekeeper profile')

  const assetCategory = await requireOk(await supabase.from('asset_categories').upsert({ tenant_id: TENANT_ID, code: 'HVAC', name: 'HVAC', default_pm_interval_days: 90 }, { onConflict: 'tenant_id,code' }).select('id').single(), 'Upsert asset category')
  const assetId = await first('assets', { asset_tag: 'STG-HVAC-101' })
  if (!assetId) await requireOk(await supabase.from('assets').insert({ tenant_id: TENANT_ID, name: 'Synthetic PTAC 101', asset_tag: 'STG-HVAC-101', category_id: assetCategory.id, room_id: rooms['101'], is_active: true }), 'Insert staging asset')

  const taskId = await first('tasks', { title: 'Synthetic staging towel delivery' }) || await requireOk(await supabase.from('tasks').insert({ tenant_id: TENANT_ID, title: 'Synthetic staging towel delivery', description: 'Synthetic fixture only', task_type: 'guest_request', priority: 'normal', status: 'open', room_id: rooms['102'], department_id: departments.FD, assigned_to: userIds.front_desk, created_by: userIds.gm }).select('id').single(), 'Insert staging task').id
  if (!await first('work_orders', { title: 'Synthetic staging PTAC check' })) await requireOk(await supabase.from('work_orders').insert({ tenant_id: TENANT_ID, title: 'Synthetic staging PTAC check', description: 'Synthetic fixture only', category: 'hvac', priority: 'normal', status: 'open', room_id: rooms['101'], assigned_to: userIds.engineer, created_by: userIds.chief_engineer, is_ai_created: false, is_pm_generated: false }), 'Insert staging work order')
  if (!await first('guest_requests', { title: 'Synthetic extra towels' })) await requireOk(await supabase.from('guest_requests').insert({ tenant_id: TENANT_ID, title: 'Synthetic extra towels', description: 'Synthetic fixture only', room_id: rooms['102'], guest_name: 'Staging Guest', task_id: taskId, status: 'open', created_by: userIds.front_desk }), 'Insert staging guest request')
  if (!await first('lost_found_items', { description: 'Synthetic blue umbrella' })) await requireOk(await supabase.from('lost_found_items').insert({ tenant_id: TENANT_ID, description: 'Synthetic blue umbrella', room_id: rooms['104'], location_found: 'Room 104', found_by: userIds.housekeeper, status: 'unclaimed', notes: 'Synthetic fixture only' }), 'Insert staging lost and found item')
  if (!await first('logbook_entries', { content: 'Synthetic staging handoff' })) await requireOk(await supabase.from('logbook_entries').insert({ tenant_id: TENANT_ID, department_id: departments.HK, content: 'Synthetic staging handoff', author_id: userIds.housekeeping_supervisor, is_ai_generated: false }), 'Insert staging logbook entry')

  console.log(`Synthetic staging fixture is ready for ${TENANT_SLUG}; six role users were converged without production access.`)
}

await main()
