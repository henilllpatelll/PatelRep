"""H0 trusted identity: contexts come only from verified/server sources and cannot be forged or altered."""
from __future__ import annotations

import copy
import dataclasses
import pickle
from datetime import datetime, timedelta
from typing import Optional

import pytest

from core.roles import ALL_ROLES
from services.agent_harness.errors import IdentityError
from services.agent_harness.identity import (
    MAX_AUTHORITY_AGE,
    SYSTEM_PRINCIPALS,
    AuthoritativeIdentity,
    IdentitySource,
    TrustedExecutionContext,
    context_for_system,
    context_from_verified_user,
    reload_identity,
)
from services.agent_harness.vocabulary import PrincipalType, TriggerType
from tests.smoke.agent_harness_support import AGENT_ID, HOTEL_A, HOTEL_B, NOW, USER_ID, human_ctx, user


class _Authority:
    def __init__(self, record: Optional[AuthoritativeIdentity]):
        self.record = record
        self.calls: list[tuple[str, str]] = []

    def load(self, *, user_id: str, hotel_id: str) -> Optional[AuthoritativeIdentity]:
        self.calls.append((user_id, hotel_id))
        return self.record


def _record(**changes) -> AuthoritativeIdentity:
    data = dict(user_id=USER_ID, hotel_id=HOTEL_A, role="engineer", is_active=True, loaded_at=NOW)
    data.update(changes)
    return AuthoritativeIdentity(**data)


def _reload(authority, **changes):
    kwargs = dict(user_id=USER_ID, hotel_id=HOTEL_A, agent_id=AGENT_ID, agent_version=1,
                  trigger=TriggerType.SCHEDULE, now=NOW)
    kwargs.update(changes)
    return reload_identity(authority, **kwargs)


@pytest.mark.parametrize("role", ALL_ROLES)
def test_verified_user_context_carries_server_identity(role):
    ctx = human_ctx(role)
    assert (ctx.principal_type, ctx.role, ctx.hotel_id, ctx.user_id) == (PrincipalType.HUMAN, role, HOTEL_A, USER_ID)
    assert ctx.source is IdentitySource.VERIFIED_REQUEST_JWT and ctx.trigger is TriggerType.USER_REQUEST


def test_direct_construction_is_refused():
    with pytest.raises(IdentityError) as err:
        TrustedExecutionContext(principal_type=PrincipalType.HUMAN, hotel_id=HOTEL_A, agent_id=AGENT_ID,
                                agent_version=1, trigger=TriggerType.USER_REQUEST,
                                source=IdentitySource.VERIFIED_REQUEST_JWT, authority_verified_at=NOW,
                                user_id=USER_ID, role="gm")
    assert err.value.code == "untrusted_construction"


@pytest.mark.parametrize("field, value", [("hotel_id", HOTEL_B), ("role", "gm"), ("user_id", "other"),
                                          ("authority_verified_at", NOW + timedelta(days=1))])
def test_verified_fields_cannot_be_replaced_with_model_supplied_values(field, value):
    ctx = human_ctx("housekeeper")
    with pytest.raises(IdentityError):
        dataclasses.replace(ctx, **{field: value})
    with pytest.raises(dataclasses.FrozenInstanceError):
        setattr(ctx, field, value)
    assert getattr(ctx, field) != value


def test_context_cannot_be_revived_from_serialised_data():
    ctx = human_ctx("gm")
    with pytest.raises(IdentityError):
        pickle.dumps(ctx)
    assert copy.copy(ctx) is ctx and copy.deepcopy(ctx) is ctx


@pytest.mark.parametrize("candidate", [
    {"user_id": USER_ID, "hotel_id": HOTEL_A, "role": "gm"},
    "Bearer forged.jwt.token",
    None,
])
def test_unauthenticated_identity_is_refused(candidate):
    with pytest.raises(IdentityError) as err:
        context_from_verified_user(candidate, agent_id=AGENT_ID, agent_version=1, now=NOW)
    assert err.value.code == "unauthenticated"


@pytest.mark.parametrize("role", ["none", "owner", "admin", "GM", "", "service_role", "authenticated"])
def test_unsupported_roles_are_refused(role):
    with pytest.raises(IdentityError) as err:
        context_from_verified_user(user(role), agent_id=AGENT_ID, agent_version=1, now=NOW)
    assert err.value.code == "unknown_role"


