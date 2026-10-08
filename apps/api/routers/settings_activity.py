"""
Settings > Activity & Audit: a READ-ONLY, GM-only view over the existing append-only
``operational_audit_events`` table.

Safety properties (each is covered by tests/test_settings_activity.py):
* The hotel always comes from the authenticated user, never from a request parameter.
* Only actions listed in services/audit_catalog.ACTIONS are returned; every other operational event
  (room status, work-order transitions, discrepancies, ...) is invisible here.
* State is passed through the catalog's per-resource allowlist on read, so historic rows can never leak
  extra keys. Nothing is reconstructed from current data; missing information is reported as missing.
* Not-found, cross-hotel and not-allowlisted events are indistinguishable (one 404).
* Lists are keyset-paginated (created_at, id), bounded by a date range, and capped in size.
* No write, replay, undo or delete endpoint exists.
"""
from __future__ import annotations

import base64
import csv
import io
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from core.database import supabase
from middleware.auth import CurrentUser, require_role
from services.audit_catalog import (
    ACTIONS, CATEGORIES, CATEGORY_ACTIONS, DETAIL_ACTION_PREFIX, RESOURCE_TYPES,
    action_category, action_title, build_changes, resource_name, role_label,
)
from services.reporting.exports import csv_safe

router = APIRouter(prefix="/settings/activity", tags=["settings-activity"])

COLUMNS = "id, action, resource_type, resource_id, actor_id, actor_role, old_state, new_state, source, created_at"
DEFAULT_DAYS = 30
MAX_LIST_DAYS = 366
MAX_EXPORT_DAYS = 92
DEFAULT_LIMIT = 25
MAX_LIMIT = 50
MAX_EXPORT_ROWS = 5000
EXPORT_PAGE = 500
MAX_Q = 100


@dataclass
class Filters:
    start: str  # inclusive, UTC ISO
    end: str  # exclusive, UTC ISO
    actions: list[str]
    resource_type: Optional[str] = None
    actor_id: Optional[str] = None
    or_expr: Optional[str] = None
    empty: bool = False  # a search that can match nothing


# ─── Input handling ───────────────────────────────────────────────────────────

def _uuid_or_none(value: str | None) -> str | None:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def _hotel_zone(hotel_id: str) -> ZoneInfo:
    try:
        res = supabase.table("tenants").select("timezone").eq("id", hotel_id).maybe_single().execute()
        name = (res.data or {}).get("timezone") if res else None
        return ZoneInfo(name) if name else ZoneInfo("UTC")
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return ZoneInfo("UTC")
    except Exception:  # noqa: BLE001 - display zone must never fail the request
        return ZoneInfo("UTC")


def _day(value: str | None, label: str) -> date | None:
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{label} must be a date in YYYY-MM-DD format.")


def _range(date_from: str | None, date_to: str | None, zone: ZoneInfo, max_days: int) -> tuple[str, str, date, date]:
    today = datetime.now(zone).date()
    end_day = _day(date_to, "End date") or today
    start_day = _day(date_from, "Start date") or (end_day - timedelta(days=DEFAULT_DAYS - 1))
    if start_day > end_day:
        raise HTTPException(status_code=422, detail="The start date must be on or before the end date.")
    if (end_day - start_day).days + 1 > max_days:
        raise HTTPException(status_code=422, detail=f"Choose a date range of at most {max_days} days.")
    start = datetime.combine(start_day, time.min, tzinfo=zone).astimezone(timezone.utc)
    end = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc)
    return start.isoformat(), end.isoformat(), start_day, end_day


def _encode_cursor(created_at: str, event_id: str) -> str:
    return base64.urlsafe_b64encode(json.dumps({"t": created_at, "i": event_id}).encode()).decode()


def _decode_cursor(cursor: str | None) -> tuple[str, str] | None:
    if not cursor:
        return None
    try:
        raw = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        created_at, event_id = str(raw["t"]), _uuid_or_none(raw["i"])
        datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if not event_id:
            raise ValueError
        return created_at, event_id
    except Exception:  # noqa: BLE001 - any malformed cursor is just a client error
        raise HTTPException(status_code=400, detail="Invalid page cursor.")


