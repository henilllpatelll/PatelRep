// Developer Harness V3 (D3.6) — SIMULATED trusted delivery fact source: the D3.2 candidate facts the evaluator needs, the worker environment record, the candidate's files for the
// publisher's content checks, and the trusted-git base update. Derived from the simulation world's commit directories (what the controller's records must AGREE with), never from a
// session's claim. The live equivalent is authority/git-facts.mjs over a verifier-controlled clone (after proposal P1v2) — exercised on a REAL temporary git repository in the tests.
import { existsSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { matchesAny, normalizeRepoPath } from '../../lib/paths.mjs'
import { candidateShaFor, commitDir, loadWorld, patchOf, readTree, saveWorld, treeOf, wipe, writeFileTree } from './sim-world.mjs'

export const SIM_BASE_MIGRATIONS = Object.freeze(['supabase/migrations/001_init.sql', 'supabase/migrations/262_agent_verified_human_identity.sql'])
export const ISOLATED_ENV = Object.freeze({ kind: 'isolated_vm', worker_env_names: ['PATH', 'HOME', 'LANG'], egress_restricted: true, host_mounts: false, docker_socket_exposed: false, windows_interop: false, controller_reachable: false, other_credentials_present: false })

export function createDeliveryFacts({ dir, ledger, contract, scenario = {}, evaluatorKnowsRisk = false }) {
  const L = ledger
  const versionOf = (taskId, sha) => { const w = loadWorld(dir); for (let v = w.versions[taskId] ?? 0; v >= 1; v -= 1) if (candidateShaFor(taskId, v) === sha && existsSync(commitDir(dir, taskId, v))) return v; return 0 }
  const filesOf = (taskId, sha) => { const v = versionOf(taskId, sha); return v ? readTree(commitDir(dir, taskId, v)) : null }
  return {
    evaluatorKnowsRisk,
    async candidate(t) {
      const files = filesOf(t.task_id, t.head_sha); if (!files) return { ok: false, code: 'FACTS.UNKNOWN_CANDIDATE' }
      const added = {}
      for (const f of files) { const n = normalizeRepoPath(f.path); if (n.ok && matchesAny(contract.customer_agent.path_globs, n.path)) added[n.path] = f.content.toString('utf8').split('\n').slice(0, 2000) }
      return { ok: true, facts: { source: 'git', repository: t.repository, base_sha: L.currentBase(t.task_id), candidate_sha: t.head_sha, tree_digest: treeOf(files), patch_digest: patchOf(files),
        changes: files.map((f) => ({ status: (scenario.modified ?? []).includes(f.path) ? 'M' : 'A', path: f.path })), base_migrations: [...(scenario.baseMigrations ?? SIM_BASE_MIGRATIONS)], added_lines: added,
        special_modes: [...(scenario.specialModes ?? [])], origin_matches: scenario.originMatches ?? true, problems: [] } }
    },
    async environment(t) { return { id: t.environment_id, ...ISOLATED_ENV, ...(scenario.environment ?? {}) } },
    files(t) { return filesOf(t.task_id, t.head_sha) ?? [] },
    /** Trusted git: merge the new main into the task branch in a task-owned worktree. A conflict is REPORTED (paths), never resolved here. */
    async mergeBase(t, newBase) {
      const files = filesOf(t.task_id, t.head_sha); if (!files) return { ok: false, code: 'MERGE.CANDIDATE_UNKNOWN' }
      const touched = (scenario.baseConflicts?.[newBase] ?? []).filter((p) => files.some((f) => f.path === p))
      if (touched.length) return { ok: false, code: 'MERGE.CONFLICT', conflicts: touched }
      const w = loadWorld(dir); const v = (w.versions[t.task_id] ?? 0) + 1; const cd = commitDir(dir, t.task_id, v)
      wipe(cd); mkdirSync(cd, { recursive: true }); writeFileTree(cd, files); w.versions[t.task_id] = v; (w.bases ??= {})[`${t.task_id}:${v}`] = newBase; saveWorld(dir, w)
      return { ok: true, base_sha: newBase, candidate_sha: candidateShaFor(t.task_id, v), tree_digest: treeOf(files), patch_digest: patchOf(files), changed_paths: files.map((f) => f.path) }
    },
  }
}
