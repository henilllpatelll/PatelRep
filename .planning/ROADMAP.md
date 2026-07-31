# Roadmap: PatelRep

## Milestones

- ✅ **v1.0 Hotel Standards Execution Plan** — Phases 0-6 (shipped 2026-07-28). Full details: `.planning/milestones/v1.0-ROADMAP.md`
- 🚧 **v1.1 Mobile UI Parity** — Phases 7-10 (in progress)

## Phases

<details>
<summary>✅ v1.0 Hotel Standards Execution Plan (Phases 0-6) — SHIPPED 2026-07-28</summary>

- [x] Phase 0: Restore reality — completed 2026-07-19
- [x] Phase 1: Core operational integrity — completed 2026-07-19
- [x] Phase 2: Evidence foundation (5/5 plans) — completed 2026-07-21
- [x] Phase 3: Texas compliance and staff safety — completed 2026-07-21 (deployed)
- [x] Phase 4: Maintenance and housekeeping programs (17/17 plans) — completed 2026-07-25 (deployed)
- [x] Phase 5: Guest recovery and management ROI (12/12 plans) — completed 2026-07-25 (deployed)
- [x] Phase 6: PMS and AI expansion (5/5 plans) — completed 2026-07-28

Full phase details, decisions, and issues: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### 🚧 v1.1 Mobile UI Parity (In Progress)

**Milestone Goal:** Bring the mobile app's visual and interaction design to parity with the web app's refreshed UI system (Waves 0-6, shipped 2026-07-27), starting with floor-role screens, without changing any behavior, data, routing, or RBAC.

- [x] **Phase 7: Theme Foundation & Primitives** - Reactive theme shell, missing UI primitives, and mobile i18n lint gate — zero visual change
- [x] **Phase 8: Floor-Role Rollout** - My Rooms, Room Board, Work Orders, Tasks, Inspect migrated onto the new primitives (completed 2026-07-30)
- [ ] **Phase 9: Remaining Screens Rollout** - Every other mobile screen migrated onto the new primitives
- [ ] **Phase 10: Dark Mode & Accessibility QA** - Dark mode enabled app-wide, contrast/build/regression verified

## Phase Details

### Phase 7: Theme Foundation & Primitives
**Goal**: The mobile app has a reactive theme system, the four missing shared primitives, and an i18n lint gate — the foundation every later phase depends on — with zero visible change to any existing screen.
**Depends on**: Nothing (first phase of v1.1)
**Requirements**: THEME-01, THEME-02, UI-01, UI-02, UI-03, UI-04, I18N-01
**Success Criteria** (what must be TRUE):
  1. A `useTheme()` hook is available app-wide and returns colors/spacing reactive to the device's OS dark/light setting, with zero visual change on any existing screen (theme shell built light-only-active).
  2. A `ToastProvider`/`useToast()` is available app-wide, rendering non-blocking success/error/info feedback as an alternative to `Alert.alert()`.
  3. Button/IconButton (size variants, loading state, ≥44pt/48dp touch target), Card, EmptyState/StateBlock (loading/empty/error from one prop), and StatusBadge (color+icon+label, never color alone) primitives exist and are usable by any screen.
  4. CI fails a mobile PR that introduces a raw JSX string literal in a floor-facing component/screen, mirroring web's `i18next/no-literal-string` gate.
  5. Every existing mobile screen looks and behaves identically to its pre-phase state (no screen has adopted the new primitives yet).
**Plans**: 6 plans (4 waves)
- [x] 07-01-PLAN.md — Theme shell: ThemeProvider + useTheme() (light-only-active), mounted at app root (THEME-01) [wave 1]
- [x] 07-02-PLAN.md — Toast system: ToastProvider/useToast + viewport below OfflineBanner, core-RN only (THEME-02) [wave 2]
- [x] 07-03-PLAN.md — Button primitive + IconButton theme-wire (UI-01) [wave 2]
- [x] 07-04-PLAN.md — Card + StatusBadge primitives (UI-02, UI-04) [wave 2]
- [x] 07-05-PLAN.md — EmptyState + StateBlock primitives + seed i18n keys (UI-03) [wave 3]
- [x] 07-06-PLAN.md — Mobile i18next/no-literal-string CI lint gate (I18N-01) [wave 4]
**UI hint**: yes

### Phase 8: Floor-Role Rollout
**Goal**: Floor staff (housekeepers, engineers) do their daily work on the 5 highest-traffic screens using the new primitives, with no change to underlying behavior.
**Depends on**: Phase 7
**Requirements**: FLOOR-01, FLOOR-02, FLOOR-03, FLOOR-04, FLOOR-05
**Success Criteria** (what must be TRUE):
  1. A housekeeper can view and act on My Rooms (list + room detail) rendered with the new Button/Card/StateBlock/Toast/StatusBadge primitives; offline-sync and data behavior are unchanged.
  2. A housekeeper or supervisor can view Room Board rendered with the new primitives; offline-sync and data behavior are unchanged.
  3. An engineer can view and act on Work Orders (list + detail) rendered with the new primitives; RBAC and data behavior are unchanged.
  4. Any floor role can view and complete Tasks rendered with the new primitives; data behavior is unchanged.
  5. Any floor role can complete an Inspection (including the photo-on-fail prompt) rendered with the new primitives; inspection-submission behavior is unchanged.
