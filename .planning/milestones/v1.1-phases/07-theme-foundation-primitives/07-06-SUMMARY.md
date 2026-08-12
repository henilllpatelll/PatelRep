---
phase: 07-theme-foundation-primitives
plan: 06
subsystem: mobile-tooling
tags: [eslint, i18n, ci-gate, mobile, tooling]
requires:
  - "components/ui/** primitives (07-03..07-05)"
provides:
  - "mobile `npm run lint` with i18next/no-literal-string hard-fail gate"
  - "eslint.config.mjs flat config scoped to floor dirs + components/ui"
affects:
  - "CI for apps/mobile (new lint step available)"
  - "Phase 9 (must remove the 4 deferred-file exemptions as it migrates them)"
tech-stack:
  added:
    - "eslint@9.39.4 (devDependency)"
    - "eslint-plugin-i18next@^6.1.5 (devDependency)"
    - "@typescript-eslint/parser@^8.60.1 (devDependency — required to parse .tsx)"
  patterns:
    - "flat ESLint config mirroring apps/web/eslint.config.mjs i18next block"
key-files:
  created:
    - "apps/mobile/eslint.config.mjs"
  modified:
    - "apps/mobile/package.json"
decisions:
  - "Narrow gate to currently-clean scope; defer 4 un-i18n'd floor files to Phase 9 (team-lead 2026-07-29)"
metrics:
  duration: "~40m"
  completed: "2026-07-29"
  tasks: 2
  files: 2
---

# Phase 7 Plan 6: Mobile i18n Lint Gate Summary

Mobile now has its first ESLint config and a `npm run lint` script enforcing
`i18next/no-literal-string` as a hard CI failure on `components/ui/**` plus the
floor-facing screens/components, mirroring web's gate (D-15/D-16). The four new
primitives pass cleanly; a planted raw JSX literal is confirmed to fail the gate.

## What Was Built

- **`apps/mobile/package.json`**: added `"lint": "eslint ."` script and three
  devDependencies pinned to the exact versions already vetted in `apps/web`:
  `eslint@9.39.4`, `eslint-plugin-i18next@^6.1.5`, plus `@typescript-eslint/parser@^8.60.1`
  (needed so ESLint can parse mobile's `.tsx` — see Deviations). No runtime
  dependency added; nothing under `dependencies`. No `babel.config.js`/`metro.config.js`
  change (Pitfall 3 / T-07-11 respected).
- **`apps/mobile/eslint.config.mjs`** (new flat config): a top-level `ignores`
  block for build/junk, and a single gated block with `i18next/no-literal-string`
  at `'error'` severity (`markupOnly: true`, jsx-attributes include
  `aria-label`/`placeholder`/`title`) — byte-for-byte the same rule options as web.
  Scope = `components/ui/**` + the six floor `app/(app)/{my-rooms,room-board,
  room-status,work-orders,tasks,inspect}/**` dirs + the three floor
  `components/{housekeeping,engineering,tasks}/**` dirs. No non-floor screen is gated
  (deferred to Phase 9 per D-15).

## Verification

- `npm run lint` from `apps/mobile` exits **0** on the current (narrowed) tree.
- Negative test A — planted `<Text>Planted literal for gate test</Text>` in
  `components/ui/Button.tsx` → **exit 1**, `i18next/no-literal-string` error at 96:13.
  Reverted; tree clean.
- Negative test B (proves the narrowing is file-specific, not dir-wide) — planted a
  literal in `components/housekeeping/KnockModal.tsx` (a non-deferred sibling in a
  gated dir) → **exit 1**, one error. Reverted; tree clean.
- `npx tsc --noEmit` from `apps/mobile` → **exit 0**, no new errors.
- No `eslint-disable` added to any `components/ui/*` file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `@typescript-eslint/parser` devDependency**
- **Found during:** Task 1 / Task 2.
- **Issue:** Mobile had no ESLint config and no TypeScript parser. The primitives
  and floor screens are `.tsx` with TypeScript syntax (interfaces, type annotations,
  generics) that ESLint's default `espree` parser cannot parse. Web gets its parser
  transitively via `eslint-config-next`; mobile has no such base config.
- **Fix:** Added `@typescript-eslint/parser@^8.60.1` (the exact version already
  present in `apps/web/node_modules`) as a devDependency and wired it via
  `languageOptions.parser` in the gated block. devDependency only — no runtime impact.
- **Files modified:** `apps/mobile/package.json`, `apps/mobile/eslint.config.mjs`
- **Commit:** bf442093 (parser dep) / 4cdc6c19 (parser wiring finalized)

**2. [Rule 1 - Bug] Fixed `files` globs that silently matched zero `.tsx` files**
- **Found during:** Task 2 negative test.
- **Issue:** The first config used bare directory globs (`components/ui/**`). ESLint 9
  flat config only opts a file extension into linting when a `files` pattern names
  that extension; a bare `dir/**` glob left `.tsx` files reported as "File ignored
  because no matching configuration was supplied", so the gate matched nothing and
  a planted literal passed. This is exactly why web's globs work (its base
  `eslint-config-next` registers `.tsx` as lintable) but a copied bare glob does not
  on mobile.
