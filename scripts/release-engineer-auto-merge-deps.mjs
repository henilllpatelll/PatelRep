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

const STAGING_CONTEXT_ARTIFACT = 'staging-candidate-context'

/**
 * Returns null ONLY when the run has no artifact named staging-candidate-context (listed explicitly, so a
 * download error is never mistaken for "no candidate"). Once the artifact exists, every problem throws.
 */
export async function readStagingContextFrom({ listArtifacts, download, runId }) {
  const matches = (await listArtifacts()).filter((artifact) => artifact?.name === STAGING_CONTEXT_ARTIFACT)
  if (matches.length === 0) return null
  if (matches.length > 1) throw new Error(`auto-merge: run ${runId} has multiple ${STAGING_CONTEXT_ARTIFACT} artifacts`)
  if (matches[0].expired) throw new Error(`auto-merge: ${STAGING_CONTEXT_ARTIFACT} of run ${runId} has expired`)
  let downloaded
  try {
    downloaded = await download()
  } catch (error) {
    throw new Error(`auto-merge: ${STAGING_CONTEXT_ARTIFACT} of run ${runId} could not be downloaded: ${String(error.message).split('\n')[0].slice(0, 120)}`)
  }
  if (downloaded.files.length !== 1 || downloaded.files[0] !== 'context.json') throw new Error(`auto-merge: ${STAGING_CONTEXT_ARTIFACT} has unexpected files`)
  try {
    return JSON.parse(downloaded.readFile('context.json'))
  } catch {
    throw new Error(`auto-merge: ${STAGING_CONTEXT_ARTIFACT} is not valid JSON`)
  }
}

const jsonLines = (output) => output.split('\n').filter(Boolean).map((line) => JSON.parse(line))

export function realAutoMergeDeps({ repo, readToken, mergeToken }) {
  if (!repo || !readToken) throw new Error('auto-merge: repo and read token are required')
  const read = (args) => gh(args, readToken)
  const api = (endpoint) => JSON.parse(read(['api', endpoint]))
  const paged = (endpoint, jq) => jsonLines(read(['api', '--paginate', endpoint, '--jq', jq]))

  return {
    getRun: async (id) => api(`repos/${repo}/actions/runs/${id}`),
    readStagingContext: (runId) =>
      readStagingContextFrom({
        listArtifacts: async () => paged(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '.artifacts[] | @json'),
        download: async () => {
          const dir = mkdtempSync(path.join(tmpdir(), 'staging-ctx-'))
          read(['run', 'download', String(runId), '--repo', repo, '--name', STAGING_CONTEXT_ARTIFACT, '--dir', dir])
          return { files: readdirSync(dir), readFile: (name) => readFileSync(path.join(dir, name), 'utf8') }
        },
        runId,
      }),
    getPr: async (number) => {
      // GitHub computes mergeability lazily; retry only while it reports "not computed yet".
      for (let attempt = 1; ; attempt += 1) {
        const pr = api(`repos/${repo}/pulls/${number}`)
        if ((pr.mergeable !== null && pr.mergeable_state !== 'unknown') || attempt >= MERGEABLE_RETRIES) return pr
        await new Promise((resolve) => setTimeout(resolve, MERGEABLE_DELAY_MS))
      }
    },
    // Full detail objects (the list endpoint omits bypass actors and rules). Read-only; never mutates rulesets.
    listBranchRulesets: async () => {
      const summaries = JSON.parse(read(['api', `repos/${repo}/rulesets?per_page=100`]))
      if (!Array.isArray(summaries)) throw new Error('auto-merge: malformed ruleset list')
      return summaries.filter((r) => r.target === 'branch').map((r) => api(`repos/${repo}/rulesets/${r.id}`))
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
