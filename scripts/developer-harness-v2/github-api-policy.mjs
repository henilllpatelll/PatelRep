// Developer Harness V2 — GitHub API effect classification (Phase 2 remediation). Pure: never sends a request.
//
// Shared by `gh api`, generic HTTP clients (curl, wget, httpie/xh, Invoke-WebRequest/Invoke-RestMethod) and the
// opaque-code scan, so the SAME effect gets the SAME classification whichever client carries it.
//
// Mutations are classified by verified effect against an allowlist of narrowly-defined operations (comments,
// draft PRs, labels, …). Any mutation whose effect cannot be verified — an unknown endpoint, an unknown GraphQL
// mutation field, a request body read from a file, a computed endpoint — is FORBIDDEN (fail closed), because the
// GitHub API surface contains merges, dispatches, releases and repository controls.
import { F } from './policy-common.mjs'
import { classifyRepoFileWrites, decodeBase64Content } from './github-write-policy.mjs'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export const isReadMethod = (method) => READ_METHODS.has(String(method ?? '').toUpperCase())

/** Lenient repeated percent-decoding (a single invalid escape must not disable decoding of the others). */
function decodeAll(text) {
  let s = String(text)
  for (let i = 0; i < 3; i++) {
    const d = s.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    if (d === s) break
    s = d
  }
  return s
}

