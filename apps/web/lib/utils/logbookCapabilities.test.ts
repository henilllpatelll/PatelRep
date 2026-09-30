import assert from 'node:assert/strict'
import test from 'node:test'

import { canManageLogbookEntry, getLogbookCapabilities } from './logbookCapabilities'

test('logbook capabilities preserve current staff access while recognizing chief engineers', () => {
  const chief = getLogbookCapabilities('chief_engineer')
  const engineer = getLogbookCapabilities('engineer')

  assert.equal(chief.canCreateEntry, true)
  assert.equal(chief.canEditAnyEntry, true)
  assert.equal(chief.canDeleteAnyEntry, true)
  assert.equal(chief.canGenerateShiftSummary, true)
  assert.equal(chief.canAcknowledgeShiftSummary, true)
  assert.equal(engineer.canGenerateShiftSummary, true)
  assert.equal(chief.canCarryForwardAnyEntry, true)
  assert.equal(chief.canResolveAnyEntry, true)
  assert.equal(chief.canArchiveAnyEntry, true)
  assert.equal(chief.canDeletePermanently, false)
  assert.equal(chief.canComment, true)
  assert.equal(chief.canDeleteAnyComment, true)
  assert.equal(chief.canSendAcknowledgmentReminder, true)
})

test('logbook capabilities do not create access for unauthenticated users', () => {
  const anonymous = getLogbookCapabilities(null)

  assert.deepEqual(anonymous, {
    canCreateEntry: false,
    canEditAnyEntry: false,
    canDeleteAnyEntry: false,
    canGenerateShiftSummary: false,
    canAcknowledgeShiftSummary: false,
    canUseAdvancedFilters: false,
    canCarryForwardAnyEntry: false,
    canResolveAnyEntry: false,
    canArchiveAnyEntry: false,
    canDeletePermanently: false,
    canComment: false,
    canDeleteAnyComment: false,
    canSendAcknowledgmentReminder: false,
  })
})

test('canManageLogbookEntry allows the author even without role-level access', () => {
  const housekeeper = getLogbookCapabilities('housekeeper')
  assert.equal(canManageLogbookEntry(housekeeper, 'user-1', 'user-1'), true)
  assert.equal(canManageLogbookEntry(housekeeper, 'user-1', 'user-2'), false)

  const chief = getLogbookCapabilities('chief_engineer')
  assert.equal(canManageLogbookEntry(chief, 'user-1', 'user-2'), true)
})
