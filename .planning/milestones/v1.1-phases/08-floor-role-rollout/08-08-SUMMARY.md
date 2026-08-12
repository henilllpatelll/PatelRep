---
phase: 08-floor-role-rollout
plan: 08
subsystem: ui
tags: [react-native, expo, theme, design-tokens, toast, i18n]

# Dependency graph
requires:
  - phase: 08-floor-role-rollout (08-00)
    provides: textDisabled/accentBrassSoft/accentBrassLine theme keys unblocking C.ink4-style call sites
  - phase: 07-theme-foundation-primitives
    provides: useTheme()/useToast() reactive shell, Button/StateBlock/StatusBadge primitives
provides:
  - Inspect screen (queue/done tabs, submit modal, fail-checklist, reclean modal, detail modal) fully migrated to Phase 7 primitives
  - Zero legacy C.* token / shellTokens / Alert.alert usage in apps/mobile/app/(app)/inspect/index.tsx
affects: [09-remaining-screens-rollout, 10-dark-mode-accessibility-qa]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level color-lookup constants (e.g. RESULT_META) that need theme access are moved inside the component as a useMemo with the same identifier, so downstream JSX references resolve via closure with zero textual changes"
    - "When a UI element's semantic vocabulary doesn't map onto Button's variant palette (primary/secondary/ghost/destructive) -- e.g. a 3-way pass/touchup/fail action needing teal/amber/red -- keep it a themed TouchableOpacity rather than force-fitting a Button variant that would misrepresent the state (mirrors 08-02's ChecklistSection precedent)"

key-files:
  created: []
  modified:
    - apps/mobile/app/(app)/inspect/index.tsx
    - apps/mobile/__tests__/screens/InspectorQueue.test.tsx

key-decisions:
  - "Kept the tri-color pass/touchup/fail queue action buttons and confirm-modal action as themed TouchableOpacity, not <Button> -- Button's variant enum has no amber/caution tone and forcing 'conditional' onto 'primary' would recolor a caution action forest-green, misrepresenting the state"
  - "Used <Button> for all genuinely binary actions (Cancel everywhere, reclean Confirm) since those map cleanly onto secondary/destructive variants with Button's built-in loading spinner"
  - "resultPill/detail-modal result badges kept hand-rolled themed rather than forced into StatusBadge -- passed/failed/conditional doesn't cleanly map onto StatusBadge's 13 StatusKeys without a semantic/icon mismatch (dirty's brush-outline icon doesn't represent 'failed')"

patterns-established:
  - "Screen tests using both useTheme() and useToast() wrap render in nested <ThemeProvider><ToastProvider>...</ToastProvider></ThemeProvider>, matching RoomDetail.test.tsx/WorkOrderDetail.test.tsx precedent"

requirements-completed: [FLOOR-05]

# Metrics
duration: ~35min
completed: 2026-07-30
---

# Phase 8 Plan 08: Inspect Screen Migration Summary

**Migrated `apps/mobile/app/(app)/inspect/index.tsx` (668 lines, 64 legacy `C.*` refs, 2 `Alert.alert`) onto Phase 7's `useTheme()`/`useToast()`/`Button`/`StateBlock` primitives — zero `C.` refs, zero `Alert.alert`, zero `shellTokens` remain; the existing text/checkbox fail-checklist was migrated as-is with no photo-capture behavior added.**

## Performance