/** Split a URL or API path into a lower-cased host (or null) and a normalized, dot-segment-resolved path. */
export function parseTarget(text) {
  const original = String(text ?? '').trim()
  const s = decodeAll(original).replace(/\\/g, '/')
  // `ambiguous`: the path was percent-encoded, used backslashes, or contained empty/`.`/`..` segments, so the
  // normalized path is not literally what was written. Repository file writes refuse such destinations.
  const rawPath = original.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*/i, '').split(/[?#]/)[0].replace(/^\/+/, '')
  const ambiguous = s !== original.replace(/\\/g, '/') || /\\/.test(original) || rawPath.split('/').some((seg, i, a) => seg === '.' || seg === '..' || (!seg && i < a.length - 1))
  let host = null
  let rest = s
  const withScheme = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)(.*)$/i.exec(s)
  const bareHost = /^((?:[\w-]+\.)+[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/.*|$)/i.exec(s)
  if (withScheme) { host = withScheme[1]; rest = withScheme[2] } else if (bareHost) { host = bareHost[1]; rest = bareHost[3] }
  if (host) host = host.replace(/^[^@]*@/, '').replace(/:\d*$/, '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  const [pathPart, ...queryParts] = rest.split(/[?#]/)
  const segs = []
  for (const seg of pathPart.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') segs.pop()
    else segs.push(seg.toLowerCase())
  }
  const path = segs.join('/').replace(/^api\/v3\//, '').replace(/^api\/graphql$/, 'graphql')
  return { host, path, query: queryParts.join('?'), ambiguous }
}

export const isGithubHost = (host) => Boolean(host) && /(^|\.)(github\.com|ghe\.com|githubusercontent\.com)$|^github\./.test(host)

/** Paths that are unmistakably GitHub REST/GraphQL API paths, whatever host (IP, proxy, Host-header spoof) carries them. */
export const looksLikeGithubApiPath = (path) =>
  /^(repos\/[^/]+\/[^/]+(\/|$)|graphql$|orgs\/[^/]+\/|enterprises\/|app\/|applications\/|installation\/|user\/(keys|gpg_keys|ssh_signing_keys|emails|repos|installations|codespaces|migrations))/.test(path)

const G = (action, code, detail) => F(action, `github_api.${code}`, detail)
const unverified = (detail) => G('run_unclassifiable_shell_input', 'unverified_mutation', `${detail}; the effect cannot be verified, so it is denied (GitHub mutations can merge, dispatch, release or change repository controls)`)

// Repository sub-paths (after `repos/{owner}/{repo}`). `mutationOnly` marks endpoints with no common read use: they
// are also flagged when they merely appear inside opaque code (inline interpreter code, unknown programs).
const REPO_RULES = [
  { re: /^\/pulls\/[^/]+\/merge$|^\/merges$|^\/merge-upstream$/, action: 'merge_pull_request', code: 'merge', detail: 'merging via the API is performed by humans only', mutationOnly: true },
  { re: /^\/actions\/workflows\/[^/]+\/(dispatches|enable|disable)$|^\/dispatches$|^\/actions\/(runs|jobs)\/[^/]+\/(rerun|rerun-failed-jobs|cancel|force-cancel|approve)$/, action: 'dispatch_any_workflow', code: 'workflow', detail: 'dispatching, re-running, cancelling or toggling workflows is forbidden', mutationOnly: true },
  { re: /^\/actions\/runs\/[^/]+(\/logs|\/attempts\/[^/]+)?$/, action: 'dispatch_any_workflow', code: 'workflow_run_delete', detail: 'deleting workflow runs or logs destroys gate evidence' },
  { re: /^\/actions\/runs\/[^/]+\/(pending_deployments|deployment_protection_rule)$/, action: 'dispatch_production_release_or_rollback', code: 'environment_approval', detail: 'approving environment deployments is human-owned', mutationOnly: true },
  { re: /^\/deployments(\/|$)/, action: 'deploy_production', code: 'deployment', detail: 'deployments are created only by trusted workflows' },
  { re: /^\/releases(\/|$)/, action: 'dispatch_production_release_or_rollback', code: 'release', detail: 'releases are created only by the trusted release workflow' },
  { re: /^\/git(\/|$)/, action: 'force_push_or_rewrite_reviewed_history', code: 'git_data', detail: 'direct ref/object writes can move protected branches' },
  { re: /^\/(statuses|check-runs|check-suites)(\/|$)|^\/commits\/[^/]+\/(statuses|check-runs|check-suites)$/, action: 'bypass_git_hooks_or_ci', code: 'commit_status', detail: 'writing commit statuses or check runs can spoof CI gates' },
  { re: /^\/pulls\/[^/]+\/reviews\/[^/]+\/dismissals$/, action: 'approve_pull_request_as_gate', code: 'dismiss_review', detail: 'dismissing reviews changes the approval gate', mutationOnly: true },
  { re: /^$|^\/(rulesets|environments|secrets|variables|collaborators|invitations|hooks|keys|deploy-keys|teams|transfer|topics|pages|vulnerability-alerts|automated-security-fixes|private-vulnerability-reporting|security-advisories|code-scanning|secret-scanning|code-security|dependabot|autolinks|forks|generate|interaction-limits|properties|attestations|codespaces|lfs|immutable-releases|rename|actions|branches|tags|import|license)(\/|$)/,
    action: 'change_repository_rulesets_secrets_environments_or_permissions', code: 'repo_controls', detail: 'repository settings and controls are human-owned' },
]

// Comment endpoints keep their baseline class (task_authorized). Everything else that is allowed at all stays at its
// baseline human_approval: remediation A must not broaden any permission.
const COMMENT_PATH = /^\/issues\/[^/]+\/comments$|^\/(issues|pulls)\/comments\/[^/]+(\/replies|\/reactions(\/[^/]+)?)?$|^\/pulls\/[^/]+\/comments(\/[^/]+\/replies)?$|^\/comments\/[^/]+(\/reactions(\/[^/]+)?)?$|^\/commits\/[^/]+\/comments$/
const PR_STATE_PATH = /^\/(pulls|issues)\/[^/]+$|^\/issues\/[^/]+\/(labels|assignees|lock|reactions)(\/[^/]+)?$|^\/pulls\/[^/]+\/requested_reviewers$|^\/(labels|milestones)(\/[^/]+)?$|^\/issues$|^\/pulls\/[^/]+\/update-branch$/
const REVIEW_PATH = /^\/pulls\/[^/]+\/reviews(\/[^/]+(\/events)?)?$/

/**
 * Values of an exact top-level field key; null when the body could not be parsed into fields. GitHub JSON keys are
 * case-sensitive (`Branch` is ignored by GitHub), so matching is exact unless `anyCase` is set for keys where a
 * case-insensitive match can only make the result stricter (review `event`).
 */
const fieldValues = (fields, key, { anyCase = false } = {}) => (fields
  ? fields.filter(([k]) => (anyCase ? String(k).toLowerCase() === key : String(k) === key)).map(([, v]) => String(v)) : null)

/**
 * Classify a REST mutation (`method` is not a read method). Returns one finding.
 * Body-dependent decisions (contents branch, draft flag, review event) read EXACT top-level field keys only — never
 * substrings of other fields — and treat zero, duplicated or unparseable values as the unsafe case.
 * @param {string} method
 * @param {string} path      normalized path from parseTarget
 * @param {{ fields?: Array<[string, unknown]>|null, opaque?: boolean, target?: object, ctx?: object }} body  parsed top-level
 *   fields (null = not parseable); `target` = parseTarget result (ambiguity flags); `ctx` = engine context (path policy, git state)
 * @returns {Array<object>} findings (a repository file write yields several; the engine keeps the strictest)
 */
export function classifyRestMutation(method, path, opts = {}) {
  const r = classifyRestMutationInner(method, path, opts)
  return Array.isArray(r) ? r : [r]
}

function classifyRestMutationInner(method, path, { fields = [], opaque = false, target = null, ctx = null } = {}) {
  const parsed = opaque ? null : fields
  const repo = /^repos\/[^/]+\/[^/]+/.exec(path)
  if (!repo) {
    if (/^(user|users|orgs|enterprises|teams|admin)(\/|$)/.test(path)) return G('change_repository_rulesets_secrets_environments_or_permissions', 'account_controls', 'account, organization and team settings are human-owned')
    if (/^(app|applications|installation|authorizations)(\/|$)/.test(path)) return G('read_production_or_publisher_credentials', 'token_minting', 'creates or manages GitHub App / OAuth credentials')
    if (/^markdown(\/|$)/.test(path)) return G('read_github_state', 'render', 'renders Markdown (no repository effect)')
    if (/^gists(\/|$)/.test(path)) return G('network_request_or_remote_shell', 'gist', 'gist write (data leaves the machine)')
    return unverified(`unrecognized GitHub API mutation (${method} ${path.slice(0, 60) || '/'})`)
  }
  const sub = path.slice(repo[0].length)
  for (const rule of REPO_RULES) if (rule.re.test(sub)) return G(rule.action, rule.code, rule.detail)
  if (/^\/contents(\/|$)/.test(sub)) {
    // Repository file write: classified by destination repository + branch AND by the target file, through the same
    // path policy as a local Write/Edit (github-write-policy). A branch field alone never proves authorization.
    if (!parsed) return G('push_to_protected_main', 'contents_main', 'contents API write whose body cannot be inspected (no verifiable branch field) may target the default/protected branch')
    if (target?.ambiguous || target?.query) return G('run_unclassifiable_shell_input', 'contents_ambiguous', 'contents API write to an encoded, traversing or query-qualified path; the destination cannot be verified')
    const branches = fieldValues(parsed, 'branch')
    // Content must be inspectable exactly as sent: a repeated `content` (gh keeps the last, we would read one) or a
    // value that is not clean base64 (a lenient server decoder might still accept it) skips the content checks.
    const contents = fieldValues(parsed, 'content')
    if (contents.length > 1) return G('run_unclassifiable_shell_input', 'contents_ambiguous', 'contents API write with a duplicated content field; the content sent cannot be verified')
    const content = contents.length ? decodeBase64Content(contents[0]) : undefined
    if (contents.length && content === undefined) return G('run_unclassifiable_shell_input', 'contents_ambiguous', 'contents API write whose content is not clean base64; the content cannot be verified')
    const [, owner, repoName] = /^repos\/([^/]+)\/([^/]+)/.exec(path)
    return classifyRepoFileWrites({
      owner, repo: repoName, branch: branches.length ? branches[0] : undefined, branchCount: branches.length,
      files: [{ path: sub.slice('/contents/'.length), op: method === 'DELETE' ? 'delete' : 'write', existing: fieldValues(parsed, 'sha').length > 0, content }],
    }, ctx)
  }
  if (COMMENT_PATH.test(sub)) return G('interact_with_pull_request_or_issue', 'comment', 'comment via the API')
  if (/^\/pulls$/.test(sub)) {
    const drafts = fieldValues(parsed, 'draft')
    return drafts && drafts.length === 1 && drafts[0].toLowerCase() === 'true'
      ? G('modify_pull_request_state', 'pr_create_draft', 'opens a draft pull request via the API (approval required, as before)')
      : G('mark_pull_request_ready_for_review', 'pr_create_non_draft', 'a pull request not verifiably opened as a draft is ready for review')
  }
  if (REVIEW_PATH.test(sub)) {
    if (method === 'DELETE') return G('modify_pull_request_state', 'review_delete', 'deletes a pending review')
    const events = fieldValues(parsed, 'event', { anyCase: true })
    if (!events || events.length > 1) return G('approve_pull_request_as_gate', 'review_unverifiable', 'review event cannot be verified (body not inspected or ambiguous); it could approve')
    // Conservative, as at baseline: "approve" in ANY field value is treated as an approval.
    if (parsed.some(([, v]) => /approve/i.test(String(v)))) return G('approve_pull_request_as_gate', 'review_approve', 'agents cannot approve pull requests')
    return G('modify_pull_request_state', 'review', 'pull request review (comment / request changes / pending)')
  }
  if (PR_STATE_PATH.test(sub)) return G('modify_pull_request_state', 'pr_state', 'changes pull request / issue state')
  return unverified(`unrecognized repository mutation (${method} ${sub.slice(0, 60)})`)
}

// GraphQL mutation fields (lower-cased). Anything not listed is an unverified mutation → forbidden.
const GQL = new Map([
  // Baseline classified every `gh api graphql` mutation as human_approval; allowed fields keep that class.
  ...['addcomment', 'updateissuecomment', 'deleteissuecomment', 'addpullrequestreviewcomment', 'addpullrequestreviewthreadreply',
    'updatepullrequestreviewcomment', 'deletepullrequestreviewcomment', 'addreaction', 'removereaction', 'minimizecomment',
    'unminimizecomment', 'createissue', 'updateissue', 'closeissue', 'reopenissue', 'updatepullrequest', 'closepullrequest', 'reopenpullrequest', 'convertpullrequesttodraft',
    'addlabelstolabelable', 'removelabelsfromlabelable', 'clearlabelsfromlabelable', 'addassigneestoassignable',
    'removeassigneesfromassignable', 'requestreviews', 'resolvereviewthread', 'unresolvereviewthread', 'locklockable', 'unlocklockable',
    'deletepullrequestreview', 'disablepullrequestautomerge'].map((n) => [n, ['modify_pull_request_state', 'pr_state']]),
  ['markpullrequestreadyforreview', ['mark_pull_request_ready_for_review', 'ready']],
  ...['mergepullrequest', 'mergebranch', 'enqueuepullrequest'].map((n) => [n, ['merge_pull_request', 'merge']]),
  ['enablepullrequestautomerge', ['enable_auto_merge', 'auto_merge']],
  ['dismisspullrequestreview', ['approve_pull_request_as_gate', 'dismiss_review']],
  ...['createref', 'updateref', 'updaterefs', 'deleteref'].map((n) => [n, ['force_push_or_rewrite_reviewed_history', 'refs']]),
  ['createcommitonbranch', ['bypass_git_hooks_or_ci', 'commit_on_branch']],
  ...['approvedeployments', 'rejectdeployments'].map((n) => [n, ['dispatch_production_release_or_rollback', 'environment_approval']]),
])
// Names flagged even inside opaque code (they have no read meaning).
const GQL_FORBIDDEN_NAMES = /\b(mergepullrequest|mergebranch|enqueuepullrequest|enablepullrequestautomerge|dismisspullrequestreview|createref|updateref|updaterefs|deleteref|createcommitonbranch|approvedeployments|(create|update|delete)(branchprotectionrule|repositoryruleset|environment)|updaterepository|archiverepository|transferrepository)\b/gi

/**
 * Single-pass GraphQL lexer following the spec's lexical grammar: ignored tokens are whitespace, line terminators
 * (LF, CR, CRLF), commas, BOM and comments (`#` to the next CR or LF); strings and block strings (with the `\"""`
 * escape) are consumed as single tokens. Returns punctuator/name tokens, or null on any lexical error (fail closed).
 */
export function graphqlTokens(doc) {
  const s = String(doc)
  const out = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === '﻿') { i++; continue }
    if (c === '#') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue }
    if (s.startsWith('"""', i)) {
      i += 3
      for (;;) {
        if (i >= s.length) return null
        if (s.startsWith('\\"""', i)) { i += 4; continue }
        if (s.startsWith('"""', i)) { i += 3; break }
        i++
      }
      out.push({ t: 'str' })
      continue
    }
    if (c === '"') {
      i++
      for (;;) {
        if (i >= s.length || s[i] === '\n' || s[i] === '\r') return null
        if (s[i] === '\\') { i += 2; continue }
        if (s[i] === '"') { i++; break }
        i++
      }
      out.push({ t: 'str' })
      continue
    }
    if (s.startsWith('...', i)) { out.push({ t: '...' }); i += 3; continue }
    if ('!$&()[]{}:=@|'.includes(c)) { out.push({ t: c }); i++; continue }
    const name = /^[_A-Za-z][_0-9A-Za-z]*/.exec(s.slice(i, i + 256))
    if (name) { out.push({ t: 'name', v: name[0] }); i += name[0].length; continue }
    const num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(i, i + 64))
    if (num && !/^[_A-Za-z.]/.test(s[i + num[0].length] ?? '')) { out.push({ t: 'num' }); i += num[0].length; continue }
    return null
  }
  return out
}

