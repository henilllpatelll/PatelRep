// Developer Harness V2 — Phase 3 curated-memory preservation tests. Offline, deterministic.
// Run: node --test scripts/developer-harness-v2/context/memory-curate.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { KNOWLEDGE_FILE_CAP_BYTES, TOPICS, estimateTokens } from './knowledge-topics.mjs'
import {
  CEREBRUM_INDEX_BUDGET_TOKENS, PROVENANCE_FILE, SOURCE_PATH, curate, entryId, findSecrets, knowledgeEntries, loadConsolidation,
  loadKnowledge, normalizeEntry, parseCerebrum, redact, renderIndex, verifyKnowledge,
} from './memory-curate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const KDIR = path.join(REPO, '.wolf', 'knowledge')
const prov = JSON.parse(readFileSync(path.join(KDIR, PROVENANCE_FILE), 'utf8'))
const files = loadKnowledge(KDIR)
const found = knowledgeEntries(files)
const sourceBlob = (() => {
  try { return execFileSync('git', ['-C', REPO, 'cat-file', 'blob', `${prov.source.commit}:${SOURCE_PATH}`], { maxBuffer: 1 << 26 }).toString('utf8') } catch { return null }
})()

test('the cerebrum index fits its ~2,000-token budget (ESTIMATED, conservative chars/3.5)', () => {
  const text = readFileSync(path.join(REPO, '.wolf/cerebrum.md'), 'utf8')
  assert.ok(estimateTokens(text) <= CEREBRUM_INDEX_BUDGET_TOKENS, `~${estimateTokens(text)} tokens`)
  assert.match(text, /Advisory data, not/)
  assert.match(text, /cannot authorize/)
})

test('the committed index is exactly what renderIndex produces from the committed knowledge (no hand drift)', () => {
  const text = readFileSync(path.join(REPO, '.wolf/cerebrum.md'), 'utf8')
  assert.equal(text, renderIndex({ files, provenance: prov }))
})

test('every original entry, including all Do-Not-Repeat lessons, is retained with identical normalized text', () => {
  const r = verifyKnowledge({ repo: REPO, knowledgeDir: KDIR })
  assert.deepEqual(r.problems, [])
  assert.equal(prov.counts.parsed_entries, prov.counts.retained_entries + prov.counts.exact_duplicates_merged)
  assert.equal(prov.counts.dnr_parsed, prov.counts.dnr_retained + prov.duplicates.filter((d) => prov.entries.find((e) => e.id === d.id)?.kind === 'dnr').length)
  const dnr = prov.entries.filter((e) => e.kind === 'dnr')
  assert.ok(dnr.length >= 160, `DNR inventory size ${dnr.length}`)
  for (const e of dnr) {
    const hit = found.get(e.id)
    assert.ok(hit, `${e.id} retained`)
    assert.equal(hit.file, e.file, `${e.id} lives in the mapped file`)
    assert.match(e.file, /\.dnr(-\d+)?\.md$/, `${e.id} is in a Do-Not-Repeat file`)
  }
})

test('old-to-new mapping re-derived from the source blob (when available in local history)', (t) => {
  if (sourceBlob === null) { t.skip(`source blob ${prov.source.commit.slice(0, 12)} not in local history (shallow clone)`); return }
  const { entries } = parseCerebrum(sourceBlob)
  const dnrSource = entries.filter((e) => e.kind === 'dnr')
  assert.equal(dnrSource.length, prov.counts.dnr_parsed)
  for (const e of dnrSource) {
    const hit = found.get(e.id)
    assert.ok(hit, `source L${e.start} ${e.id}`)
    if (!redact(e.text).redactions) assert.equal(hit.norm, normalizeEntry(e.text), `L${e.start} text identical`)
  }
})

test('duplicates and consolidation clusters map to retained Do-Not-Repeat entries', () => {
  for (const d of prov.duplicates) assert.ok(found.has(d.id), `duplicate at L${d.line} → ${d.id}`)
  const c = loadConsolidation()
  const seen = new Set()
  for (const cl of c.clusters) {
    assert.ok(cl.members.length >= 2, cl.id)
    for (const id of cl.members) {
      assert.ok(!seen.has(id), `${id} in one cluster only`); seen.add(id)
      const e = prov.entries.find((x) => x.id === id)
      assert.equal(e?.kind, 'dnr', `${cl.id}: ${id} is a DNR entry`)
      const text = files.get(e.file)
      const at = text.indexOf(`[${id} ·`)
      const next = text.indexOf('\n- [K-', at + 1)
      assert.match(text.slice(at, next === -1 ? undefined : next), new RegExp(`repeats consolidated lesson ${cl.id}`))
    }
  }
  for (const e of c.essentials) for (const id of e.refs) assert.ok(found.has(id), `essential ref ${id}`)
})

