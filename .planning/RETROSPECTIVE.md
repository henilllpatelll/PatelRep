# PatelRep Retrospective

## Milestone: v1.0 — Hotel Standards Execution Plan

**Shipped:** 2026-07-28
**Phases:** 7 (0-6) | **Plans:** 40+ | **Commits:** 829 | **LOC:** ~105K (Python + TypeScript)

### What Was Built

Production trust and monitoring, core operational integrity (escalation, append-only audit history), a reusable compliance-evidence platform (controlled documents, evidence records, competency/acknowledgment, GM exceptions dashboard), Texas-specific safety/training operations, recurring bilingual (EN/ES) maintenance and housekeeping programs, guest-recovery workflows with SMS and measurable management ROI, and a security-audited, production-hardened AI copilot + Opera PMS integration.

### What Worked

- **Audit-first reframing when reality didn't match the roadmap.** Phase 6's discuss-phase discovered the planned "greenfield AI/PMS expansion" was already shipped and live, untested and ungated. Reframing to an audit-first hardening pass (mirroring Phase 4's S0 slice precedent) instead of building blindly on an unverified foundation caught 5 real bugs, not 0.
- **Fix-in-place discipline held across the whole milestone.** Every real bug found during any phase's audit — migration-079's SECURITY DEFINER grants, bug-449's None-handling, Phase 6's credit/SOP/webhook bugs, and the cross-phase guest-request escalation gap found at milestone-audit time — was fixed the same session, not deferred to a "later" that never comes.
- **Independent verification layers compounded, not duplicated.** Intra-phase verification (gsd-verifier), conversational UAT, and security audit each caught different things for Phase 6. The milestone-level cross-phase integration audit then caught something none of the three intra-phase checks could see structurally: a gap at a phase *boundary* (AI copilot → Phase 5's escalation contract).
- **TDD RED→GREEN discipline** (test proving the bug first, then the fix) was used consistently for every Phase 6 bug fix and for the milestone-audit fix — made "did this actually work" a mechanical check, not a claim.

### What Was Inefficient

- **Zombie dev-server processes wasted a full walkthrough.** Phase 6's first live-browser verification pass was silently served by 3-day-stale server processes (orphaned `multiprocessing.spawn` children that survived a parent-process kill), compounded by a missing `apscheduler` dependency that made every clean-restart attempt fail silently. The entire first walkthrough had to be discarded and redone once this was diagnosed.
- **A recurring local tool bug cost several manual recovery cycles.** The local GSD CLI's `state.*`/`phase.complete` commands repeatedly corrupted STATE.md's YAML frontmatter (wrong milestone name, wrong phase/plan counts) whenever invoked — caught via `git diff` each time and fixed by hand, but this happened 3+ times across the session.
- **Formal requirement/verification traceability is inconsistent across the milestone's history.** Phase 2 has no VERIFICATION.md or REQ-ID frontmatter linkage (predates that convention); Phase 3 used an entirely different planning format (EXECUTION-PLAN.md). Both were confirmed functionally complete via direct codebase inspection at milestone-audit time, but this required extra investigative work that formal traceability would have made instant.

### Patterns Established

- Audit-first hardening slice for any phase where discovery reveals pre-existing, unverified shipped code (Phase 4's S0, Phase 6 in full).
- Single-boolean pilot/feature-gating column (`tenants.opera_pilot_enabled`) as the default pattern for gating one integration, reserving richer multi-feature tables for when more than one thing actually needs independent gating.
- Direct-invocation test pattern (call the router function directly with a monkeypatched FakeDB, never TestClient/dependency_overrides) as the house style for RBAC/tenant-isolation/business-logic tests.
- Cross-phase integration audit as a mandatory milestone-close gate, not optional — it caught a real, user-facing silent-failure bug that 3 separate intra-phase audits missed by construction.

### Key Lessons

- An intra-phase audit, however thorough, cannot see gaps at phase *boundaries* by definition — a milestone-level cross-phase check is not redundant with phase-level verification, it's a different axis of coverage.
- "Already shipped and live" is not the same as "verified and safe" — treat undocumented, pre-existing production code as an audit target before treating it as a foundation to build on.
- When a live walkthrough's result seems to contradict known-correct code, investigate the *environment* (stale processes, missing dependencies) before doubting the code or the test — in this milestone, the environment was wrong both times a real discrepancy showed up.

### Cost Observations

- Model mix this session: primarily Sonnet for planning/execution/verification agents, Opus-tier for the initial planner. Ruflo/security-auditor/verifier/integration-checker all ran on Sonnet.
- Heavy use of parallel background subagents (executors, verifiers, security auditor, integration checker) kept wall-clock time down despite the milestone's breadth — most phase-closing work (UAT, security, verification) ran concurrently rather than serially where dependencies allowed.

---

## Cross-Milestone Trends

*(First milestone — no prior data to trend against yet. Populate this section starting with v1.1.)*
