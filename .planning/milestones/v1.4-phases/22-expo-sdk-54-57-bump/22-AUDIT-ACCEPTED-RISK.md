# Phase 22 Mobile npm Audit Resolution Record

**Scope:** `apps/mobile` after the Expo SDK 57.0.9 hop
**Recorded:** 2026-08-05
**Requirement:** MOBILE-04

## Outcome

`npm audit` is clean: **0 total vulnerabilities** (0 info, 0 low, 0 moderate, 0 high, 0 critical). There are therefore **no residual advisories accepted as risk**.

The roadmap recorded 19 vulnerabilities and Phase 22 research later measured **20 affected package nodes** (16 moderate, 3 high, 1 critical). After the SDK 57 hop, the Plan 22-05 pre-fix audit measured **11 affected package nodes**, all moderate, representing one unique advisory. The targeted override reduced that result to zero.

| Snapshot | Info | Low | Moderate | High | Critical | Total affected package nodes |
|---|---:|---:|---:|---:|---:|---:|
| Roadmap | not recorded | not recorded | not recorded | not recorded | not recorded | 19 |
| Phase research, before SDK hops | 0 | 0 | 16 | 3 | 1 | 20 |
| Plan 22-05 before targeted fix | 0 | 0 | 11 | 0 | 0 | 11 |
| Plan 22-05 after targeted fix | 0 | 0 | 0 | 0 | 0 | 0 |

`npm audit` counts affected dependency nodes as vulnerabilities. The 11-node pre-fix result did **not** represent 11 distinct GHSAs: all 11 propagated from the single `uuid` advisory below.

## Advisory disposition

Each unique advisory observed at the Plan 22-05 boundary appears exactly once in this table.

| Disposition | Root package | Severity | Advisory ID | Affected range | Reachability | Resolution |
|---|---|---|---|---|---|---|
| **RESOLVED** | `uuid` | Moderate | npm source `1119441`; `GHSA-w5hq-g745-h8pq` | `<11.1.1` | Build/config only: `expo` / `expo-splash-screen` -> `@expo/config-plugins` -> `xcode@3.0.1` -> `uuid@7.0.3`. It is not bundled into the shipped React Native APK runtime. | Scoped `overrides.xcode.uuid` to exact `11.1.1`; lockfile now resolves `xcode` to `uuid@11.1.1`. CommonJS `require('uuid').v4()` and `xcode.generateUuid()` were smoke-tested successfully. |

The 11 affected nodes reported before the override were `@expo/cli`, `@expo/config`, `@expo/config-plugins`, `@expo/inline-modules`, `@expo/local-build-cache-provider`, `@expo/metro-config`, `@expo/prebuild-config`, `expo`, `expo-splash-screen`, `xcode`, and `uuid`. They were propagation/effect nodes for `GHSA-w5hq-g745-h8pq`; all cleared together with the one root advisory and are not counted as separate accepted risks.

## Earlier research advisory groups resolved by SDK 57

These groups were present in the 20-node research snapshot but were already absent from Plan 22-05's pre-fix audit:

| Root package | Research severity | Example advisory ID | Disposition |
|---|---|---|---|
| `tar` | High / Critical | `GHSA-23hp-3jrh-7fpw` (representative of the research snapshot's tar advisory set) | **RESOLVED by the SDK 57 graph.** `npm ls tar --all` reports no installed tar package. The stale unused `tar: ^6.2.1` override was removed. Tar v7 was deliberately not forced because its ESM/CJS interop breaks Expo prebuild in this project. |
| `brace-expansion` | High | `GHSA-rgw5-rvv9-x895` | **RESOLVED by the SDK 57 graph.** Installed copies are patched `1.1.18` and `5.0.9`; neither appears in the current audit. No new override was needed. |
| `uuid` | Moderate | `GHSA-w5hq-g745-h8pq` | Persisted as the sole Plan 22-05 advisory, then **RESOLVED** by the scoped `xcode` override documented above. |

## Accepted risk

**None.** The final audit contains no residual advisory. No advisory is simultaneously marked resolved and accepted.

Had a supported fix not existed, the relevant exposure would have been confined to Expo build/prebuild/config tooling and no CI workflow here processes untrusted archives. That fallback was not needed because the scoped UUID change passed every compatibility gate.

## Verification evidence

- `npm audit --json`: before targeted fix = `{"info":0,"low":0,"moderate":11,"high":0,"critical":0,"total":11}`; after = `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`.
- `npm ls --all`: exit 0; `xcode@3.0.1 overridden -> uuid@11.1.1 overridden`; no `tar` node.
- UUID/xcode compatibility probe: UUID package `11.1.1`, CommonJS `v4` export present, and `xcode.generateUuid()` returned a valid 24-character uppercase project identifier.
- Installed Expo package: exact `57.0.9` (`require('expo/package.json').version` and `npm ls expo`). `npx expo --version` prints the bundled CLI version `57.0.12`, not the Expo package pin.
- `npx expo-doctor@latest`: 20/20 checks passed.
- `npx tsc --noEmit`: exit 0.
- `npx jest`: 45/45 suites and 412/412 tests passed.

## Safety constraints

- `npm audit fix --force` was **not** run. It can replace Expo packages outside the supported SDK matrix and invalidate the validated graph.
- Tar v7 was **not** introduced; the known Expo prebuild CJS/ESM failure was avoided.
- Expo remains pinned exactly to `57.0.9`; MOBILE-03's separate direct-dependency gap was not changed by this audit plan.
- The only post-EAS graph change is the targeted, fully verified build-time `xcode -> uuid` security override permitted by Plan 22-05.
