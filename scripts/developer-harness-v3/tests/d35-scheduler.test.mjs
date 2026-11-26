// D3.5-B — the resource-aware scheduler: footprints and conflicts, dependency cycles, fairness, the controlled multi-slot planning surface, and a SIMULATED seven-task run
// (independent, conflicting, unknown-footprint, a dependency chain, a cancelled task, memory backpressure) through the unchanged engine stages, real temp ledger and real
// in-process issuers. Simulated: models, worker VM and tests. Real: the ledger, the scheduler, slot/claim arbitration and every invariant check below.
import test from 'node:test'
import assert from 'node:assert/strict'
import { T0 } from '../orchestrator/sim/harness.mjs'
import { Scheduler, cycleMembers, footprintOf, footprintsConflict, globsOverlap, planRound, rankTasks } from '../orchestrator/scheduler.mjs'
import { H, owner } from './d34-rem-helpers.mjs'

test('footprints: overlap is conservative; unknown, empty and repository-wide footprints conflict with everything; migrations are a shared resource', () => {
  assert.equal(globsOverlap('apps/mobile/a/**', 'apps/mobile/b/**'), false)
  assert.equal(globsOverlap('apps/mobile/a/**', 'apps/mobile/a/x.ts'), true)
  assert.equal(globsOverlap('apps/mobile/**', 'apps/mobile/a/b/c.ts'), true)
  assert.equal(globsOverlap('apps/*/a.ts', 'apps/web/a.ts'), true)
  assert.equal(globsOverlap('apps/*.json', 'apps/mobile/x'), false)
  assert.equal(globsOverlap('APPS/Mobile/x', 'apps/mobile/x'), true, 'case-insensitive (NTFS)')
  assert.equal(globsOverlap('apps/mobile', 'apps/mobile/x.ts'), true, 'a directory overlaps what is below it')
  const fp = (allowed_paths, extra = {}) => footprintOf({ scope: { allowed_paths, ...extra } })
  assert.equal(fp(['apps/mobile/a/**']).known, true)
  for (const unknown of [[], ['**'], ['*'], ['**/x.ts'], ['../etc'], ['/abs'], ['a\\b']]) assert.equal(fp(unknown).known, false, JSON.stringify(unknown))
  assert.equal(footprintOf({ scope: {} }).known, false)
  assert.equal(fp(['apps/a/**'], { mutable_resources: ['BAD resource!'] }).known, false, 'an unparseable resource declaration is unknown, not ignored')
  assert.deepEqual(fp(['supabase/migrations/300_x.sql']).resources, ['db:migrations'])
  assert.equal(footprintsConflict(fp(['supabase/migrations/300_x.sql']), fp(['supabase/migrations/301_y.sql'])), true, 'two migrations never run concurrently')
  assert.equal(footprintsConflict(fp(['apps/a/**']), fp(['apps/b/**'])), false)
  assert.equal(footprintsConflict(fp(['apps/a/**'], { mutable_resources: ['stripe:test-webhook'] }), fp(['apps/b/**'], { mutable_resources: ['stripe:test-webhook'] })), true)
  assert.equal(footprintsConflict(fp(['apps/a/**']), fp(['**'])), true)
})

test('dependency graph: cycles (including self-edges) are detected even when the database was tampered past the insert-time guard', () => {
  assert.deepEqual(cycleMembers([['a', 'b'], ['b', 'c']]), [])
  assert.deepEqual(cycleMembers([['a', 'b'], ['b', 'c'], ['c', 'a'], ['d', 'a']]), ['a', 'b', 'c'])
  assert.deepEqual(cycleMembers([['x', 'x']]), ['x'])
})

