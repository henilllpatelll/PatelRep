---
phase: 04-maintenance-and-housekeeping-programs
reviewed: 2026-07-23T00:00:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - apps/api/models/requests.py
  - apps/api/routers/assets.py
  - apps/api/routers/evidence.py
  - apps/api/routers/internal.py
  - apps/api/routers/programs.py
  - apps/api/services/programs/contracts.py
  - apps/api/services/programs/execution.py
  - apps/api/tests/test_operational_programs.py
  - apps/api/tests/test_programs_routes.py
  - apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx
  - apps/web/app/(dashboard)/programs/page.tsx
  - apps/web/components/engineering/PMCompletionModal.tsx
  - apps/web/components/engineering/WorkOrderCard.tsx
  - apps/web/components/programs/DeepCleanAreasPanel.tsx
  - apps/web/components/programs/HousekeepingDepthPanels.tsx
  - apps/web/components/programs/InspectionDepthPanel.tsx
  - apps/web/e2e/phase4-programs.spec.ts
  - apps/web/eslint.config.mjs
  - apps/web/i18n/locales/en.ts
  - apps/web/i18n/locales/es.ts
  - apps/web/lib/api/engineering.ts
  - apps/web/lib/api/programs.ts
  - apps/web/playwright.phase4.config.ts
  - apps/web/scripts/verify-i18n-gate.mjs
  - supabase/migrations/081_pm_evidence_linkage.sql
  - supabase/migrations/083_program_template_facilities.sql
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-07-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Summary

Reviewed the PM/housekeeping programs domain (routers, services, models, tests) and its
web surface (PM Schedules page, PM completion modal, housekeeping program depth panels,
bilingual EN/ES coverage, and the two new migrations). The core append-only/audit design
(evidence linkage, deferral separation-of-duty, containment audit events, tenant scoping)
is solid and well covered by tests — `test_programs_routes.py` in particular exercises
RBAC, cross-tenant isolation, and the `maybe_single()` None-safety pattern thoroughly.

Two known, pre-existing issues were explicitly excluded per the review brief and are
**not** re-reported here: bug-478 (`assets.py` `create_pm_schedule` UUID serialization)
and bug-479/484 (`programs.py` `create_deep_clean_schedule` date serialization).
`apps/api/routers/internal.py` has zero diff versus the base commit — it was read for
cross-file context but contains no phase-4 changes to review.

Two BLOCKER-level findings stand out: the HK-03 "quality trends by employee" feature
ships raw UUIDs instead of resolved staff names (making that dimension unusable exactly
where the codebase already has an established resolve-to-name pattern to follow), and the
PM-completion `verifier_id` separation-of-duty check that the UI enforces has no
server-side equivalent, unlike the parallel — and correctly implemented — `approved_by`
check on PM deferrals (D-07).

## Critical Issues

### CR-01: PM completion `verifier_id` self-verification is not blocked server-side

**File:** `apps/api/services/programs/execution.py:93-127` (also `apps/api/models/requests.py:657-658`, `apps/api/routers/assets.py:227-256`)
**Issue:** `PMCompletionModal.tsx` enforces "the verifier must be distinct from the
technician submitting this completion" purely client-side:
```tsx
if (verifierId && verifierId === user?.id) {
  setError(t('programs.pmCompletion.errorVerifierDistinct'))
  return
}
```
Neither `CompletePMProgramRequest` (`models/requests.py`) nor `persist_pm_completion`
(`services/programs/execution.py`) nor the `complete_pm_schedule` route
(`routers/assets.py`) re-validates this server-side. A direct API call (or a modified
client) can submit `verifier_id == technician_id`, producing a PM completion record that
*looks* independently verified but was self-attested. This directly undermines the
two-person control the feature exists to provide, and is inconsistent with this same
phase's own PM-deferral flow, which enforces the equivalent "approver distinct from
requester" rule server-side (`routers/programs.py:250-256`, D-07) plus checks the
approver is an active tenant user (`_require_active_tenant_approver`). `verifier_id` also
has no "is an active user at this tenant" check at all — an arbitrary string, including a
non-existent user ID, is accepted and stored as the attesting verifier.
**Fix:** Add the same two checks `defer_pm_schedule` already does, either in
`persist_pm_completion` (so both `assets.py` and any future caller get it) or in the
`complete_pm_schedule` route before calling it:
```python
if payload.get("verifier_id") and payload["verifier_id"] == user_id:
    raise ValueError("Verifier must be distinct from the technician submitting this completion")
if payload.get("verifier_id"):
    _require_active_tenant_user(db=db, tenant_id=tenant_id, user_id=payload["verifier_id"])
```

### CR-02: Inspection quality "by employee" trend renders raw UUIDs, not names

**File:** `apps/api/services/programs/contracts.py:271-330` (`aggregate_inspection_quality`), `apps/api/routers/programs.py:398-407` (`get_inspection_quality`), `apps/web/components/programs/InspectionDepthPanel.tsx:166-170`
**Issue:** HK-03 explicitly requires quality trends "broken down by ... employee." The
aggregation keys `by_employee` on the raw `inspected_by` UUID:
```python
employee = inspection.get("inspected_by") or "unknown"
_bump(by_employee, employee, is_pass)
```
`get_inspection_quality`'s select statement never joins `user_profiles`, and the frontend
renders the key verbatim:
```tsx
<li key={entry.key} ...>
  <span>{entry.key}</span>
```
So a GM/supervisor viewing "Inspection quality trends → by employee" sees a list of
opaque UUIDs with no way to identify which housekeeper each row refers to — the feature
is non-functional for its stated purpose. This is not a hypothetical: the codebase
already has the exact resolve-pattern needed, used for the near-identical inspection
list a few hundred lines away in `routers/housekeeping.py`:
```python
# housekeeping.py ~1565-1588
inspector_ids = list({r["inspected_by"] for r in rows if r.get("inspected_by")})
profiles = supabase.table("user_profiles").select("id, preferred_name, full_name") \
    .in_("id", inspector_ids).eq("tenant_id", current_user.hotel_id).execute()
name_map = {p["id"]: p.get("preferred_name") or p.get("full_name") or p["id"] for p in (profiles.data or [])}
```
**Fix:** In `get_inspection_quality`, resolve `inspected_by` UUIDs to
`preferred_name`/`full_name` (same pattern as `housekeeping.py`) before calling
`aggregate_inspection_quality`, or pass a `{user_id: name}` map into
`aggregate_inspection_quality` and use it when bumping `by_employee`. The `by_item`
fallback (`item_result.get("template_item_id") or "unknown"` when no joined description
exists) has the same class of readability gap and should be checked too.

