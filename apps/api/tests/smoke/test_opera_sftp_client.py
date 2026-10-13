"""SFTP client contracts: typed failures, empty-vs-error, and fail-closed host identity.

No real network access -- paramiko is replaced by in-memory fakes that follow the
real handshake order (host-key policy runs BEFORE authentication). This proves our
logic only; it cannot verify behavior against a real Opera Cloud SFTP server, since
no live SFTP credentials exist in this environment (see project CLAUDE.md).
"""
import hashlib
import base64
import logging
import socket
from types import SimpleNamespace

import paramiko
import pytest

from services.opera import sftp_client
from services.opera.sftp_client import (
    SftpAuthError,
    SftpConnectionError,
    SftpDownloadError,
    SftpHostKeyError,
    SftpListError,
    SftpTimeoutError,
)

PASSWORD = "s3cr3t-pw-DO-NOT-LOG"
CREDS = {
    "sftp_host": "sftp.example.com",
    "sftp_port": 22,
    "sftp_username": "opera",
    "sftp_password": PASSWORD,
    "sftp_remote_path": "/reports",
}
SERVER_KEY = paramiko.ECDSAKey.generate()
OTHER_KEY = paramiko.ECDSAKey.generate()


def _md5(key):
    return hashlib.md5(key.asbytes(), usedforsecurity=False).hexdigest()


def _sha256(key):
    return "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")


class FakeSFTP:
    def __init__(self, entries=None, list_error=None, files=None, open_error=None):
        self.entries = entries or []
        self.list_error = list_error
        self.files = files or {}
        self.open_error = open_error
        self.closed = False

    def listdir(self, path):
        if self.list_error:
            raise self.list_error
        return [e.filename for e in self.entries]

    def listdir_attr(self, path):
        if self.list_error:
            raise self.list_error
        return self.entries

    def open(self, path, mode="rb"):
        if self.open_error:
            raise self.open_error
        data = self.files[path]

        class _F:
            def __enter__(s):
                return s

            def __exit__(s, *a):
                return False

            def read(s):
                return data

        return _F()

    def close(self):
        self.closed = True


def make_client(server_key=SERVER_KEY, connect_error=None, sftp=None):
    """Build a fake paramiko.SSHClient class that mirrors connect(): policy, then auth."""

    class FakeSSHClient:
        instances = []

        def __init__(self, *a, **k):
            self.policy = None
            self.authenticated = False
            self.connect_kwargs = None
            self.closed = False
            FakeSSHClient.instances.append(self)

        def set_missing_host_key_policy(self, policy):
            self.policy = policy

        def connect(self, **kwargs):
            if connect_error is not None and not callable(connect_error):
                raise connect_error
            self.policy.missing_host_key(self, kwargs["hostname"], server_key)  # may raise
            if callable(connect_error):
                raise connect_error()
            self.connect_kwargs = kwargs
            self.authenticated = True

        def get_transport(self):
            return SimpleNamespace(get_remote_server_key=lambda: server_key)

        def open_sftp(self):
            return sftp or FakeSFTP()

        def close(self):
            self.closed = True

    return FakeSSHClient


@pytest.fixture(autouse=True)
def _env_test(monkeypatch):
    monkeypatch.setattr(sftp_client, "settings", SimpleNamespace(app_env="test"))


def _pinned(**extra):
    return dict(CREDS, sftp_host_key_fingerprint=_md5(SERVER_KEY), **extra)


# ---------------------------------------------------------------------------
# Failure types: every failure is explicit and distinguishable
# ---------------------------------------------------------------------------

def test_authentication_failure_is_explicit(monkeypatch):
    # Authentication happens after the host-key policy: simulate the server rejecting credentials.
    monkeypatch.setattr(paramiko, "SSHClient", make_client(connect_error=lambda: paramiko.AuthenticationException("bad creds")))
    with pytest.raises(SftpAuthError):
        sftp_client.list_report_files(_pinned())
    with pytest.raises(SftpAuthError):
        sftp_client.test_connection(_pinned())


def test_connection_timeout_is_explicit(monkeypatch):
    monkeypatch.setattr(paramiko, "SSHClient", make_client(connect_error=socket.timeout("timed out")))
    with pytest.raises(SftpTimeoutError):
        sftp_client.list_report_files(_pinned())


def test_connection_refused_is_a_connection_error_not_an_empty_list(monkeypatch):
    monkeypatch.setattr(paramiko, "SSHClient", make_client(connect_error=ConnectionRefusedError("refused")))
    with pytest.raises(SftpConnectionError) as exc:
        sftp_client.list_report_files(_pinned())
    assert not isinstance(exc.value, (SftpAuthError, SftpTimeoutError))


def test_remote_listing_failure_is_explicit(monkeypatch):
    fake = FakeSFTP(list_error=OSError("permission denied"))
    monkeypatch.setattr(paramiko, "SSHClient", make_client(sftp=fake))
    with pytest.raises(SftpListError):
        sftp_client.list_report_files(_pinned())
    assert fake.closed


def test_genuinely_empty_directory_is_a_successful_empty_listing(monkeypatch):
    monkeypatch.setattr(paramiko, "SSHClient", make_client(sftp=FakeSFTP(entries=[])))
    assert sftp_client.list_report_files(_pinned()) == []


def test_listing_returns_file_metadata(monkeypatch):
    entry = SimpleNamespace(filename="gibyroom_1.txt", st_mtime=1_700_000_000, st_size=12)
    monkeypatch.setattr(paramiko, "SSHClient", make_client(sftp=FakeSFTP(entries=[entry])))
    files = sftp_client.list_report_files(_pinned())
    assert files[0]["filename"] == "gibyroom_1.txt" and files[0]["size"] == 12 and files[0]["mtime"].year == 2023


