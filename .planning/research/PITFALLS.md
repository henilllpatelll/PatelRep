# Pitfalls Research

**Domain:** Retrofitting a shared design-token + reusable-primitive system onto an already-shipped React Native / Expo (SDK 54, New Architecture, Hermes) app used live by hotel floor staff
**Researched:** 2026-07-28
**Confidence:** MEDIUM-HIGH — grounded in this repo's actual mobile source (`apps/mobile/`); RN framework behaviors are HIGH-confidence from documented behavior, this-app-specific claims verified against code.

> **Milestone phases referenced below**
> - **Phase A — Primitives/foundation:** build the token layer (theme hook/provider) + `Button`/`IconButton`, `Card`, `EmptyState`/`StateBlock`, `Toast`.
> - **Phase B — Floor-role rollout:** migrate My Rooms, Room Board, Work Orders, Tasks, Inspect.
> - **Phase C — Remaining rollout:** profile, supervisor, home dashboards.

---

## What the codebase actually looks like (grounding)

These facts shape every pitfall below and were verified in-repo, not assumed:

- **A token file already exists** at `apps/mobile/components/shared/tokens.ts`. It exports (a) a rich `lightTheme`/`darkTheme`/`shellTokens`/`statusTokens` set **and** (b) a flat `C` constant that is *statically built from `lightTheme` only*. Two parallel APIs for the same colors already exist — drift risk before you write a line.
- **There is no runtime theme switching today.** `useColorScheme`/`Appearance` appear in **zero** app files. `getThemeTokens(mode)` exists but is wired to nothing.
- **Screens bake colors into `StyleSheet.create` at module scope.** 48 files call `StyleSheet.create`. Most reference the light-only `C`; `copilot/index.tsx` instead imports `darkTheme` directly and hardcodes dark values into its module-scope stylesheet. So the app is a *mix* of statically-light and statically-dark screens with no reactive path.
- **`app.json` sets `userInterfaceStyle: "automatic"`** and a dark splash (`#1a1815`). The OS therefore believes the app supports dark mode, but the app does not actually react to it — a latent correctness gap the parity work will expose.
- **No `i18next/no-literal-string` lint gate on mobile.** The web app's D-03 bilingual contract is CI-enforced; the mobile package has no ESLint config enforcing it (verified: no `no-literal-string` rule anywhere in `apps/mobile`). i18n regressions on mobile are invisible to tooling.
- **Fragile build pipeline:** `babel.config.js` carries the `dynamic-import-node` plugin (the Hermes/Supabase dynamic-import fix); New Architecture is enabled on both platforms; install relies on `legacy-peer-deps` for React 19. Any new dependency can disturb all three.
- **Root layout does heavy lifting:** `app/_layout.tsx` owns auth hydration, the NetInfo→`syncOnConnect()` offline trigger, and notification deep-linking. A theme provider added here sits directly above that logic.

---

## Critical Pitfalls

### Pitfall 1: Assuming `StyleSheet.create` styles can be theme-reactive

**What goes wrong:**
Teams build the token/dark-mode layer, flip the device to dark, and half the app stays light (or, like `copilot`, stays dark in light mode). Colors don't move because they were frozen into `StyleSheet.create({...})` objects that run **once at module load**, before any theme context exists.

**Why it happens:**
`StyleSheet.create` is evaluated at import time and returns a static registry. Referencing `C.paper` or `darkTheme.background` inside it captures a literal, not a subscription. RN has no mechanism to re-run a module-scope stylesheet when `useColorScheme` changes. This app has 48 such files, and the existing `C` alias actively encourages the frozen-at-import pattern.

**How to avoid:**
Decide the reactivity pattern in **Phase A before migrating any screen**. Pick one and enforce it:
- A `useTheme()` hook returning the active token object, with per-screen styles built via `const styles = useMemo(() => makeStyles(theme), [theme])` where `makeStyles(theme) => StyleSheet.create({...})`; **or**
- Keep static structural stylesheets (layout/spacing only) and pass *color* props at render time (`style={[styles.card, { backgroundColor: theme.surface }]}`).
Whichever you choose, write it into the primitives first so screens copy the pattern rather than inventing 48 variants.

