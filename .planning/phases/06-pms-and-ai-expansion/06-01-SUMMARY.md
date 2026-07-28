---
phase: 06-pms-and-ai-expansion
plan: 01
subsystem: api
tags: [ai, credits, billing, audit, fastapi, tdd]

requires:
  - phase: 06-pms-and-ai-expansion
    provides: "06-RESEARCH.md findings on the flat-cost and double-log defects"
provides:
  - "Token-derived AI credit computation (middleware/credits.py::compute_credits)"
  - "Single ai_interactions audit-log owner per caller of sop_rag.query_sop()"
  - "Regression test suite proving both fixes (tests/test_ai_copilot_credits.py)"
affects: [06-03, 06-05, billing, ai-copilot]

tech-stack:
  added: []
  patterns:
    - "Credit deduction always follows the parser/LLM call (never precedes it), so real prompt_tokens/completion_tokens are available at deduction time"
    - "CREDIT_COSTS retained as a per-interaction-type revenue floor beneath token-derived pricing (MODEL_RATES x DOLLARS_PER_CREDIT)"
    - "Each direct caller of a shared AI service function (query_sop) owns its own single audit-log write — the service function only returns usage, it never logs"

key-files:
  created:
    - apps/api/tests/test_ai_copilot_credits.py
  modified:
    - apps/api/middleware/credits.py
    - apps/api/routers/ai_copilot.py
    - apps/api/services/ai/sop_rag.py
    - apps/api/routers/sop.py

key-decisions:
  - "CREDIT_COSTS kept as a floor (not deleted) — guarantees no revenue regression on short AI calls while satisfying CLAUDE.md A3 for long ones"
  - "routers/sop.py::query_sop_endpoint (a second, previously-unaudited caller of query_sop found during the Task 3 blast-radius check) now independently calls check_and_deduct_credits + log_ai_interaction, instead of query_sop logging on every caller's behalf"
  - "GET /ai/insights credit deduction moved to after generate_gm_insights() returns, matching the parse-then-charge ordering already used by every copilot_chat branch"

patterns-established:
  - "compute_credits(interaction_type, prompt_tokens, completion_tokens): USD-rate lookup by INTERACTION_MODEL, converted to credits via DOLLARS_PER_CREDIT, floored by CREDIT_COSTS"

requirements-completed: [D-02, D-06]

duration: ~45min
completed: 2026-07-28
---

# Phase 6 Plan 1: AI Credit Accounting + SOP Double-Log Fix Summary

**Token-derived AI credit billing (MODEL_RATES x real prompt/completion tokens, CREDIT_COSTS as floor) replacing a flat per-interaction-type lookup, plus single-owner audit logging for SOP queries across both callers of `query_sop()`.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 (RED test, GREEN credit-compute fix, GREEN double-log fix)
- **Files modified:** 4 (1 created, 4 modified/edited across commits, `middleware/credits.py`, `routers/ai_copilot.py`, `services/ai/sop_rag.py`, `routers/sop.py`)

## Accomplishments

- `middleware/credits.py::compute_credits()` derives `credits_charged` from real `prompt_tokens`/`completion_tokens` via a per-model USD rate table (`MODEL_RATES`) and `DOLLARS_PER_CREDIT = 0.02`, with `CREDIT_COSTS` retained as a per-interaction-type minimum floor.
- Every `copilot_chat` intent branch, `POST /ai/housekeeping/briefing`, and `GET /ai/insights` now call `check_and_deduct_credits` **after** the parser/LLM call returns, passing its real token counts (previously `GET /ai/insights` deducted credits *before* generating insights at all, using the flat amount).
- `services/ai/sop_rag.py::query_sop()` no longer writes to `ai_interactions` — it only returns `prompt_tokens`/`completion_tokens`. The now-unused internal `_log_ai_interaction()` helper (and its `time`/`Optional` imports) were deleted.
- Blast-radius check (plan Task 3, step 1) found `routers/sop.py::query_sop_endpoint` (`POST /sop/query`) as a **second caller** of `query_sop()` that research had not identified — it relied entirely on the internal log and never called `check_and_deduct_credits` at all, meaning SOP queries through that endpoint were never actually billed against `credit_ledger` (only phantom-logged with a hardcoded `credits_charged=2.0`). Fixed by giving that endpoint its own single-owner audit write, mirroring the router pattern.
- `tests/test_ai_copilot_credits.py` (3 tests) proves: (1) credits vary with token count, (2) credits are never the flat `CREDIT_COSTS` lookup when token cost dominates, (3) exactly one `ai_interactions` row is written per SOP query through `/ai/copilot/chat`.

## Task Commits

Each task was committed atomically (TDD RED/GREEN gate sequence):

1. **Task 1: Write RED credit-accounting + double-log regression tests** - `6f0a706a` (test)
2. **Task 2: Compute credits from real token usage (fix CREDIT_COSTS flat lookup)** - `cbb73c8a` (feat)
3. **Task 3: Remove the duplicate ai_interactions write on the SOP query path** - `e3c22db2` (fix)

_TDD gate sequence verified in git log: `test(06-01)` → `feat(06-01)` → `fix(06-01)`._

## Files Created/Modified

