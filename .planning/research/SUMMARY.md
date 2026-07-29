# Project Research Summary

**Project:** PatelRep — Mobile UI Parity (v1.1 milestone)
**Domain:** Design-token + shared-primitive retrofit for an already-shipped Expo Router (SDK 54) React Native hotel floor-ops app
**Researched:** 2026-07-28
**Confidence:** HIGH

## Executive Summary

This is not a greenfield design-system build — it is a completion and wiring milestone for a system already ~70% built. `apps/mobile/components/shared/tokens.ts` already contains a mature token set (light + dark palettes, the protected cross-platform status-color contract, spacing/radius scales), and `mobileHandoff.tsx`/`evening.tsx` already provide a working primitive layer (IconButton, Pill, SectionLabel, HeroButton, Segmented, Avatar, Mono, AILabel, StatusPill, Chip, RoomQueueCard). 46 of 52 mobile files already import the token module. The real gaps: (1) dark-mode tokens exist but are completely unwired — zero `useColorScheme` usage anywhere, and the `C` constant every screen imports is a frozen, light-only snapshot baked into `StyleSheet.create` at module load; (2) four primitives are genuinely missing — Button, Card, EmptyState/StateBlock, Toast (today feedback is 65 blocking `Alert.alert` calls across 20 files); (3) status color+icon pairing is already done well in one place (`WorkOrderCard`) and needs formalizing/spreading, not inventing.

