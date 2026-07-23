---
phase: 04-maintenance-and-housekeeping-programs
verified: 2026-07-23T19:19:56Z
status: gaps_found
score: 30/34 must-haves verified
overrides_applied: 0
gaps:
  - truth: "The bilingual floor contract (D-03 locked scope) covers housekeeping, engineering/work-orders, and tasks"
    status: failed
    reason: >
      D-03 (04-CONTEXT.md, locked, not discretionary) explicitly names "housekeeping,
      engineering / work-orders, tasks, PM completion, deep-clean, DND" as in-scope for
      EN/ES coverage, and 04-08-PLAN.md's own must_haves truth #1 repeats "work-orders,
      tasks" verbatim. What actually shipped: PM completion (PMCompletionModal.tsx),
      the PM schedules page, the new Phase-4 housekeeping *program-depth* panels
      (HousekeepingDepthPanels/DeepCleanAreasPanel/InspectionDepthPanel), and one small
      subcomponent (WorkOrderCard.tsx) are bilingual. But the actual daily-use floor
      screens named by D-03 are not: `components/housekeeping/**` (RoomStatusBoard.tsx,
      RoomCard.tsx, RoomDetailDrawer.tsx, InspectionModal.tsx, AssignmentSidebar.tsx,
      OccupancyImportModal.tsx, PredictionPanel.tsx — 7 files, 0 use `useTranslation`,
      confirmed via grep), the work-order list/create/detail surfaces
      (WorkOrderList.tsx, CreateWorkOrderModal.tsx, WorkOrderDetailDrawer.tsx,
      FailurePredictionSidebar.tsx, EngineeringRoomBoard.tsx — 0 `useTranslation`), and
      `app/(dashboard)/tasks/page.tsx` (0 `useTranslation`). The scoped ESLint
      `i18next/no-literal-string` gate only covers the 6 files that were translated, so
      it provides zero protection against new hardcoded English landing on these
      still-100%-English floor surfaces going forward. 04-08's own `deferred-items.md`
      discloses this narrowing transparently, but the phase's own goal statement
      ("enforce the bilingual floor contract") and D-03's locked scope were not fully
      met — Room Status Board / Room Card / Inspection Modal in particular are the
      actual high-traffic daily housekeeping screens (one of only three Realtime
      surfaces per CLAUDE.md), not a peripheral surface.
    artifacts:
      - path: "apps/web/components/housekeeping/RoomStatusBoard.tsx"
        issue: "0 useTranslation usage — entirely English"
      - path: "apps/web/components/housekeeping/RoomCard.tsx"
        issue: "0 useTranslation usage — entirely English"
      - path: "apps/web/components/housekeeping/RoomDetailDrawer.tsx"
        issue: "0 useTranslation usage — entirely English"
      - path: "apps/web/components/housekeeping/InspectionModal.tsx"
        issue: "0 useTranslation usage — entirely English"
      - path: "apps/web/components/engineering/WorkOrderList.tsx"
        issue: "0 useTranslation usage — entirely English"
      - path: "apps/web/components/engineering/CreateWorkOrderModal.tsx"
        issue: "0 useTranslation usage — entirely English"
      - path: "apps/web/components/engineering/WorkOrderDetailDrawer.tsx"
        issue: "0 useTranslation usage — entirely English"
      - path: "apps/web/app/(dashboard)/tasks/page.tsx"
        issue: "0 useTranslation usage — entirely English"
    missing:
      - "Translate components/housekeeping/** (the actual floor screens housekeepers use daily)"
      - "Translate WorkOrderList.tsx, CreateWorkOrderModal.tsx, WorkOrderDetailDrawer.tsx, FailurePredictionSidebar.tsx, EngineeringRoomBoard.tsx"
      - "Translate app/(dashboard)/tasks/page.tsx"
      - "Widen eslint.config.mjs's no-literal-string files glob to cover the above once translated, per deferred-items.md's own follow-up plan"
