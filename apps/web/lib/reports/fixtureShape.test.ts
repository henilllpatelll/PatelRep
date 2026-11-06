import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error plain .mjs fixture module shared with the hermetic mock backend
import { route } from '../../e2e/hermetic/mock-backend.mjs'
import { REPORT_VIEWS } from './filters'

/** Regression for the "/reports renders only its error boundary under hermetic fixtures" finding:
 *  the mock answered /reports/capabilities with an array (`{data: []}`), so `capabilities.views` was undefined. */
const get = (path: string, q = '') => route({ method: 'GET', path: `/v1${path}`, query: new URLSearchParams(q), email: 'gm@hermetic.invalid' })

test('capabilities is an object whose views cover every report tab (not an array)', () => {
  const body = get('/reports/capabilities').json.data
  assert.equal(Array.isArray(body), false)
  assert.deepEqual([...body.views].sort(), [...REPORT_VIEWS].sort())
  assert.ok(Array.isArray(body.departments) && body.departments.length > 0)
})

test('every view returns the envelope its component dereferences', () => {
  for (const view of REPORT_VIEWS) {
    const data = get(`/reports/views/${view}`).json.data
    assert.equal(data.view, view)
    assert.ok(data.period?.start && data.period?.end, `${view}: period`)
    if (view === 'management') {
      for (const key of ['time_labor', 'quality_risk', 'guest_response', 'maintenance_pm', 'downtime_exposure', 'staffing_forecast', 'ai_usage']) {
        assert.ok(data[key], `management.${key}`)
      }
    } else {
      assert.ok(Array.isArray(data.kpis) && data.kpis.length > 0, `${view}: kpis`)
    }
  }
})

test('overview carries exceptions, trends keyed by metric, departments and a live daily brief', () => {
  const data = get('/reports/views/overview').json.data
  assert.ok(data.needs_attention.length >= 2)
  for (const [metric, series] of Object.entries<any>(data.trends)) {
    assert.equal(series.metric, metric)
    assert.ok(series.points.length > 1 && series.comparison.points.length === series.points.length)
  }
  assert.ok(data.departments.every((d: any) => Array.isArray(d.measures)))
  assert.equal(data.daily_brief.scope, 'live')
})

test('KPI fixtures never present missing data as zero', () => {
  const data = get('/reports/views/housekeeping').json.data
  for (const k of data.kpis) assert.ok(k.value === null ? k.availability !== 'available' : k.availability === 'available')
})

test('definitions, schedules and delivery status are well formed', () => {
  assert.ok(Object.keys(get('/reports/definitions').json.data).length >= 8)
  assert.equal(get('/reports/schedules').json.data[0].frequency, 'weekly')
  assert.equal(get('/reports/delivery-status').json.data.configured, true)
})
