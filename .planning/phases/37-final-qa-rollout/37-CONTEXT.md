# Phase 37: Final QA & Rollout - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning
**Mode:** Autonomous (user delegated discuss+plan+execute end-to-end for this phase, same as Phase 36; no AskUserQuestion prompts, decisions made from Phases 30-36 precedent + codebase scout) — **with one explicit exception, see the locked "Production flag flip-on" decision below.**

<domain>
## Phase Boundary

QA-01/QA-02/QA-03 + the un-numbered 4th success criterion — Phase 37 is the milestone's cross-cutting closer: it builds ZERO new UI (unlike every phase since 31) and instead re-verifies, end-to-end and with every section simultaneously flagged on, everything the 7 preceding phases (30-36) built incrementally and verified only in isolation or in partial combination. Concretely: (1) a full 6-role navigation walkthrough against the Phase-31 NAV-05 matrix, (2) a full Spanish-locale walkthrough of every redesigned section/dashboard, (3) a final pixel-diff of the 3 excluded Room-Board surfaces, and (4) flipping `tenants.web_redesign_sections` on for all sections — the actual production rollout action.

</domain>

<decisions>
## Implementation Decisions

### QA-01 — 6-role navigation walkthrough

The automated matrix already exists and passed at Phase 31 close-out: `apps/web/lib/utils/navigation.matrix.json` + `apps/web/lib/utils/navigation.test.ts` (node:test, established NAV-05/NAV-06). Confirmed still present and unmodified by any of Phases 32-36 (none of those phases' `files_modified` touch `navigation.ts`/`navigation.matrix.json`). Decision: re-run the existing automated matrix test as a regression check (cheap, deterministic), AND perform a genuinely fresh LIVE 6-role browser walkthrough — this is the first point in the milestone where every one of the ~21 section flags can be ON simultaneously for all 6 roles at once, which no single content phase's close-out ever exercised (each phase only self-verified its own section(s) flagged on, with everything else still flagged off). The live walkthrough's job is specifically to catch cross-section interaction bugs (nav highlighting, breadcrumbs, command-palette search results, shell chrome) that only manifest when ALL sections are v2 simultaneously — not to re-litigate any single section's own already-closed correctness.

### QA-02 — Spanish-locale walkthrough + the bug-965 decision

Every phase since 33 has independently verified its own section's EN/ES parity (via `check:i18n-parity`/`verify:i18n-gate`) and, since Phase 35, via a "dual-method" live check (live-toggle + cold-reload-with-persisted-es). **bug-965** (the `apps/web/i18n/domTranslations.ts` legacy DOM-translator hybrid-mangling defect, affecting `StateBlock` error copy specifically) has been independently confirmed recurring in Phases 34, 35, and 36 close-outs (3 occurrences logged in `.wolf/buglog.json`) and deliberately deferred each time as "systemic, cross-cutting, belongs in its own dedicated i18n hardening phase — not this content phase's job." **Decision: Phase 37 is that dedicated closing gate — QA-02's own bar ("no missing or RAW copy") is arguably already violated by bug-965's English-word-leakage-into-Spanish behavior, so this phase must not defer it a 4th time.** Research/planning should investigate `domTranslations.ts`'s actual mangling mechanism (confirmed root cause per 35/36 SUMMARYs: it partial-glossary-matches individual words in "recovered" original text) and either (a) ship a real, scoped fix if the root cause is tractable within this phase's budget, or (b) if the true fix requires a larger rewrite of the legacy DOM-translation system, explicitly document why it's still being deferred with a strong, specific written justification — a 4th silent "not this phase's job" deferral is not acceptable, but neither is scope-creeping into a full i18n-system rewrite if the actual fix is large. This is the one open technical question this phase's research must resolve before planning commits to an approach.

### QA-03 — Final pixel-diff of the 3 excluded surfaces

`apps/web/e2e/room-board-baseline.spec.ts` already covers exactly the 3 excluded surfaces (`RoomStatusBoard`, `RoomDetailDrawer`, `EngineeringRoomBoard`) established Phase 30, re-run clean at every phase's close-out since (most recently Phase 36: 12/12, zero drift). Decision: re-run it one final time as-is — no new coverage needed, this is confirmation not construction. Difference from every prior re-run: prior re-runs always ran with the CURRENT phase's own section flag toggled and everything else at whatever state the fixture defaults to; THIS run should additionally be exercised once with the regression fixture's `web_redesign_sections` populated with ALL ~21 section keys (simulating post-rollout state) to prove the excluded boards stay pixel-identical even when every surrounding section is simultaneously v2 — not just individually. Restore the fixture to baseline (`[]`) afterward, matching every prior phase's own restore-to-baseline discipline (most recently documented in 36-04-SUMMARY.md).

### Success Criterion 4 — Production flag flip-on — LOCKED, REQUIRES EXPLICIT USER CONFIRMATION

`supabase/migrations/097_web_redesign_sections.sql`'s own column comment states: *"Per-section v2.0 redesign rollout gate... DB/admin-flipped, no GM toggle."* This is a production database write to the LIVE `tenants` table (the same Supabase project this codebase's local `.env` points at, per `.planning/CLAUDE.md`'s "Current Scope" section — there is no separate staging environment) that instantly changes the customer-facing UI for every real, paying hotel tenant simultaneously, with no in-app opt-out for that hotel's GM. This is categorically different from every other action taken across Phases 30-36 (all of which were code/docs/local-dev/scoped-test-tenant writes) and matches the class of action ("modifying shared infrastructure," "visible to others," "hard to reverse in effect even if technically reversible") that requires explicit user confirmation before execution, regardless of this session's standing autonomous-execution authorization for code/planning work.

**Decision: this phase WILL prepare, test, and fully stage the flip-on mechanism (a migration or admin script that sets `web_redesign_sections` to the full ~21-key list for all tenants, or removes the gate default so all tenants read as fully-redesigned) and verify it thoroughly against the test/regression tenants — but will NOT execute it against the real tenant population without pausing to get explicit user go-ahead first.** The plan/execution should get everything ready to ship (migration written, reviewed, dry-run-tested) and treat "get user confirmation, then apply" as the final, distinct, deliberately-gated task — not silently fold it into an "autonomous, no checkpoints" plan like every other Phase 37 task. This is the ONE plan in this phase that should be marked non-autonomous / checkpoint-requiring; every other plan in this phase (walkthroughs, pixel-diff, bug-965 investigation/fix) proceeds fully autonomously per this session's standing instruction.

### Flag-key completeness check

Before flipping anything on, confirm the full section-key list is actually complete and every dashboard route has SOME flag gate (no route silently missing from the rollout list, no orphaned/typo'd flag key). Full list confirmed via codebase grep as of 2026-08-19 (21 keys): `shell`, `dashboard`, `tasks`, `evidence`, `engineering`, `reports`, `managementRoi`, `aiCopilot`, `logbook`, `staff`, `lostFound`, `programs`, `sop`, `scheduling`, `safety`, `guestRequests`, `billing`, `settings`, `guestFeedback`, `integrations`, `housekeeping`. Research should re-confirm this list is exhaustive (re-grep at execution time, since it's a moving target only until this phase closes) and cross-check against ROADMAP's SEC-01/SEC-01b/ENG-01/HSK-01/NAV/HOME section lists to confirm nothing was missed.

### Claude's Discretion

- Exact plan/wave shape — left to planner. Natural shape: one plan per QA criterion (QA-01 walkthrough, QA-02 walkthrough + bug-965 resolution, QA-03 pixel-diff) that can likely run in parallel (they're independent verification passes touching different surfaces), then a final gated "prepare + stage flip-on migration, pause for user confirmation" plan that depends on all three passing.
- Whether bug-965's fix (if tractable) is its own plan or folded into the QA-02 walkthrough plan — planner's call once research determines fix complexity.
- Whether the flip-on mechanism is a new numbered Supabase migration (`098_...sql`) or an idempotent admin script — planner's call, but per the column comment's "DB/admin-flipped" framing, a migration is likely the more consistent-with-precedent choice (all 41 prior schema changes in this project are numbered migrations).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/lib/utils/navigation.matrix.json` + `navigation.test.ts` — Phase 31's automated NAV-05 role×nav visibility matrix, re-runnable as-is.
- `apps/web/e2e/room-board-baseline.spec.ts` — Phase 30's pixel-regression harness, covers exactly the 3 excluded surfaces, re-run clean by every phase since, most recently Phase 36 (12/12).
- `apps/web/lib/utils/redesignFlag.ts` (`isSectionRedesigned`) + `apps/web/stores/hotelStore.ts` + `apps/web/components/shared/Providers.tsx`/`RedesignGate.tsx` — the full flag-read/gate stack, unchanged since Phase 30, used identically by every one of the ~21 gated files.
- `.wolf/buglog.json` bug-965 entries (3 occurrences, Phases 34/35/36) — read these first before re-investigating from scratch; the root cause (`domTranslations.ts` partial-glossary word-matching) is already identified, just not yet fixed.

### Established Patterns
- Dual-method EN/ES verification (live-toggle + cold-reload-with-persisted-es), established Phase 35 after discovering an earlier i18n-mangling bug (bug-1021), reused Phase 36.
- Restore-to-baseline discipline for any tenant flag mutated during testing (`web_redesign_sections` reset to `[]`, documented in every close-out SUMMARY since Phase 30).

### Integration Points
- `apps/api/routers/auth.py` — `/auth/me` selects `web_redesign_sections` from `tenants`, the single source of truth the whole flag system reads from client-side.

</code_context>

<specifics>
## Specific Ideas

No specific visual references — this phase creates no new UI. It re-verifies the v2 visual system already fully specified and built across Phases 30-36.

</specifics>

<deferred>
## Deferred Ideas

- Removing the `web_redesign_sections` column / the `isSectionRedesigned` gate mechanism entirely — explicitly called out in migration 097's own comment as "Removed in the v2.0 cleanup once all tenants migrated" — that is a FUTURE cleanup phase, not this one. Phase 37 flips the flag on; it does not remove the gate code.
- Any new dedicated "i18n hardening phase" for `domTranslations.ts` if Phase 37's research finds bug-965's true fix is too large for this phase's budget — see the locked QA-02 decision above for the exact fallback framing required if this path is taken.
</deferred>

---

*Phase: 37-final-qa-rollout*
*Context gathered: 2026-08-19*
