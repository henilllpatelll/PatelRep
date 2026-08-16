# Phase 32: Role Dashboard Homes - Context

**Gathered:** 2026-08-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Each of the 6 roles (housekeeper, engineer, housekeeping_supervisor, chief_engineer, front_desk, gm) gets a purpose-built, redesigned dashboard home matched to their information needs — HOME-01. The GM currently borrows `SupervisorDashboard` (confirmed live in `app/(dashboard)/dashboard/page.tsx`); this phase gives the GM a genuinely first-class, dedicated dashboard home component instead — HOME-02. All 6 homes must honor the density/PageHeader/StateBlock contracts established in Phase 30/31 and redesign empty/loading/error states, not just the happy path, and must render behind the Phase-30 `web_redesign_sections` feature flag with dark-mode contrast and EN/ES parity intact.

User explicitly delegated all implementation-choice decisions in this phase to Claude ("you decide everything ... do not come back to me until the phase is completed and closed") — proceed autonomously through planning, execution, and phase close without further check-ins, consistent with the same delegation pattern already used for Phase 30/31 (see STATE.md).

</domain>

<decisions>
## Implementation Decisions

### GM home content (HOME-02)
- Lead with a **portfolio health snapshot**: aggregate cross-department status at a glance (rooms dirty/clean/pickup counts, open work orders by urgency, active guest requests, staff on shift) — this is the single most universally useful "at a glance" view for a GM logging in, and matches the app's core value prop (save time on the floor / prove what occurred) better than a financial-first view.
- Secondary section: **risk & alerts feed** (reuse `AIRiskAlertsPanel` — already exists, already exposes room/asset ids per Phase 26) surfaced below the snapshot, not above it — alerts are important but shouldn't be the first thing a GM sees before knowing overall portfolio state.
- Financial/credit usage (ROI, billing) is **not** the lead module — it gets a compact summary card (reuse `ROIMetricsStrip` if its shape fits) linking into Management ROI / Billing for full detail, not inlined at report depth.
- Compose entirely from **existing endpoints/components already in the app** (`LiveOpsGrid`, `ROIMetricsStrip`, `TrendChartsRow`, `AIRiskAlertsPanel`, management_roi, ai_copilot risk alerts, housekeeping/engineering summary endpoints). No new backend endpoints in this phase — matches the additive, frontend-scoped pattern of Phases 30-31. If research finds a genuine data gap, prefer composing from what exists over adding new backend surface; flag any hard gap rather than silently building around it.

### GM density
- **Light / drill-down**, not a dense BI report: a handful of large, clear summary cards/modules with links into the full Management ROI / Reports / Work Orders / Guest Requests sections for detail. This matches the existing density-toggle convention (`uiPreferencesStore`) and keeps the GM home itself lightweight rather than becoming its own mini-app — consistent with "flat architecture" and "don't add complexity" project conventions.

### Per-role information priority (HOME-01, all 6 roles)
Single most important thing each role should see first on their home:
- **housekeeper** — their active room assignment queue for today, in priority order (what to clean next)
- **engineer** — open work orders assigned to them, prioritized by SLA/urgency
- **housekeeping_supervisor** — room status board summary + team assignment overview (keep the existing informational shape of `SupervisorDashboard`, but this phase redesigns its visual chrome to match Phase 30/31 tokens — GM no longer reuses this component after HOME-02 lands)
- **chief_engineer** — cross-team work order overview + asset health/failure predictions (keep existing `ChiefEngineerDashboard` informational shape, redesign chrome)
- **front_desk** — room readiness for arriving guests, late checkout requests, and guest requests needing attention (keep existing `FrontDeskDashboard` informational shape, redesign chrome)
- **gm** — portfolio health snapshot, per above (net-new dedicated component)

For the 5 non-GM roles, this phase is a **visual/chrome redesign of existing, already-correct information architecture** — the existing components (`HousekeeperDashboard`, `EngineerDashboard`, `SupervisorDashboard`, `ChiefEngineerDashboard`, `FrontDeskDashboard`) already surface the right data; don't restructure their information priority, restyle it to the v2 design system and rebuild empty/loading/error states.

### Shared shell vs bespoke layout
- **Shared shell, bespoke content.** All 6 homes reuse a common PageHeader + card/grid shell and the same `StateBlock`/density/token contracts (matching Phase 30/31's "additive, no new component family" pattern), but which cards appear and in what order is bespoke per role — no attempt to force all 6 roles into one generic template. This keeps the homes visually consistent as a family (same rail/spacing/motion tokens) while staying purpose-built per role, per the phase's own stated goal.

### Empty/loading/error states (Success Criterion #3)
- Use the existing `StateBlock` component/pattern already established in the codebase for all three states across all 6 homes — no new state-presentation component.
- Loading: skeleton cards matching each home's redesigned card shell (not spinners), sized to avoid layout shift when data arrives.
- Empty: role-appropriate copy per home (e.g., housekeeper "No rooms assigned yet" vs engineer "No open work orders" vs GM "No active alerts") — tone consistent with existing `StateBlock` copy conventions elsewhere in the app, added to both `en`/`es` locale files to keep `check:i18n-parity` green.
- Error: consistent with existing error-state handling already in use elsewhere in the dashboard (retry affordance where one already exists as a pattern).

### Claude's Discretion
- Exact card/grid breakpoints and spacing values within the v2 token system.
- Whether the GM's cross-department snapshot is one combined module or 3-4 smaller per-department cards — pick whichever composes more cleanly from existing endpoint shapes (research/planner to determine during implementation).
- Order of secondary modules below the lead content on each home, as long as the single most-important-thing (above) stays first.
- Any minor endpoint/query composition details needed to assemble the GM portfolio snapshot from existing data.

</decisions>

<specifics>
## Specific Ideas

No specific visual references given beyond what's already established by Phase 30 (design tokens) and Phase 31 (shell chrome) — this phase should read as a natural continuation of that same visual system, not a new look. The GM home is the one genuinely new component; the other 5 are restyles of proven information architecture.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (No scope-creep items were raised; user delegated decision-making rather than proposing new capabilities.)

</deferred>

---

*Phase: 32-role-dashboard-homes*
*Context gathered: 2026-08-16*
