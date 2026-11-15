"""Reviewed model catalog and capability-aware routing (catalog version ``h3.1``).

Changing a model, its caps or a route is a reviewed edit to THIS data, never to the orchestration algorithm. Every
model here has an exact identifier verified against the pinned SDK's model literals and the provider's model page,
and a schedule in ``pricebook.py``.

Routing rules (``resolve_route``): the primary, every fallback and any override must be in the catalog, support the
workload, offer a structured-output mechanism, accept the bounded input/output, have an effective price schedule, and
be marked available. A fallback or override may never have a higher maximum exposure than the reviewed primary for the
same bounded request -- there is no silent upgrade and no fallback outside the reviewed list. Unknown -> RoutingError.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum
from types import MappingProxyType
from typing import Iterable, Mapping, Optional

from services.agent_harness.metering import Provider
from services.agent_harness.provider_pricing import ProviderPriceBook, TieredPriceSchedule, max_exposure
from services.agent_orchestrator.errors import RoutingError
from services.agent_orchestrator.pricebook import PRICE_BOOK

CATALOG_VERSION = "h3.1"


class WorkloadClass(str, Enum):
    FAST_CLASSIFICATION = "fast_classification"
    ROUTINE_REASONING = "routine_reasoning"
    STRUCTURED_TOOL_PROPOSALS = "structured_tool_proposals"
    MULTISTEP_PLANNING = "multistep_planning"
    COMPLEX_ANALYSIS = "complex_analysis"


class StructuredOutputMode(str, Enum):
    OPENAI_JSON_SCHEMA_STRICT = "openai_responses_text_format_json_schema_strict"
    ANTHROPIC_OUTPUT_FORMAT = "anthropic_messages_output_config_format_json_schema"


@dataclass(frozen=True)
class ModelSpec:
    provider: Provider
    model_id: str
    structured_output: StructuredOutputMode
    context_window: int
    max_input_tokens: int  # reviewed cap, below every long-context price threshold
    max_output_tokens: int  # reviewed cap (reasoning/thinking tokens count against it)
    request_overhead_tokens: int  # allowance for provider-side system/schema tokens not present in our bytes
    reasoning_efforts: frozenset[str]
    workloads: frozenset[WorkloadClass]
    streaming: bool = False  # H3 never streams; kept explicit for review
    available: bool = True

    @property
    def key(self) -> tuple[Provider, str]:
        return (self.provider, self.model_id)


_EFFORTS = frozenset({"low", "medium", "high"})
_ALL_LIGHT = frozenset({WorkloadClass.FAST_CLASSIFICATION, WorkloadClass.ROUTINE_REASONING,
                        WorkloadClass.STRUCTURED_TOOL_PROPOSALS})
_HEAVY = frozenset({WorkloadClass.MULTISTEP_PLANNING, WorkloadClass.COMPLEX_ANALYSIS})

MODELS: tuple[ModelSpec, ...] = (
    ModelSpec(Provider.OPENAI, "gpt-6-luna", StructuredOutputMode.OPENAI_JSON_SCHEMA_STRICT, context_window=1_050_000,
              max_input_tokens=64_000, max_output_tokens=4_096, request_overhead_tokens=1_024,
              reasoning_efforts=_EFFORTS, workloads=_ALL_LIGHT),
    ModelSpec(Provider.ANTHROPIC, "claude-haiku-5-5", StructuredOutputMode.ANTHROPIC_OUTPUT_FORMAT,
              context_window=1_000_000, max_input_tokens=64_000, max_output_tokens=4_096, request_overhead_tokens=1_024,
              reasoning_efforts=_EFFORTS, workloads=_ALL_LIGHT),
    ModelSpec(Provider.OPENAI, "gpt-6.1-terra", StructuredOutputMode.OPENAI_JSON_SCHEMA_STRICT,
              context_window=1_050_000, max_input_tokens=64_000, max_output_tokens=8_192, request_overhead_tokens=1_024,
              reasoning_efforts=_EFFORTS, workloads=_HEAVY | {WorkloadClass.STRUCTURED_TOOL_PROPOSALS}),
    ModelSpec(Provider.ANTHROPIC, "claude-sonnet-5-5", StructuredOutputMode.ANTHROPIC_OUTPUT_FORMAT,
              context_window=1_000_000, max_input_tokens=64_000, max_output_tokens=8_192, request_overhead_tokens=1_024,
              reasoning_efforts=_EFFORTS, workloads=_HEAVY),
)

MODEL_CATALOG: Mapping[tuple[Provider, str], ModelSpec] = MappingProxyType({m.key: m for m in MODELS})


@dataclass(frozen=True)
class RouteSpec:
    workload: WorkloadClass
    primary: tuple[Provider, str]
    fallbacks: tuple[tuple[Provider, str], ...]
    reasoning_effort: str


_LUNA, _HAIKU = (Provider.OPENAI, "gpt-6-luna"), (Provider.ANTHROPIC, "claude-haiku-5-5")
_TERRA, _SONNET = (Provider.OPENAI, "gpt-6.1-terra"), (Provider.ANTHROPIC, "claude-sonnet-5-5")

ROUTES: Mapping[WorkloadClass, RouteSpec] = MappingProxyType({
    WorkloadClass.FAST_CLASSIFICATION: RouteSpec(WorkloadClass.FAST_CLASSIFICATION, _LUNA, (_HAIKU,), "low"),
    WorkloadClass.ROUTINE_REASONING: RouteSpec(WorkloadClass.ROUTINE_REASONING, _LUNA, (_HAIKU,), "low"),
    WorkloadClass.STRUCTURED_TOOL_PROPOSALS: RouteSpec(WorkloadClass.STRUCTURED_TOOL_PROPOSALS, _LUNA, (_HAIKU,), "low"),
    # No fallback: every reviewed alternative for heavy planning costs more than gpt-6.1-terra, and fallbacks may not.
    WorkloadClass.MULTISTEP_PLANNING: RouteSpec(WorkloadClass.MULTISTEP_PLANNING, _TERRA, (), "medium"),
    WorkloadClass.COMPLEX_ANALYSIS: RouteSpec(WorkloadClass.COMPLEX_ANALYSIS, _SONNET, (_TERRA,), "medium"),
})


@dataclass(frozen=True)
class Candidate:
    model: ModelSpec
    schedule: TieredPriceSchedule
    max_input_tokens: int  # this request's bound for this model (bytes + overhead)
    exposure_usd: Decimal


@dataclass(frozen=True)
class Route:
    workload: WorkloadClass
    reasoning_effort: str
    candidates: tuple[Candidate, ...]  # primary first, then reviewed fallbacks in order
    catalog_version: str = CATALOG_VERSION


def _candidate(key: tuple[Provider, str], workload: WorkloadClass, *, input_bytes: int, max_output_tokens: int,
               at: datetime, book: ProviderPriceBook, unavailable: frozenset) -> Optional[Candidate]:
    spec = MODEL_CATALOG.get(key)
    if spec is None or not spec.available or key in unavailable or workload not in spec.workloads:
        return None
    bound = input_bytes + spec.request_overhead_tokens
    if bound > spec.max_input_tokens or not 0 < max_output_tokens <= spec.max_output_tokens:
        return None
    schedule = book.lookup(spec.provider, spec.model_id, at=at)
    if schedule is None:
        return None
    return Candidate(model=spec, schedule=schedule, max_input_tokens=bound,
                     exposure_usd=max_exposure(schedule, max_input_tokens=bound, max_output_tokens=max_output_tokens))


def resolve_route(workload: WorkloadClass, *, input_bytes: int, max_output_tokens: int, at: datetime,
                  override: Optional[tuple[Provider, str]] = None, book: ProviderPriceBook = PRICE_BOOK,
                  unavailable: Iterable[tuple[Provider, str]] = ()) -> Route:
    """Primary + reviewed fallbacks for a bounded request. ``override`` passes the same checks and may not cost more."""
    if not isinstance(workload, WorkloadClass) or workload not in ROUTES:
        raise RoutingError("unknown_workload")
    spec = ROUTES[workload]
    down = frozenset(unavailable)
    kw = dict(input_bytes=input_bytes, max_output_tokens=max_output_tokens, at=at, book=book)
    reviewed_primary = _candidate(spec.primary, workload, unavailable=frozenset(), **kw)
    if reviewed_primary is None:
        raise RoutingError("primary_model_ineligible")
    ceiling = reviewed_primary.exposure_usd
    order: list[tuple[Provider, str]] = [spec.primary, *spec.fallbacks]
    if override is not None:
        if override not in MODEL_CATALOG:
            raise RoutingError("override_not_in_catalog")
        chosen = _candidate(override, workload, unavailable=down, **kw)
        if chosen is None:
            raise RoutingError("override_ineligible")
        if chosen.exposure_usd > ceiling:
            raise RoutingError("override_more_expensive")
        order = [override, *[k for k in order if k != override]]
    candidates: list[Candidate] = []
    for key in order:
        cand = _candidate(key, workload, unavailable=down, **kw)
        if cand is not None and cand.exposure_usd <= ceiling and key not in {c.model.key for c in candidates}:
            candidates.append(cand)
    if not candidates:
        raise RoutingError("no_eligible_model")
    return Route(workload=workload, reasoning_effort=spec.reasoning_effort, candidates=tuple(candidates))
