"""H1 identity revalidation (current authority, never queued claims) and environment-gated synthetic admission."""
from __future__ import annotations

from datetime import timedelta

import pytest

from middleware.auth import CurrentUser
from services.agent_execution import SYNTHETIC_AGENT_ID, SYNTHETIC_AGENT_VERSION
from services.agent_execution.admission import (
    AdmissionRefused,
    admit_synthetic_run,
    request_digest,
    synthetic_admission_allowed,
)
from services.agent_execution.controls_store import block_reason, controls_from_rows
from services.agent_execution.identity_authority import identity_from_rows, revalidate_principal
from services.agent_execution.synthetic import SyntheticSpec
from services.agent_harness.controls import H0_EXECUTION_SUPPORTED
from services.agent_harness.errors import AgentExecutionDisabled, IdentityError
from services.agent_harness.identity import context_for_system, context_from_verified_user
from services.agent_harness.vocabulary import TriggerType
from tests.smoke.agent_execution_support import GM_USER, HOTEL_A, HOTEL_B, NOW, FakeAuthority, run_row

TENANT = [{"id": HOTEL_A, "is_active": True}]
PROFILE = [{"id": GM_USER, "tenant_id": HOTEL_A, "is_active": True}]


def rows(**kw):
    base = dict(user_id=GM_USER, hotel_id=HOTEL_A, tenants=TENANT, profiles=PROFILE,
                roles=[{"role": "gm", "is_active": True}], loaded_at=NOW)
    base.update(kw)
    return identity_from_rows(**base)


# --- authoritative membership decision -------------------------------------------------------------------------

def test_active_single_role_membership_is_returned():
    ident = rows()
    assert (ident.role, ident.is_active, ident.hotel_id) == ("gm", True, HOTEL_A)


@pytest.mark.parametrize("override", [
    {"roles": []}, {"profiles": []}, {"tenants": []},
])
def test_missing_records_mean_no_membership(override):
    assert rows(**override) is None


@pytest.mark.parametrize("override", [
    {"roles": [{"role": "gm", "is_active": False}]},                        # removed / deactivated role
    {"profiles": [{"id": GM_USER, "tenant_id": HOTEL_A, "is_active": False}]},  # deactivated account
    {"tenants": [{"id": HOTEL_A, "is_active": False}]},                     # hotel deactivated (entitlement)
])
def test_deactivation_anywhere_makes_the_identity_inactive(override):
    assert rows(**override).is_active is False


@pytest.mark.parametrize("override, code", [
    ({"roles": [{"role": "gm", "is_active": True}, {"role": "front_desk", "is_active": True}]}, "ambiguous_membership"),
    ({"profiles": [{"id": GM_USER, "tenant_id": HOTEL_B, "is_active": True}]}, "tenant_mismatch"),
    ({"roles": [{"role": "owner", "is_active": True}]}, "unknown_role"),
    ({"profiles": PROFILE * 2}, "ambiguous_membership"),
])
def test_ambiguous_or_inconsistent_records_fail_closed(override, code):
    with pytest.raises(IdentityError) as err:
        rows(**override)
    assert err.value.code == code


# --- revalidation against current authority ---------------------------------------------------------------------

def test_revalidation_reads_current_authority_not_the_queued_run():
    authority = FakeAuthority("gm")
    ctx = revalidate_principal(run_row(role="housekeeper"), authority, clock=lambda: NOW)  # a role inside the run is ignored
    assert (ctx.role, ctx.hotel_id, ctx.user_id) == ("gm", HOTEL_A, GM_USER)
    assert authority.calls == [(GM_USER, HOTEL_A)]