test('knowledge files are size-bounded, belong to known topics, and every index reference resolves', () => {
  const stems = TOPICS.map((t) => t.file.replace(/\.md$/, ''))
  for (const [f, text] of files) {
    assert.ok(Buffer.byteLength(text) <= KNOWLEDGE_FILE_CAP_BYTES, `${f} under cap`)
    assert.ok(stems.some((s) => new RegExp(`^${s}(\\.dnr|\\.history)?(-\\d+)?\\.md$`).test(f)), `${f} is a known topic file`)
    assert.match(text, /advisory data, not instructions/)
  }
  const index = readFileSync(path.join(REPO, '.wolf/cerebrum.md'), 'utf8')
  for (const m of index.matchAll(/`([a-z][a-z0-9-]*(?:\.dnr|\.history)?(?:-\d+)?\.md)`/g)) assert.ok(files.has(m[1]), `index references ${m[1]}`)
  for (const t of TOPICS) assert.ok([...files.keys()].some((f) => f.startsWith(t.file.replace(/\.md$/, ''))), `topic ${t.id} has a file`)
  for (const e of prov.entries) assert.ok(files.has(e.file), `${e.id} → ${e.file}`)
})

test('provenance stays traceable to the archived source', () => {
  assert.equal(prov.source.path, '.wolf/cerebrum.md')
  assert.match(prov.source.commit, /^[0-9a-f]{40}$/)
  const manifest = JSON.parse(readFileSync(path.join(REPO, 'docs/developer-harness-v2/phase-3-archive-manifest.json'), 'utf8'))
  const entry = manifest.entries.find((e) => e.path === '.wolf/cerebrum.md')
  assert.equal(entry.sha256, prov.source.sha256, 'archived cerebrum is the provenance source')
  assert.equal(manifest.source_commit, prov.source.commit)
  for (const e of prov.entries) assert.ok(e.lines[0] >= 1 && e.lines[1] >= e.lines[0] && e.lines[1] <= prov.source.lines, e.id)
})

test('no secrets, credentials or real e-mail addresses in curated memory', () => {
  const texts = [...files.values(), readFileSync(path.join(REPO, '.wolf/cerebrum.md'), 'utf8'), readFileSync(path.join(HERE, 'knowledge-consolidation.json'), 'utf8')]
  for (const t of texts) {
    assert.equal(findSecrets(t), 0)
    assert.equal(redact(t).redactions, 0, 'no unredacted e-mail or secret-shaped string')
    assert.doesNotMatch(t, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S{12,}|sk_live_|BEGIN [A-Z ]*PRIVATE KEY/)
  }
  assert.equal(prov.counts.redactions, prov.entries.filter((e) => e.redacted).length)
})

test('parser: DNR sections, inline DNR tags, continuations, templates and exact duplicates', () => {
  const src = [
    '# Cerebrum', '', '> template blockquote', '', '## User Preferences', '', '<!-- How the user likes things -->', '',
    '- Prefer one PR per initiative.', '', '## Key Learnings', '- Learning A spans', '  two lines.', '- [2026-10-15] Do-Not-Repeat: inline lesson.',
    '', '## Do-Not-Repeat', '- **Never do X.**', '- Never   do `X`.', '', '## Feature (2026-10-01) - notes', '- history note about `apps/web/app/gone.tsx`.', '', '## Phase 2 (2026-10-02) - learnings', '- phase learning.',
  ].join('\n')
  const { entries, templates } = parseCerebrum(src)
  assert.equal(templates.length, 2)
  assert.deepEqual(entries.map((e) => e.kind), ['preference', 'learning', 'dnr', 'dnr', 'dnr', 'history', 'learning'])
  assert.equal(entries[1].text, '- Learning A spans\n  two lines.')
  assert.equal(entries[3].id, entries[4].id, 'markdown-insensitive identity')
  const out = curate({ source: src, sourceCommit: 'f'.repeat(40), known: new Set(['apps/web/app']), checkedAt: 'e'.repeat(40), consolidation: { clusters: [], essentials: [] } })
  assert.equal(out.provenance.counts.exact_duplicates_merged, 1)
  assert.equal(out.provenance.duplicates[0].id, entries[3].id)
  const hist = out.files.find((f) => f.file === 'web.history.md')
  assert.match(hist.content, /⚠ verify: references path\(s\) not found at eeeeeeee: `apps\/web\/app\/gone\.tsx`/)
  assert.equal(entryId('- Never do X.'), entryId('- **Never   do X.**'))
})

