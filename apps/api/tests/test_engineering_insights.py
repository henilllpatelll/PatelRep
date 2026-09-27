from datetime import datetime, timedelta, timezone


from services.engineering_insights import build_engineering_insights


NOW = datetime(2026, 9, 27, 18, 0, tzinfo=timezone.utc)
START = NOW - timedelta(days=30)


def iso(minutes_before: int) -> str:
    return (NOW - timedelta(minutes=minutes_before)).isoformat()


def test_insights_uses_tracked_events_and_vendor_cost_once():
    report = build_engineering_insights(
        work_orders=[
            {
                "id": "wo-tracked",
                "created_at": iso(180),
                "acknowledged_at": iso(170),
                "arrived_at": iso(160),
                "completed_at": iso(120),
                "status": "completed",
                "labor_cost": 22,
                "parts_cost": 18,
                "vendor_cost": 512,
                "asset_id": "asset-1",
                "verification_result": "passed",
            },
            {
                "id": "wo-historical",
                "created_at": iso(90),
                "completed_at": iso(85),
                "status": "completed",
                "labor_cost": None,
                "parts_cost": None,
                "vendor_cost": None,
            },
        ],
        vendor_engagements=[
            {
                "work_order_id": "wo-tracked",
                "vendor_id": "vendor-1",
                "status": "completed",
                "requested_at": iso(170),
                "accepted_at": iso(162),
                "arrived_at": iso(135),
                "completed_at": iso(82),
                "invoice_amount": 512,
            }
        ],
        room_periods=[],
        asset_downtime=[],
        pm_completions=[],
        condition_readings=[],
        vendors=[{"id": "vendor-1", "name": "Metro Elevator"}],
        relationships=[],
        labor_sessions=[
            {"work_order_id": "wo-tracked", "duration_minutes": 34, "ended_at": iso(120)}
        ],
        start=START,
        end=NOW,
        now=NOW,
    )

    assert report["work_orders"]["completed"] == 2
    assert report["work_orders"]["median_response_minutes"] == 10
    assert report["work_orders"]["response_coverage"] == {"tracked": 1, "eligible": 2}
    assert report["work_orders"]["median_arrival_minutes"] == 20
    assert report["work_orders"]["median_resolution_minutes"] == 32
    assert report["costs"] == {
        "labor": 22.0,
        "parts": 18.0,
        "vendors": 512.0,
        "total": 552.0,
        "coverage": {"tracked": 1, "eligible": 2},
    }
    assert report["vendors"]["jobs"] == 1
    assert report["vendors"]["median_arrival_minutes"] == 35
    assert report["vendors"]["top"][0]["name"] == "Metro Elevator"


def test_insights_clips_room_and_asset_downtime_to_reporting_window():
    report = build_engineering_insights(
        work_orders=[],
        vendor_engagements=[],
        room_periods=[
            {
                "id": "room-1",
                "started_at": (START - timedelta(hours=2)).isoformat(),
                "actual_return_at": (START + timedelta(hours=3)).isoformat(),
                "status": "RELEASED",
                "reason_label": "HVAC",
            }
        ],
        asset_downtime=[
            {
                "asset_id": "asset-1",
                "started_at": (START - timedelta(hours=1)).isoformat(),
                "restored_at": (START + timedelta(hours=4)).isoformat(),
                "downtime_type": "unplanned",
            }
        ],
        pm_completions=[],
        condition_readings=[],
        vendors=[],
        relationships=[],
        labor_sessions=[],
        start=START,
        end=NOW,
        now=NOW,
    )

    assert report["rooms"]["downtime_minutes"] == 180
    assert report["rooms"]["affected"] == 1
    assert report["assets"]["unplanned_downtime_minutes"] == 240
    assert report["assets"]["failures"] == 0
