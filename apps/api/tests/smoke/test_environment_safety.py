import pytest
from pydantic import ValidationError

from core.config import Settings


def settings_for(**overrides: str) -> Settings:
    values = {
        "supabase_url": "https://staging-project.supabase.co",
        "supabase_service_role_key": "test-service-key",
        "supabase_jwt_secret": "test-jwt-secret-minimum-32-characters-long!!",
        "cron_secret": "test-cron-secret",
        "app_env": "staging",
        "staging_expected_supabase_host": "staging-project.supabase.co",
        "production_supabase_host": "production-project.supabase.co",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_staging_accepts_its_expected_supabase_project():
    settings = settings_for()
    assert settings.supabase_project_url == "https://staging-project.supabase.co"


@pytest.mark.parametrize(
    ("supabase_url", "expected_host"),
    [
        ("https://production-project.supabase.co", "staging-project.supabase.co"),
        ("https://another-project.supabase.co", "staging-project.supabase.co"),
    ],
)
def test_staging_rejects_any_non_staging_supabase_project(supabase_url: str, expected_host: str):
    with pytest.raises(ValidationError, match="staging Supabase host"):
        settings_for(
            supabase_url=supabase_url,
            staging_expected_supabase_host=expected_host,
        )


def test_staging_requires_an_expected_supabase_host():
    with pytest.raises(ValidationError, match="STAGING_EXPECTED_SUPABASE_HOST"):
        settings_for(staging_expected_supabase_host="")


def test_staging_rejects_a_live_stripe_key():
    with pytest.raises(ValidationError, match="Stripe test-mode"):
        settings_for(stripe_secret_key="sk_live_example")


def test_app_env_accepts_all_supported_environments():
    for app_env in ("development", "test", "staging", "production"):
        kwargs = {"app_env": app_env}
        if app_env != "staging":
            kwargs["staging_expected_supabase_host"] = ""
        assert settings_for(**kwargs).app_env == app_env
