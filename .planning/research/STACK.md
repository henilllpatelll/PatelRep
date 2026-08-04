# Stack Research

**Domain:** Platform/ops hardening on an existing production FastAPI (Python 3.13, no ORM) + Next.js + Expo/React Native (Android-only EAS) SaaS — no new user-facing features
**Researched:** 2026-08-04
**Confidence:** HIGH (current repo state read directly; Expo SDK 55/56/57 changelogs fetched from official `expo.dev/changelog`; RBAC finding based on direct grep of all 21 routers)

> Scope note: this file replaces stale research left in `.planning/research/` from the now-archived v1.3
> milestone (self-serve billing + work-order bulk-archive, shipped 2026-08-04 — see `.planning/milestones/v1.3-*`
> and `.planning/v1.3-MILESTONE-AUDIT.md` for that content). It covers only the two v1.4 stack-relevant
> target items: the `apps/mobile` Expo major bump and FastAPI RBAC normalization.

---

## TL;DR Recommendations

| Question | Answer |
|----------|--------|
| Jump straight from Expo 54 to 57? | **No — hop one SDK at a time (54→55→56→57).** SDK 55 removes Legacy Architecture support entirely (moot here — New Arch is already on) and SDK 56 makes a breaking change this repo's code actually hits (`expo-router` drops its React Navigation dependency; `app/_layout.tsx` imports `@react-navigation/native` directly). A direct 54→57 jump compounds these into one hard-to-bisect diff. |
| Is New Architecture migration needed first? | **No.** `app.json` already has `newArchEnabled: true` on both `ios` and `android`. SDK 55 just deletes the (now redundant) config key — a cleanup line, not a blocker. |
| Does `--legacy-peer-deps` survive the bump? | **Unverified by upstream docs — must be re-tested at each hop.** Nothing in the SDK 55/56/57 changelogs removes the React 19 requirement (React 19.1→19.2 is the whole delta), so the peer-dep friction that made `--legacy-peer-deps` necessary at 54 has no documented reason to disappear. Treat "still required" as the default assumption until `npm install` is run clean at each hop. |
| Biggest concrete break for *this* repo | **`@react-navigation/native` becomes an unmanaged dependency at SDK 56.** `app/_layout.tsx` and `lib/theme/navigationTheme.ts` both `import { ThemeProvider } from "@react-navigation/native"` today, relying on it arriving transitively via `expo-router`. SDK 56's `expo-router` no longer depends on React Navigation, so this import will 404 at `npm install` time unless `@react-navigation/native` is added as an explicit direct dependency before or during the 55→56 hop. |
| Does `babel-plugin-dynamic-import-node` still work? | **Yes, no documented incompatibility.** Nothing in the SDK 55/56/57 changelogs touches `babel-preset-expo`'s dynamic-import handling or `jest-expo`'s Babel config loading in a way that conflicts with this plugin. Re-verify by running `npx jest` at each hop (existing CLAUDE.md verification-loop policy already covers this). |
| New FastAPI RBAC library needed? | **No.** Current best-practice sources for 2026 converge on FastAPI's own dependency-injection pattern (which this repo already has via `require_role()`) as the lightweight approach; the alternatives (Casbin, external IdP-based RBAC like ZITADEL/Logto) are heavyweight and would mean re-architecting auth around a policy engine or replacing Supabase-JWT-claims auth outright — neither fits "zero new heavy dependency." The fix is **consolidation of existing patterns**, not a new package. |

---

## Recommended Stack

### Core Technologies (already installed — version targets only)

