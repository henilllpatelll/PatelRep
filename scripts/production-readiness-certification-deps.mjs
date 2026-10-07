// Phase 5D read-only production readiness certification dependencies.
// Every call is a GET. Selected fields never include run.name, display titles, Issue contents, or remote error bodies:
// identity is the exact workflow FILE path + repository + run id/attempt/SHA, re-validated on every returned run.
//
// Artifact evidence is looked up artifact-first (one bounded, name-filtered page) and never by enumerating historical
// workflow runs. Run-only evidence uses the numeric workflow id resolved from the exact path, newest unfiltered page.
import { execFileSync } from 'node:child_process'
import { realAutoMergeDeps } from './release-engineer-auto-merge-deps.mjs'
import { realProductionAutomationWatchdogDeps } from './production-automation-watchdog-deps.mjs'

const ARTIFACTS_PER_PAGE = 100
const ARTIFACT_NAME = /^[a-z][a-z0-9-]{0,79}$/

export function realProductionReadinessCertificationDeps({ repo, readToken }) {
  if (!repo || !readToken) throw new Error('production readiness certification: repo and read token are required')
  const read = (args) =>
    execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: readToken }, stdio: ['ignore', 'pipe', 'inherit'] })
  const api = (endpoint) => JSON.parse(read(['api', endpoint]))
  const lines = (output) => output.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const base = realAutoMergeDeps({ repo, readToken })
  const watchdog = realProductionAutomationWatchdogDeps({ repo, readToken })

  return {
    getMainSha: base.getMainSha,
    getRun: base.getRun,
    getPr: base.getMergedPr,
    listCheckRuns: base.listCheckRuns,
    readArtifact: base.readNamedContext,
    listWorkflows: watchdog.listWorkflows,
    listWorkflowRuns: watchdog.listWorkflowRuns,
    getCommit: async (sha) => {
      const commit = api(`repos/${repo}/commits/${sha}`)
      return { sha: commit.sha, tree: commit.commit?.tree?.sha ?? '' }
    },
    // GitHub's own association of a commit to pull requests; never commit-message parsing.
    listPullsForCommit: async (sha) =>
      lines(read(['api', `repos/${repo}/commits/${sha}/pulls?per_page=100`, '--jq', '.[] | {number,state,merged_at,merge_commit_sha,base:{ref:.base.ref,repo:{full_name:.base.repo.full_name}},head:{sha:.head.sha,ref:.head.ref,repo:{full_name:.head.repo.full_name}}} | @json'])),
    // Artifact-first: one bounded newest-first page of one exact artifact name. Metadata is only a pointer; every
    // candidate's source run is refetched and validated by the caller.
    listArtifacts: async (name) => {
      if (!ARTIFACT_NAME.test(name ?? '')) throw new Error('production readiness certification: invalid artifact name')
      return lines(read(['api', `repos/${repo}/actions/artifacts?name=${name}&per_page=${ARTIFACTS_PER_PAGE}`, '--jq', '.artifacts[] | {id,name,expired,created_at,workflow_run:{id:.workflow_run.id,head_branch:.workflow_run.head_branch,head_sha:.workflow_run.head_sha}} | @json']))
    },
    listRunJobs: async (runId) =>
      lines(read(['api', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, '--jq', '.jobs[] | {id,name,status,conclusion} | @json'])),
  }
}
