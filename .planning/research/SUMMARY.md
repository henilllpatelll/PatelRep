# Project Research Summary

**Project:** PatelRep — AI Copilot Proactive Intelligence (milestone v1.6)
**Domain:** Proactive prediction-driven alerting + one-click actions on an existing hotel-ops SaaS
**Researched:** 2026-08-12
**Confidence:** HIGH

## Executive Summary

This milestone is an **integration study, not a greenfield build**. The two capabilities in scope — (a) making room-readiness predictions actionable with one-click reassign/escalate, and (b) proactive push parity for asset-failure predictions — are fully served by patterns, tables, and dependencies that already ship in the codebase. All four research tracks independently reached the same conclusion: **the work is wiring, not adopting.** Nothing new gets installed. No new Realtime subscription, no web-push stack, no new governance system, no new notification service. The correct implementation copies an idiom the codebase already runs (the room-readiness edge-triggered notification) and extends two existing UI surfaces (`PredictionPanel`, `AIRiskAlertsPanel`).

The recommended approach splits into **two independent tracks that can ship in parallel or either order**. Track A (backend, engineering domain) adds proactive push for failure predictions by mirroring the existing `notify_supervisors_high_risk` idiom, gated by edge-triggered dedup. Track B (frontend + light backend) deep-links the alert panel to real room/asset records and wires reassign/escalate to the *existing* `POST /housekeeping/assignments` endpoint. A governance-analytics wrapper (`ai_recommendations` for room-readiness) is optional, additive, and must be built last — only if unified ROI metrics are an explicit requirement. It must never gate the actions themselves.

**The load-bearing risk is entirely at the seam between the churning prediction cron and a user acting on a row the cron is about to rewrite.** Failure predictions use delete-then-insert (new UUID every night), so client-held prediction IDs go stale; the fix is to key every action off the stable entity (`asset_id`/`room_id`) and re-resolve server-side, never off the volatile prediction PK. The second-biggest risk is alert fatigue: the failure path has *no prior-state baseline to diff against* (the nightly wipe destroys it), so a naive "notify when risk >= 70" spams the chief engineer every single night. The mitigation — anchor the edge-trigger on `assets.failure_risk_score`, which survives the wipe, and read it *before* the overwrite — is the single most bug-prone spot in the milestone and must carry a double-run idempotency test. RBAC gating on new mutating endpoints is a recurring miss in this codebase (multiple prior incidents) and must be encoded per-action and covered by the existing RBAC-matrix CI test.

## Key Findings

### Recommended Stack

**Add nothing.** Both capabilities map onto already-installed dependencies and already-running patterns. This is the correct outcome given the project's explicit zero-dependency bias and the A2 architecture decision capping Supabase Realtime at exactly 3 surfaces. See STACK.md.

**Core technologies (all already installed — reuse, do not add):**
- `@radix-ui/react-toast` (via `components/ui/Toast.tsx`, globally mounted) — success/error feedback after one-click actions; `useToast()` already used in 8+ screens.
- `@tanstack/react-query` 5.101.4 — mutations + cache invalidation + polling; existing pattern in `Header` and `AIRiskAlertsPanel` (120s poll).
- `supabase` Python SDK 2.31.0 — new action endpoints and `notifications` inserts, no-ORM convention.
- `apscheduler` 3.11.3 — the existing nightly `ai.failure-predictions` cron gains a notifications-insert step; no new job.
- **Do NOT use:** web-push/VAPID/service workers, a 4th Realtime subscription, a bespoke `predictions_actions` table, a second toast library, or Twilio SMS in the MVP path (no local creds; floor staff are on the out-of-scope mobile app).

### Expected Features

Scope closes three gaps: `PredictionPanel.tsx` is read-only; `failure_predictions.py` sends *no* proactive notification (parity gap); `AIRiskAlertsPanel.tsx` links to generic lists (maintenance rows have no link at all). Chat/system-initiated copilot messaging is explicitly out of scope. See FEATURES.md.

**Must have (table stakes — v1.6 MVP):**
- Deep-linked alert rows (housekeeping -> room drawer; maintenance -> prediction card) — removes dead-end alerts.
- Failure-prediction proactive push with edge-triggered dedup watermark — closes the parity gap without fatigue.
- Room-readiness one-click reassign (AI pre-picked least-loaded housekeeper + one confirming tap) via existing governance affordance.
- Acknowledge on room-readiness predictions (suppresses re-push).