@pytest.mark.parametrize("authority, code", [
    (FakeAuthority("housekeeper"), "operational_permission_revoked"),   # demoted
    (FakeAuthority("gm", active=False), "principal_inactive"),           # deactivated
    (FakeAuthority(missing=True), "principal_not_found"),                # removed from the hotel
    (FakeAuthority("gm", hotel_id=HOTEL_B), "tenant_mismatch"),          # record from another hotel
    (FakeAuthority("gm", loaded_at=NOW - timedelta(minutes=10)), "stale_identity"),
])
def test_revalidation_refuses_revoked_authority(authority, code):
    with pytest.raises(IdentityError) as err:
        revalidate_principal(run_row(), authority, clock=lambda: NOW)
    assert err.value.code == code


def test_system_principal_comes_only_from_the_h0_registry():
    sysrun = run_row(principal_type="system", initiated_by_user_id=None,
                     system_principal_id="harness.scheduled_observer", trigger_type="schedule")
    ctx = revalidate_principal(sysrun, FakeAuthority(missing=True), clock=lambda: NOW)
    assert ctx.role is None and ctx.user_id is None
    with pytest.raises(IdentityError):
        revalidate_principal({**sysrun, "system_principal_id": "harness.root"}, FakeAuthority(), clock=lambda: NOW)
    with pytest.raises(IdentityError):  # registered principal, but a trigger it is not allowed
        revalidate_principal({**sysrun, "trigger_type": "user_request"}, FakeAuthority(), clock=lambda: NOW)


def test_freshness_is_judged_after_the_membership_read_completes():
    # Regression (found by the real-database suite): the read is stamped by the authority's own clock, which runs
    # AFTER any earlier sample. Revalidation must sample "now" after the read, not before it.
    ticks = iter([NOW + timedelta(milliseconds=5)])
    authority = FakeAuthority("gm", loaded_at=NOW + timedelta(milliseconds=3))
    ctx = revalidate_principal(run_row(), authority, clock=lambda: next(ticks))
    assert ctx.role == "gm"


def test_malformed_principal_fields_fail_closed():
    for bad in ({"principal_type": "admin"}, {"trigger_type": "cron"}, {"initiated_by_user_id": None}):
        with pytest.raises(IdentityError):
            revalidate_principal(run_row(**bad), FakeAuthority(), clock=lambda: NOW)


# --- runtime controls -------------------------------------------------------------------------------------------

def test_controls_snapshot_can_only_restrict():
    c = controls_from_rows([{"scope": "platform", "paused": False, "cost_emergency_stop": False}], NOW)
    assert c.platform_execution_enabled is False and block_reason(c, hotel_id=HOTEL_A, agent_id="a.b") is None
    assert block_reason(controls_from_rows([{"scope": "platform", "paused": True}], NOW),
                        hotel_id=HOTEL_A, agent_id="a.b") == "platform_paused"
    assert block_reason(controls_from_rows([{"scope": "platform", "cost_emergency_stop": True}], NOW),
                        hotel_id=HOTEL_A, agent_id="a.b") == "cost_emergency_stop"
    hotel = controls_from_rows([{"scope": "hotel", "tenant_id": HOTEL_A, "paused": True}], NOW)
    assert block_reason(hotel, hotel_id=HOTEL_A, agent_id="a.b") == "hotel_paused"
    assert block_reason(hotel, hotel_id=HOTEL_B, agent_id="a.b") is None
    agent = controls_from_rows([{"scope": "agent", "agent_id": "a.b", "paused": True}], NOW)
    assert block_reason(agent, hotel_id=HOTEL_A, agent_id="a.b") == "agent_paused"


# --- admission --------------------------------------------------------------------------------------------------

class RecordingStore:
    def __init__(self, answer=None):
        self.answer = answer or {"admitted": True, "created": True, "run_id": "r1", "state": "queued"}
        self.kwargs = None

    def admit(self, **kw):
        self.kwargs = kw
        return self.answer


def gm_ctx(agent_id=SYNTHETIC_AGENT_ID, version=SYNTHETIC_AGENT_VERSION, role="gm", hotel=HOTEL_A):
    return context_from_verified_user(CurrentUser(user_id=GM_USER, hotel_id=hotel, role=role),
                                      agent_id=agent_id, agent_version=version, now=NOW)


