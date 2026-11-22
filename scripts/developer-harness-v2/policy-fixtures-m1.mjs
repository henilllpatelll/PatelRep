// Developer Harness V2 — Phase 4 M1 fixtures: the nine human-approved OpenWolf protected paths. Fixtures only:
// nothing here is ever executed or sent. `before` records the classification under the Phase 3 head (95c1d7ac) so the
// test can show every change is a strict tightening (allowed → human_approval) and nothing else moved.

export const M1_PATHS = Object.freeze([
  '.wolf/OPENWOLF.md', '.wolf/config.json', '.wolf/cron-manifest.json', '.wolf/cerebrum.md', '.wolf/knowledge/**',
  '.wolf/anatomy.md', '.wolf/buglog.json', '.wolf/reframe-frameworks.md', '.wolf/identity.md',
])
/** A concrete file for each protected glob. */
const CONCRETE = ['.wolf/OPENWOLF.md', '.wolf/config.json', '.wolf/cron-manifest.json', '.wolf/cerebrum.md', '.wolf/knowledge/web.md',
  '.wolf/anatomy.md', '.wolf/buglog.json', '.wolf/reframe-frameworks.md', '.wolf/identity.md']
/** Transient bookkeeping that must stay allowed. */
export const M1_TRANSIENT = Object.freeze(['.wolf/memory.md', '.wolf/token-ledger.json', '.wolf/cron-state.json', '.wolf/suggestions.json'])

const REPO = 'repos/henilllpatelll/PatelRep'
const SAFE = Buffer.from('x', 'utf8').toString('base64')
const F = (id, tool, input, expect, extra = {}) => ({ id, group: 'M1', tool, input, expect, before: 'allowed', ...extra })
const B = (id, input, expect, extra = {}) => F(id, 'Bash', input, expect, extra)
const PS = (id, input, expect, extra = {}) => F(id, 'PowerShell', input, expect, extra)
const mi = (extra) => ({ owner: 'henilllpatelll', repo: 'PatelRep', message: 'm', content: 'x', branch: 'feat/x', ...extra })
const put = (file, fields = '') => `gh api -X PUT ${REPO}/contents/${file} -f message=m -f content=${SAFE} -f branch=feat/x ${fields}`.trim()

export const M1_FIXTURES = [
  ...CONCRETE.flatMap((p, i) => [
    F(`M1-w${i}`, 'Write', p, 'human_approval', { content: 'x' }),
    F(`M1-e${i}`, 'Edit', p, 'human_approval', { content: 'x' }),
  ]),
  F('M1-k1', 'Edit', '.wolf/knowledge/sub/dir/deep.md', 'human_approval', { content: 'x', note: 'nested under the glob' }),
  F('M1-k2', 'Write', '.wolf/knowledge/_provenance.json', 'human_approval', { content: '{}' }),
  F('M1-c1', 'Edit', '.WOLF/Cerebrum.md', 'human_approval', { content: 'x', note: 'case-insensitive filesystems' }),
  // shell redirection and file tools (Bash)
  B('M1-s1', 'echo x > .wolf/cerebrum.md', 'human_approval'),
  B('M1-s2', 'echo x >> .wolf/buglog.json', 'human_approval'),
  B('M1-s3', 'echo x | tee .wolf/anatomy.md', 'human_approval'),
  B('M1-s4', 'sed -i s/a/b/ .wolf/knowledge/web.md', 'human_approval'),
  B('M1-s5', 'cp apps/web/lib/x.ts .wolf/identity.md', 'human_approval'),
  B('M1-s6', 'mv apps/web/lib/x.ts .wolf/OPENWOLF.md', 'human_approval'),
  B('M1-s7', 'rm .wolf/reframe-frameworks.md', 'human_approval'),
  B('M1-s8', 'echo {} > .wolf/config.json', 'human_approval'),
  B('M1-s9', 'echo {} > .wolf/cron-manifest.json', 'human_approval'),
  B('M1-s10', 'printf x > ./.wolf/knowledge/api-supabase.md', 'human_approval'),
  // PowerShell
  PS('M1-p1', 'Set-Content -Path .wolf/cerebrum.md -Value x', 'human_approval'),
  PS('M1-p2', 'Add-Content .wolf/buglog.json x', 'human_approval'),
  PS('M1-p3', "'x' | Out-File .wolf/identity.md", 'human_approval'),
  PS('M1-p4', 'Remove-Item .wolf/knowledge/web.md', 'human_approval'),
  // GitHub REST contents API and MCP file writes carry at least the local protection
  B('M1-g1', put('.wolf/cerebrum.md'), 'human_approval'),
  B('M1-g2', put('.wolf/knowledge/web.md', '-f sha=abc'), 'human_approval'),
  B('M1-g3', put('.wolf/identity.md'), 'human_approval'),
  B('M1-g4', put('.wolf/config.json'), 'human_approval'),
  F('M1-m1', 'mcp__github__create_or_update_file', 'create_or_update_file', 'human_approval', { mcpInput: mi({ path: '.wolf/OPENWOLF.md' }) }),
  F('M1-m2', 'mcp__github__create_or_update_file', 'create_or_update_file', 'human_approval', { mcpInput: mi({ path: '.wolf/knowledge/web.md', sha: 'abc' }) }),
  F('M1-m3', 'mcp__github__delete_file', 'delete_file', 'human_approval', { mcpInput: { owner: 'henilllpatelll', repo: 'PatelRep', path: '.wolf/anatomy.md', message: 'm', branch: 'feat/x', sha: 'abc' } }),
  F('M1-m4', 'mcp__github__push_files', 'push_files', 'human_approval', { mcpInput: { owner: 'henilllpatelll', repo: 'PatelRep', branch: 'feat/x', message: 'm', files: [{ path: 'apps/web/lib/y.ts', content: 'x' }, { path: '.wolf/reframe-frameworks.md', content: 'x' }] }, note: 'ordinary + M1 file takes the strictest' }),
  F('M1-m5', 'mcp__github__create_or_update_file', 'create_or_update_file', 'human_approval', { mcpInput: mi({ path: '.wolf/cron-manifest.json' }) }),
  F('M1-m6', 'mcp__github__create_or_update_file', 'create_or_update_file', 'human_approval', { mcpInput: mi({ path: '.wolf/buglog.json' }) }),
  // Not tightened: reads, transient bookkeeping and ordinary source stay as before
  ...CONCRETE.map((p, i) => F(`M1-r${i}`, 'Read', p, 'allowed')),
  ...M1_TRANSIENT.map((p, i) => F(`M1-t${i}`, 'Edit', p, 'allowed', { content: 'x', note: 'transient bookkeeping is not protected' })),
  F('M1-t4', 'Edit', 'apps/web/lib/x.ts', 'allowed', { content: 'x', note: 'ordinary source retains its classification' }),
  B('M1-t5', 'echo x > .wolf/memory.md', 'allowed'),
  F('M1-h1', 'Edit', '.wolf/hooks/stop.js', 'human_approval', { before: 'human_approval' }),
]
