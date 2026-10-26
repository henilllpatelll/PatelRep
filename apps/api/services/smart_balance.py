"""Smart Balance - the deterministic room-allocation planner (Supervisor Assignments V2, phase 6).

PURE: no database, no network, no clock. `solve(problem)` takes verified, already-scoped inputs and returns a proposal.
Everything that touches the database (tenant scoping, current owners, stage, soft blocks, staff roles) lives in the
router (`routers/housekeeping.py::smart_balance_plan`), which hands this module only facts it has just verified. That
split is what makes the planner independently testable and auditable: the same `Problem` always yields the same `Plan`.

WHAT THE PLANNER DECIDES
  For every room in the pool: which verified receiver should clean it, or - if no receiver can take it without breaking
  a hard limit - that it stays unallocated, or (an already-owned room) that it stays with its current owner.

HARD CONSTRAINTS (never traded away)
  H1  A room goes only to a receiver the caller listed (eligibility - attendance, role, tenant - is decided upstream).
  H2  A room that already has an owner changes owner only to a DIFFERENT listed receiver; otherwise it stays.
  H3  Credit capacity: a receiver's remaining credits never exceed `target + 2` (the same "over" band the app's
      workload model uses) unless they were already above it, in which case they cannot gain credits at all.
  H4  Shift time: a receiver's known remaining minutes never exceed the scheduled shift time left, under the same rule.
  A limit is applied only when its data is KNOWN (a target, a schedule). Unknown capacity is never invented: it is
  reported as an assumption and the corresponding limit is simply not enforced.

SOFT OBJECTIVES (weighted, strongest first - the weights are the documented hierarchy)
  O1  leave nothing unallocated, dropping the LEAST urgent room first        (1_000_000 x urgency weight)
  O2  balance workload: minimise the spread between the busiest and the least busy receiver, existing work included
      (10 per 5-minute unit of range; 1 when the supervisor turned balancing off, so it is a tie-break only)
  O3  keep existing owners: each moved room costs 150 (15 minutes of range); 10 when "minimise reassignment" is off,
      so unchanged work is never reshuffled for a cosmetic gain
  O4  send urgent rooms to whoever has the least on their plate (urgency weight x existing workload units)
  O5  proximity: each NEW floor / building a receiver would have to start working costs 8 / 6
  O6  credit headroom: 6 per 0.1 credit above the daily target (below the hard cap), 1 per 0.1 credit of spread

UNKNOWN VALUES ARE NEVER PRESENTED AS KNOWN
  A room without an estimate adds 0 to every KNOWN-minutes figure and is counted separately. To spread such rooms at all,
  fairness uses a planning surrogate - the median of the known estimates in the pool, else 30 - which is reported as an
  assumption and used for balancing only, never shown as a duration.

DETERMINISM
  Rooms and receivers are sorted by stable keys, the model has one worker and a fixed seed, and the search is bounded by
  deterministic time, so identical input gives an identical proposal. A wall-clock cap bounds the worst case.

FALLBACK
  If CP-SAT returns no solution a conservative greedy plan is built, but it is used ONLY if `validate_plan` - an
  independent check of H1-H4 - passes. Otherwise the result is `no_safe_plan`; nothing unvalidated is ever returned.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from statistics import median
from typing import Iterable, Literal, Optional

UNIT_MINUTES = 5
PLANNING_FALLBACK_MINUTES = 30
CREDIT_SCALE = 10
OVER_BAND_CREDITS = 2

UNALLOCATED_BASE = 1_000_000
UNALLOCATED_URGENCY = {"critical": 16, "high": 8, "elevated": 4, "routine": 1}
URGENT_ROUTING = {"critical": 4, "high": 2, "elevated": 1, "routine": 0}
TIER_RANK = {"critical": 0, "high": 1, "elevated": 2, "routine": 3}
FAIRNESS_WEIGHT = 10
FAIRNESS_WEIGHT_OFF = 1
MOVE_COST = 150
MOVE_COST_RELAXED = 10
NEW_FLOOR_COST = 8
NEW_BUILDING_COST = 6
CREDIT_OVER_TARGET_COST = 6
CREDIT_SPREAD_COST = 1

SOLVER_DETERMINISTIC_SECONDS = 3.0
SOLVER_WALL_SECONDS = 8.0
SOLVER_GAP = 0.02

REASON_TIER = {
    "guest_waiting": "critical",
    "reclean_requested": "high",
    "rush": "high",
    "arrival_passed": "high",
    "arrival_today": "elevated",
    "vip": "elevated",
    "high_risk": "elevated",
}

PlanStatus = Literal["optimal", "feasible", "fallback", "no_safe_plan", "nothing_to_plan", "no_staff"]
MoveKind = Literal["new", "moved", "retained"]


@dataclass(frozen=True)
class Preferences:
    balance_workload: bool = True
    prioritize_guest_waiting: bool = True
    prioritize_rush: bool = True
    prioritize_arrival: bool = True
    prefer_same_building: bool = True
    prefer_same_floor: bool = True
    minimize_reassignment: bool = True


@dataclass(frozen=True)
class PoolRoom:
    room_id: str
    room_number: str
    floor: Optional[int] = None
    building: Optional[str] = None
    #: The current owner the caller verified against the database; None = unassigned.
    owner_id: Optional[str] = None
    #: Known estimate in minutes, or None. NEVER defaulted by the caller.
    minutes: Optional[int] = None
    minutes_basis: Optional[str] = None
    #: Known credits (0 = known zero work), or None when the clean type has no value.
    credits: Optional[float] = None
    reasons: tuple[str, ...] = ()
    #: Recorded guest arrival (epoch seconds), used only to order equally urgent rooms.
    arrival_at: Optional[int] = None


@dataclass(frozen=True)
class Receiver:
    user_id: str
    #: Existing work that is NOT in the pool (the pool's own rooms are added from `PoolRoom.owner_id`).
    base_minutes: int = 0
    base_unknown_rooms: int = 0
    base_rooms: int = 0
    base_credits: float = 0.0
    credits_complete: bool = True
    #: Daily credit target, or None when it is not known.
    credit_target: Optional[float] = None
    #: Minutes of scheduled shift still ahead, or None when no schedule is known.
    shift_minutes_left: Optional[int] = None
    #: (building, floor) pairs and buildings this person already works.
    floors: frozenset = frozenset()
    buildings: frozenset = frozenset()


@dataclass(frozen=True)
class Problem:
    rooms: tuple[PoolRoom, ...]
    receivers: tuple[Receiver, ...]
    preferences: Preferences = field(default_factory=Preferences)


@dataclass
class Assignment:
    room_id: str
    room_number: str
    kind: MoveKind
    from_user_id: Optional[str]
    to_user_id: str
    tier: str
    reasons: list[dict]


@dataclass
class Unallocated:
    room_id: str
    room_number: str
    reason: str  # insufficient_capacity | no_eligible_staff | solver_no_solution
    tier: str


@dataclass
class StaffSummary:
    user_id: str
    rooms_added: int = 0
    rooms_released: int = 0
    minutes_added_known: int = 0
    unknown_added: int = 0
    credits_added_known: float = 0.0
    credits_unknown_added: int = 0
    no_capacity: bool = False


@dataclass
class Plan:
    status: PlanStatus
    assignments: list[Assignment] = field(default_factory=list)
    unallocated: list[Unallocated] = field(default_factory=list)
    staff: list[StaffSummary] = field(default_factory=list)
    assumptions: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)


# --------------------------------------------------------------------------------------------------------------------
# Small deterministic helpers
# --------------------------------------------------------------------------------------------------------------------


def _natural(value: str) -> tuple:
    return tuple((0, int(part)) if part.isdigit() else (1, part.lower()) for part in re.findall(r"\d+|\D+", value or ""))


def effective_tier(reasons: Iterable[str], preferences: Preferences) -> str:
    """The room's urgency tier, counting only the reasons the supervisor's preferences ask us to honour."""
    best = "routine"
    for reason in reasons:
        tier = REASON_TIER.get(reason)
        if tier is None:
            continue
        if reason == "guest_waiting" and not preferences.prioritize_guest_waiting:
            continue
        if reason in ("rush", "reclean_requested") and not preferences.prioritize_rush:
            continue
        if reason in ("arrival_passed", "arrival_today") and not preferences.prioritize_arrival:
            continue
        if TIER_RANK[tier] < TIER_RANK[best]:
            best = tier
    return best


def _units(minutes: float) -> int:
    return max(0, int((minutes + UNIT_MINUTES / 2) // UNIT_MINUTES))


def _scaled(credits: Optional[float]) -> int:
    return 0 if credits is None else int(round(credits * CREDIT_SCALE))


def _room_order_key(room: PoolRoom, preferences: Preferences) -> tuple:
    tier = effective_tier(room.reasons, preferences)
    return (
        TIER_RANK[tier],
        room.arrival_at if room.arrival_at is not None else 1 << 60,
        _natural(room.room_number),
        room.room_id,
    )


def _floor_key(room: PoolRoom) -> Optional[tuple]:
    return (room.building, room.floor) if room.floor is not None else None


# --------------------------------------------------------------------------------------------------------------------
# The prepared problem: everything the solver, the greedy fallback and the validator share
# --------------------------------------------------------------------------------------------------------------------


@dataclass
class _Prepared:
    rooms: list[PoolRoom]
    receivers: list[Receiver]
    preferences: Preferences
    tiers: list[str]
    surrogate: int
    room_units: list[int]
    room_known_minutes: list[int]
    room_credits_scaled: list[int]
    base_units: dict[str, int]
    base_known_minutes: dict[str, int]
    base_credits_scaled: dict[str, int]
    owned_by: dict[str, list[int]]
    #: Highest known minutes / scaled credits each receiver may end with; None = that limit is not enforced.
    minutes_limit: dict[str, Optional[int]]
    credits_limit: dict[str, Optional[int]]
    credit_target_scaled: dict[str, Optional[int]]
    assumptions: list[dict]


def _prepare(problem: Problem) -> _Prepared:
    preferences = problem.preferences
    rooms = sorted(problem.rooms, key=lambda room: _room_order_key(room, preferences))
    receivers = sorted(problem.receivers, key=lambda receiver: receiver.user_id)
    known = [room.minutes for room in rooms if room.minutes]
    surrogate = int(round(median(known))) if known else PLANNING_FALLBACK_MINUTES
    unknown_rooms = sum(1 for room in rooms if not room.minutes)
    unknown_base = sum(receiver.base_unknown_rooms for receiver in receivers)

    tiers = [effective_tier(room.reasons, preferences) for room in rooms]
    room_units = [_units(room.minutes if room.minutes else surrogate) for room in rooms]
    room_known = [int(room.minutes or 0) for room in rooms]
    room_credits = [_scaled(room.credits) for room in rooms]

    owned_by: dict[str, list[int]] = {}
    for index, room in enumerate(rooms):
        if room.owner_id:
            owned_by.setdefault(room.owner_id, []).append(index)

    base_units = {r.user_id: _units(r.base_minutes + r.base_unknown_rooms * surrogate) for r in receivers}
    base_known = {r.user_id: int(r.base_minutes) for r in receivers}
    base_credits = {r.user_id: _scaled(r.base_credits) for r in receivers}

    minutes_limit: dict[str, Optional[int]] = {}
    credits_limit: dict[str, Optional[int]] = {}
    target_scaled: dict[str, Optional[int]] = {}
    capacity_unknown: list[str] = []
    credits_incomplete: list[str] = []
    for receiver in receivers:
        uid = receiver.user_id
        owned = owned_by.get(uid, [])
        current_minutes = base_known[uid] + sum(room_known[i] for i in owned)
        current_credits = base_credits[uid] + sum(room_credits[i] for i in owned)
        minutes_limit[uid] = None if receiver.shift_minutes_left is None else max(int(receiver.shift_minutes_left), current_minutes)
        if receiver.credit_target is None:
            credits_limit[uid] = None
            target_scaled[uid] = None
        else:
            target_scaled[uid] = _scaled(receiver.credit_target)
            credits_limit[uid] = max(_scaled(receiver.credit_target + OVER_BAND_CREDITS), current_credits)
        if receiver.credit_target is None and receiver.shift_minutes_left is None:
            capacity_unknown.append(uid)
        if not receiver.credits_complete:
            credits_incomplete.append(uid)

    assumptions: list[dict] = []
    if unknown_rooms or unknown_base:
        assumptions.append(
            {"code": "unknown_estimate_surrogate", "rooms": unknown_rooms + unknown_base, "minutes": surrogate}
        )
    if capacity_unknown:
        assumptions.append({"code": "capacity_unknown", "staff": capacity_unknown})
    if credits_incomplete or any(room.credits is None for room in rooms):
        assumptions.append(
            {
                "code": "credits_incomplete",
                "rooms": sum(1 for room in rooms if room.credits is None),
                "staff": credits_incomplete,
            }
        )

    return _Prepared(
        rooms=rooms,
        receivers=receivers,
        preferences=preferences,
        tiers=tiers,
        surrogate=surrogate,
        room_units=room_units,
        room_known_minutes=room_known,
        room_credits_scaled=room_credits,
        base_units=base_units,
        base_known_minutes=base_known,
        base_credits_scaled=base_credits,
        owned_by=owned_by,
        minutes_limit=minutes_limit,
        credits_limit=credits_limit,
        credit_target_scaled=target_scaled,
        assumptions=assumptions,
    )


# --------------------------------------------------------------------------------------------------------------------
# Independent validation of H1-H4 (used on every plan before it can be returned)
# --------------------------------------------------------------------------------------------------------------------


def validate_plan(problem: Problem, assignments: dict[str, Optional[str]]) -> list[str]:
    """`assignments` maps room_id -> the receiver who will own it afterwards (the current owner for a retained room,
    None for a room left unassigned). Returns every violated hard constraint; an empty list means the plan is safe."""
    prep = _prepare(problem)
    violations: list[str] = []
    receiver_ids = {r.user_id for r in prep.receivers}
    room_ids = {room.room_id for room in prep.rooms}
    index_of = {room.room_id: i for i, room in enumerate(prep.rooms)}

    for room_id in assignments:
        if room_id not in room_ids:
            violations.append(f"unknown_room:{room_id}")
    for room in prep.rooms:
        if room.room_id not in assignments:
            violations.append(f"room_missing:{room.room_id}")
            continue
        target = assignments[room.room_id]
        if target is None:
            if room.owner_id:
                violations.append(f"owned_room_dropped:{room.room_id}")
            continue
        if target != room.owner_id and target not in receiver_ids:
            violations.append(f"ineligible_receiver:{room.room_id}")

    for receiver in prep.receivers:
        uid = receiver.user_id
        mine = [index_of[rid] for rid, target in assignments.items() if target == uid and rid in index_of]
        # Everything the person ends with = existing work outside the pool + the pool rooms assigned to them.
        minutes = prep.base_known_minutes[uid] + sum(prep.room_known_minutes[i] for i in mine)
        credits = prep.base_credits_scaled[uid] + sum(prep.room_credits_scaled[i] for i in mine)
        limit_m = prep.minutes_limit[uid]
        limit_c = prep.credits_limit[uid]
        if limit_m is not None and minutes > limit_m:
            violations.append(f"shift_time:{uid}")
        if limit_c is not None and credits > limit_c:
            violations.append(f"credit_cap:{uid}")
    return violations


# --------------------------------------------------------------------------------------------------------------------
# Greedy plan: the warm start and the validated fallback. It never moves an owned room.
# --------------------------------------------------------------------------------------------------------------------


def _greedy(prep: _Prepared) -> dict[str, Optional[str]]:
    prefs = prep.preferences
    result: dict[str, Optional[str]] = {}
    units = {r.user_id: prep.base_units[r.user_id] for r in prep.receivers}
    minutes = {r.user_id: prep.base_known_minutes[r.user_id] for r in prep.receivers}
    credits = {r.user_id: prep.base_credits_scaled[r.user_id] for r in prep.receivers}
    floors = {r.user_id: set(r.floors) for r in prep.receivers}
    buildings = {r.user_id: set(r.buildings) for r in prep.receivers}
    for index, room in enumerate(prep.rooms):
        if room.owner_id:
            result[room.room_id] = room.owner_id
            if room.owner_id in units:
                units[room.owner_id] += prep.room_units[index]
                minutes[room.owner_id] += prep.room_known_minutes[index]
                credits[room.owner_id] += prep.room_credits_scaled[index]
    for index, room in enumerate(prep.rooms):
        if room.owner_id:
            continue
        best: Optional[tuple] = None
        best_id: Optional[str] = None
        for receiver in prep.receivers:
            uid = receiver.user_id
            limit_m, limit_c = prep.minutes_limit[uid], prep.credits_limit[uid]
            if limit_m is not None and minutes[uid] + prep.room_known_minutes[index] > limit_m:
                continue
            if limit_c is not None and credits[uid] + prep.room_credits_scaled[index] > limit_c:
                continue
            floor = _floor_key(room)
            new_floor = 1 if (prefs.prefer_same_floor and floor is not None and floor not in floors[uid]) else 0
            new_building = 1 if (prefs.prefer_same_building and room.building is not None and room.building not in buildings[uid]) else 0
            key = (units[uid] + prep.room_units[index] if prefs.balance_workload else 0, new_floor + new_building, uid)
            if best is None or key < best:
                best, best_id = key, uid
        if best_id is None:
            result[room.room_id] = None
            continue
        result[room.room_id] = best_id
        units[best_id] += prep.room_units[index]
        minutes[best_id] += prep.room_known_minutes[index]
        credits[best_id] += prep.room_credits_scaled[index]
        floor = _floor_key(room)
        if floor is not None:
            floors[best_id].add(floor)
        if room.building is not None:
            buildings[best_id].add(room.building)
    return result


# --------------------------------------------------------------------------------------------------------------------
# CP-SAT
# --------------------------------------------------------------------------------------------------------------------


def _solve_cp(prep: _Prepared, hint: dict[str, Optional[str]]):
    """Returns (status_name, {room_id: target | None}) or (status_name, None) when there is no solution."""
    from ortools.sat.python import cp_model

    prefs = prep.preferences
    model = cp_model.CpModel()
    rooms, receivers = prep.rooms, prep.receivers
    n_rooms = len(rooms)
    ids = [r.user_id for r in receivers]

    x: dict[tuple[int, int], object] = {}
    keep: dict[int, object] = {}
    drop: dict[int, object] = {}
    for r, room in enumerate(rooms):
        choices = []
        for h, uid in enumerate(ids):
            if uid == room.owner_id:
                continue
            var = model.NewBoolVar(f"x_{h}_{r}")
            x[h, r] = var
            choices.append(var)
        if room.owner_id:
            keep[r] = model.NewBoolVar(f"keep_{r}")
            choices.append(keep[r])
        else:
            drop[r] = model.NewBoolVar(f"drop_{r}")
            choices.append(drop[r])
        model.AddExactlyOne(choices)

    def taken_by(h: int) -> list[tuple[int, object]]:
        """(room index, variable) for every pool room that ends up with receiver h (kept rooms included)."""
        out = [(r, x[h, r]) for r in range(n_rooms) if (h, r) in x]
        out += [(r, keep[r]) for r in prep.owned_by.get(ids[h], [])]
        return out

    # H3 / H4 - capacity ------------------------------------------------------------------------------------------
    for h, uid in enumerate(ids):
        taken = taken_by(h)
        limit_m, limit_c = prep.minutes_limit[uid], prep.credits_limit[uid]
        if taken and limit_m is not None:
            model.Add(prep.base_known_minutes[uid] + sum(prep.room_known_minutes[r] * var for r, var in taken) <= limit_m)
        if taken and limit_c is not None:
            model.Add(prep.base_credits_scaled[uid] + sum(prep.room_credits_scaled[r] * var for r, var in taken) <= limit_c)

    objective: list = []

    # O1 - unallocated ---------------------------------------------------------------------------------------------
    for r, var in drop.items():
        objective.append(var * (UNALLOCATED_BASE * UNALLOCATED_URGENCY[prep.tiers[r]]))

    # Loads in 5-minute planning units, existing work included ------------------------------------------------------
    horizon = sum(prep.room_units) + sum(prep.base_units.values()) + 1
    loads = []
    for h, uid in enumerate(ids):
        load = model.NewIntVar(0, horizon, f"load_{h}")
        model.Add(load == prep.base_units[uid] + sum(prep.room_units[r] * var for r, var in taken_by(h)))
        loads.append(load)

    # O2 - fairness -------------------------------------------------------------------------------------------------
    if len(loads) > 1:
        high = model.NewIntVar(0, horizon, "high")
        low = model.NewIntVar(0, horizon, "low")
        model.AddMaxEquality(high, loads)
        model.AddMinEquality(low, loads)
        weight = FAIRNESS_WEIGHT if prefs.balance_workload else FAIRNESS_WEIGHT_OFF
        objective.append((high - low) * weight)

    # O3 - stability ------------------------------------------------------------------------------------------------
    move_cost = MOVE_COST if prefs.minimize_reassignment else MOVE_COST_RELAXED
    for r, var in keep.items():
        objective.append((1 - var) * move_cost)

    # O4 - urgent rooms to the least loaded -------------------------------------------------------------------------
    for (h, r), var in x.items():
        routing = URGENT_ROUTING[prep.tiers[r]]
        if routing:
            objective.append(var * (routing * prep.base_units[ids[h]]))

    # O5 - proximity: only floors / buildings the person does not already work ---------------------------------------
    for h, uid in enumerate(ids):
        receiver = receivers[h]
        by_floor: dict[tuple, list] = {}
        by_building: dict[str, list] = {}
        for r, var in taken_by(h):
            room = rooms[r]
            if room.owner_id == uid:
                continue  # a room they already own adds no new place
            floor = _floor_key(room)
            if prefs.prefer_same_floor and floor is not None and floor not in receiver.floors:
                by_floor.setdefault(floor, []).append(var)
            if prefs.prefer_same_building and room.building is not None and room.building not in receiver.buildings:
                by_building.setdefault(room.building, []).append(var)
        for key, variables in sorted(by_floor.items(), key=lambda item: str(item[0])):
            touched = model.NewBoolVar(f"floor_{h}_{key}")
            model.AddMaxEquality(touched, variables)
            objective.append(touched * NEW_FLOOR_COST)
        for key, variables in sorted(by_building.items(), key=lambda item: str(item[0])):
            touched = model.NewBoolVar(f"bld_{h}_{key}")
            model.AddMaxEquality(touched, variables)
            objective.append(touched * NEW_BUILDING_COST)

    # O6 - credits: stay under the target when we can, and keep the spread small -------------------------------------
    credit_totals = []
    credit_ceiling = sum(prep.room_credits_scaled) + sum(prep.base_credits_scaled.values()) + 10
    for h, uid in enumerate(ids):
        target = prep.credit_target_scaled[uid]
        total = prep.base_credits_scaled[uid]
        expr = total + sum(prep.room_credits_scaled[r] * var for r, var in taken_by(h))
        if target is not None:
            over = model.NewIntVar(0, credit_ceiling, f"over_{h}")
            model.Add(over >= expr - target)
            objective.append(over * CREDIT_OVER_TARGET_COST)
        credit_totals.append(expr)
    if len(credit_totals) > 1 and any(prep.room_credits_scaled):
        c_high = model.NewIntVar(0, credit_ceiling, "c_high")
        c_low = model.NewIntVar(0, credit_ceiling, "c_low")
        for expr in credit_totals:
            model.Add(c_high >= expr)
            model.Add(c_low <= expr)
        objective.append((c_high - c_low) * CREDIT_SPREAD_COST)

    model.Minimize(sum(objective))

    # Warm start from the validated greedy plan ----------------------------------------------------------------------
    for (h, r), var in x.items():
        model.AddHint(var, 1 if hint.get(rooms[r].room_id) == ids[h] else 0)
    for r, var in keep.items():
        model.AddHint(var, 1 if hint.get(rooms[r].room_id) == rooms[r].owner_id else 0)
    for r, var in drop.items():
        model.AddHint(var, 1 if hint.get(rooms[r].room_id) is None else 0)

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 1
    solver.parameters.max_deterministic_time = SOLVER_DETERMINISTIC_SECONDS
    solver.parameters.max_time_in_seconds = SOLVER_WALL_SECONDS
    solver.parameters.relative_gap_limit = SOLVER_GAP
    status = solver.Solve(model)
    name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return name, None

    result: dict[str, Optional[str]] = {}
    for r, room in enumerate(rooms):
        target: Optional[str] = None
        if r in keep and solver.Value(keep[r]):
            target = room.owner_id
        else:
            for h in range(len(ids)):
                if (h, r) in x and solver.Value(x[h, r]):
                    target = ids[h]
                    break
        result[room.room_id] = target
    return name, result


# --------------------------------------------------------------------------------------------------------------------
# Result extraction and grounded explanations
# --------------------------------------------------------------------------------------------------------------------


def _explain(prep: _Prepared, room_index: int, kind: MoveKind, to_id: str) -> list[dict]:
    """Reasons that are TRUE of the inputs, as structured codes the app renders. Anything not provable is omitted."""
    room = prep.rooms[room_index]
    receiver = next(r for r in prep.receivers if r.user_id == to_id) if kind != "retained" else None
    reasons: list[dict] = []
    tier = prep.tiers[room_index]
    if kind == "retained":
        return [{"code": "keeps_current_owner"}]
    if tier != "routine":
        top = next((reason for reason in room.reasons if REASON_TIER.get(reason) == tier), None)
        if top:
            reasons.append({"code": "urgent", "reason": top})
    if receiver is not None:
        others = [prep.base_units[r.user_id] for r in prep.receivers if r.user_id != to_id]
        if prep.preferences.balance_workload and others and prep.base_units[to_id] < min(others):
            reasons.append({"code": "lowest_workload", "minutes": prep.base_known_minutes[to_id]})
        floor = _floor_key(room)
        if floor is not None and floor in receiver.floors:
            reasons.append({"code": "same_floor", "floor": room.floor})
        elif room.building is not None and room.building in receiver.buildings:
            reasons.append({"code": "same_building", "building": room.building})
    if kind == "moved":
        reasons.append({"code": "moved_from_owner", "from": room.owner_id})
    return reasons


def _extract(
    prep: _Prepared,
    outcome: dict[str, Optional[str]],
    status: PlanStatus,
    diagnostics: dict,
    unallocated_reason: str = "insufficient_capacity",
) -> Plan:
    assignments: list[Assignment] = []
    unallocated: list[Unallocated] = []
    summaries = {r.user_id: StaffSummary(user_id=r.user_id) for r in prep.receivers}
    for index, room in enumerate(prep.rooms):
        target = outcome.get(room.room_id)
        tier = prep.tiers[index]
        if target is None:
            unallocated.append(
                Unallocated(room.room_id, room.room_number, unallocated_reason if prep.receivers else "no_eligible_staff", tier)
            )
            continue
        kind: MoveKind = "retained" if target == room.owner_id else ("moved" if room.owner_id else "new")
        assignments.append(
            Assignment(room.room_id, room.room_number, kind, room.owner_id, target, tier, _explain(prep, index, kind, target))
        )
        if kind != "retained" and target in summaries:
            summary = summaries[target]
            summary.rooms_added += 1
            summary.minutes_added_known += prep.room_known_minutes[index]
            if not room.minutes:
                summary.unknown_added += 1
            if room.credits is None:
                summary.credits_unknown_added += 1
            else:
                summary.credits_added_known += room.credits
        if kind == "moved" and room.owner_id in summaries:
            summaries[room.owner_id].rooms_released += 1
    for receiver in prep.receivers:
        # Someone who could not take even the smallest remaining room has no capacity left.
        if summaries[receiver.user_id].rooms_added == 0 and _has_no_headroom(prep, receiver):
            summaries[receiver.user_id].no_capacity = True
    return Plan(
        status=status,
        assignments=assignments,
        unallocated=unallocated,
        staff=[summaries[r.user_id] for r in prep.receivers],
        assumptions=list(prep.assumptions),
        diagnostics=diagnostics,
    )


def _has_no_headroom(prep: _Prepared, receiver: Receiver) -> bool:
    """True when this receiver is at a hard limit so no pool room with any positive requirement could be added."""
    uid = receiver.user_id
    owned = prep.owned_by.get(uid, [])
    minutes = prep.base_known_minutes[uid] + sum(prep.room_known_minutes[i] for i in owned)
    credits = prep.base_credits_scaled[uid] + sum(prep.room_credits_scaled[i] for i in owned)
    limit_m, limit_c = prep.minutes_limit[uid], prep.credits_limit[uid]
    candidates = [i for i, room in enumerate(prep.rooms) if room.owner_id != uid]
    if not candidates:
        return False
    for i in candidates:
        fits_m = limit_m is None or minutes + prep.room_known_minutes[i] <= limit_m
        fits_c = limit_c is None or credits + prep.room_credits_scaled[i] <= limit_c
        if fits_m and fits_c:
            return False
    return True


# --------------------------------------------------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------------------------------------------------


def solve(problem: Problem) -> Plan:
    prep = _prepare(problem)
    if not prep.rooms:
        return Plan(status="nothing_to_plan", assumptions=list(prep.assumptions))
    if not prep.receivers:
        outcome = {room.room_id: room.owner_id for room in prep.rooms}
        plan = _extract(prep, outcome, "no_staff", {"solver": "skipped"})
        return plan

    greedy = _greedy(prep)
    greedy_violations = validate_plan(problem, greedy)
    # The warm start only guides the search; an invalid heuristic is replaced by the status quo (always safe).
    hint = greedy if not greedy_violations else {room.room_id: room.owner_id for room in prep.rooms}
    solver_status, outcome = _solve_cp(prep, hint)
    diagnostics = {"solver": solver_status}

    status: PlanStatus
    if outcome is not None:
        violations = validate_plan(problem, outcome)
        if not violations:
            status = "optimal" if solver_status == "OPTIMAL" else "feasible"
            return _extract(prep, outcome, status, diagnostics)
        diagnostics["solver_violations"] = violations

    # No usable CP-SAT result: the greedy plan may stand in ONLY if it independently passes the same checks.
    fallback_violations = greedy_violations
    if not fallback_violations:
        # The heuristic cannot prove a room has nowhere to go, so a room it leaves out is "the solver could not allocate
        # it", never "there was no capacity".
        plan = _extract(prep, greedy, "fallback", {**diagnostics, "fallback": "greedy"}, unallocated_reason="solver_no_solution")
        plan.warnings.append("solver_fallback")
        return plan
    return Plan(
        status="no_safe_plan",
        assumptions=list(prep.assumptions),
        violations=fallback_violations,
        diagnostics={**diagnostics, "fallback": "rejected"},
    )


def plan_to_dict(plan: Plan) -> dict:
    return {
        "status": plan.status,
        "assignments": [
            {
                "room_id": a.room_id,
                "room_number": a.room_number,
                "kind": a.kind,
                "from_user_id": a.from_user_id,
                "to_user_id": a.to_user_id,
                "tier": a.tier,
                "reasons": a.reasons,
            }
            for a in plan.assignments
        ],
        "unallocated": [
            {"room_id": u.room_id, "room_number": u.room_number, "reason": u.reason, "tier": u.tier} for u in plan.unallocated
        ],
        "staff": [
            {
                "user_id": s.user_id,
                "rooms_added": s.rooms_added,
                "rooms_released": s.rooms_released,
                "minutes_added_known": s.minutes_added_known,
                "unknown_added": s.unknown_added,
                "credits_added_known": round(s.credits_added_known, 2),
                "credits_unknown_added": s.credits_unknown_added,
                "no_capacity": s.no_capacity,
            }
            for s in plan.staff
        ],
        "assumptions": plan.assumptions,
        "warnings": plan.warnings,
    }
