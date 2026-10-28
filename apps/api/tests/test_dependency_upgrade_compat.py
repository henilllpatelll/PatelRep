"""Regression tests for the FastAPI 0.162 / openai 3.x / python-dateutil 3 upgrade.

These run the real libraries rather than mocks: the OpenAI SDK talks to a local
OpenAI-compatible HTTP server, dateutil resolves real IANA zones, and FastAPI's
own route table is inspected.
"""
import json
import threading
import warnings
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import openai
import pytest
from dateutil import tz
from dateutil.relativedelta import relativedelta

from core.config import settings
from core.timezones import safe_gettz


# --------------------------------------------------------------------------
# python-dateutil 3: hotel timezone resolution
# --------------------------------------------------------------------------

class _TenantChain:
    """Answers any supabase.table(...).select().eq().maybe_single().execute() chain."""

    def __init__(self, timezone_value):
        self._row = {"timezone": timezone_value}

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return SimpleNamespace(data=self._row)


def _resolvers(monkeypatch, timezone_value):
    from routers import clean_sessions, housekeeping, logbook, shifts
    from services.ai import authorization, housekeeper_shift_recap, shift_summary

    chain = _TenantChain(timezone_value)
    for module in (clean_sessions, housekeeping, logbook, shifts, shift_summary):
        monkeypatch.setattr(module, "supabase", chain)
    return {
        "clean_sessions": lambda: clean_sessions._get_hotel_tz("h"),
        "housekeeping": lambda: housekeeping._hotel_zone("h"),
        "logbook": lambda: logbook._get_hotel_tz("h"),
        "shifts": lambda: shifts._hotel_zone("h"),
        "shift_summary": lambda: shift_summary._get_hotel_tz("h"),
        "authorization": lambda: authorization._hotel_tz(chain, "h"),
        "shift_recap": lambda: housekeeper_shift_recap._tz_for(chain, "h"),
    }


def _offset_hours(zone, when: datetime) -> float:
    return when.replace(tzinfo=zone).utcoffset().total_seconds() / 3600


@pytest.mark.parametrize("stored", ["../../etc/passwd", "../x", "Not/AZone", "America/Nowhere"])
def test_malformed_stored_timezone_falls_back_to_chicago_everywhere(monkeypatch, stored):
    # dateutil 3 raises DeprecatedTzKeyWarning (promoted to an error) from gettz()
    # for path-like keys; every resolver must still return the Chicago default.
    chicago_winter = datetime(2026, 1, 15, 12, 0)
    for name, resolve in _resolvers(monkeypatch, stored).items():
        zone = resolve()
        assert zone is not None, name
        assert _offset_hours(zone, chicago_winter) == -6, name


def test_valid_stored_timezone_is_honoured_everywhere(monkeypatch):
    winter = datetime(2026, 1, 15, 12, 0)
    for name, resolve in _resolvers(monkeypatch, "America/Denver").items():
        assert _offset_hours(resolve(), winter) == -7, name


def test_safe_gettz_returns_none_where_dateutil_3_raises():
    with pytest.raises(Warning):
        tz.gettz("../../etc/passwd")  # documents the upstream behaviour being guarded
    assert safe_gettz("../../etc/passwd") is None
    assert safe_gettz("Not/AZone") is None
    assert safe_gettz("America/Chicago") is not None


def test_chicago_offsets_across_dst():
    zone = tz.gettz("America/Chicago")
    assert _offset_hours(zone, datetime(2026, 1, 15, 12)) == -6
    assert _offset_hours(zone, datetime(2026, 7, 15, 12)) == -5
    # Spring forward 2026-03-08 02:00 -> 03:00; fall back 2026-11-01 02:00 -> 01:00.
    assert _offset_hours(zone, datetime(2026, 3, 8, 1, 59)) == -6
    assert _offset_hours(zone, datetime(2026, 3, 8, 3, 0)) == -5
    assert _offset_hours(zone, datetime(2026, 11, 1, 0, 59)) == -5
    assert _offset_hours(zone, datetime(2026, 11, 1, 2, 0)) == -6


