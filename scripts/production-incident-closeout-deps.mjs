// Phase 4B read-only GitHub dependencies for incident closeout and Production Release re-entry validation.
// Every GitHub operation here is a GET. This module cannot dispatch, deploy, mutate variables, or touch production credentials.
import { realProductionRequestDeps } from './production-release-request-deps.mjs'
import { INCIDENT_ARTIFACT } from './production-release-stabilization.mjs'
import { ROLLBACK_EVIDENCE_ARTIFACT } from './production-rollback-evidence.mjs'

export const INCIDENT_CLOSEOUT_ARTIFACT = 'production-incident-closeout'

const AUTOMATED_ROLLBACK_TITLE = /\(automated request from run [1-9][0-9]*\)$/

export function realIncidentCloseoutDeps({ repo, readToken }) {
  const base = realProductionRequestDeps({ repo, readToken })
  return {
    ...base,
    readRollbackEvidence: (runId) => base.readNamedContext(runId, ROLLBACK_EVIDENCE_ARTIFACT),
    readIncident: (runId) => base.readNamedContext(runId, INCIDENT_ARTIFACT),
    readIncidentCloseout: (runId) => base.readNamedContext(runId, INCIDENT_CLOSEOUT_ARTIFACT),
    listSuccessfulRollbackRuns: async () =>
      base.paged(
        `repos/${repo}/actions/workflows/production-rollback.yml/runs?status=success&per_page=100`,
        '.workflow_runs[] | {id, name, path, event, status, conclusion, head_branch, head_sha, run_attempt, display_title, created_at, actor: {login: .actor.login, id: .actor.id}, repository: {full_name: .repository.full_name}, head_repository: {full_name: .head_repository.full_name}} | @json',
      ),
    listSuccessfulReleaseRuns: async () =>
      base.paged(
        `repos/${repo}/actions/workflows/production-release.yml/runs?status=success&per_page=100`,
        '.workflow_runs[] | {id, name, path, event, status, conclusion, head_branch, head_sha, run_attempt, display_title, created_at, actor: {login: .actor.login, id: .actor.id}, repository: {full_name: .repository.full_name}, head_repository: {full_name: .head_repository.full_name}} | @json',
      ),
    listSuccessfulCloseoutRuns: async () =>
      base.paged(
        `repos/${repo}/actions/workflows/production-incident-closeout.yml/runs?status=success&per_page=100`,
        '.workflow_runs[] | {id, name, path, event, status, conclusion, head_branch, head_sha, run_attempt, display_title, created_at, actor: {login: .actor.login, id: .actor.id}, repository: {full_name: .repository.full_name}, head_repository: {full_name: .head_repository.full_name}} | @json',
      ),
    isAutomatedRollbackRun: (run) => AUTOMATED_ROLLBACK_TITLE.test(String(run?.display_title ?? '')),
  }
}
