import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_CONNECT_FORM, buildConnectPayload, classifyActionFailure, conflictFieldRows, conflictSummary, connectFormDirty,
  deriveBadge, describeStatusProblem, isSftpMode, relativeTime, safeEndpoint, sessionResult, validateConnectForm,
  RESOLUTION_OPTIONS, formatTimestamp,
} from './integrations'
import {
  buildCreditView, buildInvoiceRows, creditBarTone, describeCycle, formatCredits, formatMoney, isTrialExpired, safeStripeUrl,
  subscriptionNotice, subscriptionRows, subscriptionStatusMeta,
} from './billing'

const httpError = (status: number) => Object.assign(new Error('x'), { status })

// ─── Integrations ─────────────────────────────────────────────────────────────

test('status problems separate the pilot gate and environment switch from transient failures', () => {
  assert.equal(describeStatusProblem(httpError(403)).retryable, false)
  assert.match(describeStatusProblem(httpError(403)).title, /isn’t enabled/)
  assert.equal(describeStatusProblem(httpError(503)).retryable, false)
  assert.equal(describeStatusProblem(httpError(500)).retryable, true)
  assert.equal(describeStatusProblem(new Error('network')).retryable, true)
})

test('action failures are classified so configuration problems get different guidance than outages', () => {
  assert.equal(classifyActionFailure(httpError(400)), 'auth_or_config')
  assert.equal(classifyActionFailure(httpError(503)), 'unreachable')
  assert.equal(classifyActionFailure(httpError(500)), 'other')
})

test('only the scheduled-report mode is treated as SFTP', () => {
  assert.equal(isSftpMode({ connection_mode: 'sftp_report' }), true)
  assert.equal(isSftpMode({ connection_mode: 'api' }), false)
  assert.equal(isSftpMode(undefined), false)
})

test('safeEndpoint keeps origin and path only and rejects non-https or malformed values', () => {
  assert.equal(safeEndpoint('https://hospitality.oracle.com/'), 'https://hospitality.oracle.com')
  assert.equal(safeEndpoint('https://user:secret@host.example.com/api/?token=abc#x'), 'https://host.example.com/api')
  assert.equal(safeEndpoint('http://host.example.com'), null)
  assert.equal(safeEndpoint('not a url'), null)
  assert.equal(safeEndpoint(null), null)
})

test('connect form validates required fields, https endpoint and username/password pairing', () => {
  assert.deepEqual(Object.keys(validateConnectForm(EMPTY_CONNECT_FORM)).sort(), ['hotel_id_opera', 'ohip_base_url'])
  const ok = { ...EMPTY_CONNECT_FORM, ohip_base_url: 'https://hospitality.oracle.com', hotel_id_opera: 'SAND01' }
  assert.deepEqual(validateConnectForm(ok), {})
  assert.ok(validateConnectForm({ ...ok, ohip_base_url: 'http://insecure.example.com' }).ohip_base_url)
  assert.ok(validateConnectForm({ ...ok, hotel_id_opera: 'x'.repeat(65) }).hotel_id_opera)
  assert.ok(validateConnectForm({ ...ok, integration_username: 'svc' }).integration_password)
  assert.ok(validateConnectForm({ ...ok, integration_password: 'pw' }).integration_username)
})

test('connect payload omits blank optional credentials and trims text fields', () => {
  const payload = buildConnectPayload({ ohip_base_url: ' https://h.example.com ', hotel_id_opera: ' SAND01 ', integration_username: '', integration_password: '' })
  assert.deepEqual(payload, { ohip_base_url: 'https://h.example.com', hotel_id_opera: 'SAND01', integration_username: undefined, integration_password: undefined })
  assert.equal(buildConnectPayload({ ...EMPTY_CONNECT_FORM, integration_password: ' pw ' }).integration_password, ' pw ')
})

