import base64
import httpx
from datetime import datetime, timedelta, timezone
from core.database import supabase
from core.config import settings


def _basic_auth_header() -> str:
    """Build Basic auth header from client_id:client_secret per OHIP OAuth spec."""
    creds_str = f"{settings.opera_oauth_client_id}:{settings.opera_oauth_client_secret}"
    encoded = base64.b64encode(creds_str.encode()).decode()
    return f"Basic {encoded}"


def get_opera_credentials(hotel_id: str) -> dict | None:
    """Fetch Opera credentials for a hotel. Returns None if not connected."""
    result = supabase.table("opera_credentials")\
        .select("*")\
        .eq("tenant_id", hotel_id)\
        .eq("is_connected", True)\
        .maybe_single()\
        .execute()
    return result.data if result else None


def get_valid_access_token(hotel_id: str) -> str | None:
    """Get a valid access token, refreshing if needed."""
    creds = get_opera_credentials(hotel_id)
    if not creds or not creds.get("access_token"):
        return None

    token_expires_at = creds.get("token_expires_at")
    if token_expires_at:
        try:
            expires = datetime.fromisoformat(token_expires_at.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            if now > expires - timedelta(minutes=2):
                return _refresh_token(hotel_id, creds)
        except (ValueError, TypeError):
            pass

    return creds.get("access_token")


def _refresh_token(hotel_id: str, creds: dict) -> str | None:
    """
    Re-authenticate using the OHIP token endpoint.
    OHIP uses password grant (SSD) or client_credentials (OCIM).
    Client ID/secret go in Basic auth header, NOT the request body.
    Endpoint: POST {gateway}/oauth/v1/tokens
    """
    ohip_base = creds.get("ohip_base_url") or settings.opera_oauth_base_url
    token_url = f"{ohip_base}/oauth/v1/tokens"

    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": _basic_auth_header(),
        "x-app-key": settings.opera_app_key,
    }
    if settings.opera_enterprise_id:
        headers["enterpriseId"] = settings.opera_enterprise_id

    # Prefer password grant (SSD) when integration credentials are stored;
    # fall back to client_credentials (OCIM) if no username is available.
    integration_user = creds.get("integration_username")
    integration_pass = creds.get("integration_password")

    if integration_user and integration_pass:
        data = {
            "grant_type": "password",
            "username": integration_user,
            "password": integration_pass,
        }
    else:
        data = {
            "grant_type": "client_credentials",
            "scope": "urn:opc:hgbu:ws:__myscopes__",
        }

    try:
        response = httpx.post(token_url, data=data, headers=headers, timeout=15.0)
        response.raise_for_status()
        tokens = response.json()

        new_access = tokens.get("access_token")
        expires_in = tokens.get("expires_in", 3600)
        now_utc = datetime.now(timezone.utc)

        supabase.table("opera_credentials").update({
            "access_token": new_access,
            "token_expires_at": (now_utc + timedelta(seconds=expires_in)).isoformat(),
            "updated_at": now_utc.isoformat(),
        }).eq("tenant_id", hotel_id).execute()

        return new_access
    except Exception:
        return creds.get("access_token")
