"""H6 helpers: a REAL agent_worker credential against the isolated migrated Supabase (PostgREST + Kong + PostgreSQL).

The token is registered through the operator RPC with the service-role client (exactly as the runbook does) and signed
with the throwaway stack's JWT secret, which `supabase status --output env` exports as JWT_SECRET (CI exports it to the
job environment; locally source the stack's env). Requests then run as the PostgreSQL role agent_worker -- nothing in
these helpers mocks the database, PostgREST or the role.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import pytest
from postgrest.exceptions import APIError

from agent_execution_support import now
from batch_support import new_client
from core.config import settings
from services.agent_execution.config import WorkerSettings
from services.agent_execution.identity_authority import SupabaseIdentityAuthority
from services.agent_execution.store import AgentRunStore
from services.agent_execution.worker import Worker
from services.agent_execution.worker_credentials import issue, mint_worker_token
from services.agent_execution.worker_identity import RestrictedWorkerClient, WorkerDatabaseSettings, build_worker_client
from services.agent_gateway.authorization import GatewaySettings


def stack_secret() -> str:
    secret = os.getenv("JWT_SECRET", "")
    if not secret:
        pytest.fail("restricted-identity tests need the isolated stack's JWT_SECRET (supabase status --output env)")
    return secret


def stack_public_key() -> str:
    key = os.getenv("ANON_KEY", "") or os.getenv("PUBLISHABLE_KEY", "")
    if not key:
        pytest.fail("restricted-identity tests need the isolated stack's ANON_KEY (supabase status --output env)")
    return key


def worker_settings_for(token: str) -> WorkerDatabaseSettings:
    return WorkerDatabaseSettings(url=settings.supabase_project_url, api_key=stack_public_key(), token=token)


def issue_token(label: str = "it-worker") -> tuple[str, str]:
    """Register + mint through the operator path. Returns (credential_id, token)."""
    issued = issue(new_client(), label=label, days=1, operator="it-operator", app_env="test", secret=stack_secret())
    assert issued["ok"], issued
    return issued["id"], issued["token"]


def worker_client(token: Optional[str] = None) -> RestrictedWorkerClient:
    return build_worker_client(worker_settings_for(token or issue_token()[1]))


def raw_worker_client(token: Optional[str] = None) -> Any:
    """The SDK client UNDER the restricted wrapper: lets a test bypass the in-process allowlist and prove the DATABASE
    refuses (the wrapper would refuse first otherwise)."""
    return worker_client(token)._inner  # noqa: SLF001 - deliberate, test-only


def unregistered_token(*, role: str = "agent_worker", hours: int = 1) -> str:
    issued_at = datetime.now(timezone.utc).replace(microsecond=0)
    if role == "agent_worker" and hours <= 24 * 31:
        return mint_worker_token(jti=str(uuid.uuid4()), issued_at=issued_at, expires_at=issued_at + timedelta(hours=hours),
                                 secret=stack_secret())
    import jwt

    return jwt.encode({"role": role, "jti": str(uuid.uuid4()), "iat": int(issued_at.timestamp()),
                       "exp": int((issued_at + timedelta(hours=hours)).timestamp())}, stack_secret(), algorithm="HS256")


def revoke(credential_id: str) -> dict:
    return new_client().rpc("agent_worker_credential_revoke", {"p_id": credential_id, "p_revoked_by": "it-operator",
                                                               "p_reason": "integration_test"}).execute().data


def denied(call) -> str:
    """Run a PostgREST call that must be refused by PostgreSQL; return the SQLSTATE."""
    with pytest.raises(APIError) as err:
        call()
    return str(err.value.code or "")


def restricted_worker(worker_id: str, *, synthetic: bool = False, gateway: bool = False, lease_seconds: int = 10,
                      token: Optional[str] = None) -> tuple[Worker, AgentRunStore]:
    token = token or issue_token(f"it-{worker_id}")[1]
    restricted_store = AgentRunStore(worker_client(token))
    cfg = WorkerSettings(enabled=True, synthetic_enabled=synthetic, worker_id=worker_id, lease_seconds=lease_seconds,
                         blocked_retry_seconds=1)
    w = Worker(cfg, app_env="test", version="it-h6",
               store_factory=lambda: AgentRunStore(worker_client(token)),
               authority_factory=lambda client: SupabaseIdentityAuthority(client, clock=now), clock=now,
               gateway_settings=GatewaySettings(execution_enabled=True) if gateway else None,
               write_notifier=lambda *_: None)
    return w, restricted_store


def restricted_process(w: Worker, s: AgentRunStore) -> str:
    return w.process_one(s, SupabaseIdentityAuthority(s.client, clock=now))
