"""H7 P2: the database derives the acting human from a REAL Supabase session (migration 262).

Every request travels GoTrue-minted access token -> Kong -> PostgREST -> PostgreSQL. A test passes only when the
DATABASE (not the API, not a mock) accepts or refuses. A privileged-but-unverified caller (service_role, the worker, a
caller-asserted actor id, a hotel claim, user-editable metadata) must never be accepted as a human.
"""
from __future__ import annotations

import time
import uuid

import pytest

from agent_execution_support import requires_db, sql_value
from agent_verified_identity_support import (
    PROBE,
    SAFE_FAILURE_KEYS,
    agent_row_counts,
    ban,
    claims_of,
    create_person,
    end_session_in_database,
    forge,
    forged_human,
    make_tenant,
    probe,
    reason,
    refresh,
    refused,
    rpc,
    session_row_count,
    sign_in,
    sign_out,
    update_own_metadata,
)
from agent_worker_identity_support import issue_token
from batch_support import run_sql
from core.config import settings

pytestmark = requires_db


@pytest.fixture()
def hotel_a():
    tenant = make_tenant("a")
    return tenant, create_person(tenant, "gm", label="gm-a")


# ---------------------------------------------------------------- the boundary works for a real, current GM
def test_a_current_gm_with_a_live_session_is_verified_by_the_database_for_their_own_hotel(hotel_a):
    tenant, gm = hotel_a
    session = sign_in(gm)
    assert claims_of(session["access_token"])["role"] == "authenticated"
    status, body = probe(session["access_token"])
    assert status == 200 and body == {"ok": True, "operation": "control_center_gm", "role": "gm", "hotel_id": tenant,
                                      "verified_by": "database", "step_up": "none"}, (status, body)
    status, body = probe(session["access_token"], "tool_approval_review")
    assert status == 200 and body["ok"] is True and body["role"] == "gm"


def test_a_refreshed_token_of_the_same_live_session_still_verifies(hotel_a):
    _, gm = hotel_a
    first = sign_in(gm)
    second = refresh(first)
    assert claims_of(second["access_token"])["session_id"] == claims_of(first["access_token"])["session_id"]
    assert probe(second["access_token"])[1]["ok"] is True


def test_the_probe_mutates_nothing(hotel_a):
    _, gm = hotel_a
    token = sign_in(gm)["access_token"]
    before = agent_row_counts()
    for _ in range(3):
        probe(token)
        probe(token, "tool_approval_review")
        probe(token, "no_such_operation")
    assert agent_row_counts() == before


# ---------------------------------------------------------------- non-human and unauthenticated callers
def test_an_unauthenticated_request_is_refused():
    status, body = probe(None)  # apikey only -> PostgREST role anon
    assert refused(status, body) and status != 200, (status, body)


def test_the_anon_key_as_a_bearer_is_refused():
    status, body = probe(settings_anon())
    assert refused(status, body) and status != 200, (status, body)


def test_service_role_is_never_a_verified_human(hotel_a):
    _, gm = hotel_a
    session = sign_in(gm)
    live_sid = claims_of(session["access_token"])["session_id"]
    service_key = settings.supabase_service_role_key
    status, body = probe(service_key, api_key=service_key)
    assert refused(status, body), (status, body)
    if status == 200:  # the CI fixture grants service_role EXECUTE on every function; the body still refuses
        assert body == {"ok": False, "reason": "not_authenticated_role", "operation": "control_center_gm"}
    # Even a service_role token that ALSO names the GM and the GM's live session is not a human.
    now = int(time.time())
    impersonating = forge({"role": "service_role", "sub": gm.user_id, "session_id": live_sid, "aud": "authenticated",
                           "iat": now, "exp": now + 600})
    status, body = probe(impersonating, api_key=service_key)
    assert refused(status, body), (status, body)
    if status == 200:
        assert body["reason"] == "not_authenticated_role"


def test_the_agent_worker_is_never_a_verified_human():
    tenant = make_tenant("w")
    _, worker_token = issue_token("it-h7p2-worker", tenant_id=tenant)
    status, body = probe(worker_token)
    assert refused(status, body) and status != 200, (status, body)  # agent_worker has no EXECUTE at all


# ---------------------------------------------------------------- identity comes only from the verified token
def test_an_actor_id_in_the_request_cannot_change_who_is_verified(hotel_a):
    tenant, gm = hotel_a
    other_tenant = make_tenant("other")
    other_gm = create_person(other_tenant, "gm", label="gm-other")
    token = sign_in(gm)["access_token"]
    for extra in ({"p_actor_user_id": other_gm.user_id}, {"p_tenant_id": other_tenant}, {"p_role": "gm"}):
        status, body = rpc(PROBE, {"p_operation": "control_center_gm", **extra}, token=token)
        assert refused(status, body) and status != 200, (extra, status, body)  # no such signature: nothing executes
    status, body = probe(token)
    assert body["ok"] is True and body["hotel_id"] == tenant  # still exactly the signed-in GM


