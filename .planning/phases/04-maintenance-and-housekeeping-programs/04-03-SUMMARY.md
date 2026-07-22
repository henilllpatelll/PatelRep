---
phase: 04-maintenance-and-housekeeping-programs
plan: 03
subsystem: api
tags: [operational-audit, pm-programs, separation-of-duty, escalation, defensibility]
dependency-graph:
  requires:
    - "04-01: programs.py MANAGER_ROLES/RBAC baseline, test_programs_routes.py harness"
    - "04-02: persist_pm_completion evidence-ID validation contract; assets.py complete_pm_schedule call site"
  provides:
    - "Distinct-approver PM deferral flow with append-only pm_deferral.approved audit event"
    - "Criticality-based corrective-WO priority (emergency for life_safety, urgent otherwise) with an escalatable due_at"
    - "operational_audit_events pm_check.failed_containment row per failed PM checklist item"
    - "persist_pm_completion(actor_role=...) contract — required by any future caller of this function"
  affects:
    - apps/api/routers/programs.py
    - apps/api/services/programs/contracts.py
    - apps/api/services/programs/execution.py
    - apps/api/routers/assets.py
tech-stack:
  added: []
  patterns:
    - "Reused routers/evidence.py's operational_audit_events column set (tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, reason_code, reason_note, source) rather than inventing a parallel audit shape — programs.py and execution.py each hold a local mirror of _record_audit_event since execution.py has no CurrentUser to draw actor_role from"
    - "Separation-of-duty check pattern: reject self-approval by equality check before the active-tenant-user existence check, so the 422 (business-rule violation) fires before the 404 (approver doesn't exist) when both would otherwise apply"
key-files:
  created: []
  modified:
    - apps/api/models/requests.py
    - apps/api/routers/programs.py
    - apps/api/services/programs/contracts.py
    - apps/api/services/programs/execution.py
    - apps/api/routers/assets.py
    - apps/api/tests/test_programs_routes.py
    - apps/api/tests/test_operational_programs.py
decisions:
  - "Worktree branched from before 04-01/04-02 landed on main (same situation 04-02 documented for 04-01); fast-forward merged local main (38b050b3) into this branch first — clean working tree, no divergent local commits — to pick up the RBAC baseline and evidence-linkage contract this plan depends on."
  - "Mirrored routers/evidence.py's _require_active_tenant_user and _record_audit_event as local, programs.py-scoped helpers (renamed to _require_active_tenant_approver for accurate error wording) rather than importing the evidence.py versions directly — evidence.py's helper hardcodes 'Controlled document {label} is not active' in its error message, which would read wrong for a deferral-approver context. Both mirrors write to the same operational_audit_events table/column set; no parallel audit mechanism was introduced."
  - "build_corrective_work_order and persist_pm_completion both gained new required keyword parameters (completed_at/criticality on the former, actor_role on the latter) rather than optional ones with silent defaults — operational_audit_events.actor_role is NOT NULL in the DB (migration 065), so a silently-defaulted actor_role would either violate that constraint or fabricate a fake role. Required kwargs force every call site to supply real values."
metrics:
  duration: "~50 min"
  completed: "2026-07-22"
---

# Phase 4 Plan 03: PM Deferral Separation-of-Duty + Corrective-WO Hardening Summary

Closed three Phase-4 defensibility gaps (G2, G4, G8) by reusing the Phase 1/2 append-only `operational_audit_events` machinery — no parallel audit mechanism was built. PM deferrals now require a distinct, active-tenant approver and write an audited approval event; a failed PM checklist item now creates a criticality-priced, escalatable corrective work order (life-safety → `emergency`/4h, everything else → `urgent`/24h, both with `due_at` set) and writes an append-only containment audit event naming the item and the follow-up work order.

## What Was Built

### Task 1 — Deferral request/approve with distinct approver + audit (G4, G2) — commit `475614a7`

