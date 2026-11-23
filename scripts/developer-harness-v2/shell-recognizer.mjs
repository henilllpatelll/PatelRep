// Developer Harness V2 — bounded shell recognizer (Phase 2).
//
// This is NOT a shell parser. It tokenizes a command line into simple commands (words, leading assignments,
// redirects, heredoc bodies) and records every construct it does not fully understand as a `feature`, so the
// policy layer can escalate instead of guessing. It never executes anything.
//
// Dialects: 'posix' (bash/sh, Claude Code's Bash tool), 'powershell' (PowerShell tool, -Command bodies) and
// 'cmd' (cmd.exe /c bodies). Quoting, escapes, separators and substitutions differ per dialect; anything
// ambiguous is flagged, never silently dropped.

export const MAX_INPUT_LENGTH = 200_000

const SEPARATOR_OPS = new Set(['&&', '||', ';', '|', '|&', '&', '\n', '(', ')', '{', '}'])

/**
 * @typedef {{ text: string, dynamic: boolean, glob: boolean, quoted: boolean, vars: string[] }} Word
 * @typedef {{ op: string, target: Word | null }} Redirect
 * @typedef {{ words: Word[], assignments: { name: string, value: Word }[], redirects: Redirect[], heredocs: string[] }} SimpleCommand
 * @typedef {{ ok: true, commands: SimpleCommand[], substitutions: string[], features: Set<string> } | { ok: false, reason: string }} ParseResult
 */

/** @returns {ParseResult} */
export function parseShell(input, { dialect = 'posix', backslashEscapes = dialect === 'posix' } = {}) {
  if (typeof input !== 'string') return { ok: false, reason: 'not_a_string' }
  if (input.length > MAX_INPUT_LENGTH) return { ok: false, reason: 'too_long' }
  const p = new Parser(input.replace(/\r\n?/g, '\n'), dialect, backslashEscapes)
  try {
    p.run()
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, reason: error.message }
    throw error
  }
  return { ok: true, commands: p.commands, substitutions: p.substitutions, features: p.features }
}

class ParseError extends Error {}

class Parser {
  constructor(src, dialect, backslashEscapes) {
    this.src = src
    this.i = 0
    this.dialect = dialect
    this.bs = backslashEscapes
    this.commands = []
    this.substitutions = []
    this.features = new Set()
    this.pendingHeredocs = [] // { delimiter, strip, command }
    this.newCommand()
  }

  newCommand() {
    this.cmd = { words: [], assignments: [], redirects: [], heredocs: [] }
    this.pendingRedirect = null
  }

  flushCommand() {
    if (this.pendingRedirect) throw new ParseError('redirect_without_target')
    const c = this.cmd
    if (c.words.length || c.assignments.length || c.redirects.length) this.commands.push(c)
    this.newCommand()
  }

  run() {
    const { src } = this
    while (this.i < src.length) {
      const ch = src[this.i]
      if (ch === ' ' || ch === '\t') { this.i++; continue }
      if (ch === '\n') { this.i++; this.flushCommand(); this.readPendingHeredocs(); continue }
      if (ch === '#' && this.dialect !== 'cmd') {
        if (this.dialect === 'powershell' && src[this.i + 1] === '>') { this.features.add('powershell_redirect_stream') }
        while (this.i < src.length && src[this.i] !== '\n') this.i++
        continue
      }
      if (this.dialect === 'powershell' && src.startsWith('<#', this.i)) throw new ParseError('powershell_block_comment')
      const op = this.readOperator()
      if (op) { this.handleOperator(op); continue }
      const word = this.readWord()
      this.addWord(word)
    }
    this.flushCommand()
    if (this.pendingHeredocs.length) this.features.add('heredoc_unterminated')
  }

