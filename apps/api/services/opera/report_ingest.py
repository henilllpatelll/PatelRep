"""Opera Cloud SFTP scheduled-report ingestion.

Parallel path to services/opera/sync.py's live OHIP API sync, for hotels whose
Opera Cloud subscription doesn't include OHIP API access. Polls an SFTP folder
for scheduled report exports and upserts the same room_status fields the OHIP
path already maintains.

Deliberately self-contained -- does not import from sync.py. sync.py is the
tested, production, real-time OHIP path; this module duplicates the small
room-lookup and staff-entered-conflict rules it needs (see
_has_staff_entered_conflict) rather than extracting a shared helper, so this
new, harder-to-verify-locally feature can never regress the working OHIP path.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

from core.database import supabase
from services.opera.auth import get_opera_credentials
from services.opera.report_columns import build_header_index, resolve_report_type
from services.opera.report_parser import map_row, parse_delimited_report
from services.opera.sftp_client import download_file, list_report_files

logger = logging.getLogger(__name__)


def _combine_datetime(date_str: str | None, time_str: str | None) -> str | None:
    """Combine Opera's separate MM-DD-YY date + HH:MM time columns into ISO 8601.

    Falls back to the raw date string on any parse failure rather than raising.
    """
    if not date_str:
        return None
    try:
        parsed = datetime.strptime(date_str, "%m-%d-%y")
    except ValueError:
        return date_str

    if time_str:
        try:
            time_parsed = datetime.strptime(time_str, "%H:%M")
            parsed = parsed.replace(hour=time_parsed.hour, minute=time_parsed.minute)
        except ValueError:
            pass

    return parsed.replace(tzinfo=timezone.utc).isoformat()


def map_report_row_to_reservation(mapped: dict) -> dict:
    """Project canonical report fields into the reservation shape used for
    room-status reconciliation (mirrors sync.py's map_opera_reservation output
    where fields overlap)."""
    adults_raw = mapped.get("adults")
    adults = int(adults_raw) if adults_raw and adults_raw.isdigit() else 1

    return {
        "guest_name": mapped.get("guest_name"),
        "vip_flag": bool(mapped.get("vip_code")),
        "vip_code": mapped.get("vip_code"),
        "checkin_time": _combine_datetime(mapped.get("arrival_date"), mapped.get("arrival_time")),
        "checkout_time": _combine_datetime(mapped.get("departure_date"), mapped.get("departure_time")),
        "special_requests": mapped.get("special_requests"),
        "adults": adults,
        "room_number_opera": mapped.get("room_number_opera"),
        "opera_reservation_id": mapped.get("opera_reservation_id"),
        "rate_code": mapped.get("rate_code"),
    }


def _has_staff_entered_conflict(local_status: dict | None, remote_reservation: dict) -> bool:
    """Duplicated from sync.py's has_reservation_conflict on purpose (see module
    docstring): only flags a conflict when a staff-entered guest_name disagrees
    with the incoming remote guest name."""
    if not local_status or not local_status.get("guest_name"):
        return False
    remote_guest = remote_reservation.get("guest_name")
    return bool(remote_guest and local_status["guest_name"].strip() != remote_guest.strip())


def ingest_report_row(hotel_id: str, report_type: str, mapped_row: dict) -> str:
    """Reconcile one parsed report row into opera_reservations/room_status.

    Returns one of: "updated", "conflict", "skipped_no_room", "skipped_no_identity".
    """
    reservation = map_report_row_to_reservation(mapped_row)
    room_number = reservation.get("room_number_opera")
    reservation_id = reservation.get("opera_reservation_id")

    room_id = None
    local_status = None
    if room_number:
        room_result = supabase.table("rooms") \
            .select("id") \
            .eq("tenant_id", hotel_id) \
            .eq("room_number", room_number) \
            .maybe_single() \
            .execute()
        if room_result and room_result.data:
            room_id = room_result.data["id"]
            status_result = supabase.table("room_status") \
                .select("guest_name, vip_flag, checkin_time, checkout_time") \
                .eq("tenant_id", hotel_id) \
                .eq("room_id", room_id) \
                .maybe_single() \
                .execute()
            local_status = status_result.data if status_result else None

    if not reservation_id and not room_id:
        return "skipped_no_identity"

    if reservation_id:
        supabase.table("opera_reservations").upsert({
            "tenant_id": hotel_id,
            "opera_reservation_id": reservation_id,
            "room_id": room_id,
            "room_number_opera": room_number,
            "guest_name": reservation.get("guest_name"),
            "vip_code": reservation.get("vip_code"),
            "special_requests": reservation.get("special_requests"),
            "adults": reservation.get("adults", 1),
            "rate_code": reservation.get("rate_code"),
            "status": "IN_HOUSE" if report_type == "in_house" else "RESERVED",
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="tenant_id,opera_reservation_id").execute()

    if not room_id:
        return "skipped_no_room"

    entity_type = "reservation" if reservation_id else "room_status"
    external_id = reservation_id or room_number

    if _has_staff_entered_conflict(local_status, reservation):
        existing = supabase.table("integration_sync_conflicts") \
            .select("id") \
            .eq("tenant_id", hotel_id) \
            .eq("provider", "opera") \
            .eq("entity_type", entity_type) \
            .eq("external_id", external_id) \
            .eq("status", "open") \
            .maybe_single() \
            .execute()
        if not existing.data:
            conflict_result = supabase.table("integration_sync_conflicts").insert({
                "tenant_id": hotel_id,
                "provider": "opera",
                "entity_type": entity_type,
                "external_id": external_id,
                "local_entity_id": room_id,
                "local_snapshot": local_status or {},
                "remote_snapshot": reservation,
            }).execute()
            conflict = (conflict_result.data or [None])[0]
            if conflict:
                supabase.table("integration_sync_conflict_events").insert({
                    "tenant_id": hotel_id,
                    "conflict_id": conflict["id"],
                    "event_type": "detected",
                    "metadata": {"source": "opera_sftp_report"},
                }).execute()
        return "conflict"

    supabase.table("room_status").update({
        "guest_name": reservation.get("guest_name"),
        "vip_flag": reservation.get("vip_flag", False),
        "checkin_time": reservation.get("checkin_time"),
        "checkout_time": reservation.get("checkout_time"),
        "actual_checkout_at": None,
    }).eq("tenant_id", hotel_id).eq("room_id", room_id).execute()
    return "updated"


def record_report_file(
    hotel_id: str,
    filename: str,
    report_type: str,
    status: str,
    rows_parsed: int = 0,
    rows_upserted: int = 0,
    error: str | None = None,
    mtime: datetime | None = None,
    size: int | None = None,
    checksum: str | None = None,
) -> None:
    """Upsert the idempotency/audit log row for one delivered file.

    on_conflict="tenant_id,remote_filename" means a failed->retried->processed
    transition updates the same row rather than duplicating it.
    """
    supabase.table("opera_report_files").upsert({
        "tenant_id": hotel_id,
        "remote_filename": filename,
        "report_type": report_type,
        "status": status,
        "rows_parsed": rows_parsed,
        "rows_upserted": rows_upserted,
        "error_detail": error,
        "remote_mtime": mtime.isoformat() if mtime else None,
        "file_size": size,
        "checksum": checksum,
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="tenant_id,remote_filename").execute()


def list_unprocessed_files(hotel_id: str, remote_files: list[dict]) -> list[dict]:
    """Filter out files already logged processed/skipped. Files logged failed
    are NOT filtered out -- they're retried on the next poll."""
    filenames = [f["filename"] for f in remote_files]
    if not filenames:
        return []

    done_result = supabase.table("opera_report_files") \
        .select("remote_filename") \
        .eq("tenant_id", hotel_id) \
        .in_("remote_filename", filenames) \
        .in_("status", ["processed", "skipped"]) \
        .execute()
    done = {row["remote_filename"] for row in (done_result.data or [])}
    return [f for f in remote_files if f["filename"] not in done]


