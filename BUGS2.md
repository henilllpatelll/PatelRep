# PatelRep — Pre-Launch Bug Report (Round 2)
**Generated:** 2026-03-28
**Scope:** Frontend pages/components, AI layer, cron jobs, schema cross-checks, contract mismatches
**Note:** Issues already documented in BUGS.md are not repeated here. Fix BUGS.md first.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 5 |
| LOW | 2 |
| **Total** | **14** |

---

## CRITICAL — App-Breaking

### BUG-A01 · Housekeeping predictions panel always empty
**File:** `apps/web/app/(dashboard)/housekeeping/page.tsx:124`
**Confirmed:** Yes — verified backend response shape vs frontend access pattern.

**What the backend returns (`GET /v1/housekeeping/predictions`):**
```json
{"data": {"at_risk_count": 5, "rooms": [...]}}
```

**What the frontend does:**
```typescript
const res = await housekeepingApi.getPredictions()
// res = { data: { at_risk_count: 5, rooms: [...] } }
setPredictions(res.data?.data || [])
//             ^^^^^^^^^^^^^^^^^^ undefined — there is no `.data` inside the nested object
```

**Impact:** `res.data` is `{ at_risk_count, rooms }`. `res.data?.data` is `undefined`. The predictions panel is **always empty** — no risk alerts ever appear, even when rooms are flagged HIGH risk.

**Fix:**
```typescript
setPredictions(res.data?.rooms || [])
```

---

### BUG-A02 · AI credits deducted before AI call — failed requests still charged
**File:** `apps/api/routers/ai_copilot.py:108-109`
**Confirmed:** Yes — credits deducted at line 109, AI call happens inside `try` block starting at line 116.

**Current flow:**
```python
# Line 109 — credits deducted NOW
credits = await check_and_deduct_credits(current_user.hotel_id, interaction_type)

try:
    # Line 116+ — AI call happens AFTER credits are already gone
    result = parse_nl_tasks(...)
except Exception as exc:
    # Credits already deducted; no refund, user gets nothing
    raise HTTPException(status_code=500, detail=f"AI service error: {str(exc)}")
```

**Impact:**
- Any network error, OpenAI/Anthropic rate limit, or timeout causes the user to be charged credits with zero service delivered
- No refund path exists
- Fixed `CREDIT_COSTS` are charged regardless of actual token usage (violates CLAUDE.md A3: "log actual token usage from API responses — never fixed costs")

**Fix:** Move `check_and_deduct_credits()` to after the AI call succeeds, and pass real token counts:
```python
# Call AI first
result = parse_nl_tasks(...)
actual_tokens = result.usage.total_tokens

# Deduct based on real usage only after success
credits = await check_and_deduct_credits(current_user.hotel_id, interaction_type, actual_tokens)
```

---

## HIGH — Features Broken or Data Corrupt

### BUG-A03 · Internal cron jobs silently swallow all exceptions — zero observability
**File:** `apps/api/routers/internal.py`
**Locations:** Lines ~107-108, ~147-148, ~258-259

**Pattern throughout the file:**
```python
try:
    generate_shift_summary(shift["tenant_id"], shift["id"], today)
    generated += 1
except Exception:
    pass  # ← Silent failure; cron returns {"status": "ok"} regardless
```

**Impact:**
- Shift summaries, daily emails, and monthly billing true-ups can fail for every hotel and return `{"status": "ok"}` anyway
- No way to detect failures in Railway logs
- GMs may never receive their daily summary email; billing true-ups may silently skip hotels
- The monthly Stripe billing (`POST /internal/billing/monthly-trueup`) uses the same pattern — revenue is lost silently

**Fix:** Replace bare `except Exception: pass` with logging:
```python
except Exception as e:
    logger.error("Shift summary failed for tenant=%s shift=%s: %s",
                 shift["tenant_id"], shift["id"], e, exc_info=True)
    errors += 1
    continue
```
Add `errors` count to the response so Railway cron monitoring can detect partial failures.

---

### BUG-A04 · AI task confirmation doesn't validate room_id belongs to current hotel
**File:** `apps/api/routers/ai_copilot.py` (POST `/v1/ai/tasks/confirm`)

**Issue:** The endpoint creates tasks in bulk from AI-suggested data. It correctly stamps `tenant_id = current_user.hotel_id` on each task, but does **not verify that any supplied `room_id` belongs to this hotel**.

