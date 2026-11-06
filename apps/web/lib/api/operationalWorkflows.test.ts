/**
 * Phase 12: automated workflow contracts for the operational flows the V2 audit left unverified.
 *
 * These drive the REAL typed API clients and the REAL `apiClient` transport against a stubbed `fetch`, so every case
 * checks what actually goes over the wire (method, path, JSON / multipart body, auth-free headers) and how realistic
 * server answers come back (success unwrap, FastAPI 422 arrays, 403 guards, 409 conflicts, 5xx leaks, network loss,
 * 204, 429). Nothing here can reach a network, production, or shared staging.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ApiClientError } from '@/lib/api/client'
import { engineeringApi } from '@/lib/api/engineering'
import { housekeepingApi, type InspectionTemplate, type SubmitInspectionPayload } from '@/lib/api/housekeeping'
import { logbookApi } from '@/lib/api/logbook'
import { lostFoundApi } from '@/lib/api/lost_found'
import { programsApi } from '@/lib/api/programs'
import { deriveInspectionResult, requiredFailedPhotoItems, requiredUnansweredItems } from '@/lib/housekeeping/inspectionWorkflow'

type Hit = { method: string; path: string; search: string; headers: Record<string, string>; body: unknown }
type Reply = { status: number; json?: unknown; headers?: Record<string, string> } | 'network'

const realFetch = globalThis.fetch
let hits: Hit[] = []
let replies: Reply[] = []

const ok = (data: unknown, extra: Record<string, unknown> = {}): Reply => ({ status: 200, json: { data, ...extra } })
const fail = (status: number, detail: unknown, headers?: Record<string, string>): Reply => ({ status, json: { detail }, headers })

beforeEach(() => {
  hits = []
  replies = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const raw = init?.body
    hits.push({
      method: String(init?.method), path: url.pathname, search: url.search,
      headers: { ...(init?.headers as Record<string, string>) },
      body: raw instanceof FormData ? raw : typeof raw === 'string' ? JSON.parse(raw) : undefined,
    })
    const next = replies.shift()
    if (!next) throw new Error(`unexpected request ${init?.method} ${url.pathname}`)
    if (next === 'network') throw new TypeError('fetch failed')
    if (next.status === 204) return new Response(null, { status: 204 })
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status, headers: { 'Content-Type': 'application/json', ...next.headers } })
  }) as typeof fetch
})
afterEach(() => { globalThis.fetch = realFetch })

async function rejection(promise: Promise<unknown>): Promise<ApiClientError> {
  try { await promise } catch (err) { assert.ok(err instanceof ApiClientError, 'transport errors are ApiClientError'); return err }
  assert.fail('expected the request to be rejected')
}
const last = () => hits[hits.length - 1]

// ── 1. Housekeeping: inspection submission and room-release eligibility ────────────────────────────────────────────
describe('inspection submission and room release', () => {
  const items = [
    { id: 'i1', section: 'Bath', description: 'Towels', is_required: true, requires_photo_on_fail: true, sort_order: 1 },
    { id: 'i2', section: 'Bath', description: 'Mirror', is_required: true, requires_photo_on_fail: false, sort_order: 2 },
    { id: 'i3', section: 'Room', description: 'Minibar', is_required: false, requires_photo_on_fail: false, sort_order: 3 },
  ] satisfies InspectionTemplate['items']

  it('blocks submit until every required item is answered, then derives the result the payload carries', async () => {
    assert.deepEqual(requiredUnansweredItems(items, { i1: 'pass' }).map((i) => i.id), ['i2'])
    assert.equal(requiredUnansweredItems(items, { i1: 'pass', i2: 'na' }).length, 0, 'N/A counts as answered')
    assert.equal(deriveInspectionResult(items, { i1: 'pass', i2: 'na' }), 'passed')
    assert.equal(deriveInspectionResult(items, { i1: 'pass', i2: 'fail' }), 'failed')

    const answers = { i1: 'pass', i2: 'fail', i3: 'na' } as const
    const payload: SubmitInspectionPayload = {
      room_id: 'room-103', template_id: 't1', overall_result: deriveInspectionResult(items, answers), notes: 'Mirror cracked',
      items: items.map((i) => ({ template_item_id: i.id, result: answers[i.id as keyof typeof answers] })),
    }
    replies.push(ok({ id: 'insp-1' }))
    const res = await housekeepingApi.submitInspection(payload)
    assert.equal(res.data.id, 'insp-1')
    assert.deepEqual([last().method, last().path.endsWith('/housekeeping/inspections')], ['POST', true])
    assert.deepEqual(last().body, payload)
    assert.equal(last().headers['Content-Type'], 'application/json')
  })

  it('requires evidence only for failed items configured for it, and sends photos as multipart without a JSON content type', async () => {
    const answers = { i1: 'fail', i2: 'fail' } as const
    assert.deepEqual(requiredFailedPhotoItems(items, answers, new Set()).map((i) => i.id), ['i1'])
    assert.equal(requiredFailedPhotoItems(items, answers, new Set(['i1'])).length, 0)

    const payload: SubmitInspectionPayload = {
      room_id: 'room-103', template_id: 't1', overall_result: 'failed',
      items: [{ template_item_id: 'i1', result: 'fail' }, { template_item_id: 'i2', result: 'fail' }],
    }
    const photo = new File(['x'], 'towels.jpg', { type: 'image/jpeg' })
    replies.push(ok({ id: 'insp-2', overall_result: 'failed', reclean_requested: true }))
    const res = await housekeepingApi.completeInspection(payload, { i1: photo })
    assert.equal(res.data.reclean_requested, true)
    assert.equal(last().path.endsWith('/housekeeping/inspections/complete'), true)
    assert.equal('Content-Type' in last().headers, false, 'the browser must set the multipart boundary')
    const form = last().body as FormData
    assert.deepEqual(JSON.parse(String(form.get('inspection'))), payload)
    assert.deepEqual(form.getAll('photo_item_ids'), ['i1'])
    assert.equal((form.getAll('photos')[0] as File).name, 'towels.jpg')
  })

  it('surfaces a 422 validation array with field locations and keeps the room unreleased on 409', async () => {
    replies.push(fail(422, [{ loc: ['body', 'items', 0, 'result'], msg: 'Input should be pass, fail or na', type: 'enum' }]))
    const validation = await rejection(housekeepingApi.submitInspection({ room_id: 'r', template_id: null, overall_result: 'passed', items: [] }))
    assert.equal(validation.status, 422)
    assert.equal(validation.message, '[body.items.0.result] Input should be pass, fail or na')

    replies.push(fail(409, 'Room cannot be released: its latest inspection failed'))
    const blocked = await rejection(housekeepingApi.updateRoomStatus('room-103', 'INSPECTED', 'release attempt'))
    assert.equal(blocked.status, 409)
    assert.equal(blocked.message, 'Room cannot be released: its latest inspection failed')
    assert.deepEqual(last().body, { status: 'INSPECTED', notes: 'release attempt' })

    replies.push(fail(403, 'You do not have permission to inspect rooms'))
    assert.equal((await rejection(housekeepingApi.submitInspection({ room_id: 'r', template_id: null, overall_result: 'passed', items: [] }))).status, 403)
  })

  it('a failed inspection triggers a reclean task; success hands back the task for the UI to show', async () => {
    replies.push(ok({ room_id: 'room-103', task: { id: 'task-9', title: 'Re-clean 103' } }))
    const res = await housekeepingApi.triggerReclean('insp-2')
    assert.equal(last().path.endsWith('/housekeeping/inspections/insp-2/reclean'), true)
    assert.deepEqual(last().body, {}, 'reclean takes no parameters beyond the inspection id')
    assert.equal(res.data.task?.id, 'task-9')
  })
})

// ── 2. Engineering: asset readings and work-order completion forms ────────────────────────────────────────────────
describe('engineering asset readings and forms', () => {
  it('records a meter reading with the exact numeric payload and returns the stored reading', async () => {
    replies.push(ok({ id: 'rd-1', value: 41.5, status: 'warning' }))
    const res = await engineeringApi.recordMeterReading('meter-7', { value: 41.5, notes: 'Walk-in cooler, door open' })
    assert.deepEqual([last().method, last().path.endsWith('/assets/meters/meter-7/readings')], ['POST', true])
    assert.deepEqual(last().body, { value: 41.5, notes: 'Walk-in cooler, door open' })
    assert.equal(res.data.id, 'rd-1')
  })

  it('maps a rejected reading (422 non-numeric, 403 for a role that cannot record) to a readable error', async () => {
    replies.push(fail(422, [{ loc: ['body', 'value'], msg: 'Input should be a valid number', type: 'float_parsing' }]))
    const bad = await rejection(engineeringApi.recordMeterReading('meter-7', { value: Number.NaN }))
    assert.equal(bad.status, 422)
    assert.match(bad.message, /\[body\.value\] Input should be a valid number/)

    replies.push(fail(403, 'Only engineering staff can record readings'))
    assert.equal((await rejection(engineeringApi.recordMeterReading('meter-7', { value: 3 }))).message, 'Only engineering staff can record readings')
  })

  it('creates a meter with thresholds and a critical action, and sends the completion form with structured parts', async () => {
    replies.push(ok({ id: 'meter-8' }))
    await engineeringApi.createAssetMeter('asset-1', { name: 'Cooler temp', meter_type: 'temperature', unit: '°F', warning_high: 41, critical_high: 45, critical_action: 'create_work_order' })
    assert.equal(last().path.endsWith('/assets/asset-1/meters'), true)
    assert.deepEqual(last().body, { name: 'Cooler temp', meter_type: 'temperature', unit: '°F', warning_high: 41, critical_high: 45, critical_action: 'create_work_order' })

    replies.push(ok({ id: 'wo-1', status: 'completed' }))
    const form = { notes: 'Replaced contactor', labor_hours: 1.5, verification_result: 'passed' as const, asset_restoration: 'restore' as const, parts_consumed: [{ part_id: 'p1', location_id: 'l1', quantity: 2 }] }
    await engineeringApi.completeWorkOrder('wo-1', form)
    assert.equal(last().path.endsWith('/work-orders/wo-1/complete'), true)
    assert.deepEqual(last().body, form)

    replies.push(fail(409, 'Insufficient stock for part p1'))
    assert.equal((await rejection(engineeringApi.completeWorkOrder('wo-1', form))).status, 409)
  })
})

// ── 3. PM completion and vendor engagement ───────────────────────────────────────────────────────────────────────
describe('PM completion and vendor engagement', () => {
  const completion = {
    items: [
      { key: 'belts', label: 'Belts', result: 'passed' as const, requires_evidence: false, evidence: [] },
      { key: 'filter', label: 'Filter', result: 'failed' as const, requires_evidence: true, evidence: ['ev-1'], note: 'Torn' },
    ],
    condition_readings: [{ meter_id: 'meter-7', value: 38 }], labor_minutes: 45, vendor_name: 'Cool Air Co', notes: 'Quarterly',
  }

  it('completes a PM with checklist results, linked condition readings and a vendor in one payload', async () => {
    replies.push(ok({ id: 'comp-1' }))
    await programsApi.completePM('pm-1', completion)
    assert.deepEqual([last().method, last().path.endsWith('/assets/pm-schedules/pm-1/complete')], ['POST', true])
    assert.deepEqual(last().body, completion)
  })

  it('rejects a double completion (409) and a missing-evidence submit (422) without altering the payload contract', async () => {
    replies.push(fail(409, 'This PM was already completed for the current due date'))
    const dup = await rejection(programsApi.completePM('pm-1', completion))
    assert.equal(dup.status, 409)
    assert.equal(dup.message, 'This PM was already completed for the current due date')

    replies.push(fail(422, [{ loc: ['body', 'items', 1, 'evidence'], msg: 'Evidence is required for a failed item', type: 'value_error' }]))
    assert.match((await rejection(programsApi.completePM('pm-1', completion))).message, /Evidence is required for a failed item/)
  })

  it('engages a vendor and flags the work order waiting, then advances the engagement status', async () => {
    replies.push(ok({ id: 'eng-1', status: 'contacted' }))
    await engineeringApi.contactVendor('wo-1', { vendor_id: 'v-1', service_type: 'emergency', expected_arrival_at: '2026-11-08T15:00:00Z', quote_amount: 450, mark_work_order_waiting: true })
    assert.equal(last().path.endsWith('/engineering/vendors/work-orders/wo-1/engagements'), true)
    assert.deepEqual(last().body, { vendor_id: 'v-1', service_type: 'emergency', expected_arrival_at: '2026-11-08T15:00:00Z', quote_amount: 450, mark_work_order_waiting: true })

    replies.push(ok({ id: 'eng-1', status: 'on_site' }))
    await engineeringApi.updateVendorEngagement('eng-1', { status: 'on_site' })
    assert.deepEqual([last().method, last().path.endsWith('/engineering/vendors/engagements/eng-1')], ['PATCH', true])
    assert.deepEqual(last().body, { status: 'on_site' })

    replies.push(fail(403, 'You do not have permission to engage vendors'))
    assert.equal((await rejection(engineeringApi.contactVendor('wo-1', { vendor_id: 'v-1' }))).status, 403)
  })
})

// ── 4. Lost & Found: claims, returns, disposition ────────────────────────────────────────────────────────────────
describe('lost and found claims, returns and disposition', () => {
  it('walks a claim from creation to a confirmed match and cancels with a required reason', async () => {
    replies.push(ok({ id: 'claim-9', status: 'open' }))
    await lostFoundApi.createClaim({ guest_name: 'Dana Guest', description: 'Black wallet', category: 'wallets_cards', guest_email: 'dana@guest.example' })
    assert.equal(last().path.endsWith('/lost-found/claims'), true)
    assert.deepEqual(last().body, { guest_name: 'Dana Guest', description: 'Black wallet', category: 'wallets_cards', guest_email: 'dana@guest.example' })

    replies.push(ok({ id: 'claim-9', status: 'matched' }))
    await lostFoundApi.confirmClaimMatch('claim-9', { item_id: 'lf-1', verification_notes: 'Initials D.G. matched' })
    assert.equal(last().path.endsWith('/lost-found/claims/claim-9/match'), true)
    assert.deepEqual(last().body, { item_id: 'lf-1', verification_notes: 'Initials D.G. matched' })

    replies.push(ok({ id: 'claim-9', status: 'cancelled' }))
    await lostFoundApi.cancelClaim('claim-9', { reason: 'Guest found it' })
    assert.deepEqual(last().body, { reason: 'Guest found it' })
  })

  it('refuses a claim action the role may not take, and shows the server reason for an already-matched item', async () => {
    replies.push(fail(403, 'You do not have permission to manage claims'))
    assert.equal((await rejection(lostFoundApi.cancelClaim('claim-9', { reason: 'x' }))).status, 403)
    replies.push(fail(409, 'Item is already matched to another claim'))
    assert.equal((await rejection(lostFoundApi.confirmClaimMatch('claim-9', { item_id: 'lf-1', verification_notes: 'n' }))).message, 'Item is already matched to another claim')
  })

  it('drives a pickup return through details, ready and a verified handover', async () => {
    replies.push(ok({ id: 'ret-1', status: 'awaiting_details' }), ok({ id: 'ret-1', status: 'awaiting_details' }), ok({ id: 'ret-1', status: 'ready_for_pickup' }), ok({ id: 'ret-1', status: 'completed' }))
    await lostFoundApi.prepareReturn('lf-1', { method: 'pickup' })
    await lostFoundApi.setPickupDetails('ret-1', { recipient_name: 'Dana Guest', pickup_location: 'Front desk', verification_method_required: 'photo_id' })
    await lostFoundApi.markPickupReady('ret-1')
    await lostFoundApi.completePickup('ret-1', { recipient_name: 'Dana Guest', verification_method: 'photo_id', verification_notes: 'TX DL checked', verified: true })
    assert.deepEqual(hits.map((h) => `${h.method} ${h.path.replace('/v1', '')}`), [
      'POST /lost-found/lf-1/returns', 'POST /lost-found/returns/ret-1/pickup-details', 'POST /lost-found/returns/ret-1/pickup-ready', 'POST /lost-found/returns/ret-1/pickup-complete',
    ])
    assert.deepEqual(hits[0].body, { method: 'pickup' })
    assert.deepEqual(hits[3].body, { recipient_name: 'Dana Guest', verification_method: 'photo_id', verification_notes: 'TX DL checked', verified: true })
  })

  it('drives a shipped return and rejects shipping without a complete address (422)', async () => {
    const address = { recipient_name: 'Dana Guest', address_line1: '12 Main St', city: 'Austin', region: 'TX', postal_code: '78701', country: 'US', shipping_paid_by: 'guest' as const }
    replies.push(ok({ status: 'shipping_preparation' }), ok({ status: 'shipped' }), ok({ status: 'completed' }))
    await lostFoundApi.setShippingDetails('ret-2', address)
    await lostFoundApi.markShipped('ret-2', { carrier: 'ups', tracking_number: '1Z999', shipping_cost_cents: 1450 })
    await lostFoundApi.completeShipment('ret-2')
    assert.deepEqual(hits[0].body, address)
    assert.deepEqual(hits[1].body, { carrier: 'ups', tracking_number: '1Z999', shipping_cost_cents: 1450 })
    assert.equal(hits[2].path.endsWith('/lost-found/returns/ret-2/complete-shipment'), true)

    replies.push(fail(422, [{ loc: ['body', 'postal_code'], msg: 'Field required', type: 'missing' }]))
    assert.match((await rejection(lostFoundApi.setShippingDetails('ret-2', { ...address, postal_code: '' }))).message, /\[body\.postal_code\] Field required/)
  })

  it('approves disposition with an outcome and reason, voids a record, and reports a leaked database error plainly', async () => {
    replies.push(ok({ id: 'lf-3', status: 'donated' }), ok({ id: 'lf-4', status: 'voided' }))
    await lostFoundApi.approveDisposition('lf-3', { outcome: 'donated', reason: 'Retention period elapsed' })
    await lostFoundApi.voidItem('lf-4', { reason: 'duplicate_record', notes: 'Entered twice' })
    assert.deepEqual(hits.map((h) => h.body), [{ outcome: 'donated', reason: 'Retention period elapsed' }, { reason: 'duplicate_record', notes: 'Entered twice' }])

    replies.push(fail(500, "{'code': '23505', 'details': 'Key (tag_identifier)=(LF-0004) already exists.'}"))
    const leaked = await rejection(lostFoundApi.voidItem('lf-4', { reason: 'other', notes: 'x' }))
    assert.equal(leaked.message, 'A duplicate entry already exists.', 'raw database text never reaches the staff member')
  })
})

// ── 5. Logbook entry actions ─────────────────────────────────────────────────────────────────────────────────────
describe('logbook entry actions', () => {
  it('creates a follow-up entry with acknowledgment targets and sends exactly the typed fields', async () => {
    const payload = { department_id: 'dept-1', content: 'Pool pump noisy', category: 'maintenance' as const, priority: 'high' as const, status: 'follow_up' as const, requires_acknowledgment: true, acknowledgment_target_ids: ['u1', 'u2'] }
    replies.push(ok({ id: 'e-1' }))
    await logbookApi.createEntry(payload as never)
    assert.deepEqual([last().method, last().path.endsWith('/logbook/entries')], ['POST', true])
    assert.deepEqual(last().body, payload)
  })

  it('resolves, archives, carries forward and acknowledges, preserving idempotency flags the UI relies on', async () => {
    replies.push(ok({ id: 'e-1', already_resolved: true }), ok({ id: 'e-1', archived_at: '2026-11-06T10:00:00Z', already_archived: true }), ok({ id: 'e-2' }), ok({ success: true, version: 3 }))
    const resolved = await logbookApi.resolveEntry('e-1', { resolution_note: 'Fixed' })
    const archived = await logbookApi.archiveEntry('e-1')
    await logbookApi.carryForwardEntry('e-1', { assigned_to: 'u2' })
    const acked = await logbookApi.acknowledgeEntry('e-1')
    assert.deepEqual(hits.map((h) => `${h.method} ${h.path.replace('/v1', '')}`), [
      'POST /logbook/entries/e-1/resolve', 'POST /logbook/entries/e-1/archive', 'POST /logbook/entries/e-1/carry-forward', 'POST /logbook/entries/e-1/acknowledge',
    ])
    assert.deepEqual(hits[0].body, { resolution_note: 'Fixed' })
    assert.deepEqual(hits[2].body, { assigned_to: 'u2' })
    assert.equal(resolved.data.already_resolved, true)
    assert.equal(archived.data.already_archived, true)
    assert.equal(acked.data.version, 3)
  })

  it('delete returns nothing on 204; a non-author edit is refused (403) and a locked entry conflicts (409)', async () => {
    replies.push({ status: 204 })
    assert.equal(await logbookApi.deleteEntry('e-1'), null)
    assert.deepEqual([last().method, last().path.endsWith('/logbook/entries/e-1')], ['DELETE', true])

    replies.push(fail(403, 'Only the author or a supervisor can edit this entry'))
    assert.equal((await rejection(logbookApi.updateEntry('e-1', { content: 'x' }))).status, 403)
    replies.push(fail(409, 'This entry was updated by someone else. Reload and try again.'))
    assert.equal((await rejection(logbookApi.updateEntry('e-1', { content: 'x' }))).status, 409)
  })
})

// ── Transport behaviour every flow shares ────────────────────────────────────────────────────────────────────────
describe('transport failure modes', () => {
  it('keeps validation text that merely names a *_code field, while still translating a raw database error code', async () => {
    replies.push(fail(422, [{ loc: ['body', 'problem_code_id'], msg: 'Field required', type: 'missing' }]))
    assert.equal((await rejection(engineeringApi.completeWorkOrder('wo-1', {}))).message, '[body.problem_code_id] Field required')

    replies.push(fail(422, 'ZIP code does not match the city'))
    assert.equal((await rejection(engineeringApi.completeWorkOrder('wo-1', {}))).message, 'ZIP code does not match the city', 'prose that says "code" is not a database error')

    replies.push(fail(500, 'code: 23505 duplicate key value violates unique constraint'))
    assert.equal((await rejection(engineeringApi.completeWorkOrder('wo-1', {}))).message, 'A duplicate entry already exists.')
  })

  it('reports connection loss as a network error with no status, and honours Retry-After on 429', async () => {
    replies.push('network')
    const lost = await rejection(logbookApi.archiveEntry('e-1'))
    assert.deepEqual([lost.isNetworkError, lost.status], [true, null])

    replies.push(fail(429, 'Too many requests', { 'Retry-After': '12' }))
    const limited = await rejection(logbookApi.archiveEntry('e-1'))
    assert.deepEqual([limited.status, limited.retryAfterSeconds], [429, 12])
  })

  it('prefers a structured error.message and falls back to a generic line for unreadable 500s', async () => {
    replies.push({ status: 400, json: { error: { message: 'Reason is required' } } })
    assert.equal((await rejection(lostFoundApi.cancelClaim('c', { reason: '' }))).message, 'Reason is required')
    replies.push({ status: 500, json: { detail: 'x'.repeat(400) } })
    assert.equal((await rejection(lostFoundApi.cancelClaim('c', { reason: 'r' }))).message, 'Something went wrong. Please try again.')
  })
})
