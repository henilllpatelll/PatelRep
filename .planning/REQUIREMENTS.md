# Requirements: PatelRep — v2.0 Web UI/UX Redesign

**Defined:** 2026-08-14
**Core Value:** Save a housekeeper or engineer time on the floor without weakening the hotel's ability to prove what occurred.

**Milestone scope:** Complete visual identity + navigation/IA + workflow redesign of `apps/web`. The Housekeeping Room Status Board (`RoomStatusBoard.tsx`, `RoomDetailDrawer.tsx`) and the Engineering Room Board (`EngineeringRoomBoard.tsx`) are explicitly excluded and must remain functionally and visually unchanged. `apps/api` and `apps/mobile` are out of scope. Aesthetic direction researched, not predetermined — see `.planning/research/`.

**Critical constraint (all 4 research tracks converged on this):** the Room Board exclusion is not clean at the file level — `Button`/`IconButton`, `ui/primitives` (`StatusDot`/`Pill`), `RoomCard`, `LogFoundItemModal`, and the global CSS token layer are shared dependencies of the excluded boards and are themselves in scope for the redesign. The entire requirements set below is structured around an additive-only strategy with a dedicated regression gate, per `.planning/research/SUMMARY.md`.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Foundation

- [x] **FOUND-01**: New design tokens (palette, motion, elevation, z-index) are added additively to `globals.css`; no existing token value is mutated
- [x] **FOUND-02**: A frozen-primitive list (`Button`, `IconButton`, `ui/primitives` [`StatusDot`/`Pill`], `RoomCard`, `LogFoundItemModal`, plus every token the excluded boards read) is documented and enforced — existing variants/props on these are only extended, never changed
- [x] **FOUND-03**: Pre-redesign baseline screenshots of all 3 excluded surfaces are captured (light + dark, at least 2 roles) before any shared-primitive work begins, and a pixel-diff regression check against that baseline gates every subsequent phase that touches a frozen primitive
- [x] **FOUND-04**: An automated dark-mode WCAG AA contrast check is added to the verification gate, covering every new token/variant pairing
- [x] **FOUND-05**: An EN/ES i18n key-parity check is added to the verification gate (beyond the existing no-raw-literal CI rule), so new copy can't ship missing a locale
- [x] **FOUND-06**: The new visual system ships behind a feature flag so sections can roll out incrementally without exposing a visibly half-broken UI to hotel staff

### Navigation & Shell

- [x] **NAV-01**: Sidebar, header, breadcrumbs, and command palette are redesigned using the Foundation token/variant system, remaining fully driven by the existing `getAllowedHrefs`/`getAllowedNavItems` RBAC source of truth
- [x] **NAV-02**: Sidebar is collapsible to an icon rail, with collapsed/expanded state persisted per-user in `uiPreferencesStore`
- [x] **NAV-03**: A notification inbox surfaces in the shell header, scoped to `hotel_id` + user, letting a user review what happened while they were away
- [x] **NAV-04**: Command palette search extends beyond nav-jump to find rooms, work orders, guests, and SOPs directly, filtered to what the current role is allowed to see
- [x] **NAV-05**: A role×nav visibility matrix (6 roles × every nav item) is captured against the old app and re-verified against the redesigned nav, logged in as each of the 6 roles
- [x] **NAV-06**: Navigation is simple, consistent, and self-evidently discoverable — a user can find any section relevant to their role without hunting

### Dashboard Homes

- [x] **HOME-01**: Each of the 6 roles (housekeeper, engineer, housekeeping_supervisor, chief_engineer, front_desk, gm) has a redesigned, purpose-built dashboard home appropriate to their information needs
- [x] **HOME-02**: GM gets a first-class, dedicated dashboard home component (replacing the current borrowed-supervisor-view composition)

### Sections

- [ ] **SEC-01**: All non-board dashboard sections (Tasks, SOP Library, Logbook, Reports, Management ROI, Guest Requests, Lost & Found, Safety, Evidence, Programs, Scheduling, Staff, Settings, AI Copilot, Billing, Notifications, Guest Feedback, Late Checkout, Opera Integration) are redesigned with the new visual system, including empty/loading/error states, not just the happy path

  **Roadmap split (2026-08-14):** SEC-01 spans 19 independent sections, too large for one coherent phase. For roadmap execution it is split into two sub-batches, each mapped to exactly one phase; SEC-01 is satisfied only when both are complete:
  - **SEC-01a** → Phase 33 (Core Operational Sections): Tasks, SOP Library, Logbook, Guest Requests, Lost & Found, Safety, Evidence, Programs, Scheduling
  - **SEC-01b** → Phase 34 (Management & Admin Sections): Reports, Management ROI, Staff, Settings, AI Copilot, Billing, Notifications, Guest Feedback, Late Checkout, Opera Integration

