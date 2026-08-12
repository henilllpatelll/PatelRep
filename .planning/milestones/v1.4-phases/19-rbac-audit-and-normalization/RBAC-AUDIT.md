# RBAC Audit — Role-Check Inventory, Review Outcomes, and Constant Decisions

**Phase:** 19-rbac-audit-and-normalization
**Source:** Transcribed and restructured from `19-RESEARCH.md` (researched 2026-08-04, HIGH confidence, direct code/migration reads). This document is the durable, committed audit artifact — it is the permanent record; `19-RESEARCH.md` is the working notes it was derived from.

## Legend

This audit classifies every role check found in `apps/api/routers/` into one of two categories:

- **Route-level gate** — `Depends(require_role(...))` on the endpoint signature. Produces a hard 403 before the handler body runs.
- **Object-level / business-rule check** — an inline `if current_user.role ...` inside a handler body. Used for self-scope narrowing, redaction/response-branching, or an inline 403 raised by hand (routers that never use `Depends(require_role(...))` at all, e.g. `guest_requests.py`, `lost_found.py`).

Two routers are **not role-based** and are out of RBAC scope by design:
- `internal.py` — gated by `X-Cron-Secret` header verification (`verify_cron`), a separate auth mechanism for GitHub Actions cron calls.
- `webhooks.py` — gated by provider signature verification (Stripe/Twilio/Opera), a separate auth mechanism.

## Full Role-Check Inventory (RBAC-01)

All 30 files in `apps/api/routers/` (excluding `__init__.py`, which has no routes).

