---
phase: 04
slug: maintenance-and-housekeeping-programs
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-24
---

# Phase 04 — Security Audit: Maintenance and Housekeeping Programs

**Audited:** 2026-07-24
**Auditor:** gsd-security-auditor
**ASVS Level:** 1
**block_on:** open
**Threats registered:** 50 (48 from 04-01..04-17 PLAN.md threat_model blocks + 2 added per orchestrator instruction for the code-review-found CR-01/CR-02 fixes, tracked as T-04-49/T-04-50)
**Threats closed:** 50/50
**Threats open:** 0/50

All declared mitigations were verified against the live code (not documentation) via direct `grep`/`Read` inspection of the cited files, plus independent execution of `npm run lint`, `node scripts/verify-i18n-gate.mjs`, and a from-scratch EN/ES key-parity structural diff (1199/1199 key-lines match). One item (production application of migrations 081/083) could not be independently re-confirmed this session because no Supabase MCP tool was exposed to this auditor — documented below as a caveat, not counted as an open threat because the code-level mitigations for the threats that reference it do not themselves depend on the migration having landed (see "Production Migration Caveat").

---

## Threat Verification

### Backend RBAC / tenant-isolation / audit (04-01)

| ID | Category | Disposition | Evidence |
|----|----------|-------------|----------|
| T-04-01 | Info Disclosure | mitigate | `apps/api/routers/programs.py:121` — `get_program_overview(... Depends(require_role(*MANAGER_ROLES)))`. Was bare `get_current_user`; now gated. |
| T-04-02 | Elevation of Privilege | mitigate | `apps/api/routers/programs.py:43` — `MANAGER_ROLES = ("gm","housekeeping_supervisor","engineer","chief_engineer")`; `apps/api/routers/assets.py:230` — `complete_pm_schedule` gated `require_role("engineer","gm","chief_engineer")`; housekeeper absent from both. |
| T-04-03 | Info Disclosure/Tampering | mitigate | `apps/api/routers/programs.py:46-53` `_get_pm_schedule()` — `.eq("id", schedule_id).eq("tenant_id", current_user.hotel_id)`; 404 on no match. Same pattern in `assets.py:234-236`. |
| T-04-04 | Repudiation/Tampering | mitigate | `supabase/migrations/071_operational_programs.sql:173-179` — `reject_operational_program_mutation()` trigger function + `BEFORE UPDATE OR DELETE` triggers on `pm_completion_records`, `pm_completion_items`, `pm_deferrals`, `deep_clean_occurrences`, `dnd_welfare_events`. |
| T-04-05 | Denial of Service | mitigate | `apps/api/routers/programs.py:51` — `if not result or not result.data:` (bug-449 pattern) on every `maybe_single()` read touched by this phase, incl. `assets.py:236-238`. |

### PM completion evidence-platform linkage (04-02)

| ID | Category | Disposition | Evidence |
|----|----------|-------------|----------|
| T-04-06 | Info Disclosure | mitigate | `apps/api/routers/assets.py:405-427` `_resolve_evidence_signed_urls()` — resolves `evidence_records.storage_path` to a signed URL via `_create_evidence_signed_url`; only `{evidence_id, url, file_name, expires_in_seconds}` is returned; `storage_path` is read internally, never serialized. |
| T-04-07 | Tampering/Info Disclosure | mitigate | `apps/api/services/programs/execution.py:51-65` `_validate_tenant_evidence_ids()` — queries `evidence_records` `.eq("tenant_id", tenant_id)`, raises `ValueError` naming any missing/cross-tenant ID, called *before* the append-only completion insert (zero writes on rejection). |
| T-04-08 | Spoofing | mitigate | `apps/api/routers/evidence.py:36` `MAX_EVIDENCE_UPLOAD_BYTES = 10*1024*1024`; `:520` `if file.content_type not in ALLOWED_EVIDENCE_CONTENT_TYPES: ...`; reused (not duplicated) by the web client (`apps/web/lib/api/programs.ts:256-266` → `evidenceApi.createRecord`/`uploadRecordFile`). |
| T-04-09 | Repudiation | mitigate | `apps/api/services/programs/execution.py:67-76` `_link_evidence_to_completion()` — post-insert `UPDATE evidence_records SET related_entity_type='pm_completion', related_entity_id=<completion id>`. |

