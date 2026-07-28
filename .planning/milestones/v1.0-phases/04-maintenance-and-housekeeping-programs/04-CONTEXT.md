# Phase 4: Maintenance and housekeeping programs - Context

**Gathered:** 2026-07-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn recurring engineering (preventive-maintenance) and housekeeping work into complete, evidence-backed, **defensible** programs — where completion proves actual work was done rather than merely moving a due date — and enforce the bilingual floor contract. Built as web + API slices on top of the already-applied Phase 4 schema (migration `071_operational_programs.sql`) and the **existing, unverified** `programs.py` scaffold.

Three delivery areas, sliced as **S0 → 4A → 4B → 4C**:

- **S0 — Scaffold audit + gap-fix:** verify the pre-existing `programs.py` + migration 071 + web pages + `test_operational_programs.py` against the locked cross-phase contracts and Phase 4 exit criteria; fix every gap before building on it. (See D-01.)
- **4A — Engineering / preventive maintenance:** immutable PM completion records, versioned checklist results, technician + verifier, measurements/meter readings, photos/labor/structured parts/defects/corrective work orders, deferral reason + approval, vendor + certificate attachments, asset criticality/downtime/warranty/cost context, and a property-configurable PM template library (fire extinguishers, emergency lighting, fire alarm + sprinkler, elevator certificates, pool, domestic-water monitoring/flushing, backflow, + generic builder).
- **4B — Housekeeping program depth:** deep-clean and rotational-cleaning schedules, public-area locations + recurring frequencies, inspection sampling rules (by experience/room type/risk), inspection quality trends (by item/room type/employee), stayover linen change-frequency rules, lightweight linen/chemical/amenity par alerts, property-configurable DND welfare timing + documented escalation policy, and privacy/guest-present-entry/sharps/body-fluid/spill-response checklist templates.
- **4C — Bilingual floor contract (closing slice):** translate all floor-role critical workflows EN + ES, add scoped CI detection for new hardcoded floor-facing copy, and verify critical workflows at phone width (390px) in both languages.

**Out of scope:** guest recovery / management ROI (Phase 5); PMS + AI expansion (Phase 6, pilot-gated); building any hardware or live device intake; Stripe/AI-provider-dependent paths; Vercel repair; all `apps/mobile/` work; full-app GM-facing i18n (GM analytics/config/inspector-export stay English — see D-03).

</domain>

<decisions>
## Implementation Decisions

### Scaffold disposition
- **D-01:** **Adopt the existing scaffold as the foundation, audit-first.** Migration `071_operational_programs.sql` (12 tables, immutability triggers) is already applied to production and `programs.py` is registered in `main.py` and deployed — but the scaffold predates any Phase 4 plan and is **unverified against the locked contracts**. Phase 4 opens with **Slice 0**: a verification pass of `programs.py`, migration 071, the web pages (`(dashboard)/programs`, `(dashboard)/engineering/pm-schedules`), `lib/api/programs.ts`, and `test_operational_programs.py` against (a) tenant scoping on every query, (b) RLS on all 12 tables, (c) signed-URL delivery for PM/vendor/certificate attachments, (d) immutability triggers actually enforced (not just declared), (e) `require_role()` correctness per route, and (f) the Phase 4 exit criteria. Fix every gap found, then build missing surfaces. Do **not** rebuild correct code from scratch. Because `programs.py` is **live in production against real tenant data**, treat any contract violation found in S0 as a production-security finding, not just a Phase 4 task.

### Slice order
- **D-02:** Build in order **S0 audit → 4A PM programs → 4B housekeeping depth → 4C bilingual**. PM leads (after audit) for the highest regulatory/defensibility value (Texas fire/elevator/backflow/water obligations). Bilingual is a **dedicated closing slice**, not woven per-slice, so the CI gate + phone-width EN/ES Playwright pass runs once over everything 4A/4B touched, avoiding mid-build translation churn.

### Bilingual floor contract
- **D-03:** **Translation scope = all floor-role critical workflows, EN + ES.** Covered: housekeeping, engineering / work-orders, tasks, PM completion, deep-clean, DND, and their notification / empty-state / error / validation copy. **Stays English:** GM-facing dashboards, config, inspector export, reports/analytics. This mirrors the Phase 3 D-07/D-08 split (floor staff bilingual, GM-facing English) and discharges the deferred-backlog item "web i18n for engineering's hardcoded English copy."
- **D-04:** **CI hardcoded-copy gate = scoped hard-fail.** CI fails the build if a raw user-facing string literal (JSX text, `aria-label`, `placeholder`, `title`) appears in floor-facing directories (`components/housekeeping`, `components/engineering`, and `app/(dashboard)/{housekeeping,engineering,tasks,programs}` and equivalents). GM/admin/config/export dirs and test ids are allowlisted (consistent with the D-03 English carve-out). Advisory-only was rejected — the plan requires enforcement.

