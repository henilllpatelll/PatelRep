"""A FakeDB that also answers the two Engineering PM database functions (migration 232).

This is a Python MODEL of record_pm_completion() and decide_pm_deferral(), used to test how the API maps their answers
(statuses, replays, conflicts, HTTP codes). It is not evidence that the SQL is right: the SQL itself is exercised
against a real, disposable Postgres by tests/sql/test_pm_foundation_sql.py (skipped unless one is provided).
"""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

from dateutil.relativedelta import relativedelta

from tests.smoke.fake_supabase import FakeDB, FakeQuery

_DELTAS = {
    "daily": relativedelta(days=1), "weekly": relativedelta(weeks=1), "monthly": relativedelta(months=1),
    "quarterly": relativedelta(months=3), "annual": relativedelta(years=1),
}


def compute_next_due_at(base: datetime, interval_type: str, interval_days: int | None) -> datetime:
    """Same arithmetic as services.pm_schedules.compute_next_due_at (and public.pm_next_due_at), import-free."""
    if interval_type == "custom":
        return base + relativedelta(days=interval_days or 1)
    return base + _DELTAS.get(interval_type, relativedelta(days=1))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: Any) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


_COLUMN_DEFAULTS = {"assets": {"is_active": True, "row_version": 1}, "pm_schedules": {"is_active": True, "recurrence_basis": "scheduled_date"}}


class _DefaultingQuery(FakeQuery):
    """Applies the column defaults the real tables have, so a row created through the API reads like one from Postgres."""

    def insert(self, payload):
        defaults = _COLUMN_DEFAULTS.get(self.table_name, {})
        if isinstance(payload, list):
            return super().insert([{**defaults, **row} for row in payload])
        return super().insert({**defaults, **payload})


class _Rpc:
    def __init__(self, fn, params):
        self._fn, self._params = fn, params

    def execute(self):
        return SimpleNamespace(data=self._fn(**self._params))