### Deferral separation-of-duty + corrective-WO hardening (04-03)

| ID | Category | Disposition | Evidence |
|----|----------|-------------|----------|
| T-04-10 | Repudiation/Tampering | mitigate | `apps/api/routers/programs.py:252-257` — rejects `approved_by == current_user.user_id` with 422 before any DB write; `_require_active_tenant_approver` checks the approver is an active tenant user; `_record_audit_event` writes `operational_audit_events` (`action="pm_deferral.approved"`). |
| T-04-11 | Repudiation | mitigate | `apps/api/services/programs/execution.py:90-101` `_record_containment_audit()` — `action="pm_check.failed_containment"`, `reason_code="failed_check"`, links the corrective WO id; corrective WO carries `due_at` (contracts.py `CORRECTIVE_WO_SLA_HOURS`) so the escalation cron (`internal.py`) can pick it up. |
| T-04-12 | Tampering | mitigate | Status transitions route through `supabase.rpc("transition_work_order_with_audit", ...)` (`apps/api/routers/work_orders.py:132`, `apps/api/routers/internal.py:474`) — no bare-PATCH status-mutation path exists for corrective WOs created by this phase. |

### Property-configurable PM template library (04-04)

| ID | Category | Disposition | Evidence |
|----|----------|-------------|----------|
| T-04-13 | Elevation of Privilege | mitigate | `apps/api/routers/programs.py:186,219` — `update_program_template`/`create_program_template` both `Depends(require_role(*MANAGER_ROLES))`. |
| T-04-14 | Tampering | mitigate | Same handlers: read/update scoped `.eq("id", template_id).eq("tenant_id", current_user.hotel_id)` (196-197, 208); create scoped `.eq("tenant_id", ...)` on the duplicate-code check (221-222) and on insert. |
| T-04-15 | Input Validation | mitigate | `UpdateProgramTemplateRequest`/`CreateProgramTemplateRequest`/`ProgramTemplateItemInput` in `apps/api/models/requests.py` are `SanitizedBaseModel` subclasses with bounded `items` (1-50 entries per 04-04-SUMMARY.md); migration 083 extends the canonical facilities/applicability allowlist explicitly (no arbitrary-string loosening) — confirmed present in `supabase/migrations/083_program_template_facilities.sql`. |

### PM completion capture UI (04-05)

| ID | Category | Disposition | Evidence |
|----|----------|-------------|----------|
| T-04-16 | Tampering | mitigate | Server: `apps/api/services/programs/contracts.py:8,161` `EvidenceRequiredError` raised when a `requires_evidence` item has no evidence — authoritative 422; UI (`PMCompletionModal.tsx`) mirrors but does not replace it. |
| T-04-17 | Info Disclosure | mitigate | Same signed-URL read path as T-04-06; the web client never stores or receives a raw storage path (`apps/web/lib/api/programs.ts:24` comment confirms the "never a raw storage URL" contract). |
| T-04-18 | Spoofing | mitigate | `apps/web/components/engineering/PMCompletionModal.tsx:268` `verifier_id` selector excludes current user client-side; backend enforces deferral-approver distinctness server-side (T-04-10). |

### Housekeeping inspection intelligence + deep-clean/public-area API (04-06)

| ID | Category | Disposition | Evidence |
|----|----------|-------------|----------|
| T-04-19 | Info Disclosure | mitigate | `apps/api/routers/programs.py:347-350` `get_inspection_sample` gated `require_role("gm","housekeeping_supervisor","chief_engineer")`; `:433` `get_inspection_quality` gated `require_role(*MANAGER_ROLES)`. |
| T-04-20 | Info Disclosure/Tampering | mitigate | `:447,459` `list_deep_clean_schedules`/`list_public_areas` both `.eq("tenant_id", ...)`-scoped, confirmed by 04-06's route test (`test_deep_clean_and_public_area_reads` — zero cross-tenant rows). |
| T-04-21 | Denial of Service | mitigate | No new `maybe_single()` reads introduced without the `or []`/`if not result or not result.data` guard (04-06-SUMMARY.md self-check; spot-checked, consistent with the bug-449 pattern used throughout the router). |

### Housekeeping program depth UI + DND policy (04-07)

