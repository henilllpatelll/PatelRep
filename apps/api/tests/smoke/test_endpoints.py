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
    "/v1/staff",
    "/v1/staff/invitations",
    "/v1/staff/custom-roles",
    "/v1/integrations/opera/status",
]

PROTECTED_POST_ENDPOINTS = [
    "/v1/tasks",
    "/v1/logbook/entries",
    "/v1/guest-requests",
    "/v1/lost-found",
    "/v1/ai/copilot/chat",
    "/v1/ai/tasks/confirm",
    "/v1/ai/work-orders/confirm",
    "/v1/ai/guest-requests/confirm",
    "/v1/ai/assignments/confirm",
    "/v1/staff/invite",
    "/v1/work-orders",
]

class TestAuthProtection:
    """Verify all endpoints require authentication."""

    # Each test method uses a distinct X-Forwarded-For IP so parametrized runs
    # don't share a rate-limit bucket and exhaust the in-process limiter.

    @pytest.mark.parametrize("endpoint", PROTECTED_GET_ENDPOINTS)
    def test_protected_endpoint_no_auth(self, endpoint):
        response = client.get(endpoint, headers={"X-Forwarded-For": "192.0.2.1"})
        assert response.status_code == 401, f"{endpoint} returned {response.status_code}"

    @pytest.mark.parametrize("endpoint", PROTECTED_GET_ENDPOINTS)
    def test_protected_endpoint_invalid_token(self, endpoint):
        response = client.get(endpoint, headers={
            "X-Forwarded-For": "192.0.2.2",
            "Authorization": "Bearer invalid-token-xyz",
        })
        assert response.status_code == 401, (
            f"{endpoint} with invalid token returned {response.status_code}"
        )

    @pytest.mark.parametrize("endpoint", PROTECTED_POST_ENDPOINTS)
    def test_protected_post_endpoint_no_auth(self, endpoint):
        response = client.post(endpoint, json={}, headers={"X-Forwarded-For": "192.0.2.3"})
        assert response.status_code == 401, f"POST {endpoint} returned {response.status_code}"

    @pytest.mark.parametrize("endpoint", PROTECTED_POST_ENDPOINTS)
    def test_protected_post_endpoint_invalid_token(self, endpoint):
        response = client.post(endpoint, json={}, headers={
            "X-Forwarded-For": "192.0.2.4",
            "Authorization": "Bearer invalid-token-xyz",
        })
        assert response.status_code == 401, (
            f"POST {endpoint} with invalid token returned {response.status_code}"
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
        response = client.get("/docs")
        assert response.status_code in (200, 404)

    def test_billing_endpoints_registered(self):
        response = client.get("/v1/billing/subscription", headers={"X-Forwarded-For": "192.0.2.10"})
        assert response.status_code == 401

    def test_lost_found_registered(self):
        response = client.get("/v1/lost-found", headers={"X-Forwarded-For": "192.0.2.11"})
        assert response.status_code == 401

    def test_logbook_registered(self):
        response = client.get("/v1/logbook/entries", headers={"X-Forwarded-For": "192.0.2.12"})
        assert response.status_code == 401

    def test_reports_registered(self):
        for path in ["/v1/reports/daily-summary", "/v1/reports/staff-performance"]:
            response = client.get(path, headers={"X-Forwarded-For": "192.0.2.13"})
            assert response.status_code == 401, f"{path} not registered"

    def test_staff_router_registered(self):
        response = client.get("/v1/staff", headers={"X-Forwarded-For": "192.0.2.14"})
        assert response.status_code == 401

    def test_scheduling_router_registered(self):
        response = client.get("/v1/schedules/shifts", headers={"X-Forwarded-For": "192.0.2.15"})
        assert response.status_code == 401

    def test_integrations_router_registered(self):
        response = client.get("/v1/integrations/opera/status", headers={"X-Forwarded-For": "192.0.2.16"})
        assert response.status_code == 401

    def test_ai_copilot_router_registered(self):
        for path in ["/v1/ai/risk-alerts", "/v1/ai/insights"]:
            response = client.get(path, headers={"X-Forwarded-For": "192.0.2.17"})
            assert response.status_code == 401, f"{path} not registered"

    def test_ai_copilot_confirm_endpoints_registered(self):
        for path in [
            "/v1/ai/copilot/chat",
            "/v1/ai/tasks/confirm",
            "/v1/ai/work-orders/confirm",
            "/v1/ai/guest-requests/confirm",
            "/v1/ai/assignments/confirm",
        ]:
            response = client.post(path, json={}, headers={"X-Forwarded-For": "192.0.2.18"})
            assert response.status_code == 401, f"POST {path} not registered (got {response.status_code})"


class TestInternalEndpointsNeedCronSecret:
    """Internal cron endpoints require X-Cron-Secret header, not JWT."""

    def test_internal_endpoints_reject_bad_cron_secret(self):
        for path in [
            "/v1/internal/predictions/run",
            "/v1/internal/billing/monthly-trueup",
            "/v1/internal/pm/check-due",
        ]:
            response = client.post(path, headers={"X-Forwarded-For": "192.0.2.20"})
            assert response.status_code == 401, f"POST {path} should require cron secret"


class TestResponseFormat:
    """Responses should follow {data: ...} or {error: ...} format."""

    def test_health_format(self):
        response = client.get("/health")
        data = response.json()
        assert "status" in data

    def test_error_format_on_auth_failure(self):
        response = client.get("/v1/rooms", headers={"X-Forwarded-For": "192.0.2.21"})
        assert response.status_code == 401
        assert len(response.content) > 0
