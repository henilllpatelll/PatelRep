import io
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import UploadFile

from middleware.auth import CurrentUser
from models.requests import CreateAssignmentsRequest
from routers import housekeeping as housekeeping_router
from services.opera_pdf import HKDetailsRow, TaskSheetRow


SUPERVISOR = CurrentUser(
    user_id="11111111-1111-4111-8111-111111111111",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="housekeeping_supervisor",
    email="sup@example.com",
)


class FakeDB:
    def __init__(self, rows=None, missing_room_status_clean_type=False):
        self.rows = rows or {}
        self.upserts = []
        self.updates = []
        self.inserts = []
        self.deletes = []
        self.missing_room_status_clean_type = missing_room_status_clean_type

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.action = "select"
        self.payload = None
        self.filters = []
        self.in_filters = []
        self.gte_filters = []
        self.lt_filters = []
        self.like_filters = []
        self.orders = []
        self.limit_count = None
        self.single = False
        self.conflict_columns = []

    def select(self, *_args, **_kwargs):
        self.action = "select"
        return self

    def update(self, payload):
        self.action = "update"
        self.payload = payload
        return self

    def insert(self, payload):
        self.action = "insert"
        self.payload = payload
        return self

    def delete(self):
        self.action = "delete"
        return self

    def upsert(self, payload, on_conflict=None, **_kwargs):
        self.action = "upsert"
        self.payload = payload
        self.conflict_columns = [c.strip() for c in (on_conflict or "").split(",") if c.strip()]
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def in_(self, column, values):
        self.in_filters.append((column, set(values)))
        return self

    def gte(self, column, value):
        self.gte_filters.append((column, value))
        return self

    def lt(self, column, value):
        self.lt_filters.append((column, value))
        return self

    def like(self, column, pattern):
        self.like_filters.append((column, pattern))
        return self

    def limit(self, count, *_args, **_kwargs):
        self.limit_count = count
        return self

    def order(self, column, desc=False, **_kwargs):
        self.orders.append((column, desc))
        return self

    def maybe_single(self):
        self.single = True
        return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        matched = self._matched(rows)
        for column, desc in reversed(self.orders):
            matched = sorted(matched, key=lambda row: row.get(column) or "", reverse=desc)
        if self.limit_count is not None:
            matched = matched[:self.limit_count]

        if self.action == "select":
            return SimpleNamespace(data=matched[0] if self.single and matched else matched)

        if self.action == "update":
            if self._has_missing_clean_type_column_payload():
                raise Exception("Error 42703: column room_status.clean_type does not exist")
            for row in matched:
                row.update(self.payload)
            self.db.updates.append((self.table_name, dict(self.payload), dict(self.filters)))
            return SimpleNamespace(data=matched)

        if self.action == "upsert":
            if self._has_missing_clean_type_column_payload():
                raise Exception("Error 42703: column room_status.clean_type does not exist")
            payload_rows = self.payload if isinstance(self.payload, list) else [self.payload]
            saved = []
            for payload in payload_rows:
                assert isinstance(payload, dict)
                existing = next(
                    (
                        row for row in rows
                        if self.conflict_columns
                        and all(row.get(column) == payload.get(column) for column in self.conflict_columns)
                    ),
                    None,
                )
                if existing:
                    existing.update(payload)
                    saved.append(existing)
                else:
                    row = {"id": f"{self.table_name}-{len(rows) + 1}", **payload}
                    rows.append(row)
                    saved.append(row)
            self.db.upserts.append((self.table_name, payload_rows, tuple(self.conflict_columns)))
            return SimpleNamespace(data=saved)

        if self.action == "insert":
            payload_rows = self.payload if isinstance(self.payload, list) else [self.payload]
            saved = []
            for payload in payload_rows:
                assert isinstance(payload, dict)
                row = {"id": f"{self.table_name}-{len(rows) + 1}", **payload}
                rows.append(row)
                saved.append(row)
            self.db.inserts.append((self.table_name, payload_rows))
            return SimpleNamespace(data=saved)

        if self.action == "delete":
            deleted = list(matched)
            self.db.rows[self.table_name] = [row for row in rows if row not in deleted]
            self.db.deletes.append((self.table_name, dict(self.filters)))
            return SimpleNamespace(data=deleted)

        return SimpleNamespace(data=[])

    def _has_missing_clean_type_column_payload(self):
        if not self.db.missing_room_status_clean_type or self.table_name != "room_status":
            return False
        payload_rows = self.payload if isinstance(self.payload, list) else [self.payload]
        return any(isinstance(payload, dict) and "clean_type" in payload for payload in payload_rows)

    def _matched(self, rows):
        matched = rows
        for column, value in self.filters:
            matched = [row for row in matched if row.get(column) == value]
        for column, values in self.in_filters:
            matched = [row for row in matched if row.get(column) in values]
        for column, value in self.gte_filters:
            matched = [row for row in matched if (row.get(column) or "") >= value]
        for column, value in self.lt_filters:
            matched = [row for row in matched if (row.get(column) or "") < value]
        for column, pattern in self.like_filters:
            if pattern.endswith("%"):
                prefix = pattern[:-1]
                matched = [row for row in matched if str(row.get(column) or "").startswith(prefix)]
            else:
                matched = [row for row in matched if row.get(column) == pattern]
        return matched


