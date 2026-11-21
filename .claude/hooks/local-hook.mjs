#!/usr/bin/env node
// Portable launcher for local-only Claude Code hooks (OpenWolf, graphify, Developer Harness V2 policy).
// Usage: node "$CLAUDE_PROJECT_DIR/.claude/hooks/local-hook.mjs" <wolf <name> | graphify-update | policy>
// Advisory kinds (wolf, graphify) are no-ops when CI is set, so GitHub runners never mutate tracked files. The
// `policy` kind is inert only on a GitHub Actions runner (GITHUB_ACTIONS + RUNNER_TEMP + GITHUB_RUN_ID), so CI agent
// jobs keep the tool scopes their own workflows define. That is a compatibility switch for trusted runners, NOT an
// authorization token: whoever controls the environment that launches Claude Code can set those variables (see
// docs/developer-harness-v2/07-phase-2-policy-implementation.md).
// Dev servers are never auto-started (Phase 2): `npm run dev:api` loads apps/api/.env, which may point at
// production. Start them manually; see the Phase 2 document.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const isCI = (env = process.env) => Boolean(env.CI && env.CI !== 'false') || env.GITHUB_ACTIONS === 'true'

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function runWolf(name, root) {
  if (!/^[a-z-]+$/.test(name ?? '')) return 0
  const script = path.join(root, '.wolf', 'hooks', `${name}.js`)
  if (!existsSync(script)) return 0
  return spawnSync(process.execPath, [script], { stdio: 'inherit', cwd: root }).status ?? 0
}

function graphifyUpdate(root) {
  const script = path.join(root, 'graphify-out', 'auto_update.py')
  const venvPython = process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python')
  if (!existsSync(script) || !existsSync(venvPython)) return 0
  return spawnSync(venvPython, [script], { stdio: 'inherit', cwd: root }).status ?? 0
}

// The enforcement hook is inert only on a real GitHub Actions runner (where CI agent jobs carry their own
// workflow-defined tool scopes). A bare CI=1 — common in developer shells — does NOT disable enforcement.
const isGitHubRunner = (env = process.env) => env.GITHUB_ACTIONS === 'true' && Boolean(env.RUNNER_TEMP) && Boolean(env.GITHUB_RUN_ID)

async function main() {
  const [kind, arg] = process.argv.slice(2)
  if (kind === 'policy') return isGitHubRunner() ? 0 : (await import('./policy-hook.mjs')).main()
  if (isCI()) return 0
  const root = projectDir()
  if (kind === 'wolf') return runWolf(arg, root)
  if (kind === 'graphify-update') return graphifyUpdate(root)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}

export { isCI }
