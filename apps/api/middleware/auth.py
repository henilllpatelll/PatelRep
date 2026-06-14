import base64
import logging
import time
import httpx
from dataclasses import dataclass
from typing import Optional
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePublicNumbers, SECP256R1
from cryptography.hazmat.primitives import serialization
from core.config import settings

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

_jwks_cache: list | None = None
_jwks_cache_time: float = 0.0


def _jwk_ec_to_pem(jwk: dict) -> str:
    """Convert an EC P-256 JWK public key to PEM string for python-jose."""
    def _b64url_to_int(val: str) -> int:
        padded = val + "=" * (-len(val) % 4)
        return int.from_bytes(base64.urlsafe_b64decode(padded), "big")

    numbers = EllipticCurvePublicNumbers(
        x=_b64url_to_int(jwk["x"]),
        y=_b64url_to_int(jwk["y"]),
        curve=SECP256R1(),
    )
    pub_key = numbers.public_key()
    return pub_key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()


async def _fetch_jwks() -> list[dict]:
    """Fetch and cache Supabase JWKS keys."""
    global _jwks_cache, _jwks_cache_time
    now = time.time()
    if _jwks_cache is None or (now - _jwks_cache_time) > 3600:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(
                    f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
                )
                _jwks_cache = r.json().get("keys", [])
                _jwks_cache_time = now
        except Exception as e:
            logger.warning("JWKS fetch failed, tokens may not verify: %s", e)
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
            audience="authenticated"
        )
    except JWTError:
        pass
    # Fall back to ES256 via JWKS (newer Supabase projects)
    keys = await _fetch_jwks()
    for key in keys:
        if key.get("kty") != "EC":
            continue
        try:
            pem = _jwk_ec_to_pem(key)
            return jwt.decode(token, pem, algorithms=["ES256"], audience="authenticated")
        except JWTError:
            continue
        except Exception as e:
            logger.warning("ES256 key decode error: %s", e)
            continue
    logger.warning("JWT verification failed: no valid key matched")
    raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security)
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
            if pending else
            "No hotel associated with your account. Contact your manager."
        )
        raise HTTPException(status_code=403, detail=detail)

    return CurrentUser(
        user_id=user_id,
        hotel_id=hotel_id,
        role=role,
        email=payload.get("email", "")
    )


async def get_current_user_no_hotel(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security)
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
        email=payload.get("email", "")
    )


def require_role(*roles: str):
    """Role-based access control dependency."""
    async def check_role(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{current_user.role}' is not authorized for this action"
            )
        return current_user
    return check_role
