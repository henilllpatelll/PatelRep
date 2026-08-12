# Phase 10: Dark Mode & Accessibility QA - Research

**Researched:** 2026-07-30  
**Domain:** Expo 54 / React Native appearance preference, Expo Router chrome, WCAG AA, Android release verification  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### Appearance control and persistence
- Profile exposes three choices: **System**, **Light**, and **Dark**.
- **System** is the default when no preference has been saved, including for existing users receiving the feature. It follows the phone's current appearance.
- While System is selected, an OS appearance change applies immediately even if PatelRep is already open.
- The explicit choice persists across app restarts on the device. Cross-device/account synchronization is not part of this phase.
- Use a directly visible, full-width three-option segmented control in Profile. Each option must have an accessible selected state and at least a 44pt touch target; EN and ES labels must fit without becoming ambiguous.
- Theme changes are immediate, with no crossfade or decorative animation.

### Dark visual treatment
- Use PatelRep's existing warm-charcoal **Evening Lobby** character: layered warm dark surfaces rather than neutral black or a generic blue-gray dark theme.
- Preserve forest green as the primary action family. Do not introduce accent customization.
- Preserve the universal operational status mapping across themes: green inspected/ready, blue clean/inspection-ready, purple in progress, red vacant dirty, striped red occupied, yellow pickup, and gray/stone out of order or out of service.
- Status hues may be adjusted in brightness or saturation where necessary to pass contrast, but their meaning must never change. Statuses continue to use label/icon/pattern cues so color is never the only signal.
- Navigator headers, tab bars, and status bar use a deeper warm-charcoal shell than content surfaces to make navigation boundaries clear. All chrome must resolve to the active theme on the first rendered frame, with no light/dark flash.
- Cards, sheets, modals, banners, and Toasts use layered theme surfaces and visible borders where needed; elevation must not depend on shadow alone in dark mode.
- Keep the Phase 9 D-11 Copilot dark lock and its dark-only tokens. Do not force it through light-theme surface tokens merely to make every route structurally identical.

### Accessibility acceptance bar
- Every migrated route and its meaningful loading, empty, error, modal/sheet, banner, badge, and Toast states must be checked in both light and dark mode.
- WCAG AA is the release bar: at least 4.5:1 for normal text and 3:1 for large text, essential icons, controls, focus/selection indicators, and meaningful non-text boundaries.
- Interactive controls must retain at least a 44x44pt target. Adjacent controls must remain distinguishable and operable without relying on precision taps.
- Theme controls, icon-only actions, status controls, and navigation expose meaningful accessibility labels, roles, selected/disabled/busy state, and a logical screen-reader order.
- Run a 200% text-scaling smoke pass across representative high-frequency workflows and every navigation shell. Fix clipped or hidden actions that block task completion; do not redesign content or add a separate density system.
- Theme switching itself uses no animation. Any existing motion encountered during QA must respect the OS reduced-motion preference where the platform exposes it.

### Verification and closeout evidence
- Add focused automated coverage for the appearance preference default, persistence, explicit Light/Dark overrides, live System-mode changes, and navigator/status-bar theme wiring.
- Add an automated contrast contract for shared theme tokens and semantic status combinations. Automated token checks supplement, but do not replace, rendered-screen inspection.
- Run the full mobile unit suite, type-check, lint/i18n gate, and production export/build checks after implementation.
- A successful full EAS **Android** production build is mandatory, with its build identifier/link recorded in the phase verification artifact. iOS build work remains outside v1.1.
- Complete a real Android device or emulator walkthrough covering all migrated routes in both light and dark mode. Exercise the distinct housekeeper, engineer, supervisor, front-desk, and GM navigation/RBAC shells.
- Exercise EN and ES in both themes, including narrow layouts and the Profile appearance control. No English fallback is acceptable in Spanish staff-facing UI except proper/brand names.
- Exercise offline-capable floor workflows while disconnected and after reconnect, confirming OfflineBanner/Toast layering, queued state, and synchronization behavior are unchanged.
- Record results, contrast findings/fixes, build evidence, and any accepted limitations in `10-VERIFICATION.md`. Phase 10 cannot be declared complete from static analysis or automated tests alone; the Android walkthrough is a human verification gate.

