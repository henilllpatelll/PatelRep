"""Execute one durable ``tool_invocation`` step through the gateway (called by the H1 worker under a fenced lease).

Per step, in order -- nothing cached from admission or a previous attempt is trusted:
  1. fenced step context (invocation, approval, ledger row, fresh authorization snapshot) -- lease lost => stop
  2. a committed ledger outcome for this invocation is REPLAYED, never re-executed
  3. initiator identity re-read from authoritative membership (``revalidate_principal`` with the tool's roles)
  4. runtime controls + the process/database execution switches => yield (no attempt consumed) when blocked
  5. arguments re-validated and re-canonicalised, resource re-resolved in the trusted hotel, digest recomputed and
     compared with the immutable invocation
  6. H0 policy.evaluate with fresh inputs; for writes, the approval's approver role is re-read just now
  7. read: bounded handler under its timeout -> output enforcement -> ledger.  write without approval: request it and
     release the run into ``awaiting_approval``.  approved write: the single atomic database RPC.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Mapping, Optional

from services.agent_execution.identity_authority import revalidate_principal
from services.agent_execution.retry import LeaseLost
from services.agent_gateway.authorization import block_reason, db_now, policy_inputs
from services.agent_gateway.bindings import GATEWAY_BINDINGS, ToolBinding
from services.agent_gateway.catalog import APPROVAL_POLICY_ID, APPROVAL_TTL_SECONDS
from services.agent_gateway.errors import GatewayBlocked, GatewayRefused, OutputRejected, ToolTimeout
from services.agent_gateway.gateway import Prepared, agent_for, approval_evidence, decide, prepare
from services.agent_gateway.output import enforce_output
from services.agent_gateway.store import GatewayStore
from services.agent_harness.autonomy import APPROVAL_POLICIES
from services.agent_harness.controls import require_tool_executable
from services.agent_harness.identity import IdentityAuthority
from services.agent_harness.policy import Outcome
from services.agent_harness.vocabulary import CANONICAL_ROLES, CAPABILITY_CATALOG, AccessMode

# Database refusals that are runtime controls (yield and retry later), not authorization failures.
BLOCKING_REASONS = frozenset({"cost_emergency_stop", "platform_paused", "hotel_paused", "agent_paused",
                              "platform_execution_disabled", "tool_paused"})


@dataclass(frozen=True)
class StepResult:
    action: str  # "complete" | "await_approval" | "cancel"
    meta: dict = field(default_factory=dict)


def tool_roles(binding: ToolBinding) -> frozenset[str]:
    return frozenset(binding.spec.allowed_roles & CAPABILITY_CATALOG[binding.spec.capability].granted_roles)


def run_with_timeout(call: Callable[[], Any], seconds: float) -> Any:
    """Bound a side-effect-free read. The worker thread is abandoned on timeout; nothing it returns is used."""
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="agent-tool-read")
    future = pool.submit(call)
    try:
        return future.result(timeout=seconds)
    except FutureTimeout as exc:
        raise ToolTimeout() from exc
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


class _Step:
    def __init__(self, *, gstore: GatewayStore, run: Mapping[str, Any], step: Mapping[str, Any], fencing_token: int,
                 worker_id: str, authority: IdentityAuthority, clock: Callable[[], datetime], process_enabled: bool,
                 checkpoint: Callable[..., None]) -> None:
        self.g, self.run, self.step = gstore, run, step
        self.common = dict(run_id=str(run["id"]), fencing_token=fencing_token, worker_id=worker_id)
        self.authority, self.clock, self.process_enabled, self.checkpoint = authority, clock, process_enabled, checkpoint
        self.hotel = str(run["tenant_id"])

    # ---- helpers -----------------------------------------------------------------------------------------------
    def _check(self, result: Mapping[str, Any]) -> Mapping[str, Any]:
        if (result or {}).get("outcome") == "lease_lost" or (result or {}).get("reason") == "lease_lost":
            raise LeaseLost()
        return result or {}

    def _fail(self, invocation_id: str, code: str, error_class: str = "authorization_denied") -> None:
        """Record a TERMINAL failure in the ledger (so redelivery replays it) and stop the step."""
        self._check(self.g.record_outcome(invocation_id=invocation_id, state="failed", error_class=error_class,
                                          error_code=code[:64], **self.common))
        raise GatewayRefused(code)

    def _meta(self, binding: ToolBinding, invocation: Mapping[str, Any], execution: Mapping[str, Any]) -> dict:
        return {"invocation_id": str(invocation["id"]), "execution_id": str(execution.get("id")),
                "tool_id": binding.spec.tool_id, "tool_version": binding.spec.version,
                "outcome": str(execution.get("state"))}

    def _from_execution(self, binding: ToolBinding, invocation: Mapping[str, Any], execution: Mapping[str, Any]) -> StepResult:
        if execution.get("state") != "succeeded":
            raise GatewayRefused(str(execution.get("error_code") or "execution_failed"))
        enforce_output(binding.spec, execution.get("result") or {})  # the stored outcome still honours its contract
        return StepResult("complete", self._meta(binding, invocation, execution))

    # ---- the sequence ------------------------------------------------------------------------------------------
    def execute(self, *, _depth: int = 0) -> StepResult:
        agent = agent_for(self.run.get("agent_id"), self.run.get("agent_version"))
        context = self._check(self.g.step_context(step_number=int(self.step["step_number"]), **self.common))
        if not context.get("ok"):
            raise GatewayRefused(str(context.get("reason") or "invocation_missing"))
        inv, snapshot = context["invocation"], context.get("snapshot") or {}
        if (inv.get("agent_id"), inv.get("agent_version")) != (agent.agent_id, agent.agent_version) \
                or str(inv.get("tenant_id")) != self.hotel:
            raise GatewayRefused("invocation_mismatch")
        binding = GATEWAY_BINDINGS.get(inv.get("tool_id"), inv.get("tool_version"))
        if binding is None:
            raise GatewayRefused("tool_not_registered")
        require_tool_executable(binding.key)
        if context.get("execution"):
            # Redelivery after a committed outcome (e.g. a crash between the business commit and the step commit):
            # replay it through the fenced ledger RPC (which audits the replay) -- never execute again.
            replay = self._check(self.g.record_outcome(invocation_id=str(inv["id"]),
                                                       state=str(context["execution"].get("state")), **self.common))
            return self._from_execution(binding, inv, replay.get("execution") or context["execution"])

        ctx = revalidate_principal(self.run, self.authority, clock=self.clock, required_roles=tool_roles(binding))
        blocked = block_reason(snapshot, hotel_id=self.hotel, agent_id=agent.agent_id, tool_id=binding.spec.tool_id)
        if blocked:
            raise GatewayBlocked(blocked)
        if not self.process_enabled:
            raise GatewayBlocked("process_execution_disabled")

        try:
            prepared = prepare(self.g.client, hotel_id=ctx.hotel_id, agent=agent, tool_id=binding.spec.tool_id,
                               tool_version=binding.spec.version, arguments=inv.get("arguments"))
        except GatewayRefused as exc:
            self._fail(str(inv["id"]), exc.code)
        if prepared.arguments != inv.get("arguments") or prepared.digest != inv.get("action_digest") \
                or prepared.resource.resource_id != str(inv.get("resource_id")):
            self._fail(str(inv["id"]), "action_digest_mismatch")

        now = max(self.clock(), db_now(snapshot) or self.clock())
        inputs = policy_inputs(snapshot, hotel_id=ctx.hotel_id, agent_id=agent.agent_id,
                               process_enabled=self.process_enabled, now=now)
        self.checkpoint(True)
        if binding.spec.access is AccessMode.READ:
            return self._read(binding, inv, ctx, prepared, inputs, now)
        return self._write(binding, inv, ctx, prepared, inputs, now, context.get("approval"), _depth)

    def _read(self, binding, inv, ctx, prepared: Prepared, inputs, now) -> StepResult:
        decision = decide(ctx, prepared, inputs, now=now)
        if decision.outcome is not Outcome.ALLOW or not decision.authorizes_execution:
            self._fail(str(inv["id"]), decision.reason.value)
        raw = run_with_timeout(lambda: binding.read(self.g.client, ctx.hotel_id, prepared.resource),
                               binding.spec.timeout_seconds)
        if raw is None:
            self._fail(str(inv["id"]), "resource_not_found", "precondition_failed")
        try:
            clean = enforce_output(binding.spec, raw)
        except OutputRejected as exc:
            self._fail(str(inv["id"]), exc.code, "invalid_output")
        recorded = self._check(self.g.record_outcome(invocation_id=str(inv["id"]), state="succeeded", result=clean,
                                                     **self.common))
        execution = recorded.get("execution") or {}
        if recorded.get("outcome") not in ("recorded", "replayed"):
            raise GatewayRefused(str(recorded.get("outcome") or "record_failed"))
        return self._from_execution(binding, inv, execution)

    def _approver_role(self, approval: Mapping[str, Any], binding: ToolBinding) -> Optional[str]:
        record = self.authority.load(user_id=str(approval["decided_by_user_id"]), hotel_id=self.hotel)
        if record is None or not record.is_active or record.role not in CANONICAL_ROLES:
            return None
        allowed = tool_roles(binding) & frozenset(approval.get("required_approver_roles") or [])
        return record.role if record.role in allowed else None

    def _write(self, binding, inv, ctx, prepared: Prepared, inputs, now, approval, depth: int) -> StepResult:
        inv_id = str(inv["id"])
        evidence = None
        if approval:
            state = approval.get("state")
            if approval.get("consumed_at"):
                self._fail(inv_id, "approval_consumed")
            if state == "approved":
                role = self._approver_role(approval, binding)
                if role is None:
                    self._fail(inv_id, "approver_not_authorized")
                evidence = approval_evidence(approval, approver_role=role)
            elif state != "requested":
                self._fail(inv_id, f"approval_{state}")
        decision = decide(ctx, prepared, inputs, now=now, approval=evidence)

        if decision.outcome is Outcome.REQUIRES_APPROVAL:
            policy = APPROVAL_POLICIES[APPROVAL_POLICY_ID]
            result = self._check(self.g.request_approval(
                invocation_id=inv_id, approval_policy_id=policy.policy_id,
                approver_may_be_initiator=policy.approver_may_be_initiator,
                ttl_seconds=min(APPROVAL_TTL_SECONDS, policy.max_age_seconds), **self.common))
            outcome = result.get("outcome")
            if outcome == "awaiting_approval":
                return StepResult("await_approval", {"invocation_id": inv_id, "approval_id": str(result["approval_id"])})
            if outcome == "approved" and depth == 0:
                return self.execute(_depth=1)  # approved between our read and the request: re-evaluate from scratch
            if outcome == "cancel_pending":
                return StepResult("cancel")
            self._fail(inv_id, str(outcome or "approval_request_failed"))
        if decision.outcome is not Outcome.ALLOW or not decision.authorizes_execution:
            self._fail(inv_id, decision.reason.value)

        result = self._check(self.g.execute_work_order_assign(invocation_id=inv_id, action_digest=prepared.digest,
                                                              **self.common))
        outcome = result.get("outcome")
        if outcome in ("succeeded", "failed", "replayed"):
            return self._from_execution(binding, inv, result.get("execution") or {})
        reason = str(result.get("reason") or outcome or "execution_refused")
        if reason in BLOCKING_REASONS:
            raise GatewayBlocked(reason)
        raise GatewayRefused(reason)


def execute_tool_step(*, gstore: GatewayStore, run: Mapping[str, Any], step: Mapping[str, Any], fencing_token: int,
                      worker_id: str, authority: IdentityAuthority, clock: Callable[[], datetime],
                      process_enabled: bool, checkpoint: Callable[..., None]) -> StepResult:
    return _Step(gstore=gstore, run=run, step=step, fencing_token=fencing_token, worker_id=worker_id,
                 authority=authority, clock=clock, process_enabled=process_enabled, checkpoint=checkpoint).execute()
