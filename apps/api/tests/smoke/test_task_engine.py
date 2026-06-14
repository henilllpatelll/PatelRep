from pathlib import Path
from types import SimpleNamespace

from middleware.auth import CurrentUser
from models.task_engine import (
    DEPARTMENT_CODES,
    TASK_CATEGORIES,
    TASK_PRIORITIES,
    TASK_STATUSES,
    TaskCategory,
    TaskCreateInput,
    TaskPriority,
    TaskStatus,
)
from services import task_engine
from services.task_engine_seed import PILOT_OPERA_CLOUD_SEED


USER = CurrentUser(
    user_id="gm-1",
    hotel_id="hotel-1",
    role="gm",
    email="gm@example.com",
)
REPO_ROOT = Path(__file__).resolve().parents[4]


class FakeSupabase:
    def __init__(self):
        self.tables = {
            "tasks": {},
            "task_assignments": {},
            "task_notes": {},
            "task_photos": {},
            "audit_events": {},
            "escalation_events": {},
            "rooms": {
                "room-101": {
                    "id": "room-101",
                    "tenant_id": "hotel-1",
                    "room_number": "101",
                }
            },
            "user_roles": {
                "role-housekeeper-1": {
                    "id": "role-housekeeper-1",
                    "tenant_id": "hotel-1",
                    "user_id": "housekeeper-1",
                    "role": "housekeeper",
                    "is_active": True,
                },
                "role-engineer-1": {
                    "id": "role-engineer-1",
                    "tenant_id": "hotel-1",
                    "user_id": "engineer-1",
                    "role": "engineer",
                    "is_active": True,
                },
            },
        }
        self.counter = 0

    def table(self, name):
        return FakeQuery(self, name)

    def execute(self, query):
        table = self.tables.setdefault(query.table_name, {})

        if query.action == "insert":
            payload = query.payload.copy()
            row_id = payload.get("id") or self._next_id(query.table_name)
            row = {"id": row_id, **payload}
            table[row_id] = row
            return SimpleNamespace(data=[row])

        rows = [
            row
            for row in table.values()
            if all(row.get(column) == value for column, value in query.filters.items())
        ]

        if query.action == "update":
            for row in rows:
                row.update(query.payload)
            return SimpleNamespace(data=rows)

        if query.limit_count is not None:
            rows = rows[: query.limit_count]
        if query.single:
            return SimpleNamespace(data=rows[0] if rows else None)
        return SimpleNamespace(data=rows)

    def _next_id(self, table_name):
        self.counter += 1
        return f"{table_name}-{self.counter}"


class FakeQuery:
    def __init__(self, supabase, table_name):
        self.supabase = supabase
        self.table_name = table_name
        self.action = "select"
        self.payload = None
        self.filters = {}
        self.single = False
        self.limit_count = None

    def insert(self, payload):
        self.action = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.action = "update"
        self.payload = payload
        return self

    def select(self, _columns):
        self.action = "select"
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def maybe_single(self):
        self.single = True
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def execute(self):
        return self.supabase.execute(self)


def test_task_engine_constants_match_pivot_contract():
    assert DEPARTMENT_CODES == {
        "housekeeping",
        "maintenance",
        "front_desk",
        "manager",
        "system",
    }
    assert TASK_CATEGORIES == {
        "housekeeping_room_clean",
        "housekeeping_guest_request",
        "maintenance_work_order",
        "room_status_mismatch",
        "pms_note_request",
        "ai_failure",
        "manager_review",
    }
    assert TASK_STATUSES == {
        "new",
        "assigned",
        "acknowledged",
        "in_progress",
        "blocked",
        "pending_approval",
        "completed",
        "verified",
        "escalated",
        "canceled",
    }
    assert TASK_PRIORITIES == {"low", "normal", "high", "urgent"}


def test_create_task_sets_new_status_and_audit_event():
    fake = FakeSupabase()

    task = task_engine.create_task(
        TaskCreateInput(
            title="Clean room 101",
            category=TaskCategory.HOUSEKEEPING_ROOM_CLEAN,
            priority=TaskPriority.HIGH,
            room_id="room-101",
            room_or_area="101",
        ),
        actor=USER,
        client=fake,
    )

    assert task["tenant_id"] == "hotel-1"
    assert task["task_type"] == "housekeeping_room_clean"
    assert task["priority"] == "high"
    assert task["status"] == "new"
    assert task["room_id"] == "room-101"

    audit_events = list(fake.tables["audit_events"].values())
    assert audit_events[0]["event_type"] == "task.created"
    assert audit_events[0]["actor_type"] == "user"
    assert audit_events[0]["actor_id"] == "gm-1"
    assert audit_events[0]["after_snapshot_ref"]["status"] == "new"


