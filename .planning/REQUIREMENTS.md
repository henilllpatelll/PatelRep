# Requirements: PatelRep v1.4 — Platform and Ops Hardening

## v1.4 Requirements

### Documentation Accuracy

- [ ] **DOC-01**: CLAUDE.md's Cron Jobs section accurately describes the actual in-process APScheduler mechanism (`apps/api/core/scheduler.py`) instead of GitHub Actions
- [ ] **DOC-02**: CLAUDE.md's Current Scope note narrows the "no local credentials" claim to only the AI provider keys (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`) plus Twilio/OHIP — Stripe (test-mode) and Supabase service-role credentials are confirmed present locally
- [ ] **DOC-03**: CLAUDE.md's Domain Map reflects the actual 30 routers in `apps/api/routers/` (currently missing 9: clean_sessions, cleaning_checklists, evidence, feedback, late_checkout, management_roi, programs, safety, shifts)

### RBAC Audit and Normalization

- [ ] **RBAC-01**: An audit artifact exists inventorying every role check across `apps/api/routers/`, classified as route-level gate vs. object-level/business-rule check
- [ ] **RBAC-02**: `guest_requests.py`'s `DELETE /guest-requests/{id}` endpoint is gated to management roles (currently ungated — any authenticated tenant user, including a housekeeper, can permanently delete a guest request)
- [ ] **RBAC-03**: `lost_found.py` and `auth.py`'s inline-only role checks are reviewed against the audit and any confirmed gaps are closed
- [ ] **RBAC-04**: Duplicated/drifted role-group constants (`MANAGER_ROLES` differing between `programs.py`/`safety.py`; `hotels.py`'s `ALL_STAFF_ROLES` with `"engineer"` duplicated and `"chief_engineer"` missing) are consolidated into a single source of truth, with each collision resolved as an explicit, confirmed product decision — not auto-merged

### Deferred v1.3 Verification Closure

- [ ] **VERIFY-01**: Non-manager roles (housekeeper, front_desk) confirmed live in-browser to not see the "Archive..." button on the Engineering Work Orders page (Phase 15 deferred item)
- [ ] **VERIFY-02**: NULL staff `full_name` renders the "Unnamed Staff" fallback live in-browser across Staff, Scheduling, and Housekeeping pages, no console error (Phase 17 deferred item)
- [ ] **VERIFY-03**: Guest Request drawer status-advance buttons click through end-to-end at each status in the chain and the kanban board reflects the new status (Phase 17 deferred item)
- [ ] **VERIFY-04**: Inspections re-assign picker successfully re-assigns a failed inspection to a `housekeeping_supervisor` end-to-end (Phase 17 deferred item)

### Dev/QA Test-Data Hygiene

- [ ] **QA-01**: `tenants` table gains an `is_test BOOLEAN NOT NULL DEFAULT false` column
- [ ] **QA-02**: A human-reviewed `hotel_id` delete-allowlist and preserve-list is documented, explicitly naming the standing QA fixture tenant(s) to keep
- [ ] **QA-03**: A cleanup script exists that only deletes data scoped to the allowlisted test `hotel_id`s, requires a mandatory dry-run pass before executing, and explicitly excludes append-only tables (`controlled_incidents`, `controlled_incident_events`)

### Mobile Dependency Health

- [ ] **MOBILE-01**: `apps/mobile`'s Expo SDK is upgraded from ~54 to 57.0.9 via sequential single-major hops (54→55→56→57), each gated by `expo-doctor` + `npx jest` + type-check + a green EAS Android cloud build
- [ ] **MOBILE-02**: The New Architecture configuration divergence between `app.json` (`newArchEnabled: true`) and `android/gradle.properties` (`newArchEnabled=false`) is reconciled before the first hop
- [ ] **MOBILE-03**: `@react-navigation/native` is added as an explicit direct dependency before the 55→56 hop (currently relied on transitively via `expo-router`, which drops that transitive dependency at SDK 56)
- [ ] **MOBILE-04**: The remaining 19 `npm audit` advisories in `apps/mobile` (tracked since v1.1, all requiring the SDK 57 major bump) are resolved or explicitly re-documented as accepted risk post-bump

## Future Requirements (Deferred)

- Auto-generated route × role permission matrix — second-wave RBAC tooling, not required for v1.4's scope
- CI lint rule blocking new bare role comparisons — second-wave enforcement, do after the normalization pass establishes the pattern
- Targeted CI checks defending the two corrected doc facts (cron mechanism, credentials) against future drift
- Soft-delete + scheduled hard-delete for test-data cleanup — deferred in favor of the simpler allowlist+dry-run approach for v1.4
- External policy engine (Casbin/Oso/Permit.io) for RBAC — only if role/policy complexity grows substantially beyond the current 6 fixed roles
- Separate staging Supabase project — deliberate current-state constraint, not addressed this milestone

## Out of Scope

- New user-facing features — v1.4 is a pure hardening/ops milestone by explicit scope decision
- Live-credential-dependent AI/Twilio/OHIP flows — `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/Twilio/OHIP credentials remain genuinely absent locally
- iOS EAS build pipeline (IOS-01) — unchanged, still out of scope
- A blanket RBAC sweep of all 30 routers — narrowly scoped to the 3 confirmed inline-only routers (`guest_requests.py`, `lost_found.py`, `auth.py`) plus the confirmed constant-drift bugs, not a mechanical rewrite of the other 27 (11 already clean, 14 are legitimately "mixed" route-gate + object-level checks)
- Migration 091 (`ai_interactions.interaction_type` widening) live-verification — already applied to production and verified via `pg_get_constraintdef` during the v1.3 milestone audit (2026-08-04), not carried forward as a v1.4 item

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DOC-01 | Phase 18 | Pending |
| DOC-02 | Phase 18 | Pending |
| DOC-03 | Phase 18 | Pending |
| RBAC-01 | Phase 19 | Pending |
| RBAC-02 | Phase 19 | Pending |
| RBAC-03 | Phase 19 | Pending |
| RBAC-04 | Phase 19 | Pending |
| VERIFY-01 | Phase 20 | Pending |
| VERIFY-02 | Phase 20 | Pending |
| VERIFY-03 | Phase 20 | Pending |
| VERIFY-04 | Phase 20 | Pending |
| QA-01 | Phase 21 | Pending |
| QA-02 | Phase 21 | Pending |
| QA-03 | Phase 21 | Pending |
| MOBILE-01 | Phase 22 | Pending |
| MOBILE-02 | Phase 22 | Pending |
| MOBILE-03 | Phase 22 | Pending |
| MOBILE-04 | Phase 22 | Pending |

**Coverage:** 18/18 v1.4 requirements mapped. No orphans.
