"""H6: the worker's own least-privileged database identity (migration 255, ADR-0005 §3).

The worker never holds the API's ``service_role`` key. It talks to PostgREST with:

  * ``apikey``        the project's public (anon / publishable) key, which grants nothing by itself, and
  * ``Authorization`` a short-lived JWT whose ``role`` claim is ``agent_worker`` and whose ``jti`` is registered in
                      ``agent_worker_credentials`` (max 31 days, revocable; minted by an operator, never by the worker).

PostgreSQL then runs every request as ``agent_worker``: it may EXECUTE only the ``agent_worker_rpc__*`` wrappers of
the reviewed RPCs below and SELECT only the reviewed columns. This module mirrors that contract in-process so a
call outside it fails before it leaves the worker (``rpc_not_allowed`` / ``table_not_allowed``); the database is the
authority either way. There is no fallback: if the restricted identity cannot be established, the worker refuses
to start.
"""
from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

WORKER_DB_ROLE = "agent_worker"
WORKER_RPC_PREFIX = "agent_worker_rpc__"

# Must equal public.agent__worker_allowed_rpcs() in migration 255 (pinned by tests/smoke/test_agent_worker_identity.py).
WORKER_RPCS: frozenset[str] = frozenset({
    # H1 fenced execution and recovery
    "agent_run_claim", "agent_run_heartbeat", "agent_step_complete", "agent_step_fail", "agent_run_acknowledge",
    "agent_runs_recover", "agent_worker_heartbeat", "agent_runtime_controls_snapshot",
    # H2/H5 gateway steps (never a decision, grant, enablement or control RPC)
    "agent_tool_authorization_snapshot", "agent_tool_step_context", "agent_tool_request_approval",
    "agent_tool_record_outcome", "agent_tool_execute_work_order_assign", "agent_tool_execute_room_assignment",
    "agent_tool_approvals_expire",
    # H3/H5 planning steps
    "agent_planning_step_context", "agent_planning_record_plan", "agent_planning_record_context",
    # H3/H4 accounting (through the H4 wrappers) and spend recovery
    "agent_billing_attempt_reserve", "agent_billing_attempt_dispatch", "agent_billing_attempt_release",
    "agent_billing_attempt_settle", "agent_model_attempts_recover",
})

# Must equal public.agent__worker_read_columns() in migration 255.
WORKER_READ_COLUMNS: Mapping[str, frozenset[str]] = {
    "tenants": frozenset({"id", "is_active", "timezone"}),
    "user_profiles": frozenset({"id", "tenant_id", "is_active"}),
    "user_roles": frozenset({"user_id", "tenant_id", "role", "is_active"}),
    "work_orders": frozenset({"id", "tenant_id", "work_order_number", "title", "status", "priority", "assigned_to",
                              "due_at", "room_id"}),
    "rooms": frozenset({"id", "tenant_id", "room_number", "floor", "building", "is_active"}),
    "room_status": frozenset({"room_id", "tenant_id", "status", "fo_status", "clean_type", "assigned_to", "dnd_flag",
                              "do_not_service", "dnd_retry_at", "updated_at"}),
    "room_assignments": frozenset({"id", "tenant_id", "room_id", "assigned_to", "assignment_date"}),
    "room_occupancy_discrepancies": frozenset({"id", "tenant_id", "room_id", "status"}),
}

MAX_TOKEN_LIFETIME_SECONDS = 31 * 24 * 3600
_URL_RE = re.compile(r"^https?://([A-Za-z0-9.-]{1,253})(?::[0-9]{1,5})?(?:/.*)?$")
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
# Claims that would make PostgREST or the API treat the token as a person or a hotel. A worker token carries none.
_FORBIDDEN_CLAIMS = frozenset({"sub", "hotel_id", "user_role", "app_metadata", "user_metadata", "email", "aal"})
_SERVICE_ROLE_ENV = ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "AGENT_WORKER_DB_SERVICE_ROLE_KEY")


class WorkerIdentityError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class WorkerDatabaseSettings(BaseSettings):
    """``AGENT_WORKER_DB_*``. Read only when the worker is enabled; never falls back to the API settings."""

    model_config = SettingsConfigDict(env_prefix="AGENT_WORKER_DB_", extra="ignore")

    url: str = ""
    api_key: SecretStr = SecretStr("")  # the PUBLIC anon/publishable key; refused if it is a privileged key
    token: SecretStr = SecretStr("")    # the registered agent_worker JWT
    http_timeout_seconds: float = Field(default=30.0, ge=1, le=120)

    @property
    def project_url(self) -> str:
        url = self.url.strip().rstrip("/")
        return url[: -len("/rest/v1")] if url.endswith("/rest/v1") else url

    @property
    def host(self) -> str:
        match = _URL_RE.match(self.project_url)
        return match.group(1).lower() if match else ""


