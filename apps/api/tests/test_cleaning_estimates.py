"""Cleaning-time estimation: data hygiene, the hold-out gate, tenant isolation and the endpoint.

All data is synthetic. The accuracy tests build histories whose true behaviour is known, so they prove the
GATE behaves (adopts history only when it beats the baseline); they say nothing about any real hotel.
"""

import random
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import clean_sessions as clean_sessions_router
from services import cleaning_estimates as ce
from tests.smoke.fake_supabase import FakeDB

T0 = datetime(2026, 8, 1, 14, 0, tzinfo=timezone.utc)


def _row(i, minutes, *, room="room-1", person="hk-1", clean_type="DEP", offset_hours=None, **over):
    start = T0 + timedelta(hours=offset_hours if offset_hours is not None else i * 3)
    end = start + timedelta(minutes=minutes)
    row = {
        "id": f"s{i}",
        "room_id": room,
        "housekeeper_id": person,
        "clean_type": clean_type,
        "status": "completed",
        "blocked_reason": None,
        "started_at": start.isoformat(),
        "ended_at": end.isoformat(),
        "duration_seconds": int(minutes * 60),
        "checklist_done": 8,
        "checklist_total": 8,
    }
    row.update(over)
    return row


ROOMS = [{"id": "room-1", "room_types": {"code": "KING", "base_clean_minutes": 30}}]


def _history(n, mean, spread=2.0, seed=1, **kw):
    rng = random.Random(seed)
    return [_row(i, max(4.0, rng.gauss(mean, spread)), person=f"hk-{i % 4}", **kw) for i in range(n)]


# ---- hygiene -------------------------------------------------------------------------------------------

def test_invalid_rows_are_excluded():
    good = _row(0, 25)
    rows = [
        good,
        _row(1, 25, status="active"),
        _row(2, 25, status="abandoned"),
        _row(3, 25, blocked_reason="dnd"),
        _row(4, 1),  # impossibly fast
        _row(5, 240),  # truncated at the server cap
        _row(6, 25, clean_type=None),
        _row(7, 25, duration_seconds=-30),
        _row(8, 25, duration_seconds=3000),  # disagrees with its own timestamps
        _row(9, 25, ended_at=T0.isoformat()),  # ends before it starts
        _row(10, 25, checklist_done=0),  # nothing ticked
        _row(11, 25, started_at="not a date"),
    ]
    kept = ce.valid_sessions(rows)
    assert [o.session_id for o in kept] == ["s0"]


def test_duplicates_and_overlapping_sessions_are_excluded():
    a = _row(0, 25)
    same_id = dict(a)
    same_room_same_start = _row(1, 25, offset_hours=0)  # same room + same start as s0, different id
    # one person cannot clean two rooms at once
    p1 = _row(2, 30, room="room-2", person="hk-9", offset_hours=10)
    p2 = _row(3, 30, room="room-3", person="hk-9", offset_hours=10.2)
    kept = {o.session_id for o in ce.valid_sessions([a, same_id, same_room_same_start, p1, p2])}
    assert kept == {"s0"}


def test_outlier_trim_keeps_a_normal_sample_and_drops_extremes():
    values = [24, 25, 25, 26, 26, 27, 25, 24, 26, 90]
    assert 90 not in ce.trim_outliers(values)
    assert ce.trim_outliers([20, 40, 30]) == [20, 40, 30]  # too small to trim
    assert ce.trim_outliers([25.0] * 8) == [25.0] * 8  # MAD 0 -> untouched


def test_shrinkage_stays_near_baseline_with_little_data_and_is_bounded():
    assert ce.shrunk_estimate([10.0], 30) == 27  # pulled mostly back toward the baseline
    assert ce.shrunk_estimate([14.0] * 200, 30) == 14  # plenty of data: the evidence wins
    assert ce.shrunk_estimate([1000.0] * 500, 30) == 75  # never above 2.5x baseline
    assert ce.shrunk_estimate([1.0] * 500, 30) == 12  # never below 0.4x baseline


# ---- the hold-out gate ---------------------------------------------------------------------------------

def test_history_that_beats_the_baseline_is_adopted():
    # The hotel's room type says 30 but departures really take about 22.
    estimates = ce.build_estimates(_history(60, 22), ROOMS)
    assert len(estimates) == 1
    e = estimates[0]
    assert (e.room_type_code, e.clean_type) == ("KING", "DEP")
    assert 20 <= e.minutes <= 25
    assert e.model_mae < e.baseline_mae
    assert e.holdout_count >= ce.MIN_HOLDOUT


def test_history_that_agrees_with_the_baseline_is_not_adopted():
    # Baseline is already right: no demonstrated improvement, so nothing is returned.
    assert ce.build_estimates(_history(60, 30), ROOMS) == []