def ingest_report_file(hotel_id: str, creds: dict, remote_file_meta: dict) -> dict:
    """Download, parse, and ingest one report file. Never raises."""
    filename = remote_file_meta["filename"]
    mtime = remote_file_meta.get("mtime")
    size = remote_file_meta.get("size")

    report_type = resolve_report_type(filename, creds.get("report_type_filename_patterns"))
    if report_type is None:
        record_report_file(hotel_id, filename, "unknown", "skipped", error="unrecognized_report_type", mtime=mtime, size=size)
        return {"filename": filename, "status": "skipped", "rows_upserted": 0}

    content = download_file(creds, filename)
    if content is None:
        record_report_file(hotel_id, filename, report_type, "failed", error="download_failed", mtime=mtime, size=size)
        return {"filename": filename, "status": "failed", "rows_upserted": 0}

    checksum = hashlib.sha256(content).hexdigest()
    try:
        delimiter = creds.get("report_delimiter") or "\t"
        headers, rows = parse_delimited_report(content, delimiter=delimiter)
        column_overrides = (creds.get("report_column_mapping") or {}).get(report_type)
        header_index = build_header_index(headers, report_type, column_overrides)

        rows_upserted = 0
        for cells in rows:
            try:
                mapped = map_row(cells, header_index)
                if ingest_report_row(hotel_id, report_type, mapped) == "updated":
                    rows_upserted += 1
            except Exception as exc:
                logger.warning("Opera report row ingest failed hotel=%s file=%s: %s", hotel_id, filename, exc)

        record_report_file(
            hotel_id, filename, report_type, "processed",
            rows_parsed=len(rows), rows_upserted=rows_upserted,
            mtime=mtime, size=size, checksum=checksum,
        )
        return {"filename": filename, "status": "processed", "rows_upserted": rows_upserted}
    except Exception as exc:
        logger.error("Opera report file ingest failed hotel=%s file=%s: %s", hotel_id, filename, exc)
        record_report_file(hotel_id, filename, report_type, "failed", error=str(exc), mtime=mtime, size=size, checksum=checksum)
        return {"filename": filename, "status": "failed", "rows_upserted": 0}


