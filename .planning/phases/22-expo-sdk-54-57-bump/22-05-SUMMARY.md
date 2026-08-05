---
phase: 22-expo-sdk-54-57-bump
plan: 05
subsystem: mobile-security
tags: [npm-audit, expo, uuid, overrides, dependency-security]

# Dependency graph
requires:
  - phase: 22-expo-sdk-54-57-bump
    provides: "Exact Expo 57.0.9 graph and green Android artifact from Plan 04"
provides:
  - "Zero-vulnerability mobile npm audit"
  - "Scoped xcode-to-uuid 11.1.1 security override with compatibility evidence"
  - "Per-advisory MOBILE-04 resolution record with zero accepted residual risks"
affects: [MOBILE-04, phase-22-verification, mobile-builds]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scope transitive security overrides to the narrow owning edge and verify that consumer's actual API usage"

key-files:
  created:
    - .planning/phases/22-expo-sdk-54-57-bump/22-AUDIT-ACCEPTED-RISK.md
  modified:
    - apps/mobile/package.json
    - apps/mobile/package-lock.json

key-decisions:
  - "Removed the unused stale tar override instead of forcing tar v7, which is absent from the SDK 57 graph and known to break Expo prebuild."
  - "Scoped uuid 11.1.1 to xcode rather than overriding uuid globally; the sole residual advisory cleared and xcode's CommonJS v4 usage remained compatible."
  - "Recorded zero accepted risks because the final audit is clean; MOBILE-03 remains unchanged for the separate phase verifier."

patterns-established:
  - "Treat npm audit's affected package-node total separately from unique advisory IDs so one transitive GHSA is dispositioned exactly once."

# Metrics
duration: 13min
completed: 2026-08-05
---

# Phase 22 Plan 05: Mobile Audit Remediation Summary

**Cleared the final Expo SDK 57 mobile audit advisory with a narrowly scoped xcode/UUID override, preserved exact Expo 57.0.9, and documented zero residual accepted risks.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-05T22:09:00Z
- **Completed:** 2026-08-05T22:22:00Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments

- Reduced the post-SDK-57 audit from 11 moderate affected nodes (one unique UUID advisory) to 0 vulnerabilities.
- Removed the stale unused `tar: ^6.2.1` override without introducing tar v7 or using a force fix.
- Scoped `uuid@11.1.1` to `xcode@3.0.1`, refreshed the lockfile, and proved xcode's CommonJS `v4()`-based identifier generation still works.
- Preserved the exact `expo@57.0.9` package pin and passed Doctor, dependency-tree, TypeScript, and full Jest gates.
- Created `22-AUDIT-ACCEPTED-RISK.md`, accounting for the sole Plan 22-05 advisory exactly once and recording no accepted residual risk.

## Task Commits

Each task was committed atomically:

1. **Task 1: Re-audit and refresh safe overrides** - `9bf8275c` (chore)
2. **Task 2: Document resolved-or-accepted posture** - `1f646953` (docs)

_Plan metadata is committed separately after this summary and state update._

## Files Created/Modified

- `apps/mobile/package.json` - removes the unused tar override and scopes UUID 11.1.1 to xcode.
- `apps/mobile/package-lock.json` - resolves the xcode edge from UUID 7.0.3 to patched UUID 11.1.1.
- `.planning/phases/22-expo-sdk-54-57-bump/22-AUDIT-ACCEPTED-RISK.md` - before/after evidence, advisory disposition, reachability, rationale, and verification record.

## Decisions Made

- **No tar major override:** SDK 57 no longer installs tar, so removing the stale override is safer than forcing the known-incompatible tar v7 package into Expo's toolchain.
- **Narrow UUID override:** `overrides.xcode.uuid = 11.1.1` changes only the vulnerable build/config edge. The API xcode actually calls (`require('uuid').v4()`) remains present and generated a valid 24-character Xcode identifier.
- **No accepted residual risk:** final `npm audit` is zero; the audit document's accepted-risk section explicitly says none.
- **Expo version evidence uses the installed package:** `require('expo/package.json').version` and `npm ls expo` confirm 57.0.9. `npx expo --version` reports bundled CLI 57.0.12 and is not the package-pin check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Security/Compatibility] Removed an obsolete tar override instead of forcing a patched major**
- **Found during:** Task 1 pre-fix audit and dependency-path inspection
- **Issue:** the plan anticipated updating tar to a patched major, but SDK 57 installs no tar package; forcing tar v7 would reintroduce this project's documented Expo prebuild CJS/ESM crash.
- **Fix:** removed the unused `tar: ^6.2.1` override and left tar absent.
- **Files modified:** `apps/mobile/package.json`
- **Verification:** `npm ls tar --all` has no tar node; audit, Doctor, tree, TypeScript, and Jest all pass.
- **Committed in:** `9bf8275c`

---

**Total deviations:** 1 auto-fixed compatibility/security issue. **Impact:** no scope expansion; the safer implementation satisfies MOBILE-04 without reintroducing a known build break.

## Issues Encountered

- The first PowerShell audit parser used a newer-shell-only `ConvertFrom-Json -Depth` option; rerunning without it produced the exact 11-node/one-advisory snapshot.
- An initial xcode smoke probe called `generateUuid()` before initializing a project hash. The corrected probe initialized the minimal object structure and passed.
- The GSD state helper could append the performance metric but could not parse this repository's legacy duplicated STATE layout; active Phase 22 position, decisions, progress, and session fields were updated manually while historical blocks were preserved.
- Existing Jest async `act(...)`, i18next initialization, and open-handle warnings remain unchanged; all 45 suites and 412 tests pass.

## Verification

- `npm audit --json`: 11 moderate / 11 total before the targeted override; 0 in every severity afterward.
- `npm ls --all`: exit 0.
- xcode/UUID compatibility probe: UUID 11.1.1, CommonJS `v4` present, valid generated identifier.
- installed Expo package: exactly 57.0.9.
- `npx expo-doctor@latest`: 20/20 checks passed.
- `npx tsc --noEmit`: exit 0.
- `npx jest`: 45/45 suites, 412/412 tests passed.
- `npm audit fix --force`: not run.

## User Setup Required

None.

## Next Phase Readiness

- MOBILE-04 is satisfied with a clean audit and complete evidence.
- Plan 22-05 is complete. Phase verification may run next, but was intentionally not started by this executor.
- MOBILE-03's direct-dependency wording remains the explicit verifier gap carried from Plans 22-03/22-04; this audit plan did not rewrite it.

---
*Phase: 22-expo-sdk-54-57-bump*
*Completed: 2026-08-05*

## Self-Check: PASSED

- FOUND: `22-05-SUMMARY.md`
- FOUND: `22-AUDIT-ACCEPTED-RISK.md`
- FOUND: dependency commit `9bf8275c`
- FOUND: audit-disposition commit `1f646953`
