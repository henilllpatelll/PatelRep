# Developer Harness V3 — 14 Claude Code CLI Capability Verification (D3.3)

Retrieved / observed **2026-11-24** against the official CLI **2.1.331** (`C:\Users\<owner>\.local\bin\claude.exe`, native build) and the
official Linux package `@anthropic-ai/claude-code-linux-x64@2.1.331` (npm integrity pinned in `scripts/developer-harness-v3/infra/artifacts.json`).
Every row says where the fact comes from. **LIVE** = observed from the official binary on this account; **DOC** = official documentation
(code.claude.com / support.claude.com / anthropic.com, URLs below); **SYNTHETIC** = only tested against fixtures; **NOT VERIFIED** = unknown.

## 1. Live observations (host, one bounded call)

Exactly **one** headless request was made from the host for this report: `claude -p "Reply with the single word OK." --model haiku --max-turns 1
--tools "" --output-format stream-json --verbose --no-session-persistence --safe-mode --strict-mcp-config`, from an empty scratch directory with an
allow-listed environment (no `CLAUDE_*`, no tokens, no proxies). `claude auth status --json` was read twice. Identifying fields (email, org) were
redacted by the script before printing and are not recorded anywhere.

| Fact | Value observed | Basis |
|---|---|---|
| `auth status --json` fields | `loggedIn, authMethod, apiProvider, analyticsDisabled, projectsDirectory, configDirectory, loginExpiresAt, consoleProfileSignInOffered, email, orgId, orgName, subscriptionType, storedClaudeAiLogin, planTier` | LIVE |
| `authMethod` / `apiProvider` | `claude.ai` / `firstParty` | LIVE (authMethod values DOC) |
| `subscriptionType` / `planTier` | `max` / `max_5x` | LIVE, **undocumented fields** |
| `loginExpiresAt` | an ISO date ~4 weeks ahead | LIVE + DOC (v2.1.318+) |
| extra-usage field in `auth status` | **absent** | LIVE |
| `system/init.apiKeySource` | `none` | LIVE (values DOC) |
| `system/init.served_by_anthropic` | `true` | LIVE, undocumented |
| `system/init.permissionMode` | `auto` (from the owner's host user settings — the worker must pin its own) | LIVE |
| `--safe-mode` + init `plugins` | installed plugins are still **listed** in init (6 entries) | LIVE — the worker has none installed, and the launcher kills a session whose init lists an unexpected plugin |
| `rate_limit_event.rate_limit_info` | `status:"allowed"`, `resetsAt` (epoch s), `rateLimitType:"five_hour"`, **`overageStatus:"rejected"`, `overageDisabledReason:"org_level_disabled"`, `isUsingOverage:false`**, `unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt,status}` | LIVE; `status`/`resetsAt`/`utilization` DOC, the overage triple and `unifiedWindows` **undocumented** |
| Subscription utilization at probe time | five-hour **0.08**, seven-day **0.01** | LIVE (provider-reported) |
| `result.total_cost_usd` | `0.00049409`, with `modelUsage.*.costBasis:"list"` | LIVE — a **client-side list-price estimate, not a charge** (DOC: "client-side cost estimate"). Never used as billing. |
| `result.modelUsage.<model>.contextWindow` | `1000000` (claude-haiku-5-5), `maxOutputTokens 128000` | LIVE + DOC |
| per-request usage | `assistant.message.usage.{input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens}` | LIVE + DOC |
| `result.credential_expires_at` | ISO date | LIVE + DOC |
| `--bare` | "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper … (OAuth and keychain are never read)" | LIVE `--help` + DOC → **unusable** under the subscription-only policy |
| `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--permission-mode bypassPermissions`, `--setting-sources`, `--strict-mcp-config`, `--safe-mode`, `--no-session-persistence`, `--tools ""` | present | LIVE `--help` |

**Not run:** `--dangerously-skip-permissions` was **not** executed anywhere (host or VM). No real Bypass Permissions smoke test was authorized; flag
availability is from `--help` only, and invocation construction is proven with synthetic processes (`tests/d33-launcher.test.mjs`).

## 2. Documentation facts (re-verified 2026-11-24)

| Topic | Fact | Source |
|---|---|---|
| Auth precedence | cloud provider → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → profile/federation → subscription OAuth from `/login`; in `-p` an `ANTHROPIC_API_KEY` "is always used when present" | code.claude.com/docs/en/authentication |
| Credential storage (Linux) | `~/.claude/.credentials.json`, mode 0600 (moves under `CLAUDE_CONFIG_DIR`) | same |
| `auth status` | JSON by default, `--text`; exit 0 logged in / 1 not; documents `authMethod`, `loginExpiresAt`, `configDirectory` only | code.claude.com/docs/en/cli-reference |
| Plan tiers | Max = 5× Pro per five hours and per week; **"Max 20x" is now called "Ultra"** | support.claude.com articles 11049741, 17728952 |
| Limit windows | five-hour session limit + weekly limit; requests blocked until the reset shown | support 11145838; code.claude.com/docs/en/errors |
| Headless at the limit | the interactive auto-continue wait is not available for `-p` runs | code.claude.com/docs/en/interactive-mode |
| Extra usage | now "usage credits", toggled by the owner in Settings → Usage; `rate_limit_info.overageEnabled` is reported only on `allowed_warning` events (v2.1.295+) | code.claude.com/docs/en/costs; Agent SDK reference |
| Stream schema | `system/init` (`apiKeySource`, model, tools, mcp_servers, permissionMode, plugins…), `system/api_retry` (`error` incl. `rate_limit`, `overloaded`, `billing_error`), `system/compact_boundary` (`trigger`, `pre_tokens`), `result` subtypes `success | error_max_turns | error_during_execution | error_max_budget_usd | …` | Agent SDK TypeScript reference, headless docs |
| Status line | `context_window.{context_window_size, used_percentage, remaining_percentage, current_usage}`, `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` (interactive status line only) | code.claude.com/docs/en/statusline |
| Network | required: `api.anthropic.com`, `claude.ai`, `claude.com`, `platform.claude.com` (OAuth exchange/refresh/revocation), `downloads.claude.ai` (updater), `registry.npmjs.org`, `mcp-proxy.anthropic.com`; telemetry: Datadog intake hosts; `HTTPS_PROXY`/`NO_PROXY` honoured | code.claude.com/docs/en/network-config |
| Managed settings (Linux) | `/etc/claude-code/managed-settings.json`; nothing at user/project/local/`--settings` overrides them; `allowManagedHooksOnly`, `disableAllHooks`, `allowManagedPermissionRulesOnly`, `allowManagedMcpServersOnly`, `strictKnownMarketplaces`; `permissions.disableBypassPermissionsMode:"disable"` rejects the flag | code.claude.com/docs/en/managed-settings, settings reference |
| Root | `--dangerously-skip-permissions cannot be used with root/sudo privileges` | code.claude.com/docs/en/permission-modes |
| Containers | do not prevent exfiltration of "the Claude Code credentials stored in ~/.claude" | code.claude.com/docs/en/devcontainer |
| Retries | default 10 retries; `CLAUDE_CODE_RETRY_WATCHDOG=1` retries 429/529 indefinitely for unattended sessions; 529 does not count against quota | code.claude.com/docs/en/errors, env-vars |
| Terms | plan limits "assume ordinary, individual usage of Claude Code and the Agent SDK"; Consumer Terms §3 prohibit access "through automated or non-human means, whether through a bot, script, or otherwise" **except via an API key or where Anthropic explicitly permits it**; signing in to the unmodified binary with one's own subscription is allowed; `setup-token` is described "for CI and scripts" | code.claude.com/docs/en/legal-and-compliance; anthropic.com/legal/consumer-terms |

## 3. Decisions taken from these facts

1. **Plan normalization** (`subscription-governor.mjs normalizeAuthStatus`): `authMethod "claude.ai"` (+ `apiProvider "firstParty"` when present) →
   source `claude_subscription_oauth`; the plan only from the **exact observed pair** `subscriptionType "max"` + `planTier "max_5x"` → `claude_max_5x`
  . Anything else (`max_20x`, `ultra`, casing changes, missing) → plan `null` →
   `AUTH.PLAN_UNKNOWN`. Basis recorded as *observed, undocumented field*. A login status alone never yields a plan.
2. **Extra usage** (`extraUsageFromRateLimits`; the stream is relayed from the untrusted guest, so this is defence in depth — the real control is usage credits OFF in the owner's account): `false` only from the documented `overageEnabled:false` **or** the exact observed triple
   (`overageStatus "rejected"` + `overageDisabledReason "org_level_disabled"` + `isUsingOverage false`); `out_of_credits` or any other reason is **not**
   "disabled" (credits could be bought). Any enabled/active signal wins and kills the session. Because the fact exists only inside a request's
   stream, D3.3 adds the explicit, owner-attested **subscription probe** (`isolation/subscription-probe.mjs`, one minimal Haiku request with no
   tools, one-shot owner attestation that expires after 24 h) to obtain it; see 16 §2 O-3 and 17 §2. The verified-off fact expires after 6 h and is refreshed by every session's own stream.
3. **`total_cost_usd` is never spend.** Spend authority stays `max_incremental_usd = 0`; `--max-budget-usd` is not used (it is a client estimate that "can pass the cap").
4. **`--bare` is not used** (API-key only). The worker uses `--setting-sources ""` + `--strict-mcp-config` (+ `--safe-mode` for probes) + root-owned
   managed settings, so repository/user settings, hooks, plugins and MCP servers cannot load, including after preflight.
5. **`CLAUDE_CODE_RETRY_WATCHDOG` is not set**: an indefinitely retrying session would hold the single reasoning slot; the governor waits instead.
6. **Runtime egress allow-list** = `api.anthropic.com`, `platform.claude.com` (token refresh). `claude.ai`/`claude.com` only in the owner-login profile.
   Telemetry, updater, npm, GitHub and MCP-proxy hosts are denied (the binary is pinned and root-owned; auto-update cannot install). Measured login
   egress is recorded in `evidence/login-egress.json` when the owner logs in (**not yet measured**: the owner has not logged in inside the VM).

## 4. Context telemetry for D3.4 (70 % renewal)

| Need | Available in headless stream-json? | Notes |
|---|---|---|
| context-window capacity | **yes, at `result`** (`modelUsage.<model>.contextWindow`) | not in `init`; during a long multi-turn session it is known only from a previous result for the same model |
| used context | **yes, per request** (sum of the four usage fields of the latest `assistant` message) | LIVE fields |
| utilization % | **derived only** = used / window; `contextUtilization()` returns null unless both numbers came from the stream | the status-line `used_percentage` is documented but is an interactive surface, not stream-json — **NOT VERIFIED** for `-p` |
| session identity | `session_id` in every event (not retained in records) | |
| native compaction | `system/compact_boundary` with `pre_tokens` | DOC; **not observed** (no long session was run) |
| safe stopping boundaries | `result` event (end of a `-p` run); `--max-turns` bounds a run | multi-turn interruption mid-tool is NOT VERIFIED |
| completion / interruption | `result.subtype`, `terminal_reason`, process exit | `terminal_reason:"completed"` LIVE |

**Recommendation for D3.4:** drive sessions as bounded `-p` runs (`--max-turns N`) so each run ends at a `result` boundary; compute utilization from the
last request's usage and the window learned from the model's previous `result`; renew at the owner's 70 % threshold when both are known; when the
window is unknown, renew at step boundaries after a bounded number of turns (conservative fallback). Never present a guessed percentage.

## 5. Not verified (explicit)

Headless behaviour **at** the limit (exit code, whether `rate_limit_event status:"rejected"` precedes exit) — modelled from DOC and tested only on
SYNTHETIC fixtures, deliberately not reproduced (it would burn the owner's allowance) · login egress hosts · the `planTier` string for Ultra ·
`--dangerously-skip-permissions` behaviour inside the VM · `--setting-sources ""` effect inside the VM (requires the owner login) · whether `.claude.json`
reduced by the residue sanitizer keeps the login usable (requires the owner login).
