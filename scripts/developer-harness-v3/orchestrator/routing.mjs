// Developer Harness V3 (D3.4) — deterministic model routing. No AI decides which AI runs: routing is a pure function of stage, task risk, escalation history
// and subscription state. Reuses the V2 router's SECURITY_TRIGGERS vocabulary only as an input classifier (see classifyComplexity); it does not replace V2 routing,
// which stays authoritative for V2 sessions.
//
// Hard rules (each tested):
//  * only combinations in ROUTES are ever emitted; the CLI must support them (cli-capabilities evidence below);
//  * a mandatory security review is NEVER downgraded to fit a quota; it waits instead;
//  * no paid fallback: `--fallback-model`, API keys, alternative accounts and usage purchases are refused outright;
//  * requested and ACTUAL model identity are both recorded; a silent substitution is a failure, not a warning;
//  * scheduling, authorization, quota waiting and monitoring never invoke a model.
export const CLI_EVIDENCE = Object.freeze({
  source: '`claude --help` on the owner host, Claude Code 2.1.332, recorded 2026-11-25 (the pinned worker binary is 2.1.331)',
  efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
  model_aliases_documented: Object.freeze(['fable', 'opus', 'sonnet']), // `--model` help lists these as examples; `haiku` is observed live in doc 14 (claude-haiku-5-5)
  flags: Object.freeze({ effort: true, model: true, fallback_model: true }),
  caveat: 'The worker binary (2.1.331) was not asked for --help from inside the guest. Gate G-CLI-EFFORT: re-verify --effort and --model there before activation.',
})

/** Canonical alias → model-id family the CLI is expected to report back in `system/init.model` and assistant messages. */
export const MODEL_FAMILIES = Object.freeze({ sonnet: /^claude-sonnet-[a-z0-9.-]+$/, opus: /^claude-opus-[a-z0-9.-]+$/, haiku: /^claude-haiku-[a-z0-9.-]+$/ })
/** The only (model, effort) pairs D3.4 may request. A subset of what the CLI accepts, chosen by the owner's brief. */
export const ALLOWED_PAIRS = Object.freeze({ sonnet: Object.freeze(['medium', 'high']), opus: Object.freeze(['high']), haiku: Object.freeze(['low']) })

export const NON_AI_STAGES = Object.freeze(['scheduling', 'authorization', 'quota_waiting', 'resource_waiting', 'monitoring', 'evidence_verification', 'test_execution', 'lease_management', 'checkpoint_verification', 'notification'])

export const FORBIDDEN_ARGV = Object.freeze(['--fallback-model', '--dangerously-skip-permissions', '--api-key', '--auth-token', '--setting-sources=user', '--settings'])
export const FORBIDDEN_ENV = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL'])

const SECURITY_WORDS = /\b(security|secret|credential|auth(entication|orization)?|rls|privilege|grant|jwt|tenant isolation|issuer|signing|key custody|evidence|attestation)\b/i
/** complexity ∈ routine | complex | architecture. Deterministic from the submitted task; the task's risk_class can only raise it. */
export function classifyComplexity(task) {
  const text = `${task.requirements?.text ?? ''} ${(task.acceptance?.criteria ?? []).join(' ')}`
  const paths = task.scope?.allowed_paths ?? []
  if (task.requirements?.architecture === true || task.risk_class === 'security_sensitive' && /architect|redesign|new subsystem/i.test(text)) return 'architecture'
  if (task.risk_class !== 'routine' || SECURITY_WORDS.test(text) || paths.length > 12 || text.length > 6000) return 'complex'
  return 'routine'
}

/**
 * @param {{stage:string, task:object, escalated?:boolean, subscription:{admit:boolean, reason?:string}}} i
 * @returns {{ai:false, stage:string}|{ai:true, model:string, effort:string, reason_codes:string[]}|{ai:true, wait:true, code:string, model:string, effort:string}}
 */
