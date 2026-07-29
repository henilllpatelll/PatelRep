# Architecture Research

**Domain:** Shared design-token + primitive-component layer for an existing Expo Router (SDK 54) React Native app
**Researched:** 2026-07-28
**Confidence:** HIGH (grounded in direct reading of `apps/mobile/` source, not training data)

> **READ THIS FIRST — the milestone premise is partly inaccurate and it changes the plan.**
> The task brief states mobile has "no theme file, no design tokens" and "zero shared UI layer."
> **That is not true of the current codebase.** Mobile already ships:
> - A mature token module at `apps/mobile/components/shared/tokens.ts` (the "Evening Lobby"
>   system) — light + dark palettes, the protected status color contract shared with web,
>   spacing (`S`), radius (`R`), AI/shell tokens. **46 of 52** component/screen files already
>   import it.
> - A real primitive layer in `apps/mobile/components/shared/mobileHandoff.tsx`
>   (`IconButton`, `Pill`, `SectionLabel`, `HeroButton`, `Segmented`, `ProgressRing`,
>   `AILabel`, `AIChip`, `Avatar`, `Mono`, …) plus `evening.tsx` (`StatusPill`, `StatusRail`,
>   `ProgressBar`, `Chip`, `RoomQueueCard`, `AIBriefingCard`, `SectionHeader`).
>
> So this milestone is **NOT** "introduce a shared layer into a bare app." It is **"consolidate
> and complete a shared layer that is ~70% built, fill the four genuinely-missing primitives,
> and — the real work — make the already-defined dark theme actually reactive."**
> The roadmap must be written against the *real* gaps below, not the assumed greenfield.

---

## What actually exists vs. what's missing (grounded gap analysis)

| Web primitive (from UI-REFRESH-PLAN §4) | Mobile equivalent today | Status |
|---|---|---|
| Design tokens (`globals.css`) | `components/shared/tokens.ts` (light+dark, status, R/S) | **EXISTS** — keep, don't rebuild |
| `Button` (variants/sizes/loading) | `HeroButton` only (single hero style) | **PARTIAL** — need general `Button` |
| `IconButton` | `mobileHandoff.tsx` `IconButton` | **EXISTS** |
| `Pill` / `StatusDot` / `SectionLabel` / `Mono` / `AILabel` | all in `mobileHandoff.tsx` + `evening.tsx` | **EXISTS** |
| `Card` | ad-hoc `styles.card` in `evening.tsx` `RoomQueueCard`; no standalone `Card` | **PARTIAL** — extract a `Card` |
| `EmptyState` | none — hardcoded "No rooms…" strings per screen | **MISSING** |
| `StateBlock` (loading/empty/error) | none — 38 files hand-roll `ActivityIndicator` | **MISSING** |
| `Toaster` + `useToast` | none — no provider anywhere | **MISSING** |
| Dark mode | **defined** in `tokens.ts` (`darkTheme`, `getThemeTokens`) but **not wired**: only **1** file uses `useColorScheme`; every screen reads the static light-only `C` snapshot | **DEFINED, UNWIRED** ← highest-risk work |

**The single most important architectural fact:** `tokens.ts` exports a flattened constant `C`
that is a **light-theme-only snapshot** (`C.paper = lightTheme.background`, etc.). All 46 consuming
files reference `C.*` inside `StyleSheet.create()`, which runs **once at module load**. There is no
theme context, no `useTheme()` hook, and no theme state in `stores/appStore.ts`. So "add dark mode"
is not a token task — the tokens are done. It is a **reactivity-plumbing task** touching how 46 files
resolve colors. This is the crux of the milestone and the roadmap must sequence it carefully.

---

## Standard Architecture

### Target layer structure (after milestone)

