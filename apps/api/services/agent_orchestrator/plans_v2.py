"""``patelrep.plan/v2``: the H5 specialist plan schema and its deterministic validator (ADR-0004 decision 5).

The model sees a verified context snapshot (server facts) and returns a ``PlanDraftV2``. Nothing in the draft is
trusted. ``validate_plan_v2`` re-parses it strictly and checks it against SERVER data only:

  * the intent: candidate agent, exact tool versions, the single allowed write, closed findings vocabulary
  * the H2 gateway: frozen bindings and strict input schemas (identity/approval keys refused at any depth)
  * the verified context: every finding must be TRUE of the facts (a model cannot claim a work order is overdue or a
    room is blocked when it is not); a proposed assignee must be a verified eligible candidate; the expected current
    owner must equal the verified owner; a Housekeeping date must equal the verified hotel day; a blocked or closed
    resource cannot receive a proposal; a no-op proposal is refused
  * limits: at most one proposal (one write), delegation depth 0

Outcomes: ``recommended`` (findings only, nothing to execute), ``proposed`` (exactly one human-approved write
proposal), ``refused`` / ``escalated`` (reason codes, no steps). Every validated plan is ``proposal_only`` and
``authorizes_execution`` is false; the H5 handoff is the only path from a proposal to the Tool Gateway.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Literal, Mapping, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from services.agent_gateway.bindings import GATEWAY_BINDINGS
from services.agent_gateway.catalog import GATEWAY_AGENTS
from services.agent_gateway.schema import SchemaViolation, canonical_json, validate_arguments
from services.agent_harness.vocabulary import AccessMode
from services.agent_orchestrator.intents import PLAN_SCHEMA_V2
from services.agent_orchestrator.plans import (
    MAX_ARGUMENTS_BYTES,
    MAX_DRAFT_BYTES,
    IntentSpec,
    PlanLimits,
    PlanRejected,
    ValidatedPlan,
    _jsonable,
    _strict_loads,
)

FindingCode = Literal[
    "work_order_overdue", "work_order_unassigned", "work_order_high_priority", "work_order_on_hold",
    "work_order_escalated", "work_order_closed", "work_order_due_soon", "assignee_has_lowest_workload",
    "no_eligible_engineer", "already_assigned", "reassignment_suggested", "room_unassigned", "room_dnd",
    "room_service_declined", "room_return_later", "room_occupancy_discrepancy", "room_not_assignable",
    "cleaning_started", "room_occupied_dirty", "room_vacant_dirty", "room_inactive", "no_eligible_housekeeper"]
ReasonCodeV2 = Literal[
    "insufficient_context", "out_of_scope", "requires_human_judgement", "tool_unavailable",
    "conflicting_instructions", "unsafe_request", "work_order_already_assigned", "no_eligible_assignee",
    "room_blocked", "resource_closed", "assignment_not_needed"]

_WO_FACTS = ("engineering.work_orders.lookup", 2)
_WO_CANDIDATES = ("engineering.work_orders.assignment_candidates", 1)
_ROOM_READINESS = ("housekeeping.rooms.readiness_lookup", 1)
_HK_CANDIDATES = ("housekeeping.room_assignments.candidates", 1)
_WO_ASSIGNABLE = frozenset({"open", "escalated", "in_progress", "on_hold"})
MAX_FINDINGS = 6


class ProposedChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_id: str
    tool_version: int
    arguments_json: str
    expected_result: Literal["assignment_change"]


class DraftStepV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step_number: int
    purpose: Literal["propose_change"]
    tool_call: ProposedChange
    depends_on: list[int]


class PlanDraftV2(BaseModel):
    """The model's output. No identity, authority, approval, hotel, role or date-of-truth field exists here."""

    model_config = ConfigDict(extra="forbid")

    plan_schema: Literal["patelrep.plan/v2"]
    outcome: Literal["recommend", "propose_change", "refuse", "escalate"]
    agent_id: str
    agent_version: int
    findings: list[FindingCode]
    priority: Literal["urgent", "high", "normal", "low", "not_assessed"]
    steps: list[DraftStepV2]
    reason_codes: list[ReasonCodeV2]


def _ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _fact(facts: Mapping[str, Any], key: tuple[str, int]) -> dict:
    value = facts.get(f"{key[0]}@{key[1]}")
    return dict(value) if isinstance(value, Mapping) else {}


def _candidates(facts: Mapping[str, Any]) -> dict[str, int]:
    for key, count_field in ((_WO_CANDIDATES, "open_work_orders"), (_HK_CANDIDATES, "rooms_assigned_today")):
        rows = _fact(facts, key).get("candidates")
        if isinstance(rows, list):
            return {str(r["staff_id"]): int(r[count_field]) for r in rows if isinstance(r, Mapping)}
    return {}


def _owner(facts: Mapping[str, Any]) -> tuple[bool, Optional[str]]:
    if _fact(facts, _WO_FACTS):
        return True, _fact(facts, _WO_FACTS).get("assigned_to")
    if _fact(facts, _ROOM_READINESS):
        return True, _fact(facts, _ROOM_READINESS).get("current_assigned_to")
    return False, None


