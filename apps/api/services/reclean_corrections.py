"""Failed-inspection corrections for rooms flagged ``reclean_requested_at``.

Shared by ``GET /housekeeping/my-rooms`` (shows the housekeeper what to fix) and
``POST /clean-sessions`` (seeds a correction-only checklist), so both read the
same inspection history. ``load_reclean_details`` and ``correction_checklist``
are read-only: they never alter inspection records.

The second half of the module is the supervisor-side correction lifecycle used by
the inspection completion endpoint: creating the ONE correction task a failed
inspection owns (``ensure_correction_task``), closing it once a reinspection
passes (``resolve_correction_task``), and the inspection detail read model
(``load_inspection_detail``). Every function takes the Supabase client as its
first argument so tests can inject a fake, and every query is scoped by ``hotel_id``.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from services.inspection_rules import correction_task_fields, derive_correction_status, sort_template_items

logger = logging.getLogger(__name__)

CORRECTION_SECTION = "Corrections"


def load_reclean_details(client: Any, hotel_id: str, room_ids: list[str]) -> dict[str, dict]:
    """Latest failed/conditional inspection per room, with its failed items.

    Returns ``{room_id: {inspection_id, inspected_at, overall_result, notes,
    items: [{id, label, note}]}}``. Rooms with no failed inspection are absent.
    """
    if not room_ids:
        return {}

    inspections = (
        client.table("inspections")
        .select("id, room_id, completed_at, overall_result, notes")
        .eq("tenant_id", hotel_id)
        .in_("room_id", room_ids)
        .in_("overall_result", ["failed", "conditional"])
        .order("completed_at", desc=True)
        .execute()
    ).data or []

    latest: dict[str, dict] = {}
    for insp in inspections:
        room_id = insp.get("room_id")
        if room_id and room_id not in latest:
            latest[room_id] = insp
    if not latest:
        return {}

    inspection_ids = [insp["id"] for insp in latest.values()]
    fail_rows = (
        client.table("inspection_results")
        .select("inspection_id, template_item_id, note")
        .eq("tenant_id", hotel_id)
        .in_("inspection_id", inspection_ids)
        .eq("result", "fail")
        .execute()
    ).data or []

    item_ids = list({r["template_item_id"] for r in fail_rows if r.get("template_item_id")})
    labels: dict[str, str] = {}
    if item_ids:
        labels = {
            i["id"]: i["description"]
            for i in (
                client.table("inspection_template_items")
                .select("id, description")
                .in_("id", item_ids)
                .execute()
            ).data
            or []
        }

    items_by_inspection: dict[str, list[dict]] = {}
    for row in fail_rows:
        note = (row.get("note") or "").strip()
        label = labels.get(row.get("template_item_id")) or note
        if not label:
            continue
        items_by_inspection.setdefault(row["inspection_id"], []).append(
            {
                "id": row.get("template_item_id"),
                "label": label,
                # The inspector's note is only extra detail when it adds to the label.
                "note": note if note and note != label else None,
            }
        )

    return {
        room_id: {
            "inspection_id": insp["id"],
            "inspected_at": insp.get("completed_at"),
            "overall_result": insp.get("overall_result"),
            "notes": (insp.get("notes") or "").strip() or None,
            "items": items_by_inspection.get(insp["id"], []),
        }
        for room_id, insp in latest.items()
    }


def correction_checklist(details: dict | None) -> list[dict]:
    """Session checklist snapshot for a correction-only reclean.

    Every failed item is required, so a reclean cannot be submitted until each
    correction is ticked. Labels are the inspection's own wording.
    """
    items = (details or {}).get("items") or []
    seen: set[str] = set()
    checklist: list[dict] = []
    for item in items:
        label = item["label"]
        if label in seen:
            continue
        seen.add(label)
        checklist.append(
            {
                "item_id": None,
                "section": CORRECTION_SECTION,
                "label": label,
                "is_required": True,
                "checked": False,
                "checked_at": None,
            }
        )
    return checklist


# ---------------------------------------------------------------------------
# Correction lifecycle (supervisor side)
# ---------------------------------------------------------------------------

CLEAN_CYCLE_LOOKBACK_DAYS = 7


def is_unique_violation(exc: Exception) -> bool:
    text = str(exc)
    return getattr(exc, "code", None) == "23505" or "23505" in text or "duplicate key" in text


def latest_clean_cycles(client: Any, hotel_id: str, room_ids: list[str]) -> dict[str, str]:
    """``{room_id: id of the room's most recent transition INTO CLEAN}``.

    That history row identifies one "cleaned, awaiting inspection" cycle. A room cleaned again after a
    failure gets a new row, so a queue row reviewed before that can be recognised as stale. Rooms whose
    CLEAN transition is older than the lookback (or was never recorded) are simply absent: no id means
    no extra check, never a false rejection.
    """
    if not room_ids:
        return {}
    since = (datetime.now(timezone.utc) - timedelta(days=CLEAN_CYCLE_LOOKBACK_DAYS)).isoformat()
    rows = (
        client.table("room_status_history")
        .select("id, room_id, created_at")
        .eq("tenant_id", hotel_id)
        .in_("room_id", room_ids)
        .eq("to_status", "CLEAN")
        .gte("created_at", since)
        .order("created_at", desc=True)
        .execute()
    ).data or []
    cycles: dict[str, str] = {}
    for row in rows:
        cycles.setdefault(row["room_id"], row["id"])
    return cycles


def fetch_correction_task(client: Any, hotel_id: str, inspection_id: str) -> Optional[dict]:
    rows = (
        client.table("tasks")
        .select("*")
        .eq("tenant_id", hotel_id)
        .eq("source_inspection_id", inspection_id)
        .limit(1)
        .execute()
    ).data or []
    return rows[0] if rows else None


def responsible_housekeeper(client: Any, hotel_id: str, room_id: str, assignment_date: str) -> Optional[str]:
    """Who owns the correction: today's assignee for the room, else whoever last finished cleaning it."""
    assignment = (
        client.table("room_assignments")
        .select("assigned_to")
        .eq("tenant_id", hotel_id)
        .eq("room_id", room_id)
        .eq("assignment_date", assignment_date)
        .maybe_single()
        .execute()
    )
    assigned = ((assignment.data if assignment else None) or {}).get("assigned_to")
    if assigned:
        return assigned
    sessions = (
        client.table("room_clean_sessions")
        .select("housekeeper_id")
        .eq("tenant_id", hotel_id)
        .eq("room_id", room_id)
        .eq("status", "completed")
        .order("ended_at", desc=True)
        .limit(1)
        .execute()
    ).data or []
    return sessions[0].get("housekeeper_id") if sessions else None


def ensure_correction_task(
    client: Any,
    *,
    hotel_id: str,
    user_id: str,
    inspection_id: str,
    room_id: str,
    room_number: str,
    kind: str,
    failed_labels: list[str],
    notes: Optional[str],
    assignment_date: str,
) -> dict:
    """The single correction task for a failed inspection - created once, found on every retry.

    Returns ``{"task": row | None, "created": bool}``. Dedupe is enforced in the database by the unique
    ``(tenant_id, source_inspection_id)`` index; the pre-read just avoids the failed insert. Also stamps
    ``room_status.reclean_requested_at`` (only when unset, so a retry never moves the original request time).
    Does not assume the owner has seen the task: ``assigned_to`` records responsibility, nothing more.
    """
    existing = fetch_correction_task(client, hotel_id, inspection_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    # The room must read as needing correction even if task creation fails below.
    client.table("room_status").update({"reclean_requested_at": now_iso}).eq("room_id", room_id).eq(
        "tenant_id", hotel_id
    ).is_("reclean_requested_at", "null").execute()
    if existing:
        return {"task": existing, "created": False}

    fields = correction_task_fields(kind, room_number, failed_labels, notes)
    row = {
        "tenant_id": hotel_id,
        "title": fields["title"],
        "description": fields["description"],
        "task_type": "housekeeping",
        "priority": "urgent",
        "room_id": room_id,
        "assigned_to": responsible_housekeeper(client, hotel_id, room_id, assignment_date),
        "created_by": user_id,
        "sla_minutes": fields["sla_minutes"],
        "due_at": now_iso,
        "source_inspection_id": inspection_id,
    }
    try:
        created = client.table("tasks").insert(row).execute()
    except Exception as exc:  # noqa: BLE001 - a concurrent retry may have won the unique index
        if not is_unique_violation(exc):
            raise
        return {"task": fetch_correction_task(client, hotel_id, inspection_id), "created": False}
    return {"task": (created.data or [None])[0], "created": True}


def resolve_correction_task(client: Any, hotel_id: str, failed_inspection_id: str) -> None:
    """A passing reinspection verified the room: close the correction task that is still open."""
    client.table("tasks").update(
        {"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()}
    ).eq("tenant_id", hotel_id).eq("source_inspection_id", failed_inspection_id).in_(
        "status", ["open", "in_progress", "escalated"]
    ).execute()


def _profile_name(client: Any, hotel_id: str, user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    row = (
        client.table("user_profiles")
        .select("preferred_name, full_name")
        .eq("id", user_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    profile = (row.data if row else None) or {}
    return profile.get("preferred_name") or profile.get("full_name")


def load_inspection_detail(client: Any, hotel_id: str, inspection_id: str) -> Optional[dict]:
    """One inspection with every checklist answer, its evidence, and where its correction stands.

    Historical rows (no template fingerprint, severity or reinspection link, ``conditional`` results,
    results whose template item was later deleted) read back unchanged - missing facts stay ``None``.
    """
    inspection = (
        client.table("inspections")
        .select("*")
        .eq("tenant_id", hotel_id)
        .eq("id", inspection_id)
        .maybe_single()
        .execute()
    )
    insp = inspection.data if inspection else None
    if not insp:
        return None

    room = (
        client.table("rooms")
        .select("room_number, floor, room_type_id")
        .eq("id", insp["room_id"])
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    room_row = (room.data if room else None) or {}
    template_row: dict = {}
    if insp.get("template_id"):
        template = (
            client.table("inspection_templates")
            .select("name")
            .eq("id", insp["template_id"])
            .eq("tenant_id", hotel_id)
            .maybe_single()
            .execute()
        )
        template_row = (template.data if template else None) or {}

    results = (
        client.table("inspection_results")
        .select("template_item_id, result, note, photo_url, severity")
        .eq("inspection_id", inspection_id)
        .eq("tenant_id", hotel_id)
        .execute()
    ).data or []
    item_ids = [r["template_item_id"] for r in results if r.get("template_item_id")]
    items_by_id: dict[str, dict] = {}
    if item_ids:
        items_by_id = {
            i["id"]: i
            for i in (
                client.table("inspection_template_items")
                .select("id, section, description, is_required, requires_photo_on_fail, sort_order")
                .eq("tenant_id", hotel_id)
                .in_("id", item_ids)
                .execute()
            ).data
            or []
        }
    position = {i["id"]: n for n, i in enumerate(sort_template_items(items_by_id.values()))}
    answers = []
    for r in sorted(results, key=lambda r: position.get(r.get("template_item_id"), len(position))):
        item = items_by_id.get(r.get("template_item_id")) or {}
        answers.append(
            {
                "template_item_id": r.get("template_item_id"),
                "section": item.get("section"),
                "description": item.get("description"),
                "is_required": item.get("is_required"),
                "requires_photo_on_fail": item.get("requires_photo_on_fail"),
                "result": r.get("result"),
                "note": r.get("note"),
                "severity": r.get("severity"),
                "photo_url": r.get("photo_url"),
            }
        )

    correction = None
    task = fetch_correction_task(client, hotel_id, inspection_id)
    if insp.get("overall_result") == "failed" or (
        insp.get("overall_result") == "conditional" and (insp.get("correction_kind") or task is not None)
    ):
        status_row = (
            client.table("room_status")
            .select("status, reclean_requested_at")
            .eq("room_id", insp["room_id"])
            .eq("tenant_id", hotel_id)
            .maybe_single()
            .execute()
        )
        followups = (
            client.table("inspections")
            .select("id, overall_result, completed_at, reinspection_of")
            .eq("tenant_id", hotel_id)
            .eq("room_id", insp["room_id"])
            .gte("completed_at", insp.get("completed_at") or "")
            .neq("id", inspection_id)
            .execute()
        ).data or []
        derived = derive_correction_status(insp, task, status_row.data if status_row else None, followups)
        correction = {
            **(derived or {}),
            "kind": insp.get("correction_kind"),
            "task": (
                {
                    "id": task.get("id"),
                    "status": task.get("status"),
                    "priority": task.get("priority"),
                    "assigned_to": task.get("assigned_to"),
                    "assigned_name": _profile_name(client, hotel_id, task.get("assigned_to")),
                    "due_at": task.get("due_at"),
                    "started_at": task.get("started_at"),
                    "completed_at": task.get("completed_at"),
                }
                if task
                else None
            ),
        }

    return {
        "id": insp["id"],
        "room_id": insp["room_id"],
        "room_number": room_row.get("room_number"),
        "floor": room_row.get("floor"),
        "room_type_id": room_row.get("room_type_id"),
        "template_id": insp.get("template_id"),
        "template_name": template_row.get("name"),
        "overall_result": insp.get("overall_result"),
        "notes": insp.get("notes"),
        "completed_at": insp.get("completed_at"),
        "inspected_by": insp.get("inspected_by"),
        "inspector_name": _profile_name(client, hotel_id, insp.get("inspected_by")),
        "correction_kind": insp.get("correction_kind"),
        "reinspection_of": insp.get("reinspection_of"),
        "items": answers,
        "correction": correction,
    }


# ── Hotel-wide list of corrections that still need someone ───────────────────

#: How far back an unresolved correction is looked for. When more exist than fit, ``meta.truncated`` says so
#: instead of the list silently looking complete.
OPEN_CORRECTIONS_WINDOW_DAYS = 60
OPEN_CORRECTIONS_LIMIT = 300
_IN_CHUNK = 100
#: Correction statuses a later inspection already settled - nothing is left for the supervisor.
CLOSED_CORRECTION_STATUSES = frozenset({"verified", "superseded"})
_FAILED_ITEMS_SHOWN = 3


def _chunks(values: list[str], size: int = _IN_CHUNK):
    for start in range(0, len(values), size):
        yield values[start : start + size]


def list_open_corrections(
    client: Any,
    hotel_id: str,
    *,
    window_days: int = OPEN_CORRECTIONS_WINDOW_DAYS,
    limit: int = OPEN_CORRECTIONS_LIMIT,
    now: Optional[datetime] = None,
) -> dict:
    """Every failed inspection (and touch-up) in this hotel whose correction is not settled yet.

    One bounded pass: the recent failed inspections, then batched reads for their correction tasks, their rooms'
    current status, the follow-up inspections, the failed items, the rooms and the people - never one request per
    inspection. Each row's ``status`` comes from the same ``derive_correction_status`` the single-inspection read
    uses, so the list and the detail cannot disagree. ``verified`` and ``superseded`` corrections are dropped.
    """
    since = ((now or datetime.now(timezone.utc)) - timedelta(days=window_days)).isoformat()
    fetched = (
        client.table("inspections")
        .select("id, room_id, overall_result, notes, completed_at, inspected_by, correction_kind, reinspection_of")
        .eq("tenant_id", hotel_id)
        .in_("overall_result", ["failed", "conditional"])
        .gte("completed_at", since)
        .order("completed_at", desc=True)
        .limit(limit + 1)
        .execute()
    ).data or []
    truncated = len(fetched) > limit
    failures = fetched[:limit]
    meta = {"window_days": window_days, "truncated": truncated}
    if not failures:
        return {"data": [], "meta": meta}

    inspection_ids = [f["id"] for f in failures]
    room_ids = sorted({f["room_id"] for f in failures if f.get("room_id")})
    earliest = min(str(f.get("completed_at") or "") for f in failures)

    tasks: dict[str, dict] = {}
    for chunk in _chunks(inspection_ids):
        for task in (
            client.table("tasks").select("*").eq("tenant_id", hotel_id).in_("source_inspection_id", chunk).execute()
        ).data or []:
            tasks.setdefault(task["source_inspection_id"], task)

    room_status: dict[str, dict] = {}
    rooms: dict[str, dict] = {}
    followups_by_room: dict[str, list[dict]] = {}
    for chunk in _chunks(room_ids):
        for row in (
            client.table("room_status")
            .select("room_id, status, reclean_requested_at")
            .eq("tenant_id", hotel_id)
            .in_("room_id", chunk)
            .execute()
        ).data or []:
            room_status[row["room_id"]] = row
        for row in (
            client.table("rooms").select("id, room_number, floor, building").eq("tenant_id", hotel_id).in_("id", chunk).execute()
        ).data or []:
            rooms[row["id"]] = row
        for row in (
            client.table("inspections")
            .select("id, room_id, overall_result, completed_at, reinspection_of")
            .eq("tenant_id", hotel_id)
            .in_("room_id", chunk)
            .gte("completed_at", earliest)
            .execute()
        ).data or []:
            followups_by_room.setdefault(row["room_id"], []).append(row)

    rows: list[dict] = []
    for insp in failures:
        task = tasks.get(insp["id"])
        followups = [
            f
            for f in followups_by_room.get(insp.get("room_id"), [])
            if f["id"] != insp["id"] and str(f.get("completed_at") or "") >= str(insp.get("completed_at") or "")
        ]
        derived = derive_correction_status(insp, task, room_status.get(insp.get("room_id")), followups)
        if derived is None or derived["status"] in CLOSED_CORRECTION_STATUSES:
            continue
        rows.append({"insp": insp, "task": task, "derived": derived})
    if not rows:
        return {"data": [], "meta": meta}

    fail_rows: list[dict] = []
    for chunk in _chunks([r["insp"]["id"] for r in rows]):
        fail_rows += (
            client.table("inspection_results")
            .select("inspection_id, template_item_id, note")
            .eq("tenant_id", hotel_id)
            .in_("inspection_id", chunk)
            .eq("result", "fail")
            .execute()
        ).data or []
    item_ids = sorted({r["template_item_id"] for r in fail_rows if r.get("template_item_id")})
    labels: dict[str, str] = {}
    for chunk in _chunks(item_ids):
        for item in client.table("inspection_template_items").select("id, description").in_("id", chunk).execute().data or []:
            labels[item["id"]] = item["description"]
    failed_by_inspection: dict[str, list[dict]] = {}
    for result in fail_rows:
        note = (result.get("note") or "").strip()
        label = labels.get(result.get("template_item_id")) or note
        if label:
            failed_by_inspection.setdefault(result["inspection_id"], []).append(
                {"id": result.get("template_item_id"), "label": label, "note": note if note and note != label else None}
            )

    people = sorted(
        {r["insp"].get("inspected_by") for r in rows if r["insp"].get("inspected_by")}
        | {r["task"].get("assigned_to") for r in rows if r["task"] and r["task"].get("assigned_to")}
    )
    names: dict[str, str] = {}
    for chunk in _chunks(people):
        for profile in (
            client.table("user_profiles")
            .select("id, preferred_name, full_name")
            .eq("tenant_id", hotel_id)
            .in_("id", chunk)
            .execute()
        ).data or []:
            name = profile.get("preferred_name") or profile.get("full_name")
            if name:
                names[profile["id"]] = name

    data = []
    for entry in rows:
        insp, task, derived = entry["insp"], entry["task"], entry["derived"]
        room = rooms.get(insp.get("room_id")) or {}
        failed_items = failed_by_inspection.get(insp["id"], [])
        data.append(
            {
                "inspection_id": insp["id"],
                "room_id": insp.get("room_id"),
                "room_number": room.get("room_number"),
                "floor": room.get("floor"),
                "building": room.get("building"),
                "inspected_at": insp.get("completed_at"),
                "overall_result": insp.get("overall_result"),
                "kind": insp.get("correction_kind"),
                "status": derived["status"],
                "notes": (insp.get("notes") or "").strip() or None,
                "inspector_name": names.get(insp.get("inspected_by")),
                "failed_count": len(failed_items),
                "failed_items": failed_items[:_FAILED_ITEMS_SHOWN],
                "task": (
                    {
                        "id": task.get("id"),
                        "status": task.get("status"),
                        "assigned_to": task.get("assigned_to"),
                        "assigned_name": names.get(task.get("assigned_to")),
                        "due_at": task.get("due_at"),
                        "started_at": task.get("started_at"),
                        "completed_at": task.get("completed_at"),
                    }
                    if task
                    else None
                ),
            }
        )
    return {"data": data, "meta": meta}
