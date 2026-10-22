"""Shared helpers for the assignment-batch integration tests (real migrated database, never mocks).

Every test builds its OWN hotel (unique tenant, rooms, users) so tests cannot see each other's rows and nothing
needs cleaning up in the throw-away CI database. (operational_audit_events is append-only, so a hotel that has
published a batch cannot be deleted anyway.)
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime

from dateutil import tz
from postgrest.exceptions import APIError
from supabase import create_client

from core.config import settings

TIMEZONE = "America/Chicago"


def new_client():
    """A fresh service-role client (one per thread: clients are not shared across concurrent requests)."""
    return create_client(settings.supabase_project_url, settings.supabase_service_role_key)


def hotel_today(timezone_name: str = TIMEZONE) -> date:
    return datetime.now(tz.gettz(timezone_name)).date()


@dataclass
class Hotel:
    tenant_id: str
    supervisor: str
    gm: str
    housekeepers: list[str]
    rooms: dict[str, str] = field(default_factory=dict)  # room name -> room id

    def room_ids(self, *names: str) -> list[str]:
        return [self.rooms[name] for name in names]


def _create_user(db, label: str) -> str:
    created = db.auth.admin.create_user(
        {"email": f"{label}-{uuid.uuid4().hex[:12]}@batch-test.example", "password": f"pw-{uuid.uuid4().hex}", "email_confirm": True}
    )
    return created.user.id


def make_hotel(db, *, rooms: dict[str, dict] | None = None, housekeepers: int = 3) -> Hotel:
    """A hotel with one supervisor, one GM, `housekeepers` housekeepers and `rooms` ({name: room_status overrides}).

    Every room starts DIRTY, unassigned, with no clean_type unless overridden.
    """
    suffix = uuid.uuid4().hex[:10]
    tenant_id = db.table("tenants").insert({"name": f"Batch Test {suffix}", "slug": f"batch-test-{suffix}", "timezone": TIMEZONE}).execute().data[0]["id"]
    room_type_id = db.table("room_types").insert({"tenant_id": tenant_id, "name": "King", "code": "K"}).execute().data[0]["id"]
    hotel = Hotel(
        tenant_id=tenant_id,
        supervisor=_create_user(db, "sup"),
        gm=_create_user(db, "gm"),
        housekeepers=[_create_user(db, f"hk{i}") for i in range(housekeepers)],
    )
    role_rows = [
        {"user_id": hotel.supervisor, "tenant_id": tenant_id, "role": "housekeeping_supervisor"},
        {"user_id": hotel.gm, "tenant_id": tenant_id, "role": "gm"},
        *({"user_id": hk, "tenant_id": tenant_id, "role": "housekeeper"} for hk in hotel.housekeepers),
    ]
    db.table("user_roles").insert(role_rows).execute()

    spec = rooms if rooms is not None else {f"r{i}": {} for i in range(1, 5)}
    inserted = (
        db.table("rooms")
        .insert([{"tenant_id": tenant_id, "room_number": f"{100 + i}-{suffix[:4]}", "floor": 1, "room_type_id": room_type_id} for i, _ in enumerate(spec)])
        .execute()
        .data
    )
    for (name, overrides), row in zip(spec.items(), inserted):
        hotel.rooms[name] = row["id"]
        db.table("room_status").upsert({"room_id": row["id"], "tenant_id": tenant_id, "status": "DIRTY", **overrides}, on_conflict="room_id").execute()
    return hotel


def change(room_id: str, kind: str, to: str | None = None, expected: str | None = None) -> dict:
    """One batch change in the shape the database function (and the API) take."""
    return {
        "room_id": room_id,
        "kind": kind,
        "housekeeper_id": to,
        "expected_assigned_to": expected,
        "expect_unassigned": kind == "assign",
    }


def publish(db, hotel: Hotel, changes: list[dict], *, operation_id: str | None = None, actor: str | None = None, on: date | None = None, tenant_id: str | None = None) -> dict:
    return db.rpc(
        "publish_assignment_batch",
        {
            "p_tenant_id": tenant_id or hotel.tenant_id,
            "p_actor_id": actor or hotel.supervisor,
            "p_operation_id": operation_id or str(uuid.uuid4()),
            "p_date": (on or hotel_today()).isoformat(),
            "p_changes": changes,
        },
    ).execute().data


def refused(db, hotel: Hotel, changes: list[dict], **kwargs) -> APIError:
    """Publishes and returns the database's refusal (the test fails if it was accepted)."""
    try:
        publish(db, hotel, changes, **kwargs)
    except APIError as error:
        return error
    raise AssertionError("the batch was accepted but must have been refused")


