"""Database helpers shared by the call-out and coverage routers (tenant-scoped; `hotel_id` always comes from the session).

Writes to a single coverage row are compare-and-set on `version`: the UPDATE matches only while the row still has the
version the caller read, so two supervisors can never both win. The one multi-table step (filling a gap) is the
`fill_coverage_gap` database function, which runs as a single transaction.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Optional


from core.database import supabase
from services.housekeeping_assignments import effective_room_status
from services.scheduling_access import err
from services.scheduling_coverage import effective_offer_status

logger = logging.getLogger(__name__)

ASSIGNMENT_SELECT = (
    "id, tenant_id, user_id, shift_id, work_date, shift_name, department_id, start_time, end_time, starts_at, ends_at, "
    "publication_state, version"
)
DONE_STATUSES = ("CLEAN", "INSPECTED")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def load_gap(hotel_id: str, gap_id: str) -> dict:
    row = supabase.table("coverage_gaps").select("*").eq("tenant_id", hotel_id).eq("id", gap_id).maybe_single().execute()
    if not row or not row.data:
        raise err(404, "gap_not_found", "Coverage gap not found")
    return row.data


def load_absence(hotel_id: str, absence_id: str) -> dict:
    row = supabase.table("absence_records").select("*").eq("tenant_id", hotel_id).eq("id", absence_id).maybe_single().execute()
    if not row or not row.data:
        raise err(404, "absence_not_found", "Absence not found")
    return row.data


def load_assignment(hotel_id: str, assignment_id: str) -> dict:
    row = (
        supabase.table("shift_assignments").select(ASSIGNMENT_SELECT)
        .eq("tenant_id", hotel_id).eq("id", assignment_id).maybe_single().execute()
    )
    if not row or not row.data:
        raise err(404, "assignment_not_found", "Shift not found")
    return row.data


def version_conflict(kind: str, current: Optional[dict]) -> Exception:
    return err(409, "version_conflict", f"This {kind} was changed by someone else. Reload to see the latest.", current=current)


def cas_update(table: str, hotel_id: str, row_id: str, expected_version: Optional[int], patch: dict) -> Optional[dict]:
    """UPDATE ... WHERE id AND tenant AND version = expected, bumping version. None = nothing matched (stale)."""
    body = {**patch, "updated_at": now_utc().isoformat()}
    query = supabase.table(table)
    if expected_version is not None:
        body["version"] = expected_version + 1
    update = query.update(body).eq("tenant_id", hotel_id).eq("id", row_id)
    if expected_version is not None:
        update = update.eq("version", expected_version)
    rows = update.execute().data or []
    return rows[0] if rows else None


def gap_children(gap_ids: list[str], hotel_id: str) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    if not gap_ids:
        return {}, {}
    offers: dict[str, list[dict]] = {}
    claims: dict[str, list[dict]] = {}
    for row in supabase.table("coverage_offers").select("*").eq("tenant_id", hotel_id).in_("gap_id", gap_ids).execute().data or []:
        offers.setdefault(str(row["gap_id"]), []).append(row)
    for row in supabase.table("coverage_claims").select("*").eq("tenant_id", hotel_id).in_("gap_id", gap_ids).execute().data or []:
        claims.setdefault(str(row["gap_id"]), []).append(row)
    return offers, claims


def shape_offer(offer: dict, names: dict[str, str], now: datetime) -> dict:
    return {
        "id": offer["id"], "gap_id": offer["gap_id"], "user_id": offer["user_id"], "user_name": names.get(str(offer["user_id"]), ""),
        "status": effective_offer_status(offer, now), "expires_at": offer.get("expires_at"),
        "offered_by": offer.get("offered_by"), "responded_at": offer.get("responded_at"),
        "delivery": offer.get("delivery", "not_sent"), "created_at": offer.get("created_at"), "version": offer.get("version", 1),
    }


def shape_claim(claim: dict, names: dict[str, str]) -> dict:
    return {
        "id": claim["id"], "gap_id": claim["gap_id"], "user_id": claim["user_id"], "user_name": names.get(str(claim["user_id"]), ""),
        "status": claim.get("status"), "created_at": claim.get("created_at"), "decided_at": claim.get("decided_at"),
        "decision_reason": claim.get("decision_reason"),
    }


def shape_gap(gap: dict, offers: list[dict], claims: list[dict], names: dict[str, str], now: datetime, absence: Optional[dict] = None) -> dict:
    """Manager view of a gap. `open_shift_state` is the contract's open/claimed/filled/... derived from gap + claims."""
    live_offers = [shape_offer(o, names, now) for o in offers]
    pending_offers = [o for o in live_offers if o["status"] == "pending"]
    pending_claims = [c for c in claims if c.get("status") == "pending"]
    status = gap["status"]
    if status == "filled":
        view = "filled"
    elif status == "waived":
        view = "cancelled"
    elif pending_claims:
        view = "claimed"
    else:
        view = "open"
    return {
        **{k: gap.get(k) for k in (
            "id", "department_id", "source", "absence_id", "original_assignment_id", "shift_id", "shift_name", "work_date",
            "start_time", "end_time", "starts_at", "ends_at", "required_role", "status", "claimable", "resolution",
            "resolution_reason", "filled_assignment_id", "filled_user_id", "notes", "version", "created_at", "resolved_at")},
        "open_shift_state": view,
        "pending_offer_count": len(pending_offers),
        "pending_claim_count": len(pending_claims),
        "offers": live_offers,
        "claims": [shape_claim(c, names) for c in claims],
        "absence": absence,
        "absent_user_id": absence.get("user_id") if absence else None,
        "absent_user_name": names.get(str(absence.get("user_id")), "") if absence else None,
        "absence_kind": absence.get("kind") if absence else None,
    }


