# Phase 17: Backlog Cleanup - Research

**Researched:** 2026-08-04
**Domain:** 8 independent bug-fix / small-UX items across the existing FastAPI (`apps/api`) + Next.js 14 (`apps/web`) codebase. No new libraries, frameworks, or external services involved.
**Confidence:** HIGH (all findings are direct codebase reads with exact file/line citations, not inference from documentation)

## User Constraints

No `CONTEXT.md` exists for this phase (user chose to proceed without one). There are no locked decisions, discretion areas, or deferred ideas beyond what's in the phase description/REQUIREMENTS.md. The only pre-resolved product decision is STAFF-01 itself: "supervisors (`housekeeping_supervisor`) should appear as assignable staff in the housekeeper room-assignment picker" — resolved 2026-08-03, per `.planning/REQUIREMENTS.md` and `.planning/STATE.md` line 263 (previously logged as `needs_product_decision`, now closed in favor of inclusion). Treat this as locked; do not re-litigate whether supervisors should appear.

## Summary

This is not a new-feature phase — it is 8 small, independent, pre-existing bugs/UX gaps carried forward from the v1.2 milestone audit (see `.planning/STATE.md` lines 259-268, `.planning/REQUIREMENTS.md`). Each item lives in a distinct file/domain with no shared code paths between items, confirming the ROADMAP's "no shared code paths" premise. Research below pins down the **exact root cause and minimal fix** for each of the 8 requirement IDs via direct code reads (Grep/Read), not speculation.

**Primary recommendation:** Treat this as 8 small, mostly single-file patches. Two items (UX-01 name-fallback, UX-02 shift dropdowns) touch multiple call sites of the same underlying pattern and should be fixed consistently across all sites in one pass rather than patched piecemeal. One item (STAFF-01) is *partially already fixed* in the main assignment picker — only one secondary picker (inspections re-assign) still excludes supervisors. One item (UX-06 Room History) has a well-evidenced *hypothesis* rather than a confirmed root cause and should be verified against live data before committing to a fix.

No Context7/WebSearch was needed or used — this phase requires zero external library research. All findings are HIGH confidence (direct code reads), except UX-06 which is MEDIUM/flagged as needing live-data verification.

## Per-Item Findings

### UX-01 — Staff display names never render blank

**Root cause (HIGH confidence):** `apps/api/routers/staff.py` line 136, inside `list_staff()` (the `GET /staff` handler used by the Staff page, the Scheduling page, the housekeeping Assignment picker/`HousekeeperBar`, and the Inspections re-assign picker):

```python
"full_name": profile.get("full_name", ""),
```

This is the classic Python `dict.get(key, default)` gotcha: the default `""` is only used when the key is **missing**, not when the key exists with value `None`. If a `user_profiles` row exists but its `full_name` column is `NULL` (e.g. a staff member added via direct-add flow before setting a name, or a partially-completed profile), this returns `None`, and the API serializes `"full_name": null` in the JSON response.

Every *other* full-name lookup in the codebase already uses the safe pattern (`profile.get("full_name") or ""` / `p.get("preferred_name") or p.get("full_name") or uid`) — confirmed via grep across `housekeeping.py:750,1079-1080,1285,1592`, `reports.py:139,166`, `programs.py:424`. `staff.py:136` is the single outlier.

**Downstream crash risk:** `apps/web/lib/utils/avatar.ts`'s `getInitials(name: string)` (lines 1-8) calls `name.split(' ')` with no null guard. Three *more* independent, duplicate local copies of the same unguarded `getInitials` exist:
- `apps/web/app/(dashboard)/staff/page.tsx` lines 92-98
- `apps/web/app/(dashboard)/scheduling/page.tsx` lines 103-110
- `apps/web/app/(dashboard)/housekeeping/page.tsx` lines 156-158 (inside `HousekeeperBar`)

