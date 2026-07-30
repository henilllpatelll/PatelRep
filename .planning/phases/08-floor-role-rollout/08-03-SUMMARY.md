---
phase: 08-floor-role-rollout
plan: 03
subsystem: ui
tags: [react-native, expo, theme, design-tokens, toast]

# Dependency graph
requires:
  - phase: 08-floor-role-rollout (08-00)
    provides: textDisabled, accentBrassSoft, accentBrassLine keys on lightTheme/darkTheme
provides:
  - ReportIssueModal, KnockModal, SupplyRequestModal, FoundItemModal fully migrated to useTheme()/Button/Toast primitives
  - Optional testID prop on the Button primitive (needed by existing test coverage)
  - darkTheme.surfaceSubtle key (closes a light/dark theme shape gap)
affects: [08-04, 08-05, 08-06, 08-07, 08-08, 09-lost-found-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Selection-chip UI (category dropdown items, priority chips, supply-item checkboxes) stays a themed TouchableOpacity rather than force-fit into <Button> — Button has no active/selected visual language"
    - "Non-text-only touchables (image preview / placeholder boxes) stay themed TouchableOpacity — Button has no Image/children slot"
    - "Alert.alert success handlers converting to Toast fire the toast and any side effect (reset()/onClose()) together, not gated behind a dismiss callback"

key-files:
  created: []
  modified:
    - apps/mobile/components/housekeeping/ReportIssueModal.tsx
    - apps/mobile/components/housekeeping/KnockModal.tsx
    - apps/mobile/components/housekeeping/SupplyRequestModal.tsx
    - apps/mobile/components/housekeeping/FoundItemModal.tsx
    - apps/mobile/components/ui/Button.tsx
    - apps/mobile/components/shared/tokens.ts
    - apps/mobile/__tests__/components/ReportIssueModal.test.tsx

key-decisions:
  - "Category-select trigger, dropdown items, and priority chips in ReportIssueModal, and the item checkboxes in SupplyRequestModal, stay themed TouchableOpacity instead of <Button> — they carry an active/selected visual state Button doesn't model"
  - "FoundItemModal's photo box (image preview or icon+placeholder) stays a themed TouchableOpacity, not <Button> — Button has no Image/children slot; converting it would silently drop the photo-preview feature"
  - "SupplyRequestModal's Cancel converts to Button variant=\"ghost\" (closest match to the original plain-text, no-fill link style)"

patterns-established:
  - "Alert.alert validation/error/success feedback → toast.error/success with the existing hardcoded or t()-wrapped message string, no new i18n wiring introduced for i18n-gate-exempt files"

requirements-completed: [FLOOR-01]

# Metrics
duration: 25min
completed: 2026-07-30
---

# Phase 8 Plan 03: My-Rooms Modal Migration Summary

**Migrated all 4 My-Rooms-reachable modals (ReportIssueModal, KnockModal, SupplyRequestModal, FoundItemModal) off the legacy `C` token constant onto `useTheme()`/`Button`/`Toast`, converting 5 of their 6 total `Alert.alert` outcome-reporting calls to non-blocking Toasts while leaving the one genuine 3-way photo-source choice as a blocking dialog.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-29T21:00:00-05:00 (approx.)
- **Completed:** 2026-07-30T02:31:00Z
- **Tasks:** 2 completed
- **Files modified:** 7 (4 modals + Button primitive + tokens.ts + 1 test file)

## Accomplishments
- `ReportIssueModal.tsx` (336 lines, 36 `C.` refs) and `KnockModal.tsx` (121 lines, 5 `C.` refs, 1 direct `shellTokens` import) now route every color through `useTheme()`; both had zero `Alert.alert` calls so no Toast work was needed. Submit/Cancel/CTA buttons converted to the `Button` primitive.
- `SupplyRequestModal.tsx` (167 lines, 17 `C.` refs) fully themed; Send/Cancel converted to `Button`; all 3 `Alert.alert` calls (nothing-selected validation, success, request-failed) converted to `toast.error`/`toast.success`, with the success path firing `reset(); onClose();` alongside the toast rather than behind an OK-dismiss.
- `FoundItemModal.tsx` (286 lines, raw inline hex — not `C.*`) fully themed per the plan's raw-hex map; Cancel/Submit converted to `Button`; 2 of 3 `Alert.alert` calls (camera permission denied, offline error) converted to `toast.error`; the 3-way photo-source action sheet (take photo / choose gallery / cancel) stays a blocking `Alert.alert` as required.
- All 4 modals verified at zero `C.` refs / zero raw hex (FoundItemModal) / zero `shellTokens` direct imports.
- Full mobile jest suite (24 suites, 132 tests) green when run serially; `tsc --noEmit` and `eslint .` both clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate ReportIssueModal + KnockModal (pure color/component swap)** - `0dcb2b88` (feat)
2. **Task 2: Migrate SupplyRequestModal (3 alerts) + FoundItemModal (raw hex + 3 alerts, 1 stays)** - `c1269941` (feat)

## Files Created/Modified
- `apps/mobile/components/housekeeping/ReportIssueModal.tsx` - All colors via `theme.*`; Submit/Cancel on `Button`; category/priority selection UI kept as themed `TouchableOpacity`.
- `apps/mobile/components/housekeeping/KnockModal.tsx` - All colors via `theme.*` (including `theme.shell.*` replacing direct `shellTokens` import); CTA on `Button`.
- `apps/mobile/components/housekeeping/SupplyRequestModal.tsx` - All colors via `theme.*`; Send/Cancel on `Button`; 3 alerts → Toast.
- `apps/mobile/components/housekeeping/FoundItemModal.tsx` - All raw hex → `theme.*`; Cancel/Submit on `Button`; photo box stays themed `TouchableOpacity`; 2 of 3 alerts → Toast, photo-source action sheet unchanged.
- `apps/mobile/components/ui/Button.tsx` - Added optional `testID` passthrough prop (Rule 3, see Deviations).
- `apps/mobile/components/shared/tokens.ts` - Added `surfaceSubtle` to `darkTheme` (Rule 3, see Deviations).
- `apps/mobile/__tests__/components/ReportIssueModal.test.tsx` - Wrapped all 4 `render()` calls in `ThemeProvider` (Rule 3, see Deviations).

## Decisions Made
- Selection-style UI (category dropdown, priority chips, supply-item checkboxes) was kept as themed `TouchableOpacity` rather than converted to `<Button>` — these carry an active/selected visual contract (highlighted background, checkmark) that the `Button` primitive doesn't model, and force-fitting would have either broken the selection affordance or required extending `Button`'s API beyond this plan's scope. Only true action buttons (Submit, Cancel, Send, CTA) converted to `<Button>`.
- `FoundItemModal`'s photo box (renders either an `Image` preview or an icon+text placeholder in a 140px dashed-border area) was kept as a themed `TouchableOpacity` rather than `<Button>` — `Button`'s props are `label`/`icon` only with no children/Image slot, so converting it would have silently dropped the photo-preview feature. This mirrors 08-02's precedent of not force-fitting non-matching UI onto a primitive that doesn't support it.
- `SupplyRequestModal`'s Cancel uses `Button` `variant="ghost"` — the closest existing variant to the original's plain-text, no-fill link style.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Merged worktree branch with `main` to obtain phase 8 planning docs**
- **Found during:** Setup, before Task 1
- **Issue:** This worktree's branch (`worktree-agent-ae4253fc4bcef94ff`) was created before Phase 8's planning docs (08-CONTEXT.md, 08-RESEARCH.md, all 08-0N-PLAN.md files) and 08-00's theme-token-unblock work existed on `main` — `.planning/phases/08-floor-role-rollout/` and the required `08-00`-added theme keys were entirely absent from the worktree.
- **Fix:** Fast-forward merged `main` into the worktree branch (`git merge main`, fast-forwarded cleanly, no conflicts) to bring in the planning docs and 08-00's `textDisabled`/`accentBrassSoft`/`accentBrassLine` token additions this plan's migration reference depends on.
- **Files modified:** None beyond the merge itself (brought in pre-existing committed files from `main`).
- **Verification:** `git log --oneline` confirmed the merge was a clean fast-forward; `.planning/phases/08-floor-role-rollout/08-03-PLAN.md` and `apps/mobile/components/shared/tokens.ts`'s Wave-0 keys were present afterward.
- **Committed in:** N/A (fast-forward, no new commit created).

**2. [Rule 3 - Blocking] Added optional `testID` prop to the `Button` primitive**
- **Found during:** Task 1
- **Issue:** `ReportIssueModal.test.tsx` calls `getByTestId("submit-button")` directly (no fallback), but `Button`'s `ButtonProps` had no `testID` field, so the existing test would fail to find the converted Submit button.
- **Fix:** Added `testID?: string` to `ButtonProps` and passed it through to the underlying `Pressable`.
- **Files modified:** `apps/mobile/components/ui/Button.tsx`
- **Verification:** `npx jest __tests__/components/ReportIssueModal.test.tsx` — all 4 tests pass.
- **Committed in:** `0dcb2b88` (Task 1 commit)

**3. [Rule 3 - Blocking] Wrapped `ReportIssueModal.test.tsx` renders in `ThemeProvider`**
- **Found during:** Task 1
- **Issue:** `useTheme()` throws `"useThemeMode must be used within a ThemeProvider"` when rendered outside a provider; the existing test rendered `ReportIssueModal` bare, so all 4 tests failed once the component started calling `useTheme()`.
- **Fix:** Wrapped all 4 `render(<ReportIssueModal .../>)` calls in `<ThemeProvider>`, matching the exact fix pattern already established in Phase 7 (commit `f60f4d57`, `HousekeeperHome.test.tsx`).
- **Files modified:** `apps/mobile/__tests__/components/ReportIssueModal.test.tsx`
- **Verification:** `npx jest __tests__/components/ReportIssueModal.test.tsx` — all 4 tests pass.
- **Committed in:** `0dcb2b88` (Task 1 commit)

**4. [Rule 3 - Blocking] Added missing `surfaceSubtle` key to `darkTheme`**
- **Found during:** Task 2
- **Issue:** `useTheme()` returns a union of `lightTheme | darkTheme`. `lightTheme` has a `surfaceSubtle` key (used by the plan's migration reference for `SupplyRequestModal`'s `C.surface2` and `FoundItemModal`'s `"#f7f4ee"` mappings), but `darkTheme` only had `surfaceElevated` — a pre-existing shape mismatch between the two theme objects that predates this plan. `tsc --noEmit` failed with `Property 'surfaceSubtle' does not exist` on the union type once these two files started reading `theme.surfaceSubtle`.
- **Fix:** Added `surfaceSubtle: "#232019"` to `darkTheme`, reusing `surfaceElevated`'s existing hex — it already occupies the same relative tonal step (between `surface` and `surfaceMuted`) that `surfaceSubtle` occupies in `lightTheme`. `surfaceElevated` and its existing consumers (`mobileHandoff.tsx`, `copilot/index.tsx`) were left untouched.
- **Files modified:** `apps/mobile/components/shared/tokens.ts`
- **Verification:** `tsc --noEmit` clean; `npx jest __tests__/components/MobileVisualTokens.test.ts` (5/5) still passes.
- **Committed in:** `c1269941` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (1 worktree-sync, 3 blocking type/test-infrastructure fixes)
**Impact on plan:** All four were necessary to complete the plan's stated verification gates (existing tests green, type-check clean). No scope creep — no modal's form-submit/api/queue logic was touched, and `Button`/`tokens.ts` changes were purely additive.

## Issues Encountered
- Running the full mobile jest suite with default parallel workers produced 9 spurious `Exceeded timeout of 5000 ms` failures across files unrelated to this plan (`WorkOrderDetail`, `RoomStatusList`, `WorkOrdersList`, `ProfileHandoff`, `RoomDetail`, others) — confirmed to be this machine's resource contention under jest's default worker parallelism, not a regression: every failing suite passed individually and the full suite passed 24/24 (132/132) when re-run with `--runInBand`.
- Worktree had no `node_modules` under `apps/mobile` (git worktrees don't carry gitignored directories). Per this plan's explicit instruction, ran a real `npm install --legacy-peer-deps` in the worktree rather than creating filesystem junctions (which caused a prior "Filename too long" failure per session notes).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

All 4 My-Rooms-reachable modals are now on Phase 7 primitives with zero legacy `C.` refs / raw hex / direct `shellTokens` imports, so the parent My-Rooms room-detail screen (08-02) no longer opens a visually-broken legacy modal. `Button`'s new optional `testID` prop and `darkTheme.surfaceSubtle` are both available for any later Phase 8/9 plan that needs them. `FoundItemModal` is fully primitive-based ahead of Phase 9's Lost & Found screen migration (D-07) — that phase will find it already done for this call site. No blockers for the remaining Wave 1 plans.

---
*Phase: 08-floor-role-rollout*
*Completed: 2026-07-30*

## Self-Check: PASSED

All 6 modified/relevant files confirmed present on disk (ReportIssueModal.tsx, KnockModal.tsx, SupplyRequestModal.tsx, FoundItemModal.tsx, Button.tsx, tokens.ts). Both task commit hashes (`0dcb2b88`, `c1269941`) confirmed present in `git log --oneline --all`.
