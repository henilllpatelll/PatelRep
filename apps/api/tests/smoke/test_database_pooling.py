from types import SimpleNamespace

import core.database as database


def test_supabase_client_is_singleton_with_bounded_options(monkeypatch):
    calls = []

    def fake_create_client(url, key, options):
        calls.append((url, key, options))
        return SimpleNamespace(
            postgrest=SimpleNamespace(aclose=lambda: None),
            storage=SimpleNamespace(aclose=lambda: None),
            auth=SimpleNamespace(close=lambda: None),
        )

    monkeypatch.setattr(database, "_supabase_client", None)
    monkeypatch.setattr(database, "create_client", fake_create_client)
    monkeypatch.setattr(
        database.settings, "supabase_url", "https://example.supabase.co"
    )
    monkeypatch.setattr(database.settings, "supabase_service_role_key", "service-key")
    monkeypatch.setattr(database.settings, "supabase_http_timeout_seconds", 12.5)
    monkeypatch.setattr(database.settings, "supabase_storage_timeout_seconds", 8.0)

    first = database.get_supabase()
    second = database.get_supabase()

    assert first is second
    assert len(calls) == 1
    assert calls[0][0] == "https://example.supabase.co"
    assert calls[0][1] == "service-key"
    assert calls[0][2].auto_refresh_token is False
    assert calls[0][2].persist_session is False
    assert calls[0][2].postgrest_client_timeout == 12.5
    assert calls[0][2].storage_client_timeout == 8.0


def test_close_supabase_releases_underlying_clients(monkeypatch):
    closed = []
    fake_client = SimpleNamespace(
        postgrest=SimpleNamespace(aclose=lambda: closed.append("postgrest")),
        storage=SimpleNamespace(aclose=lambda: closed.append("storage")),
        auth=SimpleNamespace(close=lambda: closed.append("auth")),
    )
    monkeypatch.setattr(database, "_supabase_client", fake_client)

    database.close_supabase()

    assert closed == ["postgrest", "storage", "auth"]
    assert database._supabase_client is None
