"""H4 customer-facing billing API: GM-only, server-derived identity, strict validation, safe errors, server-side money."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.auth import CurrentUser, get_current_user
from routers import billing as billing_router
from tests.smoke.fake_supabase import FakeDB

TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
ME = "11111111-1111-4111-8111-111111111111"
POLICY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

SUMMARY = {
    "customer_billing_mode": "enforced",
    "policy": {"id": POLICY, "version": 2, "included_credits": "5000.0000", "usd_per_credit": "0.020000",
               "hard_cap_usd": "50.00", "terms_version": "h4-terms-1"},
    "authorization": {"id": "x", "version": 3, "state": "authorized", "authorized_limit_credits": "1000.0000",
                      "max_exposure_usd": "20.00", "pricing_policy_id": POLICY, "terms_version": "h4-terms-1",
                      "created_at": "2026-11-15T10:00:00+00:00", "current_policy": True},
    "ledger": {"period_start": "2026-11-01", "period_end": "2026-11-30", "is_finalized": False,
               "credits_included": "5000", "credits_used": "5250.5000", "agent_credits_used": "300.2500",
               "overage_credits": "250.5000", "overage_cost_cents": "501.0000", "agent_overage_credits": "200.0000",
               "agent_overage_usd": "4.005000", "agent_held_credits": "1.5000", "agent_held_overage_credits": "1.0000"},
    "pending_reconciliation_credits": "0.7500",
}


class FakeStore:
    def __init__(self, summary=None, result=None, history=None, fail=False):
        self.calls = []
        self._summary, self._result, self._history, self._fail = summary, result, history or [], fail

    def _call(self, name, kw, value):
        self.calls.append((name, kw))
        if self._fail:
            raise RuntimeError("db down: postgres://secret@host")
        return value

    def summary(self, **kw):
        return self._call("summary", kw, self._summary)

    def history(self, **kw):
        return self._call("history", kw, self._history)

    def authorize_overage(self, **kw):
        return self._call("authorize", kw, self._result)

    def revoke_overage(self, **kw):
        return self._call("revoke", kw, self._result)


def client(monkeypatch, store, role="gm"):
    db = FakeDB({"subscriptions": [{"tenant_id": TENANT, "cap_cents": 60000, "base_fee_cents": 9900}],
                 "credit_ledger": [{"tenant_id": TENANT, "period_start": "2026-11-01", "period_end": "2099-11-30"}]})
    monkeypatch.setattr(billing_router, "supabase", db)
    monkeypatch.setattr(billing_router, "_billing_store", lambda: store)
    import middleware.credits as credits
    monkeypatch.setattr(credits, "supabase", db)
    app = FastAPI()
    app.include_router(billing_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=ME, hotel_id=TENANT, role=role,
                                                                     email="gm@example.com")
    return TestClient(app)


GOOD = {"limit_credits": 1000, "policy_id": POLICY, "terms_version": "h4-terms-1",
        "acknowledged_max_exposure_usd": "20.00", "confirm": True}


@pytest.mark.parametrize("role", ["housekeeper", "engineer", "housekeeping_supervisor", "chief_engineer", "front_desk"])
@pytest.mark.parametrize("method,path,body", [("get", "/billing/ai-usage", None), ("get", "/billing/history", None),
                                              ("post", "/billing/overage/authorize", GOOD),
                                              ("post", "/billing/overage/revoke", {"confirm": True})])
def test_every_h4_route_is_gm_only(monkeypatch, role, method, path, body):
    store = FakeStore(summary=SUMMARY, result={"ok": True})
    c = client(monkeypatch, store, role=role)
    response = c.get(path) if method == "get" else c.post(path, json=body)
    assert response.status_code == 403
    assert store.calls == []


def test_authorize_uses_the_verified_hotel_and_user_never_the_body(monkeypatch):
    store = FakeStore(result={"ok": True, "version": 4, "authorized_limit_credits": "1000.0000",
                              "max_exposure_usd": "20.00", "created_at": "2026-11-15T11:00:00+00:00"})
    response = client(monkeypatch, store).post("/billing/overage/authorize", json=GOOD)
    assert response.status_code == 200
    assert response.json()["data"] == {"state": "on", "version": 4, "authorized_limit_credits": "1000.0000",
                                       "max_exposure_usd": "20.00", "recorded_at": "2026-11-15T11:00:00+00:00"}
    (name, kw), = store.calls
    assert name == "authorize" and kw["tenant_id"] == TENANT and kw["user_id"] == ME
    assert str(kw["limit_credits"]) == "1000" and str(kw["expected_max_exposure_usd"]) == "20.00"


@pytest.mark.parametrize("patch", [
    {"hotel_id": OTHER}, {"tenant_id": OTHER}, {"user_id": ME},       # no identity from the body, ever
    {"confirm": False}, {"confirm": None},                              # affirmative acceptance only
    {"limit_credits": 0}, {"limit_credits": -5}, {"limit_credits": 1.5}, {"limit_credits": "100"},
    {"limit_credits": 10_000_001},
    {"acknowledged_max_exposure_usd": 20.0}, {"acknowledged_max_exposure_usd": "20.001"},
    {"acknowledged_max_exposure_usd": "-1"}, {"policy_id": "not-a-uuid"}, {"terms_version": "Bad Terms!"},
])
def test_authorize_request_validation_is_strict(monkeypatch, patch):
    store = FakeStore(result={"ok": True})
    body = {**GOOD, **patch}
    response = client(monkeypatch, store).post("/billing/overage/authorize", json=body)
    assert response.status_code == 422
    assert store.calls == []


def test_authorize_without_confirm_field_is_rejected(monkeypatch):
    store = FakeStore(result={"ok": True})
    body = {k: v for k, v in GOOD.items() if k != "confirm"}
    assert client(monkeypatch, store).post("/billing/overage/authorize", json=body).status_code == 422


@pytest.mark.parametrize("reason,status", [("not_authorized", 403), ("pricing_policy_missing", 409),
                                           ("terms_changed", 409), ("exposure_not_acknowledged", 409),
                                           ("exceeds_hard_cap", 422), ("invalid_limit", 422),
                                           ("something_new", 409)])
def test_database_refusals_map_to_safe_errors(monkeypatch, reason, status):
    store = FakeStore(result={"ok": False, "reason": reason})
    response = client(monkeypatch, store).post("/billing/overage/authorize", json=GOOD)
    assert response.status_code == status
    assert reason not in response.text  # internal reason codes never reach the client


def test_failures_are_closed_and_leak_nothing(monkeypatch):
    store = FakeStore(fail=True)
    c = client(monkeypatch, store)
    for response in (c.get("/billing/ai-usage"), c.get("/billing/history"),
                     c.post("/billing/overage/authorize", json=GOOD),
                     c.post("/billing/overage/revoke", json={"confirm": True})):
        assert response.status_code == 503
        assert "postgres" not in response.text and "secret" not in response.text


def test_revoke_requires_confirmation_and_is_idempotent(monkeypatch):
    store = FakeStore(result={"ok": True, "already_off": True})
    c = client(monkeypatch, store)
    assert c.post("/billing/overage/revoke", json={}).status_code == 422
    assert c.post("/billing/overage/revoke", json={"confirm": True, "hotel_id": OTHER}).status_code == 422
    response = c.post("/billing/overage/revoke", json={"confirm": True})
    assert response.status_code == 200 and response.json()["data"]["state"] == "off"
    assert store.calls[-1][1] == {"tenant_id": TENANT, "user_id": ME}


def test_ai_usage_breakdown_is_computed_server_side_and_pending_is_not_a_charge(monkeypatch):
    store = FakeStore(summary=SUMMARY)
    data = client(monkeypatch, store).get("/billing/ai-usage").json()["data"]
    assert store.calls[0][1] == {"tenant_id": TENANT}
    assert data["included_credits"] == "5000"
    assert data["legacy_credits_used"] == "4950.2500" and data["agent_credits_used"] == "300.2500"
    assert data["remaining_credits"] == "0"
    assert data["pending_reconciliation_credits"] == "0.7500"
    assert data["overage"]["state"] == "on" and data["overage"]["enabled"] is True
    assert data["overage"]["accrued_usd"] == "4.01"                 # 4.005 rounded half-up for display
    assert data["overage"]["remaining_credits"] == "799.0000"      # 1000 - 200 accrued - 1 held
    est = data["estimate"]
    assert est["is_estimate"] is True
    # legacy = 501 cents total overage - 400 cents of agent overage (billed by H4) = 101; agent = 400.5 -> 401
    assert est["legacy_overage_cents"] == 101 and est["agent_overage_cents"] == 401
    assert est["total_cents"] == 9900 + 101 + 401
    assert "stripe_customer_id" not in str(data) and "cus_" not in str(data)


def test_overage_defaults_off_and_stale_consent_needs_reconfirmation(monkeypatch):
    off = {**SUMMARY, "authorization": None}
    data = client(monkeypatch, FakeStore(summary=off)).get("/billing/ai-usage").json()["data"]
    assert data["overage"]["state"] == "off" and data["overage"]["enabled"] is False
    assert data["overage"]["authorized_limit_credits"] is None and data["overage"]["max_exposure_usd"] is None
    stale = {**SUMMARY, "authorization": {**SUMMARY["authorization"], "current_policy": False}}
    data = client(monkeypatch, FakeStore(summary=stale)).get("/billing/ai-usage").json()["data"]
    assert data["overage"]["state"] == "needs_reconfirmation" and data["overage"]["enabled"] is False


def test_history_links_only_real_invoices_and_never_labels_pending_as_paid(monkeypatch):
    history = [{"period_start": "2026-10-01", "period_end": "2026-10-31", "is_finalized": True,
                "credits_included": "5000", "credits_used": "5100", "agent_credits_used": "100",
                "agent_overage_credits": "50", "agent_overage_usd": "1.000000", "adjustment_credits": "0",
                "late_charge_credits": "0", "pending_reconciliation_credits": "0",
                "operations": [
                    {"id": "o1", "state": "item_created", "amount_cents": 100, "overage_credits": "50",
                     "hosted_invoice_url": "https://invoice.stripe.com/i/test_x", "has_invoice": False},
                    {"id": "o2", "state": "paid", "amount_cents": 100, "overage_credits": "50",
                     "hosted_invoice_url": "https://invoice.stripe.com/i/test_y", "has_invoice": True},
                    {"id": "o3", "state": "ambiguous", "amount_cents": 100, "overage_credits": "50",
                     "hosted_invoice_url": None, "has_invoice": False}]}]
    data = client(monkeypatch, FakeStore(history=history)).get("/billing/history").json()["data"]
    actions = data[0]["billing_actions"]
    assert [a["status"] for a in actions] == ["pending_invoice", "paid", "pending"]
    assert actions[0]["invoice_url"] is None and actions[2]["invoice_url"] is None
    assert actions[1]["invoice_url"] == "https://invoice.stripe.com/i/test_y"
    assert data[0]["agent_overage_cents"] == 100 and data[0]["legacy_credits_used"] == "5000"
