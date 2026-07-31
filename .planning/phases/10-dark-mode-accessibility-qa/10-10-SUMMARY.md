---
phase: 10-dark-mode-accessibility-qa
plan: 10
subsystem: mobile-release-verification
tags: [expo, eas, android, accessibility, dark-mode, human-verify]

requires:
  - phase: 10-dark-mode-accessibility-qa
    plan: 09
    provides: Green 408-test mobile regression, type-check, lint/i18n, static audit, and Android export gate on the execution commit
provides:
  - Terminally successful Android production AAB and distinct preview/internal APK from the same execution commit
  - Cryptographically verified preview APK installation on the Android walkthrough emulator
  - Explicit human approval of all ten Android theme, role, localization, accessibility, and offline matrix rows
affects: [10-11, phase-10-verification, DARK-01, DARK-02, DARK-03, DARK-04, DARK-05]

tech-stack:
  added: []
  patterns:
    - Keep production release evidence and installable walkthrough evidence separate while requiring the same source commit and fingerprint
    - Scope human acceptance to the exact installed build/device pair and preserve deferred-platform boundaries

key-files:
  created:
    - .planning/phases/10-dark-mode-accessibility-qa/10-10-SUMMARY.md
  modified: []

key-decisions:
  - "DARK-04 is satisfied by the production-profile AAB; the Android walkthrough is satisfied separately by the same-commit preview/internal APK."
  - "The ten-row PASS claim is scoped to preview build 95d7754c-8841-4025-a2bc-bae83f8b3543 on emulator-5554 and does not imply an iOS build or iOS walkthrough."
  - "Credentials and secrets are excluded; the verified active account is recorded only as Claudia (housekeeper), while additional role identities are not retained."

patterns-established:
  - "Release evidence records build IDs, durable dashboard links, artifact links, commit, fingerprint, timestamps, version, installed checksum, signer, and device metadata."
  - "Human checkpoint rows use stable observation references when no screenshot artifact was retained."

duration: 2h
completed: 2026-07-31
---

# Phase 10 Plan 10: Android EAS Build and Human Matrix Summary

**A same-commit production AAB and preview APK reached terminal EAS success, the preview was cryptographically verified on Pixel_8_3, and the user explicitly approved all ten Android walkthrough rows.**

## Performance

- **Duration:** 2h
- **Started:** 2026-07-31T08:09:35Z (production build creation)
- **Completed:** 2026-07-31T10:09:00Z
- **Tasks:** 2
- **Files modified:** 1 plan evidence artifact

## Accomplishments

- Closed DARK-04 with a terminally successful EAS Android `production` build producing an AAB.
- Produced a distinct `preview`/internal-distribution APK from the exact same commit and EAS fingerprint.
- Installed and rechecked the preview on `emulator-5554`; the installed APK checksum and signer match the verified preview artifact.
- Captured explicit human approval for rows 1-10 against that exact preview/emulator pair.

## Source and Automated Gate

The build execution commit is `9d75a06c09d85ac86697e939a3fdd62af45ca1d7` (`docs(10-09): complete automated mobile release gate plan`, committed 2026-07-31 02:50:19 -05:00). Commit lookup succeeded during closeout.

Plan 10-09 records the final automated gate on that commit:

| Gate | Result |
|---|---|
| Focused theme/accessibility Jest | PASS, 2 suites / 13 tests |
| Full mobile Jest | PASS, 44 suites / 408 tests / 0 failures |
| TypeScript | PASS, `npm run type-check` |
| Lint and i18n literal-string gate | PASS, `npm run lint` |
| Android Expo export | PASS, 1,372 modules; 43 assets; Hermes bundle; metadata |
| Export cleanup | PASS, run-specific output removed |
| Runtime/dependency scope review | PASS, test-only 10-09 diff; no package or runtime dependency change |

These automated results are repeatable code/bundle evidence. They are not presented as substitutes for the EAS build or human Android matrix.

## EAS Production Build

