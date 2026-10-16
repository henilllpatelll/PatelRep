"""AI end-of-shift recap for housekeepers.

The model never sees raw room lists and never decides what was finished. The
server first builds a structured, deterministic aggregate of the shift from the
authoritative tables (``compute_shift_facts``): rooms the person was assigned,
the status each of those rooms actually holds now, and the clean sessions the
person really completed inside their shift window. Only that aggregate (counts,
room numbers and recorded minutes, no guest data) goes into the prompt, and the
generated text is rejected unless every number in it appears in the aggregate.

Terms the aggregate keeps apart, because they are different facts:
  assigned     put on this person's list for the date
  submitted    room status CLEAN: the attendant finished, inspection pending
  inspected    room status INSPECTED: a supervisor passed it
  unavailable  OOO / out of order / out of service, cannot be worked
  completed_by_you  distinct rooms with a completed clean session recorded by
                    this person inside the shift window
Assigned is never completed, and estimated clean time is never actual time.

The mobile client shows the aggregate as the verified part of the recap and the
model's wording as a separate, labelled part, and works without this service.
Failures must surface as exceptions for the router to map (never half-empty
payloads).
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Any, Iterable

from services.ai.providers import get_anthropic_client

UNAVAILABLE_STATUSES = frozenset({"OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"})
SUBMITTED_STATUS = "CLEAN"
INSPECTED_STATUS = "INSPECTED"
IN_PROGRESS_STATUS = "IN_PROGRESS"

# A recorded duration is only trusted when it is plausible for one room and
# agrees with the session's own start/end timestamps.
MAX_ROOM_SECONDS = 4 * 60 * 60
DURATION_TOLERANCE_SECONDS = 120
MAX_LISTED_ROOMS = 12


class InsufficientEvidence(Exception):
    """There is no recorded completed work to write a recap about."""


class UngroundedRecap(Exception):
    """The model's text states something the aggregate does not support."""


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _room_sort_key(number: str) -> tuple:
    return tuple(int(part) if part.isdigit() else part for part in re.split(r"(\d+)", number) if part)


def _sorted_numbers(numbers: Iterable[str]) -> list[str]:
    return sorted({n for n in numbers if n}, key=_room_sort_key)


def resolve_window(
    shift: dict | None,
    shift_date: date,
    tz: tzinfo,
    now: datetime,
) -> dict:
    """The span of time the recap covers, in UTC.

    A recorded shift wins, and may run past midnight: it is simply
    ``started_at .. ended_at`` (or now while it is still open). With no shift
    record the hotel-local calendar day is used, and the basis says so.
    """
    started = _parse_ts((shift or {}).get("started_at"))
    if started is not None:
        ended = _parse_ts(shift.get("ended_at"))
        return {
            "start": started,
            "end": ended or now,
            "basis": "shift",
            "shift_ended": ended is not None,
        }
    local_start = datetime.combine(shift_date, time.min, tzinfo=tz)
    local_end = local_start + timedelta(days=1)
    return {
        "start": local_start.astimezone(timezone.utc),
        "end": local_end.astimezone(timezone.utc),
        "basis": "day",
        "shift_ended": False,
    }


def _trusted_minutes(session: dict) -> int | None:
    """Recorded seconds for one completed room, or None when they cannot be trusted."""
    seconds = session.get("duration_seconds")
    if not isinstance(seconds, (int, float)) or seconds <= 0 or seconds > MAX_ROOM_SECONDS:
        return None
    started = _parse_ts(session.get("started_at"))
    ended = _parse_ts(session.get("ended_at"))
    if started is None or ended is None:
        return None
    elapsed = (ended - started).total_seconds()
    if abs(elapsed - seconds) > DURATION_TOLERANCE_SECONDS:
        return None
    return int(seconds)


