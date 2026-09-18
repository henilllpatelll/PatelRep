import httpx
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from middleware.auth import get_current_user, require_role, CurrentUser
from core.database import supabase
from models.requests import OperaConnectRequest, OperaSftpConnectRequest, ResolveOperaSyncConflictRequest
from services.opera import sync_reservations, bootstrap_opera_data, sync_report_files
from services.opera.auth import acquire_new_token, get_opera_credentials, get_valid_access_token
from services.opera.crypto import encrypt_opera_secrets
from services.opera.sftp_client import SftpConnectionError, test_connection as sftp_test_connection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _require_opera_pilot(current_user: CurrentUser) -> None:
    """D-03: gate every Opera endpoint to explicitly enrolled pilot hotels."""
    result = supabase.table("tenants").select("opera_pilot_enabled") \
        .eq("id", current_user.hotel_id).maybe_single().execute()
    if not result or not result.data or not result.data.get("opera_pilot_enabled"):
        raise HTTPException(status_code=403, detail="Opera pilot not enabled for this hotel")


@router.post("/opera/connect")
async def opera_connect(
    body: OperaConnectRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """
    Connect Opera Cloud using OHIP credentials.
    Tests the connection by obtaining an access token, then stores credentials.
    OHIP supports password grant (integration user) and client_credentials (OCIM).
    """
    _require_opera_pilot(current_user)
    ohip_base = body.ohip_base_url.rstrip("/")

    try:
        tokens = acquire_new_token(ohip_base, body.integration_username, body.integration_password)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Opera connection failed ({e.response.status_code}). Check your credentials and base URL."
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Could not reach the OHIP endpoint. Verify the base URL.")

    if not tokens or not tokens.get("access_token"):
        raise HTTPException(status_code=400, detail="Opera returned no access token. Check your credentials.")

    expires_in = tokens.get("expires_in", 3600)
    now_utc = datetime.now(timezone.utc)

    supabase.table("opera_credentials").upsert(encrypt_opera_secrets({
        "tenant_id": current_user.hotel_id,
        "ohip_base_url": ohip_base,
        "hotel_id_opera": body.hotel_id_opera,
        "integration_username": body.integration_username,
        "integration_password": body.integration_password,
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "token_expires_at": (now_utc + timedelta(seconds=expires_in)).isoformat(),
        "is_connected": True,
        "updated_at": now_utc.isoformat(),
    }), on_conflict="tenant_id").execute()

    try:
        bootstrap_opera_data(current_user.hotel_id)
    except Exception as exc:
        logger.error("Opera bootstrap failed for hotel=%s: %s", current_user.hotel_id, exc)

    return {"data": {"connected": True, "message": "Opera Cloud connected successfully"}}


@router.get("/opera/status")
async def opera_status(
    current_user: CurrentUser = Depends(get_current_user)
):
    """Return current Opera Cloud integration status for the hotel."""
    _require_opera_pilot(current_user)
    result = supabase.table("opera_credentials")\
        .select(
            "hotel_id_opera, ohip_base_url, connection_mode, sftp_host, sftp_remote_path, "
            "is_connected, last_sync_at, created_at, updated_at"
        )\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not result or not result.data or not result.data.get("is_connected"):
        return {"data": {"connected": False}}

    d = result.data
    return {
        "data": {
            "connected": True,
            "connection_mode": d.get("connection_mode", "api"),
            "opera_hotel_id": d.get("hotel_id_opera"),
            "ohip_base_url": d.get("ohip_base_url"),
            "sftp_host": d.get("sftp_host"),
            "sftp_remote_path": d.get("sftp_remote_path"),
            "last_sync_at": d.get("last_sync_at"),
            "connected_since": d.get("created_at"),
        }
    }


@router.post("/opera/sync")
async def opera_sync(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Manually trigger a reservation sync from Opera Cloud."""
    _require_opera_pilot(current_user)
    result = sync_reservations(current_user.hotel_id)
    if result.get("error"):
        raise HTTPException(status_code=503, detail=result["error"])
    return {
        "data": {
            "synced_reservations": result.get("synced", 0),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }
    }


@router.get("/opera/conflicts")
async def list_opera_sync_conflicts(
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer")),
):
    """Show unresolved source-of-truth conflicts without exposing OHIP credentials."""
    _require_opera_pilot(current_user)
    result = supabase.table("integration_sync_conflicts") \
        .select("*") \
        .eq("tenant_id", current_user.hotel_id) \
        .eq("provider", "opera") \
        .eq("status", "open") \
        .order("detected_at", desc=True) \
        .limit(100) \
        .execute()
    return {"data": result.data or []}


@router.post("/opera/conflicts/{conflict_id}/resolve")
async def resolve_opera_sync_conflict(
    conflict_id: str,
    body: ResolveOperaSyncConflictRequest,
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer")),
):
    """Record an explicit human source-of-truth decision for an Opera conflict."""
    _require_opera_pilot(current_user)
    lookup = supabase.table("integration_sync_conflicts") \
        .select("*") \
        .eq("tenant_id", current_user.hotel_id) \
        .eq("provider", "opera") \
        .eq("status", "open") \
        .eq("id", conflict_id) \
        .maybe_single() \
        .execute()
    conflict = lookup.data
    if not conflict:
        raise HTTPException(status_code=404, detail="Opera sync conflict not found")

    if body.resolution == "remote_wins" and conflict.get("local_entity_id"):
        remote = conflict.get("remote_snapshot") or {}
        supabase.table("room_status").update({
            "guest_name": remote.get("guest_name"),
            "vip_flag": remote.get("vip_flag", False),
            "checkin_time": remote.get("checkin_time"),
            "checkout_time": remote.get("checkout_time"),
            "actual_checkout_at": None,
        }).eq("tenant_id", current_user.hotel_id).eq("room_id", conflict["local_entity_id"]).execute()

    status = f"resolved_{body.resolution}"
    result = supabase.table("integration_sync_conflicts").update({
        "status": status,
        "resolved_by": current_user.user_id,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("tenant_id", current_user.hotel_id).eq("id", conflict_id).execute()
    supabase.table("integration_sync_conflict_events").insert({
        "tenant_id": current_user.hotel_id,
        "conflict_id": conflict_id,
        "event_type": status,
        "actor_id": current_user.user_id,
        "metadata": {"resolution": body.resolution},
    }).execute()
    return {"data": (result.data or [None])[0]}


@router.post("/opera/sftp/connect")
async def opera_sftp_connect(
    body: OperaSftpConnectRequest,
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """
    Connect Opera Cloud via scheduled-report SFTP ingestion (services/opera/report_ingest.py),
    an alternative to the OHIP API path for hotels whose subscription doesn't include OHIP access.
    Tests the SFTP connection before storing credentials.
    """
    _require_opera_pilot(current_user)
    creds = {
        "sftp_host": body.sftp_host,
        "sftp_port": body.sftp_port,
        "sftp_username": body.sftp_username,
        "sftp_password": body.sftp_password,
        "sftp_private_key": body.sftp_private_key,
        "sftp_host_key_fingerprint": body.sftp_host_key_fingerprint,
        "sftp_remote_path": body.sftp_remote_path,
    }
    try:
        sftp_test_connection(creds)
    except SftpConnectionError as e:
        raise HTTPException(status_code=400, detail=f"SFTP connection failed: {e}")

    now_utc = datetime.now(timezone.utc)
    supabase.table("opera_credentials").upsert(encrypt_opera_secrets({
        "tenant_id": current_user.hotel_id,
        "connection_mode": "sftp_report",
        "sftp_host": body.sftp_host,
        "sftp_port": body.sftp_port,
        "sftp_username": body.sftp_username,
        "sftp_password": body.sftp_password,
        "sftp_private_key": body.sftp_private_key,
        "sftp_host_key_fingerprint": body.sftp_host_key_fingerprint,
        "sftp_remote_path": body.sftp_remote_path,
        "report_delimiter": body.report_delimiter,
        "report_column_mapping": body.report_column_mapping,
        "report_type_filename_patterns": body.report_type_filename_patterns,
        "is_connected": True,
        "updated_at": now_utc.isoformat(),
    }), on_conflict="tenant_id").execute()

    try:
        sync_report_files(current_user.hotel_id)
    except Exception as exc:
        logger.error("Opera SFTP initial sync failed for hotel=%s: %s", current_user.hotel_id, exc)

    return {"data": {"connected": True, "message": "Opera Cloud SFTP report ingestion connected successfully"}}


@router.post("/opera/sftp/sync")
async def opera_sftp_sync(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Manually trigger an SFTP report poll/ingest for this hotel."""
    _require_opera_pilot(current_user)
    result = sync_report_files(current_user.hotel_id)
    if result.get("error"):
        raise HTTPException(status_code=503, detail=result["error"])
    return {
        "data": {
            "files_processed": result.get("files_processed", 0),
            "synced_rows": result.get("synced", 0),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }
    }


@router.post("/opera/sftp/test")
async def opera_sftp_test(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Re-verify the stored SFTP connection."""
    _require_opera_pilot(current_user)
    creds = get_opera_credentials(current_user.hotel_id)
    if not creds or creds.get("connection_mode") != "sftp_report":
        raise HTTPException(status_code=400, detail="Opera Cloud SFTP report ingestion is not connected")

    try:
        sftp_test_connection(creds)
    except SftpConnectionError as e:
        raise HTTPException(status_code=503, detail=f"SFTP connection failed: {e}")

    return {"data": {"connected": True, "message": "Opera Cloud SFTP connection verified"}}


@router.get("/opera/sftp/files")
async def list_opera_report_files(
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer")),
):
    """Show recent SFTP report ingestion history (filenames/counts only, no secrets)."""
    _require_opera_pilot(current_user)
    result = supabase.table("opera_report_files") \
        .select("id, report_type, remote_filename, status, rows_parsed, rows_upserted, error_detail, processed_at") \
        .eq("tenant_id", current_user.hotel_id) \
        .order("processed_at", desc=True) \
        .limit(50) \
        .execute()
    return {"data": result.data or []}


@router.post("/opera/test")
async def opera_test(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Test the Opera Cloud connection by validating the current access token."""
    _require_opera_pilot(current_user)
    creds = get_opera_credentials(current_user.hotel_id)
    if not creds:
        raise HTTPException(status_code=400, detail="Opera Cloud is not connected")

    token = get_valid_access_token(current_user.hotel_id)
    if not token:
        raise HTTPException(status_code=503, detail="Failed to obtain a valid access token")

    return {"data": {"connected": True, "message": "Opera Cloud connection verified"}}


@router.delete("/opera/disconnect")
async def opera_disconnect(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Disconnect Opera Cloud integration and clear stored tokens."""
    _require_opera_pilot(current_user)
    supabase.table("opera_credentials")\
        .update({
            "is_connected": False,
            "integration_password": None,
            "access_token": None,
            "refresh_token": None,
            "sftp_password": None,
            "sftp_private_key": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": {"connected": False, "message": "Opera Cloud disconnected"}}
