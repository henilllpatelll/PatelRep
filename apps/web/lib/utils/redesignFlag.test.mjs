import assert from 'node:assert/strict'
import test from 'node:test'
import { isSectionRedesigned } from './redesignFlag.ts'

test('empty web_redesign_sections falls back to legacy', () => {
  assert.equal(isSectionRedesigned('tasks', { web_redesign_sections: [] }), false)
})

test('matching section key resolves to v2', () => {
  assert.equal(isSectionRedesigned('tasks', { web_redesign_sections: ['tasks'] }), true)
})

test('unknown section key falls back to legacy', () => {
  assert.equal(isSectionRedesigned('engineering', { web_redesign_sections: ['tasks'] }), false)
})

test('null/undefined hotel falls back to legacy', () => {
  assert.equal(isSectionRedesigned('tasks', null), false)
  assert.equal(isSectionRedesigned('tasks', undefined), false)
})