### Claude's Discretion
- Exact token values and the smallest contrast-safe adjustments, provided the locked visual identity and status semantics above are preserved.
- Test implementation details, fixture construction, screenshot organization, and the order of the verification matrix.
- Minor layout adjustments needed to preserve 44pt targets, Spanish fit, and 200% text-scale operability without changing workflows.

## Specific Ideas

- Dark mode should feel like PatelRep's warm **Evening Lobby**, not a generic near-black developer theme.
- The app should follow scheduled OS appearance changes live when System mode is selected.
- Floor work should not be interrupted by a theme transition animation.
- Navigator chrome should read as a deeper shell around warm layered content surfaces.

### Deferred Ideas (OUT OF SCOPE)
- EAS iOS build pipeline and iOS-specific walkthrough — future requirement IOS-01.
- Account-synchronized appearance preferences across multiple devices.
- Accent-color picker or density modes, both already excluded from the v1.1 milestone.
</user_constraints>

## Summary

Phase 10 should extend the existing provider rather than introduce another state store or theme library. `apps/mobile/lib/theme/ThemeProvider.tsx` already calls React Native `useColorScheme()` but pins the result to light; `apps/mobile/package.json` already includes `@react-native-async-storage/async-storage` 2.2.0. Persist the small `system | light | dark` preference locally, derive an effective `light | dark` mode from it, and expose both the preference and a hydration signal through the existing context. React Native's `useColorScheme()` is the correct live System-mode input; it rerenders when the OS changes.

The migration is not only a Profile control. The root must hold the splash until the saved preference is hydrated so an explicit preference never flashes the OS fallback. The Expo Router/React Navigation appearance provider, Expo `StatusBar`, and current `(app)/_layout.tsx` tab/FAB styling must consume the same resolved theme. The current tab chrome is still hard-coded through `C.*`; the legacy `C` paths in `components/shared/evening.tsx`, `components/shared/mobileHandoff.tsx`, and the auth screen are the remaining dark-mode risks. Copilot is the deliberate exception: retain its static `darkTheme` content presentation while theming the navigation chrome around it and auditing its contrast/targets.

Automated checks can establish storage, derivation, navigation wiring, and token contrast, but cannot prove Android rendering, OS font scaling, TalkBack order, native overlays, or physical target usability. Phase 9's verification explicitly left device work outstanding because this host has no ADB/emulator; Phase 10 must retain a mandatory human Android gate and record it in `10-VERIFICATION.md`.

**Primary recommendation:** Implement one hydrated, local `AppearancePreference` context and one semantic contrast test first; then theme chrome and all remaining static surface helpers, add focused tests, and close only after the EAS production build plus the bilingual/offline/RBAC Android walkthrough are evidenced.

## Standard Stack

### Core

| Library / facility | Current version | Purpose | Why use it here |
|---|---:|---|---|
| React Native `useColorScheme` | React Native 0.81.5 | Live OS light/dark signal | Already imported in the provider; React Native handles subscription updates without a manual `Appearance` listener. |
| `@react-native-async-storage/async-storage` | 2.2.0 | Device-local explicit preference | Already installed; satisfies persistence without account data, Supabase changes, or a new dependency. |
| Existing `ThemeProvider` + `useTheme` | project code | Effective tokens and preference API | One source of truth avoids current token/chrome divergence. |
| Expo Router `Tabs` / React Navigation theme provider | expo-router ~6.0.24 | Navigator chrome and navigation semantic colors | Expo Router manages the root navigation container and supports supplying the React Navigation theme at a layout. |
| `expo-status-bar` | ~3.0.9 | Status-bar content/background | Already installed; set explicitly from resolved mode with no animation. |
| Jest + React Native Testing Library | Jest 29.7 / RNTL 12.9 | Provider, Profile, chrome, and contrast contract tests | Existing test stack and provider-wrapper pattern. |

### Supporting

| Facility | Purpose | When to use |
|---|---|---|
| React Native `AccessibilityInfo` reduced-motion API | Read reduced-motion setting and subscribe if toast/other existing motion needs a no-motion path | Only for existing motion encountered by the QA audit; do not add decorative transitions. |
| Existing `StatusBadge`, labels/icons/occupied stripe | Non-color status cues | Preserve and audit rather than inventing a new status system. |
| `npx expo export --platform android` | Local Android bundle/export regression check | Before EAS; it is not a substitute for the cloud production build. |
| EAS CLI / existing `eas.json` production profile | Required Android AAB build evidence | Run once code verification is green; save build ID and dashboard URL. |