**Plans**: 9 plans (6 waves)
- [x] 08-00-PLAN.md — Wave 0 prereq: add textDisabled/accentBrassSoft/accentBrassLine to lightTheme/darkTheme (unblocks C.ink4/brassSoft/brassLine burn-down) [wave 0]
- [x] 08-01-PLAN.md — My Rooms list + RoomQueueCard rebuild on Card+Pressable (FLOOR-01) [wave 1]
- [x] 08-02-PLAN.md — My Rooms detail + ChecklistSection; 11 alerts → Toast (FLOOR-01) [wave 1]
- [x] 08-03-PLAN.md — My Rooms modals: ReportIssue/Knock/SupplyRequest/FoundItem (FLOOR-01) [wave 1]
- [x] 08-04-PLAN.md — Room Board + new render test scaffold (FLOOR-02) [wave 2]
- [x] 08-05-PLAN.md — Work Orders list + WorkOrderCard rebuild + CreateWorkOrderModal (FLOOR-03) [wave 3]
- [x] 08-06-PLAN.md — Work Orders detail; 10 alerts → Toast, escalate-confirm stays blocking (FLOOR-03) [wave 3]
- [x] 08-07-PLAN.md — Tasks list + TaskCard rebuild on Card+StatusBadge+Button (FLOOR-04) [wave 4]
- [x] 08-08-PLAN.md — Inspect screen; migrate existing fail-checklist as-is, no new photo capture (FLOOR-05) [wave 5]
**UI hint**: yes

### Phase 9: Remaining Screens Rollout
**Goal**: Every remaining mobile screen is migrated onto the shared primitives, completing app-wide visual and interaction parity with web.
**Depends on**: Phase 8
**Requirements**: SCREENS-01, SCREENS-02, SCREENS-03, SCREENS-04, SCREENS-05, SCREENS-06, SCREENS-07, SCREENS-08, SCREENS-09, SCREENS-10
**Success Criteria** (what must be TRUE):
  1. Profile and every role-specific home/dashboard screen (housekeeper, engineer, supervisor, front-desk, GM) render using the new primitives.
  2. Supervisor-facing screens (assignments, scheduling, staff) and engineering-adjacent screens (assets, PM schedules) render using the new primitives.
  3. Guest-service screens (guest requests list + detail, lost & found), Logbook screens (list + new entry), and SOP screens (list + detail) render using the new primitives.
  4. The AI Copilot screen, Alerts/Notifications screens, and the Room Status screen render using the new primitives.
  5. No screen in the app still imports the legacy frozen `C` token constant or renders a bare `Alert.alert()` for non-destructive feedback.
**Plans**: 17 plans (8 waves, incl. Wave 0)
- [ ] 09-00-PLAN.md — i18n gate-widening: wire 22 literals (16 text + 6 placeholders) + EN/ES keys, remove 4 ignores (I18N-01 backlog) [wave 0]
- [ ] 09-01-PLAN.md — Profile screen on primitives; sign-out Alert stays blocking (SCREENS-01) [wave 1]
- [ ] 09-02-PLAN.md — home/index.tsx (Housekeeper/FrontDesk/GM inline) + CompanionHome (SCREENS-02) [wave 1]
- [ ] 09-03-PLAN.md — SupervisorHome.tsx (57 C. refs, dedicated) (SCREENS-02) [wave 1]
- [ ] 09-04-PLAN.md — EngineerHome.tsx (largest file, dedicated) (SCREENS-02) [wave 1]
- [ ] 09-05-PLAN.md — assignments/index.tsx (largest screen); :238 sheet stays, :361 lateCo → Toast (SCREENS-03) [wave 2]
- [ ] 09-06-PLAN.md — scheduling + staff screens (SCREENS-03) [wave 2]
- [ ] 09-07-PLAN.md — RoomDetailSheet.tsx (own plan, D-08); 2 confirms stay, 2 outcomes → Toast (SCREENS-03) [wave 2]
- [ ] 09-08-PLAN.md — 6 supervisor files (atoms first) + 6 alerts → Toast (SCREENS-03, D-07) [wave 2]
- [ ] 09-09-PLAN.md — assets + pm-schedules; 4 alerts → Toast (SCREENS-04) [wave 3]
- [ ] 09-10-PLAN.md — guest-requests list + [requestId] detail (D-02) (SCREENS-05) [wave 4]
- [ ] 09-11-PLAN.md — lost-found/index.tsx; :99 error → Toast (SCREENS-05) [wave 4]
- [ ] 09-12-PLAN.md — logbook list + new (D-02) (SCREENS-06) [wave 5]
- [ ] 09-13-PLAN.md — sop list + [sopId] detail (D-02) (SCREENS-07) [wave 5]
- [ ] 09-14-PLAN.md — copilot minimal migration (keep dark, D-11); 1 C. ref + 6 alerts → Toast (SCREENS-08) [wave 6]
- [ ] 09-15-PLAN.md — alerts + notifications screens (SCREENS-09) [wave 7]
- [ ] 09-16-PLAN.md — room-status/index.tsx (D-04 modal verify); 2 sheets stay, 3 errors → Toast (SCREENS-10) [wave 7]
**UI hint**: yes

