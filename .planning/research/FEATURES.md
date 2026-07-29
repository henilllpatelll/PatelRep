# Feature Research

**Domain:** Hotel-staff-facing native mobile app (housekeeping/engineering floor operations) — v1.1 Mobile UI Parity
**Researched:** 2026-07-28
**Confidence:** HIGH (grounded in the actual `apps/mobile` + `apps/web` codebase; native-UX conventions from RN/HIG/Material)

## Context Grounding (what already exists on mobile)

Findings below are grounded in the current `apps/mobile` source, not assumptions:

- **Design tokens** (`components/shared/tokens.ts`): a full token system already exists — `statusTokens` (protected status-color contract shared with web: teal ready, blue clean, rose dirty/occupied, amber pickup, stone OOO), plus **`darkTheme`, `darkStatusTokens`, `darkAiTokens` are already defined but NOT wired to runtime**. `C` (the constant every screen imports) is hardcoded to `lightTheme`. No `useColorScheme` / `Appearance` call exists anywhere in the app.
- **Status color+icon pairing** (`components/engineering/WorkOrderCard.tsx`): already done well — `CATEGORY_META` pairs an Ionicon with each color, urgency is shown via icon+text chip (`warning`/`flash`) not color alone, and a left urgency rail reinforces state. This table-stakes pattern is largely *met*, not missing — parity work is about spreading the same discipline to every screen.
- **Loading/empty states**: ad hoc per screen. `my-rooms/index.tsx` rolls its own `ActivityIndicator` centered block and its own `emptyCard`/`emptyTitle`/`emptyText` styles, repeated (with drift) across ~20 screens. No shared `EmptyState`/`StateBlock` primitive.
- **Feedback**: no toast/snackbar exists. Success/failure is signalled today via blocking native **`Alert.alert`** (+ `expo-haptics`) — 65 occurrences across 20 files. Alert is a modal that interrupts one-handed flow and requires a tap to dismiss.
- **Navigation**: native already uses `expo-router` `<Tabs>` with role-filtered tabs (`getTabsForRole`) + a floating AI-copilot FAB (`app/(app)/_layout.tsx`). The web `MobileFloorNav` is a browser-viewport concern and does **not** map to a real native tab bar.
- **Density**: web `uiPreferencesStore` exposes `density: comfortable|balanced|dense` applied as a global CSS data-attribute on `DashboardShell` for information-dense desktop dashboards. Nothing analogous exists on mobile.

## Feature Landscape

### Table Stakes (Users Expect These)

Features a floor-ops native app is expected to have. Missing = the parity milestone fails its own goal.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Shared **StateBlock** primitive (loading / empty / error in one component) | Every list screen loads over a flaky hallway connection; today each screen reinvents "Loading…" + empty card with visual drift | **MEDIUM** | Replaces ad hoc `ActivityIndicator`+`emptyCard` in ~20 screens. One component, three states (spinner, empty w/ icon+title+hint, error w/ retry). **Depends on Stack primitive/token work.** Migrate floor screens first (My Rooms, Room Board, Work Orders, Tasks, Inspect). |
| Shared **EmptyState** (icon + title + hint, optional action) | "All rooms done" / "No work orders" are frequent, positive states for floor staff — must feel intentional, not blank | **LOW–MEDIUM** | Effectively the empty branch of StateBlock; can ship as one component. Reuse existing copy keys already in `en.json`/`es.json` (`rooms.allRoomsDone`, etc.). |
| **Button / IconButton** primitive with size variants + loading state | Primary floor actions (Start, Done, Claim, Submit) must show in-flight state so a housekeeper doesn't double-tap on lag; today `WorkOrderCard` hand-rolls a claim button with inline `ActivityIndicator` | **MEDIUM** | Native equivalent of web's unified Button. Must guarantee ≥44pt (iOS) / 48dp (Android) touch targets and thumb-reach placement. Loading state = spinner replacing label, disabled press. **Depends on Stack primitive work.** |
| **Card** as the single container primitive | Web collapsed to one Card pattern; mobile has near-duplicate card styles (`WorkOrderCard`, `TaskCard`, `RoomQueueCard`, `emptyCard`) with subtly different border/shadow/radius | **LOW–MEDIUM** | Extract shared surface/border/shadow/radius; keep card *content* bespoke per domain. Low risk, high consistency payoff. |
| **Toast / inline feedback** system (non-blocking) | Success ("Room submitted") and recoverable failure ("Saved offline, will sync") must not block the next action with a modal; current `Alert.alert` interrupts one-handed shift work | **MEDIUM** | Single app-level toast host (top or bottom, respecting safe-area + tab bar). Pair with `expo-haptics` (already a dependency) for success/error taps. Reserve `Alert.alert` for destructive confirms only. |
| **Status color + icon pairing everywhere** (never color alone) | Bright lobby glare and dim hallways defeat color-only encoding; accessibility (color-blind staff) demands redundant icon/text | **LOW** | Already correct in `WorkOrderCard`; parity = auditing every status surface (room chips, task priority, WO status) to guarantee an icon or text label always accompanies the hue. Formalize as a `StatusBadge` primitive so it can't regress. |
| **Dark mode** (wire the tokens that already exist) | Night-shift and dim-hallway use; tokens are *already authored* (`darkTheme`) so not shipping it wastes done work and diverges from web (which has light/dark) | **MEDIUM** | Bulk of cost is mechanical: replace the hardcoded `C = lightTheme` constant with a theme-context/hook (`useTheme`) and migrate ~20 screens off the static `C` import. Respect OS `useColorScheme` + a manual override in Profile. **Depends on Stack token/theme-context work — this is the single largest parity dependency.** |

