"""Phase 8 asset downtime and reliability contract tests.

The calculator deliberately consumes already-tenant-scoped records.  Router
tests cover the normalized mutations; database tests assert the SQL remains
the concurrency authority when two clients act at once.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from middleware.auth import CurrentUser
from models.requests import (
    CompleteWorkOrderRequest,
    CreateWorkOrderRequest,
    RestoreAssetDowntimeRequest,
    StartAssetDowntimeRequest,
)
from routers import assets as assets_router
from services.asset_reliability import calculate_asset_reliability


NOW = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)
ENGINEER = CurrentUser(user_id="engineer-1", hotel_id="hotel-1", role="engineer", email="e@x.com")


def _period(identifier, started_at, restored_at, *, downtime_type="unplanned"):
    return {
        "id": identifier,
        "started_at": started_at.isoformat(),
        "restored_at": restored_at.isoformat() if restored_at else None,
        "downtime_type": downtime_type,
        "impact_level": "out_of_service",
    }


def _completed_wo(identifier, completed_at, verification_result="passed"):
    return {
        "id": identifier,
        "completed_at": completed_at.isoformat(),
        "verification_result": verification_result,
    }


def test_reliability_uses_asset_downtime_not_work_order_elapsed_time():
    first_start = NOW - timedelta(days=20)
    first_restore = first_start + timedelta(minutes=30)
    second_start = NOW - timedelta(days=10)
    second_restore = second_start + timedelta(minutes=90)
    summary = calculate_asset_reliability(
        periods=[
            _period("one", first_start, first_restore),
            _period("planned", NOW - timedelta(days=15), NOW - timedelta(days=15) + timedelta(hours=2), downtime_type="planned"),
            _period("two", second_start, second_restore),
        ],
        work_orders=[],
        relationships=[],
        reopen_events=[],
        now=NOW,
    )

    assert summary["failure_count_12mo"] == 2
    assert summary["mttr_minutes"] == 60
    # MTBF is operating time from the first restoration to the next failure.
    assert summary["mtbf_minutes"] == 9 * 24 * 60 + 23 * 60 + 30
    assert summary["planned_downtime_12mo_minutes"] == 120
    assert summary["unplanned_downtime_12mo_minutes"] == 120


def test_reliability_clips_downtime_at_reporting_window_and_excludes_planned_from_failures():
    period_start = NOW - timedelta(days=370)
    period_restore = NOW - timedelta(days=360)
    summary = calculate_asset_reliability(
        periods=[
            _period("crosses-window", period_start, period_restore),
            _period("planned", NOW - timedelta(days=5), NOW - timedelta(days=5) + timedelta(minutes=20), downtime_type="planned"),
        ],
        work_orders=[],
        relationships=[],
        reopen_events=[],
        now=NOW,
    )

    assert summary["downtime_12mo_minutes"] == 5 * 24 * 60 + 20
    # Failure events are scoped by their unplanned start, so an outage begun
    # before the window contributes downtime but not a new 12-month failure.
    assert summary["failure_count_12mo"] == 0
    assert summary["mttr_minutes"] == 5 * 24 * 60
    assert summary["mtbf_minutes"] is None


def test_first_time_fix_excludes_reopens_repeats_and_immature_repairs():
    mature = NOW - timedelta(days=31)
    summary = calculate_asset_reliability(
        periods=[],
        work_orders=[
            _completed_wo("fixed", mature),
            _completed_wo("reopened", mature),
            _completed_wo("repeat", mature),
            _completed_wo("immature", NOW - timedelta(days=29)),
        ],
        relationships=[{"parent_work_order_id": "repeat", "relationship_type": "repeat_failure"}],
        reopen_events=[{"work_order_id": "reopened", "event_type": "reopened"}],
        now=NOW,
    )

    assert summary["first_time_fix_eligible"] == 3
    assert summary["first_time_fix_successes"] == 1
    assert summary["first_time_fix_rate"] == pytest.approx(1 / 3)
    assert summary["repeat_failure_count"] == 1
    assert summary["repeat_failure_rate"] == pytest.approx(1 / 4)
    assert summary["reopen_count"] == 1
    assert summary["reopen_rate"] == pytest.approx(1 / 4)


def test_request_contracts_make_operational_impact_and_restore_explicit():
    create = CreateWorkOrderRequest(title="PTAC down", category="hvac", asset_impact="out_of_service")
    complete = CompleteWorkOrderRequest(asset_restoration="restore")
    start = StartAssetDowntimeRequest(downtime_type="planned", impact_level="degraded")
    restore = RestoreAssetDowntimeRequest(notes="Passed post-repair test")

    assert create.asset_impact == "out_of_service"
    assert complete.asset_restoration == "restore"
    assert start.impact_level == "degraded"
    assert restore.notes == "Passed post-repair test"


class _RpcDB:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def rpc(self, name, payload):
        self.calls.append((name, payload))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self.result[name]))


@pytest.mark.asyncio
async def test_start_and_restore_delegate_tenant_safe_idempotency_to_database(monkeypatch):
    db = _RpcDB({
        "start_asset_downtime": {"created": False, "period": {"id": "down-1", "restored_at": None}},
        "restore_asset_downtime": {"restored": False, "period": {"id": "down-1", "restored_at": "2026-09-27T12:00:00+00:00"}},
    })
    monkeypatch.setattr(assets_router, "supabase", db)
    monkeypatch.setattr(assets_router, "_asset_or_404", lambda *_args: {"id": "asset-1"})

    started = await assets_router.start_asset_downtime(
        "asset-1", StartAssetDowntimeRequest(), ENGINEER
    )
    restored = await assets_router.restore_asset_downtime(
        "asset-1", "down-1", RestoreAssetDowntimeRequest(), ENGINEER
    )

    assert started["data"]["created"] is False
    assert restored["data"]["restored"] is False
    assert [call[0] for call in db.calls] == ["start_asset_downtime", "restore_asset_downtime"]
    assert all(call[1]["p_tenant_id"] == "hotel-1" for call in db.calls)


def test_migration_has_rbac_and_active_overlap_guards():
    migration = (Path(__file__).parents[3] / "supabase/migrations/113_asset_downtime_reliability.sql").read_text()

    assert "CREATE TABLE public.asset_downtime_periods" in migration
    assert "WHERE restored_at IS NULL" in migration
    assert "ENABLE ROW LEVEL SECURITY" in migration
    assert "CREATE FUNCTION public.start_asset_downtime" in migration
    assert "FOR UPDATE" in migration
    assert "CREATE FUNCTION public.restore_asset_downtime" in migration
    assert "p_work_order_id" in migration