**Warning signs:**
- A migrated screen looks correct in the simulator's default appearance but you never actually toggled the OS theme.
- `grep` shows `darkTheme.` or `C.` *inside* a `StyleSheet.create` block in a "migrated" file.
- The token hook exists but screens still `import { C }`.

**Phase to address:** Phase A (set the pattern); verified continuously in B and C.

---

### Pitfall 2: Two sources of truth — the flat `C` alias vs. `lightTheme`/`darkTheme`

**What goes wrong:**
The new system adds `useTheme()`/`getThemeTokens`, but screens keep importing the legacy flat `C`. Now a color exists in two places; someone tweaks terracotta in `lightTheme` and the `C`-consuming screens don't move (or vice-versa). Parity with web silently drifts.

**Why it happens:**
`C` is convenient (`C.ink`, `C.paper`) and already imported across dozens of files. Retrofits rarely delete the old accessor on day one, so both live indefinitely and diverge.

**How to avoid:**
Treat `C` as **deprecated on contact**. Either (a) redefine `C` as a thin derivation that is only ever the light fallback and forbid new usage via a lint/grep gate, or (b) migrate each screen off `C` as part of its wave and track remaining `C` importers as the burndown metric. Do **not** add new tokens to `C`.

**Warning signs:**
- Count of files importing `C` isn't strictly decreasing wave over wave.
- A palette change requires editing two objects.

**Phase to address:** Phase A (freeze `C`), burned down across B and C.

---

### Pitfall 3: A new dependency breaks the EAS build via the Hermes/babel fault line

**What goes wrong:**
Reaching for a styling library (NativeWind, Restyle, Tamagui, Dripsy, styled-components) or a Toast/animation lib pulls in a transitive dep, a Reanimated/worklet requirement, or its own babel plugin. The `dynamic-import-node` fix, the New-Architecture requirement, or the `legacy-peer-deps` install then conflict — and the *EAS Android build* fails, not the local Metro dev server, so it's caught late.

**Why it happens:**
The build pipeline was hard-won and is under-documented tribal knowledge. Metro dev (Hermes-on-device with fast refresh) and the release EAS build exercise different code paths; a dep that "works in `expo start`" can still break the production bundle or a Gradle step. New Architecture (`newArchEnabled: true`) excludes libraries that haven't migrated off the old bridge.

**How to avoid:**
**Default to zero new runtime dependencies** — the token system is plain objects + a Context, and Button/Card/EmptyState/Toast are buildable from core RN (`Pressable`, `View`, `Text`, `Animated`) plus the already-present `react-native-safe-area-context` and `@expo/vector-icons`. If a dep is genuinely needed, before merging: (1) confirm New-Architecture support explicitly, (2) run a full **EAS build**, not just `expo start`, and (3) check it needs no babel-plugin ordering change relative to `dynamic-import-node`.

**Warning signs:**
- A PR adds a `babel.config.js` plugin or a `metro.config.js` change.
- Local dev is fine but the first EAS build after the change fails at bundling or Gradle.
- `npm install` emits new peer-dependency errors beyond the known React 19 ones.

**Phase to address:** Phase A — make the "primitives from core RN, no new deps" decision explicit; gate with an EAS build before Phase B starts.

---

### Pitfall 4: Primitives that regress bilingual (EN/ES) coverage

**What goes wrong:**
A `Button`/`EmptyState`/`Toast` primitive hardcodes an English default (`title = "No results"`, an internal `"Retry"` affordance, a `"Loading…"` string). Because mobile has **no `no-literal-string` lint gate**, this ships silently and Spanish users see English — a direct regression of the D-03 bilingual floor contract that the web milestone treats as a hard requirement.

**Why it happens:**
Primitives feel like "chrome," so authors add convenience defaults without threading `t()`. Spanish strings are also ~15–30% longer than English; a primitive with a fixed height, `numberOfLines={1}`, or no-wrap layout truncates or clips translated labels that fit in English.

