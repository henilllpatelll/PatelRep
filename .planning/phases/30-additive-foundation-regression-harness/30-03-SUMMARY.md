---
phase: 30-additive-foundation-regression-harness
plan: 03
subsystem: testing
tags: [i18n, typescript-compiler-api, regression-harness, ci-tooling]

# Dependency graph
requires: []
provides:
  - "apps/web/scripts/check-i18n-parity.mjs: static EN/ES i18n key-parity checker (TypeScript compiler API, zero new deps)"
  - "apps/web/package.json check:i18n-parity npm script"
affects: [30-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static AST parsing of locale object literals via the existing `typescript` devDep (createSourceFile), never executing the module -- avoids needing tsx or app runtime"

key-files:
  created:
    - apps/web/scripts/check-i18n-parity.mjs
  modified:
    - apps/web/package.json

key-decisions:
  - "Locale root object is found by matching a top-level `const x = {...}` variable statement to a matching `export default x` assignment, rather than assuming a fixed variable name, so the script stays correct if en.ts/es.ts's local identifier ever changes"

patterns-established:
  - "Regression-harness gate scripts live in apps/web/scripts/*.mjs and are wired as npm scripts (check:*, verify:*) for later CI wiring in plan 30-06, mirroring verify-i18n-gate.mjs and check-programs-i18n.mjs"

# Metrics
duration: 15min
completed: 2026-08-14
---

# Phase 30 Plan 03: EN/ES i18n Key-Parity Gate Summary

**Static TypeScript-compiler-API script that flattens en.ts/es.ts into dot-path key sets and fails the build on any one-sided key drift, wired as `npm run check:i18n-parity`**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-14T08:00:33Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `apps/web/scripts/check-i18n-parity.mjs` parses `i18n/locales/en.ts` and `es.ts` with `ts.createSourceFile` (no module execution), recursively flattens the exported object literal into dot-path key sets (handling `PropertyAssignment`, `ShorthandPropertyAssignment`, and string/template-literal keys), and diffs the two sets
- Confirmed 1419 keys currently in parity across both locales; confirmed the script fails naming the exact offending key (`common.commandHint`) when a key is removed from one locale, then confirmed a clean revert restores a passing run
- Wired `check:i18n-parity` into `apps/web/package.json` alongside the existing `verify:i18n-gate` / `check:floor-copy` scripts, ready for CI wiring in plan 30-06

## Task Commits

Each task was committed atomically:

1. **Task 1: check-i18n-parity.mjs (TypeScript compiler API, static parse)** - `6798e511` (feat)
2. **Task 2: Wire npm script** - `92f41a09` (chore)

## Files Created/Modified
- `apps/web/scripts/check-i18n-parity.mjs` - Static EN/ES key-parity checker; exits 1 listing every missing key + direction, exits 0 when in parity
- `apps/web/package.json` - Added `"check:i18n-parity": "node scripts/check-i18n-parity.mjs"`

## Decisions Made
- Matched the exported root object literal by pairing a top-level `const <name> = {...}` with a same-name `export default <name>` statement, rather than hardcoding `en`/`es` as the identifier, so the parser stays correct if the locale files' internal variable name changes.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Verification (temporarily deleting `common.commandHint` from `es.ts` via `sed`, confirming the script named it and exited 1, then restoring via `git checkout --`) was done directly against the git-tracked file rather than a manual backup/restore, since an initial ad hoc backup-file attempt silently failed on this Windows/Git Bash environment (path resolution issue, not a script bug) — `git diff`/`git checkout --` confirmed the working tree was restored byte-for-byte before re-verifying the pass case.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FOUND-05 satisfied: `check:i18n-parity` exists, passes on the current tree, and is distinct from/stronger than `i18next/no-literal-string`
- Ready for plan 30-06 to wire `npm run check:i18n-parity` into CI alongside the other regression-harness gates

---
*Phase: 30-additive-foundation-regression-harness*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: apps/web/scripts/check-i18n-parity.mjs
- FOUND: .planning/phases/30-additive-foundation-regression-harness/30-03-SUMMARY.md
- FOUND: commit 6798e511 (Task 1)
- FOUND: commit 92f41a09 (Task 2)
- FOUND: check:i18n-parity wired in apps/web/package.json
