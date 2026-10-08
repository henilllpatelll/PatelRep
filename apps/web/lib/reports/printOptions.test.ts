import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PRINT_OPTIONS, collectKpiKeys, definitionsForPrint, printHides } from './printOptions'

const kpi = (key: string, value: number | null = 1) => ({ key, label: key, value, availability: value === null ? 'unavailable' : 'available' })

test('printHides only hides a part while printing with that option off', () => {
  assert.equal(printHides(null, 'charts'), false) // not printing: nothing is hidden on screen
  assert.equal(printHides(DEFAULT_PRINT_OPTIONS, 'charts'), false)
  assert.equal(printHides({ ...DEFAULT_PRINT_OPTIONS, charts: false }, 'charts'), true)
  assert.equal(printHides({ ...DEFAULT_PRINT_OPTIONS, charts: false }, 'exceptions'), false)
  assert.equal(printHides({ ...DEFAULT_PRINT_OPTIONS, comparison: false }, 'comparison'), true)
})

test('collectKpiKeys finds KPI cards anywhere in a payload, once each', () => {
  const payload = {
    kpis: [kpi('guest_sla'), kpi('guest_ack_time', null)],
    departments: [{ department: 'engineering', measures: [kpi('maintenance_sla'), kpi('guest_sla')] }],
    time_labor: { kpis: [kpi('cleaning_minutes')] },
    categories: [{ key: 'hvac', count: 3, share_pct: 50 }], // ranked rows are not KPIs
    notes: ['text'],
  }
  assert.deepEqual(collectKpiKeys(payload).sort(), ['cleaning_minutes', 'guest_ack_time', 'guest_sla', 'maintenance_sla'])
  assert.deepEqual(collectKpiKeys(null), [])
  assert.deepEqual(collectKpiKeys('x'), [])
})

test('definitionsForPrint documents only the KPIs on screen and skips unknown keys', () => {
  const definitions = {
    guest_sla: { label: 'Guest SLA', definition: 'Share of requests resolved by the due time.' },
    labor_hours: { label: 'Labor hours', definition: 'Recorded labor.' },
  }
  const items = definitionsForPrint({ kpis: [kpi('guest_sla'), kpi('undocumented')] }, definitions)
  assert.deepEqual(items.map((i) => i.key), ['guest_sla'])
  assert.equal(items[0].definition, 'Share of requests resolved by the due time.')
  assert.deepEqual(definitionsForPrint({ kpis: [kpi('guest_sla')] }, undefined), [])
})
