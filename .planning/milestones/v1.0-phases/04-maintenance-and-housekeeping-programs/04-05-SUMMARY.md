---
phase: 04-maintenance-and-housekeeping-programs
plan: 05
subsystem: ui
tags: [pm-completion, evidence-platform, react-query, next.js, checkpoint]
dependency-graph:
  requires:
    - "04-02: evidence-ID-as-reference contract (evidence_records.id, not raw URLs); signed-URL read path"
    - "04-03: corrective-work-order priority/due_at hardening; containment audit on failed items"
    - "04-04: pm_checklist_templates.items {checklist, default_frequency_days} JSONB shape; template editor/builder routes"
  provides:
    - "PMCompletionModal — the full defensible PM completion capture form, replacing the canned technician_attestation stub"
    - "programsApi.completePM/deferPM/uploadEvidence/getPMCompletion typed clients (apps/web/lib/api/programs.ts)"
    - "chief_engineer added to GET /staff's role gate — required for the verifier selector to work for that role"
  affects:
    - apps/web/lib/api/programs.ts
    - apps/web/lib/api/engineering.ts
    - apps/web/components/engineering/PMCompletionModal.tsx
    - apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx
    - apps/api/routers/staff.py
tech-stack:
  added: []
  patterns:
    - "uploadEvidence() wraps evidenceApi.createRecord + uploadRecordFile rather than duplicating the create-record-then-upload-file flow — every attachment (checklist-item evidence, vendor certificate, general photos) goes through this one path and returns only the evidence_record id, never a raw URL (D-06)."
    - "Client-side result gate: LocalItem.result starts unset ('') rather than defaulting to 'passed' — the technician must actively choose Passed/Failed/N-A for every checklist item before submit is allowed."
key-files:
  created:
    - apps/web/components/engineering/PMCompletionModal.tsx
  modified:
    - apps/web/lib/api/programs.ts
    - apps/web/lib/api/engineering.ts
    - apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx
    - apps/api/routers/staff.py
decisions:
  - "Worktree branch predated 04-01 through 04-04 landing on local main (same gap each prior 04-* plan in this phase independently documented); fast-forward merged local main (c0b8edfa) into this branch before starting — clean fast-forward, no divergent local commits."
  - "Neither apps/web nor apps/api had node_modules/a Python env installed in this worktree (a new gap this plan hit that no prior 04-* plan needed, since they were API-only and used the system Python). Ran npm install in the repo root and in apps/web to get type-check/lint working; apps/api tests ran against the already-installed system Python (fastapi/pytest present globally, no venv needed here)."
  - "GET /staff excluded chief_engineer from its role gate, but complete_pm_schedule already allows chief_engineer to complete a PM — so the new verifier selector would 403 for that role. Added chief_engineer to routers/staff.py's list_staff gate (Rule 2 — missing critical functionality directly required by this plan's own UI). Full 330-test API suite still passes."
  - "Checklist items default to a single 'General completion check' item when no template is selected, rather than reusing the old canned technician_attestation wording — keeps the form usable for PM schedules with no matching named template while making clear this is a real, editable checklist item (pass/fail/n-a + note), not an attestation stand-in."
metrics:
  duration: "~25 min (Tasks 1-2) + orchestrator-performed checkpoint verification"
  completed: "2026-07-23"
---

# Phase 4 Plan 05: PM Completion Capture UI Summary

Replaced the stub PM "Complete" button (which posted one canned `technician_attestation` item) with `PMCompletionModal` — a full defensible completion form capturing per-item checklist results, a verifier distinct from the technician, measurements/meter readings, labor minutes, structured parts/defects, vendor certificate and photo evidence (all via the private-bucket evidence platform), wired to the hardened backend contract from 04-02/04-03/04-04.

## What Was Built

### Task 1 — PM completion + deferral + evidence-upload typed clients (commit `ad2e3759`)

`apps/web/lib/api/programs.ts` gained:
- `PMChecklistItemInput`, `PMPart`, `PMDefect`, `PMCompletionPayload`, `PMCompletionRecord`, `PMDeferralPayload`, `PMDeferralRecord` types mirroring `apps/api/models/requests.py`'s `CompletePMProgramRequest`/`PMChecklistResultItem`/`CreatePMDeferralRequest` exactly.
- `programsApi.completePM(scheduleId, payload)` → `POST /assets/pm-schedules/{id}/complete`.
- `programsApi.getPMCompletion(scheduleId, completionId)` → the 04-02 signed-URL read path.
- `programsApi.deferPM(scheduleId, payload)` → `POST /programs/pm-schedules/{id}/deferrals`.
- `programsApi.uploadEvidence(file, opts)` — creates an `evidence_record` then uploads the file to it, returning only the `evidence_record.id`. This reuses `evidenceApi.createRecord` + `uploadRecordFile` (already built for the Phase 2 evidence platform and used by `app/(dashboard)/evidence/page.tsx`) rather than duplicating the create-then-upload flow.
- `ProgramTemplate` gained an `items` field matching the `{checklist: [...], default_frequency_days}` JSONB shape 04-04 introduced, so the completion form can read a template's checklist.

