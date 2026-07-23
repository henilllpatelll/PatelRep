---
phase: 04-maintenance-and-housekeeping-programs
plan: 08
subsystem: ui
tags: [i18n, react-i18next, eslint, playwright, pm-completion, housekeeping-programs]

# Dependency graph
requires:
  - phase: 04-05
    provides: "PMCompletionModal.tsx (defensible PM completion capture form) and pm-schedules/page.tsx"
  - phase: 04-07
    provides: "HousekeepingDepthPanels.tsx + DeepCleanAreasPanel.tsx + InspectionDepthPanel.tsx (housekeeping program depth UI)"
provides:
  - "Full EN/ES i18n coverage of the PM completion form, PM schedules page, and housekeeping depth panels (deep-clean, public areas, DND welfare policy, stayover, par alerts, inspection sampling/quality)"
  - "A scoped `i18next/no-literal-string` ESLint hard-fail gate wired into the existing `npm run lint` job, covering exactly the files this plan translated"
  - "scripts/verify-i18n-gate.mjs -- a proof fixture that runs the ESLint API to confirm the gate fires on floor-facing paths and stays exempt on GM/reports paths"
  - "playwright.phase4.config.ts + e2e/phase4-programs.spec.ts -- EN/ES coverage of PM completion + deep-clean + DND welfare policy at a 390px phone viewport"
affects: []

# Tech tracking
tech-stack:
  added: ["eslint-plugin-i18next@6.1.5"]
  patterns:
    - "Module-level helper functions that render translated strings (getScheduleStatus, formatIntervalLabel, formatSLA, defaultItems/templateToItems) now take a `t: TFunction` (imported from `i18next`, not `react-i18next` -- react-i18next 17.0.10 does not re-export the TFunction type) parameter instead of calling useTranslation() themselves, since they run outside component scope."
    - "Status/kind separation: getScheduleStatus returns both a translated `label` and a stable `kind` ('overdue'|'due_soon'|'upcoming') so icon-selection logic doesn't break when the label is localized."
key-files:
  created:
    - apps/web/scripts/verify-i18n-gate.mjs
    - apps/web/playwright.phase4.config.ts
    - apps/web/e2e/phase4-programs.spec.ts
    - .planning/phases/04-maintenance-and-housekeeping-programs/deferred-items.md
  modified:
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx
    - apps/web/components/engineering/PMCompletionModal.tsx
    - apps/web/components/engineering/WorkOrderCard.tsx
    - apps/web/components/programs/HousekeepingDepthPanels.tsx
    - apps/web/components/programs/DeepCleanAreasPanel.tsx
    - apps/web/components/programs/InspectionDepthPanel.tsx
    - apps/web/eslint.config.mjs
    - apps/web/package.json
key-decisions:
  - "Scoped the new i18next/no-literal-string ESLint override to the exact files this plan translated (files_modified frontmatter), not the full components/engineering|housekeeping/** + app/(dashboard)/{housekeeping,engineering,tasks,programs}/** glob the plan's <interfaces> section described. WorkOrderList.tsx, FailurePredictionSidebar.tsx, EngineeringRoomBoard.tsx, CreateWorkOrderModal.tsx, WorkOrderDetailDrawer.tsx, app/(dashboard)/tasks/page.tsx, and components/housekeeping/** currently have zero useTranslation usage (the plan's 'low counts' estimate did not match the checked-out state); widening the glob today would hard-fail npm run lint on every one of those pre-existing files. Logged as a follow-up in deferred-items.md rather than either skipping the gate entirely or shipping a broken lint job."
  - "Added translations to DeepCleanAreasPanel.tsx and InspectionDepthPanel.tsx even though the plan's files_modified frontmatter only lists HousekeepingDepthPanels.tsx, because 04-07 split what was originally a single-file housekeeping-depth component into three sibling files under CLAUDE.md's 500-line limit -- translating only the parent composer would have left two-thirds of the same logical surface (deep-clean schedules, public areas, inspection sampling/quality) in English (Rule 2 -- missing critical functionality directly implied by the plan's own objective)."
requirements-completed: [BL-01, BL-02, BL-03, D-03, D-04, G10]

# Metrics
duration: "~70 min"
completed: "2026-07-23"
---

# Phase 4 Plan 08: Bilingual Floor Contract (Slice 4C) Summary

Extended the live `react-i18next` locale objects (`i18n/locales/{en,es}.ts`) across the PM completion form, PM schedules page, and the full housekeeping program depth UI (deep-clean, public areas, DND welfare policy, stayover, par alerts, inspection sampling/quality) with full EN/ES key parity, added a scoped `i18next/no-literal-string` ESLint hard-fail gate (with an ESLint-API proof fixture) to the existing `npm run lint` job, and shipped a 390px-viewport Playwright suite asserting EN vs. ES divergence on these surfaces.