If `full_name` is `null`, any of these throws `TypeError: Cannot read properties of null (reading 'split')` — a full crash, not just a blank render. Additional unguarded direct renders/calls that would break on `null`:
- `staff/page.tsx:543` `{staff.full_name}` (renders blank — React renders `null` as nothing)
- `staff/page.tsx:595` `staff.full_name.split(' ')[0]` (crash)
- `staff/page.tsx:754` `member.full_name.toLowerCase().includes(q)` (crash, in the search filter)
- `staff/page.tsx:929,931` (Avatar + name render in a list)
- `housekeeping/page.tsx:223` `hk.name.split(' ')[0]` (crash)
- `scheduling/page.tsx:1056` `member.full_name.split(' ')[0]` (crash)

**Recommended fix:**
1. Backend: `staff.py:136` → `profile.get("full_name") or ""` (matches the established codebase pattern). This alone eliminates the `null` payload and thus the crash risk everywhere.
2. Frontend: per UX-01's explicit requirement ("fallback shown when name data is missing"), an empty string alone isn't sufficient — it still renders as visually blank. Add a shared fallback (e.g. a `getDisplayName(name?: string | null): string` helper returning something like `"Unnamed Staff"` when falsy) and apply it at each render site above, ideally consolidating the 4 duplicate `getInitials` implementations to import the one shared `lib/utils/avatar.ts` version (also null-guarded) rather than patching 4 places independently.

### UX-02 — Shift-template dropdowns show no duplicate or leftover entries

**Root cause (HIGH confidence, mechanism confirmed; live-data trigger not directly observed):** `supabase/migrations/005_scheduling.sql` lines 11-20 define `shifts` with **no uniqueness constraint** on `(tenant_id, department_id, name)` — only a bare `PRIMARY KEY (id)`. `apps/api/routers/scheduling.py`'s `create_shift()` (lines 71-86) does a plain `.insert()` with zero pre-check for an existing shift of the same name/department. Nothing server-side prevents creating "Morning" twice for the same department, and nothing client-side prevents a double-submit producing two identical rows (the Create button is only guarded by `disabled={isPending}` in `CreateShiftModal`, `apps/web/app/(dashboard)/scheduling/page.tsx` lines 642-657 — a network retry or a second browser tab is not covered).

Once two shift rows share a name, both surface identically in every consuming dropdown — `AssignShiftModal`'s Shift `<select>` (`scheduling/page.tsx` lines 358-366, filtered only by `is_active`) and the "Manage Shifts" list (lines 715-753) — appearing to the user as duplicate/indistinguishable entries.

`delete_shift()` (`scheduling.py` lines 112-125) is a hard `DELETE`; `shift_assignments.shift_id` has `ON DELETE CASCADE` (migration 005 line 35), so a deleted shift does not leave orphaned "leftover" assignment rows — that half of the symptom is **not currently reproducible** from a delete path. "Leftover entries" more likely means the duplicate-creation scenario described above (an accidental double-create looks like a stale leftover row the user can't tell apart from the "real" one), or a stale react-query cache after an out-of-band edit — `CreateShiftModal`'s `deleteMutation`/`updateMutation`/`createMutation` all correctly `invalidateQueries(['schedules-shifts'])` on success, so ordinary CRUD does keep the cache fresh.

**Recommended fix:**
1. Backend: add a pre-insert existence check in `create_shift()` — reject (409 or 422) a new shift whose `(tenant_id, department_id, name)` already matches an *active* existing shift, OR add a partial unique index (`UNIQUE (tenant_id, department_id, name) WHERE is_active`) via a new migration for a DB-level guarantee.
2. Frontend: `AssignShiftModal`'s Shift dropdown and `ShiftManagement`'s list should render nothing surprising once (1) is in place; no additional frontend change is strictly required for the duplicate half. If a live duplicate row is found in the current dev/demo DB during verification, a one-time data cleanup (delete/deactivate the extra row) will be needed in addition to the code fix.

### UX-03 — Opera integration connection failures show a specific, actionable error

**Root cause (HIGH confidence):** The *backend* (`apps/api/routers/integrations.py` lines 38-49) already returns fairly specific messages for the connect flow: a 400 with `"Opera connection failed ({status_code}). Check your credentials and base URL."` for HTTP errors, a 503 `"Could not reach the OHIP endpoint. Verify the base URL."` for other exceptions, and a 400 `"Opera returned no access token. Check your credentials."` for a malformed token response. The frontend's `connectMutation`/`syncMutation`/`testMutation`/`disconnectMutation` (`apps/web/app/(dashboard)/settings/integrations/page.tsx` lines 158-197) already correctly surface `err.message` (the real backend detail, sanitized by `apps/web/lib/api/client.ts`'s `toFriendlyError`) with only a generic string as a *fallback-if-missing*.

