"""Cross-replica claim around AI shift-summary generation (issue #204, migration 236).

Concurrency is real: each "replica" is its own thread running its own event loop
against one shared fake database and one shared claim store (which serialises like
a Postgres row lock). The invariant under test is the money one — however many
cron ticks / replicas / manual clicks overlap, ONE model call and ONE credit
charge happen per shift occurrence. SQL semantics are proven separately against a
real migrated Postgres in tests/integration/test_shift_summary_claims.py.
"""
import asyncio
import threading
import time
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from main import app
from middleware import credits as credits_module
from routers import internal, logbook as logbook_router
from services.ai import shift_summary as summary
from services.ai import shift_summary_claims as claims
from services.ai import shift_summary_due as due_module
from services.ai.shift_summary_claims import ShiftSummaryClaimLost, ShiftSummaryClaimUnavailable
from services.ai.shift_summary_due import DueSelection
from services.ai.shift_summary_schedule import Occurrence
from tests.shift_claim_fake import FakeClaimStore
from tests.smoke.fake_supabase import FakeDB, FakeQuery
from tests.test_shift_summary_generate import _auth_header

HOTEL = "hotel-1"
SHIFT = "aaaaaaaa-0000-4000-8000-000000000001"
DAY = "2026-09-16"
CHARGE_RPC = "increment_credits_used"


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        self.db.rpc_calls.append((self.name, self.params))
        return SimpleNamespace(data=[])


class CreditDB(FakeDB):
    def __init__(self, rows):
        super().__init__(rows)
        self.rpc_calls = []

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)

    @property
    def charges(self):
        return [c for c in self.rpc_calls if c[0] == CHARGE_RPC]


def _rows():
    return {
        "tenants": [{"id": HOTEL, "timezone": "UTC"}],
        "shifts": [{"id": SHIFT, "tenant_id": HOTEL, "name": "Morning", "department_id": None, "departments": None,
                    "start_time": "07:00", "end_time": "15:00"}],
        "shift_summaries": [], "logbook_entries": [], "tasks": [], "work_orders": [], "room_status": [],
        "guest_requests": [], "engineering_parts": [], "engineering_part_stock": [],
        "credit_ledger": [{"id": "l1", "tenant_id": HOTEL,
                           "period_start": date(date.today().year, 1, 1).isoformat(),
                           "period_end": date(date.today().year, 12, 31).isoformat(),
                           "credits_included": 5000, "overage_cost_cents": 0}],
    }


class Model:
    """Fake Anthropic client that counts calls, can be slow, and can fail."""

    def __init__(self, delay=0.0, fail_times=0, hook=None):
        self.calls = 0
        self.delay, self.fail_times, self.hook = delay, fail_times, hook
        self._lock = threading.Lock()
        self.messages = self

    def create(self, **_kw):
        with self._lock:
            self.calls += 1
            n = self.calls
        if self.hook:
            self.hook()
        time.sleep(self.delay)
        if n <= self.fail_times:
            raise RuntimeError("provider 503")
        return SimpleNamespace(content=[SimpleNamespace(text="Handoff.")],
                               usage=SimpleNamespace(input_tokens=400, output_tokens=150))


@pytest.fixture
def world(monkeypatch):
    db = CreditDB(_rows())
    store = FakeClaimStore(summary_exists=lambda t, s, d: any(
        r["tenant_id"] == t and r["shift_id"] == s and str(r["shift_date"]) == d for r in db.rows["shift_summaries"]))
    model = Model()
    for module in (summary, credits_module, internal, logbook_router):
        monkeypatch.setattr(module, "supabase", db)
    monkeypatch.setattr(claims, "supabase", store)
    monkeypatch.setattr(summary, "get_anthropic_client", lambda: model)
    import services.ai.providers as providers
    monkeypatch.setattr(providers, "get_anthropic_client", lambda: model)
    monkeypatch.setattr(settings, "ai_provider", "hosted")
    monkeypatch.setattr(internal, "verify_cron", lambda _s: None)
    monkeypatch.setattr(internal, "_record_cron_run", lambda *_a, **_k: None)
    return SimpleNamespace(db=db, store=store, model=model)


