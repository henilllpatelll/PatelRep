import pytest
from fastapi.security import HTTPAuthorizationCredentials

from middleware import auth
from routers import auth as auth_router


@pytest.mark.asyncio
async def test_uses_service_managed_app_metadata_when_jwt_hook_claims_are_absent(monkeypatch):
    async def decode_token(_token):
        return {
            "sub": "staging-user",
            "email": "staging-gm@patelrep.test",
            "app_metadata": {"hotel_id": "staging-hotel", "role": "gm"},
        }

    monkeypatch.setattr(auth, "_decode_token", decode_token)

    current_user = await auth.get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="fixture-token")
    )

    assert current_user.hotel_id == "staging-hotel"
    assert current_user.role == "gm"


@pytest.mark.asyncio
async def test_prefers_top_level_jwt_claims_over_app_metadata(monkeypatch):
    async def decode_token(_token):
        return {
            "sub": "production-user",
            "hotel_id": "production-hotel",
            "role": "gm",
            "app_metadata": {"hotel_id": "stale-hotel", "role": "engineer"},
        }

    monkeypatch.setattr(auth, "_decode_token", decode_token)

    current_user = await auth.get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="production-token")
    )

    assert current_user.hotel_id == "production-hotel"
    assert current_user.role == "gm"


@pytest.mark.asyncio
async def test_ignores_supabase_database_role_in_favor_of_app_metadata_role(monkeypatch):
    async def decode_token(_token):
        return {
            "sub": "staging-gm",
            "hotel_id": "staging-hotel",
            "role": "authenticated",
            "app_metadata": {"role": "gm"},
        }

    monkeypatch.setattr(auth, "_decode_token", decode_token)

    current_user = await auth.get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="fixture-token")
    )

    assert current_user.role == "gm"


@pytest.mark.asyncio
async def test_prefers_valid_user_role_over_database_and_app_metadata_roles(monkeypatch):
    async def decode_token(_token):
        return {
            "sub": "production-gm",
            "hotel_id": "production-hotel",
            "user_role": "gm",
            "role": "authenticated",
            "app_metadata": {"role": "engineer"},
        }

    monkeypatch.setattr(auth, "_decode_token", decode_token)

    current_user = await auth.get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="production-token")
    )

    assert current_user.role == "gm"


@pytest.mark.asyncio
async def test_prefers_valid_top_level_role_over_app_metadata_role(monkeypatch):
    async def decode_token(_token):
        return {
            "sub": "chief-engineer",
            "hotel_id": "hotel-a",
            "role": "chief_engineer",
            "app_metadata": {"role": "engineer"},
        }

    monkeypatch.setattr(auth, "_decode_token", decode_token)

    current_user = await auth.get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="production-token")
    )

    assert current_user.role == "chief_engineer"


@pytest.mark.asyncio
async def test_uses_none_when_no_application_role_is_present(monkeypatch):
    async def decode_token(_token):
        return {
            "sub": "unassigned-user",
            "hotel_id": "hotel-a",
            "role": "authenticated",
            "app_metadata": {"role": "service_role"},
        }

    monkeypatch.setattr(auth, "_decode_token", decode_token)

    current_user = await auth.get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="production-token")
    )

    assert current_user.role == "none"


@pytest.mark.asyncio
async def test_auth_me_returns_current_users_resolved_application_role(monkeypatch):
    class Query:
        data = {}

        def select(self, *_args):
            return self

        def eq(self, *_args):
            return self

        def maybe_single(self):
            return self

        def execute(self):
            return self

    class Supabase:
        def table(self, _name):
            return Query()

    monkeypatch.setattr(auth_router, "supabase", Supabase())
    monkeypatch.setattr(auth_router, "is_feature_enabled", lambda *_args: False)

    response = await auth_router.get_me(
        auth.CurrentUser(user_id="gm-1", hotel_id="hotel-a", role="gm", email="gm@example.com")
    )

    assert response["user"]["role"] == "gm"