The actual generic-message bug is the **status-fetch** path: `IntegrationsPage`'s `statusQuery` (`integrations.ts`'s `getOperaStatus()` → `GET /integrations/opera/status`, gated by `_require_opera_pilot` which can 403 with `"Opera pilot not enabled for this hotel"`) renders a **hardcoded literal** on any failure, ignoring the real error entirely:

```tsx
// integrations/page.tsx lines 464-473
{statusQuery.isError && (
  <div className="flex items-center gap-2 text-sm text-[var(--alert)]">
    <AlertTriangle size={14} className="shrink-0" />
    Failed to load Opera status.{' '}
    <button onClick={() => statusQuery.refetch()} className="underline hover:no-underline">
      Retry
    </button>
  </div>
)}
```

This is the one surface in the file that does *not* follow the `err.message || fallback` pattern used everywhere else in the same file, and it's exactly the kind of generic message UX-03 describes (a GM with the pilot flag off, an expired token, or a real connectivity problem all see the identical "Failed to load Opera status.").

**Recommended fix:** Change the block above to surface `(statusQuery.error as any)?.message || 'Failed to load Opera status.'`, matching the pattern already established by the 4 mutations in the same file (lines 159, 170, 180, 195). No backend change needed — `opera_status()` (`integrations.py` lines 75-99) and `_require_opera_pilot` (lines 17-22) already produce specific-enough detail strings once the client stops discarding them.

### UX-04 — Management ROI page no longer leaks the internal calculation formula string

**Root cause (HIGH confidence — exact string located):** `apps/api/services/guest_recovery/contracts.py`, `calculate_housekeeping_efficiency()`, line 322:

```python
"definition": "minutes_per_occupied_room = total clean minutes / distinct (room, day) clean sessions",
```

The docstring at lines 274-275 explains this was *intentional* ("this is the definition surfaced to the GM and must be stated in the payload"), but the string itself is a literal pseudo-code assignment expression using internal variable names (`minutes_per_occupied_room`), not a human-readable explanation. The frontend renders it verbatim as a stat tooltip:

```tsx
// apps/web/app/(dashboard)/management-roi/page.tsx line 291
<Stat
  label="Minutes / Occupied Room"
  value={housekeeping?.minutes_per_occupied_room ?? '—'}
  unit="min"
  hint={housekeeping?.definition}   // ← raw formula string rendered as-is
  ...
/>
```

This is the only `hint={...?.definition}` usage on the page (confirmed via full-file read of `management-roi/page.tsx`) and the only `"definition"` key returned anywhere in `contracts.py`/`management_roi.py` — the leak is isolated to this single metric.

