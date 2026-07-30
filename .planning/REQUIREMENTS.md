# Requirements: PatelRep v1.1 Mobile UI Parity

**Defined:** 2026-07-28
**Core Value:** Save a housekeeper or engineer time on the floor without weakening the hotel's ability to prove what occurred.

## v1 Requirements

Requirements for milestone v1.1. Each maps to roadmap phases.

### Theme Foundation

- [x] **THEME-01**: The app exposes a `useTheme()` hook returning the active theme's colors/spacing, reactive to the device's OS dark/light setting, with zero visual change to any existing screen until screens adopt it.
- [x] **THEME-02**: The app exposes a `ToastProvider`/`useToast()` available app-wide for non-blocking success/error/info feedback, as an alternative to `Alert.alert()` for non-destructive feedback.

### Missing Primitives

- [x] **UI-01**: A shared `Button`/`IconButton` primitive exists with size variants, a loading state, and a minimum 44pt/48dp touch target.
- [x] **UI-02**: A shared `Card` primitive exists as the single container pattern for grouped content.
- [x] **UI-03**: A shared `EmptyState`/`StateBlock` primitive exists that renders loading, empty, and error states from one prop.
- [x] **UI-04**: A shared `StatusBadge` primitive exists that pairs color with an icon and text label for every room/work-order status (never color alone).

### Mobile i18n Gate

- [x] **I18N-01**: An ESLint rule blocks raw JSX string literals in mobile floor-facing components/screens, mirroring web's `i18next/no-literal-string` gate, so new primitives and future mobile work can't silently ship English-only text.

### Floor-Role Rollout

- [x] **FLOOR-01**: The My Rooms screen (list + room detail) renders using the new Button/Card/StateBlock/Toast/StatusBadge primitives, with no change to existing offline-sync or data behavior.
- [x] **FLOOR-02**: The Room Board screen renders using the new primitives, with no change to existing offline-sync or data behavior.
- [x] **FLOOR-03**: The Work Orders screens (list + detail) render using the new primitives, with no change to existing RBAC or data behavior.
- [x] **FLOOR-04**: The Tasks screen renders using the new primitives, with no change to existing data behavior.
- [x] **FLOOR-05**: The Inspect screen/modal renders using the new primitives (including the photo-on-fail prompt), with no change to existing inspection-submission behavior.

### Remaining Screens Rollout

- [ ] **SCREENS-01**: The Profile screen renders using the new primitives.
- [ ] **SCREENS-02**: Role-specific home/dashboard screens (housekeeper, engineer, supervisor, front-desk, GM) render using the new primitives.
- [ ] **SCREENS-03**: Supervisor-facing screens (assignments, scheduling, staff) render using the new primitives.
- [ ] **SCREENS-04**: Engineering-adjacent screens (assets, PM schedules) render using the new primitives.
- [ ] **SCREENS-05**: Guest-service screens (guest requests list + detail, lost & found) render using the new primitives.
- [ ] **SCREENS-06**: Logbook screens (list + new entry) render using the new primitives.
- [ ] **SCREENS-07**: SOP screens (list + detail) render using the new primitives.
- [ ] **SCREENS-08**: The AI Copilot screen renders using the new primitives.
- [ ] **SCREENS-09**: Alerts and Notifications screens render using the new primitives.
- [ ] **SCREENS-10**: The Room Status screen renders using the new primitives.

### Dark Mode + QA

- [ ] **DARK-01**: A user can toggle dark mode on/off from Profile, applied instantly and persisted across app restarts.
- [ ] **DARK-02**: Every migrated screen passes a WCAG AA contrast check in both light and dark mode.
- [ ] **DARK-03**: The Expo Router navigator chrome (tab bar, headers, status bar) matches the active theme in both light and dark mode, with no unthemed flashes.
- [ ] **DARK-04**: A full EAS Android build succeeds after the theme/primitive work lands, confirming no new dependency broke the production build pipeline.
- [ ] **DARK-05**: Existing EN/ES bilingual coverage, offline-sync behavior, and RBAC-gated navigation are unchanged after the full rollout (regression check).

## Future Requirements

Deferred beyond v1.1.

### iOS

- **IOS-01**: EAS iOS build pipeline (currently Android-only) — separate initiative, not blocking mobile UI parity.

## Out of Scope

Explicitly excluded from v1.1. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Density modes (comfortable/balanced/dense) | Research found this is a desktop information-density concept that conflicts with the large, thumb-reachable, glove/glare-friendly touch targets floor staff need on a single-purpose phone screen. |
| Accent-color theming/picker | Risks colliding with the protected cross-platform status-color contract (ready/clean/dirty/pickup/out-of-order); floor staff want speed, not customization. |
| Porting web's `MobileFloorNav` component | That's a responsive-web nav for browser viewports; native already has a real Expo Router tab bar with role-based filtering — port the intent, not the component. |
| New mobile features (beyond visual/interaction parity) | This milestone is presentation-only, mirroring the web refresh's own "no behavior/data/routing/RBAC changes" constraint. |
| iOS build pipeline | Deferred — see Future Requirements. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| THEME-01 | Phase 7 | Validated |
| THEME-02 | Phase 7 | Validated |
| UI-01 | Phase 7 | Validated |
| UI-02 | Phase 7 | Validated |
| UI-03 | Phase 7 | Validated |
| UI-04 | Phase 7 | Validated |
| I18N-01 | Phase 7 | Validated |
| FLOOR-01 | Phase 8 | Complete |
| FLOOR-02 | Phase 8 | Complete |
| FLOOR-03 | Phase 8 | Complete |
| FLOOR-04 | Phase 8 | Complete |
| FLOOR-05 | Phase 8 | Complete |
| SCREENS-01 | Phase 9 | Pending |
| SCREENS-02 | Phase 9 | Pending |
| SCREENS-03 | Phase 9 | Pending |
| SCREENS-04 | Phase 9 | Pending |
| SCREENS-05 | Phase 9 | Pending |
| SCREENS-06 | Phase 9 | Pending |
| SCREENS-07 | Phase 9 | Pending |
| SCREENS-08 | Phase 9 | Pending |
| SCREENS-09 | Phase 9 | Pending |
| SCREENS-10 | Phase 9 | Pending |
| DARK-01 | Phase 10 | Pending |
| DARK-02 | Phase 10 | Pending |
| DARK-03 | Phase 10 | Pending |
| DARK-04 | Phase 10 | Pending |
| DARK-05 | Phase 10 | Pending |
