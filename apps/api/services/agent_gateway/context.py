"""Verified planning context for the H5 specialists (ADR-0004 decision 4).

Before a specialist plans, the worker gathers a small snapshot of CURRENT facts about the one resource the planning
request names. Each fact is produced by a reviewed read tool through the same sequence a gateway read step uses:

  exact binding + agent pin -> strict arguments -> server-side resource resolution in the TRUSTED hotel
  -> fresh authorization snapshot (controls, entitlement, grants) -> H0 ``policy.evaluate`` under the INITIATOR's
  identity reloaded just now -> bounded read under its timeout -> redaction + output schema + size limits

No model is involved and nothing is written. The snapshot is the evidence the deterministic plan validator checks
every proposal against (a model cannot invent an eligible assignee, an owner, a date or a room state). It is handed
to the model as untrusted data and never as instructions.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Mapping

from services.agent_execution.identity_authority import revalidate_principal
from services.agent_gateway.authorization import block_reason, db_now, policy_inputs
from services.agent_gateway.errors import GatewayBlocked, GatewayRefused, OutputRejected, ToolTimeout
from services.agent_gateway.gateway import agent_for, decide, prepare
from services.agent_gateway.output import enforce_output
from services.agent_gateway.steps import run_with_timeout, tool_roles
from services.agent_gateway.store import GatewayStore
from services.agent_gateway.schema import canonical_json
from services.agent_harness.controls import require_tool_executable
from services.agent_harness.errors import IdentityError
from services.agent_harness.identity import IdentityAuthority
from services.agent_harness.policy import Outcome
from services.agent_harness.vocabulary import AccessMode

MAX_CONTEXT_READS = 4


class ContextRefused(Exception):
    """The context cannot be gathered for an authorization or data reason (terminal for this planning run)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ContextRead:
    tool_id: str
    tool_version: int
    resource_argument: str  # the read's single argument; always the planning request's verified resource id


@dataclass(frozen=True)
class VerifiedContext:
    agent_id: str
    agent_version: int
    resource_type: str
    resource_id: str
    facts: Mapping[str, dict]  # "tool_id@version" -> enforced output
    digest: str

    def fact(self, tool_id: str, version: int) -> dict:
        return dict(self.facts.get(f"{tool_id}@{version}") or {})

    def as_prompt_data(self) -> dict:
        return {"kind": "verified_context", "trusted_instructions": False, "resource":
                {"type": self.resource_type, "id": self.resource_id}, "facts": dict(self.facts)}


def gather_verified_context(
    gstore: GatewayStore, *, run: Mapping[str, Any], agent_key: tuple[str, int], resource_type: str, resource_id: str,
    reads: tuple[ContextRead, ...], authority: IdentityAuthority, clock: Callable[[], datetime], process_enabled: bool,
) -> VerifiedContext:
    if not reads or len(reads) > MAX_CONTEXT_READS:
        raise ContextRefused("context_reads_out_of_bounds")
    try:
        agent = agent_for(*agent_key)
    except GatewayRefused as exc:
        raise ContextRefused(exc.code) from None
    hotel = str(run["tenant_id"])
    snapshot = gstore.authorization_snapshot(tenant_id=hotel, agent_id=agent.agent_id, agent_version=agent.agent_version)
    facts: dict[str, dict] = {}
    for read in reads:
        prepared_args = {read.resource_argument: resource_id}
        try:
            prepared = prepare(gstore.client, hotel_id=hotel, agent=agent, tool_id=read.tool_id,
                               tool_version=read.tool_version, arguments=prepared_args)
        except GatewayRefused as exc:
            raise ContextRefused(exc.code) from None
        spec = prepared.binding.spec
        if spec.access is not AccessMode.READ or spec.resource_type.value != resource_type:
            raise ContextRefused("context_tool_not_read")
        require_tool_executable(spec.key)
        # The initiator, re-read from authoritative membership, acting through THIS specialist agent version.
        specialist_run = {**dict(run), "agent_id": agent.agent_id, "agent_version": agent.agent_version}
        try:
            ctx = revalidate_principal(specialist_run, authority, clock=clock, required_roles=tool_roles(prepared.binding))
        except IdentityError as exc:
            raise ContextRefused(exc.code) from None
        blocked = block_reason(snapshot, hotel_id=hotel, agent_id=agent.agent_id, tool_id=spec.tool_id)
        if blocked:
            raise GatewayBlocked(blocked)
        if not process_enabled:
            raise GatewayBlocked("process_execution_disabled")
        now = max(clock(), db_now(snapshot) or clock())
        inputs = policy_inputs(snapshot, hotel_id=hotel, agent_id=agent.agent_id, process_enabled=process_enabled,
                               now=now)
        decision = decide(ctx, prepared, inputs, now=now)
        if decision.outcome is not Outcome.ALLOW or not decision.authorizes_execution:
            raise ContextRefused(decision.reason.value)
        if not any(g.tool_id == spec.tool_id and g.tool_version == spec.version for g in inputs.grants):
            raise ContextRefused("tool_not_granted")  # observe-level grant per (agent version, tool version)
        try:
            raw = run_with_timeout(lambda: prepared.binding.read(gstore.client, hotel, prepared.resource),
                                   spec.timeout_seconds)
        except ToolTimeout:
            raise ContextRefused("context_read_timeout") from None
        if raw is None:
            raise ContextRefused("resource_not_found")
        try:
            facts[f"{spec.tool_id}@{spec.version}"] = enforce_output(spec, raw)
        except OutputRejected as exc:
            raise ContextRefused(exc.code) from None
    digest = hashlib.sha256(canonical_json({"agent": list(agent.key), "resource": [resource_type, resource_id],
                                            "facts": facts})).hexdigest()
    return VerifiedContext(agent_id=agent.agent_id, agent_version=agent.agent_version, resource_type=resource_type,
                           resource_id=resource_id, facts=facts, digest=digest)
