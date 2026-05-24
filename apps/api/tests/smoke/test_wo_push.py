import os
import sys
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

# Set env vars before any app module is imported
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.test")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-minimum-32-characters-long!!")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_placeholder")
os.environ.setdefault("STRIPE_WEBHOOK_SECRET", "stripe-webhook-secret-test")
os.environ.setdefault("CRON_SECRET", "test-cron-secret")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("APP_URL", "http://localhost:3000")
os.environ.setdefault("API_URL", "http://localhost:8000")


@pytest.mark.asyncio
async def test_send_wo_assignment_push_posts_to_expo():
    """ENG-06: _send_wo_assignment_push sends to Expo Push API with correct url."""
    # Mock core.database before importing the router module
    mock_supabase_module = MagicMock()
    with patch.dict(sys.modules, {"core.database": mock_supabase_module}):
        # Clear cached module if already imported
        sys.modules.pop("routers.work_orders", None)

        import routers.work_orders as wo_module
        wo_module.supabase = mock_supabase_module.supabase

        mock_profile_data = MagicMock()
        mock_profile_data.data = {"expo_push_token": "ExponentPushToken[test]"}

        mock_supabase_module.supabase.table.return_value.select.return_value \
            .eq.return_value.single.return_value.execute.return_value = mock_profile_data

        import httpx
        with patch.object(httpx, "AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=MagicMock())
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            await wo_module._send_wo_assignment_push("engineer-1", "wo-abc", "Fix broken AC")

            mock_client.post.assert_called_once()
            call_kwargs = mock_client.post.call_args
            payload = call_kwargs[1]["json"] if "json" in call_kwargs[1] else call_kwargs[0][1]
            assert payload["data"]["url"] == "/(app)/work-orders/wo-abc"
            assert payload["data"]["wo_id"] == "wo-abc"
