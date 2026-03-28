# PatelRep — Pre-Launch Bug Report
**Generated:** 2026-03-28
**Audit scope:** Production API, all backend routers, web frontend, auth flow, multi-tenancy
**Production API:** https://api-production-18a4.up.railway.app
**Production Web:** https://patelrepweb-production.up.railway.app

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| HIGH | 4 |
| MEDIUM | 3 |
| **Total** | **11** |

---

## CRITICAL — App-Breaking

### BUG-001 · Production database connectivity failing
**Status:** Active in production right now
**Symptom:** `/health` returns `{"status":"degraded"}` with DB error:
```
code: PGRST205, hint: "Perhaps you meant the table 'public.rooms'"
message: (truncated)
```
**Root cause:** The health check pings `supabase.table("tenants")` but PostgREST cannot resolve the table — either the `tenants` table was not granted SELECT to the `anon`/`authenticated` roles by migrations, the service role key in Railway is wrong/expired, or PostgREST's schema cache needs a reload.
**Impact:** Every API endpoint that touches the DB is potentially broken in production. This is the most urgent issue.
**File:** `apps/api/main.py:82`
**Fix options:**
1. Verify `SUPABASE_SERVICE_ROLE_KEY` env var in Railway API service is correct and not expired
2. Verify all 20 migrations have been run against the production Supabase project
3. Check Supabase dashboard → Table Editor to confirm `tenants` table exists
4. If table exists, reload PostgREST schema cache via Supabase dashboard → Database → Extensions → PostgREST → Reload

---

### BUG-002 · `billing.py` — NameError crash on missing subscription
**Status:** Will crash at runtime whenever any GM has no subscription row
**File:** `apps/api/routers/billing.py:21`
**Code:**
```python
# Line 2 — module-level import is MISSING HTTPException:
from fastapi import APIRouter, Depends   # ← no HTTPException here

# Line 21 — will throw NameError: name 'HTTPException' is not defined
if not result.data:
    raise HTTPException(status_code=404, detail="Subscription not found")
```
**Impact:** `GET /v1/billing/subscription` crashes with a 500 Internal Server Error instead of a clean 404. Any GM visiting the Billing page sees a broken page.
**Fix:** Add `HTTPException` to the module-level import on line 2:
```python
from fastapi import APIRouter, Depends, HTTPException
```

---

### BUG-003 · `housekeeping.py` — room_status update missing tenant scope
**Status:** Multi-tenancy security violation
**File:** `apps/api/routers/housekeeping.py:238-241`
**Code:**
```python
supabase.table("room_status")\
    .update({"assigned_to": str(a.housekeeper_id)})\
    .eq("room_id", str(a.room_id))\
    .execute()   # ← missing .eq("tenant_id", current_user.hotel_id)
```
**Impact:** A crafted request with a `room_id` from another hotel will update that other hotel's `room_status` row. This is a cross-tenant data write vulnerability.
**Fix:** Add `.eq("tenant_id", current_user.hotel_id)` before `.execute()`:
```python
supabase.table("room_status")\
    .update({"assigned_to": str(a.housekeeper_id)})\
    .eq("room_id", str(a.room_id))\
    .eq("tenant_id", current_user.hotel_id)\
    .execute()
```

---

### BUG-004 · `housekeeping.py` — rooms notification query missing tenant scope
**Status:** Multi-tenancy data leak
**File:** `apps/api/routers/housekeeping.py:245-248`
**Code:**
```python
room_info = supabase.table("rooms") \
    .select("room_number") \
    .eq("id", str(a.room_id)) \
    .maybe_single().execute()  # ← missing .eq("tenant_id", current_user.hotel_id)
```
**Impact:** Push notification for a housekeeper could leak room numbers from other hotels if UUIDs are guessed/forged.
**Fix:** Add `.eq("tenant_id", current_user.hotel_id)`:
```python
room_info = supabase.table("rooms") \
    .select("room_number") \
    .eq("id", str(a.room_id)) \
    .eq("tenant_id", current_user.hotel_id) \
    .maybe_single().execute()
```

---

## HIGH — Broken Features

### BUG-005 · `onboarding.py` — room import returns non-standard response
**File:** `apps/api/routers/onboarding.py:110`
**Code:**
```python
return {"imported_count": imported_count, "skipped_count": skipped_count, "errors": errors}
```
**Impact:** Every other endpoint returns `{"data": {...}}`. The onboarding frontend reads `.data.imported_count` — if the web client follows the same pattern here it will get `undefined`. Room import results will be silently lost.
**Fix:**
```python
return {"data": {"imported_count": imported_count, "skipped_count": skipped_count, "errors": errors}}
```

---

