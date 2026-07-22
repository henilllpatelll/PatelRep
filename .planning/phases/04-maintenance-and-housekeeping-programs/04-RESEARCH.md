# Phase 4: Maintenance and housekeeping programs - Research

**Researched:** 2026-07-22
**Domain:** Defensible recurring PM + housekeeping programs on FastAPI + Supabase SDK + Next.js 14; bilingual floor contract + CI enforcement
**Confidence:** HIGH (scaffold audited directly against source; contracts read at file:line)

## Summary

Phase 4 is **audit-first, not greenfield**. Migration `071_operational_programs.sql` (12 tables, 5 immutability triggers, 12 RLS policies) is applied to production and correct. A `programs.py` router plus `services/programs/{contracts,execution}.py`, two web pages, `lib/api/programs.ts`, and `test_operational_programs.py` are all live. The data model and pure-policy layer are genuinely solid — tenant scoping is present on every query, RLS + immutability triggers are actually attached (not just declared), and `persist_pm_completion` correctly validates evidence-required items, appends immutable results, spawns a corrective work order on any failed item, and advances the schedule.

The gaps are concentrated in three places: (1) **PM evidence attachments bypass the Phase 2 evidence platform entirely** — `photos` and `certificate_attachments` are raw `List[str]` written straight into JSONB with no upload endpoint, no `evidence-files` bucket, no signed URLs, and no `evidence_records` linkage (a D-06 violation and a production-security finding); (2) **no `operational_audit_events` are written** for deferral approval or failed-check containment (D-07 gap); and (3) **the completion-capture UI is a stub** — the web "Complete" button posts a single canned `technician_attestation` passed item, collecting none of the checklist/measurements/verifier/parts/photos the defensible model supports. The DND welfare loop, by contrast, is already fully implemented in the `escalations/check` cron.

**Primary recommendation:** Open with Slice 0 as three concrete workstreams — (a) route the PM photo/cert path through the existing `evidence.py` upload + signed-URL + `evidence_records` pattern; (b) add `operational_audit_events` writes for deferral approval and failed-check containment using the `_record_audit_event` pattern already in `evidence.py`; (c) replace the pure-logic-only test suite with TestClient route tests that prove tenant scoping, RBAC, and DB-level immutability. Then build 4A completion UI + applicability-gated templates, 4B (mostly UI over existing DND/par/deep-clean plumbing), and close with 4C bilingual + a scoped ESLint `no-literal-string` CI gate.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Adopt scaffold, audit-first.** Migration 071 + `programs.py` are live in prod but unverified. Slice 0 verifies (a) tenant scoping on every query, (b) RLS on all 12 tables, (c) signed-URL delivery for PM/vendor/certificate attachments, (d) immutability triggers actually enforced, (e) `require_role()` correctness per route, (f) Phase 4 exit criteria. Fix every gap; do not rebuild correct code. Treat any contract violation as a **production-security finding**.
- **D-02 — Slice order S0 → 4A (PM) → 4B (housekeeping) → 4C (bilingual).** Bilingual is a dedicated closing slice so the CI gate + phone-width EN/ES Playwright pass runs once over everything 4A/4B touched.
- **D-03 — Translation scope = all floor-role critical workflows, EN + ES:** housekeeping, engineering/work-orders, tasks, PM completion, deep-clean, DND + their notification/empty-state/error/validation copy. **Stays English:** GM dashboards, config, inspector export, reports/analytics.
- **D-04 — CI hardcoded-copy gate = scoped hard-fail.** Fail the build on raw user-facing string literals (JSX text, `aria-label`, `placeholder`, `title`) in floor-facing dirs (`components/housekeeping`, `components/engineering`, `app/(dashboard)/{housekeeping,engineering,tasks,programs}`). GM/admin/config/export dirs + test ids allowlisted. Advisory-only rejected.
- **D-05 — Seed all named PM templates + generic builder,** applicability-gated via Phase 2 `property_applicability` (pool/backflow/domestic-water surface only where the facility exists). Extend existing `POST /templates/initialize`, do not add a parallel mechanism.
- **D-06 — Reuse the evidence platform:** Phase 2 `evidence_records` + private `evidence-files` bucket with short-lived signed URLs for all PM completion photos, vendor certificates, checklist attachments. Never expose public storage URLs.
- **D-07 — Reuse `operational_audit_events` (append-only)** for material changes + reason codes (PM deferral approval, failed-check containment), and `notification_deliveries` for reminder/escalation channel + outcome. No parallel audit or notification mechanism.
- **D-08 — Every table + query tenant-scoped** (`.eq("hotel_id"/"tenant_id", ...)`), backed by RLS, every mutation gated with `require_role()`.
- **D-09 — Security discipline (079):** any new `SECURITY DEFINER` RPC must `REVOKE EXECUTE FROM anon, authenticated, PUBLIC` + `GRANT EXECUTE TO service_role` only. Verify existing 071 RPCs meet this in S0.
- **D-10 — Recurring/scheduled work** uses the existing `routers/internal.py` `X-Cron-Secret` convention + writes `cron_health` (068). Reuse `/v1/internal/pm/check-due` + the GitHub-Actions driver. No parallel scheduler.
- **D-11 — Web + API only; no `apps/mobile/`.** No core path may depend on local AI-provider or Stripe credentials.
- **D-12 — Plan-review gate:** stop after planning, present the complete Phase 4 plan for user review before execution.
- **D-13 — Complete vertical web + API slices with focused tests;** no tables/screens disconnected from an operational workflow.