SPEC = SyntheticSpec(operation="noop")


def test_h0_ceiling_is_unchanged():
    assert H0_EXECUTION_SUPPORTED is False


@pytest.mark.parametrize("env, flag, allowed", [
    ("production", True, False), ("production", False, False), ("staging", False, False),
    ("staging", True, True), ("test", True, True), ("development", True, True),
])
def test_synthetic_admission_environment_gate(env, flag, allowed):
    assert synthetic_admission_allowed(app_env=env, synthetic_enabled=flag) is allowed


def test_admission_takes_identity_only_from_the_trusted_context():
    store = RecordingStore()
    result = admit_synthetic_run(store, gm_ctx(), SPEC, idempotency_key="key-000001", app_env="test",
                                 synthetic_enabled=True)
    assert result.created and store.kwargs["tenant_id"] == HOTEL_A and store.kwargs["user_id"] == GM_USER
    assert store.kwargs["principal_type"] == "human" and store.kwargs["agent_id"] == SYNTHETIC_AGENT_ID
    assert len(store.kwargs["request_digest"]) == 64


def test_real_agent_admission_stays_disabled():
    with pytest.raises(AgentExecutionDisabled):
        admit_synthetic_run(RecordingStore(), gm_ctx(agent_id="examples.work_order_observer"), SPEC,
                            idempotency_key="key-000001", app_env="staging", synthetic_enabled=True)


@pytest.mark.parametrize("kwargs, reason", [
    ({"app_env": "production"}, "synthetic_disabled"),
    ({"synthetic_enabled": False}, "synthetic_disabled"),
    ({"idempotency_key": "short"}, "invalid_idempotency_key"),
    ({"idempotency_key": "has spaces in it"}, "invalid_idempotency_key"),
])
def test_admission_refusals(kwargs, reason):
    base = dict(idempotency_key="key-000001", app_env="test", synthetic_enabled=True)
    base.update(kwargs)
    with pytest.raises(AdmissionRefused) as err:
        admit_synthetic_run(RecordingStore(), gm_ctx(), SPEC, **base)
    assert err.value.reason == reason


def test_non_gm_humans_cannot_admit_probes_and_forged_contexts_are_refused():
    with pytest.raises(AdmissionRefused):
        admit_synthetic_run(RecordingStore(), gm_ctx(role="housekeeper"), SPEC, idempotency_key="key-000001",
                            app_env="test", synthetic_enabled=True)
    with pytest.raises(IdentityError):
        admit_synthetic_run(RecordingStore(), {"hotel_id": HOTEL_A, "role": "gm"}, SPEC,  # type: ignore[arg-type]
                            idempotency_key="key-000001", app_env="test", synthetic_enabled=True)


def test_database_refusal_is_surfaced_with_its_reason():
    with pytest.raises(AdmissionRefused) as err:
        admit_synthetic_run(RecordingStore({"admitted": False, "reason": "idempotency_conflict"}), gm_ctx(), SPEC,
                            idempotency_key="key-000001", app_env="test", synthetic_enabled=True)
    assert err.value.reason == "idempotency_conflict"


def test_request_digest_binds_identity_and_meaning():
    a = request_digest(gm_ctx(), SPEC)
    assert a == request_digest(gm_ctx(), SPEC)
    assert a != request_digest(gm_ctx(), SyntheticSpec(operation="noop", steps=2))
    assert a != request_digest(gm_ctx(hotel=HOTEL_B), SPEC)
    sys_ctx = context_for_system("harness.scheduled_observer", hotel_id=HOTEL_A, agent_id=SYNTHETIC_AGENT_ID,
                                 agent_version=1, trigger=TriggerType.SCHEDULE, now=NOW)
    assert a != request_digest(sys_ctx, SPEC)
