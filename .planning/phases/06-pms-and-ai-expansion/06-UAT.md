---
status: partial
phase: 06-pms-and-ai-expansion
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md, 06-04-SUMMARY.md, 06-05-SUMMARY.md]
started: 2026-07-28T21:38:35Z
updated: 2026-07-28T22:00:00Z
---

## Current Test

[testing paused — 2 items outstanding, both blocked on environment constraints, not code gaps]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running API/web dev servers. Start the application from scratch. Server boots without errors, and a primary query (health check or login) returns live data.
result: pass
note: Self-verified by Claude — killed all API/web processes, restarted npm run dev:api + dev:web fresh. API log shows clean reloader -> server process -> "Application startup complete" (no ModuleNotFoundError this time — the apscheduler dependency fixed during 06-05 stayed fixed). GET /health returned 200 with db:ok and all cron statuses ok. GET /login on web returned 200.

### 2. AI Copilot Fast-Path Task Creation
expected: On the Tasks page, open the AI copilot bubble, type a simple task request (e.g. "Room 412 needs towels"). A task-preview card renders via the zero-credit rule-engine fast path (no LLM key needed). Clicking Confirm creates the task successfully (200 response, not 422/500), scoped to your hotel.
result: pass
note: Self-verified via Playwright as GM (hp.patelrep@gmail.com). Typed "Room 412 needs towels" -> preview card rendered ("Towels — Room 412", housekeeping, normal priority) with zero LLM calls. Clicked Confirm & Create -> POST /v1/ai/tasks/confirm returned 200 OK, task appeared in the list. Zero console errors. Test task deleted afterward via UI to clean up.

### 3. Opera Settings — Non-Pilot Hotel Gated Correctly
expected: Navigate to Settings → Integrations. For a hotel without Opera pilot access enabled, the page shows a graceful "not available" / error message — it does NOT show an interactive "Connect Opera Cloud" form that would misleadingly suggest you can connect.
result: pass
note: Self-verified via Playwright. GET /integrations/opera/status correctly returns 403 (pilot gate working against live-verified fresh code). UI shows only "Failed to load Opera status." + Retry button — no interactive connect form rendered (confirms the df9317f9 fix from 06-05 holds). The 4 console "errors" are Chromium's benign resource-load log lines for the intentional 403s (React Query retries), not application exceptions.

### 4. AI Insights/Recommendations Role Restriction
expected: Logged in as a non-GM/non-chief-engineer/non-supervisor role (e.g. housekeeper), AI Insights/Recommendations views are not accessible (403 or hidden from navigation) — the AI copilot chat itself remains available to any role.
result: blocked
blocked_by: other
reason: "No non-GM-role test account exists locally — only the GM test credential in project memory (reference_test_account.md). Cannot live-verify this without creating/modifying a real account in the shared production Supabase instance, which is out of scope for a UAT smoke pass. Backed by strong automated evidence instead: apps/api/tests/test_ai_copilot_rbac.py (21 tests, all passing) directly asserts /ai/recommendations and /ai/recommendations/metrics deny housekeeper/engineer/front_desk and allow gm/chief_engineer/housekeeping_supervisor, and that /ai/copilot/chat stays open to any role."

### 5. GM AI Credit Usage Stat Reflects Real Usage
expected: On the GM dashboard/reports area showing "AI credits used" (7-day stat), the number reflects actual usage after using the AI copilot — it should not look obviously flat/fixed regardless of how much you used it, and using the SOP Q&A feature should not double-count.
result: blocked
blocked_by: third-party
reason: "No local ANTHROPIC_API_KEY/OPENAI_API_KEY configured (documented, accepted constraint per CLAUDE.md Current Scope and 06-RESEARCH.md). The 'insight_query' intent (triggered by the copilot's 'Show GM insights' quick action) requires a real Claude call and has no zero-credit fast path (unlike task/work-order/guest-request creation), so it always fails locally with AIProviderConfigurationError -> 500 in this environment. This predates Phase 6 (not caused by any of the 5 plans) and is an accepted deferral, not a gap: the frontend handles it gracefully ('Something went wrong. Please try again.', no crash, no raw error leaked). Secondary, out-of-scope observation for a future ticket: the backend raises an unhandled 500 rather than a clean 503-with-message for AI-provider misconfiguration — not a Phase 6 regression, since this code path (services/ai/insights.py::generate_gm_insights) predates this phase and Phase 6 code never runs before the crash occurs. The compute_credits()/single-audit-log fixes from 06-01 could not be exercised end-to-end for this reason; they are proven instead by the automated test suite's mocked-provider tests (tests/test_ai_copilot_credits.py, 3/3 passing) and the billing page (0/0 credits used — the account genuinely has zero LLM-provider-billed usage, consistent with no local credentials existing to generate any)."

## Summary

total: 5
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 2

## Gaps

[none — no issues found; 2 tests blocked on environment constraints (no non-GM test account, no local LLM credentials), both documented as accepted deferrals per CLAUDE.md Current Scope and 06-RESEARCH.md, not code gaps]
