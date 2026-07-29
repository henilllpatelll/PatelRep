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

- [ ] **Phase 7: Theme Foundation & Primitives** - Reactive theme shell, missing UI primitives, and mobile i18n lint gate — zero visual change
- [ ] **Phase 8: Floor-Role Rollout** - My Rooms, Room Board, Work Orders, Tasks, Inspect migrated onto the new primitives
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
- [ ] 07-06-PLAN.md — Mobile i18next/no-literal-string CI lint gate (I18N-01) [wave 4]
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
**Plans**: TBD
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
**Plans**: TBD
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
**Plans**: TBD
**UI hint**: yes

## Backlog

- **Parked (v1.0 era, now current for v1.1):** Mobile work resumes in v1.1 after being parked for v1.0 (web + API only).
- **Doc drift to fix:** CLAUDE.md's documented cron mechanism (GitHub Actions + `X-Cron-Secret`) is stale — the project now runs crons in-process via APScheduler (`apps/api/core/scheduler.py`). Code is correct; only the doc needs updating. Not in v1.1 scope (no requirement covers it); revisit opportunistically.
- **Pending real-world validation:** live Twilio SMS (v1.0 Phase 5) and live Opera/OHIP + LLM-provider round-trips (v1.0 Phase 6) remain unexercised — no credentials exist in the local dev environment. Accepted deferrals, not gaps.
- **Small tidy-up:** `guest_requests.py` uses inline `current_user.role` checks instead of the `require_role()` dependency pattern used elsewhere — functionally equivalent, cosmetic inconsistency.
- **Deferred to future milestone:** iOS EAS build pipeline (IOS-01, see `.planning/REQUIREMENTS.md` Future Requirements) — separate initiative, not blocking mobile UI parity.
- **Pre-existing lint smell:** `roleTabs.ts` has a duplicate `case "engineer"` — worth a one-line cleanup if a v1.1 wave touches neighboring code, not itself a requirement.

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
| 7. Theme Foundation & Primitives | v1.1 | 5/6 | In progress | - |
| 8. Floor-Role Rollout | v1.1 | 0/TBD | Not started | - |
| 9. Remaining Screens Rollout | v1.1 | 0/TBD | Not started | - |
| 10. Dark Mode & Accessibility QA | v1.1 | 0/TBD | Not started | - |
