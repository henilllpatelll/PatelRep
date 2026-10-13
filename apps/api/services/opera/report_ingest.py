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
from services.opera.report_columns import build_header_index, missing_required_fields, resolve_report_type
from services.opera.report_parser import map_row, parse_delimited_report_detailed
from services.opera.sftp_client import SftpConnectionError, download_file, list_report_files

logger = logging.getLogger(__name__)

# A file modified this recently may still be mid-upload; defer it to the next poll
# rather than ingest (and permanently log) a truncated copy.
FILE_SETTLE_SECONDS = 60


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
        # limit(1)+list (not maybe_single) so a retry never errors or duplicates when an
        # open conflict already exists for this entity.
        existing = supabase.table("integration_sync_conflicts") \
            .select("id") \
            .eq("tenant_id", hotel_id) \
            .eq("provider", "opera") \
            .eq("entity_type", entity_type) \
            .eq("external_id", external_id) \
            .eq("status", "open") \
            .limit(1) \
            .execute()
        if not (existing and existing.data):
            conflict_result = supabase.table("integration_sync_conflicts").insert({
                "tenant_id": hotel_id,
                "provider": "opera",
                "entity_type": entity_type,
                "external_id": external_id,
                "local_entity_id": room_id,
                "local_snapshot": local_status or {},
                "remote_snapshot": reservation,
                "status": "open",
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


def _summarize_file_result(counts: dict, failed_rows: list[tuple[int, str]], notes: list[str]) -> str | None:
    """Human-readable outcome stored in opera_report_files.error_detail.

    Holds counts, row numbers and exception class names only -- never row content,
    so no guest data or secrets can leak into the audit log. None when nothing
    noteworthy happened (every row updated cleanly).
    """
    parts = [f"{key}={counts[key]}" for key in ("skipped", "conflicts", "failed") if counts[key]]
    if not parts and not notes:
        return None
    detail = f"updated={counts['updated']} " + " ".join(parts)
    if failed_rows:
        shown = ", ".join(f"row {n} ({kind})" for n, kind in failed_rows[:20])
        more = f" +{len(failed_rows) - 20} more" if len(failed_rows) > 20 else ""
        detail += f" | failed rows: {shown}{more}"
    if notes:
        detail += " | " + "; ".join(notes)
    return detail.strip()


def ingest_report_file(hotel_id: str, creds: dict, remote_file_meta: dict) -> dict:
    """Download, parse, and ingest one report file.

    Outcome semantics (opera_report_files.status):
      * processed -- every row was accounted for: updated, skipped (no room /
        no identity), or recorded as a reconciliation conflict. None failed.
      * failed    -- the download failed, the file is structurally malformed or
        missing required columns, or at least one row raised. It is retried on
        the next poll. Ingestion is idempotent (reservations upsert on
        (tenant, reservation id), room_status updates set absolute values, open
        conflicts are de-duplicated), so a retry safely reconciles any rows
        written before the failure. Writes are per-row, NOT one transaction.
      * skipped   -- not a supported report type.
    Columns for skipped/conflict/failed counts do not exist (no migration), so
    they are summarised in error_detail; rows_parsed/rows_upserted hold the
    parsed and updated counts.
    """
    filename = remote_file_meta["filename"]
    mtime = remote_file_meta.get("mtime")
    size = remote_file_meta.get("size")

    report_type = resolve_report_type(filename, creds.get("report_type_filename_patterns"))
    if report_type is None:
        record_report_file(hotel_id, filename, "unknown", "skipped", error="unrecognized_report_type", mtime=mtime, size=size)
        return {"filename": filename, "status": "skipped", "rows_upserted": 0}

    result = {"filename": filename, "status": "failed", "rows_parsed": 0, "rows_upserted": 0,
              "rows_skipped": 0, "rows_conflict": 0, "rows_failed": 0}

    try:
        content = download_file(creds, filename)
    except SftpConnectionError as exc:
        logger.warning("Opera report download failed hotel=%s file=%s: %s", hotel_id, filename, type(exc).__name__)
        record_report_file(hotel_id, filename, report_type, "failed", error=f"download_failed: {exc}", mtime=mtime, size=size)
        return result

    checksum = hashlib.sha256(content).hexdigest()
    try:
        delimiter = creds.get("report_delimiter") or "\t"
        parsed = parse_delimited_report_detailed(content, delimiter=delimiter)

        problem = None
        if parsed.has_binary_content:
            problem = "malformed_file: binary content"
        elif not parsed.headers:
            problem = "malformed_file: empty file or missing header row"
        header_index: dict[int, str] = {}
        if problem is None:
            column_overrides = (creds.get("report_column_mapping") or {}).get(report_type)
            header_index = build_header_index(parsed.headers, report_type, column_overrides)
            missing = missing_required_fields(report_type, header_index)
            if missing:
                problem = f"missing_required_columns: {', '.join(missing)}"
        if problem is not None:
            logger.warning("Opera report rejected hotel=%s file=%s: %s", hotel_id, filename, problem)
            record_report_file(hotel_id, filename, report_type, "failed", error=problem,
                               mtime=mtime, size=size, checksum=checksum)
            return result

        counts = {"updated": 0, "skipped": 0, "conflicts": 0, "failed": 0}
        failed_rows: list[tuple[int, str]] = []
        for row_number, cells in enumerate(parsed.rows, start=1):
            try:
                outcome = ingest_report_row(hotel_id, report_type, map_row(cells, header_index))
            except Exception as exc:
                # Row content is never logged: it can carry guest names.
                counts["failed"] += 1
                failed_rows.append((row_number, type(exc).__name__))
                logger.warning("Opera report row failed hotel=%s file=%s row=%d: %s",
                               hotel_id, filename, row_number, type(exc).__name__)
                continue
            if outcome == "updated":
                counts["updated"] += 1
            elif outcome == "conflict":
                counts["conflicts"] += 1
            else:
                counts["skipped"] += 1

        notes: list[str] = []
        if parsed.incomplete_tail is not None:
            notes.append("malformed_file: incomplete final record not ingested")
        if not parsed.trailer_seen:
            notes.append("no totals trailer found (file may be truncated)")
        incomplete = parsed.incomplete_tail is not None

        status = "failed" if (counts["failed"] or incomplete) else "processed"
        record_report_file(
            hotel_id, filename, report_type, status,
            rows_parsed=len(parsed.rows) + (1 if incomplete else 0), rows_upserted=counts["updated"],
            error=_summarize_file_result(counts, failed_rows, notes),
            mtime=mtime, size=size, checksum=checksum,
        )
        result.update({
            "status": status, "rows_parsed": len(parsed.rows), "rows_upserted": counts["updated"],
            "rows_skipped": counts["skipped"], "rows_conflict": counts["conflicts"],
            "rows_failed": counts["failed"] + (1 if incomplete else 0),
        })
        return result
    except Exception as exc:
        logger.error("Opera report file ingest failed hotel=%s file=%s: %s", hotel_id, filename, type(exc).__name__)
        record_report_file(hotel_id, filename, report_type, "failed", error=f"ingest_error: {type(exc).__name__}",
                           mtime=mtime, size=size, checksum=checksum)
        return result


def _is_still_uploading(file_meta: dict, now: datetime) -> bool:
    """True for a file modified within the settle window (an upload may still be in flight)."""
    mtime = file_meta.get("mtime")
    if not mtime:
        return False
    age = (now - mtime).total_seconds()
    return 0 <= age < FILE_SETTLE_SECONDS


def sync_report_files(hotel_id: str) -> dict:
    """Poll SFTP and ingest new scheduled-report files for one hotel.

    Mirrors sync_reservations()'s gating order: pilot flag first, then
    connection-mode check, then per-file isolation so one bad file never
    aborts the rest of the batch.

    ``status`` is "ok" (listing worked, no file failed), "partial" (at least one
    file failed and will be retried) or "failed" (could not list the folder).
    ``last_sync_at`` only advances on "ok", so it never claims a sync that did
    not complete. A genuinely empty folder is "ok".
    """
    tenant_result = supabase.table("tenants").select("opera_pilot_enabled") \
        .eq("id", hotel_id).maybe_single().execute()
    if not tenant_result or not tenant_result.data or not tenant_result.data.get("opera_pilot_enabled"):
        return {"synced": 0, "skipped": True, "reason": "opera_pilot_not_enabled", "error": None}

    creds = get_opera_credentials(hotel_id)
    if not creds or creds.get("connection_mode") != "sftp_report":
        return {"synced": 0, "skipped": True, "reason": "not_sftp_report_mode", "error": None}

    try:
        remote_files = list_report_files(creds)
    except SftpConnectionError as exc:
        logger.warning("Opera SFTP listing failed hotel=%s: %s", hotel_id, type(exc).__name__)
        return {"synced": 0, "files_processed": 0, "files_failed": 0, "status": "failed", "error": str(exc)}
    except Exception as exc:
        logger.error("Opera SFTP listing crashed hotel=%s: %s", hotel_id, type(exc).__name__)
        return {"synced": 0, "files_processed": 0, "files_failed": 0, "status": "failed",
                "error": f"SFTP listing failed: {type(exc).__name__}"}

    pending = list_unprocessed_files(hotel_id, remote_files)
    pending.sort(key=lambda f: f.get("mtime") or datetime.min.replace(tzinfo=timezone.utc))

    now = datetime.now(timezone.utc)
    totals = {"synced": 0, "files_processed": 0, "files_failed": 0, "files_skipped": 0,
              "files_deferred": 0, "rows_failed": 0, "conflicts": 0}
    for file_meta in pending:
        if _is_still_uploading(file_meta, now):
            totals["files_deferred"] += 1
            continue
        try:
            result = ingest_report_file(hotel_id, creds, file_meta)
        except Exception as exc:
            logger.error("Opera report file processing failed hotel=%s file=%s: %s",
                         hotel_id, file_meta.get("filename"), type(exc).__name__)
            totals["files_failed"] += 1
            continue
        file_status = result.get("status")
        if file_status == "processed":
            totals["files_processed"] += 1
        elif file_status == "skipped":
            totals["files_skipped"] += 1
        else:
            totals["files_failed"] += 1
        totals["synced"] += result.get("rows_upserted", 0)
        totals["rows_failed"] += result.get("rows_failed", 0)
        totals["conflicts"] += result.get("rows_conflict", 0)

    status = "partial" if totals["files_failed"] else "ok"
    if status == "ok":
        supabase.table("opera_credentials").update({
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
        }).eq("tenant_id", hotel_id).execute()

    return {**totals, "status": status, "error": None}