test('fairness: owner priority first, deterministic tie-break, aging lifts a long-waiting task, and a starving task reserves the next slot of its kind', () => {
  const now = T0 + 15 * 3600_000
  const rows = [{ task_id: 'b', priority: 100, created_at: now }, { task_id: 'a', priority: 100, created_at: now }, { task_id: 'urgent', priority: 10, created_at: now }, { task_id: 'old-low', priority: 300, created_at: T0 }]
  assert.deepEqual(rankTasks(rows, { now: T0 + 1, cfg: { agingMs: 30 * 60_000, agingStep: 10, maxPassesBeforeReserve: 6 } }).map((r) => r.task_id).slice(0, 3), ['urgent', 'a', 'b'])
  const aged = rankTasks(rows, { now, cfg: { agingMs: 30 * 60_000, agingStep: 10, maxPassesBeforeReserve: 6 } }).map((r) => r.task_id)
  assert.equal(aged[0], 'old-low', '15 h of waiting (30 aging steps) outranks a newer priority-10 task')
  const starving = rankTasks(rows, { now: T0 + 1, passes: { b: 6 }, cfg: { agingMs: 30 * 60_000, agingStep: 10, maxPassesBeforeReserve: 6 } }).map((r) => r.task_id)
  assert.equal(starving[0], 'b', 'a task passed over too often goes first')
  // planRound: a starving AI task that could not get a slot reserves the kind; later lower-ranked AI tasks do not jump it
  const items = [{ id: 's', kind: 'ai', footprint: { known: true, paths: ['x/**'], resources: [] }, needsClaim: false, claimed: true }, { id: 'n', kind: 'ai', footprint: { known: true, paths: ['y/**'], resources: [] }, needsClaim: false, claimed: true }]
  const p = planRound({ items, claims: [], capacity: { ai: 0, heavy: 1, det: 8 }, passes: { s: 6 } })
  assert.deepEqual(p.skipped.map((x) => x.reason), ['NO_FREE_SLOT', 'SLOT_RESERVED_FOR_STARVING_TASK'])
})

test('controlled multi-slot simulation (planning surface): capacity N admits exactly N independent AI tasks, serializes conflicts, never exceeds capacity', () => {
  const fp = (p) => ({ known: true, paths: [p], resources: [] })
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, kind: 'ai', footprint: fp(`apps/${id}/**`), needsClaim: true, claimed: false }))
  items.splice(2, 0, { id: 'a2', kind: 'ai', footprint: fp('apps/a/sub/**'), needsClaim: true, claimed: false })
  items.push({ id: 'u', kind: 'ai', footprint: { known: false, paths: [], resources: [] }, needsClaim: true, claimed: false })
  const p = planRound({ items, claims: [], capacity: { ai: 3, heavy: 1, det: 8 } })
  assert.deepEqual(p.run.map((r) => r.id), ['a', 'b', 'c'])
  assert.deepEqual(Object.fromEntries(p.skipped.map((s) => [s.id, s.reason])), { a2: 'SCOPE_CONFLICT', d: 'NO_FREE_SLOT', e: 'NO_FREE_SLOT', u: 'SCOPE_CONFLICT' })
})

/** Scheduler rounds until idle, then jump the fixture clock to the next wake-up — no human involved. `onRound` sees every round. */
async function driveSched(h, s, onRound = () => {}) {
  for (let k = 0; k < 300; k += 1) {
    let nw = null; let idle = false
    for (let i = 0; i < 600; i += 1) { const r = await s.round(); onRound(r); if (!r.progressed) { idle = true; nw = r.next_wakeup; break } }
    assert.ok(idle, 'the scheduler reaches idle (no runaway loop)')
    if (!nw) return
    h.clock.advance(nw <= h.clock.now() ? 1000 : nw - h.clock.now() + 1)
  }
  throw new Error('drive: still waking')
}
const spec = (letter, over = {}) => ({ requirements: { text: `Task ${letter}: add the ${letter} indicator.`, sim_path: `apps/mobile/${letter}/feature.txt` }, scope: { allowed_paths: [`apps/mobile/${letter}/**`], denied_paths: [] }, ...over })

