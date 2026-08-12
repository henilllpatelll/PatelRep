---
phase: 19-rbac-audit-and-normalization
verified: 2026-08-04T00:00:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 19: RBAC Audit and Normalization Verification Report

**Phase Goal:** Every mutation-capable endpoint across apps/api/routers/ is protected by a consistent, correctly-scoped role check, with role-group constants consolidated into one verified, collision-free source of truth.
**Verified:** 2026-08-04
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A durable, committed audit artifact inventories every role check across all 30 routers, classified route-level vs. object-level | ✓ VERIFIED | `RBAC-AUDIT.md` (81 lines) contains full 30-router table with roll-up "3 + 2 + 2 + 22 = 30 ✓" |
| 2 | `DELETE /guest-requests/{id}` returns 403 for housekeeper, succeeds for management role | ✓ VERIFIED | `guest_requests.py:590-591` gate present; `test_guest_requests_delete_rbac.py` — 2/2 pass live |
| 3 | `lost_found.py` PATCH/DELETE gaps closed; `auth.py` reviewed with no gap, both documented per-router | ✓ VERIFIED | `lost_found.py:218,256` gates present; `test_lost_found_delete.py` housekeeper-403 cases pass; `auth.py` has no `require_role`/inline role checks (self-scoped by design); RBAC-AUDIT.md documents both outcomes |
| 4 | Single source-of-truth `core/roles.py` defines consolidated, collision-free role-group constants, each collision documented as a product decision | ✓ VERIFIED | `core/roles.py` defines `ALL_ROLES`/`ALL_STAFF_ROLES`/`MANAGER_ROLES`/`PROGRAM_MANAGER_ROLES`; `programs.py`, `safety.py`, `hotels.py` import from it with no local redefinitions remaining; RBAC-AUDIT.md documents both collisions as explicit decisions |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.planning/phases/19-rbac-audit-and-normalization/RBAC-AUDIT.md` | 30-router inventory + RBAC-03/04 outcomes, ≥60 lines, contains guest_requests.py | ✓ VERIFIED | 81 lines; contains full table, chief_engineer note, RBAC-03 outcomes for auth.py/lost_found.py/guest_requests.py, RBAC-04 decisions 1-3 |
| `apps/api/routers/guest_requests.py` | Role-gated DELETE reusing `SLA_POLICY_ROLES` | ✓ VERIFIED | Line 590: `if current_user.role not in SLA_POLICY_ROLES: raise HTTPException(403, ...)` — first statement in handler; tenant scoping (`.eq("tenant_id", ...)`) and cascade delete of task_comments/tasks unchanged |
| `apps/api/tests/test_guest_requests_delete_rbac.py` | Live-JWT TestClient 403/204 assertions | ✓ VERIFIED | `_auth_header` helper present; `test_delete_guest_request_forbidden_for_housekeeper` (403) and `test_delete_guest_request_allowed_for_gm` (204) both pass |
| `apps/api/routers/lost_found.py` | Role-gated PATCH + DELETE matching custody-events gate | ✓ VERIFIED | Lines 218, 256: `if current_user.role not in {"front_desk","housekeeping_supervisor","gm"}: raise HTTPException(403, "Not authorized...")` — identical set to custody-events gate at line 170; tenant scoping unchanged |
| `apps/api/tests/test_lost_found_delete.py` | Housekeeper-403 cases added alongside existing gm cases | ✓ VERIFIED | `test_delete_item_forbidden_for_housekeeper`, `test_patch_item_forbidden_for_housekeeper` present and passing; pre-existing gm/404 tests intact |
| `apps/api/core/roles.py` | Canonical constants module | ✓ VERIFIED | Exports `ALL_ROLES`, `ALL_STAFF_ROLES`, `MANAGER_ROLES`, `PROGRAM_MANAGER_ROLES` with exact values specified in plan; imports cleanly, no circular-import risk (leaf module) |
| `apps/api/routers/programs.py` | 9 call sites using imported `PROGRAM_MANAGER_ROLES` | ✓ VERIFIED | `from core.roles import PROGRAM_MANAGER_ROLES` (line 11) + 9 `require_role(*PROGRAM_MANAGER_ROLES)` call sites (lines 121,188,220,283,289,321,433,447,459) = 10 total occurrences; no local `MANAGER_ROLES = (` definition remains |
| `apps/api/routers/safety.py` | `MANAGER_ROLES` imported from core.roles | ✓ VERIFIED | `from core.roles import MANAGER_ROLES` (line 13); 7 usages unchanged (lines 84,121,139,164,186,249,264); no local definition remains |
| `apps/api/routers/hotels.py` | `ALL_STAFF_ROLES` imported from core.roles | ✓ VERIFIED | `from core.roles import ALL_STAFF_ROLES` (line 8); 2 usages unchanged (lines 117,193); duplicate "engineer" removed; no local definition remains |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `guest_requests.py delete_guest_request` | `SLA_POLICY_ROLES` membership check | `if current_user.role not in SLA_POLICY_ROLES: raise HTTPException(403)` | ✓ WIRED | Confirmed at line 590-591, first statement in function body, before any DB lookup |
| `test_guest_requests_delete_rbac.py` | `DELETE /v1/guest-requests/{id}` | `TestClient(app).delete` with housekeeper/gm auth headers | ✓ WIRED | Both tests exercise real HTTP requests through full FastAPI + JWT dependency chain; pass |
| `lost_found.py update_lost_found_item / delete_lost_found_item` | custody-state role membership check | `if current_user.role not in {"front_desk","housekeeping_supervisor","gm"}: raise HTTPException(403)` | ✓ WIRED | Confirmed at lines 218 and 256, identical set to line 170's custody-events gate |
| `test_lost_found_delete.py` | `PATCH`/`DELETE /v1/lost-found/{id}` | `TestClient(app)` calls with `_auth_header('housekeeper')` | ✓ WIRED | Housekeeper-403 tests present and pass; gm cases still pass |
| `programs.py` | `core/roles.py PROGRAM_MANAGER_ROLES` | `from core.roles import PROGRAM_MANAGER_ROLES` | ✓ WIRED | Import present, used at all 9 call sites, `python -c "import main"` succeeds |
| `safety.py` | `core/roles.py MANAGER_ROLES` | `from core.roles import MANAGER_ROLES` | ✓ WIRED | Import present, used at all 7 call sites |
| `hotels.py` | `core/roles.py ALL_STAFF_ROLES` | `from core.roles import ALL_STAFF_ROLES` | ✓ WIRED | Import present, used at both call sites |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|---|---|---|
| RBAC-01 (audit artifact) | ✓ SATISFIED | None — RBAC-AUDIT.md exists with full inventory. (Note: `.planning/REQUIREMENTS.md` still shows "Pending" status text — this is a tracking-doc field expected to be updated by the orchestrator after verification, not a functional gap.) |
| RBAC-02 (DELETE guest-requests gate) | ✓ SATISFIED | None — live 403/204 behavior confirmed |
| RBAC-03 (lost_found.py + auth.py review) | ✓ SATISFIED | None — 2 gaps closed in lost_found.py, auth.py reviewed with documented no-gap conclusion |
| RBAC-04 (constant consolidation) | ✓ SATISFIED | None — single source of truth, both collisions resolved as documented decisions, zero access change confirmed by full test suite |

### Anti-Patterns Found

None. Scanned all touched files (`guest_requests.py`, `lost_found.py`, `programs.py`, `safety.py`, `hotels.py`, `core/roles.py`) for TODO/FIXME/XXX/HACK/PLACEHOLDER markers — no matches.

### Test Suite Result

`cd apps/api && python -m pytest tests/ -q`: **554 passed, 2 failed** in 8.44s.

The 2 failures are both in `test_management_roi.py` (`test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`) — pre-existing ROI calculation test failures unrelated to RBAC, documented in STATE.md as predating this phase. Confirmed as expected by team lead. The two RBAC-specific test files (`test_guest_requests_delete_rbac.py`, `test_lost_found_delete.py`) both pass fully (8/8).

### Git History Note

Commit `710896df` bundles changes from two different plans (19-03's `lost_found.py` PATCH/DELETE gates + 19-04's `core/roles.py` repointing of `hotels.py`/`programs.py`/`safety.py`) due to 4 agents executing in parallel against a shared working directory. This is a git-attribution artifact only — verified by reading each file's actual on-disk content (not by trusting commit-to-plan mapping), and every file matches its respective plan's must_haves exactly, with no missing or extra changes.

### Human Verification Required

None. All success criteria are verifiable via static code inspection, live TestClient requests, and the automated pytest suite — no visual, real-time, or external-service-dependent behavior involved in this phase.

### Gaps Summary

No gaps. All 4 ROADMAP success criteria are met:

1. Audit artifact exists and inventories all 30 routers with route-level/object-level classification — ✓
2. `DELETE /guest-requests/{id}` returns 403 for housekeeper / succeeds for gm, proven live via signed-JWT TestClient — ✓
3. `lost_found.py` (2 gaps: PATCH + DELETE) and `auth.py` (no gap) reviewed with per-router outcomes documented in RBAC-AUDIT.md — ✓
4. `core/roles.py` is the single source of truth; `MANAGER_ROLES`/`PROGRAM_MANAGER_ROLES` split and `ALL_STAFF_ROLES` dedup are each documented as explicit product decisions, with zero effective access change confirmed by the full test suite — ✓

---

_Verified: 2026-08-04_
_Verifier: Claude (gsd-verifier)_
