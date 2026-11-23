#!/usr/bin/env node
// Developer Harness V2 — Phase 3 reproducible before/after context-efficiency measurement.
//
// Compares the pre-Phase-3 protocol (state at --before, default the Phase 2 head) with the current working tree for
// the representative benchmark tasks. File sizes are MEASURED (bytes). Token figures are ESTIMATED (bytes ÷ 3.5).
// No actual Claude token counts or costs are available here, and none are claimed.
//
//   node context-report.mjs [--repo <dir>] [--before <sha>] [--format md|json]
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildContextPack, routeTask } from './context-packs.mjs'
import { ESTIMATE_CHARS_PER_TOKEN } from './knowledge-topics.mjs'

export const BENCHMARK_TASKS = Object.freeze([
  { id: 'T1', task: 'Fix a small web UI bug on the dashboard page' },
  { id: 'T2', task: 'Change the mobile My Rooms screen' },
  { id: 'T3', task: 'API validation bug in the work-order endpoint' },
  { id: 'T4', task: 'Review the new migration file before it ships' },
  { id: 'T5', task: 'Investigate a CI workflow release failure and its security impact' },
  { id: 'T6', task: 'Update the developer harness context pack' },
])

/** Files the pre-Phase-3 protocol loaded on every task: auto-loaded instructions + mandated full reads. */
export const OLD_PROTOCOL = Object.freeze({
  auto: ['CLAUDE.md', '.wolf/OPENWOLF.md', '.claude/rules/openwolf.md'],
  mandated: ['.wolf/cerebrum.md', '.wolf/anatomy.md'],
})

export const TRACKED_ARTIFACTS = Object.freeze([
  '.wolf/cerebrum.md', '.wolf/anatomy.md', '.wolf/OPENWOLF.md', '.claude/rules/openwolf.md', 'CLAUDE.md', '.wolf/memory.md',
  '.wolf/token-ledger.json', '.wolf/buglog.json', '.wolf/hooks/_session.json', '.wolf/supervisor_ui.xml',
])

const est = (b) => Math.ceil(b / ESTIMATE_CHARS_PER_TOKEN)

export function measure({ repo, before }) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { maxBuffer: 1 << 28 }).toString('utf8')
  const sizeAt = (rev, p) => { try { return Number(git('cat-file', '-s', `${rev}:${p}`).trim()) } catch { return null } }
  const sizeNow = (p) => { try { return statSync(path.join(repo, p)).size } catch { return null } }
  const tracked = new Set(git('ls-files', '-z').split('\0').filter(Boolean))
  const present = git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '.wolf/knowledge').split('\0').filter(Boolean)
  const treeBytes = (rev, prefix) => git('ls-tree', '-r', '-l', rev, prefix).split('\n').filter(Boolean).reduce((n, l) => n + Number(l.split(/\s+/)[3] || 0), 0)
  const files = TRACKED_ARTIFACTS.map((p) => ({ path: p, before_bytes: sizeAt(before, p), after_bytes: sizeNow(p), tracked_after: tracked.has(p) }))
  const oldAuto = OLD_PROTOCOL.auto.reduce((n, p) => n + (sizeAt(before, p) ?? 0), 0)
  const oldMandated = OLD_PROTOCOL.mandated.reduce((n, p) => n + (sizeAt(before, p) ?? 0), 0)
  const tasks = BENCHMARK_TASKS.map((t) => {
    const category = routeTask({ task: t.task })
    const pack = buildContextPack({ root: repo, category })
    return {
      ...t, category,
      old_est_tokens: est(oldAuto + oldMandated),
      new_baseline_est_tokens: pack.baseline.est_tokens,
      new_pack_est_tokens: pack.budget.used_tokens,
      new_total_est_tokens: pack.baseline.est_tokens + pack.budget.used_tokens,
      memory_files: pack.load.filter((r) => r.trust === 'data').map((r) => r.path),
      deferred: pack.deferred.map((r) => r.path),
    }
  })
  return {
    before, after: 'working tree', unit: 'bytes MEASURED; tokens ESTIMATED (bytes ÷ 3.5); no actual token or cost data',
    files,
    knowledge_bytes_after: present.reduce((n, p) => n + (sizeNow(p) ?? 0), 0),
    knowledge_files_after: present.length,
    graphify_cache_bytes_before: treeBytes(before, 'graphify-out/cache'),
    runtime_logs_bytes_before: treeBytes(before, '.wolf/runtime-logs'),
    old_protocol: { auto_bytes: oldAuto, mandated_bytes: oldMandated },
    tasks,
  }
}

export function renderMarkdown(r) {
  const n = (v) => (v === null ? '—' : v.toLocaleString('en-US'))
  return [
    `Before: \`${r.before.slice(0, 12)}\` · after: ${r.after} · ${r.unit}`,
    '',
    '| File | Before (bytes) | After (bytes) | Tracked after |',
    '|---|---:|---:|---|',
    ...r.files.map((f) => `| \`${f.path}\` | ${n(f.before_bytes)} | ${n(f.after_bytes)} | ${f.tracked_after ? 'yes' : 'no (archived, ignored)'} |`),
    '',
    '| Task | Category | Old protocol (est. tok) | New baseline (est.) | New pack (est.) | New total (est.) | Memory loaded |',
    '|---|---|---:|---:|---:|---:|---|',
    ...r.tasks.map((t) => `| ${t.id} ${t.task} | ${t.category} | ${n(t.old_est_tokens)} | ${n(t.new_baseline_est_tokens)} | ${n(t.new_pack_est_tokens)} | ${n(t.new_total_est_tokens)} | ${t.memory_files.map((f) => `\`${f.split('/').pop()}\``).join(', ')} |`),
    '',
  ].join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
  const repo = path.resolve(opt('repo', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')))
  const r = measure({ repo, before: opt('before', '8cccb11b944ef77b1f29897d0d7575f519f54e90') })
  console.log(opt('format', 'md') === 'json' ? JSON.stringify(r, null, 2) : renderMarkdown(r))
}
