---
phase: 31-shell-navigation-redesign
plan: 04
subsystem: ui
tags: [react-query, command-palette, rbac, i18n, next.js, radix-ui]

requires:
  - phase: 31-01
    provides: "redesigned prop threading (Sidebar/Header/CommandPalette), shellV2 flag"
  - phase: 31-02
    provides: "v2 restyle pattern (z-* alias + duration-fast/ease-standard + --focus-ring)"
  - phase: 31-03
    provides: "listWorkOrders({q})/listRequests({q}) endpoints, ?focus=<id> deep-link scaffolding on work-orders/guest-requests/sop pages"
provides:
  - "Grouped, role-gated record search in CommandPalette across rooms/work orders/guest requests/SOPs"
  - "Each result navigates to its record's existing detail surface (?room=, ?focus=)"
  - "Palette v2 restyle (z-modal, --focus-ring, duration-fast/ease-standard) gated by redesigned prop"
affects: [31-06]

tech-stack:
  added: []
  patterns:
    - "Per-entity useQuery gated by getAllowedHrefs(...).includes(route) + enabled flag, so a role never fires a network call for an entity it can't reach"
    - "Debounced (250ms) search term, min length 2, applied uniformly across all record groups"
    - "Client-side full-list caching for small/unpaginated entities (rooms, SOPs) vs server q-param search for paginated entities (work orders, guest requests)"

key-files:
  created: []
  modified:
    - apps/web/components/shared/CommandPalette.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Result ordering for Enter-selects-first: nav matches, then rooms, then work orders, then guest requests, then SOPs"
  - "Primary/secondary line convention: rooms show 'Room {number}' / status; work orders show 'WO #{number}' / title; guest requests show 'Request #{number}' / title; SOPs show title / category"
  - "Rooms/SOPs fetched once per palette-open session (staleTime 60s, cached, no q param) then substring-filtered client-side on every keystroke; work orders/guest requests re-fetch via the debounced q param, capped per_page=5"
  - "showRecords (trimmed query length >= 2) gates the record groups' *display* and the WO/guest network queries directly; rooms/SOPs queries are enabled by role+open only (fetch-once semantics), independent of query length"
  - "Restyle uses the Tailwind z-modal/duration-fast/ease-standard aliases (not raw var(...)) matching the alias-over-raw-var convention established in 31-01/31-02, plus --focus-ring as an arbitrary value (no alias exists for it) matching Header.tsx"

patterns-established:
  - "PaletteResultRow: shared row renderer taking {item, onSelect, redesigned} used by both the nav group and all four record groups, so restyle only needed one focus-ring change site"

duration: ~55min
completed: 2026-08-14
---

# Phase 31 Plan 04: Command Palette Record Search + v2 Restyle Summary

**Command palette extended from nav-only filtering to grouped, role-gated record search across rooms/work orders/guest requests/SOPs (rooms+SOPs client-filtered, WO+guests via the 31-03 `q` param), each result deep-linking to its record screen, plus a `redesigned`-gated v2 token restyle.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2
- **Files modified:** 3 (`CommandPalette.tsx`, `en.ts`, `es.ts`)

