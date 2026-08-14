---
phase: 31-shell-navigation-redesign
plan: 02
subsystem: ui
tags: [nextjs, react, react-query, i18n, tailwind, notifications]

requires:
  - phase: 31-shell-navigation-redesign
    provides: "declaration-only redesigned? prop on Header (31-01), plus the shellV2 flag threading and v2 token aliases (z-header, duration-fast, brand, focus-ring) already established by Sidebar.tsx in 31-01"
provides:
  - "Client-only Unread/All notification history toggle on the header bell, re-querying the existing GET /notifications?is_read=... endpoint (no backend change)"
  - "Badge query permanently decoupled from the panel list query (queryKey ['notifications','unread'] vs ['notifications', tab]) so the unread count never reflects the currently-viewed tab"
  - "Notification panel i18n'd (title, mark-all-read, empty state, two new tab labels) in both en.ts and es.ts; timestamp now respects the active i18n language"
  - "Header v2 token restyle (z-header, duration-fast, brand/focus-ring on search+bell+user-menu) gated by the redesigned prop; legacy branch byte-equivalent when off"
affects: [31-05-nav-group-coverage-test, 31-06-shell-live-verification]

tech-stack:
  added: []
  patterns:
    - "React Query prefix invalidation (queryClient.invalidateQueries({ queryKey: ['notifications'] })) to refresh both the badge query and whichever tab's list query is active in one call, instead of tracking/invalidating each key individually"
    - "Tab-parameterized queryKey (['notifications', tab]) intentionally collides with the badge's own key when tab === 'unread', letting React Query share that cache entry rather than double-fetching"

key-files:
  created: []
  modified:
    - apps/web/components/shared/Header.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Read (already-seen) rows in the All tab keep the same DOM slot for the leading dot but render it bg-transparent instead of omitting it, so unread vs read rows don't shift horizontally -- simpler than conditional structural rendering"
  - "Only one new empty-state key (header.noNotifications) covers both tabs rather than two tab-specific empty strings, since the plan only specified one and the generic phrasing reads fine for both 'no unread' and 'no history yet'"
  - "v2 restyle scope followed the plan's explicit list literally (search box, bell, user-menu buttons) rather than extending focus-visible rings to the hamburger menu or LanguageToggle, keeping the change minimal and matching Sidebar's established alias-over-raw-var(...) pattern (duration-fast, z-header) instead of arbitrary-value classes"

patterns-established:
  - "Same alias-preferring approach as 31-01's Sidebar: use tailwind.config.ts's registered aliases (z-header, duration-fast) over raw arbitrary-value classes (z-[var(--z-header)], duration-[var(--motion-fast)]) wherever an alias already exists; fall back to ring-[var(--focus-ring)] only because no focus-ring alias is registered"

duration: ~20min
completed: 2026-08-14
---

# Phase 31 Plan 02: Header Notification Toggle + v2 Restyle Summary

**Client-only Unread/All notification history toggle against the existing GET /notifications endpoint, full i18n cleanup of the notification panel (both locales), a locale-aware timestamp fix, and the Header's v2 token restyle gated by the `redesigned` prop**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-14T17:58:16Z
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments
- Header notification panel now has an Unread/All tab toggle; All re-queries the same `GET /notifications` endpoint with `is_read=true`, which the backend already treats as "return full read+unread history" (tenant + user scoped, `apps/api/routers/notifications.py` untouched)
- Badge count is sourced from its own permanently unread-only query (`['notifications','unread']`), completely decoupled from whichever tab (`['notifications', tab]`) the panel is currently showing, so the bell badge never flickers to a stale/tab-dependent count
- `handleMarkAllRead`/`handleMarkRead` now invalidate the `['notifications']` query prefix, refreshing both the badge and the active list query in one call
- Read rows in the All tab render with a muted (`text-ink3`, `font-normal`) title and a transparent leading dot, visually distinct from unread rows without a layout shift
- Replaced 3 hardcoded English literals (`Notifications`, `Mark all read`, `No new notifications`/`No notifications`) with i18n keys and added 2 new tab-label keys (`notificationsUnread`, `notificationsAll`) to both `en.ts` and `es.ts` with real Spanish values — `check:i18n-parity` green
- Fixed the notification timestamp's hardcoded `en-US` locale to switch to `es-US` under the Spanish locale, matching the existing date/shift formatting pattern already in the file
- Header now renders v2 tokens (`z-header`, `duration-fast`, `--brand`/`--focus-ring` on the search box, bell, and user-menu buttons) only when `redesigned` is true; the legacy branch is unchanged when the flag is off. AI copilot chrome (`--ai-*`) and the sign-out `text-alert`/`--alert-soft` tokens were left untouched per the plan's explicit exclusion

## Task Commits

Each task was committed atomically:

1. **Task 1: Notification Unread/All history toggle + i18n string cleanup + locale timestamp fix** - `de28c4dd` (feat)
2. **Task 2: Header v2 token restyle, gated by the redesigned prop** - `ecd9c091` (feat)

## Files Created/Modified
- `apps/web/components/shared/Header.tsx` - tab state + split badge/list queries, i18n'd panel strings, locale-aware timestamp, v2 token restyle gated by `redesigned`
- `apps/web/i18n/locales/en.ts` - added `header.markAllRead`, `header.noNotifications`, `header.notificationsUnread`, `header.notificationsAll`
- `apps/web/i18n/locales/es.ts` - added the same 4 keys with Spanish values

## Decisions Made
See `key-decisions` in frontmatter above (dot-slot vs conditional rendering for read/unread rows, single shared empty-state key, and literal scope-following for the v2 restyle's focus-ring targets).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required; no backend changes were made.

## Next Phase Readiness
- `Header.tsx`'s `redesigned` prop is now fully consumed (declaration + real restyle), matching the pattern `Sidebar.tsx` established in 31-01; `CommandPalette.tsx`'s equivalent declaration-only prop remains for Plan 31-04 to consume.
- `check:frozen-files`, `check:contrast`, and `check:i18n-parity` all green after both tasks; no frozen-file drift, no new AA contrast failures, no locale-key gaps.
- No blockers for 31-04, 31-05, or 31-06.

---
*Phase: 31-shell-navigation-redesign*
*Completed: 2026-08-14*

## Self-Check: PASSED

All 3 claimed key-files exist on disk (`apps/web/components/shared/Header.tsx`, `apps/web/i18n/locales/en.ts`, `apps/web/i18n/locales/es.ts`); both task commit hashes (`de28c4dd`, `ecd9c091`) confirmed present in `git log --oneline --all`.