test('connect form dirty tracking compares against the initial values', () => {
  assert.equal(connectFormDirty(EMPTY_CONNECT_FORM, EMPTY_CONNECT_FORM), false)
  assert.equal(connectFormDirty({ ...EMPTY_CONNECT_FORM, integration_password: 'x' }, EMPTY_CONNECT_FORM), true)
})

test('conflict rows show only the four decided fields, never other snapshot data', () => {
  const rows = conflictFieldRows({
    local_snapshot: { guest_name: 'Local Guest', vip_flag: false, guest_email: 'a@b.com' } as never,
    remote_snapshot: { guest_name: 'Opera Guest', vip_flag: true, guest_email: 'c@d.com', special_requests: 'x' } as never,
  })
  assert.deepEqual(rows.map((r) => r.key), ['guest_name', 'vip_flag'])
  assert.deepEqual(rows[0], { key: 'guest_name', label: 'Guest name', local: 'Local Guest', remote: 'Opera Guest', differs: true })
  assert.equal(rows[1].local, 'No')
  assert.equal(rows[1].remote, 'Yes')
  assert.ok(!JSON.stringify(rows).includes('@'))
})

test('conflict rows tolerate empty snapshots and flag unchanged fields as equal', () => {
  assert.deepEqual(conflictFieldRows({ local_snapshot: null, remote_snapshot: null }), [])
  const rows = conflictFieldRows({ local_snapshot: { guest_name: 'Same' }, remote_snapshot: { guest_name: 'Same', vip_flag: true } })
  assert.equal(rows[0].differs, false)
  assert.equal(rows[1].local, 'Not set')
})

test('conflict summary names only differing fields', () => {
  assert.equal(conflictSummary({ local_snapshot: { guest_name: 'A' }, remote_snapshot: { guest_name: 'B' } }), 'Guest name differs between PatelRep and OPERA.')
  assert.equal(
    conflictSummary({ local_snapshot: { guest_name: 'A', vip_flag: false }, remote_snapshot: { guest_name: 'B', vip_flag: true } }),
    'Guest name and VIP status differ between PatelRep and OPERA.',
  )
  assert.match(conflictSummary({ local_snapshot: null, remote_snapshot: null }), /disagree/)
})

test('resolution options are exactly the backend’s record-level choices and state their consequence', () => {
  assert.deepEqual(RESOLUTION_OPTIONS.map((o) => o.value), ['local_wins', 'remote_wins'])
  assert.deepEqual(RESOLUTION_OPTIONS.map((o) => o.label), ['Keep PatelRep Value', 'Use OPERA Value'])
  assert.match(RESOLUTION_OPTIONS[1].consequence, /whole record/)
})

test('badge never says Connected for a disconnected, failing or in-flight connection', () => {
  const base = { connected: true, testing: false, syncing: false, disconnecting: false, openConflicts: 0, lastTest: null, lastSync: null }
  assert.equal(deriveBadge(base).label, 'Connected')
  assert.equal(deriveBadge({ ...base, connected: false }).label, 'Not connected')
  assert.equal(deriveBadge({ ...base, syncing: true }).label, 'Syncing…')
  assert.equal(deriveBadge({ ...base, testing: true }).label, 'Testing connection…')
  assert.equal(deriveBadge({ ...base, openConflicts: 2 }).label, 'Needs review')
  assert.equal(deriveBadge({ ...base, lastTest: sessionResult(false, 'bad') }).tone, 'alert')
  assert.equal(deriveBadge({ ...base, lastSync: sessionResult(false, 'bad') }).label, 'Sync failed')
  assert.equal(deriveBadge({ ...base, disconnecting: true }).label, 'Disconnecting…')
})

test('timestamps degrade to null instead of inventing values', () => {
  assert.equal(formatTimestamp(null), null)
  assert.equal(formatTimestamp('garbage'), null)
  assert.ok(formatTimestamp('2026-10-08T15:02:00Z'))
  const now = Date.parse('2026-10-08T12:00:00Z')
  assert.equal(relativeTime('2026-10-08T11:58:00Z', now), '2 min ago')
  assert.equal(relativeTime('2026-10-08T09:00:00Z', now), '3 hr ago')
  assert.equal(relativeTime('2026-10-09T09:00:00Z', now), null)
})

