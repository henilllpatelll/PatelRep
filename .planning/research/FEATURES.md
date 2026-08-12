# Feature Research

**Domain:** Proactive AI alerting + one-click actions for hotel ops / predictive-maintenance SaaS (PatelRep v1.6)
**Researched:** 2026-08-12
**Confidence:** HIGH (internal grounding in existing code; external validation from CMMS/predictive-maintenance + hotel-housekeeping SaaS norms)

## Scope Recap

This is a **subsequent milestone** on an existing app. Three gaps to close:

1. Make **room-readiness predictions actionable** (`PredictionPanel.tsx` is read-only today).
2. **Proactive push parity** for failure predictions (room-readiness already pushes on HIGH escalation via `services/ai/predictions.py::notify_supervisors_high_risk`; `services/ai/failure_predictions.py` sends **nothing** — confirmed, no notification code path exists).
3. **Consistent deep-linked alert surfaces** (`AIRiskAlertsPanel.tsx` housekeeping rows link to generic `/housekeeping`; maintenance rows have **no** action link).

Chat/system-initiated copilot messaging is **out of scope** — do not scope it in.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or the alert feels like dead-end noise.

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---------|--------------|------------|----------------------|
| Every alert carries a concrete next action | CMMS norm: "if an alert fires and the responder cannot take a specific action, the alert should not exist." A read-only risk pill is a dead end. | LOW | `PredictionPanel` rows and `AIRiskAlertsPanel` maintenance rows currently violate this. Add a primary action button per row. |
| Acknowledge / dismiss | Lets a supervisor clear a handled alert so it stops nagging; already the norm for failure predictions. | LOW | Failure dashboard already has `acknowledge`. Room-readiness has **no** acknowledge — add one, and have it suppress re-push (see dedup below). |
| Deep link to the source record | Clicking an alert must land on the exact room/asset/WO, not a generic list. | LOW | Fix `AIRiskAlertsPanel`: housekeeping row → `/housekeeping?room={room_id}` (drawer open), maintenance row → `/engineering/predictions?asset={id}`. SLA row already deep-ish (`/engineering`). |
| Proactive push on new HIGH-risk asset | Room-readiness already pushes; engineers expect the same for equipment about to fail. Parity gap is the core ask. | MEDIUM | Reuse `notifications` table + the `notify_role`/`notify_supervisors_high_risk` pattern. Target `engineer` + `chief_engineer` + `gm`. |
| Edge-triggered dedup (no re-notify while risk stays HIGH) | Predictions re-run every 30 min (room) / nightly (asset). Re-pushing an unchanged HIGH every cycle is textbook alert fatigue. | MEDIUM | Room-readiness **already** does this: `risk_level == "HIGH" and previous_risk != "HIGH"`. Replicate for assets. See "Dedup design" below. |
| Confidence / rationale on the alert | AI alerts without "why" get ignored or distrusted. | LOW | Data already exists: `confidence_score`, `risk_factors` (room), `ai_reasoning` + `failure_indicators` (asset). Surface, don't recompute. |
| Role-gated actions | A housekeeper shouldn't authorize a spend; front desk shouldn't reassign engineers. | LOW | Reuse `require_role`/`useRole`. Reassign → `housekeeping_supervisor`/`gm`; authorize AI action → `chief_engineer`/`gm` (matches existing `canAuthorize`). |

### Differentiators (Competitive Advantage)

Features that set the product apart. Align with core value: **save floor staff time, don't add phone complexity.**

