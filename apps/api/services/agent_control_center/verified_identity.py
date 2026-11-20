"""H7 P2: forward a human's OWN access token to the database-verified identity boundary (migration 262).

Why: the existing Control Center and H2 approval paths call SECURITY INVOKER RPCs as ``service_role`` and pass the actor
id as an argument; the database re-reads that person's role but cannot know the id came from a verified JWT
(GHSA-frh4). Migration 262 lets PostgreSQL derive the human itself from the PostgREST-verified token
(``auth.uid()`` + a live ``auth.sessions`` row + current membership). For that the API must send the user's bearer token
-- never the service-role key -- to exactly one reviewed RPC.

What this module is (and is not):
  * The ONLY place that forwards a human token. It calls only ``agent_verified_human_probe`` (non-mutating). The v2
    approval decision exists in the database but is ungranted; wiring it here needs a separate, explicit activation.
  * Disabled by default (``AGENT_VERIFIED_HUMAN_ENABLED``); not mounted on any route. The existing service-role paths are
    unchanged and remain the active ones.
  * The token is held in ``HumanAccessToken`` (redacted ``repr``/``str``), sent only in the Authorization header of one
    request, and never logged, persisted, cached or included in an exception or result. The ``apikey`` must be the
    PUBLIC anon/publishable key; a service-role or secret key is refused (that would silently re-introduce the
    privileged path this exists to remove).
  * The target is bound to the EXACT origin of the API's own Supabase project (``settings.supabase_project_url``):
    same scheme, host and effective port, no userinfo / path / query / fragment, http only for loopback. Anything else
    is refused before a request exists. Redirects are not followed and a 3xx is refused.
"""
from __future__ import annotations

import base64
import json
from typing import Any, Mapping, Optional

import httpx
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

PROBE_RPC = "agent_verified_human_probe"
OPERATIONS = frozenset({"control_center_gm", "tool_approval_review"})
_RESULT_KEYS = ("ok", "reason", "operation", "role", "hotel_id", "verified_by", "step_up")
_REASON_CHARS = frozenset("abcdefghijklmnopqrstuvwxyz0123456789_")


class VerifiedIdentityError(Exception):
    """A stable reason code only. Never carries a token, header, URL or response body."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class HumanAccessToken:
    """The caller's own Supabase access token. Opaque: it can be forwarded, never printed."""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        if not isinstance(value, str) or value.count(".") != 2 or len(value) > 8192 or any(c.isspace() for c in value):
            raise VerifiedIdentityError("token_malformed")
        self._value = value

    def authorization_header(self) -> str:
        return f"Bearer {self._value}"

    def __repr__(self) -> str:
        return "HumanAccessToken(<redacted>)"

    __str__ = __repr__

    def __reduce__(self):  # never pickled into a cache, queue or log record
        raise TypeError("HumanAccessToken cannot be serialized")


class VerifiedIdentitySettings(BaseSettings):
    """``AGENT_VERIFIED_HUMAN_*``. Off unless explicitly enabled; never falls back to the API's service-role key."""

    model_config = SettingsConfigDict(env_prefix="AGENT_VERIFIED_HUMAN_", extra="ignore")

    enabled: bool = False
    url: str = ""
    public_api_key: SecretStr = SecretStr("")
    http_timeout_seconds: float = Field(default=10.0, ge=1, le=60)


def _jwt_role(key: str) -> Optional[str]:
    parts = key.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except (ValueError, json.JSONDecodeError):
        return "unreadable"
    return payload.get("role") if isinstance(payload, dict) else "unreadable"


def refuse_privileged_api_key(api_key: str) -> None:
    key = (api_key or "").strip()
    if not key:
        raise VerifiedIdentityError("public_api_key_missing")
    if key.startswith("sb_secret_"):
        raise VerifiedIdentityError("public_api_key_privileged")
    role = _jwt_role(key)
    if role is not None and role != "anon":
        raise VerifiedIdentityError("public_api_key_privileged")


def _sanitize(body: Any, operation: str) -> dict:
    if not isinstance(body, Mapping) or not isinstance(body.get("ok"), bool):
        raise VerifiedIdentityError("identity_response_invalid")
    result = {k: body[k] for k in _RESULT_KEYS if k in body}
    reason = result.get("reason")
    if reason is not None and (not isinstance(reason, str) or not set(reason) <= _REASON_CHARS or len(reason) > 64):
        raise VerifiedIdentityError("identity_response_invalid")
    if result["ok"] and (result.get("operation") != operation or result.get("verified_by") != "database"):
        raise VerifiedIdentityError("identity_response_invalid")
    return result


