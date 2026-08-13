# Pitfalls Research

**Domain:** Batch actions (AI-09) + escalation-to-GM (AI-10) added on top of PatelRep's existing single-item room-readiness alerting system (v1.6, Phase 27)
**Researched:** 2026-08-13
**Confidence:** HIGH — grounded in the actual v1.6 code (`routers/housekeeping.py` reassign/escalate/acknowledge, `routers/internal.py` work-order/task escalation ladder, `services/ai/predictions.py`, migration 095, `tests/test_room_readiness_actions.py`) and this project's own documented migration/upsert incident history, not generic advice.

> **Scope note.** This is a *subsequent* milestone bolting two new capabilities onto code that shipped in Phase 27 (v1.6). The risk surface is almost entirely about **reusing (or failing to reuse) three patterns Phase 27 already proved out**: (a) re-reading live state instead of trusting a cached prediction row, (b) the `escalation_level` tiered-ladder dedup already built for work orders/tasks in `internal.py`, and (c) the upsert-preserves-omitted-columns discipline validated by a dedicated characterization test for `is_acknowledged`. Every critical pitfall below is a way one of those three could be silently dropped when the code is generalized to "many rooms at once" and "a GM tier."

---

## Critical Pitfalls

### Pitfall 1: Batch action reads room/prediction state once, then acts on N rooms against that one stale snapshot

**What goes wrong:**
The existing single-item endpoints re-read live state as their *first* step and guard on it: `reassign_at_risk_room` re-reads `room_status.status` and 409s if it's not `{DIRTY, IN_PROGRESS, PICKUP}` (`housekeeping.py:1281-1292`); `escalate_at_risk_room` re-reads `risk_level` via `_fetch_room_prediction_or_404` and 409s if it's not `HIGH` (`housekeeping.py:1328-1332`). A batch version handling `room_ids: [r1..r10]` will be tempted to do **one bulk `SELECT ... in_(room_ids)`** up front, then loop and act on the in-memory list — which is fine for the *read*, but only if each item's action-time write is still individually re-validated against a fresh read, not against the batch snapshot taken at request start. Ten rooms take non-trivial wall-clock time to process (each reassign candidate-scoring loop does 2+ round trips per housekeeper via `count_rooms_ahead`); a room can flip CLEAN or get manually reassigned by someone else mid-batch, and item 8 acting on the item-1-era snapshot silently reassigns an already-clean room.

**Why it happens:**
"Batch-read-then-batch-act" looks like an obvious perf win (1 query instead of N), and the single-item code's re-read discipline is easy to lose when the loop body gets refactored to iterate a pre-fetched list instead of calling the existing single-item function per item.

**How to avoid:**
- The batch endpoint should **call the same per-item guard logic the single-item endpoints already use** (ideally by literally invoking `reassign_at_risk_room`/`escalate_at_risk_room`/`acknowledge_at_risk_room` per `room_id` inside the loop, not reimplementing the guard), so each item gets its own fresh `room_status`/`risk_level` read at the moment it's actually acted on — not a batch-start snapshot.
- Bulk-read is fine for building the **candidate list to show the user before they confirm** (e.g. "10 rooms currently HIGH risk"); it must not be the source of truth for the write.
- Explicitly test: kick off a batch reassign for 3 rooms, have a concurrent single-item action change room 2's status before the batch reaches it — room 2 must be skipped/409'd in the batch result, not force-reassigned.

**Warning signs:**
- Batch handler does one `SELECT ... .in_("room_id", room_ids)` and then loops purely on that in-memory result without a per-item DB read before the write.
- No 409-equivalent entry appears in the per-item result list even though a room changed state mid-batch in manual testing.

**Phase to address:** Batch-actions phase (AI-09) — backend endpoint design, before any UI wiring.

---

### Pitfall 2: Batch action has no defined partial-failure contract — this project's only existing batch precedent already gets this wrong