- `apps/api/tests/test_ai_copilot_credits.py` - RED-then-GREEN regression tests for credit variance, non-flat billing, and single SOP audit-log ownership; includes a local `CopilotFakeDB` (extends `tests/smoke/fake_supabase.FakeDB`) adding `.rpc()` and `count="exact"` select support neither the shared fixture provided
- `apps/api/middleware/credits.py` - `MODEL_RATES`, `INTERACTION_MODEL`, `DOLLARS_PER_CREDIT`, `compute_credits()`; `check_and_deduct_credits()` now accepts `prompt_tokens`/`completion_tokens`
- `apps/api/routers/ai_copilot.py` - every `copilot_chat` branch + briefing + insights endpoints pass real tokens to `check_and_deduct_credits`, called after the parse/LLM step
- `apps/api/services/ai/sop_rag.py` - removed all internal `ai_interactions` writes from `query_sop()` and the now-dead `_log_ai_interaction` helper; still returns token usage
- `apps/api/routers/sop.py` - `POST /sop/query` now calls `check_and_deduct_credits` + `log_ai_interaction` itself (previously deducted no real credits and relied solely on `query_sop`'s internal log)

## Decisions Made

- Kept `CREDIT_COSTS` as a revenue floor rather than removing it — short AI calls (most of them, given `$0.02/credit` and typical `gpt-4o-mini` token costs) still bill at least the pre-existing flat amount; only calls whose real token cost exceeds the floor bill more. This is why the RED test's "large call" scenario needed materially large token counts (200K/150K) to prove variance — smaller mocked values stayed under the floor on both sides.
- Made `routers/sop.py::query_sop_endpoint` its own audit-log owner (rather than restoring a shared log inside `query_sop()`) per the plan's own contingency: "if `query_sop` has a caller other than `ai_copilot.py::copilot_chat`... have `query_sop` return its usage and let each caller log once." This also closes a real billing gap that predates this plan (that endpoint's credit deduction was entirely absent).
- Reordered `GET /ai/insights`'s credit deduction to after `generate_gm_insights()` returns, for consistency with the pattern already used everywhere else in the file, and so token-derived billing has real numbers to work with.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `routers/sop.py::query_sop_endpoint` was an unresearched second caller of `query_sop()`**
- **Found during:** Task 3 blast-radius check (plan explicitly required `grep -rn "query_sop" apps/api` before deleting the internal log)
- **Issue:** 06-RESEARCH.md assumed `ai_copilot.py::copilot_chat` was the sole caller of `sop_rag.query_sop()`. It was not — `routers/sop.py`'s `POST /sop/query` endpoint also calls it directly and had zero credit-deduction logic of its own, relying entirely on `query_sop`'s internal (now-removed) log write. Deleting the internal log without addressing this caller would have silently zeroed out all audit logging for that endpoint.
- **Fix:** Added `check_and_deduct_credits` + `log_ai_interaction` calls directly in `query_sop_endpoint`, on both the success and provider-failure paths, mirroring `ai_copilot.py`'s existing pattern. This also fixes a pre-existing, previously-undetected billing gap: that endpoint's SOP queries never actually decremented `credit_ledger`.
- **Files modified:** `apps/api/routers/sop.py`
- **Verification:** Full 444-test suite green; no existing tests exercised this endpoint previously (verified via grep — zero regression risk).
- **Committed in:** `e3c22db2` (Task 3 commit)

**2. [Rule 1 - Bug] RED test's initial "large call" token counts were too small to distinguish from the CREDIT_COSTS floor**
- **Found during:** Task 2, first GREEN verification run
- **Issue:** The RED test as originally committed used (5,000/3,000) and (50,000/30,000) prompt/completion tokens for the "varies" and "not flat" assertions. After implementing `compute_credits()`, both scenarios still computed *below* the `CREDIT_COSTS["task_creation"] = 1.0` floor, so the fixed code still produced identical/flat-looking output — a false negative in the test itself, not a bug in the fix.
- **Fix:** Raised the "large call" token counts to 200,000 prompt / 150,000 completion tokens (well above the floor at `gpt-4o-mini` rates), keeping the RED small-call values unchanged.
- **Files modified:** `apps/api/tests/test_ai_copilot_credits.py`
- **Verification:** Both `test_credits_charged_varies_with_token_count` and `test_credits_not_flat_lookup` now pass with a mathematically dominant token-derived cost.
- **Committed in:** `cbb73c8a` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both were necessary for correctness — the first closes a real billing gap the plan's own research missed, the second fixes a test-design mistake that would have made the GREEN gate falsely pass without proving the fix. No scope creep beyond the plan's stated audit boundary (copilot intents, SOP RAG, credit middleware).

## Issues Encountered

None beyond the two items documented above as deviations.

## User Setup Required

None - no external service configuration required. `MODEL_RATES` are hardcoded USD-per-million-token constants (dated 2026-07 in a code comment) requiring no credentials; no live AI-provider calls were made during verification (all tests mock the OpenAI/Anthropic client boundary per the Current Scope constraint — no local AI credentials exist).

## Next Phase Readiness

- `middleware/credits.py::compute_credits()` and the now-consistent parse-then-charge ordering are ready for 06-03 (AI copilot RBAC matrix + tenant isolation, depends on this plan).
- Full 444-test API suite green; no regressions in the 400+ baseline.
- The GM-facing "AI credits used (7d)" stat (`services/ai/insights.py::_get_7day_stats`) now sums accurate, non-duplicated `credits_charged` values for SOP queries.

---
*Phase: 06-pms-and-ai-expansion*
*Completed: 2026-07-28*

## Self-Check: PASSED

All created/modified files confirmed present on disk; all 3 task commits (`6f0a706a`, `cbb73c8a`, `e3c22db2`) confirmed present in `git log`.
