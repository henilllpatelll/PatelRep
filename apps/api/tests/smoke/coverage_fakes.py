"""FakeDB with an in-memory stand-in for the fill_coverage_gap() database function (migration 226).

It mirrors the function's observable contract -- lock/check the gap, refuse a stale version (CV001) or an already
resolved gap (CV002), refuse an overlapping replacement (23P01, as migration 225's trigger does), then write the
assignment, the filled gap, the covered absence and the settled offers/claims together or not at all. The SQL itself is
exercised by the CI migration run; these tests cover the API's use of it.
"""
from datetime import datetime
from types import SimpleNamespace

from postgrest.exceptions import APIError

from .fake_supabase import FakeDB


def _ts(v):
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def _fail(code, message):
    return APIError({"message": message, "code": code, "hint": None, "details": None})


class CoverageDB(FakeDB):
    def __init__(self, rows=None, **kw):
        super().__init__(rows, **kw)
        self.rpc_calls = []
        self.fill_gate = None  # optional callable run inside the "transaction" before the checks (to simulate a race)
        self.offer_gate = None  # same, for create_coverage_offer()
        self.absence_fault = None  # callable run after the absence insert and before the gap insert (simulates a crash/failure)

    def next_id(self, table_name):
        """UUID-shaped ids, because the request models validate UUID4 like production ids."""
        self._id_counter += 1
        return f"{self._id_counter:08x}-0000-4000-8000-{self._id_counter:012x}"

    def rpc(self, name, params):
        db = self

        class Call:
            def execute(self_inner):
                db.rpc_calls.append(params)
                if name == "record_absence_with_gap":
                    return SimpleNamespace(data=db._record_absence(params))
                if name == "create_coverage_offer":
                    return SimpleNamespace(data=db._create_offer(params))
                assert name == "fill_coverage_gap", name
                return SimpleNamespace(data=db._fill(params))

        return Call()

    def _record_absence(self, p):
        """record_absence_with_gap(): both rows or neither (a failure after the first insert restores the tables)."""
        import copy

        snapshot = {t: copy.deepcopy(self.rows.get(t, [])) for t in ("absence_records", "coverage_gaps")}
        try:
            a, g = p["p_absence"], p["p_gap"]
            absences = self.rows.setdefault("absence_records", [])
            tenant = p["p_tenant_id"]
            if a.get("idempotency_key") and any(r["tenant_id"] == tenant and r.get("idempotency_key") == a["idempotency_key"] for r in absences):
                raise _fail("23505", "duplicate key value violates unique constraint (idempotency)")
            if any(r["assignment_id"] == a["assignment_id"] and r["status"] in ("reported", "confirmed", "covered") for r in absences):
                raise _fail("23505", "duplicate key value violates unique constraint uq_absence_live_per_assignment")
            absence = {"id": self.next_id("absence_records"), "tenant_id": tenant, "version": 1, "status": "confirmed",
                       "created_at": datetime.now().isoformat(), **a}
            absences.append(absence)
            if self.absence_fault:
                self.absence_fault()
            if not g.get("department_id"):
                raise _fail("23502", "null value in column department_id violates not-null constraint")
            gap = {"id": self.next_id("coverage_gaps"), "tenant_id": tenant, "source": "absence", "absence_id": absence["id"],
                   "status": "open", "claimable": False, "version": 1, "created_at": datetime.now().isoformat(), **g}
            self.rows.setdefault("coverage_gaps", []).append(gap)
            return {"absence": dict(absence), "gap": dict(gap)}
        except Exception:
            for table, rows in snapshot.items():
                self.rows[table] = rows
            raise

    def _create_offer(self, p):
        """create_coverage_offer(): lock + check the gap, insert the offer and move open -> offered in one step."""
        if self.offer_gate:
            self.offer_gate()
        gap = next((g for g in self.rows.setdefault("coverage_gaps", []) if g["id"] == p["p_gap_id"] and g["tenant_id"] == p["p_tenant_id"]), None)
        if gap is None:
            raise _fail("CV003", "coverage gap not found")
        if gap["status"] not in ("open", "offered"):
            raise _fail("CV002", f"coverage gap is already {gap['status']}")
        if gap["version"] != p["p_expected_version"]:
            raise _fail("CV001", "coverage gap changed")
        offers = self.rows.setdefault("coverage_offers", [])
        if any(o["gap_id"] == gap["id"] and o["user_id"] == p["p_user_id"] and o["status"] == "pending" for o in offers):
            raise _fail("23505", "duplicate key value violates unique constraint uq_offer_pending_per_user")
        offer = {"id": self.next_id("coverage_offers"), "tenant_id": p["p_tenant_id"], "gap_id": gap["id"], "user_id": p["p_user_id"],
                 "status": "pending", "expires_at": p["p_expires_at"], "offered_by": p["p_offered_by"], "delivery": "not_sent", "version": 1,
                 "created_at": datetime.now().isoformat()}
        offers.append(offer)
        if gap["status"] == "open":
            gap.update(status="offered", version=gap["version"] + 1)
        return dict(offer)

    def _fill(self, p):
        if self.fill_gate:
            self.fill_gate()
        gaps = self.rows.setdefault("coverage_gaps", [])
        gap = next((g for g in gaps if g["id"] == p["p_gap_id"] and g["tenant_id"] == p["p_tenant_id"]), None)
        if gap is None:
            raise _fail("CV003", "coverage gap not found")
        if gap["status"] not in ("open", "offered"):
            raise _fail("CV002", f"coverage gap is already {gap['status']}")
        if gap["version"] != p["p_expected_version"]:
            raise _fail("CV001", "coverage gap changed")
        a = p["p_assignment"]
        starts, ends = _ts(a["starts_at"]), _ts(a["ends_at"])
        for other in self.rows.setdefault("shift_assignments", []):
            if (other["user_id"] == a["user_id"] and other.get("publication_state") != "cancelled"
                    and _ts(other["starts_at"]) < ends and _ts(other["ends_at"]) > starts):
                raise _fail("23P01", "shift_assignments overlap for user")
        new_id = self.next_id("shift_assignments")
        self.rows["shift_assignments"].append({
            "id": new_id, "tenant_id": p["p_tenant_id"], "user_id": a["user_id"], "shift_id": a["shift_id"],
            "work_date": a["work_date"], "shift_name": a["shift_name"], "department_id": a["department_id"],
            "start_time": a["start_time"], "end_time": a["end_time"], "starts_at": a["starts_at"], "ends_at": a["ends_at"],
            "publication_state": "published", "version": 1, "notes": a.get("notes"), "snapshot_source": "occurrence",
        })
        gap.update(status="filled", resolution=p["p_resolution"], filled_assignment_id=new_id, filled_user_id=a["user_id"],
                   version=gap["version"] + 1)
        for absence in self.rows.get("absence_records", []):
            if absence["id"] == gap.get("absence_id") and absence["status"] == "confirmed":
                absence["status"] = "covered"
        for offer in self.rows.get("coverage_offers", []):
            if offer["gap_id"] == gap["id"] and offer["status"] == "pending":
                offer["status"] = "accepted" if offer["id"] == p["p_offer_id"] else "superseded"
        for claim in self.rows.get("coverage_claims", []):
            if claim["gap_id"] == gap["id"] and claim["status"] == "pending":
                claim["status"] = "approved" if claim["id"] == p["p_claim_id"] else "declined"
        return {"assignment_id": new_id, "gap_id": gap["id"], "user_id": a["user_id"]}
