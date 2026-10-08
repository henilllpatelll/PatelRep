import assert from 'node:assert/strict'
import test from 'node:test'
import { exportFilename, exportOptionState } from './exportOptions'

const base = { report: 'maintenance' as const, currentView: 'overview' as const, compare: 'previous' as const }

test('printing is locked to the report on screen, exports keep the chosen report', () => {
  assert.deepEqual(exportOptionState({ ...base, format: 'print' }), { report: 'overview', reportLocked: true, chartsApply: true, comparisonAvailable: true })
  assert.equal(exportOptionState({ ...base, format: 'pdf' }).report, 'maintenance')
  assert.equal(exportOptionState({ ...base, format: 'pdf', report: 'all' }).report, 'all')
  // "All authorized reports" can never be printed: print falls back to the on-screen report
  assert.equal(exportOptionState({ ...base, format: 'print', report: 'all' }).report, 'overview')
})

test('charts exist in PDF and print only; comparison needs a comparison period', () => {
  assert.equal(exportOptionState({ ...base, format: 'csv' }).chartsApply, false)
  assert.equal(exportOptionState({ ...base, format: 'pdf' }).chartsApply, true)
  assert.equal(exportOptionState({ ...base, format: 'print' }).chartsApply, true)
  assert.equal(exportOptionState({ ...base, format: 'pdf', compare: 'none' }).comparisonAvailable, false)
  assert.equal(exportOptionState({ ...base, format: 'pdf', compare: 'last_year' }).comparisonAvailable, true)
})

test('file names carry the report and the hotel-local period; "all" is a ZIP', () => {
  const range = { start: '2026-09-01', end: '2026-09-30' }
  assert.equal(exportFilename('maintenance', 'csv', range), 'patelrep-maintenance-2026-09-01-to-2026-09-30.csv')
  assert.equal(exportFilename('overview', 'pdf', range), 'patelrep-overview-2026-09-01-to-2026-09-30.pdf')
  assert.equal(exportFilename('all', 'pdf', range), 'patelrep-all-reports-2026-09-01-to-2026-09-30.zip')
  assert.equal(exportFilename('all', 'csv', range), 'patelrep-all-reports-2026-09-01-to-2026-09-30.zip')
})