def _build_filters(
    current_user: CurrentUser, *, zone: ZoneInfo, date_from: str | None, date_to: str | None, max_days: int,
    category: str | None, resource_type: str | None, actor_id: str | None, q: str | None,
) -> tuple[Filters, date, date]:
    start, end, start_day, end_day = _range(date_from, date_to, zone, max_days)
    if category:
        if category not in CATEGORIES:
            raise HTTPException(status_code=422, detail="Unknown category.")
        actions = list(CATEGORY_ACTIONS[category])
    else:
        actions = list(ACTIONS)
    if resource_type and resource_type not in RESOURCE_TYPES:
        raise HTTPException(status_code=422, detail="Unknown resource type.")
    actor = None
    if actor_id:
        actor = _uuid_or_none(actor_id)
        if not actor:
            raise HTTPException(status_code=422, detail="Invalid actor.")
    filters = Filters(start=start, end=end, actions=actions, resource_type=resource_type, actor_id=actor)
    if q and q.strip():
        _apply_search(filters, q.strip()[:MAX_Q])
    return filters, start_day, end_day


def _apply_search(filters: Filters, q: str) -> None:
    """Search only safe fields: action/category titles, the actor's display name, and an exact event/resource id."""
    needle = q.lower()
    pieces: list[str] = []
    matched = [
        a for a in filters.actions
        if needle in ACTIONS[a][0].lower() or needle in CATEGORIES[ACTIONS[a][1]].lower()
    ]
    if matched:
        pieces.append(f"action.in.({','.join(matched)})")
    exact = _uuid_or_none(q)
    if exact:
        pieces += [f"id.eq.{exact}", f"resource_id.eq.{exact}"]
    safe = re.sub(r"[^\w\s.'\-]", " ", q).strip()
    if safe:
        # Names live in user_profiles; ids found here are only used to narrow THIS hotel's events.
        found = supabase.table("user_profiles").select("id").or_(
            f"full_name.ilike.%{safe}%,preferred_name.ilike.%{safe}%"
        ).limit(50).execute().data or []
        ids = [i for i in (_uuid_or_none(r.get("id")) for r in found) if i]
        if ids:
            pieces.append(f"actor_id.in.({','.join(ids)})")
    if pieces:
        filters.or_expr = ",".join(pieces)
    else:
        filters.empty = True


# ─── Querying ─────────────────────────────────────────────────────────────────

def _query(current_user: CurrentUser, f: Filters):
    q = (
        supabase.table("operational_audit_events").select(COLUMNS)
        .eq("tenant_id", current_user.hotel_id)
        .in_("action", f.actions)
        .gte("created_at", f.start)
        .lt("created_at", f.end)
    )
    if f.resource_type:
        q = q.eq("resource_type", f.resource_type)
    if f.actor_id:
        q = q.eq("actor_id", f.actor_id)
    if f.or_expr:
        q = q.or_(f.or_expr)
    return q


def _fetch_page(current_user: CurrentUser, f: Filters, cursor: tuple[str, str] | None, limit: int) -> tuple[list[dict], bool]:
    """Newest first, ordered by (created_at, id) so equal timestamps still page deterministically."""
    if f.empty:
        return [], False
    want = limit + 1
    rows: list[dict] = []
    if cursor:
        created_at, event_id = cursor
        rows += (
            _query(current_user, f).eq("created_at", created_at).lt("id", event_id)
            .order("id", desc=True).limit(want).execute().data or []
        )
        if len(rows) < want:
            rows += (
                _query(current_user, f).lt("created_at", created_at)
                .order("created_at", desc=True).order("id", desc=True).limit(want - len(rows)).execute().data or []
            )
    else:
        rows = _query(current_user, f).order("created_at", desc=True).order("id", desc=True).limit(want).execute().data or []
    return rows[:limit], len(rows) > limit


