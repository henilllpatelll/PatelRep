"""
PatelRep Load Test
==================
Simulates 20-50 concurrent hotel staff hitting common API endpoints.
Measures p50/p95/p99 latency, RPS, and error rates per endpoint.

Usage (from repo root):
    python apps/api/tests/load/load_test.py                        # 30 workers, 30s
    python apps/api/tests/load/load_test.py --workers 50 --duration 60
    python apps/api/tests/load/load_test.py --api http://localhost:8000

Needs env vars (or .env in apps/api/):
    SUPABASE_URL  SUPABASE_ANON_KEY  TEST_EMAIL  TEST_PASSWORD
"""

import asyncio
import os
import sys
import argparse
import statistics
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import httpx

# ---------------------------------------------------------------------------
# Load .env files (api + web) for keys needed by the load test
# ---------------------------------------------------------------------------
def _load_dotenv(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

_repo_root = Path(__file__).resolve().parents[4]
_load_dotenv(_repo_root / "apps" / "api" / ".env")
_load_dotenv(_repo_root / "apps" / "web" / ".env.local")
_load_dotenv(_repo_root / "apps" / "web" / ".env.production")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""))
TEST_EMAIL = os.environ.get("TEST_EMAIL", "hp.patelrep@gmail.com")
TEST_PASSWORD = os.environ.get("TEST_PASSWORD", "PatelRep2026x")


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Result:
    endpoint: str
    status: int
    latency_ms: float
    error: str = ""


@dataclass
class WorkerProfile:
    role: str
    # List of (label, method, path_template, payload_fn)
    # path_template can use {hotel_id}, {user_id}
    actions: list


# ---------------------------------------------------------------------------
# Role profiles — what each staff type does in a typical polling loop
# ---------------------------------------------------------------------------

HOUSEKEEPER_ACTIONS = [
    ("GET /housekeeping/my-rooms", "GET", "/v1/housekeeping/my-rooms", None),
    ("GET /tasks (mine)", "GET", "/v1/tasks?assigned_to={user_id}&status=open&per_page=20", None),
    ("GET /notifications", "GET", "/v1/notifications?unread_only=true&limit=10", None),
]

ENGINEER_ACTIONS = [
    ("GET /work-orders (mine)", "GET", "/v1/work-orders?assigned_to={user_id}&status=open&per_page=20", None),
    ("GET /tasks (mine)", "GET", "/v1/tasks?assigned_to={user_id}&status=open&per_page=20", None),
    ("GET /notifications", "GET", "/v1/notifications?unread_only=true&limit=10", None),
]

SUPERVISOR_ACTIONS = [
    ("GET /housekeeping/board", "GET", "/v1/housekeeping/board", None),
    ("GET /staff", "GET", "/v1/staff", None),
    ("GET /tasks (all)", "GET", "/v1/tasks?per_page=20", None),
    ("GET /notifications", "GET", "/v1/notifications?unread_only=true&limit=10", None),
]

FRONT_DESK_ACTIONS = [
    ("GET /guest-requests", "GET", "/v1/guest-requests?status=open&per_page=20", None),
    ("GET /housekeeping/board", "GET", "/v1/housekeeping/board", None),
    ("GET /notifications", "GET", "/v1/notifications?unread_only=true&limit=10", None),
]

GM_ACTIONS = [
    ("GET /housekeeping/board", "GET", "/v1/housekeeping/board", None),
    ("GET /reports/daily-summary", "GET", "/v1/reports/daily-summary", None),
    ("GET /tasks (all)", "GET", "/v1/tasks?per_page=20", None),
    ("GET /staff", "GET", "/v1/staff", None),
    ("GET /billing/credits", "GET", "/v1/billing/credits", None),
]

# Distribution across a 50-person hotel property (approx)
ROLE_DISTRIBUTION = [
    ("housekeeper",           HOUSEKEEPER_ACTIONS, 22),
    ("engineer",              ENGINEER_ACTIONS,    8),
    ("housekeeping_supervisor", SUPERVISOR_ACTIONS, 4),
    ("front_desk",            FRONT_DESK_ACTIONS,  8),
    ("gm",                    GM_ACTIONS,          2),
    ("chief_engineer",        ENGINEER_ACTIONS,    1),
]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