**Should have (competitive differentiators, v1.x):**
- Batch/grouped actions ("reassign all on floor 2") — after single-item actions ship, when supervisors report tap-fatigue.
- Escalation chain for un-actioned HIGH predictions -> GM — reuses the `escalation_level` watermark idiom from work orders.

**Defer (v2+):**
- Unified notification center — duplicates the bell + panel + per-domain dashboards; enhance the three existing surfaces first.
- Per-alert email/SMS — blocked on Twilio creds + the $2.50/room/mo cost cap; digest-only if ever.
- Silent auto-reassign / auto-create-WO — an **anti-feature**; consequential changes must keep a human in the loop.

### Architecture Approach

Two independent tracks, both pull-based (respecting Realtime scope C1) and both keeping logic in single-domain modules (respecting flat-services C2). The dedup backbone is a **level->edge conversion off persistent state**: convert a continuously-recomputed risk *band* into a one-shot *edge* by diffing against a value that survives the recompute. Room-readiness already does this off its upserted row; failure predictions must anchor on `assets.failure_risk_score` (which survives the nightly wipe) instead of the deleted `failure_predictions` row. See ARCHITECTURE.md.

**Major components:**
1. `services/ai/failure_predictions.py` — gains a `notify_engineers_high_failure_risk()` sibling to the existing room-readiness notifier; targets `chief_engineer` + `gm`; edge-triggers on `<70 -> >=70` crossing read *before* the score overwrite.
2. `notifications` table + `Header.tsx` bell — the **only** proactive-push channel (pull/poll); new `type='asset_risk_high'` rows surface automatically, no schema change.
3. `AIRiskAlertsPanel.tsx` + target pages — param'd hrefs (`?highlightRoom=` / `?asset=`) read via `useSearchParams`; routes already exist, no new route files.
4. Reassign/escalate — execute **directly** against the existing `POST /housekeeping/assignments` endpoint and the `notify` idiom; `ai_recommendations` is an optional analytics *wrapper*, never the execution path.

### Critical Pitfalls

1. **One-click action targets a prediction row the cron already deleted** (failure delete-then-insert mints a new UUID nightly) — key actions off the stable `asset_id`/`room_id`, re-resolve server-side, and flip `is_acknowledged=True` atomically so the acted row survives the wipe.
2. **Notification spam — re-notifying every cron cycle instead of on transition** (the failure path has no baseline to diff) — anchor the edge-trigger on `assets.failure_risk_score` read *before* overwrite; notify only on `<70 -> >=70`; add a re-notify cooldown for assets. Requires a double-run idempotency test asserting exactly one notification.
3. **Reassign acts on stale prediction fields instead of live room state** (`housekeeper_id`/`risk_level` are up to 30 min stale) — re-read `room_status` inside the request; guard against reassigning an already-clean room.
4. **Stale prediction rows never cleared -> ghost HIGH alerts + broken *silent* dedup** (a cleaned-then-re-dirtied room keeps `previous_risk=HIGH` and never re-notifies) — add a read-side freshness filter and clear stale rows at the end of each cron pass.
5. **Missing `require_role()` on new mutating endpoints** (a recurring miss here — multiple prior incidents) — encode the role matrix per-action; cover with the existing RBAC-matrix CI test.
6. **Notification insert crashes the whole cron** (direct precedent: `_queue_safety_notification` NoneType 500) — wrap per-tenant try/except, use `result.data or []`, guard `.maybe_single()` None.
7. **Deep-link 404s or cross-tenant leaks** — link to the stable entity, never a prediction PK; re-authorize `tenant_id` + role at the destination; graceful empty state for since-deleted predictions.
8. **Recipients resolved from `user_profiles` instead of `user_roles`** — standardize on `user_roles` with `is_active=True` so alert targeting can't diverge from who can actually act.

## Implications for Roadmap

The research converges on a build order that is **dependency-driven, not convenience-driven**. Track A and Track B are independent (different domains, files, tables) and do not block each other. The suggested phases below map directly onto that split.