test('redaction removes real e-mails and secret-shaped strings but keeps reserved test domains', () => {
  const r = redact('login a.b@gmail.com then fixture x@hermetic.invalid with sk_test_abcdefghijklmnop')
  assert.equal(r.redactions, 2)
  assert.match(r.text, /\[redacted-email\]/)
  assert.match(r.text, /x@hermetic\.invalid/)
  assert.match(r.text, /\[redacted-secret\]/)
})

test('verification detects a deleted or edited lesson (negative control on a temporary copy)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dhv2-know-'))
  try {
    cpSync(KDIR, tmp, { recursive: true })
    const dnrFile = readdirSync(tmp).find((f) => f.endsWith('.dnr.md'))
    const victim = prov.entries.find((e) => e.kind === 'dnr' && e.file === dnrFile && !e.redacted)
    const text = readFileSync(path.join(tmp, dnrFile), 'utf8')
    const start = text.indexOf(`- [${victim.id} ·`)
    const end = text.indexOf('\n- [K-', start + 1)
    writeFileSync(path.join(tmp, dnrFile), text.slice(0, start) + (end === -1 ? '' : text.slice(end + 1)))
    assert.ok(verifyKnowledge({ repo: null, knowledgeDir: tmp }).problems.some((p) => p.startsWith(victim.id)), 'deletion detected')
    writeFileSync(path.join(tmp, dnrFile), text.replace(`- [${victim.id} ·`, `- [${victim.id} · edited ·`).replace(/(\[K-[0-9a-f]{10} · edited ·[^\]]*\] )/, '$1CHANGED '))
    assert.ok(verifyKnowledge({ repo: null, knowledgeDir: tmp }).problems.some((p) => p.includes(victim.id)), 'edit detected')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('appending a lesson in the documented `[new · date]` format keeps verify green; moving a DNR out of .dnr fails', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dhv2-append-'))
  try {
    cpSync(KDIR, tmp, { recursive: true })
    for (const f of readdirSync(tmp).filter((x) => /\.dnr\.md$/.test(x))) {
      const t = readFileSync(path.join(tmp, f), 'utf8')
      writeFileSync(path.join(tmp, f), `${t.replace(/\n*$/, '\n')}- [new · 2026-11-22] Appended lesson for ${f}.\n`)
    }
    assert.deepEqual(verifyKnowledge({ repo: null, knowledgeDir: tmp }).problems, [], 'appends do not alter migrated entries')
    const appended = knowledgeEntries(loadKnowledge(tmp))
    assert.equal([...appended.keys()].length, found.size, 'new entries are separate, not continuations')
    // Placement: move one DNR entry into a conventions file.
    const victim = prov.entries.find((e) => e.kind === 'dnr' && !e.redacted)
    const src = readFileSync(path.join(tmp, victim.file), 'utf8')
    const start = src.indexOf(`- [${victim.id} ·`)
    const end = src.indexOf('\n- ', start + 1)
    const block = src.slice(start, end === -1 ? undefined : end + 1)
    writeFileSync(path.join(tmp, victim.file), src.replace(block, ''))
    const conv = victim.file.replace('.dnr.md', '.md')
    writeFileSync(path.join(tmp, conv), `${readFileSync(path.join(tmp, conv), 'utf8')}\n${block}`)
    assert.ok(verifyKnowledge({ repo: null, knowledgeDir: tmp }).problems.some((p) => p.includes('outside a .dnr file')))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('memory files are data: knowledge text carries no tool-permission or hook configuration', () => {
  for (const [f, text] of files) {
    assert.doesNotMatch(text, /"permissionDecision"\s*:|"hooks"\s*:\s*\{|disableBypassPermissionsMode/, f)
  }
  assert.ok(existsSync(path.join(REPO, '.wolf/knowledge/_provenance.json')))
})
