# Phase 25: Failure-Prediction Proactive Push + Dedup - Research

**Researched:** 2026-08-12
**Domain:** Backend cron/service logic (FastAPI + Supabase Python SDK), notification insert pattern
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**HIGH threshold and dedup anchor**
- Reuse the risk threshold already coded in `run_asset_failure_predictions` (`risk_score >= 70` is how `high_risk` is currently counted) — do not invent a new threshold or a config value.
- Dedup is edge-triggered by comparing against the asset's **existing** `failure_risk_score` column value, read from the initial `assets` fetch at the top of `run_asset_failure_predictions` (`select("*")` already includes it) — i.e. the value written by the *previous* run, captured before this run's delete-then-insert/update overwrites it for that asset. This mirrors `run_room_predictions`' `existing_risk_map` snapshot-before-loop technique, just sourced from the assets table's own column instead of a separate lookup table.
- A `None`/never-analyzed prior score counts as "not HIGH", so an asset's first-ever HIGH prediction correctly fires a notification.
- Trigger condition: `previous_score < 70 and new_score >= 70`. A HIGH asset that stays HIGH run after run (`previous_score >= 70 and new_score >= 70`) must NOT re-notify. An asset that drops out of HIGH and later re-enters HIGH must notify again.

**Recipients**
- Query `user_roles` (not `user_profiles`), filtered `tenant_id = hotel_id`, `role in ("engineer", "chief_engineer", "gm")`, `is_active = True`. Follows the exact query shape already used elsewhere in the codebase — `.eq("tenant_id", ...).in_("role", [...]).eq("is_active", True)`.
- No `housekeeping_supervisor` in the recipient set.

**Notification content and shape**
- Mirror `notify_supervisors_high_risk`'s insert exactly: batch-insert directly into `notifications` (type/title/body/data/is_read/push_sent), no `notification_deliveries` row.
- `type`: `"asset_risk_high"` (parallel to room-readiness's `"room_risk_high"`).
- `title`: references the specific asset by name, e.g. `f"{asset_name} at high failure risk"`.
- `body`: includes the predicted failure window and/or one-line recommendation from the prediction payload already computed that run (`predicted_failure_window`, `recommendation`) — no extra AI/DB call needed.
- `data`: `{"asset_id": asset_id, "risk_level": "HIGH", "risk_score": risk_score}`.

**Placement and failure isolation**
- New function lives in `services/ai/failure_predictions.py` (not a new file, not `predictions.py`).
- Call it from inside the per-asset loop in `run_asset_failure_predictions`, after the existing `failure_predictions` upsert and `assets.failure_risk_score` update steps, using the risk_score captured from the asset row at the top of the loop as "previous."
- The notify call is wrapped in its own try/except so a malformed-data or transient-DB failure on the notification step logs and continues to the next asset — does not abort the rest of that hotel's assets, and (via the existing outer per-hotel try/except in `run_all_hotels_failure_predictions`) does not abort other tenants' runs either.
- `run_asset_failure_predictions`'s return dict gains a `notifications_sent` key.

### Claude's Discretion
- Exact wording of title/body copy beyond the structure above.
- Whether to fetch recipients once per hotel (cached across the asset loop) vs. per newly-HIGH asset — prefer per-hotel caching only if it doesn't complicate the per-tenant-isolation try/except boundary; a straightforward per-notify-call fetch (matching `notify_supervisors_high_risk`'s existing per-call fetch style) is acceptable and simpler to reason about for isolation.
- Test file organization (new test file vs. extending an existing `test_failure_prediction*.py` file) — follow whatever pattern already exists for this module's tests.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. Phase 26 covers deep-linking the resulting alert into a real asset detail page; Phase 27 covers reassign/escalate/acknowledge for room-readiness (not asset failure predictions) — both out of scope here by roadmap design.
</user_constraints>

## Summary

