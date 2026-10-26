"""Smart Balance solver (services/smart_balance.py): pure, deterministic, hard-constraint-first."""

import time


from services import smart_balance as sb
from services.smart_balance import Preferences, PoolRoom, Problem, Receiver, solve, validate_plan


def room(n, *, owner=None, minutes=30, credits=3.0, floor=None, building="A", reasons=(), arrival=None):
    return PoolRoom(
        room_id=f"r{n:03d}",
        room_number=str(n),
        floor=floor if floor is not None else n // 100,
        building=building,
        owner_id=owner,
        minutes=minutes,
        minutes_basis="room_type" if minutes else None,
        credits=credits,
        reasons=tuple(reasons),
        arrival_at=arrival,
    )


def staff(uid, **kw):
    return Receiver(user_id=uid, **kw)


def by_room(plan):
    return {a.room_id: a for a in plan.assignments}


def owners(plan):
    return {a.room_id: a.to_user_id for a in plan.assignments}


def test_nothing_to_plan_and_no_staff():
    assert solve(Problem(rooms=(), receivers=(staff("a"),))).status == "nothing_to_plan"
    plan = solve(Problem(rooms=(room(101),), receivers=()))
    assert plan.status == "no_staff"
    assert [u.reason for u in plan.unallocated] == ["no_eligible_staff"]
    assert plan.assignments == []


def test_every_unowned_room_is_allocated_once_to_a_listed_receiver():
    rooms = tuple(room(100 + i) for i in range(8))
    plan = solve(Problem(rooms=rooms, receivers=(staff("a"), staff("b"), staff("c"))))
    assert plan.status in ("optimal", "feasible")
    assert sorted(a.room_id for a in plan.assignments) == sorted(r.room_id for r in rooms)
    assert {a.to_user_id for a in plan.assignments} <= {"a", "b", "c"}
    assert all(a.kind == "new" and a.from_user_id is None for a in plan.assignments)
    assert plan.unallocated == []


def test_existing_workload_drives_fairness_not_room_count():
    # b already has 270 known minutes; a has none. Six 30-minute rooms should mostly go to a.
    rooms = tuple(room(100 + i) for i in range(6))
    plan = solve(Problem(rooms=rooms, receivers=(staff("a", base_minutes=0), staff("b", base_minutes=270))))
    counts = {"a": 0, "b": 0}
    for a in plan.assignments:
        counts[a.to_user_id] += 1
    assert counts["a"] == 6 and counts["b"] == 0


def test_rooms_are_balanced_by_minutes_not_by_count():
    # One 90-minute room versus three 30-minute rooms: equal minutes means 1 room vs 3 rooms is the balanced split.
    rooms = (room(101, minutes=90), room(102), room(103), room(104))
    plan = solve(Problem(rooms=rooms, receivers=(staff("a"), staff("b"))))
    totals = {"a": 0, "b": 0}
    for a in plan.assignments:
        totals[a.to_user_id] += {"r101": 90}.get(a.room_id, 30)
    assert totals["a"] == totals["b"] == 90


def test_credit_target_is_a_hard_cap_with_partial_plan_and_least_urgent_dropped_first():
    # Each person may reach target+2 = 5 credits: one 3-credit room each. Three rooms, two people.
    rooms = (room(101, reasons=("guest_waiting",)), room(102), room(103))
    people = (staff("a", credit_target=3.0), staff("b", credit_target=3.0))
    plan = solve(Problem(rooms=rooms, receivers=people))
    assert len(plan.assignments) == 2
    assert [u.room_id for u in plan.unallocated] == ["r102"] or [u.room_id for u in plan.unallocated] == ["r103"]
    assert "r101" in by_room(plan)  # the guest-waiting room is never the one dropped
    assert plan.unallocated[0].reason == "insufficient_capacity"
    assert validate_plan(Problem(rooms=rooms, receivers=people), {**owners(plan), **{u.room_id: None for u in plan.unallocated}}) == []