// ─── Billing ──────────────────────────────────────────────────────────────────

test('subscription statuses are never collapsed into Active', () => {
  assert.equal(subscriptionStatusMeta('active').label, 'Active')
  assert.equal(subscriptionStatusMeta('past_due').tone, 'alert')
  assert.equal(subscriptionStatusMeta('trialing').label, 'Trial')
  assert.equal(subscriptionStatusMeta('cancelled').label, 'Canceled')
  assert.equal(subscriptionStatusMeta('unpaid').attention, true)
  const unknown = subscriptionStatusMeta('some_new_state')
  assert.equal(unknown.label, 'Some new state')
  assert.notEqual(unknown.label, 'Active')
  assert.equal(subscriptionStatusMeta(undefined).label, 'Unknown')
})

test('trial expiry is derived from trial_end, only while trialing', () => {
  const now = Date.parse('2026-10-08T00:00:00Z')
  assert.equal(isTrialExpired({ plan_status: 'trialing', trial_end: '2026-10-01T00:00:00Z' }, now), true)
  assert.equal(isTrialExpired({ plan_status: 'trialing', trial_end: '2026-10-20T00:00:00Z' }, now), false)
  assert.equal(isTrialExpired({ plan_status: 'active', trial_end: '2026-10-01T00:00:00Z' }, now), false)
  assert.equal(isTrialExpired({ plan_status: 'trialing' }, now), false)
})

test('notices pair each problem with the existing action that resolves it', () => {
  const now = Date.parse('2026-10-08T00:00:00Z')
  assert.equal(subscriptionNotice({ plan_status: 'trialing', trial_end: '2026-10-20T00:00:00Z' }, now)?.action, 'checkout')
  assert.equal(subscriptionNotice({ plan_status: 'trialing', trial_end: '2026-10-01T00:00:00Z' }, now)?.kind, 'trial_expired')
  assert.equal(subscriptionNotice({ plan_status: 'past_due' }, now)?.action, 'portal')
  assert.equal(subscriptionNotice({ plan_status: 'incomplete' }, now)?.kind, 'payment')
  assert.equal(subscriptionNotice({ plan_status: 'cancelled' }, now)?.kind, 'inactive')
  assert.equal(subscriptionNotice({ plan_status: 'active' }, now), null)
})

test('subscription rows use only returned values and no hardcoded price', () => {
  const rows = subscriptionRows({ plan_status: 'active', current_period_end: '2026-11-01T00:00:00Z' })
  assert.deepEqual(rows.map((r) => r.label), ['Next billing date'])
  assert.ok(!rows.some((r) => r.label === 'Monthly base fee'), 'no base fee row when the API did not return one')
  const withFee = subscriptionRows({ plan_status: 'active', base_fee_cents: 12500 })
  assert.equal(withFee.find((r) => r.label === 'Monthly base fee')?.value, '$125.00')
  assert.equal(subscriptionRows({ plan_status: 'past_due', current_period_end: '2026-11-01T00:00:00Z' })[0].label, 'Current period ends')
})

test('credit view reports current-cycle numbers and never negative remaining', () => {
  const view = buildCreditView({ period: '2026-10', period_start: '2026-10-01', period_end: '2026-10-31', credits_included: 5000, credits_used: 3250, credits_remaining: 1750, overage_credits: 0 })
  if (view.kind === 'unavailable') throw new Error('expected a usable view')
  assert.equal(view.kind, 'metered')
  assert.equal(view.percentLabel, 65)
  assert.equal(view.remaining, 1750)
  assert.equal(view.cycle, 'Oct 1, 2026 – Oct 31, 2026')

  const over = buildCreditView({ credits_included: 100, credits_used: 140, credits_remaining: -40 as never })
  if (over.kind === 'unavailable') throw new Error('expected a view')
  assert.equal(over.remaining, 0)
  assert.equal(over.overage, 40)
  assert.equal(over.barPercent, 100)
  assert.equal(over.percentLabel, 140)
  assert.equal(over.overAllowance, true)
})