**Recommended fix:** Rewrite the string in `contracts.py:322` to plain GM-facing language (e.g. `"Average minutes spent cleaning each occupied room, based on completed clean sessions"`), keeping the *intent* (GM-facing transparency about what the number means) but dropping the code-like notation. No frontend change needed — `hint={housekeeping?.definition}` can stay as-is once the payload string itself is fixed. (Verify no other `services/guest_recovery/contracts.py` function returns a similar `"definition"`/formula-shaped field that other stat cards might also render — grep during implementation found none currently wired into the frontend, but the pattern is worth a second look since `calculate_downtime_revenue_impact`/others weren't fully read line-by-line.)

### UX-05 — Guest Request drawer includes status-advance actions, not just view

**Root cause (HIGH confidence):** `apps/web/components/guest-requests/GuestRequestDrawer.tsx` (full file read, 393 lines) has: a message thread + reply composer, a satisfaction-score widget (only after `isResolved`), and an internal-note form — but **no status-transition controls at all**. The status state machine (`open → acknowledged → dispatched → arrived → guest_contacted → resolved → verified`) is fully implemented, but only on the **kanban card** component embedded in `apps/web/components/guest-requests/GuestRequestsPage.tsx`:
- Status-specific "Advance" buttons: lines 109-145 (e.g. `onClick={() => onAdvance(request.id, 'acknowledged')}`)
- `handleAdvance` callback: lines 187-190
- `updateMutation`, which calls the real transition endpoint: lines 172-179 → `guestRequestsApi.transitionRequest(id, { status })` → `POST /guest-requests/{id}/transition` (backend: `apps/api/routers/guest_requests.py` lines 175-192, validated by `validate_guest_request_transition()`)

The drawer (opened via `onCardClick` → `setDrawerRequest(r)`, `GuestRequestsPage.tsx` line 254-256) is a completely separate component tree from the card and does not receive or use `onAdvance`/`updateMutation` at all — a user who opens the drawer to see full detail (messages, notes, accessibility guidance) has no way to advance the request's status without closing the drawer and clicking the small button on the kanban card behind it.

**Recommended fix:** Add the same status-advance action(s) to `GuestRequestDrawer.tsx`, reusing the exact same `guestRequestsApi.transitionRequest(request.id, { status })` call and the same status→next-status mapping already encoded in `GuestRequestsPage.tsx` lines 109-145 (either by lifting `handleAdvance`/`updateMutation` up and passing an `onAdvance` prop into the drawer, mirroring how the card receives it, or by adding an equivalent local mutation inside the drawer). Must invalidate the same query keys (`['guest-requests-kanban']`, `['guest-requests-history']`) the card's `updateMutation.onSuccess` already invalidates (`GuestRequestsPage.tsx` lines 175-178) so the kanban board and the drawer stay in sync after an advance from inside the drawer.

### UX-06 — Room History populates with actual room history data

**Root cause: MEDIUM confidence — plausible hypothesis, needs live-data verification before committing to a fix.** The drawer-side implementation is *not* missing: `RoomDetailDrawer.tsx` (`apps/web/components/housekeeping/RoomDetailDrawer.tsx`) already fetches and merges 5 sources into a unified timeline — `housekeepingApi.getRoomHistory()` (notes/status changes), work orders, guest requests, tasks, and clean sessions (lines 393-412, 1022-1177) — with a correct empty-state fallback (line 1111-1113) only shown when *all 5* are empty. So "doesn't populate" cannot be a missing-wiring bug; it must be a backend data/filtering issue suppressing real rows.

Two concrete candidates found in `GET /rooms/{room_id}/history` (`apps/api/routers/rooms.py` lines 1004-1030):

1. **`stay_reset_at` boundary over-triggers.** The endpoint filters `room_status_history` to `created_at >= stay_reset_at` when `room_status.stay_reset_at` is set (migration `059_stay_reset_at.sql`: intended to hide *prior-guest-stay* notes after a fresh DEP-inspection pass). It is set correctly on a genuine passed-DEP-inspection event (`housekeeping.py:1445-1449`, `rooms.py:212-216`) — but it is *also* set by the bulk Opera-occupancy-import path (`housekeeping.py:1986-1987`) whenever the **imported/resolved status happens to be `INSPECTED`**, which is a much broader condition than "housekeeping just completed a fresh clean+inspection right now." If occupancy import runs routinely (daily Opera sync, or a manager re-importing test data via `OccupancyImportModal`) and repeatedly stamps `stay_reset_at = now()` for already-INSPECTED rooms, the visibility boundary keeps rolling forward, hiding real status-history/note entries that occurred before the last import — even though nothing about the room's actual clean history changed.
2. **Missing `user_profiles` embed.** The query is a bare `.select("*")` with no join, so `entry.actor_name` / `entry.user_profiles.preferred_name` (referenced by `RoomDetailDrawer.tsx` lines 126, 1071) is never present in the response — note/status-change entries would show with no attributed actor, even when they do appear.

Candidate (1) only affects the `room_status_history`-sourced "note"/status-change events merged into the drawer, not the WO/guest-request/task/clean-session events (those are separate, un-gated queries) — so a room with real WOs/tasks but a rolled-forward `stay_reset_at` would show *some* history, not none. A room with only note/status-change activity and no WOs/GRs/tasks/sessions in the same window would show the full empty state.

**Recommendation for the planner:** Before committing to a fix, reproduce live: open a room's drawer with recent activity, check whether the "Room History" section (supervisors/GM/front_desk only — housekeepers never see this section, per `!isHousekeeper` gate at `RoomDetailDrawer.tsx` line 977) is actually empty despite recent notes/status changes, and correlate with whether an occupancy import ran recently for that room/hotel. If confirmed, the fix is either (a) restrict the bulk-import `stay_reset_at` stamp to only fire when the room is transitioning *into* INSPECTED from a real workflow state rather than any resolved-status-happens-to-be-INSPECTED import row, or (b) drop the `stay_reset_at` gating from `get_room_history` (or loosen it) if prior-stay isolation isn't actually the desired behavior for the *drawer's* display (it may be correct for other consumers of the same history and only wrong for this specific call site). Also add the `user_profiles` embed (`select("*, user_profiles!changed_by(preferred_name, full_name)")` or a two-step fetch matching the `staff.py`/`housekeeping.py` established pattern) so actor attribution appears once rows do populate.

### DATA-01 — `ai_interactions.interaction_type` CHECK constraint rejects `general` and other real values

**Root cause (HIGH confidence — exact allowed-vs-used sets enumerated):** The live constraint (`supabase/migrations/088_ai_interactions_work_order_triage_type.sql`, the latest of two migrations touching this constraint) allows exactly 9 values:
```
task_creation, room_prediction, sop_query, failure_prediction, shift_summary,
gm_insight, assignment_suggestion, onboarding_assistant, work_order_triage
```
Migration 088's own header comment documents that this list drifted untracked from migration 013's original 8 and already knew of the gap (deferred 3x per `.wolf`/STATE.md history — this is the 4th deferral referenced in the requirement).

Grepping every actual `log_ai_interaction(interaction_type=...)` call site in `apps/api` finds these values are really used in code:
- `ai_copilot.py:253-261` (`intent_to_log` dict, used at lines 473, 482, 492): `task_creation`, `work_order_creation`, `guest_request_creation`, `task_assignment`, `sop_query`, `gm_insight`, `work_order_triage`, and a **default of `"general"`** for any unmapped intent.
- `ai_copilot.py:534,545`: `housekeeping_briefing`
- `ai_copilot.py:808,819`: `gm_insight`
- `sop.py:233,247`: `sop_query`
- `onboarding.py:291`: `onboarding_assistant`
- `services/ai/shift_summary.py:124`: `shift_summary`

Values **used in code but NOT in the current constraint** (these 400/500 today): `work_order_creation`, `guest_request_creation`, `task_assignment`, `general`, `housekeeping_briefing` — 5 values, matching exactly what migration 088's own comment flagged as out-of-scope-but-real ("every other interaction_type value now used in code... 500s on the unconditional log_ai_interaction call"). Values **allowed but not currently used anywhere** in `apps/api` for an actual `log_ai_interaction` call: `room_prediction`, `failure_prediction`, `assignment_suggestion` (these tables/flows write directly to their own `failure_predictions`/`room_predictions`-style tables, not through `log_ai_interaction`) — safe to leave allowed for forward-compat, no need to remove.

**Recommended fix:** New migration (next sequential number after 090, i.e. `091_*.sql`) that drops and recreates `ai_interactions_interaction_type_check` to add the 5 missing values, keeping all 9 existing ones:
```sql
ALTER TABLE ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_interaction_type_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_interaction_type_check CHECK (
  interaction_type IN (
    'task_creation', 'room_prediction', 'sop_query', 'failure_prediction',
    'shift_summary', 'gm_insight', 'assignment_suggestion', 'onboarding_assistant',
    'work_order_triage', 'work_order_creation', 'guest_request_creation',
    'task_assignment', 'general', 'housekeeping_briefing'
  )
);
```
Per project convention (established in 12-01/12-02/15/16 summaries in STATE.md), write the migration but confirm with the user/orchestrator whether to apply it live to the remote Supabase project in this session — prior phases have applied migrations 086/087/090 live via the Supabase MCP tool as a separate step, not automatically as part of writing the SQL file. Also consider (not required by DATA-01, but worth flagging as a related follow-up): `apps/api/middleware/credits.py`'s `CREDIT_COSTS`/`INTERACTION_MODEL` dicts (lines 6-37) have no entries for `work_order_creation`, `guest_request_creation`, `task_assignment`, or `general` either — `compute_credits()` (`credits.py:97-110`) falls back to `"gpt-4o-mini"` model / `1.0` credit floor for any unmapped `interaction_type` via `.get(..., default)`, so billing won't crash, but it's worth confirming that fallback is the intended cost for these newly-unblocked interaction types.

### STAFF-01 — Supervisors appear as assignable staff in the housekeeper room-assignment picker

**Root cause (HIGH confidence — partially already fixed, one picker missed):** There are (at least) two distinct "assign a housekeeper to a room" pickers in `apps/web`, and they are inconsistent:

1. **Main assignment picker — already correct.** `HousekeeperBar` in `apps/web/app/(dashboard)/housekeeping/page.tsx` line 97:
   ```tsx
   .filter((s: any) => s.role === 'housekeeper' || s.role === 'housekeeping_supervisor')
   ```
   This is the primary "tap-to-assign" picker used from the main Housekeeping board (`assignmentMode`). It already includes `housekeeping_supervisor`. Backend support already exists too: `_ensure_housekeeper()` in `apps/api/routers/housekeeping.py:93-104` (validates the assignee on save) and the AI-suggest endpoint (`ai_copilot.py:216,238`) both already `.in_("role", ["housekeeper", "housekeeping_supervisor"])`.

2. **Inspection re-assign picker — still excludes supervisors.** `apps/web/app/(dashboard)/housekeeping/inspections/page.tsx` line 170:
   ```tsx
   const housekeepers = (staffData?.data?.staff ?? []).filter((s) => s.role === 'housekeeper')
   ```
   This feeds the `<select>` dropdown (lines 502-516) shown in the "Re-assign drawer" that appears after a failed inspection ("send this room back to a housekeeper"). It filters to `role === 'housekeeper'` only — a `housekeeping_supervisor` who is a valid room-assignee everywhere else in the app cannot be selected here.

Also note (out of STAFF-01's literal scope but adjacent, found during the same grep): `apps/web/app/(dashboard)/tasks/page.tsx:240` filters staff to `role === 'housekeeper' && status === 'active'` for **task** assignment (not room assignment) — this is a different feature (general task assignment, not the housekeeper room-assignment picker) and REQUIREMENTS.md's wording is specifically "room-assignment picker," so this is very likely out of scope; flagging it so the planner can explicitly confirm/exclude it rather than it being silently missed.

**Recommended fix:** Change `inspections/page.tsx:170` to match the already-correct pattern used in `housekeeping/page.tsx:97`:
```tsx
const housekeepers = (staffData?.data?.staff ?? []).filter((s) => s.role === 'housekeeper' || s.role === 'housekeeping_supervisor')
```
No backend change needed for this picker specifically — `GET /staff` already returns supervisors in the same list (`staff.py:83-93`, role filter is `require_role` on the *caller*, not a filter on the returned staff rows), the frontend is the only place currently narrowing it.

## Common Pitfalls

### Pitfall 1: `dict.get(key, default)` does not catch `None` values
**What goes wrong:** Python's `.get(key, default)` only substitutes `default` when `key` is absent from the dict — if the key exists with value `None` (e.g. a NULL column from a Supabase row), the `None` passes through untouched.
**Why it happens:** Looks correct at a glance; the bug only manifests once real data has a NULL in that column, which may not show up in a small/seeded local dev DB.
**How to avoid:** Use `dict.get(key) or default` (or `dict.get(key) or fallback_chain or ...`) whenever the value could legitimately be NULL in the DB, matching the pattern already used everywhere else in this codebase except `staff.py:136`.
**Warning signs:** A frontend crash (`Cannot read properties of null/undefined`) or a silently blank UI field, traceable back to a `.get(x, "")`/`.get(x, default)` call rather than `.get(x) or default`.

### Pitfall 2: Duplicated un-null-safe utility functions
**What goes wrong:** `getInitials()` exists as 4 independent copies (`lib/utils/avatar.ts` plus 3 local re-implementations in `staff/page.tsx`, `scheduling/page.tsx`, `housekeeping/page.tsx`), none of which guard against `null`/`undefined`/empty input.
**Why it happens:** Copy-paste during earlier feature work rather than importing the shared util.
**How to avoid:** When fixing UX-01, prefer consolidating call sites onto the one shared, now-null-safe `lib/utils/avatar.ts` version rather than patching each duplicate independently (reduces future drift).

### Pitfall 3: Client-side error-message sanitizers can silently discard specific backend detail
**What goes wrong:** `apps/web/lib/api/client.ts`'s `toFriendlyError()` (lines 34-58) rewrites any backend `detail` string containing `"code"`, `{`, or over 200 chars into a generic bucketed message. Combined with call sites that hardcode a fallback string instead of using `err.message`, users can see a wrong/generic error even when the backend already computed something more specific.
**Why it happens:** The sanitizer is reasonable for raw Postgres error strings (e.g. `23505` constraint violations) but can mask a deliberately-crafted, already-friendly backend message if that call site never wires up `err.message` at all (as in UX-03's `statusQuery.isError` block).
**How to avoid:** Always surface `(query.error as any)?.message` in error UI, never a bare hardcoded string, so any future backend message improvement automatically reaches the user.
**Warning signs:** A `useQuery`/`useMutation` `onError`/`isError` block that renders a literal string with no reference to `err`/`error` at all.

### Pitfall 4: "Definition"/explanation fields returned by analytics endpoints can leak implementation detail
**What goes wrong:** A field intended to be GM-facing documentation (`contracts.py:322`'s `"definition"`) was written as an internal pseudo-code expression using the exact Python variable name, not prose.
**How to avoid:** When adding any explanatory/help-text field to an API payload, review it as if it will be displayed verbatim (it usually will be) — no `snake_case` variable names, no `=` assignment syntax.

## Open Questions

1. **UX-06 root cause confirmation**
   - What we know: The `stay_reset_at` gating mechanism in `get_room_history()` (`rooms.py:1004-1030`) is a plausible, evidenced cause for hidden note/status-history entries, and the bulk Opera-import path (`housekeeping.py:1986-1987`) sets that boundary far more aggressively than the "real DEP inspection" path.
   - What's unclear: Whether this is actually the reproducible cause of the reported "doesn't populate" symptom, versus e.g. a simpler issue (a role-gating surprise, a room genuinely having zero history, or a frontend query key/staleness bug not found in this research pass).
   - Recommendation: Have the plan's first task be a live reproduction (open a room's drawer as a GM/supervisor for a room known to have recent activity) before deciding between "narrow the bulk-import stay_reset_at trigger" vs. "loosen/remove the gating in this specific endpoint" vs. some other fix.

2. **UX-02 "leftover" entries — is there already a duplicate row sitting in the dev DB?**
   - What we know: The code-level cause (no uniqueness constraint, no pre-insert check) is confirmed and would explain future duplicates.
   - What's unclear: Whether the *original* v1.2-audit report was describing a pre-existing duplicate/orphan row already in the shared dev/demo Supabase project (which would need a one-time data cleanup in addition to the code fix), or a reproducible-by-anyone code bug.
   - Recommendation: Query `shifts` in the dev Supabase project for `(tenant_id, department_id, name)` duplicates before finalizing the plan; if found, the plan needs a data-cleanup step alongside the constraint/check fix.

3. **STAFF-01 scope boundary — is `tasks/page.tsx:240`'s housekeeper-only task-assignment filter in scope?**
   - What we know: It's a different picker (task assignment, not room assignment) filtering the same two roles' worth of staff data.
   - What's unclear: REQUIREMENTS.md says "housekeeper room-assignment picker" (singular, specific), which points at the room picker(s) only — but the product decision ("include supervisors as assignable staff") reads more broadly.
   - Recommendation: Planner should explicitly decide and record whether `tasks/page.tsx:240` is in/out of scope for this phase, rather than it being silently caught or silently missed.

## Sources

### Primary (HIGH confidence — direct codebase reads this session)
- `apps/api/routers/staff.py`, `apps/api/routers/housekeeping.py`, `apps/api/routers/rooms.py`, `apps/api/routers/scheduling.py`, `apps/api/routers/integrations.py`, `apps/api/routers/management_roi.py`, `apps/api/routers/guest_requests.py`, `apps/api/routers/ai_copilot.py`, `apps/api/routers/sop.py`, `apps/api/routers/onboarding.py`
- `apps/api/middleware/credits.py`, `apps/api/services/guest_recovery/contracts.py`, `apps/api/services/ai/shift_summary.py`
- `apps/web/app/(dashboard)/staff/page.tsx`, `.../scheduling/page.tsx`, `.../housekeeping/page.tsx`, `.../housekeeping/inspections/page.tsx`, `.../housekeeping/rooms/page.tsx`, `.../settings/integrations/page.tsx`, `.../management-roi/page.tsx`, `.../tasks/page.tsx`
- `apps/web/components/housekeeping/{AssignmentSidebar,RoomDetailDrawer,RoomStatusBoard}.tsx`, `apps/web/components/guest-requests/{GuestRequestDrawer,GuestRequestsPage}.tsx`
- `apps/web/lib/api/{client,housekeeping,guest_requests}.ts`, `apps/web/lib/utils/avatar.ts`
- `supabase/migrations/{004_rooms,005_scheduling,013_ai_systems,059_stay_reset_at,088_ai_interactions_work_order_triage_type,063_latest_room_notes_rpc}.sql`
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` (v1.2 audit deferred-items table, lines 259-268; v1.3 roadmap creation notes, lines 276-292), `.planning/supervisor-workflow-audit.md` (mobile-only, confirmed out of this phase's web-only scope)

### Secondary / Tertiary
None — no WebSearch or Context7 lookups were needed for this phase.

## Metadata

**Confidence breakdown:**
- UX-01 (staff names): HIGH — exact line, exact bug pattern, exact crash sites all confirmed by grep+read
- UX-02 (shift dropdowns): HIGH on mechanism (no constraint, no dup-check), MEDIUM on whether a duplicate row currently exists in live data (flagged as Open Question 2)
- UX-03 (Opera error): HIGH — exact hardcoded string found, exact fix pattern already established 4x in the same file
- UX-04 (ROI formula leak): HIGH — exact leaked string and exact render site found
- UX-05 (Guest Request drawer): HIGH — confirmed absence of any status control in the drawer, confirmed working reference implementation in the sibling card component
- UX-06 (Room History): MEDIUM — plausible, evidenced hypothesis; explicitly flagged as needing live verification before the fix is finalized
- DATA-01 (CHECK constraint): HIGH — exact allowed set (migration 088) vs. exact used set (grep of all `log_ai_interaction` call sites) fully enumerated
- STAFF-01 (assignment picker): HIGH — exact two pickers identified, one already correct, one exact line to fix

**Research date:** 2026-08-04
**Valid until:** Should be re-verified if any of the touched files change before this phase is planned/executed (this is a fast-moving codebase with concurrent phase work per STATE.md) — treat as valid for ~7 days given the pace of recent commits.
