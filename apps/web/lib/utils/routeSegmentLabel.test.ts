import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { NAV_LABEL_KEYS, routeSegmentLabel } from './navigation'

const t = (key: string) => `T(${key})`

test('a nav label wins over everything else', () => {
  const [segment, key] = Object.entries(NAV_LABEL_KEYS)[0]
  assert.equal(routeSegmentLabel(t, () => true, segment), `T(${key})`)
})

test('an unlisted segment uses the page\'s own <segment>.title, never the bare namespace object', () => {
  // `t('vendors')` is the whole `vendors` namespace object; i18next printed "key 'vendors (en)' returned an object instead of string".
  assert.equal(routeSegmentLabel(t, (key) => key === 'vendors.title', 'vendors'), 'T(vendors.title)')
})

test('with no translation at all the segment is humanized', () => {
  assert.equal(routeSegmentLabel(t, () => false, 'out-of-order'), 'Out of order')
  assert.equal(routeSegmentLabel(t, () => false, 'pm_schedules'), 'Pm schedules')
})

test('both breadcrumbs use the helper for the unlisted-segment fallback', () => {
  const root = path.resolve(__dirname, '..', '..')
  for (const file of ['components/shared/Breadcrumbs.tsx', 'components/design-v2/shell/HeaderLeadingV2.tsx']) {
    assert.match(readFileSync(path.join(root, file), 'utf8'), /routeSegmentLabel\(/, file)
  }
})

test('PM Today does not list an overdue schedule twice', () => {
  const src = readFileSync(path.resolve(__dirname, '..', '..', 'components/engineering/tabs/PMSchedulesTab.tsx'), 'utf8')
  assert.match(src, /overdueNotListed/)
  assert.equal(/overdueSchedules\.map\(/.test(src), false, 'the Overdue group must render overdueNotListed')
})

test('the Readings asset tab has a label in both languages', () => {
  const root = path.resolve(__dirname, '..', '..', 'i18n/locales')
  assert.match(readFileSync(path.join(root, 'en.ts'), 'utf8'), /tabReadings: "Readings"/)
  assert.match(readFileSync(path.join(root, 'es.ts'), 'utf8'), /tabReadings: "Lecturas"/)
})