def _finding_holds(code: str, facts: Mapping[str, Any], now: datetime, proposal: Optional[dict]) -> bool:
    wo, room = _fact(facts, _WO_FACTS), _fact(facts, _ROOM_READINESS)
    blockers = set(room.get("blockers") or [])
    status, due = wo.get("status"), _ts(wo.get("due_at"))
    candidates = _candidates(facts)
    checks: dict[str, Callable[[], bool]] = {
        "work_order_overdue": lambda: status in _WO_ASSIGNABLE and due is not None and due < now,
        "work_order_due_soon": lambda: status in _WO_ASSIGNABLE and due is not None and now <= due <= now + timedelta(hours=24),
        "work_order_unassigned": lambda: bool(wo) and status in _WO_ASSIGNABLE and not wo.get("assigned_to"),
        "work_order_high_priority": lambda: wo.get("priority") in ("emergency", "urgent"),
        "work_order_on_hold": lambda: status == "on_hold",
        "work_order_escalated": lambda: status == "escalated",
        "work_order_closed": lambda: status in ("completed", "cancelled"),
        "room_unassigned": lambda: bool(room) and room.get("current_assigned_to") is None,
        "room_dnd": lambda: "dnd" in blockers,
        "room_service_declined": lambda: "service_declined" in blockers,
        "room_return_later": lambda: "return_later" in blockers,
        "room_occupancy_discrepancy": lambda: "occupancy_discrepancy" in blockers,
        "room_not_assignable": lambda: "room_not_assignable" in blockers,
        "cleaning_started": lambda: "cleaning_started" in blockers,
        "room_inactive": lambda: "room_inactive" in blockers,
        "room_occupied_dirty": lambda: room.get("status") == "OCCUPIED",
        "room_vacant_dirty": lambda: room.get("status") == "DIRTY" and room.get("fo_status") == "VAC",
        "no_eligible_engineer": lambda: bool(_fact(facts, _WO_CANDIDATES)) and not candidates,
        "no_eligible_housekeeper": lambda: bool(_fact(facts, _HK_CANDIDATES)) and not candidates,
        "already_assigned": lambda: _owner(facts)[0] and _owner(facts)[1] is not None,
        "reassignment_suggested": lambda: proposal is not None and proposal.get("expected_assigned_to") is not None,
        "assignee_has_lowest_workload": lambda: proposal is not None and bool(candidates) and
            candidates.get(str(proposal.get("assignee_user_id")), -1) == min(candidates.values()),
    }
    check = checks.get(code)
    return bool(check and check())


def parse_draft_v2(raw: Any) -> PlanDraftV2:
    if isinstance(raw, PlanDraftV2):
        raw = raw.model_dump(mode="json")
    if isinstance(raw, str):
        if len(raw.encode("utf-8")) > MAX_DRAFT_BYTES:
            raise PlanRejected("draft_too_large")
        try:
            raw = _strict_loads(raw)
        except PlanRejected:
            raise
        except (ValueError, RecursionError):
            raise PlanRejected("draft_not_json") from None
    if not isinstance(raw, Mapping):
        raise PlanRejected("draft_not_object")
    if len(canonical_json(_jsonable(raw))) > MAX_DRAFT_BYTES:
        raise PlanRejected("draft_too_large")
    try:
        return PlanDraftV2.model_validate(raw, strict=True)
    except ValidationError:
        raise PlanRejected("draft_schema_violation") from None


def _check_proposal(intent: IntentSpec, agent_pins: set, draft: PlanDraftV2, resource_id: str,
                    facts: Mapping[str, Any]) -> dict:
    if intent.write_tool is None:
        raise PlanRejected("proposal_not_allowed_for_intent")
    if len(draft.steps) != 1:
        raise PlanRejected("too_many_proposals")
    step = draft.steps[0]
    if step.step_number != 1 or step.depends_on:
        raise PlanRejected("invalid_dependency")
    call = step.tool_call
    key = (call.tool_id, call.tool_version)
    binding = GATEWAY_BINDINGS.resolve_untrusted(call.tool_id, call.tool_version)
    if binding is None or key not in agent_pins or key not in intent.allowed_tools or key != intent.write_tool:
        raise PlanRejected("tool_not_allowed")  # hallucinated, wrong version, a read, or another department's write
    spec = binding.spec
    if spec.access is not AccessMode.WRITE:
        raise PlanRejected("purpose_mismatch")
    if len(call.arguments_json.encode("utf-8")) > MAX_ARGUMENTS_BYTES:
        raise PlanRejected("arguments_too_large")
    try:
        arguments = validate_arguments(_strict_loads(call.arguments_json), spec.input_schema)
    except PlanRejected:
        raise
    except SchemaViolation as exc:
        raise PlanRejected("untrusted_identity_claim" if exc.code == "untrusted_identity_claim"
                           else "invalid_arguments") from None
    except (ValueError, RecursionError):
        raise PlanRejected("invalid_arguments") from None
    if arguments.get(intent.resource_argument.get(key, "")) != resource_id:
        raise PlanRejected("resource_out_of_scope")
    check_proposal_against_facts(key, arguments, facts)
    return {"step_number": 1, "purpose": "propose_change", "depends_on": [],
            "tool": {"id": spec.tool_id, "version": spec.version, "access": spec.access.value,
                     "requires_human_approval": True},
            "arguments": arguments, "expected_result": "assignment_change"}


