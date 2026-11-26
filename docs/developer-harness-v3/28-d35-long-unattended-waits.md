# Developer Harness V3 — 28 D3.5 long unattended subscription waits (G-UNATTENDED-LONG-WAIT)

## The problem
The extra-usage-OFF fact lives 6 h (`GOVERNOR_DEFAULTS.extra_usage_fact_ttl_ms`, unchanged). Only a session's own provider stream refreshes it. A weekly quota reset therefore ends with a stale fact, and D3.4 turned that into a per-task `blocked` (one owner block AND one `ownerResolve` per task).

## Research (2026-11-26; pinned guest CLI 2.1.331, host CLI 2.1.332)
* `claude --help` (host): no `usage`/billing subcommand; `claude auth status` reports authentication only.
* Official documentation: `/usage` shows plan limits and a usage-credits row only when credits are on; `/usage-credits` (formerly `/extra-usage`) opens the settings in a browser — both are **interactive in-session commands**, not an unattended, machine-readable interface ([Commands](https://code.claude.com/docs/en/commands), [Manage costs](https://code.claude.com/docs/en/costs), [Usage credits](https://support.claude.com/en/articles/12429409-manage-extra-usage-for-paid-claude-plans)). `claude auth status --json` documents `authMethod`, config directory and login expiry; community reports show `subscriptionType` but no billing setting ([CLI reference](https://code.claude.com/docs/en/cli-reference)). A `claude usage` command is an open feature request ([anthropics/claude-code#44328](https://github.com/anthropics/claude-code/issues/44328)).
* Not done, deliberately: running `claude -p "/usage"` or any session to find out — in print mode the text may be sent to the model (billable), which the brief forbids.

**Conclusion: no supported, non-billable, unattended verification exists.** The owner re-verification (D3.3 doc 07: `dh3 attest-extra-usage-off` + the bounded `dh3 probe-subscription`) remains a genuine owner step. Gate G-UNATTENDED-LONG-WAIT stays **open**.

## What D3.5 changes (engine `checkAdmission`, `billingPackage`, `reverifyBilling`)
* A fact that says OFF, is well-formed and not future-dated but is merely **stale** → `waiting_subscription` (`BILLING_REVERIFICATION_REQUIRED` under P6, `SUBSCRIPTION_LIMIT` today) with a 15-min deterministic re-check — **no AI work starts**.
* ONE consolidated owner package per stale fact for the whole controller (deduplicated by the fact's timestamp), stating the exact owner step and why it is not automatic. No task is blocked; no per-task owner action exists; every task resumes by itself once the fact is fresh. Three waiting tasks → one owner involvement in total (tested).
* Unchanged fail-closed cases: extra usage ENABLED, an unknown or malformed fact, a future-dated fact, `auth_expired` / `auth_unverified` / `unauthorized_billing` → owner block.
* An old attestation is never permanent: the next stale period needs a new re-verification (tested).
* An optional adapter method `subscription.reverifyExtraUsage()` is honoured only if it reports `supported:true, billable:false`, an explicit OFF, a basis and a timestamp ≤ 60 s old; ENABLED → owner block; anything else is ignored. **No live adapter implements it**; it is exercised only as a SIMULATED source (zero interventions in simulation).

Intentional D3.4 expectation change: the two F1 tests in `d34-rem-f1-readmission.test.mjs` now expect `waiting_subscription` with `BILLING.REVERIFICATION_REQUIRED` instead of `blocked` (same safety: no unit ran, work preserved, one owner package).
