# Engineering Home V2

Mobile redesign of the Engineering Home for the two engineering roles. One branch (`feat/mobile-engineering-home-v2`),
one draft PR, one commit per phase. The repository is the authority for behavior, permissions and contracts; the
interactive prototype (`patelrep-engineering-home-interactive.html`, supplied separately and not committed) is a visual
and interaction reference only. Its fictional hotel, people, counts, work orders and PM records are never shipped.

Status: **Phases 1-4 of 8 are implemented** (Phase 1: foundation, navigation contract, role correctness; Phase 2: the
complete Technician Home; Phase 3: the Chief Engineer command center; Phase 4: connected actions and drawers, section 12).
Phases 5-8 are scope, not code.

## 1. Eight-phase scope

| # | Phase | Delivers |
|---|-------|----------|
| 1 | Foundation, architecture, correctness | Navigation contract, `all` Work view, scanner shortcut, role-correct Home actions, this document, tests |
| 2 | Technician Home (**done**) | Compact header, three exact/honest counts, contextual primary card (continue / start next / resume PM / available / caught up), Needs Attention with an in-place full list, four shortcuts, single-request queue, tests |
| 3 | Chief Engineer Home (**done**) | Management layout: Needs owner / In progress / On hold, Property Priorities with in-place Assign, team workload, room/PM oversight, four shortcuts, one overview read, tests |
| 4 | Connected actions and drawers (**done**) | Audit of every Home control against the existing screens and sheets, the gaps found closed (section 12), interaction matrix, tests |
| 5 | Sync, connectivity, notifications | Deeper sync/offline/stale states, pending-action visibility, notification entry points beyond the Home header |
| 6 | Prototype gap closure | Only the genuine gaps in section 6 that the owner approves |
| 7 | Accessibility and i18n pass | Screen-reader and font-scale audit on device, i18n parity review |
| 8 | Integration and hardening | Device QA, final acceptance (section 9) |