  handleOperator(op) {
    if (op.kind === 'sep') {
      if (op.value === '&' && this.dialect === 'powershell' && this.cmd.words.length === 0) {
        this.features.add('call_operator') // PowerShell `& cmd args`
        return
      }
      if (op.value === '(' || op.value === ')') this.features.add('subshell_or_group')
      if (op.value === '{' || op.value === '}') this.features.add('block')
      if (op.value === '&') this.features.add('background')
      if (op.value === '|' || op.value === '|&') this.cmd.pipesOut = true
      this.flushCommand()
      return
    }
    if (op.kind === 'heredoc') {
      const word = this.readWord()
      if (!word || !word.text) throw new ParseError('heredoc_without_delimiter')
      this.features.add('heredoc')
      this.pendingHeredocs.push({ delimiter: word.text, strip: op.value === '<<-', command: this.cmd })
      return
    }
    if (op.kind === 'redirect') {
      if (op.value.endsWith('&') && /^\d$/.test(this.src[this.i] ?? '')) { // fd duplication like 2>&1
        while (/\d/.test(this.src[this.i] ?? '')) this.i++
        if (this.src[this.i] === '-') this.i++
        return
      }
      if (op.value === '<<<') this.features.add('herestring')
      this.pendingRedirect = { op: op.value }
    }
  }

  addWord(word) {
    if (this.pendingRedirect) {
      this.cmd.redirects.push({ op: this.pendingRedirect.op, target: word })
      this.pendingRedirect = null
      return
    }
    const assignment = this.dialect === 'posix' && this.cmd.words.length === 0 && /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(word.rawPrefix ?? '')
    if (assignment) {
      const value = { ...word, text: word.text.slice(assignment[1].length + 1) }
      this.cmd.assignments.push({ name: assignment[1], value })
      return
    }
    if (word.text === '{' || word.text === '}') {
      if (!word.quoted) { this.features.add('block'); this.flushCommand(); return }
    }
    this.cmd.words.push(word)
  }

  readOperator() {
    const { src, i, dialect } = this
    const two = src.slice(i, i + 2)
    const three = src.slice(i, i + 3)
    const at = (s) => src.startsWith(s, i)
    // Redirections (optionally preceded by a single fd digit or * in PowerShell).
    const redirectMatch = /^(\d|\*|&)?(>>|>\||>&|>|<<<|<<-|<<|<>|<&|<)/.exec(src.slice(i, i + 5))
    if (redirectMatch && (redirectMatch[1] === undefined || this.atWordBoundary())) {
      const [whole, prefix, sym] = redirectMatch
      if (sym === '<' && src[i + 1] === '(' && dialect === 'posix') return null // process substitution handled in readWord
      if ((sym === '>' || sym === '>>') && src[i + whole.length] === '(' && dialect === 'posix') return null
      if (dialect === 'cmd' && (sym === '<<' || sym === '<<-' || sym === '<<<')) throw new ParseError('cmd_unsupported_redirect')
      if (dialect === 'powershell' && (sym === '<<' || sym === '<<-' || sym === '<<<' || sym === '<')) {
        throw new ParseError('powershell_unsupported_redirect')
      }
      this.i += whole.length
      if (sym === '<<' || sym === '<<-') return { kind: 'heredoc', value: sym }
      return { kind: 'redirect', value: (prefix ?? '') + sym }
    }
    if (three === ';;&' || two === ';;' || two === ';&') throw new ParseError('case_terminator')
    for (const candidate of ['&&', '||', '|&']) {
      if (two === candidate) {
        if (candidate === '|&' && dialect !== 'posix') break
        this.i += 2
        return { kind: 'sep', value: candidate }
      }
    }
    const ch = src[i]
    if (ch === ';' || ch === '|' || ch === '&') { this.i++; return { kind: 'sep', value: ch } }
    if (ch === '(' || ch === ')') { this.i++; return { kind: 'sep', value: ch } }
    if (dialect === 'powershell' && (ch === '{' || ch === '}')) { this.i++; return { kind: 'sep', value: ch } }
    if (at('`n')) return null
    return null
  }

  atWordBoundary() {
    const prev = this.src[this.i - 1]
    return this.i === 0 || prev === ' ' || prev === '\t' || prev === '\n' || prev === ';' || prev === '|' || prev === '&' || prev === '('
  }