**What goes wrong:**
`create_assignments` (`housekeeping.py:828-937`) is the **only existing multi-item write endpoint** in this codebase and is the closest precedent for AI-09. It validates all items up front (`_ensure_tenant_row`/`_ensure_housekeeper` in a loop, `housekeeping.py:836-838` — good, all-or-nothing on validation), then does a **single atomic `upsert()` for the `room_assignments` rows** (`housekeeping.py:886-898`, wrapped in try/except → 409 or 500) — but that's followed by **two more non-atomic per-room loops**: `room_status` updates (`housekeeping.py:900-927`) and fire-and-forget push notifications (`housekeeping.py:930-937`). If the `room_status` update for room 6 of 10 throws (e.g. a Supabase transient error), rooms 1-5 already have both `room_assignments` and `room_status` written correctly, rooms 7-10 never run, and the caller gets a single 500 with **no indication which rooms succeeded**. There is no per-item result list anywhere in this endpoint today. A batch reassign/escalate/acknowledge endpoint copying this shape inherits the exact same gap, except now the failure mode is worse because these actions are explicitly framed to the user as "act on N flagged rooms" — an opaque 500 after item 6 fails leaves the supervisor unable to tell which of the 10 rooms actually got reassigned.

**Why it happens:**
The Supabase Python SDK has no multi-statement transaction primitive available to router code in this project (confirmed: no `BEGIN`/`COMMIT` usage anywhere in `routers/`), so "all-or-nothing" is only achievable within a single `upsert()`/`insert()` call, not across the multiple distinct writes one "action" requires (assignment + room_status mirror + notification, or prediction update + notification). Batch just multiplies this per-item instead of once.

**How to avoid:**
- **Decide explicitly, before implementation: best-effort with a per-item result list**, not all-or-nothing across items — this matches the domain (a supervisor wants "8 succeeded, 2 need manual attention," not the whole batch rolled back because one room changed status). Return `{"data": {"results": [{"room_id": ..., "action": "reassigned"|"escalated"|"skipped", "reason": ...}, ...]}}` mirroring the single-item response shape per item.
- Wrap each item's action in its own try/except inside the loop so one room's failure doesn't abort the remaining items (the existing `create_assignments` room_status loop does **not** do this today — don't copy that gap forward).
- Cap batch size (e.g. 25-50 rooms) so partial-failure blast radius and request latency stay bounded — there's no precedent for unbounded batch size in this codebase.

**Warning signs:**
- Batch endpoint wraps the whole loop in one try/except that returns 500 on any single-item failure.
- Response shape has no per-item breakdown, only a single aggregate success/failure.
- No test exercises "item 3 of 5 fails, verify 1/2/4/5 still succeeded and the response says so."

**Phase to address:** Batch-actions phase (AI-09) — this is the core design decision of that phase, not an edge case to patch in later.

---

### Pitfall 3: Escalation-to-GM reintroduces the exact spam risk the work-order/task ladder was built to prevent, because room-readiness has no tiered counter today

