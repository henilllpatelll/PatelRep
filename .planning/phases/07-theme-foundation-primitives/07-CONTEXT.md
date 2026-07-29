# Phase 7: Theme Foundation & Primitives - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the foundation every later v1.1 phase depends on, with **zero visible change to any existing screen**:

1. A reactive theme shell (`ThemeProvider`/`useTheme()`) around the already-existing `tokens.ts` token data, built light-only-active for now.
2. A `ToastProvider`/`useToast()` app-wide, as a non-blocking alternative to `Alert.alert()`.
3. Four genuinely-missing shared primitives: `Button`/`IconButton`, `Card`, `EmptyState`/`StateBlock`, `StatusBadge`.
4. A mobile `i18next/no-literal-string` CI lint gate (mobile has none today; web does).

This is **not** a greenfield build — `apps/mobile/components/shared/tokens.ts` (light+dark palettes, protected status contract, spacing/radius) and a real partial primitive layer (`mobileHandoff.tsx`, `evening.tsx`) already exist and are reused, not replaced. No existing screen adopts the new primitives in this phase — that's Phase 8/9. Dark mode is not enabled in this phase — that's Phase 10.

</domain>

<decisions>
## Implementation Decisions

### Toast behavior & placement
- **D-01:** Toast renders at the top of the screen, positioned below the existing `OfflineBanner` (which renders inline, not absolutely positioned today) — both stay visible together, never overlapping.
- **D-02:** Auto-dismiss timing: 3s for success, 5s for error. Swipe-to-dismiss available before that.
- **D-03:** Only one toast visible at a time — a new toast replaces whatever's currently showing (no stacking/queueing).
- **D-04:** Toast is purely informational — tapping it does nothing. `useToast()` exposes `{ success, error, info }`, each taking an already-translated string (translation stays in the caller, satisfying the i18n floor contract).

### Button/IconButton scope
- **D-05:** The existing `HeroButton` (`mobileHandoff.tsx`) is left untouched. The new `Button` is a separate, general-purpose primitive — no HeroButton call sites change in this phase.
- **D-06:** `Button` variants: `primary` / `secondary` / `ghost` / `destructive` (mirrors web's Button variant set per PROJECT.md's parity goal).
- **D-07:** `Button` sizes: `sm` / `md` / `lg`. Loading state replaces the label with a spinner in the button's existing color — no layout shift (button keeps its size/position).
- **D-08:** `IconButton` (already exists in `mobileHandoff.tsx`) is kept as-is structurally — this phase only theme-wires it to read colors via `useTheme()` instead of the static `C` constant. No new variant/size surface added to it.

