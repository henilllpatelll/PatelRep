"""Strict planning schema (``patelrep.plan/v1``) and the deterministic validator every model plan must pass.

The model fills ``PlanDraft`` (a strict structured-output schema). Nothing in it is trusted: ``validate_plan`` re-parses
it and checks it against SERVER-owned configuration only -- the intent's candidate agents, the H2 gateway's frozen
bindings and strict input schemas, the run's verified resource and the planning limits. A plan cannot name a hotel, a
role, an approval, a credential or an authorization decision: identity/authority keys are refused at any depth of the
proposed arguments (H2 ``validate_arguments``), and the draft schema has no field for them.

A validated plan is a PROPOSAL. ``authorizes_execution`` is always false; write proposals are labelled
``requires_human_approval``. Nothing here (or anywhere in H3) submits a proposal to the Tool Gateway.
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, ValidationError

from services.agent_gateway.bindings import GATEWAY_BINDINGS
from services.agent_gateway.catalog import GATEWAY_AGENTS
from services.agent_gateway.schema import SchemaViolation, canonical_json, validate_arguments
from services.agent_harness.vocabulary import AccessMode

PLAN_SCHEMA_V1 = "patelrep.plan/v1"
MAX_DRAFT_BYTES = 16_384
MAX_ARGUMENTS_BYTES = 4_096

ReasonCode = Literal["insufficient_context", "out_of_scope", "requires_human_judgement", "tool_unavailable",
                     "conflicting_instructions", "unsafe_request", "work_order_already_assigned",
                     "no_eligible_assignee"]
REASON_CODES = frozenset(ReasonCode.__args__)  # type: ignore[attr-defined]


class ProposedToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_id: str
    tool_version: int
    arguments_json: str
    expected_result: Literal["record_summary", "assignment_change"]


class DraftStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step_number: int
    purpose: Literal["gather_context", "propose_change"]
    tool_call: ProposedToolCall
    depends_on: list[int]


class PlanDraft(BaseModel):
    """What the model is asked to produce. Deliberately minimal and free of identity or authority fields."""

    model_config = ConfigDict(extra="forbid")

    plan_schema: Literal["patelrep.plan/v1"]
    outcome: Literal["propose", "refuse", "escalate"]
    agent_id: str
    agent_version: int
    steps: list[DraftStep]
    termination: Literal["after_last_step", "on_first_failure"]
    reason_codes: list[ReasonCode]


@dataclass(frozen=True)
class IntentSpec:
    intent: str
    version: int
    resource_type: str
    workload: str
    candidate_agents: tuple[tuple[str, int], ...]
    allowed_tools: frozenset[tuple[str, int]]
    resource_argument: Mapping[tuple[str, int], str]  # tool -> argument that must equal the verified resource id
    initiator_roles: frozenset[str]
    description: str


@dataclass(frozen=True)
class PlanLimits:
    max_steps: int = 4
    max_tool_proposals: int = 4
    max_write_proposals: int = 1
    max_delegation_depth: int = 0  # H3: no delegation, no recursive autonomy


@dataclass(frozen=True)
class ValidatedPlan:
    outcome: str  # proposed | refused | escalated
    plan: dict
    digest: str
    reason_codes: tuple[str, ...]
    proposal_count: int


class PlanRejected(Exception):
    """The draft failed deterministic validation. ``code`` is a stable slug; the draft content is never echoed."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _strict_loads(text: str) -> Any:
    def no_duplicates(pairs: list[tuple[str, Any]]) -> dict:
        keys = [k for k, _ in pairs]
        if len(keys) != len(set(keys)):
            raise PlanRejected("duplicate_keys")
        return dict(pairs)

    def no_constants(value: str) -> Any:
        raise PlanRejected("non_finite_number")

    return json.loads(text, object_pairs_hook=no_duplicates, parse_constant=no_constants)


def parse_draft(raw: Any) -> PlanDraft:
    """Accept the model's JSON text or an already-parsed mapping; re-validate strictly either way."""
    if isinstance(raw, PlanDraft):
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
        return PlanDraft.model_validate(raw, strict=True)
    except ValidationError:
        raise PlanRejected("draft_schema_violation") from None


