from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from middleware.rate_limit import RateLimitMiddleware, RateLimitRule
from main import app


def _build_limited_client() -> TestClient:
    limited_app = FastAPI()

    @limited_app.get("/v1/tasks")
    async def tasks():
        return {"data": []}

    @limited_app.post("/v1/ai/copilot/chat")
    async def ai_chat():
        return {"data": {"ok": True}}

    limited_app.add_middleware(
        RateLimitMiddleware,
        enabled=True,
        default_rule=RateLimitRule(limit=3, window_seconds=60),
        anonymous_rule=RateLimitRule(limit=2, window_seconds=60),
        ai_rule=RateLimitRule(limit=1, window_seconds=60),
    )
    return TestClient(limited_app)


def test_rate_limit_uses_forwarded_client_ip():
    client = _build_limited_client()

    first = client.get("/v1/tasks", headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.1"})
    second = client.get("/v1/tasks", headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.1"})
    third = client.get("/v1/tasks", headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.1"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert third.json()["error"]["code"] == "rate_limit_exceeded"
    assert int(third.headers["Retry-After"]) > 0
    assert third.headers["X-RateLimit-Limit"] == "2"

    other_ip = client.get("/v1/tasks", headers={"X-Forwarded-For": "203.0.113.11"})
    assert other_ip.status_code == 200


def test_verified_users_get_separate_buckets_behind_same_ip():
    client = _build_limited_client()
    user_a_token = jwt.encode(
        {"sub": "user-a", "hotel_id": "hotel-a", "role": "gm", "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    user_b_token = jwt.encode(
        {"sub": "user-b", "hotel_id": "hotel-a", "role": "gm", "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    shared_ip = {"X-Forwarded-For": "203.0.113.30"}
    user_a_headers = {**shared_ip, "Authorization": f"Bearer {user_a_token}"}
    user_b_headers = {**shared_ip, "Authorization": f"Bearer {user_b_token}"}

    assert client.get("/v1/tasks", headers=user_a_headers).status_code == 200
    assert client.get("/v1/tasks", headers=user_a_headers).status_code == 200
    assert client.get("/v1/tasks", headers=user_a_headers).status_code == 200
    assert client.get("/v1/tasks", headers=user_a_headers).status_code == 429
    assert client.get("/v1/tasks", headers=user_b_headers).status_code == 200


def test_ai_routes_have_stricter_rate_limit_tier():
    client = _build_limited_client()

    first = client.post("/v1/ai/copilot/chat", headers={"X-Forwarded-For": "203.0.113.20"})
    second = client.post("/v1/ai/copilot/chat", headers={"X-Forwarded-For": "203.0.113.20"})

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.headers["X-RateLimit-Limit"] == "1"


def test_security_headers_treat_forwarded_https_as_secure():
    response = TestClient(app).get("/health", headers={"X-Forwarded-Proto": "https"})

    assert response.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Cross-Origin-Opener-Policy"] == "same-origin"
