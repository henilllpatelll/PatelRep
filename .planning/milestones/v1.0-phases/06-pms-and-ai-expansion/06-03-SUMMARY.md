---
phase: 06-pms-and-ai-expansion
plan: 03
subsystem: api
tags: [ai, rbac, tenant-isolation, input-validation, fastapi, pydantic, pytest]

# Dependency graph
requires:
  - phase: 06-pms-and-ai-expansion (06-01)
    provides: "AI credit accounting + SOP double-log fix on ai_copilot.py (shared file, landed first to avoid conflicts)"
provides:
  - "Full per-role RBAC + tenant-isolation test matrix for ai_copilot.py endpoints (previously zero coverage)"
  - "Typed TaskPreview model closing confirm_tasks' KeyError->500 gap"
affects: [06-05 (phase gate verification)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct-invocation RBAC test pattern: extract route.dependant.dependencies[0].call and assert raise/no-raise on require_role, rather than TestClient HTTP round-trips"
    - "Dynamic item-type inspection (typing.get_args on a function's live signature) to write a test that is RED before a typed-model refactor and GREEN after, without touching the test file across the transition"

key-files:
  created:
    - apps/api/tests/test_ai_copilot_rbac.py
  modified:
    - apps/api/models/requests.py
    - apps/api/routers/ai_copilot.py

key-decisions:
  - "Treated GET /ai/insights as intentionally open (matches actual code: get_current_user only, no require_role), overriding an inconsistent line in 06-PATTERNS.md's interface block that first listed it under ROLE-GATED. The same context block's own explicit resolution ('keep open, assert it stays open') and the live code agree; the RBAC matrix therefore covers only /ai/recommendations and /ai/recommendations/metrics as role-gated GETs."
  - "TaskPreview mirrors the frontend ParsedTask wire contract (apps/web/lib/api/ai.ts) exactly: title, description, task_type, priority, room_id, room_number_display, due_at, assigned_to -- extra fields like `confidence` sent by the client are silently ignored by pydantic's default extra='ignore', so no frontend change was needed."

requirements-completed: [D-01, D-05, D-06]

# Metrics
duration: 6min
completed: 2026-07-28
---

# Phase 6 Plan 03: AI Copilot RBAC + Tenant Isolation Summary

**Closed the zero-coverage RBAC/tenant-isolation gap on `ai_copilot.py` with a 21-test direct-invocation matrix, and gave `confirm_tasks` a typed `TaskPreview` model so malformed input 422s instead of raising an uncaught `KeyError` -> 500.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-28T04:09Z (session start after reading plan/context)
- **Completed:** 2026-07-28T04:15Z
- **Tasks:** 2/2 completed
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- New `test_ai_copilot_rbac.py` (21 tests): role-gated matrix for `/ai/recommendations` + `/ai/recommendations/metrics` (deny housekeeper/engineer/front_desk, allow gm/chief_engineer/housekeeping_supervisor); confirms `/ai/copilot/chat`, `/ai/tasks/confirm`, `/ai/work-orders/confirm`, `/ai/guest-requests/confirm`, `/ai/risk-alerts`, `/ai/insights` have no role gate (Pitfall 6 — intentionally open, matching sibling non-AI create endpoints); `/ai/assignments/confirm` excludes housekeeper but allows housekeeping_supervisor/engineer/gm; tenant isolation proven for both `confirm_assignments` and `confirm_tasks`.
- `confirm_tasks` now takes `list[TaskPreview]` instead of `list[dict]` — malformed input (missing `title`) now raises a pydantic `ValidationError` (422) instead of an uncaught `KeyError` (500). Stays intentionally open (no `require_role` added) and remains tenant-scoped.
- Full API suite: 486 passed (was 465 before this plan; +21 new tests), zero failures.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write AI copilot RBAC matrix + tenant-isolation + confirm_tasks-422 tests (RED)** - `62e25e6c` (test)
2. **Task 2: Give confirm_tasks a typed TaskPreview model (GREEN)** - `c4e6fd68` (feat)

_TDD gate sequence verified: `test(06-03): ...` RED commit exists, `feat(06-03): ...` GREEN commit follows it. No refactor commit needed._

## Files Created/Modified
- `apps/api/tests/test_ai_copilot_rbac.py` - New: 21-test RBAC matrix, open-endpoint assertions, tenant-isolation, and confirm_tasks validation tests, using the direct-invocation `route.dependant.dependencies[0].call` pattern from `test_evidence_foundation.py`.
- `apps/api/models/requests.py` - Added `TaskPreview(SanitizedBaseModel)` mirroring `WorkOrderPreview`/`GuestRequestPreview`'s style, matching the `ParsedTask` wire contract in `apps/web/lib/api/ai.ts`.
- `apps/api/routers/ai_copilot.py` - `confirm_tasks` signature changed from `tasks: list[dict]` to `tasks: list[TaskPreview]`; body rewritten from dict-key access (`task["title"]`, `task.get(...)`) to typed attribute access (`task.title`, `task.room_id`, etc.), preserving tenant-scoped room lookups and hotel_id-scoped inserts.

## Decisions Made
- **GET /ai/insights classified as intentionally open, not role-gated.** 06-PATTERNS.md's interface block contained an internal inconsistency: it first listed `/ai/insights (POST insight variants)` under ROLE-GATED, then separately clarified "`/ai/insights (GET) uses only get_current_user`... keep open, assert it stays open." Live code (`routers/ai_copilot.py::get_gm_insights`) confirms only `get_current_user`, no `require_role` — there is no POST insight variant in the router at all. Followed the explicit resolution and the actual code rather than the stale summary line; this is consistent with Pitfall 6 (don't "fix" an intentionally-open read endpoint into a regression).
- **TaskPreview field set derived from the real wire contract**, not invented: read `apps/web/lib/api/ai.ts`'s `ParsedTask` interface and `services/ai/task_parser.py`'s `TaskPreview` (LLM output schema) to enumerate exactly the fields `confirm_tasks` reads, avoiding both under- and over-typing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan/reality mismatch] Excluded a non-existent role-gated `/ai/insights` POST variant from the RBAC matrix**
- **Found during:** Task 1 (reading `routers/ai_copilot.py` per `<read_first>`)
- **Issue:** The plan's `must_haves.truths` and interface block asserted a role-gated `/ai/insights` variant exists and should 403 floor roles. Current code has exactly one `/ai/insights` route (GET), gated only by `get_current_user`, with no POST insight variant anywhere in the router.
- **Fix:** Wrote the RBAC matrix against the two role-gated endpoints that actually exist in code (`/ai/recommendations`, `/ai/recommendations/metrics`), and added `/ai/insights` (GET) to the intentionally-open assertion set instead — matching the plan's own explicit fallback guidance ("keep open, assert it stays open") and avoiding a regression-inducing change to a working, tenant-scoped read endpoint.
- **Files modified:** `apps/api/tests/test_ai_copilot_rbac.py` (test design decision only; no product code changed as a result)
- **Verification:** Full test suite green; `test_open_endpoints_accept_any_role` and the role-gated matrix both pass against live code with no further changes needed.
- **Committed in:** `62e25e6c` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (plan/reality reconciliation, no code behavior change)
**Impact on plan:** No scope creep — the deviation only affected which endpoints the test suite asserts against, aligning tests with actual shipped behavior per the plan's own stated Pitfall-6 resolution.

## Issues Encountered
None. TDD RED->GREEN transition worked as designed: the malformed-input test (`test_confirm_tasks_malformed_returns_422`) failed cleanly in Task 1 (confirm_tasks still accepted raw `list[dict]`) and passed without any test-file edits once Task 2 wired the typed `TaskPreview` model — achieved via a dynamic item-type inspection helper (`typing.get_args` on the live function signature) rather than hardcoding an import that would not have existed yet.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 2's other plan (06-04, Opera webhook signature fix) is independent of this plan's files and can proceed/finish on its own schedule.
- Wave 3 (06-05, phase gate) can rely on: `ai_copilot.py`'s RBAC/tenant-isolation surface is now tested to Phase 1-5 rigor (D-06), and `confirm_tasks` no longer has an unvalidated raw-dict input path (D-05).
- No blockers identified for the phase gate.

---
*Phase: 06-pms-and-ai-expansion*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: `apps/api/tests/test_ai_copilot_rbac.py`
- FOUND: `class TaskPreview` in `apps/api/models/requests.py`
- FOUND: commit `62e25e6c` (test RED)
- FOUND: commit `c4e6fd68` (feat GREEN)
