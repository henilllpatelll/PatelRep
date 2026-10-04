// GitHub-backed dependencies for the Phase 2C resolver and merge script. Reads use the read-only token;
// the optional merge token is used for exactly one call: the exact-SHA pull request merge.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const MERGEABLE_RETRIES = 6
const MERGEABLE_DELAY_MS = 5000

function gh(args, token, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    env: { ...process.env, GH_TOKEN: token },
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
  })
}

const jsonLines = (output) => output.split('\n').filter(Boolean).map((line) => JSON.parse(line))

export function realAutoMergeDeps({ repo, readToken, mergeToken }) {
  if (!repo || !readToken) throw new Error('auto-merge: repo and read token are required')
  const read = (args) => gh(args, readToken)
  const api = (endpoint) => JSON.parse(read(['api', endpoint]))
  const paged = (endpoint, jq) => jsonLines(read(['api', '--paginate', endpoint, '--jq', jq]))

  return {
    getRun: async (id) => api(`repos/${repo}/actions/runs/${id}`),
    readStagingContext: async (runId) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'staging-ctx-'))
      try {
        read(['run', 'download', String(runId), '--repo', repo, '--name', 'staging-candidate-context', '--dir', dir])
      } catch {
        throw new Error(`auto-merge: staging-candidate-context is missing from run ${runId}`)
      }
      const files = readdirSync(dir)
      if (files.length !== 1 || files[0] !== 'context.json') throw new Error('auto-merge: staging-candidate-context has unexpected files')
      return JSON.parse(readFileSync(path.join(dir, 'context.json'), 'utf8'))
    },
    getPr: async (number) => {
      // GitHub computes mergeability lazily; retry only while it reports "not computed yet".
      for (let attempt = 1; ; attempt += 1) {
        const pr = api(`repos/${repo}/pulls/${number}`)
        if ((pr.mergeable !== null && pr.mergeable_state !== 'unknown') || attempt >= MERGEABLE_RETRIES) return pr
        await new Promise((resolve) => setTimeout(resolve, MERGEABLE_DELAY_MS))
      }
    },
    getMergedPr: async (number) => api(`repos/${repo}/pulls/${number}`),
    listPrCommits: async (number) =>
      paged(`repos/${repo}/pulls/${number}/commits?per_page=100`, '.[] | @json').map((c) => ({
        sha: c.sha,
        message: c.commit?.message ?? '',
        authorEmail: c.commit?.author?.email ?? '',
        committerEmail: c.commit?.committer?.email ?? '',
        authorLogin: c.author?.login ?? null,
        authorType: c.author?.type ?? null,
        committerLogin: c.committer?.login ?? null,
        committerType: c.committer?.type ?? null,
      })),
    listPrFiles: async (number) => paged(`repos/${repo}/pulls/${number}/files?per_page=100`, '.[] | @json'),
    listCheckRuns: async (sha, name) =>
      paged(`repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`, '.check_runs[] | @json'),
    listReviews: async (number) => paged(`repos/${repo}/pulls/${number}/reviews?per_page=100`, '.[] | @json'),
    countUnresolvedThreads: async (number) => {
      const [owner, name] = repo.split('/')
      const query = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved}}}}}'
      const data = JSON.parse(read(['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`]))
      const threads = data?.data?.repository?.pullRequest?.reviewThreads
      if (!threads) throw new Error('auto-merge: review threads could not be read')
      // More than one page of threads cannot be proven resolved here; fail closed as "unresolved".
      return threads.pageInfo.hasNextPage ? 1 : threads.nodes.filter((thread) => !thread.isResolved).length
    },
    merge: async (number, sha) => {
      if (!mergeToken) throw new Error('auto-merge: merge token is not available')
      const body = JSON.stringify({ sha, merge_method: 'merge' })
      return JSON.parse(gh(['api', '--method', 'PUT', `repos/${repo}/pulls/${number}/merge`, '--input', '-'], mergeToken, body))
    },
  }
}
