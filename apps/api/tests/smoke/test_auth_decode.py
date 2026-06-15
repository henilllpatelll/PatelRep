import pytest
from jose.exceptions import JWKError, JWTError

from middleware import auth


@pytest.mark.asyncio
async def test_decode_token_falls_back_to_jwks_after_jwk_error(monkeypatch):
    calls = []

    def fake_decode(token, key, algorithms, audience):
        calls.append({"key": key, "algorithms": algorithms, "audience": audience})
        if algorithms == ["HS256"]:
            raise JWKError("Unable to load PEM file")
        return {
            "sub": "user-1",
            "hotel_id": "hotel-1",
            "user_role": "gm",
            "aud": audience,
        }

    async def fake_fetch_jwks():
        return {"keys": [{"kid": "key-1"}]}

    monkeypatch.setattr(auth.jwt, "decode", fake_decode)
    monkeypatch.setattr(auth, "_fetch_jwks", fake_fetch_jwks)

    payload = await auth._decode_token("token")

    assert payload["hotel_id"] == "hotel-1"
    assert [call["algorithms"] for call in calls] == [["HS256"], ["ES256"]]


@pytest.mark.asyncio
async def test_decode_token_returns_401_when_both_decode_paths_fail(monkeypatch):
    def fake_decode(*_args, **_kwargs):
        raise JWTError("bad token")

    async def fake_fetch_jwks():
        return {"keys": []}

    monkeypatch.setattr(auth.jwt, "decode", fake_decode)
    monkeypatch.setattr(auth, "_fetch_jwks", fake_fetch_jwks)

    with pytest.raises(Exception) as exc:
        await auth._decode_token("token")

    assert getattr(exc.value, "status_code", None) == 401