**Attack scenario:**
1. Attacker finds or guesses a `room_id` UUID from another hotel
2. POSTs to `/ai/tasks/confirm` with that foreign `room_id`
3. Task is created with attacker's `tenant_id` but linked to another hotel's room
4. Cross-tenant data corruption

**Fix:** Before inserting each task, verify room ownership:
```python
if task.get("room_id"):
    room_check = supabase.table("rooms").select("id")\
        .eq("id", task["room_id"])\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single().execute()
    if not room_check.data:
        raise HTTPException(status_code=400, detail=f"Room not found in your hotel")
```

---

### BUG-A05 · SOP upload — storage failure doesn't block DB record creation
**File:** `apps/api/routers/sop.py:61-72`

**Current flow:**
```python
# Storage upload — no error handling
supabase.storage.from_("sop-documents").upload(storage_path, content, {...})

# DB record created even if upload failed
insert_result = supabase.table("sop_documents").insert({
    "storage_path": storage_path,  # ← Points to file that may not exist
    "status": "pending",           # ← Indexing job will try to read a missing file
}).execute()
```

**Impact:** If Supabase Storage is unavailable or the upload fails, a `sop_documents` row is created pointing to a non-existent file. The background indexing job then crashes trying to download it, leaving the document permanently stuck in `"pending"` status. Users think the SOP uploaded but it's never searchable.

**Fix:**
```python
try:
    supabase.storage.from_("sop-documents").upload(storage_path, content, {...})
except Exception as e:
    logger.error("SOP storage upload failed: %s", e)
    raise HTTPException(status_code=500, detail="Failed to upload PDF. Please try again.")
# Only reach here if upload succeeded
insert_result = supabase.table("sop_documents").insert({...}).execute()
```

---

### BUG-A06 · Work-order comments sent in request body; tasks comments sent as query param — inconsistency causes one to break
**Files:**
- `apps/web/lib/api/engineering.ts:166` — sends `{ comment }` as **JSON body**
- `apps/web/lib/api/tasks.ts:91` — sends `comment` as **URL query param**

**Backend:**
- `work_orders.py` POST `/{wo_id}/comments`: `comment: str` (no `Query()` annotation — FastAPI reads it as a **query param**, not body)
- `tasks.py` POST `/{task_id}/comments`: `comment: str` (same — query param)

**Impact:** Engineering's work-order comment sends `comment` in the JSON body. FastAPI ignores the body for a plain `str` parameter and reads the query string instead. Since no query param is provided, the request is **rejected with 422 Unprocessable Entity**. Work order comments are completely broken.

**Fix (backend):** Add `Query(...)` explicitly so intent is clear and documented:
```python
async def add_comment(wo_id: str, comment: str = Query(...), ...):
```
**Fix (frontend):** Change engineering.ts line 166 to send as query param:
```typescript
apiClient.post(`/work-orders/${id}/comments`, undefined, { params: { comment } })
```

---

## MEDIUM — Reliability & Data Integrity

### BUG-A07 · JWT hook locks out users who have no active role row
**File:** `supabase/migrations/019_jwt_hook.sql:24-31`

**Issue:** The `custom_access_token_hook` SQL function queries `user_roles` to inject `hotel_id` and `role` into JWT claims. If no active role exists for the user (e.g., invitation not yet accepted, role deactivated), both claims remain `NULL`.

**Consequence:** Every RLS policy on every table checks `auth.jwt() ->> 'hotel_id'`. A `NULL` hotel_id causes **all table access to be denied** — the user is silently locked out of the entire app with no error message.

**Most likely to hit:** New users who complete magic-link signup before staff invitation is processed, or users whose role was deactivated.

**Fix:** Add a fallback or a clear error in the hook to surface this state rather than silently failing.

---

### BUG-A08 · Missing indexes on comment foreign keys — slow queries at scale
**Files:** `supabase/migrations/006_tasks.sql`, `007_work_orders.sql`, `015_indexes.sql`

**Missing indexes:**
```sql
-- task_comments: fetching comments for a task does a full table scan
-- No index on task_comments.task_id (only FK constraint, no index)

-- work_order_comments: same problem
-- No index on work_order_comments.work_order_id
```

**Impact:** For a hotel with 500 tasks and 50 comments per task, "fetch all comments for task X" scans 25,000 rows. This will be the first page to feel slow in a busy hotel.

