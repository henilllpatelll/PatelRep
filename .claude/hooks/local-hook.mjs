#!/usr/bin/env node
// Portable launcher for local-only Claude Code hooks (OpenWolf, dev servers, graphify).
// Usage: node "$CLAUDE_PROJECT_DIR/.claude/hooks/local-hook.mjs" <wolf <name> | dev-servers | graphify-update>
// Every kind is a no-op when CI is set, so GitHub runners never start servers or mutate tracked files.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
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

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

async function startDevServers(root) {
  const servers = [
    { port: 3000, script: 'dev:web', log: 'patelrep-dev-web.log' },
    { port: 8000, script: 'dev:api', log: 'patelrep-dev-api.log' },
  ]
  for (const { port, script, log } of servers) {
    if (await portInUse(port)) continue
    const out = openSync(path.join(tmpdir(), log), 'a')
    spawn('npm', ['run', script], { cwd: root, detached: true, stdio: ['ignore', out, out], shell: process.platform === 'win32' }).unref()
  }
}

function graphifyUpdate(root) {
  const script = path.join(root, 'graphify-out', 'auto_update.py')
  const venvPython = process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python')
  if (!existsSync(script) || !existsSync(venvPython)) return 0
  return spawnSync(venvPython, [script], { stdio: 'inherit', cwd: root }).status ?? 0
}

async function main() {
  if (isCI()) return 0
  const [kind, arg] = process.argv.slice(2)
  const root = projectDir()
  if (kind === 'wolf') return runWolf(arg, root)
  if (kind === 'dev-servers') { await startDevServers(root); return 0 }
  if (kind === 'graphify-update') return graphifyUpdate(root)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}

export { isCI }