### StatusBadge convention
- **D-09:** `StatusBadge` formalizes `WorkOrderCard`'s existing color+icon pairing (Ionicons: `warning`, `flash`, `checkmark`, etc.) as the canonical icon set — not a fresh icon design. `WorkOrderCard` itself isn't migrated to use it yet (that's Phase 8).
- **D-10:** `StatusBadge` covers **both** room-status states (ready/clean/dirty/pickup/out-of-order) and work-order priority/SLA states (warning/flash/overdue), via a single component with a status-key prop, since both families already share `statusTokens`/`darkStatusTokens`.
- **D-11:** `StatusBadge` always renders icon + label + color together — no icon-only/compact escape hatch, to guarantee UI-04's "never color alone" requirement can't be silently bypassed by a future screen.
- **D-12:** `StatusBadge` reads status colors through `useTheme()` (resolving to `statusTokens`/`darkStatusTokens`) from day one, even though only light mode is active in Phase 7. This makes it already dark-mode-correct before Phase 10, avoiding a second touch of this file during the highest-risk dark-mode QA phase.

### EmptyState/StateBlock
- **D-13:** Loading state: same `ActivityIndicator` pattern the 38 files already hand-roll today, just centralized into `StateBlock` — no new loading-UI design in this phase (skeleton loader is explicitly deferred, not built now).
- **D-14:** Error state: icon + message + an optional `onRetry` callback prop. If provided, renders a `Button` (the new primitive) to retry; if omitted, shows message only. No caller is forced to wire retry.

### i18n lint gate scope
- **D-15:** The new `i18next/no-literal-string` CI gate covers `components/ui/` (the 4 new primitives) **plus** the existing floor-facing screens and their feature components: My Rooms, Room Board, Work Orders, Tasks, Inspect (`app/(app)/my-rooms/**`, `room-board/**`, `room-status/**`, `work-orders/**`, `tasks/**`, `inspect/**`, and `components/housekeeping/`, `components/engineering/`, `components/tasks/` equivalents). Non-floor screens (profile, supervisor home, etc.) are not yet in scope — they get added gate-by-gate as Phase 9 migrates them.
- **D-16:** The gate is a **hard CI failure**, mirroring web's `i18next/no-literal-string` gate exactly — not a warning. Matches I18N-01's success criteria ("CI fails a mobile PR that introduces a raw JSX string literal").

### Claude's Discretion
- Exact file/folder layout inside `components/ui/` and `lib/theme/` (already strongly recommended by `.planning/research/ARCHITECTURE.md`'s "Recommended Project Structure" — follow it unless research/planning surfaces a reason not to).
- Whether the reactive shell's provider `value` needs any additional memoization beyond the standard `useMemo` pattern already called out in `PITFALLS.md` Pitfall 5.
- Exact ESLint rule configuration/plugin choice to implement the `no-literal-string` gate on mobile (web's existing config is the reference implementation).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (already completed for this milestone — read first)
- `.planning/research/SUMMARY.md` — executive summary of the whole v1.1 milestone; confirms this is a completion/wiring milestone, not greenfield.
- `.planning/research/ARCHITECTURE.md` — grounded gap analysis (what exists vs. missing), recommended project structure (`lib/theme/`, `components/ui/`), the `useTheme()`/`makeStyles` pattern, the `C`-bridge migration pattern, and the phased rollout order (P0–P4) this milestone's phases 7–10 map onto.
- `.planning/research/PITFALLS.md` — all 9 critical pitfalls (frozen `StyleSheet.create`, `C` vs. theme dual source, EAS build fragility, i18n regression, provider re-render churn, style merge order, unthemed navigator chrome, role-tab breakage, dark-mode status contrast) with phase-to-pitfall mapping. Phase 7 is explicitly the "prevention phase" for Pitfalls 1, 3, 4, 5, 6, 7, 9.
- `.planning/research/FEATURES.md` — must-have/should-have/do-not-build feature list for the primitives.
- `.planning/research/STACK.md` — confirms zero new npm dependencies; all primitives buildable from already-installed packages.

### Project & roadmap
- `.planning/PROJECT.md` §"Current Milestone: v1.1 Mobile UI Parity" — milestone goal, target features, out-of-scope list, and the locked decision "Mobile UI parity built as shared primitives first, not screen-by-screen."
- `.planning/ROADMAP.md` §"Phase 7: Theme Foundation & Primitives" — the 5 success criteria this phase must satisfy.
- `.planning/REQUIREMENTS.md` — full text of THEME-01, THEME-02, UI-01, UI-02, UI-03, UI-04, I18N-01.

### Existing code (source of truth for tokens/patterns — do not rebuild)
- `apps/mobile/components/shared/tokens.ts` — the "Evening Lobby" token system: `lightTheme`, `darkTheme`, `statusTokens`, `darkStatusTokens`, `shellTokens`, `R`/`S` spacing/radius scales, `getThemeTokens(mode)`, and the legacy flat `C` constant. Keep in place; do not relocate.
- `apps/mobile/components/shared/mobileHandoff.tsx` — existing primitives (`IconButton`, `Pill`, `SectionLabel`, `HeroButton`, `Segmented`, `Avatar`, `Mono`, `AILabel`, …). Reuse, don't reclone.
- `apps/mobile/components/shared/evening.tsx` — `StatusPill`, `StatusRail`, `ProgressBar`, `Chip`, `RoomQueueCard`. `RoomQueueCard`'s ad-hoc card shell is the reference for extracting `Card`.
- `apps/mobile/components/engineering/WorkOrderCard.tsx` — reference implementation for `StatusBadge`'s icon+color pairing convention (Ionicons `warning`/`flash`/`checkmark`/etc.).
- `apps/mobile/components/shared/OfflineBanner.tsx` — renders inline (no absolute positioning) — Toast must be positioned relative to this, not on top of it.
- `apps/mobile/lib/navigation/roleTabs.ts` — frozen during this milestone; do not touch as part of this phase (has a pre-existing unrelated duplicate-case lint smell, not in scope).
- `apps/mobile/stores/appStore.ts`, `apps/mobile/app/_layout.tsx` — offline-sync queue and root layout; theme/toast providers must not disturb these (Pitfall 5).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tokens.ts`'s `getThemeTokens(mode)` already exists and is fully wired to return `lightTheme`/`darkTheme` — `useTheme()` just needs to call it reactively via `useColorScheme()` (currently unused anywhere in the app).
- `IconButton`, `Pill`, `Chip`, `StatusPill` in `mobileHandoff.tsx`/`evening.tsx` are already good and get theme-migrated in place later, not rebuilt now.
- `WorkOrderCard.tsx`'s inline icon+color status rendering is the direct reference for `StatusBadge`.

### Established Patterns
- **Inline color props over `makeStyles` rewrite:** the codebase's existing habit (`evening.tsx` already passes `{ backgroundColor: meta.bg }` inline) — new primitives should keep static layout `StyleSheet.create` and pull only colors from `useTheme()` at render time.
- **Style merge order:** base styles first, caller override last — `style={[styles.base, variantStyle, props.style]}` — must be documented and applied consistently across all 4 new primitives.
- **No hardcoded user-facing strings in primitives** — every primitive takes caller-provided strings/`ReactNode`, no English defaults, to satisfy the i18n floor contract and the new lint gate.

### Integration Points
- `app/_layout.tsx` mounts `<ThemeProvider>` (wraps everything, including auth/login).
- `app/(app)/_layout.tsx` mounts `<ToastProvider>`/`<ToastViewport>` (authed surfaces only).
- Primitives (`components/ui/`) consume `useTheme()` only — never import raw `lightTheme`/`darkTheme` directly.

</code_context>

<specifics>
## Specific Ideas

- Toast sits directly below the existing `OfflineBanner`, never covering it — the two are visually stacked, not competing for the same slot.
- `StatusBadge`'s icon+color+label triplet is a direct lift of `WorkOrderCard`'s existing convention, not a new design.
- Button's loading state must not shift the button's size/position — spinner replaces the label in-place.

</specifics>

<deferred>
## Deferred Ideas

- Skeleton-loader `StateBlock` variant — explicitly deferred out of Phase 7 (research's "should have," not required for zero-visual-change foundation work). Candidate for a later polish pass, not blocking Phase 8/9.
- Extending `IconButton` to a full variant/size system matching `Button` — deferred; `IconButton` is theme-wired only in this phase, structural changes considered later if a screen genuinely needs it.
- `roleTabs.ts` duplicate `case "engineer"` cleanup — noted in research as a pre-existing lint smell; explicitly out of this phase's scope, opportunistic cleanup only if a later wave touches neighboring code.
- Non-floor-screen i18n lint gate coverage (profile, supervisor, etc.) — deferred to Phase 9 as those screens migrate.

### Reviewed Todos (not folded)
None — no pending todos existed at discussion time (`gsd-tools list-todos` returned 0).

</deferred>

---

*Phase: 7-Theme Foundation & Primitives*
*Context gathered: 2026-07-28*