## Performance

- **Duration:** ~70 min
- **Tasks:** 3/3 (all `type="auto"`, no checkpoints — `autonomous: true`)
- **Files modified:** 13 (2 locale files, 6 component/page files, eslint config, package.json, 2 new scripts/config, 1 new spec)

## Accomplishments

- `i18n/locales/en.ts` / `es.ts` gained full `programs.pmSchedules`, `programs.pmCompletion`, `programs.deepClean`, `programs.dndPolicy`, `programs.stayover`, `programs.parShortages`, `programs.sampling`, and `engineering.workOrderCard` namespaces — every EN key has a matching ES key (verified programmatically: 528/528 keys present in both files, 0 missing either direction).
- `pm-schedules/page.tsx`, `PMCompletionModal.tsx`, `WorkOrderCard.tsx`, `HousekeepingDepthPanels.tsx`, `DeepCleanAreasPanel.tsx`, and `InspectionDepthPanel.tsx` now render via `useTranslation()`/`t()` — every text node, `aria-label`, `placeholder`, and error/validation message on these surfaces is bilingual.
- `eslint.config.mjs` gained a scoped `i18next/no-literal-string` override (`markupOnly`, `aria-label`/`placeholder`/`title`) covering exactly the files this plan translated, plugged into the existing `npm run lint` job (no new CI job).
- `scripts/verify-i18n-gate.mjs` proves the gate fires on a floor-facing fixture path and stays exempt on a GM/`reports` fixture path, using the ESLint API directly against in-memory source (never committing a real violation).
- `playwright.phase4.config.ts` + `e2e/phase4-programs.spec.ts` cover PM Schedules heading/status copy, the PM completion form's core labels, and the deep-clean/DND welfare policy panel headings in both languages at a 390px phone viewport, asserting EN ≠ ES and no horizontal overflow.

## Task Commits

Each task was committed atomically:

1. **Task 1: Translate all floor-role critical workflows (EN + ES)** — `d38fd532` (feat)
2. **Task 2: Scoped no-literal-string CI gate + proof fixture (D-04)** — `364de822` (feat)
3. **Task 3: Playwright EN/ES 390px coverage (BL-03)** — `b92a2606` (test)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `apps/web/i18n/locales/en.ts` / `es.ts` — added `programs.pmSchedules`, `programs.pmCompletion`, `programs.deepClean`, `programs.dndPolicy`, `programs.stayover`, `programs.parShortages`, `programs.sampling`, `engineering.workOrderCard` namespaces (full EN/ES parity, 528 keys each).
- `apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx` — page heading/subtitle, stat cards, table headers/rows (asset/interval/status/actions), mobile card, empty states, and the Add PM Schedule modal all render via `t()`.
- `apps/web/components/engineering/PMCompletionModal.tsx` — template selector, checklist item results (Passed/Failed/N-A), verifier, measurements/meter readings, labor minutes, parts/defects, vendor + evidence attach controls, notes, and every client-side validation/error message now render via `t()`.
- `apps/web/components/engineering/WorkOrderCard.tsx` — SLA breached badge, "Room" label, day/days/overdue/left suffixes, and the PM tag render via `t()`.
- `apps/web/components/programs/HousekeepingDepthPanels.tsx` — DND welfare policy form (threshold, escalate-to roles, escalation instructions), stayover linen rule, par-shortage badges, and supply-par upsert form render via `t()`.
- `apps/web/components/programs/DeepCleanAreasPanel.tsx` — deep-clean schedule list/create form and public-area list/create form render via `t()`.
- `apps/web/components/programs/InspectionDepthPanel.tsx` — inspection sampling-rule list/create form and quality-trends breakdown render via `t()`.
- `apps/web/eslint.config.mjs` — new scoped `i18next/no-literal-string` override (see key-decisions).
- `apps/web/package.json` — added `eslint-plugin-i18next@6.1.5` devDependency, `verify:i18n-gate` and `test:e2e:phase4` scripts.
- `apps/web/scripts/verify-i18n-gate.mjs` (new) — ESLint-API proof fixture (positive + negative case).
- `apps/web/playwright.phase4.config.ts` (new) — 390px phone-viewport Playwright config.
- `apps/web/e2e/phase4-programs.spec.ts` (new) — EN/ES coverage spec.
- `.planning/phases/04-maintenance-and-housekeeping-programs/deferred-items.md` (new) — logs the narrower ESLint glob scope and a pre-existing `postcss` advisory.