### Alternatives Considered

| Instead of | Could use | Why not for this phase |
|---|---|---|
| Existing theme context + AsyncStorage | Zustand/global app store or server profile preference | Adds cross-domain state or account sync explicitly deferred by context. |
| `useColorScheme()` | Manual `Appearance.addChangeListener` | Redundant; the hook already updates on OS changes. |
| React Navigation theme provider | Hand-coded per-screen navigator colors only | Leaves default/first-frame navigation colors and future headers easy to miss. |
| Focused token contrast test | Screenshot-only contrast assessment | Screenshots still need human review, but token pairs need deterministic regression coverage. |

**Installation:** none expected. Use installed dependencies; do not add a dark-mode, persistence, or contrast package unless a concrete missing capability is discovered.

## Architecture Patterns

### Recommended change map

```text
apps/mobile/
├── components/shared/tokens.ts              # light/dark semantic surfaces, shells, on-colors, status pairs
├── lib/theme/ThemeProvider.tsx               # preference + hydration + system-derived effective mode
├── lib/theme/useTheme.ts                     # resolved tokens (keep caller API stable)
├── app/_layout.tsx                           # splash gate, NavigationThemeProvider, explicit StatusBar
├── app/(app)/_layout.tsx                     # Tabs/header/FAB read active theme; OfflineBanner/Toast stack
├── app/(app)/profile/index.tsx               # full-width, translated appearance segmented control
├── components/shared/{evening,mobileHandoff,OfflineBanner}.tsx
│                                             # eliminate light-only static C paths except D-11 Copilot rules
└── __tests__/                                # preference, chrome, token contrast, Profile accessibility coverage
```

### Pattern 1: persisted preference is distinct from effective mode

**What:** Store `"system" | "light" | "dark"`; resolve it to `"light" | "dark"` only after combining it with `useColorScheme()`. The storage absence/error value is `system`, never `light`. `setPreference` must update visible state first (immediate response), write the small value asynchronously, and surface only the resolved mode to `useTheme()` callers.

**Why:** A stored explicit mode must override the OS; System must keep following live OS changes. Saving only an effective `light | dark` value loses that distinction and makes scheduled appearance changes impossible.

```tsx
// Design pattern; keep actual names aligned with the existing ThemeProvider.
type AppearancePreference = "system" | "light" | "dark";
type ThemeMode = "light" | "dark";

const systemMode: ThemeMode = systemScheme === "dark" ? "dark" : "light";
const mode: ThemeMode = preference === "system" ? systemMode : preference;
```

The context should include `{ preference, mode, setPreference, isHydrated }`; `useTheme()` continues returning `getThemeTokens(mode)` so Phase 8/9 call sites stay uncomplicated. A small `useAppearancePreference()` hook may expose the selector to Profile without forcing each screen to know storage details.

### Pattern 2: splash-gated first frame and shared navigator theme

**What:** Mount the existing `ThemeProvider` above a child that consumes it. Do not call `SplashScreen.hideAsync()` until both auth and theme preference hydration are complete. At this same root, provide a React Navigation theme through `expo-router/react-navigation` and render `StatusBar` explicitly from `mode` and the active shell color.

**Why:** The provider currently is inside `RootLayout`, while `RootLayout` controls splash hiding. Split an inner component or use a sibling consumer so no saved Light/Dark preference shows the system color while AsyncStorage resolves. Expo Router's official migration guidance says its Stack/Drawer/Tabs share the supplied React Navigation appearance provider.

```tsx
// Source: https://docs.expo.dev/router/migrate/from-react-navigation/
import { ThemeProvider as NavigationThemeProvider } from "expo-router/react-navigation";

<NavigationThemeProvider value={navigationThemeFor(theme)}>
  <StatusBar
    style={mode === "dark" ? "light" : "dark"}
    backgroundColor={theme.shell.bg}
    animated={false}
  />
  <Stack screenOptions={{ headerShown: false }} />
</NavigationThemeProvider>
```

Map React Navigation's semantic `primary`, `background`, `card`, `text`, `border`, and `notification` fields from PatelRep tokens; do not pass `darkTheme` directly as the navigator object because it has a different token shape. In `(app)/_layout.tsx`, replace all `C.shell*`, `C.paper`, `C.ink*`, and `C.ai` tab/FAB values with `theme` equivalents. Configure tab accessibility labels where visible labels are insufficient.