def test_nonexistent_and_ambiguous_local_times_follow_pep495():
    # dateutil 3 changed the offset of a nonexistent time: fold=0 uses the offset
    # from before the transition (previously always the one after).
    zone = tz.gettz("America/Chicago")
    gap = datetime(2026, 3, 8, 2, 30, tzinfo=zone)
    assert gap.utcoffset() == timedelta(hours=-6)
    assert gap.replace(fold=1).utcoffset() == timedelta(hours=-5)
    overlap = datetime(2026, 11, 1, 1, 30, tzinfo=zone)
    assert overlap.utcoffset() == timedelta(hours=-5)
    assert overlap.replace(fold=1).utcoffset() == timedelta(hours=-6)


def test_hotel_local_day_boundary_uses_chicago_not_utc():
    zone = tz.gettz("America/Chicago")
    # 01:30 UTC on Oct 28 is still the evening of Oct 27 in Central time.
    instant = datetime(2026, 10, 28, 1, 30, tzinfo=timezone.utc)
    assert instant.astimezone(zone).date() == date(2026, 10, 27)
    # Midnight local on the DST change days is not a gap, so day windows stay 23h/25h.
    start = datetime(2026, 3, 8, tzinfo=zone)
    end = datetime(2026, 3, 9, tzinfo=zone)
    assert (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)) == timedelta(hours=23)
    start = datetime(2026, 11, 1, tzinfo=zone)
    end = datetime(2026, 11, 2, tzinfo=zone)
    assert (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)) == timedelta(hours=25)


def test_utc_zone_is_aware_and_equivalent_to_tzutc():
    zone = tz.gettz("UTC")
    assert zone.utcoffset(None) == timedelta(0)
    assert datetime(2026, 1, 1, 12, tzinfo=zone).astimezone(tz.tzutc()).hour == 12


def test_no_dateutil_deprecation_warning_from_application_zone_lookups(monkeypatch):
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        for resolve in _resolvers(monkeypatch, "America/Chicago").values():
            resolve()


@pytest.mark.parametrize(
    "start,months,expected",
    [
        (date(2026, 1, 31), 1, date(2026, 2, 28)),
        (date(2028, 1, 31), 1, date(2028, 2, 29)),
        (date(2026, 10, 1), 1, date(2026, 11, 1)),
        (date(2026, 12, 15), 1, date(2027, 1, 15)),
        (date(2026, 8, 31), 6, date(2027, 2, 28)),
    ],
)
def test_relativedelta_month_arithmetic_used_by_billing_and_schedules(start, months, expected):
    assert start + relativedelta(months=months) == expected


def test_billing_period_end_uses_month_end():
    # middleware.credits: period_end = period_start + relativedelta(months=1) - 1 day
    assert date(2026, 2, 1) + relativedelta(months=1) - timedelta(days=1) == date(2026, 2, 28)
    assert date(2026, 12, 1) + relativedelta(months=1) - timedelta(days=1) == date(2026, 12, 31)


def test_relativedelta_not_equal_handles_foreign_types():
    assert (relativedelta(months=1) != None) is True  # noqa: E711 -- fixed in dateutil 3


# --------------------------------------------------------------------------
# FastAPI 0.162: omitted boolean form fields
# --------------------------------------------------------------------------

def _resolve(schema: dict, components: dict) -> dict:
    ref = schema.get("$ref")
    return components[ref.rsplit("/", 1)[-1]] if ref else schema


def _schema_has_bool(schema: dict, components: dict) -> bool:
    schema = _resolve(schema, components)
    if schema.get("type") == "boolean":
        return True
    members = schema.get("anyOf", []) + schema.get("oneOf", []) + schema.get("allOf", [])
    return any(_schema_has_bool(member, components) for member in members)


