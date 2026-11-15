"""H3 metadata-only observability (secret canaries) and the operator spend commands' production refusal."""
from __future__ import annotations

import json
import logging
from decimal import Decimal

import pytest

from services.agent_orchestrator.errors import BudgetDenied, ErrorKind, ProviderCallFailed
from services.agent_orchestrator.observability import ALLOWED_FIELDS, log_event, safe_fields
from tests.smoke.agent_orchestrator_support import GUEST_CANARY, SECRET_CANARY

JWT_CANARY = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.c2lnbmF0dXJlY2FuYXJ5"


def test_only_allowlisted_scalar_fields_are_ever_emitted(caplog):
    caplog.set_level(logging.INFO, logger="patelrep.agent_orchestrator")
    payload = log_event("model_attempt", run_id="run-1", prompt=f"Guest {GUEST_CANARY}", completion="secret plan",
                        reasoning="chain of thought", arguments={"note": GUEST_CANARY}, exception=RuntimeError("x"),
                        api_key=SECRET_CANARY, headers={"authorization": f"Bearer {SECRET_CANARY}"},
                        cost_usd=Decimal("0.00012"), output_tokens=12)
    assert set(payload) == {"event", "run_id", "cost_usd", "output_tokens"}
    assert GUEST_CANARY not in caplog.text and SECRET_CANARY not in caplog.text and "chain of thought" not in caplog.text
    assert json.loads(caplog.records[-1].getMessage())["cost_usd"] == "0.00012"


@pytest.mark.parametrize("value", [SECRET_CANARY, f"Bearer {SECRET_CANARY}", JWT_CANARY,
                                   f"https://user:{SECRET_CANARY}@example.com/x"])
def test_secret_shaped_values_in_allowed_fields_are_redacted(value):
    cleaned = safe_fields({"error_code": value, "provider_request_id": value, "reason": value})
    for v in cleaned.values():
        assert SECRET_CANARY not in v and JWT_CANARY not in v


def test_strings_are_length_capped_and_event_names_sanitized():
    cleaned = safe_fields({"reason": "x" * 1000})
    assert len(cleaned["reason"]) == 120
    assert log_event("bad event; drop table")["event"] == "invalid_event"


def test_no_allowlisted_field_can_carry_content():
    for forbidden in ("prompt", "completion", "messages", "input", "output", "text", "arguments", "plan", "system",
                      "instructions", "error_message", "exception", "api_key", "authorization", "headers", "guest"):
        assert forbidden not in ALLOWED_FIELDS


def test_errors_are_codes_never_payloads():
    for exc in (BudgetDenied("hotel_budget_exceeded"), ProviderCallFailed(ErrorKind.PROVIDER_AUTH_FAILED)):
        assert str(exc) == exc.code and " " not in str(exc)


def test_spend_switch_refuses_to_enable_paid_calls_in_production(monkeypatch, capsys):
    from core.config import settings
    from services.agent_execution import __main__ as cli

    monkeypatch.setattr(settings, "app_env", "production")

    def boom():
        raise AssertionError("the ledger must not be contacted")

    monkeypatch.setattr(cli, "_ledger", boom)
    assert cli.main(["spend-switch", "--on", "--operator", "ops"]) == 2
    assert json.loads(capsys.readouterr().out) == {"ok": False, "reason": "production_refused"}
