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

    def next_id(self, table_name):
        """UUID-shaped ids, because the request models validate UUID4 like production ids."""
        self._id_counter += 1
        return f"{self._id_counter:08x}-0000-4000-8000-{self._id_counter:012x}"

    def rpc(self, name, params):
        db = self

        class Call:
            def execute(self_inner):
                assert name == "fill_coverage_gap", name
                db.rpc_calls.append(params)
                return SimpleNamespace(data=db._fill(params))

        return Call()

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
