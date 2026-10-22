import asyncio
import json
import logging
import re
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Form
from typing import Optional
from datetime import date, datetime, time, timedelta, timezone
from dateutil import tz
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import (
    CompleteInspectionRequest,
    CreateAssignmentsRequest,
    EscalateCorrectionRequest,
    ReassignCorrectionRequest,
    RoomAssignmentItem,
    SubmitInspectionRequest,
    BatchRoomReadinessRequest,
    EndShiftSummaryRequest,
)
from core.database import supabase
from core.errors import CodedHTTPException
from services.reclean_corrections import (
    ACTION_ESCALATED,
    ACTION_REASSIGNED,
    correction_state,
    ensure_correction_task,
    escalate_correction,
    fetch_correction_task,
    is_unique_violation,
    latest_clean_cycles,
    list_correction_owners,
    list_open_corrections,
    load_inspection_detail,
    load_reclean_details,
    reassign_correction,
    record_correction_audit,
    resolve_correction_task,
    profile_name,
)
from services.inspection_rules import (
    RuleViolation,
    sort_template_items,
    template_applies_to_room,
    template_fingerprint,
    validate_answers,
    validate_photo_links,
)
from services.notify import send_push
from services.settings_audit import record_settings_event
from services.housekeeping_assignments import effective_room_status, room_status_for_clean_type
from services.opera_pdf import parse_hk_details, parse_task_sheet
from services.ai.predictions import count_rooms_ahead, notify_supervisors_high_risk
from services.programs.contracts import experience_band, select_inspection_sample
from routers.hotels import DEFAULT_HOUSEKEEPING_ASSIGNMENT_PREFERENCES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/housekeeping", tags=["housekeeping"])

CLEAN_TYPE_LABELS = {
    "DEP": "Departure Clean",
    "FULL": "Full Linen Change",
    "LIGHT": "Light Service",
}
TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX = "task_sheet_clean_type="
STAYOVER_OVERRIDE_NOTE = "stayover"
STANDARD_INSPECTION_TEMPLATE_ITEMS = [
    ("Bathroom", "Bathroom clean and sanitized", True),
    ("Bathroom", "Towels fresh and folded", True),
    ("Sleeping Area", "Bed made, linens fresh", True),
    ("Sleeping Area", "Pillows properly arranged", False),
    ("General", "Floors clean and vacuumed", True),
    ("General", "Amenities restocked", True),
]
ALLOWED_INSPECTION_PHOTO_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
MAX_INSPECTION_PHOTO_BYTES = 5 * 1024 * 1024

HOTEL_ACTIVITY_TIMEZONE = tz.gettz("America/Chicago") or timezone(timedelta(hours=-6))


def _hotel_zone(hotel_id: str):
    result = supabase.table("tenants").select("timezone").eq("id", hotel_id).maybe_single().execute()
    name = ((result.data if result else None) or {}).get("timezone") or "America/Chicago"
    return tz.gettz(name) or HOTEL_ACTIVITY_TIMEZONE


def _hotel_reporting_window(start_date: date, end_date: date, zone) -> tuple[str, str]:
    """[start local midnight, day after end local midnight) in UTC, including DST transitions."""
    start = datetime.combine(start_date, time.min, tzinfo=zone).astimezone(timezone.utc)
    end = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc)
    return start.isoformat(), end.isoformat()


def _is_missing_clean_type_column_error(exc: Exception) -> bool:
    err = str(exc)
    return ("42703" in err or "PGRST204" in err) and "clean_type" in err


def _is_missing_stripped_column_error(exc: Exception) -> bool:
    err = str(exc)
    return ("42703" in err or "PGRST204" in err) and "stripped" in err


def _is_missing_stay_reset_column_error(exc: Exception) -> bool:
    err = str(exc)
    return ("42703" in err or "PGRST204" in err) and "stay_reset_at" in err


def _without_clean_type(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "clean_type"}


def _without_stripped(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if k not in ("stripped", "stripped_by", "stripped_at")}


def _execute_room_status_clean_type_write(payload: dict, build_query):
    try:
        return build_query(payload).execute()
    except Exception as exc:
        if "clean_type" in payload and _is_missing_clean_type_column_error(exc):
            logger.warning("room_status.clean_type column missing; retrying room_status write without clean_type")
            fallback = _without_clean_type(payload)
            try:
                return build_query(fallback).execute()
            except Exception as exc2:
                if _is_missing_stripped_column_error(exc2) and any(k in fallback for k in ("stripped", "stripped_by", "stripped_at")):
                    logger.warning("room_status.stripped column missing; retrying without stripped")
                    return build_query(_without_stripped(fallback)).execute()
                raise
        if _is_missing_stripped_column_error(exc) and any(k in payload for k in ("stripped", "stripped_by", "stripped_at")):
            logger.warning("room_status.stripped column missing; retrying room_status write without stripped")
            return build_query(_without_stripped(payload)).execute()
        raise


def _ensure_tenant_row(table: str, row_id: str, hotel_id: str, label: str) -> None:
    result = supabase.table(table)\
        .select("id")\
        .eq("id", row_id)\
        .eq("tenant_id", hotel_id)\
        .maybe_single()\
        .execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _ensure_housekeeper(user_id: str, hotel_id: str) -> None:
    result = supabase.table("user_roles")\
        .select("id")\
        .eq("user_id", user_id)\
        .eq("tenant_id", hotel_id)\
        .in_("role", ["housekeeper", "housekeeping_supervisor"])\
        .eq("is_active", True)\
        .limit(1)\
        .execute()
    if result.data:
        return
    raise HTTPException(status_code=404, detail="Housekeeper not found")


def _active_housekeepers(hotel_id: str, target_date: date) -> list[str]:
    """Candidate housekeeper ids for a given date: prefer today's
    shift_assignments, falling back to all active housekeeper/supervisor
    user_roles. Ids only (this call site doesn't need names) — mirrors the
    same fallback chain suggest_assignments already uses."""
    hk_rows = (
        supabase.table("shift_assignments")
        .select("user_id")
        .eq("tenant_id", hotel_id)
        .eq("work_date", target_date.isoformat())
        .execute()
    ).data or []
    ids = list({row["user_id"] for row in hk_rows if row.get("user_id")})
    if ids:
        return ids

    fallback_rows = (
        supabase.table("user_roles")
        .select("user_id")
        .eq("tenant_id", hotel_id)
        .in_("role", ["housekeeper", "housekeeping_supervisor"])
        .eq("is_active", True)
        .execute()
    ).data or []
    return list({row["user_id"] for row in fallback_rows if row.get("user_id")})


