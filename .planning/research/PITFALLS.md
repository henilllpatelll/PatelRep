# Pitfalls Research

**Domain:** Proactive prediction-driven alerting + one-click actions on an existing reactive hotel-ops system (PatelRep v1.6)
**Researched:** 2026-08-12
**Confidence:** HIGH — grounded in this project's actual prediction/notification code (`services/ai/predictions.py`, `services/ai/failure_predictions.py`, `routers/notifications.py`, `routers/internal.py`) and its own bug history (`.wolf/buglog.json`, `.wolf/cerebrum.md`), not generic advice.

> **Scope note.** This milestone makes *existing, already-computed* predictions actionable and pushes notifications for failure predictions. The prediction engines already exist and run on cron. The risk is almost entirely at the **seam** between a 30-min/nightly cron that rewrites prediction rows and a user who is looking at / acting on a row that the cron is about to overwrite or delete. Every critical pitfall below lives at that seam.

---

## Critical Pitfalls

### Pitfall 1: One-click action targets a prediction row the cron already deleted (failure predictions)

**What goes wrong:**
`run_asset_failure_predictions()` does **delete-then-insert**, not upsert: it runs `failure_predictions.delete().eq("is_acknowledged", False)` then `insert(prediction)` every nightly run (`failure_predictions.py:392-399`). Room readiness uses `upsert(on_conflict="room_id")` (`predictions.py:402`), which keeps the same PK but **replaces every column** (`predicted_ready_at`, `risk_level`, `housekeeper_id`, `rooms_remaining_for_hk`). So: a user opens the panel at 11:59pm, the nightly `ai.failure-predictions` cron fires at `0 0 * * *`, deletes the unacknowledged prediction row they're viewing, inserts a new one with a **new UUID**, and the user's "Create Work Order" / "Authorize" click posts a `prediction_id` (or `ai_recommendation` tied to it) that no longer exists → 404, or worse, a silently orphaned `ai_recommendation`.

**Why it happens:**
The prediction engines were built as read-only refresh jobs. Delete-then-insert was fine when nothing referenced the row mid-flight. Making them actionable introduces a reader/actor whose lifetime now overlaps the cron's rewrite window, which the original design never accounted for.

**How to avoid:**
- **Do not key user actions off the volatile prediction row PK.** Key the action off the stable underlying entity — `asset_id` (failure) or `room_id` (readiness) — plus the tenant. The action endpoint should re-resolve the current prediction/state server-side from `asset_id`/`room_id`, never trust an ID the client is holding.
- **Make "acting" flip `is_acknowledged = True` atomically as part of the action**, because the nightly delete only removes `is_acknowledged = False` rows (`failure_predictions.py:394-397`). An acknowledged/acted row survives the cron. This is the existing escape hatch — use it deliberately.
- For failure predictions, convert delete-then-insert to an **upsert keyed on `(tenant_id, asset_id)`** so the PK is stable and in-flight references survive (matches how room readiness already behaves).

**Warning signs:**
- Action endpoints accept a `prediction_id` from the request body and `.eq("id", prediction_id)` without re-deriving from `asset_id`/`room_id`.
- 404s or "prediction not found" errors clustered right after `0 0 * * *` (nightly) or on `:00`/`:30` (readiness).
- `ai_recommendations` rows whose linked `failure_prediction` no longer exists.

**Phase to address:** Backend action-endpoint phase (before any UI wiring). This is a data-model/endpoint contract decision, not a UI concern.

---

### Pitfall 2: "Reassign" acts on stale prediction fields instead of live room state