| Feature | Value Proposition | Complexity | Notes / Dependencies |
|---------|-------------------|------------|----------------------|
| One-click reassign with AI-suggested least-loaded housekeeper pre-selected | Turns "Room 214 will be late" into a 1-tap fix. Competitors (HelloShift, Unifocus) auto-balance by productivity/proximity; we match that but keep a human in the loop. | MEDIUM | **Recommend: pre-picked default + confirm, NOT silent auto-execute.** Route through existing `ai_recommendations` (`source_type='room_readiness'`, `suggested_action='adjust_room_assignment'` — both enum values already exist in migration 073). Least-loaded = fewest DIRTY/IN_PROGRESS rooms via existing `count_rooms_ahead` logic. See "Reassign design" below. |
| AI-recommended action with governed authorize → execute → outcome loop | Auditability: "AI suggested, GM authorized, it prevented a failure." Rare in SMB hotel tooling. | LOW (already built) | `ai_recommendations` lifecycle already exists and is wired for failure predictions (`authorizeRecommendation`). Extend the same UI affordance to room-readiness and to the alert panel — do **not** build a second governance system. |
| Escalation chain / watermark for un-actioned alerts | If nobody reassigns a HIGH room or acks a failing asset, escalate to GM after a threshold. | MEDIUM | Pattern already exists for work orders: `escalation_level` column as a watermark (`internal.py::check_escalations`, tiers at 30/90/150 min). Apply a lightweight version to predictions. |
| Batch action on grouped alerts | "3 rooms behind on floor 2 → reassign all" / "acknowledge all low-value alerts." Reduces taps at shift change. | MEDIUM | CMMS best practice is to **group related alerts into one actionable notification**. Only worth it once single-item actions ship. Group by floor (room) or asset category (maintenance). |
| Tiered alert routing (observe vs act vs escalate) | Separates "log & monitor" from "do something now" so the feed isn't a flat wall of red. | MEDIUM | Map to existing bands: room LOW/MEDIUM/HIGH; asset <40 / 40–69 / ≥70. Only MEDIUM+/≥40 should push; LOW stays in-dashboard. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Re-notify every cron run while risk stays HIGH | "Keep reminding us it's still broken." | **Primary alert-fatigue driver.** Room preds run `*/30` (up to 48 pushes/day/room); assets nightly. A stuck-HIGH asset would ping every night forever → staff mute the bell. | Edge-triggered notify on **transition into HIGH only**, plus a re-arm window (don't re-fire if it dipped and re-rose within ~6–12h) and acknowledge-suppression. Send a *digest* if persistence must be surfaced, not a repeat push. |
| Silent auto-reassign / auto-create-WO with no confirmation | "Just let the AI fix it." | Reassignment moves a real person's workload; auto-WO can authorize spend. Consequential changes that bypass human confirm erode trust and cause floor disputes. Existing governance (`ai_recommendations`) deliberately requires `authorized_by`. | Pre-fill the AI's choice, require **one confirming tap**. Auto-execute only truly reversible, zero-cost actions (e.g. mark-as-read), never assignment or spend. |
| Flat "everything is an alert" feed | "Surface all risks." | Flat systems where every signal = same notification are the root cause of alert fatigue. LOW-risk rooms flooding the panel bury the one HIGH that matters. | Tiered: only MEDIUM+/≥40 surfaces in `AIRiskAlertsPanel`; LOW stays as ambient dashboard state. Cap/rank the feed. |
| Per-alert email/SMS for every prediction | "I want to know immediately, everywhere." | SMS (Twilio) credentials aren't even available locally, and per-event SMS compounds fatigue + cost against the $2.50/room/mo cap. | In-app `notifications` (bell) is the default channel. Reserve any future email for the **daily GM digest** cron that already exists (`reports.daily-summary-email`). |
| Notify all roles on every alert | "Make sure someone sees it." | Broadcasting a failing compressor to housekeepers is noise that trains everyone to ignore the bell. | Route by domain+role: room-readiness → `housekeeping_supervisor`/`gm`; asset failure → `engineer`/`chief_engineer`/`gm`. Matches existing `notify_supervisors_high_risk` targeting. |
| New standalone predictions inbox / notification center rebuild | "We need a better place to manage all this." | Duplicates the existing bell + `AIRiskAlertsPanel` + per-domain dashboards; big surface, little marginal value this milestone. | Enhance the three existing surfaces in place. Defer any unified center to v2+. |

## Dedup Design (answers the "new HIGH-risk asset" push question)

**Use edge-triggered state-transition notification with a watermark column — the pattern already proven twice in this codebase.**