def compute_shift_facts(
    *,
    assignments: list[dict],
    room_status_by_id: dict[str, dict],
    room_number_by_id: dict[str, str],
    sessions: list[dict],
    shift: dict | None,
    open_work_order_room_ids: Iterable[str],
    shift_date: date,
    tz: tzinfo,
    now: datetime,
    user_id: str,
) -> dict:
    """The deterministic aggregate the recap is written from. Pure: no I/O."""
    window = resolve_window(shift, shift_date, tz, now)
    start, end = window["start"], window["end"]
    open_wo = set(open_work_order_room_ids)

    assigned_ids = {a["room_id"] for a in assignments if a.get("room_id")}

    inspected: set[str] = set()
    submitted: set[str] = set()
    unavailable: set[str] = set()
    in_progress: set[str] = set()
    restricted: set[str] = set()
    not_started: set[str] = set()
    status_unknown: set[str] = set()
    for room_id in assigned_ids:
        row = room_status_by_id.get(room_id)
        if row is None:
            status_unknown.add(room_id)
            continue
        status = str(row.get("status") or "").upper()
        if status in UNAVAILABLE_STATUSES:
            unavailable.add(room_id)
        elif status == INSPECTED_STATUS:
            inspected.add(room_id)
        elif status == SUBMITTED_STATUS:
            submitted.add(room_id)
        elif status == IN_PROGRESS_STATUS:
            in_progress.add(room_id)
        else:
            not_started.add(room_id)
            if row.get("dnd_flag") or row.get("do_not_service"):
                restricted.add(room_id)

    completed_rooms: set[str] = set()
    abandoned_rooms: set[str] = set()
    blocked_stop_rooms: set[str] = set()
    timed_rooms = 0
    recorded_seconds = 0
    for session in sessions:
        if session.get("housekeeper_id") != user_id:
            continue
        room_id = session.get("room_id")
        if not room_id:
            continue
        ended = _parse_ts(session.get("ended_at"))
        if ended is None or not (start <= ended <= end):
            continue
        status = session.get("status")
        if status == "completed":
            if room_id not in completed_rooms:
                trusted = _trusted_minutes(session)
                if trusted is not None:
                    timed_rooms += 1
                    recorded_seconds += trusted
            completed_rooms.add(room_id)
        elif status == "abandoned":
            abandoned_rooms.add(room_id)
            if session.get("blocked_reason"):
                blocked_stop_rooms.add(room_id)

    # A room cleaned again later in the window is not "abandoned".
    abandoned_rooms -= completed_rooms
    blocked_stop_rooms -= completed_rooms

    completed_not_on_list = completed_rooms - assigned_ids
    finished = inspected | submitted
    unfinished = (not_started | in_progress) | (abandoned_rooms & assigned_ids)

    def numbers(room_ids: Iterable[str]) -> list[str]:
        return _sorted_numbers(room_number_by_id.get(r, "") for r in room_ids)

    open_wo_rooms = open_wo & assigned_ids
    facts = {
        "shift_date": shift_date.isoformat(),
        "window": {
            "start": start.isoformat(),
            "end": end.isoformat() if window["shift_ended"] else None,
            "basis": window["basis"],
            "shift_ended": window["shift_ended"],
        },
        "rooms": {
            "assigned": len(assigned_ids),
            "unavailable": len(unavailable),
            "submitted": len(submitted),
            "inspected": len(inspected),
            "completed": len(finished),
            "in_progress": len(in_progress),
            "not_started": len(not_started),
            "unfinished": len(unfinished),
            "restricted": len(restricted),
            "status_unknown": len(status_unknown),
        },
        "sessions": {
            "completed_by_you": len(completed_rooms),
            "completed_off_list": len(completed_not_on_list),
            "stopped": len(abandoned_rooms),
            "stopped_blocked": len(blocked_stop_rooms),
        },
        "timing": {
            "timed_rooms": timed_rooms,
            "recorded_minutes": round(recorded_seconds / 60) if timed_rooms else None,
        },
        "handoffs": {
            "unfinished": numbers(unfinished)[:MAX_LISTED_ROOMS],
            "restricted": numbers(restricted)[:MAX_LISTED_ROOMS],
            "open_work_orders": numbers(open_wo_rooms)[:MAX_LISTED_ROOMS],
        },
    }
    facts["evidence"] = "sufficient" if (finished or completed_rooms) else "none"
    digest_source = json.dumps(facts, sort_keys=True, separators=(",", ":"))
    facts["fingerprint"] = hashlib.sha256(digest_source.encode()).hexdigest()[:16]
    return facts


