import assert from 'node:assert/strict'
import test from 'node:test'
import { isAncestorViaCompare } from './production-release-request-deps.mjs'

const REPO = 'henilllpatelll/PatelRep'
const SHA = 'a'.repeat(40)

test('ancestry reads only .status from the compare endpoint, never the full (unbounded) body', () => {
  let args
  const read = (a) => {
    args = a
    return 'ahead\n'
  }
  assert.equal(isAncestorViaCompare(read, REPO, SHA, 'main'), true)
  assert.deepEqual(args, ['api', `repos/${REPO}/compare/${SHA}...main`, '--jq', '.status'])
})

test('ancestry is true only for identical/ahead and fails closed otherwise', () => {
  for (const status of ['identical', 'ahead']) assert.equal(isAncestorViaCompare(() => `${status}\n`, REPO, SHA, 'main'), true)
  for (const status of ['behind', 'diverged', '', 'null']) assert.equal(isAncestorViaCompare(() => `${status}\n`, REPO, SHA, 'main'), false)
  assert.throws(() => isAncestorViaCompare(() => { throw new Error('gh failed') }, REPO, SHA, 'main'), /gh failed/)
})
