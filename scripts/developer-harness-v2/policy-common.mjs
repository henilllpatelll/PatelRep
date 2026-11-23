// Developer Harness V2 — shared helpers for the Phase 2 policy modules. Pure functions only.
import { isSensitivePath, normalizeSlashes, percentDecode, detectActivation } from './path-policy.mjs'

/** A policy finding. `action` is always an action id declared in contract.json. */
export const F = (action, code, detail) => ({ action, code, detail })

export const PROTECTED_BRANCHES = new Set(['main', 'master'])
// Branch namespaces owned by trusted publishers (Feature Builder, Release Engineer). Developer pushes there
// would impersonate a publisher path.
export const RESERVED_BRANCH_PREFIXES = ['claude/recovery-', 'feature/ai-']

/** Lower-cased basename of an executable word without Windows launcher extensions; '<dynamic>' if computed. */
export function execName(word) {
  if (!word) return ''
  if (word.dynamic) return '<dynamic>'
  const s = normalizeSlashes(word.text)
  const base = s.slice(s.lastIndexOf('/') + 1).toLowerCase()
  return base.replace(/\.(exe|cmd|bat|com)$/, '')
}

export const isPathLike = (text) => /[\\/]/.test(text) || /\.(sh|bash|ps1|psm1|py|mjs|cjs|js|ts|rb|pl|bat|cmd)$/i.test(text)

/** Split `--flag=value` into its parts. */
export function splitFlag(text) {
  const eq = text.indexOf('=')
  return eq > 0 && text.startsWith('-') ? [text.slice(0, eq), text.slice(eq + 1)] : [text, null]
}

/** Positional (non-flag) words after index `from`, skipping values of flags listed in `withValue`. */
export function positionals(words, from = 1, withValue = new Set()) {
  const out = []
  for (let i = from; i < words.length; i++) {
    const t = words[i].text
    if (t === '--') { out.push(...words.slice(i + 1)); break }
    if (t.startsWith('-') && t.length > 1) {
      const [flag, value] = splitFlag(t)
      if (value === null && withValue.has(flag)) i++
      continue
    }
    out.push(words[i])
  }
  return out
}

export const hasFlag = (words, ...names) => words.some((w) => names.includes(splitFlag(w.text)[0]))

/** Value of `--flag value` / `--flag=value` / `-f value`, or undefined. */
export function flagValue(words, ...names) {
  for (let i = 0; i < words.length; i++) {
    const [flag, value] = splitFlag(words[i].text)
    if (names.includes(flag)) return value ?? words[i + 1]?.text
  }
  return undefined
}

const SENSITIVE_VAR = /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|PRIVATE|API_?KEY|ACCESS_?KEY|SERVICE_?ROLE|CREDENTIAL|COOKIE|DATABASE_URL|DB_URL|(^|_)DSN$|JWT|SIGNING|WEBHOOK|(^|_)AUTH($|_)|(^|_)KEY$)/i
export const isSensitiveVarName = (name) => Boolean(name) && SENSITIVE_VAR.test(name)