def conflicts_of(error: APIError) -> list[dict]:
    import json

    return json.loads(error.details or "{}").get("conflicts", [])


def mirror(db, hotel: Hotel, name: str) -> dict:
    return db.table("room_status").select("status, assigned_to, clean_type").eq("room_id", hotel.rooms[name]).single().execute().data


def dated(db, hotel: Hotel, name: str, on: date | None = None) -> dict | None:
    rows = db.table("room_assignments").select("*").eq("room_id", hotel.rooms[name]).eq("assignment_date", (on or hotel_today()).isoformat()).execute().data
    return rows[0] if rows else None


def seed_dated(db, hotel: Hotel, name: str, owner: str, *, clean_type: str = "DEP", mirror_too: bool = True) -> None:
    """An existing assignment as the board shows it: a dated row, and (by default) the status mirror."""
    db.table("room_assignments").insert(
        {"tenant_id": hotel.tenant_id, "room_id": hotel.rooms[name], "assigned_to": owner, "assigned_by": hotel.supervisor, "assignment_date": hotel_today().isoformat(), "clean_type": clean_type}
    ).execute()
    if mirror_too:
        db.table("room_status").update({"assigned_to": owner}).eq("room_id", hotel.rooms[name]).execute()


def audit_count(db, hotel: Hotel, name: str) -> int:
    return len(db.table("operational_audit_events").select("id").eq("tenant_id", hotel.tenant_id).eq("resource_id", hotel.rooms[name]).execute().data)


def operation_count(db, hotel: Hotel) -> int:
    return len(db.table("assignment_batch_operations").select("id").eq("tenant_id", hotel.tenant_id).execute().data)


def snapshot(db, hotel: Hotel) -> dict:
    """Everything a batch could touch, for 'nothing changed' assertions."""
    ids = list(hotel.rooms.values())
    return {
        "status": sorted((r["room_id"], r["status"], r["assigned_to"], r["clean_type"]) for r in db.table("room_status").select("room_id, status, assigned_to, clean_type").in_("room_id", ids).execute().data),
        "assignments": sorted((r["room_id"], r["assigned_to"], r["clean_type"]) for r in db.table("room_assignments").select("room_id, assigned_to, clean_type").in_("room_id", ids).execute().data),
        "audit": len(db.table("operational_audit_events").select("id").eq("tenant_id", hotel.tenant_id).execute().data),
        "operations": operation_count(db, hotel),
    }


# ─── A raw database session, for the few facts PostgREST cannot express ───────────────────────────────────────
# (an open transaction holding a lock, and a trigger that makes a late write fail). CI installs the psql client in
# the same job before these tests run; a developer can point PSQL_DOCKER_CONTAINER at a local Supabase db container.

def psql_available() -> bool:
    if os.getenv("PSQL_DOCKER_CONTAINER") and shutil.which("docker"):
        return True
    return bool(os.getenv("DB_URL") and shutil.which("psql"))


def psql_command() -> list[str]:
    container = os.getenv("PSQL_DOCKER_CONTAINER")
    if container:
        return ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-X"]
    return ["psql", os.environ["DB_URL"], "-v", "ON_ERROR_STOP=1", "-q", "-X"]


def run_sql(sql: str, timeout: int = 60) -> str:
    done = subprocess.run(psql_command(), input=sql, capture_output=True, text=True, timeout=timeout)
    if done.returncode != 0:
        raise AssertionError(f"psql failed: {done.stderr}")
    return done.stdout


def start_sql(sql: str) -> subprocess.Popen:
    """Starts a SQL session in the background (used to hold a row lock while another request runs)."""
    process = subprocess.Popen(psql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert process.stdin is not None
    process.stdin.write(sql)
    process.stdin.close()
    return process
