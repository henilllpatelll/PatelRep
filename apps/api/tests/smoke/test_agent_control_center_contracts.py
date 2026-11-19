"""H6 Stage 3/5 static + route contracts for the AI Control Center (router, bridge package, migration 256).

Real-database behaviour (identity, tenancy, decisions, controls, journal) is proven in
tests/integration/test_agent_control_center.py."""
from __future__ import annotations

import ast
import re
import uuid
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient

import routers.agent_control_center as routes
from core.config import settings
from main import app
from services.agent_control_center import access, service
from services.agent_control_center.errors import ControlCenterRefused
from services.agent_control_center.store import ControlCenterStore

API_ROOT = Path(__file__).resolve().parents[2]
PACKAGE = API_ROOT / "services" / "agent_control_center"
M256 = (API_ROOT.parents[1] / "supabase" / "migrations" / "256_agent_control_center.sql").read_text(encoding="utf-8")
ACTIVATING_RPCS = ("agent_execution_enablement_set", "agent_model_enablement_set", "agent_tool_control_set",
                   "agent_model_budget_policy_set", "agent_runtime_control_set", "agent_customer_billing",
                   "agent_customer_pricing", "overage", "agent_tool_run_admit", "agent_planning_run_admit",
                   "agent_proposal_handoff_admit", "agent_worker_credential")


def _code_only(source: str) -> str:
    """Executable code without docstrings or comments (prose may NAME what the code must never call)."""
    tree = ast.parse(source)
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(body, list) and body and isinstance(body[0], ast.Expr) and isinstance(
                getattr(body[0], "value", None), ast.Constant) and isinstance(body[0].value.value, str):
            body.pop(0)
    return ast.unparse(tree)


def _sources() -> dict[str, str]:
    files = {p.name: _code_only(p.read_text(encoding="utf-8")) for p in PACKAGE.glob("*.py")}
    files["router"] = _code_only((API_ROOT / "routers" / "agent_control_center.py").read_text(encoding="utf-8"))
    return files


def test_no_control_center_code_can_enable_execution_paid_calls_billing_grants_or_autonomy():
    for name, source in _sources().items():
        for rpc in ACTIVATING_RPCS:
            assert rpc not in source, (name, rpc)
    store = (PACKAGE / "store.py").read_text(encoding="utf-8")
    assert store.count('"agent_tool_grant_set"') == 1 and '"p_revoke": True' in store and '"p_revoke": False' not in store
    # every write in the package is one of the reviewed restrictive controls or the H2 decision service
    writes = set(re.findall(r'_rpc\("([a-z_]+)"', store))
    assert writes == {"agent_control_center_overview", "agent_control_center_runs_page",
                      "agent_control_center_approvals_page", "agent_control_center_approval_facts",
                      "agent_control_center_grants", "agent_control_center_events_page",
                      "agent_control_center_hotel_pause_set", "agent_control_center_run_control",
                      "agent_control_center_record_refusal", "agent_run_get", "agent_run_events_page",
                      "agent_tool_events_page", "agent_tool_grant_set"}


def test_the_router_imports_only_the_bridge_and_its_role_literals_match_the_access_model():
    tree = ast.parse((API_ROOT / "routers" / "agent_control_center.py").read_text(encoding="utf-8"))
    modules = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    agent = {m for m in modules if m.startswith("services.")}
    assert agent and all(m.startswith("services.agent_control_center") for m in agent), agent
    assert set(routes.CONTROL_CENTER_ROLES) == access.VIEWER_ROLES
    assert set(routes.OVERVIEW_ROLES) == {r for r in access.VIEWER_ROLES if access.Viewer("u", "h", r).may("overview")}
    assert routes.GM_ROLES == ("gm",)
    assert {r for r in access.VIEWER_ROLES if access.Viewer("u", "h", r).may("controls")} == {"gm"}
    assert {r for r in access.VIEWER_ROLES if access.Viewer("u", "h", r).may("audit")} == {"gm"}


def test_package_files_stay_under_the_500_line_limit():
    for path in list(PACKAGE.glob("*.py")) + [API_ROOT / "routers" / "agent_control_center.py"]:
        assert len(path.read_text(encoding="utf-8").splitlines()) <= 500, path.name


