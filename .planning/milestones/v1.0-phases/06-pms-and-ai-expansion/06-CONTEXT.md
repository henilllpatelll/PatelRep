# Phase 6: PMS and AI expansion - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

**Reframed from the original roadmap conception.** ROADMAP.md describes Phase 6 as pilot-gated greenfield "PMS and AI expansion," pointing at `.planning/ai-copilot-primary-interface.md` and `.planning/sop-voice-fastpath.md` as backlog material. Codebase scouting during discussion found both documents are **already fully implemented and deployed** — commit `e4ac615a` (2026-05-22) shipped work-order/guest-request/assignment AI copilot intents, ambiguity chips, shift history, SOP Q&A wiring, and the credit fast-path rule engine, all on `main` in production today. Opera PMS integration (`apps/api/services/opera/`, `apps/api/routers/integrations.py`) is similarly more built than CLAUDE.md's "two-way sync hardening deferred" note suggests — connect/status/sync/**conflicts-list/conflicts-resolve**/test/disconnect endpoints plus 5 webhook handlers already exist. Neither surface is behind any pilot/feature flag — it is live for every hotel today. Neither surface has any dedicated test coverage (no `test_ai_copilot.py`, no `test_opera*.py`).

**This phase is therefore an audit-first verification and hardening pass — mirroring Phase 4's S0 slice** (`04-01-PLAN.md`, which found and fixed RBAC/read-gate/None-guard issues in a pre-existing scaffold before any new feature work). It is **not** a greenfield build of new AI/PMS capability. New capabilities are explicitly out of scope for this pass (see Deferred).

**Delivers:**
1. A verified, tested, production-trust-grade AI copilot expansion (task/work-order/guest-request/assignment intents, ambiguity handling, SOP Q&A, credit fast-path) and adjacent AI insight endpoints.
2. A verified, tested Opera PMS integration, with a real hotel-level pilot flag gating it to selected hotels.
3. Any real security/tenant-isolation/RBAC bugs found are fixed inline, in this same phase (Phase 2/3 convention), not deferred.
4. Full Phase 1–5-parity test coverage: RBAC tests, tenant-isolation tests, audit-reconstruction/credit-accounting tests, and a live authenticated E2E browser walkthrough.

</domain>

<decisions>
## Implementation Decisions

### Audit scope boundary
- **D-01:** Audit scope = AI copilot expansion intents (task_creation, work_order_creation, guest_request_creation, task_assignment, ambiguous, sop_query) in `apps/api/routers/ai_copilot.py` + their parsers in `apps/api/services/ai/` + the frontend `AICopilotBubble.tsx`, **plus** the adjacent `insight_query`/`generate_gm_insights` endpoints (same router, same credit-deduction middleware, same RBAC surface — cheap to include, closes a real gap) **plus** all 7 Opera endpoints in `apps/api/routers/integrations.py` + `apps/api/services/opera/`.
- **D-02:** `apps/api/middleware/credits.py` (the AI credit-gate middleware) is explicitly in scope for its own audit pass — verify it satisfies CLAUDE.md's A3 contract (logs actual token usage from API responses, never fixed cost estimates) rather than only being exercised incidentally through the copilot/insights endpoints.

### Pilot-hotel gating
- **D-03:** Opera PMS integration gets a **real hotel-level pilot flag** (new column/table, e.g. on `tenants` or a dedicated `pilot_features` table — pattern TBD by planner) scoping Opera connect/sync/webhooks to explicitly enrolled pilot hotels only. This directly resolves CLAUDE.md's stale "feature-flagged for pilot" claim by making it true.
- **D-04:** AI copilot expansion (work orders/guest requests/assignments/fast-path/SOP Q&A/insights) stays **ungated** — no new flag. It is self-contained within a tenant's own data (doesn't touch an external system), so the audit's job is to verify RBAC/tenant-isolation/credit-cap correctness for its current all-hotels-live state, not to gate it further.