### Phase 1: Failure-Prediction Proactive Push + Dedup (Track A)
**Rationale:** Highest value, lowest risk, fully self-contained in one file + one existing table, matches an existing idiom exactly, zero frontend dependency. Closes the glaring "failure predictions never proactively alert" parity gap.
**Delivers:** `notify_engineers_high_failure_risk()` in `failure_predictions.py`; edge-trigger anchored on `assets.failure_risk_score` captured before overwrite; recipients from `user_roles` `is_active=True`; per-tenant try/except isolation.
**Uses:** existing `notifications` table + bell (no schema change), `apscheduler` nightly job.
**Avoids:** Pitfall 2 (spam), 6 (cron crash), 8 (wrong recipient table). **Must carry the double-run idempotency test** (run nightly cron 3x on unchanged data -> exactly 0 repeat notifications).

### Phase 2: Deep-Linked Alert Surfaces (Track B1)
**Rationale:** Pure frontend (2 pages + 1 component); unblocks actionable UX for *both* prediction types and is a prerequisite for reassign feeling complete (a "Reassign" link is only useful if it lands on the right room). Adds the missing maintenance-row link — the biggest single UX gap.
**Delivers:** param'd hrefs in `AIRiskAlertsPanel.tsx`; `useSearchParams` highlight on `housekeeping/page.tsx` and `engineering/predictions/page.tsx`; destination re-authorization + graceful empty state.
**Implements:** pull-based proactive surfaces (C1-safe; routes already exist).
**Avoids:** Pitfall 7 (deep-link auth/404), and read-side of Pitfall 3 (freshness filter).

### Phase 3: Room-Readiness One-Click Reassign / Escalate (Track B2)
**Rationale:** Depends on Phase 2 for good UX; reuses the already-verified `POST /housekeeping/assignments` endpoint so backend work is near-zero. Executes directly — governance is not the execution path.
**Delivers:** action buttons on `PredictionPanel.tsx` (`useMutation` + `useToast()`); reassign pre-picked to least-loaded housekeeper (`count_rooms_ahead` / `housekeeper_profiles`) with one confirming tap; escalate via the `notify` idiom; acknowledge that suppresses re-push; per-action `require_role`.
**Addresses:** the "make predictions actionable" core ask.
**Avoids:** Pitfall 1 (act off stable entity), 2/reassign variant, 3 (stale fields + already-clean guard), 5 (RBAC).

### Phase 4 (optional, LAST): ai_recommendations Governance Wrapper for Room-Readiness (Track C1)
**Rationale:** Additive analytics/ROI only; must not gate the action. Build **only** if unified outcome metrics ("flagged 40 at-risk rooms, staff acted on 32, prevented 28 late check-ins") are an explicit requirement.
**Delivers:** edge-triggered materialization of `ai_recommendations` rows (new HIGH only, never one-per-room-per-cron) reusing the existing `/recommendations` + `/metrics` endpoints; schema already supports `source_type='room_readiness'` (migration 073, no migration needed).
**Avoids:** Anti-Pattern 1 (governance-queue firehose).

### Phase Ordering Rationale

- **Track A before/parallel to Track B:** A is self-contained backend with no frontend dependency; it can proceed independently and is the highest-value gap closure.
- **B1 before B2:** deep-linking is a prerequisite for reassign UX to feel complete — the reassign action lands via the deep-linked room drawer.
- **C1 strictly last and optional:** governance must be decoupled from correctness; wiring it early would risk forcing the every-30-min room firehose through the human-decision queue.
- The dedup design (edge-trigger off persistent state) is the connective tissue across A and C1 and the single most important design decision — it is a *correctness* concern, not a scale one.

### Research Flags

