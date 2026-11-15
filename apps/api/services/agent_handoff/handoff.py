"""The H3 -> H2 proposal handoff (ADR-0004 decisions 6-7). Verified-user interface; never called by a model.

``submit_proposal`` turns ONE validated write proposal from a recorded plan into ONE gateway invocation, and only when:

  1. the process gates allow gateway execution (production refused in code);
  2. the caller is the plan's verified initiator (re-checked in the database under a row lock);
  3. the plan is ``proposed``, its stored digest equals the digest recomputed from the stored plan AND the digest the
     caller reviewed (an altered plan or a stale screen fails), and it is inside the proposal TTL;
  4. the proposal is the intent's single allowed write for the intent's specialist agent version;
  5. FRESH verified facts (gathered now, under the caller's CURRENT identity and the hotel's grants) still support
     it -- same owner, eligible assignee, hotel day, no blocker -- otherwise it is ``proposal_stale`` and needs a new
     recommendation;
  6. the gateway's own ``prepare``/``decide`` returns ``requires_approval`` (never ``allow``: no approval exists yet);
  7. the database admits it atomically (handoff row + gateway run + invocation + queue message), re-checking all of
     the above plus the gateway allowlist, resource ownership, controls, entitlement, current authority and grant.

The approval itself then follows the unchanged H2 state machine: a DIFFERENT, currently authorized manager approves
through ``approve`` below, the fenced worker executes exactly once, and the database refuses anything stale.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Optional

from middleware.auth import CurrentUser
from services.agent_execution.identity_authority import SupabaseIdentityAuthority
from services.agent_gateway import approvals
from services.agent_gateway.admission import admit_tool_run
from services.agent_gateway.authorization import GatewaySettings, process_allows_execution
from services.agent_gateway.context import ContextRead, ContextRefused, gather_verified_context
from services.agent_gateway.errors import GatewayBlocked, GatewayRefused
from services.agent_gateway.schema import canonical_json
from services.agent_gateway.store import GatewayStore
from services.agent_handoff import PROPOSAL_TTL_SECONDS
from services.agent_handoff.store import HandoffStore
from services.agent_orchestrator.errors import RoutingError
from services.agent_orchestrator.intents import PLAN_SCHEMA_V2
from services.agent_orchestrator.orchestrator import intent_for
from services.agent_orchestrator.plans import PlanRejected
from services.agent_orchestrator.plans_v2 import check_proposal_against_facts
from services.agent_orchestrator.store import PlanningStore

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
_REASON_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class HandoffRefused(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code if isinstance(code, str) and _REASON_RE.match(code) else "handoff_refused"


@dataclass(frozen=True)
class HandoffAdmission:
    handoff_id: str
    gateway_run_id: str
    invocation_id: str
    created: bool
    state: str


def _user(user: Any) -> CurrentUser:
    if not isinstance(user, CurrentUser) or not user.hotel_id or not user.user_id:
        raise HandoffRefused("unauthenticated")
    return user


def _uuid(value: object) -> str:
    if not isinstance(value, str) or not _UUID_RE.match(value.lower()):
        raise HandoffRefused("not_found")
    return value.lower()


def plan_digest_of(plan: Any) -> str:
    return hashlib.sha256(canonical_json(plan)).hexdigest()


def fresh_context(client: Any, user: CurrentUser, *, intent, planning: dict, clock: Callable[[], datetime]):
    """Re-gather the intent's verified facts NOW, under the caller's current authoritative identity."""
    pseudo_run = {"id": planning["run_id"], "tenant_id": user.hotel_id, "principal_type": "human",
                  "trigger_type": "user_request", "initiated_by_user_id": user.user_id, "correlation_id": None}
    reads = tuple(ContextRead(tool_id=t, tool_version=v, resource_argument=a) for t, v, a in intent.context_reads)
    return gather_verified_context(
        GatewayStore(client), run=pseudo_run, agent_key=intent.specialist, resource_type=intent.resource_type,
        resource_id=str(planning["resource_id"]), reads=reads, authority=SupabaseIdentityAuthority(client, clock=clock),
        clock=clock, process_enabled=True)


def submit_proposal(client: Any, user: CurrentUser, *, planning_run_id: str, plan_digest: str, step_number: int,
                    app_env: str, settings: GatewaySettings, clock: Callable[[], datetime],
                    deadline_seconds: int = 7_200) -> HandoffAdmission:
    user = _user(user)
    if not process_allows_execution(app_env=app_env, settings=settings):
        raise HandoffRefused("gateway_disabled")
    run_id = _uuid(planning_run_id)
    if not isinstance(plan_digest, str) or not _DIGEST_RE.match(plan_digest):
        raise HandoffRefused("plan_digest_mismatch")
    if isinstance(step_number, bool) or not isinstance(step_number, int) or not 1 <= step_number <= 4:
        raise HandoffRefused("proposal_not_found")

    planning = PlanningStore(client).get(tenant_id=user.hotel_id, run_id=run_id)
    if not planning:
        raise HandoffRefused("not_found")
    if str(planning.get("initiated_by_user_id")) != user.user_id:
        raise HandoffRefused("not_initiator")
    if planning.get("plan_outcome") != "proposed":
        raise HandoffRefused("plan_not_proposed")
    plan = planning.get("plan") or {}
    if plan_digest_of(plan) != planning.get("plan_digest") or planning.get("plan_digest") != plan_digest:
        raise HandoffRefused("plan_digest_mismatch")
    try:
        intent = intent_for(planning.get("intent"), planning.get("intent_version"))
    except RoutingError:
        raise HandoffRefused("proposal_not_allowed") from None
    if intent.plan_schema != PLAN_SCHEMA_V2 or intent.write_tool is None or intent.specialist is None \
            or plan.get("proposal_only") is not True or plan.get("authorizes_execution") is not False:
        raise HandoffRefused("proposal_not_allowed")
    steps = plan.get("steps") or []
    if step_number > len(steps):
        raise HandoffRefused("proposal_not_found")
    step = steps[step_number - 1]
    tool = step.get("tool") or {}
    key = (tool.get("id"), tool.get("version"))
    agent = plan.get("agent") or {}
    if key != intent.write_tool or (agent.get("id"), agent.get("version")) != intent.specialist:
        raise HandoffRefused("proposal_changed")
    arguments = step.get("arguments")

    try:
        context = fresh_context(client, user, intent=intent, planning=planning, clock=clock)
        check_proposal_against_facts(key, arguments, context.facts)
    except ContextRefused as exc:
        raise HandoffRefused(exc.code) from None
    except GatewayBlocked as exc:
        raise HandoffRefused(exc.reason) from None
    except PlanRejected as exc:
        raise HandoffRefused("proposal_stale" if exc.code != "context_missing" else exc.code) from None

    captured: dict = {}
    hstore = HandoffStore(client)

    def store_admit(**kwargs: Any) -> dict:
        result = hstore.admit(planning_run_id=run_id, plan_digest=plan_digest, step_number=step_number,
                              proposal_ttl_seconds=PROPOSAL_TTL_SECONDS, **kwargs)
        captured.update(result)
        return result

    try:
        admission = admit_tool_run(
            GatewayStore(client), user, tool_id=key[0], tool_version=key[1], arguments=arguments,
            idempotency_key=f"handoff:{run_id}:{step_number}", app_env=app_env, settings=settings, clock=clock,
            correlation_id=f"handoff:{run_id}"[:100], deadline_seconds=deadline_seconds,
            agent_id=intent.specialist[0], agent_version=intent.specialist[1], store_admit=store_admit)
    except GatewayRefused as exc:
        raise HandoffRefused(exc.code) from None
    if not captured.get("handoff_id"):
        raise HandoffRefused("handoff_not_recorded")
    return HandoffAdmission(handoff_id=str(captured["handoff_id"]), gateway_run_id=admission.run_id,
                            invocation_id=admission.invocation_id, created=admission.created, state=admission.state)


def handoff_status(client: Any, user: CurrentUser, handoff_id: str) -> dict:
    """The handoff, its gateway run state, approval state and execution outcome. Hotel-scoped; visible to the
    initiator and to anyone who could approve it."""
    user = _user(user)
    found = HandoffStore(client).get(tenant_id=user.hotel_id, handoff_id=_uuid(handoff_id))
    if not found or not found.get("handoff"):
        raise HandoffRefused("not_found")
    approval = found.get("approval") or {}
    initiator = str(found["handoff"].get("submitted_by_user_id"))
    approver_roles = approval.get("required_approver_roles") or []
    if user.user_id != initiator and user.role not in approver_roles:
        raise HandoffRefused("not_found")
    return found


def _approval_id(client: Any, user: CurrentUser, handoff_id: str) -> str:
    found = handoff_status(client, user, handoff_id)
    approval = found.get("approval") or {}
    if not approval.get("id"):
        raise HandoffRefused("approval_not_requested")
    return str(approval["id"])


def approve(client: Any, user: CurrentUser, handoff_id: str, *, reason_code: Optional[str] = None) -> dict:
    """A DIFFERENT, currently authorized manager approves (independence and authority enforced in the database)."""
    try:
        return approvals.approve(GatewayStore(client), _user(user), _approval_id(client, user, handoff_id),
                                 reason_code=reason_code)
    except GatewayRefused as exc:
        raise HandoffRefused(exc.code) from None


def reject(client: Any, user: CurrentUser, handoff_id: str, *, reason_code: Optional[str] = None) -> dict:
    try:
        return approvals.reject(GatewayStore(client), _user(user), _approval_id(client, user, handoff_id),
                                reason_code=reason_code)
    except GatewayRefused as exc:
        raise HandoffRefused(exc.code) from None


def cancel(client: Any, user: CurrentUser, handoff_id: str) -> dict:
    """The initiator withdraws the proposal before execution (revokes any unconsumed approval, cancels the run)."""
    user = _user(user)
    result = HandoffStore(client).cancel(tenant_id=user.hotel_id, handoff_id=_uuid(handoff_id),
                                         actor_user_id=user.user_id)
    if not result.get("ok"):
        raise HandoffRefused(str(result.get("reason") or "cancel_refused"))
    return result


def dismiss(client: Any, user: CurrentUser, planning_run_id: str, *, reason_code: Optional[str] = None) -> dict:
    """The initiator records that they reviewed the recommendation and will not act on it (audit only)."""
    user = _user(user)
    if reason_code is not None and (not isinstance(reason_code, str) or not _REASON_RE.match(reason_code)):
        raise HandoffRefused("invalid_reason_code")
    result = HandoffStore(client).dismiss(tenant_id=user.hotel_id, run_id=_uuid(planning_run_id),
                                          actor_user_id=user.user_id, reason_code=reason_code)
    if not result.get("ok"):
        raise HandoffRefused(str(result.get("reason") or "dismiss_refused"))
    return result