export function routeStage({ stage, task, escalated = false, subscription = { admit: true } }) {
  if (NON_AI_STAGES.includes(stage)) return { ai: false, stage }
  const complexity = classifyComplexity(task)
  let pick; const reasons = [`complexity:${complexity}`]
  switch (stage) {
    case 'planning': pick = complexity === 'architecture' ? ['opus', 'high'] : complexity === 'complex' ? ['sonnet', 'high'] : ['sonnet', 'medium']; break
    case 'implementing': pick = escalated ? ['opus', 'high'] : complexity === 'routine' ? ['sonnet', 'medium'] : ['sonnet', 'high']; if (escalated) reasons.push('escalated_difficult_remediation'); break
    case 'independent_review': pick = ['sonnet', 'high']; break
    case 'security_review': pick = ['opus', 'high']; reasons.push('mandatory_security_review'); break
    case 'summarization': pick = ['haiku', 'low']; reasons.push('non_authoritative'); break
    default: return { ai: true, wait: true, code: 'ROUTE.UNKNOWN_STAGE', model: 'none', effort: 'none' }
  }
  const [model, effort] = pick
  if (!ALLOWED_PAIRS[model]?.includes(effort) || !CLI_EVIDENCE.efforts.includes(effort)) return { ai: true, wait: true, code: 'ROUTE.UNSUPPORTED_COMBINATION', model, effort }
  if (!subscription.admit) return { ai: true, wait: true, code: subscription.reason ?? 'ROUTE.SUBSCRIPTION_NOT_ADMITTING', model, effort } // never downgrade: wait
  return { ai: true, model, effort, reason_codes: reasons }
}

/** Refuse anything that could spend money, switch accounts or silently change model. Returns problem codes (empty = acceptable). */
export function checkInvocationSafety({ argv, envNames = [] }) {
  const codes = []
  for (const a of argv) {
    const name = String(a).split('=')[0]
    if (FORBIDDEN_ARGV.some((f) => f === name || String(a).startsWith(`${f}=`))) codes.push(`ROUTE.FORBIDDEN_ARGUMENT:${name}`)
  }
  for (const e of envNames) if (FORBIDDEN_ENV.includes(e) || /API_KEY|AUTH_TOKEN|OAUTH_TOKEN/.test(e)) codes.push(`ROUTE.FORBIDDEN_ENV:${e}`)
  return codes
}

/** Add `--effort` and verify the pair; the D3.3 `buildInvocation` argv is otherwise passed through untouched. D3.4 NEVER requests bypass permissions. */
export function withEffort(argv, route) {
  if (!route.ai || route.wait) return { ok: false, code: 'ROUTE.NOT_A_SESSION_ROUTE' }
  if (!ALLOWED_PAIRS[route.model]?.includes(route.effort)) return { ok: false, code: 'ROUTE.UNSUPPORTED_COMBINATION' }
  const unsafe = checkInvocationSafety({ argv })
  if (unsafe.length) return { ok: false, code: unsafe[0] }
  const i = argv.indexOf('--model')
  if (i < 0 || argv[i + 1] !== route.model) return { ok: false, code: 'ROUTE.ARGV_MODEL_MISMATCH' }
  return { ok: true, argv: [...argv, '--effort', route.effort] }
}

/** Actual model identity must belong to the requested family. Unknown/missing identity cannot satisfy a mandatory-risk stage. */
export function verifyActualModel({ requested, actual, mandatory = false }) {
  if (!MODEL_FAMILIES[requested]) return { ok: false, code: 'ROUTE.UNKNOWN_REQUESTED_MODEL' }
  if (typeof actual !== 'string' || !actual) return { ok: !mandatory, code: 'ROUTE.ACTUAL_MODEL_UNREPORTED', requested, actual: null }
  return MODEL_FAMILIES[requested].test(actual) ? { ok: true, requested, actual } : { ok: false, code: 'ROUTE.MODEL_SUBSTITUTED', requested, actual }
}

/** Parse the CLI's `--help` text into the facts routing depends on. Run INSIDE the guest by the trusted launcher at activation (gate G-CLI-EFFORT). */
export function parseCliHelp(text) {
  const efforts = (/--effort\s+<level>[\s\S]{0,200}?\(([a-z, ]+)\)/.exec(text)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return { has_effort: /--effort\s+<level>/.test(text), efforts, has_model: /--model\s+<model>/.test(text), has_fallback_model: /--fallback-model/.test(text) }
}
export const cliSupports = (caps, route) => caps.has_effort && caps.has_model && caps.efforts.includes(route.effort)
