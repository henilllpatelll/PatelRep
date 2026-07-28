---
phase: 05-guest-recovery-and-management-roi
plan: 07
subsystem: web
tags: [nextjs, react-query, i18n, typescript, guest-recovery]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "GET/POST /guest-requests/{id}/messages, SLA policy CRUD, accessibility/features endpoints (05-02, 05-05)"
provides:
  - "guestRequestsApi.listMessages / listSlaPolicies / createSlaPolicy / deleteSlaPolicy / listAccessibleRoomFeatures / upsertAccessibleRoomFeature typed client methods"
  - "GuestMessage / SlaPolicy / AccessibleRoomFeature TypeScript interfaces"
  - "GuestRequest.guest_phone / contact_preference / contact_consent_at / contact_opted_out_at fields"
  - "NewRequestModal.tsx capturing guest_phone, SMS consent, and category with accessibility/urgent UI lock"
  - "en.ts/es.ts nav.managementRoi, guestMessages.*, accessibilityGuidance.*, guestRequests.* keys with verified parity"
affects: [05-08, 05-09, 05-10, 05-11, 05-12, guest-recovery-web-surfaces]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One typed client per domain extended in place (guest_requests.ts) rather than forking a parallel client file per new endpoint group"
    - "UI-side accessibility/urgent-lock: a useEffect forces priority to urgent when category === 'accessibility' and disables the Normal button, making the API's 422 unreachable through the modal"
    - "SMS consent checkbox is disabled until a phone number is entered and clears itself when the phone field is cleared"

key-files:
  created: []
  modified:
    - apps/web/lib/api/guest_requests.ts
    - apps/web/components/guest-requests/NewRequestModal.tsx
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts

key-decisions:
  - "apiClient.put already existed in lib/api/client.ts (mirrors get/post/patch/delete) — no client.ts change was needed to support upsertAccessibleRoomFeature"
  - "EN/ES scope for Phase 5 (resolving 05-UI-SPEC.md Open Item 1): the new-request modal and the future drawer message/guidance panels (front_desk + housekeeper facing) get EN+ES via en.ts/es.ts. Settings pages, the Management ROI dashboard, and Lost & Found remain English-only, matching the existing precedent that every Settings/Reports page in this codebase is hardcoded English. Only nav.managementRoi (the sidebar label itself) was added bilingually since Sidebar entries are always translated regardless of the page behind them."
  - "guestRequests.cancel is a distinct key from the existing common.cancel — kept scoped to this modal's namespace to match the plan's explicit key list rather than reusing the shared key, avoiding an unrelated future change to common.cancel from affecting this modal's copy."

patterns-established:
  - "New Phase 5 web surfaces extend guest_requests.ts's existing interfaces/methods rather than creating slaPolicies.ts or accessibility.ts client files — verified via acceptance-criteria grep that no such files exist."

requirements-completed: [D-04, D-05, D-13, D-14, D-15]

# Metrics
duration: ~25 min active work (3 tasks) + one-time worktree dependency install
completed: 2026-07-24
---

# Phase 5 Plan 07: Guest Recovery Web Data Layer + Capture Form Summary