def shape_absence(row: dict, names: dict[str, str]) -> dict:
    keep = ("id", "user_id", "assignment_id", "department_id", "work_date", "starts_at", "ends_at", "kind", "status",
            "leaving_at", "note", "withdraw_reason", "recorded_by", "confirmed_at", "version", "created_at")
    return {**{k: row.get(k) for k in keep}, "user_name": names.get(str(row["user_id"]), "")}


# ---------------------------------------------------------------------------
# Coverage impact (verified numbers only)
# ---------------------------------------------------------------------------

def room_impact(hotel_id: str, user_id: str, work_date: date, ends_at: Optional[datetime], now: datetime) -> dict:
    """
    What the absent employee still has on the floor, from room_assignments + room_status (the same effective status the
    housekeeping screens use). Anything that cannot be read is `verified: false` -- never a guessed count. Estimated
    minutes are the room-type base minutes and are only given when EVERY remaining room has one.
    """
    remaining_minutes = None
    try:
        assigned = (
            supabase.table("room_assignments")
            .select("room_id, clean_type, rooms(room_number, room_types(base_clean_minutes))")
            .eq("tenant_id", hotel_id).eq("assigned_to", user_id).eq("assignment_date", work_date.isoformat())
            .execute().data or []
        )
        room_ids = [a["room_id"] for a in assigned if a.get("room_id")]
        statuses = {}
        if room_ids:
            statuses = {
                r["room_id"]: r.get("status")
                for r in supabase.table("room_status").select("room_id, status").eq("tenant_id", hotel_id).in_("room_id", room_ids).execute().data or []
            }
    except Exception:
        logger.warning("coverage impact: workload read failed hotel_id=%s user_id=%s", hotel_id, user_id)
        return {"verified": False, "reason": "workload_unavailable", "as_of": None,
                "minutes_left_in_shift": _minutes_left(ends_at, now)}

    done = in_progress = 0
    remaining: list[dict] = []
    for a in assigned:
        status = effective_room_status(statuses.get(a.get("room_id")), a.get("clean_type"))
        if status in DONE_STATUSES:
            done += 1
            continue
        if status == "IN_PROGRESS":
            in_progress += 1
        remaining.append(a)
    minutes = [((a.get("rooms") or {}).get("room_types") or {}).get("base_clean_minutes") for a in remaining]
    if remaining and all(isinstance(m, (int, float)) for m in minutes):
        remaining_minutes = int(sum(minutes))
    elif not remaining:
        remaining_minutes = 0
    return {
        "verified": True, "reason": None, "as_of": now.isoformat(),
        "rooms_assigned": len(assigned), "rooms_done": done, "rooms_in_progress": in_progress,
        "rooms_remaining": len(remaining), "estimated_minutes_remaining": remaining_minutes,
        "minutes_left_in_shift": _minutes_left(ends_at, now),
    }


def _minutes_left(ends_at: Optional[datetime], now: datetime) -> Optional[int]:
    return max(0, int((ends_at - now).total_seconds() // 60)) if ends_at else None


def insert_row(table: str, row: dict) -> dict:
    return (supabase.table(table).insert(row).execute().data or [row])[0]


def is_unique_violation(exc: Exception) -> bool:
    return (getattr(exc, "code", None) or "") == "23505" or "23505" in str(exc)
