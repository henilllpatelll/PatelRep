import assert from 'node:assert/strict'
import test from 'node:test'
import { getCleanTypeCredits } from './cleanType'

test('uses persisted clean-type weights when supplied and preserves safe defaults', () => {
  assert.equal(getCleanTypeCredits('DEP'), 3)
  assert.equal(getCleanTypeCredits('DEP', { DEP: 2, FULL: 1, LIGHT: 0.5 }), 2)
  assert.equal(getCleanTypeCredits('LIGHT', { DEP: 2, FULL: 1, LIGHT: 0.5 }), 0.5)
  assert.equal(getCleanTypeCredits('FULL', { FULL: Number.NaN }), 2)
})
