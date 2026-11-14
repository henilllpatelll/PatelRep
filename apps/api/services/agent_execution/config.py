"""Worker configuration (environment variables prefixed ``AGENT_WORKER_``). Every default is the safe one.

The worker processes nothing unless BOTH ``AGENT_WORKER_ENABLED=true`` and ``AGENT_WORKER_SYNTHETIC_ENABLED=true`` are
set AND ``APP_ENV`` is development/test/staging. In production it refuses to process work regardless of flags, because
H1 has nothing a production worker may run. Database credentials come from the shared API settings
(``SUPABASE_URL`` / ``SUPABASE_SERVICE_ROLE_KEY``), which a deployment keeps in its managed environment variables.
"""
from __future__ import annotations

import os
import re
import socket
import uuid

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_WORKER_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")


def default_worker_id() -> str:
    host = re.sub(r"[^A-Za-z0-9.-]", "-", socket.gethostname())[:40] or "worker"
    return f"{host}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENT_WORKER_", extra="ignore")

    enabled: bool = False
    synthetic_enabled: bool = False
    worker_id: str = Field(default_factory=default_worker_id)
    concurrency: int = Field(default=2, ge=1, le=16)
    lease_seconds: int = Field(default=60, ge=10, le=900)
    vt_margin_seconds: int = Field(default=15, ge=1, le=300)
    poll_interval_seconds: float = Field(default=1.0, ge=0.05, le=60)
    max_idle_seconds: float = Field(default=10.0, ge=0.1, le=300)
    recovery_interval_seconds: float = Field(default=30.0, ge=1, le=3600)
    liveness_interval_seconds: float = Field(default=15.0, ge=1, le=300)
    blocked_retry_seconds: int = Field(default=30, ge=1, le=3600)
    poison_read_ct: int = Field(default=10, ge=2, le=100)
    recovery_batch: int = Field(default=100, ge=1, le=1000)

    @field_validator("worker_id")
    @classmethod
    def _valid_worker_id(cls, value: str) -> str:
        if not _WORKER_ID_RE.match(value):
            raise ValueError("AGENT_WORKER_WORKER_ID must match ^[A-Za-z0-9._:-]{1,100}$")
        return value

    @property
    def heartbeat_interval_seconds(self) -> float:
        """Renew the lease well before it expires (three chances per lease)."""
        return self.lease_seconds / 3.0