### PM template library
- **D-05:** **Seed all named PM templates + a generic builder.** Ship fire extinguisher, emergency lighting, fire alarm + sprinkler, elevator certificate, pool, domestic-water flushing, and backflow as property-configurable defaults (frequency + checklist items editable), **applicability-gated via Phase 2's `property_applicability`** so pool / backflow / domestic-water only surface where the facility exists. Add a generic template builder for "other configured obligations." Extend the existing `POST /templates/initialize` seeding route rather than adding a parallel mechanism.

### Carried forward from Phases 1–3 (locked — not re-discussed)
- **D-06:** Reuse the evidence platform: Phase 2 `evidence_records` + private `evidence-files` bucket with short-lived signed URLs for all PM completion photos, vendor certificates, and checklist attachments. Never expose public storage URLs.
- **D-07:** Reuse Phase 1/2 `operational_audit_events` (append-only) for material changes + structured reason codes (e.g., PM deferral approval, failed-check containment), and `notification_deliveries` for reminder/escalation channel + outcome history (par alerts, DND escalation, overdue PM). No parallel audit or notification mechanism.
- **D-08:** Every table and query is tenant-scoped (`.eq("hotel_id"/"tenant_id", ...)`), backed by RLS, and every mutation gated with `require_role()`.
- **D-09:** **Security discipline (migration 079 lesson):** any new `SECURITY DEFINER` RPC must `REVOKE EXECUTE FROM anon, authenticated, PUBLIC` and `GRANT EXECUTE TO service_role` only. Verify existing 071 RPCs (if any) meet this in S0.
- **D-10:** Recurring/scheduled work (PM due checks, deep-clean recurrence, par alerts, DND welfare escalation) uses the existing `routers/internal.py` `X-Cron-Secret` convention and writes to `cron_health` (migration 068). Reuse the live `/v1/internal/pm/check-due` job and the GitHub-Actions cron driver — do not build a parallel scheduler.
- **D-11:** Web + API only; no `apps/mobile/` changes. No core path may depend on local AI-provider or Stripe credentials.
- **D-12:** **Plan-review gate:** stop after planning and present the complete Phase 4 plan for user review before any execution begins.
- **D-13:** Build complete vertical web + API slices with focused tests; do not create tables or screens disconnected from an operational workflow.

### Claude's Discretion
- Exact route shapes and schema refinements on top of migration 071; per-mutation role sets; cron cadences; DND welfare threshold defaults; how par alerts surface (passive dashboard badge vs. queued `notification_deliveries`); corrective-work-order linkage from a failed PM check; inspection-sampling algorithm and quality-trend aggregation; PM checklist storage shape (completion items vs. evidence record); and component layout — select from existing project patterns as long as the locked contracts above hold.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and phase scope
- `HOTEL_STANDARDS_EXECUTION_PLAN.md` §Phase 4 — source of scope (PM, housekeeping depth, bilingual), tests, and exit criteria.
- `.planning/ROADMAP.md` — phase goal, dependencies, deferred backlog.
- `.planning/STATE.md` — Phase 0–3 closure evidence; confirmation that migrations 070–073 are already applied to production.
- `.planning/PROJECT.md` — product value, constraints, out-of-scope rules.

### Existing Phase 4 scaffold (audit target — S0)
- `supabase/migrations/071_operational_programs.sql` — the 12 tables this phase builds on: `pm_checklist_templates`, `pm_completion_records`, `pm_completion_items`, `pm_deferrals`, `public_areas`, `deep_clean_schedules`, `deep_clean_occurrences`, `inspection_sampling_rules`, `housekeeping_supply_pars`, `housekeeping_stayover_rules`, `dnd_welfare_policies`, `dnd_welfare_events`, plus `reject_operational_program_mutation()` immutability trigger. **Applied to prod; validate + build on rather than redefine.**
- `apps/api/routers/programs.py` — existing router (registered in `main.py`): overview, `templates/initialize`, PM complete-with-evidence, deferrals, public areas, deep-clean schedules + completion, supply pars, stayover rules, DND welfare policy, inspection sampling, inspection quality. **Audit for contract compliance in S0.**
- `apps/web/app/(dashboard)/programs/page.tsx`, `apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx`, `apps/web/lib/api/programs.ts` — existing web surfaces + client (completeness unverified).
- `apps/api/tests/test_operational_programs.py` — existing tests (verify they exercise real contracts, not fake-Supabase happy paths — cf. the bug-449 lesson where the fake harness masked a prod bug).
- `supabase/migrations/008_assets_pm.sql`, `009_inspections.sql` — pre-existing PM schedule + inspection schema the programs build on (`pm_schedules`, inspection templates).

