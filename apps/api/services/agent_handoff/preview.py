"""The role-restricted recommendation preview (ADR-0004 decision 9; H5.7 minimal UX, backend only).

It answers, for one planning run, without ever presenting an AI output as a fact:

  * ``verified_facts``  CURRENT facts re-gathered now through the gateway under the VIEWER's identity and the hotel's
                        grants (``verified: true``); null with a reason when they cannot be read
  * ``recommendation``  the recorded, deterministically validated plan, labelled ``ai_generated: true``: closed finding
                        codes (each checked against the facts it was planned over), an AI priority assessment, reason
                        codes and at most one proposal with its live lifecycle status
  * ``actions``         what THIS viewer may do right now (submit / approve / reject / withdraw / dismiss). A flag is
                        true only when the backend would accept it at this moment; it is never a hint of an action that
                        cannot run

Display names are resolved here for the authorized human viewer only; the model never received them.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Callable, Optional

from middleware.auth import CurrentUser
from services.agent_execution.store import AgentRunStore
from services.agent_gateway.authorization import parse_ts
from services.agent_gateway.context import ContextRefused
from services.agent_gateway.errors import GatewayBlocked
from services.agent_handoff import PROPOSAL_TTL_SECONDS
from services.agent_handoff.handoff import HandoffRefused, _user, _uuid, fresh_context
from services.agent_handoff.store import HandoffStore
from services.agent_orchestrator.errors import RoutingError
from services.agent_orchestrator.intents import PLAN_SCHEMA_V2
from services.agent_orchestrator.orchestrator import intent_for
from services.agent_orchestrator.store import PlanningStore

AI_LABEL = "AI recommendation. Review the verified facts before acting; nothing changes without a human decision."


def proposal_status(handoff: Optional[dict], *, expired: bool) -> str:
    if not handoff:
        return "expired" if expired else "proposed"
    execution, approval = handoff.get("execution") or {}, handoff.get("approval") or {}
    if execution:
        return "committed" if execution.get("state") == "succeeded" else "failed"
    state = approval.get("state")
    if state == "requested":
        return "awaiting_approval"
    if state == "approved":
        return "approved"
    if state in ("rejected", "expired", "revoked"):
        return {"revoked": "withdrawn"}.get(state, state)
    if handoff.get("run_state") == "cancelled":
        return "withdrawn"
    if handoff.get("run_state") in ("failed", "dead_letter"):
        return "failed"
    return "submitted"


def _names(client: Any, hotel_id: str, staff_ids: set[str]) -> dict[str, str]:
    if not staff_ids:
        return {}
    rows = (client.table("user_profiles").select("id, full_name").eq("tenant_id", hotel_id)
            .in_("id", sorted(staff_ids)).limit(100).execute().data or [])
    return {str(r["id"]): str(r.get("full_name") or "")[:80] for r in rows if r.get("id")}


def build_preview(client: Any, user: CurrentUser, run_id: str, *, clock: Callable[[], datetime]) -> dict:
    user = _user(user)
    planning = PlanningStore(client).get(tenant_id=user.hotel_id, run_id=_uuid(run_id))
    if not planning:
        raise HandoffRefused("not_found")
    try:
        intent = intent_for(planning.get("intent"), planning.get("intent_version"))
    except RoutingError:
        raise HandoffRefused("not_found") from None
    if intent.plan_schema != PLAN_SCHEMA_V2 or user.role not in intent.initiator_roles:
        raise HandoffRefused("not_found")  # H3-only intents and other departments are not previewable here

    run = AgentRunStore(client).get_run(tenant_id=user.hotel_id, run_id=planning["run_id"]) or {}
    facts: Optional[dict] = None
    facts_reason: Optional[str] = None
    try:
        facts = dict(fresh_context(client, user, intent=intent, planning=planning, clock=clock).facts)
    except ContextRefused as exc:
        facts_reason = exc.code
    except GatewayBlocked as exc:
        facts_reason = exc.reason

    is_initiator = str(planning.get("initiated_by_user_id")) == user.user_id
    plan = planning.get("plan") or {}
    recorded_at = parse_ts(planning.get("recorded_at"))
    expired = recorded_at is None or clock() >= recorded_at + timedelta(seconds=PROPOSAL_TTL_SECONDS)
    handoffs = {int(h["handoff"]["step_number"]): h
                for h in HandoffStore(client).for_run(tenant_id=user.hotel_id, planning_run_id=planning["run_id"])
                if h and h.get("handoff")}

    staff: set[str] = set()
    proposals = []
    for step in plan.get("steps") or []:
        args = step.get("arguments") or {}
        handoff = handoffs.get(int(step.get("step_number") or 0))
        status = proposal_status(handoff, expired=expired)
        approval = (handoff or {}).get("approval") or {}
        staff.update(s for s in (args.get("assignee_user_id"), args.get("expected_assigned_to")) if s)
        proposals.append({
            "step_number": step.get("step_number"), "tool_id": (step.get("tool") or {}).get("id"),
            "tool_version": (step.get("tool") or {}).get("version"),
            "kind": "reassign" if args.get("expected_assigned_to") else "assign",
            "assignee_id": args.get("assignee_user_id"), "expected_current_owner_id": args.get("expected_assigned_to"),
            "assignment_date": args.get("assignment_date"), "requires_human_approval": True, "status": status,
            "handoff_id": (handoff or {}).get("handoff", {}).get("id"),
            "failure_code": ((handoff or {}).get("execution") or {}).get("error_code"),
            "actions": {
                "submit": is_initiator and status == "proposed",
                "approve": (not is_initiator) and status == "awaiting_approval"
                           and user.role in (approval.get("required_approver_roles") or []),
                "reject": (not is_initiator) and status == "awaiting_approval"
                          and user.role in (approval.get("required_approver_roles") or []),
                "withdraw": is_initiator and status in ("submitted", "awaiting_approval", "approved"),
            },
        })
    for fact in (facts or {}).values():
        for c in fact.get("candidates") or []:
            staff.add(str(c.get("staff_id")))
        for k in ("assigned_to", "current_assigned_to"):
            if fact.get(k):
                staff.add(str(fact[k]))
    names = _names(client, user.hotel_id, {s for s in staff if s})

    outcome = planning.get("plan_outcome")
    recommendation = None if outcome is None else {
        "ai_generated": True, "label": AI_LABEL, "outcome": outcome, "plan_digest": planning.get("plan_digest"),
        "recorded_at": planning.get("recorded_at"),
        "findings": [{"code": f, "checked_against_planning_facts": True} for f in plan.get("findings") or []],
        "priority_assessment": plan.get("priority"), "reason_codes": list(planning.get("reason_codes") or []),
        "proposals": proposals,
    }
    return {
        "run_id": planning["run_id"], "intent": intent.intent, "intent_version": intent.version,
        "resource": {"type": intent.resource_type, "id": planning.get("resource_id")},
        "run_state": run.get("state"), "is_initiator": is_initiator,
        "verified_facts": None if facts is None else {"verified": True, "read_at": clock().isoformat(), "facts": facts},
        "verified_facts_unavailable_reason": facts_reason,
        "recommendation": recommendation,
        "staff_names": names,
        "actions": {"dismiss": is_initiator and outcome is not None},
    }
