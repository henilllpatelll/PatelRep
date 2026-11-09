"""In-memory stand-in for the shift-summary claim RPCs (migration 236).

It mirrors the SQL decision table so unit tests can exercise cron/manual/concurrent
behaviour without a database. The SQL itself is proven against a real migrated
Postgres in tests/integration/test_shift_summary_claims.py. A lock models the row
lock Postgres takes, so concurrent callers serialise exactly as they do there.
"""
import threading
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from services.ai import shift_summary_claims


class FakeClaimStore:
    def __init__(self, summary_exists=None):
        self.rows: dict[tuple, dict] = {}
        self.lock = threading.Lock()
        self.now = lambda: datetime.now(timezone.utc)
        self.summary_exists = summary_exists or (lambda *_k: False)
        self.calls: list[tuple[str, dict]] = []
        self.charges: dict[str, float] = {}  # claim_token -> credits (the PRIMARY KEY on claim_token)

    def rpc(self, name, params):
        self.calls.append((name, params))
        handler = getattr(self, "_" + name)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=handler(**params)))

    def _claim_shift_summary_generation(self, p_tenant_id, p_shift_id, p_shift_date, p_claimed_by=None,
                                        p_lease_seconds=300, p_max_attempts=3, p_retry_after_seconds=900,
                                        p_replace_existing=False, p_ignore_retry_limits=False):
        key = (p_tenant_id, p_shift_id, p_shift_date)
        with self.lock:
            now = self.now()
            if not p_replace_existing and self.summary_exists(*key):
                return {"claimed": False, "reason": "already_generated"}
            lease = now + timedelta(seconds=max(p_lease_seconds, 1))
            token = str(uuid.uuid4())
            row = self.rows.get(key)
            if row is None:
                self.rows[key] = {"status": "claimed", "token": token, "attempts": 1,
                                  "lease": lease, "completed_at": None, "last_error": None}
                return {"claimed": True, "reason": "claimed", "claim_token": token, "attempts": 1}
            if row["status"] == "claimed" and row["lease"] > now:
                return {"claimed": False, "reason": "in_progress", "attempts": row["attempts"]}
            if row["status"] == "succeeded":
                if not p_replace_existing:
                    return {"claimed": False, "reason": "already_generated", "attempts": row["attempts"]}
                row.update(status="claimed", token=token, attempts=1, lease=lease, completed_at=None, last_error=None)
                return {"claimed": True, "reason": "claimed", "claim_token": token, "attempts": 1}
            if not p_ignore_retry_limits:
                if row["attempts"] >= p_max_attempts:
                    return {"claimed": False, "reason": "retry_exhausted", "attempts": row["attempts"],
                            "last_error": row["last_error"]}
                if (row["status"] == "failed" and row["completed_at"]
                        and row["completed_at"] + timedelta(seconds=max(p_retry_after_seconds, 0)) > now):
                    return {"claimed": False, "reason": "backoff", "attempts": row["attempts"],
                            "last_error": row["last_error"]}
            row.update(status="claimed", token=token, attempts=row["attempts"] + 1, lease=lease, completed_at=None)
            return {"claimed": True, "reason": "claimed", "claim_token": token, "attempts": row["attempts"]}

    def _shift_summary_claim_owned(self, p_tenant_id, p_shift_id, p_shift_date, p_claim_token):
        with self.lock:
            row = self.rows.get((p_tenant_id, p_shift_id, p_shift_date))
            return bool(row and row["token"] == p_claim_token and row["status"] == "claimed")

    def _complete_shift_summary_generation(self, p_tenant_id, p_shift_id, p_shift_date, p_claim_token,
                                           p_succeeded, p_error=None):
        with self.lock:
            row = self.rows.get((p_tenant_id, p_shift_id, p_shift_date))
            if not (row and row["token"] == p_claim_token and row["status"] == "claimed"):
                return False
            row.update(status="succeeded" if p_succeeded else "failed", completed_at=self.now(),
                       last_error=None if p_succeeded else (p_error or "unknown error")[:500])
            return True


    def _renew_shift_summary_claim(self, p_tenant_id, p_shift_id, p_shift_date, p_claim_token, p_lease_seconds=300):
        with self.lock:
            row = self.rows.get((p_tenant_id, p_shift_id, p_shift_date))
            if not (row and row["token"] == p_claim_token and row["status"] == "claimed" and row["lease"] > self.now()):
                return False
            row["lease"] = self.now() + timedelta(seconds=max(p_lease_seconds, 1))
            return True

    def _finalize_shift_summary_generation(self, p_tenant_id, p_shift_id, p_shift_date, p_claim_token, p_summary,
                                           p_credits, p_replace_existing=False, p_base_fee_cents=9900):
        """Mirror of finalize_shift_summary_generation(): verify token + status + unexpired lease, write the summary,
        debit once per claim token, mark succeeded -- under one lock, all or nothing."""
        from services.ai import shift_summary  # the db the test installed

        db = shift_summary.supabase
        key = (p_tenant_id, p_shift_id, p_shift_date)
        with self.lock:
            row = self.rows.get(key)
            if row is None or row["token"] != p_claim_token:
                return {"finalized": False, "reason": "claim_lost"}
            if row["status"] == "succeeded":
                return {"finalized": False, "reason": "already_finalized"}
            if row["status"] != "claimed":
                return {"finalized": False, "reason": "claim_lost"}
            if row["lease"] <= self.now():
                return {"finalized": False, "reason": "lease_expired"}
            if not p_replace_existing and self.summary_exists(*key):
                return {"finalized": False, "reason": "already_generated"}
            payload = {"tenant_id": p_tenant_id, "shift_id": p_shift_id, "shift_date": p_shift_date,
                       "department_id": p_summary.get("department_id"), "summary_text": p_summary["summary_text"],
                       "stats": p_summary.get("stats", {}), "handoff_data": p_summary.get("handoff_data", {}),
                       "generated_at": p_summary.get("generated_at"), "updated_at": p_summary.get("generated_at")}
            if p_replace_existing:
                payload.update(acknowledged_by=None, acknowledged_at=None)
            saved = db.table("shift_summaries").upsert(payload, on_conflict="tenant_id,shift_id,shift_date").execute()
            summary = (saved.data or [payload])[0]
            if p_claim_token not in self.charges:
                self.charges[p_claim_token] = p_credits
                if p_credits and p_credits > 0:
                    db.rpc("increment_credits_used", {"p_hotel_id": p_tenant_id, "p_credits": p_credits}).execute()
            row.update(status="succeeded", completed_at=self.now(), last_error=None)
            return {"finalized": True, "reason": "finalized", "charged": True, "summary": summary}


@pytest.fixture
def fake_shift_claims(monkeypatch):
    store = FakeClaimStore()
    monkeypatch.setattr(shift_summary_claims, "supabase", store)
    return store