### Phase 10: Dark Mode & Accessibility QA
**Goal**: Users can toggle dark mode across the fully-migrated app, with navigator chrome themed correctly, contrast verified, the production build still green, and no regression to bilingual/offline/RBAC behavior.
**Depends on**: Phase 9
**Requirements**: DARK-01, DARK-02, DARK-03, DARK-04, DARK-05
**Success Criteria** (what must be TRUE):
  1. A user can toggle dark mode on/off from Profile; the change applies instantly and persists across app restarts.
  2. Every migrated screen passes a WCAG AA contrast check in both light and dark mode.
  3. The Expo Router navigator chrome (tab bar, headers, status bar) matches the active theme in both light and dark mode, with no unthemed flash.
  4. A full EAS Android build succeeds after the theme/primitive work lands, confirming no new dependency broke the production build pipeline.
  5. A full app walkthrough confirms existing EN/ES bilingual coverage, offline-sync behavior, and RBAC-gated navigation are unchanged after the full rollout.
**Plans**: 11 plans
**UI hint**: yes

## Backlog

- **Parked (v1.0 era, now current for v1.1):** Mobile work resumes in v1.1 after being parked for v1.0 (web + API only).
- **Doc drift to fix:** CLAUDE.md's documented cron mechanism (GitHub Actions + `X-Cron-Secret`) is stale — the project now runs crons in-process via APScheduler (`apps/api/core/scheduler.py`). Code is correct; only the doc needs updating. Not in v1.1 scope (no requirement covers it); revisit opportunistically.
- **Pending real-world validation:** live Twilio SMS (v1.0 Phase 5) and live Opera/OHIP + LLM-provider round-trips (v1.0 Phase 6) remain unexercised — no credentials exist in the local dev environment. Accepted deferrals, not gaps.
- **Small tidy-up:** `guest_requests.py` uses inline `current_user.role` checks instead of the `require_role()` dependency pattern used elsewhere — functionally equivalent, cosmetic inconsistency.
- **Deferred to future milestone:** iOS EAS build pipeline (IOS-01, see `.planning/REQUIREMENTS.md` Future Requirements) — separate initiative, not blocking mobile UI parity.
- **Pre-existing lint smell:** `roleTabs.ts` has a duplicate `case "engineer"` — worth a one-line cleanup if a v1.1 wave touches neighboring code, not itself a requirement.
- **Deferred from Phase 7 to Phase 9 (i18n gate scope):** The mobile `i18next/no-literal-string` gate (07-06) was narrowed to exclude four floor files that predate i18n work and have no `useTranslation` — `components/engineering/CreateWorkOrderModal.tsx`, `components/housekeeping/ReportIssueModal.tsx`, `components/housekeeping/SupplyRequestModal.tsx`, `app/(app)/tasks/index.tsx` (22 raw literals total, incl. safety-critical copy). Translating them now would breach Phase 7's zero-visual-change boundary and ship unreviewed Spanish; deferred to Phase 9's screen migration (mirrors web's 04-08 narrow-then-widen). **Phase 9 must migrate these onto `t()` with EN+ES keys and remove the corresponding `ignores` entries in `apps/mobile/eslint.config.mjs`.** Note: Phase 8 migrates these four files' buttons/cards/colors onto the primitives while passing their existing hardcoded English strings through as-is (D-06) — it does NOT widen the gate.

## Progress

**Execution Order:**
Phases execute in numeric order: 7 → 8 → 9 → 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|-----------------|--------|-----------|
| 0. Restore reality | v1.0 | N/A | Complete | 2026-07-19 |
| 1. Core operational integrity | v1.0 | N/A | Complete | 2026-07-19 |
| 2. Evidence foundation | v1.0 | 5/5 | Complete | 2026-07-21 |
| 3. Texas compliance and staff safety | v1.0 | — | Complete (deployed) | 2026-07-21 |
| 4. Maintenance and housekeeping programs | v1.0 | 17/17 | Complete (deployed) | 2026-07-25 |
| 5. Guest recovery and management ROI | v1.0 | 12/12 | Complete (deployed) | 2026-07-25 |
| 6. PMS and AI expansion | v1.0 | 5/5 | Complete | 2026-07-28 |
| 7. Theme Foundation & Primitives | v1.1 | 6/6 | Complete | 2026-07-29 |
| 8. Floor-Role Rollout | v1.1 | 9/9 | Complete    | 2026-07-30 |
| 9. Remaining Screens Rollout | v1.1 | 0/17 | Not started | - |
| 10. Dark Mode & Accessibility QA | v1.1 | 9/11 | In progress | - |