Phase boundaries beyond Phase 2 are a proposal; the owner confirms each phase before it starts. (The Phase 1 table split
Technician Home across two phases; the owner's Phase 2 brief combined them, so the later rows were renumbered.)

## 2. Technician Home (role `engineer`)

Top to bottom (components in `components/engineering/home/`, composed by `EngineerHome.tsx`):

1. **Header** (`TechnicianHomeHeader`, `HomeConnectionStatus`) - avatar (profile), greeting, hotel name, role line
   (Maintenance technician / Chief engineer), notifications bell with unread count, and a connection line that opens
   Engineering Sync. Long names truncate to one line; safe-area top inset applied.
2. **Metrics** (`TechnicianSummaryCards`) - My Jobs, Urgent, PM Due (sources in section 7).
3. **Primary card** (`TechnicianFocusCard`) - one contextual card, state machine below.
4. **Needs attention** (`TechnicianAttentionSection`) - top 3, then **View all (N)** expands the complete list in place.
5. **Quick actions** (`TechnicianQuickActions`) - Report Issue, Scan Asset, Room Status, Available Work.

### 2.1 Primary card state machine (`lib/engineering/homeFocus.ts`)

First match wins. "Mine" is exactly `assigned_to === viewer`; unassigned or someone else's work is never presented as the
person's job. Nothing here starts, claims or completes work: every state only navigates.

| # | Condition | State | Button |
|---|-----------|-------|--------|
| 1 | my in-progress emergency | `continue_repair` | Continue Repair -> that order |
| 2 | my other in-progress work | `continue_repair` (+ "N more in progress" -> My Work) | Continue Repair |
| 3 | my open/escalated emergency | `start_next` | Open Job -> that order |
| 4 | my urgent | `start_next` | Open Job |
| 5 | my other overdue assigned work | `start_next` | Open Job |
| 6 | my other actionable assigned work | `start_next` | Open Job |
| 7 | a real saved PM draft of mine | `resume_pm` | Resume Inspection -> `/pm-schedules/inspect/<id>` |
| 8 | unassigned open/escalated work exists | `available_work` | View Available Work -> `?view=available` |
| 9 | nothing, and queue + PM + drafts all loaded | `caught_up` | none |
| - | queue + drafts loaded, PM failed | `caught_up_pm_unknown` | none (never claims a full all-clear) |
| - | queue not loaded, or role cannot act (chief) | `none` | no card |

Tie-breakers inside 1-6, in order: priority (emergency, urgent, normal, low), earliest due time (none last), oldest
created first, then id (stable between renders). Emergency (priority) is deliberately separate from overdue (a due date):
an emergency outranks an overdue normal job; overdue only decides among non-emergency, non-urgent work.

Why "Open Job" and not "Start Repair": starting a repair is `startWorkOrderLabor` on the work-order screen, behind its
acknowledge/arrive/lock guards and offline rules. Duplicating that on a passive Home would risk diverging from it, so Home
links to the order, where the existing Start Repair action lives. A passive refresh can therefore never change a work order.

PM draft eligibility: drafts come from `listPmDraftSummaries` (AsyncStorage, keyed `tenant:user:schedule`, so another
person or property is never shown). Newest first; once schedules have loaded, a draft whose schedule is no longer an
active one is skipped. The card says "Saved on this phone. Not submitted yet." - a draft is never presented as recorded.
When the work queue cannot load (offline), a real saved draft is still offered under the error state.

## 3. Chief Engineer Home (role `chief_engineer`)

Own screen, not the technician Home with renamed cards. `EngineerHome.tsx` is a thin dispatcher: `usesChiefHome(role)`
(`homeNavigation.ts`) picks `ChiefEngineerHome` for `chief_engineer`, `TechnicianHome` for everyone else. The role is read live
from the store, so a role change swaps the whole component and drops its state (and its data: management data is only ever
held by the chief component). Tab bar unchanged: Home | Work | PM | Assets | More.

Top to bottom (`components/engineering/home/chief/`, reusing the Phase 2 header, summary cards, quick actions, notice row):

1. **Header** - the shared `TechnicianHomeHeader` with `heading` ("Engineering Overview"), hotel name, role line
   ("Chief engineer - first name"), bell with unread count, avatar (profile) and the connection line (last successful read,
   offline/failed/pending; opens Engineering Sync). No hotel switcher: PatelRep has no verified property-switching flow.
2. **Metrics** - Needs owner, In progress, On hold (3.1).
3. **Property priorities** (`PropertyPriorities`) - the main section (3.2), with in-place Assign (3.3).
4. **Team workload** (`TeamWorkloadPreview`) - 3.4.
5. **Rooms and PM** (`ChiefOversight`) - two honest aggregates (3.4).
6. **Shortcuts** - Assign Work, Team Overview, PM Planning, Assets (3.5).

Never offered to a chief engineer: claim, start/pause/hold/escalate/complete a work order, My Jobs, Continue Repair, Available
Work as a technician pick-up list (API guards in `apps/api/routers/work_orders.py` are `engineer` + `gm` only). The one action Home
performs is **Assign**, which `POST /work-orders/{id}/assign` restricts to `chief_engineer` + `gm` server-side.

The Phase 2 "chief interim" branches inside `TechnicianHome` are unreachable for `chief_engineer` now; they stay as a
permission-safe fallback (they never offer a personal-work control to a role that cannot act).

### 3.1 Metrics

| Card | Value | Opens |
|------|-------|-------|
| Needs owner | `counts.needs_owner` | Work `?view=available` (unassigned open/escalated: exactly what the count means) |
| In progress | `counts.in_progress` | Work `?view=team&filter=in_progress` (Team narrowed to the one status, the selection the Work tile makes) |
| On hold | `counts.on_hold` | Work `?view=waiting` |

Source: the `managerSummary` contract over `GET /engineering/team/overview`; Home counts nothing itself. A field the server
omits or malforms is unknown and shows "-" with an "unavailable" accessible name, never 0. Loading and failed reads also show
"-". If the server read only part of the active work (`truncated`) every card shows `N+`. "All active work has an owner."
appears only when `needs_owner` is a confirmed 0 and counts are complete.

`resolveWorkLink` gained one filter, `in_progress`, honoured only on the `team` view; on any other view it is dropped (never
applied to the wrong queue), and an engineer cannot reach `team` at all (the link is ignored, not rewritten).

### 3.2 Property priorities (`chiefHomeModel.buildPriorities`)

Built from the overview's own records; records are never merged or reclassified:

| Rank | Source | Row |
|------|--------|-----|
| 0 | `needs_attention` kind `emergency_unassigned` | work order |
| 1 | `urgent_overdue` | work order |
| 2 | `escalated` | work order |
| 3 | `rooms_down` (only when `total > 0`) | one aggregate row |
| 4 | `on_hold` | work order |
| 5 | `pm_oversight.overdue` | PM schedule |
| 6 | `pm_oversight.repeat_defects` | equipment |

The order is a display policy; statuses, permissions and which items qualify are the server's. Within one rank the server's order
is kept; duplicate ids are dropped. Rows show category, WO number, room, title, owner or "Unassigned", hold reason for held work.
Four rows are previewed; **View all (N)** expands the same list in place so work orders, rooms and PM stay together (a
Work-only destination would drop the PM and room rows). Work orders the server flagged but did not send (its
`attention_counts` exceed the rows) are counted and link to Team Overview. A source the server could not read
(`pm_oversight` or `rooms_down` null) shows an "unavailable" notice with Retry and disables the all-clear; so do `truncated`
reads and hidden work orders. The calm state ("No emergency, overdue, escalated or held work, and no rooms or PM flagged.")
needs every source readable, nothing cut off and nothing flagged.

Row destinations use the safe route builders (`workOrderRoute`, `pmScheduleRoute`, `assetRoute`): a malformed id falls back to
the relevant list, never a bad link. The room row opens the existing Room Status screen.

**Room semantics.** Only the server's confirmed `rooms_down` figure is shown, as an aggregate. A repair, a faulty asset or an
alert is never presented as a room being out of order, individual rooms are never fabricated from the aggregate, and Home
changes no room status. Completing a work order still does not mark a room ready; that stays with housekeeping/front desk.

### 3.3 Assignment

Reuses `AssignTechnicianSheet`, `useTechnicians`, `useAssignTechnician`, `POST /work-orders/{id}/assign` and
`classifyAssignError` unchanged, plus one optional field: `AssignTarget.location` (the room), shown in the sheet header.
Assign/Reassign is offered on work-order rows except held work with no owner (same rule as Team Overview) and only for a manager
role; offline the control is disabled with a note, and the sheet blocks confirm. The sheet sends `expected_assigned_to` (the
assignee Home displayed) so a stale view is refused (409), and a ref guard prevents a double submit. Success is shown only
after the server answers; "already assigned to that person" is reported as such. `useAssignTechnician` emits
`emitAssignmentChanged`, which `useTeamOverview` listens to, so the overview (counts, priorities, workload) re-reads once after
a confirmed assignment; a conflict triggers one re-read through `onNeedsRefresh`. The sheet lists technicians with their job
counts only: no "available now" label exists anywhere because no shift/clock-in source does.

### 3.4 Workload and oversight

`TeamWorkloadPreview`: top four technicians by active jobs (name, active count, plus urgent / overdue / on-hold when non-zero),
**View Team (N)** to Team Overview, each row to that technician's existing work list (`/(app)/team/<id>`). The bar is
`active / max(active of those shown)`: a relative comparison of job counts, documented as such on screen, always paired with the
number, and never a utilisation, capacity or availability claim. No technicians: an accurate empty state.

`ChiefOversight`: rooms (confirmed count, "past expected return") opens Room Status; PM (overdue count, repeated-defect equipment
count) opens the PM **Plan** (`/(app)/pm-schedules?view=plan`). Unknown figures read "Unavailable". PM schedule create/edit/
defer/inspect/history are not duplicated: rows open the existing screens, whose own role gates (`canManagePmSchedules`,
`canCompletePm`) apply - a chief engineer's inability to complete work orders says nothing about PM.

### 3.5 Shortcuts

Assign Work -> Available Work (an actionable list: each unassigned order has its Assign action; no target-less sheet),
Team Overview -> `/(app)/team`, PM Planning -> PM Plan, Assets -> `/(app)/assets`.

### 3.6 Data loading

One request: `useTeamOverview` (`useAsyncResource`, key `tenant:user:team`). It already guarantees: newest request wins, a
different property/person starts empty (no flash of the previous hotel), a failed refresh keeps the last good data and reports
the failure, last good data is reused on return. Home adds: refetch on regaining focus (not the first focus), pull-to-refresh
(its own spinner flag, so realtime reads do not pop the pull spinner), one trailing read per 1.5 s burst of `work_orders`
realtime events, a minute tick for "synced N min ago". The Phase 2 technician hook reads three endpoints; the chief Home reads
one.

## 4. Role permissions per action

Source of truth: `apps/mobile/lib/engineering/roles.ts` (mirrors the API). The UI only decides what to offer; the server enforces.

| Action | engineer | chief_engineer | gm (API parity only; GM has its own Home) |
|--------|:-:|:-:|:-:|
| View Home | yes | yes | yes |
| Claim / transition / complete a work order | yes | **no** | yes |
| My Work view / My Jobs metric | yes | **no** | yes |
| Team view; read every work order | no (own + unclaimed) | yes | yes |
| Assign a technician | no | yes | yes |
| Report an issue (`POST /work-orders`, no role guard) | yes | yes | yes |
| Scan / open / edit equipment | yes | yes | yes |
| Retire equipment | no | yes | yes |
| Complete a PM inspection | yes | yes | yes |
| Own PM schedules (create, reschedule, retire) | no | yes | yes |
| Room Status | yes | yes | yes |

## 5. Navigation contract (Phase 1)

All Home links are built in `lib/engineering/homeNavigation.ts`; Work-screen link parsing is `resolveWorkLink` in
`lib/engineering/workNavigation.ts`. Rule: **a count opens a screen that holds exactly what was counted.**

| Control | Destination |
|---------|-------------|
| My Jobs (engineer) | `/(app)/work-orders?view=mine` |
| Urgent | `/(app)/work-orders?view=all&filter=urgent` - every active emergency/urgent order the role can read, any status, any owner |
| PM Due | `/(app)/pm-schedules` |
| Continue Repair / Open Job / View order | `/(app)/work-orders/<id>` |
| "+N more in progress" | `?view=mine` |
| Resume Inspection | `/(app)/pm-schedules/inspect/<scheduleId>` |
| View Available Work (card and shortcut) | `/(app)/work-orders?view=available` |
| Attention row - work order | `/(app)/work-orders/<id>` |
| Attention row - PM | `/(app)/pm-schedules/<id>` |
| Attention row - blocked saved inspections | `/(app)/engineering-sync` |
| Attention "View all (N)" | expands the complete list in place (work orders, PM and blocked saves together) |
| Report Issue | `/(app)/work-orders/new` |
| Room Status | `/(app)/room-status` |
| Scan Asset | `/(app)/assets/scan` (the one existing scanner; it has manual code entry, asset search and cached-copy handling) |
| PM (chief engineer only, in place of Available Work) | `/(app)/pm-schedules` |
| Sync line | `/(app)/engineering-sync` |
| Bell / avatar | `/(app)/notifications`, `/(app)/profile` |

Notes:

- Why "View all" is in place and not a new screen: the full attention set mixes work orders, PM and sync items, which no
  existing screen holds, and a new hidden route risks the expo-router `href: null` bounce documented for this app. Expanding the
  same list guarantees nothing is dropped and adds no route.
- `all` is a Work view: every active status, no ownership narrowing. It is link-only (no tab, no shortcut) and shows
  the same Back row as On hold / History. It exists because Urgent spans own, unclaimed and held work, which no single
  existing view contains (it previously landed on My Work or Available and silently showed a subset).
- Work is a mounted tab, so Home adds a per-tap `nav` token to its Work links; otherwise a repeated tap with identical
  params would not re-apply the filter after the person moved around inside Work.
- A link naming a view the role cannot reach (e.g. `team` for an engineer, `mine` for a chief) is ignored, never rewritten
  to another queue; an unknown `filter` is dropped while the view still opens.
- Unchanged and still supported: notification deep links (`/(app)/work-orders/<uuid>`, `lib/notifications/deepLink.ts`),
  work-order / PM / asset / room detail routes (`lib/engineering/routes.ts`), `?view=` links, `?new=` (report form).

## 6. Prototype interactions mapped to the repository

| Prototype | Existing implementation | Gap |
|-----------|------------------------|-----|
| Work order details / actions | `work-orders/[woId]` + `components/engineering/workorder/*` | none |
| Hold reason sheet | `workorder/HoldSheet.tsx` | none |
| Report issue form | `work-orders/new`, `components/engineering/report/*` | none |
| PM detail / inspection | `pm-schedules/[scheduleId]`, `pm-schedules/inspect/[scheduleId]` | none |
| Asset detail / lookup | `assets/[assetId]`, `assets/index` | none |
| Scan asset | `assets/scan` | none |
| Room detail | `room-status/[roomId]` | none |
| Assign technician | `components/engineering/team/AssignTechnicianSheet.tsx` | none |
| Work filters | `WorkFilterSheet.tsx`; PM: `pm/PmFilterSheet.tsx` | none |
| Notifications | `notifications/` | none |
| Sync | `engineering-sync/` | none |
| Account / help | `profile/*`, `profile/help` | none |
| Team screen | `team/index`, `team/[userId]` | none |
| Dedicated "Attention" screen | none (Work `all` view + PM list cover it for now) | Phase 7, only if approved |
| Chief dashboard cards (workload, PM oversight, room-down) | `home/chief/*` over `useTeamOverview` | done in Phase 3 |

## 7. Canonical data sources

| Displayed value | Source |
|-----------------|--------|
| My Jobs | Exact: `GET /work-orders/summary` (`total - waiting`: the caller's own active work excluding on hold, counted on the server). If that request fails, the deduplicated queue's own count, shown as `N+` when the queue was cut off. The My Work screen reads the same endpoint. |
| Urgent | Deduplicated active queue, priority emergency or urgent, any active status. No server count exists for the role-scoped "own + unclaimed" set, so this is exact unless the queue was cut off (then `N+`). |
| PM Due | `listPmSchedules`, active schedules overdue or due today in hotel time (`pmSchedules.adaptPmSchedules`) |
| Primary card | Same queue + PM + saved drafts (`usePmSyncItems`), `homeFocus.resolveFocus` |
| Attention list | Same queue + overdue PM + blocked saved inspections (`needsPerson` states); one entry per order/schedule, most severe reason wins; the primary card's order is not repeated |
| Chief: Needs owner / In progress / On hold | `GET /engineering/team/overview` `counts.needs_owner` / `in_progress` / `on_hold` via `managerSummary` (section 3.1) |
| Chief: priorities, workload, rooms, PM | The same overview: `needs_attention`, `technicians`, `rooms_down`, `pm_oversight` (section 3) |
| Connection line | `resolveSyncStatus`: online flag, pending queue, last successful load |

Attention order: emergency, blocked saved inspection, urgent unassigned, past due, overdue PM, on hold (mine). Ties keep
the source order (priority/age, most overdue PM first).

Request changes in Phase 2: the active queue is one paged request (`listActiveWorkOrders`: `statuses=open,escalated,
in_progress,on_hold`, 100 per page, `has_more` from the server, 5 pages max) instead of four per-status requests - 1 request
instead of 4 on a typical property. `GET /work-orders/summary` is the existing endpoint; its parsed shape gained an optional
`total` (older servers omit it and the card falls back). No API, schema or RBAC change, no migration.

Refresh behavior: pull-to-refresh and tab focus reload everything; realtime `work_orders` changes trigger one trailing
reload per 1.5 s burst. Late answers for an old request or scope are dropped.

## 8. States

- **Loading** - metrics read "-" (never 0); the primary area shows the shared loading state.
- **Empty** - "caught up" appears only when the queue, PM and saved drafts all loaded. If PM failed the card says repairs are
  clear but PM could not be checked. Attention's "nothing needs attention" also needs all three.
- **Error** - the failed section shows its own error with Retry; a failed queue never reads as "all clear". PM failure keeps the
  queue and shows a PM-specific retry row. A failed summary request silently falls back to the queue count.
- **Offline** - the connection line says offline with the last successful sync; cached data stays visible; shortcuts still
  navigate; a real saved PM draft can still be resumed. Home never reports a queued action as server-confirmed.
- **Stale** - a failed refresh with prior data shows the stale banner; counts that may be partial show `N+`.
- **Isolation** - the Home data hook is keyed by `tenant_id:user_id`; the saved-draft/sync hook also reloads on tenant or user
  change; a scope change clears all data before the next render, and late answers for an old scope are dropped.

## 9. Ownership, accessibility, acceptance

Component ownership: `lib/engineering/chiefHomeModel.ts` (chief summary, priority ordering, workload scale, routes; pure), `components/engineering/home/chief/*` (chief composition), `lib/engineering/homeFocus.ts` (primary-card state machine), `homeModel.ts` (counts, attention, connection
state), `homeNavigation.ts` (all links), `useEngineeringHome.ts` (data), `components/engineering/EngineerHome.tsx` (composition) and
`components/engineering/home/*` (presentational pieces). Business logic stays in the model files; the components only render.

Accessibility: every control is a button with a role and an accessible name that includes its value; touch targets at
least 48dp (links at least 40dp); `maxFontSizeMultiplier` capped; sync line is a polite live region; sections use header roles.

Final acceptance (Phase 8): both role homes match section 2/3; every control in section 5 lands where its count says;
no technician-only action reachable by a chief engineer; all states in section 8 verified; `en`/`es` keys at parity;
type-check, lint and mobile tests green; device run on Android and iOS recorded honestly; deep links and notifications
from PRs #190, #191, #195 unchanged; one PR, human merge.

## 10. Phase 2 record

Tests: `homeFocus.test.ts` (ranking, tie-breakers, every state, chief, draft eligibility), `homeNavigation.test.ts` (shortcuts per
role, focus and attention destinations, attention order), `EngineerHome.test.tsx` (header, counts incl. exact count and fallback,
every primary-card state, attention preview/expand/PM/blocked sync, loading/error/offline/partial failure, quick actions, chief
protection, tenant isolation), `listActiveWorkOrders.test.ts`, `workSummary.test.ts`.

Departures from the prototype: the prototype's Start Repair button on Home is an "Open Job" link (see 2.1); "View all" expands in
place instead of opening a separate Attention screen; the fictional hotel, people and counts are never shipped.

Not done / deferred: a server-side exact Urgent count (would need a new endpoint
scoped to own + unclaimed work; today it is exact unless the queue is cut off); device/emulator run (not performed in this phase).

## 11. Phase 3 record

Tests (all in `apps/mobile/__tests__`): `lib/engineering/chiefHomeModel.test.ts` (summary known/unknown/zero, priority order,
dedup, room aggregate, all-clear conditions, hidden work orders, safe routes and fallbacks, assign eligibility and target,
workload scaling), `chiefHomeNavigation.test.ts` (the three cards open the same queues and filters as the Work tiles and their
list requests, role gating of the link, shortcuts), `chiefHomeI18n.test.ts` (en/es key parity, real i18next resolution, v3
plurals), `screens/ChiefEngineerHome.test.tsx` (role routing and role change, header, cards incl. loading/older server/
truncated, priorities, assignment success/conflict/403/500/double-tap/no-op/offline/held, workload, oversight, shortcuts,
error/stale/offline/pull-to-refresh/focus/realtime burst/out-of-order, tenant switch, a11y, dark mode), plus `pluralKeys` and
`EngineerHome.test.tsx` (chief interim cases removed: that role no longer renders the technician Home).

Departures from the prototype: the prototype's priority "View all" is an in-place expansion plus Team Overview for the rest; its
"Available now" technician list and utilisation-style bars are not shipped (no availability or capacity data exists); room-down is
an aggregate (no per-room source in the overview); its fictional data is never shipped. No new tab, route, endpoint, migration or RBAC change.

Not verified: no device or emulator run in this phase; assignment against a live API was not exercised (covered with mocked
API contracts and the existing sheet tests).

### Remaining for Phase 4

Individual room rows for rooms down (needs a per-room read in the overview or a room-board query); the full drawer/sheet
refinements for the Work, PM and Assets screens when entered from Home; a server-side exact urgent count; device QA of both roles.

## 12. Phase 4 record: connected actions, drawers and workflows

Phase 4 is an integration audit, not a rebuild. Every Home control was traced to the screen or sheet that already owns the
behavior (PRs #190, #191, #195 and the Team Overview sheet) and was found to be connected; nothing was re-implemented. The
audit did find five real gaps, and only those were changed.

### 12.1 Gaps found and closed

| Gap | Where | Fix |
|-----|-------|-----|
| Technician Home built work-order links from the raw id (`/(app)/work-orders/${id}`), unlike the chief Home which uses the safe builders. An id containing a slash, dot or query could change the route. | `homeNavigation.focusRoute`, `attentionRoute` | New `workOrderPath(id)`: a plain id opens that order, anything else opens the Work list. |
| Chief Home ignored saved inspections that need a person (rejected, needs review, unknown outcome), and could show "no emergency, overdue, escalated or held work" while one sat unresolved. | `ChiefEngineerHome` | Reads the same `usePmSyncItems` source as the technician Home; a "N saved inspection(s) need you / Review" row opens Engineering Sync. |
| Both Homes could show an all-clear while saved actions were still waiting to reach the server. | `ChiefEngineerHome`, `EngineerHome` | The calm state requires no blocked saves and no pending actions. Pending is not shown as a failure; the connection line already counts it. |
| The work-order screen's Back did nothing when the order was opened by a link with no history (notification, cold start). | `work-orders/[woId]` | Back goes to the Work list when `router.canGoBack()` is false (the completion view already did this). |
| Blocked-save counting was duplicated inline. | `pmSyncItems` | `countBlockedPmSync` shared by both Homes. |

No API, schema, RBAC, migration, workflow or dependency change.

### 12.2 Drawers and sheets (all reused, none new)

| Sheet | Opened from | Notes |
|-------|-------------|-------|
| `HoldSheet` | Work order, Hold (roles that can act on work orders) | Reasons are the server's `HOLD_REASON_CODES`; confirm is disabled until one is chosen and while offline. The note is a local draft. A server refusal leaves the choice and note in place and shows the error; success is only a confirmed status transition followed by a re-read. The optional labor pause is a separate request sent first. |
| `AssignTechnicianSheet` | Chief Home priority row, Team Overview, work-order screen | Sends `expected_assigned_to` (409 on a stale view), ref-guarded against double submit, offline blocks confirm. Technicians are listed by job count only; no "available" claim. |
| Completion, Diagnosis, Evidence, Parts, Labor, Note, Escalation, Repair Assist | Work order screen | Unchanged. |
| Room Impact drawer | not built | See 12.5. |

All sit on the shared `BottomSheet`: modal with `onRequestClose` (Android hardware back), keyboard avoidance, safe-area bottom
inset, a labelled close control, `accessibilityViewIsModal`, reduced-motion aware, `maxHeight` 88-94 percent so it fits a small
phone. One sheet is open at a time (`sheet` state on the work-order screen). No global modal state, no new library.

### 12.3 Journeys

| Journey | Path | Outcome |
|---------|------|---------|
| Tech A | Home, Continue Repair, work order, Hold, confirm, back | Hold goes through the work-order status transition to `on_hold` with a reason code; Home re-reads on regaining focus and on the `work_orders` realtime event, and a held order is not `in_progress`, so the card no longer says Continue. |
| Tech B | Home, Report Issue, submit, View | `useReportIssue` posts once (idempotent request id); "created" and the WO number come only from the server's answer, View opens the server id; an offline save is worded as not yet accepted. |
| Tech C | Home, Scan Asset, asset, related work order | Existing scanner: manual entry, search, denied-permission recovery, retired/ambiguous/foreign outcomes; a web address in a QR is ignored. |
| Tech D / E | Home, Resume Inspection or PM Due, inspection | Existing PM V2 inspection; the draft is restored from the local store, a completion is confirmed only by the server (or shown as queued), then Home re-reads PM. |
| Chief A | Home, Needs owner (Available Work) or priority row, Assign, confirm | `emitAssignmentChanged` makes `useTeamOverview` re-read once. |
| Chief B | Home, Team workload, technician, work order | `/(app)/team/<id>` then the order. |
| Chief C | Home, rooms row, Room Status, room, related order | Aggregate only on Home (12.5). |
| Chief D | Home, PM oversight, PM Plan or schedule | Existing PM screens and their role gates. |

Back behavior: every destination is a stack push over the tab, so Back returns to the same Home, which re-reads on focus
(not on first focus). Work-order links carry a per-tap token so a repeated tap re-applies the filter.

### 12.4 Interaction matrix

Status key: **R** reused from an existing screen and tested there; **H** tested on the Home; **N** navigation-only, destination
covered by the route-existence contract (`homeRoutesExist.test.ts`); **U** unsupported (verified limitation).

| Control | Role | Destination | Mutates | Status |
|---------|------|-------------|---------|--------|
| Avatar | both | profile | no | H, N |
| Bell + unread | both | notifications (deep links to work orders and PM unchanged) | no | H, N, R (`NotificationDeepLink`) |
| Connection line | both | Engineering Sync | no | H, N, R (`EngineeringSync`) |
| My Jobs / Urgent / PM Due | tech | Work `mine` / `all`+urgent / PM list | no | H |
| Needs owner / In progress / On hold | chief | Work `available` / `team`+in_progress / `waiting` | no | H |
| Continue Repair, Open Job | tech | `work-orders/<id>` (safe path) | no | H, nav unit |
| Resume Inspection | tech | `pm-schedules/inspect/<id>` | no | H, R (`PmInspection`: restore, blocked draft) |
| View Available Work | tech | Work `available` | no | H |
| Attention row (work order / PM / blocked save) | tech | order / schedule / Engineering Sync | no | H |
| Attention "View all" | tech | expands in place | no | H |
| Chief priority row | chief | order / Room Status / PM schedule / asset (safe builders, list fallback) | no | H |
| Chief priority Assign | chief | `AssignTechnicianSheet` | assign (server) | H, R (`AssignTechnicianSheet`, `TeamOverview`) |
| Blocked saved inspections (chief) | chief | Engineering Sync | no | H (new) |
| Team workload row / View Team | chief | `team/<id>` / Team Overview | no | H |
| Rooms oversight / PM oversight | chief | Room Status / PM Plan | no | H |
| Report Issue | both | `work-orders/new` | create (server) | N, R (`ReportIssueScreen`: confirm, queue, photos, view) |
| Scan Asset | both | `assets/scan` | no | N, R (`AssetScan`) |
| Room Status | both | `room-status` | no | N, R (`RoomStatusList`, `RoomDetail`) |
| Assign Work / Team Overview / PM Planning / Assets | chief | Available Work / Team / PM Plan / Assets | no | H, N |
| Hold Repair | tech | `HoldSheet` on the order | hold (server) | R (`WorkOrderDetail`: reason required, note, labor pause, offline disabled) |
| Claim / Start / Resume / Complete | tech | the order's action bar | server transitions | R (`WorkOrderDetail`); not offered to a chief (tested) |
| Room Impact drawer | - | not built | - | U |
| Dedicated Attention screen | - | in-place list | - | replaced (section 5) |

### 12.5 Room impact

Home holds only the server's aggregate `rooms_down`; no per-room source exists in the overview, so the Room Impact drawer from
the prototype is **not shipped** and nothing is fabricated. The aggregate opens Room Status; a work order that names a room opens
Room Detail by its canonical id (`wo-open-room`, already tested). Three facts stay separate and are never inferred from each
other: a reported problem (work order), equipment downtime (asset), and the room's confirmed availability (Room Status). A
faulty asset does not mark a room out of order and a completed repair does not release a room.

### 12.6 Data refresh and reliability

- Technician Home: three reads (queue, summary, PM) plus local drafts; re-read on regaining focus, pull-to-refresh and one trailing
  read per 1.5 s `work_orders` realtime burst. Chief Home: the overview plus local saves, same triggers.
- Confirmed mutations are reconciled by re-reading, never by an optimistic count. Late answers for an old scope are dropped; a
  different person or property clears data first (tested).
- Duplicate submits: `mutate`/`guarded` ref guard on the order screen, `useSheetSubmit` on sheets, a ref guard on assignment,
  an idempotent request id on report creation, `isActionAlreadyQueued` for offline claim and completion.
- Sync honesty: blocked saves raise an attention row on both Homes; pending saves are counted on the connection line and block
  the all-clear; a destructive discard stays on the existing confirm flow in Engineering Sync.

### 12.7 Tests added

`homeNavigation.test.ts` (safe work-order paths, hostile ids fall back to the list), `homeRoutesExist.test.ts` (every Home
destination resolves to a screen file, and a missing screen is detected), `ChiefEngineerHome.test.tsx` (blocked saved inspection
row, opens Engineering Sync, withholds the all-clear; pending withholds it without a failure row), `EngineerHome.test.tsx`
(no clear Needs Attention while saves are pending), `WorkOrderDetail.test.tsx` (Back with and without history).

### 12.8 Not verified / handoff to Phase 5

- No emulator or device run in this phase; the sheets, back gesture and keyboard behavior are verified by the existing jest
  suites and by reading the shared `BottomSheet`, not on hardware.
- The prototype's Room Impact drawer and per-room rows need a per-room read (overview or room board) before they can ship.
- Journeys were checked at the unit and screen level with mocked API contracts; no live-API pass.
- Phase 5 scope (deeper sync, offline and notification states) can build on `countBlockedPmSync` and the shared Home notice row.

## 13. Phase 5 record: data contract, prioritization, performance and offline reliability

Phase 5 changed no screen layout. It made the numbers, ordering, refreshing and sync wording trustworthy. No backend
endpoint, migration or workflow was added or changed.

### 13.1 Defects found and fixed

| # | Defect (found by audit) | Fix |
|---|---|---|
| 1 | **My Jobs count and destination disagreed.** The count (open + escalated + in progress) excluded my on-hold work, but it opened `Work > My Work`, which also lists on-hold orders, so the list could be longer than the number. | `myJobsRoute` now opens My Work with `filter=actionable` (statuses open, escalated, in progress). `resolveWorkLink` accepts `actionable` only on the `mine` view. Parity is tested against `belongsToView` + `viewStatuses`. |
| 2 | **The Home sync line read the wrong store.** It counted `appStore.pendingActions` (the legacy list), not the SQLite sync queue that Engineering Sync shows, so queued claims, completions and reports, refused reports, claim conflicts and queued PM inspections were invisible on the line. | `useEngineeringSyncSummary` reads the same sources as Engineering Sync (`usePendingActions`, `usePmSyncItems`, `useClaimConflicts`, `useReportRecords`) and feeds `buildEngineeringSyncCounts`. |
| 3 | The line could say "Synced" while a queue could not be read, and had no state for "needs review". | New states `review` and `unverified` (see 13.5). The all-clear also needs every queue to be readable. |
| 4 | A kept exact summary could sit next to a newer queue after its own refresh failed. | A failed summary read now drops the exact count; My Jobs falls back to the queue and is a lower bound if the queue was cut off. |
| 5 | Three focus events cost three full reads (nine requests on the technician Home); focus + realtime together cost two reads; each Home duplicated the realtime code. | One `refreshGate` and one `useWorkOrderRealtime` shared by both Homes (see 13.4). |
| 6 | Equal-ranked records could swap places between refreshes (the server sorts attention by rank and due time only; ties kept DB order). | Explicit tie-breakers on both Homes (see 13.3). |
| 7 | After a person or hotel change, the in-memory `useAsyncResource` cache (team overview, technicians, asset reads) was left in memory. | `setUser` now calls `resetAsyncResourceCache()` in the same branch that clears rooms, tasks and saved work orders. |
| 8 | Nothing re-read when the app returned from the background or the connection came back while the Home tab stayed focused. | `useRefreshOnResume` (foreground = focus hint; offline to online = manual read), through the same gate. |

### 13.2 Canonical metric contract (`lib/engineering/homeContract.ts`)

`HOME_METRICS` is the typed registry of what each number means; `readMetric` / `formatMetric` turn a source answer into a
reading. Rules, all tested: unknown is "-" and never 0; a cut-off or partial read is a lower bound shown as `N+`; a figure kept
from before a failed refresh is flagged `stale`; malformed server counts (negative, fractional, NaN) are unknown.

| Metric | Role | Exact scope | Source | Destination | Unknown / offline |
|---|---|---|---|---|---|
| My Jobs | technician | assigned to me, status open / escalated / in progress (on hold, completed, cancelled excluded) | `GET /work-orders/summary` (`total - waiting`, exact); else the active queue page (exact only when not truncated) | Work > My Work, `filter=actionable` | unknown until a source answers; offline: last read or saved queue as a stale lower bound |
| Urgent | technician | emergency or urgent in any active status (open, escalated, in progress, on hold) that the person can read (own + unclaimed) | active queue page (the summary endpoint is own-work only, so it cannot supply this) | Work > All, `filter=urgent` | lower bound `N+` when cut off or saved |
| PM Due | technician | active schedules overdue or due today on the hotel calendar | `GET /assets/pm-schedules` | PM list | unknown until read; stale after a failed refresh; unknown after restart offline |
| Needs Owner | chief engineer | unassigned, open or escalated | `GET /engineering/team/overview` `counts.needs_owner` | Work > Available | `-` until the overview answers; `N+` when `truncated` |
| In Progress | chief engineer | assigned and in progress, hotel-wide | overview `counts.in_progress` | Work > Team, `filter=in_progress` | same |
| On Hold | chief engineer | on hold, assigned or not, hotel-wide | overview `counts.on_hold` | Work > Waiting | same |

Known limit: Chief In Progress opens the Team view, which excludes the viewer's own assignments. A chief engineer cannot hold
assignments in the current role model (no claim/start), so the two agree today. If that changes, add a `mine` leg first.

Freshness: the connection line shows the time of the last successful work-order (or overview) read, labelled offline or
stale when the latest read failed. The overview also carries `generated_at`.

### 13.3 Prioritization (pure, deterministic, explainable)

No LLM, no score, no invented signal. Guest impact, technician availability and "urgent unassigned" for the chief are NOT
supplied by the backend, so none is shown or ranked on.

Technician primary card (`homeFocus.ts`, unchanged order): continue repair, start next, resume PM draft, available work,
caught up. An in-progress job stays primary even when another emergency appears; the emergency is still the first row in
Needs Attention and nothing switches the active repair for the person.

Needs Attention (`homeModel.buildHomeModel`): one row per work order or PM schedule, most severe reason wins
(`emergency`, `sync_blocked`, `urgent_unassigned`, `past_due`, `pm_overdue`, `on_hold`). Inside a reason
(`compareForAttention`): priority, earliest due time (none or malformed last), oldest created first, then id. Overdue PM:
longest overdue first, then id. Identical for every input order (tested with 25 shuffles).

Chief priorities (`chiefHomeModel.buildPriorities`): emergency needing an owner, urgent overdue, escalated, confirmed rooms
down, on hold, overdue PM, repeated defects (the server's own attention kinds). Inside a kind (`comparePriorityItems`):
work orders by priority, due time (none last), number, id; PM by due time then id; repeat defects by count then asset id.
The server order is only the last resort. Duplicates are dropped by id. Every row's reason is its kind label; there is no
numeric score on screen.

### 13.4 Refresh, realtime and request budget

Every trigger goes through `lib/engineering/refreshGate.ts`:

- one read in flight; a caller that arrives meanwhile joins it;
- `realtime` while a read runs means the data changed after it started, so exactly one trailing read follows;
- `focus` is a hint: skipped while a read runs or when one started in the last 15 s (`FOCUS_FRESH_MS`);
- `manual` (pull-to-refresh, Retry, connection returned) always reads unless one is running.

`useWorkOrderRealtime` (shared) opens one channel `engineering-home-wo:<tenant>` filtered `tenant_id=eq.<tenant>`, coalesces a
burst (1.5 s trailing), reads `onChange` through a ref (no re-subscribe), and tears down the channel and any pending timer on
unmount or hotel change. A change this phone just had the server confirm (`emitWorkOrderMutated`, fired by
`createWorkOrder*`, `claimWorkOrder`, `completeWorkOrder`, `transitionWorkOrder` after the server answered) feeds the SAME
debounce, so the change and its realtime echo cost one read and the person sees their own change even if realtime lags.
A new hotel or person gets a new gate (it can never join a read started for the previous scope).

`useRefreshOnResume`: app foreground = `focus`; offline to online = `manual`. No polling anywhere.

Mutation reconciliation: nothing is counted optimistically. Claim, start, hold, resume, complete, report and assignment
re-read through the path above (assignment uses `onAssignmentChanged` into the same gate). A queued (offline) mutation shows
as waiting on the connection line and withholds the all-clear until the server confirms it.

### 13.5 Sync semantics on the Home line

`buildEngineeringSyncCounts` sums only things the server has NOT confirmed, from the same sources as Engineering Sync:

- waiting = queued work-order actions and reports (waiting / retrying) + PM inspections queued or being sent;
- needs review = refused or stuck actions + claim conflicts + refused reports + PM inspections needing review or rejected;
- saved drafts (work-order completion drafts, PM drafts) are unfinished work on the phone, not uploads, and are counted in
  neither number.

`resolveSyncStatus` order: Offline, Syncing (a read or a send is running), Needs review, read failure ("couldn't refresh"),
Pending sync, Status unavailable (a queue could not be read), Not synced yet, Up to date. "Up to date" therefore means: online,
a read succeeded, every queue was readable and empty, and nothing needs the person. Tapping the line opens Engineering Sync.
Nothing here retries, discards or overwrites: refused changes are never auto-discarded and conflicts are never resolved by
overwriting; those stay explicit actions in Engineering Sync.

### 13.6 Offline Home

- Technician Home, offline before anything was read: the last queue saved on this phone is shown (`homeSnapshotKey(role)`, saved
  after every successful read, most urgent first, capped at 60 by the existing `workOrderCache`, 72 h, this person + hotel
  only) as a stale lower bound (`N+`) with the "couldn't refresh" banner and "Offline, last synced X ago". It is never used
  for a server error, never replaces a live queue, and a copy that arrives after the person or hotel changed is dropped.
  The exact summary and PM are not cached, so they show unknown.
- Saved PM drafts stay resumable offline (existing).
- Chief Home: the in-session overview is kept and labelled; there is no persisted copy of management data, by design, so it is
  never on disk for a former chief.
- Offline-capable actions keep using the existing queue; actions that need the server are disabled by the existing screens.

### 13.7 Isolation

- Technician Home scope is `tenant:user:role`; a role change resets state. The saved queue key includes the role (what the
  server lets a role read differs).
- `setUser` clears rooms, tasks, saved work orders and now the in-memory engineering resource cache on a person or hotel change.
- The realtime channel is hotel-scoped and replaced on a hotel change; late events from the old channel are ignored.
- Manager data (team overview, technicians, assignment) is requested only when `canManageTeam`; the API enforces the same.
  Home never trusts the client role alone: detail screens and every mutation still go through the server's guards.

### 13.8 Partial failure

Sections are independent: queue, PM, summary, overview parts (`rooms_down`, `pm_oversight` null = unavailable), sync queues.
The all-clear needs queue read, PM read, drafts read, nothing truncated, every sync queue readable and empty. A failed section
keeps its last good data (labelled) and reports its own failure with its own Retry.

### 13.9 Performance measurement

Tool: `__tests__/perf/engineeringHomeRequests.test.tsx` (counts API reads per scenario, mocked network, no timings, safe in CI;
run `npx jest __tests__/perf/engineeringHomeRequests.test.tsx --runInBand` and read the table). Baseline was measured on this
branch at Phase 4 (head 4f805d94) with the same scenarios before any Phase 5 code.

| Scenario | Technician before (work/PM/summary) | Technician after | Chief before (overview) | Chief after |
|---|---|---|---|---|
| Initial open | 1 / 1 / 1 | 1 / 1 / 1 | 1 | 1 |
| 10 realtime events in one burst | 1 / 1 / 1 | 1 / 1 / 1 | 1 | 1 |
| 3 focus events within 1 s | 3 / 3 / 3 | 0 / 0 / 0 | 3 | 0 |
| Focus + realtime together | 2 / 2 / 2 | 1 / 1 / 1 | 2 | 1 |
| Local confirmed change + realtime echo | n/a (not coalesced) | 1 / 1 / 1 | n/a | 1 |

"Work" is one `listActiveWorkOrders` call, which is itself one HTTP request per 100-row page (up to 5). Reads per initial open
are unchanged by design: the technician Home still needs the active queue (Urgent covers unclaimed work, which no existing
summary endpoint counts), PM and the own-work summary. A single aggregate Home endpoint was considered and NOT added: the
demonstrated problem was duplicate reads, not the three parallel ones, and a new endpoint would be a second competing
summary system.

Not measured (no harness available here): payload bytes, time to meaningful data on a device, scroll frame rate, memory over
repeated navigation. To measure on a device: open Home with the React Native performance monitor, reload 10 times with
`Network inspector` on, and compare bytes/requests with this table; for memory use Android Studio / Xcode Instruments while
switching tabs 50 times. No timing numbers are claimed.

### 13.10 Tests added or changed

`homeReliability.test.ts` (40: metric rules, count/destination parity for My Jobs, Urgent and the three chief counts, order
determinism under shuffles, hotel midnight and DST in three device time zones, sync summary and status order, refresh gate),
`useEngineeringHome.test.tsx` (scope switch, late answers, independent failures, summary drop, join + trailing read, focus
freshness, offline saved queue, role-keyed copy, late saved copy dropped), `useWorkOrderRealtime.test.tsx` (one hotel-scoped
channel, no re-subscribe, burst coalescing, unmount and hotel change, local change shares the debounce),
`useRefreshOnResume.test.tsx`, `engineeringHomeRequests.test.tsx` (request budget), plus screen tests for review/unverified
status, lower-bound and unknown cards and the chief equivalents. Updated: My Jobs route expectation, focus-freshness
expectations, the pending-count mocks (now the sync summary).

### 13.11 Not verified / Phase 6 handoff

- No emulator or device run in this phase. Backend untouched, so API suites were not re-run for new behavior.
- The Technician Home still reads three sources on open; an aggregate endpoint is the next lever only if a device
  measurement shows it matters.
- Chief In Progress / Team parity assumes a chief never holds assignments (13.2).
- The Room Impact drawer still needs a per-room read (unchanged from Phase 4).
- Remaining UI polish and accessibility passes (dynamic type, small screens, EN/ES long names) are Phase 6.

## 14. Phase 6 record: UI polish, accessibility and visual consistency

Phase 6 changed presentation and interaction quality only. No backend endpoint, migration, workflow, permission or business
rule changed. No sheet shared with Housekeeping, Front Desk or GM was modified.

### 14.1 UI/UX audit (each issue was confirmed in code before it was fixed)

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | `HOME_MAX_FONT` capped every Home text at 1.4x, so people using large system text were held below their setting. | Accessibility | Ceiling raised to 2.0. Every text block now wraps and grows instead of clipping (see 14.3). |
| 2 | Summary cards announced "unavailable" while the first read was still running, and showed a bare "-". Loading was indistinguishable from failure. | Truthfulness | `SummaryCardData.loading`: a fixed-size placeholder, announced as "loading" and `busy`. "Unavailable" is now only said after a read failed or is unknown. |
| 3 | Urgency on the Urgent card was a red number only. | Accessibility (color only) | An alert icon sits beside the number when urgent work exists; the number and label already carry the count. |
| 4 | Profile and notification buttons in the header were 44dp; the Property Priorities Assign button was 44dp. | Touch target | Raised to 48dp (`HOME_MIN_TOUCH`). The sync line is 32dp high with an 8dp hit slop. |
| 5 | Technician Needs Attention rows clipped the heading to one line and the title to two, and told hot from routine by bar color only. | Scanability | Heading and title wrap fully. A leading icon (alert for emergency, unassigned-urgent, PM overdue and blocked saves; clock for past-due and on-hold) matches the bar color. |
| 6 | Chief Property Priorities rows clipped heading, title and meta. | Scanability | Caps removed; the existing per-kind icon is now hidden from screen readers (the row label already says it). |
| 7 | Quick-action labels and workload names were capped at one or two lines. | Large text | Quick-action labels wrap freely; workload names allow two lines. |
| 8 | The greeting fell back to a hard-coded English "there", also in Spanish. | Localization | New key `home.engineer.fallbackName` (EN "there", ES "equipo"). |
| 9 | A double tap on a Home card pushed the destination twice. | Navigation | `useHomeNavigate` ignores a repeat of the same destination (path and params, ignoring the per-tap `nav` stamp) for 700 ms. Different destinations, including different filters on Work, are never blocked. |
| 10 | Decorative chevrons and icons were reachable by screen readers. | Accessibility | `accessibilityElementsHidden` + `importantForAccessibility="no"` on decorative icons. Rows already expose one label. |

Checked and left unchanged, with the reason:

- **Contrast.** Computed WCAG ratios for the token pairs Home uses. Light: muted text 5.93 on surface, 5.36 on the page;
  urgent red 6.30 / 5.70; amber 6.42; green action 4.86; header secondary text 5.27 on the shell. Dark: muted text 6.04 /
  6.45; red 7.60; green action 6.78; amber 9.66; header secondary text 5.85. All are at or above 4.5:1 for text, so no color
  token changed.
- **Reduced motion.** Home has no animation of its own. `BottomSheet` already uses `useReducedMotion` (no slide when reduced).
- **Floating assistant.** `lib/ai/fab.ts` shows the button for the `housekeeper` role only, so it never appears on either
  Engineering Home, over the tab bar, or over engineering sticky actions. No change; no second assistant was built.
- **Sheets** (Assign, Hold, Report, PM, Room Impact, filters) share `BottomSheet`: safe-area padding, keyboard avoidance on
  iOS, Android back via `onRequestClose`, backdrop and 44dp close (60dp with hit slop), screen-reader focus on the title,
  scrolling body with a pinned footer, title font capped at 1.6. They were not rebuilt.
- **Tab bar.** Still exactly Home, Work, PM, Assets, More; untouched.

### 14.2 Shared visual language

Both Homes use the same parts and tokens: `TechnicianHomeHeader`, `TechnicianSummaryCards`, `TechnicianQuickActions`,
`HomeLoadNotice`, `HomeConnectionStatus`, `Card`, `Button`, `StatusBadge`, and `homeStyles` (`HOME_MIN_TOUCH` 48,
`HOME_MAX_FONT` 2). Radii are `R.sm/md/lg`; colors come from `useTheme()` only. No one-off color or second design system was
added. The layouts stay different: the technician screen leads with one contextual primary card; the chief screen leads
with Property Priorities.

### 14.3 Dynamic text and responsive rules

- No Home text block has a line cap that can hide meaning. Rows and cards use `minHeight`, never a fixed height.
- Summary cards share the row equally (`flex: 1`), labels wrap, and the value placeholder keeps the card from jumping
  when the number arrives.
- Header title and hotel name wrap to two lines; the role line stays one line (a short constant label).
- Quick actions are a two-column wrapping grid (`flexBasis: 47%`); labels wrap.
- Everything lives in one vertical `ScrollView`, so a primary action is always reachable by scrolling. There is no
  horizontal scrolling on Home.

### 14.4 Loading, error and offline presentation

First load: cards show placeholders (announced "loading"), then a single `StateBlock` below. A failed section reports itself
with its own retry (`HomeLoadNotice` / `StaleBanner`) and the rest of Home keeps its data. A failed read is never rendered
as "nothing to do" and a queued action is never worded as done (unchanged from Phases 4 and 5).

### 14.5 Localization

All new strings are keyed in `en.json` and `es.json` (`home.engineer.loadingCount`, `home.engineer.fallbackName`).
`homeNavigate.test.ts` asserts EN and ES have identical key sets under `home.engineer` and `home.chief`, and that both new
strings differ between languages. Long Spanish labels wrap by 14.3.

### 14.6 Tests

New: `__tests__/lib/engineering/homeNavigate.test.ts` (8: route identity, double-tap lock, different destination never
blocked, lock expiry, EN/ES parity). Added to `EngineerHome.test.tsx`: 48dp header controls; loading placeholder instead of
zero. Changed (behavior intentionally changed, assertions not loosened): the chief test that pinned a 1.4 cap now requires
at least 1.6 and a 48dp Assign button; the loading-state card tests expect "loading" instead of "unavailable" (and still
forbid a zero), while failed reads still expect "unavailable".

Results (local, Windows, in this worktree): `tsc --noEmit` clean; `npm run lint` clean; `git diff --check` clean; full
mobile Jest 459 suites / 10449 tests passed.

### 14.7 Visual QA matrix

No emulator, simulator or physical device was available in this phase (no `adb`, no Xcode), so **no screenshot was taken and
no on-device check was done**. Everything below marked "component test" ran in Jest with the React Native test renderer,
which does not lay out text or measure real pixels.

| Screen / drawer | Device / viewport | Theme | Language | State | Method | Result | Remaining |
|---|---|---|---|---|---|---|---|
| Technician Home | none | both (token math only) | EN, ES (key parity) | loading | component test | placeholder + "loading" label, no zero | not seen on screen |
| Technician Home | none | both | EN | normal, error, offline, stale | component test (existing + Phase 6) | passes | not seen on screen |
| Technician Home header | none | n/a | EN | normal | component test | controls 48dp | not seen on screen |
| Chief Home | none | both | EN | normal, loading, failed, all-clear | component test | passes | not seen on screen |
| Property Priorities / Assign | none | n/a | EN | normal | component test | Assign 48dp | not seen on screen |
| Home taps | none | n/a | n/a | double tap | unit test | one push per destination | real stack not exercised |
| Text color pairs | n/a | light + dark | n/a | n/a | computed WCAG ratio | all at or above 4.86:1 | none |
| Large text (2x), small phones, landscape | none | none | none | none | not run | unverified | needs a device pass |
| Connected sheets (Hold, Report, Assign, PM, Room Impact, scan) | none | none | none | none | code audit only | shared `BottomSheet` conventions confirmed | keyboard and Android back not exercised on device |
| Dark-mode sheet rendering | none | dark | none | none | not run | unverified | needs a device pass |

### 14.8 Phase 7 handoff

- A device pass is the biggest gap: large text (1.5x to 2x), a small Android phone, keyboard-open forms, Android hardware
  back from each sheet, dark mode, and Spanish long labels. Nothing in sections 14.3 or 14.7 has been seen on screen.
- Room Impact from Home still needs a per-room read (unchanged since Phase 4); only the aggregate is shown.
- The navigation lock is 700 ms and lives in Home only; Work, PM and Assets screens do not share it.
- Staging did not appear in the PR checks for this `feat/*` branch in earlier phases; re-check live before claiming
  readiness.
