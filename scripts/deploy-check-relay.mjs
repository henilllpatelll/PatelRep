#!/usr/bin/env node
// Keeps the Deploy Health Check heartbeat steady without a new secret, service, or cost.
//
// GitHub only delivers `schedule` events on a best-effort basis (delayed/dropped under load; observed
// ~3-7h gaps against a */15 cron), so the cron is demoted to a revival trigger and each completed run
// dispatches the next one (`workflow_dispatch`, the one event GITHUB_TOKEN may create). The next run waits
// `pace_seconds` at its START, so its completion time (what the watchdog measures) is always an honest
// "checks finished" time. This script never fails a health run: a lost relay only lets the cron/push/watchdog
// notice later, and must never look like a production health failure to the Release Engineer.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORKFLOW_FILE = 'deploy-check.yml'
export const MAX_PACE_SECONDS = 900
export const RELAY_PACE_SECONDS = 480
export const DISPATCH_ATTEMPTS = 3
export const HEARTBEAT_BUDGET_MINUTES = 45

/** Invalid input is clamped, never thrown: a bad manual input must not turn into a "failed health check". */
export function parsePace(value) {
  const text = String(value ?? '').trim()
  if (!/^[0-9]{1,6}$/.test(text)) return 0
  return Math.min(Number(text), MAX_PACE_SECONDS)
}

/** Only the trusted default branch of this repository may continue the chain. */
export function shouldRelay({ ref, repository, expectedRepository, conclusionCancelled }) {
  if (conclusionCancelled) return { relay: false, reason: 'run was cancelled' }
  if (ref !== 'refs/heads/main') return { relay: false, reason: `ref ${ref || '(none)'} is not refs/heads/main` }
  if (!repository || repository !== expectedRepository) return { relay: false, reason: 'repository mismatch' }
  return { relay: true, reason: '' }
}

export async function dispatchNext({ repo, exec, sleep = async () => {}, attempts = DISPATCH_ATTEMPTS }) {
  let lastError = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = exec('gh', ['workflow', 'run', WORKFLOW_FILE, '--repo', repo, '--ref', 'main', '-f', `pace_seconds=${RELAY_PACE_SECONDS}`])
    if (result.status === 0) return { dispatched: true, attempt }
    lastError = String(result.stderr ?? '').split('\n')[0].slice(0, 200)
    if (attempt < attempts) await sleep(attempt * 5000)
  }
  return { dispatched: false, error: lastError }
}

/**
 * Worst-case seconds between two consecutive heartbeats on the relay chain: the wait, the slowest health
 * path (needs-chain of the longest jobs) and the relay job itself. Used by the contract test to keep the
 * chain well inside the watchdog budget.
 */
export function worstCaseCycleMinutes({ paceSeconds, healthPathMinutes, relayMinutes }) {
  return paceSeconds / 60 + healthPathMinutes + relayMinutes
}

async function main() {
  const env = process.env
  const mode = process.argv[2]
  if (mode === 'pace') {
    const seconds = parsePace(env.PACE_SECONDS)
    if (seconds > 0) {
      console.log(`Relay pacing: waiting ${seconds}s before checking production.`)
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    }
    return
  }
  if (mode === 'relay') {
    const decision = shouldRelay({
      ref: env.GITHUB_REF,
      repository: env.GITHUB_REPOSITORY,
      expectedRepository: env.REPO,
      conclusionCancelled: env.RUN_CANCELLED === 'true',
    })
    if (!decision.relay) {
      console.log(`Relay not scheduled: ${decision.reason}.`)
      return
    }
    const result = await dispatchNext({
      repo: env.REPO,
      exec: (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', env }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    })
    if (result.dispatched) console.log(`Next Deploy Health Check dispatched (attempt ${result.attempt}), paced ${RELAY_PACE_SECONDS}s.`)
    else console.log(`::warning::Could not dispatch the next Deploy Health Check (${result.error}); cron/push triggers and the watchdog will cover the gap.`)
    return
  }
  throw new Error('usage: deploy-check-relay.mjs pace|relay')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(`::warning::deploy-check relay: ${String(error.message).split('\n')[0]}`)
  })
}
