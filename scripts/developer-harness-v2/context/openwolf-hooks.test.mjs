// Developer Harness V2 — Phase 3 hook-behavior tests: advisory OpenWolf bookkeeping is opt-in, the Phase 2 policy hook
// still runs and fails closed. Offline: no network, no model calls, no dev servers.
// Run: node --test scripts/developer-harness-v2/context/openwolf-hooks.test.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const PHASE2 = '8cccb11b944ef77b1f29897d0d7575f519f54e90'
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8')
const settings = JSON.parse(read('.claude/settings.json'))
const gitShow = (rev, rel) => { try { return execFileSync('git', ['-C', REPO, 'show', `${rev}:${rel}`], { maxBuffer: 1 << 26 }).toString('utf8') } catch { return null } }
const phase2Settings = JSON.parse(gitShow(PHASE2, '.claude/settings.json') ?? 'null')

const commandsOf = (s) => Object.entries(s.hooks ?? {}).flatMap(([event, groups]) => groups.flatMap((g) => g.hooks.map((h) => ({ event, matcher: g.matcher, ...h }))))
const argsOf = (command) => command.replace(/^node "\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/local-hook\.mjs"\s*/, '').split(/\s+/).filter(Boolean)

const EVENTS = {
  SessionStart: { hook_event_name: 'SessionStart', session_id: 'sim', source: 'startup' },
  PreToolUse: { hook_event_name: 'PreToolUse', session_id: 'sim', permission_mode: 'default', tool_name: 'Read', tool_input: { file_path: 'README.md' }, tool_use_id: 't1' },
  PostToolUse: { hook_event_name: 'PostToolUse', session_id: 'sim', tool_name: 'Write', tool_input: { file_path: 'README.md', content: 'x' }, tool_response: {}, tool_use_id: 't2' },
  Stop: { hook_event_name: 'Stop', session_id: 'sim' },
}

function snapshot(root, rels) {
  const out = {}
  const walk = (rel) => {
    const abs = path.join(root, rel)
    if (!existsSync(abs)) return
    if (statSync(abs).isDirectory()) { for (const f of readdirSync(abs).sort()) walk(path.join(rel, f)); return }
    out[rel.replace(/\\/g, '/')] = createHash('sha256').update(readFileSync(abs)).digest('hex')
  }
  rels.forEach(walk)
  return out
}
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort()

function runSession(projectDir, hookCommands, launcher) {
  for (const h of hookCommands) {
    const input = { ...EVENTS[h.event], cwd: projectDir, transcript_path: path.join(projectDir, 'transcript.jsonl') }
    spawnSync(process.execPath, [launcher, ...argsOf(h.command)], {
      input: JSON.stringify(input), encoding: 'utf8', timeout: 20_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', CLAUDE_PROJECT_DIR: projectDir },
    })
  }
}