def test_download_failure_is_explicit_and_retryable_type(monkeypatch):
    monkeypatch.setattr(paramiko, "SSHClient", make_client(sftp=FakeSFTP(open_error=OSError("gone"))))
    with pytest.raises(SftpDownloadError):
        sftp_client.download_file(_pinned(), "gibyroom_1.txt")


def test_download_returns_bytes(monkeypatch):
    monkeypatch.setattr(paramiko, "SSHClient", make_client(sftp=FakeSFTP(files={"/reports/a.txt": b"abc"})))
    assert sftp_client.download_file(_pinned(), "a.txt") == b"abc"


def test_every_typed_error_is_a_sftp_connection_error():
    for cls in (SftpAuthError, SftpTimeoutError, SftpHostKeyError, SftpListError, SftpDownloadError):
        assert issubclass(cls, SftpConnectionError)


# ---------------------------------------------------------------------------
# Host identity
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fingerprint", [
    _md5(SERVER_KEY),
    ":".join(_md5(SERVER_KEY)[i:i + 2] for i in range(0, 32, 2)),
    "MD5:" + ":".join(_md5(SERVER_KEY)[i:i + 2] for i in range(0, 32, 2)),
    _sha256(SERVER_KEY),
])
def test_matching_fingerprint_formats_are_accepted(monkeypatch, fingerprint):
    client_cls = make_client()
    monkeypatch.setattr(paramiko, "SSHClient", client_cls)
    sftp_client.test_connection(dict(CREDS, sftp_host_key_fingerprint=fingerprint))
    assert client_cls.instances[-1].authenticated


def test_host_key_mismatch_fails_before_credentials_are_sent(monkeypatch):
    client_cls = make_client(server_key=OTHER_KEY)
    monkeypatch.setattr(paramiko, "SSHClient", client_cls)
    with pytest.raises(SftpHostKeyError) as exc:
        sftp_client.test_connection(_pinned())
    assert "mismatch" in str(exc.value)
    client = client_cls.instances[-1]
    assert client.authenticated is False and client.connect_kwargs is None and client.closed
    assert PASSWORD not in str(exc.value)


@pytest.mark.parametrize("env", ["production", "staging"])
def test_missing_fingerprint_is_rejected_outside_dev_and_test(monkeypatch, env):
    monkeypatch.setattr(sftp_client, "settings", SimpleNamespace(app_env=env))
    client_cls = make_client()
    monkeypatch.setattr(paramiko, "SSHClient", client_cls)
    with pytest.raises(SftpHostKeyError) as exc:
        sftp_client.list_report_files(CREDS)
    # Actionable: tells the operator which fingerprint to verify and pin.
    assert "not pinned" in str(exc.value) and _sha256(SERVER_KEY) in str(exc.value)
    assert client_cls.instances[-1].authenticated is False


@pytest.mark.parametrize("env", ["development", "test"])
def test_missing_fingerprint_still_allowed_in_dev_and_test(monkeypatch, env):
    monkeypatch.setattr(sftp_client, "settings", SimpleNamespace(app_env=env))
    client_cls = make_client()
    monkeypatch.setattr(paramiko, "SSHClient", client_cls)
    sftp_client.test_connection(CREDS)
    assert client_cls.instances[-1].authenticated


def test_pinned_key_in_production_connects(monkeypatch):
    monkeypatch.setattr(sftp_client, "settings", SimpleNamespace(app_env="production"))
    client_cls = make_client()
    monkeypatch.setattr(paramiko, "SSHClient", client_cls)
    sftp_client.test_connection(_pinned())
    assert client_cls.instances[-1].authenticated


def test_agent_and_local_keys_are_never_tried(monkeypatch):
    client_cls = make_client()
    monkeypatch.setattr(paramiko, "SSHClient", client_cls)
    sftp_client.test_connection(_pinned())
    kwargs = client_cls.instances[-1].connect_kwargs
    assert kwargs["allow_agent"] is False and kwargs["look_for_keys"] is False


def test_key_auth_preferred_over_password_when_both_configured(monkeypatch):
    client_cls = make_client()
    monkeypatch.setattr(paramiko, "SSHClient", client_cls)
    fake_key = object()
    monkeypatch.setattr(paramiko.RSAKey, "from_private_key", classmethod(lambda cls, f: fake_key))
    creds = _pinned(sftp_private_key="-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----")
    sftp_client.test_connection(creds)
    kwargs = client_cls.instances[-1].connect_kwargs
    assert kwargs["pkey"] is fake_key and "password" not in kwargs


# ---------------------------------------------------------------------------
# Secrets never leak into errors or logs
# ---------------------------------------------------------------------------

def test_failures_do_not_leak_credentials_into_errors_or_logs(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(sftp_client, "settings", SimpleNamespace(app_env="production"))
    key_pem = "-----BEGIN RSA PRIVATE KEY-----\nSUPERSECRETKEYMATERIAL\n-----END RSA PRIVATE KEY-----"
    for client in (
        make_client(server_key=OTHER_KEY),
        make_client(connect_error=lambda: paramiko.AuthenticationException(f"bad {PASSWORD}")),
        make_client(connect_error=socket.timeout(PASSWORD)),
    ):
        monkeypatch.setattr(paramiko, "SSHClient", client)
        with pytest.raises(SftpConnectionError) as exc:
            sftp_client.list_report_files(_pinned(sftp_private_key=None))
        assert PASSWORD not in str(exc.value)
    with pytest.raises(SftpConnectionError) as exc:
        sftp_client.list_report_files(dict(_pinned(), sftp_private_key=key_pem, sftp_password=None))
    assert "SUPERSECRETKEYMATERIAL" not in str(exc.value)
    assert PASSWORD not in caplog.text and "SUPERSECRETKEYMATERIAL" not in caplog.text
