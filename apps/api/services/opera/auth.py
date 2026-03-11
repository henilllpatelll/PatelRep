import httpx
from datetime import datetime, timedelta, timezone
from core.database import supabase
from core.config import settings


def get_opera_credentials(hotel_id: str) -> dict | None:
    """Fetch Opera credentials for a hotel. Returns None if not connected."""
    result = supabase.table("opera_credentials")\
        .select("*")\
        .eq("tenant_id", hotel_id)\
        .eq("is_connected", True)\
        .maybe_single()\
        .execute()
    return result.data


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
            if now > expires - timedelta(minutes=5):
                return _refresh_token(hotel_id, creds)
        except (ValueError, TypeError):
            pass

    return creds.get("access_token")


def _refresh_token(hotel_id: str, creds: dict) -> str | None:
    """Refresh OAuth token using refresh_token grant."""
    refresh_token = creds.get("refresh_token")
    if not refresh_token:
        return creds.get("access_token")

    ohip_base = creds.get("ohip_base_url") or settings.opera_oauth_base_url

    try:
        response = httpx.post(
            f"{ohip_base}/oauth/v1/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": settings.opera_oauth_client_id,
                "client_secret": settings.opera_oauth_client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15.0,
        )
        response.raise_for_status()
        tokens = response.json()

        new_access = tokens.get("access_token")
        expires_in = tokens.get("expires_in", 3600)

        supabase.table("opera_credentials").update({
            "access_token": new_access,
            "refresh_token": tokens.get("refresh_token", refresh_token),
            "token_expires_at": (datetime.utcnow() + timedelta(seconds=expires_in)).isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("tenant_id", hotel_id).execute()

        return new_access
    except Exception:
        # Fall back to existing token on refresh failure
        return creds.get("access_token")
