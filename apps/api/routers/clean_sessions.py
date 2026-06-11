import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from dateutil import tz as dateutil_tz

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from middleware.auth import require_role, CurrentUser
from models.requests import (
    CleanSessionBlockerRequest,
    CompleteCleanSessionRequest,
    CreateCleanSessionRequest,
    UpdateCleanSessionRequest,
)
from core.database import supabase
from routers.cleaning_checklists import get_checklist_template_for_clean_type
from services.room_status_transitions import (
    SESSION_STARTABLE_STATUSES,
    apply_status_transition,
    update_housekeeper_profile,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clean-sessions", tags=["clean-sessions"])

SESSION_ROLES = ("housekeeper", "housekeeping_supervisor")
ALLOWED_PHOTO_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_CLEAN_MINUTES = 240


def _checklist_counts(checklist: list[dict]) -> tuple[int, int]:
    done = sum(1 for item in checklist if item.get("checked"))
    return done, len(checklist)


def _serialize_checklist(items) -> list[dict]:
    return [item.model_dump(mode="json") for item in items]


def _get_session(session_id: str, hotel_id: str) -> dict:
    result = (
        supabase.table("room_clean_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    session = (result.data if result else None) or None
    if not session:
        raise HTTPException(status_code=404, detail="Clean session not found")
    return session


def _require_session_owner(session: dict, current_user: CurrentUser) -> None:
    if session.get("housekeeper_id") == current_user.user_id:
        return
    if current_user.role in ("gm", "housekeeping_supervisor"):
        return
    raise HTTPException(status_code=403, detail="Not your clean session")


def _duration_seconds(started_at: str, ended_at: datetime) -> int:
    try:
        start_dt = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        seconds = int((ended_at - start_dt).total_seconds())
    except (ValueError, TypeError):
        return 0
    return max(0, min(seconds, MAX_CLEAN_MINUTES * 60))


def _get_hotel_tz(hotel_id: str):
    result = (
        supabase.table("hotels")
        .select("timezone")
        .eq("id", hotel_id)
        .maybe_single()
        .execute()
    )
    tz_name = ((result.data if result else None) or {}).get("timezone") or "America/Chicago"
    return dateutil_tz.gettz(tz_name) or dateutil_tz.gettz("America/Chicago")


def _get_signed_url(path: str) -> str:
    try:
        res = supabase.storage.from_("clean-photos").create_signed_url(path, 3600)
        return (res or {}).get("signedURL") or ""
    except Exception:
        logger.warning("Failed to create signed URL for path=%s", path)
        return ""


# ---------------------------------------------------------------------------
# POST /clean-sessions  (idempotent — id is client-generated)
# ---------------------------------------------------------------------------

@router.post("")
async def start_clean_session(
    request: CreateCleanSessionRequest,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session_id = str(request.id)
    room_id = str(request.room_id)

    # Idempotent replay: offline queue may retry the same start
    existing = (
        supabase.table("room_clean_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        return {"data": existing.data}

    # Conflict guard: another housekeeper already cleaning this room?
    active = (
        supabase.table("room_clean_sessions")
        .select("id, housekeeper_id")
        .eq("tenant_id", current_user.hotel_id)
        .eq("room_id", room_id)
        .eq("status", "active")
        .execute()
    )
    for row in (active.data or []):
        if row.get("housekeeper_id") != current_user.user_id:
            raise HTTPException(
                status_code=409,
                detail="Another housekeeper already has an active session on this room",
            )
        return {"data": _get_session(row["id"], current_user.hotel_id)}

    # Room status + tenant check
    status_row = (
        supabase.table("room_status")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_status = (status_row.data if status_row else None) or None
    if not room_status:
        raise HTTPException(status_code=404, detail="Room not found")

    previous_status = room_status.get("status")
    if previous_status == "IN_PROGRESS":
        # Legacy start already flipped the status; allow the session to attach.
        previous_status_for_revert = "DIRTY"
    elif previous_status in SESSION_STARTABLE_STATUSES:
        previous_status_for_revert = previous_status
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot start a clean from status {previous_status}",
        )

    # Today's assignment for clean type precedence (assignment -> room_status)
    assignment_row = (
        supabase.table("room_assignments")
        .select("id, clean_type")
        .eq("tenant_id", current_user.hotel_id)
        .eq("room_id", room_id)
        .eq("assigned_to", current_user.user_id)
        .order("assignment_date", desc=True)
        .limit(1)
        .execute()
    )
    assignment = (assignment_row.data or [{}])[0] if assignment_row.data else {}
    clean_type = assignment.get("clean_type") or room_status.get("clean_type")

    # Snapshot the checklist template and base clean minutes
    template = get_checklist_template_for_clean_type(current_user.hotel_id, clean_type)
    checklist = [
        {
            "item_id": item.get("id"),
            "section": item.get("section") or "General",
            "label": item.get("label"),
            "is_required": bool(item.get("is_required")),
            "checked": False,
            "checked_at": None,
        }
        for item in ((template or {}).get("items") or [])
    ]

    room_row = (
        supabase.table("rooms")
        .select("room_type_id, room_types(base_clean_minutes)")
        .eq("id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_data = (room_row.data if room_row else None) or {}
    base_clean_minutes = (room_data.get("room_types") or {}).get("base_clean_minutes")

    done, total = _checklist_counts(checklist)
    insert_payload = {
        "id": session_id,
        "tenant_id": current_user.hotel_id,
        "room_id": room_id,
        "assignment_id": assignment.get("id"),
        "housekeeper_id": current_user.user_id,
        "clean_type": clean_type,
        "previous_status": previous_status_for_revert,
        "base_clean_minutes": base_clean_minutes,
        "started_at": request.started_at.isoformat(),
        "status": "active",
        "checklist": checklist,
        "checklist_done": done,
        "checklist_total": total,
    }
    result = supabase.table("room_clean_sessions").insert(insert_payload).execute()
    session = (result.data or [insert_payload])[0]

    # Flip the room to IN_PROGRESS through the shared validated transition
    if previous_status != "IN_PROGRESS":
        apply_status_transition(
            room_id=room_id,
            hotel_id=current_user.hotel_id,
            user_id=current_user.user_id,
            role=current_user.role,
            to_status="IN_PROGRESS",
            current_row=room_status,
        )

    return {"data": session}


# ---------------------------------------------------------------------------
# GET /clean-sessions/active
# ---------------------------------------------------------------------------

@router.get("/active")
async def get_active_session(
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    result = (
        supabase.table("room_clean_sessions")
        .select("*")
        .eq("tenant_id", current_user.hotel_id)
        .eq("housekeeper_id", current_user.user_id)
        .eq("status", "active")
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return {"data": rows[0] if rows else None}


# ---------------------------------------------------------------------------
# GET /clean-sessions/summary?date=
# ---------------------------------------------------------------------------

@router.get("/summary")
async def get_sessions_summary(
    target_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    hotel_tz = _get_hotel_tz(current_user.hotel_id)
    if target_date:
        local_midnight = datetime(target_date.year, target_date.month, target_date.day, tzinfo=hotel_tz)
    else:
        local_midnight = datetime.now(hotel_tz).replace(hour=0, minute=0, second=0, microsecond=0)
    utc_start = local_midnight.astimezone(timezone.utc)
    utc_end = (local_midnight + timedelta(days=1)).astimezone(timezone.utc)
    result = (
        supabase.table("room_clean_sessions")
        .select("duration_seconds, base_clean_minutes, status, started_at")
        .eq("tenant_id", current_user.hotel_id)
        .eq("housekeeper_id", current_user.user_id)
        .eq("status", "completed")
        .gte("started_at", utc_start.isoformat())
        .lt("started_at", utc_end.isoformat())
        .execute()
    )
    completed = result.data or []
    total_actual_seconds = sum(int(row.get("duration_seconds") or 0) for row in completed)
    total_base_minutes = sum(int(row.get("base_clean_minutes") or 0) for row in completed)
    return {
        "data": {
            "completed_count": len(completed),
            "total_actual_minutes": round(total_actual_seconds / 60, 1),
            "total_base_minutes": total_base_minutes,
        }
    }


# ---------------------------------------------------------------------------
# GET /clean-sessions/{session_id}
# ---------------------------------------------------------------------------

@router.get("/{session_id}")
async def get_clean_session(
    session_id: str,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES, "gm")),
):
    session = _get_session(session_id, current_user.hotel_id)
    photos_result = (
        supabase.table("room_clean_photos")
        .select("id, kind, url, storage_path, created_at")
        .eq("session_id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at")
        .execute()
    )
    photos = []
    for photo in (photos_result.data or []):
        if photo.get("storage_path"):
            photo = {**photo, "url": _get_signed_url(photo["storage_path"])}
        photos.append(photo)
    return {"data": {**session, "photos": photos}}


# ---------------------------------------------------------------------------
# PATCH /clean-sessions/{session_id}  (checklist/notes sync — last write wins)
# ---------------------------------------------------------------------------

@router.patch("/{session_id}")
async def update_clean_session(
    session_id: str,
    request: UpdateCleanSessionRequest,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session = _get_session(session_id, current_user.hotel_id)
    _require_session_owner(session, current_user)

    update_payload: dict = {}
    if request.checklist is not None:
        checklist = _serialize_checklist(request.checklist)
        done, total = _checklist_counts(checklist)
        update_payload.update({
            "checklist": checklist,
            "checklist_done": done,
            "checklist_total": total,
        })
    if request.notes is not None:
        update_payload["notes"] = request.notes

    if not update_payload:
        return {"data": session}

    result = (
        supabase.table("room_clean_sessions")
        .update(update_payload)
        .eq("id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    rows = result.data or []
    return {"data": rows[0] if rows else {**session, **update_payload}}


# ---------------------------------------------------------------------------
# POST /clean-sessions/{session_id}/complete  (idempotent)
# ---------------------------------------------------------------------------

@router.post("/{session_id}/complete")
async def complete_clean_session(
    session_id: str,
    request: CompleteCleanSessionRequest,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session = _get_session(session_id, current_user.hotel_id)
    _require_session_owner(session, current_user)

    if session.get("status") == "completed":
        return {"data": session}  # idempotent replay
    if session.get("status") == "abandoned":
        raise HTTPException(status_code=409, detail="Session was abandoned")

    duration = _duration_seconds(session.get("started_at"), request.ended_at)

    update_payload: dict = {
        "status": "completed",
        "ended_at": request.ended_at.isoformat(),
        "duration_seconds": duration,
    }
    if request.checklist is not None:
        checklist = _serialize_checklist(request.checklist)
        done, total = _checklist_counts(checklist)
        update_payload.update({
            "checklist": checklist,
            "checklist_done": done,
            "checklist_total": total,
        })
    if request.notes is not None:
        update_payload["notes"] = request.notes

    result = (
        supabase.table("room_clean_sessions")
        .update(update_payload)
        .eq("id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    rows = result.data or []
    updated = rows[0] if rows else {**session, **update_payload}

    # Transition the room IN_PROGRESS -> CLEAN (tolerate legacy flips)
    room_id = session["room_id"]
    status_row = (
        supabase.table("room_status")
        .select("*")
        .eq("room_id", room_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    room_status = (status_row.data if status_row else None) or {}
    if room_status.get("status") == "IN_PROGRESS":
        apply_status_transition(
            room_id=room_id,
            hotel_id=current_user.hotel_id,
            user_id=current_user.user_id,
            role=current_user.role,
            to_status="CLEAN",
            current_row=room_status,
        )

    # Rolling average uses the TRUE session duration
    try:
        update_housekeeper_profile(
            hotel_id=current_user.hotel_id,
            room_id=room_id,
            user_id=session.get("housekeeper_id"),
            elapsed_minutes=duration / 60 if duration else None,
        )
    except Exception:
        logger.warning(
            "Failed to update housekeeper profile from session=%s", session_id,
            exc_info=True,
        )

    actual_minutes = round(duration / 60, 1) if duration else 0
    return {
        "data": {
            **updated,
            "actual_minutes": actual_minutes,
            "base_minutes": session.get("base_clean_minutes"),
        }
    }


# ---------------------------------------------------------------------------
# POST /clean-sessions/{session_id}/blocker  (abandon + revert room status)
# ---------------------------------------------------------------------------

@router.post("/{session_id}/blocker")
async def report_session_blocker(
    session_id: str,
    request: CleanSessionBlockerRequest,
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session = _get_session(session_id, current_user.hotel_id)
    _require_session_owner(session, current_user)

    if session.get("status") != "active":
        return {"data": session}  # already resolved; idempotent

    note = request.note or f"Blocked: {request.reason}"
    result = (
        supabase.table("room_clean_sessions")
        .update({
            "status": "abandoned",
            "blocked_reason": request.reason,
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "notes": note,
        })
        .eq("id", session_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    # Revert the room to its pre-session status with a history entry
    room_id = session["room_id"]
    previous_status = session.get("previous_status") or "DIRTY"
    now_iso = datetime.now(timezone.utc).isoformat()
    status_update: dict = {
        "status": previous_status,
        "notes": note,
        "updated_at": now_iso,
    }
    if request.reason == "dnd":
        status_update["dnd_flag"] = True
    supabase.table("room_status").update(status_update)\
        .eq("room_id", room_id).eq("tenant_id", current_user.hotel_id).execute()
    supabase.table("room_status_history").insert({
        "room_id": room_id,
        "tenant_id": current_user.hotel_id,
        "from_status": "IN_PROGRESS",
        "to_status": previous_status,
        "changed_by": current_user.user_id,
        "change_source": "app",
        "notes": note,
    }).execute()

    rows = result.data or []
    return {"data": rows[0] if rows else session}


# ---------------------------------------------------------------------------
# POST /clean-sessions/{session_id}/photos  (multipart upload)
# ---------------------------------------------------------------------------

@router.post("/{session_id}/photos")
async def upload_session_photo(
    session_id: str,
    file: UploadFile = File(...),
    kind: str = Form("proof"),
    current_user: CurrentUser = Depends(require_role(*SESSION_ROLES)),
):
    session = _get_session(session_id, current_user.hotel_id)
    _require_session_owner(session, current_user)

    if kind not in ("proof", "issue"):
        raise HTTPException(status_code=400, detail="kind must be 'proof' or 'issue'")
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images are allowed")

    contents = await file.read(MAX_PHOTO_BYTES + 1)
    if len(contents) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo must be 5 MB or smaller")

    ext = ALLOWED_PHOTO_TYPES[file.content_type]
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    path = f"{current_user.hotel_id}/{session_id}/{ts}.{ext}"
    try:
        supabase.storage.from_("clean-photos").upload(
            path, contents, {"content-type": file.content_type, "upsert": "false"}
        )
    except Exception:
        logger.warning("Clean photo upload failed for session=%s", session_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Photo upload failed")

    signed_url = _get_signed_url(path)
    insert = supabase.table("room_clean_photos").insert({
        "tenant_id": current_user.hotel_id,
        "session_id": session_id,
        "room_id": session["room_id"],
        "kind": kind,
        "storage_path": path,
        "url": signed_url,
        "created_by": current_user.user_id,
    }).execute()
    photo = (insert.data or [{}])[0]
    return {"data": {"id": photo.get("id"), "url": signed_url, "kind": kind}}
