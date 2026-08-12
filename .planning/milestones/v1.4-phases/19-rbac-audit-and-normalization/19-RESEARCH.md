# Phase 19: RBAC Audit and Normalization - Research

**Researched:** 2026-08-04
**Domain:** FastAPI RBAC — role-check inventory, gap closure, constant consolidation (apps/api/routers/)
**Confidence:** HIGH (all findings are direct code/migration reads, not inference)

## Summary

This phase has two parts: (1) an exhaustive, file:line-precise inventory of every role check across `apps/api/routers/` classified as route-level gate vs. object-level/business-rule check, and (2) three concrete code fixes — gate `DELETE /guest-requests/{id}`, close two confirmed gaps in `lost_found.py` (not just review — actual ungated mutations were found), and consolidate the drifted `MANAGER_ROLES`/`ALL_STAFF_ROLES` constants into a new `apps/api/core/roles.py`.

**Critical discovery that reframes RBAC-04:** migration `064_merge_chief_engineer.sql` retired `chief_engineer` as an assignable value in `user_roles.role` months ago — the live DB CHECK constraint, the JWT-issuing hook, and the staff-invite/custom-role request models all now cap roles to 5 values (`gm, housekeeping_supervisor, front_desk, housekeeper, engineer`). `chief_engineer` **cannot occur in a live JWT today**. Every `require_role(..., "chief_engineer")` and every constant containing `"chief_engineer"` across ~19 files (routers, services, tests, and the web app) is checking a value that can never match — dead-but-harmless, not a live gap. This directly affects how RBAC-04's "chief_engineer missing from ALL_STAFF_ROLES" should be read (see Decision 3 below). Full evidence in the "Critical Discovery" section.

**Primary recommendation:** Treat RBAC-01 as a documentation task (write the inventory table below into the audit artifact essentially as-is), RBAC-02/03 as small, surgical inline-check additions matching each router's existing idiom, and RBAC-04 as a rename-and-relocate exercise into `apps/api/core/roles.py` — not a value-changing merge, since the two `MANAGER_ROLES` definitions turn out to represent two genuinely different concepts, not one drifted value (see Decision 1).

## Critical Discovery: `chief_engineer` is a retired role (migration 064)

**Evidence, in order:**

1. `supabase/migrations/064_merge_chief_engineer.sql` (full file):
   - Line 5: `UPDATE user_roles SET role = 'engineer' WHERE role = 'chief_engineer';` — migrates all existing data.
   - Lines 15-18: drops and recreates `user_roles_role_check` as `CHECK (role IN ('gm', 'housekeeping_supervisor', 'front_desk', 'housekeeper', 'engineer'))` — **`chief_engineer` is no longer a legal value in the column that the JWT hook reads.**
   - Lines 9-12: `staff_role_schedules.override_role` CHECK similarly tightened to drop `chief_engineer`.
   - Comment in the migration: "Most hotels have one engineer, not a two-tier engineering department."
2. `apps/api/services/work_orders/transitions.py:42-44`: explicit comment confirms this is understood elsewhere in the codebase: *"Migration 064 intentionally merged chief_engineer into engineer. Engineers therefore retain the operational authority previously held by that role."*
3. `supabase/migrations/019_jwt_hook.sql` and `053_fix_jwt_role_claim.sql` (the two versions of `custom_access_token_hook`): both pull the role claim via `SELECT r.role FROM user_roles r WHERE r.user_id = ... AND r.is_active = true` — i.e., directly from the column capped by migration 064. There is no path from `custom_roles.base_role` (which migration `028_custom_roles.sql` still permits `chief_engineer` on — an inconsistency, but that field only drives sidebar module visibility via `staff.py:get_effective_role`, never the JWT `user_role`/`role` claim itself).
4. `apps/api/models/requests.py` — `InviteStaffRequest.role` (line 931-938), `AddStaffDirectRequest.role` (line 950-957), `CreateCustomRoleRequest.base_role` (line 972-979): all `Literal[...]` lists contain `"engineer"` **twice** and do **not** contain `"chief_engineer"` at all — the API's write-path boundary already rejects assigning `chief_engineer` to anyone. The duplicate `"engineer"` is the leftover of a find/replace that swapped `"chief_engineer"` → `"engineer"` without deduplicating.
5. `apps/web/components/settings/RoleForm.tsx:38-45` (`BASE_ROLES`) — the frontend already independently made the same adjustment: the row labeled `'Chief Engineer'` has `value: 'engineer'` (not `'chief_engineer'`), so selecting "Chief Engineer" in the UI assigns the role `engineer`. This is the exact same duplicate-value pattern as `hotels.py`'s `ALL_STAFF_ROLES`.