### Pattern 3: semantic, composited contrast contract

**What:** Test named foreground/background pairings, not merely individual hex literals. The helper must parse hex and `rgba`, composite transparent token fills over their declared base surface, calculate relative luminance using the WCAG formula, and assert the appropriate threshold.

**Why:** `darkStatusTokens` uses translucent soft fills. Testing a foreground against the raw `rgba(...)` text is wrong; its visible color depends on the dark base surface. This catches the current likely weak combinations before screens regress.

Minimum required pairs include normal text on every content and shell surface, active/inactive tab label/icon on the tab shell, button foreground/background (including pressed and disabled semantics where meaningful), card/border and selected-state boundaries, Toast text/icon/background, OfflineBanner text/background, and every status foreground/soft fill/border pairing used by `StatusBadge` and shared room status helpers. Keep label/icon/stripe tests alongside the ratio tests for the occupied and status contract.

### Pattern 4: Profile uses an accessible radio-like segmented control

**What:** Keep the visual segmented-control form but make each of the three translated options a 44pt-or-larger `Pressable`/`TouchableOpacity` with `accessibilityRole="radio"`, shared group label, and `accessibilityState={{ selected }}`. Use flex equal-width options, wrapping/adequate height, and translated `profile.appearance.*` keys in both locale files.

**Why:** React Native documents `selected`, `disabled`, and `busy` in `accessibilityState`; the existing language segments have selected state but only a 32pt min-height. Do not duplicate the language UI's insufficient target-size styling.

### Pattern 5: respect reduced motion where the audit finds it

**What:** Theme switching itself updates with no animation. For the existing Toast entry/exit and swipe spring, branch on the current reduce-motion preference to set final values/dismiss immediately rather than running `Animated.timing`/`Animated.spring`.

**Why:** The current Toast uses 150–200ms Animated transitions unconditionally. This requirement is about respecting exposed OS preference, not a broad animation redesign.

### Anti-patterns to avoid

- **Persisting effective light/dark rather than preference:** breaks System live changes and makes defaults ambiguous.
- **Hydrating after splash hide:** creates the exact unthemed flash this phase must prevent.
- **Using `C` for any normal themed surface:** `C` is statically aliased to `lightTheme`; its use is an actual dark-mode defect, not just a code-style issue.
- **Turning D-11 Copilot into a light surface:** preserve its dark-only presentation; audit it as a dark surface instead.
- **Using shadows as the only dark separation:** cards/sheets/Toasts need a tokenized border or tonal layer.
- **Color-only pass criteria:** a status still needs its translated label plus icon/pattern, especially occupied's stripe.
- **Calling an EAS build or export a device walkthrough:** the release build and human Android matrix are separate required evidence.

## Exact Repository Findings and Plan Implications

| Area | Current evidence | Required Phase 10 work |
|---|---|---|
| Theme foundation | `ThemeProvider.tsx` reads `useColorScheme()` but unconditionally sets `mode: "light"`; its context only exposes `mode`. | Evolve it; retain provider/hook location and memoization. |
| Token system | `tokens.ts` already has light/dark content tokens and a dark-only `surfaceElevated`, but both themes share one `shellTokens`; `darkStatusTokens` retains light foreground hues while changing soft fills to alpha. | Split shell semantics by theme; adjust only contrast-unsafe status/on-color values while retaining mapping; add token-pair test. |
| Chrome | root has `<StatusBar style="auto" />`; app Tabs use `C.shell*`, header `C.paper/C.ink`, and FAB `C.ai`. | Derive status bar and navigator theme from one resolved mode; remove static C in chrome. |
| Surface helpers | `components/shared/evening.tsx` and `mobileHandoff.tsx` still contain many static `C.*` values. | Audit every exported normal themed helper, migrate to `useTheme` or explicit theme props. Preserve the explicit Copilot static-dark code path only. |
| Profile | It already consumes `useTheme`, contains a language segmented control and focused `ProfileHandoff.test.tsx`, but its segments are 32pt and bell action 38pt. | Add appearance control; fix all Profile interactive controls involved in the audit to >=44pt; add EN/ES keys and test selectors. |
| Overlays | Card has border + elevation; Toast is theme-aware only for fill but hard-codes white text/icon and uses motion; OfflineBanner is completely static and English. | Theme/border/contrast/i18n/accessibility audit of Card, sheets/modals, Toast, OfflineBanner. Preserve `ToastViewport` below the measured OfflineBanner. |
| Tests | Existing screen tests commonly wrap `ThemeProvider`; `ProfileHandoff.test.tsx` mocks only `useThemeMode`. `MobileVisualTokens.test.ts` already owns visual-token assertions. | Update shared test renderer/mocks, add provider persistence/System-change tests, Profile selected-state/target test, root/tab chrome wiring test, and contrast suite. |
| Build | `eas.json` has an existing `production` profile and project ID. Phase 9 already passed local `npx expo export --platform android`. | Run export after code checks, then `npx eas-cli@latest build --platform android --profile production` (or installed authenticated EAS CLI); record ID/link/result in `10-VERIFICATION.md`. |
| Phase 9 state | `09-VERIFICATION.md` verifies 53/53 code must-haves but calls for human Android validation; `09-14-SUMMARY.md` confirms Copilot D-11 static-dark lock. | Treat Phase 10 as the phase that completes—not erases—those human observations. |

