---
phase: 34-management-admin-sections
plan: 06
subsystem: ui
tags: [react, nextjs, tailwind, i18n, flag-gating, ai-copilot]

# Dependency graph
requires:
  - phase: 34-management-admin-sections
    provides: "34-01's aiCopilot i18n namespace (creditUsage.loading key), frozen en.ts/es.ts"
provides:
  - "AI Copilot page flag-gated behind isSectionRedesigned('aiCopilot', hotel)"
  - "v2-token-ified chat shell/composer chrome (message list, composer wrapper, textarea)"
  - "CreditUsageCard loading skeleton (isLoading-gated) with byte-unchanged hardcoded values"
affects: [34-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shape 3 (chat UI) redesign: flag applied to chrome-only classNames, no StateBlock introduced for chat-level errors (errors stay as chat bubbles)"
    - "Deliberate non-fix preserved: CreditUsageCard's hardcoded $0.00/0% values unchanged regardless of query success/failure, only isLoading gates a skeleton"

key-files:
  created: []
  modified:
    - "apps/web/app/(dashboard)/ai/page.tsx"

key-decisions:
  - "Message-list scroll container given v2 border/bg/rounded chrome (rounded-[var(--r-lg)] border border-line bg-surface p-3) plus duration-fast/ease-standard, matching the card-style chrome already used elsewhere on this page (Examples/Recent panels)"
  - "Composer textarea gets its own v2 focus-visible ring (border-none/outline-none preserved since the parent composer div already owns the visible border) rather than restructuring the input's DOM"
  - "Send/Clear buttons deliberately left untouched beyond the frozen Button primitive's own hover/focus/disabled/transition treatment (FOCUS_RING + transition-colors duration-150, baked into Button.tsx) — no page-level override applied, since Button.tsx is frozen and other Phase 33/34 plans establish the precedent of only v2-tokenizing plain wrapper elements, never Button's own classes"
  - "aiCopilot.creditUsage.loading consumed as sr-only status text alongside the v2 skeleton (not visible copy), since the skeleton itself is the visual loading affordance"

patterns-established: []

# Metrics
duration: ~20min
completed: 2026-08-18
---

# Phase 34 Plan 06: AI Copilot Summary

**AI Copilot chat shell/composer chrome v2-token-ified behind `isSectionRedesigned('aiCopilot', hotel)`; CreditUsageCard gains an `isLoading`-gated skeleton while its pre-existing hardcoded $0.00/0% values stay byte-unchanged — zero behavior change to the chat error-as-message pattern.**

## Performance

- **Duration:** ~20 min
- **Started:** ~2026-08-18T21:13Z
- **Completed:** 2026-08-18T21:28Z
- **Tasks:** 2
- **Files modified:** 1 (`apps/web/app/(dashboard)/ai/page.tsx`)

## Accomplishments
- `isSectionRedesigned('aiCopilot', hotel)` read once via `useHotelStore`, threaded to `PageHeader`'s `dataI18nSkip` and to `CreditUsageCard`
- Message-list scroll container, composer wrapper, and textarea v2-token-ified (`duration-fast`/`ease-standard`/`focus-visible:ring-[var(--focus-ring)]`); legacy branch byte-unchanged
- Confirmed (via live code read + grep) the chat error-as-message pattern (`sendMessage`'s catch → `addAiMsg`), the typing indicator's `motion-safe:animate-bounce` dots, and `ConfirmView`/`TaskConfirmView`'s use of `Button`'s frozen `loading` prop are all completely untouched — no `StateBlock` introduced for chat-level errors
- `CreditUsageCard`'s `useQuery` destructure extended to `{ data, isLoading }` (no `isError`); a v2-gated `Skeleton` placeholder renders while loading, consuming `aiCopilot.creditUsage.loading` as sr-only text; the pre-existing hardcoded `$0.00`/`0%`/query-count JSX is byte-identical to before this plan in both loading-complete states (success or failure)
- `AICopilotBubble.tsx` confirmed untouched (last commit `01995635`, from Phase 13 — unrelated to this plan)

## Task Commits

Each task was intended to be committed atomically, but a cross-plan git-index race (documented below, same class already observed and documented by sibling plan 34-03) changed where Task 1's content physically landed:

1. **Task 1: Flag + v2-token-ify chat shell/composer chrome** — content correctly and completely present, but committed under `ad0c94b4` ("feat(34-03): EditStaffModal schedulesQuery/customRolesQuery loading skeleton + error+retry") — see Deviations
2. **Task 2: CreditUsageCard — loading skeleton without altering hardcoded values** — `e27773e0`

_Note: an earlier attempt to commit Task 1 alone produced `c0d770cc`, which no longer exists in branch history (superseded/orphaned by a concurrent sibling's index operation) — its content is not lost, it is present verbatim inside `ad0c94b4`, confirmed via diff/grep._

## Files Created/Modified
- `apps/web/app/(dashboard)/ai/page.tsx` — flag read once; chat shell/composer chrome v2-token-ified; `CreditUsageCard` gains a v2 loading skeleton without changing its rendered values; legacy branch unchanged

## Decisions Made
- See `key-decisions` in frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cross-plan git-index race swept this plan's staged Task 1 hunks into a sibling's commit**
- **Found during:** Attempting to split the single-file diff into two atomic per-task commits (staged Task 1's hunks via targeted `Edit` reverts, then `git add "ai/page.tsx" && git commit`)
- **Issue:** This plan runs in parallel with five sibling plans (34-02..34-05, 34-07) sharing one git working tree/index (no worktrees, no commit serialization). The first `git commit` for Task 1 (`c0d770cc`) unexpectedly included a sibling's `settings/feedback/page.tsx` hunk — a concurrent sibling (34-04) had staged its own file moments before this agent's `git add`/`git commit` ran, and since `git commit` commits the entire index, both landed together. Before this could be corrected, a different concurrently-running sibling (34-03, Staff) ran its own unscoped `git commit`, which itself swept up this plan's already-staged/committed Task 1 hunks for `ai/page.tsx` at a later index state — `c0d770cc` was superseded/orphaned in the process, and Task 1's actual code ended up durably recorded inside `ad0c94b4` ("feat(34-03): EditStaffModal...") instead of its own commit.
- **Fix:** Verified via `git diff`/`grep` that Task 1's code is present in `ad0c94b4` completely and correctly (flag read, `dataI18nSkip`, message-list/composer/textarea v2 chrome), matching this plan's must_haves exactly — no rework needed. Did **not** amend, reset, or rewrite `ad0c94b4` — per git safety policy and because sibling agents were still actively racing on the same index; rewriting shared history mid-race risks corrupting other agents' work far more than accepting a mislabeled-but-correct commit. Re-verified the working tree was clean and consistent (`tsc --noEmit` clean project-wide for `ai/page.tsx`) before proceeding to re-apply and commit Task 2 on top of the new HEAD.
- **Files modified:** None beyond what this plan already intended — the mislabeling is a git-history attribution issue, not a code defect.
- **Verification:** `npx tsc --noEmit` clean (zero errors attributable to `ai/page.tsx`) after the fix; full gate suite (`type-check`, `build` all 43 routes, `check:frozen-files` 7/7, `check:contrast` 10 pairings both modes, `check:i18n-parity` 1570 keys, `verify:i18n-gate`) green against the final committed state
- **Committed in:** `ad0c94b4` (Task 1, shared with sibling 34-03's own commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - Blocking, a coordination/attribution issue in git history from true parallel execution across 6 sibling plans sharing one repository, not a defect in this plan's code)
**Impact on plan:** Zero impact on `ai/page.tsx`'s code correctness — the deviation is purely about which commit hash Task 1's content is attributed to. Both this plan's tasks are durably present in branch history and pass the full gate suite. This is the same systemic class of race independently documented by sibling plan 34-03 (and referenced by 34-07) during this session.

## Issues Encountered
- See Deviations above — a single cross-plan git-index race, resolved without any code rework or history rewriting.
- A transient "Another next build process is already running" collision occurred on the first `npm run build` attempt (sibling plans building concurrently) — resolved by retrying once the repo tree was clear of in-flight sibling edits; the final build ran clean (43/43 routes).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- AI Copilot's flag-gating and narrow-scope chrome tokenization is complete and gate-clean, ready for 34-08's close-out verification alongside the other wave-2 plans
- Flag key confirmed as `'aiCopilot'` for `isSectionRedesigned('aiCopilot', hotel)` toggling, consistent with the other Phase 34 section keys
- Deferred item for 34-08's close-out sweep (per 34-01's own note, unchanged by this plan): AI Copilot's chat-message error copy is deliberately left as plain English/API-message text, not run through i18n — errors surface as AI-role chat bubbles by design, not a page-level state
- Flagged for the orchestrator (same class as 34-03/34-07's observation): this session hit one cross-plan git-index race while running 6 parallel plans against one shared git index — a systemic coordination gap worth addressing via git worktrees per parallel plan or serialized commit windows in a future session

---
*Phase: 34-management-admin-sections*
*Completed: 2026-08-18*

## Self-Check: PASSED
- FOUND: apps/web/app/(dashboard)/ai/page.tsx
- FOUND: .planning/phases/34-management-admin-sections/34-06-SUMMARY.md
- FOUND commit: ad0c94b4 (Task 1, shared with sibling 34-03's own commit — see Deviations)
- FOUND commit: e27773e0 (Task 2)