def test_responses_never_carry_prompts_plans_detail_blobs_or_credentials():
    source = _code_only((PACKAGE / "service.py").read_text(encoding="utf-8")).replace("'", '"')
    for key in ('"detail"', '"plan"', '"prompt"', '"arguments_raw"', '"synthetic_spec"', '"result_meta"',
                '"idempotency_key"', '"request_digest"', "api_key", "secret"):
        assert key not in source, key
    catalog = _code_only((PACKAGE / "catalog.py").read_text(encoding="utf-8"))
    assert "intent_spec.description" not in catalog and "intent_spec" in catalog
    # the approval-facts read model exposes only reviewed argument keys
    facts = M256.split("FUNCTION public.agent_control_center_approval_facts")[1].split("$function$;")[0]
    assert "('assignee_user_id', 'expected_assigned_to', 'assignment_date', 'note')" in facts
    assert "guest_name" not in facts and "description" not in facts and "notes" not in facts


def test_256_journal_is_written_only_by_definer_triggers_and_the_refusal_recorder():
    assert "GRANT SELECT ON TABLE public.agent_control_center_events TO service_role;" in M256
    assert not re.search(r"GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*agent_control_center_events", M256)
    assert re.search(r"REVOKE ALL ON FUNCTION public\.agent__control_center_journal\([^)]*\) FROM PUBLIC, anon, "
                     r"authenticated, service_role, agent_worker;", M256)
    definers = re.findall(r"FUNCTION public\.([a-z_]+)\([^)]*\)\s*RETURNS[^$]*?SECURITY DEFINER", M256)
    assert set(definers) == {"agent__control_center_journal", "agent__journal_control_change",
                             "agent_control_center_record_refusal"}, definers
    hits = {m.group(0).upper().split()[0] for m in re.finditer(
        r"\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|FUNCTION|POLICY|INDEX)|TRUNCATE\b|DELETE\s+FROM\b)",
        "\n".join(ln for ln in M256.splitlines() if not ln.lstrip().startswith("--")), re.I)}
    assert hits == {"TRUNCATE"}, hits


# ---------------------------------------------------------------- capability logic (pure)
APPROVAL = {"state": "requested", "initiated_by_user_id": "u-init", "required_approver_roles": ["chief_engineer", "gm"],
            "expires_at": "2999-01-01T00:00:00+00:00"}


@pytest.mark.parametrize("user,role,gate,expected", [
    ("u-gm", "gm", True, {"approve": True, "reject": True, "withdraw": False, "reason": None}),
    ("u-gm", "gm", False, {"approve": False, "reject": True, "withdraw": False, "reason": "gateway_disabled"}),
    ("u-init", "chief_engineer", True, {"approve": False, "reject": False, "withdraw": True, "reason": "self_approval_forbidden"}),
    ("u-sup", "housekeeping_supervisor", True, {"approve": False, "reject": False, "withdraw": False, "reason": "approver_not_authorized"}),
])
def test_decision_capability_matches_what_the_database_would_allow(user, role, gate, expected):
    viewer = access.Viewer(user, "h", role)
    assert service._capability(viewer, APPROVAL, approve_gate_open=gate, now=service.utcnow()) == expected
    expired = {**APPROVAL, "expires_at": "2000-01-01T00:00:00+00:00"}
    assert service._capability(viewer, expired, approve_gate_open=gate, now=service.utcnow())["reason"] == "approval_expired"


def test_cursors_reason_codes_and_ids_are_strictly_validated():
    assert service.parse_cursor(None) == (None, None)
    assert service.parse_cursor(f"2026-11-17T10:00:00+00:00|{uuid.uuid4()}")[0] == "2026-11-17T10:00:00+00:00"
    for bad in ("x", "2026-11-17|abc", "'; drop table x; --|" + str(uuid.uuid4())):
        with pytest.raises(ControlCenterRefused):
            service.parse_cursor(bad)
    for bad in ("Bad Code", "x" * 80, "drop;"):
        with pytest.raises(ControlCenterRefused):
            service.reason_or_422(bad)
    with pytest.raises(ControlCenterRefused):
        service.uuid_or_404("../other-hotel")
    assert service.page_limit(10_000) == service.PAGE_MAX


