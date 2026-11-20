"""H7 P2 helpers: REAL human sessions against the isolated migrated Supabase (GoTrue + Kong + PostgREST + PostgreSQL).

People sign in with a password through GoTrue, so every access token below is minted by the real Auth server and names
a real ``auth.sessions`` row. Requests then travel Kong -> PostgREST -> PostgreSQL as the role ``authenticated`` (or
whatever role the token names). Nothing here mocks the database, PostgREST, GoTrue or the role.

``forge`` signs a token with the throwaway stack's JWT secret. It exists ONLY to prove what the database refuses even
when the signature is valid (missing / foreign / dead session, wrong claims) -- the same capability an attacker holding
the signing secret would have. Raw SQL (psql as postgres) is used only for fault injection PostgREST cannot express
(ending a session, banning a user, demoting a role) and for inspection.
"""
from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import httpx
import jwt
import pytest

from agent_execution_support import sql_value
from batch_support import new_client, run_sql
from core.config import settings

PROBE = "agent_verified_human_probe"
DECIDE_V2 = "agent_tool_approval_decide_v2"
SAFE_FAILURE_KEYS = {"ok", "reason", "operation"}


def _public_key() -> str:
    key = os.getenv("ANON_KEY", "") or os.getenv("PUBLISHABLE_KEY", "")
    if not key:
        pytest.fail("verified-identity tests need the isolated stack's ANON_KEY (supabase status --output env)")
    return key


def _stack_secret() -> str:
    secret = os.getenv("JWT_SECRET", "")
    if not secret:
        pytest.fail("verified-identity tests need the isolated stack's JWT_SECRET (supabase status --output env)")
    return secret


def _base() -> str:
    return settings.supabase_project_url.rstrip("/")


@dataclass
class Person:
    user_id: str
    email: str
    password: str


def create_person(tenant_id: Optional[str], role: Optional[str], *, label: str = "p") -> Person:
    """An Auth user with a known password; a profile in ``tenant_id`` and one active ``role`` there (when given)."""
    db = new_client()
    email = f"h7p2-{label}-{uuid.uuid4().hex[:12]}@verified-identity.example"
    password = f"Pw-{uuid.uuid4().hex}-1a"
    created = db.auth.admin.create_user({"email": email, "password": password, "email_confirm": True})
    user_id = created.user.id
    if tenant_id is not None:
        db.table("user_profiles").insert({"id": user_id, "tenant_id": tenant_id, "full_name": f"H7P2 {label}"}).execute()
        if role is not None:
            db.table("user_roles").insert({"user_id": user_id, "tenant_id": tenant_id, "role": role}).execute()
    return Person(user_id=user_id, email=email, password=password)


def sign_in(person: Person) -> dict:
    """A real GoTrue password sign-in: returns the session JSON (access_token, refresh_token, ...)."""
    response = httpx.post(f"{_base()}/auth/v1/token?grant_type=password", timeout=30,
                          headers={"apikey": _public_key(), "Content-Type": "application/json"},
                          json={"email": person.email, "password": person.password})
    assert response.status_code == 200, response.status_code
    return response.json()


def refresh(session: dict) -> dict:
    response = httpx.post(f"{_base()}/auth/v1/token?grant_type=refresh_token", timeout=30,
                          headers={"apikey": _public_key(), "Content-Type": "application/json"},
                          json={"refresh_token": session["refresh_token"]})
    assert response.status_code == 200, response.status_code
    return response.json()


def sign_out(access_token: str, *, scope: str = "local") -> None:
    """GoTrue sign-out: deletes this session (local) or every session of the user (global)."""
    response = httpx.post(f"{_base()}/auth/v1/logout?scope={scope}", timeout=30,
                          headers={"apikey": _public_key(), "Authorization": f"Bearer {access_token}"})
    assert response.status_code in (200, 204), response.status_code


def update_own_metadata(access_token: str, data: dict) -> None:
    """The user edits their OWN user_metadata (anything a user can set must never become authority)."""
    response = httpx.put(f"{_base()}/auth/v1/user", timeout=30,
                         headers={"apikey": _public_key(), "Authorization": f"Bearer {access_token}",
                                  "Content-Type": "application/json"},
                         json={"data": data})
    assert response.status_code == 200, response.status_code


def claims_of(access_token: str) -> dict:
    return jwt.decode(access_token, options={"verify_signature": False})


