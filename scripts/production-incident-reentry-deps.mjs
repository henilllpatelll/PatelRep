// Phase 4B read-only dependencies. This layer only reads GitHub/public production state.
// Re-entry authorization never receives a production Environment, secret, deployment token, or write-capable App token.
import { realAutoRollbackRequestDeps } from './production-auto-rollback-deps.mjs'

const ROLLBACK_EVIDENCE_ARTIFACT = 'production-rollback-evidence'
const RELEASE_EVIDENCE_ARTIFACT = 'production-release-evidence'
export const REENTRY_ARTIFACT = 'production-incident-reentry'

const runJq = '.workflow_runs[] | {id, run_attempt, name, path, event, status, conclusion, head_branch, head_sha, created_at, display_title, repository: {full_name: .repository.full_name}, head_repository: {full_name: .head_repository.full_name}} | @json'

export function realProductionIncidentReentryDeps({ repo, readToken }) {
  const base = realAutoRollbackRequestDeps({ repo, readToken })
  return {
    ...base,
    listRollbackRuns: async () =>
      base.paged(`repos/${repo}/actions/workflows/production-rollback.yml/runs?status=completed&per_page=100`, runJq),
    listReleaseRuns: async () =>
      base.paged(`repos/${repo}/actions/workflows/production-release.yml/runs?status=completed&per_page=100`, runJq),
    readRollbackEvidence: (runId) => base.readNamedContext(runId, ROLLBACK_EVIDENCE_ARTIFACT),
    readReleaseEvidence: (runId) => base.readNamedContext(runId, RELEASE_EVIDENCE_ARTIFACT),
    readReentryAuthorization: (runId) => base.readNamedContext(runId, REENTRY_ARTIFACT),
    listAssociatedPullRequests: async (sha) =>
      base.api(`repos/${repo}/commits/${encodeURIComponent(sha)}/pulls`),
    getCommitTree: async (sha) =>
      base.api(`repos/${repo}/git/commits/${encodeURIComponent(sha)}`).tree?.sha ?? '',
    isAncestor: async (baseSha, headSha) =>
      ['identical', 'ahead'].includes(base.api(`repos/${repo}/compare/${baseSha}...${headSha}`).status),
  }
}