# ---------------------------------------------------------------------------
# Loading the authoritative rows
# ---------------------------------------------------------------------------

def _tz_for(db, hotel_id: str) -> tzinfo:
    from dateutil import tz as dtz

    name = "America/Chicago"
    try:
        result = db.table("tenants").select("timezone").eq("id", hotel_id).maybe_single().execute()
        name = ((result.data if result else None) or {}).get("timezone") or name
    except Exception:
        pass
    return dtz.gettz(name) or dtz.gettz("America/Chicago") or timezone.utc


def _shift_for_date(db, hotel_id: str, user_id: str, shift_date: date, tz: tzinfo) -> dict | None:
    """The person's shift that began on the hotel-local ``shift_date`` (latest wins)."""
    day_start = datetime.combine(shift_date, time.min, tzinfo=tz)
    lo = (day_start - timedelta(hours=12)).astimezone(timezone.utc).isoformat()
    hi = (day_start + timedelta(days=1, hours=12)).astimezone(timezone.utc).isoformat()
    result = (
        db.table("hk_shift_sessions")
        .select("id, started_at, ended_at, status, break_seconds")
        .eq("tenant_id", hotel_id)
        .eq("user_id", user_id)
        .gte("started_at", lo)
        .lte("started_at", hi)
        .order("started_at", desc=True)
        .execute()
    )
    for row in result.data or []:
        started = _parse_ts(row.get("started_at"))
        if started is not None and started.astimezone(tz).date() == shift_date:
            return row
    return None


def load_shift_facts(
    db,
    *,
    hotel_id: str,
    user_id: str,
    shift_date: date | None,
    now: datetime | None = None,
) -> dict:
    """Read the authoritative rows for one person and build the aggregate."""
    now = now or datetime.now(timezone.utc)
    tz = _tz_for(db, hotel_id)
    shift_date = shift_date or now.astimezone(tz).date()
    shift = _shift_for_date(db, hotel_id, user_id, shift_date, tz)

    assignments = (
        db.table("room_assignments")
        .select("id, room_id, assignment_date")
        .eq("tenant_id", hotel_id)
        .eq("assigned_to", user_id)
        .eq("assignment_date", shift_date.isoformat())
        .execute()
    ).data or []
    assigned_ids = [a["room_id"] for a in assignments if a.get("room_id")]

    window = resolve_window(shift, shift_date, tz, now)
    sessions = (
        db.table("room_clean_sessions")
        .select("room_id, housekeeper_id, status, blocked_reason, started_at, ended_at, duration_seconds")
        .eq("tenant_id", hotel_id)
        .eq("housekeeper_id", user_id)
        .gte("ended_at", window["start"].isoformat())
        .lte("ended_at", window["end"].isoformat())
        .execute()
    ).data or []

    room_ids = sorted(set(assigned_ids) | {s["room_id"] for s in sessions if s.get("room_id")})
    status_rows: list[dict] = []
    room_rows: list[dict] = []
    open_wo_rooms: list[str] = []
    if room_ids:
        status_rows = (
            db.table("room_status")
            .select("room_id, status, dnd_flag, do_not_service")
            .eq("tenant_id", hotel_id)
            .in_("room_id", room_ids)
            .execute()
        ).data or []
        room_rows = (
            db.table("rooms")
            .select("id, room_number")
            .eq("tenant_id", hotel_id)
            .in_("id", room_ids)
            .execute()
        ).data or []
        open_wo_rooms = [
            w["room_id"]
            for w in (
                db.table("work_orders")
                .select("room_id")
                .eq("tenant_id", hotel_id)
                .in_("room_id", room_ids)
                .in_("status", ["open", "in_progress", "on_hold"])
                .execute()
            ).data or []
            if w.get("room_id")
        ]

    return compute_shift_facts(
        assignments=assignments,
        room_status_by_id={r["room_id"]: r for r in status_rows if r.get("room_id")},
        room_number_by_id={r["id"]: str(r.get("room_number") or "") for r in room_rows},
        sessions=sessions,
        shift=shift,
        open_work_order_room_ids=open_wo_rooms,
        shift_date=shift_date,
        tz=tz,
        now=now,
        user_id=user_id,
    )