def _run_in_threads(n, fn):
    """Start n 'replicas' together (barrier) and collect (result | exception) from each."""
    barrier = threading.Barrier(n)
    out = [None] * n

    def worker(i):
        barrier.wait()
        try:
            out[i] = asyncio.run(fn(i))
        except Exception as exc:  # noqa: BLE001 - the exception IS the datum
            out[i] = exc

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    [t.start() for t in threads]
    [t.join(30) for t in threads]
    return out


# --- concurrent execution ------------------------------------------------------------------------------------------

def test_simultaneous_generate_requests_make_exactly_one_model_call_and_charge(world):
    world.model.delay = 0.3  # every replica passes the "no summary yet" check before the first finishes

    results = _run_in_threads(6, lambda i: summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))

    generated = [r for r in results if isinstance(r, dict) and r.get("was_generated")]
    busy = [r for r in results if isinstance(r, ShiftSummaryClaimUnavailable)]
    assert len(generated) == 1
    assert len(generated) + len(busy) + sum(isinstance(r, dict) and not r.get("was_generated") for r in results) == 6
    assert all(b.reason == "in_progress" for b in busy)
    assert world.model.calls == 1
    assert len(world.db.charges) == 1
    assert len(world.db.rows["shift_summaries"]) == 1
    assert world.store.rows[(HOTEL, SHIFT, DAY)]["status"] == "succeeded"


def test_overlapping_cron_runs_and_a_manual_click_share_one_generation(world, monkeypatch):
    world.model.delay = 0.3
    due = DueSelection(due=[Occurrence(HOTEL, SHIFT, DAY, datetime(2026, 9, 16, 15, tzinfo=timezone.utc))])
    monkeypatch.setattr(due_module, "load_due_occurrences", lambda *_a, **_k: due)

    async def replica(i):
        if i == 2:  # a manager clicks Generate at the same moment
            return await summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY, user_id="gm-1")
        return await internal.generate_shift_summaries("x")

    results = _run_in_threads(3, replica)

    crons = [r for i, r in enumerate(results) if i != 2]
    assert all(isinstance(r, dict) and r["status"] == "ok" and r["errors"] == 0 for r in crons), results
    assert sum(r["summaries_generated"] for r in crons) + sum(
        isinstance(results[2], dict) and results[2].get("was_generated") is True for _ in [0]) == 1
    assert world.model.calls == 1
    assert len(world.db.charges) == 1
    assert sum(r["skipped_in_progress"] + r["already_present"] for r in crons) >= 1


def test_double_click_regenerate_charges_once(world):
    asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert world.model.calls == 1
    world.model.delay = 0.3

    results = _run_in_threads(4, lambda i: summary.regenerate_shift_summary(HOTEL, SHIFT, DAY, user_id="gm-1"))

    assert sum(isinstance(r, dict) for r in results) == 1
    assert all(isinstance(r, ShiftSummaryClaimUnavailable) for r in results if not isinstance(r, dict))
    assert world.model.calls == 2  # the original + exactly one regenerate
    assert len(world.db.charges) == 2
    assert len(world.db.rows["shift_summaries"]) == 1


def test_existing_summary_is_returned_without_claiming_or_calling_the_model(world):
    world.db.rows["shift_summaries"].append({"tenant_id": HOTEL, "shift_id": SHIFT, "shift_date": DAY,
                                             "summary_text": "already here"})
    result = asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert result["was_generated"] is False and result["summary_text"] == "already here"
    assert world.model.calls == 0 and world.store.calls == []


# --- retry behaviour ------------------------------------------------------------------------------------------------

def _advance(world, seconds):
    base = world.store.now
    world.store.now = lambda: base() + timedelta(seconds=seconds)


def test_failed_generation_is_retried_after_backoff_not_immediately(world):
    world.model.fail_times = 1
    with pytest.raises(Exception):
        asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert world.store.rows[(HOTEL, SHIFT, DAY)]["status"] == "failed"
    assert world.db.charges == []  # a failed call is never charged

    with pytest.raises(ShiftSummaryClaimUnavailable) as backoff:
        asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert backoff.value.reason == "backoff" and world.model.calls == 1

    _advance(world, claims.RETRY_AFTER_SECONDS + 1)
    result = asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert result["was_generated"] is True
    assert world.model.calls == 2 and len(world.db.charges) == 1
    assert world.store.rows[(HOTEL, SHIFT, DAY)]["attempts"] == 2