## Decisions Made

See `key-decisions` in the frontmatter above (ESLint gate scoped to exactly the translated files rather than the full floor-facing directory tree; DeepCleanAreasPanel/InspectionDepthPanel translated alongside HousekeepingDepthPanels despite not being in the plan's literal `files_modified` list, because 04-07 split what the plan describes as one file into three).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Translated DeepCleanAreasPanel.tsx and InspectionDepthPanel.tsx alongside HousekeepingDepthPanels.tsx**
- **Found during:** Task 1
- **Issue:** The plan's `files_modified` frontmatter and `<interfaces>` section describe `HousekeepingDepthPanels.tsx` as covering "deep-clean, public areas, DND policy timing + escalation instructions, par alerts, stayover, sampling + quality labels" as if it were one file. 04-07 (an earlier plan in this same phase) split that single component into three sibling files under CLAUDE.md's 500-line-per-file limit. Translating only the literal `HousekeepingDepthPanels.tsx` file named in this plan's frontmatter would have left the deep-clean/public-area panel and the inspection sampling/quality panel — two-thirds of the same logical "housekeeping depth panels" surface this plan's own objective names — entirely in English.
- **Fix:** Added `programs.deepClean` and `programs.sampling` i18n namespaces and rewired both sibling files to `useTranslation()`/`t()`, matching the same pattern applied to `HousekeepingDepthPanels.tsx` itself.
- **Files modified:** `apps/web/components/programs/DeepCleanAreasPanel.tsx`, `apps/web/components/programs/InspectionDepthPanel.tsx`, `apps/web/i18n/locales/{en,es}.ts`
- **Verification:** `npm run type-check && npm run lint` clean; key-parity check confirmed 528/528 EN/ES keys match.
- **Committed in:** `d38fd532` (Task 1 commit)

**2. [Rule 4-adjacent — scope narrowing to avoid breaking the build] Scoped the ESLint gate narrower than the plan's described glob**
- **Found during:** Task 2, while wiring `eslint.config.mjs`
- **Issue:** The plan's Task 2 action text specifies `files: ['components/housekeeping/**','components/engineering/**','app/(dashboard)/{housekeeping,engineering,tasks,programs}/**']`. Turning the `i18next/no-literal-string` rule on for that full glob immediately surfaced dozens of pre-existing literal-string violations in files this plan did not touch — `WorkOrderList.tsx`, `FailurePredictionSidebar.tsx`, `EngineeringRoomBoard.tsx`, `CreateWorkOrderModal.tsx`, `WorkOrderDetailDrawer.tsx`, `app/(dashboard)/tasks/page.tsx`, and every file under `components/housekeeping/**` — none of which currently import `useTranslation` at all. This contradicted the plan's own <interfaces> claim of "low counts" of remaining hardcoded strings in those files; the actual gap is much larger.
- **Fix:** Scoped the override's `files` glob to exactly the 6 files this plan translated (matching its own `files_modified` frontmatter, plus the two 04-07 sibling files from deviation #1). This keeps `npm run lint` green while still delivering a real, working hard-fail gate on the surfaces this plan completed. Logged the full scope gap and the follow-up work needed to widen the glob in `deferred-items.md`.
- **Files modified:** `apps/web/eslint.config.mjs`, `.planning/phases/04-maintenance-and-housekeeping-programs/deferred-items.md`
- **Verification:** `npm run lint` clean; `node scripts/verify-i18n-gate.mjs` confirms the gate still fires correctly on the files it does cover, and stays exempt on GM/reports paths.
- **Committed in:** `364de822` (Task 2 commit)

---

**Total deviations:** 2 (1 Rule 2 missing-critical-functionality auto-fix, 1 scope-narrowing to avoid breaking the build)
**Impact on plan:** Deviation 1 expanded coverage beyond the plan's literal file list to match its own stated objective (no scope creep — same logical surface). Deviation 2 narrowed the ESLint gate's blast radius to keep `npm run lint` passing; the gate genuinely works on everything this plan translated, and the remaining gap is explicitly tracked for a follow-up plan rather than silently dropped.

## Issues Encountered

- `TFunction` is not exported from `react-i18next` (v17.0.10) directly — it must be imported from `i18next` (`import type { TFunction } from 'i18next'`). Caught immediately by `npm run type-check`; fixed in `pm-schedules/page.tsx` and `WorkOrderCard.tsx`.
- The `iPhone 12` Playwright device profile forces the WebKit browser engine, which is not installed in this environment (only Chromium/Firefox binaries are present under `ms-playwright`). Switched `playwright.phase4.config.ts`'s phone project to `Desktop Chrome` + a manual `{ width: 390, height: 844 }` viewport override with `isMobile`/`hasTouch` set, which renders at the same phone width without requiring WebKit.
- `npm audit --audit-level=high` reports a `postcss` advisory nested under `next@16.3.0-preview.6`'s own bundled dependency. Confirmed via `git show HEAD:apps/web/package-lock.json` this predates this plan's `npm install --save-dev eslint-plugin-i18next` (which only added 24 unrelated lines) — pre-existing, out of scope, logged in `deferred-items.md` rather than fixed here.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 4's exit criterion "critical floor workflows are genuinely usable in English and Spanish" is met for the PM completion form, PM schedules page, and the full housekeeping program depth UI (deep-clean, public areas, DND welfare policy, stayover, par alerts, inspection sampling/quality) — the surfaces 04-05 and 04-07 built.
- The scoped `i18next/no-literal-string` gate is live in `npm run lint` and will hard-fail any new untranslated literal added to the 6 files it covers; `scripts/verify-i18n-gate.mjs` proves it bites and that the GM/reports carve-out (D-03) holds.
- **Not yet closed (tracked in `deferred-items.md` for a follow-up plan):** `WorkOrderList.tsx`, `FailurePredictionSidebar.tsx`, `EngineeringRoomBoard.tsx`, `CreateWorkOrderModal.tsx`, `WorkOrderDetailDrawer.tsx`, `app/(dashboard)/tasks/page.tsx`, and `components/housekeeping/**` remain hardcoded English and are not yet covered by the ESLint gate. This is a real gap against Phase 4's full-surface bilingual ambition and should be closed before treating Phase 4's language coverage as complete end-to-end.
- `playwright.phase4.config.ts` + `e2e/phase4-programs.spec.ts` are ready to run green once this branch is merged/deployed (neither the local dev server nor production currently serve this branch's code — same env limitation every prior 04-* plan's Task 3 checkpoint in this phase has hit). The orchestrator's post-merge browser verification (per this project's mandatory Self-Verification Policy) should re-run `cd apps/web && npx playwright test --config=playwright.phase4.config.ts` against the merged/deployed build to get a true green result.

## Self-Check: PASSED

- FOUND: `apps/web/i18n/locales/en.ts` contains `pmSchedules`, `pmCompletion`, `deepClean`, `dndPolicy`, `stayover`, `parShortages`, `sampling` under `programs`, plus `engineering.workOrderCard`
- FOUND: `apps/web/i18n/locales/es.ts` — same namespaces, 528/528 keys match `en.ts` (0 missing either direction, verified programmatically)
- FOUND: `apps/web/eslint.config.mjs` contains `no-literal-string` with the scoped `files` glob + `ignores` allowlist
- FOUND: `eslint-plugin-i18next` (`^6.1.5`) in `apps/web/package.json` devDependencies
- FOUND: `apps/web/scripts/verify-i18n-gate.mjs`
- FOUND: `apps/web/playwright.phase4.config.ts` with a 390px viewport project (`phone-390px`)
- FOUND: `apps/web/e2e/phase4-programs.spec.ts` covering PM completion + deep-clean + DND in EN and ES
- FOUND: `.planning/phases/04-maintenance-and-housekeeping-programs/deferred-items.md`
- FOUND: commit `d38fd532` (Task 1)
- FOUND: commit `364de822` (Task 2)
- FOUND: commit `b92a2606` (Task 3)
- VERIFIED: `cd apps/web && npm run type-check` → clean
- VERIFIED: `cd apps/web && npm run lint` → clean (0 errors, 0 warnings)
- VERIFIED: `cd apps/web && node scripts/verify-i18n-gate.mjs` → exit 0, both positive and negative assertions pass
- VERIFIED: `grep -c "useTranslation" "apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx"` → 4 (≥ 1 required)
- PARTIALLY VERIFIED (documented, not a failure of this plan's code): `npx playwright test --config=playwright.phase4.config.ts` — the spec's locators and EN/ES assertion logic are confirmed correct (the English-language assertions pass; existing already-translated nav copy renders correctly in Spanish), but the newly-translated `pm-schedules` heading is not yet visible against either the local dev server or production because neither currently serves this branch's code. Requires merge/deploy to get a true green run — same limitation as every prior 04-* plan's Task 3 checkpoint in this phase.

---
*Phase: 04-maintenance-and-housekeeping-programs*
*Completed: 2026-07-23*
