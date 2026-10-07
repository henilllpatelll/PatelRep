#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const MAX_NAME = 120
const MAX_REQUIREMENTS = 12000

function fail(message) {
  throw new Error(`feature-builder context: ${message}`)
}

export function featureSlug(name) {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  if (!slug) fail('feature name cannot produce a safe branch slug')
  return slug
}

export function resolveFeatureContext({ repo, runId, baseSha, featureName, requirements }) {
  const cleanRepo = String(repo ?? '').trim()
  const cleanRun = String(runId ?? '').trim()
  const cleanSha = String(baseSha ?? '').trim()
  const cleanName = String(featureName ?? '').trim()
  const cleanRequirements = String(requirements ?? '').trim()

  if (!REPO.test(cleanRepo)) fail('repository is invalid')
  if (!RUN_ID.test(cleanRun)) fail('run id is invalid')
  if (!SHA.test(cleanSha)) fail('base SHA is invalid')
  if (cleanName.length < 3 || cleanName.length > MAX_NAME) fail(`feature name must be 3-${MAX_NAME} characters`)
  if (cleanRequirements.length < 10 || cleanRequirements.length > MAX_REQUIREMENTS) {
    fail(`requirements must be 10-${MAX_REQUIREMENTS} characters`)
  }

  const slug = featureSlug(cleanName)
  const branch = `feature/ai-${cleanRun}-${slug}`
  return Object.freeze({
    repo: cleanRepo,
    run_id: cleanRun,
    base_sha: cleanSha,
    feature_name: cleanName,
    branch,
  })
}

function main() {
  const result = resolveFeatureContext({
    repo: process.env.REPO,
    runId: process.env.RUN_ID,
    baseSha: process.env.BASE_SHA,
    featureName: process.env.FEATURE_NAME,
    requirements: process.env.FEATURE_REQUIREMENTS,
  })
  const output = process.env.GITHUB_OUTPUT
  if (!output) fail('GITHUB_OUTPUT is required')
  appendFileSync(output, `base_sha=${result.base_sha}\nbranch=${result.branch}\n`)
  console.log(`Feature builder context: base=${result.base_sha}; branch=${result.branch}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`::error::${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}
