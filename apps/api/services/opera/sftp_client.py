import base64
import hashlib
import hmac
import io
import logging
from datetime import datetime, timezone

import paramiko

from core.config import settings

logger = logging.getLogger(__name__)

# Environments that may connect to a host whose key is not pinned. Everything
# else (staging, production) is fail-closed: no pinned fingerprint, no connection.
UNPINNED_HOST_KEY_ENVIRONMENTS = frozenset({"development", "test"})


class SftpConnectionError(Exception):
    """Base class for every SFTP failure. Callers may catch this for any of them."""


class SftpAuthError(SftpConnectionError):
    """The server rejected the configured credentials."""


class SftpTimeoutError(SftpConnectionError):
    """The connection, banner exchange, or authentication timed out."""


class SftpHostKeyError(SftpConnectionError):
    """The server's host key is not pinned or does not match the pinned fingerprint."""


class SftpListError(SftpConnectionError):
    """The connection worked but the remote directory could not be listed."""


class SftpDownloadError(SftpConnectionError):
    """One remote file could not be downloaded (retryable)."""


def host_key_fingerprints(key: paramiko.PKey) -> dict[str, str]:
    """Fingerprints of a host key in the formats operators commonly have."""
    blob = key.asbytes()
    md5_hex = hashlib.md5(blob, usedforsecurity=False).hexdigest()  # fingerprint format only
    sha256_b64 = base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")
    return {"md5": md5_hex, "sha256": sha256_b64}


def _normalize_pinned(value: str) -> tuple[str, str]:
    """Return (algorithm, normalized value) for a pinned fingerprint string.

    Accepts OpenSSH ``SHA256:<base64>`` and ``MD5:aa:bb:..`` forms as well as bare
    colon-separated or plain hex MD5 (the format this integration originally stored).
    """
    raw = value.strip()
    upper = raw.upper()
    if upper.startswith("SHA256:"):
        return "sha256", raw[7:].rstrip("=")
    if upper.startswith("MD5:"):
        raw = raw[4:]
    return "md5", raw.replace(":", "").lower()


def verify_host_key(key: paramiko.PKey, pinned: str | None, host: str | None = None) -> None:
    """Raise SftpHostKeyError unless ``key`` matches the pinned fingerprint.

    An unpinned host is only tolerated in development/test. The presented
    fingerprint is public information and is included in the error so an operator
    can verify it out-of-band and pin it.
    """
    presented = host_key_fingerprints(key)
    shown = f"SHA256:{presented['sha256']}"
    if not pinned:
        if settings.app_env in UNPINNED_HOST_KEY_ENVIRONMENTS:
            logger.warning("No sftp_host_key_fingerprint pinned for host=%s; accepting host key (%s environment only)",
                           host, settings.app_env)
            return
        raise SftpHostKeyError(
            f"SFTP host key is not pinned. Verify the server's fingerprint ({shown}) "
            "and save it as the host key fingerprint to enable this connection."
        )
    algorithm, expected = _normalize_pinned(pinned)
    actual = presented["sha256"] if algorithm == "sha256" else presented["md5"]
    if not hmac.compare_digest(actual.encode(), expected.encode()):
        raise SftpHostKeyError(f"SFTP host key fingerprint mismatch (server presented {shown})")


class _PinnedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    """Verify the host key during the handshake, BEFORE any credentials are sent."""

    def __init__(self, pinned: str | None):
        self._pinned = pinned

    def missing_host_key(self, client, hostname, key):
        verify_host_key(key, self._pinned, hostname)


def _load_private_key(private_key_pem: str) -> paramiko.PKey:
    for key_cls in (paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey):
        try:
            return key_cls.from_private_key(io.StringIO(private_key_pem))
        except paramiko.SSHException:
            continue
    raise SftpConnectionError("Could not parse sftp_private_key (unsupported key format)")


