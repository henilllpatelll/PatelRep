#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const CLI = '@railway/cli@4.30.0'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// `railway up --ci` calls process::exit(1) on ANY build-log stream error, even when the deployment
// itself is healthy. This exact line is the only failure we ever attempt to recover from.
const LOG_STREAM_FAILURE = /^Failed to stream build logs: Failed to retrieve build log\s*$/m

// Anything that says the upload, the build, or the deploy itself failed is never recoverable.
const HARD_FAILURE_MARKERS = [
  /Deploy failed/,
  /Deploy crashed/,
  /Failed to get deploy status/,
  /Failed to upload/,
  /Unauthorized|Not Authorized|Invalid .*token|not logged in/i,
]

const IN_PROGRESS = new Set(['INITIALIZING', 'QUEUED', 'WAITING', 'BUILDING', 'DEPLOYING'])

export const DEFAULT_POLICY = Object.freeze({
  pollIntervalMs: 15_000,
  maxPolls: 80, // 20 minutes, bounded
  maxConsecutiveLookupFailures: 3,
})

/** Returns the one deployment id the CLI printed for THIS upload, or null if it is not unambiguous. */
export function parseDeploymentId(output, { projectId, serviceId }) {
  const pattern = new RegExp(
    `Build Logs:\\s+https://railway\\.com/project/(${UUID})/service/(${UUID})\\?id=(${UUID})`,
    'gi',
  )
  const ids = new Set()
  for (const match of output.matchAll(pattern)) {
    if (match[1].toLowerCase() !== projectId.toLowerCase()) return null
    if (match[2].toLowerCase() !== serviceId.toLowerCase()) return null
    ids.add(match[3].toLowerCase())
  }
  return ids.size === 1 ? [...ids][0] : null
}

export function isRecoverableLogStreamFailure(output) {
  return LOG_STREAM_FAILURE.test(output) && !HARD_FAILURE_MARKERS.some((marker) => marker.test(output))
}

export function evaluateDeployment(deployments, deploymentId) {
  const found = Array.isArray(deployments)
    ? deployments.find((d) => typeof d?.id === 'string' && d.id.toLowerCase() === deploymentId)
    : undefined
  if (!found) return { state: 'missing' }
  const status = String(found.status).toUpperCase()
  if (status === 'SUCCESS') return { state: 'success', status }
  if (IN_PROGRESS.has(status)) return { state: 'pending', status }
  return { state: 'failed', status }
}

/**
 * Upload exactly once. If (and only if) the upload succeeded and the CLI died on the build-log stream
 * transport, prove the SAME deployment id reaches SUCCESS via the Railway API. Never re-uploads.
 */
export async function deployWithRecovery({
  deployArgs,
  projectId,
  serviceId,
  environment,
  runUp,
  listDeployments,
  sleep,
  log = console.log,
  policy = DEFAULT_POLICY,
}) {
  const up = await runUp(deployArgs)
  if (up.code === 0) return { ok: true, recovered: false }

  const fail = (reason) => {
    log(`::error::${reason}`)
    return { ok: false, recovered: false, code: up.code || 1, reason }
  }

  if (!isRecoverableLogStreamFailure(up.output)) {
    return fail(`railway up exited ${up.code} with a failure that is not a build-log transport error; not recovering.`)
  }
  const deploymentId = parseDeploymentId(up.output, { projectId, serviceId })
  if (!deploymentId) {
    return fail('Build-log stream failed, but no single deployment id for the expected staging project/service was printed; not recovering.')
  }

  log(`::warning::Build-log stream failed; verifying Railway deployment ${deploymentId} via the API instead (no re-upload).`)
  let lookupFailures = 0
  let missing = 0
  for (let poll = 1; poll <= policy.maxPolls; poll++) {
    let deployments
    try {
      deployments = await listDeployments({ serviceId, environment })
      lookupFailures = 0
    } catch (error) {
      lookupFailures++
      log(`Deployment lookup failed (${lookupFailures}/${policy.maxConsecutiveLookupFailures}): ${error.message}`)
      if (lookupFailures >= policy.maxConsecutiveLookupFailures) {
        return fail('Could not read deployment state from Railway; failing closed.')
      }
      await sleep(policy.pollIntervalMs)
      continue
    }
    const result = evaluateDeployment(deployments, deploymentId)
    if (result.state === 'success') {
      log(`Railway deployment ${deploymentId} reached SUCCESS (poll ${poll}).`)
      return { ok: true, recovered: true, deploymentId }
    }
    if (result.state === 'failed') return fail(`Railway deployment ${deploymentId} ended ${result.status}.`)
    if (result.state === 'missing' && ++missing >= policy.maxConsecutiveLookupFailures) {
      return fail(`Railway deployment ${deploymentId} is not visible in the staging service deployment list.`)
    }
    if (result.state !== 'missing') missing = 0
    log(`Deployment ${deploymentId}: ${result.status ?? 'not listed yet'} (poll ${poll}/${policy.maxPolls})`)
    await sleep(policy.pollIntervalMs)
  }
  return fail(`Railway deployment ${deploymentId} did not reach SUCCESS within the bounded wait.`)
}

function run(args, { tee }) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--yes', CLI, ...args], { env: process.env, shell: process.platform === 'win32' })
    let output = ''
    let stdout = ''
    const collect = (stream, sink, isStdout) => stream.on('data', (chunk) => {
      output += chunk
      if (isStdout) stdout += chunk
      if (tee) sink.write(chunk)
    })
    collect(child.stdout, process.stdout, true)
    collect(child.stderr, process.stderr, false)
    child.on('error', (error) => resolve({ code: 1, output: output + String(error) }))
    child.on('close', (code) => resolve({ code: code ?? 1, output, stdout }))
  })
}

async function main() {
  const [path] = process.argv.slice(2)
  const { STAGING_RAILWAY_PROJECT_ID: projectId, TARGET_SERVICE_ID: serviceId, RAILWAY_TOKEN } = process.env
  if (!path || !projectId || !serviceId || !RAILWAY_TOKEN) {
    console.error('usage: staging-railway-deploy.mjs <path>; requires RAILWAY_TOKEN, STAGING_RAILWAY_PROJECT_ID, TARGET_SERVICE_ID')
    process.exit(2)
  }
  const result = await deployWithRecovery({
    deployArgs: ['up', path, '--ci', '--no-gitignore', '--path-as-root', '--project', projectId, '--environment', 'staging', '--service', serviceId],
    projectId,
    serviceId,
    environment: 'staging',
    runUp: (args) => run(args, { tee: true }),
    listDeployments: async ({ serviceId: service, environment }) => {
      const res = await run(['deployment', 'list', '--service', service, '--environment', environment, '--limit', '20', '--json'], { tee: false })
      if (res.code !== 0) throw new Error(`railway deployment list exited ${res.code}`)
      return JSON.parse(res.stdout)
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
  process.exit(result.ok ? 0 : result.code)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
