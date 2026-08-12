"""Proactive asset-failure-risk notifications (Phase 25).

Mirrors the FakeDB + monkeypatch(module, "supabase", db) harness used in
tests/test_lost_found_retention.py and tests/test_internal_escalations.py.

Covers:
1. New HIGH-risk crossing sends exactly one notification.
2. Repeated cron runs on unchanged HIGH data do not re-notify.
3. An asset already HIGH does not renotify on a re-run.
4. Never-analyzed assets (score 0 or key omitted) still notify on first HIGH.
5. Recipients are resolved from user_roles, never user_profiles.
6. A dual-role user gets exactly one notification, not one per role row.
7. Zero matching recipients yields zero notifications, no DB insert.
8. A notification-insert failure for one tenant is isolated from others.
"""

import pytest

from services.ai import failure_predictions
from tests.smoke.fake_supabase import FakeDB


def _fake_analyze(risk_score=85, window="Within 90 days", recommendation="Schedule inspection."):
    def _analyze(asset, work_orders, pm_schedules, hotel_id):
        return {
            "tenant_id": hotel_id,
            "asset_id": asset["id"],
            "risk_score": risk_score,
            "predicted_failure_window": window,
            "failure_indicators": [],
            "estimated_repair_cost": None,
            "estimated_replace_cost": None,
            "recommendation": recommendation,
            "ai_reasoning": "test fixture",
            "generated_at": "2026-01-01T00:00:00+00:00",
            "is_acknowledged": False,
        }
    return _analyze


# ---------------------------------------------------------------------------
# 1. New HIGH-risk crossing -> exactly one notification
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_new_high_risk_asset_sends_one_notification(monkeypatch):
    db = FakeDB({
        "assets": [{
            "id": "asset-1",
            "tenant_id": "hotel-1",
            "is_active": True,
            "name": "Boiler #1",
            "failure_risk_score": 20,
        }],
        "user_roles": [{
            "user_id": "eng-1",
            "tenant_id": "hotel-1",
            "role": "engineer",
            "is_active": True,
        }],
    })
    monkeypatch.setattr(failure_predictions, "supabase", db)
    monkeypatch.setattr(failure_predictions, "_analyze_asset", _fake_analyze(risk_score=85))

    result = await failure_predictions.run_asset_failure_predictions("hotel-1")

    assert result["notifications_sent"] == 1
    assert len(db.rows["notifications"]) == 1
    row = db.rows["notifications"][0]
    assert row["type"] == "asset_risk_high"
    assert "Boiler #1" in row["title"]
    assert row["data"] == {"asset_id": "asset-1", "risk_level": "HIGH", "risk_score": 85}


# ---------------------------------------------------------------------------
# 2. Repeated cron runs on unchanged data -> exactly 1 notification total
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_double_run_idempotency_no_repeat_notification(monkeypatch):
    db = FakeDB({
        "assets": [{
            "id": "asset-1",
            "tenant_id": "hotel-1",
            "is_active": True,
            "name": "Boiler #1",
            "failure_risk_score": 20,
        }],
        "user_roles": [{
            "user_id": "eng-1",
            "tenant_id": "hotel-1",
            "role": "engineer",
            "is_active": True,
        }],
    })
    monkeypatch.setattr(failure_predictions, "supabase", db)
    monkeypatch.setattr(failure_predictions, "_analyze_asset", _fake_analyze(risk_score=85))

    first = await failure_predictions.run_asset_failure_predictions("hotel-1")
    second = await failure_predictions.run_asset_failure_predictions("hotel-1")
    third = await failure_predictions.run_asset_failure_predictions("hotel-1")

    assert first["notifications_sent"] == 1
    assert second["notifications_sent"] == 0
    assert third["notifications_sent"] == 0
    assert len(db.rows["notifications"]) == 1


# ---------------------------------------------------------------------------
# 3. Asset already HIGH does not renotify
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_asset_already_high_does_not_renotify(monkeypatch):
    db = FakeDB({
        "assets": [{
            "id": "asset-1",
            "tenant_id": "hotel-1",
            "is_active": True,
            "name": "Boiler #1",
            "failure_risk_score": 80,
        }],
        "user_roles": [{
            "user_id": "eng-1",
            "tenant_id": "hotel-1",
            "role": "engineer",
            "is_active": True,
        }],
    })
    monkeypatch.setattr(failure_predictions, "supabase", db)
    monkeypatch.setattr(failure_predictions, "_analyze_asset", _fake_analyze(risk_score=85))

    result = await failure_predictions.run_asset_failure_predictions("hotel-1")

    assert result["notifications_sent"] == 0
    assert db.rows.get("notifications", []) == []


# ---------------------------------------------------------------------------
# 4. Never-analyzed assets (score 0 explicit, or key omitted) notify on first HIGH
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_never_analyzed_asset_notifies_on_first_high(monkeypatch):
    db = FakeDB({
        "assets": [
            {
                "id": "asset-1",
                "tenant_id": "hotel-1",
                "is_active": True,
                "name": "Boiler #1",
                "failure_risk_score": 0,
            },
            {
                "id": "asset-2",
                "tenant_id": "hotel-1",
                "is_active": True,
                "name": "Chiller #2",
                # failure_risk_score key omitted entirely
            },
        ],
        "user_roles": [{
            "user_id": "eng-1",
            "tenant_id": "hotel-1",
            "role": "engineer",
            "is_active": True,
        }],
    })
    monkeypatch.setattr(failure_predictions, "supabase", db)
    monkeypatch.setattr(failure_predictions, "_analyze_asset", _fake_analyze(risk_score=85))

    result = await failure_predictions.run_asset_failure_predictions("hotel-1")

    assert result["notifications_sent"] == 2


