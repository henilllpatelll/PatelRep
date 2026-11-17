"""Operator lifecycle of the worker's database credential (H6, migration 255). Runbook: docs/agent-harness/worker-identity.md.

  worker-credential-issue  --label L --days N --operator O   register a new jti, then print ONE agent_worker token
  worker-credential-revoke --id J --operator O --reason R    revoke immediately (next request is refused)
  worker-credential-list                                     metadata only (never a token)

Issuing runs on a trusted operator machine with the API's service-role key (to register the jti) and the project JWT
secret (to sign). The worker never holds either. Production issuance is refused in H6: no production worker may run.
Rotation = issue a new credential, deploy it to the worker's secret store, confirm liveness, revoke the old one.
"""
from __future__ import annotations

import argparse
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from services.agent_execution.worker_identity import MAX_TOKEN_LIFETIME_SECONDS, WORKER_DB_ROLE

_LABEL_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")
_OPERATOR_RE = re.compile(r"^[A-Za-z0-9._:@-]{1,100}$")
_REASON_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
TOKEN_ISSUER = "patelrep-agent-worker"


def mint_worker_token(*, jti: str, issued_at: datetime, expires_at: datetime, secret: str) -> str:
    """HS256 token whose only authority is the agent_worker role. No sub, hotel, user role or metadata claims."""
    import jwt

    if not secret or len(secret) < 32:
        raise ValueError("jwt_secret_missing")
    lifetime = int((expires_at - issued_at).total_seconds())
    if lifetime <= 0 or lifetime > MAX_TOKEN_LIFETIME_SECONDS:
        raise ValueError("lifetime_out_of_range")
    claims = {"role": WORKER_DB_ROLE, "jti": jti, "iss": TOKEN_ISSUER,
              "iat": int(issued_at.timestamp()), "exp": int(expires_at.timestamp())}
    return jwt.encode(claims, secret, algorithm="HS256")


def issue(client: Any, *, label: str, days: int, operator: str, app_env: str, secret: str,
          now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> dict:
    if app_env == "production":
        return {"ok": False, "reason": "production_refused"}
    if not _LABEL_RE.match(label or "") or not _OPERATOR_RE.match(operator or "") or not 1 <= days <= 31:
        return {"ok": False, "reason": "invalid_arguments"}
    issued_at = now().replace(microsecond=0)
    # A little under the database maximum so clock skew between operator and database never trips the CHECK.
    expires_at = min(issued_at + timedelta(days=days), issued_at + timedelta(days=31) - timedelta(minutes=5))
    jti = str(uuid.uuid4())
    registered = client.rpc("agent_worker_credential_register", {
        "p_id": jti, "p_label": label, "p_app_env": app_env, "p_expires_at": expires_at.isoformat(),
        "p_issued_by": operator}).execute().data or {}
    if not registered.get("ok"):
        return {"ok": False, "reason": str(registered.get("reason") or "register_failed")}
    token = mint_worker_token(jti=jti, issued_at=issued_at, expires_at=expires_at, secret=secret)
    return {"ok": True, "id": jti, "expires_at": expires_at.isoformat(), "token": token,
            "note": "store the token directly in the worker's secret store as AGENT_WORKER_DB_TOKEN; it is shown once"}


def revoke(client: Any, *, credential_id: str, operator: str, reason: str) -> dict:
    try:
        credential_id = str(uuid.UUID(credential_id))
    except (TypeError, ValueError):
        return {"ok": False, "reason": "invalid_arguments"}
    if not _OPERATOR_RE.match(operator or "") or not _REASON_RE.match(reason or ""):
        return {"ok": False, "reason": "invalid_arguments"}
    return client.rpc("agent_worker_credential_revoke", {"p_id": credential_id, "p_revoked_by": operator,
                                                         "p_reason": reason}).execute().data or {}


def add_credential_commands(sub: Any, *, store: Callable[[], Any]) -> None:
    def cmd_issue(args: argparse.Namespace) -> int:
        from core.config import settings  # operator path: service-role registration + the project JWT secret

        print(json.dumps(issue(store().client, label=args.label, days=args.days, operator=args.operator,
                               app_env=settings.app_env, secret=settings.supabase_jwt_secret)))
        return 0

    def cmd_revoke(args: argparse.Namespace) -> int:
        print(json.dumps(revoke(store().client, credential_id=args.id, operator=args.operator, reason=args.reason)))
        return 0

    def cmd_list(args: argparse.Namespace) -> int:
        rows = store().client.rpc("agent_worker_credentials_list", {"p_limit": args.limit}).execute().data or []
        print(json.dumps(rows, indent=2, sort_keys=True, default=str))
        return 0

    p = sub.add_parser("worker-credential-issue")
    p.add_argument("--label", required=True)
    p.add_argument("--days", type=int, default=14)
    p.add_argument("--operator", required=True)
    p.set_defaults(func=cmd_issue)
    p = sub.add_parser("worker-credential-revoke")
    p.add_argument("--id", required=True)
    p.add_argument("--operator", required=True)
    p.add_argument("--reason", required=True)
    p.set_defaults(func=cmd_revoke)
    p = sub.add_parser("worker-credential-list")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_list)
