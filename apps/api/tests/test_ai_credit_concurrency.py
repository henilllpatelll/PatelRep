"""Concurrent paid AI calls cannot push a hotel past its monthly cap.

Before migration 217 the cap was read and the credits added in two separate steps, so every request that
overlapped saw the same "under the cap" figure and was billed. ``check_and_deduct_credits`` now makes one
atomic ``deduct_ai_credits`` call. The fake database below behaves like Postgres for that function: the
check and the increment happen under one lock, as the single UPDATE statement does under the ledger row lock.
"""

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from core.config import settings
from middleware import credits
from tests.smoke.fake_supabase import FakeDB

HOTEL = "hotel-a"
OTHER = "hotel-b"
BASE = credits.BASE_FEE_CENTS


class LedgerDB(FakeDB):
    """FakeDB with the two credit RPCs. ``atomic=False`` models a database without migration 217."""

    def __init__(self, rows, *, atomic=True):
        super().__init__(rows)
        self.atomic = atomic
        self.lock = threading.Lock()
        self.rpc_calls = []

    def rpc(self, name, params):
        return _Rpc(self, name, params)

    def _ledger(self, hotel):
        return next(r for r in self.rows["credit_ledger"] if r["tenant_id"] == hotel)

    def _bump(self, hotel, amount):
        row = self._ledger(hotel)
        row["credits_used"] = round(row["credits_used"] + amount, 4)
        overage = max(0, row["credits_used"] - row["credits_included"] - row["credits_purchased"])
        row["overage_cost_cents"] = overage * 2  # the generated column


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        db, p = self.db, self.params
        db.rpc_calls.append((self.name, p))
        if self.name == "deduct_ai_credits":
            if not db.atomic:
                raise Exception("{'code': 'PGRST202', 'message': 'Could not find the function public.deduct_ai_credits'}")
            with db.lock:  # one statement: check and increment cannot interleave with another caller's
                row = db._ledger(p["p_hotel_id"])
                sub = next((s for s in db.rows["subscriptions"] if s["tenant_id"] == p["p_hotel_id"]), None)
                blocked = bool(sub and (sub.get("cap_cents") or 0) > 0
                               and row["overage_cost_cents"] >= sub["cap_cents"] - p["p_base_fee_cents"])
                if blocked:
                    return SimpleNamespace(data=False)
                db._bump(p["p_hotel_id"], p["p_credits"])
                return SimpleNamespace(data=True)
        if self.name == "increment_credits_used":
            time.sleep(0.002)  # the old path's window between its cap read and this write
            with db.lock:
                db._bump(p["p_hotel_id"], p["p_credits"])
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=[])


def make_db(*, max_overage_credits, hotel=HOTEL, atomic=True, cap=True):
    today = date.today()
    ledger = lambda h: {  # noqa: E731
        "id": f"ledger-{h}", "tenant_id": h, "period_start": date(today.year, 1, 1).isoformat(),
        "period_end": date(today.year, 12, 31).isoformat(), "credits_included": 0, "credits_purchased": 0,
        "credits_used": 0, "overage_cost_cents": 0, "is_finalized": False,
    }
    # overage costs 2 cents per credit, so a cap of BASE + 2n cents allows n overage credits.
    sub = lambda h: {"tenant_id": h, "cap_cents": BASE + int(max_overage_credits * 2) if cap else None, "plan_status": "active"}  # noqa: E731
    return LedgerDB(
        {"credit_ledger": [ledger(hotel), ledger(OTHER)], "subscriptions": [sub(hotel), sub(OTHER)], "ai_interactions": []},
        atomic=atomic,
    )


@pytest.fixture(autouse=True)
def _hosted(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "hosted")


def burst(db, monkeypatch, *, calls, interaction="task_creation", hotel=HOTEL, workers=16):
    """Fire ``calls`` charges at once; return (credits charged per success, refusals)."""
    monkeypatch.setattr(credits, "supabase", db)
    gate = threading.Event()
    threading.Timer(0.2, gate.set).start()  # let every worker thread reach the gate, then release them together

    def one(_):
        gate.wait(timeout=5)
        try:
            return asyncio.run(credits.check_and_deduct_credits(hotel, interaction, 100, 50))
        except HTTPException as err:
            return err.status_code

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(one, range(calls)))
    return [r for r in results if not isinstance(r, int)], [r for r in results if isinstance(r, int)]


