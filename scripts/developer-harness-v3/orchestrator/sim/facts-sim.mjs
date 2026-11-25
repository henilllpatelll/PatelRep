// Developer Harness V3 (D3.4) — SIMULATED independent fact source for issuers (loaded by issuer-main.mjs via `facts_module`, or used in-process by tests).
// It derives candidate digests from the simulation world's commit directories — a source the controller's recorded values must AGREE with, not copy from.
import { existsSync } from 'node:fs'
import { candidateShaFor, commitDir, loadWorld, patchOf, readTree, treeOf } from './sim-world.mjs'

export function createFacts(config) {
  const dir = config.sim_world_dir
  return {
    candidate({ candidate_sha }) {
      const w = loadWorld(dir)
      for (const [task, max] of Object.entries(w.versions)) for (let v = 1; v <= max; v += 1) {
        if (candidateShaFor(task, v) !== candidate_sha || !existsSync(commitDir(dir, task, v))) continue
        const files = readTree(commitDir(dir, task, v))
        return { ok: true, candidate_sha, tree_digest: treeOf(files), patch_digest: patchOf(files) }
      }
      return { ok: false, code: 'FACTS.UNKNOWN_CANDIDATE' }
    },
    isolation() { return config.sim_isolation ?? null },
  }
}