def _jsonable(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        raise PlanRejected("non_finite_number")
    if isinstance(value, Mapping):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def validate_plan(raw: Any, *, intent: IntentSpec, resource_id: str, limits: PlanLimits = PlanLimits()) -> ValidatedPlan:
    if limits.max_delegation_depth != 0:
        raise PlanRejected("delegation_not_supported")
    draft = parse_draft(raw)
    agent_key = (draft.agent_id, draft.agent_version)
    if agent_key not in intent.candidate_agents:
        raise PlanRejected("agent_not_candidate")
    agent = GATEWAY_AGENTS.get(draft.agent_id, draft.agent_version)
    if agent is None or not agent.enabled:
        raise PlanRejected("agent_not_registered")
    if len(set(draft.reason_codes)) != len(draft.reason_codes) or len(draft.reason_codes) > 4:
        raise PlanRejected("invalid_reason_codes")

    if draft.outcome in ("refuse", "escalate"):
        if draft.steps or not draft.reason_codes:
            raise PlanRejected("non_proposal_requires_reasons_and_no_steps")
        body = {"plan_schema": PLAN_SCHEMA_V1, "outcome": draft.outcome,
                "agent": {"id": draft.agent_id, "version": draft.agent_version}, "steps": [],
                "termination": draft.termination, "reason_codes": sorted(draft.reason_codes)}
        return _finish(body, "refused" if draft.outcome == "refuse" else "escalated", 0)

    if not 1 <= len(draft.steps) <= limits.max_steps:
        raise PlanRejected("step_count_out_of_bounds")
    pins = {ref.key for ref in agent.tools}
    steps, writes = [], 0
    for index, step in enumerate(draft.steps, start=1):
        if step.step_number != index:
            raise PlanRejected("steps_not_sequential")
        if any(not isinstance(d, int) or isinstance(d, bool) or not 1 <= d < index for d in step.depends_on) \
                or len(set(step.depends_on)) != len(step.depends_on):
            raise PlanRejected("invalid_dependency")
        call = step.tool_call
        key = (call.tool_id, call.tool_version)
        binding = GATEWAY_BINDINGS.resolve_untrusted(call.tool_id, call.tool_version)
        if binding is None or key not in pins or key not in intent.allowed_tools:
            raise PlanRejected("tool_not_allowed")  # hallucinated, wrong version, or outside this intent
        spec = binding.spec
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
        resource_arg = intent.resource_argument.get(key)
        if resource_arg is None or arguments.get(resource_arg) != resource_id:
            raise PlanRejected("resource_out_of_scope")
        is_write = spec.access is AccessMode.WRITE
        if (call.expected_result == "assignment_change") != is_write or (step.purpose == "propose_change") != is_write:
            raise PlanRejected("purpose_mismatch")
        writes += int(is_write)
        steps.append({"step_number": index, "purpose": step.purpose, "depends_on": sorted(step.depends_on),
                      "tool": {"id": spec.tool_id, "version": spec.version, "access": spec.access.value,
                               "requires_human_approval": is_write},
                      "arguments": arguments, "expected_result": call.expected_result})
    if len(steps) > limits.max_tool_proposals or writes > limits.max_write_proposals:
        raise PlanRejected("too_many_proposals")
    body = {"plan_schema": PLAN_SCHEMA_V1, "outcome": "propose",
            "agent": {"id": draft.agent_id, "version": draft.agent_version}, "steps": steps,
            "termination": draft.termination, "reason_codes": sorted(draft.reason_codes)}
    return _finish(body, "proposed", len(steps))


def _finish(body: dict, outcome: str, proposals: int) -> ValidatedPlan:
    body["proposal_only"] = True
    body["authorizes_execution"] = False
    encoded = canonical_json(body)
    return ValidatedPlan(outcome=outcome, plan=json.loads(encoded), digest=hashlib.sha256(encoded).hexdigest(),
                         reason_codes=tuple(body["reason_codes"]), proposal_count=proposals)