def test_a_missing_or_partial_schema_fails_closed_with_a_stable_code():
    class Missing:
        code = "PGRST202"

    class Client:
        def rpc(self, *_):
            return self

        def execute(self):
            raise type("APIError", (Exception,), {"code": "PGRST202"})()

    with pytest.raises(ControlCenterRefused) as err:
        ControlCenterStore(Client()).overview("h")
    assert err.value.code == "schema_unavailable"


# ---------------------------------------------------------------- HTTP surface
def _auth(role: str) -> dict:
    token = jwt.encode({"sub": str(uuid.uuid4()), "role": role, "hotel_id": str(uuid.uuid4()), "aud": "authenticated"},
                       settings.supabase_jwt_secret, algorithm="HS256")
    ip = ".".join(str(b) for b in uuid.uuid4().bytes[:3])
    return {"Authorization": f"Bearer {token}", "X-Forwarded-For": f"10.{ip}"}


ROUTES = [("get", "/v1/agent-control-center/session"), ("get", "/v1/agent-control-center/agents"),
          ("get", "/v1/agent-control-center/runs"), ("get", f"/v1/agent-control-center/approvals/{uuid.uuid4()}"),
          ("post", f"/v1/agent-control-center/approvals/{uuid.uuid4()}/approve")]


@pytest.mark.parametrize("method,path", ROUTES)
def test_every_route_is_hidden_while_the_hotel_flag_is_off(monkeypatch, method, path):
    monkeypatch.setattr(routes, "is_feature_enabled", lambda *_: False)
    called = []
    monkeypatch.setattr(routes, "revalidate", lambda *a, **k: called.append(1))
    client = TestClient(app)
    kwargs = {"headers": _auth("gm")} | ({"json": {}} if method == "post" else {})
    res = getattr(client, method)(path, **kwargs)
    assert res.status_code == 404 and res.json()["detail"] == {"code": "not_found"} and called == []


def test_roles_outside_the_control_center_are_refused_before_any_lookup(monkeypatch):
    monkeypatch.setattr(routes, "is_feature_enabled", lambda *_: True)
    client = TestClient(app)
    for role in ("housekeeper", "front_desk"):
        assert client.get("/v1/agent-control-center/session", headers=_auth(role)).status_code == 403
    for path in ("/v1/agent-control-center/controls", "/v1/agent-control-center/audit"):
        assert client.get(path, headers=_auth("chief_engineer")).status_code == 403
    assert client.post("/v1/agent-control-center/controls/hotel-pause", json={"paused": True, "reason_code": "x"},
                       headers=_auth("engineer")).status_code == 403


def test_a_stale_identity_is_refused_and_recorded(monkeypatch):
    monkeypatch.setattr(routes, "is_feature_enabled", lambda *_: True)

    def stale(*_a, **_k):
        raise ControlCenterRefused("stale_role")

    recorded = []
    monkeypatch.setattr(routes, "revalidate", stale)
    monkeypatch.setattr(routes.service, "record_refusal", lambda *a, **k: recorded.append(k["code"]))
    res = TestClient(app).get("/v1/agent-control-center/session", headers=_auth("gm"))
    assert res.status_code == 403 and res.json()["detail"] == {"code": "stale_role"} and recorded == ["stale_role"]


def test_request_bodies_reject_unknown_fields_and_identity_claims(monkeypatch):
    monkeypatch.setattr(routes, "is_feature_enabled", lambda *_: True)
    client = TestClient(app)
    for body in ({"reason_code": "ok", "user_id": str(uuid.uuid4())}, {"reason_code": "ok", "hotel_id": "x"},
                 {"reason_code": "ok", "role": "gm"}, {"reason_code": "Not Valid"}):
        res = client.post(f"/v1/agent-control-center/approvals/{uuid.uuid4()}/approve", json=body, headers=_auth("gm"))
        assert res.status_code == 422, body
    res = client.post("/v1/agent-control-center/controls/hotel-pause", json={"paused": "yes", "reason_code": "x"},
                      headers=_auth("gm"))
    assert res.status_code == 422
