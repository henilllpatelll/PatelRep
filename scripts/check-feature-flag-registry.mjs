#!/usr/bin/env node
/**
 * Keeps apps/api/core/feature_registry.py and apps/web/lib/featureRegistry.ts
 * in sync. Both files are hand-maintained plain dicts (not generated) — this
 * script is the parity check that stands in for a shared source of truth.
 *
 * Usage:
 *   node scripts/check-feature-flag-registry.mjs            # full parity check
 *   node scripts/check-feature-flag-registry.mjs --key foo  # assert one key is registered (used by feature-rollout.yml)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/

export function extractPythonKeys(source) {
  const matches = [...source.matchAll(/key=\s*"([^"]*)"/g)]
  return matches.map((match) => match[1])
}

export function extractTypeScriptKeys(source) {
  // Matches the `key: 'foo'` field inside each FeatureFlagDef entry, not the
  // object's own property names, so formatting of the Record literal doesn't matter.
  const matches = [...source.matchAll(/\bkey:\s*'([^']*)'/g)]
  return matches.map((match) => match[1])
}

function findDuplicates(keys) {
  const seen = new Set()
  const duplicates = new Set()
  for (const key of keys) {
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return [...duplicates]
}

export function checkRegistryParity({ pythonKeys, typeScriptKeys }) {
  const violations = []

  for (const key of pythonKeys) {
    if (!KEY_PATTERN.test(key)) violations.push(`Malformed key in feature_registry.py: ${JSON.stringify(key)}`)
  }
  for (const key of typeScriptKeys) {
    if (!KEY_PATTERN.test(key)) violations.push(`Malformed key in featureRegistry.ts: ${JSON.stringify(key)}`)
  }

  for (const key of findDuplicates(pythonKeys)) violations.push(`Duplicate key in feature_registry.py: ${key}`)
  for (const key of findDuplicates(typeScriptKeys)) violations.push(`Duplicate key in featureRegistry.ts: ${key}`)

  const pythonSet = new Set(pythonKeys)
  const typeScriptSet = new Set(typeScriptKeys)
  const onlyInPython = [...pythonSet].filter((key) => !typeScriptSet.has(key))
  const onlyInTypeScript = [...typeScriptSet].filter((key) => !pythonSet.has(key))

  for (const key of onlyInPython) violations.push(`Key present in feature_registry.py but missing from featureRegistry.ts: ${key}`)
  for (const key of onlyInTypeScript) violations.push(`Key present in featureRegistry.ts but missing from feature_registry.py: ${key}`)

  return { violations, keys: [...new Set([...pythonKeys, ...typeScriptKeys])] }
}

function loadKeys({ pythonPath, typeScriptPath }) {
  const pythonKeys = extractPythonKeys(readFileSync(pythonPath, 'utf8'))
  const typeScriptKeys = extractTypeScriptKeys(readFileSync(typeScriptPath, 'utf8'))
  return { pythonKeys, typeScriptKeys }
}

function main() {
  const argumentsByName = new Map()
  for (let index = 2; index < process.argv.length; index += 2) {
    argumentsByName.set(process.argv[index], process.argv[index + 1])
  }
  const pythonPath = resolve(argumentsByName.get('--python') ?? 'apps/api/core/feature_registry.py')
  const typeScriptPath = resolve(argumentsByName.get('--typescript') ?? 'apps/web/lib/featureRegistry.ts')
  const requestedKey = argumentsByName.get('--key')

  const { pythonKeys, typeScriptKeys } = loadKeys({ pythonPath, typeScriptPath })
  const { violations, keys } = checkRegistryParity({ pythonKeys, typeScriptKeys })

  if (violations.length > 0) {
    for (const violation of violations) console.error(`FEATURE FLAG REGISTRY VIOLATION — ${violation}`)
    process.exit(1)
  }

  if (requestedKey) {
    if (!keys.includes(requestedKey)) {
      console.error(`Unknown feature key: ${requestedKey} — add it to both registries before rolling it out.`)
      process.exit(1)
    }
    console.log(`Feature key is registered: ${requestedKey}`)
    return
  }

  console.log(`Feature flag registry parity: PASS (${keys.length} key${keys.length === 1 ? '' : 's'})`)
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