### Existing contracts to reuse
- Phase 2 evidence migrations `069`–`078` — `property_applicability` (D-05 gating), `evidence_records`, private `evidence-files` bucket (D-06 attachments).
- `supabase/migrations/065_work_order_transition_audit.sql` — append-only `operational_audit_events` schema + mutation guard (D-07).
- `supabase/migrations/067_notification_delivery_history.sql` — notification channel/outcome history for reminders, par alerts, escalations (D-07).
- `supabase/migrations/068` (`cron_health`) — per-job staleness tracking every cron endpoint writes to (D-10).
- `supabase/migrations/079_restrict_security_definer_rpcs.sql` — the exact REVOKE/GRANT pattern for any `SECURITY DEFINER` RPC (D-09).
- `apps/api/routers/internal.py` — `X-Cron-Secret`-guarded cron convention; already hosts `/pm/check-due` and DND welfare check (D-10).
- `apps/api/routers/clean_sessions.py` — tenant-scoped private upload + one-hour signed-URL retrieval pattern for evidence attachments.
- `apps/api/middleware/auth.py` — `require_role()` / `CurrentUser` RBAC gate (D-08).
- `.github/workflows/cron-jobs.yml` — GitHub-Actions cron driver hitting `/v1/internal/*` (verified firing 2026-07-22); Phase 4 recurring jobs register here.

### i18n reference
- `apps/web/i18n/en.ts` / `es.ts` — the **live** react-i18next locale files (Phase 3 established web i18n here; note the `.json` variants were dead and deleted — bug-448). Extend these for 4C.
- `apps/mobile/i18n/` (en/es) — existing EN/ES floor-string translations to draw from (mobile stays parked; reference only).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Migration 071 (12 tables + immutability triggers) already in prod — Phase 4 is primarily audit + routers + web + tests, not net-new data modeling.
- A `programs.py` router (registered, deployed) already implements most PM/HK routes — S0 audits and completes it rather than starting empty.
- Phase 2 `property_applicability` gates which PM templates surface (D-05); `evidence_records` + private bucket covers all PM/vendor attachments (D-06).
- Phase 1/2 exception + reminder/escalation + `notification_deliveries` machinery is the template for par alerts, overdue-PM, and DND escalation.
- `internal.py` cron + `cron_health` + the GitHub-Actions driver cover all recurring jobs; `/pm/check-due` already exists.

### Established Patterns
- API handlers: direct Supabase SDK, explicit tenant filter, `require_role()` gate, `{ "data": ... }` responses; lists add `meta` pagination; new routers register in `main.py` with a `/v1/...` prefix.
- Append-only completion model: `pm_completion_records` / `pm_deferrals` / `deep_clean_occurrences` are immutable (trigger-enforced) — corrections append, never mutate.
- Web state: React Query for server data, Zustand for auth; no Realtime for these standard program screens (pull/refresh).
- Web i18n: react-i18next via `en.ts`/`es.ts` (NOT `.json`); Phase 3 established the pattern for scoped surfaces.

### Integration Points
- Failed PM checks should spawn corrective work orders through the Phase 1 canonical work-order transition contract, not ad-hoc status writes.
- PM completion photos, vendor certs, and SDS-adjacent attachments link to `evidence_records` (evidence platform FK pattern).
- Pool / backflow / domestic-water templates gate on `property_applicability` (Phase 2) — only appear where the facility is configured.
- DND welfare timing/escalation extends the existing `/rooms/{id}/welfare-check` + internal.py escalation, now made property-configurable via `dnd_welfare_policies`.
- 4C bilingual work is additive to Phase 3's web i18n foundation — extend `en.ts`/`es.ts`, do not create a new mechanism.

</code_context>

<specifics>
## Specific Ideas

- **PM defensibility exit test:** a completion record proves *actual work* — technician + verifier, versioned checklist results, measurements/meter readings, photos, labor, structured parts, defects — not merely a moved due date. A failed check must produce containment + a corrective follow-up action.
- **Housekeeping floor outcome:** deep-clean and public-area schedules replace paper calendars; inspection sampling is rule-driven (experience/room type/risk) with quality trends visible by item/room-type/employee; par alerts are lightweight (linen/chemical/amenity).
- **DND welfare:** property-configurable timing threshold + a documented escalation policy, with duplicate-prevention on welfare events.
- **Bilingual proof:** critical floor workflows genuinely usable in EN and ES, verified via Playwright at desktop **and 390px** width; the scoped CI gate prevents new untranslated floor-facing copy from landing.
- **S0 honesty:** because the scaffold is live in prod, S0 findings that are contract violations (missing tenant filter, public URL, unenforced immutability, wrong role gate) are production-security fixes to land immediately, logged like bug-448/bug-449.

</specifics>

<deferred>
## Deferred Ideas

- Full-app GM-facing web i18n (analytics, config, inspector export) — intentionally English per D-03; revisit only if a bilingual GM requirement emerges.
- Guest recovery + management ROI — Phase 5.
- PMS + AI expansion (`ai-copilot-primary-interface.md`, `sop-voice-fastpath.md`) — Phase 6, pilot-gated.
- Vercel remediation (delete broken project or repair invalid CLI token + stale embedded API URL) — one-time infra decision; Railway remains production.
- EAS build, mobile i18n handoff, rooms debugging — parked; Phase 4 is web + API only.

</deferred>

---

*Phase: 4-maintenance-and-housekeeping-programs*
*Context gathered: 2026-07-22*