@pytest.mark.asyncio
async def test_board_uses_selected_date_assignments_not_stale_room_status(monkeypatch):
    room_today = "22222222-2222-4222-8222-222222222222"
    room_unassigned_today = "33333333-3333-4333-8333-333333333333"
    hk_today = "44444444-4444-4444-8444-444444444444"
    hk_yesterday = "55555555-5555-4555-8555-555555555555"
    db = FakeDB({
        "room_status": [
            {
                "room_id": room_today,
                "tenant_id": SUPERVISOR.hotel_id,
                "assigned_to": hk_yesterday,
                "status": "DIRTY",
                "rooms": {"floor": 1, "room_number": "101"},
            },
            {
                "room_id": room_unassigned_today,
                "tenant_id": SUPERVISOR.hotel_id,
                "assigned_to": hk_yesterday,
                "status": "DIRTY",
                "rooms": {"floor": 1, "room_number": "102"},
            },
        ],
        "room_assignments": [
            {
                "id": "assign-today",
                "tenant_id": SUPERVISOR.hotel_id,
                "room_id": room_today,
                "assigned_to": hk_today,
                "shift_id": None,
                "assignment_date": "2026-05-24",
                "clean_type": "LIGHT",
            },
            {
                "id": "assign-yesterday",
                "tenant_id": SUPERVISOR.hotel_id,
                "room_id": room_unassigned_today,
                "assigned_to": hk_yesterday,
                "shift_id": None,
                "assignment_date": "2026-05-23",
            },
        ],
        "room_readiness_predictions": [],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.get_housekeeping_board(
        board_date=date(2026, 5, 24),
        shift_id=None,
        include_predictions=False,
        current_user=SUPERVISOR,
    )

    by_room = {row["room_id"]: row for row in response["data"]}
    assert by_room[room_today]["assigned_to"] == hk_today
    assert by_room[room_today]["assignment_id"] == "assign-today"
    assert by_room[room_today]["clean_type"] == "LIGHT"
    assert by_room[room_today]["status"] == "PICKUP"
    assert by_room[room_unassigned_today]["assigned_to"] is None
    assert by_room[room_unassigned_today]["assignment_id"] is None
    assert by_room[room_unassigned_today]["clean_type"] is None
    assert by_room[room_unassigned_today]["status"] == "DIRTY"


@pytest.mark.asyncio
async def test_board_includes_latest_note_and_open_work_order_for_room_cards(monkeypatch):
    room_id = "22222222-2222-4222-8222-222222222222"
    db = FakeDB({
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "assigned_to": None,
            "status": "DIRTY",
            "rooms": {"floor": 1, "room_number": "101"},
        }],
        "room_assignments": [],
        "room_readiness_predictions": [],
        "room_status_history": [
            {
                "room_id": room_id,
                "tenant_id": SUPERVISOR.hotel_id,
                "notes": "Old note",
                "from_status": "DIRTY",
                "to_status": "DIRTY",
                "changed_by": SUPERVISOR.user_id,
                "created_at": "2026-05-24T13:00:00+00:00",
            },
            {
                "room_id": room_id,
                "tenant_id": SUPERVISOR.hotel_id,
                "notes": "TV remote missing",
                "from_status": "DIRTY",
                "to_status": "DIRTY",
                "changed_by": SUPERVISOR.user_id,
                "created_at": "2026-05-24T14:00:00+00:00",
            },
            {
                "room_id": room_id,
                "tenant_id": SUPERVISOR.hotel_id,
                "notes": "Late-night staff note",
                "from_status": "DIRTY",
                "to_status": "DIRTY",
                "changed_by": SUPERVISOR.user_id,
                "created_at": "2026-05-25T02:30:00+00:00",
            },
            {
                "room_id": room_id,
                "tenant_id": SUPERVISOR.hotel_id,
                "notes": "Automated staff note",
                "from_status": "DIRTY",
                "to_status": "DIRTY",
                "changed_by": None,
                "created_at": "2026-05-24T14:30:00+00:00",
            },
            {
                "room_id": room_id,
                "tenant_id": SUPERVISOR.hotel_id,
                "notes": "Started cleaning",
                "from_status": "DIRTY",
                "to_status": "IN_PROGRESS",
                "changed_by": SUPERVISOR.user_id,
                "created_at": "2026-05-24T15:00:00+00:00",
            },
            {
                "room_id": room_id,
                "tenant_id": SUPERVISOR.hotel_id,
                "notes": "Realtime validation restored",
                "changed_by": SUPERVISOR.user_id,
                "created_at": "2026-05-25T03:00:00+00:00",
            },
            {
                "room_id": room_id,
                "tenant_id": SUPERVISOR.hotel_id,
                "notes": "Next day note",
                "from_status": "DIRTY",
                "to_status": "DIRTY",
                "changed_by": SUPERVISOR.user_id,
                "created_at": "2026-05-25T09:00:00+00:00",
            },
        ],
        "work_orders": [
            {
                "id": "wo-complete",
                "tenant_id": SUPERVISOR.hotel_id,
                "room_id": room_id,
                "work_order_number": 11,
                "title": "Completed old issue",
                "priority": "low",
                "status": "completed",
                "created_at": "2026-05-24T13:30:00+00:00",
            },
            {
                "id": "wo-open",
                "tenant_id": SUPERVISOR.hotel_id,
                "room_id": room_id,
                "work_order_number": 12,
                "title": "A/C not cooling",
                "priority": "urgent",
                "status": "open",
                "created_at": "2026-05-24T14:30:00+00:00",
            },
        ],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.get_housekeeping_board(
        board_date=date(2026, 5, 24),
        shift_id=None,
        include_predictions=False,
        current_user=SUPERVISOR,
    )

    room = response["data"][0]
    assert room["latest_note"] == "Late-night staff note"
    assert room["latest_note_at"] == "2026-05-25T02:30:00+00:00"
    assert room["open_work_order_id"] == "wo-open"
    assert room["open_work_order_number"] == 12
    assert room["open_work_order_title"] == "A/C not cooling"
    assert room["open_work_order_priority"] == "urgent"
    assert room["open_work_order_status"] == "open"


@pytest.mark.asyncio
async def test_create_assignments_reassigns_existing_room_for_same_day(monkeypatch):
    room_id = "22222222-2222-4222-8222-222222222222"
    old_hk = "55555555-5555-4555-8555-555555555555"
    new_hk = "44444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "101"}],
        "user_roles": [{
            "id": "role-1",
            "user_id": new_hk,
            "tenant_id": SUPERVISOR.hotel_id,
            "role": "housekeeper",
            "is_active": True,
        }],
        "room_assignments": [{
            "id": "assign-existing",
            "tenant_id": SUPERVISOR.hotel_id,
            "room_id": room_id,
            "assigned_to": old_hk,
            "assigned_by": "old-supervisor",
            "assignment_date": "2026-05-24",
        }],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "assigned_to": old_hk,
            "status": "DIRTY",
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    def fake_create_task(coro):
        coro.close()
        return None

    monkeypatch.setattr(housekeeping_router.asyncio, "create_task", fake_create_task)

    request = CreateAssignmentsRequest(
        date=date(2026, 5, 24),
        shift_id=None,
        assignments=[{"room_id": room_id, "housekeeper_id": new_hk, "clean_type": "FULL"}],
        is_ai_suggested=False,
    )

    response = await housekeeping_router.create_assignments(request, current_user=SUPERVISOR)

    assert response["data"][0]["id"] == "assign-existing"
    assert response["data"][0]["assigned_to"] == new_hk
    assert response["data"][0]["clean_type"] == "FULL"
    assert db.rows["room_assignments"][0]["assigned_to"] == new_hk
    assert db.rows["room_assignments"][0]["clean_type"] == "FULL"
    assert db.rows["room_assignments"][0]["assigned_by"] == SUPERVISOR.user_id
    assert db.rows["room_status"][0]["assigned_to"] == new_hk
    assert db.rows["room_status"][0]["status"] == "PICKUP"
    assert db.upserts[0][2] == ("room_id", "assignment_date")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("clean_type", "expected_status"),
    [("LIGHT", "PICKUP"), ("FULL", "PICKUP"), ("DEP", "DIRTY")],
)
async def test_create_assignments_maps_clean_type_to_room_status(
    monkeypatch,
    clean_type,
    expected_status,
):
    room_id = "22222222-2222-4222-8222-222222222222"
    hk_id = "44444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "101"}],
        "user_roles": [{
            "id": "role-1",
            "user_id": hk_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "role": "housekeeper",
            "is_active": True,
        }],
        "room_assignments": [],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "assigned_to": None,
            "status": "DIRTY" if clean_type in ("FULL", "LIGHT") else "PICKUP",
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    def fake_create_task(coro):
        coro.close()
        return None

    monkeypatch.setattr(housekeeping_router.asyncio, "create_task", fake_create_task)

    request = CreateAssignmentsRequest(
        date=date(2026, 5, 24),
        shift_id=None,
        assignments=[{"room_id": room_id, "housekeeper_id": hk_id, "clean_type": clean_type}],
        is_ai_suggested=False,
    )

    await housekeeping_router.create_assignments(request, current_user=SUPERVISOR)

    assert db.rows["room_assignments"][0]["clean_type"] == clean_type
    assert db.rows["room_status"][0]["assigned_to"] == hk_id
    assert db.rows["room_status"][0]["status"] == expected_status


@pytest.mark.asyncio
async def test_create_assignments_updates_occupied_full_clean_to_pickup(monkeypatch):
    room_id = "23232323-2323-4232-8232-232323232323"
    hk_id = "44444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "123"}],
        "user_roles": [{
            "id": "role-123",
            "user_id": hk_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "role": "housekeeper",
            "is_active": True,
        }],
        "room_assignments": [],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "assigned_to": None,
            "status": "OCCUPIED",
            "fo_status": "OCC",
            "clean_type": None,
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    def fake_create_task(coro):
        coro.close()
        return None

    monkeypatch.setattr(housekeeping_router.asyncio, "create_task", fake_create_task)

    request = CreateAssignmentsRequest(
        date=date(2026, 5, 24),
        shift_id=None,
        assignments=[{"room_id": room_id, "housekeeper_id": hk_id, "clean_type": "FULL"}],
        is_ai_suggested=False,
    )

    await housekeeping_router.create_assignments(request, current_user=SUPERVISOR)

    assert db.rows["room_assignments"][0]["clean_type"] == "FULL"
    assert db.rows["room_status"][0]["assigned_to"] == hk_id
    assert db.rows["room_status"][0]["status"] == "PICKUP"
    assert db.rows["room_status"][0]["clean_type"] == "FULL"


@pytest.mark.asyncio
async def test_create_assignments_keeps_working_before_room_status_clean_type_migration(monkeypatch):
    room_id = "99999999-9999-4999-8999-999999999999"
    hk_id = "44444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "assigned_to": None,
            "status": "DIRTY",
        }],
        "room_assignments": [],
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "109"}],
        "user_roles": [{
            "id": "role-109",
            "user_id": hk_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "role": "housekeeper",
            "is_active": True,
        }],
    }, missing_room_status_clean_type=True)
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(housekeeping_router, "_send_assignment_push", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(housekeeping_router.asyncio, "create_task", lambda *_args, **_kwargs: None)

    request = CreateAssignmentsRequest(
        date=date(2026, 5, 24),
        shift_id=None,
        assignments=[{"room_id": room_id, "housekeeper_id": hk_id, "clean_type": "FULL"}],
        is_ai_suggested=False,
    )

    await housekeeping_router.create_assignments(request, current_user=SUPERVISOR)

    assert db.rows["room_assignments"][0]["clean_type"] == "FULL"
    assert db.rows["room_status"][0]["assigned_to"] == hk_id
    assert db.rows["room_status"][0]["status"] == "PICKUP"
    assert "clean_type" not in db.rows["room_status"][0]


@pytest.mark.asyncio
async def test_hk_details_import_resets_stale_card_fields_and_import_markers(monkeypatch):
    room_id = "66666666-6666-4666-8666-666666666666"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "106"}],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "OCCUPIED",
            "fo_status": "OCC",
            "checkout_time": "2026-05-23T16:00:00+00:00",
            "actual_checkout_at": "2026-05-23T15:10:00+00:00",
            "checkin_time": "2026-05-23T21:00:00+00:00",
            "clean_type": "DEP",
            "guest_name": "Old Guest",
            "vip_flag": True,
            "dnd_flag": True,
            "do_not_service": True,
            "notes": "old room note",
        }],
        "room_status_history": [
            {
                "room_id": room_id,
                "tenant_id": SUPERVISOR.hotel_id,
                "notes": "task_sheet_clean_type=DEP",
                "created_at": "2026-05-24T12:00:00+00:00",
            },
            {
                "room_id": room_id,
                "tenant_id": SUPERVISOR.hotel_id,
                "notes": "stayover_override",
                "created_at": "2026-05-24T12:05:00+00:00",
            },
        ],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(
        housekeeping_router,
        "parse_hk_details",
        lambda _pdf: (
            [HKDetailsRow(
                room_number="106",
                raw_status="Dirty",
                our_status="DIRTY",
                fo_status="OCC",
                reservation_status="Due Out",
            )],
            [],
        ),
    )

    response = await housekeeping_router.import_hk_details(
        file=UploadFile(filename="hk-details.pdf", file=io.BytesIO(b"%PDF")),
        assignment_date="2026-05-24",
        current_user=SUPERVISOR,
    )

    status = db.rows["room_status"][0]
    assert response["data"]["applied"] == 1
    assert status["status"] == "OCCUPIED"
    assert status["checkout_time"] is None
    assert status["actual_checkout_at"] is None
    assert status["checkin_time"] is None
    assert status["clean_type"] is None
    assert status["guest_name"] is None
    assert status["vip_flag"] is False
    assert status["dnd_flag"] is False
    assert status["do_not_service"] is False
    assert status["notes"] is None
    assert db.rows["room_status_history"] == []