**How to avoid:**
- Primitives accept **only** caller-provided strings (or `ReactNode` children) — no hardcoded user-facing text, no English defaults. Any internal affordance text takes a required `label` prop.
- Test every primitive and every migrated screen in **both** locales, and specifically with the longer Spanish strings, checking for truncation, wrapping, and button-width overflow.
- Add a mobile `i18next/no-literal-string` lint gate as part of Phase A so the rest of the rollout is protected (closes the tooling gap vs. web).

**Warning signs:**
- A primitive's props include a string default that renders to the user.
- Switching device language leaves any label in English.
- ES labels clip or force a button to a second line where EN didn't.

**Phase to address:** Phase A (primitive contract + lint gate); re-verified per screen in B and C.

---

### Pitfall 5: Root-level ThemeProvider re-rendering the tree and disturbing NetInfo/offline/auth

**What goes wrong:**
A `ThemeContext` provider is dropped into `app/_layout.tsx` above the existing auth-hydration, `NetInfo`→`syncOnConnect()`, and notification-deep-link effects. A theme change (or a provider whose `value` is a fresh object each render) re-renders the whole app subtree; in the worst case effects with unstable deps re-subscribe, and the offline-sync or auth listener churns.

**Why it happens:**
`app/_layout.tsx` is the natural home for a global provider, but it's already the busiest file in the app. Context consumers re-render on every value change, and a provider `value={{theme, toggle}}` built inline allocates a new object each render.

**How to avoid:**
- Memoize the provider value (`useMemo`) and keep theme state minimal (a single `"light"|"dark"` string derived from `useColorScheme()` + optional user override).
- Keep the theme provider **as a sibling wrapper**, not tangled into the auth/NetInfo effects; those effects already use empty dep arrays (`[]`) — do not add theme to their deps.
- Don't route offline/auth state through the theme context.

**Warning signs:**
- Console shows repeated "NetInfo listener attached" / auth-state re-subscribes after adding the provider.
- Offline banner flickers or a queued sync re-fires on a pure theme toggle.
- React DevTools shows the whole tree re-rendering on theme change.

**Phase to address:** Phase A (provider placement); regression-check in B (offline/role paths run through floor screens).

---

### Pitfall 6: Primitive `style` prop merge-order clobbers or is clobbered

**What goes wrong:**
A `Card`/`Button` merges styles as `style={[props.style, styles.base]}` (caller first) so the primitive's base *overrides* the caller — screen-specific spacing/color silently ignored. Or the reverse order drops a token default the primitive intended to enforce. During a 20+ screen migration, both orderings end up in the tree and behavior is inconsistent.

**Why it happens:**
RN array styles apply **left→right, last wins**, and `StyleSheet.flatten` follows the same order. It's easy to get backwards, and the bug only shows when a caller passes an overlapping key.

**How to avoid:**
Standardize one contract in Phase A: **base first, caller override last** — `style={[styles.base, variantStyle, props.style]}` — documented on every primitive. For conditional variants prefer explicit variant props (`variant="primary"`) over ad-hoc style overrides so the merge surface stays small.

**Warning signs:**
- A screen passes `style={{ marginTop: X }}` to a primitive and nothing moves.
- Two migrated screens using the same primitive look inconsistent.

**Phase to address:** Phase A (define contract), caught in B/C review.

---

### Pitfall 7: Expo Router navigation chrome doesn't inherit your tokens

**What goes wrong:**
Screen bodies get themed but the **tab bar, stack headers, screen background flash, and status bar** stay default. In dark mode the router's white default background flashes on transitions; the tab bar (the "Evening Lobby" dark chrome the tokens describe) doesn't match. Parity looks 90% done but the frame is wrong.

**Why it happens:**
Expo Router's `<Stack>`/`<Tabs>` use React Navigation's own `ThemeProvider` and `screenOptions`, which are **separate** from your token context. `app/_layout.tsx` currently renders a bare `<Stack screenOptions={{ headerShown:false }}>` and `<StatusBar style="auto" />`; those don't read your tokens. The tab bar is configured in the `(app)` layout, not the root.

