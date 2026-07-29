---
phase: 07-theme-foundation-primitives
reviewed: 2026-07-29T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - apps/mobile/lib/theme/ThemeProvider.tsx
  - apps/mobile/lib/theme/useTheme.ts
  - apps/mobile/app/_layout.tsx
  - apps/mobile/lib/theme/ToastProvider.tsx
  - apps/mobile/lib/theme/useToast.ts
  - apps/mobile/app/(app)/_layout.tsx
  - apps/mobile/components/ui/Button.tsx
  - apps/mobile/components/shared/mobileHandoff.tsx
  - apps/mobile/components/ui/Card.tsx
  - apps/mobile/components/ui/StatusBadge.tsx
  - apps/mobile/components/ui/EmptyState.tsx
  - apps/mobile/components/ui/StateBlock.tsx
  - apps/mobile/i18n/locales/en.json
  - apps/mobile/i18n/locales/es.json
  - apps/mobile/eslint.config.mjs
  - apps/mobile/package.json
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: fixed
resolution: "All 3 WARNING findings fixed in commit 2df209a5. 3 INFO findings left as-is (deferred/cosmetic, non-blocking)."
---

# Phase 7: Code Review Report

**Reviewed:** 2026-07-29T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 7 builds the reactive theme shell (ThemeProvider/useTheme), a Toast system
(ToastProvider/ToastViewport/useToast), five UI primitives (Button, Card,
EmptyState, StateBlock, StatusBadge), the IconButton theme-wire in
mobileHandoff.tsx, and an i18next ESLint gate.

Contract checks the phase context flagged as high-risk all PASS:

- **Byte-identical IconButton colors:** All 13 tones in the new theme-wired
  `toneColors` resolve to the exact same light-mode hex values as the pre-phase
  module-level map. The previously-caught blocker (neutral → `surfaceMuted`) is
  correctly applied: old `C.surface3`/`C.ink2`/`C.line` = new
  `theme.surfaceMuted`/`theme.textSecondary`/`theme.border` =
  `#F0EBE1`/`#766D63`/`#E4D6C4`. No color regression.
- **No hardcoded status hex in primitives:** StatusBadge, EmptyState, Card,
  StateBlock, and the IconButton wire all source colors through `useTheme()`.
  The documented `low` fallback in StatusBadge correctly uses themed neutrals.
- **Provider memoization:** ThemeProvider memoizes `{mode}` on a constant mode
  (stable, children never re-render from it). ToastProvider correctly splits
  actions/state into two contexts so `useToast()` consumers do not re-render on
  toast state changes. Both are correct.
- **No i18n floor violations in primitives:** StatusBadge/StateBlock/EmptyState
  take caller-translated strings; no hardcoded user-facing English.
- **Dependency placement:** `eslint`, `eslint-plugin-i18next`, and
  `@typescript-eslint/parser` are all in `devDependencies` — no STACK.md
  "zero new runtime deps" violation.
- **Locale parity:** `common.errorGeneric.{title,body}` was added to both en.json
  and es.json with matching key structure.

No BLOCKER-level defects found. Three WARNING and three INFO items below.

## Warnings

### WR-01: IconButton adds unconditional `accessibilityRole="button"` with no handler or label

**File:** `apps/mobile/components/shared/mobileHandoff.tsx:139-140`
**Issue:** The phase added `accessibilityRole="button"` (and an optional
`accessibilityLabel`) to the IconButton's root `View`. IconButton has no
`onPress` — it is a purely decorative icon container. All 8 existing call sites
(`home/index.tsx:155,273,330`, `notifications/index.tsx:112`, `sop/index.tsx:79,95`,
`lost-found/index.tsx:143`, `SupervisorHome.tsx:179`) render it **without**
passing `accessibilityLabel`. Net effect for screen-reader users:
1. Every IconButton now announces as a "button" that has no name and does
   nothing when activated — an unlabeled, no-op control.
2. `SupervisorHome.tsx:179` wraps IconButton in a real `TouchableOpacity`, so the
   decorative inner View now claims button semantics nested inside the actual
   button — double/ambiguous announcement.
This is an accessibility-semantics regression introduced by the change (the
element was a plain non-interactive View before).
**Fix:** Make the role conditional on interactivity, or mark it non-actionable.
Since IconButton is decorative and the real press target is the parent:
```tsx
// Option A — treat as image when no label is provided:
accessibilityRole={accessibilityLabel ? "button" : "image"}
accessibilityLabel={accessibilityLabel}

// Option B — if it should never be its own a11y node (parent carries semantics):
// drop accessibilityRole and add:
importantForAccessibility="no-hide-descendants"
```