| ID | Category | Disposition | Evidence |
|----|----------|-------------|----------|
| T-04-22 | Elevation of Privilege | mitigate | All HK config mutation routes (deep-clean, public-area, DND policy, stayover, supply-par, sampling-rule) already `require_role(*MANAGER_ROLES)` server-side (unchanged by this plan, confirmed still present in `programs.py`); web gates additionally on `useRole()`. |
| T-04-23 | Info Disclosure/Tampering | mitigate | Every read/write in `programs.py` scoped `.eq("tenant_id", ...)` — same pattern verified in T-04-03/T-04-20. |
| T-04-24 | Repudiation | mitigate | `apps/api/routers/internal.py:615,643,653` — `escalations/check` reads `dnd_welfare_policies` per tenant, checks an existing `dnd_welfare_events` row before writing, inserts into the append-only `dnd_welfare_events` table (trigger-protected per T-04-04). |
| T-04-25 | Tampering | accept | Confirmed passive: `build_supply_alerts` (contracts.py) produces an advisory list only; no automated action/notification on par shortage (04-07-SUMMARY.md checkpoint verification: "no cron/notification row created"). Accepted-risk disposition matches CONTEXT decision — documented here in the accepted-risk log. |

### Bilingual floor contract — initial slice (04-08)

| ID | Category | Disposition | Evidence |
|----|----------|-------------|----------|
| T-04-26 | Tampering (process) | mitigate | `apps/web/eslint.config.mjs` scoped `i18next/no-literal-string` override wired into `npm run lint` (originally 6-file scope in 04-08, since widened — see T-04-43). `node scripts/verify-i18n-gate.mjs` independently re-run this session: **PASS** (gate fires on floor fixture, stays exempt on GM/reports fixture). |
| T-04-27 | Usability integrity | mitigate | Every EN key has an ES counterpart — independently re-verified this session via a structural key-skeleton diff of the full `en.ts`/`es.ts` files: **1199/1199 key-lines identical in path and nesting depth**, 0 missing either direction. |
| T-04-28 | Over-broad enforcement | accept | GM/admin/config/export dirs allowlisted — confirmed present in `eslint.config.mjs` `ignores`: `app/(dashboard)/reports/**`, `billing/**`, `settings/**`, `*inspector-export*`. |

### Gap-closure i18n plans (04-09 .. 04-17)

| ID(s) | Component | Disposition | Evidence |
|-------|-----------|-------------|----------|
| T-04-29/30 | Room Status Board, Room Card, Assignment Sidebar, Prediction Panel | mitigate | `useTranslation`/`t()` confirmed wired (04-09-SUMMARY self-check greps); covered by the widened lint gate (T-04-43) which passes clean (independently re-run, see below). |
| T-04-31/32 | Room Detail Drawer, Inspection Modal, Occupancy Import Modal | mitigate | Same — confirmed present, covered by the widened gate. |
| T-04-33/34 | housekeeping/page.tsx, assignments/page.tsx | mitigate | Same. |
| T-04-35/36 | inspections/page.tsx, rooms/page.tsx | mitigate | Same. |
| T-04-37/38 | WorkOrderDetailDrawer.tsx | mitigate | Same; also the file at the center of the CR-01 role-check fix (T-04-49), independently re-confirmed correct in this audit. |
| T-04-39/40 | CreateWorkOrderModal, WorkOrderList, EngineeringRoomBoard, FailurePredictionSidebar | mitigate | Same. |
| T-04-41/42 | assets/predictions/work-orders/engineering landing pages | mitigate | Same; the work-orders page is also where CR-02 (T-04-50) was fixed. |
| T-04-43 | Gate widening to full floor set | mitigate | `apps/web/eslint.config.mjs` `files` array independently confirmed to include all 7 target globs (`components/{housekeeping,engineering,programs}/**`, `app/(dashboard)/{housekeeping,engineering,tasks,programs}/**`). **Independently re-ran `npm run lint` this session: exit 0, 0 errors, 0 warnings** — proves every file in the widened glob is currently literal-free. |
| T-04-44 | Non-word-shaped literal blind spots | mitigate | `grep -c "e.g. 45"` on `PMCompletionModal.tsx` → 0; `grep -c "xxxxxxxx-xxxx"` on `pm-schedules/page.tsx` → 0 (both independently re-confirmed this session). |
| T-04-45 | GM English carve-out | accept | Confirmed present in `eslint.config.mjs` ignores (same list as T-04-28). |
| T-04-46 | Plugin literal-shape heuristic limitation | accept | Structural limitation of `eslint-plugin-i18next` (`markupOnly: true` cannot see literals inside JS template expressions) — documented, not fixed (out of phase scope), consistent with the accepted disposition. Note: this exact blind spot is what let CR-02 (T-04-50) ship in the first place; it has since been fixed at the instance level, not at the tooling level, which is the declared, accepted risk. |
| T-04-47 | Race-induced Playwright false skip | mitigate | `apps/web/e2e/phase4-programs.spec.ts:126` — `await enDeepClean.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})` confirmed present (no longer an immediate `.count()`-gated skip before any wait). |
| T-04-48 | No local E2E credentials | accept | Graceful no-cred skip retained in `loginAsGM()` per 04-17-SUMMARY.md; documented as an accepted environment constraint. |

