"""H5 HTTP surface: hidden (404) unless both agent process gates are on, role-gated, and no body can carry identity."""
from __future__ import annotations

import uuid

import jwt
import pytest
from fastapi.testclient import TestClient

import routers.agent_specialists as routes
from core.config import settings
from main import app
from services.agent_handoff.api import VIEWER_ROLES, specialists_enabled

RUN, HANDOFF = str(uuid.uuid4()), str(uuid.uuid4())
ENDPOINTS = [
    ("post", "/v1/agent-specialists/recommendations",
     {"intent": "housekeeping.room_readiness_review", "intent_version": 1, "resource_id": RUN,
      "idempotency_key": "key-12345678"}),
    ("get", f"/v1/agent-specialists/recommendations/{RUN}", None),
    ("post", f"/v1/agent-specialists/recommendations/{RUN}/dismiss", {}),
    ("post", f"/v1/agent-specialists/recommendations/{RUN}/proposals/1/submit", {"plan_digest": "a" * 64}),
    ("get", f"/v1/agent-specialists/handoffs/{HANDOFF}", None),
    ("post", f"/v1/agent-specialists/handoffs/{HANDOFF}/approve", {}),
    ("post", f"/v1/agent-specialists/handoffs/{HANDOFF}/reject", {}),
    ("post", f"/v1/agent-specialists/handoffs/{HANDOFF}/withdraw", None),
]


def _auth(role: str) -> dict:
    token = jwt.encode({"sub": str(uuid.uuid4()), "role": role, "hotel_id": str(uuid.uuid4()), "aud": "authenticated"},
                       settings.supabase_jwt_secret, algorithm="HS256")
    # A unique synthetic client address per request keeps these tests out of the app-wide rate-limit bucket that
    # later tests in the same process share (otherwise they would see 429 instead of 401/403).
    ip = ".".join(str(b) for b in uuid.uuid4().bytes[:4])
    return {"Authorization": f"Bearer {token}", "X-Forwarded-For": f"10.{ip.split('.', 1)[1]}"}


def _call(client, method, path, body, role):
    kwargs = {"headers": _auth(role)}
    if body is not None:
        kwargs["json"] = body
    return getattr(client, method)(path, **kwargs)


def test_router_role_literal_matches_the_intent_catalog():
    assert set(routes.SPECIALIST_VIEWER_ROLES) == VIEWER_ROLES == {"chief_engineer", "engineer", "gm",
                                                                   "housekeeping_supervisor"}


def test_gates_are_off_by_default_and_refused_in_production(monkeypatch):
    for name in ("AGENT_GATEWAY_EXECUTION_ENABLED", "AGENT_ORCHESTRATOR_EXECUTION_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    assert specialists_enabled("test") is False and specialists_enabled("staging") is False
    monkeypatch.setenv("AGENT_GATEWAY_EXECUTION_ENABLED", "true")
    monkeypatch.setenv("AGENT_ORCHESTRATOR_EXECUTION_ENABLED", "true")
    assert specialists_enabled("test") is True
    assert specialists_enabled("production") is False


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_every_route_is_hidden_while_the_gates_are_off(method, path, body):
    response = _call(TestClient(app), method, path, body, "gm")
    assert response.status_code == 404 and response.json()["detail"] == {"code": "not_found"}


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_roles_outside_the_specialists_are_refused(method, path, body):
    for role in ("housekeeper", "front_desk"):
        assert _call(TestClient(app), method, path, body, role).status_code == 403


def test_bodies_cannot_carry_identity_or_approval(monkeypatch):
    monkeypatch.setattr(routes, "specialists_enabled", lambda app_env: True)
    client = TestClient(app)
    body = dict(ENDPOINTS[0][2], hotel_id=str(uuid.uuid4()), role="gm")
    assert client.post("/v1/agent-specialists/recommendations", json=body, headers=_auth("gm")).status_code == 422
    forged = {"plan_digest": "a" * 64, "approved": True}
    assert client.post(f"/v1/agent-specialists/recommendations/{RUN}/proposals/1/submit", json=forged,
                       headers=_auth("gm")).status_code == 422
