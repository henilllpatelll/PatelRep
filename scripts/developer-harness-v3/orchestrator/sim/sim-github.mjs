// Developer Harness V3 (D3.6) — SIMULATED GitHub + shared staging (every output is labelled simulated; no network, no credential, no real repository).
//
// It models what the delivery path must survive, taken from the audited workflows (doc 31): pushes never to `main` and never non-fast-forward; one open PR per head branch
// ("A pull request already exists"); CI on every PR head with `ci-<ref>` cancel-in-progress; CI Gate + the four Mobile CI checks from the github-actions app (15368);
// Staging Candidate started by a successful PR CI run, ONE shared `staging-release-candidate` group (cancel false) with ONE running and ONE PENDING run where a newer pending
// run REPLACES the older one; a Staging Gate check bound to the head SHA; foreign staging runs of other PRs; re-runs of failed jobs; workflow_dispatch of staging by PR number.
// Faults: lost responses after the effect, rejections before it, hangs (cancellable only through the AbortSignal), crashes after the effect, rate limits, eventual-consistency read
// lag, spoofed check runs from another app. State is a persistent JSON file, so a restarted controller sees what really happened while it was down.
import path from 'node:path'
import { atomicWriteJson, readJsonState } from '../../lib/atomic.mjs'
import { sha1 } from './sim-world.mjs'

export const ACTIONS_APP_ID = 15368
export const CI_WORKFLOW = '.github/workflows/ci.yml'
export const MOBILE_WORKFLOW = '.github/workflows/mobile-ci.yml'
export const STAGING_WORKFLOW = '.github/workflows/staging-candidate.yml'
export const MOBILE_CHECKS = Object.freeze(['Mobile CI Workflow Contract', 'Mobile / Type-check', 'Mobile / Lint', 'Mobile / Jest'])
export class SimCrash extends Error { constructor(op) { super(`SIM.CRASH_AFTER_EFFECT:${op}`); this.code = 'SIM_CRASH' } }
const err = (status, code, extra = {}) => Object.assign(new Error(code), { status, code, ...extra })

const DEFAULTS = Object.freeze({ ciMs: 8 * 60_000, stagingMs: 20 * 60_000, readLagMs: 0, rate: { limit: 5000, windowMs: 3600_000 } })