# ---------------------------------------------------------------------------
# The model call
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """You write the wording of an end-of-shift recap for ONE hotel housekeeper.
You receive a JSON object of verified facts about their shift. It is the ONLY source of truth.

Rules:
- State only what the facts say. Never assume a room was finished because it was assigned.
- "submitted" means the attendant finished and the room awaits inspection; "inspected" means a
  supervisor passed it. Say "submitted for inspection", never "perfectly clean" or "approved" unless inspected.
- rooms.unfinished, rooms.restricted and handoffs lists are things still open. Mention them neutrally.
- timing.recorded_minutes is time actually recorded on {timed_rooms} rooms. Do not call it total shift
  time, do not compare it with any target, estimate or other person, and do not say time was saved.
- No productivity judgement, ranking, praise of speed, or promise about tomorrow.
- Every number you write must appear in the facts. If evidence is thin, say less.

Respond in {language_name}. Return ONLY a JSON object (no markdown):
{{"headline": "one factual sentence, max 25 words", "note": "0-1 short sentence about open handoff items, or empty string"}}"""

_BANNED = re.compile(
    r"\b(faster|slower|fastest|productiv\w*|efficien\w*|saved|saving|ahead of|behind|best|top performer|"
    r"more rapido|más rápido|productiv\w*|ahorr\w*)\b",
    re.IGNORECASE,
)


def _allowed_numbers(facts: dict) -> set[int]:
    allowed: set[int] = {0, 1}

    def walk(value: Any) -> None:
        if isinstance(value, bool):
            return
        if isinstance(value, int):
            allowed.add(value)
        elif isinstance(value, str):
            for token in re.findall(r"\d+", value):
                allowed.add(int(token))
        elif isinstance(value, dict):
            for key, inner in value.items():
                if key in ("fingerprint", "start", "end", "shift_date"):
                    continue
                walk(inner)
        elif isinstance(value, list):
            for inner in value:
                walk(inner)

    walk(facts)
    return allowed


def validate_grounded(recap: dict, facts: dict) -> dict:
    """Reject text whose numbers are not in the facts, or that judges performance."""
    text = f"{recap.get('headline', '')} {recap.get('note', '')}"
    if not str(recap.get("headline", "")).strip():
        raise UngroundedRecap("empty headline")
    if _BANNED.search(text):
        raise UngroundedRecap("performance judgement")
    allowed = _allowed_numbers(facts)
    for token in re.findall(r"\d+", text):
        if int(token) not in allowed:
            raise UngroundedRecap(f"number {token} is not in the verified facts")
    return recap


def generate_shift_recap(facts: dict, language: str = "en") -> dict:
    """Returns {"recap": {...}, "prompt_tokens": int, "completion_tokens": int}.

    Raises InsufficientEvidence before any model call when nothing was completed.
    """
    if facts.get("evidence") != "sufficient":
        raise InsufficientEvidence("no completed work is recorded for this shift")

    claude = get_anthropic_client()
    language_name = "Spanish" if language == "es" else "English"
    prompt_facts = {k: v for k, v in facts.items() if k not in ("fingerprint",)}

    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        system=_SYSTEM_PROMPT.format(
            language_name=language_name,
            timed_rooms=facts.get("timing", {}).get("timed_rooms", 0),
        ),
        messages=[{"role": "user", "content": "Verified shift facts:\n" + json.dumps(prompt_facts, sort_keys=True)}],
    )

    usage = response.usage
    content = response.content[0].text.strip()
    recap = json.loads(content)
    if not isinstance(recap, dict):
        raise ValueError("recap must be a JSON object")
    cleaned = {"headline": str(recap.get("headline", "")).strip(), "note": str(recap.get("note", "")).strip()}
    validate_grounded(cleaned, facts)

    return {
        "recap": cleaned,
        "prompt_tokens": usage.input_tokens,
        "completion_tokens": usage.output_tokens,
    }
