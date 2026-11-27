// Developer Harness V3 (D3.4) — SIMULATED adapters for the orchestrator. `simulated: true` is what lets the engine run at all in D3.4 (live mode is gated shut).
// Scenario-driven and deterministic. The world is persistent (sim-world.mjs), so a crash/restart test sees real leftovers: a session still "alive" in the
// guest, uncommitted files in the worktree, a half-finished unit. The simulation THROWS on invariant violations (duplicate live session, unleased run).
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { restoreSnapshot } from '../snapshot.mjs'
import { MODEL_IDS, streamLines } from './sim-stream.mjs'
import { candidateShaFor, commitDir, loadWorld, patchOf, readTree, saveWorld, sha256, treeOf, wipe, writeFileTree, wtDir } from './sim-world.mjs'

const HEALTHY = { available_mb: 6000, commit_ratio: 0.5, paging_pages_per_sec: 5, cpu_pct: 10, disk_free_gb: 200, host_responsive: true }
const GUEST = { complete: true, mem_available_mb: 2500, psi_memory_some_avg10: 1, disk_free_gb: 10 }
const enc = (s) => Buffer.from(s, 'utf8')

export const DEFAULT_SCENARIO = Object.freeze({ baseContext: 20000, growthPerUnit: 15000, contextWindow: 200000, turnsPerUnit: 5, stages: {}, tests: [], pressure: [], quota: [] })