## Don't Hand-Roll

| Problem | Do not build | Use instead | Why |
|---|---|---|---|
| OS appearance subscription | Custom native event module | React Native `useColorScheme()` | Existing cross-platform hook updates when system appearance changes. |
| Persistent key-value storage | JSON file, Supabase profile field, or new store | Installed AsyncStorage | Exact device-local scope requested; no sync behavior. |
| Navigator container | A replacement hand-built navigator | Expo Router `Tabs` plus its React Navigation theme provider | Keeps file-based routing, current role tab filter, and native semantics. |
| Accessibility semantics | Custom screen-reader abstraction | RN `accessibilityRole`, `accessibilityLabel`, `accessibilityState` | Platform-native mapping to TalkBack/VoiceOver. |
| Contrast QA service | A SaaS/API dependency | Small deterministic test helper beside `MobileVisualTokens.test.ts` | Existing static tokens need no network; alpha composition is the only domain-specific detail. |
| Android release binary | Local unsigned substitute | Existing EAS production profile | Requirement explicitly calls for an EAS Android production build and its build record. |

## Common Pitfalls

### 1. First-frame flash after AsyncStorage hydration

**What goes wrong:** System dark briefly renders before a saved Light choice, or light renders before saved Dark.  
**Avoid:** Consider preference hydration a splash prerequisite; default only missing/corrupt storage to `system`. Test the not-hydrated state does not render the themed navigator/status bar or hide splash.

### 2. Context/provider naming collision

**What goes wrong:** Importing `ThemeProvider` from Expo Router/React Navigation collides with PatelRep's `ThemeProvider`, leading to a missing provider or wrong theme object.  
**Avoid:** Alias the navigation import (`NavigationThemeProvider`) and construct a separate React Navigation `Theme` object from PatelRep semantic tokens.

### 3. Static C token islands

**What goes wrong:** `C` always resolves to light tokens, so helper components, tabs, login, or static `StyleSheet` colors stay light in dark mode.  
**Avoid:** A Phase 10 completion audit must make the normal themed-surface `rg '\bC\.' apps/mobile` result intentional and documented. The only permitted exception is the explicitly static-dark Copilot implementation; it must use `darkTheme`, not `C`.

### 4. False contrast confidence with alpha colors

**What goes wrong:** A status foreground looks valid against its nominal color but fails against the composited soft fill on dark surface.  
**Avoid:** Composite RGBA over the actual background in automated tests and inspect rendered badges/Toasts on Android. The current dark status soft tokens make this mandatory.

### 5. White text is not universally safe

**What goes wrong:** `Button` and Toast hard-code `#FFFFFF`; white may fail against a brighter forest-green action or revised status fill.  
**Avoid:** Add semantic `onPrimary`, `onDestructive`, and Toast foreground/surface tokens (or make Toast a dark surface with a semantic icon) and test the rendered pairing.

### 6. Target-size regressions hidden inside existing UI

**What goes wrong:** The new theme choices meet 44pt but sibling Profile language segments (32pt) and bell action (38pt), icon-only controls, or generated tabs do not.  
**Avoid:** Audit all `Pressable`/`TouchableOpacity`/IconButton paths in migrated workflows, not just the new control. Verify real touch targets at 200% font scale.

### 7. Screen-reader state says “button,” not selection

