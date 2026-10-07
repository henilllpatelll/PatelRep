// Phase 5C read-only production automation watchdog dependencies.
// Every call is a GET. Workflow display names, run.name and display_title are deliberately NOT selected:
// identity is the exact workflow path resolved to a numeric workflow id, then re-validated on every returned run.
//
// Run listings are always the UNFILTERED newest-first page (or a created-window read). GitHub's status/branch filtered
// listings were observed returning stale snapshots, so filtering happens locally on validated runs instead.
import { execFileSync } from 'node:child_process'

const RUN_FIELDS = '{id,workflow_id,run_attempt,path,event,status,conclusion,head_branch,head_sha,created_at,run_started_at,updated_at,repository:{full_name:.repository.full_name},head_repository:{full_name:.head_repository.full_name}}'
const RUNS_PER_PAGE = 100
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

export function realProductionAutomationWatchdogDeps({ repo, readToken }) {
  if (!repo || !readToken) throw new Error('production automation watchdog: repo and read token are required')
  const read = (args) =>
    execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: readToken }, stdio: ['ignore', 'pipe', 'inherit'] })
  const lines = (output) => output.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  return {
    // Current workflow metadata (id, exact path, state). One bounded read: a repository has few workflow files.
    listWorkflows: async () =>
      lines(read(['api', '--paginate', `repos/${repo}/actions/workflows?per_page=100`, '--jq', '.workflows[] | {id,path,state} | @json'])),
    // One bounded page per workflow id: the newest runs, or the newest runs created at/after `since`.
    listWorkflowRuns: async (workflowId, { recent, since } = {}) => {
      if (!Number.isInteger(workflowId) || workflowId < 1) throw new Error('production automation watchdog: invalid workflow id')
      if (!recent && !ISO_UTC.test(since ?? '')) throw new Error('production automation watchdog: invalid workflow run query')
      const window = recent ? '' : `&created=${encodeURIComponent(`>=${since}`)}`
      return lines(read(['api', `repos/${repo}/actions/workflows/${workflowId}/runs?per_page=${RUNS_PER_PAGE}${window}`, '--jq', `.workflow_runs[] | ${RUN_FIELDS} | @json`]))
    },
  }
}
