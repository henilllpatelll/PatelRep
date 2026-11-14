"""Gateway errors. Every refusal carries a stable machine-readable ``code``; messages never echo payloads or data."""
from __future__ import annotations


class GatewayRefused(Exception):
    """The gateway refused an invocation (authorization, validation or state). Never retried as infrastructure."""

    def __init__(self, code: str, *, retryable: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class GatewayBlocked(Exception):
    """A runtime control (pause, cost stop, platform switch) blocks execution now. The run yields; nothing is consumed."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class ToolTimeout(Exception):
    """A read tool exceeded its declared timeout. Reads have no side effect, so this is safely retryable."""


class OutputRejected(GatewayRefused):
    """A handler returned output outside its declared contract (schema, size or item limits)."""

    def __init__(self, code: str) -> None:
        super().__init__(code, retryable=False)