### BUG-006 · Multiple routers — `HTTPException` used via in-function local imports (fragile pattern)
**Files:**
- `apps/api/routers/work_orders.py:81, 159`
- `apps/api/routers/tasks.py:95`
- `apps/api/routers/logbook.py:85`
- `apps/api/routers/lost_found.py:79`
- `apps/api/routers/assets.py:147, 243, 290, 371, 412`

**Pattern:**
```python
# No module-level import of HTTPException
# Inside a function body:
    from fastapi import HTTPException      # local import
    raise HTTPException(status_code=404)   # raise immediately after
```
**Impact:** Works today because the local import always precedes the raise. But any future refactor that moves the raise out of that code path, or any linter/tree-shaker that removes "unused" imports, will cause silent NameError crashes. These are 9 potential runtime bombs.
**Fix:** Add `HTTPException` to each file's module-level `from fastapi import ...` line and remove all local imports.

---

### BUG-007 · `work_orders.py` — comment endpoint doesn't verify work order ownership
**File:** `apps/api/routers/work_orders.py` (POST `/{wo_id}/comments`)
**Impact:** A user could post a comment on a work order belonging to another hotel by guessing a UUID. The comment will be inserted with their `tenant_id` but against a foreign `work_order_id`, corrupting data.
**Fix:** Before inserting the comment, verify the work order belongs to the current hotel:
```python
wo_check = supabase.table("work_orders").select("id")\
    .eq("id", wo_id).eq("tenant_id", current_user.hotel_id)\
    .maybe_single().execute()
if not wo_check.data:
    raise HTTPException(status_code=404, detail="Work order not found")
```

---

### BUG-008 · `auth.py /auth/me` — `full_name` field not returned in user profile
**File:** `apps/api/routers/auth.py:11-16`
**Code:**
```python
profile = supabase.table("user_profiles")\
    .select("id, full_name, preferred_name, phone, avatar_url, language_pref, is_active")\
```
**Impact:** `full_name` IS selected, but the `user_profiles` select query uses `.eq("tenant_id", current_user.hotel_id)`. The `user_profiles` table uses `tenant_id` for scoping — verify that column exists. If the column name is actually `hotel_id`, this query returns no rows and every user's profile appears empty in the frontend sidebar.
**Fix:** Verify migration 003 column name for `user_profiles` tenant FK — ensure it matches `tenant_id` used in the query.

---

## MEDIUM — Quality / Reliability

### BUG-009 · `health` endpoint — DB ping queries tenant-isolated table
**File:** `apps/api/main.py:82`
**Issue:** The health check pings `supabase.table("tenants")` which is RLS-protected. Even with service role this can fail if the PostgREST layer has config issues. A better health check pings a non-RLS system table.
**Fix:** Replace with a raw SQL ping:
```python
supabase.rpc("pg_catalog.pg_sleep", {"seconds": 0}).execute()
# or simpler:
supabase.table("rooms").select("id").limit(1).execute()
# rooms is confirmed accessible per the error hint
```

---

### BUG-010 · `billing.py` — Stripe checkout price is hardcoded
**File:** `apps/api/routers/billing.py:100-108`
**Code:** `"unit_amount": 9900` — hardcoded $99/month
**Impact:** Changing pricing requires a code deploy. Also the price is not tied to the room count, but CLAUDE.md states billing is `$99/mo + $0.02/AI credit, cap $2.50/room/month`. The base fee should be configurable.
**Fix:** Move to `settings.base_plan_price_cents` in `core/config.py`.

---

### BUG-011 · `middleware/credits.py` — silent JWKS fetch failure
**File:** `apps/api/middleware/credits.py`
**Code:**
```python
except Exception:
    pass  # silent failure
```
**Impact:** If the Supabase JWKS endpoint is unreachable, token verification silently fails with no log. The next request attempt may work or may not, with no observability.
**Fix:** Add a warning log:
```python
except Exception as e:
    logger.warning("JWKS fetch failed, tokens may not verify: %s", e)
```

---

## How to Prioritize Fixes

1. **BUG-001** — Diagnose production DB connection. Nothing else works until this is resolved.
2. **BUG-002** — Fix `billing.py` import. One-line fix, deploy immediately.
3. **BUG-003 + BUG-004** — Fix tenant scoping in housekeeping. Security issue.
4. **BUG-006** — Clean up all local `HTTPException` imports in one pass.
5. **BUG-005** — Fix onboarding response format.
6. **BUG-007** — Add work order ownership check before comments.
7. **BUG-008** — Verify `user_profiles.tenant_id` column exists in migration 003.
8. **BUG-009, 010, 011** — Non-blocking, fix in next cycle.
