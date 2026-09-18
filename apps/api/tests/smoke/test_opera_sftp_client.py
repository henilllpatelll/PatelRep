"""Connectivity/error-handling SHAPE tests for services/opera/sftp_client.py.

No real network access -- all paramiko calls are monkeypatched. This only
proves the fail-fast (test_connection) vs fail-safe (list_report_files/
download_file) conventions hold; it cannot verify behavior against a real
Opera Cloud SFTP server, since no live SFTP credentials exist in this
environment (see project CLAUDE.md's scope notes).
"""
import paramiko
import pytest

from services.opera import sftp_client
from services.opera.sftp_client import SftpConnectionError


CREDS = {
    "sftp_host": "sftp.example.com",
    "sftp_port": 22,
    "sftp_username": "opera",
    "sftp_password": "secret",
    "sftp_remote_path": "/reports",
}


class _FailingSSHClient:
    def __init__(self, *a, **k):
        pass

    def set_missing_host_key_policy(self, policy):
        pass

    def connect(self, *a, **k):
        raise paramiko.SSHException("connection refused")

    def close(self):
        pass


def test_test_connection_raises_on_failure(monkeypatch):
    monkeypatch.setattr(paramiko, "SSHClient", _FailingSSHClient)

    with pytest.raises(SftpConnectionError):
        sftp_client.test_connection(CREDS)


def test_list_report_files_swallows_failure_and_returns_empty(monkeypatch):
    monkeypatch.setattr(paramiko, "SSHClient", _FailingSSHClient)

    result = sftp_client.list_report_files(CREDS)

    assert result == []


def test_download_file_swallows_failure_and_returns_none(monkeypatch):
    monkeypatch.setattr(paramiko, "SSHClient", _FailingSSHClient)

    result = sftp_client.download_file(CREDS, "report.txt")

    assert result is None


class _FakeSFTP:
    def __init__(self):
        self.closed = False

    def listdir(self, path):
        return []

    def close(self):
        self.closed = True


class _SucceedingSSHClient:
    connect_kwargs = None

    def __init__(self, *a, **k):
        pass

    def set_missing_host_key_policy(self, policy):
        pass

    def connect(self, **kwargs):
        _SucceedingSSHClient.connect_kwargs = kwargs

    def open_sftp(self):
        return _FakeSFTP()

    def close(self):
        pass


def test_key_auth_preferred_over_password_when_both_configured(monkeypatch):
    monkeypatch.setattr(paramiko, "SSHClient", _SucceedingSSHClient)

    fake_key = object()
    monkeypatch.setattr(paramiko.RSAKey, "from_private_key", classmethod(lambda cls, f: fake_key))

    creds = dict(CREDS, sftp_private_key="-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----")
    sftp_client.test_connection(creds)

    assert "pkey" in _SucceedingSSHClient.connect_kwargs
    assert "password" not in _SucceedingSSHClient.connect_kwargs
