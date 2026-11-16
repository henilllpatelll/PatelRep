"""Agent Harness H5: Operations specialist recommendations (backend preview + human decisions). ADR-0004.

Hidden unless BOTH process gates are open (gateway execution + orchestration, default off, refused in production):
every route answers 404 otherwise, so no client can discover or offer an action the backend cannot perform.

Identity, hotel and role come only from the verified session. The database re-reads the person's CURRENT authority for
every decision; a role in a request body is never accepted (none of these bodies has a field for one).

  POST /agent-specialists/recommendations                         ask a specialist for ONE resource (queued run)
  GET  /agent-specialists/recommendations/{run_id}                verified facts + labelled AI recommendation
  POST /agent-specialists/recommendations/{run_id}/dismiss        reviewed; not acting on it (audit only)
  POST /agent-specialists/recommendations/{run_id}/proposals/{n}/submit   initiator hands ONE proposal to the gateway
  GET  /agent-specialists/handoffs/{handoff_id}                   lifecycle of a submitted proposal
  POST /agent-specialists/handoffs/{handoff_id}/approve|reject    a DIFFERENT authorized manager decides
  POST /agent-specialists/handoffs/{handoff_id}/withdraw          initiator withdraws before execution
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from core.config import settings
from core.database import supabase
from middleware.auth import CurrentUser, require_role
from services.agent_handoff import handoff as handoffs
from services.agent_handoff.api import gateway_settings, http_status, request_recommendation, specialists_enabled
from services.agent_handoff.handoff import HandoffRefused
from services.agent_handoff.preview import build_preview

router = APIRouter(prefix="/agent-specialists", tags=["agent-specialists"])
# The union of the H5 intents' initiator roles (pinned to services.agent_handoff.api.VIEWER_ROLES by a smoke test).
# Coarse gate only: every request is re-authorized per intent / per approval in the database.
SPECIALIST_VIEWER_ROLES = ("chief_engineer", "engineer", "gm", "housekeeping_supervisor")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _enabled() -> None:
    if not specialists_enabled(settings.app_env):
        raise HTTPException(status_code=404, detail={"code": "not_found"})


def _refused(exc: HandoffRefused) -> HTTPException:
    return HTTPException(status_code=http_status(exc.code), detail={"code": exc.code})


class RecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: StrictStr = Field(min_length=3, max_length=80)
    intent_version: StrictInt = Field(ge=1, le=999)
    resource_id: UUID
    idempotency_key: StrictStr = Field(pattern=r"^[A-Za-z0-9._:-]{8,128}$")


class SubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_digest: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason_code: Optional[StrictStr] = Field(default=None, pattern=r"^[a-z][a-z0-9_]{0,63}$")


@router.post("/recommendations", status_code=202)
async def request_specialist_recommendation(body: RecommendationRequest,
                                            current_user: CurrentUser = Depends(require_role(*SPECIALIST_VIEWER_ROLES))):
    _enabled()
    try:
        data = request_recommendation(supabase, current_user, intent=body.intent, intent_version=body.intent_version,
                                      resource_id=str(body.resource_id), idempotency_key=body.idempotency_key,
                                      app_env=settings.app_env, clock=_now)
    except HandoffRefused as exc:
        raise _refused(exc) from None
    return {"data": data}


@router.get("/recommendations/{run_id}")
async def get_specialist_recommendation(run_id: UUID, current_user: CurrentUser = Depends(require_role(*SPECIALIST_VIEWER_ROLES))):
    _enabled()
    try:
        return {"data": build_preview(supabase, current_user, str(run_id), clock=_now)}
    except HandoffRefused as exc:
        raise _refused(exc) from None


@router.post("/recommendations/{run_id}/dismiss")
async def dismiss_specialist_recommendation(run_id: UUID, body: DecisionRequest,
                                            current_user: CurrentUser = Depends(require_role(*SPECIALIST_VIEWER_ROLES))):
    _enabled()
    try:
        return {"data": handoffs.dismiss(supabase, current_user, str(run_id), reason_code=body.reason_code)}
    except HandoffRefused as exc:
        raise _refused(exc) from None


@router.post("/recommendations/{run_id}/proposals/{step_number}/submit", status_code=202)
async def submit_specialist_proposal(run_id: UUID, step_number: int, body: SubmitRequest,
                                     current_user: CurrentUser = Depends(require_role(*SPECIALIST_VIEWER_ROLES))):
    _enabled()
    try:
        admission = handoffs.submit_proposal(supabase, current_user, planning_run_id=str(run_id),
                                             plan_digest=body.plan_digest, step_number=step_number,
                                             app_env=settings.app_env, settings=gateway_settings(), clock=_now)
    except HandoffRefused as exc:
        raise _refused(exc) from None
    return {"data": {"handoff_id": admission.handoff_id, "created": admission.created, "state": admission.state,
                     "requires_human_approval": True}}


@router.get("/handoffs/{handoff_id}")
async def get_specialist_handoff(handoff_id: UUID, current_user: CurrentUser = Depends(require_role(*SPECIALIST_VIEWER_ROLES))):
    _enabled()
    try:
        return {"data": handoffs.handoff_status(supabase, current_user, str(handoff_id))}
    except HandoffRefused as exc:
        raise _refused(exc) from None


@router.post("/handoffs/{handoff_id}/approve")
async def approve_specialist_handoff(handoff_id: UUID, body: DecisionRequest,
                                     current_user: CurrentUser = Depends(require_role(*SPECIALIST_VIEWER_ROLES))):
    _enabled()
    try:
        return {"data": handoffs.approve(supabase, current_user, str(handoff_id), reason_code=body.reason_code)}
    except HandoffRefused as exc:
        raise _refused(exc) from None


@router.post("/handoffs/{handoff_id}/reject")
async def reject_specialist_handoff(handoff_id: UUID, body: DecisionRequest,
                                    current_user: CurrentUser = Depends(require_role(*SPECIALIST_VIEWER_ROLES))):
    _enabled()
    try:
        return {"data": handoffs.reject(supabase, current_user, str(handoff_id), reason_code=body.reason_code)}
    except HandoffRefused as exc:
        raise _refused(exc) from None


@router.post("/handoffs/{handoff_id}/withdraw")
async def withdraw_specialist_handoff(handoff_id: UUID, current_user: CurrentUser = Depends(require_role(*SPECIALIST_VIEWER_ROLES))):
    _enabled()
    try:
        return {"data": handoffs.cancel(supabase, current_user, str(handoff_id))}
    except HandoffRefused as exc:
        raise _refused(exc) from None