This is a small, well-precedented backend change: add one new function to `apps/api/services/ai/failure_predictions.py` that mirrors the existing `notify_supervisors_high_risk` function in `apps/api/services/ai/predictions.py`, and call it from inside the per-asset loop of `run_asset_failure_predictions`. All decisions in CONTEXT.md were verified against the actual codebase and are directly implementable as stated, with one important correction: the `assets.failure_risk_score` column has `DEFAULT 0` (not NULL) at the DB level, so the "never-analyzed" case in practice reads as `0`, not `None` — the dedup comparison must treat both `None` and `0` (and any missing key) as "not HIGH" via `(asset.get("failure_risk_score") or 0) < 70`.

There is no existing partial implementation of this feature anywhere in the codebase (verified via grep for `asset_risk_high` and `failure_risk` + notification terms — the only hits are ROADMAP.md/STATE.md/research docs and the CONTEXT.md file itself). There is also no existing test file for `failure_predictions.py` at all — only `test_ai_provider_configuration.py` imports the module (to verify it imports cleanly without API keys). This means the phase's tests will be a **new** test file, following the direct-router/service-call + `FakeDB` + `monkeypatch.setattr(module, "supabase", db)` harness pattern already used across the top-level (non-smoke) `apps/api/tests/` directory (e.g. `test_internal_escalations.py`, `test_lost_found_retention.py`).

**Primary recommendation:** Add `notify_engineers_asset_risk_high(hotel_id, asset_name, asset_id, risk_score, predicted_failure_window, recommendation) -> int` to `failure_predictions.py`, call it in the per-asset loop guarded by `previous_score < 70 <= new_score`, and test it with a new `apps/api/tests/test_failure_prediction_notifications.py` using `tests.smoke.fake_supabase.FakeDB` + `monkeypatch.setattr(failure_predictions, "supabase", db)`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| supabase-py | pinned in `apps/api/requirements.txt` | DB access via `core.database.supabase` singleton (`_LazySupabase` proxy) | Already used exclusively for all DB access in this codebase; no ORM |
| pytest | 9.1.1 | Test runner | Repo standard (`apps/api/requirements.txt`) |
| pytest-asyncio | 1.4.0 | Async test support (`@pytest.mark.asyncio`) | Needed because `run_asset_failure_predictions` is `async def` |

### Supporting
No new libraries needed. This phase is pure application logic reusing existing DB tables and the existing Supabase client.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reading `previous_score` from the initial `assets.select("*")` fetch | A separate "previous risk" tracking table | Rejected by CONTEXT.md — no new migration allowed, and the assets table's own column is sufficient since it's read before being overwritten in the same loop iteration |
| Per-call recipient fetch (mirrors `notify_supervisors_high_risk`) | Per-hotel cached fetch (once before the asset loop) | CONTEXT.md leaves this to discretion; per-call fetch is simpler and keeps failure isolation clean per asset — recommended (see Architecture Patterns) |

**Installation:**
No new packages to install — this phase only adds code to an existing file.

## Architecture Patterns

### Recommended Project Structure
No new files/directories except the test file:
```
apps/api/
├── services/ai/
│   └── failure_predictions.py    # existing file — add notify_engineers_asset_risk_high() here
└── tests/
    └── test_failure_prediction_notifications.py   # new — mirrors test_internal_escalations.py / test_lost_found_retention.py style
```