def check_proposal_against_facts(key: tuple[str, int], arguments: Mapping[str, Any], facts: Mapping[str, Any]) -> None:
    """The proposal must still match VERIFIED facts. Used at planning time and again by the handoff (fresh facts)."""
    candidates = _candidates(facts)
    known, owner = _owner(facts)
    if not known or not _fact(facts, _WO_CANDIDATES if key[0].startswith("engineering.") else _HK_CANDIDATES):
        raise PlanRejected("context_missing")
    assignee = arguments.get("assignee_user_id")
    if assignee not in candidates:
        raise PlanRejected("assignee_not_verified_eligible")
    if arguments.get("expected_assigned_to") != owner:
        raise PlanRejected("expected_owner_mismatch")
    if assignee == owner:
        raise PlanRejected("proposal_is_noop")
    if key[0].startswith("engineering."):
        if _fact(facts, _WO_FACTS).get("status") not in _WO_ASSIGNABLE:
            raise PlanRejected("resource_closed")
    else:
        room = _fact(facts, _ROOM_READINESS)
        if room.get("assignable") is not True or room.get("blockers"):
            raise PlanRejected("room_blocked")
        if arguments.get("assignment_date") != room.get("hotel_date"):
            raise PlanRejected("date_not_hotel_today")


def validate_plan_v2(raw: Any, *, intent: IntentSpec, resource_id: str, facts: Mapping[str, Any], context_digest: str,
                     now: datetime, limits: PlanLimits = PlanLimits()) -> ValidatedPlan:
    if limits.max_delegation_depth != 0:
        raise PlanRejected("delegation_not_supported")
    if intent.plan_schema != PLAN_SCHEMA_V2:
        raise PlanRejected("plan_schema_mismatch")
    draft = parse_draft_v2(raw)
    agent_key = (draft.agent_id, draft.agent_version)
    if agent_key not in intent.candidate_agents:
        raise PlanRejected("agent_not_candidate")
    agent = GATEWAY_AGENTS.get(draft.agent_id, draft.agent_version)
    if agent is None or not agent.enabled:
        raise PlanRejected("agent_not_registered")
    if len(set(draft.reason_codes)) != len(draft.reason_codes) or len(draft.reason_codes) > 4:
        raise PlanRejected("invalid_reason_codes")
    if len(set(draft.findings)) != len(draft.findings) or len(draft.findings) > MAX_FINDINGS:
        raise PlanRejected("invalid_findings")
    if not set(draft.findings) <= intent.allowed_findings:
        raise PlanRejected("finding_not_allowed_for_intent")

    steps: list[dict] = []
    if draft.outcome in ("refuse", "escalate"):
        if draft.steps or not draft.reason_codes:
            raise PlanRejected("non_proposal_requires_reasons_and_no_steps")
        outcome = "refused" if draft.outcome == "refuse" else "escalated"
    elif draft.outcome == "recommend":
        if draft.steps or not draft.findings:
            raise PlanRejected("recommendation_requires_findings_and_no_steps")
        outcome = "recommended"
    else:
        if not draft.findings:
            raise PlanRejected("proposal_requires_findings")
        steps = [_check_proposal(intent, {r.key for r in agent.tools}, draft, resource_id, facts)]
        outcome = "proposed"
    if len(steps) > min(limits.max_tool_proposals, limits.max_write_proposals):
        raise PlanRejected("too_many_proposals")
    proposal = steps[0]["arguments"] if steps else None
    unsupported = [f for f in draft.findings if not _finding_holds(f, facts, now, proposal)]
    if unsupported:
        raise PlanRejected("finding_not_supported_by_facts")

    body = {"plan_schema": PLAN_SCHEMA_V2, "outcome": outcome,
            "intent": {"id": intent.intent, "version": intent.version},
            "agent": {"id": draft.agent_id, "version": draft.agent_version},
            "resource": {"type": intent.resource_type, "id": resource_id},
            "findings": sorted(draft.findings), "priority": draft.priority, "steps": steps,
            "reason_codes": sorted(draft.reason_codes), "context_digest": context_digest,
            "proposal_only": True, "authorizes_execution": False}
    encoded = canonical_json(body)
    return ValidatedPlan(outcome=outcome, plan=json.loads(encoded), digest=hashlib.sha256(encoded).hexdigest(),
                         reason_codes=tuple(body["reason_codes"]), proposal_count=len(steps))