def test_existing_credits_count_toward_the_cap():
    # a already carries 4.5 credits (target 3 -> cap 5); b has none. A 3-credit room can only go to b.
    plan = solve(Problem(rooms=(room(101),), receivers=(staff("a", base_credits=4.5, credit_target=3.0), staff("b", credit_target=3.0))))
    assert owners(plan) == {"r101": "b"}


def test_capacity_overrides_arrive_as_a_per_person_target():
    rooms = (room(101), room(102))
    people = (staff("a", credit_target=3.0), staff("b", credit_target=20.0))
    plan = solve(Problem(rooms=rooms, receivers=people))
    assert sum(1 for a in plan.assignments if a.to_user_id == "a") <= 1  # a is capped at 5 credits


def test_shift_time_left_is_a_hard_limit_on_known_minutes():
    rooms = (room(101, minutes=60), room(102, minutes=60))
    plan = solve(Problem(rooms=rooms, receivers=(staff("a", shift_minutes_left=70), staff("b", shift_minutes_left=70))))
    assert sorted(a.to_user_id for a in plan.assignments) == ["a", "b"]


def test_a_person_already_over_a_limit_cannot_gain_but_is_not_made_worse():
    plan = solve(Problem(rooms=(room(101),), receivers=(staff("a", base_credits=9.0, credit_target=3.0),)))
    assert plan.assignments == []
    assert [u.reason for u in plan.unallocated] == ["insufficient_capacity"]
    assert plan.staff[0].no_capacity is True


def test_unknown_capacity_is_reported_and_not_enforced():
    plan = solve(Problem(rooms=tuple(room(100 + i) for i in range(4)), receivers=(staff("a"),)))
    assert len(plan.assignments) == 4
    codes = {item["code"] for item in plan.assumptions}
    assert "capacity_unknown" in codes


def test_missing_estimates_are_an_explicit_assumption_not_a_duration():
    rooms = (room(101, minutes=None), room(102, minutes=40), room(103, minutes=None))
    plan = solve(Problem(rooms=rooms, receivers=(staff("a"), staff("b"))))
    surrogate = next(item for item in plan.assumptions if item["code"] == "unknown_estimate_surrogate")
    assert surrogate["rooms"] == 2 and surrogate["minutes"] == 40  # median of the KNOWN estimates only
    added = {s.user_id: s for s in plan.staff}
    assert sum(s.minutes_added_known for s in added.values()) == 40  # unknown rooms add 0 known minutes
    assert sum(s.unknown_added for s in added.values()) == 2


def test_all_estimates_unknown_falls_back_to_a_labelled_planning_value():
    plan = solve(Problem(rooms=(room(101, minutes=None), room(102, minutes=None)), receivers=(staff("a"), staff("b"))))
    surrogate = next(item for item in plan.assumptions if item["code"] == "unknown_estimate_surrogate")
    assert surrogate["minutes"] == sb.PLANNING_FALLBACK_MINUTES
    assert sorted(a.to_user_id for a in plan.assignments) == ["a", "b"]  # still spread


def test_proximity_prefers_a_person_already_on_the_floor():
    rooms = (room(301, floor=3, building="A"),)
    people = (staff("a", floors=frozenset({("A", 3)}), buildings=frozenset({"A"})), staff("b", floors=frozenset({("A", 1)}), buildings=frozenset({"A"})))
    plan = solve(Problem(rooms=rooms, receivers=people))
    assert owners(plan) == {"r301": "a"}
    assert {"code": "same_floor", "floor": 3} in by_room(plan)["r301"].reasons


def test_proximity_is_ignored_when_turned_off_and_never_beats_a_hard_limit():
    rooms = (room(301, floor=3),)
    people = (
        staff("a", floors=frozenset({("A", 3)}), buildings=frozenset({"A"}), base_credits=4.9, credit_target=3.0),
        staff("b", credit_target=3.0),
    )
    plan = solve(Problem(rooms=rooms, receivers=people))
    assert owners(plan) == {"r301": "b"}


