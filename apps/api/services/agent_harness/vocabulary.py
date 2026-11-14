"""Closed vocabularies for the Agent Harness: enums, the capability catalog, and role grants.

Every value an agent manifest, tool contract or policy decision may use is enumerated here. An unknown value is a
validation error, never a silent default. Role authority is an explicit capability -> roles mapping built from
``core/roles.py`` (the canonical role list) and the domain routes each capability mirrors. There is deliberately NO
numeric role rank: hotel departments are not a hierarchy, so an engineer never inherits housekeeping-supervisor
authority because the two once shared a rank value (see services/policy.py history).

Pure module: no database, network, model provider or FastAPI imports.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, IntEnum
from types import MappingProxyType
from typing import Mapping

from core.roles import ALL_ROLES, GM_ONLY_ROLES, MODULE_ROLE_ACCESS

CANONICAL_ROLES: frozenset[str] = frozenset(ALL_ROLES)

# Keys an untrusted payload (model output, tool arguments, retrieved text) may try to use to claim identity.
IDENTITY_CLAIM_KEYS: frozenset[str] = frozenset({
    "hotel_id", "tenant_id", "user_id", "actor_id", "role", "user_role", "principal", "principal_id",
    "system_principal_id", "agent_id", "agent_version", "approved", "approval", "approval_id", "approved_by",
    "autonomy_level", "policy_version", "run_id",
})


class ProductFamily(str, Enum):
    OPERATIONS = "operations"
    GUEST = "guest"
    GROWTH = "growth"
    OWNER = "owner"
    CONNECT = "connect"


class AccessMode(str, Enum):
    READ = "read"
    WRITE = "write"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @property
    def rank(self) -> int:
        return _RISK_ORDER[self]


_RISK_ORDER = {RiskLevel.LOW: 0, RiskLevel.MEDIUM: 1, RiskLevel.HIGH: 2, RiskLevel.CRITICAL: 3}


class Consequence(str, Enum):
    """What kind of harm a wrong action causes. Some consequences always keep a human in the loop."""

    OPERATIONAL = "operational"
    GUEST_FACING = "guest_facing"
    FINANCIAL = "financial"
    PERSONNEL = "personnel"
    SAFETY = "safety"


# Consequences that can NEVER be unlocked by an autonomy level: a human with authority decides every time.
HUMAN_AUTHORITY_CONSEQUENCES: frozenset[Consequence] = frozenset(
    {Consequence.FINANCIAL, Consequence.PERSONNEL, Consequence.SAFETY}
)


class AutonomyLevel(IntEnum):
    """The four planned autonomy levels. Ordering is meaningful (a ceiling caps everything above it)."""

    OBSERVE = 1  # observation and recommendations only; no writes
    HUMAN_APPROVED = 2  # writes only with a valid, server-recorded human approval
    BOUNDED = 3  # expressly granted low-risk writes without per-action approval (NOT executable in H0)
    COORDINATED = 4  # longer-running authorized coordination (NOT executable in H0)


class TriggerType(str, Enum):
    USER_REQUEST = "user_request"
    SCHEDULE = "schedule"
    EVENT = "event"


class PrincipalType(str, Enum):
    HUMAN = "human"
    SYSTEM = "system"


class ResourceType(str, Enum):
    HOTEL = "hotel"
    ROOM = "room"
    WORK_ORDER = "work_order"
    TASK = "task"
    ROOM_ASSIGNMENT = "room_assignment"
    BILLING_ACCOUNT = "billing_account"


class ApprovalRequirement(str, Enum):
    NONE = "none"  # read tools only
    HUMAN_APPROVAL = "human_approval"


class IdempotencyPolicy(str, Enum):
    NOT_APPLICABLE = "not_applicable"  # read tools only
    REQUIRED_KEY = "required_key"  # every write carries a caller-supplied idempotency key


class AuditLevel(str, Enum):
    METADATA = "metadata"  # who/what/when/decision; no payloads
    IMMUTABLE_EVENT = "immutable_event"  # an append-only domain event per attempt (required for writes)


@dataclass(frozen=True)
class CapabilityDef:
    """A business capability: one domain operation family with one access mode and its canonical role grant."""

    capability_id: str
    domain: str
    access: AccessMode
    consequence: Consequence
    granted_roles: frozenset[str]
    mirrors: str  # the domain route / rule whose authority this grant mirrors (documentation + drift tests)
    description: str


# Mirrors POST /work-orders/{wo_id}/assign: require_role("chief_engineer", "gm") in routers/work_orders.py.
WORK_ORDER_ASSIGN_ROLES: tuple[str, ...] = ("chief_engineer", "gm")
# Mirrors services/ai/authorization.ASSIGNMENT_ROLES (and housekeeping.py room-assignment authority).
ROOM_ASSIGNMENT_WRITE_ROLES: tuple[str, ...] = ("housekeeping_supervisor", "gm")

_CAPABILITIES: tuple[CapabilityDef, ...] = (
    CapabilityDef(
        capability_id="engineering.work_orders.read",
        domain="engineering",
        access=AccessMode.READ,
        consequence=Consequence.OPERATIONAL,
        granted_roles=frozenset(MODULE_ROLE_ACCESS["engineering"]),
        mirrors="core.roles.MODULE_ROLE_ACCESS['engineering']",
        description="Look up work orders in the caller's hotel.",
    ),
    CapabilityDef(
        capability_id="engineering.work_orders.assign",
        domain="engineering",
        access=AccessMode.WRITE,
        consequence=Consequence.OPERATIONAL,
        granted_roles=frozenset(WORK_ORDER_ASSIGN_ROLES),
        mirrors="routers/work_orders.py POST /{wo_id}/assign",
        description="Assign a work order to an engineer.",
    ),
    CapabilityDef(
        capability_id="housekeeping.rooms.read",
        domain="housekeeping",
        access=AccessMode.READ,
        consequence=Consequence.OPERATIONAL,
        granted_roles=frozenset(MODULE_ROLE_ACCESS["housekeeping"]),
        mirrors="core.roles.MODULE_ROLE_ACCESS['housekeeping']",
        description="Read room status in the caller's hotel.",
    ),
    CapabilityDef(
        capability_id="housekeeping.room_assignments.write",
        domain="housekeeping",
        access=AccessMode.WRITE,
        consequence=Consequence.PERSONNEL,
        granted_roles=frozenset(ROOM_ASSIGNMENT_WRITE_ROLES),
        mirrors="services/ai/authorization.ASSIGNMENT_ROLES",
        description="Create or change housekeeper room assignments (workload allocation).",
    ),
    CapabilityDef(
        capability_id="billing.credit_adjustment",
        domain="billing",
        access=AccessMode.WRITE,
        consequence=Consequence.FINANCIAL,
        granted_roles=frozenset(GM_ONLY_ROLES),
        mirrors="services/policy.py billing_credit (GM only)",
        description="Issue a billing credit or folio adjustment.",
    ),
)

CAPABILITY_CATALOG: Mapping[str, CapabilityDef] = MappingProxyType({c.capability_id: c for c in _CAPABILITIES})


def _assert_catalog_is_canonical() -> None:
    """Import-time guard: a catalog entry can only grant canonical roles and must grant at least one."""
    if len(CAPABILITY_CATALOG) != len(_CAPABILITIES):
        raise RuntimeError("Duplicate capability id in the Agent Harness capability catalog")
    for cap in _CAPABILITIES:
        if not cap.granted_roles:
            raise RuntimeError(f"Capability {cap.capability_id} grants no role")
        unknown = cap.granted_roles - CANONICAL_ROLES
        if unknown:
            raise RuntimeError(f"Capability {cap.capability_id} grants non-canonical roles: {sorted(unknown)}")


_assert_catalog_is_canonical()


def roles_granted(capability_id: str) -> frozenset[str]:
    """Canonical roles granted a capability; an unknown capability grants nobody."""
    cap = CAPABILITY_CATALOG.get(capability_id)
    return cap.granted_roles if cap else frozenset()