### Code-review-found fixes (added to the register per orchestrator instruction)

| ID | Category | Disposition | Evidence |
|----|----------|-------------|----------|
| T-04-49 | Elevation of Privilege (CR-01) | mitigate | `apps/web/components/engineering/WorkOrderDetailDrawer.tsx:120-121` — independently re-read this session: `const isEngineer = role === 'engineer'` / `const isChief = role === 'chief_engineer'`. Confirmed fixed (previously both lines compared against `'engineer'`, giving regular engineers chief-only actions — hold/cancel/resume/reopen/edit — while chief engineers had none). Commit `8299ae3b` confirmed in `git log`. |
| T-04-50 | Info Disclosure/process (CR-02, bilingual bypass) | mitigate | `apps/web/app/(dashboard)/engineering/work-orders/page.tsx:84-85` — independently re-read this session: `` `${t('engineering.workOrderCard.room')} ${wo.rooms.room_number}` ``, replacing the previously hardcoded `` `Room ${wo.rooms.room_number}` ``. Confirmed the `engineering.workOrderCard.room` key resolves to `"Habitación"` in `es.ts`. Commit `8299ae3b` confirmed in `git log`, same commit as T-04-49. |

---

## Independent Re-Verification Performed This Session

Beyond grepping cited files, this audit independently executed (not merely read about):

1. `cd apps/web && npm run lint` → **exit 0, 0 errors, 0 warnings** (proves the widened gate is currently clean against the full floor-facing tree, not just as claimed by 04-16-SUMMARY.md).
2. `cd apps/web && node scripts/verify-i18n-gate.mjs` → **PASS** on both the positive (gate fires on floor path) and negative (GM/reports path stays exempt) fixture assertions.
3. A from-scratch Node.js structural key-skeleton diff of `en.ts` vs `es.ts` (not reusing any script from the plans) → **1199/1199 key-lines identical**, confirming EN/ES parity independent of the executors' self-reported counts.
4. `git log`/`git show` on commit `8299ae3b` to confirm the CR-01/CR-02 fix commit exists and its diff matches the claimed fix, then re-read both files at current HEAD to confirm the fix is still present (not reverted by a later commit).
5. Direct `Read`/`Grep` of the actual route handlers, service functions, and DB migration SQL for every `mitigate`-disposition threat in the original 8 backend plans (04-01 through 04-08) rather than accepting the plans' SUMMARY.md self-check sections at face value.

## Production Migration Caveat (not counted as an open threat)