def forge(claims: dict) -> str:
    """Sign arbitrary claims with the stack secret (see module docstring: refusal tests only)."""
    return jwt.encode(claims, _stack_secret(), algorithm="HS256")


def forged_human(sub: str, *, session_id: Optional[str], **extra: Any) -> str:
    now = int(time.time())
    claims = {"aud": "authenticated", "role": "authenticated", "sub": sub, "iat": now, "exp": now + 600,
              "aal": "aal1", "is_anonymous": False}
    if session_id is not None:
        claims["session_id"] = session_id
    claims.update(extra)
    return forge({k: v for k, v in claims.items() if v is not ...})


def rpc(name: str, params: dict, *, token: Optional[str], api_key: Optional[str] = None) -> tuple[int, Any]:
    """POST /rest/v1/rpc/<name> through Kong + PostgREST. ``token=None`` sends no Authorization header."""
    headers = {"apikey": api_key or _public_key(), "Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    response = httpx.post(f"{_base()}/rest/v1/rpc/{name}", headers=headers, json=params, timeout=30)
    try:
        body = response.json()
    except ValueError:
        body = response.text
    return response.status_code, body


def probe(token: Optional[str], operation: str = "control_center_gm", **kw: Any) -> tuple[int, Any]:
    return rpc(PROBE, {"p_operation": operation}, token=token, **kw)


def refused(status: int, body: Any) -> bool:
    """Refused by PostgREST/PostgreSQL privileges (no EXECUTE, bad token) or by the database identity check."""
    if status == 200:
        return isinstance(body, dict) and body.get("ok") is False
    return status in (401, 403, 404)


def reason(status: int, body: Any) -> Optional[str]:
    return body.get("reason") if status == 200 and isinstance(body, dict) else None


def session_row_count(session_id: str) -> int:
    return int(sql_value(f"SELECT count(*) FROM auth.sessions WHERE id = '{session_id}';"))


def end_session_in_database(session_id: str) -> None:
    run_sql(f"UPDATE auth.sessions SET not_after = now() - interval '1 second' WHERE id = '{session_id}';")


def ban(user_id: str) -> None:
    run_sql(f"UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = '{user_id}';")


def make_tenant(label: str = "h7p2", *, control_center: bool = True) -> str:
    db = new_client()
    suffix = uuid.uuid4().hex[:10]
    tenant_id = db.table("tenants").insert({"name": f"H7P2 {label} {suffix}", "slug": f"h7p2-{label}-{suffix}"}).execute().data[0]["id"]
    if control_center:
        db.table("tenant_feature_flags").insert({"tenant_id": tenant_id, "feature_key": "ai_control_center",
                                                 "enabled": True, "updated_by": "it"}).execute()
    return tenant_id


def agent_row_counts() -> str:
    """A fingerprint of every table a decision or control could touch (used to prove the probe mutates nothing)."""
    return sql_value(
        "SELECT concat_ws('|', (SELECT count(*) FROM public.agent_tool_approvals),"
        " (SELECT count(*) FROM public.agent_tool_events), (SELECT count(*) FROM public.agent_control_center_events),"
        " (SELECT count(*) FROM public.agent_tool_grants), (SELECT count(*) FROM public.agent_runtime_controls),"
        " (SELECT count(*) FROM public.agent_runs), (SELECT count(*) FROM public.agent_run_events),"
        " (SELECT count(*) FROM public.user_roles), (SELECT count(*) FROM auth.sessions),"
        " (SELECT coalesce(max(updated_at)::text, '-') FROM public.agent_tool_approvals));")


class V2Granted:
    """TEST-ONLY activation of the inactive v2 decision in the THROWAWAY database (never in a migration or workflow).

    262 ships agent_tool_approval_decide_v2 with no grant; to exercise its logic over real PostgREST the fixture grants
    EXECUTE to authenticated and always revokes it again (the contract asserts it is ungranted).
    """

    def __enter__(self) -> "V2Granted":
        run_sql("GRANT EXECUTE ON FUNCTION public.agent_tool_approval_decide_v2(uuid, text, text) TO authenticated; "
                "NOTIFY pgrst, 'reload schema';")
        time.sleep(1.0)
        return self

    def __exit__(self, *exc: Any) -> None:
        run_sql("REVOKE EXECUTE ON FUNCTION public.agent_tool_approval_decide_v2(uuid, text, text) FROM authenticated; "
                "NOTIFY pgrst, 'reload schema';")
        time.sleep(1.0)
