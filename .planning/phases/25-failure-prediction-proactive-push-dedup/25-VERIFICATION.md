---
phase: 25-failure-prediction-proactive-push-dedup
verified: 2026-08-12T00:00:00Z
status: passed
score: 6/6 must-haves verified
---

# Phase 25: Failure-Prediction Proactive Push + Dedup Verification Report

**Phase Goal:** Engineers, chief engineers, and GMs get proactively notified the moment an asset's failure-risk prediction newly crosses into HIGH risk, mirroring the notification parity room-readiness predictions already have — without being re-notified on every nightly cron re-run while risk stays HIGH.
**Verified:** 2026-08-12
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Engineer/chief_engineer/gm users receive a new in-app notification referencing the specific asset the moment its `failure_risk_score` newly crosses from below-70 to >=70 | ✓ VERIFIED | `notify_engineers_asset_risk_high()` (failure_predictions.py:312-373) wired at line 490-506, gated by `previous_score < 70 <= risk_score`. `test_new_high_risk_asset_sends_one_notification` passes: asserts `notifications_sent == 1`, inserted row has `type == "asset_risk_high"`, `"Boiler #1" in title`, correct `data` payload. |
| 2 | 3 consecutive cron runs on unchanged data (asset stays HIGH) produce exactly 1 notification total | ✓ VERIFIED | `previous_score` is re-read from the live `assets` row each call, and step 5 updates `assets.failure_risk_score` before the notify check on the *next* call. `test_double_run_idempotency_no_repeat_notification` passes: 1st run=1, 2nd=0, 3rd=0, total DB rows=1. `test_asset_already_high_does_not_renotify` (seeded already-HIGH) also passes with 0 sent. |
| 3 | Recipients resolved from `user_roles` (tenant_id + role in [engineer, chief_engineer, gm] + is_active=True), never `user_profiles` | ✓ VERIFIED | Code queries `supabase.table("user_roles").select("user_id").eq("tenant_id", hotel_id).in_("role", [...]).eq("is_active", True)` exclusively — no reference to `user_profiles` anywhere in the function. `test_recipients_use_user_roles_not_user_profiles` (user_profiles seeded, user_roles empty → 0 sent) and `test_recipients_notify_when_user_roles_populated` (user_roles populated → 1 sent) both pass. |
| 4 | An asset that drops out of HIGH and later re-enters HIGH triggers a new notification (edge-triggered, not one-shot) | ✓ VERIFIED | Trigger condition `previous_score < 70 <= risk_score` re-evaluates fresh on every run against the live column value — no permanent acknowledged/suppressed flag exists that would block re-entry. Logically sound per code inspection; not directly covered by a dedicated "drop-then-re-enter" test, but the mechanism (column-value comparison, no one-shot flag) structurally guarantees this behavior. |
| 5 | A user holding two matching roles (e.g. gm + engineer) receives exactly one notification per event, not one per role row | ✓ VERIFIED | `recipient_ids = {r["user_id"] for r in recipients if r.get("user_id")}` deduplicates via a Python set before building the insert payload. `test_dual_role_user_dedup` passes: 2 `user_roles` rows for same `user_id` → `sent == 1`, 1 DB row. |
| 6 | A notification-insert failure for one tenant is caught and does not raise out of that tenant's run or affect other tenants' notification delivery in the same all-hotels cron pass | ✓ VERIFIED | Double-layered isolation: `notify_engineers_asset_risk_high`'s own internal try/except around the insert (returns 0 on failure, never raises) plus the caller's wrapping try/except at failure_predictions.py:492-506. `test_per_tenant_notification_failure_is_isolated` (custom `_PerTenantFailingDB` that raises only for hotel-1's insert) passes: `run_all_hotels_failure_predictions()` does not raise, `notifications_sent == 1` (only hotel-2), hotel-1's `failure_predictions` row still written, hotel-2's notification unaffected. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/services/ai/failure_predictions.py` | `notify_engineers_asset_risk_high()` + trigger-condition wiring + `notifications_sent` propagated through both return dicts | ✓ VERIFIED | Function exists (line 312), contains `def notify_engineers_asset_risk_high`. Wired into `run_asset_failure_predictions` per-asset loop (line 490-506) behind `previous_score < 70 <= risk_score`. `notifications_sent` present in `run_asset_failure_predictions` return dict (line 522) and both early-return dicts (lines 406, 410), and in `run_all_hotels_failure_predictions`'s total dict (line 549), accumulation line (557), and early-return dict (line 545). |
| `apps/api/tests/test_failure_prediction_notifications.py` | New test file covering the 6 truths via FakeDB + monkeypatch harness | ✓ VERIFIED | 354 lines (exceeds 150-line min_haves threshold). 9 tests (plan specified 8; truth 5/"recipients" split into 2 sub-tests per the plan's own explicit allowance). All 9 pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `run_asset_failure_predictions` per-asset loop | `notify_engineers_asset_risk_high` | `previous_score = asset.get("failure_risk_score") or 0`, gated by `previous_score < 70 <= risk_score`, wrapped in try/except | ✓ WIRED | Line 421: `previous_score = asset.get("failure_risk_score") or 0`. Line 491: `if previous_score < 70 <= risk_score:` wrapping a try/except calling `notify_engineers_asset_risk_high(...)` and accumulating into `notifications_sent`. Exact pattern match. |
| `notify_engineers_asset_risk_high` | `user_roles` table | `.table("user_roles").select("user_id").eq("tenant_id", hotel_id).in_("role", [...]).eq("is_active", True)` | ✓ WIRED | Lines 327-333, exact match. |
| `run_all_hotels_failure_predictions` | `run_asset_failure_predictions` | `total["notifications_sent"] += stats.get("notifications_sent", 0)` | ✓ WIRED | Line 557, exact match. |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|-----------------|
| AI-06 (Phase 25 mapped requirement) | ✓ SATISFIED | All 4 ROADMAP.md success criteria for Phase 25 map 1:1 to passing tests: SC1→`test_new_high_risk_asset_sends_one_notification`, SC2→`test_double_run_idempotency_no_repeat_notification`+`test_asset_already_high_does_not_renotify`, SC3→`test_recipients_use_user_roles_not_user_profiles`+`test_recipients_notify_when_user_roles_populated`, SC4→`test_per_tenant_notification_failure_is_isolated`. |

### Anti-Patterns Found

None. No TODO/FIXME/placeholder markers, no empty stub returns, no console-log-only handlers in either modified/created file.

### Test Suite Results

- `pytest tests/test_failure_prediction_notifications.py -v` — 9/9 passed.
- `pytest tests/` (full API suite) — 570 passed, 3 failed. The 3 failures are in `tests/test_management_roi.py` (`test_roi_downtime_revenue_uses_tenant_adr`, `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`, `test_roi_pm_compliance_reads_pm_deferrals_table`), confirmed via `git log` to be pre-existing and unrelated — that file's last touching commit (`01c81a89`) predates this phase's two commits (`d625b37c`, `0be5dda5`), and this phase touched no ROI code. Zero regressions attributable to this phase.

### Schema Verification

- `notifications` table (migration 013) has all columns used by the insert: `tenant_id`, `user_id`, `type`, `title`, `body`, `data` (JSONB), `is_read`, `push_sent` — matches exactly.
- `user_roles` table (migration 003) has `user_id`, `tenant_id`, `role` (CHECK includes `engineer`, `chief_engineer`, `gm`), `is_active` — matches exactly.

### Human Verification Required

None. This is a backend-only, deterministic cron-path change fully covered by fast unit tests against a controlled fake DB (no external service calls — `_analyze_asset`/Claude is monkeypatched out in all tests, consistent with the project's note that `ANTHROPIC_API_KEY` isn't available locally). No frontend surface to visually inspect (Phase 26 handles deep-linking the resulting alerts).

### Gaps Summary

No gaps found. Implementation matches the plan's must_haves exactly at all three verification levels (exists, substantive, wired). All 6 observable truths hold, both required artifacts pass all checks, all 3 key links are wired correctly, and the full test suite has zero regressions attributable to this phase.

---

_Verified: 2026-08-12_
_Verifier: Claude (gsd-verifier)_
