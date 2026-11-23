#!/usr/bin/env node
// Developer Harness V2 — Phase 6 command line.
//
//   node cli.mjs plan      [--base <ref>] [--task-id <id>] [--format json|text]    preview only: select + show every command, run nothing
//   node cli.mjs run       [--base <ref>] [--task-id <id>] [--approve id,id] [--python <abs python>] [--execute]
//                          without --execute this is the same preview; with it the allowlisted commands run sequentially
//   node cli.mjs checklist [--base <ref>] [--task-id <id>]
//   node cli.mjs evaluate  [--corpus <file>]
//
// Never installs dependencies, never starts Docker/Supabase, never dispatches workflows, never writes a checkpoint. It reads
// git (read-only) and, with --task-id, the task checkpoint read-only. Reports always carry the NON-AUTHORITATIVE banner.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCheckpoint } from '../coordination/checkpoint.mjs'
import { BANNER, SUITE_BY_ID } from './catalog.mjs'
import { buildChecklist } from './checklist.mjs'
import { buildRepoIndex, collectChanges } from './changes.mjs'
import { evaluateCorpus, loadCorpus } from './evaluate.mjs'
import { buildReport, identityFrom, renderText, writeRunRecord } from './report.mjs'
import { previewPlan, runPlan } from './runner.mjs'
import { selectTests } from './select.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(HERE, '..', '..', '..')
const VALUE_OPTS = new Set(['base', 'task-id', 'format', 'approve', 'python', 'corpus', 'root'])
const FLAG_OPTS = new Set(['execute'])

export function parseArgs(argv) {
  const [cmd, ...rest] = argv
  const o = { cmd, format: 'text', approve: [] }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a.slice(0, 40)}`)
    const k = a.slice(2)
    if (FLAG_OPTS.has(k)) { o[k] = true; continue }
    if (!VALUE_OPTS.has(k)) throw new Error(`unknown option --${k.slice(0, 30)}`)
    const v = rest[++i]
    if (v === undefined || v.startsWith('--')) throw new Error(`option --${k} needs a value`)
    o[k === 'task-id' ? 'taskId' : k] = k === 'approve' ? v.split(',').filter(Boolean) : v
  }
  if (!['plan', 'run', 'checklist', 'evaluate'].includes(cmd)) throw new Error('usage: plan | run | checklist | evaluate')
  if (!['json', 'text'].includes(o.format)) throw new Error('--format must be json or text')
  for (const id of o.approve) if (!SUITE_BY_ID[id]) throw new Error(`--approve names unknown suite ${id.slice(0, 40)}`)
  return o
}

/** Pure-ish entry point: returns { code, out }. `signal` lets a caller interrupt a run; partial results are still reported. */
export async function main(argv, { root = DEFAULT_ROOT, signal = null, write = true } = {}) {
  let o
  try { o = parseArgs(argv) } catch (e) { return { code: 2, out: `${e.message}\n` } }
  const R = o.root ?? root
  if (o.cmd === 'evaluate') {
    const ev = evaluateCorpus(o.corpus ? loadCorpus(o.corpus) : loadCorpus())
    return { code: ev.acceptance.met ? 0 : 1, out: `${JSON.stringify({ banner: BANNER, ...ev, results: undefined }, null, 2)}\n` }
  }
  let base = o.base ?? null
  let taskRecord = null
  if (o.taskId) {
    const c = loadCheckpoint(R, o.taskId)
    if (c.ok) { taskRecord = c.record; base = base ?? c.record.repo?.base_sha ?? null }
  }
  const change = collectChanges(R, { base })
  const { identity, problems } = identityFrom(change.ok === false ? {} : change, { taskId: o.taskId ?? null, taskRecord })
  if (o.taskId && !taskRecord) problems.push('TASK.CHECKPOINT_UNAVAILABLE')
  const index = buildRepoIndex(R)
  const selection = selectTests(change, { index })
  const plan = previewPlan(selection, { root: R, approve: o.approve, python: o.python ?? null })
  if (o.cmd === 'checklist') {
    const cl = buildChecklist(selection)
    return { code: 0, out: o.format === 'json' ? `${JSON.stringify({ banner: BANNER, ...cl }, null, 2)}\n` : `${BANNER}\n\n${cl.items.map((i) => `[ ] ${i.id}: ${i.behavior}\n    why: ${i.why_adjacent}\n    automated: ${i.automated.map((a) => a.suite_id).join(', ') || 'none selected'}   manual: ${i.manual_needed ? 'YES' : 'no'}   env: ${i.environment}\n    pass evidence: ${i.pass_evidence}`).join('\n')}\n\n${BANNER}\n` }
  }
  const execute = o.cmd === 'run' && o.execute === true
  let run = null
  if (execute) run = await runPlan(plan, { root: R, signal, approve: o.approve, python: o.python ?? null })
  const report = buildReport({ selection, plan, run, identity, identityProblems: problems })
  const checklist = buildChecklist(selection, run?.results ?? null)
  let note = ''
  if (execute && write) { const w = writeRunRecord(R, report); note = w.ok ? `\nrun record: ${path.relative(R, w.file)}\n` : `\nrun record NOT written (${w.code})\n` }
  if (o.cmd === 'run' && !execute) note += '\nPreview only. Re-run with --execute to run the allowlisted local commands (dependencies are never installed; expensive suites need --approve <id>).\n'
  const out = o.format === 'json' ? `${JSON.stringify({ ...report, checklist }, null, 2)}\n` : `${renderText(report, checklist)}${note}`
  const failed = run && run.results.some((r) => ['FAILED', 'TIMED_OUT', 'INTERRUPTED', 'NO_TESTS_DISCOVERED', 'INVALID_TREE_CHANGED'].includes(r.status))
  const incomplete = run && !failed && report.evidence.result !== 'pass' // blocked / unapproved / not-run suites: nothing is proven, so the exit status says so
  return { code: failed ? 1 : incomplete ? 3 : 0, out }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ac = new AbortController()
  process.on('SIGINT', () => ac.abort())
  process.on('SIGTERM', () => ac.abort())
  main(process.argv.slice(2), { signal: ac.signal }).then(({ code, out }) => { process.stdout.write(out); process.exitCode = code })
}
