# Phase 22: Expo SDK 54→57 Bump - Research

**Researched:** 2026-08-05
**Domain:** Expo/React Native SDK major-version upgrade (mobile toolchain), EAS Android cloud builds
**Confidence:** HIGH (current state read from files; version/breaking-change facts verified against official Expo docs + npm)

> No CONTEXT.md exists for this phase (no `/gsd:discuss-phase` was run). Research proceeds on requirements + codebase state alone. There are no locked user decisions to honor beyond the phase requirements MOBILE-01..04.

## Summary

`apps/mobile` is on **Expo SDK ~54** (installed `54.0.26`, RN `0.81.5`, React `19.1.0`, `expo-router ~6.0.24`). The phase upgrades it to **Expo SDK 57.0.9** via three sequential single-major hops (54→55→56→57), each gated by `expo-doctor` + `npx jest` + `tsc --noEmit` + a green EAS Android cloud build. eas-cli `21.4.0` is installed and **already authenticated** as `henilllpatelll` (project `0fc41a33-8e3c-40cf-9114-26dc0b95d044`), so no fresh login is needed and the roadmap's "green EAS Android cloud build" gate is achievable in this environment.

The single highest-risk hop is **54→55→56**, not 57. Two things converge there: (1) **SDK 55 makes the New Architecture mandatory and removes `newArchEnabled` from `app.json` entirely**, and (2) **SDK 56's Expo Router forks from React Navigation** — app code may no longer import from `@react-navigation/*`. This project imports `@react-navigation/native` in exactly **two files** (`app/_layout.tsx`, `lib/theme/navigationTheme.ts`), and `@react-navigation/native` is **not** a direct dependency today (it resolves transitively through `expo-router`). SDK 57 itself (RN 0.85→0.86) is explicitly a **no-breaking-change release**.

Two findings materially change how the plan should be written. **First**, `.easignore` excludes `android/` and `/android`, so **EAS cloud builds run a fresh managed `expo prebuild` from `app.json`** — the committed `android/gradle.properties` (`newArchEnabled=false`) does **not** affect EAS builds; it only affects local `expo run:android`. **Second**, the jest baseline is **already red on SDK 54** (2 suites / 3 tests failing, 406 passing) *before* any upgrade — so a green baseline must be established first or the per-hop `npx jest` gate cannot distinguish upgrade breakage from pre-existing failures.

**Primary recommendation:** Establish a green baseline (fix/quarantine the 3 failing tests, reconcile New-Arch config) → hop 54→55 with `npx expo install expo@^55.0.0 --fix` → hop 55→56 handling the react-navigation fork via the **official codemod** (rewrite the 2 imports to `expo-router/react-navigation`) → hop 56→57 with `npx expo install expo@57.0.9 --fix`. Gate every hop with `expo-doctor` + `tsc` + `jest` + `eas build --profile preview --platform android --non-interactive`, committing each green hop before starting the next.

## Standard Stack

### Confirmed current state (read from files — HIGH)

| Item | Current value | Source |
|------|---------------|--------|
| `expo` | `~54.0.0` (resolved `54.0.26`) | `apps/mobile/package.json`, `npx expo --version` |
| `react-native` | `0.81.5` | package.json |
| `react` / `@types/react` | `19.1.0` / `~19.1.0` | package.json |
| `expo-router` | `~6.0.24` | package.json |
| `jest-expo` | `~54.0.0` | package.json |
| `@react-navigation/native` | **NOT a direct dep** (transitive via expo-router; present in node_modules: native/core/elements/bottom-tabs/native-stack/routers) | `grep`, `ls node_modules/@react-navigation` |
| Node | `v22.18.0` — satisfies SDK 55's `^22.13.0` | `node --version` |
| eas-cli | `21.4.0`, authenticated as `henilllpatelll` (`henillpatel2004@gmail.com`) | `npx eas whoami` |

### Target versions per hop (verified against npm dist-tags + official changelogs — HIGH)

| Hop | Target `expo` | React Native | Key gate | Notes |
|-----|--------------|--------------|----------|-------|
| 54→55 | `55.0.28` (latest sdk-55) | **0.83** | New Arch becomes mandatory | `newArchEnabled` removed from app.json |
| 55→56 | `56.0.18` (latest sdk-56) | **0.85** | **Expo Router forks React Navigation** | iOS min 16.4 (N/A — Android only) |
| 56→57 | **`57.0.9`** (target; `57.0.10` is latest, `57.0.10`=`next`) | **0.86** | none — no breaking changes | straightforward |

