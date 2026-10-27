// GitHub-backed dependencies for the dependency orchestrator. Reads use the read-only workflow token;
// the few writes use a separately supplied, narrowly scoped PatelRep GitHub App token:
//   writeToken  - update-branch, one comment, two workflow dispatches, one exact-SHA merge
// The checkpoint is a workflow artifact (no Issues write is ever needed): it is written to a local file that the
// workflow uploads, and read back from the newest artifact produced by a trusted run of this workflow.
// Nothing here executes PR content, and PR text is never interpolated into a command.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validateState } from './dependency-orchestrator-state.mjs'
import { extractUpdates } from './dependency-orchestrator-policy.mjs'

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const GITHUB_ACTIONS_APP_ID = 15368
const STATE_ARTIFACT = 'dependency-orchestrator-state'
const WORKFLOW_PATH = '.github/workflows/dependency-orchestrator.yml'
const MANIFEST = /(?:^|\/)(?:package\.json|requirements[\w.-]*\.txt)$/

function gh(args, token, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GH_TOKEN: token },
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  })
}
const failure = (error) => String(error.stderr || error.message || error).replace(/\s+/g, ' ').slice(0, 240)
const lines = (output) => output.split('\n').filter(Boolean).map((line) => JSON.parse(line))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchPeers(update) {
  const timeout = AbortSignal.timeout(8000)
  try {
    if (update.ecosystem === 'npm') {
      const res = await fetch(`https://registry.npmjs.org/${update.name.replace('/', '%2F')}/${update.to}`, { signal: timeout })
      if (!res.ok) return null
      const meta = await res.json()
      const optional = meta.peerDependenciesMeta ?? {}
      return { peers: Object.fromEntries(Object.entries(meta.peerDependencies ?? {}).filter(([name]) => !optional[name]?.optional)) }
    }
    if (update.ecosystem === 'pip') {
      const res = await fetch(`https://pypi.org/pypi/${update.name}/${update.to}/json`, { signal: timeout })
      if (!res.ok) return null
      const peers = {}
      for (const req of (await res.json()).info?.requires_dist ?? []) {
        const m = /^([A-Za-z0-9_.-]+)\s*\(?([^;)]*)\)?\s*(;.*)?$/.exec(req)
        if (m && !/extra\s*==/.test(m[3] ?? '') && m[2].trim()) peers[m[1].toLowerCase().replace(/[_.]+/g, '-')] = m[2].trim()
      }
      return { peers }
    }
  } catch { /* registry unreachable: compatibility simply stays unknown */ }
  return null
}

/** A run is a trusted checkpoint writer only if it is this workflow, in this repository, from main's definition. */
export function trustedStateRun(run, repo, defaultBranch = 'main') {
  if (run.path !== WORKFLOW_PATH || run.head_repository?.full_name !== repo) return false
  if (run.event === 'workflow_run') return true // workflow_run definitions always come from the default branch
  return ['workflow_dispatch', 'schedule'].includes(run.event) && run.head_branch === defaultBranch
}

