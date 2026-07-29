# Stack Research

**Domain:** Design-token + UI-primitive retrofit for an existing Expo SDK 54 / React Native 0.81 mobile app
**Researched:** 2026-07-28
**Confidence:** HIGH

## TL;DR (opinionated)

Do **NOT** adopt NativeWind for this retrofit. Introduce a **plain TypeScript design-token module + a React `ThemeProvider`/`useTheme` context**, keeping the existing per-screen `StyleSheet.create` code intact. Build the four primitives (Button/IconButton, Card, EmptyState/StateBlock, Toast) as small in-repo components that read from the theme. Do **NOT** add `react-native-toast-message` — it is broken on Expo SDK 54 — build a lightweight custom Toast on React Native's built-in `Animated` API instead.

**Why this shape:** the app has a fragile, hand-tuned EAS build (babel `dynamic-import-node`, `--legacy-peer-deps` for React 19) and zero existing Tailwind/NativeWind/Reanimated. Every new *native* dependency forces a new EAS dev build and risks that pipeline. A theme object + JS-only primitives adds **zero native modules, zero Metro/Babel/PostCSS config changes, and zero rebuild risk**, while still delivering full visual parity with the web palette. This mirrors the web refresh's "Wave-0 primitives first" approach without importing Tailwind's mental model into 20+ working StyleSheet screens.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Typed theme module (in-repo, no dependency) | n/a | Design tokens: colors / spacing / typography / radii / status families, light + dark | Zero new deps, zero build risk. Mirrors web's CSS-variable tokens as a parallel TS file (conceptually shared, not literally). Fits the existing `StyleSheet` code with no migration of layout logic. |
| React Context `ThemeProvider` + `useTheme()` hook (in-repo) | React 19.1.0 (already present) | Runtime theme access + light/dark switching | Idiomatic RN, no native module. Screens call `const t = useTheme()` and reference `t.colors.*` inside existing `StyleSheet.create` factories. Dark mode via `useColorScheme()` (built into RN) or a Zustand-backed override. |
| In-repo primitive components (Button, IconButton, Card, EmptyState/StateBlock, Toast) | n/a | The four parity primitives | Matches the milestone's "shared primitives first" goal. Full control over paper/terracotta styling; no UI-kit conflicts with the bespoke housekeeping/engineering layouts. |
| React Native `Animated` API (built-in) | RN 0.81.5 (already present) | Toast slide/fade animation | Ships with RN, works on the New Architecture, needs no Reanimated. Enough for a slide-in toast that matches web's toast behavior. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react-native-safe-area-context` | ~5.6.0 (already installed) | Safe-area insets for Card headers / Toast placement | Already a dependency — reuse for Toast top/bottom offset. SDK 54 enables edge-to-edge automatically, so respect insets in the Toast and any new headers. |
| `@expo/vector-icons` | ^15.0.3 (already installed) | Icons inside IconButton / EmptyState illustrations | Already present — no need to add an icon lib. |
| `zustand` | ^4.5.4 (already installed) | Optional: persist the user's dark/light/system theme choice + host the Toast queue store | Already used for `appStore`. A tiny `toastStore` (enqueue/dismiss) pairs well with a single mounted `<ToastHost/>`. |
| `react-native-unistyles` | 3.2.5 | **Alternative** styling engine (see Alternatives) — only if you later want variants/breakpoints/C++-fast theme switching | Consider only if the theme-object approach starts to feel limiting. Adds a native module + requires New Arch + native rebuild. Not needed for v1.1. |
| `sonner-native` | ^0.x (current) | **Alternative** off-the-shelf toast, if you decide to add Reanimated anyway | Only if you adopt Reanimated for other reasons. Built on Reanimated 3; gives polished, fully styleable toasts matching the web's Sonner-style look. Otherwise not worth the native dep for one component. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript | ~5.9.2 (already present) | Type the token module (`as const` + derived types) so screens get autocomplete on `t.colors.ready`, `t.space[4]`, etc. | Export a `Theme` type; `ThemeProvider` value is typed to it. |
| `tsc --noEmit` (`npm run type-check`) | Catch token/prop typos across migrated screens | Already wired in `package.json`. Run after each screen migration. |
| Style Dictionary | **Optional** token-generation tooling | Only if you want a single machine source of truth that emits both web CSS vars and RN TS. Overkill for one web+mobile pair — hand-maintaining the parallel TS file is simpler for now. |

## Installation

