# Phase 6: PMS and AI expansion - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 12 (5 new test files, 6 modified source files, 1 new migration)
**Analogs found:** 12 / 12

**Phase type note:** This is an audit/hardening phase, not greenfield. Every "new" file is a test file exercising already-shipped code; every "modified" file is a targeted, surgical fix (accounting formula, wrong HMAC secret, missing pilot-gate check) inside an existing function — not a rewrite. Analogs below are chosen to show both (a) the test-harness pattern to copy for new test files and (b) the in-file style to preserve when editing existing files.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/tests/test_ai_copilot_rbac.py` | test | request-response | `apps/api/tests/test_evidence_foundation.py` (RBAC dependency-extraction pattern) + `apps/api/tests/smoke/test_ai_assignment_confirm.py` (ai_copilot-specific FakeDB) | exact |
| `apps/api/tests/test_ai_copilot_credits.py` | test | event-driven (credit ledger mutation + audit log) | `apps/api/tests/smoke/test_ai_assignment_confirm.py` (FakeDB + monkeypatch on `ai_copilot.supabase`) | role-match |
| `apps/api/tests/smoke/test_opera_routes.py` | test | CRUD + request-response | `apps/api/tests/smoke/test_integrations_security.py` (EXISTS — extend, same file family) | exact |
| `apps/api/tests/smoke/test_opera_webhooks.py` | test | event-driven (webhook dispatch) | `apps/api/tests/smoke/test_webhooks_and_transitions.py` (existing webhook test pattern) + `apps/api/tests/smoke/test_integrations_security.py` (Opera-specific fixtures) | role-match |
| `apps/api/tests/test_opera_pilot_gate.py` | test | request-response (403/no-op gate) | `apps/api/tests/smoke/test_integrations_security.py` | role-match |
| `apps/api/middleware/credits.py` | middleware | event-driven (credit gate + ledger mutation) | itself (in-place fix — no better analog; see Pattern Assignments) | exact (self-edit) |
| `apps/api/services/ai/sop_rag.py` | service | request-response (RAG pipeline) | itself (in-place fix — remove internal `_log_ai_interaction` call) | exact (self-edit) |
| `apps/api/routers/ai_copilot.py` | controller (router) | request-response | itself (in-place fix — reorder `check_and_deduct_credits` calls); `apps/api/routers/integrations.py` for RBAC dependency style | exact (self-edit) |
| `apps/api/routers/webhooks.py` | controller (router) | event-driven (public webhook ingestion) | `_verify_twilio_signature` in the **same file** — correct HMAC pattern to copy for `_verify_opera_signature` | exact |
| `apps/api/services/opera/webhooks.py` | service | event-driven (webhook handler dispatch) | itself (in-place fix — add pilot-flag check before dispatch, or check upstream in `routers/webhooks.py`) | exact (self-edit) |
| `apps/api/routers/integrations.py` | controller (router) | request-response + CRUD | itself (in-place fix — add pilot-flag `require_role`-style guard to all 7 endpoints) | exact (self-edit) |
| New migration `supabase/migrations/0NN_opera_pilot_flag.sql` | migration | schema DDL | `supabase/migrations/084_guest_phone_adr_and_retention.sql` (recent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + rollback-comment style) | exact |

## Pattern Assignments

### `apps/api/tests/test_ai_copilot_rbac.py` (test, request-response)

**Analogs:** `apps/api/tests/test_evidence_foundation.py` (RBAC dependency extraction) + `apps/api/tests/smoke/test_ai_assignment_confirm.py` (ai_copilot FakeDB + CurrentUser fixture)

**Imports pattern** (from `test_ai_assignment_confirm.py` lines 1-7):
```python
from types import SimpleNamespace
import pytest
from middleware.auth import CurrentUser
from models.requests import AssignmentPreview
from routers import ai_copilot
```

**RBAC dependency-extraction pattern** (from `test_evidence_foundation.py` lines 70-78 — pull `require_role`'s check callable directly off the route object, do NOT use `TestClient`):
```python
route = next(route for route in evidence_router.router.routes if route.path == "/evidence/applicability" and "PUT" in route.methods)
role_check = route.dependant.dependencies[0].call
with pytest.raises(HTTPException, match="not authorized"):
    await role_check(CurrentUser(user_id="staff-1", hotel_id="hotel-1", role="housekeeper"))