Phases likely needing deeper research/careful design during planning:
- **Phase 1 (Failure push + dedup):** the ordering hazard (read prior `assets.failure_risk_score` *before* the overwrite at lines 410-413) is the most bug-prone spot in the milestone. Flag the delete-then-insert -> upsert-on-`(tenant_id, asset_id)` decision and the re-notify cooldown policy explicitly. Warrants a focused design pass + the double-run test.
- **Phase 3 (Reassign):** the live-state re-read contract and the least-loaded picker tie-break rules deserve explicit specification; the role matrix (can a housekeeper reassign their own late room, or supervisor-only?) is an open product question to settle in planning.

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 2 (Deep-linking):** bounded, well-understood App Router `useSearchParams` change; no new routes.
- **Phase 4 (Governance wrapper):** the `ai_recommendations` lifecycle is already built and wired for failure predictions; extending it to room-readiness is a known pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Installed versions read directly from `package.json`/`requirements.txt`; every recommendation is "reuse existing." No external adoption risk. |
| Features | HIGH | Internal grounding in current code (verified read-only panels, missing notification path) plus external CMMS/housekeeping-SaaS norms corroborating the alert-fatigue and actionability findings. |
| Architecture | HIGH | Every integration decision verified against current source with file/line citations; two hard constraints (C1 Realtime scope, C2 flat services) respected throughout. |
| Pitfalls | HIGH | Grounded in this project's own prediction/notification code AND its bug history (`.wolf/buglog.json`, `.wolf/cerebrum.md`) — project-specific, not generic advice. |

**Overall confidence:** HIGH

### Gaps to Address

- **Role matrix for reassign is a product decision, not a code fact.** Research recommends supervisor/GM-only (a housekeeper reassigning off their own queue is a workload-gaming risk), with self-service modeled as an escalation *request* rather than a direct reassign. Confirm with the product owner during Phase 3 planning.
- **Failure-prediction storage model choice** (keep delete-then-insert + anchor on `assets.failure_risk_score`, vs. convert to upsert-on-`(tenant_id, asset_id)`). Research leans toward upsert for stable in-flight references, but the score-anchor works without a schema change. Decide in Phase 1 planning; the double-run test validates either choice.
- **Re-notify cooldown cadence for assets** (e.g. don't re-alert the same asset within 7 days even if it re-crosses) is a policy value to set with the GM, not derivable from code.
- **Whether ROI/outcome metrics are in scope** determines whether Phase 4 is built at all. Flag for milestone requirements.

## Sources

### Primary (HIGH confidence — internal, read directly)
- `apps/api/services/ai/predictions.py` — room-readiness engine: upsert-on-`room_id`, `existing_risk_map` transition dedup, `notify_supervisors_high_risk` (the idiom to mirror).
- `apps/api/services/ai/failure_predictions.py` — delete-then-insert (392-399), `assets.failure_risk_score` update (410-413), no notification path (the parity gap).
- `apps/api/routers/ai_copilot.py:768-969` — risk-alerts aggregation + `ai_recommendations` lifecycle endpoints.
- `apps/api/routers/internal.py::check_escalations` — `escalation_level` persisted-counter dedup (the watermark model).
- `apps/api/routers/notifications.py` — recipient resolution via `user_roles`, tenant+user scoping.
- `supabase/migrations/073_pms_ai_governance.sql` — `ai_recommendations` lifecycle, `source_type='room_readiness'` + `adjust_room_assignment`/`notify_supervisor` already allowed; migration 013 (`notifications`, `room_readiness_predictions`).
- `apps/web/components/dashboard/AIRiskAlertsPanel.tsx`, `components/housekeeping/PredictionPanel.tsx`, `components/shared/Header.tsx`, `components/ui/Toast.tsx` — current UI surfaces.
- `apps/web/package.json` / `apps/api/requirements.txt` — authoritative installed versions.
- `.wolf/buglog.json` / `.wolf/cerebrum.md` — prior incidents (`get_current_user` vs `require_role`, NoneType cron 500, cron all-stale, RBAC-matrix test) and the authorize/assignment contracts.
- `CLAUDE.md` — constraints A1 (flat services / C2), A2 (Realtime scoped to 3 surfaces / C1), Current Scope (web-only, no local Twilio/AI creds), $2.50/room/mo cap.

### Secondary (MEDIUM confidence — external validation)
- OneUptime, Icinga — monitoring/alerting best practices to reduce alert fatigue (edge-triggering, tiering).
- oxmaint, TMA Systems — predictive-maintenance alert-fatigue + "every alert tier auto-attaches an action" norms.
- HotelTechReport, HelloShift, Unifocus — hotel-housekeeping SaaS reassignment norms (auto-balance by productivity/proximity, human-in-loop).

---
*Research completed: 2026-08-12*
*Ready for roadmap: yes*