- **Room-readiness (already correct):** fetches `existing_risk_map`, pushes only when `risk_level == "HIGH" and previous_risk != "HIGH"`. Keep as-is; add acknowledge-suppression so a supervisor who acked a room isn't re-pinged if it flickers.
- **Failure predictions (to build):** before the delete-then-insert, read the prior row's `risk_score` band. Push **only on transition into ≥70 from below 70**. Persist a watermark so the nightly re-run of a still-HIGH asset does **not** re-push.
  - Add `last_notified_risk_band` (or reuse `is_acknowledged` + a `notified_at`) on the prediction/asset row. This mirrors the `escalation_level` watermark used in `internal.py::check_escalations` to "prevent duplicate notifications across cron runs."
  - **Re-arm rule:** only re-notify if the band was below 70 for at least one intervening run (or ~12h) before re-crossing. Prevents 69↔71 flapping from spamming.
  - **Acknowledge = suppress:** an acknowledged prediction never re-pushes even if it stays HIGH; the dashboard row is the persistent surface.

Net: one push per genuine LOW/MED→HIGH transition per asset, not one per cron cycle.

## Reassign Design (answers the "one-click reassign to which housekeeper" question)

**Recommend: picker pre-selected to the AI's least-loaded pick, requiring one confirming tap — not a silent auto-assign, and not a blank picker.**

