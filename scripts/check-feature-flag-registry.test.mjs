import assert from 'node:assert/strict'
import test from 'node:test'

import { checkRegistryParity, extractPythonKeys, extractTypeScriptKeys } from './check-feature-flag-registry.mjs'

const pythonSample = `
_DEFS = [
    FeatureFlagDef(
        key="lost_found_guest_claims",
        description="x",
        type="release",
        backend_enforced=True,
    ),
    FeatureFlagDef(
        key="staging_flag_demo",
        description="y",
        type="release",
        backend_enforced=True,
    ),
]
`

const typeScriptSample = `
export const FEATURE_REGISTRY: Record<string, FeatureFlagDef> = {
  lost_found_guest_claims: {
    key: 'lost_found_guest_claims',
    description: 'x',
    type: 'release',
    backendEnforced: true,
  },
  staging_flag_demo: {
    key: 'staging_flag_demo',
    description: 'y',
    type: 'release',
    backendEnforced: true,
  },
}
`

test('extracts key= string literals from the Python registry', () => {
  assert.deepEqual(extractPythonKeys(pythonSample), ['lost_found_guest_claims', 'staging_flag_demo'])
})

test("extracts key: '...' literals from the TypeScript registry", () => {
  assert.deepEqual(extractTypeScriptKeys(typeScriptSample), ['lost_found_guest_claims', 'staging_flag_demo'])
})

test('passes when both registries declare the same keys', () => {
  const result = checkRegistryParity({
    pythonKeys: ['a_b', 'c_d'],
    typeScriptKeys: ['a_b', 'c_d'],
  })
  assert.deepEqual(result.violations, [])
})

test('flags a key missing from the TypeScript registry', () => {
  const result = checkRegistryParity({ pythonKeys: ['a_b', 'c_d'], typeScriptKeys: ['a_b'] })
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /missing from featureRegistry\.ts: c_d/)
})

test('flags a key missing from the Python registry', () => {
  const result = checkRegistryParity({ pythonKeys: ['a_b'], typeScriptKeys: ['a_b', 'c_d'] })
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /missing from feature_registry\.py: c_d/)
})

test('flags a malformed key', () => {
  const result = checkRegistryParity({ pythonKeys: ['Bad-Key'], typeScriptKeys: ['Bad-Key'] })
  assert.ok(result.violations.some((violation) => violation.includes('Malformed key')))
})

test('flags a duplicate key within one registry', () => {
  const result = checkRegistryParity({ pythonKeys: ['a_b', 'a_b'], typeScriptKeys: ['a_b'] })
  assert.ok(result.violations.some((violation) => violation.includes('Duplicate key')))
})
