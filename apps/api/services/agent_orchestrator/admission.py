"""Planning-run admission for a VERIFIED user (``CurrentUser`` from ``get_current_user``). Not wired to any route in H3.

The request is a closed intent plus a work-order id; the database re-checks tenant ownership of the resource, the
paid-call switch, runtime controls, the ``ai_agents`` entitlement and the user's CURRENT role in the same transaction
that creates the run, its single ``model_planning`` step and its queue message. Production is refused here as well.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Optional

from middleware.auth import CurrentUser
from services.agent_harness.identity import context_from_verified_user
from services.agent_harness.policy import POLICY_VERSION
from services.agent_orchestrator import ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_VERSION
from services.agent_orchestrator.config import OrchestratorSettings, process_allows_orchestration
from services.agent_orchestrator.errors import OrchestratorError
from services.agent_orchestrator.orchestrator import intent_for
from services.agent_orchestrator.store import PlanningStore

_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class PlanningRefused(OrchestratorError):
    error_class = "authorization_denied"


@dataclass(frozen=True)
class PlanningAdmission:
    run_id: str
    created: bool
    state: str


def admit_planning_run(store: PlanningStore, user: CurrentUser, *, intent: str, intent_version: int, work_order_id: str,
                       idempotency_key: str, app_env: str, settings: OrchestratorSettings,
                       clock: Callable[[], datetime], correlation_id: Optional[str] = None,
                       deadline_seconds: int = 900) -> PlanningAdmission:
    if not isinstance(user, CurrentUser) or not user.hotel_id or not user.user_id:
        raise PlanningRefused("unauthenticated")
    if not process_allows_orchestration(app_env=app_env, settings=settings):
        raise PlanningRefused("orchestration_disabled")
    if not isinstance(idempotency_key, str) or not _KEY_RE.match(idempotency_key):
        raise PlanningRefused("invalid_idempotency_key")
    if not isinstance(work_order_id, str) or not _UUID_RE.match(work_order_id):
        raise PlanningRefused("invalid_resource")
    spec = intent_for(intent, intent_version)
    if user.role not in spec.initiator_roles:
        raise PlanningRefused("actor_not_authorized")
    ctx = context_from_verified_user(user, agent_id=ORCHESTRATOR_AGENT_ID, agent_version=ORCHESTRATOR_AGENT_VERSION,
                                     now=clock(), correlation_id=correlation_id)
    digest = hashlib.sha256(json.dumps({
        "tenant": ctx.hotel_id, "user": ctx.user_id, "intent": [spec.intent, spec.version],
        "resource": ["work_order", work_order_id]}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    result = store.admit(tenant_id=ctx.hotel_id, user_id=ctx.user_id, intent=spec.intent, intent_version=spec.version,
                         resource_type="work_order", resource_id=work_order_id, idempotency_key=idempotency_key,
                         request_digest=digest, correlation_id=ctx.correlation_id or f"plan:{idempotency_key}"[:100],
                         policy_version=POLICY_VERSION, deadline_seconds=deadline_seconds, max_attempts=3,
                         step_max_attempts=2)
    if not result.get("admitted"):
        raise PlanningRefused(str(result.get("reason") or "admission_refused")[:64])
    return PlanningAdmission(run_id=str(result["run_id"]), created=bool(result.get("created")),
                             state=str(result.get("state") or "queued"))