| Router | Route-level gates | Object-level checks | Notes |
|---|---|---|---|
| `auth.py` | none | none | `GET /me` (self-profile) and `POST /hotel-context` (DB-validated membership check) need no role gate — both are identity/self-service endpoints. **RBAC-03 target — reviewed, no gap.** |
| `feedback.py` | `require_role("gm")` line 131 | none (line 85 reads `.role` only for audit metadata) | Clean. |
| `shifts.py` | `SHIFT_ROLES = ("housekeeper","housekeeping_supervisor")` (line 14) used at lines 38,50,86,131,167 | none | Clean, single constant. |
| `cleaning_checklists.py` | `require_role("gm","housekeeping_supervisor")` lines 146, 200 | none | Clean. |
| `late_checkout.py` | line 15 `require_role("housekeeper","housekeeping_supervisor","front_desk","gm")`; line 73 `require_role("front_desk","gm","housekeeping_supervisor")` | line 61 `if current_user.role == "housekeeper":` (narrows to own-room actions) | Mixed — legitimate (route gate + self-scope narrowing). |
| `clean_sessions.py` | `SESSION_ROLES = ("housekeeper","housekeeping_supervisor")` (line 28) at lines 108,267,290,355,394,485,543; line 328 adds `"gm"` | line 66 `if current_user.role in ("gm","housekeeping_supervisor"):` | Mixed — legitimate. |
| `tasks.py` | line 71 `require_role("gm","housekeeping_supervisor","front_desk","engineer","housekeeper")` (effectively all-staff) | line 142 `if current_user.role == "housekeeper":` | Mixed — legitimate. |
| `onboarding.py` | `require_role("gm")` lines 122, 186 | none | Clean. |
| `notifications.py` | line 53 `require_role("gm","housekeeping_supervisor")`; line 98 adds `"engineer"` | none | Clean. |
| `reports.py` | lines 15,40,87 `require_role("gm","housekeeping_supervisor","engineer")`; line 240 `require_role("gm","engineer")`; line 356 `require_role("gm")` | none | Clean. |
| `safety.py` | `MANAGER_ROLES = ("gm","housekeeping_supervisor","chief_engineer")` (line 34) used at lines 121,139,164,186,249,264; line 70 `require_role("gm")`; line 210 `require_role("gm","chief_engineer","engineer")` | line 84 `if current_user.role not in MANAGER_ROLES and employee["user_id"] != current_user.user_id:` (self-service exception) | Mixed. **`MANAGER_ROLES` is RBAC-04 collision target #1.** |
| `evidence.py` | `EVIDENCE_CAPTURE_ROLES` (line 38-40, all 6 roles) used lines 417,478,517; `COMPETENCY_MANAGER_ROLES = ("gm","housekeeping_supervisor","chief_engineer")` (line 41) used lines 358,403,440; plus `require_role("gm")` lines 234,281,305,330,592,647 | none | Clean — `COMPETENCY_MANAGER_ROLES` already matches `safety.py`'s `MANAGER_ROLES` value exactly (independent convergence, see RBAC-04 Decision 1). |
| `assets.py` | `require_role` combos of gm/engineer/chief_engineer at lines 50,114,135,214,231,267,294,328,367,388 | none | Clean. |
| `programs.py` | `MANAGER_ROLES = ("gm","housekeeping_supervisor","engineer","chief_engineer")` (line 43) used at lines 121,188,220,283,289,321,433,447,459; plus narrower gates: line 145 `require_role("gm")`; line 249 `require_role("gm","chief_engineer")`; line 301 `require_role("housekeeper","housekeeping_supervisor","gm")`; lines 328,335,342 `require_role("gm","housekeeping_supervisor")`; line 349 adds `"chief_engineer"` | none | Route-level only. **`MANAGER_ROLES` is RBAC-04 collision target #2 — value differs from safety.py's by including `"engineer"`.** |
| `lost_found.py` | none | line 170 `if current_user.role not in {"front_desk","housekeeping_supervisor","gm"}:` (custody-events only) | **RBAC-03 target — 2 confirmed gaps found and closed this phase. See RBAC-03 section below.** |
| `ai_copilot.py` | lines 506,716,829,843,855,904,934,955,977 various `require_role` combos | line 562 `check_action_permitted(action, current_user.role)` delegates to `services/policy.py`'s rank-based system; line 291 audit-only | Mixed — legitimate, uses a second RBAC paradigm (rank, not set-membership) for some AI-suggested actions. |
| `billing.py` | `require_role("gm")` lines 17,29,111,131,163 | none | Clean. |
| `guest_requests.py` | none | `MESSAGE_ROLES = ("front_desk","housekeeping_supervisor","engineer","gm")` (line 38) at lines 213,300,334; `SLA_POLICY_ROLES = {"gm","housekeeping_supervisor"}` (line 40) at lines 444,476; line 375 `{"gm","front_desk"}` (compensation approval); line 493 `{"gm","housekeeping_supervisor","engineer"}` (accessible-room features) | **RBAC-02/03 target — 1 confirmed gap found and closed this phase. See RBAC-03 section below.** |
| `hotels.py` | `ALL_STAFF_ROLES = ("gm","housekeeping_supervisor","engineer","front_desk","housekeeper","engineer")` (line 11) at lines 118,194; `require_role("gm")` lines 135,174; `require_role("gm","housekeeping_supervisor")` line 160 | none (line 245 `list_hotel_departments` deliberately ungated — read-only reference data, any authenticated staff) | **`ALL_STAFF_ROLES` is RBAC-04 target #3.** `POST /hotels` uses `get_current_user_no_hotel` by design (pre-tenant bootstrap, no role to check yet). |
| `integrations.py` | `require_role("gm")` lines 28,104,184,201; `require_role("gm","chief_engineer")` lines 121,140 | none | Clean. |
| `internal.py` | N/A — not role-based | N/A | Gated by `verify_cron` (`X-Cron-Secret` header, line 14), a wholly separate auth mechanism for GitHub Actions cron calls. Out of RBAC scope by design. |
| `logbook.py` | `require_role("gm","housekeeping_supervisor","engineer")` line 209 | lines 124,176 `is_privileged = current_user.role in ("gm","housekeeping_supervisor","engineer")` (drives redaction/visibility, not a hard 403) | Mixed — legitimate, business-rule filtering not access denial. |
| `management_roi.py` | `require_role("gm")` lines 132,153,186,223,249,273,286 | none | Clean. |
| `scheduling.py` | `SUPERVISOR_ROLES = ("gm","housekeeping_supervisor","engineer")` (line 15) at lines 74,109,131,198,214,246,334 | lines 278,311 `is_supervisor = current_user.role in SUPERVISOR_ROLES` (branches response scope, not a 403) | Mixed — legitimate. |
| `sop.py` | line 81 `require_role("gm","housekeeping_supervisor","engineer")`; line 176 `require_role("gm")` | none | Clean. |
| `staff.py` | `require_role("gm")` at 9 endpoints (lines 152,205,248,322,337,356,373,387,404,437,453,477); line 85 `require_role("gm","housekeeping_supervisor","engineer","chief_engineer","front_desk")` (list_staff) | lines 39,74,77 read `current_user.role` for the *response payload* of `get_effective_role` — informational, not a gate | Clean — no access-control gap; the role-override logic just reports role, doesn't grant it. |
| `webhooks.py` | N/A — not role-based | N/A | Gated by Stripe/Twilio/Opera signature verification (`_verify_twilio_signature`, `_verify_opera_signature`), a separate auth mechanism. Out of RBAC scope by design. |
| `work_orders.py` | `require_role("engineer","gm")` lines 317,360,406,446,521,533,607,655; `require_role("gm")` line 494 | lines 35-59 `_ensure_engineer_can_update_work_order` and lines 62-72 `_ensure_engineer_can_complete_work_order` — engineer-specific self-assignment restrictions layered under the route gate | Mixed — legitimate, sophisticated. Also see `services/work_orders/transitions.py`'s `_MANAGEMENT_ROLES = {"gm","engineer"}` (line 44) for override authority — module-private, WO-specific, deliberately excludes `housekeeping_supervisor`/`chief_engineer`. |
| `housekeeping.py` | `require_role("gm","housekeeping_supervisor")` at ~12 sites (lines 789,908,980,1234,1314,1389,1462,1662,1704,1772,1829,1902,1925,2041); `require_role("housekeeper","housekeeping_supervisor")` line 579 | none | Clean. |
| `rooms.py` | `require_role("gm","housekeeping_supervisor","front_desk")` lines 270,379,455,548,602; `require_role("gm","housekeeping_supervisor")` lines 691,788,1101,1127; `require_role("housekeeper","housekeeping_supervisor","gm")` lines 835,867; `require_role("gm","housekeeping_supervisor","engineer","front_desk")` line 898 | `UNDO_ALL_ROLES = {"gm","housekeeping_supervisor","front_desk"}` (line 32) at line 51; line 55 housekeeper-self-only exception; line 198 `if not (request.force and current_user.role == "gm")` (gm-only force override); line 199 delegates to `_validate_transition` | Mixed — legitimate, sophisticated. Also see `services/room_status_transitions.py`'s `_OOO_ROLES = {"gm","housekeeping_supervisor","engineer"}` (line 34) for out-of-order marking authority. |