**What goes wrong:**
This codebase already solved "notify → notify harder → auto-act" exactly once, for work orders and tasks: `check_escalations` in `internal.py:481-589` uses a **persisted `escalation_level` SMALLINT (0-3)** column (migration `041_escalation_level.sql`) with `.lt("escalation_level", N)` guards before every tier transition, so a `*/30` cron re-run never re-notifies a tier that's already fired (`internal.py:506,522,535,552,571,580`). Room readiness has **no equivalent counter** — it only has a boolean `is_acknowledged` (migration `095_room_readiness_acknowledgement.sql`) that a *human* sets by clicking Acknowledge, and `notify_supervisors_high_risk` (`predictions.py:197-260`) has **zero dedup logic of its own** — it unconditionally inserts a notification for every supervisor/GM every time it's called (its only caller-side protection today is the cron's `previous_risk != "HIGH"` transition check, plus the fact that a human manually clicking Escalate is expected to want to notify again). If AI-10 adds a new "auto-escalate to GM after room stays HIGH+unacknowledged for N minutes" cron tier and either (a) reuses `is_acknowledged` as the dedup gate, or (b) calls `notify_supervisors_high_risk` directly from the new cron without its own persisted marker, the GM gets re-notified every `*/30` cron cycle for as long as the room stays HIGH and unacknowledged — the identical alert-fatigue failure mode `escalation_level` was built to prevent for work orders, reintroduced for rooms because the two subsystems don't share a mechanism.

**Why it happens:**
`escalation_level` and `is_acknowledged` solve adjacent but different problems (system-driven tiered dedup vs. human-driven suppression) and a developer building AI-10 by pattern-matching "how do we escalate something in this codebase" is equally likely to find either one first — `is_acknowledged` is literally in the same table the new feature touches, making it the path of least resistance even though it's the wrong primitive for auto-escalation dedup.

**How to avoid:**
- Add a **tiered `escalation_level` column to `room_readiness_predictions`**, mirroring `041_escalation_level.sql` exactly (`SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 2)` — GM tier only needs 0=none/1=supervisor-notified(existing)/2=GM-notified), and gate the new GM-tier cron on `.lt("escalation_level", 2)` the same way `internal.py` gates its tiers.
- Keep `is_acknowledged` as the separate human-suppression signal it already is — acknowledging should still suppress the GM-escalation cron from firing (an acknowledged room shouldn't auto-escalate to the GM), but acknowledging is not the same event as "GM already notified."
- If time-in-HIGH is the trigger condition (matching the ladder's due_at-based minutes-overdue model), the room needs a timestamp to measure from — `last_calculated_at` is refreshed every cron regardless of risk level, so it's the wrong anchor; use the timestamp the row first went `HIGH` (does not exist yet — needs its own column, e.g. `high_since`), not `last_calculated_at`.

**Warning signs:**
- New escalation cron code calls `notify_supervisors_high_risk` (or a GM-only variant) without first checking a persisted "already notified at this tier" column.
- GM-escalation dedup logic reads `is_acknowledged` as its only gate.
- No new column analogous to `escalation_level` appears in the migration for this feature.
- Manual test: leave a room HIGH and unacknowledged across 3 consecutive `*/30` cron runs — GM should get exactly one notification, not three.

**Phase to address:** Escalation phase (AI-10) — this is the core design decision of that phase.

---

### Pitfall 4: New escalation-state column(s) silently reset every `*/30` cron cycle unless `run_room_predictions` is taught to preserve them — exactly like `is_acknowledged` had to be

**What goes wrong:**
`room_readiness_predictions` rows are rewritten via `upsert(on_conflict="room_id")` every `*/30` cron run. When `is_acknowledged`/`acknowledged_at`/`acknowledged_by` were added (migration 095), the upsert *payload* built by `run_room_predictions` only ever set `risk_level`, `predicted_ready_at`, etc. — it never listed the ack columns — which only works because the FakeDB/Postgres upsert semantics **preserve omitted columns on conflict**, a behavior load-bearing enough that this project wrote a dedicated characterization test for it before trusting it (`test_upsert_preserves_omitted_ack_columns_on_conflict`, `test_room_readiness_actions.py:42-57`). Crucially, `run_room_predictions` was *also* explicitly coded to **actively clear** `is_acknowledged` when risk drops below HIGH (`test_run_room_predictions_clears_ack_when_risk_drops_below_high`, `test_room_readiness_actions.py:114-138`) — omission-preservation and explicit-reset are two different, both-necessary behaviors that had to each be written and tested. A new `escalation_level`/`high_since` column added for AI-10 needs the **identical two-part treatment**: (a) confirm via a characterization test that omitting it from the upsert payload preserves it across cron runs, and (b) explicitly decide and code whether it resets when risk drops below HIGH (almost certainly yes, mirroring `is_acknowledged`) — if the second half is skipped, a room that flickers HIGH → cleaned → HIGH again inherits a stale `escalation_level=2` from its first HIGH episode and the GM-tier cron silently never fires for the second, genuinely new episode (same "worse than spam — silent non-alert" failure mode already flagged for `previous_risk` staleness in the prior Phase-27 pitfalls research).

**Why it happens:**
It's easy to assume "we already proved upsert preserves columns" covers *any* new column added later — but that characterization test only proves the *preservation* half. The *reset-on-resolve* half is separate application logic that has to be written per-column and is easy to forget when adding a second escalation-related column to a table that already has one.

**How to avoid:**
- Write a new characterization test (or extend the existing one) asserting the upsert preserves the new escalation column(s) across a cron cycle where risk stays HIGH.
- Write a companion test asserting `run_room_predictions` **resets** the new column(s) to 0/NULL when risk drops below HIGH, mirroring `test_run_room_predictions_clears_ack_when_risk_drops_below_high` exactly.
- Decide reset semantics explicitly and document the decision in the migration's `COMMENT ON COLUMN` (migration 095 does this — reuse that convention).

**Warning signs:**
- Migration adds a column but no corresponding test exercises a full cron cycle with it populated.
- `run_room_predictions`'s upsert payload-building code is not touched at all when the new column is added (a sign the reset-on-resolve logic was never written, only the column).
- Manual test: escalate a room to GM tier, wait for it to clear (cleaned), let it go HIGH again — GM should be notified again; if it isn't, the column didn't reset.

**Phase to address:** Escalation phase (AI-10) — prediction-engine change, verified alongside the notification-dedup work in Pitfall 3.

---

### Pitfall 5: New migration ships in the repo but the deployment-gap discipline this project has already been burned by twice (v1.2, v1.3) isn't automatically inherited by a new feature

**What goes wrong:**
This project's migration history already shows drift between "the file exists in the repo" and "the column exists in production": 99 migration files exist in `supabase/migrations/` today, but `CLAUDE.md`'s own "Key migrations" reference table only documents through migration 041 — 58 more migrations (042-095, including the `is_acknowledged` columns this exact feature will build on) postdate the last time that doc was updated. Two prior milestones (v1.2, v1.3, per project memory) shipped code-complete, tested migrations that were **never actually applied to production**, caught only by milestone-level audits querying live schema state — not by CI, not by code review. AI-10's new `escalation_level`/`high_since` column(s) on `room_readiness_predictions` are exactly the kind of small, easy-to-miss `ALTER TABLE ... ADD COLUMN` that slipped through before. If the escalation cron ships and reads/writes a column that's present in staging (where migrations ran) but not yet applied in production, the cron either 500s outright or — worse, if the Supabase client fails open on an unrecognized column in a partial update — silently no-ops the escalation write while reporting success.

**Why it happens:**
Migrations in this repo are applied by whatever manual/CI process runs `supabase migration up` (or equivalent) against Railway's Postgres, decoupled from the code deploy that ships the router changes depending on the new column. Nothing in the deploy pipeline currently blocks a code deploy that references a column from a migration that hasn't run yet.

**How to avoid:**
- Before considering the escalation-phase work "done," **query the live production schema directly** (e.g. via Supabase MCP `list_tables` or `information_schema.columns`) to confirm the new column(s) exist — don't infer it from "the migration file is in `git log`" or "it worked locally."
- Add the new migration to `CLAUDE.md`'s "Key migrations" table as part of this phase's PR, closing part of the existing doc-drift gap rather than adding to it.
- Sequence the deploy so the migration is confirmed-applied to production **before** the router/cron code that depends on the new column is deployed, not simultaneously.

**Warning signs:**
- The escalation cron starts throwing column-not-found errors in production only, not in local/staging tests.
- `git log supabase/migrations/` shows the new file committed, but nobody has confirmed it ran against the Railway Postgres instance.
- `CLAUDE.md`'s migration table still says "041" after this phase ships.

**Phase to address:** Escalation phase (AI-10) — deployment/release step, verified before marking the phase complete, not a coding concern.

---

### Pitfall 6: Batch endpoint validates tenant scope for the request as a whole but not for every individual `room_id` in the array

**What goes wrong:**
Every existing per-item action calls `_ensure_tenant_row("rooms", room_id, current_user.hotel_id, "Room")` (`housekeeping.py:1279, 1327, 1352`) — a single-row tenant-scoped existence check per call. A batch endpoint accepting `room_ids: list[str]` will naturally want to replace N individual existence checks with one bulk query — e.g. `supabase.table("rooms").select("id").in_("id", room_ids).eq("tenant_id", hotel_id)` — which is fine **only if the handler then verifies every requested `room_id` actually came back in that filtered result**, i.e. `len(returned_ids) == len(room_ids)` or explicitly diffs the two sets. If the code instead just fetches the tenant-filtered subset and silently iterates only over what came back, a room ID belonging to a different hotel (typo, stale client cache, or a malicious/curious user editing a request body) is **silently dropped instead of rejected** — which is a correctness bug more than a security hole here (RLS still blocks the actual read/write), but it produces a batch result that doesn't match what the caller thinks it requested and can mask the fact that a room ID was wrong.

**Why it happens:**
Bulk `.in_()` + `.eq("tenant_id", ...)` is the natural, idiomatic way to fetch N rows scoped to a tenant in one query, and the "does every requested ID appear in the result" check is an easy step to drop because the query already "does the filtering" — it just filters silently instead of loudly.

**How to avoid:**
- After the bulk tenant-scoped fetch, diff `set(requested_room_ids) - set(returned_room_ids)` and surface any missing ID as an explicit per-item `"not_found"` result (reusing the per-item result list from Pitfall 2), not a silent drop.
- Keep `require_role("gm", "housekeeping_supervisor")` on the batch endpoint exactly as the single-item endpoints already have it — no new RBAC decision needed here, just don't lose the existing one when refactoring to a batch shape.

**Warning signs:**
- Batch endpoint's tenant-scoped query result length isn't compared against the input `room_ids` length anywhere.
- No test sends a `room_ids` array containing an ID from a second tenant fixture and asserts it's reported, not just omitted.

**Phase to address:** Batch-actions phase (AI-09) — same phase as Pitfall 1/2, same endpoint.

---

### Pitfall 7: Frontend has no existing multi-select pattern to reuse — batch UI risks losing the per-item confirm-before-act discipline `PredictionPanel` already has

**What goes wrong:**
`PredictionPanel.tsx` (`components/housekeeping/PredictionPanel.tsx:64-221`) is built entirely around **one room, one inline confirm-then-act flow** (`mode: 'confirm-reassign' | 'confirm-escalate' | 'confirm-acknowledge'`, a cancel button, a loading state, a result note) — there is no multi-select checkbox, "select all," or batch-confirm pattern anywhere in this codebase to extend. Building AI-09's batch UI from scratch risks two opposite failure modes: (a) losing the confirm step entirely for speed ("select 10 rooms, one Reassign All button, no per-room review"), which removes the safety net that made single-item actions safe to add in the first place, since reassignment is a workload-affecting action reviewed as "supervisory" per this codebase's RBAC decisions; or (b) building a batch UI that still requires per-item confirmation, which defeats the point of batching. Neither extreme has been decided yet, and there's no prior pattern in this repo (mobile or web) to copy for "confirm N items at once, show per-item results."

**Why it happens:**
Every other bulk-ish flow in this app (task-sheet import, PDF-based room assignment) is a background/import operation, not an interactive multi-select-then-confirm UI — so there's genuinely no local precedent, unlike the backend where `create_assignments` at least exists as *a* batch pattern to critique.

**How to avoid:**
- Decide explicitly (product/UX call, not an implementation detail): one confirm step for the whole batch selection, showing the room list being acted on before the single confirm click — mirroring the existing inline-confirm affordance's intent (visible list + one deliberate confirm) rather than either silent-bulk-action or N separate confirms.
- Surface the per-item result list (Pitfall 2) after the batch completes, using the same success/escalated/skipped states the single-item flow already renders (`reassignedTo`, `escalatedNoCapacity`, `already_acknowledged` — `PredictionPanel.tsx:98-110`) per row, not just an aggregate toast.

**Warning signs:**
- Batch UI ships with no visible list of what's about to be acted on before the confirm click.
- Batch UI shows only a single aggregate success/failure toast with no per-room breakdown, despite the backend actually returning per-item results (Pitfall 2).

**Phase to address:** Batch-actions phase (AI-09) — UI sub-phase, after the backend result-list contract (Pitfall 2) is settled, since the UI design depends on that shape.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Batch-read room/prediction state once, act on all items from that snapshot | Fewer DB round trips | Stale-state actions on later items in a slow batch (Pitfall 1) | Never for the write path; fine for the pre-confirm preview list only |
| Wrap the whole batch loop in one try/except → single 500 on any failure | Less code | Opaque partial state, caller can't tell what succeeded (Pitfall 2) — this is what `create_assignments` already does, don't propagate it | Never — always per-item try/except + result list |
| Gate GM-escalation dedup on `is_acknowledged` instead of a new tiered counter | Reuses an existing column, no migration needed | Re-notifies GM every cron cycle while unacknowledged — the exact spam bug `escalation_level` was built to prevent (Pitfall 3) | Never |
| Add new escalation column without a preserve/reset characterization test pair | Faster to ship | Silent stale-tier bug on re-degrade, worse than spam (Pitfall 4) | Never — this project already paid for this lesson once (migration 095) |
| Bulk tenant-scoped fetch without diffing requested vs. returned IDs | Simpler query | Silently drops out-of-tenant/bad IDs instead of reporting them (Pitfall 6) | Never — cheap to add the diff |
| Ship batch UI with a single aggregate result toast | Faster to build | Supervisor can't tell which rooms need manual follow-up (Pitfall 7) | MVP-only if the per-item backend result is at least logged/inspectable elsewhere |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `*/30` room-readiness cron vs. new `escalation_level`/`high_since` column | Column gets clobbered to default on every upsert because the field wasn't accounted for in preserve/reset logic | Explicit preserve-on-upsert + reset-below-HIGH tests, mirroring `is_acknowledged` (Pitfall 4) |
| Existing `internal.py` escalation ladder (`work_orders`/`tasks`) vs. new room-readiness GM tier | Two independent, drifting implementations of "tiered escalation" in the same codebase | Mirror the `escalation_level SMALLINT 0-N CHECK` + `.lt("escalation_level", N)` pattern exactly (Pitfall 3) |
| `notify_supervisors_high_risk` vs. new GM-tier notification | Calling it directly from a new cron without a persisted dedup gate, assuming it dedups itself (it doesn't — it's unconditional) | Gate the call site, not the helper; add the tier check before calling |
| Supabase SDK (no multi-statement transactions) vs. multi-write batch actions | Assuming "batch endpoint" implies atomic all-or-nothing across items | Explicit best-effort + per-item result list contract (Pitfall 2), decided up front |
| Migration deploy pipeline vs. code deploy | Assuming a merged migration file means the column exists in production | Verify live schema (Supabase `information_schema.columns` or MCP `list_tables`) before/as part of marking the phase done (Pitfall 5) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Batch endpoint silently drops out-of-tenant `room_id`s instead of rejecting/reporting | Masks a caller sending IDs it shouldn't have (typo, stale cache, or probing); RLS already blocks the actual data leak, but the app-layer signal is lost | Diff requested vs. returned tenant-scoped IDs, report mismatches explicitly (Pitfall 6) |
| New GM-escalation notification payload copies `data: {"room_id": ...}` pattern from `predictions.py:248` without re-checking destination authorization | Same deep-link-trusts-notification risk already flagged for the readiness/failure-prediction parity work — applies again to any new GM-facing deep link | Destination route re-enforces `tenant_id` + role independent of arriving via notification |
| Batch action endpoint reuses `require_role("gm", "housekeeping_supervisor")` correctly but a new *separate* GM-only escalation-acknowledgement endpoint (if AI-10 adds one) forgets the gate | Recurring pattern in this codebase (`.wolf/buglog.json`: `get_current_user` vs `require_role` mixups) | Explicit RBAC-matrix test coverage for every new route, including new AI-10 endpoints, not just the batch ones |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-room `count_rooms_ahead` scoring loop (existing single-item reassign logic) run serially inside a batch of N rooms | Batch reassign of 10-20 rooms takes multiple seconds, increasing the staleness window from Pitfall 1 | Consider precomputing housekeeper loads once per batch request rather than recomputing per room per candidate; but must still re-validate each room's live status before writing (don't trade Pitfall 1 for speed) | Large batches (near the cap suggested in Pitfall 2) on a full-occupancy day |
| Per-item notification INSERT in a batch escalate loop | N supervisors × M rooms individual inserts | Batch-insert notifications in one call the way `notify_supervisors_high_risk` already batches per-room (`predictions.py:238-260`) — extend that batching across rooms in one batch-escalate call, not one insert call per room | Batches near the size cap with many supervisors |
| No index on new `escalation_level`/`high_since` columns | Slow GM-escalation cron query as `room_readiness_predictions` grows | Add a partial index mirroring `idx_work_orders_escalation` (`041_escalation_level.sql:24-26`) — `(tenant_id, escalation_level, high_since) WHERE risk_level = 'HIGH'` | Grows with hotel count × room count over time |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Batch action with no visible per-item preview before confirm | Supervisor bulk-reassigns a room they didn't mean to include | Show the selected-room list in the confirm step, mirroring the existing inline-confirm pattern (Pitfall 7) |
| Batch result shown as one aggregate toast | Supervisor can't tell which of 10 rooms actually succeeded, has to re-check the board manually | Per-item result list rendered per row (Pitfall 2 + 7) |
| GM gets re-notified every 30 min for the same unresolved room | Alert fatigue, GM mutes notifications, misses genuinely new escalations | Tiered `escalation_level` dedup (Pitfall 3) |
| Escalating to GM has no visible "already escalated to GM" state in the UI | Supervisor doesn't know whether clicking Escalate again does anything new | Surface `escalation_level` in the panel (e.g. "Escalated to GM 12 min ago") so the action's effect is legible, matching the existing "already_acknowledged" idempotent-response pattern (`PredictionPanel.tsx:108-110`) |

## "Looks Done But Isn't" Checklist

- [ ] **Batch reassign/escalate/acknowledge:** Often does a batch-read-then-batch-act — verify each item re-reads live `room_status`/`risk_level` at write time, not from a request-start snapshot (Pitfall 1).
- [ ] **Batch endpoint response:** Often returns a single aggregate result — verify it's a per-item list with explicit success/skipped/not_found/error per `room_id` (Pitfall 2).
- [ ] **GM-escalation cron:** Often reuses `is_acknowledged` or calls `notify_supervisors_high_risk` directly — verify it gates on a new tiered `escalation_level`-style counter, not a boolean or an unconditional call (Pitfall 3).
- [ ] **New escalation column(s):** Often ships with only a migration, no cron-cycle test — verify both a preserve-on-upsert-while-HIGH test AND a reset-when-below-HIGH test exist (Pitfall 4).
- [ ] **Migration deploy:** Often assumed-applied because the file is merged — verify against live production schema before closing the phase, and update `CLAUDE.md`'s migration table (Pitfall 5).
- [ ] **Batch tenant scoping:** Often filters silently — verify requested vs. returned `room_id` sets are diffed and mismatches are reported, not dropped (Pitfall 6).
- [ ] **Batch UI:** Often ships as one-button-no-preview or defeats the point with N confirms — verify a single confirm with a visible item list, then per-item results after (Pitfall 7).
- [ ] **RBAC on any new AI-10 endpoint:** Often uses `get_current_user` instead of `require_role` — grep for the mismatch, add to the RBAC-matrix test.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Batch action acted on stale state (P1) | LOW–MEDIUM | Because reassign/acknowledge are idempotent-ish and escalate just notifies, worst case is a spurious reassignment on an already-clean room — manually re-run correct assignment; add the per-item re-read guard and redeploy |
| Opaque partial batch failure already shipped (P2) | LOW | Add per-tenant/per-item try/except + result list; for the specific failed batch, cross-check `room_assignments`/`room_readiness_predictions` directly against the requested `room_ids` to determine actual state |
| GM-escalation spam already shipped (P3) | LOW | Add persisted `escalation_level` gate; historical spam can't be unsent, but a fast follow-up stops it immediately |
| Stale `escalation_level` blocks a real re-escalation (P4) | LOW | Add the reset-on-resolve logic; one-time backfill: reset `escalation_level` to 0 for any room currently below HIGH |
| Migration not applied in production discovered late (P5) | MEDIUM | Apply the migration directly against production via Supabase MCP/CLI, then verify with `information_schema.columns` before re-enabling the dependent cron/endpoint |
| Cross-tenant room ID silently dropped from a batch (P6) | LOW | Add the diff-and-report check; audit logs for any batch requests that returned fewer results than requested `room_ids` |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|---------------|
| P1 Batch-read-then-batch-act staleness | Batch-actions phase (AI-09) | Concurrent test: mutate room state mid-batch, verify the batch result reflects the fresh state at write time, not request-start |
| P2 Undefined partial-failure semantics | Batch-actions phase (AI-09) | Test: force item 3 of 5 to fail, verify items 1/2/4/5 still succeed and the response lists all 5 outcomes individually |
| P3 GM-escalation spam | Escalation phase (AI-10) | Run the escalation cron 3× consecutively on an unchanged unacknowledged-HIGH room; exactly 1 GM notification, not 3 |
| P4 Escalation column reset/preserve gap | Escalation phase (AI-10) | Two characterization tests: preserve-while-HIGH, reset-when-below-HIGH — both green before merge |
| P5 Migration deployment gap | Escalation phase (AI-10) | Query live production `information_schema.columns` for the new column(s) before marking the phase complete; update `CLAUDE.md` migration table |
| P6 Cross-tenant ID silently dropped | Batch-actions phase (AI-09) | Test: batch request includes one `room_id` from a second-tenant fixture, verify it's reported as `not_found`/rejected, not silently omitted |
| P7 No batch UI precedent → lost confirm discipline | Batch-actions phase (AI-09), UI sub-phase | Manual QA: batch UI shows selected-room list pre-confirm and per-room results post-batch |

## Sources

- `apps/api/routers/housekeeping.py:1275-1362` — existing `reassign_at_risk_room`/`escalate_at_risk_room`/`acknowledge_at_risk_room`: live-state re-read + 409 guards, the pattern batch actions must not lose (HIGH confidence, primary source).
- `apps/api/routers/housekeeping.py:828-937` — `create_assignments`: this project's only existing multi-item write endpoint; validates all-or-nothing, writes non-atomically across 3 phases, no per-item result — the concrete cautionary precedent for Pitfall 2 (HIGH confidence, primary source).
- `apps/api/routers/internal.py:461-589` — `check_escalations`: the proven 3-tier `escalation_level` ladder for work orders/tasks, the pattern AI-10 should mirror rather than reinvent (HIGH confidence, primary source).
- `apps/api/services/ai/predictions.py:197-260` — `notify_supervisors_high_risk`: confirmed to have no dedup of its own; all dedup today is caller-side (HIGH confidence, primary source).
- `supabase/migrations/041_escalation_level.sql` — exact schema/index pattern for tiered escalation columns (HIGH confidence, primary source).
- `supabase/migrations/095_room_readiness_acknowledgement.sql` — most recent precedent for adding columns to the upsert-based prediction table, with `COMMENT ON COLUMN` documentation convention (HIGH confidence, primary source).
- `apps/api/tests/test_room_readiness_actions.py:42-57, 87-138` — the upsert-preserves-omitted-columns characterization test and the ack-reset-on-resolve test; the exact template Pitfall 4's new tests should follow (HIGH confidence, primary source).
- `apps/web/components/housekeeping/PredictionPanel.tsx:64-221` — confirms no multi-select/batch UI pattern exists yet in this codebase (HIGH confidence, primary source).
- Repo migration count (`ls supabase/migrations/` → 99 files) vs. `CLAUDE.md`'s "Key migrations" table (documents only through 041) — direct evidence of the doc-drift risk described in Pitfall 5 (HIGH confidence, verified this session).
- Project memory: v1.2/v1.3 code-complete-but-unapplied-migration incidents, caught only by live-schema audits (MEDIUM confidence — sourced from project memory/milestone history, not re-verified against a specific commit this session).
- `.planning/research/PITFALLS.md` (prior Phase-27 research, 2026-08-12) — background on the `is_acknowledged`/upsert design this milestone builds directly on top of (HIGH confidence, same repo, prior research pass).

---
*Pitfalls research for: batch actions (AI-09) + escalation-to-GM (AI-10) on PatelRep's v1.6 room-readiness alerting system*
*Researched: 2026-08-13*