- **Fix:** Changed every `files` entry to `<dir>/**/*.{ts,tsx,js,jsx}`. The gate then
  correctly parsed and flagged the planted literal (and surfaced pre-existing issues —
  see below). The `components/ui/**` substring the acceptance criteria grep for is
  still present in each pattern.
- **Files modified:** `apps/mobile/eslint.config.mjs`
- **Commit:** 4cdc6c19

### Scope decision (escalated to team-lead, ratified 2026-07-29)

**3. [Rule 4 - Scope] Narrowed the gate; deferred 4 un-i18n'd floor files to Phase 9**
- **Found during:** Task 2, first working lint run.
- **Issue:** With the gate actually parsing `.tsx`, it surfaced **22 pre-existing
  raw-literal errors in 4 floor files that D-15's scope list happens to cover**, but
  that the plan wrongly assumed were already translated:
  - `components/engineering/CreateWorkOrderModal.tsx` (7)
  - `components/housekeeping/ReportIssueModal.tsx` (9)
  - `components/housekeeping/SupplyRequestModal.tsx` (5)
  - `app/(app)/tasks/index.tsx` (1)
  These files have **no `useTranslation` at all** — hardcoded English throughout,
  including `Alert` copy, placeholders, and safety-critical labels ("Emergency",
  "Safety"). All five new `components/ui/` primitives pass cleanly.
- **Decision (team-lead, 2026-07-29):** Narrow the gate to the currently-clean scope
  and defer the 4 files to Phase 9. Rationale:
  1. Phase 7's own explicit boundary (07-CONTEXT `<domain>`) is **"zero visible change
     to any existing screen."** Wiring these 4 screens to `t()` and shipping
     unreviewed Spanish for safety-critical copy is real, risky screen-migration work
     with no benefit to this foundation phase.
  2. This is the **same situation web hit** with its 04-08 gate (narrow-then-widen
     across 04-09..04-16 as siblings were translated) — same codebase, same precedent.
  3. **Phase 9 already owns** migrating the remaining screens onto i18n/primitives
     (ROADMAP SCREENS-01..10) — deferring there is routing, not scope-dropping.
- **Fix:** Added the 4 exact file paths to the gated block's `ignores` array with an
  inline comment citing this decision. The exemption is **file-specific** — every
  other file in those same dirs (e.g. `KnockModal.tsx`, `FoundItemModal.tsx`) remains
  gated, verified by negative test B.
- **Files modified:** `apps/mobile/eslint.config.mjs`; `.planning/ROADMAP.md` (Backlog
  deferral note).
- **Commit:** 4cdc6c19

## Known Stubs

None. The config is fully wired and the gate is live.

## Threat Flags

None. Config-only change; devDependencies pinned to already-vetted versions; no
babel/metro/runtime edit. T-07-11 (EAS/Hermes build) and T-07-12 (rule-severity
tampering) both mitigated as planned — severity is `'error'`, no `eslint-disable`
was added, and the negative tests prove the gate bites.

## Deferred to Phase 9

The 4 floor files above must be migrated onto `useTranslation`/`t()` (with proper
EN+ES keys) and their exemptions removed from `eslint.config.mjs` as Phase 9 rolls
out the remaining screens. Recorded in ROADMAP.md Backlog.

## Self-Check: PASSED
- `apps/mobile/eslint.config.mjs` — FOUND
- `apps/mobile/package.json` lint script + devDeps — FOUND
- Commit bf442093 — FOUND
- Commit 4cdc6c19 — FOUND
