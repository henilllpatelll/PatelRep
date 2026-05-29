import assert from 'node:assert/strict'
import test from 'node:test'
import { getFeedbackRuntimeContext } from './feedbackContext.ts'

test('captures page and device context for feedback submissions', () => {
  const win = {
    location: {
      href: 'https://app.patelrep.com/housekeeping?floor=2',
      pathname: '/housekeeping',
    },
    navigator: {
      userAgent: 'Mozilla/5.0 test',
      language: 'en-US',
    },
    innerWidth: 390,
    innerHeight: 844,
    document: {
      referrer: 'https://app.patelrep.com/dashboard',
    },
  }

  const context = getFeedbackRuntimeContext(win)

  assert.equal(context.page_url, 'https://app.patelrep.com/housekeeping?floor=2')
  assert.equal(context.pathname, '/housekeeping')
  assert.equal(context.user_agent, 'Mozilla/5.0 test')
  assert.equal(context.browser_language, 'en-US')
  assert.equal(context.viewport_width, 390)
  assert.equal(context.viewport_height, 844)
  assert.equal(context.client_context.referrer, 'https://app.patelrep.com/dashboard')
})

test('returns empty context when rendered without window', () => {
  assert.deepEqual(getFeedbackRuntimeContext(undefined), { client_context: {} })
})