// Candidate file references inside free text (inline code, URLs, joined args).
const SENSITIVE_REF = /(?:^|[\s'"`=:@/\\(,<>])((?:\.env(?:\.[\w.-]+)?|[\w.-]+\.env|\.envrc|id_(?:rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(?:pem|p12|pfx|jks|keystore|ppk|p8)|\.netrc|_netrc|\.npmrc|\.pypirc|\.git-credentials|\.pgpass|\.?credentials\.json|\.claude\.json|secrets\.(?:json|ya?ml)|auth\.json|access-token)(?=$|[\s'"`)\],;|&<>])|\.ssh[/\\]|\.aws[/\\]|\.config[/\\]gh[/\\]|\.supabase[/\\]|\.railway[/\\]|com\.vercel\.cli)/gi

/** True when free text references a credential file (template files such as `.env.example` excluded). */
export function textReferencesSensitive(text) {
  const decoded = percentDecode(String(text))
  for (const m of decoded.matchAll(SENSITIVE_REF)) {
    const ref = m[1] ?? m[0]
    if (/[/\\]$|com\.vercel\.cli/i.test(ref) || isSensitivePath(ref)) return true
  }
  return false
}

/** Variants a shell/PowerShell would produce: one level of brace expansion and single-character classes. */
function shellVariants(text) {
  const variants = new Set([text])
  const brace = /^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/s.exec(text)
  if (brace) for (const alt of brace[2].split(',')) variants.add(`${brace[1]}${alt}${brace[3]}`)
  for (const v of [...variants]) variants.add(v.replace(/\[(.)\]/g, '$1').replace(/\[([^\]]*)\]/g, (_, cls) => cls[0] ?? ''))
  return [...variants]
}

export const wordIsSensitive = (w) => shellVariants(w.text).some((text) => isSensitivePath(text) || textReferencesSensitive(text) ||
  text.split(/[=@,]/).some((part) => part && part !== text && isSensitivePath(part)))

const ENV_ACCESS = /(process\.env|os\.environ|os\.getenv|getenv|\$env:|ENV\[|Environment\]::GetEnvironmentVariable)\W{0,3}["'.[(]?\s*["']?([A-Za-z_][A-Za-z0-9_]*)/g
/** Inline code reading a credential-like environment variable, or dumping the whole environment. */
export function codeReadsSensitiveEnv(text) {
  if (/GetEnvironmentVariables\s*\(|os\.environ\s*\)|dict\(os\.environ|JSON\.stringify\(\s*process\.env\s*\)|console\.(log|dir)\(\s*process\.env\s*\)|\bprint\(\s*os\.environ/i.test(text)) return true
  for (const m of text.matchAll(ENV_ACCESS)) if (isSensitiveVarName(m[2])) return true
  return false
}

export const REMOTE_DATABASE = /\.supabase\.(co|com|in)\b|pooler\.supabase|postgres(ql)?:\/\/(?!(localhost|127\.0\.0\.1|\[::1\]|postgres:postgres@(localhost|127\.0\.0\.1))[:/])/i

// Last-resort signatures for effects hidden inside code/strings the recognizer cannot structurally parse.
const SIGNATURES = [
  [/\bgit\b.{0,80}\bpush\b.{0,120}(?:\s|:|\/)(?:main|master)\b/, 'push_to_protected_main', 'signature.git_push_main'],
  [/\bgit\b.{0,80}\bpush\b.{0,120}(?:\s)(?:--force\b|-f\b|--force-with-lease|--mirror\b|\+\S)/, 'force_push_or_rewrite_reviewed_history', 'signature.git_force'],
  [/--no-verify\b|core\.hookspath|\bhusky\s*=\s*0\b/, 'bypass_git_hooks_or_ci', 'signature.hook_bypass'],
  [/\bgh\b\s+pr\s+merge\b|mergepullrequest|enablepullrequestautomerge/, 'merge_pull_request', 'signature.gh_merge'],
  [/\bgh\b\s+(workflow\s+run|run\s+rerun)\b|\/dispatches\b/, 'dispatch_any_workflow', 'signature.workflow_dispatch'],
  [/\bsupabase\b.{0,60}\b(db\s+push|migration\s+repair|link)\b/, 'run_supabase_cli_against_remote_project', 'signature.supabase_remote'],
  [/\brailway\b\s+(up|deploy|redeploy|run)\b|\bvercel\b.{0,60}(--prod\b|\bdeploy\b|\bpromote\b)/, 'deploy_production', 'signature.deploy'],
  [/\beas(-cli)?\b.{0,20}\b(update|submit)\b/, 'publish_mobile_build_or_ota_update', 'signature.eas_publish'],
  [/\bnpm\s+publish\b/, 'create_alternate_publishing_or_deployment_path', 'signature.npm_publish'],
]

const CONTENT_SIGNATURE_CODES = new Set(['signature.git_push_main', 'signature.git_force', 'signature.gh_merge', 'signature.workflow_dispatch',
  'signature.supabase_remote', 'signature.deploy', 'signature.eas_publish', 'signature.npm_publish'])

/**
 * Protected-effect signatures in code written by Write/Edit (e.g. a test that runs `git push origin main`).
 * Excludes credential-file and env references, which ordinary configuration code legitimately contains.
 */
export function contentEffectFindings(text) {
  const norm = String(text).toLowerCase().replace(/[,'"`]/g, ' ').replace(/\s+/g, ' ')
  return SIGNATURES.filter(([re, , code]) => CONTENT_SIGNATURE_CODES.has(code) && re.test(norm))
    .map(([, action, code]) => F(action, code.replace('signature.', 'content.'), 'written code contains a protected effect'))
}

/** Forbidden-effect findings for opaque text (inline code, unknown command lines). Never returns non-forbidden findings. */
export function signatureFindings(text) {
  const norm = String(text).toLowerCase().replace(/[,'"`]/g, ' ').replace(/\s+/g, ' ')
  const out = []
  for (const [re, action, code] of SIGNATURES) if (re.test(norm)) out.push(F(action, code, 'opaque code contains a protected effect'))
  if (REMOTE_DATABASE.test(text)) out.push(F('access_customer_data', 'signature.remote_database', 'remote database target'))
  if (codeReadsSensitiveEnv(text)) out.push(F('read_production_or_publisher_credentials', 'signature.env_secret', 'reads credential environment variables'))
  if (textReferencesSensitive(text)) out.push(F('read_production_or_publisher_credentials', 'signature.secret_file', 'references a credential file'))
  const activation = detectActivation(text)
  if (activation) out.push(F(activation.action, activation.code, activation.detail))
  return out
}

/** Extract string literals from opaque code (JS/Python/shell quoting). Bounded and best-effort. */
export function stringLiterals(code) {
  const out = []
  const re = /'((?:[^'\\\n]|\\.){3,400})'|"((?:[^"\\\n]|\\.){3,400})"|`((?:[^`\\]|\\.){3,400})`/g
  for (const m of String(code).matchAll(re)) out.push((m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1'))
  return out
}
