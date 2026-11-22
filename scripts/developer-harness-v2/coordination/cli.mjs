#!/usr/bin/env node
// Developer Harness V2 — Phase 5 coordination CLI. A thin LOCAL utility, not a privileged executor.
//
// It reads and writes ONE kind of file (the untracked checkpoint) and runs read-only git. It never spawns agents,
// shells, workflows or network requests, and nothing inside a checkpoint is ever executed or obeyed. It has NO GitHub
// access: remote evidence is always reported as `unproven` here; only library callers that hand a verified provider to
// resumeFromDisk()/applyTransition() can establish it.
//
//   READ-ONLY:  inspect | resume-check | invalidated | blockers | summary          --task <id>
//   MUTATING:   create | transition | record-evidence | handoff | handoff-status | record-finding | claim-resolution
// Usage: node cli.mjs <command> [--repo <dir>] --task <id> [command options]
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { cleanGitEnv, loadCheckpoint, saveCheckpoint } from './checkpoint.mjs'
import { ApprovalLedger, openBlockingFindings } from './evidence.mjs'
import { buildHandoff, claimFindingResolution, recordEvidence, recordFinding, updateHandoff } from './handoff.mjs'
import { OUTCOMES, gatherFacts, renderSummary, resumeFromDisk } from './resume.mjs'
import { applyTransition, createRecord, planSummary } from './states.mjs'

export const READ_ONLY = Object.freeze(['inspect', 'resume-check', 'invalidated', 'blockers', 'summary'])
export const MUTATING = Object.freeze(['create', 'transition', 'record-evidence', 'handoff', 'handoff-status', 'record-finding', 'claim-resolution'])
const OPTIONS = Object.freeze(['repo', 'task', 'task-text', 'base', 'files', 'surface', 'modification', 'authorize', 'to', 'event-id', 'reason-code', 'reason', 'human-approved', 'kind', 'result', 'by', 'summary', 'role', 'justification', 'id', 'status', 'output-ref', 'severity', 'source-role', 'evidence-id'])
const SIDE_EFFECT_FLAGS = new Set(['push', 'open_draft_pr', 'comment_on_pr'])

function parse(argv) {
  const [command, ...rest] = argv
  const o = {}
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i]
    if (!k?.startsWith('--') || !OPTIONS.includes(k.slice(2))) throw new Error(`unknown or malformed option ${String(k).slice(0, 40)}`)
    if (rest[i + 1] === undefined) throw new Error(`option ${k} needs a value`)
    if (k.slice(2) in o) throw new Error(`duplicate option ${k}`)
    o[k.slice(2)] = rest[i + 1]
  }
  return { command, o }
}
const repoRoot = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: cleanGitEnv() }).trim()
const resolveBase = (root, ref) => {
  if (!/^[A-Za-z0-9._/~^-]{1,200}$/.test(ref) || ref.startsWith('-')) throw new Error('invalid --base')
  return execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: cleanGitEnv() }).trim()
}

