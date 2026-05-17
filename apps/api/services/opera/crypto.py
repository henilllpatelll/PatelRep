import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from core.config import settings


ENVELOPE_PREFIX = "enc:v1:"
SECRET_FIELDS = ("integration_password", "access_token", "refresh_token")


def _fernet() -> Fernet:
    key = settings.opera_credential_encryption_key.strip()
    if not key:
        if settings.app_env == "production":
            raise RuntimeError("OPERA_CREDENTIAL_ENCRYPTION_KEY is required in production")
        digest = hashlib.sha256(f"patelrep-opera:{settings.supabase_jwt_secret}".encode()).digest()
        key = base64.urlsafe_b64encode(digest).decode()
    return Fernet(key.encode())


def encrypt_secret(value: str | None) -> str | None:
    if value is None or value == "":
        return value
    if value.startswith(ENVELOPE_PREFIX):
        return value
    token = _fernet().encrypt(value.encode()).decode()
    return f"{ENVELOPE_PREFIX}{token}"


def decrypt_secret(value: str | None) -> str | None:
    if value is None or value == "":
        return value
    if not value.startswith(ENVELOPE_PREFIX):
        return value
    token = value.removeprefix(ENVELOPE_PREFIX)
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Could not decrypt OPERA credential") from exc


def encrypt_opera_secrets(row: dict) -> dict:
    encrypted = dict(row)
    for field in SECRET_FIELDS:
        if field in encrypted:
            encrypted[field] = encrypt_secret(encrypted[field])
    return encrypted


def decrypt_opera_secrets(row: dict | None) -> dict | None:
    if not row:
        return row
    decrypted = dict(row)
    for field in SECRET_FIELDS:
        if field in decrypted:
            decrypted[field] = decrypt_secret(decrypted[field])
    return decrypted