@pytest.mark.asyncio
async def test_task_sheet_import_keeps_occ_due_out_departure_occupied_dirty(monkeypatch):
    room_id = "22222222-2222-4222-8222-222222222222"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "101"}],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "OCCUPIED",
            "fo_status": "OCC",
        }],
        "room_assignments": [{
            "id": "assign-101",
            "tenant_id": SUPERVISOR.hotel_id,
            "room_id": room_id,
            "assigned_to": "44444444-4444-4444-8444-444444444444",
            "assigned_by": SUPERVISOR.user_id,
            "assignment_date": "2026-05-24",
            "clean_type": "FULL",
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(
        housekeeping_router,
        "parse_task_sheet",
        lambda _pdf: (
            [TaskSheetRow(
                room_number="101",
                fo_status="OCC",
                reservation_status="Due Out",
                guest_name="Guest",
                clean_type="DEP",
            )],
            [],
        ),
    )

    response = await housekeeping_router.import_task_sheet(
        file=UploadFile(filename="task-sheet.pdf", file=io.BytesIO(b"%PDF")),
        assignment_date="2026-05-24",
        current_user=SUPERVISOR,
    )

    assert response["data"]["applied"] == 1
    assert db.rows["room_status"][0]["status"] == "OCCUPIED"
    assert db.rows["room_status"][0]["fo_status"] == "OCC"
    assert db.rows["room_assignments"][0]["clean_type"] == "DEP"


@pytest.mark.asyncio
async def test_task_sheet_import_occ_stayover_with_light_task_becomes_pickup(monkeypatch):
    room_id = "33333333-3333-4333-8333-333333333333"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "102"}],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "DIRTY",
            "fo_status": "OCC",
        }],
        "room_assignments": [{
            "id": "assign-102",
            "tenant_id": SUPERVISOR.hotel_id,
            "room_id": room_id,
            "assigned_to": "44444444-4444-4444-8444-444444444444",
            "assigned_by": SUPERVISOR.user_id,
            "assignment_date": "2026-05-24",
            "clean_type": "DEP",
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(
        housekeeping_router,
        "parse_task_sheet",
        lambda _pdf: (
            [TaskSheetRow(
                room_number="102",
                fo_status="OCC",
                reservation_status="Stayover",
                guest_name="Guest",
                clean_type="LIGHT",
            )],
            [],
        ),
    )

    await housekeeping_router.import_task_sheet(
        file=UploadFile(filename="task-sheet.pdf", file=io.BytesIO(b"%PDF")),
        assignment_date="2026-05-24",
        current_user=SUPERVISOR,
    )

    assert db.rows["room_status"][0]["status"] == "PICKUP"
    assert db.rows["room_assignments"][0]["clean_type"] == "LIGHT"


@pytest.mark.asyncio
async def test_task_sheet_import_occ_stayover_no_task_still_becomes_pickup(monkeypatch):
    """DI + OCC + Stayover is always PICKUP, even when the task column is blank."""
    room_id = "55555555-5555-4555-8555-555555555555"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "105"}],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "DIRTY",
            "fo_status": "OCC",
        }],
        "room_assignments": [],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(
        housekeeping_router,
        "parse_task_sheet",
        lambda _pdf: (
            [TaskSheetRow(
                room_number="105",
                fo_status="OCC",
                reservation_status="Stayover",
                guest_name="Guest",
                clean_type=None,
            )],
            [],
        ),
    )

    await housekeeping_router.import_task_sheet(
        file=UploadFile(filename="task-sheet.pdf", file=io.BytesIO(b"%PDF")),
        assignment_date="2026-05-24",
        current_user=SUPERVISOR,
    )

    assert db.rows["room_status"][0]["status"] == "PICKUP"
    assert db.rows["room_status"][0]["fo_status"] == "OCC"
    # history written even without clean_type
    assert len(db.rows["room_status_history"]) == 1
    assert db.rows["room_status_history"][0]["to_status"] == "PICKUP"


