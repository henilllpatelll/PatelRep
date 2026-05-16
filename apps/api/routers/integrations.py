import base64
import httpx
import logging
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import RedirectResponse
from urllib.parse import urlencode
from middleware.auth import get_current_user, require_role, CurrentUser
from core.database import supabase
from core.config import settings
from services.opera import sync_reservations, bootstrap_opera_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations", tags=["integrations"])

OPERA_STATE_TTL_MINUTES = 10


def _settings_redirect(query: dict[str, str]) -> RedirectResponse:
    return RedirectResponse(f"{settings.app_url}/settings/integrations?{urlencode(query)}")


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@router.post("/opera/connect")
async def opera_connect(
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """
    Returns the OHIP OAuth2 authorization URL.
    The GM should be redirected to this URL to authorize PatelRep.
    """
    state = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=OPERA_STATE_TTL_MINUTES)).isoformat()
    supabase.table("opera_oauth_states").insert({
        "tenant_id": current_user.hotel_id,
        "user_id": current_user.user_id,
        "nonce": state,
        "expires_at": expires_at,
    }).execute()

    query = urlencode({
        "response_type": "code",
        "client_id": settings.opera_oauth_client_id,
        "redirect_uri": settings.opera_oauth_redirect_uri,
        "scope": "urn:opc:hgbu:ws:__myscopes__",
        "state": state,
    })
    auth_url = f"{settings.opera_oauth_base_url}/oauth/v1/authorize?{query}"
    return {"data": {"auth_url": auth_url, "hotel_id": current_user.hotel_id}}


@router.get("/opera/callback")
async def opera_callback(
    code: str = Query(...),
    state: str = Query(...),
    error: str = Query(None),
):
    """
    OAuth callback from Oracle OHIP.
    - Exchanges authorization code for access + refresh tokens.
    - Stores credentials in opera_credentials table.
    - Triggers initial 90-day reservation bootstrap.
    - Redirects browser back to the web settings page.
    """
    if error:
        return _settings_redirect({"opera": "error", "reason": error})

    state_result = supabase.table("opera_oauth_states")\
        .select("id, tenant_id, user_id, expires_at, used_at")\
        .eq("nonce", state)\
        .maybe_single()\
        .execute()

    state_row = state_result.data if state_result else None
    expires_at = _parse_datetime(state_row.get("expires_at") if state_row else None)
    now = datetime.now(timezone.utc)
    if (
        not state_row
        or state_row.get("used_at")
        or not expires_at
        or expires_at <= now
    ):
        return _settings_redirect({"opera": "error", "reason": "invalid_state"})

    supabase.table("opera_oauth_states")\
        .update({"used_at": now.isoformat()})\
        .eq("id", state_row["id"])\
        .execute()

    hotel_id = state_row["tenant_id"]

    # Exchange code for tokens.
    # OHIP spec: client credentials go in Basic auth header, not the body.
    # Endpoint: /oauth/v1/tokens (plural)
    _creds_b64 = base64.b64encode(
        f"{settings.opera_oauth_client_id}:{settings.opera_oauth_client_secret}".encode()
    ).decode()
    try:
        token_response = httpx.post(
            f"{settings.opera_oauth_base_url}/oauth/v1/tokens",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.opera_oauth_redirect_uri,
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": f"Basic {_creds_b64}",
                "x-app-key": settings.opera_app_key,
            },
            timeout=20.0,
        )
        token_response.raise_for_status()
        tokens = token_response.json()
    except Exception:
        return _settings_redirect({"opera": "error", "reason": "token_exchange_failed"})

    expires_in = tokens.get("expires_in", 3600)
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    opera_hotel_id = tokens.get("hotel_id")  # Some OHIP tenants return this in token response

    # Upsert credentials
    supabase.table("opera_credentials").upsert({
        "tenant_id": hotel_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expires_at": (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat(),
        "hotel_id_opera": opera_hotel_id,
        "is_connected": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="tenant_id").execute()

    # Trigger background bootstrap (fire and forget — errors don't block the redirect)
    bootstrap_warning = None
    try:
        bootstrap_opera_data(hotel_id)
    except Exception as exc:
        logger.error("Opera bootstrap failed for hotel=%s: %s", hotel_id, exc)
        bootstrap_warning = "opera_sync_failed"

    redirect_url = f"{settings.app_url}/settings/integrations?{urlencode({'opera': 'connected'})}"
    if bootstrap_warning:
        redirect_url += f"&{urlencode({'warning': bootstrap_warning})}"
    return RedirectResponse(redirect_url)


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
    """Test the Opera Cloud connection by making a lightweight API call."""
    from services.opera import get_valid_access_token, get_opera_credentials

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
