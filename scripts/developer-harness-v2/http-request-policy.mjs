// Developer Harness V2 — generic HTTP client request classification (Phase 2 remediation). Pure: never sends.
//
// Extracts method, targets, headers and body from curl / wget / httpie / xh / Invoke-WebRequest / Invoke-RestMethod
// and classifies the request by EFFECT. A mutating request that reaches (or may reach) the GitHub API is classified
// by github-api-policy exactly like `gh api`; a mutating request whose target cannot be determined (computed URL,
// config file, splatted parameters, header file) is denied, because it could be a forbidden GitHub operation.
import { F, splitFlag } from './policy-common.mjs'
import { parseTarget, isGithubHost, looksLikeGithubApiPath, isReadMethod, classifyRestMutation, classifyGraphql } from './github-api-policy.mjs'

export const HTTP_CLIENTS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'xhs', 'httpie', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'])

const METHOD_WORD = /^(get|post|put|patch|delete|head|options)$/i
const emptyRequest = () => ({ urls: [], method: null, methodDynamic: false, bodies: [], items: null, opaqueBody: false, headers: [], opaqueTarget: false, requestTarget: null })

// ── curl ──────────────────────────────────────────────────────────────────────────────────────────────────
const CURL_BODY = new Set(['-d', '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json'])
const CURL_FORM = new Set(['-F', '--form', '--form-string'])
const CURL_VALUE = new Set(['-X', '--request', ...CURL_BODY, ...CURL_FORM, '-T', '--upload-file', '-H', '--header', '-u', '--user', '-o', '--output',
  '-K', '--config', '--url', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-w', '--write-out', '--connect-to',
  '--resolve', '-x', '--proxy', '--oauth2-bearer', '-m', '--max-time', '--connect-timeout', '--retry', '-r', '--range', '-E', '--cert', '--key',
  '--cacert', '-U', '--proxy-user', '-z', '--time-cond', '--limit-rate', '-C', '--continue-at', '-D', '--dump-header', '--trace', '--trace-ascii',
  '--stderr', '--interface', '--variable', '--request-target', '--unix-socket', '--aws-sigv4', '--max-redirs', '--retry-delay', '--retry-max-time',
  '--doh-url', '--proto', '--noproxy', '--proxy-header', '--url-query', '--netrc-file', '--output-dir', '--max-filesize', '--keepalive-time'])