**How to avoid:**
Explicitly theme the navigation layer: pass `sceneContainerStyle`/`contentStyle` background from the active theme, set `tabBarStyle`/`tabBarActiveTintColor` from `shellTokens`, and drive `StatusBar` style from the theme rather than `"auto"`. Wrap the router in React Navigation's `ThemeProvider` (or set `screenOptions` dynamically) so transition backgrounds match.

**Warning signs:**
- White/paper flash between screens in dark mode.
- Tab bar color doesn't match the designed dark chrome.
- Status bar icons invisible (dark-on-dark) on some screens.

**Phase to address:** Phase A (root + `(app)` layout theming); visible immediately in B.

---

### Pitfall 8: Role-gated tab registration breaks during screen restructuring

**What goes wrong:**
While migrating a floor screen, a file is renamed/moved or a route's default export changes, and `lib/navigation/roleTabs.ts` (which hardcodes `name: "my-rooms/index"` etc., plus `ALL_ROLE_TAB_ROUTES` and `HIDDEN_APP_ROUTES`) falls out of sync. Result: a tab 404s, a screen appears for the wrong role, or a hidden route surfaces as a tab. Because tabs are role-specific, the break may only show for one role (e.g. engineer) and pass unnoticed if you only test as a housekeeper.

**Why it happens:**
Route identity in this app is *string-matched* across three lists in `roleTabs.ts`, decoupled from the files. Design-system migration shouldn't touch routing — but "while I'm in here" edits do. (Note: `getTabsForRole` already contains a duplicated `case "engineer"` — evidence this file is easy to get subtly wrong.)

**How to avoid:**
Treat `roleTabs.ts` and file/route names as **frozen during the parity milestone** — this is a visual retrofit, not a navigation change. If a screen must move, update all three lists in the same commit and verify every role's tab set.

**Warning signs:**
- A tab shows a blank/404 screen after a "styling-only" PR.
- A route in `HIDDEN_APP_ROUTES` appears as a tab, or vice-versa.
- Only one role's navigation is broken.