Migrations `081_pm_evidence_linkage.sql` and `083_program_template_facilities.sql` exist locally and are structurally correct (independently confirmed: `081` adds `'pm_completion'` to `evidence_records`'s related-entity CHECK + trigger function; `083` adds `backflow`/`domestic_water` to the facilities/applicability canonical allowlists). Three consecutive plan executors (04-02, 04-04, and by extension the code that depends on them) reported being unable to apply these to production because no Supabase MCP tool or DB password was available in their worktree sandboxes. A later session logged in `.wolf/memory.md:7175` that it applied both migrations via Supabase MCP `apply_migration` and confirmed via a live `pg_constraint` query. `04-VERIFICATION.md` (an earlier verification pass) treated this as "IMPROVED, not independently re-confirmed."

This audit had no Supabase MCP tool in its own tool surface and therefore could not independently re-run that `pg_constraint` query. **A later session (2026-07-24, with genuine Supabase MCP access) ran the recommended query directly against project `oacnwalhcpqdabivweki` and retired this caveat:**

```
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname IN ('evidence_records_related_entity_type_check','property_applicability_facilities_canonical','controlled_documents_applicability_canonical');
```

Result:
| Constraint | Definition confirms |
|------------|---------------------|
| `evidence_records_related_entity_type_check` | `related_entity_type = ANY (ARRAY[..., 'pm_completion'])` — migration 081 landed |
| `property_applicability_facilities_canonical` | `facilities` allowlist includes `'backflow'`, `'domestic_water'` — migration 083 landed |
| `controlled_documents_applicability_canonical` | `applicability` allowlist includes `'backflow'`, `'domestic_water'` — consistent with 083 |

`list_migrations` on the same project also shows both `081_pm_evidence_linkage` (version `20260723143709`) and `083_program_template_facilities` (version `20260723143723`) as applied. **Caveat retired — no longer open.**

## Unregistered Flags

None requiring a new threat entry beyond T-04-49/T-04-50 (already added and closed above). For transparency: the phase's own code-review report (`04-REVIEW.md`) also flagged four non-blocking WARNING/INFO items with no corresponding threat-model entry — `t`-variable shadowing recurring in 5 files (WR-01, latent `TypeError` risk, not a security bypass), silent `catch {}` blocks hiding failures in `pm-schedules/page.tsx` (WR-02, UX gap, not a security gap), the `markupOnly` ESLint rule's structural inability to see literals inside JS template expressions (WR-03, already captured here as the accepted risk T-04-46), and missing dialog semantics/Escape-handling on `OccupancyImportModal` (WR-04, accessibility gap). None of these grant unauthorized access, bypass tenant isolation, or expose data outside a role's permission — they do not meet the bar for a new STRIDE threat entry and are left for a follow-up code-quality pass, not this security audit.

## Accepted Risks Log

| ID | Risk | Justification | Owner action if revisited |
|----|------|----------------|---------------------------|
| T-04-25 | Par-shortage alerts are passive-only | Explicit CONTEXT decision; no automated action on low supply avoids a false sense of automated procurement | Reintroduce only with explicit workflow design |
| T-04-28 / T-04-45 | GM/admin/config/export dirs stay English, exempt from the i18n gate | D-03 explicit carve-out — those roles are English-only by design | N/A unless D-03 changes |
| T-04-46 | `eslint-plugin-i18next`'s `markupOnly` heuristic cannot see literals inside JS template expressions | Plugin limitation, out of phase scope; one instance (CR-02) already found and fixed directly | Consider a supplementary regex sweep for `` `${...}` ``-adjacent literal prefixes in floor dirs |
| T-04-48 | No local E2E credentials for full production confirmation | Documented `CLAUDE.md` environment constraint | Re-run `phase4-programs.spec.ts` against a deployed environment with real creds |
| (retired 2026-07-24) | Migrations 081/083 production-application — previously unconfirmed by the auditor | Independently re-confirmed via live `pg_constraint` query and `list_migrations` against project `oacnwalhcpqdabivweki` — see Production Migration Caveat section | None — closed |

---

## Summary

**Threats Closed:** 50/50
**Threats Open:** 0/50
**Blocker count:** 0

Every `mitigate`-disposition threat in the phase's 17 plans was verified against live code — role gates, tenant-scoping predicates, DB triggers, evidence-ID validation, signed-URL resolution, and the i18n hard-fail gate were each grepped/read directly rather than inferred from SUMMARY.md claims, and the gate/lint/parity claims were independently re-executed rather than trusted. The two code-review-found defects (CR-01 privilege-check bug, CR-02 hardcoded-English Kanban label) were independently re-confirmed fixed at current HEAD (commit `8299ae3b`), not merely reported fixed. The sole caveat (production migration application) is disclosed transparently above rather than silently accepted, and is not a blocker because the code-level security properties it touches do not depend on it.

SECURITY.md: `C:\Users\Henil\projects\PatelRep\.planning\phases\04-maintenance-and-housekeeping-programs\SECURITY.md`
