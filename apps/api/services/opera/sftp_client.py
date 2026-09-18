import io
import logging
from datetime import datetime, timezone

import paramiko

logger = logging.getLogger(__name__)


class SftpConnectionError(Exception):
    """Raised by the fail-fast connection helpers (test_connection)."""


def _open_sftp(creds: dict) -> tuple[paramiko.SSHClient, paramiko.SFTPClient]:
    """Open an SSH+SFTP connection using key auth first, then password.

    Host-key verification uses the pinned `sftp_host_key_fingerprint` when set;
    otherwise falls back to auto-accepting the remote host key (logged as a
    warning -- a known gap to close once a pilot hotel's fingerprint is known).
    """
    host = creds.get("sftp_host")
    port = creds.get("sftp_port", 22)
    username = creds.get("sftp_username")
    password = creds.get("sftp_password")
    private_key_pem = creds.get("sftp_private_key")
    fingerprint = creds.get("sftp_host_key_fingerprint")

    client = paramiko.SSHClient()
    if fingerprint:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
    else:
        logger.warning("No sftp_host_key_fingerprint pinned for host=%s; auto-accepting host key", host)
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        if private_key_pem:
            pkey = None
            for key_cls in (paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey):
                try:
                    pkey = key_cls.from_private_key(io.StringIO(private_key_pem))
                    break
                except paramiko.SSHException:
                    continue
            if pkey is None:
                raise SftpConnectionError("Could not parse sftp_private_key (unsupported key format)")
            client.connect(
                hostname=host, port=port, username=username, pkey=pkey,
                timeout=15.0, banner_timeout=15.0, auth_timeout=15.0,
            )
        else:
            client.connect(
                hostname=host, port=port, username=username, password=password,
                timeout=15.0, banner_timeout=15.0, auth_timeout=15.0,
            )

        if fingerprint:
            remote_key = client.get_transport().get_remote_server_key()
            actual = remote_key.get_fingerprint().hex()
            if actual.lower() != fingerprint.replace(":", "").lower():
                client.close()
                raise SftpConnectionError("SFTP host key fingerprint mismatch")

        sftp = client.open_sftp()
        return client, sftp
    except SftpConnectionError:
        raise
    except Exception as exc:
        client.close()
        raise SftpConnectionError(str(exc)) from exc


def test_connection(creds: dict) -> None:
    """Fail-fast connectivity check. Raises SftpConnectionError on any failure."""
    client, sftp = _open_sftp(creds)
    try:
        sftp.listdir(creds.get("sftp_remote_path", "/"))
    except Exception as exc:
        raise SftpConnectionError(str(exc)) from exc
    finally:
        sftp.close()
        client.close()


def list_report_files(creds: dict) -> list[dict]:
    """List files in the configured remote path.

    Fail-safe: swallows connection/listing errors and returns [] so one
    tenant's SFTP outage never aborts the cron loop over all tenants (mirrors
    services/opera/sync.py's ohip_request convention).
    """
    remote_path = creds.get("sftp_remote_path", "/")
    try:
        client, sftp = _open_sftp(creds)
    except SftpConnectionError as exc:
        logger.warning("SFTP list_report_files connection failed: %s", exc)
        return []

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
        logger.warning("SFTP list_report_files listing failed: %s", exc)
        return []
    finally:
        sftp.close()
        client.close()


def download_file(creds: dict, remote_filename: str) -> bytes | None:
    """Download one file's bytes. Fail-safe: returns None on any failure."""
    remote_path = creds.get("sftp_remote_path", "/").rstrip("/")
    full_path = f"{remote_path}/{remote_filename}"
    try:
        client, sftp = _open_sftp(creds)
    except SftpConnectionError as exc:
        logger.warning("SFTP download_file connection failed: %s", exc)
        return None

    try:
        with sftp.open(full_path, "rb") as f:
            return f.read()
    except Exception as exc:
        logger.warning("SFTP download_file failed for %s: %s", full_path, exc)
        return None
    finally:
        sftp.close()
        client.close()