| Field | Evidence |
|---|---|
| Profile / platform | `production` / Android |
| Distribution / artifact | `STORE` / AAB |
| Build ID | `098af561-9b45-48e4-995f-052a6446855c` |
| Dashboard | https://expo.dev/accounts/henilllpatelll/projects/patelrep/builds/098af561-9b45-48e4-995f-052a6446855c |
| Artifact | https://expo.dev/artifacts/eas/1YeClwxFsyUlPAG37DK5lCMdLooV1UFKxOWWVwh16lM.aab |
| Commit | `9d75a06c09d85ac86697e939a3fdd62af45ca1d7` |
| Fingerprint | `d159a0639672a68074bd26b2fc05f6e73f4cf3aa` (ID `019fb738-b813-7e6a-a87f-8433072e8ce8`) |
| Created | 2026-07-31T08:09:35.472Z |
| Completed | 2026-07-31T08:20:34.903Z |
| Terminal outcome | `FINISHED` |
| App / build version | `1.0.0` / versionCode `1` |
| SDK / runtime | Expo SDK `54.0.0` / runtime `1.0.0` |

The production AAB is release evidence and was not used as the emulator walkthrough binary.

## EAS Installable Preview Build

| Field | Evidence |
|---|---|
| Profile / platform | `preview` / Android |
| Distribution / artifact | `INTERNAL` / APK |
| Build ID | `95d7754c-8841-4025-a2bc-bae83f8b3543` |
| Dashboard | https://expo.dev/accounts/henilllpatelll/projects/patelrep/builds/95d7754c-8841-4025-a2bc-bae83f8b3543 |
| Download | https://expo.dev/artifacts/eas/tPydxiYAGThiFYKSitru_flFX5_0MFeS3x0xrgtmBLg.apk |
| Commit | `9d75a06c09d85ac86697e939a3fdd62af45ca1d7` |
| Fingerprint | `d159a0639672a68074bd26b2fc05f6e73f4cf3aa` (ID `019fb738-b813-7e6a-a87f-8433072e8ce8`) |
| Created | 2026-07-31T08:22:15.703Z |
| Completed | 2026-07-31T08:30:09.984Z |
| Terminal outcome | `FINISHED` |
| App / build version | `1.0.0` / versionCode `1` |
| SDK / runtime | Expo SDK `54.0.0` / runtime `1.0.0` |
| EAS checksum | EAS did not expose a checksum in `build:view`; installed-artifact verification is recorded below |

Both EAS records independently returned the same source commit and fingerprint during closeout.

## Installation and Device Evidence

| Field | Evidence |
|---|---|
| Emulator / serial | AVD `Pixel_8_3` / `emulator-5554` |
| Android | Android 15 / API 35 |
| System model report | `sdk_gphone64_x86_64` |
| Display | 1080 x 2400 physical pixels, density 420 |
| Baseline system locale at closeout query | `en-US`; app-local locale override empty |
| Package | `com.patelrep.app` |
| Installed version | `1.0.0`, versionCode `1`, targetSdk 36 |
| Install time | 2026-07-31 04:07:08 -05:00 |
| Installed APK SHA-256 | `70350a0166f376ee8b9f275ac9a20cde7e56899a5332605465e9179bde58fce9` |
| Installed signer SHA-256 | `8cb1d38bcf43997989a96343895e85ec999a70fb9d0b7b652123ab2db95c51ed` |
| Preview identity | Build `95d7754c-8841-4025-a2bc-bae83f8b3543`; checksum and signer match the verified preview APK |
| Verified active fixture | Claudia, `housekeeper` role; no credential or secret retained |
| Other role coverage | Supervisor, engineer, front-desk, and GM shells are covered by the human-approved matrix; individual account identities were not retained |

The closeout pull of the installed `base.apk` independently reproduced SHA-256 `70350a...fce9`; the temporary pulled file was deleted and absence confirmed. The accessibility settings used for row 10 were part of the human walkthrough and were not expected to remain enabled after the test.

## Human Android Matrix

All results below are scoped to preview build `95d7754c-8841-4025-a2bc-bae83f8b3543` installed on `emulator-5554`. Observation references identify the approved checkpoint rows; no separate screenshot bundle was retained.

