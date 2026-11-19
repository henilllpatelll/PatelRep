"""Agent Harness H6: AI Control Center API (ADR-0005). Visibility + human governance over H0-H5; never activation.

Hidden (404) unless the hotel's ``ai_control_center`` release flag is on. Read access does NOT depend on any
execution switch, so a GM can always see that agents are off and why. Every request re-validates the caller's CURRENT
membership and role server-side (a demoted, deactivated, multi-role or stale-token user is refused), and the hotel is
always the caller's own: another hotel's ids read as 404.

  GET  /agent-control-center/session                         role, visible sections, what this person may do
  GET  /agent-control-center/overview                        effective controls, readiness, counts (GM/supervisors)
  GET  /agent-control-center/agents                          reviewed agents/tools at exact versions (+ grants for GM)
  GET  /agent-control-center/runs                            activity (GM: hotel; others: own)  ?state=&cursor=&limit=
  GET  /agent-control-center/runs/{run_id}                   run, steps, run + tool event metadata
  POST /agent-control-center/runs/{run_id}/{cancel|pause|resume}
  GET  /agent-control-center/approvals?view=needs_my_review|submitted_by_me|history
  GET  /agent-control-center/approvals/{approval_id}         human-review facts + what this person may do
  POST /agent-control-center/approvals/{approval_id}/{approve|reject|withdraw}   via the unchanged H2 service
  GET  /agent-control-center/controls                        hotel pause, platform switches (read-only), grants (GM)
  POST /agent-control-center/controls/hotel-pause            GM: pause / unpause this hotel's agents (audited)
  POST /agent-control-center/grants/revoke                   GM: revoke one reviewed grant (audited); no grant path
  GET  /agent-control-center/audit                           governance journal metadata (GM)

There is deliberately no endpoint that enables execution, paid calls, customer billing, a grant or an autonomy level.
AI usage reuses GET /billing/ai-usage (H4).
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from core.config import settings
from core.database import supabase
from core.feature_flags import is_feature_enabled
from middleware.auth import CurrentUser, require_role
from services.agent_control_center import service
from services.agent_control_center.access import Viewer, revalidate
from services.agent_control_center.errors import SECURITY_REFUSALS, ControlCenterRefused, http_status
from services.agent_control_center.store import ControlCenterStore

router = APIRouter(prefix="/agent-control-center", tags=["agent-control-center"])
FEATURE_FLAG = "ai_control_center"
# Coarse gate (pinned to access.VIEWER_ROLES by a smoke test); every section re-checks the AUTHORITATIVE role.
CONTROL_CENTER_ROLES = ("chief_engineer", "engineer", "gm", "housekeeping_supervisor")
OVERVIEW_ROLES = ("chief_engineer", "gm", "housekeeping_supervisor")
GM_ROLES = ("gm",)
_REASON = r"^[a-z][a-z0-9_]{0,63}$"


def _store() -> ControlCenterStore:
    return ControlCenterStore(supabase)


def _http(exc: ControlCenterRefused) -> HTTPException:
    code = "not_found" if exc.code == "feature_disabled" else exc.code
    return HTTPException(status_code=http_status(exc.code), detail={"code": code})


def _viewer(user: CurrentUser) -> Viewer:
    if not is_feature_enabled(user.hotel_id, FEATURE_FLAG):
        raise _http(ControlCenterRefused("feature_disabled"))
    try:
        return revalidate(supabase, user, clock=service.utcnow)
    except ControlCenterRefused as exc:
        if exc.code in SECURITY_REFUSALS:
            service.record_refusal(_store(), user, code=exc.code, subject_type="control", subject_ref="session")
        raise _http(exc) from None


def _refused(viewer: Viewer, exc: ControlCenterRefused, *, subject_type: str, subject_ref: Optional[str]) -> HTTPException:
    if exc.code in SECURITY_REFUSALS:
        service.record_refusal(_store(), viewer, code=exc.code, subject_type=subject_type, subject_ref=subject_ref)
    return _http(exc)


def _gate() -> bool:
    return service.approve_gate_open(settings.app_env)


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason_code: Optional[StrictStr] = Field(default=None, pattern=_REASON)


class HotelPauseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    paused: StrictBool
    reason_code: StrictStr = Field(pattern=_REASON)


class GrantRevokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent_id: StrictStr = Field(min_length=3, max_length=100, pattern=r"^[a-z][a-z0-9_.]{2,99}$")
    agent_version: StrictInt = Field(ge=1, le=999)
    tool_id: StrictStr = Field(min_length=3, max_length=100, pattern=r"^[a-z][a-z0-9_.]{2,99}$")
    tool_version: StrictInt = Field(ge=1, le=999)


@router.get("/session")
async def get_session(current_user: CurrentUser = Depends(require_role(*CONTROL_CENTER_ROLES))):
    viewer = _viewer(current_user)
    return {"data": service.session(viewer, approve_gate_open=_gate())}


@router.get("/overview")
async def get_overview(current_user: CurrentUser = Depends(require_role(*OVERVIEW_ROLES))):
    viewer = _viewer(current_user)
    try:
        return {"data": service.overview(_store(), viewer, approve_gate_open=_gate())}
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="control", subject_ref="overview") from None


@router.get("/agents")
async def get_agents(current_user: CurrentUser = Depends(require_role(*CONTROL_CENTER_ROLES))):
    viewer = _viewer(current_user)
    try:
        return {"data": service.agents(_store(), viewer)}
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="control", subject_ref="agents") from None


@router.get("/runs")
async def list_runs(state: Optional[str] = Query(default=None, max_length=32),
                    cursor: Optional[str] = Query(default=None, max_length=120),
                    limit: int = Query(default=25, ge=1, le=100),
                    current_user: CurrentUser = Depends(require_role(*CONTROL_CENTER_ROLES))):
    viewer = _viewer(current_user)
    try:
        data = service.runs(_store(), viewer, state=state, cursor=cursor, limit=limit)
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="run", subject_ref=None) from None
    return {"data": data["runs"], "meta": {"per_page": limit, "next_cursor": data["next_cursor"]}}


@router.get("/runs/{run_id}")
async def get_run(run_id: UUID, current_user: CurrentUser = Depends(require_role(*CONTROL_CENTER_ROLES))):
    viewer = _viewer(current_user)
    try:
        return {"data": service.run_detail(_store(), viewer, str(run_id))}
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="run", subject_ref=str(run_id)) from None


@router.post("/runs/{run_id}/{action}")
async def control_run(run_id: UUID, action: str, current_user: CurrentUser = Depends(require_role(*CONTROL_CENTER_ROLES))):
    viewer = _viewer(current_user)
    try:
        return {"data": service.run_control(_store(), viewer, str(run_id), action)}
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="run", subject_ref=str(run_id)) from None


@router.get("/approvals")
async def list_approvals(view: str = Query(default="needs_my_review", max_length=32),
                         cursor: Optional[str] = Query(default=None, max_length=120),
                         limit: int = Query(default=25, ge=1, le=100),
                         current_user: CurrentUser = Depends(require_role(*CONTROL_CENTER_ROLES))):
    viewer = _viewer(current_user)
    try:
        data = service.approvals_list(_store(), viewer, view=view, cursor=cursor, limit=limit,
                                      approve_gate_open=_gate(), now=service.utcnow())
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="approval", subject_ref=None) from None
    return {"data": data["approvals"], "meta": {"view": view, "per_page": limit, "next_cursor": data["next_cursor"]}}


@router.get("/approvals/{approval_id}")
async def get_approval(approval_id: UUID, current_user: CurrentUser = Depends(require_role(*CONTROL_CENTER_ROLES))):
    viewer = _viewer(current_user)
    try:
        return {"data": service.approval_detail(_store(), viewer, str(approval_id), approve_gate_open=_gate(),
                                                now=service.utcnow(), risk_of=service.risk_of)}
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="approval", subject_ref=str(approval_id)) from None


@router.post("/approvals/{approval_id}/{decision}")
async def decide_approval(approval_id: UUID, decision: str, body: DecisionRequest,
                          current_user: CurrentUser = Depends(require_role(*CONTROL_CENTER_ROLES))):
    viewer = _viewer(current_user)
    try:
        return {"data": service.decide(supabase, _store(), viewer, str(approval_id), decision=decision,
                                       reason_code=body.reason_code, approve_gate_open=_gate())}
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="approval", subject_ref=str(approval_id)) from None


@router.get("/controls")
async def get_controls(current_user: CurrentUser = Depends(require_role(*GM_ROLES))):
    viewer = _viewer(current_user)
    try:
        return {"data": service.controls(_store(), viewer)}
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="control", subject_ref="controls") from None


@router.post("/controls/hotel-pause")
async def set_hotel_pause(body: HotelPauseRequest, current_user: CurrentUser = Depends(require_role(*GM_ROLES))):
    viewer = _viewer(current_user)
    try:
        return {"data": service.set_hotel_pause(_store(), viewer, paused=body.paused, reason_code=body.reason_code)}
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="control", subject_ref="hotel_pause") from None


@router.post("/grants/revoke")
async def revoke_grant(body: GrantRevokeRequest, current_user: CurrentUser = Depends(require_role(*GM_ROLES))):
    viewer = _viewer(current_user)
    try:
        return {"data": service.revoke_grant(_store(), viewer, agent_id=body.agent_id, agent_version=body.agent_version,
                                             tool_id=body.tool_id, tool_version=body.tool_version)}
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="grant", subject_ref=f"{body.tool_id}@{body.tool_version}") from None


@router.get("/audit")
async def get_audit(before_id: Optional[int] = Query(default=None, ge=1),
                    limit: int = Query(default=50, ge=1, le=100),
                    event_type: Optional[str] = Query(default=None, max_length=64),
                    current_user: CurrentUser = Depends(require_role(*GM_ROLES))):
    viewer = _viewer(current_user)
    try:
        data = service.audit(_store(), viewer, before_id=before_id, limit=limit, event_type=event_type)
    except ControlCenterRefused as exc:
        raise _refused(viewer, exc, subject_type="control", subject_ref="audit") from None
    return {"data": data["events"], "meta": {"per_page": limit, "next_before_id": data["next_before_id"]}}