```
Apply this same extraction to `ai_copilot.router.routes` for `/ai/insights`, `/ai/recommendations`, `/ai/recommendations/metrics` (all three use `require_role("gm", "chief_engineer", "housekeeping_supervisor")` per `apps/api/routers/ai_copilot.py` lines 688-711) — assert `housekeeper`/`engineer`/`front_desk` raise, `gm`/`chief_engineer`/`housekeeping_supervisor` pass.

**Endpoints WITHOUT require_role — verify these accept any authenticated role (not a bug, per RESEARCH.md Pitfall 6):** `/ai/copilot/chat`, `/ai/tasks/confirm`, `/ai/work-orders/confirm`, `/ai/guest-requests/confirm`, `/ai/risk-alerts`, `/ai/insights` (GET, uses only `get_current_user` — verify this is intentional, flagged as unresolved in RESEARCH.md Security Domain table). `/ai/assignments/confirm` DOES use `require_role("housekeeping_supervisor", "engineer", "gm")` (source: `ai_copilot.py` — confirm via grep at that route, matches `test_ai_assignment_confirm.py`'s existing `SUPERVISOR` fixture role).

**Direct-invocation pattern for open (non-role-gated) endpoints** (from `test_ai_assignment_confirm.py` lines 99-124):
```python
db = FakeDB({...})
monkeypatch.setattr(ai_copilot, "supabase", db)
response = await ai_copilot.confirm_assignments([AssignmentPreview(...)], current_user=SUPERVISOR)
assert response == {"data": {...}}
```

**Tenant-isolation pattern:** construct `FakeDB` rows scoped to `hotel-a`, invoke handler with `CurrentUser(hotel_id="hotel-b", ...)`, assert empty/404 result and zero writes to `db.upserts`/`db.rows` for the wrong tenant — mirrors `test_evidence_foundation.py` line 82 (`db.rows["property_applicability"]` assertion showing the other tenant's row is untouched).

---

### `apps/api/tests/test_ai_copilot_credits.py` (test, event-driven / credit-ledger + audit-log)

**Analog:** `apps/api/tests/smoke/test_ai_assignment_confirm.py` (FakeDB pattern) — this is a NEW kind of assertion (credit math + double-log), so also read the **target functions being fixed** directly for what to assert against.

**What to assert (per RESEARCH.md Pitfall 1 fix target)** — `apps/api/middleware/credits.py` lines 6-24:
```python
CREDIT_COSTS = {
    "task_creation": 1.0, "room_prediction": 0.5, "sop_query": 2.0,
    "failure_prediction": 0.25, "shift_summary": 3.0, "gm_insight": 2.0,
    "assignment_suggestion": 0.5, "onboarding_assistant": 1.0,
}

async def check_and_deduct_credits(hotel_id: str, interaction_type: str) -> float:
    credits = CREDIT_COSTS.get(interaction_type, 1.0)   # <-- FLAT LOOKUP, the bug
    ...
```
Post-fix, `check_and_deduct_credits` must accept `prompt_tokens`/`completion_tokens` (or be called after they're known) and compute `credits` from real usage. Test should assert: same `interaction_type` with different token counts → different `credits_charged` written to `ai_interactions` (see `log_ai_interaction`, `credits.py` lines 93-116, which already accepts real `prompt_tokens`/`completion_tokens`/`credits_charged` as separate params — mock provider responses to vary `response.usage.prompt_tokens` the way `work_order_parser.py` already structures its return: `{"work_orders": raw, "prompt_tokens": response.usage.prompt_tokens, "completion_tokens": response.usage.completion_tokens}`).

**Double-log regression test target (Pitfall 2)** — count `ai_interactions` rows written by a single `sop_query` request. Currently TWO writers exist for the same request:
1. `apps/api/services/ai/sop_rag.py::query_sop()` → internal `_log_ai_interaction()` (lines 208-343, hardcoded `credits_charged=2.0` at line 340)
2. `apps/api/routers/ai_copilot.py::copilot_chat()`'s unconditional final `log_ai_interaction()` call (lines 420-430)

Test pattern: monkeypatch `ai_copilot.supabase` to a `FakeDB` that records every `.insert()` call to `ai_interactions`; invoke `copilot_chat` with a message that routes to `sop_query`; assert `len(db_inserts_to("ai_interactions")) == 1` (currently fails with 2 — this is the RED state the fix must turn GREEN by removing `sop_rag.py`'s internal log call, per RESEARCH.md's "router should be the sole owner" recommendation).

---

### `apps/api/tests/smoke/test_opera_routes.py` (test, CRUD + request-response)

**Analog:** `apps/api/tests/smoke/test_integrations_security.py` (EXISTS — same directory, same domain; extend rather than duplicate its `FakeOperaDB`/`FakeQuery` fixtures)

**Existing fixture pattern to reuse** (`test_integrations_security.py` lines 1-49):
```python
from types import SimpleNamespace
import httpx
import pytest
from middleware.auth import CurrentUser
from models.requests import OperaConnectRequest
from routers import integrations as integrations_router
from services.opera.crypto import ENVELOPE_PREFIX

