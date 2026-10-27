// Test fixtures for the dependency orchestrator: mocked GitHub snapshots with no network access.
import { normalizePolicy } from './dependency-orchestrator-policy.mjs'

export const SHA = (n) => String(n).padStart(40, '0').replace(/[^0-9a-f]/g, 'a').slice(0, 40)
export const MAIN = SHA('a1')
export const NOW = '2026-10-26T12:00:00.000Z'

export const MAIN_WEB = JSON.stringify({
  dependencies: { 'framer-motion': '^13.0.0', react: '^18.3.1', 'react-dom': '^18.3.1', stripe: '^22.4.0', 'tailwind-merge': '^2.3.0', next: '16.3.0-preview.10', clsx: '^2.1.1' },
  devDependencies: { tailwindcss: '^3.4.4', '@types/react': '^18.3.3' },
})
export const MAIN_API = 'fastapi==0.115.0\nstripe==15.4.0\nparamiko==3.5.1\nreportlab==4.4.4\nanthropic==0.121.0\ncryptography==50.0.2\nrequests==2.32.0\nidna==3.7.0\nurllib3==2.2.0\ncertifi==2024.2.2\n'

export function policyWith(overrides = {}) {
  const base = {
    version: 1, paused: false, mutation_enabled: true,
    schedule: { mode: 'off' },
    discovery: { authors: ['dependabot[bot]'], head_prefix: 'dependabot/', allowed_commit_authors: ['dependabot[bot]', 'patelrep-release-engineer[bot]'], max_prs: 25 },
    limits: {},
    allowed_paths: { npm: ['apps/web/package.json', 'apps/web/package-lock.json'], pip: ['apps/api/requirements.txt'], 'github-actions': [] },
    risk: {
      package_categories: {
        billing: ['stripe'], 'auth-security': ['cryptography', '@supabase/ssr'], sftp: ['paramiko'], framework: ['next', 'react', 'react-dom'],
        'css-framework': ['tailwindcss', 'tailwind-merge'], 'ai-accounting': ['anthropic', 'openai'],
      },
    },
    known_incompatibilities: [{ ecosystem: 'npm', name: 'tailwind-merge', major: 3, requires: { tailwindcss: '>=4.0.0' }, reason: 'v3 needs Tailwind v4' }],
    repair: { dispatch_release_engineer: true },
    merge: { mode: 'prepare-only', approvals: [] },
    ...overrides,
  }
  return normalizePolicy(base)
}

const npmPatch = (name, from, to) => `@@ -1,3 +1,3 @@\n-    "${name}": "^${from}",\n+    "${name}": "^${to}",`
const pipPatch = (name, from, to) => `@@ -1,3 +1,3 @@\n-${name}==${from}\n+${name}==${to}`

export function prFixture(number, { eco = 'npm', name, from, to, files = null, ref = null, checks = {}, authors = ['dependabot[bot]'], behind = 0, labels = [], mergeable = 'clean', extra = {} } = {}) {
  const file = eco === 'npm' ? 'apps/web/package.json' : 'apps/api/requirements.txt'
  return {
    number, state: 'open', draft: false, user: { login: 'dependabot[bot]', type: 'Bot' },
    head: { sha: SHA(number), ref: ref ?? `dependabot/${eco}/${name}`, repo: 'o/r' }, base: { ref: 'main', repo: 'o/r' },
    labels, mergeable_state: mergeable, behind_by: behind, commit_authors: authors,
    files: files ?? [{ filename: file, patch: eco === 'npm' ? npmPatch(name, from, to) : pipPatch(name, from, to) }],
    changes_requested: false, unresolved_threads: 0, repair_in_flight: false,
    checks: { ci_gate: null, migration_gate: null, staging_gate: null, failing: [], ci_pending: false, ...checks },
    ...extra,
  }
}

const PIP_BASE = { requests: '2.32.0', idna: '3.7.0', urllib3: '2.2.0', certifi: '2024.2.2' }
export const bumpPatch = (v) => v.replace(/(\d+)$/, (n) => String(Number(n) + 1))
/** A low-risk pip patch bump of a package that exists on main. */
export function lowPatchPr(number, name = 'requests', extra = {}) {
  return prFixture(number, { eco: 'pip', name, from: PIP_BASE[name], to: bumpPatch(PIP_BASE[name]), ...extra })
}

export const green = (sha, run = 1) => ({ status: 'completed', conclusion: 'success', run_id: run, head_sha: sha })
export const red = (sha, run = 1) => ({ status: 'completed', conclusion: 'failure', run_id: run, head_sha: sha })
export const running = (sha) => ({ status: 'in_progress', conclusion: null, run_id: 9, head_sha: sha })

export function snapshotWith(prs, extra = {}) {
  return {
    main: { sha: MAIN, manifests: { 'apps/web/package.json': MAIN_WEB, 'apps/api/requirements.txt': MAIN_API } },
    prs, staging_busy: false, compat: {}, research: {}, ...extra,
  }
}

export const processFlags = (extra = {}) => ({ start_batch: true, mode: 'process', paused_var: false, requested_prs: null, ...extra })