@pytest.mark.asyncio
async def test_task_sheet_import_stores_clean_type_without_assignment(monkeypatch):
    room_id = "77777777-7777-4777-8777-777777777777"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "107"}],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "DIRTY",
            "fo_status": "OCC",
        }],
        "room_assignments": [],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(
        housekeeping_router,
        "parse_task_sheet",
        lambda _pdf: (
            [TaskSheetRow(
                room_number="107",
                fo_status="OCC",
                reservation_status="Due Out",
                guest_name="Guest",
                clean_type="DEP",
            )],
            [],
        ),
    )

    await housekeeping_router.import_task_sheet(
        file=UploadFile(filename="task-sheet.pdf", file=io.BytesIO(b"%PDF")),
        assignment_date="2026-05-24",
        current_user=SUPERVISOR,
    )

    assert db.rows["room_status"][0]["status"] == "OCCUPIED"
    assert db.rows["room_status"][0]["fo_status"] == "OCC"
    assert db.rows["room_status"][0]["clean_type"] == "DEP"
    assert db.rows["room_assignments"] == []


@pytest.mark.asyncio
async def test_task_sheet_import_clears_stale_stayover_override_marker(monkeypatch):
    room_id = "78787878-7878-4878-8878-787878787878"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "178"}],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "OCCUPIED",
            "fo_status": "OCC",
            "clean_type": None,
        }],
        "room_assignments": [],
        "room_status_history": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "notes": "stayover_override",
            "created_at": "2026-05-24T12:00:00+00:00",
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(
        housekeeping_router,
        "parse_task_sheet",
        lambda _pdf: (
            [TaskSheetRow(
                room_number="178",
                fo_status="OCC",
                reservation_status="Due Out",
                guest_name="Guest",
                clean_type="DEP",
            )],
            [],
        ),
    )

    await housekeeping_router.import_task_sheet(
        file=UploadFile(filename="task-sheet.pdf", file=io.BytesIO(b"%PDF")),
        assignment_date="2026-05-24",
        current_user=SUPERVISOR,
    )

    notes = [row.get("notes") for row in db.rows["room_status_history"]]
    assert "stayover_override" not in notes
    assert db.rows["room_status"][0]["clean_type"] == "DEP"


