#!/usr/bin/env node
/**
 * Builds the candidate against the hermetic mock origin, stages the standalone assets and runs the
 * credential-free Room-Board gate. Used identically by CI and by developers:
 *   node e2e/hermetic/run.mjs [playwright args, e.g. --update-snapshots]
 * Reads no secret. Public build variables point only at the local mock backend.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'

const MOCK_PORT = process.env.HERMETIC_MOCK_PORT ?? '4010'
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'hermetic-anon-key-not-a-secret',
  NEXT_PUBLIC_API_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_TELEMETRY_DISABLED: '1',
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!process.env.HERMETIC_SKIP_BUILD) {
  run('npm', ['run', 'build'])
  if (!existsSync('.next/standalone/server.js')) throw new Error('standalone server was not produced')
  cpSync('public', '.next/standalone/public', { recursive: true })
  cpSync('.next/static', '.next/standalone/.next/static', { recursive: true })
}
run('npx', ['playwright', 'test', '--config=playwright.hermetic.config.ts', ...process.argv.slice(2)])