  readWord() {
    const { src, dialect } = this
    let text = ''
    let rawPrefix = ''
    let dynamic = false
    let glob = false
    let quoted = false
    const vars = []
    const stop = (c) => c === undefined || c === ' ' || c === '\t' || c === '\n' || c === ';' || c === '|' || c === '&' ||
      c === '(' || c === ')' || c === '<' || c === '>' || (dialect === 'powershell' && (c === '{' || c === '}'))
    let unquotedPrefixOpen = true
    while (this.i < src.length && !stop(src[this.i])) {
      const ch = src[this.i]
      if (ch === "'" && dialect !== 'cmd') {
        quoted = true
        unquotedPrefixOpen = false
        const end = this.findSingleQuoteEnd(this.i + 1)
        text += src.slice(this.i + 1, end).replace(/''/g, dialect === 'powershell' ? "'" : "''")
        this.i = end + 1
        continue
      }
      if (ch === '"') {
        quoted = true
        unquotedPrefixOpen = false
        const r = this.readDoubleQuoted(this.i + 1)
        text += r.text
        dynamic ||= r.dynamic
        vars.push(...r.vars)
        this.i = r.end + 1
        continue
      }
      if (ch === '\\' && this.bs) {
        if (src[this.i + 1] === '\n') { this.i += 2; continue }
        if (this.i + 1 >= src.length) throw new ParseError('trailing_escape')
        text += src[this.i + 1]
        if (unquotedPrefixOpen) rawPrefix += src[this.i + 1]
        this.i += 2
        continue
      }
      if (ch === '`' && dialect === 'powershell') {
        if (this.i + 1 >= src.length) throw new ParseError('trailing_escape')
        if (src[this.i + 1] !== '\n') text += src[this.i + 1]
        this.i += 2
        continue
      }
      if (ch === '^' && dialect === 'cmd') {
        if (this.i + 1 < src.length && src[this.i + 1] !== '\n') text += src[this.i + 1]
        this.i += 2
        continue
      }
      if (ch === '`' && dialect === 'posix') {
        const end = this.findBacktickEnd(this.i + 1)
        this.substitutions.push(src.slice(this.i + 1, end))
        this.features.add('substitution')
        dynamic = true
        unquotedPrefixOpen = false
        this.i = end + 1
        continue
      }
      if ((ch === '$' || (ch === '@' && dialect === 'powershell')) && dialect !== 'cmd') {
        const r = this.readDollar(this.i)
        if (r) {
          text += r.text
          dynamic ||= r.dynamic
          if (r.var) vars.push(r.var)
          unquotedPrefixOpen = false
          this.i = r.end
          continue
        }
      }
      if (ch === '%' && dialect === 'cmd') {
        const end = src.indexOf('%', this.i + 1)
        if (end > this.i + 1 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(src.slice(this.i + 1, end))) {
          vars.push(src.slice(this.i + 1, end))
          dynamic = true
          text += src.slice(this.i, end + 1)
          this.i = end + 1
          continue
        }
      }
      if (ch === '*' || ch === '?' || ch === '[') glob = true
      text += ch
      if (unquotedPrefixOpen) rawPrefix += ch
      this.i++
    }
    if (this.i < src.length && dialect === 'posix' && (src[this.i] === '<' || src[this.i] === '>') && src[this.i + 1] === '(') {
      const end = this.findParenEnd(this.i + 2)
      this.substitutions.push(src.slice(this.i + 2, end))
      this.features.add('process_substitution')
      this.i = end + 1
      return { text: text + '<process-substitution>', rawPrefix, dynamic: true, glob, quoted, vars }
    }
    return { text, rawPrefix, dynamic, glob, quoted, vars }
  }