### Board-Adjacent (chrome only)

- [ ] **ENG-01**: The Engineering section's surrounding chrome (PageHeader, tabs, work-orders/assets/PM-schedules/predictions pages) is redesigned; `EngineeringRoomBoard` renders unchanged inside the new chrome
- [x] **HSK-01**: The Housekeeping section's surrounding chrome (PageHeader, sync badge, date/shift controls, housekeeper "my rooms" list) is redesigned; `RoomStatusBoard` and `RoomDetailDrawer` render unchanged inside the new chrome, and Realtime sync remains live

### Final QA

- [x] **QA-01**: A full 6-role navigation walkthrough is verified against the role×nav matrix (NAV-05) before shipping
- [x] **QA-02**: A full Spanish-locale walkthrough of all redesigned sections is verified before shipping
- [x] **QA-03**: A final pixel-diff of all 3 excluded surfaces against the Foundation baseline (FOUND-03) confirms zero visual/functional drift before shipping

## v2 Requirements

None deferred from this milestone's own scoping — the anti-features below were rejected outright, not deferred, per research.

## Out of Scope

| Feature | Reason |
|---------|--------|
| `RoomStatusBoard.tsx` / `RoomDetailDrawer.tsx` (Housekeeping board) | Explicit, hard user exclusion — one of 3 Supabase-Realtime-subscribed surfaces in the app |
| `EngineeringRoomBoard.tsx` (Engineering board) | Explicit, hard user exclusion — same reasoning |
| `apps/api` changes | This milestone is presentation/IA-layer only; research confirmed zero backend change is implied |
| `apps/mobile` changes | Web-only milestone, mirrors the prior UI Refresh Plan's scoping |
| Adopting shadcn/ui as a dependency | Its oklch token vocabulary (`--background`/`--primary`/`--muted`/`--ring`) collides with this repo's existing hex `--paper`/`--ink`/`--accent` system and would put the excluded Room Board at risk; used as a copy-paste recipe reference only, not installed |
| Tailwind v4 migration | Breaking CSS-first rewrite touching every file including the excluded boards and CI gates, for zero visual-identity payoff — its own milestone if ever pursued |
| A second component/animation/icon library | Existing Radix + CVA + framer-motion + lucide-react stack is sufficient; a second library would fragment the design system |
| Drag-drop customizable dashboard widgets | Anti-feature per research — adds complexity without earning its keep against the floor-first filter |
| Global app-wide date/property filter | Anti-feature per research — not how this app's role-scoped workflows are used |
| Multi-level mega-menu | Anti-feature per research — works against NAV-06's simplicity goal |
| Badges/toasts on passive events | Anti-feature per research — notification inbox (NAV-03) covers the real need without alert fatigue |
| Replacing the floor bottom-tab nav with a hamburger menu | Anti-feature per research — floor staff need the current one-tap bottom-tab pattern, not a hidden menu |
| Onboarding tours over the new nav | Anti-feature per research — NAV-06's self-evidence goal is the actual fix; a tour papers over a confusing nav rather than fixing it |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 30 | Complete |
| FOUND-02 | Phase 30 | Complete |
| FOUND-03 | Phase 30 | Complete |
| FOUND-04 | Phase 30 | Complete |
| FOUND-05 | Phase 30 | Complete |
| FOUND-06 | Phase 30 | Complete |
| NAV-01 | Phase 31 | Complete |
| NAV-02 | Phase 31 | Complete |
| NAV-03 | Phase 31 | Complete |
| NAV-04 | Phase 31 | Complete |
| NAV-05 | Phase 31 | Complete |
| NAV-06 | Phase 31 | Complete |
| HOME-01 | Phase 32 | Complete |
| HOME-02 | Phase 32 | Complete |
| SEC-01 (SEC-01a) | Phase 33 | Complete |
| SEC-01 (SEC-01b) | Phase 34 | Pending |
| ENG-01 | Phase 35 | Pending |
| HSK-01 | Phase 36 | Complete |
| QA-01 | Phase 37 | Complete |
| QA-02 | Phase 37 | Complete |
| QA-03 | Phase 37 | Complete |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20 (SEC-01 split into SEC-01a/SEC-01b across Phases 33-34; both required for SEC-01 completion)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-14*
*Last updated: 2026-08-14 after Phase 30 closed — FOUND-01..06 complete (6/6 must-haves independently verified; see `.planning/phases/30-additive-foundation-regression-harness/30-VERIFICATION.md`)*
