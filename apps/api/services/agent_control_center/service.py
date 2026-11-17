"""AI Control Center operations. Every function takes a re-validated ``Viewer`` (access.revalidate) and its store.

Responses are built field by field (an explicit schema by construction): ids, versions, states, reason codes, times,
display names and reviewed proposal arguments only. Never prompts, plans' free text, model output, provider
credentials, tool output, run/tool event ``detail`` blobs, guest names or notes.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from services.agent_control_center.access import Viewer, require
from services.agent_control_center.catalog import agent_directory, reviewed_tool_keys
from services.agent_control_center.errors import ControlCenterRefused
from services.agent_control_center.store import ControlCenterStore
from services.agent_gateway import approvals as h2_approvals
from services.agent_gateway.errors import GatewayRefused
from services.agent_gateway.store import GatewayStore

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_REASON_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_CURSOR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{8,40})\|([0-9a-fA-F-]{36})$")
RUN_STATES = frozenset({"queued", "running", "retry_wait", "paused", "cancel_requested", "awaiting_approval",
                        "succeeded", "failed", "cancelled", "dead_letter"})
APPROVAL_VIEWS = ("needs_my_review", "submitted_by_me", "history")
PAGE_MAX = 100
_RUN_EVENT_KEYS = ("id", "event_type", "from_state", "to_state", "attempt", "actor_kind", "reason_code", "created_at",
                   "step_id")
_TOOL_EVENT_KEYS = ("id", "event_type", "actor_kind", "reason_code", "created_at", "approval_id", "execution_id",
                    "invocation_id")
_STEP_KEYS = ("id", "step_number", "step_type", "state", "attempt_count", "max_attempts", "error_class", "error_code",
              "created_at", "started_at", "completed_at")


def uuid_or_404(value: object) -> str:
    if not isinstance(value, str) or not _UUID_RE.match(value):
        raise ControlCenterRefused("not_found")
    return value.lower()


def reason_or_422(value: Optional[str], *, required: bool = False) -> Optional[str]:
    if value is None and not required:
        return None
    if not isinstance(value, str) or not _REASON_RE.match(value):
        raise ControlCenterRefused("invalid_reason_code")
    return value


def page_limit(value: Optional[int], default: int = 25) -> int:
    return max(1, min(int(value or default), PAGE_MAX))


def parse_cursor(cursor: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if cursor is None or cursor == "":
        return None, None
    match = _CURSOR_RE.match(cursor)
    if not match:
        raise ControlCenterRefused("invalid_cursor")
    return match.group(1), match.group(2).lower()


def _cursor(rows: list[dict], limit: int) -> Optional[str]:
    if len(rows) < limit or not rows:
        return None
    last = rows[-1]
    return f"{last['created_at']}|{last['id']}"


def _pick(row: dict, keys: tuple[str, ...]) -> dict:
    return {k: row.get(k) for k in keys if k in row}


# ---------------------------------------------------------------------------------------------------- session
def session(viewer: Viewer, *, approve_gate_open: bool) -> dict:
    return {"role": viewer.role, "sections": viewer.sections, "is_gm": viewer.is_gm,
            "can": {"pause_hotel": viewer.is_gm, "revoke_grants": viewer.is_gm,
                    "approve": approve_gate_open, "control_runs": True},
            "notes": {"approve": None if approve_gate_open else "gateway_disabled"}}


# ---------------------------------------------------------------------------------------------------- overview
def overview(store: ControlCenterStore, viewer: Viewer, *, approve_gate_open: bool) -> dict:
    require(viewer, "overview")
    data = store.overview(viewer.hotel_id)
    if not data:
        raise ControlCenterRefused("schema_unavailable")
    platform, hotel = data.get("platform") or {}, data.get("hotel") or {}
    blocks = [code for code, on in (
        ("platform_paused", platform.get("paused")), ("cost_emergency_stop", platform.get("cost_emergency_stop")),
        ("hotel_paused", hotel.get("paused")), ("not_entitled", not hotel.get("entitled")),
        ("gateway_execution_disabled", not platform.get("gateway_execution_enabled")),
        ("approve_gate_closed", not approve_gate_open), ("no_live_worker", not platform.get("live_workers")),
        ("no_effective_grants", not hotel.get("effective_grants"))) if on]
    # "Ready" only when the DATABASE and process gates would admit and execute an approved action today. Paid model
    # calls and customer billing are reported, never inferred as part of readiness for a human-approved write.
    return {**data, "readiness": {"execution_ready": not blocks, "blocked_by": blocks,
                                  "paid_model_calls_enabled": bool(platform.get("paid_model_calls_enabled")),
                                  "customer_billing_mode": platform.get("customer_billing_mode") or "disabled"}}


# ---------------------------------------------------------------------------------------------------- agents
def agents(store: ControlCenterStore, viewer: Viewer) -> dict:
    require(viewer, "agents")
    directory = agent_directory()
    if viewer.is_gm:
        grants = {(g["agent_id"], g["agent_version"], g["tool_id"], g["tool_version"]): g
                  for g in store.grants(viewer.hotel_id)}
        for agent in directory:
            for tool in agent["tools"]:
                g = grants.get((agent["agent_id"], agent["agent_version"], tool["tool_id"], tool["tool_version"]))
                tool["grant"] = None if g is None else {
                    "effective": bool(g.get("effective")), "max_level": g.get("max_level"),
                    "expires_at": g.get("expires_at"), "revoked_at": g.get("revoked_at"),
                    "granted_at": g.get("granted_at")}
    return {"agents": directory}


# ---------------------------------------------------------------------------------------------------- activity
def runs(store: ControlCenterStore, viewer: Viewer, *, state: Optional[str], cursor: Optional[str],
         limit: Optional[int]) -> dict:
    require(viewer, "activity")
    if state is not None and state not in RUN_STATES:
        raise ControlCenterRefused("invalid_request")
    before_created, before_id = parse_cursor(cursor)
    n = page_limit(limit)
    rows = store.runs_page(viewer.hotel_id, states=[state] if state else None,
                           initiated_by=None if viewer.is_gm else viewer.user_id,
                           before_created=before_created, before_id=before_id, limit=n)
    names = store.names(viewer.hotel_id, {r.get("initiated_by_user_id") for r in rows})
    for r in rows:
        r["initiated_by_name"] = names.get(str(r.get("initiated_by_user_id")))
    return {"runs": rows, "next_cursor": _cursor(rows, n)}


def run_detail(store: ControlCenterStore, viewer: Viewer, run_id: str) -> dict:
    require(viewer, "activity")
    found = store.run_get(viewer.hotel_id, uuid_or_404(run_id)) or {}
    run = found.get("run") if isinstance(found, dict) else None
    if not run or (not viewer.is_gm and run.get("initiated_by_user_id") != viewer.user_id):
        raise ControlCenterRefused("not_found")
    events = [_pick(e, _RUN_EVENT_KEYS) for e in store.run_events(viewer.hotel_id, run["id"])]
    tool_events = [_pick(e, _TOOL_EVENT_KEYS) for e in store.tool_events(viewer.hotel_id, run["id"])]
    keep = ("id", "agent_id", "agent_version", "state", "principal_type", "initiated_by_user_id", "system_principal_id",
            "trigger_type", "correlation_id", "attempt_count", "max_attempts", "current_step_number",
            "last_error_class", "last_error_code", "cancel_requested_at", "pause_requested_at", "created_at",
            "updated_at", "started_at", "completed_at", "deadline_at")
    names = store.names(viewer.hotel_id, {run.get("initiated_by_user_id")})
    is_own = run.get("initiated_by_user_id") == viewer.user_id
    terminal = run.get("state") in ("succeeded", "failed", "cancelled", "dead_letter")
    return {"run": {**_pick(run, keep), "initiated_by_name": names.get(str(run.get("initiated_by_user_id")))},
            "steps": [_pick(s, _STEP_KEYS) for s in found.get("steps") or []],
            "events": events, "tool_events": tool_events,
            "can": {"cancel": not terminal and (viewer.is_gm or is_own),
                    "pause": run.get("state") in ("queued", "running", "retry_wait") and (viewer.is_gm or is_own),
                    "resume": run.get("state") == "paused" and viewer.is_gm}}


def run_control(store: ControlCenterStore, viewer: Viewer, run_id: str, action: str) -> dict:
    require(viewer, "activity")
    if action not in ("cancel", "pause", "resume"):
        raise ControlCenterRefused("invalid_request")
    result = store.run_control(viewer.hotel_id, actor_user_id=viewer.user_id, run_id=uuid_or_404(run_id),
                               action=action)
    if not result.get("ok"):
        raise ControlCenterRefused(str(result.get("reason") or "run_control_refused"))
    return {"outcome": result.get("outcome"), "state": result.get("state")}


# ---------------------------------------------------------------------------------------------------- approvals
def _capability(viewer: Viewer, approval: dict, *, approve_gate_open: bool, now: datetime) -> dict:
    """What the backend would allow THIS person to do right now. The database still decides each request; this only
    keeps the UI from offering a button the backend would refuse."""
    initiator = approval.get("initiated_by_user_id") == viewer.user_id
    pending = approval.get("state") == "requested"
    expires = approval.get("expires_at")
    try:
        expired = bool(expires) and datetime.fromisoformat(str(expires).replace("Z", "+00:00")) <= now
    except ValueError:
        expired = True
    role_ok = viewer.role in (approval.get("required_approver_roles") or [])
    # Migration 254: no reviewed write is low risk, so an initiator can never decide their own request.
    independent = not initiator
    reason = None
    if not pending:
        reason = "not_pending"
    elif expired:
        reason = "approval_expired"
    elif initiator:
        reason = "self_approval_forbidden"
    elif not role_ok:
        reason = "approver_not_authorized"
    can_review = pending and not expired and role_ok and independent
    if can_review and not approve_gate_open:
        approve_reason = "gateway_disabled"
    else:
        approve_reason = reason
    return {"approve": can_review and approve_gate_open, "reject": can_review,
            "withdraw": pending and not expired and initiator, "reason": approve_reason}


def approvals_list(store: ControlCenterStore, viewer: Viewer, *, view: str, cursor: Optional[str],
                   limit: Optional[int], approve_gate_open: bool, now: datetime) -> dict:
    require(viewer, "approvals")
    if view not in APPROVAL_VIEWS:
        raise ControlCenterRefused("invalid_request")
    before_created, before_id = parse_cursor(cursor)
    n = page_limit(limit)
    if view == "needs_my_review":
        rows = store.approvals_page(viewer.hotel_id, states=["requested"], initiated_by=None,
                                    before_created=before_created, before_id=before_id, limit=n)
        shown = [r for r in rows if viewer.role in (r.get("required_approver_roles") or [])
                 and r.get("initiated_by_user_id") != viewer.user_id]
    elif view == "submitted_by_me":
        rows = store.approvals_page(viewer.hotel_id, states=None, initiated_by=viewer.user_id,
                                    before_created=before_created, before_id=before_id, limit=n)
        shown = rows
    else:
        rows = store.approvals_page(viewer.hotel_id, states=["approved", "rejected", "expired", "revoked"],
                                    initiated_by=None, before_created=before_created, before_id=before_id, limit=n)
        shown = rows if viewer.is_gm else [r for r in rows if viewer.user_id in (
            r.get("initiated_by_user_id"), r.get("decided_by_user_id"))]
    names = store.names(viewer.hotel_id, {r.get("initiated_by_user_id") for r in shown} |
                        {r.get("decided_by_user_id") for r in shown})
    items = [{**_approval_summary(r, names),
              "can": _capability(viewer, r, approve_gate_open=approve_gate_open, now=now)} for r in shown]
    return {"view": view, "approvals": items, "next_cursor": _cursor(rows, n)}


def _approval_summary(r: dict, names: dict[str, str]) -> dict:
    keep = ("id", "run_id", "agent_id", "agent_version", "tool_id", "tool_version", "resource_type", "resource_id",
            "state", "initiated_by_user_id", "decided_by_user_id", "decided_role", "decided_at", "decision_reason_code",
            "required_approver_roles", "approval_policy_id", "expires_at", "consumed_at", "created_at", "ended_at")
    out = _pick(r, keep)
    out["initiated_by_name"] = names.get(str(r.get("initiated_by_user_id")))
    out["decided_by_name"] = names.get(str(r.get("decided_by_user_id"))) if r.get("decided_by_user_id") else None
    return out


def approval_detail(store: ControlCenterStore, viewer: Viewer, approval_id: str, *, approve_gate_open: bool,
                    now: datetime, risk_of: Callable[[str, int], Optional[str]]) -> dict:
    require(viewer, "approvals")
    facts = store.approval_facts(viewer.hotel_id, uuid_or_404(approval_id))
    approval = (facts or {}).get("approval")
    if not approval or not (viewer.is_gm or viewer.role in (approval.get("required_approver_roles") or [])
                            or approval.get("initiated_by_user_id") == viewer.user_id):
        raise ControlCenterRefused("not_found")
    people = facts.get("people") or {}
    names = {k: (v or {}).get("name") or "" for k, v in people.items()}
    proposal = dict(facts.get("proposal") or {})
    args = dict(proposal.get("arguments") or {})
    resource = facts.get("resource")
    # Staleness: the proposal was computed against `expected_assigned_to`; if the resource moved on, say so. The
    # execution RPC refuses a stale change anyway (H2/H5), this only tells the reviewer before they decide.
    stale = None
    if resource is not None and "expected_assigned_to" in args:  # an explicit null means "was unassigned"
        stale = (resource.get("assigned_to") or None) != (args.get("expected_assigned_to") or None)
    return {
        "approval": _approval_summary(approval, names),
        "risk": risk_of(str(approval.get("tool_id")), int(approval.get("tool_version") or 0)),
        "proposal": {**proposal, "arguments": args,
                     "assignee_name": names.get(str(args.get("assignee_user_id"))) if args.get("assignee_user_id") else None,
                     "expected_assignee_name": names.get(str(args.get("expected_assigned_to")))
                     if args.get("expected_assigned_to") else None},
        "resource": None if resource is None else {
            **resource, "assigned_to_name": names.get(str(resource.get("assigned_to"))) if resource.get("assigned_to") else None},
        "resource_changed_since_proposal": stale,
        "handoff": facts.get("handoff"),
        # Role membership is verified; shift presence is NOT (no roster evidence is read). The UI must say so.
        "assignee_evidence": "active_role_member_shift_unverified" if args.get("assignee_user_id") else None,
        "can": _capability(viewer, approval, approve_gate_open=approve_gate_open, now=now),
    }


def decide(client: Any, store: ControlCenterStore, viewer: Viewer, approval_id: str, *, decision: str,
           reason_code: Optional[str], approve_gate_open: bool) -> dict:
    """Approve / reject / withdraw through the UNCHANGED H2 approvals service (current role re-read in SQL)."""
    require(viewer, "approvals")
    approval_id = uuid_or_404(approval_id)
    reason = reason_or_422(reason_code)
    if decision == "approve" and not approve_gate_open:
        raise ControlCenterRefused("gateway_disabled")  # approving resumes a run; never while execution is off
    gstore, user = GatewayStore(client), viewer.as_current_user()
    try:
        if decision == "approve":
            result = h2_approvals.approve(gstore, user, approval_id, reason_code=reason)
        elif decision == "reject":
            result = h2_approvals.reject(gstore, user, approval_id, reason_code=reason)
        elif decision == "withdraw":
            current = h2_approvals.get_approval(gstore, user, approval_id)
            if current.get("initiated_by_user_id") != viewer.user_id:
                raise ControlCenterRefused("not_initiator")
            result = h2_approvals.revoke(gstore, user, approval_id, reason_code=reason or "withdrawn_by_initiator")
        else:
            raise ControlCenterRefused("invalid_request")
    except GatewayRefused as exc:
        raise ControlCenterRefused(exc.code) from None
    return {"approval_id": approval_id, "state": result.get("state"), "run_state": result.get("run_state")}


# ---------------------------------------------------------------------------------------------------- controls
def controls(store: ControlCenterStore, viewer: Viewer) -> dict:
    require(viewer, "controls")
    data = store.overview(viewer.hotel_id)
    grants = store.grants(viewer.hotel_id)
    names = store.names(viewer.hotel_id, {g.get("granted_by_user_id") for g in grants} |
                        {g.get("revoked_by_user_id") for g in grants} | {(data.get("hotel") or {}).get("paused_by_user_id")})
    for g in grants:
        g["granted_by_name"] = names.get(str(g.get("granted_by_user_id")))
        g["revoked_by_name"] = names.get(str(g.get("revoked_by_user_id"))) if g.get("revoked_by_user_id") else None
    hotel = dict(data.get("hotel") or {})
    hotel["paused_by_name"] = names.get(str(hotel.get("paused_by_user_id"))) if hotel.get("paused_by_user_id") else None
    hotel["can_unpause"] = bool(hotel.get("paused")) and hotel.get("paused_by_kind") == "human"
    return {"platform": data.get("platform") or {}, "hotel": hotel, "grants": grants}


def set_hotel_pause(store: ControlCenterStore, viewer: Viewer, *, paused: bool, reason_code: str) -> dict:
    require(viewer, "controls")
    result = store.hotel_pause_set(viewer.hotel_id, actor_user_id=viewer.user_id, paused=bool(paused),
                                   reason_code=reason_or_422(reason_code, required=True))
    if not result.get("ok"):
        raise ControlCenterRefused(str(result.get("reason") or "control_refused"))
    return {"paused": result.get("paused"), "changed": result.get("changed")}


def revoke_grant(store: ControlCenterStore, viewer: Viewer, *, agent_id: str, agent_version: int, tool_id: str,
                 tool_version: int) -> dict:
    require(viewer, "controls")
    if (agent_id, agent_version, tool_id, tool_version) not in reviewed_tool_keys():
        raise ControlCenterRefused("tool_not_allowed")
    result = store.grant_revoke(viewer.hotel_id, actor_user_id=viewer.user_id, agent_id=agent_id,
                                agent_version=agent_version, tool_id=tool_id, tool_version=tool_version)
    if not result.get("ok"):
        raise ControlCenterRefused(str(result.get("reason") or "revoke_refused"))
    return {"revoked": bool(result.get("revoked"))}


# ---------------------------------------------------------------------------------------------------- audit
AUDIT_TYPES = frozenset({"runtime_control_changed", "tool_grant_changed", "execution_enablement_changed",
                         "tool_control_changed", "model_enablement_changed", "customer_billing_controls_changed",
                         "worker_credential_issued", "worker_credential_revoked", "security_refusal"})


def audit(store: ControlCenterStore, viewer: Viewer, *, before_id: Optional[int], limit: Optional[int],
          event_type: Optional[str]) -> dict:
    require(viewer, "audit")
    if event_type is not None and event_type not in AUDIT_TYPES:
        raise ControlCenterRefused("invalid_request")
    n = page_limit(limit, 50)
    rows = store.events_page(viewer.hotel_id, before_id=before_id, limit=n,
                             event_types=[event_type] if event_type else None)
    names = store.names(viewer.hotel_id, {r.get("actor_user_id") for r in rows})
    for r in rows:
        r["actor_name"] = names.get(str(r.get("actor_user_id"))) if r.get("actor_user_id") else None
    return {"events": rows, "next_before_id": rows[-1]["id"] if len(rows) == n else None}


def record_refusal(store: ControlCenterStore, viewer_or_user: Any, *, code: str, subject_type: str,
                   subject_ref: Optional[str]) -> None:
    """Best effort: a journal failure never changes the refusal the caller already gets."""
    hotel = getattr(viewer_or_user, "hotel_id", None)
    if not hotel:
        return
    try:
        store.record_refusal(hotel, actor_user_id=getattr(viewer_or_user, "user_id", None), reason_code=code,
                             subject_type=subject_type, subject_ref=subject_ref)
    except Exception:  # noqa: BLE001
        return


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def approve_gate_open(app_env: str) -> bool:
    """The gateway's own process gate (AGENT_GATEWAY_EXECUTION_ENABLED + non-production APP_ENV). Approving resumes a
    run, so the Control Center never offers or performs it while this is closed."""
    from services.agent_gateway.authorization import GatewaySettings, process_allows_execution

    return process_allows_execution(app_env=app_env, settings=GatewaySettings())


def risk_of(tool_id: str, tool_version: int) -> Optional[str]:
    from services.agent_gateway.catalog import ALL_TOOL_SPECS

    for spec in ALL_TOOL_SPECS:
        if spec.tool_id == tool_id and spec.version == tool_version:
            return spec.risk.value
    return None