@pytest.mark.asyncio
async def test_task_sheet_import_retries_room_status_without_clean_type_when_column_missing(monkeypatch):
    room_id = "88888888-8888-4888-8888-888888888888"
    db = FakeDB({
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "108"}],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "DIRTY",
            "fo_status": "OCC",
        }],
        "room_assignments": [],
    }, missing_room_status_clean_type=True)
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(
        housekeeping_router,
        "parse_task_sheet",
        lambda _pdf: (
            [TaskSheetRow(
                room_number="108",
                fo_status="OCC",
                reservation_status="Due Out",
                guest_name="Guest",
                clean_type="DEP",
            )],
            [],
        ),
    )

    await housekeeping_router.import_task_sheet(
        file=UploadFile(filename="task-sheet.pdf", file=io.BytesIO(b"%PDF")),
        assignment_date="2026-05-24",
        current_user=SUPERVISOR,
    )

    assert db.rows["room_status"][0]["status"] == "OCCUPIED"
    assert db.rows["room_status"][0]["fo_status"] == "OCC"
    assert "clean_type" not in db.rows["room_status"][0]
    assert db.rows["room_status_history"][0]["notes"] == "task_sheet_clean_type=DEP"


def test_missing_clean_type_column_detection_handles_postgrest_schema_cache_error():
    exc = Exception("PGRST204: Could not find the 'clean_type' column of 'room_status' in the schema cache")

    assert housekeeping_router._is_missing_clean_type_column_error(exc)


