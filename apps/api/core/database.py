from __future__ import annotations
from supabase import create_client, Client
from core.config import settings

_supabase_client: Client | None = None


def get_supabase() -> Client:
    """Returns a Supabase client using the service role key (bypasses RLS for server operations)."""
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _supabase_client


def get_supabase_user_client(jwt_token: str) -> Client:
    """Returns a Supabase client authenticated as the user (respects RLS)."""
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    client.auth.set_session(jwt_token, "")
    return client


class _LazySupabase:
    """Proxy that defers client creation until first use."""
    def __getattr__(self, name: str):
        return getattr(get_supabase(), name)


supabase: Client = _LazySupabase()  # type: ignore[assignment]
