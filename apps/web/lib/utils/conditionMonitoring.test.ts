import assert from 'node:assert/strict'
import test from 'node:test'
import { meterPreviewStatus, suggestedUnits } from './conditionMonitoring'

test('previews inclusive meter threshold boundaries for a live record-reading form', () => {
  const meter = { warning_high: 65, critical_high: 72, warning_low: 10, critical_low: 5 }
  assert.equal(meterPreviewStatus(meter, 64), 'normal')
  assert.equal(meterPreviewStatus(meter, 65), 'warning')
  assert.equal(meterPreviewStatus(meter, 72), 'critical')
  assert.equal(meterPreviewStatus(meter, 5), 'critical')
})

test('suggests only explicit canonical units for common meter types', () => {
  assert.deepEqual(suggestedUnits('temperature'), ['°F', '°C'])
  assert.deepEqual(suggestedUnits('pressure'), ['PSI'])
  assert.deepEqual(suggestedUnits('custom'), [])
})
