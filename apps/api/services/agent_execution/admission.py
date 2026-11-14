"""Run admission. In H1 only the closed synthetic probe can be admitted, and only outside production.

Admission is separate from execution: it validates and persists a run (one atomic RPC that also enqueues it) and
never executes anything. Authority comes ONLY from a ``TrustedExecutionContext`` minted by the H0 factories (a
verified ``CurrentUser`` or a registered system principal); tenant, user, role and principal are read from that
context, never from caller-supplied fields. Normal agent admission is disabled: any agent other than the synthetic
probe raises ``AgentExecutionDisabled`` via the H0 ``require_execution_supported()`` gate, and the database's
``agent_runs_h1_synthetic_only`` constraint refuses it independently.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Optional

from services.agent_execution import SYNTHETIC_AGENT_ID, SYNTHETIC_AGENT_VERSION
from services.agent_execution.identity_authority import SYNTHETIC_INITIATOR_ROLES
from services.agent_execution.store import AgentRunStore
from services.agent_execution.synthetic import SyntheticSpec
from services.agent_harness.controls import require_execution_supported
from services.agent_harness.errors import IdentityError
from services.agent_harness.identity import TrustedExecutionContext
from services.agent_harness.vocabulary import PrincipalType

SYNTHETIC_ALLOWED_ENVIRONMENTS = frozenset({"development", "test", "staging"})
_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,200}$")


class AdmissionRefused(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class AdmissionResult:
    run_id: str
    created: bool
    state: str


def synthetic_admission_allowed(*, app_env: str, synthetic_enabled: bool) -> bool:
    """Synthetic probes need an explicit opt-in AND a non-production environment. Production is never allowed."""
    return bool(synthetic_enabled) and app_env in SYNTHETIC_ALLOWED_ENVIRONMENTS


def request_digest(ctx: TrustedExecutionContext, spec: SyntheticSpec) -> str:
    """Identity + meaning of the request. Reusing an idempotency key with a different digest is refused."""
    canonical = json.dumps({
        "tenant": ctx.hotel_id, "agent": [ctx.agent_id, ctx.agent_version], "principal": ctx.principal_type.value,
        "user": ctx.user_id, "system": ctx.system_principal_id, "trigger": ctx.trigger.value,
        "spec": spec.model_dump(mode="json"),
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def admit_synthetic_run(
    store: AgentRunStore,
    ctx: TrustedExecutionContext,
    spec: SyntheticSpec,
    *,
    idempotency_key: str,
    app_env: str,
    synthetic_enabled: bool,
    deadline_seconds: int = 900,
    max_attempts: int = 5,
    step_max_attempts: int = 3,
    correlation_id: Optional[str] = None,
) -> AdmissionResult:
    if not isinstance(ctx, TrustedExecutionContext):
        raise IdentityError("admission requires a trusted execution context", code="untrusted_construction")
    if (ctx.agent_id, ctx.agent_version) != (SYNTHETIC_AGENT_ID, SYNTHETIC_AGENT_VERSION):
        require_execution_supported()  # H0 ceiling: always raises AgentExecutionDisabled in H1
    if not synthetic_admission_allowed(app_env=app_env, synthetic_enabled=synthetic_enabled):
        raise AdmissionRefused("synthetic_disabled")
    if ctx.principal_type is PrincipalType.HUMAN and ctx.role not in SYNTHETIC_INITIATOR_ROLES:
        raise AdmissionRefused("actor_not_authorized")
    if not isinstance(spec, SyntheticSpec):
        raise AdmissionRefused("invalid_spec")
    if not isinstance(idempotency_key, str) or not _IDEMPOTENCY_KEY_RE.match(idempotency_key):
        raise AdmissionRefused("invalid_idempotency_key")

    result = store.admit(
        tenant_id=ctx.hotel_id, agent_id=ctx.agent_id, agent_version=ctx.agent_version,
        principal_type=ctx.principal_type.value, user_id=ctx.user_id, system_principal_id=ctx.system_principal_id,
        trigger_type=ctx.trigger.value, idempotency_key=idempotency_key, request_digest=request_digest(ctx, spec),
        correlation_id=correlation_id or ctx.correlation_id or idempotency_key[:100],
        policy_version=ctx.policy_version, synthetic_spec=spec.model_dump(mode="json"),
        first_step_type=spec.step_type(), deadline_seconds=deadline_seconds, max_attempts=max_attempts,
        step_max_attempts=step_max_attempts,
    )
    if not isinstance(result, dict) or not result.get("admitted"):
        raise AdmissionRefused(str((result or {}).get("reason") or "admission_failed"))
    return AdmissionResult(run_id=result["run_id"], created=bool(result["created"]), state=result["state"])
