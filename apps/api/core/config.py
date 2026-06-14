from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from functools import lru_cache
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).parent.parent / ".env")
    )

    # Supabase
    supabase_url: str

    @field_validator("supabase_url", mode="before")
    @classmethod
    def _normalize_supabase_url(cls, v: str) -> str:
        """Strip PostgREST path suffix if SUPABASE_URL was set to the REST base URL."""
        v = v.strip().rstrip("/")
        for suffix in ("/rest/v1", "/rest"):
            if v.endswith(suffix):
                v = v[: -len(suffix)]
                break
        return v
    supabase_service_role_key: str
    supabase_jwt_secret: str

    # AI
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # Opera Cloud
    opera_oauth_client_id: str = ""
    opera_oauth_client_secret: str = ""
    opera_oauth_redirect_uri: str = ""
    opera_oauth_base_url: str = "https://api.oracle.com"
    opera_app_key: str = ""  # x-app-key header (UUID from Developer Portal)
    opera_enterprise_id: str = ""  # enterpriseId header (OCIM client_credentials only)
    opera_credential_encryption_key: str = ""

    # Billing
    base_plan_price_cents: int = 9900  # $99.00/month base fee

    # Internal
    cron_secret: str
    app_env: str = "development"
    app_url: str = "http://localhost:3000"
    api_url: str = "http://localhost:8000"
    api_rate_limit_enabled: bool = True
    api_rate_limit_default_per_minute: int = 180
    api_rate_limit_anonymous_per_minute: int = 60
    api_rate_limit_authenticated_ip_per_minute: int = 600
    api_rate_limit_ai_per_minute: int = 20
    api_rate_limit_auth_per_minute: int = 10
    api_rate_limit_webhook_per_minute: int = 120
    api_rate_limit_health_per_minute: int = 60
    supabase_http_timeout_seconds: float = 30.0
    supabase_storage_timeout_seconds: float = 30.0
    feedback_webhook_url: str = ""


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
