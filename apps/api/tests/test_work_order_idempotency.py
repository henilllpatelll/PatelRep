"""POST /work-orders idempotency: a retry after a lost response never duplicates.

The mobile offline queue replays creates with a client-generated `client_request_id`.
Replays are scoped to (tenant, creator); clients that send no key behave as before.
"""

import threading
import uuid

import pytest

from middleware.auth import CurrentUser
from models.requests import CreateWorkOrderRequest
from routers import work_orders as work_orders_router
from tests.smoke.fake_supabase import FakeDB

HOUSEKEEPER = CurrentUser(user_id="hk-1", hotel_id="hotel-1", role="housekeeper", email="hk@example.com")
OTHER_USER = CurrentUser(user_id="hk-2", hotel_id="hotel-1", role="housekeeper", email="hk2@example.com")
OTHER_HOTEL = CurrentUser(user_id="hk-1", hotel_id="hotel-2", role="housekeeper", email="hk@example.com")

INDEX = [("work_orders", "work_orders_client_request_uniq", ("tenant_id", "created_by", "client_request_id"), {})]


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB({}, unique_indexes=INDEX)
    monkeypatch.setattr(work_orders_router, "supabase", fake)
    return fake


def _request(key=None, **overrides):
    body = {"title": "Sink leaking", "category": "plumbing", "priority": "normal"}
    if key:
        body["client_request_id"] = key
    body.update(overrides)
    return CreateWorkOrderRequest(**body)


@pytest.mark.asyncio
async def test_retry_with_same_key_returns_original_work_order(db):
    key = str(uuid.uuid4())
    first = await work_orders_router.create_work_order(_request(key), HOUSEKEEPER)
    retry = await work_orders_router.create_work_order(_request(key), HOUSEKEEPER)
    assert retry["data"]["id"] == first["data"]["id"]
    assert retry["idempotent_replay"] is True and "idempotent_replay" not in first
    assert len(db.rows["work_orders"]) == 1


@pytest.mark.asyncio
async def test_first_attempt_stores_the_key(db):
    key = str(uuid.uuid4())
    await work_orders_router.create_work_order(_request(key), HOUSEKEEPER)
    assert db.rows["work_orders"][0]["client_request_id"] == key


@pytest.mark.asyncio
async def test_replay_skips_revalidation_so_a_changed_room_cannot_break_it(db, monkeypatch):
    key = str(uuid.uuid4())
    await work_orders_router.create_work_order(_request(key), HOUSEKEEPER)

    def boom(*_a, **_k):
        raise AssertionError("replay must not re-validate or re-insert")

    monkeypatch.setattr(work_orders_router, "_validate_work_order_references", boom)
    retry = await work_orders_router.create_work_order(_request(key), HOUSEKEEPER)
    assert retry["idempotent_replay"] is True
    assert len(db.rows["work_orders"]) == 1


@pytest.mark.asyncio
async def test_same_key_from_another_user_is_a_separate_work_order(db):
    key = str(uuid.uuid4())
    mine = await work_orders_router.create_work_order(_request(key), HOUSEKEEPER)
    theirs = await work_orders_router.create_work_order(_request(key), OTHER_USER)
    assert theirs["data"]["id"] != mine["data"]["id"]
    assert "idempotent_replay" not in theirs  # never leaks the other user's row


@pytest.mark.asyncio
async def test_same_key_in_another_hotel_is_a_separate_work_order(db):
    key = str(uuid.uuid4())
    mine = await work_orders_router.create_work_order(_request(key), HOUSEKEEPER)
    other = await work_orders_router.create_work_order(_request(key), OTHER_HOTEL)
    assert other["data"]["id"] != mine["data"]["id"]
    assert other["data"]["tenant_id"] == "hotel-2"


@pytest.mark.asyncio
async def test_requests_without_a_key_behave_as_before(db):
    a = await work_orders_router.create_work_order(_request(), HOUSEKEEPER)
    b = await work_orders_router.create_work_order(_request(), HOUSEKEEPER)
    assert a["data"]["id"] != b["data"]["id"]
    assert len(db.rows["work_orders"]) == 2
    assert all("client_request_id" not in row for row in db.rows["work_orders"])


@pytest.mark.asyncio
async def test_different_keys_make_different_work_orders(db):
    a = await work_orders_router.create_work_order(_request(str(uuid.uuid4())), HOUSEKEEPER)
    b = await work_orders_router.create_work_order(_request(str(uuid.uuid4())), HOUSEKEEPER)
    assert a["data"]["id"] != b["data"]["id"]


def test_key_must_be_a_uuid4():
    with pytest.raises(ValueError):
        _request("not-a-uuid")


@pytest.mark.asyncio
async def test_concurrent_duplicates_collapse_to_one_work_order(db, monkeypatch):
    """Both copies pass the replay lookup before either inserts; the index picks one."""
    key = str(uuid.uuid4())
    barrier = threading.Barrier(2, timeout=10)
    original = work_orders_router._validate_work_order_references

    def gated(*args, **kwargs):
        original(*args, **kwargs)
        barrier.wait()

    monkeypatch.setattr(work_orders_router, "_validate_work_order_references", gated)
    results: list = [None, None]

    def run(i):
        import asyncio

        results[i] = asyncio.run(work_orders_router.create_work_order(_request(key), HOUSEKEEPER))

    threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
        assert not t.is_alive()
    assert len(db.rows["work_orders"]) == 1
    assert results[0]["data"]["id"] == results[1]["data"]["id"]
    assert sum(1 for r in results if r.get("idempotent_replay")) == 1


@pytest.mark.asyncio
async def test_unrelated_insert_errors_are_not_swallowed(db, monkeypatch):
    original = db.table

    def broken(name):
        query = original(name)
        if name == "work_orders":
            real = query.execute

            def execute():
                if query.action == "insert":
                    raise RuntimeError("connection reset")
                return real()

            query.execute = execute
        return query

    monkeypatch.setattr(db, "table", broken)
    with pytest.raises(RuntimeError):
        await work_orders_router.create_work_order(_request(str(uuid.uuid4())), HOUSEKEEPER)