`apps/web/lib/api/engineering.ts`: removed the stub `completePMSchedule` (which posted a single hardcoded `technician_attestation` "passed" item with no evidence, verifier, measurements, parts, or defects).

### Task 2 — PMCompletionModal defensible capture form (commit `7ef18d65`)

`apps/web/components/engineering/PMCompletionModal.tsx` (620 lines), replacing `pm-schedules/page.tsx`'s old `CompletePMModal` stub:
- **Template selector**: optional dropdown of engineering `pm_checklist_templates`; selecting one seeds the checklist items from `template.items.checklist`. No template → a single default "General completion check" item.
- **Checklist items**: each renders Passed/Failed/N-A toggle buttons (unset by default — the technician must actively choose), an optional note, and — when `requires_evidence` — a photo-attach control that uploads via `uploadEvidence` and stores the returned `evidence_record.id` on the item. A Failed result shows an inline notice that a corrective work order will be created.
- **Verifier**: dropdown of active staff (`staffApi.list()`), excluding the current user — enforced client-side to be distinct from the technician submitting the form (T-04-18).
- **Measurements + meter readings**: dynamic key/value row editors, converted to plain objects on submit.
- **Labor minutes, parts (name/qty/cost), defects (description/severity)**: add/remove row editors.
- **Vendor name + certificate attachment, additional photos**: uploaded the same way as item evidence (`evidence_type: 'external_certificate'` / `'photo'`).
- **Client-side validation**: blocks submit if any item has no result chosen, or if a `requires_evidence` item (with a non-`not_applicable` result) has no evidence attached — mirroring the server's `EvidenceRequiredError` check (T-04-16) without replacing it; the server 422 is still authoritative and its detail message is surfaced via the existing `ApiClientError` friendly-message path if the client-side check is somehow bypassed.
- `pm-schedules/page.tsx`: imports `PMCompletionModal` in place of the removed `CompletePMModal`; `canEdit` now includes `chief_engineer`.