### Differentiators (Competitive Advantage)

Not required for parity, but align with the Core Value ("save a housekeeper/engineer time on the floor").

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Haptic feedback on state transitions** | A confirming buzz on "Done"/"Claim" lets staff confirm an action succeeded without looking — genuinely faster one-handed | **LOW** | `expo-haptics` already imported in several screens; standardize (success = `notificationAsync(Success)`, error = `Error`) and bundle into the Button/Toast primitives so it's automatic. |
| **Optimistic UI + offline toast** ("Saved offline, syncing") | The app already has NetInfo offline sync; surfacing it via toast turns a silent behavior into visible trust | **MEDIUM** | Builds on existing `OfflineBanner` + `loadPendingActions`. The toast system (table stakes) is the prerequisite. |
| **Large-target "glove/bright-light" affordances** | Floor staff wear gloves and work in glare; oversized primary buttons + high-contrast status chips reduce mis-taps | **LOW** | Falls out of the Button primitive if min target sizes and contrast are enforced as defaults rather than per-screen. |
| **Skeleton loaders on list screens** | Skeletons feel faster than spinners for predictable list layouts (My Rooms, Work Orders) | **MEDIUM** | Nice polish, not parity-critical. Can be a variant of StateBlock's loading state added after the floor rollout. |

### Anti-Features (Commonly Requested, Often Problematic)

