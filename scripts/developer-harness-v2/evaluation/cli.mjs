// Developer Harness V2 — Phase 7 evaluation CLI. PREVIEW-ONLY by default.
//
//   node scripts/developer-harness-v2/evaluation/cli.mjs                     preview (lists what `run` would do; executes nothing)
//   node .../cli.mjs run --fixtures-only [--usage F] [--tasks F] [--write]    explicit local fixture benchmark
//   node .../cli.mjs import-usage F | import-tasks F                          validate sanitized local evidence only
//
// No agents are spawned, no Claude session is launched, no remote call is made, and nothing runs in the background.

import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../coordination/states.mjs'
import { compare } from './compare.mjs'
import { runBenchmark } from './executor.mjs'
import { analyze } from './false-positives.mjs'
import { buildReliability } from './reliability.mjs'
import { buildReport, harnessIdentity, renderMarkdown, writeReport } from './report.mjs'
import { SCENARIOS, registryDigest } from './scenarios.mjs'
import { scoreAll, summarize } from './scorer.mjs'
import { importTaskRecords, importUsage, readEvidenceFile } from './usage-import.mjs'

const VALUE_FLAGS = new Set(['--usage', '--tasks'])
const BOOL_FLAGS = new Set(['--fixtures-only', '--write', '--json'])
const COMMANDS = new Set(['preview', 'run', 'import-usage', 'import-tasks'])

export function parseArgs(argv) {
  const o = { command: 'preview', flags: new Set(), values: {}, positional: [] }
  const rest = [...argv]
  if (rest[0] && !rest[0].startsWith('--')) { o.command = rest.shift(); if (!COMMANDS.has(o.command)) throw new Error(`unknown command ${o.command.slice(0, 30)}`) }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (BOOL_FLAGS.has(a)) o.flags.add(a)
    else if (VALUE_FLAGS.has(a)) { const v = rest[++i]; if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`); o.values[a] = v }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a.slice(0, 40)}`)
    else o.positional.push(a)
  }
  return o
}

export function preview() {
  return {
    mode: 'PREVIEW — nothing was executed', scenarios: SCENARIOS.map((s) => ({ id: s.id, category: s.category, evaluation_level: s.evaluation_level, expected: s.expected, real_task_completion: s.real_task_completion ?? 'n/a' })),
    config_digest: registryDigest(), to_run: 'node scripts/developer-harness-v2/evaluation/cli.mjs run --fixtures-only [--usage FILE] [--tasks FILE] [--write]',
    safety: ['offline and fixture-only', 'disposable temp repositories only (B-11, B-12), removed afterwards', 'no network, database, GitHub mutation or model call', 'reports (with --write) go only to the git-ignored .wolf/runtime-logs/developer-harness-v2/evaluation/'],
  }
}

export function runEvaluation({ root = REPO_ROOT, usageFile = null, tasksFile = null, write = false, now = new Date().toISOString() } = {}) {
  const t0 = Date.now()
  const results = runBenchmark()
  const benchmarkMs = Date.now() - t0
  const scores = scoreAll(results)
  const summary = summarize(scores)
  const fp = analyze()
  const usage = usageFile ? importUsage(readEvidenceFile(usageFile)) : null
  const tasks = tasksFile ? importTaskRecords(readEvidenceFile(tasksFile)) : null
  const reliability = buildReliability({ scores, summary, fp, usage, tasks, benchmarkMs, now })
  const comparison = compare({ tasks, usage, reliability, fp })
  const report = buildReport({ harness: harnessIdentity(root), scores, summary, reliability, fp, comparison, usage, tasks, now })
  const written = write ? writeReport(root, report) : null
  return { report, written }
}

export function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) }) {
  let o
  try { o = parseArgs(argv) } catch (e) { io.err(`error: ${e.message}`); return 2 }
  try {
    if (o.command === 'preview') { io.out(JSON.stringify(preview(), null, 2)); return 0 }
    if (o.command === 'import-usage' || o.command === 'import-tasks') {
      if (o.positional.length !== 1) { io.err('error: exactly one evidence file is required'); return 2 }
      const r = (o.command === 'import-usage' ? importUsage : importTaskRecords)(readEvidenceFile(o.positional[0]))
      io.out(JSON.stringify({ ok: r.ok, file_errors: r.file_errors, accepted: r.accepted?.length ?? null, rejected: r.rejected, unattributed: r.unattributed ?? null, metrics: r.metrics.length }, null, 2))
      return r.ok ? 0 : 1
    }
    if (!o.flags.has('--fixtures-only')) { io.err('error: `run` requires the explicit --fixtures-only flag (this benchmark never touches live systems)'); return 2 }
    const { report, written } = runEvaluation({ usageFile: o.values['--usage'] ?? null, tasksFile: o.values['--tasks'] ?? null, write: o.flags.has('--write') })
    io.out(o.flags.has('--json') ? JSON.stringify(report, null, 2) : renderMarkdown(report))
    if (written) io.out(`\nReport written (local, git-ignored): ${written.json}\n${written.md}`)
    return report.benchmark.summary.failed + report.benchmark.summary.blocked + report.benchmark.summary.not_executed === 0 ? 0 : 1
  } catch (e) {
    io.err(`error: ${String(e.message).replace(/[^\w .:,/-]/g, '').slice(0, 200)}`)
    return 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main()