USER = CurrentUser(user_id="user-a-1", hotel_id="hotel-a", role="gm", email="gm@example.com")

class FakeOperaDB:
    def __init__(self):
        self.rows = {"opera_credentials": []}
        self.upserts = []
    def table(self, name):
        return FakeQuery(self, name)

class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db; self.table_name = table_name; self.payload = {}
    def upsert(self, payload, **_kwargs):
        self.payload = payload
        return self
    def execute(self):
        row = {"id": f"{self.table_name}-{len(self.db.rows[self.table_name]) + 1}", **self.payload}
        self.db.rows[self.table_name].append(row)
        self.db.upserts.append((self.table_name, row))
        return SimpleNamespace(data=[row])
```
NOTE: this fixture is `upsert`-only; the richer `apps/api/tests/smoke/fake_supabase.py::FakeDB` (`select`/`update`/`delete`/`maybe_single`/`in_`/`eq`/`neq`/`gte`) is needed for the remaining 6 endpoints (`opera_status`, `opera_sync`, `list_opera_sync_conflicts`, `resolve_opera_sync_conflict`, `opera_test`, `opera_disconnect`) — import that instead: `from tests.smoke.fake_supabase import FakeDB` (exact import used by `test_evidence_foundation.py` line 61/89/115).

**RBAC map to test** (source: `apps/api/routers/integrations.py`, verified this session):
- `POST /opera/connect` → `require_role("gm")` (line 20)
- `GET /opera/status` → `get_current_user` only, any role (line 68)
- `POST /opera/sync` → `require_role("gm")` (line 94)
- `GET /opera/conflicts` → `require_role("gm", "chief_engineer")` (line 110)
- `POST /opera/conflicts/{id}/resolve` → `require_role("gm", "chief_engineer")` (line 128)
- `POST /opera/test` → `require_role("gm")` (line 171)
- `DELETE /opera/disconnect` → `require_role("gm")` (line 187)

**Tenant-isolation pattern for `opera_status`/`resolve_opera_sync_conflict`** — every read/write is `.eq("tenant_id", current_user.hotel_id)` (integrations.py lines 73, 115, 133, 151, 158) — construct rows for `hotel-b`, call with `hotel-a` user, assert 404/empty and zero cross-tenant writes to `db.updates`/`db.upserts` (fake_supabase.py `FakeDB` tracks these lists at lines 37-39).

**bug-449-class None-guard already correct here — copy this exact idiom for any new read:**
```python
# Source: apps/api/routers/integrations.py::opera_status, lines 77-78 (verified correct)
if not result or not result.data or not result.data.get("is_connected"):
    return {"data": {"connected": False}}
```

---

### `apps/api/tests/smoke/test_opera_webhooks.py` (test, event-driven)

**Analog:** No direct existing webhook-dispatch test file for Opera; closest structural pattern is `apps/api/tests/smoke/test_integrations_security.py`'s FakeDB style, applied to `apps/api/routers/webhooks.py::opera_webhook` and the five handlers in `apps/api/services/opera/webhooks.py`.

**What to test post-fix (Pitfall 3 — signature secret source):**
```python
# Source: apps/api/routers/webhooks.py, lines 40-50 (current, WRONG secret)
def _verify_opera_signature(payload: bytes, signature_header: str, hotel_id: str) -> bool:
    secret = f"{settings.cron_secret}:{hotel_id}".encode()   # BUG: Oracle never knows CRON_SECRET
    expected = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature_header)
```
```python
# Correct HMAC pattern to mirror (SAME FILE, Twilio check, lines 29-37 — this one is right)
def _verify_twilio_signature(request: Request, params: dict) -> bool:
    signature = request.headers.get("x-twilio-signature", "")
    if not signature or not settings.twilio_auth_token:
        return False
    ...
    return RequestValidator(settings.twilio_auth_token).validate(url, params, signature)
