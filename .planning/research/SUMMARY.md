# Project Research Summary

**Project:** PatelRep — v1.4 "Platform and Ops Hardening"
**Domain:** Maintenance/hardening pass on an existing production multi-tenant FastAPI + Next.js + Expo SaaS (no ORM, Supabase-backed) — NOT a new-feature milestone
**Researched:** 2026-08-04
**Confidence:** HIGH

## Executive Summary

v1.4 has five work items — Expo SDK 54→57, FastAPI RBAC-check normalization, two CLAUDE.md doc-drift fixes, test-data hygiene on the shared dev/QA Supabase project, and closing ~5 deferred human-verification items from v1.3 — and all five are maintenance on code that already exists, not new architecture to design. The most important finding across all four research files is that RBAC "normalization" is not a style pass, it's a bug hunt: `guest_requests.py` has an unguarded `DELETE` endpoint (any authenticated hotel user, including a housekeeper, can permanently delete a guest request), `hotels.py`'s `ALL_STAFF_ROLES` lists `"engineer"` twice while omitting `"chief_engineer"` entirely, and `MANAGER_ROLES` is independently defined with two different memberships in `programs.py` vs. `safety.py`. Scope the RBAC work narrowly to the three inline-only routers (`guest_requests.py`, `lost_found.py`, `auth.py`) plus a pre-refactor audit of existing constants, not a blanket sweep of all 30 routers.