def test_a_burst_cannot_pass_the_cap(monkeypatch):
    db = make_db(max_overage_credits=10)
    charged, refused = burst(db, monkeypatch, calls=40)
    assert len(charged) == 10 and refused == [402] * 30   # 1 credit each: exactly the cap allows
    assert db._ledger(HOTEL)["credits_used"] == 10
    assert db._ledger(HOTEL)["overage_cost_cents"] == 20 == db.rows["subscriptions"][0]["cap_cents"] - BASE


def test_overshoot_is_bounded_by_the_single_call_that_crosses_the_cap(monkeypatch):
    db = make_db(max_overage_credits=9)
    charged, refused = burst(db, monkeypatch, calls=40, interaction="sop_query")  # 2 credits per call
    used = db._ledger(HOTEL)["credits_used"]
    assert used == sum(charged)                           # the ledger holds exactly what was billed
    assert 9 <= used <= 9 + max(charged)                  # past the cap by at most the crossing call
    assert len(charged) + len(refused) == 40 and set(refused) == {402}


def test_one_hotels_burst_never_touches_another_hotels_ledger(monkeypatch):
    db = make_db(max_overage_credits=5)
    burst(db, monkeypatch, calls=20)
    assert db._ledger(OTHER)["credits_used"] == 0
    # ... and the other hotel is still billed normally afterwards.
    charged, refused = burst(db, monkeypatch, calls=3, hotel=OTHER)
    assert len(charged) == 3 and refused == []
    assert db._ledger(OTHER)["credits_used"] == 3


def test_refused_calls_are_not_billed_and_the_deduction_params_are_scoped(monkeypatch):
    db = make_db(max_overage_credits=2)
    burst(db, monkeypatch, calls=10)
    deducts = [params for name, params in db.rpc_calls if name == "deduct_ai_credits"]
    assert deducts and all(p["p_hotel_id"] == HOTEL and p["p_base_fee_cents"] == BASE for p in deducts)
    assert db._ledger(HOTEL)["credits_used"] == 2


def test_no_cap_means_no_limit(monkeypatch):
    db = make_db(max_overage_credits=0, cap=False)
    charged, refused = burst(db, monkeypatch, calls=25)
    assert len(charged) == 25 and refused == []
    assert db._ledger(HOTEL)["credits_used"] == 25


def test_billed_credits_are_still_token_derived(monkeypatch):
    db = make_db(max_overage_credits=1000)
    monkeypatch.setattr(credits, "supabase", db)
    charged = asyncio.run(credits.check_and_deduct_credits(HOTEL, "sop_query", 200_000, 40_000))
    assert charged == credits.compute_credits("sop_query", 200_000, 40_000) > credits.CREDIT_COSTS["sop_query"]
    assert db._ledger(HOTEL)["credits_used"] == charged


def test_before_migration_217_it_falls_back_to_the_previous_path(monkeypatch, caplog):
    db = make_db(max_overage_credits=3, atomic=False)
    monkeypatch.setattr(credits, "supabase", db)
    for _ in range(3):
        asyncio.run(credits.check_and_deduct_credits(HOTEL, "task_creation", 10, 10))
    with pytest.raises(HTTPException) as err:             # the sequential cap still holds without the function
        asyncio.run(credits.check_and_deduct_credits(HOTEL, "task_creation", 10, 10))
    assert err.value.status_code == 402
    assert any("deduct_ai_credits() missing" in r.message for r in caplog.records)
    assert [n for n, _ in db.rpc_calls].count("increment_credits_used") == 3


def test_a_real_database_error_is_not_swallowed_into_the_fallback(monkeypatch):
    db = make_db(max_overage_credits=3)
    monkeypatch.setattr(credits, "supabase", db)

    def boom(name, params):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(db, "rpc", boom)
    with pytest.raises(RuntimeError):
        asyncio.run(credits.check_and_deduct_credits(HOTEL, "task_creation", 10, 10))
    assert db._ledger(HOTEL)["credits_used"] == 0


def test_a_finalized_period_bills_nothing_and_does_not_error(monkeypatch):
    """No open ledger row: the atomic deduction returns false but the hotel is not at its cap -- as before, no 402."""
    db = make_db(max_overage_credits=100)
    monkeypatch.setattr(credits, "supabase", db)
    real = db.rpc

    def closed(name, params):
        if name == "deduct_ai_credits":
            db.rpc_calls.append((name, params))
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=False))
        return real(name, params)

    monkeypatch.setattr(db, "rpc", closed)
    assert asyncio.run(credits.check_and_deduct_credits(HOTEL, "task_creation", 10, 10)) == 1.0
    assert db._ledger(HOTEL)["credits_used"] == 0
