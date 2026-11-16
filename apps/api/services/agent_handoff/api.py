"""The small surface the HTTP layer uses (routers/agent_specialists.py imports only this package).

``specialists_enabled`` is the HTTP visibility gate: the routes answer 404 unless BOTH process gates are open
(gateway execution and orchestration, each default off and refused in production). The database layers (execution and
paid-call switches, entitlement, grants, current role) still decide every individual request.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Optional

from middleware.auth import CurrentUser
from services.agent_gateway.authorization import GatewaySettings, process_allows_execution
from services.agent_handoff.handoff import HandoffRefused
from services.agent_orchestrator.admission import PlanningRefused, admit_planning_run
from services.agent_orchestrator.config import OrchestratorSettings, process_allows_orchestration
from services.agent_orchestrator.errors import OrchestratorError
from services.agent_orchestrator.intents import H5_INTENTS
from services.agent_orchestrator.store import PlanningStore

SPECIALIST_INTENTS = frozenset(H5_INTENTS)
VIEWER_ROLES = frozenset(role for spec in H5_INTENTS.values() for role in spec.initiator_roles)

_STATUS = {
    "not_found": 404, "gateway_disabled": 404, "orchestration_disabled": 404, "unauthenticated": 401,
    "not_initiator": 403, "not_authorized": 403, "actor_not_authorized": 403, "approver_not_authorized": 403,
    "self_approval_forbidden": 403, "tenant_capability_disabled": 403, "tool_not_granted": 403,
    "autonomy_insufficient": 403, "operational_permission_revoked": 403, "intent_not_allowed": 422,
    "invalid_resource": 422, "invalid_idempotency_key": 422, "invalid_reason_code": 422, "proposal_not_found": 404,
}


def gateway_settings() -> GatewaySettings:
    return GatewaySettings()


def specialists_enabled(app_env: str) -> bool:
    return process_allows_execution(app_env=app_env, settings=GatewaySettings()) and \
        process_allows_orchestration(app_env=app_env, settings=OrchestratorSettings())


def http_status(code: str) -> int:
    return _STATUS.get(code, 409)


def request_recommendation(client: Any, user: CurrentUser, *, intent: str, intent_version: int, resource_id: str,
                           idempotency_key: str, app_env: str, clock: Callable[[], datetime],
                           correlation_id: Optional[str] = None) -> dict:
    if (intent, intent_version) not in SPECIALIST_INTENTS:
        raise HandoffRefused("intent_not_allowed")
    try:
        admission = admit_planning_run(PlanningStore(client), user, intent=intent, intent_version=intent_version,
                                       resource_id=resource_id, idempotency_key=idempotency_key, app_env=app_env,
                                       settings=OrchestratorSettings(), clock=clock, correlation_id=correlation_id)
    except (PlanningRefused, OrchestratorError) as exc:
        raise HandoffRefused(getattr(exc, "code", None) or "admission_refused") from None
    return {"run_id": admission.run_id, "created": admission.created, "state": admission.state}