@pytest.mark.asyncio
async def test_board_uses_task_sheet_history_clean_type_when_room_status_column_missing(monkeypatch):
    room_id = "12121212-1212-4212-8212-121212121212"
    db = FakeDB({
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "PICKUP",
            "fo_status": "OCC",
            "rooms": {"floor": 1, "room_number": "121"},
        }],
        "room_assignments": [],
        "room_readiness_predictions": [],
        "room_status_history": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "notes": "task_sheet_clean_type=LIGHT",
            "from_status": "DIRTY",
            "to_status": "PICKUP",
            "changed_by": SUPERVISOR.user_id,
            "change_source": "system",
            "created_at": "2026-05-24T14:00:00+00:00",
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.get_housekeeping_board(
        board_date=date(2026, 5, 24),
        shift_id=None,
        include_predictions=False,
        current_user=SUPERVISOR,
    )

    room = response["data"][0]
    assert room["status"] == "PICKUP"
    assert room["clean_type"] == "LIGHT"
    assert room["clean_type_label"] == "Light Service"
    assert room.get("latest_note") is None


@pytest.mark.asyncio
async def test_board_uses_imported_clean_type_when_room_is_unassigned(monkeypatch):
    departure_room = "88888888-8888-4888-8888-888888888888"
    pickup_room = "99999999-9999-4999-8999-999999999999"
    db = FakeDB({
        "room_status": [
            {
                "room_id": departure_room,
                "tenant_id": SUPERVISOR.hotel_id,
                "status": "DIRTY",
                "fo_status": "OCC",
                "clean_type": "DEP",
                "rooms": {"floor": 1, "room_number": "108"},
            },
            {
                "room_id": pickup_room,
                "tenant_id": SUPERVISOR.hotel_id,
                "status": "DIRTY",
                "fo_status": "OCC",
                "clean_type": "FULL",
                "rooms": {"floor": 1, "room_number": "109"},
            },
        ],
        "room_assignments": [],
        "room_readiness_predictions": [],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.get_housekeeping_board(
        board_date=date(2026, 5, 24),
        shift_id=None,
        include_predictions=False,
        current_user=SUPERVISOR,
    )

    by_room = {row["room_id"]: row for row in response["data"]}
    assert by_room[departure_room]["status"] == "OCCUPIED"
    assert by_room[departure_room]["clean_type"] == "DEP"
    assert by_room[departure_room]["clean_type_label"] == "Departure Clean"
    assert by_room[pickup_room]["status"] == "PICKUP"
    assert by_room[pickup_room]["clean_type"] == "FULL"
    assert by_room[pickup_room]["clean_type_label"] == "Full Linen Change"


@pytest.mark.asyncio
async def test_delete_assignment_removes_row_and_clears_status_assignee(monkeypatch):
    assignment_id = "assign-existing"
    room_id = "22222222-2222-4222-8222-222222222222"
    hk_id = "44444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "room_assignments": [{
            "id": assignment_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "room_id": room_id,
            "assigned_to": hk_id,
            "assigned_by": "old-supervisor",
            "assignment_date": "2026-05-24",
        }],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "assigned_to": hk_id,
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.delete_assignment(
        assignment_id,
        current_user=SUPERVISOR,
    )

    assert response == {"data": {"success": True, "deleted_id": assignment_id}}
    assert db.rows["room_assignments"] == []
    assert db.rows["room_status"][0]["assigned_to"] is None
    assert db.deletes[0] == ("room_assignments", {"id": assignment_id, "tenant_id": SUPERVISOR.hotel_id})


