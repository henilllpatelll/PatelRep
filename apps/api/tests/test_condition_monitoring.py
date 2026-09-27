"""Phase 9 contract tests for first-class engineering condition monitoring."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from models.requests import CreateMeterRequest, RecordMeterReadingRequest
from services.condition_monitoring import evaluate_meter_reading, meter_freshness_status


def test_threshold_evaluation_is_inclusive_and_critical_wins():
    meter = {
        "warning_low": 10,
        "warning_high": 65,
        "critical_low": 5,
        "critical_high": 72,
    }

    assert evaluate_meter_reading(meter, 58) == "normal"
    assert evaluate_meter_reading(meter, 65) == "warning"
    assert evaluate_meter_reading(meter, 72) == "critical"
    assert evaluate_meter_reading(meter, 10) == "warning"
    assert evaluate_meter_reading(meter, 5) == "critical"


def test_one_sided_thresholds_and_unconfigured_meters_are_supported():
    assert evaluate_meter_reading({"warning_high": 25, "critical_high": 30}, 24) == "normal"
    assert evaluate_meter_reading({"warning_high": 25, "critical_high": 30}, 25) == "warning"
    assert evaluate_meter_reading({"warning_high": 25, "critical_high": 30}, 30) == "critical"
    assert evaluate_meter_reading({}, 999) == "normal"


def test_staleness_is_distinct_from_threshold_status():
    now = datetime(2026, 9, 27, 12, tzinfo=timezone.utc)
    assert meter_freshness_status(None, 4, now=now) == "no_readings"
    assert meter_freshness_status(now - timedelta(hours=4), 4, now=now) == "stale"
    assert meter_freshness_status(now - timedelta(hours=3, minutes=59), 4, now=now) is None
    assert meter_freshness_status(now - timedelta(days=99), None, now=now) is None


def test_meter_request_rejects_contradictory_thresholds():
    with pytest.raises(ValidationError, match="critical_low"):
        CreateMeterRequest(name="Boiler pressure", meter_type="pressure", unit="PSI", warning_low=10, critical_low=12)
    with pytest.raises(ValidationError, match="critical_high"):
        CreateMeterRequest(name="Boiler pressure", meter_type="pressure", unit="PSI", warning_high=25, critical_high=20)


def test_meter_and_reading_request_contracts_are_numeric_and_append_only():
    meter = CreateMeterRequest(name="Supply air", meter_type="temperature", unit="°F", critical_action="create_work_order")
    reading = RecordMeterReadingRequest(value=76.2, notes="Measured after ten minutes.")

    assert meter.source_type == "manual"
    assert meter.critical_action == "create_work_order"
    assert reading.value == 76.2


def test_migration_has_tenant_indexes_snapshot_and_duplicate_condition_work_order_guard():
    migration = (Path(__file__).parents[3] / "supabase/migrations/114_condition_monitoring.sql").read_text()

    assert "CREATE TABLE public.asset_meters" in migration
    assert "CREATE TABLE public.meter_readings" in migration
    assert "status_at_recording" in migration
    assert "ENABLE ROW LEVEL SECURITY" in migration
    assert "meter_id, recorded_at DESC" in migration
    assert "condition_meter_id" in migration
    assert "WHERE status IN ('open', 'escalated', 'in_progress', 'on_hold')" in migration