The recommended approach is: fix the two isolated doc-drift items first (zero dependencies, unblocks nothing but costs nothing); do RBAC normalization second, scoped to the confirmed gaps and preceded by an audit-and-diff step (never merge same-named constants without comparing contents); re-verify the deferred v1.3 items third, against the post-RBAC-fix code since three of the five items share files with the RBAC pass; do dev-DB cleanup fourth (independent, but before final re-verification so stale test data doesn't contaminate a browser check); and do the Expo bump last and hop-by-hop, since it's the highest-risk, most isolated item and a rollback shouldn't block the other four.

Key risks are all "looks-done-but-isn't" traps rather than unknowns: SDK 55 makes New Architecture mandatory while `android/gradle.properties` still has a stale `newArchEnabled=false` override; role-constant consolidation can silently widen or narrow live permissions if same-named constants aren't diffed first; and the shared dev/QA/production Supabase project has zero `is_test` schema support, requiring a human-curated allowlist and an explicit "preserve list" for the team's one standing QA fixture tenant. None require new dependencies — they require sequencing discipline and audit-before-refactor rigor.

## Key Findings

### Recommended Stack

No new technology is introduced. `expo` `~54.0.0` → `57.0.9` must be hopped one SDK at a time (54→55→56→57) — SDK 56 breaks this repo specifically because `expo-router` drops its transitive `@react-navigation/native` dependency while `app/_layout.tsx` imports it directly, requiring it as an explicit dependency before the 55→56 hop. `require_role()` in `apps/api/middleware/auth.py` stays the canonical RBAC mechanism — do not adopt Casbin, Oso, or Permit.io; overkill for 6 fixed roles + `hotel_id` tenant scoping. `expo-speech-recognition` (community package) changes its own versioning scheme to align with Expo SDK numbers from SDK 56 — verify its resolved version manually post-bump. No new npm/pip packages needed for RBAC, doc fixes, or test-data cleanup — all zero-new-dependency, in-repo refactors.

**Core technologies:**
- `expo`/`react-native`/`react`: version bump only (57.0.9 / 0.86.x / 19.2.x) — no API rewrite, hop-by-hop with EAS build gate at each step
- `require_role()`: extend and apply consistently, do not replace with a policy engine
- `core/roles.py` (new, small): single source of truth for role-group constants — the actual missing piece, not a new library

### Expected Practices (reframed — this milestone has no user-facing features)

**Must have:**
- Audit script inventorying every role check per router, classified route-gate vs. object-level, before any consolidation
- Consolidated role-group constants fixing the confirmed `MANAGER_ROLES` drift and `ALL_STAFF_ROLES` duplicate/missing-role bug
- `require_role()` applied to confirmed gaps — starting with `guest_requests.py`'s ungated `DELETE`
- Named object-level-check helper, kept separate from route-level RBAC
- Test-tenant tagging (`is_test` flag) + cleanup script scoped to an explicit human-reviewed `hotel_id` allowlist with mandatory dry-run
- Direct edits to the two stale CLAUDE.md claims (cron mechanism, credentials)

**Should have (second wave, not required for v1.4):**
- Auto-generated route × role permission matrix
- CI lint rule blocking new bare role comparisons
- Targeted CI checks defending the two corrected doc facts

**Defer:**
- Soft-delete + pg_cron scheduled hard-delete
- External policy engine — only if role/policy complexity grows substantially
- Separate staging Supabase project — deliberate current-state constraint

### Architecture Approach

All five items are hardening passes with no new component design. The critical finding is file-level blast-radius overlap: RBAC normalization and the deferred v1.3 verification closures collide on `staff.py`, `scheduling.py`, `work_orders.py`, and `guest_requests.py`. This dictates sequencing — re-verifying deferred items before RBAC fixes land risks signing off on behavior the RBAC fix then changes underneath it.

**Major components (existing, not new):**
1. `apps/api/middleware/auth.py` — home for `require_role()` and consolidated role-group constants (no new `services/` module)
2. `apps/api/routers/{guest_requests,lost_found,auth}.py` — the actual RBAC normalization scope (inline-only routers)
3. `apps/mobile/{app.json, android/gradle.properties, babel.config.js}` — isolated from API/web; internally highest-risk due to a stale New-Architecture override
4. Shared dev Supabase project (`oacnwalhcpqdabivweki`) — backs local dev, mobile dev, and manual QA simultaneously; no schema-level test flag exists today

### Critical Pitfalls

1. **SDK 55 makes New Architecture mandatory while a stale local override (`android/gradle.properties: newArchEnabled=false`) still exists** — reconcile with `app.json`'s `newArchEnabled: true` before any version bump lands.
2. **A shared constant name already means two different role sets** (`MANAGER_ROLES` differs between `programs.py` and `safety.py`) — diff contents before merging; treat every collision as a product decision to confirm, not a bug to auto-fix.
3. **A role is duplicated and another silently dropped inside one constant** (`hotels.py`'s `ALL_STAFF_ROLES`) — write an audit test asserting no duplicates and full coverage before refactoring.
4. **Normalizing to role-only checks can strip co-located business-rule authorization** — `evidence.py` already had this incident (bug-444); classify role-membership vs. business-state-validity before touching any route.
5. **No `is_test`/`is_demo` schema flag exists anywhere** — cleanup must use a human-curated `hotel_id` allowlist (never a name-pattern heuristic), plus an explicit preserve-list naming the standing QA fixture tenant.

## Implications for Roadmap

Suggested phase structure, five phases, sequenced by file-overlap and risk-isolation:

### Phase 1: Documentation Drift Fixes
**Rationale:** Fully isolated, already fully diagnosed, costs nothing to do first.
**Delivers:** Corrected CLAUDE.md cron-mechanism section (APScheduler, not GitHub Actions), corrected credentials claim (narrow to the two AI keys), and the router-count drift fix (30 routers exist vs. fewer documented).
**Addresses:** Both confirmed stale claims.
**Avoids:** N/A — no dependencies, blocks nothing.

### Phase 2: RBAC Audit and Normalization
**Rationale:** Must land before deferred-verification closures — three of those five items share files with this pass. Must start with audit/diff, per the constant-collision pitfalls, before any consolidation code is written.
**Delivers:** (a) audit script classifying every role check; (b) diffed, consolidated role-group constants fixing `MANAGER_ROLES` and `ALL_STAFF_ROLES`; (c) `require_role()` applied to confirmed gaps in `guest_requests.py` and `lost_found.py`; (d) a named object-level-check helper.
**Addresses:** All P1 RBAC items.
**Avoids:** Constant collisions, duplicate/missing roles, stripped business-rule checks, cross-surface call-site regressions.

### Phase 3: Close Deferred v1.3 Verification Items
**Rationale:** Re-verify against post-RBAC-fix code, not current code. Confirmed count is 5 items (not the ~10 estimated), concentrated in v1.3 Phases 15 and 17.
**Delivers:** Browser-verified closure of: Archive-button role visibility; NULL `full_name` fallback rendering; Guest Request drawer status-advance flow; Inspections re-assign picker; migration `091_ai_interactions_widen_interaction_type.sql` applied to remote Supabase.
**Addresses:** The "closing deferred human-verification items" scope line.
**Avoids:** Re-marking items verified from code review alone instead of an actual browser click-through.

### Phase 4: Dev/QA Test-Data Hygiene
**Rationale:** Independent of the other four, but should run before or alongside Phase 3 so stale data doesn't confuse a browser check.
**Delivers:** (a) schema-level `is_test BOOLEAN NOT NULL DEFAULT false` column; (b) human-reviewed `hotel_id` delete-allowlist plus a preserve-list naming the standing QA fixture tenant; (c) cleanup script with mandatory dry-run, transaction-scoped deletes, explicit exclusion of append-only `controlled_incidents`/`controlled_incident_events` tables.
**Uses:** Supabase MCP `list_tables`/`get_advisors` for a pre-cleanup snapshot.
**Implements:** The allowlist-first pattern.

### Phase 5: Expo SDK 54→57 Bump
**Rationale:** Fully isolated from the other four, but the single highest-risk item — sequenced last so a rollback doesn't block other phases.
**Delivers:** Three explicit per-hop upgrades (54→55, 55→56, 56→57), each with `expo-doctor`, `npx jest`, type-check, and a full EAS cloud build gate. Includes reconciling the New-Architecture-flag divergence before the first hop, adding `@react-navigation/native` explicitly during the 55→56 hop, re-validating the `dynamic-import-node` Hermes workaround and `legacy-peer-deps` post-bump, and confirming `expo-speech-recognition`'s resolved version.
**Uses:** Version targets from stack research; `npx expo-codemod sdk-56-expo-router-react-navigation-replace` for the SDK 56 hop.

### Phase Ordering Rationale

- Doc-drift first because it's free and fully independent.
- RBAC before deferred-verification closure because of a direct file-overlap dependency — verifying against pre-fix code invalidates the verification once the RBAC fix lands.
- Test-data cleanup can run in parallel with or slightly before Phase 3, being file-independent but data-adjacent.
- Expo bump last because it has zero cross-item file overlap and the highest standalone risk — isolating it means a difficult bisection doesn't stall unrelated hardening work.

### Research Flags

Needs research: Phase 2 (RBAC — per-route classification is close to a planning deliverable itself, budget explicit audit time), Phase 5 (Expo — `expo-codemod` behavior on this repo's own direct `@react-navigation/native` imports is unverified, worth a dry-run spike).

Standard patterns (skip research-phase): Phase 1 (doc-drift, fully diagnosed), Phase 3 (deferred-verification closure, standard browser click-through against documented repro steps), Phase 4 (test-data cleanup, well-established allowlist+dry-run+transaction pattern).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Current repo state read directly; Expo SDK 55/56/57 changelogs fetched from official sources; RBAC library landscape MEDIUM (WebSearch synthesis) but corroborated across sources and direct code inspection |
| Features | MEDIUM-HIGH | Codebase findings (role drift, missing test-data flag) HIGH, direct inspection; external best-practice framing MEDIUM, synthesized from multiple WebSearch sources with no single authoritative spec |
| Architecture | HIGH | Almost entirely direct repo inspection across 30 router files, `app.json`/`eas.json`, and v1.3 verification files — strongest-sourced of the four |
| Pitfalls | HIGH (RBAC/test-data), MEDIUM (Expo native-module risk) | RBAC/test-data grounded in live code + `.wolf/buglog.json` first-party incidents; Expo New-Arch-mandatory fact verified directly, general SDK 56/57 native-module risk WebSearch-corroborated only |

**Overall confidence:** HIGH

### Gaps to Address

- Deferred-item count discrepancy: brief estimated "~10," direct read of verification files found 5 — confirm with whoever produced the original estimate before finalizing Phase 3 scope.
- `expo-codemod sdk-56-expo-router-react-navigation-replace` coverage on this repo's direct `@react-navigation/native` imports is unverified — dry-run before relying on it.
- `--legacy-peer-deps` necessity post-bump unverified by upstream docs — re-test at each hop, don't assume.
- `_ensure_housekeeper()`'s owning router unspecified (deferred item #4) — confirm location before re-verification to know if it overlaps RBAC work.
- EAS cloud image Node-version floor unconfirmed — `eas.json` has no explicit node pin; confirm before first post-bump cloud build.

## Sources

### Primary (HIGH confidence)
- Direct repo inspection: `apps/api/middleware/auth.py`, `apps/api/routers/*.py` (30 files), `apps/mobile/{package.json,app.json,eas.json,babel.config.js,android/gradle.properties,.easignore}`, `supabase/migrations/070_texas_safety_compliance.sql`, `apps/api/core/scheduler.py`, `.planning/phases/{15,16,17}-*/*-VERIFICATION.md`, `CLAUDE.md`
- Expo SDK 55/56/57 official changelogs (expo.dev/changelog)
- Expo upgrade walkthrough docs, Expo New Architecture guide (docs.expo.dev)
- Supabase official docs: data-deletion guide, testing overview
- `.wolf/buglog.json` first-party incident history (bug-277, bug-403, bug-444, Mobile EAS Android CNG archive rule, tar v7 pinning, dynamic-import-node fix)

### Secondary (MEDIUM confidence)
- WebSearch synthesis on 2026 FastAPI RBAC best practices (permit.io, app-generator.dev, DeepWiki, PropelAuth, Medium)
- WebSearch synthesis on multi-tenant test-data hygiene and doc-drift CI patterns (GoMask, QATestLab, AgentPatterns.ai, understandingdata.com, Dosu, Koder.ai)
- jamsch/expo-speech-recognition release notes (maintainer versioning-scheme note, cross-checked)

### Tertiary (LOW confidence)
- OsoHQ Permit.io alternatives comparison, AgentLint CLAUDE.md best-practices blog — corroboration only, not primary basis for any recommendation

---
*Research completed: 2026-08-04*
*Ready for roadmap: yes*