**Extended `guest_requests.ts` with GuestMessage/SlaPolicy/AccessibleRoomFeature types and six new typed client methods, rebuilt `NewRequestModal.tsx` to capture guest phone + SMS consent + category (with an accessibility/urgent UI lock making the API's 422 unreachable), and added matched EN/ES locale keys (1353 keys each, verified parity) covering the modal, message thread, and accessibility guidance panel strings.**

## Performance

- **Duration:** ~25 min active work across 3 tasks, plus a one-time `npm install --legacy-peer-deps` in `apps/web` (this worktree checkout had no `node_modules`)
- **Started:** 2026-07-24 (worktree base corrected to `23509357`, first commit `26f328bb`)
- **Completed:** 2026-07-24 (last commit `0cbe5c0c`)
- **Tasks:** 3 (all auto)
- **Files modified:** 4 (all modified, no new files)

## Accomplishments

- `lib/api/guest_requests.ts`: added `guest_phone`, `contact_preference`, `contact_consent_at`, `contact_opted_out_at` to `GuestRequest`; added `GuestMessage`, `SlaPolicy`, `AccessibleRoomFeature` interfaces; `createRequest` payload now accepts `guest_phone`; `sendMessage`'s `recipient` is now optional and its return is typed `Promise<{ data: GuestMessage }>`; added `listMessages`, `listSlaPolicies`, `createSlaPolicy`, `deleteSlaPolicy`, `listAccessibleRoomFeatures`, `upsertAccessibleRoomFeature`. No parallel client file created — verified `slaPolicies.ts`/`accessibility.ts` do not exist under `lib/api/`.
- `components/guest-requests/NewRequestModal.tsx`: new category selector (service/housekeeping/maintenance/accessibility/other), guest-phone input with SMS-consent checkbox that disables until a phone is entered and clears on phone-clear, an accessibility/urgent lock (`useEffect` forces `priority='urgent'` and disables the Normal button with an inline hint when `category === 'accessibility'`), full `react-i18next` wiring replacing every hardcoded string, and the header upgraded from the legacy 15px size to the UI-SPEC's 20px heading size. Room picker, description field, and modal shell/reset logic preserved exactly.
- `i18n/locales/en.ts` + `es.ts`: added `nav.managementRoi` (sidebar label for plan 05-10), `guestMessages.*` (drawer message thread panel for plan 05-09), `accessibilityGuidance.*` (accessibility panel for plan 05-09), and `guestRequests.*` (every key the modal now uses). Verified byte-identical dotted key-path sets across both files — 1353 keys each — via a `tsx` parity script matching the plan's specified check.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend the guest-requests typed API client** - `26f328bb` (feat)
2. **Task 2: Capture guest phone, SMS consent, and category on the new-request modal** - `4c379470` (feat)
3. **Task 3: Add every new EN and ES locale key, including the Management ROI nav label** - `0cbe5c0c` (feat)

## Files Created/Modified

- `apps/web/lib/api/guest_requests.ts` — `GuestMessage`/`SlaPolicy`/`AccessibleRoomFeature` interfaces; `guest_phone`/`contact_preference`/`contact_consent_at`/`contact_opted_out_at` on `GuestRequest`; six new `guestRequestsApi` methods
- `apps/web/components/guest-requests/NewRequestModal.tsx` — category selector, guest-phone + SMS-consent fields, accessibility/urgent lock, full i18n wiring, 20px heading
- `apps/web/i18n/locales/en.ts` — `nav.managementRoi`, `guestMessages.*`, `accessibilityGuidance.*`, `guestRequests.*`
- `apps/web/i18n/locales/es.ts` — Spanish counterparts for every key added to `en.ts`, unaccented forms matching the file's existing convention

## Decisions Made

See `key-decisions` in frontmatter. Summary: `apiClient.put` already existed (no client.ts change needed); EN/ES scope follows 05-UI-SPEC.md's Open Item 1 recommendation (floor-facing guest-request surfaces bilingual, Settings/ROI/Lost&Found English-only, except the sidebar nav label itself which is always bilingual); `guestRequests.cancel` was kept as its own namespaced key per the plan's explicit key list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed web app dependencies in this fresh worktree checkout**
- **Found during:** Task 1, before `npm run type-check` could run
- **Issue:** This worktree's `apps/web/node_modules` did not exist at all (0 entries), so `npm run type-check` failed with dozens of `Cannot find module 'zustand'`/`'tailwindcss'` etc. errors unrelated to this plan's code.
- **Fix:** Ran `npm install --legacy-peer-deps` in `apps/web` (plain `npm install` hit an `ERESOLVE` conflict between `@hookform/resolvers@5.4.1` and `valibot@0.39.0`, a pre-existing upstream peer-dependency mismatch, not something this plan's changes caused). Reverted the resulting `package-lock.json` diff (`devOptional`→`dev` metadata-only churn from the legacy-peer-deps resolver, zero dependency version changes) since it was pure noise from the local install, not a real lockfile update.
- **Files modified:** none committed (node_modules is gitignored; package-lock.json diff was reverted, not committed)
- **Verification:** `npm run type-check` and `npm run lint` both exit 0 after the install.
- **Committed in:** N/A — install-only, no repo changes.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to run any verification command in this worktree at all; no scope creep, no plan-code changes.

## Issues Encountered

None beyond the dependency-install blocker above, resolved before Task 1's verification step.

## Live Verification Note

Per CLAUDE.md's Self-Verification Policy, full browser click-through against a running `npm run dev:web` + `npm run dev:api` pair was **not performed** in this worktree. This worktree has no `apps/api/.env` or Python `.venv` configured (the codebase's documented constraint: no live API credentials in the local environment), and this plan's changes are purely web-side (typed client + form + locale strings, no new API surface) — the client methods added in Task 1 type-check exactly against the endpoint shapes documented in 05-02/05-05's summaries, and the modal's payload shape was verified against `createRequest`'s updated type signature. All three tasks' grep-based acceptance criteria pass, `npm run type-check` and `npm run lint` are both clean, and the EN/ES key-parity script (matching the plan's specified check) confirms 1353 identical keys in both locale files. This mirrors the same documented limitation in 05-02's and 05-05's summaries for this phase.

## User Setup Required

None new. This plan makes no API or infrastructure changes.

## Next Phase Readiness

- `guestRequestsApi` now exposes every client method plans 05-09 (message thread + accessibility guidance drawer panels), 05-10 (Management ROI nav entry), and 05-11 (SLA policy settings page) need — no further client extension required for those plans' data layer.
- `NewRequestModal.tsx` demonstrates the accessibility/urgent UI-lock pattern that 05-UI-SPEC.md's threat register (T-05-07-02) requires; downstream plans touching guest-request creation should reuse this pattern rather than reintroducing a reachable non-urgent-accessibility state.
- `en.ts`/`es.ts` now carry every locale key plan 05-09's drawer panels will consume (`guestMessages.*`, `accessibilityGuidance.*`) — 05-09 should not need to add new top-level sections, only reference these.
- No blockers for wave 5. The one open item is the live-browser verification gap noted above, consistent with this phase's existing no-credentials constraint.

## Known Stubs

None. All UI added in this plan is wired to real API calls via the typed client (no hardcoded empty arrays, no placeholder-only components).

## Threat Flags

None. All new surface area (guest_phone capture, SMS consent, SLA/accessibility client methods) was already anticipated and dispositioned in this plan's `<threat_model>` (T-05-07-01 through T-05-07-06); no undocumented network endpoint, auth path, or schema change was introduced.

## Self-Check: PASSED

- `apps/web/lib/api/guest_requests.ts` — FOUND
- `apps/web/components/guest-requests/NewRequestModal.tsx` — FOUND
- `apps/web/i18n/locales/en.ts` — FOUND
- `apps/web/i18n/locales/es.ts` — FOUND
- `.planning/phases/05-guest-recovery-and-management-roi/05-07-SUMMARY.md` — FOUND
- Commit `26f328bb` (Task 1) — FOUND
- Commit `4c379470` (Task 2) — FOUND
- Commit `0cbe5c0c` (Task 3) — FOUND
- Commit `91177dae` (SUMMARY) — FOUND