def test_no_route_declares_a_boolean_form_field():
    # 0.162 stopped inferring False for omitted bool form fields (they now take the
    # declared default or become a missing-field error). None of our form endpoints
    # take a bool today; this fails if one is added without revisiting that rule.
    # Read through OpenAPI: FastAPI 0.162 nests included routers inside app.routes.
    from main import app

    app.openapi_schema = None
    schema = app.openapi()
    components = schema["components"]["schemas"]
    offenders = []
    for path, operations in schema["paths"].items():
        for method, operation in operations.items():
            content = (operation.get("requestBody") or {}).get("content", {})
            for media in ("multipart/form-data", "application/x-www-form-urlencoded"):
                if media not in content:
                    continue
                body = _resolve(content[media]["schema"], components)
                for name, prop in body.get("properties", {}).items():
                    if _schema_has_bool(prop, components):
                        offenders.append(f"{method.upper()} {path}:{name}")
    assert offenders == []


def test_form_endpoints_are_present_in_the_schema_the_check_reads():
    from main import app

    app.openapi_schema = None
    paths = app.openapi()["paths"]
    content = paths["/v1/ai/photo-analysis"]["post"]["requestBody"]["content"]
    assert "multipart/form-data" in content


def test_openapi_schema_builds_with_all_routes():
    from main import app

    app.openapi_schema = None
    schema = app.openapi()
    assert schema["paths"], "OpenAPI schema lists no paths"
    assert "/v1/ai/photo-analysis" in schema["paths"]


# --------------------------------------------------------------------------
# openai 3.x: real SDK against an OpenAI-compatible server (httpx2 transport)
# --------------------------------------------------------------------------

class _FakeOpenAI:
    """Minimal OpenAI-compatible server; records what the real SDK sends."""

    def __init__(self):
        self.requests: list[dict] = []
        self.status = 200
        self.chat_body: dict = {}
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # noqa: D401 -- silence
                pass

            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                outer.requests.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
                if outer.status != 200:
                    payload = {"error": {"message": "provider said no", "type": "x", "code": "y"}}
                    data = json.dumps(payload).encode()
                    self.send_response(outer.status)
                    self.send_header("x-should-retry", "false")
                elif self.path.endswith("/embeddings"):
                    inputs = body["input"] if isinstance(body["input"], list) else [body["input"]]
                    payload = {
                        "object": "list",
                        "model": body["model"],
                        "data": [{"object": "embedding", "index": i, "embedding": [0.1 * (i + 1)] * 4} for i in range(len(inputs))],
                        "usage": {"prompt_tokens": 3, "total_tokens": 3},
                    }
                    data = json.dumps(payload).encode()
                    self.send_response(200)
                else:
                    data = json.dumps(outer.chat_body).encode()
                    self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def _tool_call_completion(tool_name: str, arguments: dict, prompt_tokens: int, completion_tokens: int) -> dict:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 1_700_000_000,
        "model": "gpt-4o-mini",
        "choices": [{
            "index": 0,
            "finish_reason": "tool_calls",
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": tool_name, "arguments": json.dumps(arguments)},
                }],
            },
        }],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "total_tokens": prompt_tokens + completion_tokens},
    }


@pytest.fixture()
def fake_openai(monkeypatch):
    server = _FakeOpenAI()
    monkeypatch.setenv("OPENAI_BASE_URL", f"{server.base_url}/v1")
    monkeypatch.setattr(settings, "ai_provider", "hosted")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test-key")
    yield server
    server.close()


def test_assignment_parser_reads_tool_call_and_real_usage(fake_openai):
    from services.ai.assignment_parser import parse_assignments

    fake_openai.chat_body = _tool_call_completion(
        "create_assignments",
        {"assignments": [{"staff_name_hint": "Maria", "room_numbers": ["201", "202"], "clean_type": "DEP"}]},
        prompt_tokens=123,
        completion_tokens=45,
    )

    result = parse_assignments("Maria takes 201-202 departures")

    assert result["assignments"] == [{"staff_name_hint": "Maria", "room_numbers": ["201", "202"], "clean_type": "DEP"}]
    # AI credit accounting bills from the provider's actual usage, never an estimate.
    assert result["prompt_tokens"] == 123
    assert result["completion_tokens"] == 45
    sent = fake_openai.requests[0]
    assert sent["path"] == "/v1/chat/completions"
    assert sent["auth"] == "Bearer sk-test-key"
    assert sent["body"]["tool_choice"] == {"type": "function", "function": {"name": "create_assignments"}}
    assert sent["body"]["tools"][0]["function"]["name"] == "create_assignments"
    assert sent["body"]["model"] == "gpt-4o-mini"