**Conclusion:** `hotels.py`'s `ALL_STAFF_ROLES = ("gm", "housekeeping_supervisor", "engineer", "front_desk", "housekeeper", "engineer")` is not an isolated bug — it's the same "chief_engineer → engineer, dedupe forgotten" pattern that already exists, independently, in `models/requests.py` and `RoleForm.tsx`. The duplicate `"engineer"` is real cosmetic debt worth fixing; treating the *absence* of `chief_engineer` as the bug (per the roadmap's literal wording) would be reintroducing a value that cannot occur in production. See Decision 3 for the recommended resolution.

**What this means for RBAC-01's audit artifact:** any router still referencing `"chief_engineer"` (assets.py, ai_copilot.py, integrations.py, programs.py, safety.py, evidence.py, services/safety/contracts.py) should be annotated in the audit as "includes a retired role value (migration 064) — harmless no-op, not a live gap," not flagged as something requiring a fix in this phase. Full purge of `chief_engineer` from ~19 files (including the web app) is a separate, larger cleanup and is out of this phase's stated scope.

## RBAC-01: Full Role-Check Inventory

All 30 files in `apps/api/routers/` (excluding `__init__.py`, which has no routes). "Route-level" = `Depends(require_role(...))` on the endpoint signature. "Object-level" = inline `if current_user.role ...` inside a handler body.

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
| `evidence.py` | `EVIDENCE_CAPTURE_ROLES` (line 38-40, all 6 roles) used lines 417,478,517; `COMPETENCY_MANAGER_ROLES = ("gm","housekeeping_supervisor","chief_engineer")` (line 41) used lines 358,403,440; plus `require_role("gm")` lines 234,281,305,330,592,647 | none | Clean — `COMPETENCY_MANAGER_ROLES` already matches `safety.py`'s `MANAGER_ROLES` value exactly (independent convergence, see Decision 1). |
| `assets.py` | `require_role` combos of gm/engineer/chief_engineer at lines 50,114,135,214,231,267,294,328,367,388 | none | Clean. |
| `programs.py` | `MANAGER_ROLES = ("gm","housekeeping_supervisor","engineer","chief_engineer")` (line 43) used at lines 121,188,220,283,289,321,433,447,459; plus narrower gates: line 145 `require_role("gm")`; line 249 `require_role("gm","chief_engineer")`; line 301 `require_role("housekeeper","housekeeping_supervisor","gm")`; lines 328,335,342 `require_role("gm","housekeeping_supervisor")`; line 349 adds `"chief_engineer"` | none | Route-level only. **`MANAGER_ROLES` is RBAC-04 collision target #2 — value differs from safety.py's by including `"engineer"`.** |
| `lost_found.py` | none | line 170 `if current_user.role not in {"front_desk","housekeeping_supervisor","gm"}:` (custody-events only) | **RBAC-03 target — 2 confirmed gaps found, not just "review." See below.** |
| `ai_copilot.py` | lines 506,716,829,843,855,904,934,955,977 various `require_role` combos | line 562 `check_action_permitted(action, current_user.role)` delegates to `services/policy.py`'s rank-based system (see below); line 291 audit-only | Mixed — legitimate, uses a second RBAC paradigm (rank, not set-membership) for some AI-suggested actions. |
| `billing.py` | `require_role("gm")` lines 17,29,111,131,163 | none | Clean. |
| `guest_requests.py` | none | `MESSAGE_ROLES = ("front_desk","housekeeping_supervisor","engineer","gm")` (line 38) at lines 213,300,334; `SLA_POLICY_ROLES = {"gm","housekeeping_supervisor"}` (line 40) at lines 444,476; line 375 `{"gm","front_desk"}` (compensation approval); line 493 `{"gm","housekeeping_supervisor","engineer"}` (accessible-room features) | **RBAC-02 target. `DELETE /{request_id}` (line 585-618) has zero role check — see below.** |
| `hotels.py` | `ALL_STAFF_ROLES = ("gm","housekeeping_supervisor","engineer","front_desk","housekeeper","engineer")` (line 11) at lines 118,194; `require_role("gm")` lines 135,174; `require_role("gm","housekeeping_supervisor")` line 160 | none (line 245 `list_hotel_departments` deliberately ungated — read-only reference data, any authenticated staff) | **`ALL_STAFF_ROLES` is RBAC-04 target #3 — see Critical Discovery above.** `POST /hotels` uses `get_current_user_no_hotel` by design (pre-tenant bootstrap, no role to check yet). |
| `integrations.py` | `require_role("gm")` lines 28,104,184,201; `require_role("gm","chief_engineer")` lines 121,140 | none | Clean. |
| `internal.py` | N/A — not role-based | N/A | Gated by `verify_cron` (`X-Cron-Secret` header, line 14), a wholly separate auth mechanism for GitHub Actions cron calls. Out of RBAC scope by design. |
| `logbook.py` | `require_role("gm","housekeeping_supervisor","engineer")` line 209 | lines 124,176 `is_privileged = current_user.role in ("gm","housekeeping_supervisor","engineer")` (drives redaction/visibility, not a hard 403) | Mixed — legitimate, business-rule filtering not access denial. |
| `management_roi.py` | `require_role("gm")` lines 132,153,186,223,249,273,286 | none | Clean. |
| `scheduling.py` | `SUPERVISOR_ROLES = ("gm","housekeeping_supervisor","engineer")` (line 15) at lines 74,109,131,198,214,246,334 | lines 278,311 `is_supervisor = current_user.role in SUPERVISOR_ROLES` (branches response scope, not a 403) | Mixed — legitimate. |
| `sop.py` | line 81 `require_role("gm","housekeeping_supervisor","engineer")`; line 176 `require_role("gm")` | none | Clean. |
| `staff.py` | `require_role("gm")` at 9 endpoints (lines 152,205,248,322,337,356,373,387,404,437,453,477); line 85 `require_role("gm","housekeeping_supervisor","engineer","chief_engineer","front_desk")` (list_staff) | lines 39,74,77 read `current_user.role` for the *response payload* of `get_effective_role` — informational, not a gate | Clean — no access-control gap; the role-override logic just reports role, doesn't grant it. |
| `webhooks.py` | N/A — not role-based | N/A | Gated by Stripe/Twilio/Opera signature verification (`_verify_twilio_signature`, `_verify_opera_signature`), a separate auth mechanism. Out of RBAC scope by design. |
| `work_orders.py` | `require_role("engineer","gm")` lines 317,360,406,446,521,533,607,655; `require_role("gm")` line 494 | lines 35-59 `_ensure_engineer_can_update_work_order` and lines 62-72 `_ensure_engineer_can_complete_work_order` — engineer-specific self-assignment restrictions layered under the route gate | Mixed — legitimate, sophisticated. Also see `services/work_orders/transitions.py`'s `_MANAGEMENT_ROLES = {"gm","engineer"}` (line 44) for override authority — module-private, WO-specific, not part of the RBAC-04 named collisions but worth the planner knowing it exists (deliberately excludes `housekeeping_supervisor`/`chief_engineer` — WO overrides are gm+engineer only). |
| `housekeeping.py` | `require_role("gm","housekeeping_supervisor")` at ~12 sites (lines 789,908,980,1234,1314,1389,1462,1662,1704,1772,1829,1902,1925,2041); `require_role("housekeeper","housekeeping_supervisor")` line 579 | none | Clean. |
| `rooms.py` | `require_role("gm","housekeeping_supervisor","front_desk")` lines 270,379,455,548,602; `require_role("gm","housekeeping_supervisor")` lines 691,788,1101,1127; `require_role("housekeeper","housekeeping_supervisor","gm")` lines 835,867; `require_role("gm","housekeeping_supervisor","engineer","front_desk")` line 898 | `UNDO_ALL_ROLES = {"gm","housekeeping_supervisor","front_desk"}` (line 32) at line 51; line 55 housekeeper-self-only exception; line 198 `if not (request.force and current_user.role == "gm")` (gm-only force override); line 199 delegates to `_validate_transition` | Mixed — legitimate, sophisticated. Also see `services/room_status_transitions.py`'s `_OOO_ROLES = {"gm","housekeeping_supervisor","engineer"}` (line 34) for out-of-order marking authority. |

**Roll-up:** 3 named inline-only routers with confirmed action items (`guest_requests.py`, `lost_found.py`, `auth.py`), 2 routers not role-based by design (`internal.py`, `webhooks.py`), 2 routers hosting the named `MANAGER_ROLES`/`ALL_STAFF_ROLES` collisions (`programs.py`/`safety.py`, `hotels.py`), and 22 routers with clean or legitimately-mixed patterns requiring no change. This matches the "11 clean / 14 mixed" count from Phase 18's classification referenced in REQUIREMENTS.md once the 3 named + 2 non-role-based routers are set aside (11 + 14 + 3 + 2 = 30 ✓).

## RBAC-02: `DELETE /guest-requests/{id}` — confirmed ungated

`apps/api/routers/guest_requests.py:585-618`:

```python
@router.delete("/{request_id}", status_code=204)
async def delete_guest_request(
    request_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
```

No role check anywhere in the body — any authenticated tenant user (including `housekeeper`) can permanently delete a guest request and cascade-delete its linked `task` + `task_comments` rows (lines 608-618).

**Recommended fix** (matches this router's own established idiom — it never uses `Depends(require_role(...))`, only inline `if current_user.role not in X: raise HTTPException(403, ...)`, at lines 213, 300, 334, 444, 476, 493):

```python
@router.delete("/{request_id}", status_code=204)
async def delete_guest_request(
    request_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    if current_user.role not in SLA_POLICY_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to delete guest requests")
    ...
```

**Role set recommendation:** reuse the existing `SLA_POLICY_ROLES = {"gm", "housekeeping_supervisor"}` (line 40) rather than defining a new constant. Rationale: within this file, `SLA_POLICY_ROLES` is already the narrowest "configuration/management" tier (used for creating/deleting SLA rules); permanently destroying a guest request record (with cascade) is at least as sensitive as an SLA rule change, and reusing an existing constant avoids introducing a fourth role-group name into an already-3-constant file. `front_desk` and `engineer` (who are trusted to message guests via `MESSAGE_ROLES`) are deliberately excluded from delete authority — they can act on requests operationally but a permanent, cascading delete is reserved for the two management roles, consistent with the SLA-policy precedent already in this file.

## RBAC-03: `lost_found.py` and `auth.py` — inline-only review

### `auth.py` — no gaps found

Both endpoints reviewed in full (`apps/api/routers/auth.py`, 57 lines total):
- `GET /auth/me` (line 8-39): returns the caller's own profile/hotel/subscription snapshot. No role check needed — it's inherently self-scoped by `current_user.user_id`/`current_user.hotel_id`.
- `POST /auth/hotel-context` (line 42-56): validates hotel access via a live `user_roles` lookup (lines 45-51) rather than a static role check — this is stronger than a role gate since it checks actual membership in the target hotel, not just the caller's role name.

**Conclusion: no gap. Document as "reviewed — inline role checks are absent by design; both endpoints are self-scoped or DB-validated, not role-gated."**

### `lost_found.py` — 2 confirmed gaps (not just "review")

Full file reviewed (`apps/api/routers/lost_found.py`, 263 lines). Inline check inventory:

| Endpoint | Line | Role check | Assessment |
|---|---|---|---|
| `POST /upload-photo` | 25-52 | none | Correct as-is — benign, feeds into `create_lost_found_item` which is also open. |
| `POST ""` (create item) | 55-86 | none | Correct as-is — any staff member can log a found item; this is the intended low-friction path (a hotel policy question, not a security gap). |
| `GET ""`, `GET /{id}`, `GET /{id}/custody-events` | 89-161 | none | Correct as-is — tenant-scoped reads. |
| `POST /{item_id}/custody-events` | 164-210 | line 170: `if current_user.role not in {"front_desk","housekeeping_supervisor","gm"}:` | Correct, already gated. |
| `PATCH /{item_id}` | 213-247 | **none** | **GAP.** This endpoint can set `status` to `claimed`/`donated`/`discarded` (line 218-227, 230-234) — the exact same state transition that `POST /{item_id}/custody-events` gates by role. Any authenticated user can bypass the custody-chain role gate entirely by calling `PATCH` instead of the custody-events endpoint. |
| `DELETE /{item_id}` | 250-263 | **none** | **GAP.** Permanently deletes the item record (cascades to `lost_found_custody_events` via migration 087's DB-level CASCADE, per `tests/test_lost_found_delete.py`'s own docstring). Same shape of gap as `guest_requests.py`'s DELETE — no role check at all. |

**Recommended fix for both:** reuse the same role set already used for `custody-events`, `{"front_desk", "housekeeping_supervisor", "gm"}` — that set represents "who's authorized to change custody/disposition of a physical item," and both `PATCH` (which can change `status`, the custody state) and `DELETE` (which destroys the record) fall squarely into that category:

```python
@router.patch("/{item_id}")
async def update_lost_found_item(
    item_id: str, body: dict, current_user: CurrentUser = Depends(get_current_user)
):
    if current_user.role not in {"front_desk", "housekeeping_supervisor", "gm"}:
        raise HTTPException(status_code=403, detail="Not authorized to update this item")
    ...

@router.delete("/{item_id}", status_code=204)
async def delete_lost_found_item(
    item_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    if current_user.role not in {"front_desk", "housekeeping_supervisor", "gm"}:
        raise HTTPException(status_code=403, detail="Not authorized to delete this item")
    ...
```

Note: `tests/test_lost_found_delete.py` (existing, passing) only exercises `role="gm"` for delete — adding the gate will not break it, but the planner should add a companion `role="housekeeper"` → 403 case (pattern shown in that same file's `_auth_header` helper — see RBAC live-verification section below).

## RBAC-04: Role-group constant drift

### Collision 1: `MANAGER_ROLES` (`programs.py` vs `safety.py`)

- `apps/api/routers/safety.py:34`: `MANAGER_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")`
- `apps/api/routers/programs.py:43`: `MANAGER_ROLES = ("gm", "housekeeping_supervisor", "engineer", "chief_engineer")` — same name, **adds `"engineer"`**.

Two more constants independently converge on `safety.py`'s exact value (evidence this is the more "canonical" grouping):
- `apps/api/services/safety/contracts.py:10`: `MANAGEMENT_ROLES = {"gm", "housekeeping_supervisor", "chief_engineer"}`
- `apps/api/routers/evidence.py:41`: `COMPETENCY_MANAGER_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")`
- Also matches `ai_copilot.py`'s inline management-tier gates at lines 829, 843 (`require_role("gm", "chief_engineer", "housekeeping_supervisor")`) and the existing test `tests/test_ai_copilot_rbac.py:68` (`ALLOWED_ROLES = ["gm", "chief_engineer", "housekeeping_supervisor"]`).

**Investigation of what each actually gates:**
- `safety.py`'s `MANAGER_ROLES` gates: training-course assignment, compliance export, controlled-incident listing/creation, emergency-contact/drill creation — all leadership/compliance-accountability actions (Texas safety training + incident reporting is a GM/department-head responsibility, not a line-engineer one).
- `programs.py`'s `MANAGER_ROLES` gates: PM (preventive maintenance) program overview, deep-clean schedules, supply pars, inspection quality, public areas — day-to-day operational program management where a line `engineer` plausibly needs visibility/edit access, since PM schedules are engineer-executed work.

**Decision 1 (documented for planner, conservative/defensible call):** These are two genuinely different authority tiers that happen to share a name, not one drifted value with a single correct answer. Recommend **do not merge to one value** — instead, disambiguate with two distinctly-named constants in the new source-of-truth module:
- `MANAGER_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")` — the majority/canonical value (4 independent call sites already agree on it: `safety.py`, `services/safety/contracts.py`, `evidence.py`, `ai_copilot.py` inline + its test). Represents leadership/compliance-tier authority.
- `PROGRAM_MANAGER_ROLES = ("gm", "housekeeping_supervisor", "engineer", "chief_engineer")` — `MANAGER_ROLES` + `engineer`, used only by `programs.py`. Represents operational-program authority that includes line engineers.

Both routers import from the new module and use the constant matching their actual semantics — `programs.py` switches its 9 `require_role(*MANAGER_ROLES)` call sites (lines 121,188,220,283,289,321,433,447,459) to `require_role(*PROGRAM_MANAGER_ROLES)`; `safety.py` keeps using `MANAGER_ROLES` unchanged in value, just imported instead of locally defined. This preserves current behavior exactly (no access is added or removed anywhere) while eliminating the drift risk of two same-named constants with different values.

### Collision 2: `ALL_STAFF_ROLES` (`hotels.py`)

`apps/api/routers/hotels.py:11`: `ALL_STAFF_ROLES = ("gm", "housekeeping_supervisor", "engineer", "front_desk", "housekeeper", "engineer")`.

**Decision 3 (documented for planner, conservative/defensible call, informed by the Critical Discovery above):** The bug is the duplicate `"engineer"`, not a missing `"chief_engineer"` — `chief_engineer` cannot occur in a live JWT since migration 064 (see Critical Discovery). Two defensible options:
- **(a) Minimal fix (recommended):** dedupe to the 5 live roles: `ALL_STAFF_ROLES = ("gm", "housekeeping_supervisor", "engineer", "front_desk", "housekeeper")`. This is the factually correct "all staff who can actually hold a role today" set.
- **(b) Consistency fix:** keep `chief_engineer` in the set (as `MANAGER_ROLES`/`COMPETENCY_MANAGER_ROLES`/`EVIDENCE_CAPTURE_ROLES` all still do) purely so `ALL_STAFF_ROLES` isn't the one outlier that dropped it, since it's a harmless no-op membership check either way and a full purge of `chief_engineer` across ~19 files is explicitly out of this phase's scope.

Recommend **(a)** — the minimal, factually-accurate fix — because option (b) requires re-adding a value the research shows was deliberately retired, which is harder to justify to a future reader of `core/roles.py` who doesn't know migration 064's history. `core/roles.py` should carry a one-line comment noting `chief_engineer` was retired by migration 064 and is intentionally absent from `ALL_STAFF_ROLES`, so a future engineer doesn't "fix" it back in. Either way, no behavior changes in practice (a value that can never occur in a live JWT doesn't grant or deny anything by being present or absent) — the value is documentation-correctness, not security.

### Additional constants found (informational, not required by RBAC-04's explicit scope)

Full search of `_ROLES\s*[:=]` across `apps/api/`:

| Constant | File:line | Value | Note |
|---|---|---|---|
| `EVIDENCE_CAPTURE_ROLES` | `evidence.py:38-40` | all 6 roles incl. `chief_engineer` | Locked in by `tests/test_evidence_foundation.py:640-642` — do not change. |
| `MESSAGE_ROLES` | `guest_requests.py:38` | `(front_desk, hks, engineer, gm)` | Unique concept (who may contact guests), no collision. |
| `SLA_POLICY_ROLES` | `guest_requests.py:40` | `{gm, hks}` | Unique, no collision. |
| `SESSION_ROLES` | `clean_sessions.py:28` | `(housekeeper, hks)` | Same *value* as `SHIFT_ROLES` below, different name — optional bonus consolidation, not required. |
| `SHIFT_ROLES` | `shifts.py:14` | `(housekeeper, hks)` | Same value as `SESSION_ROLES` — optional. |
| `SUPERVISOR_ROLES` | `scheduling.py:15` | `(gm, hks, engineer)` | Same value as `_OOO_ROLES` below, different name/purpose — optional. |
| `_OOO_ROLES` | `services/room_status_transitions.py:34` | `{gm, hks, engineer}` | Module-private, out-of-order marking authority. Optional consolidation only. |
| `UNDO_ALL_ROLES` | `rooms.py:32` | `{gm, hks, front_desk}` | Unique, no collision. |
| `_MANAGEMENT_ROLES` | `services/work_orders/transitions.py:44` | `frozenset({gm, engineer})` | Module-private, WO override authority. Deliberately narrower (no `hks`/`chief_engineer`) — unique, no collision. |
| `_ROLE_RANK` | `services/policy.py:9-15` | numeric rank dict, not a set | A **different paradigm entirely** (ranked authority for AI-copilot actions: housekeeper=0, front_desk=1, hks=2, engineer=2, gm=3). Not a role-group constant to fold into the new module — flag to planner as a related-but-structurally-different mechanism so it isn't mistakenly touched. |

**Recommendation:** RBAC-04's explicit scope (per REQUIREMENTS.md) is only the two named collisions. Treat the table above as informational context; the planner should decide whether to fold `SESSION_ROLES`/`SHIFT_ROLES` and `SUPERVISOR_ROLES`/`_OOO_ROLES` into the new module too (low risk, values already identical) or explicitly defer them to keep this phase narrowly scoped. Recommend deferring — the two "collisions" in the table have identical values already, so there's no drift risk to close; consolidating them is pure refactor with no bug-fix value, and REQUIREMENTS.md's out-of-scope note ("not a mechanical rewrite ... not a blanket RBAC sweep") argues for leaving them.

### Where the source-of-truth module should live

Recommend **`apps/api/core/roles.py`** (new file). `apps/api/core/` currently holds `database.py`, `config.py`, `scheduler.py` — cross-cutting, imported-everywhere modules, which is exactly the profile of a role-constants module. Routers already import from `core.database`/`core.config` throughout, so `from core.roles import MANAGER_ROLES, PROGRAM_MANAGER_ROLES, ALL_STAFF_ROLES` is a familiar, zero-new-pattern import. Do **not** put it in `middleware/auth.py` — that file is scoped to JWT decode/dependency wiring (`get_current_user`, `require_role`), and mixing in a business-role taxonomy would blur that boundary.

Suggested `core/roles.py` contents:
```python
"""Canonical role-group constants. Single source of truth — routers must import
from here rather than defining local *_ROLES tuples, to prevent silent drift."""

ALL_ROLES = ("gm", "housekeeping_supervisor", "engineer", "front_desk", "housekeeper")
# chief_engineer was retired by migration 064_merge_chief_engineer.sql — it can no
# longer occur in a live JWT. Some routers still reference it in role-group
# constants as a harmless no-op; do not re-add it to ALL_ROLES/ALL_STAFF_ROLES.

ALL_STAFF_ROLES = ALL_ROLES  # hotels.py's prior definition had a duplicate "engineer"

MANAGER_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")
PROGRAM_MANAGER_ROLES = ("gm", "housekeeping_supervisor", "engineer", "chief_engineer")
```

## Live verification approach (success criterion 2)

The codebase already has the exact pattern needed, in `apps/api/tests/test_lost_found_delete.py:24-27`:

```python
def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}
```

This crafts a real, verifiable JWT signed with the same `SUPABASE_JWT_SECRET` the running API validates against (`middleware/auth.py:_decode_token` tries HS256 first) — no real Supabase user, no browser, no production traffic needed. `apps/api/.env` confirmed present locally with `SUPABASE_URL` and `SUPABASE_JWT_SECRET` set (`APP_ENV=development`), so this pattern works against both `TestClient(app)` (in-process, what the existing tests use) and a live `npm run dev:api` server via `curl -H "Authorization: Bearer <token>"` if a true out-of-process HTTP round trip is wanted.

**Recommended for this phase:** add a `pytest` test (same file or a new `test_guest_requests_delete_rbac.py`, following `test_lost_found_delete.py`'s exact structure with `FakeDB` + `TestClient`) asserting:
1. `DELETE /v1/guest-requests/{id}` with `_auth_header("housekeeper")` → 403.
2. `DELETE /v1/guest-requests/{id}` with `_auth_header("gm")` (or `"housekeeping_supervisor"`) → 204.

This is lighter-weight than the production test account (`hp.patelrep@gmail.com` / GM role, per memory — but that memory is 50 days old and only has a GM login, not a housekeeper one, so it can't produce the 403 case anyway) and satisfies "live" in the sense of an actual HTTP request through the real FastAPI app + dependency chain, not a mocked unit test. If the executor wants an actual out-of-process check, the same `_auth_header`-style token can be curl'd against `npm run dev:api` on `:8000` directly — no code changes needed to prove it, since the dev server already trusts locally-signed JWTs against the real `SUPABASE_JWT_SECRET`.

Do the same for `lost_found.py`'s `PATCH`/`DELETE` gaps once fixed — extend `test_lost_found_delete.py` with a `role="housekeeper"` → 403 case (currently only `role="gm"` is tested, which will still pass once the gate is added).

## Decisions Made (carry forward to planning — no open forks)

1. **`MANAGER_ROLES` collision is NOT a single drifted value** — `programs.py` and `safety.py` represent genuinely different authority tiers. Resolution: two distinctly-named constants in `core/roles.py` (`MANAGER_ROLES` = safety/compliance tier without line engineer; `PROGRAM_MANAGER_ROLES` = operational tier with line engineer), each router imports the one matching its existing behavior. No access changes.
2. **`ALL_STAFF_ROLES` fix is dedup-only**, not "add chief_engineer back" — migration 064 retired that role value from the live system; re-adding it would contradict the DB schema, JWT hook, and the API's own request-model boundary, all of which already exclude it.
3. **`DELETE /guest-requests/{id}`** gets an inline check reusing `SLA_POLICY_ROLES = {"gm", "housekeeping_supervisor"}` — matches this router's own inline-check idiom (no `Depends(require_role(...))` used anywhere in this file) and its existing "management tier" precedent.
4. **`lost_found.py`'s `PATCH`/`DELETE`** get inline checks reusing the same `{"front_desk", "housekeeping_supervisor", "gm"}` set already gating `custody-events` in that file — both endpoints touch the same custody/disposition state.
5. **New module location: `apps/api/core/roles.py`** — not `middleware/auth.py` (keep JWT mechanics separate from role taxonomy).
6. **Minor same-value/different-name constants** (`SESSION_ROLES`/`SHIFT_ROLES`, `SUPERVISOR_ROLES`/`_OOO_ROLES`) are **out of scope** — no drift risk since values already match; consolidating them is pure refactor with no bug to fix, and REQUIREMENTS.md explicitly scopes this phase away from a blanket sweep.
7. **`services/policy.py`'s `_ROLE_RANK`** is a different paradigm (ranked authority, not set membership) used only by `ai_copilot.py`'s AI-action gating — do not fold into `core/roles.py`; flag its existence to avoid confusion.

## Open Questions

None — all forks encountered were resolved above per the phase's instruction to make the conservative/defensible call rather than leave them open. The one item worth a light sanity check during planning (not blocking): confirm with a quick `grep` at execute-time that no other file was added/changed since this research (2026-08-04) that introduces a new `_ROLES` constant, since this is a fast-moving codebase (30 routers, active development).

## Sources

### Primary (HIGH confidence — direct code/migration reads)
- `apps/api/routers/*.py` (all 30 files) — full grep of `require_role(`, `current_user.role`, `.role ==`, `.role in`, `.role !=`, `_ROLES\s*=` plus full reads of `guest_requests.py`, `lost_found.py`, `auth.py`, `hotels.py`, `staff.py`, `programs.py` (partial), `work_orders.py` (partial).
- `apps/api/middleware/auth.py` — full read (`CurrentUser`, `get_current_user`, `require_role`, `_decode_token`).
- `apps/api/services/policy.py`, `services/safety/contracts.py`, `services/work_orders/transitions.py` — full/partial reads for cross-referenced role constants.
- `supabase/migrations/064_merge_chief_engineer.sql`, `019_jwt_hook.sql`, `053_fix_jwt_role_claim.sql`, `028_custom_roles.sql`, `027_staff_role_schedules.sql` — full reads, established the chief_engineer retirement chain.
- `apps/api/models/requests.py` (lines 929-994) — confirmed request-model role Literals.
- `apps/web/components/settings/RoleForm.tsx` (lines 1-60) — confirmed frontend already adapted to the chief_engineer→engineer merge.
- `apps/api/tests/test_lost_found_delete.py`, `tests/smoke/conftest.py`, `tests/smoke/test_auth_decode.py`, `tests/test_evidence_foundation.py` (line 639-648), `tests/test_ai_copilot_rbac.py` (lines 67-68) — existing test patterns and locked-in constant assertions.
- `apps/api/.env` (existence + non-secret keys only, confirmed `SUPABASE_URL`/`SUPABASE_JWT_SECRET`/`APP_ENV` present) — confirms local dev can validate self-signed JWTs.

### Secondary
- `~/.claude/projects/.../memory/reference_test_account.md` — production GM test account; flagged as 50 days stale and insufficient alone (no non-GM login) for the 403 case.

## Metadata

**Confidence breakdown:**
- Router inventory (RBAC-01): HIGH — exhaustive grep + targeted full reads, cross-checked against REQUIREMENTS.md's stated 11-clean/14-mixed/3-named count (30 total reconciles exactly).
- guest_requests.py DELETE gap (RBAC-02): HIGH — direct code read, unambiguous.
- lost_found.py/auth.py review (RBAC-03): HIGH — full-file reads of both; 2 gaps in lost_found.py confirmed by direct comparison against the file's own custody-events precedent.
- Constant drift + chief_engineer discovery (RBAC-04): HIGH — verified via migration SQL, JWT hook SQL, request-model Literals, and independent frontend confirmation (4 independent sources agree).

**Research date:** 2026-08-04
**Valid until:** ~14 days — this is an actively-developed router tree (30 files, 6 milestones deep); re-grep `_ROLES\s*=` before executing if significant time has passed.