def _fetch_room_prediction_or_404(room_id: str, hotel_id: str, columns: str = "*") -> dict:
    result = (
        supabase.table("room_readiness_predictions")
        .select(columns)
        .eq("room_id", room_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Prediction not found")
    return result.data


def _clean_type_payload(clean_type: str | None) -> dict:
    if not clean_type:
        return {"clean_type": None, "clean_type_label": None}
    return {
        "clean_type": clean_type,
        "clean_type_label": CLEAN_TYPE_LABELS.get(clean_type, clean_type),
    }


def _task_sheet_clean_type_note(clean_type: str) -> str:
    return f"{TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX}{clean_type}"


def _insert_standard_inspection_items(template_id: str, tenant_id: str) -> list[dict]:
    items_data = [
        {
            "template_id": template_id,
            "tenant_id": tenant_id,
            "section": section,
            "description": description,
            "is_required": is_required,
            "requires_photo_on_fail": False,
            "sort_order": idx,
        }
        for idx, (section, description, is_required) in enumerate(
            STANDARD_INSPECTION_TEMPLATE_ITEMS,
            start=1,
        )
    ]
    items = supabase.table("inspection_template_items").insert(items_data).execute()
    return items.data or []


def _create_standard_inspection_template(tenant_id: str) -> dict:
    tmpl = (
        supabase.table("inspection_templates")
        .insert({
            "tenant_id": tenant_id,
            "name": "Standard Room Inspection",
            "room_type_id": None,
            "is_default": True,
            "is_active": True,
        })
        .execute()
    )
    template = tmpl.data[0]
    return {
        **template,
        "items": _insert_standard_inspection_items(template["id"], tenant_id),
    }


def _clean_type_from_task_sheet_note(note: str | None) -> str | None:
    if not note or not note.startswith(TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX):
        return None
    clean_type = note.removeprefix(TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX).strip().upper()
    return clean_type if clean_type in CLEAN_TYPE_LABELS else None


def _activity_day_window_utc(activity_date: date) -> tuple[str, str]:
    local_start = datetime.combine(activity_date, time.min, tzinfo=HOTEL_ACTIVITY_TIMEZONE)
    local_end = local_start + timedelta(days=1)
    return (
        local_start.astimezone(timezone.utc).isoformat(),
        local_end.astimezone(timezone.utc).isoformat(),
    )


def _clear_import_history_markers(hotel_id: str, assignment_date: str) -> None:
    try:
        activity_date = date.fromisoformat(assignment_date)
    except ValueError:
        logger.warning("Invalid assignment_date on import marker cleanup: %s", assignment_date)
        return

    activity_start, activity_end = _activity_day_window_utc(activity_date)
    marker_queries = (
        lambda: supabase.table("room_status_history")
        .delete()
        .eq("tenant_id", hotel_id)
        .gte("created_at", activity_start)
        .lt("created_at", activity_end)
        .like("notes", f"{TASK_SHEET_CLEAN_TYPE_NOTE_PREFIX}%"),
        lambda: supabase.table("room_status_history")
        .delete()
        .eq("tenant_id", hotel_id)
        .gte("created_at", activity_start)
        .lt("created_at", activity_end)
        .eq("notes", STAYOVER_OVERRIDE_NOTE),
    )

    for build_query in marker_queries:
        build_query().execute()


def _build_opera_import_preview(rows: list, warnings: list[str], hotel_id: str, import_kind: str) -> dict:
    """Calculate an import against live room state without writing anything."""
    rooms = supabase.table("rooms").select("id, room_number").eq("tenant_id", hotel_id).execute()
    room_map = {row["room_number"]: row["id"] for row in (rooms.data or [])}
    statuses = supabase.table("room_status").select("room_id, status, fo_status, clean_type, checkout_time").eq("tenant_id", hotel_id).execute()
    status_map = {row["room_id"]: row for row in (statuses.data or [])}
    changes: list[dict] = []
    not_found: list[str] = []
    skipped_active = 0
    unchanged = 0

    for row in rows:
        room_id = room_map.get(row.room_number)
        if not room_id:
            not_found.append(row.room_number or "(missing room number)")
            continue
        current = status_map.get(room_id, {})
        if current.get("status") == "IN_PROGRESS":
            skipped_active += 1
            continue
        if import_kind == "hk-details":
            desired = {
                "status": "OCCUPIED" if row.our_status == "DIRTY" and row.fo_status == "OCC" else row.our_status,
                "fo_status": row.fo_status,
                "clean_type": None,
                "checkout_time": None,
            }
        else:
            fo_status = row.fo_status or current.get("fo_status")
            reservation_status = (row.reservation_status or "").lower()
            desired_status = current.get("status") or "DIRTY"
            if row.clean_type == "DEP":
                desired_status = "OCCUPIED" if fo_status == "OCC" else "DIRTY"
            elif fo_status == "OCC" and ("stayover" in reservation_status or "arrived" in reservation_status):
                desired_status = "PICKUP"
            desired = {"status": desired_status, "fo_status": fo_status, "clean_type": row.clean_type or current.get("clean_type")}
        row_changes = [
            {"field": field, "before": current.get(field), "after": after}
            for field, after in desired.items() if current.get(field) != after
        ]
        if row_changes:
            changes.append({"room_id": room_id, "room_number": row.room_number, "changes": row_changes})
        else:
            unchanged += 1

    result_warnings = list(warnings)
    result_warnings.extend(f"Room {room_number}: no matching PatelRep room" for room_number in not_found)
    if skipped_active:
        result_warnings.append(f"{skipped_active} active room(s) will be skipped")
    return {
        "total_parsed": len(rows), "will_update": len(changes), "unchanged": unchanged,
        "not_found": len(not_found), "skipped_active": skipped_active,
        "changes": changes, "warnings": result_warnings,
    }


def _attach_task_sheet_clean_types(rows: list[dict], hotel_id: str, activity_date: date) -> list[dict]:
    room_ids = [row.get("room_id") for row in rows if row.get("room_id")]
    if not room_ids:
        return rows

    activity_start, activity_end = _activity_day_window_utc(activity_date)
    history_result = (
        supabase.table("room_status_history")
        .select("room_id, notes, created_at")
        .eq("tenant_id", hotel_id)
        .in_("room_id", room_ids)
        .gte("created_at", activity_start)
        .lt("created_at", activity_end)
        .order("created_at", desc=True)
        .limit(max(len(room_ids) * 4, 50))
        .execute()
    )

    stayover_rooms: set[str] = set()
    imported_clean_type_by_room: dict[str, str] = {}
    for history_row in history_result.data or []:
        room_id = history_row.get("room_id")
        if not room_id:
            continue
        notes = history_row.get("notes") or ""
        if notes == STAYOVER_OVERRIDE_NOTE:
            stayover_rooms.add(room_id)
            continue
        if room_id in stayover_rooms or room_id in imported_clean_type_by_room:
            continue
        clean_type = _clean_type_from_task_sheet_note(notes)
        if clean_type:
            imported_clean_type_by_room[room_id] = clean_type

    for row in rows:
        room_id = row.get("room_id")
        if room_id in stayover_rooms:
            row["clean_type"] = None
            row.pop("clean_type_label", None)
            continue
        # Checked-out rooms already have their status/clean_type set by the checkout
        # endpoint (DEP). Task-sheet imports from earlier today must not override them.
        if row.get("actual_checkout_at"):
            continue
        history_ct = imported_clean_type_by_room.get(room_id)
        clean_type = history_ct or row.get("clean_type")
        if not clean_type:
            continue
        row["clean_type"] = clean_type
        row["clean_type_label"] = CLEAN_TYPE_LABELS.get(clean_type, clean_type)
        row["status"] = effective_room_status(row.get("status"), clean_type, row.get("fo_status"))

    return rows


def _attach_room_activity(rows: list[dict], hotel_id: str, activity_date: date) -> list[dict]:
    room_ids = [row.get("room_id") for row in rows if row.get("room_id")]
    if not room_ids:
        return rows

    activity_start, activity_end = _activity_day_window_utc(activity_date)

    # DISTINCT ON (room_id) in the DB — no date lower bound, works for stays of
    # any length. stay_reset_at join enforces the DEP-inspection boundary per room.
    latest_note_by_room: dict[str, dict] = {}
    try:
        note_result = supabase.rpc("get_latest_room_notes", {
            "p_tenant_id": hotel_id,
            "p_room_ids": room_ids,
            "p_activity_end": activity_end,
        }).execute()
        for note in note_result.data or []:
            room_id = note.get("room_id")
            note_text = (note.get("notes") or "").strip()
            if room_id and note_text:
                latest_note_by_room[room_id] = note
    except Exception as exc:
        logger.warning("get_latest_room_notes RPC unavailable, falling back to today-only scan (run migration 063): %s", exc)
        try:
            rs_result = (
                supabase.table("room_status")
                .select("room_id, stay_reset_at")
                .eq("tenant_id", hotel_id)
                .in_("room_id", room_ids)
                .execute()
            )
            stay_reset_by_room: dict[str, str | None] = {
                r["room_id"]: r.get("stay_reset_at") for r in (rs_result.data or [])
            }
        except Exception:
            stay_reset_by_room = {rid: None for rid in room_ids}
        note_fallback = (
            supabase.table("room_status_history")
            .select("room_id, notes, from_status, to_status, changed_by, change_source, created_at")
            .eq("tenant_id", hotel_id)
            .in_("room_id", room_ids)
            .gte("created_at", activity_start)
            .lt("created_at", activity_end)
            .order("created_at", desc=True)
            .limit(max(len(room_ids) * 4, 50))
            .execute()
        )
        for note in note_fallback.data or []:
            room_id = note.get("room_id")
            note_text = (note.get("notes") or "").strip()
            from_status = note.get("from_status")
            to_status = note.get("to_status")
            if _clean_type_from_task_sheet_note(note_text) is not None:
                continue
            is_staff_note = (
                bool(note.get("changed_by"))
                and note.get("change_source", "app") == "app"
                and bool(from_status)
                and from_status == to_status
            )
            room_reset = stay_reset_by_room.get(room_id)
            if room_reset and (note.get("created_at") or "") < room_reset:
                continue
            if room_id and note_text and is_staff_note and room_id not in latest_note_by_room:
                latest_note_by_room[room_id] = note

    open_work_order_by_room: dict[str, dict] = {}
    work_order_result = (
        supabase.table("work_orders")
        .select("id, room_id, work_order_number, title, priority, status, created_at")
        .eq("tenant_id", hotel_id)
        .in_("room_id", room_ids)
        .in_("status", ["open", "in_progress", "on_hold"])
        .order("created_at", desc=True)
        .limit(max(len(room_ids) * 2, 50))
        .execute()
    )
    for work_order in work_order_result.data or []:
        room_id = work_order.get("room_id")
        if room_id and room_id not in open_work_order_by_room:
            open_work_order_by_room[room_id] = work_order

    # Phase 8: open occupancy discrepancies, joined onto the same rows so board
    # and my-rooms both get the attention/blocking signal without a second call.
    open_discrepancy_by_room: dict[str, dict] = {}
    discrepancy_result = (
        supabase.table("room_occupancy_discrepancies")
        .select("id, room_id, housekeeping_observed, pms_status_at_report, reported_at")
        .eq("tenant_id", hotel_id)
        .eq("status", "open")
        .in_("room_id", room_ids)
        .order("reported_at", desc=True)
        .execute()
    )
    for discrepancy in discrepancy_result.data or []:
        room_id = discrepancy.get("room_id")
        if room_id and room_id not in open_discrepancy_by_room:
            open_discrepancy_by_room[room_id] = discrepancy

    for row in rows:
        room_id = row.get("room_id")
        note = latest_note_by_room.get(room_id)
        work_order = open_work_order_by_room.get(room_id)
        discrepancy = open_discrepancy_by_room.get(room_id)
        row["latest_note"] = (note.get("notes") or "").strip() if note else None
        row["latest_note_at"] = note.get("created_at") if note else None
        row["open_work_order_id"] = work_order.get("id") if work_order else None
        row["open_work_order_number"] = work_order.get("work_order_number") if work_order else None
        row["open_work_order_title"] = work_order.get("title") if work_order else None
        row["open_work_order_priority"] = work_order.get("priority") if work_order else None
        row["open_work_order_status"] = work_order.get("status") if work_order else None
        row["occupancy_discrepancy"] = discrepancy is not None
        row["occupancy_discrepancy_id"] = discrepancy.get("id") if discrepancy else None
        row["occupancy_discrepancy_type"] = discrepancy.get("housekeeping_observed") if discrepancy else None
        row["occupancy_discrepancy_reported_at"] = discrepancy.get("reported_at") if discrepancy else None
    return rows


def _attach_reclean_corrections(rows: list[dict], hotel_id: str) -> list[dict]:
    """For any row flagged reclean_requested_at, attach the failed items from the
    most recent failed/conditional inspection so the housekeeper sees exactly what
    to fix (spec: "N corrections / label / label"), not just that a reclean is due.

    ``reclean_corrections`` (labels only) is kept for existing consumers;
    ``reclean_details`` adds the inspection id/time, inspector notes and the
    per-item notes."""
    reclean_room_ids = [row["room_id"] for row in rows if row.get("reclean_requested_at") and row.get("room_id")]
    if not reclean_room_ids:
        return rows

    details_by_room = load_reclean_details(supabase, hotel_id, reclean_room_ids)
    for row in rows:
        room_id = row.get("room_id")
        if not row.get("reclean_requested_at") or not room_id:
            continue
        details = details_by_room.get(room_id)
        row["reclean_details"] = details
        row["reclean_corrections"] = [item["label"] for item in (details or {}).get("items", [])]
    return rows


def _attach_inspection_required(rows: list[dict], hotel_id: str, target_date: date) -> list[dict]:
    """Mirrors GET /programs/inspection-sample's rule-driven sample (same
    room_type_id/experience_band/risk_level inputs, same select_inspection_sample
    call) so the board/drawer's Pass-vs-Fail choice and the Inspection KPI reflect
    the same sample a supervisor sees on that report -- previously this was never
    computed here at all, so room.inspectionRequired was always false and the
    Inspect action silently degraded to a single always-passing 'Mark inspected'
    button for every room, and the board's Inspection KPI always read 0."""
    assignments = (
        supabase.table("room_assignments")
        .select("room_id, assigned_to, rooms(room_type_id)")
        .eq("tenant_id", hotel_id)
        .eq("assignment_date", target_date.isoformat())
        .execute()
    ).data or []
    if not assignments:
        for row in rows:
            row["inspection_required"] = False
        return rows

    room_ids = [a["room_id"] for a in assignments]
    assigned_user_ids = list({a["assigned_to"] for a in assignments if a.get("assigned_to")})

    statuses = (
        supabase.table("room_status").select("room_id, risk_level")
        .eq("tenant_id", hotel_id).in_("room_id", room_ids).execute()
    ).data or []
    risk_by_room = {s["room_id"]: (s.get("risk_level") or "").upper() for s in statuses}

    profiles = (
        supabase.table("user_profiles").select("id, hire_date")
        .eq("tenant_id", hotel_id).in_("id", assigned_user_ids).execute()
    ).data or [] if assigned_user_ids else []
    hire_date_by_user = {p["id"]: p.get("hire_date") for p in profiles}

    rules = (
        supabase.table("inspection_sampling_rules").select("*").eq("tenant_id", hotel_id).execute()
    ).data or []

    rooms_for_sampling = [
        {
            "room_id": a["room_id"],
            "room_type_id": (a.get("rooms") or {}).get("room_type_id"),
            "experience_band": experience_band(hire_date_by_user.get(a.get("assigned_to")), target_date),
            "risk_level": "high" if risk_by_room.get(a["room_id"]) == "HIGH" else "standard",
        }
        for a in assignments
    ]
    selected_ids = set(select_inspection_sample(rooms=rooms_for_sampling, rules=rules))

    for row in rows:
        row["inspection_required"] = row.get("room_id") in selected_ids
    return rows


# ---------------------------------------------------------------------------
# GET /housekeeping/board helpers
# ---------------------------------------------------------------------------

def _attach_last_clean_session(rows: list[dict], hotel_id: str, activity_date: date) -> list[dict]:
    """Attach the latest completed clean session summary to each row (compact supervisor evidence)."""
    room_ids = [row.get("room_id") for row in rows if row.get("room_id")]
    if not room_ids:
        return rows

    activity_start, activity_end = _activity_day_window_utc(activity_date)

    sessions_result = (
        supabase.table("room_clean_sessions")
        .select("id, room_id, housekeeper_id, duration_seconds, base_clean_minutes, checklist_done, checklist_total, ended_at")
        .eq("tenant_id", hotel_id)
        .eq("status", "completed")
        .in_("room_id", room_ids)
        .gte("started_at", activity_start)
        .lt("started_at", activity_end)
        .order("ended_at", desc=True)
        .limit(max(len(room_ids) * 2, 50))
        .execute()
    )

    latest_by_room: dict[str, dict] = {}
    for session in sessions_result.data or []:
        room_id = session.get("room_id")
        if room_id and room_id not in latest_by_room:
            latest_by_room[room_id] = session

    session_ids = [s["id"] for s in latest_by_room.values()]
    photo_count_by_session: dict[str, int] = {}
    if session_ids:
        photos_result = (
            supabase.table("room_clean_photos")
            .select("session_id")
            .eq("tenant_id", hotel_id)
            .in_("session_id", session_ids)
            .execute()
        )
        for photo in photos_result.data or []:
            sid = photo.get("session_id")
            if sid:
                photo_count_by_session[sid] = photo_count_by_session.get(sid, 0) + 1

    for row in rows:
        room_id = row.get("room_id")
        session = latest_by_room.get(room_id)
        if session:
            duration_s = session.get("duration_seconds")
            row["last_session_id"] = session["id"]
            row["last_clean_minutes"] = round(duration_s / 60) if duration_s is not None else None
            row["last_clean_base_minutes"] = session.get("base_clean_minutes")
            row["last_clean_checklist_done"] = session.get("checklist_done", 0)
            row["last_clean_checklist_total"] = session.get("checklist_total", 0)
            row["last_clean_photo_count"] = photo_count_by_session.get(session["id"], 0)
            row["last_clean_ended_at"] = session.get("ended_at")
        else:
            row["last_session_id"] = None
            row["last_clean_minutes"] = None
            row["last_clean_base_minutes"] = None
            row["last_clean_checklist_done"] = 0
            row["last_clean_checklist_total"] = 0
            row["last_clean_photo_count"] = 0
            row["last_clean_ended_at"] = None

    return rows


# ---------------------------------------------------------------------------
# GET /housekeeping/board
# ---------------------------------------------------------------------------

@router.get("/board")
async def get_housekeeping_board(
    board_date: Optional[date] = Query(None, alias="date"),
    shift_id: Optional[str] = Query(None),
    include_predictions: bool = Query(True),
    current_user: CurrentUser = Depends(get_current_user),
):
    target_date = board_date or date.today()

    # Fetch room_status rows with joined room/room_type data.
    # supabase-py does not support ordering by joined table columns directly,
    # so we sort in Python after fetching.
    result = (
        supabase.table("room_status")
        .select(
            "*, "
            "rooms!inner(id, room_number, floor, building, "
            "room_types(name, code, base_clean_minutes))"
        )
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    rows = result.data or []

    # Sort by floor then room_number in Python
    def _sort_key(r: dict) -> tuple:
        room = r.get("rooms") or {}
        floor = room.get("floor") or 0
        room_number = room.get("room_number") or ""
        return (floor, room_number)

    rows.sort(key=_sort_key)

    assignment_query = (
        supabase.table("room_assignments")
        .select("id, room_id, assigned_to, shift_id, assignment_date, clean_type")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assignment_date", target_date.isoformat())
    )
    if shift_id:
        assignment_query = assignment_query.eq("shift_id", shift_id)

    assignment_result = assignment_query.execute()
    assignment_map = {
        assignment["room_id"]: assignment
        for assignment in (assignment_result.data or [])
        if assignment.get("room_id")
    }

    # Optionally attach predictions
    predictions = []
    if include_predictions:
        pred_result = (
            supabase.table("room_readiness_predictions")
            .select("*")
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )
        predictions = pred_result.data or []

    pred_map = {p["room_id"]: p for p in predictions}

    rooms_with_predictions = []
    for room in rows:
        assignment = assignment_map.get(room.get("room_id"))
        # When a room is checked out, room_status.clean_type (DEP) takes precedence
        # over any assignment clean_type (FULL/LIGHT), so the board shows Vacant Dirty
        # rather than incorrectly keeping the room as PICKUP.
        if room.get("actual_checkout_at"):
            clean_type = room.get("clean_type") or (assignment or {}).get("clean_type")
        else:
            clean_type = (assignment or {}).get("clean_type") or room.get("clean_type")
        rooms_with_predictions.append({
            **room,
            "status": effective_room_status(room.get("status"), clean_type, room.get("fo_status")),
            # No room_assignments row for this date — fall back to the live room_status.assigned_to mirror (ROOMSTATUS-01)
            "assigned_to": assignment.get("assigned_to") if assignment else room.get("assigned_to"),
            "assignment_id": assignment.get("id") if assignment else None,
            "assignment_date": assignment.get("assignment_date") if assignment else None,
            "assignment_shift_id": assignment.get("shift_id") if assignment else None,
            **_clean_type_payload(clean_type),
            "prediction": pred_map.get(room.get("room_id")),
        })

    _attach_task_sheet_clean_types(rooms_with_predictions, current_user.hotel_id, target_date)
    _attach_room_activity(rooms_with_predictions, current_user.hotel_id, target_date)
    _attach_last_clean_session(rooms_with_predictions, current_user.hotel_id, target_date)
    _attach_inspection_required(rooms_with_predictions, current_user.hotel_id, target_date)
    return {"data": rooms_with_predictions}


# ---------------------------------------------------------------------------
# GET /housekeeping/my-rooms
# ---------------------------------------------------------------------------

def _fetch_my_assignments(current_user: CurrentUser, target_date: date) -> list[dict]:
    try:
        assignments = (
            supabase.table("room_assignments")
            .select("id, room_id, assignment_date, clean_type, sequence_order")
            .eq("tenant_id", current_user.hotel_id)
            .eq("assigned_to", current_user.user_id)
            .eq("assignment_date", target_date.isoformat())
            .execute()
        )
    except Exception as exc:
        if not _is_missing_clean_type_column_error(exc):
            raise
        logger.warning("room_assignments.clean_type column missing; retrying without clean_type")
        assignments = (
            supabase.table("room_assignments")
            .select("id, room_id, assignment_date")
            .eq("tenant_id", current_user.hotel_id)
            .eq("assigned_to", current_user.user_id)
            .eq("assignment_date", target_date.isoformat())
            .execute()
        )
    return assignments.data or []


def _my_rooms_meta(hotel_id: str, shift_date: date) -> dict:
    """Hotel timezone + the shift date the rooms belong to, so the app can show
    deadlines and retry times in hotel-local time rather than the device's."""
    tz_name = "America/Chicago"
    try:
        result = supabase.table("tenants").select("timezone").eq("id", hotel_id).maybe_single().execute()
        tz_name = ((result.data if result else None) or {}).get("timezone") or tz_name
    except Exception:
        logger.warning("my-rooms: failed to resolve hotel timezone for hotel_id=%s; using default", hotel_id)
    if tz.gettz(tz_name) is None:
        tz_name = "America/Chicago"
    return {"timezone": tz_name, "shift_date": shift_date.isoformat()}


@router.get("/my-rooms")
async def get_my_rooms(
    assignment_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(require_role("housekeeper", "housekeeping_supervisor")),
):
    # Assignments are keyed by the hotel's local date. The client sends its
    # device-local date, which matches when the housekeeper is on property —
    # but emulators/devices on UTC roll to tomorrow after ~7 PM CT. Fall back
    # to the hotel-local date when the requested date has no assignments.
    hotel_today = datetime.now(HOTEL_ACTIVITY_TIMEZONE).date()
    today = assignment_date or hotel_today
    assignment_rows = _fetch_my_assignments(current_user, today)
    if not assignment_rows and today != hotel_today:
        logger.info(
            "my-rooms: 0 assignments for user=%s date=%s; retrying hotel-local date=%s",
            current_user.user_id, today.isoformat(), hotel_today.isoformat(),
        )
        fallback_rows = _fetch_my_assignments(current_user, hotel_today)
        if fallback_rows:
            today = hotel_today
            assignment_rows = fallback_rows
    assignment_map = {
        a["room_id"]: a
        for a in assignment_rows
        if a.get("room_id")
    }
    room_ids = list(assignment_map.keys())
    if not room_ids:
        logger.info(
            "my-rooms: 0 assignments for user=%s tenant=%s date=%s",
            current_user.user_id, current_user.hotel_id, today.isoformat(),
        )
        return {"data": [], "meta": _my_rooms_meta(current_user.hotel_id, today)}

    # Return current status for all rooms assigned today (all statuses, not filtered)
    # room_status uses room_id as PK — there is no separate "id" column
    my_rooms_select = (
        "room_id, tenant_id, status, assigned_to, updated_at, "
        "clean_type, vip_flag, dnd_flag, do_not_service, checkin_time, checkout_time, actual_checkout_at, fo_status, "
        "risk_level, predicted_ready_at, "
        "priority, priority_reason, priority_needed_by, priority_note, "
        "dnd_started_at, dnd_retry_at, dnd_attempt_count, dnd_last_attempt_at, "
        "service_declined_reason, service_declined_note, service_declined_at, "
        "reclean_requested_at, "
        "rooms!inner(id, room_number, floor, building, room_types(name, code, base_clean_minutes))"
    )
    try:
        result = (
            supabase.table("room_status")
            .select(my_rooms_select)
            .eq("tenant_id", current_user.hotel_id)
            .in_("room_id", room_ids)
            .execute()
        )
    except Exception as exc:
        if not _is_missing_clean_type_column_error(exc):
            raise
        logger.warning("room_status.clean_type column missing; retrying my-rooms select without clean_type")
        result = (
            supabase.table("room_status")
            .select(my_rooms_select.replace("clean_type, ", ""))
            .eq("tenant_id", current_user.hotel_id)
            .in_("room_id", room_ids)
            .execute()
        )
    rows = []
    for room in (result.data or []):
        assignment = assignment_map.get(room.get("room_id")) or {}
        clean_type = assignment.get("clean_type") or room.get("clean_type")
        nested_room = room.get("rooms") or {}
        nested_room_types = (nested_room.get("room_types") or {}) if isinstance(nested_room, dict) else {}
        room_id = room.get("room_id", "")
        rows.append({
            **room,
            "id": room_id,  # mobile app uses room.id for navigation / API calls
            "room_number": nested_room.get("room_number"),
            "floor": nested_room.get("floor"),
            "building": (nested_room.get("building") or None) if isinstance(nested_room, dict) else None,
            "room_type_code": nested_room_types.get("code"),
            "room_type_name": nested_room_types.get("name"),
            "status": effective_room_status(room.get("status"), clean_type, room.get("fo_status")),
            "assignment_id": assignment.get("id"),
            "assignment_date": assignment.get("assignment_date"),
            "sequence_order": assignment.get("sequence_order"),
            **_clean_type_payload(clean_type),
        })
    # AI-sequenced rooms (walking order) lead; unsequenced rooms fall back
    # to floor/room_number so the list is still stably ordered.
    rows.sort(key=lambda r: (
        r.get("sequence_order") is None,
        r.get("sequence_order") or 0,
        r.get("floor") or 0,
        r.get("room_number") or "",
    ))
    _attach_task_sheet_clean_types(rows, current_user.hotel_id, today)
    _attach_room_activity(rows, current_user.hotel_id, today)
    _attach_reclean_corrections(rows, current_user.hotel_id)
    return {"data": rows, "meta": _my_rooms_meta(current_user.hotel_id, today)}


# ---------------------------------------------------------------------------
# GET /housekeeping/assignments
# ---------------------------------------------------------------------------

@router.get("/assignments")
async def get_assignments(
    assignment_date: Optional[date] = Query(None, alias="date"),
    shift_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns all room assignments for the given date, grouped by housekeeper.
    Includes per-housekeeper room count and completion stats.
    """
    target_date = assignment_date or date.today()

    # Fetch assignments for the date (and optionally shift)
    assign_query = (
        supabase.table("room_assignments")
        .select("id, room_id, assigned_to, shift_id, assignment_date, clean_type, sequence_order, rooms(room_number, room_types(name, code))")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assignment_date", target_date.isoformat())
    )

    if shift_id:
        assign_query = assign_query.eq("shift_id", shift_id)

    assign_result = assign_query.execute()
    assignments = assign_result.data or []

    if not assignments:
        return {"data": []}

    # Fetch current room status for all assigned rooms in one query
    room_ids = list({a["room_id"] for a in assignments if a.get("room_id")})
    status_result = (
        supabase.table("room_status")
        .select("room_id, status")
        .in_("room_id", room_ids)
        .execute()
    )
    status_map = {r["room_id"]: r["status"] for r in (status_result.data or [])}

    # Group by housekeeper
    grouped: dict[str, dict] = {}
    for a in assignments:
        hk_id = a.get("assigned_to")

        if hk_id not in grouped:
            grouped[hk_id] = {
                "housekeeper_id": hk_id,
                "name": hk_id or "Unknown",
                "rooms_assigned": 0,
                "rooms_done": 0,
                "in_progress": 0,
                "rooms": [],
            }

        room_info = a.get("rooms") or {}
        rt_info = room_info.get("room_types") or {}
        status = effective_room_status(status_map.get(a.get("room_id"), ""), a.get("clean_type"))

        grouped[hk_id]["rooms"].append({
            "assignment_id": a.get("id"),
            "room_id": a.get("room_id"),
            "room_number": room_info.get("room_number", ""),
            "status": status,
            "room_type": rt_info.get("name", ""),
            "sequence_order": a.get("sequence_order"),
            **_clean_type_payload(a.get("clean_type")),
        })

        grouped[hk_id]["rooms_assigned"] += 1
        if status in ("CLEAN", "INSPECTED"):
            grouped[hk_id]["rooms_done"] += 1
        elif status == "IN_PROGRESS":
            grouped[hk_id]["in_progress"] += 1

    # Rooms with a sequence number (AI-sequenced) lead, in walking order;
    # unsequenced (manually assigned) rooms follow in their existing order.
    for group in grouped.values():
        group["rooms"].sort(
            key=lambda r: (r.get("sequence_order") is None, r.get("sequence_order") or 0)
        )

    # Fetch housekeeper names
    if grouped:
        hk_ids = list(grouped.keys())
        profiles_result = (
            supabase.table("user_profiles")
            .select("id, full_name, preferred_name")
            .in_("id", hk_ids)
            .execute()
        )
        for p in (profiles_result.data or []):
            uid = p["id"]
            if uid in grouped:
                grouped[uid]["name"] = p.get("preferred_name") or p.get("full_name") or uid

    return {"data": list(grouped.values())}


# ---------------------------------------------------------------------------
# POST /housekeeping/assignments
# ---------------------------------------------------------------------------

async def _send_assignment_push(tenant_id: str, housekeeper_id: str, room_number: str, room_id: str = "") -> None:
    """Fire-and-forget push to the housekeeper on room assignment (policy in services/notify.py)."""
    await send_push(
        tenant_id=tenant_id,
        recipient_ids=[housekeeper_id],
        event_type="room_assignment",
        title="Room Assigned",
        body=f"Room {room_number} has been assigned to you",
        data={
            "room_number": room_number,
            "url": f"/(app)/my-rooms/{room_id}" if room_id else "/(app)/my-rooms",
        },
    )


ASSIGNABLE_ROOM_STATUSES = {"DIRTY", "PICKUP", "OCCUPIED"}


def _is_conditional(item) -> bool:
    return bool(item.expect_unassigned or item.expected_assigned_to)


def _check_expected_owners(request: CreateAssignmentsRequest, hotel_id: str) -> dict[str, Optional[str]]:
    """Compare-and-set precheck for items that carry an expected owner (Room Board).

    Returns {room_id: current dated-assignment owner or None} for conditional items. Raises 409 when the room
    can no longer be (re)assigned (cleaning started/finished, out of service, unknown) or when its owner is not
    who the caller reviewed. The owner follows the board's rule: the dated row, else the room_status mirror.
    """
    conditional = [a for a in request.assignments if _is_conditional(a)]
    for a in conditional:
        if a.expect_unassigned and a.expected_assigned_to:
            raise HTTPException(status_code=422, detail="Send expected_assigned_to or expect_unassigned, not both.")
    if not conditional:
        return {}
    room_ids = [str(a.room_id) for a in conditional]
    dated_rows = supabase.table("room_assignments")        .select("room_id, assigned_to")        .eq("tenant_id", hotel_id)        .eq("assignment_date", request.date.isoformat())        .in_("room_id", room_ids)        .execute().data or []
    dated = {r["room_id"]: r.get("assigned_to") for r in dated_rows}
    status_rows = supabase.table("room_status")        .select("room_id, status, assigned_to")        .eq("tenant_id", hotel_id)        .in_("room_id", room_ids)        .execute().data or []
    status_map = {r["room_id"]: r for r in status_rows}
    for a in conditional:
        room_id = str(a.room_id)
        state = status_map.get(room_id)
        if not state or state.get("status") not in ASSIGNABLE_ROOM_STATUSES:
            raise HTTPException(status_code=409, detail="This room can no longer be assigned; refresh the board.")
        current = dated[room_id] if room_id in dated else state.get("assigned_to")
        expected = str(a.expected_assigned_to) if a.expected_assigned_to else None
        if (str(current) if current else None) != expected:
            raise HTTPException(status_code=409, detail="This room's assignment changed; refresh the board.")
    return dated


@router.post("/assignments")
async def create_assignments(
    request: CreateAssignmentsRequest,
    # front_desk included so a guest's mid-stay clean request (an occupied room)
    # can be assigned to a housekeeper directly from the room drawer, same as
    # front_desk already writes checkout time / stayover status on any room.
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor", "front_desk")
    ),
):
    if request.shift_id:
        _ensure_tenant_row("shifts", str(request.shift_id), current_user.hotel_id, "Shift")
    for assignment in request.assignments:
        _ensure_tenant_row("rooms", str(assignment.room_id), current_user.hotel_id, "Room")
        _ensure_housekeeper(str(assignment.housekeeper_id), current_user.hotel_id)
    dated_owners = _check_expected_owners(request, current_user.hotel_id)

    # Preserve clean_type already set by PDF import; only overwrite if explicitly provided
    existing_clean = supabase.table("room_assignments")\
        .select("room_id, clean_type")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("assignment_date", request.date.isoformat())\
        .in_("room_id", [str(a.room_id) for a in request.assignments])\
        .execute()
    existing_clean_map: dict[str, str | None] = {
        row["room_id"]: row.get("clean_type") for row in (existing_clean.data or [])
    }

    # Fallback: read clean_type + fo_status from room_status (set by task sheet import)
    # This handles the first save after import when no room_assignments row exists yet
    room_status_rows = supabase.table("room_status")\
        .select("room_id, clean_type, fo_status")\
        .eq("tenant_id", current_user.hotel_id)\
        .in_("room_id", [str(a.room_id) for a in request.assignments])\
        .execute()
    room_status_map: dict[str, dict] = {
        row["room_id"]: row for row in (room_status_rows.data or [])
    }

    def _resolve_clean_type(room_id: str, explicit: str | None) -> str | None:
        return (
            explicit
            or existing_clean_map.get(room_id)
            or (room_status_map.get(room_id) or {}).get("clean_type")
        )

    def _build_assignment_row(a) -> dict:
        row: dict = {
            "tenant_id": current_user.hotel_id,
            "room_id": str(a.room_id),
            "assigned_to": str(a.housekeeper_id),
            "assigned_by": current_user.user_id,
            "shift_id": str(request.shift_id) if request.shift_id else None,
            "assignment_date": request.date.isoformat(),
            "is_ai_suggested": request.is_ai_suggested,
        }
        clean_type = _resolve_clean_type(str(a.room_id), a.clean_type)
        if clean_type is not None:
            row["clean_type"] = clean_type
        # Always set explicitly (including None) so a manual re-assignment
        # clears a stale sequence number left over from a prior AI suggestion.
        row["sequence_order"] = a.sequence_order
        return row

    assignments_data = [_build_assignment_row(a) for a in request.assignments]

    plain_rows = [row for a, row in zip(request.assignments, assignments_data) if not _is_conditional(a)]
    saved_rows: list[dict] = []
    try:
        if plain_rows:
            saved_rows.extend(supabase.table("room_assignments").upsert(
                plain_rows,
                on_conflict="room_id,assignment_date",
            ).execute().data or [])
        # Conditional items are written one at a time with the write itself carrying the expected owner, so a
        # concurrent supervisor's commit between the precheck and here is a 409, never a silent overwrite.
        for a, row in zip(request.assignments, assignments_data):
            if not _is_conditional(a):
                continue
            room_id = str(a.room_id)
            current = dated_owners.get(room_id)
            if room_id in dated_owners and current:
                changes = {k: v for k, v in row.items() if k not in {"tenant_id", "room_id", "assignment_date"}}
                written = supabase.table("room_assignments")                    .update(changes)                    .eq("tenant_id", current_user.hotel_id)                    .eq("room_id", room_id)                    .eq("assignment_date", request.date.isoformat())                    .eq("assigned_to", str(current))                    .execute().data or []
                if not written:
                    raise HTTPException(status_code=409, detail="This room's assignment changed; refresh the board.")
            else:
                written = supabase.table("room_assignments").insert(row).execute().data or []
            saved_rows.extend(written)
    except HTTPException:
        raise
    except Exception as e:
        err = str(e)
        if "23505" in err or "duplicate key" in err:
            raise HTTPException(
                status_code=409,
                detail="One or more rooms are already assigned for that date.",
            )
        raise HTTPException(status_code=500, detail="Failed to save assignments. Please try again.")

    # Mirror assigned_to on room_status for quick lookups and keep Opera
    # stayover task types in the Pickup lane.
    for a in request.assignments:
        clean_type = _resolve_clean_type(str(a.room_id), a.clean_type)
        if clean_type:
            fo_status = (room_status_map.get(str(a.room_id)) or {}).get("fo_status")
            room_status = room_status_for_clean_type(clean_type, fo_status)
            _execute_room_status_clean_type_write(
                {"assigned_to": str(a.housekeeper_id), "clean_type": clean_type},
                lambda payload, room_id=str(a.room_id): supabase.table("room_status")
                    .update(payload)
                    .eq("room_id", room_id)
                    .eq("tenant_id", current_user.hotel_id),
            )
            _execute_room_status_clean_type_write(
                {"status": room_status, "clean_type": clean_type},
                lambda payload, room_id=str(a.room_id): supabase.table("room_status")
                    .update(payload)
                    .eq("room_id", room_id)
                    .eq("tenant_id", current_user.hotel_id)
                    .in_("status", ["DIRTY", "PICKUP", "OCCUPIED"]),
            )
        else:
            supabase.table("room_status")\
                .update({"assigned_to": str(a.housekeeper_id)})\
                .eq("room_id", str(a.room_id))\
                .eq("tenant_id", current_user.hotel_id)\
                .execute()

    # Fire-and-forget push notifications (never block the HTTP response)
    for a in request.assignments:
        room_info = supabase.table("rooms") \
            .select("room_number") \
            .eq("id", str(a.room_id)) \
            .eq("tenant_id", current_user.hotel_id) \
            .maybe_single().execute()
        room_number = (room_info.data or {}).get("room_number", "")
        asyncio.create_task(_send_assignment_push(current_user.hotel_id, str(a.housekeeper_id), room_number, str(a.room_id)))

    return {"data": saved_rows}


# ---------------------------------------------------------------------------
# DELETE /housekeeping/assignments/{assignment_id}
# ---------------------------------------------------------------------------

@router.delete("/assignments/{assignment_id}")
async def delete_assignment(
    assignment_id: str,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    assignment_result = (
        supabase.table("room_assignments")
        .select("id, room_id, assigned_to")
        .eq("id", assignment_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    assignment = assignment_result.data if assignment_result else None
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    delete_result = (
        supabase.table("room_assignments")
        .delete()
        .eq("id", assignment_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not (delete_result.data if delete_result else None):
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Removing an assignment only unassigns the housekeeper -- the room's clean
    # type and status describe work that still needs doing and must survive
    # the room being unassigned (e.g. so it can be handed to someone else).
    supabase.table("room_status")\
        .update({"assigned_to": None})\
        .eq("room_id", assignment.get("room_id"))\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("assigned_to", assignment.get("assigned_to"))\
        .execute()

    return {"data": {"success": True, "deleted_id": assignment_id}}


# ---------------------------------------------------------------------------
# DELETE /housekeeping/room-assignment/{room_id}
# ---------------------------------------------------------------------------
# Companion to DELETE /assignments/{assignment_id}: that endpoint requires a
# room_assignments row for the current board date. The board's "no row for
# this date" fallback (ROOMSTATUS-01, see get_housekeeping_board) can still
# surface a room as assigned via the room_status.assigned_to mirror alone
# (e.g. a stale mirror left over from a prior day, or one set by an import
# path that never wrote a dated room_assignments row) -- assignment_id is
# null for those rows, so the assign-mode UI's "Remove" action had nothing to
# call and the assignment looked stuck/invisible. This clears the mirror
# directly by room_id instead of by assignment id.

@router.delete("/room-assignment/{room_id}")
async def remove_room_assignment_mirror(
    room_id: str,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    status_result = (
        supabase.table("room_status")
        .select("room_id, assigned_to")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_status = status_result.data if status_result else None
    if not room_status:
        raise HTTPException(status_code=404, detail="Room not found")

    supabase.table("room_status")\
        .update({"assigned_to": None})\
        .eq("room_id", room_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": {"success": True, "room_id": room_id}}


# ---------------------------------------------------------------------------
# Room sequencing (floor-walk minimization)
# ---------------------------------------------------------------------------

def _room_number_position(room: dict) -> float:
    match = re.search(r"\d+", str(room.get("room_number") or ""))
    return float(match.group()) if match else 0.0


def _sequence_rooms(rooms: list[dict]) -> list[dict]:
    """
    Order a housekeeper's assigned rooms to minimize floor-walking: same
    building/floor rooms are grouped, with floor switches (elevator/stair
    trips) treated as the most expensive move after a building switch.

    Distance is a synthetic metric over (building, floor, room_number) --
    the only location fields guaranteed present on every room -- rather than
    the free-form, per-tenant `tenants.layout` JSON (most tenants never seed
    one, and its schema isn't guaranteed stable across properties).

    A housekeeper's day is usually well under 20 rooms, so nearest-neighbor
    construction + 2-opt local search in plain Python is used instead of
    standing up an OR-Tools open-path RoutingModel per housekeeper on every
    suggest-assignments call -- that's real solver overhead for a heuristic
    distance metric that doesn't need ILP-grade optimality.
    """
    n = len(rooms)
    if n <= 1:
        for i, room in enumerate(rooms):
            room["sequence"] = i + 1
        return rooms

    BUILDING_PENALTY = 500.0
    FLOOR_PENALTY = 20.0

    def _dist(a: dict, b: dict) -> float:
        d = 0.0
        if (a.get("building") or None) != (b.get("building") or None):
            d += BUILDING_PENALTY
        d += FLOOR_PENALTY * abs((a.get("floor") or 0) - (b.get("floor") or 0))
        d += abs(_room_number_position(a) - _room_number_position(b))
        return d

    dist = [[_dist(rooms[i], rooms[j]) for j in range(n)] for i in range(n)]

    start = min(
        range(n),
        key=lambda i: (
            str(rooms[i].get("building") or ""),
            rooms[i].get("floor") or 0,
            _room_number_position(rooms[i]),
        ),
    )
    unvisited = set(range(n)) - {start}
    order = [start]
    while unvisited:
        last = order[-1]
        nxt = min(unvisited, key=lambda j: dist[last][j])
        order.append(nxt)
        unvisited.remove(nxt)

    def _order_length(candidate: list[int]) -> float:
        return sum(dist[candidate[k]][candidate[k + 1]] for k in range(len(candidate) - 1))

    max_passes = 25
    for _ in range(max_passes):
        improved = False
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                if j - i == 1:
                    continue
                candidate = order[:i] + order[i:j][::-1] + order[j:]
                if _order_length(candidate) < _order_length(order) - 1e-9:
                    order = candidate
                    improved = True
        if not improved:
            break

    sequenced = []
    for seq, idx in enumerate(order, start=1):
        room = rooms[idx]
        room["sequence"] = seq
        sequenced.append(room)
    return sequenced


# ---------------------------------------------------------------------------
# POST /housekeeping/ai-suggest-assignments
# ---------------------------------------------------------------------------

@router.post("/ai-suggest-assignments")
async def suggest_assignments(
    board_date: Optional[date] = Query(None, alias="date"),
    shift_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    """
    OR-Tools CP-SAT assignment suggester.

    Algorithm:
    1. Fetch all DIRTY / IN_PROGRESS / PICKUP rooms needing assignment.
    2. Fetch active housekeepers on shift (shift_assignments for work_date=today).
    3. Look up each housekeeper's actual rolling-average clean time per room
       type from housekeeper_profiles, falling back to the room type's
       base_clean_minutes when no profile exists yet.
    4. Solve a CP-SAT assignment: every room goes to exactly one housekeeper,
       minimizing (in priority order) the busiest housekeeper's total minutes
       (fairness/makespan), then total minutes across everyone (efficiency —
       rewards routing a room to whoever is actually fastest at that room
       type), then the number of distinct buildings any one housekeeper
       touches (soft building-affinity). VIP rooms get no special-cased
       sequencing here — the old greedy "VIP first" step only existed to
       avoid starving a late-assigned housekeeper, and the global optimizer
       already prevents that by construction.
    5. Return suggestions (not committed to DB).
    """
    target_date = board_date or date.today()

    # --- 1. Rooms needing work (include building for proximity grouping) ---
    rooms_result = (
        supabase.table("room_status")
        .select(
            "room_id, status, vip_flag, checkin_time, dnd_flag, dnd_retry_at, do_not_service, assigned_to, priority, priority_reason, "
            "rooms(id, room_number, floor, building, room_types(id, name, code, base_clean_minutes))"
        )
        .eq("tenant_id", current_user.hotel_id)
        .in_("status", ["DIRTY", "IN_PROGRESS", "PICKUP"])
        .execute()
    )
    all_rooms = rooms_result.data or []

    # Phase 8: don't route immediate cleaning work to a room nobody can enter
    # right now. Return-later rooms (dnd_flag already false by then) are left
    # in the pool -- there's no time-windowed scheduling in this solver to
    # sequence them after their return time.
    open_discrepancy_rooms: set[str] = set()
    if all_rooms:
        discrepancy_result = (
            supabase.table("room_occupancy_discrepancies")
            .select("room_id")
            .eq("tenant_id", current_user.hotel_id)
            .eq("status", "open")
            .in_("room_id", [r["room_id"] for r in all_rooms])
            .execute()
        )
        open_discrepancy_rooms = {d["room_id"] for d in (discrepancy_result.data or []) if d.get("room_id")}

    now = datetime.now(timezone.utc)
    def _return_later_in_future(room: dict) -> bool:
        retry_at = room.get("dnd_retry_at")
        if not retry_at:
            return False
        try:
            return datetime.fromisoformat(str(retry_at).replace("Z", "+00:00")) > now
        except ValueError:
            return False

    rooms = [
        r for r in all_rooms
        if not r.get("dnd_flag") and not r.get("do_not_service") and r.get("room_id") not in open_discrepancy_rooms and not _return_later_in_future(r)
    ]
    blocked_room_count = len(all_rooms) - len(rooms)

    if not rooms:
        message = (
            f"All {blocked_room_count} open room(s) are currently blocked (DND, service declined, "
            "or an unresolved occupancy discrepancy) — nothing to assign"
            if blocked_room_count else "No rooms currently need assignment"
        )
        return {
            "data": {
                "suggestions": [],
                "blocked_rooms": blocked_room_count,
                "message": message,
            }
        }

    # --- 2. Active housekeepers on shift (fallback: all active housekeeper profiles) ---
    hk_query = (
        supabase.table("shift_assignments")
        .select("user_id")
        .eq("tenant_id", current_user.hotel_id)
        .eq("work_date", target_date.isoformat())
    )
    if shift_id:
        hk_query = hk_query.eq("shift_id", shift_id)

    hk_result = hk_query.execute()
    hk_rows = hk_result.data or []

    housekeepers = []
    seen_user_ids: set[str] = set()
    for row in hk_rows:
        uid = row.get("user_id")
        if uid and uid not in seen_user_ids:
            seen_user_ids.add(uid)
            housekeepers.append({
                "id": uid,
                "full_name": "",
                "preferred_name": "",
                "assigned_rooms": [],
                "assigned_minutes": 0,
                "building_affinity": None,
            })

    if not housekeepers:
        # No shift records — fall back to all active housekeeper/supervisor roles.
        # Matches the same source as extractAssignableStaff on the mobile client.
        # user_roles and user_profiles have no direct FK Postgrest can embed
        # (see routers/staff.py::list_staff for the same two-step fetch pattern),
        # so profiles are batch-fetched separately by id rather than embedded.
        fallback_result = (
            supabase.table("user_roles")
            .select("user_id")
            .eq("tenant_id", current_user.hotel_id)
            .in_("role", ["housekeeper", "housekeeping_supervisor"])
            .eq("is_active", True)
            .execute()
        )
        fallback_rows = fallback_result.data or []
        fallback_user_ids = list({row["user_id"] for row in fallback_rows if row.get("user_id")})

        profiles_map: dict = {}
        if fallback_user_ids:
            profiles_result = (
                supabase.table("user_profiles")
                .select("id, full_name, preferred_name")
                .in_("id", fallback_user_ids)
                .execute()
            )
            profiles_map = {p["id"]: p for p in (profiles_result.data or [])}

        for row in fallback_rows:
            uid = row.get("user_id")
            profile = profiles_map.get(uid, {})
            if uid and uid not in seen_user_ids:
                seen_user_ids.add(uid)
                housekeepers.append({
                    "id": uid,
                    "full_name": profile.get("full_name") or "",
                    "preferred_name": profile.get("preferred_name") or "",
                    "assigned_rooms": [],
                    "assigned_minutes": 0,
                    "building_affinity": None,
                })

    if not housekeepers:
        return {
            "data": {
                "suggestions": [],
                "message": "No active housekeepers found for this property",
            }
        }

    # Property settings are optional on legacy tenants. Merge every persisted
    # value over the documented defaults before the solver sees it.
    settings_result = (
        supabase.table("tenants")
        .select("housekeeping_assignment_preferences")
        .eq("id", current_user.hotel_id)
        .execute()
    )
    settings_rows = settings_result.data or []
    persisted_preferences = (settings_rows[0] if settings_rows else {}).get("housekeeping_assignment_preferences")
    preferences = {
        **DEFAULT_HOUSEKEEPING_ASSIGNMENT_PREFERENCES,
        **({key: value for key, value in persisted_preferences.items() if key in DEFAULT_HOUSEKEEPING_ASSIGNMENT_PREFERENCES and isinstance(value, bool)} if isinstance(persisted_preferences, dict) else {}),
    }

    # A scheduled staff member is normally available; a live shift session
    # refines that answer. The same status interpretation powers the web roster.
    housekeeper_ids = [hk["id"] for hk in housekeepers]
    sessions_result = (
        supabase.table("hk_shift_sessions")
        .select("user_id, status, started_at")
        .eq("tenant_id", current_user.hotel_id)
        .in_("user_id", housekeeper_ids)
        .execute()
    )
    latest_session_by_user: dict[str, dict] = {}
    for session in sessions_result.data or []:
        uid = session.get("user_id")
        if uid and uid not in latest_session_by_user:
            latest_session_by_user[uid] = session

    excluded_staff = []
    eligible_housekeepers = []
    for hk in housekeepers:
        session_status = (latest_session_by_user.get(hk["id"]) or {}).get("status")
        if session_status == "ended" and preferences["exclude_off_shift"]:
            excluded_staff.append({"id": hk["id"], "reason": "off_shift"})
            continue
        if session_status == "on_break" and preferences["avoid_on_break"]:
            excluded_staff.append({"id": hk["id"], "reason": "on_break"})
            continue
        eligible_housekeepers.append(hk)
    housekeepers = eligible_housekeepers
    if not housekeepers:
        return {"data": {"suggestions": [], "blocked_rooms": blocked_room_count, "excluded_staff": excluded_staff, "message": "No eligible housekeepers are currently available for new assignments"}}

    # --- 3. Per-housekeeper, per-room-type speed profiles (fallback: room type default) ---
    room_type_ids = list({
        ((r.get("rooms") or {}).get("room_types") or {}).get("id")
        for r in rooms
        if ((r.get("rooms") or {}).get("room_types") or {}).get("id")
    })
    hk_ids_for_profiles = [hk["id"] for hk in housekeepers]

    profile_minutes: dict[tuple[str, str], float] = {}
    if room_type_ids and hk_ids_for_profiles:
        profiles_result = (
            supabase.table("housekeeper_profiles")
            .select("user_id, room_type_id, avg_clean_minutes")
            .eq("tenant_id", current_user.hotel_id)
            .in_("user_id", hk_ids_for_profiles)
            .in_("room_type_id", room_type_ids)
            .execute()
        )
        for p in (profiles_result.data or []):
            minutes = p.get("avg_clean_minutes")
            if minutes:
                profile_minutes[(p["user_id"], p["room_type_id"])] = float(minutes)

    def _duration_minutes(hk_id: str, room: dict) -> int:
        info = room.get("rooms") or {}
        rt_info = info.get("room_types") or {}
        base_minutes = rt_info.get("base_clean_minutes") or 30
        room_type_id = rt_info.get("id")
        actual = profile_minutes.get((hk_id, room_type_id)) if room_type_id else None
        return max(1, round(actual if actual else base_minutes))

    # --- 4. CP-SAT assignment: minimize (fairness, then efficiency, then building spread) ---
    from ortools.sat.python import cp_model

    model = cp_model.CpModel()
    n_hk = len(housekeepers)
    n_rooms = len(rooms)

    durations = [
        [_duration_minutes(hk["id"], room) for room in rooms]
        for hk in housekeepers
    ]
    buildings_sorted = sorted({
        (room.get("rooms") or {}).get("building") or "unknown" for room in rooms
    })
    room_building_idx = [
        buildings_sorted.index((room.get("rooms") or {}).get("building") or "unknown")
        for room in rooms
    ]

    x = {
        (h, r): model.NewBoolVar(f"x_{h}_{r}")
        for h in range(n_hk)
        for r in range(n_rooms)
    }
    for r in range(n_rooms):
        model.AddExactlyOne(x[h, r] for h in range(n_hk))

    max_possible_minutes = sum(max(col) for col in zip(*durations))
    load_vars = []
    for h in range(n_hk):
        load = model.NewIntVar(0, max(max_possible_minutes, 1), f"load_{h}")
        model.Add(load == sum(durations[h][r] * x[h, r] for r in range(n_rooms)))
        load_vars.append(load)

    max_load = model.NewIntVar(0, max(max_possible_minutes, 1), "max_load")
    model.AddMaxEquality(max_load, load_vars)

    # Soft travel affinity: room-level assignments remain deterministic but can
    # prefer fewer building/floor changes when an operator enables either rule.
    building_spread_terms = []
    for h in range(n_hk):
        touches_building = []
        for b_idx in range(len(buildings_sorted)):
            room_idxs = [r for r in range(n_rooms) if room_building_idx[r] == b_idx]
            if not room_idxs:
                continue
            touches = model.NewBoolVar(f"touch_{h}_{b_idx}")
            model.AddMaxEquality(touches, [x[h, r] for r in room_idxs])
            touches_building.append(touches)
        if touches_building and preferences["prefer_same_building"]:
            building_spread_terms.append(sum(touches_building))

    floor_spread_terms = []
    floors_sorted = sorted({(room.get("rooms") or {}).get("floor") for room in rooms if (room.get("rooms") or {}).get("floor") is not None})
    if preferences["prefer_same_floor"]:
        for h in range(n_hk):
            touches_floor = []
            for floor in floors_sorted:
                room_idxs = [r for r in range(n_rooms) if (rooms[r].get("rooms") or {}).get("floor") == floor]
                touches = model.NewBoolVar(f"floor_touch_{h}_{floor}")
                model.AddMaxEquality(touches, [x[h, r] for r in room_idxs])
                touches_floor.append(touches)
            if touches_floor:
                floor_spread_terms.append(sum(touches_floor))

    reassignment_terms = []
    if preferences["minimize_reassignment"]:
        for r, room in enumerate(rooms):
            current_owner = room.get("assigned_to")
            if not current_owner:
                continue
            owner_index = next((h for h, hk in enumerate(housekeepers) if hk["id"] == current_owner), None)
            if owner_index is not None:
                reassignment_terms.append(1 - x[owner_index, r])

    # Priority order: fairness (max_load) >> efficiency (total minutes) >> building spread.
    model.Minimize(
        (max_load * 10_000 if preferences["balance_workload"] else 0)
        + sum(load_vars) * 10
        + (sum(building_spread_terms) if building_spread_terms else 0)
        + (sum(floor_spread_terms) if floor_spread_terms else 0)
        + (sum(reassignment_terms) * 100 if reassignment_terms else 0)
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    for hk in housekeepers:
        hk["assigned_rooms"] = []
        hk["assigned_minutes"] = 0

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for r, room in enumerate(rooms):
            for h in range(n_hk):
                if solver.Value(x[h, r]):
                    info = room.get("rooms") or {}
                    rt_info = info.get("room_types") or {}
                    minutes = durations[h][r]
                    housekeepers[h]["assigned_rooms"].append({
                        "room_id": room.get("room_id"),
                        "room_number": info.get("room_number", ""),
                        "floor": info.get("floor"),
                        "building": info.get("building"),
                        "status": room.get("status"),
                        "room_type": rt_info.get("code", rt_info.get("name", "")),
                        "base_clean_minutes": minutes,
                        "is_vip": room.get("vip_flag", False),
                    })
                    housekeepers[h]["assigned_minutes"] += minutes
                    break
    else:
        # Exactly-one-per-room is always feasible with n_hk >= 1 (guaranteed above),
        # but never leave the board unassigned if the solver somehow times out short.
        for room in rooms:
            info = room.get("rooms") or {}
            rt_info = info.get("room_types") or {}
            target = min(housekeepers, key=lambda h: h["assigned_minutes"])
            minutes = rt_info.get("base_clean_minutes") or 30
            target["assigned_rooms"].append({
                "room_id": room.get("room_id"),
                "room_number": info.get("room_number", ""),
                "floor": info.get("floor"),
                "building": info.get("building"),
                "status": room.get("status"),
                "room_type": rt_info.get("code", rt_info.get("name", "")),
                "base_clean_minutes": minutes,
                "is_vip": room.get("vip_flag", False),
            })
            target["assigned_minutes"] += minutes

    # --- 5. Sequence each housekeeper's rooms into a walking order ---
    def _priority_key(room: dict) -> tuple:
        guest_waiting = room.get("priority_reason") == "guest_waiting"
        rush = room.get("priority") is not None and room.get("priority", 99) <= 2
        arrival = room.get("checkin_time") or "9999-12-31T23:59:59+00:00"
        return (
            0 if preferences["prioritize_guest_waiting"] and guest_waiting else 1,
            0 if preferences["prioritize_rush"] and rush else 1,
            arrival if preferences["prioritize_earliest_arrival"] else "",
        )
    room_by_id = {room.get("room_id"): room for room in rooms}
    for hk in housekeepers:
        hk["assigned_rooms"] = _sequence_rooms(hk["assigned_rooms"])
        hk["assigned_rooms"].sort(key=lambda room: _priority_key(room_by_id.get(room.get("room_id"), {})))
        for sequence, room in enumerate(hk["assigned_rooms"], start=1):
            room["sequence"] = sequence

    # --- 6. Build response ---
    def _dominant_building(hk: dict) -> Optional[str]:
        counts: dict = {}
        for room in hk["assigned_rooms"]:
            b = room.get("building")
            if b:
                counts[b] = counts.get(b, 0) + 1
        return max(counts, key=counts.get) if counts else None

    suggestions = [
        {
            "housekeeper": {
                "id": hk["id"],
                "full_name": hk["full_name"],
                "preferred_name": hk["preferred_name"],
                "building_affinity": _dominant_building(hk),
            },
            "rooms": hk["assigned_rooms"],
            "room_count": len(hk["assigned_rooms"]),
            "total_minutes": hk["assigned_minutes"],
        }
        for hk in housekeepers
    ]

    buildings_used = sorted({
        s["housekeeper"]["building_affinity"]
        for s in suggestions
        if s["housekeeper"]["building_affinity"]
    })
    building_note = (
        f" across buildings {', '.join(str(b) for b in buildings_used)}" if buildings_used else ""
    )

    blocked_note = f"; {blocked_room_count} room(s) skipped (DND/service declined/discrepancy)" if blocked_room_count else ""

    return {
        "data": {
            "suggestions": suggestions,
            "date": target_date.isoformat(),
            "shift_id": shift_id,
            "blocked_rooms": blocked_room_count,
            "excluded_staff": excluded_staff,
            "message": (
                f"Suggested assignments for {len(rooms)} room(s) "
                f"across {len(housekeepers)} housekeeper(s){building_note}{blocked_note}"
            ),
        }
    }


# ---------------------------------------------------------------------------
# GET /housekeeping/predictions
# ---------------------------------------------------------------------------

@router.get("/predictions")
async def get_predictions(
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("room_readiness_predictions")
        .select("*, rooms(room_number, floor)")
        .eq("tenant_id", current_user.hotel_id)
        .in_("risk_level", ["HIGH", "MEDIUM"])
        .order("risk_level")
        .execute()
    )

    high_risk = [r for r in (result.data or []) if r.get("risk_level") == "HIGH"]
    return {
        "data": {
            "at_risk_count": len(high_risk),
            "rooms": result.data or [],
        }
    }


# ---------------------------------------------------------------------------
# POST /housekeeping/room-readiness/{room_id}/reassign
# POST /housekeeping/room-readiness/{room_id}/escalate
# POST /housekeeping/room-readiness/{room_id}/acknowledge
# ---------------------------------------------------------------------------

@router.post("/room-readiness/{room_id}/reassign")
async def reassign_at_risk_room(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    _ensure_tenant_row("rooms", room_id, current_user.hotel_id, "Room")

    status_row = (
        supabase.table("room_status")
        .select("status")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not status_row or not status_row.data:
        raise HTTPException(status_code=404, detail="Room status not found")
    if status_row.data["status"] not in {"DIRTY", "IN_PROGRESS", "PICKUP"}:
        raise HTTPException(status_code=409, detail="Room is no longer awaiting cleaning")

    supabase.table("room_readiness_predictions").update({
        "escalation_level": 0,
        "high_risk_since": None,
    }).eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()

    today = date.today()
    today_str = today.isoformat()
    candidates = _active_housekeepers(current_user.hotel_id, today)
    loads = [(hk_id, count_rooms_ahead(hk_id, room_id, current_user.hotel_id, today_str)) for hk_id in candidates]
    eligible = [(hk_id, n) for hk_id, n in loads if n <= 4]

    if not eligible:
        pred = _fetch_room_prediction_or_404(room_id, current_user.hotel_id, columns="predicted_ready_at")
        room_info = (
            supabase.table("rooms").select("room_number")
            .eq("id", room_id).eq("tenant_id", current_user.hotel_id)
            .maybe_single().execute()
        )
        room_number = (room_info.data or {}).get("room_number", "")
        notify_supervisors_high_risk(
            current_user.hotel_id, room_number, room_id, pred["predicted_ready_at"],
        )
        return {"data": {"action": "escalated", "reason": "no_eligible_housekeeper"}}

    chosen_id = min(eligible, key=lambda t: t[1])[0]
    car = CreateAssignmentsRequest(
        date=today,
        assignments=[RoomAssignmentItem(room_id=room_id, housekeeper_id=chosen_id)],
    )
    await create_assignments(request=car, current_user=current_user)
    return {"data": {"action": "reassigned", "housekeeper_id": chosen_id}}


@router.post("/room-readiness/{room_id}/escalate")
async def escalate_at_risk_room(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    _ensure_tenant_row("rooms", room_id, current_user.hotel_id, "Room")
    pred = _fetch_room_prediction_or_404(
        room_id, current_user.hotel_id, columns="risk_level, predicted_ready_at",
    )
    if pred.get("risk_level") != "HIGH":
        raise HTTPException(status_code=409, detail="Room is no longer HIGH risk")

    supabase.table("room_readiness_predictions").update({
        "escalation_level": 0,
        "high_risk_since": None,
    }).eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()

    room_info = (
        supabase.table("rooms").select("room_number")
        .eq("id", room_id).eq("tenant_id", current_user.hotel_id)
        .maybe_single().execute()
    )
    room_number = (room_info.data or {}).get("room_number", "")

    sent = notify_supervisors_high_risk(
        current_user.hotel_id, room_number, room_id, pred["predicted_ready_at"],
    )
    return {"data": {"action": "escalated", "notifications_sent": sent}}


@router.post("/room-readiness/{room_id}/acknowledge")
async def acknowledge_at_risk_room(
    room_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    _ensure_tenant_row("rooms", room_id, current_user.hotel_id, "Room")
    pred = _fetch_room_prediction_or_404(room_id, current_user.hotel_id, columns="is_acknowledged")
    if pred.get("is_acknowledged"):
        return {"data": {"action": "already_acknowledged"}}

    supabase.table("room_readiness_predictions").update({
        "is_acknowledged": True,
        "acknowledged_at": datetime.now(timezone.utc).isoformat(),
        "acknowledged_by": current_user.user_id,
        "escalation_level": 0,
        "high_risk_since": None,
    }).eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()
    return {"data": {"action": "acknowledged"}}


@router.post("/room-readiness/batch-reassign")
async def batch_reassign_rooms(
    body: BatchRoomReadinessRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Best-effort batch reassign: loops reassign_at_risk_room per room id, one result per id."""
    results = []
    for rid in body.room_ids:
        room_id = str(rid)
        try:
            outcome = await reassign_at_risk_room(room_id=room_id, current_user=current_user)
            results.append({"room_id": room_id, **outcome["data"]})
        except HTTPException as e:
            results.append({"room_id": room_id, "action": "error", "status": e.status_code, "detail": e.detail})

    succeeded = sum(1 for r in results if r["action"] != "error")
    failed = len(results) - succeeded
    return {"data": {"results": results, "succeeded": succeeded, "failed": failed}}


@router.post("/room-readiness/batch-acknowledge")
async def batch_acknowledge_rooms(
    body: BatchRoomReadinessRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Best-effort batch acknowledge: loops acknowledge_at_risk_room per room id, one result per id."""
    results = []
    for rid in body.room_ids:
        room_id = str(rid)
        try:
            outcome = await acknowledge_at_risk_room(room_id=room_id, current_user=current_user)
            results.append({"room_id": room_id, **outcome["data"]})
        except HTTPException as e:
            results.append({"room_id": room_id, "action": "error", "status": e.status_code, "detail": e.detail})

    succeeded = sum(1 for r in results if r["action"] != "error")
    failed = len(results) - succeeded
    return {"data": {"results": results, "succeeded": succeeded, "failed": failed}}


# ---------------------------------------------------------------------------
# GET /housekeeping/ready-for-inspection
# ---------------------------------------------------------------------------

@router.get("/ready-for-inspection")
async def list_ready_for_inspection(
    board_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    """Return rooms currently in CLEAN status — waiting for supervisor inspection."""
    today = board_date or date.today()

    result = (
        supabase.table("room_status")
        .select(
            "room_id, status, updated_at, reclean_requested_at, vip_flag, checkin_time, priority, priority_needed_by, "
            "rooms!inner(room_number, floor, building, room_type_id, room_types(name))"
        )
        .eq("tenant_id", current_user.hotel_id)
        .eq("status", "CLEAN")
        .execute()
    )
    clean_rooms = result.data or []

    if not clean_rooms:
        return {"data": []}

    room_ids = [r["room_id"] for r in clean_rooms]
    clean_cycles = latest_clean_cycles(supabase, current_user.hotel_id, room_ids)
    previous_failures = _previous_failures_for_reinspection(
        current_user.hotel_id, [r["room_id"] for r in clean_rooms if r.get("reclean_requested_at")]
    )

    # Resolve assigned_to UUIDs from today's assignments
    assignments_res = (
        supabase.table("room_assignments")
        .select("room_id, assigned_to, clean_type")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assignment_date", today.isoformat())
        .in_("room_id", room_ids)
        .execute()
    )
    assigned_map: dict[str, str] = {
        a["room_id"]: a["assigned_to"]
        for a in (assignments_res.data or [])
        if a.get("assigned_to")
    }
    clean_type_map: dict[str, str | None] = {
        a["room_id"]: a.get("clean_type")
        for a in (assignments_res.data or [])
    }

    # Resolve housekeeper names
    hk_ids = list(set(assigned_map.values()))
    name_map: dict[str, str] = {}
    if hk_ids:
        profiles = (
            supabase.table("user_profiles")
            .select("id, preferred_name, full_name")
            .in_("id", hk_ids)
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )
        for p in (profiles.data or []):
            # No name on file stays "" - the app shows "not recorded", never an id standing in for a person.
            name = p.get("preferred_name") or p.get("full_name")
            if name:
                name_map[p["id"]] = name

    output = []
    for room in clean_rooms:
        room_info = room.get("rooms") or {}
        assigned_to = assigned_map.get(room["room_id"])
        output.append({
            "room_id": room["room_id"],
            "room_number": room_info.get("room_number", ""),
            "floor": room_info.get("floor"),
            "cleaned_by": name_map.get(assigned_to, "") if assigned_to else "",
            "cleaned_at": room.get("updated_at"),
            "housekeeper_id": assigned_to,
            "clean_type": clean_type_map.get(room["room_id"]),
            # Authoritative facts the mobile inspection flow needs and must not guess:
            # which template applies (room type), which clean cycle this row is (staleness),
            # and, for a room being re-checked after a failure, exactly what failed.
            "room_type_id": room_info.get("room_type_id"),
            # The room type's own name, for display only (the id still picks the checklist). Null when not recorded.
            "room_type_name": ((room_info.get("room_types") or {}).get("name") or None),
            "clean_cycle_id": clean_cycles.get(room["room_id"]),
            "previous_failure": previous_failures.get(room["room_id"]),
            # Recorded operational facts the queue is ordered by. Nothing is predicted: an unset value is null.
            "building": room_info.get("building"),
            "vip": bool(room.get("vip_flag")),
            "arrival_at": room.get("checkin_time"),
            "priority": room.get("priority"),
            "priority_needed_by": room.get("priority_needed_by"),
        })

    output.sort(key=lambda r: (r["floor"] or 0, r["room_number"]))
    _attach_last_clean_session(output, current_user.hotel_id, today)
    return {"data": output}


def _previous_failures_for_reinspection(hotel_id: str, flagged_room_ids: list[str]) -> dict[str, dict]:
    """For rooms with an open correction, the failed inspection they are being re-checked against."""
    # `reclean_requested_at` is only set by a correction, so a flagged room's latest failed/conditional inspection
    # is the one being corrected (a conditional since migration 219 is a touch-up that blocks the room).
    failed = load_reclean_details(supabase, hotel_id, flagged_room_ids)
    if not failed:
        return {}
    kinds = {
        row["id"]: row.get("correction_kind")
        for row in (
            supabase.table("inspections")
            .select("id, correction_kind")
            .eq("tenant_id", hotel_id)
            .in_("id", [d["inspection_id"] for d in failed.values()])
            .execute()
        ).data or []
    }
    return {room_id: {**d, "correction_kind": kinds.get(d["inspection_id"])} for room_id, d in failed.items()}


# ---------------------------------------------------------------------------
# GET /housekeeping/ready-to-strip
# ---------------------------------------------------------------------------

@router.get("/ready-to-strip")
async def list_ready_to_strip(
    board_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    """Return DIRTY departure rooms that have not yet been stripped by a supervisor."""
    today = board_date or date.today()

    try:
        result = (
            supabase.table("room_status")
            .select("room_id, status, clean_type, fo_status, checkout_time, rooms!inner(room_number, floor)")
            .eq("tenant_id", current_user.hotel_id)
            .eq("status", "DIRTY")
            .eq("clean_type", "DEP")
            .eq("stripped", False)
            .execute()
        )
        dirty_dep_rooms = result.data or []
    except Exception as exc:
        if _is_missing_clean_type_column_error(exc) or _is_missing_stripped_column_error(exc):
            # Fall back: use fo_status=VAC as departure proxy if columns are absent
            fallback = (
                supabase.table("room_status")
                .select("room_id, status, fo_status, checkout_time, rooms!inner(room_number, floor)")
                .eq("tenant_id", current_user.hotel_id)
                .eq("status", "DIRTY")
                .eq("fo_status", "VAC")
                .execute()
            )
            dirty_dep_rooms = fallback.data or []
        else:
            raise

    if not dirty_dep_rooms:
        return {"data": []}

    room_ids = [r["room_id"] for r in dirty_dep_rooms]

    assignments_res = (
        supabase.table("room_assignments")
        .select("room_id, assigned_to")
        .eq("tenant_id", current_user.hotel_id)
        .eq("assignment_date", today.isoformat())
        .in_("room_id", room_ids)
        .execute()
    )
    assigned_map: dict[str, str] = {
        a["room_id"]: a["assigned_to"]
        for a in (assignments_res.data or [])
        if a.get("assigned_to")
    }

    output = []
    for room in dirty_dep_rooms:
        room_info = room.get("rooms") or {}
        output.append({
            "room_id": room["room_id"],
            "room_number": room_info.get("room_number", ""),
            "floor": room_info.get("floor"),
            "checkout_time": room.get("checkout_time"),
            "fo_status": room.get("fo_status"),
            "assigned_housekeeper_id": assigned_map.get(room["room_id"]),
        })

    output.sort(key=lambda r: (r["floor"] is None, r["floor"] or 0, r["room_number"]))
    return {"data": output}


# ---------------------------------------------------------------------------
# POST /housekeeping/inspections
# ---------------------------------------------------------------------------

@router.post("/inspections")
async def submit_inspection(
    request: SubmitInspectionRequest,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    # This legacy JSON endpoint remains for compatibility, but it must never
    # recreate the former sampled-room shortcut: a pass without a real
    # template checklist is invalid. New UI uses /inspections/complete, which
    # performs the full template/evidence validation before this write path.
    if request.overall_result == "passed" and (not request.template_id or not request.items):
        raise HTTPException(status_code=422, detail="A passed inspection requires a completed checklist")
    # A pass (or the historical "conditional" pass-with-notes) must never carry a failed item: that would
    # release a room with a recorded defect. Historical conditional rows stay readable; new ones cannot hide a fail.
    if request.overall_result in ("passed", "conditional") and any(item.result == "fail" for item in request.items):
        raise HTTPException(status_code=422, detail="An inspection with a failed item cannot be recorded as passed")
    # A checklist from another hotel (or an item from a different checklist) must never be recorded on this
    # hotel's inspection, whatever the client sends.
    if request.template_id:
        _ensure_tenant_row("inspection_templates", str(request.template_id), current_user.hotel_id, "Inspection checklist")
    submitted_item_ids = {str(item.template_item_id) for item in request.items if item.template_item_id}
    if submitted_item_ids:
        items_query = (
            supabase.table("inspection_template_items")
            .select("id")
            .eq("tenant_id", current_user.hotel_id)
            .in_("id", list(submitted_item_ids))
        )
        if request.template_id:
            items_query = items_query.eq("template_id", str(request.template_id))
        known_items = items_query.execute().data or []
        if submitted_item_ids - {row["id"] for row in known_items}:
            raise HTTPException(status_code=422, detail="Inspection includes an item outside this checklist")
    # Capture current status and clean_type before the DB trigger changes them
    current_rs = (
        supabase.table("room_status")
        .select("status, clean_type")
        .eq("room_id", str(request.room_id))
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not current_rs or not current_rs.data:
        raise HTTPException(status_code=404, detail="Room status not found")
    # Same rule as /inspections/complete: only a room awaiting inspection can be inspected, so a second
    # supervisor (or a stale screen) cannot record a duplicate inspection or re-open a finished room.
    if current_rs.data.get("status") != "CLEAN":
        raise HTTPException(status_code=409, detail="Room must be clean before it can be inspected")
    from_status = current_rs.data.get("status", "CLEAN")
    current_clean_type = current_rs.data.get("clean_type")
    # Only a pass releases the room. A failure and the legacy "conditional" (minor touch-up) both block it.
    to_status = "INSPECTED" if request.overall_result == "passed" else "DIRTY"

    legacy_row = {
        "tenant_id": current_user.hotel_id,
        "room_id": str(request.room_id),
        "template_id": str(request.template_id) if request.template_id else None,
        "inspected_by": current_user.user_id,
        "overall_result": request.overall_result,
        "notes": request.notes,
    }
    if request.overall_result != "passed":
        legacy_row["correction_kind"] = "touch_up" if request.overall_result == "conditional" else "reclean"
    try:
        inspection = supabase.table("inspections").insert(legacy_row).execute()
    except Exception as exc:  # noqa: BLE001
        # The DB guard (migration 219) fires when another supervisor inspected the room between our check and insert.
        if getattr(exc, "code", None) == "P0001" or "room_not_awaiting_inspection" in str(exc):
            raise HTTPException(status_code=409, detail="Room must be clean before it can be inspected")
        raise

    inspection_id = inspection.data[0]["id"]

    # Insert per-item results
    results_data = [
        {
            "inspection_id": inspection_id,
            "template_item_id": str(item.template_item_id) if item.template_item_id else None,
            "tenant_id": current_user.hotel_id,
            "result": item.result,
            "note": item.note,
        }
        for item in request.items
    ]
    if results_data:
        supabase.table("inspection_results").insert(results_data).execute()

    # room_status is updated by the on_inspection_complete DB trigger (migration 017).
    # History must be written explicitly — the status-history trigger was dropped in migration 024.
    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("room_status_history").insert({
        "room_id": str(request.room_id),
        "tenant_id": current_user.hotel_id,
        "from_status": from_status,
        "to_status": to_status,
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": request.notes,
    }).execute()

    # On a passed DEP inspection, reset the housekeeping history boundary so
    # prior-stay notes don't bleed into the next guest's stay.
    if to_status == "INSPECTED" and current_clean_type == "DEP":
        supabase.table("room_status").update({"stay_reset_at": now_iso})\
            .eq("room_id", str(request.room_id))\
            .eq("tenant_id", current_user.hotel_id)\
            .execute()

    # A pass clears any pending re-clean flag, whether or not this particular
    # inspection is the one that had failed (covers a supervisor re-inspecting
    # after the housekeeper already fixed the room).
    if request.overall_result == "passed":
        supabase.table("room_status").update({"reclean_requested_at": None})\
            .eq("room_id", str(request.room_id))\
            .eq("tenant_id", current_user.hotel_id)\
            .execute()
    else:
        # A failure and the legacy "conditional" touch-up both block the room (see migration 219) and so both own
        # exactly one correction task, created now rather than depending on a later, dismissible prompt. The
        # screen's "send back" step finds this task and returns it instead of creating a second one.
        _correction_for_inspection(
            {**inspection.data[0], "correction_kind": legacy_row.get("correction_kind")},
            current_user,
            _room_number(current_user.hotel_id, str(request.room_id)),
        )

    return {"data": inspection.data[0]}


INSPECTION_PHOTO_BUCKET = "work-order-photos"
_PHOTO_EXTENSIONS = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp"}


def _discard_uploads(paths: list[str]) -> None:
    """Best effort: a failed attempt must not leave evidence for an inspection that never existed."""
    if not paths:
        return
    try:
        supabase.storage.from_(INSPECTION_PHOTO_BUCKET).remove(paths)
    except Exception:  # noqa: BLE001 - orphaned objects are harmless; the attempt's error is what matters
        logger.warning("Could not remove %d orphaned inspection photo(s)", len(paths), exc_info=True)


def _find_submitted_inspection(inspection_id: str, current_user: CurrentUser, room_id: str) -> Optional[dict]:
    """The inspection already stored under this submission id, for THIS supervisor, hotel and room.

    Looked up by id alone first: a row that belongs to another hotel/user/room is a 409 (the id is spent),
    never a replay and never a leak of that row.
    """
    found = supabase.table("inspections").select("*").eq("id", inspection_id).limit(1).execute()
    row = (found.data or [None])[0] if found else None
    if row is None:
        return None
    if (
        row.get("tenant_id") != current_user.hotel_id
        or row.get("inspected_by") != current_user.user_id
        or str(row.get("room_id")) != room_id
    ):
        raise RuleViolation("submission_conflict", "This submission id has already been used", 409)
    return row


def _assignment_date_today(hotel_id: str) -> str:
    return datetime.now(_hotel_zone(hotel_id)).date().isoformat()


def _failed_labels(hotel_id: str, inspection_id: str) -> list[str]:
    rows = (
        supabase.table("inspection_results")
        .select("template_item_id, note")
        .eq("inspection_id", inspection_id)
        .eq("tenant_id", hotel_id)
        .eq("result", "fail")
        .execute()
    ).data or []
    ids = [r["template_item_id"] for r in rows if r.get("template_item_id")]
    names = {}
    if ids:
        names = {
            i["id"]: i["description"]
            for i in (
                supabase.table("inspection_template_items").select("id, description").eq("tenant_id", hotel_id).in_("id", ids).execute()
            ).data or []
        }
    return [names.get(r.get("template_item_id")) or (r.get("note") or "").strip() for r in rows if names.get(r.get("template_item_id")) or (r.get("note") or "").strip()]


def _correction_for_inspection(insp: dict, current_user: CurrentUser, room_number: str) -> dict:
    """Make sure a failed inspection has its correction task; never raises.

    The inspection is already committed, so a failure here must not turn into an error response that
    makes the client think nothing was saved. It is reported as `status: "failed"` and healed by the
    next retry of the same submission (or by POST /inspections/{id}/reclean), which dedupes.
    """
    try:
        outcome = ensure_correction_task(
            supabase,
            hotel_id=current_user.hotel_id,
            user_id=current_user.user_id,
            inspection_id=insp["id"],
            room_id=str(insp["room_id"]),
            room_number=room_number,
            kind=insp.get("correction_kind") or "reclean",
            failed_labels=_failed_labels(current_user.hotel_id, insp["id"]),
            notes=insp.get("notes"),
            assignment_date=_assignment_date_today(current_user.hotel_id),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Correction task could not be created for inspection %s", insp.get("id"))
        return {"status": "failed", "task": None}
    task = outcome.get("task")
    if task is None:
        return {"status": "failed", "task": None}
    return {"status": "created" if outcome["created"] else "existing", "task": task}


def _with_owner_name(correction: Optional[dict], hotel_id: str) -> Optional[dict]:
    """The correction task as stored plus the owner's real name (or None), so the success screen states who was
    given the work from the server's own record rather than from the app's guess."""
    task = (correction or {}).get("task")
    if not task:
        return correction
    return {**correction, "task": {**task, "assigned_name": profile_name(supabase, hotel_id, task.get("assigned_to"))}}


def _completion_payload(insp: dict, *, replayed: bool, correction: Optional[dict]) -> dict:
    failed = insp.get("overall_result") == "failed"
    return {
        "data": {
            "id": insp["id"],
            "overall_result": insp.get("overall_result"),
            "reclean_requested": failed,
            "inspection": insp,
            "replayed": replayed,
            "correction_kind": insp.get("correction_kind"),
            "reinspection_of": insp.get("reinspection_of"),
            "correction": correction,
            # False means the inspection is saved but a follow-up step (the correction task) is still
            # missing; resubmitting the same client_submission_id finishes it without duplicating anything.
            "followup_complete": (not failed) or bool(correction and correction.get("status") in ("created", "existing")),
        }
    }


@router.post("/inspections/complete")
async def complete_inspection(
    inspection: str = Form(...),
    photo_item_ids: list[str] = Form(default=[]),
    photos: list[UploadFile] = File(default=[]),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Finalize a checklist inspection only after all required evidence uploads.

    Order of operations, and what each failure leaves behind:

    1. Validate everything that can be validated without writing (checklist, template, photos, room).
    2. Upload evidence to storage (deterministic paths, so a retry overwrites instead of duplicating).
       A failure here discards what was uploaded and writes nothing else.
    3. Insert the inspection row. Its id is the client's submission id, so the same submission can only
       exist once; a BEFORE INSERT trigger re-checks the room under a row lock, so two supervisors cannot
       both inspect one clean room. The existing AFTER INSERT trigger moves the room to INSPECTED / DIRTY.
    4. Insert the item results. If this fails the inspection exists without answers; the next retry of the
       same submission sees that and finishes it instead of starting over.
    5. Follow-ups (history, clearing the old correction on a pass, creating the correction task on a failure)
       are idempotent and never turn a committed inspection into an error response.

    Storage and Postgres cannot share a transaction, so steps 2 and 3 are not atomic; the ordering above
    guarantees the only possible leftovers are orphaned photo objects (harmless) or a committed inspection
    that a retry completes.
    """
    try:
        request = CompleteInspectionRequest.model_validate(json.loads(inspection))
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid inspection checklist payload") from exc
    try:
        return await _complete_inspection(request, photo_item_ids, photos, current_user)
    except RuleViolation as violation:
        # detail stays a plain string (the web drawer renders it); `code` + extras ride along in the body.
        raise CodedHTTPException(violation.status_code, violation.message, violation.code, **violation.extra) from violation


async def _complete_inspection(
    request: CompleteInspectionRequest,
    photo_item_ids: list[str],
    photos: list[UploadFile],
    current_user: CurrentUser,
):
    hotel_id = current_user.hotel_id
    room_id = str(request.room_id)
    if request.expected_hotel_id and str(request.expected_hotel_id) != str(hotel_id):
        raise RuleViolation("hotel_mismatch", "You are signed in to a different hotel than this inspection was started for", 409)

    inspection_id = str(request.client_submission_id) if request.client_submission_id else str(uuid4())
    existing = _find_submitted_inspection(inspection_id, current_user, room_id)
    stored_item_ids: set[str] = set()
    if existing is not None:
        stored = (
            supabase.table("inspection_results")
            .select("template_item_id")
            .eq("inspection_id", inspection_id)
            .eq("tenant_id", hotel_id)
            .execute()
        ).data or []
        stored_item_ids = {r["template_item_id"] for r in stored if r.get("template_item_id")}
        if stored_item_ids:
            # Fully committed earlier (our reply was lost, or the person tapped twice): read it back as-is.
            # The checklist is not re-validated - it may have legitimately changed since.
            correction = None
            if existing.get("overall_result") == "failed":
                correction = {"status": "existing", "task": fetch_correction_task(supabase, hotel_id, inspection_id)}
                if correction["task"] is None and not _has_followup_inspection(hotel_id, existing):
                    correction = _correction_for_inspection(existing, current_user, _room_number(hotel_id, room_id))
            return _completion_payload(existing, replayed=True, correction=_with_owner_name(correction, hotel_id))

    room = (
        supabase.table("rooms")
        .select("room_number, room_type_id")
        .eq("id", room_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    room_row = room.data if room else None
    if not room_row:
        raise HTTPException(status_code=404, detail="Room not found")

    template_id = str(request.template_id) if request.template_id else None
    template = (
        supabase.table("inspection_templates")
        .select("id, room_type_id, is_default")
        .eq("id", template_id)
        .eq("tenant_id", hotel_id)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    ) if template_id else None
    if not template or not template.data:
        raise RuleViolation("no_checklist", "No inspection checklist is configured for this room")
    if not template_applies_to_room(template.data, room_row.get("room_type_id")):
        raise RuleViolation("template_not_applicable", "This checklist is not meant for this room type")

    template_items = sort_template_items(
        supabase.table("inspection_template_items")
        .select("id, section, description, is_required, requires_photo_on_fail, allows_na, sort_order")
        .eq("template_id", template_id)
        .eq("tenant_id", hotel_id)
        .execute()
        .data
        or []
    )
    fingerprint = template_fingerprint(template.data, template_items)
    if request.template_fingerprint and request.template_fingerprint != fingerprint:
        raise RuleViolation("template_changed", "The checklist changed while you were inspecting. Reload it and review the room again.", 409)

    validated = validate_answers(
        template_items,
        [item.model_dump(mode="json") for item in request.items],
        claimed_result=request.overall_result,
    )
    validate_photo_links(template_items, validated.failed_item_ids, photo_item_ids, len(photos))
    if existing is not None and existing.get("overall_result") != validated.result:
        raise RuleViolation("submission_conflict", "This submission id was already used for a different result", 409)

    prepared_photos: dict[str, tuple[bytes, str]] = {}
    for item_id, photo in zip(photo_item_ids, photos):
        if photo.content_type not in ALLOWED_INSPECTION_PHOTO_TYPES:
            raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images are allowed")
        file_bytes = await photo.read(MAX_INSPECTION_PHOTO_BYTES + 1)
        if len(file_bytes) > MAX_INSPECTION_PHOTO_BYTES:
            raise HTTPException(status_code=413, detail="Photo must be 5 MB or smaller")
        prepared_photos[item_id] = (file_bytes, photo.content_type)

    status_row = (
        supabase.table("room_status")
        .select("status, clean_type, reclean_requested_at")
        .eq("room_id", room_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    room_status = status_row.data if status_row else None
    if not room_status:
        raise HTTPException(status_code=404, detail="Room status not found")

    reinspection_of = existing.get("reinspection_of") if existing is not None else None
    if existing is None:
        if room_status.get("status") != "CLEAN":
            raise RuleViolation(
                "room_not_awaiting_inspection",
                "Room must be clean before it can be inspected",
                409,
                room_status=room_status.get("status"),
            )
        if request.expected_clean_cycle_id:
            current_cycle = latest_clean_cycles(supabase, hotel_id, [room_id]).get(room_id)
            # No recorded cycle means it cannot be checked, not that it is stale.
            if current_cycle is not None and current_cycle != str(request.expected_clean_cycle_id):
                raise RuleViolation("room_changed_since_review", "This room was cleaned again after you opened it. Review it again.", 409)
        open_failure = None
        if room_status.get("reclean_requested_at"):
            details = load_reclean_details(supabase, hotel_id, [room_id]).get(room_id)
            if details:
                open_failure = details["inspection_id"]
        if request.reinspection_of and str(request.reinspection_of) != open_failure:
            raise RuleViolation("correction_changed", "The correction for this room changed since you opened it. Review it again.", 409)
        reinspection_of = open_failure
        if reinspection_of:
            _require_failed_items_reverified(hotel_id, reinspection_of, {str(i["id"]) for i in template_items}, validated.answers)

    uploaded_paths: list[str] = []
    photo_urls: dict[str, str] = {}
    try:
        for item_id, (file_bytes, content_type) in prepared_photos.items():
            path = f"{hotel_id}/inspections/{inspection_id}/{item_id}.{_PHOTO_EXTENSIONS[content_type]}"
            # upsert: the path is unique to this submission, so a retry overwrites its own earlier upload.
            supabase.storage.from_(INSPECTION_PHOTO_BUCKET).upload(path, file_bytes, {"content-type": content_type, "upsert": "true"})
            uploaded_paths.append(path)
            photo_urls[item_id] = supabase.storage.from_(INSPECTION_PHOTO_BUCKET).get_public_url(path)
    except Exception:  # noqa: BLE001
        logger.exception("Inspection photo upload failed for submission %s", inspection_id)
        _discard_uploads(uploaded_paths)
        raise RuleViolation("photo_upload_failed", "Photos could not be uploaded, so nothing was recorded. Try again.", 502)

    if existing is None:
        row = {
            "id": inspection_id,
            "tenant_id": hotel_id,
            "room_id": room_id,
            "template_id": template_id,
            "inspected_by": current_user.user_id,
            "overall_result": validated.result,
            "notes": request.notes,
            "template_fingerprint": fingerprint,
        }
        if validated.correction_kind:
            row["correction_kind"] = validated.correction_kind
        if reinspection_of:
            row["reinspection_of"] = reinspection_of
        try:
            inserted = supabase.table("inspections").insert(row).execute()
        except Exception as exc:  # noqa: BLE001
            if is_unique_violation(exc):
                # The same submission is already being written by another request. Leave its photos alone.
                raise RuleViolation("submission_in_progress", "This inspection is already being saved. Check the room before submitting again.", 409)
            _discard_uploads(uploaded_paths)
            if getattr(exc, "code", None) == "P0001" or "room_not_awaiting_inspection" in str(exc):
                raise RuleViolation("room_not_awaiting_inspection", "Room must be clean before it can be inspected", 409)
            raise
        existing = (inserted.data or [row])[0]

    result_rows = [
        {
            "inspection_id": inspection_id,
            "template_item_id": item_id,
            "tenant_id": hotel_id,
            "result": answer["result"],
            "note": answer["note"],
            **({"severity": answer["severity"]} if answer["severity"] else {}),
            **({"photo_url": photo_urls[item_id]} if item_id in photo_urls else {}),
        }
        for item_id, answer in validated.answers.items()
        if item_id not in stored_item_ids
    ]
    try:
        if result_rows:
            supabase.table("inspection_results").insert(result_rows).execute()
    except Exception:  # noqa: BLE001
        logger.exception("Inspection %s saved but its results were not", inspection_id)
        raise RuleViolation(
            "inspection_incomplete",
            "The inspection was saved but its checklist answers were not. Submit again to finish it.",
            500,
        )

    # -- follow-ups: idempotent, and never an error once the inspection is committed -----------------------
    to_status = "DIRTY" if validated.result == "failed" else "INSPECTED"
    try:
        supabase.table("room_status_history").insert({
            "room_id": room_id, "tenant_id": hotel_id,
            "from_status": "CLEAN", "to_status": to_status,
            "changed_by": current_user.user_id, "change_source": "app", "notes": request.notes,
        }).execute()
    except Exception:  # noqa: BLE001 - audit trail only; the room status itself is set by the DB trigger
        logger.exception("Room status history not written for inspection %s", inspection_id)

    correction = None
    if validated.result == "passed":
        update_data: dict = {"reclean_requested_at": None}
        if room_status.get("clean_type") == "DEP":
            update_data["stay_reset_at"] = datetime.now(timezone.utc).isoformat()
        try:
            supabase.table("room_status").update(update_data).eq("room_id", room_id).eq("tenant_id", hotel_id).execute()
            if reinspection_of:
                resolve_correction_task(supabase, hotel_id, reinspection_of)
        except Exception:  # noqa: BLE001
            logger.exception("Post-pass room cleanup failed for inspection %s", inspection_id)
    else:
        correction = _correction_for_inspection(existing, current_user, room_row.get("room_number") or room_id)

    return _completion_payload(existing, replayed=False, correction=_with_owner_name(correction, hotel_id))


def _require_failed_items_reverified(hotel_id: str, failed_inspection_id: str, checklist_item_ids: set[str], answers: dict) -> None:
    """A reinspection verifies the correction: every item that failed last time must be explicitly answered now.

    Required items are already enforced for every inspection; this adds the earlier failures even when the standard is
    optional, so a focused re-check can never pass a room without looking at what was wrong. Items the checklist no
    longer contains (it was edited) cannot be asked about; the full current checklist is the verification then.
    """
    failed = (
        supabase.table("inspection_results")
        .select("template_item_id")
        .eq("inspection_id", failed_inspection_id)
        .eq("tenant_id", hotel_id)
        .eq("result", "fail")
        .execute()
    ).data or []
    owed = {str(r["template_item_id"]) for r in failed if r.get("template_item_id")} & checklist_item_ids
    missing = sorted(owed - set(answers))
    if missing:
        raise RuleViolation(
            "reinspection_items_unverified",
            "Re-check every item that failed last time before completing the reinspection",
            422,
            missing_item_ids=missing,
        )


def _room_number(hotel_id: str, room_id: str) -> str:
    row = supabase.table("rooms").select("room_number").eq("id", room_id).eq("tenant_id", hotel_id).maybe_single().execute()
    return ((row.data if row else None) or {}).get("room_number") or room_id


def _has_followup_inspection(hotel_id: str, insp: dict) -> bool:
    later = (
        supabase.table("inspections")
        .select("id")
        .eq("tenant_id", hotel_id)
        .eq("room_id", str(insp["room_id"]))
        .gte("completed_at", insp.get("completed_at") or "")
        .neq("id", insp["id"])
        .limit(1)
        .execute()
    ).data or []
    return bool(later)


@router.get("/inspections/submissions/{client_submission_id}")
async def read_back_inspection_submission(
    client_submission_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Authoritative answer to "did my submission land?" after a lost response.

    200 with the stored inspection when it committed, 404 when nothing was recorded under this id for this
    supervisor in this hotel. Because the id is the inspection's primary key, a 404 followed by a resubmit
    of the same id cannot produce a duplicate even if the original request is still in flight.
    """
    try:
        UUID(client_submission_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Inspection submission not found")
    found = supabase.table("inspections").select("id, inspected_by").eq("id", client_submission_id).eq("tenant_id", current_user.hotel_id).limit(1).execute()
    row = (found.data or [None])[0] if found else None
    if row is None or row.get("inspected_by") != current_user.user_id:
        raise HTTPException(status_code=404, detail="Inspection submission not found")
    detail = load_inspection_detail(supabase, current_user.hotel_id, client_submission_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Inspection submission not found")
    return {"data": detail}


# ---------------------------------------------------------------------------
# POST /housekeeping/inspections/{inspection_id}/reclean
# ---------------------------------------------------------------------------

@router.post("/inspections/{inspection_id}/reclean")
async def trigger_reclean(
    inspection_id: str,
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    """Send a failed/conditional inspection's room back for correction. Safe to repeat.

    A failed inspection owns exactly one correction task (unique per inspection in the database). A second
    call, a retry, or a call after the completion endpoint already created it returns that task and leaves the
    room alone, so it can never reset a room whose correction is already under way.
    """
    inspection_row = (
        supabase.table("inspections")
        .select("room_id, overall_result, notes, inspected_by, correction_kind, completed_at")
        .eq("id", inspection_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not inspection_row or not inspection_row.data:
        raise HTTPException(status_code=404, detail="Inspection not found")
    insp = {**inspection_row.data, "id": inspection_id}
    if insp.get("overall_result") not in ("failed", "conditional"):
        raise HTTPException(status_code=400, detail="Only failed/conditional inspections can trigger re-clean")

    room_id = insp["room_id"]
    hotel_id = current_user.hotel_id
    already = fetch_correction_task(supabase, hotel_id, inspection_id)
    if already is not None:
        return {"data": {"room_id": room_id, "task": already, "created": False}}

    # A later inspection already settled this failure (a passing reinspection verified the room, or a newer failure took
    # over): a stale "request the correction" must not pull that room back to DIRTY.
    derived, _room_state, _followups = correction_state(supabase, hotel_id, insp, None)
    if derived is not None and derived["status"] in ("verified", "superseded"):
        raise CodedHTTPException(409, "A later inspection already settled this one", "correction_closed", correction_status=derived["status"])

    # First request for this inspection. A conditional pass released the room (INSPECTED); a failed one is
    # already DIRTY. Only a room that is still released is pulled back - never one already being corrected.
    current = (
        supabase.table("room_status").select("status").eq("room_id", room_id).eq("tenant_id", hotel_id).maybe_single().execute()
    )
    if current and current.data and current.data.get("status") in ("CLEAN", "INSPECTED"):
        supabase.table("room_status").update({"status": "DIRTY"}).eq("room_id", room_id).eq("tenant_id", hotel_id).execute()

    outcome = _correction_for_inspection(insp, current_user, _room_number(hotel_id, room_id))
    if outcome["task"] is None:
        raise HTTPException(status_code=500, detail="The correction task could not be created. Try again.")
    return {"data": {"room_id": room_id, "task": outcome["task"], "created": outcome["status"] == "created"}}


# ---------------------------------------------------------------------------
# GET /housekeeping/inspections
# ---------------------------------------------------------------------------

@router.get("/inspections")
async def list_inspections(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    room_id: Optional[str] = Query(None),
    result: Optional[str] = Query(None),  # passed|failed|conditional
    current_user: CurrentUser = Depends(get_current_user),
):
    """List inspection records with optional filters.

    Date filters always use the hotel's configured time zone. The server resolves
    both local midnights independently so spring-forward and fall-back days match
    every reporting surface, regardless of the mobile device's time zone.
    """
    zone = _hotel_zone(current_user.hotel_id)
    today = datetime.now(zone).date()
    from_date = date_from or today
    to_date = date_to or today
    start_str, end_str = _hotel_reporting_window(from_date, to_date, zone)

    query = (
        supabase.table("inspections")
        .select(
            "id, room_id, overall_result, notes, completed_at, inspected_by, reinspection_of, correction_kind, "
            "rooms!inner(room_number, floor, building)"
        )
        .eq("tenant_id", current_user.hotel_id)
        .gte("completed_at", start_str)
        .lt("completed_at", end_str)
        .order("completed_at", desc=True)
    )

    if room_id:
        query = query.eq("room_id", room_id)
    if result:
        query = query.eq("overall_result", result)

    res = query.execute()
    rows = res.data or []

    # Resolve inspector UUIDs → names in one query
    inspector_ids = list({r["inspected_by"] for r in rows if r.get("inspected_by")})
    name_map: dict[str, str] = {}
    if inspector_ids:
        profiles = (
            supabase.table("user_profiles")
            .select("id, preferred_name, full_name")
            .in_("id", inspector_ids)
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )
        for p in (profiles.data or []):
            name = p.get("preferred_name") or p.get("full_name")
            if name:
                name_map[p["id"]] = name

    # Flatten for convenience
    output = []
    for row in rows:
        room = row.get("rooms") or {}
        inspector_id = row.get("inspected_by", "")
        inspector_fallback = inspector_id[:8] if inspector_id else "Unknown"
        output.append({
            "id": row.get("id"),
            "room_id": row.get("room_id"),
            "room_number": room.get("room_number", ""),
            "floor": room.get("floor"),
            "building": room.get("building"),
            "inspector_name": name_map.get(inspector_id, inspector_fallback),
            # The real name or null: `inspector_name` above keeps its legacy id-prefix fallback for older clients,
            # which must never be shown as a person's name.
            "inspector_display_name": name_map.get(inspector_id),
            "overall_result": row.get("overall_result"),
            "notes": row.get("notes"),
            "completed_at": row.get("completed_at"),
            "reinspection_of": row.get("reinspection_of"),
            "correction_kind": row.get("correction_kind"),
        })

    return {"data": output}


# ---------------------------------------------------------------------------
# GET /housekeeping/inspections/templates
# ---------------------------------------------------------------------------

@router.get("/inspections/templates")
async def list_inspection_templates(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get all active inspection checklist templates for this hotel, including their items."""
    templates = (
        supabase.table("inspection_templates")
        .select("id, name, room_type_id, is_default, is_active")
        .eq("tenant_id", current_user.hotel_id)
        .eq("is_active", True)
        .order("is_default", desc=True)
        .execute()
    )

    template_rows = templates.data or []
    if not template_rows:
        return {"data": [_create_standard_inspection_template(current_user.hotel_id)]}

    result = []
    for tmpl in template_rows:
        items = (
            supabase.table("inspection_template_items")
            .select("id, section, description, is_required, requires_photo_on_fail, allows_na, sort_order")
            .eq("template_id", tmpl["id"])
            .eq("tenant_id", current_user.hotel_id)
            .order("sort_order")
            .execute()
        )
        item_rows = items.data or []
        if not item_rows and tmpl.get("is_default"):
            item_rows = _insert_standard_inspection_items(tmpl["id"], current_user.hotel_id)
        result.append({**tmpl, "items": item_rows})

    if not any(template.get("items") for template in result):
        result.insert(0, _create_standard_inspection_template(current_user.hotel_id))

    # `fingerprint` is opaque to clients: they echo it back on completion so a checklist edited while an
    # inspection was in progress is detected by the server rather than guessed at on the phone.
    return {"data": [{**t, "fingerprint": template_fingerprint(t, t.get("items") or [])} for t in result]}


# ---------------------------------------------------------------------------
# GET /housekeeping/inspections/corrections
# ---------------------------------------------------------------------------

@router.get("/inspections/corrections")
async def list_inspection_corrections(
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Failed-inspection corrections in this hotel that are not settled yet, in one bounded read.

    Registered before `/inspections/{inspection_id}` so the literal path is never captured as an id.
    ``meta.truncated`` is true when more exist than are returned.
    """
    return list_open_corrections(supabase, current_user.hotel_id)


# ---------------------------------------------------------------------------
# GET /housekeeping/inspections/correction-owners
# ---------------------------------------------------------------------------

@router.get("/inspections/correction-owners")
async def get_correction_owners(
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Who in this hotel can be given a correction (registered before `/inspections/{inspection_id}`)."""
    return {"data": list_correction_owners(supabase, current_user.hotel_id)}


# ---------------------------------------------------------------------------
# POST /housekeeping/inspections/{inspection_id}/correction/reassign | escalate
# ---------------------------------------------------------------------------

def _raise_coded(violation: RuleViolation):
    raise CodedHTTPException(violation.status_code, violation.message, violation.code, **violation.extra) from violation


@router.post("/inspections/{inspection_id}/correction/reassign")
async def reassign_inspection_correction(
    inspection_id: str,
    request: ReassignCorrectionRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Give the open correction of a failed inspection to another eligible person in this hotel.

    Reuses the inspection's ONE correction task (never a second one). Refused when the correction is already settled,
    when the person is not an active housekeeper / supervisor here, or when it changed under the caller.
    """
    from routers.tasks import notify_task_event  # local: routers.tasks is a sibling router, not a dependency of this module

    try:
        UUID(inspection_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Inspection not found")
    try:
        outcome = reassign_correction(
            supabase,
            hotel_id=current_user.hotel_id,
            inspection_id=inspection_id,
            assignee_id=str(request.assigned_to),
            check_expected="expected_assigned_to" in request.model_fields_set,
            expected_assignee_id=str(request.expected_assigned_to) if request.expected_assigned_to else None,
        )
    except RuleViolation as violation:
        _raise_coded(violation)
    task = outcome["task"]
    if outcome["changed"]:
        record_correction_audit(
            supabase,
            hotel_id=current_user.hotel_id,
            actor_id=current_user.user_id,
            actor_role=current_user.role,
            task={**task, "assigned_to": outcome["previous_assigned_to"]},
            action=ACTION_REASSIGNED,
            new_state={"assigned_to": task.get("assigned_to"), "status": task.get("status")},
        )
        await notify_task_event(current_user, task.get("assigned_to"), "task_assigned_urgent", task)
        await notify_task_event(current_user, outcome["previous_assigned_to"], "task_reassigned", task)
    return {"data": {"inspection_id": inspection_id, "changed": outcome["changed"], "task": {**task, "assigned_name": profile_name(supabase, current_user.hotel_id, task.get("assigned_to"))}}}


@router.post("/inspections/{inspection_id}/correction/escalate")
async def escalate_inspection_correction(
    inspection_id: str,
    request: EscalateCorrectionRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Escalate an open correction. Records who did it and when; escalating twice records it once."""
    try:
        UUID(inspection_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Inspection not found")
    try:
        outcome = escalate_correction(supabase, hotel_id=current_user.hotel_id, inspection_id=inspection_id)
    except RuleViolation as violation:
        _raise_coded(violation)
    task = outcome["task"]
    if outcome["changed"]:
        note = (request.note or "").strip() or None
        record_correction_audit(
            supabase,
            hotel_id=current_user.hotel_id,
            actor_id=current_user.user_id,
            actor_role=current_user.role,
            task={**task, "status": "open" if not task.get("started_at") else "in_progress"},
            action=ACTION_ESCALATED,
            new_state={"status": "escalated", "assigned_to": task.get("assigned_to")},
            note=note,
        )
        if note:
            try:
                supabase.table("task_comments").insert(
                    {"task_id": task["id"], "tenant_id": current_user.hotel_id, "user_id": current_user.user_id, "comment": note}
                ).execute()
            except Exception:  # noqa: BLE001 - the escalation is recorded; the note also lives in the audit trail
                logger.error("CORRECTION_ESCALATION_NOTE_FAILED task=%s", task.get("id"), exc_info=True)
    return {"data": {"inspection_id": inspection_id, "changed": outcome["changed"], "task": task}}


# ---------------------------------------------------------------------------
# GET /housekeeping/inspections/{inspection_id}
# ---------------------------------------------------------------------------

@router.get("/inspections/{inspection_id}")
async def get_inspection(
    inspection_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """One inspection with every answer, its evidence and the state of its correction.

    Registered after the fixed `/inspections/templates` and `/inspections/submissions/...` GET routes so
    those literal paths are never captured as an id.
    """
    try:
        UUID(inspection_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Inspection not found")
    detail = load_inspection_detail(supabase, current_user.hotel_id, inspection_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return {"data": detail}


# ---------------------------------------------------------------------------
# POST /housekeeping/inspections/templates
# ---------------------------------------------------------------------------

def _clear_other_default_templates(tenant_id: str, keep_template_id: str) -> None:
    """Exactly one inspection template per tenant may be the default."""
    supabase.table("inspection_templates") \
        .update({"is_default": False}) \
        .eq("tenant_id", tenant_id) \
        .eq("is_default", True) \
        .neq("id", keep_template_id) \
        .execute()


@router.post("/inspections/templates")
async def create_inspection_template(
    body: dict,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Create a new inspection checklist template with items."""
    name = body.get("name", "Custom Inspection")
    items = body.get("items", [])

    tmpl = supabase.table("inspection_templates").insert({
        "tenant_id": current_user.hotel_id,
        "name": name,
        "room_type_id": body.get("room_type_id"),
        "is_default": body.get("is_default", False),
        "is_active": True,
    }).execute()

    template_id = tmpl.data[0]["id"]
    if tmpl.data[0].get("is_default"):
        _clear_other_default_templates(current_user.hotel_id, template_id)
    created_items = items or []

    if items:
        items_data = [
            {
                "template_id": template_id,
                "tenant_id": current_user.hotel_id,
                "section": item.get("section", "General"),
                "description": item.get("description", ""),
                "is_required": item.get("is_required", True),
                "requires_photo_on_fail": item.get("requires_photo_on_fail", False),
                "sort_order": item.get("sort_order", idx),
            }
            for idx, item in enumerate(items)
        ]
        supabase.table("inspection_template_items").insert(items_data).execute()

    record_settings_event(
        db=supabase, current_user=current_user, action="settings.inspection_template.created",
        resource_type="inspection_template", resource_id=template_id,
        new_state={
            "name": tmpl.data[0].get("name"), "is_default": bool(tmpl.data[0].get("is_default")), "is_active": True,
            **_template_shape(created_items),
        },
        only_changes=False,
    )
    return {"data": tmpl.data[0]}


# ---------------------------------------------------------------------------
# PATCH /housekeeping/inspections/templates/{template_id}
# ---------------------------------------------------------------------------

@router.patch("/inspections/templates/{template_id}")
async def update_inspection_template(
    template_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Update an inspection template name/default flag and replace its items."""
    existing = supabase.table("inspection_templates") \
        .select("id, name, is_default, is_active") \
        .eq("id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .maybe_single().execute()
    if not (existing and existing.data):
        raise HTTPException(status_code=404, detail="Template not found")
    before_template = dict(existing.data)  # snapshot for the audit trail
    previous_items = None
    if "items" in body:
        previous_items = supabase.table("inspection_template_items") \
            .select("section") \
            .eq("template_id", template_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute().data or []

    update_data: dict = {}
    if "name" in body:
        update_data["name"] = body["name"]
    if "is_default" in body:
        update_data["is_default"] = body["is_default"]
    if "is_active" in body:
        update_data["is_active"] = body["is_active"]

    if update_data:
        supabase.table("inspection_templates") \
            .update(update_data) \
            .eq("id", template_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()
        if update_data.get("is_default") is True:
            _clear_other_default_templates(current_user.hotel_id, template_id)

    if "items" in body:
        supabase.table("inspection_template_items") \
            .delete() \
            .eq("template_id", template_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()
        items = body["items"] or []
        if items:
            items_data = [
                {
                    "template_id": template_id,
                    "tenant_id": current_user.hotel_id,
                    "section": item.get("section", "General"),
                    "description": item.get("description", ""),
                "is_required": item.get("is_required", True),
                "requires_photo_on_fail": item.get("requires_photo_on_fail", False),
                    "sort_order": idx,
                }
                for idx, item in enumerate(items)
            ]
            supabase.table("inspection_template_items").insert(items_data).execute()

    tmpl = supabase.table("inspection_templates") \
        .select("id, name, room_type_id, is_default, is_active") \
        .eq("id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .maybe_single().execute()

    if not tmpl.data:
        raise HTTPException(status_code=404, detail="Template not found")

    item_result = supabase.table("inspection_template_items") \
        .select("id, section, description, is_required, requires_photo_on_fail, sort_order") \
        .eq("template_id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .order("sort_order") \
        .execute()

    old_audit = {k: before_template.get(k) for k in ("name", "is_default", "is_active")}
    new_audit = {k: tmpl.data.get(k) for k in ("name", "is_default", "is_active")}
    if previous_items is not None:
        old_audit.update(_template_shape(previous_items))
        new_audit.update(_template_shape(item_result.data or []))
    record_settings_event(
        db=supabase, current_user=current_user, action="settings.inspection_template.updated",
        resource_type="inspection_template", resource_id=template_id,
        old_state=old_audit, new_state=new_audit,
    )
    return {"data": {**tmpl.data, "items": item_result.data or []}}


# ---------------------------------------------------------------------------
# DELETE /housekeeping/inspections/templates/{template_id}
# ---------------------------------------------------------------------------

@router.post("/inspections/{inspection_id}/photos")
async def upload_inspection_photo(
    inspection_id: str,
    template_item_id: str = Form(...),
    photo: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Upload evidence and attach it to one inspection checklist result."""
    insp = (
        supabase.table("inspections")
        .select("id")
        .eq("id", inspection_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not insp or not insp.data:
        raise HTTPException(status_code=404, detail="Inspection not found")

    result = (
        supabase.table("inspection_results")
        .select("id")
        .eq("inspection_id", inspection_id)
        .eq("template_item_id", template_item_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Inspection checklist item not found")

    if photo.content_type not in ALLOWED_INSPECTION_PHOTO_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images are allowed")
    file_bytes = await photo.read(MAX_INSPECTION_PHOTO_BYTES + 1)
    if len(file_bytes) > MAX_INSPECTION_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo must be 5 MB or smaller")

    extension = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }[photo.content_type]
    timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)
    path = f"{current_user.hotel_id}/inspections/{inspection_id}/{template_item_id}-{timestamp}.{extension}"

    supabase.storage.from_("work-order-photos").upload(
        path,
        file_bytes,
        {"content-type": photo.content_type, "upsert": "false"},
    )
    public_url = supabase.storage.from_("work-order-photos").get_public_url(path)
    supabase.table("inspection_results").update({"photo_url": public_url}) \
        .eq("id", result.data["id"]) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    return {"data": {"url": public_url, "template_item_id": template_item_id}}


HANDOFF_NOTIFICATION_TYPE = "shift_summary"
# A handoff covers one hotel-local day; the previous day stays open so an overnight supervisor can still file it.
HANDOFF_MAX_DAYS_BACK = 1
HANDOFF_INSPECTION_ROW_LIMIT = 5000


def _handoff_error(status_code: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})


def _handoff_window(report_date: date, zone) -> tuple[str, str]:
    """[local midnight, next local midnight) as UTC ISO strings, correct across DST changes."""
    return _hotel_reporting_window(report_date, report_date, zone)


def _count_handoff_inspections(hotel_id: str, start_iso: str, end_iso: str) -> dict:
    """Completed inspections in the window, counted by recorded result.

    These are ACTIVITY counts: a room inspected twice counts twice, and they have no relationship to how
    many rooms are ready right now.
    """
    rows = (
        supabase.table("inspections")
        .select("id, overall_result")
        .eq("tenant_id", hotel_id)
        .gte("completed_at", start_iso)
        .lt("completed_at", end_iso)
        .limit(HANDOFF_INSPECTION_ROW_LIMIT)
        .execute()
        .data
        or []
    )
    counts = {"passed": 0, "failed": 0, "conditional": 0}
    seen: set = set()
    for row in rows:
        row_id = row.get("id")
        if row_id is not None:
            if row_id in seen:
                continue
            seen.add(row_id)
        result = str(row.get("overall_result") or "").lower()
        if result in counts:
            counts[result] += 1
    return counts


def _resolve_handoff_department(hotel_id: str) -> str:
    """The hotel's Housekeeping department. Never falls back to some other department."""
    rows = (
        supabase.table("departments")
        .select("id, name, code")
        .eq("tenant_id", hotel_id)
        .execute()
        .data
        or []
    )
    ids = {
        row["id"]
        for row in rows
        if row.get("id")
        and (
            str(row.get("code") or "").strip().upper() == "HK"
            or str(row.get("name") or "").strip().lower() == "housekeeping"
        )
    }
    if not ids:
        raise _handoff_error(422, "housekeeping_department_missing", "Housekeeping department could not be identified.")
    if len(ids) > 1:
        raise _handoff_error(
            422, "housekeeping_department_ambiguous", "More than one Housekeeping department exists for this hotel."
        )
    return next(iter(ids))


def _room_list(label: str, count: int, numbers: list[str]) -> str:
    shown = ", ".join(numbers)
    more = count - len(numbers)
    if not shown:
        return label
    return f"{label} ({shown}{f' +{more} more' if more > 0 else ''})"


def build_handoff_content(body: EndShiftSummaryRequest, inspections: dict) -> str:
    """The saved report text, built only from validated figures so what is stored is what was reviewed."""
    rooms = body.rooms
    unresolved = body.unresolved
    in_service = rooms.total - rooms.out_of_order
    lines = [
        f"Housekeeping shift handoff for {body.report_date.isoformat()} (hotel day).",
        (
            f"Rooms now: {rooms.ready} of {in_service} in-service rooms ready; {rooms.awaiting_inspection} awaiting "
            f"inspection, {rooms.in_progress} in progress, {rooms.to_clean} to clean; {rooms.out_of_order} out of order."
        ),
        (
            f"Inspections completed this day: {inspections['passed']} passed, {inspections['failed']} failed, "
            f"{inspections['conditional']} conditional."
        ),
    ]
    open_items = []
    if rooms.awaiting_inspection:
        open_items.append(
            _room_list(
                f"{rooms.awaiting_inspection} room(s) awaiting inspection",
                rooms.awaiting_inspection,
                unresolved.awaiting_inspection_room_numbers,
            )
        )
    if unresolved.unassigned_rooms:
        open_items.append(
            _room_list(
                f"{unresolved.unassigned_rooms} unassigned room(s)",
                unresolved.unassigned_rooms,
                unresolved.unassigned_room_numbers,
            )
        )
    if unresolved.blocked_tasks is None:
        open_items.append("blocked tasks: not verified")
    elif unresolved.blocked_tasks:
        open_items.append(f"{unresolved.blocked_tasks} blocked task(s)")
    lines.append("Still open: " + "; ".join(open_items) + "." if open_items else "Still open: nothing reported.")
    if body.notes:
        lines.append(f"Supervisor notes: {body.notes}")
    lines.append(
        "Counts are a snapshot taken at submission. Submitting this report does not complete work or clock anyone out."
    )
    return "\n".join(lines)


def _find_handoff(hotel_id: str, user_id: str, client_request_id: str) -> Optional[dict]:
    result = (
        supabase.table("logbook_entries")
        .select("id, tenant_id, department_id, entry_date, content, created_at, client_request_id")
        .eq("tenant_id", hotel_id)
        .eq("author_id", user_id)
        .eq("client_request_id", client_request_id)
        .maybe_single()
        .execute()
    )
    return result.data if result else None


def _handoff_manager_ids(hotel_id: str, author_id: str) -> list[str]:
    rows = (
        supabase.table("user_roles")
        .select("user_id")
        .eq("tenant_id", hotel_id)
        .eq("role", "gm")
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    return sorted({str(row["user_id"]) for row in rows if row.get("user_id") and str(row["user_id"]) != author_id})


def _handoff_notification_status(hotel_id: str, author_id: str, entry: dict) -> dict:
    """Read, never write, the durable GM-notification state for a saved handoff."""
    recipients = _handoff_manager_ids(hotel_id, author_id)
    if not recipients:
        return {"status": "none_needed", "recipients": 0}
    expected_ids = [str(uuid5(NAMESPACE_URL, f"patelrep:handoff:{entry['id']}:{user_id}")) for user_id in recipients]
    delivered = (
        supabase.table("notifications")
        .select("id")
        .eq("tenant_id", hotel_id)
        .eq("type", HANDOFF_NOTIFICATION_TYPE)
        .in_("id", expected_ids)
        .execute()
        .data
        or []
    )
    delivered_ids = {str(row.get("id")) for row in delivered if row.get("id")}
    return {"status": "complete" if len(delivered_ids) == len(expected_ids) else "failed", "recipients": len(recipients)}


def _handoff_payload(entry: dict) -> dict:
    return {
        "id": entry.get("id"),
        "client_request_id": entry.get("client_request_id"),
        "department_id": entry.get("department_id"),
        "report_date": entry.get("entry_date"),
        "content": entry.get("content"),
        "created_at": entry.get("created_at"),
    }


def _is_unique_violation(exc: Exception) -> bool:
    return getattr(exc, "code", None) == "23505" or "23505" in str(exc)


def _notify_handoff_managers(hotel_id: str, author_id: str, entry: dict, content: str) -> dict:
    """Tell the hotel's GMs. Safe to run any number of times for one entry.

    Each notification has a deterministic id derived from (entry, recipient) and is written with
    ignore-duplicates, so a retry fills in whatever is missing and never doubles what was delivered.
    """
    try:
        recipients = _handoff_manager_ids(hotel_id, author_id)
        if not recipients:
            return {"status": "none_needed", "recipients": 0}
        first_line = content.split("\n", 1)[0]
        rows = [
            {
                "id": str(uuid5(NAMESPACE_URL, f"patelrep:handoff:{entry['id']}:{user_id}")),
                "tenant_id": hotel_id,
                "user_id": user_id,
                "title": "Housekeeping shift handoff submitted",
                "body": first_line,
                "type": HANDOFF_NOTIFICATION_TYPE,
                "data": {"entry_id": entry["id"], "href": f"/logbook?entry={entry['id']}"},
            }
            for user_id in recipients
        ]
        supabase.table("notifications").upsert(rows, on_conflict="id", ignore_duplicates=True).execute()
        return _handoff_notification_status(hotel_id, author_id, entry)
    except Exception:  # the report is already saved; a retry of the same submission completes this
        logging.getLogger(__name__).exception("Handoff notification failed for entry %s", entry.get("id"))
        return {"status": "failed", "recipients": None}


def _handoff_response(entry: dict, replay: bool, notifications: Optional[dict] = None) -> dict:
    response: dict = {"data": _handoff_payload(entry), "idempotent_replay": replay}
    if notifications is not None:
        response["notifications"] = notifications
    return response


@router.post("/end-shift-summary")
async def submit_end_shift_summary(
    body: EndShiftSummaryRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Save a supervisor's housekeeping shift handoff to the logbook and notify GMs, exactly once.

    `client_request_id` makes the call replay-safe: the same id from the same person returns the report that
    was already saved (and finishes any GM notifications that did not go out the first time) instead of
    writing a second one. The inspection counts are re-derived here from the inspections table; if they no
    longer match what the supervisor reviewed the call is refused with the current figures (409) so they can
    review again. The room snapshot is the client's Room Board reading, validated for consistency.
    """
    hotel_id, user_id = current_user.hotel_id, current_user.user_id
    key = str(body.client_request_id)

    existing = _find_handoff(hotel_id, user_id, key)
    if existing:
        notifications = _notify_handoff_managers(hotel_id, user_id, existing, existing.get("content") or "")
        return _handoff_response(existing, True, notifications)

    zone = _hotel_zone(hotel_id)
    hotel_today = datetime.now(zone).date()
    if body.report_date > hotel_today or body.report_date < hotel_today - timedelta(days=HANDOFF_MAX_DAYS_BACK):
        raise _handoff_error(
            422, "report_date_out_of_range", "A handoff can only cover today or yesterday in the hotel's time zone."
        )

    start_iso, end_iso = _handoff_window(body.report_date, zone)
    inspections = _count_handoff_inspections(hotel_id, start_iso, end_iso)
    reviewed = body.inspections.model_dump()
    if inspections != reviewed:
        raise _handoff_error(
            409,
            "inspection_counts_changed",
            "Inspection results changed since this handoff was reviewed.",
            inspections=inspections,
        )

    department_id = _resolve_handoff_department(hotel_id)
    content = build_handoff_content(body, inspections)
    payload = {
        "tenant_id": hotel_id,
        "department_id": department_id,
        "author_id": user_id,
        "content": content,
        "entry_date": body.report_date.isoformat(),
        "category": "room",
        "status": "informational",
        "priority": "normal",
        "client_request_id": key,
    }
    if body.report_date == hotel_today:
        # Same rule as manual logbook entries: attach the department's active shift only when exactly one is.
        from routers.logbook import _resolve_active_shift

        active_shift = _resolve_active_shift(hotel_id, department_id)
        payload["shift_id"] = active_shift["id"] if active_shift else None

    try:
        result = supabase.table("logbook_entries").insert(payload).execute()
    except Exception as exc:
        if not _is_unique_violation(exc):
            raise
        # Two copies of the same submission raced; the other one won. Answer with its report.
        winner = _find_handoff(hotel_id, user_id, key)
        if not winner:
            raise
        return _handoff_response(winner, True, _notify_handoff_managers(hotel_id, user_id, winner, winner.get("content") or ""))

    entry = result.data[0] if result.data else None
    if not entry:
        raise _handoff_error(500, "handoff_not_saved", "The handoff could not be saved.")
    entry.setdefault("client_request_id", key)
    return _handoff_response(entry, False, _notify_handoff_managers(hotel_id, user_id, entry, content))


@router.get("/end-shift-summary/{client_request_id}")
async def get_end_shift_summary(
    client_request_id: UUID,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """The handoff this person saved under `client_request_id`, or 404. Lets the app learn whether a
    submission whose answer never arrived was stored, without writing anything."""
    entry = _find_handoff(current_user.hotel_id, current_user.user_id, str(client_request_id))
    if not entry:
        raise _handoff_error(404, "handoff_not_found", "No handoff was saved under that request.")
    return _handoff_response(
        entry,
        True,
        _handoff_notification_status(current_user.hotel_id, current_user.user_id, entry),
    )


@router.delete("/inspections/templates/{template_id}", status_code=204)
async def delete_inspection_template(
    template_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """Remove an inspection template without ever touching completed inspections.

    - The default template cannot be removed while other templates exist (409): pick a new default first.
    - A template already used by a completed inspection is archived (is_active = false) and keeps its
      items, so history stays intact; an unused template is deleted outright.
    """
    tmpl = supabase.table("inspection_templates") \
        .select("id, name, is_default, is_active") \
        .eq("id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .maybe_single().execute()
    if not (tmpl and tmpl.data):
        raise HTTPException(status_code=404, detail="Template not found")

    before_template = dict(tmpl.data)  # snapshot for the audit trail
    if tmpl.data.get("is_default"):
        others = supabase.table("inspection_templates") \
            .select("id") \
            .eq("tenant_id", current_user.hotel_id) \
            .eq("is_active", True) \
            .neq("id", template_id) \
            .limit(1).execute()
        if others.data:
            raise HTTPException(
                status_code=409,
                detail="This is the default template. Set another template as the default before removing it.",
            )

    used = supabase.table("inspections") \
        .select("id") \
        .eq("template_id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .limit(1).execute()
    if used.data:
        supabase.table("inspection_templates") \
            .update({"is_active": False, "is_default": False}) \
            .eq("id", template_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()
        record_settings_event(
            db=supabase, current_user=current_user, action="settings.inspection_template.archived",
            resource_type="inspection_template", resource_id=template_id,
            old_state={k: before_template.get(k) for k in ("name", "is_default", "is_active")},
            new_state={"name": before_template.get("name"), "is_default": False, "is_active": False},
            only_changes=False,
        )
        return

    supabase.table("inspection_template_items") \
        .delete() \
        .eq("template_id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    supabase.table("inspection_templates") \
        .delete() \
        .eq("id", template_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    record_settings_event(
        db=supabase, current_user=current_user, action="settings.inspection_template.deleted",
        resource_type="inspection_template", resource_id=template_id,
        old_state={k: before_template.get(k) for k in ("name", "is_default", "is_active")}, only_changes=False,
    )


def _template_shape(items: list) -> dict:
    """Section and check counts for the audit summary (item text itself is not recorded)."""
    return {
        "section_count": len({(i.get("section") or "General") for i in items}),
        "check_count": len(items),
    }


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# POST /housekeeping/import/hk-details
# ---------------------------------------------------------------------------

@router.post("/import/hk-details/preview")
async def preview_hk_details_import(
    file: UploadFile = File(...),
    assignment_date: str = Form(...),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    try:
        date.fromisoformat(assignment_date)
        rows, warnings = parse_hk_details(await file.read())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid housekeeping date") from exc
    if not rows:
        raise HTTPException(status_code=422, detail="No room data found in PDF — check file format")
    return {"data": _build_opera_import_preview(rows, warnings, current_user.hotel_id, "hk-details")}

@router.post("/import/hk-details")
async def import_hk_details(
    file: UploadFile = File(...),
    assignment_date: str = Form(...),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """
    Import an Opera HK Details PDF to reset room_status for the day.
    Overrides any current room status including IN_PROGRESS.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    pdf_bytes = await file.read()
    rows, warnings = parse_hk_details(pdf_bytes)

    if not rows:
        raise HTTPException(status_code=422, detail="No room data found in PDF — check file format")

    _clear_import_history_markers(current_user.hotel_id, assignment_date)

    # Fetch all rooms for this hotel to resolve room_number → room_id
    rooms_res = supabase.table("rooms") \
        .select("id, room_number") \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    room_map: dict[str, str] = {r["room_number"]: r["id"] for r in (rooms_res.data or [])}

    # Prior status per room, so the stay_reset_at boundary only moves on a genuine
    # fresh-inspection transition — not on every imported row that already was INSPECTED.
    prior_status_res = supabase.table("room_status") \
        .select("room_id, status") \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    prior_status_map: dict[str, str] = {
        r["room_id"]: r["status"] for r in (prior_status_res.data or [])
    }

    applied = 0
    skipped_active = 0
    not_found: list[str] = []
    room_ids_processed: list[str] = []

    for row in rows:
        room_id = room_map.get(row.room_number)
        if not room_id:
            not_found.append(row.room_number)
            continue
        if prior_status_map.get(room_id) == "IN_PROGRESS":
            skipped_active += 1
            continue

        resolved_status = (
            "OCCUPIED"
            if row.our_status == "DIRTY" and row.fo_status == "OCC"
            else row.our_status
        )

        now_iso = datetime.now(timezone.utc).isoformat()
        update_data: dict = {
            "room_id": room_id,
            "tenant_id": current_user.hotel_id,
            "status": resolved_status,
            "fo_status": row.fo_status,
            "actual_checkout_at": None,
            "checkout_time": None,
            "checkin_time": None,
            "clean_type": None,
            "guest_name": None,
            "vip_flag": False,
            "dnd_flag": False,
            "do_not_service": False,
            "notes": None,
            "stripped": False,
            "stripped_by": None,
            "stripped_at": None,
            "assigned_to": None,
        }
        if resolved_status == "INSPECTED" and prior_status_map.get(room_id) != "INSPECTED":
            update_data["stay_reset_at"] = now_iso

        _execute_room_status_clean_type_write(
            update_data,
            lambda payload: supabase.table("room_status").upsert(payload, on_conflict="room_id"),
        )
        applied += 1
        room_ids_processed.append(room_id)

    # Cancel any pending late-checkout requests for imported rooms — Opera is the
    # source of truth so yesterday's housekeeping flags no longer apply.
    if room_ids_processed:
        try:
            supabase.table("late_checkout_requests") \
                .update({"status": "cancelled"}) \
                .eq("tenant_id", current_user.hotel_id) \
                .eq("status", "pending") \
                .in_("room_id", room_ids_processed) \
                .execute()
        except Exception:
            pass

    if not_found:
        warnings.append(f"Rooms not found in system: {', '.join(not_found[:20])}")

    return {
        "data": {
            "applied": applied,
            "skipped_active": skipped_active,
            "not_found": len(not_found),
            "total_parsed": len(rows),
            "warnings": warnings,
        }
    }


# ---------------------------------------------------------------------------
# POST /housekeeping/import/task-sheet
# ---------------------------------------------------------------------------

@router.post("/import/task-sheet/preview")
async def preview_task_sheet_import(
    file: UploadFile = File(...),
    assignment_date: str = Form(...),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    try:
        date.fromisoformat(assignment_date)
        rows, warnings = parse_task_sheet(await file.read())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid housekeeping date") from exc
    except Exception as exc:
        logger.warning("Task sheet PDF parsing failed: %s", exc)
        raise HTTPException(status_code=422, detail="Could not read PDF. Please upload a valid Opera Task Sheet.") from exc
    if not rows:
        raise HTTPException(status_code=422, detail="No room data found in PDF — check file format")
    return {"data": _build_opera_import_preview(rows, warnings, current_user.hotel_id, "task-sheet")}

@router.post("/import/task-sheet")
async def import_task_sheet(
    file: UploadFile = File(...),
    assignment_date: str = Form(...),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    """
    Import an Opera Task Sheet PDF to set clean_type for rooms needing cleaning.
    Overrides any current room status including IN_PROGRESS.
    Sets DIRTY+OCC+Stayover rooms with FULL/LIGHT task to PICKUP status.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    pdf_bytes = await file.read()
    try:
        rows, warnings = parse_task_sheet(pdf_bytes)
    except Exception as exc:
        logger.warning("Task sheet PDF parsing failed: %s", exc)
        raise HTTPException(status_code=422, detail="Could not read PDF. Please upload a valid Opera Task Sheet.")

    if not rows:
        raise HTTPException(status_code=422, detail="No room data found in PDF — check file format")

    # Purge generated same-day import markers so every Task Sheet import starts fresh.
    try:
        _clear_import_history_markers(current_user.hotel_id, assignment_date)
    except Exception:
        pass  # non-fatal — stale notes will be overwritten by new ones below

    # Fetch all rooms for this hotel
    rooms_res = supabase.table("rooms") \
        .select("id, room_number") \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    room_map: dict[str, str] = {r["room_number"]: r["id"] for r in (rooms_res.data or [])}

    applied = 0
    skipped_active = 0
    not_found: list[str] = []
    room_ids_processed: list[str] = []

    for row in rows:
        room_id = room_map.get(row.room_number)
        if not room_id:
            not_found.append(row.room_number)
            continue

        # Fetch current room status
        current = supabase.table("room_status") \
            .select("status, fo_status") \
            .eq("room_id", room_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .maybe_single() \
            .execute()

        current_status = current.data.get("status") if (current and current.data) else None
        if current_status == "IN_PROGRESS":
            skipped_active += 1
            continue

        # Determine the new status based on Opera occupancy + reservation status.
        # DI + OCC + Stayover = PICKUP regardless of task column.
        # DEP stays OCCUPIED (guest still in room until actual checkout).
        new_status = current_status or "DIRTY"
        fo = row.fo_status or (current.data.get("fo_status") if (current and current.data) else None)
        res_lower = (row.reservation_status or "").lower()
        is_stayover_or_arrived = "stayover" in res_lower or "arrived" in res_lower

        if row.clean_type == "DEP":
            new_status = "OCCUPIED" if fo == "OCC" else "DIRTY"
        elif fo == "OCC" and is_stayover_or_arrived:
            new_status = "PICKUP"

        # Update clean_type on existing assignment if one exists; skip if not yet assigned
        if row.clean_type:
            supabase.table("room_assignments") \
                .update({"clean_type": row.clean_type}) \
                .eq("room_id", room_id) \
                .eq("assignment_date", assignment_date) \
                .eq("tenant_id", current_user.hotel_id) \
                .execute()

        # Update room_status with new status and fo_status
        status_update = {
            "room_id": room_id,
            "tenant_id": current_user.hotel_id,
            "status": new_status,
            "fo_status": fo,
            "actual_checkout_at": None,
            "checkout_time": None,
        }
        if row.clean_type:
            status_update["clean_type"] = row.clean_type

        _execute_room_status_clean_type_write(
            status_update,
            lambda payload: supabase.table("room_status").upsert(payload, on_conflict="room_id"),
        )

        history_notes = _task_sheet_clean_type_note(row.clean_type) if row.clean_type else None
        supabase.table("room_status_history").insert({
            "room_id": room_id,
            "tenant_id": current_user.hotel_id,
            "from_status": current_status,
            "to_status": new_status,
            "changed_by": current_user.user_id,
            "change_source": "system",
            **({"notes": history_notes} if history_notes else {}),
        }).execute()

        applied += 1
        room_ids_processed.append(room_id)

    # Cancel any pending late-checkout requests for imported rooms — Opera is the
    # source of truth so yesterday's housekeeping flags no longer apply.
    if room_ids_processed:
        try:
            supabase.table("late_checkout_requests") \
                .update({"status": "cancelled"}) \
                .eq("tenant_id", current_user.hotel_id) \
                .eq("status", "pending") \
                .in_("room_id", room_ids_processed) \
                .execute()
        except Exception:
            pass

    if not_found:
        warnings.append(f"Rooms not found in system: {', '.join(not_found[:20])}")

    return {
        "data": {
            "applied": applied,
            "skipped_active": skipped_active,
            "not_found": len(not_found),
            "total_parsed": len(rows),
            "warnings": warnings,
        }
    }