def test_user_editable_metadata_is_never_authority():
    tenant = make_tenant("meta")
    other = make_tenant("meta-other")
    housekeeper = create_person(tenant, "housekeeper", label="hk")
    session = sign_in(housekeeper)
    update_own_metadata(session["access_token"], {"role": "gm", "user_role": "gm", "hotel_id": other,
                                                  "tenant_id": other})
    renewed = refresh(session)
    assert claims_of(renewed["access_token"])["user_metadata"]["role"] == "gm"
    assert reason(*probe(renewed["access_token"])) == "role_not_permitted"
    assert reason(*probe(renewed["access_token"], "tool_approval_review")) == "role_not_permitted"


def test_a_hotel_claim_for_another_hotel_is_refused(hotel_a):
    _, gm = hotel_a
    other = make_tenant("claim")
    sid = claims_of(sign_in(gm)["access_token"])["session_id"]
    assert reason(*probe(forged_human(gm.user_id, session_id=sid, hotel_id=other))) == "hotel_mismatch"
    assert reason(*probe(forged_human(gm.user_id, session_id=sid, app_metadata={"hotel_id": other}))) == "hotel_mismatch"
    assert reason(*probe(forged_human(gm.user_id, session_id=sid, user_role="gm", hotel_id=123))) == "invalid_claims"


def test_another_users_live_session_cannot_be_borrowed(hotel_a):
    _, gm = hotel_a
    housekeeper = create_person(hotel_a[0], "housekeeper", label="hk-borrow")
    hk_sid = claims_of(sign_in(housekeeper)["access_token"])["session_id"]
    # A validly signed GM token pointing at the housekeeper's live session: the session is not the GM's.
    assert reason(*probe(forged_human(gm.user_id, session_id=hk_sid))) == "session_not_live"
    # A validly signed GM token with an invented session id.
    assert reason(*probe(forged_human(gm.user_id, session_id=str(uuid.uuid4())))) == "session_not_live"


def test_cross_hotel_identity_is_refused():
    tenant_a, tenant_b = make_tenant("xa"), make_tenant("xb")
    gm_b = create_person(tenant_b, "gm", label="gm-b")
    # profile in hotel B but an active role row in hotel A only: no membership where the profile lives
    drifted = create_person(tenant_b, None, label="drift")
    run_sql(f"INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES ('{drifted.user_id}', '{tenant_a}', 'gm');")
    assert reason(*probe(sign_in(drifted)["access_token"])) == "not_a_member"
    # a GM of B is verified for B, never for A
    status, body = probe(sign_in(gm_b)["access_token"])
    assert body["ok"] is True and body["hotel_id"] == tenant_b and body["hotel_id"] != tenant_a


# ---------------------------------------------------------------- membership changes take effect on the next request
def test_inactive_and_demoted_users_and_inactive_hotels_are_refused():
    tenant = make_tenant("demote")
    gm = create_person(tenant, "gm", label="gm-demote")
    token = sign_in(gm)["access_token"]
    assert probe(token)[1]["ok"] is True
    run_sql(f"UPDATE public.user_roles SET role = 'engineer' WHERE user_id = '{gm.user_id}';")
    assert reason(*probe(token)) == "role_not_permitted"  # the same unexpired token, demoted in the database
    run_sql(f"UPDATE public.user_roles SET role = 'gm', is_active = false WHERE user_id = '{gm.user_id}';")
    assert reason(*probe(token)) == "not_a_member"
    run_sql(f"UPDATE public.user_roles SET is_active = true WHERE user_id = '{gm.user_id}';")
    run_sql(f"UPDATE public.user_profiles SET is_active = false WHERE id = '{gm.user_id}';")
    assert reason(*probe(token)) == "inactive_member"
    run_sql(f"UPDATE public.user_profiles SET is_active = true WHERE id = '{gm.user_id}';")
    run_sql(f"UPDATE public.tenants SET is_active = false WHERE id = '{tenant}';")
    assert reason(*probe(token)) == "hotel_inactive"
    run_sql(f"UPDATE public.tenants SET is_active = true WHERE id = '{tenant}';")
    assert probe(token)[1]["ok"] is True


