"""H7 P2 static contracts: migration 262's reviewed shape and the human-token forwarding client (no database).

The real-database proofs live in tests/integration/test_agent_h7_*.py; these pin what must never drift silently.
"""
from __future__ import annotations

import base64
import json
import logging
import pickle
import re
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from services.agent_control_center import verified_identity as vi

ROOT = Path(__file__).resolve().parents[4]
M262 = (ROOT / "supabase" / "migrations" / "262_agent_verified_human_identity.sql").read_text(encoding="utf-8")
M243 = (ROOT / "supabase" / "migrations" / "243_agent_gateway_rpcs.sql").read_text(encoding="utf-8")
TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl"
NEW_FUNCTIONS = ("agent__verified_human_claims", "agent__verified_human", "agent_verified_human_probe",
                 "agent_tool_approval_decide_v2", "agent__audit_approval_transition")


def _code(sql: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def _function(name: str) -> str:
    match = re.search(r"CREATE (?:OR REPLACE )?FUNCTION public\." + re.escape(name) + r"\(.*?\n\$function\$;", M262, re.S)
    assert match, name
    return match.group(0)


def _jwt(role: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{payload}.sig"


# ---------------------------------------------------------------- migration 262
def test_262_is_forward_only_and_non_destructive():
    from_guard = re.compile(r"\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|FUNCTION|POLICY|INDEX)|TRUNCATE\b|DELETE\s+FROM\b"
                            r"|ALTER\s+(?:TABLE|TYPE)\b[^;]*\b(?:DROP|RENAME|TYPE)\b)", re.I)
    assert not from_guard.search(M262)
    # Top-level statements only (function bodies run later, under their own guards).
    top_level = re.sub(r"\$function\$.*?\$function\$", "", _code(M262), flags=re.S)
    assert not re.search(r"\b(ALTER TABLE|CREATE TABLE|CREATE POLICY|DROP TRIGGER|UPDATE public\.|INSERT INTO)\b",
                         top_level), "262 must not change tables, policies or rows"


def test_every_new_function_is_definer_with_an_empty_search_path_and_revoked_from_everyone():
    for name in NEW_FUNCTIONS:
        body = _function(name)
        assert body.startswith(f"CREATE FUNCTION public.{name}(")  # never adopts an existing object
        assert "SECURITY DEFINER SET search_path = ''" in body, name
        assert re.search(rf"REVOKE ALL ON FUNCTION public\.{name}\([^)]*\) FROM PUBLIC, anon, authenticated, "
                         r"service_role, agent_worker;", M262), name
    grants = re.findall(r"^GRANT EXECUTE ON FUNCTION public\.([a-z_0-9]+)\(", M262, re.M)
    assert sorted(grants) == ["agent_control_center_events_page", "agent_verified_human_probe"]
    assert "GRANT EXECUTE ON FUNCTION public.agent_verified_human_probe(text) TO authenticated;" in M262
    assert "GRANT EXECUTE ON FUNCTION public.agent_control_center_events_page(uuid, bigint, integer, text[]) TO service_role;" in M262


def test_the_v2_decision_is_inactive_and_takes_no_actor_or_hotel_argument():
    assert not re.search(r"GRANT[^;]*agent_tool_approval_decide_v2", M262)
    signature = re.search(r"FUNCTION public\.agent_tool_approval_decide_v2\(([^)]*)\)", M262).group(1)
    assert "actor" not in signature and "tenant" not in signature and "user" not in signature and "role" not in signature
    probe_sig = re.search(r"FUNCTION public\.agent_verified_human_probe\(([^)]*)\)", M262).group(1)
    assert probe_sig == "p_operation text"


def test_identity_comes_from_the_verified_token_and_a_live_session_only():
    claims = _code(_function("agent__verified_human_claims"))
    assert "current_setting('role', true) IS DISTINCT FROM 'authenticated'" in claims
    assert "session_user <> 'authenticator'" in claims
    assert "auth.uid() IS DISTINCT FROM v_uid" in claims
    assert "FROM auth.sessions s" in claims and "s.user_id = v_uid" in claims and "s.not_after" in claims
    assert "FOR SHARE" not in claims and "FOR UPDATE" not in claims  # Auth rows are read, never locked
    assert "user_metadata" not in claims  # user-editable metadata is never consulted
    who = _code(_function("agent__verified_human"))
    assert "public.agent__human_authority(v_tenant, v_uid, p_roles)" in who
    assert "FROM public.user_profiles p WHERE p.id = v_uid" in who


def test_the_v2_decision_keeps_the_243_rules():
    v2 = _code(_function("agent_tool_approval_decide_v2"))
    v1 = re.search(r"CREATE OR REPLACE FUNCTION public\.agent_tool_approval_decide\(.*?\n\$function\$;", M243, re.S).group(0)
    for rule in ("FOR UPDATE", "v_appr.state <> 'requested'", "v_appr.expires_at <= now()",
                 "NOT v_appr.approver_may_be_initiator", "'self_approval_forbidden'", "public.agent__dispatch(v_run.id, 0)",
                 "public.agent__finish_run(v_run.id, 'failed', 'authorization_denied', 'approval_rejected', false)"):
        assert rule in v2, rule
        assert rule.replace("v_uid", "p_actor_user_id") in _code(v1) or rule in _code(v1), rule
    assert "agent__verified_human(v_appr.required_approver_roles)" in v2
    for gate in ("'ai_control_center'", "agent_deployment_identity", "'production_refused'", "agent_execution_enablement"):
        assert gate in v2, gate


def test_the_credential_read_model_isolates_by_the_bound_hotel_and_drops_the_label():
    page = _code(_function("agent_control_center_events_page"))
    assert "SECURITY INVOKER" in page and "agent_worker_credential_scopes" in page and "s.tenant_id = p_tenant_id" in page
    assert "'label'" not in page and "'app_env', e.detail->'app_env'" in page


def test_the_audit_trigger_is_deferred_and_never_attributes_a_human():
    assert re.search(r"CREATE CONSTRAINT TRIGGER agent_tool_approvals_transition_audit\s+AFTER UPDATE ON "
                     r"public\.agent_tool_approvals DEFERRABLE INITIALLY DEFERRED", M262)
    body = _code(_function("agent__audit_approval_transition"))
    assert "'operator'" in body and "'human'" not in body and "'unverified'" in body


def test_262_does_not_redefine_any_legacy_decision_grant_or_journal_function():
    for name in ("agent_tool_approval_decide", "agent_tool_approval_revoke", "agent_tool_grant_set",
                 "agent__journal_control_change", "agent__guard_control_update", "agent__human_authority",
                 "agent_audit_privilege_violations", "agent_audit_privileges_enforce"):
        assert not re.search(rf"CREATE (OR REPLACE )?FUNCTION public\.{name}\(", M262), name


# ---------------------------------------------------------------- the forwarding client
def _settings(**kw) -> vi.VerifiedIdentitySettings:
    base = {"enabled": True, "url": "https://example.supabase.co", "public_api_key": SecretStr(_jwt("anon"))}
    base.update(kw)
    return vi.VerifiedIdentitySettings(**base)


def test_the_token_never_prints_pickles_or_logs(caplog):
    token = vi.HumanAccessToken(TOKEN)
    assert TOKEN not in repr(token) and TOKEN not in str(token) and TOKEN not in f"{token}"
    with pytest.raises(TypeError):
        pickle.dumps(token)
    with caplog.at_level(logging.DEBUG):
        logging.getLogger("x").info("token=%s", token)
    assert TOKEN not in caplog.text


@pytest.mark.parametrize("value", ["", "a.b", "a b.c.d", "x" * 9000, None])
def test_malformed_tokens_are_refused(value):
    with pytest.raises(vi.VerifiedIdentityError):
        vi.HumanAccessToken(value)  # type: ignore[arg-type]


def test_disabled_by_default_and_no_route_mounts_it():
    assert vi.VerifiedIdentitySettings().enabled is False
    with pytest.raises(vi.VerifiedIdentityError) as err:
        vi.probe(vi.VerifiedIdentitySettings(), vi.HumanAccessToken(TOKEN), "control_center_gm")
    assert err.value.code == "verified_identity_disabled"
    api = ROOT / "apps" / "api"
    users = [p for p in api.rglob("*.py") if "verified_identity" in p.read_text(encoding="utf-8", errors="ignore")
             and ".venv" not in p.parts and "tests" not in p.parts]
    assert {p.name for p in users} == {"verified_identity.py"}


@pytest.mark.parametrize("key", [_jwt("service_role"), "sb_secret_abc", _jwt("authenticated"), ""])
def test_a_privileged_or_missing_api_key_is_refused(key):
    with pytest.raises(vi.VerifiedIdentityError):
        vi.probe(_settings(public_api_key=SecretStr(key)), vi.HumanAccessToken(TOKEN), "control_center_gm")


def test_the_probe_sends_only_the_users_token_to_the_one_reviewed_rpc():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["apikey"] = request.headers["apikey"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "operation": "control_center_gm", "role": "gm", "hotel_id": "h",
                                         "verified_by": "database", "step_up": "none", "extra": "dropped"})

    result = vi.probe(_settings(), vi.HumanAccessToken(TOKEN), "control_center_gm", transport=httpx.MockTransport(handler))
    assert seen["url"] == "https://example.supabase.co/rest/v1/rpc/agent_verified_human_probe"
    assert seen["auth"] == f"Bearer {TOKEN}" and seen["body"] == {"p_operation": "control_center_gm"}
    assert seen["apikey"] == _jwt("anon")
    assert result == {"ok": True, "operation": "control_center_gm", "role": "gm", "hotel_id": "h",
                      "verified_by": "database", "step_up": "none"}


@pytest.mark.parametrize("status,body,expected", [
    (401, {"message": "JWT expired"}, {"ok": False, "reason": "not_authenticated"}),
    (403, {"code": "42501"}, {"ok": False, "reason": "not_authenticated"}),
    (200, {"ok": False, "reason": "session_not_live", "operation": "control_center_gm"},
     {"ok": False, "reason": "session_not_live", "operation": "control_center_gm"}),
])
def test_refusals_map_to_stable_codes(status, body, expected):
    transport = httpx.MockTransport(lambda request: httpx.Response(status, json=body))
    assert vi.probe(_settings(), vi.HumanAccessToken(TOKEN), "control_center_gm", transport=transport) == expected


@pytest.mark.parametrize("response", [
    httpx.Response(500, text=f"boom {TOKEN}"),
    httpx.Response(200, json={"ok": True, "operation": "other", "verified_by": "database"}),
    httpx.Response(200, json={"ok": "yes"}),
    httpx.Response(200, json={"ok": False, "reason": "Bad Reason!"}),
])
def test_errors_never_carry_the_token_or_an_unverified_success(response):
    transport = httpx.MockTransport(lambda request: response)
    with pytest.raises(vi.VerifiedIdentityError) as err:
        vi.probe(_settings(), vi.HumanAccessToken(TOKEN), "control_center_gm", transport=transport)
    assert TOKEN not in str(err.value) and TOKEN not in repr(err.value) and err.value.__cause__ is None


def test_network_failures_are_sanitized():
    def handler(request):
        raise httpx.ConnectError(f"cannot reach with {request.headers['authorization']}")

    with pytest.raises(vi.VerifiedIdentityError) as err:
        vi.probe(_settings(), vi.HumanAccessToken(TOKEN), "control_center_gm", transport=httpx.MockTransport(handler))
    assert err.value.code == "identity_unavailable" and err.value.__cause__ is None and TOKEN not in str(err.value)


def test_unknown_operations_and_insecure_urls_are_refused():
    with pytest.raises(vi.VerifiedIdentityError):
        vi.probe(_settings(), vi.HumanAccessToken(TOKEN), "decide")
    with pytest.raises(vi.VerifiedIdentityError):
        vi.probe(_settings(url="http://evil.example"), vi.HumanAccessToken(TOKEN), "control_center_gm")


def test_bearer_extraction():
    assert isinstance(vi.bearer_from_header(f"Bearer {TOKEN}"), vi.HumanAccessToken)
    for bad in (None, "", "Basic abc", TOKEN):
        with pytest.raises(vi.VerifiedIdentityError):
            vi.bearer_from_header(bad)