export class SimGitHub {
  constructor({ dir, clock, repository = 'henilllpatelll/PatelRep', mainSha, scenario = {} }) {
    this.file = path.join(dir, 'github.json'); this.clock = clock; this.repository = repository; this.sc = { ...DEFAULTS, ...scenario }
    const r = readJsonState(this.file)
    this.s = r.ok ? r.value : { simulated: true, n: { pr: 100, run: 5000, check: 9000 }, main: mainSha, refs: {}, refLog: {}, prs: [], runs: [], checks: [], rate: { used: 0, window_start: clock() }, faults: {}, ops: [], counters: {} }
    this.save()
  }
  save() { atomicWriteJson(this.file, this.s) }
  // ------------------------------------------------------------- fault injection (tests)
  inject(op, fault, times = 1) { this.s.faults[op] = { fault, times }; this.save() }
  #fault(op) { const f = this.s.faults[op]; if (!f || f.times <= 0) return null; f.times -= 1; if (f.times === 0) delete this.s.faults[op]; return f.fault }
  #rate() {
    const now = this.clock(); const R = this.s.rate
    if (now - R.window_start >= this.sc.rate.windowMs) { R.window_start = now; R.used = 0 }
    R.used += 1
    if (R.used > this.sc.rate.limit) throw err(403, 'GITHUB.RATE_LIMITED', { rate_limited: true, reset_at: R.window_start + this.sc.rate.windowMs })
  }
  advanceMain(sha) { this.s.main = sha; this.s.refLog.main = [...(this.s.refLog.main ?? []), { sha, at: this.clock() }]; this.save() }
  /** Another actor (e.g. the Release Engineer) pushes onto a branch: the delivery path must detect a foreign head before any mutation. */
  foreignPush(branch, sha) { this.#setRef(branch, sha); this.save() }
  /** Another PR occupies shared staging for `ms` (a foreign Staging Candidate run). */
  foreignStaging(ms) { this.#tick(); this.#queueStaging({ pr_number: 1, head_sha: sha1(`foreign:${this.clock()}`), foreign: true, duration: ms }); this.save() }

  // ------------------------------------------------------------- the trusted publisher's write path (credential held by the publisher adapter only)
  async call(op, args, { signal, credential } = {}) {
    if (credential?.scope !== 'publisher' || credential?.simulated !== true) throw err(401, 'GITHUB.UNAUTHENTICATED')
    this.#rate(); this.#tick()
    const fault = this.#fault(op)
    if (fault === 'reject') { this.save(); throw err(422, 'GITHUB.VALIDATION_FAILED', { before_effect: true }) }
    if (fault === 'timeout_before') { this.save(); throw err(0, 'ETIMEDOUT') }
    if (fault === 'crash_before') { this.save(); throw new SimCrash(op) } // the controller dies after sending, before any effect and before any outcome is recorded
    if (fault === 'hang') { this.save(); return new Promise((_, rej) => { signal?.addEventListener('abort', () => rej(err(0, 'ABORTED_BY_CALLER')), { once: true }) }) }
    const result = this.#apply(op, args)
    this.s.ops.push({ op, at: this.clock(), args: { ...args, body: undefined } }); this.save()
    if (fault === 'lose_response') throw err(0, 'ECONNRESET')
    if (fault === 'crash_after') throw new SimCrash(op)
    return result
  }
  #apply(op, a) {
    if (op === 'push_ref') {
      if (!/^dh3\/[a-z0-9-]{1,80}$/.test(a.branch ?? '')) throw err(422, 'GITHUB.REF_NAME_INVALID')
      if (a.branch === 'main') throw err(403, 'GITHUB.PROTECTED_BRANCH')
      const cur = this.s.refs[a.branch]?.sha ?? null
      if (cur !== (a.expected_old ?? null)) throw err(422, 'GITHUB.NOT_FAST_FORWARD') // never a force push
      this.#setRef(a.branch, a.sha); return { ref: a.branch, sha: a.sha }
    }
    if (op === 'create_pull') {
      if (a.base !== 'main') throw err(422, 'GITHUB.BASE_INVALID')
      if (this.s.prs.some((p) => p.head_ref === a.head && p.state === 'open')) throw err(422, 'GITHUB.PULL_ALREADY_EXISTS')
      const head = this.s.refs[a.head]?.sha; if (!head) throw err(422, 'GITHUB.HEAD_UNKNOWN')
      const pr = { number: (this.s.n.pr += 1), head_ref: a.head, head_sha: head, base_ref: 'main', draft: a.draft === true, state: 'open', title: a.title, body_digest: a.body_digest, author: 'patelrep-v3-publisher[bot]', created_at: this.clock(), updated_at: this.clock() }
      this.s.prs.push(pr); this.#startCi(pr); return { number: pr.number }
    }
    if (op === 'update_pull') { const pr = this.#pr(a.number); pr.title = a.title; pr.body_digest = a.body_digest; pr.updated_at = this.clock(); return { number: pr.number } }
    if (op === 'mark_ready') { const pr = this.#pr(a.number); pr.draft = false; pr.updated_at = this.clock(); return { number: pr.number } }
    if (op === 'rerun_failed_jobs') {
      const run = this.s.runs.find((r) => r.id === a.run_id); if (!run || run.status !== 'completed' || run.conclusion === 'success') throw err(422, 'GITHUB.RUN_NOT_RERUNNABLE')
      if (run.attempt !== a.attempt) throw err(422, 'GITHUB.RUN_ATTEMPT_CHANGED')
      run.attempt += 1; run.status = 'in_progress'; run.conclusion = null; run.started_at = this.clock(); run.completes_at = this.clock() + this.sc.ciMs; return { run_id: run.id, attempt: run.attempt }
    }
    if (op === 'dispatch_staging') {
      const pr = this.#pr(a.pr_number); this.#queueStaging({ pr_number: pr.number, head_sha: pr.head_sha, dispatched: true }); return { accepted: true }
    }
    throw err(404, 'GITHUB.UNKNOWN_OPERATION')
  }
  #pr(n) { const pr = this.s.prs.find((p) => p.number === n && p.state === 'open'); if (!pr) throw err(404, 'GITHUB.PULL_NOT_FOUND'); return pr }
  #setRef(branch, sha) {
    this.s.refs[branch] = { sha, updated_at: this.clock() }; this.s.refLog[branch] = [...(this.s.refLog[branch] ?? []), { sha, at: this.clock() }]
    const pr = this.s.prs.find((p) => p.head_ref === branch && p.state === 'open'); if (pr) { pr.head_sha = sha; pr.updated_at = this.clock(); this.#startCi(pr) }
  }
  #outcome(kind, sha, attempt) { const plan = this.sc[kind]?.[sha] ?? this.sc[kind]?.default ?? ['pass']; return plan[Math.min(attempt - 1, plan.length - 1)] }
  #startCi(pr) {
    if (this.sc.ciDisabled) return // a CI that never reports (the missing-check case)
    for (const r of this.s.runs) if (r.workflow === CI_WORKFLOW && r.head_branch === pr.head_ref && r.status !== 'completed') { r.status = 'completed'; r.conclusion = 'cancelled'; r.completed_at = this.clock(); this.#checksFor(r) } // ci-<ref>, cancel-in-progress
    for (const wf of [CI_WORKFLOW, MOBILE_WORKFLOW]) {
      const run = { id: (this.s.n.run += 1), workflow: wf, event: 'pull_request', head_sha: pr.head_sha, head_branch: pr.head_ref, pr_number: pr.number, attempt: 1, status: 'in_progress', conclusion: null, created_at: this.clock(), started_at: this.clock(), completes_at: this.clock() + this.sc.ciMs }
      this.s.runs.push(run)
    }
  }
  #queueStaging({ pr_number, head_sha, foreign = false, dispatched = false, duration = this.sc.stagingMs }) {
    for (const r of this.s.runs) if (r.workflow === STAGING_WORKFLOW && r.status === 'pending') { r.status = 'completed'; r.conclusion = 'cancelled'; r.completed_at = this.clock(); r.displaced = true } // one pending per group: the newer replaces it
    this.s.runs.push({ id: (this.s.n.run += 1), workflow: STAGING_WORKFLOW, event: dispatched ? 'workflow_dispatch' : 'workflow_run', head_sha, pr_number, attempt: 1, status: 'pending', conclusion: null, created_at: this.clock(), foreign, duration })
  }
  #checksFor(run) {
    const names = run.workflow === CI_WORKFLOW ? ['CI Gate'] : run.workflow === MOBILE_WORKFLOW ? [...MOBILE_CHECKS] : ['Staging Gate']
    for (const name of names) {
      let c = this.s.checks.find((x) => x.run_id === run.id && x.name === name && x.attempt === run.attempt)
      if (!c) { c = { id: (this.s.n.check += 1), name, head_sha: run.head_sha, app_id: ACTIONS_APP_ID, run_id: run.id, attempt: run.attempt, workflow: run.workflow, details_url: `sim://runs/${run.id}` }; this.s.checks.push(c) }
      c.status = run.status === 'completed' ? 'completed' : 'in_progress'; c.conclusion = run.conclusion; c.completed_at = run.completed_at ?? null
    }
  }
  /** Progress every run to the current time (deterministic). */
  #tick() {
    const now = this.clock()
    for (const r of this.s.runs.filter((x) => x.workflow !== STAGING_WORKFLOW && x.status === 'in_progress' && x.completes_at <= now)) {
      const o = this.#outcome(r.workflow === CI_WORKFLOW ? 'ci' : 'mobile', r.head_sha, r.attempt)
      r.status = 'completed'; r.completed_at = r.completes_at; r.conclusion = o === 'pass' ? 'success' : o === 'cancel' ? 'cancelled' : 'failure'; r.outcome = o
      this.#checksFor(r)
      const pr = this.s.prs.find((p) => p.number === r.pr_number && p.state === 'open')
      if (r.workflow === CI_WORKFLOW && r.conclusion === 'success' && pr) this.#queueStaging({ pr_number: pr.number, head_sha: r.head_sha })
    }
    for (const r of this.s.runs) if (r.workflow !== STAGING_WORKFLOW && r.status === 'in_progress') this.#checksFor(r)
    // the shared staging group: ONE running at a time
    for (let guard = 0; guard < 50; guard += 1) {
      const running = this.s.runs.find((x) => x.workflow === STAGING_WORKFLOW && x.status === 'in_progress')
      if (running) {
        if (running.completes_at > now) break
        const o = running.foreign ? 'pass' : running.ineligible ? 'ineligible' : this.#outcome('staging', running.head_sha, (this.s.counters[`stg:${running.head_sha}`] = (this.s.counters[`stg:${running.head_sha}`] ?? 0) + 1))
        running.status = 'completed'; running.completed_at = running.completes_at; running.conclusion = o === 'pass' ? 'success' : o === 'ineligible' ? 'skipped' : 'failure'; running.outcome = o
        if (!running.ineligible && !running.foreign) this.#checksFor(running)
        continue
      }
      const next = this.s.runs.find((x) => x.workflow === STAGING_WORKFLOW && x.status === 'pending'); if (!next) break
      const startAt = Math.max(next.created_at, ...this.s.runs.filter((x) => x.workflow === STAGING_WORKFLOW && x.completed_at != null && !x.displaced).map((x) => x.completed_at))
      if (startAt > now) break
      next.status = 'in_progress'; next.started_at = startAt; next.completes_at = startAt + (next.duration ?? this.sc.stagingMs)
      const pr = this.s.prs.find((p) => p.number === next.pr_number && p.state === 'open')
      if (!next.foreign && (!pr || pr.head_sha !== next.head_sha)) { next.ineligible = true; next.completes_at = startAt } // resolve: the PR head moved on; no Staging Gate
      else if (!next.foreign) this.#checksFor(next)
    }
  }

  // ------------------------------------------------------------- the trusted READER's path (the delivery verifier; never the controller)
  /** What a read at `now` returns: with read lag, recently created objects and recent ref updates are not visible yet (eventual consistency). Read-only. */
  view() {
    this.#rate(); this.#tick(); this.save()
    const now = this.clock(); const lag = this.sc.readLagMs; const vis = (at) => at <= now - lag
    const refAt = (b) => [...(this.s.refLog[b] ?? [])].reverse().find((e) => vis(e.at))?.sha ?? null
    const refs = Object.fromEntries(Object.keys(this.s.refLog).filter((b) => b !== 'main').map((b) => [b, refAt(b)]).filter(([, s]) => s))
    const s = structuredClone(this.s)
    return { simulated: true, at: now, repository: this.repository, main: refAt('main') ?? this.s.main, refs, prs: s.prs.filter((p) => vis(p.created_at)), runs: s.runs, checks: [...s.checks, ...(this.s.spoofed ?? [])] }
  }
  /** Bounded job log of a failed run (scenario text; may contain credential-shaped strings, to prove the redaction). */
  jobLog(runId, attempt) { this.#rate(); const r = this.s.runs.find((x) => x.id === runId); if (!r) return null; return (this.sc.logs?.[r.outcome] ?? `job failed (${r.outcome})`).slice(0, 65536) + `\n[attempt ${attempt}]` }
  spoofCheck(c) { this.s.spoofed = [...(this.s.spoofed ?? []), { id: (this.s.n.check += 1), status: 'completed', ...c }]; this.save() }
}