**What goes wrong:** A segmented choice is visually active but TalkBack cannot announce current selection.  
**Avoid:** Set role/state/label explicitly, retain logical JSX order, and include disabled/busy states on loading controls. The RN accessibility reference lists `selected`, `disabled`, and `busy` state fields.

### 8. 200% text-scale clipping

**What goes wrong:** fixed-height buttons, `numberOfLines`, tab labels, bilingual options, and modal actions clip or conceal a required action.  
**Avoid:** Treat height as a minimum, allow vertical growth where needed, use flexible/wrapping layouts, and manually test every role shell at Android 200% text scale in EN/ES.

### 9. Toast motion/layering regression

**What goes wrong:** Toast animation ignores reduce motion, or updated surface positioning obscures the OfflineBanner.  
**Avoid:** Keep current measured `topOffset={insets.top + bannerHeight}` relationship; test both disconnected/reconnected flows with a Toast visible.

### 10. Build evidence is incomplete

**What goes wrong:** a local Expo export passes but the phase claims DARK-04 without a successful cloud production build.  
**Avoid:** Record the EAS build ID, profile/platform, dashboard link, completion timestamp, and artifact/result in `10-VERIFICATION.md`; a production AAB is not directly installable on an emulator unless configured as APK, so perform the walkthrough with an appropriate installed dev/preview build while still running the required production build.

## Code Examples

### Preference derivation and storage boundary

```tsx
// Source: React Native Appearance API via useColorScheme()
const systemScheme = useColorScheme();
const systemMode = systemScheme === "dark" ? "dark" : "light";
const mode = preference === "system" ? systemMode : preference;

const setPreference = async (next: AppearancePreference) => {
  setPreferenceState(next);       // immediate, no animation
  await AsyncStorage.setItem(APPEARANCE_KEY, next);
};
```

On initial load, validate the stored string against the three allowed values before using it. Storage errors must fall back to `system`; do not block a staff member behind an error UI for a preference.

### Explicit Expo status bar and navigation shell

```tsx
// Source: https://docs.expo.dev/versions/v54.0.0/sdk/status-bar/
const theme = useTheme();
const mode = useThemeMode();

<StatusBar
  style={mode === "dark" ? "light" : "dark"}
  backgroundColor={theme.shell.bg}
  animated={false}
/>

<Tabs screenOptions={{
  tabBarActiveTintColor: theme.shell.ink,
  tabBarInactiveTintColor: theme.shell.ink3,
  tabBarStyle: { backgroundColor: theme.shell.bg, borderTopColor: theme.shell.line },
  headerStyle: { backgroundColor: theme.surface },
  headerTintColor: theme.textPrimary,
}} />
```

### Segmented preference semantics

```tsx
<View accessibilityRole="radiogroup" accessibilityLabel={t("profile.appearance.label")}>
  {options.map(({ value, label }) => (
    <Pressable
      key={value}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: preference === value }}
      style={[styles.segment, { minHeight: 44 }, preference === value && styles.selected]}
      onPress={() => void setPreference(value)}
    >
      <Text>{label}</Text>
    </Pressable>
  ))}
</View>
```

### Contrast contract shape

```ts
// Keep pairs named so a failure says what staff see.
expectContrast("dark body text / surface", darkTheme.textPrimary, darkTheme.surface).toBeAtLeast(4.5);
expectCompositeContrast(
  "dark ready badge label / ready soft on surface",
  darkTheme.status.ready,
  darkTheme.status.readySoft,
  darkTheme.surface,
).toBeAtLeast(4.5);
expectContrast("dark selected boundary", darkTheme.primaryLine, darkTheme.surface).toBeAtLeast(3);
```

## Verification Matrix

### Automated gates