def test_retries_stop_after_the_attempt_cap_so_a_broken_shift_cannot_drain_credits(world):
    world.model.fail_times = 99
    for attempt in range(claims.MAX_ATTEMPTS):
        _advance(world, claims.RETRY_AFTER_SECONDS + 1)
        with pytest.raises(Exception) as err:
            asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
        assert not isinstance(err.value, ShiftSummaryClaimUnavailable), f"attempt {attempt + 1} should reach the model"
    assert world.model.calls == claims.MAX_ATTEMPTS

    _advance(world, 10 * claims.RETRY_AFTER_SECONDS)
    with pytest.raises(ShiftSummaryClaimUnavailable) as spent:
        asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert spent.value.reason == "retry_exhausted" and "provider 503" in (spent.value.last_error or "")
    assert world.model.calls == claims.MAX_ATTEMPTS and world.db.charges == []


def test_a_person_can_retry_manually_past_backoff_and_the_cap(world):
    world.model.fail_times = claims.MAX_ATTEMPTS
    for _ in range(claims.MAX_ATTEMPTS):
        _advance(world, claims.RETRY_AFTER_SECONDS + 1)
        with pytest.raises(Exception):
            asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    result = asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY, user_id="gm-1"))
    assert result["was_generated"] is True and len(world.db.charges) == 1


def test_crashed_owner_lease_expires_and_the_next_run_recovers(world):
    held = claims.acquire_claim(HOTEL, SHIFT, DAY, replace_existing=False, ignore_retry_limits=False)
    assert held is not None  # a replica claims, then dies without finishing

    with pytest.raises(ShiftSummaryClaimUnavailable) as live:
        asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert live.value.reason == "in_progress" and world.model.calls == 0

    _advance(world, claims.LEASE_SECONDS + 1)
    result = asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert result["was_generated"] is True and world.model.calls == 1
    assert world.store.rows[(HOTEL, SHIFT, DAY)]["attempts"] == 2


def test_superseded_owner_writes_nothing_and_charges_nothing(world):
    """A slow owner whose lease was taken over mid-call must discard its result."""
    taken = {}

    def takeover():
        _advance(world, claims.LEASE_SECONDS + 1)
        taken["claim"] = claims.acquire_claim(HOTEL, SHIFT, DAY, replace_existing=False, ignore_retry_limits=False)

    world.model.hook = takeover
    with pytest.raises(ShiftSummaryClaimLost):
        asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))

    assert taken["claim"] is not None
    assert world.db.rows["shift_summaries"] == [] and world.db.charges == []
    assert world.store.rows[(HOTEL, SHIFT, DAY)]["token"] == taken["claim"].token  # the new owner is untouched
    assert world.store.rows[(HOTEL, SHIFT, DAY)]["status"] == "claimed"


# --- fencing: the lease can lapse at any instant, the commit point must still be safe ------------------------------

def test_lease_lapsing_between_model_return_and_persistence_discards_without_writing_or_charging(world):
    """Fault injection: the lease expires after the model answered but before the commit. Nobody took over, yet an
    expired lease is never finalized -- the old 'token + status' check would have let this through."""
    world.model.hook = lambda: _advance(world, claims.LEASE_SECONDS + 1)

    with pytest.raises(ShiftSummaryClaimLost) as lost:
        asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))

    assert str(lost.value) == "lease_expired"
    assert world.db.rows["shift_summaries"] == [] and world.db.charges == []
    assert world.store.rows[(HOTEL, SHIFT, DAY)]["status"] == "claimed"  # recoverable: the next run takes it over

    world.model.hook = None
    result = asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert result["was_generated"] is True and len(world.db.charges) == 1
    assert world.store.rows[(HOTEL, SHIFT, DAY)]["attempts"] == 2