**Roll-up:** 3 named inline-only routers with confirmed action items (`guest_requests.py`, `lost_found.py`, `auth.py`), 2 routers not role-based by design (`internal.py`, `webhooks.py`), 2 routers hosting the named `MANAGER_ROLES`/`ALL_STAFF_ROLES` constant collisions (`programs.py`/`safety.py`, `hotels.py`), and 22 routers with clean or legitimately-mixed patterns requiring no change. Total: 3 + 2 + 2 + 22 = 30. ✓

## chief_engineer Note

Migration `064_merge_chief_engineer.sql` retired `chief_engineer` as an assignable value in `user_roles.role`:
- It migrated all existing `chief_engineer` rows to `engineer`.
- It tightened the `user_roles_role_check` CHECK constraint (and `staff_role_schedules.override_role`'s CHECK) to only permit `gm, housekeeping_supervisor, front_desk, housekeeper, engineer` — 5 values, no `chief_engineer`.
- The JWT-issuing hook (`019_jwt_hook.sql` / `053_fix_jwt_role_claim.sql`) reads the role directly from that constrained column.
- The API's own write-path boundary (`models/requests.py`'s `InviteStaffRequest.role`, `AddStaffDirectRequest.role`, `CreateCustomRoleRequest.base_role`) already excludes `"chief_engineer"` from its `Literal[...]` lists.
- The web app (`RoleForm.tsx`) already independently maps a "Chief Engineer" UI label to the `engineer` role value.

**Conclusion:** `chief_engineer` cannot occur in a live JWT today. Any router still referencing `"chief_engineer"` in a role-group constant or a `require_role(...)` call (e.g. `safety.py`, `evidence.py`, `assets.py`, `programs.py`, `integrations.py`, `ai_copilot.py`, `services/safety/contracts.py`) is checking a value that can never match — this is **dead-but-harmless, not a live gap requiring a fix this phase.** A full purge of `chief_engineer` across the ~19 files that still mention it (routers, services, tests, and the web app) is explicitly out of this phase's scope.

## RBAC-03 Review Outcomes (per router)

