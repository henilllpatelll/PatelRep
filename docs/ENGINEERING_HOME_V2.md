# Engineering Home V2

Mobile redesign of the Engineering Home for the two engineering roles. One branch (`feat/mobile-engineering-home-v2`),
one draft PR, one commit per phase. The repository is the authority for behavior, permissions and contracts; the
interactive prototype (`patelrep-engineering-home-interactive.html`, supplied separately and not committed) is a visual
and interaction reference only. Its fictional hotel, people, counts, work orders and PM records are never shipped.

Status: **Phases 1-3 of 8 are implemented** (Phase 1: foundation, navigation contract, role correctness; Phase 2: the
complete Technician Home; Phase 3: the Chief Engineer command center). Phases 4-8 are scope, not code.

## 1. Eight-phase scope

| # | Phase | Delivers |
|---|-------|----------|
| 1 | Foundation, architecture, correctness | Navigation contract, `all` Work view, scanner shortcut, role-correct Home actions, this document, tests |
| 2 | Technician Home (**done**) | Compact header, three exact/honest counts, contextual primary card (continue / start next / resume PM / available / caught up), Needs Attention with an in-place full list, four shortcuts, single-request queue, tests |
| 3 | Chief Engineer Home (**done**) | Management layout: Needs owner / In progress / On hold, Property Priorities with in-place Assign, team workload, room/PM oversight, four shortcuts, one overview read, tests |
| 4 | Manager entry points | Assign Work, Team Overview, PM Planning, Assets entry points; room-down summary |
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