def test_task_lifecycle_functions_update_status_and_audit_every_step():
    fake = FakeSupabase()
    task = task_engine.create_task(
        TaskCreateInput(
            title="Fix AC",
            category=TaskCategory.MAINTENANCE_WORK_ORDER,
            priority=TaskPriority.URGENT,
            room_id="room-101",
            room_or_area="101",
            issue_category="hvac",
            guest_facing=True,
        ),
        actor=USER,
        client=fake,
    )

    assigned = task_engine.assign_task(
        task["id"], "engineer-1", actor=USER, client=fake
    )
    acknowledged = task_engine.acknowledge_task(task["id"], actor=USER, client=fake)
    started = task_engine.start_task(task["id"], actor=USER, client=fake)
    blocked = task_engine.block_task(
        task["id"], "Waiting on compressor", actor=USER, client=fake
    )
    completed = task_engine.complete_task(
        task["id"],
        completion_verification={"verified_by": "photo", "summary": "Unit cooling"},
        actor=USER,
        client=fake,
    )
    verified = task_engine.verify_task(task["id"], actor=USER, client=fake)
    escalated = task_engine.escalate_task(
        task["id"],
        reason="Repeat failure after verification",
        actor=USER,
        client=fake,
    )

    assert assigned["status"] == TaskStatus.ASSIGNED.value
    assert assigned["assigned_to"] == "engineer-1"
    assert acknowledged["status"] == TaskStatus.ACKNOWLEDGED.value
    assert started["status"] == TaskStatus.IN_PROGRESS.value
    assert blocked["status"] == TaskStatus.BLOCKED.value
    assert blocked["blocked_reason"] == "Waiting on compressor"
    assert completed["status"] == TaskStatus.COMPLETED.value
    assert completed["completion_verification"]["summary"] == "Unit cooling"
    assert verified["status"] == TaskStatus.VERIFIED.value
    assert escalated["status"] == TaskStatus.ESCALATED.value
    assert (
        list(fake.tables["task_assignments"].values())[0]["assigned_to"] == "engineer-1"
    )
    assert list(fake.tables["escalation_events"].values())[0]["reason"] == (
        "Repeat failure after verification"
    )

    event_types = [row["event_type"] for row in fake.tables["audit_events"].values()]
    assert event_types == [
        "task.created",
        "task.assigned",
        "task.acknowledged",
        "task.started",
        "task.blocked",
        "task.completed",
        "task.verified",
        "task.escalated",
    ]


def test_add_note_and_attach_photo_metadata_create_audit_events():
    fake = FakeSupabase()
    task = task_engine.create_task(
        TaskCreateInput(
            title="Guest asked for towels",
            category=TaskCategory.HOUSEKEEPING_GUEST_REQUEST,
            room_id="room-101",
        ),
        actor=USER,
        client=fake,
    )

    note = task_engine.add_note(
        task["id"], "Dropped towels at door", actor=USER, client=fake
    )
    photo = task_engine.attach_photo_metadata(
        task["id"],
        url="https://example.test/photo.jpg",
        content_type="image/jpeg",
        byte_size=42_000,
        actor=USER,
        client=fake,
    )

    assert note["body"] == "Dropped towels at door"
    assert photo["storage_url"] == "https://example.test/photo.jpg"
    assert photo["content_type"] == "image/jpeg"
    assert [row["event_type"] for row in fake.tables["audit_events"].values()] == [
        "task.created",
        "task.note_added",
        "task.photo_attached",
    ]


def test_seed_data_contains_one_pilot_opera_cloud_hotel():
    assert (
        PILOT_OPERA_CLOUD_SEED["property"]["name"] == "PatelRep Pilot OPERA Cloud Hotel"
    )
    assert PILOT_OPERA_CLOUD_SEED["property"]["opera_cloud_enabled"] is True
    assert {
        department["code"] for department in PILOT_OPERA_CLOUD_SEED["departments"]
    } == (DEPARTMENT_CODES)
    assert len(PILOT_OPERA_CLOUD_SEED["rooms"]) >= 4
    assert any(room["mismatchFlag"] for room in PILOT_OPERA_CLOUD_SEED["rooms"])


def test_task_engine_migration_defines_foundational_tables_and_checks():
    with open(
        REPO_ROOT / "supabase/migrations/059_task_engine_foundation.sql",
        encoding="utf-8",
    ) as file:
        sql = file.read()

    for table_name in (
        "task_assignments",
        "task_notes",
        "task_photos",
        "approval_requests",
        "audit_events",
        "pms_snapshots",
        "agent_runs",
        "escalation_events",
    ):
        assert f"CREATE TABLE IF NOT EXISTS {table_name}" in sql

    assert "housekeeping_room_clean" in sql
    assert "pending_approval" in sql
    assert "actor_type IN ('user', 'agent', 'system')" in sql


def test_task_engine_seed_sql_is_separate_from_schema_migration():
    with open(
        REPO_ROOT / "supabase/migrations/060_task_engine_pilot_seed.sql",
        encoding="utf-8",
    ) as file:
        sql = file.read()

    assert "PatelRep Pilot OPERA Cloud Hotel" in sql
    assert "ON CONFLICT (slug) DO UPDATE" in sql
    assert "Do not use for real OPERA Cloud automation" in sql