**Resolution (commit 2df209a5):** Dropped the forced `accessibilityRole="button"`. The View is now `accessible={!!accessibilityLabel}` — only exposed to the accessibility tree when a caller actually supplies a label, with no role claim on a non-interactive element.

### WR-02: ToastViewport exit callback ignores `finished`, dropping a toast shown mid-exit

**File:** `apps/mobile/lib/theme/ToastProvider.tsx:92-99, 101-119`
**Issue:** `runExit()` calls `dismiss()` unconditionally in the animation
completion callback. When a new toast is shown while the current one is in its
150ms exit animation (auto-dismiss fade-out, or after a swipe-dismiss), the
entrance animation for the new toast starts on the same shared `Animated.Value`s
(`translateY`/`opacity`). Starting a new animation on a value stops the in-flight
exit animation and invokes its completion callback with `{ finished: false }` —
but `runExit`'s callback ignores the argument and calls `dismiss()` →
`setToast(null)`, immediately clearing the brand-new toast. The new toast
silently disappears. Reachable whenever two toasts occur within ~150ms or a new
toast fires during a swipe-out.
**Fix:** Guard on the `finished` flag so an interrupted exit does not dismiss:
```tsx
]).start(({ finished }) => {
  if (finished) dismiss();
});
```

**Resolution (commit 2df209a5):** Applied exactly this fix.

### WR-03: StateBlock silently defaults required copy to empty strings

**File:** `apps/mobile/components/ui/StateBlock.tsx:54, 65, 72`
**Issue:** `emptyTitle ?? ""`, `errorMessage ?? ""`, and `retryLabel ?? ""` mean
that if a caller forgets to pass these, StateBlock renders a blank title, a blank
error message, and — worse — a retry `Button` with an empty `label` (a tappable
button with no visible text). Because the primitive deliberately delegates
translation to callers (correct per the i18n floor contract), a missing prop
produces a silently broken empty state rather than an obvious failure, which is
easy to ship unnoticed.
**Fix:** Only render the pieces whose copy is actually provided, so an omitted
prop degrades gracefully instead of drawing an empty control:
```tsx
action={
  onRetry && retryLabel ? (
    <Button label={retryLabel} onPress={onRetry} variant="secondary" size="md" />
  ) : undefined
}
```
(and consider omitting the title `<Text>` when the string is empty).

**Resolution (commit 2df209a5):** Converted `StateBlockProps` to a discriminated union keyed on `status` — `emptyTitle`/`errorMessage` are now required TypeScript props (no `?? ""` fallback possible), and `onRetry` without `retryLabel` throws at render instead of silently rendering an unlabeled button. Stronger than the suggested fix since it's a compile-time guarantee, not just a runtime conditional.

## Info

### IN-01: Local `toneColors` shadows the module-level `toneColors`

**File:** `apps/mobile/components/shared/mobileHandoff.tsx:119`
**Issue:** IconButton declares a block-scoped `const toneColors` with the same
name and shape as the module-level `toneColors` (line 31, still used by `Pill`
and `RoomNumberTile`). The shadowing is intentional (theme-reactive vs. static
tokens) and behaves correctly, but a reader scanning the file can easily assume
the two are the same map. Consider renaming the local one (e.g.
`themedToneColors`) for clarity.
**Fix:** Rename the in-component map to disambiguate from the module constant.

### IN-02: Button hardcodes `#FFFFFF` foreground instead of a theme token

**File:** `apps/mobile/components/ui/Button.tsx:54, 71`
**Issue:** `fg = "#FFFFFF"` for the `primary` and `destructive` variants is a raw
hex rather than a themed value. This is consistent with the existing "white text
on colored surface" convention across mobileHandoff (no `onPrimary` token exists
yet), so it is acceptable for Phase 7's light-only scope. Flagging for Phase 10:
verify white-on-`primaryAction` contrast holds for the dark theme
(`primaryAction` dark = `#7EA889`).
**Fix:** When a themed on-primary/on-accent token is introduced (Phase 10),
source the foreground from it instead of the literal.

### IN-03: ThemeProvider reads and discards `useColorScheme()`

**File:** `apps/mobile/lib/theme/ThemeProvider.tsx:11`
**Issue:** `const _systemScheme = useColorScheme();` is read and never used
(mode is hardcoded `"light"`). This is intentional groundwork for Phase 10 and is
documented by the adjacent comment, but note it causes ThemeProvider to re-render
on OS light/dark toggles today. Children are shielded by the `useMemo([mode])`
value, so there is no functional impact.
**Fix:** None required now; the Phase 10 wire (`mode = _systemScheme`) will make
the read meaningful.

---

_Reviewed: 2026-07-29T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