### Claude's Discretion
Exact route shapes + schema refinements on top of 071; per-mutation role sets; cron cadences; DND welfare threshold defaults; how par alerts surface (passive dashboard badge vs queued `notification_deliveries`); corrective-WO linkage from a failed PM check; inspection-sampling algorithm + quality-trend aggregation; PM checklist storage shape (completion items vs. evidence record); component layout — select from existing project patterns as long as the locked contracts hold.

### Deferred Ideas (OUT OF SCOPE)
- Full-app GM-facing web i18n (analytics, config, inspector export) — English per D-03.
- Guest recovery + management ROI — Phase 5.
- PMS + AI expansion — Phase 6, pilot-gated.
- Vercel remediation — one-time infra decision; Railway is production.
- EAS build, mobile i18n handoff, rooms debugging — parked; Phase 4 is web + API only.
</user_constraints>

<phase_requirements>
## Phase Requirements

No `REQUIREMENTS.md` exists for Phase 4. Scope authority is `HOTEL_STANDARDS_EXECUTION_PLAN.md` §Phase 4 (lines 232-286) + `04-CONTEXT.md`. Requirement IDs below are synthesized from the execution plan for the planner's traceability.

| ID | Description (execution plan §Phase 4) | Research Support |
|----|----------------------------------------|------------------|
| PM-01 | Immutable PM completion records | 071 `pm_completion_records` + trigger (line 175); already enforced |
| PM-02 | Versioned checklist results, technician + verifier | `pm_completion_records.checklist_version/technician_id/verifier_id`; UI capture missing (Gap 3) |
| PM-03 | Measurements, meter readings, photos, labor, structured parts, defects | model + columns exist; **photos not on evidence platform (Gap 1)**; UI missing |
| PM-04 | Corrective work order from failed check | `persist_pm_completion` spawns it; **no audit event, no due_at (Gap 8)** |
| PM-05 | Deferral reason + approval | `pm_deferrals` immutable; **self-approval + no audit (Gap 4)** |
| PM-06 | Vendor + certificate attachments | columns exist; **certs not signed-URL/evidence-linked (Gap 1)** |
| PM-07 | Asset criticality/downtime/warranty/cost context | 071 adds columns to `assets`; no UI surfaces them yet |
| PM-08 | Property-configurable template library (7 named + generic) | `DEFAULT_PROGRAM_TEMPLATES` has them; **not applicability-gated, no edit, no generic builder (Gap 5)** |
| HK-01 | Deep-clean + rotational schedules; public-area locations | `deep_clean_schedules/occurrences`, `public_areas` + routes exist |
| HK-02 | Inspection sampling rules (experience/room type/risk) | `inspection_sampling_rules` + upsert route exist; no sampling *execution* |
| HK-03 | Inspection quality trends (item/room type/employee) | `get_inspection_quality` only aggregates by result (Gap 11) |
| HK-04 | Stayover linen change-frequency rules | `housekeeping_stayover_rules` + route exist |
| HK-05 | Par alerts (linen/chemical/amenity) | `build_supply_alerts` passive dashboard (discretion permits this) |
| HK-06 | Property-configurable DND welfare timing + escalation + dup-prevention | **fully implemented** in `escalations/check` cron |
| BL-01 | Translate all floor-role workflows EN + ES | `programs` namespace done; pm-schedules page + eng components hardcoded (Gap 10) |
| BL-02 | Scoped CI hardcoded-copy gate | none exists; recommend ESLint `no-literal-string` (see 4C) |
| BL-03 | Phone-width (390px) EN/ES Playwright verification | only phase0/phase1 configs exist; Wave 0 gap |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PM completion evidence capture | API (`programs.py`/`assets.py` + `persist_pm_completion`) | DB (immutable tables) | Defensibility requires server-side validation + append-only writes; browser cannot be trusted |
| PM photo/cert storage | API → Supabase Storage (`evidence-files`) | DB (`evidence_records`) | Private bucket + signed URL is server-only; D-06 forbids public URLs |
| Failed-check containment (corrective WO + audit) | API (`persist_pm_completion` + audit write) | DB (`operational_audit_events`) | Must reuse Phase 1 append-only audit; not a client concern |
| Template library + applicability gating | API (`templates/initialize`) | DB (`property_applicability`) | Gating logic reads tenant facility config server-side |
| Deep-clean / public-area scheduling | API (`programs.py`) + DB recurrence | Web (config UI) | Recurrence math is server-side (`next_recurrence_date`); UI configures |
| Par alerts | Web (passive dashboard badge) | API (`build_supply_alerts` in overview) | Discretion permits passive; computed in overview response |
| DND welfare timing + escalation | API cron (`internal.py escalations/check`) | Web (policy config in ProgramsPage) | Recurring job owns detection; UI owns policy |
| Bilingual floor copy | Web (`react-i18next` `en.ts`/`es.ts`) | CI (ESLint gate) | Rendering + enforcement are both web-tier |

## Standard Stack