# ---------------------------------------------------------------------------
# 5. Recipients use user_roles, never user_profiles
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recipients_use_user_roles_not_user_profiles(monkeypatch):
    db = FakeDB({
        "assets": [{
            "id": "asset-1",
            "tenant_id": "hotel-1",
            "is_active": True,
            "name": "Boiler #1",
            "failure_risk_score": 20,
        }],
        "user_profiles": [{
            "user_id": "eng-1",
            "tenant_id": "hotel-1",
            "role": "engineer",
        }],
        "user_roles": [],
    })
    monkeypatch.setattr(failure_predictions, "supabase", db)
    monkeypatch.setattr(failure_predictions, "_analyze_asset", _fake_analyze(risk_score=85))

    result = await failure_predictions.run_asset_failure_predictions("hotel-1")
    assert result["notifications_sent"] == 0


@pytest.mark.asyncio
async def test_recipients_notify_when_user_roles_populated(monkeypatch):
    db = FakeDB({
        "assets": [{
            "id": "asset-1",
            "tenant_id": "hotel-1",
            "is_active": True,
            "name": "Boiler #1",
            "failure_risk_score": 20,
        }],
        "user_roles": [{
            "user_id": "gm-1",
            "tenant_id": "hotel-1",
            "role": "gm",
            "is_active": True,
        }],
    })
    monkeypatch.setattr(failure_predictions, "supabase", db)
    monkeypatch.setattr(failure_predictions, "_analyze_asset", _fake_analyze(risk_score=85))

    result = await failure_predictions.run_asset_failure_predictions("hotel-1")
    assert result["notifications_sent"] == 1


# ---------------------------------------------------------------------------
# 6. Dual-role user gets exactly one notification, not one per role row
# ---------------------------------------------------------------------------


def test_dual_role_user_dedup(monkeypatch):
    db = FakeDB({
        "user_roles": [
            {"user_id": "staff-1", "tenant_id": "hotel-1", "role": "gm", "is_active": True},
            {"user_id": "staff-1", "tenant_id": "hotel-1", "role": "engineer", "is_active": True},
        ],
    })
    monkeypatch.setattr(failure_predictions, "supabase", db)

    sent = failure_predictions.notify_engineers_asset_risk_high(
        hotel_id="hotel-1",
        asset_id="asset-1",
        asset_name="Boiler #1",
        risk_score=85,
        predicted_failure_window="Within 90 days",
        recommendation="Schedule inspection.",
    )

    assert sent == 1
    assert len(db.rows["notifications"]) == 1


# ---------------------------------------------------------------------------
# 7. Zero recipients -> zero notifications, no insert
# ---------------------------------------------------------------------------


def test_zero_recipients_returns_zero(monkeypatch):
    db = FakeDB({"user_roles": []})
    monkeypatch.setattr(failure_predictions, "supabase", db)

    sent = failure_predictions.notify_engineers_asset_risk_high(
        hotel_id="hotel-1",
        asset_id="asset-1",
        asset_name="Boiler #1",
        risk_score=85,
        predicted_failure_window="Within 90 days",
        recommendation="Schedule inspection.",
    )

    assert sent == 0
    assert db.rows.get("notifications", []) == []


# ---------------------------------------------------------------------------
# 8. Notification-insert failure for one tenant is isolated from others
# ---------------------------------------------------------------------------


class _PerTenantFailingDB(FakeDB):
    """notifications insert raises only for the configured failing tenant."""
    def __init__(self, rows, failing_tenant_id):
        super().__init__(rows)
        self.failing_tenant_id = failing_tenant_id

    def table(self, name):
        query = super().table(name)
        if name == "notifications":
            original_execute = query.execute

            def _guarded_execute():
                if query.action == "insert":
                    payload_rows = query.payload if isinstance(query.payload, list) else [query.payload]
                    if any(row.get("tenant_id") == self.failing_tenant_id for row in payload_rows):
                        raise RuntimeError("simulated transient DB error")
                return original_execute()

            query.execute = _guarded_execute
        return query


@pytest.mark.asyncio
async def test_per_tenant_notification_failure_is_isolated(monkeypatch):
    db = _PerTenantFailingDB(
        {
            "assets": [
                {
                    "id": "asset-1",
                    "tenant_id": "hotel-1",
                    "is_active": True,
                    "name": "Boiler #1",
                    "failure_risk_score": 20,
                },
                {
                    "id": "asset-2",
                    "tenant_id": "hotel-2",
                    "is_active": True,
                    "name": "Chiller #2",
                    "failure_risk_score": 20,
                },
            ],
            "user_roles": [
                {"user_id": "eng-1", "tenant_id": "hotel-1", "role": "engineer", "is_active": True},
                {"user_id": "eng-2", "tenant_id": "hotel-2", "role": "engineer", "is_active": True},
            ],
        },
        failing_tenant_id="hotel-1",
    )
    monkeypatch.setattr(failure_predictions, "supabase", db)
    monkeypatch.setattr(failure_predictions, "_analyze_asset", _fake_analyze(risk_score=85))

    total = await failure_predictions.run_all_hotels_failure_predictions()

    assert total["notifications_sent"] == 1

    hotel1_predictions = [
        p for p in db.rows["failure_predictions"] if p["tenant_id"] == "hotel-1"
    ]
    assert len(hotel1_predictions) == 1

    hotel2_notifications = [
        n for n in db.rows["notifications"] if n["tenant_id"] == "hotel-2"
    ]
    assert len(db.rows["notifications"]) == 1
    assert len(hotel2_notifications) == 1
