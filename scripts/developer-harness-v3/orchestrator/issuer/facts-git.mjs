// Developer Harness V3 (D3.4) — the issuer's INDEPENDENT candidate derivation, from a verifier-controlled bare/clone repository using trusted-git.mjs.
// It derives exactly the two digests an evidence payload binds (tree id and patch digest) and nothing else; compared with the controller's recorded values
// by the issuer. Isolation facts come from a record the OWNER's attestation ceremony maintains, never from the controller's request.
import { createHash } from 'node:crypto'
import { v } from '../../lib/canonical.mjs'
import { resolveGit, trustedGit } from '../trusted-git.mjs'

export function createFacts({ verifier_repo_dir, git_candidates, git_sha256 = null, isolation_record_file = null }) {
  const g = resolveGit({ candidates: git_candidates, pinSha256: git_sha256, forbiddenRoots: [verifier_repo_dir] })
  return {
    candidate({ base_sha, candidate_sha }) {
      if (!g.ok || !v.sha40(base_sha) || !v.sha40(candidate_sha)) return { ok: false, code: g.code ?? 'FACTS.BAD_INPUT' }
      const run = (args, o = {}) => trustedGit(g.exe, verifier_repo_dir, args, { ...o, expectSha256: g.sha256 }) // the executable is re-hashed before EVERY run
      try {
        for (const sha of [base_sha, candidate_sha]) {
          let resolved = null
          try { resolved = run(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]).toString('utf8').trim() } catch { resolved = null }
          if (resolved !== sha) return { ok: false, code: 'FACTS.COMMIT_UNRESOLVED' }
        }
        try { run(['merge-base', '--is-ancestor', base_sha, candidate_sha]) } catch { return { ok: false, code: 'FACTS.BASE_NOT_ANCESTOR' } }
        const tree = run(['rev-parse', '--verify', `${candidate_sha}^{tree}`]).toString('utf8').trim()
        const patch = run(['diff', '--binary', '--full-index', '--no-renames', '--no-color', '--ignore-submodules=none', '--no-ext-diff', '--no-textconv', base_sha, candidate_sha], { maxBuffer: 128 * 1024 * 1024 })
        return { ok: true, candidate_sha, tree_digest: tree, patch_digest: createHash('sha256').update(patch).digest('hex') }
      } catch { return { ok: false, code: 'FACTS.GIT_ERROR' } }
    },
    isolation() { return null /* the real record is produced by the owner attestation ceremony (gate G-ATTESTATION); absent => the issuer refuses */ },
  }
}
