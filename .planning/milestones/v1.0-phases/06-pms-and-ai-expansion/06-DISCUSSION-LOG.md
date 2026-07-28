# Phase 6: PMS and AI expansion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 6-PMS and AI expansion
**Areas discussed:** Phase 6 scope reframe, Audit scope boundary, Pilot-hotel gating, Fix-in-place vs. file-and-defer, Test coverage depth target

---

## Phase 6 scope reframe (pre-discussion gate)

Before generating standard gray areas, codebase scouting revealed that `.planning/ai-copilot-primary-interface.md` and `.planning/sop-voice-fastpath.md` — the two documents ROADMAP.md cites as Phase 6's AI-expansion backlog — are already fully implemented and deployed to production (commit `e4ac615a`, 2026-05-22), ungated, with zero test coverage. Opera PMS integration is also more built than CLAUDE.md's docs suggest. This was presented to the user before any gray-area discussion, since it changes the phase's fundamental nature from greenfield build to audit/hardening.

| Option | Description | Selected |
|--------|-------------|----------|
| Audit-first, like Phase 4's S0 | Verify tenant scoping/RBAC/security, add missing tests, confirm it works — before/instead of new capabilities | ✓ |
| New capabilities only | Skip auditing what exists; define genuinely new PMS/AI capabilities | |
| Both — audit slice then new-capability slice | Two waves: audit/harden first, then new capabilities on the confirmed base | |

**User's choice:** Audit-first, like Phase 4's S0 (Recommended)
**Notes:** This reframed the entire domain boundary and all four gray areas discussed below.

---

## Audit scope boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Copilot + Opera + insights | Include insight_query/generate_gm_insights — same router, same credit middleware, same RBAC surface | ✓ |
| Strict: copilot intents + Opera only | Exactly the two backlog docs' surfaces; leaves insight_query/generate_gm_insights unaudited | |
| Also audit the credit middleware itself | Everything above, plus a dedicated pass on middleware/credits.py for the A3 token-logging contract | |

**User's choice:** Copilot + Opera + insights (Recommended)
**Notes:** User did not additionally request the standalone credit-middleware deep-dive option, but D-02 in CONTEXT.md still scopes a credit-middleware check in since it's exercised incidentally through the copilot/insights endpoints being audited.

---

## Pilot-hotel gating

| Option | Description | Selected |
|--------|-------------|----------|
| Opera gets a flag, copilot stays ungated | Opera is the riskier external-integration surface — add a hotel-level pilot flag. AI copilot is self-contained, verify safety as-is | ✓ |
| Build a flag for both | More conservative — gate both surfaces to selected pilot hotels | |
| No new flag — verify current state is safe | Treat pilot-gating as a business/rollout decision, not a code gate | |

**User's choice:** Opera gets a flag, copilot stays ungated (Recommended)
**Notes:** None.

---

## Fix-in-place vs. file-and-defer

| Option | Description | Selected |
|--------|-------------|----------|
| Fix immediately, same phase | Matches Phase 2/3 convention (e.g. migration 079 SECURITY DEFINER fix happened inline) | ✓ |
| Audit first, then gap-closure waves | Matches Phase 4's S0 → gap-closure pattern (04-09..04-17) | |
| Audit only, fixes become a separate future phase | Hard stop after the audit report for a review checkpoint | |

**User's choice:** Fix immediately, same phase (Recommended)
**Notes:** None.

---

## Test coverage depth target

| Option | Description | Selected |
|--------|-------------|----------|
| Full Phase 1–5 rigor | RBAC + tenant-isolation + audit-reconstruction/credit-accounting tests + live E2E walkthrough | ✓ |
| Lighter smoke pass | Confirm endpoints respond + spot-check RBAC on highest-risk routes only | |
| Tiered: full rigor for Opera, smoke for copilot | Opera gets full rigor (external system, higher risk); copilot gets lighter smoke pass | |

**User's choice:** Full Phase 1–5 rigor (Recommended)
**Notes:** User explicitly chose full rigor for both surfaces over the tiered option, despite Opera being flagged as higher-risk — zero existing coverage on either surface was the deciding factor.

---

## Claude's Discretion

- Exact shape of the pilot-flag mechanism (single boolean column vs. richer `pilot_features` table vs. reuse of an existing settings pattern).
- Whether audit findings warrant new migrations vs. code-only fixes.
- Ordering of AI-copilot-audit vs. Opera-audit within the phase's wave structure.

## Deferred Ideas

- New AI/PMS capabilities beyond what's already shipped — deferred to a future phase once this audit/hardening pass closes.
- Mobile voice-input parity/testing — already code-complete but mobile work remains parked project-wide.
- Formal "two successful pilot hotels" business criteria — this phase builds the pilot-flag mechanism only, not the business-side success metrics.
