"""FakeDB with in-memory stand-ins for migration 227's functions and triggers (Team Scheduling Phase 5).

It mirrors the OBSERVABLE contract of the SQL: replace_weekly_availability() (revision check, supersede/end-date, insert the
set), approve_shift_swap() (every check first, then both assignments exchanged together or not at all), and the three
triggers' refusals (23P01 live-leave overlap, SW011 shift already in a live swap, TO001 shift over approved leave). The SQL
itself is exercised by the CI migration run (tests/integration/test_availability_swaps.py); these tests cover the API's use of it.
"""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from postgrest.exceptions import APIError

from .coverage_fakes import CoverageDB


def _ts(v):
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def _fail(code, message):
    return APIError({"message": message, "code": code, "hint": None, "details": None})


class RequestsDB(CoverageDB):
    def __init__(self, rows=None, **kw):
        super().__init__(rows, **kw)
        self.swap_gate = None     # callable run inside the swap "transaction" before its checks (simulates a race)
        self.swap_steps = []      # what approve_shift_swap actually wrote, in order

    # --- triggers -----------------------------------------------------------------------------------------------
    def table(self, name):
        query = super().table(name)
        real = query.execute
        db = self

        def execute():
            if query.action == "insert":
                for payload in (query.payload if isinstance(query.payload, list) else [query.payload]):
                    db._check_insert(name, payload)
            return real()

        query.execute = execute
        return query

    def _check_insert(self, table, row):
        if table == "time_off_requests" and row.get("status", "pending") in ("pending", "approved"):
            for other in self.rows.get("time_off_requests", []):
                if (other["user_id"] == row["user_id"] and other["status"] in ("pending", "approved")
                        and _ts(other["starts_at"]) < _ts(row["ends_at"]) and _ts(other["ends_at"]) > _ts(row["starts_at"])):
                    raise _fail("23P01", "time-off request overlaps another live request")
        if table == "shift_assignments" and row.get("publication_state", "published") != "cancelled":
            if self._on_approved_leave(row["user_id"], row["starts_at"], row["ends_at"]):
                raise _fail("TO001", "approved time off overlaps this shift")
        if table == "shift_swap_requests" and row.get("status", "proposed") in ("proposed", "accepted"):
            mine = {row["requester_assignment_id"], row["counterpart_assignment_id"]}
            for other in self.rows.get("shift_swap_requests", []):
                if other["status"] in ("proposed", "accepted") and mine & {other["requester_assignment_id"], other["counterpart_assignment_id"]}:
                    raise _fail("SW011", "shift already in a live swap")

    def _on_approved_leave(self, user_id, starts_at, ends_at):
        return any(
            leave["user_id"] == user_id and leave["status"] == "approved"
            and _ts(leave["starts_at"]) < _ts(ends_at) and _ts(leave["ends_at"]) > _ts(starts_at)
            for leave in self.rows.get("time_off_requests", [])
        )

    # --- functions ----------------------------------------------------------------------------------------------
    def rpc(self, name, params):
        db = self

        class Call:
            def execute(self_inner):
                db.rpc_calls.append(params)
                if name == "fill_coverage_gap":
                    return SimpleNamespace(data=db._fill(params))
                if name == "record_absence_with_gap":
                    return SimpleNamespace(data=db._record_absence(params))
                if name == "create_coverage_offer":
                    return SimpleNamespace(data=db._create_offer(params))
                if name == "replace_weekly_availability":
                    return SimpleNamespace(data=db._replace_availability(params))
                if name == "approve_shift_swap":
                    return SimpleNamespace(data=db._approve_swap(params))
                raise AssertionError(name)

        return Call()

    def _replace_availability(self, p):
        rows = self.rows.setdefault("employee_availability", [])
        mine = [r for r in rows if r["tenant_id"] == p["p_tenant_id"] and r["user_id"] == p["p_user_id"] and r["kind"] == "weekly"]
        revision = max((r.get("revision", 0) for r in mine), default=0)
        if revision != p["p_expected_revision"]:
            raise _fail("AV001", "availability changed")
        effective = p["p_effective_from"]
        for row in mine:
            if row["status"] != "active":
                continue
            if row["effective_from"] >= effective:
                row.update(status="retired")
            elif row.get("effective_to") is None or row["effective_to"] >= effective:
                row["effective_to"] = (date.fromisoformat(effective) - timedelta(days=1)).isoformat()
        for day in p["p_days"]:
            rows.append({
                "id": self.next_id("employee_availability"), "tenant_id": p["p_tenant_id"], "user_id": p["p_user_id"], "kind": "weekly",
                "weekday": day["weekday"], "exception_date": None, "mode": day["mode"], "windows": day.get("windows", []),
                "effective_from": effective, "effective_to": None, "status": "active", "revision": revision + 1, "version": 1,
                "note": None, "created_at": datetime.now(timezone.utc).isoformat(),
            })
        return {"revision": revision + 1, "days": len(p["p_days"])}

    def _approve_swap(self, p):
        if self.swap_gate:
            self.swap_gate()
        swaps = self.rows.setdefault("shift_swap_requests", [])
        swap = next((s for s in swaps if s["id"] == p["p_swap_id"] and s["tenant_id"] == p["p_tenant_id"]), None)
        if swap is None:
            raise _fail("SW003", "swap not found")
        if swap["status"] != "accepted":
            raise _fail("SW002", f"swap is {swap['status']}")
        if swap["version"] != p["p_expected_version"]:
            raise _fail("SW001", "swap changed")
        by_id = {a["id"]: a for a in self.rows.get("shift_assignments", [])}
        a, b = by_id.get(swap["requester_assignment_id"]), by_id.get(swap["counterpart_assignment_id"])
        if a is None or b is None:
            raise _fail("SW004", "shift missing")
        if (a["version"] != swap["requester_assignment_version"] or b["version"] != swap["counterpart_assignment_version"]
                or a["user_id"] != swap["requester_id"] or b["user_id"] != swap["counterpart_id"]
                or a.get("publication_state") != "published" or b.get("publication_state") != "published"):
            raise _fail("SW005", "a shift changed")
        now = datetime.now(timezone.utc)
        if _ts(a["starts_at"]) <= now or _ts(b["starts_at"]) <= now or a.get("clocked_in_at") or b.get("clocked_in_at"):
            raise _fail("SW006", "a shift has started")
        active = {r["user_id"] for r in self.rows.get("user_roles", []) if r["tenant_id"] == p["p_tenant_id"] and r.get("is_active")}
        if swap["requester_id"] not in active or swap["counterpart_id"] not in active:
            raise _fail("SW007", "employee inactive")
        if a.get("department_id") != b.get("department_id"):
            raise _fail("SW008", "different departments")
        if _ts(a["starts_at"]) < _ts(b["ends_at"]) and _ts(b["starts_at"]) < _ts(a["ends_at"]):
            raise _fail("SW009", "shifts overlap")
        if any(x["assignment_id"] in (a["id"], b["id"]) and x["status"] in ("reported", "confirmed", "covered")
               for x in self.rows.get("absence_records", [])):
            raise _fail("SW010", "call-out on file")
        # Trigger checks for the two new owners, evaluated BEFORE anything is written (the real function rolls back).
        for mover, new_owner, leaving in ((a, swap["counterpart_id"], b), (b, swap["requester_id"], a)):
            if self._on_approved_leave(new_owner, mover["starts_at"], mover["ends_at"]):
                raise _fail("TO001", "approved time off")
            for other in self.rows["shift_assignments"]:
                if (other["user_id"] == new_owner and other["id"] not in (mover["id"], leaving["id"]) and other.get("publication_state") != "cancelled"
                        and _ts(other["starts_at"]) < _ts(mover["ends_at"]) and _ts(other["ends_at"]) > _ts(mover["starts_at"])):
                    raise _fail("23P01", "shift_assignments overlap for user")
        a["user_id"], b["user_id"] = swap["counterpart_id"], swap["requester_id"]
        a["version"] += 1
        b["version"] += 1
        self.swap_steps.append(("exchanged", a["id"], b["id"]))
        swap.update(status="approved", decided_by=p["p_actor"], decided_at=now.isoformat(), decision_reason=p["p_note"], version=swap["version"] + 1)
        self.rows.setdefault("operational_audit_events", []).extend([
            {"tenant_id": p["p_tenant_id"], "resource_type": "shift_swap", "resource_id": swap["id"], "action": "approved", "actor_id": p["p_actor"],
             "actor_role": p["p_actor_role"], "old_state": {"status": "accepted"}, "new_state": {"status": "approved"}, "reason_note": p["p_note"],
             "created_at": now.isoformat()},
            {"tenant_id": p["p_tenant_id"], "resource_type": "shift_assignment", "resource_id": a["id"], "action": "swapped", "actor_id": p["p_actor"],
             "actor_role": p["p_actor_role"], "old_state": {}, "new_state": {}, "reason_note": None, "created_at": now.isoformat()},
            {"tenant_id": p["p_tenant_id"], "resource_type": "shift_assignment", "resource_id": b["id"], "action": "swapped", "actor_id": p["p_actor"],
             "actor_role": p["p_actor_role"], "old_state": {}, "new_state": {}, "reason_note": None, "created_at": now.isoformat()},
        ])
        return {"swap_id": swap["id"], "requester_assignment_id": a["id"], "counterpart_assignment_id": b["id"]}