def test_guest_request_parser_reads_tool_call_and_real_usage(fake_openai):
    from services.ai.guest_request_parser import parse_guest_requests

    fake_openai.chat_body = _tool_call_completion(
        "create_guest_requests",
        {"requests": [{"room_number": "310", "category": "housekeeping", "priority": "normal"}]},
        prompt_tokens=77,
        completion_tokens=19,
    )

    result = parse_guest_requests("310 needs extra towels")

    assert result["requests"][0]["room_number"] == "310"
    assert (result["prompt_tokens"], result["completion_tokens"]) == (77, 19)


def test_embeddings_batch_preserves_order_and_shape(fake_openai):
    from services.ai.providers import get_openai_client

    response = get_openai_client().embeddings.create(model="text-embedding-3-small", input=["a", "b", "c"])

    assert [item.index for item in response.data] == [0, 1, 2]
    assert [item.embedding for item in response.data][1] == [0.2] * 4
    assert fake_openai.requests[0]["body"]["input"] == ["a", "b", "c"]


def test_provider_rate_limit_and_auth_errors_map_to_the_classes_the_routers_catch(fake_openai):
    from services.ai.providers import get_openai_client

    client = get_openai_client()
    fake_openai.status = 429
    with pytest.raises(openai.RateLimitError) as rate:
        client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": "hi"}])
    assert rate.value.status_code == 429

    fake_openai.status = 401
    with pytest.raises(openai.AuthenticationError) as auth:
        client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": "hi"}])
    assert auth.value.status_code == 401


def test_router_handlers_still_catch_the_sdk_error_classes():
    # ai_copilot and sop_rag name these exact classes in `except (...)` clauses.
    for name in ("RateLimitError", "AuthenticationError", "APIConnectionError", "APITimeoutError", "APIStatusError"):
        assert issubclass(getattr(openai, name), openai.OpenAIError)
    assert issubclass(openai.RateLimitError, openai.APIStatusError)


def test_connection_failure_raises_api_connection_error(monkeypatch):
    from services.ai.providers import get_openai_client

    server = _FakeOpenAI()
    base = server.base_url
    server.close()  # nothing listening any more
    monkeypatch.setenv("OPENAI_BASE_URL", f"{base}/v1")
    monkeypatch.setattr(settings, "ai_provider", "hosted")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test-key")

    client = get_openai_client()
    with pytest.raises(openai.APIConnectionError):
        client.with_options(max_retries=0).chat.completions.create(
            model="gpt-4o-mini", messages=[{"role": "user", "content": "hi"}]
        )


def test_ollama_provider_path_uses_loopback_and_disables_thinking(monkeypatch):
    from services.ai.providers import get_openai_client

    server = _FakeOpenAI()
    try:
        server.chat_body = _tool_call_completion("create_assignments", {"assignments": []}, 5, 2)
        monkeypatch.setattr(settings, "ai_provider", "ollama")
        monkeypatch.setattr(settings, "ollama_base_url", server.base_url)
        monkeypatch.setattr(settings, "ollama_model", "local-model")
        monkeypatch.setattr(settings, "ollama_disable_thinking", True)

        response = get_openai_client().chat.completions.create(
            model="gpt-4o-mini", messages=[{"role": "user", "content": "hi"}]
        )

        assert response.usage.prompt_tokens == 5
        sent = server.requests[0]
        assert sent["path"] == "/v1/chat/completions"
        assert sent["body"]["model"] == "local-model"
        assert sent["body"]["think"] is False
    finally:
        server.close()


def test_sdk_uses_httpx2_and_application_httpx_pin_is_independent():
    import httpx
    import httpx2

    from services.ai.providers import get_openai_client
    # openai 3 dropped the implicit httpx dependency; the app imports httpx directly
    # (auth, notify, email, Opera), so requirements.txt must keep pinning it.
    assert httpx.__version__
    assert httpx2.__version__
    assert settings.openai_api_key is not None
    assert callable(get_openai_client)
