from supabase import create_client, Client
from core.config import settings


def get_supabase() -> Client:
    """Returns a Supabase client using the service role key (bypasses RLS for server operations)."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_supabase_user_client(jwt_token: str) -> Client:
    """Returns a Supabase client authenticated as the user (respects RLS)."""
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    # Set the user's JWT so RLS policies apply
    client.auth.set_session(jwt_token, "")
    return client


supabase = get_supabase()