```bash
# Recommended path: NOTHING to install.
# The theme module, ThemeProvider, and primitives are in-repo TS/TSX files
# using only already-installed packages (react, react-native, safe-area-context,
# vector-icons, zustand). No native modules -> no new EAS build required.

# ---- Only if you deliberately choose an alternative below ----

# Alternative A: Unistyles styling engine (adds a native module, requires new EAS build)
npm install react-native-unistyles react-native-nitro-modules --legacy-peer-deps

# Alternative B: off-the-shelf toast (only if you also adopt Reanimated)
npm install sonner-native react-native-reanimated react-native-gesture-handler --legacy-peer-deps
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Typed theme object + Context | **NativeWind v5** | Only for a greenfield RN app, or one already using Tailwind, where the team wants Tailwind's `className` DX. Not worth it here: pulls in `react-native-reanimated`, `tailwindcss`, `react-native-css`, and `lightningcss` (must pin to `1.30.1` to avoid deserialization errors), plus new `metro.config.js`, `global.css`, `postcss.config.mjs`, babel, and `nativewind-env.d.ts` config — and forces rewriting 20+ working StyleSheet screens to `className`. High churn, high build-pipeline risk, low upside for a retrofit. |
| Typed theme object + Context | **react-native-unistyles v3.2.5** | If you want per-component variants, breakpoints, and C++-fast theme switching *without* re-renders. It's a genuine "StyleSheet with superpowers" and the closest thing to a drop-in upgrade (swap `StyleSheet` import). But v3 is tightly coupled to Fabric/New Architecture, ships a native module (`react-native-nitro-modules`), and needs a native rebuild — extra risk against this app's fragile EAS pipeline. Good future upgrade; unnecessary for v1.1 parity. |
| Custom Toast on `Animated` | **sonner-native** | If you adopt Reanimated for other animation work anyway. Polished, gesture-dismissible, fully styleable to the paper/terracotta palette, and conceptually mirrors the web toast. The only cost is the Reanimated 3 native dep. |
| Custom Toast on `Animated` | **burnt** | If you specifically want *native OS* toasts/alerts (SwiftUI on iOS, `ToastAndroid` on Android) and do **not** need visual parity. Works on old + new arch via JSI/Expo modules. Rejected here because native OS toasts **cannot** be styled to match the web's custom paper/terracotta Toast — it defeats the parity goal. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `react-native-toast-message` | **Broken on Expo SDK 54.** Issue [#583](https://github.com/calintamas/react-native-toast-message/issues/583) (opened 2025-09-18, still unresolved as of this research): the `Animated.spring()` slide-in stops rendering under SDK 54's New Architecture / Reanimated v4 world — the toast is computed but never visible. No maintainer fix. | Custom `Animated`-based Toast primitive (recommended) or `sonner-native`. |
| NativeWind v5 (for this app) | Retrofit cost + native deps (Reanimated, lightningcss pin) + full `className` rewrite of bespoke screens. See Alternatives. | Typed theme object + Context. |
| A full UI kit (react-native-paper, Tamagui, gluestack, RN Elements) | Imposes its own component look/theming system that would fight the bespoke housekeeping/engineering screen layouts and the web's exact paper/terracotta tokens. The milestone wants *matching web primitives*, not a third-party design language. | In-repo primitives reading from the theme module. |
| `burnt` (for parity) | Renders unstyleable native OS toasts — cannot match the web Toast visually. | Custom `Animated`-based Toast. |
| Style Dictionary (right now) | Single-source token generation is real infra for one web+mobile pair — premature. | Hand-maintained parallel `tokens.ts` mirroring the web CSS-variable values. |

## Stack Patterns by Variant

**If the priority is lowest risk + fastest parity (recommended for v1.1):**
- Use the typed theme module + `ThemeProvider`/`useTheme` + in-repo primitives + custom `Animated` Toast.
- Because it adds zero native modules, needs no new EAS build, and leaves the existing per-screen `StyleSheet` layouts untouched — you only swap hard-coded color/spacing literals for `t.colors.*` / `t.space[*]`, screen by screen (floor-role first).

**If the team later wants variants/breakpoints/perf theme switching:**
- Migrate the theme layer to `react-native-unistyles` v3 (swap the `StyleSheet` import; register light/dark themes via `StyleSheet.configure`).
- Because Unistyles keeps the StyleSheet API, so the earlier token module carries over as its theme definition — this is an additive upgrade, not a rewrite. Budget a native rebuild.

**If the team adopts Reanimated for richer motion anyway:**
- Replace the custom Toast with `sonner-native`.
- Because once Reanimated is already a dependency, `sonner-native` gives a more polished, gesture-dismissible toast for free.

## Design-Token File Layout (for the downstream consumer)

Recommended in-repo structure under `apps/mobile/`:

```
apps/mobile/
  theme/
    tokens.ts        # raw primitives: palette scales, spacing steps, radii, font sizes/weights (as const)
    theme.ts         # semantic light + dark maps built from tokens:
                     #   surfaces (paper/ink), status families
                     #   (accent/ready/caution/alert/info/progress/ai/blocked)
    ThemeProvider.tsx# Context provider; resolves light/dark via useColorScheme() or a persisted store
    useTheme.ts      # typed hook returning the active theme
    index.ts         # re-exports
  components/
    ui/              # NEW: Button, IconButton, Card, EmptyState/StateBlock, Toast + ToastHost