function curlRequest(words) {
  const req = emptyRequest()
  const take = (flag, value, word) => {
    if (flag === '-X' || flag === '--request') { if (word?.dynamic) req.methodDynamic = true; else req.explicitMethod = String(value ?? '').toUpperCase() }
    else if (CURL_BODY.has(flag)) {
      req.bodies.push(value ?? '')
      const fileRef = flag === '--data-raw' ? false : flag === '--data-urlencode' ? /^[^=]*@/.test(value ?? '') : /^@/.test(value ?? '')
      if (fileRef || word?.dynamic) req.opaqueBody = true
      if (flag === '--json') req.implied ??= 'POST'
    } else if (CURL_FORM.has(flag)) { req.bodies.push(value ?? ''); if ((flag !== '--form-string' && /=[@<]/.test(value ?? '')) || word?.dynamic) req.opaqueBody = true }
    else if (flag === '-T' || flag === '--upload-file') { req.opaqueBody = true; req.implied ??= 'PUT' }
    else if (flag === '-H' || flag === '--header' || flag === '--proxy-header') { if (/^@/.test(value ?? '') || word?.dynamic) req.opaqueTarget = true; else req.headers.push(value ?? '') }
    else if (flag === '-K' || flag === '--config' || flag === '--variable') { req.opaqueTarget = true; req.opaqueBody = true; req.methodDynamic = true }
    else if (flag === '--url') req.urls.push({ text: value ?? '', dynamic: Boolean(word?.dynamic) })
    else if (flag === '--request-target') { if (word?.dynamic) req.opaqueTarget = true; else req.requestTarget = value ?? '' }
  }
  for (let i = 1; i < words.length; i++) {
    const t = words[i].text
    if (t === '--') { for (const w of words.slice(i + 1)) req.urls.push({ text: w.text, dynamic: w.dynamic }); break }
    // --expand-*: values come from variables/files. --next / -: start a new request whose own -X/-G/-I/data would be
    // conflated with this one, so the per-request method cannot be verified.
    if (/^--expand-/.test(t) || t === '--next' || t === '-:') { req.opaqueTarget = true; req.opaqueBody = true; req.methodDynamic = true; continue }
    if (t === '-G' || t === '--get') { req.forcedGet = true; continue }
    if (t === '-I' || t === '--head') { req.head = true; continue }
    if (t.startsWith('--')) {
      const [flag, value] = splitFlag(t)
      if (CURL_VALUE.has(flag)) { if (value !== null) take(flag, value, words[i]); else { take(flag, words[i + 1]?.text, words[i + 1]); i++ } }
      continue
    }
    if (t.startsWith('-') && t.length > 1) {
      // Short-option cluster: the first value-taking letter consumes the rest of the word or the next word.
      for (let j = 1; j < t.length; j++) {
        // `:` inside a cluster (`-s:`) is `--next`: a new request with its own method → unverifiable.
        if (t[j] === ':') { req.opaqueTarget = true; req.opaqueBody = true; req.methodDynamic = true; continue }
        const flag = `-${t[j]}`
        if (!CURL_VALUE.has(flag)) { if (flag === '-G') req.forcedGet = true; else if (flag === '-I') req.head = true; continue }
        const rest = t.slice(j + 1)
        if (rest) take(flag, rest, words[i])
        else { take(flag, words[i + 1]?.text, words[i + 1]); i++ }
        break
      }
      continue
    }
    req.urls.push({ text: t, dynamic: words[i].dynamic })
  }
  // An explicit -X/--request always decides the method (curl sends `-X PUT -G` / `-X PUT -I` as PUT); -G/-I only
  // apply without one. With -G, data moves to the URL query, so it is no longer a body.
  req.method = req.explicitMethod ?? (req.forcedGet ? 'GET' : req.head ? 'HEAD' : req.implied ?? null)
  if (req.forcedGet && !req.explicitMethod) { req.bodies = []; req.opaqueBody = false }
  return req
}

// ── wget ──────────────────────────────────────────────────────────────────────────────────────────────────
const WGET_VALUE = new Set(['-O', '--output-document', '-o', '--output-file', '-a', '--append-output', '-P', '--directory-prefix', '-U', '--user-agent',
  '-t', '--tries', '-T', '--timeout', '-w', '--wait', '-Q', '--quota', '--user', '--password', '--http-user', '--http-password', '--header',
  '--method', '--post-data', '--post-file', '--body-data', '--body-file', '-i', '--input-file', '-e', '--execute', '--config', '-B', '--base',
  '--referer', '--load-cookies', '--save-cookies', '--ca-certificate', '--certificate', '--private-key', '-l', '--level', '-D', '--domains'])

const WGET_REQUEST_SHAPING = ['--method', '--post-data', '--post-file', '--body-data', '--body-file', '--header', '--input-file', '--execute',
  '--config', '--base', '--user', '--password', '--http-user', '--http-password']