| Requirement / risk | Evidence to add | Command / assertion |
|---|---|---|
| DARK-01 default and persistence | Theme provider unit tests: absent/invalid stored value => System; valid value restores; `setPreference` writes exact key/value; explicit mode wins over system. | targeted Jest test |
| DARK-01 live System | Mock `useColorScheme` transition light→dark while preference is System; assert effective mode changes. Assert Light/Dark override ignores the transition. | targeted Jest test |
| DARK-03 chrome | Root/navigation render test checks navigation theme and explicit status-bar values for both effective modes; app layout checks Tabs/header/FAB no longer reads `C`. | targeted Jest + static audit |
| DARK-02 semantic tokens | Hex/RGBA-composited WCAG tests for text, controls, selection/borders, statuses, Toast/Banner and Copilot dark combinations. | `MobileVisualTokens` extension or dedicated contrast test |
| Accessibility semantics | Profile test checks three translated appearance options, role radio, selected state, 44pt style, immediate press; update existing Profile mock to new provider API. | `ProfileHandoff.test.tsx` |
| No light-only islands | Review all `C.*` uses; normal themed helpers/chrome return none. D-11 requires `darkTheme` in Copilot, not `C`. | `rg -n "\\bC\\." apps/mobile --glob '!android/**'` plus code review |
| Regression | Existing 30-suite/150-test Phase 9 baseline is the last known result. Run serially to avoid documented parallel timeout flakiness. | `npm test -- --runInBand` |
| Type and translation gate | Type check plus literal-string/i18n lint. | `npm run type-check`; `npm run lint` |
| Android bundle | Local production-like Android export; remove temporary output after success. | `npx expo export --platform android` |

### Mandatory human Android matrix (record each row in `10-VERIFICATION.md`)

| Dimension | Minimum coverage |
|---|---|
| Themes | System initial/light→dark live change, explicit Light, explicit Dark; restart after each explicit selection; no status/navigation flash. |
| Roles / shells | Housekeeper, engineer, supervisor, front-desk, GM. Confirm role tab count/order/labels, headers, status bar, tab bar, FAB, hidden-route navigation, and denied/hidden routes behave unchanged. |
| Migrated routes | Profile; home variants; My Rooms/list+detail; Room Board; Tasks; Inspect; Work Orders/list+detail; assignments/scheduling/staff; assets/PM; guest requests/list+detail; lost & found; logbook/list+new; SOP/list+detail; Alerts; Notifications; Room Status; Copilot. Include each route's meaningful loading/empty/error/modal/sheet state where available. |
| Status contract | Ready/inspected, clean, in-progress, vacant dirty, occupied stripe, pickup, and OOO/OOS: label + icon/pattern + stable meaning in both themes. |
| Language and layout | EN and ES, narrow handset layout, Profile Theme selector; Android display/font size 200% for each navigation shell plus high-frequency housekeeper/engineer workflows. No clipped action, ambiguous selector, or English fallback. |
| Accessibility | TalkBack for Profile selector, icon-only controls, tab navigation, status controls, loading/disabled/busy controls; confirm order, role, name, selected/disabled/busy announcement. |
| Offline/reconnect | Housekeeper/My Rooms or Room Board and Engineer/Work Orders: disconnect, queue an offline-capable action, show OfflineBanner then a Toast, reconnect and confirm queue/sync result and overlay order. |
| Motion | Theme changes have no transition; system reduce-motion setting causes no disallowed Toast/other exposed motion. |
| D-11 | Copilot remains dark in Light, Dark, and System; surrounding status/tab chrome follows app mode; send/mic/confirm/Toast paths remain usable and contrast-safe. |

### Release closeout

1. Run all automated gates after the final implementation increment.
2. Start `npx eas-cli@latest build --platform android --profile production` from `apps/mobile` while authenticated to the configured Expo project. Wait for successful completion.
3. In `10-VERIFICATION.md`, record the EAS dashboard URL/build ID, production profile, Android platform, outcome, date, code commit, local command results, contrast findings/fixes, matrix rows, and any accepted limitation.
4. Do not mark Phase 10 complete until the real Android walkthrough rows are signed off. Static tests, export, and EAS success alone are insufficient.

## State of the Art

| Old/current local state | Required Phase 10 state | Impact |
|---|---|---|
| Provider reads OS scheme but pins light; no persistence | Hydrated `system/light/dark` preference with effective mode | Supports default, override, restart, and live System behavior. |
| `StatusBar style="auto"` and static tab colors | Explicit resolved status-bar/navigation theme | Prevents mismatch and makes chrome testable. |
| Shared `shellTokens` constant across themes | Per-theme deep shell semantics | Delivers locked “deeper navigator shell” rather than only dark content backgrounds. |
| Some shared surfaces use static `C` | All normal surfaces resolve active tokens; D-11 stays explicit static dark | Prevents light-only islands without violating Copilot. |
| Ad hoc visual token equality tests | WCAG pair/composite contrast contract plus human render audit | Makes contrast a maintained release rule. |

## Open Questions

