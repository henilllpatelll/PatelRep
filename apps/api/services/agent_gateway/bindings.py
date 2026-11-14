"""Exact, code-reviewed binding of (tool_id, version) to a trusted server-owned operation.

A ``ToolBinding`` holds direct references to functions defined in this package -- never a module path, a string to
import, an ``eval``-able expression, a URL, a SQL string or a shell command. ``BindingRegistry``:

  * is keyed by the exact (tool_id, version) pair; no wildcard, prefix, fuzzy or "latest" lookup, no fallback tool
  * refuses a binding whose spec is not the one registered in the frozen gateway ToolRegistry, or whose version is
    not in H0's ``H2_EXECUTABLE_TOOLS``
  * is frozen at import; nothing registers later (no plugin discovery, no MCP servers)
  * resolves a model-suggested name only through ``resolve_untrusted`` (exact str + int, else None)

Visibility to an agent is the AGENT's manifest allowlist (``GATEWAY_AGENTS``); a binding grants nothing by itself.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Callable, Mapping, Optional

from services.agent_gateway import adapters
from services.agent_gateway.catalog import GATEWAY_TOOLS, ROOM_STATUS_LOOKUP_V1, WORK_ORDER_ASSIGN_V2, WORK_ORDER_LOOKUP_V2
from services.agent_harness.controls import tool_is_executable
from services.agent_harness.errors import RegistryError
from services.agent_harness.policy import VerifiedResource
from services.agent_harness.tools import TOOL_ID_PATTERN, ToolSpec
from services.agent_harness.vocabulary import AccessMode

_TOOL_ID_RE = re.compile(TOOL_ID_PATTERN)

Resolver = Callable[[Any, str, Mapping[str, Any]], Optional[VerifiedResource]]
ReadHandler = Callable[[Any, str, VerifiedResource], Optional[dict]]


@dataclass(frozen=True)
class ToolBinding:
    spec: ToolSpec
    resolve: Resolver
    read: Optional[ReadHandler]          # read tools only
    write_rpc: Optional[str]             # write tools only: the ONE fenced, atomic RPC that performs the operation

    @property
    def key(self) -> tuple[str, int]:
        return self.spec.key


class BindingRegistry:
    def __init__(self) -> None:
        self._bindings: dict[tuple[str, int], ToolBinding] = {}
        self._frozen = False

    def register(self, binding: ToolBinding) -> None:
        if self._frozen:
            raise RegistryError("binding registry is frozen", code="registry_frozen")
        spec = binding.spec
        if GATEWAY_TOOLS.get(spec.tool_id, spec.version) is not spec:
            raise RegistryError("binding spec is not the registered gateway contract", code="unregistered_binding")
        if not tool_is_executable(spec.key):
            raise RegistryError("tool version is outside the reviewed executable set", code="not_executable")
        if spec.key in self._bindings:
            raise RegistryError("duplicate binding", code="duplicate_binding")
        if spec.access is AccessMode.READ and (binding.read is None or binding.write_rpc is not None):
            raise RegistryError("read tools bind exactly one read handler", code="invalid_binding")
        if spec.access is AccessMode.WRITE and (binding.read is not None or binding.write_rpc is None):
            raise RegistryError("write tools bind exactly one atomic RPC", code="invalid_binding")
        self._bindings[spec.key] = binding

    def freeze(self) -> "BindingRegistry":
        self._frozen = True
        return self

    @property
    def frozen(self) -> bool:
        return self._frozen

    def get(self, tool_id: object, version: object) -> Optional[ToolBinding]:
        return self.resolve_untrusted(tool_id, version)

    def resolve_untrusted(self, tool_id: object, version: object) -> Optional[ToolBinding]:
        if not isinstance(tool_id, str) or isinstance(version, bool) or not isinstance(version, int):
            return None
        if not _TOOL_ID_RE.match(tool_id):
            return None
        return self._bindings.get((tool_id, version))

    def all(self) -> Mapping[tuple[str, int], ToolBinding]:
        return MappingProxyType(dict(self._bindings))


def _build() -> BindingRegistry:
    registry = BindingRegistry()
    registry.register(ToolBinding(spec=WORK_ORDER_LOOKUP_V2, resolve=adapters.resolve_work_order,
                                  read=adapters.read_work_order_summary, write_rpc=None))
    registry.register(ToolBinding(spec=ROOM_STATUS_LOOKUP_V1, resolve=adapters.resolve_room,
                                  read=adapters.read_room_status, write_rpc=None))
    registry.register(ToolBinding(spec=WORK_ORDER_ASSIGN_V2, resolve=adapters.resolve_work_order,
                                  read=None, write_rpc="agent_tool_execute_work_order_assign"))
    return registry.freeze()


GATEWAY_BINDINGS = _build()
