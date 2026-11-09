"""Load the shift occurrences the cron may summarise right now (reads only).

Tenant-scoped on every query. A tenant whose schedule/evidence cannot be read is
skipped and reported — it never falls back to "assume it worked", because that
guess is exactly what produced premature, paid summaries (issue #204).
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from dateutil import tz as dateutil_tz

from core.timezones import safe_gettz
from services.ai.shift_summary_schedule import (
    GRACE, LOOKBACK, Occurrence, candidate_dates, due_occurrences,
)

logger = logging.getLogger(__name__)

_CHUNK = 100


@dataclass
class DueSelection:
    due: list[Occurrence] = field(default_factory=list)
    already_present: int = 0
    tenant_errors: list[str] = field(default_factory=list)


def _chunks(items: list[str], size: int = _CHUNK):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _tenant_tz(name):
    return (safe_gettz(name) if name else None) or dateutil_tz.gettz("America/Chicago")


def _parse_ts(value) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def load_due_occurrences(db, now: datetime | None = None, *,
                         grace: timedelta = GRACE, lookback: timedelta = LOOKBACK) -> DueSelection:
    """Raises if the global shift/tenant lookup fails (the cron records `failed`).
    Per-tenant read failures are collected in `tenant_errors` and that tenant is skipped."""
    now = now or datetime.now(timezone.utc)
    # Archived templates are removed shifts; inactive ones are switched off. Neither may produce summaries.
    shifts = (db.table("shifts")
              .select("id, tenant_id, start_time, end_time")
              .is_("archived_at", "null").eq("is_active", True).execute().data or [])
    by_tenant: dict[str, list[dict]] = {}
    for shift in shifts:
        by_tenant.setdefault(shift["tenant_id"], []).append(shift)

    tenants: dict[str, dict] = {}
    for ids in _chunks(list(by_tenant)):
        rows = db.table("tenants").select("id, timezone").in_("id", ids).eq("is_active", True).execute().data or []
        tenants.update({r["id"]: r for r in rows})

    selection = DueSelection()
    for tenant_id, tenant_shifts in by_tenant.items():
        tenant = tenants.get(tenant_id)
        if tenant is None:
            continue  # inactive or deleted hotel
        tz = _tenant_tz(tenant.get("timezone"))
        shift_ids = [s["id"] for s in tenant_shifts]
        dates = [d.isoformat() for d in candidate_dates(tz, now, lookback)]
        try:
            worked: set[tuple[str, str]] = set()
            published_ends: dict[tuple[str, str], datetime] = {}
            present: set[tuple[str, str]] = set()
            for ids in _chunks(shift_ids):
                assignments = (db.table("shift_assignments")
                               .select("shift_id, work_date, ends_at")
                               .eq("tenant_id", tenant_id).in_("shift_id", ids).in_("work_date", dates)
                               .eq("publication_state", "published").execute().data or [])
                for a in assignments:
                    key = (a["shift_id"], str(a["work_date"])[:10])
                    worked.add(key)
                    ends = _parse_ts(a.get("ends_at"))
                    if ends and (key not in published_ends or ends > published_ends[key]):
                        published_ends[key] = ends
                entries = (db.table("logbook_entries")
                           .select("shift_id, entry_date")
                           .eq("tenant_id", tenant_id).in_("shift_id", ids).in_("entry_date", dates)
                           .is_("archived_at", "null").execute().data or [])
                worked.update((e["shift_id"], str(e["entry_date"])[:10]) for e in entries)
                summaries = (db.table("shift_summaries")
                             .select("shift_id, shift_date")
                             .eq("tenant_id", tenant_id).in_("shift_id", ids).in_("shift_date", dates)
                             .execute().data or [])
                present.update((r["shift_id"], str(r["shift_date"])[:10]) for r in summaries)
        except Exception as exc:
            logger.error("Shift summary eligibility lookup failed for tenant=%s: %s", tenant_id, exc, exc_info=True)
            selection.tenant_errors.append(f"tenant {tenant_id}: {exc}")
            continue

        for occ in due_occurrences(tenant_id, tz, tenant_shifts, worked, now,
                                   published_ends=published_ends, grace=grace, lookback=lookback):
            if (occ.shift_id, occ.shift_date) in present:
                selection.already_present += 1
            else:
                selection.due.append(occ)
    return selection