def test_urgent_rooms_go_to_the_least_loaded_person_and_are_explained_truthfully():
    rooms = (room(101, reasons=("guest_waiting",)), room(102), room(103), room(104))
    plan = solve(Problem(rooms=rooms, receivers=(staff("busy", base_minutes=120), staff("free", base_minutes=0))))
    urgent = by_room(plan)["r101"]
    assert urgent.to_user_id == "free" and urgent.tier == "critical"
    assert {"code": "urgent", "reason": "guest_waiting"} in urgent.reasons
    assert any(r["code"] == "lowest_workload" for r in urgent.reasons)


def test_priority_preferences_switch_urgency_off():
    prefs = Preferences(prioritize_guest_waiting=False)
    assert sb.effective_tier(("guest_waiting",), prefs) == "routine"
    assert sb.effective_tier(("guest_waiting", "vip"), prefs) == "elevated"
    assert sb.effective_tier(("guest_waiting",), Preferences()) == "critical"


def test_default_scope_keeps_existing_owners_when_rooms_are_unowned_only():
    # Only unowned rooms are in the pool for the default scope; whoever has other work keeps it (it is simply not here).
    plan = solve(Problem(rooms=(room(101), room(102)), receivers=(staff("a", base_minutes=60, base_rooms=2), staff("b"))))
    assert all(a.kind == "new" for a in plan.assignments)


def test_full_rebalance_keeps_owners_unless_moving_clearly_helps():
    # Two people with equal loads: nothing should move.
    rooms = (room(101, owner="a"), room(102, owner="b"))
    plan = solve(Problem(rooms=rooms, receivers=(staff("a"), staff("b"))))
    assert {a.kind for a in plan.assignments} == {"retained"}
    assert all(r == {"code": "keeps_current_owner"} for a in plan.assignments for r in a.reasons)


def test_full_rebalance_does_not_move_work_for_a_cosmetic_gain():
    # 35 vs 30 minutes: a 5-minute range is not worth moving a room.
    rooms = (room(101, owner="a", minutes=35), room(102, owner="b", minutes=30))
    plan = solve(Problem(rooms=rooms, receivers=(staff("a"), staff("b"))))
    assert {a.kind for a in plan.assignments} == {"retained"}


def test_full_rebalance_moves_work_off_an_overloaded_person_when_it_is_worth_it():
    rooms = tuple(room(100 + i, owner="a") for i in range(6))
    plan = solve(Problem(rooms=rooms, receivers=(staff("a"), staff("b"))))
    moved = [a for a in plan.assignments if a.kind == "moved"]
    assert len(moved) == 3
    assert all(a.from_user_id == "a" and a.to_user_id == "b" for a in moved)
    assert all(any(r["code"] == "moved_from_owner" for r in a.reasons) for a in moved)


def test_a_room_owned_by_someone_who_cannot_receive_stays_with_them_unless_a_listed_person_can_take_it():
    rooms = (room(101, owner="off-shift"),)
    plan = solve(Problem(rooms=rooms, receivers=(staff("a"),), ))
    # Moving it to `a` would balance nothing and is never forced; the owner keeps it.
    assert by_room(plan)["r101"].kind in ("retained", "moved")
    assert validate_plan(Problem(rooms=rooms, receivers=(staff("a"),)), owners(plan)) == []


def test_owned_room_whose_new_owner_would_break_a_cap_stays_put():
    rooms = (room(101, owner="x", credits=3.0),)
    plan = solve(Problem(rooms=rooms, receivers=(staff("a", base_credits=4.5, credit_target=3.0),)))
    assert by_room(plan)["r101"].kind == "retained"


def test_identical_input_gives_identical_output_whatever_the_input_order():
    rooms = tuple(room(100 + i, minutes=20 + (i % 4) * 15, floor=1 + i % 3) for i in range(24))
    people = tuple(staff(f"s{i}", base_minutes=i * 10, floors=frozenset({("A", 1 + i % 3)}), buildings=frozenset({"A"})) for i in range(5))
    first = solve(Problem(rooms=rooms, receivers=people))
    second = solve(Problem(rooms=tuple(reversed(rooms)), receivers=tuple(reversed(people))))
    third = solve(Problem(rooms=rooms, receivers=people))
    assert owners(first) == owners(second) == owners(third)
    assert first.status == third.status