function wgetRequest(words) {
  const req = emptyRequest()
  for (let i = 1; i < words.length; i++) {
    const t = words[i].text
    if (!t.startsWith('-') || t === '-') { req.urls.push({ text: t, dynamic: words[i].dynamic }); continue }
    let [flag, value] = splitFlag(t)
    let word = words[i]
    if (!flag.startsWith('--') && flag.length > 2) { value = flag.slice(2); flag = flag.slice(0, 2) }
    // getopt_long accepts unique prefixes (`--meth=PUT`, `--post-d=x`): an abbreviation of any request-shaping option
    // makes the request unverifiable (fail closed) instead of being skipped as an unknown flag.
    if (!WGET_VALUE.has(flag) && flag.startsWith('--') && flag.length >= 4 && WGET_REQUEST_SHAPING.some((o) => o.startsWith(flag))) {
      req.opaqueTarget = true; req.opaqueBody = true; req.methodDynamic = true
      continue
    }
    if (!WGET_VALUE.has(flag)) continue
    if (value === null) { word = words[i + 1]; value = word?.text; i++ }
    if (flag === '--method') { if (word?.dynamic) req.methodDynamic = true; else req.method = String(value ?? '').toUpperCase() }
    else if (flag === '--post-data' || flag === '--body-data') { req.bodies.push(value ?? ''); if (word?.dynamic) req.opaqueBody = true; if (!req.method && flag === '--post-data') req.method = 'POST' }
    else if (flag === '--post-file' || flag === '--body-file') { req.opaqueBody = true; if (!req.method && flag === '--post-file') req.method = 'POST' }
    else if (flag === '--header') { if (word?.dynamic) req.opaqueTarget = true; else req.headers.push(value ?? '') }
    else if (['-i', '--input-file', '-e', '--execute', '--config'].includes(flag)) { req.opaqueTarget = true; req.opaqueBody = true; req.methodDynamic = true }
  }
  return req
}

// ── httpie / xh ───────────────────────────────────────────────────────────────────────────────────────────
const HTTPIE_VALUE = new Set(['-a', '--auth', '-A', '--auth-type', '--session', '--session-read-only', '-o', '--output', '--verify', '--cert',
  '--cert-key', '--proxy', '--timeout', '--max-redirects', '--pretty', '-s', '--style', '-p', '--print', '--default-scheme', '--ssl', '--ciphers'])

function httpieRequest(words) {
  const req = emptyRequest()
  const pos = []
  for (let i = 1; i < words.length; i++) {
    const t = words[i].text
    if (t.startsWith('-') && t.length > 1) {
      const [flag, value] = splitFlag(t)
      if (flag === '--raw') { const v = value ?? words[++i]?.text; req.bodies.push(v ?? ''); if (/^@/.test(v ?? '')) req.opaqueBody = true; continue }
      if (HTTPIE_VALUE.has(flag) && value === null) i++
      continue
    }
    pos.push(words[i])
  }
  let k = 0
  if (pos[k] && METHOD_WORD.test(pos[k].text) && pos.length > 1) req.method = pos[k++].text.toUpperCase()
  else if (pos[k]?.dynamic && pos.length > 1) { req.methodDynamic = true; k++ }
  if (pos[k]) { req.urls.push({ text: pos[k].text.replace(/^:(?=\d|\/)/, 'localhost:'), dynamic: pos[k].dynamic }); k++ }
  req.items = []
  for (const item of pos.slice(k)) {
    const t = item.text
    if (item.dynamic) { req.opaqueBody = true; continue }
    if (/^[^=:@]*==/.test(t)) continue // query parameter
    if (/^[^=:@]*:=@|^[^=:@]*=@|^[^=:@]*@/.test(t)) { req.opaqueBody = true; continue }
    const kv = /^([^=:@]*)(:=|=)(.*)$/s.exec(t)
    if (kv) { req.bodies.push(t); req.items.push({ key: kv[1], op: kv[2], value: kv[3] }); continue }
    if (/^[\w-]+:/.test(t)) req.headers.push(t)
  }
  return req
}

// ── PowerShell Invoke-WebRequest / Invoke-RestMethod ──────────────────────────────────────────────────────
// Parameter names may be abbreviated to any unambiguous prefix, and written `-Name:value`.
function psParam(text) {
  const m = /^-([A-Za-z]+)(?::(.*))?$/s.exec(text)
  if (!m) return null
  const p = m[1].toLowerCase()
  const name = /^ur(i)?$/.test(p) ? 'uri' : /^m(e(t(h(o(d)?)?)?)?)?$/.test(p) ? 'method' : /^cu/.test(p) ? 'custommethod'
    : /^b(o(d(y)?)?)?$/.test(p) ? 'body' : /^inf/.test(p) ? 'infile' : /^fo(r(m)?)?$/.test(p) ? 'form' : /^he/.test(p) ? 'headers' : 'other'
  return { name, attached: m[2] }
}
const PS_SWITCHES = /^-(usebasicparsing|usedefaultcredentials|disablekeepalive|skipcertificatecheck|skipheadervalidation|skiphttperrorcheck|allowunencryptedauthentication|allowinsecureredirect|resume|passthru|nobodyprogress|preservehttpmethodonredirect|preserveauthorizationonredirect|allowsystemproxy|proxyusedefaultcredentials)/i