def sync_report_files(hotel_id: str) -> dict:
    """Poll SFTP and ingest new scheduled-report files for one hotel.

    Mirrors sync_reservations()'s gating order: pilot flag first, then
    connection-mode check, then per-file isolation so one bad file never
    aborts the rest of the batch.
    """
    tenant_result = supabase.table("tenants").select("opera_pilot_enabled") \
        .eq("id", hotel_id).maybe_single().execute()
    if not tenant_result or not tenant_result.data or not tenant_result.data.get("opera_pilot_enabled"):
        return {"synced": 0, "skipped": True, "reason": "opera_pilot_not_enabled", "error": None}

    creds = get_opera_credentials(hotel_id)
    if not creds or creds.get("connection_mode") != "sftp_report":
        return {"synced": 0, "skipped": True, "reason": "not_sftp_report_mode", "error": None}

    remote_files = list_report_files(creds)
    pending = list_unprocessed_files(hotel_id, remote_files)
    pending.sort(key=lambda f: f.get("mtime") or datetime.min.replace(tzinfo=timezone.utc))

    files_processed = 0
    total_rows_upserted = 0
    for file_meta in pending:
        try:
            result = ingest_report_file(hotel_id, creds, file_meta)
            files_processed += 1
            total_rows_upserted += result.get("rows_upserted", 0)
        except Exception as exc:
            logger.error("Opera report file processing failed hotel=%s file=%s: %s", hotel_id, file_meta.get("filename"), exc)

    supabase.table("opera_credentials").update({
        "last_sync_at": datetime.now(timezone.utc).isoformat(),
    }).eq("tenant_id", hotel_id).execute()

    return {"synced": total_rows_upserted, "files_processed": files_processed, "error": None}