test('settings: the Phase 2 policy entry is the only registered hook and is unchanged', (t) => {
  const cmds = commandsOf(settings)
  assert.equal(cmds.length, 1)
  assert.deepEqual(Object.keys(settings.hooks), ['PreToolUse'])
  const [policy] = cmds
  assert.equal(policy.matcher, '*')
  assert.equal(policy.onFailure, 'block')
  assert.equal(policy.timeout, 10)
  assert.ok(!policy.async)
  assert.match(policy.command, /local-hook\.mjs" policy$/)
  if (phase2Settings) {
    assert.deepEqual(settings.hooks.PreToolUse[0], phase2Settings.hooks.PreToolUse[0], 'policy entry deep-equal to Phase 2')
    assert.deepEqual(settings.permissions, phase2Settings.permissions, 'permissions semantically unchanged')
    assert.deepEqual(settings.enabledPlugins, phase2Settings.enabledPlugins)
  } else {
    t.diagnostic('SKIPPED deep-equal vs Phase 2: commit not in local history (shallow clone)')
  }
})

test('no automatic ledger rewrite, graph regeneration, dev server, daemon or paid model call is registered', () => {
  const all = JSON.stringify(settings.hooks)
  for (const banned of [/wolf session-start/, /wolf stop/, /wolf post-(read|write)/, /wolf pre-(read|write)/, /graphify/, /npm run dev/, /dev-servers/, /openwolf/, /daemon/, /claude -p/, /\bclaude\b.*--print/]) {
    assert.doesNotMatch(all, banned)
  }
  for (const ev of ['SessionStart', 'Stop', 'PostToolUse', 'SubagentStop', 'UserPromptSubmit', 'Notification']) assert.ok(!settings.hooks[ev], `${ev} has no advisory registration`)
})

test('OpenWolf scheduler and paid ai_task jobs are disabled; manual commands remain', () => {
  const cfg = JSON.parse(read('.wolf/config.json'))
  assert.equal(cfg.openwolf.cron.enabled, false, 'daemon would not start the cron engine')
  const manifest = JSON.parse(read('.wolf/cron-manifest.json'))
  for (const t of manifest.tasks.filter((x) => x.action.type === 'ai_task')) assert.equal(t.enabled, false, `${t.id} (paid claude -p) disabled`)
  assert.ok(manifest.tasks.length >= 5, 'tasks kept for explicit `openwolf cron run <id>`')
  assert.ok(existsSync(path.join(REPO, '.wolf/hooks/session-start.js')), 'hook scripts kept for explicit use')
})

test('simulated session: Phase 2 baseline hooks wrote tracked .wolf files; the Phase 3 hooks write nothing', (t) => {
  if (!phase2Settings) { t.skip('Phase 2 settings not in local history'); return }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dhv2-wolfsim-'))
  try {
    mkdirSync(path.join(tmp, '.claude/hooks'), { recursive: true })
    cpSync(path.join(REPO, '.claude/hooks/local-hook.mjs'), path.join(tmp, '.claude/hooks/local-hook.mjs'))
    cpSync(path.join(REPO, '.wolf/hooks'), path.join(tmp, '.wolf/hooks'), { recursive: true, filter: (s) => !/_session\.json|\.tmp$/.test(s) })
    for (const [rel, text] of Object.entries({
      '.wolf/config.json': read('.wolf/config.json'), '.wolf/cerebrum.md': '# Cerebrum\n\n## Do-Not-Repeat\n', '.wolf/anatomy.md': '# anatomy.md\n',
      '.wolf/memory.md': '# Memory\n', '.wolf/buglog.json': '{"version":1,"bugs":[]}\n', '.wolf/token-ledger.json': '{"version":1,"lifetime":{},"sessions":[]}\n', 'README.md': 'x\n',
    })) writeFileSync(path.join(tmp, rel), text)
    const watched = ['.wolf']
    const launcher = path.join(tmp, '.claude/hooks/local-hook.mjs')
    const advisory = commandsOf(phase2Settings).filter((h) => !/ policy$/.test(h.command) && !/graphify/.test(h.command))
    const before = snapshot(tmp, watched)
    runSession(tmp, advisory, launcher)
    const baselineWrites = changed(before, snapshot(tmp, watched))
    assert.ok(baselineWrites.length >= 2, `baseline advisory hooks wrote: ${baselineWrites.join(', ')}`)
    assert.ok(baselineWrites.some((f) => /memory\.md|token-ledger\.json|_session\.json/.test(f)))
    const mid = snapshot(tmp, watched)
    runSession(tmp, commandsOf(settings).filter((h) => !/ policy$/.test(h.command)), launcher)
    assert.deepEqual(changed(mid, snapshot(tmp, watched)), [], 'no non-policy hook writes anything')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('the registered policy hook runs against the real repository without writing tracked or .wolf files', () => {
  const watched = ['.wolf', 'graphify-out/GRAPH_REPORT.md', 'graphify-out/graph.json', 'CLAUDE.md', '.claude']
  const before = snapshot(REPO, watched)
  const statusBefore = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { maxBuffer: 1 << 24 }).toString()
  for (const h of commandsOf(settings)) {
    const ok = spawnSync(process.execPath, [path.join(REPO, '.claude/hooks/local-hook.mjs'), ...argsOf(h.command)], {
      input: JSON.stringify({ ...EVENTS.PreToolUse, cwd: REPO }), encoding: 'utf8', timeout: 20_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', CLAUDE_PROJECT_DIR: REPO },
    })
    assert.equal(ok.status, 0, `harmless Read allowed: ${ok.stderr}`)
  }
  assert.deepEqual(changed(before, snapshot(REPO, watched)), [])
  assert.equal(execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { maxBuffer: 1 << 24 }).toString(), statusBefore)
})

test('Phase 2 enforcement still denies a forbidden action and fails closed on malformed input', () => {
  const run = (input) => spawnSync(process.execPath, [path.join(REPO, '.claude/hooks/local-hook.mjs'), 'policy'], {
    input, encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', CLAUDE_PROJECT_DIR: REPO },
  })
  const deny = run(JSON.stringify({ ...EVENTS.PreToolUse, cwd: REPO, tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }))
  assert.equal(deny.status, 2, 'forbidden → exit 2')
  assert.equal(run('{not json').status, 2, 'malformed → exit 2 (fail closed)')
  assert.equal(run(JSON.stringify({ ...EVENTS.PreToolUse, cwd: REPO, tool_name: 'Read', tool_input: { file_path: `${REPO}/.wolf/knowledge/web.dnr.md` } })).status, 0, 'reading curated memory is allowed')
})

test('enforcement and hook source files are byte-identical to Phase 2; graphify auto_update untouched', (t) => {
  if (!phase2Settings) { t.skip('Phase 2 commit not in local history'); return }
  const same = [
    '.claude/hooks/local-hook.mjs', '.claude/hooks/policy-hook.mjs', 'graphify-out/auto_update.py', 'docs/developer-harness-v2/contract.json', 'AGENTS.md',
    ...readdirSync(path.join(REPO, '.wolf/hooks')).filter((f) => f.endsWith('.js') || f === 'package.json').map((f) => `.wolf/hooks/${f}`),
    ...readdirSync(path.join(REPO, 'scripts/developer-harness-v2')).filter((f) => f.endsWith('.mjs') && f !== 'policy-hook.test.mjs').map((f) => `scripts/developer-harness-v2/${f}`),
  ]
  // Phase 4 M1 (human-approved) is the ONLY permitted change to the Phase 2 enforcement set, and it must be purely additive:
  // every Phase 2 line survives in order (a trailing comma added to a JSON list item is tolerated), nothing is removed or reworded.
  const M1_FILES = new Set(['docs/developer-harness-v2/contract.json', 'scripts/developer-harness-v2/policy-engine.mjs', 'scripts/developer-harness-v2/path-policy.mjs', 'scripts/developer-harness-v2/policy-fixtures.mjs'])
  const M1_NEW = new Set(['scripts/developer-harness-v2/policy-fixtures-m1.mjs', 'scripts/developer-harness-v2/m1-hardening.test.mjs'])
  const LF = String.fromCharCode(10)
  const CR = String.fromCharCode(13)
  const norm = (l) => (l.endsWith(CR) ? l.slice(0, -1) : l).replace(/,\s*$/, '')
  const additiveOver = (oldText, newText) => {
    const next = newText.split(LF).map(norm)
    let i = 0
    for (const line of oldText.split(LF).map(norm)) {
      while (i < next.length && next[i] !== line) i++
      if (i === next.length) return line
      i++
    }
    return null
  }
  for (const rel of same) {
    if (M1_NEW.has(rel)) { assert.equal(gitShow(PHASE2, rel), null, `${rel} is new in Phase 4`); continue }
    if (M1_FILES.has(rel)) {
      assert.equal(additiveOver(gitShow(PHASE2, rel), read(rel)), null, `${rel}: a Phase 2 line was removed or changed (M1 must be additive)`)
      assert.notEqual(read(rel), gitShow(PHASE2, rel), `${rel} carries the approved M1 addition`)
      continue
    }
    assert.equal(read(rel), gitShow(PHASE2, rel), `${rel} unchanged`)
  }
})

test('existing local hook commands are syntactically valid', () => {
  const files = ['.claude/hooks/local-hook.mjs', '.claude/hooks/policy-hook.mjs', ...readdirSync(path.join(REPO, '.wolf/hooks')).filter((f) => f.endsWith('.js')).map((f) => `.wolf/hooks/${f}`)]
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', path.join(REPO, f)], { encoding: 'utf8' })
    assert.equal(r.status, 0, `${f}: ${r.stderr}`)
  }
})