/** Top-level field names of every `mutation` operation in a GraphQL document; null when they cannot be determined. */
export function graphqlMutationFields(doc) {
  const tokens = graphqlTokens(doc)
  if (!tokens) return null
  if (!tokens.some((k) => k.t === 'name' && k.v === 'mutation')) return []
  if (tokens.some((k) => k.t === '...' || (k.t === 'name' && k.v === 'fragment'))) return null // spreads/fragments hide fields
  const fields = []
  let depth = 0
  let paren = 0
  let inMutation = false
  let pendingMutation = false
  // Only the FIRST name of a top-level definition is its operation type; later names (the operation name, which may
  // itself be `query`/`subscription`/`mutation`) must not change it.
  let atDefinitionStart = true
  for (let i = 0; i < tokens.length; i++) {
    const k = tokens[i]
    if (k.t === '(') { paren++; continue }
    if (k.t === ')') { if (--paren < 0) return null; continue }
    if (paren) continue // arguments and variable definitions (input-object braces included)
    if (k.t === '{') { if (depth === 0) { inMutation = pendingMutation; pendingMutation = false; atDefinitionStart = false } depth++; continue }
    if (k.t === '}') { if (--depth < 0) return null; if (depth === 0) { inMutation = false; atDefinitionStart = true } continue }
    if (depth === 0) {
      if (atDefinitionStart && k.t === 'name') { pendingMutation = k.v === 'mutation'; atDefinitionStart = false }
      else if (k.t === 'name' && ['query', 'mutation', 'subscription'].includes(k.v)) return null // keyword used as an operation name: fail closed
      continue
    }
    if (!inMutation || depth !== 1) continue
    if (k.t === '@') { i++; continue } // directive name
    if (k.t === 'name') {
      let nameIdx = i
      if (tokens[i + 1]?.t === ':') { nameIdx = i + 2; if (tokens[nameIdx]?.t !== 'name') return null; i += 2 }
      // Argument tokens of this field (strings are opaque 'str' tokens, so `title:"draft:true"` cannot spoof args).
      const args = []
      if (tokens[nameIdx + 1]?.t === '(') {
        let p = 0
        for (let j = nameIdx + 1; j < tokens.length; j++) {
          if (tokens[j].t === '(') p++
          else if (tokens[j].t === ')' && --p === 0) break
          args.push(tokens[j])
        }
      }
      fields.push({ name: tokens[nameIdx].v, args })
    }
  }
  if (depth !== 0 || paren !== 0) return null
  return fields
}

