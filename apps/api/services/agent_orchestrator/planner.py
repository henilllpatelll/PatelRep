"""The replaceable planner interface and its OpenAI Agents SDK implementation.

``Planner.plan`` returns the model's DRAFT (untrusted); the orchestrator validates it deterministically afterwards.
Swapping the SDK for another runtime means another ``Planner`` -- the boundary, ledger, catalog and validator stay.

``AgentsSdkPlanner`` builds an ``Agent`` with a strict ``PlanDraft`` output type, NO tools and NO handoffs, and runs it
with ``max_turns`` from the limits, a refusing model provider, runner retries disabled and tracing off. Its model is a
``BudgetedModel``, so every SDK request is a separately reserved attempt.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Protocol

from agents import Agent, Runner
from agents.agent_output import AgentOutputSchema
from agents.exceptions import AgentsException, MaxTurnsExceeded, ModelBehaviorError

from services.agent_harness.metering import Provider
from services.agent_orchestrator.boundary import BudgetedCaller
from services.agent_orchestrator.catalog import WorkloadClass
from services.agent_orchestrator.errors import InvalidModelOutput, OrchestratorError
from services.agent_orchestrator.plans import PlanDraft
from services.agent_orchestrator.sdk_model import BudgetedModel, planning_run_config


@dataclass(frozen=True)
class PlannerInput:
    instructions: str
    user_message: str
    workload: WorkloadClass
    max_output_tokens: int
    max_turns: int
    override: Optional[tuple[Provider, str]] = None
    output_type: type = PlanDraft  # PlanDraftV2 for the H5 specialist intents (plan schema v2)


class Planner(Protocol):
    async def plan(self, request: PlannerInput, *, caller: BudgetedCaller) -> Any:
        """Return the untrusted draft (a mapping, JSON text or ``PlanDraft``)."""
        ...


def _unwrap(exc: BaseException) -> Optional[OrchestratorError]:
    current: Optional[BaseException] = exc
    for _ in range(8):
        if current is None:
            return None
        if isinstance(current, OrchestratorError):
            return current
        current = current.__cause__ or current.__context__
    return None


class AgentsSdkPlanner:
    async def plan(self, request: PlannerInput, *, caller: BudgetedCaller) -> Any:
        model = BudgetedModel(caller, workload=request.workload, max_output_tokens=request.max_output_tokens,
                              override=request.override)
        agent = Agent(name="patelrep_orchestrator", instructions=request.instructions, model=model,
                      output_type=AgentOutputSchema(request.output_type, strict_json_schema=True), tools=[], handoffs=[])
        try:
            result = await Runner.run(agent, request.user_message, max_turns=request.max_turns,
                                      run_config=planning_run_config(max_output_tokens=request.max_output_tokens))
        except OrchestratorError:
            raise
        except AgentsException as exc:
            inner = _unwrap(exc)  # an H3 error the runner wrapped keeps its meaning (budget, uncertain, blocked...)
            if inner is not None:
                raise inner from None
            code = "max_planning_turns_exceeded" if isinstance(exc, MaxTurnsExceeded) else (
                "invalid_model_output" if isinstance(exc, ModelBehaviorError) else "planner_runtime_error")
            raise InvalidModelOutput(code) from None
        final = result.final_output
        if isinstance(final, request.output_type):
            return final.model_dump(mode="json")
        if model.last_text is not None:
            return model.last_text
        raise InvalidModelOutput()
