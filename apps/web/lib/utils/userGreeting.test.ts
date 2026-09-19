import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDashboardGreeting, getGreetingName } from './userGreeting'

test('uses the preferred profile name before other account name sources', () => {
  assert.equal(
    getGreetingName({
      preferredName: 'Maria',
      fullName: 'Maria Garcia',
      userMetadataFullName: 'Maria M.',
    }),
    'Maria',
  )
})

test('uses the first word of a trimmed full name when no preferred name exists', () => {
  assert.equal(getGreetingName({ fullName: '  Jordan Lee  ' }), 'Jordan')
})

test('uses auth metadata only when no profile name is available', () => {
  assert.equal(
    getGreetingName({
      userMetadataFullName: 'Taylor Brooks',
      appMetadataFullName: 'Taylor B.',
    }),
    'Taylor',
  )
})

test('ignores blank metadata and uses an app-metadata name as the last name source', () => {
  assert.equal(
    getGreetingName({
      preferredName: '   ',
      userMetadataFullName: 42,
      appMetadataFullName: 'Casey Rivera',
    }),
    'Casey',
  )
})

test('omits the personal suffix instead of displaying a generic placeholder', () => {
  assert.equal(getGreetingName({}), undefined)
  assert.equal(formatDashboardGreeting('Good afternoon', 'Casey'), 'Good afternoon, Casey.')
  assert.equal(formatDashboardGreeting('Good afternoon', undefined), 'Good afternoon.')
})
