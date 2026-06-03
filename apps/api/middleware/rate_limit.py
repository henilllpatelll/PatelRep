import asyncio
import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from middleware.auth import _decode_token


@dataclass(frozen=True)
class RateLimitRule:
    limit: int
    window_seconds: int


@dataclass(frozen=True)
class _Bucket:
    key: str
    rule: RateLimitRule


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Small in-process sliding-window limiter for Railway's single API service.

    It always applies an IP bucket, and verified bearer tokens get an additional
    per-user bucket. Invalid tokens stay on anonymous IP limits.
    """

    def __init__(
        self,
        app,
        *,
        enabled: bool = True,
        default_rule: RateLimitRule = RateLimitRule(limit=180, window_seconds=60),
        anonymous_rule: RateLimitRule = RateLimitRule(limit=60, window_seconds=60),
        ai_rule: RateLimitRule = RateLimitRule(limit=20, window_seconds=60),
        webhook_rule: RateLimitRule = RateLimitRule(limit=120, window_seconds=60),
        auth_rule: RateLimitRule = RateLimitRule(limit=10, window_seconds=60),
        health_rule: RateLimitRule = RateLimitRule(limit=60, window_seconds=60),
        per_ip_authenticated_rule: RateLimitRule = RateLimitRule(limit=600, window_seconds=60),
    ):
        super().__init__(app)
        self.enabled = enabled
        self.default_rule = default_rule
        self.anonymous_rule = anonymous_rule
        self.ai_rule = ai_rule
        self.webhook_rule = webhook_rule
        self.auth_rule = auth_rule
        self.health_rule = health_rule
        self.per_ip_authenticated_rule = per_ip_authenticated_rule
        self._requests: dict[str, Deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def dispatch(self, request: Request, call_next):
        if not self.enabled or request.method == "OPTIONS":
            return await call_next(request)

        now = time.monotonic()
        buckets = await self._buckets_for(request)
        async with self._lock:
            exceeded = self._first_exceeded_bucket(buckets, now)
            if exceeded:
                retry_after = self._retry_after(exceeded, now)
                return self._rate_limited_response(exceeded.rule, retry_after)
            snapshots = [self._add_hit(bucket, now) for bucket in buckets]

        response = await call_next(request)
        if snapshots:
            limited_snapshot = min(snapshots, key=lambda item: item[1])
            rule, remaining, reset_after = limited_snapshot
            response.headers["X-RateLimit-Limit"] = str(rule.limit)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            response.headers["X-RateLimit-Reset"] = str(math.ceil(time.time() + reset_after))
        return response

    async def _buckets_for(self, request: Request) -> list[_Bucket]:
        path = request.url.path
        client_ip = _client_ip(request)
        user_id = await _bearer_subject(request)
        route_rule = self._route_rule(path)
        ip_rule = self.per_ip_authenticated_rule if user_id else min_rule(self.anonymous_rule, route_rule)

        buckets = [_Bucket(key=f"ip:{client_ip}:{path_tier(path)}", rule=ip_rule)]
        if user_id:
            buckets.append(_Bucket(key=f"user:{user_id}:{path_tier(path)}", rule=route_rule))
        return buckets

    def _route_rule(self, path: str) -> RateLimitRule:
        if path == "/health":
            return self.health_rule
        if path.startswith("/v1/ai/") or path == "/v1/sop/query":
            return self.ai_rule
        if path.startswith("/v1/auth/"):
            return self.auth_rule
        if path.startswith("/v1/webhooks/"):
            return self.webhook_rule
        return self.default_rule

    def _first_exceeded_bucket(self, buckets: list[_Bucket], now: float) -> _Bucket | None:
        for bucket in buckets:
            hits = self._requests[bucket.key]
            _prune(hits, now, bucket.rule.window_seconds)
            if len(hits) >= bucket.rule.limit:
                return bucket
        return None

    def _add_hit(self, bucket: _Bucket, now: float) -> tuple[RateLimitRule, int, float]:
        hits = self._requests[bucket.key]
        _prune(hits, now, bucket.rule.window_seconds)
        hits.append(now)
        remaining = max(bucket.rule.limit - len(hits), 0)
        reset_after = bucket.rule.window_seconds - (now - hits[0])
        return bucket.rule, remaining, max(reset_after, 0.0)

    def _retry_after(self, bucket: _Bucket, now: float) -> int:
        hits = self._requests[bucket.key]
        if not hits:
            return bucket.rule.window_seconds
        return max(math.ceil(bucket.rule.window_seconds - (now - hits[0])), 1)

    def _rate_limited_response(self, rule: RateLimitRule, retry_after: int) -> JSONResponse:
        response = JSONResponse(
            status_code=429,
            content={
                "error": {
                    "code": "rate_limit_exceeded",
                    "message": f"Too many requests. Try again in {retry_after} seconds.",
                }
            },
        )
        response.headers["Retry-After"] = str(retry_after)
        response.headers["X-RateLimit-Limit"] = str(rule.limit)
        response.headers["X-RateLimit-Remaining"] = "0"
        response.headers["X-RateLimit-Reset"] = str(math.ceil(time.time() + retry_after))
        return response


def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()

    forwarded = request.headers.get("forwarded", "")
    if forwarded:
        for part in forwarded.split(";"):
            key, _, value = part.strip().partition("=")
            if key.lower() == "for" and value:
                return value.strip('"[]')

    return request.client.host if request.client else "unknown"


async def _bearer_subject(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    if token.count(".") != 2:
        return None
    try:
        claims = await _decode_token(token)
    except Exception:
        return None
    subject = claims.get("sub")
    return str(subject) if subject else None


def _prune(hits: Deque[float], now: float, window_seconds: int) -> None:
    cutoff = now - window_seconds
    while hits and hits[0] <= cutoff:
        hits.popleft()


def min_rule(left: RateLimitRule, right: RateLimitRule) -> RateLimitRule:
    left_rate = left.limit / left.window_seconds
    right_rate = right.limit / right.window_seconds
    return left if left_rate <= right_rate else right


def path_tier(path: str) -> str:
    if path == "/health":
        return "health"
    if path.startswith("/v1/ai/") or path == "/v1/sop/query":
        return "ai"
    if path.startswith("/v1/auth/"):
        return "auth"
    if path.startswith("/v1/webhooks/"):
        return "webhook"
    return "api"