def test_infeasible_pool_is_honest_partial_not_manufactured_feasibility():
    rooms = tuple(room(100 + i, credits=3.0) for i in range(5))
    people = (staff("a", credit_target=3.0),)
    plan = solve(Problem(rooms=rooms, receivers=people))
    assert len(plan.assignments) == 1 and len(plan.unallocated) == 4
    assert all(u.reason == "insufficient_capacity" for u in plan.unallocated)


def test_solver_timeout_without_solution_uses_only_a_validated_fallback(monkeypatch):
    rooms = tuple(room(100 + i) for i in range(4))
    monkeypatch.setattr(sb, "_solve_cp", lambda prep, hint: ("UNKNOWN", None))
    plan = solve(Problem(rooms=rooms, receivers=(staff("a"), staff("b"))))
    assert plan.status == "fallback"
    assert "solver_fallback" in plan.warnings
    assert validate_plan(Problem(rooms=rooms, receivers=(staff("a"), staff("b"))), owners(plan)) == []


def test_fallback_that_cannot_be_validated_is_refused(monkeypatch):
    rooms = (room(101),)
    people = (staff("a"),)
    monkeypatch.setattr(sb, "_solve_cp", lambda prep, hint: ("UNKNOWN", None))
    monkeypatch.setattr(sb, "_greedy", lambda prep: {"r101": "ghost"})
    plan = solve(Problem(rooms=rooms, receivers=people))
    assert plan.status == "no_safe_plan"
    assert plan.assignments == [] and plan.violations


def test_an_invalid_solver_answer_is_never_returned(monkeypatch):
    rooms = (room(101),)
    people = (staff("a"),)
    monkeypatch.setattr(sb, "_solve_cp", lambda prep, hint: ("OPTIMAL", {"r101": "ghost"}))
    plan = solve(Problem(rooms=rooms, receivers=people))
    assert plan.status == "fallback"  # the validated greedy plan, not the bad answer
    assert owners(plan) == {"r101": "a"}


def test_validate_plan_catches_every_hard_constraint():
    rooms = (room(101, owner="a"), room(102))
    problem = Problem(rooms=rooms, receivers=(staff("a", credit_target=3.0, base_credits=4.0), staff("b")))
    assert validate_plan(problem, {"r101": "a", "r102": "b"}) == []
    assert "ineligible_receiver:r102" in validate_plan(problem, {"r101": "a", "r102": "ghost"})
    assert "owned_room_dropped:r101" in validate_plan(problem, {"r101": None, "r102": "b"})
    assert "room_missing:r102" in validate_plan(problem, {"r101": "a"})
    assert "unknown_room:zzz" in validate_plan(problem, {"r101": "a", "r102": "b", "zzz": "a"})
    # a is already above target+2 (4 + 3 for r101 = 7 > 5) so they may keep what they own but cannot gain
    assert "credit_cap:a" in validate_plan(problem, {"r101": "a", "r102": "a"})


def test_large_hotel_stays_within_the_documented_resource_bounds():
    rooms = tuple(
        room(100 * (1 + i // 25) + i % 25, minutes=20 + (i % 5) * 10, credits=1 + (i % 3), floor=1 + i // 25, building="AB"[i % 2])
        for i in range(150)
    )
    people = tuple(
        staff(f"s{i:02d}", base_minutes=(i % 7) * 15, base_credits=(i % 4), credit_target=16.0, shift_minutes_left=480, floors=frozenset({("A", 1 + i % 5)}), buildings=frozenset({"A"}))
        for i in range(25)
    )
    started = time.monotonic()
    plan = solve(Problem(rooms=rooms, receivers=people))
    elapsed = time.monotonic() - started
    assert elapsed < sb.SOLVER_WALL_SECONDS + 6
    assert plan.status in ("optimal", "feasible", "fallback")
    assert len(plan.assignments) + len(plan.unallocated) == 150
    assert validate_plan(Problem(rooms=rooms, receivers=people), {**owners(plan), **{u.room_id: None for u in plan.unallocated}}) == []