_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
_DEFAULT_PORTS = {"https": 443, "http": 80}


def _origin(url: str) -> tuple[str, str, int]:
    """(scheme, host, effective port) of a bare project origin, or VerifiedIdentityError.

    Only a bare origin is accepted: no userinfo, path (other than "/"), params, query or fragment, so a configured value
    can never smuggle a different target ("https://proj.supabase.co@evil", "https://evil/?x=proj.supabase.co", ...).
    Plain http is accepted only for a loopback host (local / CI stacks)."""
    from urllib.parse import urlsplit

    if not isinstance(url, str) or not url or url != url.strip() or any(c.isspace() or ord(c) < 32 for c in url):
        raise VerifiedIdentityError("identity_url_invalid")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise VerifiedIdentityError("identity_url_invalid") from None
    host = (parts.hostname or "").lower()
    if (parts.scheme not in _DEFAULT_PORTS or not host or parts.username is not None or parts.password is not None
            or parts.path not in ("", "/") or parts.query or parts.fragment or ";" in parts.netloc
            or host.endswith(".") or "\\" in url):
        raise VerifiedIdentityError("identity_url_invalid")
    if parts.scheme == "http" and host not in _LOOPBACK_HOSTS:
        raise VerifiedIdentityError("identity_url_invalid")
    return parts.scheme, host, port if port is not None else _DEFAULT_PORTS[parts.scheme]


def approved_target(configured_url: str, approved_project_url: str) -> str:
    """The forwarding base URL, only if it is EXACTLY the approved Supabase project origin; else refuse.

    ``approved_project_url`` is the API's own configured project (``settings.supabase_project_url``) -- the same project
    PostgREST verifies the human's token for. A human token is never sent anywhere else."""
    approved = _origin(approved_project_url)
    if _origin(configured_url) != approved:
        raise VerifiedIdentityError("identity_url_not_approved")
    scheme, host, port = approved
    netloc = f"[{host}]" if ":" in host else host
    return f"{scheme}://{netloc}" + ("" if port == _DEFAULT_PORTS[scheme] else f":{port}")


def _approved_project_url() -> str:
    from core.config import settings as app_settings  # local: the pure contract tests pass an explicit URL

    return app_settings.supabase_project_url


def probe(settings: VerifiedIdentitySettings, token: HumanAccessToken, operation: str, *,
          approved_project_url: Optional[str] = None, transport: Optional[httpx.BaseTransport] = None) -> dict:
    """Ask the DATABASE who this token's human is, for one operation. Mutates nothing.

    Returns ``{"ok": True, "role", "hotel_id", ...}`` or ``{"ok": False, "reason": <stable code>}``. Raises
    ``VerifiedIdentityError`` (code only) when the path is disabled, misconfigured, points anywhere but the approved
    project, or is unavailable. Redirects are never followed and any 3xx is refused.
    """
    if not settings.enabled:
        raise VerifiedIdentityError("verified_identity_disabled")
    if operation not in OPERATIONS:
        raise VerifiedIdentityError("invalid_operation")
    if not isinstance(token, HumanAccessToken):
        raise VerifiedIdentityError("token_malformed")
    base = approved_target(settings.url, approved_project_url if approved_project_url is not None
                           else _approved_project_url())
    api_key = settings.public_api_key.get_secret_value().strip()
    refuse_privileged_api_key(api_key)
    try:
        with httpx.Client(timeout=settings.http_timeout_seconds, transport=transport, follow_redirects=False) as client:
            response = client.post(f"{base}/rest/v1/rpc/{PROBE_RPC}", json={"p_operation": operation},
                                   headers={"apikey": api_key, "Authorization": token.authorization_header(),
                                            "Content-Type": "application/json", "Accept": "application/json"})
    except httpx.HTTPError:
        raise VerifiedIdentityError("identity_unavailable") from None
    if 300 <= response.status_code < 400:
        raise VerifiedIdentityError("identity_redirect_refused")
    if response.status_code in (401, 403):
        return {"ok": False, "reason": "not_authenticated"}
    if response.status_code != 200:
        raise VerifiedIdentityError("identity_unavailable")
    try:
        body = response.json()
    except ValueError:
        raise VerifiedIdentityError("identity_response_invalid") from None
    return _sanitize(body, operation)


def bearer_from_header(authorization: Optional[str]) -> HumanAccessToken:
    """Extract the caller's token from an ``Authorization: Bearer`` value (after the API verified it)."""
    if not isinstance(authorization, str) or not authorization.startswith("Bearer "):
        raise VerifiedIdentityError("token_missing")
    return HumanAccessToken(authorization[len("Bearer "):].strip())
