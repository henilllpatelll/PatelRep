---
name: patelrep-api
description: FastAPI backend patterns and conventions for PatelRep apps/api/
metadata:
  filePattern: "apps/api/**"
  priority: 10
---

# PatelRep API Layer

You are working on the **FastAPI Python 3.12** backend at `apps/api/`.

## Structure

```
apps/api/
├── main.py              Router registration, CORS, middleware setup
├── core/
│   ├── config.py        Pydantic settings (env vars via BaseSettings)
│   └── database.py      Supabase client singleton
├── middleware/
│   ├── auth.py          JWT decode → CurrentUser dataclass
│   └── credits.py       AI credit metering
├── models/
│   ├── requests.py      All Pydantic request bodies (CreateXRequest, UpdateXRequest)
│   └── responses.py     Response type hints (mostly dicts)
├── routers/             One file per domain
├── services/
│   ├── ai/              sop_rag.py, predictions.py, failure_predictions.py
│   └── opera/           auth.py, sync.py, webhooks.py
└── tests/smoke/         21 smoke tests against live endpoints
```

## Adding a New Endpoint

1. Add request model to `models/requests.py` if needed
2. Add route to the relevant router in `routers/`
3. Register router in `main.py` if it's new: `app.include_router(router, prefix="/v1/tag", tags=["Tag"])`

## Auth Pattern

```python
from middleware.auth import get_current_user, require_role
from models.requests import CurrentUser

# Any authenticated user:
async def my_endpoint(current_user: CurrentUser = Depends(get_current_user)):
    hotel_id = current_user.hotel_id
    user_id = current_user.user_id
    role = current_user.role

# Role-gated (one of the listed roles):
async def supervisor_only(current_user: CurrentUser = Depends(require_role("housekeeping_supervisor", "gm"))):
    ...
```

## Supabase Query Pattern

Always scope every query to `hotel_id`. Use synchronous supabase-py (no await).

```python
from core.database import supabase

# List
result = supabase.table("rooms").select("*").eq("hotel_id", user.hotel_id).execute()
rows = result.data  # list of dicts

# Single
result = supabase.table("rooms").select("*").eq("id", room_id).eq("hotel_id", user.hotel_id).single().execute()
row = result.data  # dict or None

# Insert
result = supabase.table("tasks").insert({"hotel_id": user.hotel_id, ...}).execute()

# Update
supabase.table("rooms").update({"status": "CLEAN"}).eq("id", room_id).execute()

# Delete
supabase.table("rooms").delete().eq("id", room_id).execute()
```

**pgvector RPC:**
```python
result = supabase.rpc("match_sop_chunks", {
    "query_embedding": embedding,
    "match_hotel_id": user.hotel_id,  # NOTE: match_hotel_id not hotel_id
    "match_threshold": 0.7,
    "match_count": 5,
}).execute()
```

## Response Convention

All endpoints return `{ "data": ... }`. FastAPI auto-generates `{ "detail": "..." }` for errors.

```python
return {"data": result.data}         # list
return {"data": result.data[0]}      # single object
raise HTTPException(status_code=404, detail="Room not found")
```

## Cron/Internal Endpoints

Protected by `X-Cron-Secret` header. Live in `routers/internal.py`.

```python
from fastapi import Header, HTTPException
import hmac

async def cron_endpoint(x_cron_secret: str = Header(None)):
    if not hmac.compare_digest(x_cron_secret or "", settings.cron_secret):
        raise HTTPException(status_code=401, detail="Invalid cron secret")
    # ...
```

## AI Services

- `services/ai/sop_rag.py` — `query_sop(hotel_id, question)` → RAG answer + suggested tasks
- `services/ai/predictions.py` — `run_room_predictions(hotel_id)` → ETA + risk per room
- `services/ai/failure_predictions.py` — `run_asset_failure_predictions(hotel_id)`

Use `asyncio.create_task()` for fire-and-forget background work inside async routes.

## Key Tables

`hotels`, `rooms`, `room_types`, `room_status`, `room_assignments`, `room_readiness_predictions`,
`staff_profiles`, `housekeeper_profiles`, `staff_invitations`,
`work_orders`, `work_order_notes`, `assets`, `asset_maintenance`,
`shifts`, `shift_assignments`, `time_entries`,
`sop_documents`, `sop_chunks`, `inspections`, `inspection_templates`,
`opera_credentials`, `opera_reservations`, `opera_webhook_events`,
`subscriptions`, `credit_ledger`, `ai_interactions`,
`logbook_entries`, `tasks`

## Roles

`housekeeper`, `engineer`, `housekeeping_supervisor`, `chief_engineer`, `front_desk`, `gm`