def test_two_workers_cannot_both_charge_when_the_first_outlives_its_lease(world):
    """Worker A's lease lapses mid-call; B takes over and finishes; A then returns. Exactly one write, one charge."""
    a_inside, release_a = threading.Event(), threading.Event()
    first = threading.Lock()
    state = {"a_taken": False}

    def hook():
        with first:
            mine = not state["a_taken"]
            state["a_taken"] = True
        if mine:  # only the first caller (A) is parked mid-call
            a_inside.set()
            assert release_a.wait(20)

    world.model.hook = hook
    outcome = {}

    def worker_a():
        try:
            outcome["a"] = asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
        except Exception as exc:  # noqa: BLE001
            outcome["a"] = exc

    thread = threading.Thread(target=worker_a)
    thread.start()
    assert a_inside.wait(20)
    _advance(world, claims.LEASE_SECONDS + 1)          # A's lease lapses while A is still inside the model call

    b = asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))   # B takes over and completes
    assert b["was_generated"] is True and len(world.db.charges) == 1

    release_a.set()                                    # A finally returns and tries to commit
    thread.join(20)

    assert isinstance(outcome["a"], ShiftSummaryClaimLost)
    assert len(world.db.charges) == 1 and len(world.db.rows["shift_summaries"]) == 1
    assert world.model.calls == 2                      # A's call was wasted, but not billed
    assert world.store.rows[(HOTEL, SHIFT, DAY)]["status"] == "succeeded"


def test_heartbeat_renews_the_lease_so_a_slow_call_still_commits(world, monkeypatch):
    monkeypatch.setattr(claims, "LEASE_SECONDS", 1)
    monkeypatch.setattr(claims, "HEARTBEAT_SECONDS", 0.2)
    world.model.delay = 1.6                            # longer than the 1s lease: only renewal can save it

    result = asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))

    renewals = [c for c in world.store.calls if c[0] == "renew_shift_summary_claim"]
    assert result["was_generated"] is True and len(renewals) >= 3
    assert len(world.db.charges) == 1 and world.model.calls == 1


def test_without_renewal_the_same_slow_call_is_discarded_not_double_charged(world, monkeypatch):
    monkeypatch.setattr(claims, "LEASE_SECONDS", 1)
    monkeypatch.setattr(claims, "HEARTBEAT_SECONDS", 3600)   # effectively no heartbeat
    world.model.delay = 1.4

    with pytest.raises(ShiftSummaryClaimLost):
        asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    assert world.db.charges == [] and world.db.rows["shift_summaries"] == []


def test_regenerate_is_a_deliberate_second_generation_with_its_own_charge(world):
    asyncio.run(summary.generate_or_get_shift_summary(HOTEL, SHIFT, DAY))
    world.db.rows["shift_summaries"][0].update(acknowledged_by="u1", acknowledged_at="2026-09-16T10:00:00+00:00")

    again = asyncio.run(summary.regenerate_shift_summary(HOTEL, SHIFT, DAY, user_id="gm-1"))

    assert again["was_generated"] is True and len(world.db.rows["shift_summaries"]) == 1
    assert world.db.rows["shift_summaries"][0]["acknowledged_by"] is None
    assert world.model.calls == 2 and len(world.db.charges) == 2


def test_replayed_finalize_for_the_same_generation_does_not_charge_again(world):
    claim = claims.acquire_claim(HOTEL, SHIFT, DAY, replace_existing=False, ignore_retry_limits=False)
    payload = {"department_id": None, "summary_text": "x", "stats": {}, "handoff_data": {},
               "generated_at": "2026-09-16T10:00:00+00:00"}
    first = claims.finalize_claim(HOTEL, SHIFT, DAY, claim, summary=payload, credits=1.0, replace_existing=False)
    replay = claims.finalize_claim(HOTEL, SHIFT, DAY, claim, summary=payload, credits=1.0, replace_existing=False)
    assert first["finalized"] is True and replay == {"finalized": False, "reason": "already_finalized"}
    assert len(world.db.charges) == 1


# --- manual endpoint contract ---------------------------------------------------------------------------------------

def test_manual_generate_returns_409_not_a_second_paid_call_while_another_request_holds_the_claim(world, monkeypatch):
    world.db.rows["shifts"][0].update(id=SHIFT, department_id="dept-1")
    held = claims.acquire_claim(HOTEL, SHIFT, DAY, replace_existing=False, ignore_retry_limits=False)
    assert held is not None
    monkeypatch.setattr(logbook_router, "supabase", world.db)
    client = TestClient(app)

    response = client.post("/v1/logbook/shift-summary/generate",
                           json={"shift_id": SHIFT, "shift_date": DAY},
                           headers=_auth_header("gm", hotel_id=HOTEL))

    assert response.status_code == 409
    assert world.model.calls == 0 and world.db.charges == []