test('credit view handles zero allowance, missing and malformed data', () => {
  const none = buildCreditView({ credits_included: 0, credits_used: 12 })
  if (none.kind === 'unavailable') throw new Error('expected a usable view')
  assert.equal(none.kind, 'no_allowance')
  assert.equal(none.percentLabel, 0)
  assert.equal(buildCreditView(undefined).kind, 'unavailable')
  assert.equal(buildCreditView({ message: 'No billing period found' }).kind, 'unavailable')
  assert.equal(buildCreditView({ credits_included: Number.NaN, credits_used: 1 }).kind, 'unavailable')
  assert.equal(buildCreditView({ credits_included: 10, credits_used: -1 }).kind, 'unavailable')
})

test('credit cycle falls back to the month label and then to null', () => {
  assert.equal(describeCycle({ period: '2026-10' }), 'October 2026')
  assert.equal(describeCycle({}), null)
  assert.equal(creditBarTone(50), 'ready')
  assert.equal(creditBarTone(90), 'caution')
  assert.equal(creditBarTone(99), 'alert')
  assert.equal(formatCredits(1234.56), '1,234.6')
})

test('money formats by currency and degrades safely', () => {
  assert.equal(formatMoney(9900, 'usd'), '$99.00')
  assert.equal(formatMoney(9900, undefined), '$99.00')
  assert.equal(formatMoney(null, 'usd'), '—')
  assert.match(formatMoney(1000, 'not-a-code'), /10\.00/)
})

test('stripe links must be https on stripe.com, otherwise they are treated as unavailable', () => {
  assert.ok(safeStripeUrl('https://billing.stripe.com/p/session/abc'))
  assert.ok(safeStripeUrl('https://invoice.stripe.com/i/acct/inv'))
  assert.equal(safeStripeUrl('http://billing.stripe.com/x'), null)
  assert.equal(safeStripeUrl('https://evil.example.com/stripe.com'), null)
  assert.equal(safeStripeUrl('https://notstripe.com/x'), null)
  assert.equal(safeStripeUrl('https://stripe.com.evil.com/x'), null)
  assert.equal(safeStripeUrl('https://user:pw@billing.stripe.com/x'), null)
  assert.equal(safeStripeUrl('javascript:alert(1)'), null)
  assert.equal(safeStripeUrl(undefined), null)
})

test('invoice rows use server-provided safe links and server amounts', () => {
  const rows = buildInvoiceRows([
    { id: 'in_1', amount_due: 9900, status: 'paid', created: 1_790_000_000, hosted_invoice_url: 'https://invoice.stripe.com/i/1', invoice_pdf: 'https://pay.stripe.com/invoice/1/pdf', currency: 'usd', number: 'A-1', period_start: 1_789_000_000, period_end: 1_791_000_000 },
    { id: 'in_2', amount_due: 500, status: 'open', created: 1_790_000_000, hosted_invoice_url: 'https://evil.example.com/pay' },
    { id: 'in_3', amount_due: 0, status: 'weird_state', created: 0 },
  ])
  assert.equal(rows[0].amount, '$99.00')
  assert.equal(rows[0].status.label, 'Paid')
  assert.ok(rows[0].viewUrl && rows[0].pdfUrl)
  assert.equal(rows[1].viewUrl, null, 'untrusted host is not linked')
  assert.equal(rows[1].pdfUrl, null)
  assert.equal(rows[2].date, '—')
  assert.equal(rows[2].status.label, 'Weird state')
  assert.deepEqual(buildInvoiceRows(undefined), [])
})
