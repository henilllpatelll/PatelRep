import pytest
from fastapi.security import HTTPAuthorizationCredentials

from middleware import auth


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
