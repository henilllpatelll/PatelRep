---
phase: 15-work-order-bulk-archive
verified: 2026-08-03T00:00:00Z
status: passed
score: 13/13 must-haves verified
human_verification:
  - test: "Log in as housekeeper or front_desk and confirm the 'Archive...' button is absent from the Engineering Work Orders page toolbar."
    expected: "Button is not rendered (canManage gate hides it)."
    why_human: "Not independently re-verified in-browser this session (team confirmed the GM/engineer round trip live, but did not separately log in as a non-manager role to visually confirm the button's absence). Code review shows a simple `{canManage && (...)}` conditional identical to the already-proven 'New Work Order' button gate, and all three backend endpoints have passing 403 RBAC tests for housekeeper/housekeeping_supervisor/front_desk — risk of failure is low, but flagged per team-lead's request."
---

# Phase 15: Work-Order Bulk-Archive Verification Report

**Phase Goal:** Managers can select and bulk-archive completed/cancelled work orders to declutter the active Engineering board, with full reversibility (unarchive) and a complete audit trail — no data is ever deleted.
**Verified:** 2026-08-03
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

**15-01 (Backend)**

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Manager can bulk-archive multiple completed/cancelled work orders in one API call, response confirms count | ✓ VERIFIED | `POST /work-orders/bulk-archive` (work_orders.py:518-528), `_bulk_archive` helper returns `archived_count`; `test_bulk_archive_sets_archived_at_and_writes_one_audit_row_per_work_order` passes |
| 2 | Archived work orders excluded from default list response in both engineer and standard branches | ✓ VERIFIED | `.is_("archived_at", "null")` applied in both branches (lines 207-209, 245-247); `test_list_work_orders_excludes_archived_by_default` parametrized over both roles, passes |
| 3 | Manager can bulk-archive all completed work orders older than N days in one call | ✓ VERIFIED | `POST /work-orders/bulk-archive-by-age` (line 530), filters `status=="completed"` + `completed_at < cutoff`; `test_bulk_archive_by_age_only_archives_completed_older_than_cutoff` passes |
| 4 | Manager can restore (unarchive) archived work orders, they reappear in default list | ✓ VERIFIED | `POST /work-orders/bulk-unarchive` (line 604) clears `archived_at`/`archived_by`; `test_bulk_unarchive_clears_archived_at_and_writes_audit_row` and full round-trip test pass |
| 5 | Every archive/unarchive action writes one `operational_audit_events` row per work order with actor_id, actor_role, action, resource_id | ✓ VERIFIED | Insert blocks at lines 583-600 and 627-644 write `work_order.archived`/`work_order.unarchived`; asserted in tests |
| 6 | Non-archivable-status or cross-tenant archiving is rejected without mutation | ✓ VERIFIED | 409 for non-archivable status, 404 for cross-tenant, both validate-before-mutate; `test_bulk_archive_rejects_non_archivable_status` and `test_bulk_archive_rejects_cross_tenant_ids` pass |
| 7 | Non-management role blocked from all three endpoints with 403 | ✓ VERIFIED | All three endpoints use `Depends(require_role("engineer", "gm"))`; `test_non_management_roles_are_blocked_from_archive_endpoints` parametrized over housekeeper/housekeeping_supervisor/front_desk, passes |

**15-02 (Frontend)**

| # | Truth | Status | Evidence |
|---|---|---|---|
| 8 | Manager sees an 'Archived' tab on the Work Orders page listing archived work orders | ✓ VERIFIED | `tabs` array includes `tabArchived` entry (page.tsx:366); `ArchivedWorkOrdersPanel` renders on `activeTab === 'archived'` (line 456); live browser walkthrough confirmed tab renders and lists archived rows |
| 9 | Manager can open a bulk-archive picker, checkbox-select multiple completed/cancelled work orders, archive in one action | ✓ VERIFIED | `BulkArchiveModal.tsx` (196 lines) implements checkbox multi-select + `bulkArchiveWorkOrders` mutation; live browser walkthrough confirmed modal opens, lists candidates, archives successfully |
| 10 | Manager can trigger 'archive all completed older than N days' from the same picker | ✓ VERIFIED | Age-cutoff `<Input>` + `bulkArchiveWorkOrdersByAge` call present in `BulkArchiveModal.tsx`, backed by verified 15-01 endpoint |
| 11 | Manager can restore an archived work order from the Archived tab | ✓ VERIFIED | `ArchivedWorkOrdersPanel.tsx` (103 lines) has per-row Restore button calling `bulkUnarchiveWorkOrders`; live browser walkthrough confirmed restore returns work order to active board |
| 12 | Archived work order disappears from active Kanban without manual reload, via existing Realtime subscription | ✓ VERIFIED | `onArchived`/Restore mutations invalidate `['work-orders']` query key (prefix-matches all work-order queries); live browser walkthrough explicitly confirmed removal "immediately via Realtime invalidation (no reload)" |
| 13 | Non-manager roles do not see the archive entrypoint | ✓ VERIFIED (code + tests) — see Human Verification | `{canManage && (<Button ... archiveAction />)}` (page.tsx:379-384), same gate pattern as the pre-existing "New Work Order" button; backed by 15-01's 403 RBAC test coverage on all three endpoints. Not independently re-confirmed live in-browser as a non-manager role this session. |

