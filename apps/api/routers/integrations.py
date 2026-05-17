import httpx
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from middleware.auth import get_current_user, require_role, CurrentUser
from core.database import supabase
from core.config import settings
from models.requests import OperaConnectRequest
from services.opera import sync_reservations, bootstrap_opera_data
from services.opera.auth import acquire_new_token, get_opera_credentials, get_valid_access_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations", tags=["integrations"])


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

    supabase.table("opera_credentials").upsert({
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
    }, on_conflict="tenant_id").execute()

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
    result = supabase.table("opera_credentials")\
        .select("hotel_id_opera, ohip_base_url, is_connected, last_sync_at, created_at, updated_at")\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    if not result or not result.data or not result.data.get("is_connected"):
        return {"data": {"connected": False}}

    d = result.data
    return {
        "data": {
            "connected": True,
            "opera_hotel_id": d.get("hotel_id_opera"),
            "ohip_base_url": d.get("ohip_base_url"),
            "last_sync_at": d.get("last_sync_at"),
            "connected_since": d.get("created_at"),
        }
    }


@router.post("/opera/sync")
async def opera_sync(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Manually trigger a reservation sync from Opera Cloud."""
    result = sync_reservations(current_user.hotel_id)
    if result.get("error"):
        raise HTTPException(status_code=503, detail=result["error"])
    return {
        "data": {
            "synced_reservations": result.get("synced", 0),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }
    }


@router.post("/opera/test")
async def opera_test(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Test the Opera Cloud connection by validating the current access token."""
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
    supabase.table("opera_credentials")\
        .update({
            "is_connected": False,
            "access_token": None,
            "refresh_token": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    return {"data": {"connected": False, "message": "Opera Cloud disconnected"}}
