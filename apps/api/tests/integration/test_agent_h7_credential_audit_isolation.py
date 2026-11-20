"""H7 P2 / threat-model-h7 §F: worker-credential journal rows never leak across hotels (migration 262).

Credentials are bound to one hotel (261), but the unchanged 256/260 journal writes their issue/revoke events with
tenant_id NULL (platform scope) -- exactly the shape of every historical row. 262 changes only the read model: such
a row is shown to the bound hotel alone (app_env + expires_at; never the label), to no hotel when the credential is
unbound, and every other platform row is returned exactly as before. Real database, two (or three) distinct hotels.
"""
from __future__ import annotations

import uuid

import pytest

from agent_execution_support import requires_db, sql_value
from agent_verified_identity_support import make_tenant
from agent_worker_identity_support import ensure_test_deployment_identity, issue_token, revoke
from batch_support import new_client, run_sql
from services.agent_control_center import service
from services.agent_control_center.access import Viewer
from services.agent_control_center.store import ControlCenterStore

pytestmark = requires_db
CREDENTIAL_TYPES = ["worker_credential_issued", "worker_credential_revoked"]


def _store() -> ControlCenterStore:
    return ControlCenterStore(new_client())


def _credential_rows(tenant_id: str) -> list[dict]:
    rows = _store().events_page(tenant_id, before_id=None, limit=100, event_types=CREDENTIAL_TYPES)
    return [r for r in rows if r["subject_type"] == "worker_credential"]


def _all_rows(tenant_id: str) -> list[dict]:
    return _store().events_page(tenant_id, before_id=None, limit=100, event_types=None)


@pytest.fixture()
def two_hotels():
    a, b = make_tenant("cred-a"), make_tenant("cred-b")
    cred_a, _ = issue_token("it-h7p2-label-hotel-a", tenant_id=a)
    cred_b, _ = issue_token("it-h7p2-label-hotel-b", tenant_id=b)
    revoke(cred_b)
    return a, b, cred_a, cred_b


def test_the_journal_still_stores_credential_rows_platform_scoped_and_unchanged(two_hotels):
    _, _, cred_a, cred_b = two_hotels
    stored = sql_value("SELECT count(*) FROM public.agent_control_center_events WHERE tenant_id IS NULL "
                       f"AND subject_type = 'worker_credential' AND subject_ref IN ('{cred_a}', '{cred_b}');")
    assert stored == "3"  # issue A, issue B, revoke B: append-only history kept, nothing rewritten
    label = sql_value(f"SELECT detail->>'label' FROM public.agent_control_center_events WHERE subject_ref = '{cred_a}' "
                      "AND event_type = 'worker_credential_issued';")
    assert label == "it-h7p2-label-hotel-a"  # the platform operator's record is intact


def test_hotel_a_never_sees_hotel_b_credential_metadata(two_hotels):
    a, b, cred_a, cred_b = two_hotels
    seen_by_a = _credential_rows(a)
    assert {r["subject_ref"] for r in seen_by_a} >= {cred_a}
    assert cred_b not in {r["subject_ref"] for r in seen_by_a}
    text_a = str(_all_rows(a))
    assert cred_b not in text_a and "hotel-b" not in text_a  # not even in other rows' details
    seen_by_b = _credential_rows(b)
    assert {r["event_type"] for r in seen_by_b if r["subject_ref"] == cred_b} == set(CREDENTIAL_TYPES)
    assert cred_a not in str(_all_rows(b)) and "hotel-a" not in str(_all_rows(b))


def test_a_hotel_sees_only_permitted_metadata_of_its_own_credential(two_hotels):
    a, _, cred_a, _ = two_hotels
    own = [r for r in _credential_rows(a) if r["subject_ref"] == cred_a]
    assert len(own) == 1
    row = own[0]
    assert row["scope"] == "hotel" and row["actor_user_id"] is None
    assert set(row["detail"]) == {"app_env", "expires_at"}, row["detail"]  # the operator label is dropped
    assert "label" not in str(row)


def test_an_unbound_credential_is_shown_to_no_hotel():
    a, b = make_tenant("unbound-a"), make_tenant("unbound-b")
    ensure_test_deployment_identity()
    rogue = str(uuid.uuid4())
    # The 261 operator path refuses unbound credentials; the owner can still create one directly. It grants nothing,
    # and its journal row must not leak to any hotel.
    run_sql("INSERT INTO public.agent_worker_credentials (id, label, app_env, issued_by, expires_at) "
            f"VALUES ('{rogue}', 'rogue-unbound', 'test', 'it-operator', now() + interval '1 day');")
    assert sql_value(f"SELECT count(*) FROM public.agent_control_center_events WHERE subject_ref = '{rogue}';") == "1"
    for tenant in (a, b):
        assert rogue not in str(_all_rows(tenant))


def test_unrelated_platform_rows_are_still_shown_to_every_hotel_exactly_as_before():
    a, b = make_tenant("plat-a"), make_tenant("plat-b")
    marker = f"h7p2-{uuid.uuid4().hex[:8]}"
    new_client().rpc("agent_tool_control_set", {"p_tool_id": "engineering.work_orders.assign", "p_paused": True,
                                                "p_updated_by": marker, "p_reason_code": "integration_test"}).execute()
    new_client().rpc("agent_tool_control_set", {"p_tool_id": "engineering.work_orders.assign", "p_paused": False,
                                                "p_updated_by": marker, "p_reason_code": "integration_test"}).execute()
    for tenant in (a, b):
        rows = [r for r in _store().events_page(tenant, before_id=None, limit=100,
                                                event_types=["tool_control_changed"])]
        assert rows and rows[0]["scope"] == "platform" and rows[0]["detail"]["tool_id"] == "engineering.work_orders.assign"
        assert set(rows[0]["detail"]) == {"tool_id", "paused_before", "paused"}


def test_the_control_center_audit_service_passes_the_isolation_through(two_hotels):
    a, _, cred_a, cred_b = two_hotels
    viewer = Viewer(user_id=str(uuid.uuid4()), hotel_id=a, role="gm")
    page = service.audit(_store(), viewer, before_id=None, limit=100, event_type=None)
    refs = {e.get("subject_ref") for e in page["events"]}
    assert cred_a in refs and cred_b not in refs
    page = service.audit(_store(), viewer, before_id=None, limit=100, event_type="worker_credential_revoked")
    assert cred_b not in {e.get("subject_ref") for e in page["events"]}


def test_pagination_counts_only_rows_the_hotel_may_see(two_hotels):
    a, b, _, _ = two_hotels
    for _ in range(3):
        issue_token("it-h7p2-noise", tenant_id=b)
    rows = _store().events_page(a, before_id=None, limit=1, event_types=CREDENTIAL_TYPES)
    assert len(rows) == 1 and rows[0]["scope"] == "hotel"  # the limit is filled from the hotel's own rows