@pytest.mark.asyncio
async def test_delete_assignment_clears_manual_occupied_clean_type(monkeypatch):
    assignment_id = "assign-manual-clean"
    room_id = "24242424-2424-4242-8242-242424242424"
    hk_id = "44444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "room_assignments": [{
            "id": assignment_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "room_id": room_id,
            "assigned_to": hk_id,
            "assigned_by": SUPERVISOR.user_id,
            "assignment_date": "2026-05-24",
            "clean_type": "FULL",
        }],
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "assigned_to": hk_id,
            "status": "PICKUP",
            "fo_status": "OCC",
            "clean_type": "FULL",
        }],
        "room_status_history": [],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.delete_assignment(
        assignment_id,
        current_user=SUPERVISOR,
    )

    assert response == {"data": {"success": True, "deleted_id": assignment_id}}
    assert db.rows["room_assignments"] == []
    assert db.rows["room_status"][0]["assigned_to"] is None
    assert db.rows["room_status"][0]["status"] == "OCCUPIED"
    assert db.rows["room_status"][0]["clean_type"] is None


@pytest.mark.asyncio
async def test_delete_assignment_rejects_cross_tenant_assignment(monkeypatch):
    db = FakeDB({
        "room_assignments": [{
            "id": "assign-other",
            "tenant_id": "other-hotel",
            "room_id": "22222222-2222-4222-8222-222222222222",
            "assigned_to": "44444444-4444-4444-8444-444444444444",
            "assignment_date": "2026-05-24",
        }],
        "room_status": [],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    with pytest.raises(Exception) as exc:
        await housekeeping_router.delete_assignment(
            "assign-other",
            current_user=SUPERVISOR,
        )

    assert exc.value.status_code == 404
    assert len(db.rows["room_assignments"]) == 1


@pytest.mark.asyncio
async def test_board_history_clean_type_overrides_stale_room_status_clean_type(monkeypatch):
    """History FULL beats stale room_status DEP so the room shows as PICKUP."""
    room_id = "abababab-abab-4aba-8aba-abababababab"
    db = FakeDB({
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "DIRTY",
            "fo_status": "OCC",
            "clean_type": "DEP",          # stale from an earlier import
            "rooms": {"floor": 1, "room_number": "202"},
        }],
        "room_assignments": [],
        "room_readiness_predictions": [],
        "room_status_history": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "notes": "task_sheet_clean_type=FULL",   # more recent import says FULL
            "from_status": "DIRTY",
            "to_status": "PICKUP",
            "changed_by": SUPERVISOR.user_id,
            "change_source": "system",
            "created_at": "2026-05-24T15:00:00+00:00",
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.get_housekeeping_board(
        board_date=date(2026, 5, 24),
        shift_id=None,
        include_predictions=False,
        current_user=SUPERVISOR,
    )

    room = response["data"][0]
    assert room["status"] == "PICKUP", f"Expected PICKUP, got {room['status']}"
    assert room["clean_type"] == "FULL"
    assert room["clean_type_label"] == "Full Linen Change"


@pytest.mark.asyncio
async def test_manual_checkout_occupied_room_sets_dep_clean_type(monkeypatch):
    from routers import rooms as rooms_router

    room_id = "aa111111-1111-4111-8111-111111111111"
    db = FakeDB({
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "OCCUPIED",
            "fo_status": "OCC",
            "clean_type": None,
            "actual_checkout_at": None,
            "assigned_to": None,
        }],
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "201"}],
        "room_status_history": [],
        "notifications": [],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)
    monkeypatch.setattr(rooms_router.asyncio, "create_task", lambda *_: None)

    await rooms_router.manual_checkout_room(
        room_id=room_id,
        request=None,
        current_user=SUPERVISOR,
    )

    rs = db.rows["room_status"][0]
    assert rs["status"] == "DIRTY"
    assert rs["fo_status"] == "VAC"
    assert rs["clean_type"] == "DEP"
    assert rs["actual_checkout_at"] is not None


