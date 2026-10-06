// Phase 4C production-operations notification dependencies.
// Resolve uses only GET operations. Publish receives an issues:write token and may only create/comment/close GitHub Issues.
import { execFileSync } from 'node:child_process'
import { realAutoMergeDeps } from './release-engineer-auto-merge-deps.mjs'

export const NOTIFICATION_ARTIFACT = 'production-operations-notification'

function gh(args, token, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    env: { ...process.env, GH_TOKEN: token },
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
  })
}

export function realProductionNotificationDeps({ repo, readToken, issueToken }) {
  if (!repo || !readToken) throw new Error('production notification: repo and read token are required')
  const base = realAutoMergeDeps({ repo, readToken })
  const read = (args) => gh(args, readToken)
  const api = (endpoint) => JSON.parse(read(['api', endpoint]))
  const paged = (endpoint, jq) =>
    read(['api', '--paginate', endpoint, '--jq', jq]).split('\n').filter(Boolean).map((line) => JSON.parse(line))

  const writeApi = (method, endpoint, body) => {
    if (!issueToken) throw new Error('production notification: issue token is unavailable')
    return JSON.parse(gh(['api', '--method', method, endpoint, '--input', '-'], issueToken, JSON.stringify(body)))
  }

  return {
    getRun: base.getRun,
    readNamedContext: base.readNamedContext,
    // Artifact-first: only published notification evidence is listed (never every notify workflow run).
    listNotificationArtifacts: async () =>
      paged(
        `repos/${repo}/actions/artifacts?name=${NOTIFICATION_ARTIFACT}&per_page=100`,
        '.artifacts[] | {id,name,expired,created_at,workflow_run:{id:.workflow_run.id,head_branch:.workflow_run.head_branch,head_sha:.workflow_run.head_sha}} | @json',
      ),
    readNotificationResult: (runId) => base.readNamedContext(runId, NOTIFICATION_ARTIFACT),
    getIssue: async (number) => api(`repos/${repo}/issues/${number}`),
    createIssue: async ({ title, body, assignee }) =>
      writeApi('POST', `repos/${repo}/issues`, { title, body, assignees: [assignee] }),
    commentIssue: async (number, body) =>
      writeApi('POST', `repos/${repo}/issues/${number}/comments`, { body }),
    setIssueState: async (number, state) =>
      writeApi('PATCH', `repos/${repo}/issues/${number}`, { state }),
  }
}