def test_multiple_active_roles_are_ambiguous_and_refused():
    tenant, other = make_tenant("multi"), make_tenant("multi-other")
    gm = create_person(tenant, "gm", label="gm-multi")
    token = sign_in(gm)["access_token"]
    run_sql(f"INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES ('{gm.user_id}', '{tenant}', 'engineer');")
    assert reason(*probe(token)) == "ambiguous_membership"
    run_sql(f"UPDATE public.user_roles SET is_active = false WHERE user_id = '{gm.user_id}' AND role = 'engineer';")
    run_sql(f"INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES ('{gm.user_id}', '{other}', 'gm');")
    assert reason(*probe(token)) == "ambiguous_membership"  # an active role in a second hotel


# ---------------------------------------------------------------- sessions: signed out, revoked, ended, expired
def test_a_token_from_a_signed_out_session_cannot_authorize(hotel_a):
    _, gm = hotel_a
    token = sign_in(gm)["access_token"]
    sid = claims_of(token)["session_id"]
    assert probe(token)[1]["ok"] is True
    sign_out(token)
    assert session_row_count(sid) == 0
    status, body = probe(token)  # the access token is still unexpired and validly signed: PostgREST accepts it
    assert status == 200 and body == {"ok": False, "reason": "session_not_live", "operation": "control_center_gm"}


def test_a_global_sign_out_revokes_every_session_of_the_user(hotel_a):
    _, gm = hotel_a
    first, second = sign_in(gm)["access_token"], sign_in(gm)["access_token"]
    sign_out(first, scope="global")
    assert reason(*probe(second)) == "session_not_live"


def test_an_ended_session_is_refused(hotel_a):
    _, gm = hotel_a
    token = sign_in(gm)["access_token"]
    end_session_in_database(claims_of(token)["session_id"])
    assert reason(*probe(token)) == "session_not_live"


def test_an_expired_token_is_refused(hotel_a):
    _, gm = hotel_a
    sid = claims_of(sign_in(gm)["access_token"])["session_id"]
    now = int(time.time())
    status, body = probe(forged_human(gm.user_id, session_id=sid, iat=now - 7200, exp=now - 60))
    assert refused(status, body) and status != 200  # PostgREST refuses before the database is reached


def test_banned_deleted_and_anonymous_users_are_refused(hotel_a):
    _, gm = hotel_a
    token = sign_in(gm)["access_token"]
    sid = claims_of(token)["session_id"]
    assert reason(*probe(forged_human(gm.user_id, session_id=sid, is_anonymous=True))) == "user_not_eligible"
    ban(gm.user_id)
    assert reason(*probe(token)) == "user_not_eligible"
    run_sql(f"UPDATE auth.users SET banned_until = NULL, deleted_at = now() WHERE id = '{gm.user_id}';")
    assert reason(*probe(token)) == "user_not_eligible"


