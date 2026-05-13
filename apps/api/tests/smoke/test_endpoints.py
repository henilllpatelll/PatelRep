import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

PROTECTED_GET_ENDPOINTS = [
    "/v1/rooms",
    "/v1/housekeeping/board",
    "/v1/tasks",
    "/v1/work-orders",
    "/v1/assets",
    "/v1/billing/subscription",
    "/v1/billing/credits",
    "/v1/logbook/entries",
    "/v1/guest-requests",
    "/v1/lost-found",
    "/v1/reports/daily-summary",
    "/v1/reports/staff-performance",
    "/v1/reports/maintenance",
    "/v1/reports/ai-usage",
    "/v1/sop/documents",
    "/v1/notifications",
    "/v1/onboarding/status",
    "/v1/schedules/shifts",
    "/v1/schedules/assignments",
    "/v1/ai/risk-alerts",
    "/v1/ai/insights",
]

class TestAuthProtection:
    """Verify all endpoints require authentication."""

    @pytest.mark.parametrize("endpoint", PROTECTED_GET_ENDPOINTS)
    def test_protected_endpoint_no_auth(self, endpoint):
        """Protected endpoints should return 401 without auth."""
        response = client.get(endpoint)
        assert response.status_code == 401, f"{endpoint} returned {response.status_code}"

    @pytest.mark.parametrize("endpoint", PROTECTED_GET_ENDPOINTS)
    def test_protected_endpoint_invalid_token(self, endpoint):
        """Protected endpoints should return 401 with invalid token."""
        response = client.get(endpoint, headers={"Authorization": "Bearer invalid-token-xyz"})
        assert response.status_code == 401, (
            f"{endpoint} with invalid token returned {response.status_code}"
        )


class TestHealthEndpoints:
    def test_health_check(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ("ok", "degraded")
        assert "env" in data

    def test_health_returns_json(self):
        response = client.get("/health")
        assert response.headers["content-type"] == "application/json"


class TestAPIRoutersRegistered:
    """Verify all expected routers are registered (not just checking 404)."""

    def test_docs_available_in_dev(self):
        """In development mode, docs should be available."""
        response = client.get("/docs")
        # Will be 200 in dev or 404 in prod — just shouldn't 500
        assert response.status_code in (200, 404)

    def test_billing_endpoints_registered(self):
        response = client.get("/v1/billing/subscription")
        assert response.status_code == 401  # not 404 (not registered)

    def test_lost_found_registered(self):
        response = client.get("/v1/lost-found")
        assert response.status_code == 401

    def test_logbook_registered(self):
        response = client.get("/v1/logbook/entries")
        assert response.status_code == 401

    def test_reports_registered(self):
        for path in ["/v1/reports/daily-summary", "/v1/reports/staff-performance"]:
            response = client.get(path)
            assert response.status_code == 401, f"{path} not registered"


class TestPostEndpointsNeedAuth:
    """POST endpoints should also require auth."""

    def test_tasks_post_requires_auth(self):
        response = client.post("/v1/tasks", json={"title": "test", "task_type": "general"})
        assert response.status_code == 401

    def test_logbook_post_requires_auth(self):
        response = client.post("/v1/logbook/entries", json={"content": "test", "department_id": "123"})
        assert response.status_code == 401

    def test_guest_request_post_requires_auth(self):
        response = client.post("/v1/guest-requests", json={"title": "test"})
        assert response.status_code == 401

    def test_lost_found_post_requires_auth(self):
        response = client.post("/v1/lost-found", json={"description": "test"})
        assert response.status_code == 401

    def test_internal_endpoints_reject_bad_cron_secret(self):
        """Internal endpoints need CRON_SECRET header."""
        response = client.post("/v1/internal/predictions/run")
        assert response.status_code == 401

        response = client.post("/v1/internal/billing/monthly-trueup")
        assert response.status_code == 401

        response = client.post("/v1/internal/pm/check-due")
        assert response.status_code == 401


class TestResponseFormat:
    """Responses should follow {data: ...} or {error: ...} format."""

    def test_health_format(self):
        response = client.get("/health")
        data = response.json()
        assert "status" in data

    def test_error_format_on_auth_failure(self):
        """Auth errors should return a response (not empty)."""
        response = client.get("/v1/rooms")
        assert response.status_code == 401
        # Should have some body
        assert len(response.content) > 0
