// Developer Harness V3 (D3.4) — wiring of the D3.3 components into the orchestrator's adapter interface. What is REAL here: resource sampling and admission inputs,
// subscription-governor persistence, host-fact worker liveness, guest cleanup (kill + verify), worker stop, the trusted-launcher invocation plan (with the D3.2
// evaluator in the loop), and the hardened bundle check. What is deliberately NOT here: running a live reasoning session, the live candidate/test adapters and
// anything that would talk to the provider — gate G-LIVE-ADAPTER. The engine refuses `live` mode, so nothing in this file can start a real session in D3.4.
import path from 'node:path'
import { atomicWriteJson, readJsonState } from '../lib/atomic.mjs'
import { buildInvocation } from '../runtime/launcher.mjs'
import { isSubscriptionStateRecord } from '../runtime/subscription-governor.mjs'
import { withEffort, checkInvocationSafety } from './routing.mjs'
import { checkBundleBytes } from '../runtime/artifact-transfer.mjs'

/**
 * The invocation for ONE reasoning session. Goes through the D3.3 launcher (which re-evaluates the request with the D3.2 evaluator), is NEVER a bypass-permissions
 * launch, and carries the routed `--effort`. @returns {{ok:true, argv:string[], permission_mode:'dontAsk', decision:object}|{ok:false, code:string}}
 */
export function planSession({ policy, taskId, trusted, route, now, maxTurns }) {
  if (!route?.ai || route.wait) return { ok: false, code: 'PLAN.NOT_A_SESSION_ROUTE' }
  const inv = buildInvocation({ policy, action: 'launch_claude_session', taskId, trusted, now, model: route.model, maxTurns, safeMode: true })
  if (!inv.ok) return inv
  if (inv.permission_mode !== 'dontAsk' || inv.argv.includes('--dangerously-skip-permissions')) return { ok: false, code: 'PLAN.BYPASS_PROHIBITED_IN_D34' }
  const e = withEffort(inv.argv, route)
  if (!e.ok) return e
  const unsafe = checkInvocationSafety({ argv: e.argv, envNames: Object.keys(trusted?.launch?.env_value_origins ?? {}) })
  return unsafe.length ? { ok: false, code: unsafe[0] } : { ok: true, argv: e.argv, permission_mode: 'dontAsk', decision: inv.decision }
}

const NOT_LIVE = (what) => () => { throw new Error(`D33.LIVE_ADAPTER_NOT_IMPLEMENTED:${what} (gate G-LIVE-ADAPTER)`) }

/**
 * @param {{W:object, cfg:object, stateDir:string, sampleHost:Function, sampleGuest?:Function, readVmRecord:Function, liveness:Function, killWorkerProcesses:Function, stopVm:Function, now?:()=>number}} d
 * Every host-touching function is injected (the real ones live in runtime/vm-controller.mjs and host-sampler.mjs) so the glue is testable without a VM.
 */
export function createD33Adapters(d) {
  const subFile = path.join(d.stateDir, 'subscription.json')
  return {
    simulated: false,
    resources: {
      async sample() {
        const host = await d.sampleHost()
        const guest = d.sampleGuest ? await d.sampleGuest() : null
        return { host, guest, history: [], prevPressure: 'clear', reservations: [], heavy: 0, accel: d.cfg?.accel ?? 'tcg' }
      },
    },
    subscription: {
      load() { const r = readJsonState(subFile, isSubscriptionStateRecord); return r.ok ? r.value : null }, // unreadable/absent => null => the engine blocks (genuine owner item), never "available"
      save(g) { atomicWriteJson(subFile, g) },
    },
    worker: {
      async ensure() { throw new Error('D33.WORKER_START_REQUIRES_OWNER_SETUP_AND_ADMISSION (use dh3 provision/start; gate G-FULL-WORKER)') },
      async liveness() { const record = d.readVmRecord(d.W); return { record, liveness: record ? d.liveness(record) : { supervisor: false, qemu: false, qemuImage: null, reused: false } } },
      async cleanupGuest() { try { return { verified: d.killWorkerProcesses(d.W, d.cfg.vm) === true } } catch { return { verified: false } } },
      async stopWorker() { try { await d.stopVm(d.W, d.cfg.vm); return { verified: true } } catch { return { verified: false } } },
      terminateSession: NOT_LIVE('terminateSession'),
    },
    session: { runUnit: NOT_LIVE('runUnit') },
    git: { prepareWorktree: NOT_LIVE('prepareWorktree'), captureSnapshot: NOT_LIVE('captureSnapshot'), deriveCandidate: NOT_LIVE('deriveCandidate'), treeDigestAfterReview: NOT_LIVE('treeDigestAfterReview') },
    tests: { run: NOT_LIVE('tests.run') },
    bundle: { check: (buf) => checkBundleBytes(buf) },
  }
}