Phase 4 introduces **no new runtime dependencies**. It reuses the established stack verified in the repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI + supabase-py | in `apps/api/requirements.txt` | Router handlers, direct SDK queries | Project convention: no ORM, tenant filter in handler |
| Next.js | 14 App Router | Web surfaces | Established; note `apps/web/AGENTS.md` warns Next APIs may differ from training data — read `node_modules/next/dist/docs/` before non-trivial web work |
| @tanstack/react-query | in `apps/web/package.json` | Server-data fetching (`useQuery`/`useMutation`) | Pattern in `ProgramsPage`/`pm-schedules` |
| react-i18next | 17.0.10 | Web i18n via `i18n/locales/en.ts` + `es.ts` | `i18next` 26.3.6; **the `.ts` files are live; `.json` variants were deleted (bug-448)** |

### Supporting (for the 4C CI gate — the only genuinely new tooling decision)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| eslint-plugin-i18next | latest (`npm view eslint-plugin-i18next version` before pinning) | `no-literal-string` rule flags raw JSX/attr strings | Scoped `overrides` block in existing ESLint flat config for floor-facing dirs |

**Version verification:** `eslint-plugin-i18next` is the recommended gate (see 4C). Run `npm view eslint-plugin-i18next version` at plan time — this is `[ASSUMED]` current but not yet installed. `eslint-config-next/core-web-vitals` is already the base config (`apps/web/eslint.config.mjs`).

### Alternatives Considered (4C CI gate)
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| eslint-plugin-i18next `no-literal-string` | i18next-parser | Parser *extracts* keys but does not *fail* on untranslated literals — advisory only, rejected by D-04 |
| eslint-plugin-i18next | Custom AST/grep script | More control over allowlist, but reinvents JSX-text detection the plugin already handles; higher maintenance |
| eslint-plugin-i18next | eslint-plugin-react `no-literal-string` (deprecated/merged) | Superseded; `eslint-plugin-i18next` is the maintained successor |