## Warnings

### WR-01: `pm_checklist_templates` create/edit is unaudited despite this phase's audit-trail pattern

**File:** `apps/api/routers/programs.py:183-241` (`update_program_template`, `create_program_template`)
**Issue:** This phase introduces `_record_audit_event` and uses it consistently for
`pm_deferrals` (`defer_pm_schedule`) and mirrors `routers/evidence.py`'s audit pattern in
its own docstring ("no parallel audit mechanism"). But `update_program_template` and
`create_program_template` — both of which can silently rewrite the checklist content of
life-safety PM programs like `fire_extinguisher` or `fire_alarm_sprinkler` — never call
`_record_audit_event`. Given the compliance emphasis of this phase (G2, G8, D-06, D-07),
losing the "who changed this safety checklist and when" trail is a real gap.
**Fix:** Add `_record_audit_event(... resource_type="pm_checklist_template", action="pm_checklist_template.updated"/"pm_checklist_template.created" ...)` calls in both routes, following the existing pattern used for `pm_deferral.approved`.

### WR-02: PM completion modal's template query uses a different cache key than the rest of the programs surface, breaking invalidation

**File:** `apps/web/components/engineering/PMCompletionModal.tsx:122-127`
**Issue:** Every other component that reads program templates shares one query key so
edits invalidate everywhere:
```ts
// DeepCleanAreasPanel.tsx / HousekeepingDepthPanels.tsx / InspectionDepthPanel.tsx / programs/page.tsx
const OVERVIEW_KEY = ['operational-programs']
```
`PMCompletionModal.tsx` instead uses its own key:
```ts
const { data: overviewData } = useQuery({
  queryKey: ['program-overview-for-pm-completion'],
  queryFn: () => programsApi.overview(),
  ...
})
```
Because `queryClient.invalidateQueries({ queryKey: ['operational-programs'] })` (called
after `initialize`, template edit, etc. on `/programs`) never touches
`'program-overview-for-pm-completion'`, a manager who edits or (re)initializes a PM
checklist template on `/programs` and then immediately opens the PM completion modal on
`/engineering/pm-schedules` can see stale checklist items for up to the 60s `staleTime`
(or until the next full navigation). It also issues a redundant network request instead
of reusing React Query's cache/dedup, since the two keys never share a cache entry.
**Fix:** Use the shared `['operational-programs']` key in `PMCompletionModal.tsx` (or
export `OVERVIEW_KEY` from a shared module and import it everywhere, since it is
currently duplicated as a local `const` in three separate files as well).

### WR-03: `room_type_id` access on `RoomStatus.rooms` forced into `any[]` casts in two new files

**File:** `apps/web/components/programs/InspectionDepthPanel.tsx:41-47`, `apps/web/components/programs/DeepCleanAreasPanel.tsx:47-49`
**Issue:** Both new panels read `row.rooms?.room_type_id`, but `RoomStatus.rooms` in
`apps/web/lib/api/rooms.ts` does not declare a `room_type_id` field (only a nested
`room_types: { name, code, base_clean_minutes }`), even though the API does return it per
CLAUDE.md's documented join (`rooms!inner(id, room_number, floor, room_type_id, room_types(...))`).
Both new files work around the type gap with `as any[]`:
```ts
const roomOptions: RoomOption[] = ((roomsQuery.data?.data ?? []) as any[])
  .map((row) => ({ id: row.rooms?.id as string, room_number: row.rooms?.room_number as string }))
```
```ts
((roomsQuery.data?.data ?? []) as any[])
  .filter((row) => row.rooms?.room_type_id)
  .map((row) => [row.rooms.room_type_id as string, ...])
```
This silently disables type-checking for the entire `roomsQuery.data` shape in both
files, not just the one missing field, so any future unrelated typo on this data would go
undetected by the compiler.
**Fix:** Add `room_type_id: string` to `RoomStatus['rooms']` in `apps/web/lib/api/rooms.ts`
and drop the `any[]` casts in favor of the real type.

## Info

### IN-01: `create_program_template` code-uniqueness check has a benign TOCTOU race

**File:** `apps/api/routers/programs.py:216-241`
**Issue:** `create_program_template` does a `select` + `maybe_single()` existence check
before `insert`, with no transaction/upsert. Two concurrent requests with the same `code`
could both pass the check and both insert, unless a DB-level `UNIQUE(tenant_id, code, ...)`
constraint exists to catch it (in which case the second request would 500 instead of the
intended 409). This is a pre-existing pattern used throughout the codebase (e.g.
`assign_controlled_document`'s dedupe check in `evidence.py`), so it's flagged as
informational rather than a blocker.
**Fix:** Not required for this phase; worth a follow-up pass across all "check-then-insert"
uniqueness guards if 409-vs-500 correctness under concurrency becomes a priority.

---

_Reviewed: 2026-07-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