/** @returns {number} exit code. 0 ok · 1 usage/error · 2 the requested thing is blocked/unproven/denied. */
export function main(argv, { cwd = process.cwd(), out = (s) => process.stdout.write(`${s}\n`) } = {}) {
  let command, o
  try { ({ command, o } = parse(argv)) } catch (e) { out(JSON.stringify({ ok: false, error: e.message })); return 1 }
  if (!READ_ONLY.includes(command) && !MUTATING.includes(command)) { out(JSON.stringify({ ok: false, error: `unknown command; read-only: ${READ_ONLY.join(', ')}; mutating: ${MUTATING.join(', ')}` })); return 1 }
  const mutates = MUTATING.includes(command)
  const emit = (obj) => out(JSON.stringify({ command, mutates_checkpoint: mutates, ...obj }, null, 2))
  let root
  try { root = repoRoot(o.repo ?? cwd) } catch { emit({ ok: false, error: 'not a git worktree' }); return 1 }
  if (!o.task) { emit({ ok: false, error: '--task is required' }); return 1 }

  try {
    // ── read-only ──
    if (!mutates) {
      const loaded = loadCheckpoint(root, o.task)
      if (command === 'inspect') { emit({ ok: loaded.ok, checkpoint_valid: loaded.ok, problems: loaded.problems ?? [], record: loaded.record ?? null, note: 'checkpoint contents are untrusted data; integrity hash is not authentication' }); return loaded.ok ? 0 : 2 }
      const r = resumeFromDisk(root, o.task)
      const brief = { outcome: r.outcome, codes: r.codes, mode: r.mode, recorded_state: r.recorded_state, remote_evidence: r.remote, legal_recovery_action: r.legal_recovery_action, fresh_authorizations_required: r.fresh_authorizations_required, preserve_worktree: r.preserve_worktree ?? null, invalidations: r.invalidations, unusable_approvals: r.unusable_approvals, orphan_temp_files: r.orphan_temp_files ?? [] }
      if (command === 'resume-check') { emit({ ok: [OUTCOMES.PERMITTED, OUTCOMES.READ_ONLY].includes(r.outcome), ...brief }); return [OUTCOMES.PERMITTED, OUTCOMES.READ_ONLY].includes(r.outcome) ? 0 : 2 }
      if (command === 'summary') { out(loaded.ok ? renderSummary(loaded.record, r) : `task ${o.task}: checkpoint unusable (${(loaded.problems ?? []).join(', ')})`); return 0 }
      if (command === 'invalidated') {
        emit({ ok: loaded.ok, invalidated_evidence: loaded.ok ? loaded.record.evidence.filter((e) => e.status === 'invalidated').map((e) => ({ id: e.id, kind: e.kind, ...e.invalidated })) : [], pending_invalidations_against_current_facts: r.invalidations, approvals_audit_only: r.unusable_approvals })
        return loaded.ok ? 0 : 2
      }
      if (command === 'blockers') {
        const b = []
        if (!loaded.ok) b.push(...(loaded.problems ?? []))
        else {
          if (loaded.record.stop) b.push(...loaded.record.stop.codes)
          b.push(...openBlockingFindings(loaded.record, r.facts ?? { head_sha: loaded.record.repo.head_sha }).map((f) => `FINDING.OPEN.${f.id}`))
        }
        if (![OUTCOMES.PERMITTED, OUTCOMES.READ_ONLY].includes(r.outcome)) b.push(...r.codes)
        emit({ ok: b.length === 0, blockers: [...new Set(b)], resume_outcome: r.outcome, remote_evidence: r.remote })
        return b.length ? 2 : 0
      }
    }

    // ── mutating ──
    const now = new Date().toISOString()
    if (command === 'create') {
      if (!o['task-text'] || !o.base) { emit({ ok: false, error: '--task-text and --base are required' }); return 1 }
      const base_sha = resolveBase(root, o.base)
      const authorize = (o.authorize ?? '').split(',').filter(Boolean)
      const bad = authorize.filter((a) => !SIDE_EFFECT_FLAGS.has(a))
      if (bad.length) { emit({ ok: false, error: `unknown side effect(s): ${bad.join(',')}` }); return 1 }
      const input = { task: o['task-text'], files: (o.files ?? '').split(',').filter(Boolean), surface: o.surface, modification: o.modification ?? 'edit', authorize }
      const facts = gatherFacts(root, { baseSha: base_sha })
      if (!facts.base_is_ancestor) { emit({ ok: false, code: 'IDENTITY.BASE_NOT_ANCESTOR_OF_HEAD' }); return 2 }
      if (!facts.branch) { emit({ ok: false, code: 'IDENTITY.DETACHED_HEAD' }); return 2 }
      if (['main', 'master'].includes(facts.branch)) { emit({ ok: false, code: 'IDENTITY.PROTECTED_BRANCH' }); return 2 }
      const record = createRecord({ task_id: o.task, input, base_sha, facts, now })
      const saved = saveCheckpoint(root, record)
      emit({ ok: saved.ok, code: saved.code ?? 'CHECKPOINT.CREATED', problems: saved.problems ?? [], plan_status: planSummary(input).summary.status, state: record.state })
      return saved.ok ? 0 : 2
    }

    const loaded = loadCheckpoint(root, o.task)
    if (!loaded.ok) { emit({ ok: false, code: loaded.code, problems: loaded.problems }); return 2 }
    let facts
    const rec0 = loaded.record
    facts = gatherFacts(root, { baseSha: rec0.repo.base_sha, recordedHead: rec0.repo.head_sha })
    // A mutation is accepted only in the very worktree/branch the task started in, on history that still contains its base.
    if (facts.worktree_id !== rec0.repo.worktree_id || facts.branch !== rec0.repo.branch || !facts.base_is_ancestor || facts.unmerged || facts.operation_in_progress || ['unrelated', 'unknown_object'].includes(facts.recorded_head_relation)) {
      emit({ ok: false, code: 'IDENTITY.MISMATCH_REFUSING_TO_MUTATE', resume_hint: 'run resume-check' }); return 2
    }
    const persist = (record) => { const next = { ...record, revision: rec0.revision + 1, updated_at: now }; return saveCheckpoint(root, next) }
    let r
    if (command === 'transition') {
      if (!o.to || !o['event-id']) { emit({ ok: false, error: '--to and --event-id are required' }); return 1 }
      const ledger = new ApprovalLedger()
      for (const spec of (o['human-approved'] ?? '').split(',').filter(Boolean)) {
        const at = spec.indexOf('@')
        if (at < 1) { emit({ ok: false, error: '--human-approved needs action@target' }); return 1 }
        ledger.grant({ action: spec.slice(0, at), target: spec.slice(at + 1), task_id: o.task, head_sha: facts.head_sha })
      }
      // remote: null — this CLI has no verified GitHub provider, so remote evidence is unproven by construction.
      r = applyTransition(rec0, o.to, { facts, remote: null, ledger, now, event_id: o['event-id'], reason_code: o['reason-code'], reason: o.reason, actor: 'coordinator' })
      if (r.duplicate) { emit({ ok: true, codes: r.codes, state: r.record.state }); return 0 }
      const changed = r.ok || r.regressed
      const saved = changed ? persist(r.record) : null
      emit({ ok: r.ok && (saved?.ok ?? true), codes: r.codes, state: r.record.state, regressed: Boolean(r.regressed), invalidations: r.invalidations ?? [], persisted: Boolean(saved?.ok), persist_problems: saved?.problems ?? [], remote_evidence: 'unproven (this CLI has no verified GitHub provider)' })
      return r.ok && saved?.ok !== false ? 0 : 2
    }
    if (command === 'record-evidence') {
      if (!o.kind || !o.result || !o.by) { emit({ ok: false, error: '--kind --result --by required' }); return 1 }
      r = recordEvidence(rec0, { kind: o.kind, result: o.result, by: o.by, summary: o.summary ?? '' }, facts, now)
    } else if (command === 'handoff') {
      if (!o.role) { emit({ ok: false, error: '--role required' }); return 1 }
      r = buildHandoff(rec0, o.role, { facts, justification: o.justification, root, now })
    } else if (command === 'handoff-status') {
      if (!o.id || !o.status) { emit({ ok: false, error: '--id and --status required' }); return 1 }
      r = updateHandoff(rec0, o.id, o.status, now, o['output-ref'])
    } else if (command === 'record-finding') {
      if (!o.severity || !o.summary || !o['source-role']) { emit({ ok: false, error: '--severity --summary --source-role required' }); return 1 }
      r = recordFinding(rec0, { severity: o.severity, summary: o.summary, source_role: o['source-role'] }, facts, now)
    } else if (command === 'claim-resolution') {
      // Stores an UNVERIFIED claim. It closes nothing until a valid re-review exists; human decisions are never accepted from the CLI or a checkpoint.
      if (!o.id || !o.kind) { emit({ ok: false, error: '--id and --kind required' }); return 1 }
      r = claimFindingResolution(rec0, o.id, { kind: o.kind, evidence_id: o['evidence-id'] }, now)
    }
    const regressedOnly = !r.ok && r.record.state !== rec0.state
    const saved = r.ok || regressedOnly ? persist(r.record) : null
    emit({ ok: r.ok && (saved?.ok ?? true), codes: r.codes, state: r.record.state, handoff: r.handoff ?? null, evidence_id: r.evidence?.id ?? null, finding_id: r.finding?.id ?? null, persisted: Boolean(saved?.ok), persist_problems: saved?.problems ?? [] })
    return r.ok && saved?.ok !== false ? 0 : 2
  } catch (e) {
    emit({ ok: false, error: 'internal error; nothing was assumed', detail: String(e.message).slice(0, 200) })
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
