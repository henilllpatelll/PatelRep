// Developer Harness V2 — trusted CI preparation: make every reviewed commit named by a pinned trusted execution resolvable BEFORE the tests run.
// The shipped-pins provenance test used to fetch from `origin` itself (a network access inside a test whose tier declares none). The fetch now lives here, in an
// explicit workflow step; the test only READS git objects. Fail-closed: a pin whose commit cannot be resolved (or whose closure digests do not match) fails this step.
// It fetches exactly the pinned full sha (verifyPinProvenance validates the sha format and refuses option-like remotes) and verifies content by digest afterwards.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyPinProvenance } from '../bypass-pins.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const doc = JSON.parse(readFileSync(path.join(REPO, 'docs/developer-harness-v2/bypass-scopes.json'), 'utf8'))
let failed = 0; let n = 0
for (const s of doc.scopes) for (const e of s.trusted_executions) {
  n += 1; const r = verifyPinProvenance(REPO, e, { fetchIfShallow: true })
  process.stdout.write(`${r.ok ? 'ok  ' : 'FAIL'} ${s.id}/${e.id} ${e.reviewed_source?.ref ?? '(no ref)'} ${r.ok ? `files=${r.files}` : r.problems.join(',')}\n`)
  if (!r.ok) failed += 1
}
if (n === 0) { process.stderr.write('no trusted executions found\n'); process.exit(1) }
process.exit(failed ? 1 : 0)