### Fix-in-place vs. file-and-defer
- **D-05:** Any real bug found during the audit (security, tenant-isolation, RBAC gap — the class of issue Phase 2 hit with the SECURITY DEFINER grant fix in migration 079, or Phase 3's bug-449 maybe_single() None-handling fix) is **fixed immediately within this same phase**, atomically with the audit that found it. Do not file-and-defer to a follow-up phase.

### Test coverage depth target
- **D-06:** Full Phase 1–5 rigor is the bar for **both** surfaces: RBAC tests (per-role 403 checks), tenant-isolation tests (cross-hotel access returns 404/empty, zero cross-tenant writes), audit-reconstruction/credit-accounting tests (verify `ai_interactions` logs real token counts per CLAUDE.md A3), and a live authenticated E2E browser walkthrough on localhost per the Self-Verification Policy in CLAUDE.md. This is a deliberate step up from Phase 4's narrower "lighter smoke pass" option — the user explicitly chose full rigor for both AI copilot and Opera rather than a tiered approach, since currently there is zero coverage for either.

### Claude's Discretion
- Exact shape of the pilot-flag mechanism (single boolean column vs. richer `pilot_features` table vs. reuse of an existing settings pattern) — planner/researcher to decide based on codebase conventions.
- Whether audit findings warrant new migrations vs. code-only fixes — depends on what's actually found.
- Ordering of AI-copilot-audit vs. Opera-audit within the phase's wave structure.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Already-shipped scope (audit targets, NOT build targets)
- `.planning/ai-copilot-primary-interface.md` — original AI copilot expansion plan; **already fully implemented** in commit `e4ac615a` (2026-05-22). Use this doc to know what SHOULD exist and verify it against actual behavior — do not re-implement.
- `.planning/sop-voice-fastpath.md` — SOP Q&A wiring + credit fast-path; **already fully implemented** in the same commit. The mobile voice-input section (§2) is also already built (`apps/mobile/app/(app)/copilot/index.tsx`, `expo-speech-recognition`) — mobile is out of this phase's scope regardless (see Deferred), audit web/API only.

### Code — primary audit targets
- `apps/api/routers/ai_copilot.py` — all intents, confirm endpoints, `insight_query`/`sop_query` handlers
- `apps/api/services/ai/work_order_parser.py`, `guest_request_parser.py`, `assignment_parser.py`, `task_parser.py` (incl. `try_fast_path()`), `sop_rag.py`
- `apps/web/components/ai/AICopilotBubble.tsx`, `apps/web/lib/api/ai.ts`
- `apps/api/routers/integrations.py` — all 7 Opera endpoints (`/opera/connect`, `/status`, `/sync`, `/conflicts`, `/conflicts/{id}/resolve`, `/test`, `/disconnect`)
- `apps/api/services/opera/auth.py`, `crypto.py`, `sync.py`, `webhooks.py`
- `apps/api/middleware/credits.py`

### Project conventions this phase must follow
- `CLAUDE.md` §AI credit accounting (A3) — "log actual token usage from API responses — never fixed costs"
- `CLAUDE.md` §Opera Cloud (A4) — "App must function standalone first. Two-way sync hardening deferred." (this phase resolves the pilot-gating half of this note)
- `CLAUDE.md` §Non-Regression Policy and §Self-Verification Policy (MANDATORY sections) — govern how the audit's fixes and verification must be conducted

### Precedent — how prior phases handled the same pattern
- `.planning/phases/04-maintenance-and-housekeeping-programs/04-01-PLAN.md` + `04-01-SUMMARY.md` — Phase 4's S0 slice: audit-first pattern for a pre-existing, unverified scaffold (route-test harness, RBAC/read-gate/None-guard fixes, DB immutability proof) before any new feature work. Structural template for this phase's audit slice.
- `.planning/phases/02-evidence-foundation/02-VALIDATION.md` and the migration-079 fix referenced in `.planning/STATE.md` (Phase 2 section) — precedent for "fix-in-place" security findings (SECURITY DEFINER grants revoked from `anon`/`authenticated`, granted to `service_role` only).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/tests/` existing suites (e.g. `test_operational_programs.py`, Phase 1–5 RBAC/tenant-isolation test patterns) — copy the established test structure/fixtures rather than inventing a new one for AI copilot / Opera tests.
- Opera integration already has conflict list/resolve endpoints (`/opera/conflicts`, `/opera/conflicts/{id}/resolve`) — the "two-way sync hardening" work may be substantially done already; audit should confirm rather than assume it needs building.

### Established Patterns
- SECURITY DEFINER RPC grant discipline (Phase 2/3 convention): revoke `anon`/`authenticated`/`PUBLIC`, grant `service_role` only. Apply this check to any RPC touched during the Opera/AI audit.
- Tenant scoping convention: every Supabase query `.eq("hotel_id", user.hotel_id)`. Verify this holds in `ai_copilot.py`'s new-since-Phase-0 code paths and throughout `services/opera/`.

### Integration Points
- `ai_copilot.py` and `integrations.py` both sit outside the Phase 0–5 milestone's routers — they were never touched by any of the 6 closed phases' RBAC/tenant-isolation hardening passes, so assume nothing about their current safety beyond what this audit confirms.

</code_context>

<specifics>
## Specific Ideas

No specific UI/UX requests from this discussion — it is an audit/hardening phase, not a design phase. The "how it should behave" is already defined by the two already-implemented backlog docs; this phase verifies that behavior is correct and safe, not redesigns it.

</specifics>

<deferred>
## Deferred Ideas

- **New AI/PMS capabilities beyond what's shipped** — explicitly deferred by the user's "audit-first" scope choice. Once this phase closes with a verified, tested, safely-gated AI+Opera surface, a future phase can define genuinely new capabilities on top of it.
- **Mobile voice input parity/testing** — already code-complete (`expo-speech-recognition` in `apps/mobile`) but mobile work remains parked project-wide per `.planning/PROJECT.md` Out of Scope and `.planning/ROADMAP.md` Deferred Backlog. Not part of this phase's web/API audit.
- **Formal "two successful pilot hotels" business criteria** — this phase builds the *mechanism* (Opera pilot flag) but does not define or track the business-side pilot success metrics themselves; that's a GM/product decision, not an engineering one.

</deferred>

---

*Phase: 6-PMS and AI expansion*
*Context gathered: 2026-07-28*
