// Developer Harness V3 (D3.4) — SIMULATED `--output-format stream-json` lines in exactly the shape observed from the official CLI (tests/fixtures/stream-observed-shape.jsonl).
// The engine feeds them through the REAL D3.3 telemetry parser (runtime/session-telemetry.mjs), so context utilization, model identity, compaction and rate-limit
// handling are exercised on the real parsing path. The numbers are scripted; nothing here claims to be a provider measurement.
export const MODEL_IDS = Object.freeze({ sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', haiku: 'claude-haiku-5-5' })

/**
 * @param {{model:string, version?:string, turns?:number, contextTokens?:number, contextWindow?:number|null, subtype?:string, rate?:'allowed'|'rejected', resetsAtSec?:number, apiErrorStatus?:number|null,
 *   permissionMode?:string, apiKeySource?:string, omitUsage?:boolean, compact?:boolean}} o
 */
export function streamLines(o) {
  const model = o.model; const lines = []
  lines.push({ type: 'system', subtype: 'init', cwd: '/work/task', session_id: '00000000-0000-4000-8000-000000000000', tools: [], mcp_servers: [], model, permissionMode: o.permissionMode ?? 'dontAsk', apiKeySource: o.apiKeySource ?? 'none', claude_code_version: o.version ?? '2.1.331', plugins: [], served_by_anthropic: true })
  if (o.compact) lines.push({ type: 'system', subtype: 'compact_boundary' })
  const turns = o.turns ?? 1
  for (let i = 1; i <= turns && !o.omitUsage; i += 1) {
    const total = o.contextTokens ?? 5000
    lines.push({ type: 'assistant', message: { model, type: 'message', role: 'assistant', content: [{ type: 'text', text: '[simulated]' }], usage: { input_tokens: 2, cache_creation_input_tokens: Math.floor(total * 0.1), cache_read_input_tokens: Math.floor(total * 0.8) - 2, output_tokens: total - Math.floor(total * 0.1) - (Math.floor(total * 0.8) - 2) - 2 } } })
  }
  const rejected = o.rate === 'rejected'
  lines.push({ type: 'rate_limit_event', rate_limit_info: { status: rejected ? 'rejected' : 'allowed', resetsAt: o.resetsAtSec ?? 1795563600, rateLimitType: 'five_hour', overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', isUsingOverage: false,
    unifiedWindows: { five_hour: { utilization: rejected ? 1 : 0.08, resetsAt: o.resetsAtSec ?? 1795563600, status: rejected ? 'rejected' : 'allowed' }, seven_day: { utilization: 0.01, resetsAt: 1795860000, status: 'allowed' } } } })
  const res = { type: 'result', subtype: o.subtype ?? 'success', is_error: rejected || (o.subtype && o.subtype !== 'success' && o.subtype !== 'error_max_turns'), num_turns: turns, total_cost_usd: 0.001, result: '[simulated]', terminal_reason: 'completed', api_error_status: o.apiErrorStatus ?? (rejected ? 429 : null),
    credential_expires_at: '2026-12-22T08:46:11.014Z' }
  if (o.contextWindow !== null) res.modelUsage = { [model]: { inputTokens: 2, outputTokens: 4, cacheReadInputTokens: 1, cacheCreationInputTokens: 1, contextWindow: o.contextWindow ?? 200000, maxOutputTokens: 64000, costBasis: 'list' } }
  lines.push(res)
  return lines.map((l) => JSON.stringify(l))
}