**Verification (this executor, Tasks 1-2):** `cd apps/web && npm run type-check` → clean; `npm run lint` → clean; `cd apps/api && python -m pytest tests/ -q` → 330 passed (confirms the `staff.py` deviation below didn't regress anything).

### Task 3 — Checkpoint (human-verify), resolved by the orchestrator

This plan is `autonomous: false` with a blocking `checkpoint:human-verify` gate. Per this project's mandatory Self-Verification Policy, the orchestrator (not this worktree executor, which has no browser tool) performed the live verification against the running dev servers (localhost:3000 + localhost:8003, GM test account) and reported: **APPROVED**.

Reported results (relayed by the orchestrator, not independently re-run by this worktree executor — this executor has no Supabase/production DB access or browser tool):
- All fields render (template selector, checklist results, verifier dropdown correctly including `chief_engineer`, measurements, meter readings, labor minutes, parts, defects, vendor name + certificate, additional photos, notes).
- Client-side validation correctly blocked submit with no checklist result selected.
- Marking an item Failed showed the corrective-work-order notice.
- A full completion submit (verifier + measurement + part) succeeded (200); the PM schedule's `next_due_at`/`last_completed_at` advanced correctly, and a real corrective work order was created with `priority=urgent`, `due_at=+24h` — confirming 04-03's wiring works through this UI.
- A photo attach went through `POST /evidence/records` then `POST /evidence/records/{id}/file` (never a raw URL, D-06); reading the completion back afterward resolved the photo to a real Supabase signed URL (`.../storage/v1/object/sign/evidence-files/...?token=...&expires_in_seconds=3600`), not a public/raw path.
- Zero console errors throughout.

Test data created during this verification (an asset named "Rooftop HVAC Unit A - QA Verification", 2 `pm_schedules`, 2 `pm_completion_records`, 1 corrective work order, 1 `evidence_record`) could not be deleted — `pm_completion_records`/`pm_completion_items` are append-only and blocked the orchestrator's DELETE attempt with "Operational program records are append-only." This is a correct confirmation of the append-only guarantee established in earlier phases, not a bug; the data remains in the dev database, clearly named.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `chief_engineer` excluded from `GET /staff`**
- **Found during:** Task 2, while wiring the verifier selector
- **Issue:** `apps/api/routers/assets.py`'s `complete_pm_schedule` already allows `chief_engineer` to complete a PM (`require_role("engineer", "gm", "chief_engineer")`), but `routers/staff.py`'s `list_staff` — which the new verifier dropdown depends on — was gated to `gm, housekeeping_supervisor, engineer, front_desk` only. A chief_engineer opening this exact form would get a 403 on the verifier list.
- **Fix:** Added `chief_engineer` to `list_staff`'s `require_role(...)` tuple.
- **Files modified:** `apps/api/routers/staff.py`
- **Verification:** `apps/api/tests/smoke/test_tenant_isolation.py::test_staff_list_hotel_a_sees_no_hotel_b_staff` (calls `list_staff` directly, bypassing the dependency) plus the full suite — `pytest tests/ -q` → 330 passed.
- **Committed in:** `7ef18d65` (Task 2 commit)

### Environment / Tooling Gap (not a plan gap)

**What was found:** Unlike the prior 04-01 through 04-04 plans (API-only, ran against an already-available system Python), this plan is web-first and the worktree had no `apps/web/node_modules` — `npm run type-check`/`lint` failed at collection with "Cannot find module" errors for every dependency, not just this plan's new code.
**Fix:** Ran `npm install` at the repo root (patch-package postinstall) and again inside `apps/web` (the actual package with its own `package.json`/dependencies — this repo is not an npm workspace). After install, `type-check` and `lint` ran clean against only this plan's changes.

### Worktree base-state gap (recovery, not a plan gap)

Same pattern each prior 04-* plan in this phase documented: this worktree branch was created before 04-01 through 04-04 landed on local `main`. Confirmed `git merge-base --is-ancestor HEAD main` was true (clean fast-forward, no divergent local commits) and fast-forward merged (`268f7474` → `c0b8edfa`) before starting any work.

## Known Stubs

None — every field in `PMCompletionModal` is wired to a real backend field (`CompletePMProgramRequest`) and every attachment path (item evidence, certificate, general photos) goes through the real evidence-platform upload flow (`evidenceApi.createRecord` + `uploadRecordFile`), not a hardcoded/mock value.

## Threat Flags

None beyond what this plan's own `<threat_model>` already enumerated (T-04-16 through T-04-18) and implemented mitigations for:
- T-04-16 (evidence-required bypass): client mirrors the server's evidence-required check but the server 422 remains authoritative.
- T-04-17 (attachment display): photos/certificates are only ever referenced by `evidence_record.id`; the UI never receives or stores a raw storage path — resolution to a signed URL happens entirely server-side on read.
- T-04-18 (verifier == technician): verifier dropdown excludes the current user client-side; the deferral approver's distinct-from-requester rule is already backend-enforced (04-03).

The `chief_engineer` addition to `GET /staff` is not new unenumerated surface — `chief_engineer` is already a first-class engineering-domain role with broader PM/work-order authority than the read-only staff list this change grants it access to.

## Self-Check: PASSED

- FOUND: `apps/web/components/engineering/PMCompletionModal.tsx` (620 lines)
- FOUND: `apps/web/lib/api/programs.ts` contains `completePM`, `deferPM`, `uploadEvidence`
- FOUND: `grep -c technician_attestation apps/web/lib/api/engineering.ts` → 0
- FOUND: commit `ad2e3759` (Task 1)
- FOUND: commit `7ef18d65` (Task 2)
- VERIFIED (this executor): `cd apps/web && npm run type-check` → clean
- VERIFIED (this executor): `cd apps/web && npm run lint` → clean
- VERIFIED (this executor): `cd apps/api && python -m pytest tests/ -q` → 330 passed
- VERIFIED (this executor, corroborating evidence only): `.wolf/buglog.json` bug-478 entry exists in the shared checkout, matching the orchestrator's reported root cause (`apps/api/routers/assets.py`'s `create_pm_schedule` calling `request.model_dump()` without `mode="json"`, leaving `asset_id` as a non-serializable UUID) — pre-existing (2026-03-11), unrelated to any 04-* plan, correctly left unfixed here (out of scope).
- NOT INDEPENDENTLY VERIFIED by this executor (attributed to the orchestrator's report; this worktree executor has no browser tool and no Supabase MCP/production DB access): the Task 3 Playwright checkpoint walkthrough itself, and the claimed application of migrations 081/083 to the production Supabase project. Both are documented above as reported, not as this executor's own confirmed fact.
