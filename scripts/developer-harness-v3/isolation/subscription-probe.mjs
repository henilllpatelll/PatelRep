// Developer Harness V3 (D3.3) — one bounded subscription probe inside the worker VM, to obtain PROVIDER-REPORTED facts (rate-limit state, overage
// status, context window, model) that no pre-launch interface exposes.
//
// Why this is a separate, explicit path (and not `launch_claude_session`): the D3.2 guard requires `extra_usage_enabled === false` from a verified
// source, and the only such source is the stream of an actual request. The probe therefore runs ONLY when ALL hold, otherwise it refuses:
//   * `claude auth status` in the VM normalizes to source=claude_subscription_oauth and an AUTHORIZED canonical plan (claude_max_5x);
//   * the owner has recorded `dh3 attest-extra-usage-off` (owner statement, not verification) — the attestation authorizes this ONE probe class only;
//   * the governor is not in a waiting/blocked state; no reasoning session is active (shared lock);
//   * fixed request: smallest model alias, `--tools ""`, `--max-turns 1`, `--safe-mode`, no setting sources, no MCP, runtime egress profile.
// The worst case if the owner's statement were wrong is one minimal request billed as usage credits; it is recorded, and any overage signal in
// the stream immediately marks the governor `unauthorized_billing` (owner attention) and blocks all further AI work.
import path from 'node:path'
import { spawn } from 'node:child_process'
import { atomicWriteJson, readJsonState } from '../lib/atomic.mjs'
import { BINARY_FACTS_SCRIPT, buildWorkerEnvironment, CLAUDE_INSTALL_PATH, guestSessionCommand, parseBinaryFacts, runSession, verifyBinary, verifyEffectiveSettings } from '../runtime/launcher.mjs'
import { startEgressProxy } from '../runtime/egress-proxy.mjs'
import { nextGovernorState, normalizeAuthStatus } from '../runtime/subscription-governor.mjs'
import { killWorkerProcesses, liveness, openEgressChannel, readVmConfig, readVmRecord, sshArgs, sshExec, sysEnv } from '../runtime/vm-controller.mjs'
import { readProvisioned } from '../infra/provision.mjs'
import { loadContractFile } from '../authority/contract.mjs'

export async function probeSubscription(L, { id = 'w1', log = console.error } = {}) {
  const W = L.worker(id); const cfg = readVmConfig(W)
  if (!cfg) return { ok: false, code: 'PROBE.WORKER_NOT_RUNNING' }
  const contract = loadContractFile()
  const prev = readJsonState(L.subscription, (v) => v && v.schema)
  const att = prev.ok ? prev.value.owner_attestation : null
  if (!(att?.extra_usage_off === true && typeof att.nonce === 'string' && att.used === false && Date.parse(att.expires_at) > Date.now())) return { ok: false, code: 'PROBE.OWNER_ATTESTATION_MISSING_USED_OR_EXPIRED', fix: 'owner: dh3 attest-extra-usage-off (one-shot, 24 h)' }
  if (prev.value.state && !['available', 'approaching'].includes(prev.value.state) && prev.value.next_eligible_at !== undefined && (prev.value.next_eligible_at === null || Date.now() < prev.value.next_eligible_at)) return { ok: false, code: `PROBE.GOVERNOR_${String(prev.value.state).toUpperCase()}` }
  const st = sshExec(W, cfg, `sudo -u worker -H env -i HOME=/home/worker PATH=/usr/local/bin:/usr/bin:/bin ${CLAUDE_INSTALL_PATH} auth status --json`, { timeoutMs: 180000 })
  let j = null; try { j = JSON.parse(st.out) } catch { /* unparsable */ }
  const auth = normalizeAuthStatus(j, { now: Date.now() })
  if (!auth.verified) return { ok: false, code: 'PROBE.AUTH_UNVERIFIED', problems: auth.problems }
  if (!contract.subscription.authorized_plans.includes(auth.plan)) return { ok: false, code: 'PROBE.PLAN_NOT_AUTHORIZED', plan: auth.plan }
  // Preflight on the REAL path: pinned root-owned binary and pinned root-owned managed settings, re-verified now.
  const prov = readProvisioned(W)
  const facts = parseBinaryFacts(sshExec(W, cfg, BINARY_FACTS_SCRIPT, { timeoutMs: 300000 }).out)
  const pre = [...verifyBinary(facts.binary, prov ? { sha512: prov.claude_sha512, version: prov.claude_version } : null), ...verifyEffectiveSettings({ managedText: facts.managedText, managedOwner: facts.managedOwner }).codes]
  if (pre.length) return { ok: false, code: 'PROBE.PREFLIGHT_FAILED', problems: pre }
  // Consume the attestation BEFORE launching: a crash or kill can never leave it reusable.
  atomicWriteJson(L.subscription, { ...prev.value, owner_attestation: { ...att, used: true, used_at: new Date().toISOString() } })
  const { env } = buildWorkerEnvironment({ proxyUrl: 'http://127.0.0.1:3128' })
  const argv = [CLAUDE_INSTALL_PATH, '-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', '', '--strict-mcp-config', '--safe-mode', '--no-session-persistence', '--model', 'haiku', '--max-turns', '1', '--tools', '', '--permission-mode', 'dontAsk']
  const proxy = await startEgressProxy({ profile: 'runtime' }); const ch = openEgressChannel(W, cfg, proxy.port)
  await new Promise((r) => setTimeout(r, 3000))
  try {
    const result = await runSession({
      spawnSession: ({ stdin }) => {
        const c = spawn('ssh', [...sshArgs(W, cfg, { extra: ['-T'] }), guestSessionCommand({ argv, env, timeoutS: 540 })], { env: sysEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
        c.stdin.end(stdin); return c
      },
      terminateRemote: async () => { killWorkerProcesses(W, cfg) },
      // A VM that is verifiably not running has no surviving session; otherwise every guest `worker` process must be gone.
      verifyStopped: async () => { const rec = readVmRecord(W); if (!rec || rec.state === 'exited') return true; const lv = liveness(rec); if (lv.qemu === false && lv.supervisor === false) return true; return killWorkerProcesses(W, cfg) },
      argv, env, prompt: 'Reply with the single word OK.', expectInit: { permissionMode: 'dontAsk', version: prov.claude_version, mcpServers: [], pluginSources: [], tools: [] }, timeoutMs: 600000,
      lockFile: L.sessionLock, executionsDir: L.executions, taskId: 'subscription-probe', fencingToken: 0,
    })
    if (!result.observation) return { ok: false, code: result.code ?? 'PROBE.NO_OBSERVATION', execution_id: result.execution_id }
    const gov = nextGovernorState(prev.value.state ? prev.value : null, result.observation, { now: Date.now() })
    if (!gov) return { ok: false, code: 'PROBE.NOTHING_LEARNED', killed_reason: result.killed_reason, execution_id: result.execution_id } // neutral kill, no prior state
    atomicWriteJson(L.subscription, { ...gov, owner_attestation: { ...att, used: true }, auth: { source: auth.source, plan: auth.plan, plan_basis: auth.plan_basis, login_expires_at: auth.login_expires_at } })
    log(`probe: ${result.observation.state}; extra usage ${JSON.stringify(result.observation.extra_usage)}`)
    return { ok: result.ok, execution_id: result.execution_id, state: gov.state, extra_usage: gov.extra_usage, windows: gov.windows, context: result.context, init: result.init, models: result.models, record: path.join(L.executions, `${result.execution_id}.json`) }
  } finally { ch.kill(); await proxy.close() }
}