## Accomplishments
- Palette now returns four additional result groups (Rooms, Work Orders, Guest Requests, SOPs) below the existing nav-jump group, each gated behind `getAllowedHrefs` so a role that can't reach a route never even fires the network call for it (rooms/guests use `enabled: open && <allowed>`; work orders/guests additionally require `showRecords`).
- Each result navigates to the record's real detail surface: `/housekeeping?room=<id>` (existing frozen deep-link, reused read-only — zero edits to `RoomStatusBoard.tsx`), `/engineering/work-orders?focus=<id>`, `/guest-requests?focus=<id>`, `/sop?focus=<id>` (all three `?focus=` targets confirmed already wired by 31-03).
- Discovered and fixed a stale local dev environment issue while spot-checking: the API dev server on `:8003` (and an orphaned `multiprocessing.spawn` child holding the same port after a partial `taskkill`) was serving code from before 31-03's `q`-param commit — confirmed via `GET /openapi.json` showing zero `q` parameter on `/v1/work-orders` and `/v1/guest-requests`. Killed both the stale parent and its orphaned child, restarted a fresh single-process `uvicorn`, and re-confirmed `q` is now present on both endpoints' schemas.
- Palette restyle (Task 2): overlay/content z-index migrated from hardcoded `z-[80]`/`z-[81]` to the `--z-*` scale via the `z-modal` Tailwind alias (matching 31-01/31-02's alias-over-raw-`var()` convention) only when `redesigned`; input, close button, and every result row get `focus-visible:ring-[var(--focus-ring)]` plus `duration-fast`/`ease-standard` transitions when `redesigned`; legacy (flag off) classes byte-equivalent to before.

## Task Commits

1. **Task 1: Grouped, role-gated record search (NAV-04)** - `6e308a11` (feat)
2. **Task 2: Command palette v2 token restyle** - `24ff6351` (feat)

## Files Created/Modified
- `apps/web/components/shared/CommandPalette.tsx` - Extended with 4 role-gated `useQuery` entity searches, grouped/ordered result rendering, `PaletteResultRow` shared row component, and the `redesigned`-gated v2 restyle
- `apps/web/i18n/locales/en.ts` - New `palette.*` block (`groupNav`, `groupRooms`, `groupWorkOrders`, `groupGuests`, `groupSops`, `searching`, `noResults`)
- `apps/web/i18n/locales/es.ts` - Matching `palette.*` block with real Spanish values

## Decisions Made
- Added an extra `palette.groupNav` ("Go to" / "Ir a") header, one key beyond the plan's literal list, so the nav-jump group reads clearly once four more group headers are visible below it — low-risk additive UX clarity, not called out by the plan but consistent with its own header-per-group instruction for the other four groups.
- See `key-decisions` in frontmatter for the ordering, fetch-strategy, and restyle-token decisions.

## Deviations from Plan

None from the plan's own text — both tasks implemented exactly as specified (role gating via `getAllowedHrefs`, client-side rooms/SOP filtering, server `q` for WO/guests, `?room=`/`?focus=` navigation, v2 restyle gated by `redesigned`, z-index on the `--z-*` scale, `--focus-ring` on input/buttons, status tokens untouched).

One out-of-band environment fix (Rule 3, blocking — required to get a truthful live signal, not a plan change):

**1. [Rule 3 - Blocking] Stale local API dev server was serving pre-31-03 code**
- **Found during:** Post-Task-2 live spot-check requested by the team lead (verifying 31-03's `q` param end-to-end)
- **Issue:** `uvicorn --reload` on `:8003` (PID 27000) plus an orphaned `multiprocessing.spawn` child (PID 28424, `parent_pid=27000`) were still holding the port and serving an OpenAPI schema with zero `q` parameter on `/v1/work-orders` and `/v1/guest-requests`, even though the source files (confirmed via `Grep`) have had `q: Optional[str] = Query(None)` since 31-03's commit — the same orphaned-worker class of gotcha documented in this project's own `27-03-SUMMARY.md`/cerebrum.
- **Fix:** Killed both PIDs, restarted a fresh single-process `uvicorn main:app --port 8003` (no `--reload`, to avoid re-orphaning), re-verified via `GET /openapi.json` that `q` is now present in both endpoints' parameter lists.
- **Files modified:** None (environment-only; no source change)
- **Verification:** `curl http://localhost:8003/openapi.json` parsed with `node` shows `q` in both `/v1/work-orders` and `/v1/guest-requests` GET parameter lists after restart
- **Committed in:** N/A (no code change)

---

**Total deviations:** 1 environment fix (blocking, no code change). No plan-text deviations.
**Impact on plan:** None on shipped code — this only affected the fidelity of the live spot-check, which now reflects real current server behavior instead of stale pre-31-03 state.

## Issues Encountered

No browser-automation tool was available in this executor's session (no Playwright/browser tool bound), so a full authenticated click-through (typing a real room number/WO title/guest title/SOP title and confirming each result navigates and opens the right drawer/panel, plus confirming zero forbidden network calls in a housekeeper's Network tab) was **not** performed by this executor — same limitation 31-03's executor flagged for this exact reason.

What **was** verified live, beyond 31-03's own verification:
- Restarted a genuinely fresh (non-stale) API dev server on `:8003` and confirmed via `GET /openapi.json` that both `q` params this plan depends on are really present and serving.
- Confirmed `apps/web/.env.local`'s `NEXT_PUBLIC_API_URL` points at `:8003` (the corrected server), and the web dev server on `:3001` responds 200.
- Unauthenticated smoke test of all four deep-link URLs (`/housekeeping?room=test-id`, `/engineering/work-orders?focus=test-id`, `/guest-requests?focus=test-id`, `/sop?focus=test-id`) against `:3001` — all four return `307` (auth redirect), zero 500s.
- `npm run type-check`, `npm run build`, `npm run check:i18n-parity`, `npm run check:frozen-files`, and `npm run check:contrast` all green after both tasks (contrast: 10 enforced new-token pairings pass AA in both modes; frozen-files: all 7 frozen files + room-status values unchanged).

The full authenticated click-through (real room/WO/guest/SOP ids, confirming correct drawer/panel opens, and confirming a housekeeper's Network tab shows zero `/work-orders` or `/sop` calls) remains outstanding and is flagged for **31-06's final live-verification pass**, same as the team lead's own fallback plan anticipated. Both the fresh API server and the web dev server on `:3001` are left running for that pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- NAV-04 (record search) and the palette half of NAV-01/NAV-06 are code-complete and gate-clean.
- 31-06 should perform the authenticated click-through this executor couldn't (no browser tool bound in-session): type a room number, WO title, guest title, and SOP title as GM and confirm each navigates + opens the right surface; then repeat as a housekeeper and confirm the Network tab shows zero `/work-orders` or `/sop` requests.
- No blockers for other Phase 31 plans.

---
*Phase: 31-shell-navigation-redesign*
*Completed: 2026-08-14*

## Self-Check: PASSED
- FOUND: `.planning/phases/31-shell-navigation-redesign/31-04-SUMMARY.md`
- FOUND: commit `6e308a11`
- FOUND: commit `24ff6351`
