// Phase 5C read-only production automation watchdog dependencies.
// Every call is a GET. run.name / display_title are deliberately NOT selected: only exact workflow path identity is used.
import { execFileSync } from 'node:child_process'

const RUN_FIELDS = '{id,run_attempt,path,event,status,conclusion,head_branch,head_sha,created_at,run_started_at,updated_at,repository:{full_name:.repository.full_name},head_repository:{full_name:.head_repository.full_name}}'
const WORKFLOW_FILE = /^[a-z0-9][a-z0-9-]*\.yml$/
const STATUS = /^(queued|in_progress|waiting|requested|pending|completed)$/
const BRANCH = /^main$/

export function realProductionAutomationWatchdogDeps({ repo, readToken }) {
  if (!repo || !readToken) throw new Error('production automation watchdog: repo and read token are required')
  const read = (args) =>
    execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: readToken }, stdio: ['ignore', 'pipe', 'inherit'] })
  return {
    listWorkflowRuns: async (file, { status, branch } = {}) => {
      if (!WORKFLOW_FILE.test(file) || !STATUS.test(status ?? '') || (branch !== undefined && !BRANCH.test(branch))) {
        throw new Error('production automation watchdog: invalid workflow run query')
      }
      const query = `status=${status}${branch ? `&branch=${branch}` : ''}&per_page=${status === 'completed' ? 5 : 100}`
      const args = ['api', ...(status === 'completed' ? [] : ['--paginate']), `repos/${repo}/actions/workflows/${file}/runs?${query}`, '--jq', `.workflow_runs[] | ${RUN_FIELDS} | @json`]
      return read(args).split('\n').filter(Boolean).map((line) => JSON.parse(line))
    },
  }
}
