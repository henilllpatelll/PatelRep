# Architecture Research

**Domain:** Proactive AI alerting / actionable predictions inside an existing hotel-ops SaaS (PatelRep, v1.6 milestone)
**Researched:** 2026-08-12
**Confidence:** HIGH (all findings verified against current source — file/line citations throughout)

> Scope: how "actionable room-readiness predictions" (reassign/escalate) and "proactive push for failure
> predictions" integrate with the **existing** architecture. This is a subsequent-milestone integration study,
> not a greenfield stack survey. Two hard constraints are respected throughout:
> **(C1)** Supabase Realtime stays scoped to its 3 existing surfaces — every new surface here is pull-based.
> **(C2)** `services/` stays flat — no new service module unless logic is shared across 2+ domains.

---

## Standard Architecture

### System Overview — current proactive-intelligence wiring (as-built)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  APScheduler (core/scheduler.py, in-process, production-gated)            │
│    predictions.run */30      ai.failure-predictions 0 0 * * *             │
└───────────┬───────────────────────────────┬──────────────────────────────┘
            │                                │
            ▼                                ▼
  services/ai/predictions.py       services/ai/failure_predictions.py
  (RULE-BASED, deterministic)      (LLM Claude + rule fallback)
            │                                │
     upsert on room_id                 DELETE unacked + INSERT
            ▼                                ▼
  room_readiness_predictions        failure_predictions  ─┐
  (persistent row per room)         (wiped nightly)        │ also updates
            │                                              ▼
   edge-trigger: LOW/MED→HIGH               assets.failure_risk_score
            │                                (PERSISTENT — survives wipe)
            ▼                                              │
  notify_supervisors_high_risk               (NO proactive push today) ✗
  → notifications table                                   │
  (supervisors + gm)                                      │
            │                                              │
            └──────────────┬───────────────────────────────┘
                           ▼
              notifications table  ──►  Header.tsx bell (PULL, poll)
                           │
                           ▼           GET /ai/risk-alerts (PULL, 120s)
              AIRiskAlertsPanel.tsx (dashboard) — static hrefs, no deep-link
                           │
  ai_recommendations (governance lifecycle) — wired ONLY for failure_prediction,
  and ONLY on-demand from UI (createFailurePredictionRecommendation), NOT the cron