/** True when argument tokens contain exactly `draft: true` (a literal, not a variable). */
const argsSetDraftTrue = (args) => args.some((k, j) => k.t === 'name' && k.v === 'draft' && args[j + 1]?.t === ':' && args[j + 2]?.t === 'name' && args[j + 2].v === 'true')

/**
 * Classify a GraphQL request. `document` is the GraphQL document ONLY (never concatenated with other fields, whose
 * `#` or `"` would change how it lexes); `variablesText` is data (variables, other fields) used only to verify
 * review events and draft flags; `opaque` when the document or variables come from a file, stdin or computed value.
 * A null document means it could not be isolated (missing, duplicated or non-JSON body) and fails closed.
 */
export function classifyGraphql({ document, variablesText = '', opaque = false }) {
  if (opaque) return [G('run_unclassifiable_shell_input', 'opaque_graphql', 'GraphQL document or variables are not inspectable (file, stdin or computed); it could perform any mutation, so it is denied')]
  if (typeof document !== 'string') return [unverified('GraphQL request whose document cannot be isolated (missing, duplicated or not a JSON body)')]
  const fields = graphqlMutationFields(document)
  if (fields === null) return [unverified('GraphQL mutation whose fields cannot be determined (fragments/spreads or malformed document)')]
  if (!fields.length) return [G('read_github_state', 'graphql_read', 'GraphQL query (no mutation)')]
  const lowerText = `${document} ${variablesText}`.toLowerCase()
  return fields.map(({ name: field, args }) => {
    const name = field.toLowerCase()
    if (name === '__typename') return G('read_github_state', 'graphql_read', 'GraphQL __typename')
    if (name === 'addpullrequestreview' || name === 'submitpullrequestreview') {
      // Conservative: "approve" anywhere in the document or variables is treated as an approval.
      return /approve/.test(lowerText) ? G('approve_pull_request_as_gate', 'review_approve', 'agents cannot approve pull requests')
        : G('modify_pull_request_state', 'review', 'pull request review (comment / request changes)')
    }
    if (name === 'createpullrequest') {
      return argsSetDraftTrue(args) ? G('modify_pull_request_state', 'pr_create_draft', 'opens a draft pull request via GraphQL (approval required, as before)')
        : G('mark_pull_request_ready_for_review', 'pr_create_non_draft', 'a pull request not verifiably opened as a draft is ready for review')
    }
    const known = GQL.get(name)
    return known ? G(known[0], known[1], `GraphQL ${field}`) : unverified(`unrecognized GraphQL mutation '${field.slice(0, 40)}'`)
  })
}

