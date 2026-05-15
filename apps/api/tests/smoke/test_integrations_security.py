from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from middleware.auth import CurrentUser
from routers import integrations as integrations_router


USER = CurrentUser(user_id="user-a-1", hotel_id="hotel-a", role="gm", email="gm@example.com")


class FakeOperaDB:
    def __init__(self):
        self.rows = {
            "opera_oauth_states": [],
            "opera_credentials": [],
        }
        self.inserts = []
        self.upserts = []
        self.updates = []

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.action = "select"
        self.payload = {}
        self.filters = {}
        self.single = False

    def select(self, *_args, **_kwargs):
        self.action = "select"
        return self

    def insert(self, payload):
        self.action = "insert"
        self.payload = payload
        return self

    def upsert(self, payload, **_kwargs):
        self.action = "upsert"
        self.payload = payload
        return self

    def update(self, payload):
        self.action = "update"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def maybe_single(self):
        self.single = True
        return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        matched = [r for r in rows if all(r.get(k) == v for k, v in self.filters.items())]

        if self.action == "select":
            return SimpleNamespace(data=matched[0] if self.single and matched else matched)

        if self.action == "insert":
            row = {"id": f"{self.table_name}-{len(rows) + 1}", **self.payload}
            rows.append(row)
            self.db.inserts.append((self.table_name, row))
            return SimpleNamespace(data=[row])

        if self.action == "upsert":
            row = {"id": f"{self.table_name}-{len(rows) + 1}", **self.payload}
            rows.append(row)
            self.db.upserts.append((self.table_name, row))
            return SimpleNamespace(data=[row])

        if self.action == "update":
            for row in matched:
                row.update(self.payload)
            self.db.updates.append((self.table_name, self.payload, dict(self.filters)))
            return SimpleNamespace(data=matched)

        return SimpleNamespace(data=[])


@pytest.mark.asyncio
async def test_opera_connect_generates_server_side_nonce(monkeypatch):
    db = FakeOperaDB()
    monkeypatch.setattr(integrations_router, "supabase", db)

    response = await integrations_router.opera_connect(current_user=USER)
    auth_url = response["data"]["auth_url"]
    state = parse_qs(urlparse(auth_url).query)["state"][0]

    assert state != USER.hotel_id
    assert db.inserts[0][0] == "opera_oauth_states"
    assert db.inserts[0][1]["nonce"] == state
    assert db.inserts[0][1]["tenant_id"] == USER.hotel_id
    assert db.inserts[0][1]["user_id"] == USER.user_id


@pytest.mark.asyncio
async def test_opera_callback_rejects_raw_hotel_id_state(monkeypatch):
    db = FakeOperaDB()
    monkeypatch.setattr(integrations_router, "supabase", db)

    response = await integrations_router.opera_callback(code="oauth-code", state="hotel-a", error=None)

    assert response.status_code == 307
    assert "reason=invalid_state" in response.headers["location"]
    assert db.upserts == []


@pytest.mark.asyncio
async def test_opera_callback_uses_valid_nonce_tenant(monkeypatch):
    db = FakeOperaDB()
    db.rows["opera_oauth_states"].append({
        "id": "state-1",
        "tenant_id": "hotel-a",
        "user_id": "user-a-1",
        "nonce": "valid-nonce",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        "used_at": None,
    })
    monkeypatch.setattr(integrations_router, "supabase", db)
    monkeypatch.setattr(integrations_router, "bootstrap_opera_data", lambda _hotel_id: None)

    def fake_post(*_args, **_kwargs):
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "expires_in": 3600,
                "hotel_id": "opera-hotel",
            },
        )

    monkeypatch.setattr(integrations_router.httpx, "post", fake_post)

    response = await integrations_router.opera_callback(code="oauth-code", state="valid-nonce", error=None)

    assert response.status_code == 307
    assert "opera=connected" in response.headers["location"]
    assert db.updates[0][0] == "opera_oauth_states"
    assert db.updates[0][1]["used_at"]
    assert db.upserts[0][0] == "opera_credentials"
    assert db.upserts[0][1]["tenant_id"] == "hotel-a"
