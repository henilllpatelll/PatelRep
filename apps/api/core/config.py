from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
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

    # Internal
    cron_secret: str = "dev-secret"
    app_env: str = "development"
    app_url: str = "http://localhost:3000"
    api_url: str = "http://localhost:8000"

    class Config:
        env_file = str(Path(__file__).parent.parent / ".env")


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
