"""Read-only inspection history: a paginated list, the lineage + correction timeline of one inspection, the people who
inspected, and the quality insights for a period.

Nothing here writes. Every query is scoped to the caller's hotel; ids that come from a client are only ever used as
filters on that scope. All "day" arithmetic is done in the hotel's time zone by the caller (it passes the UTC window).

Metric definitions (the mobile screen repeats them in words; keep the two in step):

* **Completed inspections** - inspection records whose ``completed_at`` falls inside the hotel-local period.
* **Initial inspection** - a record with no ``reinspection_of``. **Reinspection** - a record whose ``reinspection_of``
  names an earlier inspection of the same hotel. Records written before migration 219 carry no link, so a re-check from
  that era counts as initial; ``without_lineage`` says how many records in the period predate lineage tracking.
* **First-pass rate** - initial ``passed`` / (initial ``passed`` + initial ``failed``). Reinspections are not in the
  denominator. A legacy ``conditional`` result is neither a pass nor a fail: it is left out of both sides and counted
  separately, never silently treated as passed.
* **Most common failed standards** - failed checklist answers grouped by the checklist item's id (never by label), counted
  once per inspection.
* **Correction outcomes** - for failed inspections in the period: a later passing inspection that names it (verified), a
  later failing one (failed again), or no linked reinspection recorded yet.
* **Time to verification** - failed inspection -> the passing reinspection that verified it. It is not the time the
  housekeeper took and not the time the task was closed. Shown only with at least ``MIN_DURATION_SAMPLE`` verified cases.
"""

import base64
import binascii
import logging
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Any, Iterable, Optional
from uuid import UUID

from services.reclean_corrections import (
    _correction_activity,
    correction_state,
    fetch_correction_task,
    profile_name,
)

logger = logging.getLogger(__name__)

LIST_DEFAULT_LIMIT = 50
LIST_MAX_LIMIT = 100
#: Callers that do not ask for a page (the room history and today's list) still get a hard ceiling.
LIST_LEGACY_LIMIT = 1000
MAX_RANGE_DAYS = 366
#: PostgREST returns at most this many rows per request, whatever the client asks for.
PAGE_ROWS = 1000
INSIGHT_ROW_LIMIT = 5000
CHUNK = 50
MAX_CHAIN = 25
MAX_TIMELINE_FAILURES = 10
MIN_DURATION_SAMPLE = 3
TOP_N = 5

INSPECTION_COLUMNS = "id, room_id, overall_result, notes, completed_at, inspected_by, reinspection_of, correction_kind, template_id"


class HistoryParamError(ValueError):
    """A client-supplied filter that cannot be honoured. The router turns it into a 4xx."""


# ── Cursor ──────────────────────────────────────────────────────────────────────