1. **Exact contrast-safe dark status/on-action values**
   - What we know: current dark soft status fills are translucent and current foregrounds were inherited from light tokens; existing Button/Toast foregrounds are hard-coded white.
   - What's unclear: the smallest token adjustments after exact composited ratio calculation.
   - Recommendation: make contrast test red against the named production pairings, then choose the smallest warm/forest-preserving adjustments. Record each adjusted pair in verification.

2. **Android test installation source**
   - What we know: production EAS AAB is mandatory and is normally store-installed; Phase 9 found no local ADB/emulator.
   - What's unclear: whether the final human pass will use a configured emulator, development client, preview APK, or internal Play track.
   - Recommendation: decide before implementation closes. It does not alter the required production EAS build; record the installed build type/device in the matrix.

3. **Auth-screen scope**
   - What we know: `app/(auth)/login.tsx` still uses `C.*`; locked language says app-wide, while formal DARK-02 says migrated routes.
   - Recommendation: include login in the static-token audit and at least smoke it in both themes. This is a small boundary fix and avoids a visibly light pre-auth island; do not add new auth behavior.

4. **Profile control wording**
   - What we know: EN/ES currently have language control translations but no appearance strings.
   - Recommendation: have the implementer use short approved labels (`System/Light/Dark`, `Sistema/Claro/Oscuro`) with a translated group label; verify copy under narrow width and 200% scaling rather than abbreviating.

## Sources

### Primary (HIGH confidence)

- [Expo Router: React Navigation themes](https://docs.expo.dev/router/migrate/from-react-navigation/) — Expo Router-managed root container and shared navigator appearance provider.
- [Expo Router JavaScript Tabs](https://docs.expo.dev/router/advanced/tabs/) — current Expo Router 6 Tabs options, including tint/style and accessibility label support.
- [Expo StatusBar (SDK 54)](https://docs.expo.dev/versions/v54.0.0/sdk/status-bar/) — installed `expo-status-bar` behavior and explicit style/background/animation support.
- [Expo EAS production Android build](https://docs.expo.dev/tutorial/eas/android-production-build/) and [EAS build-profile reference](https://docs.expo.dev/build/eas-json/) — production profile command and AAB/install constraints.
- [React Native accessibility](https://reactnative.dev/docs/accessibility) — `accessibilityState` selected/disabled/busy semantics.
- [WCAG 2.2 Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) and [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — 4.5:1 normal, 3:1 large/non-text and 200% text-resize acceptance basis.

### Project evidence (HIGH confidence)

- `apps/mobile/package.json`, `app.json`, and `eas.json` — Expo 54 stack, installed AsyncStorage, automatic UI style, and existing production profile.
- `apps/mobile/lib/theme/ThemeProvider.tsx`, `useTheme.ts`, and `components/shared/tokens.ts` — precise provider/token gap and available Evening Lobby palette.
- `apps/mobile/app/_layout.tsx` and `app/(app)/_layout.tsx` — current splash, status bar, role Tabs, OfflineBanner/Toast stack, and static chrome values.
- `apps/mobile/app/(app)/profile/index.tsx` and `__tests__/screens/ProfileHandoff.test.tsx` — existing Profile segmented-control/test seams and target-size debt.
- `apps/mobile/__tests__/components/MobileVisualTokens.test.ts` — existing visual-token test home.
- `.planning/phases/09-remaining-screens-rollout/09-VERIFICATION.md`, `09-14-SUMMARY.md`, and `09-UAT.md` — Phase 9 code completion/human-device boundary and D-11 Copilot contract.

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — package/config and current official Expo/React Native documentation agree; no new dependency is needed.
- Architecture: **HIGH** — directly follows current provider/root/Tabs topology and Expo Router's documented navigation theme provider.
- Contrast pitfalls: **HIGH** — WCAG primary sources plus actual static foreground/alpha-token patterns in the repository.
- Android human verification: **HIGH** — explicitly locked by CONTEXT and independently carried from Phase 9 verification; exact device availability remains an operational open question.

**Research date:** 2026-07-30  
**Valid until:** 2026-08-29 (recheck Expo/RN docs if package versions change before execution)

## RESEARCH COMPLETE

Planning can now decompose the phase into preference/hydration + token contract, chrome/static-surface migration, focused automated accessibility/contrast coverage, and a final EAS/device evidence gate. The plan must preserve Copilot D-11 and treat Android human walkthrough completion as non-negotiable.