- **Duration:** ~35 min (includes syncing 47 commits of prior Phase 8 waves into a stale worktree branch, `npm install` for a fresh worktree's `apps/mobile`, then the migration itself)
- **Completed:** 2026-07-30
- **Tasks:** 2 completed
- **Files modified:** 2 (`inspect/index.tsx`, `InspectorQueue.test.tsx`)

## Accomplishments
- Inspect screen (queue tab, done tab, hero, segmented tabs, loading state, submit-confirm modal, fail-checklist, reclean modal, detail modal) fully renders through `theme.*` instead of the legacy `C` token object; `shellTokens` import removed in favor of `theme.shell.*`.
- Both `Alert.alert` calls (submit-failed, reclean-failed) converted to `toast.error(...)`.
- Loading state and both empty states (queue-empty, done-empty) now use `<StateBlock>`.
- Cancel buttons (both modals) and the reclean Confirm button now use `<Button>` (secondary / destructive variants, built-in loading spinner).
- The existing text/checkbox fail-checklist UI (checkbox rows + notes `TextInput`) migrated as-is onto theme tokens — confirmed zero `ImagePicker`/`expo-image-picker`/`requires_photo` strings anywhere in the file, per the phase's explicit scope guard (D-11) against building new photo-capture functionality.
- `InspectorQueue.test.tsx` updated to wrap renders in `<ThemeProvider><ToastProvider>` (both hooks throw outside their providers) — 2/2 tests still pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate inspect/index.tsx part A — queue/list/summary/states + submit action** - `0f69d569` (feat)
2. **Task 2: Migrate inspect/index.tsx part B (fail-checklist + reclean), drive C. refs to zero** - `05017aaf` (feat)

**Plan metadata:** this commit (docs: complete plan — worktree mode, STATE.md/ROADMAP.md deferred to orchestrator)

## Files Created/Modified
- `apps/mobile/app/(app)/inspect/index.tsx` - Full primitive migration (theme tokens, StateBlock, Button, Toast); submission/reclean/queue business logic untouched
- `apps/mobile/__tests__/screens/InspectorQueue.test.tsx` - Wrapped renders in ThemeProvider + ToastProvider

## Decisions Made
- Kept the 3-way pass/touchup/fail action (both the queue's round icon buttons and the confirm modal's single action button) as themed `TouchableOpacity` rather than forcing it into `<Button>`, since `Button`'s variant palette has no amber/caution tone to represent the "conditional/touchup" state without misrepresenting it as either primary(green) or destructive(red). This follows the same "don't force-fit" principle 08-02-PLAN.md established for `ChecklistSection`'s pass/fail vocabulary.
- Kept the done-tab/detail-modal result pill (passed/failed/conditional) hand-rolled-themed rather than `<StatusBadge>`, since none of `StatusBadge`'s 13 `StatusKey`s represent an inspection result without an icon/semantic mismatch (e.g., `dirty`'s paintbrush icon does not represent "failed").
- Moved the module-level `RESULT_META` constant inside the component as a themed `useMemo`, keeping the identifier unchanged so the pre-existing detail-modal reference required no textual edit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree branch was 47 commits behind `main`, missing the plan file itself and all of Phase 8 Waves 1-4**
- **Found during:** Startup (before Task 1)
- **Issue:** This worktree's branch (`worktree-agent-acbf4e2a82dca0abc`) was created before Phase 8 Waves 1-4 merged to `main`. `.planning/phases/08-floor-role-rollout/08-08-PLAN.md` did not exist locally, and required dependencies (the `08-00` theme-token additions `textDisabled`/`accentBrassSoft`/`accentBrassLine`/`surfaceSubtle` on `darkTheme`, plus the `Button`/`StateBlock`/`StatusBadge` call-site conventions established in Waves 1-4) were absent.
- **Fix:** Ran `git merge main --no-edit` in the worktree (clean fast-forward-style merge, no conflicts) to bring in all 47 commits before starting any task work.
- **Files modified:** none directly; brought in `.planning/phases/08-floor-role-rollout/08-00..08-07-*.md`, `apps/mobile/components/shared/tokens.ts` (Wave 0 keys), and all Wave 1-4 screen/component migrations already merged to `main`.
- **Verification:** `git log --oneline HEAD..main` returned empty after merge; `08-08-PLAN.md` present and readable; `theme.textDisabled` etc. present in `tokens.ts`.
- **Committed in:** merge commit (pre-existing on `main`, no new commit created by the merge itself since it was a fast-forward of already-published history)

**2. [Rule 3 - Blocking] `InspectorQueue.test.tsx` crashed with "useThemeMode must be used within a ThemeProvider" / "useToastActions must be used within a ToastProvider" after adding `useTheme()`/`useToast()` to the screen**
- **Found during:** Task 1 verification (`npx jest InspectorQueue.test.tsx`)
- **Issue:** The pre-existing test rendered `<InspectScreen />` directly with no provider wrapping; both new hooks throw when used outside their context providers.
- **Fix:** Added `ThemeProvider`/`ToastProvider` imports and a `renderScreen()` helper wrapping renders in `<ThemeProvider><ToastProvider>...</ToastProvider></ThemeProvider>`, matching the established pattern already used in `RoomDetail.test.tsx`/`WorkOrderDetail.test.tsx`/`RoomBoard.test.tsx`.
- **Files modified:** `apps/mobile/__tests__/screens/InspectorQueue.test.tsx`
- **Verification:** `npx jest InspectorQueue.test.tsx` — 2/2 passing.
- **Committed in:** `0f69d569` (Task 1 commit)

**3. [Rule 3 - Blocking] `apps/mobile` had no `node_modules` in this worktree**
- **Found during:** Task 1 verification (jest preset `jest-expo` not found)
- **Issue:** Fresh worktree checkout had never run `npm install` for the mobile workspace.
- **Fix:** Ran `npm install --legacy-peer-deps` inside `apps/mobile` (per the parallel-execution instructions — explicitly not a filesystem-junction workaround).
- **Files modified:** none tracked (node_modules is gitignored).
- **Verification:** `npx jest`, `npm run type-check`, `npm run lint` all run successfully afterward.
- **Committed in:** n/a (gitignored, no commit needed)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking issues necessary to reach a working, verifiable state before any task could be completed)
**Impact on plan:** No scope creep — all three were prerequisites for executing the plan as written, not new functionality. No plan task logic changed as a result.

## Issues Encountered
- Running the full mobile jest suite (`npx jest`, all 25 suites in parallel) showed 12 failures across `TasksVariationA.test.tsx`, `RoomDetail.test.tsx`, and `WorkOrderDetail.test.tsx` — all `Exceeded timeout of 5000ms`. None of these files were touched by this plan. Re-ran each failing suite individually and all passed (11/11, 8/8 total) — confirmed as parallel-worker resource-contention flakiness on a cold worktree (first full-suite run after `npm install`), not a real regression. Not logged to `deferred-items.md` since it isn't a code defect, just parallel-runner timing on this machine.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- This was the last plan (Wave 5 of 5) in Phase 8: Floor-Role Rollout. All 5 FLOOR-0X screens (My Rooms, Room Board, Work Orders, Tasks, Inspect) are now migrated onto Phase 7's primitives.
- Orchestrator should merge this worktree, then run the full Phase 8 verification pass (full jest suite, type-check, lint, and confirm zero `C.` refs across all 5 screens) before closing the phase.
- No blockers for Phase 9 (Remaining Screens Rollout) or Phase 10 (Dark Mode & Accessibility QA).

---
*Phase: 08-floor-role-rollout*
*Completed: 2026-07-30*
