// Phase 3C read-only dependencies. Every GitHub call here is a GET; the request workflow's separate
// App token is the only write capability and can only dispatch the existing Production Rollback workflow.
import { runPublicSmoke } from './public-smoke.mjs'
import { PRODUCTION_API_URL, PRODUCTION_WEB_URL } from './production-runtime-identity.mjs'
import { realProductionRequestDeps } from './production-release-request-deps.mjs'
import { INCIDENT_ARTIFACT, RELEASE_EVIDENCE_ARTIFACT } from './production-release-stabilization.mjs'

export function realAutoRollbackRequestDeps({ repo, readToken }) {
  const base = realProductionRequestDeps({ repo, readToken })
  return {
    ...base,
    readIncident: (runId) => base.readNamedContext(runId, INCIDENT_ARTIFACT),
    readReleaseEvidence: (runId) => base.readNamedContext(runId, RELEASE_EVIDENCE_ARTIFACT),
    readRollbackWorkflowAt: async (sha) => {
      const response = base.api(`repos/${repo}/contents/.github/workflows/production-rollback.yml?ref=${encodeURIComponent(sha)}`)
      if (!response || response.type !== 'file' || response.encoding !== 'base64' || typeof response.content !== 'string') {
        throw new Error('auto-rollback request: rollback workflow could not be read at the trusted control-plane SHA')
      }
      return Buffer.from(response.content.replace(/\n/g, ''), 'base64').toString('utf8')
    },
    isExactCandidateHealthy: async ({ sha, version }) => {
      try {
        await runPublicSmoke({
          webUrl: PRODUCTION_WEB_URL,
          apiUrl: PRODUCTION_API_URL,
          expectedEnvironment: 'production',
          expectedReleaseSha: sha,
          expectedReleaseVersion: version,
        })
        return true
      } catch {
        return false
      }
    },
  }
}
