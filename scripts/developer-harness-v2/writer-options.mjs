// Developer Harness V2 — file-writer option parsing (Phase 4 path-resolution remediation). Pure, never executes anything.
// Extracted from file-command-policy.mjs (500-line limit): tool-aware operand/option parsing for rm / touch / mkdir /
// New-Item / Remove-Item / Set-Content and friends, so a flag that takes no value never swallows an operand.
const wordOf = (w, text) => ({ ...w, text })
// ── Option tables and parser ──
// Value-taking options are tool specific. A flag that does NOT take a value must never swallow the next word (`rm -f a b`
// has two operands, not one): an unknown or ambiguous option is a switch, so its neighbour is classified as a path
// (over-classification, never under-classification).
export const POSIX_VALUED = {
  touch: ['-t', '-d', '-r', '--date', '--reference'], mkdir: ['-m', '--mode'], md: ['-m', '--mode'], truncate: ['-s', '-r', '--size', '--reference'],
  shred: ['-n', '-s', '--iterations', '--size'], ln: ['-t', '-S', '--target-directory', '--suffix'],
}
export const LEGACY_VALUED = new Set(['-Path', '-LiteralPath', '-Destination', '-Value', '-Encoding', '-ItemType', '-Name', '-NewName', '-Target', '-Filter', '-Include', '-Exclude', '-t', '-m', '--target-directory', '-S', '--suffix', '-e', '-f', '-o'])
const PS_COMMON_VALUED = ['erroraction', 'errorvariable', 'warningaction', 'warningvariable', 'informationaction', 'informationvariable', 'outvariable', 'outbuffer', 'pipelinevariable', 'progressaction']
const PS_COMMON_SWITCH = ['verbose', 'debug']
export const PS_FAMILIES = {
  create: { valued: ['path', 'name', 'itemtype', 'type', 'value', 'credential'], switches: ['force', 'whatif', 'confirm', 'usetransaction'], pathLike: ['path'] },
  remove: { valued: ['path', 'literalpath', 'filter', 'include', 'exclude', 'credential', 'stream'], switches: ['recurse', 'force', 'whatif', 'confirm', 'usetransaction'], pathLike: ['path', 'literalpath'] },
  content: { valued: ['path', 'literalpath', 'value', 'filter', 'include', 'exclude', 'encoding', 'credential', 'stream'], switches: ['force', 'nonewline', 'passthru', 'whatif', 'confirm', 'usetransaction', 'asbytestream'], pathLike: ['path', 'literalpath'] },
  outfile: { valued: ['filepath', 'literalpath', 'path', 'encoding', 'inputobject', 'width', 'variable'], switches: ['append', 'force', 'noclobber', 'nonewline', 'whatif', 'confirm'], pathLike: ['filepath', 'literalpath', 'path'] },
}
export const PS_FAMILY_OF = {
  'new-item': 'create', ni: 'create', mkdir: 'create', md: 'create', 'remove-item': 'remove', ri: 'remove', rm: 'remove', del: 'remove', erase: 'remove', rd: 'remove', rmdir: 'remove',
  'set-content': 'content', sc: 'content', 'add-content': 'content', ac: 'content', 'clear-content': 'content', clc: 'content', 'out-file': 'outfile', 'tee-object': 'outfile',
}
export const PS_ONLY_WRITERS = new Set(['new-item', 'ni', 'remove-item', 'ri', 'set-content', 'sc', 'add-content', 'ac', 'clear-content', 'clc', 'out-file', 'tee-object'])

/** PowerShell parameter name (case-insensitive, unique-prefix abbreviations allowed) → { name, valued } or null when unknown/ambiguous. */
function psParam(family, raw) {
  const n = raw.toLowerCase()
  if (!n) return null
  const valued = [...family.valued, ...PS_COMMON_VALUED], switches = [...family.switches, ...PS_COMMON_SWITCH]
  if (valued.includes(n)) return { name: n, valued: true }
  if (switches.includes(n)) return { name: n, valued: false }
  const hits = [...valued.filter((v) => v.startsWith(n)).map((name) => ({ name, valued: true })), ...switches.filter((s) => s.startsWith(n)).map((name) => ({ name, valued: false }))]
  return hits.length === 1 ? hits[0] : null
}

/** A PowerShell argument `a,b` is an ARRAY: the whole text and every element are operands. */
function psList(w) {
  if (!w.text.includes(',')) return [w]
  return [w, ...w.text.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean).map((x) => wordOf(w, x))]
}

/** Parse the words of a PowerShell file writer: explicit path parameters, `-Name`, `-Value`, and positional paths. */
export function parsePsWriter(words, family) {
  const targets = [], names = []
  let value, itemType
  for (let i = 1; i < words.length; i++) {
    const w = words[i], t = w.text
    const m = /^[-–—―]([A-Za-z]+)(?::([\s\S]*))?$/.exec(t) // en/em dash and horizontal bar bind like `-`
    if (!m) { targets.push(...psList(w)); continue }
    const p = psParam(family, m[1])
    if (!p || !p.valued) continue
    const inline = m[2] !== undefined && m[2] !== '' ? wordOf(w, m[2]) : null
    const v = inline ?? words[++i] ?? null
    if (!v) continue
    if (p.name === 'name') names.push(...psList(v))
    else if (p.name === 'value') value = v.text
    else if (p.name === 'itemtype' || p.name === 'type') itemType = v.text.trim().replace(/^["']|["']$/g, '')
    else if (family.pathLike.includes(p.name)) targets.push(...psList(v))
    // other valued parameters (-ItemType, -Encoding, -Filter, -Include, -Exclude …) carry no path that is written
  }
  return { targets, names, value, itemType }
}