Web patterns that should **NOT** be ported to native, with reasons.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Density modes (comfortable / balanced / dense)** | Web has 3 levels via `uiPreferencesStore`; "parity" tempts copying it | **Web-specific.** Density is a *desktop information-density* control for cramming more rows onto a large dashboard viewport. A phone screen shows one task list for one role; there is no information-density tradeoff to tune. It would add a settings toggle no floor user needs, multiply layout test surface across ~20 screens, and fight the "big thumb-reachable targets" requirement (dense = smaller targets = more mis-taps with gloves in glare). **Do not port.** | Ship one, correct, generously-spaced density tuned for gloved one-handed use. If space is ever tight, fix that screen's layout, not a global knob. |
| **Web `MobileFloorNav` component** | It has "Mobile" in the name and handles floor-role navigation | **Web-browser artifact.** It's a responsive-web nav for floor roles viewing the site in a phone *browser*. Native already has a real `expo-router` tab bar with role filtering + FAB. Porting it would duplicate/native-conflict with the platform tab bar. **Do not port the component**; port the *intent* (clear thumb-reachable primary nav), which native already satisfies. | Polish the existing native `<Tabs>` (active/inactive states, badge, safe-area) to match the refreshed visual language — not a new nav component. |
| **Accent-color picker (terracotta/teal/blue/rose)** | Web `uiPreferencesStore` exposes `accent`; parity tempts copying | **Low-value on native, high-risk.** The status-color contract is *protected* (tokens.ts explicitly says don't change meanings/hues); a user-swappable accent risks colliding with semantic status hues and confusing readability in the field. Floor staff want speed, not theming. | Ship the fixed terracotta/forest brand accent. Offer *only* light/dark, not accent choice. |
| **Full modal `Alert.alert` for success feedback** | It's the path of least resistance and already used 65× | **Blocks one-handed flow.** A modal that must be dismissed after every successful action is friction on a task-repetition device. | Non-blocking toast (table stakes) for success + recoverable errors; reserve `Alert.alert` strictly for destructive confirmations. |

## Feature Dependencies

```
[Stack: design-token file + theme context (useTheme)]
    └──required by──> [Dark mode]  (replace hardcoded C = lightTheme)
    └──required by──> [Button/IconButton primitive]
    └──required by──> [Card primitive]
    └──required by──> [StateBlock / EmptyState primitive]
    └──required by──> [StatusBadge (color+icon) primitive]

[StateBlock] ──contains──> [EmptyState] (empty is one StateBlock branch)
[Toast system] ──required by──> [Optimistic offline toast]
[Button primitive] ──absorbs──> [Haptic feedback] (bake in, don't scatter)
[Button primitive] ──absorbs──> [Large-target affordances] (enforce min sizes as default)

[Density modes] ──conflicts──> [Large thumb-reachable targets]  (dense shrinks targets)
```

### Dependency Notes

- **Everything depends on the Stack token/theme work.** The single highest-leverage prerequisite is replacing the static `C = lightTheme` constant with a theme context/hook. Until that lands, dark mode is impossible and every primitive would bake in the light palette. This is the gating item for the whole milestone — flag it to the roadmap as Wave 0.
- **StateBlock and EmptyState should ship as one component**, not two — empty is just one branch alongside loading and error. Splitting them re-creates the drift the milestone is trying to remove.
- **Haptics and touch-target sizing should be absorbed into the Button/Toast primitives**, not left as per-screen concerns — otherwise they regress the moment a new screen is added (the exact failure mode the "shared primitives first" decision in PROJECT.md is meant to prevent).
- **Density conflicts with the core constraint.** It cannot coexist with the "big thumb-reachable targets for gloved/glare use" requirement, which is why it's an anti-feature rather than a deferred feature.

## MVP Definition

### Launch With (v1.1 core — floor-role parity)

Minimum to call floor-role screens "at parity."

- [ ] **Theme context / `useTheme`** replacing hardcoded `C` — unblocks everything (Stack dependency)
- [ ] **Button / IconButton** primitive (size variants + loading + baked-in min touch target + haptic)
- [ ] **Card** primitive (single shared surface)
- [ ] **StateBlock** (loading / empty / error, with retry) + **EmptyState**
- [ ] **StatusBadge** (color+icon, never color alone) covering room + work-order + task states
- [ ] **Toast** system (non-blocking, safe-area aware) replacing `Alert.alert` for success/recoverable feedback
- [ ] **Dark mode** wired to OS `useColorScheme` + manual override, applied to the 5 floor screens (My Rooms, Room Board, Work Orders, Tasks, Inspect)

### Add After Validation (v1.x — remaining screens)

- [ ] Migrate remaining screens (Profile, supervisor, home dashboards) onto the primitives — *trigger:* floor-role rollout verified in production
- [ ] Optimistic offline toast ("Saved offline, syncing") — *trigger:* Toast system proven on floor screens
- [ ] Skeleton-loader variant of StateBlock — *trigger:* spinner-vs-skeleton feels worth the polish

### Future Consideration (v2+)

- [ ] Per-screen layout tuning if any screen proves cramped — *defer:* only if a real screen needs it; never a global density knob

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Theme context (`useTheme`) replacing static `C` | HIGH (gates all else) | MEDIUM | P1 |
| Button/IconButton primitive (+loading, +haptic, +target size) | HIGH | MEDIUM | P1 |
| StateBlock / EmptyState primitive | HIGH | MEDIUM | P1 |
| Toast (non-blocking feedback) | HIGH | MEDIUM | P1 |
| StatusBadge (color+icon everywhere) | HIGH | LOW | P1 |
| Card primitive | MEDIUM | LOW | P1 |
| Dark mode (wire existing tokens) on floor screens | MEDIUM–HIGH | MEDIUM | P1 |
| Haptic feedback standardized | MEDIUM | LOW | P2 |
| Optimistic offline toast | MEDIUM | MEDIUM | P2 |
| Skeleton loaders | LOW–MEDIUM | MEDIUM | P3 |
| Density modes | NEGATIVE | MEDIUM | **Do not build** |
| Accent-color picker | LOW | LOW | **Do not build** |
| Port web `MobileFloorNav` | NONE (native has tabs) | — | **Do not build** |

**Priority key:** P1 = must have for floor-role parity · P2 = add during remaining-screen rollout · P3 = polish

## Competitor / Platform Convention Analysis

| Concern | iOS (HIG) | Android (Material 3) | Our Approach |
|---------|-----------|----------------------|--------------|
| Transient feedback | Toast-style overlays / no native toast | Snackbar (non-blocking, bottom, optional action) | One cross-platform toast host, bottom-anchored above tab bar, safe-area aware; haptic pairing |
| Blocking confirms | `UIAlertController` | `AlertDialog` | RN `Alert.alert` — reserved for destructive actions only |
| Loading | Activity indicator / skeletons | Circular progress / skeletons | Shared StateBlock: spinner now, skeleton variant later |
| Theming | System light/dark via `useColorScheme` | System day/night | Follow OS by default + manual override in Profile; **no** accent/density choice |
| Touch targets | ≥44pt | ≥48dp | Enforced as Button primitive default, not per-screen |

## Sources

- `apps/mobile/components/shared/tokens.ts` — existing token system incl. unused `darkTheme` (HIGH)
- `apps/mobile/app/(app)/_layout.tsx` — existing native tab nav + FAB (HIGH)
- `apps/mobile/app/(app)/my-rooms/index.tsx` — ad hoc loading/empty pattern (HIGH)
- `apps/mobile/components/engineering/WorkOrderCard.tsx` — existing color+icon status pairing (HIGH)
- `apps/mobile` grep: 65 `Alert.alert`/`Haptics` uses across 20 files; zero toast/`useColorScheme` (HIGH)
- `apps/web/stores/uiPreferencesStore.ts` — web density/accent/theme prefs, establishing density as a web-desktop concept (HIGH)
- `.planning/PROJECT.md` — v1.1 milestone scope, "shared primitives first" decision, floor-role priority (HIGH)
- Apple HIG / Material 3 native interaction conventions (MEDIUM — established platform guidance)

---
*Feature research for: hotel-staff native mobile UI parity (v1.1)*
*Researched: 2026-07-28*