def _jwt_claims(token: str) -> Optional[dict]:
    """Claims of a JWT-shaped string WITHOUT verifying it (the worker never holds the signing secret; PostgREST
    verifies). Used only to refuse obviously wrong credentials before any request is made."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, UnicodeError):
        return None
    return claims if isinstance(claims, dict) else None


def inspect_worker_token(token: str, *, now: datetime) -> dict:
    """Structural checks on the worker token. Signature, expiry and registration are enforced by PostgREST and the
    database; this only refuses a token that could never be a valid, least-privileged worker credential."""
    claims = _jwt_claims(token or "")
    if claims is None:
        raise WorkerIdentityError("worker_token_malformed")
    if claims.get("role") != WORKER_DB_ROLE:
        raise WorkerIdentityError("worker_token_wrong_role")
    if not isinstance(claims.get("jti"), str) or not _UUID_RE.match(claims["jti"]):
        raise WorkerIdentityError("worker_token_missing_jti")
    if _FORBIDDEN_CLAIMS & claims.keys():
        raise WorkerIdentityError("worker_token_carries_user_claims")
    exp, iat = claims.get("exp"), claims.get("iat")
    if not isinstance(exp, int) or not isinstance(iat, int):
        raise WorkerIdentityError("worker_token_missing_lifetime")
    if exp - iat > MAX_TOKEN_LIFETIME_SECONDS or exp <= iat:
        raise WorkerIdentityError("worker_token_lifetime_too_long")
    if exp <= int(now.timestamp()):
        raise WorkerIdentityError("worker_token_expired")
    return claims


def refuse_privileged_api_key(api_key: str) -> None:
    """The apikey must be the public key. A service-role/secret key here would be an implicit escalation."""
    key = (api_key or "").strip()
    if not key:
        raise WorkerIdentityError("worker_api_key_missing")
    if key.startswith("sb_secret_"):
        raise WorkerIdentityError("worker_api_key_privileged")
    claims = _jwt_claims(key)
    if claims is not None and claims.get("role") not in ("anon",):
        raise WorkerIdentityError("worker_api_key_privileged")


def refuse_service_role_environment(environ: Mapping[str, str]) -> None:
    """No implicit fallback: the worker process must not even be given the API's service-role credential."""
    for name in _SERVICE_ROLE_ENV:
        if (environ.get(name) or "").strip():
            raise WorkerIdentityError("service_role_credential_present")


def enforce_target(settings: WorkerDatabaseSettings, *, app_env: str, environ: Mapping[str, str]) -> None:
    """Same target guard as the API settings (core.config), without importing them: staging must point at the
    configured staging host and never at production."""
    if not settings.project_url.startswith(("https://", "http://")) or not settings.host:
        raise WorkerIdentityError("worker_db_url_invalid")
    production = (environ.get("PRODUCTION_SUPABASE_HOST") or "").strip().lower()
    if app_env == "staging":
        expected = (environ.get("STAGING_EXPECTED_SUPABASE_HOST") or "").strip().lower()
        if not expected or settings.host != expected or (production and settings.host == production):
            raise WorkerIdentityError("worker_db_target_not_staging")


class _ReadOnlyTable:
    """``client.table(name)`` for the worker: only ``select`` of reviewed columns. No insert/update/upsert/delete."""

    def __init__(self, inner: Any, name: str) -> None:
        self._inner, self._name = inner, name

    def select(self, columns: str, *args: Any, **kwargs: Any) -> Any:
        if args or kwargs:
            raise WorkerIdentityError("select_options_not_allowed")
        allowed = WORKER_READ_COLUMNS[self._name]
        for part in _top_level_columns(columns):
            if "(" in part:
                embedded, inner_cols = part.split("(", 1)
                embedded = embedded.strip()
                if embedded not in WORKER_READ_COLUMNS:
                    raise WorkerIdentityError("table_not_allowed")
                for col in inner_cols.rstrip(")").split(","):
                    if col.strip() not in WORKER_READ_COLUMNS[embedded]:
                        raise WorkerIdentityError("column_not_allowed")
            elif part not in allowed:
                raise WorkerIdentityError("column_not_allowed")
        return self._inner.table(self._name).select(columns)


def _top_level_columns(columns: str) -> list[str]:
    parts, depth, current = [], 0, ""
    for ch in columns:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(current.strip())
            current = ""
        else:
            current += ch
    if current.strip():
        parts.append(current.strip())
    return parts


class RestrictedWorkerClient:
    """The only database client the worker process holds. Same ``rpc``/``table`` surface the H1-H5 stores use."""

    restricted = True

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def rpc(self, name: str, params: Optional[dict] = None) -> Any:
        if name not in WORKER_RPCS:
            raise WorkerIdentityError("rpc_not_allowed")
        return self._inner.rpc(WORKER_RPC_PREFIX + name, params or {})

    def table(self, name: str) -> _ReadOnlyTable:
        if name not in WORKER_READ_COLUMNS:
            raise WorkerIdentityError("table_not_allowed")
        return _ReadOnlyTable(self._inner, name)

    def __getattr__(self, item: str) -> Any:  # storage, auth, functions, postgrest, schema, from_ ...: none exist here
        raise AttributeError(f"client_surface_not_allowed: {item}")


def build_worker_client(settings: WorkerDatabaseSettings, *, now: Optional[datetime] = None) -> RestrictedWorkerClient:
    """Validate the credential pair and build the restricted client. Raises ``WorkerIdentityError`` on any doubt."""
    from supabase import create_client  # local: keeps this module importable without the SDK in pure unit tests

    try:
        from supabase.lib.client_options import SyncClientOptions
    except ImportError:  # supabase-py < 2.31
        from supabase.lib.client_options import ClientOptions as SyncClientOptions

    token = settings.token.get_secret_value().strip()
    api_key = settings.api_key.get_secret_value().strip()
    inspect_worker_token(token, now=now or datetime.now(timezone.utc))
    refuse_privileged_api_key(api_key)
    options = SyncClientOptions(auto_refresh_token=False, persist_session=False,
                                postgrest_client_timeout=settings.http_timeout_seconds,
                                headers={"Authorization": f"Bearer {token}"})
    if hasattr(options, "postgrest_client_retry"):
        options.postgrest_client_retry = False
    return RestrictedWorkerClient(create_client(settings.project_url, api_key, options))