def _open_sftp(creds: dict) -> tuple[paramiko.SSHClient, paramiko.SFTPClient]:
    """Open an SSH+SFTP connection using key auth first, then password.

    Host identity is verified inside the SSH handshake (see _PinnedHostKeyPolicy)
    so credentials are never sent to an unverified server. Every failure is raised
    as a typed SftpConnectionError subclass; nothing is swallowed here.
    """
    host = creds.get("sftp_host")
    port = creds.get("sftp_port", 22)
    username = creds.get("sftp_username")
    password = creds.get("sftp_password")
    private_key_pem = creds.get("sftp_private_key")
    pinned = creds.get("sftp_host_key_fingerprint")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(_PinnedHostKeyPolicy(pinned))

    try:
        common = dict(hostname=host, port=port, username=username,
                      timeout=15.0, banner_timeout=15.0, auth_timeout=15.0,
                      allow_agent=False, look_for_keys=False)
        if private_key_pem:
            client.connect(pkey=_load_private_key(private_key_pem), **common)
        else:
            client.connect(password=password, **common)

        # Defense in depth: confirm the negotiated key even if a policy hook was bypassed.
        transport = client.get_transport()
        remote_key = transport.get_remote_server_key() if transport else None
        if remote_key is not None:
            verify_host_key(remote_key, pinned, host)
        return client, client.open_sftp()
    except SftpConnectionError:
        client.close()
        raise
    except paramiko.AuthenticationException as exc:
        client.close()
        raise SftpAuthError("SFTP authentication failed") from exc
    except (TimeoutError, OSError) as exc:
        client.close()
        if isinstance(exc, TimeoutError) or "timed out" in str(exc).lower():
            raise SftpTimeoutError("SFTP connection timed out") from exc
        raise SftpConnectionError(f"SFTP connection failed: {type(exc).__name__}") from exc
    except paramiko.SSHException as exc:
        client.close()
        if "timed out" in str(exc).lower():
            raise SftpTimeoutError("SFTP connection timed out") from exc
        raise SftpConnectionError(f"SFTP connection failed: {exc}") from exc
    except Exception as exc:
        client.close()
        raise SftpConnectionError(f"SFTP connection failed: {type(exc).__name__}") from exc


def test_connection(creds: dict) -> None:
    """Fail-fast connectivity check. Raises SftpConnectionError (or a subclass) on any failure."""
    client, sftp = _open_sftp(creds)
    try:
        sftp.listdir(creds.get("sftp_remote_path", "/"))
    except Exception as exc:
        raise SftpListError(f"SFTP directory listing failed: {type(exc).__name__}") from exc
    finally:
        sftp.close()
        client.close()


def list_report_files(creds: dict) -> list[dict]:
    """List files in the configured remote path.

    An empty list means the directory was listed successfully and is empty. Any
    connection, authentication, host-key, timeout, or listing failure raises a
    SftpConnectionError subclass so the caller can tell an outage from an empty
    folder. Per-tenant isolation is the caller's job (see sync_report_files).
    """
    remote_path = creds.get("sftp_remote_path", "/")
    client, sftp = _open_sftp(creds)
    try:
        entries = []
        for attr in sftp.listdir_attr(remote_path):
            entries.append({
                "filename": attr.filename,
                "mtime": datetime.fromtimestamp(attr.st_mtime, tz=timezone.utc) if attr.st_mtime else None,
                "size": attr.st_size,
            })
        return entries
    except Exception as exc:
        raise SftpListError(f"SFTP directory listing failed: {type(exc).__name__}") from exc
    finally:
        sftp.close()
        client.close()


def download_file(creds: dict, remote_filename: str) -> bytes:
    """Download one file's bytes. Raises SftpConnectionError (SftpDownloadError for read failures)."""
    remote_path = creds.get("sftp_remote_path", "/").rstrip("/")
    full_path = f"{remote_path}/{remote_filename}"
    client, sftp = _open_sftp(creds)
    try:
        with sftp.open(full_path, "rb") as f:
            return f.read()
    except Exception as exc:
        raise SftpDownloadError(f"SFTP download failed: {type(exc).__name__}") from exc
    finally:
        sftp.close()
        client.close()