async def get_auth_token(client: httpx.AsyncClient) -> tuple[str, str, str]:
    """Authenticate with Supabase and return (access_token, hotel_id, user_id)."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set.", file=sys.stderr)
        print("  Set them in apps/api/.env or as environment variables.", file=sys.stderr)
        sys.exit(1)

    resp = await client.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
        },
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=15,
    )

    if resp.status_code != 200:
        print(f"ERROR: Auth failed {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
        sys.exit(1)

    data = resp.json()
    token = data["access_token"]

    # Decode JWT claims without verifying sig (load test only)
    import base64, json as _json
    payload_b64 = token.split(".")[1]
    # Add padding
    payload_b64 += "=" * (-len(payload_b64) % 4)
    claims = _json.loads(base64.b64decode(payload_b64))

    hotel_id = claims.get("hotel_id") or claims.get("user_metadata", {}).get("hotel_id", "")
    user_id = claims.get("sub", "")

    return token, hotel_id, user_id


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

async def worker(
    worker_id: int,
    role: str,
    actions: list,
    api_base: str,
    token: str,
    hotel_id: str,
    user_id: str,
    duration_s: float,
    results: list,
    stop_event: asyncio.Event,
):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # Stagger startup so we don't spike all at once
    await asyncio.sleep(worker_id * 0.05)

    async with httpx.AsyncClient(base_url=api_base, headers=headers, timeout=10) as client:
        action_idx = 0
        while not stop_event.is_set():
            label, method, path_tmpl, payload_fn = actions[action_idx % len(actions)]
            path = path_tmpl.format(hotel_id=hotel_id, user_id=user_id)
            payload = payload_fn() if payload_fn else None

            t0 = time.perf_counter()
            try:
                if method == "GET":
                    resp = await client.get(path)
                elif method == "POST":
                    resp = await client.post(path, json=payload)
                elif method == "PATCH":
                    resp = await client.patch(path, json=payload)
                else:
                    resp = await client.request(method, path, json=payload)
                latency = (time.perf_counter() - t0) * 1000
                results.append(Result(
                    endpoint=label,
                    status=resp.status_code,
                    latency_ms=latency,
                    error="" if resp.status_code < 500 else resp.text[:120],
                ))
            except httpx.RequestError as e:
                latency = (time.perf_counter() - t0) * 1000
                results.append(Result(
                    endpoint=label,
                    status=0,
                    latency_ms=latency,
                    error=str(e)[:120],
                ))

            action_idx += 1
            # Simulate human think-time: 0.5–3s between actions
            await asyncio.sleep(0.5 + (worker_id % 5) * 0.5)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def _pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    values.sort()
    idx = int(len(values) * p / 100)
    return values[min(idx, len(values) - 1)]


def print_report(results: list[Result], elapsed: float, num_workers: int):
    if not results:
        print("No results collected.")
        return

    by_endpoint: dict[str, list[Result]] = defaultdict(list)
    for r in results:
        by_endpoint[r.endpoint].append(r)

    total = len(results)
    errors = sum(1 for r in results if r.status == 0 or r.status >= 500)
    client_errs = sum(1 for r in results if 400 <= r.status < 500)

    print("\n" + "=" * 72)
    print(f"  PatelRep Load Test — {num_workers} workers — {elapsed:.1f}s")
    print("=" * 72)
    print(f"  Total requests : {total}")
    print(f"  RPS            : {total / elapsed:.1f}")
    print(f"  5xx / conn err : {errors}  ({100*errors/total:.1f}%)")
    print(f"  4xx            : {client_errs}  ({100*client_errs/total:.1f}%)")
    print()

    col = "{:<40} {:>6} {:>8} {:>8} {:>8} {:>6} {:>6}"
    print(col.format("Endpoint", "Req", "p50ms", "p95ms", "p99ms", "Err%", "2xx%"))
    print("-" * 72)

    all_latencies: list[float] = []
    for ep in sorted(by_endpoint):
        rows = by_endpoint[ep]
        latencies = [r.latency_ms for r in rows]
        all_latencies.extend(latencies)
        errs = sum(1 for r in rows if r.status == 0 or r.status >= 500)
        ok = sum(1 for r in rows if 200 <= r.status < 300)
        print(col.format(
            ep[:40],
            len(rows),
            f"{_pct(latencies, 50):.0f}",
            f"{_pct(latencies, 95):.0f}",
            f"{_pct(latencies, 99):.0f}",
            f"{100*errs/len(rows):.0f}%",
            f"{100*ok/len(rows):.0f}%",
        ))

    print("-" * 72)
    print(col.format(
        "OVERALL",
        total,
        f"{_pct(all_latencies, 50):.0f}",
        f"{_pct(all_latencies, 95):.0f}",
        f"{_pct(all_latencies, 99):.0f}",
        f"{100*errors/total:.0f}%",
        f"{100*sum(1 for r in results if 200<=r.status<300)/total:.0f}%",
    ))
    print("=" * 72)

    # Surface any 5xx error samples
    error_samples = [(r.endpoint, r.status, r.error) for r in results if r.status >= 500 or r.status == 0]
    if error_samples:
        print("\nError samples (up to 5):")
        for ep, st, msg in error_samples[:5]:
            print(f"  [{st}] {ep}: {msg}")

    # Warn on slow endpoints
    slow = [(ep, _pct([r.latency_ms for r in rows], 95))
            for ep, rows in by_endpoint.items()
            if _pct([r.latency_ms for r in rows], 95) > 1000]
    if slow:
        print("\nSlow endpoints (p95 > 1s):")
        for ep, ms in slow:
            print(f"  {ep}: p95={ms:.0f}ms")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    parser = argparse.ArgumentParser(description="PatelRep API load test")
    parser.add_argument("--workers", type=int, default=30, help="Concurrent workers (default: 30)")
    parser.add_argument("--duration", type=int, default=30, help="Test duration in seconds (default: 30)")
    parser.add_argument("--api", default="https://api-production-130b.up.railway.app",
                        help="API base URL (default: Railway production)")
    args = parser.parse_args()

    print(f"Authenticating against Supabase at {SUPABASE_URL or '(not set)'}...")
    async with httpx.AsyncClient() as client:
        token, hotel_id, user_id = await get_auth_token(client)

    print(f"  hotel_id={hotel_id}  user_id={user_id[:8]}...")
    print(f"\nTarget API: {args.api}")
    print(f"Workers: {args.workers} | Duration: {args.duration}s")
    print("Starting load test...\n")

    # Build worker list from role distribution, clamped to --workers total
    worker_list: list[tuple[str, list]] = []
    for role, actions, weight in ROLE_DISTRIBUTION:
        count = max(1, round(args.workers * weight / 45))  # 45 = sum of weights
        for _ in range(count):
            worker_list.append((role, actions))
        if len(worker_list) >= args.workers:
            break
    worker_list = worker_list[: args.workers]

    print(f"Role breakdown ({len(worker_list)} workers):")
    from collections import Counter
    for role, cnt in sorted(Counter(r for r, _ in worker_list).items(), key=lambda x: -x[1]):
        print(f"  {role:<30} {cnt} workers")
    print()

    results: list[Result] = []
    stop_event = asyncio.Event()

    tasks = [
        asyncio.create_task(worker(
            worker_id=i,
            role=role,
            actions=actions,
            api_base=args.api,
            token=token,
            hotel_id=hotel_id,
            user_id=user_id,
            duration_s=args.duration,
            results=results,
            stop_event=stop_event,
        ))
        for i, (role, actions) in enumerate(worker_list)
    ]

    # Progress ticker
    t_start = time.perf_counter()
    while time.perf_counter() - t_start < args.duration:
        await asyncio.sleep(5)
        elapsed = time.perf_counter() - t_start
        print(f"  {elapsed:.0f}s — {len(results)} requests completed...", end="\r")

    stop_event.set()
    await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = time.perf_counter() - t_start
    print_report(results, elapsed, len(worker_list))


if __name__ == "__main__":
    asyncio.run(main())