**Fix:** Add to a new migration:
```sql
CREATE INDEX idx_task_comments_task_id ON task_comments (task_id, created_at DESC);
CREATE INDEX idx_work_order_comments_wo_id ON work_order_comments (work_order_id, created_at DESC);
```

---

### BUG-A09 · Migration 020 may not be applied to production — fractional billing broken
**Files:** `supabase/migrations/020_fix_credits_decimal.sql`

**Issue:** Migration 020 changes `credit_ledger.credits_used` from `INT` to `NUMERIC(10,4)` to support fractional AI credit costs (e.g. 0.5 credits for room predictions). Without this migration:
- All fractional credits are truncated to 0 (0.5 → 0, 0.25 → 0)
- Billing true-up reports $0 AI usage even when rooms are being predicted
- Revenue leak on every hotel that uses predictions

**Action required:** Verify in Supabase dashboard that `credit_ledger.credits_used` column type is `numeric` not `integer`. If it's still `integer`, run migration 020 immediately.

---

### BUG-A10 · Housekeeping board `lastSyncedAt` never updates — always shows "Never synced"
**File:** `apps/web/app/(dashboard)/housekeeping/page.tsx`

**Issue:** After predictions are fetched, `lastSyncedAt` state is never set. Users always see "Never synced" in the sync badge even after a successful fetch, leading to confusion and repeated manual refreshes.

**Fix:** After `fetchPredictions()` succeeds, update the timestamp:
```typescript
setPredictions(res.data?.rooms || [])
setLastSyncedAt(new Date())  // add this line
```

---

### BUG-A11 · Guest request auto-task creation failure is silent
**File:** `apps/api/routers/guest_requests.py:29-42`

**Issue:** When a guest request is created, a linked housekeeping task is auto-created. If the task insert fails (DB issue, constraint violation), the guest request still returns `200 OK` with no indication that the task wasn't created.

**Impact:** Staff receive a guest request but no task appears in their queue. The request goes unactioned.

**Fix:** Check the result and log or raise:
```python
task_result = supabase.table("tasks").insert({...}).execute()
if not task_result.data:
    logger.error("Auto-task creation failed for guest_request=%s", gr_id)
    # The guest request itself is saved, so don't fail the whole request,
    # but surface the issue for monitoring.
```

---

## LOW — Code Quality

### BUG-A12 · `console.error` statements left in production components
**Files:**
- `apps/web/app/(dashboard)/engineering/pm-schedules/page.tsx:589, 605`
- `apps/web/app/(dashboard)/housekeeping/page.tsx:110`
- `apps/web/app/(dashboard)/error.tsx:15`
- `apps/web/app/error.tsx:15`

**Issue:** Raw `console.error(...)` calls in user-facing components leak internal stack traces to anyone with DevTools open in a hotel lobby browser.

**Fix:** Wrap in a condition or remove. For error boundaries (`error.tsx`), reporting to a logging service (e.g., Sentry) is the right pattern.

---

### BUG-A13 · `expo_push_token` stored in `user_profiles` — not in `notifications` table, but push logic queries correctly
**Files:** `apps/api/routers/housekeeping.py:244-250`

**Issue:** The push notification logic correctly reads `expo_push_token` from `user_profiles`. However, if a housekeeper hasn't set their push token (new install, token expired), `asyncio.create_task(_send_assignment_push(...))` fires a background task that will silently do nothing. No fallback notification channel exists.

**Impact:** Low — push is best-effort. But token expiry is common in production and should at least be logged.

**Fix:** Log when no push token is found:
```python
if not token:
    logger.debug("No push token for housekeeper=%s, skipping push", engineer_id)
    return
```

---

## Priority Fix Order

1. **BUG-A01** — One-line fix, deploy now. Predictions panel is completely broken.
2. **BUG-A06** — Work order comments are broken (422 errors). One-line frontend fix.
3. **BUG-A02** — Credits/billing integrity. Fix before any real billing goes live.
4. **BUG-A03** — Add logging to all cron `except` blocks. Critical for ops visibility.
5. **BUG-A05** — SOP upload atomicity. One try/except wrapper.
6. **BUG-A04** — Room ID tenant validation in AI confirm.
7. **BUG-A09** — Verify migration 020 in production. Zero-cost fix if already applied.
8. **BUG-A07** — JWT hook null-role handling.
9. **BUG-A08** — Add comment indexes (new migration).
10. **BUG-A10, A11, A12, A13** — Low-effort cleanup, do in one pass.
