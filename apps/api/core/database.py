from __future__ import annotations
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
from core.config import settings

_supabase_client: Client | None = None


def _build_client_options() -> ClientOptions:
    return ClientOptions(
        auto_refresh_token=False,
        persist_session=False,
        postgrest_client_timeout=settings.supabase_http_timeout_seconds,
        storage_client_timeout=settings.supabase_storage_timeout_seconds,
    )


def get_supabase() -> Client:
    """Return the process-wide Supabase client and reuse its HTTP connection pool."""
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
            _build_client_options(),
        )
    return _supabase_client


def get_supabase_user_client(jwt_token: str) -> Client:
    """Returns a Supabase client authenticated as the user (respects RLS)."""
    client = create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
        _build_client_options(),
    )
    client.auth.set_session(jwt_token, "")
    return client


def close_supabase() -> None:
    """Release HTTP clients held by the process-wide Supabase client."""
    global _supabase_client
    client = _supabase_client
    if client is None:
        return

    for attr, close_method in (
        ("postgrest", "aclose"),
        ("storage", "aclose"),
        ("auth", "close"),
    ):
        resource = getattr(client, attr, None)
        close = getattr(resource, close_method, None)
        if callable(close):
            close()
    _supabase_client = None


class _LazySupabase:
    """Proxy that defers client creation until first use."""

    def __getattr__(self, name: str):
        return getattr(get_supabase(), name)


supabase: Client = _LazySupabase()  # type: ignore[assignment]
