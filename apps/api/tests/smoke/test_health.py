from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] in ("ok", "degraded")  # degraded is expected without real DB


def test_protected_endpoint_without_auth():
    response = client.get("/v1/rooms")
    assert response.status_code == 403  # No auth header


def test_protected_endpoint_with_invalid_token():
    response = client.get("/v1/rooms", headers={"Authorization": "Bearer invalid-token"})
    assert response.status_code == 401
