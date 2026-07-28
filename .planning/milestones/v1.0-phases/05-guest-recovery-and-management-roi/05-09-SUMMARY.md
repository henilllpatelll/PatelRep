---
phase: 05-guest-recovery-and-management-roi
plan: 09
subsystem: ui
tags: [nextjs, react-query, i18n, typescript, guest-recovery, sms, accessibility]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "Twilio SMS send/receive + delivery events (05-02); accessible-room-features listing with live room_status (05-05); guest_requests.ts typed client + guestMessages.*/accessibilityGuidance.* locale keys (05-07)"
provides:
  - "GuestRequestDrawer.tsx message thread panel: ordered inbound/outbound bubbles, per-message delivery-status Pill, role-gated reply box"
  - "GuestRequestDrawer.tsx accessibility guidance panel: read-only accessible-room list with live operational/room status, rendered only for category === 'accessibility'"
affects: [guest-recovery-web-surfaces, 05-10, 05-11, 05-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Role gate mirrored client-side from the API's MESSAGE_ROLES constant (front_desk, housekeeping_supervisor, engineer, gm) — server 403 remains the authoritative control"
    - "Opt-out and missing-phone rendered as inline disabled states inside the reply box, never a confirm() dialog, per UI-SPEC's explicit no-confirm-dialog rule for opt-out"
    - "Accessibility guidance panel is presentational only — no Button/onClick/useMutation anywhere in that block, enforced by acceptance-criteria grep"

key-files:
  created: []
  modified:
    - apps/web/components/guest-requests/GuestRequestDrawer.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "Combined the message-thread heading and reply box under a single 'Messages' section (t('guestMessages.heading')) rather than two separate headings — the plan's task text specifies that exact key for the reply box's heading and gives no separate heading key for the thread itself, so one heading covers both sub-parts of the same panel"
  - "Added accessibilityGuidance.floorLabel ('Floor {{floor}}' / 'Piso {{floor}}') to en.ts/es.ts — the plan requires floor to render 'when present' but lists no locale key for it; a bare English word would have violated the plan's own 'no hardcoded English in the new blocks' success criterion, so a minimal symmetric key pair was added instead (Rule 2)"
  - "Created a local, dummy-valued apps/web/.env (gitignored, not committed) so `npm run build` could statically prerender pages that call createClient() at module scope — same category of blocker documented in 05-02/05-05/05-07 for the API side, now hit on the web side for the first time in this wave"

patterns-established:
  - "Accessibility list sorts by operational_status priority (operational, then inspection_due, then out_of_service) so the usable rooms surface first, independent of room number order"

requirements-completed: [D-05, D-15]

# Metrics
duration: ~35 min active work (2 tasks) + one-time worktree dependency install
completed: 2026-07-24
---

# Phase 5 Plan 09: Guest Request Drawer — Message Thread + Accessibility Guidance Summary

**Extended `GuestRequestDrawer.tsx` with an ordered SMS message thread (per-message delivery-status pills, role-gated reply box with inline opt-out/no-phone handling) and a read-only accessibility guidance panel listing accessible rooms with live operational and housekeeping status — both fully bilingual via existing `guestMessages.*`/`accessibilityGuidance.*` locale keys plus one new `floorLabel` key pair.**

## Performance

- **Duration:** ~35 min active work across 2 tasks, plus a one-time `npm install --legacy-peer-deps` in `apps/web` (this worktree checkout had no `node_modules`) and creation of a local dummy `apps/web/.env`
- **Started:** 2026-07-24 (worktree base corrected to `e6913538`, first commit `010c3261`)
- **Completed:** 2026-07-24 (last commit `1b8d2eab`)
- **Tasks:** 2 (both auto)
- **Files modified:** 3 (all modified, no new files)

## Accomplishments

- `GuestRequestDrawer.tsx` now renders the full ordered guest-message conversation (`guestRequestsApi.listMessages`, `useQuery` keyed `['guest-messages', request?.id]`), with outbound bubbles right-aligned in `--accent-soft` and inbound left-aligned in `surface-2`, each outbound bubble carrying a `DELIVERY_TONE`-mapped `Pill` (`delivered`/`received` → ready, `sent` → info, `queued` → caution, `undelivered`/`failed` → alert, `opted_out` → blocked) and its `failure_reason` when present.
- The reply box renders only for `canReply` (role in `front_desk`/`housekeeping_supervisor`/`engineer`/`gm`, mirroring the API's `MESSAGE_ROLES`), sends via `guestRequestsApi.sendMessage(id, { body, channel: 'sms' })` with no `recipient` (server falls back to stored `guest_phone`), and shows inline (never a confirm dialog) disabled states for `contact_opted_out_at` and missing `guest_phone`, checked in that priority order.
- A new accessibility guidance panel renders only when `request.category === 'accessibility'`, fetching `guestRequestsApi.listAccessibleRoomFeatures()` (query enabled only in that case, `staleTime: 60_000`), sorted operational-first/inspection_due/out_of_service, showing room number + floor, feature code + description, a status `Pill`, the room's live `room_status`, and optional `guidance` text — with zero `Button`/`onClick`/`useMutation` in the block (D-15: information only, no assignment/booking action).
- `en.ts`/`es.ts`: added `accessibilityGuidance.floorLabel` ('Floor {{floor}}' / 'Piso {{floor}}') so the floor annotation stays translated; every other string in both new panels resolves through the `guestMessages.*`/`accessibilityGuidance.*` keys 05-07 already shipped.

## Task Commits

Each task was committed atomically:

1. **Task 1: Message thread panel with delivery-status pills and a gated reply box** - `010c3261` (feat)
2. **Task 2: Accessibility room-matching guidance panel (informational only)** - `1b8d2eab` (feat)

## Files Created/Modified

- `apps/web/components/guest-requests/GuestRequestDrawer.tsx` — message thread + reply box (Task 1), accessibility guidance panel (Task 2); drawer shell, header, request summary, "Logged" line, and the Add Note block preserved exactly as before
- `apps/web/i18n/locales/en.ts` — `accessibilityGuidance.floorLabel: 'Floor {{floor}}'`
- `apps/web/i18n/locales/es.ts` — `accessibilityGuidance.floorLabel: 'Piso {{floor}}'`

## Decisions Made

See `key-decisions` in frontmatter. Summary: one combined "Messages" heading covers both the thread and reply box (per the plan's literal key usage); `floorLabel` was added as a small symmetric locale-key pair to keep the floor annotation bilingual; a local dummy `apps/web/.env` was created (gitignored, uncommitted) to unblock `npm run build`'s static prerendering.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed web app dependencies in this fresh worktree checkout**
- **Found during:** Task 1, before `npm run type-check` could run
- **Issue:** This worktree's `apps/web/node_modules` did not exist, so every verification command would fail on module resolution before any plan code could be exercised.
- **Fix:** Ran `npm install --legacy-peer-deps` in `apps/web` (plain `npm install` hits the pre-existing `@hookform/resolvers`/`valibot` peer-dependency conflict noted by the prior wave's executor, unrelated to this plan). Reverted the resulting `package-lock.json` diff after install (metadata-only churn, zero dependency version changes) so no unrelated lockfile change was committed.
- **Files modified:** none committed (node_modules is gitignored; package-lock.json diff was reverted)
- **Verification:** `npm run type-check`, `npm run lint`, and `npm run build` all exit 0 after the install.
- **Committed in:** N/A — install-only, no repo changes.

**2. [Rule 3 - Blocking] Created a local, dummy-valued `apps/web/.env`**
- **Found during:** Task 1, first `npm run build` attempt
- **Issue:** `npm run build`'s static-page prerendering step calls `createClient()` (Supabase) at module scope in `useAuth.ts`/`Sidebar.tsx` for every dashboard route, which throws when `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent — this worktree has no `apps/web/.env` (gitignored, absent from a fresh checkout, and CLAUDE.md documents no live credentials exist locally), so the build failed on `/billing` and `/reports` before reaching any plan-specific verification.
- **Fix:** Wrote `apps/web/.env` with dummy, non-live values (`NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co`, a dummy anon key, `NEXT_PUBLIC_API_URL=http://localhost:8000/v1`) sufficient to satisfy the Supabase client constructor at build time. The file is gitignored (`.env` is listed in both the root and `apps/web/.gitignore`) and was never staged or committed.
- **Files modified:** `apps/web/.env` (untracked, not committed)
- **Verification:** `npm run build` completes and prerenders all 41 routes successfully.
- **Committed in:** N/A — gitignored by design, mirrors the same category of blocker documented in 05-02/05-05/05-07's summaries for the API side.

**3. [Rule 2 - Missing Critical] Added `accessibilityGuidance.floorLabel` to en.ts/es.ts**
- **Found during:** Task 2, while implementing the accessible-room row rendering
- **Issue:** The plan's render spec requires showing "room number in font-mono text-[14px] (with floor when present)" and separately states the panel must contain "no hardcoded English in the new blocks," but no locale key for a floor annotation exists in the `accessibilityGuidance.*` set 05-07 shipped.
- **Fix:** Added a minimal, symmetric key pair (`floorLabel: 'Floor {{floor}}'` / `'Piso {{floor}}'`) matching the codebase's existing `Floor {{floor}}` interpolation pattern used elsewhere (e.g. `engineering.roomBoard.floorLabel`).
- **Files modified:** `apps/web/i18n/locales/en.ts`, `apps/web/i18n/locales/es.ts`
- **Verification:** Both files were manually diffed to confirm the key pair is byte-symmetric (same nesting, same interpolation variable); `npm run type-check`/`lint`/`build` all pass with the new key referenced from the component.
- **Committed in:** `1b8d2eab` (Task 2 commit, bundled since it was discovered and needed within that task's implementation)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing-critical)
**Impact on plan:** No scope creep and no plan-code behavior changes beyond the one small locale-key addition needed to keep the new panel honestly bilingual; no secrets involved in either blocking fix.

## Issues Encountered

None beyond the three deviations above, each resolved within the task it was found in.

## Live Verification Note

Per CLAUDE.md's Self-Verification Policy, a full browser click-through against a running `npm run dev:web` + `npm run dev:api` pair with a live GM session was **not performed** in this parallel worktree agent. This worktree's `apps/web/.env` and `apps/api/.env` (where present in sibling plans) use dummy, non-live values per the documented "no live API credentials in the local environment" constraint, and Twilio credentials are entirely absent, so the plan's own `<verification>` note that "no Twilio credentials locally, so `Queued` with `sms_provider_not_configured` is the expected honest outcome" cannot be exercised live in this environment either way. All work is proven via: (a) every grep-based acceptance criterion in both tasks passing exactly as specified, (b) `npm run type-check`, `npm run lint`, and `npm run build` all exiting 0 with all 41 routes prerendering successfully, and (c) a full manual read-through of the final 285-line component confirming the drawer shell/header/request-summary/Logged-line/Add-Note block are byte-identical to the pre-plan version, and that the two new panels are wired to the real typed-client methods (`listMessages`, `sendMessage`, `listAccessibleRoomFeatures`) shipped in 05-02/05-05/05-07 — no hardcoded/mock data anywhere in either new panel.

## User Setup Required

None new. Twilio credentials (documented in 05-01/05-02's summaries) remain the only external dependency for live SMS send/receive to actually deliver — this plan's UI renders correctly regardless of whether the provider is configured, per the `sms_provider_not_configured` honest-queued-outcome design already implemented server-side.

## Next Phase Readiness

- D-05 (message thread + delivery status + gated reply + opt-out/no-phone inline handling) and D-15 (accessibility guidance panel, informational only) are both fully implemented in `GuestRequestDrawer.tsx` and pass every grep-based acceptance criterion from the plan.
- The drawer file is now 285 lines (min_lines requirement was 240), containing both new panels plus the untouched legacy shell/header/note block.
- `guestRequestsApi.listMessages`/`sendMessage`/`listAccessibleRoomFeatures` (05-07's typed client) are now consumed by real UI, closing the loop 05-07's "Next Phase Readiness" note anticipated.
- No blockers for waves depending on this plan. The one open item is the live-browser/live-SMS verification gap noted above, consistent with this phase's existing no-credentials constraint documented across every prior plan in this phase.

## Self-Check: PASSED

- `apps/web/components/guest-requests/GuestRequestDrawer.tsx` — FOUND (285 lines, exceeds min_lines: 240)
- `apps/web/i18n/locales/en.ts` — FOUND (`accessibilityGuidance.floorLabel` present)
- `apps/web/i18n/locales/es.ts` — FOUND (`accessibilityGuidance.floorLabel` present)
- Commit `010c3261` (Task 1) — FOUND
- Commit `1b8d2eab` (Task 2) — FOUND
- All acceptance-criteria greps for both tasks verified passing (see grep output captured during execution: `listMessages`=1, `queryKey guest-messages`=1, `DELIVERY_TONE`=2, `guestMessages.optedOut`=1, `guestMessages.sendReply`=1, `canReply`=2, `confirm(`=0, `recipient:`=0, off-contract font sizes=1, `listAccessibleRoomFeatures`=1, `request?.category === 'accessibility'`=2, heading/body/empty keys=3, `room_status`=2, `font-mono`=2, no Button/onClick/useMutation inside the accessibility panel block)
- `npm run type-check && npm run lint && npm run build` — all exit 0, all 41 routes prerender

---
*Phase: 05-guest-recovery-and-management-roi*
*Completed: 2026-07-24*