def encode_cursor(completed_at: str, inspection_id: str) -> str:
    return base64.urlsafe_b64encode(f"{completed_at}|{inspection_id}".encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[str, str]:
    """``(completed_at, id)`` or HistoryParamError. The pieces are re-validated: a cursor is client input."""
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        completed_at, inspection_id = raw.split("|", 1)
        datetime.fromisoformat(completed_at)
        UUID(inspection_id)
    except (binascii.Error, UnicodeDecodeError, ValueError):
        raise HistoryParamError("Invalid cursor") from None
    return completed_at, inspection_id


def validate_range(date_from: date, date_to: date) -> None:
    if date_from > date_to:
        raise HistoryParamError("date_from must not be after date_to")
    if (date_to - date_from).days + 1 > MAX_RANGE_DAYS:
        raise HistoryParamError(f"The date range may span at most {MAX_RANGE_DAYS} days")


def _chunks(values: list[str], size: int = CHUNK) -> Iterable[list[str]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _display_name(profile: dict) -> Optional[str]:
    return profile.get("preferred_name") or profile.get("full_name") or None


def _names(client: Any, hotel_id: str, user_ids: Iterable[Optional[str]]) -> dict[str, str]:
    ids = sorted({u for u in user_ids if u})
    names: dict[str, str] = {}
    for chunk in _chunks(ids, 100):
        rows = (
            client.table("user_profiles")
            .select("id, preferred_name, full_name")
            .in_("id", chunk)
            .eq("tenant_id", hotel_id)
            .execute()
        ).data or []
        for row in rows:
            name = _display_name(row)
            if name:
                names[row["id"]] = name
    return names


def _fetch_all(build, limit: int) -> tuple[list[dict], bool]:
    """Page through a query in PostgREST-sized steps. ``build()`` returns a fresh, ordered query each time.

    Returns ``(rows, truncated)``: truncated is true when more than ``limit`` rows exist, in which case exactly
    ``limit`` are returned.
    """
    rows: list[dict] = []
    start = 0
    while len(rows) <= limit:
        want = min(PAGE_ROWS, limit + 1 - len(rows))
        page = build().range(start, start + want - 1).execute().data or []
        rows.extend(page)
        if len(page) < want:
            break
        start += want
    return rows[:limit], len(rows) > limit


# ── History list ────────────────────────────────────────────────────────────────

def list_history(
    client: Any,
    hotel_id: str,
    *,
    start_iso: str,
    end_iso: str,
    result: Optional[str] = None,
    inspection_type: Optional[str] = None,
    inspector_id: Optional[str] = None,
    room_id: Optional[str] = None,
    room_ids: Optional[list[str]] = None,
    inspection_ids: Optional[list[str]] = None,
    limit: int = LIST_DEFAULT_LIMIT,
    cursor: Optional[str] = None,
) -> dict:
    """One page of completed inspections, newest first, ordered by ``(completed_at, id)`` so a page boundary is exact.

    ``room_ids`` / ``inspection_ids`` are already-resolved allow-lists (a room-number search, a failed-standard drill
    down): an empty list means nothing can match, which is answered without touching the table.
    """
    if (room_ids is not None and not room_ids) or (inspection_ids is not None and not inspection_ids):
        return {"rows": [], "has_more": False, "next_cursor": None, "total": 0 if cursor is None else None}

    table = client.table("inspections")
    # The exact count is asked for once, on the first page; later pages are cursor-bounded and would count the wrong set.
    query = table.select(INSPECTION_COLUMNS, count="exact") if cursor is None else table.select(INSPECTION_COLUMNS)
    query = query.eq("tenant_id", hotel_id).gte("completed_at", start_iso).lt("completed_at", end_iso)
    if result:
        query = query.eq("overall_result", result)
    if inspection_type == "initial":
        query = query.is_("reinspection_of", "null")
    elif inspection_type == "reinspection":
        query = query.not_.is_("reinspection_of", "null")
    if inspector_id:
        query = query.eq("inspected_by", inspector_id)
    if room_id:
        query = query.eq("room_id", room_id)
    if room_ids is not None:
        query = query.in_("room_id", room_ids)
    if inspection_ids is not None:
        query = query.in_("id", inspection_ids)
    if cursor:
        at, last_id = decode_cursor(cursor)
        query = query.or_(f"completed_at.lt.{at},and(completed_at.eq.{at},id.lt.{last_id})")
    page = query.order("completed_at", desc=True).order("id", desc=True).limit(limit + 1).execute()
    rows = page.data or []
    has_more = len(rows) > limit
    rows = rows[:limit]

    room_numbers = _room_map(client, hotel_id, [r["room_id"] for r in rows if r.get("room_id")])
    names = _names(client, hotel_id, [r.get("inspected_by") for r in rows])
    out = []
    for row in rows:
        room = room_numbers.get(row.get("room_id")) or {}
        inspector = row.get("inspected_by") or ""
        out.append(
            {
                "id": row["id"],
                "room_id": row.get("room_id"),
                "room_number": room.get("room_number", ""),
                "floor": room.get("floor"),
                "building": room.get("building"),
                "inspected_by": row.get("inspected_by"),
                # Legacy field: keeps its id-prefix fallback for older clients, which must never display it as a name.
                "inspector_name": names.get(inspector, inspector[:8] if inspector else "Unknown"),
                "inspector_display_name": names.get(inspector),
                "overall_result": row.get("overall_result"),
                "notes": row.get("notes"),
                "completed_at": row.get("completed_at"),
                "reinspection_of": row.get("reinspection_of"),
                "is_reinspection": row.get("reinspection_of") is not None,
                "correction_kind": row.get("correction_kind"),
                "template_id": row.get("template_id"),
            }
        )
    last = rows[-1] if rows else None
    return {
        "rows": out,
        "has_more": has_more,
        "next_cursor": encode_cursor(last["completed_at"], last["id"]) if has_more and last and last.get("completed_at") else None,
        "total": getattr(page, "count", None) if cursor is None else None,
    }


def _room_map(client: Any, hotel_id: str, room_ids: list[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for chunk in _chunks(sorted(set(room_ids)), 100):
        rows = (
            client.table("rooms")
            .select("id, room_number, floor, building")
            .eq("tenant_id", hotel_id)
            .in_("id", chunk)
            .execute()
        ).data or []
        found.update({r["id"]: r for r in rows})
    return found


def rooms_matching(client: Any, hotel_id: str, text: str, limit: int = 200) -> list[str]:
    """Room ids whose number contains ``text`` (a search label, never an identifier)."""
    needle = text.strip().replace("%", "").replace("_", "").replace(",", "").replace("(", "").replace(")", "")
    if not needle:
        return []
    rows = (
        client.table("rooms")
        .select("id")
        .eq("tenant_id", hotel_id)
        .ilike("room_number", f"%{needle}%")
        .limit(limit)
        .execute()
    ).data or []
    return [r["id"] for r in rows]


def inspections_failing_standard(client: Any, hotel_id: str, item_id: str, start_iso: str, end_iso: str, limit: int = 500) -> list[str]:
    """Ids of in-period inspections that recorded a failed answer for one checklist item (for drilling in from insights)."""
    results = (
        client.table("inspection_results")
        .select("inspection_id")
        .eq("tenant_id", hotel_id)
        .eq("template_item_id", item_id)
        .eq("result", "fail")
        .limit(limit)
        .execute()
    ).data or []
    ids = sorted({r["inspection_id"] for r in results if r.get("inspection_id")})
    if not ids:
        return []
    in_period: list[str] = []
    for chunk in _chunks(ids, 100):
        rows = (
            client.table("inspections")
            .select("id")
            .eq("tenant_id", hotel_id)
            .gte("completed_at", start_iso)
            .lt("completed_at", end_iso)
            .in_("id", chunk)
            .execute()
        ).data or []
        in_period.extend(r["id"] for r in rows)
    return in_period


def list_inspectors(client: Any, hotel_id: str, start_iso: str, end_iso: str) -> dict:
    """The people who completed inspections in the period, by stable id, for the history filter."""
    rows, truncated = _fetch_all(
        lambda: client.table("inspections")
        .select("inspected_by")
        .eq("tenant_id", hotel_id)
        .gte("completed_at", start_iso)
        .lt("completed_at", end_iso)
        .order("id"),
        INSIGHT_ROW_LIMIT,
    )
    counts = Counter(r["inspected_by"] for r in rows if r.get("inspected_by"))
    names = _names(client, hotel_id, counts.keys())
    inspectors = [{"id": uid, "name": names.get(uid), "count": count} for uid, count in counts.items()]
    inspectors.sort(key=lambda i: ((i["name"] or "~").lower(), i["id"]))
    return {"rows": inspectors, "truncated": truncated}


# ── Timeline & lineage ──────────────────────────────────────────────────────────

_EVENT_RANK = {
    "inspection_failed": 0,
    "correction_created": 1,
    "reassigned": 2,
    "escalated": 3,
    "work_started": 4,
    "work_submitted": 5,
    "task_completed": 6,
    "reinspection_failed": 7,
    "reinspection_passed": 7,
}


def _one_inspection(client: Any, hotel_id: str, inspection_id: str) -> Optional[dict]:
    res = (
        client.table("inspections")
        .select(INSPECTION_COLUMNS)
        .eq("tenant_id", hotel_id)
        .eq("id", inspection_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def _resubmission_between(client: Any, hotel_id: str, room_id: str, start: str, end: Optional[str]) -> Optional[dict]:
    """The housekeeper's own finished clean of the room after a failure and BEFORE the next inspection of it."""
    query = (
        client.table("room_clean_sessions")
        .select("housekeeper_id, ended_at")
        .eq("tenant_id", hotel_id)
        .eq("room_id", room_id)
        .eq("status", "completed")
        .gte("ended_at", start)
    )
    if end:
        query = query.lt("ended_at", end)
    sessions = query.order("ended_at", desc=True).limit(1).execute().data or []
    if not sessions or not sessions[0].get("ended_at"):
        return None
    return {
        "at": sessions[0]["ended_at"],
        "housekeeper_id": sessions[0].get("housekeeper_id"),
        "housekeeper_name": profile_name(client, hotel_id, sessions[0].get("housekeeper_id")),
    }


def load_timeline(client: Any, hotel_id: str, inspection_id: str) -> Optional[dict]:
    """The whole correction cycle this inspection belongs to: every linked inspection and every recorded event.

    The chain is rebuilt from the stored ``reinspection_of`` links (up to the original failure, then down through every
    reinspection), bounded in depth and cycle-safe. Events are only things the database timestamped; a step that left no
    trace (a task nobody started) is simply absent.
    """
    start = _one_inspection(client, hotel_id, inspection_id)
    if start is None:
        return None

    seen: dict[str, dict] = {start["id"]: start}
    truncated = False
    current = start
    while current.get("reinspection_of"):
        parent_id = current["reinspection_of"]
        if parent_id in seen:  # a cycle in the stored links: stop, never loop
            break
        if len(seen) >= MAX_CHAIN:
            truncated = True
            break
        parent = _one_inspection(client, hotel_id, parent_id)
        if parent is None:
            break
        seen[parent_id] = parent
        current = parent
    root_id = current["id"]

    frontier = [root_id]
    expanded: set[str] = set()
    while frontier:
        children = (
            client.table("inspections")
            .select(INSPECTION_COLUMNS)
            .eq("tenant_id", hotel_id)
            .in_("reinspection_of", frontier)
            .order("completed_at")
            .execute()
        ).data or []
        expanded.update(frontier)
        frontier = []
        for child in children:
            if child["id"] not in seen:
                if len(seen) >= MAX_CHAIN:
                    truncated = True
                    continue
                seen[child["id"]] = child
            # An inspection already reached from below (the one we started at) still has to be walked past.
            if child["id"] not in expanded and child["id"] not in frontier:
                frontier.append(child["id"])

    chain = sorted(seen.values(), key=lambda i: (str(i.get("completed_at") or ""), i["id"]))
    chain_ids = [i["id"] for i in chain]

    room_info = _room_map(client, hotel_id, [start["room_id"]]).get(start["room_id"]) or {}
    names = _names(client, hotel_id, [i.get("inspected_by") for i in chain])
    fails = _failed_answers(client, hotel_id, chain_ids)

    verified_by: dict[str, str] = {}
    repeated_by: dict[str, str] = {}
    for inspection in chain:
        parent = inspection.get("reinspection_of")
        if parent in seen:
            (verified_by if inspection.get("overall_result") == "passed" else repeated_by).setdefault(parent, inspection["id"])

    summaries = [
        {
            "id": i["id"],
            "overall_result": i.get("overall_result"),
            "completed_at": i.get("completed_at"),
            "inspected_by": i.get("inspected_by"),
            "inspector_name": names.get(i.get("inspected_by") or ""),
            "reinspection_of": i.get("reinspection_of") if i.get("reinspection_of") in seen else None,
            "is_reinspection": i.get("reinspection_of") is not None,
            "correction_kind": i.get("correction_kind"),
            "failed_items": fails.get(i["id"], []),
            "verified_by": verified_by.get(i["id"]),
            "repeated_by": repeated_by.get(i["id"]),
        }
        for i in chain
    ]

    events: list[dict] = []
    failures = [i for i in chain if i.get("overall_result") in ("failed", "conditional")]
    if len(failures) > MAX_TIMELINE_FAILURES:
        truncated = True
    for failure in failures[:MAX_TIMELINE_FAILURES]:
        task = fetch_correction_task(client, hotel_id, failure["id"])
        if failure.get("overall_result") == "conditional" and not (failure.get("correction_kind") or task):
            continue  # a historical conditional never owned a correction: nothing to narrate beyond the inspection
        _, _, followups = correction_state(client, hotel_id, failure, task)
        next_inspection = next((i for i in chain if str(i.get("completed_at") or "") > str(failure.get("completed_at") or "")), None)
        resubmission = _resubmission_between(client, hotel_id, failure["room_id"], failure.get("completed_at") or "", next_inspection.get("completed_at") if next_inspection else None)
        for event in _correction_activity(client, hotel_id, failure, task, resubmission, followups):
            # A reinspection's own failure is already narrated by the previous failure's "reinspection_failed".
            if event["type"] == "inspection_failed" and failure.get("reinspection_of") in seen:
                continue
            events.append(event)
    # A historical conditional or a passing first inspection still deserves its one line.
    for inspection in chain:
        if inspection["id"] not in {f["id"] for f in failures} and not inspection.get("reinspection_of") and inspection.get("overall_result") == "passed":
            events.append({"type": "inspection_passed", "at": inspection.get("completed_at"), "actor_name": names.get(inspection.get("inspected_by") or ""), "inspection_id": inspection["id"]})

    unique: dict[tuple, dict] = {}
    for event in events:
        if not event.get("at"):
            continue
        unique.setdefault((event["type"], event["at"], event.get("inspection_id")), event)
    ordered = sorted(unique.values(), key=lambda e: (str(e["at"]), _EVENT_RANK.get(e["type"], 9)))
    for event in ordered:
        event["key"] = f'{event["type"]}:{event.get("inspection_id")}:{event["at"]}'

    return {
        "inspection_id": inspection_id,
        "room_id": start["room_id"],
        "room_number": room_info.get("room_number"),
        "inspections": summaries,
        "events": ordered,
        "truncated": truncated,
    }


def _failed_answers(client: Any, hotel_id: str, inspection_ids: list[str]) -> dict[str, list[dict]]:
    """``{inspection_id: [failed answers]}`` with the wording that was recorded for each."""
    rows: list[dict] = []
    for chunk in _chunks(inspection_ids, CHUNK):
        rows.extend(
            (
                client.table("inspection_results")
                .select("inspection_id, template_item_id, note, severity")
                .eq("tenant_id", hotel_id)
                .eq("result", "fail")
                .in_("inspection_id", chunk)
                .execute()
            ).data
            or []
        )
    items = _item_labels(client, hotel_id, {r["template_item_id"] for r in rows if r.get("template_item_id")})
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        item = items.get(row.get("template_item_id")) or {}
        grouped[row["inspection_id"]].append(
            {
                "template_item_id": row.get("template_item_id"),
                "section": item.get("section"),
                "description": item.get("description"),
                "note": row.get("note"),
                "severity": row.get("severity"),
            }
        )
    return grouped


def _item_labels(client: Any, hotel_id: str, item_ids: Iterable[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for chunk in _chunks(sorted(item_ids), 100):
        for row in (
            client.table("inspection_template_items")
            .select("id, section, description")
            .eq("tenant_id", hotel_id)
            .in_("id", chunk)
            .execute()
        ).data or []:
            found[row["id"]] = row
    return found


# ── Insights ────────────────────────────────────────────────────────────────────

def _local_day(value: Optional[str], zone: Any) -> Optional[date]:
    parsed = _iso(value)
    return parsed.astimezone(zone).date() if parsed else None


def _share(part: int, whole: int) -> Optional[float]:
    return round(part / whole, 4) if whole > 0 else None


def build_insights(
    *,
    inspections: list[dict],
    failed_answers: list[dict],
    labels: dict[str, dict],
    followups: list[dict],
    room_numbers: dict[str, str],
    zone: Any,
    date_from: date,
    date_to: date,
    truncated: bool,
) -> dict:
    """Pure aggregation over already-fetched, already-tenant-scoped rows (see the module docstring for definitions)."""
    total = len(inspections)
    by_result = Counter(i.get("overall_result") for i in inspections)
    initial = [i for i in inspections if not i.get("reinspection_of")]
    reinspections = total - len(initial)
    eligible = [i for i in initial if i.get("overall_result") in ("passed", "failed")]
    first_pass_passed = sum(1 for i in eligible if i.get("overall_result") == "passed")
    # A cut-off list gives a partial denominator, so no rate is offered for it.
    first_pass_rate = None if truncated else _share(first_pass_passed, len(eligible))

    days: dict[date, dict] = {}
    cursor_day = date_from
    while cursor_day <= date_to:
        days[cursor_day] = {"date": cursor_day.isoformat(), "initial_passed": 0, "initial_failed": 0, "completed": 0}
        cursor_day += timedelta(days=1)
    for inspection in inspections:
        day = days.get(_local_day(inspection.get("completed_at"), zone))
        if day is None:
            continue
        day["completed"] += 1
        if not inspection.get("reinspection_of"):
            if inspection.get("overall_result") == "passed":
                day["initial_passed"] += 1
            elif inspection.get("overall_result") == "failed":
                day["initial_failed"] += 1
    daily = []
    for day in days.values():
        denominator = day["initial_passed"] + day["initial_failed"]
        # No initial inspections that day means there is no rate - not a rate of zero.
        daily.append({**day, "first_pass_rate": None if truncated else _share(day["initial_passed"], denominator)})

    # Failed standards, counted once per inspection and keyed by the checklist item's id.
    per_item: dict[str, set[str]] = defaultdict(set)
    unidentified = 0
    for answer in failed_answers:
        item_id = answer.get("template_item_id")
        if item_id:
            per_item[item_id].add(answer["inspection_id"])
        else:
            unidentified += 1
    top_standards = [
        {
            "standard_id": item_id,
            "label": (labels.get(item_id) or {}).get("description"),
            "section": (labels.get(item_id) or {}).get("section"),
            "count": len(ids),
        }
        for item_id, ids in sorted(per_item.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:TOP_N]
    ]

    inspection_room = {i["id"]: i.get("room_id") for i in inspections}
    failed = [i for i in inspections if i.get("overall_result") == "failed"]
    failed_by_room: dict[str, list[dict]] = defaultdict(list)
    for inspection in failed:
        if inspection.get("room_id"):
            failed_by_room[inspection["room_id"]].append(inspection)
    repeat_rooms = [
        {
            "room_id": room_id,
            "room_number": room_numbers.get(room_id),
            "failed_count": len(rows),
            "inspection_ids": [r["id"] for r in sorted(rows, key=lambda r: str(r.get("completed_at")), reverse=True)[:5]],
        }
        for room_id, rows in failed_by_room.items()
        if len(rows) >= 2
    ]
    repeat_rooms.sort(key=lambda r: (-r["failed_count"], str(r["room_number"]), r["room_id"]))

    room_item: dict[tuple[str, str], set[str]] = defaultdict(set)
    for answer in failed_answers:
        room_id = inspection_room.get(answer["inspection_id"])
        if room_id and answer.get("template_item_id"):
            room_item[(room_id, answer["template_item_id"])].add(answer["inspection_id"])
    repeat_standards = [
        {
            "room_id": room_id,
            "room_number": room_numbers.get(room_id),
            "standard_id": item_id,
            "label": (labels.get(item_id) or {}).get("description"),
            "section": (labels.get(item_id) or {}).get("section"),
            "count": len(ids),
        }
        for (room_id, item_id), ids in room_item.items()
        if len(ids) >= 2
    ]
    repeat_standards.sort(key=lambda r: (-r["count"], str(r["room_number"]), r["standard_id"]))

    children: dict[str, list[dict]] = defaultdict(list)
    for follow in followups:
        if follow.get("reinspection_of"):
            children[follow["reinspection_of"]].append(follow)
    verified = failed_again = pending = 0
    verification_minutes: list[float] = []
    for failure in failed:
        linked = sorted(children.get(failure["id"], []), key=lambda f: str(f.get("completed_at")))
        passing = next((f for f in linked if f.get("overall_result") == "passed"), None)
        if passing:
            verified += 1
            began, ended = _iso(failure.get("completed_at")), _iso(passing.get("completed_at"))
            if began and ended and ended > began:
                verification_minutes.append((ended - began).total_seconds() / 60)
        elif any(f.get("overall_result") == "failed" for f in linked):
            failed_again += 1
        else:
            pending += 1
    enough = len(verification_minutes) >= MIN_DURATION_SAMPLE

    return {
        "period": {"date_from": date_from.isoformat(), "date_to": date_to.isoformat()},
        "counts": {
            "completed": total,
            "passed": by_result.get("passed", 0),
            "failed": by_result.get("failed", 0),
            "conditional": by_result.get("conditional", 0),
            "initial": len(initial),
            "reinspections": reinspections,
            # Records written before lineage tracking: their re-checks can only be counted as initial inspections.
            "without_lineage": sum(1 for i in inspections if not i.get("template_fingerprint")),
        },
        "first_pass": {
            "rate": first_pass_rate,
            "passed": first_pass_passed,
            "eligible": len(eligible),
            "conditional_excluded": sum(1 for i in initial if i.get("overall_result") == "conditional"),
        },
        "daily": daily,
        "top_standards": top_standards,
        "failed_answers_unidentified": unidentified,
        "repeat_rooms": repeat_rooms[:TOP_N],
        "repeat_standards": repeat_standards[:TOP_N],
        "corrections": {
            "failed": len(failed),
            "verified": verified,
            "failed_again": failed_again,
            "no_reinspection_recorded": pending,
        },
        "time_to_verification": {
            "available": enough,
            "median_minutes": round(median(verification_minutes), 1) if enough else None,
            "sample": len(verification_minutes),
            "minimum_sample": MIN_DURATION_SAMPLE,
        },
        "truncated": truncated,
    }


def load_insights(client: Any, hotel_id: str, *, start_iso: str, end_iso: str, zone: Any, date_from: date, date_to: date) -> dict:
    inspections, truncated = _fetch_all(
        lambda: client.table("inspections")
        .select(INSPECTION_COLUMNS + ", template_fingerprint")
        .eq("tenant_id", hotel_id)
        .gte("completed_at", start_iso)
        .lt("completed_at", end_iso)
        .order("completed_at", desc=True)
        .order("id", desc=True),
        INSIGHT_ROW_LIMIT,
    )
    failing_ids = [i["id"] for i in inspections if i.get("overall_result") in ("failed", "conditional")]
    failed_answers: list[dict] = []
    followups: list[dict] = []
    for chunk in _chunks(failing_ids, CHUNK):
        failed_answers.extend(
            (
                client.table("inspection_results")
                .select("inspection_id, template_item_id")
                .eq("tenant_id", hotel_id)
                .eq("result", "fail")
                .in_("inspection_id", chunk)
                .execute()
            ).data
            or []
        )
        followups.extend(
            (
                client.table("inspections")
                .select("id, reinspection_of, overall_result, completed_at")
                .eq("tenant_id", hotel_id)
                .in_("reinspection_of", chunk)
                .execute()
            ).data
            or []
        )
    labels = _item_labels(client, hotel_id, {a["template_item_id"] for a in failed_answers if a.get("template_item_id")})
    repeat_room_ids = [i["room_id"] for i in inspections if i.get("room_id") and i.get("overall_result") == "failed"]
    rooms = _room_map(client, hotel_id, repeat_room_ids)
    return build_insights(
        inspections=inspections,
        failed_answers=failed_answers,
        labels=labels,
        followups=followups,
        room_numbers={rid: r.get("room_number") for rid, r in rooms.items()},
        zone=zone,
        date_from=date_from,
        date_to=date_to,
        truncated=truncated,
    )
