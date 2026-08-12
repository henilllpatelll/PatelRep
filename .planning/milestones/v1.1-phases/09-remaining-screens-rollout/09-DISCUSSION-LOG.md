# Phase 9: Remaining Screens Rollout - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-30
**Phase:** 9-Remaining Screens Rollout
**Areas discussed:** Screen grouping & migration order, Home/dashboard screen family, Cross-phase supervisor-modal gap, AI Copilot & non-standard screens

---

## Screen grouping & migration order

| Option | Description | Selected |
|--------|-------------|----------|
| Usage frequency | Profile/dashboards first, then supervisor/engineering-adjacent, then guest-service/logbook/SOP, then copilot/alerts/room-status last | ✓ |
| ROADMAP's success-criteria grouping | Follow the 4 groups exactly as listed in ROADMAP.md | |
| Risk/complexity first | Tackle biggest/riskiest files (assignments, room-status, EngineerHome) first | |
| You decide | Leave wave breakdown to the planner | |

**User's choice:** Usage frequency (recommended) — locked as D-01.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, pair them | guest-requests + [requestId], sop + [sopId] migrate together | ✓ |
| No, split them | List/detail can land in separate waves | |

**User's choice:** Yes, pair them (recommended) — locked as D-02.

| Option | Description | Selected |
|--------|-------------|----------|
| Full depth everywhere | Every screen fully migrated, no exceptions | ✓ |
| Full depth, but allow more waves/plans | Same completeness, explicitly more waves permitted | |

**User's choice:** Full depth everywhere (recommended) — locked as D-03. Planner still has discretion on exact wave count since this phase is ~3x Phase 8's size.

| Option | Description | Selected |
|--------|-------------|----------|
| Full screen, verify modal integration | Full C→theme pass on room-status chrome + confirm CreateWorkOrderModal still integrates | ✓ |
| Skip re-checking the modal | Only touch room-status's own chrome | |

**User's choice:** Full screen, verify modal integration (recommended) — locked as D-04.

**Notes:** All four sub-questions in this area resolved to the recommended option, closely mirroring Phase 8's D-01/D-02/D-03 precedents.

---

## Home/dashboard screen family

| Option | Description | Selected |
|--------|-------------|----------|
| All 5 together, one wave | Mirrors Phase 8 D-02 "coherent unit" logic | ✓ |
| Split across waves by role | Balances wave size given ~1,950 lines total | |

**User's choice:** All 5 together, one wave (recommended) — locked as D-05.

| Option | Description | Selected |
|--------|-------------|----------|
| No, keep file structure as-is | Pure presentation swap, no restructuring | |
| Yes, extract to match Supervisor/Engineer pattern | Split FrontDeskHomeScreen/GMHomeScreen into own files | |

**User's choice:** "You make all of the decisions" — recorded as Claude's Discretion (D-06), default leaning toward NOT restructuring unless the planner finds concrete benefit.

**Notes:** Confirmed via grep that zero `Alert.alert` calls exist anywhere in `home/index.tsx`, `SupervisorHome.tsx`, `EngineerHome.tsx`, or `CompanionHome.tsx` — no further questions needed on Toast conversion for this cluster.

---

## Cross-phase supervisor-modal gap

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, include them | Mirrors Phase 8's own D-05/D-07 cross-phase-reachability logic | ✓ |
| No, log as a gap for later | Leave unmigrated, note as residual gap | |

**User's choice:** Yes, include them (recommended) — locked as D-07. Discovered via codebase scout (grep for `tokens.ts` importers) that all 7 `components/supervisor/` files are still on legacy `C.*` despite being reachable from Phase 8's closed Room Board/Inspect screens.

| Option | Description | Selected |
|--------|-------------|----------|
| Own dedicated plan | RoomDetailSheet.tsx (363 lines, 43 C.* refs) gets its own plan, not bundled with smaller modals | ✓ |
| Bundle with the other supervisor modals | Keep all 7 files in one plan/wave | |

**User's choice:** Own dedicated plan (recommended) — locked as D-08.

---

## AI Copilot & non-standard screens

| Option | Description | Selected |
|--------|-------------|----------|
| Theme-wire in place | Keep chat structure as-is, only route colors/buttons through primitives | ✓ |
| Apply Card to message bubbles | Wrap bubbles in Card for visual consistency | |
| You decide | Leave exact treatment to planner | |

**User's choice:** Theme-wire in place (recommended) — locked as D-09.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, same rule | Apply Phase 8's D-04 confirm-vs-feedback classification | ✓ |
| Keep all copilot alerts as Alert.alert | Treat AI-triggered confirmations as always-blocking | |

**User's choice:** Yes, same rule (recommended) — locked as D-10.

---

## Claude's Discretion

- Exact wave/plan count and internal breakdown mechanics (D-03), informed by D-01 ordering + D-02 pairing.
- `home/index.tsx` internal file-split question (D-06) — default toward no restructuring.
- Per-`Alert.alert` classification across all screens + supervisor files (D-10's rule applied case-by-case).
- Exact `copilot/index.tsx` bubble/input primitive mapping beyond "no Card force-fit" (D-09).

## Deferred Ideas

- Dark mode activation — Phase 10.
- `apps/mobile/app/(auth)/login.tsx`'s legacy `C`/`tokens.ts` usage — out of scope, not part of any SCREENS-XX requirement.
- Any further `evening.tsx` exports beyond what Phase 8 already excluded — untouched, no requirement covers them.
- The mandatory i18n gate widening (4 files deferred from Phase 7→8→9) was not re-discussed as a gray area — it's locked, non-negotiable backlog scope per ROADMAP.md, carried directly into CONTEXT.md's Phase Boundary section.