```
Fix: `_verify_opera_signature` must read the per-hotel `opera_credentials.webhook_secret` column (schema: `supabase/migrations/002_tenants.sql` line 80, `COMMENT ON COLUMN opera_credentials.webhook_secret IS 'Shared HMAC-SHA256 secret for validating inbound Opera webhook payloads.'`) instead of deriving from `CRON_SECRET`. Test: assert a signature computed with `opera_credentials.webhook_secret` passes; a signature computed with `CRON_SECRET` (the old, wrong key) fails.

**Handler dispatch test pattern** (source: `apps/api/routers/webhooks.py` lines 90-107):
```python
handlers = {
    "RESERVATION.CHECKED_OUT": handle_checkout,
    "RESERVATION.CHECKED_IN": handle_checkin,
    "RESERVATION.MODIFIED": handle_reservation_modified,
    "ROOM_STATUS.DO_NOT_DISTURB": handle_dnd,
    "ROOM_STATUS.MAKE_UP_ROOM": handle_make_up_room,
}
handler = handlers.get(event_type)
if handler:
    try:
        handler(hotel_id, event_payload)
    except Exception as e:
        logger.error(...)   # never crashes — always returns 200
```
Test each handler in `apps/api/services/opera/webhooks.py` directly (monkeypatch `services.opera.webhooks.supabase`) — e.g. `handle_checkout(hotel_id, {"roomNumber": "101"})` then assert `room_status` row updated to `DIRTY` and a `room_status_history` row inserted with `change_source="opera_webhook"` (lines 24-41). Also test the tenant-resolution step in `opera_webhook()` itself: unknown `opera_hotel_id` → `{"status": "ignored", "reason": "hotel not found or not connected"}` (lines 80-81), no exception, no handler invoked.

**Unknown event type → no-op test:** `event_type` not in `handlers` dict → falls through with no handler call, still returns `{"status": "ok", "event_type": event_type}` (line 107) — assert no DB writes occur.

---

### `apps/api/tests/test_opera_pilot_gate.py` (test, request-response — new D-03 mechanism)

**Analog:** `apps/api/tests/smoke/test_integrations_security.py` fixtures, extended with a `tenants.opera_pilot_enabled` row.

**Migration to test against** (new file, mirrors style of `supabase/migrations/084_guest_phone_adr_and_retention.sql` lines 1-7):
```sql
-- Follows the exact style of supabase/migrations/002_tenants.sql's tenants.is_active
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS opera_pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.tenants.opera_pilot_enabled IS
  'Gates Opera Cloud/OHIP connect, sync, and webhook processing to explicitly enrolled pilot hotels (Phase 6 D-03).';

