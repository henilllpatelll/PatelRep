"""Thin RPC port for the Control Center (service-role API client). Every call passes the caller's hotel explicitly and
every function filters by it in SQL (migration 256), so a mistaken id from another hotel reads as "not found"."""
from __future__ import annotations

from typing import Any, Optional

from services.agent_control_center.errors import ControlCenterRefused

# PostgREST "function not found / not in schema cache" and PostgreSQL "undefined function/table": the migration that
# defines the read model is missing or partially applied. Fail closed with a stable code, never a stack trace.
_MISSING_SCHEMA = frozenset({"PGRST202", "PGRST205", "42883", "42P01"})


class ControlCenterStore:
    def __init__(self, client: Any) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        return self._client

    def _rpc(self, name: str, params: dict) -> Any:
        try:
            return self._client.rpc(name, params).execute().data
        except Exception as exc:  # noqa: BLE001 - re-raised unless it is a missing-schema signal
            if str(getattr(exc, "code", "") or "") in _MISSING_SCHEMA:
                raise ControlCenterRefused("schema_unavailable") from None
            raise

    # ---- migration 256 read models ----------------------------------------------------------------------------
    def overview(self, tenant_id: str) -> dict:
        return self._rpc("agent_control_center_overview", {"p_tenant_id": tenant_id}) or {}

    def runs_page(self, tenant_id: str, *, states: Optional[list[str]], initiated_by: Optional[str],
                  before_created: Optional[str], before_id: Optional[str], limit: int) -> list[dict]:
        return self._rpc("agent_control_center_runs_page", {
            "p_tenant_id": tenant_id, "p_states": states, "p_initiated_by": initiated_by,
            "p_before_created": before_created, "p_before_id": before_id, "p_limit": limit}) or []

    def approvals_page(self, tenant_id: str, *, states: Optional[list[str]], initiated_by: Optional[str],
                       before_created: Optional[str], before_id: Optional[str], limit: int) -> list[dict]:
        return self._rpc("agent_control_center_approvals_page", {
            "p_tenant_id": tenant_id, "p_states": states, "p_initiated_by": initiated_by,
            "p_before_created": before_created, "p_before_id": before_id, "p_limit": limit}) or []

    def approval_facts(self, tenant_id: str, approval_id: str) -> Optional[dict]:
        return self._rpc("agent_control_center_approval_facts", {"p_tenant_id": tenant_id, "p_approval_id": approval_id})

    def grants(self, tenant_id: str) -> list[dict]:
        return self._rpc("agent_control_center_grants", {"p_tenant_id": tenant_id}) or []

    def events_page(self, tenant_id: str, *, before_id: Optional[int], limit: int,
                    event_types: Optional[list[str]]) -> list[dict]:
        return self._rpc("agent_control_center_events_page", {"p_tenant_id": tenant_id, "p_before_id": before_id,
                                                              "p_limit": limit, "p_event_types": event_types}) or []

    # ---- migration 256 audited controls (re-read current authority in SQL) ------------------------------------
    def hotel_pause_set(self, tenant_id: str, *, actor_user_id: str, paused: bool, reason_code: str) -> dict:
        return self._rpc("agent_control_center_hotel_pause_set", {
            "p_tenant_id": tenant_id, "p_actor_user_id": actor_user_id, "p_paused": paused,
            "p_reason_code": reason_code}) or {}

    def run_control(self, tenant_id: str, *, actor_user_id: str, run_id: str, action: str) -> dict:
        return self._rpc("agent_control_center_run_control", {
            "p_tenant_id": tenant_id, "p_actor_user_id": actor_user_id, "p_run_id": run_id, "p_action": action}) or {}

    def record_refusal(self, tenant_id: str, *, actor_user_id: Optional[str], reason_code: str, subject_type: str,
                       subject_ref: Optional[str]) -> None:
        self._rpc("agent_control_center_record_refusal", {
            "p_tenant_id": tenant_id, "p_actor_user_id": actor_user_id, "p_reason_code": reason_code,
            "p_subject_type": subject_type, "p_subject_ref": subject_ref})

    # ---- reused H1/H2 reads -----------------------------------------------------------------------------------
    def run_get(self, tenant_id: str, run_id: str) -> Optional[dict]:
        return self._rpc("agent_run_get", {"p_tenant_id": tenant_id, "p_run_id": run_id})

    def run_events(self, tenant_id: str, run_id: str, *, limit: int = 200) -> list[dict]:
        return self._rpc("agent_run_events_page", {"p_tenant_id": tenant_id, "p_run_id": run_id, "p_after_id": 0,
                                                   "p_limit": limit}) or []

    def tool_events(self, tenant_id: str, run_id: str, *, limit: int = 200) -> list[dict]:
        return self._rpc("agent_tool_events_page", {"p_tenant_id": tenant_id, "p_run_id": run_id, "p_after_id": 0,
                                                    "p_limit": limit}) or []

    def grant_revoke(self, tenant_id: str, *, actor_user_id: str, agent_id: str, agent_version: int, tool_id: str,
                     tool_version: int) -> dict:
        """H2 ``agent_tool_grant_set`` with ``p_revoke = true`` only (GM authority re-read in SQL). There is no
        Control Center path that calls it with ``p_revoke = false``."""
        return self._rpc("agent_tool_grant_set", {
            "p_tenant_id": tenant_id, "p_actor_user_id": actor_user_id, "p_agent_id": agent_id,
            "p_agent_version": agent_version, "p_tool_id": tool_id, "p_tool_version": tool_version,
            "p_max_level": 0, "p_expires_at": None, "p_revoke": True}) or {}

    def names(self, tenant_id: str, user_ids: set[str]) -> dict[str, str]:
        ids = sorted(i for i in user_ids if i)
        if not ids:
            return {}
        rows = (self._client.table("user_profiles").select("id, full_name").eq("tenant_id", tenant_id)
                .in_("id", ids[:200]).limit(200).execute().data or [])
        return {str(r["id"]): str(r.get("full_name") or "") for r in rows if isinstance(r, dict)}
