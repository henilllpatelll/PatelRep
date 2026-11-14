"""Contract errors. Each carries a stable machine-readable ``code`` so callers and tests never match on prose."""
from __future__ import annotations


class AgentHarnessContractError(ValueError):
    """A manifest, tool contract, identity or financial record violates its contract."""

    code = "contract_violation"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code


class RegistryError(AgentHarnessContractError):
    code = "registry_error"


class IdentityError(AgentHarnessContractError):
    code = "identity_error"


class MeteringError(AgentHarnessContractError):
    code = "metering_error"


class AgentExecutionDisabled(RuntimeError):
    """Raised by every execution entry point in H0. There is no code path that executes an agent or a tool."""

    code = "agent_execution_disabled"
