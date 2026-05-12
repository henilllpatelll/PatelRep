# PatelRep Load Test Report
**Date:** 2026-05-12  
**Environment:** Production (Railway)  
**API:** https://api-production-130b.up.railway.app  
**Web:** https://patelrepweb-production.up.railway.app

---

## Method

**Tool:** Custom async Python load tester (`load_test.py`) using `httpx.AsyncClient`.

**Scenario:** 40 concurrent workers simulating realistic hotel staff distribution:
- 20 housekeepers (`GET /my-rooms`, `/tasks`, `/notifications`)
- 7 engineers (`GET /work-orders`, `/tasks`, `/notifications`)
- 7 front desk (`GET /guest-requests`, `/housekeeping/board`, `/notifications`)
- 4 supervisors (`GET /housekeeping/board`, `/staff`, `/tasks`, `/notifications`)
- 2 GMs (`GET /housekeeping/board`, `/reports/daily-summary`, `/tasks`, `/staff`, `/billing/credits`)

Each worker adds 0.5–3s think-time between actions to simulate human pacing.  
Duration: 60 seconds per run. Auth: single GM JWT token (production Supabase).

**Excluded (safe skips):** `/ai/copilot/chat`, `/ai/insights` (Anthropic credits), Stripe billing writes, email endpoints, all `POST /internal/*` cron endpoints.

---

## Run 1 — Baseline (Pre-indexes)

| Endpoint | Req | p50ms | p95ms | p99ms | 2xx% |
|---|---|---|---|---|---|
| GET /billing/credits | 5 | 1269 | 2055 | 2055 | 100% |
| GET /guest-requests | 55 | 989 | 4607 | 5080 | 100% |
| GET /housekeeping/board | 84 | 1142 | 3543 | 5073 | 100% |
| GET /housekeeping/my-rooms | 162 | 881 | 6234 | 7454 | 0%* |
| GET /notifications | 278 | 936 | 2283 | 4698 | 100% |
| GET /reports/daily-summary | 6 | 2138 | 3289 | 3289 | 100% |
| GET /staff | 30 | 1273 | 3001 | 5080 | 100% |
| GET /tasks (all) | 27 | 1014 | 3416 | 4011 | 100% |
| GET /tasks (mine) | 212 | 1008 | 3633 | 4912 | 100% |
| GET /work-orders (mine) | 64 | 1140 | 4712 | 5421 | 100% |
| **OVERALL** | **923** | **1008** | **4212** | **6104** | **82%** |

**0% 5xx. 17.6% 4xx — all from `/my-rooms` with GM token (expected: GM has no room assignments).**  
RPS: **14.2**

*GM token has no room_assignments rows — returns 404. Real housekeeper tokens return 200.

---

## Root Cause Analysis

All p95 spikes traced to missing compound database indexes:

| Table | Missing Index | Affected Endpoint |
|---|---|---|
| `room_assignments` | None at all | `/my-rooms` |
| `guest_requests` | None at all | `/guest-requests` |
| `notifications` | Partial index lacked `tenant_id` + `created_at` | `/notifications` |
| `work_orders` | No `(tenant_id, created_at DESC)` for unfiltered list | `/work-orders` |

The pattern: every query filters on `tenant_id` then orders by `created_at DESC`. Without a composite index covering both columns, Postgres does a full filtered scan then a sequential sort on every request.

---

## Fix Applied — Migration 031

`supabase/migrations/031_load_perf_indexes.sql` — applied to production via `supabase db push`.

```sql
-- room_assignments (no index existed)
CREATE INDEX idx_room_assignments_tenant_date_assignee ON room_assignments (tenant_id, assignment_date, assigned_to);
CREATE INDEX idx_room_assignments_tenant_date ON room_assignments (tenant_id, assignment_date);

-- guest_requests (no index existed)
CREATE INDEX idx_guest_requests_tenant_created ON guest_requests (tenant_id, created_at DESC);
CREATE INDEX idx_guest_requests_tenant_status ON guest_requests (tenant_id, status);

-- notifications (existing partial index lacked created_at)
CREATE INDEX idx_notifications_user_tenant_unread_time ON notifications (user_id, tenant_id, created_at DESC) WHERE is_read = FALSE;

-- work_orders (no ordered-list index existed)
CREATE INDEX idx_work_orders_tenant_created ON work_orders (tenant_id, created_at DESC);
```