class PmFakeDB(FakeDB):
    def __init__(self, rows=None, unique_indexes=None):
        super().__init__(rows, unique_indexes)
        self.rpc_calls: list[tuple[str, dict]] = []
        # One lock stands in for the pm_schedules row lock that serialises completions and decisions.
        self.schedule_lock = threading.RLock()

    def table(self, name):
        return _DefaultingQuery(self, name)

    def next_id(self, table_name):
        return str(uuid.uuid4())  # real primary keys are UUIDs, and routers validate that shape

    def rpc(self, name: str, params: dict):
        self.rpc_calls.append((name, params))
        fns = {"record_pm_completion": self._record_pm_completion, "decide_pm_deferral": self._decide_pm_deferral}
        if name not in fns:
            raise Exception({"code": "PGRST202", "message": f"Could not find the function public.{name}"})
        return _Rpc(fns[name], params)

    def _table(self, name: str) -> list[dict]:
        return self.rows.setdefault(name, [])

    def _insert(self, table: str, row: dict) -> dict:
        row = {"id": self.next_id(table), **row}
        self._table(table).append(row)
        return row

    # -- record_pm_completion ------------------------------------------------
    def _record_pm_completion(self, *, p_tenant_id, p_schedule_id, p_user_id, p_actor_role, p_completion_id,
                              p_submission_id, p_submission_hash, p_completion, p_items, p_corrective,
                              p_evidence_ids, p_completed_at):
        with self.schedule_lock:
            schedule = next((r for r in self._table("pm_schedules") if r["id"] == p_schedule_id and r["tenant_id"] == p_tenant_id), None)
            if not schedule:
                return {"status": "schedule_not_found"}
            if p_submission_id:
                existing = next((r for r in self._table("pm_completion_records")
                                 if r["tenant_id"] == p_tenant_id and r.get("submission_id") == p_submission_id), None)
                if existing:
                    if existing["pm_schedule_id"] == p_schedule_id and existing.get("submission_hash") == p_submission_hash:
                        wos = [{"id": w["id"], "title": w["title"]} for w in self._table("work_orders")
                               if w["tenant_id"] == p_tenant_id and w.get("pm_completion_id") == existing["id"] and w.get("is_pm_generated")]
                        return {"status": "replayed", "completion": dict(existing), "corrective_work_orders": wos}
                    return {"status": "conflict"}
            if not schedule.get("is_active", True):
                return {"status": "schedule_inactive"}
            asset = next((r for r in self._table("assets") if r["id"] == schedule.get("asset_id") and r["tenant_id"] == p_tenant_id), None)
            if not asset or not asset.get("is_active", True):
                return {"status": "asset_inactive"}

            completion = {
                "id": p_completion_id, "tenant_id": p_tenant_id, "pm_schedule_id": p_schedule_id, "asset_id": schedule.get("asset_id"),
                "checklist_template_id": p_completion.get("checklist_template_id"),
                "checklist_version": p_completion.get("checklist_version"),
                "technician_id": p_user_id, "verifier_id": p_completion.get("verifier_id"),
                "labor_minutes": p_completion.get("labor_minutes") or 0, "notes": p_completion.get("notes"),
                "photos": p_completion.get("photos") or [], "certificate_attachments": p_completion.get("certificate_attachments") or [],
                "completed_at": p_completed_at, "submission_id": p_submission_id, "submission_hash": p_submission_hash,
            }
            self._table("pm_completion_records").append(completion)
            for item in p_items or []:
                self._insert("pm_completion_items", {"tenant_id": p_tenant_id, "completion_id": p_completion_id, **item})
            for evidence in self._table("evidence_records"):
                if evidence["tenant_id"] == p_tenant_id and evidence["id"] in (p_evidence_ids or []):
                    evidence["related_entity_type"] = "pm_completion"
                    evidence["related_entity_id"] = p_completion_id
            wos = []
            for item in p_corrective or []:
                duplicate = next((w for w in self._table("work_orders") if w["tenant_id"] == p_tenant_id
                                  and w.get("pm_completion_id") == p_completion_id and w["title"] == item["title"]), None)
                work_order_id = None
                if not duplicate:
                    work_order = self._insert("work_orders", {
                        "tenant_id": p_tenant_id, "asset_id": item.get("asset_id"), "title": item["title"],
                        "description": item.get("description"), "category": item.get("category"), "priority": item.get("priority"),
                        "created_by": item.get("created_by"), "is_pm_generated": True, "pm_completion_id": p_completion_id,
                        "sla_minutes": item.get("sla_minutes"), "due_at": item.get("due_at"),
                    })
                    work_order_id = work_order["id"]
                    wos.append({"id": work_order_id, "title": item["title"]})
                self._insert("operational_audit_events", {
                    "tenant_id": p_tenant_id, "resource_type": "pm_completion", "resource_id": p_completion_id,
                    "action": "pm_check.failed_containment", "actor_id": p_user_id, "actor_role": p_actor_role,
                    "new_state": {"item": item["label"], "work_order_id": work_order_id}, "reason_code": "failed_check",
                })
            completed_at = _parse(p_completed_at)
            base = completed_at if schedule.get("recurrence_basis") == "completion_date" else _parse(schedule["next_due_at"])
            next_due = compute_next_due_at(base, schedule.get("interval_type", "monthly"), schedule.get("interval_days"))
            schedule["last_completed_at"] = completed_at.isoformat()
            schedule["next_due_at"] = next_due.isoformat()
            return {"status": "created", "completion": dict(completion), "corrective_work_orders": wos, "next_due_at": next_due.isoformat()}

    # -- decide_pm_deferral --------------------------------------------------
    def _decide_pm_deferral(self, *, p_tenant_id, p_deferral_id, p_reviewer_id, p_reviewer_role, p_decision, p_note):
        if p_decision not in ("approved", "rejected"):
            return {"status": "invalid_decision"}
        deferral = next((r for r in self._table("pm_deferrals") if r["id"] == p_deferral_id and r["tenant_id"] == p_tenant_id), None)
        if not deferral:
            return {"status": "not_found"}
        with self.schedule_lock:
            schedule = next(r for r in self._table("pm_schedules") if r["id"] == deferral["pm_schedule_id"])
            prior = next((r for r in self._table("pm_deferral_decisions") if r["deferral_id"] == p_deferral_id), None)
            if prior:
                return {"status": "already_decided", "decision": dict(prior)}
            if deferral.get("approved_by"):
                return {"status": "already_decided", "legacy": True}
            if deferral["requested_by"] == p_reviewer_id:
                return {"status": "self_review"}
            previous, applied = schedule["next_due_at"], None
            if p_decision == "approved":
                if not schedule.get("is_active", True):
                    return {"status": "schedule_inactive"}
                if _parse(deferral["deferred_until"]) <= _now():
                    return {"status": "expired"}
                if _parse(deferral["deferred_until"]) <= _parse(schedule["next_due_at"]):
                    return {"status": "stale"}
                schedule["next_due_at"] = deferral["deferred_until"]
                applied = deferral["deferred_until"]
            decision = self._insert("pm_deferral_decisions", {
                "tenant_id": p_tenant_id, "deferral_id": p_deferral_id, "decision": p_decision, "decided_by": p_reviewer_id,
                "decided_by_role": p_reviewer_role, "note": p_note, "previous_due_at": previous, "applied_due_at": applied,
            })
            self._insert("operational_audit_events", {
                "tenant_id": p_tenant_id, "resource_type": "pm_deferral", "resource_id": p_deferral_id,
                "action": f"pm_deferral.{p_decision}", "actor_id": p_reviewer_id, "actor_role": p_reviewer_role,
                "old_state": {"next_due_at": previous, "requested_by": deferral["requested_by"]},
                "new_state": {"decision": p_decision, "next_due_at": applied or previous}, "reason_code": "pm_deferral", "reason_note": p_note,
            })
            return {"status": "ok", "decision": dict(decision)}