**What goes wrong:**
`room_readiness_predictions.housekeeper_id` is a **snapshot** of `room_status.assigned_to` taken when the `*/30` cron last ran (`predictions.py:407`). It can be up to 30 minutes stale — or reference a `room_assignments` row that was since deleted/reassigned. If the one-click "reassign" button reads the housekeeper from the prediction row and reassigns *from* that stale value (or shows the supervisor a stale "currently assigned to Maria" when it's now Ana), the supervisor makes a decision on wrong data, or an optimistic "reassign from X to Y" clobbers an assignment change made in the last 30 minutes. Same hazard for `risk_level`: a room shown HIGH may already be CLEAN (see Pitfall 3).

**Why it happens:**
Predictions are a materialized cache. UIs naturally render whatever the cache says. The moment a cache value drives a *write*, staleness becomes a correctness bug rather than a cosmetic lag.

**How to avoid:**
- The reassign/escalate endpoint must **re-read current `room_status` (status, `assigned_to`) inside the request** and act on that, using the prediction only to *surface* the room, never as the source of truth for the mutation.
- Consider a lightweight guard: reject the action if `room_status.status` is no longer DIRTY/IN_PROGRESS (the room is already clean → reassignment is meaningless), returning a friendly "this room is already ready" rather than performing a no-op reassign.
- Reuse the existing assignment write path (`room_assignments` with `{date, assignments:[{room_id, housekeeper_id}]}`) rather than inventing a prediction-specific write — the cerebrum's supervisor-assignment contract already defines the correct shape.

**Warning signs:**
- Reassign endpoint reads `housekeeper_id` from `room_readiness_predictions` and writes it anywhere.
- No `room_status` re-read between "user clicked" and "assignment written."
- QA: reassign a room, then reassign again before the next cron tick — second action uses the pre-first-action housekeeper.

**Phase to address:** Backend action-endpoint phase.

---

### Pitfall 3: Stale prediction rows never get cleared → false alerts + broken dedup

**What goes wrong:**
`run_room_predictions()` only upserts rows for rooms currently in `get_at_risk_rooms()` (DIRTY/IN_PROGRESS with a check-in in the next 12h). When a room is cleaned or its reservation cancels, it **drops out of the at-risk set and its prediction row is never updated or deleted** — it lingers with `risk_level = "HIGH"` and a `last_calculated_at` that keeps aging. Two downstream failures:
1. **PredictionPanel / AIRiskAlertsPanel show ghost HIGH-risk rooms** that are actually already ready — and once actionable, offer a "reassign" button for a clean room.
2. **The notification dedup breaks in the *silent* direction.** The escalation guard is `if risk_level == "HIGH" and previous_risk != "HIGH"` (`predictions.py:428-429`), where `previous_risk` comes from the lingering row. A room that went HIGH → (cleaned, row frozen at HIGH) → dirty-again-HIGH will have `previous_risk == "HIGH"` and **no new notification fires** for a genuinely new risk. This is worse than spam: a real at-risk room goes un-alerted.

**Why it happens:**
The read-only panel tolerated ghost rows (nobody noticed a stale card). Turning rows actionable and using them as the dedup baseline makes both staleness modes load-bearing.

**How to avoid:**
- Add a **freshness filter everywhere predictions are read**: ignore rows whose `last_calculated_at` is older than ~1 cron interval (e.g. > 35 min for readiness), or LEFT JOIN to live `room_status` and drop rows no longer DIRTY/IN_PROGRESS.
- Better: at the end of each `run_room_predictions` pass, **delete/clear prediction rows for rooms no longer in the at-risk set** for that tenant, so the cache reflects reality and the dedup baseline is trustworthy.
- Track "already notified" with an explicit persisted marker (mirror `internal.py`'s `escalation_level` counter, `internal.py:502-582`) rather than inferring it from a mutable `risk_level` that can freeze.

**Warning signs:**
- A room shows HIGH on the dashboard but is CLEAN on the housekeeping board.
- `last_calculated_at` far older than the last cron run for rows still displayed.
- A room that was fixed and re-degraded never re-notifies.

**Phase to address:** Split — the freshness/clear-stale-rows fix belongs in the prediction-engine phase; the read-side freshness filter belongs in the deep-link/UI phase.

---

### Pitfall 4: Notification spam — re-notifying every cron cycle instead of on state transition

**What goes wrong:**
The milestone wants failure predictions to gain "proactive push notification parity" with room readiness. The naive implementation notifies for every asset with `risk_score >= 70` on **every nightly run** — so the chief engineer gets the same "Chiller #2 at risk" push every single night until the asset is fixed. Alert fatigue makes staff mute the channel, defeating the feature. Note the failure path has **no natural baseline to diff against**: delete-then-insert wipes the prior row, so there's literally no `previous_risk` to compare (unlike readiness, which at least reads `existing_risk_map` first, `predictions.py:293-303`).

**Why it happens:**
Room readiness got transition-only notification right (`previous_risk != "HIGH"`); a developer copying "parity" may copy the *notification call* without realizing the failure path lacks the prior-state read that makes dedup possible.

**How to avoid:**
- Notify **only on transition into high risk**, not on presence of high risk. For failure predictions this requires reading the prior state (or a `last_notified_risk` / `notified_at` marker) **before** the delete-then-insert, because the insert destroys it.
- Add an explicit dedup key: persist e.g. `failure_predictions.notified_at` or a row in a notification-log keyed by `(asset_id, predicted_failure_window)`, and suppress if already notified for the same window. Mirror the `escalation_level`-style persisted counter from `internal.py`.
- Consider a re-notify cooldown (e.g. don't re-alert the same asset within 7 days even if it re-crosses the threshold) since assets, unlike rooms, don't resolve within a shift.

**Warning signs:**
- Notification count scales with (high-risk assets × nights) rather than (new high-risk transitions).
- Staff reporting "same alert every morning."
- The failure-notification code has no read of prior state before insert.

**Phase to address:** Notification-parity phase. This is the core design decision of that phase.

---

### Pitfall 5: Forgetting `require_role()` on the new action endpoints (recurring in this codebase)

**What goes wrong:**
The new mutating endpoints — reassign, escalate, create-WO-from-prediction, authorize — must be RBAC-gated, and this project has **repeatedly shipped mutations that weren't**. From `.wolf/buglog.json`: "Wrong reference: `get_current_user` should be `require_role`" (line 7815); "An unsupported role could acknowledge a document" (line 7465); chief_engineer 403/routing gaps (line 7). The specific open question here — *should a housekeeper be able to reassign their own predicted-late room, or only a supervisor?* — must be answered per action, not left to default `get_current_user` (which authenticates but does not authorize).

**Why it happens:**
`get_current_user` and `require_role(...)` are both `Depends(...)` one-liners that look identical at the call site; the difference is invisible in review unless you check every route. It has slipped through here multiple times.

**How to avoid:**
- Decide the role matrix **explicitly per action** and encode it:
  - **Reassign a room** (changes another person's workload) → supervisor/GM only: `require_role("housekeeping_supervisor", "gm")`. A housekeeper reassigning rooms off their own queue is a workload-gaming risk; keep reassignment supervisory. If self-service "I can't finish this" is desired, model it as a *flag/escalation request*, not a direct reassign.
  - **Escalate / create WO from a failure prediction** → engineering roles (`engineer`, `chief_engineer`); **Authorize** an AI recommendation → GM/chief engineer only. The cerebrum already fixes this contract: "only GM/chief engineer can authorize, and controlled safety/compliance actions are never valid AI actions."
- Add an RBAC-matrix test for the new endpoints (the repo already has `test_rbac_matrix_matches_generated_output`, per buglog line 13892) so an ungated route fails CI.

**Warning signs:**
- A new mutating route `Depends(get_current_user)` with no `require_role`.
- Role logic done inside the handler body (`if user.role == ...`) instead of the dependency — easy to forget a branch.

**Phase to address:** Backend action-endpoint phase; verified by the RBAC-matrix test phase/CI.

---

### Pitfall 6: Notification insert path crashes the whole cron (direct precedent)

**What goes wrong:**
Adding a `notify_*` call inside the nightly failure loop risks repeating **bug at `internal.py:44`**: `_queue_safety_notification` hit `AttributeError: 'NoneType' object has no attribute 'data'` because a Supabase query returned `None`, and the entire safety-training cron returned HTTP 500 (`.wolf/buglog.json:7552`). If the new failure-notification helper isn't defensively wrapped, one bad tenant (e.g. no supervisors on file, or a `.maybe_single()` returning `None`) aborts the run for **all remaining hotels**.

**Why it happens:**
Supabase SDK calls return `None`/empty in more shapes than expected (`.maybe_single()` → `None`, `result.data` → `None`), and a cron loop over tenants has no per-tenant isolation unless you add it.

**How to avoid:**
- Wrap each hotel's notification work in try/except and continue the loop (the existing prediction engines already do this per-hotel, `predictions.py:479-485` / `failure_predictions.py:457-466` — the new notification code must be *inside* that protection, not outside it).
- Treat `result.data or []` defensively (the readiness `notify_supervisors_high_risk` already does, `predictions.py:230`) — mirror that, never assume `.data` is non-None.
- Never let a notification failure roll back or abort the prediction write it accompanies.

**Warning signs:**
- `/health` shows a cron job flipping to error/stale after the notification code lands (this project monitors `cron_health`; see buglog 7712/10195 for prior all-stale incidents).
- A single tenant's data shape breaks the aggregate run.

**Phase to address:** Notification-parity phase.

---

### Pitfall 7: Deep-link payload leaks or 404s across the room/asset boundary

**What goes wrong:**
`AIRiskAlertsPanel` is to be deep-linked to real room/asset records. The notification `data` payload currently carries `{"room_id": ..., "risk_level": "HIGH"}` (`predictions.py:248`). Failure alerts will need `{"asset_id": ...}`. Two hazards: (1) the deep-link target must **re-authorize on load** — a notification row proves the user was a recipient, but the linked room/asset page must still enforce `tenant_id` scoping and role, or a stale/forwarded link becomes a cross-tenant read; (2) because prediction rows churn (Pitfalls 1/3), a deep link built from a since-deleted prediction 404s.

**Why it happens:**
Deep links feel like "just a URL," so developers skip re-checking authorization at the destination and assume the referenced record still exists.

**How to avoid:**
- Deep-link to the **stable entity** (`/engineering?asset={asset_id}`, `/housekeeping?room={room_id}`), never to a prediction PK. Entities outlive predictions.
- The destination route/endpoint must independently enforce `.eq("tenant_id", current_user.hotel_id)` and role — never trust that arriving via a notification implies authorization.
- Handle the "record moved on" case gracefully (room already clean / prediction gone) with an informative empty state, not a hard 404.

**Warning signs:**
- Deep-link URLs containing `prediction_id`.
- Destination handler reads the linked record without a tenant filter.

**Phase to address:** Deep-linking phase (destination authorization) + UI phase (graceful-empty handling).

---

### Pitfall 8: Notification recipients resolved from the wrong role table (`user_profiles` vs `user_roles`)

**What goes wrong:**
`notify_supervisors_high_risk` selects recipients from **`user_profiles.role`** (`predictions.py:224-228`), while the RBAC/auth layer and the broadcast/direct endpoints resolve staff from **`user_roles`** (`notifications.py:63-68, 108-114`) and JWT custom claims. If these two tables drift (a role change written to one but not the other), high-risk alerts go to the wrong set of people — either missing a current supervisor or notifying a demoted one. Adding failure-prediction notifications will re-make this choice; copying the readiness code copies the `user_profiles` dependency.

**Why it happens:**
Two plausible "list the supervisors" sources exist; the prediction service happened to pick `user_profiles` while the rest of the notification domain uses `user_roles`. Inconsistency is invisible until roles change.

**How to avoid:**
- Standardize recipient resolution on **`user_roles` with `is_active = True`** (the same source RBAC trusts), so alert targeting can't diverge from who can actually act. Filter to active roles only — don't page someone who's been deactivated.
- If `user_profiles` must stay for display, still resolve *who to notify* from `user_roles`.

**Warning signs:**
- Alerts reaching a former supervisor, or a new supervisor getting none.
- Grep shows notification recipient queries split across `user_profiles` and `user_roles`.

**Phase to address:** Notification-parity phase (and opportunistically align the existing readiness path).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Action endpoint trusts client-supplied `prediction_id` | One less DB read | 404s / orphaned recommendations after every cron rewrite (Pitfall 1) | Never — always re-derive from `asset_id`/`room_id` |
| Notify on `risk == HIGH` presence, not transition | Simple loop, no prior-state read | Nightly alert spam → staff mute channel (Pitfall 4) | Never for recurring assets; acceptable only if a persisted dedup marker exists |
| Leave stale prediction rows uncleared | No delete logic to write | Ghost alerts + broken silent dedup (Pitfall 3) | MVP-only, and only if a read-side freshness filter is added |
| Reuse readiness's `user_profiles` recipient query for failures | Copy-paste parity | Wrong-recipient drift vs `user_roles` (Pitfall 8) | Never — resolve from `user_roles` |
| Role check inside handler body instead of `require_role` dependency | Feels flexible | Missed branch = ungated mutation (Pitfall 5, recurring here) | Never for the authorization gate itself |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `*/30` readiness cron vs live user action | Reassign off the prediction's 30-min-stale `housekeeper_id` | Re-read `room_status.assigned_to` in the request; act on live state |
| Nightly failure cron (delete-then-insert) vs in-flight action | Act on a row the cron just deleted/re-inserted with a new UUID | Convert to upsert on `(tenant_id, asset_id)`; flip `is_acknowledged=True` on action |
| Supabase realtime (deliberately only 3 surfaces) | Add a WebSocket subscription for prediction panels to "keep them fresh" | Predictions are cron-driven, not realtime — use pull-to-refresh + freshness filter; do **not** expand the realtime surface (violates the A2 realtime-scope contract in CLAUDE.md) |
| In-app notification insert inside tenant loop | Unhandled `None`/empty from Supabase aborts the whole cron | Per-tenant try/except, `result.data or []`, `.maybe_single()` None-guards (repeat of `internal.py:44` bug) |
| APScheduler in-process cron | Assuming a run is isolated per hotel | One tenant's exception must not abort the rest — wrap per-hotel |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Deep-link destination trusts the notification instead of re-authorizing | Cross-tenant room/asset read via forwarded/stale link | Enforce `tenant_id` + role at the destination endpoint, independent of how the user arrived |
| Notification rows inserted without `tenant_id` | Cross-tenant leak into another hotel's bell feed | Always set `tenant_id`; `list_notifications` already double-filters `tenant_id`+`user_id` (`notifications.py:16-17`) — keep every insert consistent |
| Ungated reassign/authorize endpoint | Housekeeper gaming their queue; unauthorized WO authorization | `require_role()` per action (Pitfall 5); RBAC-matrix test in CI |
| Reassign endpoint doesn't verify target housekeeper is same-tenant/active | Assigning rooms to a user outside the property | Mirror `send_direct_message`'s same-tenant recipient check (`notifications.py:107-117`) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-room / per-supervisor notification INSERT in a loop | Slow cron, many round-trips | Batch-insert notifications (readiness already builds a list then one `insert()`, `predictions.py:238-260`) — keep it batched for failures too | Multi-hotel scale, many high-risk rooms at once |
| Re-fetching `existing_risk_map` per room instead of once per hotel | Extra queries | Readiness fetches it once per hotel before the loop (`predictions.py:293`) — replicate that, don't per-item | Large properties |
| No index on the dedup/freshness columns you add | Slow filters as prediction tables grow | Add index on `(tenant_id, last_calculated_at)` / `notified_at` (repo added FK indexes in migration 038) | Grows with history retention |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Actionable button on a ghost/stale prediction | Supervisor reassigns an already-clean room | Freshness filter + "already ready" guard (Pitfall 3) |
| Same failure alert every morning | Staff mute notifications, miss the real one | Transition-only + cooldown (Pitfall 4) |
| Optimistic UI shows reassign succeeded, cron reverts display 30 min later | Confusion / distrust of the feature | Re-render from live state after action; don't leave optimistic-only state that the next cron contradicts |
| One-click action with no undo/confirm for reassign | Wrong housekeeper gets a queue dumped on them | Lightweight confirm or an undo window for reassignment (note: the mobile blocker flow already dropped an 8s-undo pattern per cerebrum — match current expectations, don't reintroduce a rejected pattern) |

## "Looks Done But Isn't" Checklist

- [ ] **Reassign endpoint:** Often missing live `room_status` re-read — verify it ignores the prediction's stale `housekeeper_id`/`risk_level`.
- [ ] **Failure notifications:** Often missing transition dedup — verify it does NOT fire on every nightly run for an unchanged high-risk asset.
- [ ] **Action on failure prediction:** Often missing `is_acknowledged=True` flip — verify the acted-on row survives the next nightly delete-then-insert.
- [ ] **Every new mutating route:** Often missing `require_role` — grep new routes for `Depends(get_current_user)` with no role gate.
- [ ] **Deep links:** Often built off `prediction_id` — verify they target `room_id`/`asset_id` and the destination re-authorizes tenant+role.
- [ ] **Stale rows:** Often uncleared — verify a cleaned room stops appearing as HIGH within one cron interval.
- [ ] **Cron resilience:** Often un-isolated — verify one tenant with no supervisors / no assets doesn't 500 the whole run.
- [ ] **Recipient source:** Often `user_profiles` — verify notifications resolve recipients from `user_roles` `is_active=True`.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Orphaned `ai_recommendations` after cron deleted the prediction (P1) | MEDIUM | Switch failure path to upsert on `(tenant_id, asset_id)`; backfill/relink orphaned recommendations by `asset_id` |
| Notification spam already shipped (P4) | LOW | Add persisted `notified_at`/dedup marker + suppress; historical spam can't be unsent |
| Ghost HIGH rooms in panel (P3) | LOW | Add read-side freshness filter immediately (fast); add cron-side stale-row clear as follow-up |
| Ungated endpoint discovered (P5) | LOW–MEDIUM | Add `require_role`, add RBAC-matrix test; audit for any actions already taken by unauthorized roles |
| Cron 500 from notification None (P6) | LOW | Wrap in per-tenant try/except + `data or []` guard; re-run cron manually via `X-Cron-Secret` endpoint |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P1 Deleted-row action | Backend action-endpoint phase | Fire nightly cron while an action is in flight; action still resolves via `asset_id` |
| P2 Stale-field reassign | Backend action-endpoint phase | Reassign twice within one cron interval; second uses live `assigned_to` |
| P3 Stale rows / broken silent dedup | Prediction-engine phase (clear) + UI phase (freshness filter) | Clean a HIGH room; it disappears within one interval; re-degrade re-notifies |
| P4 Notification spam | Notification-parity phase | Run nightly cron 3× on unchanged data; exactly 0 repeat notifications |
| P5 Missing RBAC | Action-endpoint phase → CI | RBAC-matrix test covers every new route; housekeeper cannot reassign |
| P6 Cron-crashing notify | Notification-parity phase | Tenant with no supervisors/assets; run completes, `/health` cron stays "ok" |
| P7 Deep-link auth/404 | Deep-linking phase | Forwarded link from another tenant is rejected; deleted-prediction link shows empty state |
| P8 Wrong recipient table | Notification-parity phase | Change a role in `user_roles`; alerts follow it immediately |

## Sources

- `apps/api/services/ai/predictions.py` — room readiness engine: upsert-on-`room_id`, `existing_risk_map` transition dedup, `notify_supervisors_high_risk` recipient query (HIGH confidence, primary source).
- `apps/api/services/ai/failure_predictions.py` — delete-then-insert of `is_acknowledged=False` rows, per-hotel loop isolation (HIGH confidence, primary source).
- `apps/api/routers/notifications.py` — recipient resolution via `user_roles`, tenant+user scoping, same-tenant recipient check (HIGH confidence).
- `apps/api/routers/internal.py` — `escalation_level` persisted-counter dedup pattern (the model to mirror for failure notifications) (HIGH confidence).
- `.wolf/buglog.json` — prior incidents: `get_current_user` vs `require_role` (7815), unsupported-role acknowledge (7465), `_queue_safety_notification` NoneType 500 (7552), notification bell non-functional (4526), cron all-stale incidents (7712, 10195), RBAC-matrix test presence (13892) (HIGH confidence, project-specific).
- `.wolf/cerebrum.md` — AI-recommendation lifecycle + "only GM/chief engineer can authorize" contract; A2 realtime-scope contract; supervisor assignment write shape (HIGH confidence).
- `CLAUDE.md` — multi-tenancy filter mandate, realtime-scope A2, credit-cap constraints, cron schedule table (HIGH confidence).

---
*Pitfalls research for: proactive prediction-driven alerting + one-click actions on PatelRep*
*Researched: 2026-08-12*