def test_too_little_history_returns_nothing():
    assert ce.build_estimates(_history(ce.MIN_VALID_PER_GROUP - 1, 20), ROOMS) == []


def test_drift_is_judged_on_the_newest_cleans_not_shuffled():
    # Older cleans were fast, the newest are slow (renovation): the hold-out sees the slow ones, so a
    # fast-leaning history must not be adopted over a baseline that is closer to recent reality.
    rows = _history(35, 18) + [
        _row(100 + i, 31, person=f"hk-{i % 4}", offset_hours=35 * 3 + i * 3) for i in range(15)
    ]
    assert ce.build_estimates(rows, ROOMS) == []


def test_clean_types_are_estimated_separately():
    rooms = ROOMS
    rows = _history(40, 22, clean_type="DEP") + [
        {**_row(i, m, person=f"hk-{i % 4}", clean_type="LIGHT", offset_hours=i * 3 + 1.5), "id": f"l{i}"}
        for i, m in enumerate(r["duration_seconds"] / 60 for r in _history(40, 12, seed=3))
    ]
    by_type = {e.clean_type: e for e in ce.build_estimates(rows, rooms)}
    assert set(by_type) == {"DEP", "LIGHT"}
    assert by_type["LIGHT"].minutes < by_type["DEP"].minutes


def test_a_room_type_without_a_baseline_uses_the_general_figure_for_its_clean_type():
    rooms = [{"id": "room-1", "room_types": {"code": "KING", "base_clean_minutes": None}}]
    assert ce.baseline_minutes(None, "LIGHT") == 15
    assert ce.baseline_minutes(0, "DEP") == 30
    assert ce.baseline_minutes(None, "PICKUP") == 25
    estimates = ce.build_estimates(_history(60, 22, clean_type="LIGHT"), rooms)
    assert estimates and estimates[0].minutes >= 15


# ---- endpoint ------------------------------------------------------------------------------------------

def _auth(role="housekeeper", hotel_id="hotel-a", user_id="hk-1"):
    token = jwt.encode(
        {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def _recent(rows):
    now = datetime.now(timezone.utc) - timedelta(days=2)
    out = []
    for idx, row in enumerate(rows):
        shifted = now - timedelta(hours=(len(rows) - idx) * 3)
        minutes = row["duration_seconds"] / 60
        out.append({
            **row,
            "started_at": shifted.isoformat(),
            "ended_at": (shifted + timedelta(minutes=minutes)).isoformat(),
        })
    return out


def _db(rows_a, rows_b=()):
    return FakeDB({
        "room_clean_sessions": [{**r, "tenant_id": "hotel-a"} for r in rows_a] + [{**r, "tenant_id": "hotel-b"} for r in rows_b],
        "rooms": [
            {"id": "room-1", "tenant_id": "hotel-a", "room_types": {"code": "KING", "base_clean_minutes": 30}},
        ],
    })


def test_endpoint_returns_only_aggregate_figures_for_the_callers_hotel(monkeypatch):
    clean_sessions_router._estimate_cache.clear()
    other_hotel = _history(60, 5, seed=9)  # would be wildly different if it leaked
    monkeypatch.setattr(clean_sessions_router, "supabase", _db(_recent(_history(60, 22)), _recent(other_hotel)))
    res = TestClient(app).get("/v1/clean-sessions/estimates", headers=_auth())
    assert res.status_code == 200
    data = res.json()["data"]
    assert len(data["estimates"]) == 1
    est = data["estimates"][0]
    assert set(est) == {"room_type_code", "clean_type", "minutes", "sample_count", "holdout"}
    assert 20 <= est["minutes"] <= 25
    assert "hk-" not in res.text and "room-1" not in res.text  # no person or room identifiers


def test_endpoint_is_cached_per_hotel_and_not_shared(monkeypatch):
    clean_sessions_router._estimate_cache.clear()
    monkeypatch.setattr(clean_sessions_router, "supabase", _db(_recent(_history(60, 22))))
    client = TestClient(app)
    first = client.get("/v1/clean-sessions/estimates", headers=_auth()).json()["data"]
    # same hotel: served from cache even if the table changes underneath
    monkeypatch.setattr(clean_sessions_router, "supabase", _db([]))
    assert client.get("/v1/clean-sessions/estimates", headers=_auth()).json()["data"] == first
    # a different hotel has its own entry and sees its own (empty) history
    other = client.get("/v1/clean-sessions/estimates", headers=_auth(hotel_id="hotel-b")).json()["data"]
    assert other["estimates"] == []


def test_endpoint_rejects_roles_outside_the_housekeeping_floor(monkeypatch):
    monkeypatch.setattr(clean_sessions_router, "supabase", _db([]))
    client = TestClient(app)
    assert client.get("/v1/clean-sessions/estimates", headers=_auth(role="front_desk")).status_code == 403
    assert client.get("/v1/clean-sessions/estimates").status_code in (401, 403)