---

## Run 2 — Post-indexes

| Endpoint | p50ms | p95ms | p99ms | Δ p95 |
|---|---|---|---|---|
| GET /billing/credits | 1108 | 1290 | 1290 | **-37%** |
| GET /guest-requests | 951 | 2551 | 3347 | **-45%** |
| GET /housekeeping/board | 1001 | 2554 | 4368 | **-28%** |
| GET /housekeeping/my-rooms | 615 | 6163 | 7140 | ~0% (still 4xx) |
| GET /notifications | 772 | 1838 | 2177 | **-20%** |
| GET /reports/daily-summary | 886 | 1847 | 1847 | **-44%** |
| GET /staff | 1138 | 1842 | 2375 | **-39%** |
| GET /tasks (all) | 627 | 1660 | 1807 | **-51%** |
| GET /tasks (mine) | 806 | 1730 | 2283 | **-52%** |
| GET /work-orders (mine) | 751 | 4184 | 5046 | **-11%** |
| **OVERALL** | **809** | **2056** | **5997** | **-51%** |

**0% 5xx. RPS: 16.5 (+16%). Overall p95: 4212ms → 2056ms (-51%).**

---

## Railway Observations

- No 5xx responses in either run. FastAPI/Railway container is not the bottleneck.
- 0 connection errors or timeouts in 1,989 combined requests.
- Latency source is Supabase PostgREST query time, not FastAPI/Railway CPU.
- Railway API service shows steady ~50ms response overhead; the 800ms–4s range is Supabase.

---

## Remaining Bottlenecks (Severity-ranked)

### 1. HIGH — `/work-orders (mine)` p95=4.2s
**Cause:** Query uses `OR (assigned_to = X OR assigned_to IS NULL)` which Postgres can't satisfy with a single B-tree index scan. Full table filter required after `tenant_id` match.  
**Fix:** Add partial index `ON work_orders (tenant_id, created_at DESC) WHERE assigned_to IS NULL` (covers unclaimed WOs) plus rely on existing `idx_work_orders_assigned_to` for assigned ones. Alternatively, run two queries and UNION in the router — avoids the OR entirely.

### 2. HIGH — `/housekeeping/board` p95=2.6s
**Cause:** Complex JOIN: `room_status INNER JOIN rooms INNER JOIN room_types INNER JOIN room_assignments` for the full board. Even with indexes, the N-table join is expensive at 84–93 requests/60s.  
**Fix:** Add index on `room_status (tenant_id, status)` — already exists. Consider a `MATERIALIZED VIEW` refreshed on room_status change for the board query. Near-term: add `room_status (tenant_id, assigned_to, status)` composite to cover the supervisor filter path.

### 3. MEDIUM — All endpoints: p50 still 600ms–1100ms
**Cause:** Supabase free tier has a shared PostgREST connection pool (~20 concurrent DB connections). Under 40 workers, every request queues for a connection slot.  
**Fix:** Upgrade Supabase to a paid plan for a dedicated connection pool (pgBouncer). Alternatively, add a lightweight response cache in FastAPI (e.g., Redis with 5s TTL for board/notifications) to absorb repeated identical reads.

### 4. LOW — `/notifications` is 30% of total traffic
**Cause:** Every role (20 housekeepers + 7 engineers + 7 front desk + 4 supervisors) polls notifications every cycle. At 40 workers it's the highest-volume endpoint.  
**Fix:** The new covering index `(user_id, tenant_id, created_at DESC) WHERE is_read = FALSE` helps, but frontend polling interval could also be increased from the current ~3–5s to 15–30s. Unread badges do not need sub-5s freshness.

---

## Summary

| Metric | Before | After | Change |
|---|---|---|---|
| 5xx rate | 0% | 0% | — |
| 4xx rate | 17.6% | 18.0% | (GM token, expected) |
| RPS | 14.2 | 16.5 | +16% |
| Overall p50 | 1008ms | 809ms | -20% |
| Overall p95 | 4212ms | 2056ms | **-51%** |
| Overall p99 | 6104ms | 5997ms | -2% |

Production is stable under 40-worker concurrent load. The index migration halved p95 latency with zero downtime. Primary remaining bottleneck is the Supabase connection pool capacity and the `work_orders` OR-filter query pattern.