  readDollar(start) {
    const { src, dialect } = this
    const next = src[start + 1]
    if (next === '(') {
      if (src[start + 2] === '(' && dialect === 'posix') { // arithmetic $(( ))
        const end = this.findParenEnd(start + 3)
        if (src[end + 1] !== ')') throw new ParseError('unterminated_arithmetic')
        this.features.add('arithmetic')
        return { text: '<arith>', dynamic: true, end: end + 2 }
      }
      const end = this.findParenEnd(start + 2)
      this.substitutions.push(src.slice(start + 2, end))
      this.features.add('substitution')
      return { text: '<substitution>', dynamic: true, end: end + 1 }
    }
    if (src[start] === '@') return null
    if (next === '{') {
      const end = src.indexOf('}', start + 2)
      if (end < 0) throw new ParseError('unterminated_parameter_expansion')
      const name = src.slice(start + 2, end).replace(/^env:/i, '')
      if (/[^A-Za-z0-9_:#%\/\-?+=.@*!]/.test(name)) this.features.add('complex_parameter_expansion')
      return { text: '<var>', dynamic: true, var: name.replace(/[^A-Za-z0-9_].*$/, ''), end: end + 1 }
    }
    if (next === "'" && dialect === 'posix') { // ANSI-C quoting: may hide arbitrary text.
      const end = this.findSingleQuoteEnd(start + 2)
      this.features.add('ansi_c_quote')
      return { text: '<ansi-c>', dynamic: true, end: end + 1 }
    }
    const m = /^\$(env:)?([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/i.exec(src.slice(start, start + 200))
    if (!m) return null
    return { text: '<var>', dynamic: true, var: m[2], end: start + m[0].length }
  }

  readDoubleQuoted(start) {
    const { src, dialect } = this
    let text = ''
    let dynamic = false
    const vars = []
    let i = start
    while (i < src.length) {
      const ch = src[i]
      if (ch === '"') {
        if (dialect === 'powershell' && src[i + 1] === '"') { text += '"'; i += 2; continue }
        return { text, dynamic, vars, end: i }
      }
      if (ch === '\\' && dialect === 'posix' && this.bs && '"\\$`\n'.includes(src[i + 1])) {
        if (src[i + 1] !== '\n') text += src[i + 1]
        i += 2
        continue
      }
      if (ch === '`' && dialect === 'powershell') { text += src[i + 1] ?? ''; i += 2; continue }
      if (ch === '`' && dialect === 'posix') {
        const end = this.findBacktickEnd(i + 1)
        this.substitutions.push(src.slice(i + 1, end))
        this.features.add('substitution')
        dynamic = true
        i = end + 1
        continue
      }
      if (ch === '$' && dialect !== 'cmd') {
        const r = this.readDollar(i)
        if (r) { text += r.text; dynamic ||= r.dynamic; if (r.var) vars.push(r.var); i = r.end; continue }
      }
      if (ch === '%' && dialect === 'cmd') {
        const end = src.indexOf('%', i + 1)
        if (end > i + 1 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(src.slice(i + 1, end))) {
          vars.push(src.slice(i + 1, end)); dynamic = true; text += src.slice(i, end + 1); i = end + 1; continue
        }
      }
      text += ch
      i++
    }
    throw new ParseError('unterminated_double_quote')
  }

  findSingleQuoteEnd(from) {
    const { src, dialect } = this
    let i = from
    while (i < src.length) {
      if (src[i] === "'") {
        if (dialect === 'powershell' && src[i + 1] === "'") { i += 2; continue }
        return i
      }
      i++
    }
    throw new ParseError('unterminated_single_quote')
  }

  findBacktickEnd(from) {
    for (let i = from; i < this.src.length; i++) {
      if (this.src[i] === '\\') { i++; continue }
      if (this.src[i] === '`') return i
    }
    throw new ParseError('unterminated_backtick')
  }

  /** Index of the `)` matching an already-consumed `(`, honouring quotes and nesting. */
  findParenEnd(from) {
    const { src } = this
    let depth = 1
    for (let i = from; i < src.length; i++) {
      const ch = src[i]
      if (ch === '\\' && this.dialect === 'posix') { i++; continue }
      if (ch === '`' && this.dialect === 'powershell') { i++; continue }
      if (ch === "'") { i = this.findSingleQuoteEnd(i + 1); continue }
      if (ch === '"') { i = this.skipDoubleQuoted(i + 1); continue }
      if (ch === '(') depth++
      if (ch === ')' && --depth === 0) return i
    }
    throw new ParseError('unterminated_parenthesis')
  }

  skipDoubleQuoted(from) {
    for (let i = from; i < this.src.length; i++) {
      const ch = this.src[i]
      if ((ch === '\\' && this.dialect === 'posix') || (ch === '`' && this.dialect === 'powershell')) { i++; continue }
      if (ch === '$' && this.src[i + 1] === '(') { i = this.findParenEnd(i + 2); continue }
      if (ch === '"') return i
    }
    throw new ParseError('unterminated_double_quote')
  }

  readPendingHeredocs() {
    const { src } = this
    while (this.pendingHeredocs.length) {
      const h = this.pendingHeredocs.shift()
      const lines = []
      let terminated = false
      while (this.i < src.length) {
        let end = src.indexOf('\n', this.i)
        if (end < 0) end = src.length
        const line = src.slice(this.i, end)
        this.i = Math.min(end + 1, src.length)
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delimiter) { terminated = true; break }
        lines.push(line)
      }
      if (!terminated) this.features.add('heredoc_unterminated')
      h.command.heredocs.push(lines.join('\n'))
    }
  }
}

export const isSeparatorOp = (op) => SEPARATOR_OPS.has(op)