human_verification:
  - test: "Confirm migrations 081 (pm_evidence_linkage) and 083 (program_template_facilities) are actually applied to the production Supabase project (oacnwalhcpqdabivweki)"
    expected: "pg_constraint for evidence_records_related_entity_type_check includes 'pm_completion'; property_applicability_facilities_canonical and controlled_documents_applicability_canonical include 'backflow' and 'domestic_water'"
    why_human: >
      This verifier session has no Supabase MCP tool available, so live production DB
      state cannot be queried directly. Every executor SUMMARY that wrote these
      migrations (04-02, 04-04) explicitly states they were NOT applied from their
      worktree (no MCP/DB credentials available there). The orchestrator's handoff
      message to this verifier claims both were applied and confirmed via
      `list_migrations` during a later session, but neither `.wolf/memory.md` nor
      `.planning/STATE.md` contains a corroborating log entry — contrast with migration
      080 (Phase 3), which has an explicit "Applied migration 080 to prod via Supabase
      MCP; verified RLS+RPC grants" line in memory.md. Until independently confirmed,
      a production PM completion submitted with photo/certificate evidence, or a
      tenant configuring backflow/domestic_water facilities, could 500 against the
      pre-081/083 CHECK constraints.
  - test: "Re-run apps/web/e2e/phase4-programs.spec.ts test 3 ('Housekeeping deep-clean and DND welfare policy panels translate EN <-> ES at 390px') against a running dev server"
    expected: "Both EN and ES headings ('Deep-clean schedules' / 'Programas de limpieza profunda', 'DND welfare timing & escalation policy' / 'Tiempo de bienestar DND y política de escalamiento') become visible for the GM test account"
    why_human: >
      This verifier ran the suite live (PLAYWRIGHT_BASE_URL=http://localhost:3000,
      GM test account) and observed: test 1 PASSED (proves genuine EN/ES divergence
      on the PM Schedules page), test 2 FAILED on a test-authoring bug (strict-mode
      locator ambiguity on getByText('Verifier'), which matches both the field label
      and an unrelated <option> — not a product defect; the label itself is confirmed
      present), and test 3 self-skipped ("This account/role does not render the
      manager-gated housekeeping depth panels") despite using the same GM account that
      04-07's SUMMARY reports successfully exercising these exact panels manually.
      This looks like a client-side role-resolution race (the test checks
      `enDeepClean.count()` immediately after a best-effort `networkidle` wait) rather
      than a real access-gate failure, but was not conclusively diagnosed in this
      session.
---

# Phase 4: Maintenance and housekeeping programs Verification Report

**Phase Goal:** Make PM and housekeeping recurring, evidence-backed programs and enforce the bilingual floor contract.
**Verified:** 2026-07-23T19:19:56Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Housekeeper cannot read program overview — 403 | ✓ VERIFIED | `require_role(*MANAGER_ROLES)` on `GET /programs/overview` (programs.py:121); route test passes |
| 2 | chief_engineer can complete a PM and manage programs | ✓ VERIFIED | `chief_engineer` in `MANAGER_ROLES` (programs.py:43) and in assets.py's `create_pm_schedule`/`complete_pm_schedule` gates (assets.py:214,231) |
| 3 | Cross-tenant PM schedule → 404, zero writes | ✓ VERIFIED | `_get_pm_schedule` tenant-scoped `.eq("tenant_id", ...)`; `test_cross_tenant_pm_schedule_404` passes |
| 4 | pm_completion_records/pm_deferrals/deep_clean_occurrences reject UPDATE/DELETE at DB level | ✓ VERIFIED (static + live corroboration) | Trigger SQL present in migration 071:173-179; static test asserts trigger SQL; live corroboration: 04-05's checkpoint DELETE attempt on a real completion record was rejected with "Operational program records are append-only" |
| 5 | maybe_single()→None handled with no AttributeError (bug-449 guard) | ✓ VERIFIED | Guarded reads throughout programs.py/assets.py; `test_maybe_single_none_returns_404_not_500` passes |
| 6 | PM completion photos/certs stored via evidence platform, never raw JSONB URLs | ✓ VERIFIED | `_collect_evidence_ids`/`_validate_tenant_evidence_ids` in execution.py; `CompletePMProgramRequest` fields are evidence_record IDs |
| 7 | PM completion read returns signed URLs only, never public/raw | ✓ VERIFIED | `_resolve_evidence_signed_urls` reuses `evidence.py`'s `_create_evidence_signed_url`; `test_pm_completion_returns_signed_urls` asserts `storage_path` never in response |
| 8 | Evidence from another tenant cannot be attached to a PM completion | ✓ VERIFIED | `test_cross_tenant_evidence_rejected` passes (422, zero completion rows) |
| 9 | evidence_records can link to pm_completion via related_entity_type | ✓ VERIFIED (code) / UNCERTAIN (prod) | Code path complete; migration 081 written correctly but production application unconfirmed — see Gaps/human_verification |
| 10 | PM deferral approval requires a distinct approver | ✓ VERIFIED | `defer_pm_schedule` rejects `approved_by == current_user.user_id` with 422 before any DB write (programs.py:252-256); `test_deferral_self_approval_rejected` passes |
| 11 | Deferral approval writes an append-only audit event with reason code | ✓ VERIFIED | `_record_audit_event(...action="pm_deferral.approved"...)`; `test_deferral_approval_writes_audit` passes |
| 12 | Failed PM check writes containment audit + creates corrective WO with due_at | ✓ VERIFIED | `_record_containment_audit` + `build_corrective_work_order`; `test_failed_check_writes_containment_audit` passes |
| 13 | Corrective WO priority: life_safety→emergency, else urgent, with due_at | ✓ VERIFIED | `CORRECTIVE_WO_SLA_HOURS = {"emergency": 4, "urgent": 24}`; `priority = "emergency" if criticality == "life_safety" else "urgent"` (contracts.py:14,182-183) |
| 14 | Template init gates pool/backflow/domestic-water by property facilities | ✓ VERIFIED (code) / UNCERTAIN (prod) | `GATED_TEMPLATE_FACILITIES` + skip-if-missing-facility logic (programs.py:152-159) correct; migration 083 (canonical facility allowlist) application to prod unconfirmed |
| 15 | Manager can edit a template's frequency and checklist items | ✓ VERIFIED | `PUT /programs/templates/{id}`; `test_edit_template` passes |
| 16 | Manager can create a generic custom template | ✓ VERIFIED | `POST /programs/templates`; `test_generic_builder` passes (incl. 409 on duplicate code) |
| 17 | Named templates seed with real multi-item checklists, not one canned item | ✓ VERIFIED | `DEFAULT_PROGRAM_TEMPLATES` in contracts.py — each of 9 templates has 3-4 real items |
| 18 | PM completion captures versioned checklist results, technician, verifier | ✓ VERIFIED | `PMCompletionModal.tsx` (633 lines) — per-item Pass/Fail/N-A, verifier dropdown; wired to `POST /assets/pm-schedules/{id}/complete` |
| 19 | Technician can attach photos/certs via evidence platform (signed-URL backed) | ✓ VERIFIED | `uploadEvidence()` wraps `evidenceApi.createRecord` + `uploadRecordFile`; confirmed live by 04-05 checkpoint (real signed URL returned on read) |
| 20 | Technician can record measurements, labor, structured parts, defects | ✓ VERIFIED | Dynamic row editors in `PMCompletionModal.tsx` for measurements/meter readings/labor/parts/defects |
| 21 | Evidence-required item cannot be submitted without proof (422 surfaced in UI) | ✓ VERIFIED | Client-side block mirrors server's `EvidenceRequiredError`; server 422 remains authoritative |
| 22 | PM completion verifier must be distinct from technician — enforced server-side (CR-01) | ✓ VERIFIED | `_validate_verifier` in execution.py:32-48, called from `persist_pm_completion`; `test_pm_completion_self_verification_rejected` passes independently re-run |
| 23 | Inspection sample is rule-driven (experience band/room type/risk), not flat | ✓ VERIFIED | `select_inspection_sample` most-specific-rule-wins logic; `test_inspection_sample_rule_driven` passes |
| 24 | Inspection quality trends break down by item/room-type/employee with resolved names (CR-02) | ✓ VERIFIED | `_resolve_quality_trend_names` resolves `room_type_id`→name, `inspected_by`→preferred/full name (programs.py:399-429); `test_inspection_quality_resolves_room_type_and_employee_names` passes independently re-run |
| 25 | Deep-clean schedules and public areas fully creatable/listable/completable via API | ✓ VERIFIED | `GET/POST /programs/deep-clean-schedules`, `GET/POST /programs/public-areas`, `POST .../complete`; tenant-scoping route test passes |
| 26 | Manager can configure DND welfare timing + documented escalation policy from web | ✓ VERIFIED | DND policy form in `HousekeepingDepthPanels.tsx`; confirmed live (04-07 checkpoint: threshold+instructions persisted across reload) |
| 27 | DND welfare cron reads per-property policy threshold/roles, dedups per window | ✓ VERIFIED | `internal.py` `escalations/check` reads `dnd_welfare_policies.threshold_hours`/`escalation_roles`; `should_create_dnd_escalation` dedup test passes |
| 28 | Manager can create/list deep-clean schedules + public areas from web with next-due dates | ✓ VERIFIED | `DeepCleanAreasPanel.tsx`; confirmed live (04-07 checkpoint) |
| 29 | Linen/chemical/amenity par shortages surface as a passive dashboard badge | ✓ VERIFIED | `build_supply_alerts` in overview response; confirmed live (badge appeared correctly, no cron/notification row per design) |
| 30 | Manager can set stayover linen rules + inspection sampling rules from web | ✓ VERIFIED | Forms in `HousekeepingDepthPanels.tsx` / `InspectionDepthPanel.tsx`; confirmed live |
| 31 | PM completion, deep-clean, DND config render in EN and ES | ✓ VERIFIED | `en.ts`/`es.ts` both 347 lines with matching `programs.*` namespaces; Playwright test 1 (PM Schedules page) passed live against localhost with genuine EN≠ES divergence |
| 32 | A raw user-facing literal in a floor-facing directory fails `npm run lint` | ⚠️ PARTIAL | Gate fires correctly on word-like literals (`verify-i18n-gate.mjs` proof passes); but 2 live non-word-shaped literals (`"e.g. 45"`, a UUID placeholder pattern) in gate-covered files pass lint uncaught — see Gaps |
| 33 | GM-facing analytics/config/inspector-export dirs stay English and are allowlisted | ✓ VERIFIED | `verify-i18n-gate.mjs` negative case confirms GM/reports path stays exempt |
| 34 | The bilingual floor contract (D-03: housekeeping, work-orders, tasks) is fully covered | ✗ FAILED | See Gaps — only PM completion/schedules/new program-depth panels + WorkOrderCard are bilingual; `components/housekeeping/**`, work-order list/create/detail, and the tasks page remain 100% English |

**Score:** 30/34 truths verified (2 code-verified with unconfirmed prod migration state, 1 partial, 1 failed)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/tests/test_programs_routes.py` | Route-test harness | ✓ VERIFIED | 23 tests, all pass |
| `apps/api/routers/programs.py` | RBAC + template + inspection + DND routes | ✓ VERIFIED | Wired, tested |
| `apps/api/services/programs/execution.py` | PM completion persistence, verifier validation, evidence linkage | ✓ VERIFIED | `_validate_verifier`, `_validate_tenant_evidence_ids`, `_link_evidence_to_completion` all present |
| `apps/api/services/programs/contracts.py` | Pure sampling/aggregation/template functions | ✓ VERIFIED | `select_inspection_sample`, `aggregate_inspection_quality`, `DEFAULT_PROGRAM_TEMPLATES`, `GATED_TEMPLATE_FACILITIES` |
| `supabase/migrations/081_pm_evidence_linkage.sql` | pm_completion evidence-linkage constraint | ✓ VERIFIED (file) / UNCERTAIN (applied to prod) | File correct per structural review; live application unconfirmed |
| `supabase/migrations/083_program_template_facilities.sql` | backflow/domestic_water facility gating | ✓ VERIFIED (file) / UNCERTAIN (applied to prod) | File correct; live application unconfirmed |
| `apps/web/components/engineering/PMCompletionModal.tsx` | Defensible PM completion capture form | ✓ VERIFIED | 633 lines, wired into pm-schedules/page.tsx, bilingual |
| `apps/web/components/programs/HousekeepingDepthPanels.tsx` + siblings | HK depth UI | ✓ VERIFIED | 245/237/183 lines, wired into (dashboard)/programs, bilingual |
| `apps/web/i18n/locales/{en,es}.ts` | Bilingual floor coverage | ⚠️ PARTIAL | Full parity for the surfaces they cover; those surfaces are narrower than D-03's locked scope |
| `apps/web/eslint.config.mjs` | Scoped no-literal-string gate | ⚠️ PARTIAL | Fires correctly on covered files/word-like literals; scope narrower than D-03; 2 literal-shape blind spots found |
| `apps/web/playwright.phase4.config.ts` + `e2e/phase4-programs.spec.ts` | EN/ES 390px coverage | ⚠️ PARTIAL | 1/3 tests passed live; 1 failed on a test-authoring locator bug (not a product defect); 1 self-skipped (see human_verification) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `programs.get_program_overview` | `require_role(*MANAGER_ROLES)` | Depends | ✓ WIRED | Confirmed in source |
| `persist_pm_completion` | `evidence_records` | tenant-ownership validation | ✓ WIRED | `_validate_tenant_evidence_ids` runs before insert |
| `defer_pm_schedule` | `operational_audit_events` | `pm_deferral.approved` audit | ✓ WIRED | Confirmed + tested |
| `persist_pm_completion` failed item | `operational_audit_events` | containment audit write | ✓ WIRED | Confirmed + tested |
| `initialize_property_templates` | `property_applicability.facilities` | facility gating | ✓ WIRED | Confirmed + tested |
| `PMCompletionModal` | `POST /assets/pm-schedules/{id}/complete` | typed client | ✓ WIRED | Confirmed live (04-05 checkpoint) |
| `HousekeepingDepthPanels`/siblings | `/programs/*` routes | typed clients, shared React Query key | ✓ WIRED | Confirmed live (04-07 checkpoint) |
| `internal.py escalations/check` DND block | `dnd_welfare_policies.threshold_hours` | per-property policy read | ✓ WIRED | Read-confirmed, not rebuilt (04-07) |
| floor components (housekeeping, work-orders, tasks) | `useTranslation()/t()` | react-i18next keys | ✗ NOT WIRED | 0 usage in `components/housekeeping/**`, work-order list/create/detail, `tasks/page.tsx` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full API test suite | `pytest tests/ -q` | 341 passed | ✓ PASS |
| CR-01 regression test | `pytest -k self_verification_rejected` | 1 passed | ✓ PASS |
| CR-02 regression test | `pytest -k resolves_room_type_and_employee` | 1 passed | ✓ PASS |
| Web type-check | `npm run type-check` | clean | ✓ PASS |
| Web lint (incl. i18n gate) | `npm run lint` | clean | ✓ PASS |
| i18n gate proof fixture | `node scripts/verify-i18n-gate.mjs` | both assertions pass | ✓ PASS |
| Phase4 Playwright EN/ES 390px suite (live, localhost) | `npx playwright test --config=playwright.phase4.config.ts` | 1 passed, 1 failed (test bug), 1 self-skipped | ⚠️ PARTIAL |

### Requirements Coverage

Phase 4 uses informal behavior labels (PM-XX/HK-XX/BL-XX) and gap/decision IDs (G1-G12, D-01-D-13) instead of formal REQ-XXX IDs, tracked in 04-CONTEXT.md/04-VALIDATION.md.

| Label | Description | Status | Evidence |
|-------|-------------|--------|----------|
| G1/D-06 | Evidence platform for PM attachments | ✓ SATISFIED | Truths 6-9 |
| G2 | Audit events on deferral/containment | ✓ SATISFIED | Truths 11-12 |
| G4 | Deferral distinct-approver | ✓ SATISFIED | Truth 10 |
| G5/D-05/PM-08 | Applicability-gated PM templates | ✓ SATISFIED (code) / UNCERTAIN (prod) | Truth 14 |
| G6 | Overview read gate | ✓ SATISFIED | Truth 1 |
| G7 | chief_engineer role coverage | ✓ SATISFIED | Truth 2 |
| G8 | Corrective WO priority/due_at/audit | ✓ SATISFIED | Truths 12-13 |
| G11/HK-02/HK-03 | Inspection sampling + multi-dimension quality | ✓ SATISFIED | Truths 23-24 |
| G12/HK-01 | Deep-clean/public-area API completeness | ✓ SATISFIED | Truth 25 |
| G3 | Defensible PM completion capture UI | ✓ SATISFIED | Truths 18-21 |
| HK-04/05/06 | DND policy, par alerts, stayover from web | ✓ SATISFIED | Truths 26,29,30 |
| BL-01/BL-02/D-03/D-04 | Bilingual floor contract + CI gate | ✗ NOT SATISFIED (full scope) | Truth 34 — narrower than locked scope |
| BL-03 | EN/ES 390px Playwright verification | ⚠️ PARTIAL | See Behavioral Spot-Checks |
| D-09 | SECURITY DEFINER RPC discipline | ✓ SATISFIED (no new SECURITY DEFINER RPCs introduced this phase) | Migrations 081/083 add no functions/triggers, only CHECK constraints |
| D-10 | Cron via internal.py + cron_health | ✓ SATISFIED | Reused existing `/pm/check-due`, `escalations/check` |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/web/components/engineering/PMCompletionModal.tsx` | 472 | Hardcoded literal `placeholder="e.g. 45"`, not wrapped in `t()` | ⚠️ Warning | Slips past the ESLint gate's word-shape heuristic; minor (form hint text, not core copy) |
| `apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx` | 389 | Hardcoded literal `placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"` | ⚠️ Warning | Same gate blind spot; minor (UUID-format hint) |
| `apps/web/components/housekeeping/**` (7 files) | — | Zero `useTranslation` usage on core daily floor screens | 🛑 Blocker | Directly contradicts D-03 locked scope and phase goal |
| `apps/web/components/engineering/{WorkOrderList,CreateWorkOrderModal,WorkOrderDetailDrawer}.tsx` | — | Zero `useTranslation` usage | 🛑 Blocker | Directly contradicts D-03 locked scope ("work-orders") |
| `apps/web/app/(dashboard)/tasks/page.tsx` | — | Zero `useTranslation` usage | 🛑 Blocker | Directly contradicts D-03 locked scope ("tasks") |
| `.planning/ROADMAP.md` | 105 | Progress table still shows "4. Maintenance and housekeeping programs \| 0/8 \| Planned — awaiting review gate (D-12)" | ℹ️ Info | Stale tracking; all 8 plan checkboxes above are `[x]` and code is committed |
| `.planning/STATE.md` | 5-12 | `status: Executing Phase 04`, `completed_phases: 1`, `last_updated: 2026-07-22` | ℹ️ Info | Stale tracking, predates this session's commits |

### Human Verification Required

See YAML frontmatter `human_verification` — condensed:

1. **Confirm migrations 081/083 are live in production** (no Supabase MCP tool available to this verifier; executor SUMMARYs say not applied from their worktrees; orchestrator claims applied but no corroborating STATE.md/memory.md entry exists).
2. **Re-run `phase4-programs.spec.ts` test 3** to determine whether the self-skip on `/programs` housekeeping-depth panels is a genuine role-gating problem or (more likely, given 04-07's own successful manual walkthrough with the same account) a client-side role-resolution race in the test's immediate `.count()` check.

### Gaps Summary

The PM/housekeeping *programs* half of Phase 4's goal — defensible, evidence-backed PM completions, deferral separation-of-duty, corrective-WO hardening, applicability-gated templates, rule-driven inspection sampling, multi-dimension quality trends (with the CR-01/CR-02 code-review fixes both confirmed present and independently re-tested), and the full housekeeping program-depth UI — is solidly built, wired, and tested (341/341 API tests, clean web type-check/lint, i18n gate proof passing).

The **bilingual floor contract** half of the goal is only partially achieved. D-03 (a locked CONTEXT.md decision) explicitly named "housekeeping, engineering / work-orders, tasks" as in-scope, and 04-08-PLAN.md's own must-have truth repeats this. What shipped covers PM completion, the PM schedules page, the new program-depth panels, and one small work-order subcomponent — but the actual daily-use housekeeping floor screens (`components/housekeeping/**`, including the Room Status Board that's one of only three Realtime-enabled surfaces in this codebase), the work-order list/create/detail flow, and the tasks page remain entirely in English, with no CI gate protecting them from further drift. This was transparently disclosed by 04-08 in `deferred-items.md`, but from a goal-backward standpoint it means Phase 4's stated goal is not fully met as written, and neither Phase 5 nor Phase 6 in ROADMAP.md addresses i18n, so this gap is not deferred to a later phase — it needs its own follow-up plan before Phase 4 can be considered fully closed against its own locked decisions.

Two secondary, non-blocking issues were also found: a narrow ESLint literal-detection blind spot (2 instances, cosmetic placeholder text) and unconfirmed production-migration state for 081/083 (a deployment fact this verifier's tooling cannot check directly).

---

_Verified: 2026-07-23T19:19:56Z_
_Verifier: Claude (gsd-verifier)_