def test_missing_or_malformed_claims_fail_closed(hotel_a):
    _, gm = hotel_a
    sid = claims_of(sign_in(gm)["access_token"])["session_id"]
    assert reason(*probe(forged_human(gm.user_id, session_id=None))) == "session_missing"
    assert reason(*probe(forged_human(gm.user_id, session_id="not-a-uuid"))) == "session_missing"
    assert reason(*probe(forged_human(gm.user_id, session_id=sid, aud=...))) == "invalid_claims"
    assert reason(*probe(forged_human(gm.user_id, session_id=sid, aud="other"))) == "invalid_claims"
    assert reason(*probe(forged_human(gm.user_id, session_id=sid, iat=...))) == "invalid_claims"
    status, body = probe(forged_human(gm.user_id, session_id=sid, iat=int(time.time()) + 3600))
    assert refused(status, body)  # PostgREST v14 refuses first (PGRST303); the database refuses it as invalid_claims too
    assert reason(*probe(forged_human("not-a-uuid", session_id=sid))) == "invalid_claims"
    status, body = probe(forged_human(gm.user_id, session_id=sid, exp=...))
    assert refused(status, body)
    status, body = probe(forge({"role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 600}))
    assert refused(status, body)  # no sub at all


def test_failures_expose_no_personal_or_authentication_details(hotel_a):
    _, gm = hotel_a
    token = sign_in(gm)["access_token"]
    sign_out(token)
    failures = [probe(token), probe(forged_human(gm.user_id, session_id=None)), probe(token, "nope")]
    for status, body in failures:
        assert status == 200 and set(body) <= SAFE_FAILURE_KEYS, body
        text = str(body)
        assert gm.user_id not in text and gm.email not in text and "session" not in str(body.get("operation"))


# ---------------------------------------------------------------- trust boundary (documented, not a defect of 262)
def test_characterization_a_holder_of_the_jwt_signing_secret_with_a_live_session_id_is_accepted(hotel_a):
    """The database verifies the signature, the live session and current authority -- not WHO holds the signing key.

    Whoever can sign tokens with the project's secret AND knows a live session id of a GM (e.g. a compromised API that
    has both SUPABASE_JWT_SECRET and observed GM tokens) is accepted, exactly as a replay of that GM's real token would
    be. Closing it needs asymmetric signing keys the API cannot use to sign (h7-p2-verified-identity.md §6).
    """
    _, gm = hotel_a
    sid = claims_of(sign_in(gm)["access_token"])["session_id"]
    assert probe(forged_human(gm.user_id, session_id=sid))[1]["ok"] is True


# ---------------------------------------------------------------- function and privilege shape in the live database
def test_function_owner_search_path_and_privileges_are_exactly_as_reviewed():
    rows = sql_value(
        "SELECT string_agg(p.proname || ':' || p.prosecdef || ':' || pg_get_userbyid(p.proowner) || ':' "
        "|| array_to_string(p.proconfig, ',') || ':' || has_function_privilege('authenticated', p.oid, 'EXECUTE') "
        "|| ':' || has_function_privilege('anon', p.oid, 'EXECUTE') || ':' "
        "|| has_function_privilege('agent_worker', p.oid, 'EXECUTE') || ':' "
        "|| has_function_privilege('public', p.oid, 'EXECUTE'), ',' ORDER BY p.proname) FROM pg_proc p "
        "WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('agent__verified_human_claims', "
        "'agent__verified_human', 'agent_verified_human_probe', 'agent_tool_approval_decide_v2', "
        "'agent__audit_approval_transition');")
    assert rows.split(",") == [
        'agent__audit_approval_transition:true:postgres:search_path="":false:false:false:false',
        'agent__verified_human:true:postgres:search_path="":false:false:false:false',
        'agent__verified_human_claims:true:postgres:search_path="":false:false:false:false',
        'agent_tool_approval_decide_v2:true:postgres:search_path="":false:false:false:false',
        'agent_verified_human_probe:true:postgres:search_path="":true:false:false:false',
    ]
    for role in ("anon", "authenticated", "service_role", "agent_worker"):
        for table in ("auth.sessions", "auth.users"):
            assert sql_value(f"SELECT has_table_privilege('{role}', '{table}', 'SELECT')::text;") == "false", (role, table)
    assert sql_value("SELECT pg_has_role('service_role', 'authenticated', 'MEMBER')::text;") == "false"
    assert sql_value("SELECT pg_has_role('agent_worker', 'authenticated', 'MEMBER')::text;") == "false"
    # The legacy caller-asserted H2 decision is unchanged and still service_role-only.
    assert sql_value("SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE proname = 'agent_tool_approval_decide';") \
        == "ce2e5d578022a5d4422a7c48168f7701"
    assert sql_value("SELECT has_function_privilege('authenticated', 'public.agent_tool_approval_decide(uuid,uuid,uuid,text,text)', 'EXECUTE')::text;") == "false"


def test_helpers_are_not_reachable_through_postgrest(hotel_a):
    _, gm = hotel_a
    token = sign_in(gm)["access_token"]
    for name, params in (("agent__verified_human_claims", {}), ("agent__verified_human", {"p_roles": ["gm"]})):
        status, body = rpc(name, params, token=token)
        assert refused(status, body) and status != 200, (name, status, body)


def settings_anon() -> str:
    import os

    return os.getenv("ANON_KEY", "") or os.getenv("PUBLISHABLE_KEY", "")


def test_service_role_with_a_broad_function_grant_still_cannot_use_any_entry_point():
    """The CI fixture grants service_role EXECUTE on every public function; each definer must still refuse it.

    Under the migration's own ACL service_role cannot execute these at all (HTTP 401/403); either way nothing is
    verified and nothing changes."""
    key = settings.supabase_service_role_key
    before = agent_row_counts()
    calls = {"agent__verified_human_claims": {}, "agent__verified_human": {"p_roles": ["gm"]},
             PROBE: {"p_operation": "control_center_gm"},
             "agent_tool_approval_decide_v2": {"p_approval_id": str(uuid.uuid4()), "p_decision": "approve",
                                               "p_reason_code": None}}
    for name, params in calls.items():
        status, body = rpc(name, params, token=key, api_key=key)
        assert refused(status, body), (name, status, body)
        if status == 200:
            assert body.get("reason") == "not_authenticated_role", (name, body)
    assert agent_row_counts() == before
