// Developer Harness V3 (D3.3) — structured telemetry from the official CLI's `--output-format stream-json --verbose` stream.
//
// Pure, incremental, bounded. Reads ONLY fields the official CLI emits (documented in the Agent SDK reference, or observed live from the
// official binary — each fact carries its basis). Never invents a number: context utilization is reported only when the stream itself
// supplied both the context-window size and the per-request token usage; otherwise it is null and `context_basis` says why.
// Text content of messages is never retained (only sizes), so prompts/outputs/credentials cannot leak through telemetry records.
export const MAX_LINE_BYTES = 4 * 1024 * 1024

export function createTelemetry() {
  return { lines: 0, malformed: 0, oversize: 0, init: null, rate_limits: [], api_retries: [], compactions: 0, last_usage: null, context_window: null, result: null, assistant_messages: 0, models: new Set(), unknown_types: new Set() }
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/** Feed one line of stream-json. Returns the parsed event type (or null). */
export function feedLine(t, line) {
  t.lines += 1
  if (line.length > MAX_LINE_BYTES) { t.oversize += 1; return null }
  let e
  try { e = JSON.parse(line) } catch { t.malformed += 1; return null }
  if (!e || typeof e !== 'object') { t.malformed += 1; return null }
  switch (e.type) {
    case 'system':
      if (e.subtype === 'init') {
        t.init = { apiKeySource: typeof e.apiKeySource === 'string' ? e.apiKeySource : null, model: typeof e.model === 'string' ? e.model : null, permissionMode: typeof e.permissionMode === 'string' ? e.permissionMode : null,
          claude_code_version: typeof e.claude_code_version === 'string' ? e.claude_code_version : null, tools: Array.isArray(e.tools) ? e.tools.filter((x) => typeof x === 'string').slice(0, 200) : null,
          mcp_servers: Array.isArray(e.mcp_servers) ? e.mcp_servers.map((s) => (typeof s?.name === 'string' ? s.name : '?')).slice(0, 100) : null,
          plugins: Array.isArray(e.plugins) ? e.plugins.map((p) => ({ name: String(p?.name ?? '?').slice(0, 100), source: String(p?.source ?? '?').slice(0, 200) })).slice(0, 100) : null,
          served_by_anthropic: typeof e.served_by_anthropic === 'boolean' ? e.served_by_anthropic : null, session_id_present: typeof e.session_id === 'string' }
        if (t.init.model) t.models.add(t.init.model)
      } else if (e.subtype === 'api_retry') {
        t.api_retries.push({ attempt: num(e.attempt), error_status: num(e.error_status), error: typeof e.error === 'string' ? e.error.slice(0, 64) : null, retry_delay_ms: num(e.retry_delay_ms) })
        if (t.api_retries.length > 200) t.api_retries.shift()
      } else if (e.subtype === 'compact_boundary') t.compactions += 1
      break
    case 'rate_limit_event': {
      const i = e.rate_limit_info ?? {}
      const windows = {}
      if (i.unifiedWindows && typeof i.unifiedWindows === 'object') for (const [k, w] of Object.entries(i.unifiedWindows).slice(0, 8)) windows[String(k).slice(0, 32)] = { utilization: num(w?.utilization), resets_at: num(w?.resetsAt), status: typeof w?.status === 'string' ? w.status : null }
      t.rate_limits.push({ status: typeof i.status === 'string' ? i.status : null, resets_at: num(i.resetsAt), rate_limit_type: typeof i.rateLimitType === 'string' ? i.rateLimitType : null, utilization: num(i.utilization),
        overage_enabled: typeof i.overageEnabled === 'boolean' ? i.overageEnabled : null, overage_status: typeof i.overageStatus === 'string' ? i.overageStatus : null,
        overage_disabled_reason: typeof i.overageDisabledReason === 'string' ? i.overageDisabledReason : null, is_using_overage: typeof i.isUsingOverage === 'boolean' ? i.isUsingOverage : null,
        error_code: typeof i.errorCode === 'string' ? i.errorCode : null, windows })
      if (t.rate_limits.length > 200) t.rate_limits.shift()
      break
    }
    case 'assistant': {
      t.assistant_messages += 1
      const u = e.message?.usage
      if (typeof e.message?.model === 'string') t.models.add(e.message.model)
      if (u && typeof u === 'object') t.last_usage = { input_tokens: num(u.input_tokens), cache_read_input_tokens: num(u.cache_read_input_tokens), cache_creation_input_tokens: num(u.cache_creation_input_tokens), output_tokens: num(u.output_tokens), model: typeof e.message?.model === 'string' ? e.message.model : null }
      break
    }
    case 'result': {
      const mu = e.modelUsage && typeof e.modelUsage === 'object' ? e.modelUsage : {}
      const perModel = Object.fromEntries(Object.entries(mu).slice(0, 16).map(([m, v]) => [m, { context_window: num(v?.contextWindow), max_output_tokens: num(v?.maxOutputTokens), input_tokens: num(v?.inputTokens), output_tokens: num(v?.outputTokens),
        cache_read_input_tokens: num(v?.cacheReadInputTokens), cache_creation_input_tokens: num(v?.cacheCreationInputTokens), cost_basis: typeof v?.costBasis === 'string' ? v.costBasis : null }]))
      for (const [m, v] of Object.entries(perModel)) if (v.context_window) t.context_window = { model: m, tokens: v.context_window }
      t.result = { subtype: typeof e.subtype === 'string' ? e.subtype : null, is_error: e.is_error === true, num_turns: num(e.num_turns), terminal_reason: typeof e.terminal_reason === 'string' ? e.terminal_reason : null,
        api_error_status: num(e.api_error_status), errors: Array.isArray(e.errors) ? e.errors.map((x) => String(x).slice(0, 200)).slice(0, 10) : [], result_chars: typeof e.result === 'string' ? e.result.length : null,
        // total_cost_usd is the CLI's client-side LIST-PRICE ESTIMATE (observed costBasis "list"), not a charge. It is recorded, never used as billing.
        estimated_list_cost_usd: num(e.total_cost_usd), credential_expires_at: typeof e.credential_expires_at === 'string' ? e.credential_expires_at : null, per_model: perModel }
      break
    }
    default: if (typeof e.type === 'string' && t.unknown_types.size < 50) t.unknown_types.add(e.type.slice(0, 40))
  }
  return typeof e.type === 'string' ? e.type : null
}

/**
 * Context utilization of the MOST RECENT request = (input + cache_read + cache_creation + output tokens of the last assistant message) / context window.
 * Both numbers must come from the stream. The context window is known only from a `result` event's modelUsage (observed: contextWindow), so DURING a
 * long multi-turn session it may be unknown; D3.4 must then use the conservative fallback documented in 14-cli-capability-report.md.
 */
export function contextUtilization(t, { knownContextWindow = null } = {}) {
  const u = t.last_usage
  const window = t.context_window?.tokens ?? (Number.isFinite(knownContextWindow) ? knownContextWindow : null)
  const basis = t.context_window ? 'stream_result_modelUsage.contextWindow' : Number.isFinite(knownContextWindow) ? 'previously_observed_contextWindow_for_model' : null
  if (!u) return { utilization: null, used_tokens: null, window_tokens: window, context_basis: 'NO_USAGE_OBSERVED' }
  const parts = [u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens, u.output_tokens]
  if (parts.some((x) => x == null)) return { utilization: null, used_tokens: null, window_tokens: window, context_basis: 'USAGE_INCOMPLETE' }
  const used = parts.reduce((s, n) => s + n, 0)
  if (!window) return { utilization: null, used_tokens: used, window_tokens: null, context_basis: 'CONTEXT_WINDOW_NOT_REPORTED' }
  return { utilization: Math.round((used / window) * 10000) / 10000, used_tokens: used, window_tokens: window, context_basis: basis, compactions: t.compactions }
}

/** Expected-vs-actual check of the init event against what the launcher configured. Any mismatch → kill the session. */
export function verifyInit(init, expect) {
  const codes = []
  if (!expect || typeof expect !== 'object') return ['SESSION.EXPECTATION_MISSING']
  if (!init) return ['SESSION.INIT_MISSING']
  if (init.apiKeySource !== 'none') codes.push(`AUTH.API_KEY_SOURCE_ACTIVE:${String(init.apiKeySource).slice(0, 40)}`)
  if (init.served_by_anthropic === false) codes.push('AUTH.NOT_SERVED_BY_ANTHROPIC')
  if (expect.permissionMode && init.permissionMode !== expect.permissionMode) codes.push(`SESSION.PERMISSION_MODE_MISMATCH:${String(init.permissionMode).slice(0, 40)}`)
  if (expect.version && init.claude_code_version !== expect.version) codes.push('SESSION.VERSION_MISMATCH')
  // A field the expectation constrains but the CLI did not report is a mismatch (fail closed), never "nothing unexpected".
  if (Array.isArray(expect.mcpServers) && (!Array.isArray(init.mcp_servers) || init.mcp_servers.some((m) => !expect.mcpServers.includes(m)))) codes.push('SESSION.UNEXPECTED_MCP_SERVER')
  if (Array.isArray(expect.pluginSources) && (!Array.isArray(init.plugins) || init.plugins.some((p) => !expect.pluginSources.includes(p.source)))) codes.push('SESSION.UNEXPECTED_PLUGIN')
  if (Array.isArray(expect.tools) && (!Array.isArray(init.tools) || init.tools.some((x) => !expect.tools.includes(x)))) codes.push('SESSION.UNEXPECTED_TOOL')
  return codes
}
