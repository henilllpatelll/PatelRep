"""Phase 15 contract tests for work-order bulk-archive.

Archiving is orthogonal to the operational status state machine: it is a
nullable timestamp/actor pair, not a new status value. These tests prove the
archive/unarchive contract (RBAC, tenant isolation, non-archivable rejection,
audit logging, and default-list exclusion) end to end against a fake
Supabase query builder that mirrors test_work_order_transitions.py's pattern.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser, require_role
from models.requests import (
    BulkArchiveByAgeRequest,
    BulkArchiveWorkOrdersRequest,
    BulkUnarchiveWorkOrdersRequest,
)
from routers import work_orders as work_orders_router

# ---------------------------------------------------------------------------
# Fixed UUIDv4 ids for seeded work orders
# ---------------------------------------------------------------------------

WO_COMPLETED_ID = str(uuid.uuid4())
WO_OPEN_ID = str(uuid.uuid4())
WO_OTHER_TENANT_ID = str(uuid.uuid4())
WO_OLD_COMPLETED_ID = str(uuid.uuid4())
WO_RECENT_COMPLETED_ID = str(uuid.uuid4())
WO_ALREADY_ARCHIVED_ID = str(uuid.uuid4())

_NOW = datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


ENGINEER = CurrentUser(user_id="engineer-1", hotel_id="hotel-1", role="engineer", email="engineer@example.com")
GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com")


# ---------------------------------------------------------------------------
# Fake Supabase query builder — extends the _TransitionQuery/_TransitionDatabase
# pattern with .in_(), .is_()/.not_.is_(), .update(), and list-or-dict .insert()
# ---------------------------------------------------------------------------


class _NotProxy:
    def __init__(self, query: "_ArchiveQuery"):
        self._query = query

    def is_(self, column: str, _value: str):
        self._query.filters.append(("not_null", column))
        return self._query


class _ArchiveQuery:
    def __init__(self, database: "_ArchiveDatabase", table: str):
        self.database = database
        self.table_name = table
        self.filters: list[tuple] = []
        self._update_payload: dict | None = None
        self._insert_payload = None
        self._maybe_single = False

    # --- filter chain -----------------------------------------------------
    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column: str, value):
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column: str, values):
        self.filters.append(("in", column, list(values)))
        return self

    def is_(self, column: str, _value: str):
        self.filters.append(("null", column))
        return self

    @property
    def not_(self):
        return _NotProxy(self)

    def lt(self, column: str, value):
        self.filters.append(("lt", column, value))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def maybe_single(self):
        self._maybe_single = True
        return self

    def update(self, payload: dict):
        self._update_payload = payload
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    # --- execution ----------------------------------------------------------
    def _matches(self) -> list[dict]:
        rows = self.database.tables.get(self.table_name, [])
        matched = []
        for row in rows:
            ok = True
            for f in self.filters:
                kind = f[0]
                if kind == "eq":
                    _, column, value = f
                    if row.get(column) != value:
                        ok = False
                        break
                elif kind == "in":
                    _, column, values = f
                    if row.get(column) not in values:
                        ok = False
                        break
                elif kind == "null":
                    _, column = f
                    if row.get(column) is not None:
                        ok = False
                        break
                elif kind == "not_null":
                    _, column = f
                    if row.get(column) is None:
                        ok = False
                        break
                elif kind == "lt":
                    _, column, value = f
                    if row.get(column) is None or not (row.get(column) < value):
                        ok = False
                        break
            if ok:
                matched.append(row)
        return matched

    def execute(self):
        if self._insert_payload is not None:
            rows = (
                self._insert_payload
                if isinstance(self._insert_payload, list)
                else [self._insert_payload]
            )
            self.database.tables.setdefault(self.table_name, []).extend(rows)
            return type("Result", (), {"data": rows})()

        if self._update_payload is not None:
            matched = self._matches()
            for row in matched:
                row.update(self._update_payload)
            return type("Result", (), {"data": matched})()

        matched = self._matches()
        if self._maybe_single:
            return type("Result", (), {"data": matched[0] if matched else None})()
        return type("Result", (), {"data": matched})()


class _ArchiveDatabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "work_orders": [
                {
                    "id": WO_COMPLETED_ID,
                    "tenant_id": "hotel-1",
                    "status": "completed",
                    "created_at": _iso(_NOW - timedelta(days=365)),
                    "completed_at": _iso(_NOW - timedelta(days=365)),
                    "archived_at": None,
                    "archived_by": None,
                },
                {
                    "id": WO_OPEN_ID,
                    "tenant_id": "hotel-1",
                    "status": "open",
                    "created_at": _iso(_NOW - timedelta(days=1)),
                    "completed_at": None,
                    "archived_at": None,
                    "archived_by": None,
                },
                {
                    "id": WO_OTHER_TENANT_ID,
                    "tenant_id": "hotel-2",
                    "status": "completed",
                    "created_at": _iso(_NOW - timedelta(days=365)),
                    "completed_at": _iso(_NOW - timedelta(days=365)),
                    "archived_at": None,
                    "archived_by": None,
                },
                {
                    "id": WO_OLD_COMPLETED_ID,
                    "tenant_id": "hotel-1",
                    "status": "completed",
                    "created_at": _iso(_NOW - timedelta(days=60)),
                    "completed_at": _iso(_NOW - timedelta(days=60)),
                    "archived_at": None,
                    "archived_by": None,
                },
                {
                    "id": WO_RECENT_COMPLETED_ID,
                    "tenant_id": "hotel-1",
                    "status": "completed",
                    "created_at": _iso(_NOW - timedelta(days=5)),
                    "completed_at": _iso(_NOW - timedelta(days=5)),
                    "archived_at": None,
                    "archived_by": None,
                },
                {
                    "id": WO_ALREADY_ARCHIVED_ID,
                    "tenant_id": "hotel-1",
                    "status": "completed",
                    "created_at": _iso(_NOW - timedelta(days=100)),
                    "completed_at": _iso(_NOW - timedelta(days=100)),
                    "archived_at": _iso(_NOW - timedelta(days=1)),
                    "archived_by": "gm-1",
                },
            ]
        }

    def table(self, table_name: str):
        return _ArchiveQuery(self, table_name)


# ---------------------------------------------------------------------------
# Bulk-archive (explicit selection)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_archive_sets_archived_at_and_writes_one_audit_row_per_work_order(monkeypatch):
    database = _ArchiveDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    response = await work_orders_router.bulk_archive_work_orders(
        BulkArchiveWorkOrdersRequest(work_order_ids=[WO_COMPLETED_ID]),
        ENGINEER,
    )

    assert response["data"]["archived_count"] == 1
    wo = next(r for r in database.tables["work_orders"] if r["id"] == WO_COMPLETED_ID)
    assert wo["archived_at"] is not None
    assert wo["archived_by"] == "engineer-1"

    audit_rows = database.tables["operational_audit_events"]
    assert len(audit_rows) == 1
    assert audit_rows[0]["action"] == "work_order.archived"
    assert audit_rows[0]["resource_type"] == "work_order"
    assert audit_rows[0]["resource_id"] == WO_COMPLETED_ID
    assert audit_rows[0]["actor_role"] == "engineer"


@pytest.mark.asyncio
async def test_bulk_archive_rejects_non_archivable_status(monkeypatch):
    database = _ArchiveDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    with pytest.raises(HTTPException) as exc:
        await work_orders_router.bulk_archive_work_orders(
            BulkArchiveWorkOrdersRequest(work_order_ids=[WO_OPEN_ID]),
            ENGINEER,
        )

    assert exc.value.status_code == 409
    wo = next(r for r in database.tables["work_orders"] if r["id"] == WO_OPEN_ID)
    assert wo["archived_at"] is None
    assert database.tables.get("operational_audit_events", []) == []


@pytest.mark.asyncio
async def test_bulk_archive_rejects_cross_tenant_ids(monkeypatch):
    database = _ArchiveDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    with pytest.raises(HTTPException) as exc:
        await work_orders_router.bulk_archive_work_orders(
            BulkArchiveWorkOrdersRequest(work_order_ids=[WO_OTHER_TENANT_ID]),
            ENGINEER,
        )

    assert exc.value.status_code == 404
    wo = next(r for r in database.tables["work_orders"] if r["id"] == WO_OTHER_TENANT_ID)
    assert wo["archived_at"] is None
    assert database.tables.get("operational_audit_events", []) == []


# ---------------------------------------------------------------------------
# Bulk-archive by age
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_archive_by_age_only_archives_completed_older_than_cutoff(monkeypatch):
    database = _ArchiveDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    response = await work_orders_router.bulk_archive_work_orders_by_age(
        BulkArchiveByAgeRequest(older_than_days=30),
        GM,
    )

    # WO_COMPLETED_ID (365 days old) and WO_OLD_COMPLETED_ID (60 days old) both
    # qualify as completed + older than the 30-day cutoff; WO_RECENT_COMPLETED_ID
    # (5 days old) must not.
    old_wo = next(r for r in database.tables["work_orders"] if r["id"] == WO_OLD_COMPLETED_ID)
    very_old_wo = next(r for r in database.tables["work_orders"] if r["id"] == WO_COMPLETED_ID)
    recent_wo = next(r for r in database.tables["work_orders"] if r["id"] == WO_RECENT_COMPLETED_ID)
    assert old_wo["archived_at"] is not None
    assert very_old_wo["archived_at"] is not None
    assert recent_wo["archived_at"] is None
    assert response["data"]["archived_count"] == 2

    audit_rows = [
        r
        for r in database.tables["operational_audit_events"]
        if r["resource_id"] == WO_OLD_COMPLETED_ID
    ]
    assert len(audit_rows) == 1
    assert audit_rows[0]["reason_code"] == "bulk_by_age"


# ---------------------------------------------------------------------------
# list_work_orders excludes archived rows by default
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["engineer", "gm"])
@pytest.mark.asyncio
async def test_list_work_orders_excludes_archived_by_default(monkeypatch, role: str):
    database = _ArchiveDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    user = CurrentUser(user_id="u1", hotel_id="hotel-1", role=role, email=f"{role}@example.com")
    result = await work_orders_router.list_work_orders(
        status=None,
        category=None,
        priority=None,
        assigned_to=None,
        room_id=None,
        q=None,
        page=1,
        per_page=20,
        archived=False,
        current_user=user,
    )

    ids = {row["id"] for row in result["data"]}
    assert WO_ALREADY_ARCHIVED_ID not in ids


# ---------------------------------------------------------------------------
# RBAC — non-management roles are blocked from the bulk endpoints
# ---------------------------------------------------------------------------

_NON_MANAGEMENT_ROLES = ["housekeeper", "housekeeping_supervisor", "front_desk"]


@pytest.mark.parametrize("role", _NON_MANAGEMENT_ROLES)
@pytest.mark.asyncio
async def test_non_management_roles_are_blocked_from_archive_endpoints(role: str):
    check = require_role("engineer", "gm")
    with pytest.raises(HTTPException) as exc:
        await check(
            current_user=CurrentUser(
                user_id="u1", hotel_id="hotel-1", role=role, email=f"{role}@example.com"
            )
        )
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Bulk-unarchive
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_unarchive_clears_archived_at_and_writes_audit_row(monkeypatch):
    database = _ArchiveDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    response = await work_orders_router.bulk_unarchive_work_orders(
        BulkUnarchiveWorkOrdersRequest(work_order_ids=[WO_ALREADY_ARCHIVED_ID]),
        GM,
    )

    wo = next(r for r in database.tables["work_orders"] if r["id"] == WO_ALREADY_ARCHIVED_ID)
    assert wo["archived_at"] is None
    assert wo["archived_by"] is None
    assert response["data"]["unarchived_count"] == 1

    audit_rows = database.tables["operational_audit_events"]
    assert len(audit_rows) == 1
    assert audit_rows[0]["action"] == "work_order.unarchived"
    assert audit_rows[0]["resource_id"] == WO_ALREADY_ARCHIVED_ID


@pytest.mark.asyncio
async def test_bulk_unarchive_rejects_cross_tenant_ids(monkeypatch):
    database = _ArchiveDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)
    # seed an archived row that belongs to another tenant
    database.tables["work_orders"].append(
        {
            "id": WO_OTHER_TENANT_ID,
            "tenant_id": "hotel-2",
            "status": "completed",
            "completed_at": _iso(_NOW - timedelta(days=100)),
            "archived_at": _iso(_NOW - timedelta(days=1)),
            "archived_by": "someone-else",
        }
    )

    with pytest.raises(HTTPException) as exc:
        await work_orders_router.bulk_unarchive_work_orders(
            BulkUnarchiveWorkOrdersRequest(work_order_ids=[WO_OTHER_TENANT_ID]),
            ENGINEER,
        )

    assert exc.value.status_code == 404
    assert database.tables.get("operational_audit_events", []) == []


@pytest.mark.asyncio
async def test_full_archive_unarchive_round_trip_is_reconstructable_from_audit_events(monkeypatch):
    database = _ArchiveDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    await work_orders_router.bulk_archive_work_orders(
        BulkArchiveWorkOrdersRequest(work_order_ids=[WO_COMPLETED_ID]),
        ENGINEER,
    )

    active = await work_orders_router.list_work_orders(
        status=None, category=None, priority=None, assigned_to=None, room_id=None,
        q=None, page=1, per_page=20, archived=False, current_user=GM,
    )
    archived = await work_orders_router.list_work_orders(
        status=None, category=None, priority=None, assigned_to=None, room_id=None,
        q=None, page=1, per_page=20, archived=True, current_user=GM,
    )
    assert WO_COMPLETED_ID not in {r["id"] for r in active["data"]}
    assert WO_COMPLETED_ID in {r["id"] for r in archived["data"]}

    await work_orders_router.bulk_unarchive_work_orders(
        BulkUnarchiveWorkOrdersRequest(work_order_ids=[WO_COMPLETED_ID]),
        ENGINEER,
    )

    active_after = await work_orders_router.list_work_orders(
        status=None, category=None, priority=None, assigned_to=None, room_id=None,
        q=None, page=1, per_page=20, archived=False, current_user=GM,
    )
    archived_after = await work_orders_router.list_work_orders(
        status=None, category=None, priority=None, assigned_to=None, room_id=None,
        q=None, page=1, per_page=20, archived=True, current_user=GM,
    )
    assert WO_COMPLETED_ID in {r["id"] for r in active_after["data"]}
    assert WO_COMPLETED_ID not in {r["id"] for r in archived_after["data"]}

    events = [
        e
        for e in database.tables["operational_audit_events"]
        if e["resource_id"] == WO_COMPLETED_ID
    ]
    assert [e["action"] for e in events] == ["work_order.archived", "work_order.unarchived"]