### Pattern 1: Snapshot-before-overwrite dedup (mirrors `run_room_predictions`)
**What:** Capture the "previous" state value from a row *before* that row is mutated later in the same function, then compare pre/post to detect a state transition.
**When to use:** Any dedup/edge-trigger notification where there's no separate history table.
**Example (existing, verified working pattern in `predictions.py`):**
```python
# Source: apps/api/services/ai/predictions.py lines 292-306, 424-436
existing_preds_result = (
    supabase.table("room_readiness_predictions")
    .select("room_id, risk_level")
    .eq("tenant_id", hotel_id)
    .execute()
)
existing_risk_map: dict[str, str] = {
    r["room_id"]: r.get("risk_level", "LOW")
    for r in (existing_preds_result.data or [])
}
# ... later, per room, after computing new risk_level ...
previous_risk = existing_risk_map.get(room_id, "LOW")
if risk_level == "HIGH" and previous_risk != "HIGH":
    sent = notify_supervisors_high_risk(hotel_id, room_number, room_id, predicted_ready_at.isoformat())
    notifications_sent += sent
```
**Adaptation for Phase 25:** No separate map/query is needed at all — the `assets` table is already fetched with `select("*")` at the top of `run_asset_failure_predictions` (line 326-332 of `failure_predictions.py`), and each `asset` dict in that list already carries `failure_risk_score` from the *previous* run. Capture it into a local variable (`previous_score = asset.get("failure_risk_score") or 0`) **before** the loop body computes and writes the new `risk_score` for that same asset. This is simpler than `predictions.py`'s pattern because there's no separate history table to join.

### Pattern 2: Direct batch-insert notification helper (mirrors `notify_supervisors_high_risk`)
**What:** A small, synchronous, standalone function that: (1) fetches recipients, (2) builds a list of notification dicts, (3) batch-inserts into `notifications`, (4) returns the count inserted. Every step wrapped in its own try/except returning `0` on failure — never raises.
**When to use:** Exactly this phase's notify function.
**Example (existing, verified working — this is the pattern to mirror exactly):**
```python
# Source: apps/api/services/ai/predictions.py lines 197-264 (notify_supervisors_high_risk)
def notify_supervisors_high_risk(hotel_id, room_number, room_id, predicted_ready_at_str) -> int:
    try:
        supervisors_result = (
            supabase.table("user_profiles")
            .select("user_id")
            .eq("tenant_id", hotel_id)
            .in_("role", ["housekeeping_supervisor", "gm"])
            .execute()
        )
        supervisors = supervisors_result.data or []
    except Exception as exc:
        logger.error("Failed to fetch supervisors for hotel=%s: %s", hotel_id, exc)
        return 0

    if not supervisors:
        return 0

    notifications = [
        {
            "tenant_id": hotel_id,
            "user_id": s["user_id"],
            "type": "room_risk_high",
            "title": f"Room {room_number} at risk",
            "body": f"Room {room_number} may not be ready before check-in. Predicted ready: {formatted_time}",
            "data": {"room_id": room_id, "risk_level": "HIGH"},
            "is_read": False,
            "push_sent": False,
        }
        for s in supervisors
        if s.get("user_id")
    ]

    if not notifications:
        return 0

    try:
        supabase.table("notifications").insert(notifications).execute()
        return len(notifications)
    except Exception as exc:
        logger.error("Failed to insert high-risk notifications for hotel=%s: %s", hotel_id, exc)
        return 0
```
**Adaptation for Phase 25 — recipient query uses `user_roles`, not `user_profiles`:**
```python
recipients_result = (
    supabase.table("user_roles")
    .select("user_id")
    .eq("tenant_id", hotel_id)
    .in_("role", ["engineer", "chief_engineer", "gm"])
    .eq("is_active", True)
    .execute()
)
```
Note: `user_roles` allows multiple role rows per `(user_id, tenant_id)` (e.g. a user with both `gm` and `engineer` roles would have two separate rows, both matching the `.in_("role", ...)` filter). This can produce **duplicate `user_id` values** in the result set — dedupe with `{r["user_id"] for r in recipients if r.get("user_id")}` before building the notification list, otherwise a dual-role user gets two notification rows for the same event. `notify_supervisors_high_risk`'s `user_profiles` query doesn't have this issue because `user_profiles` is one row per `(user, tenant)`.