- **`auth.py` — REVIEWED, NO GAP.** `GET /auth/me` is self-scoped by `current_user.user_id`/`current_user.hotel_id` — it inherently cannot leak another user's data regardless of role. `POST /auth/hotel-context` validates hotel access via a live `user_roles` DB lookup, which is a stronger guarantee than a static role gate since it checks actual membership in the target hotel, not just the caller's role name. Inline role checks are absent by design, not by omission.

- **`lost_found.py` — REVIEWED, 2 GAPS FOUND AND CLOSED THIS PHASE.** `PATCH /{item_id}` (lines 213-247) and `DELETE /{item_id}` (lines 250-263) were ungated. `PATCH` could set `status` to `claimed`/`donated`/`discarded` — the same custody/disposition state transition that `POST /{item_id}/custody-events` already restricts to `{"front_desk","housekeeping_supervisor","gm"}` — meaning any authenticated user could bypass that gate entirely by calling `PATCH` instead. `DELETE` permanently destroyed the item record (cascading to `lost_found_custody_events`) with no role check at all. Both endpoints were gated to the same `{"front_desk", "housekeeping_supervisor", "gm"}` set already governing custody-events in this file (see plan 19-03).

- **`guest_requests.py` — REVIEWED, 1 GAP FOUND AND CLOSED THIS PHASE.** `DELETE /{request_id}` (lines 585-618) was ungated — any authenticated tenant user (including `housekeeper`) could permanently delete a guest request and cascade-delete its linked `task` + `task_comments` rows. Gated to `SLA_POLICY_ROLES = {"gm","housekeeping_supervisor"}`, reusing this router's existing "management tier" constant rather than introducing a new one (see plan 19-02).

## RBAC-04 Constant Decisions

1. **`MANAGER_ROLES` (safety.py) vs `MANAGER_ROLES` (programs.py) are two different authority tiers that shared a name — not one drifted value.** `safety.py`'s `MANAGER_ROLES = ("gm","housekeeping_supervisor","chief_engineer")` gates leadership/compliance-accountability actions (training assignment, compliance export, incident reporting) — 4 independent call sites across the codebase (`safety.py`, `services/safety/contracts.py`'s `MANAGEMENT_ROLES`, `evidence.py`'s `COMPETENCY_MANAGER_ROLES`, and `ai_copilot.py`'s inline management-tier gates + its test) already agree on this exact value. `programs.py`'s `MANAGER_ROLES = ("gm","housekeeping_supervisor","engineer","chief_engineer")` gates day-to-day operational program management (PM schedules, deep-clean schedules, supply pars) where a line engineer plausibly needs access, since PM work is engineer-executed. Resolved by two distinctly-named constants in `apps/api/core/roles.py`: `MANAGER_ROLES` (leadership/compliance tier, unchanged value) and `PROGRAM_MANAGER_ROLES` (operational-program tier including line engineers, used only by `programs.py`). No access was added or removed anywhere — this is a rename-and-relocate, not a behavior change.

2. **`ALL_STAFF_ROLES` (hotels.py) fix is dedup-only.** The bug was a duplicate `"engineer"` value (`("gm","housekeeping_supervisor","engineer","front_desk","housekeeper","engineer")`), not a missing `"chief_engineer"`. Resolved to `("gm","housekeeping_supervisor","engineer","front_desk","housekeeper")` — the 5 roles that can actually exist in a live JWT. `chief_engineer` is intentionally **not** re-added: it was deliberately retired by migration 064 (see chief_engineer Note above), and re-adding it would contradict the DB CHECK constraint, the JWT hook, and the API's own request-model boundary, all of which already exclude it. This is documentation-correctness, not a security change — a value that can never occur in a live JWT doesn't grant or deny anything by being present or absent in a set-membership check.

3. **`services/policy.py`'s `_ROLE_RANK` is a different paradigm** — a numeric rank dict (housekeeper=0, front_desk=1, hks=2, engineer=2, gm=3) used only by `ai_copilot.py`'s AI-action gating, not a set-membership role-group constant. It is intentionally **not** folded into `apps/api/core/roles.py`, to avoid conflating two structurally different mechanisms. Minor same-value/different-name constants (`SESSION_ROLES`/`SHIFT_ROLES`, both `("housekeeper","housekeeping_supervisor")`; `SUPERVISOR_ROLES`/`_OOO_ROLES`, both `{"gm","housekeeping_supervisor","engineer"}`) are explicitly out of scope for this phase — their values already match, so there is no drift risk to close, and consolidating them would be pure refactor with no bug-fix value.
