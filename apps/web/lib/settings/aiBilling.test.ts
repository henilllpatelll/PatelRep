import assert from 'node:assert/strict'
import test from 'node:test'
import type { AiUsage } from '@/lib/api/billing'
import {
  aiUsageRows, billingActionMeta, formatCreditText, formatUsdText, overageStateMeta, periodLabel, validateLimitInput,
} from './aiBilling'

const USAGE: AiUsage = {
  customer_billing_mode: 'enforced',
  period_start: '2026-11-01',
  period_end: '2026-11-30',
  included_credits: '5000',
  credits_used: '5250.5000',
  legacy_credits_used: '4950.2500',
  agent_credits_used: '300.2500',
  remaining_credits: '0',
  pending_reconciliation_credits: '0.7500',
  in_flight_credits: '1.5000',
  overage: {
    state: 'on', enabled: true, version: 3, updated_at: '2026-11-15T10:00:00+00:00',
    authorized_limit_credits: '1000.0000', max_exposure_usd: '20.00', accrued_credits: '200.0000',
    accrued_usd: '4.01', remaining_credits: '799.0000',
  },
  policy: { id: 'p', version: 2, usd_per_credit: '0.020000', terms_version: 't', monthly_overage_cap_usd: '50.00' },
  subscription_cap_cents: 60000,
  estimate: { is_estimate: true, base_fee_cents: 9900, legacy_overage_cents: 101, agent_overage_cents: 401, total_cents: 10402 },
}

test('server decimal strings are formatted, never recomputed', () => {
  assert.equal(formatCreditText('4950.2500'), '4,950.25')
  assert.equal(formatCreditText('0'), '0')
  assert.equal(formatCreditText('abc'), '—')
  assert.equal(formatCreditText(null), '—')
  assert.equal(formatUsdText('20.00'), '$20.00')
  assert.equal(formatUsdText('1234567.5'), '$1,234,567.50')
  assert.equal(formatUsdText('4.01'), '$4.01')
  assert.equal(formatUsdText('1e3'), '—')
})

test('legacy and agent usage are shown separately and pending reconciliation is not presented as a charge', () => {
  const rows = aiUsageRows(USAGE)
  assert.deepEqual(rows.map((r) => r.label), ['Included credits', 'Used by AI features', 'Used by AI agents', 'Total used',
    'Remaining allowance', 'Awaiting confirmation'])
  assert.match(rows[5].hint ?? '', /not charged unless it is confirmed/)
  assert.equal(aiUsageRows({ ...USAGE, pending_reconciliation_credits: '0' }).length, 5)
})

test('overage defaults to off; changed terms pause it', () => {
  assert.equal(overageStateMeta(undefined).label, 'Off')
  assert.equal(overageStateMeta('off').label, 'Off')
  assert.equal(overageStateMeta('on').label, 'On')
  assert.match(overageStateMeta('needs_reconfirmation').label, /confirm new terms/)
  assert.equal(overageStateMeta('garbage').label, 'Off')
})

test('only a Stripe-confirmed payment is labeled paid', () => {
  for (const status of ['pending', 'pending_invoice', 'invoiced', 'under_review', 'whatever', null]) {
    assert.notEqual(billingActionMeta(status).label, 'Paid', String(status))
  }
  assert.equal(billingActionMeta('paid').label, 'Paid')
  assert.equal(billingActionMeta('payment_failed').tone, 'alert')
  assert.equal(billingActionMeta('mystery').label, 'Under review')
})

test('the limit must be a positive whole number of credits', () => {
  assert.deepEqual(validateLimitInput(' 500 '), { ok: true, value: 500 })
  for (const bad of ['', '0', '-5', '1.5', '1e3', '$20', 'abc', '10000001']) {
    assert.equal(validateLimitInput(bad).ok, false, bad)
  }
})

test('period labels are calendar months in UTC', () => {
  assert.equal(periodLabel('2026-10-01'), 'October 2026')
  assert.equal(periodLabel(null), '—')
})
