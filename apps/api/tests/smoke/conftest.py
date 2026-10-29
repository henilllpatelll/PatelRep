import os

# Set test environment variables before importing app
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-minimum-32-characters-long!!")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_placeholder")
os.environ.setdefault("STRIPE_WEBHOOK_SECRET", "stripe-webhook-secret-test")
os.environ.setdefault("CRON_SECRET", "test-cron-secret")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("APP_URL", "http://localhost:3000")
os.environ.setdefault("API_URL", "http://localhost:8000")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _schedule_outbox_never_touches_the_network(monkeypatch):
    """Workflow routers queue schedule notifications; unless a test installs its own database they go to a throwaway fake."""
    from services import schedule_outbox
    from tests.smoke.fake_supabase import FakeDB

    monkeypatch.setattr(schedule_outbox, "supabase", FakeDB({}))


@pytest.fixture
def revisions_db(monkeypatch):
    from tests.smoke.revision_support import make_revisions_db

    return make_revisions_db(monkeypatch)
