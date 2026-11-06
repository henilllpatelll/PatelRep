import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTradeLabel } from './tradeLabel'

test('trade keys read as labels, HVAC stays an acronym', () => {
  assert.equal(formatTradeLabel('hvac'), 'HVAC')
  assert.equal(formatTradeLabel('HVAC'), 'HVAC')
  assert.equal(formatTradeLabel('plumbing'), 'Plumbing')
  assert.equal(formatTradeLabel('general_repair'), 'General Repair')
})
