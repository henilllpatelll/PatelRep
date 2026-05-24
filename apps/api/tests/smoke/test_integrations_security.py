from types import SimpleNamespace

import httpx
import pytest

from middleware.auth import CurrentUser
from models.requests import OperaConnectRequest
from routers import integrations as integrations_router
from services.opera.crypto import ENVELOPE_PREFIX


USER = CurrentUser(user_id="user-a-1", hotel_id="hotel-a", role="gm", email="gm@example.com")
OPERA_SECRET = "opera" + "-password"


class FakeOperaDB:
    def __init__(self):
        self.rows = {"opera_credentials": []}
        self.upserts = []

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.payload = {}

    def upsert(self, payload, **_kwargs):
        self.payload = payload
        return self

    def execute(self):
        row = {"id": f"{self.table_name}-{len(self.db.rows[self.table_name]) + 1}", **self.payload}
        self.db.rows[self.table_name].append(row)
        self.db.upserts.append((self.table_name, row))
        return SimpleNamespace(data=[row])


def _body() -> OperaConnectRequest:
    return OperaConnectRequest(
        ohip_base_url="https://ohip.example.com/",
        hotel_id_opera="SAND01",
        integration_username="opera-user",
        integration_password=OPERA_SECRET,
    )


@pytest.mark.asyncio
async def test_opera_connect_uses_credential_based_flow(monkeypatch):
    db = FakeOperaDB()
    bootstrapped = []
    monkeypatch.setattr(integrations_router, "supabase", db)
    monkeypatch.setattr(
        integrations_router,
        "acquire_new_token",
        lambda base_url, username, password: {
            "access_token": f"access:{base_url}:{username}:{password}",
            "refresh_token": "refresh-token",
            "expires_in": 3600,
        },
    )
    monkeypatch.setattr(integrations_router, "bootstrap_opera_data", lambda hotel_id: bootstrapped.append(hotel_id))

    response = await integrations_router.opera_connect(body=_body(), current_user=USER)

    assert response["data"]["connected"] is True
    assert bootstrapped == ["hotel-a"]
    assert db.upserts[0][0] == "opera_credentials"
    stored = db.upserts[0][1]
    assert stored["tenant_id"] == "hotel-a"
    assert stored["ohip_base_url"] == "https://ohip.example.com"
    assert stored["hotel_id_opera"] == "SAND01"
    assert stored["integration_password"] != OPERA_SECRET
    assert stored["integration_password"].startswith(ENVELOPE_PREFIX)
    assert stored["access_token"] != f"access:https://ohip.example.com:opera-user:{OPERA_SECRET}"
    assert stored["access_token"].startswith(ENVELOPE_PREFIX)
    assert stored["refresh_token"] != "refresh-token"
    assert stored["refresh_token"].startswith(ENVELOPE_PREFIX)
    assert stored["is_connected"] is True


def test_get_opera_credentials_decrypts_stored_secrets(monkeypatch):
    encrypted_row = integrations_router.encrypt_opera_secrets({
        "tenant_id": "hotel-a",
        "is_connected": True,
        "integration_password": OPERA_SECRET,
        "access_token": "access-token",
        "refresh_token": "refresh-token",
    })

    class SelectQuery:
        def select(self, *_args, **_kwargs):
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def maybe_single(self):
            return self

        def execute(self):
            return SimpleNamespace(data=encrypted_row)

    monkeypatch.setattr(integrations_router, "supabase", SimpleNamespace(table=lambda _name: SelectQuery()))
    monkeypatch.setattr("services.opera.auth.supabase", SimpleNamespace(table=lambda _name: SelectQuery()))

    creds = integrations_router.get_opera_credentials("hotel-a")

    assert creds["integration_password"] == OPERA_SECRET
    assert creds["access_token"] == "access-token"
    assert creds["refresh_token"] == "refresh-token"


@pytest.mark.asyncio
async def test_opera_connect_returns_controlled_error_for_bad_credentials(monkeypatch):
    db = FakeOperaDB()
    response = httpx.Response(401, request=httpx.Request("POST", "https://ohip.example.com/oauth/v1/tokens"))
    monkeypatch.setattr(integrations_router, "supabase", db)
    monkeypatch.setattr(
        integrations_router,
        "acquire_new_token",
        lambda *_args: (_ for _ in ()).throw(httpx.HTTPStatusError("unauthorized", request=response.request, response=response)),
    )

    with pytest.raises(Exception) as exc:
        await integrations_router.opera_connect(body=_body(), current_user=USER)

    assert getattr(exc.value, "status_code", None) == 400
    assert "401" in exc.value.detail
    assert db.upserts == []


@pytest.mark.asyncio
async def test_opera_connect_returns_safe_error_for_unreachable_ohip(monkeypatch):
    db = FakeOperaDB()
    monkeypatch.setattr(integrations_router, "supabase", db)
    monkeypatch.setattr(
        integrations_router,
        "acquire_new_token",
        lambda *_args: (_ for _ in ()).throw(httpx.ConnectTimeout("network-secret-detail")),
    )

    with pytest.raises(Exception) as exc:
        await integrations_router.opera_connect(body=_body(), current_user=USER)

    assert getattr(exc.value, "status_code", None) == 503
    assert "network-secret-detail" not in exc.value.detail
    assert db.upserts == []