`@react-navigation/native` latest = **`7.3.14`** (v7 line; SDK 54's expo-router already pins v7 transitively).

**Upgrade command per hop (official):**
```bash
# From apps/mobile/
npx expo install expo@^55.0.0 --fix      # hop 1
npx expo install expo@^56.0.0 --fix      # hop 2
npx expo install expo@57.0.9 --fix       # hop 3 (pin exact per MOBILE-04)
npx expo-doctor@latest                    # after each hop
```
`--fix` aligns every `expo-*` / peer dependency to the versions the installed SDK expects. This is the mechanism that resolves most of the `npm audit` chain (see below).

### EAS build invocation (verified — HIGH)

```bash
# From apps/mobile/ (eas-cli already authenticated)
eas build --profile preview --platform android --non-interactive
```
- `eas.json` → `preview` profile = internal-distribution **APK**, env points to prod Railway API. This is the profile prior mobile builds used (see `project_eas_build_status.md`).
- EAS project id `0fc41a33-8e3c-40cf-9114-26dc0b95d044`, owner `henilllpatelll`.
- Dashboard: `https://expo.dev/accounts/henilllpatelll/projects/patelrep/builds/`

## Architecture Patterns

### The three-hop discipline (non-negotiable)

Expo's own guidance is explicit: **upgrade one SDK major at a time**, never skip. Each hop crosses an RN major and its own peer-dependency graph; a skipped hop conflates multiple breakages. The roadmap already encodes this. Plan structure should be **one plan (or one commit boundary) per hop**, with all four gates green before the next hop starts, and a git commit at each green hop so a failed later hop can roll back to the last-good SDK.

### Gate order within a hop (fastest-failing first)

1. `npx expo install expo@<target> --fix` (+ any manual dep pins expo-doctor flags)
2. `npx tsc --noEmit` — cheap, catches type breakage from RN/router API changes
3. `npx jest` — must match the established green baseline (see Pitfall 3)
4. `npx expo-doctor@latest` — validates dependency graph / config health
5. `eas build --profile preview --platform android --non-interactive` — the real signal (slow; run last)

### New-Architecture reconciliation (MOBILE-02) — do this BEFORE hop 1

Current divergence: `app.json` sets `newArchEnabled: true` (ios + android); `android/gradle.properties` sets `newArchEnabled=false`. **This divergence is mostly cosmetic for EAS** (`.easignore` excludes `android/`, so EAS prebuilds fresh from `app.json` = New Arch ON). It only bites **local** `expo run:android`.

At **SDK 55 the `newArchEnabled` field is removed from app.json and New Arch is mandatory**, so the divergence self-resolves for app.json after hop 1. To satisfy MOBILE-02's "reconciled before the first hop":

- **Recommended:** delete the committed `apps/mobile/android/` directory (it is already git-tracked but EAS-ignored, and contains stale June build artifacts + logs). This is a Continuous-Native-Generation (CNG) project — the SDK 57 upgrade doc itself instructs CNG users to "delete android/ios directories." This eliminates the stale `gradle.properties` divergence permanently and removes a maintenance trap.
- **Minimal alternative:** if the committed `android/` dir must be kept for a specific local-build reason, set `android/gradle.properties` → `newArchEnabled=true` so it matches app.json before hop 1.

### React-Navigation fork handling (MOBILE-03) — do this DURING hop 55→56

**Only two files import react-navigation:**
- `app/_layout.tsx` → `import { ThemeProvider as NavigationThemeProvider } from "@react-navigation/native"`
- `lib/theme/navigationTheme.ts` → imports from `@react-navigation/native`
- (test `__tests__/lib/theme/navigationTheme.test.ts` exercises this and must stay green.)

Official Expo SDK-55→56 migration (see Sources) provides a codemod and a manual import map:

| Original import | Replacement (SDK 56+) |
|---|---|
| `@react-navigation/native` | `expo-router/react-navigation` |

```bash
npx expo-codemod sdk-56-expo-router-react-navigation-replace .
```
"The runtime API is unchanged — only the module specifiers move."

**⚠️ Requirement-vs-official-path tension (flag for planner/user):** MOBILE-03 is worded as "add `@react-navigation/native` as an explicit direct dependency." The **official** fix is the opposite — *rewrite the imports to `expo-router/react-navigation`* and NOT depend on the external package. Adding `@react-navigation/native@^7` as a direct dep is technically possible and would make the existing imports resolve, but risks a **dual react-navigation instance** (the app's copy vs expo-router's internal fork), which classically breaks `ThemeProvider` context (provider from one instance, consumer from the other). Recommendation:
- **Primary (lower risk, officially supported):** run the codemod / manually rewrite the 2 imports → satisfies MOBILE-03's *intent* (no transitive-drop breakage at SDK 56).
- **If literal MOBILE-03 compliance is mandated:** add `@react-navigation/native@^7` to `apps/mobile/package.json` dependencies AND explicitly verify at runtime (dev build) that theming still applies — do not rely on the type-check alone.
- This is an **Open Question** the planner should resolve with the user before writing the hop-2 tasks.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Bumping expo + all peer deps per hop | Manual version edits in package.json | `npx expo install expo@<target> --fix` | `--fix` knows the exact peer matrix per SDK; manual edits drift and break |
| Rewriting `@react-navigation/*` imports | Hand-editing each import | `npx expo-codemod sdk-56-expo-router-react-navigation-replace .` | Official codemod; also rewrites third-party node_modules imports |
| Regenerating native android config for New Arch | Hand-editing `gradle.properties` | Delete `android/` and let CNG/EAS prebuild regenerate from app.json | Committed native dir is stale and EAS-ignored anyway |
| Validating the dependency graph | Eyeballing package.json | `npx expo-doctor@latest` | Catches version mismatches, duplicate RN, config drift |

## Common Pitfalls

### Pitfall 1: Treating EAS build config and the committed `android/` dir as the same thing
**What goes wrong:** Editing `android/gradle.properties` expecting it to change the EAS build result.
**Why:** `.easignore` excludes `android/` and `/android` — EAS runs a **managed prebuild from `app.json`**. The committed dir only affects local `expo run:android`.
**How to avoid:** Make `app.json` the source of truth. If you keep `android/`, keep it in sync; better, delete it (CNG). Verify New-Arch state by inspecting the EAS prebuild logs, not the committed file.
**Warning signs:** "I set newArchEnabled=false but the EAS build still uses New Arch" (expected — app.json wins on EAS).

### Pitfall 2: The react-navigation fork silently breaks at SDK 56
**What goes wrong:** Build/type-check fails (or theming breaks at runtime) after the 55→56 hop because `@react-navigation/native` no longer resolves the way app code expects.
**Why:** Expo Router v56 forks from React Navigation; external `@react-navigation/*` imports in app code are no longer supported.
**How to avoid:** Run the codemod as the **first action** of hop 2, before the EAS build. Confirm `navigationTheme.ts` + `_layout.tsx` compile and `navigationTheme.test.ts` passes.
**Warning signs:** `Cannot find module '@react-navigation/native'` at type-check, or the app renders with default (unthemed) navigation colors.

### Pitfall 3: The jest baseline is already RED — the per-hop gate is undefined without a fix
**What goes wrong:** "Each hop passes `npx jest`" is unmeetable/ambiguous because SDK 54 already fails **3 tests in 2 suites** (`__tests__/screens/ProfileHandoff.test.tsx` × 1, `__tests__/screens/GuestRequestsList.test.tsx` × 2), 406/409 passing.
**Why:** Pre-existing UI/test drift unrelated to the SDK upgrade (e.g. `getByRole("button", { name: "Room 214" })` selector no longer matches).
**How to avoid:** Establish a **green baseline before hop 1** — either fix these 3 tests or quarantine them and record the exact known-red set. Then "passes jest" means "no *new* failures vs baseline." `tsc --noEmit` is currently **clean (exit 0)** — that gate is well-defined as-is.
**Warning signs:** Blaming the SDK bump for the ProfileHandoff/GuestRequestsList failures that predate it.

### Pitfall 4: The Hermes / Supabase dynamic-import workaround regressing
**What goes wrong:** Runtime crash on Hermes from `@supabase/supabase-js` `import(OTEL_PKG)` (a variable dynamic import Hermes rejects).
**Why:** Handled today by `babel.config.js` `plugins: ['dynamic-import-node']` (see `project_eas_build_status.md`). A babel-preset-expo change across three SDK majors could interfere.
**How to avoid:** Keep the `dynamic-import-node` plugin through all hops; if a Hermes `import(variable)` error reappears after any `@supabase/supabase-js` bump (`--fix` may bump it), re-verify the plugin is applied.
**Warning signs:** EAS build succeeds but the APK white-screens / crashes on launch with a Hermes dynamic-import error.

### Pitfall 5: Node/tooling minimums
**What goes wrong:** SDK 55+ requires Node `^20.19.4 || ^22.13.0 || ^24.3.0 || ^25`. Local is `v22.18.0` ✓. But EAS build images and any CI must also satisfy this, and SDK 55 bumps min **Xcode to 26** (irrelevant — Android-only, no `ios/` dir).
**How to avoid:** Confirm the EAS build image Node version; pin `cli.version` in eas.json if needed. Android-only scope means the iOS 16.4 / Xcode 26 bumps are non-issues here.

## npm audit — the 19→20 advisories (MOBILE-04)

`npm audit` in `apps/mobile` currently reports **20 vulnerabilities (16 moderate, 3 high, 1 critical)** — the roadmap's "19" has drifted to 20 as new advisories published. All resolve to **three root packages, all in the Expo build/dev toolchain** (not shipped in the runtime APK):

| Root pkg | Severity | Example advisory | Reaches app via |
|----------|----------|------------------|-----------------|
| **tar** | critical + high (× ~9 GHSA: DoS via unlimited input, hardlink/symlink path traversal, infinite loop, PAX confusion) | GHSA-23hp-3jrh-7fpw (crit) | `@expo/cli`, `xcode`, prebuild toolchain |
| **brace-expansion** | high (DoS, bypasses CVE-2026-14257 mitigation) | GHSA-rgw5-rvv9-x895 | `@expo/*` config tooling |
| **uuid** | moderate (missing buffer bounds check v3/v5/v6) | GHSA-w5hq-g745-h8pq | `@expo/*` |

Affected packages (all transitive, build/dev-time): `@expo/cli`, `@expo/config`, `@expo/config-plugins`, `@expo/metro-config`, `@expo/prebuild-config`, `expo`, `expo-asset`, `expo-constants`, `expo-dev-client`, `expo-dev-launcher`, `expo-linking`, `expo-manifests`, `expo-notifications`, `expo-splash-screen`, `expo-updates`, `jest-expo`, `tar`, `uuid`, `xcode`, `brace-expansion`.

**Resolution strategy (recommended):**
1. After the SDK-57 `--fix`, re-run `npm audit`. The SDK 57 toolchain pulls newer `@expo/*` that pin patched `tar`/`brace-expansion`/`uuid`, which should clear most/all.
2. `package.json` already has an `overrides` block including `"tar": "^6.2.1"` — this pin is now **STALE** (several new `tar` GHSAs affect the `<7` range). Update overrides to the patched majors (`tar` ≥ the fixed release, `brace-expansion`, `uuid`) if SDK 57 doesn't fully clear them.
3. For any residual advisory that cannot be overridden without breaking the SDK, **document it as accepted risk** with rationale: *build/dev-time-only dependency, not present in the shipped APK runtime, no untrusted archives processed in CI.* MOBILE-04 explicitly allows "resolved **or** explicitly re-documented as accepted risk."

**Do NOT run `npm audit fix --force`** — it will pull dependencies outside the SDK's supported matrix and break the build. Use `overrides` + the SDK bump instead.

## Code Examples

### Per-hop sequence (hop 1 shown)
```bash
cd apps/mobile
npx expo install expo@^55.0.0 --fix
npx expo-doctor@latest            # resolve anything it flags with `npx expo install <pkg> --fix`
npx tsc --noEmit                  # expect exit 0
npx jest                          # expect: no failures beyond the known-red baseline
eas build --profile preview --platform android --non-interactive
# On green EAS build: git commit the hop, then proceed to hop 2
```

### Hop 2 (SDK 56) — react-navigation fork, run BEFORE the EAS build
```bash
npx expo install expo@^56.0.0 --fix
npx expo-codemod sdk-56-expo-router-react-navigation-replace .
# verify the 2 rewritten files:
#   app/_layout.tsx, lib/theme/navigationTheme.ts  → import from "expo-router/react-navigation"
npx tsc --noEmit && npx jest      # navigationTheme.test.ts must stay green
```

### Reconcile New Arch before hop 1 (recommended: delete stale native dir)
```bash
cd apps/mobile
git rm -r android            # EAS-ignored + stale; CNG regenerates from app.json
# (app.json newArchEnabled:true is the source of truth until SDK 55 removes the field)
```

## State of the Art

| Old (SDK 54) | New (SDK 57) | When changed | Impact |
|--------------|--------------|--------------|--------|
| New Arch optional (`newArchEnabled` in app.json) | New Arch mandatory; field removed from app.json | SDK 55 | MOBILE-02 self-resolves after hop 1; reconcile the stale gradle.properties beforehand |
| expo-router re-exports `@react-navigation/*` | expo-router forks RN; use `expo-router/react-navigation` | SDK 56 | MOBILE-03 core change; codemod required |
| RN 0.81 | RN 0.83 → 0.85 → 0.86 | 55 / 56 / 57 | 57 (0.85→0.86) is explicitly non-breaking |
| `tar@^6.2.1` override (in package.json) | needs newer patched `tar` | now (advisories drifted) | override is stale; update or accept-risk |

**Deprecated/removed at SDK 55 (verify none are used here):** `expo-av` (→ expo-video/expo-audio), `removeSubscription` functions, `expo-status-bar` `backgroundColor`/`translucent` props, deprecated `expo-router` `ExpoRequest`/`ExpoResponse` types. This app uses `expo-status-bar ~3.0.9` — grep for `backgroundColor`/`translucent` on `<StatusBar>` during hop 1. **Reanimated is NOT a dependency** — the SDK 56 Reanimated v3→v4 migration (a common upgrade blocker) does **not** apply here, removing a major risk.

## Open Questions

1. **MOBILE-03 literal wording vs official fix**
   - Known: official Expo path rewrites imports to `expo-router/react-navigation` and does NOT add `@react-navigation/native` as a dep; MOBILE-03 says add it as a direct dep.
   - Unclear: whether the requirement author wanted the literal direct-dep, or just "don't let the transitive drop break the build."
   - Recommendation: use the codemop path (satisfies intent, lower risk); confirm with user if literal direct-dep is required. Resolve before writing hop-2 tasks.

2. **Keep or delete the committed `apps/mobile/android/` directory**
   - Known: it's git-tracked (50 files, stale June artifacts), EAS-ignored, and the source of the New-Arch divergence.
   - Recommendation: delete it (CNG). Confirm no one relies on it for a specific local Gradle workflow before removing.

3. **Green jest baseline before hops**
   - Known: 3 tests fail on SDK 54 today (ProfileHandoff × 1, GuestRequestsList × 2).
   - Recommendation: fix or quarantine + record known-red set as task 0 of the phase, so the per-hop gate is well-defined. Confirm whether fixing these is in-scope for Phase 22 or should be a documented known-red exception.

4. **Target 57.0.9 vs latest 57.0.10**
   - Known: MOBILE-04 pins `57.0.9`; npm `latest`/`next` = `57.0.10`.
   - Recommendation: honor the pin (57.0.9 exists and is fine); note 57.0.10 is one patch ahead if the user prefers newest.

## Sources

### Primary (HIGH confidence)
- Local files (read directly): `apps/mobile/package.json`, `app.json`, `eas.json`, `android/gradle.properties`, `babel.config.js`, `jest.config.js`, `.easignore`; `npx expo --version` (54.0.26), `npx eas whoami`, `npx jest`, `npx tsc --noEmit`, `node --version`, `npm audit --json`, `npm view expo dist-tags` / `versions`, `npm view @react-navigation/native version`.
- Expo SDK 55 changelog — https://expo.dev/changelog/sdk-55 (RN 0.83, New Arch mandatory, `newArchEnabled` removed, Node minimums)
- Expo SDK 57 changelog — https://expo.dev/changelog/sdk-57 (RN 0.86, no breaking changes, upgrade steps)
- Expo Router SDK 55→56 migration — https://docs.expo.dev/router/migrate/sdk-55-to-56/ (react-navigation fork, codemod, import map)

### Secondary (MEDIUM confidence)
- Expo SDK 56 ecosystem summaries (WebSearch, cross-checked against the official migration doc) — dev.to "Expo Router v56 Ships SSR and Breaks Free from React Navigation"; iOS min 16.4; Reanimated v3→v4 (N/A here).

### Project memory (point-in-time, verified against current code where load-bearing)
- `project_eas_build_status.md` (2026-06-04) — EAS build root-cause fixes: root `.npmrc legacy-peer-deps`, `.easignore` `/*.png` fix, **babel `dynamic-import-node` (KEY, still present)**, gradle `newArchEnabled=false` (local only). Confirmed babel plugin still in `babel.config.js`.
- `project_rooms_debug.md` (2026-06-12) — mobile role-gating + timezone gotchas; not upgrade-blocking but touches `_layout.tsx`/sync paths that the react-navigation change also touches.

## Metadata

**Confidence breakdown:**
- Current state: HIGH — read from files + live CLI output this session.
- Version targets & breaking changes: HIGH — npm dist-tags + official Expo changelogs/migration docs.
- npm audit categorization: HIGH — parsed from `npm audit --json` this session.
- MOBILE-03 approach recommendation: MEDIUM — official doc is clear, but the requirement wording conflicts; needs user decision.

**Research date:** 2026-08-05
**Valid until:** ~2026-09-05 (Expo patch releases move fast; re-check `npm view expo dist-tags` and `npm audit` at plan time)