- `CreatePMDeferralRequest` (`apps/api/models/requests.py`) gained `approved_by: str` — an `evidence_records.id`-style UUID reference to an active tenant user, not the requester.
- `defer_pm_schedule` (`apps/api/routers/programs.py`):
  - Rejects `approved_by == current_user.user_id` with 422 ("A deferral requires an approver distinct from the requester") **before** touching the database — a self-approval attempt writes zero `pm_deferrals` rows.
  - Validates `approved_by` is an active user at this tenant via a new local `_require_active_tenant_approver` helper (mirrors `routers/evidence.py`'s `_require_active_tenant_user` pattern, including the bug-449 `if not result or not result.data` None-safety guard) — 404 if the approver isn't active at the property.
  - `pm_deferrals.approved_by` is now `request.approved_by`, not `current_user.user_id` — the self-approval bug (requested_by == approved_by == current_user for every deferral) is closed.
  - On success, writes an `operational_audit_events` row via a new local `_record_audit_event` helper: `resource_type="pm_deferral"`, `action="pm_deferral.approved"`, `reason_code="pm_deferral"`, `new_state={deferred_until, reason, approved_by}`. `pm_deferrals` itself stays append-only (no mutation after insert).

### Task 2 — Corrective work order hardening: due_at, criticality priority, containment audit (G8) — commit `f1f58e41`

- `build_corrective_work_order` (`apps/api/services/programs/contracts.py`) gained required `completed_at: datetime` and optional `criticality: str | None` parameters:
  - `priority = "emergency" if criticality == "life_safety" else "urgent"` (previously always `"urgent"`, even for life-safety failures).
  - `due_at = completed_at + timedelta(hours=CORRECTIVE_WO_SLA_HOURS[priority])` — 4h for `emergency`, 24h for `urgent` — so `GET /v1/internal/escalations/check` (which filters `work_orders` on `due_at`) can now actually find and auto-escalate these corrective WOs. Previously `due_at` was never set, so the cron could never pick them up.
  - No migration was needed: `work_orders.due_at`/`is_pm_generated`/`sla_minutes` have existed since migration 007; this task is code-only, confirmed by `grep` showing no new migration file in this plan's diff.
- `persist_pm_completion` (`apps/api/services/programs/execution.py`):
  - Gained a required `actor_role: str` parameter — `execution.py` has no `CurrentUser`, and `operational_audit_events.actor_role` is `NOT NULL` (migration 065), so the caller (`assets.py`) must supply it explicitly (`current_user.role`).
  - New `_fetch_asset_criticality` helper looks up the failing item's asset's `criticality` once per completion (not once per failed item) before building any corrective WOs.
  - New `_record_containment_audit` helper writes one `operational_audit_events` row per failed checklist item: `resource_type="pm_completion"`, `action="pm_check.failed_containment"`, `reason_code="failed_check"`, `new_state={item: <label>, work_order_id: <new WO id>}`. Corrective-WO creation itself stays a plain insert (creation is not a transition, per 04-RESEARCH.md A5) — any later status change on that WO must go through `transition_work_order_with_audit`, not a bare PATCH.
- `apps/api/routers/assets.py`'s `complete_pm_schedule` now passes `actor_role=current_user.role` into `persist_pm_completion`.
- Fixed the two pre-existing `persist_pm_completion`/`build_corrective_work_order` call sites in `test_operational_programs.py` for the new required kwargs (Rule 1 — these tests would otherwise fail on the signature change) and extended their assertions to cover `due_at`, `priority`, and the new containment audit row.

### Task 3 — Route + unit tests for deferral approval and corrective containment — commit `0d84250c`

Added to `apps/api/tests/test_programs_routes.py`:
- `test_deferral_self_approval_rejected` — self-approval → 422, zero `pm_deferrals` rows.
- `test_deferral_approval_writes_audit` — distinct active approver → 200 + exactly one `pm_deferral.approved` audit event with matching `resource_id`/`reason_code`.
- `test_deferral_inactive_approver_rejected` — an approver who exists but `is_active=False` → 404, zero `pm_deferrals` rows (covers the `_require_active_tenant_approver` branch, not just the self-approval branch).
- `test_failed_check_writes_containment_audit` — a failed PM item at the HTTP route level creates a corrective WO with `due_at` set AND exactly one `pm_check.failed_containment` audit event whose `new_state.work_order_id` matches the created WO's id.

Added to `apps/api/tests/test_operational_programs.py`:
- `test_corrective_wo_priority_and_due_at_follow_asset_criticality` — pure-logic matrix: `life_safety` → `emergency` + `due_at` = completed_at+4h; `medium` → `urgent` + `due_at` = completed_at+24h.

**Verification:** `pytest tests/test_programs_routes.py tests/test_operational_programs.py -q` → 22 passed. Full suite `pytest tests/ -q` → **326 passed** (321 baseline after 04-02 + 5 new). `ruff check` on every touched file → clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two pre-existing test call sites broke by design once required kwargs landed**
- **Found during:** Task 2, running the targeted verify command
- **Issue:** `test_failed_pm_check_creates_tenant_scoped_corrective_work_order` called `build_corrective_work_order(...)` without `completed_at`; `test_pm_completion_persists_items_and_corrective_work_orders` / `test_pm_completion_rejects_evidence_id_from_another_tenant` called `persist_pm_completion(...)` without `actor_role`. Both are exactly the signature changes this task intentionally makes.
- **Fix:** Added `completed_at`/`actor_role` to the three call sites and strengthened assertions (priority, `due_at`, containment audit row) rather than just silencing the `TypeError`.
- **Files modified:** `apps/api/tests/test_operational_programs.py`
- **Commit:** `f1f58e41`

### Environment / Tooling Gap (test execution, not a plan gap)

**What was found:** This worktree had no `apps/api/.env` (same "no local credentials" situation 04-01/04-02 documented), and `core/config.py`'s `Settings()` requires `supabase_url`/`supabase_service_role_key`/`supabase_jwt_secret`/`cron_secret` to even import — `pytest` failed at collection with 4 missing-field validation errors before any test ran.
**Fix:** Created a local, gitignored `apps/api/.env` with dummy, non-functional values (`SUPABASE_URL=https://test.supabase.co`, etc.) — sufficient for `Settings()` to construct and for HS256 JWT encode/decode round-trips inside the FakeDB-backed test harness, which never makes a real Supabase network call. Confirmed via `.gitignore:27` (`apps/api/.env`) that this file is not tracked and will not be committed.

## Known Stubs

None — every code path this plan touches (deferral approval, corrective-WO priority/due_at, containment audit) is fully wired end-to-end against `operational_audit_events` and `work_orders`; nothing renders a placeholder or hardcoded empty value. The web UI for PM deferrals is not built yet (confirmed via grep — no `apps/web` file calls `POST /programs/pm-schedules/{id}/deferrals`), so there is no web regression risk from the new required `approved_by` field; wiring that UI is out of this plan's scope.

## Threat Flags

None — the surfaces touched (`POST /programs/pm-schedules/{id}/deferrals`, the failed-PM-item corrective-WO path inside `POST /assets/pm-schedules/{id}/complete`) are exactly T-04-10, T-04-11, and T-04-12 from this plan's own `<threat_model>`, and this plan implements their stated mitigations (distinct approver + audit; containment audit + escalatable due_at; documented prohibition on bare-PATCH status changes for corrective WOs) rather than introducing new unenumerated surface.

## Self-Check: PASSED

- FOUND: `apps/api/models/requests.py` (`CreatePMDeferralRequest.approved_by`)
- FOUND: `apps/api/routers/programs.py` (`_require_active_tenant_approver`, `_record_audit_event`, `pm_deferral.approved`)
- FOUND: `apps/api/services/programs/contracts.py` (`CORRECTIVE_WO_SLA_HOURS`, `due_at`, `emergency`)
- FOUND: `apps/api/services/programs/execution.py` (`_fetch_asset_criticality`, `_record_containment_audit`, `pm_check.failed_containment`)
- FOUND: commit `475614a7` (Task 1)
- FOUND: commit `f1f58e41` (Task 2)
- FOUND: commit `0d84250c` (Task 3)
- VERIFIED: `pytest tests/ -q` → 326 passed (321 baseline + 5 new)
- VERIFIED: `ruff check` on every touched file → clean
- VERIFIED: no new migration file in this plan's diff (`git show --stat` on all three commits lists zero files under `supabase/migrations/`)