```

### Component Responsibilities (verified)

| Component | Responsibility | Current implementation |
|-----------|----------------|------------------------|
| `services/ai/predictions.py` | Room-readiness ETA + risk, **already pushes** on new HIGH | Rule-based; upserts `room_readiness_predictions` on `room_id`; `notify_supervisors_high_risk()` at lines 197-264 |
| `services/ai/failure_predictions.py` | Asset failure risk (0-100) | LLM w/ rule fallback; **delete-and-insert** `failure_predictions` (lines 393-399); updates `assets.failure_risk_score` (410-413); **no notification** |
| `ai_recommendations` table | Human-authorized action lifecycle | Migration 073; `source_type` CHECK **already allows** `'room_readiness'`; `suggested_action` CHECK already allows `'adjust_room_assignment'` + `'notify_supervisor'` |
| `notifications` table | The **only** proactive-push channel (bell) | Migration 013 (lines 91-108); `data` JSONB for deep-link payload |
| `AIRiskAlertsPanel.tsx` | Dashboard risk surface | `components/dashboard/AIRiskAlertsPanel.tsx`; consumes `GET /ai/risk-alerts`; **static** `href="/housekeeping"` / `href="/engineering"`; maintenance rows have **no link at all** |
| `GET /ai/risk-alerts` | Aggregates 3 risk buckets | `ai_copilot.py:768-795`; HIGH room predictions + overdue WOs + assets ≥70 |

---

## The Five Integration Decisions

### Q1 — Room-readiness reassign/escalate: reuse `ai_recommendations` or lighter-weight direct?

**Recommendation: SPLIT by action. Execute directly against native domain endpoints; use `ai_recommendations`
ONLY as an optional analytics/outcome wrapper, never as the execution path — and only if outcome-metrics parity
is an explicit milestone goal.**

Why this, not "wrap everything in governance":

- The `ai_recommendations` lifecycle (`pending → authorized → executed → outcome_recorded`, with an **immutable**
  event log — migration 073 lines 78-81) exists to give humans oversight over **LLM-generated, expensive,
  consequential** decisions (e.g. "spend money opening a work order on a $12k asset"). `confidence` is even
  hardcoded to `0.5` for the legacy failure model (`ai_copilot.py:889`) because it can't calibrate.
- Room-readiness is **rule-based and deterministic** (`predictions.py` has no LLM call). There is no "AI
  authorization" semantics to honor — the buffer math is auditable by reading the code. Its actions are
  **operational, reversible, low-stakes** (reassign a room; ping a supervisor).
- **"Escalate" = a `notifications` insert.** That idiom already exists (`notify_supervisors_high_risk`). Wrapping
  a bell-notification in a 4-state governance lifecycle is pure ceremony.
- **"Reassign" = the existing `POST /housekeeping/assignments` endpoint** (verified: `housekeepingApi.saveAssignments`,
  `lib/api/housekeeping.ts:108`). That path already has its own audit trail (`room_assignments` rows). A human
  picks the new housekeeper — there is no "AI executed it" moment to stamp. Re-implementing assignment inside a
  recommendation executor would duplicate domain logic and **violate C2** (assignment logic is housekeeping-only).

**If** (and only if) the milestone wants unified ROI reporting ("we flagged 40 at-risk rooms, staff acted on 32,
prevented 28 late check-ins"), then materialize an `ai_recommendations` row as a **governance wrapper**:
`source_type='room_readiness'`, `suggested_action='adjust_room_assignment'`, `source_id=room_id`. Critically —
**do NOT emit one per room per cron** (that firehose would bury the queue the `idx_ai_recommendations_queue` index
serves). Materialize on the **same edge-trigger** the notification already uses (new HIGH only). "Executed" is
stamped when the human completes the reassignment; the existing `/recommendations/metrics` endpoint
(`ai_copilot.py:841`) then yields room-readiness ROI for free.

Net: reassign/escalate ship as **direct actions**; the governance table is an **opt-in analytics layer**, decoupled
from correctness.

### Q2 — Failure-prediction proactive push: extend the `notify_supervisors_high_risk` idiom?

**Recommendation: YES, directly.** Add a sibling notifier in `failure_predictions.py`, mirroring
`notify_supervisors_high_risk` one-for-one:

- Target roles `chief_engineer` + `gm` (the engineering analog of supervisor + gm).
- `type = "asset_risk_high"`, `data = {"asset_id": ..., "risk_score": ...}` for deep-linking.
- Insert into `notifications` — the established and **only** proactive-push channel (bell icon, `Header.tsx`).

This **respects C1**: notifications are **pull** (the bell polls; `AIRiskAlertsPanel` polls every 120s). No new
Realtime subscription is introduced. It also **respects C2**: the notifier stays inside the single-domain
`failure_predictions.py` module — it is not shared with another domain, so it does not get promoted to a shared
`services/notifications` helper. (If a *third* consumer ever appears, that's the trigger to extract a shared
notifier — not now.)

### Q3 — Dedup / idempotency so a stuck-HIGH asset doesn't spam every night

**This is the load-bearing design problem, and the two prediction engines dedup differently *because their storage
models differ*.**

How **room-readiness** dedups (verified `predictions.py:292-306, 424-436`):
- Its row is **upserted** and **persists** across runs. Before recomputing, it snapshots the prior risk per room
  into `existing_risk_map`. It then **edge-triggers**: notify only when `risk_level == "HIGH" and previous != "HIGH"`.
  A room that stays HIGH across many 30-min runs is silent after the first alert. This is a classic
  level→edge conversion off persistent state.

Why **failure predictions can't copy that verbatim**: the nightly job **deletes unacknowledged rows and
re-inserts** (`failure_predictions.py:393-399`). Prior state in `failure_predictions` is destroyed each night, so
every stuck-HIGH asset looks brand-new → nightly spam.

Options compared:

| Option | Mechanism | Verdict |
|--------|-----------|---------|
| **(a) Anchor on `assets.failure_risk_score`** | This column is **updated, not deleted** (`failure_predictions.py:410-413`) — it survives the wipe, exactly like the room prediction row survives. Capture the **prior** score *before* overwriting it, compute prior band, notify only on `<70 → ≥70` crossing. | **Primary. Chosen.** Zero new schema, perfect structural analog to room-readiness's `existing_risk_map`. |
| **(b) Add `assets.failure_notified_at` + `failure_notified_band`** | Explicit notification watermark. | **Optional hardening.** Only if a "still HIGH after 7 days → remind" cadence is wanted, or to survive score flapping across the 70 boundary. |
| **(c) Query existing unread `asset_risk_high` notification before insert** | Dedup at the notification layer. | **Rejected.** Fragile — a user marking the bell read would re-trigger the alert. |

**Implementation note (ordering hazard):** the current code overwrites `assets.failure_risk_score` at lines
410-413. The edge-trigger must read the **old** value **before** that write (or capture it when the asset row is
first fetched at 326-333). This is the single most bug-prone spot — flag it for the phase plan and add a test that
runs the nightly job twice against an unchanged HIGH asset and asserts exactly **one** notification.

### Q4 — Deep-linking `AIRiskAlertsPanel` rows: new routing or just a URL-param change?

**Verified answer: it is a small page modification, not zero-code, but it needs no new routes.**

Current state (`AIRiskAlertsPanel.tsx`):
- Housekeeping rows → static `href="/housekeeping"` (line 89). SLA rows → static `href="/engineering"` (line 117).
- **Maintenance/asset rows have no link at all** (lines 126-140) — the biggest UX gap.
- Confirmed the target pages do **not** read query params today: `app/(dashboard)/engineering/page.tsx` has no
  `useSearchParams`, and `housekeeping/page.tsx` only uses `roomId` as internal state, not from the URL.

So deep-linking requires, per target page (all pull-based, C1-safe):
1. Change the panel hrefs to carry a param: `/housekeeping?highlightRoom=<room_id>`,
   `/engineering/predictions?asset=<asset_id>` (the `engineering/predictions/page.tsx` and
   `engineering/assets/page.tsx` routes **already exist** — no new route file needed).
2. On each target page, add `useSearchParams()` (App Router client hook) to read the param and
   scroll-to / highlight the matching row.
3. Add the missing link on maintenance rows.

This is a bounded frontend change (2 pages + 1 component), not a routing redesign.

### Q5 — Build order (dependency-driven, not convenience)

Two tracks are **independent** — they touch different domains, files, and tables, so they can ship in parallel or
in either order. **Reassign-action does NOT block push-parity and vice-versa** (explicitly answering the downstream
question).

```
Track A (backend, engineering domain)        Track B (frontend, shared panel)
─────────────────────────────────────        ─────────────────────────────────
A1. Failure-push + edge-dedup (Q2+Q3)   ┐    B1. Deep-link AIRiskAlertsPanel (Q4)
    - failure_predictions.py notifier   │        - panel hrefs + params
    - assets.failure_risk_score anchor  │        - useSearchParams on 2 pages
    - double-run idempotency test       │        - add missing maint link
                                        │
                                        └──► B2. Reassign/escalate wiring (Q1 direct)
                                                 - "Reassign" → existing
                                                   POST /housekeeping/assignments
                                                 - "Escalate" → notify idiom
                                                 (benefits from B1's deep-link)

               (optional, LAST, gated on wanting ROI parity)
               C1. ai_recommendations wrapper for room_readiness (Q1 analytics)
                   - edge-triggered materialization (new HIGH only)
                   - reuses existing /recommendations + /metrics endpoints
```

**Rationale for order:**
1. **A1 first** — highest value, lowest risk, self-contained in one file + one existing table, matches an existing
   idiom exactly, no frontend dependency. It closes the glaring "failure predictions never proactively alert" gap.
2. **B1 next** — pure frontend, unblocks the actionable UX for *both* prediction types; a prerequisite for B2 feeling
   complete (a "Reassign" link is only useful if it lands on the right room).
3. **B2** — depends on B1 for good UX; reuses the already-verified `/housekeeping/assignments` endpoint, so backend
   work is ~zero.
4. **C1 last and optional** — additive governance/analytics; must not gate the action itself. Only build if unified
   outcome metrics are an explicit requirement.

---

## Architectural Patterns

### Pattern 1: Level→Edge conversion off persistent state (the dedup backbone)

**What:** Convert a continuously-recomputed *level* (risk band) into a one-shot *edge* (band crossing) by diffing
against a value that survives the recompute. **When:** any periodic predictor that must alert on transitions, not
states. **Trade-off:** requires a persistent anchor; if storage is wiped (failure predictions), you must anchor on
a *sibling* persistent field (`assets.failure_risk_score`) rather than the wiped table.

```python
# room-readiness (existing, predictions.py) and failure-push (proposed) share this shape:
prior_band = band(prior_score)          # snapshot BEFORE overwrite
new_band   = band(new_score)
if new_band == "HIGH" and prior_band != "HIGH":
    notify(...)                          # edge only — silent while stuck HIGH
```

### Pattern 2: Governance-wrapper, not governance-executor

**What:** When adding `ai_recommendations` tracking to an action that already has a native endpoint, the
recommendation records *intent + outcome*; the native endpoint performs the *action*. **When:** deterministic /
reversible / already-audited actions (reassignment). **Trade-off:** two writes (recommendation + native action)
but zero duplicated domain logic and no C2 violation.

### Pattern 3: Pull-based proactive surfaces (C1 preservation)

**What:** New "proactive" alerts land in `notifications` (bell poll) and `/ai/risk-alerts` (120s poll), never a new
Realtime channel. **When:** always, in this codebase, unless a surface is explicitly added to the 3-surface Realtime
allowlist. **Trade-off:** up-to-120s latency vs. an architectural invariant that keeps WebSocket fan-out bounded —
acceptable for shift-level ops alerts.

## Data Flow

### New failure-prediction push (Track A1)

```
nightly cron → run_asset_failure_predictions(hotel)
   fetch asset (has OLD failure_risk_score)         ← capture prior_band HERE
   → analyze (Claude / fallback)  → new risk_score
   → delete unacked + insert failure_predictions
   → UPDATE assets.failure_risk_score = new         ← overwrite AFTER prior captured
   → if band(new) == HIGH and prior_band != HIGH:
        notify_engineers_high_failure_risk()  → notifications (chief_engineer + gm)
                                                → bell + AIRiskAlertsPanel (pull)
```

### Actionable room-readiness (Track B2, direct)

```
AIRiskAlertsPanel row (HIGH room, deep-linked via B1)
  ├─ "Reassign" → /housekeeping?highlightRoom=<id> → POST /housekeeping/assignments (existing)
  └─ "Escalate" → notify idiom (existing notify_supervisors_high_risk shape) → notifications
        (optional C1: also write ai_recommendations row, edge-triggered, for ROI metrics)
```

## Anti-Patterns

### Anti-Pattern 1: Forcing the every-30-min room firehose through the governance queue

**What people do:** insert an `ai_recommendations` row per at-risk room per cron. **Why it's wrong:** floods the
`idx_ai_recommendations_queue`-backed queue, drowns the genuinely human-decision failure recommendations, and
misrepresents deterministic rule output as "AI needing authorization." **Instead:** edge-trigger materialization
(new HIGH only), or skip the governance table entirely for room-readiness unless ROI metrics are required.

### Anti-Pattern 2: Deduping failure alerts against the wiped table

**What people do:** check `failure_predictions` for a prior row to decide whether to notify. **Why it's wrong:** the
nightly delete-and-insert destroys that row, so the check always sees "new." **Instead:** anchor the edge-trigger on
`assets.failure_risk_score`, which survives the wipe — and read it *before* the overwrite.

### Anti-Pattern 3: Re-implementing reassignment inside a recommendation executor

**What people do:** build an executor that writes `room_assignments` when a recommendation is "authorized." **Why
it's wrong:** duplicates housekeeping-domain logic, violates the flat-services rule (C2), and creates a second,
divergent assignment path. **Instead:** the UI action calls the existing `POST /housekeeping/assignments`; the
recommendation only records that it happened.

### Anti-Pattern 4: Promoting the failure-push notifier to a shared service prematurely

**What people do:** extract a `services/notifications` helper for the new engineer push. **Why it's wrong:** it's
used by exactly one domain (engineering/failure) — C2 says extract only at 2+ consumers. **Instead:** keep it inside
`failure_predictions.py` alongside its room-readiness twin in `predictions.py` until a real third consumer appears.

## Integration Points

### Tables touched

| Table | New / Modified | Change |
|-------|----------------|--------|
| `notifications` | Modified (data only) | New `type='asset_risk_high'` rows; new `type` for HK escalate. **No schema change.** |
| `assets` | Optional new columns | Only if Q3 option (b) hardening chosen (`failure_notified_at`, `failure_notified_band`). Otherwise untouched. |
| `ai_recommendations` | Modified (data only) | Optional C1: `source_type='room_readiness'` rows. Schema **already supports** it (migration 073) — **no migration needed**. |
| `room_readiness_predictions` / `failure_predictions` | Unchanged | Read-only for the new flows. |

### Files touched

| File | New / Modified | Change |
|------|----------------|--------|
| `services/ai/failure_predictions.py` | Modified | Add `notify_engineers_high_failure_risk()` + prior-band edge-trigger (A1). |
| `services/ai/predictions.py` | Unchanged (or minor) | Already notifies. Only touch if wiring the optional `ai_recommendations` wrapper (C1). |
| `routers/ai_copilot.py` | Possibly modified | Only if adding a room-readiness recommendation endpoint (optional C1). Push work needs no router change. |
| `components/dashboard/AIRiskAlertsPanel.tsx` | Modified | Param'd hrefs; add missing maintenance link (B1). |
| `app/(dashboard)/housekeeping/page.tsx` | Modified | `useSearchParams` highlight (B1). |
| `app/(dashboard)/engineering/predictions/page.tsx` (or `/assets`) | Modified | `useSearchParams` highlight (B1). Routes already exist. |
| `lib/api/housekeeping.ts` / `lib/api/ai.ts` | Unchanged / minor | `saveAssignments` already exists; add types only if C1 wrapper built. |

## Scaling Considerations

| Scale | Adjustment |
|-------|------------|
| 50-150 rooms (target) | Everything above is trivially fine. Per-hotel loops (`run_all_hotels_*`) are sequential and adequate. |
| Many hotels × nightly LLM | The LLM failure job is the cost/latency bottleneck, not notifications. Already mitigated by per-asset `max_tokens=512` + rule fallback. Notifications are a bulk insert — negligible. |
| Notification volume | Edge-triggering (Q3) is what keeps volume sane; without it, volume grows with stuck-HIGH assets × nights. This is a correctness, not scale, concern. |

## Sources

- `apps/api/services/ai/predictions.py` (room-readiness engine, `notify_supervisors_high_risk`, edge-trigger 292-306/424-436) — HIGH
- `apps/api/services/ai/failure_predictions.py` (delete-and-insert 393-399, asset score update 410-413) — HIGH
- `supabase/migrations/013_ai_systems.sql` (`room_readiness_predictions`, `notifications` schema) — HIGH
- `supabase/migrations/073_pms_ai_governance.sql` (`ai_recommendations` lifecycle, CHECK constraints, immutable events) — HIGH
- `apps/api/routers/ai_copilot.py:768-969` (risk-alerts aggregation + recommendation lifecycle endpoints) — HIGH
- `apps/web/components/dashboard/AIRiskAlertsPanel.tsx` (static hrefs, missing maintenance link) — HIGH
- `apps/web/lib/api/ai.ts` + `lib/api/housekeeping.ts` (existing clients; `saveAssignments`) — HIGH
- Project CLAUDE.md constraints A1 (flat services / C2), A2 (Realtime scope / C1) — HIGH

---
*Architecture research for: proactive AI alerting integration (v1.6)*
*Researched: 2026-08-12*
