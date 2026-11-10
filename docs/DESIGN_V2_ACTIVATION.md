# Design System V2 is the permanent PatelRep design

**Status:** permanent default for every existing and future hotel, all seven mobile roles and the manager web app. There is no rollout flag, preview
variable or per-hotel switch any more. This document replaces the earlier per-hotel activation guide (PR #201); the history is in git.

## What changed

| Before | Now |
|---|---|
| V2 shown only when the hotel's `design_v2` flag was on (read from `GET /auth/me`) or a dev preview variable was set | V2 is unconditional. Nothing is read, fetched or cached to decide it |
| `design_v2` registered in `apps/api/core/feature_registry.py` and `apps/web/lib/featureRegistry.ts` | Removed from both registries (parity gate passes with 5 keys) |
| `NEXT_PUBLIC_DESIGN_V2_PREVIEW` / `EXPO_PUBLIC_DESIGN_V2_PREVIEW`, `/design-v2-preview` routes, sample-data previews | Removed (variables, routes, `HousekeeperHomePreview`, `DashboardPreview`, `StatesShowcase`) |
| Mobile: `designV2Store`, `useDesignV2Sync` (10-minute foreground/reconnect refresh), `useDesignV2Active`, role-gated `DesignV2Scope enabled=` | Removed. `DesignV2Scope` remains only to **pin light/dark** for a subtree; without a provider the default is already V2 |
| Web: `isDesignV2Enabled()`, `useDesignV2`, `designV2Activation`, shell swap in `DashboardShell`, flag-guarded sign-in | `DashboardShell` always renders `ShellV2`; sign-in is always the V2 form; legacy sign-in/shell markup deleted |
| Signed-out screens stayed legacy in production (no hotel known yet) | Signed-out sign-in, recovery and account screens are V2 |

Consequences you can rely on:

- **New hotels** need no setup. **Existing hotels** get V2 whether their old `design_v2` row was `true`, `false` or missing.
- **Account switching cannot restore legacy styling:** there is no per-person or per-hotel design state to go stale (the app store no longer holds any).
- It is still purely visual. No permission, route guard, RBAC rule, billing, AI, credit, database or offline code reads or depends on it.
- The web hotel-context refresh (visibility, reconnect, 10-minute timer) is **kept**, with its constants moved into `Providers.tsx`, because other tenant feature flags still reach an open tab that way.

## What was deliberately NOT touched

- The shared feature-flag framework (`tenant_feature_flags`, `feature_flag_events`, the Feature Rollout workflow, `core/feature_flags.py`) and every other flag.
- **Production data and audit history.** Existing `tenant_feature_flags` rows with `feature_key='design_v2'` and their `feature_flag_events` stay exactly as they are; no migration, no bulk update, no deletion. They are now inert: `/auth/me` builds `enabled_features` by iterating the registry, so an unregistered key is never returned, and a test pins that. Feature Rollout will now reject `design_v2` as an unknown key, which is intended.
- Supabase migration history (nothing was added or changed).

## Dead legacy code still in the tree (honest scope note)

Making V2 unconditional removed every decision point, but many mobile components still contain their old **legacy branch** (`useIsDesignV2() ? <V2/> : <Legacy/>`), now unreachable because the hook returns `true`. They were left in place on purpose: deleting dozens of component branches in the same PR would make the diff impossible to review against the "no behaviour change" requirement. They are a pure follow-up cleanup (delete the `false` branch, then the hook). The reachable app is V2 only; a contract test proves no flag, preview variable or activation function remains. On web the legacy shell, sign-in, dashboard layout, board filters and several small legacy class branches were deleted outright.

## V2 colour/token migration is not the same as a finished layout redesign

Applying V2 everywhere means every screen now uses V2 colours, typography, components and chrome. It does **not** mean every screen has been restructured. The per-screen matrix (design doc section 69, final audit Phase 9 "Still not done") lists areas that are token-migrated but not re-laid-out (for example Housekeeping Team Plan/Assignments/Room detail, Engineering assets/PM/vendors/WO record, Guest Operations drawers, Scheduling, and many settings screens). That layout work is separate and is not claimed here.

## Existing installed mobile builds

Builds from before PR #201 contain the old bundle-time guard and no flag reader, so they stay on the legacy design until the phone gets a build or OTA update that contains this change. Builds from #201 read the flag; after this change ships they keep reading a flag that nothing writes, so they stay on their last answer until updated. Plan the release so hotels update the app (store or OTA) rather than relying on the server.

## Rollback plan

This is a code change; there is no flag to flip back (that was the point). Options, cheapest first:

1. **Web:** redeploy the previous web build (Railway/Vercel "redeploy previous"). No data change.
2. **Mobile OTA:** `eas update` the previous commit's JS bundle to the production channel (same runtime version). No new binary.
3. **Mobile binary:** previous store build; V2 phones keep working because nothing server-side changed.
4. **Source:** `git revert` the merge commit. The reverted code re-registers `design_v2`; because the existing rows were never deleted, hotels that had it on come back on, and hotels that had it off or missing go back to legacy. No data repair is needed.

The API change (removing `design_v2` from the registry) is independent and safe to leave in place during a web/mobile rollback: old clients read `enabled_features`, find no `design_v2`, and fall back to legacy, which is the safe direction.

## Verification that is automated

- API: `tests/test_design_v2_retired.py`: key gone from the registry; a leftover `true`/`false`/missing row is inert for all seven roles; other flags still returned; rows untouched by a read; no AI call or credit spend; no backend file mentions the key.
- Web (`npm run test:unit`, `lib/design/designV2Permanent.test.ts` plus the updated shell/remap/dialog contracts): activation modules and preview route gone; no source reads the flag or preview variable; `DashboardShell` always `ShellV2`; sign-in always V2; registry has no `design_v2`; route guard unchanged apart from the retired preview route.
- Web browser (hermetic, `npm run test:e2e:design-v2`, not wired into CI): V2 for a hotel with the flag missing / present / only unrelated flags, light and dark; switching hotels never shows a legacy frame; signed-out sign-in is V2; the preview route is gone.
- Mobile (`__tests__/lib/design/designV2Permanent.test.tsx`, `reactiveTypography.test.tsx`): V2 tokens with no provider in light and dark, chrome and housekeeper accent V2, a scope can only pin the mode, all seven roles x light/dark keep V2 typography, account switching and sign-out cannot restore legacy, English and Spanish text untouched; source scans prove no flag/preview/sync/store remains and no EAS profile or workflow sets a preview variable.

## Manual device and assistive-technology checklist (not run by automation)

Do this on **one iPhone and one Android phone** before relying on the release, per role (housekeeper, inspector, housekeeping supervisor, engineer, chief engineer, front desk, GM), in light and dark, English and Spanish:

1. Cold start signed out: sign-in, forgot-password and recovery screens are V2 (no flash of the old look); the keyboard does not cover the focused field.
2. Sign in and land on Home; the tab bar is the V2 bar with correct icons, labels and badges; visit each tab and a hidden route (a work order, a room, Settings) and come back without bouncing to Home.
3. Open every drawer, sheet and modal reachable for the role (room actions, filters, report an issue, handoff, assistant); dismiss by swipe, button and Android back; focus returns sensibly.
4. Switch account (sign out, sign in as a different role or hotel) and confirm nothing from the previous person's styling or data remains.
5. Offline: toggle airplane mode; the offline banner is V2; queued actions still sync on reconnect (housekeeping completion, PM, tasks).
6. Change the OS appearance while the app is open; all text stays readable, no white-on-light controls.
7. Largest Dynamic Type / font scale: nothing clipped, no leftover uppercase labels, touch targets at least 44 pt.
8. VoiceOver (iOS) and TalkBack (Android): each tab, a list row, a sheet, a form field with an error and the assistant read sensibly and in order. A desktop screen reader on the web sign-in and dashboard.
9. Web in Chrome, Safari and Firefox: sign-in, dashboard, one page per sidebar group, a drawer (focus trapped, Escape closes, focus returns), the dark-mode toggle in Display preferences.
10. Repeat the key flows in Spanish and confirm no raw translation keys appear.

## Remaining known V2 gaps (not regressions of this change)

- Static sub-12 pt font literals still exist in several shared mobile files (for example `evening.tsx`, `supervisor/atoms.tsx`, `CopilotCard.tsx`, `mobileHandoff.tsx`). Labelled elements are floored to 12 by the `useV2Text()` overlays, but unlabelled literals need a device or visual pass.
- The Onboarding wizard's manual-entry tab never saves typed rooms (pre-existing, documented in the Phase 12 audit addendum; needs a product decision).
- Everything in "Still not done" in `PATELREP_DESIGN_V2_FINAL_AUDIT.md` that is not about activation.
