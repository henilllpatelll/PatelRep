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
    // V2 permission transition (owner decision 2026-11-24, 14-v2-permission-transition.md) is the ONLY permitted permissions change:
    // `disableBypassPermissionsMode` and exactly these routine ask rules were removed; nothing was added and deny/allow are unchanged.
    const TRANSITION_REMOVED_ASK = ['Bash(git push*)', 'Bash(npm install*)', 'Bash(npm i *)', 'Bash(npm ci*)', 'Bash(npm uninstall*)', 'Bash(npm update*)', 'Bash(pip install*)', 'Bash(gh pr create*)']
    const { disableBypassPermissionsMode, ...phase2Rest } = phase2Settings.permissions
    assert.equal(disableBypassPermissionsMode, 'disable', 'Phase 2 had disabled bypass mode')
    assert.deepEqual(settings.permissions, { ...phase2Rest, ask: phase2Rest.ask.filter((r) => !TRANSITION_REMOVED_ASK.includes(r)) }, 'permissions unchanged apart from the recorded transition')
    for (const r of TRANSITION_REMOVED_ASK) assert.ok(phase2Rest.ask.includes(r), `${r} existed in Phase 2`)
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
  const M1_PINNED = { 'scripts/developer-harness-v2/policy-engine.mjs': '4e4a31d5152b3eb46f9f1ae8b7621682031873749c5824fba13d8d30c6eb5b87', 'scripts/developer-harness-v2/path-policy.mjs': 'f27d0cece5a68d6bd180ca8254eb52eb1762e05708d61a2e581e6532634585f3' }
  const M1_NEW = new Set(['scripts/developer-harness-v2/policy-fixtures-m1.mjs', 'scripts/developer-harness-v2/m1-hardening.test.mjs'])
  // Phase 4 remediation (owner GO 2026-11-22: git rm/mv first-operand skip and copy/move directory destinations) is the ONLY further
  // change to the enforcement set, and it is confined to these two files. They are pinned (LF-normalized sha256 of the approved
  // content): any other edit must update the pin in a reviewed change. The two new files below did not exist in Phase 2.
  const REMEDIATION_PINNED = { 'scripts/developer-harness-v2/git-policy.mjs': '58200c8760b845015fff2c65014cfcd9caaa9827edf3fe55c4badb254b35c58d', 'scripts/developer-harness-v2/file-command-policy.mjs': 'b64e86b092ae1488599dd1b67da6643ecbfae8837848ef89caf39b54cbe5dd61' }
  const REMEDIATION_NEW = new Set(['scripts/developer-harness-v2/policy-fixtures-copymove.mjs', 'scripts/developer-harness-v2/copymove-remediation.test.mjs'])
  // Phase 4 path-resolution remediation (owner GO 2026-11-22: unresolvable path forms, glob deletes, New-Item -Name, nested instruction
  // files, link handling) is the ONLY further change to the enforcement set. It supersedes the earlier pins for these files: the
  // remediation necessarily MODIFIES existing lines of path-policy.mjs / file-command-policy.mjs (so M1's additive-only check cannot
  // apply to them any more) and adds one pure option-parsing module (writer-options.mjs) to keep both under the 500-line rule.
  // Content is pinned (LF-normalized sha256); any other edit must update the pin in a reviewed change. Predecessor pins, for the record:
  // path-policy.mjs f27d0cec… (post-M1), file-command-policy.mjs b64e86b0… (post copy/move remediation).
  const PATHRES_PINNED = {
    'scripts/developer-harness-v2/path-policy.mjs': 'b30a8bd5748ba3a3efba43ec94a9e7523dee6d8de69608309f2bfe826c6732f4',
    'scripts/developer-harness-v2/file-command-policy.mjs': 'a145306bb30fad145acfeb6c67ff3443d0b1eae0416afbd3f6affa942e245c60',
    'scripts/developer-harness-v2/writer-options.mjs': '4565a45477372a83a8dff4c696f020799d7e1a8ac4a33b31b206a79fab7ae3e4',
    // cwd tracking only (review C2): popd/Pop-Location, pushd +N, CDPATH and link-crossing cd leave the cwd unknown
    'scripts/developer-harness-v2/command-policy.mjs': 'f525363ff3e4d95dc698578aee1ffe74585004990d24f8f99bd003a7d8b2a533',
    // only change: 'writer-options.mjs' added to the list of modules scanned for emitted actions
    'scripts/developer-harness-v2/policy-engine.test.mjs': 'bd27b54bd68d76dfecbd9b03a0eaa01e9ed6709ecf025e7f376431da83b2af74',
  }
  const PATHRES_NEW = new Set(['scripts/developer-harness-v2/writer-options.mjs', 'scripts/developer-harness-v2/path-resolution.test.mjs'])
  // V2 permission transition (owner decision 2026-11-24, 14-v2-permission-transition.md) is the ONLY further change to the enforcement
  // set. It supersedes the earlier pins of the files it touches; content is pinned (LF-normalized sha256) so any other edit must update
  // the pin in a reviewed change. Predecessor pins for the record: command-policy.mjs f525363f…, policy-engine.test.mjs bd27b54b…,
  // path-policy.mjs b30a8bd5…, git-policy.mjs 58200c87…, policy-engine.mjs 4e4a31d5….
  const TRANSITION_PINNED = {
    '.claude/hooks/policy-hook.mjs': 'f45a1f9419a5ef26f216b8742775204f8db53f0e4e9f0081e3d2c371f3ac695f',
    'docs/developer-harness-v2/contract.json': 'a1893abb511f3bd0fdcaeb5249684d2923c6037eb39762d210b8a1eecb061d3b',
    'scripts/developer-harness-v2/command-policy.mjs': 'ac0305f531c8f89c769854eb80ef84afa856dac9b582e5423410558ad2dbd841',
    'scripts/developer-harness-v2/command-tools.mjs': '19eaa90245c95606d9b896d8c7fe52eb2206f01ea2317683cb60775315503b4f',
    'scripts/developer-harness-v2/git-policy.mjs': 'c2e327e18b46dd4c399b0693c42103f3cb66fe7f99976e71eab6f205ede1aa2a',
    'scripts/developer-harness-v2/path-policy.mjs': '03955387f7be1123ccbd56b08045dc3ec7832a8baa5af2eaef891e547fd72e44',
    'scripts/developer-harness-v2/policy-common.mjs': '1e4de44eab93bd838ff9b11e1eccf34a9140c892bc6bab968d7e5f1f9b765dec',
    'scripts/developer-harness-v2/policy-engine.mjs': 'd4ce102a6f7aebcc9bdad92d705a61f32b3d2a56c3715c68e006cd0c77a8bb10',
    'scripts/developer-harness-v2/policy-engine.test.mjs': '2934747bd6ead9f6b2326ec7f9b478cc9c161b8e6c81ba34dd6c8cab91384308',
    'scripts/developer-harness-v2/copymove-remediation.test.mjs': 'ddf3815f46899d3a2abe10182e3eb2e1530aee16373ef6c22e516dfed3dd0add',
    'scripts/developer-harness-v2/m1-hardening.test.mjs': 'a395e8144c3a7248359b54f6e72c0080f9a1c3105b09e1ebd7dad765137d7220',
    'scripts/developer-harness-v2/path-resolution.test.mjs': 'be4b9c7905d54794af1279fbcb79f38cbb67f168ff8913395ee4807736ff4530',
    'scripts/developer-harness-v2/runtime-failclosed-check.mjs': '5aaca7a977c30f7106bc49b1302e890c4272bffdabfef36aa33bea74c178f3b2',
    // Pin-provenance remediation (owner-authorized, PR #252 review B1/B2/N1): full-sha --from-ref, provenance verification, single --scope.
    // Predecessor pins: bypass-authorization.mjs d4fae120…, bypass-pins.mjs d73e1bd2…, bypass-authorization.test.mjs 100e518c…, bypass-hook.test.mjs 883e3dd7….
    'scripts/developer-harness-v2/bypass-authorization.mjs': '44b39eb07d3a5a8d12e882d5bc2202f1d271cf4866ac0429dff7bc4ed3262371',
    'scripts/developer-harness-v2/bypass-digest.mjs': '79fc4296a5368df224e92e9e059f23acbde92f605f861c179829a0d224fb091a',
    'scripts/developer-harness-v2/bypass-pins.mjs': '5bd3e965d0c9337856c36cc8fd4de08b49d06365f8ca232730a27568c1cc7419',
    'scripts/developer-harness-v2/bypass-git-index.mjs': 'dd900befa6258c3cd23c050f98ae1d0f8f423776ba302edd257d831f18d22b99',
    'scripts/developer-harness-v2/bypass-authorization.test.mjs': '97f82fc1ee6c06c54f4331eadb1e4138c10aac545b8a5827f17168d2106d81fd',
    'scripts/developer-harness-v2/bypass-hook.test.mjs': 'db6027a28a34e5118936d97a94df7c74da797da9c32d4e2a014f5707d883274e',
  }
  const TRANSITION_NEW = new Set(['scripts/developer-harness-v2/bypass-authorization.mjs', 'scripts/developer-harness-v2/bypass-digest.mjs', 'scripts/developer-harness-v2/bypass-pins.mjs', 'scripts/developer-harness-v2/bypass-git-index.mjs',
    'scripts/developer-harness-v2/bypass-authorization.test.mjs', 'scripts/developer-harness-v2/bypass-hook.test.mjs'])
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
    if (TRANSITION_PINNED[rel]) {
      if (TRANSITION_NEW.has(rel)) assert.equal(gitShow(PHASE2, rel), null, `${rel} is new in the V2 permission transition`)
      else assert.notEqual(read(rel), gitShow(PHASE2, rel), `${rel} carries the approved V2 permission transition`)
      assert.equal(createHash('sha256').update(read(rel).split(CR + LF).join(LF)).digest('hex'), TRANSITION_PINNED[rel], `${rel} differs from the approved V2 permission transition content`)
      continue
    }
    if (PATHRES_NEW.has(rel)) {
      assert.equal(gitShow(PHASE2, rel), null, `${rel} is new in the Phase 4 path-resolution remediation`)
      if (PATHRES_PINNED[rel]) assert.equal(createHash('sha256').update(read(rel).split(CR + LF).join(LF)).digest('hex'), PATHRES_PINNED[rel], `${rel} differs from the approved path-resolution content`)
      continue
    }
    if (PATHRES_PINNED[rel]) {
      assert.notEqual(read(rel), gitShow(PHASE2, rel), `${rel} carries the approved path-resolution remediation`)
      assert.equal(createHash('sha256').update(read(rel).split(CR + LF).join(LF)).digest('hex'), PATHRES_PINNED[rel], `${rel} differs from the approved path-resolution content`)
      continue
    }
    if (M1_NEW.has(rel)) { assert.equal(gitShow(PHASE2, rel), null, `${rel} is new in Phase 4`); continue }
    if (REMEDIATION_NEW.has(rel)) { assert.equal(gitShow(PHASE2, rel), null, `${rel} is new in the Phase 4 remediation`); continue }
    if (REMEDIATION_PINNED[rel]) {
      assert.notEqual(read(rel), gitShow(PHASE2, rel), `${rel} carries the approved remediation`)
      assert.equal(createHash('sha256').update(read(rel).split(CR + LF).join(LF)).digest('hex'), REMEDIATION_PINNED[rel], `${rel} differs from the approved remediation content`)
      continue
    }
    if (M1_FILES.has(rel)) {
      assert.equal(additiveOver(gitShow(PHASE2, rel), read(rel)), null, `${rel}: a Phase 2 line was removed or changed (M1 must be additive)`)
      assert.notEqual(read(rel), gitShow(PHASE2, rel), `${rel} carries the approved M1 addition`)
      // The ordered-subsequence check cannot see an INSERTED line, so the two enforcement sources are also pinned (LF-normalized
      // sha256 of the approved post-M1 content). Any further edit to them must update this pin in a reviewed change.
      const pin = M1_PINNED[rel]
      if (pin) assert.equal(createHash('sha256').update(read(rel).split(CR + LF).join(LF)).digest('hex'), pin, `${rel} differs from the approved post-M1 content`)
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