- **Default choice = least-loaded eligible housekeeper.** Reuse `count_rooms_ahead` (fewest remaining DIRTY/IN_PROGRESS rooms today); tie-break on rolling avg clean time for that room_type (`housekeeper_profiles`). This is what Unifocus/HelloShift do (balance by productivity + workload).
- **Why confirm, not auto:** reassignment is consequential (shifts a person's floor workload). Silent auto-assign is an anti-feature. Pre-filling the pick keeps it one-tap-fast while preserving the human check.
- **Route through governance:** create an `ai_recommendations` row (`source_type='room_readiness'`, `suggested_action='adjust_room_assignment'`, `action_payload={room_id, from_hk, to_hk}`) → authorize → execute updates `room_assignments.assigned_to`. Reuses the exact loop the failure dashboard already uses; no new governance code.
- **Escalate alternative:** if no eligible housekeeper has slack, the action degrades to `notify_supervisor` (also an existing `suggested_action` enum value) rather than forcing a bad reassignment.
- **Deep-link fallback:** the `AIRiskAlertsPanel` housekeeping "Reassign" link should open the room drawer on `/housekeeping` with the reassign action primed (fixes today's generic `href="/housekeeping"`).

## Feature Dependencies

```
Deep-linked alert surfaces (AIRiskAlertsPanel fix)
    └──requires──> source_id present on each alert row (room_id / asset_id) [already in payload]

Room-readiness one-click reassign
    └──requires──> ai_recommendations governance loop [EXISTS, migration 073]
    └──requires──> least-loaded picker (count_rooms_ahead / housekeeper_profiles) [EXISTS]
    └──enhances──> PredictionPanel (adds action buttons to read-only rows)

Failure-prediction proactive push
    └──requires──> notify pattern (notifications table + notify_role) [EXISTS in internal.py/predictions.py]
    └──requires──> edge-triggered dedup watermark [pattern EXISTS: escalation_level / existing_risk_map]

Batch actions ──requires──> single-item actions shipped first
Escalation chain ──enhances──> proactive push (both use the same watermark idea)
Silent auto-execute ──conflicts──> ai_recommendations human-authorize invariant (do NOT combine)
```

### Dependency Notes

- **One-click reassign requires `ai_recommendations`:** the table already models `source_type='room_readiness'` and `suggested_action='adjust_room_assignment'`/`notify_supervisor` — build on it, don't fork.
- **Proactive push requires dedup:** shipping the push without the watermark would immediately create nightly alert-fatigue on stuck-HIGH assets — treat them as one unit of work.
- **Auto-execute conflicts with governance:** the append-only `ai_recommendation_events` + required `authorized_by` exist specifically to keep a human in the loop; a silent-auto path would undermine the audit trail.

## MVP Definition

### Launch With (v1.6 core)

- [ ] **Deep-linked alert rows** in `AIRiskAlertsPanel` (housekeeping → room drawer; maintenance → prediction card) — LOW cost, removes dead-end alerts.
- [ ] **Failure-prediction proactive push** with edge-triggered dedup watermark — closes the parity gap without fatigue.
- [ ] **Room-readiness one-click reassign** (pre-picked least-loaded + confirm) via existing `ai_recommendations` loop.
- [ ] **Acknowledge on room-readiness** predictions (suppresses re-push).

### Add After Validation (v1.x)

- [ ] **Batch actions** (reassign-all-on-floor, ack-all) — trigger: supervisors report tap-fatigue at shift change.
- [ ] **Escalation chain** for un-actioned HIGH predictions → GM — trigger: alerts sit unacted past a threshold.

### Future Consideration (v2+)

- [ ] Unified notification center — defer; enhance existing three surfaces first.
- [ ] Cross-channel delivery (email/SMS per alert) — defer; blocked on Twilio creds + cost cap, digest-only if ever.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Deep-linked alert rows | HIGH | LOW | P1 |
| Failure-prediction push + dedup watermark | HIGH | MEDIUM | P1 |
| Room-readiness one-click reassign (governed) | HIGH | MEDIUM | P1 |
| Acknowledge room-readiness (push suppression) | MEDIUM | LOW | P1 |
| Batch / grouped actions | MEDIUM | MEDIUM | P2 |
| Escalation chain for un-actioned alerts | MEDIUM | MEDIUM | P2 |
| Unified notification center | LOW | HIGH | P3 |
| Per-alert email/SMS | LOW | MEDIUM | P3 (anti) |

## Competitor Feature Analysis

| Feature | HelloShift / Unifocus / Actabl (housekeeping) | TMA / oxmaint / clickmaint (CMMS) | Our Approach |
|---------|-----------------------------------------------|-----------------------------------|--------------|
| Reassignment | Drag-and-drop + bulk; auto-balance by productivity/proximity/floor | n/a | AI-pre-picked least-loaded + one-tap confirm, governed by `ai_recommendations` |
| Alert dedup | Real-time status, reassign dynamically | Baseline-then-threshold, multi-signal correlation, group + dedup | Edge-triggered transition + watermark + re-arm window (already the house pattern) |
| Actionability | Assignments pushed to attendant mobile | "Every alert tier auto-attaches an action" | Every prediction row gets a primary action; no read-only dead ends |
| Governance | Rule-based auto-assign | Tiered observe/act/escalate | Human-authorized loop with append-only audit trail |

## Sources

- [Monitoring & Alerting Best Practices to Reduce Alert Fatigue — OneUptime (2026-02)](https://oneuptime.com/blog/post/2026-02-20-monitoring-alerting-best-practices/view) — MEDIUM
- [Predictive Maintenance Alerts: How to Reduce Alert Fatigue — oxmaint](https://oxmaint.com/article/predictive-maintenance-alert-fatigue) — MEDIUM
- [Reduce IoT False Alarms in Predictive Maintenance — oxmaint](https://oxmaint.com/blog/post/reduce-iot-false-alarms-predictive-maintenance) — MEDIUM
- [Predictive Maintenance Best Practices for CMMS and EAM — TMA Systems](https://www.tmasystems.com/blog/predictive-maintenance-best-practices) — MEDIUM
- [Alert Fatigue in Monitoring — Icinga](https://icinga.com/blog/alert-fatigue-monitoring/) — MEDIUM
- [Best Hotel Housekeeping Software 2026 — HotelTechReport](https://hoteltechreport.com/operations/housekeeping-software) — MEDIUM
- [Hotel Housekeeping Management — HelloShift](https://www.helloshift.com/housekeeping-management) — MEDIUM
- [Housekeeping Software — Unifocus](https://www.unifocus.com/en/operations-software/housekeeping-software) — MEDIUM
- Internal (HIGH): `apps/api/services/ai/predictions.py` (edge-triggered room push), `apps/api/services/ai/failure_predictions.py` (no push — parity gap), `apps/api/routers/internal.py::check_escalations` (`escalation_level` watermark dedup), `supabase/migrations/073_pms_ai_governance.sql` (`ai_recommendations` lifecycle + `adjust_room_assignment`/`notify_supervisor` actions), `apps/web/components/housekeeping/PredictionPanel.tsx` (read-only today), `apps/web/components/dashboard/AIRiskAlertsPanel.tsx` (generic links).

---
*Feature research for: proactive AI alerting + one-click actions (PatelRep v1.6)*
*Researched: 2026-08-12*