| Row | Result | Human-verified coverage | Observation |
|---:|:---:|---|---|
| 1 | PASS | Cold launch, login, onboarding/hydration boundary, and no wrong-theme flash. | `H-10-10-R1` |
| 2 | PASS | Profile System/Light/Dark selector; restart persistence; live System change; selected semantics; EN/ES fit. | `H-10-10-R2` |
| 3 | PASS | Shared shell headers/back actions/role tabs/status and navigation bars/FAB plus loading, empty, error, banner, badge, Toast, modal, and sheet states. | `H-10-10-R3` |
| 4 | PASS | Housekeeper shell, My Rooms and housekeeping actions, primary/destructive choices, offline queueing, reconnect, and synchronization. | `H-10-10-R4` |
| 5 | PASS | Supervisor shell, inspection queue/detail, and housekeeping oversight states. | `H-10-10-R5` |
| 6 | PASS | Engineer shell, work-order list/detail, status actions, and confirmation flows. | `H-10-10-R6` |
| 7 | PASS | Front-desk shell across guest requests, logbook, lost & found, SOP, and applicable shared task flows. | `H-10-10-R7` |
| 8 | PASS | GM shell across dashboard, tasks, scheduling, staff, reports, billing, settings/integrations, and Profile. | `H-10-10-R8` |
| 9 | PASS | AI Copilot D-11 dark content in both app preferences, theme-reactive surrounding chrome, input/actions, Toasts, and service-recovery states. | `H-10-10-R9` |
| 10 | PASS | Light/dark, EN/ES, narrow layout, 200% text, TalkBack name/role/order/state, 44pt targets, reduced motion, contrast/boundaries/status cues, and offline/reconnect layering. | `H-10-10-R10` |

### Explicit Approval

The user returned the required checkpoint approval verbatim:

> Approved — rows 1–10 pass on preview 95d7754c-8841-4025-a2bc-bae83f8b3543 on emulator-5554

This statement is the human release-gate evidence for the ten PASS results above. It is not inferred from the build records, screenshots, automated tests, or the executor's device metadata query.

## Checkpoint Chronology

1. **2026-07-31T08:09:35Z:** production build created from execution commit `9d75a06c...`.
2. **2026-07-31T08:20:34Z:** production AAB reached `FINISHED`.
3. **2026-07-31T08:22:15Z:** preview build created without changing commits.
4. **2026-07-31T08:30:09Z:** preview/internal APK reached `FINISHED`; commit and fingerprint matched production.
5. **03:36 -05:00:** installation checkpoint identified conflicting pre-existing Android debug signatures on available AVDs; no build identity was weakened.
6. **03:56 -05:00:** a visible Claudia session was rejected as Phase 10 evidence because its installed package had the Android debug signer rather than the EAS preview signer.
7. **04:08-04:09 -05:00:** after explicit package-replacement authorization, only `com.patelrep.app` on `Pixel_8_3` was replaced; installed checksum and signer matched the verified preview.
8. **04:15 -05:00:** Claudia authenticated in the release-signed preview and the ten-row human matrix was presented.
9. **04:31 -05:00:** foreground app/session and preview checksum/signer were rechecked before approval; rows remained unapproved at that moment.
10. **Continuation approval:** the user supplied the exact approval quoted above; closeout then independently re-read both EAS records and reproduced the installed APK checksum.

## Task Commits

1. **Task 1: Build production artifact and same-commit installable walkthrough APK** - external EAS/device evidence on source commit `9d75a06c`; no repository file changed before the checkpoint.
2. **Task 2: Human-verify the rendered Android matrix** - captured in this plan metadata commit after explicit approval.

The final metadata commit hash is recorded by Git after this summary, STATE, and ROADMAP update are committed.

## Files Created/Modified

- `.planning/phases/10-dark-mode-accessibility-qa/10-10-SUMMARY.md` - Separate production, preview, installation, device, chronology, and approved ten-row Android evidence.
- `.planning/STATE.md` - Advanced Phase 10 progress from 9/11 to 10/11.
- `.planning/ROADMAP.md` - Reconciled plan count for Phase 10 without marking the phase complete.