@pytest.mark.parametrize("agent_id, version", [("Bad Agent", 1), ("examples", 1), (AGENT_ID, 0), (AGENT_ID, True)])
def test_malformed_agent_identity_is_refused(agent_id, version):
    with pytest.raises(IdentityError):
        context_from_verified_user(user("gm"), agent_id=agent_id, agent_version=version, now=NOW)


def test_missing_hotel_is_refused():
    with pytest.raises(IdentityError) as err:
        context_from_verified_user(user("gm", hotel_id=""), agent_id=AGENT_ID, agent_version=1, now=NOW)
    assert err.value.code == "missing_hotel"


def test_naive_timestamps_are_refused():
    with pytest.raises(IdentityError):
        context_from_verified_user(user("gm"), agent_id=AGENT_ID, agent_version=1, now=datetime(2026, 11, 13))


def test_request_authority_expires():
    ctx = human_ctx("gm")
    assert ctx.is_current(NOW + MAX_AUTHORITY_AGE)
    assert not ctx.is_current(NOW + MAX_AUTHORITY_AGE + timedelta(seconds=1))
    assert not ctx.is_current(NOW - timedelta(seconds=1))


# --- background reload ------------------------------------------------------------------------------------------

def test_background_identity_is_reloaded_from_the_authority():
    authority = _Authority(_record())
    ctx = _reload(authority)
    assert authority.calls == [(USER_ID, HOTEL_A)]
    assert ctx.role == "engineer" and ctx.source is IdentitySource.SERVER_RELOAD


@pytest.mark.parametrize("record, code", [
    (None, "principal_not_found"),
    (_record(is_active=False), "principal_inactive"),
    (_record(hotel_id=HOTEL_B), "tenant_mismatch"),
    (_record(user_id="someone-else"), "tenant_mismatch"),
    (_record(role="owner"), "unknown_role"),
    (_record(loaded_at=NOW - timedelta(hours=1)), "stale_identity"),
    (_record(loaded_at=NOW + timedelta(minutes=1)), "stale_identity"),
])
def test_stale_inactive_or_mismatched_background_identity_is_refused(record, code):
    with pytest.raises(IdentityError) as err:
        _reload(_Authority(record))
    assert err.value.code == code


def test_reload_reflects_a_demotion_rather_than_the_old_claim():
    # A job queued by a GM who has since been changed to front desk runs with the CURRENT role.
    ctx = _reload(_Authority(_record(role="front_desk")))
    assert ctx.role == "front_desk"


def test_authority_returning_a_foreign_object_is_refused():
    class Fake:
        user_id, hotel_id, role, is_active, loaded_at = USER_ID, HOTEL_A, "gm", True, NOW
    with pytest.raises(IdentityError) as err:
        _reload(_Authority(Fake()))  # type: ignore[arg-type]
    assert err.value.code == "invalid_identity_record"


# --- system principals ------------------------------------------------------------------------------------------

def test_registered_system_principal_has_no_role():
    ctx = context_for_system("harness.scheduled_observer", hotel_id=HOTEL_A, agent_id=AGENT_ID, agent_version=1,
                             trigger=TriggerType.SCHEDULE, now=NOW)
    assert ctx.principal_type is PrincipalType.SYSTEM and ctx.role is None and ctx.user_id is None


@pytest.mark.parametrize("principal", ["gm", "system", "harness.admin", "service_role", ""])
def test_unknown_system_principals_are_refused(principal):
    with pytest.raises(IdentityError) as err:
        context_for_system(principal, hotel_id=HOTEL_A, agent_id=AGENT_ID, agent_version=1,
                           trigger=TriggerType.SCHEDULE, now=NOW)
    assert err.value.code == "unknown_system_principal"


def test_system_principal_trigger_is_restricted():
    with pytest.raises(IdentityError) as err:
        context_for_system("harness.scheduled_observer", hotel_id=HOTEL_A, agent_id=AGENT_ID, agent_version=1,
                           trigger=TriggerType.USER_REQUEST, now=NOW)
    assert err.value.code == "invalid_trigger"


def test_no_system_principal_inherits_management_authority():
    for spec in SYSTEM_PRINCIPALS.values():
        assert spec.max_autonomy.value == 1
        assert spec.principal_id not in ALL_ROLES