def _actor_names(ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    rows = supabase.table("user_profiles").select("id, full_name, preferred_name").in_("id", sorted(ids)).execute().data or []
    return {r["id"]: (r.get("preferred_name") or r.get("full_name") or "").strip() for r in rows}


def _actor(row: dict, names: dict[str, str]) -> dict:
    actor_id = row.get("actor_id")
    if actor_id:
        name = names.get(actor_id) or "Unknown user"
    elif row.get("source") == "automation":
        name = "System"
    else:
        name = "Former user (account removed)"
    # actor_role is the role recorded AT THE TIME of the action; it is never derived from the user's current role.
    return {"id": actor_id, "name": name, "role": row.get("actor_role"), "role_label": role_label(row.get("actor_role"))}


def _event(row: dict, names: dict[str, str], *, detail: bool) -> dict:
    action = row["action"]
    has_detail_states = action.startswith(DETAIL_ACTION_PREFIX)
    changes = build_changes(row["resource_type"], row.get("old_state"), row.get("new_state")) if has_detail_states else []
    category = action_category(action)
    event = {
        "id": row["id"],
        "action": action,
        "title": action_title(action),
        "category": category,
        "category_label": CATEGORIES.get(category or ""),
        "occurred_at": row["created_at"],  # recorded UTC instant; the client formats it in the hotel's zone
        "actor": _actor(row, names),
        "resource": {
            "type": row["resource_type"],
            "type_label": RESOURCE_TYPES.get(row["resource_type"], row["resource_type"]),
            "id": row["resource_id"],
            "name": resource_name(row["resource_type"], row.get("old_state"), row.get("new_state")) if has_detail_states else None,
        },
        "source": row.get("source"),
        "has_details": bool(changes),
    }
    if detail:
        event["changes"] = changes if changes else None
    return event


def _events(current_user: CurrentUser, rows: list[dict], *, detail: bool) -> list[dict]:
    names = _actor_names({r["actor_id"] for r in rows if r.get("actor_id")})
    return [_event(r, names, detail=detail) for r in rows]


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/categories")
async def list_categories(current_user: CurrentUser = Depends(require_role("gm"))):
    return {
        "data": [{"id": cid, "label": label} for cid, label in CATEGORIES.items()],
        "meta": {"resource_types": [{"id": rid, "label": label} for rid, label in RESOURCE_TYPES.items()]},
    }


@router.get("/actors")
async def list_actors(current_user: CurrentUser = Depends(require_role("gm"))):
    """People who appear in this hotel's recorded activity (bounded), for the Actor filter."""
    zone = _hotel_zone(current_user.hotel_id)
    start, end, _, _ = _range(None, None, zone, MAX_LIST_DAYS)
    since = (datetime.fromisoformat(end) - timedelta(days=MAX_LIST_DAYS)).isoformat()
    rows = (
        supabase.table("operational_audit_events").select("actor_id")
        .eq("tenant_id", current_user.hotel_id).in_("action", list(ACTIONS)).gte("created_at", since)
        .order("created_at", desc=True).limit(1000).execute().data or []
    )
    ids = {r["actor_id"] for r in rows if r.get("actor_id")}
    names = _actor_names(ids)
    return {"data": sorted(({"id": i, "name": names.get(i) or "Unknown user"} for i in ids), key=lambda a: a["name"].lower())}


@router.get("")
async def list_activity(
    q: Optional[str] = Query(None, max_length=200),
    category: Optional[str] = Query(None, max_length=40),
    resource_type: Optional[str] = Query(None, max_length=60),
    actor_id: Optional[str] = Query(None, max_length=64),
    date_from: Optional[str] = Query(None, max_length=10),
    date_to: Optional[str] = Query(None, max_length=10),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    cursor: Optional[str] = Query(None, max_length=512),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    zone = _hotel_zone(current_user.hotel_id)
    filters, start_day, end_day = _build_filters(
        current_user, zone=zone, date_from=date_from, date_to=date_to, max_days=MAX_LIST_DAYS,
        category=category, resource_type=resource_type, actor_id=actor_id, q=q,
    )
    rows, has_more = _fetch_page(current_user, filters, _decode_cursor(cursor), limit)
    next_cursor = _encode_cursor(rows[-1]["created_at"], rows[-1]["id"]) if has_more and rows else None
    return {
        "data": _events(current_user, rows, detail=False),
        "meta": {
            "limit": limit, "has_more": has_more, "next_cursor": next_cursor,
            "date_from": start_day.isoformat(), "date_to": end_day.isoformat(), "timezone": zone.key,
        },
    }


@router.get("/export")
async def export_activity(
    q: Optional[str] = Query(None, max_length=200),
    category: Optional[str] = Query(None, max_length=40),
    resource_type: Optional[str] = Query(None, max_length=60),
    actor_id: Optional[str] = Query(None, max_length=64),
    date_from: Optional[str] = Query(None, max_length=10),
    date_to: Optional[str] = Query(None, max_length=10),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    """Bounded CSV of exactly what the screen shows for the same filters (same allowlist and redaction)."""
    zone = _hotel_zone(current_user.hotel_id)
    filters, start_day, end_day = _build_filters(
        current_user, zone=zone, date_from=date_from, date_to=date_to, max_days=MAX_EXPORT_DAYS,
        category=category, resource_type=resource_type, actor_id=actor_id, q=q,
    )
    events: list[dict] = []
    cursor: tuple[str, str] | None = None
    truncated = False
    while len(events) < MAX_EXPORT_ROWS:
        page_size = min(EXPORT_PAGE, MAX_EXPORT_ROWS - len(events))
        rows, has_more = _fetch_page(current_user, filters, cursor, page_size)
        events += _events(current_user, rows, detail=True)
        if not has_more or not rows:
            break
        cursor = (rows[-1]["created_at"], rows[-1]["id"])
        if len(events) >= MAX_EXPORT_ROWS:
            truncated = True

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Date and time", "Time zone", "Event", "Category", "Actor", "Actor role at the time", "Resource type", "Resource", "Source", "Event ID", "Changes"])
    for e in events:
        when = datetime.fromisoformat(e["occurred_at"].replace("Z", "+00:00")).astimezone(zone)
        writer.writerow([csv_safe(v) for v in [
            when.strftime("%Y-%m-%d %H:%M:%S"), zone.key, e["title"], e["category_label"], e["actor"]["name"],
            e["actor"]["role_label"] or "", e["resource"]["type_label"], e["resource"]["name"] or e["resource"]["id"],
            e["source"] or "", e["id"], _changes_text(e.get("changes")),
        ]])
    if truncated:
        # Headers are not visible to every download path, so the file itself states that it is incomplete.
        writer.writerow([f"Export limited to the newest {MAX_EXPORT_ROWS} events. Narrow the filters or date range to see the rest."])
    filename = f"activity-{start_day.isoformat()}-to-{end_day.isoformat()}.csv"
    return Response(
        content=out.getvalue().encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Truncated": "true" if truncated else "false",
            "Cache-Control": "no-store",
        },
    )


def _changes_text(changes: list[dict] | None) -> str:
    if not changes:
        return ""
    parts = []
    for c in changes:
        if "added" in c or "removed" in c:
            bits = [f"added: {', '.join(map(str, c['added']))}" if c.get("added") else "", f"removed: {', '.join(map(str, c['removed']))}" if c.get("removed") else ""]
            parts.append(f"{c['label']} ({'; '.join(b for b in bits if b) or 'no change'})")
        elif "changed_keys" in c:
            parts.append(f"{c['label']} changed: {', '.join(c['changed_keys'])}")
        else:
            before = c.get("before", "not recorded") if "before" in c else "not recorded"
            parts.append(f"{c['label']}: {before} -> {c.get('after', 'not recorded')}")
    return " | ".join(parts)


@router.get("/{event_id}")
async def get_activity_event(event_id: str, current_user: CurrentUser = Depends(require_role("gm"))):
    valid = _uuid_or_none(event_id)
    not_found = HTTPException(status_code=404, detail="Activity event not found.")
    if not valid:
        raise not_found
    rows = (
        supabase.table("operational_audit_events").select(COLUMNS)
        .eq("id", valid).eq("tenant_id", current_user.hotel_id).in_("action", list(ACTIONS))
        .limit(1).execute().data or []
    )
    if not rows:
        raise not_found
    zone = _hotel_zone(current_user.hotel_id)
    return {"data": _events(current_user, rows, detail=True)[0], "meta": {"timezone": zone.key}}
