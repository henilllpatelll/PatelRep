"""JWT verification regression tests (PYSEC-2026-4298 / algorithm confusion).

These use real signatures instead of mocking ``jwt.decode`` so a library swap
cannot silently change which tokens are accepted.
"""
import base64
import hashlib
import hmac
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from core.config import settings
from middleware import auth

AUD = "authenticated"


def _claims(**overrides):
    claims = {
        "sub": "user-1",
        "hotel_id": "hotel-1",
        "user_role": "gm",
        "aud": AUD,
        "exp": int(time.time()) + 300,
    }
    claims.update(overrides)
    return claims


def _ec_material(kid="key-1"):
    private = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(private.public_key()))
    jwk.update({"kid": kid, "alg": "ES256", "use": "sig"})
    return private, {"keys": [jwk]}


def _b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def _patch_jwks(monkeypatch, jwks):
    async def fake_fetch_jwks():
        return jwks

    monkeypatch.setattr(auth, "_fetch_jwks", fake_fetch_jwks)


async def _assert_rejected(token):
    with pytest.raises(Exception) as exc:
        await auth._decode_token(token)
    assert getattr(exc.value, "status_code", None) == 401


@pytest.mark.asyncio
async def test_hs256_token_signed_with_project_secret_is_accepted(monkeypatch):
    _patch_jwks(monkeypatch, {"keys": []})
    token = jwt.encode(_claims(), settings.supabase_jwt_secret, algorithm="HS256")
    assert (await auth._decode_token(token))["hotel_id"] == "hotel-1"


@pytest.mark.asyncio
async def test_es256_token_falls_back_to_jwks(monkeypatch):
    private, jwks = _ec_material()
    _patch_jwks(monkeypatch, jwks)
    token = jwt.encode(_claims(), private, algorithm="ES256", headers={"kid": "key-1"})
    assert (await auth._decode_token(token))["sub"] == "user-1"


@pytest.mark.asyncio
async def test_es256_token_with_unknown_kid_is_rejected(monkeypatch):
    private, jwks = _ec_material()
    _patch_jwks(monkeypatch, jwks)
    token = jwt.encode(_claims(), private, algorithm="ES256", headers={"kid": "other"})
    await _assert_rejected(token)


@pytest.mark.asyncio
async def test_es256_token_signed_by_untrusted_key_is_rejected(monkeypatch):
    _, jwks = _ec_material()
    attacker, _ = _ec_material()
    _patch_jwks(monkeypatch, jwks)
    token = jwt.encode(_claims(), attacker, algorithm="ES256", headers={"kid": "key-1"})
    await _assert_rejected(token)


@pytest.mark.asyncio
async def test_hs256_forged_with_der_public_key_is_rejected(monkeypatch):
    """PYSEC-2026-4298: the public key (DER, no PEM armor) must never act as an HMAC secret."""
    private, jwks = _ec_material()
    _patch_jwks(monkeypatch, jwks)
    der = private.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    pem = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    for secret in (der, pem):
        # PyJWT itself refuses to sign with asymmetric key material; build the forgery by hand.
        signing_input = f"{_b64({'alg': 'HS256', 'typ': 'JWT', 'kid': 'key-1'})}.{_b64(_claims())}"
        sig = hmac.new(secret, signing_input.encode(), hashlib.sha256).digest()
        forged = f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"
        await _assert_rejected(forged)


@pytest.mark.asyncio
async def test_hs256_token_cannot_be_verified_via_jwks_path(monkeypatch):
    """A token whose header claims HS256 must not be accepted with a wrong HMAC secret."""
    _, jwks = _ec_material()
    _patch_jwks(monkeypatch, jwks)
    token = jwt.encode(_claims(), "x" * 64, algorithm="HS256", headers={"kid": "key-1"})
    await _assert_rejected(token)


@pytest.mark.asyncio
async def test_alg_none_token_is_rejected(monkeypatch):
    _patch_jwks(monkeypatch, {"keys": []})
    unsigned = f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64(_claims())}."
    await _assert_rejected(unsigned)


@pytest.mark.asyncio
async def test_expired_token_is_rejected(monkeypatch):
    _patch_jwks(monkeypatch, {"keys": []})
    token = jwt.encode(
        _claims(exp=int(time.time()) - 60), settings.supabase_jwt_secret, algorithm="HS256"
    )
    await _assert_rejected(token)


@pytest.mark.asyncio
async def test_wrong_audience_is_rejected(monkeypatch):
    _patch_jwks(monkeypatch, {"keys": []})
    token = jwt.encode(_claims(aud="anon"), settings.supabase_jwt_secret, algorithm="HS256")
    await _assert_rejected(token)


@pytest.mark.asyncio
async def test_malformed_token_returns_401(monkeypatch):
    _patch_jwks(monkeypatch, {"keys": []})
    await _assert_rejected("not-a-jwt")
