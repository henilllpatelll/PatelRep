#!/usr/bin/env node
// Phase 4A: best-effort, read-only capture of the exact production runtime identity before rollback.
// Failure to prove identity is recorded as "unproven"; no endpoint error text enters trusted evidence.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrictTag } from './release-version.mjs'
import { readProductionRuntimeIdentity } from './production-runtime-identity.mjs'

const SHA = /^[0-9a-f]{40}$/

export async function captureProductionRollbackRuntime(readRuntimeIdentity = readProductionRuntimeIdentity) {
  try {
    const identity = await readRuntimeIdentity()
    if (!SHA.test(identity?.sha ?? '') || !parseStrictTag(identity?.version ?? '')) {
      return Object.freeze({ status: 'unproven', sha: null, version: null })
    }
    return Object.freeze({ status: 'proven', sha: identity.sha, version: identity.version })
  } catch {
    return Object.freeze({ status: 'unproven', sha: null, version: null })
  }
}

async function main() {
  const result = await captureProductionRollbackRuntime()
  const output = process.env.GITHUB_OUTPUT
  if (!output) throw new Error('production rollback runtime capture: GITHUB_OUTPUT is required')
  appendFileSync(output, `status=${result.status}\nsha=${result.sha ?? ''}\nversion=${result.version ?? ''}\n`)
  console.log(result.status === 'proven'
    ? `Pre-rollback production identity proven: ${result.version} / ${result.sha}`
    : 'Pre-rollback production identity could not be proven; rollback evidence will record an unproven before-state.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