export function realDeps({ repo, readToken, writeToken = null, policyPath, stateFile = null, defaultBranch = 'main' }) {
  if (!REPO.test(repo ?? '') || !readToken) throw new Error('dependency orchestrator: valid repo and read token are required')
  const read = (args) => gh(args, readToken)
  const api = (endpoint) => JSON.parse(read(['api', endpoint]))
  const paged = (endpoint, jq = '.[]') => lines(read(['api', '--paginate', endpoint, '--jq', jq]))
  const need = (token, what) => { if (!token) throw new Error(`${what} requires a credential this job does not hold`); return token }

  async function mergeableState(number) {
    for (let i = 0; i < 4; i += 1) {
      const pr = api(`repos/${repo}/pulls/${number}`)
      if (pr.mergeable_state && pr.mergeable_state !== 'unknown') return pr
      await sleep(2500)
    }
    return api(`repos/${repo}/pulls/${number}`)
  }

  function reviewFacts(number) {
    const [owner, name] = repo.split('/')
    const query = 'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100){nodes{isResolved}} latestOpinionatedReviews(first:50){nodes{state}}}}}'
    const data = JSON.parse(read(['api', 'graphql', '-f', `query=${query}`, '-F', `o=${owner}`, '-F', `n=${name}`, '-F', `p=${number}`])).data.repository.pullRequest
    return {
      unresolved_threads: data.reviewThreads.nodes.filter((t) => !t.isResolved).length,
      changes_requested: data.latestOpinionatedReviews.nodes.some((r) => r.state === 'CHANGES_REQUESTED'),
    }
  }

  function checkFacts(sha) {
    const runs = paged(`repos/${repo}/commits/${sha}/check-runs?per_page=100`, '.check_runs[]|{name,status,conclusion,id,app_id:.app.id,started_at,details_url,head_sha}')
      .filter((c) => c.app_id === GITHUB_ACTIONS_APP_ID && c.head_sha === sha)
    const latest = (name) => {
      const found = runs.filter((c) => c.name === name).sort((a, b) => Date.parse(b.started_at ?? 0) - Date.parse(a.started_at ?? 0))[0]
      return found ? { status: found.status, conclusion: found.conclusion, run_id: Number(/runs\/(\d+)/.exec(found.details_url ?? '')?.[1] ?? 0), head_sha: found.head_sha } : null
    }
    return {
      ci_gate: latest('CI Gate'), migration_gate: latest('Database Migration Gate'), staging_gate: latest('Staging Gate'),
      failing: [...new Set(runs.filter((c) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(c.conclusion)).map((c) => c.name))],
      ci_pending: runs.some((c) => c.status !== 'completed'),
    }
  }

  const activeCache = new Map()
  const workflowActive = (file) => { if (!activeCache.has(file)) activeCache.set(file, probeActive(file)); return activeCache.get(file) }
  const probeActive = (file) => ['queued', 'in_progress', 'waiting', 'pending'].some((status) => api(`repos/${repo}/actions/workflows/${file}/runs?status=${status}&per_page=1`).total_count > 0)

  const deps = {
    async readPolicy() { return JSON.parse(readFileSync(policyPath, 'utf8')) },

    /** Newest checkpoint from a TRUSTED run of this workflow (never a PR-controlled run); null when none. */
    async loadState() {
      if (stateFile && existsSync(stateFile)) return validateState(JSON.parse(readFileSync(stateFile, 'utf8')))
      const candidates = api(`repos/${repo}/actions/artifacts?name=${STATE_ARTIFACT}&per_page=20`).artifacts.filter((a) => !a.expired && a.workflow_run?.id)
      for (const artifact of candidates) {
        const run = api(`repos/${repo}/actions/runs/${artifact.workflow_run.id}`)
        if (!trustedStateRun(run, repo, defaultBranch)) continue
        const dir = mkdtempSync(path.join(tmpdir(), 'dep-state-'))
        read(['run', 'download', String(run.id), '--repo', repo, '--name', STATE_ARTIFACT, '--dir', dir])
        return validateState(JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')))
      }
      return null
    },

    /** Writes the checkpoint (and the latest report) where the workflow's upload step collects them. */
    async saveState(state, body) {
      if (!stateFile) throw new Error('saving state requires STATE_FILE')
      mkdirSync(path.dirname(stateFile), { recursive: true })
      writeFileSync(stateFile, JSON.stringify(state))
      if (body) writeFileSync(path.join(path.dirname(stateFile), 'report.md'), body)
    },

    async readSnapshot(policy, { research = {}, only = null } = {}) {
      const main = api(`repos/${repo}/commits/main`)
      const manifests = {}
      for (const path of Object.values(policy.allowed_paths).flat().filter((p) => MANIFEST.test(p))) {
        try { manifests[path] = Buffer.from(api(`repos/${repo}/contents/${path}?ref=${main.sha}`).content, 'base64').toString('utf8') } catch { /* manifest absent on main */ }
      }
      const open = paged(`repos/${repo}/pulls?state=open&per_page=100`)
        .filter((p) => policy.discovery.authors.includes(p.user.login) && p.head.ref.startsWith(policy.discovery.head_prefix) && (!only || only.includes(p.number)))
        .slice(0, policy.discovery.max_prs)
      const prs = []
      for (const summary of open) {
        const pr = await mergeableState(summary.number)
        const compare = api(`repos/${repo}/compare/${main.sha}...${pr.head.sha}`)
        const commits = paged(`repos/${repo}/pulls/${pr.number}/commits?per_page=100`)
        prs.push({
          number: pr.number, state: pr.state, draft: pr.draft, user: { login: pr.user.login, type: pr.user.type },
          head: { sha: pr.head.sha, ref: pr.head.ref, repo: pr.head.repo?.full_name ?? '' }, base: { ref: pr.base.ref, repo: pr.base.repo.full_name },
          labels: pr.labels.map((l) => l.name), mergeable_state: pr.mergeable_state, behind_by: compare.behind_by,
          commit_authors: commits.map((c) => c.author?.login ?? `unknown:${(c.commit.author?.name ?? '').slice(0, 20)}`),
          files: paged(`repos/${repo}/pulls/${pr.number}/files?per_page=100`).map((f) => ({ filename: f.filename, status: f.status, patch: f.patch ?? '', previous_filename: f.previous_filename })),
          ...reviewFacts(pr.number), checks: checkFacts(pr.head.sha),
          repair_in_flight: workflowActive('claude-release-engineer.yml'),
        })
      }
      const compat = {}
      const seen = new Set()
      for (const update of prs.flatMap((p) => extractUpdates(p.files)).filter((u) => ['npm', 'pip'].includes(u.ecosystem))) {
        const key = `${update.ecosystem}:${update.name}@${update.to}`
        if (seen.has(key) || seen.size >= 40) continue
        seen.add(key)
        const peers = await fetchPeers(update)
        if (peers) compat[key] = peers
      }
      return { main: { sha: main.sha, manifests }, prs, staging_busy: workflowActive('staging-candidate.yml'), compat, research }
    },

    async commitAuthors(number) { return paged(`repos/${repo}/pulls/${number}/commits?per_page=100`).map((c) => c.author?.login ?? 'unknown') },

    async updateBranch(number, expectedHeadSha) {
      try {
        gh(['api', '-X', 'PUT', `repos/${repo}/pulls/${number}/update-branch`, '-f', `expected_head_sha=${expectedHeadSha}`], need(writeToken, 'update-branch'))
        return { ok: true }
      } catch (error) { return { ok: false, reason: failure(error) } }
    },

    async comment(number, body) { gh(['api', '-X', 'POST', `repos/${repo}/issues/${number}/comments`, '-f', `body=${body}`], need(writeToken, 'commenting')) },

    async dispatchWorkflow(file, inputs) {
      const args = ['api', '-X', 'POST', `repos/${repo}/actions/workflows/${file}/dispatches`, '-f', 'ref=main']
      for (const [key, value] of Object.entries(inputs)) args.push('-f', `inputs[${key}]=${value}`)
      gh(args, need(writeToken, 'workflow dispatch'))
    },

    async runMinutes(runId) { return runId ? Math.round((api(`repos/${repo}/actions/runs/${runId}/timing`).run_duration_ms ?? 0) / 60000) : 0 },

    async mergePr(number, sha) {
      try { gh(['api', '-X', 'PUT', `repos/${repo}/pulls/${number}/merge`, '-f', `sha=${sha}`, '-f', 'merge_method=merge'], need(writeToken, 'merge')); return { ok: true } }
      catch (error) { return { ok: false, reason: failure(error) } }
    },

    async confirmMerge(number, sha, baseSha) {
      const pr = api(`repos/${repo}/pulls/${number}`)
      if (!pr.merged || pr.head.sha !== sha || !pr.merge_commit_sha) return { merged: false }
      const commit = api(`repos/${repo}/commits/${pr.merge_commit_sha}`)
      const parents = commit.parents.map((p) => p.sha)
      return { merged: parents.includes(sha) && parents.includes(baseSha), merge_commit_sha: pr.merge_commit_sha }
    },
  }
  return deps
}