**Phase to address:** Phase B and C (rollout waves touch these files' neighbors).

---

### Pitfall 9: Dark-mode contrast breaks the protected status-color contract

**What goes wrong:**
`statusTokens` (ready/clean/dirty/pickup/out-of-order) are a **shared contract with the web app** — "do not change their meanings or hues." In dark mode, the same saturated hues on a dark surface fail contrast, so someone "fixes" it by shifting a hue and silently breaks cross-platform meaning, or leaves the light `*Soft` fills (designed for paper) on dark surfaces where they're illegible.

**Why it happens:**
The tokens file *already* ships `darkStatusTokens` with adjusted `*Soft` alphas but keeps the core hues — a good pattern that's easy to bypass under time pressure by hand-tweaking a color in one screen.

**How to avoid:**
Route **all** status coloring through `darkStatusTokens`/`statusTokens` via the theme; never inline a status hex in a screen. Verify legibility of status chips/badges in dark mode using the provided dark `*Soft` fills, not the light ones. Keep core hues identical to web.

**Warning signs:**
- A status hex literal appears in a screen's `StyleSheet`.
- A room-status chip is unreadable in dark mode.
- A status hue differs between mobile and web for the same state.

**Phase to address:** Phase A (status accessors), enforced in B (Room Board/My Rooms are status-dense).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep the flat `C` alias alongside the new theme hook | Zero churn on unmigrated screens | Permanent dual source of truth; silent palette drift vs. web | Only as a *time-boxed* burndown; never as a permanent API |
| Ship primitives light-only, defer dark reactivity | Faster Phase A | Every screen re-touched later for dark; `userInterfaceStyle:"automatic"` keeps lying to the OS | Only if dark mode is explicitly cut from v1.1 scope in writing |
| Inline a status/theme hex "just this once" | Unblocks one screen | Breaks the web-shared status contract; invisible until a hue change | Never for status colors |
| Add a styling/Toast library to save writing primitives | Less code in Phase A | Risks the Hermes/New-Arch/legacy-peer-deps build fault line | Only after a passing EAS build proves compatibility |
| Migrate a screen without toggling OS dark mode to verify | Looks done faster | Frozen-stylesheet bug (Pitfall 1) ships | Never — dark toggle is a required check |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `useColorScheme()` (RN Appearance) | Reading it once at module scope or in a non-component | Read inside a component/hook; feed a memoized provider; allow a user override on top of system value |
| Expo Router `<Stack>`/`<Tabs>` | Assuming screen theming themes the navigator chrome | Theme React Navigation separately (`contentStyle`, `tabBarStyle`, `ThemeProvider`), drive `StatusBar` from theme not `"auto"` |
| `react-native-safe-area-context` (already present) | Hardcoding a themed background only inside the safe area, leaving notch/home-indicator insets default | Apply theme background to the outermost `SafeAreaView`/container so insets match |
| NetInfo offline banner + new `Toast` primitive | New Toast overlaps/duplicates the existing `OfflineBanner` (`components/shared/OfflineBanner.tsx`) | Define stacking/z-order and ownership up front; Toast must not cover the offline indicator |
| `dynamic-import-node` babel plugin | New dep quietly requires a conflicting babel plugin/order | No babel changes without a full EAS build; keep plugin list minimal |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Provider `value` allocated inline each render | Whole-tree re-render on any parent update; jank on theme toggle | `useMemo` the value; split theme context from unrelated state | Immediately on low-end Android floor devices |
| Rebuilding `StyleSheet.create` every render inside a component | GC churn, dropped frames in long `FlatList`s (Room Board, Tasks) | `useMemo(() => makeStyles(theme), [theme])`, not per-render | Visible on list-heavy floor screens with many rows |
| Re-themed `FlatList`/`ScrollView` rows not memoized | Scroll stutter after adding theme prop to row components | `React.memo` row primitives; keep row style deps stable | Room Board / My Rooms with 50–150 rooms |
| Passing new inline color objects to memoized children | `React.memo` defeated because color object identity changes | Pull colors from a stable theme object, not freshly-built literals | Any densely-rendered themed list |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| "Cosmetic" PR edits a screen that also carries a role check or tenant-scoped fetch | Silent RBAC/tenant regression on floor screens | Keep parity PRs style-only; do not touch `require_role`-equivalent guards or `hotel_id`-scoped API calls; diff-review for logic changes |
| Restructuring a screen drops a conditional data-fetch guard (role-gated queries) | Wrong role sees another role's data | Verify each migrated screen still fetches only its role's data (test as each role), per the existing role-gated fetch pattern |
| Logging/exposing token or theme state that carries user identifiers | Minor info leak | Theme state must be pure UI (`"light"/"dark"`), never carry auth/user data |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Truncated Spanish labels in fixed-size primitives | ES floor staff can't read actions | Test both locales with long ES strings; allow wrap / dynamic width |
| Shrinking tap targets during "cleanup" | Housekeepers with gloves/wet hands mis-tap | Keep ≥44pt hit targets in Button/IconButton; verify on-device, not simulator |
| Low-contrast dark-mode status chips | Misread room readiness on the floor | Use `darkStatusTokens` fills; verify legibility in dark |
| Inconsistent look mid-rollout (some screens new, some old) | Feels broken/untrustworthy to daily users | Migrate by coherent role-flow (all of a role's tabs together), not scattered screens |
| Losing the pull-to-refresh / offline affordance during restyle | Floor staff can't recover from stale data offline | Preserve existing refresh + `OfflineBanner` behavior in every migrated screen |

## "Looks Done But Isn't" Checklist

- [ ] **Dark mode:** Every migrated screen actually toggled via OS appearance — not just viewed in default. Verify no frozen light/dark `StyleSheet` (Pitfall 1).
- [ ] **Both locales:** Each screen and primitive rendered in EN *and* ES; no truncation, no English leaking through (Pitfall 4).
- [ ] **Navigator chrome:** Tab bar, headers, status bar, and transition background match the theme — no white flash in dark (Pitfall 7).
- [ ] **Offline path:** NetInfo banner + `syncOnConnect` still fire; Toast doesn't cover the offline indicator (Pitfall 5, Integration table).
- [ ] **Role gating:** Each role's tab set intact; each screen still fetches only its role's data (Pitfalls 8 + Security table). Test as housekeeper, engineer, supervisor, front_desk.
- [ ] **EAS build:** A real EAS Android build passes after Phase A / after any dep or babel change — not just `expo start` (Pitfall 3).
- [ ] **Status contract:** No status hex inlined; hues identical to web; dark fills legible (Pitfall 9).
- [ ] **`C` burndown:** Count of files importing the legacy `C` alias is strictly lower than last wave (Pitfall 2).
- [ ] **Tap targets:** Buttons/IconButtons ≥44pt, verified on a physical device.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Frozen `StyleSheet` (no dark reactivity) shipped across screens | HIGH | Retrofit `useMemo(makeStyles)` pattern per screen; the more screens migrated before catching it, the worse — hence set pattern in Phase A |
| Dual `C`/theme drift | MEDIUM | Grep `C` importers, migrate each, then delete/neuter `C`; one-time sweep |
| EAS build broken by a dep | MEDIUM-HIGH | Revert the dep; rebuild primitives from core RN; re-run EAS to confirm green before proceeding |
| i18n regression (English leaked) | MEDIUM | Add the `no-literal-string` lint gate, then fix flagged strings; without the gate, requires manual bilingual sweep |
| Role/tab registration broken | LOW-MEDIUM | Re-sync the three lists in `roleTabs.ts` with actual files; test every role |
| Navigator chrome unthemed | LOW | Localized to `_layout.tsx` + `(app)` layout; theme the navigator options |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Frozen `StyleSheet` / no reactivity | Phase A | Toggle OS dark on a migrated primitive/screen; colors move |
| 2. `C` vs theme dual source | Phase A (freeze) → B/C (burndown) | `C`-importer count decreases each wave |
| 3. Dep breaks EAS build | Phase A | Green EAS Android build before Phase B |
| 4. i18n regression in primitives | Phase A (contract + lint gate) | Both-locale render test per screen; lint passes |
| 5. Provider re-render churn | Phase A | No re-subscribe of NetInfo/auth on theme toggle (DevTools/log) |
| 6. Style merge order | Phase A | Caller `style` override actually applies on a test screen |
| 7. Unthemed navigator chrome | Phase A | No white flash; tab bar/status bar match theme in dark |
| 8. Role/tab registration break | Phase B & C | Every role's tabs load; hidden routes stay hidden |
| 9. Status-color contract in dark | Phase A → B | Status hues == web; dark chips legible |

## Sources

- **In-repo verification (HIGH):** `apps/mobile/components/shared/tokens.ts`, `apps/mobile/app/_layout.tsx`, `apps/mobile/lib/navigation/roleTabs.ts`, `apps/mobile/app.json`, `apps/mobile/babel.config.js`, `apps/mobile/package.json`; grep confirming zero `useColorScheme`/`Appearance` usage and no `no-literal-string` gate on mobile.
- **React Native documented behavior (HIGH):** `StyleSheet.create` static evaluation and array-style last-wins merge/`StyleSheet.flatten`; `useColorScheme`/`Appearance` API; New Architecture library-compatibility constraints.
- **Expo Router / React Navigation (MEDIUM):** separate `ThemeProvider` and `screenOptions` theming for navigator chrome vs. screen bodies.
- **Project context (HIGH):** `.planning/PROJECT.md` — v1.1 milestone scope, D-03 bilingual contract, floor-first rollout, EAS/Hermes/legacy-peer-deps constraints from milestone brief.

---
*Pitfalls research for: retrofitting a design-token + primitive system onto a shipped RN/Expo floor-staff app*
*Researched: 2026-07-28*
