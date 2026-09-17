"""Clean-sessions hotel-local timezone regression test.

`_get_hotel_tz` here previously queried a non-existent `hotels` table (there is
no such table in this schema — see supabase/migrations/002_tenants.sql; the
real table is `tenants`). PostgREST returns PGRST205 for that lookup, silently
swallowed by this function's own try/except, so every hotel's real configured
timezone was ignored and `/clean-sessions/summary` always used the hardcoded
"America/Chicago" fallback regardless of the tenant's actual timezone.

Mirrors the FakeDB + TestClient + real-JWT harness in test_logbook_timezone.py.
"""

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import clean_sessions as clean_sessions_router
from tests.smoke.fake_supabase import FakeDB


def _auth_header(role: str = "housekeeper", hotel_id: str = "hotel-a", user_id: str = "hk-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def test_summary_date_window_uses_tenants_table_timezone_not_hardcoded_default(monkeypatch):
    """A session at 2026-08-02T05:30:00Z falls in Denver's (UTC-6 MDT) Aug 1 local
    day [Aug1 06:00Z, Aug2 06:00Z), but in Chicago's (UTC-5 CDT, the old hardcoded
    default) Aug 2 local day [Aug2 05:00Z, Aug3 05:00Z) -- only a real `tenants`
    timezone lookup puts it under ?date=2026-08-01."""
    db = FakeDB({
        "tenants": [{"id": "hotel-a", "timezone": "America/Denver"}],
        "room_clean_sessions": [{
            "id": "sess-1",
            "tenant_id": "hotel-a",
            "housekeeper_id": "hk-1",
            "status": "completed",
            "started_at": "2026-08-02T05:30:00+00:00",
            "duration_seconds": 900,
            "base_clean_minutes": 20,
        }],
    })
    monkeypatch.setattr(clean_sessions_router, "supabase", db)
    client = TestClient(app)

    denver_day = client.get(
        "/v1/clean-sessions/summary",
        params={"date": "2026-08-01"},
        headers=_auth_header(),
    )
    old_default_day = client.get(
        "/v1/clean-sessions/summary",
        params={"date": "2026-08-02"},
        headers=_auth_header(),
    )

    assert denver_day.status_code == 200
    assert denver_day.json()["data"]["completed_count"] == 1

    assert old_default_day.status_code == 200
    assert old_default_day.json()["data"]["completed_count"] == 0
