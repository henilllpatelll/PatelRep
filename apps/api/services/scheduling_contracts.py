"""Workflow contracts for the later Team Scheduling phases: states, transitions, who may act, who owns the data.

DECLARATIVE ONLY. Phase 1 creates no tables for these workflows; each later phase adds its own forward-only
migration and implements the transitions it needs against THIS table, so every phase agrees on one vocabulary and
tests/smoke/test_scheduling_foundation.py can prove the table is well formed (no dead states, no unreachable
states, no transition nobody may perform).

SEPARATION FROM TEMPORARY ROLE AUTHORIZATION
  Scheduling decides WHO WORKS WHEN. staff_role_schedules / routers/staff_schedules.py decides what role the UI
  shows a person acting in, is GM-only, and never grants server access. The two never share tables, routes or
  permission checks, and nothing in this module may import or reference staff_schedules.

DATA OWNERSHIP
  shift_assignments       owned by the scheduling write path (routers/scheduling.py). The ONLY plan table.
  hk_shift_sessions       owned by routers/shifts.py. The ONLY attendance table. Scheduling never writes it.
  room_assignments        owned by housekeeping assignments. Scheduling never writes it.
  operational_audit_events  append-only history for every transition below (resource_type = the workflow's key).
  Future tables (one per workflow, tenant-scoped, RLS on, service-role writes) are listed in WORKFLOWS[...].table.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

# Who may act. 'self' = the employee the record is about; 'manager' = a scheduling manager whose department covers
# the record (gm: every department; housekeeping_supervisor: housekeeping; engineer/chief_engineer: engineering).
Actor = str
SELF = "self"
MANAGER = "manager"
GM = "gm"
SYSTEM = "system"  # cron / automation, never a person


@dataclass(frozen=True)
class Transition:
    to: str
    actors: frozenset[Actor]
    requires_reason: bool = False


@dataclass(frozen=True)
class Workflow:
    key: str                                     # operational_audit_events.resource_type
    table: str                                   # where the records will live ('shift_assignments' = exists today)
    initial: str
    transitions: Mapping[str, tuple[Transition, ...]]
    terminal: frozenset[str]
    introduced_in: str                           # the phase that implements it

    @property
    def states(self) -> frozenset[str]:
        return frozenset(self.transitions) | {t.to for ts in self.transitions.values() for t in ts}


def _t(to: str, *actors: Actor, reason: bool = False) -> Transition:
    return Transition(to, frozenset(actors), reason)


WORKFLOWS: dict[str, Workflow] = {
    # Draft vs published: a manager edits a revision privately, then publishes it. Employees only ever see published.
    "schedule_revision": Workflow(
        key="schedule_revision", table="schedule_revisions", initial="draft",
        transitions={
            "draft": (_t("published", MANAGER), _t("discarded", MANAGER)),
            "published": (_t("superseded", SYSTEM),),
            "superseded": (), "discarded": (),
        },
        terminal=frozenset({"superseded", "discarded"}), introduced_in="schedule publishing",
    ),
    # A published shift that must be filled or re-filled.
    "coverage_gap": Workflow(
        key="coverage_gap", table="coverage_gaps", initial="open",
        transitions={
            "open": (_t("offered", MANAGER), _t("filled", MANAGER), _t("waived", MANAGER, reason=True)),
            "offered": (_t("filled", MANAGER), _t("open", MANAGER, SYSTEM), _t("waived", MANAGER, reason=True)),
            "filled": (), "waived": (),
        },
        terminal=frozenset({"filled", "waived"}), introduced_in="shift replacement and coverage recovery",
    ),
    # An employee will not work a published shift. Distinct from 'not clocked in', which is only an observation.
    "absence": Workflow(
        key="absence", table="absence_records", initial="reported",
        transitions={
            "reported": (_t("confirmed", MANAGER), _t("withdrawn", SELF, MANAGER)),
            # Phase 4: a supervisor may retract a confirmed call-out (recorded by mistake, employee can work after
            # all) until a replacement is confirmed. Reason required; the transition is audited. 'covered' stays final.
            "confirmed": (_t("covered", MANAGER), _t("withdrawn", MANAGER, reason=True)),
            "covered": (), "withdrawn": (),
        },
        terminal=frozenset({"covered", "withdrawn"}), introduced_in="call-out management",
    ),
    "availability": Workflow(
        key="availability", table="employee_availability", initial="active",
        transitions={"active": (_t("retired", SELF, MANAGER),), "retired": ()},
        terminal=frozenset({"retired"}), introduced_in="employee availability",
    ),
    "time_off_request": Workflow(
        key="time_off_request", table="time_off_requests", initial="pending",
        transitions={
            "pending": (_t("approved", MANAGER), _t("denied", MANAGER, reason=True), _t("cancelled", SELF)),
            "approved": (_t("cancelled", SELF, MANAGER, reason=True),),
            "denied": (), "cancelled": (),
        },
        terminal=frozenset({"denied", "cancelled"}), introduced_in="time-off and shift requests",
    ),
    # An open shift employees may claim; a manager approves the claim. Phase 4 stores it as a claimable coverage_gaps
    # row (the same record a call-out opens) rather than a second table: "claimed" = a pending coverage_claims row,
    # "filled"/"cancelled" = the gap's own status. The states below are the view API clients see.
    "open_shift": Workflow(
        key="open_shift", table="coverage_gaps", initial="open",
        transitions={
            "open": (_t("claimed", SELF), _t("expired", SYSTEM), _t("cancelled", MANAGER)),
            "claimed": (_t("filled", MANAGER), _t("open", MANAGER, reason=True), _t("cancelled", SELF)),
            "filled": (), "expired": (), "cancelled": (),
        },
        terminal=frozenset({"filled", "expired", "cancelled"}), introduced_in="shift replacement and coverage recovery",
    ),
    # "Will you take this shift?" An offer is NOT a scheduled shift; only fill_coverage_gap() makes one.
    "coverage_offer": Workflow(
        key="coverage_offer", table="coverage_offers", initial="pending",
        transitions={
            "pending": (_t("accepted", SELF, MANAGER), _t("declined", SELF), _t("withdrawn", MANAGER),
                        _t("expired", SYSTEM), _t("superseded", SYSTEM)),
            "accepted": (), "declined": (), "withdrawn": (), "expired": (), "superseded": (),
        },
        terminal=frozenset({"accepted", "declined", "withdrawn", "expired", "superseded"}),
        introduced_in="shift replacement and coverage recovery",
    ),
    # An employee's interest in a claimable open shift; never a shift until a manager approves it.
    "coverage_claim": Workflow(
        key="coverage_claim", table="coverage_claims", initial="pending",
        transitions={
            "pending": (_t("approved", MANAGER), _t("declined", MANAGER), _t("withdrawn", SELF)),
            "approved": (), "declined": (), "withdrawn": (),
        },
        terminal=frozenset({"approved", "declined", "withdrawn"}), introduced_in="shift replacement and coverage recovery",
    ),
    "shift_swap": Workflow(
        key="shift_swap", table="shift_swap_requests", initial="proposed",
        transitions={
            "proposed": (_t("accepted", SELF), _t("declined", SELF), _t("cancelled", SELF), _t("expired", SYSTEM)),
            "accepted": (_t("approved", MANAGER), _t("denied", MANAGER, reason=True), _t("cancelled", SELF)),
            "approved": (), "denied": (), "declined": (), "cancelled": (), "expired": (),
        },
        terminal=frozenset({"approved", "denied", "declined", "cancelled", "expired"}),
        introduced_in="time-off and shift requests",
    ),
    # Employee-facing messages about the above; delivery only, never a source of truth.
    "schedule_notification": Workflow(
        key="schedule_notification", table="schedule_notifications", initial="queued",
        transitions={
            "queued": (_t("sent", SYSTEM), _t("failed", SYSTEM)),
            "failed": (_t("queued", SYSTEM),),
            "sent": (_t("read", SELF),),
            "read": (),
        },
        terminal=frozenset({"read"}), introduced_in="employee notifications and quick actions",
    ),
}

# What an employee may do to their own schedule, in one place (the later phases implement it; this is the contract).
EMPLOYEE_SELF_SERVICE = frozenset({
    "view_own_published_schedule", "set_own_availability", "request_time_off", "report_own_absence",
    "claim_open_shift", "propose_shift_swap", "accept_or_decline_swap_proposed_to_me",
})

# Role -> department codes whose schedule it may manage. gm: all departments (None = unrestricted).
# Used today by routers/scheduling.py; unknown role = no scheduling authority.
MANAGER_DEPARTMENT_CODES: dict[str, frozenset[str] | None] = {
    "gm": None,
    "housekeeping_supervisor": frozenset({"HK"}),
    "engineer": frozenset({"ENG"}),
    "chief_engineer": frozenset({"ENG"}),
}
# Role -> the department code its holders belong to when user_roles.department_id is unset.
ROLE_DEFAULT_DEPARTMENT_CODE: dict[str, str] = {
    "housekeeper": "HK",
    "housekeeping_supervisor": "HK",
    "engineer": "ENG",
    "chief_engineer": "ENG",
    "front_desk": "FD",
}
