# Engineering Home V2

Mobile redesign of the Engineering Home for the two engineering roles. One branch (`feat/mobile-engineering-home-v2`),
one draft PR, one commit per phase. The repository is the authority for behavior, permissions and contracts; the
interactive prototype (`patelrep-engineering-home-interactive.html`, supplied separately and not committed) is a visual
and interaction reference only. Its fictional hotel, people, counts, work orders and PM records are never shipped.

Status: **Phases 1 and 2 of 8 are implemented** (Phase 1: foundation, navigation contract, role correctness; Phase 2: the
complete Technician Home). Phases 3-8 are scope, not code.

## 1. Eight-phase scope

| # | Phase | Delivers |
|---|-------|----------|
| 1 | Foundation, architecture, correctness | Navigation contract, `all` Work view, scanner shortcut, role-correct Home actions, this document, tests |
| 2 | Technician Home (**done**) | Compact header, three exact/honest counts, contextual primary card (continue / start next / resume PM / available / caught up), Needs Attention with an in-place full list, four shortcuts, single-request queue, tests |
| 3 | Chief Engineer Home | Management layout: Needs Owner / In Progress / On Hold, property priorities, workload, PM oversight |
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

Target (Phase 3/4): property header; Needs Owner / In Progress / On Hold from the team overview; property-level
emergencies; room-down information where available; overdue PM oversight; technician workload; entry points to Assign
Work, Team Overview, PM Planning and Assets; notifications, sync, profile.

Never offered to a chief engineer: claim, start/pause/hold/escalate/complete a work order, My Jobs, Continue Repair
(API guards in `apps/api/routers/work_orders.py` are `engineer` + `gm` only).

Phase 2 interim (shared screen, permission-safe): a chief engineer gets the same header, Urgent and PM Due cards, Needs
Attention and shortcuts, but no My Jobs card, no primary card (`resolveFocus` returns `none` when the role cannot act
on work orders) and no Available Work shortcut (PM instead). Urgent is hotel-wide. The management layout replaces this in Phase 3.

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
| Chief dashboard cards (workload, PM oversight, room-down) | pieces exist (`useTeamOverview`, `managerSummary`, room board) | composition in Phase 5/6 |

## 7. Canonical data sources

| Displayed value | Source |
|-----------------|--------|
| My Jobs | Exact: `GET /work-orders/summary` (`total - waiting`: the caller's own active work excluding on hold, counted on the server). If that request fails, the deduplicated queue's own count, shown as `N+` when the queue was cut off. The My Work screen reads the same endpoint. |
| Urgent | Deduplicated active queue, priority emergency or urgent, any active status. No server count exists for the role-scoped "own + unclaimed" set, so this is exact unless the queue was cut off (then `N+`). |
| PM Due | `listPmSchedules`, active schedules overdue or due today in hotel time (`pmSchedules.adaptPmSchedules`) |
| Primary card | Same queue + PM + saved drafts (`usePmSyncItems`), `homeFocus.resolveFocus` |
| Attention list | Same queue + overdue PM + blocked saved inspections (`needsPerson` states); one entry per order/schedule, most severe reason wins; the primary card's order is not repeated |
| Chief: Needs Owner / In Progress / On Hold | `GET /engineering/team/overview` counts (`managerSummary`) - Phase 3 |
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

Component ownership: `lib/engineering/homeFocus.ts` (primary-card state machine), `homeModel.ts` (counts, attention, connection
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

Not done / deferred: Chief Engineer management layout (Phase 3); a server-side exact Urgent count (would need a new endpoint
scoped to own + unclaimed work; today it is exact unless the queue is cut off); device/emulator run (not performed in this phase).