/** @param {{dir:string, clock:()=>number, scenario?:object, ledger:object}} o */
export function createSimAdapters({ dir, clock, scenario = {}, ledger }) {
  const sc = { ...DEFAULT_SCENARIO, ...scenario }
  const L = ledger
  const stageSpec = (stage, idx) => { const list = sc.stages[stage] ?? []; return list[idx] ?? list.at(-1) ?? {} }
  // Completed work, derived from the LEDGER, so a crashed attempt never consumes a scenario entry.
  const completedRuns = (taskId, stage) => L.db.prepare("SELECT COUNT(*) c FROM executions WHERE task_id=? AND stage=? AND end_reason='completed'").get(taskId, stage).c
  const memExec = new Map() // per-process unit counters: a crash loses them, which is right — the session died with the process
  let govMem = null

  /** Accumulates UNCOMMITTED work in the real worktree files across units (what a renewal must not lose). */
  function writeWork(task, unit, spec, stage) {
    if (stage !== 'implementing') { if (spec.plant) writeFileTree(wtDir(dir, task.task_id), [{ path: spec.plant.path, content: enc(spec.plant.content ?? 'planted by a read-only session\n') }]); return }
    const root = wtDir(dir, task.task_id); const w = loadWorld(dir); const cur = w.versions[task.task_id] ?? 0
    const rel = typeof task.requirements?.sim_path === 'string' ? task.requirements.sim_path : 'apps/mobile/feature.txt' // D3.5 multi-task scenarios: each task writes its own file
    const file = path.join(root, ...rel.split('/'))
    mkdirSync(path.dirname(file), { recursive: true })
    const prev = existsSync(file) ? readFileSync(file, 'utf8') : ''
    writeFileTree(root, [{ path: rel, content: enc(`${prev}unit ${unit} of v${cur + 1}\n`) }, ...(spec.extraFiles ?? []).filter(() => spec.extraFilesOnUnit == null || spec.extraFilesOnUnit === unit).map((x) => ({ path: x.path, content: enc(x.content) }))])
  }

  /** What a COMPLETED session hands back (the controller still re-derives and validates everything that matters). */
  function deliverable(task, stage, spec, readonly) {
    const w = loadWorld(dir)
    if (stage === 'planning') return { plan: { steps: spec.steps ?? [{ id: 'step-a', title: 'Implement the feature', covers: [0] }, { id: 'step-b', title: 'Add tests', depends_on: ['step-a'], covers: [1] }] } }
    if (stage === 'implementing') {
      const files = readTree(wtDir(dir, task.task_id)); const v = (w.versions[task.task_id] ?? 0) + 1
      const cd = commitDir(dir, task.task_id, v); wipe(cd); mkdirSync(cd, { recursive: true }); writeFileTree(cd, files)
      w.versions[task.task_id] = v; saveWorld(dir, w)
      return { completed_steps: spec.completes ?? ['step-a', 'step-b'], complete: true }
    }
    if (readonly) {
      if (spec.tamper) w.tamper_review = true; else delete w.tamper_review
      saveWorld(dir, w)
      const carried = L.db.prepare("SELECT finding_id FROM findings WHERE task_id=? AND mandatory=1 AND status='carried' AND review_id IN (SELECT review_id FROM reviews WHERE kind=?)").all(task.task_id, stage).map((r) => r.finding_id)
      const plan = L.currentPlan(task.task_id); const cov = spec.coverage ?? {}
      const coverage = spec.omitCoverage || !plan ? undefined : { steps: plan.steps.map((s) => ({ id: s.id, status: cov.steps?.[s.id] ?? 'satisfied', evidence: 'simulated reviewer checked the step against the candidate' })),
        criteria: (task.acceptance.criteria ?? []).map((_, i) => ({ index: i, status: cov.criteria?.[i] ?? 'satisfied', evidence: 'simulated reviewer checked the criterion against the candidate' })) }
      return { submission: { findings: spec.findings ?? [], summary: 'simulated review', confirmed_resolved: spec.noConfirm ? [] : carried, coverage } }
    }
    return {}
  }

  const adapters = {
    simulated: true,
    resources: {
      sample() {
        const now = clock(); const p = (sc.pressure ?? []).find((x) => now >= x.from && now < x.to)
        return { host: { ...HEALTHY, ...(p ? { available_mb: p.available_mb } : {}) }, guest: { ...GUEST }, history: [], prevPressure: 'clear', reservations: [], heavy: 0, accel: 'whpx' }
      },
    },
    subscription: {
      load() {
        return govMem ?? JSON.parse(L.meta('sim:gov') ?? 'null') ?? { schema: 'patelrep.developer-harness-v3.subscription-governor', state: 'available', reason_codes: [], attempts: 0, next_eligible_at: null, resets_at_ms: null, reset_basis: null, utilization: 0.08, windows: null,
          extra_usage: { enabled: false, basis: 'SIMULATED_VERIFIED_OFF', verified_at: clock() - 1000 }, updated_at: clock(), owner_attention: false, lifecycle: { state: 'running', reason: null } }
      },
      save(g) { govMem = g; L.setMeta('sim:gov', JSON.stringify(g)) },
    },
    worker: {
      async ensure() { const w = loadWorld(dir); w.vm.running = true; saveWorld(dir, w); return { ok: true } },
      async terminateSession(lease) {
        const w = loadWorld(dir)
        if (w.terminate_unverified_left > 0) { w.terminate_unverified_left -= 1; saveWorld(dir, w); return { verified: false } }
        delete w.alive_sessions[lease.execution_id]; saveWorld(dir, w)
        return { verified: Object.keys(w.alive_sessions).length === 0 }
      },
      async cleanupGuest() {
        const w = loadWorld(dir)
        if (w.cleanup_unverified_left > 0) { w.cleanup_unverified_left -= 1; saveWorld(dir, w); return { verified: false } }
        w.alive_sessions = {}; saveWorld(dir, w)
        return { verified: true }
      },
      async verifyNoWorkerProcesses() { const w = loadWorld(dir); return { verified: Object.keys(w.alive_sessions).length === 0 } },
      async stopWorker() { const w = loadWorld(dir); w.vm.running = false; w.alive_sessions = {}; w.vm.state = 'exited'; saveWorld(dir, w); return { verified: true } },
      async liveness() {
        const w = loadWorld(dir)
        if (w.liveness_override) return w.liveness_override
        return { record: { schema: 'patelrep.developer-harness-v3.vm-supervisor', supervisor_pid: w.vm.supervisor_pid, qemu_pid: w.vm.qemu_pid, marker: w.vm.marker, state: w.vm.state },
          liveness: { supervisor: w.vm.running, qemu: w.vm.running, qemuImage: 'qemu-system-x86_64.exe', reused: false } }
      },
    },
    session: {
      async runUnit({ task, lease, route, readonly, stage }) {
        const w = loadWorld(dir)
        const others = Object.keys(w.alive_sessions).filter((x) => x !== lease.execution_id)
        if (others.length) throw new Error(`SIM.DUPLICATE_LIVE_SESSION:${others[0]}`) // the invariant the whole recovery design exists to uphold
        if (L.checkLease(lease)) throw new Error('SIM.UNLEASED_SESSION')
        w.alive_sessions[lease.execution_id] = { task: task.task_id, stage, at: clock() }; saveWorld(dir, w)
        const mem = memExec.get(lease.execution_id) ?? { unit: 0, ctx: sc.baseContext }
        mem.unit += 1; mem.ctx += sc.growthPerUnit; memExec.set(lease.execution_id, mem)
        const idx = completedRuns(task.task_id, stage)
        const spec = stageSpec(stage, idx)
        const model = MODEL_IDS[spec.actualModel ?? route.model]
        const now = clock()
        const q = (sc.quota ?? []).find((x) => now >= x.from && now < x.to)
        const lines = (extra = {}) => streamLines({ model, turns: sc.turnsPerUnit, contextTokens: mem.ctx, contextWindow: sc.contextWindow, version: spec.version, apiKeySource: spec.apiKeySource, permissionMode: spec.permissionMode, omitUsage: spec.omitUsage, ...extra })
        if (q) return { status: 'failed', code: 'PROVIDER.LIMIT', lines: lines({ rate: 'rejected', resetsAtSec: Math.ceil(q.to / 1000) }), exit: { code: 1 }, turns: 0 }
        if (spec.fail && mem.unit === 1) {
          const key = `fail:${task.task_id}:${stage}:${idx}`
          if ((spec.failTimes ?? 1) > (w.counters[key] ?? 0)) { w.counters[key] = (w.counters[key] ?? 0) + 1; saveWorld(dir, w); return { status: 'failed', code: spec.fail, fingerprint: spec.fail, lines: lines(), exit: { code: 1 } } }
        }
        // `units` is TASK-WIDE for this stage run (it survives renewals and crashes, like the work itself); context growth is per SESSION.
        const ukey = `units:${task.task_id}:${stage}:${idx}`; const w2 = loadWorld(dir); w2.counters[ukey] = (w2.counters[ukey] ?? 0) + 1; saveWorld(dir, w2)
        const total = w2.counters[ukey]
        writeWork(task, total, spec, stage)
        if (total < (spec.units ?? 1)) return { status: 'unit_limit', lines: lines({ subtype: 'error_max_turns' }), exit: { code: 0 }, turns: sc.turnsPerUnit }
        return { status: 'work_complete', lines: lines(), exit: { code: 0 }, turns: sc.turnsPerUnit, work: deliverable(task, stage, spec, readonly) }
      },
      async notes() { return 'simulated session notes' },
    },
    git: {
      async prepareWorktree(task, { snapshotDir, readonly }) {
        const w = loadWorld(dir); const root = wtDir(dir, task.task_id)
        wipe(root); mkdirSync(root, { recursive: true })
        const v = w.versions[task.task_id] ?? 0
        const committed = v ? readTree(commitDir(dir, task.task_id, v)) : []
        writeFileTree(root, committed)
        let snapshot_digest = null
        if (snapshotDir && !readonly) { const r = restoreSnapshot(snapshotDir, root, { scope: task.scope }); if (!r.ok) return { ok: false, code: r.problems[0] }; snapshot_digest = r.digest }
        return { ok: true, head_sha: v ? candidateShaFor(task.task_id, v) : null, base_sha: L.currentBase(task.task_id), tree_digest: v ? treeOf(committed) : null, snapshot_digest }
      },
      async worktreeState(task) { return existsSync(wtDir(dir, task.task_id)) ? 'present' : 'missing' },
      async workerHead(task) { const v = loadWorld(dir).versions[task.task_id] ?? 0; return { head_sha: v ? candidateShaFor(task.task_id, v) : null } },
      async captureSnapshot(task) {
        const w = loadWorld(dir); const v = w.versions[task.task_id] ?? 0
        const committed = new Map((v ? readTree(commitDir(dir, task.task_id, v)) : []).map((f) => [f.path, sha256(f.content)]))
        return readTree(wtDir(dir, task.task_id)).filter((f) => committed.get(f.path) !== sha256(f.content)).map((f) => ({ path: f.path, mode: '100644', content: f.content }))
      },
      async deriveCandidate(task) {
        const w = loadWorld(dir); const v = w.versions[task.task_id] ?? 0
        if (!v) return { ok: false, code: 'CANDIDATE.NOT_DERIVABLE' }
        const files = readTree(commitDir(dir, task.task_id, v))
        return { ok: true, base_sha: L.currentBase(task.task_id), candidate_sha: candidateShaFor(task.task_id, v), tree_digest: treeOf(files), patch_digest: patchOf(files), changed_paths: files.map((f) => f.path), changes: files.map((f) => ({ status: (sc.modified ?? []).includes(f.path) ? 'M' : 'A', path: f.path })) }
      },
      async treeDigestAfterReview(task) {
        const w = loadWorld(dir); const files = readTree(commitDir(dir, task.task_id, w.versions[task.task_id] ?? 0))
        return w.tamper_review ? treeOf([...files, { path: 'tampered.txt', content: enc('x') }]) : treeOf(files)
      },
    },
    tests: {
      async verifyStopped() { return { verified: true } }, // the simulated suite runs in-process: once run() returned nothing of it is left running
      async verifyUnitStopped() { return { verified: true } }, // the same: a simulated unit is an in-process call, so a unit that was cut off leaves nothing behind
      async run({ task }) {
        const idx = L.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=?').get(task.task_id).c
        const spec = (sc.tests ?? [])[idx] ?? (sc.tests ?? []).at(-1) ?? { passed: true }
        return { passed: spec.passed !== false, results: spec.passed === false ? { passed: 3, failed: 1, skipped: 0 } : { passed: 4, failed: 0, skipped: 0 }, fingerprint: spec.fingerprint ?? null, summary: spec.summary ?? '' }
      },
    },
    contextPack: async () => '(simulated context pack: pointers only)',
    notifier: { sent: [], async send(row) { adapters.notifier.sent.push({ kind: row.kind, dedupe_key: row.dedupe_key }); return true } },
    issuer: null, // set by the harness (in-process IssuerCore, or the IPC client)
  }
  return adapters
}
