# Engineering Home V2

Mobile redesign of the Engineering Home for the two engineering roles. One branch (`feat/mobile-engineering-home-v2`),
one draft PR, one commit per phase. The repository is the authority for behavior, permissions and contracts; the
interactive prototype (`patelrep-engineering-home-interactive.html`, supplied separately and not committed) is a visual
and interaction reference only. Its fictional hotel, people, counts, work orders and PM records are never shipped.

Status: **Phase 1 of 8 (foundation, architecture, correctness) is implemented.** Phases 2-8 are scope, not code.

## 1. Eight-phase scope

| # | Phase | Delivers |
|---|-------|----------|
| 1 | Foundation, architecture, correctness | Navigation contract, `all` Work view, scanner shortcut, role-correct Home actions, this document, tests |
| 2 | Technician Home layout | Compact header, hotel identity, metric row, Continue / Start Next card on the shared UI kit |
| 3 | Technician contextual actions | Resume PM inspection draft, attention items with the right next action, Report / Scan / Room / Available Work shortcuts |
| 4 | Sync, connectivity, notifications | Accurate sync/offline/stale states, pending-action visibility, notification entry points |
| 5 | Chief Engineer Home | Management layout: Needs Owner / In Progress / On Hold, property priorities, workload, PM oversight |
| 6 | Manager entry points | Assign Work, Team Overview, PM Planning, Assets entry points; room-down summary |
| 7 | Prototype gap closure | Only the genuine gaps in section 6 that the owner approves |
| 8 | Integration and hardening | Accessibility pass, i18n parity, device QA, final acceptance (section 9) |

Phase boundaries beyond Phase 1 are a proposal; the owner confirms each phase before it starts.

## 2. Technician Home (role `engineer`)

Top to bottom:

1. **Header** - avatar (profile), notifications bell with unread count, greeting, hotel name, sync line (opens Engineering Sync).
2. **Metrics** - My Jobs, Urgent, PM Due (section 5 for sources).
3. **Continue Repair / Start Next Job** - the person's own in-progress job (most severe first); "+N more in progress" opens My Work.
4. **Needs attention** - up to five items, most severe first, then one overflow link per kind that was cut.
5. **Quick actions** - Report Issue, Find Room, Scan Asset, PM; plus a "Find asset by name" fallback link.

Resume PM Inspection (eligible local draft) and the Available Work shortcut are Phase 3.

## 3. Chief Engineer Home (role `chief_engineer`)

Target (Phase 5/6): property header; Needs Owner / In Progress / On Hold from the team overview; property-level
emergencies; room-down information where available; overdue PM oversight; technician workload; entry points to Assign
Work, Team Overview, PM Planning and Assets; notifications, sync, profile.

Never offered to a chief engineer: claim, start/pause/hold/escalate/complete a work order, My Jobs, Continue Repair
(API guards in `apps/api/routers/work_orders.py` are `engineer` + `gm` only).

Phase 1 interim (shared screen, role-corrected): the My Jobs card and the technician "no active job / View work" card
are not shown; Urgent is hotel-wide; the job action reads "View order". The manager layout replaces this in Phase 5.

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
| Continue Repair / View order | `/(app)/work-orders/<id>` |
| "+N more in progress" | `?view=mine` |
| Attention row - work order | `/(app)/work-orders/<id>` |
| Attention row - PM | `/(app)/pm-schedules/<id>` |
| Attention overflow - work orders | `?view=all` (all active work; the label says "open Work", not an equal count) |
| Attention overflow - PM | `/(app)/pm-schedules` |
| Report Issue | `/(app)/work-orders/new` |
| Find Room | `/(app)/room-status` |
| Scan Asset | `/(app)/assets/scan` (the one existing scanner; it has manual code entry and cached-copy handling) |
| Find asset by name | `/(app)/assets` |
| Sync line | `/(app)/engineering-sync` |
| Bell / avatar | `/(app)/notifications`, `/(app)/profile` |

Notes:

- `all` is a new Work view: every active status, no ownership narrowing. It is link-only (no tab, no shortcut) and shows
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
| My Jobs | `listAllWorkOrders` per active status (`GET /work-orders`), assigned to me, status open/escalated/in_progress (`homeModel.buildHomeModel`) |
| Urgent | same deduplicated queue, priority emergency or urgent, any active status |
| PM Due | `listPmSchedules`, active schedules overdue or due today in hotel time (`pmSchedules.adaptPmSchedules`) |
| Continue card | own most-severe in-progress order from the same queue |
| Attention list | same queue + overdue PM; one entry per order/schedule, most severe reason wins |
| Chief: Needs Owner / In Progress / On Hold | `GET /engineering/team/overview` counts (`managerSummary`) - Phase 5 |
| Sync line | `resolveSyncStatus`: online flag, pending queue, last successful load |

## 8. States

- **Loading** - metrics read "-" (never 0); queue area shows the shared loading state.
- **Empty** - "no active job" (technician only) and "nothing needs attention" appear only when both sources loaded.
- **Error** - the failed section shows its own error with Retry; a failed queue never reads as "all clear". PM failure keeps the queue and shows a PM-specific retry row.
- **Offline** - sync line says offline (with last sync); cached data stays visible; shortcuts still navigate and their destinations show their own offline state.
- **Stale** - a failed refresh with prior data shows the stale banner; counts that may be partial show `N+`.
- **Isolation** - the Home data hook is keyed by `tenant_id:user_id`; a scope change clears all data before the next render, and late answers for an old scope are dropped.

## 9. Ownership, accessibility, acceptance

Component ownership: `lib/engineering/homeModel.ts` (counts, ordering, sync), `homeNavigation.ts` (links),
`useEngineeringHome.ts` (data), `components/engineering/EngineerHome.tsx` (view). Phase 2+ extracts role view models
and presentational pieces from `EngineerHome.tsx` while keeping the model/navigation files as the single source.

Accessibility: every control is a button with a role and an accessible name that includes its value; touch targets at
least 48dp (links at least 40dp); `maxFontSizeMultiplier` capped; sync line is a polite live region; sections use header roles.

Final acceptance (Phase 8): both role homes match section 2/3; every control in section 5 lands where its count says;
no technician-only action reachable by a chief engineer; all states in section 8 verified; `en`/`es` keys at parity;
type-check, lint and mobile tests green; device run on Android and iOS recorded honestly; deep links and notifications
from PRs #190, #191, #195 unchanged; one PR, human merge.