| Technology | Current | Target | Purpose | Why |
|------------|---------|--------|---------|-----|
| `expo` | `~54.0.0` (resolved `54.0.36`) | `57.0.9` | Mobile SDK meta-package | Closes 19 of 27 `npm audit` advisories left after Plan 11-02's patch-level fix — all in the `@expo/*`/`expo-*` family, only reachable via a major bump. |
| `react-native` | `0.81.5` | `0.86.x` (bundled by `expo@57`) | Native runtime | SDK 55→RN 0.83, SDK 56→RN 0.85, SDK 57→RN 0.86. RN 0.86 is documented as "intended to have no breaking changes from 0.85." |
| `react` / `react-test-renderer` | `19.1.0` | `19.2.x` | UI runtime | SDK 56 and 57 both pin React 19.2; SDK 55 is the hop that moves off 19.1. No React API breaking changes documented for this jump. |
| `expo-router` | `~6.0.24` | SDK-57-aligned (`npx expo install --fix` resolves it) | File-based routing | **Loses its `@react-navigation/*` dependency at SDK 56** — see [What NOT to Skip](#what-not-to-skip-during-the-bump). |
| `expo-updates` | `~29.0.18` | SDK-57-aligned | OTA updates (`runtimeVersion`/`updates.url` are configured in `app.json`) | No `eas update` CI automation exists in this repo today (`.github/workflows` has no matching file), so SDK 55's new `eas update --environment` requirement is a non-issue *unless* v1.4 also introduces OTA-update CI — flag if so. |
| `@expo/vector-icons` | `^15.0.3` (already an explicit direct dependency) | SDK-57-aligned | Icon set | SDK 56 removes `@expo/vector-icons` as a transitive dep of the `expo` package itself — **this repo is already unaffected** because it already lists the package directly in `package.json`. |
| `typescript` | `~5.9.2` | keep, or bump to `6.0.x` optionally | Type checking | SDK 56's *template* defaults to TypeScript 6.0.3; this is a new-project default, not a runtime requirement — safe to leave pinned at 5.9.2 (opt out is automatic since it's not in `expo.install.exclude` territory — nothing forces the bump). |

### Third-party Expo-ecosystem package requiring a version-scheme change

| Library | Current | Target | Why This One Is Different |
|---------|---------|--------|----------------------------|
| `expo-speech-recognition` | `^0.3.2` | `57.0.x` (aligns to Expo SDK numbering from SDK 56 onward per the maintainer's own release notes) | This is a **community package**, not an Expo-owned one, so `npx expo install --fix` may or may not correctly resolve it depending on whether it's listed in Expo's bundled compatibility manifest for SDK 57 at bump time — **manually verify the installed version after `expo install --fix` runs**, don't assume it auto-resolves like the `expo-*` first-party packages do. It is New-Architecture-compatible via TurboModules (relevant since New Arch has been mandatory since SDK 55), so no functional rewrite is expected — just a version-pin update. |

### Supporting Libraries — no changes required

`@react-native-async-storage/async-storage`, `@react-native-community/netinfo`, `@supabase/supabase-js`, `i18next`/`react-i18next`, `react-native-safe-area-context`, `react-native-screens`, `react-native-url-polyfill`, `zustand` — none of these are Expo-SDK-versioned packages and none appear in any SDK 55/56/57 breaking-change list. `npx expo install --fix` will re-pin the Expo-managed subset (`react-native-safe-area-context`, `react-native-screens`) to SDK-57-compatible ranges; the rest are untouched.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `npx expo-doctor@latest` | Post-bump sanity check | Explicitly recommended in the official SDK 57 upgrade steps; run after each hop, not just the final one. |
| `npx expo-codemod sdk-56-expo-router-react-navigation-replace [dir]` | Automated migration for the `expo-router`/React Navigation split at SDK 56 | Official codemod exists — evaluate whether it also handles a repo's *own* direct `@react-navigation/native` imports (this repo's `_layout.tsx` theme import) or only `expo-router`-internal usage; likely needs the explicit-dependency fix (below) regardless of codemod use. |
| EAS Build cloud runner Node version | Node requirement floor rises with each hop | SDK 55 requires Node `^20.19.4`/`^22.13.0`/`^24.3.0`/`^25.0.0`; SDK 56 (RN 0.85) drops support for Node `<20.19.4`. Local dev Node is `v22.18.0` (satisfies both). **`eas.json` currently has no `build.<profile>.node` pin** — the EAS cloud image's default Node version should be confirmed compatible before the first post-bump cloud build, since a stale cached EAS image is the more likely failure point than local dev. |