@pytest.mark.asyncio
async def test_undo_checkout_occupied_room_restores_status_and_clears_clean_type(monkeypatch):
    from routers import rooms as rooms_router

    room_id = "bb222222-2222-4222-8222-222222222222"
    db = FakeDB({
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "DIRTY",
            "fo_status": "VAC",
            "clean_type": "DEP",
            "actual_checkout_at": "2026-05-31T10:00:00+00:00",
        }],
        "room_status_history": [{
            "id": "hist-1",
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "from_status": "OCCUPIED",
            "to_status": "DIRTY",
            "notes": "Guest checked out",
            "created_at": "2026-05-31T10:00:00+00:00",
        }],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    response = await rooms_router.undo_checkout(
        room_id=room_id,
        current_user=SUPERVISOR,
    )

    rs = db.rows["room_status"][0]
    assert rs["status"] == "OCCUPIED"
    assert rs["fo_status"] == "OCC"
    assert rs["clean_type"] is None
    assert rs["actual_checkout_at"] is None
    assert response["data"]["undone"] is True


@pytest.mark.asyncio
async def test_manual_checkout_pickup_room_sets_dep_and_encodes_prev_clean_type(monkeypatch):
    from routers import rooms as rooms_router

    room_id = "cc333333-3333-4333-8333-333333333333"
    db = FakeDB({
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "PICKUP",
            "fo_status": "OCC",
            "clean_type": "FULL",
            "actual_checkout_at": None,
            "assigned_to": None,
        }],
        "rooms": [{"id": room_id, "tenant_id": SUPERVISOR.hotel_id, "room_number": "301"}],
        "room_status_history": [],
        "notifications": [],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)
    monkeypatch.setattr(rooms_router.asyncio, "create_task", lambda *_: None)

    await rooms_router.manual_checkout_room(room_id=room_id, request=None, current_user=SUPERVISOR)

    rs = db.rows["room_status"][0]
    assert rs["status"] == "DIRTY"
    assert rs["fo_status"] == "VAC"
    assert rs["clean_type"] == "DEP"
    hist = db.rows["room_status_history"][0]
    assert "|prev_clean_type=FULL" in hist["notes"]


@pytest.mark.asyncio
async def test_undo_checkout_pickup_room_restores_pickup_and_full_clean_type(monkeypatch):
    from routers import rooms as rooms_router

    room_id = "dd444444-4444-4444-8444-444444444444"
    db = FakeDB({
        "room_status": [{
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "status": "DIRTY",
            "fo_status": "VAC",
            "clean_type": "DEP",
            "actual_checkout_at": "2026-05-31T10:00:00+00:00",
        }],
        "room_status_history": [{
            "id": "hist-2",
            "room_id": room_id,
            "tenant_id": SUPERVISOR.hotel_id,
            "from_status": "PICKUP",
            "to_status": "DIRTY",
            "notes": "Guest checked out|prev_clean_type=FULL",
            "created_at": "2026-05-31T10:00:00+00:00",
        }],
    })
    monkeypatch.setattr(rooms_router, "supabase", db)

    response = await rooms_router.undo_checkout(room_id=room_id, current_user=SUPERVISOR)

    rs = db.rows["room_status"][0]
    assert rs["status"] == "PICKUP"
    assert rs["fo_status"] == "OCC"
    assert rs["clean_type"] == "FULL"
    assert rs["actual_checkout_at"] is None
    assert response["data"]["undone"] is True
