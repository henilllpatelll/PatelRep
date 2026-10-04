// GitHub-backed READ-ONLY dependencies for Phase 2D (release versioning, production baseline, request policy).
// Every call here is a GET; the only write in the whole Phase 2D chain is the workflow dispatch performed by the
// request workflow itself with a separate, narrowly scoped App token.
import { execFileSync } from 'node:child_process'
import { AUTO_MERGE_RESULT_ARTIFACT } from './auto-merge-result.mjs'
import { readProductionRuntimeIdentity } from './production-runtime-identity.mjs'
import { realAutoMergeDeps } from './release-engineer-auto-merge-deps.mjs'
import { ACTIVE_RUN_STATUSES } from './production-release-request-policy.mjs'

export const PRODUCTION_WORKFLOW_FILES = Object.freeze(['production-release.yml', 'production-rollback.yml'])
const MAX_TAG_PEELS = 5

const jsonLines = (output) => output.split('\n').filter(Boolean).map((line) => JSON.parse(line))

function readGh(args, token) {
  return execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token }, stdio: ['ignore', 'pipe', 'inherit'] })
}

/** Release and tag listing only: all the release-version CLI needs. */
export function realReleaseDeps({ repo, readToken }) {
  if (!repo || !readToken) throw new Error('release deps: repo and read token are required')
  const read = (args) => readGh(args, readToken)
  const api = (endpoint) => JSON.parse(read(['api', endpoint]))
  const paged = (endpoint, jq) => jsonLines(read(['api', '--paginate', endpoint, '--jq', jq]))
  return {
    listReleases: async () => paged(`repos/${repo}/releases?per_page=100`, '.[] | {tag_name, draft, prerelease} | @json'),
    listTagNames: async () => paged(`repos/${repo}/tags?per_page=100`, '.[].name | @json'),
    // Annotated tags are peeled to the commit they point at; anything that is not a commit is an error.
    resolveTagCommit: async (tag) => {
      let object = api(`repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`).object
      for (let peel = 0; object?.type === 'tag' && peel < MAX_TAG_PEELS; peel += 1) object = api(`repos/${repo}/git/tags/${object.sha}`).object
      if (object?.type !== 'commit') throw new Error(`production baseline: tag ${tag} does not point at a commit`)
      return object.sha
    },
    isAncestorOfMain: async (sha) => ['identical', 'ahead'].includes(api(`repos/${repo}/compare/${sha}...main`).status),
    api,
    paged,
  }
}

export function realProductionRequestDeps({ repo, readToken }) {
  const base = realAutoMergeDeps({ repo, readToken })
  const releaseDeps = realReleaseDeps({ repo, readToken })
  return {
    ...base,
    ...releaseDeps,
    // Public endpoints only: no credential of any kind.
    readRuntimeIdentity: () => readProductionRuntimeIdentity(),
    // Successful Deploy Health Check runs of one exact commit (workflow file, server-side head_sha filter).
    listHealthRuns: async (headSha) =>
      releaseDeps.paged(
        `repos/${repo}/actions/workflows/deploy-check.yml/runs?head_sha=${headSha}&status=success&per_page=100`,
        '.workflow_runs[] | {id, name, event, status, conclusion, head_sha, created_at, repository: {full_name: .repository.full_name}, head_repository: {full_name: .head_repository.full_name}} | @json',
      ),
    readAutoMergeResult: (runId) => base.readNamedContext(runId, AUTO_MERGE_RESULT_ARTIFACT),
    // Queued, running or awaiting-approval Production Release / Rollback runs. run-name carries the target SHA.
    listActiveProductionRuns: async () => {
      const runs = []
      for (const workflow of PRODUCTION_WORKFLOW_FILES) {
        for (const status of ACTIVE_RUN_STATUSES) {
          const found = releaseDeps.paged(
            `repos/${repo}/actions/workflows/${workflow}/runs?status=${status}&per_page=100`,
            '.workflow_runs[] | {id, status, display_title} | @json',
          )
          runs.push(...found.map((run) => ({ id: run.id, status: run.status, workflow, displayTitle: run.display_title ?? '' })))
        }
      }
      return runs
    },
  }
}