function psRequest(words, pipedIn) {
  const req = emptyRequest()
  if (pipedIn) req.opaqueBody = true // pipeline input binds to -Body
  // A parenthesized/subexpression/cast/variable value or a `+` concatenation is computed at runtime.
  const isExpression = (w) => Boolean(w) && (w.dynamic || /^[($[]/.test(w.text) || (!w.quoted && /\+/.test(w.text)))
  let positional = 0
  for (let i = 1; i < words.length; i++) {
    const w = words[i]
    if (!w.quoted && /^@\w/.test(w.text)) { req.opaqueTarget = true; req.opaqueBody = true; req.methodDynamic = true; continue } // splatting
    const param = !w.quoted ? psParam(w.text) : null
    if (!param) {
      // Only -Uri is positional; a second positional word means an expression was split into several words.
      if (positional++ > 0) req.opaqueTarget = true
      req.urls.push({ text: w.text, dynamic: isExpression(w) })
      continue
    }
    if (PS_SWITCHES.test(w.text)) continue
    let valueWord = null
    let value = param.attached
    if (value === undefined) { valueWord = words[i + 1]; value = valueWord?.text; i++ }
    const dynamic = isExpression(valueWord) || (param.attached !== undefined && /^[($[]|\$|\+/.test(param.attached))
    if (param.name === 'uri') req.urls.push({ text: value ?? '', dynamic })
    else if (param.name === 'method' || param.name === 'custommethod') { if (dynamic) req.methodDynamic = true; else req.method = String(value ?? '').toUpperCase() }
    else if (param.name === 'body' || param.name === 'form') { req.bodies.push(value ?? ''); if (dynamic) req.opaqueBody = true }
    else if (param.name === 'infile') req.opaqueBody = true
    else if (param.name === 'headers') { if (dynamic) req.opaqueTarget = true; else req.headers.push(value ?? '') }
  }
  return req
}

// Environment variables that select where curl/wget read a config file (`.curlrc` `request = PUT`, wgetrc
// `method=PUT`). Any mention on the line counts (assignment, `printf -v HOME`, `read HOME`, `Set-Item env:HOME`):
// a file written into the worktree could then shape the request. POSIX variable names are case-sensitive, so bare
// names match upper-case only (a URL path such as `/home` does not); Windows environment names are case-insensitive,
// so `env:name`, cmd `set name=` and any SetEnvironmentVariable call match in any case.
const CONFIG_NAMES = 'CURL_HOME|XDG_CONFIG_HOME|WGETRC|SYSTEM_WGETRC|HOME|USERPROFILE|APPDATA'
const CONFIG_LOCATION = new RegExp(`\\b(${CONFIG_NAMES})\\b`)
const CONFIG_LOCATION_WINDOWS = new RegExp(`env:\\s*(${CONFIG_NAMES})\\b|\\bset\\s+"?(${CONFIG_NAMES})\\s*=|SetEnvironmentVariable`, 'i')

/** Parse an HTTP client invocation; null when `exe` is not an HTTP client. `line` is the full command line. */
export function parseHttpRequest(exe, words, { pipedIn = false, line = '' } = {}) {
  let req = null
  if (exe === 'curl') req = curlRequest(words)
  else if (exe === 'wget') req = wgetRequest(words)
  else if (['http', 'https', 'xh', 'xhs', 'httpie'].includes(exe)) req = httpieRequest(words)
  else if (['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'].includes(exe)) req = psRequest(words, pipedIn)
  if (req && (exe === 'curl' || exe === 'wget') && (CONFIG_LOCATION.test(line) || CONFIG_LOCATION_WINDOWS.test(line))) { req.opaqueTarget = true; req.opaqueBody = true; req.methodDynamic = true }
  return req
}

/**
 * Top-level request fields for exact-key REST checks (`branch`, `draft`, `event`): httpie/xh items, a single JSON
 * object body, or a cleanly form-encoded body. Returns null when the body cannot be parsed into fields.
 */
function bodyFields(req) {
  if (req.items && req.items.length && req.bodies.length === req.items.length) {
    return req.items.map(({ key, op, value }) => {
      if (op !== ':=') return [key, value]
      try { const v = JSON.parse(value); return [key, typeof v === 'string' ? v : JSON.stringify(v)] } catch { return [key, value] }
    })
  }
  if (!req.bodies.length) return []
  if (req.bodies.length === 1) {
    try {
      const parsed = JSON.parse(req.bodies[0])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Object.entries(parsed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
      return null
    } catch { /* not JSON; try form encoding */ }
  }
  const joined = req.bodies.join('&') // curl joins repeated -d values with '&'
  if (/[{}]/.test(joined)) return null
  const pieces = joined.split('&')
  if (!pieces.every((p) => /^[^=]+=/.test(p))) return null
  return pieces.map((p) => { const eq = p.indexOf('='); const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')) } catch { return x } }; return [dec(p.slice(0, eq)), dec(p.slice(eq + 1))] })
}

/**
 * Isolate the GraphQL document of a request: the `query` member of exactly one JSON body, or exactly one httpie/xh
 * `query` item. Anything else (several bodies, non-JSON, duplicated query) yields document: null → fails closed.
 */
function graphqlParts(req) {
  if (req.items && req.items.length) {
    const queries = req.items.filter((it) => it.key === 'query')
    let document = null
    if (queries.length === 1 && req.bodies.length === req.items.length) {
      const q = queries[0]
      if (q.op === '=') document = q.value
      else { try { const v = JSON.parse(q.value); if (typeof v === 'string') document = v } catch { /* not a JSON string */ } }
    }
    return { document, variablesText: req.items.filter((it) => it.key !== 'query').map((it) => `${it.key}=${it.value}`).join(' ') }
  }
  if (req.bodies.length !== 1) return { document: null, variablesText: req.bodies.join(' ') }
  try {
    const parsed = JSON.parse(req.bodies[0])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.query === 'string') {
      const { query, ...rest } = parsed
      return { document: query, variablesText: JSON.stringify(rest) }
    }
  } catch { /* not JSON */ }
  return { document: null, variablesText: req.bodies[0] }
}

/**
 * Effect findings for an HTTP client request, or null when the request is not mutating and the caller's generic
 * network classification applies.
 */
export function httpMutationFindings(req) {
  const hasBody = req.bodies.length > 0 || req.opaqueBody
  const method = req.method || (hasBody ? 'POST' : 'GET')
  const mutating = req.methodDynamic || !isReadMethod(method)
  if (!mutating) return null
  const effectiveMethod = req.methodDynamic ? 'POST' : method
  const hostHeader = req.headers.map((h) => /^\s*host\s*[:=]\s*(\S+)/i.exec(h)?.[1]).find(Boolean)
  const viaHeader = hostHeader ? isGithubHost(parseTarget(`//${hostHeader}`).host) : false
  const fields = bodyFields(req)
  const opaque = req.opaqueBody
  const targets = req.urls.filter((u) => !u.dynamic).map((u) => parseTarget(u.text))
  if (req.requestTarget !== null) for (const t of targets) t.path = parseTarget(req.requestTarget).path
  const out = []
  for (const t of targets) {
    if (!(viaHeader || isGithubHost(t.host) || looksLikeGithubApiPath(t.path))) continue
    if (t.path === 'graphql') out.push(...classifyGraphql({ ...graphqlParts(req), opaque }))
    else out.push(classifyRestMutation(effectiveMethod, t.path, { fields, opaque }))
  }
  const unknownTarget = req.opaqueTarget || req.urls.length === 0 || req.urls.some((u) => u.dynamic)
  if (unknownTarget) {
    out.push(F('run_unclassifiable_shell_input', 'network.unverified_mutation_target', 'mutating HTTP request whose target or headers are computed or read from a file; it could be a forbidden GitHub operation, so it is denied'))
  }
  return out.length ? out : null
}
