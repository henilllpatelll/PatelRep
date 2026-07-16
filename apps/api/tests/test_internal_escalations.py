"""Automated work-order escalations must use the audited transition RPC."""

from types import SimpleNamespace

from routers import internal as internal_router


class _UpdateQuery:
    def __init__(self, database):
        self.database = database
        self.payload = None

    def update(self, payload):
        self.payload = payload
        return self

    def eq(self, *_args):
        return self

    def execute(self):
        self.database.updates.append(self.payload)
        return SimpleNamespace(data=[])


class _EscalationDatabase:
    def __init__(self):
        self.rpc_calls: list[tuple[str, dict]] = []
        self.updates: list[dict] = []

    def rpc(self, function_name, payload):
        self.rpc_calls.append((function_name, payload))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[]))

    def table(self, _name):
        return _UpdateQuery(self)


def test_auto_escalation_uses_the_atomic_audit_transition(monkeypatch):
    database = _EscalationDatabase()
    monkeypatch.setattr(internal_router, "supabase", database)

    internal_router._auto_escalate_work_order("wo-1", "hotel-1")

    assert database.rpc_calls == [
        ("transition_work_order_with_audit", {
            "p_work_order_id": "wo-1",
            "p_tenant_id": "hotel-1",
            "p_new_status": "escalated",
            "p_actor_id": None,
            "p_actor_role": "automation",
            "p_reason_code": "sla_breach",
            "p_reason_note": "Automatically escalated after 150 minutes overdue.",
            "p_source": "automation",
            "p_is_override": False,
        })
    ]
    assert database.updates == [{"escalation_level": 3}]
