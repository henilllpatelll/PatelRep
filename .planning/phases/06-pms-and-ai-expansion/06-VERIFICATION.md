---
phase: 06-pms-and-ai-expansion
verified: 2026-07-28T23:15:00Z
status: passed
score: 20/20 must-haves verified
overrides_applied: 0
---

# Phase 6: PMS and AI expansion Verification Report

**Phase Goal:** Verify, harden, and gate the already-shipped AI copilot expansion and Opera PMS integration to production-trust standard, fixing any real bugs found in-phase — before any new AI/PMS capability work.
**Verified:** 2026-07-28T23:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Merged from all 5 plans' `must_haves.truths` (this phase has no ROADMAP success_criteria array distinct from the plan-level truths; traceability anchor is D-01..D-06 in 06-CONTEXT.md).

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | credits_charged varies with real prompt_tokens/completion_tokens, not a flat CREDIT_COSTS lookup (06-01) | VERIFIED | `apps/api/middleware/credits.py:42-55` `compute_credits()` computes from `MODEL_RATES`/tokens; `CREDIT_COSTS` retained only as floor (line 54, not deleted). `check_and_deduct_credits` signature takes `prompt_tokens`/`completion_tokens` (line 58-63). |
| 2 | Exactly one ai_interactions row per SOP query via /ai/copilot/chat (06-01) | VERIFIED | `apps/api/services/ai/sop_rag.py` `query_sop()` has no internal `ai_interactions`/`log_ai_interaction` write (grep confirms zero write-side calls); only `routers/ai_copilot.py:438` (sop_query branch's shared final `log_ai_interaction`) writes. Second caller `routers/sop.py::query_sop_endpoint` independently logs exactly once per its own call (lines 231, 245 are alternate error/success branches, not double-writes). |
| 3 | Every intent branch of copilot_chat deducts credits AFTER the parser returns real token counts (06-01) | VERIFIED | Grepped all 6 `check_and_deduct_credits(...)` call sites in `ai_copilot.py` (lines 251, 274, 294, 314, 346, 383) — each immediately follows `prompt_tokens = result[...]` assignment on the preceding lines. |
| 4 | Full API test suite passes, no regression (06-01) | VERIFIED | `python -m pytest tests/ -q` → 496 passed, 0 failures (independently re-run, not taken from SUMMARY). |
| 5 | tenants.opera_pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE exists in the live Supabase DB (06-02) | VERIFIED | Migration file `supabase/migrations/085_opera_pilot_flag.sql` matches spec exactly (column + comment + rollback). Live-DB application corroborated by 3 independent sources: 06-02-SUMMARY's `information_schema.columns` verification, STATE.md's escalation record, and 06-UAT.md's live Playwright observation of a real 403 from `GET /integrations/opera/status` against freshly-restarted code (behavioral proof the column exists with default FALSE in production). |
| 6 | All 7 /integrations/opera/* endpoints return 403 for a hotel whose opera_pilot_enabled is FALSE (06-02) | VERIFIED | `apps/api/routers/integrations.py` — `_require_opera_pilot()` defined once (line 17-22) and called at the top of all 7 handlers: opera_connect (35), opera_status (80), opera_sync (107), list_opera_sync_conflicts (124), resolve_opera_sync_conflict (143), opera_test (187), opera_disconnect (204). Bug-449-safe guard (`if not result or not result.data`) used. |
| 7 | A pilot-enabled hotel can reach the Opera endpoints (subject to normal RBAC) (06-02) | VERIFIED | `test_opera_pilot_gate.py` (11 tests, all passing) asserts pass-through when `opera_pilot_enabled=True`; guard only raises on falsy/missing flag. |
| 8 | Reservation-sync cron skips non-pilot hotels via services/opera/sync.py::sync_reservations (06-02) | VERIFIED | `apps/api/services/opera/sync.py:176-178` — pilot check inside `sync_reservations()` (the function both `internal.py`'s cron and `integrations.py::opera_sync` call), before any OHIP request. |
| 9 | Cross-tenant Opera credential/conflict reads return 404/empty, zero cross-tenant writes (06-02) | VERIFIED | `test_opera_routes.py` (10 tests, passing) includes tenant-isolation assertions; `.eq("tenant_id", ...)` present at all read/write sites in integrations.py. |
| 10 | Per-role RBAC holds on every Opera endpoint (06-02) | VERIFIED | `require_role("gm")` on connect/sync/test/disconnect; `require_role("gm","chief_engineer")` on conflicts list/resolve; `get_current_user` only on status — matches the RBAC map, proven by test_opera_routes.py's RBAC matrix. |
| 11 | Role-gated AI endpoints (/ai/recommendations, /ai/recommendations/metrics) 403 floor roles, pass for gm/chief_engineer/housekeeping_supervisor (06-03) | VERIFIED | `ai_copilot.py:710,724` — both `require_role("gm","chief_engineer","housekeeping_supervisor")`. Note: `/ai/insights` has no POST role-gated variant in code (only a GET, intentionally open) — documented, tested scope correction in 06-03-SUMMARY, not a silent gap; matches the plan's own explicit fallback instruction. |
| 12 | Intentionally-open endpoints (chat, task/WO/guest-request confirm) accept any authenticated role (06-03) | VERIFIED | `test_ai_copilot_rbac.py::test_open_endpoints_accept_any_role` (part of 21 passing tests) asserts no `require_role` dependency on these routes. |
| 13 | /ai/assignments/confirm remains gm/housekeeping_supervisor/engineer only, housekeeper excluded (06-03) | VERIFIED | Confirmed via passing `test_assignments_confirm_excludes_housekeeper`. |
| 14 | confirm_tasks accepts a typed Pydantic model, returns 422 not 500 on malformed input (06-03) | VERIFIED | `models/requests.py:998` `class TaskPreview(SanitizedBaseModel)`; `ai_copilot.py:497` signature is `tasks: list[TaskPreview]`; grep for raw `task["title"]` dict access in confirm_tasks returns nothing. |
| 15 | Cross-tenant confirm writes scoped to current_user.hotel_id (06-03) | VERIFIED | `test_confirm_tasks_tenant_scoped` passing; inserts use `current_user.hotel_id`, not client-supplied. |
| 16 | _verify_opera_signature validates against per-hotel opera_credentials.webhook_secret, not CRON_SECRET (06-04) | VERIFIED | `webhooks.py:40` signature takes `webhook_secret: str | None` param, keys HMAC on it (line 58); no `cron_secret`-derived Opera key anywhere in the file. |
| 17 | Correct-secret payload passes; CRON_SECRET-signed payload fails (06-04) | VERIFIED | `test_opera_webhooks.py` (10 tests, passing) includes `test_signature_accepts_webhook_secret` / `test_signature_rejects_cron_secret_key` / fail-closed-on-missing-secret. |
| 18 | Webhook for a non-pilot hotel is a silent no-op, zero DB writes (06-04) | VERIFIED | `webhooks.py:98-101` reads `tenants.opera_pilot_enabled`, returns ignored-shape before signature check/dispatch on falsy. |
| 19 | Each event handler updates room_status + inserts room_status_history with change_source=opera_webhook, tenant-scoped (06-04) | VERIFIED | Dispatch-handler tests in `test_opera_webhooks.py` assert this per-handler. |
| 20 | Full suite green + web type-check green + live GM walkthrough zero console errors (06-05) | VERIFIED | `pytest tests/ -q` → 496 passed (independently re-run). `cd apps/web && npm run type-check` → exit 0, no errors (independently re-run). Live walkthrough documented in 06-UAT.md with a genuinely fresh-server re-verification (after diagnosing and discarding a stale-process false pass) and a real bug found-and-fixed (`df9317f9`, confirmed present in `git log` and in the file: `!statusQuery.isError` guard at `integrations/page.tsx:348`). |

**Score:** 20/20 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/tests/test_ai_copilot_credits.py` | D-02 credit-accounting + double-log tests | VERIFIED | Exists, 3 `def test_` functions, all passing, no `SimpleNamespace(data=None)`. |
| `apps/api/middleware/credits.py` | Token-derived credit computation | VERIFIED | `MODEL_RATES`, `compute_credits()`, `prompt_tokens`/`completion_tokens` params present. |
| `apps/api/services/ai/sop_rag.py` | SOP RAG with internal log removed | VERIFIED | No internal `ai_interactions` write; still returns `prompt_tokens`. |
| `supabase/migrations/085_opera_pilot_flag.sql` | opera_pilot_enabled column | VERIFIED | File matches spec; applied live (corroborated by 3 independent sources — see Truth 5). |
| `apps/api/tests/smoke/test_opera_routes.py` | RBAC + tenant-isolation for 7 Opera endpoints | VERIFIED | 10 `def test_` functions, all passing. |
| `apps/api/tests/test_opera_pilot_gate.py` | D-03 pilot-flag enforcement tests | VERIFIED | 11 `def test_` functions, all passing, `opera_pilot` referenced. |
| `apps/api/routers/integrations.py` | Pilot-flag guard on every Opera endpoint | VERIFIED | `_require_opera_pilot` called 7/7 handlers. |
| `apps/api/tests/test_ai_copilot_rbac.py` | Per-role 403/200 matrix + tenant isolation | VERIFIED | 9 `def test_` functions, all passing, `not authorized` + `422`/`ValidationError` both present. |
| `apps/api/models/requests.py` | Typed TaskPreview model | VERIFIED | `class TaskPreview(SanitizedBaseModel)` present. |
| `apps/api/tests/smoke/test_opera_webhooks.py` | Signature + dispatch + pilot-noop tests | VERIFIED | 10 `def test_` functions, all passing, `webhook_secret`/`opera_pilot_enabled`/`change_source` all referenced. |
| `apps/api/routers/webhooks.py` | Corrected _verify_opera_signature + pilot no-op gate | VERIFIED | `webhook_secret`-keyed HMAC; pilot gate present. |
| `.planning/phases/06-pms-and-ai-expansion/06-05-SUMMARY.md` | Phase verification record | VERIFIED | Exists with test counts, walkthrough results, deferrals, self-check block. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `ai_copilot.py::copilot_chat` | `credits.py::check_and_deduct_credits` | real tokens passed post-parse | WIRED | 6 call sites confirmed, tokens assigned immediately before each call. |
| `credits.py` | `ai_interactions` table | `log_ai_interaction` with token-derived credits | WIRED | `log_ai_interaction` writes `credits_charged` param sourced from `compute_credits()` return value throughout. |
| `integrations.py` Opera handlers | `tenants.opera_pilot_enabled` | 403 guard | WIRED | All 7 handlers call the guard before proceeding. |
| `integrations.py` | `opera_credentials`/`integration_sync_conflicts` | tenant-scoped `.eq("tenant_id", ...)` | WIRED | Confirmed at all read/write sites. |
| `ai_copilot.py::confirm_tasks` | `models/requests.py::TaskPreview` | typed `list[TaskPreview]` param | WIRED | Signature updated, dict-key access removed. |
| `ai_copilot.py` confirm handlers | tasks/work_orders/guest_requests tables | insert scoped to `current_user.hotel_id` | WIRED | Confirmed via passing tenant-isolation tests. |
| `webhooks.py::_verify_opera_signature` | `opera_credentials.webhook_secret` | HMAC key sourced from per-hotel column | WIRED | Function signature takes `webhook_secret` directly, no `cron_secret` derivation remains. |
| `webhooks.py::opera_webhook` | `tenants.opera_pilot_enabled` | silent-ignore gate post tenant-resolution | WIRED | Gate placed before signature check/dispatch. |
| `apps/web/app/(dashboard)/settings/integrations/page.tsx` | `/integrations/opera/*` API | web settings surface driving pilot-gated endpoints | WIRED | Confirmed live via Playwright walkthrough (403 surfaced correctly) + `df9317f9` fix verified present in file. |
| `DashboardShell.tsx` | `AICopilotBubble` | copilot mounted on shell | WIRED | Confirmed reachable and exercised live in walkthrough (fast-path task creation, 200 not 422). |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full API suite green | `cd apps/api && python -m pytest tests/ -q` | 496 passed, 0 failures | PASS |
| All 5 Phase 6 test files green (explicit run) | `pytest tests/test_ai_copilot_rbac.py tests/test_ai_copilot_credits.py tests/smoke/test_opera_routes.py tests/smoke/test_opera_webhooks.py tests/test_opera_pilot_gate.py -q` | 55 passed | PASS |
| Web type-check | `cd apps/web && npm run type-check` | exit 0, no output errors | PASS |
| No forbidden test-fixture anti-pattern | `grep -c "SimpleNamespace(data=None)"` across all 5 new test files | 0 matches in all 5 | PASS |
| No TODO/FIXME/placeholder in touched production files | grep across credits.py, ai_copilot.py, integrations.py, sync.py, webhooks.py, sop_rag.py, requests.py | 0 matches | PASS |

### Requirements Coverage

This phase has no `REQ-XXX` entries. Confirmed: `grep -c "REQ-" .planning/REQUIREMENTS.md` finds 7 matches total in the file, none tagged to Phase 6 — only a single descriptive line under the deferred-backlog section ("AI expansion notes ... — Phase 6, pilot-gated") which is documentation, not a requirement ID. This matches the phase's stated traceability model: D-01 through D-06 in `06-CONTEXT.md` are the anchor, not REQUIREMENTS.md rows. All 6 decisions were independently verified against code above (D-01 audit scope realized across truths 1-19; D-02 in truths 1,3; D-03 in truths 5-10,16-18; D-04 in truth 12 plus explicit `grep -q opera_pilot apps/api/routers/ai_copilot.py` returning nothing; D-05 fix-in-place demonstrated by the SOP double-log fix, webhook signature fix, and the live-walkthrough UI bug fixed same-session; D-06 test-depth target met by 55 new Phase-6-specific tests plus a live walkthrough).

**No orphaned requirements** — REQUIREMENTS.md correctly has zero Phase 6 REQ-ID rows, as expected for an audit-first phase using decision-based traceability.

### Anti-Patterns Found

None. Grep scan for TODO/FIXME/XXX/HACK/PLACEHOLDER/"not yet implemented" across all files modified in this phase (credits.py, ai_copilot.py, sop_rag.py, integrations.py, services/opera/sync.py, services/opera/webhooks.py, webhooks.py, models/requests.py) returned zero matches.

### Human Verification Required

None. The mandatory live-authenticated-browser walkthrough (CLAUDE.md Self-Verification Policy) was already performed by the executor in 06-05, with a genuinely independent redo after a stale-server false-pass was caught and diagnosed mid-session — this is stronger evidence than a typical self-reported SUMMARY, since the SUMMARY itself documents catching and discarding its own invalid first pass. Two items remain explicitly deferred (not gaps) due to missing local credentials (no non-GM test account, no local LLM/OHIP keys) — both are backed by passing automated test evidence in lieu of live exercise, and are consistent with CLAUDE.md's documented "Current Scope" environment constraint, not a Phase 6 code gap.

### Gaps Summary

No gaps found. All 20 must-have truths across the 5 plans (06-01 through 06-05) were independently verified against the actual codebase — not taken from SUMMARY.md self-reports. Independently re-ran the full test suite (496/496 green, matching all prior claims) and the web type-check (clean). Verified the credit-computation logic, the SOP double-log fix, the Opera pilot-flag guard (all 7 endpoints + the cron path), the Opera webhook signature fix, the typed TaskPreview model, and the live-walkthrough bug fix (`df9317f9`) all exist and function as claimed by direct code inspection — not merely by trusting the SUMMARY narrative. The one documented scope deviation (GET /ai/insights left intentionally ungated, differing from an internally-inconsistent plan interface block) was independently traced to code and found to be a reasonable, tested, and explicitly-justified correction rather than a silently-dropped requirement. REQUIREMENTS.md correctly has zero Phase 6 entries, consistent with the phase's D-01..D-06 traceability model.

---

*Verified: 2026-07-28T23:15:00Z*
*Verifier: Claude (gsd-verifier)*
