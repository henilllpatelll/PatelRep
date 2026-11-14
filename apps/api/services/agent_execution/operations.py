"""Tenant-scoped run status and control requests for trusted backend callers.

The hotel comes from the verified ``CurrentUser`` (or an operator's explicit server-side choice), never from a request
body, and the database matches every run on (id, tenant_id), so another hotel's run id yields ``not_found``. A person
may control a run only if they are their hotel's GM or the run's initiator. H1 exposes NO HTTP route for any of this;
these functions are the internal interface H6 (AI Control Center) will call.
"""
from __future__ import annotations

from typing import Any, Optional

from middleware.auth import CurrentUser
from services.agent_execution.store import AgentRunStore

CONTROL_ROLES = frozenset({"gm"})


class RunNotFound(Exception):
    pass


class ControlNotAuthorized(Exception):
    pass


def _require_user(user: Any) -> CurrentUser:
    if not isinstance(user, CurrentUser) or not user.hotel_id or not user.user_id:
        raise ControlNotAuthorized("a verified user is required")
    return user


def get_run(store: AgentRunStore, user: CurrentUser, run_id: str) -> dict:
    user = _require_user(user)
    found = store.get_run(tenant_id=user.hotel_id, run_id=run_id)
    if not found:
        raise RunNotFound(run_id)
    run = found["run"]
    if user.role not in CONTROL_ROLES and run.get("initiated_by_user_id") != user.user_id:
        raise RunNotFound(run_id)  # do not reveal runs the caller may not see
    return found


def list_steps(store: AgentRunStore, user: CurrentUser, run_id: str) -> list[dict]:
    return get_run(store, user, run_id)["steps"]


def read_events(store: AgentRunStore, user: CurrentUser, run_id: str, *, after_id: int = 0,
                limit: int = 100) -> list[dict]:
    get_run(store, user, run_id)
    return store.events_page(tenant_id=user.hotel_id, run_id=run_id, after_id=after_id, limit=limit)


def _control(store: AgentRunStore, user: CurrentUser, run_id: str, action: str) -> dict:
    get_run(store, user, run_id)  # tenant + visibility check
    requested_by = f"user:{user.user_id}"
    if action == "cancel":
        return store.request_cancel(tenant_id=user.hotel_id, run_id=run_id, requested_by=requested_by)
    if action == "pause":
        return store.request_pause(tenant_id=user.hotel_id, run_id=run_id, requested_by=requested_by)
    return store.resume(tenant_id=user.hotel_id, run_id=run_id, requested_by=requested_by)


def request_cancel(store: AgentRunStore, user: CurrentUser, run_id: str) -> dict:
    return _control(store, user, run_id, "cancel")


def request_pause(store: AgentRunStore, user: CurrentUser, run_id: str) -> dict:
    return _control(store, user, run_id, "pause")


def request_resume(store: AgentRunStore, user: CurrentUser, run_id: str) -> dict:
    return _control(store, user, run_id, "resume")


def operator_control(store: AgentRunStore, *, tenant_id: str, run_id: str, action: str, operator: str,
                     ) -> Optional[dict]:
    """Runbook path (service credentials, explicit hotel). Same tenant-scoped RPCs; nothing broader."""
    requested_by = f"operator:{operator}"
    if action == "cancel":
        return store.request_cancel(tenant_id=tenant_id, run_id=run_id, requested_by=requested_by)
    if action == "pause":
        return store.request_pause(tenant_id=tenant_id, run_id=run_id, requested_by=requested_by)
    if action == "resume":
        return store.resume(tenant_id=tenant_id, run_id=run_id, requested_by=requested_by)
    raise ValueError("unknown action")
