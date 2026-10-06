// Phase 4D read-only production release audit dependencies.
import { realProductionIncidentReentryDeps } from './production-incident-reentry-deps.mjs'

export const PRODUCTION_RELEASE_AUDIT_ARTIFACT = 'production-release-audit'

const runJq = '.workflow_runs[] | {id,run_attempt,name,path,event,status,conclusion,head_branch,head_sha,created_at,display_title,repository:{full_name:.repository.full_name},head_repository:{full_name:.head_repository.full_name}} | @json'

export function realProductionReleaseAuditDeps({ repo, readToken }) {
  const base = realProductionIncidentReentryDeps({ repo, readToken })
  return {
    ...base,
    listReentryRuns: async () =>
      base.paged(
        `repos/${repo}/actions/workflows/production-incident-reentry.yml/runs?status=success&per_page=100`,
        runJq,
      ),
  }
}
