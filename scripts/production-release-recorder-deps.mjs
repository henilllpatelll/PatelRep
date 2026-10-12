// GitHub-backed dependencies for the Release Recorder. Three distinct credentials, deliberately never mixed:
//   readToken    - the run's GITHUB_TOKEN (read-only use here): runs, jobs, artifacts, checks, releases, refs.
//   tagToken     - the Release Recorder App token (contents + workflows write): used ONLY by createAnnotatedTag.
//   releaseToken - the run's GITHUB_TOKEN with `contents: write`: used ONLY by createRelease.
// Nothing here deletes, patches, or force-updates a ref, and no write endpoint other than the two above is called.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EVIDENCE_ARTIFACT, TAGGER } from './production-release-recorder.mjs'
import { realReleaseDeps } from './production-release-request-deps.mjs'
import { readProductionRuntimeIdentity } from './production-runtime-identity.mjs'

const MAX_TAG_PEELS = 5

function gh(args, token) {
  if (!token) throw new Error('release recorder: missing credential for this operation')
  return execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
}

const isNotFound = (error) => /HTTP 404|Not Found/i.test(`${error?.stderr ?? ''}${error?.message ?? ''}`)

export function realRecorderDeps({ repo, readToken, tagToken, releaseToken, notesFile }) {
  if (!repo || !readToken) throw new Error('release recorder: repo and read token are required')
  const read = (args) => gh(args, readToken)
  const api = (endpoint) => JSON.parse(read(['api', endpoint]))
  const releaseDeps = realReleaseDeps({ repo, readToken })

  const getTag = async (version) => {
    let object
    try {
      object = api(`repos/${repo}/git/ref/tags/${encodeURIComponent(version)}`).object
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
    const type = object.type
    for (let peel = 0; object?.type === 'tag' && peel < MAX_TAG_PEELS; peel += 1) object = api(`repos/${repo}/git/tags/${object.sha}`).object
    if (object?.type !== 'commit') throw new Error(`release recorder: tag ${version} does not point at a commit`)
    return { type, commit: object.sha }
  }

  return {
    listReleases: releaseDeps.listReleases,
    listTagNames: releaseDeps.listTagNames,
    isAncestorOfMain: releaseDeps.isAncestorOfMain,
    readRuntimeIdentity: () => readProductionRuntimeIdentity(),
    getTag,
    checkConclusion: async (sha, name) => {
      const runs = JSON.parse(read(['api', `repos/${repo}/commits/${sha}/check-runs?per_page=100&check_name=${encodeURIComponent(name)}`, '--jq', '[.check_runs[] | {name, conclusion, status}]']))
      return runs.some((run) => run.name === name && run.status === 'completed' && run.conclusion === 'success') ? 'success' : (runs[0]?.conclusion ?? 'missing')
    },
    readRecorderRepo: async () => JSON.parse(gh(['api', `repos/${repo}`, '--jq', '{full_name}'], tagToken)),
    getRun: async (runId) => {
      const run = api(`repos/${repo}/actions/runs/${runId}`)
      return {
        id: run.id,
        path: run.path,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        head_branch: run.head_branch,
        head_sha: run.head_sha,
        repository: run.repository?.full_name,
        head_repository: run.head_repository?.full_name,
      }
    },
    getRunJobs: async (runId) => releaseDeps.paged(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, '.jobs[] | {name, conclusion} | @json'),
    getEvidence: async (runId) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'release-evidence-'))
      try {
        read(['run', 'download', String(runId), '--repo', repo, '--name', EVIDENCE_ARTIFACT, '--dir', dir])
        return JSON.parse(readFileSync(path.join(dir, 'context.json'), 'utf8'))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    // The ONLY ref-creating call. createRef POSTs a NEW ref and cannot overwrite (422 if it exists); there is no
    // PATCH/DELETE path in this module. The caller has already proven the tag does not exist.
    createAnnotatedTag: async ({ version, sha }) => {
      const created = JSON.parse(
        gh(
          [
            'api', '--method', 'POST', `repos/${repo}/git/tags`,
            '-f', `tag=${version}`,
            '-f', `message=Production release ${version} (${sha.slice(0, 7)})`,
            '-f', `object=${sha}`,
            '-f', 'type=commit',
            '-f', `tagger[name]=${TAGGER.name}`,
            '-f', `tagger[email]=${TAGGER.email}`,
          ],
          tagToken,
        ),
      )
      gh(['api', '--method', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/tags/${version}`, '-f', `sha=${created.sha}`], tagToken)
    },
    createRelease: async ({ version }) => {
      if (!notesFile) throw new Error('release recorder: NOTES_FILE is required to create the Release')
      gh(['release', 'create', version, '--repo', repo, '--verify-tag', '--title', version, '--notes-file', notesFile], releaseToken)
    },
  }
}