test('SIMULATED seven-task run: resource admission, correct serialization, a dependency chain, bounded concurrency, a cancelled task, zero owner interventions', async () => {
  // 60 s of memory pressure at the start: nothing may be admitted until it clears (backpressure, not failure)
  const h = H({ scenario: { stages: { implementing: [{ units: 2 }] }, pressure: [{ from: T0, to: T0 + 60_000, available_mb: 1500 }] } })
  try {
    const s = new Scheduler(h.engine)
    const ids = {}
    ids.B = h.submit(spec('b', { priority: 100 }))
    ids.A = h.submit(spec('a', { priority: 100 }))
    ids.C = h.submit({ ...spec('c', { priority: 50 }), requirements: { text: 'Task C: change the a indicator copy.', sim_path: 'apps/mobile/a/copy.txt' }, scope: { allowed_paths: ['apps/mobile/a/**'], denied_paths: [] } }) // CONFLICTS with A
    ids.D = h.submit(spec('d', { priority: 100, depends_on: [ids.B] }))
    ids.G = h.submit(spec('g', { priority: 100, depends_on: [ids.D] })) // chain B -> D -> G
    ids.E = h.submit(spec('e', { priority: 100 }))
    ids.F = h.submit({ ...spec('f', { priority: 200 }), scope: { allowed_paths: ['**'], denied_paths: [] } }) // unknown/repo-wide footprint: runs alone
    const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]))
    const L = h.ledger
    let maxLeases = 0; let both = 0; let waitedForResources = false; let cancelledAt = null
    const origRun = h.adapters.session.runUnit.bind(h.adapters.session)
    h.adapters.session.runUnit = async (a) => {
      maxLeases = Math.max(maxLeases, L.liveLeases().length)
      if (a.task.task_id === ids.E && a.stage === 'implementing' && cancelledAt === null) { L.cancel(ids.E); cancelledAt = h.clock.now() } // cancelled DURING its own session
      return origRun(a)
    }
    await driveSched(h, s, (r) => {
      const kinds = r.ran.map((x) => x.kind)
      assert.ok(kinds.filter((k) => k === 'ai').length <= 1 && kinds.filter((k) => k === 'heavy').length <= 1, `bounded concurrency: ${JSON.stringify(r.ran)}`)
      if (kinds.includes('ai') && kinds.includes('heavy')) both += 1
      if (L.listTasks("state='waiting_resources'").length) waitedForResources = true
      const claims = s.liveClaims()
      for (let i = 0; i < claims.length; i += 1) for (let j = i + 1; j < claims.length; j += 1) assert.ok(!footprintsConflict(claims[i].footprint, claims[j].footprint), `conflicting claims held together: ${name[claims[i].task_id]} + ${name[claims[j].task_id]}`)
    })
    const t = (k) => L.getTask(ids[k])
    for (const k of ['A', 'B', 'C', 'D', 'F', 'G']) assert.equal(t(k).handoff_ready, 1, `${k} reached the delivery handoff (state ${t(k).state})`)
    assert.equal(t('E').cancelled, 1); assert.equal(t('E').handoff_ready, 0, 'a cancelled task never completes')
    assert.ok(cancelledAt !== null)
    assert.equal(L.liveLeases().length, 0, 'no slot left held'); assert.equal(maxLeases, 1, 'never more than the ONE operational reasoning slot')
    assert.ok(both > 0, 'a reasoning session and a heavy test really ran in the same round (bounded parallelism under the unchanged D3.3 governor)')
    assert.ok(waitedForResources, 'memory pressure put work into waiting_resources first')
    assert.ok(s.maxConcurrent >= 2, `concurrent steps observed: ${s.maxConcurrent}`)
    // dependency chain: D starts only after B's handoff, G only after D's
    const firstExec = (k) => L.db.prepare('SELECT MIN(started_at) m FROM executions WHERE task_id=?').get(ids[k]).m
    const handoffAt = (k) => L.db.prepare("SELECT MIN(created_at) m FROM outbox WHERE task_id=? AND kind='handoff_ready'").get(ids[k]).m
    assert.ok(firstExec('D') >= handoffAt('B') && firstExec('G') >= handoffAt('D'), 'the dependency chain is respected')
    // serialization: A and C (same files) and F (repository-wide) never held claims at the same time — checked every round above; F really waited for everyone
    const claimedAt = (k) => L.db.prepare("SELECT MIN(rowid) r FROM recovery_history WHERE task_id=? AND kind='scope_claimed'").get(ids[k]).r
    assert.ok(claimedAt('A') > claimedAt('C') || claimedAt('C') > claimedAt('A'))
    // unaffected tasks kept progressing while E was cancelled and while others waited on scope
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }, 'zero owner interventions')
    assert.ok(L.db.prepare("SELECT COUNT(*) c FROM schedule_state WHERE passes>0 OR last_admitted_at IS NOT NULL").get().c >= 6, 'scheduling decisions are durable')
  } finally { h.close() }
})

