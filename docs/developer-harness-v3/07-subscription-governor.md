# Developer Harness V3 — 07 Subscription Governor (architecture + launch guard)

The owner's subscription is **Claude Max 5x** (upgraded from Pro during D3.2; owner-reported, the harness does not measure it). **Paid extra usage stays disabled; no API billing; no paid fallback; nothing is purchased automatically.** A plan change never authorizes spending. This governs *developer automation*, not PatelRep's separately governed customer-facing AI.
*developer automation*, not PatelRep's separately governed customer-facing AI.

Implemented in D3.2: `authority/spend.mjs` (launch-authentication and credential-environment checks), the `spend`/`launch_environment` checks in the evaluator,
and prohibited actions for paid authentication, purchases and spend-authority changes (all tested). **Usage detection, scheduling and resumption are design.**

## 1. Documentation facts relied on (retrieved 2026-11-24; re-verify before D3.3)

| Fact | Source |
|---|---|
| In non-interactive `-p` mode `ANTHROPIC_API_KEY` in the environment is always used, even when logged in with a subscription, and is billed at API rates; subscription OAuth ranks low in the credential order | code.claude.com/docs/en/authentication; support article "Manage API key environment variables in Claude Code" |
| `claude setup-token` creates a long-lived subscription OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) for CI; runs then draw on the subscription | code.claude.com/docs/en/github-actions |
| `--bare` ignores `CLAUDE_CODE_OAUTH_TOKEN` | code.claude.com/docs/en/iam |
| Subscription usage counts against a rolling 5-hour window and a 7-day window; blocked until the reset shown | code.claude.com/docs/en/errors |
| The SDK stream can emit `rate_limit_event` with `status` (`allowed`, `allowed_warning`, `rejected`), `resets_at` and `rate_limit_type` | Agent SDK reference |
| `CLAUDE_CODE_RETRY_WATCHDOG=1` retries 429/529 indefinitely in unattended runs and can recheck claude.ai limits | environment variables reference |
| Anthropic does not allow routing requests through Free/Pro/Max credentials *on behalf of others*; plan limits assume ordinary, individual usage | code.claude.com/docs/en/legal-and-compliance |
| `--dangerously-skip-permissions` is for isolated environments; Claude Code refuses it as root on Linux/macOS | code.claude.com permission-modes / devcontainer |

**Not documented / not verified:** whether a headless run emits `rate_limit_event` or merely exits when the limit is hit; the exact exit code and text; the Pro model list and per-plan
Opus availability at run time; whether `claude auth status` has a machine-readable form. D3.3 must **test these empirically** rather than assume them.

## 2. Authentication guard (implemented)

A session launch is allowed only if **all** hold; otherwise it fails closed:

1. No forbidden variable *name* is present (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, Bedrock/Vertex/Foundry switches,
   `AWS_BEARER_TOKEN_BEDROCK`, other providers' API keys). Names are case-insensitive (Windows).
2. No forbidden *setting* (`apiKeyHelper`, cloud credential helpers, `forceLoginMethod: console`).
3. The **trusted launcher** supplies a positive verification: source `claude_subscription_oauth`, a **canonical plan identity** the owner has authorized, `extra_usage_enabled: false`, `verified_by: launcher`.
   Anything missing, unknown or self-reported by the worker is `AUTH.UNVERIFIED`; a plan outside the canonical vocabulary is `AUTH.PLAN_UNKNOWN`; a known plan the owner has not authorized is `AUTH.PLAN_NOT_AUTHORIZED`; extra usage on or unverified is `AUTH.EXTRA_USAGE_ENABLED` / `AUTH.EXTRA_USAGE_UNVERIFIED`.
4. `incremental_usd` is `0`; `purchase` is false.
5. The launch environment is constructed from an allow-list (never inherited from the parent shell) and contains no credential-shaped name; `CLAUDE_CODE_OAUTH_TOKEN`
   is forbidden in workers (it would be an exported credential).

The harness does not collect, proxy, scrape, export or intermediate Claude credentials, does not modify the Claude binary, and uses no third-party OAuth workaround. The owner logs in once,
interactively, inside the worker VM.

### 2a. Plan model (canonical identities; provider normalization is D3.3)

`contract.subscription` holds `known_plans` (the canonical vocabulary: `claude_free`, `claude_pro`, `claude_max_5x`, `claude_max_20x`, `claude_team`, `claude_enterprise`) and `authorized_plans` (currently only `claude_max_5x`).
These are **internal identities**. The harness does **not** know, assume or hardcode what string the official CLI or any API uses to report a plan: the **trusted launcher must normalize** the CLI's own report into one of
these identities in D3.3, and anything it cannot normalize with confidence it must report as absent (which fails closed as `AUTH.PLAN_UNKNOWN`). The plan model is deliberately **independent of money**: authorizing a plan
changes nothing about `limits.max_incremental_usd` (0), paid extra usage must be positively verified off for every plan, and API-key, cloud-provider and gateway authentication stay prohibited. Changing `authorized_plans`
(for example to re-admit Pro or to admit Max 20x) is a root-of-trust change: an owner ceremony, never an automated promotion. Max-tier usage limits and reset behavior are **NOT MEASURED** and must not be assumed to equal Pro's.

### 2b. Behavior-sensitive environment values

`NODE_OPTIONS`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and `SSL_CERT_FILE` change what a worker executes and where its traffic goes. They are on the worker allow-list **only because their VALUES come exclusively from the trusted launcher**:
the launcher reports an origin label per **exact** name (never the value), and anything other than the string `trusted_launcher`, a missing label, an inherited or ambiguous label (two keys differing only by case), two spellings of one controlled
variable in the same environment (`https_proxy` and `HTTPS_PROXY` are different variables on the Linux worker), or the same name appearing in the repository-controlled settings `env` is refused (`ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER`).
The repository-controlled settings `env` block may set only a tiny inert list (`settings_env_inert_allowlist`: `TZ`, `LANG`, `TERM`; `CI` and `NODE_ENV` change tool behavior and are launcher-set only); `PATH`, `HOME`, `SHELL`, `TMPDIR`, `XDG_*` and every other name is `ENV.SETTINGS_ENV_NOT_ALLOWED`.
**Requirement preserved:** the VALUES of behavior-sensitive variables, including `NODE_OPTIONS` and the proxy settings, originate exclusively from the trusted launcher; the evaluator only sees names and origin labels, so D3.3 must make the launcher the sole writer of those values.
Both lists are part of the pinned contract; shrinking the launcher-controlled list or widening the inert list is a weakening, and the launch block is shape-checked before any name is compared.

## 3. Scheduling policy (design)

- **One** reasoning session at a time (`limits.max_reasoning_sessions = 1`); independent and security reviews run **sequentially**, never nested; context packs and
  checkpoints are reused so a resumed task does not re-read the world.
- **Models:** Sonnet-first for implementation; Opus only for complex or security-sensitive steps and only when the account exposes it (discovered at run time, never assumed); Haiku-class for classification.
  Effort is raised only where the risk class demands it.
- **Priority:** critical incidents → security → owner-requested work → noncritical maintenance. Owner overrides allowed. Maintenance never preempts owner work.
- **Shared allowance:** local V3 sessions and the three GitHub workflows that use the same subscription token (finding N-2) draw from one pool. The governor treats GitHub-side usage as unobservable
  background and keeps headroom rather than assuming exclusivity.

## 4. Limit handling (design; the contract already encodes the state machine)

When the allowance is exhausted: (1) preserve the task and context references; (2) stop issuing AI calls; (3) record the **provider-reported** reset time if one is available; (4) continue deterministic
work (CI watching, staging monitoring, notifications, resource management); (5) move the task to `waiting_subscription` with reason `SUBSCRIPTION_LIMIT`; (6) resume automatically after the allowance returns.
If no reset time is available, retry on a conservative bounded schedule (proposed: exponential from 15 min to a 60 min cap, with jitter) — a proposal, not a measurement. **No reset time or usage
percentage is ever invented.** Quota exhaustion is **never** a genuine blocker (`never_blocked_reasons`, tested in the lifecycle reducer). The only subscription-related genuine blocker is
`OWNER_AUTH_EXPIRED`. The governor never tries to evade a provider limit, never enables paid usage and never buys credits; any mechanism that needs API billing is rejected.

## 5. Metrics

Provider usage numbers, reset times and per-model consumption are recorded **only when the official CLI or API reports them**; otherwise the field is `NOT MEASURED`. D3.2 consumed
subscription allowance for this session; the exact amount is **NOT MEASURED** (no supported read path was used).

## 6. Existing workflows audited

`autonomous-feature-builder.yml` (dispatch only), `claude-release-engineer.yml` (dispatch + `workflow_run`), `dependency-orchestrator.yml` (dispatch, `workflow_run`, schedule; **paused**
by repository variable) use `anthropics/claude-code-action@v1` with `CLAUDE_CODE_OAUTH_TOKEN`; none references `ANTHROPIC_API_KEY`. `ci.yml` sets `ANTHROPIC_API_KEY: "test-key"` as a **test
placeholder** for unit tests, not a real key. No GitHub workflow was changed.

## 7. Policy risk for the owner (not a code issue)

Anthropic states that plan limits assume ordinary, individual usage. A continuously running autonomous harness, even on a Max plan, may stray from that. This is an owner/provider-terms question; V3 reduces
exposure by serialising sessions, reusing context and obeying limits, but it cannot make the question go away. Recorded for the owner in the D3.3 handoff.