## Decisions Made

- The production AAB and preview APK remain distinct evidence even though they share the same commit and fingerprint.
- The Android approval is bound to one explicit preview build and emulator serial.
- No account credentials, passwords, auth tokens, or additional role identities are included.

## Deviations from Plan

### Operational Cleanup Deviation

**1. Removed a run-created bare Expo config from the repository root**

- **Found during:** Final plan-owned-path audit.
- **Issue:** An untracked 16-byte root `app.json` containing only `{"expo": {}}` had creation time 2026-07-31 04:29:55 -05:00, during the earlier failed root-working-directory EAS lookup.
- **Verification:** The file was absent from Git history, did not match `apps/mobile/app.json`, and was not present before the 10-10 evidence command that used the wrong working directory.
- **Fix:** Removed only the exact untracked root file. No tracked file, unrelated untracked file, or existing OpenWolf/Graphify content was removed.
- **Tracking:** OpenWolf `bug-834`; no Git commit because the accidental file was untracked.

---

**Total deviations:** 1 operational cleanup deviation.
**Impact on plan:** No product, build, device, or approval evidence changed; the final metadata commit remains limited to plan-owned planning artifacts.

## Issues Encountered

- The pre-existing package on `Pixel_8_3` initially carried the Android debug signer. It was correctly rejected rather than treated as preview evidence, then replaced only after explicit authorization. The final installed APK matches the EAS preview checksum and signer.
- EAS did not expose an APK checksum in `build:view`; installation identity was proven by the downloaded/installed artifact checksum and certificate signer instead.
- A failed read-only EAS lookup from the repository root created a bare untracked `app.json`; the closeout audit identified and removed that exact run-created artifact.
- The installed GSD helper could not parse PatelRep's custom current-position/session fields and formatted the ROADMAP row without its Milestone column. Its valid metric/count output was retained, the exact STATE/ROADMAP rows were normalized manually to 10/11, and the resulting diff was revalidated (`bug-835`).

## Accepted Boundaries

- **iOS remains deferred:** no iOS EAS build, simulator/device walkthrough, or iOS accessibility claim is made. This is the already-deferred `IOS-01` future requirement and does not block the Android-scoped v1.1 gate.
- **Credentials are not evidence artifacts:** Claudia's housekeeper role was observed, but no credential material is recorded. Other role-shell account identities were not captured; the evidence is the user's explicit approval of their matrix rows.
- Existing v1.0 Twilio, live LLM, and OHIP credential limitations remain unchanged and are not represented as exercised by this Android UI matrix.

## User Setup Required

None - EAS authentication, builds, installation, and the human checkpoint are complete.

## Next Phase Readiness

- Plan 10-11 can now consolidate `10-01` through `10-10` into the fail-closed `10-VERIFICATION.md`.
- Phase 10 is **not** marked complete here; 10-11 must independently trace DARK-01 through DARK-05 and verify that no required evidence is missing.
- No additional checkpoint is required for 10-10.

## Self-Check: PASSED

- `10-10-SUMMARY.md` exists and contains both EAS build IDs, durable dashboard URLs, artifact URLs, exact source commit, common fingerprint, installed checksum/signer, emulator metadata, rows 1-10, exact user approval, and the iOS boundary.
- EAS `build:view` independently returned `FINISHED` for both IDs with source commit `9d75a06c09d85ac86697e939a3fdd62af45ca1d7`.
- Source commit `9d75a06c` resolves locally and its subject/timestamp match the recorded execution commit.
- The closeout device pull reproduced installed APK SHA-256 `70350a...fce9`, and the temporary pull was removed.
- All ten PASS rows and the exact approval string were found by the plan self-check; no unfinished placeholder marker exists.
- The run-created root `app.json` is absent; unrelated dirty and untracked paths remain untouched and excluded from the plan commit.

---
*Phase: 10-dark-mode-accessibility-qa*
*Completed: 2026-07-31*