// Opaque code that targets the GitHub API (host, API path or GraphQL) with a mutating verb cannot be verified.
const OPAQUE_GITHUB_TARGET = /\b(api|uploads)\.github\.com\b|\/api\/v3\/|(^|[^\w])repos\/[\w.-]+\/[\w.-]+\/|\/graphql\b|\bgraphql\b/i
const OPAQUE_MUTATING = /\b(post|put|patch|delete)\b|\bmethod\b|\bmutation\b|\bupload\w*|\.send\w*\(|\bsendasync\b|(^|\s)-X\s*\w|--request\b|--data\b|--json\b/i

/**
 * Forbidden GitHub effects referenced inside OPAQUE text (inline interpreter code, unknown programs, remote shells).
 * Flags (1) mutation-only endpoints and GraphQL names, even without a visible verb, and (2) any GitHub API target
 * combined with a mutating verb — the effect of such opaque code cannot be verified, so it fails closed. Plain reads
 * of GitHub (no mutating verb) stay at the opaque code's own class (human_approval).
 */
export function opaqueGithubFindings(text) {
  const out = []
  const decoded = decodeAll(text)
  if (OPAQUE_GITHUB_TARGET.test(decoded) && OPAQUE_MUTATING.test(decoded)) {
    out.push(G('run_unclassifiable_shell_input', 'opaque_mutation', 'opaque code (inline interpreter, unknown program or remote shell) sends a mutating request to the GitHub API; its effect cannot be verified, so it is denied — use `gh` so the request can be classified'))
  }
  for (const m of decoded.matchAll(/repos\/[^\s'"`,;)<>]+/gi)) {
    const { path } = parseTarget(m[0])
    const repo = /^repos\/[^/]+\/[^/]+/.exec(path)
    if (!repo) continue
    const rule = REPO_RULES.find((r) => r.mutationOnly && r.re.test(path.slice(repo[0].length)))
    if (rule) out.push(G(rule.action, `opaque_${rule.code}`, `opaque code references a GitHub ${rule.code.replace(/_/g, ' ')} endpoint; ${rule.detail}`))
  }
  for (const m of decoded.matchAll(GQL_FORBIDDEN_NAMES)) {
    const known = GQL.get(m[1].toLowerCase())
    out.push(known ? G(known[0], `opaque_${known[1]}`, `opaque code references the GraphQL mutation ${m[1]}`)
      : G('change_repository_rulesets_secrets_environments_or_permissions', 'opaque_repo_controls', `opaque code references the GraphQL mutation ${m[1]}`))
  }
  return out
}