### Pattern 3: Failure isolation via nested try/except (already the codebase norm)
**What:** Wrap risky I/O (DB call, external API) in try/except that logs and returns a safe default rather than propagating, so the caller's loop continues.
**When to use:** Any per-asset/per-hotel step inside a batch cron job.
**Already demonstrated 5 times in `failure_predictions.py` itself** (work order fetch, PM fetch, Claude call/fallback, `failure_predictions` upsert, `assets` update) — the new notify call should follow the exact same idiom: wrap the whole notify call (or use the notify function's own internal try/except, which already returns `0` on failure per Pattern 2) so a notification failure never raises out of the per-asset loop iteration.

### Anti-Patterns to Avoid
- **Writing a `notification_deliveries` row:** `routers/internal.py::_notify_role` uses a different pattern that also writes to `notification_deliveries`. CONTEXT.md explicitly says NOT to use that pattern — mirror `notify_supervisors_high_risk` (direct `notifications` insert only), not `_notify_role`.
- **Comparing `previous_score is None` only:** Because `assets.failure_risk_score` has `DEFAULT 0` at the DB level (see Common Pitfalls), a strict `is None` check will silently miss the "never analyzed" case for assets created via the normal insert path (which will have `0`, not `NULL`, unless explicitly overridden). Use `(asset.get("failure_risk_score") or 0) < 70`.
- **Fetching recipients before checking `previous_score < 70 <= new_score`:** Only fetch recipients / attempt insert when the trigger condition is true — avoids unnecessary queries on every asset, every run (matches `run_room_predictions`' `if risk_level == "HIGH" and previous_risk != "HIGH":` gate placement).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dedup/state-transition detection | A new "previous risk" tracking table or in-memory cache across cron runs | The existing `assets.failure_risk_score` column, read before this run's overwrite | CONTEXT.md explicitly forbids a new migration; the column already IS the previous-run's value until the loop body updates it |
| Notification batch insert | A generic notification-dispatch abstraction/service | Direct `supabase.table("notifications").insert([...]).execute()`, mirroring `notify_supervisors_high_risk` | Codebase has no notification service layer; every existing high-risk notifier does this inline, and A1 (services layer depth convention in CLAUDE.md) says keep logic in domain modules unless shared across 2+ domains |

**Key insight:** This is a "connect the dots" phase, not new-infrastructure phase — everything needed (table, column, role table, existing sibling function) already exists. The only genuinely new code is the trigger condition and the notify function body.

## Common Pitfalls

### Pitfall 1: `failure_risk_score` default is `0`, not `NULL`
**What goes wrong:** CONTEXT.md's decision text says "`None`/never-analyzed prior score counts as 'not HIGH'". If the plan implements this as a literal `is None` check, it still produces correct *behavior* (since `0 < 70` is also "not HIGH"), but it's fragile and slightly misleading — a reviewer might assume `None` is the only "unanalyzed" sentinel and miss that `0` is actually what's in the DB by default.
**Why it happens:** `supabase/migrations/008_assets_pm.sql` line 53: `failure_risk_score INT DEFAULT 0 CHECK (failure_risk_score BETWEEN 0 AND 100)`. Column is nullable (no `NOT NULL`) but defaults to `0` on insert unless explicitly set.
**How to avoid:** Use `previous_score = asset.get("failure_risk_score") or 0` (treats missing key, `None`, and `0` uniformly) when computing the trigger condition `previous_score < 70 <= new_score`.
**Warning signs:** A test that seeds an asset row with `failure_risk_score: None` will pass either way; a test that seeds with the field *omitted* (relying on Python dict `.get()` default) or explicitly `0` is the one that would catch a strict `is None` bug — include both cases.

### Pitfall 2: `user_roles` can return duplicate `user_id`s for multi-role users
**What goes wrong:** Unlike `user_profiles` (one row per user per tenant), `user_roles` has one row per `(user_id, tenant_id, role)` — `UNIQUE (user_id, tenant_id, role)` per migration `003_users_roles.sql`. A user who is both `gm` and `engineer` will match the `.in_("role", ["engineer","chief_engineer","gm"])` filter twice, producing two notification rows for the same person for the same event.
**Why it happens:** The role model supports multiple roles per user (explicitly documented: "A user may hold multiple roles (e.g. GM + Front Desk)").
**How to avoid:** Dedupe `user_id`s from the `user_roles` query result before building the notifications list, e.g. `recipient_ids = {r["user_id"] for r in recipients if r.get("user_id")}`.
**Warning signs:** A test with a user holding two matching roles seeded in `user_roles` receiving 2 notifications instead of 1 for a single asset crossing HIGH.

### Pitfall 3: `run_asset_failure_predictions`'s `assets` fetch uses `select("*", ...)` with a join — the raw dict still has flat `failure_risk_score`
**What goes wrong:** None expected — flagged for verification confidence only. The select is `select("*, asset_categories(name, code)")`; `*` still expands to all flat columns of `assets` including `failure_risk_score`, and the join is a *nested* key (`asset_categories`), not a flattening — so `asset.get("failure_risk_score")` on the fetched row is safe and correct.
**Why it happens:** N/A — documenting to confirm this is NOT a pitfall, since a wildcard-plus-join select could theoretically shadow columns in other ORMs; supabase-py/PostgREST does not do this.
**How to avoid:** N/A — just verified safe. No column name collision between `assets.failure_risk_score` and any joined `asset_categories` field.

### Pitfall 4: Recipient fetch happening inside the loop for a HIGH asset with zero matching users
**What goes wrong:** If `recipients` comes back empty (no active engineer/chief_engineer/gm at that hotel), the function must return `0` and NOT raise/insert an empty list — the notify function's own guard (`if not recipients: return 0`) handles this, matching `notify_supervisors_high_risk`'s `if not supervisors: return 0`.
**Why it happens:** Small/new hotels or hotels with only `housekeeper`/`front_desk` roles configured could legitimately have 0 matching recipients.
**How to avoid:** Keep the explicit empty-list early return before attempting the insert (Supabase's `.insert([])` behavior with an empty list should not be relied upon).
**Warning signs:** A test seeding a HIGH-crossing asset with zero matching `user_roles` rows should assert `notifications_sent == 0` and that no row was added to `notifications`.

## Code Examples

### Trigger condition placement (verified against actual `failure_predictions.py` line numbers)
```python
# Source: apps/api/services/ai/failure_predictions.py lines 347-419 (existing loop, annotated)
for asset in assets:
    asset_id = asset.get("id")
    if not asset_id:
        continue

    previous_score = asset.get("failure_risk_score") or 0   # NEW: capture before overwrite

    # ... existing work order / PM fetch (unchanged) ...
    # ... existing prediction = _analyze_asset(...) call (unchanged) ...

    risk_score = prediction.get("risk_score", 0)
    if risk_score >= 70:
        high_risk += 1

    # --- 4. Delete existing unacknowledged prediction, insert new one --- (unchanged, existing)
    # --- 5. Update assets.failure_risk_score --- (unchanged, existing)

    # NEW step 6: notify on new HIGH crossing
    if previous_score < 70 <= risk_score:
        try:
            sent = notify_engineers_asset_risk_high(
                hotel_id=hotel_id,
                asset_id=asset_id,
                asset_name=asset.get("name", "Unknown Asset"),
                risk_score=risk_score,
                predicted_failure_window=prediction.get("predicted_failure_window"),
                recommendation=prediction.get("recommendation"),
            )
            notifications_sent += sent
        except Exception as exc:
            logger.error(
                "Failed to send asset risk notification for asset=%s hotel=%s: %s",
                asset_id, hotel_id, exc,
            )

    updated += 1
```
Note: `notify_engineers_asset_risk_high` should itself have internal try/except (mirroring `notify_supervisors_high_risk`) and return `0` on failure rather than raise — the outer try/except above is defense-in-depth per CONTEXT.md's explicit "wrapped in its own try/except" requirement, and costs nothing.

### Return dict change
```python
# Source: apps/api/services/ai/failure_predictions.py line 316, 320-322, 429
# Before:
#   analyzed = 0; high_risk = 0; updated = 0
#   return {"analyzed": analyzed, "high_risk": high_risk, "updated": updated}
# After:
    analyzed = 0
    high_risk = 0
    updated = 0
    notifications_sent = 0   # NEW
    ...
    return {
        "analyzed": analyzed,
        "high_risk": high_risk,
        "updated": updated,
        "notifications_sent": notifications_sent,   # NEW
    }
```
`run_all_hotels_failure_predictions` (lines 436-471) already sums `analyzed`/`high_risk`/`updated` across hotels via `total["key"] += stats.get("key", 0)` — add `"notifications_sent": 0` to its `total` dict initializer and a corresponding `total["notifications_sent"] += stats.get("notifications_sent", 0)` line so the cron endpoint's aggregate response includes the total count too (not strictly required by CONTEXT.md, but keeps the aggregate consistent with the per-hotel shape — flagged as a planning judgment call, not a locked requirement).

### Test harness pattern to follow (verified working elsewhere in the repo)
```python
# Source: apps/api/tests/test_internal_escalations.py (pattern), apps/api/tests/smoke/fake_supabase.py (FakeDB)
from tests.smoke.fake_supabase import FakeDB
from services.ai import failure_predictions

def test_new_high_risk_asset_sends_one_notification(monkeypatch):
    db = FakeDB({
        "assets": [{"id": "asset-1", "tenant_id": "hotel-1", "is_active": True,
                     "name": "Boiler #1", "failure_risk_score": 20}],  # was LOW
        "work_orders": [],
        "pm_schedules": [],
        "user_roles": [{"user_id": "eng-1", "tenant_id": "hotel-1", "role": "engineer", "is_active": True}],
        "notifications": [],
        "failure_predictions": [],
    })
    monkeypatch.setattr(failure_predictions, "supabase", db)
    # monkeypatch _analyze_asset (or the Anthropic client) to force risk_score=85
    ...
    result = await failure_predictions.run_asset_failure_predictions("hotel-1")
    assert result["notifications_sent"] == 1
    assert len(db.rows["notifications"]) == 1
```
Because `_analyze_asset` calls Claude via `get_anthropic_client()`, tests will need to monkeypatch either `failure_predictions._analyze_asset` directly (simplest — returns a controlled `prediction` dict) or the Anthropic client, matching however the (currently nonexistent) test suite chooses to isolate the AI call — this codebase's existing AI-adjacent tests (`test_ai_provider_configuration.py`) only test client construction, not the full analyze flow, so there's no existing "mock Claude's response" precedent to follow verbatim; monkeypatching `_analyze_asset` itself is the simplest and most direct approach for this phase's dedup/notification logic (the AI call itself is out of scope — the phase description says "no extra AI/DB call needed").

## State of the Art

Not applicable — no external library or framework version concerns. This is entirely internal application logic using patterns already established in the same file/sibling file.

## Open Questions

1. **Should `run_all_hotels_failure_predictions`'s aggregate `total` dict also gain `notifications_sent`?**
   - What we know: CONTEXT.md only locks the change to `run_asset_failure_predictions`'s return dict.
   - What's unclear: Whether the planner should also propagate the sum up through `run_all_hotels_failure_predictions` (and therefore the `/v1/internal/ai/failure-predictions` cron endpoint's response body) for consistency.
   - Recommendation: Do it — it's a 2-line, zero-risk addition consistent with how `analyzed`/`high_risk`/`updated` are already summed, and gives the cron endpoint response a complete picture. Not testing it would leave a silent gap in the aggregate. Treat as in-scope "supporting" work, not scope creep, since it touches the same function CONTEXT.md already discusses (`run_all_hotels_failure_predictions` is one call away and explicitly shown in the file the phase already modifies).

2. **Exact title/body copy wording.**
   - What we know: CONTEXT.md leaves this to discretion; must reference the specific asset by name and include `predicted_failure_window` and/or `recommendation`.
   - What's unclear: Nothing blocking — this is pure copy, no technical risk.
   - Recommendation: `title = f"{asset_name} at high failure risk"`, `body = f"Predicted failure window: {predicted_failure_window}. {recommendation}"` (guard for `None` values with `or "Unknown"` / omit trailing sentence if `recommendation` is falsy) — matches `notify_supervisors_high_risk`'s concise, factual tone.

## Sources

### Primary (HIGH confidence — direct repo file reads)
- `apps/api/services/ai/failure_predictions.py` — full read, current `run_asset_failure_predictions` implementation, loop structure, return dict shape
- `apps/api/services/ai/predictions.py` — full read, `notify_supervisors_high_risk` (pattern to mirror exactly) and `run_room_predictions` (dedup-via-snapshot pattern to mirror)
- `supabase/migrations/003_users_roles.sql` — `user_roles` table exact columns: `id, user_id, tenant_id, role (CHECK constraint enum), department_id, is_active, created_at`; `UNIQUE (user_id, tenant_id, role)`
- `supabase/migrations/013_ai_systems.sql` — `notifications` table exact columns and constraints: `id, tenant_id (NOT NULL), user_id (NOT NULL), type (NOT NULL), title (NOT NULL), body (NOT NULL), data (JSONB DEFAULT '{}'), is_read (NOT NULL DEFAULT FALSE), push_sent (NOT NULL DEFAULT FALSE), push_sent_at, expo_push_ticket, created_at`
- `supabase/migrations/008_assets_pm.sql` line 53-54, 61 — `assets.failure_risk_score INT DEFAULT 0 CHECK (BETWEEN 0 AND 100)`, `failure_risk_updated_at TIMESTAMPTZ` (nullable, no default)
- `apps/api/routers/internal.py` lines 198-205 — cron endpoint `POST /ai/failure-predictions` wiring, confirms call path from cron to `run_all_hotels_failure_predictions`
- `apps/api/routers/assets.py` — confirms `failure_risk_score` used elsewhere (list/filter), no notification logic present there
- `apps/api/tests/smoke/fake_supabase.py` — full read, `FakeDB`/`FakeQuery` in-memory Supabase fake: supports `select/insert/update/upsert/delete`, `eq/neq/gte/lt/lte/is_/in_/like`, `order/limit/range/maybe_single`
- `apps/api/tests/test_internal_escalations.py`, `apps/api/tests/test_lost_found_retention.py`, `apps/api/tests/test_ai_copilot_rbac.py` — confirm the `monkeypatch.setattr(<module>, "supabase", db)` + `FakeDB` (imported from `tests.smoke.fake_supabase`) pattern is used repo-wide for both smoke and non-smoke tests, not just within `tests/smoke/`
- `apps/api/tests/test_ai_provider_configuration.py` — confirms this is the ONLY existing test file that touches `services.ai.failure_predictions` at all (module-import-safety test only, no logic coverage)
- `apps/api/core/database.py` — confirms `supabase` is a module-level `_LazySupabase()` singleton proxy imported via `from core.database import supabase`, safely monkeypatchable per-module
- `apps/api/pytest.ini` — confirms no custom markers registered beyond `filterwarnings`; plain `pytest tests/` invocation per CLAUDE.md is accurate
- `apps/api/requirements.txt` — `pytest==9.1.1`, `pytest-asyncio==1.4.0`
- Repo-wide grep for `asset_risk_high` and `failure_risk.*notif` / `notif.*failure_risk` — only hits are planning docs (ROADMAP.md, STATE.md, research SUMMARY/ARCHITECTURE.md, this phase's own CONTEXT.md) — confirms NO existing partial/duplicate implementation in application code

### Secondary (MEDIUM confidence)
None used — all findings verified directly against repo source.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all findings are direct file reads of the actual repo
- Architecture: HIGH — pattern to mirror (`notify_supervisors_high_risk`) is fully read and quoted verbatim; adaptation points (user_roles vs user_profiles, dedup dupes) verified against migration schema
- Pitfalls: HIGH — the `failure_risk_score DEFAULT 0` finding and the `user_roles` multi-role-duplicate finding are both confirmed via direct migration file reads, not speculation

**Research date:** 2026-08-12
**Valid until:** 30 days (stable internal codebase, no external dependency drift risk)