**Recommendation:** `eslint-plugin-i18next` `no-literal-string`, wired as a **scoped override** in `apps/web/eslint.config.mjs` (flat config) targeting only floor-facing dirs, with `markupOnly`/attribute options and an allowlist for GM/admin/config/export dirs + test ids. Add `npm run lint` (already in CI `lint-web` job) as the enforcement point — no new CI job needed.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────── WEB (Next.js 14) ───────────────────────────┐
  Manager / Engineer ──►  │ (dashboard)/programs/page.tsx  (dashboard)/engineering/pm-schedules  │
   / Housekeeper          │   React Query ── lib/api/programs.ts ── lib/api/engineering.ts        │
                          │   react-i18next (en.ts / es.ts)  ◄── ESLint no-literal-string gate    │
                          └───────────────┬──────────────────────────────────────────────────────┘
                                          │ apiClient (JWT: hotel_id + role)
                                          ▼
        ┌──────────────────────────────── API (FastAPI) ───────────────────────────────────────┐
        │ routers/programs.py ── require_role() ── .eq(tenant_id) ── services/programs/*         │
        │   overview │ templates/initialize │ pm complete │ deferrals │ deep-clean │ pars │ DND  │
        │ routers/assets.py  /pm-schedules/{id}/complete ─┐                                       │
        │ routers/internal.py  /pm/check-due  /escalations/check (DND welfare) ── X-Cron-Secret   │
        └───────┬───────────────────────┬──────────────────┬──────────────────┬─────────────────┘
                │ persist_pm_completion  │ evidence upload  │ audit            │ notify
                ▼                        ▼ (GAP 1 today)     ▼ (GAP 2 today)    ▼
   ┌──────── Supabase (RLS, service-role key) ───────────────────────────────────────────────┐
   │ pm_completion_records/items (immutable) │ pm_deferrals (immutable) │ deep_clean_* │ DND* │
   │ evidence_records + evidence-files bucket │ operational_audit_events │ notification_deliv.  │
   │ property_applicability │ cron_health │ work_orders (corrective) │ assets (criticality…)   │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
                ▲ GitHub Actions cron-jobs.yml POST /v1/internal/* (X-Cron-Secret)
```

Trace the PM defensibility path: Engineer opens pm-schedules → completion form (to be built) → `POST /assets/pm-schedules/{id}/complete` → `persist_pm_completion` validates evidence-required items → appends `pm_completion_records` + `pm_completion_items` (immutable) → failed item spawns corrective `work_orders` row → advances `pm_schedules.next_due_at`. The two dashed arrows (evidence upload, audit) are the S0 gaps to wire in.

### Component Responsibilities
| File | Responsibility | State |
|------|----------------|-------|
| `apps/api/routers/programs.py` | All PM/HK program config + execution routes | Live; tenant-scoped; **audit/evidence/RBAC gaps** |
| `apps/api/routers/assets.py` (`/pm-schedules/{id}/complete`, line 226) | PM completion wired to web | Live; uses `persist_pm_completion`; role `("engineer","gm")` |
| `apps/api/services/programs/contracts.py` | Pure policy: templates, evidence validation, corrective WO, recurrence, DND, par alerts | Solid pure functions |
| `apps/api/services/programs/execution.py` | `persist_pm_completion` DB orchestration | Correct; no audit/evidence-platform calls |
| `apps/api/routers/internal.py` | Crons: `/pm/check-due`, `/escalations/check` (DND welfare) | DND welfare **fully implemented** (lines 601-669) |
| `apps/web/app/(dashboard)/programs/page.tsx` | Program config dashboard (templates, DND, stayover, pars) | Real, i18n-wired; no PM completion UI |
| `apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx` | PM schedule list + create + "complete" | Real but **fully hardcoded English**; completion is canned attestation |
| `apps/web/lib/api/programs.ts` | Typed client | Covers overview/init/DND/stayover/pars only — **missing deep-clean, public-area, deferral, inspection, PM-complete clients** |

### Pattern 1: Reuse the evidence upload + signed-URL flow (for PM photos/certs)
**What:** Route PM completion photos and vendor certificates through the exact `evidence.py` mechanism, not raw JSONB strings.
**When to use:** Every PM/vendor/certificate attachment (D-06).
**Example:**
```python
# Source: apps/api/routers/evidence.py:513 (upload) + :136 (signed URL)
@router.post("/records/{record_id}/file")
async def upload_evidence_file(record_id, file: UploadFile = File(...),
        current_user = Depends(require_role(*EVIDENCE_CAPTURE_ROLES))):
    if file.content_type not in ALLOWED_EVIDENCE_CONTENT_TYPES: raise HTTPException(400, ...)
    path = _evidence_storage_path(current_user, record_id, file.content_type)
    supabase.storage.from_("evidence-files").upload(path, content,
        {"content-type": file.content_type, "upsert": "false"})
    # ... update evidence_records.storage_path, then _record_audit_event(...)

def _create_evidence_signed_url(storage_path: str) -> str:
    return supabase.storage.from_("evidence-files").create_signed_url(storage_path, 3600)
```
PM completion should store an `evidence_records.id` FK (or the `records/{id}/file` path), and the completion read path returns short-lived signed URLs — never the storage path or a public URL.

### Pattern 2: Canonical work-order transition (for any status change, not creation)
**What:** Corrective WO *creation* is a plain insert (acceptable — same as `pm/check-due`), but any later status transition must use the atomic RPC.
**Example:**
```python
# Source: apps/api/routers/internal.py:472  _auto_escalate_work_order
supabase.rpc("transition_work_order_with_audit", {
    "p_work_order_id": wo_id, "p_tenant_id": hotel_id, "p_new_status": "escalated",
    "p_actor_id": None, "p_actor_role": "automation", "p_reason_code": "sla_breach",
    "p_reason_note": "...", "p_source": "automation", "p_is_override": False,
}).execute()
```

### Pattern 3: Append an operational audit event on material change
```python
# Source: apps/api/routers/evidence.py  _record_audit_event → operational_audit_events (065)
_record_audit_event(current_user=current_user, resource_type="pm_deferral",
    resource_id=deferral_id, action="pm_deferral.approved",
    new_state={"deferred_until": ..., "reason": ...})
```

### Anti-Patterns to Avoid
- **Storing attachment URLs/paths as raw JSONB strings** (current `photos`/`certificate_attachments` behavior) — bypasses tenant-foldered storage + signed-URL delivery. This is the #1 S0 fix.
- **Self-approved deferrals** — `requested_by == approved_by` makes "approval" meaningless and writes no audit trail.
- **A second DND/notification mechanism** — DND welfare already exists in `escalations/check`; extend it, don't duplicate.
- **Adding a new CI job for the i18n gate** — plug `no-literal-string` into the existing `lint-web` job (`npm run lint`).
- **`FakeDB` route tests as the only coverage** — see Validation Architecture; they proved pure logic but hid bug-449.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PM photo/cert storage | New bucket + URL scheme | `evidence-files` bucket + `evidence.py` upload/signed-URL helpers | D-06; tenant-foldered, content-type/size validated, private |
| Audit trail for deferral/containment | New table/log | `operational_audit_events` (065) + `_record_audit_event` | D-07 append-only; reconstructable history |
| Corrective WO status changes | Direct `status` PATCH | `transition_work_order_with_audit` RPC | Phase 1 canonical contract; 422 on bare PATCH |
| Recurring PM/DND/par jobs | New scheduler | `internal.py` + `X-Cron-Secret` + `cron_health` + GitHub Actions | D-10 |
| DND welfare escalation | New cron | Existing `escalations/check` DND block (internal.py:601) | Already property-configurable + dup-prevented |
| i18n literal detection | grep/AST script | `eslint-plugin-i18next` `no-literal-string` scoped override | Handles JSX text + attrs + allowlist; maintained |
| Template applicability | Custom facility flags | Phase 2 `property_applicability` | D-05 |

**Key insight:** Every mechanism Phase 4 needs already exists in the codebase from Phases 1-3. The work is *wiring the scaffold into them*, not building new infrastructure.

## Runtime State Inventory

Not a rename/refactor phase. However, because `programs.py` is **live in production against real tenant data**, S0 has a production-state dimension:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Migration 071's 12 tables applied to prod (per STATE.md 070-073 applied). Any PM completion already recorded stores `photos`/`certificate_attachments` as raw JSONB strings. | If prod rows exist with raw URLs, a data-migration decision is needed; verify row counts in S0 before changing the write path. Likely empty (feature not surfaced in UI). |
| Live service config | GitHub Actions `cron-jobs.yml` already fires `/v1/internal/pm/check-due` + `/escalations/check`. | No change to register; new crons (if any) add rows to the workflow + `cron_health` seed. |
| OS-registered state | None. | None. |
| Secrets/env vars | `CRON_SECRET` already set (Railway). No new secrets for Phase 4 (no AI/Stripe in core path per D-11). | None. |
| Build artifacts | None. | None. |

**Verify in S0:** `SELECT count(*) FROM pm_completion_records` (and `pm_deferrals`, `deep_clean_occurrences`) in prod to know whether the write-path fixes touch existing immutable rows (which cannot be updated — the trigger blocks it, so a corrective append strategy is required if bad rows exist).

## Scaffold Audit — Evidence-Backed Gap List (feeds Slice 0)

### Positive findings — DO NOT rebuild
1. **Tenant scoping present on every `programs.py` query** — `.eq("tenant_id", current_user.hotel_id)` on overview (lines 48-53), templates (67), deferrals (110/118), deep-clean (142/156), pars (163), stayover (170), DND (177), sampling (183), inspection-quality (189). `_get_pm_schedule` scopes by tenant (line 38). [VERIFIED: programs.py]
2. **RLS enabled + one tenant policy per table on all 12 tables** — 071 lines 181-205, policy form `tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid`. [VERIFIED: 071]
3. **Immutability triggers actually attached** to the 5 append-only tables (`pm_completion_records`, `pm_completion_items`, `pm_deferrals`, `deep_clean_occurrences`, `dnd_welfare_events`) — 071 lines 175-179, via `reject_operational_program_mutation()`. Config tables (templates, pars, policies, schedules) correctly remain mutable. [VERIFIED: 071]
4. **No `SECURITY DEFINER` RPC in 071** — the only function is the invoker-mode trigger fn. D-09 REVOKE/GRANT discipline is N/A here (nothing to fix), though the trigger fn lacks `SET search_path = public` (low-risk hardening nit). [VERIFIED: 071]
5. **`persist_pm_completion` is correct** — validates evidence-required items, appends immutable items, spawns a corrective WO per failed item, advances the schedule. [VERIFIED: execution.py]
6. **DND welfare is fully implemented** in `escalations/check` (internal.py:601-669): reads property `dnd_welfare_policies.threshold_hours`, writes one immutable `dnd_welfare_events` per window, dup-prevention via existing-event + existing-task checks, notifies `escalation_roles` through `_notify_role` (which writes `notification_deliveries`). [VERIFIED: internal.py]
7. **`programs` i18n namespace exists in both `en.ts` and `es.ts`** (line 110 in each) — ProgramsPage is bilingual. [VERIFIED: locales]
8. **Corrective WO enum values are valid** — `priority='urgent'` + `category='safety'` both pass `work_orders_priority_check` (065: emergency/urgent/normal/low) and `work_orders_category_check` (007: …safety…general). The insert will NOT fail a constraint. [VERIFIED: 065, 007]

### Gaps — S0 fixes (severity noted)
| # | Gap | Evidence | Severity | Contract |
|---|-----|----------|----------|----------|
| G1 | **PM photos/certs bypass evidence platform.** `CompletePMProgramRequest.photos`/`certificate_attachments` = `List[str]` (models/requests.py:644) written straight into JSONB (execution.py:36-37). No upload endpoint, no `evidence-files` bucket, no signed URL, no `evidence_records` FK, no content-type/size validation. | requests.py:644, execution.py, programs.py (no `storage` calls) | **HIGH / prod-security** | D-06 violation |
| G2 | **No `operational_audit_events` writes** for deferral approval or failed-check containment. `defer_pm_schedule` only inserts `pm_deferrals` + updates `next_due_at` (programs.py:110-118). `persist_pm_completion` writes no audit. | programs.py, execution.py | HIGH | D-07 gap |
| G3 | **Completion-capture UI is a stub.** Web "Complete" posts one canned `technician_attestation` passed item, no checklist/measurements/verifier/photos/parts/labor/defects (engineering.ts:263). `/programs/pm-schedules/{id}/complete` is wired to no UI. | engineering.ts:263, pm-schedules page | HIGH | PM-02/03 core deliverable |
| G4 | **Deferral self-approval.** `requested_by == approved_by == current_user` (programs.py:114-116); no request/approve separation, no audit. | programs.py:103-119 | MEDIUM | PM-05 defensibility |
| G5 | **Template seeding not applicability-gated + no edit/generic builder.** `templates/initialize` seeds all 9 templates regardless of `property_applicability` (programs.py:65-80); pool/backflow/domestic-water surface everywhere. Single canned item per template; no frequency/checklist edit endpoint; no generic builder. | programs.py:65-80, contracts.py:11 | MEDIUM | D-05 gap |
| G6 | **`get_program_overview` has no `require_role`** — any authenticated user (housekeeper) reads DND policy, supply pars, sampling rules (programs.py:45). | programs.py:45-46 | LOW-MED | D-08 (read exposure) |
| G7 | **`chief_engineer` excluded from PM roles.** Completion gated `("engineer","gm")`; `MANAGER_ROLES` omits `chief_engineer` (programs.py:32, 87). Chief engineers cannot complete PMs or manage programs. | programs.py:32,87; assets.py:231 | MEDIUM | RBAC correctness |
| G8 | **Corrective WO writes no audit + no `due_at`.** Insert is enum-valid but sets no `due_at` (escalation cron filters on `due_at`, so it is never auto-escalated) and no `operational_audit_events` containment record; life-safety failures use `urgent` not `emergency`. | contracts.py:88-110, execution.py:56-65 | MEDIUM | D-07 containment |
| G9 | **Tests exercise pure logic only.** `test_operational_programs.py` tests pure functions + one `FakeDB` persist + an SQL string-match. No TestClient route tests → no tenant-scoping/RBAC proof; no DB-level immutability test; no evidence/signed-URL test. `FakeDB` masks supabase-py behaviors (bug-449: `maybe_single().execute()` returns `None`). | test_operational_programs.py | HIGH (false confidence) | S0 verification |
| G10 | **pm-schedules page + eng components hardcoded English.** `pm-schedules/page.tsx` has zero `useTranslation` ("PM Schedules","Overdue","Complete","Deactivate","Create WO", both modals). Eng components low t() counts (WorkOrderCard 2, WorkOrderList 1, FailurePredictionSidebar 1, EngineeringRoomBoard 3). | pm-schedules page, components/engineering grep | MEDIUM | BL-01 |
| G11 | **Inspection quality trend is shallow.** `get_inspection_quality` aggregates only by `overall_result` (programs.py:190-195); HK-03 wants by item / room type / employee. `inspection_sampling_rules` exist but no sampling *execution* consumes them. | programs.py:187-195 | MEDIUM | HK-02/03 |
| G12 | **`lib/api/programs.ts` incomplete.** Missing typed clients for deep-clean schedule/complete, public-area, PM deferral, inspection sampling, and PM completion. | programs.ts | LOW | 4A/4B wiring |

## Common Pitfalls

### Pitfall 1: Service-role key bypasses RLS
**What goes wrong:** `core.database.supabase` is the service-role client. RLS policies on the 12 tables do **not** protect against a missing `.eq("tenant_id")` in code — service role bypasses RLS entirely.
**How to avoid:** The in-handler tenant filter is the *primary* control (D-08). Verify it in S0 route tests; do not treat RLS presence as sufficient.
**Warning signs:** Any query without `.eq("tenant_id", current_user.hotel_id)`.

### Pitfall 2: `maybe_single().execute()` returns `None`, not an object (bug-449)
**What goes wrong:** `if result.data:` throws `AttributeError` when no row matches, because the call returns `None`. `FakeDB` returns `SimpleNamespace(data=None)` and hides this.
**How to avoid:** Use `if result and result.data:` (codebase pattern, internal.py:44). Add real-behavior tests, not just `FakeDB`.

### Pitfall 3: Immutable rows cannot be corrected in place
**What goes wrong:** Fixing a bad `pm_completion_records`/`pm_deferrals` row via UPDATE raises the append-only trigger.
**How to avoid:** Corrections append a new record. Verify prod row counts before changing write paths (Runtime State Inventory).

### Pitfall 4: Next.js 14 App Router APIs differ from training data
**What goes wrong:** `apps/web/AGENTS.md` explicitly warns Next APIs may differ.
**How to avoid:** Read `apps/web/node_modules/next/dist/docs/` before non-trivial web changes; keep the AGENTS.md agent block committed with web work to keep the tree clean.

### Pitfall 5: i18n `.json` files are dead
**What goes wrong:** Adding keys to `en.json`/`es.json` renders raw keys (bug-448). Those files were deleted.
**How to avoid:** Edit only `apps/web/i18n/locales/en.ts` + `es.ts`.

## Code Examples

### Applicability-gated template seeding (extend `templates/initialize` for D-05)
```python
# Source pattern: programs.py:65 + Phase 2 property_applicability
applicable = {row["facility_key"] for row in supabase.table("property_applicability")
    .select("facility_key").eq("tenant_id", tid).eq("applies", True).execute().data or []}
GATED = {"pool_check": "pool", "backflow": "backflow", "domestic_water": "domestic_water"}
records = [t for t in DEFAULT_PROGRAM_TEMPLATES
    if t["code"] not in existing_codes
    and (GATED.get(t["code"]) is None or GATED[t["code"]] in applicable)]
```
*(Verify the exact `property_applicability` column names against migration 069 in S0 — `facility_key`/`applies` are `[ASSUMED]`.)*

### Scoped ESLint `no-literal-string` (flat config, D-04)
```js
// apps/web/eslint.config.mjs — add after ...nextConfig
import i18next from 'eslint-plugin-i18next'
// floor-facing override:
{
  files: ['components/housekeeping/**', 'components/engineering/**',
          'app/(dashboard)/{housekeeping,engineering,tasks,programs}/**'],
  plugins: { i18next },
  rules: { 'i18next/no-literal-string': ['error',
    { markupOnly: true, 'jsx-attributes': { include: ['aria-label','placeholder','title'] } }] },
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PM "complete" = move due date | Immutable completion record proving work | Phase 4 intent | The scaffold's data model already supports this; UI does not |
| i18n via `.json` | `.ts` locale objects (react-i18next) | Phase 3 (bug-448) | Edit only `.ts` files |
| Advisory i18n lint | Scoped hard-fail `no-literal-string` | Phase 4 (D-04) | New CI enforcement in existing `lint-web` job |

**Deprecated/outdated:**
- `apps/web/i18n/locales/*.json` — deleted; do not recreate.
- Any assumption that RLS alone isolates tenants under the service-role client — false.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `eslint-plugin-i18next` is the current maintained `no-literal-string` provider and installs cleanly into the flat config | Standard Stack / 4C | Medium — may need a custom AST script fallback; verify `npm view` + a spike |
| A2 | `property_applicability` uses `facility_key` + `applies` columns | Code Examples / D-05 | Medium — wrong column names break template gating; verify migration 069 in S0 |
| A3 | Prod `pm_completion_records`/`pm_deferrals` are effectively empty (feature not surfaced) | Runtime State Inventory | Medium — if populated with raw-URL rows, a corrective-append data plan is needed |
| A4 | `evidence_records` supports a completion/PM linkage (FK or reference) without schema change | Pattern 1 / D-06 | Medium — may need a small migration to add a PM completion → evidence_records join; confirm 073/078 shape in S0 |
| A5 | Corrective-WO creation (plain insert) satisfies "through the canonical transition contract" since creation is not a transition | G8 | Low — planner may still prefer routing creation through a helper; discretion (D-Ctx) |
| A6 | `chief_engineer` is an intended PM actor (CLAUDE.md lists it as a role) | G7 | Low — confirm desired role set with the plan; RBAC is discretion per CONTEXT |

## Open Questions

1. **Should par alerts stay passive or queue `notification_deliveries`?**
   - Known: `build_supply_alerts` computes shortages in the overview response (passive badge).
   - Unclear: whether a queued alert is wanted.
   - Recommendation: CONTEXT marks this **Claude's discretion** — keep passive for MVP; add queued delivery only if a stakeholder asks. Lower risk, no cron needed.

2. **PM completion evidence: FK to `evidence_records` vs. reuse `pm_completion_items.evidence` JSONB?**
   - Known: `pm_completion_items.evidence` is JSONB; `evidence_records` is the canonical private-attachment store.
   - Recommendation: store `evidence_records.id` references (not raw strings); return signed URLs on read. Confirm whether a linking column/migration is needed (A4).

3. **Corrective WO `due_at` + audit — how urgent?**
   - Recommendation: set `due_at` (so escalation applies), write an `operational_audit_events` containment record, and use `emergency` priority for `life_safety` asset criticality, else `urgent`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| FastAPI + supabase-py | API routes | ✓ | in requirements.txt | — |
| Next.js 14 + react-i18next | Web | ✓ | i18next 26.3.6 / react-i18next 17.0.10 | — |
| Supabase `evidence-files` bucket | PM attachments (D-06) | ✓ | private, from Phase 2 | — |
| GitHub Actions cron driver | recurring jobs (D-10) | ✓ | cron-jobs.yml firing (verified 2026-07-22) | — |
| `eslint-plugin-i18next` | 4C CI gate | ✗ | — | custom AST/grep script |
| Playwright | phone-width EN/ES verification | ✓ (phase0/phase1 configs) | — | new phase4 config needed (Wave 0) |
| OpenAI / Anthropic / Stripe keys | — (NOT in Phase 4 core path per D-11) | ✗ locally | — | Phase 4 has no credential-gated core path; flag if any task assumes one |

**Missing dependencies with no fallback:** none blocking.
**Missing dependencies with fallback:** `eslint-plugin-i18next` (fallback: custom script); Playwright phase4 config (create in Wave 0).

## Validation Architecture

Nyquist validation is enabled (no `workflow.nyquist_validation: false` found). Every slice ships focused tests.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (API, `apps/api/tests/`); Playwright (web, `apps/web/e2e/`) |
| Config file | pytest via `apps/api` invocation; Playwright `playwright.phase{0,1}.config.ts` (phase4 needed) |
| Quick run command | `cd apps/api && python -m pytest tests/test_operational_programs.py -q` |
| Full suite command | `cd apps/api && python -m pytest tests/ -q` then `cd apps/web && npm run lint && npm run type-check` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PM-02/03 | Completion persists items + advances schedule | integration (TestClient) | `pytest tests/test_operational_programs.py -x` | ⚠️ pure-only today; add route test (Wave 0) |
| PM-03 | Evidence-required item without proof → 422 | unit + route | `pytest -k evidence_required` | ✅ unit; ❌ route |
| PM-04 | Failed check spawns corrective WO | unit | `pytest -k corrective_work_order` | ✅ |
| PM-04 | Corrective WO writes audit + due_at | route | new | ❌ Wave 0 |
| PM-05 | Deferral requires distinct approver + audit | route | new | ❌ Wave 0 |
| PM-01 | DB-level immutability (UPDATE/DELETE blocked) | integration (real DB or Supabase MCP) | manual/MCP tx | ❌ SQL string-match only |
| D-06 | PM photo returned as signed URL, never public | route | new | ❌ Wave 0 |
| D-08 | Cross-tenant PM schedule → 404, zero writes | route | new (mirror Phase 1 isolation test) | ❌ Wave 0 |
| G7 | RBAC: housekeeper 403 on PM complete; chief_engineer allowed | route | new | ❌ Wave 0 |
| HK-01 | Deep-clean recurrence advances from completion | unit | `pytest -k deep_clean_recurrence` | ✅ |
| HK-06 | DND threshold + one escalation per window | unit | `pytest -k dnd_policy` | ✅ |
| HK-05 | Par alerts only below threshold | unit | `pytest -k supply_par` | ✅ |
| BL-01/03 | Floor workflows usable EN + ES at 390px | e2e | `npx playwright test --config=playwright.phase4.config.ts` | ❌ Wave 0 |
| BL-02 | Raw literal in floor dir fails lint | ci | `cd apps/web && npm run lint` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_operational_programs.py -q` + `npm run type-check` for touched web.
- **Per wave merge:** full `pytest tests/ -q` + `npm run lint && npm run type-check`.
- **Phase gate:** full suite green + EN/ES 390px Playwright pass + i18n lint gate green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/test_programs_routes.py` — TestClient route tests: tenant isolation (404 cross-tenant, zero writes), RBAC per route (incl. chief_engineer), evidence-required 422, signed-URL-on-read.
- [ ] DB-level immutability proof — Supabase MCP rolled-back transaction (mirror the Phase 3 incident-immutability approach in STATE.md), not just SQL string-match.
- [ ] `playwright.phase4.config.ts` + `e2e/phase4-programs.spec.ts` — EN + ES at 390px over PM completion, deep-clean, DND config.
- [ ] `eslint-plugin-i18next` install + scoped override + one intentional-failure fixture proving the gate bites.
- [ ] Real-behavior test for `maybe_single()→None` on the new routes (bug-449 regression guard).

**Local constraint (D-11):** no AI/Stripe credentials locally — no Phase 4 core path is credential-gated, so this does not block validation. Flag any task that introduces such a dependency.

## Security Domain

`security_enforcement` is not disabled; included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase JWT (`hotel_id`+`role` claims); `get_current_user` |
| V4 Access Control | yes | `require_role()` per mutation (D-08); **fix G6 read gate, G7 chief_engineer** |
| V5 Input Validation | yes | Pydantic `SanitizedBaseModel` request models (already used) |
| V6 Cryptography | no (no new crypto) | — |
| V8 Data Protection | yes | Private `evidence-files` bucket + short-lived signed URLs (D-06); **fix G1** |
| V12 File Upload | yes | Content-type allowlist + size cap from `evidence.py` (reuse for PM attachments) |
| Multi-tenancy | yes | In-handler `.eq(tenant_id)` (primary) + RLS (secondary); service-role bypasses RLS |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read/write via missing filter | Information Disclosure / Tampering | In-handler `.eq("tenant_id")` on every query; route isolation test |
| Public storage URL leaks attachment | Information Disclosure | Private bucket + signed URL only (fix G1) |
| Tampering with completion/deferral history | Repudiation / Tampering | Append-only tables + immutability triggers (present); audit events (fix G2) |
| Over-broad config read by floor staff | Information Disclosure | `require_role` on overview (fix G6) |
| `SECURITY DEFINER` RPC exposed to anon/authenticated | Elevation of Privilege | 079 REVOKE/GRANT — N/A for 071 (no such RPC), enforce for any new one |

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/071_operational_programs.sql` — 12 tables, triggers, RLS policies (read in full)
- `apps/api/routers/programs.py`, `services/programs/{contracts,execution}.py` — router + policy logic
- `apps/api/routers/internal.py` — cron conventions, DND welfare (lines 601-669), canonical transition RPC (472)
- `apps/api/routers/evidence.py` — signed-URL (136) + upload (513) + audit (`_record_audit_event`) reuse patterns
- `apps/api/routers/assets.py:226` — the PM-complete endpoint the web UI actually calls
- `apps/api/models/requests.py:644` — `CompletePMProgramRequest` shape
- `apps/web/app/(dashboard)/{programs,engineering/pm-schedules}/page.tsx`, `lib/api/{programs,engineering}.ts`
- `apps/web/i18n/locales/en.ts`/`es.ts` (programs namespace at line 110), `eslint.config.mjs`
- `supabase/migrations/065`, `007` — work-order enum constraints (corrective WO validity)
- `HOTEL_STANDARDS_EXECUTION_PLAN.md` §Phase 4 (232-286); `04-CONTEXT.md`; `.planning/STATE.md`; `.github/workflows/ci.yml`

### Secondary (MEDIUM confidence)
- `eslint-plugin-i18next` as the `no-literal-string` provider — training knowledge; verify version + config spike (A1)

### Tertiary (LOW confidence)
- `property_applicability` column names (A2), prod completion-row counts (A3), `evidence_records` PM-linkage shape (A4) — verify in S0

## Metadata

**Confidence breakdown:**
- Scaffold audit (gap list): HIGH — every claim tied to file:line read this session.
- Standard stack: HIGH — reuses verified in-repo dependencies; only the CI-gate plugin is unverified.
- Architecture/reuse patterns: HIGH — evidence.py/internal.py patterns read directly.
- 4C CI tooling: MEDIUM — recommendation sound, plugin not yet installed/spiked.

**Research date:** 2026-07-22
**Valid until:** 2026-08-21 (stable in-repo contracts; re-verify if migrations >071 change program tables or if `evidence.py` upload API changes)