**Score:** 13/13 truths verified (12 fully verified incl. live evidence, 1 verified via code+test with a recommended follow-up browser spot-check)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `supabase/migrations/089_work_order_archive.sql` | `archived_at`/`archived_by` columns + partial index | ✓ VERIFIED | 11 lines, contains both columns + `idx_work_orders_archived_at`; applied to remote dev project this session (confirmed by team-lead + corroborated by live round-trip working against real DB) |
| `apps/api/models/requests.py` | 3 new request models | ✓ VERIFIED | `BulkArchiveWorkOrdersRequest`, `BulkArchiveByAgeRequest`, `BulkUnarchiveWorkOrdersRequest` present at lines 786/790/794 |
| `apps/api/routers/work_orders.py` | 3 new endpoints + archived filter | ✓ VERIFIED | `/bulk-archive`, `/bulk-archive-by-age`, `/bulk-unarchive` registered; `archived: bool = Query(False)` param present (line 190) |
| `apps/api/tests/test_work_order_archive.py` | Tests for archive/unarchive/RBAC/tenant/audit | ✓ VERIFIED | 478 lines, 12 tests, all passing (`pytest tests/test_work_order_archive.py -q` → 12 passed) |
| `apps/web/lib/api/engineering.ts` | 3 client methods + archived param | ✓ VERIFIED | Verified via type-check pass; methods referenced correctly from both new components |
| `apps/web/components/engineering/BulkArchiveModal.tsx` | Checkbox+age picker UI | ✓ VERIFIED | 196 lines (≥40 min), wired into page.tsx |
| `apps/web/components/engineering/ArchivedWorkOrdersPanel.tsx` | Archived list + Restore | ✓ VERIFIED | 103 lines (≥30 min), wired into page.tsx |
| `apps/web/app/(dashboard)/engineering/work-orders/page.tsx` | 3rd tab + Archive action | ✓ VERIFIED | Contains `'archived'` tab state, tab entry, action button, modal render |
| `apps/web/i18n/locales/en.ts` / `es.ts` | New locale keys at parity | ✓ VERIFIED | All 18 checked keys present in both files (`tabArchived` confirmed at line 1221 in each) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `bulk_archive_work_orders` / `_bulk_archive` | `operational_audit_events` | `.insert([...])` with `action='work_order.archived'` | ✓ WIRED | Confirmed at work_orders.py:583-600; test asserts exactly one row per archived work order |
| `bulk_unarchive_work_orders` | `operational_audit_events` | `.insert([...])` with `action='work_order.unarchived'` | ✓ WIRED | Confirmed at work_orders.py:627-644 |
| `list_work_orders` | `work_orders.archived_at` | `.is_("archived_at","null")` in both branches | ✓ WIRED | Confirmed in both engineer (`_base()`) and standard branches |
| `page.tsx` | `BulkArchiveModal.tsx` | `showArchiveModal` state, rendered `canManage`-gated | ✓ WIRED | Confirmed at page.tsx:379-384, 470-474; live walkthrough confirmed functional |
| `page.tsx` | `ArchivedWorkOrdersPanel.tsx` | rendered when `activeTab === 'archived'` | ✓ WIRED | Confirmed at page.tsx:456 |
| `page.tsx` Realtime subscription | `['work-orders','archived']` query key | prefix-match `invalidateQueries({queryKey:['work-orders']})` | ✓ WIRED | Confirmed by code + live walkthrough (instant board update, no reload) |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|---|---|---|
| ARCHIVE-01 (bulk-archive selected) | ✓ SATISFIED | none |
| ARCHIVE-02 (archived excluded from active/Realtime view) | ✓ SATISFIED | none |
| ARCHIVE-03 (audit trail per action) | ✓ SATISFIED | none |
| ARCHIVE-04 (view archived + restore) | ✓ SATISFIED | none |
| ARCHIVE-05 (restore reverses ARCHIVE-02) | ✓ SATISFIED | none (round-trip test + live walkthrough) |
| ARCHIVE-06 (bulk-archive by age) | ✓ SATISFIED | none |

### Anti-Patterns Found

None. Scanned `BulkArchiveModal.tsx` and `ArchivedWorkOrdersPanel.tsx` for TODO/FIXME/placeholder/stub patterns — no matches.

### Human Verification Required

### 1. Non-manager role sees no "Archive..." button

**Test:** Log in as housekeeper or front_desk, navigate to Engineering → Work Orders, confirm no "Archive..." button appears in the toolbar.
**Expected:** Button absent (same as existing "New Work Order" gate, which uses the identical `canManage` conditional).
**Why human:** Not independently re-verified live in-browser this session — this session's live walkthrough covered the GM/engineer path only. Backend RBAC (403 for all three endpoints, all three non-manager roles) is fully test-covered, and the frontend gate is a simple boolean conditional identical to an already-proven pattern, so risk is low but not zero.

### Gaps Summary

No gaps. All 13 must-have truths across both plans are supported by passing automated tests (12/12 archive-specific + 258/258 smoke, zero regressions), clean type-check, clean lint, correct wiring at every key link, and a live browser walkthrough (GM role) confirming the full archive → Realtime-remove → Archived-tab-list → restore → Realtime-reappear round trip against the real dev Supabase project. The single open item — visual confirmation that non-manager roles don't see the "Archive..." button — is a low-risk, code-and-test-backed item recommended for a quick follow-up spot-check rather than a blocking gap.

---

_Verified: 2026-08-03_
_Verifier: Claude (gsd-verifier)_
