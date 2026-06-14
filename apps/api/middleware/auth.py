import base64
import json
import logging
import time
import httpx
from dataclasses import dataclass
from typing import Optional
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from cryptography.hazmat.primitives.asymmetric.ec import (
    EllipticCurvePublicNumbers,
    SECP256R1,
    ECDSA,
)
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.exceptions import InvalidSignature
from core.config import settings

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

_jwks_cache: list | None = None
_jwks_cache_time: float = 0.0


def _b64url_decode(val: str) -> bytes:
    padded = val + "=" * (-len(val) % 4)
    return base64.urlsafe_b64decode(padded)


def _b64url_to_int(val: str) -> int:
    return int.from_bytes(_b64url_decode(val), "big")


def _build_ec_public_key(jwk: dict):
    """Build an EllipticCurvePublicKey from a P-256 JWK dict."""
    numbers = EllipticCurvePublicNumbers(
        x=_b64url_to_int(jwk["x"]),
        y=_b64url_to_int(jwk["y"]),
        curve=SECP256R1(),
    )
    return numbers.public_key()


def _verify_es256_jwt(token: str, public_key, audience: str) -> dict:
    """Verify an ES256 JWT directly with the cryptography library.

    python-jose 3.5.x is incompatible with cryptography >= 42 for ES256
    because of P1363 vs DER signature format handling. We do it ourselves.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed JWT")

    header_b64, payload_b64, sig_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}".encode()
    sig_bytes = _b64url_decode(sig_b64)

    # JWT ES256 signatures are IEEE P1363 (R || S, 32 bytes each for P-256).
    # cryptography.verify() expects DER-encoded ASN.1, so convert.
    if len(sig_bytes) != 64:
        raise ValueError(f"Unexpected ES256 signature length: {len(sig_bytes)}")
    r = int.from_bytes(sig_bytes[:32], "big")
    s = int.from_bytes(sig_bytes[32:], "big")
    der_sig = encode_dss_signature(r, s)

    try:
        public_key.verify(der_sig, signing_input, ECDSA(hashes.SHA256()))
    except InvalidSignature:
        raise ValueError("ES256 signature verification failed")

    payload = json.loads(_b64url_decode(payload_b64))

    now = time.time()
    if payload.get("exp", now + 1) < now:
        raise ValueError("Token has expired")

    aud = payload.get("aud")
    if aud is not None:
        aud_list = aud if isinstance(aud, list) else [aud]
        if audience not in aud_list:
            raise ValueError(f"Audience mismatch: expected '{audience}'")

    return payload


async def _fetch_jwks() -> list[dict]:
    """Fetch and cache Supabase JWKS keys."""
    global _jwks_cache, _jwks_cache_time
    now = time.time()
    if _jwks_cache is None or (now - _jwks_cache_time) > 3600:
        url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(url)
                data = r.json()
                _jwks_cache = data.get("keys", [])
                _jwks_cache_time = now
                logger.warning("JWKS fetched: url=%s status=%d keys=%d", url, r.status_code, len(_jwks_cache))
        except Exception as e:
            logger.warning("JWKS fetch failed: url=%s error=%s", url, e)
    return _jwks_cache or []


@dataclass
class CurrentUser:
    user_id: str
    hotel_id: str
    role: str
    email: str = ""


async def _decode_token(token: str) -> dict:
    # Try HS256 first (smoke tests + older Supabase projects)
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except JWTError:
        pass

    # ES256 via JWKS — use cryptography directly (python-jose 3.5 + cryptography 42+
    # has a P1363/DER incompatibility that silently rejects valid Supabase tokens)
    keys = await _fetch_jwks()
    for key in keys:
        if key.get("kty") != "EC" or key.get("crv") != "P-256":
            continue
        try:
            pub_key = _build_ec_public_key(key)
            return _verify_es256_jwt(token, pub_key, audience="authenticated")
        except ValueError as e:
            logger.warning("ES256 verification failed for kid=%s: %s", key.get("kid"), e)
            continue
        except Exception as e:
            logger.warning("ES256 key error for kid=%s: %s", key.get("kid"), e)
            continue

    logger.warning("JWT verification failed: no valid key matched")
    raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = await _decode_token(credentials.credentials)
    user_id = payload.get("sub")
    hotel_id = payload.get("hotel_id")
    role = payload.get("user_role") or payload.get("role", "none")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token claims")
    if not hotel_id:
        pending = payload.get("pending_invite", False)
        detail = (
            "Your invitation is pending. Please accept your staff invitation before signing in."
            if pending
            else "No hotel associated with your account. Contact your manager."
        )
        raise HTTPException(status_code=403, detail=detail)

    return CurrentUser(
        user_id=user_id,
        hotel_id=hotel_id,
        role=role,
        email=payload.get("email", ""),
    )


async def get_current_user_no_hotel(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
) -> CurrentUser:
    """Auth dependency for endpoints that run before a hotel exists (e.g. POST /hotels)."""
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = await _decode_token(credentials.credentials)
    user_id = payload.get("sub")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token claims")

    return CurrentUser(
        user_id=user_id,
        hotel_id=payload.get("hotel_id", ""),
        role=payload.get("user_role") or payload.get("role", "none"),
        email=payload.get("email", ""),
    )


def require_role(*roles: str):
    """Role-based access control dependency."""
    async def check_role(
        current_user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{current_user.role}' is not authorized for this action",
            )
        return current_user

    return check_role
