# Phase 30: Additive Foundation & Regression Harness - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Lay the visual-identity foundation (new tokens, extended primitive variants, and every safety gate) that every later v2.0 phase builds on — proven not to alter the 3 excluded Room Board surfaces (`RoomStatusBoard.tsx`, `RoomDetailDrawer.tsx`, `EngineeringRoomBoard.tsx`). This phase does not restyle any actual section — that's Phases 31-36. It only lands the foundation and the regression harness that guarantees the exclusion holds throughout the rest of the milestone.

</domain>

<decisions>
## Implementation Decisions

### Visual Identity Direction
- Overall mood, palette, and typography: **Claude's discretion** — propose a direction based on research (hotel ops software, floor-staff usability under time pressure), grounded in this codebase's existing token architecture (per `.planning/research/STACK.md`)
- Accent color: open to changing the current terracotta primary if research suggests a better fit for the new identity — not required to preserve it
- No specific reference apps/styles requested by the user — free to research and propose from B2B ops SaaS patterns
- Typography: **Claude's discretion** — keep the current system-ui sans stack or adopt a distinctive typeface, whichever fits the chosen mood; no new font is required by default

### HARD CONSTRAINT — Room Status Badge Colors (explicit, not discretionary)
Room-status badge colors (dirty / clean / inspected / occupied) must stay **exactly as currently implemented, everywhere they render** — not just inside the 3 excluded board files, but also in any redesigned chrome that displays a room-status color (e.g. a legend, filter chip, or "my rooms" list in Phase 36's Housekeeping chrome work). Staff are trained on what these colors mean; the meaning must not shift.

This is **narrower** than the full frozen-primitive/token list from FOUND-02: only the specific token(s)/values used to represent room cleanliness state are frozen at their current values. Other status-color vocabularies (task status, work-order priority, risk levels) are explicitly **not** frozen and are open to the redesign in their own section phases.

**Action for this phase:** identify and document the exact token(s)/hardcoded values that encode room-status colors (read `RoomCard.tsx`, `ui/primitives.tsx` `StatusDot`/`Pill`, and any status-color mapping) as part of the frozen-primitive list, tagged distinctly from the rest of the frozen list so downstream phases know these specific values can never change even where the frozen *component* itself isn't otherwise in play.

### Feature-Flag Rollout Control
- **Scope:** per-tenant boolean column, mirroring the existing `tenants.opera_pilot_enabled` precedent (e.g. `tenants.web_redesign_enabled` or similar naming consistent with that convention)
- **Control:** no GM-facing toggle in this phase — flipped directly via DB/admin tooling by the team, same operational pattern as Opera pilot gating (not a self-service settings switch)
- **Granularity:** gates **per-section**, not all-or-nothing. As each later phase's redesigned section lands, it becomes visible under the flag for a flagged tenant, while not-yet-redesigned sections keep rendering old UI for that same tenant. This phase must build the flag mechanism to support that granularity, not just a single blanket switch.
- **Lifecycle:** this flag and the old-UI code path are meant to be removed in a follow-up cleanup once every tenant is fully migrated — **not** a permanent rollback switch. (Removal itself is out of scope for Phase 30; just don't design it in a way that makes future removal harder than necessary — e.g. avoid deeply intertwining flag checks with business logic.)

### Existing Theming System Fate
- **4 switchable accent themes:** Claude's discretion — keep all 4, reduce the set, or fold into a single refined default, based on fit with whatever visual identity direction is proposed
- **3 density modes (compact/comfortable/spacious):** keep all 3 — this is a real accessibility/preference feature, not just visual flair; the new token system must continue to support it
- **Light vs. dark mode design priority:** Claude's discretion on whether light is designed first as reference with dark derived, or both designed in parallel
- **Motion/micro-interaction expressiveness:** Claude's discretion — should stay fitting for an operational tool used under time pressure (functional, not decorative); `prefers-reduced-motion` continues to be respected as it already is today

### Frozen-Primitive Enforcement Rigor
**Claude's discretion, exercised as follows** (user delegated all remaining decisions for this phase — see below): enforcement is **CI-enforced, not documentation-only**, following this project's own established precedent (RBAC-05..08 in v1.5 replaced periodic manual audits with automated AST/script-based CI guards specifically because manual conventions had drifted repeatedly in this codebase's history). Two layers:
1. A file-change guard that fails CI if any frozen file changes without an explicit, reasoned allowlist entry — mirrors the existing `rbac_bare_comparison_allowlist.json` pattern already used in this codebase
2. The Playwright pixel-diff baseline comparison already mandated by FOUND-03's own success criterion, as the deeper functional/visual guarantee beyond "was the file touched"

### Claude's Discretion (all remaining decisions)
The user explicitly delegated everything else for this phase mid-discussion: *"you decide everything from now on and complete the discuss phase then complete plan phase and do not come back to me until the phase is completed and closed."* This covers: the exact palette/typography proposal, exact new token names/values, accent-theme/density integration specifics, motion intensity, contrast-tooling choice (e.g. axe vs. a Lighthouse CI wiring), and any remaining implementation-level judgment calls through research, planning, execution, and verification for Phase 30.

All such decisions should be made using this project's established conventions — additive-only tokens (never mutate existing values), structural CI enforcement over manual/documentation-only conventions, the mandatory Non-Regression Policy, and the mandatory Self-Verification Policy (live browser checks, not just type-check/build) — and documented with rationale in the phase's own artifacts (RESEARCH.md, PLAN.md, SUMMARY.md), consistent with how this project has always recorded discretionary calls.

**Per the user's explicit instruction, do not return to the user for further input until Phase 30 is fully planned, executed, verified, and closed.**

</decisions>

<specifics>
## Specific Ideas

No specific visual references or examples were given — the user deferred the actual aesthetic proposal to research (explicitly requested Opus-model research earlier in this milestone's `/gsd-new-milestone` session). The one concrete, non-negotiable specific: **room-status badge colors (dirty/clean/inspected/occupied) must not change anywhere in the app**, even outside the 3 excluded board files.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 30 scope. Note: other status-color vocabularies (task status, work-order priority, risk levels) are not deferred — they're simply open to redesign in their own later section phases, not decided here.

</deferred>

---

*Phase: 30-additive-foundation-regression-harness*
*Context gathered: 2026-08-14*