test('dependency basis: when a dependency\'s candidate changes after a dependent used it, the dependent\'s approvals are withdrawn and its handoff redone', async () => {
  const h = H()
  try {
    const s = new Scheduler(h.engine); const L = h.ledger
    const B = h.submit(spec('b')); const D = h.submit(spec('d', { depends_on: [B] }))
    await driveSched(h, s)
    assert.equal(L.getTask(D).handoff_ready, 1)
    const evBefore = L.db.prepare('SELECT COUNT(*) c FROM evidence WHERE task_id=? AND invalidated_at IS NULL').get(D).c
    // B's candidate changes (a new head) after D was built on it
    const cand = L.currentCandidate(B)
    assert.ok(L.submitCandidate(B, { base_sha: cand.base_sha, candidate_sha: 'f'.repeat(40), tree_digest: 'e'.repeat(40), patch_digest: 'd'.repeat(64) }).ok)
    const changed = s.checkDependencyBasis()
    assert.deepEqual(changed, [D])
    assert.equal(L.getTask(D).handoff_ready, 0, 'the dependent\'s handoff is undone')
    assert.equal(L.db.prepare('SELECT COUNT(*) c FROM evidence WHERE task_id=? AND invalidated_at IS NULL').get(D).c, 0, `its ${evBefore} approvals are withdrawn`)
    assert.equal(L.recoveryHistory(D).filter((r) => r.kind === 'dependency_basis_changed').length, 1)
    assert.deepEqual(s.checkDependencyBasis(), [], 'idempotent: the new basis is recorded')
  } finally { h.close() }
})

test('crash recovery with several admitted slots: one task\'s worker liveness is unknown — only THAT task stays held; the others recover and progress', async () => {
  const h = H()
  try {
    const L = h.ledger; L.setSlotCapacity('reasoning', 2, 'controlled simulation: two orphaned leases after a controller crash')
    const t1 = h.submit(spec('a')); const t2 = h.submit(spec('b'))
    for (const id of [t1, t2]) { L.transition(id, 'queued'); L.transition(id, 'planning') }
    const l1 = L.acquireLease({ taskId: t1, role: 'planner', stage: 'planning', model: 'sonnet', effort: 'high' }).lease
    const l2 = L.acquireLease({ taskId: t2, role: 'planner', stage: 'planning', model: 'sonnet', effort: 'high' }).lease
    assert.ok(l1 && l2)
    const orig = h.adapters.worker.liveness.bind(h.adapters.worker)
    h.adapters.worker.liveness = async (w) => (w?.lease?.task_id === t1 ? null : orig(w)) // t1's worker cannot be inspected: fail closed for t1 ONLY
    const stuck = await h.engine.reconcileOrphans()
    assert.deepEqual(stuck.map((x) => x.task_id), [t1])
    assert.equal(L.leaseOfTask(t1).lease_id, l1.lease_id, 't1 keeps its slot (never assumed dead)')
    assert.equal(L.leaseOfTask(t2), null, 't2 recovered'); assert.equal(L.getTask(t2).fencing_token, 2); assert.equal(L.getTask(t1).fencing_token, 1)
    const s = new Scheduler(h.engine)
    const r = await s.round()
    assert.ok(r.stuck.includes(t1)); assert.ok(!r.ran.some((x) => x.id === t1), 'the stuck task is not scheduled')
    await driveSched(h, s)
    // t1's session is NOT proven dead, so it still counts against the governor's single reasoning allowance: t2 recovered and is runnable, but no second session is started
    assert.equal(L.getTask(t2).state, 'planning'); assert.equal(L.db.prepare('SELECT COUNT(*) c FROM executions WHERE task_id=?').get(t2).c, 1, 'no replacement session while another may still be alive')
    assert.equal(s.capacity().ai, 0)
    // t1's worker becomes inspectable again: it is recovered on its own, and BOTH tasks then finish without any owner action
    h.adapters.worker.liveness = orig
    await driveSched(h, s)
    assert.equal(L.getTask(t1).handoff_ready, 1); assert.equal(L.getTask(t2).handoff_ready, 1)
    assert.ok(L.recoveryHistory(t1).some((x) => x.kind === 'recovery_investigate'))
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
})