```
┌──────────────────────────────────────────────────────────────────┐
│                         SCREENS (app/**)                          │
│   Consume primitives + useTheme(); never hardcode hex             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ my-rooms │ │room-board│ │work-order│ │  tasks   │ │inspect │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘  │
├───────┴────────────┴────────────┴────────────┴──────────┴────────┤
│                    PRIMITIVES (components/ui/  ← NEW)              │
│   Button · Card · EmptyState · StateBlock            (+ existing   │
│   components/shared/: IconButton, Pill, SectionLabel, Chip, …)     │
├───────────────────────────────────────────────────────────────────┤
│              THEME LAYER (lib/theme/  ← NEW reactive shell)        │
│   ThemeProvider · useTheme() · Toast provider/useToast            │
│        ▼ resolves to ▼                                             │
│   TOKEN DATA (components/shared/tokens.ts  ← EXISTS, keep)         │
│   lightTheme · darkTheme · statusTokens · R · S · C(compat)       │
├───────────────────────────────────────────────────────────────────┤
│         PRESERVE UNTOUCHED (behavior — do not modify)             │
│  stores/appStore.ts (offline queue) · lib/offline/{db,sync}       │
│  i18n/ (EN/ES) · lib/navigation/roleTabs.ts (RBAC) · lib/api/**   │
└───────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `lib/theme/tokens.ts` (moved) or `components/shared/tokens.ts` (kept) | Raw palette/spacing/radius data, light + dark | Plain `const` objects (already built) |
| `lib/theme/ThemeProvider` + `useTheme()` (NEW) | Resolve active theme (light/dark/system) reactively, expose it to screens | React Context + `useColorScheme()` + persisted override in `appStore` |
| `components/ui/*` (NEW) | The four missing primitives (Button, Card, EmptyState, StateBlock) | RN `Pressable`/`View`, themed via `useTheme()` |
| `components/shared/*` (EXISTS) | Already-built atoms (IconButton, Pill, Chip, status cards) | Keep in place; theme-migrate in later waves |
| `lib/theme/Toast` + `useToast()` (NEW) | One app-wide toast queue; success/error/info | Context + a viewport mounted in `(app)/_layout.tsx` |

---

## Recommended Project Structure

```
apps/mobile/
├── lib/
│   └── theme/                    # NEW — the reactive shell around existing token DATA
│       ├── ThemeProvider.tsx     # Context provider; reads system scheme + appStore override
│       ├── useTheme.ts           # Hook → returns active theme object (same keys as `C`)
│       ├── ToastProvider.tsx     # App-wide toast queue + viewport component
│       └── useToast.ts           # Hook → { success, error, info }(alreadyTranslatedMsg)
├── components/
│   ├── ui/                       # NEW — the four missing primitives (mirror web components/ui/)
│   │   ├── Button.tsx            # variants(primary/secondary/ghost/destructive) · size(sm/md/lg) · loading
│   │   ├── Card.tsx              # extract the RoomQueueCard shell into a reusable surface
│   │   ├── EmptyState.tsx        # icon + title + body + optional action
│   │   └── StateBlock.tsx        # status: loading|empty|error → renders children when data present
│   └── shared/                   # EXISTS — leave structure intact
│       ├── tokens.ts             # KEEP as the token source (or re-export from lib/theme; see below)
│       ├── mobileHandoff.tsx     # IconButton, Pill, SectionLabel, HeroButton, … (already good)
│       └── evening.tsx           # StatusPill, StatusRail, Chip, RoomQueueCard, …
└── app/
    ├── _layout.tsx               # mount <ThemeProvider> here (wraps everything, incl. auth)
    └── (app)/_layout.tsx         # mount <ToastProvider>/<ToastViewport> here (authed surfaces)
```

### Structure Rationale — where the token file should live (the brief's explicit question)

**Recommendation: do NOT relocate the token file to `constants/theme.ts` or `lib/theme/tokens.ts`
in a way that breaks the 46 existing imports.** The brief asks whether tokens should live in
`lib/theme/` or `constants/theme.ts`; the honest answer given the real codebase is: **the token
DATA already has a home that works — keep `components/shared/tokens.ts` as the canonical import
path.** Two acceptable variants, in preference order:

1. **Keep-in-place (lowest risk, recommended):** Leave `tokens.ts` where it is. Add the *reactive*
   layer (`ThemeProvider`, `useTheme`) in `lib/theme/`, importing the raw data from
   `components/shared/tokens.ts`. Zero import churn; the new folder holds only the new reactive code.
2. **Move-with-shim (cleaner long-term, moderate risk):** Move the raw data to `lib/theme/tokens.ts`
   and make `components/shared/tokens.ts` a one-line re-export (`export * from "@/lib/theme/tokens"`).
   No consumer breaks, but it's a churny rename for aesthetics — only do it if the roadmap wants
   `lib/theme/` to be the obvious single home. **Not worth doing mid-milestone; defer.**

Why not `constants/theme.ts`: this repo has no `constants/` convention (no such folder exists),
and the web app keeps tokens in CSS, not a constants file — so there is no cross-app symmetry to
gain. Follow the mobile app's own established convention: shared visual code lives under
`components/shared/` and app-wide logic/providers under `lib/`. **Tokens (data) → `components/shared/`
(already there). Theme provider/hook (reactive logic) → `lib/theme/` (new).**

- **`lib/theme/`:** reactive/stateful concerns (context, hooks, persistence). Mirrors how `lib/`
  already holds `offline/`, `navigation/`, `api/` — non-visual app plumbing.
- **`components/ui/`:** new pure primitives, mirroring the web app's `components/ui/` so a developer
  crossing web↔mobile finds Button/Card/EmptyState/StateBlock in the same-named folder.
- **`components/shared/`:** the existing atom grab-bag stays; don't reshuffle it (churn = regression risk).

---

## Architectural Patterns

### Pattern 1: `useTheme()` hook + `makeStyles(theme)` factory (the dark-mode enabler)

**What:** Replace direct static reads of the `C` constant inside `StyleSheet.create()` with a hook
that returns the *active* theme, and a `makeStyles` factory so stylesheets can be theme-parameterized.
**When to use:** Every screen/component that must respond to light↔dark. Adopt progressively.
**Trade-offs:** `StyleSheet.create()` is evaluated once, so themed styles must either move color props
inline (`style={[styles.card, { backgroundColor: theme.surface }]}`) or be built per-render via a
memoized factory. The inline approach is smallest-diff and matches the code's existing habit
(`evening.tsx`/`atoms.tsx` already pass `{ backgroundColor: meta.bg }` inline). **Prefer inline color
props over a full makeStyles rewrite** — it lets a screen go theme-reactive by touching only its color
lines, not its whole StyleSheet.

**Example:**
```typescript
// lib/theme/useTheme.ts
export function useTheme() {
  const mode = useThemeMode();               // 'light' | 'dark', from ThemeProvider
  return useMemo(() => getThemeTokens(mode), [mode]);  // getThemeTokens already exists in tokens.ts
}

// in a screen — smallest-diff migration: keep the static layout StyleSheet,
// pull only *colors* from the reactive theme.
const theme = useTheme();
<View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} />
```

### Pattern 2: Back-compat `C` bridge during migration

**What:** Keep the existing static `C` export (light-only) alive so unmigrated screens keep working,
while new/migrated screens use `useTheme()`. Retire `C` only after the last screen migrates.
**When to use:** Throughout the floor-first rollout — you cannot flip 46 files atomically.
**Trade-offs:** Two color-access styles coexist temporarily (a known, bounded inconsistency). This is
the price of not shipping one giant risky commit. Track remaining `C.` references as the burn-down metric.

### Pattern 3: Provider-mounted overlays (Toast) at the authed-layout root

**What:** Mount `<ToastProvider>` (and its viewport) in `app/(app)/_layout.tsx`, and `<ThemeProvider>`
in `app/_layout.tsx` (so login is themed too). `useToast()` returns `{success,error,info}` taking an
**already-translated** string (same contract the web `useToast` uses — translation stays in the caller
so the i18n floor gate is satisfied).
**When to use:** Any create/update/delete feedback; replaces per-screen `Alert.alert`/local banners.
**Trade-offs:** One more provider in the tree; negligible. Big win: consistent feedback, no per-screen state.

---

## Data Flow

### Theme resolution flow

```
system appearance (useColorScheme)  ─┐
appStore.themeOverride ('system'|…) ─┼─► ThemeProvider ─► useTheme() ─► screen color props
persisted via AsyncStorage          ─┘        (Context)      (hook)      (inline on StyleSheet)
```

### Toast flow

```
mutation success/error ─► useToast().success(t('key')) ─► ToastProvider queue ─► ToastViewport (top of (app))
```

### Do-not-disturb boundaries (these flows must remain byte-for-byte unchanged)

1. **Offline sync:** `stores/appStore.ts` queue (`enqueueAction`/`flushQueue`) ↔ `lib/offline/{db,sync}.ts`
   ↔ `syncOnConnect` in `app/_layout.tsx`. Presentation work must not touch this.
2. **i18n floor contract:** every floor string renders via `useTranslation()/t()`; new primitive copy
   (empty-state titles, retry labels, toast text) needs keys in **both** `i18n` EN + ES with parity.
3. **RBAC navigation:** `lib/navigation/roleTabs.ts` decides which tabs each role sees. Do not widen or
   reorder role access as a side effect of restyling the tab bar. *(Note: `getTabsForRole` has a
   duplicate `case "engineer":` at lines 106–107 — a pre-existing lint smell, not this milestone's job,
   but worth a one-line cleanup if a wave touches that file.)*

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (single hotel, ~6 roles, ~26 screens) | Context-based theme + a flat `components/ui/` is exactly right. No over-engineering needed. |
| More screens / more primitives | Keep primitives flat in `components/ui/`; only add subfolders (`ui/forms/`, `ui/feedback/`) past ~15 primitives. |
| Perf on low-end devices | `useTheme()` returns a memoized object; inline color props are cheap. Avoid rebuilding whole StyleSheets per render (that's the `makeStyles` anti-risk). |

### Scaling Priorities

1. **First bottleneck:** dark-mode re-render correctness, not throughput — a missed screen shows a
   light card in dark mode. Mitigation: the `C.` burn-down metric + a dark-mode QA wave.
2. **Second bottleneck:** i18n key parity as primitives add copy — enforce EN/ES parity every wave.

---

## Anti-Patterns

### Anti-Pattern 1: Relocating/rewriting the token file "to do it properly"

**What people do:** Delete `components/shared/tokens.ts`, author a fresh `constants/theme.ts`, rewire 46 imports.
**Why it's wrong:** Pure churn with high regression surface on a working, web-aligned token set; the
tokens are already correct and already match the protected status contract.
**Do this instead:** Keep the token data where it is; add only the missing *reactive* layer around it.

### Anti-Pattern 2: Flipping all 46 screens to `useTheme()` in one wave

**What people do:** One giant "make it themeable" commit.
**Why it's wrong:** Un-reviewable, breaks the wave-by-wave verify gate, and any one missed inline color
silently ships a broken dark surface. High chance of regressing offline/i18n-adjacent screens.
**Do this instead:** Ship the provider + `useTheme()` with **light as the only active mode first**
(zero visual change), migrate screens floor-first, then enable the dark toggle in the final QA wave —
mirroring the web plan's Wave 0 (build tools, no screen change) → floor-first → Wave 6 (dark/a11y).

### Anti-Pattern 3: Re-implementing primitives that already exist

**What people do:** Build a new `IconButton`/`Pill`/`SectionLabel` in `components/ui/` unaware they
already live in `mobileHandoff.tsx`.
**Why it's wrong:** Duplicate, drifting implementations — the exact "20 screens reinvent buttons" problem
this milestone exists to prevent.
**Do this instead:** Build **only** the four confirmed-missing primitives (Button, Card, EmptyState,
StateBlock) + the Toast/theme providers. Reuse existing atoms; theme-migrate them, don't clone them.

---

## Integration Points

### Files a token/primitive rollout touches FIRST (floor-role, highest priority)

| Surface | Screen file(s) | Feature-component file(s) |
|---|---|---|
| My Rooms (housekeeper) | `app/(app)/my-rooms/index.tsx`, `[roomId].tsx` | `evening.tsx` (`RoomQueueCard`), `housekeeping/*Modal.tsx` |
| Room Board (supervisor) | `app/(app)/room-board/index.tsx`, `room-status/index.tsx` | `supervisor/atoms.tsx`, `supervisor/RoomDetailSheet.tsx` |
| Work Orders (engineer) | `app/(app)/work-orders/index.tsx`, `[woId].tsx` | `engineering/{WorkOrderCard,CreateWorkOrderModal,EngineerHome}.tsx` |
| Tasks | `app/(app)/tasks/index.tsx` | `tasks/TaskCard.tsx` |
| Inspect | `app/(app)/inspect/index.tsx` | `housekeeping/ChecklistSection.tsx` |

### Internal boundaries (must stay decoupled)

| Boundary | Communication | Notes |
|----------|---------------|-------|
| primitives ↔ theme | `useTheme()` hook only | Primitives never import raw `darkTheme`/`lightTheme` directly |
| screens ↔ offline queue | `appStore` actions | Restyle must not read/write queue shape |
| tab bar ↔ RBAC | `roleTabs.ts` | Restyle the bar's chrome; never change which tabs a role gets |
| new copy ↔ i18n | `t()` + EN/ES keys | Every primitive string is a translated key with parity |

---

## Recommended rollout order (phase-sized, mirroring web Wave 0→6)

> Maps the web plan's proven "primitives-first, floor-role-first, dark/a11y-last" sequence onto
> phase-sized chunks. Each phase is independently shippable and self-verified on device before the next.

| Phase | Web-wave analog | Scope | Screen changes? | Risk |
|---|---|---|---|---|
| **P0 — Foundation** | Wave 0 | Add `lib/theme/` ThemeProvider + `useTheme()` (light-active only, zero visual change); build `Button`, `Card`, `EmptyState`, `StateBlock` in `components/ui/`; add `ToastProvider`+`useToast`; add generic i18n keys (EN/ES). Mount providers in `_layout.tsx`. | **No** existing screen changed | Low |
| **P1 — Floor buttons & states** | Waves 1–3 | Roll `Button`/`StateBlock`/`EmptyState`/`useToast` through the **floor-role screens** (My Rooms, Room Board, Work Orders, Tasks, Inspect) + their feature components. Replace hand-rolled TouchableOpacity buttons, `ActivityIndicator` loaders, hardcoded "No X" strings, and `Alert.alert` feedback. | Floor screens only | Medium |
| **P2 — Remaining screens** | Waves 1–3 (cont.) | Same rollout across profile, supervisor home, companion home, guest-requests, lost-found, logbook, alerts, staff, sop. | Non-floor screens | Medium |
| **P3 — Theme reactivity** | (mobile-specific) | Migrate screens' **color reads** from static `C` to `useTheme()` inline props, floor-first then rest; burn `C.` references down. Still light-only visually. | All themed screens | **High** ← gated, incremental |
| **P4 — Dark mode + a11y QA** | Wave 6 | Enable the dark toggle (persist override in `appStore`); dark-parity sweep on every migrated screen; contrast/touch-target/reduced-motion audit; verify offline-sync, i18n parity, and RBAC nav all still pass. | QA/fixes only | Medium |

**Why this order is safe for the three fragile subsystems:**
- **Offline-sync:** P0–P2 are presentation-only and never import `lib/offline` or mutate `appStore`'s
  queue; P4's only `appStore` addition is a `themeMode` field, orthogonal to the queue.
- **i18n:** every phase adds keys in EN+ES with a parity check; primitives take pre-translated strings
  so the no-literal-string floor gate keeps passing.
- **RBAC nav:** the tab bar's *chrome* may be restyled, but `roleTabs.ts` role→tab mapping is never
  edited; verify a housekeeper still sees exactly the housekeeper tab set after any nav restyle.

---

## Sources

- Direct source read (HIGH confidence): `apps/mobile/components/shared/tokens.ts`,
  `components/shared/{evening.tsx,mobileHandoff.tsx}`, `components/supervisor/atoms.tsx`,
  `lib/navigation/roleTabs.ts`, `stores/appStore.ts`, `app/_layout.tsx`, and file/grep census
  (46/52 files import tokens; 414 raw `TouchableOpacity`; 1 file uses `useColorScheme`; no Toast/EmptyState/StateBlock).
- `.planning/UI-REFRESH-PLAN.md` — the web app's executed Wave 0→6 plan (the pattern being mirrored).
- `.planning/PROJECT.md` — milestone v1.1 goal and locked decisions (shared-primitives-first, floor-role-first).
- Expo SDK 54 / React Native `StyleSheet.create` + `useColorScheme` behavior (HIGH — stable, long-standing API).

---
*Architecture research for: mobile design-token + primitive layer (v1.1 Mobile UI Parity)*
*Researched: 2026-07-28*
