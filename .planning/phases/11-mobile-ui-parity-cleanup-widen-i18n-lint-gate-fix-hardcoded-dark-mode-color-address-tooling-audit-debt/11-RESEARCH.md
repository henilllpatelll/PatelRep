# Phase 11: Mobile UI Parity Cleanup - Research

**Researched:** 2026-08-01
**Domain:** Expo/React Native mobile app hardening — ESLint i18n gate coverage, theme token usage, error-handling consistency, i18n locale parity, npm supply-chain audit remediation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (Phase Boundary — the 5 concrete items)

Close the non-blocking tech debt surfaced by `.planning/v1.1-MILESTONE-AUDIT.md` after Phases 7-10 were individually verified `passed`. This is a hardening/bugfix pass, not new capability:

1. Widen `apps/mobile/eslint.config.mjs`'s `i18next/no-literal-string` gate to cover the ~14 Phase-9-migrated directories it currently misses (profile, home, assignments, scheduling, staff, assets, pm-schedules, guest-requests, lost-found, logbook, sop, copilot, alerts, notifications, supervisor/home components).
2. Replace the hardcoded `#CBB8F0` AI-sparkles color in `apps/mobile/app/(app)/home/index.tsx:212` with a semantic `theme.ai.*` token.
3. Fix `FoundItemModal.tsx`'s empty catch block (lines 121-124) to surface user feedback instead of silently swallowing submission errors.
4. Add the missing `workOrders.searchPlaceholder` i18n key to EN/ES locale files (`apps/mobile/app/(app)/work-orders/index.tsx:275` references a key that doesn't exist).
5. Review the 58 `npm audit --audit-level=high` advisories in `apps/mobile` (42 high, 1 critical) and remediate what's safe.

The user declined a discussion pass on these — the 5 items are concrete enough from the audit report to plan directly. All implementation-choice gray areas below are Claude's discretion, informed by existing project constraints.

### Claude's Discretion

- **i18n gate rollout strategy:** Prefer widening the gate to all remaining directories in one pass, fixing any newly-caught raw literals with EN/ES keys as part of the same plan (mirrors Phase 9's own 09-00 approach for its 4 originally-exempted files) — rather than staging directory-by-directory, since Phase 9 already migrated these screens onto primitives and any literals left are incidental, not systemic.
- **npm audit remediation depth:** CLAUDE.md documents the mobile EAS build pipeline as fragile (`dynamic-import-node` babel plugin, New Architecture, `--legacy-peer-deps` for React 19) with "zero new npm dependencies planned by design; any exception requires a green EAS build before merging." Apply this same discipline here: prefer patch/minor-level fixes within `npm audit fix` (no `--force`), skip any major version bump that would touch Expo/RN/Jest/ESLint core packages unless a specific advisory is a genuine, exploitable risk in this app's actual usage (most transitive advisories in dev/build tooling, e.g. ESLint/Jest internals, are not runtime-exposed). Document any advisory deliberately left open with reasoning, matching the audit's own recommendation. Any dependency change must still pass a green EAS build before merging, per the existing project rule — do not skip this gate.
- **FoundItemModal error behavior:** Show a Toast error consistent with how sibling submission flows in the same modal family (ReportIssueModal, SupplyRequestModal — both already migrated in Phase 8/9) handle failure, so behavior is consistent across the 4 room-detail modals rather than inventing a new pattern for just this one.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope (user chose to skip discussion entirely; no scope creep suggested).

**Also explicitly out of scope (confirmed by `.planning/v1.1-MILESTONE-AUDIT.md`, not part of this phase's 5 items):**
- `ChecklistSection.tsx`'s 2 remaining `Alert.alert` calls (camera-permission, damage-photo) — explicit prior out-of-scope decision, documented, do not touch.
- `sop/[sopId].tsx`'s inert "Ask about this SOP" button handler — intentionally preserved as-is per prior phase decision.
</user_constraints>

## Summary

All 5 items were verified directly against the live repo (not just the audit report) using ESLint dry-runs, `npm audit`/`npm audit fix --dry-run`, and code search across the actual codebase. Two important corrections to the audit report's numbers surfaced during this research: (1) the npm audit advisory count has changed since the audit was written — it is currently 27 advisories (1 critical, 10 high, 15 moderate, 1 low), not 58/42/1 — almost certainly because the underlying GitHub Advisory Database changed between when the audit ran and now, not because the lockfile changed (git history confirms `package-lock.json` is untouched since the ESLint-gate commit); (2) item 3's "FoundItemModal" fix target already has `useTheme()`/`useToast()`/`useTranslation()` imported and in scope, and a near-identical toast-error pattern already exists in the same-family `SupplyRequestModal.tsx` — this is a 2-line fix, not a refactor.

Widening the ESLint gate to the 14 previously-uncovered directories (plus `components/supervisor/**` and `components/home/**`, which the audit's prose also names) was tested directly: an actual widened ESLint config run against the live code surfaces exactly **52 raw-literal violations across 8 files in 6 of the ~16 newly-covered path globs** (`assignments/index.tsx`, `guest-requests/[requestId].tsx`, `guest-requests/index.tsx`, `lost-found/index.tsx`, `notifications/index.tsx`, `profile/index.tsx`, `scheduling/index.tsx`, `sop/[sopId].tsx`, `sop/index.tsx`, `components/supervisor/BroadcastModal.tsx`, `components/supervisor/ShiftNoteModal.tsx`, `components/supervisor/atoms.tsx`). The remaining directories — `home`, `staff`, `assets`, `pm-schedules`, `logbook`, `copilot`, `alerts`, `components/home` — produce **zero** violations once gated, so widening the gate to them is a pure config change with no accompanying literal-fixing work.

**Primary recommendation:** Follow Phase 9's own `09-00-PLAN.md` structure exactly (it is the direct precedent for this exact kind of work: EN/ES key task → literal-swap task → gate-widening task), scaled to the 52 literals + 12 files found here, plus three small independent fixes (AI color token, FoundItemModal catch block + new i18n key, workOrders.searchPlaceholder key) that have no interdependency with the gate work and can be a separate wave/plan.

## Standard Stack

### Core (already in use — no new dependencies needed)
| Library | Version (installed) | Purpose | Why Standard (for this repo) |
|---------|---------|---------|--------------|
| eslint-plugin-i18next | 6.1.5 | `i18next/no-literal-string` rule — the existing floor-facing i18n gate | Already the project's chosen gate mechanism since Phase 7 (D-15/D-16); do not introduce an alternative linter |
| react-i18next | (existing, via `useTranslation()`) | `t()` calls, locale resolution | Already used app-wide; `i18n/locales/en.json` + `i18n/locales/es.json` are the only two locale files |
| eslint | 9.39.4 | Flat config (`eslint.config.mjs`) | Confirmed via `npx eslint --version` during research |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Widening existing `i18next/no-literal-string` gate | A stricter rule config (e.g. also gating `label`/other custom-component string props) | Out of scope — Phase 9's own D-12 rule explicitly kept `markupOnly: true` narrow and did NOT flip it; this phase's CONTEXT does not ask to expand what the rule checks, only which directories it runs against. Confirmed empirically: `ReportIssueModal.tsx`/`SupplyRequestModal.tsx` pass lint today despite hardcoded `label="Cancel"` props and raw `toast.error("...")` string arguments, because the rule only checks JSX text nodes + `aria-label`/`placeholder`/`title` attributes — not arbitrary prop names or JS string arguments. This is a real, load-bearing gap in gate coverage but is **not** part of this phase's scope (see Common Pitfalls). |
| `npm audit fix --force` (full remediation) | Patch-only `npm audit fix` | CONTEXT locks this decision: skip major bumps to Expo/RN/Jest/ESLint core unless genuinely exploitable at runtime. Verified via dry run: the safe fix resolves 6 HIGH + 1 LOW + 1 MODERATE; the remaining 1 CRITICAL + 4 HIGH + 14 MODERATE all require `expo@57.0.9` (a semver-major bump, `isSemVerMajor: true`), which is explicitly out of scope per CONTEXT. |

**Installation:** None — no new packages required for any of the 5 items except whatever `npm audit fix` (patch-level, non-force) naturally bumps in `package-lock.json`.

## Architecture Patterns

### Pattern 1: ESLint gate widening (mirrors Phase 9's `09-00-PLAN.md`)
**What:** Add new `files` globs to the existing gated ESLint config block in `eslint.config.mjs` (do not create a second rule block; do not touch `markupOnly: true`).
**When to use:** Exactly this situation — extending gate coverage to previously-exempt directories.
**Example (current state, confirmed by direct read of `apps/mobile/eslint.config.mjs:26-37`):**
```javascript
// Source: apps/mobile/eslint.config.mjs (as of this research)
{
  files: [
    'components/ui/**/*.{ts,tsx,js,jsx}',
    'app/(app)/my-rooms/**/*.{ts,tsx,js,jsx}',
    'app/(app)/room-board/**/*.{ts,tsx,js,jsx}',
    'app/(app)/room-status/**/*.{ts,tsx,js,jsx}',
    'app/(app)/work-orders/**/*.{ts,tsx,js,jsx}',
    'app/(app)/tasks/**/*.{ts,tsx,js,jsx}',
    'app/(app)/inspect/**/*.{ts,tsx,js,jsx}',
    'components/housekeeping/**/*.{ts,tsx,js,jsx}',
    'components/engineering/**/*.{ts,tsx,js,jsx}',
    'components/tasks/**/*.{ts,tsx,js,jsx}',
    // ADD: the 14 app/(app) directories + 2 components directories below
  ],
  ignores: ['**/*.test.*', '**/*.spec.*'],
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { i18next },
  rules: {
    'i18next/no-literal-string': ['error', {
      markupOnly: true,
      'jsx-attributes': { include: ['aria-label', 'placeholder', 'title'] },
    }],
  },
}
```
**Directories confirmed to add (verified against actual `app/(app)/` and `components/` listing):**
```
app/(app)/profile/**
app/(app)/home/**
app/(app)/assignments/**
app/(app)/scheduling/**
app/(app)/staff/**
app/(app)/assets/**
app/(app)/pm-schedules/**
app/(app)/guest-requests/**
app/(app)/lost-found/**
app/(app)/logbook/**
app/(app)/sop/**
app/(app)/copilot/**
app/(app)/alerts/**
app/(app)/notifications/**
components/supervisor/**
components/home/**
```

### Pattern 2: Interpolation + placeholder i18n idiom (from Phase 9's `09-00-PLAN.md`, directly reusable)
**What:** The exact idiom already established for wiring a raw literal through `t()`.
**Example (verified, this is literally cited as the source for the `workOrders.searchPlaceholder` key itself):**
```typescript
// Source: apps/mobile/app/(app)/work-orders/index.tsx:275 (current code, already using the key)
placeholder={t("workOrders.searchPlaceholder", { defaultValue: "Search work orders…" })}
```
The `defaultValue` means the app does not crash today — it silently falls back to the English literal for Spanish users, which is exactly the bug CONTEXT item 4 describes. Fix is additive only: add the key to both locale files; zero code changes needed in `work-orders/index.tsx` itself.

**Locale namespace conventions (verified against `apps/mobile/i18n/locales/en.json`):**
```jsonc
// en.json:470-483 (existing workOrders namespace — add searchPlaceholder here)
"workOrders": {
  "title": "Work orders",
  ...
  "locationPlaceholder": "Room number or area (e.g. 204, Lobby HVAC)",
  // ADD: "searchPlaceholder": "Search work orders…"
  ...
}
```
```jsonc
// es.json:470-483 (matching namespace)
"workOrders": {
  "title": "Órdenes de trabajo",
  ...
  // ADD: "searchPlaceholder": "Buscar órdenes de trabajo…"
  ...
}
```

### Pattern 3: `theme.ai.*` semantic token usage (verified — universal existing convention)
**What:** Every other "sparkles" AI icon in the codebase already sources its color from `theme.ai.primary` (from `useTheme()`), never a raw hex value.
**Verified call sites (14 total, all consistent):** `components/tasks/TaskCard.tsx:100`, `components/shared/mobileHandoff.tsx:276`, `components/shared/evening.tsx:387`, `app/(app)/assignments/index.tsx:307,474`, `app/(app)/logbook/index.tsx:135`, `app/(app)/my-rooms/[roomId].tsx:679`, `app/(app)/tasks/index.tsx:247`, `app/(app)/copilot/index.tsx:269` (uses `darkTheme.ai.primary` directly — an intentional dark-lock exception per Phase 9's D-11, not a pattern to copy elsewhere).
**The only outlier:** `app/(app)/home/index.tsx:212` — `<Ionicons name="sparkles" size={12} color="#CBB8F0" />`.
**Fix (verified against `components/shared/tokens.ts:54-70`, `theme.ai` = `aiTokens`/`darkAiTokens`):**
```typescript
// Before (home/index.tsx:212)
<Ionicons name="sparkles" size={12} color="#CBB8F0" />

// After — mirrors every other sparkles usage in the codebase, including the
// same-file's own theme.shell.* usage two lines above (this icon already sits
// inside a themed TouchableOpacity using theme.shell.line/theme.shell.surface)
<Ionicons name="sparkles" size={12} color={theme.ai.primary} />
```
`theme` is already in scope in this file (used throughout the component via `useTheme()`), so this is a same-line swap, no new import needed. `theme.ai.primary` = `#7C3AED` (light) / `#A78BFA` (dark) — both close in hue/lightness to the current `#CBB8F0`, so the visual change will be subtle, not jarring.

### Pattern 4: Toast-on-catch error handling (verified — `SupplyRequestModal.tsx` is the exact sibling pattern)
**What:** `FoundItemModal.tsx` already imports and uses `useToast()` (for camera-permission and offline-error cases) but its submission catch block is empty. `SupplyRequestModal.tsx` — same `components/housekeeping/` family, same room-detail-sheet parent — is the closest sibling and already does this correctly.
**Example (verified, `components/housekeeping/SupplyRequestModal.tsx:56-73`):**
```typescript
// Source: apps/mobile/components/housekeeping/SupplyRequestModal.tsx (current, working code)
try {
  await api.post("/tasks", { ... });
  toast.success("Your supervisor has been notified.");
  reset();
  onClose();
} catch (err: unknown) {
  toast.error((err as Error).message ?? "Failed to send request");
} finally {
  setLoading(false);
}
```
**Current buggy code (verified, `components/housekeeping/FoundItemModal.tsx:107-127`):**
```typescript
try {
  // upload photo, createLostFoundItem(...)
  resetForm();
  onClose();
} catch {
  // keep modal open on error
} finally {
  setSubmitting(false);
}
```
**Recommended fix — use a translated key, not a raw string (matches this file's own established `foundItem.offlineError` i18n convention, and the app-wide `<namespace>.submitError` idiom found in `inspect.submitError` = `"Could not submit inspection. Try again."` and `logbook`-family `submitError` = `"Could not submit summary. Try again."`):**
```typescript
} catch {
  toast.error(t("foundItem.submitError"));
} finally {
  setSubmitting(false);
}
```
Add to both locale files, `foundItem` namespace (`en.json:760-772`, `es.json` mirror):
```jsonc
"foundItem": {
  ...
  "offlineError": "Connect to the internet to report a found item.",
  // ADD:
  "submitError": "Could not submit found item. Try again."
  ...
}
```
```jsonc
// es.json
"submitError": "No se pudo reportar el objeto. Intenta de nuevo."
```
`toast` and `t` are both already imported and in scope in `FoundItemModal.tsx` (lines 35, 38) — no new imports needed.

**Test gap found (relevant to CLAUDE.md's Test Maintenance Policy):** No test file exists for `FoundItemModal.tsx` today. It is only referenced once in the whole test suite, as a full mock-out: `__tests__/screens/RoomDetail.test.tsx:57` — `jest.mock("@/components/housekeeping/FoundItemModal", () => () => null);`. This means the current empty-catch bug has zero test coverage, and a fix with no accompanying test would also go uncovered. `__tests__/screens/LostFoundScreen.test.tsx` is the closest existing pattern for testing a "toast on submission failure" flow (it mocks `useToast` as `() => ({ error: mockToastError })` and asserts `expect(mockToastError).toHaveBeenCalledWith(...)`), and is a reasonable template for a new `__tests__/components/FoundItemModal.test.tsx`.

### Anti-Patterns to Avoid
- **Widening `markupOnly` or the `jsx-attributes` include list as part of this phase:** Not requested by CONTEXT, and doing so would surface a much larger, unbounded set of violations (raw `label=` props, raw `toast.error("...")` string arguments) across the *already-gated* directories too, well beyond this phase's sizing. Keep the rule config exactly as-is; only add `files` globs.
- **Using `(err as Error).message` verbatim in a user-facing toast for FoundItemModal:** Unlike `SupplyRequestModal.tsx`'s raw-string fallback (`"Failed to send request"`, not translated), the established `submitError`-key idiom used elsewhere in this exact file (`foundItem.offlineError`) and elsewhere in the app (`inspect.submitError`, logbook-family `submitError`) is a static, translated, generic message — not the raw error message, which may not be translated and may leak internal detail (e.g. Supabase/API error text) to the floor-facing UI.
- **Treating the audit's "58 advisories (42 high, 1 critical)" figure as current:** It is stale relative to the live `npm audit` output as of this research (27 total: 1 critical, 10 high, 15 moderate, 1 low). Re-run `npm audit` at execution time and use the fresh numbers, not the report's numbers, for any completion claim.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting which literals will newly fail once the gate widens | A custom script that scans JSX for string literals | `npx eslint --config <widened-config> <globs>` (exactly what this research did) | ESLint + `eslint-plugin-i18next` already correctly parses JSX/TSX and applies the project's exact rule semantics (markupOnly + attribute include-list); a hand-rolled regex scanner would both over- and under-count relative to what `npm run lint` will actually enforce |
| Toast/error-surfacing pattern for FoundItemModal | A new alert/banner/inline-error component | `useToast()` (already imported in the file) + the `SupplyRequestModal.tsx` catch-block idiom | The project has one established toast system (`lib/theme/useToast.ts` → `ToastProvider`) used everywhere else in this exact modal family; inventing a second error-surfacing mechanism for one file would be an inconsistency, not a fix |
| Deciding safe vs. risky npm audit fixes | Manually judging each of the 27 advisories from scratch | `npm audit fix --dry-run` (already distinguishes `fix: YES(compatible)` from `fix: {..., isSemVerMajor: true}` per package) | npm's own dependency resolver already computes exactly which fixes are semver-compatible vs. major; re-deriving this by hand risks missing a transitive constraint |

**Key insight:** Every one of the 5 items in this phase has a working, already-adopted sibling pattern elsewhere in the same codebase (SupplyRequestModal for toasts, work-orders/CreateWorkOrderModal for i18n key conventions, 8+ other screens for `theme.ai.primary`, Phase 9's `09-00-PLAN.md` for gate-widening structure, npm's own audit tooling for fix classification). This phase is pure "make it consistent with what's already there," not new-pattern design.

## Common Pitfalls

### Pitfall 1: Assuming the ESLint gate catches everything once widened
**What goes wrong:** Someone widens the gate to all 14+2 directories and declares the whole "raw literal" problem solved, without realizing the rule only flags JSX text nodes plus `aria-label`/`placeholder`/`title` attributes.
**Why it happens:** `markupOnly: true` + a narrow `jsx-attributes.include` list. Verified empirically: `ReportIssueModal.tsx` has raw literals in `label="Cancel"` (a custom `<Button>` prop, not `aria-label`) and in the CATEGORIES/PRIORITIES const arrays — and it passes `npm run lint` today, in a directory (`components/housekeeping/**`) that has been gated since Phase 7.
**How to avoid:** Do not conflate "gate widened to directory X" with "directory X is fully translated." The phase's job (per CONTEXT) is coverage of directories, using the rule's existing (narrow) semantics — not expanding what the rule checks.
**Warning signs:** If the plan describes "wire every remaining raw string in these 14 directories," that is scope creep beyond the rule's own detection surface; scope it to what `npx eslint` actually flags (52 violations, enumerated above) plus the 4 named fixes.

### Pitfall 2: Trusting the milestone audit's npm audit numbers as current
**What goes wrong:** Planning remediation against "58 advisories, 42 high, 1 critical" when the live count (same day, unchanged lockfile) is 27 (1 critical, 10 high, 15 moderate, 1 low).
**Why it happens:** `npm audit` resolves advisories against a live, externally-updated database (GitHub Advisory Database via the npm registry); the count can change between two runs on the same unchanged `package-lock.json`, with no local action taken.
**How to avoid:** Re-run `npm audit --audit-level=high --json` at plan-execution time as the source of truth; do not hardcode the audit report's numbers into acceptance criteria.
**Warning signs:** An acceptance criterion like "reduce from 58 to N" will be unverifiable/wrong on a fresh run.

### Pitfall 3: `npm audit fix` (non-force) still bumps `expo` itself — verify this is a patch, not a surprise major
**What goes wrong:** Assuming "no --force" means "expo version is untouched." It is not fully untouched — the dry run shows `change expo 54.0.35 => 54.0.36` (a patch release) plus `babel-preset-expo 54.0.11 => 54.0.12` and `expo-updates 29.0.18 => 29.0.19`, alongside `brace-expansion`, `js-yaml`, `@babel/core`, `undici`, `form-data`, `fast-uri`, `shell-quote`, `semver`, `postcss` (build-tool copy, not the direct `expo` dependency's postcss), and several `lightningcss` platform binaries.
**Why it happens:** Patch-level releases of `expo` itself sometimes bundle patched transitive deps; "no `--force`" only blocks npm from choosing a semver-*major* resolution, not from bumping the direct `expo` patch version if that's what npm's resolver picks to satisfy a transitive fix.
**How to avoid:** Since the constraint says "any dependency change must still pass a green EAS build before merging," treat the safe `npm audit fix` (even though `--force` isn't used) as requiring the EAS build gate — it does touch `expo`/`babel-preset-expo`/`expo-updates`, which are exactly the fragile surfaces CLAUDE.md calls out.
**Warning signs:** Skipping an EAS build check because "we didn't use `--force`" — the safe fix still changes `expo`, `babel-preset-expo`, and `expo-updates`.

### Pitfall 4: The critical `tar` advisory and 4 of the 10 high advisories cannot be resolved without the major `expo@57.0.9` bump
**What goes wrong:** Expecting `npm audit fix` (safe) to clear the 1 critical + all 10 high advisories.
**Why it happens:** Verified via dry run — `tar` (critical), `@expo/cli` (high), `@expo/metro-config` (high), `expo` itself (high, direct), and `postcss` (high, the one bundled inside `@expo/metro-config`, a different node than the top-level `postcss` override) are all only resolvable via `expo@57.0.9`, flagged `isSemVerMajor: true`. All 14 moderate advisories (the entire `@expo/*`/`expo-*` family: `@expo/config`, `@expo/config-plugins`, `@expo/prebuild-config`, `expo-asset`, `expo-constants`, `expo-dev-client`, `expo-linking`, `expo-manifests`, `expo-notifications`, `expo-splash-screen`, `expo-updates`, `jest-expo`, `uuid`, `xcode`) are in the same boat.
**How to avoid:** Per CONTEXT's own guidance, evaluate whether `tar`'s vulnerabilities (arbitrary file write via hardlink/symlink during archive extraction) are runtime-exposed in the shipped mobile app. They are not: `tar` is only pulled in by `@expo/cli`/`@expo/metro-config`, which run during `expo start`/`expo prebuild`/build-time template extraction on a developer machine or in EAS's build environment — never inside the React Native JS bundle shipped to end users. Document this reasoning explicitly rather than silently skipping it (per CONTEXT's "document any advisory deliberately left open with reasoning" instruction).
**Warning signs:** A plan that either (a) silently drops these 1 critical + 4 high + 14 moderate advisories with no documentation, or (b) attempts the major `expo@57.0.9` bump "to be thorough," contradicting the explicit constraint.

### Pitfall 5: There is no mobile CI job today — the ESLint gate is enforced only when someone runs `npm run lint` locally
**What goes wrong:** Assuming widening the gate adds automatic, ongoing protection against regressions the way it would if CI ran it on every PR.
**Why it happens:** Verified — `.github/workflows/ci.yml` has jobs for `lint-api`, `lint-web`, `build-web`, `test-web-public-smoke`, `test-api`, but zero jobs reference `apps/mobile` at all. `grep -rn "mobile" .github/workflows/*.yml` returns nothing.
**How to avoid:** This is a pre-existing condition, not something Phase 11's CONTEXT asks to fix (no CI-wiring item in the 5 locked decisions). Flag it as a known limitation rather than silently assuming the widened gate is "CI-enforced" in any verification claim — it's enforced only by whoever runs `npm run lint` (this phase's own verification, or a future manual check).
**Warning signs:** A plan or verification claiming "CI now blocks regressions in these directories" — it does not; only local/manual `npm run lint` does.

## Code Examples

### Exact enumerated list of the 52 raw-literal violations surfaced by widening the gate
Verified by copying `eslint.config.mjs` into a temp config with the 16 new `files` globs added (nothing else changed) and running `npx eslint` against exactly those paths:

```
app/(app)/assignments/index.tsx           — 1 violation  (line 379, "★ VIP")
app/(app)/guest-requests/[requestId].tsx  — 7 violations (lines 135,151,163,186,200,227,258)
app/(app)/guest-requests/index.tsx        — 4 violations (lines 149,152,212,251)
app/(app)/lost-found/index.tsx            — 11 violations (lines 131×2,132,182,201,207,217,221,247,249,258)
app/(app)/notifications/index.tsx         — 2 violations (lines 91,93)
app/(app)/profile/index.tsx               — 1 violation  (line 408)
app/(app)/scheduling/index.tsx            — 6 violations (lines 74,88,99,104,105,111)
app/(app)/sop/[sopId].tsx                 — 7 violations (lines 55,69,70,76,86,92,98)
app/(app)/sop/index.tsx                   — 6 violations (lines 62,63,73,83,91,99)
components/supervisor/BroadcastModal.tsx  — 2 violations (lines 57,59)
components/supervisor/ShiftNoteModal.tsx  — 2 violations (lines 47,49)
components/supervisor/atoms.tsx           — 3 violations (lines 155,159,171)

TOTAL: 52 violations across 12 files

Zero violations (safe to gate with no literal-fixing work):
  app/(app)/home/**, app/(app)/staff/**, app/(app)/assets/**,
  app/(app)/pm-schedules/**, app/(app)/logbook/**, app/(app)/copilot/**,
  app/(app)/alerts/**, components/home/**
```

### `npm audit fix --dry-run` — exact safe-fix package list (verified, no `--force`)
```
change brace-expansion  1.1.14/1.1.16/2.1.1/5.0.6 => 1.1.18/2.1.4/5.0.9 (multiple nested copies)
change js-yaml          3.14.2 => 3.15.1
change undici           6.26.0 => 6.28.0
change shell-quote      1.8.4  => 1.10.0
change form-data        4.0.5  => 4.0.6
change fast-uri         3.1.2  => 3.1.5
change @babel/core      7.29.0 => 7.29.7
change postcss          8.5.15 => 8.5.25   (the @expo/metro-config-bundled copy, not the top-level override)
change semver           7.8.1  => 7.8.5
change expo             54.0.35 => 54.0.36   (PATCH — verify with a green EAS build per CLAUDE.md)
change expo-updates     29.0.18 => 29.0.19
change babel-preset-expo 54.0.11 => 54.0.12
change nanoid, hasown, regjsparser, lightningcss, @expo/schema-utils,
       @expo/package-manager, @expo/osascript, @expo/metro-config (own version),
       @expo/env, @expo/config-plugins, @expo/config, @expo/cli, @0no-co/graphql.web
       — all patch/minor bumps within the same major line

added 13 packages, removed 2 packages, changed 45 packages
Result after safe fix: resolves 6 HIGH + 1 LOW + 1 MODERATE (expo-dev-launcher)
Remaining after safe fix: 1 CRITICAL (tar) + 4 HIGH (@expo/cli, @expo/metro-config, expo, postcss)
                          + 14 MODERATE (all require expo@57.0.9, isSemVerMajor: true)
```

### FoundItemModal.tsx fix (exact diff shape)
```typescript
// apps/mobile/components/housekeeping/FoundItemModal.tsx — current (buggy)
  async function handleSubmit() {
    if (!description.trim()) return;
    if (!isOnline) {
      toast.error(t("foundItem.offlineError"));
      return;
    }

    setSubmitting(true);
    try {
      let photoUrl: string | undefined;
      if (photoUri) {
        const url = await uploadPhoto(photoUri);
        if (url) photoUrl = url;
      }

      await createLostFoundItem({ ... });

      resetForm();
      onClose();
    } catch {
      // keep modal open on error
    } finally {
      setSubmitting(false);
    }
  }
```
```typescript
// Fixed — mirrors SupplyRequestModal.tsx's toast.error(...) idiom,
// using the file's own established translated-key convention (foundItem.offlineError)
    } catch {
      toast.error(t("foundItem.submitError"));
    } finally {
      setSubmitting(false);
    }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Directory-by-directory ESLint gate rollout (Phase 7 → floor screens only, Phase 9 → 4 named backlog files) | This phase: widen to all remaining 14+2 directories in one pass (per CONTEXT's own stated preference, matching how 09-00 handled its own backlog) | This phase (11) | Full app-wide i18n-gate coverage reached in one pass instead of continued piecemeal rollout |

**Deprecated/outdated:**
- The milestone audit's npm audit figures (58 advisories, 42 high, 1 critical) — superseded by the live count (27 total: 1 critical, 10 high, 15 moderate, 1 low) as of this research. Use live numbers for any plan or verification claim.

## Open Questions

1. **Should the safe `npm audit fix` (which touches `expo`, `babel-preset-expo`, `expo-updates` at patch level) require a full EAS cloud build before merging, or is a local `expo prebuild`/type-check sufficient?**
   - What we know: CLAUDE.md states "zero new npm dependencies planned by design; any exception requires a green EAS build before merging," and CONTEXT reiterates "any dependency change must still pass a green EAS build before merging, per the existing project rule — do not skip this gate." `npm audit fix` (safe) is not a *new* dependency, but it does change `expo`'s resolved version.
   - What's unclear: Whether the planner should budget for an actual EAS cloud build invocation (requires an authenticated EAS account/session) as part of this phase's verification, or whether a local `npx expo-doctor` / `npm run type-check` / `npx tsc --noEmit` + successful `npx expo export` is an acceptable stand-in given "no live API credentials in the local environment" is a stated project constraint (though EAS itself is a separate credential from the AI/Stripe ones CLAUDE.md flags as absent).
   - Recommendation: Plan for a local `type-check` + `expo export` (or `expo prebuild --no-install --platform android`) dry-run as the minimum gate; escalate to a real EAS build only if the executor has EAS CLI authentication available (check `eas whoami` before assuming a cloud build is possible in this environment).

2. **Exact final wording for the 12 files' 52 new i18n keys (guest-requests, lost-found, scheduling, sop, supervisor components, assignments' "VIP" chip, notifications' "Alerts"/"unread") has not been drafted in this research.**
   - What we know: The exact violating strings and line numbers (enumerated above), and the established namespace/interpolation idioms (`{{room}}`, `{{count}}` etc. — e.g. `guest-requests/index.tsx:212` `Room {req.room_number}` should become `t("guestRequests.roomLabel", { room: req.room_number })` following the identical `tasks.roomLabel`/`reportIssue.roomLabel` precedent from 09-00).
   - What's unclear: Whether existing namespaces already exist for `guestRequests`, `lostFound`, `scheduling`, `sop`, `supervisor` in the locale files (needs a grep-first pass per file, exactly as 09-00's Task 1 `read_first` instructed) or whether new namespaces need to be created.
   - Recommendation: The planner should mirror 09-00's Task 1 pattern exactly: grep each locale file's existing namespace for that screen before adding new keys, dedupe repeated strings (e.g. `"Category"`/`"Priority"` already deduped once in 09-00), and use the parity-check node script from 09-00's Task 1 `<verify>` block as the acceptance gate.

3. **Should a new `__tests__/components/FoundItemModal.test.tsx` be added as part of this phase, given CLAUDE.md's Test Maintenance Policy ("write new tests covering the added behavior")?**
   - What we know: No test currently exists for this file (only a full mock-out in `RoomDetail.test.tsx`); `LostFoundScreen.test.tsx` is a usable template (mocks `useToast`, asserts `toHaveBeenCalledWith` on a translated string).
   - What's unclear: Not explicitly requested by CONTEXT, but CLAUDE.md's global Test Maintenance Policy applies "after every new implementation."
   - Recommendation: Include a small, scoped test (render modal, force `createLostFoundItem` mock rejection, assert `toast.error` called with `"foundItem.submitError"`) as part of the FoundItemModal task — low cost, closes a real coverage gap, consistent with project-wide policy.

## Sources

### Primary (HIGH confidence — direct execution against this repo)
- `npx eslint --config <widened-config-with-14+2-new-globs> <same-globs>` run against the live `apps/mobile` source — produced the exact 52-violation, 12-file list above.
- `npm audit --audit-level=high --json` run against the live `apps/mobile/package-lock.json` — produced the exact 27-advisory breakdown (metadata + per-package `via`/`fixAvailable`/`range` data).
- `npm audit fix --dry-run` run against the same lockfile — produced the exact safe-fix package list and confirmed which advisories remain unresolved without `--force`.
- `git log --oneline -- apps/mobile/package-lock.json apps/mobile/package.json` + `git status` — confirmed the lockfile is unchanged since the ESLint-gate commit (`bf442093`), ruling out a lockfile-drift explanation for the audit-report vs. live-audit discrepancy.
- Direct reads: `apps/mobile/eslint.config.mjs`, `apps/mobile/components/shared/tokens.ts`, `apps/mobile/lib/theme/useTheme.ts`, `apps/mobile/lib/theme/useToast.ts`, `apps/mobile/components/housekeeping/{FoundItemModal,ReportIssueModal,SupplyRequestModal}.tsx`, `apps/mobile/app/(app)/home/index.tsx`, `apps/mobile/app/(app)/work-orders/index.tsx`, `apps/mobile/i18n/locales/{en,es}.json`, `apps/mobile/babel.config.js`, `apps/mobile/eas.json`, `apps/mobile/package.json`, `.github/workflows/ci.yml`.
- `Grep` across the full `apps/mobile` tree for `sparkles`, `theme.ai.`, `useToast`, `submitError`/`offlineError` — established the universal `theme.ai.primary` convention and the `<namespace>.submitError` i18n idiom.
- `.planning/phases/09-remaining-screens-rollout/09-00-PLAN.md` — the direct precedent plan for this exact class of work (EN/ES key task → literal-swap task → gate-widening task structure), including its own verified `<verify>`/acceptance-criteria idioms (parity node-script, PowerShell `Select-String` assertions).
- `.planning/v1.1-MILESTONE-AUDIT.md`, `.planning/phases/{07,08,09,10}-*/*-VERIFICATION.md` — prior phase evidence and the 5 tech-debt items' original file:line citations (cross-checked against live code; all confirmed accurate except the npm audit count, which has since changed).

### Secondary (MEDIUM confidence)
- None used — all findings for this phase were verifiable directly against the live repository; no external/community sources were needed.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; installed versions confirmed directly (`eslint-plugin-i18next@6.1.5`, `eslint@9.39.4`, `expo@~54.0.0` per package.json, `54.0.35` installed).
- Architecture (i18n gate widening, theme token, toast pattern, locale key): HIGH — every pattern was found as an existing, working example elsewhere in this exact codebase, not inferred from documentation.
- Pitfalls: HIGH — each pitfall was independently reproduced/verified (ran the widened lint gate, ran the audit dry-run, grepped CI workflows, grepped existing lint-passing files with uncaught literals).
- npm audit remediation depth: HIGH, with one open question flagged (EAS build gate mechanics) since this research environment could not confirm EAS CLI authentication status.

**Research date:** 2026-08-01
**Valid until:** ~7 days for the npm audit section specifically (advisory database changes independent of any code change, as directly observed during this research); ~30 days for the ESLint/theme/i18n/toast sections (stable, code-verified facts about this repo).