```

Integration with existing screens: keep `StyleSheet.create`, but wrap it in a factory that takes the theme, e.g. `const makeStyles = (t: Theme) => StyleSheet.create({ card: { backgroundColor: t.colors.paper, padding: t.space[4] } })`, then `const styles = makeStyles(useTheme())` inside the component. This is a mechanical, low-risk find-and-replace of hard-coded literals — no layout restructuring. The status-family names (`ready`, `caution`, `alert`, `info`, `progress`, `ai`, `blocked`, `accent`) must be copied verbatim from the web tokens so both platforms speak the same semantic vocabulary.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Expo SDK ~54.0.0 | React Native 0.81.5, React 19.1.0 | New Architecture (Fabric) is **default-on** in SDK 54. Any UI/animation lib must be New-Arch compatible. |
| RN `Animated` (built-in) | New Architecture | Works fine on Fabric — safe basis for the custom Toast. No native dep. |
| `react-native-safe-area-context` ~5.6.0 | SDK 54 edge-to-edge | SDK 54 enables edge-to-edge automatically — respect safe-area insets in the Toast and any new headers/Cards. |
| `react-native-toast-message` | ❌ SDK 54 | Broken (issue #583). Do not use. |
| `react-native-unistyles` 3.2.5 | RN ≥ 0.78, **New Arch required** | Skips old architecture entirely; needs `react-native-nitro-modules` + native rebuild. |
| `sonner-native` | Reanimated 3, Expo | Built on Reanimated 3. Note Reanimated **v4** is New-Arch-only — confirm the Reanimated major it pulls in matches SDK 54's shipped version if you go this route. |
| `burnt` | old + new arch | JSI/Expo-module based; native toasts only. |
| NativeWind v5 | SDK 54 (supported) | Requires `lightningcss` pinned to `1.30.1` in `overrides` to avoid deserialization errors; also `react-native-reanimated` + `react-native-css`. |

## Sources

- [react-native-toast-message issue #583](https://github.com/calintamas/react-native-toast-message/issues/583) — SDK 54 animation/visibility breakage, unresolved since 2025-09-18 — HIGH
- [NativeWind v5 installation docs](https://www.nativewind.dev/v5/getting-started/installation) — required peer deps (Reanimated, react-native-css, tailwindcss), lightningcss 1.30.1 pin, metro/postcss/global.css config — HIGH
- [react-native-unistyles npm / GitHub](https://github.com/jpudysz/react-native-unistyles) + [Unistyles v3 getting started](https://www.unistyl.es/v3/start/getting-started/) — v3.2.5, requires New Arch + RN ≥ 0.78, StyleSheet drop-in — HIGH
- [Unistyles 3.0 on Expo blog](https://expo.dev/blog/unistyles-3-0-beyond-react-native-stylesheet) — Fabric integration rationale — MEDIUM
- [sonner-native GitHub](https://github.com/gunnartorfis/sonner-native-toasts) + [npm](https://www.npmjs.com/package/sonner-native) — Reanimated 3 based, Expo compatible — MEDIUM
- [burnt GitHub](https://github.com/nandorojo/burnt) — native OS toasts, old+new arch, JSI — MEDIUM
- [Expo SDK 54 changelog](https://expo.dev/changelog/sdk-54) + [New Architecture guide](https://docs.expo.dev/guides/new-architecture/) — New Arch default-on, edge-to-edge, RN 0.81 — HIGH
- Local `apps/mobile/package.json` — confirmed no NativeWind/Tamagui/Paper/Reanimated present; RN 0.81.5, React 19.1.0, expo-dev-client, safe-area-context, vector-icons, zustand already installed — HIGH

---
*Stack research for: mobile design-token + UI-primitive retrofit (v1.1 Mobile UI Parity)*
*Researched: 2026-07-28*
