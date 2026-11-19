"""H6: the worker's own least-privileged database identity (migration 255, ADR-0005 §3).

The worker never holds the API's ``service_role`` key. It talks to PostgREST with:

  * ``apikey``        the project's public (anon / publishable) key, which grants nothing by itself, and
  * ``Authorization`` a short-lived JWT whose ``role`` claim is ``agent_worker`` and whose ``jti`` is registered in
                      ``agent_worker_credentials`` (max 7 days since H6 P1, revocable; minted by an operator, never by the worker).

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

# Must equal public.agent__worker_tenant_columns() in migration 257.
WORKER_TENANT_COLUMNS: Mapping[str, str] = {name: ("id" if name == "tenants" else "tenant_id") for name in WORKER_READ_COLUMNS}

# H6 P1: hotel-scoped worker credentials live at most 7 days (migration 257 enforces the same ceiling in the database).
MAX_TOKEN_LIFETIME_SECONDS = 7 * 24 * 3600
_URL_RE = re.compile(r"^https?://([A-Za-z0-9.-]{1,253})(?::[0-9]{1,5})?(?:/.*)?$")
_WORKER_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")
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


LOCAL_DB_HOSTS = frozenset({"127.0.0.1", "localhost"})


def enforce_target(settings: WorkerDatabaseSettings, *, app_env: str, environ: Mapping[str, str]) -> None:
    """An allowlist, not a staging-only check (H6 P1). The worker may reach exactly one kind of database per APP_ENV:

      development / test   a loopback host only (it can never be the hosted production project);
      staging              exactly STAGING_EXPECTED_SUPABASE_HOST, which must be set and differ from
                           PRODUCTION_SUPABASE_HOST, which must also be set (otherwise "not production" is unprovable);
      production           always refused in H6 (no production worker exists).

    Any APP_ENV outside the four is refused, and the production host is refused under every APP_ENV. The database
    independently refuses a credential whose environment differs from its own stamped environment (migration 257).

    Transport (P1 review): the URL must be exactly ``scheme://host[:port]`` (an optional trailing ``/rest/v1`` is
    stripped first) with no userinfo, path, query or fragment and a strictly valid hostname. Staging is HTTPS only on
    the default port (none or 443). Plain HTTP is allowed only for development/test, and only to a loopback host."""
    scheme, host, port = _parse_target(settings)
    if app_env not in ("development", "test", "staging", "production"):
        raise WorkerIdentityError("app_env_invalid")
    production = _configured_host(environ, "PRODUCTION_SUPABASE_HOST")
    if production and host == production:
        raise WorkerIdentityError("worker_db_target_production")
    if app_env == "production":
        raise WorkerIdentityError("production_worker_refused")
    if app_env in ("development", "test"):
        if host not in LOCAL_DB_HOSTS:
            raise WorkerIdentityError("worker_db_target_not_local")
        return
    # staging
    if scheme != "https":
        raise WorkerIdentityError("worker_db_transport_insecure")
    if port not in (None, 443):
        raise WorkerIdentityError("worker_db_port_not_allowed")
    expected = _configured_host(environ, "STAGING_EXPECTED_SUPABASE_HOST")
    if not production:
        raise WorkerIdentityError("production_host_unknown")
    if not expected or expected == production or host != expected:
        raise WorkerIdentityError("worker_db_target_not_staging")


# One or more dot-separated DNS labels: 1-63 chars each, alphanumeric at both ends; no empty label (so no trailing dot).
_HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$")


# The whole target, after project_url strips trailing "/" and "/rest/v1": a lowercase http(s) scheme, a host, and an
# optional decimal port without leading zeros. Anything else (userinfo, path, query, fragment, whitespace) cannot match.
# A full-match regex on purpose: this package may not import urllib (tests/smoke/test_agent_execution_isolation.py).
_TARGET_RE = re.compile(r"(https|http)://([A-Za-z0-9.-]{1,253})(?::([1-9][0-9]{0,4}))?")


def _parse_target(settings: WorkerDatabaseSettings) -> tuple[str, str, Optional[int]]:
    """Strictly parse the worker's database URL. Any ambiguity (userinfo, path, query, fragment, bad port, odd
    characters, a disagreement with ``settings.host``) is ``worker_db_url_invalid``."""
    match = _TARGET_RE.fullmatch(settings.project_url)
    if not match:
        raise WorkerIdentityError("worker_db_url_invalid")
    scheme, host = match.group(1), match.group(2).lower()
    port = int(match.group(3)) if match.group(3) else None
    if not _HOSTNAME_RE.fullmatch(host) or host != settings.host or (port is not None and port > 65535):
        raise WorkerIdentityError("worker_db_url_invalid")
    return scheme, host, port


def _configured_host(environ: Mapping[str, str], name: str) -> str:
    """A configured host variable must be a bare hostname; a URL or anything malformed is treated as unset (which
    refuses staging) rather than compared as an opaque string."""
    value = (environ.get(name) or "").strip().lower()
    return value if _HOSTNAME_RE.fullmatch(value) else ""


def bound_worker_id(tenant_id: str, worker_id: str) -> str:
    """The database accepts a worker heartbeat only under "<bound tenant>:<name>" (migration 257)."""
    prefix = f"{tenant_id}:"
    bound = worker_id if worker_id.startswith(prefix) else prefix + worker_id
    if not _WORKER_ID_RE.match(bound) or len(bound) <= len(prefix):
        raise WorkerIdentityError("worker_id_invalid")
    return bound


def verify_bound_identity(client: "RestrictedWorkerClient") -> str:
    """Startup proof that the credential is registered, active, bound to exactly one active hotel and matches the
    database's environment: through the RESTRICTIVE gate, ``tenants`` returns exactly the bound hotel, and nothing at all
    for any other credential state. Returns the bound tenant id and pins the client to it."""
    rows = client.table("tenants").select("id").execute().data or []
    ids = {str(row.get("id")) for row in rows if isinstance(row, dict) and row.get("id")}
    if len(rows) != 1 or len(ids) != 1 or not _UUID_RE.match(next(iter(ids))):
        raise WorkerIdentityError("worker_credential_not_bound")
    tenant_id = next(iter(ids)).lower()
    client.bind_tenant(tenant_id)
    return tenant_id


class _ReadOnlyTable:
    """``client.table(name)`` for the worker: only ``select`` of reviewed columns. No insert/update/upsert/delete."""

    def __init__(self, inner: Any, name: str, tenant_id: Optional[str] = None) -> None:
        self._inner, self._name, self._tenant_id = inner, name, tenant_id

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
        query = self._inner.table(self._name).select(columns)
        # Defence in depth over the database's RESTRICTIVE gate (migration 257): once the bound hotel is known, every
        # read is explicitly filtered to it.
        if self._tenant_id is not None:
            query = query.eq(WORKER_TENANT_COLUMNS[self._name], self._tenant_id)
        return query


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
        self._tenant_id: Optional[str] = None

    @property
    def tenant_id(self) -> Optional[str]:
        return self._tenant_id

    def bind_tenant(self, tenant_id: str) -> None:
        """Pin reads to the hotel the database derived from the credential. Never re-bound to another hotel."""
        if not _UUID_RE.match(tenant_id or ""):
            raise WorkerIdentityError("worker_tenant_invalid")
        tenant_id = tenant_id.lower()
        if self._tenant_id is not None and self._tenant_id != tenant_id:
            raise WorkerIdentityError("worker_tenant_rebind_refused")
        self._tenant_id = tenant_id

    def rpc(self, name: str, params: Optional[dict] = None) -> Any:
        if name not in WORKER_RPCS:
            raise WorkerIdentityError("rpc_not_allowed")
        return self._inner.rpc(WORKER_RPC_PREFIX + name, params or {})

    def table(self, name: str) -> _ReadOnlyTable:
        if name not in WORKER_READ_COLUMNS:
            raise WorkerIdentityError("table_not_allowed")
        return _ReadOnlyTable(self._inner, name, self._tenant_id)

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
