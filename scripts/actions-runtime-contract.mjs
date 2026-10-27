#!/usr/bin/env node
// Synthetic, non-sensitive evidence used by the "Actions Runtime Contract" CI jobs to exercise
// actions/upload-artifact@v7 -> actions/download-artifact@v8 across real jobs. It never touches secrets,
// production, or any real release evidence: the payload is a fixed marker plus the run's own identity.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const SCHEMA = 'patelrep.actions-runtime-contract.v1'
const MARKER = 'synthetic-non-sensitive-evidence'
const FILES = ['evidence.json', 'nested/payload.txt']

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

export function produce(dir, identity) {
  for (const key of ['sha', 'runId']) {
    if (!identity?.[key]) throw new Error(`identity.${key} is required`)
  }
  fs.mkdirSync(path.join(dir, 'nested'), { recursive: true })
  const payload = `${MARKER}\n`
  fs.writeFileSync(path.join(dir, 'nested', 'payload.txt'), payload)
  const evidence = {
    schema: SCHEMA,
    marker: MARKER,
    sha: identity.sha,
    run_id: String(identity.runId),
    files: { 'nested/payload.txt': sha256(payload) },
  }
  fs.writeFileSync(path.join(dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  return evidence
}

export function verify(dir, identity) {
  for (const file of FILES) {
    if (!fs.existsSync(path.join(dir, file))) throw new Error(`missing artifact file: ${file}`)
  }
  const extra = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
  const unexpected = extra.filter((f) => !FILES.includes(f))
  if (unexpected.length) throw new Error(`unexpected artifact files: ${unexpected.join(', ')}`)
  let evidence
  try {
    evidence = JSON.parse(fs.readFileSync(path.join(dir, 'evidence.json'), 'utf8'))
  } catch {
    throw new Error('evidence.json is not valid JSON')
  }
  if (evidence.schema !== SCHEMA) throw new Error('schema mismatch')
  if (evidence.marker !== MARKER) throw new Error('marker mismatch')
  if (evidence.sha !== identity.sha) throw new Error(`sha mismatch: artifact ${evidence.sha} != expected ${identity.sha}`)
  if (evidence.run_id !== String(identity.runId)) throw new Error(`run id mismatch: artifact ${evidence.run_id} != expected ${identity.runId}`)
  const keys = Object.keys(evidence.files ?? {})
  if (keys.length !== 1 || keys[0] !== 'nested/payload.txt') throw new Error('manifest file list mismatch')
  const actual = sha256(fs.readFileSync(path.join(dir, 'nested', 'payload.txt')))
  if (actual !== evidence.files['nested/payload.txt']) throw new Error('payload digest mismatch')
  return evidence
}

function main(argv, env) {
  const [command, dir] = argv
  if (!dir || !['produce', 'verify'].includes(command)) throw new Error('usage: actions-runtime-contract.mjs <produce|verify> <dir>')
  const identity = { sha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID }
  if (command === 'produce') produce(dir, identity)
  else verify(dir, identity)
  console.log(`${command} ok`)
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('actions-runtime-contract.mjs')) {
  try {
    main(process.argv.slice(2), process.env)
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exit(1)
  }
}
