"""FakeDB with in-memory stand-ins for migration 228's functions and the revision guards (Team Scheduling Phase 7).

It mirrors the OBSERVABLE contract of publish_schedule_revision() and claim_schedule_notifications(): replay by
idempotency key, the refusal codes (SR001-SR010), lock + verify everything before the first write, apply cancels then
edits then creates all-or-nothing (a failure restores every touched row), and the notification intents written in the
same "transaction". The SQL itself is exercised on a real database by tests/integration/test_schedule_publishing.py;
these tests cover the API's use of it.
"""
import copy
from datetime import date, datetime, timezone
from types import SimpleNamespace

from postgrest.exceptions import APIError

from .request_fakes import RequestsDB, _fail, _ts


class RevisionsDB(RequestsDB):
    def __init__(self, rows=None, **kw):
        super().__init__(rows, **kw)
        self.publish_gate = None  # callable run inside the publish "transaction" before its checks (simulates a race)
        self.publish_calls = 0
        for table in ("schedule_revisions", "schedule_revision_changes", "schedule_revision_events", "schedule_notifications",
                      "notifications", "notification_deliveries"):
            self.rows.setdefault(table, [])
        self.today = date(2029, 6, 1)  # "now" inside the fake database: far enough before the 2030 fixtures

    # --- table-level guards ---------------------------------------------------------------------------------------
    def table(self, name):
        query = super().table(name)
        real = query.execute
        db = self

        def execute():
            if query.action == "insert":  # database default: created_at = now()
                for payload in (query.payload if isinstance(query.payload, list) else [query.payload]):
                    if isinstance(payload, dict):
                        payload.setdefault("created_at", datetime.now(timezone.utc).isoformat())
            if name == "schedule_revision_changes" and query.action in ("insert", "update", "delete"):
                revisions = {r["id"]: r for r in db.rows["schedule_revisions"]}
                targets = query.payload if isinstance(query.payload, list) else [query.payload]
                ids = {t.get("revision_id") for t in targets if isinstance(t, dict) and t.get("revision_id")}
                if query.action != "insert":
                    ids |= {r["revision_id"] for r in db.rows[name] if query._matches(r)}
                if any(revisions.get(i, {}).get("status") != "draft" for i in ids):
                    raise _fail("SR002", "only an open draft can change")
            if name == "schedule_notifications" and query.action == "upsert":
                fresh, seen = [], {(r["tenant_id"], r["dedupe_key"]) for r in db.rows[name]}
                for payload in (query.payload if isinstance(query.payload, list) else [query.payload]):
                    key = (payload["tenant_id"], payload["dedupe_key"])
                    if key not in seen:
                        seen.add(key)
                        row = {"id": db.next_id(name), "status": "queued", "attempts": 0, "push_status": "not_attempted",
                               "next_attempt_at": datetime.now(timezone.utc).isoformat(), **payload}
                        db.rows[name].append(row)
                        fresh.append(row)
                return SimpleNamespace(data=fresh)
            if name == "notifications" and query.action == "insert":
                for payload in (query.payload if isinstance(query.payload, list) else [query.payload]):
                    if payload.get("dedupe_key") and any(
                        r.get("dedupe_key") == payload["dedupe_key"] and r["tenant_id"] == payload["tenant_id"] for r in db.rows[name]
                    ):
                        raise _fail("23505", "duplicate key value violates unique constraint uq_notifications_dedupe")
            return real()

        query.execute = execute
        return query

    # --- functions -------------------------------------------------------------------------------------------------
    def rpc(self, name, params):
        db = self

        class Call:
            def execute(self_inner):
                db.rpc_calls.append((name, params))
                if name == "publish_schedule_revision":
                    return SimpleNamespace(data=db._publish(params))
                if name == "claim_schedule_notifications":
                    return SimpleNamespace(data=db._claim(params))
                return RequestsDB.rpc(db, name, params).execute()

        return Call()

    def _claim(self, p):
        claimed = []
        for row in self.rows["schedule_notifications"]:
            due = row["status"] in ("queued", "failed") and row["attempts"] < 5 and _ts(row["next_attempt_at"]) <= datetime.now(timezone.utc)
            if due and (not p.get("p_revision_id") or row.get("revision_id") == p["p_revision_id"]) and len(claimed) < p["p_limit"]:
                row["status"] = "processing"
                row["attempts"] += 1
                claimed.append(dict(row))
        return claimed

    def _publish(self, p):
        self.publish_calls += 1
        if self.publish_gate:
            self.publish_gate()
        rev = next((r for r in self.rows["schedule_revisions"] if r["id"] == p["p_revision_id"] and r["tenant_id"] == p["p_tenant_id"]), None)
        if rev is None:
            raise _fail("SR003", "schedule revision not found")
        if rev["status"] == "published" and p["p_idempotency_key"] and rev.get("publication_key") == p["p_idempotency_key"]:
            return {**rev["result"], "replayed": True}
        if rev["status"] in ("discarded", "superseded"):
            raise _fail("SR004", f"revision is {rev['status']}")
        if rev["status"] != "draft":
            raise _fail("SR002", "revision is already published")
        if rev["version"] != p["p_expected_version"]:
            raise _fail("SR001", "revision was edited after it was reviewed")
        changes = [c for c in self.rows["schedule_revision_changes"] if c["revision_id"] == rev["id"]]
        if not changes:
            raise _fail("SR009", "nothing to publish")
        if any(c["department_id"] != rev["department_id"] for c in changes):
            raise _fail("SR010", "a change is outside this revision's department")
        rows = self.rows["shift_assignments"]
        by_id = {r["id"]: r for r in rows}
        for c in sorted((c for c in changes if c["kind"] in ("update", "cancel")), key=lambda c: str(c["assignment_id"])):
            a = by_id.get(c["assignment_id"])
            if a is None or a.get("publication_state") == "cancelled" or a.get("version", 1) != c["base_version"]:
                raise self._coded("SR005", "a shift changed after this draft was made", c)
            if a.get("clocked_in_at") or a.get("is_on_shift"):
                raise self._coded("SR006", "this shift already has attendance", c)
            if date.fromisoformat(str(a["work_date"])[:10]) < self.today:
                raise self._coded("SR007", "past shifts cannot be changed", c)
            if any(x["assignment_id"] == a["id"] and x["status"] in ("reported", "confirmed", "covered") for x in self.rows.get("absence_records", [])):
                raise self._coded("SR008", "this shift has a call-out in progress", c)
        snapshot = copy.deepcopy(rows)
        events, outcomes, counts = [], [], {"created": 0, "updated": 0, "cancelled": 0}
        try:
            for c in changes:
                if c["kind"] == "cancel":
                    a = by_id[c["assignment_id"]]
                    a.update(publication_state="cancelled", version=a["version"] + 1)
                    counts["cancelled"] += 1
                    events.append((a["user_id"], "cancelled", a["work_date"], a["id"]))
                    outcomes.append({"change_id": c["id"], "kind": "cancel", "assignment_id": a["id"], "version": a["version"]})
                elif c["kind"] == "update":
                    a = by_id[c["assignment_id"]]
                    pr = c["proposed"]
                    if (pr["user_id"], pr["work_date"], pr["starts_at"], pr["ends_at"]) != (a["user_id"], a["work_date"], a["starts_at"], a["ends_at"]):
                        a.update(publication_state="cancelled", version=a["version"] + 1)  # parked for the transaction
            for c in changes:
                if c["kind"] != "update":
                    continue
                a, pr = by_id[c["assignment_id"]], c["proposed"]
                old_user, old_date = a["user_id"], a["work_date"]
                moved = (pr["user_id"], pr["work_date"], pr["starts_at"], pr["ends_at"]) != (a["user_id"], a["work_date"], a["starts_at"], a["ends_at"])
                a.update({k: pr[k] for k in ("user_id", "shift_id", "work_date", "start_time", "end_time", "starts_at", "ends_at")},
                         shift_name=pr.get("shift_name", a.get("shift_name")), publication_state="published", version=a["version"] + (0 if not moved else 1))
                if "notes" in pr:
                    a["notes"] = pr["notes"]
                self._check_final(a, rows)
                counts["updated"] += 1
                if pr["user_id"] != old_user:
                    events += [(old_user, "removed", old_date, a["id"]), (pr["user_id"], "added", pr["work_date"], a["id"])]
                elif moved:
                    events.append((pr["user_id"], "changed", pr["work_date"], a["id"]))
                outcomes.append({"change_id": c["id"], "kind": "update", "assignment_id": a["id"], "version": a["version"]})
            for c in changes:
                if c["kind"] != "create":
                    continue
                pr = c["proposed"]
                if date.fromisoformat(pr["work_date"]) < self.today:
                    raise self._coded("SR007", "a new shift is dated in the past", c)
                new = {"id": self.next_id("shift_assignments"), "tenant_id": p["p_tenant_id"], **{k: pr[k] for k in (
                    "user_id", "shift_id", "work_date", "shift_name", "department_id", "start_time", "end_time", "starts_at", "ends_at")},
                    "publication_state": "published", "version": 1, "notes": pr.get("notes"), "snapshot_source": "occurrence"}
                rows.append(new)
                self._check_final(new, rows)
                counts["created"] += 1
                events.append((new["user_id"], "added", new["work_date"], new["id"]))
                outcomes.append({"change_id": c["id"], "kind": "create", "assignment_id": new["id"], "version": 1})
        except APIError:
            rows[:] = snapshot  # all or nothing
            raise
        people = {}
        for user, kind, day, assignment_id in events:
            slot = people.setdefault(user, {"added": 0, "changed": 0, "cancelled": 0, "removed": 0, "first_date": day, "ids": []})
            slot[kind] += 1
            slot["first_date"] = min(slot["first_date"], day)
            slot["ids"].append(assignment_id)
        queued = 0
        for user, slot in people.items():
            key = f"rev:{rev['id']}:user:{user}"
            if not any(n["dedupe_key"] == key and n["tenant_id"] == p["p_tenant_id"] for n in self.rows["schedule_notifications"]):
                self.rows["schedule_notifications"].append({
                    "id": self.next_id("schedule_notifications"), "tenant_id": p["p_tenant_id"], "user_id": user, "event_type": "schedule_published",
                    "dedupe_key": key, "revision_id": rev["id"], "status": "queued", "attempts": 0, "push_status": "not_attempted",
                    "next_attempt_at": datetime.now(timezone.utc).isoformat(),
                    "payload": {"revision_id": rev["id"], **{k: slot[k] for k in ("added", "changed", "cancelled", "removed")},
                                "first_date": slot["first_date"], "assignment_id": slot["ids"][0] if len(slot["ids"]) == 1 else None}})
                queued += 1
        result = {"publication_id": rev["id"], "revision_id": rev["id"], "published_at": datetime.now(timezone.utc).isoformat(), **counts,
                  "employees_affected": len(people), "notifications_queued": queued, "changes": outcomes, "replayed": False}
        rev.update(status="published", published_at=result["published_at"], published_by=p["p_actor"],
                   publication_key=p["p_idempotency_key"], result=result, version=rev["version"] + 1)
        if rev.get("corrects_revision_id"):
            for old in self.rows["schedule_revisions"]:
                if old["id"] == rev["corrects_revision_id"] and old["status"] == "published":
                    old["status"] = "superseded"
        for event, detail in (("publication_succeeded", counts), ("notification_queued", {"count": queued}) if queued else (None, None)):
            if event:
                self.rows["schedule_revision_events"].append({"id": self.next_id("e"), "tenant_id": p["p_tenant_id"], "revision_id": rev["id"],
                                                               "event": event, "actor_id": p["p_actor"], "detail": detail,
                                                               "created_at": datetime.now(timezone.utc).isoformat()})
        if rev.get("corrects_revision_id"):
            self.rows["schedule_revision_events"].append({"id": self.next_id("e"), "tenant_id": p["p_tenant_id"], "revision_id": rev["id"],
                                                           "event": "corrective_published", "actor_id": p["p_actor"],
                                                           "detail": {"corrects": rev["corrects_revision_id"]}, "created_at": datetime.now(timezone.utc).isoformat()})
        for kind, a_id in ((o["kind"], o["assignment_id"]) for o in outcomes):
            a = next(x for x in rows if x["id"] == a_id)
            self.rows["operational_audit_events"].append({
                "id": self.next_id("audit"), "tenant_id": p["p_tenant_id"], "resource_type": "shift_assignment", "resource_id": a_id,
                "action": {"cancel": "cancelled", "update": "updated", "create": "created"}[kind], "actor_id": p["p_actor"],
                "actor_role": p["p_actor_role"], "old_state": {}, "new_state": {"revision_id": rev["id"]}, "source": "api"})
        return result

    @staticmethod
    def _coded(code, message, change):
        return APIError({"message": message, "code": code, "hint": None, "details": change["id"]})

    def _check_final(self, row, rows):
        if row.get("publication_state") == "cancelled":
            return
        if self._on_approved_leave(row["user_id"], row["starts_at"], row["ends_at"]):
            raise _fail("TO001", "approved time off overlaps this shift")
        for other in rows:
            if other is row or other["user_id"] != row["user_id"] or other.get("publication_state") == "cancelled":
                continue
            if (other["shift_id"], other["work_date"]) == (row["shift_id"], row["work_date"]):
                raise _fail("23505", "duplicate key value violates unique constraint")
            if _ts(other["starts_at"]) < _ts(row["ends_at"]) and _ts(other["ends_at"]) > _ts(row["starts_at"]):
                raise _fail("23P01", "shift_assignments overlap for user")