## Installation

```bash
cd apps/mobile

# Hop 1: 54 -> 55
npx expo install expo@^55.0.0 --fix
# Add the now-unmanaged nav dependency BEFORE or AT this hop (see What NOT to Skip):
npm install @react-navigation/native --legacy-peer-deps   # version per `expo install --fix` resolution
npx expo-doctor@latest
npx jest --passWithNoTests   # verify babel-plugin-dynamic-import-node still transforms cleanly
npm run type-check

# Hop 2: 55 -> 56
npx expo install expo@^56.0.0 --fix
npx expo-codemod sdk-56-expo-router-react-navigation-replace .   # evaluate output before committing
npx expo-doctor@latest
npx jest --passWithNoTests
npm run type-check

# Hop 3: 56 -> 57 (target)
npx expo install expo@57.0.9 --fix
npx expo-doctor@latest
npx jest --passWithNoTests
npm run type-check
npm run lint

# After all three hops: verify third-party package version resolution manually
npm ls expo-speech-recognition

# EAS gate (per CLAUDE.md fragile-pipeline policy — required before merge):
eas build --profile preview --platform android
```

## What NOT to Skip During the Bump

| Step | Why It's Not Optional Here |
|------|----------------------------|
| Adding `@react-navigation/native` as an explicit `package.json` dependency | Without it, `npm install` at SDK 56+ leaves `app/_layout.tsx`'s `import { ThemeProvider } from "@react-navigation/native"` unresolved — a hard build failure, not a warning. This is the one breaking change in the SDK 55→57 range that is *specific to this repo's actual code*, not a generic upgrade-guide item. |
| Hopping one SDK at a time instead of jumping straight to 57 | Community upgrade guidance for this SDK range explicitly warns against multi-hop jumps because they compound breaking changes and make bisecting a broken build much harder. Given this repo's fragile/EAS-gated pipeline (CLAUDE.md), a green build at each hop is cheaper than debugging a combined 3-version diff. |
| Re-running the EAS cloud build after each hop, not just the final one | The EAS cloud runner's Node/toolchain floor rises with SDK 56 (RN 0.85 drops Node `<20.19.4`); a hop-by-hop build catches an EAS-image mismatch before it's buried under two more SDK bumps' worth of changes. |
| Manually confirming `expo-speech-recognition`'s resolved version post-bump | It's the one dependency in this repo whose *versioning scheme itself* just changed (aligning to Expo SDK numbers from SDK 56 on) — `expo install --fix`'s automatic resolution is proven for Expo-first-party packages, not guaranteed for this community package. |

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Hop 54→55→56→57, one EAS build per hop | Direct `npx expo install expo@57.0.9 --fix` in one shot | Only if the team accepts higher debugging risk in exchange for fewer EAS cloud-build cycles (each cloud build costs CI/EAS quota); given this pipeline is explicitly documented as fragile, the incremental path is the safer default here. |
| Add `@react-navigation/native` as an explicit dependency, keep the existing `ThemeProvider` usage | Rewrite `_layout.tsx`'s theming to avoid `@react-navigation/native` entirely (e.g. move theme values into a plain context provider) | Consider this only if the milestone's scope already includes touching navigation/theming for another reason — for a pure dependency-hardening pass, adding the one now-unmanaged package back explicitly is the minimal, lowest-blast-radius fix. |
| Consolidate FastAPI RBAC on the existing `require_role()` dependency + a small shared role-constants/helper module | Adopt `python-casbin` / `fastapi-authz` (policy-engine RBAC) | Only if PatelRep's authorization model grows past simple role membership into resource-level or attribute-based policies (e.g. "engineer can only act on work orders in their assigned zone" expressed declaratively) — not the case today; the codebase already expresses that kind of check as inline business logic reading real row data, which a static policy file can't easily replace anyway. |
| Consolidate FastAPI RBAC in-repo | External IdP-managed RBAC (ZITADEL, Logto) | Only if PatelRep ever moves auth off Supabase JWT custom claims entirely — a much larger architectural change than "normalize RBAC," out of scope for a hardening milestone. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| A direct `expo@54 → expo@57` single-command bump | Skips the SDK 55 (Legacy Architecture removal — moot but still a config surface change) and SDK 56 (`expo-router`/React Navigation split — repo-breaking) intermediate changes, compounding them into one diff against a documented-fragile EAS pipeline. | The three-hop path above, one EAS build per hop. |
| `python-casbin`, `fastapi-permissions`, or any other new RBAC package for the FastAPI normalization | Adds a new heavy dependency (policy files or ACL abstractions) to normalize what is, on inspection, mostly either (a) true duplicate 403-gate checks that `require_role()` already solves, or (b) legitimate row-level business logic (e.g. "is this engineer the one assigned to this work order," `actor_role` audit attribution) that no declarative RBAC library replaces — it would still need to be hand-written as custom policy code. | Consolidate on `require_role()` for pure gates; add one small shared constants/helper module for repeated role-set definitions (see [FastAPI RBAC Normalization](#fastapi-rbac-normalization-current-state--recommendation) below). |
| Leaving `@react-navigation/native` as an implicit transitive dependency past SDK 55 | It silently stops being installed once `expo-router` drops the dependency at SDK 56, and this repo's own code imports from it directly — the failure mode is a build break discovered late, not a deprecation warning discovered early. | Add it to `package.json` `dependencies` explicitly during the 55→56 hop, before the break can occur. |

## FastAPI RBAC Normalization — Current State & Recommendation

Direct grep of `apps/api/routers/` confirms two genuinely different things are mixed under "inline role checks," and they need different treatment:

**Pattern A — true duplicate gates** (candidates for `Depends(require_role(...))`):
```python
# guest_requests.py:213, 300, 334, 444, 476, 493 — six near-identical instances
if current_user.role not in MESSAGE_ROLES:
    raise HTTPException(status_code=403, detail="Not authorized to contact guests")
```
This is functionally identical to the existing `require_role()` dependency (`apps/api/middleware/auth.py:127`) — it should be replaced with `current_user: CurrentUser = Depends(require_role(*MESSAGE_ROLES))` in the route signature, eliminating the duplicated `if`/`raise` boilerplate.

**Pattern B — role used as data, not as a gate** (leave inline, no library replaces this):
```python
# work_orders.py:38, safety.py:44, guest_requests.py:382 — representative examples
if current_user.role != "engineer": return                      # ownership/eligibility check on live row data
"actor_role": current_user.role,                                 # audit-trail attribution, passed to a DB function
"approved_by": current_user.user_id if current_user.role == "gm" else None,  # conditional field assignment
```
These read `current_user.role` as a **value**, not as an authorization gate — no RBAC library (existing dependency or a new one) replaces this, because the logic depends on the specific row being acted on, not just "who is calling."

**Pattern C — conditional gate** (partial win, needs a shared helper not a dependency):
```python
# guest_requests.py:375
if requires_approval and current_user.role not in {"gm", "front_desk"}:
    raise HTTPException(status_code=403, detail="Only front desk or GM may request compensation")
```
Can't be a route-level `Depends(require_role(...))` since it's conditional on request-body data — but the repeated `if role not in {...}: raise HTTPException(403, ...)` shape is worth extracting into a small `assert_role(current_user, roles, detail)` helper to cut boilerplate and keep the 403 message format consistent.

**A secondary finding worth flagging for planning:** each router currently defines its own local role-set constant (`MESSAGE_ROLES`, `SLA_POLICY_ROLES`, `MANAGER_ROLES` in `guest_requests.py`/`safety.py` alone) rather than sharing one canonical source. This is a real drift risk — nothing stops two routers' "manager" role sets from silently diverging over time. Recommended fix scope for v1.4: add canonical role-group constants (e.g. `MANAGEMENT_ROLES`, `MESSAGE_ROLES`) to `apps/api/middleware/auth.py` (already the home of `require_role()`), import them everywhere instead of re-declaring, and migrate Pattern A call sites to `Depends(require_role(...))`. This is a **zero-new-dependency, in-repo refactor** — matches CLAUDE.md's "flat architecture" convention (`middleware/auth.py` already owns cross-router auth concerns; no new `services/` module needed since this isn't shared business logic).

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `expo@57.0.9` | `react-native@0.86.x`, `react@19.2.x` | React unchanged from SDK 56 (both pin 19.2) — the only version delta between 56 and 57 is React Native 0.85→0.86, documented as non-breaking. |
| `expo@55.x`+ | New Architecture **mandatory**, `newArchEnabled` config key removed | This repo already runs New Arch on both platforms (`app.json`), so this is a no-op functionally — but the now-dead `newArchEnabled: true` lines in `app.json` should be removed for cleanliness once on SDK 55+ (cosmetic, not required for the build to succeed). |
| `expo-router@` SDK-56-aligned | No longer requires `@react-navigation/*` | This repo's own `_layout.tsx`/`navigationTheme.ts` re-introduce the dependency manually — see [What NOT to Skip](#what-not-to-skip-during-the-bump). |
| `expo-speech-recognition` | Expo SDK version number (from SDK 56 on) | Pre-SDK-56 versioning (`^0.3.2`) predates this alignment; expect the installed version string to jump to something like `57.0.x`, not a semver-continuous `0.4.x`. |
| Node.js (EAS Build + local dev) | `^20.19.4` / `^22.13.0` / `^24.3.0` / `^25.0.0` (SDK 55 floor); RN 0.85 drops `<20.19.4` (SDK 56) | Local dev Node `v22.18.0` already satisfies both; `eas.json` has no explicit `node` pin per build profile — confirm the EAS cloud image default meets this floor before the first post-bump cloud build. |

## Sources

- Direct repo inspection: `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/babel.config.js`, `apps/mobile/eas.json`, `apps/mobile/app/_layout.tsx`, `apps/mobile/lib/theme/navigationTheme.ts`, `apps/api/middleware/auth.py`, `apps/api/routers/{work_orders,guest_requests,safety,rooms,staff,scheduling,ai_copilot,tasks,assets,evidence,logbook,programs,lost_found,late_checkout,clean_sessions,feedback,auth}.py` (HIGH — current code, current session).
- [Expo SDK 55 changelog](https://expo.dev/changelog/sdk-55) — official, fetched this session (HIGH).
- [Expo SDK 56 changelog](https://expo.dev/changelog/sdk-56) — official, fetched this session (HIGH).
- [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57) — official, fetched this session (HIGH).
- [Expo upgrade walkthrough docs](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/) — official (HIGH).
- [Expo React Native New Architecture guide](https://docs.expo.dev/guides/new-architecture/) — official, confirms SDK 55+ mandatory New Arch (HIGH).
- [jamsch/expo-speech-recognition releases](https://github.com/jamsch/expo-speech-recognition/releases) — maintainer's own versioning-scheme change note, WebSearch-sourced summary (MEDIUM — not directly fetched from the release page itself, cross-checked against the New-Architecture/TurboModules claim in a second independent article).
- WebSearch synthesis on Expo SDK 57 (X/Expo official account changelog announcement, buildmvpfast.com, paddyb.com) — cross-checked against the official changelog fetch above; used only for framing/RN-version confirmation, not as the primary source (MEDIUM).
- WebSearch synthesis on 2026 FastAPI RBAC best practices (permit.io, app-generator.dev, various Medium posts) — converged on "FastAPI dependency injection is the lightweight-native pattern; external IdP/policy-engine libraries are the heavyweight alternative," no single authoritative source, but consistent across multiple independent articles (MEDIUM).

---
*Stack research for: v1.4 Platform and Ops Hardening — Expo major-version bump + FastAPI RBAC normalization (PatelRep)*
*Researched: 2026-08-04*