The recommended approach adds zero new npm dependencies — the reactive theme layer, four missing primitives, and a custom Toast can all be built from already-installed packages (react, RN's `Animated` API, `react-native-safe-area-context`, `@expo/vector-icons`, zustand). This is a hard constraint: the app's EAS build pipeline is fragile (`dynamic-import-node` babel plugin, New Architecture, `--legacy-peer-deps` for React 19), and any new native dependency risks breaking production builds in ways only visible in EAS, not local `expo start`. The token file stays exactly where it is; only a new reactive shell (`lib/theme/`) and new primitives (`components/ui/`) get added around it.

The single highest-risk item is making `StyleSheet.create`-frozen colors reactive to theme changes — touching 46+ files. Research converges on: build reactive shell light-only-active (zero visual change) → floor-role rollout → enable dark mode last as its own QA-gated phase, mirroring the web app's Wave 0→6 pattern. Secondary risks: mobile has no bilingual (EN/ES) lint gate (web does), so hardcoded English in new primitives ships invisibly; and "cosmetic" restyling PRs are the likeliest place to accidentally touch RBAC tab routing or role-gated data fetches, both frozen during this milestone.

## Key Findings

### Recommended Stack
No new runtime dependencies. Existing token module kept in place; new React Context `ThemeProvider`/`useTheme()` built on RN's `useColorScheme()`; four new primitives from core RN; custom Toast on RN's `Animated` API (not `react-native-toast-message` — confirmed broken on Expo SDK 54, issue #583, unresolved). NativeWind, `react-native-unistyles`, a full UI kit, and `sonner-native`/`burnt` were evaluated and rejected — each forces a native rebuild against a fragile EAS pipeline or imposes a foreign look.

### Expected Features
**Must have (P1, all gated on theme context):** `useTheme()` replacing hardcoded `C`; Button/IconButton (variants, loading, ≥44pt/48dp target, haptic); Card; StateBlock+EmptyState (one component); StatusBadge (color+icon, never color alone); non-blocking Toast replacing `Alert.alert`; dark mode wired to OS scheme + override, first on 5 floor screens (My Rooms, Room Board, Work Orders, Tasks, Inspect).
**Should have:** standardized haptics baked into primitives; optimistic offline-sync toast; skeleton-loader StateBlock variant.
**Do not build:** density modes (conflicts with large thumb-reachable targets), accent-color picker (risks the protected status contract), porting web's `MobileFloorNav` (native already has a real tab bar).

### Architecture Approach
Thin reactive shell (`lib/theme/`: ThemeProvider, useTheme, ToastProvider, useToast) around the existing token data (unmoved), plus `components/ui/` holding exactly the four missing primitives. Existing atoms reused and theme-migrated in place, never re-cloned. Do-not-disturb: offline-sync queue, i18n floor contract, RBAC tab routing (`roleTabs.ts`) — frozen this milestone.

### Critical Pitfalls
1. Frozen `StyleSheet.create` colors don't move on theme toggle — set the reactivity pattern in Phase A before any screen migrates.
2. Dual source of truth (`C` vs. `lightTheme`/`darkTheme`) — freeze `C` as deprecated-on-contact, track burndown.
3. A new dependency breaks the EAS build, not local dev — zero new deps by default; require a green EAS build for any exception.
4. Primitives regress bilingual coverage — no lint gate exists on mobile; add one in Phase A, require pre-translated strings only.
5. Expo Router navigator chrome doesn't inherit tokens — theme React Navigation's `screenOptions`/`tabBarStyle`/`StatusBar` explicitly.

## Implications for Roadmap

**Suggested phases: 4**

1. **Phase 1 — Foundation (Reactive Theme Shell + Missing Primitives):** Zero visual change; build `ThemeProvider`/`useTheme()` (light-only active), `ToastProvider`/`useToast()`, the four `components/ui/` primitives, mobile bilingual lint gate. Avoids Pitfalls 1,3,4,5,6,7.
2. **Phase 2 — Floor-Role Rollout:** Migrate My Rooms, Room Board, Work Orders, Tasks, Inspect onto Phase 1 primitives; formalize StatusBadge; still light-only. Avoids Pitfalls 2, 8, 9.
3. **Phase 3 — Remaining Screens Rollout:** Same migration extended to profile/supervisor/companion/guest-requests/lost-found/logbook/alerts/staff/SOP. Same pitfalls as Phase 2, app-wide.
4. **Phase 4 — Dark Mode Enablement + Accessibility QA:** Enable and persist the dark toggle; full dark-mode QA sweep; contrast/touch-target/reduced-motion audit; confirm offline-sync/i18n/RBAC still pass. Avoids Pitfalls 1, 7, 9.

**Phase ordering rationale:** Dependency order is strict — theme context gates primitives, primitives gate floor rollout, full migration gates dark mode. Floor-before-rest matches product priority and avoids the "half-migrated app feels broken" UX pitfall. Dark mode last concentrates the highest-risk verification work into one QA-gated phase instead of an easy-to-skip per-screen checkbox.

### Research Flags
- **Needs research:** Phase 1 — the `Animated`-based Toast implementation and React-Navigation-chrome-theming approach (Pitfall 7) have no pre-built reference in this codebase.
- **Standard patterns (skip research-phase):** Phase 2 & 3 (mechanical migration, process discipline not unknowns); Phase 4 (tokens already fully specified, verification only).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against package.json; toast-message breakage is a documented open issue. STACK.md's proposed token relocation was corrected in synthesis per verified-in-repo findings. |
| Features | HIGH | Grep-verified against actual mobile source. |
| Architecture | HIGH | Direct reads + file/grep census; corrected the milestone brief's inaccurate "no shared UI layer" premise. |
| Pitfalls | MEDIUM-HIGH | This-app claims verified in code; general RN/Expo behaviors are documented but not this-repo-specific. |

**Overall confidence:** HIGH

### Gaps to Address
- Exact React Navigation chrome-theming API calls for this Expo Router version — confirm during Phase 1, don't assume.
- Toast/OfflineBanner stacking order/z-index contract — decide during Phase 1 design.
- Whether to freeze `C` immediately vs. migrate-and-burn-down — roadmap should pick one explicitly.
- `roleTabs.ts` duplicate `case "engineer"` — pre-existing lint smell, worth a one-line cleanup if a wave touches neighboring code.

## Sources

**Primary (HIGH):** Direct reads of `tokens.ts`, `evening.tsx`, `mobileHandoff.tsx`, `WorkOrderCard.tsx`, `roleTabs.ts`, `appStore.ts`, `app/_layout.tsx`, `app/(app)/_layout.tsx`, `my-rooms/index.tsx`, `app.json`, `babel.config.js`, `package.json`; grep census (46/52 files import tokens, 65 Alert.alert/Haptics uses, zero useColorScheme except 1 hardcoded-dark file, no no-literal-string rule); react-native-toast-message issue #583; Expo SDK 54 changelog + New Architecture guide; `.planning/PROJECT.md`; `.planning/UI-REFRESH-PLAN.md`.
**Secondary (MEDIUM):** NativeWind v5 docs, react-native-unistyles docs, sonner-native/burnt GitHub repos, Apple HIG/Material 3 conventions.

---
*Research completed: 2026-07-28*
*Ready for roadmap: yes*
