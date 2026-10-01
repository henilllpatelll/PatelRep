import assert from 'node:assert/strict'
import test from 'node:test'

import { extractMetaContent } from './public-smoke.mjs'

test('extracts content from a name-then-content meta tag', () => {
  const html = '<head><meta name="patelrep-release-sha" content="abc1234"/></head>'
  assert.equal(extractMetaContent(html, 'patelrep-release-sha'), 'abc1234')
})

test('extracts content from a content-then-name meta tag', () => {
  const html = '<head><meta content="v1.8.0" name="patelrep-release-version"/></head>'
  assert.equal(extractMetaContent(html, 'patelrep-release-version'), 'v1.8.0')
})

test('returns null when the tag is missing', () => {
  const html = '<head><meta name="other-tag" content="value"/></head>'
  assert.equal(extractMetaContent(html, 'patelrep-release-sha'), null)
})