-- ROLLBACK:
-- ALTER TABLE public.tenants DROP COLUMN opera_pilot_enabled;
```

**What to assert:** each of the 7 `/integrations/opera/*` handlers in `apps/api/routers/integrations.py` must check `tenants.opera_pilot_enabled` for `current_user.hotel_id` before proceeding, raising `403` if `False`. The webhook path (`apps/api/routers/webhooks.py::opera_webhook`) cannot 403 (Oracle isn't redirectable) — it must silently no-op, mirroring the EXISTING "hotel not found or not connected" pattern at lines 80-81:
```python
if not creds or not creds.data:
    return {"status": "ignored", "reason": "hotel not found or not connected"}
```
Add an equivalent `if not tenant_pilot_enabled: return {"status": "ignored", "reason": "opera_pilot_not_enabled"}` check, same silent-ignore shape.

**Do NOT add pilot-gating to `ai_copilot.py`.** D-04 explicitly excludes AI copilot from any new flag — this test file is Opera-only.

---

## Shared Patterns

### Test harness: direct async handler invocation (NOT TestClient)
**Source:** `apps/api/tests/test_evidence_foundation.py`, `apps/api/tests/smoke/test_ai_assignment_confirm.py`, `apps/api/tests/smoke/test_integrations_security.py` — all five existing analogs use this exact pattern, zero exceptions found in this domain.
**Apply to:** All 5 new test files in this phase.
```python
# Monkeypatch the module's `supabase` reference, then await the handler directly
monkeypatch.setattr(ai_copilot, "supabase", db)      # or integrations_router, or the services.opera.webhooks module
response = await ai_copilot.some_handler(SomeRequestModel(...), current_user=CurrentUser(...))
```
For RBAC checks specifically, pull `require_role`'s callable off the route object rather than calling the endpoint and catching the exception from a full dependency chain:
```python
route = next(r for r in some_router.router.routes if r.path == "/x/y" and "POST" in r.methods)
role_check = route.dependant.dependencies[0].call
with pytest.raises(HTTPException, match="not authorized"):
    await role_check(CurrentUser(role="wrong_role", ...))
```

### FakeDB double: two variants exist, pick per need
**Source:** `apps/api/tests/smoke/fake_supabase.py` (rich: insert/update/delete/upsert/maybe_single/neq/gte/in_/order/range/storage) vs. the lighter inline `FakeDB`/`FakeQuery` in `test_ai_assignment_confirm.py` and `test_integrations_security.py` (select/update/upsert/eq/in_/ilike only).
**Apply to:** Use `fake_supabase.FakeDB` (import: `from tests.smoke.fake_supabase import FakeDB`) whenever a test needs `.maybe_single()` returning a bare `None` (bug-449 class guard verification per RESEARCH.md Pitfall 4) or `.delete()`/`.insert()` tracking — this is required for `test_opera_routes.py`, `test_opera_webhooks.py`, and `test_opera_pilot_gate.py`. Use the lighter inline fixture only if extending `test_ai_assignment_confirm.py` or `test_integrations_security.py` in place (to match their existing local convention).

### bug-449-class `.maybe_single()` None-guard
**Source:** `apps/api/routers/integrations.py::opera_status`, lines 77-78 (verified correct in this session)
```python
result = supabase.table("opera_credentials").select(...).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
if not result or not result.data or not result.data.get("is_connected"):
    return {"data": {"connected": False}}
```
**Apply to:** Any `.maybe_single()` call touched or added during this phase's fixes (webhook secret lookup, pilot-flag lookup) — never `if result.data:` alone, since `supabase-py`'s `.maybe_single().execute()` returns a bare `None` (not `SimpleNamespace(data=None)`) on zero rows.

### Correct HMAC verification pattern (copy structure, not the broken secret)
**Source:** `apps/api/routers/webhooks.py::_verify_twilio_signature`, lines 29-37
```python
def _verify_twilio_signature(request: Request, params: dict) -> bool:
    signature = request.headers.get("x-twilio-signature", "")
    if not signature or not settings.twilio_auth_token:
        return False
    proto = request.headers.get("x-forwarded-proto", "https")
    host = request.headers.get("host", "")
    url = f"{proto}://{host}{request.url.path}"
    return RequestValidator(settings.twilio_auth_token).validate(url, params, signature)
```
**Apply to:** Fixing `_verify_opera_signature` in the same file — swap the secret source from `settings.cron_secret + hotel_id` to the per-hotel `opera_credentials.webhook_secret` column (already provisioned in schema, migration 002, currently dead/unused).

### Migration style: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + inline rollback comment
**Source:** `supabase/migrations/084_guest_phone_adr_and_retention.sql`, lines 1-7, 41-51
```sql
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS opera_pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.tenants.opera_pilot_enabled IS '...';

-- ROLLBACK:
-- ALTER TABLE public.tenants DROP COLUMN opera_pilot_enabled;
```
**Apply to:** The single new migration this phase needs (D-03 pilot flag). No new table required — matches the existing `tenants.is_active` / `opera_credentials.is_connected` boolean-flag idiom (see RESEARCH.md Architecture Patterns, Pattern 3).

### Tenant scoping convention (verify, don't reinvent)
**Source:** every read/write across `ai_copilot.py`, `integrations.py`, `services/opera/*` already uses `.eq("tenant_id", hotel_id)` or `.eq("hotel_id", hotel_id)` per-query (spot-checked in RESEARCH.md; no missing filter found this session).
**Apply to:** Every new test's tenant-isolation assertion should confirm this filter is present by constructing 2-tenant `FakeDB` fixtures and asserting cross-tenant rows are untouched — not by re-auditing the filter code itself (already verified clean).

## No Analog Found

None. All 12 files in scope have a concrete, directly-applicable in-repo analog — this is expected for an audit/hardening phase operating entirely within one small, coherent existing domain (`ai_copilot.py`, `integrations.py`, `services/opera/*`, `services/ai/*`, their existing test siblings).

## Metadata

**Analog search scope:** `apps/api/tests/`, `apps/api/tests/smoke/`, `apps/api/routers/ai_copilot.py`, `apps/api/routers/integrations.py`, `apps/api/routers/webhooks.py`, `apps/api/middleware/credits.py`, `apps/api/services/ai/sop_rag.py`, `apps/api/services/opera/webhooks.py`, `supabase/migrations/002_tenants.sql`, `supabase/migrations/084_guest_phone_adr_and_retention.sql`
**Files scanned:** 16 (5 test files read in full/targeted, 6 source files read in full/targeted, 2 migrations read in full, plus CONTEXT.md/RESEARCH.md)
**Pattern extraction date:** 2026-07-28
